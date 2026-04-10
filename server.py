"""
Backend server for 3D AI Environment.
Proxies chat messages to POE via fastapi_poe SDK, serves the static frontend,
and handles 3D asset uploads.  Supports HTTPS for WebXR.
"""

import os
import uuid
import asyncio
import json
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

ALLOWED_EXTENSIONS = {".glb"}
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB

POE_API_KEY = os.getenv("POE_API_KEY", "")
BOT_NAME = os.getenv("POE_BOT_NAME", "ai_ministerbot")

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
        }
        self._color_idx = 0

    def next_color(self) -> str:
        c = CURSOR_COLORS[self._color_idx % len(CURSOR_COLORS)]
        self._color_idx += 1
        return c

    async def connect(self, ws: WebSocket, user_id: str, name: str, role: str):
        await ws.accept()
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

        if role != "editor":
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


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    params = dict(ws.query_params)
    name = params.get("name", "Anonymous")[:20]
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
