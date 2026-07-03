/**
 * tripo.js — Tripo AI (text → 3D, image → 3D) front-end.
 *
 * Drives the "AI Generate" tab of the Import modal: submit a prompt or image,
 * poll the backend until the .glb is ready, then hand the URL to loadGLB() — so a
 * generated object behaves EXACTLY like an imported one (select / move / scale /
 * undo / multiplayer sync to the Quest headset / save into the project).
 *
 * The Tripo API key lives only on the server (see tripo.py); the browser never sees it.
 */
import { loadGLB, replaceObjectGlbById } from './assets.js';
import { addMessage } from './chat.js';
import { genId } from './state.js';

const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;          // give up client-side after 5 min
const TERMINAL_FAIL = new Set(['failed', 'cancelled', 'banned', 'expired']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── API calls ────────────────────────────────────────────────────────────────
// Phase 1 always requests the FAST geometry-only draft (?fast=1) — that's what makes the
// mesh show up in ~seconds. Phase 2 (startTexture) then textures that same mesh.
async function startText(prompt) {
  const res = await fetch('/api/tripo/text?fast=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start generation.');
  return data.taskId;
}

async function startImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/tripo/image?fast=1', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start generation.');
  return data.taskId;
}

async function startTexture(baseTaskId) {
  const res = await fetch('/api/tripo/texture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: baseTaskId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start texturing.');
  return data.taskId;
}

async function pollUntilDone(taskId, onProgress) {
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_TIMEOUT_MS) {
    const res = await fetch('/api/tripo/status/' + encodeURIComponent(taskId));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Status check failed.');
    onProgress?.(data);
    if (data.status === 'success') return { url: data.url, name: data.name || 'AI Model' };
    if (TERMINAL_FAIL.has(data.status)) throw new Error(data.error || ('Generation ' + data.status + '.'));
    await sleep(POLL_MS);
  }
  throw new Error('Timed out after 5 min — the task may still finish on Tripo; try again.');
}

// ── UI ────────────────────────────────────────────────────────────────────────
export function initTripoUI() {
  const modal       = document.getElementById('import-modal');
  const modalTabs   = document.querySelectorAll('.modal-tab');
  const modalActions = document.querySelector('#import-modal .modal-actions');
  const importBtn   = document.getElementById('import-btn');

  const textInput   = document.getElementById('tripo-text-input');
  const textBtn     = document.getElementById('tripo-text-btn');
  const imageArea   = document.getElementById('tripo-image-area');
  const imageInput  = document.getElementById('tripo-image-input');
  const progress    = document.getElementById('tripo-progress');
  const barFill     = document.getElementById('tripo-bar-fill');
  const statusEl    = document.getElementById('tripo-status');
  const sysPromptEl = document.getElementById('tripo-sysprompt');
  const noticeEl    = document.getElementById('tripo-notice');
  const draftChk    = document.getElementById('tripo-draft');

  if (!textInput || !textBtn) return;   // tab markup absent — nothing to wire

  let busy = false;

  // The generic "Add to Scene" footer is meaningless on the AI tab (it has its own
  // Generate button), so hide it whenever the AI tab is showing.
  function syncFooter() {
    const active = document.querySelector('.modal-tab.active')?.dataset.tab;
    if (modalActions) modalActions.style.display = active === 'ai' ? 'none' : '';
  }
  modalTabs.forEach((t) => t.addEventListener('click', syncFooter));
  importBtn?.addEventListener('click', () => setTimeout(syncFooter, 0));

  // Dedicated toolbar button opens the modal straight onto the AI tab.
  document.getElementById('tripo-btn')?.addEventListener('click', () => {
    modal.classList.remove('hidden');
    modalTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === 'ai'));
    document.querySelectorAll('#import-modal .tab-panel').forEach((p) => p.classList.add('hidden'));
    document.getElementById('tab-ai')?.classList.remove('hidden');
    syncFooter();
    setTimeout(() => textInput.focus(), 0);
  });

  function setBusy(on) {
    busy = on;
    textBtn.disabled = on;
    textInput.disabled = on;
    imageArea.classList.toggle('disabled', on);
    progress.classList.toggle('hidden', !on);
  }

  function setStatus(text, pct, tone = '') {
    statusEl.textContent = text;
    statusEl.className = 'tripo-status' + (tone ? ' ' + tone : '');
    if (typeof pct === 'number') barFill.style.width = Math.max(4, Math.min(100, pct)) + '%';
  }

  // Two-phase progress: mesh fills the bar 8→38%, texturing 40→98%.
  function describe(data, phase) {
    const p = data.progress || 0;
    if (phase === 'mesh') {
      if (data.status === 'queued') return setStatus('Queued…', 8);
      return setStatus(`Sculpting mesh… ${p}%`, 8 + p * 0.30);
    }
    if (data.status === 'queued') return setStatus('Texturing queued…', 40);
    return setStatus(`Texturing… ${p}%`, 40 + p * 0.58);
  }

  // Shared run loop for text and image. `startFn` returns the draft (geometry) taskId.
  // Progressive by default: show the mesh fast, then texture it in place. "Draft only"
  // stops at the fast grey mesh.
  async function run(startFn, label) {
    if (busy) return;
    setBusy(true);
    setStatus(label, 3);
    const draftOnly = !!(draftChk && draftChk.checked);
    const objId = genId();
    try {
      // Phase 1 — fast geometry draft (~seconds): drop the mesh in as soon as it's ready.
      const baseTaskId = await startFn();
      const geo = await pollUntilDone(baseTaskId, (d) => describe(d, 'mesh'));
      loadGLB(geo.url, geo.name, { id: objId });   // ← identical path to an imported model
      textInput.value = '';

      if (draftOnly) {
        addMessage(`Draft mesh "${geo.name}" added (untextured).`, 'system');
        setStatus(`Draft mesh added: "${geo.name}".`, 100, 'ok');
        setTimeout(() => progress.classList.add('hidden'), 2500);
        return;
      }

      // Phase 2 — texture that SAME mesh and swap it in place (shape doesn't change).
      addMessage(`Mesh "${geo.name}" placed — texturing in the background…`, 'system');
      setStatus('Mesh placed — texturing…', 40);
      try {
        const texTaskId = await startTexture(baseTaskId);
        const tex = await pollUntilDone(texTaskId, (d) => describe(d, 'texture'));
        replaceObjectGlbById(objId, tex.url, tex.name);
        addMessage(`"${tex.name}" textured.`, 'system');
        setStatus(`Added "${tex.name}" (textured). Generate another, or close.`, 100, 'ok');
        setTimeout(() => progress.classList.add('hidden'), 2500);
      } catch (texErr) {
        // Phase 1 already succeeded — keep the mesh, just report the texturing failure.
        addMessage('Texturing failed (draft mesh kept): ' + (texErr.message || 'unknown error'), 'system');
        setStatus('Texturing failed — draft mesh kept.', 100, 'err');
      }
    } catch (err) {
      setStatus(err.message || 'Generation failed.', 100, 'err');
      addMessage('AI generation failed: ' + (err.message || 'unknown error'), 'system');
    } finally {
      busy = false;
      textBtn.disabled = false;
      textInput.disabled = false;
      imageArea.classList.remove('disabled');
    }
  }

  textBtn.addEventListener('click', () => {
    const prompt = textInput.value.trim();
    if (!prompt) { setStatus('Describe what to create first.', 0, 'err'); progress.classList.remove('hidden'); return; }
    run(() => startText(prompt), 'Submitting prompt…');
  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); textBtn.click(); }
  });

  imageArea.addEventListener('click', () => { if (!busy) imageInput.click(); });
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    imageInput.value = '';
    if (!file) return;
    run(() => startImage(file), 'Uploading image…');
  });

  // Reflect server readiness + show the exact injected prompt (so it's discoverable).
  fetch('/api/tripo/config').then((r) => r.json()).then((cfg) => {
    if (sysPromptEl && cfg.systemPrompt) sysPromptEl.textContent = cfg.systemPrompt;
    if (!cfg.ready && noticeEl) {
      noticeEl.textContent = 'No Tripo API key yet — add "tripoApiKey" to config.local.json, then restart the server.';
      noticeEl.classList.remove('hidden');
    }
  }).catch(() => { /* offline / desktop build without the endpoint — buttons still try */ });
}
