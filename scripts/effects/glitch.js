export class GlitchEffect {
  static TYPES = {
    short: { class: "glitch-active", duration: 600 },
    sustained: { class: "glitch-sustained", duration: 3000 },
    colorSplit: { class: "glitch-color-split", duration: 1500 },
    tear: { class: "glitch-tear", duration: 500 },
    static: { class: "glitch-static", duration: 3000, needsOverlay: true },
    flash: { class: "glitch-flash", duration: 400, filterOnly: true },
    roll: { class: "glitch-roll", duration: 1200 },
    interlace: { class: "glitch-interlace", duration: 2000, needsOverlay: true },
  };

  static _ensureOverlay(crt) {
    let overlay = crt.querySelector(".glitch-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.classList.add("glitch-overlay");
      crt.appendChild(overlay);
    }
    return overlay;
  }

  static trigger(element, type = "short", customDuration) {
    if (!element) return;
    const def = GlitchEffect.TYPES[type];
    if (!def) return;

    const target = element.querySelector?.(".terminal-content") || element;
    const crt = element.querySelector?.(".terminal-crt") || element;
    GlitchEffect.clearAll(target);
    GlitchEffect.clearAll(crt);

    if (def.needsOverlay) GlitchEffect._ensureOverlay(crt);

    const applyTo = def.filterOnly || def.needsOverlay ? crt : target;

    // Flash conflicts with the flicker animation -- pause it temporarily
    if (def.filterOnly && crt.classList.contains("flicker")) {
      crt.classList.remove("flicker");
      setTimeout(() => crt.classList.add("flicker"), customDuration ?? def.duration);
    }

    applyTo.classList.add(def.class);
    const duration = customDuration ?? def.duration;
    setTimeout(() => {
      applyTo.classList.remove(def.class);
    }, duration);
  }

  static async triggerRandom(element, count = 3, interval = 500) {
    const types = Object.keys(GlitchEffect.TYPES);
    for (let i = 0; i < count; i++) {
      GlitchEffect.trigger(element, types[Math.floor(Math.random() * types.length)]);
      if (i < count - 1) await new Promise((r) => setTimeout(r, interval));
    }
  }

  static clearAll(element) {
    if (!element) return;
    const classes = Object.values(GlitchEffect.TYPES).map((t) => t.class);
    for (const cls of classes) element.classList.remove(cls);
    const crt = element.closest?.(".terminal-crt") || element.querySelector?.(".terminal-crt");
    const content = element.closest?.(".terminal-content") || element.querySelector?.(".terminal-content");
    if (crt) for (const cls of classes) crt.classList.remove(cls);
    if (content) for (const cls of classes) content.classList.remove(cls);
  }

  // --- Looping support ---
  static _loops = new Map();

  static startLoop(element, type, intervalMs = 2000, loopKey = "default") {
    GlitchEffect.stopLoop(loopKey);
    GlitchEffect.trigger(element, type);
    const id = setInterval(() => GlitchEffect.trigger(element, type), intervalMs);
    GlitchEffect._loops.set(loopKey, id);
  }

  static stopLoop(loopKey = "default") {
    const id = GlitchEffect._loops.get(loopKey);
    if (id != null) {
      clearInterval(id);
      GlitchEffect._loops.delete(loopKey);
    }
  }

  static stopAllLoops() {
    for (const [key] of GlitchEffect._loops) GlitchEffect.stopLoop(key);
  }

  static async textScramble(element, duration = 1000, finalText) {
    if (!element) return;
    const original = finalText ?? element.textContent;
    const chars = "!@#$%^&*()_+-=[]{}|;:',.<>?/~`0123456789ABCDEF";
    const interval = 50;
    const frames = Math.floor(duration / interval);

    for (let f = 0; f < frames; f++) {
      const progress = f / frames;
      let result = "";
      for (let i = 0; i < original.length; i++) {
        result += i < original.length * progress ? original[i] : chars[Math.floor(Math.random() * chars.length)];
      }
      element.textContent = result;
      await new Promise((r) => setTimeout(r, interval));
    }
    element.textContent = original;
  }
}
