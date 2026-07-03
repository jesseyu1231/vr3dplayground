---
name: tripo-integration
description: Integrate Tripo AI 3D model generation into a web app with a three.js viewer. Use when the user asks to "add Tripo", "generate 3D models from text/image at runtime", "wire up Tripo API", or wants the browser to produce a .glb on the fly. Diagnoses whether a backend already exists, drops the right route template in, and installs a framework-appropriate frontend client (React / Vue / vanilla).
---

# Tripo AI runtime integration for three.js apps

You are integrating Tripo AI into a web app built for a hackathon. The app must be able to:

1. Accept a text prompt or image from the user at runtime
2. Call the Tripo API to generate a `.glb`
3. Load and render that `.glb` in a three.js scene

**The API key is hardcoded by the user into the backend handler — never expose it to the browser.** All Tripo calls go through a backend route the browser talks to.

Hackathon context: prioritize "it runs in 10 minutes" over architectural purity. Don't add env vars, don't invent abstractions, don't generate docs. Copy the right templates in, edit placeholders, show the user how to start it.

---

## Phase 1 — Diagnose the project

Before copying anything, figure out what's already there. Run these checks **in parallel**:

1. Read `package.json` at the project root (and any obvious sub-project roots like `frontend/`, `client/`, `web/`, `apps/*/`).
2. Glob for common backend locations: `app/api/**`, `pages/api/**`, `server/**`, `backend/**`, `src/server/**`, `server.*`, `index.*` at root.
3. Glob for frontend framework hints: `vite.config.*`, `next.config.*`, `nuxt.config.*`, `vue.config.*`, `src/**/*.vue`, `src/**/*.tsx`, `App.vue`, `App.tsx`.

Classify the project into **one** of these shapes:

| Shape | Signals | Where to put backend | Where to put frontend |
|---|---|---|---|
| **Next.js** | `next` in deps, `next.config.*`, `app/` or `pages/` dir | `app/api/tripo/generate/route.ts` + `app/api/tripo/status/[taskId]/route.ts` (App Router) or `pages/api/tripo/*.ts` (Pages Router) | `lib/tripo/` + component |
| **Express/Fastify/Hono already wired** | framework in deps, app instance exported somewhere | Mount `tripoRouter` on existing app | Frontend framework's standard lib dir |
| **Vite + React/Vue, no backend** | `vite` in deps, no server files, no `next` | Scaffold `server/` at root with standalone Express | `src/lib/tripo/` |
| **Plain static / vanilla** | no build tool, no framework | Scaffold standalone Express backend at `server/` | Alongside user's existing JS |
| **Unknown / empty** | nothing useful in repo | Ask the user what stack they're using before proceeding | — |

State the diagnosis to the user in one sentence before acting: *"You have a Vite + React project with no backend — I'll scaffold a small Express server in `server/` and add the frontend client to `src/lib/tripo/."*

---

## Phase 2 — Backend integration

All backends use the same core handler in `templates/backend/tripo-handler.mjs`. It is **framework-agnostic** — it exports two functions (`createTripoTask`, `getTripoTask`) plus `uploadImageToTripo`. The route templates are thin wrappers.

**Always copy `tripo-handler.mjs` first**, into a location the route can import (e.g. `server/tripo-handler.mjs`, or `lib/tripo-handler.mjs` for Next.js). Then copy the matching route template.

### If Next.js (App Router)
Copy:
- `templates/backend/tripo-handler.mjs` → `lib/tripo-handler.mjs`
- `templates/backend/route-nextjs-app-generate.ts` → `app/api/tripo/generate/route.ts`
- `templates/backend/route-nextjs-app-status.ts` → `app/api/tripo/status/[taskId]/route.ts`

### If Next.js (Pages Router)
Copy:
- `templates/backend/tripo-handler.mjs` → `lib/tripo-handler.mjs`
- `templates/backend/route-nextjs-pages-generate.ts` → `pages/api/tripo/generate.ts`
- `templates/backend/route-nextjs-pages-status.ts` → `pages/api/tripo/status/[taskId].ts`

### If Express is already in the project
Copy:
- `templates/backend/tripo-handler.mjs` → wherever their server code lives (e.g. `server/tripo-handler.mjs`)
- `templates/backend/route-express.mjs` → same dir

Then add **two lines** to their existing server entry:
```js
import { tripoRouter } from './tripo-router.mjs';
app.use('/api/tripo', tripoRouter);
```

### If Hono / Cloudflare Workers
Copy:
- `templates/backend/tripo-handler.mjs` → `src/tripo-handler.mjs`
- `templates/backend/route-hono.ts` → `src/tripo-routes.ts`

Mount with `app.route('/api/tripo', tripoRoutes)`.

### If no backend exists
Scaffold a standalone Express server:
- `templates/backend/standalone-server.mjs` → `server/server.mjs`
- `templates/backend/tripo-handler.mjs` → `server/tripo-handler.mjs`
- `templates/backend/standalone-package.json` → `server/package.json`

Tell the user:
```
cd server && npm install && npm start
# Server runs on http://localhost:8787
```

If the frontend is Vite, add a proxy to `vite.config.*` so fetching `/api/tripo/*` during dev works:
```js
server: { proxy: { '/api/tripo': 'http://localhost:8787' } }
```
(Edit the user's existing vite.config file — do not overwrite it.)

### API key placement
Every route template imports `TRIPO_API_KEY` from `tripo-handler.mjs`. The key is already hardcoded at the top of that file for hackathon use — participants don't need to do anything to make it work. Do not move the key to env vars, do not create a `.env`, do not add dotenv.

---

## Phase 3 — Frontend integration

Pick the flavor that matches the project:

| Framework | Copy |
|---|---|
| **React** (incl. Next.js) | `templates/frontend/react/useTripoModel.ts` + `templates/frontend/react/TripoViewer.tsx` |
| **Vue 3** | `templates/frontend/vue/useTripoModel.ts` + `templates/frontend/vue/TripoViewer.vue` |
| **Vanilla TS / plain JS** | `templates/frontend/vanilla/tripo-client.ts` + `templates/frontend/vanilla/viewer.ts` |

All three flavors share the same shape:
- `useTripoModel` / `TripoClient` handles: submit prompt/image → poll `/api/tripo/status/:id` every 2s → return `glbUrl` when done
- `TripoViewer` / `viewer.ts` handles:
  - load glb with `GLTFLoader`
  - auto-center + auto-scale via `Box3` (largest dimension normalized to 1 unit)
  - **product-photography lighting** (3-point: warm key, cool fill, warm rim + PMREM `RoomEnvironment` for PBR reflections)
  - **studio-gradient background** (cool charcoal top → near-black bottom)
  - **left-drag to rotate, wheel to zoom**; pan disabled, zoom clamped, polar clamped — so participants can't accidentally lose the model off-screen

three.js is assumed to already be installed. If `three` isn't in deps, tell the user: `npm i three` (plus `@types/three` if TS).

---

## Phase 4 — Quick smoke test

After wiring is done, tell the user exactly what to run:

1. Start the backend (if standalone: `cd server && npm start`; otherwise their normal dev command)
2. Start the frontend (their normal dev command — `npm run dev` etc.)
3. In the browser, trigger a generation with a test prompt like "a low-poly red apple"
4. Expect: progress updates within ~3s, completed glb within ~60–120s, model centered and visible in the viewer

If the first call fails with `401`, the API key in `tripo-handler.mjs` is wrong. If it fails with CORS, the Vite dev proxy isn't configured.

---

## Web-ready parameter recipe (why these defaults)

The backend handler sets these on every `createTask` call — they're tuned for three.js rendering, not for max quality:

| Param | Value | Why |
|---|---|---|
| `model_version` | `v3.1-20260211` | Latest standard model |
| `face_limit` | `10000` | Keeps geometry light enough for realtime rendering |
| `auto_size` | `true` | Normalizes model to a sane bounding box |
| `texture` | `true` | Generate textures |
| `pbr` | `true` | Baked PBR stays inside the glb, no external material setup needed |
| `texture_quality` | `standard` | 2K textures (detailed = 4K, overkill on web) |
| `texture_alignment` | `original_image` | Better match to input image when image-to-model |

The frontend `TripoViewer` also re-centers and re-scales via `Box3` on load — so even if a glb comes out slightly off, the camera framing always works.

Full schema reference: `references/tripo-api.md`.

---

## Reference files

- `references/tripo-api.md` — condensed Tripo API reference (the only endpoints this skill uses)
- `references/integration-checklist.md` — fast-path verification for the hackathon

## Template files

- `templates/backend/tripo-handler.mjs` — core logic, framework-agnostic
- `templates/backend/route-express.mjs` — Express Router
- `templates/backend/route-nextjs-app-generate.ts` / `-status.ts` — Next.js App Router
- `templates/backend/route-nextjs-pages-generate.ts` / `-status.ts` — Next.js Pages Router
- `templates/backend/route-hono.ts` — Hono / Workers
- `templates/backend/standalone-server.mjs` + `standalone-package.json` — zero-backend fallback
- `templates/frontend/react/` — `useTripoModel.ts`, `TripoViewer.tsx`
- `templates/frontend/vue/` — `useTripoModel.ts`, `TripoViewer.vue`
- `templates/frontend/vanilla/` — `tripo-client.ts`, `viewer.ts`
