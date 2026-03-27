import { MODULE_ID, emitSocket } from "./module.js";
import { LoginScreen } from "./screens/login-screen.js";
import { ChatScreen } from "./screens/chat-screen.js";
import { HackingScreen } from "./screens/hacking-screen.js";
import { CommandScreen } from "./screens/command-screen.js";
import { DownloadScreen } from "./screens/download-screen.js";
import { CountdownScreen } from "./screens/countdown-screen.js";
import { CrashScreen } from "./screens/crash-screen.js";
import { BootScreen } from "./screens/boot-screen.js";
import { FileBrowserScreen } from "./screens/file-browser-screen.js";
import { DiagnosticScreen } from "./screens/diagnostic-screen.js";
import { EmailScreen } from "./screens/email-screen.js";
import { GlitchEffect } from "./effects/glitch.js";
import { SoundManager } from "./effects/sounds.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TerminalApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static SCREENS = {
    login: LoginScreen,
    chat: ChatScreen,
    hacking: HackingScreen,
    command: CommandScreen,
    download: DownloadScreen,
    countdown: CountdownScreen,
    crash: CrashScreen,
    boot: BootScreen,
    fileBrowser: FileBrowserScreen,
    diagnostic: DiagnosticScreen,
    email: EmailScreen,
  };

  static DEFAULT_OPTIONS = {
    classes: ["interactive-terminal-app"],
    tag: "div",
    window: {
      frame: true,
      positioned: true,
      title: "Terminal",
      icon: "fas fa-terminal",
      minimizable: true,
      resizable: true,
    },
    position: { width: 700, height: 500 },
    actions: {
      gmControls: TerminalApplication.#onGmControls,
    },
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
    this._abortController = null;
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
    if (this._abortController) this._abortController.abort();
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    const crt = this.element.querySelector(".terminal-crt");
    if (crt) {
      crt.classList.add("terminal-power-on");
      SoundManager.play("boot");
    }

    this._activateScreen();

    const input = this.element.querySelector(".terminal-input");
    if (input) {
      input.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this._handleInput(input.value);
            input.value = "";
            emitSocket("inputSync", this.terminalId, { field: "terminal", value: "" });
          }
          SoundManager.play("keystroke");
        },
        { signal },
      );
      input.addEventListener(
        "input",
        () => {
          if (this._remoteUpdate) return;
          emitSocket("inputSync", this.terminalId, { field: "terminal", value: input.value });
        },
        { signal },
      );
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
    if (!this.element) return;
    this.config.screen = screenId;
    GlitchEffect.trigger(this.element, "short");
    SoundManager.play("glitch");
    await new Promise((r) => setTimeout(r, 200));
    if (!this.element) return;
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

  receiveInputSync(field, value, userId) {
    if (field === "terminal") {
      const input = this.element?.querySelector(".terminal-input");
      if (input) {
        this._remoteUpdate = true;
        input.value = value;
        this._remoteUpdate = false;
      }
    } else if (this.currentScreen?.receiveInputSync) {
      this.currentScreen.receiveInputSync(field, value, userId);
    }
  }

  applyDocumentUpdate(newConfig) {
    const screenChanged = newConfig.screen && newConfig.screen !== this.config.screen;
    const themeChanged = newConfig.theme && newConfig.theme !== this.config.theme;
    const titleChanged = newConfig.title && newConfig.title !== this.config.title;
    const lockChanged = newConfig.locked !== undefined && newConfig.locked !== this.config.locked;
    const permsChanged =
      newConfig.permissions && JSON.stringify(newConfig.permissions) !== JSON.stringify(this.config.permissions);

    this.config = { ...this.config, ...newConfig };

    if (themeChanged) {
      const crt = this.element?.querySelector(".terminal-crt");
      if (crt) {
        crt.className = crt.className.replace(/terminal-theme-\w+/g, "");
        crt.classList.add(`terminal-theme-${newConfig.theme}`);
      }
    }

    if (titleChanged) {
      const el = this.element?.querySelector(".terminal-title");
      if (el) el.textContent = newConfig.title;
    }

    if (lockChanged) this.setLocked(newConfig.locked);
    if (permsChanged) this.updatePermissions(newConfig.permissions);

    if (screenChanged) {
      this.switchScreen(newConfig.screen);
    } else if (this.currentScreen) {
      const screenId = this.config.screen || "login";
      const screenConfig = newConfig.screenConfigs?.[screenId] || {};
      this.currentScreen.applyStateSync(screenConfig);
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

  async resetScreen(screenId) {
    const sid = screenId || this.config.screen;
    delete this._screenInstances[sid];

    const sc = this.config.screenConfigs?.[sid];
    if (sc) {
      if (sid === "hacking") {
        sc.guesses = [];
        sc.attemptsLeft = sc.attempts || 4;
        sc.solved = false;
        sc.locked = false;
        sc.gridSeed = foundry.utils.randomID(8);
      } else if (sid === "command") {
        sc.history = [];
        sc.waiting = false;
      } else if (sid === "download") {
        sc.progress = 0;
        sc.running = false;
        sc.completed = false;
        sc.interrupted = false;
        sc.log = [];
      } else if (sid === "countdown") {
        sc.remaining = sc.duration || 300;
        sc.running = false;
        sc.expired = false;
        sc.targetTime = null;
      } else if (sid === "login") {
        sc.attempts = 0;
        sc.locked = false;
        sc.lastResult = null;
      }
    }

    if (this.config.screen === sid && this.element) {
      await this._activateScreen();
    }

    GlitchEffect.trigger(this.element, "flash");
    SoundManager.play("boot");
  }

  async close(options = {}) {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    const crt = this.element?.querySelector(".terminal-crt");
    if (crt) {
      crt.classList.add("terminal-power-off");
      await new Promise((r) => setTimeout(r, 300));
    }
    for (const screen of Object.values(this._screenInstances)) {
      screen.deactivate();
    }
    this._screenInstances = {};
    this.currentScreen = null;
    GlitchEffect.stopLoop(this.terminalId);
    return super.close(options);
  }

  static #onGmControls() {
    globalThis.InteractiveTerminal.openGmPanel();
  }
}
