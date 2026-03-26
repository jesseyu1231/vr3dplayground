/**
 * devpanel.js — developer controls sidebar.
 * Toggle with the 🛠 Dev toolbar button.
 */
import { scene, importedObjects } from './state.js';
import { setTalking, isTalking } from './chat.js';
import { getMixamoBones, getMixamoRoot, tweakBoneRest } from './humanoid.js';

const panel       = document.getElementById('dev-panel');
const devBtn      = document.getElementById('dev-btn');
const closeBtn    = document.getElementById('dev-close-btn');
const talkToggle  = document.getElementById('dev-talk-toggle');
const talkBurst   = document.getElementById('dev-talk-burst');
const talkTimerEl = document.getElementById('dev-talk-timer-val');
const logBonesBtn  = document.getElementById('dev-log-bones');
const dumpBonesBtn = document.getElementById('dev-dump-bones');
const bonesList    = document.getElementById('dev-bones-list');
const logSceneBtn = document.getElementById('dev-log-scene');
const objectCount = document.getElementById('dev-object-count');
const fpsEl       = document.getElementById('dev-fps');

let forceTalking = false;
let burstTimeout = null;

// ── Bone tweak sliders ────────────────────────────────────────────────────────
// keyed by bone name, e.g. boneTweaks['LeftShoulder'] = { x, y, z }
export const boneTweaks = {};

const boneSelect = document.getElementById('dev-bone-select');
const btX = document.getElementById('bt-x');
const btY = document.getElementById('bt-y');
const btZ = document.getElementById('bt-z');
const btXVal = document.getElementById('bt-x-val');
const btYVal = document.getElementById('bt-y-val');
const btZVal = document.getElementById('bt-z-val');

// Populate dropdown when a Mixamo model is loaded — triggered via CustomEvent
function refreshBoneDropdown(boneNames) {
  boneSelect.innerHTML = '<option value="">— select bone —</option>';
  for (const name of boneNames) {
    if (!boneTweaks[name]) boneTweaks[name] = { x: 0, y: 0, z: 0 };
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    boneSelect.appendChild(opt);
  }
}
document.addEventListener('mixamo-bones-ready', (e) => refreshBoneDropdown(e.detail));

function getSelected() { return boneSelect.value; }

function syncSlidersToSelected() {
  const name = getSelected();
  if (!name || !boneTweaks[name]) return;
  const t = boneTweaks[name];
  btX.value = t.x; btXVal.textContent = t.x.toFixed(2);
  btY.value = t.y; btYVal.textContent = t.y.toFixed(2);
  btZ.value = t.z; btZVal.textContent = t.z.toFixed(2);
}

boneSelect.addEventListener('change', syncSlidersToSelected);

function onSlider(slider, valEl, axis) {
  slider.addEventListener('input', () => {
    const name = getSelected();
    if (!name) return;
    const v = parseFloat(slider.value);
    boneTweaks[name][axis] = v;
    valEl.textContent = v.toFixed(2);
    const t = boneTweaks[name];
    tweakBoneRest(name, t.x, t.y, t.z);
  });
}
onSlider(btX, btXVal, 'x');
onSlider(btY, btYVal, 'y');
onSlider(btZ, btZVal, 'z');

document.getElementById('dev-log-pose').addEventListener('click', () => {
  const entries = Object.entries(boneTweaks).filter(([, v]) => v.x !== 0 || v.y !== 0 || v.z !== 0);
  const text = entries.map(([k, v]) => `${k}: x=${v.x.toFixed(2)} y=${v.y.toFixed(2)} z=${v.z.toFixed(2)}`).join('\n');
  console.log('[DevPanel] boneTweaks:', JSON.stringify(boneTweaks, null, 2));
  alert(text || 'All tweaks are zero.');
});

// ── Panel toggle ──────────────────────────────────────────────────────────────
devBtn.addEventListener('click', () => {
  const open = panel.style.display === 'block';
  panel.style.display = open ? 'none' : 'block';
  devBtn.classList.toggle('active', !open);
});
closeBtn.addEventListener('click', () => {
  panel.style.display = 'none';
  devBtn.classList.remove('active');
});

// ── Force talking toggle ──────────────────────────────────────────────────────
talkToggle.addEventListener('click', () => {
  forceTalking = !forceTalking;
  setTalking(forceTalking);
  talkToggle.textContent = `💬 Force Talking: ${forceTalking ? 'ON' : 'OFF'}`;
  talkToggle.classList.toggle('active', forceTalking);
  if (forceTalking && burstTimeout) { clearTimeout(burstTimeout); burstTimeout = null; }
});

// ── Talk burst ────────────────────────────────────────────────────────────────
talkBurst.addEventListener('click', () => {
  if (burstTimeout) { clearTimeout(burstTimeout); burstTimeout = null; }
  if (forceTalking) return; // manual toggle takes priority
  setTalking(true);
  talkBurst.classList.add('active');
  burstTimeout = setTimeout(() => {
    setTalking(false);
    talkBurst.classList.remove('active');
    burstTimeout = null;
  }, 3000);
});

// ── Bone map display — live, toggled on/off ───────────────────────────────────
let _bonesLive = false;
// Pre-create one div per bone so we only update text, not rebuild DOM each frame
const _boneRowEls = {};

logBonesBtn.addEventListener('click', () => {
  _bonesLive = !_bonesLive;
  logBonesBtn.classList.toggle('active', _bonesLive);
  logBonesBtn.textContent = _bonesLive ? '🦴 Live Bones: ON' : '🦴 Log Tracked Bones';
  bonesList.innerHTML = '';
  Object.keys(_boneRowEls).forEach(k => delete _boneRowEls[k]);

  if (!_bonesLive) return;

  const bones = getMixamoBones();
  if (!bones) { bonesList.textContent = 'No Mixamo model loaded.'; _bonesLive = false; return; }

  Object.keys(bones).forEach(name => {
    const div = document.createElement('div');
    bonesList.appendChild(div);
    _boneRowEls[name] = div;
  });
});

// ── Dump ALL node names from the Mixamo model ────────────────────────────────
dumpBonesBtn.addEventListener('click', () => {
  const root = getMixamoRoot();
  bonesList.innerHTML = '';
  if (!root) {
    bonesList.textContent = 'No Mixamo model loaded.';
    return;
  }
  const names = [];
  root.traverse(n => { if (n.name) names.push(n.type + ': ' + n.name); });
  if (names.length === 0) {
    bonesList.textContent = 'Model has no named nodes.';
    return;
  }
  names.forEach(name => {
    const div = document.createElement('div');
    div.textContent = name;
    bonesList.appendChild(div);
  });
  console.log('[DevPanel] All node names:', names);
});

// ── Scene graph log ───────────────────────────────────────────────────────────
logSceneBtn.addEventListener('click', () => {
  const root = getMixamoRoot();
  if (root) {
    console.group('[DevPanel] Mixamo model scene graph');
    root.traverse(n => {
      const indent = '  '.repeat(getDepth(n, root));
      console.log(`${indent}${n.type} "${n.name}"`);
    });
    console.groupEnd();
  }
  console.group('[DevPanel] Full Three.js scene graph');
  scene.traverse(n => {
    const indent = '  '.repeat(getDepth(n, scene));
    console.log(`${indent}${n.type} "${n.name}"`);
  });
  console.groupEnd();
});

function getDepth(node, root) {
  let d = 0, cur = node.parent;
  while (cur && cur !== root) { d++; cur = cur.parent; }
  return d;
}

// ── Per-frame stats update (called from main.js render loop) ──────────────────
let _lastFrameTime = performance.now();
let _frameCount = 0;
let _fps = 0;

export function updateDevPanel() {
  if (panel.style.display !== 'block') return;

  // FPS
  _frameCount++;
  const now = performance.now();
  const delta = now - _lastFrameTime;
  if (delta >= 500) {
    _fps = Math.round((_frameCount / delta) * 1000);
    _frameCount = 0;
    _lastFrameTime = now;
  }
  fpsEl.textContent = _fps;

  // Object count
  objectCount.textContent = importedObjects.length;

  // talkTimer proxy — read isTalking live
  talkTimerEl.textContent = isTalking ? '▶ talking' : '— idle';

  // Live bone rotations
  if (_bonesLive) {
    const bones = getMixamoBones();
    if (bones) {
      for (const [name, div] of Object.entries(_boneRowEls)) {
        const b = bones[name];
        if (!b) continue;
        const r = b.rotation;
        const toDeg = v => (v * 180 / Math.PI).toFixed(1);
        div.textContent = `${name}: x=${toDeg(r.x)} y=${toDeg(r.y)} z=${toDeg(r.z)}`;
      }
    }
  }
}

export function initDevPanel() {
  // nothing async needed; DOM listeners registered above at module load
}
