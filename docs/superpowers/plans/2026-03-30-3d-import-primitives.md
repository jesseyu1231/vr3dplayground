# Enhanced 3D Import with Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal dialog with primitive shapes (cube, sphere, cylinder, cone, torus) alongside the existing file upload functionality for 3D import.

**Architecture:** Single-page modification to `index.html` - add modal HTML, CSS styling, and JavaScript handlers. Primitives are created client-side using Three.js built-in geometries, following existing patterns for imported objects.

**Tech Stack:** Three.js geometries, vanilla JavaScript, HTML5 color picker

---

## Task 1: Add Modal HTML Structure

**Files:**

- Modify: `index.html` (after line 249, before the VR overlay section)

- [ ] **Step 1: Add the import modal HTML structure**

Insert after line 249 (after `<input type="file" id="file-input" accept=".glb,.gltf" />`):

```html
<!-- Import Modal -->
<div id="import-modal" class="modal hidden">
  <div class="modal-content">
    <h3>📦 Add 3D Object</h3>
    <div class="modal-tabs">
      <button class="modal-tab active" data-tab="primitives">Primitives</button>
      <button class="modal-tab" data-tab="upload">Upload</button>
    </div>

    <div id="tab-primitives" class="tab-panel">
      <div class="primitive-grid">
        <button class="primitive-btn selected" data-shape="cube">
          <span class="primitive-icon">🧊</span>
          <span class="primitive-label">Cube</span>
        </button>
        <button class="primitive-btn" data-shape="sphere">
          <span class="primitive-icon">⚽</span>
          <span class="primitive-label">Sphere</span>
        </button>
        <button class="primitive-btn" data-shape="cylinder">
          <span class="primitive-icon">🥫</span>
          <span class="primitive-label">Cylinder</span>
        </button>
        <button class="primitive-btn" data-shape="cone">
          <span class="primitive-icon">🔺</span>
          <span class="primitive-label">Cone</span>
        </button>
        <button class="primitive-btn" data-shape="torus">
          <span class="primitive-icon">🍩</span>
          <span class="primitive-label">Torus</span>
        </button>
      </div>
      <div class="color-row">
        <label>Color:</label>
        <input type="color" id="primitive-color" value="#ffffff">
      </div>
    </div>

    <div id="tab-upload" class="tab-panel hidden">
      <div class="upload-area" id="modal-upload-area">
        <p>Drag & drop or click to upload</p>
        <p class="upload-hint">.glb files supported</p>
      </div>
      <input type="file" id="modal-file-input" accept=".glb,.gltf" hidden>
    </div>

    <div class="modal-actions">
      <button class="modal-btn cancel" id="modal-cancel">Cancel</button>
      <button class="modal-btn primary" id="modal-add">Add</button>
    </div>
  </div>
</div>
```

---

## Task 2: Add Modal CSS Styles

**Files:**

- Modify: `index.html` (CSS section, after line 180)

- [ ] **Step 1: Add modal CSS styles**

Insert after line 180 (after `.ap-empty { ... }`):

```css
/* Import Modal */
.modal {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.modal.hidden { display: none; }
.modal-content {
  background: rgba(15,15,25,0.95); backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
  padding: 20px; width: 340px; color: #e0e0e0;
}
.modal-content h3 {
  margin: 0 0 14px; font-size: 16px; font-weight: 600;
}
.modal-tabs {
  display: flex; gap: 4px; margin-bottom: 14px;
}
.modal-tab {
  flex: 1; padding: 8px 12px; border: none; border-radius: 8px;
  background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .2s, color .2s;
}
.modal-tab:hover { background: rgba(255,255,255,0.12); }
.modal-tab.active { background: rgba(74,124,255,0.5); color: #fff; }
.tab-panel { min-height: 120px; }
.tab-panel.hidden { display: none; }
.primitive-grid {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 8px; margin-bottom: 14px;
}
.primitive-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px; border: 2px solid rgba(255,255,255,0.12);
  border-radius: 10px; background: rgba(255,255,255,0.05);
  color: #e0e0e0; cursor: pointer; transition: border-color .2s, background .2s;
}
.primitive-btn:hover { background: rgba(255,255,255,0.1); }
.primitive-btn.selected { border-color: #4a7cff; background: rgba(74,124,255,0.2); }
.primitive-icon { font-size: 22px; }
.primitive-label { font-size: 10px; font-weight: 600; }
.color-row { display: flex; align-items: center; gap: 10px; }
.color-row label { font-size: 12px; color: rgba(255,255,255,0.7); }
.color-row input[type="color"] {
  width: 50px; height: 30px; border: none; border-radius: 6px;
  cursor: pointer; background: none;
}
.upload-area {
  border: 2px dashed rgba(255,255,255,0.2); border-radius: 10px;
  padding: 24px 16px; text-align: center; cursor: pointer;
  transition: border-color .2s, background .2s;
}
.upload-area:hover { border-color: rgba(74,124,255,0.5); background: rgba(74,124,255,0.1); }
.upload-area p { margin: 0; font-size: 13px; color: rgba(255,255,255,0.7); }
.upload-hint { font-size: 11px !important; color: rgba(255,255,255,0.4) !important; margin-top: 4px !important; }
.modal-actions {
  display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;
}
.modal-btn {
  padding: 8px 18px; border-radius: 8px; border: none;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity .2s;
}
.modal-btn.cancel {
  background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7);
}
.modal-btn.cancel:hover { background: rgba(255,255,255,0.15); }
.modal-btn.primary {
  background: linear-gradient(135deg,#4a7cff,#6a4cff); color: #fff;
}
.modal-btn.primary:hover { opacity: 0.85; }
```

---

## Task 3: Add Modal JavaScript - Variables and open/close

**Files:**

- Modify: `index.html` (JavaScript section, after line 1148)

- [ ] **Step 1: Add modal state variables and open/close handlers**

Insert after line 1148 (after the file input handler closes):

```javascript
// ══════════════════════════════════════
// Import Modal (Primitives + Upload)
// ══════════════════════════════════════
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

// Open modal when clicking Import 3D button
document.getElementById('import-btn').addEventListener('click', () => {
  importModal.classList.remove('hidden');
  selectedPrimitive = 'cube';
  // Reset selection UI
  primitiveBtns.forEach(btn => btn.classList.remove('selected'));
  primitiveBtns[0].classList.add('selected');
  primitiveColor.value = '#ffffff';
});

// Close modal
modalCancel.addEventListener('click', () => {
  importModal.classList.add('hidden');
});

// Close on backdrop click
importModal.addEventListener('click', (e) => {
  if (e.target === importModal) {
    importModal.classList.add('hidden');
  }
});
```

---

## Task 4: Add Tab Switching Logic

**Files:**

- Modify: `index.html` (JavaScript section, after Task 3 code)

- [ ] **Step 1: Add tab switching functionality**

Insert after the modal close handlers:

```javascript
// Tab switching
modalTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    modalTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const tabName = tab.dataset.tab;
    if (tabName === 'primitives') {
      tabPrimitives.classList.remove('hidden');
      tabUpload.classList.add('hidden');
    } else {
      tabPrimitives.classList.add('hidden');
      tabUpload.classList.remove('hidden');
    }
  });
});
```

---

## Task 5: Add Primitive Selection Logic

**Files:**

- Modify: `index.html` (JavaScript section, after Task 4 code)

- [ ] **Step 1: Add primitive button selection**

Insert after the tab switching code:

```javascript
// Primitive selection
primitiveBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    primitiveBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedPrimitive = btn.dataset.shape;
  });
});
```

---

## Task 6: Implement createPrimitive Function

**Files:**

- Modify: `index.html` (JavaScript section, after Task 5 code)

- [ ] **Step 1: Add the createPrimitive function**

Insert after the primitive selection code:

```javascript
function createPrimitive(type, colorHex) {
  let geometry;
  switch(type) {
    case 'cube':
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, 32, 32);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
      break;
    case 'cone':
      geometry = new THREE.ConeGeometry(0.5, 1, 32);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(0.4, 0.15, 16, 100);
      break;
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
  }

  const material = new THREE.MeshStandardMaterial({ color: colorHex });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const id = genId();
  mesh.userData.id = id;
  mesh.userData.displayName = type.charAt(0).toUpperCase() + type.slice(1);
  mesh.userData.isPrimitive = true;
  mesh.userData.primitiveType = type;

  // Position at spawn location (same as imported models)
  mesh.position.set(1.2, 0.5, 0);

  userContentGroup.add(mesh);
  importedObjects.push(mesh);

  pushUndo({ type: 'object_add', obj: mesh });

  selectObject(mesh);

  wsSend({ type: 'object_add', object: {
    id,
    url: '',
    primitive: type,
    color: colorHex,
    position: mesh.position.toArray(),
    quaternion: mesh.quaternion.toArray(),
    scale: mesh.scale.toArray(),
  }});

  refreshAssetPanel();

  return mesh;
}
```

---

## Task 7: Add Modal Add Button Handler

**Files:**

- Modify: `index.html` (JavaScript section, after Task 6 code)

- [ ] **Step 1: Add the Add button click handler**

Insert after the createPrimitive function:

```javascript
// Add button - create selected primitive
modalAdd.addEventListener('click', () => {
  const activeTab = document.querySelector('.modal-tab.active').dataset.tab;

  if (activeTab === 'primitives') {
    const color = primitiveColor.value;
    createPrimitive(selectedPrimitive, color);
    importModal.classList.add('hidden');
  }
  // Upload tab handles via file input change event
});
```

---

## Task 8: Add Upload Tab File Handling

**Files:**

- Modify: `index.html` (JavaScript section, after Task 7 code)

- [ ] **Step 1: Add upload area click and file handling**

Insert after the modal Add button handler:

```javascript
// Upload area click triggers file input
modalUploadArea.addEventListener('click', () => {
  modalFileInput.click();
});

// Handle file selection from modal
modalFileInput.addEventListener('change', async () => {
  const file = modalFileInput.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'gltf') {
    const url = URL.createObjectURL(file);
    gltfLoader.load(url, (gltf) => {
      const model = gltf.scene;
      if (!model) {
        addMessage('Import failed: no scene in file', 'system');
        URL.revokeObjectURL(url);
        return;
      }
      const id = genId();
      model.userData.id = id;
      model.userData.url = '';
      model.userData.displayName = file.name;
      normalizeAndPlace(model, new THREE.Vector3(1.2, 0, 0));
      userContentGroup.add(model);
      importedObjects.push(model);
      pushUndo({ type: 'object_add', obj: model });
      selectObject(model);
      wsSend({ type: 'object_add', object: {
        id, url: '', position: model.position.toArray(),
        quaternion: model.quaternion.toArray(), scale: model.scale.toArray(),
      }});
      refreshAssetPanel();
      addMessage('Loaded ' + file.name + ' (local .gltf)', 'system');
      URL.revokeObjectURL(url);
    }, undefined, (err) => {
      URL.revokeObjectURL(url);
      addMessage('Failed to load .gltf file', 'system');
    });
    modalFileInput.value = '';
    importModal.classList.add('hidden');
    return;
  }

  // .glb - upload to server
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok) {
      loadGLB(data.url, data.name);
      importModal.classList.add('hidden');
    } else {
      addMessage(data.error || 'Upload failed', 'system');
    }
  } catch (err) {
    addMessage('Upload error: ' + err.message, 'system');
  }
  modalFileInput.value = '';
});
```

---

## Task 9: Handle Remote Primitive Sync

**Files:**

- Modify: `index.html` (WebSocket message handler section)

- [ ] **Step 1: Find and update the WebSocket message handler for object_add**

Find the WebSocket `onmessage` handler that processes `object_add` messages. Add primitive handling after the existing `loadGLB` call. Look for code similar to:

```javascript
if (msg.type === 'object_add') {
  // existing code that calls loadGLB
}
```

Add this condition to handle primitives:

```javascript
if (msg.object.primitive) {
  // Remote primitive - recreate locally
  const mesh = createPrimitive(msg.object.primitive, msg.object.color || '#ffffff');
  mesh.userData.id = msg.object.id;
  mesh.position.fromArray(msg.object.position);
  mesh.quaternion.fromArray(msg.object.quaternion);
  mesh.scale.fromArray(msg.object.scale);
} else if (msg.object.url) {
  loadGLB(msg.object.url, '', { ...msg.object, remote: true });
}
```

Note: If the existing code already handles this differently, adapt accordingly.

---

## Task 10: Test and Commit

**Files:**

- All modified files

- [ ] **Step 1: Manual testing checklist**

Test the following scenarios:

1. Click "Import 3D" button → modal opens
2. Primitives tab is active by default
3. All 5 shapes visible and selectable
4. Select "Sphere", change color to blue, click "Add" → blue sphere appears
5. Open modal again, switch to "Upload" tab
6. Upload a .glb file → model loads correctly
7. Modal closes after adding
8. Cancel button closes modal without adding
9. Click backdrop closes modal
10. Primitives appear in Asset Panel
11. Transform, clone, delete work on primitives
12. Open second browser, verify multiplayer sync

- [ ] **Step 2: Commit changes**

```bash
git add index.html
git commit -m "feat: add primitive shapes to 3D import modal

- Add modal dialog with Primitives and Upload tabs
- Support cube, sphere, cylinder, cone, torus primitives
- Color picker for primitive materials
- Preserve existing .glb upload functionality
- Multiplayer sync for primitives"
```
