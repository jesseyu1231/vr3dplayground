/**
 * vrui.js — In-VR 3D widgets:
 *   • WristPanel  — canvas-textured panel anchored to the left controller.
 *   • Keyboard    — world-space QWERTY clickable with the right controller laser.
 *   • PointerRay  — laser + cursor dot for the right controller.
 */
import * as THREE from 'three';

// ────────────────────────────────────────────────────────────────────────────
// WristPanel
// ────────────────────────────────────────────────────────────────────────────

const PANEL_W_PX = 512;
const PANEL_H_PX = 768;
const PANEL_W_M  = 0.26;
const PANEL_H_M  = PANEL_W_M * (PANEL_H_PX / PANEL_W_PX);

const BTN = {
  mic:      { x:  24, y: 632, w: 140, h: 100, label: 'Mic' },
  keyboard: { x: 186, y: 632, w: 140, h: 100, label: 'Keys' },
  send:     { x: 348, y: 632, w: 140, h: 100, label: 'Send' },
  scrollUp:   { x: 446, y:  96, w: 46, h: 96, label: '▲' },
  scrollDown: { x: 446, y: 372, w: 46, h: 96, label: '▼' },
};

const CHAT_X = 28;
const CHAT_RIGHT = 436;          // leave room for scroll column at x=446
const CHAT_TOP = 96;
const CHAT_BOTTOM = 480;
const CHAT_LINE_H = 26;
const CHAT_FONT = '20px sans-serif';

export class WristPanel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width  = PANEL_W_PX;
    this.canvas.height = PANEL_H_PX;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, side: THREE.DoubleSide, depthTest: true,
    });
    const geo = new THREE.PlaneGeometry(PANEL_W_M, PANEL_H_M);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'VR-WristPanel';
    this.mesh.userData.uiKind = 'wrist-panel';
    // Final pose is set per-frame by vr.js (anchored to the left grip,
    // billboarded toward the camera). Keep local transform at identity.

    this.state = {
      history: [],
      inputText: '',
      status: 'Press Keys to type, Mic to speak.',
      micActive: false,
      keyboardVisible: false,
      hoverButton: null,
      sendBusy: false,
      scrollOffset: 0,         // lines scrolled up from bottom
      stickToBottom: true,     // auto-scroll to newest until user scrolls up
    };
    this._wrappedCache = { historyRef: null, lines: [] };
    this._dirty = true;
  }

  hitButton(uv) {
    const x = uv.x * PANEL_W_PX;
    const y = (1 - uv.y) * PANEL_H_PX;
    for (const [name, b] of Object.entries(BTN)) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return name;
    }
    return null;
  }

  setHistory(lines) {
    const next = lines.slice(-30);
    const grew = next.length > this.state.history.length
      || (next.length && this.state.history.length
          && next[next.length - 1] !== this.state.history[this.state.history.length - 1]);
    this.state.history = next;
    this._wrappedCache.historyRef = null;
    if (grew && this.state.stickToBottom) this.state.scrollOffset = 0;
    this._dirty = true;
  }

  scrollBy(lines) {
    const total = this._countWrappedLines();
    const visible = this._visibleLineCount();
    const max = Math.max(0, total - visible);
    const next = Math.min(max, Math.max(0, this.state.scrollOffset + lines));
    if (next === this.state.scrollOffset) return;
    this.state.scrollOffset = next;
    this.state.stickToBottom = (next === 0);
    this._dirty = true;
  }

  _visibleLineCount() {
    return Math.floor((CHAT_BOTTOM - CHAT_TOP) / CHAT_LINE_H);
  }

  _countWrappedLines() {
    this._buildWrappedLines();
    return this._wrappedCache.lines.length;
  }

  _buildWrappedLines() {
    if (this._wrappedCache.historyRef === this.state.history) return this._wrappedCache.lines;
    const ctx = this.ctx;
    ctx.font = CHAT_FONT;
    const out = [];
    const wrapW = CHAT_RIGHT - CHAT_X;
    for (let i = 0; i < this.state.history.length; i++) {
      const msg = this.state.history[i];
      const color = msg.startsWith('You:') ? '#7eb8ff'
                  : msg.startsWith('AI:')  ? '#b8ffb8'
                  : '#ffd27e';
      for (const line of wrapText(ctx, msg, wrapW)) out.push({ text: line, color });
      if (i < this.state.history.length - 1) out.push({ text: '', color: null });
    }
    this._wrappedCache.historyRef = this.state.history;
    this._wrappedCache.lines = out;
    return out;
  }
  setInputText(text)      { this.state.inputText = text; this._dirty = true; }
  appendChar(ch)          { this.state.inputText += ch; this._dirty = true; }
  backspace()             { this.state.inputText = this.state.inputText.slice(0, -1); this._dirty = true; }
  clearInput()            { this.state.inputText = ''; this._dirty = true; }
  setStatus(s)            { this.state.status = s; this._dirty = true; }
  setMicActive(on)        { this.state.micActive = on; this._dirty = true; }
  setKeyboardVisible(on)  { this.state.keyboardVisible = on; this._dirty = true; }
  setSendBusy(on)         { this.state.sendBusy = on; this._dirty = true; }
  setHover(name) {
    if (this.state.hoverButton === name) return;
    this.state.hoverButton = name;
    this._dirty = true;
  }

  redrawIfDirty() {
    if (!this._dirty) return;
    this._dirty = false;
    this._render();
  }

  _render() {
    const ctx = this.ctx;
    const W = PANEL_W_PX, H = PANEL_H_PX;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(15, 15, 28, 0.94)';
    roundRect(ctx, 0, 0, W, H, 22); ctx.fill();
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.45)';
    ctx.lineWidth = 4;
    roundRect(ctx, 2, 2, W - 4, H - 4, 20); ctx.stroke();

    // Title strip
    ctx.fillStyle = 'rgba(74, 124, 255, 0.35)';
    roundRect(ctx, 0, 0, W, 64, 22, /*onlyTop*/ true); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI Minister', 24, 32);

    // Chat history (with scrollable viewport)
    ctx.font = CHAT_FONT;
    const allLines = this._buildWrappedLines();
    const visibleCount = this._visibleLineCount();
    const total = allLines.length;
    const maxOffset = Math.max(0, total - visibleCount);
    if (this.state.scrollOffset > maxOffset) this.state.scrollOffset = maxOffset;
    const end = total - this.state.scrollOffset;
    const start = Math.max(0, end - visibleCount);
    const view = allLines.slice(start, end);

    let y = CHAT_TOP + 4;
    for (const entry of view) {
      if (entry.color === null) { y += Math.floor(CHAT_LINE_H * 0.4); continue; }
      ctx.fillStyle = entry.color;
      ctx.fillText(entry.text, CHAT_X, y);
      y += CHAT_LINE_H;
    }

    // Scroll position indicator (thin track on the right edge of the chat area)
    if (total > visibleCount) {
      const trackX = CHAT_RIGHT + 4;
      const trackY = CHAT_TOP;
      const trackH = CHAT_BOTTOM - CHAT_TOP;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(trackX, trackY, 4, trackH);
      const thumbH = Math.max(20, trackH * (visibleCount / total));
      const thumbY = trackY + ((maxOffset - this.state.scrollOffset) / maxOffset) * (trackH - thumbH);
      ctx.fillStyle = 'rgba(126, 184, 255, 0.7)';
      ctx.fillRect(trackX, thumbY, 4, thumbH);
    }

    // Input box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    roundRect(ctx, 24, 500, W - 48, 110, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.55)';
    ctx.lineWidth = 2;
    roundRect(ctx, 24, 500, W - 48, 110, 14); ctx.stroke();

    ctx.font = '24px sans-serif';
    if (this.state.inputText) {
      ctx.fillStyle = '#fff';
      const wrapped = wrapText(ctx, this.state.inputText + '_', W - 72);
      let iy = 528;
      for (const line of wrapped.slice(-3)) {
        ctx.fillText(line, 36, iy);
        iy += 28;
      }
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillText('Tap Keys or hold Mic to talk\u2026', 36, 528);
    }

    // Buttons
    const scrollable = total > visibleCount;
    const scrollOffset = this.state.scrollOffset;
    for (const [name, b] of Object.entries(BTN)) {
      const isScroll = (name === 'scrollUp' || name === 'scrollDown');
      const isActive = (name === 'mic' && this.state.micActive)
                    || (name === 'keyboard' && this.state.keyboardVisible);
      const isHover  = this.state.hoverButton === name;
      let disabled = name === 'send' && (!this.state.inputText.trim() || this.state.sendBusy);
      if (name === 'scrollUp')   disabled = !scrollable || scrollOffset >= (total - visibleCount);
      if (name === 'scrollDown') disabled = !scrollable || scrollOffset <= 0;

      let bg = 'rgba(255, 255, 255, 0.10)';
      if (isActive) bg = 'rgba(74, 124, 255, 0.7)';
      else if (isHover) bg = 'rgba(255, 255, 255, 0.22)';
      if (disabled) bg = 'rgba(70, 70, 90, 0.45)';

      const radius = isScroll ? 12 : 18;
      ctx.fillStyle = bg;
      roundRect(ctx, b.x, b.y, b.w, b.h, radius); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, b.x, b.y, b.w, b.h, radius); ctx.stroke();

      ctx.fillStyle = disabled ? 'rgba(255, 255, 255, 0.45)' : '#fff';
      ctx.font = isScroll ? 'bold 26px sans-serif' : 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.textAlign = 'left';
    }

    // Status line
    ctx.fillStyle = this.state.micActive ? '#ff9b9b' : 'rgba(255, 255, 255, 0.7)';
    ctx.font = '20px sans-serif';
    ctx.textBaseline = 'middle';
    const status = this.state.status || '';
    const wrapped = wrapText(ctx, status, W - 48);
    let sy = H - 50;
    for (const line of wrapped.slice(0, 2)) {
      ctx.fillText(line, 24, sy);
      sy += 22;
    }

    this.texture.needsUpdate = true;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Virtual keyboard
// ────────────────────────────────────────────────────────────────────────────

const ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l','?'],
  ['z','x','c','v','b','n','m',',','.','!'],
];
const SPECIAL = [
  { label: 'Shift', value: '__SHIFT__', span: 2 },
  { label: 'Space', value: ' ',         span: 4 },
  { label: 'Back',  value: '__BACK__',  span: 2 },
  { label: 'Enter', value: '__ENTER__', span: 2 },
];

const KEY_W = 0.07;
const KEY_H = 0.07;
const KEY_GAP = 0.006;

export class Keyboard {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'VR-Keyboard';
    this.group.visible = false;
    this.keys = [];
    this.shift = false;

    const rows = ROWS.length + 1;
    const totalH = rows * (KEY_H + KEY_GAP);

    for (let r = 0; r < ROWS.length; r++) {
      const row = ROWS[r];
      const rowW = row.length * (KEY_W + KEY_GAP);
      for (let c = 0; c < row.length; c++) {
        const k = this._makeKey(row[c], row[c]);
        const x = -rowW / 2 + c * (KEY_W + KEY_GAP) + KEY_W / 2;
        const y = totalH / 2 - r * (KEY_H + KEY_GAP) - KEY_H / 2;
        k.mesh.position.set(x, y, 0);
        this.group.add(k.mesh);
        this.keys.push(k);
      }
    }

    const specWidths = SPECIAL.map(s => s.span * KEY_W + (s.span - 1) * KEY_GAP);
    const specTotalW = specWidths.reduce((a, b) => a + b, 0) + (SPECIAL.length - 1) * KEY_GAP;
    let cx = -specTotalW / 2;
    for (let i = 0; i < SPECIAL.length; i++) {
      const s = SPECIAL[i];
      const w = specWidths[i];
      const k = this._makeKey(s.label, s.value, w);
      k.mesh.position.set(cx + w / 2, totalH / 2 - ROWS.length * (KEY_H + KEY_GAP) - KEY_H / 2, 0);
      this.group.add(k.mesh);
      this.keys.push(k);
      cx += w + KEY_GAP;
    }

    // Background plate behind keys (also catches near-miss rays so the player
    // doesn't accidentally interact with the world behind the keyboard).
    const padX = 0.04, padY = 0.04;
    const widest = Math.max(
      ROWS[0].length * (KEY_W + KEY_GAP),
      specTotalW,
    );
    const plateGeo = new THREE.PlaneGeometry(widest + padX, totalH + padY);
    const plateMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a18, transparent: true, opacity: 0.78, side: THREE.DoubleSide,
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, 0, -0.004);
    plate.userData.uiKind = 'keyboard-plate';
    this.group.add(plate);
  }

  _makeKey(label, value, width) {
    const w = width || KEY_W;
    const h = KEY_H;

    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(128, Math.floor(256 * w / KEY_W));
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, depthTest: true,
    });
    const geo = new THREE.PlaneGeometry(w - KEY_GAP, h - KEY_GAP);
    const mesh = new THREE.Mesh(geo, mat);

    const key = { mesh, label, value, canvas, ctx, texture: tex, hover: false, pressed: false, isSpecial: value.startsWith('__') };
    mesh.userData.uiKind = 'keyboard-key';
    mesh.userData.key = key;
    this._drawKey(key);
    return key;
  }

  _drawKey(key) {
    const ctx = key.ctx;
    const W = key.canvas.width, H = key.canvas.height;

    let bg = 'rgba(20, 20, 36, 0.95)';
    if (key.isSpecial) bg = 'rgba(40, 50, 90, 0.95)';
    if (key.value === '__SHIFT__' && this.shift) bg = 'rgba(120, 180, 255, 0.9)';
    if (key.pressed) bg = 'rgba(180, 220, 255, 0.95)';
    else if (key.hover) bg = 'rgba(74, 124, 255, 0.9)';

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    const showLabel = (key.value.length === 1 && !key.isSpecial)
      ? (this.shift ? key.label.toUpperCase() : key.label)
      : key.label;
    ctx.fillStyle = key.pressed ? '#102' : '#fff';
    const fontSize = key.isSpecial ? Math.floor(H * 0.32) : Math.floor(H * 0.55);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(showLabel, W / 2, H / 2);

    key.texture.needsUpdate = true;
  }

  getKeyMeshes() {
    return this.keys.map(k => k.mesh);
  }

  setHover(mesh) {
    for (const k of this.keys) {
      const want = (k.mesh === mesh);
      if (k.hover !== want) { k.hover = want; this._drawKey(k); }
    }
  }

  flash(mesh) {
    const k = this.keys.find(kk => kk.mesh === mesh);
    if (!k) return null;
    k.pressed = true; this._drawKey(k);
    setTimeout(() => { k.pressed = false; this._drawKey(k); }, 110);

    if (k.value === '__SHIFT__') {
      this.shift = !this.shift;
      this._redrawAll();
      return { kind: 'shift', value: this.shift };
    }
    if (k.value === '__BACK__')  return { kind: 'back' };
    if (k.value === '__ENTER__') return { kind: 'enter' };
    let ch = k.value;
    if (k.value.length === 1 && !k.isSpecial && this.shift) {
      ch = k.value.toUpperCase();
      this.shift = false;
      this._redrawAll();
    }
    return { kind: 'char', value: ch };
  }

  _redrawAll() {
    for (const k of this.keys) this._drawKey(k);
  }

  show() { this.group.visible = true; }
  hide() { this.group.visible = false; }
}

// ────────────────────────────────────────────────────────────────────────────
// Pointer ray
// ────────────────────────────────────────────────────────────────────────────

export function makePointerRay() {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ]);
  const mat = new THREE.LineBasicMaterial({
    color: 0x7eb8ff, transparent: true, opacity: 0.85, depthTest: false,
  });
  const line = new THREE.Line(geo, mat);
  line.scale.z = 2;
  line.renderOrder = 999;

  const dotGeo = new THREE.RingGeometry(0.006, 0.014, 24);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.visible = false;
  dot.renderOrder = 1000;

  return { line, dot };
}

// ────────────────────────────────────────────────────────────────────────────
// Canvas helpers
// ────────────────────────────────────────────────────────────────────────────

function wrapText(ctx, text, maxWidth) {
  const out = [];
  const paragraphs = String(text).split('\n');
  for (const para of paragraphs) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    else if (paragraphs.length > 1) out.push('');
  }
  return out;
}

function roundRect(ctx, x, y, w, h, r, onlyTop = false) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  if (onlyTop) {
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  }
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
