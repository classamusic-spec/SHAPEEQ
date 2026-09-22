/* Assembles the SHAPE prototype from the parts each agent produced.
   Splits every part into its <style>, <script> and markup, then emits one
   file with all CSS first, all markup in layout order, all JS last —
   so no script runs before the DOM it binds to exists. */
const fs = require("fs");
const path = require("path");

const PARTS = path.join(__dirname, "parts");
const OUT = path.join(__dirname, "shape-ui.html");

const read = f => {
  const p = path.join(PARTS, f);
  if (!fs.existsSync(p)) { console.error("MISSING: " + f); process.exit(1); }
  return fs.readFileSync(p, "utf8");
};

/* pull every <style>…</style> and <script>…</script> out of a fragment */
function split(src) {
  const css = [], js = [];
  let html = src
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, b) => { css.push(b.trim()); return ""; })
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_, b) => { js.push(b.trim()); return ""; });
  return { css: css.join("\n\n"), js: js.join("\n\n"), html: html.trim() };
}

const chassis  = split(read("chassis.html"));
const graph    = split(read("graph.html"));
const knobs    = split(read("knobs.html"));
const controls = split(read("controls.html"));

const canvasJs = read("canvas.js");
const engineJs = read("engine.js");
const wiringJs = read("wiring.js");

/* the chassis fragment carries a #mount-body placeholder; the graph,
   band strip and bottom bar go inside it, in that order */
const body = [graph.html, controls.html].join("\n\n");
let shell = chassis.html;
if (!/id="mount-body"/.test(shell)) { console.error("chassis has no #mount-body"); process.exit(1); }
shell = shell.replace(
  /(<div[^>]*id="mount-body"[^>]*>)([\s\S]*?)(<\/div>)/,
  (_, open, __, close) => open + "\n" + body + "\n" + close
);

const out = `<title>SHAPE Spectral Equalizer</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&display=swap">

<style>
/* ---- page ground: the plugin floats on a neutral desk ---- */
html,body{ background:#7E848B; }
body{
  margin:0; padding-block:22px; padding-inline:16px;
  font-family:Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  color:#262B33; -webkit-font-smoothing:antialiased;
}
.sh-stage{ max-width:1360px; margin-inline:auto; }
*{ box-sizing:border-box; }
:focus-visible{ outline:2px solid #45C2F0; outline-offset:2px; }
@media (prefers-reduced-motion: reduce){ *{ transition-duration:1ms !important; } }

${chassis.css}

${graph.css}

${knobs.css}

${controls.css}

/* ---- integration overrides (last, so they win) ----
   Each reconciles two parts that were authored independently. */

/* The chassis already gutters #mount-body; the graph must not add its own. */
.sh-chassis > #mount-body > .sh-graphwrap{ margin-left:0; margin-right:0; }

/* Knob mounts reserved 56px before the knob's real cell width was known.
   Let the knob size the mount instead of clipping it. */
.sh-knobmount{ width:auto !important; min-width:0 !important; }
.sh-knobgroup, .sh-dynknobs{ max-width:none !important; flex-wrap:wrap; }

/* Disabled knobs: the wiring marks controls that do nothing for this
   filter type, rather than offering them. */
.sh-knob.is-disabled{ opacity:.32; pointer-events:none; }

/* Keep the whole instrument off the horizontal scrollbar. */
.sh-chassis, .sh-bandstrip, .sh-bottombar{ max-width:100%; }

/* --- cascade repair ---
   The chassis part resets .sh-chassis button (0,1,1), which outranks the
   other parts' single-class button rules (0,1,0) and was stripping their
   padding, border and background. Restore them at (0,2,0). The .sh-on
   states already outrank the reset, so only the base needs re-asserting. */
.sh-chassis .sh-dbtn{
  padding:8px 13px;
  border:1px solid rgba(255,255,255,.07);
  background:rgba(255,255,255,.045);
  border-radius:7px;
  /* the reset's color:inherit was handing these dark chassis ink on a
     near-black panel, which made the inactive labels unreadable */
  color:#98A1AC;
}
.sh-chassis .sh-dbtn:hover{ background:rgba(255,255,255,.09); color:#C8CFD8; }
.sh-chassis .sh-dbtn[aria-pressed="true"]{ color:#FF9E2C; }

.sh-chassis .sh-seg-btn{
  height:32px; padding:0 18px; border-radius:7px;
  border:1px solid rgba(0,0,0,.14);
  background:linear-gradient(180deg,#F2F4F6,#D9DEE3);
}
.sh-chassis .sh-pill{
  height:30px; padding:0 16px; border-radius:999px;
  border:1px solid rgba(0,0,0,.14);
  background:linear-gradient(180deg,#F2F4F6,#D9DEE3);
}
.sh-chassis .sh-shape-btn{
  width:34px; height:34px; padding:0; border-radius:7px;
  border:1px solid rgba(0,0,0,.14);
  background:linear-gradient(180deg,#E8EBEE,#D6DBE0);
}
.sh-chassis .sh-minibtn,
.sh-chassis .sh-powerbtn{ padding:0; }

/* The factories mark state with .sh-on; re-assert the dark+amber face at a
   specificity the reset cannot reach, and keep aria-pressed in step. */
.sh-chassis .sh-seg-btn.sh-on,
.sh-chassis .sh-pill.sh-on,
.sh-chassis .sh-shape-btn.sh-on{
  background:linear-gradient(180deg,#333A44,#1E232B);
  border-color:rgba(0,0,0,.55);
  color:#FF9E2C;
  box-shadow:
    inset 0 0 0 1px rgba(255,158,44,.42),
    inset 0 1px 0 rgba(255,255,255,.09),
    0 0 10px rgba(255,158,44,.38);
}
</style>

<div class="sh-stage">
${shell}
</div>

<script>
${engineJs}
</script>

<script>
${canvasJs}
</script>

<script>
${knobs.js}
</script>

<script>
${wiringJs}
</script>

<script>
(function(){
  function go(){ try { bootEngine(); } catch(e){ console.error("SHAPE boot failed:", e); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
})();
</script>
`;

fs.writeFileSync(OUT, out, "utf8");
console.log("wrote " + OUT + "  (" + (out.length / 1024).toFixed(1) + " KB)");
console.log("  css: chassis " + chassis.css.length + ", graph " + graph.css.length +
            ", knobs " + knobs.css.length + ", controls " + controls.css.length);
console.log("  js : engine " + engineJs.length + ", canvas " + canvasJs.length +
            ", knobs " + knobs.js.length + ", wiring " + wiringJs.length);
