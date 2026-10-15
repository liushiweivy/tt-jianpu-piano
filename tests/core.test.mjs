/*
 * core + render 纯逻辑测试：可控时钟 + scheduleNote 探针，不依赖音频节点与 Canvas。
 * 断言集移植自 jianpu-piano-mp/tools/smoke-test.js，并补 render 命中几何。
 * 运行：node --test tests/core.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../js/core.js");
const R = require("../js/render.js");
const Engine = Core.Engine;

function notesSpy() {
  var calls = [];
  function fn(midi, t, dur, vel) { calls.push({ midi: midi, t: t, dur: dur, vel: vel }); }
  fn.calls = calls;
  return fn;
}

test("键盘几何：35 白键 / 25 黑键，首键 C2", function () {
  var e = new Engine();
  assert.strictEqual(e.kb.whites.length, 35);
  assert.strictEqual(e.kb.blacks.length, 25);
  assert.strictEqual(e.kb.whites[0].midi, 36);
  assert.strictEqual(e.kb.whites[0].label, "C2");
  // 白键序号连续：最后一键 B6(midi95)，白键序号 34
  assert.strictEqual(e.kb.whites[34].midi, 95);
  assert.strictEqual(e.kb.whites[34].wi, 34);
  // 黑键记录左侧白键序号
  assert.strictEqual(e.kb.blacks[0].midi, 37); // C#2
  assert.strictEqual(e.kb.blacks[0].leftWi, 0);
});

test("render 白键几何铺满钢琴区，黑键居中跨缝", function () {
  var first = R.whiteRect(0);
  var last = R.whiteRect(34);
  assert.ok(Math.abs(first.x - R.L.pianoX) < 1e-9);
  assert.ok(Math.abs(last.x + last.w - (R.L.pianoX + R.L.pianoW)) < 1e-9);
  var br = R.blackRect(0);
  var ww = R.L.pianoW / 35;
  assert.ok(Math.abs((br.x + br.w / 2) - (R.L.pianoX + ww)) < 1e-9); // C#2 中心在 C/D 缝
});

test("自动播放：7 token、末音 2 拍、亮键随时钟推进", function () {
  var e = new Engine();
  e.setScore("1 1 5 5 | 6 6 5 -");
  e.setBpm(60);
  var spy = notesSpy();
  assert.deepStrictEqual(e.start(0, spy), { ok: true });
  assert.strictEqual(e.playing, true);
  assert.strictEqual(e.tokensVM.length, 7);
  assert.strictEqual(e.events[6].dur, 2);
  assert.strictEqual(e.result, null); // 非跟弹不结算

  e.update(0.26); // t0=0.22，第一个音响起
  assert.strictEqual(e.curTok, 0);
  assert.strictEqual(e.lit[60], "lit-mid");

  e.update(1.26); // 第二个音仍是 1
  assert.strictEqual(e.curTok, 1);
  assert.ok(e.lit[60]);
  assert.ok(!e.lit[67]);

  e.update(2.26); // 第三个音 5 → G4=67
  assert.strictEqual(e.lit[67], "lit-mid");

  // 手动点低音 5, → midi55 蓝键，自动亮键保留
  var r = e.pressMidi(55, 2.26);
  assert.strictEqual(r.oct, -1);
  e.update(2.26);
  assert.strictEqual(e.lit[55], "lit-low");
  assert.strictEqual(e.lit[67], "lit-mid");

  // 调度：8 个发声事件（末音 2 拍但仍 1 个音符），首音 t=0.22，末音 t=6.22 dur=2
  assert.strictEqual(spy.calls.length, 7);
  assert.ok(Math.abs(spy.calls[0].t - 0.22) < 1e-9);
  assert.ok(Math.abs(spy.calls[6].t - 6.22) < 1e-9);
  assert.strictEqual(spy.calls[6].dur, 2);

  e.update(8.7); // 8 拍 + 0.22 + 0.35 宽限后收尾
  assert.strictEqual(e.playing, false);
  assert.strictEqual(e.result, null);
  assert.strictEqual(e.misses, 0); // 自动演奏（非跟弹）不累计漏判
});

test("trackShown：播放后置位，停播/曲终保留，改谱/选曲复位", function () {
  var e = new Engine();
  assert.strictEqual(e.trackShown, false); // 初始音轨留空
  e.setScore("1 2 3");
  e.start(0, function () {});
  assert.strictEqual(e.trackShown, true);
  e.stop();
  assert.strictEqual(e.trackShown, true); // 停止后音轨保留
  e.setScore("1 2");
  assert.strictEqual(e.trackShown, false); // 改谱后留空至再次播放
  e.setBpm(200);
  e.start(0, function () {});
  e.update(2); // 超过 endT+0.35 曲终
  assert.strictEqual(e.playing, false);
  assert.strictEqual(e.trackShown, true); // 曲终后音轨保留
  e.pickSong(0);
  assert.strictEqual(e.trackShown, false); // 选曲复位
});

test("跟弹模式：命中 1 个、错音不计、其余漏判，结算 1/7 = 14%", function () {
  var e = new Engine();
  e.setScore("1 1 5 5 | 6 6 5 -");
  e.setBpm(60);
  e.toggleGuide();
  assert.strictEqual(e.guide, true);
  e.start(10, function () {});

  e.update(10.26);
  assert.strictEqual(e.target.dig, "1");
  assert.ok(/soon/.test(e.target.cls));
  var rank = e.pressDegree(1, 10.26);
  assert.strictEqual(rank, "perfect");
  assert.strictEqual(e.combo, 1);
  assert.strictEqual(e.accText, "100%");
  assert.strictEqual(e.verdict.show, true);

  e.update(11.26);
  assert.strictEqual(e.pressDegree(2, 11.26), null); // 等的是 1，错音
  assert.strictEqual(e.combo, 1);

  e.update(18.7);
  assert.strictEqual(e.playing, false);
  assert.ok(e.result);
  assert.strictEqual(e.result.hits, 1);
  assert.strictEqual(e.result.total, 7);
  assert.strictEqual(e.result.rate, 14);
});

test("跟弹评级：PERFECT/GOOD/OK 三档与连击重置", function () {
  var e = new Engine();
  e.setScore("1 2 3 4");
  e.setBpm(60);
  e.toggleGuide();
  e.start(0, function () {}); // t0=0.22，judge 时刻 0.22/1.22/2.22/3.22
  assert.strictEqual(e.pressDegree(1, 0.22 + 0.15), "good");
  assert.strictEqual(e.pressDegree(2, 1.22 + 0.30), "ok");
  assert.strictEqual(e.combo, 2);
  e.update(2.6); // 第三个音 t=2.22 在 2.54 漏判
  assert.strictEqual(e.combo, 0);
  assert.strictEqual(e.misses, 1);
});

test("跟弹中途关闭再开启：关闭期积压不判漏，重开后一次性补判（对齐源小程序）", function () {
  var e = new Engine();
  e.setScore("1 2 3 4");
  e.setBpm(60);
  e.toggleGuide();
  e.start(0, function () {}); // judge 时刻 0.22/1.22/2.22/3.22
  e.update(0.26);
  e.guide = false;           // 中途关闭跟弹
  e.update(3.0);             // 前三个音早已过期
  assert.strictEqual(e.misses, 0);
  assert.ok(e.judges[0].done === false && e.judges[2].done === false);
  e.guide = true;            // 重新开启
  e.update(3.0);
  assert.strictEqual(e.misses, 3); // 0.22/1.22/2.22 三音一次性补判；3.22 未到期
  assert.strictEqual(e.combo, 0);
});

test("空输入（只有小节线/问号）不能播放", function () {
  var e = new Engine();
  e.setScore("| | ？");
  var res = e.start(0, function () {});
  assert.deepStrictEqual(res, { ok: false, why: "empty" });
  assert.strictEqual(e.playing, false);
});

test("黑键照常发声但不参与跟弹判定（pressMidi deg=0）", function () {
  var e = new Engine();
  var r = e.pressMidi(66, 0); // F#4，C 调外
  assert.strictEqual(r.deg, 0);
  assert.strictEqual(r.verdict, null);
  assert.ok(e.manualLit[66]);
});

test("设置项边界：调号循环、八度钳制、速度钳制、选曲", function () {
  var e = new Engine();
  for (var i = 0; i < 9; i++) e.cycleKey();
  assert.strictEqual(e.keyIndex, 0);
  e.shiftOct(-5);
  assert.strictEqual(e.liveOct, -2);
  e.shiftOct(9);
  assert.strictEqual(e.liveOct, 2);
  e.setBpm(8); assert.strictEqual(e.bpm, 40);
  e.setBpm(999); assert.strictEqual(e.bpm, 200);
  e.pickSong(1);
  assert.strictEqual(e.scoreText, e.songs[1].s);
  assert.strictEqual(e.bpm, e.songs[1].b);
  assert.strictEqual(e.playing, false);
});

test("stop 清理播放与亮键", function () {
  var e = new Engine();
  e.setScore("1 2 3");
  e.start(0, function () {});
  e.update(0.26);
  assert.ok(Object.keys(e.lit).length > 0);
  e.stop();
  assert.strictEqual(e.playing, false);
  assert.strictEqual(e.curTok, -1);
  assert.deepStrictEqual(e.lit, {});
});

test("render.hitTest：各控件/垫/琴键命中", function () {
  var e = new Engine();
  var ui = { help: false };
  var L = R.L;
  // 播放按钮中央
  var playY = L.ctlY + 80;
  assert.strictEqual(R.hitTest(L.cardX + 30, playY, e, ui), "play");
  // 跟弹开关
  assert.strictEqual(R.hitTest(L.cardX + L.cardW - 100, L.ctlY + 18, e, ui), "guide");
  // 数字垫 1（最左）
  var p0 = R.padRects()[0];
  assert.strictEqual(R.hitTest(p0.x + p0.w / 2, p0.y + 20, e, ui), "pad:1");
  // 白键：点钢琴底部避开黑键层。C4 midi60 = 白键序号 14
  var w = R.whiteRect(14);
  assert.strictEqual(R.hitTest(w.x + w.w / 2, L.pianoY + L.pianoH - 4, e, ui), "w:60");
  // 黑键 C#2(midi37) 顶部
  var b = R.blackRect(0);
  assert.strictEqual(R.hitTest(b.x + b.w / 2, L.pianoY + 6, e, ui), "b:37");
  // 黑键命中严格用视觉矩形：D4(wi15,midi62) 白键上半段中心必须点得到白键
  // （旧的外扩 ±2 热区会被 D#4 黑键吃掉该点）
  var d4 = R.whiteRect(15);
  assert.strictEqual(R.hitTest(d4.x + d4.w / 2, L.pianoY + 6, e, ui), "w:62");
  // 黑键视觉左缘外 1.5px 落在白键 D4（旧外扩 ±2 热区会把此点吞成 b:63）
  var dSharp4 = R.blackRect(15); // D#4=63，骑在 D4/E4 缝上
  assert.strictEqual(R.hitTest(dSharp4.x - 1.5, L.pianoY + 6, e, ui), "w:62");
  // 语法说明
  assert.strictEqual(R.hitTest(L.cardX + L.cardW - 49, L.inputY + 21, e, ui), "help");
  // 曲谱编辑区
  var a = { x: L.cardX + 12, y: L.inputY + 40, w: L.cardW - 24, h: 64 };
  assert.strictEqual(R.hitTest(a.x + 10, a.y + 10, e, ui), "score");
  // chip（chipRects 首键 x=24、宽 62）
  assert.strictEqual(R.hitTest(30, L.inputY + 40 + 64 + 16, e, ui), "chip:0");
});

test("render.hitTest：help 与结算弹层模态", function () {
  var e = new Engine();
  var ui = { help: true };
  assert.strictEqual(R.hitTest(10, 10, e, ui), "helpClose"); // 点遮罩关闭
  assert.strictEqual(R.hitTest(R.W / 2, 300, e, ui), "helpNone"); // 点盒子不关
  ui.help = false;
  e.result = { rate: 100, hits: 7, total: 7, maxCombo: 7 };
  var bw = 320, bx = (R.W - bw) / 2, by = (R.H - 218) / 2 - 30;
  assert.strictEqual(R.hitTest(bx + 40, by + 218 - 33, e, ui), "resultReplay");
  assert.strictEqual(R.hitTest(10, 10, e, ui), "resultNone");
});

test("render.hitTest：速度滑杆命中高度 16（不侵上方行）", function () {
  var e = new Engine();
  var ui = { help: false };
  var L = R.L, x0 = L.cardX + 14, y2 = L.ctlY + 52;
  // tb：x0+120 起、右端留 64
  var tb = { x: x0 + 120, w: L.cardX + L.cardW - x0 - 120 - 64 };
  assert.strictEqual(R.hitTest(tb.x + 10, y2, e, ui), "bpmTrack");       // 中线
  assert.strictEqual(R.hitTest(tb.x + 10, y2 - 11, e, ui), "bpmTrack");  // 上沿
  assert.notStrictEqual(R.hitTest(tb.x + 10, y2 - 13, e, ui), "bpmTrack"); // 再上 2px 不是滑杆
  assert.notStrictEqual(R.hitTest(tb.x + 10, y2 + 6, e, ui), "bpmTrack");  // 下沿外
});

test("render.bpmFromX 钳制与中点", function () {
  // 与 render 内 bpmTrackBox 同几何（x0+120 起、右端留 64 给 + 钮）
  var L = R.L, x0 = L.cardX + 14;
  var trX = x0 + 120, trW = L.cardX + L.cardW - x0 - 120 - 64;
  assert.strictEqual(R.bpmFromX(trX - 999), 40);
  assert.strictEqual(R.bpmFromX(trX + trW + 999), 200);
  assert.strictEqual(R.bpmFromX(trX + trW / 2), 120);
});

test("wrapScore 多行与超长折行", function () {
  assert.deepStrictEqual(R.wrapScore("a\nb", 46), ["a", "b"]);
  assert.deepStrictEqual(R.wrapScore("", 46), []);
  var longLine = "1 2 3 4 5 6 7 ".repeat(6).trim(); // 48 字符
  var wrapped = R.wrapScore(longLine, 20);
  assert.ok(wrapped.length >= 3);
  wrapped.forEach(function (ln) { assert.ok(ln.length <= 20); });
});
