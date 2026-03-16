import {
  MODULE_ID, moduleState, emitSocket,
  createNewTerminal, deployTerminal, undeployTerminal,
  runMacroSequence,
  getPendingCommands, sendGmResponse,
} from "./module.js";
import { GlitchEffect } from "./effects/glitch.js";
import { SoundManager } from "./effects/sounds.js";

const PRESET_MACROS = {
  alert: [
    { action: "sound", sound: "error" },
    { action: "glitch", type: "flash" },
    { action: "delay", ms: 200 },
    { action: "message", text: "!!! ALERT - SECURITY BREACH DETECTED !!!", cssClass: "term-error" },
    { action: "glitch", type: "sustained" },
    { action: "sound", sound: "alarm" },
  ],
  malfunction: [
    { action: "glitch", type: "static" },
    { action: "sound", sound: "glitch" },
    { action: "delay", ms: 500 },
    { action: "glitch", type: "tear" },
    { action: "delay", ms: 300 },
    { action: "glitch", type: "roll" },
    { action: "message", text: "ERROR: SYSTEM MALFUNCTION", cssClass: "term-error" },
    { action: "delay", ms: 400 },
    { action: "glitch", type: "colorSplit" },
    { action: "sound", sound: "error" },
  ],
  bootup: [
    { action: "sound", sound: "boot" },
    { action: "glitch", type: "flash" },
    { action: "delay", ms: 300 },
    { action: "message", text: "SYSTEM REBOOT INITIATED...", cssClass: "term-info" },
    { action: "delay", ms: 800 },
    { action: "message", text: "Loading kernel... OK", cssClass: "term-dim" },
    { action: "delay", ms: 400 },
    { action: "message", text: "Initializing services... OK", cssClass: "term-dim" },
    { action: "delay", ms: 400 },
    { action: "message", text: "SYSTEM ONLINE", cssClass: "term-success" },
    { action: "sound", sound: "success" },
    { action: "lock", locked: false },
  ],
  shutdown: [
    { action: "message", text: "INITIATING SHUTDOWN SEQUENCE...", cssClass: "term-warning" },
    { action: "sound", sound: "error" },
    { action: "delay", ms: 500 },
    { action: "message", text: "Terminating processes...", cssClass: "term-dim" },
    { action: "delay", ms: 600 },
    { action: "glitch", type: "interlace" },
    { action: "delay", ms: 500 },
    { action: "message", text: "SYSTEM OFFLINE", cssClass: "term-error" },
    { action: "lock", locked: true },
    { action: "glitch", type: "static" },
  ],
  hack: [
    { action: "glitch", type: "colorSplit" },
    { action: "sound", sound: "glitch" },
    { action: "delay", ms: 200 },
    { action: "message", text: ">>> INTRUSION DETECTED <<<", cssClass: "term-error" },
    { action: "glitch", type: "tear" },
    { action: "delay", ms: 300 },
    { action: "glitch", type: "sustained" },
    { action: "sound", sound: "hacking" },
    { action: "delay", ms: 500 },
    { action: "message", text: "FOREIGN ACCESS POINT IDENTIFIED", cssClass: "term-warning" },
    { action: "glitch", type: "flash" },
    { action: "delay", ms: 400 },
    { action: "message", text: "COUNTERMEASURES ENGAGED", cssClass: "term-info" },
    { action: "sound", sound: "beep" },
  ],
};

let GmControlsApplication = null;

export function getGmControlsApplicationClass() {
  if (GmControlsApplication) return GmControlsApplication;

  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  GmControlsApplication = class GmControlsApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "interactive-terminal-gm-controls",
      classes: ["interactive-terminal-gm-panel"],
      tag: "div",
      window: {
        frame: true,
        positioned: true,
        title: "Terminal - GM Controls",
        icon: "fas fa-terminal",
        minimizable: true,
        resizable: true,
      },
      position: {
        width: 420,
        height: 700,
      },
      actions: {},
    };

    static PARTS = {
      controls: {
        template: `modules/${MODULE_ID}/templates/gm-controls.hbs`,
      },
    };

    constructor() {
      super();
      this._selectedTerminalId = null;
    }

    get selectedTerminal() {
      return moduleState.terminals.get(this._selectedTerminalId);
    }

    _ensureTerminalOpen() {
      if (!this._selectedTerminalId) return null;
      let terminal = this.selectedTerminal;
      if (!terminal) {
        const config = game.settings.get(MODULE_ID, "terminals")[this._selectedTerminalId];
        if (config) {
          InteractiveTerminal.openTerminal(this._selectedTerminalId, config);
          terminal = moduleState.terminals.get(this._selectedTerminalId);
        }
      }
      return terminal;
    }

    async _prepareContext() {
      const terminals = game.settings.get(MODULE_ID, "terminals");
      const terminalList = Object.entries(terminals).map(([id, config]) => ({
        id,
        title: config.title || "Terminal",
        screen: config.screen,
        isOpen: moduleState.terminals.has(id),
        deployed: config.deployed || false,
      }));

      const selected = this._selectedTerminalId ? terminals[this._selectedTerminalId] : null;
      const players = game.users.filter((u) => !u.isGM).map((u) => ({
        id: u.id,
        name: u.name,
        permitted: selected?.permissions?.[u.id] ?? true,
      }));

      return {
        terminals: terminalList,
        selectedId: this._selectedTerminalId,
        selected,
        currentScreen: selected?.screen || "login",
        isDeployed: selected?.deployed || false,
        players,
        screens: [
          { id: "login", label: "Login" },
          { id: "chat", label: "Chat" },
          { id: "hacking", label: "Hacking" },
          { id: "command", label: "Command" },
          { id: "download", label: "Download" },
          { id: "countdown", label: "Countdown" },
          { id: "crash", label: "Crash" },
          { id: "boot", label: "Boot" },
        ],
        themes: [
          { id: "green", label: "Green" },
          { id: "amber", label: "Amber" },
          { id: "blue", label: "Blue" },
          { id: "white", label: "White" },
        ],
        glitchTypes: Object.keys(GlitchEffect.TYPES).map((t) => ({
          id: t, label: t.charAt(0).toUpperCase() + t.slice(1),
        })),
        soundTypes: Object.keys(SoundManager.SOUNDS).map((s) => ({
          id: s, label: SoundManager.SOUNDS[s].label,
        })),
        hackingWords: selected?.screenConfigs?.hacking?.words?.join(",") ?? "",
        isTerminalOpen: moduleState.terminals.has(this._selectedTerminalId),
        pendingCommands: this._selectedTerminalId ? getPendingCommands(this._selectedTerminalId) : [],
        isCommandScreen: selected?.screen === "command"
          || (this._selectedTerminalId && getPendingCommands(this._selectedTerminalId).length > 0)
          || moduleState.terminals.get(this._selectedTerminalId)?.currentScreen?.constructor?.screenId === "command",
        commandHostname: selected?.screenConfigs?.command?.hostname ?? "SYSTEM",
        commandPrompt: selected?.screenConfigs?.command?.prompt ?? ">",
        commandMotd: selected?.screenConfigs?.command?.motd ?? "",
        commandAutoResponses: selected?.screenConfigs?.command?.autoResponses ?? [],
        customSequences: selected?.customSequences ?? [],
        isDownloadScreen: this._currentScreenId() === "download",
        isCountdownScreen: this._currentScreenId() === "countdown",
        isCrashScreen: this._currentScreenId() === "crash",
        isBootScreen: this._currentScreenId() === "boot",
        downloadFilename: selected?.screenConfigs?.download?.filename ?? "DATA_PACKAGE.bin",
        downloadSize: selected?.screenConfigs?.download?.totalSize ?? "2.4 GB",
        downloadSpeed: selected?.screenConfigs?.download?.speed ?? 2,
        countdownDuration: selected?.screenConfigs?.countdown?.duration ?? 300,
        countdownLabel: selected?.screenConfigs?.countdown?.label ?? "TIME REMAINING",
        countdownExpireAction: selected?.screenConfigs?.countdown?.expireAction ?? "none",
        countdownExpireScreen: selected?.screenConfigs?.countdown?.expireScreen ?? "crash",
        crashPresets: [
          { id: "bluescreen", label: "Fatal Error" },
          { id: "corruption", label: "Data Corruption" },
          { id: "intrusion", label: "Security Breach" },
          { id: "overload", label: "System Overload" },
        ],
        crashPreset: selected?.screenConfigs?.crash?.preset ?? "bluescreen",
        bootNextScreen: selected?.screenConfigs?.boot?.nextScreen ?? "login",
      };
    }

    _currentScreenId() {
      if (!this._selectedTerminalId) return null;
      const terminal = moduleState.terminals.get(this._selectedTerminalId);
      if (terminal) return terminal.config.screen || null;
      const terminals = game.settings.get(MODULE_ID, "terminals");
      return terminals[this._selectedTerminalId]?.screen || null;
    }

    _onRender() {
      const el = this.element;

      // Terminal select
      el.querySelector(".gm-terminal-select")?.addEventListener("change", (e) => {
        this._selectedTerminalId = e.target.value || null;
        this.render();
      });

      // Create terminal
      this._on(el, "createTerminal", () => {
        const id = createNewTerminal();
        this._selectedTerminalId = id;
        this.render();
      });

      // Save title
      this._on(el, "saveTitle", () => {
        const title = el.querySelector(".gm-terminal-title")?.value?.trim();
        if (!title || !this._selectedTerminalId) return;
        this._updateTerminalConfig({ title });
        const terminal = this.selectedTerminal;
        if (terminal) terminal.updateConfig({ title });
        emitSocket("updateConfig", this._selectedTerminalId, { title });
        ui.notifications.info("Title updated");
      });

      // Preview (open locally for GM)
      this._on(el, "previewTerminal", () => {
        if (!this._selectedTerminalId) return;
        const config = game.settings.get(MODULE_ID, "terminals")[this._selectedTerminalId];
        if (config) InteractiveTerminal.openTerminal(this._selectedTerminalId, config);
      });

      // Deploy
      this._on(el, "deployTerminal", () => {
        if (!this._selectedTerminalId) return;
        deployTerminal(this._selectedTerminalId);
        this.render();
        ui.notifications.info("Terminal deployed to players");
      });

      // Undeploy
      this._on(el, "undeployTerminal", () => {
        if (!this._selectedTerminalId) return;
        undeployTerminal(this._selectedTerminalId);
        this.render();
        ui.notifications.info("Terminal hidden from players");
      });

      // Lock/Unlock
      this._on(el, "toggleLock", () => {
        const terminal = this.selectedTerminal;
        if (!terminal) return;
        const newLocked = !terminal.config.locked;
        terminal.setLocked(newLocked);
        this._updateTerminalConfig({ locked: newLocked });
        emitSocket("lockTerminal", this._selectedTerminalId, { locked: newLocked });
        this.render();
      });

      // Delete
      this._on(el, "deleteTerminal", async () => {
        if (!this._selectedTerminalId) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Terminal" },
          content: "<p>Are you sure you want to delete this terminal?</p>",
        });
        if (!confirmed) return;
        const terminal = moduleState.terminals.get(this._selectedTerminalId);
        if (terminal) { terminal.close(); moduleState.terminals.delete(this._selectedTerminalId); }
        emitSocket("closeTerminal", this._selectedTerminalId);
        const terminals = game.settings.get(MODULE_ID, "terminals");
        delete terminals[this._selectedTerminalId];
        await game.settings.set(MODULE_ID, "terminals", terminals);
        this._selectedTerminalId = null;
        this.render();
      });

      // Screen switch
      el.querySelectorAll("[data-action='switchScreen']").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const terminal = this.selectedTerminal;
          if (!terminal) return;
          const screen = e.currentTarget.dataset.screen;
          this._updateTerminalConfig({ screen });
          emitSocket("switchScreen", this._selectedTerminalId, { screen });
          await terminal.switchScreen(screen);
          this.render();
        });
      });

      // Reset screen
      this._on(el, "resetScreen", () => {
        const terminal = this.selectedTerminal;
        if (!terminal) return;
        terminal.resetScreen();
        emitSocket("resetScreen", this._selectedTerminalId, { screen: terminal.config.screen });
        ui.notifications.info("Screen reset");
      });

      // Theme
      el.querySelectorAll("[data-action='changeTheme']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const terminal = this.selectedTerminal;
          if (!terminal) return;
          const theme = e.currentTarget.dataset.theme;
          terminal.updateConfig({ theme });
          emitSocket("updateConfig", this._selectedTerminalId, { theme });
          this._updateTerminalConfig({ theme });
        });
      });

      // Permissions
      this._on(el, "updatePermissions", () => {
        const terminal = this.selectedTerminal;
        if (!terminal) return;
        const permissions = {};
        el.querySelectorAll(".gm-player-permission").forEach((cb) => {
          permissions[cb.dataset.userId] = cb.checked;
        });
        terminal.updatePermissions(permissions);
        emitSocket("updatePermissions", this._selectedTerminalId, permissions);
        this._updateTerminalConfig({ permissions });
      });

      // System message
      this._on(el, "sendSystemMessage", () => {
        const terminal = this._ensureTerminalOpen();
        const text = el.querySelector(".gm-system-message")?.value?.trim();
        const cssClass = el.querySelector(".gm-system-message-style")?.value || "term-warning";
        if (!text) return;
        if (terminal) terminal.showSystemMessage(text, cssClass);
        emitSocket("systemMessage", this._selectedTerminalId, { text, cssClass });
        el.querySelector(".gm-system-message").value = "";
      });

      // NPC message
      const sendNpcBtn = el.querySelector("[data-action='sendNpcMessage']");
      const npcTextarea = el.querySelector(".gm-npc-message");
      if (sendNpcBtn) sendNpcBtn.addEventListener("click", () => this._sendNpcMessage());
      if (npcTextarea) {
        npcTextarea.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._sendNpcMessage(); }
        });
      }

      // Glitch buttons
      el.querySelectorAll("[data-action='triggerGlitch']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const terminal = this._ensureTerminalOpen();
          const type = e.currentTarget.dataset.glitchType;
          if (terminal) GlitchEffect.trigger(terminal.element, type);
          emitSocket("triggerGlitch", this._selectedTerminalId, { type });
        });
      });

      // Glitch loop
      this._on(el, "startGlitchLoop", () => {
        const terminal = this._ensureTerminalOpen();
        const type = el.querySelector(".gm-loop-glitch-type")?.value || "short";
        const intervalSec = parseFloat(el.querySelector(".gm-loop-interval")?.value) || 3;
        const intervalMs = intervalSec * 1000;
        const loopKey = this._selectedTerminalId || "default";
        if (terminal) GlitchEffect.startLoop(terminal.element, type, intervalMs, loopKey);
        emitSocket("startGlitchLoop", this._selectedTerminalId, { type, intervalMs });
        ui.notifications.info(`Glitch loop: ${type} every ${intervalSec}s`);
      });

      this._on(el, "stopGlitchLoop", () => {
        const loopKey = this._selectedTerminalId || "default";
        GlitchEffect.stopLoop(loopKey);
        emitSocket("stopGlitchLoop", this._selectedTerminalId);
        ui.notifications.info("Glitch loop stopped");
      });

      // Sound buttons
      el.querySelectorAll("[data-action='playSound']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const sound = e.currentTarget.dataset.sound;
          SoundManager.play(sound);
          emitSocket("playSound", this._selectedTerminalId, { sound });
        });
      });

      // Macro buttons
      el.querySelectorAll("[data-action='runMacro']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          if (!this._selectedTerminalId) return;
          this._ensureTerminalOpen();
          const macroName = e.currentTarget.dataset.macro;
          const steps = PRESET_MACROS[macroName];
          if (!steps) return;
          runMacroSequence(this._selectedTerminalId, steps);
          // Also broadcast to players
          emitSocket("runMacro", this._selectedTerminalId, { steps });
        });
      });

      // GM Command Response
      const sendResponseBtn = el.querySelector("[data-action='sendGmResponse']");
      const responseTextarea = el.querySelector(".gm-command-response");
      if (sendResponseBtn) sendResponseBtn.addEventListener("click", () => this._sendCommandResponse());
      if (responseTextarea) {
        responseTextarea.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._sendCommandResponse(); }
        });
      }

      // Custom sequence editor
      this._on(el, "addSequenceStep", () => this._addSequenceStep());
      this._on(el, "removeLastStep", () => this._removeLastStep());
      this._on(el, "runCustomSequence", () => this._runCustomSequence());
      this._on(el, "saveCustomSequence", () => this._saveCustomSequence());

      el.querySelectorAll("[data-action='runSavedSequence']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const idx = parseInt(e.currentTarget.dataset.index);
          this._runSavedSequence(idx);
        });
      });

      el.querySelectorAll("[data-action='deleteSavedSequence']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const idx = parseInt(e.currentTarget.dataset.index);
          this._deleteSavedSequence(idx);
        });
      });

      // Download controls
      ["start", "pause", "resume", "interrupt", "reset"].forEach(cmd => {
        this._on(el, `download-${cmd}`, () => {
          const t = this._ensureTerminalOpen();
          if (t?.currentScreen) t.currentScreen[cmd]?.();
          emitSocket("downloadControl", this._selectedTerminalId, { cmd });
        });
      });

      this._on(el, "download-setProgress", () => {
        const val = parseFloat(el.querySelector(".gm-download-progress")?.value) || 0;
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen) t.currentScreen.setProgress?.(val);
        emitSocket("downloadControl", this._selectedTerminalId, { cmd: "setProgress", value: val });
      });

      // Countdown controls
      ["start", "stop"].forEach(cmd => {
        this._on(el, `countdown-${cmd}`, () => {
          const t = this._ensureTerminalOpen();
          if (t?.currentScreen) t.currentScreen[cmd]?.();
          emitSocket("countdownControl", this._selectedTerminalId, { cmd });
        });
      });

      this._on(el, "countdown-reset", () => {
        const dur = parseInt(el.querySelector(".gm-countdown-duration")?.value) || 300;
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen) t.currentScreen.reset?.(dur);
        emitSocket("countdownControl", this._selectedTerminalId, { cmd: "reset", duration: dur });
      });

      this._on(el, "countdown-addTime", () => {
        const sec = parseInt(el.querySelector(".gm-countdown-add")?.value) || 30;
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen) t.currentScreen.addTime?.(sec);
        emitSocket("countdownControl", this._selectedTerminalId, { cmd: "addTime", seconds: sec });
      });

      this._on(el, "countdown-subTime", () => {
        const sec = parseInt(el.querySelector(".gm-countdown-add")?.value) || 30;
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen) t.currentScreen.addTime?.(-sec);
        emitSocket("countdownControl", this._selectedTerminalId, { cmd: "addTime", seconds: -sec });
      });

      // Crash presets
      el.querySelectorAll("[data-action='setCrashPreset']").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const preset = e.currentTarget.dataset.preset;
          const t = this._ensureTerminalOpen();
          if (t?.currentScreen?.setPreset) t.currentScreen.setPreset(preset);
          emitSocket("crashPreset", this._selectedTerminalId, { preset });
          this._updateTerminalConfig({ screenConfigs: { crash: { preset } } });
        });
      });

      // Screen config forms
      el.querySelectorAll(".screen-config-form").forEach((form) => {
        form.addEventListener("submit", (e) => { e.preventDefault(); this._saveScreenConfig(form); });
      });
    }

    _on(container, actionName, handler) {
      container.querySelector(`[data-action='${actionName}']`)?.addEventListener("click", handler);
    }

    _updateTerminalConfig(partial) {
      const terminals = game.settings.get(MODULE_ID, "terminals");
      if (!terminals[this._selectedTerminalId]) return;
      Object.assign(terminals[this._selectedTerminalId], partial);
      game.settings.set(MODULE_ID, "terminals", terminals);
    }

    _sendNpcMessage() {
      const terminal = this.selectedTerminal;
      if (!terminal) return;
      const textarea = this.element.querySelector(".gm-npc-message");
      const nameInput = this.element.querySelector(".gm-npc-name");
      const text = textarea?.value?.trim();
      const npcName = nameInput?.value?.trim() || "SYSTEM";
      if (!text) return;

      const chatScreen = terminal._screenInstances?.chat;
      if (chatScreen) {
        chatScreen.sendNpcMessage(text, npcName);
      } else {
        emitSocket("chatMessage", this._selectedTerminalId, {
          sender: npcName, text, timestamp: Date.now(), isNpc: true,
        });
      }
      textarea.value = "";
    }

    _saveScreenConfig(form) {
      const terminal = this.selectedTerminal;
      if (!terminal) return;
      const formData = new FormData(form);
      const screenId = formData.get("screenId");
      const config = {};
      for (const [key, value] of formData.entries()) {
        if (key === "screenId") continue;
        if (key === "words") {
          config[key] = value.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean);
        } else if (key === "attempts" || key === "maxAttempts") {
          config[key] = parseInt(value) || 4;
        } else {
          config[key] = value;
        }
      }
      terminal.config.screenConfigs = terminal.config.screenConfigs || {};
      terminal.config.screenConfigs[screenId] = { ...terminal.config.screenConfigs[screenId], ...config };
      emitSocket("updateConfig", this._selectedTerminalId, { screenConfigs: { [screenId]: config } });
      terminal.saveConfig();
      ui.notifications.info(`Config saved for ${screenId}`);
    }

    _sendCommandResponse() {
      if (!this._selectedTerminalId) return;
      const textarea = this.element.querySelector(".gm-command-response");
      const text = textarea?.value?.trim();
      if (!text) return;
      sendGmResponse(this._selectedTerminalId, text);
      textarea.value = "";
    }

    _getSequenceStepsFromDom() {
      const steps = [];
      this.element.querySelectorAll(".sequence-step-row").forEach((row) => {
        const action = row.querySelector(".step-action")?.value;
        if (!action) return;
        const step = { action };
        switch (action) {
          case "delay":
            step.ms = parseInt(row.querySelector(".step-param-ms")?.value) || 500;
            break;
          case "glitch":
            step.type = row.querySelector(".step-param-type")?.value || "short";
            break;
          case "sound":
            step.sound = row.querySelector(".step-param-sound")?.value || "beep";
            break;
          case "screen":
            step.screen = row.querySelector(".step-param-screen")?.value || "login";
            break;
          case "message":
            step.text = row.querySelector(".step-param-text")?.value || "";
            step.cssClass = row.querySelector(".step-param-css")?.value || "term-warning";
            break;
          case "lock":
            step.locked = row.querySelector(".step-param-locked")?.value === "true";
            break;
        }
        steps.push(step);
      });
      return steps;
    }

    _addSequenceStep() {
      const container = this.element.querySelector(".sequence-steps-list");
      if (!container) return;
      const row = document.createElement("div");
      row.classList.add("sequence-step-row", "gm-row");
      row.innerHTML = `
        <select class="step-action gm-input" style="width:90px;">
          <option value="delay">Delay</option>
          <option value="glitch">Glitch</option>
          <option value="sound">Sound</option>
          <option value="screen">Screen</option>
          <option value="message">Message</option>
          <option value="lock">Lock</option>
        </select>
        <span class="step-params">
          <input type="number" class="step-param-ms gm-input" value="500" min="100" max="10000" step="100" style="width:70px;" placeholder="ms" />
        </span>
        <button type="button" class="gm-btn gm-btn-small gm-btn-danger step-remove"><i class="fas fa-times"></i></button>
      `;
      container.appendChild(row);
      const select = row.querySelector(".step-action");
      select.addEventListener("change", () => this._updateStepParams(row));
      row.querySelector(".step-remove").addEventListener("click", () => { row.remove(); });
    }

    _updateStepParams(row) {
      const action = row.querySelector(".step-action").value;
      const paramsEl = row.querySelector(".step-params");
      const glitchOpts = Object.keys(GlitchEffect.TYPES).map(t => `<option value="${t}">${t}</option>`).join("");
      const soundOpts = Object.keys(SoundManager.SOUNDS).map(s => `<option value="${s}">${SoundManager.SOUNDS[s].label}</option>`).join("");
      const paramHtml = {
        delay: `<input type="number" class="step-param-ms gm-input" value="500" min="100" max="10000" step="100" style="width:70px;" placeholder="ms" />`,
        glitch: `<select class="step-param-type gm-input">${glitchOpts}</select>`,
        sound: `<select class="step-param-sound gm-input">${soundOpts}</select>`,
        screen: `<select class="step-param-screen gm-input"><option value="login">Login</option><option value="chat">Chat</option><option value="hacking">Hacking</option><option value="command">Command</option><option value="download">Download</option><option value="countdown">Countdown</option><option value="crash">Crash</option><option value="boot">Boot</option></select>`,
        message: `<input type="text" class="step-param-text gm-input" placeholder="Message text" style="flex:1;" /><select class="step-param-css gm-input" style="width:80px;"><option value="term-warning">Warn</option><option value="term-error">Error</option><option value="term-success">OK</option><option value="term-info">Info</option></select>`,
        lock: `<select class="step-param-locked gm-input"><option value="true">Lock</option><option value="false">Unlock</option></select>`,
      };
      paramsEl.innerHTML = paramHtml[action] || "";
    }

    _removeLastStep() {
      const container = this.element.querySelector(".sequence-steps-list");
      if (container?.lastElementChild) container.lastElementChild.remove();
    }

    _runCustomSequence() {
      if (!this._selectedTerminalId) return;
      const steps = this._getSequenceStepsFromDom();
      if (steps.length === 0) return;
      this._ensureTerminalOpen();
      runMacroSequence(this._selectedTerminalId, steps);
      emitSocket("runMacro", this._selectedTerminalId, { steps });
    }

    _saveCustomSequence() {
      if (!this._selectedTerminalId) return;
      const nameInput = this.element.querySelector(".custom-sequence-name");
      const name = nameInput?.value?.trim();
      if (!name) { ui.notifications.warn("Enter a name for the sequence"); return; }
      const steps = this._getSequenceStepsFromDom();
      if (steps.length === 0) { ui.notifications.warn("Add at least one step"); return; }
      const terminals = game.settings.get(MODULE_ID, "terminals");
      const config = terminals[this._selectedTerminalId];
      if (!config) return;
      config.customSequences = config.customSequences || [];
      config.customSequences.push({ name, steps });
      game.settings.set(MODULE_ID, "terminals", terminals);
      nameInput.value = "";
      this.render();
      ui.notifications.info(`Sequence "${name}" saved`);
    }

    _runSavedSequence(index) {
      if (!this._selectedTerminalId) return;
      const terminals = game.settings.get(MODULE_ID, "terminals");
      const seq = terminals[this._selectedTerminalId]?.customSequences?.[index];
      if (!seq) return;
      this._ensureTerminalOpen();
      runMacroSequence(this._selectedTerminalId, seq.steps);
      emitSocket("runMacro", this._selectedTerminalId, { steps: seq.steps });
    }

    _deleteSavedSequence(index) {
      if (!this._selectedTerminalId) return;
      const terminals = game.settings.get(MODULE_ID, "terminals");
      const config = terminals[this._selectedTerminalId];
      if (!config?.customSequences) return;
      config.customSequences.splice(index, 1);
      game.settings.set(MODULE_ID, "terminals", terminals);
      this.render();
    }

    async close(options = {}) {
      moduleState.gmControls = null;
      return super.close(options);
    }
  };

  return GmControlsApplication;
}
