import { BaseScreen } from "./base-screen.js";
import { SoundManager } from "../effects/sounds.js";
import { GlitchEffect } from "../effects/glitch.js";

export class CountdownScreen extends BaseScreen {
  static get screenId() {
    return "countdown";
  }
  static get screenName() {
    return "Countdown";
  }
  get hasInput() {
    return false;
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.duration = config.duration || 300;
    this.remaining = config.remaining ?? this.duration;
    this.running = false;
    this.expired = false;
    this.label = config.label || "TIME REMAINING";
    this.expireAction = config.expireAction || "none";
    this.expireScreen = config.expireScreen || "crash";
    this._interval = null;
    this._lastBeep = 0;
    this._targetTime = config.targetTime || null;
  }

  getData() {
    return {
      ...super.getData(),
      label: this.label,
      timeDisplay: this._formatTime(this.remaining),
      expired: this.expired,
      running: this.running,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this._updateDisplay();
  }

  deactivate() {
    this._stopInterval();
    super.deactivate();
  }

  applyStateSync(screenConfig) {
    if (screenConfig.expired) {
      this._stopInterval();
      this.running = false;
      this.expired = true;
      this.remaining = 0;
      this._updateDisplay();
      return;
    }
    if (screenConfig.targetTime && screenConfig.running) {
      this._targetTime = screenConfig.targetTime;
      this.remaining = Math.max(0, Math.ceil((this._targetTime - Date.now()) / 1000));
      if (!this.running) {
        this.running = true;
        this.expired = false;
        if (!this._interval) this._interval = setInterval(() => this._tick(), 1000);
      }
    } else if (screenConfig.running === false) {
      this._stopInterval();
      this.running = false;
      if (screenConfig.remaining !== undefined) this.remaining = screenConfig.remaining;
    }
    if (screenConfig.duration !== undefined) this.duration = screenConfig.duration;
    if (screenConfig.remaining !== undefined && !screenConfig.running) this.remaining = screenConfig.remaining;
    this._updateDisplay();
  }

  start() {
    if (this.running || this.expired) return;
    this.running = true;
    this._targetTime = Date.now() + this.remaining * 1000;
    SoundManager.play("boot");
    this._interval = setInterval(() => this._tick(), 1000);
    this._updateDisplay();
  }

  stop() {
    this.running = false;
    this._targetTime = null;
    this._stopInterval();
    this._updateDisplay();
  }

  reset(duration) {
    this._stopInterval();
    this.running = false;
    this.expired = false;
    this._targetTime = null;
    if (duration !== undefined) this.duration = duration;
    this.remaining = this.duration;
    this._updateDisplay();
  }

  setTime(seconds) {
    this.remaining = Math.max(0, seconds);
    if (this.remaining <= 0) this._expire();
    this._updateDisplay();
  }

  addTime(seconds) {
    this.remaining = Math.max(0, this.remaining + seconds);
    if (this._targetTime && this.running) {
      this._targetTime += seconds * 1000;
    }
    if (seconds > 0) {
      SoundManager.play("success");
    }
    this._updateDisplay();
  }

  _stopInterval() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _tick() {
    if (!this.running || !this.active) return;
    if (this._targetTime) {
      this.remaining = Math.max(0, Math.ceil((this._targetTime - Date.now()) / 1000));
    } else {
      this.remaining = Math.max(0, this.remaining - 1);
    }

    if (this.remaining <= 10 && this.remaining > 0) {
      SoundManager.play("beep");
      GlitchEffect.trigger(this.terminal.element, "short");
    } else if (this.remaining <= 30 && this.remaining % 5 === 0) {
      SoundManager.play("beep");
    }

    if (this.remaining <= 0) {
      this._expire();
      return;
    }
    this._updateDisplay();
  }

  _expire() {
    this._stopInterval();
    this.running = false;
    this.expired = true;
    this.remaining = 0;
    SoundManager.play("alarm");
    GlitchEffect.trigger(this.terminal.element, "sustained");
    this._updateDisplay();

    if (this.expireAction === "screen" && this.expireScreen) {
      setTimeout(() => {
        this.terminal.switchScreen(this.expireScreen);
      }, 2000);
    } else if (this.expireAction === "lock") {
      setTimeout(() => {
        this.terminal.setLocked(true);
      }, 1500);
    }
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  _updateDisplay() {
    if (!this.element) return;
    const timeEl = this.element.querySelector(".countdown-time");
    const labelEl = this.element.querySelector(".countdown-label");
    const statusEl = this.element.querySelector(".countdown-status");

    if (timeEl) {
      timeEl.textContent = this._formatTime(this.remaining);
      timeEl.classList.toggle("countdown-critical", this.remaining <= 30);
      timeEl.classList.toggle("countdown-expired", this.expired);
    }

    if (statusEl) {
      if (this.expired) {
        statusEl.textContent = "EXPIRED";
        statusEl.className = "countdown-status term-error term-glow";
      } else if (this.running) {
        statusEl.textContent = "ACTIVE";
        statusEl.className = "countdown-status term-success";
      } else {
        statusEl.textContent = "PAUSED";
        statusEl.className = "countdown-status term-warning";
      }
    }
  }
}
