# 3D AI Environment

A Three.js-based 3D environment with a humanoid character connected to a POE AI bot via the `fastapi_poe` SDK.

## Features

- **3D scene** — Procedural humanoid model with idle animations and talking gestures
- **Chat UI** — Text input/output overlay with speech bubble above the character
- **POE integration** — Messages are sent to a POE bot and responses are displayed in real-time
- **Orbit controls** — Click and drag to rotate the camera around the character

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Set your POE API key

```bash
export POE_API_KEY="your_poe_api_key_here"
```

Optionally set a different bot name (default is `ai_ministerbot`):

```bash
export POE_BOT_NAME="your_bot_name"
```

### 3. Run the server

```bash
uvicorn server:app --reload --port 8000
```

### 4. Open in browser

Navigate to **http://localhost:8000**

## Meta Quest / Headset Hosting

For Meta Quest Browser, WebXR only appears when the page is served from a secure context. On a real device that means **HTTPS**.

### Quick launch for Quest

```bash
python serve_quest_https.py --port 8001
```

The helper will generate `cert.pem` and `key.pem` if needed, bind the server to your LAN, and print the headset URL.

Open the printed URL from Quest Browser, for example:

```text
https://10.209.87.60:8001
```

Quest will warn that the certificate is self-signed. Choose **Advanced** and continue to the site. After that, the VR button should appear and immersive mode should be available.

## Project Structure

```
├── server.py               # FastAPI backend (proxies chat to POE)
├── index.html              # Markup entry point
├── index.html.bak          # Original single-file version (preserved as fallback)
├── requirements.txt        # Python dependencies
├── cert.pem / key.pem      # SSL certs for WebXR (HTTPS required on device)
├── README.md               # This file
└── static/
    ├── css/
    │   └── style.css       # All styles
    ├── js/
    │   ├── main.js         # Entry point, render loop
    │   ├── state.js        # Shared mutable state (scene, camera, renderer, etc.)
    │   ├── scene.js        # Sky, fog, ground, grid
    │   ├── humanoid.js     # Procedural character + animation
    │   ├── lights.js       # Default + user lights, light props panel
    │   ├── environment.js  # Sky/fog presets
    │   ├── controls.js     # OrbitControls, TransformControls, snap, click-select, keyboard
    │   ├── vr.js           # VRButton, XR controllers, hand panel, locomotion
    │   ├── undo.js         # Undo/redo stack
    │   ├── chat.js         # addMessage, sendMessage, speech bubble
    │   ├── textsprite.js   # Canvas-to-3D sprite for VR chat panel
    │   ├── assetpanel.js   # Scene asset list UI
    │   ├── assets.js       # GLB load/import/export, delete, duplicate
    │   └── multiplayer.js  # WebSocket client, cursors, remote sync
    └── uploads/            # Uploaded GLB assets
```

## Controls

- **Orbit**: Left-click drag to rotate around the character
- **Zoom**: Scroll to zoom in/out
- **Pan**: Right-click drag to pan
- **Chat**: Type in the input box and press Enter or click Send
- **VR move**: Left Quest thumbstick moves in first person
- **VR turn**: Right Quest thumbstick snap-turns in 30° steps for comfort

## VR Comfort Notes

- VR uses **first-person locomotion** instead of orbit camera controls.
- Turning uses **snap turn** instead of smooth rotation to reduce nausea.
- Strafing and backward movement are intentionally slower than forward movement.
- Thumbsticks use a **deadzone and eased acceleration** to avoid sudden micro-motions.

## Performance & Asset Optimizations

### Upload Limit

The GLB upload limit is **100 MB** per file (set in `server.py` and `server-node.js`).

> **Quest 3S guidance:** When deploying to Meta Quest 3S (Snapdragon XR2 Gen 2), aim for **10–20 MB per scene** (DRACO + KTX2 compressed). With 4 joined scenes, the total budget is ~40–80 MB of compressed assets to maintain 72/90 FPS.

### DRACO Mesh Compression

The GLTFLoader is configured with a **DRACOLoader** that automatically decompresses DRACO-encoded geometry at load time. This reduces GLB file sizes by up to **80–90%** on disk/network with no quality loss.

To take advantage of this, export your models with DRACO compression enabled in Blender (File → Export → glTF 2.0 → check "Draco mesh compression") or use `gltf-transform` CLI:
```bash
npx gltf-transform draco input.glb output.glb
```

### KTX2 / Basis Texture Compression

The GLTFLoader is configured with a **KTX2Loader** for GPU-native texture compression (ETC2 on Quest, BC7 on desktop). This reduces texture VRAM usage by up to **75%**.

Convert textures to KTX2 format using `gltf-transform`:
```bash
npx gltf-transform ktx input.glb output.glb --slots "baseColor,normal,emissive"
```

### GPU Memory Disposal

When objects are deleted from the scene, all associated GPU resources (geometry, materials, textures) are automatically disposed to prevent memory leaks. This is critical for sessions where many models are imported and removed.
