# Design: Enhanced 3D Import with Primitives

**Date:** 2026-03-30
**Status:** Approved

## Context

The current 3D import functionality only supports uploading custom `.glb` files. Users cannot quickly add basic geometric shapes without finding and importing external 3D models. This creates friction for prototyping and building simple scenes.

## Goal

Provide users with quick access to common 3D primitives (cube, sphere, cylinder, cone, torus) alongside the existing file upload functionality, accessible through a modal dialog with tabs.

## Design

### UI Structure

Replace the current direct file input trigger with a modal dialog:

```
┌─────────────────────────────────────────┐
│  Add 3D Object                          │
│  ─────────────────────────────────────  │
│  [Primitives] [Upload]                  │
│  ─────────────────────────────────────  │
│                                         │
│  Primitives Tab:                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│
│  │ 🧊  │ │ ⚽  │ │ 🥫  │ │ 🔺  │ │ 🍩  ││
│  │Cube │ │Sphere│ │Cylnd│ │Cone │ │Torus││
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘│
│                                         │
│  Color: [████████] #ffffff             │
│                                         │
│  [Cancel]                    [Add]      │
└─────────────────────────────────────────┘
```

**Primitives Tab:**
- Five clickable shape icons in a row
- Color picker (HTML5 `<input type="color">`) with default white
- "Add" button creates selected primitive with chosen color

**Upload Tab:**
- Same file upload flow as current implementation
- Accept `.glb` and `.gltf` files
- Server upload via `POST /api/upload`

### Technical Implementation

**Files to modify:**
- `index.html`

**HTML Changes (lines ~196-249 area):**

1. Add modal container after toolbar:
```html
<div id="import-modal" class="modal hidden">
  <div class="modal-content">
    <h3>Add 3D Object</h3>
    <div class="tabs">
      <button class="tab active" data-tab="primitives">Primitives</button>
      <button class="tab" data-tab="upload">Upload</button>
    </div>
    <div id="primitives-tab" class="tab-content">
      <div class="primitive-grid">
        <button class="primitive-btn" data-shape="cube">
          <span class="icon">🧊</span>
          <span class="label">Cube</span>
        </button>
        <!-- ... sphere, cylinder, cone, torus ... -->
      </div>
      <div class="color-picker">
        <label>Color:</label>
        <input type="color" id="primitive-color" value="#ffffff">
      </div>
    </div>
    <div id="upload-tab" class="tab-content hidden">
      <div class="upload-area">
        <p>Drag & drop or click to upload</p>
        <input type="file" id="modal-file-input" accept=".glb,.gltf">
      </div>
    </div>
    <div class="modal-actions">
      <button id="modal-cancel">Cancel</button>
      <button id="modal-add" class="primary">Add</button>
    </div>
  </div>
</div>
```

2. Update "Import 3D" button to open modal instead of triggering file input directly

**CSS Changes:**
- Modal overlay and content styling (~30 lines)
- Tab styling (~10 lines)
- Primitive grid layout (~15 lines)

**JavaScript Changes:**

1. Add `createPrimitive(type, color)` function:
```javascript
function createPrimitive(type, color) {
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
  }

  const material = new THREE.MeshStandardMaterial({ color: color });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.name = type.charAt(0).toUpperCase() + type.slice(1);

  // Position at spawn location (same as imported models)
  mesh.position.set(1.2, 0, 0);

  userContentGroup.add(mesh);
  importedObjects.push(mesh);

  // Select and broadcast
  selectObject(mesh);
  broadcastSceneUpdate();

  return mesh;
}
```

2. Add modal interaction handlers:
```javascript
let selectedPrimitive = null;

// Open modal
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-modal').classList.remove('hidden');
  selectedPrimitive = 'cube'; // default selection
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // switch active tab and content
  });
});

// Primitive selection
document.querySelectorAll('.primitive-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedPrimitive = btn.dataset.shape;
    // highlight selection
  });
});

// Add button
document.getElementById('modal-add').addEventListener('click', () => {
  if (selectedPrimitive) {
    const color = document.getElementById('primitive-color').value;
    createPrimitive(selectedPrimitive, color);
    document.getElementById('import-modal').classList.add('hidden');
  }
});

// Cancel button
document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('import-modal').classList.add('hidden');
});
```

3. Handle file upload from modal (reuse existing upload logic)

**Geometry Specifications:**

| Primitive | Geometry | Dimensions |
|-----------|----------|------------|
| Cube | `BoxGeometry(1, 1, 1)` | 1×1×1 units |
| Sphere | `SphereGeometry(0.5, 32, 32)` | radius 0.5, 32 segments |
| Cylinder | `CylinderGeometry(0.5, 0.5, 1, 32)` | radius 0.5, height 1 |
| Cone | `ConeGeometry(0.5, 1, 32)` | radius 0.5, height 1 |
| Torus | `TorusGeometry(0.4, 0.15, 16, 100)` | radius 0.4, tube 0.15 |

### Multiplayer Sync

Primitives are added to `userContentGroup` and broadcast via `broadcastSceneUpdate()` just like uploaded models. No special handling needed.

### Asset Panel Integration

Primitives appear in the Asset Panel under "Objects" section with their name (e.g., "Cube", "Sphere"). Users can select, transform, clone, and delete them like any imported model.

### No Backend Changes

All primitive creation happens client-side using Three.js built-in geometries. The server remains unchanged.

## Verification Plan

1. **Basic functionality:**
   - Click "Import 3D" → modal opens
   - Primitives tab is active by default
   - All 5 shapes are visible and clickable

2. **Primitive creation:**
   - Click "Sphere", accept default white color
   - Click "Add" → white sphere appears at spawn position
   - Sphere is selected with TransformControls attached
   - Sphere appears in Asset Panel

3. **Color selection:**
   - Click "Cube", change color to blue (#0000ff)
   - Click "Add" → blue cube appears

4. **Upload tab:**
   - Switch to "Upload" tab
   - Upload a `.glb` file → works as before
   - Model appears in scene

5. **Multiplayer:**
   - Open second browser tab/viewer
   - Add primitive in editor → viewer sees it appear
   - Transform primitive → viewer sees transform

6. **Cancel:**
   - Open modal, select shape
   - Click "Cancel" → modal closes, nothing added
