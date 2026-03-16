import { BaseScreen } from "./base-screen.js";
import { emitSocket } from "../module.js";
import { GlitchEffect } from "../effects/glitch.js";
import { SoundManager } from "../effects/sounds.js";

export class HackingScreen extends BaseScreen {
  static get screenId() { return "hacking"; }
  static get screenName() { return "Hacking"; }
  get hasInput() { return false; }

  static FILLER_CHARS = "!@#$%^&*(){}[]<>?/|\\;:'\",.-_+=~`";

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.words = config.words || [
      "OVERRIDE", "TERMINAL", "NETWORK", "FIREWALL", "ENCRYPT", "SYSTEM", "SECURE", "ACCESS",
      "COMMAND", "CONTROL", "BREACH", "BYPASS", "CIPHER", "DECODE", "DAEMON", "KERNEL",
      "PROXY", "REBOOT", "SIGNAL", "STREAM", "BINARY", "PACKET", "SERVER", "MODULE",
    ];
    this.correctWord = config.correctWord || this.words[0];
    this.maxAttempts = config.attempts || 4;
    this.attemptsLeft = this.maxAttempts;
    this.solved = false;
    this.locked = false;
    this.guesses = [];
    this._gridData = null;
  }

  getData() {
    return {
      ...super.getData(),
      attemptsLeft: this.attemptsLeft,
      maxAttempts: this.maxAttempts,
      attemptBlocks: Array.from({ length: this.attemptsLeft }),
      solved: this.solved,
      locked: this.locked,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this._generateGrid();
    this._renderGrid();
    this.activateListeners(container);
  }

  activateListeners(html) {
    html.querySelectorAll(".hack-word").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (this.solved || this.locked || !this.canInteract()) return;
        this._attemptWord(e.currentTarget.dataset.word);
      });
      el.addEventListener("mouseenter", (e) => e.currentTarget.classList.add("hack-word-hover"));
      el.addEventListener("mouseleave", (e) => e.currentTarget.classList.remove("hack-word-hover"));
    });
  }

  _generateGrid() {
    const totalChars = 32 * 16;
    const fillers = HackingScreen.FILLER_CHARS;
    const grid = Array.from({ length: totalChars }, () => ({
      char: fillers[Math.floor(Math.random() * fillers.length)],
      wordIndex: -1,
    }));

    const placed = new Set();
    const shuffled = [...this.words].sort(() => Math.random() - 0.5);

    for (let w = 0; w < shuffled.length; w++) {
      const word = shuffled[w];
      let ok = false;
      for (let tries = 0; tries < 100 && !ok; tries++) {
        const pos = Math.floor(Math.random() * (totalChars - word.length));
        const rowStart = Math.floor(pos / 16) * 16;
        if (pos + word.length > rowStart + 16) continue;

        let overlap = false;
        for (let i = 0; i < word.length; i++) {
          if (placed.has(pos + i)) { overlap = true; break; }
        }
        if (overlap) continue;

        for (let i = 0; i < word.length; i++) {
          grid[pos + i] = { char: word[i], wordIndex: w, word };
          placed.add(pos + i);
        }
        ok = true;
      }
    }
    this._gridData = grid;
  }

  _renderGrid() {
    const container = this.element?.querySelector(".hack-grid");
    if (!container) return;
    container.innerHTML = "";

    let baseAddr = 0xf000 + Math.floor(Math.random() * 0x0fff);
    for (let row = 0; row < 32; row++) {
      const rowDiv = document.createElement("div");
      rowDiv.classList.add("hack-row");

      const addr = document.createElement("span");
      addr.classList.add("hack-addr");
      addr.textContent = `0x${(baseAddr + row * 16).toString(16).toUpperCase().padStart(4, "0")}`;
      rowDiv.appendChild(addr);

      const chars = document.createElement("span");
      chars.classList.add("hack-chars");
      for (let col = 0; col < 16; col++) {
        const cell = this._gridData[row * 16 + col];
        const span = document.createElement("span");
        span.textContent = cell.char;
        span.classList.add("hack-cell");
        if (cell.wordIndex >= 0) {
          span.classList.add("hack-word");
          span.dataset.word = cell.word;
        }
        chars.appendChild(span);
      }
      rowDiv.appendChild(chars);
      container.appendChild(rowDiv);
    }
  }

  _attemptWord(word) {
    if (this.guesses.includes(word)) return;
    this.guesses.push(word);
    this.attemptsLeft--;

    SoundManager.play("keystroke");
    const output = this.element?.querySelector(".hack-output");
    const attemptsEl = this.element?.querySelector(".hack-attempts-left");

    if (word === this.correctWord) {
      this.solved = true;
      SoundManager.play("granted");
      if (output) {
        this._addLine(output, `> ${word}`);
        this._addLine(output, "> Exact match!", "term-success");
        this._addLine(output, "> Entry granted.", "term-success term-glow");
      }
      this.element?.querySelectorAll(`.hack-word[data-word="${word}"]`).forEach((el) => el.classList.add("hack-word-correct"));

      const crt = this.terminal.element?.querySelector(".terminal-crt");
      if (crt) {
        const flash = document.createElement("div");
        flash.classList.add("access-granted-flash");
        flash.textContent = "ACCESS GRANTED";
        crt.appendChild(flash);
        setTimeout(() => flash.remove(), 2000);
      }

      if (!game.user.isGM) emitSocket("hackingAction", this.terminal.terminalId, { word });
    } else {
      const likeness = this._likeness(word, this.correctWord);
      if (output) {
        this._addLine(output, `> ${word}`);
        this._addLine(output, `> Entry denied. Likeness=${likeness}`, "term-error");
      }
      this.element?.querySelectorAll(`.hack-word[data-word="${word}"]`).forEach((el) => el.classList.add("hack-word-used"));
      GlitchEffect.trigger(this.terminal.element, "short");
      SoundManager.play("denied");
      if (attemptsEl) attemptsEl.textContent = `${this.attemptsLeft}/${this.maxAttempts}`;
      if (this.attemptsLeft <= 0) this._lockout();
    }
  }

  _likeness(a, b) {
    let n = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) n++;
    }
    return n;
  }

  _lockout() {
    this.locked = true;
    const output = this.element?.querySelector(".hack-output");
    if (output) {
      this._addLine(output, "");
      this._addLine(output, "> TERMINAL LOCKED", "term-error term-glow");
      this._addLine(output, "> Please contact an administrator.", "term-error");
    }
    GlitchEffect.trigger(this.terminal.element, "sustained");
    SoundManager.play("error");
    this.element?.querySelectorAll(".hack-word").forEach((el) => el.classList.add("hack-word-used"));
  }

  _addLine(container, text, cssClass = "") {
    const line = document.createElement("div");
    line.classList.add("hack-output-line");
    if (cssClass) cssClass.split(" ").forEach((c) => line.classList.add(c));
    line.textContent = text;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
  }

  processHackingAttempt(word, userId) {
    console.log(`InteractiveTerminal | Player ${userId} attempted: ${word}`);
  }
}
