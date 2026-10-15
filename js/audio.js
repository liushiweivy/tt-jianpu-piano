/*
 * audio.js — 钢琴合成引擎（无音频文件）
 * 钢琴音：基频 triangle + 2/3/4 倍频正弦 + 指数衰减；反馈延迟替代卷积混响。
 * UMD：抖音 tt.getAudioContext()（≥1.34.0，无 Compressor）/ 微信 wx.createWebAudioContext() / 浏览器。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JianpuAudio = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ctx = null, master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      return ctx;
    }
    try {
      if (typeof tt !== "undefined" && tt.getAudioContext) {
        ctx = tt.getAudioContext(); // 抖音系统单例
      } else if (typeof wx !== "undefined" && wx.createWebAudioContext) {
        ctx = wx.createWebAudioContext();
      } else if (typeof globalThis !== "undefined" && globalThis.AudioContext) {
        ctx = new globalThis.AudioContext();
      } else if (root.AudioContext) {
        ctx = new root.AudioContext();
      }
    } catch (e) { ctx = null; }
    if (!ctx) return null;
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();

    master = ctx.createGain();
    // 抖音无 DynamicsCompressor，用较低主增益防和弦齐奏削波
    master.gain.value = (typeof tt !== "undefined") ? 0.6 : 0.8;
    master.connect(ctx.destination);

    // 反馈延迟混响（createDelay 三平台均支持；失败则干声）
    try {
      if (ctx.createDelay) {
        var delay = ctx.createDelay(1.0);
        delay.delayTime.value = 0.23;
        var feedback = ctx.createGain();
        feedback.gain.value = 0.28;
        var wet = ctx.createGain();
        wet.gain.value = 0.16;
        master.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(ctx.destination);
      }
    } catch (e) { /* 干声即可 */ }

    return ctx;
  }

  function currentTime() { return ctx ? ctx.currentTime : 0; }

  function newBus(volume) {
    if (!ctx) return null;
    var g = ctx.createGain();
    g.gain.value = volume;
    g.connect(master);
    return g;
  }

  function fadeBus(bus) {
    if (!bus || !ctx) return;
    try {
      var g = bus.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
      setTimeout(function () { try { bus.disconnect(); } catch (e) {} }, 150);
    } catch (e) {}
  }

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // 钢琴音：基频 triangle + 2/3/4 倍频正弦，指数衰减包络
  function playNote(midi, t, dur, vel, bus) {
    if (!ctx) return;
    var out = bus || master;
    var g = ctx.createGain();
    g.connect(out);
    var f = midiToFreq(midi);
    var decay = Math.min(Math.max(dur * 1.1, 0.35), 2.6);
    var partials = [
      [1, "triangle", 0.5],
      [2, "sine", 0.16],
      [3, "sine", 0.085],
      [4, "sine", 0.045]
    ];
    partials.forEach(function (p) {
      var mult = p[0], type = p[1], amp = p[2];
      var o = ctx.createOscillator(), pg = ctx.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      var dn = decay / (1 + (mult - 1) * 0.4);
      pg.gain.setValueAtTime(0.0001, t);
      pg.gain.exponentialRampToValueAtTime(amp * vel, t + 0.008);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.008 + dn);
      o.connect(pg);
      pg.connect(g);
      o.start(t);
      o.stop(t + 0.03 + dn);
    });
  }

  return {
    ensure: ensure,
    currentTime: currentTime,
    newBus: newBus,
    fadeBus: fadeBus,
    playNote: playNote
  };
});
