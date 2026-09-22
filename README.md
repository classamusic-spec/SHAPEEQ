# SHAPE

**Precision Spectral Equalizer** — precision EQ, dynamic EQ and spectral
analysis.

> *Shape the spectrum / reveal the emotion.*

---

## Status

Interface design. **No audio is processed yet.**

This repository contains the interface for SHAPE — designed, built and
inspected — plus the token header and documentation needed to carry that
design into the plugin. The DSP has not been started. See
[`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md) for the honest state of
every subsystem and the environment it was assessed in.

All four core quality gates (Zero, Dynamic, Analyzer, Linear) are
**UNVERIFIED**, so the advanced spectral features remain locked.

---

## The prototype

```
node design/prototype/build.js           # assemble
node design/prototype/tests/eq-audit.js  # measure the EQ: 1,000 checks
open design/prototype/shape-ui.html
```

Or just open the generated `shape-ui.html` directly — no build step, no
dependencies, no server.

It is a working interface, not a picture of one. Double-click the display
to add a band, drag nodes for frequency and gain, scroll for Q, alt-click
to bypass, `delete` to remove. The knobs, shape buttons, presets, phase and
scale selectors, undo/redo and A/B all function.

Its response curve is computed, not drawn, and the PHASE selector is
real: ZERO runs RBJ bilinear biquads, NATURAL runs magnitude-matched
biquads without the cramping near Nyquist, and LINEAR shows the analogue
target a linear-phase FIR reproduces, with its latency. Cuts are
Butterworth cascades, −3.01 dB at the corner at every slope — measured,
not asserted, by `tests/eq-audit.js`. The POST spectrum is the PRE spectrum multiplied by that same
response. The brief's rule — *the canvas must not lie to the user* —
applies to the prototype too.

What it does **not** do is process audio. The analysed spectrum is a
synthesised musical signal with correct analyser ballistics; everything
downstream of it is computed truthfully from that input, but the input is
a model.

---

## Contents

```
design/
  reference/
    SHAPE_REFERENCE_V3.webp        current visual target
    SHAPE_REFERENCE_V2.webp        previous target, same direction
    SHAPE_LOCKED_REFERENCE.webp    superseded first direction
  prototype/
    build.js                       assembler
    shape-ui.html                  generated — do not hand-edit
    parts/                         the seven source parts
    tests/eq-audit.js              filter, stability and dynamics audit
Source/UI/ShapeTheme.h             centralised design tokens
docs/UI_SYSTEM.md                  interface decisions and rationale
docs/DEVELOPMENT_LOG.md            environment, scope, verification
```

`shape-ui.html` is generated. Edit the files in `parts/` and re-run the
assembler; see [`docs/UI_SYSTEM.md`](docs/UI_SYSTEM.md) §10.

---

## Design

A brushed-aluminium faceplate with a near-black display well milled into
it. The chassis is light and physical; the display is dark and luminous.

Colour is semantic and enforced: the curve takes its hue from whichever
band is local to that frequency, cyan carries frequency and Q, violet
carries dynamics, and amber marks the active control and the selected band
— and nothing else. That last rule is what keeps one node readable against
a full spectrum.

Full rationale in [`docs/UI_SYSTEM.md`](docs/UI_SYSTEM.md).

---

## Next

1. Vendor JUCE; stand up a minimal VST3 + Standalone target and compile it.
2. Build the ZERO engine, and assert in tests that the audio path and the
   drawn curve agree. `parts/engine.js` (`designBand`, `cascadeDb`) is a
   working, inspected reference for the coefficient design.
3. Dynamic EQ, Analyzer, Linear Phase — in that order, each behind its gate.
