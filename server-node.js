/**
 * server-node.js — Express + WebSocket backend (replaces server.py for Electron desktop).
 * No Python required. Handles static files, GLB upload, and multiplayer WebSocket.
 * AI chat is disabled in this build.
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const { app: electronApp } = require('electron');
const { WebSocketServer } = require('ws');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');

const BASE_DIR = __dirname;

// When packaged, the app bundle is read-only. Store uploads in userData instead.
// In dev, use the local static/uploads folder as before.
const isPackaged = electronApp.isPackaged;
const UPLOAD_DIR = isPackaged
  ? path.join(electronApp.getPath('userData'), 'uploads')
  : path.join(BASE_DIR, 'static', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT    = new Set(['.glb']);
const MAX_UPLOAD_MB  = 100;
const CURSOR_COLORS  = [
  '#ff4444', '#44ff44', '#4488ff', '#ff44ff',
  '#ffaa00', '#00ffcc', '#ff6600', '#aa44ff',
  '#44ffaa', '#ff4488',
];

// ── multer storage ──────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase()),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error(`Unsupported format. Allowed: ${[...ALLOWED_EXT].join(', ')}`));
  },
});

// ── ConnectionManager (mirrors Python ConnectionManager) ────────────────────
class ConnectionManager {
  constructor() {
    this.clients    = new Map(); // userId -> { ws, name, color, role }
    this.sceneState = { objects: {}, lights: {}, envIndex: 0 };
    this._colorIdx  = 0;
  }

  nextColor() {
    return CURSOR_COLORS[this._colorIdx++ % CURSOR_COLORS.length];
  }

  async connect(ws, userId, name, role) {
    const color = this.nextColor();
    this.clients.set(userId, { ws, name, color, role });

    const users = {};
    for (const [uid, c] of this.clients) {
      users[uid] = { name: c.name, color: c.color, role: c.role };
    }

    this._send(ws, {
      type: 'welcome',
      userId,
      color,
      sceneState: this.sceneState,
      users,
    });

    this.broadcast({ type: 'user_join', userId, name, color, role }, userId);
  }

  disconnect(userId) {
    this.clients.delete(userId);
  }

  broadcast(message, excludeId = null) {
    const payload = JSON.stringify(message);
    for (const [uid, client] of this.clients) {
      if (uid === excludeId) continue;
      if (client.ws.readyState === 1 /* OPEN */) {
        client.ws.send(payload);
      }
    }
  }

  _send(ws, message) {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  handleMessage(userId, data) {
    const role    = this.clients.get(userId)?.role || 'viewer';
    const msgType = data.type;

    if (msgType === 'user_move' || msgType === 'chat') {
      this.broadcast({ ...data, userId }, userId);
      return;
    }

    if (role !== 'editor') return;

    switch (msgType) {
      case 'object_add': {
        const obj = data.object;
        if (obj?.id) this.sceneState.objects[obj.id] = obj;
        this.broadcast({ ...data, userId }, userId);
        break;
      }
      case 'object_transform': {
        const oid = data.id;
        if (oid && this.sceneState.objects[oid]) {
          for (const key of ['position', 'quaternion', 'scale']) {
            if (data[key] !== undefined) this.sceneState.objects[oid][key] = data[key];
          }
        }
        this.broadcast({ ...data, userId }, userId);
        break;
      }
      case 'object_delete': {
        delete this.sceneState.objects[data.id];
        this.broadcast({ ...data, userId }, userId);
        break;
      }
      case 'light_add': {
        const li = data.light;
        if (li?.id) this.sceneState.lights[li.id] = li;
        this.broadcast({ ...data, userId }, userId);
        break;
      }
      case 'light_update': {
        const lid = data.id;
        if (lid && this.sceneState.lights[lid]) {
          for (const key of ['color', 'intensity', 'position']) {
            if (data[key] !== undefined) this.sceneState.lights[lid][key] = data[key];
          }
        }
        this.broadcast({ ...data, userId }, userId);
        break;
      }
      case 'light_delete': {
        delete this.sceneState.lights[data.id];
        this.broadcast({ ...data, userId }, userId);
        break;
      }
      case 'env_change': {
        this.sceneState.envIndex = data.envIndex ?? 0;
        this.broadcast({ ...data, userId }, userId);
        break;
      }
    }
  }
}

const manager = new ConnectionManager();

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Static files
app.use('/static', express.static(path.join(BASE_DIR, 'static')));
// When packaged, uploads live outside the bundle in userData — serve them at the same URL
if (isPackaged) {
  app.use('/static/uploads', express.static(UPLOAD_DIR));
}

// Root → index.html
app.get('/', (req, res) => res.sendFile(path.join(BASE_DIR, 'index.html')));

// Upload endpoint
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 400 : 400;
      return res.status(status).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    res.json({
      url:  `/static/uploads/${req.file.filename}`,
      name: req.file.originalname,
    });
  });
});

// Chat endpoint — disabled in desktop build
app.post('/api/chat', (req, res) => {
  res.json({ reply: 'AI chat is not available in the desktop version.' });
});

// ── Start server (called by electron/main.js) ────────────────────────────────
function startServer(port = 8000) {
  const server = http.createServer(app);

  // WebSocket server attached to same HTTP server
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const urlParams = new URL(req.url, 'http://localhost').searchParams;
    const name      = (urlParams.get('name') || 'Anonymous').slice(0, 20);
    let   role      = urlParams.get('role') || 'viewer';
    if (!['editor', 'viewer'].includes(role)) role = 'viewer';
    const userId    = uuidv4().replace(/-/g, '').slice(0, 8);

    manager.connect(ws, userId, name, role);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        manager.handleMessage(userId, data);
      } catch { /* ignore malformed messages */ }
    });

    ws.on('close', () => {
      manager.disconnect(userId);
      manager.broadcast({ type: 'user_leave', userId });
    });

    ws.on('error', () => ws.close());
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[server-node] Listening on http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startServer };
