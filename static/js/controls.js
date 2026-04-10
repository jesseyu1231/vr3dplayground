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
orbitControls.update();

// ── TransformControls ──
export const tControls = new TransformControls(camera, renderer.domElement);
tControls.setSize(0.75);
scene.add(tControls);

let tDragging = false;
let tDragBefore = null;

tControls.addEventListener('dragging-changed', (e) => {
  orbitControls.enabled = !e.value;
  tDragging = e.value;
  if (e.value && selectedObject) {
    tDragBefore = {
      position: selectedObject.position.toArray(),
      quaternion: selectedObject.quaternion.toArray(),
      scale: selectedObject.scale.toArray(),
    };
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
  if (obj && obj.userData.lightInfo) {
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

// ── Keyboard shortcuts ──
export function initKeyboard(deleteSelectedFn, duplicateSelectedFn) {
  const chatInput = document.getElementById('chat-input');

  addEventListener('keydown', (e) => {
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
