/**
 * controls.js — OrbitControls, TransformControls, snap-to-grid, keyboard shortcuts.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { camera, renderer, scene, importedObjects, userLights, selectedObject, setSelectedObject, wsSend } from './state.js';
import { showLightProps, hideLightProps } from './lights.js';
import { refreshAssetPanel } from './assetpanel.js';
import { pushUndo, performUndo, performRedo } from './undo.js';

// ── OrbitControls ──
export const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, 1.4, 0);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.minDistance = 0.5;
orbitControls.maxDistance = Infinity;
orbitControls.maxPolarAngle = Math.PI / 2 + 0.1;
// Reserve the RIGHT mouse button for the Unreal-style flycam (below); OrbitControls
// keeps LEFT = orbit, wheel = zoom, MIDDLE = pan.
orbitControls.mouseButtons.RIGHT = null;
orbitControls.update();

// ── TransformControls ──
export const tControls = new TransformControls(camera, renderer.domElement);
tControls.setSize(0.75);
scene.add(tControls);

let tDragging = false;
let tDragBefore = null;
let scaleLockStart = null;   // object's scale captured at drag start (for Shift aspect-lock)

// Track Shift so a single-axis scale drag can lock aspect ratio (uniform scaling).
let shiftDown = false;
addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
addEventListener('keyup',   (e) => { if (e.key === 'Shift') shiftDown = false; });

tControls.addEventListener('dragging-changed', (e) => {
  orbitControls.enabled = !e.value;
  tDragging = e.value;
  if (!e.value) scaleLockStart = null;
  if (e.value && selectedObject) {
    tDragBefore = {
      position: selectedObject.position.toArray(),
      quaternion: selectedObject.quaternion.toArray(),
      scale: selectedObject.scale.toArray(),
    };
    scaleLockStart = selectedObject.scale.clone();
  }
  if (!e.value && selectedObject) {
    if (tDragBefore) {
      pushUndo({
        type: 'transform',
        id: selectedObject.userData.id || selectedObject.userData.lightInfo?.id,
        before: tDragBefore,
        after: {
          position: selectedObject.position.toArray(),
          quaternion: selectedObject.quaternion.toArray(),
          scale: selectedObject.scale.toArray(),
        },
      });
      tDragBefore = null;
    }
    if (selectedObject.userData.lightInfo) {
      const li = selectedObject.userData.lightInfo;
      wsSend({ type: 'light_update', id: li.id,
        color: '#' + li.light.color.getHexString(),
        intensity: li.light.intensity,
        position: li.light.position.toArray(),
      });
    } else if (selectedObject.userData.id) {
      wsSend({ type: 'object_transform', id: selectedObject.userData.id,
        position: selectedObject.position.toArray(),
        quaternion: selectedObject.quaternion.toArray(),
        scale: selectedObject.scale.toArray(),
      });
    }
  }
});

tControls.addEventListener('objectChange', () => {
  const obj = tControls.object;
  if (!obj) return;

  // Shift while scaling → lock aspect ratio (uniform scale) no matter which handle
  // is grabbed: take the axis with the largest proportional change since drag start
  // and apply that factor to all three axes. Works for the single-axis (X/Y/Z),
  // plane (XY/YZ/XZ) and centre (XYZ) handles alike.
  // Image planes carry userData.lockAspect so resizing ALWAYS keeps the picture's ratio
  // (no Shift needed); holding Shift opts any other object into the same uniform-scale lock.
  if ((shiftDown || obj.userData.lockAspect) && tControls.mode === 'scale' && scaleLockStart) {
    let ratio = null, best = -1;
    for (const c of ['x', 'y', 'z']) {
      if (scaleLockStart[c] === 0) continue;
      const r = obj.scale[c] / scaleLockStart[c];
      if (r <= 0) continue;                 // skip mirrored axes — never propagate a flip to all 3
      const change = Math.abs(Math.log(r)); // perceptually symmetric: 2× and 0.5× weigh equally
      if (change > best) { best = change; ratio = r; }
    }
    if (ratio !== null) {
      obj.scale.set(scaleLockStart.x * ratio, scaleLockStart.y * ratio, scaleLockStart.z * ratio);
    }
  }

  if (obj.userData.lightInfo) {
    const li = obj.userData.lightInfo;
    li.light.position.copy(obj.position);
    if (li.helper) li.helper.update();
  }
});

// ── Selection helpers ──
export function selectObject(obj) {
  setSelectedObject(obj);
  tControls.attach(obj);
  if (obj.userData.lightInfo) showLightProps(obj.userData.lightInfo);
  else hideLightProps();
  refreshAssetPanel();
}

export function deselectAll() {
  setSelectedObject(null);
  tControls.detach();
  hideLightProps();
  refreshAssetPanel();
}

// Listen for events dispatched by other modules that need deselect/select
document.addEventListener('deselect-all', deselectAll);
document.addEventListener('select-object', (e) => selectObject(e.detail));

// ── Click-to-select (desktop raycasting) ──
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerStart = null;

export function collectAllMeshes() {
  const meshes = [];
  importedObjects.forEach(o => o.traverse(c => { if (c.isMesh) meshes.push(c); }));
  userLights.forEach(li => meshes.push(li.handle));
  return meshes;
}

export function findSelectableRoot(obj) {
  for (const li of userLights) {
    if (li.handle === obj) return li.handle;
  }
  let t = obj;
  while (t) {
    if (importedObjects.includes(t)) return t;
    t = t.parent;
  }
  return null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerStart = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button === 2) return;            // right-button = fly-look, never select
  if (tDragging || !pointerStart) return;
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  if (dx * dx + dy * dy > 25) return;

  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(collectAllMeshes(), true);
  if (hits.length > 0) {
    const root = findSelectableRoot(hits[0].object);
    if (root) selectObject(root);
  } else {
    deselectAll();
  }
});

// ── Transform mode buttons ──
const modeButtons = document.querySelectorAll('.mode-btn');
modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tControls.setMode(btn.dataset.mode);
  });
});

// ── Snap-to-grid ──
let snapEnabled = false;
const SNAP_SIZE = 0.5;
const snapBtn = document.getElementById('snap-btn');

function updateSnap() {
  if (snapEnabled) {
    tControls.setTranslationSnap(SNAP_SIZE);
    tControls.setRotationSnap(Math.PI / 12);
    tControls.setScaleSnap(0.1);
  } else {
    tControls.setTranslationSnap(null);
    tControls.setRotationSnap(null);
    tControls.setScaleSnap(null);
  }
}

snapBtn.addEventListener('click', () => {
  snapEnabled = !snapEnabled;
  snapBtn.classList.toggle('active', snapEnabled);
  updateSnap();
});

// ── Unreal-style WASDQE flycam (hold RIGHT mouse to look + move; desktop only) ──
// Hold the RIGHT mouse button to enter the flycam: the mouse looks around (yaw +
// pitch), W/S fly along the view direction, A/D strafe horizontally, Q/E drop/rise
// on the world axis, the wheel tunes speed, Shift sprints and Ctrl/Alt creeps.
// Movement is pure free-fly — it passes straight through walls and objects (NO
// collision), exactly like the Unreal editor viewport. Gated behind RMB so it never
// clashes with the single-key T/R/S/D/G shortcuts.
const flyKeys = new Set();
let flying = false;
let flySkipNextMove = false;   // swallow the first mouse delta after pointer lock engages (entry warp)
// Base cruise speed (m/s), tuned to the world: the gallery nave is ~18 m deep and the
// whole walkable plane is 34×46 m, so ~7 m/s crosses the hall in a couple of seconds
// and Shift-sprint (×4) spans the full world quickly. Wheel-adjustable while flying.
let flySpeed = 7;
const FLY_MIN_SPEED  = 0.5;
const FLY_MAX_SPEED  = 80;
const FLY_SPRINT     = 4;            // Shift — fast traversal
const FLY_CREEP      = 0.25;         // Ctrl / Alt — fine positioning
const FLY_LOOK_SENS  = 0.0022;       // radians per pixel of mouse movement
const FLY_LOOK_CLAMP = 120;          // px/event cap — guards against pointer-lock warp spikes
const FLY_PITCH_LIMIT = Math.PI / 2 - 0.02;
const FLY_MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
const _flyEuler   = new THREE.Euler(0, 0, 0, 'YXZ');
const _flyFwd     = new THREE.Vector3();
const _flyRight   = new THREE.Vector3();
const _flyMove    = new THREE.Vector3();
const _flyWorldUp = new THREE.Vector3(0, 1, 0);
const _flyCanvas  = renderer.domElement;

_flyCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

function startFly() {
  if (flying) return;
  flying = true;
  flySkipNextMove = true;             // ignore the entry warp (also covers the unlocked fallback)
  orbitControls.enabled = false;
  tControls.enabled = false;          // don't let the transform gizmo grab the fly-look drag
  _flyCanvas.style.cursor = 'none';
  // Pointer Lock gives relative mouse deltas + unlimited turning (no screen-edge
  // stall) and hides the cursor — the true FPS/Unreal feel. It's optional: if the
  // request fails the pointermove handler still reads movementX/Y, just edge-limited.
  if (_flyCanvas.requestPointerLock) {
    try { _flyCanvas.requestPointerLock(); } catch (_) { /* fall back to unlocked look */ }
  }
}

function endFly() {
  if (!flying) return;
  flying = false;
  flyKeys.clear();
  tControls.enabled = true;
  _flyCanvas.style.cursor = '';
  if (document.pointerLockElement === _flyCanvas) document.exitPointerLock?.();
  // Re-anchor the orbit target a few metres ahead so orbiting resumes naturally
  // from the new camera pose (no view jump — target sits on the current forward ray).
  camera.getWorldDirection(_flyFwd);
  orbitControls.target.copy(camera.position).addScaledVector(_flyFwd, 3);
  orbitControls.enabled = true;
  orbitControls.update();
}

// Listen on window in the CAPTURE phase so we disable OrbitControls before the event
// reaches the canvas (where OrbitControls' own pointerdown lives) — otherwise it would
// grab the right button and pan against the flycam. Only fires for RMB on the 3D canvas.
window.addEventListener('pointerdown', (e) => {
  if (e.button !== 2 || renderer.xr.isPresenting) return;
  if (e.target !== _flyCanvas) return;
  startFly();
  // Capture the pointer so the matching pointerup/pointercancel is guaranteed to reach
  // us even if the cursor strays over browser chrome or another element — without this a
  // release outside the canvas (in the unlocked fallback) could leave the flycam stuck on.
  try { _flyCanvas.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }
}, true);

addEventListener('pointerup', (e) => { if (e.button === 2) endFly(); });
// Losing/cancelling the capture means the gesture is over — BUT pointer lock can release
// the implicit capture when it engages, so ignore that case (lock is now driving input)
// to avoid killing the fly on its first frame.
addEventListener('pointercancel', () => { if (document.pointerLockElement !== _flyCanvas) endFly(); });
_flyCanvas.addEventListener('lostpointercapture', () => { if (document.pointerLockElement !== _flyCanvas) endFly(); });
// Clear sticky Shift on focus loss too: a Shift keyup can be missed during blur/alt-tab,
// which would otherwise force the next scale drag into uniform aspect-lock.
addEventListener('blur', () => { shiftDown = false; endFly(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { shiftDown = false; endFly(); } });

// Keep pointer-lock state and the flycam in sync.
document.addEventListener('pointerlockchange', () => {
  shiftDown = false;
  if (document.pointerLockElement === _flyCanvas) {
    // Lock engaged. A fast RMB tap can end the fly before the async lock arrives — if so,
    // release it now so we never strand a hidden, captured cursor. Otherwise swallow the
    // one-frame warp delta the browser emits on entry.
    if (!flying) document.exitPointerLock?.();
    else flySkipNextMove = true;
  } else if (flying) {
    endFly();   // user dropped lock (e.g. pressed Esc) while still holding RMB
  }
});

addEventListener('pointermove', (e) => {
  if (!flying) return;
  if (flySkipNextMove) { flySkipNextMove = false; return; }   // drop the pointer-lock entry warp
  const mx = THREE.MathUtils.clamp(e.movementX || 0, -FLY_LOOK_CLAMP, FLY_LOOK_CLAMP);
  const my = THREE.MathUtils.clamp(e.movementY || 0, -FLY_LOOK_CLAMP, FLY_LOOK_CLAMP);
  _flyEuler.setFromQuaternion(camera.quaternion);
  _flyEuler.y -= mx * FLY_LOOK_SENS;
  _flyEuler.x -= my * FLY_LOOK_SENS;
  _flyEuler.x = Math.max(-FLY_PITCH_LIMIT, Math.min(FLY_PITCH_LIMIT, _flyEuler.x));
  _flyEuler.z = 0;                      // never roll
  camera.quaternion.setFromEuler(_flyEuler);
});

addEventListener('keydown', (e) => {
  if (!flying) return;
  // Movement keys belong to the flycam while RMB is held — swallow them so they
  // neither scroll the page nor fire editor shortcuts.
  if (FLY_MOVE_CODES.has(e.code)) e.preventDefault();
  flyKeys.add(e.code);
});
addEventListener('keyup', (e) => { flyKeys.delete(e.code); });
addEventListener('wheel', (e) => {
  if (!flying) return;
  e.preventDefault();                  // tune speed instead of scrolling / orbit-zooming
  flySpeed = THREE.MathUtils.clamp(flySpeed * (e.deltaY < 0 ? 1.12 : 0.89), FLY_MIN_SPEED, FLY_MAX_SPEED);
}, { passive: false });

// Called every frame from main.js (desktop only). Pure free-fly: there is no collision
// test, so W drives straight through walls and objects like the Unreal viewport.
export function updateFlyControls(delta) {
  if (!flying || renderer.xr.isPresenting) return;
  let mult = 1;
  if (flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight')) mult *= FLY_SPRINT;
  if (flyKeys.has('ControlLeft') || flyKeys.has('ControlRight') ||
      flyKeys.has('AltLeft') || flyKeys.has('AltRight')) mult *= FLY_CREEP;
  const step = flySpeed * mult * delta;

  camera.getWorldDirection(_flyFwd);                        // full view dir (includes pitch)
  _flyRight.crossVectors(_flyFwd, _flyWorldUp).normalize(); // horizontal strafe axis (A/D)
  _flyMove.set(0, 0, 0);
  if (flyKeys.has('KeyW')) _flyMove.add(_flyFwd);
  if (flyKeys.has('KeyS')) _flyMove.sub(_flyFwd);
  if (flyKeys.has('KeyD')) _flyMove.add(_flyRight);
  if (flyKeys.has('KeyA')) _flyMove.sub(_flyRight);
  if (flyKeys.has('KeyE')) _flyMove.add(_flyWorldUp);
  if (flyKeys.has('KeyQ')) _flyMove.sub(_flyWorldUp);
  if (_flyMove.lengthSq() > 0) {
    _flyMove.normalize().multiplyScalar(step);
    camera.position.add(_flyMove);
  }
  // Pin the orbit pivot just ahead of the camera every frame while flying. Belt-and-
  // suspenders: even if OrbitControls.update() somehow runs (stale build / future
  // regression), a target on the current forward ray makes its lookAt() a no-op, so a
  // sideways (A/D) or vertical (Q/E) strafe can never be turned into an orbit/pan.
  orbitControls.target.copy(camera.position).addScaledVector(_flyFwd, 3);
}

// ── Keyboard shortcuts ──
export function initKeyboard(deleteSelectedFn, duplicateSelectedFn) {
  const chatInput = document.getElementById('chat-input');

  addEventListener('keydown', (e) => {
    // While flying, every key belongs to the flycam (Ctrl is held for creep, so even
    // Ctrl/Cmd+Z must not fire) — suppress all editor shortcuts up front.
    if (flying) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) performRedo(); else performUndo();
      return;
    }
    if (e.target === chatInput) return;
    switch (e.key) {
      case 't': case 'T':
        tControls.setMode('translate');
        modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'translate'));
        break;
      case 'r':
        if (e.ctrlKey || e.metaKey) break;
        tControls.setMode('rotate');
        modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'rotate'));
        break;
      case 's':
        if (e.ctrlKey || e.metaKey) break;
        tControls.setMode('scale');
        modeButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'scale'));
        break;
      case 'Delete': case 'Backspace':
        if (e.target.tagName === 'INPUT') break;
        deleteSelectedFn(); break;
      case 'd': case 'D':
        if (e.ctrlKey || e.metaKey) break;
        duplicateSelectedFn(); break;
      case 'g': case 'G':
        snapEnabled = !snapEnabled;
        snapBtn.classList.toggle('active', snapEnabled);
        updateSnap();
        break;
    }
  });
}

export { raycaster };
export { tDragging };
