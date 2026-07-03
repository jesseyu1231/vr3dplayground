"""
tripo.py — Tripo AI (text → 3D and image → 3D) for the Wending Pavilion / 3D AI Environment.

This module mounts a small router on the FastAPI app (see server.py) and keeps the
Tripo API key SERVER-SIDE ONLY — it is never sent to the browser. Endpoints:

    GET  /api/tripo/config            -> { ready, systemPrompt }
    POST /api/tripo/text   {prompt}   -> { taskId }
    POST /api/tripo/image  (file)     -> { taskId }
    GET  /api/tripo/status/{taskId}   -> { status, progress, url?, name?, error? }

On success the status endpoint downloads the generated .glb from Tripo's CDN and
re-saves it under static/uploads/ so it gets a stable URL that the Quest headset
(a multiplayer viewer) and saved projects can load — exactly like an uploaded model.
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse


# ═══════════════════════════════════════════════════════════════════════════════
#  ①  TRIPO API KEY  —  paste your key here.
#
#      The single best place to set it is config.local.json (gitignored):
#          { "tripoApiKey": "tsk_xxx..." }
#      That file is read at startup and OVERRIDES this default, and it's also
#      picked up by the desktop (Node) build — so one edit covers both backends.
#      You can also set the TRIPO_API_KEY environment variable.
#
#      Get a key at  https://platform.tripo3d.ai  →  "API Keys".
#
#      NOTE: the demo key that shipped in tripo_integration/ is EXPIRED (it returns
#      401) — you must use your own key.
# ═══════════════════════════════════════════════════════════════════════════════
TRIPO_API_KEY_DEFAULT = "PASTE_YOUR_TRIPO_API_KEY_HERE"


# ═══════════════════════════════════════════════════════════════════════════════
#  ②  INJECTED SYSTEM PROMPT  —  edit freely.
#
#      Every text prompt the curator types is wrapped by this template before it
#      reaches Tripo, so all generated pieces share one house style: museum-grade,
#      presentation-ready, and light enough to render in WebXR on a Quest headset.
#      "{prompt}" is replaced with the user's words.
# ═══════════════════════════════════════════════════════════════════════════════
TRIPO_SYSTEM_PROMPT = (
    "{prompt}. A single museum-quality exhibition object presented on its own, "
    "centred and upright, neutral studio styling, clean retopologised geometry, "
    "realistic physically-based materials, no pedestal or base or ground plane, "
    "optimised as a real-time game-ready asset for VR."
)


# ═══════════════════════════════════════════════════════════════════════════════
#  ③  MESH MODEL + WEB-READY GENERATION PARAMS  —  tuned for realtime three.js / Quest.
#
#      model_version picks Tripo's generation model. We default to P1 — Tripo's
#      NEWEST model (released 2026-03-11), built for FAST, clean, low-poly,
#      game-ready meshes: the ideal "fast + smart mesh" for realtime WebXR.
#      Swap it here if you ever want a different speed/detail profile:
#        "P1-20260311"          ← default: newest, fast, clean low-poly (best for WebXR)
#        "Turbo-v1.0-20250506"    raw-speed model (older, less detail)
#        "v3.1-20260211"          latest high-detail "standard" model (slower, heavier)
#
#      face_limit caps triangles for the Quest poly budget (see the poly HUD); pbr
#      bakes materials into the glb so no client-side material wiring is needed.
# ═══════════════════════════════════════════════════════════════════════════════
WEB_READY_PARAMS = {
    "model_version": "P1-20260311",
    "face_limit": 10000,
    "auto_size": True,
    "texture": True,
    "pbr": True,
    "texture_quality": "standard",
}

TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi"
MAX_PROMPT_CHARS = 1000

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── API key resolution: config.local.json (via set_api_key) > env > default ──────
_api_key = os.getenv("TRIPO_API_KEY") or TRIPO_API_KEY_DEFAULT


def set_api_key(key: str) -> None:
    """Called from server.py with config.local.json's tripoApiKey (highest priority)."""
    global _api_key
    if key and key.strip():
        _api_key = key.strip()


def _resolve_key() -> str:
    return (_api_key or "").strip()


def is_ready() -> bool:
    key = _resolve_key()
    return bool(key) and key.lower() not in {"", "paste_your_tripo_api_key_here"}


# ── In-memory task bookkeeping (cleared on restart; tasks live on Tripo's side) ──
_task_names: dict[str, str] = {}     # taskId -> friendly display name for the asset
_localized: dict[str, str] = {}      # taskId -> /static/uploads/xxx.glb (download cache)


# ── Shared HTTP client ───────────────────────────────────────────────────────────
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0))
    return _client


class TripoError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


async def _tripo(method: str, path: str, **kwargs) -> dict:
    """Call a Tripo endpoint and return its `data` payload, raising TripoError on failure."""
    if not is_ready():
        raise TripoError("Tripo API key not configured. Add tripoApiKey to config.local.json.", 400)
    headers = {"Authorization": f"Bearer {_resolve_key()}"}
    headers.update(kwargs.pop("headers", {}))
    try:
        resp = await _get_client().request(method, TRIPO_BASE + path, headers=headers, **kwargs)
    except httpx.HTTPError as exc:
        raise TripoError(f"Network error talking to Tripo: {exc}") from exc

    try:
        body = resp.json()
    except ValueError:
        raise TripoError(f"Tripo {path} returned non-JSON (HTTP {resp.status_code}).")

    if resp.status_code == 401:
        raise TripoError("Tripo rejected the API key (401). Check tripoApiKey.", 401)
    if resp.status_code != 200 or body.get("code") != 0:
        msg = body.get("message") or f"HTTP {resp.status_code}"
        suggestion = body.get("suggestion")
        raise TripoError(f"Tripo error: {msg}" + (f" — {suggestion}" if suggestion else ""))
    return body.get("data") or {}


def _apply_system_prompt(user_text: str) -> str:
    text = " ".join((user_text or "").split())
    wrapped = TRIPO_SYSTEM_PROMPT.replace("{prompt}", text) if "{prompt}" in TRIPO_SYSTEM_PROMPT \
        else f"{text}. {TRIPO_SYSTEM_PROMPT}"
    return wrapped[:MAX_PROMPT_CHARS].strip()


def _short_name(text: str, fallback: str = "AI Model") -> str:
    text = " ".join((text or "").split())
    if not text:
        return fallback
    return (text[:40] + "…") if len(text) > 40 else text


def _gen_params(fast: bool) -> dict:
    """Build the generation params. `fast` = geometry-only draft: skip texturing/PBR,
    which is the slow phase — P1's mesh alone generates in ~seconds (Tripo's '2s' claim)."""
    p = dict(WEB_READY_PARAMS)
    if fast:
        p["texture"] = False
        p["pbr"] = False
    return p


async def _localize_glb(glb_url: str) -> str:
    """Download a finished glb from Tripo's CDN into static/uploads/ and return its local URL."""
    resp = await _get_client().get(glb_url, timeout=httpx.Timeout(180.0, connect=15.0))
    resp.raise_for_status()
    fname = f"{uuid.uuid4().hex}.glb"
    (UPLOAD_DIR / fname).write_bytes(resp.content)
    return f"/static/uploads/{fname}"


# ── Router ───────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/tripo", tags=["tripo"])


@router.get("/config")
async def tripo_config():
    """Lets the UI show readiness and the exact system prompt being injected."""
    return JSONResponse({"ready": is_ready(), "systemPrompt": TRIPO_SYSTEM_PROMPT})


@router.post("/text")
async def tripo_text(request: Request, fast: bool = False):
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        return JSONResponse({"error": "Describe what to create first."}, status_code=400)
    try:
        data = await _tripo(
            "POST", "/task",
            json={"type": "text_to_model", "prompt": _apply_system_prompt(prompt), **_gen_params(fast)},
        )
    except TripoError as exc:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    task_id = data.get("task_id")
    if not task_id:
        return JSONResponse({"error": "Tripo did not return a task id."}, status_code=502)
    _task_names[task_id] = _short_name(prompt)
    return JSONResponse({"taskId": task_id})


@router.post("/texture")
async def tripo_texture(request: Request):
    """Phase 2 of progressive generation: texture an already-generated draft mesh in place.
    `texture_model` keeps the exact geometry of the draft task and only bakes textures/PBR."""
    body = await request.json()
    base_id = (body.get("taskId") or "").strip()
    if not base_id:
        return JSONResponse({"error": "Missing draft taskId."}, status_code=400)
    try:
        data = await _tripo("POST", "/task", json={
            "type": "texture_model",
            "original_model_task_id": base_id,
            "texture": True,
            "pbr": True,
            "texture_quality": WEB_READY_PARAMS["texture_quality"],
        })
    except TripoError as exc:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    task_id = data.get("task_id")
    if not task_id:
        return JSONResponse({"error": "Tripo did not return a texture task id."}, status_code=502)
    _task_names[task_id] = _task_names.get(base_id, "AI Model")
    return JSONResponse({"taskId": task_id})


@router.post("/image")
async def tripo_image(file: UploadFile = File(...), fast: bool = False):
    raw = await file.read()
    if not raw:
        return JSONResponse({"error": "Empty image."}, status_code=400)
    if len(raw) > 25 * 1024 * 1024:
        return JSONResponse({"error": "Image too large (max 25 MB)."}, status_code=400)

    ext = Path(file.filename or "").suffix.lower().lstrip(".")
    fmt = "jpeg" if ext in {"jpg", "jpeg"} else ext if ext in {"png", "webp"} else "png"
    content_type = file.content_type or f"image/{fmt}"

    try:
        up = await _tripo("POST", "/upload", files={"file": (file.filename or f"input.{fmt}", raw, content_type)})
        image_token = up.get("image_token")
        if not image_token:
            return JSONResponse({"error": "Tripo upload returned no image_token."}, status_code=502)
        data = await _tripo(
            "POST", "/task",
            json={
                "type": "image_to_model",
                "file": {"type": fmt, "file_token": image_token},
                "texture_alignment": "original_image",
                **_gen_params(fast),
            },
        )
    except TripoError as exc:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    task_id = data.get("task_id")
    if not task_id:
        return JSONResponse({"error": "Tripo did not return a task id."}, status_code=502)
    stem = Path(file.filename or "image").stem
    _task_names[task_id] = _short_name(stem, "Image Model") + " (3D)"
    return JSONResponse({"taskId": task_id})


@router.get("/status/{task_id}")
async def tripo_status(task_id: str):
    try:
        data = await _tripo("GET", f"/task/{task_id}")
    except TripoError as exc:
        return JSONResponse({"error": str(exc)}, status_code=exc.status)

    status = data.get("status") or "unknown"
    progress = data.get("progress") if isinstance(data.get("progress"), (int, float)) else 0
    name = _task_names.get(task_id, "AI Model")

    if status == "success":
        if task_id not in _localized:
            out = data.get("output") or {}
            # pbr_model = textured/PBR; model = textured (texture_model output);
            # base_model = untextured draft mesh (fast / geometry-only generation).
            glb_url = out.get("pbr_model") or out.get("model") or out.get("base_model")
            if not glb_url:
                return JSONResponse({"status": "failed", "progress": 100,
                                     "error": "Tripo reported success but returned no model."})
            try:
                _localized[task_id] = await _localize_glb(glb_url)
            except Exception as exc:  # noqa: BLE001 — surface any download/save failure to the UI
                return JSONResponse({"status": "failed", "progress": 100,
                                     "error": f"Could not save the generated model: {exc}"})
        return JSONResponse({"status": "success", "progress": 100, "url": _localized[task_id], "name": name})

    if status in {"failed", "cancelled", "banned", "expired"}:
        return JSONResponse({"status": status, "progress": progress,
                             "error": data.get("error_msg") or f"Generation {status}."})

    # queued / running / unknown — keep polling
    return JSONResponse({"status": status, "progress": progress, "name": name})
