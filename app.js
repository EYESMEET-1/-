"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const canvas = $("#arenaCanvas");
const ctx = canvas.getContext("2d");
const runtimeStatus = $("#runtimeStatus");
const runtimeStatusText = $("#runtimeStatusText");
const startBtn = $("#startBtn");
const resetBtn = $("#resetBtn");
const combatToggleBtn = $("#combatToggleBtn");
const muteBtn = $("#muteBtn");
const sceneStateLabel = $("#sceneStateLabel");
const sceneMode = $("#sceneMode");
const sceneClock = $("#sceneClock");
const stageCoordinate = $("#stageCoordinate");
const bgmState = $("#bgmState");
const activeVoices = $("#activeVoices");
const peakLevel = $("#peakLevel");
const eventCount = $("#eventCount");
const eventLog = $("#eventLog");
const faultCount = $("#faultCount");
const exportBtn = $("#exportBtn");
const clearLogBtn = $("#clearLogBtn");
const toast = $("#toast");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const pad = (value, size = 2) => String(value).padStart(size, "0");

class AudioLab {
  constructor() {
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.voiceBus = null;
    this.analyser = null;
    this.musicState = "explore";
    this.musicSequence = null;
    this.musicStep = 0;
    this.events = [];
    this.started = false;
    this.muted = false;
    this.paused = false;
    this.faults = {
      latency: false,
      duplicate: false,
      bgmGap: false,
      duckStuck: false,
      panInvert: false,
      voiceLeak: false,
    };
    this.voiceGain = 1;
    this.musicGain = 0.42;
    this.sfxGain = 0.75;
    this.masterGain = 0.78;
    this.voiceBusGain = 0.68;
    this.activeVoiceCount = 0;
    this.duckTimer = null;
    this.lastEventAt = 0;
    this.sessionStart = performance.now();
    this.peak = 0;
  }

  async start() {
    if (this.started) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.musicBus = this.context.createGain();
    this.sfxBus = this.context.createGain();
    this.voiceBus = this.context.createGain();
    this.analyser = this.context.createAnalyser();

    this.master.gain.value = this.masterGain;
    this.musicBus.gain.value = this.musicGain;
    this.sfxBus.gain.value = this.sfxGain;
    this.voiceBus.gain.value = this.voiceBusGain;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.voiceBus.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.analyser.fftSize = 256;

    await this.context.resume();
    this.started = true;
    this.sessionStart = performance.now();
    this.logEvent("session_start", "SYSTEM", 0.78, null, "info");
    this.startMusic("explore");
    this.startMeter();
  }

  startMusic(nextState, delay = 0) {
    if (!this.started) return;
    const previousState = this.musicState;
    this.musicState = nextState;
    bgmState.textContent = nextState.toUpperCase();
    sceneMode.textContent = nextState === "combat" ? "COMBAT" : "EXPLORE";
    sceneStateLabel.textContent = nextState === "combat" ? "战斗状态" : "探索状态";
    combatToggleBtn.textContent = nextState === "combat" ? "退出战斗" : "进入战斗";

    if (previousState !== nextState) {
      clearInterval(this.musicSequence);
      if (delay > 0) {
        this.logEvent("bgm_switch_gap", "FAULT", 0, null, "fault", {
          from: previousState,
          to: nextState,
          delay,
        });
        this.musicBus.gain.setValueAtTime(0.0001, this.context.currentTime);
        window.setTimeout(() => {
          if (!this.started) return;
          this.musicBus.gain.cancelScheduledValues(this.context.currentTime);
          this.musicBus.gain.setTargetAtTime(
            this.musicGain,
            this.context.currentTime,
            0.04,
          );
          this.logEvent("bgm_state_change", "MUSIC", 0, 0, "fault", {
            from: previousState,
            to: nextState,
            recoveredAfterGap: true,
          });
          this.beginMusicLoop(nextState);
        }, delay);
        return;
      }

      this.musicBus.gain.cancelScheduledValues(this.context.currentTime);
      this.musicBus.gain.setTargetAtTime(
        this.musicGain,
        this.context.currentTime,
        0.06,
      );
      this.logEvent("bgm_state_change", "MUSIC", 0, null, "info", {
        from: previousState,
        to: nextState,
      });
    }

    this.beginMusicLoop(nextState);
  }

  beginMusicLoop(state) {
    this.musicStep = 0;
    const phrases = {
      explore: [220, 277.18, 329.63, 277.18, 246.94, 329.63, 369.99, 329.63],
      combat: [110, 146.83, 220, 293.66, 110, 164.81, 246.94, 329.63],
    };
    const phrase = phrases[state] || phrases.explore;
    const interval = state === "combat" ? 210 : 430;

    const tick = () => {
      if (!this.started || this.paused) return;
      const frequency = phrase[this.musicStep % phrase.length];
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const pan = this.context.createStereoPanner();
      oscillator.type = state === "combat" ? "sawtooth" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
      gain.gain.setValueAtTime(0.0001, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        state === "combat" ? 0.035 : 0.045,
        this.context.currentTime + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        this.context.currentTime + (state === "combat" ? 0.19 : 0.38),
      );
      pan.pan.value = state === "combat" ? (this.musicStep % 2 === 0 ? -0.16 : 0.16) : 0;
      oscillator.connect(gain);
      gain.connect(pan);
      pan.connect(this.musicBus);
      oscillator.start();
      oscillator.stop(this.context.currentTime + (state === "combat" ? 0.22 : 0.42));
      this.musicStep += 1;
    };

    tick();
    this.musicSequence = window.setInterval(tick, interval);
  }

  startMeter() {
    const data = new Uint8Array(this.analyser.fftSize);
    const loop = () => {
      if (!this.started) return;
      this.analyser.getByteTimeDomainData(data);
      let max = 0;
      for (const value of data) {
        max = Math.max(max, Math.abs((value - 128) / 128));
      }
      this.peak = lerp(this.peak, max, 0.16);
      const dbfs = this.peak > 0.0001 ? 20 * Math.log10(this.peak) : -Infinity;
      peakLevel.textContent = Number.isFinite(dbfs) ? `${dbfs.toFixed(1)} dB` : "-INF dB";
      activeVoices.textContent = String(this.activeVoiceCount);
      window.requestAnimationFrame(loop);
    };
    loop();
  }

  noiseBuffer(duration = 0.2) {
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  connectPanner(node, pan) {
    const panner = this.context.createStereoPanner();
    panner.pan.value = this.faults.panInvert ? -pan : pan;
    node.connect(panner);
    return panner;
  }

  trackVoice(oscillator, duration) {
    this.activeVoiceCount += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.activeVoiceCount = Math.max(0, this.activeVoiceCount - 1);
    };
    oscillator.onended = release;
    window.setTimeout(() => {
      release();
    }, Math.ceil(duration * 1000) + 80);
  }

  playTone({
    frequency = 440,
    endFrequency = frequency,
    duration = 0.15,
    type = "sine",
    gain = 0.08,
    pan = 0,
    bus = "sfx",
    eventName = "tone",
    delay = 0,
    fault = null,
  }) {
    if (!this.started || this.paused) return;
    window.setTimeout(() => {
      if (!this.started || this.paused) return;
      const oscillator = this.context.createOscillator();
      const gainNode = this.context.createGain();
      const targetBus = this[`${bus}Bus`] || this.sfxBus;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, endFrequency),
        this.context.currentTime + duration,
      );
      gainNode.gain.setValueAtTime(0.0001, this.context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        gain,
        this.context.currentTime + 0.012,
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        this.context.currentTime + duration,
      );
      oscillator.connect(gainNode);
      const panner = this.connectPanner(gainNode, pan);
      panner.connect(targetBus);
      this.trackVoice(oscillator, duration + 0.02);
      oscillator.start();
      oscillator.stop(this.context.currentTime + duration + 0.02);
      this.logEvent(eventName, bus.toUpperCase(), gain, pan, fault ? "fault" : "info", {
        delay,
        panApplied: this.faults.panInvert ? -pan : pan,
      });
      if (fault) this.logEvent(fault, "FAULT", gain, pan, "fault", { delay });
    }, delay);
  }

  playNoise({
    duration = 0.12,
    gain = 0.05,
    pan = 0,
    filterFrequency = 1200,
    eventName = "noise",
    delay = 0,
  }) {
    if (!this.started || this.paused) return;
    window.setTimeout(() => {
      if (!this.started || this.paused) return;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gainNode = this.context.createGain();
      source.buffer = this.noiseBuffer(duration);
      filter.type = "lowpass";
      filter.frequency.value = filterFrequency;
      gainNode.gain.setValueAtTime(gain, this.context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        this.context.currentTime + duration,
      );
      source.connect(filter);
      filter.connect(gainNode);
      const panner = this.connectPanner(gainNode, pan);
      panner.connect(this.sfxBus);
      source.start();
      source.stop(this.context.currentTime + duration);
      this.logEvent(eventName, "SFX", gain, pan, "info", { delay });
    }, delay);
  }

  async attack(pan = 0, options = {}) {
    if (!this.started) return;
    const latency = this.faults.latency && !options.baseline ? 220 : 0;
    this.playNoise({
      duration: 0.09,
      gain: 0.035,
      pan,
      filterFrequency: 1700,
      eventName: "attack_swing",
      delay: 0,
    });
    this.playTone({
      frequency: 160,
      endFrequency: 78,
      duration: 0.13,
      type: "triangle",
      gain: 0.1,
      pan,
      eventName: "impact_hit",
      delay: latency,
      fault: latency ? "latency_fault_applied" : null,
    });
    if (this.faults.duplicate && !options.baseline) {
      this.playTone({
        frequency: 168,
        endFrequency: 72,
        duration: 0.12,
        type: "square",
        gain: 0.055,
        pan,
        eventName: "impact_hit_duplicate",
        delay: latency + 18,
        fault: "duplicate_fault_applied",
      });
    }
  }

  skill(pan = 0) {
    this.playTone({
      frequency: 240,
      endFrequency: 860,
      duration: 0.38,
      type: "sawtooth",
      gain: 0.055,
      pan,
      eventName: "skill_cast",
    });
    this.playTone({
      frequency: 880,
      endFrequency: 160,
      duration: 0.5,
      type: "triangle",
      gain: 0.07,
      pan,
      eventName: "skill_impact",
      delay: 120,
    });
  }

  voice(pan = 0) {
    if (!this.started || this.paused) return;
    if (this.duckTimer) window.clearTimeout(this.duckTimer);
    this.logEvent("voice_start", "VOICE", 0.08, pan, "info");
    this.musicBus.gain.cancelScheduledValues(this.context.currentTime);
    this.musicBus.gain.setTargetAtTime(
      this.musicGain * 0.34,
      this.context.currentTime,
      0.035,
    );
    this.logEvent("bgm_duck", "MIX", -0.32, pan, "info", { target: "-6 dB" });
    this.playTone({
      frequency: 196,
      endFrequency: 132,
      duration: 0.65,
      type: "triangle",
      gain: 0.08,
      pan,
      bus: "voice",
      eventName: "voice_phrase",
    });
    this.playNoise({
      duration: 0.6,
      gain: 0.018,
      pan,
      filterFrequency: 900,
      eventName: "voice_breath",
      delay: 40,
    });
    this.duckTimer = window.setTimeout(() => {
      if (this.faults.duckStuck) {
        this.logEvent("duck_restore_missing", "FAULT", -0.32, pan, "fault");
        return;
      }
      this.musicBus.gain.setTargetAtTime(
        this.musicGain,
        this.context.currentTime,
        0.04,
      );
      this.logEvent("bgm_restore", "MIX", 0, pan, "info");
    }, 1350);
  }

  footstep(pan = 0) {
    this.playTone({
      frequency: 90,
      endFrequency: 62,
      duration: 0.07,
      type: "triangle",
      gain: 0.025,
      pan,
      eventName: "footstep",
    });
  }

  enemyPulse(pan = 0, distance = 0) {
    const gain = clamp(0.03 - distance * 0.02, 0.008, 0.03);
    this.playTone({
      frequency: 330,
      endFrequency: 290,
      duration: 0.16,
      type: "sine",
      gain,
      pan,
      eventName: "enemy_proximity",
    });
  }

  setMusicVolume(value) {
    this.musicGain = value / 100;
    if (this.context && !this.muted) {
      this.musicBus.gain.setTargetAtTime(this.musicGain, this.context.currentTime, 0.03);
    }
  }

  setSfxVolume(value) {
    this.sfxGain = value / 100;
    if (this.context) {
      this.sfxBus.gain.setTargetAtTime(this.sfxGain, this.context.currentTime, 0.03);
    }
  }

  setVoiceVolume(value) {
    this.voiceBusGain = value / 100;
    if (this.context) {
      this.voiceBus.gain.setTargetAtTime(this.voiceBusGain, this.context.currentTime, 0.03);
    }
  }

  setMasterVolume(value) {
    this.masterGain = value / 100;
    if (this.context && !this.muted) {
      this.master.gain.setTargetAtTime(this.masterGain, this.context.currentTime, 0.03);
    }
  }

  setMuted(nextMuted) {
    this.muted = nextMuted;
    if (!this.context) return;
    if (this.faults.voiceLeak && this.muted) {
      this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.02);
      this.voiceBus.gain.setTargetAtTime(this.voiceBusGain, this.context.currentTime, 0.02);
      this.logEvent("voice_leak_fault_applied", "FAULT", this.voiceBusGain, 0, "fault");
    } else {
      this.master.gain.setTargetAtTime(
        this.muted ? 0.0001 : this.masterGain,
        this.context.currentTime,
        0.02,
      );
    }
    this.logEvent(
      this.muted ? "master_mute" : "master_unmute",
      "SYSTEM",
      this.muted ? 0 : this.masterGain,
      0,
      "info",
    );
  }

  togglePause() {
    this.paused = !this.paused;
    if (!this.context) return;
    if (this.paused) {
      this.context.suspend();
      this.logEvent("audio_suspend", "SYSTEM", 0, 0, "info");
    } else {
      this.context.resume();
      this.logEvent("audio_resume", "SYSTEM", 0, 0, "info");
    }
  }

  setFault(name, enabled) {
    if (!(name in this.faults)) return;
    this.faults[name] = enabled;
    this.logEvent(
      enabled ? "fault_enabled" : "fault_disabled",
      "FAULT",
      0,
      0,
      enabled ? "fault" : "info",
      { fault: name },
    );
  }

  logEvent(name, bus, level = 0, pan = 0, status = "info", meta = {}) {
    const now = performance.now();
    const event = {
      id: this.events.length + 1,
      t: Number(now.toFixed(3)),
      relativeT: Number((now - this.sessionStart).toFixed(3)),
      name,
      bus,
      level: Number(Number(level || 0).toFixed(4)),
      pan: Number(Number(pan || 0).toFixed(4)),
      status,
      ...meta,
    };
    this.events.push(event);
    this.lastEventAt = now;
    eventCount.textContent = String(this.events.length);
    renderEvents();
  }

  reset() {
    clearInterval(this.musicSequence);
    this.events = [];
    this.activeVoiceCount = 0;
    if (this.context) {
      this.musicBus.gain.cancelScheduledValues(this.context.currentTime);
      this.sfxBus.gain.cancelScheduledValues(this.context.currentTime);
      this.voiceBus.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.musicBus.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.02);
      this.sfxBus.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.02);
      this.voiceBus.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.02);
    }
    this.started = false;
    this.paused = false;
    this.muted = false;
    this.musicState = "explore";
    this.faults = Object.fromEntries(Object.keys(this.faults).map((key) => [key, false]));
    this.sessionStart = performance.now();
    this.musicGain = 0.42;
    this.sfxGain = 0.75;
    this.voiceBusGain = 0.68;
    this.masterGain = 0.78;
    this.peak = 0;
    eventLog.innerHTML = '<div class="event-empty">尚无音频事件</div>';
    eventCount.textContent = "0";
    activeVoices.textContent = "0";
    peakLevel.textContent = "-INF dB";
    bgmState.textContent = "EXPLORE";
    sceneMode.textContent = "EXPLORE";
    sceneStateLabel.textContent = "探索状态";
    combatToggleBtn.textContent = "进入战斗";
    $$(".fault-item input").forEach((input) => {
      input.checked = false;
    });
    faultCount.textContent = "0 ACTIVE";
    runtimeStatus.dataset.state = "idle";
    runtimeStatusText.textContent = "等待启动";
    muteBtn.setAttribute("aria-pressed", "false");
    muteBtn.textContent = "静音";
    clearTimeout(this.duckTimer);
  }

  getSnapshot() {
    return {
      started: this.started,
      paused: this.paused,
      muted: this.muted,
      musicState: this.musicState,
      faults: { ...this.faults },
      activeVoices: this.activeVoiceCount,
      eventCount: this.events.length,
      peak: Number(this.peak.toFixed(4)),
      gains: {
        master: this.masterGain,
        music: this.musicGain,
        sfx: this.sfxGain,
        voice: this.voiceBusGain,
      },
      audioContextState: this.context?.state || "closed",
    };
  }
}

function renderEvents() {
  const recent = lab.events.slice(-11).reverse();
  if (recent.length === 0) {
    eventLog.innerHTML = '<div class="event-empty">尚无音频事件</div>';
    return;
  }
  eventLog.innerHTML = recent
    .map((event) => {
      const faultClass = event.status === "fault" ? " is-fault" : "";
      return `
        <div class="event-row${faultClass}" data-bus="${escapeHtml(event.bus)}">
          <span class="event-time">${formatTime(event.relativeT)}</span>
          <span class="event-bus">${escapeHtml(event.bus)}</span>
          <span class="event-name" title="${escapeHtml(event.name)}">${escapeHtml(event.name)}</span>
          <span class="event-level">${event.level > 0 ? event.level.toFixed(2) : "--"}</span>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(milliseconds) {
  const safe = Math.max(0, milliseconds);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = Math.floor(safe % 1000);
  return `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1800);
}

const lab = new AudioLab();

const game = {
  width: 1280,
  height: 720,
  player: { x: 340, y: 430, targetX: 340, targetY: 430, facing: 1 },
  enemy: { x: 890, y: 330, hp: 100, maxHp: 100, phase: 0, alive: true, flash: 0 },
  particles: [],
  rings: [],
  keys: new Set(),
  lastFrame: performance.now(),
  lastFootstep: 0,
  lastEnemyPulse: 0,
  attackCooldown: 0,
  skillCooldown: 0,
  startedAt: performance.now(),
  moving: false,
};

function setCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeCanvas() {
  setCanvasSize();
  const scaleX = canvas.clientWidth / game.width;
  const scaleY = canvas.clientHeight / game.height;
  game.scaleX = scaleX;
  game.scaleY = scaleY;
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * game.width,
    y: ((event.clientY - rect.top) / rect.height) * game.height,
  };
}

function resetGame() {
  game.player.x = 340;
  game.player.y = 430;
  game.player.targetX = game.player.x;
  game.player.targetY = game.player.y;
  game.enemy.x = 890;
  game.enemy.y = 330;
  game.enemy.hp = game.enemy.maxHp;
  game.enemy.alive = true;
  game.enemy.flash = 0;
  game.particles = [];
  game.rings = [];
  game.startedAt = performance.now();
}

function enemyPan() {
  return clamp((game.enemy.x - game.player.x) / 520, -0.92, 0.92);
}

function enemyDistance() {
  return Math.hypot(game.enemy.x - game.player.x, game.enemy.y - game.player.y);
}

function spawnParticles(x, y, color, count = 14) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 55 + Math.random() * 180;
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.35 + Math.random() * 0.35,
      maxLife: 0.7,
      color,
      size: 1.5 + Math.random() * 2.5,
    });
  }
}

function performAttack() {
  if (performance.now() < game.attackCooldown) return;
  game.attackCooldown = performance.now() + 225;
  const pan = enemyPan();
  const distance = enemyDistance();
  lab.attack(pan);
  game.rings.push({
    x: game.player.x,
    y: game.player.y,
    radius: 35,
    life: 0.32,
    maxLife: 0.32,
    color: "#ff995f",
  });
  if (distance < 390) {
    game.enemy.hp = Math.max(0, game.enemy.hp - 18);
    game.enemy.flash = 1;
    spawnParticles(game.enemy.x, game.enemy.y, "#ff995f", 16);
    if (game.enemy.hp <= 0) {
      lab.playTone({
        frequency: 220,
        endFrequency: 55,
        duration: 0.65,
        type: "sawtooth",
        gain: 0.08,
        pan,
        eventName: "enemy_death",
      });
      game.enemy.alive = false;
      window.setTimeout(() => {
        game.enemy.hp = game.enemy.maxHp;
        game.enemy.alive = true;
        game.enemy.flash = 0;
        lab.logEvent("enemy_respawn", "SYSTEM", 0, 0, "info");
      }, 1200);
    }
  }
}

function playEnemyDeath(pan) {
  lab.playTone({
    frequency: 220,
    endFrequency: 55,
    duration: 0.65,
    type: "sawtooth",
    gain: 0.08,
    pan,
    eventName: "enemy_death",
  });
}

function performSkill() {
  if (performance.now() < game.skillCooldown) return;
  game.skillCooldown = performance.now() + 700;
  const pan = enemyPan();
  lab.skill(pan);
  game.rings.push({
    x: game.player.x,
    y: game.player.y,
    radius: 20,
    life: 0.75,
    maxLife: 0.75,
    color: "#64d8c2",
  });
  window.setTimeout(() => {
    if (game.enemy.alive) {
      game.enemy.hp = 0;
      game.enemy.flash = 1;
      spawnParticles(game.enemy.x, game.enemy.y, "#64d8c2", 30);
      playEnemyDeath(pan);
    }
  }, 120);
}

function performVoice() {
  lab.voice(enemyPan());
}

function primaryAction(name) {
  if (!lab.started) {
    showToast("请先启动测试场");
    return;
  }
  if (name === "attack") performAttack();
  if (name === "skill") performSkill();
  if (name === "voice") {
    performVoice();
    $("#voiceBtn")?.setAttribute("aria-pressed", "true");
    window.setTimeout(() => $("#voiceBtn")?.setAttribute("aria-pressed", "false"), 350);
  }
  if (name === "toggle-combat") {
    const nextState = lab.musicState === "combat" ? "explore" : "combat";
    const delay = lab.faults.bgmGap ? 360 : 0;
    lab.startMusic(nextState, delay);
  }
  if (name === "toggle-pause") lab.togglePause();
}

function updateGame(delta) {
  const speed = 280;
  let directionX = 0;
  if (game.keys.has("KeyA") || game.keys.has("ArrowLeft")) directionX -= 1;
  if (game.keys.has("KeyD") || game.keys.has("ArrowRight")) directionX += 1;
  game.moving = directionX !== 0;
  if (directionX !== 0) {
    game.player.x = clamp(game.player.x + directionX * speed * delta, 90, game.width - 90);
    game.player.facing = directionX;
  }

  game.player.x = lerp(game.player.x, game.player.targetX, 0.08);

  game.enemy.phase += delta * 0.9;
  if (game.enemy.alive) {
    game.enemy.x = 650 + Math.sin(game.enemy.phase) * 260;
    game.enemy.y = 320 + Math.cos(game.enemy.phase * 0.7) * 105;
  }
  game.enemy.flash = Math.max(0, game.enemy.flash - delta * 3.5);

  game.particles.forEach((particle) => {
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vx *= 0.96;
    particle.vy *= 0.96;
    particle.life -= delta;
  });
  game.particles = game.particles.filter((particle) => particle.life > 0);

  game.rings.forEach((ring) => {
    ring.life -= delta;
    ring.radius += delta * 260;
  });
  game.rings = game.rings.filter((ring) => ring.life > 0);

  const now = performance.now();
  if (game.moving && now - game.lastFootstep > 280) {
    game.lastFootstep = now;
    lab.footstep(0);
  }
  if (lab.started && !lab.paused && game.enemy.alive && now - game.lastEnemyPulse > 1700) {
    game.lastEnemyPulse = now;
    const distance = enemyDistance();
    lab.enemyPulse(enemyPan(), distance / 1000);
  }

  stageCoordinate.textContent = `${(game.player.x / game.width).toFixed(2)} / ${(
    game.player.y / game.height
  ).toFixed(2)}`;
}

function drawRoundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawScene(timestamp) {
  const width = game.width;
  const height = game.height;
  const time = timestamp / 1000;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = canvas.width / dpr;
  const cssHeight = canvas.height / dpr;
  ctx.save();
  ctx.scale(cssWidth / game.width, cssHeight / game.height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0e1210");
  gradient.addColorStop(0.55, "#121510");
  gradient.addColorStop(1, "#080a08");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#d8f45f";
  ctx.lineWidth = 1;
  const horizon = 355;
  for (let x = -400; x <= width + 400; x += 95) {
    ctx.beginPath();
    ctx.moveTo(width / 2, horizon);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = horizon; y < height; y += 56) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "rgba(216,244,95,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(width / 2, 465, 475, 155, 0, 0, Math.PI * 2);
  ctx.stroke();

  const scanX = ((time * 95) % (width + 220)) - 110;
  const scanGradient = ctx.createLinearGradient(scanX - 100, 0, scanX + 100, 0);
  scanGradient.addColorStop(0, "rgba(216,244,95,0)");
  scanGradient.addColorStop(0.5, "rgba(216,244,95,0.09)");
  scanGradient.addColorStop(1, "rgba(216,244,95,0)");
  ctx.fillStyle = scanGradient;
  ctx.fillRect(scanX - 100, 0, 200, height);

  game.rings.forEach((ring) => {
    ctx.globalAlpha = ring.life / ring.maxLife;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(ring.x, ring.y + 76, ring.radius, ring.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(game.player.x, game.player.y + 85, 58, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  drawPlayer(time);
  if (game.enemy.alive) drawEnemy(time);

  game.particles.forEach((particle) => {
    ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  });
  ctx.globalAlpha = 1;

  drawHud(time);
  ctx.restore();
}

function drawPlayer(time) {
  const { x, y, facing } = game.player;
  const bob = Math.sin(time * 7) * 3;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(facing, 1);

  ctx.strokeStyle = "rgba(216,244,95,0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -32, 56, -0.6, 1.05);
  ctx.stroke();

  ctx.fillStyle = "#d8f45f";
  ctx.beginPath();
  ctx.moveTo(38, -76);
  ctx.lineTo(45, -46);
  ctx.lineTo(29, -50);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#252b1b";
  ctx.strokeStyle = "#d8f45f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-32, 76);
  ctx.lineTo(-18, -18);
  ctx.lineTo(20, -18);
  ctx.lineTo(35, 76);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#11150d";
  ctx.beginPath();
  ctx.arc(0, -40, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ff995f";
  ctx.beginPath();
  ctx.moveTo(30, -75);
  ctx.lineTo(112, -48);
  ctx.lineTo(30, -24);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ff995f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(12, 32);
  ctx.lineTo(60, -6);
  ctx.stroke();
  ctx.restore();
}

function drawEnemy(time) {
  const { x, y, hp, maxHp, flash } = game.enemy;
  ctx.save();
  ctx.translate(x, y);
  const pulse = 1 + Math.sin(time * 4.2) * 0.03;
  ctx.scale(pulse, pulse);

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(0, 78, 58, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = flash > 0 ? "#ffdede" : "#3c2630";
  ctx.strokeStyle = "#ff6565";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-40, 72);
  ctx.lineTo(-25, -34);
  ctx.lineTo(0, -72);
  ctx.lineTo(28, -34);
  ctx.lineTo(42, 72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ff6565";
  ctx.beginPath();
  ctx.arc(-15, -17, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(16, -17, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,101,101,0.34)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -8, 96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(7,8,7,0.72)";
  drawRoundedRect(x - 72, y - 108, 144, 7, 3);
  ctx.fill();
  ctx.fillStyle = "#ff6565";
  drawRoundedRect(x - 72, y - 108, 144 * (hp / maxHp), 7, 3);
  ctx.fill();
}

function drawHud(time) {
  ctx.save();
  ctx.font = '12px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = "rgba(242,240,231,0.6)";
  ctx.letterSpacing = "1px";
  ctx.fillText("QA SCENE / SIGNAL FIELD", 28, 42);
  ctx.fillStyle = "rgba(216,244,95,0.7)";
  ctx.fillText(lab.musicState.toUpperCase(), 28, 62);

  const bars = 18;
  const startX = game.width - 226;
  const y = 42;
  for (let index = 0; index < bars; index += 1) {
    const active = (index + 1) / bars <= clamp(lab.peak * 1.8, 0.05, 1);
    const height = 5 + (index % 5) * 3;
    ctx.fillStyle = active ? (index > 13 ? "#ff6565" : "#d8f45f") : "rgba(216,244,95,0.16)";
    ctx.fillRect(startX + index * 11, y - height, 5, height);
  }

  ctx.fillStyle = "rgba(242,240,231,0.42)";
  ctx.textAlign = "right";
  ctx.fillText("LIVE MIX TELEMETRY", game.width - 28, 65);
  ctx.textAlign = "left";
  ctx.restore();
}

function frame(timestamp) {
  const delta = Math.min(0.05, (timestamp - game.lastFrame) / 1000);
  game.lastFrame = timestamp;
  updateGame(delta);
  drawScene(timestamp);
  sceneClock.textContent = formatTime(timestamp - game.startedAt);
  if (lab.paused) {
    ctx.save();
    ctx.fillStyle = "rgba(7,8,7,0.64)";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.fillStyle = "#d8f45f";
    ctx.font = '600 18px "Microsoft YaHei UI", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("AUDIO SUSPENDED", canvas.clientWidth / 2, canvas.clientHeight / 2);
    ctx.restore();
  }
  window.requestAnimationFrame(frame);
}

async function startLab() {
  try {
    await lab.start();
    runtimeStatus.dataset.state = "running";
    runtimeStatusText.textContent = "运行中";
    startBtn.textContent = "测试场已启动";
    startBtn.disabled = true;
    showToast("音频测试场已启动");
  } catch (error) {
    runtimeStatus.dataset.state = "error";
    runtimeStatusText.textContent = "启动失败";
    showToast(`音频初始化失败: ${error.message}`);
  }
}

function resetLab() {
  lab.reset();
  resetGame();
  startBtn.disabled = false;
  startBtn.textContent = "启动测试场";
  showToast("测试场已重置");
}

function setActiveActionButton(name, active) {
  const button = document.querySelector(`[data-action="${name}"]`);
  if (button) button.setAttribute("aria-pressed", String(active));
}

function updateVolumeOutput(input) {
  const output = $(`#${input.id}Value`);
  if (output) output.textContent = `${input.value}%`;
}

function exportEvidence() {
  const payload = {
    exportedAt: new Date().toISOString(),
    snapshot: lab.getSnapshot(),
    events: lab.events,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audio-lab-events-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("事件日志已导出");
}

startBtn.addEventListener("click", startLab);
resetBtn.addEventListener("click", resetLab);
combatToggleBtn.addEventListener("click", () => primaryAction("toggle-combat"));
$("#voiceBtn")?.addEventListener("click", () => primaryAction("voice"));
$("#attackBtn")?.addEventListener("click", () => primaryAction("attack"));
$("#skillBtn")?.addEventListener("click", () => primaryAction("skill"));

document.querySelector('[data-action="attack"]').addEventListener("click", () => primaryAction("attack"));
document.querySelector('[data-action="skill"]').addEventListener("click", () => primaryAction("skill"));
document.querySelector('[data-action="voice"]').addEventListener("click", () => primaryAction("voice"));
document.querySelector('[data-action="move-left"]').addEventListener("pointerdown", () => {
  game.keys.add("KeyA");
  setActiveActionButton("move-left", true);
});
document.querySelector('[data-action="move-left"]').addEventListener("pointerup", () => {
  game.keys.delete("KeyA");
  setActiveActionButton("move-left", false);
});
document.querySelector('[data-action="move-right"]').addEventListener("pointerdown", () => {
  game.keys.add("KeyD");
  setActiveActionButton("move-right", true);
});
document.querySelector('[data-action="move-right"]').addEventListener("pointerup", () => {
  game.keys.delete("KeyD");
  setActiveActionButton("move-right", false);
});

$$("input[type='range']").forEach((input) => {
  input.addEventListener("input", () => {
    updateVolumeOutput(input);
    const value = Number(input.value);
    if (input.id === "masterVolume") lab.setMasterVolume(value);
    if (input.id === "musicVolume") lab.setMusicVolume(value);
    if (input.id === "sfxVolume") lab.setSfxVolume(value);
    if (input.id === "voiceVolume") lab.setVoiceVolume(value);
  });
});

$$(".fault-item input").forEach((input) => {
  input.addEventListener("change", () => {
    lab.setFault(input.dataset.fault, input.checked);
    const activeCount = $$(".fault-item input:checked").length;
    faultCount.textContent = `${activeCount} ACTIVE`;
  });
});

muteBtn.addEventListener("click", () => {
  if (!lab.started) {
    showToast("请先启动测试场");
    return;
  }
  lab.setMuted(!lab.muted);
  muteBtn.setAttribute("aria-pressed", String(lab.muted));
  muteBtn.textContent = lab.muted ? "取消静音" : "静音";
});

clearLogBtn.addEventListener("click", () => {
  lab.events = [];
  lab.sessionStart = performance.now();
  renderEvents();
  eventCount.textContent = "0";
  lab.logEvent("trace_cleared", "SYSTEM", 0, 0, "info");
});

exportBtn.addEventListener("click", exportEvidence);

canvas.addEventListener("pointerdown", (event) => {
  if (!lab.started) return;
  const point = canvasPoint(event);
  game.player.targetX = clamp(point.x, 90, game.width - 90);
  game.player.targetY = clamp(point.y, 260, game.height - 70);
  game.player.facing = point.x >= game.player.x ? 1 : -1;
  lab.logEvent("pointer_move", "SYSTEM", 0, clamp((point.x / game.width) * 2 - 1, -1, 1), "info");
});

window.addEventListener("keydown", (event) => {
  if (["Space", "KeyJ", "KeyK", "KeyV", "KeyP"].includes(event.code)) {
    event.preventDefault();
  }
  game.keys.add(event.code);
  if (event.repeat) return;
  if (event.code === "Space" || event.code === "KeyJ") primaryAction("attack");
  if (event.code === "KeyK") primaryAction("skill");
  if (event.code === "KeyV") primaryAction("voice");
  if (event.code === "KeyP") primaryAction("toggle-pause");
});

window.addEventListener("keyup", (event) => {
  game.keys.delete(event.code);
  if (event.code === "KeyA" || event.code === "ArrowLeft") setActiveActionButton("move-left", false);
  if (event.code === "KeyD" || event.code === "ArrowRight") setActiveActionButton("move-right", false);
});

document.addEventListener("visibilitychange", () => {
  if (!lab.started) return;
  lab.logEvent(
    document.hidden ? "app_backgrounded" : "app_foregrounded",
    "SYSTEM",
    0,
    0,
    "info",
  );
});

window.__AUDIO_LAB__ = {
  start: startLab,
  reset: resetLab,
  snapshot: () => lab.getSnapshot(),
  events: () => lab.events.map((event) => ({ ...event })),
  trigger: (name) => {
    if (name === "toggle-combat" || name === "toggle-pause") {
      primaryAction(name);
    } else if (name === "spatial-right") {
      lab.enemyPulse(0.8, 0.2);
    } else if (name === "spatial-far") {
      lab.enemyPulse(0, 0.95);
    } else if (name === "enemy-death") {
      playEnemyDeath(enemyPan());
    } else {
      primaryAction(name);
    }
    return lab.getSnapshot();
  },
  setFault: (name, enabled) => {
    lab.setFault(name, enabled);
    const input = document.querySelector(`[data-fault="${name}"]`);
    if (input) input.checked = enabled;
    faultCount.textContent = `${$$(".fault-item input:checked").length} ACTIVE`;
  },
  exportEvents: () => JSON.parse(JSON.stringify(lab.events)),
};

window.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();
window.requestAnimationFrame(frame);
