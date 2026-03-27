import { MODULE_ID } from "./constants.js";

export async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function getTerminalIndex() {
  return game.settings.get(MODULE_ID, "terminalIndex") || {};
}

async function setTerminalIndex(index) {
  await game.settings.set(MODULE_ID, "terminalIndex", index);
}

export function getPublicDoc(terminalId) {
  const entry = getTerminalIndex()[terminalId];
  if (!entry?.publicDocId) return null;
  return game.journal.get(entry.publicDocId) || null;
}

export function getPrivateDoc(terminalId) {
  const entry = getTerminalIndex()[terminalId];
  if (!entry?.privateDocId) return null;
  return game.journal.get(entry.privateDocId) || null;
}

export function getTerminalConfig(terminalId) {
  const doc = getPublicDoc(terminalId);
  return doc?.getFlag(MODULE_ID, "config") || null;
}

export function getScreenState(terminalId) {
  const doc = getPublicDoc(terminalId);
  return doc?.getFlag(MODULE_ID, "screenState") || null;
}

export function getCustomSequences(terminalId) {
  const doc = getPublicDoc(terminalId);
  return doc?.getFlag(MODULE_ID, "customSequences") || [];
}

export function getSecrets(terminalId) {
  const doc = getPrivateDoc(terminalId);
  return doc?.getFlag(MODULE_ID, "secrets") || null;
}

export function getFullConfig(terminalId) {
  const config = getTerminalConfig(terminalId);
  if (!config) return null;
  return {
    ...config,
    screenConfigs: getScreenState(terminalId) || {},
    customSequences: getCustomSequences(terminalId),
  };
}

export async function updateTerminalConfig(terminalId, partial) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return;
  const current = doc.getFlag(MODULE_ID, "config") || {};
  const merged = foundry.utils.mergeObject(current, partial);
  await doc.update({ [`flags.${MODULE_ID}.config`]: merged });
}

export async function updateScreenState(terminalId, screenId, screenConfig) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return;
  await doc.update({ [`flags.${MODULE_ID}.screenState.${screenId}`]: screenConfig });
}

export async function updateFullScreenState(terminalId, screenState) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return;
  await doc.update({ [`flags.${MODULE_ID}.screenState`]: screenState });
}

export async function updateSecrets(terminalId, partial) {
  const doc = getPrivateDoc(terminalId);
  if (!doc) return;
  const current = doc.getFlag(MODULE_ID, "secrets") || {};
  const merged = foundry.utils.mergeObject(current, partial);
  await doc.update({ [`flags.${MODULE_ID}.secrets`]: merged });
}

export async function updateCustomSequences(terminalId, sequences) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return;
  await doc.update({ [`flags.${MODULE_ID}.customSequences`]: sequences });
}

export async function createTerminalDocuments(terminalId, config) {
  const { screenConfigs, customSequences, ...publicConfig } = config;

  const loginPassword = screenConfigs?.login?.password || "password";
  const loginPasswordHash = await hashPassword(loginPassword);
  const hackingCorrectWord = screenConfigs?.hacking?.correctWord || "DECRYPT";

  const sanitizedScreenState = foundry.utils.deepClone(screenConfigs || {});
  if (sanitizedScreenState.login) {
    delete sanitizedScreenState.login.password;
  }
  if (sanitizedScreenState.hacking) {
    delete sanitizedScreenState.hacking.correctWord;
    if (Array.isArray(sanitizedScreenState.hacking.guesses)) {
      sanitizedScreenState.hacking.guesses = sanitizedScreenState.hacking.guesses.map((g) =>
        typeof g === "string" ? { word: g, likeness: 0 } : g,
      );
    }
  }

  const publicDoc = await JournalEntry.create({
    name: `[IT] ${publicConfig.title || "Terminal"}`,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: {
      [MODULE_ID]: {
        terminalId,
        config: publicConfig,
        screenState: sanitizedScreenState,
        customSequences: customSequences || [],
      },
    },
  });

  const privateDoc = await JournalEntry.create({
    name: `[IT-Private] ${publicConfig.title || "Terminal"}`,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: {
      [MODULE_ID]: {
        terminalId,
        publicDocId: publicDoc.id,
        secrets: {
          loginPassword,
          loginPasswordHash,
          hackingCorrectWord,
          hiddenFileContents: {},
        },
      },
    },
  });

  await publicDoc.update({ [`flags.${MODULE_ID}.privateDocId`]: privateDoc.id });

  const index = getTerminalIndex();
  index[terminalId] = { publicDocId: publicDoc.id, privateDocId: privateDoc.id };
  await setTerminalIndex(index);

  return { terminalId, publicDoc, privateDoc };
}

export async function deleteTerminalDocuments(terminalId) {
  const publicDoc = getPublicDoc(terminalId);
  const privateDoc = getPrivateDoc(terminalId);
  if (publicDoc) await publicDoc.delete();
  if (privateDoc) await privateDoc.delete();

  const index = getTerminalIndex();
  delete index[terminalId];
  await setTerminalIndex(index);
}

export function getAllTerminalIds() {
  return Object.keys(getTerminalIndex());
}

export function isTerminalPublicDoc(doc) {
  return !!doc.getFlag(MODULE_ID, "terminalId") && !!doc.getFlag(MODULE_ID, "config");
}

export function getTerminalIdFromDoc(doc) {
  return doc.getFlag(MODULE_ID, "terminalId") || null;
}

const _loginTransitionTimers = new Map();

export async function handleLoginAttempt({ terminalId, passwordHash }) {
  const secrets = getSecrets(terminalId);
  if (!secrets) return { success: false, error: "not_found" };

  const correct = passwordHash === secrets.loginPasswordHash;
  const doc = getPublicDoc(terminalId);
  if (!doc) return { success: false, error: "not_found" };

  const screenState = doc.getFlag(MODULE_ID, "screenState") || {};
  const login = { ...(screenState.login || {}) };
  login.attempts = (login.attempts || 0) + 1;
  login.lastResult = correct ? "granted" : "denied";

  await updateScreenState(terminalId, "login", login);

  if (correct) {
    const prevTimer = _loginTransitionTimers.get(terminalId);
    if (prevTimer) clearTimeout(prevTimer);

    const successScreen = login.successScreen || "chat";
    const timer = setTimeout(async () => {
      _loginTransitionTimers.delete(terminalId);
      const freshDoc = getPublicDoc(terminalId);
      if (!freshDoc) return;
      const freshConfig = freshDoc.getFlag(MODULE_ID, "config") || {};
      if (freshConfig.screen !== "login") return;
      const freshState = freshDoc.getFlag(MODULE_ID, "screenState") || {};
      const freshLogin = { ...(freshState.login || {}) };
      freshLogin.lastResult = null;
      freshConfig.screen = successScreen;
      await freshDoc.update({
        [`flags.${MODULE_ID}.config`]: freshConfig,
        [`flags.${MODULE_ID}.screenState.login`]: freshLogin,
      });
    }, 2500);
    _loginTransitionTimers.set(terminalId, timer);
  }

  return { success: correct, attempts: login.attempts };
}

export async function handleHackingAttempt({ terminalId, word }) {
  const secrets = getSecrets(terminalId);
  if (!secrets) return { success: false, error: "not_found" };

  const doc = getPublicDoc(terminalId);
  if (!doc) return { success: false, error: "not_found" };

  const screenState = doc.getFlag(MODULE_ID, "screenState") || {};
  const hacking = { ...(screenState.hacking || {}) };

  if (hacking.solved || hacking.locked) return { success: false, alreadyDone: true };
  if ((hacking.guesses || []).find((g) => g.word === word)) return { success: false, alreadyGuessed: true };

  const correctWord = secrets.hackingCorrectWord;
  const isCorrect = word === correctWord;

  let likeness = 0;
  for (let i = 0; i < Math.min(word.length, correctWord.length); i++) {
    if (word[i] === correctWord[i]) likeness++;
  }

  hacking.guesses = [...(hacking.guesses || []), { word, likeness }];

  if (isCorrect) {
    hacking.solved = true;
  } else {
    if (hacking.attemptsLeft == null) hacking.attemptsLeft = hacking.attempts || 4;
    hacking.attemptsLeft = Math.max(0, hacking.attemptsLeft - 1);
    if (hacking.attemptsLeft <= 0) hacking.locked = true;
  }

  await updateScreenState(terminalId, "hacking", hacking);

  return { success: isCorrect, likeness, attemptsLeft: hacking.attemptsLeft };
}

export async function handlePlayerChat({ terminalId, text, userName }) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return { success: false };

  const screenState = doc.getFlag(MODULE_ID, "screenState") || {};
  const chat = { ...(screenState.chat || {}), messages: [...(screenState.chat?.messages || [])] };
  const termUserName = screenState.login?.username || userName || "USER";

  chat.messages.push({
    sender: termUserName,
    text,
    timestamp: Date.now(),
    isUser: true,
  });

  await updateScreenState(terminalId, "chat", chat);
  return { success: true };
}

export async function handlePlayerCommand({ terminalId, command, userName }) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return { success: false };

  const screenState = doc.getFlag(MODULE_ID, "screenState") || {};
  const cmd = { ...(screenState.command || {}), history: [...(screenState.command?.history || [])] };

  cmd.history.push({ type: "command", text: command });
  cmd.waiting = true;

  await updateScreenState(terminalId, "command", cmd);
  return { success: true, command, userName };
}

export async function handleFileBrowserNavigate({ terminalId, currentPath, openFile }) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return { success: false };

  const screenState = doc.getFlag(MODULE_ID, "screenState") || {};
  const fb = { ...(screenState.fileBrowser || {}) };
  fb.currentPath = currentPath;
  fb.openFile = openFile;

  await updateScreenState(terminalId, "fileBrowser", fb);
  return { success: true };
}

export async function handleEmailNavigate({ terminalId, openThreadId, emails }) {
  const doc = getPublicDoc(terminalId);
  if (!doc) return { success: false };

  const screenState = doc.getFlag(MODULE_ID, "screenState") || {};
  const email = { ...(screenState.email || {}) };
  email.openThreadId = openThreadId;
  if (emails) email.emails = emails;

  await updateScreenState(terminalId, "email", email);
  return { success: true };
}
