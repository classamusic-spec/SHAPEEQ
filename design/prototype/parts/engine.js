/* ==================================================================
   SHAPE — engine
   Filter design, state, analyser model, interaction and the frame loop.
   Drawing lives in canvas.js; controls in knobs.html; binding in wiring.js.

   The response curve is computed, never drawn. Each band is described as
   a cascade of analogue prototype sections, and the PHASE mode decides how
   those sections are realised:

     ZERO     RBJ-cookbook biquads via the bilinear transform — the classic
              minimum-phase EQ. Exact at the band centre, but its response
              is compressed ("cramped") toward Nyquist.
     NATURAL  magnitude-matched biquads: impulse-invariant poles with the
              numerator solved to hit the analogue magnitude exactly at DC,
              at Nyquist and at the band centre. Still minimum phase and
              zero latency, but without the cramping.
     LINEAR   the analogue target magnitude itself — what a linear-phase
              FIR designed from that target reproduces, up to Nyquist.

   In every mode the display evaluates 20*log10|H| of exactly the thing
   that mode would run, at every pixel column.
   ================================================================== */
"use strict";

var FS = 96000;
var NYQ = FS / 2;
var FMIN = 15, FMAX = 28000;           /* display span, matching the reference */
var BAND_FMIN = 20, BAND_FMAX = 20000;  /* where a band's centre may sit        */
var LOG_MIN = Math.log(FMIN), LOG_SPAN = Math.log(FMAX) - LOG_MIN;

var ANA_RANGE = 24;   /* left ruler: analyser, +/-24 dB                      */
var ANA_REF = -18;    /* analyser 0 dB = -18 dBFS, the usual 0 VU alignment  */

function setSampleRate(sr) { FS = sr; NYQ = sr / 2; }
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
var SLOPES = [6, 12, 18, 24, 36, 48, 72, 96];
/* types drawn by the line alone: the tonal fill sits on top of these */
var BASELINE_TYPES = { lowcut: 1, highcut: 1, notch: 1, bandpass: 1 };

/* Q of each 2nd-order section of an order-n Butterworth cascade.
   Even n: poles at (2k-1)pi/2n. Odd n: a real pole plus pairs at k*pi/n —
   using the even formula for odd orders overdamps the 18 dB/oct cut
   (-7.8 dB at the corner instead of -3.0), which the audit caught.   */
function butterworthQs(order) {
  var qs = [], k;
  if (order % 2 === 0) {
    for (k = 1; k <= order / 2; k++) qs.push(1 / (2 * Math.cos((2 * k - 1) * Math.PI / (2 * order))));
  } else {
    for (k = 1; k <= (order - 1) / 2; k++) qs.push(1 / (2 * Math.cos(k * Math.PI / order)));
  }
  return qs;
}

/* ---------- band -> analogue prototype sections ------------------
   Every section is { k, f, g, q }: kind, centre Hz, gain dB, Q.       */
function bandSections(band, gainDb) {
  var f0 = clamp(band.freq, BAND_FMIN, Math.min(BAND_FMAX, NYQ * 0.98));
  var Q = clamp(band.q, 0.1, 100);
  switch (band.type) {
    case "bell":      return [{ k: "peak", f: f0, g: gainDb, q: Q }];
    case "lowshelf":  return [{ k: "ls",   f: f0, g: gainDb, q: Q }];
    case "highshelf": return [{ k: "hs",   f: f0, g: gainDb, q: Q }];
    case "tilt":      return [{ k: "ls", f: f0, g: -gainDb, q: Q }, { k: "hs", f: f0, g: gainDb, q: Q }];
    case "notch":     return [{ k: "notch", f: f0, g: 0, q: Q }];
    case "bandpass":  return [{ k: "bp",    f: f0, g: 0, q: Q }];
    case "lowcut":
    case "highcut": {
      var hp = band.type === "lowcut";
      var order = Math.max(1, Math.round(band.slope / 6));
      var out = [], qs = butterworthQs(order);
      if (order % 2 === 1) out.push({ k: hp ? "hp1" : "lp1", f: f0, g: 0, q: 0.5 });
      for (var i = 0; i < qs.length; i++) out.push({ k: hp ? "hp2" : "lp2", f: f0, g: 0, q: qs[i] });
      return out;
    }
    default: return [];
  }
}

/* ---------- analogue magnitude, |H(jx)|^2 with x = f / f0 ------- */
function analogMag2(s, x) {
  var A, sA, x2 = x * x, u = 1 - x2, q2 = s.q * s.q;
  switch (s.k) {
    case "peak":
      A = Math.pow(10, s.g / 40);
      return (u * u + (A * x / s.q) * (A * x / s.q)) / (u * u + (x / (A * s.q)) * (x / (A * s.q)));
    case "ls":
      A = Math.pow(10, s.g / 40); sA = Math.sqrt(A);
      return A * A * ((A - x2) * (A - x2) + A * x2 / q2) / ((1 - A * x2) * (1 - A * x2) + A * x2 / q2);
    case "hs":
      A = Math.pow(10, s.g / 40); sA = Math.sqrt(A);
      return A * A * ((1 - A * x2) * (1 - A * x2) + A * x2 / q2) / ((A - x2) * (A - x2) + A * x2 / q2);
    case "hp2":   return (x2 * x2) / (u * u + x2 / q2);
    case "lp2":   return 1 / (u * u + x2 / q2);
    case "hp1":   return x2 / (1 + x2);
    case "lp1":   return 1 / (1 + x2);
    case "notch": return (u * u) / (u * u + x2 / q2);
    case "bp":    return (x2 / q2) / (u * u + x2 / q2);
  }
  return 1;
}

/* ---------- ZERO: RBJ bilinear realisation ----------------------- */
function norm(b0, b1, b2, a0, a1, a2) {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function bilinearSec(s) {
  var w = 2 * Math.PI * s.f / FS, cw = Math.cos(w), sw = Math.sin(w);
  var al = sw / (2 * s.q), A, t, K, n;
  switch (s.k) {
    case "peak":
      A = Math.pow(10, s.g / 40);
      return norm(1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A);
    case "ls":
      A = Math.pow(10, s.g / 40); t = 2 * Math.sqrt(A) * al;
      return norm(A * ((A + 1) - (A - 1) * cw + t), 2 * A * ((A - 1) - (A + 1) * cw),
                  A * ((A + 1) - (A - 1) * cw - t), (A + 1) + (A - 1) * cw + t,
                  -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - t);
    case "hs":
      A = Math.pow(10, s.g / 40); t = 2 * Math.sqrt(A) * al;
      return norm(A * ((A + 1) + (A - 1) * cw + t), -2 * A * ((A - 1) + (A + 1) * cw),
                  A * ((A + 1) + (A - 1) * cw - t), (A + 1) - (A - 1) * cw + t,
                  2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - t);
    case "hp2":   return norm((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + al, -2 * cw, 1 - al);
    case "lp2":   return norm((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + al, -2 * cw, 1 - al);
    case "notch": return norm(1, -2 * cw, 1, 1 + al, -2 * cw, 1 - al);
    case "bp":    return norm(al, 0, -al, 1 + al, -2 * cw, 1 - al);
    case "hp1":
      K = Math.tan(Math.PI * s.f / FS); n = 1 / (1 + K);
      return { b0: n, b1: -n, b2: 0, a1: (K - 1) * n, a2: 0 };
    case "lp1":
      K = Math.tan(Math.PI * s.f / FS); n = 1 / (1 + K);
      return { b0: K * n, b1: K * n, b2: 0, a1: (K - 1) * n, a2: 0 };
  }
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
}

/* ---------- NATURAL: magnitude-matched realisation ---------------
   Poles are the analogue poles mapped by impulse invariance; the
   numerator is then solved so |H| equals the analogue magnitude at DC,
   at Nyquist and at the band centre. Squared magnitudes are linear in
   B0 = (b0+b1+b2)^2, B1 = (b0-b1+b2)^2, B2 = -4 b0 b2, which makes the
   three-point match a direct solve.                                    */
var POLE_LIMIT = 0.97 * Math.PI;

function invertSec(c) {
  return { b0: 1 / c.b0, b1: c.a1 / c.b0, b2: c.a2 / c.b0, a1: c.b1 / c.b0, a2: c.b2 / c.b0 };
}
function matchedSec(s) {
  /* a cut is the exact inverse of the matching boost for these prototypes;
     designing the boost and inverting it keeps the centre gain exact where
     a direct solve would have no realisable numerator                    */
  if ((s.k === "peak" || s.k === "ls" || s.k === "hs") && s.g < 0) {
    return invertSec(matchedSec({ k: s.k, f: s.f, g: -s.g, q: s.q }));
  }
  var w0 = 2 * Math.PI * s.f / FS;
  var T0 = analogMag2(s, 0), Tn = analogMag2(s, Math.PI / w0), Tc = analogMag2(s, 1);

  if (s.k === "hp1" || s.k === "lp1") {
    var p = -Math.exp(-Math.min(w0, POLE_LIMIT));
    var sum = Math.sqrt(T0) * (1 + p), dif = Math.sqrt(Tn) * (1 - p);
    return { b0: (sum + dif) / 2, b1: (sum - dif) / 2, b2: 0, a1: p, a2: 0 };
  }

  var wp = w0, Qp = s.q, A;
  if (s.k === "peak") { A = Math.pow(10, s.g / 40); Qp = A * s.q; }
  else if (s.k === "ls") { A = Math.pow(10, s.g / 40); wp = w0 / Math.sqrt(A); }
  else if (s.k === "hs") { A = Math.pow(10, s.g / 40); wp = w0 * Math.sqrt(A); }
  wp = Math.min(wp, POLE_LIMIT);

  var z = 1 / (2 * Qp), e = Math.exp(-z * wp), a1;
  a1 = z <= 1 ? -2 * e * Math.cos(wp * Math.sqrt(1 - z * z))
              : -2 * e * Math.cosh(wp * Math.sqrt(z * z - 1));
  var a2 = e * e;

  var A0 = (1 + a1 + a2) * (1 + a1 + a2), A1 = (1 - a1 + a2) * (1 - a1 + a2), A2 = -4 * a2;
  var p1 = Math.sin(w0 / 2); p1 *= p1;
  var p0 = 1 - p1, p2 = 4 * p0 * p1;

  /* a 2nd-order high-pass needs its double zero at DC, or the slope decays
     toward 6 dB/oct far below the corner: fix the numerator's shape to
     K(1 - z^-1)^2 and scale it to hit the analogue gain at the corner  */
  if (s.k === "hp2") {
    var K = Math.sqrt(Tc * (A0 * p0 + A1 * p1 + A2 * p2)) / (4 * p1);
    return { b0: K, b1: -2 * K, b2: K, a1: a1, a2: a2 };
  }

  var B0 = T0 * A0, B1 = Tn * A1;
  var B2 = (Tc * (A0 * p0 + A1 * p1 + A2 * p2) - B0 * p0 - B1 * p1) / p2;

  var r0 = Math.sqrt(B0), r1 = Math.sqrt(B1);
  var W = (r0 + r1) / 2, b1 = (r0 - r1) / 2;
  var disc = W * W + B2;
  var gainKind = s.k === "peak" || s.k === "ls" || s.k === "hs";

  /* An exact boost keeps its zeros well inside the unit circle. Where the pole
     had to be clamped below Nyquist (a steep high shelf near the top at
     44.1/48 kHz) the solve cannot deliver that: its zeros land on the unit
     circle, and the inverted cut would be unstable. The matched design is
     not realisable there, so that one section falls back to bilinear —
     stable, and still exact at the band centre.                        */
  if (gainKind && disc < 0) return bilinearSec(s);
  disc = Math.max(0, disc);
  var b0 = (W + Math.sqrt(disc)) / 2, b2 = W - b0;
  /* zeros may legitimately sit outside the poles (a high-shelf boost's
     numerator corner is below its denominator's) but never at the circle */
  if (gainKind && b2 / b0 > Math.max(a2, 0.999)) return bilinearSec(s);
  return { b0: b0, b1: b1, b2: b2, a1: a1, a2: a2 };
}

/* ---------- realise + evaluate ----------------------------------- */
function realiseBand(band, gainDb) {
  var secs = bandSections(band, gainDb);
  if (ST.phase === "linear") return { analog: true, secs: secs };
  var out = [];
  for (var i = 0; i < secs.length; i++) {
    out.push(ST.phase === "natural" ? matchedSec(secs[i]) : bilinearSec(secs[i]));
  }
  return { analog: false, secs: out };
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
function analogDb(secs, f) {
  var db = 0;
  for (var i = 0; i < secs.length; i++) db += 10 * Math.log10(analogMag2(secs[i], f / secs[i].f) + 1e-30);
  return db;
}
/* response of one realised band at one frequency (above Nyquist the
   digital response is undefined, so it is held at its Nyquist value) */
function realisedDbAt(rb, f) {
  var fe = Math.min(f, NYQ * 0.9995);
  if (rb.analog) return analogDb(rb.secs, fe);
  var w = 2 * Math.PI * fe / FS;
  return cascadeDb(rb.secs, Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w));
}

/* ---------- presets ----------------------------------------------- */
function mkBand(type, freq, gain, q, extra) {
  var b = {
    type: type, freq: freq, gain: gain, q: q, slope: 12, on: true,
    dyn: { on: false, range: -6, threshold: -24, attack: 10, release: 120, cur: 0 }
  };
  if (extra) for (var k in extra) b[k] = extra[k];
  return b;
}
function dyn(range, threshold, attack, release) {
  return { dyn: { on: true, range: range, threshold: threshold, attack: attack, release: release, cur: 0 } };
}

var PRESETS = [
  { name: "Master Clean", tag: "PRECISION · MUSICAL · NATURAL", bands: [
    mkBand("lowcut", 38, 0, 0.71, { slope: 12 }),
    mkBand("bell", 101, 5.9, 0.8),
    mkBand("bell", 512, -4.8, 2.4, dyn(-6, -24, 10, 120)),
    mkBand("bell", 3400, 9.2, 0.7),
    mkBand("highshelf", 17000, 7.0, 0.6)
  ]},
  { name: "Vocal Presence", tag: "FORWARD · CLEAR · INTIMATE", bands: [
    mkBand("lowcut", 92, 0, 0.71, { slope: 24 }),
    mkBand("bell", 268, -3.4, 1.6),
    mkBand("bell", 2900, 4.6, 1.1),
    mkBand("bell", 6400, -4.2, 5.5, dyn(-5, -30, 3, 80)),
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
    mkBand("bell", 180, -5.5, 2.2, dyn(-8, -20, 14, 180)),
    mkBand("bell", 900, 2.6, 1.4),
    mkBand("highcut", 12000, 0, 0.71, { slope: 12 })
  ]},
  { name: "Air Lift", tag: "SILKY · OPEN · TALL", bands: [
    mkBand("bell", 340, -2.4, 1.4),
    mkBand("highshelf", 7800, 4.4, 0.6),
    mkBand("bell", 15500, 3.8, 0.9)
  ]},
  { name: "Quiet Lift", tag: "UPWARD · GENTLE · DETAIL", bands: [
    mkBand("lowcut", 40, 0, 0.71, { slope: 18 }),
    mkBand("bell", 2600, 0, 0.8, dyn(4, -34, 20, 250)),
    mkBand("highshelf", 9500, 0, 0.7, dyn(3, -40, 30, 300))
  ]},
  { name: "Surgical Repair", tag: "NARROW · SURGICAL · EXACT", bands: [
    mkBand("notch", 60, 0, 30),
    mkBand("notch", 180, 0, 30),
    mkBand("bell", 3150, -8.5, 12),
    mkBand("highshelf", 11000, 2.4, 0.7)
  ]}
];

/* ---------- state --------------------------------------------------
   Sound state is what A/B and undo capture. View state (analyser
   source, tab, display scale, settings) is deliberately excluded, as
   the spec asks: A/B compares sound, not cosmetics.                  */
var SOUND_KEYS = ["presetIndex", "bands", "selected", "phase", "mode", "input", "output"];

var ST = {
  presetIndex: 0,
  bands: JSON.parse(JSON.stringify(PRESETS[0].bands)),
  selected: 2,
  phase: "zero",
  mode: "clean",
  input: 0,
  output: 0,
  /* A/B */
  slot: "A",
  slots: { A: null, B: null },
  /* view */
  solo: false,
  analyzerOn: true,
  analyzerMode: "pre",
  tab: "eq",
  fineScale: 12,
  /* settings */
  sampleRate: 96000,
  linearQuality: "high",
  anaSpeed: "medium",
  anaTilt: 0,
  autoGain: false,
  sidechain: false
};
function cur() { return ST; }
function selBand() { return ST.bands[ST.selected]; }

function soundSnap() {
  var o = {};
  for (var i = 0; i < SOUND_KEYS.length; i++) o[SOUND_KEYS[i]] = ST[SOUND_KEYS[i]];
  return JSON.parse(JSON.stringify(o));
}
function loadSound(o) {
  for (var i = 0; i < SOUND_KEYS.length; i++) {
    var k = SOUND_KEYS[i];
    if (o[k] !== undefined) ST[k] = JSON.parse(JSON.stringify(o[k]));
  }
  ST.selected = clamp(ST.selected, 0, ST.bands.length - 1);
}

/* A/B: the slot being left keeps what you did to it; a slot never
   visited starts as a copy of the other, so B begins where A is.     */
function switchSlot(to) {
  if (to === ST.slot) return;
  commit(function () {
    ST.slots[ST.slot] = soundSnap();
    if (!ST.slots[to]) ST.slots[to] = soundSnap();
    loadSound(ST.slots[to]);
    ST.slot = to;
  });
  syncAll();
}

/* ---------- undo / redo (sound only, gestures grouped) --------- */
var History = {
  past: [], future: [],
  snap: function () { return JSON.stringify({ s: soundSnap(), slot: ST.slot, slots: ST.slots }); },
  restore: function (str) {
    var o = JSON.parse(str);
    loadSound(o.s); ST.slot = o.slot; ST.slots = o.slots;
  },
  push: function (prev) {
    this.past.push(prev);
    if (this.past.length > 200) this.past.shift();
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

/* ---------- analyser model ---------------------------------------
   There is no audio in a prototype, so the input is a synthesised
   mix: a moving bass line, a chord, a lead with formants, drums and a
   pink floor. Partials are spread by a fixed window width in Hz, as a
   real 4096-point FFT spreads them — broad in the bass, needle-sharp
   in the mids and highs. Everything downstream of this input (POST,
   the dynamics detectors, auto gain) is computed truthfully from it.  */
var NBINS = 1024;
var binF = new Float64Array(NBINS);
var binT = new Float64Array(NBINS);
for (var _i = 0; _i < NBINS; _i++) {
  binT[_i] = _i / (NBINS - 1);
  binF[_i] = normToF(binT[_i]);
}
var specPow = new Float64Array(NBINS);
var specRaw = new Float64Array(NBINS);
var specDisp = new Float64Array(NBINS);   /* dBFS, before input gain */
var specPeak = new Float64Array(NBINS);
var texture = new Float64Array(NBINS);
for (var _j = 0; _j < NBINS; _j++) { specDisp[_j] = -90; specPeak[_j] = -120; }

var SPEEDS = { slow: [0.30, 0.020], medium: [0.55, 0.050], fast: [0.85, 0.120] };
var BASS_LINE = [55, 55, 65.41, 49, 73.42, 61.74];
var CHORDS = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 311.1]];
var LEAD = [587.3, 659.3, 523.3, 698.5, 587.3, 784];
var T = 0;

function addPartial(fp, levelDb, sigmaHz) {
  if (fp <= FMIN || fp >= Math.min(FMAX, NYQ)) return;
  var p = Math.pow(10, levelDb / 10);
  var lo = fp - 4 * sigmaHz, hi = fp + 4 * sigmaHz;
  var i0 = Math.max(0, Math.floor(fToNorm(Math.max(lo, FMIN)) * (NBINS - 1)));
  var i1 = Math.min(NBINS - 1, Math.ceil(fToNorm(Math.min(hi, FMAX)) * (NBINS - 1)));
  for (var i = i0; i <= i1; i++) {
    var d = (binF[i] - fp) / sigmaHz;
    specPow[i] += p * Math.exp(-0.5 * d * d);
  }
}
function floorDb(f) {
  /* the mix's broadband body: gently rising to 200 Hz, -3.3 dB/oct above
     1 kHz, and a steep roll-off under 60 Hz — the shape of a mastered mix */
  var v;
  if (f >= 1000) v = -32.5 - 3.0 * Math.log2(f / 1000);
  else v = -32.5 + 1.6 * Math.min(Math.log2(1000 / f), Math.log2(1000 / 200));
  if (f < 70) v -= 12 * Math.log2(70 / f);
  if (f > 16000) v -= 6 * Math.log2(f / 16000);
  return v;
}

function updateSpectrum(dt) {
  T += dt;
  var i, h;
  for (i = 0; i < NBINS; i++) specPow[i] = Math.pow(10, floorDb(binF[i]) / 10);

  var beat = T * 2.0;                               /* 120 bpm */
  var bar = Math.floor(beat / 4);
  var sigma = 7.5;                                  /* window width, Hz */

  /* bass line, one note per beat */
  var bf = BASS_LINE[Math.floor(beat) % BASS_LINE.length];
  var bEnv = 0.55 + 0.45 * Math.exp(-3 * (beat % 1));
  for (h = 1; h <= 24; h++) {
    addPartial(bf * h, -30 - 6.5 * Math.log2(h) + 10 * Math.log10(bEnv) + (h === 2 ? 2 : 0), sigma);
  }
  /* chord, one per bar */
  var ch = CHORDS[bar % CHORDS.length];
  for (var c = 0; c < ch.length; c++) {
    for (h = 1; h <= 28; h++) {
      addPartial(ch[c] * h * (1 + 0.0007 * c), -24.5 - 5.0 * Math.log2(h), sigma);
    }
  }
  /* lead with two formants, a note per half bar */
  var lf = LEAD[Math.floor(beat / 2) % LEAD.length];
  var vib = 1 + 0.004 * Math.sin(T * 34);
  for (h = 1; h <= 30; h++) {
    var fh = lf * h * vib;
    var form = 9 * Math.exp(-Math.pow(Math.log2(fh / 1300) / 0.35, 2)) +
               6 * Math.exp(-Math.pow(Math.log2(fh / 2900) / 0.3, 2));
    addPartial(fh, -33.5 - 4.2 * Math.log2(h) + form, sigma);
  }
  /* kick and snare */
  var kick = Math.exp(-9 * (beat % 1));
  var snare = Math.exp(-7 * ((beat + 1) % 2));
  for (i = 0; i < NBINS; i++) {
    var f = binF[i];
    var k = kick * Math.exp(-Math.pow(Math.log2(f / 58) / 0.55, 2)) * Math.pow(10, -27 / 10);
    var sn = snare * (Math.exp(-Math.pow(Math.log2(f / 220) / 0.4, 2)) * 0.5 +
                      Math.exp(-Math.pow(Math.log2(f / 5000) / 1.1, 2)) * 0.35) * Math.pow(10, -30 / 10);
    /* the snare's boxy body around 500 Hz — what the preset's dynamic cut
       at 512 Hz is there to tame, so it ducks on the backbeat            */
    sn += snare * Math.exp(-Math.pow(Math.log2(f / 520) / 0.45, 2)) * Math.pow(10, -17 / 10);
    specPow[i] += k + sn;
  }

  /* per-bin variance, as a real FFT frame has: magnitudes of noisy bins are
     Rayleigh-like, so the spikes point up. Noisier toward the top.        */
  for (i = 0; i < NBINS; i++) {
    var amp = 2.0 + 3.2 * Math.min(1, binF[i] / 2500);
    var spike = (-Math.log(1 - Math.random() * 0.9999) - 1) * amp * 1.25;
    texture[i] += (spike - texture[i]) * 0.6;
    specRaw[i] = 10 * Math.log10(specPow[i] + 1e-14) + texture[i];
  }

  var sp = SPEEDS[ST.anaSpeed] || SPEEDS.medium;
  for (i = 0; i < NBINS; i++) {
    var t = specRaw[i];
    specDisp[i] += (t - specDisp[i]) * (t > specDisp[i] ? sp[0] : sp[1]);
    specPeak[i] = Math.max(specPeak[i] - 20 * dt, specDisp[i]);
  }
}

/* analyser display tilt: dB added at f, pivoting at 1 kHz */
function anaTiltAt(f) { return ST.anaTilt * Math.log2(f / 1000); }

/* ---------- dynamics ------------------------------------------------
   Detector: energy of the input (after the input trim) weighted by a
   window matched to the band's own bandwidth — one detector per band,
   never a shared broadband one. Gain computer: 2:1 with a 6 dB soft
   knee. Direction follows the sign of RANGE, as the spec defines it:
     negative  DOWNWARD — attenuate when the band gets LOUDER than threshold
     positive  UPWARD   — boost when the band falls QUIETER than threshold
   Movement never exceeds |RANGE|; that is enforced here, not by drawing. */
var DYN_RATIO = 2, DYN_KNEE = 6;

function bandwidthOct(band) {
  if (band.type === "bell" || band.type === "notch" || band.type === "bandpass") {
    var q = Math.max(band.q, 0.1);
    return (2 / Math.LN2) * Math.asinh(1 / (2 * q));
  }
  return 1.5;
}
function detectorLevel(band) {
  var bw = clamp(bandwidthOct(band) / 2, 0.08, 2.2);
  var sum = 0, wsum = 0;
  for (var i = 0; i < NBINS; i++) {
    var oct = Math.log(binF[i] / band.freq) / Math.LN2;
    var w = Math.exp(-Math.pow(oct / bw, 2));
    if (w < 0.02) continue;
    sum += Math.pow(10, specRaw[i] / 10) * w;
    wsum += w;
  }
  /* reads the raw frame, not the analyser's display ballistics: the band
     has its own attack and release, and must not inherit the display's.
     A power mean over the window. The analyser's bins are log-spaced, so a
     plain sum would scale with how many bins the window spans rather than
     with the band's bandwidth — which pinned wide bands at full range.    */
  return 10 * Math.log10(sum / Math.max(wsum, 1e-9) + 1e-14) + ST.input;
}
function softKnee(o) {
  if (o <= -DYN_KNEE / 2) return 0;
  if (o >= DYN_KNEE / 2) return o;
  return (o + DYN_KNEE / 2) * (o + DYN_KNEE / 2) / (2 * DYN_KNEE);
}
function dynamicTarget(band, det) {
  var r = band.dyn.range, k = 1 - 1 / DYN_RATIO;
  if (r < 0) return -Math.min(softKnee(det - band.dyn.threshold) * k, -r);
  if (r > 0) return Math.min(softKnee(band.dyn.threshold - det) * k, r);
  return 0;
}
function updateDynamics(dt) {
  for (var i = 0; i < ST.bands.length; i++) {
    var b = ST.bands[i];
    if (!b.dyn.on || !b.on) { b.dyn.cur *= 0.85; continue; }
    b.dyn.det = detectorLevel(b);
    var target = dynamicTarget(b, b.dyn.det);
    var engaging = Math.abs(target) > Math.abs(b.dyn.cur);
    var tau = (engaging ? b.dyn.attack : b.dyn.release) / 1000;
    b.dyn.cur += (target - b.dyn.cur) * clamp(1 - Math.exp(-dt / Math.max(tau, 0.0001)), 0, 1);
  }
}

/* ---------- canvas geometry ------------------------------------- */
var cv, ctx, CW = 0, CH = 0, DPR = 1;
var PAD = { l: 52, r: 54, t: 66, b: 34 };

/* the EQ is plotted on the right-hand ruler. Its +/-scale ticks sit at
   three quarters of the half-height, which is where the reference puts
   them — and where a -4.8 dB band reads -4.8 on that ruler.           */
function eqHalf() { return ST.fineScale * 4 / 3; }

function plot() {
  return { x: PAD.l, y: PAD.t, w: Math.max(10, CW - PAD.l - PAD.r), h: Math.max(10, CH - PAD.t - PAD.b) };
}
function xOfF(f) { var p = plot(); return p.x + fToNorm(f) * p.w; }
function fOfX(x) { var p = plot(); return normToF(clamp((x - p.x) / p.w, 0, 1)); }
function yOfDb(db) { var p = plot(), H = eqHalf(); return p.y + p.h * (H - db) / (2 * H); }
function dbOfY(y) { var p = plot(), H = eqHalf(); return H - ((y - p.y) / p.h) * 2 * H; }
/* left ruler: analyser dB (0 = ANA_REF dBFS) */
function yOfAna(v) { var p = plot(); return p.y + p.h * (ANA_RANGE - v) / (2 * ANA_RANGE); }
function yOfLevel(dbfs) { return yOfAna(dbfs - ANA_REF); }

function resizeCanvas() {
  var r = cv.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  CW = Math.max(240, Math.round(r.width));
  CH = Math.max(160, Math.round(r.height));
  cv.width = Math.round(CW * DPR);
  cv.height = Math.round(CH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ---------- response ---------------------------------------------
   respLive    every band, dynamics as they are this frame
   respStatic  every band at rest
   respRange   dynamic bands pushed to their limit
   respBase    only the line-drawn types (cuts, notch, band pass): the
               tonal fill is painted between this and respLive, so a
               cut is shown by its line and never floods the plot     */
var respLive = new Float64Array(0), respStatic = new Float64Array(0),
    respRange = new Float64Array(0), respBase = new Float64Array(0),
    respW = 0, colF = new Float64Array(0), colTrig = null;

function allocResp(width) {
  respLive = new Float64Array(width); respStatic = new Float64Array(width);
  respRange = new Float64Array(width); respBase = new Float64Array(width);
  colF = new Float64Array(width);
  respW = width; colTrig = null;
}
function buildTrig() {
  colTrig = { fs: FS, c1: new Float64Array(respW), s1: new Float64Array(respW),
              c2: new Float64Array(respW), s2: new Float64Array(respW) };
  for (var x = 0; x < respW; x++) {
    colF[x] = normToF(x / (respW - 1));
    var w = 2 * Math.PI * Math.min(colF[x], NYQ * 0.9995) / FS;
    colTrig.c1[x] = Math.cos(w); colTrig.s1[x] = Math.sin(w);
    colTrig.c2[x] = Math.cos(2 * w); colTrig.s2[x] = Math.sin(2 * w);
  }
}
function evalInto(rb, arr, x) {
  if (rb.analog) return analogDb(rb.secs, Math.min(colF[x], NYQ * 0.9995));
  return cascadeDb(rb.secs, colTrig.c1[x], colTrig.s1[x], colTrig.c2[x], colTrig.s2[x]);
}

function computeResponses(width) {
  if (respW !== width) allocResp(width);
  if (!colTrig || colTrig.fs !== FS) buildTrig();
  respLive.fill(0); respStatic.fill(0); respRange.fill(0); respBase.fill(0);

  for (var bi = 0; bi < ST.bands.length; bi++) {
    var band = ST.bands[bi];
    if (!band.on) continue;
    var g = TYPES[band.type].gain ? band.gain : 0;
    var rS = realiseBand(band, g);
    var dynamic = band.dyn.on;
    var rL = dynamic ? realiseBand(band, g + band.dyn.cur) : rS;
    var rR = dynamic ? realiseBand(band, g + band.dyn.range) : rS;
    var isBase = !!BASELINE_TYPES[band.type];

    for (var x = 0; x < width; x++) {
      var dS = evalInto(rS, respStatic, x);
      var dL = rL === rS ? dS : evalInto(rL, respLive, x);
      respStatic[x] += dS;
      respLive[x] += dL;
      respRange[x] += rR === rS ? dS : evalInto(rR, respRange, x);
      if (isBase) respBase[x] += dL;
    }
  }
}
function respAtF(f) {
  if (!respW) return 0;
  return respLive[clamp(Math.round(fToNorm(f) * (respW - 1)), 0, respW - 1)];
}

/* the whole EQ at one frequency, evaluated exactly (not pixel-sampled) */
function compositeDbAt(f) {
  var db = 0;
  for (var i = 0; i < ST.bands.length; i++) {
    var b = ST.bands[i];
    if (!b.on) continue;
    var g = TYPES[b.type].gain ? b.gain + (b.dyn.on ? b.dyn.cur : 0) : 0;
    db += realisedDbAt(realiseBand(b, g), f);
  }
  return db;
}
/* where a band's node sits: on the composite curve at the band's centre,
   as the reference draws every node. Dragging is relative, so a node
   propped up by a neighbour still moves by exactly what you drag. A
   notch rides the 0 dB line, where its depth would put it off-plot.  */
function nodeGainDb(band) {
  if (band.type === "notch") return 0;
  return compositeDbAt(band.freq);
}
/* how much the node moves per dB of gain — used to make dragging relative */
function nodeGainSlope(type) {
  return type === "bell" ? 1 : (type === "lowshelf" || type === "highshelf") ? 0.5 : 1;
}

/* auto gain: minus the EQ's mean change over log frequency, 20 Hz-20 kHz.
   A broadband energy estimate — explicitly not the largest boost negated. */
function autoGainDb() {
  if (!ST.autoGain || !respW) return 0;
  var sum = 0, n = 0;
  for (var x = 0; x < respW; x++) {
    if (colF[x] < 20 || colF[x] > 20000) continue;
    sum += respLive[x]; n++;
  }
  return n ? -sum / n : 0;
}

/* linear-phase latency: half the FIR length, in samples */
/* FIR length at 48 kHz; scaled with the rate so each quality keeps the
   same low-frequency resolution in Hz */
var LINEAR_TAPS = { low: 1024, medium: 2048, high: 4096, max: 8192 };
function latencySamples() {
  if (ST.phase !== "linear") return 0;
  return (LINEAR_TAPS[ST.linearQuality] || 4096) / 2 * (FS / 48000);
}

/* ---------- formatting ------------------------------------------- */
function fmtFreq(f) {
  if (f >= 10000) return (f / 1000).toFixed(1) + " kHz";
  if (f >= 1000) return (f / 1000).toFixed(2) + " kHz";
  return f.toFixed(f < 100 ? 1 : 0) + " Hz";
}
function fmtDb(v) {
  if (Math.abs(v) < 0.05) v = 0;
  return (v < 0 ? "−" : v > 0 ? "+" : "") + Math.abs(v).toFixed(1) + " dB";
}
function fmtQ(v) { return v < 10 ? v.toFixed(2) : v.toFixed(1); }

/* ---------- canvas interaction ----------------------------------- */
var hover = { x: -1, y: -1, inside: false, node: -1 };
var drag = null;

function nodeY(band) { return yOfDb(nodeGainDb(band)); }
function localPt(e) {
  var r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function hitNode(pt) {
  var best = -1, bestD = 16 * 16;
  for (var i = 0; i < ST.bands.length; i++) {
    var b = ST.bands[i];
    var dx = xOfF(b.freq) - pt.x, dy = nodeY(b) - pt.y;
    var d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = i; }
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
      /* relative in both axes, so grabbing a node never makes it jump */
      b.freq = clamp(fOfX(drag.sx + (pt.x - drag.px) * fine), BAND_FMIN, BAND_FMAX);
      if (TYPES[b.type].gain) {
        var dDb = (dbOfY(drag.py + (pt.y - drag.py) * fine) - dbOfY(drag.py)) / nodeGainSlope(b.type);
        b.gain = clamp(drag.g0 + dDb, -24, 24);
      }
      syncBandControls();
      return;
    }
    hover.node = hitNode(pt);
    cv.style.cursor = hover.node >= 0 ? "grab" : "crosshair";
  });
  cv.addEventListener("pointerleave", function () { hover.inside = false; hover.node = -1; });

  cv.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    var pt = localPt(e), i = hitNode(pt);
    if (i < 0) return;
    if (e.altKey) { commit(function () { ST.bands[i].on = !ST.bands[i].on; }); syncAll(); return; }
    beginGesture();
    ST.selected = i;
    drag = { i: i, px: pt.x, py: pt.y, sx: xOfF(ST.bands[i].freq), g0: ST.bands[i].gain };
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
    e.preventDefault();
    beginGesture();
    ST.selected = i;
    if (TYPES[b.type].q) {
      b.q = clamp(b.q * Math.exp(-e.deltaY * 0.0016 * (e.shiftKey ? 0.3 : 1)), 0.1, 100);
    } else if (TYPES[b.type].slope) {
      /* on a cut, the wheel steps the slope instead */
      cv._acc = (cv._acc || 0) + e.deltaY;
      if (Math.abs(cv._acc) > 60) {
        var si = SLOPES.indexOf(b.slope);
        b.slope = SLOPES[clamp(si + (cv._acc < 0 ? 1 : -1), 0, SLOPES.length - 1)];
        cv._acc = 0;
      }
    }
    syncAll();
    clearTimeout(cv._wt);
    cv._wt = setTimeout(endGesture, 350);
  }, { passive: false });

  cv.addEventListener("dblclick", function (e) {
    var pt = localPt(e), p = plot();
    var hit = hitNode(pt);
    if (hit >= 0) {                     /* double-click a node: bypass it */
      commit(function () { ST.bands[hit].on = !ST.bands[hit].on; });
      syncAll();
      return;
    }
    if (pt.x < p.x || pt.x > p.x + p.w) return;
    if (ST.bands.length >= 24) return;
    commit(function () {
      var f = Math.round(clamp(fOfX(pt.x), BAND_FMIN, BAND_FMAX));
      var nb = mkBand("bell", f, +clamp(dbOfY(pt.y), -24, 24).toFixed(1), 1.0);
      ST.bands.push(nb);
      ST.bands.sort(function (a, b) { return a.freq - b.freq; });
      ST.selected = ST.bands.indexOf(nb);
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
    if (e.key === "Escape") { closeSettings(); return; }
    if (e.target.closest && e.target.closest(".sh-knob-dial")) return;   /* knobs own their arrows */
    if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); removeBand(ST.selected); }
    else if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); e.shiftKey ? History.redo() : History.undo(); }
    else if ((e.metaKey || e.ctrlKey) && k === "y") { e.preventDefault(); History.redo(); }
    else if (e.key === "[") { ST.selected = (ST.selected - 1 + ST.bands.length) % ST.bands.length; syncAll(); }
    else if (e.key === "]") { ST.selected = (ST.selected + 1) % ST.bands.length; syncAll(); }
    else if (k === "s" && !e.metaKey && !e.ctrlKey) { ST.solo = !ST.solo; syncAll(); }
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
    var d = ST.bands.findIndex(function (b) { return b.dyn.on; });
    ST.selected = d >= 0 ? d : Math.min(ST.selected, ST.bands.length - 1);
  });
  syncAll();
}

/* ---------- frame loop ------------------------------------------- */
var lastT = 0;
var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function frame(now) {
  var dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  /* the analyser model is the "audio": it runs even with the display off,
     because the dynamics detectors listen to it */
  updateSpectrum(reducedMotion ? dt * 0.25 : dt);
  updateDynamics(dt);

  var p = plot();
  computeResponses(Math.max(64, Math.round(p.w)));

  ctx.clearRect(0, 0, CW, CH);
  drawWell(ctx, p);
  if (ST.analyzerOn) {
    if (ST.analyzerMode === "pre" || ST.analyzerMode === "both") drawSpectrum(ctx, p);
    if (ST.analyzerMode === "post" || ST.analyzerMode === "both") drawSpectrumPost(ctx, p);
  }
  ctx.save();
  if (ST.tab === "spectral") ctx.globalAlpha = 0.32;
  drawResponse(ctx, p, ST.bands);
  if (ST.solo) drawSoloMask(ctx, p, selBand());
  drawNodes(ctx, p, ST.bands, ST.selected, hover.node);
  ctx.restore();

  if (drag || (hover.node >= 0 && hover.inside)) {
    var ti = drag ? drag.i : hover.node;
    drawNodeTag(ctx, p, ST.bands[ti], ti);
  } else if (hover.inside) {
    var f = fOfX(hover.x);
    drawHoverGuide(ctx, p, hover.x, f, respAtF(f));
  }
  drawAxes(ctx, p);

  if (typeof syncLive === "function") syncLive();
  requestAnimationFrame(frame);
}

function bootEngine() {
  setSampleRate(ST.sampleRate);
  cv = document.getElementById("shape-graph");
  ctx = cv.getContext("2d");
  if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(cv);
  else window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  ST.slots.A = soundSnap();
  bindCanvas();
  buildControls();
  syncAll();
  for (var i = 0; i < 60; i++) { updateSpectrum(1 / 60); updateDynamics(1 / 60); }
  lastT = performance.now();
  requestAnimationFrame(frame);
}
