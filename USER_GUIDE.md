# 3D AI Environment — User Guide

---

## Interface Overview

When the app opens you will see:

- A **3D viewport** filling the screen — this is your scene
- A **toolbar** across the top with all main actions
- A **transform bar** (Move / Rotate / Scale) below the toolbar on the left
- A **shortcuts hint** bar at the bottom of the screen
- A **chat panel** in the bottom-right corner

---

## Navigating the Scene

Use your mouse to move around the 3D viewport at any time — no button needs to be active.

| Action | How |
|---|---|
| **Orbit** (rotate view) | Click and drag with the left mouse button |
| **Pan** (slide view) | Click and drag with the right mouse button |
| **Zoom** | Scroll the mouse wheel |

The camera always orbits around the centre of the scene. Zoom in close to an object before making fine adjustments.

---

## Importing 3D Models

### 📦 Import 3D

Click **Import 3D** in the toolbar to bring a 3D model into your scene.

- Supported formats: **.glb** and **.gltf**
- The model will appear in the scene automatically, scaled and placed near the centre
- You can import as many models as you like — each one is added as a separate object

> **Tip:** GLB is the preferred format. It is a single self-contained file. GLTF files may reference external textures so they are loaded locally and will not be saved into the scene file.

---

## Selecting Objects

Click on any object in the viewport to select it. A **transform gizmo** will appear around it.

To deselect, click on an empty area of the scene.

You can also select objects from the **Assets panel** (see below).

---

## Transforming Objects

Once an object is selected, use the **Move / Rotate / Scale** buttons to switch between transform modes. You can also use keyboard shortcuts.

### Move (T)

Switches to the **translation gizmo** — three coloured arrows appear on the selected object.

- Drag the **red arrow** to move along the X axis (left / right)
- Drag the **green arrow** to move along the Y axis (up / down)
- Drag the **blue arrow** to move along the Z axis (forward / back)
- Drag the **coloured squares** between arrows to move along two axes at once

### Rotate (R)

Switches to the **rotation gizmo** — three coloured rings appear around the object.

- Drag the **red ring** to rotate around the X axis (tilt forward / back)
- Drag the **green ring** to rotate around the Y axis (spin left / right)
- Drag the **blue ring** to rotate around the Z axis (roll)

### Scale (S)

Switches to the **scale gizmo** — three coloured handles appear on the object.

- Drag any coloured handle to stretch or shrink along that axis
- Drag the **white centre cube** to scale uniformly in all directions

### Keyboard Shortcuts

| Key | Action |
|---|---|
| **T** | Switch to Move |
| **R** | Switch to Rotate |
| **S** | Switch to Scale |
| **Delete** or **Backspace** | Delete selected object |
| **D** | Clone (duplicate) selected object |
| **G** | Toggle snap to grid on/off |
| **⌘Z** | Undo |
| **⇧⌘Z** | Redo |

---

## Snap to Grid — 📐 Snap

Click **Snap** in the toolbar (or press **G**) to toggle grid snapping on or off. The button will highlight when snap is active.

When snap is on:
- Objects move in **0.5 unit steps** instead of freely
- Rotation snaps to **15° increments**
- Scale snaps to **0.1 increments**

Use snap to align objects cleanly side by side or on a grid.

---

## Cloning and Deleting

### 📋 Clone

Select an object and click **Clone** (or press **D**) to create an exact duplicate. The copy appears slightly offset from the original and is immediately selected so you can move it.

### 🗑️ Delete

Select an object and click **Delete** (or press the **Delete / Backspace** key) to remove it from the scene. This can be undone with **⌘Z**.

---

## Undo and Redo

- **↩ Undo** — steps back through your last actions (keyboard: **⌘Z**)
- **↪ Redo** — steps forward again (keyboard: **⇧⌘Z**)

Undo and redo work for: moving, rotating, scaling, adding objects, deleting objects, adding lights, deleting lights, changing light colour or intensity, and changing the environment.

---

## Lighting

### 💡 + Dir Light — Directional Light

Adds a **directional light** to the scene — like sunlight, it shines from a specific direction and casts shadows. A cone-shaped handle appears in the scene that you can select and move like any other object.

### 🔆 + Point Light

Adds a **point light** — like a bare light bulb, it shines equally in all directions from its position. A sphere handle appears that you can move around.

### Editing a Light

Click on a light handle in the viewport (or select it from the Assets panel) to select it. A **Light Properties** panel will appear on the right side of the screen with:

- **Color** — click the colour swatch to choose a new colour
- **Intensity** — drag the slider to make the light brighter or dimmer (0 = off, 10 = maximum)
- **Remove Light** — deletes the selected light

> **Note:** The scene also has four invisible default lights (ambient, directional, rim, and fill) that provide general scene illumination. These can be toggled on or off from the Assets panel.

---

## Environment — 🌅 Env

Click **Env** to cycle through environment presets. Each preset changes the sky colour, fog, and default lighting together.

| Preset | Description |
|---|---|
| **Default** | Dark studio — deep blue/purple |
| **Day** | Bright sky blue with light fog |
| **Sunset** | Warm orange and red tones |
| **Night** | Dark, deep blue with thick fog |

---

## Assets Panel — 📋 Assets

Click **Assets** to open a side panel listing everything in your scene:

- **Objects** — all imported 3D models. Click any item to select it in the viewport. Click the eye/focus icon to frame the camera on that object.
- **Default Lights** — the four built-in scene lights. Click to toggle each one off or back on.
- **User Lights** — any directional or point lights you have added yourself.

The asset count at the top of the panel shows the total number of objects and lights.

---

## Saving and Exporting

These are two different things with different purposes.

---

### 💾 Save — Work in Progress

**Save** creates a **.zip scene file** that captures the entire current state of your work so you can come back to it later and continue editing.

The saved file contains:
- All imported 3D model files
- The position, rotation, and scale of every object
- All user lights (type, colour, intensity, position)
- The current environment preset

**Use Save when:** you want to stop for the day and pick up where you left off, or share a work-in-progress with a colleague who also has the app.

To save: click **💾 Save** — a file called `scene.zip` will download to your Downloads folder.

---

### 📤 Export GLB — Final Delivery

**Export GLB** creates a **.zip file** where all the 3D objects in the scene are **bundled together as a group** — a single combined asset ready to be handed off or used in another application.

The exported file contains:
- All 3D model files collected into one package
- A `scene.json` with positions, rotations, scales, and light data
- A `grouped: true` flag indicating this is a finished export, not a save file

**Use Export GLB when:** you are completely done building and want to deliver or archive the final scene. This format is intended for handoff — it is not meant to be re-opened for further editing.

> **Key difference:**
> - **Save** = your editable project file. Open it again with **Load Scene** to keep working.
> - **Export GLB** = final delivery package. All pieces are bundled together for use elsewhere.

---

### 📂 Load Scene

Click **Load Scene** to re-open a previously saved `.zip` scene file.

This will **replace everything in the current scene** with the saved state — all objects, lights, and the environment will be restored exactly as they were when you saved.

> **Warning:** Loading a scene clears your current work. Make sure to save first if you want to keep your current scene.

Load Scene accepts `.zip` files created by the **Save** button. It also accepts individual `.glb` files if you want to load a single model as a starting point.

---

## Chat Panel

The chat panel in the bottom-right corner connects to the AI character in the scene. Type a message and press **Enter** or click **Send** to talk to it.

---

## Quick Reference Card

| Button | Shortcut | What it does |
|---|---|---|
| Import 3D | — | Add a GLB or GLTF model to the scene |
| + Dir Light | — | Add a directional (sun-style) light |
| + Point Light | — | Add a point (bulb-style) light |
| Delete | Del / Backspace | Remove selected object |
| Clone | D | Duplicate selected object |
| Env | — | Cycle environment presets |
| Snap | G | Toggle grid snapping |
| Save | — | Save scene as editable .zip file |
| Export GLB | — | Export final bundled scene .zip |
| Load Scene | — | Open a previously saved .zip |
| Assets | — | Open the scene asset list panel |
| Undo | ⌘Z | Undo last action |
| Redo | ⇧⌘Z | Redo last undone action |
| Move | T | Switch to move gizmo |
| Rotate | R | Switch to rotate gizmo |
| Scale | S | Switch to scale gizmo |
