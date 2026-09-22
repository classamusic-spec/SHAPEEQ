/* SHAPE — EQ audit
   Loads the prototype's real engine.js into a sandbox and measures it.
   Every assertion checks the DSP against an independent expectation
   (closed-form analogue magnitudes, Butterworth theory, pole stability),
   not against the implementation itself.

   Run:  node design/prototype/tests/eq-audit.js                         */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "parts", "engine.js"), "utf8");
const sandbox = {
  window: { matchMedia: () => ({ matches: false }) },
  performance: { now: () => 0 },
  requestAnimationFrame: () => {},
  console, Math, Float64Array, JSON, Object, Array
};
vm.createContext(sandbox);
vm.runInContext(src + "\n;this.__E = { ST, TYPES, SLOPES, mkBand, realiseBand, realisedDbAt, bandSections, analogMag2, analogDb, setSampleRate, dynamicTarget, updateDynamics, detectorLevel, updateSpectrum, compositeDbAt, nodeGainDb, soundSnap, loadSound, History, commit, specDisp, specRaw, NBINS };", sandbox);
const E = sandbox.__E;
const ST = E.ST;

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; failures.push(name + (detail ? "  — " + detail : "")); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
const fmt = (v, d = 3) => (v >= 0 ? "+" : "") + v.toFixed(d);

function bandDb(band, f, mode) {
  ST.phase = mode;
  const g = E.TYPES[band.type].gain ? band.gain : 0;
  return E.realisedDbAt(E.realiseBand(band, g), f);
}
function analogBandDb(band, f) {
  const g = E.TYPES[band.type].gain ? band.gain : 0;
  return E.analogDb(E.bandSections(band, g), f);
}
function logSweep(lo, hi, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo * Math.pow(hi / lo, i / (n - 1)));
  return out;
}
const MODES = ["zero", "natural", "linear"];
const report = [];

/* ------------------------------------------------------------------ */
/* 1. Bell: exact gain at centre, every mode, every rate              */
for (const sr of [44100, 48000, 96000]) {
  E.setSampleRate(sr);
  for (const f of [30, 100, 1000, 5000, 12000, 18000]) {
    for (const g of [-18, -6, 3, 12]) {
      for (const q of [0.3, 1, 8, 40]) {
        const b = E.mkBand("bell", f, g, q);
        for (const m of MODES) {
          const d = bandDb(b, f, m);
          check(`bell centre ${m} ${sr} f=${f} g=${g} q=${q}`, near(d, g, 0.02), `got ${fmt(d)}`);
        }
      }
    }
  }
}

/* 2. Bell boost/cut symmetry (ZERO is exactly symmetric by construction) */
E.setSampleRate(48000);
for (const f of [200, 3000]) {
  let worst = 0;
  for (const x of logSweep(20, 20000, 200)) {
    const up = bandDb(E.mkBand("bell", f, 9, 1.5), x, "zero");
    const dn = bandDb(E.mkBand("bell", f, -9, 1.5), x, "zero");
    worst = Math.max(worst, Math.abs(up + dn));
  }
  check(`bell symmetry zero f=${f}`, worst < 1e-6, `asymmetry ${worst.toExponential(2)} dB`);
}

/* 3. Shelves: half gain at the corner, full gain on the plateau */
E.setSampleRate(96000);
for (const m of MODES) {
  for (const g of [-12, 6]) {
    const ls = E.mkBand("lowshelf", 200, g, 0.707);
    const hs = E.mkBand("highshelf", 4000, g, 0.707);
    check(`lowshelf corner ${m} g=${g}`, near(bandDb(ls, 200, m), g / 2, 0.02), fmt(bandDb(ls, 200, m)));
    check(`lowshelf plateau ${m} g=${g}`, near(bandDb(ls, 20, m), g, 0.15), fmt(bandDb(ls, 20, m)));
    check(`highshelf corner ${m} g=${g}`, near(bandDb(hs, 4000, m), g / 2, 0.02), fmt(bandDb(hs, 4000, m)));
    check(`highshelf plateau ${m} g=${g}`, near(bandDb(hs, 40000, m), g, 0.3), fmt(bandDb(hs, 40000, m)));
  }
}

/* 4. Tilt: pivots through 0 dB */
for (const m of MODES) {
  const t = E.mkBand("tilt", 1000, 6, 0.6);
  check(`tilt pivot ${m}`, near(bandDb(t, 1000, m), 0, 0.02), fmt(bandDb(t, 1000, m)));
}

/* 5. Cuts: Butterworth -3.01 dB at the corner, and the promised slope */
E.setSampleRate(96000);
const slopeRows = [];
for (const slope of E.SLOPES) {
  for (const m of MODES) {
    const lc = E.mkBand("lowcut", 1000, 0, 0.71, { slope });
    const hc = E.mkBand("highcut", 1000, 0, 0.71, { slope });
    const atFc = bandDb(lc, 1000, m);
    check(`lowcut -3dB ${m} ${slope}`, near(atFc, -3.0103, 0.03), fmt(atFc));
    check(`highcut -3dB ${m} ${slope}`, near(bandDb(hc, 1000, m), -3.0103, 0.03), fmt(bandDb(hc, 1000, m)));
    /* asymptotic slope, measured between 1/16 and 1/32 of the corner */
    const s = bandDb(lc, 1000 / 16, m) - bandDb(lc, 1000 / 32, m);
    check(`lowcut slope ${m} ${slope}`, near(s, slope, slope * 0.03 + 0.1), `${s.toFixed(2)} dB/oct`);
    if (m === "zero") slopeRows.push(`${String(slope).padStart(3)} dB/oct   corner ${fmt(atFc, 2)} dB   measured slope ${s.toFixed(2)} dB/oct`);
  }
}

/* 6. Notch depth, band pass unity peak */
for (const m of MODES) {
  const n = E.mkBand("notch", 1000, 0, 10);
  check(`notch depth ${m}`, bandDb(n, 1000, m) < -60, fmt(bandDb(n, 1000, m), 1));
  const bp = E.mkBand("bandpass", 1000, 0, 2);
  check(`bandpass peak ${m}`, near(bandDb(bp, 1000, m), 0, 0.02), fmt(bandDb(bp, 1000, m)));
}

/* 7. Stability: every digital section's poles strictly inside |z| = 1 */
let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
let unstable = 0, tested = 0, nonFinite = 0;
for (const sr of [44100, 48000, 96000, 192000]) {
  E.setSampleRate(sr);
  for (let i = 0; i < 3000; i++) {
    const types = Object.keys(E.TYPES);
    const b = E.mkBand(types[Math.floor(rand() * types.length)],
      20 * Math.pow(1000, rand()), -24 + 48 * rand(), 0.1 * Math.pow(1000, rand()),
      { slope: E.SLOPES[Math.floor(rand() * E.SLOPES.length)] });
    for (const m of ["zero", "natural"]) {
      ST.phase = m;
      const rb = E.realiseBand(b, E.TYPES[b.type].gain ? b.gain : 0);
      for (const s of rb.secs) {
        tested++;
        if (![s.b0, s.b1, s.b2, s.a1, s.a2].every(Number.isFinite)) { nonFinite++; continue; }
        /* Jury: |a2| < 1 and |a1| < 1 + a2 */
        if (!(Math.abs(s.a2) < 1 && Math.abs(s.a1) < 1 + s.a2)) unstable++;
      }
    }
  }
}
check("stability: all poles inside unit circle", unstable === 0, `${unstable} unstable of ${tested}`);
check("stability: all coefficients finite", nonFinite === 0, `${nonFinite} non-finite`);

/* 8. Cramping: how far ZERO and NATURAL sit from the analogue target */
const cramp = [];
const battery = [
  ["bell 10 kHz +6 dB Q1", E.mkBand("bell", 10000, 6, 1)],
  ["bell 15 kHz +6 dB Q1", E.mkBand("bell", 15000, 6, 1)],
  ["bell 15 kHz -9 dB Q4", E.mkBand("bell", 15000, -9, 4)],
  ["high shelf 12 kHz +6", E.mkBand("highshelf", 12000, 6, 0.707)],
  ["low cut 40 Hz 24 dB", E.mkBand("lowcut", 40, 0, 0.71, { slope: 24 })],
  ["high cut 16 kHz 12 dB", E.mkBand("highcut", 16000, 0, 0.71, { slope: 12 })]
];
for (const sr of [44100, 48000, 96000]) {
  E.setSampleRate(sr);
  for (const [name, b] of battery) {
    let wz = 0, wn = 0;
    for (const f of logSweep(20, Math.min(20000, sr * 0.45), 400)) {
      const a = analogBandDb(b, f);
      wz = Math.max(wz, Math.abs(bandDb(b, f, "zero") - a));
      wn = Math.max(wn, Math.abs(bandDb(b, f, "natural") - a));
    }
    cramp.push({ sr, name, wz, wn });
  }
}
/* NATURAL must beat ZERO wherever ZERO is visibly cramped, and stay tight */
for (const r of cramp) {
  if (r.wz > 0.5) check(`natural beats zero: ${r.name} @${r.sr}`, r.wn < r.wz, `zero ${r.wz.toFixed(2)} / natural ${r.wn.toFixed(2)}`);
}
const natWorst = Math.max(...cramp.filter(r => r.sr >= 48000).map(r => r.wn));
check("natural within 1 dB of analogue to 20 kHz @48k+", natWorst < 1.0, `worst ${natWorst.toFixed(2)} dB`);

/* 9. Dynamics: direction, range limit, attack/release timing */
E.setSampleRate(48000);
{
  const down = E.mkBand("bell", 1000, 0, 1, { dyn: { on: true, range: -6, threshold: -30, attack: 10, release: 100, cur: 0 } });
  const up = E.mkBand("bell", 1000, 0, 1, { dyn: { on: true, range: 6, threshold: -30, attack: 10, release: 100, cur: 0 } });
  check("downward: cuts when loud", E.dynamicTarget(down, -10) < 0, fmt(E.dynamicTarget(down, -10)));
  check("downward: idle when quiet", E.dynamicTarget(down, -50) === 0, fmt(E.dynamicTarget(down, -50)));
  check("upward: boosts when quiet", E.dynamicTarget(up, -50) > 0, fmt(E.dynamicTarget(up, -50)));
  check("upward: idle when loud", E.dynamicTarget(up, -10) === 0, fmt(E.dynamicTarget(up, -10)));
  let worst = 0;
  for (let det = -90; det <= 20; det += 0.5) {
    worst = Math.max(worst, Math.abs(E.dynamicTarget(down, det)), Math.abs(E.dynamicTarget(up, det)));
  }
  check("dynamics never exceed range", worst <= 6 + 1e-9, `peak movement ${worst.toFixed(3)} dB`);

  /* attack: drive with a constant over-threshold input and time to 63% */
  ST.bands = [down]; ST.input = 0;
  for (let i = 0; i < E.NBINS; i++) { E.specDisp[i] = -8; E.specRaw[i] = -8; }       /* loud */
  const tgt = E.dynamicTarget(down, E.detectorLevel(down));
  let t = 0; const dt = 0.0005;
  while (Math.abs(down.dyn.cur) < 0.632 * Math.abs(tgt) && t < 1) { E.updateDynamics(dt); t += dt; }
  check("attack ~ time constant", near(t * 1000, 10, 1.5), `${(t * 1000).toFixed(2)} ms to 63% (set 10 ms)`);
  report.push(`attack  set 10 ms  -> measured ${(t * 1000).toFixed(2)} ms to 63%`);
  for (let i = 0; i < E.NBINS; i++) { E.specDisp[i] = -120; E.specRaw[i] = -120; }     /* silence */
  const startR = down.dyn.cur; t = 0;
  while (Math.abs(down.dyn.cur) > 0.368 * Math.abs(startR) && t < 2) { E.updateDynamics(dt); t += dt; }
  check("release ~ time constant", near(t * 1000, 100, 8), `${(t * 1000).toFixed(2)} ms to 37% (set 100 ms)`);
  report.push(`release set 100 ms -> measured ${(t * 1000).toFixed(2)} ms to 37%`);
}

/* 10. Nodes sit on the composite curve */
E.setSampleRate(96000); ST.phase = "zero";
ST.bands = [E.mkBand("lowcut", 38, 0, 0.71), E.mkBand("bell", 101, 5.9, 0.8), E.mkBand("highshelf", 8000, 6, 0.7)];
for (const b of ST.bands) {
  let expect = 0;
  for (const o of ST.bands) expect += bandDb(o, b.freq, "zero");
  check(`node on curve ${b.type}`, near(E.nodeGainDb(b), expect, 1e-9), `${fmt(E.nodeGainDb(b))} vs ${fmt(expect)}`);
}

/* 11. A/B keeps two independent sound states; undo restores sound only */
{
  ST.bands = [E.mkBand("bell", 1000, 3, 1)]; ST.selected = 0; ST.slot = "A"; ST.slots = { A: E.soundSnap(), B: null };
  ST.analyzerMode = "post";
  /* switch to B the way the UI does */
  ST.slots.A = E.soundSnap(); ST.slots.B = E.soundSnap(); E.loadSound(ST.slots.B); ST.slot = "B";
  ST.bands[0].gain = -9;
  ST.slots.B = E.soundSnap(); E.loadSound(ST.slots.A); ST.slot = "A";
  check("A/B: A keeps its own gain", ST.bands[0].gain === 3, `A gain ${ST.bands[0].gain}`);
  E.loadSound(ST.slots.B);
  check("A/B: B keeps its own gain", ST.bands[0].gain === -9, `B gain ${ST.bands[0].gain}`);
  check("A/B: view state untouched", ST.analyzerMode === "post");
}

/* ------------------------------------------------------------------ */
console.log("\nSHAPE — EQ audit\n");
console.log("Cut slopes (ZERO, 96 kHz, corner 1 kHz)");
slopeRows.forEach(r => console.log("  " + r));
console.log("\nDeviation from the analogue target, 20 Hz - 20 kHz (max |error|, dB)");
console.log("  " + "rate".padEnd(8) + "filter".padEnd(26) + "ZERO".padStart(8) + "NATURAL".padStart(10));
for (const r of cramp) {
  console.log("  " + String(r.sr).padEnd(8) + r.name.padEnd(26) + r.wz.toFixed(2).padStart(8) + r.wn.toFixed(2).padStart(10));
}
console.log("\nDynamics timing");
report.forEach(r => console.log("  " + r));
console.log(`\nStability: ${tested} random sections across 4 rates, ${unstable} unstable, ${nonFinite} non-finite`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:"); failures.slice(0, 40).forEach(f => console.log("  x " + f)); process.exit(1); }
