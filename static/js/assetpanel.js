/**
 * assetpanel.js — scene asset panel (objects + lights list), focus-on-object.
 */
import * as THREE from 'three';
import { camera, importedObjects, userLights, defaultItems, selectedObject, scene } from './state.js';
import { orbitControls } from './controls.js';
import { defaultLights, activeLightInfo, showLightProps, hideLightProps } from './lights.js';
import { deleteDocent, restoreDocent, isDocentInScene } from './humanoid.js';
import { pushUndo } from './undo.js';

const assetPanel    = document.getElementById('asset-panel');
const assetPanelBtn = document.getElementById('asset-panel-btn');
const apObjectsList = document.getElementById('ap-objects-list');
const apLightsList  = document.getElementById('ap-lights-list');
const apDefaultsFolder = document.getElementById('ap-defaults-folder');
const apCount       = document.getElementById('ap-count');

const lightColorInput     = document.getElementById('light-color');
const lightIntensityInput = document.getElementById('light-intensity');
const lightIntensityVal   = document.getElementById('light-intensity-val');
const lightPropsPanel     = document.getElementById('light-props');

let defaultsFolderOpen = true;   // collapse state for the "Defaults" folder

export function focusOnObject(obj) {
  obj.updateMatrixWorld(true);
  const box  = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);

  // Calculate distance so the object fills ~60% of the view
  const fov = camera.fov * (Math.PI / 180);
  const aspect = camera.aspect;
  const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  const effectiveFov = Math.min(fov, hFov);
  const dist = (maxDim / 2) / Math.tan(effectiveFov / 2) * 1.2;

  const dir = new THREE.Vector3().subVectors(camera.position, orbitControls.target).normalize();
  if (dir.lengthSq() < 0.001) dir.set(0, 0.3, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  orbitControls.target.copy(center);
  orbitControls.update();
}

// ── "Defaults" folder (gallery / garden / docent + default lights) ───────────────
// Delete = remove from scene only (never disposed), so Restore re-adds the very same
// object. Undo is a single 'default_item' action that carries the affected items.

// The docent's visible body may be the procedural humanoid OR a loaded mixamo model,
// so membership + add/remove route through the humanoid API for that item.
function isItemInScene(it) {
  return it.kind === 'docent' ? isDocentInScene() : it.object.parent !== null;
}
function removeItem(it) { if (it.kind === 'docent') deleteDocent();  else it.object.removeFromParent(); }
function addItem(it)    { if (it.kind === 'docent') restoreDocent(); else it.parent.add(it.object); }

function deleteDefaultItems(items) {
  const live = items.filter(isItemInScene);
  if (!live.length) return;
  pushUndo({ type: 'default_item', items: live, removed: true });
  live.forEach(removeItem);
  refreshAssetPanel();
}

function restoreDefaultItems(items) {
  const gone = items.filter(it => !isItemInScene(it));
  if (!gone.length) return;
  pushUndo({ type: 'default_item', items: gone, removed: false });
  gone.forEach(addItem);
  refreshAssetPanel();
}

// Folder-level "all" — also toggles the default lights shown inside the folder, as ONE
// undo entry so the whole folder reverts in a single step.
function snapshotLights(lights) {
  return lights.map(dl => ({ dl, color: '#' + dl.light.color.getHexString(), intensity: dl.light.intensity }));
}
function deleteAllDefaults() {
  const liveItems  = defaultItems.filter(isItemInScene);
  const liveLights = defaultLights.filter(dl => dl.light.parent !== null);
  if (!liveItems.length && !liveLights.length) return;
  pushUndo({ type: 'default_bulk', items: liveItems, lights: snapshotLights(liveLights), removed: true });
  liveItems.forEach(removeItem);
  for (const dl of liveLights) scene.remove(dl.light);
  if (activeLightInfo && liveLights.includes(activeLightInfo)) {
    hideLightProps();
    document.dispatchEvent(new CustomEvent('deselect-all'));
  }
  refreshAssetPanel();
}
function restoreAllDefaults() {
  const goneItems  = defaultItems.filter(it => !isItemInScene(it));
  const goneLights = defaultLights.filter(dl => dl.light.parent === null);
  if (!goneItems.length && !goneLights.length) return;
  pushUndo({ type: 'default_bulk', items: goneItems, lights: snapshotLights(goneLights), removed: false });
  goneItems.forEach(addItem);
  for (const dl of goneLights) scene.add(dl.light);
  refreshAssetPanel();
}

function makeDefaultItemRow(item) {
  const inScene = isItemInScene(item);
  const div = document.createElement('div');
  div.className = 'ap-item' + (inScene ? '' : ' removed');
  div.innerHTML =
    `<span class="ap-icon">${item.icon}</span>` +
    `<span class="ap-name" title="${item.name}">${item.name}</span>` +
    `<span class="ap-actions">` +
      (inScene ? `<button class="ap-btn" data-action="focus" title="Focus camera">🔍</button>` : '') +
      (inScene
        ? `<button class="ap-btn" data-action="delete" title="Remove from scene">✖</button>`
        : `<button class="ap-btn" data-action="restore" title="Restore">➕</button>`) +
    `</span>`;
  div.addEventListener('click', (e) => {
    const action = e.target.dataset?.action;
    if (action === 'delete')  { deleteDefaultItems([item]);  return; }
    if (action === 'restore') { restoreDefaultItems([item]); return; }
    if (inScene) focusOnObject(item.object);
  });
  return div;
}

function makeDefaultLightRow(dl) {
  const inScene  = dl.light.parent !== null;
  const colorHex = '#' + dl.light.color.getHexString();
  const isSel    = activeLightInfo === dl;
  const div = document.createElement('div');
  div.className = 'ap-item' + (isSel ? ' selected' : '') + (inScene ? '' : ' removed');
  div.innerHTML = `<span class="ap-icon" style="color:${colorHex}">●</span>` +
    `<span class="ap-name">${dl.name} (${dl.light.intensity.toFixed(1)})</span>` +
    `<span class="ap-actions">` +
    (inScene
      ? `<button class="ap-btn" data-action="delete" title="Remove">✖</button>`
      : `<button class="ap-btn" data-action="restore" title="Restore">➕</button>`) +
    `</span>`;
  div.addEventListener('click', (e) => {
    const action = e.target.dataset?.action;
    if (action === 'delete') {
      pushUndo({ type: 'default_light_remove', dl, intensity: dl.light.intensity, color: '#' + dl.light.color.getHexString() });
      scene.remove(dl.light);
      if (activeLightInfo === dl) { hideLightProps(); document.dispatchEvent(new CustomEvent('deselect-all')); }
      refreshAssetPanel();
      return;
    }
    if (action === 'restore') {
      pushUndo({ type: 'default_light_add', dl });
      scene.add(dl.light);
      refreshAssetPanel();
      return;
    }
    if (inScene) {
      showLightProps(dl);
      // dl has no handle, so also drive the panel inputs directly
      lightColorInput.value = colorHex;
      lightIntensityInput.value = dl.light.intensity;
      lightIntensityVal.textContent = dl.light.intensity.toFixed(1);
      lightPropsPanel.style.display = 'block';
      refreshAssetPanel();
    }
  });
  return div;
}

function renderDefaultsFolder() {
  apDefaultsFolder.innerHTML = '';
  const inSceneCount = defaultItems.filter(isItemInScene).length +
                       defaultLights.filter(dl => dl.light.parent !== null).length;
  const totalCount = defaultItems.length + defaultLights.length;
  const anyInScene = inSceneCount > 0;

  const header = document.createElement('div');
  header.className = 'ap-folder-header';
  header.innerHTML =
    `<span class="ap-folder-chevron">${defaultsFolderOpen ? '▾' : '▸'}</span>` +
    `<span class="ap-icon">📁</span>` +
    `<span class="ap-folder-title">Defaults</span>` +
    `<span class="ap-folder-count">${inSceneCount}/${totalCount}</span>` +
    `<span class="ap-actions">` +
    (anyInScene
      ? `<button class="ap-btn" data-action="delete-all" title="Remove all defaults (items + lights)">✖</button>`
      : `<button class="ap-btn" data-action="restore-all" title="Restore all defaults (items + lights)">➕</button>`) +
    `</span>`;
  header.addEventListener('click', (e) => {
    const action = e.target.dataset?.action;
    if (action === 'delete-all')  { deleteAllDefaults();  return; }
    if (action === 'restore-all') { restoreAllDefaults(); return; }
    defaultsFolderOpen = !defaultsFolderOpen;
    refreshAssetPanel();
  });
  apDefaultsFolder.appendChild(header);

  if (!defaultsFolderOpen) return;

  const children = document.createElement('div');
  children.className = 'ap-folder-children';
  for (const item of defaultItems) children.appendChild(makeDefaultItemRow(item));

  if (defaultLights.length) {
    const sub = document.createElement('div');
    sub.className = 'ap-folder-sublabel';
    sub.textContent = 'Lights';
    children.appendChild(sub);
    for (const dl of defaultLights) children.appendChild(makeDefaultLightRow(dl));
  }
  apDefaultsFolder.appendChild(children);
}

export function refreshAssetPanel() {
  if (assetPanel.style.display !== 'block') return;
  const total = importedObjects.length + userLights.length + defaultLights.length + defaultItems.length;
  apCount.textContent = total + ' item' + (total !== 1 ? 's' : '');

  // Defaults folder
  renderDefaultsFolder();

  // Objects
  apObjectsList.innerHTML = '';
  if (importedObjects.length === 0) {
    apObjectsList.innerHTML = '<div class="ap-empty">No objects yet</div>';
  } else {
    for (const obj of importedObjects) {
      const name  = obj.userData.displayName || obj.name || 'Object';
      const isSel = obj === selectedObject;
      const icon  = obj.userData.isImage ? '🖼️' : '📦';
      const div = document.createElement('div');
      div.className = 'ap-item' + (isSel ? ' selected' : '');
      div.innerHTML = `<span class="ap-icon">${icon}</span><span class="ap-name" title="${name}">${name}</span>` +
        `<span class="ap-actions"><button class="ap-btn" data-action="focus" title="Focus camera">🔍</button></span>`;
      div.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'focus') { focusOnObject(obj); return; }
        document.dispatchEvent(new CustomEvent('select-object', { detail: obj }));
      });
      apObjectsList.appendChild(div);
    }
  }

  // User lights
  apLightsList.innerHTML = '';
  if (userLights.length === 0) {
    apLightsList.innerHTML = '<div class="ap-empty">No user lights</div>';
  } else {
    for (const li of userLights) {
      const name    = li.type === 'directional' ? 'Dir Light' : 'Point Light';
      const isSel   = li.handle === selectedObject;
      const colorHex = '#' + li.light.color.getHexString();
      const div = document.createElement('div');
      div.className = 'ap-item' + (isSel ? ' selected' : '');
      div.innerHTML = `<span class="ap-icon" style="color:${colorHex}">●</span><span class="ap-name">${name} (${li.light.intensity.toFixed(1)})</span>` +
        `<span class="ap-actions"><button class="ap-btn" data-action="focus" title="Focus camera">🔍</button></span>`;
      div.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'focus') { focusOnObject(li.handle); return; }
        document.dispatchEvent(new CustomEvent('select-object', { detail: li.handle }));
      });
      apLightsList.appendChild(div);
    }
  }
}

export function initAssetPanel() {
  assetPanelBtn.addEventListener('click', () => {
    const vis = assetPanel.style.display !== 'block';
    assetPanel.style.display = vis ? 'block' : 'none';
    assetPanelBtn.classList.toggle('active', vis);
    if (vis) refreshAssetPanel();
  });
}

export { assetPanel };
