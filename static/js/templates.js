/**
 * templates.js — world templates (geometry + sky) + lighting mood + custom skybox.
 *
 * A "template" picks which scene geometry is shown and what kind of sky to draw; it
 * references a "mood" (day/sunset/evening) for lighting rather than duplicating light
 * values. Everything funnels through applyTemplate(), the single apply path, which:
 *   1. toggles gallery / garden / ground-plane visibility (never disposes them),
 *   2. drives lights + fog + exposure through the untouched applyEnvPreset(), and
 *   3. overrides the sky (white / starry / custom equirectangular) as needed.
 *
 * The synced/persisted/undone unit is a "world descriptor":
 *   { templateId, moodId, skybox:{url,name,ibl}|null, envIndex }
 * envIndex is always included so old saves / peers / servers (which only understand an
 * integer environment index) keep working. A bare {envIndex} maps back to a descriptor.
 */
import { scene, galleryGroup, wsSend } from './state.js';
import {
  applyEnvPreset, envPresets, setEnvIndex,
  MOODS, MOOD_ORDER, MOOD_LABEL, STARRY_INDEX,
} from './environment.js';
import { drawWhiteSky, loadSkyboxTexture, setSceneEnvironment, groundPlane } from './scene.js';
import { hemisphereLight } from './lights.js';
import { pushUndo } from './undo.js';

export const TEMPLATES = [
  { id: 'gallery', label: 'Gallery',       tile: 'tpl-gallery', show: { gallery: true,  garden: true,  ground: false }, sky: 'gradient', defaultMood: 'day' },
  { id: 'studio',  label: 'White Studio',  tile: 'tpl-studio',  show: { gallery: false, garden: false, ground: true  }, sky: 'white',    defaultMood: 'day' },
  { id: 'starry',  label: 'Starry Night',  tile: 'tpl-starry',  show: { gallery: false, garden: false, ground: true  }, sky: 'starry',   defaultMood: 'evening' },
  { id: 'custom',  label: 'Custom Skybox', tile: 'tpl-custom',  show: { gallery: false, garden: false, ground: true  }, sky: 'equirect', defaultMood: 'day' },
];

// Curated CC0 HDRIs from Poly Haven, loaded by direct CDN URL (CORS-enabled, verified).
const PH = (slug) => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${slug}_2k.hdr`;
const TH = (slug) => `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=256&height=160`;
export const SKYBOX_PRESETS = [
  { name: 'Partly Cloudy', slug: 'kloofendal_48d_partly_cloudy' },
  { name: 'Venice Sunset', slug: 'venice_sunset' },
  { name: 'Studio',        slug: 'studio_small_03' },
  { name: 'Overcast',      slug: 'kloppenheim_06' },
  { name: 'Autumn Field',  slug: 'autumn_field' },
  { name: 'Night',         slug: 'dikhololo_night' },
];

// ── Module state ─────────────────────────────────────────────────────────────
let currentTemplateId = 'gallery';
let currentMoodId = 'day';
let currentSkybox = null;          // { url, name, ibl } | null
let _gardenGroup = null;

export function registerTemplateTargets({ gardenGroup } = {}) {
  _gardenGroup = gardenGroup || null;
}

// ── The single apply path ────────────────────────────────────────────────────
export function applyTemplate(id, { mood, skybox, remote = false, push = true } = {}) {
  const tpl = TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
  const prevWorld = getWorldDescriptor();
  const useMood = mood || currentMoodId || tpl.defaultMood;

  // 1. geometry visibility (toggle only — never dispose/rebuild)
  galleryGroup.visible = tpl.show.gallery;
  if (_gardenGroup) _gardenGroup.visible = tpl.show.garden;
  if (groundPlane) groundPlane.visible = tpl.show.ground;

  // 2. lights / fog / exposure (+ base sky) via the untouched single apply path
  const lightingIndex = tpl.id === 'starry' ? STARRY_INDEX : (MOODS[useMood] ?? 0);
  applyEnvPreset(envPresets[lightingIndex]);
  setEnvIndex(lightingIndex);

  // 3. sky override
  const sky = tpl.sky === 'equirect' ? (skybox || currentSkybox) : null;
  if (tpl.sky === 'white') {
    setSceneEnvironment(null);
    drawWhiteSky();
    scene.fog.color.set('#eef0f2'); scene.fog.density = 0.0006;
  } else if (tpl.sky === 'equirect') {
    if (sky?.url) {
      scene.fog.density = 0.0003;
      if (sky.ibl && hemisphereLight) hemisphereLight.intensity *= 0.35;   // avoid double-lighting
      setSkyStatus('Loading skybox…');
      loadSkyboxTexture(sky.url, {
        setEnvironment: !!sky.ibl,
        onDone: () => setSkyStatus('Skybox loaded.', 'ok'),
        onError: () => setSkyStatus('Could not load that skybox (check the URL / format).', 'err'),
      });
    } else {
      // Custom chosen but nothing loaded yet — neutral void + a nudge.
      setSceneEnvironment(null);
      drawWhiteSky('#e9ebee');
      scene.fog.color.set('#e9ebee'); scene.fog.density = 0.0006;
      setSkyStatus('Pick a preset or upload a skybox to fill this world.');
    }
  } else {
    // gallery / starry: applyEnvPreset already drew the right sky (gradient / star dome)
    setSceneEnvironment(null);
  }

  // 4. commit + reflect in UI
  currentTemplateId = tpl.id;
  currentMoodId = useMood;
  currentSkybox = sky;
  setMoodLabel();
  refreshWorldPanel();

  // 5. persist / sync / undo
  if (!remote) {
    const nextWorld = getWorldDescriptor();
    if (push) pushUndo({ type: 'env_change', oldWorld: prevWorld, newWorld: nextWorld });
    wsSend({ type: 'env_change', ...nextWorld });
  }
}

// ── World descriptor (the synced / saved / undone unit) ──────────────────────
function legacyEnvIndexFor(templateId, moodId) {
  if (templateId === 'starry') return STARRY_INDEX;
  return MOODS[moodId] ?? 0;
}

export function getWorldDescriptor() {
  return {
    templateId: currentTemplateId,
    moodId: currentMoodId,
    skybox: currentSkybox ? { url: currentSkybox.url, name: currentSkybox.name, ibl: !!currentSkybox.ibl } : null,
    envIndex: legacyEnvIndexFor(currentTemplateId, currentMoodId),
  };
}

export function worldFromLegacyEnvIndex(index = 0) {
  if (index === STARRY_INDEX) return { templateId: 'starry', moodId: 'evening', skybox: null, envIndex: index };
  let moodId = 'day';
  if (index === MOODS.sunset) moodId = 'sunset';
  else if (index === MOODS.evening) moodId = 'evening';
  return { templateId: 'gallery', moodId, skybox: null, envIndex: index };
}

export function applyWorldDescriptor(desc, opts = {}) {
  if (!desc) return;
  if (desc.templateId) {
    applyTemplate(desc.templateId, { mood: desc.moodId, skybox: desc.skybox, ...opts });
  } else if (desc.envIndex !== undefined) {
    applyWorldDescriptor(worldFromLegacyEnvIndex(desc.envIndex), opts);
  }
}

// ── World panel UI ───────────────────────────────────────────────────────────
function setSkyStatus(text, cls = '') {
  const el = document.getElementById('skybox-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'world-status' + (cls ? ' ' + cls : '');
}

export function setMoodLabel() {
  const btn = document.getElementById('env-btn');
  if (btn) btn.textContent = MOOD_LABEL[currentMoodId] || 'Daylight';
}

export function refreshWorldPanel() {
  document.querySelectorAll('#template-tiles .tile').forEach((tile) =>
    tile.classList.toggle('selected', tile.dataset.template === currentTemplateId));
  const ibl = document.getElementById('skybox-ibl-toggle');
  if (ibl) ibl.checked = !!currentSkybox?.ibl;
}

// Build a row of diorama-box template tiles into `container`; onPick(id) per click.
export function buildTemplateTiles(container, onPick) {
  if (!container) return;
  container.innerHTML = '';
  for (const t of TEMPLATES) {
    const tile = document.createElement('div');
    tile.className = `tile ${t.tile}`;
    tile.dataset.template = t.id;
    tile.innerHTML = `<span class="tile-label">${t.label}</span>`;
    tile.addEventListener('click', () => onPick(t.id));
    container.appendChild(tile);
  }
}

async function uploadSkyboxFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

export function initWorldPanel() {
  // Template tiles
  buildTemplateTiles(document.getElementById('template-tiles'),
    (id) => applyTemplate(id));

  // Mood toggle (day → sunset → evening)
  document.getElementById('env-btn')?.addEventListener('click', () => {
    const i = MOOD_ORDER.indexOf(currentMoodId);
    const next = MOOD_ORDER[(i + 1) % MOOD_ORDER.length];
    applyTemplate(currentTemplateId, { mood: next });
  });

  // Skybox presets
  const presetWrap = document.getElementById('skybox-presets');
  if (presetWrap) {
    presetWrap.innerHTML = '';
    for (const p of SKYBOX_PRESETS) {
      const tile = document.createElement('div');
      tile.className = 'tile sky-tile';
      tile.style.backgroundImage = `url("${TH(p.slug)}")`;
      tile.style.backgroundSize = 'cover';
      tile.style.backgroundPosition = 'center';
      tile.innerHTML = `<span class="tile-label">${p.name}</span>`;
      tile.addEventListener('click', () => {
        const ibl = document.getElementById('skybox-ibl-toggle')?.checked;
        applyTemplate('custom', { skybox: { url: PH(p.slug), name: p.name, ibl } });
      });
      presetWrap.appendChild(tile);
    }
  }

  // Skybox upload
  const fileInput = document.getElementById('skybox-file-input');
  document.getElementById('skybox-upload-btn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    setSkyStatus('Uploading…');
    try {
      const url = await uploadSkyboxFile(file);
      const ibl = document.getElementById('skybox-ibl-toggle')?.checked;
      applyTemplate('custom', { skybox: { url, name: file.name, ibl } });
    } catch (err) {
      setSkyStatus(err.message || 'Upload failed', 'err');
    }
  });

  // Skybox from URL
  const urlInput = document.getElementById('skybox-url-input');
  const loadUrl = () => {
    const url = urlInput?.value.trim();
    if (!url) return;
    const ibl = document.getElementById('skybox-ibl-toggle')?.checked;
    applyTemplate('custom', { skybox: { url, name: 'Custom', ibl } });
  };
  document.getElementById('skybox-url-btn')?.addEventListener('click', loadUrl);
  urlInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadUrl(); } });

  // IBL toggle re-applies the current custom skybox
  document.getElementById('skybox-ibl-toggle')?.addEventListener('change', (e) => {
    if (currentTemplateId === 'custom' && currentSkybox?.url) {
      applyTemplate('custom', { skybox: { ...currentSkybox, ibl: e.target.checked } });
    }
  });

  refreshWorldPanel();
}
