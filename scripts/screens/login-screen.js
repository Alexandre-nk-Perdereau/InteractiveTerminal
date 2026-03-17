import { BaseScreen } from "./base-screen.js";
import { emitSocket } from "../module.js";
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
      setTimeout(() => input.focus(), 500);
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

  _onSubmitPassword() {
    if (this.locked || !this.canInteract()) return;
    const input = this.element.querySelector(".login-password-input");
    if (!input) return;
    const password = input.value;
    input.value = "";
    if (!password) return;

    this.attempts++;

    if (game.user.isGM) {
      const correct = password === this.config.password;
      this.showResult(correct);
      if (correct) {
        const successScreen = this.config.successScreen || "chat";
        setTimeout(() => {
          this.terminal.switchScreen(successScreen);
          emitSocket("switchScreen", this.terminal.terminalId, { screen: successScreen });
        }, 2500);
      }
    } else {
      emitSocket("loginAttempt", this.terminal.terminalId, { password });
      const status = this.element.querySelector(".login-status");
      if (status) {
        status.textContent = "Verifying credentials...";
        status.className = "login-status term-dim";
      }
    }
  }

  async showResult(correct) {
    const status = this.element?.querySelector(".login-status");
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

      const successScreen = this.config.successScreen || "chat";
      setTimeout(() => {
        this.terminal.switchScreen(successScreen);
        if (game.user.isGM) {
          emitSocket("switchScreen", this.terminal.terminalId, { screen: successScreen });
        }
      }, 2500);
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
