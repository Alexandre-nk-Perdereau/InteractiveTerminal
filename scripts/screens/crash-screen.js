import { BaseScreen } from "./base-screen.js";
import { SoundManager } from "../effects/sounds.js";
import { GlitchEffect } from "../effects/glitch.js";

export class CrashScreen extends BaseScreen {
  static get screenId() {
    return "crash";
  }
  static get screenName() {
    return "Crash";
  }
  get hasInput() {
    return false;
  }

  static ERROR_PRESETS = {
    bluescreen: {
      title: "FATAL SYSTEM ERROR",
      code: "0x0000007E",
      lines: [
        "A critical error has occurred and the system has been halted",
        "to prevent damage to your data.",
        "",
        "KERNEL_PANIC_NOT_HANDLED",
        "",
        "If this is the first time you have seen this error screen,",
        "restart your terminal. If this screen appears again,",
        "contact your system administrator.",
        "",
        "Technical information:",
        "*** STOP: 0x0000007E (0xC0000005, 0x8054A1DC, 0xBA3F8B88, 0xBA3F8884)",
      ],
    },
    corruption: {
      title: "DATA CORRUPTION DETECTED",
      code: "ERR_CORRUPT",
      lines: [
        "Warning: filesystem integrity check failed",
        "",
        "Sector 0x4F2A: UNREADABLE",
        "Sector 0x4F2B: CHECKSUM MISMATCH",
        "Sector 0x4F2C: UNREADABLE",
        "Sector 0x4F2D: CORRUPTED",
        "",
        "Recovery impossible. Data loss imminent.",
        "Please disconnect all external devices.",
      ],
    },
    intrusion: {
      title: "SECURITY BREACH",
      code: "SEC_BREACH_01",
      lines: [
        "!!! UNAUTHORIZED ACCESS DETECTED !!!",
        "",
        "Multiple intrusion vectors identified:",
        "  - Port 443: COMPROMISED",
        "  - Port 8080: COMPROMISED",
        "  - Firewall: BYPASSED",
        "",
        "Initiating emergency lockdown protocol...",
        "All user sessions terminated.",
        "Contact security team immediately.",
      ],
    },
    overload: {
      title: "SYSTEM OVERLOAD",
      code: "THERMAL_CRIT",
      lines: [
        "CPU Temperature: CRITICAL (98°C)",
        "Memory Usage: 99.7%",
        "Disk I/O: SATURATED",
        "",
        "Emergency thermal shutdown initiated.",
        "All processes terminated.",
        "",
        "Do not restart until system has cooled.",
      ],
    },
  };

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.preset = config.preset || "bluescreen";
    this.customTitle = config.customTitle || null;
    this.customLines = config.customLines || null;
  }

  getData() {
    const preset = CrashScreen.ERROR_PRESETS[this.preset] || CrashScreen.ERROR_PRESETS.bluescreen;
    return {
      ...super.getData(),
      title: this.customTitle || preset.title,
      code: preset.code,
      lines: this.customLines || preset.lines,
      preset: this.preset,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;

    SoundManager.play("error");
    GlitchEffect.trigger(this.terminal.element, "flash");

    await this._animateLines(container);
  }

  async _animateLines(container) {
    const linesContainer = container.querySelector(".crash-lines");
    if (!linesContainer) return;
    const data = this.getData();

    for (const lineText of data.lines) {
      if (!this.active) return;
      const line = document.createElement("div");
      line.classList.add("crash-line");
      line.textContent = lineText;
      linesContainer.appendChild(line);
      linesContainer.scrollTop = linesContainer.scrollHeight;
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
    }

    if (this.active) {
      await new Promise((r) => setTimeout(r, 500));
      const cursor = document.createElement("div");
      cursor.classList.add("crash-cursor");
      cursor.innerHTML = '<span class="cursor-blink"></span>';
      linesContainer.appendChild(cursor);
    }
  }

  applyStateSync(screenConfig, syncMeta) {
    if (screenConfig.preset && screenConfig.preset !== this.preset) {
      this.setPreset(screenConfig.preset);
    }
  }

  setPreset(preset) {
    this.preset = preset;
    this.customTitle = null;
    this.customLines = null;
    if (this.active && this.element) this.activate(this.element);
  }
}
