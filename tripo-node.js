/**
 * tripo-node.js — Tripo AI (text → 3D, image → 3D) for the Electron desktop build.
 *
 * Mirrors tripo.py so the desktop "Builder" can generate models too. Mount with:
 *     require('./tripo-node').mountTripo(app, { uploadDir: UPLOAD_DIR });
 *
 * Routes (identical contract to the Python backend):
 *     GET  /api/tripo/config            -> { ready, systemPrompt }
 *     POST /api/tripo/text   {prompt}   -> { taskId }
 *     POST /api/tripo/image  (file)     -> { taskId }
 *     GET  /api/tripo/status/:taskId    -> { status, progress, url?, name?, error? }
 *
 * Requires Node 18+ globals (fetch / FormData / Blob) — Electron 35 ships Node 20+.
 * The API key stays server-side; the browser never sees it.
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const multer = require('multer');

// ① TRIPO API KEY — config.local.json { "tripoApiKey": "..." } or the TRIPO_API_KEY
//    env var override this default. (Same single source the Python backend reads.)
//    The demo key that shipped in tripo_integration/ is EXPIRED — use your own.
const TRIPO_API_KEY_DEFAULT = 'PASTE_YOUR_TRIPO_API_KEY_HERE';

// ② INJECTED SYSTEM PROMPT — keep in sync with tripo.py (TRIPO_SYSTEM_PROMPT) so the
//    desktop build produces the same house style. "{prompt}" = the user's words.
const TRIPO_SYSTEM_PROMPT =
  '{prompt}. A single museum-quality exhibition object presented on its own, ' +
  'centred and upright, neutral studio styling, clean retopologised geometry, ' +
  'realistic physically-based materials, no pedestal or base or ground plane, ' +
  'optimised as a real-time game-ready asset for VR.';

// ③ MESH MODEL + WEB-READY GENERATION PARAMS — tuned for realtime three.js / Quest.
//    model_version defaults to P1 — Tripo's newest model (2026-03-11), built for
//    FAST, clean, low-poly, game-ready meshes (the "fast + smart mesh" for WebXR).
//    Alternatives: 'Turbo-v1.0-20250506' (raw speed, older) or 'v3.1-20260211'
//    (latest high-detail standard, slower/heavier). Keep in sync with tripo.py.
const WEB_READY_PARAMS = {
  model_version: 'P1-20260311',
  face_limit: 10000,
  auto_size: true,
  texture: true,
  pbr: true,
  texture_quality: 'standard',
};

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';
const MAX_PROMPT_CHARS = 1000;

function resolveKey() {
  if (process.env.TRIPO_API_KEY && process.env.TRIPO_API_KEY.trim()) return process.env.TRIPO_API_KEY.trim();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8'));
    if (cfg.tripoApiKey && String(cfg.tripoApiKey).trim()) return String(cfg.tripoApiKey).trim();
  } catch { /* no config file (e.g. packaged build) — fall through */ }
  return TRIPO_API_KEY_DEFAULT;
}

function isReady() {
  const k = resolveKey();
  return !!k && k.toLowerCase() !== 'paste_your_tripo_api_key_here';
}

async function tripoFetch(pathPart, init = {}) {
  if (!isReady()) { const e = new Error('Tripo API key not configured. Add tripoApiKey to config.local.json.'); e.status = 400; throw e; }
  const headers = Object.assign({ Authorization: 'Bearer ' + resolveKey() }, init.headers || {});
  let resp;
  try {
    resp = await fetch(TRIPO_BASE + pathPart, Object.assign({}, init, { headers }));
  } catch (err) { const e = new Error('Network error talking to Tripo: ' + err.message); e.status = 502; throw e; }
  const text = await resp.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { const e = new Error('Tripo returned non-JSON (HTTP ' + resp.status + ').'); e.status = 502; throw e; }
  if (resp.status === 401) { const e = new Error('Tripo rejected the API key (401). Check tripoApiKey.'); e.status = 401; throw e; }
  if (!resp.ok || body.code !== 0) {
    const msg = body.message || ('HTTP ' + resp.status);
    const e = new Error('Tripo error: ' + msg + (body.suggestion ? ' — ' + body.suggestion : ''));
    e.status = 502; throw e;
  }
  return body.data || {};
}

function applySystemPrompt(userText) {
  const text = String(userText || '').split(/\s+/).filter(Boolean).join(' ');
  const wrapped = TRIPO_SYSTEM_PROMPT.includes('{prompt}')
    ? TRIPO_SYSTEM_PROMPT.replace('{prompt}', text)
    : text + '. ' + TRIPO_SYSTEM_PROMPT;
  return wrapped.slice(0, MAX_PROMPT_CHARS).trim();
}

function shortName(text, fallback) {
  const t = String(text || '').split(/\s+/).filter(Boolean).join(' ');
  if (!t) return fallback || 'AI Model';
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

function genParams(fast) {
  // fast = geometry-only draft: skip texturing/PBR (the slow phase) for a ~seconds mesh.
  const p = Object.assign({}, WEB_READY_PARAMS);
  if (fast === '1' || fast === 'true' || fast === true) { p.texture = false; p.pbr = false; }
  return p;
}

function mountTripo(app, opts = {}) {
  const uploadDir = opts.uploadDir || path.join(__dirname, 'static', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const taskNames = new Map();   // taskId -> friendly name
  const localized = new Map();   // taskId -> /static/uploads/xxx.glb
  const imgUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  app.get('/api/tripo/config', (req, res) => res.json({ ready: isReady(), systemPrompt: TRIPO_SYSTEM_PROMPT }));

  app.post('/api/tripo/text', async (req, res) => {
    const prompt = ((req.body && req.body.prompt) || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Describe what to create first.' });
    try {
      const data = await tripoFetch('/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ type: 'text_to_model', prompt: applySystemPrompt(prompt) }, genParams(req.query.fast))),
      });
      if (!data.task_id) return res.status(502).json({ error: 'Tripo did not return a task id.' });
      taskNames.set(data.task_id, shortName(prompt));
      res.json({ taskId: data.task_id });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  app.post('/api/tripo/texture', async (req, res) => {
    // Phase 2 of progressive generation: texture an already-generated draft mesh in place.
    const baseId = ((req.body && req.body.taskId) || '').trim();
    if (!baseId) return res.status(400).json({ error: 'Missing draft taskId.' });
    try {
      const data = await tripoFetch('/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'texture_model', original_model_task_id: baseId,
          texture: true, pbr: true, texture_quality: WEB_READY_PARAMS.texture_quality }),
      });
      if (!data.task_id) return res.status(502).json({ error: 'Tripo did not return a texture task id.' });
      taskNames.set(data.task_id, taskNames.get(baseId) || 'AI Model');
      res.json({ taskId: data.task_id });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  app.post('/api/tripo/image', (req, res) => {
    imgUpload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No image received.' });
      const ext = path.extname(req.file.originalname || '').toLowerCase().replace('.', '');
      const fmt = (ext === 'jpg' || ext === 'jpeg') ? 'jpeg' : (ext === 'png' || ext === 'webp') ? ext : 'png';
      try {
        const form = new FormData();
        form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || ('image/' + fmt) }), req.file.originalname || ('input.' + fmt));
        const up = await tripoFetch('/upload', { method: 'POST', body: form });
        if (!up.image_token) return res.status(502).json({ error: 'Tripo upload returned no image_token.' });
        const data = await tripoFetch('/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign(
            { type: 'image_to_model', file: { type: fmt, file_token: up.image_token }, texture_alignment: 'original_image' },
            genParams(req.query.fast),
          )),
        });
        if (!data.task_id) return res.status(502).json({ error: 'Tripo did not return a task id.' });
        const stem = path.basename(req.file.originalname || 'image', path.extname(req.file.originalname || ''));
        taskNames.set(data.task_id, shortName(stem, 'Image Model') + ' (3D)');
        res.json({ taskId: data.task_id });
      } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
    });
  });

  app.get('/api/tripo/status/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    let data;
    try { data = await tripoFetch('/task/' + encodeURIComponent(taskId)); }
    catch (e) { return res.status(e.status || 502).json({ error: e.message }); }

    const status = data.status || 'unknown';
    const progress = typeof data.progress === 'number' ? data.progress : 0;
    const name = taskNames.get(taskId) || 'AI Model';

    if (status === 'success') {
      if (!localized.has(taskId)) {
        const out = data.output || {};
        const glbUrl = out.pbr_model || out.model || out.base_model;
        if (!glbUrl) return res.json({ status: 'failed', progress: 100, error: 'Tripo reported success but returned no model.' });
        try {
          const r = await fetch(glbUrl);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const buf = Buffer.from(await r.arrayBuffer());
          const fname = crypto.randomUUID().replace(/-/g, '') + '.glb';
          fs.writeFileSync(path.join(uploadDir, fname), buf);
          localized.set(taskId, '/static/uploads/' + fname);
        } catch (e) { return res.json({ status: 'failed', progress: 100, error: 'Could not save the generated model: ' + e.message }); }
      }
      return res.json({ status: 'success', progress: 100, url: localized.get(taskId), name });
    }
    if (['failed', 'cancelled', 'banned', 'expired'].includes(status)) {
      return res.json({ status, progress, error: data.error_msg || ('Generation ' + status + '.') });
    }
    return res.json({ status, progress, name });
  });
}

module.exports = { mountTripo };
