"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require(
  "C:/Users/20989/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);

const root = path.resolve(__dirname, "..");
const evidenceDir = path.join(root, "evidence");
const port = 4193;
const baseUrl = `http://127.0.0.1:${port}`;
const nodeExecutable = process.execPath;
const browserCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

fs.mkdirSync(evidenceDir, { recursive: true });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(url, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(120);
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function evaluateCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#arenaCanvas");
    const context = canvas.getContext("2d");
    const sample = context.getImageData(
      0,
      0,
      Math.min(canvas.width, 480),
      Math.min(canvas.height, 270),
    ).data;
    let nonBlack = 0;
    let variation = 0;
    let checksum = 0;
    let previous = null;
    for (let index = 0; index < sample.length; index += 64) {
      const value = sample[index] + sample[index + 1] + sample[index + 2];
      if (value > 12) nonBlack += 1;
      if (previous !== null && Math.abs(value - previous) > 20) variation += 1;
      checksum = (checksum + value * ((index % 997) + 1)) % 1000000007;
      previous = value;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      nonBlack,
      variation,
      checksum,
    };
  });
}

async function main() {
  const serverLog = [];
  const server = spawn(nodeExecutable, [path.join(root, "server.js")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (data) => serverLog.push(data.toString()));
  server.stderr.on("data", (data) => serverLog.push(data.toString()));

  let browser = null;
  const result = {
    startedAt: new Date().toISOString(),
    viewport: null,
    checks: [],
    screenshots: [],
  };

  const check = (name, passed, detail = "") => {
    result.checks.push({ name, passed: Boolean(passed), detail });
    if (!passed) throw new Error(`${name}: ${detail}`);
  };

  try {
    await waitForServer(baseUrl);
    const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));
    if (!executablePath) {
      throw new Error("No compatible Chrome or Edge browser was found");
    }
    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
      executablePath,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
      deviceScaleFactor: 1,
    });
    result.viewport = { width: 1440, height: 1024 };

    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    check("page loads", response && response.status() === 200, `status=${response?.status()}`);
    check("page title", (await page.title()) === "战斗音频测试实验场", await page.title());

    const desktopLayout = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell").getBoundingClientRect();
      const workspace = document.querySelector(".workspace").getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        shellWidth: shell.width,
        workspaceWidth: workspace.width,
      };
    });
    check(
      "desktop has no horizontal overflow",
      desktopLayout.documentWidth <= desktopLayout.viewportWidth + 1,
      JSON.stringify(desktopLayout),
    );

    const canvasBefore = await evaluateCanvas(page);
    check("canvas is nonblank", canvasBefore.nonBlack > 200, JSON.stringify(canvasBefore));
    check("canvas has visual variation", canvasBefore.variation > 20, JSON.stringify(canvasBefore));

    const desktopScreenshot = path.join(evidenceDir, "desktop-dashboard.png");
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    result.screenshots.push(desktopScreenshot);

    await page.click("#startBtn");
    await page.waitForFunction(() => window.__AUDIO_LAB__.snapshot().started);
    check("audio session starts", (await page.evaluate(() => window.__AUDIO_LAB__.snapshot().started)));
    await delay(250);

    await page.keyboard.press("Space");
    await delay(120);
    let events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check("attack emits swing event", events.some((event) => event.name === "attack_swing"));
    check("attack emits impact event", events.some((event) => event.name === "impact_hit"));

    await page.click('[data-action="voice"]');
    await delay(100);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check("voice starts", events.some((event) => event.name === "voice_start"));
    check("voice ducks music", events.some((event) => event.name === "bgm_duck"));
    await delay(1450);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check("music restores after voice", events.some((event) => event.name === "bgm_restore"));
    check(
      "audio context is running",
      (await page.evaluate(() => window.__AUDIO_LAB__.snapshot().audioContextState)) === "running",
    );
    check(
      "active voice count is tracked",
      (await page.evaluate(() => window.__AUDIO_LAB__.snapshot().activeVoices)) >= 0,
    );

    await page.evaluate(() => {
      const input = document.querySelector("#masterVolume");
      input.value = "55";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const mixerSnapshot = await page.evaluate(() => window.__AUDIO_LAB__.snapshot());
    check(
      "mixer updates master gain",
      Math.abs(mixerSnapshot.gains.master - 0.55) < 0.001,
      JSON.stringify(mixerSnapshot.gains),
    );
    check(
      "mixer value is visible",
      (await page.locator("#masterVolumeValue").textContent()) === "55%",
    );

    await page.evaluate(() => window.__AUDIO_LAB__.setFault("latency", true));
    await page.evaluate(() => window.__AUDIO_LAB__.trigger("attack"));
    await delay(280);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check(
      "latency fault is observable",
      events.some((event) => event.name === "latency_fault_applied" && event.delay === 220),
    );

    await page.evaluate(() => window.__AUDIO_LAB__.setFault("latency", false));
    await page.evaluate(() => window.__AUDIO_LAB__.setFault("duplicate", true));
    await page.evaluate(() => window.__AUDIO_LAB__.trigger("attack"));
    await delay(100);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check(
      "duplicate fault produces extra hit",
      events.some((event) => event.name === "impact_hit_duplicate"),
    );

    await page.evaluate(() => window.__AUDIO_LAB__.setFault("panInvert", true));
    await page.evaluate(() => window.__AUDIO_LAB__.trigger("spatial-right"));
    await delay(80);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    const spatialEvent = [...events].reverse().find((event) => event.name === "enemy_proximity");
    check(
      "pan inversion changes applied pan",
      spatialEvent && spatialEvent.pan > 0 && spatialEvent.panApplied < 0,
      JSON.stringify(spatialEvent),
    );

    await page.evaluate(() => window.__AUDIO_LAB__.trigger("spatial-far"));
    await delay(80);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    const farSpatialEvent = [...events].reverse().find((event) => event.name === "enemy_proximity");
    check(
      "distance attenuation reduces gain",
      farSpatialEvent && farSpatialEvent.level < spatialEvent.level,
      JSON.stringify(farSpatialEvent),
    );

    await page.evaluate(() => window.__AUDIO_LAB__.setFault("panInvert", false));
    await page.evaluate(() => window.__AUDIO_LAB__.setFault("bgmGap", true));
    await page.evaluate(() => window.__AUDIO_LAB__.trigger("toggle-combat"));
    await delay(460);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check("combat BGM state changes", events.some((event) => event.name === "bgm_state_change"));
    check("BGM gap fault is observable", events.some((event) => event.name === "bgm_switch_gap"));

    const restoreCountBefore = events.filter((event) => event.name === "bgm_restore").length;
    await page.evaluate(() => window.__AUDIO_LAB__.setFault("duckStuck", true));
    await page.evaluate(() => window.__AUDIO_LAB__.trigger("voice"));
    await delay(1450);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    const restoreCountAfter = events.filter((event) => event.name === "bgm_restore").length;
    check(
      "duck-stuck fault blocks music restore",
      restoreCountAfter === restoreCountBefore &&
        events.some((event) => event.name === "duck_restore_missing"),
      `${restoreCountBefore}->${restoreCountAfter}`,
    );
    await page.evaluate(() => window.__AUDIO_LAB__.setFault("duckStuck", false));

    await page.evaluate(() => window.__AUDIO_LAB__.setFault("voiceLeak", true));
    await page.click("#muteBtn");
    await delay(100);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check("mute state is recorded", (await page.evaluate(() => window.__AUDIO_LAB__.snapshot().muted)));
    check(
      "voice leak fault is observable",
      events.some((event) => event.name === "voice_leak_fault_applied"),
    );
    await page.click("#muteBtn");
    check(
      "unmute restores mixer state",
      !(await page.evaluate(() => window.__AUDIO_LAB__.snapshot().muted)),
    );

    await page.evaluate(() => window.__AUDIO_LAB__.trigger("enemy-death"));
    await delay(80);
    events = await page.evaluate(() => window.__AUDIO_LAB__.events());
    check("enemy death emits audio event", events.some((event) => event.name === "enemy_death"));

    await page.evaluate(() => window.__AUDIO_LAB__.trigger("toggle-pause"));
    await delay(100);
    check("pause state is recorded", await page.evaluate(() => window.__AUDIO_LAB__.snapshot().paused));
    await page.evaluate(() => window.__AUDIO_LAB__.trigger("toggle-pause"));
    await delay(120);
    check(
      "resume state is recorded",
      !(await page.evaluate(() => window.__AUDIO_LAB__.snapshot().paused)),
    );

    const canvasAfter = await evaluateCanvas(page);
    check(
      "canvas remains rendered after interaction",
      canvasAfter.nonBlack > 200 && canvasAfter.variation > 20,
      JSON.stringify(canvasAfter),
    );
    check(
      "canvas animation changes between frames",
      canvasAfter.checksum !== canvasBefore.checksum,
      `${canvasBefore.checksum}->${canvasAfter.checksum}`,
    );

    const eventTrace = await page.evaluate(() => window.__AUDIO_LAB__.events());
    fs.writeFileSync(
      path.join(evidenceDir, "event-trace.json"),
      JSON.stringify(eventTrace, null, 2),
      "utf8",
    );
    check("event trace saved", eventTrace.length >= 10, `events=${eventTrace.length}`);
    check("event log renders rows", (await page.locator(".event-row").count()) > 0);
    const faultPanelScreenshot = path.join(evidenceDir, "fault-panel.png");
    await page.locator(".control-section").nth(1).screenshot({ path: faultPanelScreenshot });
    result.screenshots.push(faultPanelScreenshot);
    check("no browser console errors", consoleErrors.length === 0, consoleErrors.join("\n"));

    await page.setViewportSize({ width: 390, height: 844 });
    await delay(300);
    const mobileLayout = await page.evaluate(() => {
      const actionStrip = document.querySelector(".action-strip").getBoundingClientRect();
      const stage = document.querySelector(".stage-frame").getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll("button")).map((button) =>
        button.getBoundingClientRect(),
      );
      const overlapping = buttons.some((a, index) =>
        buttons.some(
          (b, otherIndex) =>
            index < otherIndex &&
            a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top,
        ),
      );
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        stageWidth: stage.width,
        actionWidth: actionStrip.width,
        overlapping,
      };
    });
    check(
      "mobile has no horizontal overflow",
      mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1,
      JSON.stringify(mobileLayout),
    );
    check("mobile stage fills available width", mobileLayout.stageWidth > 330);
    check("mobile controls do not overlap", !mobileLayout.overlapping, JSON.stringify(mobileLayout));

    const mobileScreenshot = path.join(evidenceDir, "mobile-dashboard.png");
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    result.screenshots.push(mobileScreenshot);

    await page.evaluate(() => window.__AUDIO_LAB__.reset());
    const resetSnapshot = await page.evaluate(() => window.__AUDIO_LAB__.snapshot());
    check("reset stops session", !resetSnapshot.started);
    check(
      "reset clears fault injection",
      Object.values(resetSnapshot.faults).every((enabled) => !enabled),
      JSON.stringify(resetSnapshot.faults),
    );
    fs.writeFileSync(
      path.join(evidenceDir, "reset-state.json"),
      JSON.stringify(resetSnapshot, null, 2),
      "utf8",
    );
    result.viewport = {
      desktop: { width: 1440, height: 1024 },
      mobile: { width: 390, height: 844 },
    };
    result.finishedAt = new Date().toISOString();
    result.passed = true;

    fs.writeFileSync(
      path.join(evidenceDir, "automation-result.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.finishedAt = new Date().toISOString();
    result.passed = false;
    result.error = error.message;
    result.serverLog = serverLog.join("");
    fs.writeFileSync(
      path.join(evidenceDir, "automation-result.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main();
