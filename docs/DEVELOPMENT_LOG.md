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
