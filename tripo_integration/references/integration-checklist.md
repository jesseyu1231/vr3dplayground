# Hackathon fast-path checklist

A 5-minute verification that the integration actually works end-to-end. Run these in order.

## Backend up
- [ ] `tripo-handler.mjs` exists at the expected location
- [ ] `TRIPO_API_KEY` inside it is populated (pre-hardcoded for the hackathon — no action needed)
- [ ] Route file imports `createTripoTask`, `getTripoTask`, `uploadImageToTripo` from the handler
- [ ] Server starts without errors
- [ ] `curl -X POST http://localhost:8787/api/tripo/generate -H 'content-type: application/json' -d '{"prompt":"test"}'` returns `{"taskId":"..."}`

## Polling works
- [ ] `curl http://localhost:8787/api/tripo/status/<taskId>` returns `{"status":"queued"|"running"|..., "progress":N}`
- [ ] After ~60–120s, status becomes `"success"` and response includes `glbUrl`
- [ ] The `glbUrl` is downloadable (paste into browser, get a file)

## Frontend wired
- [ ] Frontend client fetches `/api/tripo/generate` (no CORS errors in console)
- [ ] If Vite: `vite.config.*` has `server.proxy['/api/tripo']` pointing at backend
- [ ] Poll logic updates UI every 2s with progress %
- [ ] On success, `GLTFLoader` loads the glb without errors

## three.js viewer
- [ ] Canvas mounts and renders the studio gradient background
- [ ] Model is visible, centered, normalized to a 1-unit bounding box
- [ ] Lighting looks like product photography (bright key from upper-right, soft cool fill, warm rim behind)
- [ ] Left-drag rotates the model
- [ ] Wheel zooms but cannot push the model out of sight (clamped)
- [ ] Right-drag / middle-drag do nothing (pan disabled by design)
- [ ] Camera cannot flip under or straight above the model (polar clamp works)

## Common failures

| Symptom | Fix |
|---|---|
| `401` on backend logs | API key wrong in `tripo-handler.mjs` |
| `CORS` error in browser | Backend isn't on same origin — add Vite dev proxy |
| `TypeError: Cannot read 'pbr_model'` | Task `status` is `failed`; check `error_msg` |
| Model invisible / clipped | Viewer hasn't run auto-center/auto-scale — use the provided `TripoViewer` |
| Model too dark / plasticky | PMREM env map missing — check that `RoomEnvironment` import resolved |
| Model too washed out | Lower `renderer.toneMappingExposure` below 1.05 |
| Progress never updates past 0 | Polling URL is wrong, or CORS is blocking the status endpoint |
