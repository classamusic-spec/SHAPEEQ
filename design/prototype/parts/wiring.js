/* ==================================================================
   SHAPE — wiring
   Binds the control components to engine state. Every readout on screen
   is derived from state; nothing is hard-coded markup.
   ================================================================== */
"use strict";

var KNOBS = {};
var SEGS = {};
var SHAPE_MAP = ["lowshelf", "bell", "highshelf", "lowcut"];

/* ---------- knob definitions ----------------------------------- */
var KNOB_DEFS = {
  frequency: {
    label: "Frequency", min: 20, max: 20000, curve: "log", accent: "cyan", def: 1000,
    get: function () { return selBand().freq; },
    set: function (v) { selBand().freq = v; },
    format: function (v) { return fmtFreq(v); }
  },
  gain: {
    label: "Gain", min: -24, max: 24, curve: "lin", bipolar: true, accent: "amber", def: 0,
    get: function () { return selBand().gain; },
    set: function (v) { selBand().gain = v; },
    format: function (v) { return fmtDb(v); }
  },
  q: {
    label: "Q", min: 0.1, max: 100, curve: "log", accent: "cyan", def: 1,
    get: function () { return selBand().q; },
    set: function (v) { selBand().q = v; },
    format: fmtQ
  },
  /* a cut has no Q to give the user; the same place offers its slope */
  slope: {
    label: "Slope", min: 0, max: SLOPES.length - 1, curve: "lin", accent: "cyan", def: 1,
    get: function () { return Math.max(0, SLOPES.indexOf(selBand().slope)); },
    set: function (v) { selBand().slope = SLOPES[clamp(Math.round(v), 0, SLOPES.length - 1)]; },
    format: function (v) { return SLOPES[clamp(Math.round(v), 0, SLOPES.length - 1)] + " dB/oct"; }
  },
  threshold: {
    label: "Threshold", min: -60, max: 0, curve: "lin", accent: "violet", def: -24,
    get: function () { return selBand().dyn.threshold; },
    set: function (v) { selBand().dyn.threshold = v; },
    format: function (v) { return v.toFixed(1) + " dB"; }
  },
  range: {
    label: "Range", min: -18, max: 18, curve: "lin", bipolar: true, accent: "violet", def: -6,
    get: function () { return selBand().dyn.range; },
    set: function (v) { selBand().dyn.range = v; },
    format: function (v) { return fmtDb(v); }
  },
  attack: {
    label: "Attack", min: 0.1, max: 500, curve: "log", accent: "violet", def: 10,
    get: function () { return selBand().dyn.attack; },
    set: function (v) { selBand().dyn.attack = v; },
    format: function (v) { return (v < 10 ? v.toFixed(1) : v.toFixed(0)) + " ms"; }
  },
  release: {
    label: "Release", min: 5, max: 5000, curve: "log", accent: "violet", def: 120,
    get: function () { return selBand().dyn.release; },
    set: function (v) { selBand().dyn.release = v; },
    format: function (v) { return v < 1000 ? v.toFixed(0) + " ms" : (v / 1000).toFixed(2) + " s"; }
  },
  input: {
    label: "Input", min: -24, max: 24, curve: "lin", bipolar: true, accent: "cyan", def: 0,
    get: function () { return ST.input; },
    set: function (v) { ST.input = v; },
    format: function (v) { return fmtDb(v); }
  },
  output: {
    label: "Output", min: -24, max: 24, curve: "lin", bipolar: true, accent: "cyan", def: 0,
    get: function () { return ST.output; },
    set: function (v) { ST.output = v; },
    format: function (v) { return fmtDb(v); }
  }
};

/* ---------- helpers ---------------------------------------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function press(el, on) { if (el) el.setAttribute("aria-pressed", on ? "true" : "false"); }

/* knob moves become undo steps: a drag is one step; a burst of wheel or
   arrow-key nudges is one step once it goes quiet                      */
var knobHeld = false, knobIdle = 0;
function knobTouched() {
  if (gestureSnap === null) beginGesture();
  clearTimeout(knobIdle);
  if (!knobHeld) knobIdle = setTimeout(endGesture, 450);
}
window.addEventListener("pointerup", function () {
  if (knobHeld) { knobHeld = false; endGesture(); }
});

function makeKnob(key, mount) {
  var d = KNOB_DEFS[key];
  var k = new MetalKnob({
    label: d.label, min: d.min, max: d.max, value: d.get(), def: d.def,
    curve: d.curve || "lin", bipolar: !!d.bipolar, accent: d.accent,
    size: mount.dataset.size || "md",
    format: d.format,
    onChange: function (v) { knobTouched(); d.set(v); syncReadouts(); }
  });
  k.el.addEventListener("pointerdown", function () { knobHeld = true; beginGesture(); }, true);
  mount.appendChild(k.el);
  KNOBS[key] = k;
  return k;
}

function buildSegmented(mount, options, getter, setter) {
  var values = options.map(function (o) { return o.v; });
  var api = makeSegmented({
    options: options.map(function (o) { return { label: o.label, value: o.v }; }),
    value: Math.max(0, values.indexOf(getter())),
    onChange: function (i, v) { commit(function () { setter(v); }); syncAll(); }
  });
  mount.appendChild(api.el);
  api._sync = function () {
    var i = values.indexOf(getter());
    if (i >= 0) api.set(i, false);
  };
  return api;
}

/* ---------- settings popover -------------------------------------- */
var SETTINGS = {
  sampleRate:    { opts: [[44100, "44.1k"], [48000, "48k"], [96000, "96k"], [192000, "192k"]],
                   set: function (v) { ST.sampleRate = v; setSampleRate(v); } },
  linearQuality: { opts: [["low", "Low"], ["medium", "Med"], ["high", "High"], ["max", "Max"]] },
  anaSpeed:      { opts: [["slow", "Slow"], ["medium", "Medium"], ["fast", "Fast"]] },
  anaTilt:       { opts: [[0, "0 dB"], [3, "3 dB/oct"], [4.5, "4.5 dB/oct"]] },
  autoGain:      { opts: [[false, "Off"], [true, "On"]] }
};
function buildSettings() {
  $$("[data-set]").forEach(function (box) {
    var key = box.dataset.set, def = SETTINGS[key];
    def.opts.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = o[1];
      b.addEventListener("click", function () {
        if (def.set) def.set(o[0]); else ST[key] = o[0];
        syncAll();
      });
      b._v = o[0];
      box.appendChild(b);
    });
  });
  var gear = $("#sh-gear"), pop = $("#sh-settings");
  gear.addEventListener("click", function (e) {
    e.stopPropagation();
    if (pop.hidden) openSettings(); else closeSettings();
  });
  document.addEventListener("pointerdown", function (e) {
    if (!pop.hidden && !pop.contains(e.target) && !gear.contains(e.target)) closeSettings();
  });
}
function openSettings() {
  var gear = $("#sh-gear"), pop = $("#sh-settings"), tools = pop.parentNode;
  pop.hidden = false;
  gear.setAttribute("aria-expanded", "true");
  /* sit the popover's pointer under the gear, whatever the layout */
  var tr = tools.getBoundingClientRect(), gr = gear.getBoundingClientRect();
  var right = tr.right - (gr.left + gr.width / 2) - 32;
  var maxRight = tr.width - 24;
  pop.style.right = clamp(right, -8, maxRight) + "px";
  syncAll();
}
function closeSettings() {
  var pop = $("#sh-settings");
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  $("#sh-gear").setAttribute("aria-expanded", "false");
}

/* ---------- build ------------------------------------------------- */
function buildControls() {
  $$(".sh-knobmount").forEach(function (mount) {
    var key = mount.dataset.knob;
    if (!KNOB_DEFS[key]) return;
    makeKnob(key, mount);
    /* the Q mount also carries the slope knob, shown for cuts */
    if (key === "q") {
      var sm = document.createElement("div");
      sm.dataset.size = mount.dataset.size;
      makeKnob("slope", sm);
      mount.appendChild(KNOBS.slope.el);
    }
  });

  $$(".sh-pillmount").forEach(function (mount) {
    var api = makePill({
      label: "Dynamic",
      on: selBand().dyn.on,
      onChange: function (on) {
        commit(function () { var sb = selBand(); sb.dyn.on = on; if (!on) sb.dyn.cur = 0; });
        syncAll();
      }
    });
    mount.appendChild(api.el);
    KNOBS._dynPill = api;
  });

  var segPhase = $('.sh-segmount[data-seg="phase"]');
  if (segPhase) SEGS.phase = buildSegmented(segPhase,
    [{ v: "zero", label: "Zero" }, { v: "natural", label: "Natural" }, { v: "linear", label: "Linear" }],
    function () { return ST.phase; }, function (v) { ST.phase = v; });
  var segScale = $('.sh-segmount[data-seg="scale"]');
  if (segScale) SEGS.scale = buildSegmented(segScale,
    [{ v: "12", label: "12 dB" }, { v: "6", label: "6 dB" }],
    function () { return String(ST.fineScale); }, function (v) { ST.fineScale = +v; });
  var segMode = $('.sh-segmount[data-seg="mode"]');
  if (segMode) SEGS.mode = buildSegmented(segMode,
    [{ v: "clean", label: "Clean" }, { v: "analog", label: "Analog" }, { v: "precision", label: "Precision" }],
    function () { return ST.mode; }, function (v) { ST.mode = v; });

  var shapeRow = $(".sh-shapebtns");
  if (shapeRow) {
    var shapeApi = makeShapeButtons({
      label: "Filter shape",
      value: Math.max(0, SHAPE_MAP.indexOf(selBand().type)),
      onChange: function (i) {
        commit(function () {
          var sb = selBand();
          sb.type = SHAPE_MAP[i] || "bell";
          if (!TYPES[sb.type].gain) sb.gain = 0;
        });
        syncAll();
      }
    });
    shapeRow.appendChild(shapeApi.el);
    KNOBS._shapes = shapeApi;
  }

  var sel = $(".sh-select");
  if (sel) {
    Object.keys(TYPES).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k; o.textContent = TYPES[k].label;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      commit(function () {
        var sb = selBand();
        sb.type = sel.value;
        if (!TYPES[sb.type].gain) sb.gain = 0;
        if (sb.type === "notch" && sb.q < 4) sb.q = 12;
      });
      syncAll();
    });
  }

  $$("[data-band-nav]").forEach(function (b) {
    b.addEventListener("click", function () {
      var d = b.dataset.bandNav === "next" ? 1 : -1;
      ST.selected = (ST.selected + d + ST.bands.length) % ST.bands.length;
      syncAll();
    });
  });

  $$("#sh-tabs [data-tab]").forEach(function (b) {
    b.addEventListener("click", function () { ST.tab = b.dataset.tab; syncAll(); });
  });
  $$("#sh-anbtns [data-an]").forEach(function (b) {
    b.addEventListener("click", function () { ST.analyzerMode = b.dataset.an; syncAll(); });
  });
  var anToggle = $("#sh-an-toggle");
  if (anToggle) anToggle.addEventListener("click", function () { ST.analyzerOn = !ST.analyzerOn; syncAll(); });

  /* SOLO auditions the selected band; POWER bypasses that band (it used to
     switch the whole EQ off, despite sitting in the band strip); SC keys
     the band's detector from the sidechain input                         */
  var soloBtn = $("[data-act='solo']"), powBtn = $("[data-act='power']"), scBtn = $("[data-act='sc']");
  if (soloBtn) soloBtn.addEventListener("click", function () { ST.solo = !ST.solo; syncAll(); });
  if (powBtn) powBtn.addEventListener("click", function () { commit(function () { selBand().on = !selBand().on; }); syncAll(); });
  if (scBtn) scBtn.addEventListener("click", function () { ST.sidechain = !ST.sidechain; syncAll(); });

  var prev = $("[data-preset='prev']"), next = $("[data-preset='next']"), fav = $("[data-preset='fav']");
  if (prev) prev.addEventListener("click", function () { loadPreset(ST.presetIndex - 1); });
  if (next) next.addEventListener("click", function () { loadPreset(ST.presetIndex + 1); });
  if (fav) fav.addEventListener("click", function () {
    var name = PRESETS[ST.presetIndex].name;
    FAVS[name] = !FAVS[name];
    try { localStorage.setItem("shape.favs", JSON.stringify(FAVS)); } catch (_) {}
    syncAll();
  });
  $$("[data-slot]").forEach(function (b) {
    b.addEventListener("click", function () { switchSlot(b.dataset.slot); });
  });

  buildSettings();
}

var FAVS = {};
try { FAVS = JSON.parse(localStorage.getItem("shape.favs") || "{}") || {}; } catch (_) { FAVS = {}; }

/* ---------- sync -------------------------------------------------- */
function syncReadouts() {
  for (var k in KNOB_DEFS) {
    if (KNOBS[k] && KNOBS[k].set) KNOBS[k].set(KNOB_DEFS[k].get(), false);
  }
}
function syncBandControls() { syncReadouts(); }

/* every frame: things that move on their own */
function syncLive() {
  var note = $("[data-phase-note]");
  var lat = latencySamples();
  var txt = lat ? "· " + (lat / FS * 1000).toFixed(1) + " ms" : "·";
  if (note && note.textContent !== txt) note.textContent = txt;
  var ag = $("[data-set-autogain]");
  if (ag) { var t = ST.autoGain ? fmtDb(autoGainDb()) : ""; if (ag.textContent !== t) ag.textContent = t; }
}

function syncAll() {
  var b = selBand();
  if (!b) return;
  var ty = TYPES[b.type];

  var num = $("[data-band-number]");
  if (num) num.textContent = "BAND " + (ST.selected + 1);
  var dot = $("[data-band-dot]");
  if (dot) dot.dataset.off = b.on ? "0" : "1";

  var sel = $(".sh-select");
  if (sel) sel.value = b.type;
  if (KNOBS._shapes) {
    var si = SHAPE_MAP.indexOf(b.type);
    if (si >= 0) KNOBS._shapes.set(si, false);
    else $$(".sh-shape-btn", KNOBS._shapes.el).forEach(function (x) { x.classList.remove("sh-on"); press(x, false); });
  }

  /* offer only what does something for this type */
  setKnobEnabled("gain", ty.gain);
  if (KNOBS.q && KNOBS.slope) {
    KNOBS.q.el.hidden = !!ty.slope;
    KNOBS.slope.el.hidden = !ty.slope;
    setKnobEnabled("q", ty.q);
  }
  ["threshold", "range", "attack", "release"].forEach(function (k) { setKnobEnabled(k, b.dyn.on); });
  if (KNOBS._dynPill) KNOBS._dynPill.set(b.dyn.on, false);

  for (var s in SEGS) if (SEGS[s] && SEGS[s]._sync) SEGS[s]._sync();

  $$("#sh-tabs [data-tab]").forEach(function (x) { press(x, x.dataset.tab === ST.tab); });
  $$("#sh-anbtns [data-an]").forEach(function (x) { press(x, x.dataset.an === ST.analyzerMode); });
  var anToggle = $("#sh-an-toggle");
  if (anToggle) press(anToggle, ST.analyzerOn);
  var anGroup = $("#sh-anbtns");
  if (anGroup) anGroup.dataset.off = ST.analyzerOn ? "0" : "1";

  toggleAct("solo", ST.solo);
  toggleAct("power", b.on);
  toggleAct("sc", ST.sidechain);

  var p = PRESETS[ST.presetIndex];
  var pn = $("[data-preset-name]"), pt = $("[data-preset-tag]"), fav = $("[data-preset='fav']");
  if (pn) pn.textContent = p.name;
  if (pt) pt.textContent = p.tag;
  if (fav) press(fav, !!FAVS[p.name]);
  $$("[data-slot]").forEach(function (x) {
    var on = x.dataset.slot === ST.slot;
    press(x, on); x.classList.toggle("is-on", on);
  });

  /* settings */
  $$("[data-set]").forEach(function (box) {
    var key = box.dataset.set;
    $$("button", box).forEach(function (btn) { press(btn, btn._v === ST[key]); });
  });
  var lt = $("[data-set-linear]");
  if (lt) {
    var n = (LINEAR_TAPS[ST.linearQuality] || 4096) * (FS / 48000);
    lt.textContent = n + " taps · " + (n / 2 / FS * 1000).toFixed(1) + " ms";
  }
  var sl = $("[data-set-latency]");
  if (sl) { var ls = latencySamples(); sl.textContent = ls ? ls + " samples latency" : "zero latency"; }

  syncReadouts();
  syncLive();
}

function setKnobEnabled(key, on) {
  var k = KNOBS[key];
  if (!k || !k.el) return;
  k.el.classList.toggle("is-disabled", !on);
  k.el.setAttribute("aria-disabled", on ? "false" : "true");
  k.el.style.opacity = on ? "" : "0.34";
  k.el.style.pointerEvents = on ? "" : "none";
}
function toggleAct(name, on) {
  var el = $("[data-act='" + name + "']");
  if (!el) return;
  press(el, on);
  el.classList.toggle("is-on", on);
}
