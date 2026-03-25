/**
 * vr.js — VRButton, XR controllers, hand panel, VR locomotion, session events.
 */
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { renderer, camera, dolly, scene, importedObjects, userLights, selectedObject, setSelectedObject, chatHistory3D } from './state.js';
import { collectAllMeshes, findSelectableRoot } from './controls.js';

// ── VR Button + WebXR availability check ──
export function initVR() {
  const vrOverlay = document.getElementById('vr-overlay');
  const vrSessionInit = {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers', 'dom-overlay'],
    domOverlay: { root: vrOverlay }
  };
  document.body.appendChild(VRButton.createButton(renderer, vrSessionInit));

  const vrStatus = document.getElementById('vr-status');
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      vrStatus.textContent = ok ? 'WebXR: VR supported \u2713' : 'WebXR: No VR headset detected';
    });
  } else {
    vrStatus.textContent = 'WebXR: Not supported in this browser';
  }
}

// ── XR Controllers ──
const controllerModelFactory = new XRControllerModelFactory();
export let controller1, controller2, leftGrip, rightGrip;

function setupController(index) {
  const ctrl = renderer.xr.getController(index);
  dolly.add(ctrl);
  const grip = renderer.xr.getControllerGrip(index);
  grip.add(controllerModelFactory.createControllerModel(grip));
  dolly.add(grip);
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -4)
  ]);
  ctrl.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x4488ff })));
  return { ctrl, grip };
}

export function initControllers() {
  const left  = setupController(0);
  const right = setupController(1);
  controller1 = left.ctrl;
  controller2 = right.ctrl;
  leftGrip  = left.grip;
  rightGrip = right.grip;
}

// ── VR Hand Panel (wrist-mounted chat) ──
const handPanelCanvas = document.createElement('canvas');
handPanelCanvas.width = 512; handPanelCanvas.height = 384;
const handPanelTexture = new THREE.CanvasTexture(handPanelCanvas);
export let handPanel;
export let handPanelDirty = true;
export function setHandPanelDirty(v) { handPanelDirty = v; }

export function initHandPanel() {
  handPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.18),
    new THREE.MeshBasicMaterial({ map: handPanelTexture, transparent: true })
  );
  handPanel.position.set(0, 0.06, -0.08);
  handPanel.rotation.x = -Math.PI / 3;
  leftGrip.add(handPanel);
  drawHandPanel();
}

export const quickReplies = ['Hello!', 'Tell me more.', "That's interesting.", 'What can you do?', 'Goodbye!'];
export let quickReplyIndex = 0;

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawHandPanel() {
  const ctx = handPanelCanvas.getContext('2d');
  const w = handPanelCanvas.width, h = handPanelCanvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(10,10,30,0.92)';
  rrect(ctx, 0, 0, w, h, 16); ctx.fill();
  ctx.strokeStyle = 'rgba(74,124,255,0.5)';
  ctx.lineWidth = 2;
  rrect(ctx, 1, 1, w - 2, h - 2, 15); ctx.stroke();

  ctx.fillStyle = '#7eb8ff';
  ctx.font = 'bold 20px Segoe UI, sans-serif';
  ctx.fillText('\ud83d\udcac Chat', 16, 30);

  ctx.font = '16px Segoe UI, sans-serif';
  const recent = chatHistory3D.slice(-5);
  let y = 56;
  for (const msg of recent) {
    ctx.fillStyle = msg.startsWith('You:') ? '#7eb8ff' : '#b8ffb8';
    const display = msg.length > 45 ? msg.substring(0, 45) + '\u2026' : msg;
    ctx.fillText(display, 16, y);
    y += 24;
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.moveTo(16, h - 80); ctx.lineTo(w - 16, h - 80); ctx.stroke();

  ctx.fillStyle = '#ffd27e';
  ctx.font = 'bold 14px Segoe UI, sans-serif';
  ctx.fillText('L-Grip: Send | R-Grip: Cycle', 16, h - 58);
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px Segoe UI, sans-serif';
  ctx.fillText('\u25b8 ' + quickReplies[quickReplyIndex], 16, h - 32);

  handPanelTexture.needsUpdate = true;
}

// ── VR Grab ──
export let grabController = null;
const grabOffset = new THREE.Matrix4();
const tempMatrix  = new THREE.Matrix4();
const raycaster   = new THREE.Raycaster();

function onSelectStart(event) {
  const ctrl = event.target;
  tempMatrix.identity().extractRotation(ctrl.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  const hits = raycaster.intersectObjects(collectAllMeshes(), true);
  if (hits.length > 0) {
    const target = findSelectableRoot(hits[0].object);
    if (target) {
      grabController = ctrl;
      setSelectedObject(target);
      grabOffset.copy(ctrl.matrixWorld).invert().multiply(target.matrixWorld);
    }
  }
}

function onSelectEnd(event) {
  if (grabController === event.target) grabController = null;
}

export function initControllerEvents() {
  controller1.addEventListener('selectstart', onSelectStart);
  controller1.addEventListener('selectend', onSelectEnd);
  controller2.addEventListener('selectstart', onSelectStart);
  controller2.addEventListener('selectend', onSelectEnd);
}

// ── VR Locomotion constants ──
export let snapTurnReady = true;
export const SNAP_TURN_ANGLE = Math.PI / 6;
export const MOVE_SPEED = 0.04;
let leftSqueezeWas = false, rightSqueezeWas = false;

export function animateVR(sendQuickReplyFn) {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;
    const axes   = source.gamepad.axes;
    const buttons = source.gamepad.buttons;
    const axisX  = axes.length >= 4 ? axes[2] : 0;
    const axisY  = axes.length >= 4 ? axes[3] : 0;
    const squeezePressed = buttons.length > 1 && buttons[1].pressed;

    if (source.handedness === 'left') {
      if (grabController !== controller1) {
        if (Math.abs(axisX) > 0.15 || Math.abs(axisY) > 0.15) {
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          forward.y = 0; forward.normalize();
          const rightDir = new THREE.Vector3();
          rightDir.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
          dolly.position.addScaledVector(forward, -axisY * MOVE_SPEED);
          dolly.position.addScaledVector(rightDir, axisX * MOVE_SPEED);
        }
      }
      if (squeezePressed && !leftSqueezeWas) sendQuickReplyFn();
      leftSqueezeWas = squeezePressed;
    }

    if (source.handedness === 'right') {
      if (grabController !== controller2) {
        if (Math.abs(axisX) > 0.5 && snapTurnReady) {
          dolly.rotation.y -= Math.sign(axisX) * SNAP_TURN_ANGLE;
          snapTurnReady = false;
        }
        if (Math.abs(axisX) < 0.3) snapTurnReady = true;
      }
      if (squeezePressed && !rightSqueezeWas) {
        quickReplyIndex = (quickReplyIndex + 1) % quickReplies.length;
        handPanelDirty = true;
      }
      rightSqueezeWas = squeezePressed;
    }
  }
}

export function updateVRGrab() {
  if (grabController && selectedObject) {
    selectedObject.matrixAutoUpdate = false;
    selectedObject.matrix.copy(grabController.matrixWorld).multiply(grabOffset);
    selectedObject.matrix.decompose(selectedObject.position, selectedObject.quaternion, selectedObject.scale);
    selectedObject.matrixAutoUpdate = true;
    if (selectedObject.userData.lightInfo) {
      const li = selectedObject.userData.lightInfo;
      li.light.position.copy(selectedObject.position);
      if (li.helper) li.helper.update();
    }
  }
}

// ── Session start/end ──
export function initSessionEvents(orbitControls, tControls, assetPanel, hideLightPropsFn) {
  const vrOverlay = document.getElementById('vr-overlay');

  renderer.xr.addEventListener('sessionstart', () => {
    dolly.position.set(0, 0, 3);
    dolly.rotation.set(0, 0, 0);
    camera.position.set(0, 0, 0);
    orbitControls.enabled = false;
    tControls.detach();

    document.getElementById('chat-panel').style.display = 'none';
    document.getElementById('toolbar').style.display = 'none';
    document.getElementById('transform-modes').style.display = 'none';
    document.getElementById('shortcuts-hint').style.display = 'none';
    document.getElementById('mode-badge').style.display = 'none';
    assetPanel.style.display = 'none';
    hideLightPropsFn();
    document.getElementById('speech-bubble').style.display = 'none';

    vrOverlay.style.display = 'block';
    handPanelDirty = true;
  });

  renderer.xr.addEventListener('sessionend', () => {
    camera.position.set(0, 1.6, 4);
    dolly.position.set(0, 0, 0);
    dolly.rotation.set(0, 0, 0);
    orbitControls.enabled = true;

    document.getElementById('chat-panel').style.display = 'flex';
    document.getElementById('toolbar').style.display = 'flex';
    document.getElementById('transform-modes').style.display = 'flex';
    document.getElementById('shortcuts-hint').style.display = 'block';
    document.getElementById('mode-badge').style.display = 'block';

    vrOverlay.style.display = 'none';
  });
}
