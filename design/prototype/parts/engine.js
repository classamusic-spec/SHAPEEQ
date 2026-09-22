/* ==================================================================
   SHAPE — engine
   Filter design, state, analyser model, interaction and the frame loop.
   Drawing lives in canvas.js; controls in knobs.html.

   The response curve is computed, never drawn: real RBJ-cookbook biquad
   sections, cascaded per band, evaluated as 20*log10|H(e^jw)| at every
   pixel column.
   ================================================================== */
"use strict";

var FS = 48000;
var NYQ = FS / 2;
var FMIN = 10, FMAX = 30000;
var LOG_MIN = Math.log(FMIN), LOG_SPAN = Math.log(FMAX) - LOG_MIN;
var GAIN_RANGE = 24;          /* left axis, ±24 dB — as the reference draws it */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function fToNorm(f) { return (Math.log(clamp(f, FMIN, FMAX)) - LOG_MIN) / LOG_SPAN; }
function normToF(t) { return Math.exp(LOG_MIN + t * LOG_SPAN); }

/* ---------- filter catalogue ---------------------------------- */
var TYPES = {
  bell:      { label: "Bell",       gain: true,  q: true,  slope: false },
  lowshelf:  { label: "Low Shelf",  gain: true,  q: true,  slope: false },
  highshelf: { label: "High Shelf", gain: true,  q: true,  slope: false },
  tilt:      { label: "Tilt Shelf", gain: true,  q: true,  slope: false },
  lowcut:    { label: "Low Cut",    gain: false, q: false, slope: true  },
  highcut:   { label: "High Cut",   gain: false, q: false, slope: true  },
  notch:     { label: "Notch",      gain: false, q: true,  slope: false },
  bandpass:  { label: "Band Pass",  gain: false, q: true,  slope: false }
};

/* ---------- biquad design (RBJ Audio EQ Cookbook) -------------- */
function butterworthQs(order) {
  var qs = [];
  for (var k = 0; k < Math.floor(order / 2); k++) {
    qs.push(1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order))));
  }
  return qs;
}
function sec(b0, b1, b2, a0, a1, a2) {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function peaking(f0, g, Q) {
  var A = Math.pow(10, g / 40);
  var w = 2 * Math.PI * f0 / FS, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
  return sec(1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A);
}
function lowShelf(f0, g, Q) {
  var A = Math.pow(10, g / 40), sA = Math.sqrt(A);
  var w = 2 * Math.PI * f0 / FS, cw = Math.cos(w), al = Math.sin(w) / (2 * Q), t = 2 * sA * al;
  return sec(A * ((A + 1) - (A - 1) * cw + t),
             2 * A * ((A - 1) - (A + 1) * cw),
             A * ((A + 1) - (A - 1) * cw - t),
             (A + 1) + (A - 1) * cw + t,
             -2 * ((A - 1) + (A + 1) * cw),
             (A + 1) + (A - 1) * cw - t);
}
function highShelf(f0, g, Q) {
  var A = Math.pow(10, g / 40), sA = Math.sqrt(A);
  var w = 2 * Math.PI * f0 / FS, cw = Math.cos(w), al = Math.sin(w) / (2 * Q), t = 2 * sA * al;
  return sec(A * ((A + 1) + (A - 1) * cw + t),
             -2 * A * ((A - 1) + (A + 1) * cw),
             A * ((A + 1) + (A - 1) * cw - t),
             (A + 1) - (A - 1) * cw + t,
             2 * ((A - 1) - (A + 1) * cw),
             (A + 1) - (A - 1) * cw - t);
}
function highPass2(f0, Q) {
  var w = 2 * Math.PI * f0 / FS, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
  return sec((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al);
}
function lowPass2(f0, Q) {
  var w = 2 * Math.PI * f0 / FS, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
  return sec((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al);
}
function highPass1(f0) {
  var K = Math.tan(Math.PI * f0 / FS), n = 1 / (1 + K);
  return { b0: n, b1: -n, b2: 0, a1: (K - 1) * n, a2: 0 };
}
function lowPass1(f0) {
  var K = Math.tan(Math.PI * f0 / FS), n = 1 / (1 + K);
  return { b0: K * n, b1: K * n, b2: 0, a1: (K - 1) * n, a2: 0 };
}
function notchSec(f0, Q) {
  var w = 2 * Math.PI * f0 / FS, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
  return sec(1, -2 * cw, 1, 1 + al, -2 * cw, 1 - al);
}
function bandPassSec(f0, Q) {
  var w = 2 * Math.PI * f0 / FS, cw = Math.cos(w), al = Math.sin(w) / (2 * Q);
  return sec(al, 0, -al, 1 + al, -2 * cw, 1 - al);
}

function designBand(band, gainDb) {
  var f0 = clamp(band.freq, FMIN, NYQ * 0.995);
  var Q = clamp(band.q, 0.1, 100);
  switch (band.type) {
    case "bell":      return [peaking(f0, gainDb, Q)];
    case "lowshelf":  return [lowShelf(f0, gainDb, Q)];
    case "highshelf": return [highShelf(f0, gainDb, Q)];
    case "tilt":      return [lowShelf(f0, -gainDb, Q), highShelf(f0, gainDb, Q)];
    case "notch":     return [notchSec(f0, Q)];
    case "bandpass":  return [bandPassSec(f0, Q)];
    case "lowcut":
    case "highcut": {
      var order = Math.max(1, Math.round(band.slope / 6));
      var out = [], qs = butterworthQs(order), i;
      if (order % 2 === 1) out.push(band.type === "lowcut" ? highPass1(f0) : lowPass1(f0));
      for (i = 0; i < qs.length; i++) {
        out.push(band.type === "lowcut" ? highPass2(f0, qs[i]) : lowPass2(f0, qs[i]));
      }
      return out;
    }
    default: return [];
  }
}
function cascadeDb(sections, c1, s1, c2, s2) {
  var db = 0;
  for (var i = 0; i < sections.length; i++) {
    var s = sections[i];
    var nr = s.b0 + s.b1 * c1 + s.b2 * c2, ni = -(s.b1 * s1 + s.b2 * s2);
    var dr = 1 + s.a1 * c1 + s.a2 * c2, di = -(s.a1 * s1 + s.a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-30);
  }
  return db;
}

/* ---------- state --------------------------------------------- */
function mkBand(type, freq, gain, q, extra) {
  var b = {
    type: type, freq: freq, gain: gain, q: q, slope: 12, on: true,
    dyn: { on: false, range: -6, threshold: -24, attack: 10, release: 120, cur: 0 }
  };
  if (extra) for (var k in extra) b[k] = extra[k];
  return b;
}

var PRESETS = [
  { name: "Master Clean", tag: "PRECISION · MUSICAL · NATURAL", bands: [
    mkBand("lowcut", 36, 0, 0.71, { slope: 12 }),
    mkBand("bell", 104, 6.4, 0.9),
    mkBand("bell", 512, -4.8, 2.4, { dyn: { on: true, range: -6, threshold: -24, attack: 10, release: 120, cur: 0 } }),
    mkBand("bell", 3800, 6.2, 0.85),
    mkBand("bell", 15000, 4.4, 0.8)
  ]},
  { name: "Vocal Presence", tag: "FORWARD · CLEAR · INTIMATE", bands: [
    mkBand("lowcut", 92, 0, 0.71, { slope: 24 }),
    mkBand("bell", 268, -3.4, 1.6),
    mkBand("bell", 2900, 4.6, 1.1),
    mkBand("bell", 6400, -4.2, 5.5, { dyn: { on: true, range: -5, threshold: -22, attack: 3, release: 80, cur: 0 } }),
    mkBand("highshelf", 10500, 3.8, 0.7)
  ]},
  { name: "Drum Punch", tag: "TIGHT · PUNCHY · OPEN", bands: [
    mkBand("lowcut", 28, 0, 0.71, { slope: 18 }),
    mkBand("bell", 68, 5.6, 1.3),
    mkBand("bell", 420, -5.0, 1.8),
    mkBand("bell", 3400, 4.2, 1.0),
    mkBand("highshelf", 9000, 3.4, 0.7)
  ]},
  { name: "Bass Control", tag: "DEEP · CONTROLLED · SOLID", bands: [
    mkBand("lowcut", 30, 0, 0.71, { slope: 36 }),
    mkBand("bell", 82, 4.0, 1.1),
    mkBand("bell", 180, -5.5, 2.2, { dyn: { on: true, range: -8, threshold: -20, attack: 14, release: 180, cur: 0 } }),
    mkBand("bell", 900, 2.6, 1.4),
    mkBand("highcut", 12000, 0, 0.71, { slope: 12 })
  ]},
  { name: "Air Lift", tag: "SILKY · OPEN · TALL", bands: [
    mkBand("bell", 340, -2.4, 1.4),
    mkBand("highshelf", 7800, 4.4, 0.6),
    mkBand("bell", 15500, 3.8, 0.9)
  ]},
  { name: "Surgical Repair", tag: "NARROW · SURGICAL · EXACT", bands: [
    mkBand("notch", 60, 0, 30),
    mkBand("notch", 180, 0, 30),
    mkBand("bell", 3150, -8.5, 12),
    mkBand("highshelf", 11000, 2.4, 0.7)
  ]}
];

var ST = {
  presetIndex: 0,
  bands: JSON.parse(JSON.stringify(PRESETS[0].bands)),
  selected: 2,
  slot: "A",
  analyzerOn: true,
  analyzerMode: "pre",          /* pre | post | both */
  tab: "eq",                    /* eq | dynamic | spectral */
  phase: "zero",
  fineScale: 12,                /* right-hand ruler range, matches SCALE control */
  mode: "clean",
  input: 0,
  output: 0,
  solo: false,
  power: true,
  sidechain: false,
  bypass: false
};
function cur() { return ST; }
function selBand() { return ST.bands[ST.selected]; }

/* ---------- undo / redo (gestures grouped) --------------------- */
var History = {
  past: [], future: [],
  snap: function () { return JSON.stringify(ST); },
  restore: function (s) {
    var o = JSON.parse(s);
    for (var k in o) ST[k] = o[k];
  },
  push: function (prev) {
    this.past.push(prev);
    if (this.past.length > 120) this.past.shift();
    this.future.length = 0;
  },
  undo: function () {
    if (!this.past.length) return;
    var now = this.snap(); this.restore(this.past.pop()); this.future.push(now); syncAll();
  },
  redo: function () {
    if (!this.future.length) return;
    var now = this.snap(); this.restore(this.future.pop()); this.past.push(now); syncAll();
  }
};
var gestureSnap = null;
function beginGesture() { if (gestureSnap === null) gestureSnap = History.snap(); }
function endGesture() {
  if (gestureSnap !== null && gestureSnap !== History.snap()) History.push(gestureSnap);
  gestureSnap = null;
}
function commit(fn) {
  var before = History.snap(); fn();
  if (before !== History.snap()) History.push(before);
}

/* ---------- analyser model ------------------------------------- */
var NBINS = 420;
var binF = new Float64Array(NBINS);
var binT = new Float64Array(NBINS);
for (var _i = 0; _i < NBINS; _i++) {
  binT[_i] = _i / (NBINS - 1);
  binF[_i] = normToF(binT[_i]);
}
var specRaw = new Float64Array(NBINS);
var specDisp = new Float64Array(NBINS);
var specPeak = new Float64Array(NBINS);
var texture = new Float64Array(NBINS);
for (var _j = 0; _j < NBINS; _j++) { specDisp[_j] = -90; specPeak[_j] = -120; }

var T = 0;
function updateSpectrum(dt) {
  T += dt;
  var bassF = 58 * Math.pow(2, 0.42 * Math.sin(T * 0.27) + 0.22 * Math.sin(T * 0.63));
  var midEnv = 0.62 + 0.38 * Math.sin(T * 0.41 + 1.2);
  var hfEnv = 0.55 + 0.45 * Math.sin(T * 0.53 + 2.6);
  var snare = Math.pow(Math.max(0, Math.sin(T * 2.1)), 6);
  var i, f, v, amp;

  for (i = 0; i < NBINS; i++) {
    f = binF[i];
    v = -13 - 11.5 * Math.log10(Math.max(f, 20) / 42);
    v += 17 * Math.exp(-Math.pow(Math.log(f / bassF) / Math.LN2 / 0.5, 2));
    v += 10 * Math.exp(-Math.pow(Math.log(f / (bassF * 2)) / Math.LN2 / 0.45, 2));
    v += 6 * Math.exp(-Math.pow(Math.log(f / (bassF * 3)) / Math.LN2 / 0.42, 2));
    v += 8 * midEnv * Math.exp(-Math.pow(Math.log(f / 620) / Math.LN2 / 1.15, 2));
    v += 7 * hfEnv * Math.exp(-Math.pow(Math.log(f / 3600) / Math.LN2 / 1.05, 2));
    v += 9 * snare * Math.exp(-Math.pow(Math.log(f / 1900) / Math.LN2 / 1.4, 2));
    amp = 2.4 + 3.6 * Math.min(1, f / 2500);
    texture[i] += ((Math.random() * 2 - 1) * amp - texture[i]) * 0.34;
    specRaw[i] = v + texture[i];
  }
  for (i = 1; i < NBINS - 1; i++) {
    specRaw[i] = specRaw[i] * 0.5 + specRaw[i - 1] * 0.25 + specRaw[i + 1] * 0.25;
  }
  for (i = 0; i < NBINS; i++) {
    var t = specRaw[i];
    specDisp[i] += (t - specDisp[i]) * (t > specDisp[i] ? 0.52 : 0.045);
    specPeak[i] = Math.max(specPeak[i] - 26 * dt, specDisp[i]);
  }
}

function detectorLevel(band) {
  var bw = (band.type === "bell" || band.type === "notch" || band.type === "bandpass")
    ? clamp(1 / Math.max(band.q, 0.2), 0.12, 2.2) : 1.0;
  var sum = 0, wsum = 0;
  for (var i = 0; i < NBINS; i++) {
    var oct = Math.log(binF[i] / band.freq) / Math.LN2;
    var w = Math.exp(-Math.pow(oct / bw, 2));
    if (w < 0.02) continue;
    sum += Math.pow(10, specDisp[i] / 10) * w;
    wsum += w;
  }
  return 10 * Math.log10(sum / Math.max(wsum, 1e-9) + 1e-12);
}
function updateDynamics(dt) {
  for (var i = 0; i < ST.bands.length; i++) {
    var b = ST.bands[i];
    if (!b.dyn.on || !b.on || ST.bypass) { b.dyn.cur *= 0.85; continue; }
    var over = detectorLevel(b) - b.dyn.threshold;
    var amount = over > 0 ? clamp(over / 2.5 / Math.max(Math.abs(b.dyn.range), 0.001), 0, 1) : 0;
    var target = b.dyn.range * amount;
    var moving = Math.abs(target) > Math.abs(b.dyn.cur);
    var tau = (moving ? b.dyn.attack : b.dyn.release) / 1000;
    b.dyn.cur += (target - b.dyn.cur) * clamp(1 - Math.exp(-dt / Math.max(tau, 0.0005)), 0, 1);
  }
}

/* ---------- canvas geometry ------------------------------------ */
var cv, ctx, CW = 0, CH = 0, DPR = 1;
var PAD = { l: 46, r: 46, t: 52, b: 26 };   /* t clears the floating toolbar */
function plot() {
  return { x: PAD.l, y: PAD.t, w: Math.max(10, CW - PAD.l - PAD.r), h: Math.max(10, CH - PAD.t - PAD.b) };
}
function xOfF(f) { var p = plot(); return p.x + fToNorm(f) * p.w; }
function fOfX(x) { var p = plot(); return normToF(clamp((x - p.x) / p.w, 0, 1)); }
function yOfDb(db) { var p = plot(); return p.y + p.h * (GAIN_RANGE - db) / (2 * GAIN_RANGE); }
function dbOfY(y) { var p = plot(); return GAIN_RANGE - ((y - p.y) / p.h) * 2 * GAIN_RANGE; }
/* right-hand fine ruler: the SCALE control picks its range, and it is a
   gain ruler, not a level meter — exactly as the reference draws it */
function yOfFs(v) { return yOfDb(v * (GAIN_RANGE / ST.fineScale)); }
/* analyser magnitudes get their own mapping across the plot */
var A_TOP = 26, A_BOT = -74;
function yOfLevel(dbfs) { var p = plot(); return p.y + p.h * (A_TOP - dbfs) / (A_TOP - A_BOT); }

function resizeCanvas() {
  var r = cv.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  CW = Math.max(240, Math.round(r.width));
  CH = Math.max(160, Math.round(r.height));
  cv.width = Math.round(CW * DPR);
  cv.height = Math.round(CH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ---------- response ------------------------------------------- */
var respLive = new Float64Array(0), respStatic = new Float64Array(0),
    respRange = new Float64Array(0), respW = 0;

function computeResponses(width) {
  if (respW !== width) {
    respLive = new Float64Array(width);
    respStatic = new Float64Array(width);
    respRange = new Float64Array(width);
    respW = width;
  }
  respLive.fill(0); respStatic.fill(0); respRange.fill(0);
  if (ST.bypass || !ST.power) return;

  var sel = ST.bands[ST.selected];
  for (var bi = 0; bi < ST.bands.length; bi++) {
    var band = ST.bands[bi];
    if (!band.on) continue;
    if (ST.solo && band !== sel) continue;
    var g = TYPES[band.type].gain ? band.gain : 0;
    var sS = designBand(band, g);
    var sL = band.dyn.on ? designBand(band, g + band.dyn.cur) : sS;
    var sR = band.dyn.on ? designBand(band, g + band.dyn.range) : sS;

    for (var x = 0; x < width; x++) {
      var f = normToF(x / (width - 1));
      var w = Math.min(2 * Math.PI * f / FS, Math.PI * 0.9995);
      var c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      var dS = cascadeDb(sS, c1, s1, c2, s2);
      respStatic[x] += dS;
      respLive[x] += (sL === sS) ? dS : cascadeDb(sL, c1, s1, c2, s2);
      respRange[x] += (sR === sS) ? dS : cascadeDb(sR, c1, s1, c2, s2);
    }
  }
}
function respAtF(f) {
  if (!respW) return 0;
  return respLive[clamp(Math.round(fToNorm(f) * (respW - 1)), 0, respW - 1)];
}

/* ---------- formatting ----------------------------------------- */
function fmtFreq(f) {
  if (f >= 10000) return (f / 1000).toFixed(1) + " kHz";
  if (f >= 1000) return (f / 1000).toFixed(2) + " kHz";
  return f.toFixed(f < 100 ? 1 : 0) + " Hz";
}
function fmtDb(v) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + " dB"; }

/* ---------- canvas interaction --------------------------------- */
var hover = { x: -1, y: -1, inside: false, node: -1 };
var drag = null;

function nodeY(band) {
  var g = TYPES[band.type].gain ? band.gain + (band.dyn.on ? band.dyn.cur : 0) : 0;
  return yOfDb(g);
}
function localPt(e) {
  var r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function hitNode(pt) {
  var best = -1, bestD = 18 * 18;
  for (var i = 0; i < ST.bands.length; i++) {
    var b = ST.bands[i];
    var dx = xOfF(b.freq) - pt.x, dy = nodeY(b) - pt.y;
    var d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function bindCanvas() {
  cv.addEventListener("pointermove", function (e) {
    var pt = localPt(e), p = plot();
    hover.x = pt.x; hover.y = pt.y;
    hover.inside = pt.x >= p.x && pt.x <= p.x + p.w && pt.y >= p.y && pt.y <= p.y + p.h;
    if (drag) {
      var b = ST.bands[drag.i], fine = e.shiftKey ? 0.22 : 1;
      b.freq = clamp(fOfX(drag.sx + (pt.x - drag.px) * fine), FMIN + 2, 30000);
      if (TYPES[b.type].gain) b.gain = clamp(dbOfY(drag.sy + (pt.y - drag.py) * fine), -24, 24);
      syncBandControls();
      return;
    }
    hover.node = hitNode(pt);
    cv.style.cursor = hover.node >= 0 ? "grab" : "crosshair";
  });
  cv.addEventListener("pointerleave", function () { hover.inside = false; hover.node = -1; });

  cv.addEventListener("pointerdown", function (e) {
    var pt = localPt(e), i = hitNode(pt);
    if (i < 0) return;
    if (e.altKey) { commit(function () { ST.bands[i].on = !ST.bands[i].on; }); syncAll(); return; }
    beginGesture();
    ST.selected = i;
    drag = { i: i, px: pt.x, py: pt.y, sx: xOfF(ST.bands[i].freq), sy: nodeY(ST.bands[i]) };
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = "grabbing";
    syncAll();
  });
  function up() { if (drag) { drag = null; endGesture(); cv.style.cursor = "crosshair"; } }
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);

  cv.addEventListener("wheel", function (e) {
    var i = hover.node >= 0 ? hover.node : hitNode(localPt(e));
    if (i < 0) return;
    var b = ST.bands[i];
    if (!TYPES[b.type].q) return;
    e.preventDefault();
    beginGesture();
    ST.selected = i;
    b.q = clamp(b.q * Math.exp(-e.deltaY * 0.0016 * (e.shiftKey ? 0.3 : 1)), 0.1, 100);
    syncBandControls();
    clearTimeout(cv._wt);
    cv._wt = setTimeout(endGesture, 350);
  }, { passive: false });

  cv.addEventListener("dblclick", function (e) {
    var pt = localPt(e), p = plot();
    if (hitNode(pt) >= 0 || pt.x < p.x || pt.x > p.x + p.w) return;
    if (ST.bands.length >= 24) return;
    commit(function () {
      var f = Math.round(fOfX(pt.x));
      ST.bands.push(mkBand("bell", f, +clamp(dbOfY(pt.y), -24, 24).toFixed(1), 1.0));
      ST.bands.sort(function (a, b) { return a.freq - b.freq; });
      for (var i = 0; i < ST.bands.length; i++) if (ST.bands[i].freq === f) { ST.selected = i; break; }
    });
    syncAll();
  });

  cv.addEventListener("contextmenu", function (e) {
    var i = hitNode(localPt(e));
    if (i < 0) return;
    e.preventDefault();
    removeBand(i);
  });

  window.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    var k = e.key.toLowerCase();
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); removeBand(ST.selected); }
    else if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); e.shiftKey ? History.redo() : History.undo(); }
    else if (e.key === "[") { ST.selected = (ST.selected - 1 + ST.bands.length) % ST.bands.length; syncAll(); }
    else if (e.key === "]") { ST.selected = (ST.selected + 1) % ST.bands.length; syncAll(); }
  });
}
function removeBand(i) {
  if (ST.bands.length <= 1 || i < 0 || i >= ST.bands.length) return;
  commit(function () {
    ST.bands.splice(i, 1);
    ST.selected = clamp(ST.selected, 0, ST.bands.length - 1);
  });
  syncAll();
}

function loadPreset(i) {
  commit(function () {
    ST.presetIndex = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
    ST.bands = JSON.parse(JSON.stringify(PRESETS[ST.presetIndex].bands));
    ST.selected = Math.min(ST.selected, ST.bands.length - 1);
  });
  syncAll();
}

/* ---------- frame loop ----------------------------------------- */
var lastT = 0;
var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function frame(now) {
  var dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (!reducedMotion && ST.analyzerOn) updateSpectrum(dt);
  updateDynamics(dt);

  var p = plot();
  computeResponses(Math.max(64, Math.round(p.w)));

  ctx.clearRect(0, 0, CW, CH);
  drawWell(ctx, p);
  if (ST.analyzerOn) {
    if (ST.analyzerMode === "pre" || ST.analyzerMode === "both") drawSpectrum(ctx, p);
    if (ST.analyzerMode === "post" || ST.analyzerMode === "both") drawSpectrumPost(ctx, p);
  }
  /* the tabs change emphasis rather than hiding anything: SPECTRAL pushes
     the curve back so the analyser reads, DYNAMIC does the reverse */
  ctx.save();
  if (ST.tab === "spectral") ctx.globalAlpha = 0.35;
  drawResponse(ctx, p, ST.bands);
  drawNodes(ctx, p, ST.bands, ST.selected, hover.node);
  ctx.restore();
  if (hover.inside && !drag) {
    var f = fOfX(hover.x);
    drawHoverGuide(ctx, p, hover.x, f, respAtF(f));
  }
  drawAxes(ctx, p);

  requestAnimationFrame(frame);
}

function bootEngine() {
  cv = document.getElementById("shape-graph");
  ctx = cv.getContext("2d");
  if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(cv);
  else window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  bindCanvas();
  buildControls();
  syncAll();
  for (var i = 0; i < 45; i++) updateSpectrum(1 / 60);   /* settle before first paint */
  lastT = performance.now();
  requestAnimationFrame(frame);
}
