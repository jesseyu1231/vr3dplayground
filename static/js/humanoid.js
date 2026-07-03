/**
 * humanoid.js — procedural humanoid mesh construction and per-frame animation.
 * Also handles optional Mixamo GLB character replacement.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { scene } from "./state.js";
import { PALETTE } from "./tokens.js";

export let humanoid, head;
let talkTimer = 0;
let gestureBlend = 0; // 0 = rest, 1 = point pose

// ── Robot-docent module-level handles (captured in createHumanoid) ───────────
// visorMat: the ONLY animated emissive surface (talk pulse + idle blink).
// antennaMat / ringMat: cheap separate emissive-jade materials so the antenna
// tip (0.4×) and hover ring (0.25×) scale independently of the visor pulse.
// rightArmGroup / leftArmGroup: shoulder-pivot sub-Groups (point gesture).
let visorMat, antennaMat, ringMat, rightArmGroup, leftArmGroup;

// ── Mixamo replacement ──────────────────────────────────────────────────────

let mixamoRoot = null;
let mixamoBones = null; // keyed by clean bone name
let mixamoRestQ = {};   // initial quaternions captured at load time (the exported idle pose)
let mixamoRestReady = false; // true once rest quaternions are captured
let mixamoSourceFile = null; // original File object (for zip export)

export function getMixamoSourceFile() {
  console.log('[Character] getMixamoSourceFile called → ', mixamoSourceFile?.name ?? 'null');
  return mixamoSourceFile;
}

// Point gesture pose for right arm bones (Euler degrees)
const DEG = Math.PI / 180;
const POINT_POSE_DEG = {
  RightShoulder: [ 90.0,  11.9,  89.9],
  RightArm:      [-129.3, 64.2, 178.9],
  RightForeArm:  [  80.8, -1.3,  -0.2],
};
const pointPoseQ = {};
for (const [key, [ex, ey, ez]] of Object.entries(POINT_POSE_DEG)) {
  pointPoseQ[key] = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(ex * DEG, ey * DEG, ez * DEG, 'XYZ')
  );
}

// Hardcoded rest Euler angles (degrees) as fallback if capture reads zeros
const REST_EULER_DEG = {
  Hips:          [-90,   0,     0   ],
  LeftShoulder:  [ 90,  -11.9, -90.1],
  LeftArm:       [ 64.6, -0.4,  -0.2],
  LeftForeArm:   [ -7.4, -0.1,   0.7],
  RightShoulder: [ 90,   11.9,  89.9],
  RightArm:      [ 64.6,  0.7,   0.3],
  RightForeArm:  [ -7.4,  0.2,  -1.3],
};

export function setMixamoModel(gltfScene) {
  const savedFile = mixamoSourceFile; // preserve before clearMixamoModel wipes it
  clearMixamoModel();
  mixamoSourceFile = savedFile;

  mixamoRoot = gltfScene;
  mixamoRoot.updateMatrixWorld(true);

  // Normalise height to ~2 units (same as procedural character)
  const box = new THREE.Box3().setFromObject(mixamoRoot);
  const height = box.getSize(new THREE.Vector3()).y;
  if (height > 0.001) mixamoRoot.scale.setScalar(2.0 / height);

  // Place feet on the ground at origin
  mixamoRoot.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(mixamoRoot);
  mixamoRoot.position.y -= box2.min.y;

  // Build bone map using substring matching on actual Bone nodes.
  // Works regardless of prefix variant: "mixamorig:LeftArm", "mixamorigLeftArm", "LeftArm", etc.
  mixamoBones = {};
  mixamoRoot.traverse((node) => {
    if (node.type !== "Bone" && !node.isBone) return;
    const n = node.name;
    if (n.includes("Hips")) mixamoBones["Hips"] = node;
    if (n.includes("Spine") && !n.includes("1") && !n.includes("2"))
      mixamoBones["Spine"] = node;
    if (n.includes("Spine1")) mixamoBones["Spine1"] = node;
    if (n.includes("Head") && !n.includes("Top")) mixamoBones["Head"] = node;
    if (n.includes("Neck")) mixamoBones["Neck"] = node;
    if (n.includes("LeftShoulder")) mixamoBones["LeftShoulder"] = node;
    if (n.includes("LeftArm") && !n.includes("Fore") && !n.includes("Hand"))
      mixamoBones["LeftArm"] = node;
    if (n.includes("LeftForeArm")) mixamoBones["LeftForeArm"] = node;
    if (n.includes("RightShoulder")) mixamoBones["RightShoulder"] = node;
    if (n.includes("RightArm") && !n.includes("Fore") && !n.includes("Hand"))
      mixamoBones["RightArm"] = node;
    if (n.includes("RightForeArm")) mixamoBones["RightForeArm"] = node;
  });

  // Force a full matrix update so bone local quaternions reflect the exported pose
  mixamoRoot.updateMatrixWorld(true);

  // Build rest quaternions: use hardcoded values where available, else capture from bone
  mixamoRestQ = {};
  mixamoRestReady = false;
  for (const [key, bone] of Object.entries(mixamoBones)) {
    if (REST_EULER_DEG[key]) {
      const [ex, ey, ez] = REST_EULER_DEG[key];
      mixamoRestQ[key] = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(ex * DEG, ey * DEG, ez * DEG, 'XYZ')
      );
    } else {
      mixamoRestQ[key] = bone.quaternion.clone();
    }
  }
  mixamoRestReady = true;

  // Notify dev panel to refresh its bone dropdown (avoids circular import)
  document.dispatchEvent(new CustomEvent('mixamo-bones-ready', { detail: Object.keys(mixamoBones) }));

  mixamoRoot.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  scene.add(mixamoRoot);
  humanoid.visible = false;
}

// Called by dev panel when a slider changes — updates the rest quaternion so
// the slerp drives to the new target instead of the original bind pose.
export function tweakBoneRest(boneName, x, y, z) {
  if (!mixamoBones || !mixamoRestQ) return;
  const bone = mixamoBones[boneName];
  if (!bone) return;
  // Apply the euler offset to the original rest quaternion (captured at load)
  // We store the base separately so repeated slider moves don't drift.
  if (!mixamoRestQ[boneName + '_base']) {
    mixamoRestQ[boneName + '_base'] = mixamoRestQ[boneName].clone();
  }
  const base = mixamoRestQ[boneName + '_base'];
  const euler = new THREE.Euler(x, y, z, 'XYZ');
  const offsetQ = new THREE.Quaternion().setFromEuler(euler);
  mixamoRestQ[boneName] = base.clone().multiply(offsetQ);
}

export function clearMixamoModel() {
  if (mixamoRoot) {
    scene.remove(mixamoRoot);
    mixamoRoot = null;
  }
  mixamoBones = null;
  mixamoSourceFile = null;
  if (humanoid) humanoid.visible = true;
}

// ── Docent (Robot Docent default item) show/hide ────────────────────────────
// The visible docent is the procedural `humanoid` OR a loaded `mixamoRoot`, so the
// Defaults-folder delete/restore must toggle BOTH bodies. Restore must NOT touch
// humanoid.visible — it keeps whatever state setMixamoModel/clearMixamoModel set, so
// re-adding while a custom character is active leaves the robot hidden and mixamo shown.
export function deleteDocent() {
  if (humanoid) humanoid.removeFromParent();
  if (mixamoRoot) mixamoRoot.removeFromParent();
}
export function restoreDocent() {
  if (humanoid && !humanoid.parent) scene.add(humanoid);
  if (mixamoRoot && !mixamoRoot.parent) scene.add(mixamoRoot);
}
export function isDocentInScene() {
  return Boolean(humanoid?.parent) || Boolean(mixamoRoot?.parent);
}

export function hasMixamoModel() {
  return mixamoRoot !== null;
}
export function getMixamoBones() {
  return mixamoBones;
}
export function getMixamoRoot() {
  return mixamoRoot;
}

const _gltfLoader = new GLTFLoader();

// Load from a File object (used on initial upload)
export function loadMixamoFromFile(file, onSuccess, onError) {
  console.log('[Character] storing file:', file.name, `(${(file.size / 1024).toFixed(1)} KB)`);
  mixamoSourceFile = file;
  console.log('[Character] mixamoSourceFile set:', mixamoSourceFile?.name ?? 'null');
  const url = URL.createObjectURL(file);
  _gltfLoader.load(
    url,
    (gltf) => {
      URL.revokeObjectURL(url);
      setMixamoModel(gltf.scene);
      console.log('[Character] model loaded and set');
      if (onSuccess) onSuccess();
    },
    undefined,
    (err) => {
      URL.revokeObjectURL(url);
      console.error('[Character] load error:', err);
      if (onError) onError(err);
    },
  );
}

// Load from an ArrayBuffer (used when restoring from zip)
export function loadMixamoFromBuffer(buf, name, onSuccess, onError) {
  console.log('[Character] restoring from buffer:', name, `(${(buf.byteLength / 1024).toFixed(1)} KB)`);
  mixamoSourceFile = new File([buf], name, { type: 'model/gltf-binary' });
  console.log('[Character] mixamoSourceFile set from buffer:', mixamoSourceFile?.name ?? 'null');
  const blobUrl = URL.createObjectURL(mixamoSourceFile);
  _gltfLoader.load(
    blobUrl,
    (gltf) => {
      URL.revokeObjectURL(blobUrl);
      setMixamoModel(gltf.scene);
      console.log('[Character] model restored and set');
      if (onSuccess) onSuccess();
    },
    undefined,
    (err) => {
      URL.revokeObjectURL(blobUrl);
      console.error('[Character] buffer load error:', err);
      if (onError) onError(err);
    },
  );
}

export function loadMixamoFromUrl(url, name, onSuccess, onError) {
  mixamoSourceFile = null;
  _gltfLoader.load(
    url,
    (gltf) => {
      setMixamoModel(gltf.scene);
      mixamoSourceFile = null;
      if (onSuccess) onSuccess(name);
    },
    undefined,
    (err) => {
      console.error('[Character] remote load error:', err);
      if (onError) onError(err);
    },
  );
}

export function createHumanoid() {
  // ── Sleek low-poly robot docent (§4) ──────────────────────────────────────
  // "soft porcelain shell + matte bronze joints + single jade visor."
  // Egg-pod head, wide horizontal glowing jade visor (only emissive face),
  // tapered torso shell, two 2-segment arms w/ mitten paddle hands (no fingers),
  // NO legs — a tapered open skirt over a flat hover-disc. Cap ~3,000 tris.
  humanoid = new THREE.Group();

  // Shared shell material for all porcelain shells (head/torso/arms/hands/skirt).
  // Local instance (cheap, one shader) — NOT a SHARED_MATERIALS reuse because the
  // robot is the hero piece; keep its look self-contained. Standard for hero PBR.
  const shellMat = new THREE.MeshStandardMaterial({
    color: PALETTE.wallWhite,
    roughness: 0.55,
    metalness: 0.1,
  });
  // Matte bronze for all joints (neck ring, shoulder balls, elbow rings, seam,
  // visor bezel, antenna stem). Non-emissive, non-shadow detail.
  const bronzeMat = new THREE.MeshStandardMaterial({
    color: PALETTE.bronze,
    roughness: 0.5,
    metalness: 0.6,
  });

  // ── Head pod (`head`) ─ porcelain egg, the exported face anchor ────────────
  head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), shellMat);
  head.scale.set(1, 0.88, 0.82);
  head.position.y = 1.62; // eye-to-eye greeting height; tip stays below y=2.6
  head.castShadow = true;
  humanoid.add(head);

  // visorBar — wide horizontal glowing jade bar. OWN material (emissive animates).
  // FIXED local rotation.z = PI/2 makes the capsule horizontal; never animate it.
  visorMat = new THREE.MeshStandardMaterial({
    color: 0x2e5e52,
    emissive: PALETTE.jade,
    emissiveIntensity: 0.8,
    roughness: 0.4,
    metalness: 0.1,
  });
  const visorBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), visorMat);
  visorBar.rotation.z = Math.PI / 2;
  visorBar.position.set(0, 0.0, 0.14);
  visorBar.castShadow = false;
  head.add(visorBar);

  // visorBezel — flattened bronze ring framing the visor.
  const visorBezel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 6, 16), bronzeMat);
  visorBezel.scale.set(1, 0.5, 0.5);
  visorBezel.position.set(0, 0.0, 0.135);
  visorBezel.castShadow = false;
  head.add(visorBezel);

  // antenna — bronze stem + emissive-jade tip (own cheap material, scales at 0.4×).
  antennaMat = new THREE.MeshStandardMaterial({
    color: PALETTE.jade,
    emissive: PALETTE.jade,
    emissiveIntensity: 0.32, // 0.8 × 0.4
    roughness: 0.5,
    metalness: 0.0,
  });
  const antenna = new THREE.Group();
  const antennaStem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), bronzeMat);
  antennaStem.position.y = 0.09;
  antennaStem.castShadow = false;
  antenna.add(antennaStem);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), antennaMat);
  antennaTip.position.y = 0.19;
  antennaTip.castShadow = false;
  antenna.add(antennaTip);
  // Sit antenna on top of the pod (pod is scaled, so offset in head-local space).
  antenna.position.y = 0.18;
  head.add(antenna);

  // ── Neck ring (bronze joint, no shadow) ────────────────────────────────────
  const neckRing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.08, 16), bronzeMat);
  neckRing.position.y = 1.46;
  neckRing.castShadow = false;
  humanoid.add(neckRing);

  // ── Torso shell ────────────────────────────────────────────────────────────
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.4, 8, 16), shellMat);
  torso.scale.z = 0.85;
  torso.position.y = 1.12;
  torso.castShadow = true;
  humanoid.add(torso);

  // chest seam (bronze detail, no shadow)
  const chestSeam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.02), bronzeMat);
  chestSeam.position.set(0, 1.18, 0.19);
  chestSeam.castShadow = false;
  humanoid.add(chestSeam);

  // ── Arms — 2-segment sub-Groups pivoting at the shoulder ball ───────────────
  // Local geometry y is built downward from the shoulder pivot at the group origin.
  function buildArm(side) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.26, 1.34, 0); // shoulder pivot world position

    // shoulder ball (bronze, no shadow)
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), bronzeMat);
    shoulder.castShadow = false;
    arm.add(shoulder);

    // upper arm (shell, shadow)
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 4, 8), shellMat);
    upper.position.y = -0.16;
    upper.castShadow = true;
    arm.add(upper);

    // elbow ring (bronze, no shadow)
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), bronzeMat);
    elbow.position.y = -0.3;
    elbow.castShadow = false;
    arm.add(elbow);

    // forearm + paddle nested in a sub-group so the elbow channel can rotate
    // (the procedural point gesture only drives arm.rotation, but keeping the
    // forearm as a child keeps it visually attached to the elbow pivot).
    const fore = new THREE.Group();
    fore.position.y = -0.31;
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.18, 4, 8), shellMat);
    forearm.position.y = -0.13;
    forearm.castShadow = true;
    fore.add(forearm);

    // mitten paddle hand (no fingers)
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.03), shellMat);
    paddle.position.y = -0.27;
    paddle.castShadow = true;
    fore.add(paddle);

    arm.add(fore);
    arm.userData.fore = fore; // expose elbow channel for the gesture
    return arm;
  }

  rightArmGroup = buildArm(1);
  leftArmGroup = buildArm(-1);
  humanoid.add(rightArmGroup);
  humanoid.add(leftArmGroup);

  // ── Tapered open skirt (replaces legs) ──────────────────────────────────────
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.21, 0.55, 18, 1, true),
    shellMat,
  );
  skirt.position.y = 0.62;
  skirt.castShadow = true;
  humanoid.add(skirt);

  // ink-black inner occluder so the open skirt doesn't read hollow
  const skirtInner = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 8),
    new THREE.MeshLambertMaterial({ color: PALETTE.inkBlack }),
  );
  skirtInner.position.y = 0.6;
  skirtInner.castShadow = false;
  humanoid.add(skirtInner);

  // ── Hover disc + emissive-jade hover ring (never touch y=0) ─────────────────
  const hoverDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 18), shellMat);
  hoverDisc.position.y = 0.15;
  hoverDisc.castShadow = false;
  humanoid.add(hoverDisc);

  ringMat = new THREE.MeshStandardMaterial({
    color: PALETTE.jade,
    emissive: PALETTE.jade,
    emissiveIntensity: 0.2, // 0.8 × 0.25
    roughness: 0.5,
    metalness: 0.0,
  });
  const hoverGlowRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 4, 20), ringMat);
  hoverGlowRing.rotation.x = Math.PI / 2; // lay flat under the disc
  hoverGlowRing.scale.set(1, 1, 0.5);
  hoverGlowRing.position.y = 0.13;
  hoverGlowRing.castShadow = false;
  humanoid.add(hoverGlowRing);

  scene.add(humanoid);
}

export function animateHumanoid(t, isTalking) {
  // ── Mixamo skeleton path ──────────────────────────────────────────────────
  if (mixamoBones && mixamoRestReady) {
    const hips = mixamoBones["Hips"];

    // ── Slerp every bone to its captured rest pose ──
    for (const [key, bone] of Object.entries(mixamoBones)) {
      const rest = mixamoRestQ[key];
      if (bone && rest) bone.quaternion.slerp(rest, 0.15);
    }

    // ── Subtle idle breath/sway layered on top of rest pose ──
    const breath = Math.sin(t * 1.2);  // slow breath cycle
    const sway   = Math.sin(t * 0.7);  // even slower side sway

    const addRot = (bone, dx, dy, dz) => {
      if (!bone) return;
      bone.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(dx, dy, dz))
      );
    };

    const spine  = mixamoBones["Spine"] || mixamoBones["Spine1"];
    const head   = mixamoBones["Head"];

    // Spine: tiny forward lean on breath + gentle side sway
    addRot(spine, breath * 0.008, 0, sway * 0.006);

    // Head: slight counter-sway + slow nod
    addRot(head, breath * 0.005, 0, sway * -0.008);

    // Hips: very subtle vertical bob
    if (hips) hips.position.y += breath * 0.004;

    // ── Talking: head nods/tilts + right arm point gesture ──
    if (isTalking) {
      talkTimer += 0.05;
      gestureBlend = Math.min(1, gestureBlend + 0.04); // ease in over ~25 frames
      // Quick nod (x) + gentle tilt side to side (z)
      addRot(head,
        Math.sin(talkTimer * 4.0) * 0.04,
        0,
        Math.sin(talkTimer * 2.5) * 0.025
      );
    } else {
      talkTimer = 0;
      gestureBlend = Math.max(0, gestureBlend - 0.04); // ease out
    }

    // Blend right arm bones toward point pose (or back to rest)
    for (const key of ["RightShoulder", "RightArm", "RightForeArm"]) {
      const bone = mixamoBones[key];
      const restQ  = mixamoRestQ[key];
      const pointQ = pointPoseQ[key];
      if (!bone || !restQ || !pointQ) continue;
      // Already blended to rest above; now shift further toward point pose if gestureBlend > 0
      if (gestureBlend > 0) {
        bone.quaternion.slerp(pointQ, gestureBlend);
      }
    }

    return;
  }

  // ── Procedural robot-docent path (§4) ─────────────────────────────────────
  // Guard against being called before createHumanoid (and against partial
  // construction). Idle/talk channel split is the resolved conflict:
  //   - head.rotation.y / head.rotation.x = idle scan (NOT decayed)
  //   - head.rotation.z = talk-tilt ONLY (the *=0.95 decayed channel)
  //   - humanoid.rotation.y = talk-induced body yaw (the *=0.95 decayed channel)
  if (!humanoid || !head) return;

  // ── Idle (always-on, off t) ──
  humanoid.position.y = 0.04 + Math.sin(t * 1.1) * 0.025; // hover bob (disc stays > 0)
  head.rotation.y = Math.sin(t * 0.35) * 0.4;             // slow room scan (safe channel)
  head.rotation.x = Math.sin(t * 0.6) * 0.05;             // gentle tilt (safe channel)

  // Visor blink: every ~4 s ramp 0.8→0.15→0.8 over ~0.12 s via a sawtooth on t.
  // Antenna tip follows at 0.4×.
  let visorBase = 0.8;
  const blinkPeriod = 4.0;
  const blinkDur = 0.12;
  const phase = t % blinkPeriod;
  if (phase < blinkDur) {
    // triangle dip: 0.8 → 0.15 at mid-blink → 0.8
    const k = phase / blinkDur;            // 0..1 across the blink
    const dip = 1 - Math.abs(k * 2 - 1);   // 0 at edges, 1 at center
    visorBase = 0.8 - dip * (0.8 - 0.15);
  }

  if (isTalking) {
    // ── Talking (reuse talkTimer / gestureBlend) ──
    talkTimer += 0.05;
    gestureBlend = Math.min(1, gestureBlend + 0.04); // ease in over ~25 frames

    // visor pulse overrides the idle blink while talking
    if (visorMat) visorMat.emissiveIntensity = 0.8 + Math.sin(talkTimer * 9) * 0.5;

    head.rotation.x += Math.sin(talkTimer * 4) * 0.06;   // nod
    head.rotation.z = Math.sin(talkTimer * 2.5) * 0.035; // tilt (decayed channel)

    // address the player: ease body yaw toward facing +Z (rotation.y → 0 here,
    // robot's default forward; eased so the turn reads as a glance, not a snap)
    humanoid.rotation.y += (0 - humanoid.rotation.y) * 0.08;
  } else {
    talkTimer = 0;
    gestureBlend = Math.max(0, gestureBlend - 0.04); // ease out
    // visor follows the idle blink
    if (visorMat) visorMat.emissiveIntensity = visorBase;
    // decay the talk-only channels back to neutral
    humanoid.rotation.y *= 0.95;
    head.rotation.z *= 0.95;
  }

  // Antenna tip tracks the visor at 0.4× (independent material, no talk coupling
  // beyond the shared base level).
  if (antennaMat && visorMat) antennaMat.emissiveIntensity = visorMat.emissiveIntensity * 0.4;

  // ── Point gesture (reuse gestureBlend 0→1) — right arm only ──
  // Ease in/out, then scale the target shoulder/elbow rotation by the blend.
  const e = gestureBlend * gestureBlend * (3 - 2 * gestureBlend); // smoothstep
  if (rightArmGroup) {
    rightArmGroup.rotation.x = -1.1 * e;
    rightArmGroup.rotation.y = -0.3 * e;
    const fore = rightArmGroup.userData.fore;
    if (fore) fore.rotation.x = -0.3 * e; // elbow bend
  }
}
