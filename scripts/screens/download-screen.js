import { BaseScreen } from "./base-screen.js";
import { SoundManager } from "../effects/sounds.js";
import { GlitchEffect } from "../effects/glitch.js";

export class DownloadScreen extends BaseScreen {
  static get screenId() {
    return "download";
  }
  static get screenName() {
    return "Download";
  }
  get hasInput() {
    return false;
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.progress = config.progress || 0;
    this.speed = config.speed || 2;
    this.filename = config.filename || "DATA_PACKAGE.bin";
    this.totalSize = config.totalSize || "2.4 GB";
    this.running = config.running || false;
    this.completed = config.completed || false;
    this.interrupted = config.interrupted || false;
    this.log = config.log || [];
    this._interval = null;
  }

  getData() {
    return {
      ...super.getData(),
      filename: this.filename,
      totalSize: this.totalSize,
      progress: this.progress,
      completed: this.completed,
      interrupted: this.interrupted,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this._renderLog();
    this._updateDisplay();
  }

  deactivate() {
    this._stopInterval();
    super.deactivate();
  }

  applyStateSync(screenConfig) {
    if (screenConfig.progress !== undefined) this.progress = screenConfig.progress;
    if (screenConfig.completed !== undefined) this.completed = screenConfig.completed;
    if (screenConfig.interrupted !== undefined) this.interrupted = screenConfig.interrupted;
    if (screenConfig.running !== undefined) {
      if (screenConfig.running && !this.running) {
        this.running = true;
        if (!this._interval) this._interval = setInterval(() => this._tick(), 200);
      } else if (!screenConfig.running && this.running) {
        this._stopInterval();
        this.running = false;
      }
    }
    if (screenConfig.log) {
      const prevLen = this.log.length;
      this.log = [...screenConfig.log];
      if (this.active && this.element) {
        const newEntries = this.log.slice(prevLen);
        for (const entry of newEntries) {
          this._renderLogEntry(entry);
        }
      }
    }
    this._updateDisplay();
  }

  start() {
    if (this.running || this.completed) return;
    this.running = true;
    this.interrupted = false;
    SoundManager.play("boot");
    this._addLog("Transfer started...", "term-info");
    this._interval = setInterval(() => this._tick(), 200);
    this._updateDisplay();
  }

  _stopInterval() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  stop() {
    this.running = false;
    this._stopInterval();
  }

  pause() {
    if (!this.running) return;
    this.stop();
    this._addLog("Transfer paused.", "term-warning");
    this._updateDisplay();
  }

  resume() {
    if (this.running || this.completed) return;
    this.running = true;
    this._addLog("Transfer resumed.", "term-info");
    this._interval = setInterval(() => this._tick(), 200);
    this._updateDisplay();
  }

  interrupt() {
    this.stop();
    this.interrupted = true;
    GlitchEffect.trigger(this.terminal.element, "static");
    SoundManager.play("error");
    this._addLog("!!! TRANSFER INTERRUPTED !!!", "term-error");
    this._updateDisplay();
  }

  setProgress(value) {
    this.progress = Math.max(0, Math.min(100, value));
    if (this.progress >= 100) this._complete();
    this._updateDisplay();
  }

  reset() {
    this.stop();
    this.progress = 0;
    this.completed = false;
    this.interrupted = false;
    this.log = [];
    const logEl = this.element?.querySelector(".download-log");
    if (logEl) logEl.innerHTML = "";
    this._updateDisplay();
  }

  _tick() {
    if (!this.running || !this.active) return;
    const jitter = (Math.random() - 0.3) * this.speed;
    this.progress = Math.min(100, this.progress + Math.max(0.1, this.speed * 0.5 + jitter));

    if (Math.random() < 0.05) {
      SoundManager.play("keystroke");
    }

    if (this.progress >= 100) {
      this._complete();
    }
    this._updateDisplay();
  }

  _complete() {
    this.stop();
    this.progress = 100;
    this.completed = true;
    SoundManager.play("success");
    GlitchEffect.trigger(this.terminal.element, "flash");
    this._addLog("Transfer complete.", "term-success");
    this._updateDisplay();
  }

  _addLog(text, cssClass = "") {
    const entry = { text, cssClass, timestamp: Date.now() };
    this.log.push(entry);
    this._renderLogEntry(entry);
  }

  _renderLog() {
    const logEl = this.element?.querySelector(".download-log");
    if (!logEl) return;
    logEl.innerHTML = "";
    for (const entry of this.log) {
      this._renderLogEntry(entry);
    }
  }

  _renderLogEntry(entry) {
    const logEl = this.element?.querySelector(".download-log");
    if (!logEl) return;
    const line = document.createElement("div");
    line.classList.add("terminal-line");
    if (entry.cssClass) entry.cssClass.split(" ").forEach((c) => line.classList.add(c));
    const time = new Date(entry.timestamp).toLocaleTimeString();
    line.textContent = `[${time}] ${entry.text}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  _updateDisplay() {
    if (!this.element) return;
    const bar = this.element.querySelector(".download-progress-bar");
    const pct = this.element.querySelector(".download-percent");
    const status = this.element.querySelector(".download-status");
    const sizeInfo = this.element.querySelector(".download-size-info");

    if (bar) bar.style.width = `${this.progress}%`;
    if (pct) pct.textContent = `${Math.floor(this.progress)}%`;

    if (sizeInfo) {
      const downloaded = ((parseFloat(this.totalSize) * this.progress) / 100).toFixed(1);
      sizeInfo.textContent = `${downloaded} / ${this.totalSize}`;
    }

    if (status) {
      if (this.completed) {
        status.textContent = "COMPLETE";
        status.className = "download-status term-success term-glow";
      } else if (this.interrupted) {
        status.textContent = "INTERRUPTED";
        status.className = "download-status term-error term-glow";
      } else if (this.running) {
        status.textContent = "DOWNLOADING...";
        status.className = "download-status term-info";
      } else {
        status.textContent = "READY";
        status.className = "download-status term-dim";
      }
    }
  }
}
