/**
 * textsprite.js — canvas-based 3D text sprites (used for VR chat panel above humanoid).
 */
import * as THREE from 'three';
import { scene, chatHistory3D } from './state.js';

const MAX_3D_LINES = 6;
let chatSprite3D = null;

export function createTextSprite(text, opts = {}) {
  const fontSize = opts.fontSize || 28;
  const maxWidth = opts.maxWidth || 512;
  const bgColor  = opts.bgColor || 'rgba(15,15,30,0.88)';
  const fgColor  = opts.fgColor || '#e0e0e0';
  const padding  = 20;

  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${fontSize}px 'Segoe UI', sans-serif`;

  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth - padding * 2) {
      if (line) lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (!lines.length) lines.push(' ');

  const lineHeight = fontSize * 1.35;
  c.width = maxWidth;
  c.height = Math.max(lines.length * lineHeight + padding * 2, 60);

  const r = 16;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(c.width - r, 0);
  ctx.quadraticCurveTo(c.width, 0, c.width, r);
  ctx.lineTo(c.width, c.height - r);
  ctx.quadraticCurveTo(c.width, c.height, c.width - r, c.height);
  ctx.lineTo(r, c.height);
  ctx.quadraticCurveTo(0, c.height, 0, c.height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = fgColor;
  ctx.font = `${fontSize}px 'Segoe UI', sans-serif`;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, padding, padding + i * lineHeight));

  const tex    = new THREE.CanvasTexture(c);
  const aspect = c.width / c.height;
  const h = 0.6;
  const mat    = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(h * aspect, h, 1);
  return sprite;
}

export function update3DChatPanel() {
  if (chatSprite3D) {
    scene.remove(chatSprite3D);
    chatSprite3D.material.map.dispose();
    chatSprite3D.material.dispose();
  }
  const recent = chatHistory3D.slice(-MAX_3D_LINES);
  const text = recent.join('\n');
  if (!text) return;
  chatSprite3D = createTextSprite(text, { fontSize: 22, maxWidth: 600, bgColor: 'rgba(10,10,30,0.85)' });
  chatSprite3D.position.set(0, 2.85, 0);
  scene.add(chatSprite3D);
}
