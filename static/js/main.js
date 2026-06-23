/**
 * main.js — entry point. Imports all modules, bootstraps the app, runs the render loop.
 */
import * as THREE from 'three';

// ── State (must be first — other modules import from it) ──
import { scene, camera, renderer, selectedObject, myName, wsSend, galleryGroup, defaultItems, genId } from './state.js';

// ── Scene setup ──
import { initScene } from './scene.js';
import { initGallery } from './gallery.js';
import { initGarden, updateGarden } from './garden.js';
import { createHumanoid, animateHumanoid, clearMixamoModel, getMixamoSourceFile, loadMixamoFromFile, loadMixamoFromBuffer, humanoid } from './humanoid.js';

// ── Lights ──
import { initDefaultLights, initLightButtons, ambientLight, dirLight, hemisphereLight, addDirectionalLight, addPointLight } from './lights.js';

// ── Environment presets ──
import { initEnvButton, registerDefaultLightsForEnv, envIndex, envPresets, applyEnvPreset, setEnvIndex } from './environment.js';

// ── Controls ──
import { orbitControls, tControls, selectObject, deselectAll, initKeyboard, updateFlyControls } from './controls.js';

// ── Undo/Redo ──
import { initUndoButtons } from './undo.js';

// ── Assets ──
import { loadGLB, initFileImport, initSceneExportImport, deleteSelected, duplicateSelected, buildZipFileMap } from './assets.js';
import { importedObjects, userLights } from './state.js';

// ── Asset Panel ──
import { initAssetPanel, assetPanel } from './assetpanel.js';

// ── Chat ──
import { initChat, isTalking, updateSpeechBubbleFrame, addMessage, sendMessage } from './chat.js';

import { hideLightProps } from './lights.js';

// ── Multiplayer ──
import { connectWS, lerpRemoteCursors, sendCursorUpdate, updateMyDisplayName } from './multiplayer.js';

// ── Dev Panel ──
import { initDevPanel, updateDevPanel } from './devpanel.js';

// ── VR ──
import { initVRExperience, updateVRExperience } from './vr.js';

// ── Init ──────────────────────────────────────────────────
const clock = new THREE.Clock();

initScene();
initGallery();   // white-cube hall: master floor, walls, moon-gate, plinths, vitrines
const gardenGroup = initGarden();  // literati garden beyond the moon-gate (z < -12)
createHumanoid();

// ── Register the default scene items so they appear (and are deletable) in the
// "Defaults" folder of the Scene Items panel. Garden is lifted out of galleryGroup so
// Gallery and Garden are independent, separately-deletable items (both groups are at
// identity, so reparenting to scene preserves their world placement). ──
scene.add(gardenGroup);
function registerDefaultItem(name, icon, object, kind) {
  if (!object) return;
  object.userData.displayName = name;
  if (!object.userData.id) object.userData.id = genId();
  defaultItems.push({ id: object.userData.id, name, icon, object, parent: object.parent, kind });
}
registerDefaultItem('Gallery',      '\u{1F3DB}️', galleryGroup);            // 🏛️
registerDefaultItem('Garden',       '\u{1F33F}',        gardenGroup);            // 🌿
registerDefaultItem('Robot Docent', '\u{1F916}',        humanoid, 'docent');     // 🤖

initDefaultLights();
registerDefaultLightsForEnv(ambientLight, dirLight, hemisphereLight);
// Boot in Gallery Daylight: single-source exposure/hemi/dir through the preset.
// preset[0] is value-identical to initDefaultLights, so there's zero visual jump.
applyEnvPreset(envPresets[envIndex]);

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

    const urlToFile = buildZipFileMap(importedObjects);
    await Promise.all(Object.entries(urlToFile).map(async ([url, zipPath]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        zip.file(zipPath, await res.arrayBuffer());
      } catch (e) {
        console.warn('[Export GLB] skipping', zipPath, e.message);
      }
    }));

    const objects = importedObjects.map(obj => ({
      file:       urlToFile[obj.userData.url || ''] || '',
      name:       obj.userData.displayName || '',
      image:      obj.userData.isImage || undefined,
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

const xrStatus = document.getElementById('xr-status');
const localhostHosts = new Set(['localhost', '127.0.0.1']);
const nameToggleBtn = document.getElementById('name-toggle-btn');
const namePanel = document.getElementById('name-panel');
const displayNameInput = document.getElementById('display-name-input');
const displayNameSaveBtn = document.getElementById('display-name-save-btn');

displayNameInput.value = myName;

function setNamePanelOpen(open) {
  namePanel.classList.toggle('hidden', !open);
  nameToggleBtn.classList.toggle('active', open);
  if (open) {
    displayNameInput.focus();
    displayNameInput.select();
  }
}

function saveDisplayName() {
  const updated = updateMyDisplayName(displayNameInput.value);
  displayNameInput.value = updated;
  addMessage('Display name updated to ' + updated, 'system');
  setNamePanelOpen(false);
}

nameToggleBtn.addEventListener('click', () => {
  setNamePanelOpen(namePanel.classList.contains('hidden'));
});

displayNameSaveBtn.addEventListener('click', saveDisplayName);
displayNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveDisplayName();
  } else if (e.key === 'Escape') {
    setNamePanelOpen(false);
  }
});

document.addEventListener('pointerdown', (e) => {
  if (namePanel.classList.contains('hidden')) return;
  if (namePanel.contains(e.target) || nameToggleBtn.contains(e.target)) return;
  setNamePanelOpen(false);
});

function setXRStatus(text, tone = '') {
  if (!xrStatus) return;
  xrStatus.textContent = text;
  xrStatus.classList.remove('xr-ready', 'xr-warn', 'xr-error');
  if (tone) xrStatus.classList.add(tone);
}

function updateXRAvailabilityStatus() {
  const requiresHttps = !window.isSecureContext && !localhostHosts.has(location.hostname);
  if (requiresHttps) {
    setXRStatus(`XR: HTTPS required on headset. Open https://${location.host}`, 'xr-warn');
    return;
  }

  if (!navigator.xr) {
    setXRStatus('XR: WebXR unavailable in this browser.', 'xr-error');
    return;
  }

  navigator.xr.isSessionSupported('immersive-vr')
    .then((supported) => {
      if (supported) {
        setXRStatus('XR: VR mode ready.', 'xr-ready');
      } else {
        setXRStatus('XR: immersive VR unavailable on this device.', 'xr-error');
      }
    })
    .catch(() => {
      setXRStatus('XR: could not query WebXR support.', 'xr-error');
    });
}

function initWebXR() {
  initVRExperience({
    orbitControls,
    tControls,
    setXRStatus,
    refreshXRStatus: updateXRAvailabilityStatus,
    chat: { sendMessage },
  });

  updateXRAvailabilityStatus();
}

initWebXR();

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
    async () => {
      characterResetBtn.style.display = '';
      addMessage('Mixamo character loaded: ' + safeName, 'system');
      try {
        const formData = new FormData();
        formData.append('file', new Blob([buf], { type: 'model/gltf-binary' }), safeName);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
          wsSend({ type: 'character_set', character: { url: data.url, name: safeName } });
        } else {
          addMessage(data.error || 'Character sync upload failed.', 'system');
        }
      } catch (err) {
        addMessage('Character sync upload failed: ' + (err.message || 'unknown error'), 'system');
      }
    },
    (err) => {
      addMessage('Failed to load character: ' + (err.message || 'unknown error'), 'system');
    }
  );
});
characterResetBtn.addEventListener('click', () => {
  clearMixamoModel();
  characterResetBtn.style.display = 'none';
  wsSend({ type: 'character_clear' });
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
  const delta = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  animateHumanoid(t, isTalking);
  updateGarden(t);

  if (!renderer.xr.isPresenting) {
    updateFlyControls(delta);
    // OrbitControls.update() ignores the `enabled` flag in three r163 (enabled only
    // gates its input listeners), so calling it every frame would run lookAt(target)
    // on top of the flycam — clobbering mouse-look and snapping the camera back toward
    // the stale orbit pivot. Skip it whenever OrbitControls is off (flycam or gizmo drag).
    if (orbitControls.enabled) orbitControls.update();
  }
  updateSpeechBubbleFrame();
  updateVRExperience(delta);

  sendCursorUpdate();
  lerpRemoteCursors();

  updateDevPanel();
  updatePolyWarning();

  renderer.render(scene, camera);
});
