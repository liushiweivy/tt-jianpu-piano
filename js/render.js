/*
 * render.js — 简谱钢琴竖屏 Canvas UI（450x800 逻辑世界，纯绘制 + 命中几何）
 * 布局：header / 简谱输入卡 / 控制卡 / 音轨卡 / 数字垫 / 35+25 钢琴 / 脚注 / 结算·语法两个弹层。
 * 不碰音频与平台 API；状态全部来自 Engine 实例与 ui（help/keyboard/flash/verdictAt）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"));
  } else {
    root.JianpuRender = factory(root.JianpuCore);
  }
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  var W = 450, H = 800;
  var M = 12;

  /* ---------- 调色板（同源小程序 wxss） ---------- */
  var C = {
    bg0: "#15121f", bg1: "#0f0d18",
    gold: "#e8b365", goldLt: "#f6dda8", goldDeep: "#a98144",
    ink: "#241804", text: "#ece7dd", textDim: "#cfc8dc", textMut: "#9b94aa",
    blue: "#7cc4ff", pink: "#ff8fa3",
    cardTop: "rgba(255,255,255,0.055)", cardBot: "rgba(255,255,255,0.02)",
    line: "rgba(255,255,255,0.10)", lineSoft: "rgba(255,255,255,0.07)",
    areaBg: "#12101c",
    white0: "#fbf8f1", white1: "#f1ebdd", white2: "#d8d1c0", whiteEdge: "#b6afa0",
    black0: "#34303f", black1: "#15121c", black2: "#07060a",
  };
  var LIT = {
    "lit-mid": { w0: "#fff1d4", w1: "#e8b365", b0: "#a98144", b1: "#e8b365", glow: "rgba(232,179,101,0.55)" },
    "lit-low": { w0: "#e2f2ff", w1: "#7cc4ff", b0: "#3d6f9e", b1: "#7cc4ff", glow: "rgba(124,196,255,0.55)" },
    "lit-high": { w0: "#ffe4ea", w1: "#ff8fa3", b0: "#9c4f62", b1: "#ff8fa3", glow: "rgba(255,143,163,0.55)" }
  };

  var SOL = ["do", "re", "mi", "fa", "sol", "la", "si"];

  var HELP_ROWS = [
    ["1 2 3 4 5 6 7", "do re mi fa sol la si"],
    ["0", "休止符（静音）"],
    ["1'　1''", "高音点：高八度 / 高两个八度"],
    ["1,　1,,", "低音点：低八度 / 低两个八度"],
    ["5 -", "增时线：每个「-」延长一拍"],
    ["5_", "减时线：时值减半，5__ 为十六分"],
    ["3. 2_", "附点：时值 ×1.5"],
    ["2'#　7b", "升号 ♯ / 降号 ♭，写数字前后均可"],
    ["[1 3 5]", "和弦：括号内音符同时发声"],
    ["|　||", "小节线，仅作分隔"]
  ];

  /* ---------- 布局（y 坐标） ---------- */
  var L = {
    cardX: M, cardW: W - M * 2,
    inputY: 86,
    ctlY: 252,
    stageY: 366,
    padY: 492,
    pianoY: 556, pianoH: 150,
    footY: 720
  };
  L.inputH = 158;
  L.ctlH = 106;
  L.stageH = 118;
  L.padH = 56;
  L.pianoX = M; L.pianoW = W - M * 2;

  // 速度滑杆几何（绘制/命中/bpmFromX 共用，防三处漂移）
  function bpmTrackBox() {
    var x0 = L.cardX + 14;
    var trX = x0 + 120;
    var trW = L.cardX + L.cardW - x0 - 120 - 64;
    return { x: trX, w: trW };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function card(ctx, x, y, w, h) {
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, C.cardTop);
    g.addColorStop(1, C.cardBot);
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, 11);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function pill(ctx, x, y, w, h, opts) {
    var fill = opts.fill || "rgba(255,255,255,0.05)";
    var stroke = opts.stroke || "rgba(255,255,255,0.16)";
    if (opts.gradient) {
      var g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "#f6dda8"); g.addColorStop(1, "#e8b365");
      fill = g; stroke = "transparent";
    }
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    if (stroke !== "transparent") {
      ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function text(ctx, s, x, y, size, color, align, baseline, weight, alpha) {
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = (weight || "400") + " " + size + "px sans-serif";
    ctx.textAlign = align || "left";
    ctx.textBaseline = baseline || "alphabetic";
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  /* ---------- header ---------- */
  function drawHeader(ctx) {
    ctx.save();
    ctx.shadowColor = "rgba(232,179,101,0.25)"; ctx.shadowBlur = 22;
    text(ctx, "简 谱 钢 琴", W / 2, 44, 34, C.gold, "center", "alphabetic", "700");
    ctx.restore();
    text(ctx, "JIANPU PIANO", W / 2, 60, 10, C.textMut, "center", "alphabetic", "500");
    text(ctx, "输入简谱，琴键自鸣 · 跟弹模式，看你能连多少击", W / 2, 76, 12, C.textDim, "center");
  }

  /* ---------- 简谱输入卡 ---------- */
  function inputAreaBox() {
    return { x: L.cardX + 12, y: L.inputY + 40, w: L.cardW - 24, h: 64 };
  }

  function chipsBox() {
    return { x: L.cardX + 12, y: L.inputY + 40 + 64 + 8, w: L.cardW - 24, h: 28 };
  }

  // chips 总宽 ≤ 卡宽时均分间距
  function chipRects(engine) {
    var box = chipsBox();
    var n = engine.songs.length;
    var widths = [];
    var total = 0;
    for (var i = 0; i < n; i++) {
      var w = engine.songs[i].n.length * 12 + 26;
      widths.push(w); total += w;
    }
    var gap = n > 1 ? Math.min(14, (box.w - total) / (n - 1)) : 0;
    var x = box.x;
    if (gap < 0) gap = 8; // 超长则左排（当前 5 曲不会触发）
    var rects = [];
    for (var j = 0; j < n; j++) {
      rects.push({ x: x, y: box.y, w: widths[j], h: box.h });
      x += widths[j] + gap;
    }
    return rects;
  }

  function wrapScore(s, maxChars) {
    s = String(s || "");
    if (!s) return [];
    var lines = [];
    s.split("\n").forEach(function (raw) {
      if (raw === "") { lines.push(""); return; }
      var line = "";
      raw.split(/(\s+)/).forEach(function (tok) {
        if ((line + tok).length > maxChars && line) { lines.push(line.trimEnd()); line = ""; }
        line += tok;
      });
      lines.push(line.trimEnd());
    });
    return lines;
  }

  function drawInputCard(ctx, engine, ui) {
    card(ctx, L.cardX, L.inputY, L.cardW, L.inputH);
    text(ctx, "简谱输入", L.cardX + 14, L.inputY + 25, 15, C.goldLt, "left", "alphabetic", "600");
    pill(ctx, L.cardX + L.cardW - 86, L.inputY + 9, 74, 24, {});
    text(ctx, "语法说明", L.cardX + L.cardW - 49, L.inputY + 25, 12, C.textDim, "center");

    var a = inputAreaBox();
    ctx.fillStyle = C.areaBg;
    roundRect(ctx, a.x, a.y, a.w, a.h, 7); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();

    var lines = wrapScore(engine.scoreText, 46);
    // 裁剪到输入区：单个不折行长 token（超长粘贴）不会溢出到 chips
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x - 2, a.y - 2, a.w + 4, a.h + 4);
    ctx.clip();
    if (!lines.length || (lines.length === 1 && lines[0] === "")) {
      text(ctx, "在此输入简谱，如：1 1 5 5 | 6 6 5 -", a.x + 9, a.y + 22, 13, "#5c5668");
    } else {
      var maxLines = 3;
      var shown = lines.slice(0, maxLines);
      shown.forEach(function (ln, i) {
        text(ctx, ln, a.x + 9, a.y + 21 + i * 18, 13, C.text, "left", "alphabetic", "400");
      });
      if (lines.length > maxLines) {
        text(ctx, "… 共 " + lines.length + " 行", a.x + a.w - 8, a.y + a.h - 6, 10, C.textMut, "right");
      }
    }
    ctx.restore();
    if (ui.keyboard) {
      var blink = Math.floor(Date.now() / 600) % 2 === 0;
      if (blink) text(ctx, "▍", a.x + 9 + Math.min(46, (lines[lines.length - 1] || "").length) * 7.2, a.y + 21 + Math.min(2, lines.length - 1) * 18, 13, C.gold);
    }

    var rects = chipRects(engine);
    engine.songs.forEach(function (s, i) {
      var r = rects[i];
      var on = s.s === engine.scoreText;
      pill(ctx, r.x, r.y, r.w, r.h, { fill: on ? "rgba(232,179,101,0.22)" : "rgba(255,255,255,0.04)", stroke: on ? "rgba(232,179,101,0.55)" : "rgba(255,255,255,0.16)" });
      text(ctx, s.n, r.x + r.w / 2, r.y + r.h / 2 + 4.5, 12, on ? C.goldLt : C.textDim, "center", "alphabetic");
    });
  }

  /* ---------- 控制卡 ---------- */
  function drawControls(ctx, engine, ui) {
    card(ctx, L.cardX, L.ctlY, L.cardW, L.ctlH);
    var x0 = L.cardX + 14;
    var y1 = L.ctlY + 22;

    // 调号
    text(ctx, "调号", x0, y1, 13, C.textDim);
    var kv = engine.keyOpts[engine.keyIndex].label;
    pill(ctx, x0 + 34, y1 - 15, 76, 22, {});
    text(ctx, kv, x0 + 72, y1, 13, C.goldLt, "center", "alphabetic", "600");
    text(ctx, "▾", x0 + 100, y1, 10, C.textMut, "center");

    // 跟弹开关
    var swX = L.cardX + L.cardW - 118, swY = y1 - 15, swW = 44, swH = 22;
    var sx = swX, sy = swY;
    ctx.fillStyle = engine.guide ? C.gold : "rgba(255,255,255,0.14)";
    roundRect(ctx, sx, sy, swW, swH, swH / 2); ctx.fill();
    ctx.fillStyle = engine.guide ? C.ink : "#cfc8dc";
    ctx.beginPath();
    ctx.arc(sx + (engine.guide ? swW - swH / 2 - 2 : swH / 2 + 2), sy + swH / 2, 7.5, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, "跟弹模式", swX + 50, y1, 13, C.textDim);

    // 速度
    var y2 = L.ctlY + 52;
    text(ctx, "速度", x0, y2, 13, C.textDim);
    pill(ctx, x0 + 36, y2 - 13, 22, 20, {});
    text(ctx, "−", x0 + 47, y2, 14, C.goldLt, "center");
    text(ctx, String(engine.bpm), x0 + 82, y2, 13, C.goldLt, "center", "alphabetic", "600");
    // 滑杆轨道
    var tb = bpmTrackBox(), trX = tb.x, trW = tb.w, trY = y2 - 3;
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, trX, trY, trW, 6, 3); ctx.fill();
    var p = (engine.bpm - 40) / (200 - 40);
    var gg = ctx.createLinearGradient(trX, 0, trX + trW, 0);
    gg.addColorStop(0, C.gold); gg.addColorStop(1, C.goldLt);
    ctx.fillStyle = gg;
    roundRect(ctx, trX, trY, Math.max(6, trW * p), 6, 3); ctx.fill();
    ctx.fillStyle = C.goldLt;
    ctx.beginPath(); ctx.arc(trX + trW * p, trY + 3, 8, 0, Math.PI * 2); ctx.fill();
    pill(ctx, trX + trW + 10, y2 - 13, 22, 20, {});
    text(ctx, "＋", trX + trW + 21, y2, 13, C.goldLt, "center");

    // 播放 / 停止
    var y3 = L.ctlY + 80;
    var bw = (L.cardW - 14 * 2 - 12) / 2;
    var playing = engine.playing;
    pill(ctx, x0, y3 - 20, bw, 30, { gradient: true });
    ctx.save();
    if (playing) ctx.globalAlpha = 0.55;
    text(ctx, playing ? "♪ 演奏中" : "▶ 播放", x0 + bw / 2, y3, 14, C.ink, "center", "alphabetic", "700");
    ctx.restore();
    pill(ctx, x0 + bw + 12, y3 - 20, bw, 30, {});
    text(ctx, "■ 停止", x0 + bw + 12 + bw / 2, y3, 14, C.text, "center");
  }

  /* ---------- 音轨 ---------- */
  var TOK_W = 42, TOK_CHORD_W = 52, TOK_H = 64, TOK_GAP = 8;

  function tokenRects(engine) {
    var x = 0;
    return engine.tokensVM.map(function (tk) {
      var w = tk.kind === "chord" ? TOK_CHORD_W : TOK_W;
      // 增时线画在键格后的间隙里：每道「–」约 7px
      var gap = tk.extText ? 6 + tk.extText.length * 7 : TOK_GAP;
      var r = { x: x, w: w, h: TOK_H, gap: gap, tk: tk };
      x += w + gap;
      return r;
    });
  }

  function trackScroll(engine) {
    var rects = tokenRects(engine);
    var center = W / 2;
    var a = engine.curTok;
    if (a < 0 || a >= rects.length) return center - 198; // 未起：左侧留 44% 白
    return center - (rects[a].x + rects[a].w / 2);
  }

  function drawTrack(ctx, engine) {
    var cardY = L.stageY, cardH = L.stageH;
    var hudOn = engine.playing && engine.guide;
    var trackTop = cardY + (hudOn ? 46 : 14);
    var trackH = cardH - (hudOn ? 54 : 28);
    // 未开始播放过时音轨留空（对齐源小程序初始 tokens=[]）；播放后停止/曲终均保留显示
    if (!engine.trackShown) return;
    var scroll = trackScroll(engine);
    var rects = tokenRects(engine);

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.cardX, cardY, L.cardW, cardH);
    ctx.clip();

    rects.forEach(function (r, i) {
      var x = L.cardX + scroll + r.x;
      if (x + r.w < L.cardX - 10 || x > L.cardX + L.cardW + 10) return;
      var active = i === engine.curTok && engine.playing;
      var passed = engine.playing && i < engine.curTok;
      var y = trackTop + (trackH - TOK_H) / 2 + (active ? -4 : 0);
      var w = r.w, tk = r.tk;

      ctx.save();
      if (active) {
        ctx.shadowColor = "rgba(232,179,101,0.6)"; ctx.shadowBlur = 14;
        var g = ctx.createLinearGradient(0, y, 0, y + TOK_H);
        g.addColorStop(0, "#f6dda8"); g.addColorStop(1, "#e8b365");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        if (passed) ctx.globalAlpha = 0.38;
      }
      roundRect(ctx, x, y, w, TOK_H, 7);
      ctx.fill();
      if (!active) { ctx.strokeStyle = C.lineSoft; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();

      var mainCol = active ? C.ink : C.text;
      var mutCol = active ? "rgba(36,24,4,0.75)" : C.textMut;
      var cx = x + w / 2;

      if (tk.kind === "rest") {
        text(ctx, "0", cx, y + 40, 26, active ? C.ink : C.textMut, "center", "alphabetic", "400", passed ? 0.38 : 1);
      } else if (tk.kind === "chord") {
        text(ctx, "[", cx - 13, y + 40, 19, mutCol, "center");
        text(ctx, tk.digs, cx, y + 40, 18, mainCol, "center", "alphabetic", "600");
        text(ctx, "]", cx + 13, y + 40, 19, mutCol, "center");
      } else {
        if (tk.upText) text(ctx, tk.upText, cx, y + 15, 10, active ? "rgba(120,40,60,0.9)" : C.pink, "center");
        text(ctx, tk.dig, cx, y + 41, 27, mainCol, "center", "alphabetic", "500");
        if (tk.acc) text(ctx, tk.acc, cx + 11, y + 26, 11, active ? C.ink : C.gold, "center");
        if (tk.dnText) text(ctx, tk.dnText, cx, y + 56, 10, active ? "rgba(20,60,110,0.85)" : C.blue, "center");
      }
      if (tk.extText) text(ctx, tk.extText, x + w + r.gap / 2, y + 38, 11, active ? "rgba(36,24,4,0.7)" : C.textMut, "center");
    });
    ctx.restore();
  }

  function drawHud(ctx, engine, ui, now) {
    if (!(engine.playing && engine.guide)) return;
    var y = L.stageY + 23;
    var cx0 = L.cardX + 24, cy = y, Rr = 21;
    var tCls = engine.target.cls || "target";
    var soon = /soon/.test(tCls), low = /low/.test(tCls), high = /high/.test(tCls);
    var ring = low ? "rgba(124,196,255,0.7)" : high ? "rgba(255,143,163,0.7)" : "rgba(232,179,101,0.7)";
    var digCol = low ? C.blue : high ? C.pink : C.goldLt;
    ctx.save();
    if (soon) { ctx.shadowColor = ring; ctx.shadowBlur = 14; }
    ctx.strokeStyle = ring; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx0, cy, Rr, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    text(ctx, engine.target.dig, cx0, cy + 9, 24, digCol, "center", "alphabetic", "500");

    // verdict 飘字
    if (ui.verdict && ui.verdict.text && now - ui.verdict.t < 0.8) {
      var age = now - ui.verdict.t;
      ctx.save();
      ctx.globalAlpha = age < 0.15 ? age / 0.15 : Math.max(0, 1 - (age - 0.15) / 0.65);
      text(ctx, ui.verdict.text, cx0, cy - Rr - 8 - age * 18, 11, C.goldLt, "center", "alphabetic", "700");
      ctx.restore();
    }

    text(ctx, "连击 ", L.cardX + 60, y - 4, 12, C.textDim);
    text(ctx, String(engine.combo), L.cardX + 86, y - 4, 12, C.goldLt, "left", "alphabetic", "600");
    text(ctx, "命中率 ", L.cardX + 126, y - 4, 12, C.textDim);
    text(ctx, engine.accText, L.cardX + 172, y - 4, 12, C.goldLt, "left", "alphabetic", "600");

    // 进度条
    var pbX = L.cardX + 216, pbW = L.cardX + L.cardW - 14 - pbX, pbY = y - 8;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, pbX, pbY, pbW, 5, 2.5); ctx.fill();
    var g2 = ctx.createLinearGradient(pbX, 0, pbX + pbW, 0);
    g2.addColorStop(0, C.gold); g2.addColorStop(1, C.goldLt);
    ctx.fillStyle = g2;
    roundRect(ctx, pbX, pbY, Math.max(0, pbW * engine.progress / 100), 5, 2.5); ctx.fill();
  }

  function drawStage(ctx, engine, ui, now) {
    card(ctx, L.cardX, L.stageY, L.cardW, L.stageH);
    drawTrack(ctx, engine);
    drawHud(ctx, engine, ui, now);
  }

  /* ---------- 数字垫 ---------- */
  function padRects() {
    var octW = 42, gap = 9;
    var padsX = L.cardX + octW + gap;
    var padsW = L.cardW - octW - gap;
    var pgap = 5;
    var pw = (padsW - pgap * 6) / 7;
    var rects = [];
    for (var i = 0; i < 7; i++) {
      rects.push({ x: padsX + i * (pw + pgap), y: L.padY, w: pw, h: L.padH, deg: i + 1 });
    }
    return rects;
  }

  function drawPads(ctx, engine, ui) {
    // 八度控制
    var ox = L.cardX;
    pill(ctx, ox, L.padY, 42, 20, {});
    text(ctx, "−", ox + 21, L.padY + 14, 15, C.goldLt, "center");
    text(ctx, engine.octNames[engine.liveOct + 2], ox + 21, L.padY + 36, 10, C.textDim, "center");
    pill(ctx, ox, L.padY + 40, 42, 20, {});
    text(ctx, "＋", ox + 21, L.padY + 54, 14, C.goldLt, "center");

    padRects().forEach(function (r) {
      var flash = ui.pads && ui.pads[r.deg];
      var g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      if (flash) { g.addColorStop(0, "#fff1d4"); g.addColorStop(1, "#e8b365"); }
      else { g.addColorStop(0, "#fbf8f1"); g.addColorStop(1, "#e4ddcd"); }
      ctx.fillStyle = g;
      roundRect(ctx, r.x, r.y, r.w, r.h, 8); ctx.fill();
      text(ctx, String(r.deg), r.x + r.w / 2, r.y + 26, 19, "#2a2433", "center", "alphabetic", "700");
      text(ctx, SOL[r.deg - 1], r.x + r.w / 2, r.y + 44, 8, "#8a8295", "center");
    });
  }

  /* ---------- 钢琴 ---------- */
  function whiteRect(wi) {
    var ww = L.pianoW / 35;
    return { x: L.pianoX + wi * ww, y: L.pianoY, w: ww, h: L.pianoH, wi: wi };
  }
  function blackRect(leftWi) {
    var ww = L.pianoW / 35;
    return { x: L.pianoX + (leftWi + 1) * ww - 4.2, y: L.pianoY, w: 8.4, h: L.pianoH * 0.6, leftWi: leftWi };
  }

  function litOf(engine, midi) {
    return engine.lit[midi] || null;
  }

  function drawPiano(ctx, engine, ui) {
    ctx.save();
    roundRect(ctx, L.pianoX, L.pianoY, L.pianoW, L.pianoH, 8);
    ctx.clip();
    ctx.fillStyle = C.black1;
    ctx.fillRect(L.pianoX, L.pianoY, L.pianoW, L.pianoH);

    // 白键
    engine.kb.whites.forEach(function (k) {
      var r = whiteRect(k.wi);
      var lit = litOf(engine, k.midi);
      var g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      if (lit) { g.addColorStop(0, LIT[lit].w0); g.addColorStop(1, LIT[lit].w1); }
      else { g.addColorStop(0, C.white0); g.addColorStop(0.78, C.white1); g.addColorStop(1, C.white2); }
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w + 0.6, r.h);
      ctx.strokeStyle = C.whiteEdge; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();
      if (lit) {
        ctx.save(); ctx.shadowColor = LIT[lit].glow; ctx.shadowBlur = 10;
        ctx.fillStyle = LIT[lit].glow; ctx.globalAlpha = 0.35;
        ctx.fillRect(r.x, r.y, r.w, 6); ctx.restore();
      }
      if (k.label) text(ctx, k.label, r.x + r.w / 2, r.y + r.h - 6, 7.5, "#a89f8c", "center");
    });

    // 黑键
    engine.kb.blacks.forEach(function (k) {
      var r = blackRect(k.leftWi);
      var lit = litOf(engine, k.midi);
      var g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      if (lit) { g.addColorStop(0, LIT[lit].b0); g.addColorStop(1, LIT[lit].b1); }
      else { g.addColorStop(0, C.black0); g.addColorStop(0.7, C.black1); g.addColorStop(1, C.black2); }
      ctx.save();
      if (lit) { ctx.shadowColor = LIT[lit].glow; ctx.shadowBlur = 10; }
      ctx.fillStyle = g;
      roundRect(ctx, r.x, r.y, r.w, r.h, 4); ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1;
    roundRect(ctx, L.pianoX, L.pianoY, L.pianoW, L.pianoH, 8); ctx.stroke();
  }

  /* ---------- 脚注 ---------- */
  function drawFoot(ctx) {
    text(ctx, "点琴键或数字键弹奏；蓝=低音 · 金=中音 · 粉=高音。", W / 2, L.footY, 10, C.textMut, "center");
    var y = L.footY + 16;
    text(ctx, "高低音点：逗号 ", W / 2 - 58, y, 10, C.textMut, "center");
    text(ctx, "5,", W / 2 + 2, y, 10, C.blue, "center", "alphabetic", "400");
    text(ctx, " 低音、撇 ", W / 2 + 30, y, 10, C.textMut, "center");
    text(ctx, "1'", W / 2 + 72, y, 10, C.pink, "center");
    text(ctx, " 高音", W / 2 + 94, y, 10, C.textMut, "center");
  }

  /* ---------- 弹层 ---------- */
  function dim(ctx) {
    ctx.fillStyle = "rgba(10,9,16,0.85)";
    ctx.fillRect(0, 0, W, H);
  }

  function overlayBox(ctx, x, y, w, h) {
    ctx.fillStyle = C.bg0;
    roundRect(ctx, x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = "rgba(232,179,101,0.35)"; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawResult(ctx, engine, ui) {
    if (!engine.result || ui.help) return;
    dim(ctx);
    var bw = 320, bh = 218, x = (W - bw) / 2, y = (H - bh) / 2 - 30;
    overlayBox(ctx, x, y, bw, bh);
    text(ctx, "演 奏 结 束", x + bw / 2, y + 44, 19, C.goldLt, "center", "alphabetic", "600");
    text(ctx, engine.result.rate + "%", x + bw / 2, y + 112, 48, C.gold, "center", "alphabetic", "700");
    text(ctx, "命中 " + engine.result.hits + " / " + engine.result.total + " 个音符 · 最大连击 " + engine.result.maxCombo,
      x + bw / 2, y + 142, 13, C.textDim, "center");
    var btnW = (bw - 40 - 14) / 2, btnY = y + bh - 50;
    pill(ctx, x + 20, btnY, btnW, 34, { gradient: true });
    text(ctx, "再来一次", x + 20 + btnW / 2, btnY + 22, 14, C.ink, "center", "alphabetic", "700");
    pill(ctx, x + 20 + btnW + 14, btnY, btnW, 34, {});
    text(ctx, "关闭", x + 20 + btnW + 14 + btnW / 2, btnY + 22, 14, C.text, "center");
  }

  function drawHelp(ctx) {
    dim(ctx);
    var x = 24, w = W - 48, y = 64, h = 620;
    overlayBox(ctx, x, y, w, h);
    text(ctx, "简谱语法", x + 18, y + 32, 16, C.goldLt, "left", "alphabetic", "600");
    pill(ctx, x + w - 86, y + 14, 68, 24, {});
    text(ctx, "关闭", x + w - 52, y + 30, 12, C.textDim, "center");

    var ry = y + 58;
    HELP_ROWS.forEach(function (row) {
      ctx.strokeStyle = C.lineSoft; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 16, ry + 20); ctx.lineTo(x + w - 16, ry + 20); ctx.stroke();
      text(ctx, row[0], x + 18, ry + 15, 13, C.goldLt, "left", "alphabetic", "400");
      text(ctx, row[1], x + 128, ry + 15, 12.5, C.textDim);
      ry += 34;
    });
    var tipY = ry + 12;
    ctx.fillStyle = "rgba(124,196,255,0.08)";
    roundRect(ctx, x + 16, tipY, w - 32, 86, 8); ctx.fill();
    ctx.strokeStyle = "rgba(124,196,255,0.2)"; ctx.lineWidth = 1; ctx.stroke();
    var tipLines = [
      "支持全角数字与符号。跟弹模式下，在圆圈亮起的 ±0.3 秒内",
      "点对应数字键即可得分，蓝=低音、粉=高音（只需点数字，",
      "八度自动宽容）。"
    ];
    tipLines.forEach(function (ln, i) { text(ctx, ln, x + 28, tipY + 22 + i * 21, 11.5, "#cfe4ff"); });
  }

  /* ---------- 主绘制 ---------- */
  function draw(ctx, engine, ui, now) {
    ui = ui || {};
    now = now || 0;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg0); g.addColorStop(1, C.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawHeader(ctx);
    drawInputCard(ctx, engine, ui);
    drawControls(ctx, engine, ui);
    drawStage(ctx, engine, ui, now);
    drawPads(ctx, engine, ui);
    drawPiano(ctx, engine, ui);
    drawFoot(ctx);

    if (engine.result) drawResult(ctx, engine, ui);
    if (ui.help) drawHelp(ctx);
  }

  /* ---------- 命中几何 ---------- */
  function inRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // 返回区域 id：help / score / chip:i / keyCtl / guide / bpmTrack / bpm- / bpm+ /
  // play / stop / oct- / oct+ / pad:d / w:midi / b:midi / resultReplay / resultClose / helpClose
  function hitTest(x, y, engine, ui) {
    if (ui.help) {
      var hx = 24, hw = W - 48, hy = 64, hh = 620;
      if (inRect(x, y, { x: hx + hw - 86, y: hy + 14, w: 68, h: 24 })) return "helpClose";
      return inRect(x, y, { x: hx, y: hy, w: hw, h: hh }) ? "helpNone" : "helpClose";
    }
    if (engine.result) {
      var bw = 320, bx = (W - bw) / 2, by = (H - 218) / 2 - 30, btnY = by + 218 - 50, btnW2 = (bw - 40 - 14) / 2;
      if (inRect(x, y, { x: bx + 20, y: btnY, w: btnW2, h: 34 })) return "resultReplay";
      if (inRect(x, y, { x: bx + 20 + btnW2 + 14, y: btnY, w: btnW2, h: 34 })) return "resultClose";
      return "resultNone";
    }

    // 输入卡
    if (inRect(x, y, { x: L.cardX + L.cardW - 86, y: L.inputY + 9, w: 74, h: 24 })) return "help";
    if (inRect(x, y, inputAreaBox())) return "score";
    var cr = chipRects(engine);
    for (var i = 0; i < cr.length; i++) if (inRect(x, y, cr[i])) return "chip:" + i;

    // 控制卡
    if (inRect(x, y, { x: L.cardX + 14 + 34, y: L.ctlY + 7, w: 76, h: 22 })) return "keyCtl";
    if (inRect(x, y, { x: L.cardX + L.cardW - 118, y: L.ctlY + 7, w: 96, h: 24 })) return "guide";
    var x0 = L.cardX + 14, y2 = L.ctlY + 52;
    if (inRect(x, y, { x: x0 + 36, y: y2 - 13, w: 22, h: 20 })) return "bpm-";
    var tb = bpmTrackBox();
    if (inRect(x, y, { x: tb.x, y: y2 - 11, w: tb.w, h: 16 })) return "bpmTrack";
    if (inRect(x, y, { x: tb.x + tb.w + 10, y: y2 - 13, w: 22, h: 20 })) return "bpm+";
    var y3 = L.ctlY + 80, bw0 = (L.cardW - 14 * 2 - 12) / 2;
    if (inRect(x, y, { x: x0, y: y3 - 20, w: bw0, h: 30 })) return "play";
    if (inRect(x, y, { x: x0 + bw0 + 12, y: y3 - 20, w: bw0, h: 30 })) return "stop";

    // 数字垫
    if (inRect(x, y, { x: L.cardX, y: L.padY, w: 42, h: 20 })) return "oct-";
    if (inRect(x, y, { x: L.cardX, y: L.padY + 40, w: 42, h: 20 })) return "oct+";
    var pr = padRects();
    for (var p = 0; p < pr.length; p++) {
      if (inRect(x, y, pr[p])) return "pad:" + pr[p].deg;
    }

    // 钢琴：黑键优先，但命中严格用视觉矩形（不外扩）——
    // 白键仅 12.2px 宽，外扩会使 D/G/A 白键上半段（含顶部光晕处）永远点不到，与源 DOM 精确命中不一致。
    for (var bi = engine.kb.blacks.length - 1; bi >= 0; bi--) {
      var br = blackRect(engine.kb.blacks[bi].leftWi);
      if (inRect(x, y, br)) return "b:" + engine.kb.blacks[bi].midi;
    }
    for (var wi = 0; wi < engine.kb.whites.length; wi++) {
      var wr = whiteRect(wi);
      if (inRect(x, y, wr)) return "w:" + engine.kb.whites[wi].midi;
    }
    return null;
  }

  // 滑杆命中 → bpm
  function bpmFromX(x) {
    var tb = bpmTrackBox();
    var p = Math.max(0, Math.min(1, (x - tb.x) / tb.w));
    return Math.round(40 + p * 160);
  }

  return {
    W: W, H: H, L: L, C: C, SOL: SOL,
    draw: draw, hitTest: hitTest, bpmFromX: bpmFromX,
    whiteRect: whiteRect, blackRect: blackRect, padRects: padRects,
    wrapScore: wrapScore
  };
});
