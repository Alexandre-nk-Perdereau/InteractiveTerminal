import { getTerminalApplicationClass } from "./terminal-app.js";
import { getGmControlsApplicationClass } from "./gm-controls.js";
import { GlitchEffect } from "./effects/glitch.js";
import { SoundManager } from "./effects/sounds.js";

const MODULE_ID = "interactive-terminal";

const moduleState = {
  terminals: new Map(),
  gmControls: null,
};

function registerSettings() {
  game.settings.register(MODULE_ID, "terminals", {
    name: "Terminal Configurations",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "defaultTheme", {
    name: game.i18n.localize("ITERM.Settings.DefaultTheme"),
    hint: game.i18n.localize("ITERM.Settings.DefaultThemeHint"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      green: "ITERM.Theme.Green",
      amber: "ITERM.Theme.Amber",
      blue: "ITERM.Theme.Blue",
      white: "ITERM.Theme.White",
    },
    default: "green",
  });

  game.settings.register(MODULE_ID, "enableSounds", {
    name: game.i18n.localize("ITERM.Settings.EnableSounds"),
    hint: game.i18n.localize("ITERM.Settings.EnableSoundsHint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
}

// --- Socket ---

function initSocket() {
  game.socket.on(`module.${MODULE_ID}`, handleSocketMessage);
}

function handleSocketMessage(data) {
  const { action, terminalId, payload, userId } = data;
  const handlers = {
    switchScreen: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.switchScreen(payload.screen);
    },
    chatMessage: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.currentScreen?.receiveMessage?.(payload);
    },
    updatePermissions: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.updatePermissions(payload);
    },
    triggerGlitch: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) GlitchEffect.trigger(t.element, payload.type, payload.duration);
    },
    playSound: () => {
      if (game.settings.get(MODULE_ID, "enableSounds")) SoundManager.play(payload.sound, payload.volume);
    },
    loginAttempt: () => {
      if (!game.user.isGM) return;
      const t = moduleState.terminals.get(terminalId);
      if (t) t.currentScreen?.processLoginAttempt?.(payload.password, userId);
    },
    hackingAction: () => {
      if (!game.user.isGM) return;
      const t = moduleState.terminals.get(terminalId);
      if (t) t.currentScreen?.processHackingAttempt?.(payload.word, userId);
    },
    openTerminal: () => openTerminal(terminalId, payload),
    closeTerminal: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) {
        t.close();
        moduleState.terminals.delete(terminalId);
      }
    },
    updateConfig: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.updateConfig(payload);
    },
    lockTerminal: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.setLocked(payload.locked);
    },
    systemMessage: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.showSystemMessage(payload.text, payload.cssClass);
    },
    resetScreen: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.resetScreen(payload.screen);
    },
    playerCommand: () => {
      if (!game.user.isGM) return;
      onPlayerCommand(terminalId, payload);
    },
    gmResponse: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) t.currentScreen?.receiveGmResponse?.(payload.text);
    },
    downloadControl: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t && t.currentScreen) {
        const s = t.currentScreen;
        const a = payload.cmd;
        if (a === "start") s.start?.();
        else if (a === "pause") s.pause?.();
        else if (a === "resume") s.resume?.();
        else if (a === "interrupt") s.interrupt?.();
        else if (a === "reset") s.reset?.();
        else if (a === "setProgress") s.setProgress?.(payload.value);
      }
    },
    countdownControl: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t && t.currentScreen) {
        const s = t.currentScreen;
        const a = payload.cmd;
        if (a === "start") s.start?.();
        else if (a === "stop") s.stop?.();
        else if (a === "reset") s.reset?.(payload.duration);
        else if (a === "addTime") s.addTime?.(payload.seconds);
        else if (a === "setTime") s.setTime?.(payload.seconds);
      }
    },
    crashPreset: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t && t.currentScreen?.setPreset) t.currentScreen.setPreset(payload.preset);
    },
    runMacro: () => runMacroSequence(terminalId, payload.steps),
    startGlitchLoop: () => {
      const t = moduleState.terminals.get(terminalId);
      if (t) GlitchEffect.startLoop(t.element, payload.type, payload.intervalMs, terminalId);
    },
    stopGlitchLoop: () => {
      GlitchEffect.stopLoop(terminalId);
    },
  };
  handlers[action]?.();
}

function emitSocket(action, terminalId, payload = {}) {
  game.socket.emit(`module.${MODULE_ID}`, { action, terminalId, payload, userId: game.user.id });
}

// --- Terminal Management ---

function openTerminal(terminalId, config = {}) {
  if (moduleState.terminals.has(terminalId)) {
    moduleState.terminals.get(terminalId).bringToFront();
    return;
  }
  const TerminalApp = getTerminalApplicationClass();
  const terminal = new TerminalApp(terminalId, config);
  moduleState.terminals.set(terminalId, terminal);
  terminal.render(true);
}

function createNewTerminal() {
  const terminalId = foundry.utils.randomID(16);
  const config = {
    title: game.i18n.localize("ITERM.Terminal.NewTerminal"),
    theme: game.settings.get(MODULE_ID, "defaultTheme"),
    screen: "login",
    locked: false,
    deployed: false,
    permissions: {},
    screenConfigs: {
      login: { username: "ADMIN", password: "password", successScreen: "chat" },
      chat: { npcName: "SYSTEM", messages: [] },
      hacking: {
        words: [
          "OVERRIDE",
          "TERMINAL",
          "NETWORK",
          "FIREWALL",
          "ENCRYPT",
          "SYSTEM",
          "SECURE",
          "ACCESS",
          "COMMAND",
          "CONTROL",
          "BREACH",
          "BYPASS",
          "CIPHER",
          "DECODE",
          "DAEMON",
          "KERNEL",
          "PROXY",
          "REBOOT",
          "SIGNAL",
          "STREAM",
          "BINARY",
          "PACKET",
          "SERVER",
          "MODULE",
        ],
        correctWord: "OVERRIDE",
        attempts: 4,
      },
      command: {
        hostname: "SYSTEM",
        prompt: ">",
        motd: "",
        autoResponses: [],
      },
      download: {
        filename: "DATA_PACKAGE.bin",
        totalSize: "2.4 GB",
        speed: 2,
      },
      countdown: {
        duration: 300,
        label: "TIME REMAINING",
        expireAction: "none",
        expireScreen: "crash",
      },
      crash: {
        preset: "bluescreen",
      },
      boot: {
        nextScreen: "login",
        autoTransition: true,
        transitionDelay: 1500,
      },
    },
  };

  const terminals = game.settings.get(MODULE_ID, "terminals");
  terminals[terminalId] = config;
  game.settings.set(MODULE_ID, "terminals", terminals);
  openTerminal(terminalId, config);
  return terminalId;
}

function deployTerminal(terminalId) {
  const terminals = game.settings.get(MODULE_ID, "terminals");
  const config = terminals[terminalId];
  if (!config) return;
  config.deployed = true;
  game.settings.set(MODULE_ID, "terminals", terminals);
  emitSocket("openTerminal", terminalId, config);
}

function undeployTerminal(terminalId) {
  const terminals = game.settings.get(MODULE_ID, "terminals");
  const config = terminals[terminalId];
  if (!config) return;
  config.deployed = false;
  game.settings.set(MODULE_ID, "terminals", terminals);
  emitSocket("closeTerminal", terminalId);
}

function restoreDeployedTerminals() {
  const terminals = game.settings.get(MODULE_ID, "terminals");
  for (const [id, config] of Object.entries(terminals)) {
    if (config.deployed) {
      openTerminal(id, config);
    }
  }
}

// --- Macro Sequences ---

async function runMacroSequence(terminalId, steps) {
  const terminal = moduleState.terminals.get(terminalId);
  for (const step of steps) {
    switch (step.action) {
      case "delay":
        await new Promise((r) => setTimeout(r, step.ms || 500));
        break;
      case "glitch":
        if (terminal) GlitchEffect.trigger(terminal.element, step.type || "short");
        emitSocket("triggerGlitch", terminalId, { type: step.type || "short" });
        break;
      case "sound":
        SoundManager.play(step.sound || "beep");
        emitSocket("playSound", terminalId, { sound: step.sound || "beep" });
        break;
      case "screen":
        if (terminal) terminal.switchScreen(step.screen);
        emitSocket("switchScreen", terminalId, { screen: step.screen });
        break;
      case "message":
        if (terminal) terminal.showSystemMessage(step.text, step.cssClass);
        emitSocket("systemMessage", terminalId, { text: step.text, cssClass: step.cssClass });
        break;
      case "lock":
        if (terminal) terminal.setLocked(step.locked ?? true);
        emitSocket("lockTerminal", terminalId, { locked: step.locked ?? true });
        break;
    }
  }
}

// --- Command Screen ---

const pendingCommands = new Map();

function onPlayerCommand(terminalId, payload) {
  const key = terminalId;
  if (!pendingCommands.has(key)) pendingCommands.set(key, []);
  pendingCommands.get(key).push({
    command: payload.command,
    userId: payload.userId,
    userName: payload.userName,
    timestamp: Date.now(),
  });
  if (moduleState.gmControls) moduleState.gmControls.render();
}

function getPendingCommands(terminalId) {
  return pendingCommands.get(terminalId) || [];
}

function clearPendingCommand(terminalId, index = 0) {
  const cmds = pendingCommands.get(terminalId);
  if (cmds) {
    cmds.splice(index, 1);
    if (cmds.length === 0) pendingCommands.delete(terminalId);
  }
}

function sendGmResponse(terminalId, text) {
  const terminal = moduleState.terminals.get(terminalId);
  if (terminal) terminal.currentScreen?.receiveGmResponse?.(text);
  emitSocket("gmResponse", terminalId, { text });
  clearPendingCommand(terminalId);
  if (moduleState.gmControls) moduleState.gmControls.render();
}

function onLocalGmCommand(terminalId, command) {
  onPlayerCommand(terminalId, {
    command,
    userId: game.user.id,
    userName: game.user.name,
  });
}

// --- Scene Controls ---

function registerSceneControls(controls) {
  const tokenControls = controls.tokens;
  if (!tokenControls || !game.user.isGM) return;
  tokenControls.tools.openTerminal = {
    name: "openTerminal",
    order: 100,
    title: game.i18n.localize("ITERM.Controls.OpenTerminal"),
    icon: "fa-solid fa-terminal",
    button: true,
    onChange: () => openGmPanel(),
  };
}

function openGmPanel() {
  if (moduleState.gmControls) {
    moduleState.gmControls.bringToFront();
    return;
  }
  const GmControls = getGmControlsApplicationClass();
  moduleState.gmControls = new GmControls();
  moduleState.gmControls.render(true);
}

// --- Hooks ---

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
  initSocket();
  restoreDeployedTerminals();
});

Hooks.on("getSceneControlButtons", registerSceneControls);

// --- Public API ---

globalThis.InteractiveTerminal = {
  MODULE_ID,
  state: moduleState,
  openTerminal,
  createNewTerminal,
  deployTerminal,
  undeployTerminal,
  openGmPanel,
  emitSocket,
  runMacroSequence,
  getPendingCommands,
  sendGmResponse,
  clearPendingCommand,
  onLocalGmCommand,
};

export {
  MODULE_ID,
  moduleState,
  openTerminal,
  createNewTerminal,
  deployTerminal,
  undeployTerminal,
  emitSocket,
  runMacroSequence,
  getPendingCommands,
  sendGmResponse,
  clearPendingCommand,
  onLocalGmCommand,
};
