/**
 * tokens.js — single source of truth for the exhibition design system.
 *
 * Pure constants + shared material instances. Import PALETTE / PALETTE_CSS / DIM /
 * SHARED_MATERIALS anywhere; never hardcode a gallery color or dimension elsewhere.
 *
 * Aesthetic: white-cube minimalism + restrained Chinese motifs (moon-gate, ink-wash
 * garden, warm stone). Disciplined accents — cinnabar 朱红, jade/celadon 青, ink 墨,
 * aged bronze 青铜 — delivered through material color, never geometry detail.
 *
 * See docs/EXHIBITION_DESIGN_SYSTEM.md for the authoritative spec.
 */
import * as THREE from 'three';

// ── Master palette (THREE hex) ───────────────────────────────────────────────
export const PALETTE = {
  wallWhite:   0xEDEAE3, // warm off-white — walls, ceiling, partitions, robot shell
  floor:       0xD8D2C7, // warm neutral stone — master walkable plane
  ceiling:     0xF4F2EC, // marginally brighter so it recedes
  stonePlinth: 0xCFC8BB, // podiums, daises, garden path/pads/stepping stones
  trim:        0xB7AE9F, // picture-rail band, vitrine accents, wall reveals
  inkBlack:    0x1C1B1A, // 墨 — baseboards, scholar's rocks, occluders, detail
  cinnabar:    0xC8442E, // 朱红 — THE single hero accent (moon-gate ring, inlay, UI)
  cinnabarEmissive: 0xE0553A, // emissive variant for the gate ring / floor inlay
  jade:        0x6FA08C, // 青 — robot docent visor + accent glow (emissive)
  bronze:      0x7A6A4F, // 青铜 — gate frame, rails, vitrine frames, robot joints
  gardenGreen: 0x5B7355, // desaturated literati green — ground overlay, foliage
  water:       0x7E9AA0, // soft celadon-grey pond, opaque
  sky:         0xE8E4DB, // pale warm ink-wash overcast (shared indoor+garden)
};

// ── UI palette (CSS strings) — "paper and stone" chrome ──────────────────────
export const PALETTE_CSS = {
  wallWhite:   '#EDEAE3',
  floor:       '#D8D2C7',
  ceiling:     '#F4F2EC',
  stonePlinth: '#CFC8BB',
  trim:        '#B7AE9F',
  inkBlack:    '#1C1B1A',
  cinnabar:    '#C8442E', // primary / active / focus
  jade:        '#6FA08C', // save / confirm / xr-ready
  bronze:      '#7A6A4F', // hover / underline
  brick:       '#A6433A', // destructive (delete / exit-vr / danger)
  amber:       '#B07A1E', // caution
  paper:       '#FBF8F2', // panel fill (use @ 0.94 alpha)
  hairline:    '#E4DCCB', // 1px warm-stone keyline
  inkText:     '#1F1B16', // primary chrome text
  mutedText:   '#6E665A', // taglines / hints / placeholders
  letterbox:   '#2A2622', // body background behind the canvas
};

// ── Master dimensions (meters) — canonical coordinate system ─────────────────
export const DIM = {
  gallery: { x: 14, z: 18 },           // interior clear: X -7..+7, Z +6..-12
  ceiling: 4.2,
  wallT: 0.20,
  entranceZ: 6.2,                      // entrance wall segments (spawn at z=4 clears it)
  entranceGap: 3.0,                    // centered doorway width
  moonGate: 2.6,                       // opening diameter
  moonGateCenter: [0, 1.6, -12],
  plinthS: [0.4, 0.9, 0.4],            // WxHxD — neolithic/jade small artifacts
  plinthM: [0.6, 0.9, 0.6],            // default podium
  plinthL: [1.0, 0.6, 1.0],            // sculpture / contemporary dais
  autoPlaceTarget: [1.2, 0, 0],        // hardcoded in assets.js normalizeAndPlace
  firstPlinthCenter: [1.2, 0.45, 0],   // top y=0.9 under the auto-placed art
  railH: 1.55,                         // 2D hang centerline
  railTrimY: 2.6,                      // bronze picture-rail band height
  baseboardH: 0.12,
  garden: { x: 20, z: 16 },            // X -10..+10, Z -12..-28
  gardenZ0: -12,                       // moon-gate seam
  gardenZ1: -28,                       // back border
  pathW: 1.4,
  pond: { w: 5, d: 4, center: [-4, 0.01, -20] },
  shadowOrtho: 9,                      // sun shadow camera ortho half-extent
  shadowTarget: [0, 0, -3],            // covers walkable z (+5..-12)
  shadowNear: 0.5,
  shadowFar: 40,
  floorPlane: { w: 34, d: 46 },        // master y=0 plane (indoor + garden)
};

// ── Shared material instances ────────────────────────────────────────────────
// ONE instance per bulk-decor role (fewer shader programs / state changes).
// Reuse these for STATIC decor. Animated/emissive-unique surfaces (robot visor,
// pond water, moon-gate ring, floor inlay) must create their OWN instances so
// their emissive/positions can animate without coupling.
function createSharedMaterials() {
  return {
    wallWhite:   new THREE.MeshLambertMaterial({ color: PALETTE.wallWhite }),
    ceiling:     new THREE.MeshLambertMaterial({ color: PALETTE.ceiling }),
    floor:       new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.85, metalness: 0.0 }),
    stonePlinth: new THREE.MeshLambertMaterial({ color: PALETTE.stonePlinth }),
    trim:        new THREE.MeshLambertMaterial({ color: PALETTE.trim }),
    inkBlack:    new THREE.MeshLambertMaterial({ color: PALETTE.inkBlack }),
    bronze:      new THREE.MeshStandardMaterial({ color: PALETTE.bronze, metalness: 0.6, roughness: 0.45 }),
    gardenGreen: new THREE.MeshLambertMaterial({ color: PALETTE.gardenGreen }),
  };
}

export const SHARED_MATERIALS = createSharedMaterials();
