/**
 * multiplayer.js — WebSocket client, remote cursors, scene state sync.
 */
import * as THREE from 'three';
import {
  scene, camera, importedObjects, userLights, selectedObject,
  myName, myRole, setMyUserId, setWs, wsSend,
} from './state.js';
import { addDirectionalLight, addPointLight } from './lights.js';
import { createPrimitive } from './assets.js';
import { refreshAssetPanel } from './assetpanel.js';
import { addMessage, showSpeechBubble } from './chat.js';
import { applyEnvPreset, envPresets, setEnvIndex } from './environment.js';

const remoteUsers   = new Map();
const remoteCursors = new Map();
export let lastCursorSend = 0;

// ── Cursor meshes ──
function createCursorMesh(name, color) {
  const group = new THREE.Group();
  const cone  = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.18, 8),
    new THREE.MeshBasicMaterial({ color })
  );
  cone.rotation.x = Math.PI;
  group.add(cone);

  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 128, 42);
  const tex   = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  label.scale.set(0.5, 0.125, 1);
  label.position.y = 0.2;
  group.add(label);
  scene.add(group);
  return group;
}

function updateConnectedCount(count) {
  const n = count ?? (remoteUsers.size + 1);
  document.getElementById('connected-count').textContent = n + ' connected';
}

function updateCursor(userId, msg) {
  let cur = remoteCursors.get(userId);
  if (!cur) {
    const info = remoteUsers.get(userId) || { name: userId.slice(0, 4), color: '#ffffff' };
    cur = {
      mesh: createCursorMesh(info.name, info.color),
      targetPos:  new THREE.Vector3(),
      targetQuat: new THREE.Quaternion(),
    };
    remoteCursors.set(userId, cur);
  }
  if (msg.position)   cur.targetPos.fromArray(msg.position);
  if (msg.quaternion) cur.targetQuat.fromArray(msg.quaternion);
}

function removeCursor(userId) {
  const cur = remoteCursors.get(userId);
  if (cur) {
    scene.remove(cur.mesh);
    remoteCursors.delete(userId);
  }
}

// ── Remote scene operations ──
function applyRemoteTransform(msg) {
  const obj = importedObjects.find(o => o.userData.id === msg.id);
  if (!obj) return;
  if (msg.position)   obj.position.fromArray(msg.position);
  if (msg.quaternion) obj.quaternion.fromArray(msg.quaternion);
  if (msg.scale)      obj.scale.fromArray(msg.scale);
}

function removeRemoteObject(id) {
  const idx = importedObjects.findIndex(o => o.userData.id === id);
  if (idx === -1) return;
  const obj = importedObjects[idx];
  obj.removeFromParent();
  importedObjects.splice(idx, 1);
  if (selectedObject === obj) document.dispatchEvent(new CustomEvent('deselect-all'));
  refreshAssetPanel();
}

function applyRemoteLightUpdate(msg) {
  const li = userLights.find(l => l.id === msg.id);
  if (!li) return;
  if (msg.color)     { li.light.color.set(msg.color); li.handle.material.color.set(msg.color); }
  if (msg.intensity !== undefined) li.light.intensity = msg.intensity;
  if (msg.position)  { li.light.position.fromArray(msg.position); li.handle.position.fromArray(msg.position); }
  if (li.helper) li.helper.update();
}

function removeRemoteLight(id) {
  const idx = userLights.findIndex(l => l.id === id);
  if (idx === -1) return;
  const li = userLights[idx];
  scene.remove(li.light);
  if (li.helper) scene.remove(li.helper);
  scene.remove(li.handle);
  if (li.light.target) scene.remove(li.light.target);
  userLights.splice(idx, 1);
  if (selectedObject === li.handle) document.dispatchEvent(new CustomEvent('deselect-all'));
  refreshAssetPanel();
}

function reconstructScene(state, loadGLBFn) {
  if (!state) return;
  for (const obj of Object.values(state.objects)) {
    loadGLBFn(obj.url, 'synced', {
      id: obj.id, position: obj.position,
      quaternion: obj.quaternion, scale: obj.scale, remote: true,
    });
  }
  for (const li of Object.values(state.lights)) {
    if (li.type === 'directional') addDirectionalLight({ ...li, remote: true });
    else addPointLight({ ...li, remote: true });
  }
  if (state.envIndex !== undefined) {
    setEnvIndex(state.envIndex);
    applyEnvPreset(envPresets[state.envIndex]);
    document.getElementById('env-btn').textContent = '\ud83c\udf05 ' + envPresets[state.envIndex].name;
  }
}

// ── Message handler ──
function handleWSMessage(msg, loadGLBFn) {
  switch (msg.type) {
    case 'welcome':
      setMyUserId(msg.userId);
      for (const [uid, info] of Object.entries(msg.users)) {
        if (uid !== msg.userId) remoteUsers.set(uid, info);
      }
      updateConnectedCount(Object.keys(msg.users).length);
      reconstructScene(msg.sceneState, loadGLBFn);
      break;
    case 'user_join':
      remoteUsers.set(msg.userId, { name: msg.name, color: msg.color, role: msg.role });
      updateConnectedCount();
      addMessage(msg.name + ' joined', 'system');
      break;
    case 'user_leave': {
      const leaveName = remoteUsers.get(msg.userId)?.name || 'Someone';
      remoteUsers.delete(msg.userId);
      removeCursor(msg.userId);
      updateConnectedCount();
      addMessage(leaveName + ' left', 'system');
      break;
    }
    case 'user_move':
      updateCursor(msg.userId, msg);
      break;
    case 'object_add':
      if (msg.object) {
        if (msg.object.primitive) {
          createPrimitive(msg.object.primitive, msg.object.color || '#ffffff', {
            id: msg.object.id, position: msg.object.position,
            quaternion: msg.object.quaternion, scale: msg.object.scale, remote: true,
          });
        } else {
          loadGLBFn(msg.object.url, 'remote', {
            id: msg.object.id, position: msg.object.position,
            quaternion: msg.object.quaternion, scale: msg.object.scale, remote: true,
          });
        }
      }
      break;
    case 'object_transform':
      applyRemoteTransform(msg);
      break;
    case 'object_delete':
      removeRemoteObject(msg.id);
      break;
    case 'light_add':
      if (msg.light) {
        if (msg.light.type === 'directional') addDirectionalLight({ ...msg.light, remote: true });
        else addPointLight({ ...msg.light, remote: true });
      }
      break;
    case 'light_update':
      applyRemoteLightUpdate(msg);
      break;
    case 'light_delete':
      removeRemoteLight(msg.id);
      break;
    case 'env_change':
      setEnvIndex(msg.envIndex);
      applyEnvPreset(envPresets[msg.envIndex]);
      document.getElementById('env-btn').textContent = '\ud83c\udf05 ' + envPresets[msg.envIndex].name;
      break;
    case 'chat':
      if (msg.chatType === 'user' && msg.name) {
        addMessage(msg.name + ': ' + msg.text, 'peer');
      } else if (msg.chatType === 'bot' && msg.text) {
        addMessage(msg.text, 'bot');
        showSpeechBubble(msg.text, 6000);
      } else if (msg.text) {
        addMessage(msg.text, 'system');
      }
      break;
  }
}

// ── Cursor lerp (called every frame) ──
export function lerpRemoteCursors() {
  for (const [, cur] of remoteCursors) {
    cur.mesh.position.lerp(cur.targetPos, 0.15);
    cur.mesh.quaternion.slerp(cur.targetQuat, 0.15);
  }
}

// ── Cursor send (called every frame, throttled) ──
export function sendCursorUpdate() {
  const now = performance.now();
  if (now - lastCursorSend < 100) return;
  lastCursorSend = now;
  const cp = new THREE.Vector3();
  camera.getWorldPosition(cp);
  const cq = new THREE.Quaternion();
  camera.getWorldQuaternion(cq);
  wsSend({ type: 'user_move', position: cp.toArray(), quaternion: [cq.x, cq.y, cq.z, cq.w] });
}

// ── Connect ──
export function connectWS(loadGLBFn) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(
    proto + '//' + location.host + '/ws?name=' + encodeURIComponent(myName) + '&role=' + myRole
  );
  setWs(ws);
  ws.onopen = () => updateConnectedCount();
  ws.onmessage = (e) => { try { handleWSMessage(JSON.parse(e.data), loadGLBFn); } catch {} };
  ws.onclose = () => {
    document.getElementById('connected-count').textContent = 'Reconnecting\u2026';
    setTimeout(() => connectWS(loadGLBFn), 2000);
  };
  ws.onerror = () => ws.close();
}
