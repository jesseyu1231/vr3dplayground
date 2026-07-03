/**
 * scene.js — sky gradient, starry dome, white sky, custom equirectangular skybox,
 * fog, and the studio ground plane.
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
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

// ── Starry-night sky ─────────────────────────────────────────────────────────
// Unlike the flat 2×256 gradient (which fills the screen), this paints a full
// equirectangular canvas (2048×1024) and maps it as a wrap-around sky dome so the
// stars surround the viewer and respond to head rotation in VR. Built once and
// cached — cycling Lighting just re-points scene.background at the same texture.
let starryTexture = null;
export function drawStarrySky() {
  if (!starryTexture) {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 1024;
    const ctx = c.getContext('2d');

    // Deep-indigo gradient: near-black at the zenith (canvas top) easing to a
    // faint blue glow at the horizon (canvas bottom).
    const g = ctx.createLinearGradient(0, 0, 0, 1024);
    g.addColorStop(0,   '#05060f');
    g.addColorStop(0.7, '#0b1026');
    g.addColorStop(1,   '#1a2140');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2048, 1024);

    // Soft Milky-Way band — a diagonal smear of extra-dense, dim stars.
    ctx.save();
    ctx.translate(1024, 512);
    ctx.rotate(-0.5);
    const band = ctx.createLinearGradient(0, -120, 0, 120);
    band.addColorStop(0,   'rgba(120,140,200,0)');
    band.addColorStop(0.5, 'rgba(150,165,210,0.10)');
    band.addColorStop(1,   'rgba(120,140,200,0)');
    ctx.fillStyle = band;
    ctx.fillRect(-1400, -120, 2800, 240);
    ctx.restore();

    // Star field — many faint pinpoints plus a few bright, glowing ones.
    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * 2048;
      const y = Math.random() * 1024;
      const r = Math.random() * 0.9 + 0.2;
      const a = Math.random() * 0.7 + 0.3;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * 2048;
      const y = Math.random() * 1024;
      const r = Math.random() * 1.6 + 1.2;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      glow.addColorStop(0,   'rgba(255,255,255,0.95)');
      glow.addColorStop(0.4, 'rgba(200,220,255,0.5)');
      glow.addColorStop(1,   'rgba(180,200,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    starryTexture = new THREE.CanvasTexture(c);
    starryTexture.colorSpace = THREE.SRGBColorSpace;
    starryTexture.mapping = THREE.EquirectangularReflectionMapping;
  }
  scene.background = starryTexture;
}

// ── White studio sky ─────────────────────────────────────────────────────────
// A clean, evenly-lit bright backdrop (a flat colour, not a gradient) — the classic
// product-shot / cyclorama look. Paired with the ground plane so objects don't float.
export function drawWhiteSky(color = '#eef0f2') {
  scene.background = new THREE.Color(color);
}

// ── Custom equirectangular skybox ────────────────────────────────────────────
// Loads an equirectangular panorama as the scene background. .hdr→RGBELoader,
// .exr→EXRLoader, everything else→TextureLoader (LDR jpg/png). Optionally also builds
// a PMREM environment map so the panorama lights PBR materials (image-based lighting).
let _skyboxTex = null;
let _pmrem = null;
export function loadSkyboxTexture(url, { setEnvironment = false, onDone, onError } = {}) {
  if (!url) return;
  const clean = url.split('?')[0].toLowerCase();
  const ext = clean.slice(clean.lastIndexOf('.') + 1);
  const isLDR = ext !== 'hdr' && ext !== 'exr';
  const loader = ext === 'hdr' ? new RGBELoader()
               : ext === 'exr' ? new EXRLoader()
               : new THREE.TextureLoader();
  loader.setCrossOrigin?.('anonymous');
  loader.load(
    url,
    (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if (isLDR) tex.colorSpace = THREE.SRGBColorSpace;
      if (_skyboxTex && _skyboxTex !== tex) _skyboxTex.dispose();
      _skyboxTex = tex;
      scene.background = tex;
      setSceneEnvironment(setEnvironment ? tex : null);
      onDone?.();
    },
    undefined,
    (err) => { onError?.(err); }
  );
}

// Build (or clear) the scene's image-based-lighting environment from an equirect texture.
// Pass null to remove IBL. PMREM pre-filters the panorama into a usable env map.
export function setSceneEnvironment(tex) {
  if (!tex) {
    if (scene.environment) scene.environment.dispose?.();
    scene.environment = null;
    return;
  }
  if (!_pmrem) _pmrem = new THREE.PMREMGenerator(renderer);
  const prev = scene.environment;
  scene.environment = _pmrem.fromEquirectangular(tex).texture;
  if (prev && prev !== scene.environment) prev.dispose?.();
}

// ── Studio ground plane ──────────────────────────────────────────────────────
// Hidden by default; templates that hide the gallery (White Studio / Starry / Custom)
// show this so objects + the guide rest on a floor instead of floating in a void.
export let groundPlane = null;
function createGroundPlane() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.96, metalness: 0.0 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  mesh.visible = false;
  mesh.userData.selectable = false;
  return mesh;
}

export function initScene() {
  // Warm ink-wash overcast sky shared by gallery + garden. Matches env preset[0]
  // ('Gallery Daylight') so there's no flash of the old dark sky before the boot
  // applyEnvPreset() runs in main.js.
  drawSkyGradient([[0,'#E8E4DB'],[0.55,'#EDEAE3'],[1,'#DCD7CC']]);

  // Keep a LIVE FogExp2 at near-zero density. applyEnvPreset() unconditionally
  // writes scene.fog.color / scene.fog.density, so this must never be null.
  scene.fog = new THREE.FogExp2(0xEDEAE3, 0.0008);

  // gallery.js lays the single master walkable y=0 plane (indoor + garden) and
  // garden.js overlays the green ground for the Gallery template. The studio ground
  // plane below is the floor for templates that hide the gallery; hidden by default.
  groundPlane = createGroundPlane();
  scene.add(groundPlane);

  // Keeping the renderer canvas attach — it is load-bearing.
  document.getElementById('canvas-container').appendChild(renderer.domElement);
}
