import {
  MODULE_ID,
  moduleState,
  emitSocket,
  createNewTerminal,
  deployTerminal,
  undeployTerminal,
  runMacroSequence,
  getPendingCommands,
  sendGmResponse,
} from "./module.js";
import { getTerminalApplicationClass } from "./terminal-app.js";
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
      const players = game.users
        .filter((u) => !u.isGM)
        .map((u) => ({
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
        screens: Object.entries(getTerminalApplicationClass().SCREENS).map(([id, cls]) => ({
          id,
          label: cls.screenName || id,
        })),
        loginSuccessScreen: selected?.screenConfigs?.login?.successScreen ?? "chat",
        themes: [
          { id: "green", label: "Green" },
          { id: "amber", label: "Amber" },
          { id: "blue", label: "Blue" },
          { id: "white", label: "White" },
        ],
        glitchTypes: Object.keys(GlitchEffect.TYPES).map((t) => ({
          id: t,
          label: t.charAt(0).toUpperCase() + t.slice(1),
        })),
        soundTypes: Object.keys(SoundManager.SOUNDS).map((s) => ({
          id: s,
          label: SoundManager.SOUNDS[s].label,
        })),
        hackingWords: selected?.screenConfigs?.hacking?.words?.join(",") ?? "",
        isTerminalOpen: moduleState.terminals.has(this._selectedTerminalId),
        pendingCommands: this._selectedTerminalId ? getPendingCommands(this._selectedTerminalId) : [],
        isCommandScreen:
          selected?.screen === "command" ||
          (this._selectedTerminalId && getPendingCommands(this._selectedTerminalId).length > 0) ||
          moduleState.terminals.get(this._selectedTerminalId)?.currentScreen?.constructor?.screenId === "command",
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
        isEmailScreen: this._currentScreenId() === "email",
        emailAccount: selected?.screenConfigs?.email?.accountName ?? "user@corp.local",
        isDiagnosticScreen: this._currentScreenId() === "diagnostic",
        diagnosticGauges: selected?.screenConfigs?.diagnostic?.gauges ?? [],
        isFileBrowserScreen: this._currentScreenId() === "fileBrowser",
        fileBrowserNavLocked: selected?.screenConfigs?.fileBrowser?.navigationLocked ?? false,
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

      el.querySelector(".gm-terminal-select")?.addEventListener("change", (e) => {
        this._selectedTerminalId = e.target.value || null;
        this.render();
      });

      this._on(el, "createTerminal", () => {
        const id = createNewTerminal();
        this._selectedTerminalId = id;
        this.render();
      });

      this._on(el, "saveTitle", () => {
        const title = el.querySelector(".gm-terminal-title")?.value?.trim();
        if (!title || !this._selectedTerminalId) return;
        this._updateTerminalConfig({ title });
        const terminal = this.selectedTerminal;
        if (terminal) terminal.updateConfig({ title });
        emitSocket("updateConfig", this._selectedTerminalId, { title });
        ui.notifications.info("Title updated");
      });

      this._on(el, "previewTerminal", () => {
        if (!this._selectedTerminalId) return;
        const config = game.settings.get(MODULE_ID, "terminals")[this._selectedTerminalId];
        if (config) InteractiveTerminal.openTerminal(this._selectedTerminalId, config);
      });

      this._on(el, "deployTerminal", () => {
        if (!this._selectedTerminalId) return;
        deployTerminal(this._selectedTerminalId);
        this.render();
        ui.notifications.info("Terminal deployed to players");
      });

      this._on(el, "undeployTerminal", () => {
        if (!this._selectedTerminalId) return;
        undeployTerminal(this._selectedTerminalId);
        this.render();
        ui.notifications.info("Terminal hidden from players");
      });

      this._on(el, "toggleLock", () => {
        const terminal = this.selectedTerminal;
        if (!terminal) return;
        const newLocked = !terminal.config.locked;
        terminal.setLocked(newLocked);
        this._updateTerminalConfig({ locked: newLocked });
        emitSocket("lockTerminal", this._selectedTerminalId, { locked: newLocked });
        this.render();
      });

      this._on(el, "deleteTerminal", async () => {
        if (!this._selectedTerminalId) return;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Terminal" },
          content: "<p>Are you sure you want to delete this terminal?</p>",
        });
        if (!confirmed) return;
        const terminal = moduleState.terminals.get(this._selectedTerminalId);
        if (terminal) {
          terminal.close();
          moduleState.terminals.delete(this._selectedTerminalId);
        }
        emitSocket("closeTerminal", this._selectedTerminalId);
        const terminals = game.settings.get(MODULE_ID, "terminals");
        delete terminals[this._selectedTerminalId];
        await game.settings.set(MODULE_ID, "terminals", terminals);
        this._selectedTerminalId = null;
        this.render();
      });

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

      this._on(el, "resetScreen", () => {
        const terminal = this.selectedTerminal;
        if (!terminal) return;
        terminal.resetScreen();
        emitSocket("resetScreen", this._selectedTerminalId, { screen: terminal.config.screen });
        ui.notifications.info("Screen reset");
      });

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

      this._on(el, "sendSystemMessage", () => {
        const terminal = this._ensureTerminalOpen();
        const text = el.querySelector(".gm-system-message")?.value?.trim();
        const cssClass = el.querySelector(".gm-system-message-style")?.value || "term-warning";
        if (!text) return;
        if (terminal) terminal.showSystemMessage(text, cssClass);
        emitSocket("systemMessage", this._selectedTerminalId, { text, cssClass });
        el.querySelector(".gm-system-message").value = "";
      });

      const sendNpcBtn = el.querySelector("[data-action='sendNpcMessage']");
      const npcTextarea = el.querySelector(".gm-npc-message");
      if (sendNpcBtn) sendNpcBtn.addEventListener("click", () => this._sendNpcMessage());
      if (npcTextarea) {
        npcTextarea.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this._sendNpcMessage();
          }
        });
      }

      el.querySelectorAll("[data-action='triggerGlitch']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const terminal = this._ensureTerminalOpen();
          const type = e.currentTarget.dataset.glitchType;
          if (terminal) GlitchEffect.trigger(terminal.element, type);
          emitSocket("triggerGlitch", this._selectedTerminalId, { type });
        });
      });

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

      el.querySelectorAll("[data-action='playSound']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const sound = e.currentTarget.dataset.sound;
          SoundManager.play(sound);
          emitSocket("playSound", this._selectedTerminalId, { sound });
        });
      });

      el.querySelectorAll("[data-action='runMacro']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          if (!this._selectedTerminalId) return;
          this._ensureTerminalOpen();
          const macroName = e.currentTarget.dataset.macro;
          const steps = PRESET_MACROS[macroName];
          if (!steps) return;
          runMacroSequence(this._selectedTerminalId, steps);
          emitSocket("runMacro", this._selectedTerminalId, { steps });
        });
      });

      const sendResponseBtn = el.querySelector("[data-action='sendGmResponse']");
      const responseTextarea = el.querySelector(".gm-command-response");
      if (sendResponseBtn) sendResponseBtn.addEventListener("click", () => this._sendCommandResponse());
      if (responseTextarea) {
        responseTextarea.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this._sendCommandResponse();
          }
        });
      }

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

      ["start", "pause", "resume", "interrupt", "reset"].forEach((cmd) => {
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

      ["start", "stop"].forEach((cmd) => {
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

      el.querySelectorAll("[data-action='setCrashPreset']").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const preset = e.currentTarget.dataset.preset;
          const t = this._ensureTerminalOpen();
          if (t?.currentScreen?.setPreset) t.currentScreen.setPreset(preset);
          emitSocket("crashPreset", this._selectedTerminalId, { preset });
          this._updateTerminalConfig({ screenConfigs: { crash: { preset } } });
        });
      });

      el.querySelectorAll(".screen-config-form").forEach((form) => {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          this._saveScreenConfig(form);
        });
      });

      // --- Diagnostic controls ---
      const diagSlider = el.querySelector(".gm-diagnostic-slider");
      const diagInput = el.querySelector(".gm-diagnostic-value");
      const diagSelect = el.querySelector(".gm-diagnostic-gauge-select");
      if (diagSlider && diagInput) {
        diagSlider.addEventListener("input", () => {
          diagInput.value = diagSlider.value;
        });
        diagInput.addEventListener("input", () => {
          diagSlider.value = diagInput.value;
        });
        if (diagSelect) {
          const syncValue = () => {
            const gaugeId = diagSelect.value;
            const gauges = this._getDiagnosticGauges();
            const gauge = gauges.find((g) => g.id === gaugeId);
            if (gauge) {
              diagSlider.value = gauge.value;
              diagInput.value = gauge.value;
            }
          };
          diagSelect.addEventListener("change", syncValue);
          syncValue();
        }
      }

      this._on(el, "diagnostic-setValue", () => {
        const gaugeId = el.querySelector(".gm-diagnostic-gauge-select")?.value;
        const value = parseFloat(el.querySelector(".gm-diagnostic-value")?.value) || 0;
        if (!gaugeId) return;
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.setGaugeValue) t.currentScreen.setGaugeValue(gaugeId, value);
        emitSocket("diagnosticControl", this._selectedTerminalId, { cmd: "setGaugeValue", gaugeId, value });
        this._updateDiagnosticGauge(gaugeId, value);
      });

      this._on(el, "diagnostic-addGauge", async () => {
        const label = await this._fbPrompt("Gauge label:");
        if (!label) return;
        const gauge = { id: foundry.utils.randomID(8), label: label.toUpperCase(), value: 100, status: "normal" };
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.addGauge) t.currentScreen.addGauge(gauge);
        emitSocket("diagnosticControl", this._selectedTerminalId, { cmd: "addGauge", gauge });
        const terminals = game.settings.get(MODULE_ID, "terminals");
        const config = terminals[this._selectedTerminalId];
        if (config) {
          config.screenConfigs = config.screenConfigs || {};
          config.screenConfigs.diagnostic = config.screenConfigs.diagnostic || { gauges: [] };
          config.screenConfigs.diagnostic.gauges.push(gauge);
          game.settings.set(MODULE_ID, "terminals", terminals);
        }
        this.render();
      });

      this._on(el, "diagnostic-removeGauge", () => {
        const gaugeId = el.querySelector(".gm-diagnostic-gauge-select")?.value;
        if (!gaugeId) return;
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.removeGauge) t.currentScreen.removeGauge(gaugeId);
        emitSocket("diagnosticControl", this._selectedTerminalId, { cmd: "removeGauge", gaugeId });
        const terminals = game.settings.get(MODULE_ID, "terminals");
        const config = terminals[this._selectedTerminalId];
        if (config?.screenConfigs?.diagnostic?.gauges) {
          config.screenConfigs.diagnostic.gauges = config.screenConfigs.diagnostic.gauges.filter(
            (g) => g.id !== gaugeId,
          );
          game.settings.set(MODULE_ID, "terminals", terminals);
        }
        this.render();
      });

      this._on(el, "diagnostic-alert", () => {
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.triggerAlert) t.currentScreen.triggerAlert();
        emitSocket("diagnosticControl", this._selectedTerminalId, { cmd: "triggerAlert" });
      });

      // --- Email controls ---
      this._on(el, "email-send", async () => {
        const from = el.querySelector(".gm-email-from")?.value?.trim() || "admin@corp.local";
        const subject = el.querySelector(".gm-email-subject")?.value?.trim() || "";
        const body = el.querySelector(".gm-email-body")?.value?.trim() || "";
        if (!subject && !body) return;
        const email = {
          id: foundry.utils.randomID(8),
          from,
          to: el.querySelector(".gm-email-to")?.value?.trim() || "user@corp.local",
          subject,
          body,
          date: el.querySelector(".gm-email-date")?.value ? new Date(el.querySelector(".gm-email-date").value).getTime() : Date.now(),
          read: false,
          starred: false,
          attachments: [],
        };
        const attInput = el.querySelector(".gm-email-attachments")?.value?.trim();
        if (attInput) {
          email.attachments = attInput.split(",").map((a) => {
            const parts = a.trim().split("|");
            return { name: parts[0]?.trim() || "file", size: parts[1]?.trim() || "" };
          }).filter((a) => a.name);
        }
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.receiveEmail) t.currentScreen.receiveEmail(email);
        emitSocket("emailControl", this._selectedTerminalId, { cmd: "receiveEmail", email });
        this._persistEmail(email);
        el.querySelector(".gm-email-subject").value = "";
        el.querySelector(".gm-email-body").value = "";
        if (el.querySelector(".gm-email-attachments")) el.querySelector(".gm-email-attachments").value = "";
        ui.notifications.info(`Email sent: "${subject}"`);
      });

      this._on(el, "email-clear", async () => {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Clear Inbox" },
          content: "<p>Delete all emails from this terminal?</p>",
        });
        if (!confirmed) return;
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.clearAll) t.currentScreen.clearAll();
        emitSocket("emailControl", this._selectedTerminalId, { cmd: "clearAll" });
        const terminals = game.settings.get(MODULE_ID, "terminals");
        const config = terminals[this._selectedTerminalId];
        if (config?.screenConfigs?.email) {
          config.screenConfigs.email.emails = [];
          game.settings.set(MODULE_ID, "terminals", terminals);
        }
      });

      this._on(el, "fb-lockNav", () => {
        const locked = !this._getFbConfig().navigationLocked;
        this._updateFbConfig({ navigationLocked: locked });
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.receiveNavigationLock) t.currentScreen.receiveNavigationLock({ locked });
        emitSocket("fileBrowserLockNav", this._selectedTerminalId, { locked });
        this.render();
      });

      this._on(el, "fb-forceHome", () => {
        const t = this._ensureTerminalOpen();
        if (t?.currentScreen?.receiveNavigate) t.currentScreen.receiveNavigate({ currentPath: [], openFile: null });
        emitSocket("fileBrowserNavigate", this._selectedTerminalId, { currentPath: [], openFile: null });
        this._updateFbConfig({ currentPath: [], openFile: null });
      });

      this._on(el, "fb-addFolder", () => this._fbAddNode("folder"));
      this._on(el, "fb-addFile", () => this._fbAddNode("file"));

      if (el.querySelector(".gm-fb-tree")) {
        this._renderFbTree();
      }
    }

    _on(container, actionName, handler) {
      container.querySelector(`[data-action='${actionName}']`)?.addEventListener("click", handler);
    }

    _persistEmail(email) {
      const terminals = game.settings.get(MODULE_ID, "terminals");
      const config = terminals[this._selectedTerminalId];
      if (!config) return;
      config.screenConfigs = config.screenConfigs || {};
      config.screenConfigs.email = config.screenConfigs.email || { emails: [] };
      config.screenConfigs.email.emails.unshift(email);
      game.settings.set(MODULE_ID, "terminals", terminals);
    }

    _getDiagnosticGauges() {
      const terminals = game.settings.get(MODULE_ID, "terminals");
      return terminals[this._selectedTerminalId]?.screenConfigs?.diagnostic?.gauges ?? [];
    }

    _updateDiagnosticGauge(gaugeId, value) {
      const terminals = game.settings.get(MODULE_ID, "terminals");
      const gauges = terminals[this._selectedTerminalId]?.screenConfigs?.diagnostic?.gauges;
      if (!gauges) return;
      const gauge = gauges.find((g) => g.id === gaugeId);
      if (gauge) {
        gauge.value = Math.max(0, Math.min(100, value));
        gauge.status = value <= 0 ? "failure" : value <= 20 ? "critical" : value <= 50 ? "warning" : "normal";
        game.settings.set(MODULE_ID, "terminals", terminals);
      }
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
          sender: npcName,
          text,
          timestamp: Date.now(),
          isNpc: true,
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
          config[key] = value
            .split(",")
            .map((w) => w.trim().toUpperCase())
            .filter(Boolean);
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
      row.querySelector(".step-remove").addEventListener("click", () => {
        row.remove();
      });
    }

    _updateStepParams(row) {
      const action = row.querySelector(".step-action").value;
      const paramsEl = row.querySelector(".step-params");
      const glitchOpts = Object.keys(GlitchEffect.TYPES)
        .map((t) => `<option value="${t}">${t}</option>`)
        .join("");
      const soundOpts = Object.keys(SoundManager.SOUNDS)
        .map((s) => `<option value="${s}">${SoundManager.SOUNDS[s].label}</option>`)
        .join("");
      const paramHtml = {
        delay: `<input type="number" class="step-param-ms gm-input" value="500" min="100" max="10000" step="100" style="width:70px;" placeholder="ms" />`,
        glitch: `<select class="step-param-type gm-input">${glitchOpts}</select>`,
        sound: `<select class="step-param-sound gm-input">${soundOpts}</select>`,
        screen: `<select class="step-param-screen gm-input">${Object.entries(getTerminalApplicationClass().SCREENS)
          .map(([id, cls]) => `<option value="${id}">${cls.screenName || id}</option>`)
          .join("")}</select>`,
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
      if (!name) {
        ui.notifications.warn("Enter a name for the sequence");
        return;
      }
      const steps = this._getSequenceStepsFromDom();
      if (steps.length === 0) {
        ui.notifications.warn("Add at least one step");
        return;
      }
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

    // --- File Browser helpers ---

    _getFbConfig() {
      const terminals = game.settings.get(MODULE_ID, "terminals");
      return terminals[this._selectedTerminalId]?.screenConfigs?.fileBrowser || {};
    }

    _updateFbConfig(partial) {
      const terminals = game.settings.get(MODULE_ID, "terminals");
      const config = terminals[this._selectedTerminalId];
      if (!config) return;
      config.screenConfigs = config.screenConfigs || {};
      config.screenConfigs.fileBrowser = config.screenConfigs.fileBrowser || {};
      Object.assign(config.screenConfigs.fileBrowser, partial);
      game.settings.set(MODULE_ID, "terminals", terminals);
    }

    _getFbFilesystem() {
      return (
        this._getFbConfig().filesystem || { id: "root", name: "root", type: "folder", hidden: false, children: [] }
      );
    }

    _saveFbFilesystem(fs) {
      this._updateFbConfig({ filesystem: fs });
      const t = this._ensureTerminalOpen();
      if (t?.currentScreen?.receiveFilesystemUpdate) t.currentScreen.receiveFilesystemUpdate({ filesystem: fs });
      emitSocket("fileBrowserEdit", this._selectedTerminalId, { filesystem: fs });
    }

    _findNodeById(node, id) {
      if (node.id === id) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = this._findNodeById(child, id);
          if (found) return found;
        }
      }
      return null;
    }

    _findParentNode(node, id) {
      if (node.children) {
        for (const child of node.children) {
          if (child.id === id) return node;
          const found = this._findParentNode(child, id);
          if (found) return found;
        }
      }
      return null;
    }

    async _fbAddNode(type) {
      if (type === "file") {
        const result = await this._fbFileTypePrompt();
        if (!result) return;
        const fs = this._getFbFilesystem();
        const parent = this._findNodeById(fs, this._fbSelectedParentId || "root") || fs;
        if (!parent.children) parent.children = [];
        const node = {
          id: foundry.utils.randomID(8),
          name: result.name,
          type: "file",
          hidden: false,
          contentType: result.contentType,
        };
        if (result.contentType === "image") {
          node.imagePath = result.imagePath || "";
          node.content = "";
        } else {
          node.content = "";
        }
        parent.children.push(node);
        this._saveFbFilesystem(fs);
        if (result.contentType === "text") this._fbEditContent(node.id);
        else this.render();
      } else {
        const name = await this._fbPrompt("Folder name:");
        if (!name) return;
        const fs = this._getFbFilesystem();
        const parent = this._findNodeById(fs, this._fbSelectedParentId || "root") || fs;
        if (!parent.children) parent.children = [];
        parent.children.push({
          id: foundry.utils.randomID(8),
          name,
          type: "folder",
          hidden: false,
          children: [],
        });
        this._saveFbFilesystem(fs);
        this.render();
      }
    }

    async _fbFileTypePrompt() {
      return foundry.applications.api.DialogV2.prompt({
        window: { title: "Add File" },
        content: `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div><label style="font-weight:bold;">Name</label><input id="fb-file-name" type="text" style="width:100%;" placeholder="filename.txt" autofocus /></div>
            <div><label style="font-weight:bold;">Type</label>
              <select id="fb-file-type" style="width:100%;">
                <option value="text">Text (log, email, report...)</option>
                <option value="image">Image</option>
              </select>
            </div>
          </div>`,
        ok: {
          label: "Create",
          callback: (event, button) => {
            const name = button.form.querySelector("#fb-file-name")?.value?.trim();
            if (!name) return null;
            return {
              name,
              contentType: button.form.querySelector("#fb-file-type")?.value || "text",
            };
          },
        },
      });
    }

    async _fbDeleteNode(nodeId) {
      const fs = this._getFbFilesystem();
      const parent = this._findParentNode(fs, nodeId);
      if (!parent) return;
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Delete" },
        content: "<p>Delete this item and all its children?</p>",
      });
      if (!confirmed) return;
      parent.children = parent.children.filter((c) => c.id !== nodeId);
      this._saveFbFilesystem(fs);
      this.render();
    }

    async _fbRenameNode(nodeId) {
      const fs = this._getFbFilesystem();
      const node = this._findNodeById(fs, nodeId);
      if (!node) return;
      const name = await this._fbPrompt("New name:", node.name);
      if (!name) return;
      node.name = name;
      this._saveFbFilesystem(fs);
      this.render();
    }

    _fbToggleHidden(nodeId) {
      const fs = this._getFbFilesystem();
      const node = this._findNodeById(fs, nodeId);
      if (!node) return;
      node.hidden = !node.hidden;
      this._saveFbFilesystem(fs);
      emitSocket("fileBrowserReveal", this._selectedTerminalId, { nodeId, hidden: node.hidden });
      this.render();
    }

    async _fbEditContent(nodeId) {
      const fs = this._getFbFilesystem();
      const node = this._findNodeById(fs, nodeId);
      if (!node || node.type !== "file") return;

      if (node.contentType === "image") {
        const fp = new FilePicker({
          type: "image",
          current: node.imagePath || "",
          callback: (path) => {
            node.imagePath = path;
            this._saveFbFilesystem(fs);
            this.render();
          },
        });
        fp.browse();
      } else {
        const content = await foundry.applications.api.DialogV2.prompt({
          window: { title: `Edit: ${node.name}` },
          content: `<textarea id="fb-edit-content" style="width:100%;height:200px;font-family:monospace;font-size:12px;">${this._escapeHtml(node.content || "")}</textarea>`,
          ok: {
            label: "Save",
            callback: (event, button) => button.form.querySelector("#fb-edit-content")?.value ?? "",
          },
        });
        if (content === null || content === undefined) return;
        node.content = content;
        this._saveFbFilesystem(fs);
        this.render();
      }
    }

    async _fbMoveNode(nodeId) {
      const fs = this._getFbFilesystem();
      const node = this._findNodeById(fs, nodeId);
      if (!node) return;
      const folders = [];
      this._collectFolders(fs, folders, "", nodeId);
      const options = folders
        .map((f) => `<option value="${this._escapeHtml(f.id)}">${this._escapeHtml(f.path || "/ (root)")}</option>`)
        .join("");
      const targetId = await foundry.applications.api.DialogV2.prompt({
        window: { title: `Move "${this._escapeHtml(node.name)}" to...` },
        content: `<select id="fb-move-target" style="width:100%;">${options}</select>`,
        ok: {
          label: "Move",
          callback: (event, button) => button.form.querySelector("#fb-move-target")?.value,
        },
      });
      if (!targetId) return;
      const parent = this._findParentNode(fs, nodeId);
      if (!parent) return;
      parent.children = parent.children.filter((c) => c.id !== nodeId);
      const target = this._findNodeById(fs, targetId);
      if (!target) return;
      if (!target.children) target.children = [];
      target.children.push(node);
      this._saveFbFilesystem(fs);
      this.render();
    }

    _collectFolders(node, result, pathPrefix, excludeId) {
      if (node.id === excludeId) return;
      if (node.type === "folder" || node.id === "root") {
        const path = node.id === "root" ? "" : pathPrefix + "/" + node.name;
        result.push({ id: node.id, path });
        if (node.children) {
          for (const child of node.children) {
            this._collectFolders(child, result, path, excludeId);
          }
        }
      }
    }

    _escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    async _fbPrompt(label, defaultValue = "") {
      return foundry.applications.api.DialogV2.prompt({
        window: { title: label },
        content: `<input id="fb-prompt-input" type="text" value="${this._escapeHtml(defaultValue)}" style="width:100%;" autofocus />`,
        ok: {
          label: "OK",
          callback: (event, button) => button.form.querySelector("#fb-prompt-input")?.value?.trim() ?? "",
        },
      });
    }

    _renderFbTree() {
      const container = this.element?.querySelector(".gm-fb-tree");
      if (!container) return;
      container.innerHTML = "";
      const fs = this._getFbFilesystem();
      this._fbSelectedParentId = "root";
      this._fbCollapsed = this._fbCollapsed || new Set();

      const rootDrop = document.createElement("div");
      rootDrop.classList.add("gm-fb-drop-root");
      rootDrop.textContent = "/ (root)";
      rootDrop.addEventListener("dragover", (e) => {
        e.preventDefault();
        rootDrop.classList.add("gm-fb-drop-hover");
      });
      rootDrop.addEventListener("dragleave", () => rootDrop.classList.remove("gm-fb-drop-hover"));
      rootDrop.addEventListener("drop", (e) => {
        e.preventDefault();
        rootDrop.classList.remove("gm-fb-drop-hover");
        this._fbDropNode(e.dataTransfer.getData("text/plain"), "root");
      });
      rootDrop.addEventListener("click", () => {
        this._fbSelectedParentId = "root";
        container.querySelectorAll(".gm-fb-node").forEach((n) => n.classList.remove("gm-fb-node-selected"));
        rootDrop.classList.add("gm-fb-node-selected");
        const label = this.element?.querySelector(".gm-fb-target-name");
        if (label) label.textContent = "/";
      });
      container.appendChild(rootDrop);

      if (fs.children?.length) {
        for (const child of fs.children) this._renderFbNode(container, child, 0);
      } else {
        const empty = document.createElement("div");
        empty.classList.add("gm-fb-empty", "term-dim");
        empty.textContent = "No files yet";
        container.appendChild(empty);
      }
    }

    _fbDropNode(draggedId, targetFolderId) {
      if (!draggedId || draggedId === targetFolderId) return;
      const fs = this._getFbFilesystem();
      const dragged = this._findNodeById(fs, draggedId);
      if (!dragged) return;
      if (dragged.type === "folder" && this._findNodeById(dragged, targetFolderId)) return;
      const parent = this._findParentNode(fs, draggedId);
      if (!parent) return;
      parent.children = parent.children.filter((c) => c.id !== draggedId);
      const target = this._findNodeById(fs, targetFolderId);
      if (!target) return;
      if (!target.children) target.children = [];
      target.children.push(dragged);
      this._saveFbFilesystem(fs);
      this.render();
    }

    _renderFbNode(container, node, depth) {
      const row = document.createElement("div");
      row.classList.add("gm-fb-node");
      row.dataset.nodeId = node.id;
      if (node.hidden) row.classList.add("gm-fb-node-hidden");

      row.draggable = true;
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", node.id);
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("gm-fb-dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("gm-fb-dragging"));

      if (node.type === "folder") {
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          row.classList.add("gm-fb-drop-hover");
        });
        row.addEventListener("dragleave", () => row.classList.remove("gm-fb-drop-hover"));
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove("gm-fb-drop-hover");
          this._fbDropNode(e.dataTransfer.getData("text/plain"), node.id);
        });
      }

      if (depth > 0) {
        row.style.paddingLeft = `${depth * 20 + 6}px`;
      }

      if (node.type === "folder") {
        const collapsed = this._fbCollapsed.has(node.id);
        const toggle = document.createElement("span");
        toggle.classList.add("gm-fb-toggle");
        toggle.innerHTML = `<i class="fas fa-caret-${collapsed ? "right" : "down"}"></i>`;
        toggle.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this._fbCollapsed.has(node.id)) this._fbCollapsed.delete(node.id);
          else this._fbCollapsed.add(node.id);
          this._renderFbTree();
        });
        row.appendChild(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.classList.add("gm-fb-toggle-spacer");
        row.appendChild(spacer);
      }

      const icon = document.createElement("i");
      const iconClass =
        node.type === "folder" ? "fa-folder" : node.contentType === "image" ? "fa-image" : "fa-file-alt";
      icon.classList.add("fas", iconClass);
      if (node.type === "folder") icon.classList.add("gm-fb-folder-icon");
      row.appendChild(icon);

      const name = document.createElement("span");
      name.classList.add("gm-fb-node-name");
      name.textContent = node.name;
      name.addEventListener("click", () => {
        const targetId =
          node.type === "folder" ? node.id : this._findParentNode(this._getFbFilesystem(), node.id)?.id || "root";
        this._fbSelectedParentId = targetId;
        const treeEl = this.element?.querySelector(".gm-fb-tree");
        treeEl
          ?.querySelectorAll(".gm-fb-node, .gm-fb-drop-root")
          .forEach((n) => n.classList.remove("gm-fb-node-selected"));
        row.classList.add("gm-fb-node-selected");
        const label = this.element?.querySelector(".gm-fb-target-name");
        if (label) {
          const targetNode = this._findNodeById(this._getFbFilesystem(), targetId);
          label.textContent = targetNode?.id === "root" ? "/" : targetNode?.name || "/";
        }
      });
      row.appendChild(name);

      const actions = document.createElement("span");
      actions.classList.add("gm-fb-node-actions");

      if (node.type === "file") {
        actions.appendChild(
          this._fbBtn("fa-pen", "Edit content", (e) => {
            e.stopPropagation();
            this._fbEditContent(node.id);
          }),
        );
      }
      actions.appendChild(
        this._fbBtn(node.hidden ? "fa-eye-slash" : "fa-eye", node.hidden ? "Reveal" : "Hide", (e) => {
          e.stopPropagation();
          this._fbToggleHidden(node.id);
        }),
      );
      actions.appendChild(
        this._fbBtn("fa-i-cursor", "Rename", (e) => {
          e.stopPropagation();
          this._fbRenameNode(node.id);
        }),
      );
      actions.appendChild(
        this._fbBtn(
          "fa-trash",
          "Delete",
          (e) => {
            e.stopPropagation();
            this._fbDeleteNode(node.id);
          },
          true,
        ),
      );

      row.appendChild(actions);
      container.appendChild(row);

      if (node.type === "folder" && node.children && !this._fbCollapsed.has(node.id)) {
        const sorted = [...node.children].sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (const child of sorted) this._renderFbNode(container, child, depth + 1);
      }
    }

    _fbBtn(iconClass, title, handler, danger = false) {
      const btn = document.createElement("span");
      btn.classList.add("gm-fb-action");
      if (danger) btn.classList.add("gm-fb-action-danger");
      btn.innerHTML = `<i class="fas ${iconClass}"></i>`;
      btn.title = title;
      btn.addEventListener("click", handler);
      return btn;
    }

    async close(options = {}) {
      moduleState.gmControls = null;
      return super.close(options);
    }
  };

  return GmControlsApplication;
}
