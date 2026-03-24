export class BaseScreen {
  constructor(terminal, config = {}) {
    this.terminal = terminal;
    this.config = config;
    this.element = null;
    this.active = false;
  }

  static get screenId() {
    return "base";
  }
  static get screenName() {
    return "Base";
  }

  get template() {
    return `modules/interactive-terminal/templates/screens/${this.constructor.screenId}.hbs`;
  }

  get hasInput() {
    return false;
  }
  get inputPlaceholder() {
    return "";
  }
  get promptSymbol() {
    return ">";
  }

  getData() {
    return {
      config: this.config,
      isGM: game.user.isGM,
      canInteract: this.canInteract(),
    };
  }

  canInteract() {
    if (game.user.isGM) return true;
    const perms = this.terminal.config.permissions || {};
    if (Object.keys(perms).length === 0) return true;
    return perms[game.user.id] === true;
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this.activateListeners(container);
  }

  deactivate() {
    this.active = false;
    this.element = null;
  }

  activateListeners(html) {}
  onInput(value) {}

  applyStateSync(screenConfig, syncMeta) {
    foundry.utils.mergeObject(this.config, screenConfig);
    if (this.active && this.element) this.refresh();
  }

  updateConfig(newConfig) {
    foundry.utils.mergeObject(this.config, newConfig);
    if (this.active && this.element) this.refresh();
  }

  async refresh() {
    if (this.element) await this.activate(this.element);
  }

  appendLine(text, cssClass = "") {
    if (!this.element) return;
    const body = this.element.querySelector(".screen-output") || this.element;
    const line = document.createElement("div");
    line.classList.add("terminal-line");
    if (cssClass) cssClass.split(" ").forEach((c) => line.classList.add(c));
    line.textContent = text;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }

  async typeText(text, speed = 30) {
    if (!this.element) return;
    const body = this.element.querySelector(".screen-output") || this.element;
    const line = document.createElement("div");
    line.classList.add("terminal-line");
    body.appendChild(line);
    for (let i = 0; i < text.length; i++) {
      if (!this.active) return;
      line.textContent += text[i];
      body.scrollTop = body.scrollHeight;
      await new Promise((r) => setTimeout(r, speed));
    }
  }

  clearOutput() {
    const body = this.element?.querySelector(".screen-output");
    if (body) body.innerHTML = "";
  }
}
