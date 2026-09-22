/* ===========================================================================
   SHAPE — display renderer
   Pure drawing. No state, no listeners, no DOM. Every function saves and
   restores the context, so nothing leaks between passes.

   Two rulers share the plot, exactly as the reference draws them:
     left   the analyser, +/-24 dB (0 = -18 dBFS)       -> yOfAna / yOfLevel
     right  the EQ, whose range the SCALE control picks -> yOfDb
   =========================================================================== */

var _C = {
  bgTop: "#161B22", bgBot: "#0A0D11",
  gridMajor: "rgba(168,188,214,.085)", gridMinor: "rgba(168,188,214,.040)",
  gridH: "rgba(168,188,214,.060)", zero: "rgba(226,234,244,.34)",
  axis: "rgba(196,206,218,.62)", axisDim: "rgba(196,206,218,.42)",
  amber: "#FF9E2C", cyan: "#45C2F0", violet: "#9B7BF0", green: "#6FC98A", orange: "#FFA53D",
  blue: "#3FA0F0"
};
/* the band hue cycle, ordered so neighbours never share a hue */
var _PALETTE = ["#45C2F0", "#9B7BF0", "#FFA53D", "#3FA0F0", "#6FC98A", "#9B7BF0", "#45C2F0"];
var _FONT = "Inter, system-ui, -apple-system, sans-serif";
var _TAU = Math.PI * 2;

var _LABEL_F = { 20: "20", 50: "50", 100: "100", 200: "200", 500: "500",
                 1000: "1k", 2000: "2k", 5000: "5k", 10000: "10k", 20000: "20k" };
var _GRID_F = (function () {
  var out = [], d, m;
  for (d = 10; d <= 10000; d *= 10) for (m = 1; m <= 9; m++) out.push(m * d);
  out.push(20000);
  return out.filter(function (f) { return f >= 15 && f <= 28000; });
})();

function _clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function _rgba(hex, a) {
  var n = parseInt(String(hex).replace("#", ""), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}
function _mix(hex, withHex, t) {
  var a = parseInt(hex.slice(1), 16), b = parseInt(withHex.slice(1), 16);
  var r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  var g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  var bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return "rgb(" + r + "," + g + "," + bl + ")";
}
function _rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---- hue ---------------------------------------------------------------- */
/* Selection wins: amber marks the current band and nothing else, which is
   what keeps one node readable against a full spectrum. A dynamic band is
   violet. Otherwise a band takes its place in the cycle.                    */
function bandHue(band, i, selectedIndex) {
  var sel = typeof selectedIndex === "number" ? selectedIndex : cur().selected;
  if (i === sel) return _C.amber;
  if (band.dyn && band.dyn.on) return _C.violet;
  /* a low cut reads as cyan, the top band as green, as in the reference */
  if (band.type === "lowcut") return _C.cyan;
  var n = cur().bands.length;
  if (i === n - 1 && band.freq > 8000) return _C.green;
  return _PALETTE[i % _PALETTE.length];
}

/* ---- the well: ground, grid, zero line ---------------------------------- */
function drawWell(ctx, p) {
  ctx.save();
  var g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, _C.bgTop);
  g.addColorStop(1, _C.bgBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CW, CH);

  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
  ctx.lineWidth = 1;

  for (var i = 0; i < _GRID_F.length; i++) {
    var f = _GRID_F[i], x = Math.round(xOfF(f)) + 0.5;
    ctx.strokeStyle = _LABEL_F[f] ? _C.gridMajor : _C.gridMinor;
    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
  }
  for (var v = -ANA_RANGE; v <= ANA_RANGE; v += 6) {
    if (v === 0) continue;
    var y = Math.round(yOfAna(v)) + 0.5;
    ctx.strokeStyle = _C.gridH;
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
  }
  /* above Nyquist there is no defined response: shade it, quietly */
  var nx = xOfF(NYQ);
  if (nx < p.x + p.w) {
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(nx, p.y, p.x + p.w - nx, p.h);
  }
  ctx.restore();
}
function drawZeroLine(ctx, p) {
  ctx.save();
  var y = Math.round(yOfDb(0)) + 0.5;
  var g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
  g.addColorStop(0, "rgba(226,234,244,.20)");
  g.addColorStop(0.08, _C.zero);
  g.addColorStop(0.92, _C.zero);
  g.addColorStop(1, "rgba(226,234,244,.20)");
  ctx.strokeStyle = g; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
  ctx.restore();
}

/* ---- rulers ------------------------------------------------------------- */
function drawAxes(ctx, p) {
  ctx.save();
  ctx.font = "400 10px " + _FONT;
  ctx.fillStyle = _C.axis;

  /* left: analyser */
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (var v = ANA_RANGE; v >= -ANA_RANGE; v -= 6) {
    ctx.fillText((v > 0 ? "+" : "") + v, p.x - 12, yOfAna(v));
  }

  /* right: the EQ, with its unit on top and a rail spanning its range */
  var S = ST.fineScale, rx = p.x + p.w + 12;
  ctx.textAlign = "left";
  ctx.fillText("dB", rx, yOfAna(ANA_RANGE));
  var ticks = [S, S / 2, 0, -S / 2, -S];
  for (var i = 0; i < ticks.length; i++) {
    var t = ticks[i];
    ctx.fillText((t > 0 ? "+" : "") + (Math.abs(t) % 1 ? t.toFixed(1) : t), rx, yOfDb(t));
  }
  ctx.strokeStyle = "rgba(196,206,218,.22)"; ctx.lineWidth = 1;
  var railX = Math.round(p.x + p.w + 4) + 0.5;
  ctx.beginPath(); ctx.moveTo(railX, yOfDb(S * 1.1)); ctx.lineTo(railX, yOfDb(-S * 1.1)); ctx.stroke();

  /* bottom: frequency */
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (var f in _LABEL_F) ctx.fillText(_LABEL_F[f], xOfF(+f), p.y + p.h + 12);
  ctx.restore();
}

/* ---- analyser ----------------------------------------------------------- */
function _specPath(ctx, p, arr, offsetFn) {
  var top = Math.min(FMAX, NYQ), started = false, first = 0, last = 0;
  for (var i = 0; i < NBINS; i++) {
    var f = binF[i];
    if (f > top) break;
    var x = p.x + binT[i] * p.w;
    var lv = arr[i] + ST.input + anaTiltAt(f) + (offsetFn ? offsetFn(f) : 0);
    var y = _clamp(yOfLevel(lv), p.y - 40, p.y + p.h + 40);
    if (!started) { ctx.moveTo(x, y); first = x; started = true; } else ctx.lineTo(x, y);
    last = x;
  }
  return started ? { first: first, last: last } : null;
}
function drawSpectrum(ctx, p) {
  ctx.save();
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
  var floorY = p.y + p.h + 2;

  ctx.beginPath();
  var span = _specPath(ctx, p, specDisp, null);
  if (!span) { ctx.restore(); return; }
  ctx.lineTo(span.last, floorY); ctx.lineTo(span.first, floorY); ctx.closePath();
  var g = ctx.createLinearGradient(0, p.y + p.h * 0.25, 0, floorY);
  g.addColorStop(0, "rgba(186,196,210,.34)");
  g.addColorStop(0.55, "rgba(150,160,176,.20)");
  g.addColorStop(1, "rgba(110,120,136,.08)");
  ctx.fillStyle = g;
  ctx.fill();

  ctx.lineWidth = 1; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(214,221,230,.52)";
  ctx.beginPath(); _specPath(ctx, p, specDisp, null); ctx.stroke();
  ctx.restore();
}
/* POST: the same bins through the computed response, then the output
   trim and auto gain — it moves when a node moves, because it is the
   same number the curve is drawn from                                   */
function drawSpectrumPost(ctx, p) {
  ctx.save();
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
  var post = function (f) { return respAtF(f) + ST.output + autoGainDb(); };
  var both = ST.analyzerMode === "both";
  if (!both) {
    ctx.beginPath();
    var span = _specPath(ctx, p, specDisp, post);
    if (span) {
      ctx.lineTo(span.last, p.y + p.h + 2); ctx.lineTo(span.first, p.y + p.h + 2); ctx.closePath();
      var g = ctx.createLinearGradient(0, p.y + p.h * 0.25, 0, p.y + p.h);
      g.addColorStop(0, "rgba(155,123,240,.24)");
      g.addColorStop(1, "rgba(155,123,240,.04)");
      ctx.fillStyle = g; ctx.fill();
    }
  }
  ctx.lineWidth = 1.2; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(186,168,248,.78)";
  ctx.beginPath(); _specPath(ctx, p, specDisp, post); ctx.stroke();
  ctx.restore();
}

/* ---- the curve ---------------------------------------------------------- */
function _respPath(ctx, p, arr) {
  var n = arr.length, lo = p.y - 300, hi = p.y + p.h + 300;
  for (var i = 0; i < n; i++) {
    var x = p.x + (i / (n - 1)) * p.w, y = _clamp(yOfDb(arr[i]), lo, hi);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}
function _respPathBack(ctx, p, arr) {
  var n = arr.length, lo = p.y - 300, hi = p.y + p.h + 300;
  for (var i = n - 1; i >= 0; i--) ctx.lineTo(p.x + (i / (n - 1)) * p.w, _clamp(yOfDb(arr[i]), lo, hi));
}
function _hueGradient(ctx, p, bands) {
  var g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0), stops = [], i;
  for (i = 0; i < bands.length; i++) {
    if (!bands[i].on) continue;
    stops.push({ o: _clamp((xOfF(bands[i].freq) - p.x) / p.w, 0, 1), c: bandHue(bands[i], i) });
  }
  if (!stops.length) { g.addColorStop(0, _C.cyan); g.addColorStop(1, _C.cyan); return g; }
  stops.sort(function (a, b) { return a.o - b.o; });
  g.addColorStop(0, stops[0].c);
  for (i = 0; i < stops.length; i++) if (stops[i].o > 0 && stops[i].o < 1) g.addColorStop(stops[i].o, stops[i].c);
  g.addColorStop(1, stops[stops.length - 1].c);
  return g;
}

function drawResponse(ctx, p, bands) {
  if (!respLive.length) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
  var hue = _hueGradient(ctx, p, bands);

  /* tonal fill: between the curve and the line-drawn baseline (cuts), so a
     cut is shown by its line and never floods the plot. A wash, then an
     inner glow that concentrates colour against the curve.               */
  ctx.save();
  ctx.beginPath(); _respPath(ctx, p, respLive); _respPathBack(ctx, p, respBase); ctx.closePath();
  ctx.clip();
  ctx.fillStyle = hue; ctx.globalAlpha = 0.16;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeStyle = hue; ctx.lineJoin = "round";
  ctx.globalAlpha = 0.20; ctx.lineWidth = 34;
  ctx.beginPath(); _respPath(ctx, p, respLive); ctx.stroke();
  ctx.globalAlpha = 0.24; ctx.lineWidth = 14;
  ctx.beginPath(); _respPath(ctx, p, respLive); ctx.stroke();
  ctx.restore();

  drawZeroLine(ctx, p);

  /* dynamic range envelope: violet between rest and the band's limit */
  var anyDyn = false;
  for (var i = 0; i < bands.length; i++) if (bands[i].on && bands[i].dyn.on) anyDyn = true;
  if (anyDyn) {
    ctx.beginPath(); _respPath(ctx, p, respStatic); _respPathBack(ctx, p, respRange); ctx.closePath();
    ctx.fillStyle = "rgba(155,123,240,.16)"; ctx.fill();
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(190,172,255,.45)";
    ctx.beginPath(); _respPath(ctx, p, respRange); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* the line: two glow passes, the core, then a hot centre */
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = hue;
  ctx.globalAlpha = 0.14; ctx.lineWidth = 9;
  ctx.beginPath(); _respPath(ctx, p, respLive); ctx.stroke();
  ctx.globalAlpha = 0.32; ctx.lineWidth = 4.5;
  ctx.beginPath(); _respPath(ctx, p, respLive); ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineWidth = 2.2;
  ctx.beginPath(); _respPath(ctx, p, respLive); ctx.stroke();
  ctx.globalAlpha = 0.42; ctx.lineWidth = 0.9; ctx.strokeStyle = "#FFFFFF";
  ctx.beginPath(); _respPath(ctx, p, respLive); ctx.stroke();
  ctx.restore();
}

/* ---- solo: audition the band's region, dim the rest --------------------- */
function drawSoloMask(ctx, p, band) {
  if (!band) return;
  var lo, hi;
  if (band.type === "lowshelf" || band.type === "highcut") { lo = FMIN; hi = band.freq * 1.4; }
  else if (band.type === "highshelf" || band.type === "lowcut") { lo = band.freq / 1.4; hi = FMAX; }
  else {
    var half = Math.max(bandwidthOct(band), 0.15) / 2;
    lo = band.freq / Math.pow(2, half); hi = band.freq * Math.pow(2, half);
  }
  var x0 = xOfF(lo), x1 = xOfF(hi);
  ctx.save();
  ctx.fillStyle = "rgba(6,8,11,.58)";
  ctx.fillRect(p.x, p.y, x0 - p.x, p.h);
  ctx.fillRect(x1, p.y, p.x + p.w - x1, p.h);
  var g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
  g.addColorStop(0, "rgba(255,158,44,.10)"); g.addColorStop(1, "rgba(255,158,44,.02)");
  ctx.fillStyle = g; ctx.fillRect(x0, p.y, x1 - x0, p.h);
  ctx.strokeStyle = "rgba(255,158,44,.45)"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x0) + 0.5, p.y); ctx.lineTo(Math.round(x0) + 0.5, p.y + p.h);
  ctx.moveTo(Math.round(x1) + 0.5, p.y); ctx.lineTo(Math.round(x1) + 0.5, p.y + p.h);
  ctx.stroke();
  ctx.font = "600 9px " + _FONT; ctx.fillStyle = "rgba(255,180,92,.9)";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillText("SOLO", (x0 + x1) / 2, p.y + 6);
  ctx.restore();
}

/* ---- nodes -------------------------------------------------------------- */
function drawNodes(ctx, p, bands, selectedIndex, hoverIndex) {
  ctx.save();
  ctx.beginPath(); ctx.rect(p.x - 12, p.y - 12, p.w + 24, p.h + 24); ctx.clip();
  /* selected last, so it is never covered */
  var order = [];
  for (var i = 0; i < bands.length; i++) if (i !== selectedIndex) order.push(i);
  if (selectedIndex >= 0 && selectedIndex < bands.length) order.push(selectedIndex);

  for (var k = 0; k < order.length; k++) {
    var idx = order[k], band = bands[idx];
    var x = xOfF(band.freq), y = _clamp(yOfDb(nodeGainDb(band)), p.y, p.y + p.h);
    var hue = bandHue(band, idx, selectedIndex);
    var sel = idx === selectedIndex, hov = idx === hoverIndex;

    if (!band.on) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#12161C";
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, _TAU); ctx.fill();
      ctx.strokeStyle = "rgba(160,170,184,.8)"; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, _TAU); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      continue;
    }

    var R = sel ? 9 : 7.5;
    var glow = ctx.createRadialGradient(x, y, 0, x, y, R + 12);
    glow.addColorStop(0, _rgba(hue, sel ? 0.45 : 0.38));
    glow.addColorStop(0.5, _rgba(hue, 0.14));
    glow.addColorStop(1, _rgba(hue, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, R + 12, 0, _TAU); ctx.fill();

    if (sel) {
      /* the selected node is hollow: a dark eye in an amber ring */
      ctx.fillStyle = "#0D1015";
      ctx.beginPath(); ctx.arc(x, y, R, 0, _TAU); ctx.fill();
      ctx.strokeStyle = hue; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(x, y, R - 1.3, 0, _TAU); ctx.stroke();
      ctx.strokeStyle = _rgba(hue, 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, R + 3.5, 0, _TAU); ctx.stroke();
    } else {
      /* the rest are filled jewels with a bright rim */
      var body = ctx.createRadialGradient(x - 2, y - 2.5, 0.5, x, y, R);
      body.addColorStop(0, _mix(hue, "#FFFFFF", 0.55));
      body.addColorStop(0.6, hue);
      body.addColorStop(1, _mix(hue, "#000000", 0.25));
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(x, y, R, 0, _TAU); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.88)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, R - 0.2, 0, _TAU); ctx.stroke();
      if (hov) {
        ctx.strokeStyle = _rgba(hue, 0.55); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, R + 4, 0, _TAU); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/* ---- node tag: the band's own values, beside the node ------------------- */
function drawNodeTag(ctx, p, band, idx) {
  if (!band) return;
  var x = xOfF(band.freq), y = _clamp(yOfDb(nodeGainDb(band)), p.y, p.y + p.h);
  var ty = TYPES[band.type];
  var parts = [String(idx + 1), fmtFreq(band.freq)];
  if (ty.gain) parts.push(fmtDb(band.gain + (band.dyn.on ? band.dyn.cur : 0)));
  if (ty.q) parts.push("Q " + fmtQ(band.q));
  if (ty.slope) parts.push(band.slope + " dB/oct");
  if (!band.on) parts.push("OFF");
  var txt = parts.join("   ");

  ctx.save();
  ctx.font = "500 10.5px " + _FONT;
  var w = Math.ceil(ctx.measureText(txt).width) + 20, h = 22;
  var bx = _clamp(x - w / 2, p.x + 2, p.x + p.w - w - 2);
  var by = y - 22 - h;
  if (by < p.y + 2) by = y + 20;
  ctx.beginPath(); _rr(ctx, bx, by, w, h, 11);
  ctx.fillStyle = "rgba(10,12,16,.92)"; ctx.fill();
  ctx.strokeStyle = _rgba(bandHue(band, idx), 0.55); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = "#DDE3EA"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(txt, bx + 10, by + h / 2 + 0.5);
  ctx.restore();
}

/* ---- hover guide -------------------------------------------------------- */
var _NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function _note(f) {
  var n = Math.round(12 * Math.log2(f / 440) + 69);
  return _NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
function drawHoverGuide(ctx, p, mx, f, db) {
  ctx.save();
  var gx = Math.round(_clamp(mx, p.x, p.x + p.w)) + 0.5;
  ctx.strokeStyle = "rgba(226,234,244,.16)"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(gx, p.y); ctx.lineTo(gx, p.y + p.h); ctx.stroke();
  ctx.setLineDash([]);
  var txt = fmtFreq(f) + "  ·  " + _note(f) + "  ·  " + fmtDb(db);
  ctx.font = "500 10.5px " + _FONT;
  var w = Math.ceil(ctx.measureText(txt).width) + 20, h = 22;
  var bx = gx + 10; if (bx + w > p.x + p.w - 4) bx = gx - 10 - w;
  var by = p.y + 8;
  ctx.beginPath(); _rr(ctx, bx, by, w, h, 11);
  ctx.fillStyle = "rgba(10,12,16,.9)"; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.10)"; ctx.stroke();
  ctx.fillStyle = "#C8D0DA"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(txt, bx + 10, by + h / 2 + 0.5);
  ctx.restore();
}
