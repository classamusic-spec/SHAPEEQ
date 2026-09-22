/* ==================================================================
   SHAPE — wiring
   Binds the control components to engine state. Every readout on screen
   is derived from state; nothing is hard-coded markup.
   ================================================================== */
"use strict";

var KNOBS = {};
var SEGS = {};

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
    format: function (v) { return v < 10 ? v.toFixed(2) : v.toFixed(1); }
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
    label: "Input", min: -24, max: 24, curve: "lin", bipolar: true, accent: "cyan", size: "lg", def: 0,
    get: function () { return ST.input; },
    set: function (v) { ST.input = v; },
    format: function (v) { return fmtDb(v); }
  },
  output: {
    label: "Output", min: -24, max: 24, curve: "lin", bipolar: true, accent: "cyan", size: "lg", def: 0,
    get: function () { return ST.output; },
    set: function (v) { ST.output = v; },
    format: function (v) { return fmtDb(v); }
  }
};

/* ---------- small helpers -------------------------------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function press(el, on) { if (el) el.setAttribute("aria-pressed", on ? "true" : "false"); }

/* Build a segmented control into a mount. Emits markup that satisfies
   either `.sh-seg button` or `.sh-seg-btn` styling conventions. */
var SHAPE_MAP = ["lowshelf", "bell", "highshelf", "lowcut"];

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

/* ---------- build ---------------------------------------------- */
function buildControls() {
  /* --- knobs --- */
  $$(".sh-knobmount").forEach(function (mount) {
    var key = mount.dataset.knob;
    var d = KNOB_DEFS[key];
    if (!d) return;
    var k = new MetalKnob({
      label: d.label,
      min: d.min, max: d.max,
      value: d.get(),
      curve: d.curve || "lin",
      bipolar: !!d.bipolar,
      accent: d.accent,
      size: mount.dataset.size || d.size || "md",
      format: d.format,
      onChange: function (v) { d.set(v); syncReadouts(); }
    });
    /* group a whole drag into one undo entry */
    k.el.addEventListener("pointerdown", beginGesture);
    k.el.addEventListener("pointerup", endGesture);
    k.el.addEventListener("dblclick", function () {
      commit(function () { d.set(d.def); });
      syncAll();
    });
    mount.appendChild(k.el);
    KNOBS[key] = k;
  });

  /* --- DYNAMIC pill --- */
  $$(".sh-pillmount").forEach(function (mount) {
    var api = makePill({
      label: "Dynamic",
      on: selBand().dyn.on,
      onChange: function (on) {
        commit(function () {
          var sb = selBand();
          sb.dyn.on = on;
          if (!on) sb.dyn.cur = 0;
        });
        syncAll();
      }
    });
    mount.appendChild(api.el);
    KNOBS._dynPill = api;
  });

  /* --- segmented groups --- */
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

  /* --- filter shape buttons --- */
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

  /* --- type dropdown --- */
  var sel = $(".sh-select");
  if (sel) {
    sel.innerHTML = "";
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

  /* --- band prev / next --- */
  $$("[data-band-nav]").forEach(function (b) {
    b.addEventListener("click", function () {
      var d = b.dataset.bandNav === "next" ? 1 : -1;
      ST.selected = (ST.selected + d + ST.bands.length) % ST.bands.length;
      syncAll();
    });
  });

  /* --- graph toolbar --- */
  $$("#sh-tabs button").forEach(function (b) {
    b.addEventListener("click", function () { ST.tab = b.dataset.tab; syncAll(); });
  });
  $$("#sh-anbtns button[data-an]").forEach(function (b) {
    b.addEventListener("click", function () { ST.analyzerMode = b.dataset.an; syncAll(); });
  });
  var anToggle = $("#sh-an-toggle");
  if (anToggle) anToggle.addEventListener("click", function () {
    ST.analyzerOn = !ST.analyzerOn; syncAll();
  });

  /* --- right-hand button column --- */
  var soloBtn = $("[data-act='solo']"), powBtn = $("[data-act='power']"), scBtn = $("[data-act='sc']");
  if (soloBtn) soloBtn.addEventListener("click", function () { commit(function () { ST.solo = !ST.solo; }); syncAll(); });
  if (powBtn) powBtn.addEventListener("click", function () { commit(function () { ST.power = !ST.power; }); syncAll(); });
  if (scBtn) scBtn.addEventListener("click", function () { commit(function () { ST.sidechain = !ST.sidechain; }); syncAll(); });

  /* --- header: presets, A/B --- */
  var prev = $("[data-preset='prev']"), next = $("[data-preset='next']"), fav = $("[data-preset='fav']");
  if (prev) prev.addEventListener("click", function () { loadPreset(ST.presetIndex - 1); });
  if (next) next.addEventListener("click", function () { loadPreset(ST.presetIndex + 1); });
  if (fav) fav.addEventListener("click", function () {
    fav.setAttribute("aria-pressed", fav.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });
  $$("[data-slot]").forEach(function (b) {
    b.addEventListener("click", function () { commit(function () { ST.slot = b.dataset.slot; }); syncAll(); });
  });
}

/* ---------- sync ----------------------------------------------- */
/* cheap: called every frame and during drags */
function syncReadouts() {
  for (var k in KNOBS) {
    if (k.charAt(0) === "_") continue;
    var d = KNOB_DEFS[k];
    if (d && KNOBS[k] && !KNOBS[k].dragging) KNOBS[k].set(d.get());
  }
}
function syncBandControls() { syncReadouts(); }

/* full: called on structural changes */
function syncAll() {
  var b = selBand();
  if (!b) return;
  var ty = TYPES[b.type];

  /* band identity */
  var num = $("[data-band-number]");
  if (num) num.textContent = "BAND " + (ST.selected + 1);

  /* type dropdown + shape buttons */
  var sel = $(".sh-select");
  if (sel) sel.value = b.type;
  if (KNOBS._shapes) {
    var si = SHAPE_MAP.indexOf(b.type);
    if (si >= 0) KNOBS._shapes.set(si, false);
  }

  /* knob availability — controls that do nothing are not offered */
  setKnobEnabled("gain", ty.gain);
  setKnobEnabled("q", ty.q);
  ["threshold", "range", "attack", "release"].forEach(function (k) {
    setKnobEnabled(k, b.dyn.on);
  });

  /* dynamic pill */
  if (KNOBS._dynPill) KNOBS._dynPill.set(b.dyn.on, false);

  /* segmented groups */
  for (var s in SEGS) if (SEGS[s] && SEGS[s]._sync) SEGS[s]._sync();

  /* graph toolbar */
  $$("#sh-tabs button").forEach(function (x) { press(x, x.dataset.tab === ST.tab); });
  $$("#sh-anbtns button[data-an]").forEach(function (x) { press(x, x.dataset.an === ST.analyzerMode); });
  var anToggle = $("#sh-an-toggle");
  if (anToggle) press(anToggle, ST.analyzerOn);

  /* right column */
  toggleAct("solo", ST.solo);
  toggleAct("power", ST.power);
  toggleAct("sc", ST.sidechain);

  /* header */
  var p = PRESETS[ST.presetIndex];
  var pn = $("[data-preset-name]"), pt = $("[data-preset-tag]");
  if (pn) pn.textContent = p.name;
  if (pt) pt.textContent = p.tag;
  $$("[data-slot]").forEach(function (x) {
    var on = x.dataset.slot === ST.slot;
    press(x, on);
    x.classList.toggle("is-on", on);
  });

  syncReadouts();
}

function setKnobEnabled(key, on) {
  var k = KNOBS[key];
  if (!k || !k.el) return;
  k.el.classList.toggle("is-disabled", !on);
  k.el.setAttribute("aria-disabled", on ? "false" : "true");
  if (k.el.style) { k.el.style.opacity = on ? "" : "0.32"; k.el.style.pointerEvents = on ? "" : "none"; }
}
function toggleAct(name, on) {
  var el = $("[data-act='" + name + "']");
  if (!el) return;
  press(el, on);
  el.classList.toggle("is-on", on);
}
