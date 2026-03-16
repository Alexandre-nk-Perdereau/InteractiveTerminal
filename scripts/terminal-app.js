import { MODULE_ID } from "./module.js";
import { LoginScreen } from "./screens/login-screen.js";
import { ChatScreen } from "./screens/chat-screen.js";
import { HackingScreen } from "./screens/hacking-screen.js";
import { CommandScreen } from "./screens/command-screen.js";
import { GlitchEffect } from "./effects/glitch.js";
import { SoundManager } from "./effects/sounds.js";

let TerminalApplication = null;

export function getTerminalApplicationClass() {
  if (TerminalApplication) return TerminalApplication;

  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  TerminalApplication = class TerminalApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static SCREENS = { login: LoginScreen, chat: ChatScreen, hacking: HackingScreen, command: CommandScreen };

    static DEFAULT_OPTIONS = {
      classes: ["interactive-terminal-app"],
      tag: "div",
      window: {
        frame: true, positioned: true, title: "Terminal",
        icon: "fas fa-terminal", minimizable: true, resizable: true,
      },
      position: { width: 700, height: 500 },
      actions: {},
    };

    static PARTS = {
      terminal: { template: `modules/${MODULE_ID}/templates/terminal.hbs` },
    };

    constructor(terminalId, config = {}) {
      super({
        id: `interactive-terminal-${terminalId}`,
        window: { title: config.title || "Terminal" },
      });
      this.terminalId = terminalId;
      this.config = config;
      this.currentScreen = null;
      this._screenInstances = {};
    }

    get title() {
      return this.config.title || "Terminal";
    }

    async _prepareContext() {
      const theme = this.config.theme || "green";
      return {
        terminalId: this.terminalId,
        title: this.config.title || "Terminal",
        theme,
        themeClass: `terminal-theme-${theme}`,
        isGM: game.user.isGM,
        canInteract: this._canInteract(),
        hasInput: this._screenInstances[this.config.screen]?.hasInput ?? false,
        promptSymbol: ">",
        inputPlaceholder: "",
        screenName: this.config.screen || "login",
      };
    }

    _onRender() {
      const crt = this.element.querySelector(".terminal-crt");
      if (crt) {
        crt.classList.add("terminal-power-on");
        SoundManager.play("boot");
      }

      this._activateScreen();

      const input = this.element.querySelector(".terminal-input");
      if (input) {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this._handleInput(input.value);
            input.value = "";
          }
          SoundManager.play("keystroke");
        });
      }

      if (!this._canInteract()) {
        this.element.querySelector(".terminal-content")?.classList.add("terminal-disabled");
      }
    }

    _canInteract() {
      if (game.user.isGM) return true;
      const perms = this.config.permissions || {};
      if (Object.keys(perms).length === 0) return true;
      return perms[game.user.id] === true;
    }

    async _activateScreen() {
      const screenId = this.config.screen || "login";
      const ScreenClass = TerminalApplication.SCREENS[screenId] || LoginScreen;

      if (this.currentScreen) this.currentScreen.deactivate();

      if (!this._screenInstances[screenId]) {
        this._screenInstances[screenId] = new ScreenClass(this, this.config.screenConfigs?.[screenId] || {});
      }
      this.currentScreen = this._screenInstances[screenId];

      const body = this.element.querySelector(".terminal-body");
      if (body) await this.currentScreen.activate(body);

      this._updateInputArea();
    }

    _updateInputArea() {
      const footer = this.element.querySelector(".terminal-footer");
      if (!footer) return;
      if (this.currentScreen?.hasInput) {
        footer.style.display = "flex";
        const prompt = footer.querySelector(".terminal-prompt");
        const input = footer.querySelector(".terminal-input");
        if (prompt) prompt.textContent = this.currentScreen.promptSymbol;
        if (input) input.placeholder = this.currentScreen.inputPlaceholder;
      } else {
        footer.style.display = "none";
      }
    }

    _handleInput(value) {
      if (!value.trim() || !this._canInteract()) return;
      this.currentScreen?.onInput(value.trim());
    }

    async switchScreen(screenId) {
      this.config.screen = screenId;
      GlitchEffect.trigger(this.element, "short");
      SoundManager.play("glitch");
      await new Promise((r) => setTimeout(r, 200));
      await this._activateScreen();
    }

    updatePermissions(permissions) {
      this.config.permissions = permissions;
      const content = this.element?.querySelector(".terminal-content");
      if (!content) return;
      content.classList.toggle("terminal-disabled", !this._canInteract());
    }

    updateConfig(newConfig) {
      foundry.utils.mergeObject(this.config, newConfig);
      if (newConfig.theme) {
        const crt = this.element?.querySelector(".terminal-crt");
        if (crt) {
          crt.className = crt.className.replace(/terminal-theme-\w+/g, "");
          crt.classList.add(`terminal-theme-${newConfig.theme}`);
        }
      }
      if (newConfig.title) {
        const el = this.element?.querySelector(".terminal-title");
        if (el) el.textContent = newConfig.title;
      }
      if (newConfig.screenConfigs) {
        for (const [sid, cfg] of Object.entries(newConfig.screenConfigs)) {
          this._screenInstances[sid]?.updateConfig(cfg);
        }
      }
    }

    setLocked(locked) {
      this.config.locked = locked;
      const content = this.element?.querySelector(".terminal-content");
      if (!content) return;

      if (locked && !game.user.isGM) {
        content.classList.add("terminal-disabled");
        let overlay = this.element.querySelector(".terminal-lock-overlay");
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.classList.add("terminal-lock-overlay");
          overlay.innerHTML = '<i class="fas fa-lock"></i><span>TERMINAL LOCKED</span>';
          this.element.querySelector(".terminal-crt")?.appendChild(overlay);
        }
        overlay.style.display = "flex";
      } else {
        content.classList.remove("terminal-disabled");
        const overlay = this.element.querySelector(".terminal-lock-overlay");
        if (overlay) overlay.style.display = "none";
      }
    }

    showSystemMessage(text, cssClass = "term-warning") {
      // Only append to screen output, not to terminal-body directly (avoids duplication)
      if (this.currentScreen) {
        this.currentScreen.appendLine(text, `terminal-system-message ${cssClass}`);
      }
    }

    async resetScreen(screenId) {
      const sid = screenId || this.config.screen;
      delete this._screenInstances[sid];

      if (this.config.screen === sid && this.element) {
        await this._activateScreen();
      }

      GlitchEffect.trigger(this.element, "flash");
      SoundManager.play("boot");
    }

    async saveConfig() {
      if (!game.user.isGM) return;
      const terminals = game.settings.get(MODULE_ID, "terminals");
      terminals[this.terminalId] = this.config;
      await game.settings.set(MODULE_ID, "terminals", terminals);
    }

    async close(options = {}) {
      const crt = this.element?.querySelector(".terminal-crt");
      if (crt) {
        crt.classList.add("terminal-power-off");
        await new Promise((r) => setTimeout(r, 300));
      }
      this.currentScreen?.deactivate();
      return super.close(options);
    }

    _onGmControls() {
      globalThis.InteractiveTerminal.openGmPanel();
    }
  };

  TerminalApplication.DEFAULT_OPTIONS.actions = {
    gmControls: function () { this._onGmControls(); },
  };

  return TerminalApplication;
}
