# Tripo API reference (only what this skill uses)

Base URL: `https://api.tripo3d.ai/v2/openapi`

Auth: `Authorization: Bearer <TRIPO_API_KEY>` on every request.

All successful responses follow `{ code: 0, data: ... }`. Errors use `{ code: <non-zero>, message, suggestion }`.

---

## 1. Upload image (only for image_to_model)

`POST /upload` — multipart/form-data, field name `file`.

```http
POST /upload
Authorization: Bearer <KEY>
Content-Type: multipart/form-data; boundary=...

--...
Content-Disposition: form-data; name="file"; filename="input.png"
Content-Type: image/png

<bytes>
```

Response:
```json
{ "code": 0, "data": { "image_token": "abc123..." } }
```

Use `image_token` as the `file_token` field on `File` objects in `createTask`.

---

## 2. Create task

`POST /task` — JSON body. The body shape is a discriminated union on `type`.

### Text → Model
```json
{
  "type": "text_to_model",
  "prompt": "a low-poly red apple, game asset",
  "model_version": "v3.1-20260211",
  "face_limit": 10000,
  "auto_size": true,
  "texture": true,
  "pbr": true,
  "texture_quality": "standard"
}
```

### Image → Model
```json
{
  "type": "image_to_model",
  "file": { "type": "png", "file_token": "<from /upload>" },
  "model_version": "v3.1-20260211",
  "face_limit": 10000,
  "auto_size": true,
  "texture": true,
  "pbr": true,
  "texture_quality": "standard",
  "texture_alignment": "original_image"
}
```

The `file` object's `type` field must match the uploaded image's format (`png`, `jpeg`, or `webp`).

You can also pass a public URL instead of uploading:
```json
{ "file": { "type": "png", "url": "https://example.com/cat.png" } }
```

Response:
```json
{ "code": 0, "data": { "task_id": "8f2e..." } }
```

---

## 3. Poll task status

`GET /task/{task_id}`

```json
{
  "code": 0,
  "data": {
    "task_id": "8f2e...",
    "type": "text_to_model",
    "status": "running",
    "progress": 47,
    "output": {}
  }
}
```

Possible `status` values:
- `queued` — not started yet
- `running` — in progress, `progress` is 0–100
- `success` — done, `output.pbr_model` (preferred) or `output.model` is a URL to the glb
- `failed` / `cancelled` / `banned` / `expired` — terminal, show error
- `unknown` — treat as transient, keep polling

When `status === "success"`, the model URL is in:
- `output.pbr_model` — glb with baked PBR textures (prefer this for three.js)
- `output.model` — fallback, base glb without PBR
- `output.rendered_image` — optional preview render (only if `render_image: true` was set)

**Polling cadence:** every 2 seconds. Give up after 5 minutes of continuous polling.

---

## 4. Parameter recipe for web-ready glb

Always set these on `createTask`. They bias output for realtime three.js rendering:

| Param | Value | Effect |
|---|---|---|
| `model_version` | `"v3.1-20260211"` | Latest standard quality |
| `face_limit` | `10000` | Keeps draw calls and GPU cost reasonable |
| `auto_size` | `true` | Normalizes scale |
| `texture` | `true` | Emit textures |
| `pbr` | `true` | Bakes PBR maps into the glb — no extra material wiring on the client |
| `texture_quality` | `"standard"` | 2K textures (`detailed` gives 4K; wasteful for web) |
| `texture_alignment` | `"original_image"` | Image-to-model only: textures match input image |

`export_uv` defaults to `true` — leave it alone.

Do NOT set `quad: true` — quad topology is for downstream DCC work, not for web rendering (three.js triangulates anyway).

---

## 5. File object shapes (quick lookup)

Used as `file` / `files` / `style_image` in task bodies.

Three forms, `oneOf`:
```ts
type File = { type: "png" | "jpeg" | "webp" } & (
  | { file_token: string }                          // from /upload
  | { url: string }                                 // public http URL
  | { object: { bucket: string; key: string } }     // STS upload (not used in this skill)
);
```

This skill only uses `file_token` and `url` — ignore the STS path.

---

## 6. Task lifecycle summary

```
POST /upload          → image_token          (only if image input)
POST /task            → task_id              (submit)
GET  /task/{task_id}  → status+progress      (poll every 2s)
                      → output.pbr_model     (glb URL on success)
```

The glb URL returned in `output.pbr_model` is a signed CDN link. Fetch it directly from the browser with `GLTFLoader` — no auth header needed on the glb download itself.

---

## 7. Error handling tips

- `401` on any Tripo call → API key missing or wrong
- `400` with `message` containing "quota" or "balance" → user is out of credits
- Task status `failed` with `error_msg` → show it; most common cause is NSFW/unsafe prompt
- Polling timeouts are client-side only; the task keeps running on Tripo's side. If you want to resume, cache the `task_id` client-side and keep polling across reloads.
