const canvas = document.querySelector("#scene");
const body = document.body;
const stage = document.querySelector("#painting-stage");
const fallbackImage = document.querySelector(".fallback-painting img");
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

const PAINTING_SOURCE = "./assets/qianli-world.jpg";
const PAINTING_ASPECT = 7438 / 1600;
const MIN_ZOOM = 1.08;
const MAX_ZOOM = 1.78;

const spots = {
  valley: {
    name: "入谷",
    index: 1,
    x: 0.31,
    y: 0.555,
    zoom: 1.2,
    message: "云山入怀",
  },
  pines: {
    name: "松风",
    index: 2,
    x: 0.43,
    y: 0.57,
    zoom: 1.34,
    message: "沿松风游卷",
  },
  village: {
    name: "山居",
    index: 3,
    x: 0.63,
    y: 0.575,
    zoom: 1.29,
    message: "行至水岸人家",
  },
  far: {
    name: "远岫",
    index: 4,
    x: 0.81,
    y: 0.56,
    zoom: 1.24,
    message: "远岫随水展开",
  },
};

const view = {
  x: spots.valley.x,
  y: spots.valley.y,
  zoom: spots.valley.zoom,
  targetX: spots.valley.x,
  targetY: spots.valley.y,
  targetZoom: spots.valley.zoom,
};

const keys = new Set();
const joystickInput = { x: 0, y: 0 };
let currentSpot = "valley";
let isLive = false;
let travel = null;
let toastTimer = 0;
let dragPointerId = null;
let lastPointerX = 0;
let lastPointerY = 0;
let joystickPointerId = null;
let renderer = null;
let elapsed = 0;
let lastFrameTime = performance.now();
let statusTimer = 0;
let roamingTimer = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, amount) => start + (end - start) * amount;
const damp = (start, end, lambda, dt) => lerp(start, end, 1 - Math.exp(-lambda * dt));
const easeInOutCubic = (value) =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;

function getSpans(zoom = view.zoom) {
  const viewportAspect = window.innerWidth / Math.max(window.innerHeight, 1);
  return {
    x: viewportAspect / PAINTING_ASPECT / zoom,
    y: 1 / zoom,
  };
}

function clampTargetView() {
  view.targetZoom = clamp(view.targetZoom, MIN_ZOOM, MAX_ZOOM);
  const spans = getSpans(view.targetZoom);
  view.targetX = clamp(view.targetX, spans.x / 2, 1 - spans.x / 2);
  view.targetY = clamp(view.targetY, spans.y / 2, 1 - spans.y / 2);
}

function setLoading(text) {
  loadingText.textContent = text;
  sceneStateText.textContent = text;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1500);
}

function markRoaming() {
  if (!isLive) return;
  body.classList.add("is-roaming");
  window.clearTimeout(roamingTimer);
  roamingTimer = window.setTimeout(() => body.classList.remove("is-roaming"), 4200);
}

function setActiveSpot(name) {
  const spot = spots[name];
  if (!spot) return;
  currentSpot = name;

  landmarks.querySelectorAll("button[data-spot]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.spot === name);
  });

  routeReadout.textContent = `卷中 · ${spot.name}`;
  progressIndex.textContent = `0${spot.index} / 04`;
  progressLabel.textContent = spot.name;
  progressFill.style.setProperty("--progress", `${0.12 + (spot.index - 1) * 0.29}`);

  if (isLive) {
    setLoading("游卷中");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (isLive) setLoading("可游卷");
    }, 900);
  }
}

function nearestSpot() {
  let nearest = "valley";
  let distance = Number.POSITIVE_INFINITY;
  Object.entries(spots).forEach(([name, spot]) => {
    const nextDistance = Math.abs(view.targetX - spot.x);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = name;
    }
  });
  return nearest;
}

function travelTo(name, announce = true) {
  const spot = spots[name];
  if (!spot || !isLive) return;

  travel = {
    elapsed: 0,
    duration: reduceMotion.matches ? 0.01 : 1.25,
    fromX: view.targetX,
    fromY: view.targetY,
    fromZoom: view.targetZoom,
    toX: spot.x,
    toY: spot.y,
    toZoom: spot.zoom,
  };

  setActiveSpot(name);
  markRoaming();
  if (announce) showToast(spot.message);
}

function resetView(announce = true) {
  travelTo("valley", false);
  if (announce && isLive) showToast("画卷归位");
}

function zoomAt(factor, screenX = 0.5, screenY = 0.5) {
  if (!isLive) return;
  travel = null;
  const oldZoom = view.targetZoom;
  const nextZoom = clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (Math.abs(nextZoom - oldZoom) < 0.0001) return;

  const oldSpan = getSpans(oldZoom);
  const nextSpan = getSpans(nextZoom);
  const uvX = view.targetX + (screenX - 0.5) * oldSpan.x;
  const uvY = view.targetY - (screenY - 0.5) * oldSpan.y;

  view.targetZoom = nextZoom;
  view.targetX = uvX - (screenX - 0.5) * nextSpan.x;
  view.targetY = uvY + (screenY - 0.5) * nextSpan.y;
  clampTargetView();
  markRoaming();
  setLoading("远近");
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    if (isLive) setLoading("可游卷");
  }, 700);
}

function finishEntry() {
  if (isLive) return;
  isLive = true;
  body.classList.add("is-live");
  body.dataset.entryPhase = "live";
  entry.classList.add("is-gone");
  body.classList.remove("is-roaming");
  setActiveSpot(currentSpot);
  setLoading("可游卷");
  canvas.focus({ preventScroll: true });
}

function updateFallback() {
  if (!fallbackImage) return;
  const baseWidth = Math.max(window.innerWidth, window.innerHeight * PAINTING_ASPECT);
  const baseHeight = baseWidth / PAINTING_ASPECT;
  const x = -(view.x - 0.5) * baseWidth * view.zoom;
  const y = -(view.y - 0.5) * baseHeight * view.zoom;
  stage.style.setProperty("--fallback-x", `${x}px`);
  stage.style.setProperty("--fallback-y", `${y}px`);
  stage.style.setProperty("--fallback-scale", String(view.zoom));
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${message}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertexSource = `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;

    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSource = `#version 300 es
    precision highp float;

    uniform sampler2D uPainting;
    uniform vec2 uResolution;
    uniform vec2 uCenter;
    uniform float uImageAspect;
    uniform float uZoom;
    uniform float uTime;
    uniform float uMotion;

    in vec2 vUv;
    out vec4 fragColor;

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
      for (int i = 0; i < 4; i++) {
        value += noise(point) * amplitude;
        point = point * 2.03 + vec2(13.7, 7.2);
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      float viewportAspect = uResolution.x / max(uResolution.y, 1.0);
      vec2 span = vec2(viewportAspect / uImageAspect, 1.0) / uZoom;
      vec2 uv = uCenter + (vUv - 0.5) * span;

      float breath = sin(vUv.y * 15.0 + uTime * 0.16 + vUv.x * 3.0);
      vec2 drift = vec2(
        sin(vUv.y * 24.0 - uTime * 0.08) + breath * 0.45,
        cos(vUv.x * 19.0 + uTime * 0.07)
      ) * 0.000075 * uMotion;
      uv += drift;
      uv = clamp(uv, vec2(0.0005), vec2(0.9995));

      vec3 color = texture(uPainting, uv).rgb;
      float luma = dot(color, vec3(0.299, 0.587, 0.114));

      color = mix(vec3(luma), color, 1.035);
      color = (color - 0.5) * 1.035 + 0.5;
      color = mix(color, color * vec3(1.02, 1.005, 0.97) + vec3(0.004, 0.003, 0.0), 0.18);

      float mist = smoothstep(
        0.46,
        0.78,
        fbm(vec2(vUv.x * 2.5 - uTime * 0.005, vUv.y * 4.2 + uTime * 0.003))
      );
      float lowerMist = smoothstep(0.36, 0.9, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
      color = mix(color, color * 0.86 + vec3(0.12, 0.105, 0.068), mist * lowerMist * 0.045 * uMotion);

      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * 0.2;
      color *= vignette;

      float grain = hash12(gl_FragCoord.xy + floor(uTime * 3.0)) - 0.5;
      color += grain * 0.012;
      color = clamp(color, 0.0, 1.0);

      fragColor = vec4(color, 1.0);
    }
  `;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${message}`);
  }
  return program;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load painting: ${source}`));
    image.src = source;
  });
}

async function createPaintingRenderer() {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("WebGL2 unavailable");

  const program = createProgram(gl);
  const vertexArray = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const positionLocation = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const image = await loadImage(PAINTING_SOURCE);
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (image.naturalWidth > maxTextureSize || image.naturalHeight > maxTextureSize) {
    throw new Error(
      `Painting texture ${image.naturalWidth}x${image.naturalHeight} exceeds WebGL limit ${maxTextureSize}`,
    );
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);

  return {
    gl,
    program,
    texture,
    uniforms: {
      painting: gl.getUniformLocation(program, "uPainting"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      center: gl.getUniformLocation(program, "uCenter"),
      imageAspect: gl.getUniformLocation(program, "uImageAspect"),
      zoom: gl.getUniformLocation(program, "uZoom"),
      time: gl.getUniformLocation(program, "uTime"),
      motion: gl.getUniformLocation(program, "uMotion"),
    },
  };
}

function resizeRenderer() {
  if (!renderer) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, coarsePointer.matches ? 1.35 : 1.65);
  const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
  const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    renderer.gl.viewport(0, 0, width, height);
  }
}

function render() {
  if (renderer) {
    const { gl, program, uniforms } = renderer;
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, renderer.texture);
    gl.uniform1i(uniforms.painting, 0);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.center, view.x, view.y);
    gl.uniform1f(uniforms.imageAspect, PAINTING_ASPECT);
    gl.uniform1f(uniforms.zoom, view.zoom);
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform1f(uniforms.motion, reduceMotion.matches ? 0 : 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  updateFallback();
}

function updateView(dt) {
  if (!isLive) return;

  if (travel) {
    travel.elapsed += dt;
    const progress = clamp(travel.elapsed / travel.duration, 0, 1);
    const eased = easeInOutCubic(progress);
    view.targetX = lerp(travel.fromX, travel.toX, eased);
    view.targetY = lerp(travel.fromY, travel.toY, eased);
    view.targetZoom = lerp(travel.fromZoom, travel.toZoom, eased);
    if (progress >= 1) travel = null;
  } else {
    const keyboardX = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0)
      - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const keyboardY = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0)
      - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
    const inputX = clamp(keyboardX + joystickInput.x, -1, 1);
    const inputY = clamp(keyboardY + joystickInput.y, -1, 1);
    if (Math.abs(inputX) > 0.01 || Math.abs(inputY) > 0.01) {
      const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 0.5 : 0.24) / view.zoom;
      view.targetX += inputX * speed * dt;
      view.targetY += inputY * speed * dt;
      clampTargetView();
      setActiveSpot(nearestSpot());
    }
  }

  view.x = damp(view.x, view.targetX, reduceMotion.matches ? 24 : 8.5, dt);
  view.y = damp(view.y, view.targetY, reduceMotion.matches ? 24 : 8.5, dt);
  view.zoom = damp(view.zoom, view.targetZoom, reduceMotion.matches ? 24 : 7.5, dt);
}

function frame(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  if (!reduceMotion.matches) elapsed += dt;

  updateView(dt);
  render();
  window.requestAnimationFrame(frame);
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

window.addEventListener("keydown", (event) => {
  if (referenceDialog.open) return;
  if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
    keys.add(event.code);
    travel = null;
    markRoaming();
    event.preventDefault();
  }
  if (event.code === "KeyR") {
    resetView();
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
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== dragPointerId) return;
  const deltaX = event.clientX - lastPointerX;
  const deltaY = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  const span = getSpans(view.targetZoom);
  view.targetX -= (deltaX / Math.max(window.innerWidth, 1)) * span.x * 1.15;
  view.targetY -= (deltaY / Math.max(window.innerHeight, 1)) * span.y * 1.15;
  clampTargetView();
  markRoaming();
  setActiveSpot(nearestSpot());
});

function endDrag(event) {
  if (event.pointerId !== dragPointerId) return;
  dragPointerId = null;
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener(
  "wheel",
  (event) => {
    if (!isLive || referenceDialog.open) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0012);
    zoomAt(factor, event.clientX / window.innerWidth, event.clientY / window.innerHeight);
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
    caption: "原画局部保留完整绢面、积染层次与时间留下的暖色，不经过三维重塑。",
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

async function boot() {
  body.dataset.ready = "false";
  body.dataset.renderer = "webgl";
  setLoading("研墨");

  try {
    renderer = await createPaintingRenderer();
    canvas.addEventListener("webglcontextlost", () => {
      body.dataset.renderer = "fallback";
      setLoading("原画续卷");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      body.dataset.renderer = "webgl";
    });
  } catch (error) {
    console.warn("WebGL painting renderer unavailable; using the original scan.", error);
    body.dataset.renderer = "fallback";
  }

  resizeRenderer();
  setActiveSpot("valley");
  render();
  body.dataset.ready = "true";
  setLoading("展卷");
  window.requestAnimationFrame((now) => {
    lastFrameTime = now;
    window.requestAnimationFrame(frame);
  });

  window.setTimeout(() => body.classList.add("is-opening"), 60);
  window.setTimeout(finishEntry, reduceMotion.matches ? 160 : 2450);
}

window.addEventListener("resize", () => {
  clampTargetView();
  resizeRenderer();
  render();
});

window.__qianliDebug = {
  getState() {
    return {
      x: view.x,
      y: view.y,
      zoom: view.zoom,
      targetX: view.targetX,
      targetY: view.targetY,
      targetZoom: view.targetZoom,
      currentSpot,
      isLive,
      renderer: body.dataset.renderer,
    };
  },
  travelTo,
  resetView,
};

boot().catch((error) => {
  console.error(error);
  body.dataset.renderer = "fallback";
  body.dataset.ready = "true";
  setLoading("原画续卷");
  finishEntry();
});
