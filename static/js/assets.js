/**
 * assets.js — GLB/glTF import, scene export/import.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import JSZip from 'jszip';
import { scene, renderer, importedObjects, userLights, userContentGroup, genId, wsSend } from './state.js';
import { refreshAssetPanel } from './assetpanel.js';
import { pushUndo } from './undo.js';
import { addMessage } from './chat.js';

// ── DRACO compressed mesh support ──
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.163.0/examples/jsm/libs/draco/');

// ── KTX2/Basis texture compression support ──
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.163.0/examples/jsm/libs/basis/');
ktx2Loader.detectSupport(renderer);

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setKTX2Loader(ktx2Loader);

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

// ── Create primitive shape ──
export function createPrimitive(type, colorHex, opts = {}) {
  let geometry;
  switch (type) {
    case 'cube':     geometry = new THREE.BoxGeometry(1, 1, 1); break;
    case 'sphere':   geometry = new THREE.SphereGeometry(0.5, 32, 32); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
    case 'cone':     geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
    case 'torus':    geometry = new THREE.TorusGeometry(0.4, 0.15, 16, 100); break;
    default:         geometry = new THREE.BoxGeometry(1, 1, 1);
  }
  const material = new THREE.MeshStandardMaterial({ color: colorHex });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const id = opts.id || genId();
  mesh.userData.id = id;
  mesh.userData.displayName = type.charAt(0).toUpperCase() + type.slice(1);
  mesh.userData.isPrimitive = true;
  mesh.userData.primitiveType = type;

  if (opts.position) {
    mesh.position.fromArray(opts.position);
    if (opts.quaternion) mesh.quaternion.fromArray(opts.quaternion);
    if (opts.scale) mesh.scale.fromArray(opts.scale);
  } else {
    mesh.position.set(1.2, 0.5, 0);
  }

  userContentGroup.add(mesh);
  importedObjects.push(mesh);

  if (!opts.remote) {
    pushUndo({ type: 'object_add', obj: mesh });
    document.dispatchEvent(new CustomEvent('select-object', { detail: mesh }));
    wsSend({ type: 'object_add', object: {
      id, url: '', primitive: type, color: colorHex,
      position: mesh.position.toArray(),
      quaternion: mesh.quaternion.toArray(),
      scale: mesh.scale.toArray(),
    }});
  }
  refreshAssetPanel();
  return mesh;
}

// ── File import (Import 3D button → modal) ──
export function initFileImport() {
  const fileInput = document.getElementById('file-input');
  const importModal = document.getElementById('import-modal');
  const modalTabs = document.querySelectorAll('.modal-tab');
  const tabPrimitives = document.getElementById('tab-primitives');
  const tabUpload = document.getElementById('tab-upload');
  const primitiveBtns = document.querySelectorAll('.primitive-btn');
  const primitiveColor = document.getElementById('primitive-color');
  const modalFileInput = document.getElementById('modal-file-input');
  const modalUploadArea = document.getElementById('modal-upload-area');
  const modalCancel = document.getElementById('modal-cancel');
  const modalAdd = document.getElementById('modal-add');

  let selectedPrimitive = 'cube';

  // Open modal
  document.getElementById('import-btn').addEventListener('click', () => {
    importModal.classList.remove('hidden');
    selectedPrimitive = 'cube';
    primitiveBtns.forEach(btn => btn.classList.remove('selected'));
    primitiveBtns[0].classList.add('selected');
    primitiveColor.value = '#ffffff';
    modalTabs.forEach(t => t.classList.remove('active'));
    modalTabs[0].classList.add('active');
    tabPrimitives.classList.remove('hidden');
    tabUpload.classList.add('hidden');
  });

  modalCancel.addEventListener('click', () => importModal.classList.add('hidden'));
  importModal.addEventListener('click', (e) => { if (e.target === importModal) importModal.classList.add('hidden'); });

  // Tab switching
  modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modalTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.tab === 'primitives') {
        tabPrimitives.classList.remove('hidden');
        tabUpload.classList.add('hidden');
      } else {
        tabPrimitives.classList.add('hidden');
        tabUpload.classList.remove('hidden');
      }
    });
  });

  // Primitive selection
  primitiveBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      primitiveBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPrimitive = btn.dataset.shape;
    });
  });

  // Add button
  modalAdd.addEventListener('click', () => {
    const activeTab = document.querySelector('.modal-tab.active').dataset.tab;
    if (activeTab === 'primitives') {
      createPrimitive(selectedPrimitive, primitiveColor.value);
      importModal.classList.add('hidden');
    }
  });

  // Upload area
  modalUploadArea.addEventListener('click', () => modalFileInput.click());
  modalFileInput.addEventListener('change', async () => {
    const file = modalFileInput.files[0];
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
        document.dispatchEvent(new CustomEvent('select-object', { detail: model }));
        refreshAssetPanel();
        addMessage('Loaded ' + file.name + ' (local .gltf)', 'system');
        URL.revokeObjectURL(url);
      }, undefined, () => {
        URL.revokeObjectURL(url);
        addMessage('Failed to load .gltf file', 'system');
      });
      modalFileInput.value = '';
      importModal.classList.add('hidden');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) { loadGLB(data.url, data.name); importModal.classList.add('hidden'); }
      else addMessage(data.error || 'Upload failed', 'system');
    } catch (err) { addMessage('Upload error: ' + err.message, 'system'); }
    modalFileInput.value = '';
  });

  // Legacy file input (still works for drag-drop etc.)
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
    disposeObject(selectedObject);
    const idx = importedObjects.indexOf(selectedObject);
    if (idx !== -1) importedObjects.splice(idx, 1);
    if (selectedObject.userData.id) wsSend({ type: 'object_delete', id: selectedObject.userData.id });
  }
  document.dispatchEvent(new CustomEvent('deselect-all'));
  refreshAssetPanel();
}

// ── Dispose GPU resources (geometry, materials, textures) ──
function disposeObject(obj) {
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        for (const val of Object.values(mat)) {
          if (val && typeof val.dispose === 'function') val.dispose();
        }
        mat.dispose();
      }
    }
  });
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
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}


export function initSceneExportImport({
  addDirectionalLight, addPointLight,
  getEnvIndex, envPresets, applyEnvPreset, setEnvIndex,
  getMixamoSourceFile, loadMixamoFromBuffer, clearMixamoModel,
} = {}) {
  document.getElementById('export-btn').addEventListener('click', async () => {
    try {
      const zip = new JSZip();

      // ── Objects ──
      const urlToFilename = {};
      for (const obj of importedObjects) {
        const url = obj.userData.url || '';
        if (url && !urlToFilename[url]) {
          urlToFilename[url] = obj.userData.displayName || url.split('/').pop() || 'model.glb';
        }
      }
      const fetchErrors = [];
      await Promise.all(Object.entries(urlToFilename).map(async ([url, filename]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          zip.file('objects/' + filename, await res.arrayBuffer());
        } catch (err) {
          fetchErrors.push(`${filename}: ${err.message}`);
        }
      }));
      const objects = importedObjects.map(obj => ({
        file:       urlToFilename[obj.userData.url || ''] ? 'objects/' + urlToFilename[obj.userData.url || ''] : '',
        name:       obj.userData.displayName || '',
        position:   obj.position.toArray(),
        quaternion: obj.quaternion.toArray(),
        scale:      obj.scale.toArray(),
      }));

      // ── User lights ──
      const lights = userLights.map(li => ({
        type:      li.type,
        color:     '#' + li.light.color.getHexString(),
        intensity: li.light.intensity,
        position:  li.light.position.toArray(),
      }));

      // ── Character ──
      let characterFile = '';
      const charFile = getMixamoSourceFile ? getMixamoSourceFile() : null;
      console.log('[Export] getMixamoSourceFile:', getMixamoSourceFile, '→', charFile?.name ?? 'null');
      if (charFile) {
        characterFile = 'character/' + charFile.name;
        const charBuf = await charFile.arrayBuffer();
        console.log('[Export] packing character:', characterFile, `(${(charBuf.byteLength / 1024).toFixed(1)} KB)`);
        zip.file(characterFile, charBuf);
      } else {
        console.log('[Export] no character file stored — skipping');
      }

      // ── Environment ──
      const environmentIndex = getEnvIndex ? getEnvIndex() : 0;

      zip.file('scene.json', JSON.stringify({ objects, lights, characterFile, environmentIndex }, null, 2));

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      downloadBlob(blob, 'scene.zip');

      const warn = fetchErrors.length ? ` (${fetchErrors.length} fetch error(s))` : '';
      const charNote = characterFile ? ', character included' : ', no character';
      addMessage(`Scene exported as scene.zip (${objects.length} objects, ${lights.length} lights${charNote})${warn}`, 'system');
      if (fetchErrors.length) console.warn('[Export] fetch errors:', fetchErrors);
    } catch (err) {
      addMessage('Export failed: ' + err.message, 'system');
    }
  });

  const sceneFileInput = document.getElementById('scene-file-input');
  document.getElementById('import-scene-btn').addEventListener('click', () => sceneFileInput.click());
  sceneFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'zip') {
      try {
        const zip = await JSZip.loadAsync(file);
        const jsonFile = zip.file('scene.json');
        if (!jsonFile) { addMessage('Invalid scene.zip — missing scene.json', 'system'); return; }

        let manifest;
        try { manifest = JSON.parse(await jsonFile.async('string')); }
        catch { addMessage('scene.json in zip is invalid JSON', 'system'); return; }

        // Support both old format (array) and new format (object with objects/lights/etc.)
        const objects         = Array.isArray(manifest) ? manifest : (manifest.objects || []);
        const lights          = Array.isArray(manifest) ? [] : (manifest.lights || []);
        const characterFile   = Array.isArray(manifest) ? '' : (manifest.characterFile || '');
        const environmentIndex = Array.isArray(manifest) ? null : (manifest.environmentIndex ?? null);

        // ── Clear existing scene ──
        document.dispatchEvent(new CustomEvent('deselect-all'));
        for (const obj of [...importedObjects]) {
          obj.removeFromParent();
        }
        importedObjects.length = 0;
        for (const li of [...userLights]) {
          scene.remove(li.light);
          if (li.helper) scene.remove(li.helper);
          scene.remove(li.handle);
          if (li.light.target) scene.remove(li.light.target);
        }
        userLights.length = 0;
        refreshAssetPanel();

        // ── Environment ──
        if (environmentIndex !== null && envPresets && envPresets[environmentIndex]) {
          setEnvIndex && setEnvIndex(environmentIndex);
          applyEnvPreset && applyEnvPreset(envPresets[environmentIndex]);
          document.getElementById('env-btn').textContent = '\ud83c\udf05 ' + envPresets[environmentIndex].name;
        }

        // ── Character ──
        if (characterFile && loadMixamoFromBuffer && clearMixamoModel) {
          const charEntry = zip.file(characterFile);
          if (charEntry) {
            const buf = await charEntry.async('arraybuffer');
            const name = characterFile.split('/').pop();
            clearMixamoModel();
            loadMixamoFromBuffer(buf, name,
              () => {
                document.getElementById('character-reset-btn').style.display = '';
                addMessage('Character loaded: ' + name, 'system');
              },
              (err) => addMessage('Failed to load character: ' + (err.message || 'unknown'), 'system')
            );
          }
        }

        // ── Objects ──
        const grouped = !Array.isArray(manifest) && manifest.grouped === true;

        // ── Lights — only add to scene as standalone lights for non-grouped loads ──
        if (!grouped) {
          for (const li of lights) {
            const opts = { color: li.color, intensity: li.intensity, position: li.position };
            if (li.type === 'directional' && addDirectionalLight) addDirectionalLight(opts);
            else if (li.type === 'point' && addPointLight)        addPointLight(opts);
          }
        }
        const fileURLs = {};
        for (const entry of objects) {
          if (!entry.file || fileURLs[entry.file]) continue;
          const zipEntry = zip.file(entry.file);
          if (!zipEntry) { console.warn(`[Import] missing file in zip: ${entry.file}`); continue; }
          const buf = await zipEntry.async('arraybuffer');
          fileURLs[entry.file] = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
        }

        if (grouped && objects.length > 0) {
          // Load all objects + lights under one group so the gizmo moves everything together
          const groupRoot = new THREE.Group();
          groupRoot.name = 'GroupedExport';
          const id = genId();
          groupRoot.userData.id = id;
          groupRoot.userData.displayName = file.name.replace(/\.[^.]+$/, '');
          userContentGroup.add(groupRoot);
          importedObjects.push(groupRoot);

          let loaded = 0;
          for (const entry of objects) {
            const objUrl = fileURLs[entry.file];
            if (!objUrl) continue;
            await new Promise((resolve) => {
              gltfLoader.load(objUrl, (gltf) => {
                const model = gltf.scene;
                if (!model) { resolve(); return; }
                model.position.fromArray(entry.position);
                model.quaternion.fromArray(entry.quaternion);
                model.scale.fromArray(entry.scale);
                model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
                groupRoot.add(model);
                loaded++;
                resolve();
              }, undefined, resolve);
            });
          }

          // Add lights as children of the group so they move with it
          for (const li of lights) {
            let light;
            if (li.type === 'directional') {
              light = new THREE.DirectionalLight(new THREE.Color(li.color), li.intensity);
            } else {
              light = new THREE.PointLight(new THREE.Color(li.color), li.intensity, 15);
            }
            light.position.fromArray(li.position);
            groupRoot.add(light);
            if (li.type === 'directional') groupRoot.add(light.target);
          }

          document.dispatchEvent(new CustomEvent('select-object', { detail: groupRoot }));
          refreshAssetPanel();
          addMessage(`Loaded from ${file.name}: ${loaded} object(s) + ${lights.length} light(s) as one group`, 'system');
        } else {
          let loaded = 0;
          for (const entry of objects) {
            const objUrl = fileURLs[entry.file];
            if (!objUrl) { addMessage(`Skipped "${entry.name || entry.file}" — file not found in zip`, 'system'); continue; }
            loadGLB(objUrl, entry.name, {
              position:   entry.position,
              quaternion: entry.quaternion,
              scale:      entry.scale,
            });
            loaded++;
          }
          addMessage(`Loaded from ${file.name}: ${loaded} object(s), ${lights.length} light(s)${characterFile ? ', character' : ''}`, 'system');
        }
      } catch (err) {
        addMessage('Failed to load zip: ' + err.message, 'system');
      }
      return;
    }

    // Legacy: .glb scene import — split top-level nodes into individual objects
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
      refreshAssetPanel();
      addMessage('Scene loaded from ' + file.name, 'system');
    });
  });
}
