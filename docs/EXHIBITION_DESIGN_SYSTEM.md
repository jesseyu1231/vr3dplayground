# Wending Pavilion / 文徵阁 — Authoritative Exhibition Design System

> A WebXR + Three.js (r0.163, CDN importmap, no build step) immersive gallery for Chinese artwork, Neolithic to Contemporary. Runs on Meta Quest 3/3S in WebXR and on desktop. This document is the single build-ready source of truth. It reconciles six workstreams (architecture, garden, robot docent, lighting/env, UI identity, perf/tokens) and applies every required vet fix. Implementers build from THIS document; the original proposals are superseded.

---

## 0. Vision

A global-museum **white-cube** exhibition hall on the +Z→−Z axis. The player spawns at `(0,1.6,4)` facing −Z, is greeted by a hovering **low-poly robot docent** at the origin rotunda, walks past four chronological display zones (Neolithic → Bronze → Painting → Contemporary), and arrives at a **2.6 m bronze-ringed MOON-GATE** punched through the far wall. Beyond the gate lies a restrained **literati ink-wash garden** (scholar's rocks, still pond, low-poly pine, a pavilion silhouette) — the classic Suzhou "borrowed scenery" view framed by the round portal. The whole environment is engineered to consume **~14–20K triangles** so the 250K/scene Quest budget stays almost entirely available for the ART. Disciplined accents (cinnabar 朱红, celadon/jade 青, ink black 墨, aged bronze 青铜) are delivered through **material color + one emissive moon-gate ring**, never geometry detail, so the art remains the subject.

### Global hard rules (apply to every workstream)
1. **ONE shadow-casting light** — the sun (`dirLight`). All other lights (ambient, hemisphere, rim, fill, and ALL user-added lights) are `castShadow=false`. This is the #1 framerate lever.
2. **Floor is a continuous walkable plane at exactly y=0** spanning indoor + garden. No y-step at the moon-gate. VR locomotion (`vr.js`) is free-fly thumbstick with `dolly` pinned to y=0 — there is **no collision and no invisible walls**; solid walls are visual only. Players CAN walk through walls/gate. Do not build collision geometry or gate triggers.
3. **Structural decor is NEVER user art.** All gallery + garden meshes go into a dedicated non-selectable group (`galleryGroup`) added to `scene`, never to `importedObjects`/`userContentGroup`. Verified: this auto-excludes them from the asset panel, select/delete/clone, Final Delivery Export, and the poly HUD (all of which traverse only `importedObjects`/`userLights`).
4. **`scene.fog` MUST stay a live `FogExp2` instance — NEVER null it.** `applyEnvPreset()` (environment.js:28-29) unconditionally does `scene.fog.color.setHex(...)` / `scene.fog.density = ...`. Nulling fog throws `TypeError` on the first Env click and kills all presets. Keep it alive at density ≈ 0.
5. **All four env presets keep the identical 9-key shape** `{name, sky, fog, fogD, ambC, ambI, dirC, dirI, dirP, exp}`. Indices are load-bearing for multiplayer sync (`multiplayer.js:55`), undo (`undo.js:157`), saved-scene restore (`assets.js:491`). Array length stays 4. Any new field must exist on all 4 and be guarded in `applyEnvPreset`.
6. **Shared tokens, not hardcoded values.** Every workstream imports `PALETTE` / `DIM` / `SHARED_MATERIALS` from `static/js/tokens.js`. No module hardcodes a gallery color or dimension.
7. **Material strategy:** `MeshStandardMaterial` only for hero PBR surfaces (robot, moon-gate ring, water, indoor floor). All bulk decor (walls, ceiling, plinths, garden foliage/rocks/ground) uses `MeshLambertMaterial` (cheaper per-fragment on Quest, still lit by the one sun + ambient). Lambert ignores metalness/roughness; metallic cues live only on the Standard pieces.
8. **No transparency where avoidable.** Vitrines are open bronze frames (no glass mesh). Foliage uses `alphaTest` cutout, never blended transparency. Water is opaque (no Reflector/RTT/PMREM). Glass, if ever needed, is a single `depthWrite:false` pane rendered last.

---

## 1. Canonical Coordinate System & Master Dimensions (SINGLE SOURCE OF TRUTH)

This resolves the three conflicting footprints (16×28 / 12×16 / 36×30). **Final reconciled layout:**

| Token | Value (m) | World extent | Notes |
|---|---|---|---|
| `gallery` footprint | 14 (X) × 18 (Z) | X −7..+7, Z +6 (entrance) .. −12 (moon-gate wall) | Interior clear. Sized so ONE sun ortho frustum (±9 X, fitted Z) covers it at 2048/1536 map. |
| `ceiling` height | 4.2 | floor y=0 → underside y=4.2 | Generous for 4 m art + scroll headroom. |
| `wallT` (thickness) | 0.20 | — | BoxGeometry depth; reads solid at moon-gate reveal & door returns. ~12 tris/box. |
| Entrance threshold | — | gap centered at Z=+6, 3 m wide | **Entrance wall segments sit at Z=+6.2 (occupy z=+6.10..+6.30).** Spawn at z=4.0 is well clear — fixes the spawn-clipping bug. |
| `moonGate` opening dia | 2.6 | center `(0, 1.6, −12)` | Bottom flush to floor; 1.5 m visual walk-through. Ring OD ~2.9. |
| `plinthS` (W×H×D) | 0.4 × 0.9 × 0.4 | top face y=0.9 | Neolithic/jade small artifacts. |
| `plinthM` (W×H×D) | 0.6 × 0.9 × 0.6 | top face y=0.9 | **Default podium; first M plinth centered at `(1.2, 0.45, 0)` so top y=0.9 sits under the auto-placed art.** |
| `plinthL` (W×H×D) | 1.0 × 0.6 × 1.0 | top face y=0.6 | Sculpture / contemporary low dais. |
| `railH` (2D hang centerline) | 1.55 | — | Museum standard. Art centered y=1.55 on walls at x=±6.85 facing inward. |
| `railTrimY` (picture-rail band) | 2.6 | — | Thin bronze trim band along side walls; visual hang cue. |
| `baseboardH` | 0.12 | y=0..0.12 | Ink-black perimeter band, merged BufferGeometry. |
| `garden` footprint | 20 (X) × 16 (Z) | X −10..+10, Z −12 (gate) .. −28 (back border) | Beyond moon-gate. Open sky, no ceiling. Bounded by visual ink-stone border, not a wall. |
| `pathW` (garden path) | 1.4 | inset strip on garden ground | Lighter stone, y=0.002 above garden ground. |
| `shadowOrtho` | ±9 (18×18) | near 0.5, far 40 | Sun shadow camera. **`dirLight.target` set to `(0,0,−3)` and added to scene** so the frustum covers the walkable gallery z-range (+5..−12). Garden beyond z≈−13 intentionally casts NO shadow. |
| `pond` | 5 × 4 | center `(−4, 0.01, −20)` | Off-center literati asymmetry. Opaque celadon-grey. |

**`DIM` export shape (tokens.js):**
```js
export const DIM = {
  gallery:{x:14,z:18}, ceiling:4.2, wallT:0.20,
  entranceZ:6.2, moonGate:2.6, moonGateCenter:[0,1.6,-12],
  plinthS:[0.4,0.9,0.4], plinthM:[0.6,0.9,0.6], plinthL:[1.0,0.6,1.0],
  autoPlaceTarget:[1.2,0,0], firstPlinthCenter:[1.2,0.45,0],
  railH:1.55, railTrimY:2.6, baseboardH:0.12,
  garden:{x:20,z:16}, gardenZ0:-12, gardenZ1:-28, pathW:1.4,
  pond:{w:5,d:4,center:[-4,0.01,-20]},
  shadowOrtho:9, shadowTarget:[0,0,-3], shadowNear:0.5, shadowFar:40,
};
```

**Floor ownership (resolved):** `gallery.js` lays ONE continuous walkable plane `PlaneGeometry(34,46)` at y=0 covering BOTH indoor and garden (X −17..+17, Z −28..+18 nominal), `receiveShadow=true`, material `PALETTE.floor`. The garden module then overlays a coplanar garden-ground plane (`PALETTE.gardenGreen`) for z<−12 at y=0 and a path strip at y=0.002. No seam, no gap, no z-fight. `gallery.js` owns the master y=0 plane; `garden.js` owns only the green overlay + path for z<−12.

---

## 2. Indoor White-Cube Architecture

**Module:** new `static/js/gallery.js` exporting `initGallery()` and `GALLERY_DECOR` (THREE.Group, `name:'GalleryDecor'`, `userData.selectable=false`). Build everything into `galleryGroup` (from state.js), add it to `scene`.

**Header comment must state:** "Locomotion is collision-free free-fly (vr.js); no wall collision or gate triggers exist or are needed. All meshes here are non-selectable decor, excluded from importedObjects/HUD/export by design."

### Layout (four zones along −Z nave)
- **Rotunda** (entrance, around origin): robot docent + auto-placement point `(1.2,0,0)`. Keep clear of furniture except the one M plinth at `(1.2,0.45,0)`.
- **Zone A Neolithic/Jade** (near entrance, X −2..−6, Z 0..−4): vitrines.
- **Zone B Bronze/Sculpture** (X +2..+6, Z −2..−8): plinths S/M/L.
- **Zone C Painting/Scroll** (Z −6..−10, against side walls + 2 partitions): picture rails.
- **Zone D Contemporary** (Z −9..−12, before gate): 2 low platforms + open floor.

### Build list (FINAL geometry, all merged/instanced as noted)

| Element | Geometry | Count | Tris | Material | Draw calls |
|---|---|---|---|---|---|
| Master floor (y=0) | `PlaneGeometry(34,46,1,1)` rot −π/2 | 1 | 2 | `PALETTE.floor` **MeshStandard**, receiveShadow | 1 |
| Walls + ceiling envelope | `BoxGeometry` ×5 (2 side walls 18×4.2×0.2 @ x=±7; entrance wall 2 segments @ z=6.2 w/ 3 m gap; ceiling `PlaneGeometry(14,18)` face −Y @ y=4.2) **merged** | 1 merged | ~80 | `PALETTE.wallWhite` **MeshLambert**, castShadow=false, receiveShadow=true | 1 |
| Moon-gate far wall + ring | Far wall @ z=−12 built as **4 box segments** framing the 2.6 m aperture (NO CSG) + `TorusGeometry(1.45,0.06,6,48)` ring | 1 | ~700 | wall = wallWhite Lambert; **ring = `PALETTE.cinnabar` MeshStandard**, the single hero accent | 2 |
| Plinths S/M/L | unit `BoxGeometry`, **one InstancedMesh per size class, per-instance scale** | up to 12 | ~144 | `PALETTE.stonePlinth` Lambert, castShadow=true (drop to false first if frames dip) | 3 |
| Vitrines (open frame, NO glass) | 12 thin edge bars **merged into one cage geometry**, then InstancedMesh | 4 | ~576 | `PALETTE.bronze` MeshStandard | 1 |
| Picture-rail trim band | thin `BoxGeometry` strip @ y=2.6, x=±6.85 | 2 | ~24 | `PALETTE.bronze` Lambert (merge into wall merge) | (in wall merge) |
| Zone C partitions | `BoxGeometry(5,3.6,0.2)` free-standing | 2 | ~24 | `PALETTE.wallWhite` Lambert, castShadow=false | 1 |
| Contemporary platforms | `BoxGeometry(2.2,0.15,2.2)`, InstancedMesh | 2 | ~24 | `PALETTE.stonePlinth` Lambert | 1 |
| Cinnabar floor-inlay line | merged thin quads, y=0.012 + polygonOffset | 1 | ~12 | `PALETTE.cinnabar` Lambert, emissive `#E0553A` @ 0.2 | 1 |
| Ink-black baseboard loop | merged thin box loop, y=0..0.12 | 1 | ~120 | `PALETTE.inkBlack` Lambert | 1 |

**Indoor structural total: ~1.7K tris (cap 8,000), ~11 draw calls.**

### Required fixes applied
- Entrance wall at z=6.2 (not 4.0) — **no spawn clipping.**
- Far wall = 4 box segments around aperture — **no CSG on Quest.**
- Moon-gate ring is **cinnabar** (single hero accent); robot uses jade so the two don't compete in the through-gate sightline.
- Plinths = single unit-box InstancedMesh per size with per-instance scale (genuine 3 draw calls, not "per-size OR per-scale" ambiguity).
- `getSnapTargets()` is **OUT of scope / dropped for v1** — no consumer exists in controls.js/assets.js, and auto-place hardcodes `(1.2,0,0)`. Do NOT ship an unconsumed placement contract. The first M plinth is positioned at `(1.2,0.45,0)` so its top (y=0.9) sits beneath the auto-placed art (which lands at y=0 base); art will rest beside/on the plinth visually. (If true snap-onto-top is wanted later, that is a separate controls/assets workstream.)
- Vitrine line-item corrected: 4 cages × ~144 tris = ~576 (not 144 total).

---

## 3. Outdoor Literati Garden

**Module:** new `static/js/garden.js` exporting `initGarden()` and `updateGarden(t)`. Build into `galleryGroup` (shared) or a child `GardenDecor` group; either way it's under the non-selectable group added to `scene`.

### Build list (FINAL — corrected ~3× over-estimate down to honest numbers)

| Element | Geometry | Count | Tris | Material | Draw calls |
|---|---|---|---|---|---|
| Garden ground overlay (y=0) | `PlaneGeometry(20,16,1,1)` rot −π/2, z<−12 | 1 | 2 | `PALETTE.gardenGreen` Lambert, receiveShadow | 1 |
| Path strip (y=0.002) | `PlaneGeometry(1.4,16)` | 1 | 2 | `PALETTE.stonePlinth` Lambert | 1 |
| Low-poly pine trees | trunk `Cylinder(…,6)` + 3 stacked `Icosahedron(r,0)` (20 tris each) foliage, **merged per tree**, then InstancedMesh | 12 | ~960 | `PALETTE.gardenGreen` Lambert, castShadow=false | 1 |
| Scholar's rocks (taihu) | `Icosahedron(r,1)` (80 tris) w/ per-vertex displacement, flatShading, hand-placed | 6 | ~480 | `PALETTE.inkBlack` Lambert | 6 |
| Pond water | `PlaneGeometry(5,4,16,12)` @ y=0.01 | 1 | 384 | `PALETTE.water` **MeshStandard** (sole sheen), opaque, vertex-wave in `updateGarden` | 1 |
| Stepping stones | flat `Cylinder(0.28,…,10)`, InstancedMesh | 12 | ~480 | `PALETTE.stonePlinth` Lambert | 1 |
| Ink-stone border / rocks | `Icosahedron(r,0)` (20 tris), InstancedMesh, non-uniform scale | 8 | ~160 | `PALETTE.inkBlack` Lambert | 1 |
| Pavilion silhouette | 4 `Cylinder` posts + low hip roof (custom ~8-tri) + ridge box | 1 | ~600 | `PALETTE.bronze` MeshStandard; ONE cinnabar ridge band (the single outdoor vermilion note) | 2 |
| Bamboo billboards | 2 crossed `PlaneGeometry`, `alphaTest:0.5` cutout (NOT transparent), InstancedMesh | 10 | ~80 | Lambert + mipmapped alpha texture | 1 |
| 3 sculpture pads | `Circle(1.1,24)` @ z=−15,−20,−25 | 3 | ~144 | `PALETTE.stonePlinth` Lambert | 1 |

**Garden structural total: ~4K tris (cap 6,000), ~16 draw calls.** (Real cost is ~6.5K worst case with detail-2 rocks, well under cap.)

### Required fixes applied
- **Poly estimate corrected** from 20K to ~4–6.5K (honest budget math). Icosa detail-0 = 20 tris, detail-1 = 80 tris — pinned per element above.
- **NO dynamic z-based sky swap.** Use ONE shared neutral pale-daylight sky set ONCE at init (see §5). A per-zone `drawSkyGradient` swap churns/leaks the shared 2×256 canvas texture and is stomped by any Env click. Garden and gallery share the env sky.
- **Shadow frustum is NOT widened to swallow the garden.** Distant garden sculpture (pads z≤−15, pavilion, far rocks) casts NO real-time shadow — accepted. Shadow casters capped to ~3–4 near objects (hero rock + near trees), all near the gallery seam inside the ±9 frustum.
- **Static matrix flag ordering:** after positioning each static mesh, call `updateMatrix()`/`updateMatrixWorld()` THEN set `matrixAutoUpdate=false`. The water plane animates vertex positions (not its matrix), so `matrixAutoUpdate=false` is also fine for it; the per-frame path mutates `geometry.attributes.position` only.
- **Water vertex-wave throttling is the DEFAULT on Quest** (gate on `myRole === 'viewer'` from state.js, which is the Quest UA signal): update waves every other frame. Sum of 2 sines over ~400 verts.
- **Lattice band CUT for v1** (over-decoration risk vs locked restrained-motif rule).
- **Boundary clamp (resolved decision):** accept walk-through as a known limitation (consistent with collision-free free-fly locomotion everywhere else). No AABB clamp in v1. Document it. The ink-stone border bounds the garden visually only.
- **No Reflector / RTT / PMREM / particles / normal maps.** Water sheen relies on the MeshStandard plane under the sky; accept it reads as a calm matte-to-soft-sheen pond (no env map means no crisp specular — that is intended for a still ink-pond).

---

## 4. Robot Docent

**File:** rewrite ONLY the body of `createHumanoid()` and the **procedural branch** of `animateHumanoid()` in `static/js/humanoid.js`. The Mixamo branch (`if (mixamoBones && mixamoRestReady)` early-return) is UNTOUCHED.

**Design:** "soft porcelain shell + matte bronze joints + single jade visor." Rounded egg-pod head, wide horizontal glowing jade visor (the only emissive face), tapered torso shell, two 2-segment arms with mitten paddle hands (no fingers), NO legs — a tapered skirt over a flat hover-disc. Hovers, glides, scans the room. Reads as a friendly museum guide.

### CRITICAL vertical constraint (resolved)
The speech bubble is **hardcoded** to project from world `(0, 2.6, 0)` (chat.js:20). The old head sat at y≈2.12. **Resolution (pick ONE, locked): drive the bubble from the robot's head world position.** Change chat.js:20 to read the head's world Y + a small offset instead of the literal `2.6`. This is a REQUIRED cross-file edit — **`chat.js` IS an affected file** (the "single-file change" claim was false). Implementation: capture `head.getWorldPosition(bubbleWorldPos)` then `bubbleWorldPos.y += 0.5` before `.project(camera)`. This makes the bubble robust to the 1.9 m robot AND any future Mixamo swap, killing the magic number. Robot head/visor stays at y≈1.62, antenna tip y≈1.90 — keeps the eye-to-eye greeting design.

### Structure (LOCKED — head export resolved unambiguously)
- `humanoid = new THREE.Group()` at origin, `scene.add(humanoid)`. Feet/disc never touch y=0 (disc at y≈0.15, bob keeps it clear). Preserve `export let humanoid, head;`.
- **`head` = the porcelain head-pod Mesh.** `visorBar`, `visorBezel`, and `antenna` are added as `head.add(...)` CHILDREN. The existing animation only writes `head.rotation.{x,y,z}` (absolute per-frame), so nodding/tilting the pod moves the whole face assembly. No caller changes.
- Module-level handles captured in `createHumanoid` (REQUIRED, explicit): `let visorMat, antennaMat, ringMat, rightArmGroup, leftArmGroup;`. The visor uses its OWN MeshStandardMaterial instance (its `emissiveIntensity` animates); antenna tip and hover-ring get SEPARATE cheap materials so their emissive scales independently (0.4× / 0.25×) without coupling to the talk pulse.
- `visorBar` is a child mesh with a FIXED local `rotation.z = Math.PI/2` (horizontal bar) — never animate `head.children[i].rotation.z`; head's own per-frame `rotation.z` is a different object.

### Geometry & materials (cap 3,000 tris; realistic ~3,400)
| Part | Geometry | Material | castShadow |
|---|---|---|---|
| headPod (`head`) | `Sphere(0.17,20,14)` scaled (1,.88,.82) | `PALETTE.wallWhite` shell, rough .55 metal .1 | yes |
| visorBar | `Capsule(.035,.20,4,8)` rot z 90° | base `#2E5E52`, **emissive `PALETTE.jade #6FA08C` int ~0.8** (own instance) | no |
| visorBezel | flattened `Torus(.11,.018,6,16)` | `PALETTE.bronze` | no |
| antenna | `Cylinder(.008,.008,.18,6)` + `Sphere(.03,8,6)` tip | bronze stem; tip emissive jade @ 0.4× | no |
| neckRing | `Cylinder(.10,.14,.08,16)` | bronze | no |
| torsoShell | `Capsule(.22,.40,8,16)` scaled z .85 | shell white | yes |
| chestSeam | `Box(.02,.30,.02)` | bronze | no |
| shoulderJoints ×2 | `Sphere(.06,10,8)` | bronze | no |
| upperArm ×2 | `Capsule(.05,.20,4,8)` | shell white | yes |
| elbowRing ×2 | `Cylinder(.05,.05,.03,10)` | bronze | no |
| forearm ×2 | `Capsule(.045,.18,4,8)` | shell white | yes |
| paddleHand ×2 | `Box(.10,.14,.03)` | shell white | yes |
| skirt | `Cylinder(.15,.21,.55,18,1,true)` open | shell white | yes |
| skirtInner | `Sphere(.14,12,8)` | `PALETTE.inkBlack` occluder | no |
| hoverDisc | `Cylinder(.18,.18,.04,18)` | shell white | no |
| hoverGlowRing | flattened `Torus(.17,.012,4,20)` | emissive jade @ 0.25× (own material) | no |

Arms are sub-Groups (`rightArmGroup`/`leftArmGroup`) pivoting at the shoulder ball.

### Animation (procedural branch — idle/talk conflict RESOLVED)
The existing non-talking branch does `humanoid.rotation.y *= 0.95` and `head.rotation.z *= 0.95` (gesture decay). You cannot both drive `rotation.y` with a sine AND decay it in the same frame. **Resolution: split idle scan onto a dedicated wrapper.** Create `let idleScanGroup` as a child wrapper holding the head, OR apply the idle scan to `head.rotation.y`/`head.rotation.x` (head is NOT decayed — only `head.rotation.z` is) and keep `humanoid.rotation.y *= 0.95` decay reserved exclusively for talk-induced body yaw.

- **Idle (always-on, off `t`):** `humanoid.position.y = 0.04 + Math.sin(t*1.1)*0.025` (hover bob). `head.rotation.y = Math.sin(t*0.35)*0.4`, `head.rotation.x = Math.sin(t*0.6)*0.05` (scan/tilt — head.y/x are safe, not decayed). Visor blink: every ~4 s ramp `visorMat.emissiveIntensity` 0.8→0.15→0.8 over ~0.12 s via sawtooth on `t`. Antenna tip follows at 0.4×.
- **Talking (`isTalking`, reuse `talkTimer`/`gestureBlend`):** visor pulse `visorMat.emissiveIntensity = 0.8 + Math.sin(talkTimer*9)*0.5`; nod `head.rotation.x += Math.sin(talkTimer*4)*0.06`; tilt `head.rotation.z = Math.sin(talkTimer*2.5)*0.035` (this z IS the decayed channel — correct); address player via `humanoid.rotation.y` eased toward +Z (decayed by `*=0.95` when talk ends — correct).
- **Point gesture (reuse `gestureBlend` 0→1 @ 0.04/frame):** `rightArmGroup.rotation` lerps toward shoulder x≈−1.1, y≈−0.3 + elbow x≈−0.3, multiplied by `gestureBlend` (ease in/out like the Mixamo path).
- **Auto-greet-on-spawn is OUT of scope** (no spawn hook exists in humanoid.js; isTalking only flips on chat round-trip). Ship idle + isTalking-driven only. Greet wiring is a later main.js task if desired.

### Cleanup (directive, not optional)
Delete `createLimb()` and the old `skinMat/clothMat/pantsMat/shoeMat/eyeMat/pupilMat` consts — grep-confirmed local-only, safe. Keep `export let humanoid, head;`, `let talkTimer = 0;`, `let gestureBlend = 0;`. Mixamo override (`setMixamoModel` → `humanoid.visible=false`) keeps working (humanoid stays a Group at origin). Robot is added to `scene` via `humanoid` only — excluded from asset panel/HUD/export (verified).

**Draw calls:** realistic ~8–14 (arm groups + head group stay separate to animate; share materials per role). Do NOT promise "4 draw calls." castShadow ON only for pod/torso/arms/skirt (~7 shells); OFF for all bronze/emissive details. No new lights — jade is 100% emissive.

---

## 5. Lighting + Environment Presets

**Files:** `lights.js`, `environment.js`, `scene.js`, `main.js`.

### Lighting rig (in `initDefaultLights`)
- **`dirLight` (the ONE sun / skylight key):** color `#fff4e6`, intensity 2.4. `castShadow=true`. **`shadow.mapSize` = 1536 default on Quest, 2048 on desktop** (gate on `myRole`/UA — 2048 PCFSoft over 18×18 m is borderline on Quest 3S). `shadow.camera` ortho ±9, near 0.5, far 40. **`dirLight.target.position.set(0,0,-3)` and `scene.add(dirLight.target)`** so the frustum covers the walkable z-range (+5..−12), not just ±9 around origin. `shadow.bias=-0.0005`, `normalBias=0.02`, `shadow.radius=4`. Position `(6,12,4)` (must equal preset[0].dirP — see below).
- **NEW `hemisphereLight` (skyFill):** `HemisphereLight(0xeef1f4, PALETTE.floor, 0.6)`. **Intensity 0.6 (NOT 1.1)** so it doesn't wash out the Evening/Golden presets. Add to `scene` AND to `defaultLights[]` as `{light:hemisphereLight, name:'Skylight (Hemi)', type:'hemisphere'}`. Export it. `registerDefaultLightsForEnv` is extended to also accept it (see below).
- **`ambientLight`:** recolor `0x6677aa → 0xf2efe9` (warm-white), intensity 0.85 (white surfaces bounce; floor-fill so recesses don't crush).
- **`rimLight` (track fill):** recolor `0x8888ff → 0xfcf6ec`, intensity 0.55, position `(-5,7,-3)`, `castShadow=false`.
- **`fillLight` (moon-gate glow):** recolor `0xffaa66 → 0xfff1dc`, intensity 0.6, distance 14, decay 2, position `(0,2.6,-12)` (at the gate), `castShadow=false`. The ONLY sanctioned default point light.
- **User lights MUST default to `castShadow=false`:** change `addDirectionalLight` (lights.js:119) and `addPointLight` (lights.js:164) to `castShadow=false`. Flag as a visible regression for previously-saved scenes that relied on user-light shadows (accepted to protect the one-sun budget).

### Env presets (replace all 4 IN PLACE, same 9-key shape, length 4)
The hemisphere/rim/fill recolor extension is **MANDATORY** (not optional) so presets actually change mood. Add `hemiSky`, `hemiGround`, `hemiI` to all 4 presets; extend `applyEnvPreset` to set them, each guarded with `typeof`/`if (_hemiLight)`. Extend `registerDefaultLightsForEnv(ambient, dir, hemi)` (append param, optional) and update main.js call site to pass `hemisphereLight` (add the import).

| Index | Name (relabel) | Mood | dirP | exp | fogD |
|---|---|---|---|---|---|
| 0 | **Gallery Daylight** | neutral default | `[6,12,4]` (= dirLight init pos) | 1.05 | 0.0008 |
| 1 | **Warm Gallery** | incandescent track-light | `[5,11,4]` | 1.0 | 0.0008 |
| 2 | **Golden Hour Garden** | low warm rake (keeps gallery in frustum) | `[8,7,5]` | 1.05 | 0.002 |
| 3 | **Evening** | dim, intimate, accent-lit | `[3,8,3]` | 0.85 | 0.004 |

Sky stops for preset 0: `[[0,'#E8E4DB'],[0.55,'#EDEAE3'],[1,'#DCD7CC']]`. Fog hex tracks the warm-white interior (`0xEDEAE3` family). All presets carry the FULL 9 keys + 3 hemi keys (no `undefined` → `.setHex` throws). `dirP` is chosen so the gallery stays inside the fixed ±9 frustum for ALL presets (Golden Hour kept at `[8,7,5]`, not the original low `[10,4,9]`, so shadows don't clip — the raking-through-gate effect is softened but functional; `applyEnvPreset` does NOT recompute the shadow frustum).

### Boot state (MANDATORY, was "recommend")
`applyEnvPreset` is NOT called at boot today, so exposure stays at state.js's 1.1 and lights show raw `initDefaultLights` values. **Call `applyEnvPreset(envPresets[envIndex])` once in main.js immediately AFTER `registerDefaultLightsForEnv(...)`.** Preset[0]'s `ambC/ambI/dirC/dirI/dirP/exp` MUST exactly equal the `initDefaultLights` ambient/dir values so there is ZERO visual jump on the first Env click or multiplayer env_change(0). Single-source exposure through the preset (1.05), not state.js.

### scene.js changes (coordinate — shared with gallery workstream)
- Default `drawSkyGradient` stops → preset[0]'s warm-white stops (so no flash of old dark sky before first preset apply).
- `scene.fog = new THREE.FogExp2(0xEDEAE3, 0.0008)` — keep FogExp2 instance, near-zero density. **Never null.**
- **REMOVE** the dark `CircleGeometry(20)` ground and the `GridHelper` (grep-confirmed no references; safe). The gallery master floor replaces them. **Keep** `document.getElementById('canvas-container').appendChild(renderer.domElement)` — load-bearing.
- These edits land in `initScene` which the gallery workstream also touches — gallery owns floor/ground removal + new planes; lighting owns sky stops + fog value. Single coordinated edit to `initScene`.

The CanvasTexture sky is a flat backdrop with **no env map / no `scene.environment`** — it contributes ZERO to PBR lighting. The HemisphereLight does 100% of the fill. (Drop any "IBL-feel" framing — it's misleading.)

---

## 6. UI Identity + CSS Restyle

**Files:** `index.html`, `static/css/style.css`, plus a 1-line edit each to `environment.js:40`, `assets.js:491`, `multiplayer.js:55`, `undo.js:157` (the env-btn glyph). All element IDs, classes, `data-*`, inline `display:none`, and the `.xr-session-active` hide block are preserved verbatim. NO new top-level DOM elements (the hide list needs no additions).

### Identity
- App name: **Wending Pavilion / 文徵阁**, tagline **Curator's Studio · 策展工作室**.
- `<title>` → `Wending Pavilion · Curator's Studio`.
- `#mode-badge` **requires new inner markup** (the "inner text only" claim was false — current content is a bare text node). New structure: wrap the title in a `<span class="badge-title">` (with a cinnabar `::after` rule on THAT span, not on `#mode-badge`), keep `<small id="xr-status">` and `<small id="connected-count">` as DIRECT untouched children (read by multiplayer.js:48/331 and main.js:129). Example inner: `<span class="badge-title">Wending Pavilion <span class="badge-cn">文徵阁</span></span><span class="badge-tag">Curator's Studio · 策展工作室</span><small id="xr-status">…</small><small id="connected-count"></small>`. Ensure no CSS/JS uses `#mode-badge:first-child` or relies on the bare-text-node position.

### env-btn glyph (4-line atomic edit)
`#env-btn` is JS-driven (`'🌅 '+envPresets[i].name`) and doubles as the live env readout. To relabel it "Atmosphere / 光境" keep the live name but swap the prefix glyph `'🌅 ' → '☀ '` in ALL FOUR writers atomically (environment.js:40, assets.js:491, multiplayer.js:55, undo.js:157). Grep-confirmed these are the ONLY writers/readers of env-btn.textContent. Test: env cycle, undo/redo env, 2nd multiplayer client — the readout must stay consistent.

### Toolbar relabels (EN-only labels — bilingual reserved for identity + panel titles to avoid 3–4 row toolbar wrap at max-width 520px)
See `toolbarRelabels` token. Buttons become flat rice-paper chips. Keep emoji as monochrome leading icons.

### Palette & surfaces ("paper and stone")
Driven from `PALETTE_CSS` (tokens.js): panel fill `#FBF8F2` @ 0.94, hairline border `#E4DCCB`, ink text `#1F1B16`, muted `#6E665A`. Accents: cinnabar `#C8442E` (primary/active/focus), jade `#6FA08C` (save/confirm/xr-ready), bronze `#7A6A4F` (hover/underline). Replace ALL blue/purple gradients (`#4a7cff`/`#6a4cff`) with flat cinnabar. `.active` chip → cinnabar fill, white text. Destructive → brick `#A6433A`. Poly-warn: ok=jade tint, caution=amber `#B07A1E`, danger=brick. Body letterbox `#2A2622`.

### Typography
Headings/identity/panel-titles/modal-h3: **Noto Serif + Noto Serif SC** with `Georgia, serif` fallback. Controls/body: system sans (`-apple-system, 'Segoe UI', Roboto, sans-serif`). **Self-host subsetted woff2** (only the ~20-30 CJK glyphs the UI renders) in `static/` rather than the CDN `<link>` — this is a kiosk/offline-capable curation tool and should not FOUT on its own title. Fallback to Georgia means no blocking.

### Required fixes applied
- `#bot-name-input` placeholder: **leave as-is** ("ai_ministerbot"). main.js:257 sends `botNameInput.value.trim()`; the real default is server-side. Do NOT imply "gallery_docent" exists until server-verified. (Demoted to no-op.)
- Drop the false blanket "every DOM surface hidden in XR" claim: `#speech-bubble`, `#dev-panel`, `#name-panel`, `#vr-exit-prompt`, `#import-modal` are NOT in the `.xr-session-active` hide block (style.css:218-227) — they rely on their own `.hidden`/display toggles. Recoloring the speech bubble is fine but don't claim it's hidden in-session.
- Lower ALL `backdrop-filter` to `blur(8px)` — including `#dev-panel`'s `blur(14px)` (style.css:376) and the eight `blur(12px)` panels — for one consistent (cheaper) compositor cost.
- The 4 env-btn JS edits cross the "cosmetic only" line — own and test them in the same commit.

DOM chrome is hidden in XR via `.xr-session-active` and costs ~0 GPU; it never competes with the art budget.

---

## 7. Poly / Draw-Call Budget

| Area | Tri cap | Est. actual | Notes |
|---|---|---|---|
| Robot docent | 3,000 | ~3,400 | hard cap; head below y=2.6 for bubble |
| Indoor architecture | 8,000 | ~1,700 | moon-gate (~700) is biggest line item |
| Outdoor garden | 6,000 | ~4,000–6,500 | corrected from 20K |
| Structural slack | 3,000 | — | signage/threshold/future |
| **Total non-art** | **~20,000** | **~9–12K** | ~4–5% of 250K |
| **Reserved for ART** | **~205K** | — | with ~25K safety margin |

- **Instancing reduces DRAW CALLS, not triangles.** GPU renders `geometry.tris × instanceCount` (plinths 12×12=144, trees 12×80≈960, etc.) — all count against caps.
- The poly HUD (`countSceneTriangles`) traverses ONLY `importedObjects` — structural decor is invisible to it. **Add a one-line `console.log` of merged structural tri count at init** AND a small separate "structure: ~Nk" readout so the ~10–20K cost is auditable; curators' real art ceiling is ~205K, not 250K. Do NOT fold structural tris into the warn/danger ratio without raising the displayed budget.
- `import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'` (importmap maps `three/addons/` to jsdelivr 0.163 — resolves).
- Whole non-art environment target: **under ~35 draw calls.**
- VR headroom lever (TODO, not yet wired): `renderer.xr.setFramebufferScaleFactor(0.9)` before session start if frames dip.

---

## 8. tokens.js (new file — pure constants, no side effects, import anywhere)

```js
export const PALETTE = {
  wallWhite:0xEDEAE3, floor:0xD8D2C7, ceiling:0xF4F2EC, stonePlinth:0xCFC8BB,
  trim:0xB7AE9F, inkBlack:0x1C1B1A, cinnabar:0xC8442E, jade:0x6FA08C,
  bronze:0x7A6A4F, gardenGreen:0x5B7355, water:0x7E9AA0, sky:0xE8E4DB,
};
export const PALETTE_CSS = { /* '#EDEAE3' … same roles for UI */ };
export const DIM = { /* see §1 */ };
export const SHARED_MATERIALS = createSharedMaterials(); // one MeshStandard/Lambert per role
```
`createSharedMaterials()` builds ONE material instance per palette role (fewer shader programs = fewer state changes). Lambert for bulk decor, Standard for hero pieces. Reuse everywhere.

---

## 9. Cross-Workstream Conflict Resolutions (summary)

1. **Footprint:** 14×18 gallery + 20×16 garden (resolved from 3 competing sizes). Moon-gate at z=−12.
2. **Palette:** perf-tokens set is canonical. Wall `#EDEAE3`, floor `#D8D2C7`, cinnabar `#C8442E`, jade `#6FA08C`, bronze `#7A6A4F`, ink `#1C1B1A`. UI cinnabar active = `#C8442E`.
3. **Robot accent = JADE; moon-gate ring = CINNABAR.** They share the through-gate sightline; different colors prevent dilution of the "single hero accent" rule.
4. **Floor:** gallery owns the ONE master y=0 plane (indoor+garden); garden overlays green for z<−12. No seam.
5. **Shadow frustum:** ±9, target `(0,0,-3)`, far 40, 1536(Quest)/2048(desktop). Covers gallery only; garden shadows accepted absent. `applyEnvPreset` does NOT mutate the frustum; preset `dirP` values chosen to keep gallery inside it.
6. **Fog:** live FogExp2 @ ~0.0008, never null; all 4 presets carry fog/fogD.
7. **Exposure:** single-sourced through presets (1.05 default); boot applies preset[0].
8. **Speech bubble:** driven from `head.getWorldPosition` (chat.js edit), not the `2.6` literal.
9. **getSnapTargets / auto-greet / boundary clamp / lattice band:** all dropped from v1 (no consumer / over-scope / over-decoration).

---

## 10. Risks carried into implementation
- Quest 3S frame-time for 1536 shadow + 5 light terms + open-volume overdraw is unverified on-device; first dials: shadow map 1536→1024, drop plinth castShadow, framebuffer scale 0.9.
- Walk-through walls/gate is a known accepted limitation (free-fly locomotion, no collision).
- User-light shadow-off is a visible regression for old saved scenes.
- Self-hosted CJK subset must include every glyph the UI renders or the identity title FOUTs/falls back to Georgia.