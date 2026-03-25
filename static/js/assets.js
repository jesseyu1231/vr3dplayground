/**
 * assets.js — GLB/glTF import, scene export/import.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { scene, importedObjects, userLights, userContentGroup, genId, wsSend, chatHistory3D } from './state.js';
import { refreshAssetPanel } from './assetpanel.js';
import { pushUndo } from './undo.js';
import { addMessage } from './chat.js';
import { update3DChatPanel } from './textsprite.js';
import { setHandPanelDirty } from './vr.js';

const gltfLoader = new GLTFLoader();

// ── Normalize model size + placement ──
export function normalizeAndPlace(object, pos) {
  object.updateMatrixWorld(true);
  const box    = new THREE.Box3().setFromObject(object);
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0.001) {
    const targetSize = Math.min(Math.max(maxDim, 0.5), 3.0);
    object.scale.multiplyScalar(targetSize / maxDim);
  }
  object.updateMatrixWorld(true);
  const box2   = new THREE.Box3().setFromObject(object);
  const center = box2.getCenter(new THREE.Vector3());
  object.position.x += pos.x - center.x;
  object.position.y += pos.y - box2.min.y;
  object.position.z += pos.z - center.z;
  object.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

// ── Load a GLB from URL ──
export function loadGLB(url, filename, opts = {}) {
  gltfLoader.load(url, (gltf) => {
    const model = gltf.scene;
    if (!model) { addMessage('Import failed: no scene in file', 'system'); return; }
    const id = opts.id || genId();
    model.userData.id = id;
    model.userData.url = url;
    model.userData.displayName = filename || url.split('/').pop() || 'Object';
    if (opts.position && opts.quaternion && opts.scale) {
      model.position.fromArray(opts.position);
      model.quaternion.fromArray(opts.quaternion);
      model.scale.fromArray(opts.scale);
      model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    } else {
      normalizeAndPlace(model, new THREE.Vector3(1.2, 0, 0));
    }
    userContentGroup.add(model);
    importedObjects.push(model);
    if (!opts.remote) {
      pushUndo({ type: 'object_add', obj: model });
      chatHistory3D.push(`[Imported: ${filename}]`);
      update3DChatPanel();
      setHandPanelDirty(true);
      document.dispatchEvent(new CustomEvent('select-object', { detail: model }));
      wsSend({ type: 'object_add', object: {
        id, url, position: model.position.toArray(),
        quaternion: model.quaternion.toArray(), scale: model.scale.toArray(),
      }});
    }
    refreshAssetPanel();
  },
  undefined,
  (err) => {
    console.error('GLTFLoader error:', err);
    addMessage('Failed to load model: ' + (err.message || 'unknown error'), 'system');
  });
}

// ── File import (Import 3D button) ──
export function initFileImport() {
  const fileInput = document.getElementById('file-input');
  document.getElementById('import-btn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'gltf') {
      const url = URL.createObjectURL(file);
      gltfLoader.load(url, (gltf) => {
        const model = gltf.scene;
        if (!model) { addMessage('Import failed: no scene in file', 'system'); URL.revokeObjectURL(url); return; }
        const id = genId();
        model.userData.id = id;
        model.userData.url = '';
        model.userData.displayName = file.name;
        normalizeAndPlace(model, new THREE.Vector3(1.2, 0, 0));
        userContentGroup.add(model);
        importedObjects.push(model);
        pushUndo({ type: 'object_add', obj: model });
        chatHistory3D.push(`[Imported: ${file.name}]`);
        update3DChatPanel();
        setHandPanelDirty(true);
        document.dispatchEvent(new CustomEvent('select-object', { detail: model }));
        wsSend({ type: 'object_add', object: {
          id, url: '', position: model.position.toArray(),
          quaternion: model.quaternion.toArray(), scale: model.scale.toArray(),
        }});
        refreshAssetPanel();
        addMessage('Loaded ' + file.name + ' (local .gltf — for best results use .glb)', 'system');
        URL.revokeObjectURL(url);
      }, undefined, (err) => {
        URL.revokeObjectURL(url);
        console.error('GLTF load error:', err);
        addMessage('Failed to load .gltf: it likely references external files. Please convert to .glb format.', 'system');
      });
      fileInput.value = '';
      return;
    }

    // .glb — upload to server
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) loadGLB(data.url, data.name);
      else addMessage(data.error || 'Upload failed', 'system');
    } catch (err) {
      addMessage('Upload error: ' + err.message, 'system');
    }
    fileInput.value = '';
  });
}

// ── Delete + Duplicate ──
export function deleteSelected(selectedObject) {
  if (!selectedObject) return;
  if (selectedObject.userData.lightInfo) {
    const li = selectedObject.userData.lightInfo;
    pushUndo({ type: 'light_delete', info: li });
    scene.remove(li.light);
    if (li.helper) scene.remove(li.helper);
    scene.remove(li.handle);
    if (li.light.target) scene.remove(li.light.target);
    const idx = userLights.indexOf(li);
    if (idx !== -1) userLights.splice(idx, 1);
    if (li.id) wsSend({ type: 'light_delete', id: li.id });
  } else {
    pushUndo({ type: 'object_delete', obj: selectedObject });
    selectedObject.removeFromParent();
    const idx = importedObjects.indexOf(selectedObject);
    if (idx !== -1) importedObjects.splice(idx, 1);
    if (selectedObject.userData.id) wsSend({ type: 'object_delete', id: selectedObject.userData.id });
  }
  document.dispatchEvent(new CustomEvent('deselect-all'));
  refreshAssetPanel();
}

export function duplicateSelected(selectedObject) {
  if (!selectedObject || selectedObject.userData.lightInfo) return;
  const clone = selectedObject.clone();
  const id = genId();
  clone.userData.id = id;
  clone.position.x += 0.5;
  clone.position.z += 0.5;
  userContentGroup.add(clone);
  importedObjects.push(clone);
  pushUndo({ type: 'object_add', obj: clone });
  document.dispatchEvent(new CustomEvent('select-object', { detail: clone }));
  wsSend({ type: 'object_add', object: {
    id, url: selectedObject.userData.url || '',
    position: clone.position.toArray(),
    quaternion: clone.quaternion.toArray(),
    scale: clone.scale.toArray(),
  }});
  refreshAssetPanel();
}

// ── Scene export/import ──
export function initSceneExportImport() {
  document.getElementById('export-btn').addEventListener('click', async () => {
    const exporter = new GLTFExporter();
    try {
      const data = await exporter.parseAsync(userContentGroup, { binary: true });
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'scene.glb';
      a.click();
      URL.revokeObjectURL(a.href);
      addMessage('Scene exported as scene.glb', 'system');
    } catch (err) {
      addMessage('Export failed: ' + err.message, 'system');
    }
  });

  const sceneFileInput = document.getElementById('scene-file-input');
  document.getElementById('import-scene-btn').addEventListener('click', () => sceneFileInput.click());
  sceneFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    gltfLoader.load(url, (gltf) => {
      for (const child of [...gltf.scene.children]) {
        const id = genId();
        child.userData.id = id;
        child.userData.url = '';
        child.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        userContentGroup.add(child);
        importedObjects.push(child);
        wsSend({ type: 'object_add', object: {
          id, url: '',
          position: child.position.toArray(),
          quaternion: child.quaternion.toArray(),
          scale: child.scale.toArray(),
        }});
      }
      URL.revokeObjectURL(url);
      addMessage('Scene loaded from ' + file.name, 'system');
    });
    e.target.value = '';
  });
}
