/*
 * parser.js — 简谱解析器（与小程序版/网页版同源逻辑，UMD）
 * 输出 token：{type:'note'|'rest', deg, oct, acc, beats} / {type:'chord', notes:[...], beats}
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JianpuParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ROOT_MIDI = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 69, B: 71, bB: 70, bE: 63 };
  var DEG_OFF = [null, 0, 2, 4, 5, 7, 9, 11];
  var MODS = { "'": 1, ",": 1, "-": 1, _: 1, ".": 1, "#": 1, b: 1 };

  // 全角 → 半角
  var FW = {
    "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7",
    "－": "-", "—": "-", "．": ".", "。": ".", "，": ",", "‘": "'", "’": "'",
    "｜": "|", "│": "|", "＃": "#", "♯": "#", "♭": "b", "ｂ": "b", "＿": "_",
    "：": ":", "（": "(", "）": ")"
  };

  function applyMod(t, c) {
    if (c === "'" || c === ",") {
      var d = c === "'" ? 1 : -1;
      if (t.type === "chord") t.notes.forEach(function (n) { n.oct += d; });
      else t.oct += d;
    } else if (c === "-") {
      t.beats += 1;
    } else if (c === "_") {
      t.beats /= 2;
    } else if (c === ".") {
      t.beats *= 1.5;
    } else if (c === "#" || c === "b") {
      var ad = c === "#" ? 1 : -1;
      if (t.type === "chord") t.notes.forEach(function (n) { n.acc += ad; });
      else t.acc += ad;
    }
  }

  function makeNote(deg, pendingAcc) {
    return { type: deg === 0 ? "rest" : "note", deg: deg, oct: 0, acc: pendingAcc, beats: 1 };
  }

  function parseScore(text) {
    var s = Array.prototype.map.call(text, function (c) { return FW[c] || c; }).join("");
    var toks = [];
    var i = 0, pendingAcc = 0;
    while (i < s.length) {
      var c = s[i];
      if (c >= "0" && c <= "7") {
        var t = makeNote(+c, pendingAcc);
        pendingAcc = 0;
        toks.push(t); i++;
        while (i < s.length && MODS[s[i]]) applyMod(t, s[i++]);
        continue;
      }
      if (c === "[") {
        var chord = { type: "chord", notes: [], beats: 1 };
        i++;
        while (i < s.length && s[i] !== "]") {
          var cc = s[i];
          if (cc >= "0" && cc <= "7") {
            var n = makeNote(+cc, pendingAcc);
            pendingAcc = 0;
            chord.notes.push(n); i++;
            while (i < s.length && s[i] !== "]" && MODS[s[i]]) applyMod(n, s[i++]);
            continue;
          }
          if (cc === "#" || cc === "b") { pendingAcc = cc === "#" ? 1 : -1; i++; continue; }
          i++;
        }
        if (s[i] === "]") i++;
        var maxBeats = 1;
        chord.notes.forEach(function (nn) { maxBeats = Math.max(maxBeats, nn.beats); });
        chord.beats = maxBeats;
        toks.push(chord);
        while (i < s.length && MODS.hasOwnProperty(s[i])) applyMod(chord, s[i++]);
        continue;
      }
      if (MODS.hasOwnProperty(c) && toks.length) {
        applyMod(toks[toks.length - 1], c); pendingAcc = 0; i++; continue;
      }
      if (c === "#" || c === "b") { pendingAcc = c === "#" ? 1 : -1; i++; continue; }
      i++;
    }
    return toks;
  }

  function expand(t) { return t.type === "chord" ? t.notes : [t]; }
  function midiOf(rootMidi, n) { return rootMidi + DEG_OFF[n.deg] + n.oct * 12 + n.acc; }
  function hasNotes(toks) {
    return toks.some(function (t) {
      return expand(t).some(function (n) { return n.type === "note"; });
    });
  }

  return {
    ROOT_MIDI: ROOT_MIDI,
    DEG_OFF: DEG_OFF,
    parseScore: parseScore,
    expand: expand,
    midiOf: midiOf,
    hasNotes: hasNotes
  };
});
