/**
 * electron/main.js — Electron entry point.
 * Starts the Node.js/Express server and opens the app window.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const net  = require('net');

const isDev = !app.isPackaged;

// ── Find a free port ──────────────────────────────────────────────────────────
function getFreePort(preferred) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      // preferred port busy — let OS assign one
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferred, '127.0.0.1', () => {
      server.close(() => resolve(preferred));
    });
  });
}

let mainWindow = null;

async function init() {
  const port = await getFreePort(8000);

  // Start the Express + WebSocket server
  const { startServer } = require('../server-node.js');
  startServer(port);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '3D AI Environment — Desktop Builder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allows the ES module importmap to load Three.js from CDN (jsdelivr/esm.sh)
      webSecurity: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Only open DevTools during development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  init();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) init();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
