/**
 * electron/preload.js — Runs in the renderer sandbox before the page loads.
 * Exposes a minimal API via contextBridge (contextIsolation: true).
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
});
