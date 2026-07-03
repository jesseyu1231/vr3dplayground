// Product-shot quality three.js viewer for Tripo-generated glb files.
//
// "Neon product shot" palette — a hackathon-friendly, slightly cyberpunk vibe
// that still reads as a real studio render:
//   - Key light:   warm gold, ~45° high, front-right — hero light, casts shadow
//   - Fill light:  saturated cyan, breathes in sync with the cyan pool
//   - Rim light:   hot magenta, breathes in sync with the magenta pool
//   - PMREM env:   RoomEnvironment at 30% intensity (just enough IBL for PBR
//                    reflections; any higher and it'd wash out the colored lights)
//   - Contact shadow: soft PCF shadow from key light onto an invisible floor plane
//
// Background: animated twin-spotlight vignette — magenta and cyan pools slowly
// drift and pulse, giving the scene a live club-stage feel.
// Controls: left-drag rotate, wheel zoom (clamped), pan disabled, polar clamped above horizon.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface ViewerHandle {
  /** Load a new glb, replacing the previous model. */
  loadModel: (glbUrl: string) => Promise<void>;
  /** Stop animation loop and release GPU resources. */
  dispose: () => void;
}

export function createTripoViewer(canvas: HTMLCanvasElement): ViewerHandle {
  const scene = new THREE.Scene();
  const bg = makeStudioBackground();
  scene.background = bg.texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(1.8, 1.2, 2.4);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const lights = applyStudioLighting(scene, renderer);
  addShadowCatcher(scene);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 5.0;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // stay above the floor
  controls.target.set(0, 0.4, 0);

  const loader = new GLTFLoader();
  let currentModel: THREE.Object3D | null = null;

  const handleResize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(canvas);
  handleResize();

  let rafId = 0;
  // Background repaints at ~20fps — any faster is wasted work on a soft
  // gradient, and the CanvasTexture upload isn't free.
  const BG_REPAINT_MS = 50;
  let lastBgPaint = 0;
  const tick = (now: number) => {
    if (now - lastBgPaint >= BG_REPAINT_MS) {
      bg.update(now / 1000);
      lastBgPaint = now;
    }
    lights.update(now / 1000);
    controls.update();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  async function loadModel(glbUrl: string) {
    const gltf = await loader.loadAsync(glbUrl);
    if (currentModel) {
      scene.remove(currentModel);
      disposeObject(currentModel);
    }
    const model = gltf.scene;
    normalizeAndGroundModel(model);
    enableShadowCasting(model);
    scene.add(model);
    currentModel = model;

    // Point controls at the model's actual center (handles odd aspect ratios).
    const box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    controls.target.copy(center);
    controls.update();
  }

  function dispose() {
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    controls.dispose();
    if (currentModel) disposeObject(currentModel);
    if (scene.environment) scene.environment.dispose();
    renderer.dispose();
  }

  return { loadModel, dispose };
}

/** Three-point studio lighting + PMREM environment for PBR materials. */
function applyStudioLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  // PMREM: convert a procedural room into a mip-mapped env map. PBR needs this
  // for believable specular highlights on metallic/smooth surfaces.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  // Dial down IBL so the colored directional lights actually shape the model.
  // Any higher and the saturated cyan/magenta lights lose their punch.
  // environmentIntensity is a Scene property since three r163.
  scene.environmentIntensity = 0.3;
  pmrem.dispose();

  // Violet-tinted hemisphere so the shadow side picks up a faint purple hue
  // instead of going dead black — ties the model into the background palette.
  scene.add(new THREE.HemisphereLight(0xb8a8ff, 0x0a0612, 0.18));

  // Key — the hero. Warm gold, front-right, high. Casts a soft PCF shadow.
  const key = new THREE.DirectionalLight(0xffd88a, 4.2);
  key.position.set(2.5, 3.2, 1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 15;
  key.shadow.camera.left = -1.5;
  key.shadow.camera.right = 1.5;
  key.shadow.camera.top = 1.5;
  key.shadow.camera.bottom = -1.5;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);

  // Fill — saturated cyan. Tints the shadow side a cool teal, huge
  // color-contrast against the warm key. Backbone of the neon look.
  const fill = new THREE.DirectionalLight(0x4dd6ff, 1.1);
  fill.position.set(-2.5, 1.2, 1.4);
  scene.add(fill);

  // Rim — hot magenta, high and behind. Pops the silhouette with a neon edge.
  const rim = new THREE.DirectionalLight(0xff4fb0, 4.0);
  rim.position.set(-1.5, 2.4, -2.8);
  scene.add(rim);

  // Intensity base values — we breathe ±15% around these in sync with the
  // background pools, so the lights feel like they belong to the same space.
  const fillBase = fill.intensity;
  const rimBase = rim.intensity;

  return {
    update(t: number) {
      // Slow, offset sines — different periods so they never align and the
      // scene never has a "dead" moment where both pools dim together.
      fill.intensity = fillBase * (1 + 0.15 * Math.sin(t * 0.6));
      rim.intensity = rimBase * (1 + 0.18 * Math.sin(t * 0.45 + 1.3));
    },
  };
}

/** Invisible floor plane that only catches the key light's shadow. */
function addShadowCatcher(scene: THREE.Scene) {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.ShadowMaterial({ opacity: 0.55 })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  plane.receiveShadow = true;
  scene.add(plane);
}

/**
 * Animated twin-spotlight vignette — a warm magenta pool and a cool cyan pool
 * slowly drift and breathe. The gradients are repainted onto a CanvasTexture
 * each frame (throttled in the render loop) so the GPU upload stays cheap.
 */
function makeStudioBackground(): {
  texture: THREE.CanvasTexture;
  update: (t: number) => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  function paint(t: number) {
    // Drift the pool centers along slow Lissajous-ish paths. Different
    // frequencies on x/y keep the motion organic instead of circular.
    const warmX = 340 + Math.sin(t * 0.22) * 60;
    const warmY = 200 + Math.cos(t * 0.17) * 40;
    const coolX = 180 + Math.cos(t * 0.19) * 55;
    const coolY = 340 + Math.sin(t * 0.25) * 45;

    // Breathe pool brightness ±18% around the base. Warm and cool pulse
    // with different periods + a phase offset so they never dim together.
    const warmPulse = 0.82 + 0.18 * Math.sin(t * 0.45 + 1.3);
    const coolPulse = 0.82 + 0.18 * Math.sin(t * 0.6);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#0a0518";
    ctx.fillRect(0, 0, 512, 512);

    ctx.globalCompositeOperation = "screen";
    const warm = ctx.createRadialGradient(warmX, warmY, 20, warmX, warmY, 320);
    warm.addColorStop(0, rgba(255, 79, 176, warmPulse));
    warm.addColorStop(0.35, rgba(106, 31, 106, warmPulse * 0.8));
    warm.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, 512, 512);

    const cool = ctx.createRadialGradient(coolX, coolY, 10, coolX, coolY, 300);
    cool.addColorStop(0, rgba(62, 200, 255, coolPulse));
    cool.addColorStop(0.4, rgba(26, 58, 106, coolPulse * 0.8));
    cool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, 512, 512);

    ctx.globalCompositeOperation = "multiply";
    const vignette = ctx.createRadialGradient(256, 256, 120, 256, 256, 380);
    vignette.addColorStop(0, "#ffffff");
    vignette.addColorStop(1, "#1a1024");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, 512, 512);

    ctx.globalCompositeOperation = "source-over";
    texture.needsUpdate = true;
  }

  paint(0); // initial frame so there's never a flash of unpainted canvas

  return { texture, update: paint };
}

/** Alpha-scaled rgb string for gradient stops. */
function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/**
 * Fit the model into a 1-unit bounding box, then translate so its feet sit at
 * y=0 — which is where the shadow-catching floor lives.
 */
function normalizeAndGroundModel(model: THREE.Object3D) {
  const box1 = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box1.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  model.scale.setScalar(1 / maxDim);

  // Re-measure after scaling, then center on XZ and rest on Y=0.
  const box2 = new THREE.Box3().setFromObject(model);
  const center2 = new THREE.Vector3();
  box2.getCenter(center2);
  model.position.x -= center2.x;
  model.position.z -= center2.z;
  model.position.y -= box2.min.y;
}

function enableShadowCasting(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      // receiveShadow stays off — self-shadow on low-poly can cause acne; the
      // floor plane is the only shadow receiver by design.
    }
  });
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
