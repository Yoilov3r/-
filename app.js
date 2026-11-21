import * as THREE from "./vendor/three.module.js";

const canvas = document.querySelector("#scene");
const body = document.body;
const stage = document.querySelector("#painting-stage");
const entry = document.querySelector("#entry");
const enterButton = document.querySelector("#enter-button");
const loadingText = document.querySelector("#loading-text");
const sceneStateText = document.querySelector("#scene-state-text");
const toast = document.querySelector("#toast");
const referenceTrigger = document.querySelector("#reference-trigger");
const referenceDialog = document.querySelector("#reference-dialog");
const dialogClose = document.querySelector("#dialog-close");
const dialogImage = document.querySelector("#dialog-image");
const dialogCaption = document.querySelector("#dialog-caption");
const landmarks = document.querySelector("#landmarks");
const routeToggle = document.querySelector("#route-toggle");
const joystick = document.querySelector("#joystick");
const joystickKnob = document.querySelector("#joystick-knob");
const routeReadout = document.querySelector("#route-readout");
const progressIndex = document.querySelector("#progress-index");
const progressFill = document.querySelector("#progress-fill");
const progressLabel = document.querySelector("#progress-label");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = window.matchMedia("(pointer: coarse)");

const WORLD = {
  minX: -112,
  maxX: 112,
  minZ: -116,
  maxZ: 96,
  segments: coarsePointer.matches ? 230 : 340,
  riverHalf: 12.5,
};
const WATER_VISIBLE_PADDING = 3;
const WATER_VISIBLE_HALF = WORLD.riverHalf + WATER_VISIBLE_PADDING;
const EYE_HEIGHT = 1.85;
const BRIDGE_HALF_Z = 24;
const BRIDGE_HALF_X = 2.9;
const BRIDGE_APPROACH = 7;
const START = { x: 0, z: 58, yaw: 0, pitch: 0.075 };

const spots = {
  valley: {
    name: "入谷",
    index: 1,
    x: 0,
    z: 58,
    yaw: 0,
    pitch: 0.075,
    message: "山门已在身后",
  },
  pines: {
    name: "松风",
    index: 2,
    x: 17,
    z: 31,
    yaw: 0.72,
    pitch: 0.01,
    message: "松风入袖",
  },
  village: {
    name: "山居",
    index: 3,
    x: -24,
    z: 27,
    yaw: -0.8,
    pitch: -0.015,
    message: "行至水岸人家",
  },
  far: {
    name: "远岫",
    index: 4,
    x: 0,
    z: -28,
    yaw: 0,
    pitch: 0.015,
    message: "群峰近在眼前",
  },
};

const peaks = [
  [-96, -27, 17, 20, 16],
  [-82, -55, 24, 16, 20],
  [-65, -72, 30, 12, 18],
  [-52, -47, 21, 14, 18],
  [-37, -76, 32, 12, 19],
  [-22, -58, 24, 12, 17],
  [-6, -76, 36, 12, 19],
  [9, -57, 27, 12, 17],
  [25, -75, 31, 12, 19],
  [40, -52, 23, 14, 18],
  [57, -70, 29, 14, 19],
  [74, -47, 23, 16, 20],
  [94, -26, 18, 19, 17],
  [0, -105, 24, 30, 12],
];

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8d7b4e");
scene.fog = new THREE.FogExp2(0x9d8d60, 0.0048);

const camera = new THREE.PerspectiveCamera(61, 1, 0.12, 360);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = !coarsePointer.matches;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const keys = new Set();
const joystickInput = { x: 0, y: 0 };
const colliders = [];
const windTrees = [];
const driftClouds = [];
const landPlacements = [];
const sceneDetailAudit = {
  pineTrees: 0,
  pineCanopyPlanes: 0,
  pineVariants: new Set(),
  grassInstances: 0,
  grassPlanes: 3,
  panoramaLayers: 0,
  panoramaVeil: false,
};
const clock = new THREE.Clock();
const dummy = new THREE.Object3D();
const color = new THREE.Color();

let isLive = false;
let currentSpot = "valley";
let yaw = START.yaw;
let pitch = START.pitch;
let fov = 61;
let elapsed = 0;
let toastTimer = 0;
let statusTimer = 0;
let roamingTimer = 0;
let dragPointerId = null;
let lastPointerX = 0;
let lastPointerY = 0;
let joystickPointerId = null;
let walkCycle = 0;
let bridgePavilion = null;
let waterMaterial = null;
let panorama = null;
let pineTrunkMaterial = null;
let pineTrunkGeometry = null;
let travel = null;
let isMoving = false;

const player = new THREE.Vector3(START.x, 0, START.z);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, amount) => start + (end - start) * amount;
const damp = (start, end, lambda, dt) => lerp(start, end, 1 - Math.exp(-lambda * dt));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (value) => value - Math.floor(value);
const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7 + 17.13) * 43758.5453);

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm(x, y, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let index = 0; index < octaves; index += 1) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

function riverCenter(x) {
  return (
    Math.sin(x * 0.028) * 4.2
    + Math.sin(x * 0.011 + 0.9) * 3.4
    - Math.sin(0.9) * 3.4
  );
}

function riverDistanceAt(x, z) {
  return Math.abs(z - riverCenter(x));
}

function isOnVisibleWater(x, z, margin = 0) {
  return riverDistanceAt(x, z) < WATER_VISIBLE_HALF + margin;
}

function shorelineZ(x, z, margin) {
  const center = riverCenter(x);
  const safeHalf = WATER_VISIBLE_HALF + margin;
  const offset = z - center;
  if (Math.abs(offset) >= safeHalf) return z;
  return center + (offset < 0 ? -safeHalf : safeHalf);
}

function recordLandPlacement(type, x, z, margin) {
  landPlacements.push({
    type,
    x: Number(x.toFixed(3)),
    z: Number(z.toFixed(3)),
    clearance: Number((riverDistanceAt(x, z) - WATER_VISIBLE_HALF).toFixed(3)),
    margin,
  });
}

function heightAt(x, z) {
  const riverDistance = riverDistanceAt(x, z);
  const valley = smoothstep(WORLD.riverHalf + 2, 40, riverDistance);
  const startDistance = Math.hypot(x - START.x, z - START.z);
  const startPlateau = 1 - smoothstep(9, 36, startDistance);

  let ridgeHeight = 0;
  for (const [px, pz, height, sx, sz] of peaks) {
    const dx = (x - px) / sx;
    const dz = (z - pz) / sz;
    ridgeHeight += height * Math.exp(-(dx * dx + dz * dz));
  }

  const crag = Math.pow(
    1 - Math.min(1, Math.abs(fbm(x * 0.085, z * 0.085, 5) * 2 - 1)),
    2,
  );
  ridgeHeight *= 0.82 + crag * 0.38;
  const rough = (fbm(x * 0.055, z * 0.055, 5) - 0.45) * 5.8;
  const fine = (fbm(x * 0.18, z * 0.18, 3) - 0.48) * 1.35;
  const sideHills = smoothstep(52, 106, Math.abs(x)) * (4 + fbm(x * 0.04, z * 0.04) * 8);
  const northWall = smoothstep(58, 112, -z) * (4 + fbm(x * 0.07, z * 0.07) * 7);
  const ridge = (ridgeHeight * 0.96 + rough + fine + sideHills + northWall) * valley;
  const terracedBank = smoothstep(10, 18, riverDistance) * (0.9 + fbm(x * 0.12, z * 0.12) * 1.2);
  let height = lerp(-1.35, ridge + terracedBank, valley);
  height = lerp(height, 0.42 + fine * 0.12, startPlateau * 0.88);
  return height;
}

function bridgeDeckHeight(z) {
  const distance = clamp(Math.abs(z) / BRIDGE_HALF_Z, 0, 1);
  return 0.48 + Math.pow(Math.cos(distance * Math.PI * 0.5), 1.4) * 2.35;
}

function bridgeApproachHeight(x, z) {
  const distance = Math.abs(z) - BRIDGE_HALF_Z;
  if (distance < 0 || distance > BRIDGE_APPROACH) return null;
  const direction = Math.sign(z) || 1;
  const outerZ = direction * (BRIDGE_HALF_Z + BRIDGE_APPROACH);
  const outerHeight = heightAt(x, outerZ) + 0.025;
  const ramp = smoothstep(0, 1, distance / BRIDGE_APPROACH);
  return lerp(bridgeDeckHeight(direction * BRIDGE_HALF_Z), outerHeight, ramp);
}

function isOnBridge(x, z) {
  return Math.abs(x) < BRIDGE_HALF_X && Math.abs(z) < BRIDGE_HALF_Z;
}

function isOnBridgeApproach(x, z) {
  return Math.abs(x) < BRIDGE_HALF_X + 0.15
    && Math.abs(z) >= BRIDGE_HALF_Z
    && Math.abs(z) <= BRIDGE_HALF_Z + BRIDGE_APPROACH;
}

function groundHeightAt(x, z) {
  const terrainHeight = heightAt(x, z);
  if (isOnBridge(x, z)) {
    return Math.max(terrainHeight, bridgeDeckHeight(z));
  }
  if (isOnBridgeApproach(x, z)) {
    return Math.max(terrainHeight, bridgeApproachHeight(x, z));
  }
  return terrainHeight;
}

function getCameraGround() {
  return groundHeightAt(player.x, player.z);
}

function setCameraTransform(bob = 0) {
  camera.position.set(player.x, getCameraGround() + EYE_HEIGHT + bob, player.z);
  camera.rotation.set(pitch, yaw, 0, "YXZ");
}

function setLoading(text) {
  loadingText.textContent = text;
  sceneStateText.textContent = text;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1900);
}

function markRoaming() {
  if (!isLive) return;
  body.classList.add("is-roaming");
  window.clearTimeout(roamingTimer);
  roamingTimer = window.setTimeout(() => body.classList.remove("is-roaming"), 4300);
}

function setActiveSpot(name) {
  const spot = spots[name];
  if (!spot || currentSpot === name) return;
  currentSpot = name;
  landmarks.querySelectorAll("button[data-spot]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.spot === name);
  });
  routeReadout.textContent = `画中 · ${spot.name}`;
  progressIndex.textContent = `0${spot.index} / 04`;
  progressLabel.textContent = spot.name;
  progressFill.style.setProperty("--progress", `${0.12 + (spot.index - 1) * 0.29}`);
  if (isLive) {
    setLoading("可行走");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (isLive) setLoading("可行走");
    }, 850);
  }
}

function nearestSpot() {
  let best = "valley";
  let bestDistance = Number.POSITIVE_INFINITY;
  Object.entries(spots).forEach(([name, spot]) => {
    const dx = player.x - spot.x;
    const dz = player.z - spot.z;
    const distance = Math.hypot(dx, dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  });
  return best;
}

function canStandAt(x, z) {
  if (x < WORLD.minX + 3 || x > WORLD.maxX - 3 || z < WORLD.minZ + 3 || z > WORLD.maxZ - 3) {
    return false;
  }
  if (isOnVisibleWater(x, z, 0.8) && !isOnBridge(x, z)) return false;

  for (const collider of colliders) {
    if (Math.hypot(x - collider.x, z - collider.z) < collider.radius + 0.72) {
      return false;
    }
  }
  return true;
}

function movePlayer(deltaX, deltaZ) {
  const nextX = player.x + deltaX;
  if (canStandAt(nextX, player.z)) player.x = nextX;
  const nextZ = player.z + deltaZ;
  if (canStandAt(player.x, nextZ)) player.z = nextZ;
}

function travelTo(name, announce = true) {
  const spot = spots[name];
  if (!spot || !isLive) return;
  travel = {
    elapsed: 0,
    duration: reduceMotion.matches ? 0.08 : 1.35,
    fromX: player.x,
    fromZ: player.z,
    fromYaw: yaw,
    fromPitch: pitch,
    toX: spot.x,
    toZ: spot.z,
    toYaw: spot.yaw,
    toPitch: spot.pitch,
  };
  setActiveSpot(name);
  markRoaming();
  if (announce) showToast(spot.message);
}

function resetPlayer(announce = true) {
  travel = {
    elapsed: 0,
    duration: reduceMotion.matches ? 0.08 : 1.1,
    fromX: player.x,
    fromZ: player.z,
    fromYaw: yaw,
    fromPitch: pitch,
    toX: START.x,
    toZ: START.z,
    toYaw: START.yaw,
    toPitch: START.pitch,
  };
  setActiveSpot("valley");
  markRoaming();
  if (announce) showToast("回到入谷处");
}

function createTerrain() {
  const width = WORLD.maxX - WORLD.minX;
  const depth = WORLD.maxZ - WORLD.minZ;
  const geometry = new THREE.PlaneGeometry(width, depth, WORLD.segments, WORLD.segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, (WORLD.minZ + WORLD.maxZ) * 0.5);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    positions.setY(index, heightAt(x, z));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(-0.42, 0.78, 0.45).normalize() },
      uFogColor: { value: new THREE.Color("#9d8d60") },
      uFogDensity: { value: 0.0036 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform vec3 uSunDirection;
      uniform vec3 uFogColor;
      uniform float uFogDensity;

      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float hash12(vec2 point) {
        vec3 p3 = fract(vec3(point.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);
        float a = hash12(cell);
        float b = hash12(cell + vec2(1.0, 0.0));
        float c = hash12(cell + vec2(0.0, 1.0));
        float d = hash12(cell + vec2(1.0, 1.0));
        return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
      }

      float fbm(vec2 point) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int index = 0; index < 5; index++) {
          value += noise(point) * amplitude;
          point = point * 2.02 + vec2(11.7, 7.3);
          amplitude *= 0.5;
        }
        return value;
      }

      vec3 srgb(vec3 value) {
        return pow(value, vec3(2.2));
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);
        float slope = 1.0 - clamp(normal.y, 0.0, 1.0);
        float height = clamp(vWorldPosition.y / 52.0, 0.0, 1.0);
        float broad = fbm(vWorldPosition.xz * 0.038);
        float fine = fbm(vWorldPosition.xz * 0.34 + vWorldPosition.y * 0.15);

        vec3 ochre = srgb(vec3(0.40, 0.31, 0.15));
        vec3 moss = srgb(vec3(0.20, 0.32, 0.20));
        vec3 malachite = srgb(vec3(0.19, 0.43, 0.30));
        vec3 azurite = srgb(vec3(0.12, 0.33, 0.54));
        vec3 ink = srgb(vec3(0.055, 0.09, 0.075));
        vec3 stoneWash = srgb(vec3(0.34, 0.39, 0.29));

        float lowland = 1.0 - smoothstep(0.06, 0.32, height);
        float mineralBand = smoothstep(0.045, 0.34, height + broad * 0.08);
        float cliffBand = smoothstep(0.12, 0.78, slope);

        vec3 tint = mix(ochre * (0.88 + broad * 0.15), moss, lowland * 0.42);
        tint = mix(tint, malachite, mineralBand * 0.72);
        tint = mix(tint, azurite, smoothstep(0.16, 0.58, height) * (0.5 + cliffBand * 0.34));
        tint = mix(tint, stoneWash, smoothstep(0.48, 0.95, 1.0 - slope) * 0.12);

        float strata = smoothstep(0.62, 0.9, fbm(vec2(
          vWorldPosition.x * 0.16 + broad * 6.0,
          vWorldPosition.y * 0.86 + vWorldPosition.z * 0.08
        )));
        tint = mix(tint, tint * 0.7, strata * (0.18 + cliffBand * 0.28));

        float cun = smoothstep(
          0.58,
          0.82,
          fbm(vWorldPosition.xz * vec2(0.28, 2.2) + vWorldPosition.y * 0.19)
        );
        float mineral = smoothstep(0.52, 0.9, fine);
        tint = mix(tint, ink, cun * (0.18 + cliffBand * 0.34));
        tint = mix(tint, malachite * 1.08, mineral * height * 0.16);

        float wash = fbm(vec2(
          vWorldPosition.x * 0.065,
          vWorldPosition.y * 0.32 + vWorldPosition.z * 0.038
        ));
        float silkWave = 0.5 + 0.5 * sin(
          (vWorldPosition.x * 2.4 + vWorldPosition.z * 0.9 + vWorldPosition.y * 1.7) * 11.0
          + fbm(vWorldPosition.xz * 0.12) * 5.0
        );
        float fiber = smoothstep(0.76, 0.97, silkWave);
        float pigmentGrain = hash12(floor(vWorldPosition.xz * 12.0 + vWorldPosition.y * 7.0));
        tint *= 0.945 + wash * 0.095;
        tint *= 0.968 + fiber * 0.055;
        tint += vec3(0.011, 0.013, 0.008) * (pigmentGrain - 0.5);
        tint = mix(vec3(dot(tint, vec3(0.299, 0.587, 0.114))), tint, 1.14);

        float diffuse = max(dot(normal, normalize(uSunDirection)), 0.0);
        float bounce = max(dot(normal, vec3(0.0, -0.4, 1.0)), 0.0);
        tint *= 0.63 + diffuse * 0.29 + bounce * 0.06;

        float distanceToCamera = distance(cameraPosition, vWorldPosition);
        float fog = 1.0 - exp(-distanceToCamera * distanceToCamera * uFogDensity * uFogDensity);
        tint = mix(tint, uFogColor, clamp(fog, 0.0, 0.44));

        gl_FragColor = vec4(tint, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = "Painted Qianli terrain";
  scene.add(mesh);
  return mesh;
}

function createPanoramaVeilTexture() {
  const veilCanvas = document.createElement("canvas");
  veilCanvas.width = 768;
  veilCanvas.height = 256;
  const context = veilCanvas.getContext("2d");
  const verticalFade = context.createLinearGradient(0, 0, 0, veilCanvas.height);
  verticalFade.addColorStop(0, "rgba(242, 232, 201, 0.06)");
  verticalFade.addColorStop(0.34, "rgba(234, 224, 193, 0.16)");
  verticalFade.addColorStop(0.58, "rgba(220, 216, 184, 0.26)");
  verticalFade.addColorStop(0.82, "rgba(194, 197, 164, 0.1)");
  verticalFade.addColorStop(1, "rgba(166, 176, 145, 0)");
  context.fillStyle = verticalFade;
  context.fillRect(0, 0, veilCanvas.width, veilCanvas.height);

  context.globalCompositeOperation = "lighter";
  for (let index = 0; index < 96; index += 1) {
    const x = hash2(index, 1.7) * veilCanvas.width;
    const y = 28 + hash2(index, 4.3) * 172;
    const radiusX = 28 + hash2(index, 7.8) * 92;
    const radiusY = 3 + hash2(index, 2.4) * 13;
    const mist = context.createRadialGradient(x, y, 0, x, y, radiusX);
    mist.addColorStop(0, `rgba(242, 235, 207, ${0.025 + hash2(index, 9.2) * 0.05})`);
    mist.addColorStop(0.46, "rgba(226, 222, 192, 0.035)");
    mist.addColorStop(1, "rgba(211, 211, 181, 0)");
    context.save();
    context.translate(x, y);
    context.scale(1, radiusY / radiusX);
    context.fillStyle = mist;
    context.beginPath();
    context.arc(0, 0, radiusX, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  context.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(veilCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(2.35, 1);
  texture.offset.x = 0.13;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function createPanoramaLayer(texture, options) {
  const layerTexture = texture.clone();
  layerTexture.needsUpdate = true;
  layerTexture.wrapS = THREE.MirroredRepeatWrapping;
  layerTexture.repeat.set(options.repeat, 1);
  layerTexture.offset.x = options.offset;

  const geometry = new THREE.CylinderGeometry(
    options.radius,
    options.radius,
    options.height,
    144,
    1,
    true,
  );
  const material = new THREE.MeshBasicMaterial({
    map: layerTexture,
    side: THREE.BackSide,
    color: options.color,
    transparent: true,
    opacity: options.opacity,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = options.y;
  mesh.rotation.y = options.rotation;
  mesh.renderOrder = options.renderOrder;
  mesh.name = options.name;
  scene.add(mesh);
  return mesh;
}

async function createPanorama() {
  const texture = await new THREE.TextureLoader().loadAsync("./assets/qianli-panorama.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  createPanoramaLayer(texture, {
    radius: 148,
    height: 168,
    y: 59,
    color: 0xa4a27d,
    opacity: 0.46,
    repeat: 0.94,
    offset: 0.41,
    rotation: Math.PI * 0.045,
    renderOrder: -1100,
    name: "Offset painting distance layer",
  });
  panorama = createPanoramaLayer(texture, {
    radius: 132,
    height: 160,
    y: 56,
    color: 0xd9caa0,
    opacity: 0.92,
    repeat: 1,
    offset: 0.08,
    rotation: Math.PI * 0.12,
    renderOrder: -1000,
    name: "Original painting cyclorama",
  });

  const veil = new THREE.Mesh(
    new THREE.CylinderGeometry(121, 121, 147, 144, 1, true),
    new THREE.MeshBasicMaterial({
      map: createPanoramaVeilTexture(),
      side: THREE.BackSide,
      color: 0xe2d7b1,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  veil.position.y = 52.5;
  veil.rotation.y = Math.PI * 0.12;
  veil.renderOrder = -900;
  veil.name = "Silk mist veil";
  scene.add(veil);

  sceneDetailAudit.panoramaLayers = 2;
  sceneDetailAudit.panoramaVeil = true;
}

function createWater() {
  const depth = WORLD.riverHalf * 2 + 6;
  const geometry = new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX, depth, 160, 5);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const localZ = positions.getZ(index);
    positions.setZ(index, riverCenter(x) + localZ);
    positions.setY(index, -0.25);
  }
  geometry.computeVertexNormals();

  waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(-0.35, 0.8, 0.35).normalize() },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uTime;
      uniform vec3 uSunDirection;
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      float hash12(vec2 point) {
        vec3 p3 = fract(vec3(point.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);
        float a = hash12(cell);
        float b = hash12(cell + vec2(1.0, 0.0));
        float c = hash12(cell + vec2(0.0, 1.0));
        float d = hash12(cell + vec2(1.0, 1.0));
        return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
      }

      float fbm(vec2 point) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int index = 0; index < 4; index++) {
          value += noise(point) * amplitude;
          point = point * 2.04 + vec2(8.2, 13.7);
          amplitude *= 0.5;
        }
        return value;
      }

      vec3 srgb(vec3 value) {
        return pow(value, vec3(2.2));
      }

      void main() {
        vec2 flowUv = vec2(vWorldPosition.x * 0.055 + uTime * 0.015, vWorldPosition.z * 0.12 - uTime * 0.08);
        float broad = fbm(flowUv);
        float fine = fbm(flowUv * 3.7 + vec2(uTime * 0.03, 0.0));
        float bands = smoothstep(0.48, 0.8, broad) * smoothstep(0.35, 0.78, fine);
        float bank = smoothstep(6.0, 13.0, abs(vWorldPosition.z - (sin(vWorldPosition.x * 0.028) * 4.2)));

        vec3 deep = srgb(vec3(0.10, 0.29, 0.31));
        vec3 shallow = srgb(vec3(0.30, 0.49, 0.42));
        vec3 water = mix(deep, shallow, bank * 0.55 + broad * 0.25);
        water += srgb(vec3(0.47, 0.44, 0.27)) * bands * 0.16;
        water += srgb(vec3(0.12, 0.19, 0.16)) * fine * 0.16;

        gl_FragColor = vec4(water, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, waterMaterial);
  mesh.renderOrder = 4;
  mesh.name = "Painted river";
  scene.add(mesh);
  return mesh;
}

function createTrail() {
  const segments = 52;
  const halfWidth = 0.82;
  const positions = [];
  const uvs = [];
  const indices = [];
  const pointAt = (t) => {
    const z = lerp(57, BRIDGE_HALF_Z + BRIDGE_APPROACH - 0.25, t);
    const x = Math.sin(t * Math.PI * 1.35) * 3.8 * (1 - t);
    const nextZ = z - 0.2;
    const nextX = Math.sin(((t + 0.005) * Math.PI * 1.35)) * 3.8 * (1 - t - 0.005);
    const tangent = new THREE.Vector2(nextX - x, nextZ - z).normalize();
    return {
      x,
      z,
      normal: new THREE.Vector2(-tangent.y, tangent.x),
    };
  };

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const point = pointAt(t);
    for (const side of [-1, 1]) {
      const x = point.x + point.normal.x * halfWidth * side;
      const z = point.z + point.normal.y * halfWidth * side;
      positions.push(x, groundHeightAt(x, z) + 0.035, z);
      uvs.push(side < 0 ? 0 : 1, t * 7);
    }
    if (index < segments) {
      const current = index * 2;
      indices.push(
        current,
        current + 1,
        current + 3,
        current,
        current + 3,
        current + 2,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const trail = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x8f7c4f,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
    }),
  );
  trail.renderOrder = 2;
  trail.name = "Painted mountain trail";
  scene.add(trail);
  return trail;
}

function createPigmentTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 512;
  textureCanvas.height = 512;
  const context = textureCanvas.getContext("2d");
  context.fillStyle = "#f5efda";
  context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
  context.lineCap = "round";

  for (let index = 0; index < 2200; index += 1) {
    const x = hash2(index, 1.7) * textureCanvas.width;
    const y = hash2(index, 7.4) * textureCanvas.height;
    const length = 3 + hash2(index, 3.2) * 24;
    const vertical = hash2(index, 9.5) > 0.54;
    context.strokeStyle = `rgba(88, 69, 43, ${0.018 + hash2(index, 4.1) * 0.045})`;
    context.lineWidth = 0.45 + hash2(index, 6.2) * 1.2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(
      x + (vertical ? (hash2(index, 2.7) - 0.5) * 2 : length),
      y + (vertical ? length : (hash2(index, 5.3) - 0.5) * 2),
    );
    context.stroke();
  }

  for (let index = 0; index < 320; index += 1) {
    const radius = 0.4 + hash2(index, 8.3) * 1.5;
    context.fillStyle = `rgba(87, 71, 39, ${0.025 + hash2(index, 2.2) * 0.05})`;
    context.beginPath();
    context.arc(
      hash2(index, 3.8) * textureCanvas.width,
      hash2(index, 6.9) * textureCanvas.height,
      radius,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 1.7);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

const pigmentTexture = createPigmentTexture();

function material(colorValue, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: colorValue,
    map: options.pigment === false ? null : pigmentTexture,
    bumpMap: options.bump ? pigmentTexture : null,
    bumpScale: options.bumpScale ?? 0.018,
    roughness: options.roughness ?? 0.92,
    metalness: 0,
    flatShading: options.flatShading ?? false,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: options.side ?? THREE.FrontSide,
  });
}

const woodMaterial = material(0x69452b, { roughness: 1 });
const darkWoodMaterial = material(0x3f2d20, { roughness: 1 });
const roofMaterial = material(0x31545b, {
  roughness: 0.92,
  side: THREE.DoubleSide,
  bump: true,
  bumpScale: 0.012,
});
const wallMaterial = material(0xb7b08d, { roughness: 1, bump: true, bumpScale: 0.026 });
const windowMaterial = material(0x8f5d2e, {
  emissive: 0xd28b3d,
  emissiveIntensity: 0.72,
  roughness: 0.7,
});
const stoneMaterial = material(0x3e4936, { roughness: 1, bump: true, bumpScale: 0.024 });
const pineMaterials = [];
let pineGeometry = null;
let grassTexture = null;

function createPineTexture(variant = 0) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 384;
  textureCanvas.height = 640;
  const context = textureCanvas.getContext("2d");
  const palette = [
    {
      deep: "#29483b",
      mid: "#4c684f",
      light: "#849064",
      ink: "#1e3a33",
      sap: "#8d7d4b",
    },
    {
      deep: "#304b3a",
      mid: "#607250",
      light: "#9aa071",
      ink: "#203d3d",
      sap: "#a1844f",
    },
    {
      deep: "#28473f",
      mid: "#4d6c5c",
      light: "#7e9573",
      ink: "#18363b",
      sap: "#7f7947",
    },
    {
      deep: "#354b38",
      mid: "#687556",
      light: "#a39e6a",
      ink: "#243d34",
      sap: "#9b7845",
    },
  ][variant % 4];

  context.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  context.lineCap = "round";
  context.lineJoin = "round";

  const baseX = 196 + (hash2(variant, 1.3) - 0.5) * 24;
  const crownX = 188 + (hash2(variant, 4.7) - 0.5) * 20;
  context.strokeStyle = "rgba(69, 51, 30, 0.72)";
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(baseX, 615);
  context.quadraticCurveTo(baseX - 12, 360, crownX, 66);
  context.stroke();

  for (let level = 0; level < 15; level += 1) {
    const y = 564 - level * 34 + (hash2(level, variant + 2.4) - 0.5) * 18;
    const side = level % 2 === 0 ? -1 : 1;
    const branchLength = 58 + hash2(level, variant + 8.2) * 66 - level * 1.8;
    const startX = lerp(crownX, baseX, (y - 66) / 508);
    const tipX = startX + side * branchLength;
    const tipY = y - 20 - hash2(level, variant + 6.8) * 24;

    context.globalAlpha = 1;
    context.strokeStyle = palette.ink;
    context.lineWidth = 8 - Math.min(4, level * 0.25);
    context.beginPath();
    context.moveTo(startX, y + 16);
    context.quadraticCurveTo(startX + side * branchLength * 0.42, y + 1, tipX, tipY);
    context.stroke();

    for (let mat = 0; mat < 10; mat += 1) {
      const along = 0.12 + mat * 0.085;
      const matX = lerp(startX, tipX, along);
      const matY = lerp(y + 12, tipY, along) - Math.sin(along * Math.PI) * 16;
      const radiusX = 13 + hash2(level + mat, variant + 2.7) * 28;
      const radiusY = 5 + hash2(mat, level + 7.1) * 12;
      context.save();
      context.translate(matX, matY);
      context.rotate(side * (0.18 + hash2(level + mat, variant) * 0.55));
      context.globalAlpha = 0.3 + hash2(mat, level) * 0.38;
      const brush = context.createRadialGradient(0, 0, 0, 0, 0, radiusX);
      brush.addColorStop(0, mat % 3 === 0 ? palette.light : palette.mid);
      brush.addColorStop(0.7, palette.mid);
      brush.addColorStop(1, palette.deep);
      context.fillStyle = brush;
      context.beginPath();
      context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    for (let needle = 0; needle < 30; needle += 1) {
      const along = 0.2 + hash2(level + needle, variant + 3.8) * 0.8;
      const x = lerp(startX, tipX, along) + (hash2(needle, level) - 0.5) * 24;
      const needleY = lerp(y + 10, tipY, along) + (hash2(level, needle) - 0.5) * 20;
      const length = 7 + hash2(needle, variant + 7.2) * 22;
      const rise = 7 + hash2(variant, needle + 4.9) * 23;
      context.strokeStyle = needle % 5 === 0 ? palette.sap : palette.ink;
      context.globalAlpha = 0.78 + hash2(needle, level + 2.1) * 0.18;
      context.lineWidth = 1.8 + hash2(level, needle + 1.7) * 3.2;
      context.beginPath();
      context.moveTo(x, needleY);
      context.quadraticCurveTo(
        x + side * length * 0.45,
        needleY - rise * 0.4,
        x + side * length,
        needleY - rise,
      );
      context.stroke();
    }
  }

  for (let apex = 0; apex < 18; apex += 1) {
    const x = crownX + (hash2(apex, variant + 1.6) - 0.5) * (34 + apex * 1.1);
    const y = 63 + hash2(apex, variant + 5.2) * (170 + apex * 3.2);
    const radius = 11 + hash2(apex, 9.4) * 18;
    context.globalAlpha = 0.24 + hash2(apex, 3.7) * 0.24;
    context.fillStyle = apex % 3 === 0 ? palette.light : palette.mid;
    context.beginPath();
    context.ellipse(
      x,
      y,
      radius * 0.84,
      radius * 0.42,
      (hash2(apex, 7.2) - 0.5) * 0.8,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function ensurePineMaterials() {
  if (pineMaterials.length > 0) return;
  for (let variant = 0; variant < 4; variant += 1) {
    pineMaterials.push(
      new THREE.MeshBasicMaterial({
        map: createPineTexture(variant),
        color: 0xeee8d1,
        side: THREE.DoubleSide,
        alphaTest: 0.055,
        transparent: true,
        depthWrite: true,
        toneMapped: false,
      }),
    );
  }
  pineGeometry = new THREE.PlaneGeometry(8.4, 14.8);
  pineGeometry.translate(0, 7.4, 0);
  pineTrunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 8.6, 7);
  pineTrunkGeometry.translate(0, 4.3, 0);
  pineTrunkMaterial = material(0x523d27, { roughness: 1, bump: true, bumpScale: 0.024 });
}

function addBox(parent, width, height, depth, x, y, z, mat, castShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const roofInkMaterial = new THREE.LineBasicMaterial({
  color: 0x17261f,
  transparent: true,
  opacity: 0.84,
});

function roofOutline(geometry) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 24),
    roofInkMaterial,
  );
}

function createHippedRoof(width, depth, rise) {
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const cornerLift = 0.2;
  const midpointLift = 0.01;
  const positions = [
    0, rise, 0,
    -halfWidth, cornerLift, -halfDepth,
    halfWidth, cornerLift, -halfDepth,
    halfWidth, cornerLift, halfDepth,
    -halfWidth, cornerLift, halfDepth,
    0, midpointLift, -halfDepth,
    halfWidth, midpointLift, 0,
    0, midpointLift, halfDepth,
    -halfWidth, midpointLift, 0,
  ];
  const indices = [];
  for (let side = 0; side < 4; side += 1) {
    const corner = 1 + side;
    const nextCorner = 1 + ((side + 1) % 4);
    const midpoint = 5 + side;
    indices.push(0, corner, midpoint, 0, midpoint, nextCorner);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const roof = new THREE.Mesh(geometry, roofMaterial);
  roof.castShadow = !coarsePointer.matches;
  roof.receiveShadow = true;
  roof.add(roofOutline(geometry));
  return roof;
}

function createGabledRoof(width, depth, rise) {
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const ridgeHalf = width * 0.3;
  const cornerLift = 0.22;
  const midpointLift = 0.015;
  const positions = [
    -halfWidth, cornerLift, halfDepth,
    0, midpointLift, halfDepth,
    halfWidth, cornerLift, halfDepth,
    -halfWidth, cornerLift, -halfDepth,
    0, midpointLift, -halfDepth,
    halfWidth, cornerLift, -halfDepth,
    -ridgeHalf, rise, 0,
    ridgeHalf, rise, 0,
  ];
  const indices = [
    0, 1, 6,
    1, 7, 6,
    1, 2, 7,
    3, 6, 4,
    4, 6, 7,
    4, 7, 5,
    0, 6, 3,
    2, 5, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const roof = new THREE.Mesh(geometry, roofMaterial);
  roof.castShadow = !coarsePointer.matches;
  roof.receiveShadow = true;
  roof.add(roofOutline(geometry));
  return roof;
}

function createPavilion(x, z, scale = 1, options = {}) {
  const onBridge = options.onBridge === true;
  const safeZ = onBridge ? z : shorelineZ(x, z, 4.6);
  const group = new THREE.Group();
  const baseY = groundHeightAt(x, safeZ) + 0.1;
  group.position.set(x, baseY, safeZ);
  group.scale.setScalar(scale);

  if (!onBridge) {
    addBox(group, 5.05, 0.9, 3.85, 0, -0.31, 0, stoneMaterial, false);
    recordLandPlacement("pavilion", x, safeZ, 4.6);
  }
  addBox(group, 4.8, 0.25, 3.6, 0, 0.12, 0, stoneMaterial);
  for (const px of [-1.8, 1.8]) {
    for (const pz of [-1.25, 1.25]) {
      addBox(group, 0.17, 2.45, 0.17, px, 1.35, pz, darkWoodMaterial);
    }
  }
  addBox(group, 4.15, 0.14, 3.15, 0, 2.57, 0, woodMaterial);
  const roof = createHippedRoof(6.35, 4.7, 1.92);
  roof.position.y = 2.6;
  group.add(roof);
  addBox(group, 4.5, 0.12, 3.45, 0, 2.66, 0, darkWoodMaterial);
  for (const side of [-1, 1]) {
    addBox(group, 3.7, 0.08, 0.08, 0, 1.05, side * 1.14, darkWoodMaterial, false);
    addBox(group, 3.7, 0.08, 0.08, 0, 0.72, side * 1.14, darkWoodMaterial, false);
  }
  for (let step = 0; step < 3; step += 1) {
    addBox(
      group,
      2.5 - step * 0.24,
      0.11,
      0.46,
      0,
      -0.02 - step * 0.1,
      2.05 + step * 0.35,
      stoneMaterial,
      false,
    );
  }
  scene.add(group);
  return group;
}

function createBridge() {
  const bridge = new THREE.Group();
  bridge.name = "Arched timber bridge";
  const segmentCount = 64;
  const halfWidth = 2.75;
  const deckThickness = 0.28;
  const positions = [];
  const indices = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const z = -BRIDGE_HALF_Z + (index / segmentCount) * BRIDGE_HALF_Z * 2;
    const y = bridgeDeckHeight(z);
    positions.push(
      -halfWidth, y, z,
      halfWidth, y, z,
      -halfWidth, y - deckThickness, z,
      halfWidth, y - deckThickness, z,
    );
  }

  for (let index = 0; index < segmentCount; index += 1) {
    const current = index * 4;
    const next = current + 4;
    indices.push(
      current, current + 1, next + 1,
      current, next + 1, next,
      current + 2, next + 2, next + 3,
      current + 2, next + 3, current + 3,
      current, next, next + 2,
      current, next + 2, current + 2,
      current + 1, current + 3, next + 3,
      current + 1, next + 3, next + 1,
    );
  }

  const deckGeometry = new THREE.BufferGeometry();
  deckGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  deckGeometry.setIndex(indices);
  deckGeometry.computeVertexNormals();
  const deck = new THREE.Mesh(
    deckGeometry,
    material(0x69452b, { roughness: 1, side: THREE.DoubleSide }),
  );
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);

  const plankLines = [];
  for (let z = -BRIDGE_HALF_Z + 0.35; z < BRIDGE_HALF_Z; z += 0.62) {
    const y = bridgeDeckHeight(z) + 0.012;
    plankLines.push(-2.66, y, z, 2.66, y, z);
  }
  const plankGeometry = new THREE.BufferGeometry();
  plankGeometry.setAttribute("position", new THREE.Float32BufferAttribute(plankLines, 3));
  const plankMarks = new THREE.LineSegments(
    plankGeometry,
    new THREE.LineBasicMaterial({
      color: 0x39261c,
      transparent: true,
      opacity: 0.58,
    }),
  );
  plankMarks.name = "Bridge deck plank seams";
  bridge.add(plankMarks);

  for (let z = -22.8; z < 22.8; z += 2.4) {
    const y = bridgeDeckHeight(z) - 0.38;
    for (const side of [-1, 1]) {
      addBox(bridge, 0.2, 0.18, 2.45, side * 2.38, y, z + 1.2, darkWoodMaterial, false);
    }
  }

  const railMaterial = new THREE.LineBasicMaterial({
    color: 0x3c2a1d,
    transparent: true,
    opacity: 0.95,
  });
  for (const side of [-1, 1]) {
    const railTop = [];
    const railMid = [];
    for (let index = 0; index <= segmentCount; index += 1) {
      const z = -BRIDGE_HALF_Z + (index / segmentCount) * BRIDGE_HALF_Z * 2;
      const y = bridgeDeckHeight(z);
      railTop.push(new THREE.Vector3(side * 2.55, y + 1.3, z));
      railMid.push(new THREE.Vector3(side * 2.55, y + 0.78, z));
    }
    bridge.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(railTop), railMaterial));
    bridge.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(railMid), railMaterial));
  }

  for (let z = -BRIDGE_HALF_Z + 1; z < BRIDGE_HALF_Z; z += 2.4) {
    const y = bridgeDeckHeight(z);
    for (const side of [-1, 1]) {
      addBox(bridge, 0.16, 1.36, 0.16, side * 2.55, y + 0.68, z, darkWoodMaterial);
    }
  }

  for (let z = -18; z <= 18; z += 9) {
    const y = bridgeDeckHeight(z);
    for (const side of [-1, 1]) {
      addBox(bridge, 0.34, y + 0.8, 0.34, side * 2.05, (y - 0.9) * 0.5, z, darkWoodMaterial);
    }
    addBox(bridge, 4.45, 0.22, 0.3, 0, y - 0.26, z, darkWoodMaterial);
  }

  const approachSegments = 20;
  const approachWidth = BRIDGE_HALF_X * 2 + 0.2;
  const approachTopPositions = [];
  const approachTopIndices = [];
  const sidePositions = [[], []];
  const sideIndices = [[], []];
  for (const direction of [-1, 1]) {
    const topOffset = approachTopPositions.length / 3;
    for (let index = 0; index <= approachSegments; index += 1) {
      const t = index / approachSegments;
      const z = direction * (BRIDGE_HALF_Z + t * BRIDGE_APPROACH);
      for (const side of [-1, 1]) {
        const x = side * approachWidth * 0.5;
        approachTopPositions.push(x, bridgeApproachHeight(x, z), z);
      }
      if (index < approachSegments) {
        const current = topOffset + index * 2;
        approachTopIndices.push(
          current,
          current + 1,
          current + 3,
          current,
          current + 3,
          current + 2,
        );
      }
    }
  }

  const approachTopGeometry = new THREE.BufferGeometry();
  approachTopGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(approachTopPositions, 3),
  );
  approachTopGeometry.setIndex(approachTopIndices);
  approachTopGeometry.computeVertexNormals();
  const approachTop = new THREE.Mesh(
    approachTopGeometry,
    material(0x72573a, { roughness: 1, side: THREE.DoubleSide }),
  );
  approachTop.castShadow = true;
  approachTop.receiveShadow = true;
  approachTop.name = "Bridge approach deck";
  bridge.add(approachTop);

  for (const direction of [-1, 1]) {
    const sideOffset = sidePositions[0].length / 3;
    for (let index = 0; index <= approachSegments; index += 1) {
      const t = index / approachSegments;
      const z = direction * (BRIDGE_HALF_Z + t * BRIDGE_APPROACH);
      const topLeft = bridgeApproachHeight(-approachWidth * 0.5, z);
      const topRight = bridgeApproachHeight(approachWidth * 0.5, z);
      const bottomLeft = Math.min(heightAt(-approachWidth * 0.5, z) - 0.12, topLeft - 0.16);
      const bottomRight = Math.min(heightAt(approachWidth * 0.5, z) - 0.12, topRight - 0.16);
      sidePositions[0].push(
        -approachWidth * 0.5,
        topLeft,
        z,
        -approachWidth * 0.5,
        bottomLeft,
        z,
      );
      sidePositions[1].push(
        approachWidth * 0.5,
        topRight,
        z,
        approachWidth * 0.5,
        bottomRight,
        z,
      );
      if (index < approachSegments) {
        for (let side = 0; side < 2; side += 1) {
          const current = sideOffset + index * 2;
          if (side === 0) {
            sideIndices[side].push(current, current + 2, current + 3, current, current + 3, current + 1);
          } else {
            sideIndices[side].push(current, current + 1, current + 3, current, current + 3, current + 2);
          }
        }
      }
    }
  }

  for (let side = 0; side < 2; side += 1) {
    const sideGeometry = new THREE.BufferGeometry();
    sideGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(sidePositions[side], 3),
    );
    sideGeometry.setIndex(sideIndices[side]);
    sideGeometry.computeVertexNormals();
    const sideMesh = new THREE.Mesh(
      sideGeometry,
      material(0x545a43, { roughness: 1, side: THREE.DoubleSide }),
    );
    sideMesh.castShadow = true;
    sideMesh.receiveShadow = true;
    sideMesh.name = "Bridge approach abutment";
    bridge.add(sideMesh);
  }

  for (const direction of [-1, 1]) {
    const endZ = direction * BRIDGE_HALF_Z;
    const base = heightAt(0, direction * (BRIDGE_HALF_Z + 0.55)) - 0.24;
    const top = bridgeDeckHeight(endZ) - 0.14;
    addBox(
      bridge,
      approachWidth + 0.45,
      Math.max(0.2, top - base),
      1.05,
      0,
      (top + base) * 0.5,
      direction * (BRIDGE_HALF_Z - 0.12),
      stoneMaterial,
    );
  }

  bridgePavilion = createPavilion(0, 0, 0.85, { onBridge: true });
  bridgePavilion.position.y = bridgeDeckHeight(0) + 0.16;
  scene.add(bridge);
  return bridge;
}

function createHouse(x, z, width, depth, height, rotation) {
  const safeZ = shorelineZ(x, z, 4.4);
  const group = new THREE.Group();
  const baseY = groundHeightAt(x, safeZ);
  group.position.set(x, baseY, safeZ);
  group.rotation.y = rotation;

  addBox(group, width + 0.3, 0.85, depth + 0.3, 0, -0.33, 0, stoneMaterial, false);
  addBox(group, width, height, depth, 0, height * 0.5, 0, wallMaterial);
  addBox(group, width + 1.05, 0.14, depth + 1.05, 0, height + 0.04, 0, darkWoodMaterial);
  const roof = createGabledRoof(width + 1.2, depth + 1.2, 2.05);
  roof.position.y = height + 0.08;
  group.add(roof);

  addBox(group, width + 0.45, 0.13, 1.05, 0, 0.22, depth * 0.5 + 0.62, woodMaterial);
  for (const px of [-width * 0.34, width * 0.34]) {
    addBox(group, 0.12, 1.65, 0.12, px, 1.03, depth * 0.5 + 0.98, darkWoodMaterial, false);
  }
  addBox(group, width * 0.72, 0.08, 0.08, 0, 1.63, depth * 0.5 + 0.98, darkWoodMaterial, false);

  for (const px of [-width * 0.46, width * 0.46]) {
    addBox(group, 0.12, height, 0.12, px, height * 0.5, depth * 0.5 - 0.08, darkWoodMaterial, false);
  }
  addBox(group, 0.74, 1.55, 0.12, 0, 0.78, depth * 0.5 + 0.06, darkWoodMaterial, false);
  for (const wx of [-width * 0.28, width * 0.28]) {
    addBox(group, 0.68, 0.58, 0.1, wx, height * 0.62, depth * 0.5 + 0.065, windowMaterial, false);
  }
  scene.add(group);
  colliders.push({ x, z: safeZ, radius: Math.max(width, depth) * 0.56 });
  recordLandPlacement("house", x, safeZ, 4.4);
  return group;
}

function createVillage() {
  createHouse(-31, 26, 7.2, 4.8, 3.5, 0.12);
  createHouse(-40, 31, 5.8, 4.2, 3.1, -0.1);
  createHouse(-23, 35, 5.4, 4.0, 2.9, 0.18);
  createHouse(-35, 40, 4.8, 3.9, 2.8, -0.22);
  createHouse(-17, -25, 5.6, 4.3, 3.1, 0.16);
  createHouse(23, -31, 4.8, 3.8, 2.8, -0.12);
  createPavilion(18, 22, 0.66);
}

function createPine(x, z, scale = 1) {
  ensurePineMaterials();
  const safeZ = shorelineZ(x, z, 3.8 + hash2(x, z) * 2.4);
  const group = new THREE.Group();
  const baseY = groundHeightAt(x, safeZ);
  group.position.set(x, baseY, safeZ);
  group.scale.setScalar(scale);
  const materialIndex = Math.floor(hash2(x * 0.7, safeZ * 0.9) * pineMaterials.length);

  const trunk = new THREE.Mesh(pineTrunkGeometry, pineTrunkMaterial);
  trunk.rotation.y = hash2(x, safeZ + 2.1) * Math.PI;
  trunk.castShadow = !coarsePointer.matches;
  trunk.receiveShadow = true;
  group.add(trunk);

  for (let planeIndex = 0; planeIndex < 3; planeIndex += 1) {
    const variantIndex = (materialIndex + planeIndex * 3) % pineMaterials.length;
    const canopy = new THREE.Mesh(pineGeometry, pineMaterials[variantIndex]);
    canopy.rotation.y = planeIndex * (Math.PI / 3)
      + (hash2(planeIndex, x + safeZ) - 0.5) * 0.24;
    canopy.scale.x = 0.9 + hash2(planeIndex, safeZ + 3.4) * 0.18;
    canopy.scale.y = 0.94 + hash2(planeIndex, x + 6.2) * 0.13;
    canopy.castShadow = planeIndex === 0 && !coarsePointer.matches;
    group.add(canopy);
    sceneDetailAudit.pineCanopyPlanes += 1;
    sceneDetailAudit.pineVariants.add(variantIndex);
  }
  sceneDetailAudit.pineTrees += 1;
  group.rotation.y = hash2(x, safeZ) * Math.PI * 2;
  group.userData.baseRotation = group.rotation.z;
  group.userData.phase = hash2(safeZ, x) * Math.PI * 2;
  scene.add(group);
  windTrees.push(group);
  colliders.push({ x, z: safeZ, radius: 0.66 * scale });
  recordLandPlacement("pine", x, safeZ, 3.8);
  return group;
}

function createPines() {
  const positions = [
    [-11, 55, 1.05],
    [12, 52, 0.92],
    [-20, 46, 1.2],
    [21, 42, 1.08],
    [-45, 20, 1.15],
    [40, 20, 1.0],
    [-53, -27, 1.2],
    [49, -15, 1.1],
    [-29, -38, 1.2],
    [-15, -38, 0.95],
    [26, -42, 1.15],
    [38, -36, 0.92],
    [-72, 16, 1.25],
    [68, 20, 1.2],
    [-63, -57, 1.1],
    [62, -54, 1.08],
  ];
  positions.forEach(([x, z, scale]) => createPine(x, z, scale));
}

function createRocks() {
  const rockColors = [0x394635, 0x4b4b35, 0x2c493d, 0x70613d];
  for (let index = 0; index < 42; index += 1) {
    const x = -95 + hash2(index, 2.7) * 190;
    const z = -80 + hash2(index, 8.1) * 150;
    const riverDistance = riverDistanceAt(x, z);
    if (isOnVisibleWater(x, z, 2.4)) continue;
    const y = heightAt(x, z);
    if (y > 16) continue;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.65 + hash2(index, 9.2) * 1.65, 0),
      material(rockColors[index % rockColors.length], { roughness: 1, flatShading: true }),
    );
    rock.position.set(x, y + 0.35, z);
    rock.scale.set(1.2 + hash2(index, 4.1), 0.65 + hash2(index, 6.3) * 0.65, 1 + hash2(index, 1.2));
    rock.rotation.set(hash2(index, 3.3), hash2(index, 2.2) * Math.PI, hash2(index, 7.8) * 0.4);
    rock.castShadow = !coarsePointer.matches;
    scene.add(rock);
  }
}

function createCrossedBrushGeometry(width, height, planeCount = 3) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let plane = 0; plane < planeCount; plane += 1) {
    const angle = (plane / planeCount) * Math.PI;
    const halfX = Math.cos(angle) * width * 0.5;
    const halfZ = Math.sin(angle) * width * 0.5;
    const offset = positions.length / 3;
    positions.push(
      -halfX, 0, -halfZ,
      halfX, 0, halfZ,
      -halfX, height, -halfZ,
      halfX, height, halfZ,
    );
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(
      offset, offset + 2, offset + 1,
      offset + 1, offset + 2, offset + 3,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createGrass() {
  if (!grassTexture) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 256;
    textureCanvas.height = 192;
    const context = textureCanvas.getContext("2d");
    context.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    const colors = [
      "rgba(116, 139, 89, 0.9)",
      "rgba(152, 153, 91, 0.88)",
      "rgba(93, 127, 91, 0.9)",
      "rgba(178, 151, 83, 0.82)",
      "rgba(191, 174, 108, 0.76)",
    ];

    for (let leaf = 0; leaf < 18; leaf += 1) {
      const baseX = 118 + (hash2(leaf, 3.2) - 0.5) * 52;
      const tipX = 18 + hash2(leaf, 6.7) * 220;
      const tipY = 12 + hash2(leaf, 9.1) * 106;
      const width = 3.5 + hash2(leaf, 4.4) * 9.5;
      const bend = (hash2(leaf, 2.5) - 0.5) * 34;
      context.fillStyle = colors[leaf % colors.length];
      context.globalAlpha = 0.58 + hash2(leaf, 8.6) * 0.34;
      context.beginPath();
      context.moveTo(baseX - width, 188);
      context.bezierCurveTo(
        baseX - width * 0.8 + bend,
        128,
        lerp(baseX, tipX, 0.72) - width * 0.25,
        50,
        tipX,
        tipY,
      );
      context.bezierCurveTo(
        lerp(baseX, tipX, 0.7) + width * 0.45,
        58,
        baseX + width * 0.85 + bend,
        132,
        baseX + width,
        188,
      );
      context.closePath();
      context.fill();
    }

    for (let blade = 0; blade < 42; blade += 1) {
      const originX = 76 + hash2(blade, 3.2) * 108;
      const tipX = 14 + hash2(blade, 6.7) * 228;
      const tipY = 10 + hash2(blade, 9.1) * 108;
      context.strokeStyle = colors[(blade + 2) % colors.length];
      context.globalAlpha = 0.58 + hash2(blade, 1.8) * 0.36;
      context.lineWidth = 0.8 + hash2(blade, 4.8) * 2.1;
      context.beginPath();
      context.moveTo(originX, 188);
      context.quadraticCurveTo(
        lerp(originX, tipX, 0.45) + (hash2(blade, 2.5) - 0.5) * 20,
        94,
        tipX,
        tipY,
      );
      context.stroke();
    }

    const rootWash = context.createLinearGradient(0, 142, 0, 192);
    rootWash.addColorStop(0, "rgba(75, 92, 55, 0)");
    rootWash.addColorStop(1, "rgba(69, 79, 45, 0.24)");
    context.globalAlpha = 1;
    context.fillStyle = rootWash;
    context.fillRect(38, 142, 180, 50);

    grassTexture = new THREE.CanvasTexture(textureCanvas);
    grassTexture.colorSpace = THREE.SRGBColorSpace;
    grassTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  }

  const count = coarsePointer.matches ? 1150 : 2200;
  const geometry = createCrossedBrushGeometry(1.18, 0.94, sceneDetailAudit.grassPlanes);
  const grassMaterial = new THREE.MeshBasicMaterial({
    map: grassTexture,
    vertexColors: true,
    side: THREE.DoubleSide,
    alphaTest: 0.015,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, grassMaterial, count);
  const grassColors = [0xf3ecd5, 0xe2e6c7, 0xf0d9af, 0xd6e1c4, 0xe9d2a5];
  let placed = 0;
  for (let index = 0; index < count * 5 && placed < count; index += 1) {
    const x = -92 + hash2(index, 0.4) * 184;
    const z = 2 + hash2(index, 8.9) * 94;
    const riverDistance = riverDistanceAt(x, z);
    if (isOnVisibleWater(x, z, 1.8)) continue;
    const terrainHeight = heightAt(x, z);
    if (terrainHeight > 3.8 || riverDistance > 38) continue;
    const scale = 0.72 + hash2(index, 5.7) * 1.08;
    dummy.position.set(x, terrainHeight + 0.03, z);
    dummy.rotation.set(0, hash2(index, 6.1) * Math.PI * 2, 0);
    dummy.scale.set(
      0.88 + hash2(index, 2.8) * 0.5,
      scale,
      0.88 + hash2(index, 3.4) * 0.5,
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    color.setHex(grassColors[index % grassColors.length]);
    mesh.setColorAt(placed, color);
    placed += 1;
  }
  mesh.count = placed;
  sceneDetailAudit.grassInstances = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

function createCloudTexture() {
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = 320;
  cloudCanvas.height = 160;
  const context = cloudCanvas.getContext("2d");
  context.clearRect(0, 0, cloudCanvas.width, cloudCanvas.height);
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 24; index += 1) {
    const x = 26 + hash2(index, 2.8) * 268;
    const y = 48 + hash2(index, 6.4) * 62;
    const radius = 28 + hash2(index, 9.1) * 52;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(239, 232, 201, 0.4)");
    gradient.addColorStop(0.48, "rgba(220, 215, 183, 0.18)");
    gradient.addColorStop(1, "rgba(220, 215, 183, 0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture = new THREE.CanvasTexture(cloudCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMist() {
  const texture = createCloudTexture();
  for (let index = 0; index < 7; index += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: index % 3 === 0 ? 0xb9b28d : 0xa9ad8c,
        transparent: true,
        opacity: 0.045 + hash2(index, 4.7) * 0.035,
        depthWrite: false,
        fog: true,
      }),
    );
    const x = -86 + hash2(index, 7.1) * 172;
    const z = -72 + hash2(index, 1.8) * 104;
    sprite.position.set(x, 7 + hash2(index, 3.6) * 15, z);
    sprite.scale.set(28 + hash2(index, 2.4) * 36, 7 + hash2(index, 5.2) * 9, 1);
    sprite.userData.baseX = x;
    sprite.userData.phase = hash2(index, 9.8) * Math.PI * 2;
    sprite.userData.speed = 0.18 + hash2(index, 4.3) * 0.2;
    scene.add(sprite);
    driftClouds.push(sprite);
  }
}

function createBirds() {
  const positions = [];
  for (let bird = 0; bird < 12; bird += 1) {
    const x = -40 + bird * 7 + hash2(bird, 2.2) * 16;
    const y = 42 + hash2(bird, 4.2) * 16;
    const z = -72 - hash2(bird, 8.8) * 20;
    const span = 1.4 + hash2(bird, 7.7) * 1.2;
    positions.push(x - span, y, z, x, y + 0.35, z, x, y + 0.35, z, x + span, y, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const birds = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x23372f,
      transparent: true,
      opacity: 0.46,
      fog: false,
    }),
  );
  birds.name = "Painted distant birds";
  scene.add(birds);
}

function addLighting() {
  const hemisphere = new THREE.HemisphereLight(0xf2e5bd, 0x26392e, 1.35);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffedc2, 1.55);
  sun.position.set(-44, 78, 36);
  sun.castShadow = !coarsePointer.matches;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 220;
    sun.shadow.bias = -0.0004;
  }
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x9fb9a3, 0.38);
  fill.position.set(36, 24, -55);
  scene.add(fill);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, coarsePointer.matches ? 1.3 : 1.55);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

function updateTravel(dt) {
  if (!travel) return false;
  travel.elapsed += dt;
  const progress = clamp(travel.elapsed / travel.duration, 0, 1);
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) * 0.5;
  player.x = lerp(travel.fromX, travel.toX, eased);
  player.z = lerp(travel.fromZ, travel.toZ, eased);
  yaw = lerp(travel.fromYaw, travel.toYaw, eased);
  pitch = lerp(travel.fromPitch, travel.toPitch, eased);
  if (progress >= 1) travel = null;
  return true;
}

function updateMovement(dt) {
  if (!isLive || travel) return;
  const inputX = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0)
    - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0)
    + joystickInput.x;
  const inputForward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0)
    - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0)
    - joystickInput.y;
  const magnitude = Math.hypot(inputX, inputForward);
  isMoving = magnitude > 0.04;
  if (!isMoving) return;

  const normalizedX = magnitude > 1 ? inputX / magnitude : inputX;
  const normalizedForward = magnitude > 1 ? inputForward / magnitude : inputForward;
  const running = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const speed = running ? 11.2 : 5.6;
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const deltaX = (rightX * normalizedX + forwardX * normalizedForward) * speed * dt;
  const deltaZ = (rightZ * normalizedX + forwardZ * normalizedForward) * speed * dt;
  movePlayer(deltaX, deltaZ);
  walkCycle += dt * (running ? 12 : 8);
  markRoaming();
  setActiveSpot(nearestSpot());
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!reduceMotion.matches) elapsed += dt;

  const traveling = updateTravel(dt);
  updateMovement(dt);
  const bob = isMoving && !traveling && !reduceMotion.matches
    ? Math.sin(walkCycle) * 0.035 + Math.abs(Math.sin(walkCycle * 0.5)) * 0.025
    : 0;
  setCameraTransform(bob);
  camera.fov = damp(camera.fov, fov, 9, dt);
  camera.updateProjectionMatrix();

  if (waterMaterial) waterMaterial.uniforms.uTime.value = elapsed;

  windTrees.forEach((tree) => {
    tree.rotation.z = tree.userData.baseRotation
      + Math.sin(elapsed * 0.7 + tree.userData.phase) * 0.018;
  });
  driftClouds.forEach((cloud) => {
    cloud.position.x = cloud.userData.baseX
      + Math.sin(elapsed * cloud.userData.speed + cloud.userData.phase) * 2.8;
  });
  if (bridgePavilion) {
    bridgePavilion.rotation.z = Math.sin(elapsed * 0.45) * 0.0025;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function closeRouteMenu({ restoreFocus = false } = {}) {
  landmarks.classList.remove("is-open");
  body.classList.remove("routes-open");
  routeToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) routeToggle.focus({ preventScroll: true });
}

function openRouteMenu() {
  landmarks.classList.add("is-open");
  body.classList.add("routes-open");
  routeToggle.setAttribute("aria-expanded", "true");
}

function finishEntry() {
  if (isLive || body.dataset.ready !== "true") return;
  player.set(START.x, 0, START.z);
  yaw = START.yaw;
  pitch = START.pitch;
  fov = 61;
  travel = null;
  isMoving = false;
  keys.clear();
  joystickInput.x = 0;
  joystickInput.y = 0;
  setCameraTransform();
  setActiveSpot("valley");
  isLive = true;
  body.classList.add("is-live");
  body.dataset.entryPhase = "live";
  entry.classList.add("is-gone");
  body.classList.remove("is-roaming");
  setActiveSpot(currentSpot);
  setLoading("可行走");
  canvas.focus({ preventScroll: true });
}

window.addEventListener("keydown", (event) => {
  if (referenceDialog.open) return;
  const movementKeys = [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ];
  if (movementKeys.includes(event.code)) {
    keys.add(event.code);
    travel = null;
    markRoaming();
    event.preventDefault();
  }
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") keys.add(event.code);
  if (event.code === "KeyR") {
    resetPlayer();
    event.preventDefault();
  }
  if (event.code === "Escape" && landmarks.classList.contains("is-open")) {
    closeRouteMenu({ restoreFocus: true });
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

window.addEventListener("blur", () => {
  keys.clear();
  body.classList.remove("is-roaming");
  joystickInput.x = 0;
  joystickInput.y = 0;
  joystickKnob.style.transform = "translate(-50%, -50%)";
});

canvas.addEventListener("pointerdown", (event) => {
  if (!isLive || referenceDialog.open) return;
  dragPointerId = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  travel = null;
  canvas.setPointerCapture(event.pointerId);
  markRoaming();
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== dragPointerId) return;
  const deltaX = event.clientX - lastPointerX;
  const deltaY = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  yaw -= deltaX * 0.0042;
  pitch = clamp(pitch - deltaY * 0.0036, -1.18, 1.08);
  markRoaming();
});

function endDrag(event) {
  if (event.pointerId !== dragPointerId) return;
  dragPointerId = null;
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("lostpointercapture", () => {
  dragPointerId = null;
});

canvas.addEventListener(
  "wheel",
  (event) => {
    if (!isLive || referenceDialog.open) return;
    event.preventDefault();
    fov = clamp(fov + event.deltaY * 0.036, 43, 76);
    markRoaming();
    setLoading("移目");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (isLive) setLoading("可行走");
    }, 650);
  },
  { passive: false },
);

function updateJoystick(event) {
  const rect = joystick.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxDistance = rect.width * 0.31;
  let dx = event.clientX - centerX;
  let dy = event.clientY - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance > maxDistance) {
    dx = (dx / distance) * maxDistance;
    dy = (dy / distance) * maxDistance;
  }
  joystickInput.x = dx / maxDistance;
  joystickInput.y = dy / maxDistance;
  joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

joystick.addEventListener("pointerdown", (event) => {
  if (!isLive) return;
  joystickPointerId = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  travel = null;
  updateJoystick(event);
  markRoaming();
  event.preventDefault();
});

joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId !== joystickPointerId) return;
  updateJoystick(event);
  markRoaming();
  event.preventDefault();
});

function resetJoystick(event) {
  if (event.pointerId !== joystickPointerId) return;
  joystickPointerId = null;
  joystickInput.x = 0;
  joystickInput.y = 0;
  joystickKnob.style.transform = "translate(-50%, -50%)";
}

joystick.addEventListener("pointerup", resetJoystick);
joystick.addEventListener("pointercancel", resetJoystick);
joystick.addEventListener("lostpointercapture", () => {
  joystickPointerId = null;
  joystickInput.x = 0;
  joystickInput.y = 0;
  joystickKnob.style.transform = "translate(-50%, -50%)";
});

landmarks.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-spot]");
  if (!button) return;
  travelTo(button.dataset.spot);
  if (window.innerWidth <= 760) closeRouteMenu();
});

routeToggle.addEventListener("click", () => {
  if (landmarks.classList.contains("is-open")) {
    closeRouteMenu();
  } else {
    openRouteMenu();
  }
});

const referenceData = {
  start: {
    src: "./assets/qianli-world.jpg",
    alt: "《千里江山图》开卷题跋与初起群山",
    caption: "开卷以题跋、朱印与渐起的青绿群山揭幕，绢色与细密笔触清晰可见。",
  },
  bridge: {
    src: "./assets/qianli-bridge.jpg",
    alt: "《千里江山图》水岸与长桥段局部",
    caption: "山势沿水岸展开，长桥、村舍、松林与远岫在横向空间里逐层退远。",
  },
  end: {
    src: "./assets/qianli-start.jpg",
    alt: "《千里江山图》长卷局部与题跋",
    caption: "原画局部保留完整绢面、积染层次与时间留下的暖色。",
  },
};

function setDialogReference(key) {
  const reference = referenceData[key];
  if (!reference) return;
  dialogImage.src = reference.src;
  dialogImage.alt = reference.alt;
  dialogCaption.textContent = reference.caption;
  referenceDialog.querySelectorAll("[data-reference]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.reference === key));
  });
}

function openReferenceDialog() {
  setDialogReference("start");
  if (!referenceDialog.open) referenceDialog.showModal();
  referenceTrigger.setAttribute("aria-expanded", "true");
}

referenceTrigger.addEventListener("click", openReferenceDialog);
dialogClose.addEventListener("click", () => referenceDialog.close());
referenceDialog.addEventListener("close", () => {
  referenceTrigger.setAttribute("aria-expanded", "false");
});
referenceDialog.addEventListener("click", (event) => {
  if (event.target === referenceDialog) referenceDialog.close();
  const tab = event.target.closest("[data-reference]");
  if (tab) setDialogReference(tab.dataset.reference);
});

enterButton.addEventListener("click", finishEntry);
entry.addEventListener("click", finishEntry);
window.addEventListener("keydown", (event) => {
  if (!isLive && (event.code === "Enter" || event.code === "Space")) {
    finishEntry();
    event.preventDefault();
  }
});

async function boot() {
  body.dataset.ready = "false";
  body.dataset.renderer = "webgl";
  body.classList.remove("is-live", "is-opening", "is-roaming");
  setLoading("研墨");
  resize();

  try {
    addLighting();
    createTerrain();
    setLoading("叠嶂");
    createWater();
    createTrail();
    createBridge();
    createVillage();
    createPines();
    createRocks();
    createGrass();
    createMist();
    createBirds();
    await createPanorama();
    setCameraTransform();
    renderer.compile(scene, camera);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      body.dataset.renderer = "fallback";
      setLoading("画境暂歇");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      body.dataset.renderer = "webgl";
      setLoading("可行走");
    });
  } catch (error) {
    console.warn("Three-dimensional painting unavailable; using the original scan.", error);
    body.dataset.renderer = "fallback";
  }

  setActiveSpot("valley");
  routeReadout.textContent = "画中 · 入谷";
  body.dataset.ready = "true";
  enterButton.disabled = false;
  setLoading("展卷");
  clock.start();
  requestAnimationFrame(frame);

  window.setTimeout(() => body.classList.add("is-opening"), 60);
}

window.addEventListener("resize", resize);

window.__qianliDebug = {
  getState() {
    return {
      position: [player.x, getCameraGround() + EYE_HEIGHT, player.z],
      yaw,
      pitch,
      fov: camera.fov,
      ground: getCameraGround(),
      currentSpot,
      isLive,
      renderer: body.dataset.renderer,
      onBridge: isOnBridge(player.x, player.z),
    };
  },
  travelTo,
  resetPlayer,
  heightAt,
  setPose(pose = {}) {
    if (Number.isFinite(pose.x)) player.x = pose.x;
    if (Number.isFinite(pose.z)) player.z = pose.z;
    if (Number.isFinite(pose.yaw)) yaw = pose.yaw;
    if (Number.isFinite(pose.pitch)) pitch = pose.pitch;
    travel = null;
    setCameraTransform();
  },
  getBridgeSeam() {
    const sample = (x, z) => ({
      z,
      deck: bridgeDeckHeight(z),
      ground: groundHeightAt(x, z),
      terrain: heightAt(x, z),
    });
    return {
      insideBridge: sample(0, BRIDGE_HALF_Z - 0.02),
      bridgeEnd: sample(0, BRIDGE_HALF_Z),
      approachMiddle: sample(0, BRIDGE_HALF_Z + BRIDGE_APPROACH * 0.5),
      approachEnd: sample(0, BRIDGE_HALF_Z + BRIDGE_APPROACH),
      outerGround: sample(0, BRIDGE_HALF_Z + BRIDGE_APPROACH + 0.02),
    };
  },
  getLandPlacementAudit() {
    return {
      visibleWaterHalf: WATER_VISIBLE_HALF,
      placements: landPlacements,
      violations: landPlacements.filter(
        (placement) => placement.clearance <= 0,
      ),
    };
  },
  getSceneDetailAudit() {
    return {
      ...sceneDetailAudit,
      pineVariants: [...sceneDetailAudit.pineVariants].sort((first, second) => first - second),
    };
  },
};

boot().catch((error) => {
  console.error(error);
  body.dataset.renderer = "fallback";
  body.dataset.ready = "true";
  enterButton.disabled = false;
  setLoading("原画续卷");
});
