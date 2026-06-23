/**
 * environment.js — sky/fog/light environment presets.
 */
import { scene, renderer } from './state.js';
import { drawSkyGradient } from './scene.js';
import { pushUndo } from './undo.js';
import { wsSend } from './state.js';
import { PALETTE } from './tokens.js';

// All 4 presets keep the identical shape (load-bearing indices for multiplayer/undo/
// saved-scene restore). hemiSky/hemiGround/hemiI exist on ALL 4 (no undefined → .setHex
// throws). preset[0] EXACTLY matches initDefaultLights so there's zero visual jump on the
// first Env click. Fog hex stays in the warm-white 0xEDEAE3 interior family; dirP keeps the
// gallery inside the fixed ±9 sun frustum for every preset (no low raking angles).
export const envPresets = [
  { name: 'Gallery Daylight',    sky:[[0,'#E8E4DB'],[0.55,'#EDEAE3'],[1,'#DCD7CC']], fog:0xEDEAE3, fogD:0.0008, ambC:0xf2efe9, ambI:0.85, dirC:0xfff4e6, dirI:2.4, dirP:[6,12,4], exp:1.05, hemiSky:0xeef1f4, hemiGround:0xD8D2C7, hemiI:0.6 },
  { name: 'Warm Gallery',        sky:[[0,'#EAE5DA'],[0.55,'#EDEAE3'],[1,'#E0D9CA']], fog:0xEDE7DA, fogD:0.0008, ambC:0xf3ece0, ambI:0.8,  dirC:0xfff0d8, dirI:2.3, dirP:[5,11,4], exp:1.0,  hemiSky:0xf0ece2, hemiGround:0xDCCEB8, hemiI:0.55 },
  { name: 'Golden Hour Garden',  sky:[[0,'#EFE6D2'],[0.55,'#EDEAE3'],[1,'#E2D6BE']], fog:0xEEE6D6, fogD:0.002,  ambC:0xf4ecdc, ambI:0.78, dirC:0xffe6b8, dirI:2.5, dirP:[8,7,5],  exp:1.05, hemiSky:0xf2e8d2, hemiGround:0xCDB78E, hemiI:0.5  },
  { name: 'Evening',             sky:[[0,'#DED7C8'],[0.55,'#E5DECF'],[1,'#CFC6B4']], fog:0xE6DFCE, fogD:0.004,  ambC:0xece4d6, ambI:0.6,  dirC:0xf2dcc0, dirI:1.6, dirP:[3,8,3],  exp:0.85, hemiSky:0xe4ddcc, hemiGround:0xC4BAA6, hemiI:0.45 },
];

export let envIndex = 0;
export function setEnvIndex(i) { envIndex = i; }

// References to the default scene lights — set by main.js after init
let _ambientLight, _dirLight, _hemiLight;
export function registerDefaultLightsForEnv(ambient, dir, hemi) {
  _ambientLight = ambient;
  _dirLight = dir;
  _hemiLight = hemi; // optional 3rd param
}

export function applyEnvPreset(p) {
  drawSkyGradient(p.sky);
  scene.fog.color.setHex(p.fog);
  scene.fog.density = p.fogD;
  if (_ambientLight) { _ambientLight.color.setHex(p.ambC); _ambientLight.intensity = p.ambI; }
  if (_dirLight)     { _dirLight.color.setHex(p.dirC); _dirLight.intensity = p.dirI; _dirLight.position.set(...p.dirP); }
  if (_hemiLight)    { _hemiLight.color.setHex(p.hemiSky); _hemiLight.groundColor.setHex(p.hemiGround); _hemiLight.intensity = p.hemiI; }
  renderer.toneMappingExposure = p.exp;
}

export function initEnvButton() {
  document.getElementById('env-btn').addEventListener('click', () => {
    const oldIndex = envIndex;
    envIndex = (envIndex + 1) % envPresets.length;
    applyEnvPreset(envPresets[envIndex]);
    document.getElementById('env-btn').textContent = '\u2600 ' + envPresets[envIndex].name;
    pushUndo({ type: 'env_change', oldIndex, newIndex: envIndex });
    wsSend({ type: 'env_change', envIndex });
  });
}
