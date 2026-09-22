# SHAPE — UI System

The executable specification is `design/prototype/shape-ui.html`. Token
values are mirrored in `Source/UI/ShapeTheme.h`. The visual target is
`design/reference/SHAPE_REFERENCE_V3.webp`. The EQ is verified by
`design/prototype/tests/eq-audit.js` (1,000 checks).

---

## 1. Direction

A brushed-aluminium faceplate with a near-black display well milled into
it. The chassis is light, physical and lit from above; the display is dark
and luminous. That contrast is the product's signature, and every token
serves it.

Two earlier directions are kept for the record:
`SHAPE_LOCKED_REFERENCE.webp` is the first target (a luminous all-white
instrument); the current design supersedes it.

---

## 2. What the prototype actually is

A working interface, not a mockup. It implements the real interaction
model — node dragging, Q gestures, band creation and removal, contextual
controls, presets, undo/redo — and it draws its response curve from real
filter coefficients.

It is **not** an audio processor. There is no audio path. Where the plugin
would analyse incoming audio, the prototype synthesises a musical spectrum
with correct analyser ballistics so the display, the dynamics detectors and
the curve all have something truthful to react to. Everything downstream of
that input is computed, not staged.

---

## 3. The curve is computed, never drawn

Each band is described as a cascade of analogue prototype sections; the
PHASE mode decides how they are realised, and the display evaluates
`20·log₁₀|H|` of exactly that realisation at every pixel column.

- **ZERO** — RBJ biquads via the bilinear transform. Exact at the band
  centre, cramped toward Nyquist.
- **NATURAL** — magnitude-matched biquads: impulse-invariant poles, the
  numerator solved to match the analogue magnitude at DC, Nyquist and the
  centre. Still minimum phase, still zero latency, without the cramping
  (3.9 dB → 0.7 dB worst case for a 15 kHz bell at 44.1 kHz).
- **LINEAR** — the analogue target magnitude, which is what a linear-phase
  FIR designed from it reproduces. The PHASE caption shows its latency.

Cuts are Butterworth cascades, −3.01 dB at the corner at every slope. The
POST spectrum is the PRE spectrum through the same response. None of this
is asserted here — `tests/eq-audit.js` measures it.

**Two rulers.** Left is the analyser (±24 dB, 0 = −18 dBFS, the usual
0 VU alignment). Right is the EQ; SCALE sets its range, and its ±scale
ticks sit at three quarters of the half-height, which is where the
reference puts them and where band 3's −4.8 dB reads −4.8.

**Nodes** sit on the composite curve, as the reference draws them.
Dragging is relative, so a node propped up by a neighbour never jumps.

## 3a. Layout and knobs — the family discipline

Layout and knobs follow the family's HEAT reference
(`design/reference/HEAT_FAMILY_REFERENCE.webp`); the display is untouched.

- **One plate, divided by milled grooves.** No inset panels. A groove runs
  under the header and between the band and bottom sections; vertical
  grooves separate every group.
- **Every row shares one centre line.** Each band group has a 30px header
  line — band identity, a FILTER caption, the DYNAMIC toggle — over a
  128px control row, so all seven band knobs sit level at a single 118px
  pitch. In the bottom section the PHASE / SCALE / MODE pills sit exactly
  on the I/O knobs' centre, their captions riding above them.
- **Header:** wordmark, hairline rule, two-line descriptor beside it.
- **Knobs sit flush on the plate.** A flat lathe-turned cap with an
  anisotropic conic sheen, on a cylinder wall, throwing a soft shadow. No
  recessed collar. The value is a rim glow spilling from the knob's edge
  (cyan, amber or violet by role); a long dark indicator runs in from the
  rim. Labels sit above the knob, the readout below. Two sizes only: 62px
  for every band knob, 84px for I/O.
- The cap's fine texture is a noise grain, not concentric rings: rings at
  this size alias into radial spokes.

## 4. Colour

Semantic roles only; values in `ShapeTheme.h`.

```
faceplate   #F2F4F6 → #D4D8DD → #AEB4BB    brushed, lit from above
panel       #E2E5E9 → #D0D5DA              raised band strip
well        #171B21 → #0C0E12              the display
ink         #262B33 / #5B636D / #878F99    on the faceplate
on-dark     #C8CFD8 / #98A1AC              on the display
amber       #FF9E2C   active control, selected band — and nothing else
cyan        #45C2F0   frequency, Q, input/output
violet      #9B7BF0   dynamics
green       #6FC98A   band cycle
```

The curve takes its hue from whichever band is local to that frequency, so
it shifts colour along its length — a horizontal gradient with a stop at
each band's centre frequency. Selection wins over everything: the selected
band's stop and node go amber. That single rule is what lets one node stay
readable against a full spectrum.

**Single theme, by commitment.** This is a hardware faceplate. Inverting it
would produce a different product, so the page paints its background and
every colour explicitly rather than inheriting a host ground.

---

## 5. Typography

**Inter** throughout, carrying four distinct jobs by weight and tracking:
the wordmark at 200 with 0.42em tracking; tracked uppercase labels at 500;
body and dropdowns at 400; numeric readouts at 500 with
`font-variant-numeric: tabular-nums`.

The tabular figures are functional, not stylistic. Proportional numerals
change width as their digits change, so a readout jitters while you drag
it. Tabular digits hold their column and the value stays readable
throughout the gesture.

---

## 6. Interaction

Direct manipulation on the display is the primary interface; the knobs are
for precision, not for primary editing.

| Gesture | Result |
|---|---|
| double-click empty display | create a band there, at that frequency and gain |
| drag node | frequency (x) and gain (y) together |
| shift-drag | fine, at 22% of normal travel |
| scroll over node | Q · on a cut, steps the slope |
| click node | select; the band strip becomes that band |
| alt-click or double-click node | bypass the band (dashed hollow node) |
| `S` | solo the selected band — its region lit, the rest dimmed |
| right-click node, or `delete` | remove the band |
| `[` / `]` | previous / next band |
| ⌘Z / ⌘⇧Z | undo / redo |
| drag knob | value; double-click resets to default |
| arrow keys on a focused knob | step, shift for fine |

Continuous gestures group into a single undo entry. A drag from 400 Hz to
2 kHz is one history step, not four hundred — the spec calls for this, and
it is the difference between a usable history and a useless one.

A hover readout follows the cursor showing frequency and the response at
that point.

---

## 7. Dynamics, on the display

A dynamic band shows three things at once, which is what makes dynamic EQ
legible rather than mysterious:

- its **static position** — where the band sits at rest;
- its **range envelope** — a violet wash between the resting curve and the
  curve at the band's configured limit, so the maximum possible movement
  is visible before anything moves;
- its **current position** — node and curve move within that envelope,
  driven by a per-band detector.

The detector is frequency-selective, weighted by the band's own bandwidth
derived from Q, as the spec requires — not one broadband detector shared
across bands. Attack and release use real time constants, so a 3 ms attack
and a 300 ms release visibly differ. Movement never exceeds the configured
range; that is enforced in the gain calculation, not merely respected by
the drawing.

The violet wash is painted after the fill but *before* the glow and core
strokes, so it tints the ground without veiling the curve.

---

## 8. The two rulers

Left is the **analyser**, ±24 dB, where 0 dB = −18 dBFS (the usual 0 VU
alignment). Horizontal gridlines follow it.

Right is the **EQ**. The curve and nodes are plotted on it, and SCALE sets
its range: at 12 dB it reads +12/+6/0/−6/−12, at 6 dB +6/+3/0/−3/−6, and
the curve zooms to match. Its ±scale ticks sit at three quarters of the
half-height, with a thin rail marking the range — exactly where the
reference puts them, and where a −4.8 dB band reads −4.8.

This is the reverse of the previous pass, which had the EQ on the left and
SCALE only relabelling the right. The reference settles it: band 3's
readout of −4.8 dB matches the right-hand ruler, not the left.

---

## 9. Honest controls

Controls that do nothing are not offered.

- Gain dims for filter types that have none. On a cut, whose cascade is
  Butterworth, the Q knob becomes **SLOPE** (6–96 dB/oct) in the same place.
- The four dynamics knobs dim until the band is actually dynamic.
- The EQ / DYNAMIC / SPECTRAL tabs change *emphasis* rather than pretending
  to be pages: SPECTRAL pushes the curve back so the analyser reads.
  Nothing claims a feature that does not exist.

---

## 10. How this is built

The prototype is assembled from parts, not hand-edited as one 130 KB file:

```
design/prototype/
  build.js          the assembler — run `node design/prototype/build.js`
  shape-ui.html     generated output; do not edit by hand
  parts/
    chassis.html    faceplate, header, preset capsule, footer
    graph.html      the display well and its floating toolbar
    controls.html   band strip and bottom bar layout
    knobs.html      MetalKnob + shape buttons, pill, segmented factories
    engine.js       filter design, state, analyser model, frame loop
    canvas.js       all display drawing
    wiring.js       binds the controls to state
```

`build.js` splits each part into its CSS, JS and markup, emits all CSS
first, the markup in layout order, and all JS last — so nothing runs before
the DOM it binds to exists.

The chassis's button reset is written as `:where(.sh-chassis) button`,
which has zero specificity, so every component's own rules win without
help. (An earlier pass wrote it as `.sh-chassis button` — specificity
0,1,1 — which silently stripped padding, border, background and colour
from every other part's buttons and needed an override block to repair.)

`tests/eq-audit.js` loads `parts/engine.js` directly; run it after any
change to the filter code.

---

## 11. Known limitations

- **No audio.** The PRE spectrum is synthesised.
- **Phase modes are labelled, not implemented.** ZERO / NATURAL / LINEAR
  are stored and displayed; they do not yet change the response, because
  linear-phase FIR design is DSP work, not interface work.
- **MODE (Clean / Analog / Precision) is stored but inert** for the same
  reason — it maps to filter topology in the real plugin.
- Display sample rate is fixed at 48 kHz, which places Nyquist at 24 kHz.
- Band count is capped at 24; the spec's target architecture is 32.
