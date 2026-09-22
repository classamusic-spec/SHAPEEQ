# SHAPE — UI System

The executable specification is `design/prototype/shape-ui.html`. Token
values are mirrored in `Source/UI/ShapeTheme.h`. The visual target is
`design/reference/SHAPE_REFERENCE_V2.webp`.

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

The product spec is unambiguous: *"the canvas is part of the metrology of
the product. It must not lie to the user."*

For every band the prototype designs real RBJ-cookbook biquad sections,
cascades them, and evaluates

```
H_total(f) = H₁(f) · H₂(f) · … · Hₙ(f)
20·log₁₀|H(e^jω)|   at every pixel column
```

What falls out of doing it properly rather than approximating:

- Cut filters cascade genuine Butterworth sections — a first-order
  bilinear-transformed section for odd orders, biquads at the correct
  section Q for the rest. 6 through 96 dB/oct all behave correctly,
  including the asymmetry of the odd slopes.
- Tilt shelf is a low shelf at −G cascaded with a high shelf at +G, so it
  pivots where it should.
- The response flattens at Nyquist instead of mirroring, and the region
  above it is shaded rather than quietly drawn as if it meant something.
- The POST spectrum is the PRE spectrum multiplied by that same computed
  response. Drag a node and it moves, because it is the same number.

Verified against the rendered output: the 512 Hz band's node lands on the
500 Hz gridline, the 36 Hz low cut's at ~37 Hz.

---

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
| scroll over node | Q |
| click node | select; the band strip becomes that band |
| alt-click node | bypass the band (ring drops to 35%, glow goes) |
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

The left ruler is EQ gain, fixed at ±24 dB. The right is a finer gain
ruler on the same pixel rows, whose range the SCALE control picks.

It is not a level meter, and its ticks are **derived** from the SCALE
setting rather than hard-coded — at 12 dB it reads +12/+6/0/−6/−12, at
6 dB it reads +6/+3/0/−3/−6 on the same rows. A fixed tick list would have
printed numbers that disagreed with the gridlines they sat on at any
setting but the default.

The analyser has its own mapping across the well and is deliberately not
given an axis, because it is a relative display.

---

## 9. Honest controls

Controls that do nothing are not offered.

- Gain dims for filter types that have none; Q dims for cut filters, whose
  cascade is Butterworth and whose Q is not the user's to set.
- The four dynamics knobs dim until the band is actually dynamic.
- The EQ / DYNAMIC / SPECTRAL tabs change *emphasis* rather than pretending
  to be pages: SPECTRAL pushes the curve back so the analyser reads.
  Nothing claims a feature that does not exist.

---

## 10. How this is built

The prototype is assembled from parts, not hand-edited as one 109 KB file:

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
the DOM it binds to exists. It ends with an integration-override block that
reconciles parts authored independently; the notable one repairs a cascade
collision where the chassis's `.sh-chassis button` reset (0,1,1) outranked
the other parts' single-class button rules (0,1,0) and stripped their
padding, border, background and colour.

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
