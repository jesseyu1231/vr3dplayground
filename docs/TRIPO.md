# AI 3D Generation (Tripo) — setup & usage

Generate exhibition objects from **text** or an **image** with Tripo AI. A generated
model behaves exactly like an imported one: select, move/rotate/scale, undo, multiplayer
sync to the Quest headset, show/hide, and it saves inside your project `.zip`.

---

## 1. Insert your API key  ← the one thing you must do

Open **`config.local.json`** (repo root, gitignored) and paste your key:

```json
{
  "poeApiKey": "…",
  "poeBotName": "AI_Ministerbot",
  "tripoApiKey": "tsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

Get a key at <https://platform.tripo3d.ai> → **API Keys**. Then restart the server.

> The demo key that shipped in `tripo_integration/` is **expired** (returns `401`) — use your own.

This single file is read by **both** backends (the Python/WebXR server *and* the Electron
desktop build). Alternatives, in priority order:

1. `config.local.json` → `tripoApiKey`  ← recommended
2. `TRIPO_API_KEY` environment variable
3. the `TRIPO_API_KEY_DEFAULT` constant at the top of `tripo.py` (and `tripo-node.js` for desktop)

The key is **server-side only** — it is never sent to the browser or the headset.

---

## 2. Tune the injected "system prompt"

Every text prompt the curator types is wrapped server-side before it reaches Tripo, so all
generated pieces share one house style (museum-grade, presentation-ready, Quest-light). Edit:

- **`tripo.py`** → `TRIPO_SYSTEM_PROMPT`  (Python / WebXR server)
- **`tripo-node.js`** → `TRIPO_SYSTEM_PROMPT`  (desktop build — keep in sync)

`{prompt}` is replaced with the user's words. The exact template in use is also shown in the
app under **✨ AI → "How your words are enhanced"**.

Web-ready output params live next to it in `WEB_READY_PARAMS`. The mesh model defaults to
**`P1-20260311`** — Tripo's newest model (2026-03-11), built for fast, clean, low-poly,
game-ready meshes (ideal for Quest/WebXR). To trade speed for a different profile, change
`model_version` there:

| `model_version` | Profile |
|---|---|
| `P1-20260311` *(default)* | newest · fast · clean low-poly · game-ready |
| `Turbo-v1.0-20250506` | raw speed, older, less detail |
| `v3.1-20260211` | latest high-detail "standard" (slower, heavier) |

In a live test, P1 produced a 9.5K-triangle PBR vase in ~97 s at 0.8 MB — vs v3.1's heavier
1.1 MB. `face_limit` still caps triangles against the Quest poly budget regardless of model.

---

## 3. Use it

- Click **✨ AI Generate** in the toolbar (or the **✨ AI** tab inside *Import 3D*).
- **Text:** type a description → **Generate 3D**  (⌘/Ctrl+Enter also submits).
- **Image:** click the image box → pick a JPG/PNG/WEBP.
- A progress bar tracks Tripo (~60–120 s). When done the model drops into the scene,
  centered and auto-scaled, already selected.

Because the curator (desktop = *editor*) generates and the result syncs over multiplayer,
everyone in the **Quest headset (viewer)** sees the new object appear automatically.

---

## How it works (for maintainers)

```
Browser (tripo.js)                Server (tripo.py / tripo-node.js)        Tripo
  POST /api/tripo/text  ───────►  inject system prompt + web params  ───►  POST /task
  POST /api/tripo/image ───────►  upload bytes, then image_to_model  ───►  /upload + /task
  GET  /api/tripo/status/:id ──►  poll; on success DOWNLOAD the glb   ───►  GET /task/:id
                                  into static/uploads/ → return a
                                  stable /static/uploads/xxx.glb URL
  loadGLB(url, name)  ◄─────────  { status:"success", url, name }
```

The download-and-localize step is what makes a generated model a first-class citizen: a
stable URL that the headset and other peers can fetch, that persists in saved projects, and
that survives Tripo's signed-link expiry — identical to an uploaded `.glb`.

Files added/changed: `tripo.py`, `tripo-node.js`, `static/js/tripo.js`, plus the
`/api/tripo/*` mount in `server.py` & `server-node.js`, the `✨ AI` tab in `index.html`,
`initTripoUI()` in `static/js/main.js`, and themed styles in `static/css/style.css`.
