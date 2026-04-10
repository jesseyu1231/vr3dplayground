/**
 * lights.js — default scene lights, user-added lights, and the light properties panel.
 */
import * as THREE from 'three';
import { scene, userLights, setSelectedObject, selectedObject, wsSend, genId } from './state.js';
import { refreshAssetPanel } from './assetpanel.js';
import { pushUndo } from './undo.js';

// ── Default lights ──
export let ambientLight, dirLight, rimLight, fillLight;
export let defaultLights = [];

export function initDefaultLights() {
  ambientLight = new THREE.AmbientLight(0x6677aa, 0.6);
  scene.add(ambientLight);

  dirLight = new THREE.DirectionalLight(0xffeedd, 1.8);
  dirLight.position.set(5, 8, 4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 20;
  dirLight.shadow.camera.left = -6;
  dirLight.shadow.camera.right = 6;
  dirLight.shadow.camera.top = 6;
  dirLight.shadow.camera.bottom = -6;
  scene.add(dirLight);

  rimLight = new THREE.DirectionalLight(0x8888ff, 0.4);
  rimLight.position.set(-3, 4, -4);
  scene.add(rimLight);

  fillLight = new THREE.PointLight(0xffaa66, 0.3, 10);
  fillLight.position.set(-2, 1, 3);
  scene.add(fillLight);

  defaultLights = [
    { light: ambientLight, name: 'Ambient',    type: 'ambient' },
    { light: dirLight,     name: 'Sun (Dir)',  type: 'directional' },
    { light: rimLight,     name: 'Rim (Dir)',  type: 'directional' },
    { light: fillLight,    name: 'Fill (Point)', type: 'point' },
  ];
}

// ── Light props panel ──
const lightPropsPanel    = document.getElementById('light-props');
const lightColorInput    = document.getElementById('light-color');
const lightIntensityInput = document.getElementById('light-intensity');
const lightIntensityVal  = document.getElementById('light-intensity-val');
export let activeLightInfo = null;

export function showLightProps(info) {
  activeLightInfo = info;
  lightColorInput.value = '#' + info.light.color.getHexString();
  lightIntensityInput.value = info.light.intensity;
  lightIntensityVal.textContent = info.light.intensity.toFixed(1);
  lightPropsPanel.style.display = 'block';
  refreshAssetPanel();
}

export function hideLightProps() {
  activeLightInfo = null;
  lightPropsPanel.style.display = 'none';
}

lightColorInput.addEventListener('input', () => {
  if (!activeLightInfo) return;
  activeLightInfo.light.color.set(lightColorInput.value);
  if (activeLightInfo.handle) activeLightInfo.handle.material.color.set(lightColorInput.value);
  if (activeLightInfo.helper) activeLightInfo.helper.update();
});

lightIntensityInput.addEventListener('input', () => {
  if (!activeLightInfo) return;
  const val = parseFloat(lightIntensityInput.value);
  activeLightInfo.light.intensity = val;
  lightIntensityVal.textContent = val.toFixed(1);
  if (activeLightInfo.helper) activeLightInfo.helper.update();
});

let lightPropTimer = null;
function sendLightPropUpdate() {
  clearTimeout(lightPropTimer);
  lightPropTimer = setTimeout(() => {
    if (activeLightInfo && activeLightInfo.id) {
      wsSend({ type: 'light_update', id: activeLightInfo.id,
        color: '#' + activeLightInfo.light.color.getHexString(),
        intensity: activeLightInfo.light.intensity,
        position: activeLightInfo.light.position.toArray(),
      });
    }
  }, 150);
}
lightColorInput.addEventListener('change', sendLightPropUpdate);
lightIntensityInput.addEventListener('change', sendLightPropUpdate);

document.getElementById('light-delete-btn').addEventListener('click', () => {
  if (!activeLightInfo) return;
  pushUndo({ type: 'light_delete', info: activeLightInfo });
  scene.remove(activeLightInfo.light);
  if (activeLightInfo.helper) scene.remove(activeLightInfo.helper);
  scene.remove(activeLightInfo.handle);
  if (activeLightInfo.light.target) scene.remove(activeLightInfo.light.target);
  const idx = userLights.indexOf(activeLightInfo);
  if (idx !== -1) userLights.splice(idx, 1);
  if (activeLightInfo.id) wsSend({ type: 'light_delete', id: activeLightInfo.id });
  // Deselect via controls module to avoid circular dep — dispatch a custom event
  document.dispatchEvent(new CustomEvent('deselect-all'));
});

// ── User-added lights ──
export function addDirectionalLight(opts = {}) {
  const id = opts.id || genId();
  const light = new THREE.DirectionalLight(
    opts.color ? new THREE.Color(opts.color) : 0xffffff,
    opts.intensity ?? 1.5
  );
  light.position.set(...(opts.position || [3, 5, 3]));
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 15;
  light.shadow.camera.left = -5;
  light.shadow.camera.right = 5;
  light.shadow.camera.top = 5;
  light.shadow.camera.bottom = -5;
  scene.add(light);
  scene.add(light.target);

  const helper = new THREE.DirectionalLightHelper(light, 0.4);
  scene.add(helper);

  const handle = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: opts.color ? new THREE.Color(opts.color) : 0xffaa44, wireframe: true })
  );
  handle.position.copy(light.position);
  const info = { light, helper, handle, type: 'directional', id };
  handle.userData.lightInfo = info;
  handle.userData.id = id;
  scene.add(handle);
  userLights.push(info);

  if (!opts.remote) {
    pushUndo({ type: 'light_add', info });
    document.dispatchEvent(new CustomEvent('select-object', { detail: handle }));
    wsSend({ type: 'light_add', light: {
      id, type: 'directional',
      color: '#' + light.color.getHexString(),
      intensity: light.intensity,
      position: light.position.toArray(),
    }});
  }
  refreshAssetPanel();
}

export function addPointLight(opts = {}) {
  const id = opts.id || genId();
  const light = new THREE.PointLight(
    opts.color ? new THREE.Color(opts.color) : 0xffffff,
    opts.intensity ?? 2, 15
  );
  light.position.set(...(opts.position || [0, 3, 2]));
  light.castShadow = true;
  scene.add(light);

  const helper = new THREE.PointLightHelper(light, 0.2);
  scene.add(helper);

  const handle = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: opts.color ? new THREE.Color(opts.color) : 0xffee44, wireframe: true })
  );
  handle.position.copy(light.position);
  const info = { light, helper, handle, type: 'point', id };
  handle.userData.lightInfo = info;
  handle.userData.id = id;
  scene.add(handle);
  userLights.push(info);

  if (!opts.remote) {
    pushUndo({ type: 'light_add', info });
    document.dispatchEvent(new CustomEvent('select-object', { detail: handle }));
    wsSend({ type: 'light_add', light: {
      id, type: 'point',
      color: '#' + light.color.getHexString(),
      intensity: light.intensity,
      position: light.position.toArray(),
    }});
  }
  refreshAssetPanel();
}

export function initLightButtons() {
  document.getElementById('add-dir-light-btn').addEventListener('click', addDirectionalLight);
  document.getElementById('add-point-light-btn').addEventListener('click', addPointLight);
}
