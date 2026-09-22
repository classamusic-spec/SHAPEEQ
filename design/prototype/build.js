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
html,body{ background:#6C727A; }
body{
  margin:0; padding-block:22px; padding-inline:16px;
  font-family:Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  color:#262B33; -webkit-font-smoothing:antialiased;
}
.sh-stage{ max-width:1400px; margin-inline:auto; }
*{ box-sizing:border-box; }
:focus-visible{ outline:2px solid #45C2F0; outline-offset:2px; }
@media (prefers-reduced-motion: reduce){ *{ transition-duration:1ms !important; } }

${chassis.css}

${graph.css}

${knobs.css}

${controls.css}

/* ---- integration ----
   The chassis reset is wrapped in :where() (zero specificity), so each
   part's own rules win without the cascade-repair block that used to
   live here. Only genuinely cross-part rules remain.                 */
.sh-knob.is-disabled{ pointer-events:none; }
[hidden]{ display:none !important; }
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
