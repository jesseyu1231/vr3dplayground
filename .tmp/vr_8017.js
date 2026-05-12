/**
 * vr.js — Quest-first WebXR locomotion with comfort turning.
 */
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { camera, dolly, renderer } from './state.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const worldForward = new THREE.Vector3();
const worldRight = new THREE.Vector3();
const flattenedForward = new THREE.Vector3();
const worldPos = new THREE.Vector3();
const targetMove = new THREE.Vector2();
const smoothMove = new THREE.Vector2();

const STICK_DEADZONE = 0.18;
const STICK_RELEASE = 0.12;
const MOVE_SPEED = 1.7;
const STRAFE_FACTOR = 0.7;
const BACKWARD_FACTOR = 0.55;
const MOVE_RESPONSE = 10;
const SNAP_TURN_DEGREES = 30;
const EXIT_PROMPT_MS = 3000;

const xrState = {
  active: false,
  snapTurnReady: true,
  exitPromptVisible: false,
  exitPromptDeadline: 0,
  exitButtonLatched: false,
  savedCameraPosition: new THREE.Vector3(),
  savedCameraQuaternion: new THREE.Quaternion(),
  savedDollyPosition: new THREE.Vector3(),
  savedDollyQuaternion: new THREE.Quaternion(),
};

function applyDeadzone(value) {
  const abs = Math.abs(value);
  if (abs < STICK_DEADZONE) return 0;
  const scaled = (abs - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return Math.sign(value) * scaled;
}

function getPrimaryAxes(gamepad) {
  if (!gamepad || !gamepad.axes || gamepad.axes.length === 0) {
    return { x: 0, y: 0 };
  }

  if (gamepad.axes.length >= 4) {
    return { x: gamepad.axes[2], y: gamepad.axes[3] };
  }

  return { x: gamepad.axes[0] || 0, y: gamepad.axes[1] || 0 };
}

function readInputSources(session) {
  let moveX = 0;
  let moveY = 0;
  let turnX = 0;
  let exitPressed = false;

  for (const inputSource of session.inputSources) {
    if (!inputSource.gamepad) continue;
    const axes = getPrimaryAxes(inputSource.gamepad);

    if (inputSource.handedness === 'left') {
      moveX = axes.x;
      moveY = axes.y;
    } else if (inputSource.handedness === 'right') {
      turnX = axes.x;
      exitPressed = getExitButtonPressed(inputSource.gamepad);
    } else if (!moveX && !moveY) {
      moveX = axes.x;
      moveY = axes.y;
    }
  }

  return {
    moveX: applyDeadzone(moveX),
    moveY: applyDeadzone(moveY),
    turnX: applyDeadzone(turnX),
    exitPressed,
  };
}

function getExitButtonPressed(gamepad) {
  if (!gamepad?.buttons?.length) return false;
  const buttons = gamepad.buttons;
  const faceB = buttons[4]?.pressed;
  const fallbackB = !faceB && buttons[5]?.pressed;
  return Boolean(faceB || fallbackB);
}

function computeRigForward() {
  camera.getWorldDirection(worldForward);
  worldForward.y = 0;
  if (worldForward.lengthSq() < 1e-5) {
    worldForward.copy(FORWARD);
  } else {
    worldForward.normalize();
  }
  worldRight.crossVectors(worldForward, WORLD_UP).normalize();
}

function captureDesktopPose() {
  xrState.savedCameraPosition.copy(camera.position);
  xrState.savedCameraQuaternion.copy(camera.quaternion);
  xrState.savedDollyPosition.copy(dolly.position);
  xrState.savedDollyQuaternion.copy(dolly.quaternion);
}

function enterFirstPersonRig() {
  captureDesktopPose();

  camera.getWorldPosition(worldPos);
  camera.getWorldDirection(flattenedForward);
  flattenedForward.y = 0;
  if (flattenedForward.lengthSq() < 1e-5) {
    flattenedForward.copy(FORWARD);
  } else {
    flattenedForward.normalize();
  }

  dolly.position.set(worldPos.x, 0, worldPos.z);
  dolly.quaternion.setFromUnitVectors(FORWARD, flattenedForward);

  camera.position.set(0, 0, 0);
  camera.quaternion.identity();

  targetMove.set(0, 0);
  smoothMove.set(0, 0);
  xrState.snapTurnReady = true;
  xrState.active = true;
}

function restoreDesktopRig() {
  dolly.position.copy(xrState.savedDollyPosition);
  dolly.quaternion.copy(xrState.savedDollyQuaternion);
  camera.position.copy(xrState.savedCameraPosition);
  camera.quaternion.copy(xrState.savedCameraQuaternion);
  targetMove.set(0, 0);
  smoothMove.set(0, 0);
  xrState.active = false;
}

async function endCurrentSession() {
  const session = renderer.xr.getSession();
  if (!session) return;
  try {
    await session.end();
  } catch (err) {
    console.error('[VR] Failed to end session:', err);
  }
}

function setExitPromptVisible(visible) {
  const prompt = document.getElementById('vr-exit-prompt');
  if (prompt) prompt.classList.toggle('hidden', !visible);
  xrState.exitPromptVisible = visible;
  if (!visible) {
    xrState.exitPromptDeadline = 0;
  }
}

function showExitPrompt() {
  xrState.exitPromptDeadline = performance.now() + EXIT_PROMPT_MS;
  setExitPromptVisible(true);
}

function dismissExitPrompt() {
  setExitPromptVisible(false);
}

async function handleExitIntent() {
  if (xrState.exitPromptVisible) {
    await endCurrentSession();
    return;
  }
  showExitPrompt();
}

function handleSnapTurn(turnX) {
  if (Math.abs(turnX) < STICK_RELEASE) {
    xrState.snapTurnReady = true;
    return;
  }

  if (!xrState.snapTurnReady) return;

  const angle = THREE.MathUtils.degToRad(SNAP_TURN_DEGREES) * (turnX < 0 ? 1 : -1);
  dolly.rotateY(angle);
  xrState.snapTurnReady = false;
}

function updateMovement(delta, moveX, moveY) {
  targetMove.set(moveX, moveY);
  const alpha = 1 - Math.exp(-MOVE_RESPONSE * delta);
  smoothMove.lerp(targetMove, alpha);

  const localX = smoothMove.x * STRAFE_FACTOR;
  const forwardInput = -smoothMove.y;
  const localZ = forwardInput >= 0 ? forwardInput : forwardInput * BACKWARD_FACTOR;

  const magnitude = Math.hypot(localX, localZ);
  if (magnitude < 1e-3) return;

  const scale = magnitude > 1 ? 1 / magnitude : 1;
  computeRigForward();

  dolly.position.addScaledVector(worldRight, localX * scale * MOVE_SPEED * delta);
  dolly.position.addScaledVector(worldForward, localZ * scale * MOVE_SPEED * delta);
}

export function initVRExperience({ orbitControls, tControls, setXRStatus, refreshXRStatus }) {
  renderer.xr.setReferenceSpaceType('local-floor');
  const exitVrBtn = document.getElementById('exit-vr-btn');
  const exitPromptConfirmBtn = document.getElementById('vr-exit-confirm-btn');
  const exitPromptCancelBtn = document.getElementById('vr-exit-cancel-btn');

  if (exitVrBtn) {
    exitVrBtn.addEventListener('click', () => {
      showExitPrompt();
    });
  }

  if (exitPromptConfirmBtn) {
    exitPromptConfirmBtn.addEventListener('click', () => {
      endCurrentSession();
    });
  }

  if (exitPromptCancelBtn) {
    exitPromptCancelBtn.addEventListener('click', () => {
      dismissExitPrompt();
    });
  }

  const vrButton = VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay'],
    domOverlay: { root: document.body },
  });
  vrButton.id = 'vr-enter-btn';
  document.body.appendChild(vrButton);

  renderer.xr.addEventListener('sessionstart', () => {
    document.body.classList.add('xr-session-active');
    orbitControls.enabled = false;
    tControls.enabled = false;
    enterFirstPersonRig();
    dismissExitPrompt();
    setXRStatus('XR: VR active. Left stick moves, right stick snap-turns.', 'xr-ready');
  });

  renderer.xr.addEventListener('sessionend', () => {
    document.body.classList.remove('xr-session-active');
    restoreDesktopRig();
    dismissExitPrompt();
    orbitControls.enabled = true;
    tControls.enabled = true;
    refreshXRStatus();
  });
}

export function updateVRExperience(delta) {
  if (!renderer.xr.isPresenting || !xrState.active) return;

  const session = renderer.xr.getSession();
  if (!session) return;

  const { moveX, moveY, turnX, exitPressed } = readInputSources(session);
  if (xrState.exitPromptVisible && performance.now() > xrState.exitPromptDeadline) {
    dismissExitPrompt();
  }

  if (exitPressed && !xrState.exitButtonLatched) {
    handleExitIntent();
    xrState.exitButtonLatched = true;
  } else if (!exitPressed) {
    xrState.exitButtonLatched = false;
  }

  handleSnapTurn(turnX);
  updateMovement(delta, moveX, moveY);
}