import { BaseScreen } from "./base-screen.js";
import { emitSocket } from "../module.js";
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
    return { ...super.getData(), messages: this.messages, npcName: this.npcName };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this.activateListeners(container);

    if (this.messages.length === 0) {
      await this._showWelcome();
    } else {
      this._renderAllMessages();
    }
    this._scrollToBottom();
  }

  activateListeners(html) {
    if (game.user.isGM) {
      html.querySelector(".screen-output")?.addEventListener("dblclick", () => {
        this.terminal.element?.querySelector(".terminal-input")?.focus();
      });
    }
  }

  onInput(value) {
    if (!value) return;
    const senderName = game.user.isGM ? "ADMIN" : game.user.name;
    const msg = { sender: senderName, text: value, timestamp: Date.now(), isUser: true };
    this.messages.push(msg);
    this._renderMessage(msg);
    SoundManager.play("beep");

    if (game.user.isGM) {
      emitSocket("chatMessage", this.terminal.terminalId, msg);
    } else {
      emitSocket("playerChat", this.terminal.terminalId, {
        text: value,
        userId: game.user.id,
        userName: game.user.name,
      });
    }
  }

  async receiveMessage(message) {
    if (!this.active || !this.element) return;
    if (message.isUser) {
      if (message.sender === (game.user.isGM ? "ADMIN" : game.user.name)) return;
      this.messages.push(message);
      this._renderMessage(message);
      return;
    }
    this.messages.push(message);
    await this._renderMessageWithTyping(message);
  }

  sendNpcMessage(text, senderName) {
    const msg = { sender: senderName || this.npcName, text, timestamp: Date.now(), isUser: false, isNpc: true };
    this.messages.push(msg);
    this._renderMessageWithTyping(msg);
    emitSocket("chatMessage", this.terminal.terminalId, msg);
  }

  async _showWelcome() {
    const msg = {
      sender: this.npcName,
      text: game.i18n.localize("ITERM.Chat.WelcomeMessage"),
      timestamp: Date.now(),
      isNpc: true,
    };
    this.messages.push(msg);
    await this._renderMessageWithTyping(msg);
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
    line.classList.add("chat-message");
    if (msg.isUser) line.classList.add("chat-user");
    if (msg.isNpc) line.classList.add("chat-npc");

    const sender = document.createElement("span");
    sender.classList.add("chat-sender");
    sender.textContent = `[${msg.sender}]`;

    const text = document.createElement("span");
    text.classList.add("chat-text");
    text.textContent = ` ${msg.text}`;

    line.append(sender, text);
    output.appendChild(line);
    this._scrollToBottom();
  }

  async _renderMessageWithTyping(msg) {
    const output = this.element?.querySelector(".screen-output");
    if (!output) return;

    const typingDiv = document.createElement("div");
    typingDiv.classList.add("chat-message", "chat-npc", "chat-typing");

    const typingSender = document.createElement("span");
    typingSender.classList.add("chat-sender");
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
