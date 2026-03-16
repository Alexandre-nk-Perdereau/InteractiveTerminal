import { BaseScreen } from "./base-screen.js";
import { SoundManager } from "../effects/sounds.js";
import { GlitchEffect } from "../effects/glitch.js";

export class BootScreen extends BaseScreen {
  static get screenId() { return "boot"; }
  static get screenName() { return "Boot"; }
  get hasInput() { return false; }

  static DEFAULT_LINES = [
    { text: "BIOS v2.4.1 ... OK", delay: 80 },
    { text: "Memory Test ... 640K OK", delay: 120 },
    { text: "Detecting hardware...", delay: 200 },
    { text: "  CPU: Dual-Core 2.4 GHz ... OK", delay: 100 },
    { text: "  RAM: 4096 MB ... OK", delay: 80 },
    { text: "  HDD: 500 GB ... OK", delay: 100 },
    { text: "  NET: Ethernet Adapter ... OK", delay: 150 },
    { text: "", delay: 50 },
    { text: "Loading Terminal OS v4.7.2 ...", delay: 300 },
    { text: "Mounting filesystems...", delay: 200 },
    { text: "  /dev/sda1 ... mounted", delay: 100 },
    { text: "  /dev/sda2 ... mounted", delay: 100 },
    { text: "Initializing network interface ... OK", delay: 250 },
    { text: "Connecting to mainframe ...", delay: 400 },
    { text: "Connection established.", delay: 150 },
    { text: "Starting security daemon ... OK", delay: 200 },
    { text: "Loading user environment ...", delay: 300 },
    { text: "", delay: 50 },
    { text: "=================================", delay: 50 },
    { text: "  SYSTEM READY", delay: 50 },
    { text: "=================================", delay: 50 },
  ];

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.lines = config.lines || BootScreen.DEFAULT_LINES;
    this.nextScreen = config.nextScreen || "login";
    this.autoTransition = config.autoTransition !== false;
    this.transitionDelay = config.transitionDelay || 1500;
    this.completed = false;
  }

  getData() {
    return {
      ...super.getData(),
      completed: this.completed,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    this.completed = false;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;

    SoundManager.play("boot");
    await this._runSequence(container);
  }

  async _runSequence(container) {
    const output = container.querySelector(".screen-output");
    if (!output) return;

    for (const entry of this.lines) {
      if (!this.active) return;

      const line = document.createElement("div");
      line.classList.add("terminal-line", "boot-line");

      if (entry.style === "error") {
        line.classList.add("term-error");
      } else if (entry.style === "success") {
        line.classList.add("term-success");
      } else if (entry.style === "warning") {
        line.classList.add("term-warning");
      }

      line.textContent = entry.text || entry;
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;

      const delay = entry.delay || (80 + Math.random() * 120);
      await new Promise(r => setTimeout(r, delay));

      if (entry.glitch) {
        GlitchEffect.trigger(this.terminal.element, entry.glitch);
      }
      if (entry.sound) {
        SoundManager.play(entry.sound);
      }
    }

    this.completed = true;

    if (this.autoTransition && this.active) {
      SoundManager.play("success");
      await new Promise(r => setTimeout(r, this.transitionDelay));
      if (this.active) {
        this.terminal.switchScreen(this.nextScreen);
      }
    }
  }
}
