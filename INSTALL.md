# Installing 3D AI Environment on macOS

## Step 1 — Open the installer

Double-click the file **3D AI Environment-1.0.0-arm64.dmg** (Apple Silicon Mac)
or **3D AI Environment-1.0.0.dmg** (older Intel Mac).

> **Not sure which Mac you have?** Click the Apple logo () in the top-left corner → "About This Mac". If it says **Apple M1 / M2 / M3 / M4**, use the `arm64` file. If it says **Intel**, use the other one.

---

## Step 2 — Drag to Applications

A window will open. Drag the **3D AI Environment** icon into the **Applications** folder.

---

## Step 3 — First launch (important)

Because this app is not yet registered with Apple, macOS will block it the first time.

**You will see a message saying the app is "damaged" or "can't be opened" — this is normal.**

To fix it, follow these steps:

1. Open **Terminal**
   - Press **Command (⌘) + Space** to open Spotlight
   - Type `Terminal` and press **Enter**

2. Copy and paste the following command into Terminal, then press **Enter**:

```
xattr -cr "/Applications/3D AI Environment.app"
```

3. Open the app normally — double-click **3D AI Environment** in your Applications folder.

It should now open without any warnings.

---

## Step 4 — You're in

The app window will open and display the 3D scene. No internet connection is required to run the app after the first launch.

---

## Troubleshooting

**"Command not found" in Terminal**
Make sure you copied the full command including the quotes.

**App still won't open after running the command**
Try right-clicking the app in Applications and choosing **Open** instead of double-clicking.

**The window is black**
Make sure you have an internet connection on first launch — the app loads 3D graphics from a content server the first time it starts.
