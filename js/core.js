/*
 * core.js — 简谱钢琴纯逻辑引擎（无 DOM / 无音频对象，时钟由外部注入，Node 可测）
 * 负责：简谱 token VM、钢琴键盘几何、自动播放调度、亮键状态、跟弹判定与结算。
 * 音频只通过 start(now, scheduleNote) 的调度回调发声，引擎不碰音频节点。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./parser.js"), require("./songs.js"));
  } else {
    root.JianpuCore = factory(root.JianpuParser, root.JianpuSongs);
  }
})(typeof self !== "undefined" ? self : this, function (parser, SONGS) {
  "use strict";

  var PIANO_START = 36; // C2
  var PIANO_END = 95;   // B6
  var WHITE_COUNT = 35;
  var BLACK_PC = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
  var OCT_NAMES = ["倍低音", "低音", "中音", "高音", "倍高音"];
  var KEY_OPTS = [
    { v: "C", label: "1 = C" }, { v: "D", label: "1 = D" }, { v: "E", label: "1 = E" },
    { v: "F", label: "1 = F" }, { v: "G", label: "1 = G" }, { v: "A", label: "1 = A" },
    { v: "B", label: "1 = B" }, { v: "bB", label: "1 = ♭B" }, { v: "bE", label: "1 = ♭E" }
  ];

  // 时序常量（秒）
  var LEAD = 0.22;       // 按下播放到首音的前置时间
  var LIT_PRE = 0.03;    // 亮键提前量
  var LIT_POST_MAX = 0.55;
  var MANUAL_LIT = 0.45; // 手动弹奏亮键时长
  var MISS_AFTER = 0.32; // 音符过去多少秒判漏
  var JUDGE_HALF = 0.4;  // 判定半窗
  var TARGET_EARLY = 0.05;
  var SOON = 0.3;
  var FINISH_GRACE = 0.35;
  var PERFECT = 0.12, GOOD = 0.26;
  var MIN_BPM = 40, MAX_BPM = 200;

  function octClass(oct) { return oct < 0 ? "lit-low" : oct > 0 ? "lit-high" : "lit-mid"; }

  function buildTokenVM(t) {
    var ext = t.beats > 1 ? Math.min(3, Math.round(t.beats) - 1) : 0;
    if (t.type === "rest") {
      return { kind: "rest", dig: "0", extText: "–".repeat(ext) };
    }
    if (t.type === "chord") {
      return {
        kind: "chord",
        digs: t.notes.map(function (n) { return "" + n.deg; }).join(""),
        extText: "–".repeat(ext)
      };
    }
    return {
      kind: "note",
      dig: "" + t.deg,
      acc: t.acc > 0 ? "♯".repeat(t.acc) : (t.acc < 0 ? "♭".repeat(-t.acc) : ""),
      ups: Math.max(0, t.oct),
      dns: Math.max(0, -t.oct),
      upText: "·".repeat(Math.max(0, t.oct)),
      dnText: "·".repeat(Math.max(0, -t.oct)),
      extText: "–".repeat(ext)
    };
  }

  /** 键盘几何（白键序号 wi∈[0,35)；黑键记录其左侧白键序号，像素换算交给 render） */
  function buildKeyboard() {
    var whites = [], blacks = [];
    var wi = 0;
    for (var m = PIANO_START; m <= PIANO_END; m++) {
      var pc = m % 12;
      if (BLACK_PC[pc]) {
        blacks.push({ midi: m, leftWi: wi - 1 });
      } else {
        whites.push({
          midi: m, wi: wi,
          label: pc === 0 ? "C" + (Math.floor(m / 12) - 1) : ""
        });
        wi++;
      }
    }
    return { whites: whites, blacks: blacks, whiteCount: WHITE_COUNT };
  }

  function previewVM(text) {
    return parser.parseScore(text).map(buildTokenVM);
  }

  function Engine() {
    // 设置
    this.songs = SONGS;
    this.scoreText = SONGS[0].s;
    this.keyIndex = 0;
    this.bpm = SONGS[0].b;
    this.guide = false;
    this.liveOct = 0;
    this.keyOpts = KEY_OPTS;
    this.octNames = OCT_NAMES;

    // 静态几何
    this.kb = buildKeyboard();
    this.tokensVM = previewVM(this.scoreText);

    // 播放状态
    this.playing = false;
    this.events = [];
    this.judges = [];
    this.curTok = -1;
    this.t0 = 0;
    this.endT = 0;
    this.trackShown = false; // 本次选曲是否已开始播放过（音轨卡显示开关；换曲/改谱复位，停播/曲终保留）

    // 表现状态
    this.lit = {};                 // midi -> 'lit-low'|'lit-mid'|'lit-high'
    this.manualLit = {};           // midi -> {oct, until}
    this.progress = 0;
    this.target = { dig: "·", cls: "target" };
    this.verdict = { text: "", show: false, until: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.accText = "–";
    this.result = null;            // {rate, hits, total, maxCombo}
  }

  Engine.prototype.keyValue = function () { return KEY_OPTS[this.keyIndex].v; };

  Engine.prototype.setScore = function (text) {
    this.scoreText = text;
    this.tokensVM = previewVM(text);
    this.trackShown = false; // 新谱未播放前音轨留空（对齐源小程序 tokens=[] 初始态）
  };

  Engine.prototype.pickSong = function (i) {
    var song = SONGS[i];
    if (!song) return;
    this.stop();
    this.scoreText = song.s;
    this.bpm = song.b;
    var ki = 0;
    KEY_OPTS.forEach(function (k, idx) { if (k.v === song.k) ki = idx; });
    this.keyIndex = ki;
    this.tokensVM = previewVM(song.s);
    this.trackShown = false;
  };

  Engine.prototype.cycleKey = function () { this.keyIndex = (this.keyIndex + 1) % KEY_OPTS.length; };
  Engine.prototype.toggleGuide = function () { this.guide = !this.guide; };
  Engine.prototype.shiftOct = function (d) {
    this.liveOct = Math.max(-2, Math.min(2, this.liveOct + d));
  };
  Engine.prototype.setBpm = function (v) {
    this.bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(v)));
  };

  /**
   * 开始播放。scheduleNote(midi, t, dur, vel) 由平台层接到音频引擎。
   * @returns {{ok:true}|{ok:false, why:'empty'}}
   */
  Engine.prototype.start = function (now, scheduleNote) {
    var toks = parser.parseScore(this.scoreText);
    if (!parser.hasNotes(toks)) return { ok: false, why: "empty" };

    this.stop();
    this.tokensVM = toks.map(buildTokenVM);

    var root = parser.ROOT_MIDI[this.keyValue()];
    var spb = 60 / this.bpm;
    this.t0 = now + LEAD;

    var beat = 0;
    var events = toks.map(function (tk, idx) {
      var ev = { tk: tk, idx: idx, t: this.t0 + beat * spb, dur: tk.beats * spb };
      beat += tk.beats;
      return ev;
    }.bind(this));
    this.endT = this.t0 + beat * spb;

    events.forEach(function (ev) {
      parser.expand(ev.tk).forEach(function (n) {
        if (n.type === "note") {
          scheduleNote(parser.midiOf(root, n), ev.t, ev.dur, 0.9);
        }
      });
    });

    var judges = [];
    events.forEach(function (ev) {
      parser.expand(ev.tk).forEach(function (n) {
        if (n.type === "note") judges.push({ t: ev.t, deg: n.deg, oct: n.oct, done: false });
      });
    });

    this.events = events;
    this.judges = judges;
    this.curTok = -1;
    this.combo = 0;
    this.maxCombo = 0;
    this.hits = 0;
    this.misses = 0;
    this.accText = "–";
    this.progress = 0;
    this.lit = {};
    this.target = { dig: "·", cls: "target" };
    this.verdict = { text: "", show: false, until: 0 };
    this.result = null;
    this.playing = true;
    this.trackShown = true; // 音轨卡开始显示；之后停播/曲终都保留（对齐源小程序播放后 tokens 不清空）
    return { ok: true };
  };

  Engine.prototype.stop = function () {
    this.playing = false;
    this.events = [];
    this.judges = [];
    this.curTok = -1;
    this.progress = 0;
    this.lit = {};
    this.target = { dig: "·", cls: "target" };
    this.verdict = { text: "", show: false, until: 0 };
    this.result = null;
  };

  Engine.prototype._accText = function () {
    var total = this.hits + this.misses;
    return total ? Math.round(this.hits / total * 100) + "%" : "–";
  };

  Engine.prototype._finish = function () {
    this.playing = false;
    this.curTok = -1;
    this.lit = {};
    this.events = [];
    this.target = { dig: "·", cls: "target" };
    if (this.guide) {
      var total = this.hits + this.misses;
      var rate = total ? Math.round(this.hits / total * 100) : 100;
      this.result = { rate: rate, hits: this.hits, total: total, maxCombo: this.maxCombo };
    }
  };

  /** 每帧驱动（now = 音频时钟秒）。空闲时也维护手动亮键衰减。 */
  Engine.prototype.update = function (now) {
    // 手动亮键过期
    Object.keys(this.manualLit).forEach(function (midi) {
      if (now > this.manualLit[midi].until) delete this.manualLit[midi];
    }.bind(this));

    if (this.verdict.show && now > this.verdict.until) this.verdict.show = false;
    if (!this.playing) {
      this._rebuildManualLit();
      return;
    }

    var root = parser.ROOT_MIDI[this.keyValue()];

    // 自动播放亮键 + 手动亮键
    var lit = {};
    Object.keys(this.manualLit).forEach(function (midi) {
      lit[midi] = octClass(this.manualLit[midi].oct);
    }.bind(this));
    this.events.forEach(function (ev) {
      if (now >= ev.t - LIT_PRE && now <= ev.t + Math.min(ev.dur, LIT_POST_MAX)) {
        parser.expand(ev.tk).forEach(function (n) {
          if (n.type === "note") lit[parser.midiOf(root, n)] = octClass(n.oct);
        });
      }
    });
    this.lit = lit;

    // 当前音符（供音轨滚动）
    var idx = -1;
    for (var k = 0; k < this.events.length; k++) {
      if (this.events[k].t <= now) idx = k; else break;
    }
    this.curTok = idx;

    // 进度
    var span = this.endT - this.t0;
    this.progress = Math.max(0, Math.min(100, (now - this.t0) / span * 100));

    // 漏判：仅跟弹模式累计。自动演奏（guide=false）不评分，漏判累加会在中途
    // 切模式/重新跟弹时污染命中率分母
    if (this.guide) {
      var missed = false;
      for (var j = 0; j < this.judges.length; j++) {
        var jj = this.judges[j];
        if (!jj.done && now > jj.t + MISS_AFTER) {
          jj.done = true;
          this.misses++;
          this.combo = 0;
          missed = true;
        }
      }
      if (missed) this.accText = this._accText();
    }

    // 下一个目标音符
    if (this.guide) {
      var next = null;
      for (var i = 0; i < this.judges.length; i++) {
        var x = this.judges[i];
        if (!x.done && x.t > now - TARGET_EARLY) { next = x; break; }
      }
      var dig = next ? "" + next.deg : "·";
      var cls = next
        ? "target" + (next.oct < 0 ? " low" : next.oct > 0 ? " high" : "") +
          (Math.abs(next.t - now) < SOON ? " soon" : "")
        : "target";
      this.target = { dig: dig, cls: cls };
    }

    if (now > this.endT + FINISH_GRACE) this._finish();
  };

  Engine.prototype._rebuildManualLit = function () {
    var lit = {};
    Object.keys(this.manualLit).forEach(function (midi) {
      lit[midi] = octClass(this.manualLit[midi].oct);
    }.bind(this));
    this.lit = lit;
  };

  /** 跟弹判定：数字键按下。返回评级或 null（不在任何判定窗） */
  Engine.prototype.pressDegree = function (deg, now) {
    if (!this.playing || !this.guide) return null;
    var best = null, bd = JUDGE_HALF;
    for (var i = 0; i < this.judges.length; i++) {
      var j = this.judges[i];
      if (!j.done && j.deg === deg) {
        var d = Math.abs(j.t - now);
        if (d < bd) { bd = d; best = j; }
      }
    }
    if (!best) return null;
    best.done = true;
    this.hits++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.accText = this._accText();
    var rank = bd < PERFECT ? "perfect" : bd < GOOD ? "good" : "ok";
    var text = rank === "perfect" ? "PERFECT" : rank === "good" ? "GOOD" : "OK";
    this.verdict = { text: text, show: true, until: now + 0.8 };
    return rank;
  };

  /** 钢琴实体键按下：黑键照常发声但不参与跟弹判定（调外无阶名） */
  Engine.prototype.pressMidi = function (midi, now) {
    var root = parser.ROOT_MIDI[this.keyValue()];
    var semis = midi - root;
    var deg = 0, oct = 0;
    for (var d = 1; d <= 7; d++) {
      var o = Math.round((semis - parser.DEG_OFF[d]) / 12);
      if (parser.DEG_OFF[d] + 12 * o === semis) { deg = d; oct = o; break; }
    }
    this.manualLit[midi] = { oct: oct, until: now + MANUAL_LIT };
    if (!this.playing) this._rebuildManualLit();
    var verdict = deg ? this.pressDegree(deg, now) : null;
    return { midi: midi, deg: deg, oct: oct, verdict: verdict };
  };

  return {
    Engine: Engine,
    constants: {
      PIANO_START: PIANO_START, PIANO_END: PIANO_END, WHITE_COUNT: WHITE_COUNT,
      BLACK_PC: BLACK_PC, JUDGE_HALF: JUDGE_HALF, PERFECT: PERFECT, GOOD: GOOD,
      MIN_BPM: MIN_BPM, MAX_BPM: MAX_BPM
    },
    buildKeyboard: buildKeyboard,
    buildTokenVM: buildTokenVM,
    octClass: octClass,
    KEY_OPTS: KEY_OPTS,
    OCT_NAMES: OCT_NAMES
  };
});
