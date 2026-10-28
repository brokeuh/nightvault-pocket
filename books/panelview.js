/* =====================================================================================================================
   SCROLL MODE + PANEL BY PANEL (loaded after app.js; uses the reader's own state R, RA, PN and helpers). Plan: plans/bookcase.md.
   · Scroll mode: long strips (Infinity Comics, webtoons) – the slices of the book joined into one column at the screen's width.
   · Panel by panel: the screen zooms to one panel (a step) at a time. The steps come from books/panels.js (found on the phone, one page
     ahead), or from the owner's hand fix. Read along (app.js) reads only the bubbles of the step on screen. On a strip a step scrolls.
   · Fix screen: draw / move boxes, tap the panels in the order you want. Fixes are kept apart from what was found (IndexedDB 'panels').
   ===================================================================================================================== */
'use strict';

const PNV = 1;                                      // version of the finder: a newer one never touches a hand fix
const scEl = () => $('#rscroll'), colEl = () => $('#rcol');

/* ============================== SCROLL MODE ============================== */
function scWanted(b){ if(b.scroll != null) return !!b.scroll;
  if((lsGet('nvBooks.scrollSeries', {}))[String(b.series || '').toLowerCase()]) return true;
  return /infinity comic|webtoon|\bmobile\b|vertical scroll|long.?strip/i.test([b.name, b.title, b.series].filter(Boolean).join(' ')) }
async function scOpen(start, off){
  R.scroll = true; R.dims = null; R.shown = [start]; R.s = start; R.slAsp = new Array(R.n).fill(0); R.slEst = 1.5; R.sl = [];
  $('#reader').classList.add('scroll'); const sc = scEl(), col = colEl(); sc.hidden = false; col.innerHTML = ''; $('#rend').hidden = true;
  const W = col.clientWidth || innerWidth;
  for(let p = 0; p < R.n; p++){ const d = document.createElement('div'); d.className = 'sl'; d.dataset.p = p; d.style.height = Math.round(W * R.slEst) + 'px'; col.appendChild(d); R.sl.push(d) }
  sc.onscroll = scOnScroll; sc.onclick = scClick;
  sc.scrollTop = 0; await scGoto(start, off || 0); pageInfo(); R.scrollReady = true }
function scClose(){ const sc = scEl(); if(sc){ sc.onscroll = null; sc.onclick = null; sc.hidden = true } if(colEl()) colEl().innerHTML = ''; $('#reader').classList.remove('scroll'); R.scroll = false }
/* the slice that is at the top of the screen, and how far into it */
function scPos(){ const sc = scEl(), t = sc.scrollTop; let lo = 0, hi = R.sl.length - 1;
  while(lo < hi){ const mid = (lo + hi + 1) >> 1; if(R.sl[mid].offsetTop <= t) lo = mid; else hi = mid - 1 }
  const d = R.sl[lo]; return {p:lo, off:d && d.offsetHeight ? Math.max(0, Math.min(1, (t - d.offsetTop) / d.offsetHeight)) : 0} }
/* change heights without moving what the reader is looking at */
function scResize(fn){ const sc = scEl(), a = scPos(); fn(); const d = R.sl[a.p]; if(d) sc.scrollTop = d.offsetTop + a.off * d.offsetHeight }
function scRelayout(){ if(!R || !R.scroll) return; const W = colEl().clientWidth || innerWidth; scResize(() => { R.sl.forEach((d, i) => { d.style.height = Math.round(W * (R.slAsp[i] || R.slEst)) + 'px' }) }); scLoad() }
function scLearn(p, m){ const asp = m.h / m.w; if(!(asp > 0) || Math.abs(R.slAsp[p] - asp) < 1e-4) return; const W = colEl().clientWidth || innerWidth, first = !R.slAsp.some(a => a > 0);
  scResize(() => { R.slAsp[p] = asp; R.sl[p].style.height = Math.round(W * asp) + 'px';
    if(first){ R.slEst = asp; R.sl.forEach((d, i) => { if(!R.slAsp[i]) d.style.height = Math.round(W * asp) + 'px' }) } }) }
async function scGoto(p, off){ const d = R.sl[p]; if(!d) return; R.s = p; R.shown = [p]; scEl().scrollTop = d.offsetTop + (off || 0) * d.offsetHeight;
  try{ const m = await getImg(p); if(!R || !R.scroll) return; scLearn(p, m) }catch(e){}
  const d2 = R.sl[p]; scEl().scrollTop = d2.offsetTop + (off || 0) * d2.offsetHeight; scLoad(); pageInfo() }
/* pictures only for the slices near the screen; the others are let go */
function scLoad(){ if(!R || !R.scroll) return; const sc = scEl(), top = sc.scrollTop, vh = sc.clientHeight, lo = top - vh * 1.3, hi = top + vh * 2.8, me = R;
  for(let i = 0; i < R.sl.length; i++){ const d = R.sl[i], y0 = d.offsetTop, y1 = y0 + d.offsetHeight, near = y1 >= lo && y0 <= hi;
    if(near && !d._img && !d._busy){ d._busy = true;
      getImg(i).then(m => { d._busy = false; if(R !== me || !R.scroll || d._img) return; scLearn(i, m); m.img.className = ''; d.appendChild(m.img); d._img = m.img }).catch(() => { d._busy = false }) }
    else if(!near && d._img){ d.removeChild(d._img); d._img = null; const pr = R.cache.get(i); R.cache.delete(i); if(pr) pr.then(m => URL.revokeObjectURL(m.url)).catch(() => {}) } } }
let scT = 0;
function scOnScroll(){ if(scT) return; scT = setTimeout(() => { scT = 0; if(!R || !R.scroll) return; const sc = scEl(), a = scPos(); R.s = a.p; R.shown = [a.p]; scLoad(); pageInfo();
    const s = st(R.b.id); s.page = a.p; s.off = a.off; s.pages = R.n; s.last = Date.now(); saveState(R.b.id);
    if(PN && PN.strip && !PN.moving){ PN.y = sc.scrollTop; PN.nextY = PN.y + .8 * sc.clientHeight }
    const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 6;
    if(atEnd && !R.endShown){ R.endShown = true; s.finished = true; saveState(R.b.id, true); if(!PN) showEnd() } else if(!atEnd && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 220) R.endShown = false }, 90) }
function scClick(e){ if(!R || !$('#rend').hidden) return; const sc = scEl(), r = sc.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, vh = sc.clientHeight;
  if(RA && raTapStrip(x, y + sc.scrollTop)) return;
  if(S.edges && y < vh * .2) return scStep(-1); if(S.edges && y > vh * .8) return scStep(1); rUI() }
/* a screen on / back: a free scroll, or the next panel when Panels is on */
function scStep(dir){ if(!R || !R.scroll) return; if(PN) return pnStripAdvance(dir); const sc = scEl(), vh = sc.clientHeight;
  if(dir > 0 && sc.scrollTop + vh >= sc.scrollHeight - 6) return showEnd(); sc.scrollBy({top:dir * .85 * vh, behavior:'smooth'}) }
function scKey(k){ const sc = scEl(), vh = sc.clientHeight;
  if(k === 'PageDown' || k === ' ' || k === 'ArrowDown'){ scStep(1); return true } if(k === 'PageUp' || k === 'ArrowUp'){ scStep(-1); return true }
  if(k === 'Home'){ sc.scrollTo({top:0}); return true } if(k === 'End'){ sc.scrollTo({top:sc.scrollHeight}); return true } if(k === 'Escape'){ closeReader(); return true } return false }
addEventListener('resize', () => { if(R && R.scroll){ clearTimeout(R._srz); R._srz = setTimeout(scRelayout, 150) } });
/* switch between pages and scrolling for this book (or for the whole series) */
async function scSwitch(on, series){ if(!R) return; const b = R.b; b.scroll = on; if(series && b.series){ const m = lsGet('nvBooks.scrollSeries', {}); m[String(b.series).toLowerCase()] = on; lsSet('nvBooks.scrollSeries', m) }
  if(!b.handed) await dbPut('books', b).catch(() => {}); const s = st(b.id); if(!on) s.off = 0; saveState(b.id, true); closeSheet(); await closeReader(true); openReader(b) }

/* ============================== PANEL BY PANEL ============================== */
async function pnStoreGet(){ if(R.pnStore) return R.pnStore; R.pnStore = (R.b.handed ? null : await dbGet('panels', R.b.id).catch(() => null)) || {id:R.b.id, v:PNV, pages:{}}; return R.pnStore }
let pnSaveT = 0; const pnStoreSave = () => { clearTimeout(pnSaveT); const R0 = R; pnSaveT = setTimeout(() => { if(R0 && R0.pnStore && !R0.b.handed) dbPut('panels', R0.pnStore).catch(() => {}) }, 700) };
function pnStart(silent){ if(!R || PN) return;
  PN = {mode:lsGet('nvBooks.raMode', 'auto'), speed:lsGet('nvBooks.raSpeed', 1), paused:false, i:0, plan:null, tok:0, enter:'first', strip:!!R.scroll, hist:[], y:0, nextY:0};
  if(!R.b.handed){ R.b.pn = true; dbPut('books', R.b).catch(() => {}) } const b = $('#rpn'); if(b) b.classList.add('on'); rUI(false); raBar();
  if(R.scroll){ PN.y = scEl().scrollTop; PN.nextY = PN.y + .8 * scEl().clientHeight; pnStatus('Strip'); pnArm() }
  else if(R.dims && R.shown.length > 1) showAt(R.s); else pnOnPage();
  if(!silent && !lsGet('nvBooks.pnHinted', false)){ lsSet('nvBooks.pnHinted', true); rHint('Panel by panel<br>tap or swipe for the next panel · Auto moves on by itself', 4200) } }
function pnStop(keep){ if(!PN) return; clearTimeout(PN.dwell); PN.tok++; cancelAnimationFrame(pnAnim); PN = null; const b = $('#rpn'); if(b) b.classList.remove('on');
  if(!keep && R && R.b && !R.b.handed){ R.b.pn = false; dbPut('books', R.b).catch(() => {}) }
  if(RA){ RA.tok++; RA.bubbles = null; RA.i = null; RA.audio.pause(); if(R && !R.scroll) raOnPage(); else raDraw() }
  if(R && !R.scroll && !keep){ R.zoom = 1; showAt(R.s) } raBar() }
if($('#rpn')) $('#rpn').onclick = () => { if(!R) return; PN ? pnStop() : pnStart() };

/* the panels of one page: your fix, else what was found before, else look now (the picture, no internet) */
function pnFound(p){ R.pnFound = R.pnFound || new Map(); if(R.pnFound.has(p)) return R.pnFound.get(p);
  const pr = (async () => { const store = await pnStoreGet(), rec = store.pages[p] || null, m = await getImg(p), ratio = m.w / m.h, same = rec && Math.abs((rec.ratio || ratio) - ratio) < .03;
    if(same && rec.fixed) return {steps:rec.fixed.steps.map(s => ({box:s.box.slice(), kind:s.kind || 'panel'})), conf:1, fixed:true, why:['your fix']};
    if(same && rec.found && rec.found.v === PNV && rec.found.rtl === !!R.rtl) return {steps:rec.found.steps.map(s => ({box:s.box.slice(), kind:s.kind})), conf:rec.found.conf, fixed:false, why:['found before']};
    const k = Math.min(1, 720 / Math.max(m.w, m.h)), c = document.createElement('canvas'); c.width = Math.max(8, Math.round(m.w * k)); c.height = Math.max(8, Math.round(m.h * k));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(m.img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height), t0 = performance.now(), res = NVPANELS.findPanels(d.data, c.width, c.height, {rtl:!!R.rtl});
    L('panels', `page ${p + 1}: ${res.why.join(' · ')} (${Math.round(performance.now() - t0)} ms)`);
    const steps = res.steps.map(s => ({box:s.box.map(n => +n.toFixed(4)), kind:s.kind}));
    store.pages[p] = Object.assign(store.pages[p] || {}, {ratio, found:{v:PNV, rtl:!!R.rtl, conf:res.conf, steps}}); pnStoreSave();
    return {steps, conf:res.conf, fixed:false, why:res.why} })();
  R.pnFound.set(p, pr); pr.catch(() => R && R.pnFound && R.pnFound.delete(p)); return pr }
/* the plan: the ladder (gutters → outlines → bubbles → whole page) and every bubble in its step */
function pnPlanFor(p){ R.pnPlans = R.pnPlans || new Map(); if(R.pnPlans.has(p)) return R.pnPlans.get(p);
  const pr = (async () => { const f = await pnFound(p); let bub = [];
    if(NvOcr && (RA || f.conf < NVPANELS.CONF_OK)) bub = (await raPageBubbles(p).catch(() => [])).filter(raWanted);
    const plan = NVPANELS.plan(f, bub, !!R.rtl); plan.found = f; return plan })();
  R.pnPlans.set(p, pr); pr.catch(() => R && R.pnPlans && R.pnPlans.delete(p)); return pr }
async function pnOnPage(){ if(!PN || !R || R.scroll) return; const me = PN, tok = ++PN.tok, p = R.s; clearTimeout(PN.dwell); PN.plan = null; pnStatus('Looking for the panels…');
  if(RA){ RA.tok++; RA.audio.pause(); RA.bubbles = null; RA.i = null; raDraw() }
  let plan; try{ plan = await pnPlanFor(p) }catch(e){ LE('panels', 'page ' + (p + 1), e); plan = {steps:[{box:[0, 0, 1, 1], kind:'page', bubbles:[]}], kind:'page', conf:0} }
  if(PN !== me || tok !== PN.tok || !R || R.s !== p) return; PN.plan = plan; const n = plan.steps.length;
  PN.i = PN.keep != null ? Math.min(PN.keep, n - 1) : PN.enter === 'last' ? n - 1 : 0; PN.keep = null; PN.enter = 'first';
  L('panels', `page ${p + 1}: ${plan.kind}, ${n} steps, conf ${plan.conf.toFixed(2)}`, plan.steps.map(s => s.kind + (s.bubbles.length ? '+' + s.bubbles.length : '')));
  pnShow(PN.i, false); if(p + 1 < R.n) pnPlanFor(p + 1).catch(() => {}) }
/* Read along was switched on or off while Panels is on: make the plans again (with or without the bubbles) and stay on this panel */
function pnReplan(){ if(!PN || !R) return; if(R.scroll){ pnStripShow(PN.y, false); return } if(R.pnPlans) R.pnPlans.clear(); PN.keep = PN.i; pnOnPage() }
function pnShow(i, anim){ if(!PN || !PN.plan || !R) return; const steps = PN.plan.steps; i = Math.max(0, Math.min(steps.length - 1, i)); PN.i = i; const s = steps[i];
  zoomToBox(s.box, anim !== false); pnStatus(`${i + 1} / ${steps.length}${s.kind === 'page' ? ' · whole page' : ''}`);
  if(RA) raStep(); else pnArm(); raBar() }
function pnAdvance(dir){ if(!PN || R.scroll) return false; if(!PN.plan) return true; const j = PN.i + dir; if(j >= 0 && j < PN.plan.steps.length){ pnShow(j, true); return true } return false }
/* Auto without a voice: a panel stays a few seconds, then the next one */
function pnArm(){ if(!PN) return; clearTimeout(PN.dwell); if(PN.mode !== 'auto' || PN.paused || RA || !(PN.plan || PN.strip)) return;
  PN.dwell = setTimeout(() => { if(PN && R && !PN.paused && !RA) next() }, 3500 / (PN.speed || 1)) }
function pnPause(){ if(!PN) return; PN.paused = true; clearTimeout(PN.dwell); raBar() }
function pnResume(){ if(!PN) return; PN.paused = false; pnArm(); raBar() }

/* ---- zooming to a box: the box as fractions of the picture ---- */
function applyView(z, x, y){ R.zoom = z; const sc = R.base * z; R.DW = R.ws.reduce((a, b) => a + b, 0) * sc; R.DH = 1000 * sc; const box = rp(); box.style.width = R.DW + 'px'; box.style.height = R.DH + 'px';
  [...box.children].forEach((im, k) => { im.style.width = (R.ws[k] * sc) + 'px' }); R.x = x; R.y = y; clampPos(); applyPos() }
let pnAnim = 0;
function animateView(z1, x1, y1, ms){ cancelAnimationFrame(pnAnim); const z0 = R.zoom, x0 = R.x, y0 = R.y, reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!ms || reduce){ applyView(z1, x1, y1); hiRes(); return } const t0 = performance.now(), me = R;
  const tick = now => { if(R !== me) return; const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; applyView(z0 + (z1 - z0) * e, x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
    if(t < 1) pnAnim = requestAnimationFrame(tick); else hiRes() };
  pnAnim = requestAnimationFrame(tick) }
function zoomToBox(box, anim){ if(!R || !R.ws) return; const vw = innerWidth, vh = innerHeight, TW = R.ws[0], m = .04, bw = Math.max(.03, box[2] - box[0]), bh = Math.max(.03, box[3] - box[1]);
  let sc = Math.min(vw * (1 - 2 * m) / (bw * TW), vh * (1 - 2 * m) / (bh * 1000)), z = Math.max(1, Math.min(8, sc / R.base)); sc = R.base * z;
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2; animateView(z, vw / 2 - cx * TW * sc, vh / 2 - cy * 1000 * sc, anim ? 260 : 0) }
/* the reader's own layout was redone (turned the phone, changed the fit): fit the panel again */
function pnRefit(){ if(PN && PN.plan && R && !R.scroll) zoomToBox(PN.plan.steps[PN.i].box, false) }

/* ---- Read along on a step ---- */
function raStep(){ if(!RA || !R || !PN || !PN.plan) return; if(R.scroll) return raStripStep(); const me = RA, tok = ++RA.tok; RA.audio.pause(); RA.speaking = false; RA.i = null;
  const s = PN.plan.steps[PN.i]; RA.bubbles = s ? s.bubbles.filter(raWanted) : []; raDraw();
  if(!RA.bubbles.length){ raStatus('No text here'); if(RA.mode === 'auto' && !RA.paused) setTimeout(() => { if(RA === me && tok === RA.tok && R) next() }, 1300 / (RA.speed || 1)); return }
  if(RA.mode === 'auto' && !RA.paused) raPlay(0); else raStatus(RA.paused ? 'Paused' : 'Tap a bubble or swipe') }

/* ============================== STRIPS: a step scrolls ============================== */
/* the text of the next screen and a bit: the slices are drawn into one picture first, so a bubble that crosses a seam is read as one */
async function stripBubbles(y){ const sc = scEl(), col = colEl(), vh = sc.clientHeight; R.stripCache = R.stripCache || new Map(); const key = Math.round(y / 24); if(R.stripCache.has(key)) return R.stripCache.get(key);
  const pr = (async () => { const idx = []; const hi0 = y + vh * 1.4; R.sl.forEach((d, i) => { if(d.offsetTop + d.offsetHeight > y && d.offsetTop < hi0) idx.push(i) });
    const ms = await Promise.all(idx.map(i => getImg(i))); idx.forEach((i, k) => scLearn(i, ms[k]));
    const W = col.clientWidth || innerWidth, h = Math.max(40, Math.min(col.scrollHeight - y, vh * 1.35)), k = Math.min(1.7, 1100 / W), c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(h * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); idx.forEach((i, j) => { const d = R.sl[i]; x.drawImage(ms[j].img, 0, (d.offsetTop - y) * k, c.width, d.offsetHeight * k) });
    const r = await NvOcr.recognize({image:c.toDataURL('image/jpeg', .9)}), bs = raBubblesFrom(r, c, false, -1);
    for(const b of bs){ b.col = {x0:b.fx0 * W, y0:y + b.fy0 * h, x1:b.fx1 * W, y1:y + b.fy1 * h}; b.strip = true }
    L('readalong', `strip at ${Math.round(y)}: ${bs.length} bubbles`, bs.map(b => b.say.slice(0, 30))); return bs })();
  R.stripCache.set(key, pr); pr.catch(() => R && R.stripCache && R.stripCache.delete(key)); return pr }
async function raStripStep(){ if(!RA || !R || !PN) return; const me = RA, tok = ++RA.tok, y = PN.y, vh = scEl().clientHeight; RA.audio.pause(); RA.speaking = false; RA.bubbles = null; RA.i = null; raDraw(); raStatus('Reading…');
  R.stripSteps = R.stripSteps || new Map(); const key = Math.round(y / 24); let st0 = R.stripSteps.get(key);
  if(!st0){ let bs; try{ bs = await stripBubbles(y) }catch(e){ LE('readalong', 'text reader', e); raStatus('The text reader failed: ' + (e.message || e)); return } if(RA !== me || tok !== RA.tok || !PN) return;
    const read = R.stripRead = R.stripRead || new Set(), k2 = b => Math.round(b.col.x0 / 14) + ',' + Math.round(b.col.y0 / 14) + ':' + b.say.slice(0, 10), ok = bs.filter(raWanted);
    const cand = ok.filter(b => !read.has(k2(b)) && b.col.y0 < y + .92 * vh), later = ok.filter(b => !read.has(k2(b)) && b.col.y0 >= y + .92 * vh).sort((a, b) => a.col.y0 - b.col.y0)[0];
    cand.forEach(b => read.add(k2(b))); st0 = {cand, nextY:later ? Math.max(y + .35 * vh, later.col.y0 - .12 * vh) : y + .8 * vh}; R.stripSteps.set(key, st0) }
  PN.nextY = st0.nextY; RA.bubbles = st0.cand; raDraw(); pnStatus('');
  if(!RA.bubbles.length){ raStatus('No text here'); if(RA.mode === 'auto' && !RA.paused) setTimeout(() => { if(RA === me && tok === RA.tok && R) next() }, 900 / (RA.speed || 1)); return }
  if(RA.mode === 'auto' && !RA.paused) raPlay(0); else raStatus(RA.paused ? 'Paused' : 'Tap a bubble or swipe') }
function raTapStrip(x, yAbs){ if(!RA || !RA.bubbles) return false; const i = RA.bubbles.findIndex(b => b.col && x >= b.col.x0 - 6 && x <= b.col.x1 + 6 && yAbs >= b.col.y0 - 6 && yAbs <= b.col.y1 + 6);
  if(i < 0) return false; RA.tok++; RA.audio.pause(); raPlay(i, true); return true }
function pnStripShow(y, anim){ if(!PN || !R) return; const sc = scEl(), max = Math.max(0, sc.scrollHeight - sc.clientHeight); y = Math.max(0, Math.min(max, y)); PN.y = y; PN.nextY = y + .8 * sc.clientHeight; PN.moving = true; clearTimeout(PN.mv);
  sc.scrollTo({top:y, behavior:anim ? 'smooth' : 'auto'}); PN.mv = setTimeout(() => { if(PN) PN.moving = false }, anim ? 700 : 100);
  pnStatus(`${Math.round(100 * y / Math.max(1, max))} %`); if(RA) raStripStep(); else pnArm(); raBar() }
function pnStripAdvance(dir){ if(!PN || !R || !R.scroll) return; const sc = scEl(), vh = sc.clientHeight, max = sc.scrollHeight - vh;
  if(dir > 0){ if(sc.scrollTop >= max - 4 || PN.y >= max - 4){ clearTimeout(PN.dwell); return showEnd() } PN.hist.push(PN.y); pnStripShow(Math.min(max, PN.nextY || PN.y + .8 * vh), true) }
  else { const py = PN.hist.pop(); if(py == null){ rHint('This is the start'); return } pnStripShow(py, true) } }

/* ============================== FIX SCREEN ============================== */
const PF = {};
async function pnFixOpen(){ if(!R) return; if(R.scroll) return toast('Fixing panels works on pages, not in the scrolling view'); closeSheet(); const p = R.s;
  const f = await pnFound(p), m = await getImg(p); PF.p = p; PF.url = m.url; PF.ratio = m.w / m.h; PF.boxes = f.steps.filter(s => s.kind !== 'page' || f.steps.length === 1).map(s => s.box.slice()); PF.sel = -1; PF.mode = ''; PF.order = []; PF.hadFix = !!f.fixed;
  if(PF.boxes.length === 1 && PF.boxes[0][2] - PF.boxes[0][0] > .98 && PF.boxes[0][3] - PF.boxes[0][1] > .98 && !f.fixed) PF.boxes = [];
  let el = $('#pnfix'); if(el) el.remove(); el = document.createElement('div'); el.id = 'pnfix'; $('#reader').appendChild(el); pfDraw() }
function pfDraw(){ const el = $('#pnfix'); if(!el) return; const vw = innerWidth, vh = innerHeight - 170, w = Math.min(vw - 16, vh * PF.ratio), h = w / PF.ratio;
  const hint = PF.mode === 'draw' ? 'Drag on the page to draw a panel' : PF.mode === 'order' ? `Tap the panels in the order you want (${PF.order.length} of ${PF.boxes.length})` : PF.sel >= 0 ? 'Drag the panel or its corners' : 'Tap a panel to select it';
  el.innerHTML = `<div class="pfbar"><button class="btn sm" id="pf_x">Cancel</button><span class="pfmsg">${hint}</span><button class="btn primary sm" id="pf_ok">Save</button></div>
    <div class="pfstage"><div class="pfpage" id="pfpage" style="width:${w}px;height:${h}px"><img src="${PF.url}" alt="">${PF.boxes.map((b, i) => `<div class="pfbox${i === PF.sel ? ' sel' : ''}" data-i="${i}" style="left:${b[0] * 100}%;top:${b[1] * 100}%;width:${(b[2] - b[0]) * 100}%;height:${(b[3] - b[1]) * 100}%"><b>${PF.mode === 'order' ? (PF.order.indexOf(i) >= 0 ? PF.order.indexOf(i) + 1 : '') : i + 1}</b>${i === PF.sel && !PF.mode ? '<i class="h" data-h="nw"></i><i class="h" data-h="ne"></i><i class="h" data-h="sw"></i><i class="h" data-h="se"></i>' : ''}</div>`).join('')}</div></div>
    <div class="pfbtns"><button class="btn sm ${PF.mode === 'draw' ? 'primary' : ''}" id="pf_add">Add a panel</button><button class="btn sm" id="pf_del" ${PF.sel < 0 ? 'disabled' : ''}>Delete</button><button class="btn sm ${PF.mode === 'order' ? 'primary' : ''}" id="pf_ord">Set the order</button><button class="btn sm" id="pf_page">Whole page</button><button class="btn sm" id="pf_again">Start over</button><button class="btn sm danger" id="pf_auto">Back to automatic</button></div>`;
  $('#pf_x').onclick = () => $('#pnfix').remove(); $('#pf_ok').onclick = pfSave;
  $('#pf_add').onclick = () => { PF.mode = PF.mode === 'draw' ? '' : 'draw'; PF.sel = -1; pfDraw() };
  $('#pf_del').onclick = () => { if(PF.sel >= 0){ PF.boxes.splice(PF.sel, 1); PF.sel = -1; pfDraw() } };
  $('#pf_ord').onclick = () => { if(PF.mode === 'order'){ PF.mode = ''; PF.order = [] } else { PF.mode = 'order'; PF.order = []; PF.sel = -1 } pfDraw() };
  $('#pf_page').onclick = () => { PF.boxes = [[0, 0, 1, 1]]; PF.sel = -1; PF.mode = ''; pfDraw() };
  $('#pf_again').onclick = async () => { const store = await pnStoreGet(), rec = store.pages[PF.p]; if(rec) delete rec.found; R.pnFound.delete(PF.p); const f = await pnFound(PF.p); PF.boxes = f.steps.filter(s => s.kind !== 'page').map(s => s.box.slice()); PF.sel = -1; PF.mode = ''; pfDraw() };
  $('#pf_auto').onclick = async () => { const store = await pnStoreGet(), rec = store.pages[PF.p]; if(rec) delete rec.fixed; pnStoreSave(); R.pnFound.delete(PF.p); R.pnPlans && R.pnPlans.delete(PF.p); $('#pnfix').remove(); toast('Back to automatic for this page'); if(PN) pnOnPage() };
  const pg = $('#pfpage'); pg.onpointerdown = pfDown }
function pfPt(e){ const r = $('#pfpage').getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))] }
function pfDown(e){ const pg = $('#pfpage'), t = e.target.closest('.pfbox'), hd = e.target.closest('.h'); try{ pg.setPointerCapture(e.pointerId) }catch(x){}
  const p0 = pfPt(e);
  if(PF.mode === 'order'){ if(t){ const i = +t.dataset.i; if(PF.order.indexOf(i) < 0) PF.order.push(i); if(PF.order.length === PF.boxes.length){ PF.boxes = PF.order.map(j => PF.boxes[j]); PF.order = []; PF.mode = '' } pfDraw() } return }
  if(PF.mode === 'draw'){ const nb = [p0[0], p0[1], p0[0], p0[1]]; PF.boxes.push(nb); PF.sel = PF.boxes.length - 1; PF.drag = {kind:'new', b:nb, p0}; PF.mode = ''; pg.onpointermove = pfMove; pg.onpointerup = pfUp; pfDraw(); return }
  if(t){ const i = +t.dataset.i; PF.sel = i; const b = PF.boxes[i]; PF.drag = {kind:hd ? hd.dataset.h : 'move', b, p0, b0:b.slice()}; pg.onpointermove = pfMove; pg.onpointerup = pfUp; pfDraw(); return }
  PF.sel = -1; pfDraw() }
function pfMove(e){ const d = PF.drag; if(!d) return; const p = pfPt(e), b = d.b, dx = p[0] - d.p0[0], dy = p[1] - d.p0[1], c = v => Math.max(0, Math.min(1, v));
  if(d.kind === 'new'){ b[0] = Math.min(d.p0[0], p[0]); b[1] = Math.min(d.p0[1], p[1]); b[2] = Math.max(d.p0[0], p[0]); b[3] = Math.max(d.p0[1], p[1]) }
  else if(d.kind === 'move'){ const w = d.b0[2] - d.b0[0], h = d.b0[3] - d.b0[1], x0 = Math.max(0, Math.min(1 - w, d.b0[0] + dx)), y0 = Math.max(0, Math.min(1 - h, d.b0[1] + dy)); b[0] = x0; b[1] = y0; b[2] = x0 + w; b[3] = y0 + h }
  else { if(d.kind.includes('w')) b[0] = Math.min(c(d.b0[0] + dx), b[2] - .03); if(d.kind.includes('e')) b[2] = Math.max(c(d.b0[2] + dx), b[0] + .03); if(d.kind.includes('n')) b[1] = Math.min(c(d.b0[1] + dy), b[3] - .03); if(d.kind.includes('s')) b[3] = Math.max(c(d.b0[3] + dy), b[1] + .03) }
  const el = $(`.pfbox[data-i="${PF.sel}"]`); if(el){ el.style.left = b[0] * 100 + '%'; el.style.top = b[1] * 100 + '%'; el.style.width = (b[2] - b[0]) * 100 + '%'; el.style.height = (b[3] - b[1]) * 100 + '%' } }
function pfUp(){ const d = PF.drag; PF.drag = null; const pg = $('#pfpage'); if(pg){ pg.onpointermove = null; pg.onpointerup = null }
  if(d && d.kind === 'new' && (d.b[2] - d.b[0] < .04 || d.b[3] - d.b[1] < .03)){ PF.boxes.pop(); PF.sel = -1 } pfDraw() }
async function pfSave(){ const store = await pnStoreGet(); const steps = PF.boxes.filter(b => b[2] - b[0] > .02 && b[3] - b[1] > .02).map(b => ({box:b.map(n => +n.toFixed(4)), kind:'panel'}));
  if(!steps.length) steps.push({box:[0, 0, 1, 1], kind:'panel'});
  store.pages[PF.p] = Object.assign(store.pages[PF.p] || {}, {ratio:PF.ratio, fixed:{steps, at:Date.now()}}); pnStoreSave(); R.pnFound.delete(PF.p); R.pnPlans && R.pnPlans.delete(PF.p); $('#pnfix').remove();
  toast(PN ? 'Fix saved' : 'Fix saved – switch Panels on in the top bar to use it'); if(PN) pnOnPage() }

/* ============================== SHARING THE FIXES OF A BOOK ============================== */
async function pnShareSheet(){ if(!R) return; const store = await pnStoreGet(), fixed = Object.entries(store.pages).filter(([, r]) => r.fixed), b = R.b;
  sheet(`<h3>Panel fixes of this book</h3><p class="muted small" style="margin-top:0">${fixed.length ? `You fixed ${plural(fixed.length, 'page')} of “${esc(dispTitle(b))}”.` : 'You have not fixed any page of this book yet.'} The file holds only numbers – boxes and their order, no pictures – so it is safe to send to a friend who has the same book.</p>
    <div class="mlist"><button class="btn" id="px_out" ${fixed.length ? '' : 'disabled'}>Save my fixes to a file…</button><button class="btn" id="px_in">Use a file from a friend…</button></div>`);
  $('#px_out').onclick = () => pnExport(); $('#px_in').onclick = () => pnImportPick() }
async function pnExport(){ const store = await pnStoreGet(), b = R.b, pages = {}; for(const [p, r] of Object.entries(store.pages)) if(r.fixed) pages[p] = {ratio:+r.ratio.toFixed(4), steps:r.fixed.steps.map(s => ({box:s.box}))};
  const data = {app:'nightvault-bookcase', kind:'panels', v:1, book:{title:dispTitle(b), pages:R.n}, dir:R.rtl ? 'rtl' : 'ltr', pages}, text = JSON.stringify(data), safe = String(dispTitle(b)).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 50), name = `${safe}.panels.json`;
  try{ if(NATIVE){ const FS = Capacitor.registerPlugin('Filesystem'), SH = Capacitor.registerPlugin('Share'); const r = await FS.writeFile({path:name, data:text, directory:'CACHE', encoding:'utf8'}); await SH.share({title:name, files:[r.uri], dialogTitle:'Save or send ' + name}) }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:'application/json'})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000) }
    closeSheet() }catch(e){ if(!/cancel/i.test((e && e.message) || '')){ LE('panels', 'export', e); toast('Could not save the file: ' + (e.message || e), 4000) } } }
function pnImportPick(){ const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = async () => { const f = i.files[0]; if(f) pnImport(await f.text()) }; i.click() }
async function pnImport(text){ let d; try{ d = JSON.parse(text) }catch(e){ return toast('That is not a panels file') } if(!d || d.app !== 'nightvault-bookcase' || d.kind !== 'panels' || !d.pages) return toast('That is not a Bookcase panels file');
  if(d.book && d.book.pages && Math.abs(d.book.pages - R.n) > 0) return toast(`That file is for a book with ${d.book.pages} pages, this one has ${R.n}`, 4500);
  const store = await pnStoreGet(); let ok = 0, skip = 0;
  for(const [p, r] of Object.entries(d.pages)){ const n = +p; if(!(n >= 0 && n < R.n) || !r.steps || !r.steps.length){ skip++; continue }
    const m = await getImg(n).catch(() => null); if(m && Math.abs(m.w / m.h - r.ratio) > .03){ skip++; continue }
    store.pages[n] = Object.assign(store.pages[n] || {}, {ratio:r.ratio, fixed:{steps:r.steps.map(s => ({box:s.box.slice(0, 4).map(Number), kind:'panel'})), at:Date.now(), from:'file'}}); ok++ }
  pnStoreSave(); R.pnFound && R.pnFound.clear(); R.pnPlans && R.pnPlans.clear(); closeSheet(); toast(`${plural(ok, 'page')} fixed from the file${skip ? ` · ${skip} did not fit` : ''}`, 4000); if(PN) pnOnPage() }
