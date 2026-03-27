import { BaseScreen } from "./base-screen.js";
import { emitSocket, emitRequestAction } from "../module.js";
import { GlitchEffect } from "../effects/glitch.js";
import { SoundManager } from "../effects/sounds.js";

export class LoginScreen extends BaseScreen {
  static get screenId() {
    return "login";
  }
  static get screenName() {
    return "Login";
  }
  get hasInput() {
    return false;
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.attempts = 0;
    this.maxAttempts = config.maxAttempts || 5;
    this.locked = false;
  }

  getData() {
    return {
      ...super.getData(),
      username: this.config.username || "ADMIN",
      showUsername: this.config.showUsername !== false,
      locked: this.locked,
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this.activateListeners(container);
    await this._bootSequence(container);
  }

  activateListeners(html) {
    html.querySelector(".login-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this._onSubmitPassword();
    });

    const input = html.querySelector(".login-password-input");
    if (input) {
      input.addEventListener("keydown", () => SoundManager.play("keystroke"));
      input.addEventListener("input", () => {
        if (this._remoteUpdate) return;
        emitSocket("inputSync", this.terminal.terminalId, {
          field: "login-password",
          value: input.value.length,
        });
      });
      setTimeout(() => input.focus(), 500);
    }
  }

  receiveInputSync(field, value) {
    if (field === "login-password") {
      const input = this.element?.querySelector(".login-password-input");
      if (!input) return;
      this._remoteUpdate = true;
      input.value = "*".repeat(value);
      this._remoteUpdate = false;
    } else if (field === "login-status") {
      this._setStatus(value, "login-status term-dim");
    }
  }

  async _bootSequence(container) {
    const output = container.querySelector(".login-boot-output");
    if (!output) return;

    const lines = [
      "BIOS v2.4.1 ... OK",
      "Memory Test ... 640K OK",
      "Loading Terminal OS v4.7.2 ...",
      "Initializing network interface ... OK",
      "Connecting to mainframe ... OK",
      "Security protocol engaged.",
      "",
      "=================================",
      "  AUTHORIZED ACCESS ONLY",
      "=================================",
      "",
    ];

    for (const line of lines) {
      if (!this.active) return;
      const div = document.createElement("div");
      div.classList.add("terminal-line", "boot-line");
      div.textContent = line;
      output.appendChild(div);
      output.scrollTop = output.scrollHeight;
      await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));
    }
  }

  applyStateSync(screenConfig) {
    if (screenConfig.attempts !== undefined) this.attempts = screenConfig.attempts;
    if (screenConfig.locked !== undefined && screenConfig.locked && !this.locked) this._lockout();

    if (screenConfig.lastResult != null) {
      const input = this.element?.querySelector(".login-password-input");
      if (input) input.value = "";
      this.showResult(screenConfig.lastResult === "granted");
    }
  }

  async _onSubmitPassword() {
    if (this.locked || !this.canInteract()) return;
    const input = this.element?.querySelector(".login-password-input");
    if (!input) return;
    const password = input.value;
    input.value = "";
    emitSocket("inputSync", this.terminal.terminalId, { field: "login-password", value: 0 });
    if (!password) return;

    this._setStatus("Verifying credentials...", "login-status term-dim");
    emitSocket("inputSync", this.terminal.terminalId, {
      field: "login-status",
      value: "Verifying credentials...",
    });

    const hashedPassword = await LoginScreen._hashPassword(password);
    emitRequestAction(this.terminal.terminalId, "loginAttempt", {
      passwordHash: hashedPassword,
    });
  }

  _setStatus(text, className) {
    const status = this.element?.querySelector(".login-status");
    if (status) {
      status.textContent = text;
      status.className = className;
    }
  }

  static async _hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async showResult(correct) {
    if (!this.active || !this.element) return;
    const status = this.element.querySelector(".login-status");
    const crtEl = this.terminal.element?.querySelector(".terminal-crt");

    if (correct) {
      SoundManager.play("granted");
      if (status) {
        status.textContent = "ACCESS GRANTED";
        status.className = "login-status term-success term-glow";
      }
      if (crtEl) {
        const flash = document.createElement("div");
        flash.classList.add("access-granted-flash");
        flash.textContent = "ACCESS GRANTED";
        crtEl.appendChild(flash);
        setTimeout(() => flash.remove(), 2000);
      }
    } else {
      SoundManager.play("denied");
      GlitchEffect.trigger(this.terminal.element, "short");
      if (status) {
        status.textContent = `ACCESS DENIED - Attempt ${this.attempts}/${this.maxAttempts}`;
        status.className = "login-status term-error";
      }
      if (crtEl) {
        const flash = document.createElement("div");
        flash.classList.add("access-denied-flash");
        flash.textContent = "ACCESS DENIED";
        crtEl.appendChild(flash);
        setTimeout(() => flash.remove(), 1500);
      }
      if (this.attempts >= this.maxAttempts) this._lockout();
    }
  }

  _lockout() {
    this.locked = true;
    const form = this.element?.querySelector(".login-form");
    if (form) form.style.display = "none";

    const status = this.element?.querySelector(".login-status");
    if (status) {
      status.textContent = "TERMINAL LOCKED - TOO MANY FAILED ATTEMPTS";
      status.className = "login-status term-error term-glow";
    }

    GlitchEffect.trigger(this.terminal.element, "sustained");
    SoundManager.play("error");
  }
}
