import { BaseScreen } from "./base-screen.js";
import { emitRequestAction } from "../module.js";
import { SoundManager } from "../effects/sounds.js";

export class ChatScreen extends BaseScreen {
  static get screenId() {
    return "chat";
  }
  static get screenName() {
    return "Chat";
  }
  get hasInput() {
    return true;
  }
  get inputPlaceholder() {
    return game.i18n.localize("ITERM.Chat.InputPlaceholder");
  }
  get promptSymbol() {
    return ">";
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.messages = [...(config.messages || [])];
    this.npcName = config.npcName || "SYSTEM";
  }

  getData() {
    return {
      ...super.getData(),
      messages: this.messages,
      npcName: this.npcName,
      userName: this._getTerminalUserName(),
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this.activateListeners(container);

    this._renderAllMessages();
    this._scrollToBottom();
  }

  activateListeners(html) {
    if (game.user.isGM) {
      html.querySelector(".screen-output")?.addEventListener("dblclick", () => {
        this.terminal.element?.querySelector(".terminal-input")?.focus();
      });
    }
  }

  async applyStateSync(screenConfig) {
    if (!screenConfig.messages) return;
    const prevCount = this.messages.length;
    const newMessages = screenConfig.messages.slice(prevCount);
    this.messages = [...screenConfig.messages];
    if (!this.active || !this.element || newMessages.length === 0) return;

    for (const msg of newMessages) {
      if (msg.isNpc && !msg.isUser) {
        await this._renderMessageWithTyping(msg);
      } else {
        this._renderMessage(msg);
      }
    }
  }

  _getTerminalUserName() {
    return this.terminal.config.screenConfigs?.login?.username || "USER";
  }

  onInput(value) {
    if (!value) return;
    const senderName = this._getTerminalUserName();
    const msg = { sender: senderName, text: value, timestamp: Date.now(), isUser: true };
    this.messages.push(msg);
    this._renderMessage(msg);
    SoundManager.play("beep");
    emitRequestAction(this.terminal.terminalId, "playerChat", {
      text: value,
      userName: senderName,
    });
  }

  _renderAllMessages() {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;
    output.innerHTML = "";
    this.messages.forEach((m) => this._renderMessage(m));
  }

  _renderMessage(msg) {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;

    const line = document.createElement("div");
    line.classList.add("iterm-chat-message");
    if (msg.isUser) line.classList.add("iterm-chat-user");
    if (msg.isNpc) line.classList.add("iterm-chat-npc");

    const sender = document.createElement("span");
    sender.classList.add("iterm-chat-sender");
    sender.textContent = `[${msg.sender}]`;

    const text = document.createElement("span");
    text.classList.add("iterm-chat-text");
    text.textContent = ` ${msg.text}`;

    line.append(sender, text);
    output.appendChild(line);
    this._scrollToBottom();
  }

  async _renderMessageWithTyping(msg) {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;

    const typingDiv = document.createElement("div");
    typingDiv.classList.add("iterm-chat-message", "iterm-chat-npc", "iterm-chat-typing");

    const typingSender = document.createElement("span");
    typingSender.classList.add("iterm-chat-sender");
    typingSender.textContent = `[${msg.sender}]`;

    const typingIndicator = document.createElement("span");
    typingIndicator.classList.add("typing-indicator");
    typingIndicator.append(
      document.createElement("span"),
      document.createElement("span"),
      document.createElement("span"),
    );

    typingDiv.append(typingSender, document.createTextNode(" "), typingIndicator);
    output.appendChild(typingDiv);
    this._scrollToBottom();

    await new Promise((r) => setTimeout(r, Math.min(msg.text.length * 40, 3000)));

    typingDiv.remove();
    this._renderMessage(msg);
    SoundManager.play("beep");
  }

  _scrollToBottom() {
    const output = this.element?.querySelector(".screen-output");
    if (output) output.scrollTop = output.scrollHeight;
  }
}
