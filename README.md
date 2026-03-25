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
