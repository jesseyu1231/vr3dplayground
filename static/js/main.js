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

  renderer.render(scene, camera);
});
