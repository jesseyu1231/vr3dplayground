/**
 * humanoid.js — procedural humanoid mesh construction and per-frame animation.
 * Also handles optional Mixamo GLB character replacement.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { scene } from "./state.js";

const skinMat = new THREE.MeshStandardMaterial({
  color: 0xc4956a,
  roughness: 0.6,
  metalness: 0.05,
});
const clothMat = new THREE.MeshStandardMaterial({
  color: 0x3355aa,
  roughness: 0.7,
  metalness: 0.05,
});
const pantsMat = new THREE.MeshStandardMaterial({
  color: 0x2a2a44,
  roughness: 0.8,
  metalness: 0.05,
});
const shoeMat = new THREE.MeshStandardMaterial({
  color: 0x222222,
  roughness: 0.9,
});
const eyeMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.3,
});
const pupilMat = new THREE.MeshStandardMaterial({
  color: 0x222244,
  roughness: 0.5,
});

function createLimb(
  yTop,
  yMid,
  yEnd,
  xOff,
  upperR,
  lowerR,
  upperMat,
  lowerMat,
  hasShoe,
) {
  const g = new THREE.Group();
  const upper = new THREE.Mesh(
    new THREE.CapsuleGeometry(upperR, 0.3, 6, 12),
    upperMat,
  );
  upper.position.set(xOff, yTop, 0);
  upper.castShadow = true;
  g.add(upper);
  const lower = new THREE.Mesh(
    new THREE.CapsuleGeometry(lowerR, 0.28, 6, 12),
    lowerMat,
  );
  lower.position.set(xOff, yMid, 0);
  lower.castShadow = true;
  g.add(lower);
  if (hasShoe) {
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.08, 0.22),
      shoeMat,
    );
    shoe.position.set(xOff, yEnd, 0.03);
    shoe.castShadow = true;
    g.add(shoe);
  } else {
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 10),
      skinMat,
    );
    hand.position.set(xOff, yEnd, 0);
    hand.castShadow = true;
    g.add(hand);
  }
  return g;
}

export let humanoid, head;
let talkTimer = 0;
let gestureBlend = 0; // 0 = rest, 1 = point pose

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
      console.log('[Character] model loaded and set ✓');
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
      console.log('[Character] model restored and set ✓');
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

export function createHumanoid() {
  humanoid = new THREE.Group();

  head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 24), skinMat);
  head.position.y = 2.12;
  head.castShadow = true;
  humanoid.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.04, 12, 12);
  const pupilGeo = new THREE.SphereGeometry(0.02, 10, 10);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.08, 2.14, 0.18);
    humanoid.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(side * 0.08, 2.14, 0.22);
    humanoid.add(pupil);
  }

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.12, 12),
    skinMat,
  );
  neck.position.y = 1.86;
  neck.castShadow = true;
  humanoid.add(neck);

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.45, 8, 16),
    clothMat,
  );
  torso.position.y = 1.55;
  torso.castShadow = true;
  humanoid.add(torso);

  const hipsBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.15, 8, 16),
    pantsMat,
  );
  hipsBody.position.y = 1.15;
  hipsBody.castShadow = true;
  humanoid.add(hipsBody);

  humanoid.add(
    createLimb(1.65, 1.32, 1.12, -0.32, 0.055, 0.045, clothMat, skinMat, false),
  );
  humanoid.add(
    createLimb(1.65, 1.32, 1.12, 0.32, 0.055, 0.045, clothMat, skinMat, false),
  );
  humanoid.add(
    createLimb(0.85, 0.42, 0.04, -0.1, 0.07, 0.055, pantsMat, pantsMat, true),
  );
  humanoid.add(
    createLimb(0.85, 0.42, 0.04, 0.1, 0.07, 0.055, pantsMat, pantsMat, true),
  );

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

  // ── Procedural path (unchanged) ──────────────────────────────────────────
  humanoid.position.y = Math.sin(t * 1.5) * 0.008;
  head.rotation.x = Math.sin(t * 0.8) * 0.03;
  head.rotation.y = Math.sin(t * 0.5) * 0.05;

  if (isTalking) {
    talkTimer += 0.05;
    head.rotation.x += Math.sin(talkTimer * 3) * 0.04;
    head.rotation.z = Math.sin(talkTimer * 2.5) * 0.03;
    humanoid.rotation.y = Math.sin(talkTimer * 1.2) * 0.02;
  } else {
    humanoid.rotation.y *= 0.95;
    head.rotation.z *= 0.95;
  }

  humanoid.children.forEach((child) => {
    if (child.isGroup)
      child.children.forEach((part) => {
        if (part.position.y > 1 && part.position.y < 1.7)
          part.rotation.x = Math.sin(t * 0.7 + part.position.x) * 0.02;
      });
  });
}
