/**
 * assetpanel.js — scene asset panel (objects + lights list), focus-on-object.
 */
import * as THREE from 'three';
import { camera, importedObjects, userLights, selectedObject } from './state.js';
import { orbitControls } from './controls.js';
import { defaultLights, activeLightInfo, showLightProps, hideLightProps } from './lights.js';
import { pushUndo } from './undo.js';
import { scene } from './state.js';

const assetPanel    = document.getElementById('asset-panel');
const assetPanelBtn = document.getElementById('asset-panel-btn');
const apObjectsList = document.getElementById('ap-objects-list');
const apLightsList  = document.getElementById('ap-lights-list');
const apCount       = document.getElementById('ap-count');

const lightColorInput     = document.getElementById('light-color');
const lightIntensityInput = document.getElementById('light-intensity');
const lightIntensityVal   = document.getElementById('light-intensity-val');
const lightPropsPanel     = document.getElementById('light-props');

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

export function refreshAssetPanel() {
  if (assetPanel.style.display !== 'block') return;
  const total = importedObjects.length + userLights.length + defaultLights.length;
  apCount.textContent = total + ' item' + (total !== 1 ? 's' : '');

  // Objects
  apObjectsList.innerHTML = '';
  if (importedObjects.length === 0) {
    apObjectsList.innerHTML = '<div class="ap-empty">No objects yet</div>';
  } else {
    for (const obj of importedObjects) {
      const name  = obj.userData.displayName || obj.name || 'Object';
      const isSel = obj === selectedObject;
      const div = document.createElement('div');
      div.className = 'ap-item' + (isSel ? ' selected' : '');
      div.innerHTML = `<span class="ap-icon">\ud83d\udce6</span><span class="ap-name" title="${name}">${name}</span>` +
        `<span class="ap-actions"><button class="ap-btn" data-action="focus" title="Focus camera">\ud83d\udd0d</button></span>`;
      div.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'focus') { focusOnObject(obj); return; }
        document.dispatchEvent(new CustomEvent('select-object', { detail: obj }));
      });
      apObjectsList.appendChild(div);
    }
  }

  // Default lights
  const apDefaultLightsList = document.getElementById('ap-default-lights-list');
  apDefaultLightsList.innerHTML = '';
  for (const dl of defaultLights) {
    const inScene  = dl.light.parent !== null;
    const colorHex = '#' + dl.light.color.getHexString();
    const isSel    = activeLightInfo === dl;
    const div = document.createElement('div');
    div.className = 'ap-item' + (isSel ? ' selected' : '');
    div.style.opacity = inScene ? '1' : '0.4';
    div.innerHTML = `<span class="ap-icon" style="color:${colorHex}">\u25cf</span>` +
      `<span class="ap-name">${dl.name} (${dl.light.intensity.toFixed(1)})</span>` +
      `<span class="ap-actions">` +
      (inScene
        ? `<button class="ap-btn" data-action="delete" title="Remove">\u2716</button>`
        : `<button class="ap-btn" data-action="restore" title="Restore">\u2795</button>`) +
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
        // Also update panel inputs directly (dl has no handle)
        lightColorInput.value = colorHex;
        lightIntensityInput.value = dl.light.intensity;
        lightIntensityVal.textContent = dl.light.intensity.toFixed(1);
        lightPropsPanel.style.display = 'block';
        refreshAssetPanel();
      }
    });
    apDefaultLightsList.appendChild(div);
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
      div.innerHTML = `<span class="ap-icon" style="color:${colorHex}">\u25cf</span><span class="ap-name">${name} (${li.light.intensity.toFixed(1)})</span>` +
        `<span class="ap-actions"><button class="ap-btn" data-action="focus" title="Focus camera">\ud83d\udd0d</button></span>`;
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
