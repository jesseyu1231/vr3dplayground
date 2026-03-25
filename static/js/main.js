/**
 * main.js — entry point. Imports all modules, bootstraps the app, runs the render loop.
 */
import * as THREE from 'three';

// ── State (must be first — other modules import from it) ──
import { scene, camera, renderer, selectedObject } from './state.js';

// ── Scene setup ──
import { initScene } from './scene.js';
import { createHumanoid, animateHumanoid } from './humanoid.js';

// ── Lights ──
import { initDefaultLights, initLightButtons, ambientLight, dirLight } from './lights.js';

// ── Environment presets ──
import { initEnvButton, registerDefaultLightsForEnv } from './environment.js';

// ── Controls ──
import { orbitControls, tControls, selectObject, deselectAll, initKeyboard } from './controls.js';

// ── Undo/Redo ──
import { initUndoButtons } from './undo.js';

// ── Assets ──
import { loadGLB, initFileImport, initSceneExportImport, deleteSelected, duplicateSelected } from './assets.js';

// ── Asset Panel ──
import { initAssetPanel, assetPanel } from './assetpanel.js';

// ── Chat ──
import { initChat, isTalking, updateSpeechBubbleFrame } from './chat.js';

// ── VR ──
import {
  initVR, initControllers, initHandPanel, initControllerEvents, initSessionEvents,
  animateVR, updateVRGrab, drawHandPanel, handPanelDirty, setHandPanelDirty,
  quickReplies, quickReplyIndex,
} from './vr.js';
import { hideLightProps } from './lights.js';

// ── Multiplayer ──
import { connectWS, lerpRemoteCursors, sendCursorUpdate } from './multiplayer.js';

// ── Chat (sendMessage needed for quick replies) ──
import { sendMessage } from './chat.js';

// ── Init ──────────────────────────────────────────────────
const clock = new THREE.Clock();

initScene();
createHumanoid();

initDefaultLights();
registerDefaultLightsForEnv(ambientLight, dirLight);

initVR();
initControllers();
initHandPanel();
initControllerEvents();

initUndoButtons();
initLightButtons();
initEnvButton();
initAssetPanel();
initFileImport();
initSceneExportImport();
initChat();

// Delete / Duplicate — wrap so they read current selectedObject
function doDelete() { deleteSelected(selectedObject); }
function doDuplicate() { duplicateSelected(selectedObject); }
document.getElementById('delete-btn').addEventListener('click', doDelete);
document.getElementById('duplicate-btn').addEventListener('click', doDuplicate);

initKeyboard(doDelete, doDuplicate);

initSessionEvents(orbitControls, tControls, assetPanel, hideLightProps);

// Send quick reply from wrist panel
function sendQuickReplyFromPanel() {
  sendMessage(quickReplies[quickReplyIndex]);
}

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

  if (renderer.xr.isPresenting) {
    animateVR(sendQuickReplyFromPanel);
    if (handPanelDirty) { drawHandPanel(); setHandPanelDirty(false); }
  }

  updateVRGrab();

  if (!renderer.xr.isPresenting) {
    orbitControls.update();
    updateSpeechBubbleFrame();
  }

  sendCursorUpdate();
  lerpRemoteCursors();

  renderer.render(scene, camera);
});
