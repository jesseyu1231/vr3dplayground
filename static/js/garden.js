/**
 * garden.js — §3 Outdoor Literati Garden (Suzhou "borrowed scenery" beyond the moon-gate).
 *
 * Builds a restrained ink-wash garden into a child group 'GardenDecor' added to the
 * shared non-selectable galleryGroup (state.js). All meshes are structural decor:
 * userData.selectable=false, excluded from importedObjects/HUD/export by design.
 *
 * Locomotion is collision-free free-fly (vr.js): garden has no boundary clamp, no
 * invisible walls, no triggers. The ink-stone border bounds the garden VISUALLY only.
 * Walk-through is an accepted, documented limitation.
 *
 * HARD RULES honored:
 *  - ONE shadow-casting light (the sun); EVERYTHING here is castShadow=false.
 *  - Distant garden (z<≈-13) casts no real-time shadow — accepted; outside the ±9 frustum.
 *  - Floor is the gallery master y=0 plane; this module overlays green ground (z<-12) + path.
 *  - Bulk decor reuses SHARED_MATERIALS; the water owns its own Reflector material.
 *  - The pond is a real planar Reflector (mirror reflection of the garden + sky),
 *    resolution-gated down on Quest to protect framerate. Soft volumetric ground
 *    mist is a small set of camera-facing fog cards (the only blended transparency).
 *  - Merged BufferGeometry + InstancedMesh for repeats; static matrices frozen.
 *  - Garden overlays (grass/path/pads) sit a few mm ABOVE the gallery master y=0
 *    floor so the two coplanar planes never z-fight (was the "grass flashing").
 *
 * Structural tri target < 6,000 (~4–6.5K expected). See docs/EXHIBITION_DESIGN_SYSTEM.md §3.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { PALETTE, DIM, SHARED_MATERIALS } from './tokens.js';
import { galleryGroup, myRole, camera } from './state.js';

// Garden overlays sit just above the shared master floor (y=0) to avoid z-fighting.
const GRASS_Y = 0.012;
const WATER_Y = 0.020;

// Module-level handles needed by updateGarden().
let gardenGroup = null;
let waterMesh = null;         // THREE.Reflector plane whose vertices gently wave
let waterBase = null;         // Float32Array snapshot of the flat rest pose
let mistLayers = [];          // { mesh, drift, bob, spin, phase } camera-facing fog cards
let frameParity = 0;          // Quest throttle: animate water every other frame

// ── Helpers ──────────────────────────────────────────────────────────────────

// Freeze a static mesh: bake world matrix once, then stop per-frame matrix recompute.
function freezeStatic(obj) {
  obj.castShadow = false;
  obj.receiveShadow = obj.receiveShadow || false;
  if (obj.userData) obj.userData.selectable = false;
  else obj.userData = { selectable: false };
  obj.updateMatrix();
  obj.updateMatrixWorld(true);
  obj.matrixAutoUpdate = false;
}

// Freeze an InstancedMesh (per-instance matrices already baked into instanceMatrix).
function freezeInstanced(inst) {
  inst.castShadow = false;
  inst.userData.selectable = false;
  inst.instanceMatrix.needsUpdate = true;
  inst.updateMatrix();
  inst.updateMatrixWorld(true);
  inst.matrixAutoUpdate = false;
}

// Tiny seeded PRNG so hand-placement is deterministic across reloads/clients.
let _seed = 0x5b735509;
function rnd() {
  // xorshift32
  _seed ^= _seed << 13; _seed >>>= 0;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5;  _seed >>>= 0;
  return (_seed >>> 0) / 0xffffffff;
}

// Generate a small mipmapped alpha texture for bamboo cutout (vertical culm + leaf hints).
// Cutout via alphaTest (opaque), NOT blended transparency.
function makeBambooAlphaTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // Solid culm column down the center.
  g.fillStyle = '#ffffff';
  const stalkW = Math.round(S * 0.16);
  const x0 = (S - stalkW) / 2;
  g.fillRect(x0, 2, stalkW, S - 4);
  // A few angled leaf blades branching off, so the cutout reads as bamboo.
  g.lineWidth = Math.max(2, Math.round(S * 0.045));
  g.lineCap = 'round';
  g.strokeStyle = '#ffffff';
  const leaves = [
    [0.50, 0.22, 0.86, 0.10],
    [0.50, 0.34, 0.16, 0.20],
    [0.50, 0.50, 0.88, 0.40],
    [0.50, 0.64, 0.14, 0.54],
    [0.50, 0.78, 0.82, 0.70],
  ];
  for (const [ax, ay, bx, by] of leaves) {
    g.beginPath();
    g.moveTo(ax * S, ay * S);
    g.lineTo(bx * S, by * S);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ── Ground overlay + path ─────────────────────────────────────────────────────

function buildGround(group) {
  // Green ground overlay for z<-12, centered around z≈-20 (garden span Z -12..-28).
  // PlaneGeometry(20,16) rotated flat at y=0, coplanar with the gallery master plane.
  const groundGeo = new THREE.PlaneGeometry(DIM.garden.x, DIM.garden.z, 1, 1);
  const ground = new THREE.Mesh(groundGeo, SHARED_MATERIALS.gardenGreen);
  ground.rotation.x = -Math.PI / 2;
  // Sit just ABOVE the gallery master y=0 floor (which spans into the garden to
  // z≈-23) so the two coplanar planes don't z-fight — this was the grass flicker.
  ground.position.set(0, GRASS_Y, (DIM.gardenZ0 + DIM.gardenZ1) / 2); // z = -20
  ground.receiveShadow = true;
  group.add(ground);
  freezeStatic(ground);

  // Path strip (lighter stone) running into the garden, layered above the grass.
  const pathGeo = new THREE.PlaneGeometry(DIM.pathW, DIM.garden.z, 1, 1);
  const path = new THREE.Mesh(pathGeo, SHARED_MATERIALS.stonePlinth);
  path.rotation.x = -Math.PI / 2;
  path.position.set(1.4, GRASS_Y + 0.006, (DIM.gardenZ0 + DIM.gardenZ1) / 2);
  path.receiveShadow = true;
  group.add(path);
  freezeStatic(path);
}

// ── Low-poly pine trees (InstancedMesh of one merged trunk+foliage geometry) ──

function buildPines(group) {
  const COUNT = 12;

  // One merged tree: trunk Cylinder(...,6 radial) + 3 stacked Icosahedron(r,0) foliage.
  const trunk = new THREE.CylinderGeometry(0.07, 0.10, 1.1, 6);
  trunk.translate(0, 0.55, 0); // base at y=0

  const f1 = new THREE.IcosahedronGeometry(0.55, 0); f1.translate(0, 1.15, 0);
  const f2 = new THREE.IcosahedronGeometry(0.45, 0); f2.translate(0, 1.65, 0);
  const f3 = new THREE.IcosahedronGeometry(0.32, 0); f3.translate(0, 2.05, 0);

  // mergeGeometries requires inputs to be ALL indexed or ALL non-indexed. The
  // Cylinder trunk is indexed but Icosahedron foliage is not, so normalize every
  // part to non-indexed before merging (otherwise the merge returns null).
  const treeParts = [trunk, f1, f2, f3].map(g => (g.index ? g.toNonIndexed() : g));
  const treeGeo = mergeGeometries(treeParts, false);
  [trunk, f1, f2, f3, ...treeParts].forEach(g => g.dispose());

  const pines = new THREE.InstancedMesh(treeGeo, SHARED_MATERIALS.gardenGreen, COUNT);
  pines.userData.selectable = false;

  // Hand-ish placement: clustered along the garden edges, clear of the pond and path.
  const dummy = new THREE.Object3D();
  const spots = [
    [-8.0, -14.5], [-8.6, -18.0], [-7.8, -22.0], [-8.4, -26.0],
    [ 7.8, -14.0], [ 8.5, -18.5], [ 7.6, -22.5], [ 8.3, -26.2],
    [-3.0, -26.6], [ 1.5, -27.0], [ 4.5, -26.4], [-1.0, -13.6],
  ];
  for (let i = 0; i < COUNT; i++) {
    const [x, z] = spots[i];
    const s = 0.85 + rnd() * 0.5;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.9 + rnd() * 0.3), s);
    dummy.updateMatrix();
    pines.setMatrixAt(i, dummy.matrix);
  }
  group.add(pines);
  freezeInstanced(pines);
}

// ── Scholar's rocks (taihu) — hand-placed, displaced Icosahedron(r,1), flatShading ──

function buildScholarRocks(group) {
  // Own Lambert instance with flatShading (SHARED_MATERIALS.inkBlack is smooth-shaded).
  const rockMat = new THREE.MeshLambertMaterial({ color: PALETTE.inkBlack, flatShading: true });

  // 6 distinct rocks: detail-1 icosa (~80 tris) with per-vertex displacement for craggy taihu look.
  const placements = [
    { p: [-4.0, -16.8], r: 0.55, s: [1.0, 1.6, 0.9] },   // hero near pond
    { p: [-2.2, -18.6], r: 0.42, s: [1.1, 1.3, 1.0] },
    { p: [ 2.6, -15.5], r: 0.48, s: [0.9, 1.5, 1.1] },
    { p: [ 3.4, -21.0], r: 0.40, s: [1.2, 1.1, 0.9] },
    { p: [-5.6, -23.0], r: 0.50, s: [1.0, 1.7, 0.8] },
    { p: [ 0.4, -24.5], r: 0.45, s: [1.1, 1.4, 1.0] },
  ];

  for (const { p, r, s } of placements) {
    const geo = new THREE.IcosahedronGeometry(r, 1);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Craggy radial displacement keyed off vertex direction (deterministic, no normals needed).
      const disp = 1 + (Math.sin(v.x * 7.3 + v.y * 4.1) * 0.18 + Math.sin(v.z * 5.7 - v.y * 3.3) * 0.14);
      v.multiplyScalar(disp);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals(); // flatShading recomputes face normals from these

    const rock = new THREE.Mesh(geo, rockMat);
    rock.position.set(p[0], r * s[1] * 0.62, p[1]); // sit on ground, base near y=0
    rock.scale.set(s[0], s[1], s[2]);
    rock.rotation.y = rnd() * Math.PI * 2;
    group.add(rock);
    freezeStatic(rock);
  }
}

// ── Pond — planar Reflector (real mirror reflection), gentle vertex ripple ─────

function buildWater(group) {
  const { w, d, center } = DIM.pond;
  const geo = new THREE.PlaneGeometry(w, d, 16, 12); // 17×13 verts → 384 tris
  // Reflection RTT resolution: full on desktop, quartered on Quest (myRole==='viewer')
  // since a Reflector re-renders the whole scene every frame (×2 in stereo).
  const res = myRole === 'viewer' ? 256 : 1024;
  const water = new Reflector(geo, {
    textureWidth: res,
    textureHeight: res,
    color: PALETTE.water,   // celadon tint multiplied into the mirror sample
    clipBias: 0.003,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(center[0], WATER_Y, center[2]); // just above the grass overlay
  water.userData.selectable = false;
  group.add(water);

  // Snapshot the flat rest pose; updateGarden waves these so the reflection ripples.
  // (Left matrixAutoUpdate=true — Reflector's onBeforeRender reads matrixWorld.)
  waterBase = Float32Array.from(geo.attributes.position.array);
  waterMesh = water;
}

// ── Volumetric ground mist — a few soft camera-facing fog cards over the garden ─

function makeMistTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // A soft, wide, low cloud: stretched radial core + a couple of offset puffs,
  // all fading to fully transparent at the edges (no hard rectangle seam).
  const blobs = [
    [0.50, 0.55, 0.52, 0.34],
    [0.30, 0.60, 0.34, 0.26],
    [0.72, 0.58, 0.32, 0.24],
  ];
  for (const [cx, cy, rx, ry] of blobs) {
    const grad = g.createRadialGradient(cx * S, cy * S, 0, cx * S, cy * S, Math.max(rx, ry) * S);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.save();
    g.translate(cx * S, cy * S);
    g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    g.translate(-cx * S, -cy * S);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx * S, cy * S, Math.max(rx, ry) * S, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildMist(group) {
  const tex = makeMistTexture();
  const LAYERS = myRole === 'viewer' ? 4 : 9;   // fewer on Quest (overdraw)
  const cardW = 13, cardH = 5.0;
  for (let i = 0; i < LAYERS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xF1F0EC,            // soft near-white ink-wash haze (reads over the green)
      transparent: true,
      opacity: 0.18 + (i % 3) * 0.05,
      depthWrite: false,          // don't occlude; just tint
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(cardW, cardH), mat);
    // Low mist banks hanging over the garden floor + pond; some clustered near the
    // pond (z≈-20) for a denser bank, the rest scattered through the trees.
    const nearPond = i % 2 === 0;
    const x = nearPond ? -4 + (rnd() - 0.5) * 9 : (rnd() - 0.5) * 17;
    const z = nearPond ? -20 + (rnd() - 0.5) * 6 : DIM.gardenZ0 - 1 - rnd() * 15; // -13..-28
    const y = 0.35 + rnd() * 1.1;  // hug the ground (eye-level haze)
    m.position.set(x, y, z);
    m.renderOrder = 20 + i;       // draw after opaque + water
    m.userData.selectable = false;
    m.frustumCulled = false;
    group.add(m);                 // billboarded each frame in updateGarden (no freeze)
    mistLayers.push({
      mesh: m,
      baseX: x, baseY: y, baseZ: z,
      drift: 0.10 + rnd() * 0.16,
      bob: 0.04 + rnd() * 0.05,
      phase: rnd() * Math.PI * 2,
    });
  }
}

// ── Stepping stones — flat Cylinder InstancedMesh across the pond/path ────────

function buildSteppingStones(group) {
  const COUNT = 12;
  const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 10);
  const stones = new THREE.InstancedMesh(geo, SHARED_MATERIALS.stonePlinth, COUNT);
  stones.userData.selectable = false;

  const dummy = new THREE.Object3D();
  // Curving line of stones crossing the pond toward the path.
  for (let i = 0; i < COUNT; i++) {
    const t = i / (COUNT - 1);
    const x = -5.5 + t * 7.0 + Math.sin(t * 6.0) * 0.4;
    const z = -22.0 + t * 4.5 + Math.cos(t * 4.0) * 0.5;
    const s = 0.8 + rnd() * 0.5;
    dummy.position.set(x, 0.03, z);
    dummy.rotation.set(0, rnd() * Math.PI, 0);
    dummy.scale.set(s, 1, s);
    dummy.updateMatrix();
    stones.setMatrixAt(i, dummy.matrix);
  }
  group.add(stones);
  freezeInstanced(stones);
}

// ── Ink-stone border rocks — Icosahedron(r,0) InstancedMesh, non-uniform scale ─

function buildBorderRocks(group) {
  const COUNT = 8;
  const geo = new THREE.IcosahedronGeometry(0.6, 0); // 20 tris each
  const rocks = new THREE.InstancedMesh(geo, SHARED_MATERIALS.inkBlack, COUNT);
  rocks.userData.selectable = false;

  const dummy = new THREE.Object3D();
  // Bound the garden visually around its perimeter (X ±10, Z -12..-28).
  const spots = [
    [-9.4, -14.0], [-9.6, -20.0], [-9.2, -26.0],
    [ 9.4, -15.0], [ 9.6, -21.0], [ 9.3, -27.0],
    [-4.0, -27.6], [ 4.0, -27.4],
  ];
  for (let i = 0; i < COUNT; i++) {
    const [x, z] = spots[i];
    dummy.position.set(x, 0.18, z);
    dummy.rotation.set(rnd() * 0.5, rnd() * Math.PI * 2, rnd() * 0.5);
    dummy.scale.set(0.8 + rnd() * 0.9, 0.5 + rnd() * 0.5, 0.8 + rnd() * 0.9);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  group.add(rocks);
  freezeInstanced(rocks);
}

// ── Pavilion silhouette — 4 posts + low hip roof + ridge box; bronze + 1 cinnabar band ─

function buildPavilion(group) {
  const px = 5.5, pz = -24.5;     // pavilion center (off to one side, framed by gate)
  const span = 2.2;               // half-distance between posts
  const postH = 2.4;
  const floorY = 0.0;

  // Bronze merged body: 4 posts + ridge box. Roof is its own (custom hip) but same bronze.
  const parts = [];
  const post = new THREE.CylinderGeometry(0.09, 0.10, postH, 8);
  for (const [dx, dz] of [[-span, -span], [span, -span], [span, span], [-span, span]]) {
    const g = post.clone();
    g.translate(px + dx, floorY + postH / 2, pz + dz);
    parts.push(g);
  }
  post.dispose();

  // Ridge box along the roof apex.
  const ridge = new THREE.BoxGeometry(span * 2.2, 0.12, 0.12);
  ridge.translate(px, floorY + postH + 0.55, pz);
  parts.push(ridge);

  const bronzeBody = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const bronzeMesh = new THREE.Mesh(bronzeBody, SHARED_MATERIALS.bronze);
  group.add(bronzeMesh);
  freezeStatic(bronzeMesh);

  // Low hip roof — a flattened 4-sided pyramid (ConeGeometry, 4 radial segments).
  // Custom low-poly silhouette (~8 tris), bronze.
  const roof = new THREE.ConeGeometry(span * 1.7, 0.75, 4, 1);
  roof.rotateY(Math.PI / 4); // align ridges with the square plan
  const roofMesh = new THREE.Mesh(roof, SHARED_MATERIALS.bronze);
  roofMesh.position.set(px, floorY + postH + 0.18, pz);
  group.add(roofMesh);
  freezeStatic(roofMesh);

  // THE single outdoor vermilion note: one cinnabar ridge band capping the apex.
  // Own Lambert instance (cinnabar isn't in SHARED_MATERIALS).
  const cinnabarMat = new THREE.MeshLambertMaterial({ color: PALETTE.cinnabar });
  const bandGeo = new THREE.BoxGeometry(span * 2.3, 0.08, 0.16);
  const band = new THREE.Mesh(bandGeo, cinnabarMat);
  band.position.set(px, floorY + postH + 0.62, pz);
  group.add(band);
  freezeStatic(band);
}

// ── Bamboo billboards — 2 crossed planes, alphaTest cutout (opaque), InstancedMesh ─

function buildBamboo(group) {
  const COUNT = 10;
  const tex = makeBambooAlphaTexture();

  // Two crossed quads merged into one billboard geometry (so 1 InstancedMesh draws both).
  const pw = 1.0, ph = 2.4;
  const q1 = new THREE.PlaneGeometry(pw, ph);
  q1.translate(0, ph / 2, 0);
  const q2 = q1.clone();
  q2.rotateY(Math.PI / 2);
  const crossed = mergeGeometries([q1, q2], false);
  q1.dispose(); q2.dispose();

  // Lambert + alphaTest cutout — NOT transparent (no depth-sort, no blending).
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    alphaMap: tex,
    color: PALETTE.gardenGreen,
    alphaTest: 0.5,
    transparent: false,
    side: THREE.DoubleSide,
  });

  const bamboo = new THREE.InstancedMesh(crossed, mat, COUNT);
  bamboo.userData.selectable = false;

  const dummy = new THREE.Object3D();
  // Cluster bamboo as a screening thicket toward the far corners.
  const spots = [
    [-6.8, -25.5], [-6.2, -26.4], [-7.4, -26.0], [-6.6, -27.0],
    [ 6.4, -25.2], [ 7.0, -26.0], [ 6.0, -26.8], [ 6.9, -27.2],
    [-0.5, -27.4], [ 0.6, -27.6],
  ];
  for (let i = 0; i < COUNT; i++) {
    const [x, z] = spots[i];
    const s = 0.85 + rnd() * 0.6;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rnd() * Math.PI, 0);
    dummy.scale.set(s, s * (0.9 + rnd() * 0.4), s);
    dummy.updateMatrix();
    bamboo.setMatrixAt(i, dummy.matrix);
  }
  group.add(bamboo);
  freezeInstanced(bamboo);
}

// ── Sculpture pads — Circle(1.1,24) at z=-15,-20,-25 ──────────────────────────

function buildSculpturePads(group) {
  const geo = new THREE.CircleGeometry(1.1, 24);
  const zs = [-15, -20, -25];
  const xs = [-2.5, 3.2, -1.0]; // spread across the garden, off the path/pond line
  for (let i = 0; i < zs.length; i++) {
    const pad = new THREE.Mesh(geo.clone(), SHARED_MATERIALS.stonePlinth);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(xs[i], GRASS_Y + 0.004, zs[i]); // above the grass overlay
    pad.receiveShadow = true;
    group.add(pad);
    freezeStatic(pad);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initGarden() {
  // Idempotent guard.
  if (gardenGroup) return gardenGroup;

  gardenGroup = new THREE.Group();
  gardenGroup.name = 'GardenDecor';
  gardenGroup.userData.selectable = false;

  buildGround(gardenGroup);
  buildPines(gardenGroup);
  buildScholarRocks(gardenGroup);
  buildWater(gardenGroup);
  buildSteppingStones(gardenGroup);
  buildBorderRocks(gardenGroup);
  buildPavilion(gardenGroup);
  buildBamboo(gardenGroup);
  buildSculpturePads(gardenGroup);
  buildMist(gardenGroup);

  galleryGroup.add(gardenGroup);
  return gardenGroup;
}

export function updateGarden(t) {
  // ── Drifting, camera-facing volumetric mist (always — it's cheap, few cards) ──
  if (mistLayers.length && camera) {
    for (const L of mistLayers) {
      const m = L.mesh;
      m.position.x = L.baseX + Math.sin(t * L.drift + L.phase) * 1.6;
      m.position.y = L.baseY + Math.sin(t * 0.5 + L.phase) * L.bob;
      m.quaternion.copy(camera.quaternion); // billboard toward the viewer
    }
  }

  // ── Pond ripple — wave the Reflector's verts so the mirror reflection shimmers ─
  if (!waterMesh || !waterBase) return;

  // Quest throttle: re-wave the water every OTHER frame when a 'viewer' (Quest UA).
  frameParity ^= 1;
  if (myRole === 'viewer' && frameParity === 1) return;

  const pos = waterMesh.geometry.attributes.position;
  const base = waterBase;
  // Plane is built in XY then rotated -90° about X: local x = world x, local y = world -z.
  // The wave displaces the plane's local Z (its normal axis before rotation → world Y after).
  for (let i = 0; i < pos.count; i++) {
    const ix = i * 3;
    const x = base[ix];
    const y = base[ix + 1];
    const wave =
      Math.sin(x * 1.6 + t * 1.3) * 0.016 +
      Math.sin(y * 2.1 - t * 0.9) * 0.012;
    pos.array[ix]     = x;
    pos.array[ix + 1] = y;
    pos.array[ix + 2] = base[ix + 2] + wave;
  }
  pos.needsUpdate = true;
}
