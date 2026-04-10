/**
 * state.js — shared mutable state across all modules.
 * Import what you need; mutate via the setter functions.
 * This module imports nothing, preventing circular dependencies.
 */
import * as THREE from 'three';

// ── Scene graph ──
export const scene = new THREE.Scene();

// ── Camera + dolly (VR locomotion) ──
export const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 5000);
camera.position.set(0, 1.6, 4);

export const dolly = new THREE.Group();
dolly.add(camera);
scene.add(dolly);

// ── Renderer ──
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = false;

// ── User content group (imported objects; used for export/sync) ──
export const userContentGroup = new THREE.Group();
userContentGroup.name = 'UserContent';
scene.add(userContentGroup);

// ── Object/light collections ──
export const importedObjects = [];
export const userLights = []; // { light, helper, handle, type, id }

// ── Selection ──
export let selectedObject = null;
export function setSelectedObject(obj) { selectedObject = obj; }

// ── Multiplayer identity ──
export const myName = localStorage.getItem('mp_name') || 'User';
localStorage.setItem('mp_name', myName);
export const myRole = /OculusBrowser|Quest/i.test(navigator.userAgent) ? 'viewer' : 'editor';
export let myUserId = null;
export function setMyUserId(id) { myUserId = id; }

// ── WebSocket reference (set by multiplayer.js) ──
let _ws = null;
export function setWs(ws) { _ws = ws; }
export function wsSend(msg) {
  if (_ws && _ws.readyState === WebSocket.OPEN) _ws.send(JSON.stringify(msg));
}

// ── 3D chat history (shared by chat + vr hand panel) ──
export const chatHistory3D = [];

// ── Utility ──
export function genId() { return crypto.randomUUID(); }
