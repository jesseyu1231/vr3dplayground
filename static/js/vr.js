/**
 * vr.js — Quest-first WebXR locomotion + in-VR chat/keyboard/mic UI.
 *
 * Left controller carries a wrist-mounted chat panel (Mic / Keys / Send).
 * Right controller emits a laser used to click panel buttons and keys.
 * Speech-to-text runs fully on-device via Whisper (transformers.js, WASM).
 */
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { camera, dolly, renderer, chatHistory3D } from './state.js';
import { WristPanel, Keyboard, makePointerRay } from './vrui.js';
import { isSttSupported, startRecording, stopRecording, cancelRecording, abortTranscription } from './vrstt.js';

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

// ── Controllers & UI ────────────────────────────────────────────────────────

const controllers = [
  { controller: null, grip: null, model: null, handedness: null, inputSource: null },
  { controller: null, grip: null, model: null, handedness: null, inputSource: null },
];

let wristPanel = null;
let wristPanelPivot = null;
let keyboard = null;
let pointerRay = null;
let chatHelpers = null;
let lastHistoryLen = -1;
let modelFactory = null;

// Mic state machine. Every click bumps `micGen` so async tasks from older
// clicks know to bail when they wake up.
const MIC_IDLE = 'idle';
const MIC_STARTING = 'starting';
const MIC_RECORDING = 'recording';
const MIC_TRANSCRIBING = 'transcribing';
let micState = MIC_IDLE;
let micGen = 0;

const raycaster = new THREE.Raycaster();
const _tmpMat = new THREE.Matrix4();
const _tmpVec = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();

// ── Stick / button helpers (existing) ───────────────────────────────────────

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
  if (!visible) xrState.exitPromptDeadline = 0;
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

// ── In-VR UI wiring ─────────────────────────────────────────────────────────

function getController(side) { return controllers.find(c => c.handedness === side); }

function ensureWristPanel() {
  if (wristPanel) return;
  wristPanel = new WristPanel();
  wristPanelPivot = new THREE.Group();
  wristPanelPivot.add(wristPanel.mesh);
  wristPanelPivot.visible = false;
  dolly.add(wristPanelPivot);
  refreshChatHistoryOnPanel(true);
  wristPanel.setStatus(
    isSttSupported()
      ? 'Tap Keys to type, Mic to speak.'
      : 'Tap Keys to type. (Mic unavailable on this browser.)'
  );
}

function ensureKeyboard() {
  if (keyboard) return;
  keyboard = new Keyboard();
  keyboard.group.position.set(0, 1.2, -0.7);
  keyboard.group.rotation.set(-Math.PI / 10, 0, 0);
  dolly.add(keyboard.group);
}

function ensurePointerRay() {
  if (pointerRay) return;
  pointerRay = makePointerRay();
  dolly.add(pointerRay.dot);
}

function attachControllerModels() {
  if (!modelFactory) modelFactory = new XRControllerModelFactory();
  for (const c of controllers) {
    if (c.grip && !c.model) {
      c.model = modelFactory.createControllerModel(c.grip);
      c.grip.add(c.model);
    }
  }
}

function onControllerConnected(slot) {
  return (event) => {
    slot.handedness = event.data?.handedness || null;
    slot.inputSource = event.data || null;
    attachControllerModels();
    setupHandUI();
  };
}

function onControllerDisconnected(slot) {
  return () => {
    if (slot.handedness === 'right' && pointerRay) {
      pointerRay.line.visible = false;
      pointerRay.dot.visible = false;
    }
    slot.handedness = null;
    slot.inputSource = null;
  };
}

function setupHandUI() {
  const left = getController('left');
  const right = getController('right');

  if (left && wristPanelPivot) {
    wristPanelPivot.visible = true;
  } else if (wristPanelPivot) {
    wristPanelPivot.visible = false;
  }

  if (right && pointerRay) {
    if (pointerRay.line.parent !== right.controller) {
      right.controller.add(pointerRay.line);
    }
    pointerRay.line.visible = true;
  }
}

function refreshChatHistoryOnPanel(force = false) {
  if (!wristPanel) return;
  if (!force && chatHistory3D.length === lastHistoryLen) return;
  lastHistoryLen = chatHistory3D.length;
  wristPanel.setHistory(chatHistory3D);
}

function pulseHaptic(handedness, intensity = 0.5, duration = 35) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    if (src.handedness !== handedness) continue;
    const a = src.gamepad?.hapticActuators?.[0];
    if (a?.pulse) {
      try { a.pulse(intensity, duration); } catch { /* ignore */ }
    }
    return;
  }
}

// ── Right-controller raycasting ─────────────────────────────────────────────

function getRayTargets() {
  const targets = [];
  if (wristPanel && wristPanelPivot?.visible) targets.push(wristPanel.mesh);
  if (keyboard?.group?.visible) {
    for (const m of keyboard.getKeyMeshes()) targets.push(m);
  }
  return targets;
}

function castFromRightController() {
  const right = getController('right');
  if (!right?.controller) return null;
  _tmpMat.identity().extractRotation(right.controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(right.controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_tmpMat).normalize();
  raycaster.far = 8;
  const targets = getRayTargets();
  if (!targets.length) return null;
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0] : null;
}

function updatePointerVisual(hit) {
  if (!pointerRay) return;
  const right = getController('right');
  if (!right?.controller) {
    pointerRay.line.visible = false;
    pointerRay.dot.visible = false;
    return;
  }
  pointerRay.line.visible = true;

  if (hit) {
    pointerRay.line.scale.z = Math.max(0.05, hit.distance);
    pointerRay.dot.visible = true;
    pointerRay.dot.position.copy(hit.point);
    dolly.worldToLocal(pointerRay.dot.position);
    // Face dot at the camera so it's always readable.
    camera.getWorldPosition(_tmpVec);
    pointerRay.dot.lookAt(_tmpVec);
  } else {
    pointerRay.line.scale.z = 2.0;
    pointerRay.dot.visible = false;
  }
}

function updateHover(hit) {
  if (!hit) {
    wristPanel?.setHover(null);
    keyboard?.setHover(null);
    return;
  }
  if (hit.object === wristPanel?.mesh) {
    const btn = wristPanel.hitButton(hit.uv);
    wristPanel.setHover(btn);
    keyboard?.setHover(null);
  } else if (hit.object?.userData?.uiKind === 'keyboard-key') {
    wristPanel?.setHover(null);
    keyboard?.setHover(hit.object);
  } else {
    wristPanel?.setHover(null);
    keyboard?.setHover(null);
  }
}

function handleClick(hit) {
  if (!hit) return;

  if (hit.object === wristPanel?.mesh) {
    const btn = wristPanel.hitButton(hit.uv);
    if (!btn) return;
    pulseHaptic('right', 0.6, 30);
    if (btn === 'mic')             toggleMic();
    else if (btn === 'keyboard')   toggleKeyboard();
    else if (btn === 'send')       submitInput();
    else if (btn === 'scrollUp')   wristPanel.scrollBy(3);
    else if (btn === 'scrollDown') wristPanel.scrollBy(-3);
    return;
  }

  if (hit.object?.userData?.uiKind === 'keyboard-key' && keyboard) {
    pulseHaptic('right', 0.35, 20);
    const action = keyboard.flash(hit.object);
    if (!action || !wristPanel) return;
    if (action.kind === 'char') wristPanel.appendChar(action.value);
    else if (action.kind === 'back') wristPanel.backspace();
    else if (action.kind === 'enter') submitInput();
  }
}

// ── Wrist-panel button actions ──────────────────────────────────────────────

function toggleKeyboard() {
  ensureKeyboard();
  const visible = !keyboard.group.visible;
  if (visible) keyboard.show(); else keyboard.hide();
  wristPanel?.setKeyboardVisible(visible);
}

function resetMicToIdle(status) {
  cancelRecording();
  abortTranscription();
  micState = MIC_IDLE;
  if (wristPanel) {
    wristPanel.setMicActive(false);
    if (status) wristPanel.setStatus(status);
  }
}

async function toggleMic() {
  if (!wristPanel) return;
  if (!isSttSupported()) {
    wristPanel.setStatus('Mic not supported on this browser.');
    return;
  }

  const myGen = ++micGen;
  const stateAtClick = micState;

  // Impatient re-click during a non-recording busy state \u2192 cancel & reset.
  if (stateAtClick === MIC_STARTING || stateAtClick === MIC_TRANSCRIBING) {
    resetMicToIdle('Cancelled. Tap Mic to try again.');
    return;
  }

  // Active recording \u2192 stop, then transcribe.
  if (stateAtClick === MIC_RECORDING) {
    micState = MIC_TRANSCRIBING;
    wristPanel.setMicActive(false);
    wristPanel.setStatus('Transcribing\u2026');
    try {
      const text = await stopRecording((m) => {
        if (micGen === myGen) wristPanel.setStatus(m);
      });
      if (micGen !== myGen) return;            // cancelled mid-flight
      if (text) {
        wristPanel.setInputText((wristPanel.state.inputText + ' ' + text).trim());
        wristPanel.setStatus('Heard you. Tap Send to send.');
      } else {
        wristPanel.setStatus('Didn\u2019t catch that. Try again.');
      }
    } catch (err) {
      if (micGen !== myGen) return;
      if (String(err?.message || '').toLowerCase().includes('cancel')) return;
      console.error('[VR STT] stop failed:', err);
      wristPanel.setStatus('Speech error: ' + (err.message || 'unknown'));
    } finally {
      if (micGen === myGen) micState = MIC_IDLE;
    }
    return;
  }

  // Idle \u2192 start recording.
  try {
    micState = MIC_STARTING;
    wristPanel.setStatus('Requesting microphone\u2026');
    await startRecording((m) => {
      if (micGen === myGen) wristPanel.setStatus(m);
    });
    if (micGen !== myGen) {
      // User cancelled before mic was ready.
      cancelRecording();
      return;
    }
    micState = MIC_RECORDING;
    wristPanel.setMicActive(true);
    wristPanel.setStatus('\u25CF Recording\u2026 tap Mic to stop.');
  } catch (err) {
    if (micGen !== myGen) return;
    console.error('[VR STT] start failed:', err);
    wristPanel.setStatus('Mic blocked: ' + (err.message || 'permission denied'));
    micState = MIC_IDLE;
    wristPanel.setMicActive(false);
  }
}

async function submitInput() {
  if (!wristPanel || !chatHelpers) return;
  const text = wristPanel.state.inputText.trim();
  if (!text || wristPanel.state.sendBusy) return;
  wristPanel.setSendBusy(true);
  wristPanel.setStatus('Sending\u2026');
  try {
    await chatHelpers.sendMessage(text);
    wristPanel.clearInput();
    wristPanel.setStatus('Sent. Awaiting reply\u2026');
  } catch (err) {
    wristPanel.setStatus('Send failed: ' + (err.message || 'unknown'));
  } finally {
    wristPanel.setSendBusy(false);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function initVRExperience({ orbitControls, tControls, setXRStatus, refreshXRStatus, chat }) {
  chatHelpers = chat || null;

  renderer.xr.setReferenceSpaceType('local-floor');
  const exitVrBtn = document.getElementById('exit-vr-btn');
  const exitPromptConfirmBtn = document.getElementById('vr-exit-confirm-btn');
  const exitPromptCancelBtn = document.getElementById('vr-exit-cancel-btn');

  exitVrBtn?.addEventListener('click', () => showExitPrompt());
  exitPromptConfirmBtn?.addEventListener('click', () => endCurrentSession());
  exitPromptCancelBtn?.addEventListener('click', () => dismissExitPrompt());

  const vrButton = VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay'],
    domOverlay: { root: document.body },
  });
  vrButton.id = 'vr-enter-btn';
  document.body.appendChild(vrButton);

  // Set up controllers once at startup. Three.js fires 'connected'/'disconnected'
  // when an XR session starts/ends, which is when we learn which side is which.
  for (let i = 0; i < 2; i++) {
    const slot = controllers[i];
    slot.controller = renderer.xr.getController(i);
    slot.grip = renderer.xr.getControllerGrip(i);
    dolly.add(slot.controller);
    dolly.add(slot.grip);
    slot.controller.addEventListener('connected', onControllerConnected(slot));
    slot.controller.addEventListener('disconnected', onControllerDisconnected(slot));
    slot.controller.addEventListener('selectstart', () => {
      if (slot.handedness !== 'right') return;
      const hit = castFromRightController();
      handleClick(hit);
    });
  }

  ensureWristPanel();
  ensurePointerRay();

  renderer.xr.addEventListener('sessionstart', () => {
    document.body.classList.add('xr-session-active');
    orbitControls.enabled = false;
    tControls.enabled = false;
    enterFirstPersonRig();
    dismissExitPrompt();
    refreshChatHistoryOnPanel(true);
    setupHandUI();
    setXRStatus('XR: VR active. Left wrist = chat; right trigger = click.', 'xr-ready');
  });

  renderer.xr.addEventListener('sessionend', () => {
    document.body.classList.remove('xr-session-active');
    restoreDesktopRig();
    dismissExitPrompt();
    orbitControls.enabled = true;
    tControls.enabled = true;
    resetMicToIdle();
    if (wristPanel) wristPanelPivot.visible = false;
    keyboard?.hide();
    if (pointerRay) {
      pointerRay.line.visible = false;
      pointerRay.dot.visible = false;
    }
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

  // Anchor wrist panel to the left hand, billboarded toward the camera.
  const left = getController('left');
  if (wristPanelPivot && wristPanel && left?.grip) {
    left.grip.getWorldPosition(_tmpVec);
    _tmpVec.y += 0.05;                              // lift above the wrist
    wristPanelPivot.position.copy(_tmpVec);
    dolly.worldToLocal(wristPanelPivot.position);

    camera.getWorldPosition(_tmpVec2);
    wristPanelPivot.lookAt(_tmpVec2);               // For non-camera Object3D, lookAt
                                                    // points local +Z at the target — which
                                                    // is exactly what PlaneGeometry's front
                                                    // face needs. Don't add a Y flip here:
                                                    // that would show the mirrored back face.
    wristPanelPivot.translateZ(0.07);               // 7cm toward camera (between wrist & face)
    wristPanelPivot.visible = true;
  } else if (wristPanelPivot) {
    wristPanelPivot.visible = false;
  }

  // Raycast each frame so hover follows the laser smoothly.
  const hit = castFromRightController();
  updateHover(hit);
  updatePointerVisual(hit);

  refreshChatHistoryOnPanel(false);
  wristPanel?.redrawIfDirty();
}
