import { getTerminalApplicationClass } from "./terminal-app.js";
import { getGmControlsApplicationClass } from "./gm-controls.js";
import { GlitchEffect } from "./effects/glitch.js";
import { SoundManager } from "./effects/sounds.js";

const MODULE_ID = "interactive-terminal";

const moduleState = {
  terminals: new Map(),
  gmControls: null,
};

const _persistTimers = new Map();
function debouncedPersist(terminalId, config, delay = 500) {
  if (_persistTimers.has(terminalId)) clearTimeout(_persistTimers.get(terminalId));
  _persistTimers.set(
    terminalId,
    setTimeout(async () => {
      _persistTimers.delete(terminalId);
      const terminals = game.settings.get(MODULE_ID, "terminals");
      terminals[terminalId] = config;
      await game.settings.set(MODULE_ID, "terminals", terminals);
    }, delay),
  );
}

function broadcastStateSync(terminalId, trigger, triggerData = {}) {
  const terminals = game.settings.get(MODULE_ID, "terminals");
  const config = terminals[terminalId];
  if (!config) return;
  const payload = {
    ...foundry.utils.deepClone(config),
    _syncMeta: { timestamp: Date.now(), trigger, triggerData },
  };
  game.socket.emit(`module.${MODULE_ID}`, {
    action: "stateSync",
    terminalId,
    payload,
    userId: game.user.id,
  });
  const t = moduleState.terminals.get(terminalId);
  if (t) t.applyStateSync(payload);
  if (moduleState.gmControls) moduleState.gmControls.render();
}

function sendStateSyncToUser(terminalId, targetUserId) {
  const terminals = game.settings.get(MODULE_ID, "terminals");
  const config = terminals[terminalId];
  if (!config) return;
  const payload = {
    ...foundry.utils.deepClone(config),
    _syncMeta: { timestamp: Date.now(), trigger: "requestSync", triggerData: { targetUserId } },
  };
  game.socket.emit(`module.${MODULE_ID}`, {
    action: "stateSync",
    terminalId,
    payload,
    userId: game.user.id,
  });
}

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

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function initSocket() {
  game.socket.on(`module.${MODULE_ID}`, handleSocketMessage);
}

async function handleSocketMessage(data) {
  const { action, terminalId, payload, userId } = data;
  const t = moduleState.terminals.get(terminalId);

  const handlers = {
    openTerminal: () => openTerminal(terminalId, payload),
    closeTerminal: () => {
      if (t) {
        t.close();
        moduleState.terminals.delete(terminalId);
      }
    },
    resetScreen: () => {
      if (t) t.resetScreen(payload.screen);
    },
    runMacro: () => runMacroSequence(terminalId, payload.steps),
    startGlitchLoop: () => {
      if (t) GlitchEffect.startLoop(t.element, payload.type, payload.intervalMs, terminalId);
    },
    stopGlitchLoop: () => {
      GlitchEffect.stopLoop(terminalId);
    },

    stateSync: () => {
      if (game.user.isGM) return;
      const targetUserId = payload._syncMeta?.triggerData?.targetUserId;
      if (targetUserId && targetUserId !== game.user.id) return;
      if (t) t.applyStateSync(payload);
    },

    inputSync: () => {
      if (game.user.id === userId) return;
      if (t) t.receiveInputSync(payload.field, payload.value, userId);
    },

    requestAction: async () => {
      if (!game.user.isGM) return;
      if (game.users.activeGM?.id !== game.user.id) return;
      await handleRequestAction(terminalId, payload, userId);
    },

    requestSync: () => {
      if (!game.user.isGM) return;
      if (game.users.activeGM?.id !== game.user.id) return;
      sendStateSyncToUser(terminalId, userId);
    },

    ephemeralEffect: () => {
      if (payload.type === "glitch" && t) {
        GlitchEffect.trigger(t.element, payload.glitchType, payload.duration);
      } else if (payload.type === "sound") {
        if (game.settings.get(MODULE_ID, "enableSounds")) SoundManager.play(payload.sound, payload.volume);
      }
    },
  };
  const handler = handlers[action];
  if (!handler) return;
  try {
    await handler();
  } catch (err) {
    Hooks.onError(`${MODULE_ID}.handleSocketMessage`, err, { action, terminalId, notify: "warn" });
  }
}

async function handleRequestAction(terminalId, payload, userId) {
  const terminals = game.settings.get(MODULE_ID, "terminals");
  const config = terminals[terminalId];
  if (!config) return;

  const trigger = payload.type;
  let triggerData = {};

  switch (payload.type) {
    case "playerChat": {
      if (!config.screenConfigs.chat) config.screenConfigs.chat = { messages: [] };
      const messages = config.screenConfigs.chat.messages;
      const termUser = config.screenConfigs?.login?.username || "USER";
      messages.push({
        sender: termUser,
        text: payload.text,
        timestamp: Date.now(),
        isUser: true,
      });
      triggerData = { newMessageIndex: messages.length - 1 };
      break;
    }
    case "playerCommand": {
      if (!config.screenConfigs.command) config.screenConfigs.command = { history: [] };
      if (!config.screenConfigs.command.history) config.screenConfigs.command.history = [];
      config.screenConfigs.command.history.push({
        type: "command",
        text: payload.command,
      });
      config.screenConfigs.command.waiting = true;
      triggerData = { command: payload.command, userId };
      onPlayerCommand(terminalId, payload);
      break;
    }
    case "loginAttempt": {
      const expectedPassword = config.screenConfigs?.login?.password;
      const expectedHash = await hashPassword(expectedPassword || "");
      const correct = payload.passwordHash === expectedHash;
      if (!config.screenConfigs.login) config.screenConfigs.login = {};
      config.screenConfigs.login.attempts = (config.screenConfigs.login.attempts || 0) + 1;
      config.screenConfigs.login.lastResult = correct ? "granted" : "denied";
      if (correct) {
        const successScreen = config.screenConfigs.login.successScreen || "chat";
        setTimeout(() => {
          config.screen = successScreen;
          config.screenConfigs.login.lastResult = null;
          const allTerminals = game.settings.get(MODULE_ID, "terminals");
          allTerminals[terminalId] = config;
          game.settings.set(MODULE_ID, "terminals", allTerminals);
          broadcastStateSync(terminalId, "screenSwitch", { screen: successScreen });
        }, 2500);
      }
      triggerData = { correct, userId };
      break;
    }
    case "hackingAttempt": {
      if (!config.screenConfigs.hacking) break;
      const hc = config.screenConfigs.hacking;
      if (!hc.guesses) hc.guesses = [];
      if (!hc.attemptsLeft && hc.attemptsLeft !== 0) hc.attemptsLeft = hc.attempts || 4;
      const word = payload.word;
      if (hc.guesses.includes(word) || hc.solved || hc.locked) break;
      hc.guesses.push(word);
      if (word === hc.correctWord) {
        hc.solved = true;
      } else {
        hc.attemptsLeft = Math.max(0, hc.attemptsLeft - 1);
        if (hc.attemptsLeft <= 0) hc.locked = true;
      }
      triggerData = { word, userId };
      break;
    }
    case "fileBrowserNavigate": {
      if (!config.screenConfigs.fileBrowser) break;
      config.screenConfigs.fileBrowser.currentPath = payload.currentPath;
      config.screenConfigs.fileBrowser.openFile = payload.openFile;
      triggerData = { currentPath: payload.currentPath, openFile: payload.openFile };
      break;
    }
    case "emailNavigate": {
      if (!config.screenConfigs.email) break;
      config.screenConfigs.email.openThreadId = payload.openThreadId;
      if (payload.emails) config.screenConfigs.email.emails = payload.emails;
      break;
    }
    default:
      return;
  }

  debouncedPersist(terminalId, config);
  broadcastStateSync(terminalId, trigger, triggerData);
}

function emitSocket(action, terminalId, payload = {}) {
  game.socket.emit(`module.${MODULE_ID}`, { action, terminalId, payload, userId: game.user.id });
}

function openTerminal(terminalId, config = {}) {
  if (moduleState.terminals.has(terminalId)) {
    const existing = moduleState.terminals.get(terminalId);
    if (existing.element) existing.bringToFront();
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
      crash: {
        preset: "bluescreen",
      },
      boot: {
        nextScreen: "login",
        autoTransition: true,
        transitionDelay: 1500,
      },
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
        filesystem: {
          id: "root",
          name: "root",
          type: "folder",
          hidden: false,
          children: [],
        },
        currentPath: [],
        openFile: null,
        navigationLocked: false,
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
      if (!game.user.isGM) {
        emitSocket("requestSync", id);
      }
    }
  }
}

function emitRequestAction(terminalId, type, data = {}) {
  const payload = { type, ...data };
  if (game.user.isGM) {
    handleRequestAction(terminalId, payload, game.user.id);
  } else {
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "requestAction",
      terminalId,
      payload,
      userId: game.user.id,
    });
  }
}

function emitEphemeralEffect(terminalId, effectPayload) {
  game.socket.emit(`module.${MODULE_ID}`, {
    action: "ephemeralEffect",
    terminalId,
    payload: effectPayload,
    userId: game.user.id,
  });
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
        emitSocket("ephemeralEffect", terminalId, { type: "glitch", glitchType: step.type || "short" });
        break;
      case "sound":
        emitEphemeralEffect(terminalId, { type: "sound", sound: step.sound || "beep" });
        emitSocket("ephemeralEffect", terminalId, { type: "sound", sound: step.sound || "beep" });
        break;
      case "screen": {
        const terminals = game.settings.get(MODULE_ID, "terminals");
        if (terminals[terminalId]) {
          terminals[terminalId].screen = step.screen;
          game.settings.set(MODULE_ID, "terminals", terminals);
        }
        broadcastStateSync(terminalId, "screenSwitch");
        break;
      }
      case "message": {
        const terminals = game.settings.get(MODULE_ID, "terminals");
        const cfg = terminals[terminalId];
        if (cfg) {
          const screenId = cfg.screen || "login";
          const sc = cfg.screenConfigs?.[screenId];
          if (sc?.messages) {
            sc.messages.push({
              sender: "SYSTEM",
              text: step.text,
              timestamp: Date.now(),
              isSystem: true,
              cssClass: step.cssClass,
            });
          } else if (sc?.history) {
            sc.history.push({ type: "response", text: `[SYSTEM] ${step.text}` });
          }
          game.settings.set(MODULE_ID, "terminals", terminals);
        }
        broadcastStateSync(terminalId, "systemMessage");
        break;
      }
      case "lock": {
        const locked = step.locked ?? true;
        const terminals = game.settings.get(MODULE_ID, "terminals");
        if (terminals[terminalId]) {
          terminals[terminalId].locked = locked;
          game.settings.set(MODULE_ID, "terminals", terminals);
        }
        broadcastStateSync(terminalId, "lockTerminal");
        break;
      }
    }
  }
}

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
  ui.notifications.info(`Terminal command from ${payload.userName}: ${payload.command}`);
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
  const terminals = game.settings.get(MODULE_ID, "terminals");
  const config = terminals[terminalId];
  if (config) {
    if (!config.screenConfigs.command) config.screenConfigs.command = { history: [] };
    if (!config.screenConfigs.command.history) config.screenConfigs.command.history = [];
    config.screenConfigs.command.history.push({ type: "response", text });
    config.screenConfigs.command.waiting = false;
    game.settings.set(MODULE_ID, "terminals", terminals);
  }
  clearPendingCommand(terminalId);
  broadcastStateSync(terminalId, "gmResponse");
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

Hooks.once("ready", () => {
  initSocket();
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
  broadcastStateSync,
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
  broadcastStateSync,
  debouncedPersist,
  runMacroSequence,
  getPendingCommands,
  sendGmResponse,
  clearPendingCommand,
};
