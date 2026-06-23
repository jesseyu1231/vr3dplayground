/**
 * undo.js — undo/redo stack and action application.
 */
import { scene, importedObjects, userLights, selectedObject, userContentGroup } from './state.js';
import { applyEnvPreset, envPresets, envIndex, setEnvIndex } from './environment.js';
import { refreshAssetPanel } from './assetpanel.js';
import { deleteDocent, restoreDocent } from './humanoid.js';

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

export function pushUndo(action) {
  undoStack.push(action);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

function updateUndoButtons() {
  document.getElementById('undo-btn').style.opacity = undoStack.length ? '1' : '0.4';
  document.getElementById('redo-btn').style.opacity = redoStack.length ? '1' : '0.4';
}

export function initUndoButtons() {
  updateUndoButtons();
  document.getElementById('undo-btn').addEventListener('click', performUndo);
  document.getElementById('redo-btn').addEventListener('click', performRedo);
}

function captureObjectState(obj) {
  return {
    position: obj.position.toArray(),
    quaternion: obj.quaternion.toArray(),
    scale: obj.scale.toArray(),
  };
}

function applyObjectState(obj, state) {
  obj.position.fromArray(state.position);
  obj.quaternion.fromArray(state.quaternion);
  obj.scale.fromArray(state.scale);
}

export function performUndo() {
  if (!undoStack.length) return;
  const action = undoStack.pop();
  redoStack.push(action);
  applyAction(action, false);
  updateUndoButtons();
  refreshAssetPanel();
}

export function performRedo() {
  if (!redoStack.length) return;
  const action = redoStack.pop();
  undoStack.push(action);
  applyAction(action, true);
  updateUndoButtons();
  refreshAssetPanel();
}

function applyAction(action, isRedo) {
  switch (action.type) {
    case 'transform': {
      const obj = importedObjects.find(o => o.userData.id === action.id) ||
                  userLights.find(l => l.id === action.id)?.handle;
      if (!obj) break;
      const current = captureObjectState(obj);
      applyObjectState(obj, isRedo ? action.after : action.before);
      if (isRedo) action.before = current; else action.after = current;
      if (obj.userData.lightInfo) {
        const li = obj.userData.lightInfo;
        li.light.position.copy(obj.position);
        if (li.helper) li.helper.update();
      }
      break;
    }
    case 'object_add': {
      if (isRedo) {
        userContentGroup.add(action.obj);
        importedObjects.push(action.obj);
      } else {
        action.obj.removeFromParent();
        const idx = importedObjects.indexOf(action.obj);
        if (idx !== -1) importedObjects.splice(idx, 1);
        if (selectedObject === action.obj) document.dispatchEvent(new CustomEvent('deselect-all'));
      }
      break;
    }
    case 'object_delete': {
      if (isRedo) {
        action.obj.removeFromParent();
        const idx = importedObjects.indexOf(action.obj);
        if (idx !== -1) importedObjects.splice(idx, 1);
        if (selectedObject === action.obj) document.dispatchEvent(new CustomEvent('deselect-all'));
      } else {
        userContentGroup.add(action.obj);
        importedObjects.push(action.obj);
      }
      break;
    }
    case 'light_add': {
      if (isRedo) {
        scene.add(action.info.light);
        if (action.info.light.target) scene.add(action.info.light.target);
        if (action.info.helper) scene.add(action.info.helper);
        scene.add(action.info.handle);
        userLights.push(action.info);
      } else {
        scene.remove(action.info.light);
        if (action.info.helper) scene.remove(action.info.helper);
        scene.remove(action.info.handle);
        if (action.info.light.target) scene.remove(action.info.light.target);
        const idx = userLights.indexOf(action.info);
        if (idx !== -1) userLights.splice(idx, 1);
        if (selectedObject === action.info.handle) document.dispatchEvent(new CustomEvent('deselect-all'));
      }
      break;
    }
    case 'light_delete': {
      if (isRedo) {
        scene.remove(action.info.light);
        if (action.info.helper) scene.remove(action.info.helper);
        scene.remove(action.info.handle);
        if (action.info.light.target) scene.remove(action.info.light.target);
        const idx = userLights.indexOf(action.info);
        if (idx !== -1) userLights.splice(idx, 1);
        if (selectedObject === action.info.handle) document.dispatchEvent(new CustomEvent('deselect-all'));
      } else {
        scene.add(action.info.light);
        if (action.info.light.target) scene.add(action.info.light.target);
        if (action.info.helper) scene.add(action.info.helper);
        scene.add(action.info.handle);
        userLights.push(action.info);
      }
      break;
    }
    case 'default_light_remove': {
      if (isRedo) {
        scene.remove(action.dl.light);
      } else {
        scene.add(action.dl.light);
        action.dl.light.color.set(action.color);
        action.dl.light.intensity = action.intensity;
      }
      break;
    }
    case 'default_light_add': {
      if (isRedo) scene.add(action.dl.light);
      else scene.remove(action.dl.light);
      break;
    }
    case 'default_item': {
      // action.items: default scene items toggled; action.removed: true if this action
      // removed them (so undo re-adds; redo re-removes). Scene-remove only, never disposed.
      const doRemove = action.removed ? isRedo : !isRedo;
      for (const it of action.items) {
        if (doRemove) {
          if (it.kind === 'docent') deleteDocent(); else it.object.removeFromParent();
          if (selectedObject === it.object) document.dispatchEvent(new CustomEvent('deselect-all'));
        } else {
          if (it.kind === 'docent') restoreDocent(); else it.parent.add(it.object);
        }
      }
      break;
    }
    case 'default_bulk': {
      // Folder "delete/restore all": default items + the default lights inside the folder.
      const doRemove = action.removed ? isRedo : !isRedo;
      for (const it of action.items) {
        if (doRemove) {
          if (it.kind === 'docent') deleteDocent(); else it.object.removeFromParent();
          if (selectedObject === it.object) document.dispatchEvent(new CustomEvent('deselect-all'));
        } else {
          if (it.kind === 'docent') restoreDocent(); else it.parent.add(it.object);
        }
      }
      for (const L of action.lights) {
        if (doRemove) {
          scene.remove(L.dl.light);
        } else {
          scene.add(L.dl.light);
          L.dl.light.color.set(L.color);
          L.dl.light.intensity = L.intensity;
        }
      }
      break;
    }
    case 'env_change': {
      const target = isRedo ? action.newIndex : action.oldIndex;
      setEnvIndex(target);
      applyEnvPreset(envPresets[target]);
      document.getElementById('env-btn').textContent = '\u2600 ' + envPresets[target].name;
      break;
    }
  }
}
