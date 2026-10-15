/*
 * main.js — 简谱钢琴抖音小游戏平台层（竖屏 450x800 逻辑世界，等比缩放 letterbox）
 * 负责：画布/DPR、触摸分发（多指钢琴）、系统键盘输入曲谱、音频时钟驱动引擎、生命周期。
 * 引擎 core 与渲染 render 均无平台依赖，Node 可直接测试。
 */
var Core = require("./core.js");
var parser = require("./parser.js");
var JianpuAudio = require("./audio.js");
var R = require("./render.js");

var Engine = Core.Engine;

// 平台对象：抖音 tt 优先，兼容微信 wx（浏览器 harness 注入 tt shim）
var api = (typeof tt !== "undefined" && tt) || (typeof wx !== "undefined" && wx) || null;

var sysInfo = api.getWindowInfo ? api.getWindowInfo() : api.getSystemInfoSync();
var dpr = sysInfo.pixelRatio || 1;
var vw = sysInfo.windowWidth;
var vh = sysInfo.windowHeight;

var canvas = api.createCanvas();
canvas.width = Math.round(vw * dpr);
canvas.height = Math.round(vh * dpr);
var ctx = canvas.getContext("2d");

var scale = Math.min(vw / R.W, vh / R.H);
var offX = (vw - R.W * scale) / 2;
var offY = (vh - R.H * scale) / 2;

/* ---------- 引擎 / UI 状态 ---------- */

var engine = new Engine();
var ui = { help: false, keyboard: false, pads: {}, verdict: null };
var activeBus = null;
var wasPlaying = false;
var bpmDragId = null;

/* ---------- 音频 ---------- */

function finishBusFast() {
  if (activeBus) { JianpuAudio.fadeBus(activeBus); activeBus = null; }
}

function startPlayback() {
  if (engine.playing) return;
  if (!JianpuAudio.ensure()) { toast("音频初始化失败"); return; }
  finishBusFast();
  var bus = JianpuAudio.newBus(engine.guide ? 0.4 : 0.92);
  activeBus = bus;
  var res = engine.start(JianpuAudio.currentTime(), function (midi, t, dur, vel) {
    JianpuAudio.playNote(midi, t, dur, vel, bus);
  });
  if (!res.ok) {
    JianpuAudio.fadeBus(bus);
    activeBus = null;
    toast("简谱里没有音符");
  }
}

function stopPlayback() {
  if (!engine.playing && !activeBus) return;
  engine.stop();
  finishBusFast();
}

// 自然收尾：保留尾音 0.7s 再断开总线
function playbackEnded() {
  var b = activeBus;
  activeBus = null;
  if (b) setTimeout(function () { try { b.disconnect(); } catch (e) {} }, 700);
  if (engine.result) {
    try { if (api.vibrateShort) api.vibrateShort({ type: "light" }); } catch (e) {}
  }
}

function toast(title) {
  try { if (api.showToast) api.showToast({ title: title, icon: "none" }); } catch (e) {}
}

/* ---------- 系统键盘（曲谱输入） ---------- */

function pickValue(res) {
  if (res && res.detail && res.detail.value != null) return res.detail.value;
  return res ? res.value : null;
}

function openKeyboard() {
  if (!api.showKeyboard) return; // 浏览器无系统键盘时不可编辑（harness 提供桩）
  // 编辑曲谱会使进行中的调度失效：先停播，避免音轨（tokensVM）与发声序列（events）不同步
  if (engine.playing) { engine.stop(); finishBusFast(); }
  ui.keyboard = true;
  try {
    api.showKeyboard({
      defaultValue: engine.scoreText,
      maxLength: -1,
      multiple: true,
      confirmHold: false,
      confirmType: "done"
    });
  } catch (e) {}
}

function closeKeyboard() {
  ui.keyboard = false;
  try { if (api.hideKeyboard) api.hideKeyboard(); } catch (e) {}
}

if (api.onKeyboardInput) api.onKeyboardInput(function (res) {
  var v = pickValue(res);
  if (v != null) engine.setScore(v);
});
if (api.onKeyboardConfirm) api.onKeyboardConfirm(function (res) {
  var v = pickValue(res);
  if (v != null) engine.setScore(v);
  closeKeyboard();
});
if (api.onKeyboardComplete) api.onKeyboardComplete(function () { closeKeyboard(); });

/* ---------- 触摸坐标 ---------- */

var touchProbed = false;
var touchScaleX = 1, touchScaleY = 1;

function rawPoint(touch) {
  var hasClient = touch.clientX != null;
  var px = hasClient ? touch.clientX : touch.screenX;
  var py = hasClient ? touch.clientY : touch.screenY;
  // 无 clientX 且原始坐标超出逻辑【屏幕】：真机按物理像素上报（越界量达数百~数千 px）→ 按 DPR 自校正。
  // 边界用 screenWidth 而非 windowWidth：窗口可能比屏幕窄，小越界（≤screenWidth）不是物理像素。
  var sw = sysInfo.screenWidth || vw, sh = sysInfo.screenHeight || vh;
  if (!hasClient && touchScaleX === 1 && dpr > 1 &&
      (px > sw + 2 || py > sh + 2 || px < -2 || py < -2)) {
    touchScaleX = touchScaleY = 1 / dpr;
    px *= touchScaleX; py *= touchScaleY;
    if (px > vw + 4 || py > vh + 4 || px < -4 || py < -4) {
      try { console.warn("[probe] touch still out of window after DPR normalize", JSON.stringify({ px: px, py: py, vw: vw, vh: vh })); } catch (e) {}
    }
  } else {
    px *= touchScaleX; py *= touchScaleY;
  }
  if (!touchProbed) {
    touchProbed = true;
    try {
      console.log("[probe] touch", JSON.stringify({
        clientX: touch.clientX, clientY: touch.clientY,
        screenX: touch.screenX, screenY: touch.screenY,
        vw: vw, vh: vh, dpr: dpr, norm: touchScaleX
      }));
    } catch (e) {}
  }
  return { px: px, py: py };
}

function toWorld(touch) {
  var p = rawPoint(touch);
  return { x: (p.px - offX) / scale, y: (p.py - offY) / scale };
}

/* ---------- 弹奏 ---------- */

function flashPad(deg) {
  ui.pads[deg] = true;
  setTimeout(function () { delete ui.pads[deg]; }, 120);
}

function padDown(deg) {
  if (!JianpuAudio.ensure()) return;
  var root = parser.ROOT_MIDI[engine.keyValue()];
  var midi = parser.midiOf(root, { deg: deg, oct: engine.liveOct, acc: 0 });
  JianpuAudio.playNote(midi, JianpuAudio.currentTime(), 1.0, 0.85, null);
  var verdict = engine.pressDegree(deg, JianpuAudio.currentTime());
  flashPad(deg);
  if (verdict) { try { if (api.vibrateShort) api.vibrateShort({ type: "light" }); } catch (e) {} }
}

function keyDown(midi) {
  if (!JianpuAudio.ensure()) return;
  JianpuAudio.playNote(midi, JianpuAudio.currentTime(), 1.0, 0.85, null);
  var r = engine.pressMidi(midi, JianpuAudio.currentTime());
  if (r.verdict) { try { if (api.vibrateShort) api.vibrateShort({ type: "light" }); } catch (e) {} }
}

/* ---------- 动作分发 ---------- */

function handleTap(id, x) {
  if (id === "help") { ui.help = true; return; }
  if (id === "helpClose") { ui.help = false; return; }
  if (id === "helpNone") return;

  if (id === "score") { openKeyboard(); return; }
  if (id && id.indexOf("chip:") === 0) {
    stopPlayback();
    engine.pickSong(+id.slice(5));
    return;
  }
  if (id === "keyCtl") { engine.cycleKey(); return; }
  if (id === "guide") { engine.toggleGuide(); return; }
  if (id === "bpm-") { engine.setBpm(engine.bpm - 5); return; }
  if (id === "bpm+") { engine.setBpm(engine.bpm + 5); return; }
  if (id === "bpmTrack") { engine.setBpm(R.bpmFromX(x)); return; }
  if (id === "play") { startPlayback(); return; }
  if (id === "stop") { stopPlayback(); return; }
  if (id === "oct-") { engine.shiftOct(-1); return; }
  if (id === "oct+") { engine.shiftOct(1); return; }
  if (id && id.indexOf("pad:") === 0) { padDown(+id.slice(4)); return; }
  if (id && (id.indexOf("w:") === 0 || id.indexOf("b:") === 0)) { keyDown(+id.slice(2)); return; }
  if (id === "resultReplay") { engine.result = null; startPlayback(); return; }
  if (id === "resultClose") { engine.result = null; return; }
}

api.onTouchStart(function (e) {
  JianpuAudio.ensure(); // 首触解锁音频
  var touches = e.changedTouches || [];
  for (var i = 0; i < touches.length; i++) {
    var t = touches[i];
    var p = toWorld(t);
    var id = R.hitTest(p.x, p.y, engine, ui);
    if (id === "bpmTrack") bpmDragId = t.identifier;
    handleTap(id, p.x);
  }
});

api.onTouchMove(function (e) {
  if (bpmDragId == null) return;
  var touches = e.changedTouches || [];
  for (var i = 0; i < touches.length; i++) {
    if (touches[i].identifier === bpmDragId) {
      var p = toWorld(touches[i]);
      engine.setBpm(R.bpmFromX(p.x));
    }
  }
});

function endDrag(e) {
  if (bpmDragId == null) return;
  var touches = e.changedTouches || [];
  for (var i = 0; i < touches.length; i++) {
    if (touches[i].identifier === bpmDragId) bpmDragId = null;
  }
}
api.onTouchEnd(endDrag);
api.onTouchCancel(endDrag);

/* ---------- 生命周期 ---------- */

if (api.setKeepScreenOn) {
  try { api.setKeepScreenOn({ keepScreenOn: true }); } catch (e) {}
}
if (api.onHide) api.onHide(function () {
  stopPlayback();
  closeKeyboard();
  bpmDragId = null;
});
if (api.onShow) api.onShow(function () { JianpuAudio.ensure(); });

/* ---------- 主循环（跟随 rAF；纯 UI 应用无需固定步长） ---------- */

function frame() {
  var now = JianpuAudio.currentTime();
  engine.update(now);

  if (!wasPlaying && engine.playing) wasPlaying = true;
  else if (wasPlaying && !engine.playing) { wasPlaying = false; playbackEnded(); }

  ui.verdict = engine.verdict.show
    ? { text: engine.verdict.text, t: engine.verdict.until - 0.8 }
    : null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0b0912";
  ctx.fillRect(0, 0, vw * dpr, vh * dpr);

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
  R.draw(ctx, engine, ui, now);

  requestAnimationFrame(frame);
}

if (typeof globalThis !== "undefined") {
  globalThis.__piano = {
    engine: engine, ui: ui,
    startPlayback: startPlayback, stopPlayback: stopPlayback,
    openKeyboard: openKeyboard, closeKeyboard: closeKeyboard,
    setScore: function (s) { engine.setScore(s); },
    hit: function (x, y) { return R.hitTest(x, y, engine, ui); },
    handleTap: handleTap
  };
}
requestAnimationFrame(frame);
