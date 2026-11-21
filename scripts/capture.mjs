import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  ({ chromium } = require(
    "../../rea-cli/node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core",
  ));
}

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sitePath = basename(projectDirectory) === "qianli-jiangshan"
  ? "/qianli-jiangshan/"
  : "/";
const executablePath = process.env.CHROME_PATH
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.env.QIANLI_URL ?? `http://127.0.0.1:4173${sitePath}`;
const outputDirectory = resolve(projectDirectory, "shots");
const observations = {};
const assertions = [];

function recordAssertion(name, passed, actual = undefined) {
  assertions.push({
    name,
    passed: Boolean(passed),
    ...(passed || actual === undefined ? {} : { actual }),
  });
}

function near(actual, expected, tolerance) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function rectInsideViewport(rect, viewport) {
  return Boolean(
    rect &&
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= viewport.width + 1 &&
      rect.bottom <= viewport.height + 1,
  );
}

function rectsOverlap(first, second) {
  if (!first || !second || first.width === 0 || second.width === 0) return false;
  return !(
    first.right <= second.left ||
    second.right <= first.left ||
    first.bottom <= second.top ||
    second.bottom <= first.top
  );
}

await mkdir(outputDirectory, { recursive: true });
let browser;

async function readState(page) {
  return page.evaluate(() => window.__qianliDebug?.getState() ?? null);
}

async function waitUntilLive(page) {
  await page.waitForFunction(
    () => document.body.dataset.ready === "true" && document.body.classList.contains("is-live"),
    null,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(1_250);
}

async function capture(name, viewport, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: options.isMobile ?? false,
    hasTouch: options.hasTouch ?? false,
  });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? "failed"})`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.url()} (HTTP ${response.status()})`);
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    () => document.body.dataset.ready === "true",
    null,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outputDirectory}/${name}-entry.png`, fullPage: false });

  const entryState = await readState(page);
  const entryVisible = await page.locator("#entry").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.visibility === "visible" && Number(style.opacity) > 0.9;
  });
  await page.locator("#enter-button").click();
  await waitUntilLive(page);
  const startState = await readState(page);
  await page.screenshot({ path: `${outputDirectory}/${name}.png`, fullPage: false });

  const interactions = {};

  if (name === "desktop") {
    const beforeKeyboard = await readState(page);
    await page.keyboard.down("w");
    await page.waitForTimeout(700);
    await page.keyboard.up("w");
    await page.waitForTimeout(900);
    const afterKeyboard = await readState(page);
    await page.screenshot({ path: `${outputDirectory}/desktop-moved.png`, fullPage: false });

    const beforeStrafe = await readState(page);
    await page.keyboard.down("d");
    await page.waitForTimeout(520);
    await page.keyboard.up("d");
    await page.waitForTimeout(180);
    const afterStrafe = await readState(page);

    const beforeRun = await readState(page);
    await page.keyboard.down("Shift");
    await page.keyboard.down("w");
    await page.waitForTimeout(520);
    await page.keyboard.up("w");
    await page.keyboard.up("Shift");
    await page.waitForTimeout(180);
    const afterRun = await readState(page);

    await page.mouse.move(viewport.width * 0.56, viewport.height * 0.46);
    await page.waitForTimeout(120);
    const beforeLook = await readState(page);
    await page.mouse.move(viewport.width * 0.62, viewport.height * 0.46);
    await page.mouse.move(viewport.width * 0.72, viewport.height * 0.5, { steps: 10 });
    await page.waitForTimeout(260);
    const afterLook = await readState(page);

    const beforeWheel = await readState(page);
    await page.mouse.move(viewport.width * 0.64, viewport.height * 0.48);
    await page.mouse.wheel(0, -460);
    await page.waitForTimeout(320);
    const afterWheel = await readState(page);

    await page.locator('button[data-spot="pines"]').click();
    await page.waitForTimeout(1450);
    const afterTravel = await readState(page);
    await page.screenshot({ path: `${outputDirectory}/desktop-pines.png`, fullPage: false });
    await page.evaluate(() => {
      window.__qianliDebug.setPose({ x: 35, z: 36, yaw: 0.48, pitch: -0.1 });
    });
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${outputDirectory}/desktop-riparian.png`, fullPage: false });
    await page.evaluate(() => {
      window.__qianliDebug.setPose({ x: 7.5, z: 31, yaw: 0.78, pitch: -0.12 });
    });
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${outputDirectory}/desktop-bridge-junction.png`, fullPage: false });
    const bridgeSeam = await page.evaluate(() => window.__qianliDebug.getBridgeSeam());
    const placementAudit = await page.evaluate(() => window.__qianliDebug.getLandPlacementAudit());
    const sceneDetailAudit = await page.evaluate(() => window.__qianliDebug.getSceneDetailAudit());
    const performanceAudit = await page.evaluate(() => window.__qianliDebug.getPerformanceAudit());

    await page.locator("#reference-trigger").click();
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${outputDirectory}/desktop-reference.png`, fullPage: false });
    await page.locator('[data-reference="bridge"]').click();
    await page.waitForTimeout(160);
    const bridgeReference = await page.locator("#dialog-image").getAttribute("src");
    const bridgeCaption = await page.locator("#dialog-caption").innerText();
    await page.locator("#dialog-close").click();

    interactions.keyboard = {
      before: beforeKeyboard,
      after: afterKeyboard,
      deltaX: Math.abs(afterKeyboard.position[0] - beforeKeyboard.position[0]),
      deltaZ: Math.abs(afterKeyboard.position[2] - beforeKeyboard.position[2]),
      moved: Math.hypot(
        afterKeyboard.position[0] - beforeKeyboard.position[0],
        afterKeyboard.position[2] - beforeKeyboard.position[2],
      ) > 0.2,
    };
    interactions.strafe = {
      deltaX: Math.abs(afterStrafe.position[0] - beforeStrafe.position[0]),
      deltaZ: Math.abs(afterStrafe.position[2] - beforeStrafe.position[2]),
      moved: Math.hypot(
        afterStrafe.position[0] - beforeStrafe.position[0],
        afterStrafe.position[2] - beforeStrafe.position[2],
      ) > 0.2,
    };
    interactions.run = {
      distance: Math.hypot(
        afterRun.position[0] - beforeRun.position[0],
        afterRun.position[2] - beforeRun.position[2],
      ),
      accelerated: Math.hypot(
        afterRun.position[0] - beforeRun.position[0],
        afterRun.position[2] - beforeRun.position[2],
      ) > 3.5,
    };
    interactions.look = {
      deltaYaw: Math.abs(afterLook.yaw - beforeLook.yaw),
      deltaPitch: Math.abs(afterLook.pitch - beforeLook.pitch),
      moved: Math.hypot(afterLook.yaw - beforeLook.yaw, afterLook.pitch - beforeLook.pitch) > 0.01,
    };
    interactions.wheel = {
      beforeFov: beforeWheel.fov,
      afterFov: afterWheel.fov,
      changed: Math.abs(afterWheel.fov - beforeWheel.fov) > 0.2,
    };
    interactions.travel = {
      position: afterTravel.position,
      currentSpot: afterTravel.currentSpot,
      activeButton: await page.locator("#landmarks button.is-active").getAttribute("data-spot"),
      readout: await page.locator("#route-readout").innerText(),
      reachedPines: Math.hypot(afterTravel.position[0] - 17, afterTravel.position[2] - 31) < 0.35,
    };
    interactions.dialog = {
      closed: await page.locator("#reference-dialog").evaluate((dialog) => !dialog.open),
      referenceChanged: bridgeReference?.includes("qianli-bridge.jpg") ?? false,
      captionChanged: bridgeCaption.includes("长桥"),
      bridgeSeam,
    };
    interactions.placement = {
      visibleWaterHalf: placementAudit.visibleWaterHalf,
      checked: placementAudit.placements.length,
      violations: placementAudit.violations,
      pines: placementAudit.placements
        .filter((placement) => placement.type === "pine")
        .map((placement) => [placement.x, placement.z, placement.clearance]),
      pavilions: placementAudit.placements
        .filter((placement) => placement.type === "pavilion")
        .map((placement) => [placement.x, placement.z, placement.clearance]),
    };
    interactions.sceneDetail = sceneDetailAudit;
    interactions.performance = performanceAudit;
  }

  if (name === "mobile") {
    await page.locator("#route-toggle").click();
    await page.waitForTimeout(220);
    await page.screenshot({ path: `${outputDirectory}/mobile-routes.png`, fullPage: false });
    const menuOpen = await page.locator("#landmarks").evaluate((menu) => menu.classList.contains("is-open"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const menuClosedByEscape = await page
      .locator("#landmarks")
      .evaluate((menu) => !menu.classList.contains("is-open"));

    await page.locator("#route-toggle").click();
    await page.locator('button[data-spot="village"]').click();
    await page.waitForTimeout(1450);
    const afterTravel = await readState(page);

    const joystickBox = await page.locator("#joystick").boundingBox();
    const beforeJoystick = await readState(page);
    await page.mouse.move(
      joystickBox.x + joystickBox.width / 2,
      joystickBox.y + joystickBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      joystickBox.x + joystickBox.width / 2 + 30,
      joystickBox.y + joystickBox.height / 2 - 18,
      { steps: 4 },
    );
    await page.waitForTimeout(760);
    const afterJoystick = await readState(page);
    await page.screenshot({ path: `${outputDirectory}/mobile-joystick.png`, fullPage: false });
    await page.mouse.up();

    interactions.menu = {
      opened: menuOpen,
      closedByEscape: menuClosedByEscape,
      closedAfterTravel: (await page.locator("#route-toggle").getAttribute("aria-expanded")) === "false",
    };
    interactions.travel = {
      currentSpot: afterTravel.currentSpot,
      position: afterTravel.position,
      reachedVillage: Math.hypot(afterTravel.position[0] + 24, afterTravel.position[2] - 27) < 0.35,
    };
    interactions.joystick = {
      deltaX: Math.abs(afterJoystick.position[0] - beforeJoystick.position[0]),
      deltaZ: Math.abs(afterJoystick.position[2] - beforeJoystick.position[2]),
      moved: Math.hypot(
        afterJoystick.position[0] - beforeJoystick.position[0],
        afterJoystick.position[2] - beforeJoystick.position[2],
      ) > 0.15,
    };
    interactions.performance = await page.evaluate(
      () => window.__qianliDebug.getPerformanceAudit(),
    );
  }

  observations[name] = await page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    const canvas = document.querySelector("#scene");
    const title = document.querySelector(".scene-copy");
    const joystick = document.querySelector("#joystick");
    const controls = document.querySelector(".controls");
    const h1 = document.querySelector("h1");
    return {
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      bodyReady: document.body.dataset.ready,
      bodyEntryPhase: document.body.dataset.entryPhase,
      renderer: document.body.dataset.renderer,
      state: window.__qianliDebug.getState(),
      canvas: {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        cssOpacity: getComputedStyle(canvas).opacity,
      },
      titleBox: rect(title),
      controlsBox: rect(controls),
      joystickBox: rect(joystick),
      routeMenu: {
        expanded: document.querySelector("#route-toggle")?.getAttribute("aria-expanded"),
        open: document.querySelector("#landmarks")?.classList.contains("is-open") ?? false,
        bodyClass: document.body.classList.contains("routes-open"),
      },
      sceneCopyOpacity: getComputedStyle(title).opacity,
      visibleImages: [...document.images]
        .filter((image) => image.getBoundingClientRect().width > 0)
        .map((image) => ({
          src: image.getAttribute("src"),
          loaded: image.complete && image.naturalWidth > 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
        })),
      h1: {
        text: h1?.innerText,
        fontSize: getComputedStyle(h1).fontSize,
      },
    };
  });
  observations[name].entryState = entryState;
  observations[name].entryVisible = entryVisible;
  observations[name].startState = startState;
  observations[name].interactions = interactions;
  observations[name].consoleErrors = errors;
  observations[name].failedRequests = failedRequests;
  await context.close();
}

function verifyObservations() {
  const expectedViewports = {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
  };

  for (const [name, expectedViewport] of Object.entries(expectedViewports)) {
    const view = observations[name];
    const prefix = `${name}.`;
    const visibleImages = view.visibleImages ?? [];

    recordAssertion(`${prefix}title`, view.title === "走进千里江山图", view.title);
    recordAssertion(
      `${prefix}viewport`,
      view.viewport.width === expectedViewport.width &&
        view.viewport.height === expectedViewport.height,
      view.viewport,
    );
    recordAssertion(`${prefix}scrollWidth`, !view.horizontalOverflow, view.scrollWidth);
    recordAssertion(`${prefix}ready`, view.bodyReady === "true", view.bodyReady);
    recordAssertion(`${prefix}entryPhase`, view.bodyEntryPhase === "live", view.bodyEntryPhase);
    recordAssertion(`${prefix}webgl`, view.renderer === "webgl", view.renderer);
    recordAssertion(`${prefix}stateLive`, view.state?.isLive === true);
    recordAssertion(`${prefix}entryNotLive`, view.entryState?.isLive === false);
    recordAssertion(`${prefix}entryVisible`, view.entryVisible === true);
    recordAssertion(`${prefix}startLive`, view.startState?.isLive === true);
    recordAssertion(
      `${prefix}startPosition`,
      near(view.startState?.position?.[0], 0, 0.35) &&
        near(view.startState?.position?.[2], 58, 0.35),
      view.startState?.position,
    );
    recordAssertion(
      `${prefix}canvasSize`,
      view.canvas?.clientWidth === expectedViewport.width &&
        view.canvas?.clientHeight === expectedViewport.height,
      view.canvas,
    );
    recordAssertion(`${prefix}canvasVisible`, Number(view.canvas?.cssOpacity) > 0.99);
    recordAssertion(
      `${prefix}imagesLoaded`,
      visibleImages.length > 0 && visibleImages.every((image) => image.loaded),
      visibleImages.filter((image) => !image.loaded),
    );
    recordAssertion(
      `${prefix}heading`,
      view.h1?.text?.includes("千里江山图") && Number.parseFloat(view.h1?.fontSize) >= 28,
      view.h1,
    );
    recordAssertion(`${prefix}consoleErrors`, view.consoleErrors.length === 0, view.consoleErrors);
    recordAssertion(
      `${prefix}failedRequests`,
      view.failedRequests.length === 0,
      view.failedRequests,
    );
    recordAssertion(`${prefix}titleInside`, rectInsideViewport(view.titleBox, view.viewport));
    recordAssertion(
      `${prefix}routeMenuClosed`,
      view.routeMenu?.expanded === "false" && view.routeMenu?.open === false,
      view.routeMenu,
    );

    if (name === "desktop") {
      recordAssertion(
        `${prefix}controlsInside`,
        rectInsideViewport(view.controlsBox, view.viewport) && view.controlsBox.width > 0,
        view.controlsBox,
      );
      recordAssertion(
        `${prefix}copyAvoidsControls`,
        !rectsOverlap(view.titleBox, view.controlsBox),
      );
    } else {
      recordAssertion(
        `${prefix}joystickInside`,
        rectInsideViewport(view.joystickBox, view.viewport) && view.joystickBox.width >= 88,
        view.joystickBox,
      );
      recordAssertion(
        `${prefix}copyAvoidsJoystick`,
        !rectsOverlap(view.titleBox, view.joystickBox),
      );
    }
  }

  const desktop = observations.desktop.interactions;
  recordAssertion("desktop.keyboard", desktop.keyboard?.moved === true);
  recordAssertion("desktop.strafe", desktop.strafe?.moved === true);
  recordAssertion("desktop.run", desktop.run?.accelerated === true, desktop.run);
  recordAssertion("desktop.lookByMouseMove", desktop.look?.moved === true, desktop.look);
  recordAssertion("desktop.wheel", desktop.wheel?.changed === true, desktop.wheel);
  recordAssertion(
    "desktop.travel",
    desktop.travel?.reachedPines === true &&
      desktop.travel?.currentSpot === "pines" &&
      desktop.travel?.activeButton === "pines" &&
      desktop.travel?.readout?.includes("松风"),
    desktop.travel,
  );
  recordAssertion(
    "desktop.referenceDialog",
    desktop.dialog?.closed === true &&
      desktop.dialog?.referenceChanged === true &&
      desktop.dialog?.captionChanged === true,
    {
      closed: desktop.dialog?.closed,
      referenceChanged: desktop.dialog?.referenceChanged,
      captionChanged: desktop.dialog?.captionChanged,
    },
  );

  const seam = desktop.dialog?.bridgeSeam;
  recordAssertion(
    "desktop.bridgeInsideDeck",
    near(seam?.insideBridge?.deck, seam?.insideBridge?.ground, 0.001),
    seam?.insideBridge,
  );
  recordAssertion(
    "desktop.bridgeEndDeck",
    near(seam?.bridgeEnd?.deck, seam?.bridgeEnd?.ground, 0.001),
    seam?.bridgeEnd,
  );
  recordAssertion(
    "desktop.bridgeApproach",
    near(seam?.approachEnd?.ground, seam?.approachEnd?.terrain, 0.03) &&
      near(seam?.outerGround?.ground, seam?.outerGround?.terrain, 0.001) &&
      Math.abs(seam?.approachEnd?.ground - seam?.outerGround?.ground) <= 0.05,
    {
      approachEnd: seam?.approachEnd,
      outerGround: seam?.outerGround,
    },
  );
  recordAssertion(
    "desktop.placementBoundary",
    desktop.placement?.visibleWaterHalf === 15.5 &&
      desktop.placement?.checked >= 20 &&
      desktop.placement?.violations?.length === 0,
    {
      visibleWaterHalf: desktop.placement?.visibleWaterHalf,
      checked: desktop.placement?.checked,
      violations: desktop.placement?.violations,
    },
  );
  const sceneDetail = desktop.sceneDetail;
  recordAssertion(
    "desktop.pineVolume",
    sceneDetail?.pineTrees >= 16 &&
      sceneDetail?.pineCanopyPlanes >= sceneDetail.pineTrees * 3 &&
      sceneDetail?.pineVariants?.length >= 4,
    {
      trees: sceneDetail?.pineTrees,
      canopyPlanes: sceneDetail?.pineCanopyPlanes,
      variants: sceneDetail?.pineVariants,
    },
  );
  recordAssertion(
    "desktop.grassBrushVolume",
    sceneDetail?.grassPlanes === 3 && sceneDetail?.grassInstances >= 900,
    {
      planes: sceneDetail?.grassPlanes,
      instances: sceneDetail?.grassInstances,
    },
  );
  recordAssertion(
    "desktop.grassGrounded",
    sceneDetail?.grassGrounded === true &&
      sceneDetail?.grassMaterial === "alpha-cutout" &&
      sceneDetail?.grassVertexColors === false &&
      sceneDetail?.grassBaseSink >= 0.05,
    {
      grounded: sceneDetail?.grassGrounded,
      material: sceneDetail?.grassMaterial,
      vertexColors: sceneDetail?.grassVertexColors,
      baseSink: sceneDetail?.grassBaseSink,
    },
  );
  recordAssertion(
    "desktop.terrainBaked",
    sceneDetail?.terrainMaterial === "baked-vertex-color",
    sceneDetail?.terrainMaterial,
  );
  recordAssertion(
    "desktop.panoramaDepth",
    sceneDetail?.panoramaLayers === 2 && sceneDetail?.panoramaVeil === true,
    {
      layers: sceneDetail?.panoramaLayers,
      veil: sceneDetail?.panoramaVeil,
    },
  );
  const desktopPerformance = desktop.performance;
  recordAssertion(
    "desktop.performanceBudget",
    desktopPerformance?.fps >= 28 &&
      desktopPerformance?.pixelRatio <= 1.2 &&
      desktopPerformance?.shadowAutoUpdate === false &&
      desktopPerformance?.drawCalls <= 320,
    desktopPerformance,
  );

  const mobile = observations.mobile.interactions;
  recordAssertion(
    "mobile.menu",
    mobile.menu?.opened === true &&
      mobile.menu?.closedByEscape === true &&
      mobile.menu?.closedAfterTravel === true,
    mobile.menu,
  );
  recordAssertion(
    "mobile.travel",
    mobile.travel?.reachedVillage === true && mobile.travel?.currentSpot === "village",
    mobile.travel,
  );
  recordAssertion("mobile.joystick", mobile.joystick?.moved === true, mobile.joystick);
  recordAssertion(
    "mobile.performanceBudget",
    mobile.performance?.fps >= 24 &&
      mobile.performance?.pixelRatio <= 1 &&
      mobile.performance?.shadowAutoUpdate === false,
    mobile.performance,
  );

  const failures = assertions.filter((assertion) => !assertion.passed);
  return {
    passed: failures.length === 0,
    assertionCount: assertions.length,
    failedCount: failures.length,
    assertions,
  };
}

try {
  browser = await chromium.launch({ executablePath, headless: true });
  await capture("desktop", { width: 1440, height: 900 });
  await capture("mobile", { width: 390, height: 844 }, { isMobile: true, hasTouch: true });

  const verification = verifyObservations();
  await writeFile(
    `${outputDirectory}/qa.json`,
    `${JSON.stringify({ ...observations, verification }, null, 2)}\n`,
    "utf8",
  );

  if (verification.passed) {
    console.log(`[QA] 通过：${verification.assertionCount} 项断言全部成功。`);
  } else {
    for (const failure of verification.assertions.filter((assertion) => !assertion.passed)) {
      console.error(`[QA] 失败：${failure.name} ${JSON.stringify(failure.actual)}`);
    }
    console.error(
      `[QA] 失败：${verification.failedCount}/${verification.assertionCount} 项断言未通过。`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[QA] 执行失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
