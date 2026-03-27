import { getTerminalApplicationClass } from "./terminal-app.js";
import { getGmControlsApplicationClass } from "./gm-controls.js";
import { GlitchEffect } from "./effects/glitch.js";
import { SoundManager } from "./effects/sounds.js";
import {
  getFullConfig,
  getTerminalConfig,
  getScreenState,
  getAllTerminalIds,
  isTerminalPublicDoc,
  getTerminalIdFromDoc,
  createTerminalDocuments,
  updateTerminalConfig,
  updateScreenState,
  handleLoginAttempt,
  handleHackingAttempt,
  handlePlayerChat,
  handlePlayerCommand,
  handleFileBrowserNavigate,
  handleEmailNavigate,
} from "./data-layer.js";
const MODULE_ID = "interactive-terminal";

const moduleState = {
  terminals: new Map(),
  gmControls: null,
};

const pendingCommands = new Map();

function registerSettings() {
  game.settings.register(MODULE_ID, "terminalIndex", {
    name: "Terminal Index",
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

function initSocket() {
  game.socket.on(`module.${MODULE_ID}`, handleSocketMessage);
}

async function handleSocketMessage(data) {
  const { action, terminalId, payload, userId } = data;
  const t = moduleState.terminals.get(terminalId);

  switch (action) {
    case "openTerminal":
      openTerminal(terminalId);
      break;

    case "closeTerminal":
      if (t) {
        t.close();
        moduleState.terminals.delete(terminalId);
      }
      break;

    case "inputSync":
      if (game.user.id !== userId && t) {
        t.receiveInputSync(payload.field, payload.value, userId);
      }
      break;

    case "ephemeralEffect":
      if (payload.type === "glitch" && t) {
        GlitchEffect.trigger(t.element, payload.glitchType, payload.duration);
      } else if (payload.type === "sound") {
        if (game.settings.get(MODULE_ID, "enableSounds")) {
          SoundManager.play(payload.sound, payload.volume);
        }
      }
      break;

    case "startGlitchLoop":
      if (t) GlitchEffect.startLoop(t.element, payload.type, payload.intervalMs, terminalId);
      break;

    case "stopGlitchLoop":
      GlitchEffect.stopLoop(terminalId);
      break;

    case "runMacro":
      await runMacroSequence(terminalId, payload.steps);
      break;

    case "resetScreen":
      if (t) t.resetScreen(payload.screen);
      break;

    case "requestAction":
      if (!game.user.isGM) break;
      if (game.users.activeGM?.id !== game.user.id) break;
      await handleRequestAction(terminalId, payload);
      break;
  }
}

function emitSocket(action, terminalId, payload = {}) {
  game.socket.emit(`module.${MODULE_ID}`, { action, terminalId, payload, userId: game.user.id });
}

function initDocumentHook() {
  Hooks.on("updateJournalEntry", (doc) => {
    if (!isTerminalPublicDoc(doc)) return;
    const terminalId = getTerminalIdFromDoc(doc);
    if (!terminalId) return;

    const t = moduleState.terminals.get(terminalId);
    if (t) {
      const config = doc.getFlag(MODULE_ID, "config") || {};
      const screenState = doc.getFlag(MODULE_ID, "screenState") || {};
      const fullConfig = { ...config, screenConfigs: screenState };
      t.applyDocumentUpdate(fullConfig);
    }

    if (moduleState.gmControls) moduleState.gmControls.render();
  });
}

async function handleRequestAction(terminalId, payload) {
  const handlers = {
    loginAttempt: handleLoginAttempt,
    hackingAttempt: handleHackingAttempt,
    playerChat: handlePlayerChat,
    playerCommand: handlePlayerCommand,
    fileBrowserNavigate: handleFileBrowserNavigate,
    emailNavigate: handleEmailNavigate,
  };
  const handler = handlers[payload.type];
  if (!handler) return;
  const result = await handler(payload);
  if (payload.type === "playerCommand" && result?.success) {
    onPlayerCommand(terminalId, payload.command, payload.userName || "Player");
  }
}

function emitRequestAction(terminalId, type, data = {}) {
  const payload = { type, ...data, terminalId };
  if (game.user.isGM) {
    handleRequestAction(terminalId, payload);
  } else {
    emitSocket("requestAction", terminalId, payload);
  }
}

function openTerminal(terminalId) {
  if (moduleState.terminals.has(terminalId)) {
    const existing = moduleState.terminals.get(terminalId);
    if (existing.element) existing.bringToFront();
    return;
  }

  const config = getFullConfig(terminalId);
  if (!config) return;

  const TerminalApp = getTerminalApplicationClass();
  const terminal = new TerminalApp(terminalId, config);
  moduleState.terminals.set(terminalId, terminal);
  terminal.render(true);
}

async function createNewTerminal() {
  const terminalId = foundry.utils.randomID(16);
  const config = {
    title: game.i18n.localize("ITERM.Terminal.NewTerminal"),
    theme: game.settings.get(MODULE_ID, "defaultTheme"),
    screen: "login",
    locked: false,
    deployed: false,
    permissions: {},
    screenConfigs: {
      login: {
        username: "ADMIN",
        password: "password",
        successScreen: "chat",
        attempts: 0,
        locked: false,
        lastResult: null,
      },
      chat: {
        npcName: "SYSTEM",
        messages: [
          {
            sender: "SYSTEM",
            text: game.i18n.localize("ITERM.Chat.WelcomeMessage"),
            timestamp: Date.now(),
            isNpc: true,
          },
        ],
      },
      hacking: {
        words: [
          "ARCHIVE",
          "BREAKER",
          "CIRCUIT",
          "DECRYPT",
          "EXPLOIT",
          "FIREWAL",
          "GATEWAY",
          "HACKING",
          "INSTALL",
          "JAILBRK",
          "KEYCARD",
          "LOCKOUT",
          "MALWARE",
          "NETWORK",
          "OPERATE",
          "PROGRAM",
          "QUANTUM",
          "REBOUND",
          "SCANNER",
          "TRACKER",
          "UPLINKS",
          "VOLTAGE",
          "WARDENS",
          "XCHANGE",
        ],
        correctWord: "DECRYPT",
        attempts: 4,
        gridSeed: foundry.utils.randomID(8),
        guesses: [],
        attemptsLeft: 4,
        solved: false,
        locked: false,
      },
      command: {
        hostname: "SYSTEM",
        prompt: ">",
        motd: "",
        autoResponses: [],
        history: [],
        waiting: false,
      },
      download: {
        filename: "DATA_PACKAGE.bin",
        totalSize: "2.4 GB",
        speed: 2,
        progress: 0,
        running: false,
        completed: false,
        interrupted: false,
        log: [],
      },
      countdown: {
        duration: 300,
        label: "TIME REMAINING",
        expireAction: "none",
        expireScreen: "crash",
        remaining: 300,
        running: false,
        expired: false,
        targetTime: null,
      },
      crash: { preset: "bluescreen" },
      boot: { nextScreen: "login", autoTransition: true, transitionDelay: 1500 },
      email: {
        accountName: "user@corp.local",
        openThreadId: null,
        emails: [
          {
            id: "welcome",
            from: "admin@corp.local",
            to: "user@corp.local",
            subject: "Welcome to CorpNet Secure Mail",
            body: "Your secure email account has been provisioned.\n\nPlease review the attached security policy before accessing classified materials.\n\nAll communications on this channel are monitored and logged.\n\n- System Administrator",
            date: Date.now() - 86400000,
            read: false,
            starred: false,
            attachments: [{ name: "SECURITY_POLICY_v3.2.pdf", size: "1.4 MB" }],
          },
        ],
      },
      diagnostic: {
        gauges: [
          { id: "reactor", label: "REACTOR", value: 100, status: "normal" },
          { id: "shields", label: "SHIELDS", value: 85, status: "normal" },
          { id: "oxygen", label: "OXYGEN", value: 92, status: "normal" },
          { id: "hull", label: "HULL INTEGRITY", value: 100, status: "normal" },
          { id: "power", label: "POWER GRID", value: 78, status: "normal" },
        ],
      },
      fileBrowser: {
        filesystem: { id: "root", name: "root", type: "folder", hidden: false, children: [] },
        currentPath: [],
        openFile: null,
        navigationLocked: false,
      },
    },
  };

  await createTerminalDocuments(terminalId, config);
  openTerminal(terminalId);
  return terminalId;
}

async function deployTerminal(terminalId) {
  await updateTerminalConfig(terminalId, { deployed: true });
  emitSocket("openTerminal", terminalId);
}

async function undeployTerminal(terminalId) {
  await updateTerminalConfig(terminalId, { deployed: false });
  emitSocket("closeTerminal", terminalId);
}

function restoreDeployedTerminals() {
  for (const terminalId of getAllTerminalIds()) {
    const config = getTerminalConfig(terminalId);
    if (config?.deployed) {
      openTerminal(terminalId);
    }
  }
}

function emitEphemeralEffect(terminalId, effectPayload) {
  emitSocket("ephemeralEffect", terminalId, effectPayload);
  const t = moduleState.terminals.get(terminalId);
  if (effectPayload.type === "glitch" && t) {
    GlitchEffect.trigger(t.element, effectPayload.glitchType, effectPayload.duration);
  } else if (effectPayload.type === "sound") {
    if (game.settings.get(MODULE_ID, "enableSounds")) SoundManager.play(effectPayload.sound, effectPayload.volume);
  }
}

async function runMacroSequence(terminalId, steps) {
  for (const step of steps) {
    switch (step.action) {
      case "delay":
        await new Promise((r) => setTimeout(r, step.ms || 500));
        break;
      case "glitch":
        emitEphemeralEffect(terminalId, { type: "glitch", glitchType: step.type || "short" });
        break;
      case "sound":
        emitEphemeralEffect(terminalId, { type: "sound", sound: step.sound || "beep" });
        break;
      case "screen":
        await updateTerminalConfig(terminalId, { screen: step.screen });
        break;
      case "message": {
        const screenState = getScreenState(terminalId);
        if (!screenState) break;
        const config = getTerminalConfig(terminalId);
        const screenId = config?.screen || "login";
        const sc = screenState[screenId];
        if (sc?.messages) {
          sc.messages.push({
            sender: "SYSTEM",
            text: step.text,
            timestamp: Date.now(),
            isSystem: true,
            cssClass: step.cssClass,
          });
          await updateScreenState(terminalId, screenId, sc);
        } else if (sc?.history) {
          sc.history.push({ type: "response", text: `[SYSTEM] ${step.text}` });
          await updateScreenState(terminalId, screenId, sc);
        }
        break;
      }
      case "lock":
        await updateTerminalConfig(terminalId, { locked: step.locked ?? true });
        break;
    }
  }
}

function onPlayerCommand(terminalId, command, userName) {
  if (!pendingCommands.has(terminalId)) pendingCommands.set(terminalId, []);
  pendingCommands.get(terminalId).push({
    command,
    userName,
    timestamp: Date.now(),
  });
  ui.notifications.info(`Terminal command from ${userName}: ${command}`);
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

async function sendGmResponse(terminalId, text) {
  const screenState = getScreenState(terminalId);
  if (!screenState) return;
  const cmd = { ...(screenState.command || {}), history: [...(screenState.command?.history || [])] };
  cmd.history.push({ type: "response", text });
  cmd.waiting = false;
  await updateScreenState(terminalId, "command", cmd);
  clearPendingCommand(terminalId);
}

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
    if (moduleState.gmControls.element) moduleState.gmControls.bringToFront();
    return;
  }
  const GmControls = getGmControlsApplicationClass();
  moduleState.gmControls = new GmControls();
  moduleState.gmControls.render(true);
}

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", async () => {
  initSocket();
  initDocumentHook();

  restoreDeployedTerminals();
});

Hooks.on("getSceneControlButtons", registerSceneControls);

globalThis.InteractiveTerminal = {
  MODULE_ID,
  state: moduleState,
  openTerminal,
  createNewTerminal,
  deployTerminal,
  undeployTerminal,
  openGmPanel,
  emitSocket,
  emitRequestAction,
  emitEphemeralEffect,
  runMacroSequence,
  getPendingCommands,
  sendGmResponse,
  clearPendingCommand,
};

export {
  MODULE_ID,
  moduleState,
  openTerminal,
  createNewTerminal,
  deployTerminal,
  undeployTerminal,
  emitSocket,
  emitRequestAction,
  emitEphemeralEffect,
  runMacroSequence,
  getPendingCommands,
  sendGmResponse,
  clearPendingCommand,
};
