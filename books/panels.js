/* =====================================================================================================================
   NVPANELS – finds the panels of a comic / manga page from the picture alone (no internet, no AI, nothing leaves the phone).
   Plain functions with no page access, so they can be tested anywhere. Boxes are fractions 0–1 of the picture [x0, y0, x1, y1].
   Plan and reasons: plans/bookcase.md "Panel by panel".
   The ladder (a rung is used only when the one above is unsure – every page gets a confidence):
     1 gutters (XY-cut)   2 outlines (connected art regions)   3 bubble-led steps   4 the whole page
   "Paper" = smooth areas without linework: white, black, tinted – found per page, so black flashback pages work too.
   ===================================================================================================================== */
(function(root){
'use strict';
const RT = 34;                     // a cell whose brightness range is at most this is smooth (no lines, no texture)
const SPILL = .06;                 // a gutter row / column may hold this much art (a wave or a figure leaning into it)
const CONF_OK = .6;                // below this the page counts as "not sure"
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---- the picture → a grid of cells that are paper or not ---- */
function analyse(rgba, W0, H0){
  const long = Math.max(W0, H0), k = long > 660 ? 660 / long : 1, W = Math.max(8, Math.round(W0 * k)), H = Math.max(8, Math.round(H0 * k));
  const g = new Float32Array(W * H);
  for(let y = 0; y < H; y++){ const sy0 = Math.floor(y / k), sy1 = Math.max(sy0 + 1, Math.min(H0, Math.floor((y + 1) / k)));
    for(let x = 0; x < W; x++){ const sx0 = Math.floor(x / k), sx1 = Math.max(sx0 + 1, Math.min(W0, Math.floor((x + 1) / k))); let s = 0, n = 0;
      for(let yy = sy0; yy < sy1; yy++) for(let xx = sx0; xx < sx1; xx++){ const i = (yy * W0 + xx) * 4, a = rgba[i + 3] / 255; s += (.299 * rgba[i] + .587 * rgba[i + 1] + .114 * rgba[i + 2]) * a + 255 * (1 - a); n++ }
      g[y * W + x] = s / n } }
  const CS = 2, cw = Math.ceil(W / CS), ch = Math.ceil(H / CS), mean = new Float32Array(cw * ch), rng = new Float32Array(cw * ch);
  for(let cy = 0; cy < ch; cy++) for(let cx = 0; cx < cw; cx++){ let mn = 255, mx = 0, s = 0, n = 0;
    for(let y = cy * CS; y < Math.min(H, cy * CS + CS); y++) for(let x = cx * CS; x < Math.min(W, cx * CS + CS); x++){ const v = g[y * W + x]; if(v < mn) mn = v; if(v > mx) mx = v; s += v; n++ }
    mean[cy * cw + cx] = s / n; rng[cy * cw + cx] = mx - mn }
  /* the paper colour from the page's outer ring (when most of it is smooth) – else white / black only */
  const rb = Math.max(2, Math.round(.025 * Math.min(cw, ch))), ring = []; let ringN = 0;
  for(let cy = 0; cy < ch; cy++) for(let cx = 0; cx < cw; cx++) if(cy < rb || cy >= ch - rb || cx < rb || cx >= cw - rb){ ringN++; if(rng[cy * cw + cx] <= RT) ring.push(mean[cy * cw + cx]) }
  let pc = null; if(ring.length >= .3 * ringN){ ring.sort((a, b) => a - b); pc = ring[ring.length >> 1] }
  const ink = new Uint8Array(cw * ch);
  for(let i = 0; i < ink.length; i++){ const smooth = rng[i] <= RT && (mean[i] >= 205 || mean[i] <= 50 || (pc != null && Math.abs(mean[i] - pc) <= 30)); ink[i] = smooth ? 0 : 1 }
  let total = 0; for(let i = 0; i < ink.length; i++) total += ink[i];
  return {W, H, cw, ch, CS, ink, mean, pc, ring: ringN ? 1 - ring.length / ringN : 0, total, rb} }

/* ---- rung 1: gutters (recursive XY-cut). Rows first (top → bottom), then columns (left → right, manga right → left) ---- */
function counts(S, x0, x1, y0, y1, byRow){ const out = new Int32Array(byRow ? y1 - y0 : x1 - x0), { ink, cw } = S;
  if(byRow){ for(let y = y0; y < y1; y++){ let c = 0; for(let x = x0; x < x1; x++) c += ink[y * cw + x]; out[y - y0] = c } }
  else { for(let x = x0; x < x1; x++){ let c = 0; for(let y = y0; y < y1; y++) c += ink[y * cw + x]; out[x - x0] = c } }
  return out }
function trimmed(S, b){ let [x0, y0, x1, y1] = b;
  for(let pass = 0; pass < 2; pass++){
    let rc = counts(S, x0, x1, y0, y1, true), th = Math.max(1, Math.floor(SPILL * (x1 - x0))), a = 0, e = rc.length - 1;
    while(a <= e && rc[a] <= th) a++; while(e >= a && rc[e] <= th) e--; if(a > e) return null; y1 = y0 + e + 1; y0 += a;
    rc = counts(S, x0, x1, y0, y1, false); th = Math.max(1, Math.floor(SPILL * (y1 - y0))); a = 0; e = rc.length - 1;
    while(a <= e && rc[a] <= th) a++; while(e >= a && rc[e] <= th) e--; if(a > e) return null; x1 = x0 + e + 1; x0 += a }
  return [x0, y0, x1, y1] }
function gutterRuns(c, th, minG){ const runs = []; let s = -1;
  for(let i = 0; i <= c.length; i++){ const g = i < c.length && c[i] <= th; if(g && s < 0) s = i; else if(!g && s >= 0){ if(i - s >= minG) runs.push([s, i]); s = -1 } }
  return runs }
/* marks outside the art (tape, notes, a page number, a scan edge): a thin strip at the page's border that a gutter separates from the rest is left out */
function dropEdgeJunk(S, b){ let [x0, y0, x1, y1] = b;
  for(let pass = 0; pass < 3; pass++){ let moved = false;
    let runs = gutterRuns(counts(S, x0, x1, y0, y1, false), Math.max(1, Math.floor(SPILL * (y1 - y0))), 2), w = x1 - x0;
    if(runs.length){ if(runs[0][0] < .05 * w){ x0 += runs[0][1]; moved = true } else if(w - runs[runs.length - 1][1] < .05 * w){ x1 = x0 + runs[runs.length - 1][0]; moved = true } }
    runs = gutterRuns(counts(S, x0, x1, y0, y1, true), Math.max(1, Math.floor(SPILL * (x1 - x0))), 2); const h = y1 - y0;
    if(runs.length){ if(runs[0][0] < .04 * h){ y0 += runs[0][1]; moved = true } else if(h - runs[runs.length - 1][1] < .04 * h){ y1 = y0 + runs[runs.length - 1][0]; moved = true } }
    if(!moved) break; const t = trimmed(S, [x0, y0, x1, y1]); if(!t) return null; [x0, y0, x1, y1] = t }
  return [x0, y0, x1, y1] }
function xyCut(S, b0, rtl, leaves, depth){
  let b = trimmed(S, b0); if(!b) return; if(depth === 0){ b = dropEdgeJunk(S, b); if(!b) return }
  const [x0, y0, x1, y1] = b; if(depth > 12) return void leaves.push(b);
  const rowRuns = gutterRuns(counts(S, x0, x1, y0, y1, true), Math.max(1, Math.floor(SPILL * (x1 - x0))), 2);
  if(rowRuns.length){ let p = 0; const parts = []; for(const [s, e] of rowRuns){ parts.push([x0, y0 + p, x1, y0 + s]); p = e } parts.push([x0, y0 + p, x1, y1]);
    for(const q of parts) xyCut(S, q, rtl, leaves, depth + 1); return }
  const colRuns = gutterRuns(counts(S, x0, x1, y0, y1, false), Math.max(1, Math.floor(SPILL * (y1 - y0))), 2);
  if(colRuns.length){ let p = 0; const parts = []; for(const [s, e] of colRuns){ parts.push([x0 + p, y0, x0 + s, y1]); p = e } parts.push([x0 + p, y0, x1, y1]);
    if(rtl) parts.reverse(); for(const q of parts) xyCut(S, q, rtl, leaves, depth + 1); return }
  leaves.push(b) }

/* ---- rung 2: outlines = regions of art / lines that touch each other (copes with slanted gutters and panels that do not line up) ---- */
function regions(S, minCells){ const { ink, cw, ch } = S, lab = new Int32Array(cw * ch), out = [], stack = [];
  for(let s = 0; s < ink.length; s++){ if(!ink[s] || lab[s]) continue; let x0 = cw, y0 = ch, x1 = 0, y1 = 0, n = 0; lab[s] = out.length + 1; stack.push(s);
    while(stack.length){ const i = stack.pop(), x = i % cw, y = (i - x) / cw; n++; if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
      if(x > 0 && ink[i - 1] && !lab[i - 1]){ lab[i - 1] = out.length + 1; stack.push(i - 1) } if(x < cw - 1 && ink[i + 1] && !lab[i + 1]){ lab[i + 1] = out.length + 1; stack.push(i + 1) }
      if(y > 0 && ink[i - cw] && !lab[i - cw]){ lab[i - cw] = out.length + 1; stack.push(i - cw) } if(y < ch - 1 && ink[i + cw] && !lab[i + cw]){ lab[i + cw] = out.length + 1; stack.push(i + cw) } }
    out.push({box:[x0, y0, x1 + 1, y1 + 1], n}) }
  return out.filter(r => r.n >= minCells) }


/* ---- ruled layouts: panels that touch, separated by one long thin dark line instead of a paper gutter (old ads, strips). Long thin dark runs are taken out of the art map ---- */
function ruled(S){ const { cw, ch, ink } = S, out = Uint8Array.from(ink), dark = new Uint8Array(cw * ch); let any = false;
  for(let i = 0; i < dark.length; i++) dark[i] = S.mean[i] <= 135 ? 1 : 0;
  const thick = (x, y, dx, dy) => { let n = 1; for(let k = 1; k < 12; k++){ const a = x + dx * k, b = y + dy * k; if(a < 0 || b < 0 || a >= cw || b >= ch || !dark[b * cw + a]) break; n++ } for(let k = 1; k < 12; k++){ const a = x - dx * k, b = y - dy * k; if(a < 0 || b < 0 || a >= cw || b >= ch || !dark[b * cw + a]) break; n++ } return n };
  for(let y = 0; y < ch; y++){ let s = -1; for(let x = 0; x <= cw; x++){ const d = x < cw && dark[y * cw + x]; if(d && s < 0) s = x; else if(!d && s >= 0){ if(x - s >= .4 * cw && thick(((s + x) >> 1), y, 0, 1) <= 9){ for(let k = s; k < x; k++) out[y * cw + k] = 0; any = true } s = -1 } } }
  for(let x = 0; x < cw; x++){ let s = -1; for(let y = 0; y <= ch; y++){ const d = y < ch && dark[y * cw + x]; if(d && s < 0) s = y; else if(!d && s >= 0){ if(y - s >= .4 * ch && thick(x, ((s + y) >> 1), 1, 0) <= 9){ for(let k = s; k < y; k++) out[k * cw + x] = 0; any = true } s = -1 } } }
  return any ? out : null }

/* ---- turning cell boxes into panels, and judging them ---- */
const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
function keepPanels(S, boxes){ const A = S.cw * S.ch, out = [];
  for(const b of boxes){ const w = (b[2] - b[0]) / S.cw, h = (b[3] - b[1]) / S.ch; if(area(b) < .02 * A || w < .06 || h < .035) continue;
    let n = 0; for(let y = b[1]; y < b[3]; y++) for(let x = b[0]; x < b[2]; x++) n += S.ink[y * S.cw + x]; if(n < .08 * area(b)) continue; out.push(b) }
  return out }
function judge(S, boxes){ const n = boxes.length; if(!n) return 0; const A = S.cw * S.ch, band = S.rb + 2; let all = 0, got = 0;
  for(let y = band; y < S.ch - band; y++) for(let x = band; x < S.cw - band; x++){ if(!S.ink[y * S.cw + x]) continue; all++; for(const b of boxes) if(x >= b[0] && x < b[2] && y >= b[1] && y < b[3]){ got++; break } }
  const cov = all ? got / all : 0; let s = 1; if(n > 16) s -= .4; let ov = 0, sa = 0;
  for(let i = 0; i < n; i++){ sa += area(boxes[i]); for(let j = i + 1; j < n; j++) ov += inter(boxes[i], boxes[j]) } s -= Math.min(.5, 2 * ov / Math.max(1, sa));
  s *= clamp((cov - .5) / .4, 0, 1); if(n === 1 && area(boxes[0]) > .6 * A) s = Math.min(s, .55); return {conf: Math.max(0, s), cov} }
function orderRows(boxes, rtl){ /* rows by overlapping height; in a row left → right (manga right → left) */
  const rows = []; for(const b of boxes.slice().sort((p, q) => p[1] - q[1])){ const h = b[3] - b[1];
    const r = rows.find(r => Math.min(r.y1, b[3]) - Math.max(r.y0, b[1]) > .4 * Math.min(h, r.y1 - r.y0)); if(r){ r.items.push(b); r.y0 = Math.min(r.y0, b[1]); r.y1 = Math.max(r.y1, b[3]) } else rows.push({y0:b[1], y1:b[3], items:[b]}) }
  return rows.sort((a, b) => a.y0 - b.y0).flatMap(r => r.items.sort((a, b) => rtl ? b[2] - a[2] : a[0] - b[0])) }
const frac = (S, b) => [b[0] / S.cw, b[1] / S.ch, Math.min(1, b[2] / S.cw), Math.min(1, b[3] / S.ch)];

/* a picture that is one page: panels by the ladder's first two rungs, plus big art that sits in no panel */
function onePage(rgba, W0, H0, rtl){
  const S = analyse(rgba, W0, H0), why = [];
  const leaves = []; xyCut(S, [0, 0, S.cw, S.ch], rtl, leaves, 0);
  const cut = keepPanels(S, leaves), jc = judge(S, cut);
  let best = {boxes:cut, conf:jc.conf || 0, method:'gutters'};
  if(best.conf < CONF_OK){ const rg = keepPanels(S, regions(S, Math.round(.02 * S.cw * S.ch)).map(r => r.box)).filter((b, i, a) => !a.some((c, j) => j !== i && inter(b, c) > .9 * area(b) && area(c) > area(b)));
    const o = orderRows(rg, rtl), jr = judge(S, o); if((jr.conf || 0) > best.conf) best = {boxes:o, conf:jr.conf, method:'outlines'} }
  if(best.conf < CONF_OK){ const ink2 = ruled(S); if(ink2){ const S2 = Object.assign({}, S, {ink:ink2}), lv = []; xyCut(S2, [0, 0, S.cw, S.ch], rtl, lv, 0); const rb = keepPanels(S, lv), jr = judge(S, rb); if((jr.conf || 0) > best.conf) best = {boxes:rb, conf:jr.conf, method:'ruled lines'} } }
  why.push(`paper ${S.pc == null ? 'white/black' : Math.round(S.pc)}, ${best.method}: ${best.boxes.length} panels, conf ${best.conf.toFixed(2)}`);
  const panels = best.boxes.map(b => ({box:frac(S, b), kind:'panel'}));
  /* big art in no panel (borderless pictures, a figure fading into the paper) becomes a step of its own */
  const cov = new Uint8Array(S.cw * S.ch), pad = 1; for(const b of best.boxes) for(let y = Math.max(0, b[1] - pad); y < Math.min(S.ch, b[3] + pad); y++) for(let x = Math.max(0, b[0] - pad); x < Math.min(S.cw, b[2] + pad); x++) cov[y * S.cw + x] = 1;
  const band = S.rb + 2, rest = {cw:S.cw, ch:S.ch, ink:new Uint8Array(S.cw * S.ch)};
  for(let y = band; y < S.ch - band; y++) for(let x = band; x < S.cw - band; x++){ const i = y * S.cw + x; if(S.ink[i] && !cov[i]) rest.ink[i] = 1 }
  const art = regions(rest, Math.round(.04 * S.cw * S.ch)).map(r => r.box).filter(b => (b[2] - b[0]) / S.cw > .12 && (b[3] - b[1]) / S.ch > .08).map(b => ({box:frac(S, b), kind:'art'}));
  if(art.length) why.push(art.length + ' art step(s) outside the panels');
  return {steps:placeExtras(panels, art, rtl), conf:best.conf, method:best.method, why, S} }

/* extra steps (art, text) go in front of the first step that starts below their middle */
function placeExtras(steps, extras, rtl){ const out = steps.slice();
  for(const e of extras.slice().sort((a, b) => a.box[1] - b[1] || a.box[0] - b[0])){ const mid = (e.box[1] + e.box[3]) / 2; let at = out.findIndex(s => s.box[1] > mid); if(at < 0) at = out.length; out.splice(at, 0, e) }
  return out }

/* ---- a wide picture is two pages side by side: split near the middle where the least is drawn, then each page on its own ---- */
function findPanels(rgba, W0, H0, opt){ opt = opt || {}; const rtl = !!opt.rtl;
  if(W0 > H0 * 1.1){ const S = analyse(rgba, W0, H0), c = counts(S, 0, S.cw, 0, S.ch, false); let bx = S.cw >> 1, bv = 1e9;
    for(let x = Math.round(S.cw * .38); x <= Math.round(S.cw * .62); x++){ const v = c[x] + Math.abs(x - S.cw / 2) * .05; if(v < bv){ bv = v; bx = x } }
    const cut = Math.round(bx * S.CS / S.W * W0), halves = [[0, cut], [cut, W0]], res = [], why = [`spread: split at ${(cut / W0).toFixed(2)}`]; let conf = 1;
    for(const [a, b] of (rtl ? halves.slice().reverse() : halves)){ const w = b - a, sub = new Uint8ClampedArray(w * H0 * 4);
      for(let y = 0; y < H0; y++) sub.set(rgba.subarray((y * W0 + a) * 4, (y * W0 + b) * 4), y * w * 4);
      const r = onePage(sub, w, H0, rtl); conf = Math.min(conf, r.conf); why.push(...r.why);
      for(const s of r.steps) res.push({box:[(a + s.box[0] * w) / W0, s.box[1], (a + s.box[2] * w) / W0, s.box[3]], kind:s.kind, side:a ? 1 : 0}) }
    return {steps:res, conf, spread:true, split:cut / W0, why} }
  const r = onePage(rgba, W0, H0, rtl); return {steps:r.steps, conf:r.conf, method:r.method, why:r.why, spread:false} }

/* ---- rung 3: steps from the speech bubbles (needs the text reader). Bubbles {fx0, fy0, fx1, fy1} close together are one step ---- */
function bubbleSteps(bubbles, rtl, grow){ grow = grow == null ? .09 : grow; if(!bubbles.length) return [];
  const gs = bubbles.map(b => ({x0:b.fx0, y0:b.fy0, x1:b.fx1, y1:b.fy1})), gap = .08; let merged = true;
  while(merged){ merged = false; outer: for(let i = 0; i < gs.length; i++) for(let j = i + 1; j < gs.length; j++){ const a = gs[i], b = gs[j];
    const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)), dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
    if(dx < gap * .8 && dy < gap){ gs[i] = {x0:Math.min(a.x0, b.x0), y0:Math.min(a.y0, b.y0), x1:Math.max(a.x1, b.x1), y1:Math.max(a.y1, b.y1)}; gs.splice(j, 1); merged = true; break outer } } }
  const boxes = gs.map(g => [clamp(g.x0 - grow, 0, 1), clamp(g.y0 - grow, 0, 1), clamp(g.x1 + grow, 0, 1), clamp(g.y1 + grow, 0, 1)]);
  return orderRows(boxes, rtl).map(b => ({box:b, kind:'bubbles'})) }
/* which step does a bubble belong to: the one its middle is in (the smallest), else the nearest */
function stepOf(steps, b){ const cx = (b.fx0 + b.fx1) / 2, cy = (b.fy0 + b.fy1) / 2; let best = -1, ba = 9;
  steps.forEach((s, i) => { const [x0, y0, x1, y1] = s.box; if(cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1 && area(s.box) < ba){ ba = area(s.box); best = i } });
  if(best >= 0) return best; let bd = 9; steps.forEach((s, i) => { const [x0, y0, x1, y1] = s.box, dx = Math.max(x0 - cx, 0, cx - x1), dy = Math.max(y0 - cy, 0, cy - y1), d = Math.hypot(dx, dy); if(d < bd){ bd = d; best = i } }); return best }

/* ---- the plan for a page: the ladder. bubbles is optional (Android: the text reader) ---- */
function plan(found, bubbles, rtl){ bubbles = bubbles || []; let steps = found.steps.slice(), kind = 'auto', conf = found.conf;
  if(conf < CONF_OK){ if(bubbles.length){ steps = bubbleSteps(bubbles, rtl); kind = 'bubbles' } else { steps = [{box:[0, 0, 1, 1], kind:'page'}]; kind = 'page' } }
  else if(bubbles.length){ /* text that sits in no panel (floating narration, captions on bare paper) is a step of its own */
    const outside = bubbles.filter(b => { const cx = (b.fx0 + b.fx1) / 2, cy = (b.fy0 + b.fy1) / 2; return !steps.some(s => cx >= s.box[0] - .01 && cx <= s.box[2] + .01 && cy >= s.box[1] - .01 && cy <= s.box[3] + .01) });
    if(outside.length) steps = placeExtras(steps, bubbleSteps(outside, rtl, .05).map(s => Object.assign(s, {kind:'text'})), rtl) }
  if(!steps.length) steps = [{box:[0, 0, 1, 1], kind:'page'}];
  /* every bubble to its step, in reading order inside the step */
  const per = steps.map(() => []); for(const b of bubbles){ const i = stepOf(steps, b); if(i >= 0) per[i].push(b) }
  per.forEach(l => { const rows = orderRows(l.map(b => [b.fx0, b.fy0, b.fx1, b.fy1, b]), rtl); l.length = 0; rows.forEach(r => l.push(r[4])) });
  return {steps:steps.map((s, i) => Object.assign({}, s, {bubbles:per[i]})), kind, conf} }

/* ---- long strips: where to scroll to. Fixed steps of about 0.8 of the screen that never end in the middle of a bubble ---- */
function stripStops(total, vh, bubbles, margin){ margin = margin == null ? .06 * vh : margin; const out = [0]; let y = 0, guard = 0;
  while(y + vh < total - 2 && guard++ < 5000){ const bottom = y + vh; let nxt = y + .8 * vh;
    const cross = bubbles.filter(b => b.y0 < bottom - 2 && b.y1 > bottom); if(cross.length){ const top = Math.min(...cross.map(b => b.y0)) - margin; if(top > y + .3 * vh) nxt = Math.min(nxt, top) }
    nxt = Math.min(nxt, total - vh); if(nxt <= y + 1) break; out.push(nxt); y = nxt }
  return out }

root.NVPANELS = {analyse, findPanels, bubbleSteps, plan, stripStops, stepOf, orderRows, CONF_OK};
})(typeof window !== 'undefined' ? window : globalThis);
