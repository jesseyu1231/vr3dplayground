/**
 * lights.js — default scene lights, user-added lights, and the light properties panel.
 */
import * as THREE from 'three';
import { scene, userLights, setSelectedObject, selectedObject, wsSend, genId, myRole } from './state.js';
import { refreshAssetPanel } from './assetpanel.js';
import { pushUndo } from './undo.js';
import { PALETTE, DIM } from './tokens.js';

// ── Default lights ──
export let ambientLight, dirLight, rimLight, fillLight, hemisphereLight;
export let defaultLights = [];

export function initDefaultLights() {
  // Warm-white floor-fill ambient — white surfaces bounce, recesses don't crush.
  ambientLight = new THREE.AmbientLight(0xf2efe9, 0.85);
  scene.add(ambientLight);

  // The ONE sun / skylight key — the only shadow-casting light in the scene.
  dirLight = new THREE.DirectionalLight(0xfff4e6, 2.4);
  dirLight.position.set(6, 12, 4); // MUST equal envPresets[0].dirP
  dirLight.castShadow = true;
  // 1536 on Quest (myRole==='viewer'), 2048 on desktop.
  const shadowRes = myRole === 'viewer' ? 1536 : 2048;
  dirLight.shadow.mapSize.set(shadowRes, shadowRes);
  dirLight.shadow.camera.near = DIM.shadowNear;
  dirLight.shadow.camera.far = DIM.shadowFar;
  dirLight.shadow.camera.left = -DIM.shadowOrtho;
  dirLight.shadow.camera.right = DIM.shadowOrtho;
  dirLight.shadow.camera.top = DIM.shadowOrtho;
  dirLight.shadow.camera.bottom = -DIM.shadowOrtho;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.02;
  dirLight.shadow.radius = 4;
  dirLight.target.position.set(...DIM.shadowTarget); // covers walkable z (+5..-12)
  scene.add(dirLight.target);
  scene.add(dirLight);

  // Sky fill — HemisphereLight does 100% of the fill (no env map / scene.environment).
  hemisphereLight = new THREE.HemisphereLight(0xeef1f4, PALETTE.floor, 0.6);
  scene.add(hemisphereLight);

  // Track fill — no shadow.
  rimLight = new THREE.DirectionalLight(0xfcf6ec, 0.55);
  rimLight.position.set(-5, 7, -3);
  rimLight.castShadow = false;
  scene.add(rimLight);

  // Moon-gate glow — the only sanctioned default point light, no shadow.
  fillLight = new THREE.PointLight(0xfff1dc, 0.6, 14, 2);
  fillLight.position.set(0, 2.6, -12);
  fillLight.castShadow = false;
  scene.add(fillLight);

  defaultLights = [
    { light: ambientLight,     name: 'Ambient',         type: 'ambient' },
    { light: dirLight,         name: 'Sun (Dir)',       type: 'directional' },
    { light: hemisphereLight,  name: 'Skylight (Hemi)', type: 'hemisphere' },
    { light: rimLight,         name: 'Rim (Dir)',       type: 'directional' },
    { light: fillLight,        name: 'Fill (Point)',    type: 'point' },
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
  // Only user lights own a `handle`. Default lights ({light,name,type}) have none and
  // must be removed via the Defaults folder — ignore them here, since this path would
  // otherwise remove them through the wrong bookkeeping and break restore/undo.
  if (!activeLightInfo || !activeLightInfo.handle) return;
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
  light.castShadow = false; // protect the one-sun shadow budget
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
  light.castShadow = false; // protect the one-sun shadow budget
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
