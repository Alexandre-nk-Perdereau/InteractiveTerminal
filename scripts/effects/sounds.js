export class SoundManager {
  static SOUNDS = {
    keystroke: { label: "Keystroke", src: null },
    boot: { label: "Boot", src: null },
    denied: { label: "Denied", src: null },
    granted: { label: "Granted", src: null },
    glitch: { label: "Glitch", src: null },
    beep: { label: "Beep", src: null },
    alarm: { label: "Alarm", src: null },
    ambient: { label: "Ambiance", src: null },
    hacking: { label: "Hacking", src: null },
    success: { label: "Success", src: null },
    error: { label: "Error", src: null },
    typing: { label: "Typing", src: null },
  };

  static _audioCtx = null;

  static get audioCtx() {
    if (!SoundManager._audioCtx) SoundManager._audioCtx = new AudioContext();
    return SoundManager._audioCtx;
  }

  static async play(soundId, volume = 0.5) {
    const enabled = game.settings.get("interactive-terminal", "enableSounds");
    if (!enabled) return;

    const def = SoundManager.SOUNDS[soundId];
    if (def?.src) {
      await foundry.audio.AudioHelper.play({ src: def.src, volume, autoplay: true, loop: false });
      return;
    }
    SoundManager._procedural(soundId, volume);
  }

  static _procedural(type, volume = 0.5) {
    const ctx = SoundManager.audioCtx;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(volume * 0.3, now);

    const fn = {
      keystroke: () => SoundManager._osc(ctx, gain, now, "square", 800 + Math.random() * 400, 0.05, 0.1),
      beep: () => SoundManager._osc(ctx, gain, now, "sine", 1000, 0.15, 0.2),
      denied: () => {
        const o = SoundManager._osc(ctx, gain, now, "sawtooth", 200, 0.4, 0.25);
        o.frequency.linearRampToValueAtTime(100, now + 0.4);
      },
      boot: () => {
        const o = SoundManager._osc(ctx, gain, now, "sine", 100, 1, 0.2);
        o.frequency.exponentialRampToValueAtTime(2000, now + 0.5);
        o.frequency.exponentialRampToValueAtTime(500, now + 0.8);
      },
      glitch: () => SoundManager._noise(ctx, gain, now, 0.3),
      error: () => {
        SoundManager._osc(ctx, gain, now, "square", 300, 0.15, 0.15);
        SoundManager._osc(ctx, gain, now + 0.2, "square", 300, 0.15, 0.15);
      },
      granted: () => {
        [600, 800, 1000].forEach((f, i) => SoundManager._osc(ctx, gain, now + i * 0.12, "sine", f, 0.15, 0.15));
      },
      success: () => {
        [523, 659, 784].forEach((f, i) => SoundManager._osc(ctx, gain, now + i * 0.1, "sine", f, 0.2, 0.15));
      },
    }[type];

    if (fn) fn();
    else SoundManager._osc(ctx, gain, now, "sine", 1000, 0.15, 0.2);
  }

  static _osc(ctx, gain, time, type, freq, dur, vol) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(gain);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.start(time);
    osc.stop(time + dur);
    return osc;
  }

  static _noise(ctx, gain, time, dur) {
    const size = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.start(time);
    src.stop(time + dur);
  }

  static async playCustom(src, volume = 0.5, loop = false) {
    return foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop });
  }

  static stopAll() {
    if (SoundManager._audioCtx) {
      SoundManager._audioCtx.close();
      SoundManager._audioCtx = null;
    }
  }
}
