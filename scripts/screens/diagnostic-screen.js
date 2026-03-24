import { BaseScreen } from "./base-screen.js";
import { GlitchEffect } from "../effects/glitch.js";
import { SoundManager } from "../effects/sounds.js";

export class DiagnosticScreen extends BaseScreen {
  static get screenId() {
    return "diagnostic";
  }
  static get screenName() {
    return "Diagnostic";
  }
  get hasInput() {
    return false;
  }

  constructor(terminal, config = {}) {
    super(terminal, config);
    this.gauges = (config.gauges || []).map((g) => ({ ...g }));
    this.alertActive = false;
    this._alertTimeout = null;
  }

  getData() {
    return {
      ...super.getData(),
      gauges: this.gauges,
      alertActive: this.alertActive,
    };
  }

  async activate(container) {
    this.active = true;
    this.element = container;
    const html = await foundry.applications.handlebars.renderTemplate(this.template, this.getData());
    container.innerHTML = html;
    this._updateAllGauges();
  }

  deactivate() {
    if (this._alertTimeout) {
      clearTimeout(this._alertTimeout);
      this._alertTimeout = null;
    }
    this.alertActive = false;
    super.deactivate();
  }

  applyStateSync(screenConfig, syncMeta) {
    if (screenConfig.gauges) {
      const prevLen = this.gauges.length;
      const newLen = screenConfig.gauges.length;
      this.gauges = screenConfig.gauges.map((g) => ({ ...g }));
      if (prevLen !== newLen && this.active && this.element) {
        this.refresh();
      } else {
        this._updateAllGauges();
      }
    }
  }

  setGaugeValue(gaugeId, value) {
    if (!this.active || !this.element) return;
    const gauge = this.gauges.find((g) => g.id === gaugeId);
    if (!gauge) return;
    gauge.value = Math.max(0, Math.min(100, value));
    gauge.status = this._computeStatus(gauge.value);
    this._updateGauge(gauge);
  }

  addGauge(gauge) {
    this.gauges.push({ ...gauge });
    if (this.active && this.element) this.refresh();
  }

  removeGauge(gaugeId) {
    this.gauges = this.gauges.filter((g) => g.id !== gaugeId);
    if (this.active && this.element) this.refresh();
  }

  triggerAlert() {
    if (!this.active || !this.element) return;
    this.alertActive = true;
    const screen = this.element.closest(".screen-diagnostic") || this.element.querySelector(".screen-diagnostic");
    const target = screen || this.element;
    target.classList.add("diagnostic-alert");
    GlitchEffect.trigger(this.terminal.element, "flash");
    SoundManager.play("alarm");

    if (this._alertTimeout) clearTimeout(this._alertTimeout);
    this._alertTimeout = setTimeout(() => {
      this.alertActive = false;
      target.classList.remove("diagnostic-alert");
      this._alertTimeout = null;
    }, 3000);
  }

  _computeStatus(value) {
    if (value <= 0) return "failure";
    if (value <= 20) return "critical";
    if (value <= 50) return "warning";
    return "normal";
  }

  _updateAllGauges() {
    for (const gauge of this.gauges) {
      gauge.status = this._computeStatus(gauge.value);
      this._updateGauge(gauge);
    }
  }

  _updateGauge(gauge) {
    if (!this.element) return;
    const row = this.element.querySelector(`[data-gauge-id="${gauge.id}"]`);
    if (!row) return;

    const bar = row.querySelector(".diagnostic-gauge-bar");
    const valueEl = row.querySelector(".diagnostic-gauge-value");
    const statusEl = row.querySelector(".diagnostic-gauge-status");

    if (bar) bar.style.width = `${gauge.value}%`;
    if (valueEl) valueEl.textContent = `${Math.round(gauge.value)}%`;
    if (statusEl) {
      const statusLabels = {
        normal: game.i18n.localize("ITERM.Diagnostic.Normal"),
        warning: game.i18n.localize("ITERM.Diagnostic.Warning"),
        critical: game.i18n.localize("ITERM.Diagnostic.Critical"),
        failure: game.i18n.localize("ITERM.Diagnostic.Failure"),
      };
      statusEl.textContent = statusLabels[gauge.status] || gauge.status;
    }

    row.classList.remove("diagnostic-normal", "diagnostic-warning", "diagnostic-critical", "diagnostic-failure");
    row.classList.add(`diagnostic-${gauge.status}`);
  }
}
