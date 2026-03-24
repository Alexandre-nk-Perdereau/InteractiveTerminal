import { BaseScreen } from "./base-screen.js";
import { emitRequestAction } from "../module.js";
import { SoundManager } from "../effects/sounds.js";

export class CommandScreen extends BaseScreen {
  static get screenId() {
    return "command";
  }
  static get screenName() {
    return "Command";
  }
  get hasInput() {
    return true;
  }
  get inputPlaceholder() {
    return this.waiting ? "" : "Enter command...";
  }
  get promptSymbol() {
    return this.waiting ? "" : this.config.prompt || ">";
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.history = [];
    this.waiting = false;
    this.autoResponses = config.autoResponses || [];
    this.motd = config.motd || null;
    this.hostname = config.hostname || "SYSTEM";
  }

  getData() {
    return {
      ...super.getData(),
      hostname: this.hostname,
      motd: this.motd,
      waiting: this.waiting,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this.activateListeners(container);

    if (this.history.length > 0) {
      this._replayHistory();
    } else if (this.motd) {
      await this._typeResponse(this.motd, "term-dim");
    }
  }

  activateListeners() {}

  async applyStateSync(screenConfig, syncMeta) {
    if (!screenConfig.history) return;
    const prevCount = this.history.length;
    const newEntries = screenConfig.history.slice(prevCount);
    this.history = [...screenConfig.history];
    const wasWaiting = this.waiting;
    this.waiting = screenConfig.waiting || false;

    if (!this.active || !this.element) return;

    for (const entry of newEntries) {
      if (entry.type === "command") {
        this._appendCommand(entry.text);
      } else if (entry.type === "response") {
        this._removeWaitingIndicator();
        await this._typeResponse(entry.text);
      }
    }

    if (this.waiting && !wasWaiting) {
      this._showWaitingIndicator();
    } else if (!this.waiting && wasWaiting) {
      this._removeWaitingIndicator();
    }

    this._updateTerminalInput();
  }

  onInput(value) {
    if (!value || this.waiting) return;

    this._appendCommand(value);
    this.history.push({ type: "command", text: value });
    SoundManager.play("beep");

    const autoMatch = this._checkAutoResponse(value);
    if (autoMatch) {
      this._startWaiting();
      setTimeout(
        () => {
          this._receiveResponse(autoMatch);
        },
        300 + Math.random() * 500,
      );
      return;
    }

    this._startWaiting();
    emitRequestAction(this.terminal.terminalId, "playerCommand", {
      command: value,
    });
  }

  _checkAutoResponse(command) {
    const cmd = command.toLowerCase().trim();

    if (cmd === "clear") {
      this.waiting = false;
      this.clearOutput();
      this.history = [];
      this._updateTerminalInput();
      return null;
    }

    for (const rule of this.autoResponses) {
      try {
        const re = new RegExp(rule.pattern, "i");
        if (re.test(cmd)) return rule.response;
      } catch {
        if (cmd === rule.pattern.toLowerCase()) return rule.response;
      }
    }
    return null;
  }

  _startWaiting() {
    this.waiting = true;
    this._updateTerminalInput();
    this._showWaitingIndicator();
  }

  _showWaitingIndicator() {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;
    let indicator = output.querySelector(".command-waiting");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.classList.add("command-waiting", "terminal-line");
      indicator.innerHTML = '<span class="cursor-blink"></span>';
      output.appendChild(indicator);
      this._scrollToBottom();
    }
  }

  _removeWaitingIndicator() {
    this.element?.querySelector(".command-waiting")?.remove();
  }

  async _receiveResponse(text) {
    this._removeWaitingIndicator();
    this.history.push({ type: "response", text });
    await this._typeResponse(text);
    this.waiting = false;
    this._updateTerminalInput();
  }

  async _typeResponse(text, cssClass = "") {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;

    const lines = text.split("\n");
    for (const lineText of lines) {
      if (!this.active) return;
      const line = document.createElement("div");
      line.classList.add("terminal-line", "command-response");
      if (cssClass) cssClass.split(" ").forEach((c) => line.classList.add(c));
      output.appendChild(line);

      for (let i = 0; i < lineText.length; i++) {
        if (!this.active) {
          line.textContent = lineText;
          break;
        }
        line.textContent += lineText[i];
        this._scrollToBottom();
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 20));
      }
      SoundManager.play("keystroke");
    }
    this._scrollToBottom();
  }

  _appendCommand(text) {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;
    const line = document.createElement("div");
    line.classList.add("terminal-line", "command-input-line");
    const prompt = document.createElement("span");
    prompt.classList.add("command-prompt");
    prompt.textContent = `${this.config.prompt || ">"} `;
    const cmd = document.createElement("span");
    cmd.classList.add("command-text");
    cmd.textContent = text;
    line.append(prompt, cmd);
    output.appendChild(line);
    this._scrollToBottom();
  }

  _replayHistory() {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;
    output.innerHTML = "";
    for (const entry of this.history) {
      if (entry.type === "command") {
        const line = document.createElement("div");
        line.classList.add("terminal-line", "command-input-line");
        line.innerHTML = `<span class="command-prompt">${this.config.prompt || ">"} </span><span class="command-text">${this._escapeHtml(entry.text)}</span>`;
        output.appendChild(line);
      } else {
        const lines = entry.text.split("\n");
        for (const t of lines) {
          const line = document.createElement("div");
          line.classList.add("terminal-line", "command-response");
          line.textContent = t;
          output.appendChild(line);
        }
      }
    }
    if (this.waiting) this._showWaitingIndicator();
    this._scrollToBottom();
  }

  _updateTerminalInput() {
    const footer = this.terminal.element?.querySelector(".terminal-footer");
    if (!footer) return;
    const input = footer.querySelector(".terminal-input");
    const promptEl = footer.querySelector(".terminal-prompt");
    if (this.waiting) {
      footer.style.display = "none";
    } else {
      footer.style.display = "flex";
      if (promptEl) promptEl.textContent = this.config.prompt || ">";
      if (input) {
        input.placeholder = this.inputPlaceholder;
        input.disabled = false;
        input.focus();
      }
    }
  }

  _scrollToBottom() {
    const output = this.element?.querySelector(".screen-output");
    if (output) output.scrollTop = output.scrollHeight;
  }

  _escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
