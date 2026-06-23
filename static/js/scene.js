/**
 * scene.js — sky gradient, fog, ground plane, grid.
 */
import * as THREE from 'three';
import { scene, renderer } from './state.js';

const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2; skyCanvas.height = 256;
const skyCtx = skyCanvas.getContext('2d');

export function drawSkyGradient(stops) {
  const g = skyCtx.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([pos, col]) => g.addColorStop(pos, col));
  skyCtx.fillStyle = g;
  skyCtx.fillRect(0, 0, 2, 256);
  scene.background = new THREE.CanvasTexture(skyCanvas);
}

export function initScene() {
  // Warm ink-wash overcast sky shared by gallery + garden. Matches env preset[0]
  // ('Gallery Daylight') so there's no flash of the old dark sky before the boot
  // applyEnvPreset() runs in main.js.
  drawSkyGradient([[0,'#E8E4DB'],[0.55,'#EDEAE3'],[1,'#DCD7CC']]);

  // Keep a LIVE FogExp2 at near-zero density. applyEnvPreset() unconditionally
  // writes scene.fog.color / scene.fog.density, so this must never be null.
  scene.fog = new THREE.FogExp2(0xEDEAE3, 0.0008);

  // No ground / grid here: gallery.js lays the single master walkable y=0 plane
  // (indoor + garden) and garden.js overlays the green ground. Keeping the
  // renderer canvas attach — it is load-bearing.
  document.getElementById('canvas-container').appendChild(renderer.domElement);
}
