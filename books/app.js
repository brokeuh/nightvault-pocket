/* Nightvault Bookcase (test) – the app. Plan: IDEAS.md "Nightvault Bookcase" and plans/bookcase.md in nightvault-src.
   Parts: basics · storage · shelves · sources (phone folder / copied file) · ZIP · RAR · PDF · EPUB · metadata · adding books ·
   covers · screens (shelves, shelf, group, book) · groups (shared ../hub/nvgroups.js) · select · the reader · the EPUB reader · print · settings */
'use strict';

/* ---------- basics ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const coll = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});
const mb = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const ext = n => (String(n).match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
const hue = s => { let h = 0; for(const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360 };
let toastT = 0; function toast(m, ms){ const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 2600) }
window.toast = toast;
const L = (a, t, d) => { try{ window.NVLOG && NVLOG.log(a, t, d) }catch(e){} }, LE = (a, t, d) => { try{ window.NVLOG && NVLOG.error(a, t, d) }catch(e){} };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
const S = Object.assign({fit:'page', two:'auto', bg:'#000', night:false, invert:false, edges:true, efont:110, eface:'serif', etheme:'dark', sort:{}, grouped:{}, filter:{}}, lsGet('nvBooks.settings', {}));
const saveS = () => lsSet('nvBooks.settings', S);
const fromHub = () => { try{ return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
try{ if(new URLSearchParams(location.search).get('nv') === 'hub') sessionStorage.setItem('nvHub', '1'); if(fromHub()) $('#hubback').hidden = false }catch(e){}
const IC_DOTS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const IC_MARK = on => `<svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"${on ? ' style="color:var(--accent)"' : ''}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const PINB = '<span class="pinb">★</span>';

/* ---------- storage: IndexedDB 'nvBooks' (works offline) ----------
   books  : {id, shelf, fmt:'cbz'|'cbr'|'pdf'|'epub'|'imgs', title, series, num, vol, writer, artist, year, desc, pages, rtl, size, added, name, dir,
             src:{kind:'link', uri, name, size, tree} | {kind:'copy', fid} | imgs: {kind:'link', files:[{uri,name,size}], tree} | {kind:'copy', fids:[{fid,name}]}}
   state  : {id, page, pages, ch, frac, last, finished, marks:[{p, ch, frac, name, at}]}
   covers : {id, blob}   (book id, or 'grp:<shelf>:<group key>' for a group's own picture)
   files  : {id, blob}   kv : {id, ...} */
let DB = null;
function openDB(){ return new Promise((ok, no) => { const r = indexedDB.open('nvBooks', 1);
  r.onupgradeneeded = () => { const d = r.result; for(const s of ['books', 'state', 'covers', 'files', 'kv']) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}) };
  r.onblocked = () => toast('Close the other Bookcase tab, then reload', 6000);
  r.onsuccess = () => ok(DB = r.result); r.onerror = () => no(r.error) }) }
function tx(store, mode, fn){ return new Promise((ok, no) => { const t = DB.transaction(store, mode), st = t.objectStore(store); let res; const q = fn(st); if(q) q.onsuccess = () => res = q.result; t.oncomplete = () => ok(res); t.onerror = t.onabort = () => no(t.error || new Error('Storage error')) }) }
const dbGet = (s, id) => tx(s, 'readonly', st => st.get(id));
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));
const dbPutMany = (s, arr) => tx(s, 'readwrite', st => { for(const v of arr) st.put(v) });
const dbDelMany = (s, ids) => tx(s, 'readwrite', st => { for(const id of ids) st.delete(id) });

/* ---------- shelves ---------- */
const SHELF_ICON = {
  comics:'<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  manga:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M12 8v8M9 12h6"/>',
  books:'<path d="M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12"/>',
  rulebooks:'<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 13h8M8 16h5"/>',
  rpg:'<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10"/>',
  colouring:'<path d="M18 3l3 3-9.5 9.5-4 1 1-4z"/><path d="M5 21c-1.5 0-2-1-2-2s1-2 2-2 2 1 2 2"/>',
  own:'<path d="M3 20h18"/><rect x="4" y="5" width="4" height="15" rx="1"/><rect x="9" y="8" width="4" height="12" rx="1"/><path d="M15.2 9.2l3.6-1 2.9 11-3.6 1z"/>'};
const BASE_SHELVES = [
  {id:'comics', name:'Comics', c:['#3a1626', '#1d1b33'], s:'#ff9db7', byPub:true},
  {id:'manga', name:'Manga', c:['#341a3a', '#1a1b33'], s:'#e0a8ff', rtl:true},
  {id:'books', name:'Books', c:['#3a2816', '#1d2236'], s:'#f0b46a', authors:true},
  {id:'rulebooks', name:'Rulebooks', c:['#16323a', '#18203a'], s:'#7fe3ff'},
  {id:'rpg', name:'RPG', c:['#1f3216', '#1a2233'], s:'#9be07a'},
  {id:'colouring', name:'Colouring books', c:['#3a3216', '#2a1f36'], s:'#f1dc6b'}];
function shelves(all){ const own = lsGet('nvBooks.shelves', {}), list = BASE_SHELVES.map(s => Object.assign({}, s, own[s.id] || {}))
    .concat((own._own || []).map(s => Object.assign({c:[`hsl(${hue(s.name)} 40% 20%)`, '#1a1f2e'], s:`hsl(${hue(s.name)} 80% 75%)`, own:true}, s)));
  const ord = own._order || []; list.sort((a, b) => ((ord.indexOf(a.id) + 1) || 99) - ((ord.indexOf(b.id) + 1) || 99));
  return all ? list : list.filter(s => !s.hidden) }
const shelfOf = id => shelves(true).find(s => s.id === id) || {id, name:id, c:['#222', '#111'], s:'#ccc'};
function shelfSet(id, patch){ const own = lsGet('nvBooks.shelves', {});
  if(BASE_SHELVES.some(s => s.id === id)) own[id] = Object.assign({}, own[id] || {}, patch);
  else own._own = (own._own || []).map(s => s.id === id ? Object.assign({}, s, patch) : s);
  lsSet('nvBooks.shelves', own) }
const shelfIcon = (s, size) => `<svg width="${size || 26}" height="${size || 26}" viewBox="0 0 24 24" fill="none" stroke="${s.s}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SHELF_ICON[s.id] || SHELF_ICON.own}</svg>`;

/* ---------- files in a folder on the phone (Android app, NvFiles plugin – shared with Music/Audiobooks): read where they are, not copied ---------- */
let NvFiles = null; if(NATIVE) try{ NvFiles = Capacitor.registerPlugin('NvFiles') }catch(e){ NvFiles = null }
let NvPrint = null; if(NATIVE) try{ NvPrint = Capacitor.registerPlugin('NvPrint') }catch(e){ NvPrint = null }
const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const linkUrl = (uri, name) => '/_nvfile_/' + b64url(uri) + '/' + encodeURIComponent(name);
let linkBad = 0, linkOK = 0;
async function linkRead(uri, name, a, z){
  if(z <= a) return new ArrayBuffer(0);
  if(linkBad < 3 || linkOK) try{ const r = await fetch(linkUrl(uri, name), {headers:{Range:`bytes=${a}-${z - 1}`}, cache:'no-store'});
      if(r.ok){ const b = await r.arrayBuffer(); if(b.byteLength === z - a){ linkOK++; return b } if(r.status === 200 && b.byteLength > z - a){ linkOK++; return b.slice(a, z) } } }catch(e){}
  linkBad++; if(!NvFiles) throw new Error('Cannot read ' + name);
  const o = await NvFiles.read({uri, offset:a, length:z - a});
  const bin = atob(o.data || ''), u8 = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8.buffer }
/* one file as a "source": size, read(a, z) → ArrayBuffer, blob() → the whole file, url (phone folder only) */
function srcFromLink(f){ return {size:f.size, name:f.name, url:linkUrl(f.uri, f.name), read:(a, z) => linkRead(f.uri, f.name, a, Math.min(z, f.size)),
  blob:async () => { const r = await fetch(linkUrl(f.uri, f.name), {cache:'no-store'}); if(!r.ok) throw new Error('Cannot read ' + f.name); return r.blob() }} }
function srcFromBlob(b, name){ return {size:b.size, name:name || b.name || '', read:(a, z) => b.slice(a, z).arrayBuffer(), blob:async () => b} }
async function bookSource(b){
  if(b.src.kind === 'link') return srcFromLink(b.src);
  const f = await dbGet('files', b.src.fid); if(!f) throw new Error('The copy of this book is missing'); return srcFromBlob(f.blob, b.name) }

/* ---------- pictures: the right type for every page (a page inside a ZIP/RAR has no type, and AVIF/WebP need one) ---------- */
const IMG_RE = /\.(jpe?g|jfif|png|gif|webp|avif|bmp)$/i;
const MIME = {jpg:'image/jpeg', jpeg:'image/jpeg', jfif:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', avif:'image/avif', bmp:'image/bmp'};
function sniff(u8){ if(!u8 || u8.length < 12) return '';
  if(u8[0] === 0xFF && u8[1] === 0xD8) return 'image/jpeg';
  if(u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'image/png';
  if(u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif';
  if(u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
  const ft = String.fromCharCode(...u8.slice(4, 12)); if(ft === 'ftypavif' || ft === 'ftypavis') return 'image/avif';
  if(u8[0] === 0x42 && u8[1] === 0x4D) return 'image/bmp'; return '' }
const imgBlob = (u8, name) => new Blob([u8], {type:sniff(u8) || MIME[ext(name)] || 'image/jpeg'});
const skipName = n => /(^|\/)(__MACOSX|\.)|thumbs\.db$|desktop\.ini$/i.test(n);
const pageSort = (a, b) => coll.compare(a, b);

/* ---------- ZIP (CBZ, EPUB, zipped picture folders): reads only the parts it needs, so a big CBZ in a phone folder opens fast ---------- */
const td8 = new TextDecoder('utf-8'), tdL = new TextDecoder('latin1');
async function zipOpen(src){
  const n = src.size, tl = Math.min(n, 65557 + 20), tail = new Uint8Array(await src.read(n - tl, n)), dv = new DataView(tail.buffer);
  let e = -1; for(let i = tail.length - 22; i >= 0; i--) if(dv.getUint32(i, true) === 0x06054b50){ e = i; break }
  if(e < 0) throw new Error('This is not a ZIP / CBZ file (or it is damaged)');
  let cnt = dv.getUint16(e + 10, true), cds = dv.getUint32(e + 12, true), cdo = dv.getUint32(e + 16, true);
  if((cdo === 0xFFFFFFFF || cds === 0xFFFFFFFF || cnt === 0xFFFF) && e >= 20 && dv.getUint32(e - 20, true) === 0x07064b50){   // ZIP64
    const lo = Number(dv.getBigUint64(e - 12, true)), z = new DataView(await src.read(lo, lo + 56));
    if(z.getUint32(0, true) === 0x06064b50){ cnt = Number(z.getBigUint64(32, true)); cds = Number(z.getBigUint64(40, true)); cdo = Number(z.getBigUint64(48, true)) } }
  const cd = new Uint8Array(await src.read(cdo, cdo + cds)), cv = new DataView(cd.buffer), out = [];
  for(let p = 0, k = 0; k < cnt && p + 46 <= cd.length; k++){
    if(cv.getUint32(p, true) !== 0x02014b50) break;
    const flag = cv.getUint16(p + 8, true), meth = cv.getUint16(p + 10, true), nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
    let cs = cv.getUint32(p + 20, true), us = cv.getUint32(p + 24, true), off = cv.getUint32(p + 42, true);
    const nm = cd.subarray(p + 46, p + 46 + nl), name = (flag & 0x800 ? td8 : (() => { try{ return new TextDecoder('utf-8', {fatal:true}).decode(nm), td8 }catch(e){ return tdL } })()).decode(nm);
    let x = p + 46 + nl; const xe = x + xl;
    while(x + 4 <= xe){ const id = cv.getUint16(x, true), sz = cv.getUint16(x + 2, true); if(id === 1){ let q = x + 4;
        if(us === 0xFFFFFFFF){ us = Number(cv.getBigUint64(q, true)); q += 8 } if(cs === 0xFFFFFFFF){ cs = Number(cv.getBigUint64(q, true)); q += 8 } if(off === 0xFFFFFFFF){ off = Number(cv.getBigUint64(q, true)) } } x += 4 + sz }
    if(!name.endsWith('/')) out.push({name, meth, cs, us, off, enc:!!(flag & 1)});
    p = xe + cl }
  const z = {entries:out, src,
    async file(en){ if(typeof en === 'string') en = out.find(x => x.name === en); if(!en) throw new Error('Missing in the ZIP');
      if(en.enc) throw new Error('This file has a password');
      const h = new DataView(await src.read(en.off, en.off + 30)); const start = en.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const raw = new Uint8Array(await src.read(start, start + en.cs));
      if(en.meth === 0) return raw;
      if(en.meth === 8) return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      throw new Error('Unsupported packing in the ZIP (method ' + en.meth + ')') },
    async text(name){ return td8.decode(await z.file(name)) },
    find(re){ return out.find(x => re.test(x.name)) }};
  return z }

/* ---------- RAR (CBR): the WebAssembly reader needs the whole file in memory ---------- */
let UNRAR = null, UNRARWASM = null;
async function rarOpen(src){
  if(!UNRAR) UNRAR = await import('./lib/unrar/index.esm.js');
  if(!UNRARWASM) UNRARWASM = await (await fetch('./lib/unrar/js/unrar.wasm')).arrayBuffer();
  const data = await (await src.blob()).arrayBuffer();
  const ex = await UNRAR.createExtractorFromData({wasmBinary:UNRARWASM, data});
  let q = Promise.resolve();
  const list = [...ex.getFileList().fileHeaders].filter(h => !h.flags.directory).map(h => ({name:h.name, us:h.unpSize, enc:h.flags.encrypted}));
  const r = {entries:list,
    /* one page at a time, and always to the end of the reader's list (stopping half-way breaks the next unpack) */
    file(en){ const name = typeof en === 'string' ? en : en.name;
      const job = q.then(() => { const all = [...ex.extract({files:[name]}).files], f = all.find(x => x.extraction); if(!f) throw new Error('Could not unpack ' + name); return f.extraction });
      q = job.catch(() => {}); return job },
    async text(name){ return td8.decode(await r.file(name)) },
    find(re){ return list.find(x => re.test(x.name)) }};
  return r }

/* ---------- PDF (pdf.js, in lib/pdfjs) ---------- */
let PDFJS = null;
async function pdfLib(){ if(PDFJS) return PDFJS; PDFJS = await import('./lib/pdfjs/pdf.min.js'); PDFJS.GlobalWorkerOptions.workerSrc = new URL('./lib/pdfjs/pdf.worker.min.js', location.href).href; return PDFJS }
async function pdfOpen(src){
  const lib = await pdfLib(); let task;
  if(src.size > 4 * 1048576){   // big files: only the parts that are needed (a 300 MB rulebook opens in a second)
    const first = new Uint8Array(await src.read(0, Math.min(src.size, 65536)));
    const tr = new lib.PDFDataRangeTransport(src.size, first);
    tr.requestDataRange = (a, z) => { src.read(a, z).then(b => tr.onDataRange(a, new Uint8Array(b))).catch(e => LE('pdf', 'range read failed', e)) };
    task = lib.getDocument({range:tr, rangeChunkSize:262144, disableAutoFetch:true, disableStream:true, standardFontDataUrl:'./lib/pdfjs/standard_fonts/', cMapUrl:'./lib/pdfjs/cmaps/', cMapPacked:true, isEvalSupported:false}) }
  else task = lib.getDocument({data:new Uint8Array(await src.read(0, src.size)), standardFontDataUrl:'./lib/pdfjs/standard_fonts/', cMapUrl:'./lib/pdfjs/cmaps/', cMapPacked:true, isEvalSupported:false});
  return task.promise }
async function pdfRender(pdf, i, width, type){
  const pg = await pdf.getPage(i + 1), v1 = pg.getViewport({scale:1}), sc = Math.min(width / v1.width, 4000 / v1.height), vp = pg.getViewport({scale:sc});
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await pg.render({canvasContext:ctx, viewport:vp}).promise;
  const b = await new Promise(ok => c.toBlob(ok, type || 'image/jpeg', .9)); pg.cleanup(); c.width = c.height = 0; return b }
async function pdfToc(pdf){ const out = []; let ol = null; try{ ol = await pdf.getOutline() }catch(e){} if(!ol) return out;
  const walk = async (items, d) => { for(const it of items){ let p = null;
      try{ let dest = it.dest; if(typeof dest === 'string') dest = await pdf.getDestination(dest); if(dest && dest[0]) p = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]) }catch(e){}
      out.push({title:it.title, p, d}); if(it.items && it.items.length && d < 4) await walk(it.items, d + 1) } };
  await walk(ol, 0); return out }

/* ---------- EPUB: container → package (metadata, spine, table of contents) ---------- */
const xml = t => new DOMParser().parseFromString(t, 'application/xml');
const resolve = (base, href) => { try{ return decodeURIComponent(new URL(href, 'https://x/' + base).pathname.slice(1)) }catch(e){ return href } };
async function epubOpen(z){
  const cont = xml(await z.text('META-INF/container.xml')), opfPath = cont.querySelector('rootfile').getAttribute('full-path'), opf = xml(await z.text(opfPath));
  const man = {}; for(const it of opf.querySelectorAll('manifest > item')) man[it.getAttribute('id')] = {href:resolve(opfPath, it.getAttribute('href')), type:it.getAttribute('media-type'), props:it.getAttribute('properties') || ''};
  const spine = [...opf.querySelectorAll('spine > itemref')].map(r => man[r.getAttribute('idref')]).filter(x => x && /html|xml/.test(x.type));
  const md = opf.querySelector('metadata'), q = sel => { const el = md && [...md.children].find(c => c.localName === sel); return el ? el.textContent.trim() : '' };
  const meta = n => { const el = md && [...md.querySelectorAll('meta')].find(m => m.getAttribute('name') === n || m.getAttribute('property') === n); return el ? (el.getAttribute('content') || el.textContent || '').trim() : '' };
  const creators = md ? [...md.children].filter(c => c.localName === 'creator') : [];
  const role = (el, rs) => { const r = el.getAttribute('opf:role') || el.getAttribute('role') || (() => { const id = el.getAttribute('id'); const m = id && md.querySelector(`meta[refines="#${id}"][property="role"]`); return m ? m.textContent.trim() : '' })(); return rs.includes(r) };
  const writer = (creators.find(c => role(c, ['aut', ''])) || creators[0] || {textContent:''}).textContent.trim(), artist = (creators.find(c => role(c, ['ill', 'art'])) || {textContent:''}).textContent.trim();
  let series = meta('calibre:series') || meta('belongs-to-collection'), idx = meta('calibre:series_index') || meta('group-position');
  let cover = Object.values(man).find(x => /cover-image/.test(x.props)); const cm = meta('cover'); if(!cover && cm && man[cm]) cover = man[cm];
  let toc = [];
  try{ const nav = Object.values(man).find(x => /\bnav\b/.test(x.props));
    if(nav){ const d = new DOMParser().parseFromString(await z.text(nav.href), 'application/xhtml+xml'), n = [...d.querySelectorAll('nav')].find(x => /toc/.test(x.getAttribute('epub:type') || x.getAttribute('type') || '')) || d.querySelector('nav');
      if(n) for(const a of n.querySelectorAll('a[href]')){ let dep = 0, p = a.parentElement; while(p && p !== n){ if(p.localName === 'ol') dep++; p = p.parentElement } toc.push({title:a.textContent.trim(), href:resolve(nav.href, a.getAttribute('href')), d:Math.max(0, dep - 1)}) } }
    else { const ncxId = opf.querySelector('spine').getAttribute('toc'), ncx = ncxId && man[ncxId];
      if(ncx){ const d = xml(await z.text(ncx.href)); const walk = (el, dep) => { for(const np of [...el.children].filter(c => c.localName === 'navPoint')){ const t = np.querySelector('navLabel text'), c = np.querySelector('content'); if(c) toc.push({title:t ? t.textContent.trim() : '', href:resolve(ncx.href, c.getAttribute('src')), d:dep}); walk(np, dep + 1) } }; const nm = d.querySelector('navMap'); if(nm) walk(nm, 0) } } }catch(e){ LE('epub', 'table of contents', e) }
  toc = toc.map(t => Object.assign(t, {ch:spine.findIndex(s => s.href === t.href.split('#')[0])})).filter(t => t.ch >= 0);
  const fixed = meta('rendition:layout') === 'pre-paginated';
  return {z, opfPath, man, spine, toc, fixed, cover, meta:{title:q('title'), publisher:q('publisher'), writer, artist, year:(q('date').match(/\d{4}/) || [''])[0], desc:q('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), series, num:idx ? parseFloat(idx) : null, lang:q('language')}} }
/* a picture EPUB (most manga / comic EPUBs): every chapter is one picture → read it with the page reader */
async function epubPictures(ep){
  if(ep.spine.length < 2) return null; const pics = []; let looked = 0;
  for(const it of ep.spine){ const t = await ep.z.text(it.href); looked++;
    const d = new DOMParser().parseFromString(t, 'text/html'), imgs = [...d.querySelectorAll('img[src], image')].map(i => i.getAttribute('src') || i.getAttribute('xlink:href') || i.getAttribute('href')).filter(Boolean);
    const words = (d.body ? d.body.textContent : '').replace(/\s+/g, '').length;
    if(imgs.length !== 1 || words > 60){ if(!ep.fixed && looked <= 6) return null; if(!ep.fixed) continue }
    if(imgs[0]) pics.push(resolve(it.href, imgs[0])) }
  return pics.length >= ep.spine.length * 0.8 ? pics : null }

/* ---------- metadata from the file name: "Naruto v03 (2003)", "Saga #012", "One Piece - Volume 12", "Batman 404 - Year One" ---------- */
const GENERIC = /^(vol(ume)?|tome|book|boek|deel|band|issue|chapter|ch|part|nummer|t|v)\.?$/i;
function parseName(file, dir){
  let s = String(file).replace(/\.[a-z0-9]+$/i, ''), year = '';
  s = s.replace(/[([](\d{4})[)\]]/g, (m, y) => { if(+y > 1900 && +y < 2100) year = year || y; return ' ' }).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  let series = '', num = null, vol = '', title = '', m;
  if((m = s.match(/^(.*?)[\s.\-–:]*\b(?:v|vol|volume|tome|t|deel|band|book|boek)\.?\s*(\d+(?:\.\d+)?)\b\s*(?:[-–:]\s*(.*))?$/i))){ series = m[1]; num = parseFloat(m[2]); vol = 'Vol. ' + (+m[2]); title = m[3] || '' }
  else if((m = s.match(/^(.*?)\s*#\s*(\d+(?:\.\d+)?)\b\s*(?:[-–:]\s*(.*))?$/))){ series = m[1]; num = parseFloat(m[2]); vol = '#' + (+m[2]); title = m[3] || '' }
  else if((m = s.match(/^(.*?\D)\s+(\d{1,4}(?:\.\d+)?)(?:\s*(?:of\s*\d+))?\s*(?:[-–:]\s*(.*))?$/i)) && m[1].trim() && !(+m[2] > 1900 && +m[2] < 2100 && /^\d{4}$/.test(m[2]))){ series = m[1]; num = parseFloat(m[2]); vol = '#' + (+m[2]); title = m[3] || '' }
  series = series.replace(/[\s\-–:,.]+$/, '').trim();
  const parent = String(dir || '').split('/').filter(Boolean).pop() || '';
  const pClean = parent.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if((!series || GENERIC.test(series)) && num != null && pClean) series = pClean;
  if(!series && num == null){ title = s }
  return {series, num, vol, title:title.trim(), year, clean:s} }
function comicInfo(text){ try{ const d = xml(text), g = n => { const el = d.querySelector(n); return el ? el.textContent.trim() : '' };
    const num = g('Number'), vol = g('Volume');
    return {title:g('Title'), series:g('Series'), num:num !== '' && !isNaN(parseFloat(num)) ? parseFloat(num) : vol !== '' && !isNaN(parseFloat(vol)) ? parseFloat(vol) : null,
      vol:num ? '#' + num : vol ? 'Vol. ' + vol : '', publisher:g('Publisher') || g('Imprint'), writer:g('Writer'), artist:[g('Penciller'), g('Inker')].filter(Boolean)[0] || '', year:g('Year'), desc:g('Summary'), pages:parseInt(g('PageCount')) || 0,
      rtl:/righttoleft/i.test(g('Manga')) ? true : null, cover:(() => { const p = d.querySelector('Page[Type="FrontCover"]'); return p ? parseInt(p.getAttribute('Image')) : null })()} }catch(e){ return null } }

/* ---------- covers: a small picture per book (about 400 px wide) ---------- */
async function thumb(blob){
  let bm; try{ bm = await createImageBitmap(blob) }catch(e){ const u = URL.createObjectURL(blob); try{ const im = new Image(); im.src = u; await im.decode(); bm = im }finally{ setTimeout(() => URL.revokeObjectURL(u), 1000) } }
  const w = Math.min(400, bm.width), h = Math.round(bm.height * w / bm.width), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h); if(bm.close) bm.close();
  return new Promise(ok => c.toBlob(b => ok(b), 'image/webp', .82)) }
const COV = new Set(), COVURL = {};
async function coverUrl(id){ if(!COV.has(id)) return null; if(COVURL[id]) return COVURL[id]; const c = await dbGet('covers', id).catch(() => null); if(!c){ COV.delete(id); return null } return COVURL[id] = URL.createObjectURL(c.blob) }
async function setCover(id, blob){ await dbPut('covers', {id, blob}); COV.add(id); if(COVURL[id]){ URL.revokeObjectURL(COVURL[id]); delete COVURL[id] } }

/* ---------- what kind of file is it really (a .cbz that is a RAR inside, or a .cbr that is a ZIP, is common) ---------- */
async function realFmt(src, name){
  const h = new Uint8Array(await src.read(0, Math.min(8, src.size))), e = ext(name);
  if(h[0] === 0x50 && h[1] === 0x4B) return e === 'epub' ? 'epub' : 'cbz';
  if(h[0] === 0x52 && h[1] === 0x61 && h[2] === 0x72 && h[3] === 0x21) return 'cbr';
  if(h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return 'pdf';
  return {cbz:'cbz', zip:'cbz', cbr:'cbr', rar:'cbr', pdf:'pdf', epub:'epub'}[e] || '' }
const BOOK_RE = /\.(cbz|cbr|zip|rar|pdf|epub)$/i, NOTYET_RE = /\.(cb7|7z|cbt|mobi|azw3?|djvu|fb2|kfx)$/i;
const pageList = entries => entries.filter(x => IMG_RE.test(x.name) && !skipName(x.name)).sort((a, b) => pageSort(a.name, b.name));

/* ---------- a book opened for reading: {n, page(i, width) → Blob, toc, text(i)?, flow?} ---------- */
async function openDoc(b){
  if(b.fmt === 'imgs'){
    const files = b.src.kind === 'link' ? b.src.files.slice().sort((x, y) => pageSort(x.name, y.name)) : b.src.fids.slice().sort((x, y) => pageSort(x.name, y.name));
    return {n:files.length, toc:[], async page(i){ const f = files[i];
      if(b.src.kind === 'link'){ const u8 = new Uint8Array(await linkRead(f.uri, f.name, 0, f.size)); return imgBlob(u8, f.name) }
      const r = await dbGet('files', f.fid); const u8 = new Uint8Array(await r.blob.slice(0, 16).arrayBuffer()); return new Blob([r.blob], {type:sniff(u8) || MIME[ext(f.name)] || 'image/jpeg'}) }} }
  const src = await bookSource(b), fmt = await realFmt(src, b.name) || b.fmt;
  if(fmt === 'pdf'){ const pdf = await pdfOpen(src), toc = await pdfToc(pdf);
    return {n:pdf.numPages, toc, pdf, page:(i, w) => pdfRender(pdf, i, w || 1600), async text(i){ const pg = await pdf.getPage(i + 1), t = await pg.getTextContent(); return t.items.map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('') }, close(){ try{ pdf.destroy() }catch(e){} }} }
  if(fmt === 'epub'){ const z = await zipOpen(src), ep = await epubOpen(z), pics = await epubPictures(ep);
    if(!pics) return {flow:true, ep};
    const toc = ep.toc.map(t => ({title:t.title, p:Math.min(t.ch, pics.length - 1), d:t.d}));
    return {n:pics.length, toc, async page(i){ return imgBlob(await z.file(pics[i]), pics[i]) }} }
  const arc = fmt === 'cbr' ? await rarOpen(src) : await zipOpen(src), pages = pageList(arc.entries);
  if(!pages.length) throw new Error('No pictures found in this file');
  if(pages.some(p => p.enc)) throw new Error('This file has a password');
  return {n:pages.length, toc:[], names:pages.map(p => p.name), async page(i){ return imgBlob(await arc.file(pages[i]), pages[i].name) }} }

/* ---------- reading a new book's details and cover ---------- */
const junkTitle = t => !t || t.length < 2 || /^(untitled|microsoft|document|adobe|pdf|scan|title|print|cover)\b/i.test(t) || /\.(docx?|indd|pdf|qxd|pub|rtf)$/i.test(t);
async function readMeta(src, name, dir){
  const fmt = await realFmt(src, name), p = parseName(name, dir), md = {fmt, series:p.series, num:p.num, vol:p.vol, title:p.title || (p.series ? '' : p.clean), year:p.year, publisher:'', writer:'', artist:'', desc:'', pages:0, rtl:null, cover:null};
  if(!fmt) throw new Error('Not a book file');
  if(fmt === 'cbz' || fmt === 'cbr'){
    if(fmt === 'cbr' && src.size > 300 * 1048576){ md.later = true; return md }   // a huge CBR: details and cover when it is first opened
    const arc = fmt === 'cbr' ? await rarOpen(src) : await zipOpen(src), pages = pageList(arc.entries); md.pages = pages.length;
    const ci = arc.find(/(^|\/)comicinfo\.xml$/i); let info = null; if(ci) try{ info = comicInfo(await arc.text(ci)) }catch(e){}
    if(info){ if(info.series){ md.series = info.series; md.num = info.num != null ? info.num : md.num; md.vol = info.vol || md.vol; md.title = info.title || '' } else if(info.title) md.title = info.title;
      for(const k of ['writer', 'artist', 'desc', 'rtl', 'publisher']) if(info[k]) md[k] = info[k]; if(info.year) md.year = info.year }
    const cp = info && info.cover != null && pages[info.cover] ? pages[info.cover] : pages.find(x => /(^|[\/_ \-])(cover|front)[^\/]*$/i.test(x.name) && !/back/i.test(x.name)) || pages[0];
    if(cp) md.cover = imgBlob(await arc.file(cp), cp.name) }
  else if(fmt === 'pdf'){ const pdf = await pdfOpen(src); md.pages = pdf.numPages;
    try{ const m = await pdf.getMetadata(), i = m.info || {}; if(!junkTitle(i.Title) && !p.series) md.title = i.Title.trim(); if(i.Author && i.Author.length < 80) md.writer = i.Author.trim(); if(i.Subject && i.Subject.length > 20) md.desc = i.Subject }catch(e){}
    try{ md.cover = await pdfRender(pdf, 0, 400, 'image/webp') }catch(e){ LE('pdf', 'cover', e) } try{ pdf.destroy() }catch(e){} }
  else if(fmt === 'epub'){ const z = await zipOpen(src), ep = await epubOpen(z), m = ep.meta;
    if(m.title) md.title = m.title; if(m.writer) md.writer = m.writer; if(m.artist) md.artist = m.artist; if(m.year) md.year = m.year; if(m.publisher) md.publisher = m.publisher; if(m.desc) md.desc = m.desc;
    if(m.series){ md.series = m.series; md.num = m.num; md.vol = m.num != null ? 'Vol. ' + m.num : '' }
    else if(md.series && norm(md.title) !== norm(p.title || p.clean)){ /* the EPUB's own title wins; keep the series from the name */ }
    md.pages = ep.spine.length;
    let cv = ep.cover && /image/.test(ep.cover.type) ? ep.cover.href : null;
    if(!cv && ep.spine[0]) try{ const d = new DOMParser().parseFromString(await z.text(ep.spine[0].href), 'text/html'), im = d.querySelector('img[src], image'); if(im) cv = resolve(ep.spine[0].href, im.getAttribute('src') || im.getAttribute('xlink:href') || im.getAttribute('href')) }catch(e){}
    if(cv) try{ md.cover = imgBlob(await z.file(cv), cv) }catch(e){} }
  return md }

/* ---------- library in memory ---------- */
let BOOKS = [], BK = {}, STATE = {};
async function loadLib(){ BOOKS = await dbAll('books'); BK = Object.fromEntries(BOOKS.map(b => [b.id, b])); STATE = {}; for(const s of await dbAll('state')) STATE[s.id] = s;
  for(const id of await tx('covers', 'readonly', st => st.getAllKeys())) COV.add(id) }
const st = id => STATE[id] || (STATE[id] = {id, page:0, pages:0, last:0, finished:false, marks:[]});
const stT = {}; function saveState(id, now){ clearTimeout(stT[id]); const go = () => dbPut('state', st(id)).catch(() => {}); if(now) return go(); stT[id] = setTimeout(go, 800) }
const progress = b => { const s = STATE[b.id]; if(!s) return 0; if(s.finished) return 1; if(b.fmt === 'epub' && s.flow) return s.frac || 0; const n = s.pages || b.pages; return n > 1 ? Math.min(1, s.page / (n - 1)) : 0 };
const started = b => { const s = STATE[b.id]; return !!(s && s.last) };
const dispTitle = b => b.series ? b.series + (b.vol ? ' ' + b.vol : '') : b.title || b.name;
const dispSub = b => b.series && b.title && norm(b.title) !== norm(b.series) ? b.title : [b.writer, b.year].filter(Boolean).join(' · ');
const inShelf = sh => BOOKS.filter(b => b.shelf === sh);
const seriesOrder = (a, b) => ((a.num != null ? a.num : 1e9) - (b.num != null ? b.num : 1e9)) || coll.compare(a.title || '', b.title || '') || coll.compare(a.name || '', b.name || '');

/* ---------- adding books: a folder on the phone (nothing copied) or files copied into the app ---------- */
function addSheet(){
  const sh = shelfOf(cur().shelf), dirOK = !NATIVE && 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  sheet(`<h3>Add to ${esc(sh.name)}</h3>
    <p class="muted small" style="margin:0 0 12px">CBZ, CBR, PDF, EPUB, and folders of pictures (JPG, PNG, WebP, AVIF). Series and volume numbers come from the file (ComicInfo.xml, the EPUB's details) or the file and folder names.</p>
    <div class="mlist">${NvFiles ? `<button class="btn primary" id="adl">Use a folder on this phone</button><div class="muted small" style="margin:-2px 0 6px">Nothing is copied: the books are read from that folder. Pick your ${esc(sh.name.toLowerCase())} folder - all folders inside it are read.</div>` : ''}
      <button class="btn ${NvFiles ? '' : 'primary'}" id="adf">${NvFiles ? 'Copy books into the app' : 'Pick books'}</button><div class="muted small" style="margin:-2px 0 0">${NvFiles ? 'Takes extra space.' : 'They are copied into the app, so they work without internet.'}</div>
      ${dirOK ? '<button class="btn" id="add">Pick a whole folder</button><div class="muted small" style="margin:-2px 0 0">Folders of pictures become one book each.</div>' : ''}</div>`);
  if($('#adl')) $('#adl').onclick = () => { closeSheet(); addFolder(sh.id) };
  $('#adf').onclick = () => { closeSheet(); const i = $('#pickfiles'); i.value = ''; i.onchange = e => addFiles([...e.target.files], sh.id); i.click() };
  if($('#add')) $('#add').onclick = () => { closeSheet(); const i = $('#pickdir'); i.value = ''; i.onchange = e => addFiles([...e.target.files], sh.id); i.click() } }

/* files (from a picker) or a folder list → items: book files, and folders of pictures (one book each) */
function toItems(list){ // list: [{f (File | link {uri,name,size}), path}]
  const items = [], pics = {}, bookDirs = new Set(); let notyet = 0;
  for(const x of list){ const n = x.f.name, d = x.path.split('/').slice(0, -1).join('/');
    if(skipName(x.path)) continue;
    if(BOOK_RE.test(n)){ items.push({kind:'file', f:x.f, path:x.path, dir:d}); bookDirs.add(d) }
    else if(IMG_RE.test(n)) (pics[d] = pics[d] || []).push(x.f);
    else if(NOTYET_RE.test(n)) notyet++ }
  for(const [d, fs] of Object.entries(pics)) if(fs.length >= 3 && !bookDirs.has(d)) items.push({kind:'imgs', files:fs, path:d, dir:d.split('/').slice(0, -1).join('/'), name:d.split('/').pop() || 'Pictures'});
  return {items, notyet} }
async function addFiles(files, shelf){ if(!files.length) return;
  const list = files.map(f => ({f, path:f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name}));
  const {items, notyet} = toItems(list); scan(items, shelf, null, notyet) }

let wakeS = null;
async function awake(on){ try{ if(NvFiles && NvFiles.keepAwake) await NvFiles.keepAwake({on}) }catch(e){}
  try{ if(on && !wakeS && navigator.wakeLock){ wakeS = await navigator.wakeLock.request('screen'); wakeS.addEventListener('release', () => { wakeS = null }) } else if(!on && wakeS){ await wakeS.release(); wakeS = null } }catch(e){} }
async function addFolder(shelf, f){
  try{ f = f || await NvFiles.pickFolder() }catch(e){ if(!/cancel|No folder/i.test(e.message || '')) toast(e.message || String(e)); return }
  const fl = lsGet('nvBooks.folders', []); if(!fl.some(x => x.tree === f.tree && x.shelf === shelf)){ fl.push({tree:f.tree, name:f.name, shelf}); lsSet('nvBooks.folders', fl) }
  awake(true);
  sheet(`<h3>Looking in “${esc(f.name)}”…</h3><div class="prog busy"><i></i></div><div class="small" id="lst">Starting…</div>
    <p class="muted small">A big folder or an SD card can take a few minutes. Keep the app open while it looks.</p><button class="btn" id="lstop" style="width:100%">Stop</button>`, true);
  const t0 = Date.now(); let last = null, stopped = false, hl = null;
  const draw = () => { const el = $('#lst'); if(el) el.textContent = last ? `${plural(last.files, 'file')} · ${plural(last.folders, 'folder')} looked at · ${Math.round((Date.now() - t0) / 1000)} s` : 'Looking…' };
  const iv = setInterval(draw, 1000); try{ hl = await NvFiles.addListener('listProgress', e => { last = e; draw() }) }catch(e){}
  $('#lstop').onclick = () => { stopped = true; awake(false); NvFiles.stopList().catch(() => {}); closeSheet(); toast('Stopped - nothing was added') };
  let res; try{ res = await NvFiles.list({tree:f.tree}) }catch(e){ if(!stopped){ awake(false); closeSheet(); toast(e.message || String(e), 5000) } return }
  finally{ clearInterval(iv); try{ hl && hl.remove() }catch(e){} }
  if(stopped || res.stopped) return;
  const list = (res.files || []).map(x => ({f:{uri:x.uri, name:x.name, size:x.size}, path:x.path.split('/').slice(1).join('/')}));
  L('folder', `“${f.name}” for ${shelf}: ${list.length} files`);
  const {items, notyet} = toItems(list); scan(items, shelf, {tree:f.tree, name:f.name}, notyet) }

/* read every new book (2 at a time), save as they come; looking at a folder again also drops books that are gone */
let SCAN = null;
async function scan(items, shelf, folder, notyet){
  const key = it => folder ? (it.kind === 'imgs' ? folder.tree + '|' + it.path : it.f.uri) : (it.kind === 'imgs' ? 'dir|' + it.path + '|' + it.files.length : it.f.name + '|' + it.f.size);
  const bkey = b => b.src.kind === 'link' ? (b.fmt === 'imgs' ? b.src.tree + '|' + b.dir2 : b.src.uri) : (b.fmt === 'imgs' ? 'dir|' + b.dir2 + '|' + b.src.fids.length : b.name + '|' + b.size);
  const have = new Set(BOOKS.filter(b => b.shelf === shelf).map(bkey)), fresh = items.filter(it => !have.has(key(it)));
  let removed = 0;
  if(folder){ const seen = new Set(items.map(key)), gone = BOOKS.filter(b => b.shelf === shelf && b.src.kind === 'link' && b.src.tree === folder.tree && !seen.has(bkey(b)));
    if(gone.length){ removed = gone.length; await dbDelMany('books', gone.map(b => b.id)); const g = new Set(gone.map(b => b.id)); BOOKS = BOOKS.filter(b => !g.has(b.id)); for(const id of g) delete BK[id] } }
  if(!fresh.length){ awake(false); closeSheet(); draw(); toast(items.length || removed ? `No new books${removed ? ` · ${plural(removed, 'book')} that are gone were removed` : ''}` : `No books found there${notyet ? ` (${notyet} in a format Bookcase can't read yet: CB7, MOBI …)` : ''}`, 5000); return }
  if(!folder){ const total = fresh.reduce((a, it) => a + (it.kind === 'imgs' ? it.files.reduce((n, f) => n + f.size, 0) : it.f.size), 0);
    try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist() }catch(e){}
    try{ const e = await navigator.storage.estimate(); if(e && e.quota && e.quota - e.usage < total * 1.05){ closeSheet(); toast(`Not enough space: ${mb(total)} needed, ${mb(e.quota - e.usage)} free`, 5000); return } }catch(e){} }
  SCAN = {stop:false}; const me = SCAN; awake(true);
  sheet(`<h3>${folder ? 'Reading your books…' : 'Copying books into the app…'}</h3><div class="prog"><i id="sp"></i></div><div class="muted small" id="stx" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">0 of ${fresh.length} · starting…</div>
    <p class="muted small">The screen stays on while books are added.</p><button class="btn" id="sstop" style="width:100%">Stop (keep what is read so far)</button>`, true);
  $('#sstop').onclick = () => { me.stop = true; $('#sstop').disabled = true; $('#sstop').textContent = 'Stopping…' };
  let done = 0, added = 0, failed = 0, i = 0; const now = Date.now(), errs = [], tops = pubTops(items.map(it => it.dir).concat(BOOKS.filter(b => b.shelf === shelf).map(b => b.dir)));
  const one = async it => {
    const b = {id:uid(), shelf, added:now, dir:it.dir || '', dir2:it.path, pubDir:pubFolder(it.dir, tops)};
    if(it.kind === 'imgs'){ const fs = it.files.slice().sort((x, y) => pageSort(x.name, y.name)), p = parseName(it.name, it.dir);
      Object.assign(b, {fmt:'imgs', name:it.name, title:p.title || (p.series ? '' : p.clean), series:p.series, num:p.num, vol:p.vol, year:p.year, pages:fs.length, size:fs.reduce((n, f) => n + f.size, 0)});
      if(folder) b.src = {kind:'link', tree:folder.tree, files:fs.map(f => ({uri:f.uri, name:f.name, size:f.size}))};
      else { const fids = []; for(const f of fs){ const fid = uid(); await dbPut('files', {id:fid, blob:f}); fids.push({fid, name:f.name}) } b.src = {kind:'copy', fids} }
      try{ const f0 = fs.find(f => /cover|front/i.test(f.name)) || fs[0]; const u8 = folder ? new Uint8Array(await linkRead(f0.uri, f0.name, 0, f0.size)) : new Uint8Array(await f0.arrayBuffer()); await setCover(b.id, await thumb(imgBlob(u8, f0.name))) }catch(e){} }
    else { const f = it.f, src = folder ? srcFromLink(f) : srcFromBlob(f, f.name), md = await readMeta(src, f.name, it.dir);
      Object.assign(b, {fmt:md.fmt, name:f.name, size:f.size, publisher:md.publisher || '', title:md.title, series:md.series, num:md.num, vol:md.vol, writer:md.writer, artist:md.artist, year:md.year, desc:md.desc, pages:md.pages, rtl:md.rtl, later:md.later || false});
      if(folder) b.src = {kind:'link', uri:f.uri, name:f.name, size:f.size, tree:folder.tree};
      else { const fid = uid(); await dbPut('files', {id:fid, blob:f}); b.src = {kind:'copy', fid} }
      if(md.cover) try{ await setCover(b.id, await thumb(md.cover)) }catch(e){ LE('cover', 'could not make the cover of ' + f.name, e) } }
    await dbPut('books', b); BOOKS.push(b); BK[b.id] = b; added++ };
  const work = async () => { while(i < fresh.length && !me.stop){ const it = fresh[i++], nm = it.kind === 'imgs' ? it.name : it.f.name;
      try{ await one(it) }catch(err){ failed++; errs.push(nm + ': ' + (err.message || err)); LE('add', 'could not add ' + nm, err); if(err && err.name === 'QuotaExceededError'){ me.stop = true; toast('The phone is full', 5000) } }
      done++; const p = $('#sp'), s = $('#stx'); if(p) p.style.width = (100 * done / fresh.length) + '%'; if(s) s.textContent = `${done} of ${fresh.length} · ${nm}` } };
  await Promise.all([work(), work()]);
  SCAN = null; awake(false); closeSheet(); draw();
  L('add', `${added} added, ${failed} failed`, errs.slice(0, 20));
  { regroup(); const nb = BOOKS.filter(b => b.shelf === shelf && b.added === now); L('add', 'publishers', nb.map(b => `${b.name} → ${pubSource(b).p || '-'} (${pubSource(b).how || 'none'})`).slice(0, 200)) }
  toast(`${plural(added, 'book')} added${removed ? ` · ${removed} gone` : ''}${failed ? ` · ${failed} could not be read` : ''}${notyet ? ` · ${notyet} in a format not supported yet` : ''}`, 6000);
  if(!failed && shelfOf(shelf).byPub && CV.key() && BOOKS.some(b => b.shelf === shelf && b.added === now && (!pubSource(b).p || pubSource(b).how === 'guess'))) setTimeout(() => { const n = BOOKS.filter(b => b.shelf === shelf && b.added === now && (!pubSource(b).p || pubSource(b).how === 'guess')).length;
    sheet(`<h3>Look them up online?</h3><p class="muted small">${plural(n, 'comic')} of what you just added ${n === 1 ? 'has' : 'have'} no publisher in the file. Comic Vine can find it (and the story and cover).</p><div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Not now</button><button class="btn primary" style="flex:2" id="cvnow">Look them up</button></div>`); $('#cvnow').onclick = () => cvLookup(shelf, false) }, 700);
  if(failed) setTimeout(() => sheet(`<h3>${plural(failed, 'file')} could not be read</h3><div style="max-height:46vh;overflow:auto;font-size:12.5px" class="muted">${errs.slice(0, 60).map(esc).join('<br>')}</div><button class="btn primary" style="width:100%;margin-top:12px" id="errok">OK</button>`), 400), setTimeout(() => { const b = $('#errok'); if(b) b.onclick = closeSheet }, 500) }
async function lookAgain(f){ if(!NvFiles) return; await addFolder(f.shelf, {tree:f.tree, name:f.name}) }

/* ---------- groups: the shared way of every Nightvault app (../hub/nvgroups.js, plans/shared-groups.md) – one engine per shelf ----------
   automatic group = the series (Naruto, Saga, …); on the Books shelf a writer's books without a series make a tile too */
const GRS = {};
function grOf(sh){ if(GRS[sh]) return GRS[sh]; const s = shelfOf(sh);
  return GRS[sh] = NVGROUPS.make({prefix:'nvBooks.' + sh, app:'bookcase-' + sh, title:'Bookcase · ' + s.name, itemsKey:'itemGroup', norm, key:b => b.id,
    hay:b => [b.title, b.series, b.writer].filter(Boolean).join(' '), kinds:{series:'Series', author:'Writer', publisher:'Publisher'},
    auto:b => b.series ? {key:'s:' + norm(b.series), name:b.series, kind:'series'} : s.authors && b.writer ? {key:'a:' + norm(b.writer), name:b.writer, kind:'author'} : null,
    onRekey:async (from, to) => { const id = 'grp:' + sh + ':' + from; if(!COV.has(id)) return; const c = await dbGet('covers', id).catch(() => null); if(c){ await setCover('grp:' + sh + ':' + to, c.blob); draw() } }}) }
const groupsOf = sh => GROUPCACHE[sh] || (GROUPCACHE[sh] = withPublishers(sh, grOf(sh).build(inShelf(sh))));
/* publishers: Comics › Marvel › Spider-Man › the volumes. A series (and a book without a series) goes into its publisher's tile by itself;
   the publisher comes from the file (ComicInfo.xml Publisher, the EPUB's publisher), else from the folder (Comics/Marvel/…), else "Edit details".
   Anything placed by hand wins: a series put inside another group stays there, a book set to "its own tile" stays on its own.
   Switch per shelf (shelf ⚙ → "Bundle series by publisher"); on by default for Comics. */
const PUB_ALIAS = [[/^marvel( comics| entertainment| worldwide)?$/i, 'Marvel'], [/^dc( comics| entertainment)?$/i, 'DC'], [/^dark ?horse( comics| books)?$/i, 'Dark Horse'], [/^image( comics)?$/i, 'Image'], [/^idw( publishing)?$/i, 'IDW'], [/^boom!?( studios)?$/i, 'BOOM! Studios']];
const cleanPub = p => { p = String(p || '').trim(); for(const [re, n] of PUB_ALIAS) if(re.test(p)) return n; return p };
/* Marvel/Spider-Man/x.cbz → Marvel; DC/Watchmen.cbz → DC too, but only when that folder also holds series folders (tops) – a folder like 'Loose' is no publisher */
const pubFolder = (dir, tops) => { const seg = String(dir || '').split('/').filter(Boolean), ok = seg.length >= 2 || (seg.length === 1 && tops && tops.has(seg[0])); return ok ? seg[0].replace(/[([][^)\]]*[)\]]/g, '').trim() : '' };
const pubTops = dirs => new Set(dirs.map(d => String(d || '').split('/').filter(Boolean)).filter(x => x.length >= 2).map(x => x[0]));
/* where a book's publisher comes from, in this order: the file / edited by hand → the folder → another book of the same series that
   has one ("learned", so the next weekly pack fills in by itself) → a well-known series or character in the name ("guessed", shown as such) */
const KNOWN_PUB = {
  Marvel:'spider man|spider gwen|spider woman|spider boy|avengers|x men|x force|x factor|uncanny|wolverine|deadpool|hulk|she hulk|thor|iron man|ironheart|captain america|captain marvel|fantastic four|daredevil|venom|carnage|black panther|doctor strange|ms marvel|moon knight|punisher|guardians of the galaxy|thunderbolts|black widow|hawkeye|ghost rider|silver surfer|scarlet witch|loki|magneto|psylocke|gambit|jean grey|new mutants|namor|elektra|kraven|eternals|inhumans|emma frost|squirrel girl|miles morales|ultimates|marvel',
  DC:'batman|superman|wonder woman|flash|green lantern|green arrow|aquaman|justice league|justice society|nightwing|batgirl|batwoman|harley quinn|catwoman|joker|poison ivy|teen titans|titans|supergirl|superboy|detective comics|action comics|shazam|suicide squad|zatanna|hawkgirl|martian manhunter|red hood|birds of prey|deathstroke|black adam|blue beetle|booster gold|swamp thing|constantine|hellblazer|lobo|power girl|gotham|arkham|dceased|jsa|jla|dc',
  Image:'spawn|saga|invincible|walking dead|geiger|monstress|radiant black',
  'Dark Horse':'hellboy|bprd|b p r d|umbrella academy',
  IDW:'teenage mutant ninja turtles|tmnt|sonic the hedgehog',
  'BOOM! Studios':'something is killing the children|house of slaughter|power rangers'};
/* names of more than one word, and distinctive single names, count anywhere in the series name ("Absolute Batman", "Uncanny X-Men");
   other single words (Saga, Flash, Titans, Thor …) only when they are the whole name apart from words like "The", "Absolute", "Amazing" */
const ANYWHERE = new Set('marvel dc batman superman wolverine deadpool avengers nightwing aquaman supergirl superboy batgirl batwoman catwoman hellboy spawn daredevil punisher hawkeye carnage venom dceased bprd tmnt'.split(' '));
const PREFIX_RE = /^((the|absolute|ultimate|all new|all new all different|amazing|uncanny|immortal|superior|spectacular|astonishing|sensational|new|savage|mighty|dark|young|original|untold|unstoppable) )+/;
const guessPub = name => { const n = norm(name), bare = n.replace(PREFIX_RE, '').trim();
  for(const [p, w] of Object.entries(KNOWN_PUB)) for(const k of w.split('|')){ if(k.includes(' ') || ANYWHERE.has(k)){ if((' ' + n + ' ').includes(' ' + k + ' ')) return p } else if(bare === k || n === k) return p }
  return '' };
let PUBLEARN = null;   // series → publisher, from the books that have one (rebuilt with the groups)
function pubLearn(){ if(PUBLEARN) return PUBLEARN; const c = {};
  for(const b of BOOKS){ const p = cleanPub(b.publisher || b.pubDir || b.cvPub); if(!p || !b.series) continue; const k = norm(b.series); (c[k] = c[k] || {})[p] = (c[k][p] || 0) + 1 }
  PUBLEARN = {}; for(const [k, ps] of Object.entries(c)) PUBLEARN[k] = Object.keys(ps).sort((a, b) => ps[b] - ps[a])[0]; return PUBLEARN }
function pubSource(b){ if(b.publisher) return {p:cleanPub(b.publisher), how:'file'}; if(b.pubDir) return {p:cleanPub(b.pubDir), how:'folder'}; if(b.cvPub) return {p:cleanPub(b.cvPub), how:'online'};
  const l = b.series && pubLearn()[norm(b.series)]; if(l) return {p:l, how:'series'};
  const g = guessPub(b.series || b.title || b.name); if(g) return {p:g, how:'guess'}; return {p:'', how:''} }
const publisherOf = b => pubSource(b).p;
function withPublishers(sh, r){
  if(!shelfOf(sh).byPub) return r;
  const G = grOf(sh), par = G.read('parent'), ov = G.read('items'), lab = G.read('label'), have = Object.fromEntries(r.groups.map(g => [g.key, g])), made = {};
  const pubG = name => { const key = 'p:' + norm(name); if(have[key]) return have[key]; if(!made[key]) made[key] = {key, name:lab[key] || name, kind:'publisher', items:[], kids:[], parent:null, auto:true}; return made[key] };
  const most = l => { const c = {}; for(const x of l) if(x) c[x] = (c[x] || 0) + 1; return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || '' };
  const moveG = [], moveS = [];
  for(const g of r.groups) if(!g.parent && par[g.key] === undefined && g.kind !== 'own' && g.kind !== 'publisher'){ const p = most(g.all.map(publisherOf)); if(p) moveG.push([g, pubG(p)]) }
  for(const b of r.singles) if(ov[b.id] === undefined){ const p = publisherOf(b); if(p) moveS.push([b, pubG(p)]) }
  /* a publisher with just one book and nothing else stays a plain tile */
  const count = {}; for(const [, P] of moveG.concat(moveS)) count[P.key] = (count[P.key] || 0) + 1;
  const keep = P => !P.auto || count[P.key] + (P.items.length) > 1 || moveG.some(([, Q]) => Q === P);
  for(const [g, P] of moveG) if(keep(P)){ g.parent = P.key; P.kids.push(g) }
  const gone = new Set(); for(const [b, P] of moveS) if(keep(P)){ P.items.push(b); gone.add(b) }
  for(const P of Object.values(made)) if(P.kids.length || P.items.length){ const pp = par[P.key]; P.parent = pp && (have[pp] || made[pp]) ? pp : null; if(P.parent) (have[pp] || made[pp]).kids.push(P); r.groups.push(P) }
  r.singles = r.singles.filter(b => !gone.has(b));
  for(const g of r.groups) g.all = G.all(g);
  return r }
let GROUPCACHE = {};
const regroup = () => { GROUPCACHE = {}; PUBLEARN = null };
/* "on the main page" by hand: remembered as '_top', so a series doesn't go back into its publisher tile by itself */
const toTop = (G, key) => { const par = G.read('parent'); par[key] = '_top'; G.write('parent', par) };
const grChange = (sh, fn, msg) => { const G = grOf(sh); G.change(fn); regroup(); G.undoToast(msg, () => { regroup(); selEnd(true); draw() }) };
const groupByKey = (sh, k) => groupsOf(sh).groups.find(g => g.key === k) || null;
const groupOfBook = b => groupsOf(b.shelf).groups.find(g => g.items.includes(b)) || null;
/* the books of a series in reading order (for "next in series" and "Read next") */
/* only the same series: a publisher or own group can hold other series too */
const seriesList = b => { const g = groupOfBook(b); if(!g) return [b]; const l = g.kind === 'series' ? g.items : b.series ? g.items.filter(x => norm(x.series) === norm(b.series)) : [b]; return l.slice().sort(seriesOrder) };
const nextInSeries = (b, d) => { const l = seriesList(b), i = l.indexOf(b); return i < 0 ? null : l[i + d] || null };

/* ---------- covers on screen (filled in when they scroll into view) ---------- */
const covIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ covIO.unobserve(e.target); fillCov(e.target) } }, {rootMargin:'300px'}) : null;
function phHTML(b, label){ const h = hue((b.series || b.title || '') + b.shelf); return `<div class="ph" style="--c1:hsl(${h} 45% 28%);--c2:hsl(${(h + 40) % 360} 40% 14%)"><i>${esc((b.fmt || '').toUpperCase())}</i>${esc(label || dispTitle(b))}<span>${esc(b.writer || '')}</span></div>` }
function coverHTML(b, cls, extra){ return `<div class="cv ${cls || ''}" data-cov="${esc(b.id)}">${phHTML(b)}${extra || ''}</div>` }
async function fillCov(el){ const u = await coverUrl(el.dataset.cov); if(!u) return; const ph = el.querySelector('.ph'); if(ph) ph.remove(); el.querySelectorAll('img').forEach(i => i.remove()); el.insertAdjacentHTML('afterbegin', `<img class="b" src="${u}" alt=""><img class="f" src="${u}" alt="">`) }
function lazyCovers(root){ (root || document).querySelectorAll('[data-cov]').forEach(el => { if(!COV.has(el.dataset.cov)) return; covIO ? covIO.observe(el) : fillCov(el) }) }
const RNDCOV = {};
function groupCoverHTML(sh, g){ const G = grOf(sh), c = G.cover(g.key), all = (g.all || g.items).slice().sort(seriesOrder), wc = all.filter(b => COV.has(b.id));
  if(c.t === 'pic' && COV.has('grp:' + sh + ':' + g.key)) return `<div class="cv" data-cov="grp:${esc(sh)}:${esc(g.key)}">${phHTML({title:g.name, shelf:sh}, g.name)}</div>`;
  let b = null; if(c.t === 'item') b = all.find(x => x.id === c.al);
  if(c.t === 'random' && wc.length){ b = wc.find(x => x.id === RNDCOV[g.key]) || wc[Math.floor(Math.random() * wc.length)]; RNDCOV[g.key] = b.id }
  b = b || wc[0] || all[0]; if(!b) return `<div class="cv">${phHTML({title:g.name, shelf:sh}, g.name)}</div>`;
  const h = coverHTML(b); return c.t === 'cycle' && wc.length > 1 ? h.replace('<div class="cv ', `<div data-cycle="${esc(sh)}|${esc(g.key)}" class="cv `) : h }
const CYCI = {};
setInterval(async () => { if(document.hidden || !$('#reader').hidden) return;
  for(const el of document.querySelectorAll('#body [data-cycle]')){ const r = el.getBoundingClientRect(); if(r.bottom < 0 || r.top > innerHeight) continue;
    const [sh, k] = el.dataset.cycle.split('|'), g = groupByKey(sh, k); if(!g) continue; const wc = g.all.filter(b => COV.has(b.id)).sort(seriesOrder); if(wc.length < 2) continue;
    CYCI[k] = ((CYCI[k] || 0) + 1) % wc.length; const u = await coverUrl(wc[CYCI[k]].id); if(!u) continue;
    el.querySelectorAll('img').forEach(im => { im.style.transition = 'opacity .5s'; im.style.opacity = 0; setTimeout(() => { im.src = u; im.onload = () => im.style.opacity = 1 }, 450) }) } }, 4000);

/* ---------- tiles ---------- */
function bookTile(b){ const p = progress(b), s = STATE[b.id], G = grOf(b.shelf);
  return `<div class="bk" data-book="${esc(b.id)}">${coverHTML(b, '', (G.isPinned('it:' + b.id) ? PINB : '') + (s && s.finished ? '<span class="done">READ</span>' : '') + (b.vol ? `<span class="vol">${esc(b.vol)}</span>` : ''))}
    ${p > 0 && p < 1 ? `<div class="pbar"><i style="width:${Math.round(p * 100)}%"></i></div>` : ''}<div class="t">${esc(dispTitle(b))}</div><div class="a">${esc(dispSub(b) || ' ')}</div></div>` }
function groupTile(sh, g){ const all = g.all || g.items, k = (g.kids || []).length, rd = all.filter(b => STATE[b.id] && STATE[b.id].finished).length, G = grOf(sh);
  return `<div class="bk stack" data-grp="${esc(g.key)}">${groupCoverHTML(sh, g)}${G.isPinned('gr:' + g.key) ? PINB : ''}<span class="cdl">${all.length ? plural(all.length, 'book') : 'empty'}</span>
    <div class="t">${esc(g.name)}</div><div class="a">${esc([G.label(g), k ? plural(k, 'group') : '', rd ? rd + ' of ' + all.length + ' read' : ''].filter(Boolean).join(' · '))}</div></div>` }

/* ---------- screens: a stack of views ---------- */
let V = [{v:'shelves'}];
const cur = () => V[V.length - 1];
function go(v){ selEnd(true); V.push(v); draw(); scrollTo(0, 0) }
function back(){ if(SEL){ selEnd(); return true } if(V.length > 1){ V.pop(); draw(); return true } return false }
$('#vback').onclick = () => back();
const Q = {};
/* sort menus: the same small menu on every page, each page remembers its own choice */
const SORTS = {shelf:[['series', 'Series & title'], ['title', 'Title'], ['read', 'Recently read'], ['added', 'Recently added'], ['writer', 'Writer']],
  inside:[['series', 'Series order'], ['title', 'Title'], ['read', 'Recently read'], ['added', 'Recently added']]};
const sortOf = (page, key) => S.sort[key || page] || SORTS[page][0][0];
const sortSel = (page, key) => `<select data-sort="${page}" data-skey="${esc(key || page)}" aria-label="Sort">${SORTS[page].map(([k, t]) => `<option value="${k}" ${sortOf(page, key) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const lastRead = x => x.items ? Math.max(0, ...(x.all || x.items).map(b => (STATE[b.id] || {}).last || 0)) : (STATE[x.id] || {}).last || 0;
const addedAt = x => x.items ? Math.max(0, ...(x.all || x.items).map(b => b.added || 0)) : x.added || 0;
const nameOf = x => x.items ? x.name : (x.series || x.title || x.name || '');
function sortTiles(list, k){ return list.slice().sort(k === 'title' ? (a, b) => coll.compare(norm(a.items ? a.name : a.title || a.name), norm(b.items ? b.name : b.title || b.name))
  : k === 'read' ? (a, b) => lastRead(b) - lastRead(a) || coll.compare(nameOf(a), nameOf(b)) : k === 'added' ? (a, b) => addedAt(b) - addedAt(a)
  : k === 'writer' ? (a, b) => coll.compare(norm(a.items ? (a.all[0] || {}).writer : a.writer) || 'zzz', norm(b.items ? (b.all[0] || {}).writer : b.writer) || 'zzz') || coll.compare(nameOf(a), nameOf(b))
  : (a, b) => coll.compare(norm(nameOf(a)), norm(nameOf(b))) || seriesOrder(a.items ? {} : a, b.items ? {} : b)) }
const FILTERS = [['all', 'All'], ['reading', 'Reading'], ['new', 'Not started'], ['done', 'Finished']], FILTER_NOPUB = ['nopub', 'No publisher'];
const passFilter = (b, f) => f === 'nopub' ? !publisherOf(b) : f === 'reading' ? started(b) && !(STATE[b.id] || {}).finished : f === 'new' ? !started(b) : f === 'done' ? !!(STATE[b.id] || {}).finished : true;

function draw(){
  const v = cur(), body = $('#body'); $('#vback').hidden = V.length < 2; $('#addbtn').hidden = !(v.v === 'shelf' || v.v === 'group');
  $('#hubback').hidden = !(fromHub() && V.length < 2);
  let h = '';
  if(v.v === 'shelves'){ $('#vtitle').textContent = 'Bookcase'; document.title = 'Nightvault Bookcase';
    const last = BOOKS.filter(b => started(b) && !STATE[b.id].finished).sort((a, b) => STATE[b.id].last - STATE[a.id].last)[0];
    if(last) h += contCard(last, true);
    h += '<div class="shelves">' + shelves().map(s => { const bs = inShelf(s.id), rd = bs.filter(b => started(b) && !STATE[b.id].finished).length;
        const fan = bs.filter(b => COV.has(b.id)).sort((a, b) => (lastRead(b) - lastRead(a)) || (b.added - a.added)).slice(0, 3);
        return `<div class="shelf" data-shelf="${esc(s.id)}" style="background:linear-gradient(150deg,${s.c[0]},${s.c[1]})"><div class="ic">${shelfIcon(s)}</div><div class="fan">${fan.map(b => `<img data-fan="${esc(b.id)}" alt="">`).join('')}</div>
          <b>${esc(s.name)}</b><div class="s">${bs.length ? plural(bs.length, 'book') + (rd ? ` · ${rd} reading` : '') : 'empty'}</div></div>` }).join('')
      + '<div class="shelf add" id="newshelf"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>New shelf</div></div>';
    if(!BOOKS.length) h += `<p class="muted small" style="text-align:center;margin-top:18px">Open a shelf and tap <b>Add</b>${NvFiles ? ' to pick a folder on this phone' : ' to pick books'}.</p>`;
    h += storeLine();
    body.innerHTML = h; lazyCovers(body);
    body.querySelectorAll('[data-fan]').forEach(async im => { const u = await coverUrl(im.dataset.fan); if(u) im.src = u; else im.remove() });
    return }
  if(v.v === 'shelf'){ const s = shelfOf(v.shelf), all = inShelf(s.id), q = norm(Q[s.id] || ''), f = S.filter[s.id] || 'all', G = grOf(s.id);
    $('#vtitle').textContent = s.name; document.title = s.name + ' · Bookcase';
    if(!all.length){ body.innerHTML = `<div class="empty">${shelfIcon(s, 48)}<h2 style="margin:8px 0 4px;font-size:18px">No ${esc(s.name.toLowerCase())} yet</h2><p class="muted small" style="margin:0 0 14px">${NvFiles ? 'Tap <b>Add</b> and pick the folder on this phone where they are. Nothing is copied.' : 'Tap <b>Add</b> and pick books. They are copied into the app.'}</p><button class="btn primary" id="emptyadd">Add ${esc(s.name.toLowerCase())}</button></div>`; $('#emptyadd').onclick = addSheet; return }
    h += `<input type="search" id="q" placeholder="Search ${esc(s.name.toLowerCase())}, series, writers" value="${esc(Q[s.id] || '')}" style="margin:2px 0 8px">`;
    if(q){ const {groups:gs} = groupsOf(s.id), where = {}; for(const g of gs) for(const b of g.items) where[b.id] = G.path(g, gs);
      const gm = gs.filter(g => norm(g.name).includes(q)).slice(0, 12), bm = all.filter(b => norm([b.title, b.series, b.writer, b.artist, b.name, publisherOf(b)].join(' ')).includes(q)).sort(seriesOrder);
      if(!gm.length && !bm.length) h += '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
      if(gm.length) h += `<div class="sec">Groups</div><div class="grid">${gm.map(g => groupTile(s.id, g).replace(/<div class="a">[^<]*<\/div>/, g.parent ? `<div class="a">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : '$&')).join('')}</div>`;
      if(bm.length) h += `<div class="sec">Books</div><div class="grid">${bm.slice(0, 300).map(b => bookTile(b).replace(/<div class="a">[^<]*<\/div>/, where[b.id] ? `<div class="a">in ${esc(where[b.id])}</div>` : '$&')).join('')}</div>` }
    else { const lastS = all.filter(b => started(b) && !STATE[b.id].finished).sort((a, b) => STATE[b.id].last - STATE[a.id].last)[0]; if(lastS && f === 'all') h += contCard(lastS);
      h += `<div class="chips">${FILTERS.concat(s.byPub && all.some(b => !publisherOf(b)) ? [[FILTER_NOPUB[0], `${FILTER_NOPUB[1]} (${all.filter(b => !publisherOf(b)).length})`]] : []).map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${t}</button>`).join('')}</div>`;
      const grouped = S.grouped[s.id] !== false;
      h += `<div class="mbar"><select id="grouped" aria-label="Groups"><option value="1" ${grouped ? 'selected' : ''}>Grouped</option><option value="0" ${!grouped ? 'selected' : ''}>All books</option></select>${sortSel('shelf', 'shelf:' + s.id)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button><button class="btn sm" id="newgrp">+ Group</button></div>`;
      const vis = all.filter(b => passFilter(b, f)), k = sortOf('shelf', 'shelf:' + s.id);
      h += `<div class="mtot">${plural(vis.length, 'book')}${f === 'all' ? ` · ${all.filter(b => (STATE[b.id] || {}).finished).length} read` : ''}</div>`;
      let tiles;
      if(!grouped || f !== 'all') tiles = sortTiles(vis, k);
      else { const {groups, singles} = groupsOf(s.id); tiles = sortTiles([...groups.filter(g => !g.parent), ...singles], k) }
      tiles = G.pinFirst(tiles, x => (x.items ? 'gr:' : 'it:') + (x.items ? x.key : x.id));
      h += `<div class="grid">${tiles.map(x => x.items ? groupTile(s.id, x) : bookTile(x)).join('')}</div>` }
    h += storeLine(s.id);
    body.innerHTML = h; lazyCovers(body); hookShelf(s); return }
  if(v.v === 'group'){ const G = grOf(v.shelf), g = groupByKey(v.shelf, v.key); if(!g){ V.pop(); return draw() }
    const gs = groupsOf(v.shelf).groups, all = g.all, rd = all.filter(b => (STATE[b.id] || {}).finished).length, ord = all.slice().sort(seriesOrder);
    const nextB = ord.find(b => started(b) && !STATE[b.id].finished) || ord.find(b => !(STATE[b.id] || {}).finished);
    $('#vtitle').textContent = ''; document.title = g.name + ' · Bookcase';
    h += `<div class="alhead"><div class="stack" style="flex:none"><div class="gcv" style="width:min(30vw,130px)">${groupCoverHTML(v.shelf, g)}</div></div><div style="min-width:0;flex:1"><b>${esc(g.name)}</b>
      ${g.parent ? `<div class="lnk small" data-gotogrp="${esc(g.parent)}">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : ''}
      <div class="muted small">${esc(G.label(g))} · ${(g.kids || []).length ? plural(g.kids.length, 'group') + ' · ' : ''}${plural(all.length, 'book')}${rd ? ` · ${rd} read` : ''}</div>
      ${[...new Set(all.map(b => b.writer).filter(Boolean))].length === 1 ? `<div class="muted small">${esc(all.find(b => b.writer).writer)}</div>` : ''}</div></div>`;
    h += `<div class="mbar">${nextB ? `<button class="btn primary" data-read="${esc(nextB.id)}" style="flex:1;min-width:0"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${started(nextB) ? 'Continue' : 'Read'}: ${esc(g.kind === 'series' ? (nextB.vol || nextB.title) : dispTitle(nextB))}</span></button>` : ''}<button class="ib" id="gmenu" aria-label="More for this group">${IC_DOTS}</button></div>`;
    h += `<div class="mbar">${sortSel('inside', 'grp:' + v.shelf + ':' + g.key)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button></div>`;
    const kids = sortTiles(g.kids || [], sortOf('inside', 'grp:' + v.shelf + ':' + g.key)), k = sortOf('inside', 'grp:' + v.shelf + ':' + g.key), items = k === 'series' ? g.items.slice().sort(seriesOrder) : sortTiles(g.items, k);
    h += `<div class="grid">${G.pinFirst([...kids, ...items], x => (x.items ? 'gr:' + x.key : 'it:' + x.id)).map(x => x.items ? groupTile(v.shelf, x) : bookTile(x)).join('')}</div>`;
    if(!all.length) h += `<p class="muted small" style="margin-top:12px">Empty. Tap ⋯ → <b>Add books…</b> to put books in it.</p>`;
    body.innerHTML = h; lazyCovers(body); hookGrid(v.shelf); $('#gmenu').onclick = () => groupMenu(v.shelf, g); return }
  if(v.v === 'book') return drawBook(v.id) }
function contCard(b, withShelf){ const s = STATE[b.id], p = progress(b);
  return `<div class="cont" data-read="${esc(b.id)}">${coverHTML(b)}<div style="flex:1;min-width:0"><small>CONTINUE READING${withShelf ? ' · ' + esc(shelfOf(b.shelf).name.toUpperCase()) : ''}</small><b>${esc(dispTitle(b))}</b>
    <div class="muted small">${b.fmt === 'epub' && s.flow ? Math.round(p * 100) + '%' : `Page ${s.page + 1} of ${s.pages || b.pages || '?'}`}</div><div class="pbar"><i style="width:${Math.round(p * 100)}%"></i></div></div></div>` }
function storeLine(sh){ const bs = sh ? inShelf(sh) : BOOKS, cp = bs.filter(b => b.src && b.src.kind === 'copy'), used = cp.reduce((a, b) => a + (b.size || 0), 0), ln = bs.length - cp.length;
  return bs.length ? `<div class="store">${plural(bs.length, 'book')}${ln ? ` · ${ln} read from phone folders` : ''}${cp.length ? ` · ${plural(cp.length, 'copy', 'copies')} in the app, ${mb(used)}` : ''}</div>` : '' }

/* clicks on the screens */
$('#body').addEventListener('click', e => {
  if(selSkip){ selSkip = false; return }
  const t = e.target, el = t.closest('[data-shelf],[data-book],[data-grp],[data-read],[data-filter],[data-selstart],[data-gotogrp],#newshelf,#newgrp');
  if(!el) return; const v = cur();
  if(SEL && el.closest('.grid') && (el.dataset.book || el.dataset.grp)){ const id = el.dataset.book ? 'it:' + el.dataset.book : 'gr:' + el.dataset.grp; SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw(); return }
  if(el.id === 'newshelf') return newShelf();
  if(el.id === 'newgrp') return newGroup(v.shelf);
  if(el.dataset.shelf) return go({v:'shelf', shelf:el.dataset.shelf});
  if(el.dataset.read) return openReader(BK[el.dataset.read]);
  if(el.dataset.book) return go({v:'book', id:el.dataset.book});
  if(el.dataset.grp) return go({v:'group', shelf:v.shelf, key:el.dataset.grp});
  if(el.dataset.gotogrp){ V.pop(); if(cur().v !== 'group' || cur().key !== el.dataset.gotogrp) V.push({v:'group', shelf:v.shelf, key:el.dataset.gotogrp}); return draw() }
  if(el.dataset.filter){ S.filter[v.shelf] = el.dataset.filter; saveS(); return draw() }
  if(el.dataset.selstart) return selStart() });
$('#body').addEventListener('change', e => { const t = e.target, v = cur();
  if(t.dataset.sort){ S.sort[t.dataset.skey] = t.value; saveS(); draw() }
  if(t.id === 'grouped'){ S.grouped[v.shelf] = t.value === '1'; saveS(); draw() } });
function hookShelf(s){ const q = $('#q'); if(q){ q.oninput = () => { Q[s.id] = q.value; clearTimeout(q._t); q._t = setTimeout(() => { const p = q.selectionStart; draw(); const n = $('#q'); if(n){ n.focus(); try{ n.setSelectionRange(p, p) }catch(e){} } }, 250) } } hookGrid(s.id) }
/* long-press a tile: select it (then tap more tiles) */
let SEL = null, selSkip = false;
function hookGrid(sh){ document.querySelectorAll('#body .grid').forEach(gr => {
  let tmr = null, sx = 0, sy = 0;
  gr.onpointerdown = e => { const el = e.target.closest('.bk'); if(!el) return; sx = e.clientX; sy = e.clientY; clearTimeout(tmr);
    tmr = setTimeout(() => { const id = el.dataset.book ? 'it:' + el.dataset.book : el.dataset.grp ? 'gr:' + el.dataset.grp : null; if(!id) return; selSkip = true; if(!SEL) selStart(id); else { SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw() } try{ navigator.vibrate && navigator.vibrate(20) }catch(e){} }, 520) };
  gr.onpointermove = e => { if(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(tmr) };
  gr.onpointerup = gr.onpointercancel = () => clearTimeout(tmr);
  gr.oncontextmenu = e => { if(e.target.closest('.bk')) e.preventDefault() } }) }

/* ---------- the book page (summary) ---------- */
function drawBook(id){ const b = BK[id]; if(!b){ V.pop(); return draw() }
  const s = STATE[b.id], p = progress(b), g = groupOfBook(b), prev = nextInSeries(b, -1), next = nextInSeries(b, 1), sh = shelfOf(b.shelf);
  $('#vtitle').textContent = ''; document.title = dispTitle(b) + ' · Bookcase';
  const where = b.src.kind === 'link' ? 'In a folder on this phone' : 'Copied into the app';
  const facts = [['Publisher', (() => { const x = pubSource(b); return x.p ? esc(x.p) + ({folder:' <span class="muted">· from the folder</span>', online:' <span class="muted">· from Comic Vine</span>', series:' <span class="muted">· like the rest of this series</span>', guess:' <span class="muted">· guessed from the name – fix it with Edit details</span>'}[x.how] || '') : '' })()], ['Series', b.series ? `<span class="lnk" data-gotogrp2="1">${esc(b.series)}</span>${b.vol ? ' · ' + esc(b.vol) : ''}` : ''], ['Writer', esc(b.writer)], ['Artist', esc(b.artist)], ['Year', esc(b.year)],
    ['Pages', b.pages ? String(b.pages) : ''], ['Reading', b.rtl ? 'Right to left (manga)' : b.rtl === false ? 'Left to right' : ''], ['Comic Vine', b.cv ? esc(b.cv.name) + (b.cv.start ? ` (${b.cv.start})` : '') : ''], ['File', `${esc((b.fmt || '').toUpperCase())}${b.size ? ' · ' + mb(b.size) : ''}`], ['Where', where + (b.dir ? ` · <span class="muted">${esc(b.dir)}</span>` : '')], ['Shelf', esc(sh.name)]].filter(x => x[1]);
  const nx = (x, lbl) => x ? `<div class="nx" data-book="${esc(x.id)}">${coverHTML(x)}<div class="n"><small>${lbl}</small><div>${esc(x.vol || x.title)}</div></div></div>` : '<div></div>';
  let h = `<div class="alhead" style="align-items:flex-start">${coverHTML(b)}<div style="min-width:0;flex:1"><b>${esc(b.series && b.title && norm(b.title) !== norm(b.series) ? b.title : dispTitle(b))}</b>
    ${b.series ? `<div class="lnk small" data-gotogrp2="1">${esc(b.series)}${b.vol ? ' · ' + esc(b.vol) : ''}</div>` : ''}<div class="muted small">${esc([b.writer, b.year].filter(Boolean).join(' · '))}</div>
    <div class="muted small" style="margin-top:8px">${s && s.finished ? '✓ Read' : started(b) ? (b.fmt === 'epub' && s.flow ? Math.round(p * 100) + '% read' : `Page ${s.page + 1} of ${s.pages || b.pages}`) : 'Not started'}</div>${p > 0 && p < 1 ? `<div class="pbar"><i style="width:${Math.round(p * 100)}%"></i></div>` : ''}</div></div>
    <div class="mbar"><button class="btn primary" data-read="${esc(b.id)}" style="flex:1">${s && s.finished ? 'Read again' : started(b) ? 'Continue reading' : 'Read'}</button><button class="ib" id="bmenu" aria-label="More for this book">${IC_DOTS}</button></div>`;
  if(prev || next) h += `<div class="nexts">${nx(prev, 'PREVIOUS')}${nx(next, 'NEXT IN SERIES')}</div>`;
  if(b.desc) h += `<div class="sec">About</div><div class="desc clip" id="bdesc">${esc(b.desc)}</div>${b.desc.length > 300 ? '<button class="btn sm" id="bmore" style="margin-top:6px">More</button>' : ''}`;
  h += `<div class="sec">Details</div><div class="facts">${facts.map(([k, v]) => `<span>${k}</span><span style="min-width:0;overflow-wrap:anywhere">${v}</span>`).join('')}</div>`;
  if(s && s.marks && s.marks.length) h += `<div class="sec">Bookmarks</div>${s.marks.map((m, i) => `<div class="li" data-mark="${i}"><span class="r" style="color:var(--accent)">★</span><div class="n"><div>${esc(m.name)}</div><div class="s">${m.flow ? Math.round((m.pos || 0) * 100) + '%' : 'Page ' + (m.p + 1)}</div></div></div>`).join('')}`;
  $('#body').innerHTML = h; lazyCovers($('#body'));
  $('#bmenu').onclick = () => bookMenu(b);
  if($('#bmore')) $('#bmore').onclick = () => { $('#bdesc').classList.remove('clip'); $('#bmore').remove() };
  document.querySelectorAll('[data-gotogrp2]').forEach(el => el.onclick = () => { if(g) go({v:'group', shelf:b.shelf, key:g.key}) });
  document.querySelectorAll('[data-mark]').forEach(el => el.onclick = () => openReader(b, s.marks[+el.dataset.mark])) }

/* ---------- sheets ---------- */
function sheet(html, sticky){ $('#sheets').innerHTML = `<div class="scrim" id="scrim"><div class="sheet"><div class="grab"></div>${html}</div></div>`; $('#scrim').dataset.sticky = sticky ? '1' : '';
  $('#scrim').onclick = e => { if(e.target.id === 'scrim' && !$('#scrim').dataset.sticky) closeSheet() } }
function closeSheet(){ $('#sheets').innerHTML = '' }
window.closeSheet = closeSheet;
const sheetOpen = () => !!$('#scrim');
const ask = (title, ph, val, btn) => new Promise(ok => { sheet(`<h3>${title}</h3><input type="text" id="askv" placeholder="${esc(ph || '')}" value="${esc(val || '')}" maxlength="80"><p class="muted small" id="askerr" style="margin:8px 0 0;color:#e88"></p><div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" id="askno">Cancel</button><button class="btn primary" style="flex:2" id="askok">${btn || 'OK'}</button></div>`);
  setTimeout(() => { const i = $('#askv'); if(i){ i.focus(); i.select() } }, 50);
  const done = v => { closeSheet(); ok(v) }; $('#askno').onclick = () => done(null); $('#askok').onclick = () => done($('#askv').value.trim()); $('#askv').onkeydown = e => { if(e.key === 'Enter') done($('#askv').value.trim()) } });

/* ---------- book ⋯ ---------- */
function bookMenu(b){ const G = grOf(b.shelf), s = STATE[b.id], pin = G.isPinned('it:' + b.id);
  sheet(`<h3>${esc(dispTitle(b))}</h3><div class="mlist">
    <button class="btn" id="bmg">Put in a group…</button><button class="btn" id="bms">Move to another shelf…</button><button class="btn" id="bme">Edit details</button>
    <button class="btn" id="bmr">${s && s.finished ? 'Mark as not read' : 'Mark as read'}</button><button class="btn" id="bmp">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    <button class="btn" id="bmcv">Look up online (Comic Vine)…</button><button class="btn" id="bmc">Change the cover</button><button class="btn" id="bmprint">Print…</button>
    <button class="btn danger" id="bmx">${b.src.kind === 'link' ? 'Remove from Bookcase (the file stays)' : 'Remove from Bookcase'}</button></div>`);
  $('#bmg').onclick = () => groupPicker(b); $('#bms').onclick = () => shelfPicker([b.id]); $('#bme').onclick = () => editBook(b);
  $('#bmr').onclick = () => { const x = st(b.id); x.finished = !x.finished; if(x.finished){ x.last = x.last || Date.now(); x.page = Math.max(0, (x.pages || b.pages || 1) - 1) } else x.page = 0; saveState(b.id, true); closeSheet(); draw() };
  $('#bmp').onclick = () => { G.togglePin(['it:' + b.id], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  $('#bmcv').onclick = () => cvChoose(b);
  $('#bmc').onclick = () => coverSheet(b); $('#bmprint').onclick = () => { closeSheet(); printSheet(b) };
  $('#bmx').onclick = () => removeBooks([b.id]) }
async function removeBooks(ids){ const bs = ids.map(id => BK[id]).filter(Boolean); if(!bs.length) return;
  const cp = bs.filter(b => b.src.kind === 'copy').length;
  if(!confirm(`Remove ${bs.length === 1 ? '“' + dispTitle(bs[0]) + '”' : plural(bs.length, 'book')} from Bookcase?${cp ? `\n\nThe ${cp === 1 ? 'copy' : cp + ' copies'} in the app will be deleted.` : ''}${bs.length - cp ? '\n\nFiles in phone folders stay where they are.' : ''}`)) return;
  for(const b of bs){ if(b.src.kind === 'copy'){ if(b.src.fid) await dbDel('files', b.src.fid).catch(() => {}); if(b.src.fids) await dbDelMany('files', b.src.fids.map(x => x.fid)).catch(() => {}) }
    await dbDel('books', b.id).catch(() => {}); await dbDel('covers', b.id).catch(() => {}); await dbDel('state', b.id).catch(() => {}); COV.delete(b.id); delete STATE[b.id]; delete BK[b.id] }
  const g = new Set(bs.map(b => b.id)); BOOKS = BOOKS.filter(b => !g.has(b.id)); regroup(); closeSheet(); selEnd(true);
  if(cur().v === 'book' && g.has(cur().id)) V.pop(); draw(); toast(plural(bs.length, 'book') + ' removed') }
function editBook(b){
  sheet(`<h3>Edit details</h3>
    ${[['title', 'Title'], ['series', 'Series'], ['publisher', 'Publisher'], ['num', 'Number in the series (for the order)'], ['vol', 'Shown as (like Vol. 3 or #12)'], ['writer', 'Writer'], ['artist', 'Artist'], ['year', 'Year']].map(([k, t]) => `<div class="field"><label>${t}</label><input type="${k === 'num' ? 'number' : 'text'}" step="any" id="ed_${k}" value="${esc(b[k] == null ? '' : b[k])}"></div>`).join('')}
    <div class="field"><label>About</label><textarea id="ed_desc">${esc(b.desc || '')}</textarea></div>
    <div class="field"><label>Reading direction</label><select id="ed_rtl" style="width:100%;height:42px"><option value="">Like the shelf (${shelfOf(b.shelf).rtl ? 'right to left' : 'left to right'})</option><option value="ltr" ${b.rtl === false ? 'selected' : ''}>Left to right</option><option value="rtl" ${b.rtl === true ? 'selected' : ''}>Right to left (manga)</option></select></div>
    <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="edsave">Save</button></div>`, true);
  $('#edsave').onclick = async () => { for(const k of ['title', 'series', 'publisher', 'vol', 'writer', 'artist', 'year', 'desc']) b[k] = $('#ed_' + k).value.trim();
    const n = $('#ed_num').value.trim(); b.num = n === '' ? null : parseFloat(n); const r = $('#ed_rtl').value; b.rtl = r === 'rtl' ? true : r === 'ltr' ? false : null;
    if(b.num != null && !b.vol) b.vol = '#' + b.num;
    await dbPut('books', b); regroup(); closeSheet(); draw(); toast('Saved') } }
function coverSheet(b){
  sheet(`<h3>Cover of “${esc(dispTitle(b))}”</h3><div class="mlist"><button class="btn" id="cvpage">Use a page of the book…</button><button class="btn" id="cvpic">A picture from the phone</button></div>`);
  $('#cvpic').onclick = () => { const i = $('#pickpic'); i.value = ''; i.onchange = async e => { const f = e.target.files[0]; if(!f) return; await setCover(b.id, await thumb(f)); closeSheet(); draw(); toast('Cover changed') }; i.click() };
  $('#cvpage').onclick = async () => { const n = await ask('Which page?', 'Page number', '1', 'Use this page'); if(!n) return; const i = Math.max(1, parseInt(n) || 1) - 1;
    toast('Making the cover…'); try{ const d = await openDoc(b); if(d.flow) throw new Error('Text books have no pages to pick from'); const bl = await d.page(Math.min(i, d.n - 1), 800); await setCover(b.id, await thumb(bl)); d.close && d.close(); draw(); toast('Cover changed') }catch(e){ toast(e.message || String(e), 4000) } } }
function shelfPicker(ids){ const sh = BK[ids[0]] && BK[ids[0]].shelf;
  sheet(`<h3>Move ${ids.length === 1 ? '“' + esc(dispTitle(BK[ids[0]])) + '”' : plural(ids.length, 'book')} to…</h3>${shelves(true).filter(s => s.id !== sh).map(s => `<div class="li" data-to="${esc(s.id)}"><span style="width:34px;display:flex;justify-content:center">${shelfIcon(s, 22)}</span><div class="n"><div>${esc(s.name)}</div><div class="s">${plural(inShelf(s.id).length, 'book')}</div></div></div>`).join('')}`);
  $('.sheet').addEventListener('click', async e => { const r = e.target.closest('[data-to]'); if(!r) return; const to = r.dataset.to;
    for(const id of ids){ const b = BK[id]; if(!b) continue; b.shelf = to; await dbPut('books', b) }
    regroup(); closeSheet(); selEnd(true); toast(`${plural(ids.length, 'book')} moved to ${shelfOf(to).name}`); draw() }) }

/* ---------- groups: menus (the same words as Music) ---------- */
function newGroup(sh){ ask('New group', 'Name, like Star Wars or Marvel', '', 'Make the group').then(n => { if(!n) return; const G = grOf(sh); G.own(n); regroup();
  const g = groupByKey(sh, 'c:' + norm(n)); S.grouped[sh] = true; saveS(); draw(); toast(`Group “${n}”: ${plural(g ? g.all.length : 0, 'book')}. Books with this word in their title, series or writer go in by themselves.`, 4500) }) }
function groupMenu(sh, g){ const G = grOf(sh), pin = G.isPinned('gr:' + g.key);
  sheet(`<h3>${esc(g.name)}</h3><div class="mlist"><button class="btn primary" id="gadd">Add books…</button><button class="btn" id="gsub">New group inside</button><button class="btn" id="gmove">Put this group inside another group…</button><button class="btn" id="gren">Rename</button><button class="btn" id="gcov">Choose the tile cover</button><button class="btn" id="gpin">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button><button class="btn" id="gshelf">Move these books to another shelf…</button>${g.kind === 'own' ? '<button class="btn danger" id="gdel">Remove this group</button>' : ''}</div>
    ${g.kind === 'own' ? '<p class="muted small" style="margin:10px 0 0">Removing the group keeps the books - they show as their own tiles again (or in their series).</p>' : ''}`);
  $('#gadd').onclick = () => addItemsSheet(sh, g); $('#gsub').onclick = () => newSubGroup(sh, g); $('#gmove').onclick = () => moveGroupSheet(sh, g); $('#gren').onclick = () => renameGroup(sh, g); $('#gcov').onclick = () => groupCoverSheet(sh, g);
  $('#gpin').onclick = () => { G.togglePin(['gr:' + g.key], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  $('#gshelf').onclick = () => shelfPicker(g.all.map(b => b.id));
  if($('#gdel')) $('#gdel').onclick = () => { closeSheet(); if(cur().v === 'group' && cur().key === g.key) V.pop(); grChange(sh, () => G.remove(g), `Group “${g.name}” removed`); draw() } }
function addItemsSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, where = {}; for(const x of gs) for(const b of x.items) where[b.id] = x;
  const pick = new Set(); let q = '';
  const list = () => { const nq = norm(q); return inShelf(sh).filter(b => !g.items.includes(b) && (!nq || norm([b.title, b.series, b.writer, (where[b.id] || {}).name].join(' ')).includes(nq))).sort((x, y) => coll.compare(norm(dispTitle(x)), norm(dispTitle(y)))) };
  const drawL = () => { const l = list(), el = $('#aalist'); if(!el) return;
    el.innerHTML = l.slice(0, 400).map(b => `<label class="li" style="cursor:pointer"><input type="checkbox" data-aa="${esc(b.id)}" ${pick.has(b.id) ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accentd);flex:none"><span class="th">${coverHTML(b)}</span><div class="n"><div>${esc(dispTitle(b))}</div><div class="s">${esc(dispSub(b))}${where[b.id] ? ' · in ' + esc(G.path(where[b.id], gs)) : ''}</div></div></label>`).join('') + (l.length > 400 ? `<p class="muted small">… and ${l.length - 400} more - type to narrow it down</p>` : '') + (!l.length ? '<p class="muted small">Nothing found.</p>' : '');
    lazyCovers(el); upd() };
  const upd = () => { $('#aago').textContent = pick.size ? `Add ${plural(pick.size, 'book')}` : 'Add'; $('#aago').disabled = !pick.size };
  sheet(`<h3>Add books to “${esc(g.name)}”</h3><input type="search" id="aaq" placeholder="Search title, series, writer or group"><div id="aalist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="aago" disabled>Add</button></div>`, true);
  $('#aaq').oninput = e => { q = e.target.value; drawL() };
  $('#aalist').onchange = e => { const c = e.target.closest('[data-aa]'); if(!c) return; c.checked ? pick.add(c.dataset.aa) : pick.delete(c.dataset.aa); upd() };
  $('#aago').onclick = () => { grChange(sh, () => G.put([...pick], g), `${plural(pick.size, 'book')} added to “${g.name}”`); closeSheet(); draw() };
  drawL() }
function newSubGroup(sh, g){ ask(`New group inside “${esc(g.name)}”`, 'Name, like Year One or Season 2', '', 'Make it').then(n => { if(!n) return; const G = grOf(sh), k = G.own(n); if(k.key === g.key) return; G.setParent(k.key, g.key); regroup(); draw(); toast(`“${n}” made inside “${g.name}” - open it and add books`) }) }
function moveGroupSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, bad = new Set(G.inside(g, gs).concat(g.key)), opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Put “${esc(g.name)}” inside…</h3>${g.parent ? '<button class="btn" id="mgtop" style="width:100%;margin-bottom:8px">Back on the main page</button>' : ''}
    ${opts.map(x => `<div class="li" data-mg="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'book')}</div></div></div>`).join('') || '<p class="muted small">No other groups yet. Make one with “+ Group” on the shelf.</p>'}`);
  lazyCovers($('.sheet'));
  if($('#mgtop')) $('#mgtop').onclick = () => { grChange(sh, () => toTop(G, g.key), `“${g.name}” is back on the main page`); closeSheet(); draw() };
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-mg]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.mg); grChange(sh, () => G.setParent(g.key, t.key), `“${g.name}” is now inside “${t.name}”`); closeSheet(); draw() }) }
function groupPicker(b){ const sh = b.shelf, G = grOf(sh), now = groupOfBook(b), gs = groupsOf(sh).groups.filter(g => !now || g.key !== now.key).sort((x, y) => coll.compare(x.name, y.name)), ov = G.read('items');
  sheet(`<h3>Put “${esc(dispTitle(b))}” in a group</h3>${now ? `<p class="muted small" style="margin:0 0 8px">Now in “${esc(now.name)}”.</p>` : ''}
    <div style="display:flex;gap:8px"><input type="text" id="gpn" placeholder="New group name" maxlength="60"><button class="btn primary" id="gpmake">Make</button></div>
    <div style="margin-top:10px">${gs.map(g => `<div class="li" data-gp="${esc(g.key)}"><span class="th">${groupCoverHTML(sh, g)}</span><div class="n"><div>${esc(G.path(g, groupsOf(sh).groups))}</div><div class="s">${plural(g.items.length, 'book')}</div></div></div>`).join('') || '<p class="muted small">No group tiles yet.</p>'}</div>
    <div class="mlist" style="margin-top:10px">${now ? '<button class="btn" id="gpout">Take it out of its group (its own tile)</button>' : ''}${ov[b.id] ? '<button class="btn" id="gpauto">Back to automatic</button>' : ''}</div>`);
  lazyCovers($('.sheet'));
  const done = (fn, m) => { grChange(sh, fn, m); closeSheet(); draw() };
  $('#gpmake').onclick = () => { const n = $('#gpn').value.trim(); if(!n) return; done(() => G.put([b.id], G.own(n)), `Put in “${n}”`) };
  if($('#gpout')) $('#gpout').onclick = () => done(() => G.put([b.id], 'none'), 'Now on its own tile');
  if($('#gpauto')) $('#gpauto').onclick = () => done(() => G.put([b.id]), 'Back to automatic');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-gp]'); if(!r) return; const g = groupByKey(sh, r.dataset.gp); if(g) done(() => G.put([b.id], g), `Put in “${g.name}”`) }) }
function renameGroup(sh, g){ const G = grOf(sh);
  ask(`Rename “${esc(g.name)}”`, 'Name', g.name, 'Rename').then(n => { if(n == null || n === g.name) return; let err = ''; G.change(() => { err = G.rename(g, n) });
    if(err){ G.undo(); toast(err, 4000); return } regroup();
    const v = cur(); if(v.v === 'group' && v.key === g.key && g.kind === 'own') v.key = 'c:' + norm(n);
    draw(); G.undoToast(`Renamed to “${n}”`, () => { regroup(); draw() }) }) }
function groupCoverSheet(sh, g){ const G = grOf(sh), c = G.cover(g.key), wc = g.all.filter(b => COV.has(b.id)).sort(seriesOrder);
  const save = v => { G.setCover(g.key, v); delete RNDCOV[g.key]; closeSheet(); draw(); toast('Tile cover saved') };
  sheet(`<h3>Tile cover for “${esc(g.name)}”</h3>
    <div class="chips"><button class="chip ${!c.t ? 'on' : ''}" data-gc="">The first book</button><button class="chip ${c.t === 'random' ? 'on' : ''}" data-gc="random">A random one</button><button class="chip ${c.t === 'cycle' ? 'on' : ''}" data-gc="cycle">Changing (one after another)</button><button class="chip ${c.t === 'pic' ? 'on' : ''}" data-gc="pic">A picture from the phone</button></div>
    <div class="sec">Or pick one</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${wc.map(b => `<div class="bk" data-gca="${esc(b.id)}" style="${c.t === 'item' && c.al === b.id ? 'outline:2px solid var(--accent);border-radius:10px' : ''}">${coverHTML(b)}<div class="a">${esc(b.vol || b.title)}</div></div>`).join('') || '<p class="muted small">No covers in this group yet.</p>'}</div>`);
  lazyCovers($('.sheet'));
  $('.sheet').onclick = e => { const bt = e.target.closest('[data-gc]'), it = e.target.closest('[data-gca]');
    if(it) return save({t:'item', al:it.dataset.gca}); if(!bt) return; const t = bt.dataset.gc;
    if(t === 'pic'){ const i = $('#pickpic'); i.value = ''; i.onchange = async ev => { const f = ev.target.files[0]; if(!f) return; await setCover('grp:' + sh + ':' + g.key, await thumb(f)); save({t:'pic'}) }; i.click(); return }
    save(t ? {t} : null) } }

/* ---------- select several tiles and move them at once (long-press a tile, or "Select") ---------- */
function selStart(id){ SEL = new Set(id ? [id] : []); selDraw() }
function selEnd(quiet){ if(!SEL) return; SEL = null; if(!quiet) selDraw(); else { const b = $('#msel'); if(b) b.remove() } }
function selDraw(){ document.querySelectorAll('#body .grid > .bk').forEach(el => { const id = el.dataset.book ? 'it:' + el.dataset.book : el.dataset.grp ? 'gr:' + el.dataset.grp : null; el.classList.toggle('sel', !!(SEL && id && SEL.has(id))) });
  let bar = $('#msel'); if(!SEL){ if(bar) bar.remove(); return }
  if(!bar){ bar = document.createElement('div'); bar.id = 'msel'; document.body.appendChild(bar) }
  const inGroup = cur().v === 'group', n = SEL.size;
  bar.innerHTML = `<b style="flex:1">${n ? plural(n, 'tile') + ' selected' : 'Tap tiles to select them'}</b><button class="btn sm primary" id="selmove" ${n ? '' : 'disabled'}>Move to…</button><button class="btn sm" id="selmore" ${n ? '' : 'disabled'}>${IC_DOTS}</button>${inGroup ? `<button class="btn sm" id="selout" ${n ? '' : 'disabled'}>Take out</button>` : ''}<button class="btn sm" id="selall">All</button><button class="btn sm" id="selx">Cancel</button>`;
  $('#selall').onclick = () => { document.querySelectorAll('#body .grid > .bk').forEach(el => { const id = el.dataset.book ? 'it:' + el.dataset.book : el.dataset.grp ? 'gr:' + el.dataset.grp : null; if(id) SEL.add(id) }); selDraw() };
  $('#selx').onclick = () => selEnd(); $('#selmove').onclick = selMoveSheet; $('#selmore').onclick = selMore; if($('#selout')) $('#selout').onclick = selTakeOut }
function selParts(){ const sh = cur().shelf, gs = groupsOf(sh).groups, its = [...SEL].filter(x => x.startsWith('it:')).map(x => x.slice(3)), grs = [...SEL].filter(x => x.startsWith('gr:')).map(x => x.slice(3));
  const books = [...new Set(its.concat(...grs.map(k => (gs.find(g => g.key === k) || {all:[]}).all.map(b => b.id))))];
  return {sh, gs, its, grs, books} }
function selMoveSheet(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), bad = new Set(grs.flatMap(k => { const g = gs.find(x => x.key === k); return g ? G.inside(g, gs).concat(k) : [k] }));
  const opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Move ${plural(SEL.size, 'tile')} to…</h3><div style="display:flex;gap:8px"><input type="text" id="smn" placeholder="New group name" maxlength="60"><button class="btn primary" id="smmake">Make</button></div>
    <button class="btn" id="smtop" style="width:100%;margin-top:10px">The main page (own tiles)</button>
    <div style="margin-top:8px">${opts.map(x => `<div class="li" data-sm="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'book')}</div></div></div>`).join('')}</div>`);
  lazyCovers($('.sheet'));
  const move = t => { if(t){ G.put(its, t); for(const k of grs) G.setParent(k, t.key) } else { G.put(its, 'none'); for(const k of grs) toTop(G, k) } };
  const doit = (t, label, first) => { const n = SEL.size; grChange(sh, () => { if(first) first(); move(t) }, `${plural(n, 'tile')} moved to ${label}`); closeSheet(); selEnd(true); draw() };
  $('#smmake').onclick = () => { const n = $('#smn').value.trim(); if(!n) return; const v = cur(); doit({key:'c:' + norm(n), name:n, kind:'own'}, `“${n}”`, () => { const g = G.own(n); if(v.v === 'group' && !bad.has(v.key)) G.setParent(g.key, v.key) }) };
  $('#smtop').onclick = () => doit(null, 'the main page');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-sm]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.sm); if(t) doit(t, `“${t.name}”`) }) }
function selTakeOut(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), here = gs.find(x => x.key === cur().key), up = here && here.parent ? gs.find(x => x.key === here.parent) : null, n = SEL.size;
  grChange(sh, () => { G.put(its, up || 'none'); for(const k of grs) up ? G.setParent(k, up.key) : toTop(G, k) }, `${plural(n, 'tile')} taken out${up ? ' to “' + up.name + '”' : ' to the main page'}`); selEnd(true); draw() }
function selMore(){ const {sh, books} = selParts(), G = grOf(sh), ids = [...SEL], allPinned = ids.every(x => G.isPinned(x));
  sheet(`<h3>${plural(ids.length, 'tile')} · ${plural(books.length, 'book')}</h3><div class="mlist"><button class="btn" id="smpin">${allPinned ? '★ Unpin' : '★ Pin to the top'}</button><button class="btn" id="smread">Mark as read</button><button class="btn" id="smunread">Mark as not read</button><button class="btn" id="smpub">Set the publisher…</button><button class="btn" id="smshelf">Move to another shelf…</button><button class="btn danger" id="smdel">Remove from Bookcase</button></div>`);
  $('#smpin').onclick = () => { G.togglePin(ids, !allPinned); closeSheet(); selEnd(true); draw() };
  const mark = on => { for(const id of books){ const x = st(id); x.finished = on; if(on){ x.last = x.last || Date.now(); x.page = Math.max(0, (x.pages || BK[id].pages || 1) - 1) } else x.page = 0; saveState(id, true) } closeSheet(); selEnd(true); draw() };
  $('#smread').onclick = () => mark(true); $('#smunread').onclick = () => mark(false);
  $('#smpub').onclick = () => setPublisher(books);
  $('#smshelf').onclick = () => shelfPicker(books); $('#smdel').onclick = () => removeBooks(books) }
/* "Set the publisher…": type one, or tap one you already have */
function setPublisher(ids){ const known = [...new Set(BOOKS.map(publisherOf).filter(Boolean).concat(Object.keys(KNOWN_PUB)))].sort(coll.compare);
  sheet(`<h3>Publisher for ${plural(ids.length, 'book')}</h3><div style="display:flex;gap:8px"><input type="text" id="spn" placeholder="Publisher, like Marvel" maxlength="60"><button class="btn primary" id="spok">Set</button></div>
    <div class="chips" style="margin-top:10px">${known.map(p => `<button class="chip" data-pub="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <button class="btn" id="spclear" style="width:100%;margin-top:6px">Clear (find it by itself again)</button>`);
  const go = async p => { for(const id of ids){ const b = BK[id]; if(!b) continue; b.publisher = p; await dbPut('books', b) } regroup(); closeSheet(); selEnd(true); draw(); toast(p ? `${plural(ids.length, 'book')} set to ${p}` : 'Publisher cleared') };
  $('#spok').onclick = () => { const p = $('#spn').value.trim(); if(p) go(p) }; $('#spn').onkeydown = e => { if(e.key === 'Enter' && e.target.value.trim()) go(e.target.value.trim()) };
  $('#spclear').onclick = () => go('');
  $('.sheet').addEventListener('click', e => { const c = e.target.closest('[data-pub]'); if(c) go(c.dataset.pub) }) }

/* =====================================================================================================================
   THE READER – one reader for every shelf. Pages (CBZ, CBR, PDF, picture folders, picture EPUBs) here; text EPUBs below.
   ===================================================================================================================== */
let R = null;
const rp = () => $('#rpages');
const twoOn = () => S.two === 'on' || (S.two === 'auto' && innerWidth > innerHeight && innerWidth >= 700);
const isRtl = b => b.rtl != null ? b.rtl : !!shelfOf(b.shelf).rtl;
const renderW = () => Math.min(2600, Math.round(Math.max(innerWidth, innerHeight) * Math.min(2, devicePixelRatio || 1) * (twoOn() ? .7 : 1.1)));
function rClasses(){ const r = $('#reader'); r.classList.toggle('rtl', !!(R && R.rtl)); r.classList.toggle('night', !!S.night); r.classList.toggle('invert', !!S.invert); r.style.setProperty('--rbg', S.bg) }
let hintT = 0; function rHint(t, ms){ const h = $('#rhint'); h.innerHTML = t; h.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => h.classList.remove('on'), ms || 1600) }
function rUI(on){ R.ui = on == null ? !R.ui : on; $('#reader').classList.toggle('noui', !R.ui) }

async function openReader(b, mark){ if(!b) return;
  if(R) await closeReader(true);
  R = {b, n:0, s:0, shown:[], cache:new Map(), zoom:1, x:0, y:0, ui:true, tok:0, rtl:isRtl(b), hi:null};
  $('#reader').hidden = false; document.body.classList.add('reading'); $('#rend').hidden = true; rp().innerHTML = ''; rClasses(); rUI(true);
  $('#rtitle').textContent = dispTitle(b); $('#rsub').textContent = 'Opening…'; $('#rspin').hidden = false; awake(true);
  let doc; try{ doc = await openDoc(b) }catch(e){ LE('reader', 'could not open ' + b.name, e); $('#rspin').hidden = true; toast(e.message || String(e), 5000); closeReader(); return }
  if(doc.flow){ $('#reader').hidden = true; const keep = R; R = null; return openEpub(b, doc.ep, mark) }
  R.doc = doc; R.n = doc.n;
  if(b.pages !== doc.n || b.later){ b.pages = doc.n; if(b.later){ b.later = false; doc.page(0, 400).then(thumb).then(t => setCover(b.id, t)).catch(() => {}) } dbPut('books', b).catch(() => {}) }
  const s = st(b.id); let start = mark && mark.p != null ? mark.p : s.finished ? 0 : Math.min(s.page || 0, doc.n - 1);
  if(s.finished && !mark){ s.finished = false; saveState(b.id) }
  const sl = $('#rslider'); sl.max = R.n; sl.style.direction = R.rtl ? 'rtl' : 'ltr';
  $('#rprevb').disabled = !nextInSeries(b, -1); $('#rnextb').disabled = !nextInSeries(b, 1); $('#rprevb').style.opacity = $('#rprevb').disabled ? .3 : 1; $('#rnextb').style.opacity = $('#rnextb').disabled ? .3 : 1;
  await showAt(start);
  if(!lsGet('nvBooks.hinted', false)){ lsSet('nvBooks.hinted', true); rHint(`Tap the ${R.rtl ? 'left' : 'right'} edge for the next page<br>tap the middle for the menu · pinch or double-tap to zoom`, 4200) }
  setTimeout(() => { if(R && R.ui && sheetOpen() === false) rUI(false) }, 2200) }
async function closeReader(quiet){ if(!R) return; const r = R; R = null; if(r.b) saveState(r.b.id, true);
  for(const p of r.cache.values()) p.then(m => URL.revokeObjectURL(m.url)).catch(() => {}); if(r.hi) URL.revokeObjectURL(r.hi);
  try{ r.doc && r.doc.close && r.doc.close() }catch(e){}
  $('#reader').hidden = true; rp().innerHTML = ''; document.body.classList.remove('reading'); awake(false); if(!quiet) draw() }

function errPage(msg){ const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#1a1f28"/><text x="300" y="430" fill="#ef8a8f" font-family="sans-serif" font-size="28" text-anchor="middle">This page could not be shown</text><text x="300" y="480" fill="#9aa7b5" font-family="sans-serif" font-size="20" text-anchor="middle">${esc(String(msg).slice(0, 50))}</text></svg>`;
  return new Blob([svg], {type:'image/svg+xml'}) }
function getImg(p){ if(R.cache.has(p)) return R.cache.get(p); const doc = R.doc;
  const pr = (async () => { let bl; try{ bl = await doc.page(p, renderW()) }catch(e){ LE('reader', 'page ' + (p + 1), e); bl = errPage(e.message || e) }
    let url = URL.createObjectURL(bl), im = new Image(); im.decoding = 'async'; im.alt = ''; im.src = url;
    try{ await im.decode() }catch(e){ await new Promise(ok => { if(im.complete) ok(); im.onload = im.onerror = ok }) }
    if(!im.naturalWidth){ LE('reader', `page ${p + 1} could not be decoded (${bl.type})`); URL.revokeObjectURL(url); url = URL.createObjectURL(errPage(bl.type === 'image/avif' ? 'AVIF is not supported on this device' : 'Unknown picture')); im = new Image(); im.src = url; await im.decode().catch(() => {}) }
    return {url, w:im.naturalWidth || 600, h:im.naturalHeight || 900, img:im} })();
  R.cache.set(p, pr); return pr }
function trimCache(){ if(!R) return; for(const [p, pr] of R.cache) if(p < R.s - 3 || p > R.s + 7){ R.cache.delete(p); pr.then(m => URL.revokeObjectURL(m.url)).catch(() => {}) } }
async function preload(){ const me = R, tok = R.tok, a = R.s + R.shown.length; for(const p of [a, a + 1, a + 2, a + 3, R.s - 1, R.s - 2]){ if(R !== me || tok !== R.tok) return; if(p >= 0 && p < R.n) await getImg(p).catch(() => {}) } }

async function showAt(i){ if(!R) return; const tok = ++R.tok; i = Math.max(0, Math.min(R.n - 1, i)); $('#rend').hidden = true;
  let pages = !twoOn() || i === 0 || i >= R.n - 1 ? [i] : [i, i + 1];
  const spin = setTimeout(() => { if(R && tok === R.tok) $('#rspin').hidden = false }, 120);
  let imgs = await Promise.all(pages.map(getImg)); clearTimeout(spin); if(!R || tok !== R.tok) return; $('#rspin').hidden = true;
  if(pages.length === 2 && (imgs[0].w > imgs[0].h * 1.05 || imgs[1].w > imgs[1].h * 1.05)){ pages = [i]; imgs = [imgs[0]] }   // a wide (double) page shows on its own
  if(R.hi){ URL.revokeObjectURL(R.hi); R.hi = null }
  R.s = i; R.shown = pages; R.dims = imgs.map(m => ({w:m.w, h:m.h})); R.zoom = 1;
  const box = rp(); box.innerHTML = ''; for(const m of imgs) box.appendChild(m.img);
  layout(true); pageInfo();
  const s = st(R.b.id); s.page = i; s.pages = R.n; s.last = Date.now(); s.flow = false; if(i + pages.length >= R.n) s.finished = true; saveState(R.b.id);
  trimCache(); preload() }
function layout(reset){ if(!R || !R.dims) return; const vw = innerWidth, vh = innerHeight, H = 1000, ws = R.dims.map(d => d.w * H / d.h), TW = ws.reduce((a, b) => a + b, 0);
  R.base = S.fit === 'width' ? vw / TW : S.fit === 'height' ? vh / H : Math.min(vw / TW, vh / H);
  const sc = R.base * R.zoom; R.DW = TW * sc; R.DH = H * sc; R.ws = ws;
  const box = rp(); box.style.width = R.DW + 'px'; box.style.height = R.DH + 'px'; [...box.children].forEach((im, k) => { im.style.width = (ws[k] * sc) + 'px' });
  if(reset){ R.x = R.DW > vw ? (R.rtl ? vw - R.DW : 0) : (vw - R.DW) / 2; R.y = R.DH > vh ? 0 : (vh - R.DH) / 2 }
  clampPos(); applyPos() }
function clampPos(){ const vw = innerWidth, vh = innerHeight; R.x = R.DW <= vw ? (vw - R.DW) / 2 : Math.min(0, Math.max(vw - R.DW, R.x)); R.y = R.DH <= vh ? (vh - R.DH) / 2 : Math.min(0, Math.max(vh - R.DH, R.y)) }
function applyPos(dx){ rp().style.transform = `translate3d(${R.x + (dx || 0)}px,${R.y}px,0)` }
function setZoom(z, cx, cy){ const old = R.base * R.zoom, px = (cx - R.x) / old, py = (cy - R.y) / old; R.zoom = Math.max(1, Math.min(6, z));
  const sc = R.base * R.zoom; R.DW = R.ws.reduce((a, b) => a + b, 0) * sc; R.DH = 1000 * sc; const box = rp(); box.style.width = R.DW + 'px'; box.style.height = R.DH + 'px';
  [...box.children].forEach((im, k) => { im.style.width = (R.ws[k] * sc) + 'px' }); R.x = cx - px * sc; R.y = cy - py * sc; clampPos(); applyPos() }
/* zoomed in on a PDF page: draw it again sharper */
let hiT = 0; function hiRes(){ clearTimeout(hiT); if(!R || !R.doc.pdf || R.shown.length !== 1 || R.zoom < 1.6) return; const me = R, tok = R.tok, p = R.s;
  hiT = setTimeout(async () => { const w = Math.min(4200, Math.round(R.DW * Math.min(2, devicePixelRatio || 1))); try{ const bl = await R.doc.page(p, w); if(R !== me || tok !== R.tok || R.s !== p) return;
    const u = URL.createObjectURL(bl), im = rp().children[0]; if(!im) return; const n = new Image(); n.src = u; await n.decode().catch(() => {}); if(R !== me || tok !== R.tok) return URL.revokeObjectURL(u);
    im.src = u; if(R.hi) URL.revokeObjectURL(R.hi); R.hi = u }catch(e){} }, 350) }
function pageInfo(){ if(!R) return; const a = R.s + 1, z = R.s + R.shown.length, s = st(R.b.id);
  $('#rpageno').textContent = (z > a ? `${a}–${z}` : a) + ' / ' + R.n; $('#rslider').value = a;
  $('#rsub').textContent = [R.b.vol && R.b.series ? R.b.title : '', `Page ${z > a ? a + '–' + z : a} of ${R.n}`].filter(Boolean).join(' · ');
  const marked = (s.marks || []).some(m => m.p != null && m.p >= R.s && m.p < R.s + R.shown.length); $('#rmark').innerHTML = IC_MARK(marked) }
function next(){ if(!R) return; if(R.s + R.shown.length >= R.n) return showEnd(); showAt(R.s + R.shown.length) }
function prev(){ if(!R) return; if(R.s === 0){ rHint('This is the first page'); return } if(!twoOn()) return showAt(R.s - 1); let p = R.s - 2; if(p < 1) p = R.s - 1; showAt(Math.max(0, p)) }
const goFwd = () => next(), goBack = () => prev();
function showEnd(){ const b = R.b, nx = nextInSeries(b, 1), s = st(b.id); s.finished = true; s.last = Date.now(); saveState(b.id, true);
  const e = $('#rend'); e.hidden = false;
  e.innerHTML = `<div><div style="font-size:13px;color:var(--accent);font-weight:700;letter-spacing:.6px">FINISHED</div><h2 style="margin:6px 0 4px;font-size:20px">${esc(dispTitle(b))}</h2>
    ${nx ? `<p class="muted small" style="margin:14px 0 0">Next in the series</p>${coverHTML(nx)}<b style="display:block">${esc(dispTitle(nx))}</b><button class="btn primary" id="rendnext" style="width:100%;margin-top:14px">Read ${esc(nx.vol || 'the next one')}</button>` : '<p class="muted small">That was the last one here.</p>'}
    <button class="btn" id="rendshelf" style="width:100%;margin-top:8px">Back to the shelf</button><button class="btn" id="rendstay" style="width:100%;margin-top:8px">Stay on this page</button></div>`;
  lazyCovers(e);
  if($('#rendnext')) $('#rendnext').onclick = () => openReader(nx);
  $('#rendshelf').onclick = () => closeReader(); $('#rendstay').onclick = () => { e.hidden = true } }

/* gestures: tap the edges to turn, the middle for the menu; swipe; pinch or double-tap to zoom; drag to move a zoomed page */
(() => { const stage = $('#rstage'), ptrs = new Map(); let G0 = null, lastTap = 0, tapT = 0, lastTapXY = [0, 0];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  stage.addEventListener('pointerdown', e => { if(!R || !R.dims) return; try{ stage.setPointerCapture(e.pointerId) }catch(x){} ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(ptrs.size === 1) G0 = {mode:'one', sx:e.clientX, sy:e.clientY, x0:R.x, y0:R.y, t:Date.now(), moved:false};
    else if(ptrs.size === 2){ const [a, b] = [...ptrs.values()]; G0 = {mode:'pinch', d0:dist(a, b) || 1, z0:R.zoom, cx:(a.x + b.x) / 2, cy:(a.y + b.y) / 2, x0:R.x, y0:R.y, base:R.base}; clearTimeout(tapT); lastTap = 0 } });
  stage.addEventListener('pointermove', e => { if(!R || !G0 || !ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(G0.mode === 'pinch' && ptrs.size >= 2){ const [a, b] = [...ptrs.values()], c = {x:(a.x + b.x) / 2, y:(a.y + b.y) / 2}, z = Math.max(1, Math.min(6, G0.z0 * dist(a, b) / G0.d0));
      const sc0 = G0.base * G0.z0, px = (G0.cx - G0.x0) / sc0, py = (G0.cy - G0.y0) / sc0; R.zoom = z; const sc = R.base * z;
      R.DW = R.ws.reduce((p, q) => p + q, 0) * sc; R.DH = 1000 * sc; const box = rp(); box.style.width = R.DW + 'px'; box.style.height = R.DH + 'px'; [...box.children].forEach((im, k) => { im.style.width = (R.ws[k] * sc) + 'px' });
      R.x = c.x - px * sc; R.y = c.y - py * sc; clampPos(); applyPos(); return }
    if(G0.mode !== 'one') return; const dx = e.clientX - G0.sx, dy = e.clientY - G0.sy; if(Math.abs(dx) > 8 || Math.abs(dy) > 8) G0.moved = true; if(!G0.moved) return;
    const vw = innerWidth, vh = innerHeight, panH = R.DW > vw + 1, panV = R.DH > vh + 1;
    if(panH || panV){ R.x = G0.x0 + dx; R.y = G0.y0 + dy; clampPos(); applyPos(panH ? 0 : dx * .35) } else applyPos(dx * .35) });
  const up = e => { if(!R || !G0 || !ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if(G0.mode === 'pinch'){ if(ptrs.size === 1){ const [p] = [...ptrs.values()]; G0 = {mode:'one', sx:p.x, sy:p.y, x0:R.x, y0:R.y, t:Date.now(), moved:true} } else G0 = null; hiRes(); return }
    if(ptrs.size) return; const g = G0; G0 = null; const dx = e.clientX - g.sx, dy = e.clientY - g.sy, vw = innerWidth;
    if(!g.moved && Date.now() - g.t < 400) return tap(e.clientX, e.clientY);
    const raw = g.x0 + dx, panH = R.DW > vw + 1, overL = panH ? raw : 999, overR = panH ? (vw - R.DW) - raw : 999;
    if(Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3 && (!panH || overL > 70 || overR > 70)){ if(dx < 0) R.rtl ? prev() : next(); else R.rtl ? next() : prev(); return }
    clampPos(); applyPos() };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  function tap(x, y){ const now = Date.now();
    if(now - lastTap < 300 && Math.hypot(x - lastTapXY[0], y - lastTapXY[1]) < 40){ clearTimeout(tapT); lastTap = 0; if(R.zoom > 1.05){ R.zoom = 1; layout(true) } else { setZoom(2.5, x, y); hiRes() } return }
    lastTap = now; lastTapXY = [x, y]; clearTimeout(tapT);
    tapT = setTimeout(() => { if(!R || !$('#rend').hidden) return; const vw = innerWidth;
      if(S.edges && x < vw * .28){ R.rtl ? next() : prev(); return } if(S.edges && x > vw * .72){ R.rtl ? prev() : next(); return } rUI() }, 260) }
  let wheelT = 0;
  stage.addEventListener('wheel', e => { if(!R || !R.dims) return; e.preventDefault();
    if(e.ctrlKey){ setZoom(R.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY); hiRes(); return }
    const vh = innerHeight, vw = innerWidth;
    if(R.DH > vh + 1 || R.DW > vw + 1){ const y0 = R.y; R.y -= e.deltaY; R.x -= e.deltaX; clampPos(); applyPos(); if(R.y !== y0 || Date.now() - wheelT < 600) return }
    if(Date.now() - wheelT < 350) return; wheelT = Date.now(); e.deltaY > 0 ? next() : prev() }, {passive:false});
  addEventListener('resize', () => { if(!R || !R.dims) return; clearTimeout(R._rz); R._rz = setTimeout(() => { if(!R) return; const two = R.shown.length === 2; if(two !== twoOn() && R.n > 1) showAt(R.s); else layout(true) }, 120) });
  document.addEventListener('keydown', e => { if(!R || $('#reader').hidden || sheetOpen() || /input|textarea|select/i.test((e.target.tagName || ''))) return; const k = e.key, vh = innerHeight;
    if(k === 'ArrowRight'){ R.rtl ? prev() : next() } else if(k === 'ArrowLeft'){ R.rtl ? next() : prev() }
    else if(k === 'PageDown' || k === ' ' || k === 'ArrowDown'){ if(R.DH > vh + 1 && R.y > vh - R.DH + 1){ R.y -= vh * .8; clampPos(); applyPos() } else next() }
    else if(k === 'PageUp' || k === 'ArrowUp'){ if(R.DH > vh + 1 && R.y < -1){ R.y += vh * .8; clampPos(); applyPos() } else prev() }
    else if(k === 'Home') showAt(0); else if(k === 'End') showAt(R.n - 1); else if(k === 'Escape') closeReader();
    else if(k === '+' || k === '='){ setZoom(R.zoom * 1.25, innerWidth / 2, vh / 2); hiRes() } else if(k === '-'){ setZoom(R.zoom / 1.25, innerWidth / 2, vh / 2) } else return;
    e.preventDefault() }) })();
$('#rclose').onclick = () => closeReader();
$('#rslider').oninput = e => { if(R) $('#rpageno').textContent = e.target.value + ' / ' + R.n };
$('#rslider').onchange = e => { if(R) showAt(+e.target.value - 1) };
$('#rprevb').onclick = () => { if(R){ const p = nextInSeries(R.b, -1); if(p) openReader(p) } };
$('#rnextb').onclick = () => { if(R){ const n = nextInSeries(R.b, 1); if(n) openReader(n) } };
$('#rmark').onclick = async () => { if(!R) return; const s = st(R.b.id); s.marks = s.marks || [];
  const i = s.marks.findIndex(m => m.p != null && m.p >= R.s && m.p < R.s + R.shown.length);
  if(i >= 0){ const m = s.marks.splice(i, 1)[0]; saveState(R.b.id, true); pageInfo(); toast(`Bookmark “${m.name}” removed`); return }
  const n = await ask('Bookmark this page', 'Name', 'Page ' + (R.s + 1), 'Save'); if(n == null || !R) return;
  s.marks.push({p:R.s, name:n || 'Page ' + (R.s + 1), at:Date.now()}); s.marks.sort((a, b) => (a.p || 0) - (b.p || 0)); saveState(R.b.id, true); pageInfo(); toast('Bookmark saved') };
$('#rtoc').onclick = () => tocSheet('contents');
$('#rset').onclick = () => readSettings();

/* contents · bookmarks · search */
function tocSheet(tab){ if(!R) return; const s = st(R.b.id), toc = R.doc.toc || [], canSearch = !!R.doc.text;
  const tabs = [['contents', 'Contents'], ['marks', 'Bookmarks'], ...(canSearch ? [['search', 'Search']] : [])];
  let h = `<div class="chips">${tabs.map(([k, t]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>`;
  if(tab === 'contents') h += toc.length ? toc.map(t => `<div class="li ${t.p != null && t.p <= R.s && !toc.some(u => u.p != null && u.p > t.p && u.p <= R.s) ? 'cur' : ''}" data-go="${t.p == null ? '' : t.p}" style="padding-left:${8 + t.d * 16}px"><div class="n"><div>${esc(t.title || '—')}</div></div><span class="r">${t.p == null ? '' : t.p + 1}</span></div>`).join('') : `<p class="muted small">This book has no table of contents. Use the slider at the bottom, or bookmarks.</p>`;
  if(tab === 'marks') h += (s.marks || []).filter(m => m.p != null).length ? s.marks.filter(m => m.p != null).map((m, i) => `<div class="li" data-go="${m.p}"><span class="r" style="color:var(--accent)">★</span><div class="n"><div>${esc(m.name)}</div><div class="s">Page ${m.p + 1}</div></div><button class="btn sm" data-ren="${s.marks.indexOf(m)}">Rename</button><button class="btn sm danger" data-del="${s.marks.indexOf(m)}">✕</button></div>`).join('') : '<p class="muted small">No bookmarks yet. Tap the bookmark button at the top to keep a page.</p>';
  if(tab === 'search') h += `<div style="display:flex;gap:8px"><input type="search" id="sq" placeholder="Word or words to find" value="${esc(R.lastQ || '')}"><button class="btn primary" id="sgo">Find</button></div><div class="muted small" id="sst" style="margin:8px 0"></div><div id="sres"></div>`;
  sheet(h);
  $('.sheet').onclick = async e => { const t = e.target.closest('[data-tab],[data-go],[data-ren],[data-del]'); if(!t) return;
    if(t.dataset.tab) return tocSheet(t.dataset.tab);
    if(t.dataset.ren){ const m = s.marks[+t.dataset.ren], n = await ask('Rename the bookmark', 'Name', m.name, 'Save'); if(n){ m.name = n; saveState(R.b.id, true) } return tocSheet('marks') }
    if(t.dataset.del){ s.marks.splice(+t.dataset.del, 1); saveState(R.b.id, true); pageInfo(); return tocSheet('marks') }
    if(t.dataset.go !== ''){ closeSheet(); showAt(+t.dataset.go) } };
  if(tab === 'search'){ const goS = () => searchPdf($('#sq').value.trim()); $('#sgo').onclick = goS; $('#sq').onkeydown = e => { if(e.key === 'Enter') goS() }; setTimeout(() => $('#sq').focus(), 50); if(R.lastRes) showRes(R.lastRes, R.lastQ) } }
async function searchPdf(q){ if(!R || !q) return; R.lastQ = q; R.texts = R.texts || {}; const nq = q.toLowerCase(), res = [], me = R, tok = Symbol(); R.searchTok = tok;
  for(let i = 0; i < R.n; i++){ if(R !== me || R.searchTok !== tok || !$('#sst')) return;
    if(R.texts[i] == null) try{ R.texts[i] = await R.doc.text(i) }catch(e){ R.texts[i] = '' }
    const t = R.texts[i], tl = t.toLowerCase(); let k = tl.indexOf(nq); while(k >= 0 && res.length < 300){ res.push({p:i, snip:t.slice(Math.max(0, k - 50), k + nq.length + 60).replace(/\s+/g, ' ')}); k = tl.indexOf(nq, k + nq.length) }
    if(i % 10 === 0 || i === R.n - 1){ $('#sst').textContent = `Looking… page ${i + 1} of ${R.n} · ${plural(res.length, 'hit')}`; showRes(res, q) } }
  R.lastRes = res; const empty = Object.values(R.texts).every(t => !t.trim());
  $('#sst').textContent = res.length ? `${plural(res.length, 'hit')}${res.length >= 300 ? ' (the first 300)' : ''}` : empty ? 'This PDF has no text inside (it is made of scanned pictures), so it can\'t be searched yet.' : 'Not found.'; showRes(res, q) }
function showRes(res, q){ const el = $('#sres'); if(!el) return; const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  el.innerHTML = res.slice(0, 300).map(r => `<div class="li" data-go="${r.p}"><span class="r" style="width:44px">p. ${r.p + 1}</span><div class="n" style="white-space:normal;font-size:13px">…${esc(r.snip).replace(rx, m => `<b style="color:var(--accent)">${m}</b>`)}…</div></div>`).join('') }

/* reading settings */
function readSettings(){ if(!R) return; const b = R.b;
  const chips = (k, opts) => `<div class="chips">${opts.map(([v, t]) => `<button class="chip ${S[k] === v ? 'on' : ''}" data-set="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
  sheet(`<h3>Reading</h3>
    <div class="sec" style="margin-top:4px">Fit the page</div>${chips('fit', [['page', 'Whole page'], ['width', 'Width'], ['height', 'Height']])}
    <div class="sec">Direction (this book)</div><div class="chips"><button class="chip ${!R.rtl ? 'on' : ''}" data-dir="ltr">Left to right</button><button class="chip ${R.rtl ? 'on' : ''}" data-dir="rtl">Right to left (manga)</button></div>
    <div class="sec">Two pages side by side</div>${chips('two', [['auto', 'When the screen is wide'], ['on', 'Always'], ['off', 'Never']])}
    <div class="sec">Background</div>${chips('bg', [['#000', 'Black'], ['#2a2f37', 'Grey'], ['#f4f1ea', 'White']])}
    <div class="opt"><label for="o_night">Night mode (softer, warmer pages)</label><input type="checkbox" id="o_night" ${S.night ? 'checked' : ''}></div>
    <div class="opt"><label for="o_inv">Dark pages (white pages turn dark – for text PDFs)</label><input type="checkbox" id="o_inv" ${S.invert ? 'checked' : ''}></div>
    <div class="opt"><label for="o_edge">Tap the edges to turn pages</label><input type="checkbox" id="o_edge" ${S.edges ? 'checked' : ''}></div>
    <div class="mlist" style="margin-top:12px"><button class="btn" id="o_print">Print…</button></div>`);
  $('.sheet').onclick = async e => { const c = e.target.closest('[data-set],[data-dir]'); if(!c) return;
    if(c.dataset.dir){ R.rtl = c.dataset.dir === 'rtl'; b.rtl = R.rtl === !!shelfOf(b.shelf).rtl ? null : R.rtl; await dbPut('books', b); rClasses(); $('#rslider').style.direction = R.rtl ? 'rtl' : 'ltr'; layout(true) }
    else { S[c.dataset.set] = c.dataset.v; saveS(); rClasses(); if(c.dataset.set === 'two') showAt(R.s); else layout(true) }
    readSettings() };
  $('#o_night').onchange = e => { S.night = e.target.checked; saveS(); rClasses() };
  $('#o_inv').onchange = e => { S.invert = e.target.checked; saveS(); rClasses() };
  $('#o_edge').onchange = e => { S.edges = e.target.checked; saveS() };
  $('#o_print').onclick = () => { closeSheet(); printSheet(b) } }

/* =====================================================================================================================
   THE READER FOR TEXT BOOKS (EPUB): one chapter at a time, scrolled; tap the edges to go a screen on, the middle for the menu
   ===================================================================================================================== */
let E = null;
const ETHEME = {dark:['#11141a', '#d9dee5', '#8fb6ff'], sepia:['#f3ead8', '#3b3226', '#7a4b12'], light:['#ffffff', '#1d2125', '#1a56c4']};
function eClasses(){ const t = ETHEME[S.etheme] || ETHEME.dark; $('#ereader').style.setProperty('--ebg', t[0]) }
function eUI(on){ E.ui = on == null ? !E.ui : on; $('#ereader').classList.toggle('noui', !E.ui) }
async function openEpub(b, ep, mark){
  E = {b, ep, n:ep.spine.length, ch:0, res:{}, ui:true};
  $('#ereader').hidden = false; document.body.classList.add('reading'); eClasses(); eUI(true); awake(true);
  $('#etitle').textContent = dispTitle(b);
  const s = st(b.id); let ch = 0, f = 0;
  if(mark && mark.flow){ ch = mark.ch; f = mark.pos } else if(!s.finished && s.flow){ ch = s.ch || 0; f = s.chf || 0 }
  if(s.finished && !mark){ s.finished = false }
  await eLoad(ch, f) }
async function eRes(href){ if(E.res[href]) return E.res[href]; const u8 = await E.ep.z.file(href); const type = /\.css$/i.test(href) ? 'text/css' : /\.(otf|ttf|woff2?)$/i.test(href) ? 'font/' + ext(href) : /\.svg$/i.test(href) ? 'image/svg+xml' : (sniff(u8) || MIME[ext(href)] || 'application/octet-stream');
  return E.res[href] = URL.createObjectURL(new Blob([u8], {type})) }
async function eCss(href){ let css = ''; try{ css = td8.decode(await E.ep.z.file(href)) }catch(e){ return '' }
  const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]).filter(u => !/^(data:|https?:)/i.test(u));
  for(const u of new Set(urls)){ try{ const r = await eRes(resolve(href, u)); css = css.split(u).join(r) }catch(e){} } return css }
async function eLoad(ch, frac, anchor){ if(!E) return; ch = Math.max(0, Math.min(E.n - 1, ch)); E.ch = ch; const it = E.ep.spine[ch], tok = E.tok = Symbol();
  let text = ''; try{ text = await E.ep.z.text(it.href) }catch(e){ toast('This chapter could not be read', 4000) }
  let d = new DOMParser().parseFromString(text, 'application/xhtml+xml'); if(d.querySelector('parsererror')) d = new DOMParser().parseFromString(text, 'text/html');
  const body = d.body || d.querySelector('body') || d.documentElement; let css = '';
  for(const l of [...d.querySelectorAll('link[rel~="stylesheet"][href]')]) css += await eCss(resolve(it.href, l.getAttribute('href')));
  for(const s of [...d.querySelectorAll('style')]) css += s.textContent;
  for(const el of [...body.querySelectorAll('script')]) el.remove();
  for(const im of [...body.querySelectorAll('img[src]')]){ try{ im.setAttribute('src', await eRes(resolve(it.href, im.getAttribute('src')))) }catch(e){} }
  for(const im of [...body.querySelectorAll('image')]){ const a = im.getAttribute('xlink:href') || im.getAttribute('href'); if(a) try{ const u = await eRes(resolve(it.href, a)); im.setAttribute('href', u); im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', u) }catch(e){} }
  for(const a of [...body.querySelectorAll('a[href]')]){ const h = a.getAttribute('href'); if(!/^[a-z]+:/i.test(h)) a.setAttribute('data-nv', resolve(it.href, h)); a.removeAttribute('href'); a.setAttribute('role', 'link') }
  if(!E || E.tok !== tok) return;
  const t = ETHEME[S.etheme] || ETHEME.dark, face = S.eface === 'sans' ? 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' : 'Georgia,"Iowan Old Style","Palatino Linotype",serif';
  const ours = `html{background:${t[0]}!important}body{background:${t[0]}!important;color:${t[1]}!important;font-family:${face}!important;font-size:${S.efont}%!important;line-height:1.6!important;max-width:40em;margin:0 auto!important;padding:18px 20px 40px!important;overflow-wrap:break-word}
    body *{color:inherit!important;background-color:transparent!important;max-width:100%}img,svg,image{max-width:100%!important;height:auto!important}a[role=link]{color:${t[2]}!important;text-decoration:underline;cursor:pointer}
    .nvnext{display:block;margin:36px auto 10px;padding:12px 18px;border-radius:12px;border:1px solid ${t[2]}66;color:${t[2]}!important;font:600 15px system-ui,sans-serif;text-align:center;cursor:pointer;max-width:320px}`;
  const next = ch < E.n - 1 ? `<div class="nvnext" data-nvnext="1">Next chapter →</div>` : `<div class="nvnext" data-nvend="1">The end – back to the shelf</div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>${ours}</style></head><body>${body.innerHTML}${next}</body></html>`;
  const fr = $('#eframe');
  await new Promise(ok => { fr.onload = ok; fr.srcdoc = html });
  if(!E || E.tok !== tok) return;
  const doc = fr.contentDocument, win = fr.contentWindow;
  await new Promise(ok => setTimeout(ok, 30));
  if(anchor){ const el = doc.getElementById(anchor) || doc.querySelector(`[name="${CSS.escape(anchor)}"]`); if(el) el.scrollIntoView() }
  else if(frac) win.scrollTo(0, frac * (doc.documentElement.scrollHeight - win.innerHeight));
  ePos();
  win.addEventListener('scroll', () => { clearTimeout(E._sc); E._sc = setTimeout(ePos, 200) }, {passive:true});
  doc.addEventListener('click', e => { const a = e.target.closest('[data-nv],[data-nvnext],[data-nvend]');
    if(a && a.dataset.nvnext) return eLoad(E.ch + 1, 0);
    if(a && a.dataset.nvend){ const s = st(E.b.id); s.finished = true; saveState(E.b.id, true); return closeEpub() }
    if(a && a.dataset.nv){ const [p, h] = a.dataset.nv.split('#'), i = E.ep.spine.findIndex(x => x.href === p); if(i >= 0) return i === E.ch && h ? (doc.getElementById(h) || {scrollIntoView(){}}).scrollIntoView() : eLoad(i, 0, h); return }
    const x = e.clientX, w = win.innerWidth, sh = doc.documentElement.scrollHeight - win.innerHeight;
    if(S.edges && x > w * .72){ if(win.scrollY >= sh - 2){ if(E.ch < E.n - 1) eLoad(E.ch + 1, 0) } else win.scrollBy(0, win.innerHeight - 48); return }
    if(S.edges && x < w * .28){ if(win.scrollY <= 2){ if(E.ch > 0) eLoad(E.ch - 1, 1) } else win.scrollBy(0, -(win.innerHeight - 48)); return }
    eUI() });
  doc.addEventListener('keydown', eKey) }
function ePos(){ if(!E) return; const fr = $('#eframe'), doc = fr.contentDocument, win = fr.contentWindow; if(!doc) return;
  const sh = doc.documentElement.scrollHeight - win.innerHeight, f = sh > 0 ? Math.min(1, win.scrollY / sh) : 1, all = (E.ch + f) / E.n;
  const s = st(E.b.id); s.flow = true; s.ch = E.ch; s.chf = f; s.frac = all; s.pages = E.n; s.page = E.ch; s.last = Date.now(); if(E.ch === E.n - 1 && f > .98) s.finished = true; saveState(E.b.id);
  const t = (E.ep.toc.filter(x => x.ch <= E.ch).pop() || {}).title;
  $('#esub').textContent = (t ? t + ' · ' : '') + `Chapter ${E.ch + 1} of ${E.n}`; $('#epos').textContent = Math.round(all * 100) + '%'; $('#eslider').value = Math.round(all * 1000);
  const marked = (s.marks || []).some(m => m.flow && m.ch === E.ch && Math.abs(m.pos - f) < .03); $('#emark').innerHTML = IC_MARK(marked) }
function eKey(e){ if(!E || sheetOpen()) return; const win = $('#eframe').contentWindow; if(!win) return;
  if(e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' '){ e.preventDefault(); win.scrollBy(0, win.innerHeight - 48) }
  else if(e.key === 'ArrowLeft' || e.key === 'PageUp'){ e.preventDefault(); win.scrollBy(0, -(win.innerHeight - 48)) }
  else if(e.key === 'Escape') closeEpub() }
document.addEventListener('keydown', e => { if(E && !$('#ereader').hidden && !/input|textarea|select/i.test(e.target.tagName || '')) eKey(e) });
async function closeEpub(){ if(!E) return; ePos(); saveState(E.b.id, true); for(const u of Object.values(E.res)) URL.revokeObjectURL(u); E = null; $('#eframe').srcdoc = ''; $('#ereader').hidden = true; document.body.classList.remove('reading'); awake(false); draw() }
$('#eclose').onclick = () => closeEpub();
$('#eprev').onclick = () => { if(E && E.ch > 0) eLoad(E.ch - 1, 0) };
$('#enext').onclick = () => { if(E && E.ch < E.n - 1) eLoad(E.ch + 1, 0) };
$('#eslider').onchange = e => { if(!E) return; const v = +e.target.value / 1000 * E.n, ch = Math.min(E.n - 1, Math.floor(v)); eLoad(ch, v - ch) };
$('#emark').onclick = async () => { if(!E) return; const s = st(E.b.id); s.marks = s.marks || []; const f = s.chf || 0;
  const i = s.marks.findIndex(m => m.flow && m.ch === E.ch && Math.abs(m.pos - f) < .03);
  if(i >= 0){ s.marks.splice(i, 1); saveState(E.b.id, true); ePos(); toast('Bookmark removed'); return }
  const t = (E.ep.toc.filter(x => x.ch <= E.ch).pop() || {}).title; const n = await ask('Bookmark this place', 'Name', t || 'Chapter ' + (E.ch + 1), 'Save'); if(n == null || !E) return;
  s.marks.push({flow:true, ch:E.ch, pos:f, name:n, at:Date.now()}); saveState(E.b.id, true); ePos(); toast('Bookmark saved') };
$('#etoc').onclick = () => eToc('contents');
$('#eset').onclick = () => eSettings();
function eToc(tab){ if(!E) return; const s = st(E.b.id), marks = (s.marks || []).filter(m => m.flow);
  let h = `<div class="chips">${[['contents', 'Contents'], ['marks', 'Bookmarks'], ['search', 'Search']].map(([k, t]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>`;
  if(tab === 'contents') h += (E.ep.toc.length ? E.ep.toc : E.ep.spine.map((x, i) => ({title:'Chapter ' + (i + 1), ch:i, d:0}))).map(t => `<div class="li ${t.ch === E.ch ? 'cur' : ''}" data-ch="${t.ch}" data-anc="${esc((t.href || '').split('#')[1] || '')}" style="padding-left:${8 + (t.d || 0) * 16}px"><div class="n"><div>${esc(t.title || '—')}</div></div></div>`).join('');
  if(tab === 'marks') h += marks.length ? marks.map(m => `<div class="li" data-mk="${s.marks.indexOf(m)}"><span class="r" style="color:var(--accent)">★</span><div class="n"><div>${esc(m.name)}</div><div class="s">Chapter ${m.ch + 1}</div></div><button class="btn sm danger" data-del="${s.marks.indexOf(m)}">✕</button></div>`).join('') : '<p class="muted small">No bookmarks yet.</p>';
  if(tab === 'search') h += `<div style="display:flex;gap:8px"><input type="search" id="sq" placeholder="Word or words to find" value="${esc(E.lastQ || '')}"><button class="btn primary" id="sgo">Find</button></div><div class="muted small" id="sst" style="margin:8px 0"></div><div id="sres"></div>`;
  sheet(h);
  $('.sheet').onclick = e => { const t = e.target.closest('[data-tab],[data-ch],[data-mk],[data-del],[data-hit]'); if(!t) return;
    if(t.dataset.tab) return eToc(t.dataset.tab);
    if(t.dataset.del){ s.marks.splice(+t.dataset.del, 1); saveState(E.b.id, true); ePos(); return eToc('marks') }
    if(t.dataset.ch != null && t.dataset.ch !== ''){ closeSheet(); return eLoad(+t.dataset.ch, 0, t.dataset.anc || null) }
    if(t.dataset.mk){ const m = s.marks[+t.dataset.mk]; closeSheet(); return eLoad(m.ch, m.pos) }
    if(t.dataset.hit){ const [ch, k] = t.dataset.hit.split(':').map(Number); closeSheet(); eLoad(ch, 0).then(() => eFind(E.lastQ, k)) } };
  if(tab === 'search'){ const goS = async () => { const q = $('#sq').value.trim(); if(!q) return; E.lastQ = q; E.texts = E.texts || {}; const nq = q.toLowerCase(), res = [];
      for(let i = 0; i < E.n; i++){ if(!$('#sst')) return; if(E.texts[i] == null) try{ const d = new DOMParser().parseFromString(await E.ep.z.text(E.ep.spine[i].href), 'text/html'); E.texts[i] = (d.body ? d.body.textContent : '').replace(/\s+/g, ' ') }catch(e){ E.texts[i] = '' }
        const t = E.texts[i], tl = t.toLowerCase(); let k = tl.indexOf(nq), n = 0; while(k >= 0 && res.length < 300){ res.push({ch:i, n:n++, snip:t.slice(Math.max(0, k - 50), k + nq.length + 60)}); k = tl.indexOf(nq, k + nq.length) }
        $('#sst').textContent = `Looking… chapter ${i + 1} of ${E.n} · ${plural(res.length, 'hit')}` }
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'); $('#sst').textContent = res.length ? plural(res.length, 'hit') : 'Not found.';
      $('#sres').innerHTML = res.map(r => `<div class="li" data-hit="${r.ch}:${r.n}"><span class="r" style="width:54px">ch. ${r.ch + 1}</span><div class="n" style="white-space:normal;font-size:13px">…${esc(r.snip).replace(rx, m => `<b style="color:var(--accent)">${m}</b>`)}…</div></div>`).join('') };
    $('#sgo').onclick = goS; $('#sq').onkeydown = e => { if(e.key === 'Enter') goS() }; setTimeout(() => $('#sq').focus(), 50) } }
function eFind(q, k){ const doc = $('#eframe').contentDocument; if(!doc || !q) return; const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), nq = q.toLowerCase(); let n = 0, node;
  while((node = w.nextNode())){ let i = node.data.toLowerCase().indexOf(nq); while(i >= 0){ if(n++ === k){ const r = doc.createRange(); r.setStart(node, i); r.setEnd(node, i + q.length);
        const m = doc.createElement('mark'); r.surroundContents(m); m.scrollIntoView({block:'center'}); return } i = node.data.toLowerCase().indexOf(nq, i + 1) } } }
function eSettings(){ if(!E) return;
  sheet(`<h3>Reading</h3><div class="sec" style="margin-top:4px">Letter size</div><div style="display:flex;align-items:center;gap:10px"><span style="font-size:13px">A</span><input type="range" id="efs" min="70" max="220" step="5" value="${S.efont}"><span style="font-size:20px">A</span></div>
    <div class="sec">Letters</div><div class="chips"><button class="chip ${S.eface !== 'sans' ? 'on' : ''}" data-face="serif" style="font-family:Georgia,serif">Book</button><button class="chip ${S.eface === 'sans' ? 'on' : ''}" data-face="sans">Plain</button></div>
    <div class="sec">Colours</div><div class="chips">${[['dark', 'Dark'], ['sepia', 'Sepia'], ['light', 'Light']].map(([k, t]) => `<button class="chip ${S.etheme === k ? 'on' : ''}" data-th="${k}">${t}</button>`).join('')}</div>
    <div class="opt"><label for="o_edge2">Tap the edges to go a screen on</label><input type="checkbox" id="o_edge2" ${S.edges ? 'checked' : ''}></div>
    <div class="mlist" style="margin-top:12px"><button class="btn" id="eprint">Print this chapter…</button></div>`);
  const redo = () => { const s = st(E.b.id); eClasses(); eLoad(E.ch, s.chf || 0) };
  $('#efs').onchange = e => { S.efont = +e.target.value; saveS(); redo() };
  $('.sheet').onclick = e => { const c = e.target.closest('[data-face],[data-th]'); if(!c) return; if(c.dataset.face) S.eface = c.dataset.face; if(c.dataset.th) S.etheme = c.dataset.th; saveS(); redo(); eSettings() };
  $('#o_edge2').onchange = e => { S.edges = e.target.checked; saveS() };
  $('#eprint').onclick = () => { closeSheet(); const d = $('#eframe').contentDocument; if(!d) return; const pa = $('#printarea'); pa.innerHTML = `<div style="font:12pt/1.5 Georgia,serif;color:#000">${d.body.innerHTML.replace(/<div class="nvnext"[^]*?<\/div>/g, '')}</div>`; doPrint(dispTitle(E.b)) } }

/* =====================================================================================================================
   PRINT – the whole book, this page or a range of pages (Android: the system print screen, also "Save as PDF")
   ===================================================================================================================== */
async function doPrint(name){ await sleep(200);
  try{ if(NvPrint) await NvPrint.print({name:'Nightvault - ' + (name || 'Bookcase')}); else window.print() }catch(e){ toast(e.message || 'Printing is not available here', 4000) }
  const clear = () => { setTimeout(() => { const pa = $('#printarea'); pa.querySelectorAll('img').forEach(i => URL.revokeObjectURL(i.src)); pa.innerHTML = '' }, NvPrint ? 60000 : 1500) };
  if(NvPrint) clear(); else addEventListener('afterprint', clear, {once:true}) }
function printSheet(b){ const inR = R && R.b === b, here = inR ? R.s + 1 : 1, n = b.pages || (inR ? R.n : 0);
  if(b.fmt === 'epub' && !(inR)) { /* text EPUBs print a chapter from inside the reader */ }
  sheet(`<h3>Print “${esc(dispTitle(b))}”</h3>
    <div class="opt"><label><input type="radio" name="pr" value="all" checked> The whole book${n ? ` (${n} pages)` : ''}</label></div>
    ${inR ? `<div class="opt"><label><input type="radio" name="pr" value="this"> This page (${here}${R.shown.length > 1 ? '–' + (here + 1) : ''})</label></div>` : ''}
    <div class="opt"><label><input type="radio" name="pr" value="range"> Pages</label><input type="number" id="prf" min="1" max="${n || 9999}" value="${here}" style="width:78px"> to <input type="number" id="prt" min="1" max="${n || 9999}" value="${Math.min(n || here, here + 9)}" style="width:78px"></div>
    <p class="muted small">${NvPrint ? 'Android\'s print screen opens: pick a printer, or “Save as PDF”.' : 'Your browser\'s print screen opens.'}</p>
    <div class="prog" id="prp" hidden><i></i></div><div class="muted small" id="prs"></div>
    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="prgo">Print</button></div>`, true);
  $('#prf').onfocus = $('#prt').onfocus = () => { document.querySelector('[name=pr][value=range]').checked = true };
  $('#prgo').onclick = async () => { const how = document.querySelector('[name=pr]:checked').value; $('#prgo').disabled = true;
    let doc = inR ? R.doc : null, own = false;
    try{ if(!doc){ doc = await openDoc(b); own = true } if(doc.flow) throw new Error('Open this book and print a chapter from the reader settings');
      let a = 0, z = doc.n - 1; if(how === 'this'){ a = R.s; z = R.s + R.shown.length - 1 } if(how === 'range'){ a = Math.max(1, +$('#prf').value || 1) - 1; z = Math.min(doc.n, +$('#prt').value || doc.n) - 1 }
      if(z < a) [a, z] = [z, a];
      if(z - a + 1 > 80 && !confirm(`That is ${z - a + 1} pages. Getting them ready can take a while. Go on?`)){ $('#prgo').disabled = false; return }
      const pa = $('#printarea'); pa.innerHTML = ''; $('#prp').hidden = false;
      for(let i = a; i <= z; i++){ if(!$('#prs')) return; const bl = await doc.page(i, 1700); const im = new Image(); im.src = URL.createObjectURL(bl); pa.appendChild(im); await im.decode().catch(() => {});
        $('#prp i').style.width = (100 * (i - a + 1) / (z - a + 1)) + '%'; $('#prs').textContent = `Getting page ${i + 1} ready (${i - a + 1} of ${z - a + 1})` }
      closeSheet(); await doPrint(dispTitle(b)) }
    catch(e){ toast(e.message || String(e), 5000); const g = $('#prgo'); if(g) g.disabled = false }
    finally{ if(own && doc && doc.close) doc.close() } } }

/* =====================================================================================================================
   SHELVES AND SETTINGS
   ===================================================================================================================== */
function newShelf(){ ask('New shelf', 'Name, like Art books or Magazines', '', 'Make the shelf').then(n => { if(!n) return; const own = lsGet('nvBooks.shelves', {}); own._own = own._own || [];
  if(shelves(true).some(s => norm(s.name) === norm(n))){ toast('There is already a shelf with that name'); return }
  const id = 'x' + uid(); own._own.push({id, name:n}); lsSet('nvBooks.shelves', own); draw(); toast(`Shelf “${n}” made`) }) }
function shelfSettings(sh){ const s = shelfOf(sh), G = grOf(sh), folders = lsGet('nvBooks.folders', []).filter(f => f.shelf === sh), n = inShelf(sh).length;
  sheet(`<h3>${esc(s.name)}</h3>
    <div class="opt"><label for="ss_rtl">Read right to left (manga) unless a book says otherwise</label><input type="checkbox" id="ss_rtl" ${s.rtl ? 'checked' : ''}></div>
    <div class="opt"><label for="ss_pub">Bundle series by publisher (Marvel › Spider-Man › …)</label><input type="checkbox" id="ss_pub" ${s.byPub ? 'checked' : ''}></div>
    <div class="opt"><label for="ss_aut">A writer's books without a series make one tile</label><input type="checkbox" id="ss_aut" ${s.authors ? 'checked' : ''}></div>
    ${NvFiles ? `<div class="sec">Folders on this phone</div>${folders.map((f, i) => `<div class="li" style="cursor:default"><div class="n"><div>${esc(f.name)}</div><div class="s">${plural(inShelf(sh).filter(b => b.src.kind === 'link' && b.src.tree === f.tree).length, 'book')}</div></div><button class="btn sm" data-look="${i}">Look again</button><button class="btn sm danger" data-forget="${i}">Stop</button></div>`).join('') || '<p class="muted small">None yet - Add → Use a folder on this phone.</p>'}` : ''}
    <div class="sec">Online (Comic Vine)</div><div class="mlist"><button class="btn primary" id="ss_cv">Look up the comics without a publisher</button><button class="btn" id="ss_cvall">Look up all comics on this shelf</button><button class="btn" id="ss_cvkey">${CV.key() ? 'Change your Comic Vine key' : 'Type your Comic Vine key'}</button><div class="muted small" style="margin:-2px 0 0">Once per series; the results are remembered. Needs the internet only while it looks.</div></div>
    <div class="mlist" style="margin-top:10px"><button class="btn" id="ss_reread">Read the details of all books again</button><div class="muted small" style="margin:-2px 0 0">Fills in what is missing (publisher, writer, year …). What you edited by hand stays.</div></div>
    <div class="sec">Your groups</div><div class="mlist"><button class="btn" id="ss_save">Save my groups</button><button class="btn" id="ss_load">Load from a file</button></div>
    <div class="sec">This shelf</div><div class="mlist"><button class="btn" id="ss_ren">Rename the shelf</button><button class="btn" id="ss_hide">Hide this shelf</button>${s.own ? `<button class="btn danger" id="ss_del">Remove this shelf${n ? ' (its books move to Books)' : ''}</button>` : ''}</div>`);
  $('#ss_rtl').onchange = e => { shelfSet(sh, {rtl:e.target.checked}); toast('Saved') };
  $('#ss_pub').onchange = e => { shelfSet(sh, {byPub:e.target.checked}); regroup(); draw(); toast(e.target.checked ? 'Series are now bundled by publisher' : 'Publisher tiles are off') };
  $('#ss_reread').onclick = () => { closeSheet(); rereadShelf(sh) };
  $('#ss_cv').onclick = () => cvLookup(sh, false); $('#ss_cvall').onclick = () => cvLookup(sh, true); $('#ss_cvkey').onclick = () => cvKeySheet();
  $('#ss_aut').onchange = e => { shelfSet(sh, {authors:e.target.checked}); delete GRS[sh]; regroup(); draw(); toast('Saved') };
  $('.sheet').addEventListener('click', async e => { const lk = e.target.closest('[data-look]'), fg = e.target.closest('[data-forget]');
    if(lk){ closeSheet(); lookAgain(folders[+lk.dataset.look]) }
    if(fg){ const f = folders[+fg.dataset.forget], bs = inShelf(sh).filter(b => b.src.kind === 'link' && b.src.tree === f.tree);
      if(!confirm(`Stop using “${f.name}” for ${s.name}?${bs.length ? `\n\nIts ${plural(bs.length, 'book')} leave Bookcase (the files stay on the phone).` : ''}`)) return;
      await dbDelMany('books', bs.map(b => b.id)); const g = new Set(bs.map(b => b.id)); BOOKS = BOOKS.filter(b => !g.has(b.id)); for(const id of g) delete BK[id]; regroup();
      lsSet('nvBooks.folders', lsGet('nvBooks.folders', []).filter(x => !(x.tree === f.tree && x.shelf === sh)));
      if(NvFiles && NvFiles.forget && !lsGet('nvBooks.folders', []).some(x => x.tree === f.tree)) NvFiles.forget({tree:f.tree}).catch(() => {});
      closeSheet(); draw(); toast('Folder removed') } });
  $('#ss_save').onclick = async () => { try{ const r = await G.saveBackup(); if(r !== 'cancelled') toast('Groups saved') }catch(e){ toast(e.message || String(e), 4000) } };
  $('#ss_load').onclick = async () => { const t = await G.pickFile(); if(!t) return; const c = G.checkBackup(t); if(!c.ok){ toast(c.msg, 5000); return }
    if(!confirm(c.msg + '\n\nPut these groups back? (Undo is possible right after.)')) return; G.applyBackup(c.d); regroup(); closeSheet(); draw(); G.undoToast('Groups loaded', () => { regroup(); draw() }) };
  $('#ss_ren').onclick = async () => { const n = await ask('Rename the shelf', 'Name', s.name, 'Rename'); if(!n) return; shelfSet(sh, {name:n}); delete GRS[sh]; draw() };
  $('#ss_hide').onclick = () => { shelfSet(sh, {hidden:true}); closeSheet(); V = [{v:'shelves'}]; draw(); toast(`${s.name} is hidden - show it again in Settings on the first page`, 4500) };
  if($('#ss_del')) $('#ss_del').onclick = async () => { if(!confirm(`Remove the shelf “${s.name}”?`)) return; for(const b of inShelf(sh)){ b.shelf = 'books'; await dbPut('books', b) }
    const own = lsGet('nvBooks.shelves', {}); own._own = (own._own || []).filter(x => x.id !== sh); lsSet('nvBooks.shelves', own); regroup(); closeSheet(); V = [{v:'shelves'}]; draw() } }
function appSettings(){ const all = shelves(true);
  sheet(`<h3>Bookcase</h3><div class="sec" style="margin-top:4px">Shelves (tap ↑ to move one up)</div>
    ${all.map((s, i) => `<div class="li" style="cursor:default"><span style="width:30px;display:flex;justify-content:center">${shelfIcon(s, 20)}</span><div class="n"><div>${esc(s.name)}</div><div class="s">${plural(inShelf(s.id).length, 'book')}${s.hidden ? ' · hidden' : ''}</div></div><button class="btn sm" data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-eye="${esc(s.id)}">${s.hidden ? 'Show' : 'Hide'}</button></div>`).join('')}
    <div class="mlist" style="margin-top:10px"><button class="btn" id="as_new">+ New shelf</button></div>
    <div class="sec">Space</div><p class="muted small" id="as_space">…</p>
    <p class="muted small">Problems? Switch on <b>Debug mode</b> at the bottom of The Nightvault and send the log.</p>`);
  (async () => { try{ const e = await navigator.storage.estimate(), cp = BOOKS.filter(b => b.src.kind === 'copy'); $('#as_space').textContent = `${plural(BOOKS.length, 'book')} · ${plural(cp.length, 'copy', 'copies')} in the app (${mb(cp.reduce((a, b) => a + (b.size || 0), 0))}) · ${mb(Math.max(0, e.quota - e.usage))} free for the app` }catch(e){ $('#as_space').textContent = plural(BOOKS.length, 'book') } })();
  $('.sheet').addEventListener('click', e => { const u = e.target.closest('[data-up]'), ey = e.target.closest('[data-eye]');
    if(u){ const ids = shelves(true).map(s => s.id), i = +u.dataset.up; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; const own = lsGet('nvBooks.shelves', {}); own._order = ids; lsSet('nvBooks.shelves', own); appSettings(); draw() }
    if(ey){ const s = shelfOf(ey.dataset.eye); shelfSet(s.id, {hidden:!s.hidden}); appSettings(); draw() } });
  $('#as_new').onclick = () => newShelf() }
$('#setbtn').onclick = () => { const v = cur(); if(v.v === 'shelves') appSettings(); else shelfSettings(v.shelf || (BK[v.id] || {}).shelf) };
$('#addbtn').onclick = () => addSheet();

/* ---------- Android back button: sheet → reader → one screen back → The Nightvault ---------- */
if(window.Capacitor) try{ const A = (Capacitor.Plugins && Capacitor.Plugins.App) || Capacitor.registerPlugin('App');
  A.addListener('backButton', () => { if(sheetOpen()){ if(!$('#scrim').dataset.sticky) closeSheet(); return }
    if(R && !$('#rend').hidden){ $('#rend').hidden = true; return } if(R){ closeReader(); return } if(E){ closeEpub(); return }
    if(back()) return; if(fromHub()){ location.href = '../hub/index.html'; return } A.minimizeApp && A.minimizeApp() }) }catch(e){}
document.addEventListener('visibilitychange', () => { if(document.hidden){ if(R) saveState(R.b.id, true); if(E) ePos() } else if(R || E) awake(true) });

/* ---------- start ---------- */
(async () => {
  try{ await openDB(); await loadLib() }catch(e){ $('#body').innerHTML = `<p class="muted">Bookcase could not open its storage: ${esc(e.message || e)}</p>`; return }
  const P = new URLSearchParams(location.search), sh = P.get('shelf');
  if(sh && shelves(true).some(s => s.id === sh)) V.push({v:'shelf', shelf:sh});
  draw(); L('start', `${BOOKS.length} books`);
  window.NVBOOKS = {get books(){ return BOOKS }, openDoc, readMeta, parseName, zipOpen, openReader, draw};   // for testing
})();

/* shelf ⚙ → "Read the details of all books again": fills in empty fields (e.g. the publisher for books added before it was read) */
async function rereadShelf(sh){ const bs = inShelf(sh).filter(b => b.fmt !== 'imgs'), tops = pubTops(inShelf(sh).map(b => b.dir)); if(!bs.length) return; awake(true);
  sheet(`<h3>Reading the details again…</h3><div class="prog"><i id="rrp"></i></div><div class="muted small" id="rrs">0 of ${bs.length}</div><button class="btn" id="rrstop" style="width:100%;margin-top:8px">Stop</button>`, true);
  let stop = false, n = 0, changed = 0; $('#rrstop').onclick = () => { stop = true };
  for(const b of bs){ if(stop) break; try{ const src = await bookSource(b), md = await readMeta(src, b.name, b.dir); let ch = false;
      for(const k of ['publisher', 'writer', 'artist', 'year', 'desc', 'series']) if(md[k] && !b[k]){ b[k] = md[k]; ch = true }
      if(b.num == null && md.num != null){ b.num = md.num; b.vol = b.vol || md.vol; ch = true }
      const pd = pubFolder(b.dir, tops); if(b.pubDir !== pd){ b.pubDir = pd; ch = true }
      if(!COV.has(b.id) && md.cover){ await setCover(b.id, await thumb(md.cover)) }
      if(ch){ await dbPut('books', b); changed++ } }catch(e){ LE('reread', b.name, e) }
    n++; const p = $('#rrp'), t = $('#rrs'); if(p) p.style.width = (100 * n / bs.length) + '%'; if(t) t.textContent = `${n} of ${bs.length} · ${b.name}` }
  awake(false); regroup(); closeSheet(); draw(); toast(`${plural(changed, 'book')} updated`) }

/* =====================================================================================================================
   ONLINE LOOKUP – Comic Vine (comicvine.gamespot.com, free key of the owner, kept on this device only: nvBooks.cvKey)
   Asks once per SERIES (search the series → its issues), not per comic: about 2 requests per series, one every 1.3 s
   (Comic Vine allows ~200 an hour). Results are remembered (nvBooks.cv), so it works offline afterwards.
   Comic Vine sends no CORS headers: inside the Android app the request goes through Android's own connection (CapacitorHttp).
   What it fills in: the publisher (b.cvPub – a publisher from the file or set by hand still wins), and when empty: year, About, cover.
   ===================================================================================================================== */
const CV = {key:() => lsGet('nvBooks.cvKey', ''), cache:() => lsGet('nvBooks.cv', {}), save:c => lsSet('nvBooks.cv', c), last:0};
const cvHttp = () => NATIVE && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;
async function cvGet(path, params){
  const key = CV.key(); if(!key) throw Object.assign(new Error('Type your Comic Vine key first (shelf ⚙ → Comic Vine)'), {nokey:true});
  const wait = CV.last + 1300 - Date.now(); if(wait > 0) await sleep(wait); CV.last = Date.now();
  const q = new URLSearchParams(Object.assign({api_key:key, format:'json'}, params)), url = `https://comicvine.gamespot.com/api/${path}/?${q}`;
  let j; const H = cvHttp();
  if(H){ const r = await H.get({url, headers:{Accept:'application/json', 'User-Agent':'NightvaultBookcase/1.0 (personal app)'}, responseType:'json'});
    if(r.status === 401 || r.status === 403) throw new Error(`Comic Vine refused the request (${r.status}) – check your key`);
    if(r.status === 420 || r.status === 429) throw Object.assign(new Error('Comic Vine says: too many requests – wait an hour and try again'), {limit:true});
    if(r.status >= 400) throw new Error('Comic Vine answered ' + r.status); j = typeof r.data === 'string' ? JSON.parse(r.data) : r.data }
  else { let r; try{ r = await fetch(url) }catch(e){ throw new Error('Comic Vine can only be reached from the Nightvault Android app (a web browser blocks it)') }
    j = await r.json() }
  if(j.status_code === 100) throw new Error('Comic Vine says the key is not right');
  if(j.status_code === 107) throw Object.assign(new Error('Comic Vine says: too many requests – wait an hour and try again'), {limit:true});
  if(j.status_code !== 1) throw new Error('Comic Vine: ' + (j.error || 'error ' + j.status_code));
  return j }
const cvStrip = h => String(h || '').replace(/<(script|style|table|figure)[^]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
/* the series of a book as Comic Vine will see it: "Amazing Spider-Man" (no "The", no year, no issue) */
const cvName = b => String(b.series || b.title || '').replace(/\(\d{4}\)/g, '').trim();
const cvKeyOf = b => norm(cvName(b)) + '|' + (b.year || '');
/* the best matching Comic Vine series for these books: same name, started in or before their year (the newest such run), enough issues */
function cvPick(results, books){ const name = norm(cvName(books[0])), years = books.map(b => +b.year).filter(Boolean), y = years.length ? Math.max(...years) : 0, maxN = Math.max(0, ...books.map(b => b.num || 0));
  const scored = results.map(v => { const vn = norm(v.name); let s = vn === name ? 60 : vn.replace(/^the /, '') === name.replace(/^the /, '') ? 55 : vn.includes(name) || name.includes(vn) ? 25 : 0;
    const st = +v.start_year || 0; if(y && st){ if(st > y) s -= 60; else s += Math.max(0, 30 - (y - st) * 2) }
    if(maxN && v.count_of_issues >= maxN) s += 10; else if(maxN && v.count_of_issues) s -= 10;
    return {v, s} }).sort((a, b) => b.s - a.s);
  return scored }
async function cvSeries(books, force){
  const k = cvKeyOf(books[0]), c = CV.cache(); if(!force && c[k] && (c[k].id || Date.now() - c[k].at < 14 * 864e5)) return c[k];
  const j = await cvGet('search', {resources:'volume', query:cvName(books[0]), limit:20, field_list:'id,name,start_year,publisher,count_of_issues,image,deck'});
  const best = cvPick(j.results || [], books)[0];
  const hit = best && best.s >= 40 ? {id:best.v.id, name:best.v.name, start:best.v.start_year, pub:best.v.publisher && best.v.publisher.name, n:best.v.count_of_issues, at:Date.now()} : {id:0, at:Date.now()};
  c[k] = hit; CV.save(c); return hit }
/* the issues of a Comic Vine series: number → {desc, year, img} */
async function cvIssues(vid){ const j = await cvGet('issues', {filter:'volume:' + vid, limit:100, field_list:'id,issue_number,name,cover_date,description,deck,image'});
  const out = {}; for(const i of j.results || []) out[parseFloat(i.issue_number)] = {name:i.name, year:(i.cover_date || '').slice(0, 4), desc:cvStrip(i.deck || i.description).slice(0, 4000), img:i.image && (i.image.medium_url || i.image.small_url)}; return out }
async function cvImage(url){ const H = cvHttp(); if(H){ const r = await H.get({url, responseType:'blob'}); const bin = atob(String(r.data).replace(/^data:[^,]*,/, '')), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type:'image/jpeg'}) }
  return (await fetch(url)).blob() }
async function cvApply(books, hit, withIssues){ if(!hit || !hit.id) return 0; let n = 0, iss = null;
  if(withIssues && books.some(b => !b.desc || !COV.has(b.id) || !b.year)) try{ iss = await cvIssues(hit.id) }catch(e){ if(e.limit) throw e; LE('cv', 'issues', e) }
  for(const b of books){ b.cv = {id:hit.id, name:hit.name, start:hit.start}; if(hit.pub) b.cvPub = hit.pub;
    const i = iss && b.num != null ? iss[b.num] : null;
    if(i){ if(!b.desc && i.desc) b.desc = i.desc; if(!b.year && i.year) b.year = i.year; if(!COV.has(b.id) && i.img) try{ await setCover(b.id, await thumb(await cvImage(i.img))) }catch(e){} }
    await dbPut('books', b); n++ }
  return n }
/* shelf ⚙ / after adding: look up the comics that have no publisher (or all of them) */
async function cvLookup(sh, all){
  if(!CV.key()) return cvKeySheet(() => cvLookup(sh, all));
  const want = inShelf(sh).filter(b => all || !pubSource(b).p || pubSource(b).how === 'guess'), bySeries = {};
  for(const b of want) if(cvName(b)) (bySeries[cvKeyOf(b)] = bySeries[cvKeyOf(b)] || []).push(b);
  const list = Object.values(bySeries); if(!list.length){ toast('Nothing to look up'); return }
  awake(true); let stop = false, done = 0, found = 0, books = 0; const lines = [];
  sheet(`<h3>Looking up on Comic Vine…</h3><div class="prog"><i id="cvp"></i></div><div class="muted small" id="cvs">0 of ${plural(list.length, 'series', 'series')}</div><div id="cvl" class="small" style="max-height:34vh;overflow:auto;margin-top:6px"></div><button class="btn" id="cvstop" style="width:100%;margin-top:8px">Stop</button>`, true);
  $('#cvstop').onclick = () => { stop = true; $('#cvstop').textContent = 'Stopping…' };
  for(const bs of list){ if(stop) break;
    try{ const hit = await cvSeries(bs); if(hit.id){ found++; books += await cvApply(bs, hit, true) } lines.unshift(`${esc(cvName(bs[0]))} → ${hit.id ? `<b>${esc(hit.pub || '?')}</b> · ${esc(hit.name)} (${hit.start || '?'})` : '<span class="muted">not found</span>'}`) }
    catch(e){ lines.unshift(`<span style="color:var(--red)">${esc(e.message || e)}</span>`); LE('cv', cvName(bs[0]), e); if(e.limit || e.nokey || /key|Android app|refused/.test(e.message || '')) stop = true }
    done++; const p = $('#cvp'), s = $('#cvs'), l = $('#cvl'); if(p) p.style.width = (100 * done / list.length) + '%'; if(s) s.textContent = `${done} of ${plural(list.length, 'series', 'series')} · ${found} found`; if(l) l.innerHTML = lines.slice(0, 60).join('<br>') }
  awake(false); regroup(); draw(); L('cv', `lookup: ${found} of ${list.length} series found, ${books} books updated`, lines.slice(0, 80));
  const s = $('#cvs'); if(s) s.textContent = `Done: ${found} of ${plural(list.length, 'series', 'series')} found · ${plural(books, 'book')} updated`; const st = $('#cvstop'); if(st){ st.textContent = 'OK'; st.onclick = closeSheet } }
function cvKeySheet(then){
  sheet(`<h3>Comic Vine</h3><p class="muted small" style="margin:0 0 10px">Comic Vine is a free comics database. With your own key Bookcase can look up the publisher, series and story of your comics. The key stays on this phone.</p>
    <div class="field"><label>Your Comic Vine key</label><input type="text" id="cvk" value="${esc(CV.key())}" placeholder="40 letters and numbers" autocomplete="off" spellcheck="false"></div>
    <p class="muted small">No key yet? Make a free account on comicvine.gamespot.com, then open comicvine.gamespot.com/api – the key is on that page. (Your Nightvault PC app may have it under Settings.)</p>
    <div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="cvksave">Save${then ? ' and look up' : ''}</button></div>`);
  $('#cvksave').onclick = () => { const k = $('#cvk').value.trim().replace(/\s+/g, ''); if(!/^[0-9a-f]{40}$/i.test(k)){ toast('That does not look like a Comic Vine key (40 letters and numbers)', 4000); return } lsSet('nvBooks.cvKey', k); closeSheet(); toast('Key saved'); if(then) then() } }
/* book ⋯ → "Look up online…": pick the right Comic Vine series yourself (for the whole series of this book) */
async function cvChoose(b){
  if(!CV.key()) return cvKeySheet(() => cvChoose(b));
  const bs = inShelf(b.shelf).filter(x => cvName(x) && norm(cvName(x)) === norm(cvName(b)));
  sheet(`<h3>Comic Vine: “${esc(cvName(b))}”</h3><div style="display:flex;gap:8px"><input type="search" id="cvq" value="${esc(cvName(b))}"><button class="btn primary" id="cvgo">Search</button></div><div class="muted small" id="cvst" style="margin:8px 0">Searching…</div><div id="cvres"></div>`, true);
  const run = async () => { $('#cvst').textContent = 'Searching…'; $('#cvres').innerHTML = '';
    try{ const j = await cvGet('search', {resources:'volume', query:$('#cvq').value.trim(), limit:20, field_list:'id,name,start_year,publisher,count_of_issues,image'}), sc = cvPick(j.results || [], bs);
      $('#cvst').textContent = sc.length ? `Tap the right one – it is used for ${plural(bs.length, 'book')} of this series` : 'Nothing found - try other words';
      $('#cvres').innerHTML = sc.slice(0, 12).map(({v}) => `<div class="li" data-cv="${v.id}"><span class="th"><div class="cv">${v.image && v.image.thumb_url ? `<img class="f" src="${esc(v.image.thumb_url)}" alt="" style="object-fit:cover">` : ''}</div></span><div class="n"><div>${esc(v.name)} (${v.start_year || '?'})</div><div class="s">${esc(v.publisher ? v.publisher.name : '?')} · ${plural(v.count_of_issues || 0, 'issue')}</div></div></div>`).join('');
      $('#cvres').onclick = async e => { const r = e.target.closest('[data-cv]'); if(!r) return; const v = sc.find(x => String(x.v.id) === r.dataset.cv).v;
        const hit = {id:v.id, name:v.name, start:v.start_year, pub:v.publisher && v.publisher.name, n:v.count_of_issues, at:Date.now()}, c = CV.cache(); c[cvKeyOf(b)] = hit; CV.save(c);
        $('#cvst').textContent = 'Saving…'; try{ await cvApply(bs, hit, true) }catch(err){ toast(err.message || String(err), 5000) } regroup(); closeSheet(); draw(); toast(`${plural(bs.length, 'book')}: ${hit.pub || '?'} · ${hit.name} (${hit.start || '?'})`, 4000) } }
    catch(e){ $('#cvst').textContent = e.message || String(e) } };
  $('#cvgo').onclick = run; $('#cvq').onkeydown = e => { if(e.key === 'Enter') run() }; run() }
