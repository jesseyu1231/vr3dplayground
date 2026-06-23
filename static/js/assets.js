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

// ── Image (JPG/PNG) import support ──
const textureLoader = new THREE.TextureLoader();
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);
export function isImageExt(ext) { return IMAGE_EXTS.has(String(ext || '').toLowerCase()); }

// Map each unique object URL → a unique path inside an export zip. De-dupes by URL (the
// same file is stored once) and disambiguates colliding display names (e.g. two distinct
// "image.jpg" uploads) by suffixing -2, -3, … so no file is silently overwritten/lost.
export function buildZipFileMap(objs) {
  const urlToFile = {};
  const used = new Set();
  for (const obj of objs) {
    const url = obj.userData.url || '';
    if (!url || urlToFile[url]) continue;
    let base = obj.userData.displayName || url.split('/').pop() || (obj.userData.isImage ? 'image.jpg' : 'model.glb');
    if (used.has(base)) {
      const dot  = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext  = dot > 0 ? base.slice(dot) : '';
      let i = 2;
      while (used.has(`${stem}-${i}${ext}`)) i++;
      base = `${stem}-${i}${ext}`;
    }
    used.add(base);
    urlToFile[url] = 'objects/' + base;
  }
  return urlToFile;
}

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

// ── Import a JPG/PNG as an upright image plane (original aspect, ratio-locked) ──
// Creates a flat vertical quad textured with the picture. The plane keeps the image's
// native aspect ratio (longest side normalised to ~2 m: portraits stay tall, landscapes
// stay wide) and is tagged userData.lockAspect so resizing always preserves that ratio
// (see controls.js). MeshBasicMaterial + toneMapped:false shows the art true-to-source
// and always legible regardless of where it's placed; double-sided so it reads from behind.
// Build the textured upright plane mesh — shared by direct import and grouped scene load.
// PlaneGeometry sits in the XY plane facing +Z, so it's already upright. Keeps the image's
// native aspect (longest side ~2 m) and is tagged lockAspect so resizing preserves the ratio.
function makeImagePlaneMesh(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const iw = texture.image?.width  || 1;
  const ih = texture.image?.height || 1;
  const aspect = iw / ih;
  const TARGET = 2.0;                                  // longest side, metres
  const w = aspect >= 1 ? TARGET : TARGET * aspect;
  const h = aspect >= 1 ? TARGET / aspect : TARGET;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false })
  );
  mesh.castShadow = true;
  mesh.userData.isImage = true;
  mesh.userData.lockAspect = true;   // transform keeps the picture's ratio (no Shift needed)
  return mesh;
}

export function createImagePlane(url, filename, opts = {}) {
  textureLoader.load(url, (texture) => {
    const mesh = makeImagePlaneMesh(texture);
    const id = opts.id || genId();
    mesh.userData.id = id;
    mesh.userData.url = url;
    mesh.userData.displayName = filename || url.split('/').pop() || 'Image';

    if (opts.position && opts.quaternion && opts.scale) {
      mesh.position.fromArray(opts.position);
      mesh.quaternion.fromArray(opts.quaternion);
      mesh.scale.fromArray(opts.scale);
    } else {
      mesh.position.set(1.2, 1.5, 0);   // eye-level, like a hung picture
    }

    userContentGroup.add(mesh);
    importedObjects.push(mesh);

    if (!opts.remote) {
      pushUndo({ type: 'object_add', obj: mesh });
      document.dispatchEvent(new CustomEvent('select-object', { detail: mesh }));
      wsSend({ type: 'object_add', object: {
        id, url, image: true, name: mesh.userData.displayName,
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
      }});
    }
    refreshAssetPanel();
  },
  undefined,
  (err) => {
    console.error('TextureLoader error:', err);
    addMessage('Failed to load image: ' + (err?.message || 'unknown error'), 'system');
  });
}

// Upload an image file to the server (so the URL works cross-device, incl. Quest), then
// place it. Mirrors the .glb upload path used by the modal/legacy file inputs.
async function importImageFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok) createImagePlane(data.url, data.name);
    else addMessage(data.error || 'Image upload failed', 'system');
  } catch (err) {
    addMessage('Image upload error: ' + err.message, 'system');
  }
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
  const modalImageInput = document.getElementById('modal-image-input');
  const modalImageArea = document.getElementById('modal-image-area');
  const modalCancel = document.getElementById('modal-cancel');
  const modalAdd = document.getElementById('modal-add');
  const allTabPanels = document.querySelectorAll('#import-modal .tab-panel');

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
    allTabPanels.forEach(p => p.classList.add('hidden'));
    tabPrimitives.classList.remove('hidden');
  });

  modalCancel.addEventListener('click', () => importModal.classList.add('hidden'));
  importModal.addEventListener('click', (e) => { if (e.target === importModal) importModal.classList.add('hidden'); });

  // Tab switching — show the panel whose id is `tab-<data-tab>`, hide the rest.
  modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modalTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      allTabPanels.forEach(p => p.classList.add('hidden'));
      const panel = document.getElementById('tab-' + tab.dataset.tab);
      if (panel) panel.classList.remove('hidden');
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

  // Image tab — pick a JPG/PNG, import immediately as an upright ratio-locked plane.
  modalImageArea.addEventListener('click', () => modalImageInput.click());
  modalImageInput.addEventListener('change', async () => {
    const file = modalImageInput.files[0];
    if (!file) return;
    modalImageInput.value = '';
    importModal.classList.add('hidden');
    await importImageFile(file);
  });

  // Upload area
  modalUploadArea.addEventListener('click', () => modalFileInput.click());
  modalFileInput.addEventListener('change', async () => {
    const file = modalFileInput.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    // An image dropped in the 3D-upload tab still works — route it to the image path.
    if (isImageExt(ext)) {
      modalFileInput.value = '';
      importModal.classList.add('hidden');
      await importImageFile(file);
      return;
    }

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

    if (isImageExt(ext)) { fileInput.value = ''; await importImageFile(file); return; }

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
    image: selectedObject.userData.isImage || undefined,
    name: selectedObject.userData.isImage ? selectedObject.userData.displayName : undefined,
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

async function uploadBufferToServer(buffer, filename) {
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'model/gltf-binary' }), filename);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Upload failed');
  }
  return data.url;
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
      const urlToFile = buildZipFileMap(importedObjects);
      const fetchErrors = [];
      await Promise.all(Object.entries(urlToFile).map(async ([url, zipPath]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          zip.file(zipPath, await res.arrayBuffer());
        } catch (err) {
          fetchErrors.push(`${zipPath}: ${err.message}`);
        }
      }));
      const objects = importedObjects.map(obj => ({
        file:       urlToFile[obj.userData.url || ''] || '',
        name:       obj.userData.displayName || '',
        image:      obj.userData.isImage || undefined,   // dropped from JSON when not an image
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
        const nextEnvIndex = environmentIndex !== null ? environmentIndex : (getEnvIndex ? getEnvIndex() : 0);

        wsSend({ type: 'scene_reset', envIndex: nextEnvIndex });

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
        if (envPresets && envPresets[nextEnvIndex]) {
          setEnvIndex && setEnvIndex(nextEnvIndex);
          applyEnvPreset && applyEnvPreset(envPresets[nextEnvIndex]);
          document.getElementById('env-btn').textContent = '\u2600 ' + envPresets[nextEnvIndex].name;
        }

        // ── Character ──
        if (characterFile && loadMixamoFromBuffer && clearMixamoModel) {
          const charEntry = zip.file(characterFile);
          if (charEntry) {
            const buf = await charEntry.async('arraybuffer');
            const name = characterFile.split('/').pop();
            clearMixamoModel();
            loadMixamoFromBuffer(buf, name,
              async () => {
                document.getElementById('character-reset-btn').style.display = '';
                addMessage('Character loaded: ' + name, 'system');
                try {
                  const uploadedUrl = await uploadBufferToServer(buf, name);
                  wsSend({ type: 'character_set', character: { url: uploadedUrl, name } });
                } catch (err) {
                  addMessage('Character sync failed: ' + (err.message || 'upload error'), 'system');
                }
              },
              (err) => addMessage('Failed to load character: ' + (err.message || 'unknown'), 'system')
            );
          }
        } else if (clearMixamoModel) {
          clearMixamoModel();
          document.getElementById('character-reset-btn').style.display = 'none';
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
          // Upload to server so the URL is a real path accessible from any device (e.g. Quest headset)
          const originalName = entry.file.split('/').pop();
          try {
            const formData = new FormData();
            formData.append('file', new Blob([buf], { type: 'model/gltf-binary' }), originalName);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            if (res.ok) {
              const data = await res.json();
              fileURLs[entry.file] = data.url;
            } else {
              // Fallback to blob URL if upload fails (won't work cross-device but at least loads locally)
              fileURLs[entry.file] = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
            }
          } catch {
            fileURLs[entry.file] = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
          }
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
            const isImg = entry.image || isImageExt((entry.file || entry.name || '').split('.').pop());
            await new Promise((resolve) => {
              if (isImg) {
                textureLoader.load(objUrl, (texture) => {
                  const mesh = makeImagePlaneMesh(texture);
                  mesh.position.fromArray(entry.position);
                  mesh.quaternion.fromArray(entry.quaternion);
                  mesh.scale.fromArray(entry.scale);
                  const modelId = genId();
                  mesh.userData.id = modelId;
                  mesh.userData.url = objUrl;
                  mesh.userData.displayName = entry.name || 'Image';
                  groupRoot.add(mesh);
                  loaded++;
                  wsSend({ type: 'object_add', object: {
                    id: modelId, url: objUrl, image: true, name: entry.name,
                    position: entry.position, quaternion: entry.quaternion, scale: entry.scale,
                  }});
                  resolve();
                }, undefined, resolve);
                return;
              }
              gltfLoader.load(objUrl, (gltf) => {
                const model = gltf.scene;
                if (!model) { resolve(); return; }
                model.position.fromArray(entry.position);
                model.quaternion.fromArray(entry.quaternion);
                model.scale.fromArray(entry.scale);
                model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
                groupRoot.add(model);
                loaded++;
                // Broadcast each model individually so remote viewers (e.g. Quest) can load them
                const modelId = genId();
                model.userData.id = modelId;
                model.userData.url = objUrl;
                wsSend({ type: 'object_add', object: {
                  id: modelId, url: objUrl,
                  position: entry.position,
                  quaternion: entry.quaternion,
                  scale: entry.scale,
                }});
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

          // Also broadcast lights so remote viewers see them
          for (const li of lights) {
            const opts = { color: li.color, intensity: li.intensity, position: li.position };
            if (li.type === 'directional' && addDirectionalLight) addDirectionalLight({ ...opts, remote: false });
            else if (li.type === 'point' && addPointLight) addPointLight({ ...opts, remote: false });
          }

          document.dispatchEvent(new CustomEvent('select-object', { detail: groupRoot }));
          refreshAssetPanel();
          addMessage(`Loaded from ${file.name}: ${loaded} object(s) + ${lights.length} light(s) as one group`, 'system');
        } else {
          let loaded = 0;
          for (const entry of objects) {
            const objUrl = fileURLs[entry.file];
            if (!objUrl) { addMessage(`Skipped "${entry.name || entry.file}" — file not found in zip`, 'system'); continue; }
            const place = { position: entry.position, quaternion: entry.quaternion, scale: entry.scale };
            // Detect images by the flag OR the file extension, so zips saved before the
            // image flag existed still restore as pictures instead of failing as glTF.
            if (entry.image || isImageExt((entry.file || entry.name || '').split('.').pop())) {
              createImagePlane(objUrl, entry.name, place);
            } else {
              loadGLB(objUrl, entry.name, place);
            }
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
