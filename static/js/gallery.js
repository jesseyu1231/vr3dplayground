/**
 * gallery.js — Indoor White-Cube Architecture (§1 floor ownership, §2 envelope,
 * moon-gate). Wending Pavilion / 文徵阁.
 *
 * Locomotion is collision-free free-fly (vr.js); no wall collision or gate
 * triggers exist or are needed. All meshes here are non-selectable decor,
 * excluded from importedObjects/HUD/export by design (they live under the
 * galleryGroup added to scene in state.js, which the asset panel / select /
 * delete / clone / Final Delivery Export / poly HUD never traverse).
 *
 * gallery.js owns the ONE master walkable y=0 plane (indoor + garden footprint);
 * garden.js overlays only the green ground + path for z < -12. No seam.
 *
 * Build target: indoor structural tris < 8,000 (~1.7K expected), ~11 draw calls.
 * ONE shadow-casting light only (the sun) — everything here is castShadow=false
 * except the floor/plinths which only RECEIVE shadow (plinths may cast; dropped
 * first if frames dip). The single hero accent is the cinnabar moon-gate ring.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { galleryGroup } from './state.js';
import { PALETTE, DIM, SHARED_MATERIALS } from './tokens.js';

// ── Interior extents derived from DIM (single source of truth) ───────────────
const HALF_X = DIM.gallery.x / 2;          // ±7
const ENTRANCE_Z = DIM.entranceZ;          // +6.2 (entrance wall)
const GATE_Z = DIM.gardenZ0;               // -12 (moon-gate far wall)
const NAVE_LEN = ENTRANCE_Z - GATE_Z;      // 18.2 interior depth (z +6.2..-12)
const NAVE_MID_Z = (ENTRANCE_Z + GATE_Z) / 2; // center of side walls
const CEIL_Y = DIM.ceiling;                // 4.2
const WALL_T = DIM.wallT;                  // 0.20
const WALL_H = CEIL_Y;                      // walls span floor..ceiling

// Freeze a static mesh: bake matrices, stop per-frame recompute, mark safe.
function freeze(mesh) {
  mesh.userData.selectable = false;
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// Translate a BoxGeometry to a world position (for merging into one buffer).
function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function initGallery() {
  // ── 1. Master walkable floor (the ONE continuous y=0 plane) ────────────────
  // Covers indoor + garden footprint. garden.js overlays green for z < -12.
  // MeshStandard floor is a hero surface (SHARED_MATERIALS.floor); receives the
  // single sun's shadow.
  const floorGeo = new THREE.PlaneGeometry(DIM.floorPlane.w, DIM.floorPlane.d, 1, 1);
  const floor = new THREE.Mesh(floorGeo, SHARED_MATERIALS.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  floor.castShadow = false;
  floor.name = 'GalleryFloor';
  galleryGroup.add(freeze(floor));

  // ── 2. Walls + ceiling envelope (one merged wallWhite Lambert mesh) ────────
  // 2 side walls @ x=±7, entrance wall as 2 segments @ z=6.2 with a centered
  // entranceGap, + ceiling plane facing -Y @ y=4.2. castShadow=false.
  const envParts = [];

  // Side walls: span the nave depth, full height, thin in X.
  envParts.push(boxAt(WALL_T, WALL_H, NAVE_LEN, +HALF_X, WALL_H / 2, NAVE_MID_Z));
  envParts.push(boxAt(WALL_T, WALL_H, NAVE_LEN, -HALF_X, WALL_H / 2, NAVE_MID_Z));

  // Entrance wall @ z=6.2: two segments framing a centered DIM.entranceGap door.
  const segW = (DIM.gallery.x - DIM.entranceGap) / 2;   // (14-3)/2 = 5.5
  const segCx = DIM.entranceGap / 2 + segW / 2;         // 1.5 + 2.75 = 4.25
  envParts.push(boxAt(segW, WALL_H, WALL_T, +segCx, WALL_H / 2, ENTRANCE_Z));
  envParts.push(boxAt(segW, WALL_H, WALL_T, -segCx, WALL_H / 2, ENTRANCE_Z));

  // Ceiling: flat plane facing down (-Y) at y=4.2. Build as a thin box-less
  // plane via a 2-tri BoxGeometry would add bottom faces; use a PlaneGeometry
  // rotated to face -Y, merged in.
  const ceilGeo = new THREE.PlaneGeometry(DIM.gallery.x, NAVE_LEN, 1, 1);
  ceilGeo.rotateX(Math.PI / 2);          // normal now points -Y (downward into room)
  ceilGeo.translate(0, CEIL_Y, NAVE_MID_Z);
  envParts.push(ceilGeo);

  const envGeo = mergeGeometries(envParts, false);
  const envelope = new THREE.Mesh(envGeo, SHARED_MATERIALS.wallWhite);
  envelope.castShadow = false;
  envelope.receiveShadow = true;
  envelope.name = 'GalleryEnvelope';
  galleryGroup.add(freeze(envelope));

  // ── 3. Moon-gate far wall @ z=-12 (4 box segments + cinnabar ring) ─────────
  // NO CSG: 4 boxes frame the DIM.moonGate aperture. Bottom flush to floor.
  const [gateX, gateY] = DIM.moonGateCenter;          // [0, 1.6]
  const aperture = DIM.moonGate;                       // 2.6 opening diameter
  const apR = aperture / 2;                            // 1.3
  const wallW = DIM.gallery.x;                         // 14 full width
  const gateBottom = gateY - apR;                      // 0.3 — bottom of opening
  const gateTop = gateY + apR;                         // 2.9 — top of opening

  const gateParts = [];
  // Left jamb: full height, from -7 to aperture left edge.
  const leftW = (wallW / 2) - apR;                     // 7 - 1.3 = 5.7
  gateParts.push(boxAt(leftW, WALL_H, WALL_T, -(apR + leftW / 2), WALL_H / 2, 0));
  // Right jamb (mirror).
  gateParts.push(boxAt(leftW, WALL_H, WALL_T, +(apR + leftW / 2), WALL_H / 2, 0));
  // Lintel: above the opening, spans the aperture width.
  const lintelH = CEIL_Y - gateTop;                    // 4.2 - 2.9 = 1.3
  gateParts.push(boxAt(aperture, lintelH, WALL_T, 0, gateTop + lintelH / 2, 0));
  // Sill: below the opening, spans the aperture width (bottom flush to floor).
  gateParts.push(boxAt(aperture, gateBottom, WALL_T, 0, gateBottom / 2, 0));

  const gateWallGeo = mergeGeometries(gateParts, false);
  const gateWall = new THREE.Mesh(gateWallGeo, SHARED_MATERIALS.wallWhite);
  gateWall.position.z = GATE_Z;                         // -12
  gateWall.castShadow = false;
  gateWall.receiveShadow = true;
  gateWall.name = 'MoonGateWall';
  galleryGroup.add(freeze(gateWall));

  // Cinnabar ring — THE single hero accent. OWN MeshStandard instance with
  // emissive PALETTE.cinnabarEmissive (~0.2). Ring inner ~1.39, OD ~2.9.
  const ringMat = new THREE.MeshStandardMaterial({
    color: PALETTE.cinnabar,
    emissive: PALETTE.cinnabarEmissive,
    emissiveIntensity: 0.2,
    metalness: 0.3,
    roughness: 0.5,
  });
  const ringGeo = new THREE.TorusGeometry(1.45, 0.06, 6, 48);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(gateX, gateY, GATE_Z);
  ring.castShadow = false;
  ring.receiveShadow = false;
  ring.name = 'MoonGateRing';
  galleryGroup.add(freeze(ring));

  // ── 4. Plinths S/M/L — one InstancedMesh per size class (unit box + scale) ──
  // Unit BoxGeometry; per-instance scale gives the S/M/L footprints. Top faces
  // land at y = H (since unit box pivots at center, instance y = H/2).
  // Rotunda (origin) kept clear except the first M plinth @ firstPlinthCenter.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  // Per-instance placement helper. positions are [x, z, scaleW, scaleH, scaleD].
  function buildPlinthClass(name, dims, placements, castShadow) {
    const [w, h, d] = dims;
    const mesh = new THREE.InstancedMesh(unitBox, SHARED_MATERIALS.stonePlinth, placements.length);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.selectable = false;
    const m = new THREE.Matrix4();
    placements.forEach(([x, z], i) => {
      m.makeScale(w, h, d);
      m.setPosition(x, h / 2, z);   // top face at y = h, base at y = 0
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  // Zone A Neolithic/Jade small artifacts (X -2..-6, Z 0..-4): S plinths.
  // (Vitrines also sit here; plinths give a few open small podiums.)
  const sPlacements = [
    [-3.2, -0.8],
    [-5.0, -3.2],
  ];
  // Zone B Bronze/Sculpture (X +2..+6, Z -2..-8): M + L plinths, plus the
  // REQUIRED first M plinth centered at firstPlinthCenter (1.2,_,0) in rotunda.
  const fp = DIM.firstPlinthCenter;        // [1.2, 0.45, 0]
  const mPlacements = [
    [fp[0], fp[2]],                        // first M plinth (rotunda, art lands here)
    [3.2, -3.0],
    [5.0, -5.4],
  ];
  const lPlacements = [
    [4.2, -7.4],                           // sculpture dais, Zone B deep
  ];

  galleryGroup.add(buildPlinthClass('PlinthsS', DIM.plinthS, sPlacements, true));
  galleryGroup.add(buildPlinthClass('PlinthsM', DIM.plinthM, mPlacements, true));
  galleryGroup.add(buildPlinthClass('PlinthsL', DIM.plinthL, lPlacements, true));

  // ── 5. Open-frame vitrines (bronze edge bars merged into a cage) ──────────
  // 12 thin bars merged into ONE unit-cage geometry, then InstancedMesh. NO
  // glass mesh. Cage footprint ~0.7 x 1.3(tall) x 0.7; sits on the floor.
  const cageW = 0.7, cageH = 1.3, cageD = 0.7, bar = 0.04;
  const hx = cageW / 2, hz = cageD / 2;
  const cageParts = [];
  // 4 verticals (corner posts), height cageH, centered at y = cageH/2.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cageParts.push(boxAt(bar, cageH, bar, sx * hx, cageH / 2, sz * hz));
  }
  // 4 top rails + 4 bottom rails framing the box.
  for (const yy of [bar / 2, cageH - bar / 2]) {
    cageParts.push(boxAt(cageW, bar, bar, 0, yy, -hz)); // front X-rail
    cageParts.push(boxAt(cageW, bar, bar, 0, yy, +hz)); // back X-rail
    cageParts.push(boxAt(bar, bar, cageD, -hx, yy, 0)); // left Z-rail
    cageParts.push(boxAt(bar, bar, cageD, +hx, yy, 0)); // right Z-rail
  }
  const cageGeo = mergeGeometries(cageParts, false);

  // Zone A Neolithic/Jade vitrines (X -2..-6, Z 0..-4): 4 open cages.
  const vitrinePlacements = [
    [-2.4, -0.6],
    [-4.4, -1.4],
    [-2.8, -3.4],
    [-5.6, -1.0],
  ];
  const vitrines = new THREE.InstancedMesh(cageGeo, SHARED_MATERIALS.bronze, vitrinePlacements.length);
  vitrines.name = 'Vitrines';
  vitrines.castShadow = false;
  vitrines.receiveShadow = false;
  vitrines.userData.selectable = false;
  {
    const m = new THREE.Matrix4();
    vitrinePlacements.forEach(([x, z], i) => {
      m.makeTranslation(x, 0, z);   // cage already sits with base at y=0
      vitrines.setMatrixAt(i, m);
    });
    vitrines.instanceMatrix.needsUpdate = true;
    vitrines.updateMatrix();
    vitrines.updateMatrixWorld(true);
    vitrines.matrixAutoUpdate = false;
  }
  galleryGroup.add(vitrines);

  // ── 6. Picture-rail trim band @ y=railTrimY on side walls (bronze) ────────
  // Thin bronze strip along each side wall, just inside the wall face. Its own
  // bronze material (cannot fold into the wallWhite merge without losing color).
  const railLen = NAVE_LEN;
  const railH = 0.06, railD = 0.03;
  const railInsetX = HALF_X - WALL_T / 2 - railD / 2;   // hug inner wall face
  const railParts = [
    boxAt(railD, railH, railLen, +railInsetX, DIM.railTrimY, NAVE_MID_Z),
    boxAt(railD, railH, railLen, -railInsetX, DIM.railTrimY, NAVE_MID_Z),
  ];
  const railGeo = mergeGeometries(railParts, false);
  const rails = new THREE.Mesh(railGeo, SHARED_MATERIALS.bronze);
  rails.name = 'PictureRailTrim';
  rails.castShadow = false;
  rails.receiveShadow = false;
  galleryGroup.add(freeze(rails));

  // ── 7. Zone C free-standing partitions (wallWhite, castShadow=false) ──────
  // 2 partitions in the painting/scroll zone (Z -6..-10) for hanging works.
  const partGeo = new THREE.BoxGeometry(5, 3.6, 0.2);
  const partPlacements = [
    { x: -2.5, z: -7.5, ry: Math.PI / 2 },   // runs along Z, faces +X aisle
    { x: 2.5, z: -9.0, ry: Math.PI / 2 },    // runs along Z, faces -X aisle
  ];
  partPlacements.forEach((p, i) => {
    const part = new THREE.Mesh(partGeo, SHARED_MATERIALS.wallWhite);
    part.position.set(p.x, 1.8, p.z);        // base y=0 (half of 3.6)
    part.rotation.y = p.ry;
    part.castShadow = false;
    part.receiveShadow = true;
    part.name = `ZoneCPartition${i}`;
    galleryGroup.add(freeze(part));
  });

  // ── 8. Zone D contemporary platforms (stonePlinth InstancedMesh) ──────────
  // 2 low platforms (2.2 x 0.15 x 2.2) before the gate (Z -9..-12).
  const platGeo = new THREE.BoxGeometry(2.2, 0.15, 2.2);
  const platPlacements = [
    [-3.5, -10.4],
    [3.5, -10.4],
  ];
  const platforms = new THREE.InstancedMesh(platGeo, SHARED_MATERIALS.stonePlinth, platPlacements.length);
  platforms.name = 'ContemporaryPlatforms';
  platforms.castShadow = false;
  platforms.receiveShadow = true;
  platforms.userData.selectable = false;
  {
    const m = new THREE.Matrix4();
    platPlacements.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.075, z);        // base flush to floor
      platforms.setMatrixAt(i, m);
    });
    platforms.instanceMatrix.needsUpdate = true;
    platforms.updateMatrix();
    platforms.updateMatrixWorld(true);
    platforms.matrixAutoUpdate = false;
  }
  galleryGroup.add(platforms);

  // ── 9. Cinnabar floor-inlay line (own Lambert + emissive, y≈0.012) ────────
  // A guiding axis line down the nave centerline. Own material (emissive
  // #E0553A @ 0.2) + polygonOffset so it never z-fights the master floor.
  const inlayMat = new THREE.MeshLambertMaterial({
    color: PALETTE.cinnabar,
    emissive: PALETTE.cinnabarEmissive,
    emissiveIntensity: 0.2,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const inlayW = 0.08;
  // Run from just inside the entrance to the gate threshold.
  const inlayZ0 = 4.0, inlayZ1 = GATE_Z + 0.2;
  const inlayLen = inlayZ0 - inlayZ1;
  const inlayGeo = new THREE.PlaneGeometry(inlayW, inlayLen, 1, 1);
  inlayGeo.rotateX(-Math.PI / 2);            // lie flat, normal +Y
  const inlay = new THREE.Mesh(inlayGeo, inlayMat);
  inlay.position.set(0, 0.012, (inlayZ0 + inlayZ1) / 2);
  inlay.castShadow = false;
  inlay.receiveShadow = false;
  inlay.name = 'CinnabarFloorInlay';
  galleryGroup.add(freeze(inlay));

  // ── 10. Ink-black baseboard loop (merged thin box loop, y=0..baseboardH) ──
  const bbH = DIM.baseboardH;                // 0.12
  const bbT = 0.05;                          // protrusion off the wall face
  const bbY = bbH / 2;
  const bbInsetX = HALF_X - WALL_T / 2 - bbT / 2;
  const bbParts = [];
  // Two side runs (along Z).
  bbParts.push(boxAt(bbT, bbH, NAVE_LEN, +bbInsetX, bbY, NAVE_MID_Z));
  bbParts.push(boxAt(bbT, bbH, NAVE_LEN, -bbInsetX, bbY, NAVE_MID_Z));
  // Entrance run (along X) split around the doorway gap, at z just inside wall.
  const bbEntZ = ENTRANCE_Z - WALL_T / 2 - bbT / 2;
  const bbSegW = (DIM.gallery.x - DIM.entranceGap) / 2;
  const bbSegCx = DIM.entranceGap / 2 + bbSegW / 2;
  bbParts.push(boxAt(bbSegW, bbH, bbT, +bbSegCx, bbY, bbEntZ));
  bbParts.push(boxAt(bbSegW, bbH, bbT, -bbSegCx, bbY, bbEntZ));
  // Far (gate) wall run (along X) split around the moon-gate aperture.
  const bbGateZ = GATE_Z + WALL_T / 2 + bbT / 2;
  const bbGateSegW = (DIM.gallery.x / 2) - (DIM.moonGate / 2);
  const bbGateCx = (DIM.moonGate / 2) + bbGateSegW / 2;
  bbParts.push(boxAt(bbGateSegW, bbH, bbT, +bbGateCx, bbY, bbGateZ));
  bbParts.push(boxAt(bbGateSegW, bbH, bbT, -bbGateCx, bbY, bbGateZ));

  const bbGeo = mergeGeometries(bbParts, false);
  const baseboard = new THREE.Mesh(bbGeo, SHARED_MATERIALS.inkBlack);
  baseboard.name = 'Baseboard';
  baseboard.castShadow = false;
  baseboard.receiveShadow = true;
  galleryGroup.add(freeze(baseboard));

  // ── Structural tri audit (auditable, per §7) ───────────────────────────────
  let tris = 0;
  galleryGroup.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const idx = o.geometry.index;
      const pos = o.geometry.attributes.position;
      const triPer = idx ? idx.count / 3 : (pos ? pos.count / 3 : 0);
      const count = o.isInstancedMesh ? o.count : 1;
      tris += triPer * count;
    }
  });
  console.log(`[gallery] indoor structural tris: ~${Math.round(tris)} (cap 8,000)`);
}
