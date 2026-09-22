/* ===========================================================================
   SHAPE — canvas rendering layer
   ---------------------------------------------------------------------------
   Pure drawing only. No state, no timers, no listeners, no DOM.
   Every function saves and restores the context, so nothing leaks between
   passes (globalAlpha, shadowBlur, lineDash, strokeStyle, fonts, clips).

   Assumes these already exist as globals:
     FMIN FMAX FS NBINS
     xOfF(f) fOfX(x) yOfDb(db) dbOfY(y) yOfFs(dbfs)
     plot() -> {x,y,w,h}
     respLive respStatic respRange   (dB per pixel column)
     specDisp specPeak binF          (Float64Array(NBINS))
     cur() -> {bands, selected, bypass}

   Public:
     bandHue(band, i[, selectedIndex])
     drawWell(ctx, p)
     drawAxes(ctx, p)
     drawSpectrum(ctx, p)
     drawResponse(ctx, p, bands)
     drawNodes(ctx, p, bands, selectedIndex, hoverIndex)
     drawHoverGuide(ctx, p, mouseX, freq, db)

   Everything prefixed _shp / _SHP is private to this file. This file is
   concatenated into a single inline <script>, so it is written in plain ES5
   with top-level function declarations and no module syntax.
   =========================================================================== */

/* ---- locked tokens ------------------------------------------------------ */
var _SHP_WELL_BG    = '#0C0E12';
var _SHP_WELL_BG2   = '#171B21';
var _SHP_WELL_LINE  = '#262B33';
var _SHP_ON_DARK    = '#C8CFD8';
var _SHP_ON_DARK2   = '#7B838E';
var _SHP_AMBER      = '#FF9E2C';
var _SHP_CYAN       = '#45C2F0';
var _SHP_VIOLET     = '#9B7BF0';
var _SHP_GREEN      = '#6FC98A';
var _SHP_ORANGE     = '#FFA53D';

/* Band hue cycle — ordered so neighbouring bands never share a hue. */
var _SHP_PALETTE = ['#45C2F0', '#9B7BF0', '#FFA53D', '#45C2F0', '#6FC98A', '#9B7BF0'];

var _SHP_FONT = '400 10px Inter, system-ui, sans-serif';
var _SHP_TAU  = Math.PI * 2;

var _SHP_NYQ_DRAW = 24000;   /* analyser stops here */

var _SHP_GRID_F = [20, 30, 40, 50, 70, 100, 200, 300, 400, 500, 700,
                   1000, 2000, 3000, 4000, 5000, 7000, 10000, 20000];

/* the subset that carries a label, and therefore a brighter gridline */
var _SHP_LABEL_F = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
var _SHP_LABEL_TEXT = {
  20: '20', 50: '50', 100: '100', 200: '200', 500: '500',
  1000: '1k', 2000: '2k', 5000: '5k', 10000: '10k', 20000: '20k'
};

var _SHP_DB_TICKS = [24, 18, 12, 6, 0, -6, -12, -18, -24];
var _SHP_FS_TICKS = [12, 6, 0, -6, -12];

/* types that carry no gain — their node rides the 0 dB line */
var _SHP_NO_GAIN = { lowcut: 1, highcut: 1, notch: 1, bandpass: 1 };

/* Ticks for the right-hand fine ruler. That ruler's range is set by the SCALE
   control, so the ticks follow it: at the default (±12) this is exactly the
   locked list, and at any other setting the ruler stays honest rather than
   printing a number against the wrong line. */
function _shpFineTicks() {
  var fs = 12;
  if (typeof cur === 'function') {
    var st = cur();
    if (st && typeof st.fineScale === 'number' && isFinite(st.fineScale) && st.fineScale > 0) {
      fs = st.fineScale;
    }
  }
  if (fs === 12) return _SHP_FS_TICKS;
  return [fs, fs / 2, 0, -fs / 2, -fs];
}


/* ---- private helpers ---------------------------------------------------- */

function _shpClamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/* plot rect, with a fallback so a caller may omit it */
function _shpRect(p) {
  if (p && typeof p.w === 'number') return p;
  return (typeof plot === 'function') ? plot() : { x: 0, y: 0, w: 0, h: 0 };
}

/* '#45C2F0' + alpha -> 'rgba(69,194,240,.28)' */
function _shpRgba(hex, a) {
  var h = String(hex == null ? '' : hex).replace('#', '');
  if (h.length === 3) {
    h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  }
  var n = parseInt(h, 16);
  if (h.length !== 6 || isNaN(n)) return 'rgba(200,210,222,' + a + ')';
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* resolve the selected index when a caller did not hand one over */
function _shpSelected(selectedIndex) {
  if (typeof selectedIndex === 'number') return selectedIndex;
  if (typeof cur === 'function') {
    var st = cur();
    if (st && typeof st.selected === 'number') return st.selected;
  }
  return -1;
}

function _shpBands(bands) {
  if (bands && bands.length) return bands;
  if (typeof cur === 'function') {
    var st = cur();
    if (st && st.bands) return st.bands;
  }
  return [];
}

/* gain the node actually sits at: static gain plus live dynamic movement */
function _shpBandGain(band) {
  if (!band) return 0;
  if (_SHP_NO_GAIN[band.type]) return 0;
  var g = (typeof band.gain === 'number') ? band.gain : 0;
  if (band.dyn && band.dyn.on && typeof band.dyn.cur === 'number') g += band.dyn.cur;
  return g;
}

/* open polyline along a dB array, one sample per pixel column.
   Does not begin or close the path — the caller owns that. */
function _shpRespPath(ctx, p, arr) {
  var n = arr.length;
  if (n < 2) return false;
  var lo = p.y - 200, hi = p.y + p.h + 200;
  for (var i = 0; i < n; i++) {
    var px = p.x + (i / (n - 1)) * p.w;
    var py = _shpClamp(yOfDb(arr[i]), lo, hi);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  return true;
}

/* open polyline across the analyser bins. Returns the span it covered so the
   caller can close it down to the floor, or null when nothing was drawn.
   Deliberately point-to-point — the analyser must stay jagged. */
function _shpSpecPath(ctx, p, arr) {
  if (!arr || !arr.length) return null;
  var n = Math.min(NBINS, arr.length, binF.length);
  var lo = p.y - 40, hi = p.y + p.h + 40;
  var started = false, first = 0, last = 0;
  for (var i = 0; i < n; i++) {
    var f = binF[i];
    if (f > _SHP_NYQ_DRAW) break;
    var x = xOfF(f);
    var y = _shpClamp(yOfLevel(arr[i]), lo, hi);
    if (!started) { ctx.moveTo(x, y); first = x; started = true; }
    else ctx.lineTo(x, y);
    last = x;
  }
  return started ? { first: first, last: last } : null;
}

function _shpRoundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function _shpFmtHz(f) {
  if (typeof f !== 'number' || !isFinite(f)) return '--';
  if (f >= 10000) return (Math.round(f / 100) / 10) + ' kHz';
  if (f >= 1000)  return (Math.round(f / 10) / 100) + ' kHz';
  return Math.round(f) + ' Hz';
}

function _shpFmtDb(db) {
  if (typeof db !== 'number' || !isFinite(db)) return '-- dB';
  var v = Math.abs(db) < 0.05 ? 0 : db;
  var sign = v < 0 ? '−' : '+';
  return sign + Math.abs(v).toFixed(1) + ' dB';
}


/* ---- hue ---------------------------------------------------------------- */
/* Selection wins over everything: amber marks the current band and nothing
   else, which is what keeps one node readable against a full spectrum.
   A dynamic band is violet. Otherwise the band takes its slot in the cycle. */
function bandHue(band, i, selectedIndex) {
  if (!band) return _SHP_CYAN;
  var sel = _shpSelected(selectedIndex);
  if (typeof i === 'number' && i >= 0 && i === sel) return _SHP_AMBER;
  if (band.dyn && band.dyn.on) return _SHP_VIOLET;
  var idx = (typeof i === 'number' && i >= 0) ? (i % _SHP_PALETTE.length) : 0;
  return _SHP_PALETTE[idx];
}


/* ---- the well: ground, then grid ---------------------------------------- */
function drawWell(ctx, p) {
  ctx.save();
  p = _shpRect(p);
  if (p.w <= 0 || p.h <= 0) { ctx.restore(); return; }

  var bottom = p.y + p.h, right = p.x + p.w, i, v, x, y;

  var g = ctx.createLinearGradient(0, p.y, 0, bottom);
  g.addColorStop(0, _SHP_WELL_BG2);
  g.addColorStop(1, _SHP_WELL_BG);
  ctx.fillStyle = g;
  ctx.fillRect(p.x, p.y, p.w, p.h);

  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();

  ctx.lineWidth = 1;

  for (i = 0; i < _SHP_GRID_F.length; i++) {
    v = _SHP_GRID_F[i];
    x = Math.round(xOfF(v)) + 0.5;
    if (x < p.x - 1 || x > right + 1) continue;
    ctx.strokeStyle = _SHP_LABEL_TEXT[v] ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.045)';
    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, bottom); ctx.stroke();
  }

  for (i = 0; i < _SHP_DB_TICKS.length; i++) {
    v = _SHP_DB_TICKS[i];
    y = Math.round(yOfDb(v)) + 0.5;
    if (y < p.y - 1 || y > bottom + 1) continue;
    ctx.strokeStyle = (v === 0) ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.055)';
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(right, y); ctx.stroke();
  }

  /* hairline lip, so the panel reads as sunk into the faceplate */
  ctx.strokeStyle = _SHP_WELL_LINE;
  ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5,
                 Math.round(p.w) - 1, Math.round(p.h) - 1);

  ctx.restore();
}


/* ---- axes: EQ gain left, analyser level right, frequency below ---------- */
function drawAxes(ctx, p) {
  ctx.save();
  p = _shpRect(p);
  if (p.w <= 0 || p.h <= 0) { ctx.restore(); return; }

  var bottom = p.y + p.h, right = p.x + p.w, i, v, y, x;

  ctx.font = _SHP_FONT;
  ctx.fillStyle = _SHP_ON_DARK2;

  /* left — EQ gain in dB */
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (i = 0; i < _SHP_DB_TICKS.length; i++) {
    v = _SHP_DB_TICKS[i];
    y = yOfDb(v);
    if (y < p.y - 1 || y > bottom + 1) continue;
    ctx.fillText((v > 0 ? '+' : '') + v, p.x - 9, y);
  }
  ctx.textBaseline = 'top';
  ctx.fillText('dB', p.x - 9, 2);

  /* right — the fine ruler */
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  var fine = _shpFineTicks();
  for (i = 0; i < fine.length; i++) {
    v = fine[i];
    y = yOfFs(v);
    if (y < p.y - 1 || y > bottom + 1) continue;
    v = Math.round(v * 10) / 10;
    ctx.fillText((v > 0 ? '+' : '') + v, right + 9, y);
  }

  /* bottom — frequency */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (i = 0; i < _SHP_LABEL_F.length; i++) {
    v = _SHP_LABEL_F[i];
    x = xOfF(v);
    if (x < p.x - 6 || x > right + 6) continue;
    ctx.fillText(_SHP_LABEL_TEXT[v], x, bottom + 8);
  }

  ctx.restore();
}


/* ---- spectrum: behind everything, always neutral grey ------------------- */
function drawSpectrum(ctx, p) {
  ctx.save();
  p = _shpRect(p);
  if (p.w <= 0 || p.h <= 0 ||
      typeof specDisp === 'undefined' || !specDisp || !specDisp.length ||
      typeof binF === 'undefined' || !binF || !binF.length) {
    ctx.restore(); return;
  }

  var floorY = p.y + p.h;

  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();

  /* body */
  ctx.beginPath();
  var span = _shpSpecPath(ctx, p, specDisp);
  if (!span) { ctx.restore(); return; }
  ctx.lineTo(span.last, floorY + 2);
  ctx.lineTo(span.first, floorY + 2);
  ctx.closePath();

  var g = ctx.createLinearGradient(0, p.y, 0, floorY);
  g.addColorStop(0, 'rgba(200,210,222,.16)');
  g.addColorStop(1, 'rgba(200,210,222,.03)');
  ctx.fillStyle = g;
  ctx.fill();

  /* contour — redrawn open so the closing edges never get stroked */
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(210,218,228,.45)';
  ctx.beginPath();
  _shpSpecPath(ctx, p, specDisp);
  ctx.stroke();

  /* peak hold */
  if (typeof specPeak !== 'undefined' && specPeak && specPeak.length) {
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.beginPath();
    if (_shpSpecPath(ctx, p, specPeak)) ctx.stroke();
  }

  ctx.restore();
}


/* ---- the curve ---------------------------------------------------------- */

/* Horizontal gradient carrying each band's hue at that band's frequency, so
   the curve shifts colour along its length toward whichever band is local.
   addColorStop throws on an out-of-range offset and misbehaves out of order,
   so offsets are clamped and sorted before any of them is added. */
function _shpCurveGradient(ctx, p, bands) {
  var g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
  var stops = [], i, b;

  for (i = 0; i < bands.length; i++) {
    b = bands[i];
    if (!b || b.on === false) continue;
    stops.push({ o: _shpClamp((xOfF(b.freq) - p.x) / (p.w || 1), 0, 1), c: bandHue(b, i) });
  }
  /* every band muted — keep a hue rather than an invisible curve */
  if (!stops.length) {
    for (i = 0; i < bands.length; i++) {
      b = bands[i];
      if (!b) continue;
      stops.push({ o: _shpClamp((xOfF(b.freq) - p.x) / (p.w || 1), 0, 1), c: bandHue(b, i) });
    }
  }
  if (!stops.length) {
    g.addColorStop(0, _SHP_CYAN);
    g.addColorStop(1, _SHP_CYAN);
    return g;
  }

  stops.sort(function (a, c) { return a.o - c.o; });

  /* anchor both ends so the curve never fades out at the edges */
  g.addColorStop(0, stops[0].c);
  for (i = 0; i < stops.length; i++) {
    if (stops[i].o > 0 && stops[i].o < 1) g.addColorStop(stops[i].o, stops[i].c);
  }
  g.addColorStop(1, stops[stops.length - 1].c);
  return g;
}

/* violet wash between the bands at rest and the bands pushed to their limit */
function _shpDynamicRegion(ctx, p, bands) {
  var any = false, i;
  for (i = 0; i < bands.length; i++) {
    if (bands[i] && bands[i].dyn && bands[i].dyn.on && bands[i].on !== false) { any = true; break; }
  }
  if (!any) return;
  if (typeof respStatic === 'undefined' || typeof respRange === 'undefined') return;
  if (!respStatic || !respRange || respStatic.length < 2 || respRange.length < 2) return;

  var lo = p.y - 200, hi = p.y + p.h + 200;
  var n = respStatic.length, m = respRange.length;

  ctx.beginPath();
  for (i = 0; i < n; i++) {
    var px = p.x + (i / (n - 1)) * p.w;
    var py = _shpClamp(yOfDb(respStatic[i]), lo, hi);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  for (i = m - 1; i >= 0; i--) {
    ctx.lineTo(p.x + (i / (m - 1)) * p.w, _shpClamp(yOfDb(respRange[i]), lo, hi));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(155,123,240,.13)';
  ctx.fill();
}

function drawResponse(ctx, p, bands) {
  ctx.save();
  p = _shpRect(p);
  if (p.w <= 0 || p.h <= 0 ||
      typeof respLive === 'undefined' || !respLive || respLive.length === 0) {
    ctx.restore(); return;
  }

  bands = _shpBands(bands);

  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();

  var grad = _shpCurveGradient(ctx, p, bands);
  var zero = yOfDb(0);

  /* 2 — fill, curve closed down onto the 0 dB line */
  ctx.beginPath();
  if (!_shpRespPath(ctx, p, respLive)) { ctx.restore(); return; }
  ctx.lineTo(p.x + p.w, zero);
  ctx.lineTo(p.x, zero);
  ctx.closePath();

  ctx.globalAlpha = 0.20;
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.globalAlpha = 1;

  /* second pass inside that same region: a vertical wash that fades out
     toward the top and bottom of the well, so a deep excursion tints the
     ground instead of flooding it with a slab of colour */
  ctx.save();
  ctx.beginPath();
  _shpRespPath(ctx, p, respLive);
  ctx.lineTo(p.x + p.w, zero);
  ctx.lineTo(p.x, zero);
  ctx.closePath();
  ctx.clip();
  var vg = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
  var zt = _shpClamp((zero - p.y) / p.h, 0.02, 0.98);
  vg.addColorStop(0, 'rgba(210,222,238,0)');
  vg.addColorStop(zt, 'rgba(210,222,238,.07)');
  vg.addColorStop(1, 'rgba(210,222,238,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.restore();

  /* 5 — dynamic range region. Drawn here rather than last so the violet
     wash stays under the curve: over the core stroke it would veil it. */
  _shpDynamicRegion(ctx, p, bands);

  /* 3 — glow, two widening strokes rather than a shadow blur */
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = grad;
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 6;
  ctx.beginPath(); _shpRespPath(ctx, p, respLive); ctx.stroke();

  ctx.globalAlpha = 0.30;
  ctx.lineWidth = 3;
  ctx.beginPath(); _shpRespPath(ctx, p, respLive); ctx.stroke();

  /* 4 — core */
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.25;
  ctx.beginPath(); _shpRespPath(ctx, p, respLive); ctx.stroke();

  ctx.restore();
}


/* ---- nodes: small, crisp, glowing rings --------------------------------- */
function drawNodes(ctx, p, bands, selectedIndex, hoverIndex) {
  ctx.save();
  p = _shpRect(p);
  if (p.w <= 0 || p.h <= 0) { ctx.restore(); return; }

  bands = _shpBands(bands);
  var sel = _shpSelected(selectedIndex);
  var hov = (typeof hoverIndex === 'number') ? hoverIndex : -1;

  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();

  for (var i = 0; i < bands.length; i++) {
    var band = bands[i];
    if (!band) continue;

    var x = xOfF(band.freq);
    if (x < p.x - 24 || x > p.x + p.w + 24) continue;
    var y = yOfDb(_shpBandGain(band));
    if (y < p.y - 40 || y > p.y + p.h + 40) continue;

    var hue = bandHue(band, i, sel);
    var off = (band.on === false);

    /* outer glow — skipped on a bypassed band */
    if (!off) {
      var rg = ctx.createRadialGradient(x, y, 0, x, y, 16);
      rg.addColorStop(0, _shpRgba(hue, 0.28));
      rg.addColorStop(0.55, _shpRgba(hue, 0.12));
      rg.addColorStop(1, _shpRgba(hue, 0));
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, 16, 0, _SHP_TAU); ctx.fill();
    }

    /* dark core */
    ctx.fillStyle = '#12151A';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, _SHP_TAU); ctx.fill();

    /* ring */
    ctx.globalAlpha = off ? 0.35 : 1;
    ctx.strokeStyle = hue;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, _SHP_TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    /* hover halo — a hairline, never a fatter node */
    if (i === hov && i !== sel) {
      ctx.globalAlpha = 0.40;
      ctx.strokeStyle = hue;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, _SHP_TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* selection ring */
    if (i === sel) {
      ctx.globalAlpha = 0.60;
      ctx.strokeStyle = _SHP_AMBER;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, _SHP_TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}


/* ---- hover guide -------------------------------------------------------- */
function drawHoverGuide(ctx, p, mouseX, freq, db) {
  ctx.save();
  p = _shpRect(p);
  if (p.w <= 0 || p.h <= 0 || typeof mouseX !== 'number' || !isFinite(mouseX) ||
      mouseX < p.x - 2 || mouseX > p.x + p.w + 2) {
    ctx.restore(); return;
  }

  var right = p.x + p.w;
  var gx = Math.round(_shpClamp(mouseX, p.x, right)) + 0.5;

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(gx, p.y);
  ctx.lineTo(gx, p.y + p.h);
  ctx.stroke();
  ctx.setLineDash([]);

  var label = _shpFmtHz(freq) + '   ' + _shpFmtDb(db);

  ctx.font = _SHP_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  var padX = 7, boxH = 19;
  var boxW = Math.round(ctx.measureText(label).width) + padX * 2;
  var boxY = Math.round(p.y + 8) + 0.5;
  var boxX = Math.round(gx + 10) + 0.5;

  /* flip to the left of the cursor rather than run off the well */
  if (boxX + boxW > right - 4) boxX = Math.round(gx - 10 - boxW) + 0.5;
  boxX = Math.max(Math.round(p.x + 4) + 0.5, boxX);

  ctx.beginPath();
  _shpRoundRectPath(ctx, boxX, boxY, boxW, boxH, 4);
  ctx.fillStyle = 'rgba(10,12,16,.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = _SHP_ON_DARK;
  ctx.fillText(label, boxX + padX, boxY + boxH / 2 + 0.5);

  ctx.restore();
}


/* ---- POST spectrum: PRE multiplied by the computed response ------------
   Not a second synthetic curve — the same bins, offset by the response the
   EQ actually produces at that frequency, so it moves when a node moves. */
function drawSpectrumPost(ctx, p) {
  ctx.save();
  p = _shpRect(p);
  if (p.w <= 0 || p.h <= 0 || typeof specDisp === 'undefined' ||
      !specDisp || !specDisp.length) { ctx.restore(); return; }

  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();

  var n = Math.min(NBINS, specDisp.length, binF.length);
  var lo = p.y - 40, hi = p.y + p.h + 40;
  var started = false;

  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    var f = binF[i];
    if (f > _SHP_NYQ_DRAW) break;
    var x = xOfF(f);
    var y = _shpClamp(yOfLevel(specDisp[i] + respAtF(f)), lo, hi);
    if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
  }
  if (started) {
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(155,123,240,.80)';
    ctx.stroke();
  }
  ctx.restore();
}
