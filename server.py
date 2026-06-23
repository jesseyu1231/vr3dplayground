"""
Backend server for 3D AI Environment.
Proxies chat messages to POE via fastapi_poe SDK, serves the static frontend,
and handles 3D asset uploads.  Supports HTTPS for WebXR.
"""

import os
import uuid
import asyncio
import json
import tempfile
from functools import partial as functools_partial
from pathlib import Path

from fastapi import FastAPI, Request, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import fastapi_poe as fp

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".glb", ".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB

CONFIG_PATH = BASE_DIR / "config.local.json"


def _load_local_config() -> dict:
    """Load saved API key and bot name from config.local.json (gitignored).
    Falls back to environment variables. Edit this file (or set env vars) on the
    hosting computer so the values are picked up automatically — the headset
    talks to this server, so it inherits them with no extra setup.
    """
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"[config] Failed to read {CONFIG_PATH.name}: {e}")
    return {}


def _save_local_config(api_key: str, bot_name: str) -> None:
    """Persist the API key and bot name so they survive server restarts."""
    try:
        CONFIG_PATH.write_text(json.dumps(
            {"poeApiKey": api_key, "poeBotName": bot_name},
            indent=2,
        ))
    except OSError as e:
        print(f"[config] Failed to write {CONFIG_PATH.name}: {e}")


_cfg = _load_local_config()
POE_API_KEY = _cfg.get("poeApiKey") or os.getenv("POE_API_KEY", "")
BOT_NAME = _cfg.get("poeBotName") or os.getenv("POE_BOT_NAME", "ai_ministerbot")

# ── Multiplayer ──────────────────────────────────────────
CURSOR_COLORS = [
    "#ff4444", "#44ff44", "#4488ff", "#ff44ff",
    "#ffaa00", "#00ffcc", "#ff6600", "#aa44ff",
    "#44ffaa", "#ff4488",
]


class ConnectionManager:
    def __init__(self):
        self.clients: dict = {}  # user_id -> {ws, name, color, role}
        self.scene_state = {
            "objects": {},
            "lights": {},
            "envIndex": 0,
            "character": None,
        }
        self._color_idx = 0

    @staticmethod
    def sanitize_name(name: str) -> str:
        cleaned = " ".join(str(name or "").split()).strip()[:20]
        return cleaned or "User"

    def next_color(self) -> str:
        c = CURSOR_COLORS[self._color_idx % len(CURSOR_COLORS)]
        self._color_idx += 1
        return c

    async def connect(self, ws: WebSocket, user_id: str, name: str, role: str):
        await ws.accept()
        name = self.sanitize_name(name)
        color = self.next_color()
        self.clients[user_id] = {"ws": ws, "name": name, "color": color, "role": role}
        users = {
            uid: {"name": c["name"], "color": c["color"], "role": c["role"]}
            for uid, c in self.clients.items()
        }
        await ws.send_json({
            "type": "welcome",
            "userId": user_id,
            "color": color,
            "sceneState": self.scene_state,
            "users": users,
        })
        await self.broadcast(
            {"type": "user_join", "userId": user_id, "name": name, "color": color, "role": role},
            exclude=user_id,
        )

    def disconnect(self, user_id: str):
        self.clients.pop(user_id, None)

    async def broadcast(self, message: dict, exclude: str = None):
        dead = []
        for uid, client in self.clients.items():
            if uid == exclude:
                continue
            try:
                await client["ws"].send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.clients.pop(uid, None)

    async def handle_message(self, user_id: str, data: dict):
        role = self.clients.get(user_id, {}).get("role", "viewer")
        msg_type = data.get("type")

        if msg_type in ("user_move", "chat"):
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)
            return

        if msg_type == "user_rename":
            client = self.clients.get(user_id)
            if not client:
                return
            name = self.sanitize_name(data.get("name", client["name"]))
            old_name = client["name"]
            client["name"] = name
            await self.broadcast(
                {
                    "type": "user_rename",
                    "userId": user_id,
                    "name": name,
                    "oldName": old_name,
                    "color": client["color"],
                    "role": client["role"],
                },
                exclude=user_id,
            )
            return

        if role != "editor":
            return

        if msg_type == "scene_reset":
            self.scene_state = {
                "objects": {},
                "lights": {},
                "envIndex": data.get("envIndex", 0),
                "character": None,
            }
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)
            return

        if msg_type == "object_add":
            obj = data.get("object")
            if obj and obj.get("id"):
                self.scene_state["objects"][obj["id"]] = obj
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "object_transform":
            oid = data.get("id")
            if oid and oid in self.scene_state["objects"]:
                for key in ("position", "quaternion", "scale"):
                    if key in data:
                        self.scene_state["objects"][oid][key] = data[key]
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "object_delete":
            oid = data.get("id")
            self.scene_state["objects"].pop(oid, None)
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "light_add":
            light = data.get("light")
            if light and light.get("id"):
                self.scene_state["lights"][light["id"]] = light
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "light_update":
            lid = data.get("id")
            if lid and lid in self.scene_state["lights"]:
                for key in ("color", "intensity", "position"):
                    if key in data:
                        self.scene_state["lights"][lid][key] = data[key]
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "light_delete":
            lid = data.get("id")
            self.scene_state["lights"].pop(lid, None)
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "env_change":
            self.scene_state["envIndex"] = data.get("envIndex", 0)
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "character_set":
            character = data.get("character")
            if character and character.get("url"):
                self.scene_state["character"] = {
                    "url": character["url"],
                    "name": character.get("name", "Character"),
                }
                await self.broadcast({**data, "userId": user_id}, exclude=user_id)

        elif msg_type == "character_clear":
            self.scene_state["character"] = None
            await self.broadcast({**data, "userId": user_id}, exclude=user_id)


manager = ConnectionManager()


@app.on_event("startup")
async def _warm_stt_model():
    # Pull the whisper model into memory in the background so the first
    # /api/stt request doesn't pay the model-load cost.
    async def _bg():
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _load_stt_model)
        except Exception as e:
            print(f"[stt] warm-up failed (continuing anyway): {e}")
    asyncio.create_task(_bg())


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    params = dict(ws.query_params)
    name = ConnectionManager.sanitize_name(params.get("name", "User"))
    role = params.get("role", "viewer")
    if role not in ("editor", "viewer"):
        role = "viewer"
    user_id = uuid.uuid4().hex[:8]

    await manager.connect(ws, user_id, name, role)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            await manager.handle_message(user_id, data)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id)
        await manager.broadcast({"type": "user_leave", "userId": user_id})


@app.get("/api/api-key-status")
async def api_key_status():
    return JSONResponse({"set": bool(POE_API_KEY), "botName": BOT_NAME})


@app.post("/api/set-api-key")
async def set_api_key(request: Request):
    global POE_API_KEY, BOT_NAME
    body = await request.json()
    key = body.get("apiKey", "").strip()
    bot = body.get("botName", "").strip()
    if not key:
        return JSONResponse({"error": "API key is required."}, status_code=400)
    POE_API_KEY = key
    if bot:
        BOT_NAME = bot
    _save_local_config(POE_API_KEY, BOT_NAME)
    return JSONResponse({"ok": True, "botName": BOT_NAME})


def _call_poe_sync(user_text: str) -> str:
    """Run the synchronous POE SDK call (must run outside the async event loop)."""
    messages = [fp.ProtocolMessage(role="user", content=user_text)]
    full_response = ""
    for partial in fp.get_bot_response_sync(
        messages=messages,
        bot_name=BOT_NAME,
        api_key=POE_API_KEY,
    ):
        full_response += partial.text
    return full_response


@app.post("/api/chat")
async def chat(request: Request):
    global POE_API_KEY, BOT_NAME
    body = await request.json()
    user_text = body.get("message", "")

    if not user_text.strip():
        return JSONResponse({"reply": "Please enter a message."}, status_code=400)

    if not POE_API_KEY:
        return JSONResponse(
            {"reply": "No API key configured. Click the \u2699\ufe0f API Key button to set one."},
            status_code=400,
        )

    try:
        loop = asyncio.get_event_loop()
        full_response = await loop.run_in_executor(
            None, functools_partial(_call_poe_sync, user_text)
        )
    except Exception as e:
        return JSONResponse(
            {"reply": f"Error communicating with POE: {e}"}, status_code=502
        )

    return JSONResponse({"reply": full_response})


# ── Speech-to-text (server-side Whisper) ────────────────────────────────
# Lazy-loaded so the server still boots fast and never blocks for the model
# until the first /api/stt call. faster-whisper picks the right backend for
# the host (CPU on Intel/AMD, CoreML on Apple Silicon when available).
STT_MODEL_NAME = os.getenv("STT_MODEL", "base.en")
_stt_model = None
_stt_lock = asyncio.Lock()


def _load_stt_model():
    global _stt_model
    if _stt_model is not None:
        return _stt_model
    from faster_whisper import WhisperModel
    print(f"[stt] loading faster-whisper model: {STT_MODEL_NAME}")
    _stt_model = WhisperModel(STT_MODEL_NAME, device="cpu", compute_type="int8")
    print("[stt] model ready")
    return _stt_model


def _transcribe_sync(audio_path: str) -> str:
    model = _load_stt_model()
    segments, _ = model.transcribe(
        audio_path,
        beam_size=1,
        vad_filter=True,
        language="en",
    )
    return " ".join(seg.text.strip() for seg in segments).strip()


@app.post("/api/stt")
async def stt(file: UploadFile = File(...)):
    contents = await file.read()
    if len(contents) > 25 * 1024 * 1024:
        return JSONResponse({"error": "Audio too large (max 25 MB)."}, status_code=400)
    if not contents:
        return JSONResponse({"text": ""})

    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        async with _stt_lock:        # serialize — single model instance
            loop = asyncio.get_event_loop()
            text = await loop.run_in_executor(None, _transcribe_sync, tmp_path)
        return JSONResponse({"text": text})
    except Exception as e:
        print(f"[stt] error: {e}")
        return JSONResponse({"error": f"Transcription failed: {e}"}, status_code=500)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/api/upload")
async def upload_model(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return JSONResponse(
            {"error": f"Unsupported format. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"},
            status_code=400,
        )

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        return JSONResponse({"error": "File too large (max 100 MB)."}, status_code=400)

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / safe_name
    dest.write_bytes(contents)

    return JSONResponse({"url": f"/static/uploads/{safe_name}", "name": file.filename})


# Serve the frontend
@app.get("/")
async def root():
    return FileResponse(str(BASE_DIR / "index.html"))


# Serve static assets
app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)
