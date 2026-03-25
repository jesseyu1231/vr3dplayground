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
  drawSkyGradient([[0,'#1a1a3e'],[0.4,'#2d2d6e'],[0.7,'#4a4a8a'],[1,'#7a7ab0']]);
  scene.fog = new THREE.FogExp2(0x2d2d6e, 0.02);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(20, 64),
    new THREE.MeshStandardMaterial({ color: 0x3a3a5c, roughness: 0.85, metalness: 0.1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(40, 50, 0x555577, 0x444466);
  grid.position.y = 0.005;
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  scene.add(grid);

  document.getElementById('canvas-container').appendChild(renderer.domElement);
}
