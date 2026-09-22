# SHAPE — Development Log

---

## 2026-09-22 · Phase 0 — environment inspection

Recorded before any code was written, as the build brief requires.

### Host

| | |
|---|---|
| OS | Linux 6.18.44 (Ubuntu 24.04 userland), x86-64 |
| CMake | 3.28.3 |
| GCC | 13.3.0 |
| Clang | 18.1.3 |
| Ninja | 1.11.1 |
| Node | 22.22.2 |
| Chromium | 1194 (headless, used for visual inspection) |

### Not available

| Missing | Consequence |
|---|---|
| **JUCE** | No copy anywhere on the filesystem. No plugin target can be configured or built until JUCE is vendored or fetched. |
| **pluginval** | No host validation possible. |
| **VST3 / AAX SDKs** | Not present. |
| ffmpeg, cwebp, ImageMagick, PIL | No image conversion. References are stored in their original `.webp` rather than the `.png` the brief names. |
| Audio device / test assets | No impulse, sweep or musical material, and no audio I/O. |

The repository was empty at session start — no commits, no source tree, no
build system.

### Scope actually undertaken

The instruction was specific: rework the interface against the supplied
reference. That is what was built. No DSP, no plugin target, no C++
compilation was attempted.

Stated plainly so the log is not misread later: **nothing in this commit
processes audio.**

---

## 2026-09-22 · Interface, first direction (superseded)

Built against `design/reference/SHAPE_LOCKED_REFERENCE.webp` — a luminous
all-white instrument — with a brief to simplify. Delivered, inspected,
then superseded when a second reference arrived setting a different
direction. The reference is retained; the implementation was replaced.

---

## 2026-09-22 · Interface, current direction

Target: `design/reference/SHAPE_REFERENCE_V2.webp` — a brushed-aluminium
faceplate with a near-black display well milled into it.

### How it was built

Four agents worked in parallel on independent parts, against one locked
token block issued up front so their output would compose:

| Part | Scope |
|---|---|
| `parts/chassis.html` | faceplate, header, preset capsule, footer |
| `parts/canvas.js` | all display drawing |
| `parts/knobs.html` | `MetalKnob` plus shape-button, pill and segmented factories |
| `parts/controls.html` | band strip and bottom bar layout |

Three further parts were written directly, being the pieces every other
part depends on: `parts/engine.js` (filter design, state, analyser model,
interaction, frame loop), `parts/graph.html` (the well and its floating
toolbar) and `parts/wiring.js` (binding controls to state). `build.js`
assembles all seven.

### Integration defects found and fixed

Parts authored independently collide in predictable ways. Each of these
was found by rendering and reading the result, not by assumption:

1. **Cascade collision.** The chassis part's `.sh-chassis button` reset
   (specificity 0,1,1) outranked the other parts' single-class button
   rules (0,1,0), stripping padding, border, background and colour from
   every toolbar button, segmented control, pill and shape button.
   Repaired at (0,2,0) in the assembler's override block.
2. **`color: inherit`** in that same reset handed the display's toolbar
   buttons dark chassis ink on a near-black panel, making inactive labels
   effectively invisible.
3. **Mapping conflict I introduced.** After briefing the canvas agent I
   repurposed `yOfFs` as the right-hand fine gain ruler and added
   `yOfLevel` for the analyser. The spectrum was still calling `yOfFs`.
4. **Doubled gutter.** Chassis gave `#mount-body` padding while the graph
   part carried its own margin.
5. **Knob mounts** reserved 56px before the knob's real cell width existed.
6. **Toolbar overlapped the axes.** Canvas top padding raised 18 → 52 px so
   the plot starts below the floating toolbar.
7. **State-class mismatch.** The control factories mark state with
   `.sh-on`; the wiring was toggling `.is-on` and setting `aria-pressed`.
   Resolved by rewriting the wiring onto the factories' own APIs.

The canvas agent independently found and fixed a real bug in its own
brief: the right-hand ruler's tick list had been specified as a fixed
+12/+6/0/−6/−12, which would have printed numbers disagreeing with the
gridlines they sat on at any SCALE setting but the default. Ticks are now
derived from `ST.fineScale`.

### Verified

- Rendered headlessly in Chromium at 2× device pixel ratio and inspected
  across three iterations.
- Frequency mapping confirmed against rendered output: the 512 Hz band's
  node falls on the 500 Hz gridline, the 36 Hz low cut's at ~37 Hz.
- `design/prototype/build.js` reproduces `shape-ui.html` from `parts/`.
- No JavaScript errors at load (Chromium console clean; the only network
  errors are Google Fonts, blocked by the sandbox, which resolve when the
  page is served normally).

### Not verified — environment limitation

- **No compilation of any kind was performed.** `Source/UI/ShapeTheme.h`
  has not been compiled, because there is no JUCE to compile it against.
- No DSP was measured, because none exists.
- No interaction was exercised by a real pointer; the headless renders are
  static first frames. Drag, wheel and keyboard paths are written and
  reviewed but not click-tested.

### Core quality gates

| Gate | Status |
|---|---|
| ZERO | **UNVERIFIED** — not started |
| DYNAMIC | **UNVERIFIED** — not started |
| ANALYZER | **UNVERIFIED** — not started |
| LINEAR | **UNVERIFIED** — not started |

All four unverified, so per the brief's own lock, spectral resonance
suppression and EQ Match remain **LOCKED**. Neither was implemented, and
no placeholder for either was created.

### Next, in the brief's mandated order

1. Vendor JUCE and stand up the smallest clean VST3 + Standalone target.
   Compile it. Fix every blocker before proceeding.
2. Begin ZERO. `parts/engine.js` (`designBand`, `cascadeDb`) is a working,
   inspected reference for the coefficient design and the magnitude
   evaluation — the C++ should agree with it, and the sweep tests should
   assert that the audio path and the drawn curve agree.

---

## 2026-09-22 · EQ audit and third interface pass

Target: `design/reference/SHAPE_REFERENCE_V3.webp`.

### Correction to the previous entry

The previous entry and `docs/UI_SYSTEM.md` said the 6–96 dB/oct cuts
"all behave correctly, including the asymmetry of the odd slopes". That
was never measured, and it was false. **The 18 dB/oct cut was wrong in
every commit before this one:** −7.78 dB at its corner instead of
−3.01 dB. `butterworthQs` applied the even-order pole formula to odd
orders, giving the 2nd-order section Q = 0.577 instead of 1.0. The audit
below found it; it is fixed.

### The audit is now a test, not a claim

`design/prototype/tests/eq-audit.js` loads the real `parts/engine.js`
into a sandbox and checks it against independent expectations — closed-
form analogue magnitudes, Butterworth theory, the Jury stability test —
never against itself. Run it with `node design/prototype/tests/eq-audit.js`.

**1,000 checks, 0 failures.** Highlights:

- Bell gain exact at centre (±0.02 dB) in all three phase modes, at
  44.1 / 48 / 96 kHz, 30 Hz – 18 kHz, −18…+12 dB, Q 0.3…40.
- Shelves: exactly half gain at the corner, full gain on the plateau.
- Every cut, 6–96 dB/oct: −3.01 dB at the corner; measured asymptotic
  slope within 0.4% of nominal (e.g. 96 → 96.33 dB/oct).
- 40,330 random sections across 4 rates: 0 unstable, 0 non-finite.
- Dynamics: attack set 10 ms measures 10.00 ms to 63%; release set
  100 ms measures 100.00 ms to 37%; movement never exceeds RANGE.
- Nodes lie exactly on the composite curve; A/B keeps two independent
  sound states and leaves view state alone.

### Phase modes are now real

| Mode | Realisation | Latency |
|---|---|---|
| ZERO | RBJ biquads, bilinear transform | 0 |
| NATURAL | magnitude-matched biquads — impulse-invariant poles, numerator solved to hit the analogue magnitude at DC, Nyquist and centre | 0 |
| LINEAR | the analogue target magnitude, as a linear-phase FIR reproduces it | half the FIR (1k–8k taps at 48 kHz, scaled with rate) |

Worst deviation from the analogue target, 20 Hz–20 kHz:

| | ZERO | NATURAL |
|---|---|---|
| bell 15 kHz +6 dB Q1 @ 44.1k | 3.92 dB | 0.67 dB |
| high cut 16 kHz 12 dB @ 44.1k | 13.30 dB | 0.63 dB |
| bell 15 kHz −9 dB Q4 @ 48k | 3.32 dB | 0.34 dB |

Three defects found in NATURAL while building it, all fixed and covered
by the test: deep cuts near Nyquist missed their centre gain (fixed by
designing the boost and inverting it — exact, because these prototypes
are boost/cut symmetric); high-pass slopes decayed toward 6 dB/oct far
below the corner (fixed by giving each section its double zero at DC);
and inverting a high-shelf boost whose pole had to be clamped below
Nyquist produced marginally unstable cuts (fixed by falling back to the
bilinear section for that one case — stable, still exact at centre).

### Functional bugs fixed

1. A/B flipped a letter and stored nothing. It now keeps two sound states.
2. The band strip's power button switched the whole EQ off. It now
   bypasses the band it sits beside.
3. SCALE relabelled a ruler without zooming anything. The reference
   shows the curve is plotted on the right-hand ruler (band 3 at −4.8 dB
   reads −4.8 there), so SCALE now sets the EQ's vertical range.
4. Shelf and tilt nodes floated off the curve. Nodes now sit on the
   composite curve, and dragging is relative so they never jump.
5. Turning the analyser off froze dynamic EQ — the detector read the
   display buffer. The analyser model now always runs; the detector reads
   the raw frame, with its own attack and release rather than the display's.
6. The detector summed log-spaced bins, so its level scaled with bin
   count rather than bandwidth and wide bands pinned at full range.
7. UPWARD dynamics boosted loud material; the spec defines upward as
   boosting quiet material. Fixed, with an explicit 2:1, 6 dB knee.
8. Solo replaced the curve with one band. It now highlights the band's
   region and leaves the EQ drawn as it is.
9. Undo restored view settings (tab, analyser source). It now captures
   sound state only.
10. Input, output, the gear, the favourite heart and cut slope did
    nothing. Input trims the analyser and detectors, output and auto gain
    move the POST trace, the gear opens settings, the heart persists, and
    a cut's Q knob becomes SLOPE.

### Interface

Rebuilt against the new reference: SVG wordmark with the crossbar-less
A, bezelled preset capsule with segmented ends, joined display toolbars,
a dense synthesised spectrum calibrated against levels measured off the
reference, jewelled nodes with a hollow amber selection, knobs 50% larger
with a recessed LED collar and full-face brushed reflections, a
peach-lit filter-shape group, bronze pill selectors, and milled grooves
between every bottom-bar group. The cascade collision from the last pass
is now fixed at its root: the chassis reset sits inside `:where()`, so
it has zero specificity and the override block is gone.

24 interaction checks were driven headlessly (A/B, power, slope swap,
undo, phase, scale, presets, settings, add/delete band, node drag, POST,
analyser off): all pass, no runtime errors.

### Still true

No audio is processed; the spectrum is synthesised. MODE (Clean / Analog /
Precision) and SC are stored and displayed but inert. `ShapeTheme.h` has
still never been compiled. All four core quality gates remain
**UNVERIFIED**, so the spectral features stay locked.
