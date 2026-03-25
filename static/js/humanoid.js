/**
 * humanoid.js — procedural humanoid mesh construction and per-frame animation.
 */
import * as THREE from 'three';
import { scene } from './state.js';

const skinMat  = new THREE.MeshStandardMaterial({ color: 0xc4956a, roughness: 0.6, metalness: 0.05 });
const clothMat = new THREE.MeshStandardMaterial({ color: 0x3355aa, roughness: 0.7, metalness: 0.05 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2a44, roughness: 0.8, metalness: 0.05 });
const shoeMat  = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
const eyeMat   = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222244, roughness: 0.5 });

function createLimb(yTop, yMid, yEnd, xOff, upperR, lowerR, upperMat, lowerMat, hasShoe) {
  const g = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperR, 0.3, 6, 12), upperMat);
  upper.position.set(xOff, yTop, 0); upper.castShadow = true; g.add(upper);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerR, 0.28, 6, 12), lowerMat);
  lower.position.set(xOff, yMid, 0); lower.castShadow = true; g.add(lower);
  if (hasShoe) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.22), shoeMat);
    shoe.position.set(xOff, yEnd, 0.03); shoe.castShadow = true; g.add(shoe);
  } else {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), skinMat);
    hand.position.set(xOff, yEnd, 0); hand.castShadow = true; g.add(hand);
  }
  return g;
}

export let humanoid, head;
let talkTimer = 0;

export function createHumanoid() {
  humanoid = new THREE.Group();

  head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 24), skinMat);
  head.position.y = 2.12; head.castShadow = true;
  humanoid.add(head);

  const eyeGeo   = new THREE.SphereGeometry(0.04, 12, 12);
  const pupilGeo = new THREE.SphereGeometry(0.02, 10, 10);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.08, 2.14, 0.18);
    humanoid.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(side * 0.08, 2.14, 0.22);
    humanoid.add(pupil);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 12), skinMat);
  neck.position.y = 1.86; neck.castShadow = true;
  humanoid.add(neck);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 8, 16), clothMat);
  torso.position.y = 1.55; torso.castShadow = true;
  humanoid.add(torso);

  const hipsBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.15, 8, 16), pantsMat);
  hipsBody.position.y = 1.15; hipsBody.castShadow = true;
  humanoid.add(hipsBody);

  humanoid.add(createLimb(1.65, 1.32, 1.12, -0.32, 0.055, 0.045, clothMat, skinMat, false));
  humanoid.add(createLimb(1.65, 1.32, 1.12,  0.32, 0.055, 0.045, clothMat, skinMat, false));
  humanoid.add(createLimb(0.85, 0.42, 0.04, -0.1, 0.07, 0.055, pantsMat, pantsMat, true));
  humanoid.add(createLimb(0.85, 0.42, 0.04,  0.1, 0.07, 0.055, pantsMat, pantsMat, true));

  scene.add(humanoid);
}

export function animateHumanoid(t, isTalking) {
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

  humanoid.children.forEach(child => {
    if (child.isGroup) child.children.forEach(part => {
      if (part.position.y > 1 && part.position.y < 1.7)
        part.rotation.x = Math.sin(t * 0.7 + part.position.x) * 0.02;
    });
  });
}
