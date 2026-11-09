/* Nightvault Proxies (test) – print a deck as proxy cards. Plan: plans/proxy.md (nightvault-src).
   The sheet layout, cut guides and the small PDF writer are the same code as the PC app's "Print proxies" (pc/vault_ui.html); card lookup is cards.js.
   Storage: localStorage nvProxies.cfg / nvProxies.deck / nvProxies.decks; own pictures and your card back in IndexedDB "nvProxies". Nothing is uploaded. */
'use strict';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NATIVE = PXC.NATIVE;
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
const L = (t, d) => { try{ window.NVLOG && NVLOG.log('proxies', t, d) }catch(e){} };
const normNum = n => String(n).replace(/^0+(?=\d)/, '').toLowerCase();
const keyOf = n => PXC.lwr(String(n || '').split(' // ')[0]);
const PAPERS = {a4:[210, 297, 'A4'], letter:[215.9, 279.4, 'Letter'], legal:[215.9, 355.6, 'Legal'], a3:[297, 420, 'A3']};
const S = {game:'mtg', entries:[], busy:false, page:0, back:null,
  cfg:Object.assign({paper:'a4', dpi:300, scale:100, bleed:0, fill:'extend', gap:0, margin:8, guides:'ticks', backs:false, dfc:true, prefer:'new', sizes:{}}, lsGet('nvProxies.cfg', {}))};
const gameOf = id => PXC.GAMES.find(g => g.id === id) || PXC.GAMES[0];
const size = () => { const sz = S.cfg.sizes[S.game], g = gameOf(S.game).size; return {cw:+(sz ? sz[0] : g[0]), ch:+(sz ? sz[1] : g[1])} };

/* ---------------------------------------------------------------- own pictures (IndexedDB) */
let DB = null, ART = [];
const idb = () => DB ? Promise.resolve(DB) : new Promise((ok, no) => { const q = indexedDB.open('nvProxies', 1);
  q.onupgradeneeded = () => { const d = q.result; if(!d.objectStoreNames.contains('art')) d.createObjectStore('art', {keyPath:'id', autoIncrement:true}); if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv') };
  q.onsuccess = () => { DB = q.result; ok(DB) }; q.onerror = () => no(q.error) });
const tx = async (store, mode, fn) => { const d = await idb(); return new Promise((ok, no) => { const t = d.transaction(store, mode), s = t.objectStore(store), r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); t.onabort = () => no(t.error) }) };
const artLoad = async () => { ART = (await tx('art', 'readonly', s => s.getAll())) || [] };
const _urls = new Map();
const artUrl = id => { if(!_urls.has(id)){ const a = ART.find(x => x.id === id); if(!a) return ''; _urls.set(id, URL.createObjectURL(a.blob)) } return _urls.get(id) };
const customFor = name => ART.filter(a => (!a.game || a.game === S.game) && a.key === keyOf(name)).map(a => ({kind:'custom', id:a.id, label:a.label, name:a.name}));
async function artAdd(file, name, label){
  if(file.size > 15 * 1048576) throw new Error('That picture is too big (over 15 MB)');
  const id = await tx('art', 'readwrite', s => s.add({game:S.game, name:String(name).split(' // ')[0], key:keyOf(name), label:label || 'My art', blob:file, added:Date.now()}));
  await artLoad(); return id }
async function artDelete(id){ await tx('art', 'readwrite', s => s.delete(id)); if(_urls.has(id)){ URL.revokeObjectURL(_urls.get(id)); _urls.delete(id) } await artLoad() }

/* ---------------------------------------------------------------- deck lists */
function parseDeck(text){
  const map = new Map(); let skip = false;
  for(const raw of String(text).split(/\r?\n/)){
    let l = raw.trim(); if(!l || /^(\/\/|#)/.test(l)) continue;
    const sec = /^(deck|main|mainboard|sideboard|commander|companion|maybeboard|maybe|considering|tokens?)\s*:?\s*(\(\d+\))?$/i.exec(l);
    if(sec){ skip = /maybe|considering/i.test(sec[1]); continue }
    if(skip) continue;
    l = l.replace(/^(SB|MB|CMDR|COMPANION):\s*/i, '').replace(/\*[A-Za-z]+\*/g, '').replace(/\^[^^]*\^/g, '').replace(/\s+#\S+/g, '').trim();
    const m = /^(?:(\d+)\s*[xX]?\s+)?(.+?)$/.exec(l); if(!m) continue;
    let qty = m[1] ? +m[1] : 1, rest = m[2].trim(), set = '', number = '';
    if(!m[1]){ const tq = /^(.+?)\s+[xX]\s*(\d+)$/.exec(rest); if(tq){ rest = tq[1].trim(); qty = +tq[2] } }   // "Wellwisher x5"
    const sm = /^(.*?)\s*\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9★-]+)?\s*$/.exec(rest); if(sm){ rest = sm[1].trim(); set = sm[2].toLowerCase(); number = sm[3] || '' }
    if(!rest) continue;
    const key = rest.toLowerCase() + '|' + set + '|' + number, e = map.get(key); if(e) e.qty += qty; else map.set(key, {name:rest, qty, set, number});
  }
  return [...map.values()];
}

/* ---------------------------------------------------------------- finding the cards */
const same = (a, b) => a && b && a.kind === b.kind && (a.kind === 'custom' || a.kind === 'mpc' ? a.id === b.id : a.set === b.set && normNum(a.number) === normNum(b.number));
function pickIndex(cands, want){
  if(!cands.length) return -1;
  if(want && want.pick){ const i = cands.findIndex(c => same(c, want.pick)); if(i >= 0) return i }
  if(want && want.set){
    let i = cands.findIndex(c => c.kind === 'official' && c.set === want.set && (!want.number || normNum(c.number) === normNum(want.number)));
    if(i < 0) i = cands.findIndex(c => c.kind === 'official' && c.set === want.set);
    if(i >= 0) return i }
  const all = cands.map((c, i) => [c, i]), off = all.filter(([c]) => c.kind === 'official' && c.image), pool = off.length ? off : all, rel = c => c.released || '', pref = S.cfg.prefer;
  if(pref === 'old'){ const dated = pool.filter(([c]) => rel(c)); return [...(dated.length ? dated : pool)].sort((a, b) => rel(a[0]).localeCompare(rel(b[0])))[0][1] }
  if(pref === 'cheap'){ const pr = pool.filter(([c]) => c.price != null).sort((a, b) => a[0].price - b[0].price); if(pr.length) return pr[0][1] }
  return [...pool].sort((a, b) => rel(b[0]).localeCompare(rel(a[0])))[0][1];
}
async function resolveOne(item){
  const e = {name:item.name, qty:item.qty, cands:[], sel:-1, full:false}, customs = customFor(item.name); let off = [];
  try{
    if(S.game === 'other') e.full = true;
    else if(S.game === 'mtg' && S.cfg.prefer === 'new'){ const c = await PXC.one('mtg', item.name, item); if(c) off = [c]; await sleep(90) }   // one fast request per card; every printing loads when you open the card
    else { const all = await PXC.find(S.game, item.name); off = all.filter(c => PXC.sameName(c.name, item.name)); if(!off.length) off = all.filter(c => PXC.sim(c.name, item.name) >= 0.85); e.full = true }
  }catch(err){ e.err = err.message; L('lookup failed', {name:item.name, err:err.message}) }
  off.forEach(c => c.kind = 'official');
  e.cands = off.concat(customs); e.sel = pickIndex(e.cands, {set:item.set, number:item.number});
  return e;
}
async function resolveList(list, replace){
  const st = $('#status'), out = new Array(list.length); let next = 0, done = 0;
  const worker = async () => { while(next < list.length){ const k = next++; out[k] = await resolveOne(list[k]); st.textContent = `Looking up cards ${++done} / ${list.length} ...` } };
  await Promise.all(Array.from({length:Math.min(S.game === 'mtg' ? 3 : 4, list.length)}, worker));
  if(replace) S.entries = [];
  out.forEach(n => { const ex = S.entries.find(e => e.name.toLowerCase() === n.name.toLowerCase() && cur(e) && cur(n) && same(cur(e), cur(n))); if(ex) ex.qty += n.qty; else S.entries.push(n) });
  st.textContent = ''; save(); draw();
  const miss = out.filter(e => e.sel < 0), fail = out.filter(e => e.err);
  if(fail.length) toast(`${fail.length === out.length ? 'No card could be looked up' : fail.length + ' of ' + out.length + ' cards could not be looked up'}: ${fail[0].err}. Tap a card to try again.`);
  else if(miss.length) toast(`${miss.length} card${miss.length === 1 ? '' : 's'} not found - tap them to search`);
  return out;
}
const cur = e => e.sel >= 0 ? e.cands[e.sel] : null;
async function ensureAll(e){
  if(e.full || S.game === 'other') return; e.full = true;
  const now = cur(e);
  try{ const all = (await PXC.find(S.game, e.name)).filter(c => PXC.sameName(c.name, e.name)); all.forEach(c => c.kind = 'official');
    const rel = c => c.released || '', list = (all.length ? all : e.cands.filter(c => c.kind === 'official')).sort((a, b) => rel(b).localeCompare(rel(a)));
    if(now && now.kind === 'official' && !list.some(c => same(c, now))) list.unshift(now);
    e.cands = list.concat(customFor(e.name)); const i = e.cands.findIndex(c => same(c, now)); e.sel = i >= 0 ? i : pickIndex(e.cands, {}) }
  catch(err){ e.full = false; L('printings failed', {name:e.name, err:err.message}); throw err }
}

/* ---------------------------------------------------------------- saving the deck */
const store = e => { const c = cur(e); return {name:e.name, qty:e.qty, cand:c} };
const unstore = r => { const c = r.cand || null; return {name:r.name, qty:r.qty, cands:c ? [c] : [], sel:c ? 0 : -1, full:false} };
function save(){ lsSet('nvProxies.cfg', S.cfg); lsSet('nvProxies.deck', {game:S.game, entries:S.entries.map(store)}) }

/* ---------------------------------------------------------------- the sheet */
const visual = c => c.kind === 'custom' ? artUrl(c.id) : (c.image || '');
function layout(){
  const c = S.cfg, {cw: w0, ch: h0} = size(), [pw, ph] = PAPERS[c.paper], cw = w0 * c.scale / 100, ch = h0 * c.scale / 100, b = +c.bleed, gap = +c.gap, m = +c.margin;
  const cellW = cw + 2 * b, cellH = ch + 2 * b;
  const cols = Math.max(1, Math.floor((pw - 2 * m + gap + 1e-6) / (cellW + gap))), rows = Math.max(1, Math.floor((ph - 2 * m + gap + 1e-6) / (cellH + gap)));
  const gw = cols * cellW + (cols - 1) * gap, gh = rows * cellH + (rows - 1) * gap;
  return {pw, ph, cw, ch, b, gap, m, cols, rows, per:cols * rows, cellW, cellH, gw, gh, ox:(pw - gw) / 2, oy:(ph - gh) / 2, fits:gw <= pw + 0.01 && gh <= ph + 0.01};
}
const keyFor = (c, face) => c.kind === 'custom' ? 'c' + c.id : c.kind === 'mpc' ? 'm:' + c.id : `o:${c.set}:${c.number}:${face}`;
function prints(){                    // every card that goes on the sheet, in order; double-faced cards add their back face
  const out = [];
  S.entries.forEach((e, i) => { const c = cur(e); if(!c) return;
    for(let k = 0; k < e.qty; k++){ out.push({e:i, c, face:'front', key:keyFor(c, 'front')}); if(S.cfg.dfc && c.kind === 'official' && c.back) out.push({e:i, c, face:'back', key:keyFor(c, 'back')}) } });
  return out;
}
const ptMM = mm => (mm * 72 / 25.4).toFixed(2);
function pageOps(Lt, n, imgIdx, mirrored){
  let ops = '';
  const usedCols = Math.min(Lt.cols, n), usedRows = Math.ceil(n / Lt.cols), mx = x => mirrored ? Lt.pw - x : x;
  for(let i = 0; i < n; i++){
    const col = i % Lt.cols, row = Math.floor(i / Lt.cols), x0 = Lt.ox + col * (Lt.cellW + Lt.gap), y0 = Lt.ph - (Lt.oy + row * (Lt.cellH + Lt.gap)) - Lt.cellH, x = mirrored ? Lt.pw - x0 - Lt.cellW : x0;
    ops += `q ${ptMM(Lt.cellW)} 0 0 ${ptMM(Lt.cellH)} ${ptMM(x)} ${ptMM(y0)} cm /Im${imgIdx[i]} Do Q\n`;
  }
  const line = (x1, y1, x2, y2) => `${ptMM(mx(x1))} ${ptMM(y1)} m ${ptMM(mx(x2))} ${ptMM(y2)} l S\n`;
  const top = Lt.ph - Lt.oy, bottom = Lt.ph - (Lt.oy + usedRows * Lt.cellH + (usedRows - 1) * Lt.gap), left = Lt.ox, right = Lt.ox + usedCols * Lt.cellW + (usedCols - 1) * Lt.gap;
  const t = Math.min(4, Lt.m - 2), g = S.cfg.guides;
  if((g === 'ticks' || g === 'both') && t >= 1.5){
    ops += '0 G 0.3 w\n';
    for(let c = 0; c < usedCols; c++) for(const x of [left + c * (Lt.cellW + Lt.gap) + Lt.b, left + c * (Lt.cellW + Lt.gap) + Lt.b + Lt.cw]){ ops += line(x, top + 1.5, x, top + 1.5 + t) + line(x, bottom - 1.5, x, bottom - 1.5 - t) }
    for(let r = 0; r < usedRows; r++){ const yt = Lt.ph - (Lt.oy + r * (Lt.cellH + Lt.gap) + Lt.b); for(const y of [yt, yt - Lt.ch]){ ops += line(left - 1.5, y, left - 1.5 - t, y) + line(right + 1.5, y, right + 1.5 + t, y) } }
  }
  if((g === 'lines' || g === 'both') && Lt.gap > 0){
    ops += '0.45 G 0.25 w\n';
    for(let c = 0; c < usedCols - 1; c++){ const x = left + c * (Lt.cellW + Lt.gap) + Lt.cellW + Lt.gap / 2; ops += line(x, top, x, bottom) }
    for(let r = 0; r < usedRows - 1; r++){ const y = Lt.ph - (Lt.oy + r * (Lt.cellH + Lt.gap) + Lt.cellH + Lt.gap / 2); ops += line(left, y, right, y) }
  }
  return ops;
}
function pdfBuild(pages, imgs, pwMM, phMM){
  const te = new TextEncoder(), parts = [], offsets = []; let pos = 0;
  const push = u => { parts.push(u); pos += u.length }, pushS = s => push(te.encode(s)), start = n => { offsets[n] = pos; pushS(`${n} 0 obj\n`) };
  pushS('%PDF-1.4\n');
  const first = 3, firstPage = first + imgs.length;
  start(1); pushS('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  start(2); pushS(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, k) => `${firstPage + 2 * k + 1} 0 R`).join(' ')}] >>\nendobj\n`);
  imgs.forEach((im, i) => { start(first + i); pushS(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`); push(im.data); pushS('\nendstream\nendobj\n') });
  pages.forEach((pg, k) => {
    const c = firstPage + 2 * k, content = te.encode(pg.ops);
    start(c); pushS(`<< /Length ${content.length} >>\nstream\n`); push(content); pushS('\nendstream\nendobj\n');
    start(c + 1); pushS(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptMM(pwMM)} ${ptMM(phMM)}] /Contents ${c} 0 R /Resources << /XObject << ${pg.used.map(i => `/Im${i} ${first + i} 0 R`).join(' ')} >> >> >>\nendobj\n`);
  });
  const total = firstPage + 2 * pages.length, xref = pos;
  pushS(`xref\n0 ${total}\n0000000000 65535 f \n`); for(let n = 1; n < total; n++) pushS(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
  pushS(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type:'application/pdf'});
}
async function renderCard(img, Lt, dpi, fill){
  const px = mm => Math.round(mm / 25.4 * dpi), W = px(Lt.cellW), H = px(Lt.cellH), b = px(Lt.b), tw = px(Lt.cw), th = px(Lt.ch);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
  if(Lt.b > 0){ if(fill === 'extend') g.drawImage(img, 0, 0, W, H); else { g.fillStyle = fill === 'white' ? '#fff' : '#000'; g.fillRect(0, 0, W, H) } }
  g.drawImage(img, b, b, tw, th);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.93)); cv.width = cv.height = 1;
  return {data:new Uint8Array(await blob.arrayBuffer()), w:W, h:H};
}

/* ---------------------------------------------------------------- pictures for printing */
const BLOBS = new Map();
async function getBlob(url){
  if(BLOBS.has(url)) return BLOBS.get(url);
  let b = null;
  try{ const r = await fetch(url, {mode:'cors'}); if(r.ok) b = await r.blob() }catch(e){}
  if(!b || !b.size){ const H = NATIVE && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;      // the Android app asks with Android's own connection (no CORS)
    if(H) try{ const r = await H.get({url, responseType:'blob'}); if(r.status < 400 && r.data){ const bin = atob(r.data), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      b = new Blob([u], {type:(r.headers && (r.headers['Content-Type'] || r.headers['content-type'])) || 'image/jpeg'}) } }catch(e){} }
  if(!b || !b.size) throw new Error('blocked');
  if(BLOBS.size > 30) BLOBS.delete(BLOBS.keys().next().value); BLOBS.set(url, b); return b;
}

/* ---------------------------------------------------------------- pictures saved on this phone (Card pictures: <game>/<set code> - <set name>/<number>_<name>.jpg|webp) */
const SAVED = (() => {
  let NV = null; if(NATIVE) try{ NV = Capacitor.registerPlugin('NvFiles') }catch(e){ NV = null }
  const cache = new Map(), stat = {hit:0, miss:0}, b64url = t => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const safe = t => window.NVCARDS ? NVCARDS.safe(t, 20) : String(t);
  const dec = t => t.replace(/~u/g, '_').replace(/~s/g, '/').replace(/~w/g, ' ');
  const folder = () => (window.NVCARDS && NVCARDS.folder && NVCARDS.folder()) || null;
  const on = () => !!(NV && folder() && S.cfg.saved !== false);
  async function ls(sub){ const fo = folder(), k = fo.tree + '|' + sub; if(!cache.has(k)) cache.set(k, NV.listDir({tree:fo.tree, sub}).then(r => r.found ? r.entries : null).catch(e => { cache.delete(k); L('saved list failed', {sub, err:e.message}); return null }));
    return cache.get(k) }
  async function url(game, c, face){
    if(!on() || !c || c.kind !== 'official' || !c.set) return null;
    const games = await ls(game); if(!games) return null;
    const pre = safe(c.set) + ' - ', set = games.find(x => x.dir && x.name.startsWith(pre)); if(!set) return null;
    let sub = game + '/' + set.name, files = await ls(sub); if(!files) return null;
    const nd = files.find(x => x.dir && x.name === 'Normal'); if(nd){ sub += '/Normal'; files = await ls(sub); if(!files) return null }      // Star Wars: Unlimited keeps a folder per version
    const want = normNum(c.number), back = face === 'back';
    const f = files.find(x => { if(x.dir) return false; const m = /^([^_]+)_.*?(_back)?\.(jpe?g|png|webp)$/i.exec(x.name); return m && normNum(dec(m[1])) === want && !!m[2] === back });
    return f ? '/_nvfile_/' + b64url(f.uri) + '/' + encodeURIComponent(f.name) : null;
  }
  return {on, url, stat, reset:() => { stat.hit = stat.miss = 0 }};
})();

/* ---------------------------------------------------------------- Card maker: the owner's own offline copy of a web card maker (Card Conjurer), opened from a folder on the phone.
   Nightvault ships none of it: the owner downloads it himself, puts the folder on the phone and chooses it here. It runs on its own address
   (cardmaker.nightvault.local, served by the Android app from that folder) so it cannot read Nightvault's data. Android only. */
const CM = (() => {
  let NV = null; if(NATIVE) try{ NV = Capacitor.registerPlugin('NvFiles') }catch(e){ NV = null }
  const KEY = 'nvProxies.cmFolder', HOST = 'https://cardmaker.nightvault.local/index.html';
  let ov = null;
  const folder = () => lsGet(KEY, null);
  const isOpen = () => !!ov;
  function close(){ if(!ov) return false; ov.remove(); ov = null; return true }
  async function use(tree){ const r = await NV.siteOpen({tree}); return r && r.hasIndex }
  async function choose(){
    const r = await NV.pickFolder(); const ok = await use(r.tree);
    if(!ok){ toast('index.html was not found in that folder - choose the folder that contains index.html'); return false }
    lsSet(KEY, {tree:r.tree, name:r.name}); return true }
  function frame(){
    ov.innerHTML = `<div class="cmbar"><b>Card maker</b><span class="muted small" style="flex:1">saved cards are added to your deck</span><button class="btn sm" id="cmx">Close</button></div><iframe id="cmf" src="${HOST}" allow="clipboard-read; clipboard-write"></iframe>`;
    $('#cmx', ov).onclick = close }
  async function screen(){
    if(!NV){ toast('The card maker works in the Android app only'); return }
    close(); ov = document.createElement('div'); ov.id = 'cmov'; document.body.appendChild(ov);
    const fo = folder(); let ok = false;
    if(fo){ try{ ok = await use(fo.tree) }catch(e){ ok = false } }
    if(ok){ frame(); return }
    ov.innerHTML = `<div class="cmbar"><b>Card maker</b><span style="flex:1"></span><button class="btn sm" id="cmx">Close</button></div>
      <div class="cmint"><h3>Your own copy of a card maker</h3>
      <p>Nightvault does not include a card maker, or any card frames. If you want one, download an offline copy yourself (for example the Card Conjurer files from its GitHub page: Code, then Download ZIP), unzip it, and copy the folder to this phone.</p>
      <p>Then choose the folder that contains <b>index.html</b>. It opens inside Proxies, works without internet, and the cards you save are added to your deck as your own pictures.</p>
      <p class="muted small">${fo ? 'The folder you chose before could not be read: ' + esc(fo.name) + '.' : 'No folder chosen yet.'} You make the cards for your own printing; check the licence of whatever you download.</p>
      <div class="row"><button class="btn primary" id="cmpick">Choose the folder</button></div></div>`;
    $('#cmx', ov).onclick = close;
    $('#cmpick', ov).onclick = async () => { try{ if(await choose()) frame() }catch(e){ toast(e.message || 'Could not use that folder') } } }
  window.addEventListener('message', async ev => {
    const d = ev.data; if(!ov || !d || d.nvcm !== 'save') return;
    try{ const bin = atob(d.b64 || ''), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const blob = new Blob([u], {type:d.type}), name = String(d.name || 'card').replace(/\.[A-Za-z0-9]+$/, '').trim() || 'Card';
      if(/^image\//.test(d.type)){ const f = new File([blob], d.name || 'card.png', {type:d.type}), id = await artAdd(f, name, 'Card maker');
        S.entries.push({name, qty:1, cands:[{kind:'custom', id, label:'Card maker', name}], sel:0, full:true}); save(); draw(); toast(`“${name}” was added to your deck as your own picture`) }
      else { await deliver(blob, d.name || 'card-maker-file'); toast('Saved: ' + (d.name || 'file')) }
    }catch(e){ toast('Could not save that: ' + e.message); L('card maker save failed', e.message) } });
  return {screen, close, isOpen};
})();
async function bitmapFor(p, dpi){
  const c = p.c, hq = dpi >= 450;
  if(c.kind === 'custom'){ const a = ART.find(x => x.id === c.id); return a ? createImageBitmap(a.blob) : null }
  if(SAVED.on() && c.kind === 'official'){ const su = await SAVED.url(S.game, c, p.face).catch(() => null);
    if(su){ try{ const bm = await createImageBitmap(await getBlob(su)); SAVED.stat.hit++; return bm }catch(e){ L('saved picture failed', {url:su, err:e.message}) } } SAVED.stat.miss++ }
  const urls = (p.face === 'back' ? [hq && c.backHq, c.back] : [hq && c.hq, c.print, c.image, ...(c.alts || [])]).filter(Boolean);
  for(const u of urls){ try{ return await createImageBitmap(await getBlob(u)) }catch(e){ L('picture failed', {url:u, err:e.message}) } }
  return null;
}
function placeholder(p){          // a plain card with the name, for a picture that could not be loaded
  const cv = document.createElement('canvas'); cv.width = 504; cv.height = 704; const g = cv.getContext('2d');
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 504, 704); g.strokeStyle = '#555'; g.lineWidth = 6; g.strokeRect(20, 20, 464, 664);
  g.fillStyle = '#222'; g.textAlign = 'center'; g.font = 'bold 38px sans-serif';
  const words = String(p.c.name || '').split(' '), lines = []; let ln = '';
  for(const w of words){ if((ln + ' ' + w).trim().length > 18){ lines.push(ln); ln = w } else ln = (ln + ' ' + w).trim() } if(ln) lines.push(ln);
  lines.slice(0, 6).forEach((t, i) => g.fillText(t, 252, 120 + i * 48));
  g.font = '24px sans-serif'; g.fillStyle = '#666'; g.fillText((p.c.showSet || '') + (p.c.showNum ? ' #' + p.c.showNum : ''), 252, 600); g.fillText('picture not loaded', 252, 640);
  return cv;
}
async function buildPdf(onStatus){
  const list = prints(); if(!list.length) throw new Error('The deck is empty - import a deck list first');
  SAVED.reset(); const Lt = layout(), dpi = +S.cfg.dpi, say = onStatus || (() => {}), index = new Map(), imgs = [], failed = [];
  const uniq = [...new Map(list.map(p => [p.key, p])).values()], need = uniq.length + (S.cfg.backs ? 1 : 0); let done = 0;
  for(const p of uniq){
    say(`Preparing card pictures ${++done} / ${need} ...`);
    let bm = await bitmapFor(p, dpi); if(!bm){ failed.push(p.c.name); bm = placeholder(p) }
    index.set(p.key, imgs.length); imgs.push(await renderCard(bm, Lt, dpi, S.cfg.fill)); if(bm.close) bm.close(); await sleep(0);
  }
  let backIdx = -1;
  if(S.cfg.backs){
    say(`Preparing card pictures ${++done} / ${need} ...`);
    let bm; if(S.back){ bm = await createImageBitmap(S.back) } else { const cv = document.createElement('canvas'); cv.width = 504; cv.height = 704; const g = cv.getContext('2d'); g.fillStyle = '#1c2230'; g.fillRect(0, 0, 504, 704);
      g.strokeStyle = '#c9a24a'; g.lineWidth = 6; g.strokeRect(24, 24, 456, 656); g.lineWidth = 2; for(let y = 60; y < 680; y += 44) for(let x = 60; x < 480; x += 44){ g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x + 18, y); g.lineTo(x, y + 18); g.lineTo(x - 18, y); g.closePath(); g.stroke() } bm = cv }
    backIdx = imgs.length; imgs.push(await renderCard(bm, Lt, dpi, S.cfg.fill));
  }
  say('Building the PDF ...');
  const pages = [];
  for(let s = 0; s < list.length; s += Lt.per){
    const slice = list.slice(s, s + Lt.per), idx = slice.map(p => index.get(p.key));
    pages.push({ops:pageOps(Lt, slice.length, idx, false), used:[...new Set(idx)]});
    if(S.cfg.backs) pages.push({ops:pageOps(Lt, slice.length, slice.map(() => backIdx), true), used:[backIdx]});
  }
  return {blob:pdfBuild(pages, imgs, Lt.pw, Lt.ph), cards:list.length, pages:pages.length, failed, saved:{...SAVED.stat}};
}
const blobB64 = b => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => no(r.error); r.readAsDataURL(b) });
async function deliver(blob, name){
  if(NATIVE){ const FS = Capacitor.registerPlugin('Filesystem'), SH = Capacitor.registerPlugin('Share');
    const r = await FS.writeFile({path:name, data:await blobB64(blob), directory:'CACHE'});
    try{ await SH.share({title:name, files:[r.uri], dialogTitle:'Save or send ' + name}) }catch(e){ if(!/cancel/i.test(String(e && e.message))) throw e } return }
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:name}); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
async function makePdf(){
  if(S.busy) return; const st = $('#status'); S.busy = true; $('#pdf').disabled = true;
  try{ const r = await buildPdf(t => st.textContent = t), name = ($('#dname').value.trim() || 'proxies').replace(/[^\w\- ]+/g, '') + '.pdf';
    await deliver(r.blob, name);
    st.textContent = `Done - ${r.cards} cards on ${r.pages} page${r.pages === 1 ? '' : 's'} (${(r.blob.size / 1048576).toFixed(1)} MB).` + (r.failed.length ? ` ${r.failed.length} picture${r.failed.length === 1 ? '' : 's'} could not be loaded and got a plain card with the name: ${[...new Set(r.failed)].slice(0, 5).join(', ')}${r.failed.length > 5 ? ' …' : ''}. Tap the card to pick another picture or use your own.` : '');
    if(SAVED.on()) st.textContent += ` ${r.saved.hit} picture${r.saved.hit === 1 ? '' : 's'} came from this phone, ${r.saved.miss} from the internet.`;
    L('pdf made', {cards:r.cards, pages:r.pages, failed:r.failed.length, saved:r.saved});
  }catch(e){ st.textContent = ''; toast(e.message); L('pdf failed', e.message) }
  finally{ S.busy = false; $('#pdf').disabled = !prints().length }
}

/* ---------------------------------------------------------------- the screen */
function toast(t){ const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 3800) }
function tileVisual(c){ const u = visual(c); return u ? `<img loading="lazy" src="${esc(u)}" alt="">` : `<div class="pnone"><span>${esc(c.name || '')}</span></div>` }
function draw(){
  const {cw, ch} = size(), g = gameOf(S.game);
  $('#game').value = S.game; $('#cw').value = cw; $('#ch').value = ch;
  $('#sizes').innerHTML = PXC.SIZES.map(([n, w, h]) => `<button class="chip ${w === cw && h === ch ? 'on' : ''}" data-w="${w}" data-h="${h}">${esc(n)}</button>`).join('');
  $$('#sizes .chip').forEach(b => b.onclick = () => { S.cfg.sizes[S.game] = [+b.dataset.w, +b.dataset.h]; save(); draw() });
  $('#tiles').style.setProperty('--cr', `${cw} / ${ch}`);
  $('#tiles').innerHTML = S.entries.length ? S.entries.map((e, i) => { const c = cur(e);
    return `<div class="tile ${c ? '' : 'miss'}"><button class="pv" data-pick="${i}" aria-label="Choose the art for ${esc(e.name)}">${c ? tileVisual(c) : `<div class="pnone"><div>${e.err ? 'Could not load' : 'No match'}</div><span>${e.err ? 'Tap to try again' : 'Tap to search'}</span></div>`}</button><span class="q">× ${e.qty}</span>
      <div class="tn" title="${esc(e.name)}">${esc(e.name)}</div><div class="ts">${c ? (c.kind === 'custom' ? `<span class="pill p-amber">Proxy</span>${esc(c.label)}` : c.kind === 'mpc' ? `<span class="pill p-amber">Community</span>${esc(c.artist)}` : `<span class="pill p-blue">${esc(c.showSet || c.set)}</span>#${esc(c.showNum || c.number)}${c.back ? ' · 2-faced' : ''}`) : ''}</div>
      <div class="qb"><button data-q="${i}" data-d="-1" aria-label="One less">−</button><button data-q="${i}" data-d="1" aria-label="One more">+</button><button data-rm="${i}" aria-label="Remove">✕</button></div></div>` }).join('')
    : `<div class="empty">Paste a deck list above and tap <b>Import deck</b>.<br>Every card gets its picture; tap one to choose another art or edition.</div>`;
  $$('#tiles [data-pick]').forEach(b => b.onclick = () => openChooser(+b.dataset.pick));
  $$('#tiles [data-q]').forEach(b => b.onclick = () => { const e = S.entries[+b.dataset.q]; e.qty = Math.max(1, e.qty + +b.dataset.d); save(); draw() });
  $$('#tiles [data-rm]').forEach(b => b.onclick = () => { S.entries.splice(+b.dataset.rm, 1); save(); draw() });
  const Lt = layout(), n = prints().length, pages = Math.ceil(n / Lt.per) * (S.cfg.backs ? 2 : 1), miss = S.entries.filter(e => !cur(e)).length;
  $('#deckn').textContent = S.entries.length ? `${S.entries.length} different` : '';
  $('#sum').innerHTML = n ? `<b>${n} cards · ${pages} page${pages === 1 ? '' : 's'}</b>${Lt.cols} × ${Lt.rows} per page${miss ? ` · ${miss} not found` : ''}` : '<b>No cards yet</b>Paste a deck list to start';
  $('#pdf').disabled = !n || S.busy;
  $('#backrow').hidden = !S.cfg.backs; $('#backx').hidden = !S.back; $('#backname').textContent = S.back ? (S.back.name || 'your own back') : 'a plain pattern is used';
  const w = $('#warn'), msg = !Lt.fits ? 'The cards do not fit on this paper - lower the size, bleed or gap.' : (S.cfg.guides !== 'none' && S.cfg.guides !== 'lines' && Lt.m < 4 ? 'Cut marks need a page margin of about 4 mm or more.' : (S.cfg.guides === 'lines' && Lt.gap <= 0 ? 'Lines between cards need a gap of at least 1 mm.' : ''));
  w.hidden = !msg; w.textContent = msg; preview();
}
function preview(){
  const el = $('#prev'), Lt = layout(), list = prints(), pages = Math.max(1, Math.ceil(list.length / Lt.per)); S.page = Math.min(S.page, pages - 1);
  $('#pn').textContent = `Page ${S.page + 1} / ${pages}`; $('#pp').disabled = S.page <= 0; $('#pnx').disabled = S.page >= pages - 1;
  if(!list.length){ el.innerHTML = '<div class="muted small">The sheet appears here once the deck has cards.</div>'; return }
  const sl = list.slice(S.page * Lt.per, S.page * Lt.per + Lt.per), pc = (x, w) => `${(x / w * 100).toFixed(3)}%`;
  const box = (x, y, w, h, cls, inner) => `<div class="${cls}" style="left:${pc(x, Lt.pw)};top:${pc(y, Lt.ph)};width:${pc(w, Lt.pw)};height:${pc(h, Lt.ph)}">${inner || ''}</div>`;
  el.innerHTML = `<div class="sheetp" style="aspect-ratio:${Lt.pw} / ${Lt.ph}">` + sl.map((p, i) => { const col = i % Lt.cols, row = Math.floor(i / Lt.cols), x = Lt.ox + col * (Lt.cellW + Lt.gap), y = Lt.oy + row * (Lt.cellH + Lt.gap);
    return (Lt.b > 0 ? box(x, y, Lt.cellW, Lt.cellH, 'bl') : '') + box(x + Lt.b, y + Lt.b, Lt.cw, Lt.ch, 'shc', p.face === 'back' ? '<div class="pnone" style="height:100%;color:#aaa">back face</div>' : tileVisual(p.c)) }).join('') + '</div>';
}

/* ---------------------------------------------------------------- sheets (pop-ups from the bottom) */
function openSheet(html){ closeSheet(); const d = document.createElement('div'); d.className = 'scrim'; d.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  d.onclick = e => { if(e.target === d) closeSheet() }; $('#sheets').appendChild(d); return d.firstElementChild }
function closeSheet(){ const had = $('#sheets').children.length; $('#sheets').innerHTML = ''; if(had){ save(); draw() } return !!had }
async function openChooser(i){
  const e = S.entries[i]; if(!e) return;
  const sh = openSheet(`<h3>${esc(e.name)}</h3><div class="muted small">Choose the art or edition to print</div><div id="chbody"><div class="muted" style="margin:14px 0">Loading the printings ...</div></div>
    <div class="note"><b>Community art</b> <span class="muted">(proxy art made by the MPC Autofill artists - Android app; the artist is shown, use it for your own printing)</span>
      <div class="row" style="margin-top:8px"><button class="btn" id="mpcgo">Search community art</button></div><div id="mpcres"></div></div>
    <div class="note"><b>Use my own picture</b> <span class="muted">(a proxy you made, or any scan - JPG, PNG or WEBP)</span>
      <div class="row" style="margin-top:8px"><input type="text" id="artlabel" placeholder="Label, e.g. Hand-painted" style="flex:1;min-width:120px"><button class="btn" id="artpick">Choose picture</button></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="chx">Done</button></div>`);
  $('#chx', sh).onclick = closeSheet;
  const draw2 = () => {
    const body = $('#chbody', sh); if(!body) return;
    body.innerHTML = e.cands.length ? `<div class="opts">` + e.cands.map((c, k) => `<div class="opt ${k === e.sel ? 'on' : ''}" data-k="${k}"><div class="pv">${tileVisual(c)}</div>
        <div class="oc">${c.kind === 'mpc' ? `<span class="pill p-amber">Community</span><b>${esc(c.artist)}</b><div class="muted">${c.dpi} dpi${c.language && c.language !== 'EN' ? ' · ' + esc(c.language) : ''} · ${c.sizeMB} MB</div>` : c.kind === 'custom' ? `<span class="pill p-amber">Proxy</span>${esc(c.label)} <button class="btn sm danger" data-del="${c.id}" style="height:24px;padding:0 8px">Delete</button>` : `<span class="pill p-blue">${esc(c.showSet || c.set)}</span><b>#${esc(c.showNum || c.number)}</b><div class="muted">${esc(c.setName || '')}${c.released ? ' · ' + esc(c.released.slice(0, 4)) : ''}${c.price != null ? ' · ' + (c.currency === 'EUR' ? '€' : '$') + Number(c.price).toFixed(2) : ''}${c.back ? ' · 2-faced' : ''}</div>`}</div></div>`).join('') + `</div>`
      : `<div class="muted" style="margin:10px 0">No card called “${esc(e.name)}” was found. Search for the right name, or add your own picture below.</div>
         <div class="row"><input type="text" id="findname" list="names" placeholder="Search card names" style="flex:1;min-width:0" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false"><button class="btn" id="findgo">Use this name</button></div>`;
    $$('.opt', body).forEach(o => o.onclick = ev => { if(ev.target.closest('[data-del]')) return; e.sel = +o.dataset.k; closeSheet() });
    $$('[data-del]', body).forEach(b => b.onclick = async () => { const id = +b.dataset.del; await artDelete(id); const was = cur(e); e.cands = e.cands.filter(c => !(c.kind === 'custom' && c.id === id)); e.sel = was && !(was.kind === 'custom' && was.id === id) ? e.cands.findIndex(c => same(c, was)) : pickIndex(e.cands, {}); draw2() });
    const fg = $('#findgo', body); if(fg) fg.onclick = async () => { const n = $('#findname', body).value.trim(); if(!n) return; fg.disabled = true; const r = await resolveOne({name:n, qty:e.qty, set:'', number:''}); if(r.sel < 0){ toast(r.err ? 'Could not look it up: ' + r.err : 'Still no match for that name'); fg.disabled = false; return } delete e.err; Object.assign(e, r); closeSheet() };
  };
  draw2();
  $('#mpcgo', sh).onclick = async () => { const b = $('#mpcgo', sh), out = $('#mpcres', sh); b.disabled = true; out.innerHTML = '<div class="muted" style="margin:8px 0">Searching ...</div>';
    try{ const list = await PXC.mpcSearch(e.name, 40); if(!$('#mpcres', sh)) return;
      out.innerHTML = list.length ? `<div class="opts" style="margin-top:8px">` + list.map((c, k) => `<div class="opt" data-m="${k}"><div class="pv">${tileVisual(c)}</div><div class="oc"><span class="pill p-amber">Community</span><b>${esc(c.artist)}</b><div class="muted">${c.dpi} dpi${c.language && c.language !== 'EN' ? ' · ' + esc(c.language) : ''} · ${c.sizeMB} MB</div></div></div>`).join('') + `</div>` : '<div class="muted" style="margin:8px 0">No community art found for this name.</div>';
      $$('[data-m]', out).forEach(o => o.onclick = () => { const c = list[+o.dataset.m]; const have = e.cands.findIndex(x => same(x, c)); if(have < 0) e.cands.push(c); e.sel = have < 0 ? e.cands.length - 1 : have; toast('Community art by ' + c.artist + ' selected'); closeSheet() });
    }catch(x){ L('mpc search failed', {name:e.name, err:x.message}); if($('#mpcres', sh)) out.innerHTML = `<div class="note warn" style="margin:8px 0">${esc(x.message)}</div>` }
    b.disabled = false };
  $('#artpick', sh).onclick = () => { const p = $('#pickart'); p.onchange = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if(!f) return;
    try{ const id = await artAdd(f, e.name, $('#artlabel', sh).value.trim() || 'My art'); e.cands.push({kind:'custom', id, label:$('#artlabel', sh).value.trim() || 'My art', name:e.name}); e.sel = e.cands.length - 1; toast('Your picture was added and selected'); closeSheet() }catch(x){ toast(x.message) } }; p.click() };
  if(e.err && !e.cands.some(c => c.kind === 'official')){ const r = await resolveOne({name:e.name, qty:e.qty, set:'', number:''}); if(!r.err || r.sel >= 0){ delete e.err; Object.assign(e, r); draw() } else e.err = r.err; if($('#chbody', sh)) draw2() }
  try{ await ensureAll(e); if($('#chbody', sh)) draw2() }catch(x){ const b = $('#chbody', sh); if(b) b.insertAdjacentHTML('afterbegin', `<div class="note warn">Could not load more printings: ${esc(x.message)}</div>`) }
}

/* ---------------------------------------------------------------- saved decks */
const decksGet = () => lsGet('nvProxies.decks', []);
function decksDraw(){
  const el = $('#decks'), list = decksGet();
  el.innerHTML = list.length ? list.map(d => `<div class="dl"><div class="grow"><b>${esc(d.name)}</b><div class="muted small">${esc(gameOf(d.game).label)} · ${d.entries.reduce((a, e) => a + e.qty, 0)} cards</div></div><button class="btn sm" data-load="${d.id}">Open</button><button class="btn sm danger" data-rmd="${d.id}" aria-label="Delete">✕</button></div>`).join('') : '<div class="muted small">Nothing saved yet.</div>';
  $$('#decks [data-load]').forEach(b => b.onclick = () => { const d = decksGet().find(x => x.id === +b.dataset.load); if(!d) return;
    S.game = d.game; Object.assign(S.cfg, d.cfg || {}); S.cfg.sizes = Object.assign({}, S.cfg.sizes, (d.cfg || {}).sizes || {}); S.entries = d.entries.map(unstore); $('#dname').value = d.name; $('#prefer').value = S.cfg.prefer; syncInputs(); save(); draw(); toast('Deck opened') });
  $$('#decks [data-rmd]').forEach(b => b.onclick = () => { lsSet('nvProxies.decks', decksGet().filter(x => x.id !== +b.dataset.rmd)); decksDraw() });
}
function saveDeck(){
  const name = $('#dname').value.trim() || 'My deck', list = decksGet(), old = list.find(d => d.name === name && d.game === S.game), rec = {id:old ? old.id : Date.now(), name, game:S.game, entries:S.entries.map(store), cfg:S.cfg, at:Date.now()};
  lsSet('nvProxies.decks', (old ? list.map(d => d.id === old.id ? rec : d) : [rec, ...list]).slice(0, 60)); decksDraw(); toast('Deck saved');
}

/* ---------------------------------------------------------------- wiring */
const CFGIN = ['paper', 'dpi', 'scale', 'gap', 'bleed', 'fill', 'margin', 'guides'];
function syncInputs(){ CFGIN.forEach(k => { $('#' + k).value = S.cfg[k] }); $('#dfc').checked = !!S.cfg.dfc; $('#saved').checked = S.cfg.saved !== false; $('#savedrow').hidden = !NATIVE; $('#backs').checked = !!S.cfg.backs; $('#prefer').value = S.cfg.prefer; $('#game').value = S.game }
function clearDeck(){ S.entries = []; save(); draw() }
async function doImport(replace){
  const list = parseDeck($('#text').value); if(!list.length){ toast('No cards found in that list'); return }
  $('#imp').disabled = $('#add').disabled = true;
  try{ await resolveList(list, replace); $('#text').value = '' }catch(e){ $('#status').textContent = ''; toast(e.message) }
  finally{ $('#imp').disabled = $('#add').disabled = false }
}
function wire(){
  $('#game').innerHTML = PXC.GAMES.map(g => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
  $('#paper').innerHTML = Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v[2]}</option>`).join('');
  syncInputs();
  $('#game').onchange = e => { if(S.entries.length && !confirm('Switching game clears the deck. Continue?')){ e.target.value = S.game; return } S.game = e.target.value; S.entries = []; save(); draw() };
  const setSize = () => { const w = +$('#cw').value, h = +$('#ch').value; if(w >= 20 && h >= 20){ S.cfg.sizes[S.game] = [w, h]; save(); draw() } };
  $('#cw').onchange = $('#ch').onchange = setSize;
  CFGIN.forEach(k => { const el = $('#' + k); el.onchange = () => { S.cfg[k] = el.type === 'number' ? (+el.value || 0) : (k === 'dpi' ? +el.value : el.value); save(); draw() } });
  $('#saved').onchange = e => { S.cfg.saved = e.target.checked; save() };
  $('#dfc').onchange = e => { S.cfg.dfc = e.target.checked; save(); draw() }; $('#backs').onchange = e => { S.cfg.backs = e.target.checked; save(); draw() };
  $('#prefer').onchange = e => { S.cfg.prefer = e.target.value; save() };
  $('#imp').onclick = () => doImport(true); $('#add').onclick = () => doImport(false);
  $('#file').onchange = async e => { if(e.target.files[0]){ $('#text').value = await e.target.files[0].text(); e.target.value = ''; doImport(true) } };
  let nt; $('#one').oninput = e => { clearTimeout(nt); nt = setTimeout(async () => { const q = e.target.value.trim(); $('#names').innerHTML = (await PXC.suggest(S.game, q)).map(n => `<option value="${esc(n)}">`).join('') }, 200) };
  const addOne = () => { const n = $('#one').value.trim(); if(!n) return; $('#text').value = n; $('#one').value = ''; doImport(false) };
  $('#onego').onclick = addOne; $('#one').onkeydown = e => { if(e.key === 'Enter') addOne() };
  $('#back').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if(!f) return; S.back = f; try{ await tx('kv', 'readwrite', s => s.put(f, 'back')) }catch(x){} draw() };
  $('#backx').onclick = async () => { S.back = null; try{ await tx('kv', 'readwrite', s => s.delete('back')) }catch(x){} draw() };
  $('#pp').onclick = () => { S.page = Math.max(0, S.page - 1); preview() }; $('#pnx').onclick = () => { S.page++; preview() };
  $('#pdf').onclick = makePdf; $('#dsave').onclick = saveDeck;
  $('#setbtn').onclick = () => { const d = $('#sheetset'); d.open = true; d.scrollIntoView({behavior:'smooth', block:'start'}) };
}
const fromHub = () => { try{ return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
if(window.Capacitor) try{ const A = (Capacitor.Plugins && Capacitor.Plugins.App) || Capacitor.registerPlugin('App');
  A.addListener('backButton', () => { if(window.NVMENU && NVMENU.close()) return; if(window.NVCARDS && NVCARDS.close()) return; if(CM.close()) return; if(closeSheet()) return; if(fromHub()){ location.href = '../hub/index.html'; return } A.minimizeApp && A.minimizeApp() }) }catch(e){}

window.NVPX = {S, parseDeck, resolveOne, resolveList, layout, prints, buildPdf, draw, pickIndex, ART:() => ART, artAdd,
  menu:() => [{label:'Card pictures (save on this phone)', run:() => NVCARDS.open()},
              {label:'Card maker (your own offline copy)', run:() => CM.screen()},
              {label:'Clear the deck', run:() => { if(!S.entries.length || confirm('Remove every card from the deck?')) clearDeck() }},
              {label:'Saved decks', run:() => { const d = $('#decks').closest('details'); d.open = true; d.scrollIntoView({behavior:'smooth'}) }}]};
(async () => {
  try{ await artLoad(); S.back = (await tx('kv', 'readonly', s => s.get('back'))) || null }catch(e){ L('storage', e.message) }
  const d = lsGet('nvProxies.deck', null); if(d && PXC.GAMES.some(g => g.id === d.game)){ S.game = d.game; S.entries = (d.entries || []).map(unstore) }
  wire(); decksDraw(); draw(); L('start', `${S.entries.length} cards`);
})();
