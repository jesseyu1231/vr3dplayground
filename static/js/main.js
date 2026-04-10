/**
 * main.js — entry point. Imports all modules, bootstraps the app, runs the render loop.
 */
import * as THREE from 'three';

// ── State (must be first — other modules import from it) ──
import { scene, camera, renderer, selectedObject } from './state.js';

// ── Scene setup ──
import { initScene } from './scene.js';
import { createHumanoid, animateHumanoid, clearMixamoModel, getMixamoSourceFile, loadMixamoFromFile, loadMixamoFromBuffer } from './humanoid.js';

// ── Lights ──
import { initDefaultLights, initLightButtons, ambientLight, dirLight, addDirectionalLight, addPointLight } from './lights.js';

// ── Environment presets ──
import { initEnvButton, registerDefaultLightsForEnv, envIndex, envPresets, applyEnvPreset, setEnvIndex } from './environment.js';

// ── Controls ──
import { orbitControls, tControls, selectObject, deselectAll, initKeyboard } from './controls.js';

// ── Undo/Redo ──
import { initUndoButtons } from './undo.js';

// ── Assets ──
import { loadGLB, initFileImport, initSceneExportImport, deleteSelected, duplicateSelected } from './assets.js';
import { importedObjects, userLights } from './state.js';

// ── Asset Panel ──
import { initAssetPanel, assetPanel } from './assetpanel.js';

// ── Chat ──
import { initChat, isTalking, updateSpeechBubbleFrame, addMessage } from './chat.js';

import { hideLightProps } from './lights.js';

// ── Multiplayer ──
import { connectWS, lerpRemoteCursors, sendCursorUpdate } from './multiplayer.js';

// ── Dev Panel ──
import { initDevPanel, updateDevPanel } from './devpanel.js';

// ── Init ──────────────────────────────────────────────────
const clock = new THREE.Clock();

initScene();
createHumanoid();

initDefaultLights();
registerDefaultLightsForEnv(ambientLight, dirLight);

initUndoButtons();
initLightButtons();
initEnvButton();
initAssetPanel();
initFileImport();
initSceneExportImport({
  addDirectionalLight, addPointLight,
  getEnvIndex:        () => envIndex,
  envPresets,         applyEnvPreset, setEnvIndex,
  getMixamoSourceFile: () => getMixamoSourceFile(),
  loadMixamoFromBuffer, clearMixamoModel,
});
initChat();

// Delete / Duplicate — wrap so they read current selectedObject
function doDelete() { deleteSelected(selectedObject); }
function doDuplicate() { duplicateSelected(selectedObject); }
document.getElementById('delete-btn').addEventListener('click', doDelete);
document.getElementById('duplicate-btn').addEventListener('click', doDuplicate);

document.getElementById('export-glb-btn').addEventListener('click', async () => {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const urlToFilename = {};
    for (const obj of importedObjects) {
      const url = obj.userData.url || '';
      if (url && !urlToFilename[url]) {
        urlToFilename[url] = obj.userData.displayName || url.split('/').pop() || 'model.glb';
      }
    }
    await Promise.all(Object.entries(urlToFilename).map(async ([url, filename]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        zip.file('objects/' + filename, await res.arrayBuffer());
      } catch (e) {
        console.warn('[Export GLB] skipping', filename, e.message);
      }
    }));

    const objects = importedObjects.map(obj => ({
      file:       urlToFilename[obj.userData.url || ''] ? 'objects/' + urlToFilename[obj.userData.url || ''] : '',
      name:       obj.userData.displayName || '',
      position:   obj.position.toArray(),
      quaternion: obj.quaternion.toArray(),
      scale:      obj.scale.toArray(),
    }));

    const lights = userLights.map(li => ({
      type:      li.type,
      color:     '#' + li.light.color.getHexString(),
      intensity: li.light.intensity,
      position:  li.light.position.toArray(),
    }));

    zip.file('scene.json', JSON.stringify({ objects, lights, grouped: true }, null, 2));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'grouped-export.zip';
    a.click();
    URL.revokeObjectURL(a.href);
    addMessage(`Exported grouped-export.zip (${objects.length} object(s), ${lights.length} light(s))`, 'system');
  } catch (err) {
    addMessage('Export failed: ' + (err.message || err), 'system');
  }
});

initKeyboard(doDelete, doDuplicate);

initDevPanel();

// ── Chat panel toggle ──
const chatPanel = document.getElementById('chat-panel');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
chatToggleBtn.addEventListener('click', () => {
  const hidden = chatPanel.style.display === 'none';
  chatPanel.style.display = hidden ? '' : 'none';
  chatToggleBtn.classList.toggle('active', hidden);
});
chatToggleBtn.classList.add('active'); // visible by default

// ── API Key Panel ──
const apiKeyBtn     = document.getElementById('api-key-btn');
const apiKeyPanel   = document.getElementById('api-key-panel');
const apiKeyInput   = document.getElementById('api-key-input');
const botNameInput  = document.getElementById('bot-name-input');
const apiKeySaveBtn = document.getElementById('api-key-save-btn');
const apiKeyCancelBtn = document.getElementById('api-key-cancel-btn');
const apiKeyStatus  = document.getElementById('api-key-status');

apiKeyBtn.addEventListener('click', () => {
  const hidden = apiKeyPanel.style.display === 'none';
  apiKeyPanel.style.display = hidden ? '' : 'none';
  apiKeyBtn.classList.toggle('active', hidden);
  if (hidden) checkApiKeyStatus();
});

apiKeyCancelBtn.addEventListener('click', () => {
  apiKeyPanel.style.display = 'none';
  apiKeyBtn.classList.remove('active');
});

apiKeySaveBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { apiKeyStatus.textContent = 'Please enter an API key.'; apiKeyStatus.style.color = '#ff5252'; return; }
  try {
    const res = await fetch('/api/set-api-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, botName: botNameInput.value.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      apiKeyStatus.textContent = 'API key saved! Bot: ' + data.botName;
      apiKeyStatus.style.color = '#8f8';
      apiKeyInput.value = '';
      addMessage('API key configured successfully.', 'system');
    } else {
      apiKeyStatus.textContent = data.error || 'Failed to save.';
      apiKeyStatus.style.color = '#ff5252';
    }
  } catch (e) {
    apiKeyStatus.textContent = 'Network error.';
    apiKeyStatus.style.color = '#ff5252';
  }
});

async function checkApiKeyStatus() {
  try {
    const res = await fetch('/api/api-key-status');
    const data = await res.json();
    if (data.set) {
      apiKeyStatus.textContent = 'Key is set. Bot: ' + data.botName;
      apiKeyStatus.style.color = '#8f8';
    } else {
      apiKeyStatus.textContent = 'No API key configured yet.';
      apiKeyStatus.style.color = '#ffd27e';
    }
  } catch { apiKeyStatus.textContent = ''; }
}

// ── Polygon budget warning (Quest 3S: ~1M triangles across 4 scenes → 250K per scene) ──
const QUEST_TRI_BUDGET   = 250_000;  // per-scene triangle budget for Quest 3S
const QUEST_WARN_RATIO   = 0.70;      // warn at 70%
const QUEST_DANGER_RATIO  = 0.90;     // danger at 90%
const polyWarning = document.getElementById('poly-warning');
let lastTriCount = 0;

function countSceneTriangles() {
  let tris = 0;
  for (const obj of importedObjects) {
    obj.traverse(child => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry;
        if (geo.index) {
          tris += geo.index.count / 3;
        } else if (geo.attributes.position) {
          tris += geo.attributes.position.count / 3;
        }
      }
    });
  }
  return Math.round(tris);
}

function updatePolyWarning() {
  const tris = countSceneTriangles();
  if (tris === lastTriCount) return;
  lastTriCount = tris;

  const ratio = tris / QUEST_TRI_BUDGET;
  const pct = Math.round(ratio * 100);

  if (ratio >= QUEST_DANGER_RATIO) {
    polyWarning.style.display = 'block';
    polyWarning.className = 'poly-warn poly-danger';
    polyWarning.textContent = `\u26a0\ufe0f ${tris.toLocaleString()} triangles (${pct}% of Quest 3S budget) — OVER BUDGET, expect frame drops on Quest`;
  } else if (ratio >= QUEST_WARN_RATIO) {
    polyWarning.style.display = 'block';
    polyWarning.className = 'poly-warn poly-caution';
    polyWarning.textContent = `\u26a0\ufe0f ${tris.toLocaleString()} triangles (${pct}% of Quest 3S budget) — approaching limit`;
  } else if (tris > 0) {
    polyWarning.style.display = 'block';
    polyWarning.className = 'poly-warn poly-ok';
    polyWarning.textContent = `\u25b2 ${tris.toLocaleString()} triangles (${pct}% of Quest 3S budget)`;
  } else {
    polyWarning.style.display = 'none';
  }
}

// ── Character upload ──
const characterInput = document.getElementById('character-input');
const characterResetBtn = document.getElementById('character-reset-btn');
document.getElementById('character-btn').addEventListener('click', () => characterInput.click());
characterInput.addEventListener('change', async () => {
  console.log('[Character] input change fired, files:', characterInput.files?.length);
  const file = characterInput.files[0];
  if (!file) return;
  console.log('[Character] file selected:', file.name, file.size);
  // Read buffer before clearing input — clearing input can invalidate File on Safari
  const buf = await file.arrayBuffer();
  const safeName = file.name;
  characterInput.value = '';
  loadMixamoFromBuffer(buf, safeName,
    () => {
      characterResetBtn.style.display = '';
      addMessage('Mixamo character loaded: ' + safeName, 'system');
    },
    (err) => {
      addMessage('Failed to load character: ' + (err.message || 'unknown error'), 'system');
    }
  );
});
characterResetBtn.addEventListener('click', () => {
  clearMixamoModel();
  characterResetBtn.style.display = 'none';
  addMessage('Character reset to default.', 'system');
});

// ── Connect multiplayer ──
connectWS(loadGLB);

// ── Resize ──
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── Render loop ──
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();

  animateHumanoid(t, isTalking);

  orbitControls.update();
  updateSpeechBubbleFrame();

  sendCursorUpdate();
  lerpRemoteCursors();

  updateDevPanel();
  updatePolyWarning();

  renderer.render(scene, camera);
});
