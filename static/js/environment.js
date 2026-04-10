/**
 * environment.js — sky/fog/light environment presets.
 */
import { scene, renderer } from './state.js';
import { drawSkyGradient } from './scene.js';
import { pushUndo } from './undo.js';
import { wsSend } from './state.js';

export const envPresets = [
  { name: 'Default', sky:[[0,'#1a1a3e'],[0.4,'#2d2d6e'],[0.7,'#4a4a8a'],[1,'#7a7ab0']], fog:0x2d2d6e, fogD:0.02, ambC:0x6677aa, ambI:0.6, dirC:0xffeedd, dirI:1.8, dirP:[5,8,4], exp:1.1 },
  { name: 'Day',     sky:[[0,'#4a90d9'],[0.3,'#6ab0f0'],[0.6,'#87ceeb'],[1,'#b0e0ff']], fog:0x87ceeb, fogD:0.008, ambC:0xaabbdd, ambI:0.8, dirC:0xffffff, dirI:2.2, dirP:[3,12,5], exp:1.3 },
  { name: 'Sunset',  sky:[[0,'#1a1a3e'],[0.3,'#8b3a62'],[0.6,'#d4756b'],[0.85,'#f0a050'],[1,'#f0c878']], fog:0xd4756b, fogD:0.015, ambC:0xaa7755, ambI:0.5, dirC:0xffaa66, dirI:1.6, dirP:[0,3,8], exp:1.0 },
  { name: 'Night',   sky:[[0,'#050510'],[0.4,'#0a0a20'],[0.7,'#101030'],[1,'#151540']], fog:0x0a0a20, fogD:0.03, ambC:0x223344, ambI:0.3, dirC:0x8888cc, dirI:0.6, dirP:[2,6,3], exp:0.7 },
];

export let envIndex = 0;
export function setEnvIndex(i) { envIndex = i; }

// References to the default scene lights — set by lights.js after init
let _ambientLight, _dirLight;
export function registerDefaultLightsForEnv(ambient, dir) {
  _ambientLight = ambient;
  _dirLight = dir;
}

export function applyEnvPreset(p) {
  drawSkyGradient(p.sky);
  scene.fog.color.setHex(p.fog);
  scene.fog.density = p.fogD;
  if (_ambientLight) { _ambientLight.color.setHex(p.ambC); _ambientLight.intensity = p.ambI; }
  if (_dirLight)     { _dirLight.color.setHex(p.dirC); _dirLight.intensity = p.dirI; _dirLight.position.set(...p.dirP); }
  renderer.toneMappingExposure = p.exp;
}

export function initEnvButton() {
  document.getElementById('env-btn').addEventListener('click', () => {
    const oldIndex = envIndex;
    envIndex = (envIndex + 1) % envPresets.length;
    applyEnvPreset(envPresets[envIndex]);
    document.getElementById('env-btn').textContent = '\ud83c\udf05 ' + envPresets[envIndex].name;
    pushUndo({ type: 'env_change', oldIndex, newIndex: envIndex });
    wsSend({ type: 'env_change', envIndex });
  });
}
