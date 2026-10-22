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
  {id:'comics', name:'Comics', c:['#3a1626', '#1d1b33'], s:'#ff9db7', byPub:true, fullSeries:true},
  {id:'manga', name:'Manga', c:['#341a3a', '#1a1b33'], s:'#e0a8ff', rtl:true, fullSeries:true},
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
/* what a shelf holds decides where it looks things up: comics (Comic Vine, GCD, Wikipedia) or manga (MangaDex, AniList) – shelf ⚙ → Online */
const KIND_SRCS = {comics:['cv', 'gcd', 'wiki'], manga:['mdx', 'anl']};
const kindOf = sh => { const s = shelfOf(sh); return s.kind === 'manga' || s.kind === 'comics' ? s.kind : s.id === 'manga' ? 'manga' : 'comics' };
const isManga = sh => kindOf(sh) === 'manga';
const W = sh => isManga(sh) ? {i:'volume', is:'volumes', I:'Volumes', c:'manga', cs:'manga'} : {i:'issue', is:'issues', I:'Issues', c:'comic', cs:'comics'};
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
  if(b.src.kind === 'drive'){ if(b.src.fid){ const f = await dbGet('files', b.src.fid).catch(() => null); if(f) return srcFromBlob(f.blob, b.name) } return srcFromDrive(b.src) }
  if(b.src.kind === 'link') return srcFromLink(b.src);
  if(b.src.kind === 'blob') return srcFromBlob(b.src.blob, b.name);   // handed over by another app (Boardgames' files), see openHanded
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
  if(e < 0){ const h = new Uint8Array(await src.read(0, Math.min(8, n))); if(h[0] === 0x37 && h[1] === 0x7A && h[2] === 0xBC) throw new Error('This is a 7-Zip file (CB7) with a .cbz name - Bookcase can\'t open 7-Zip yet'); throw new Error(n < 1024 ? 'This file is empty' : 'This file is damaged or not completely downloaded (no ZIP inside)') }
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
  else if((m = s.match(/^(.*?\D)\s*[-–]\s*(\d{1,4}(?:\.\d+)?)\s*[-–](?:\s*(.*))?$/)) && m[1].trim()){ series = m[1]; num = parseFloat(m[2]); vol = '#' + (+m[2]); title = m[3] || '' }   // "De Rode Ridder -001- Het gebroken zwaard"
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
async function thumb(blob, maxW, q){
  let bm; try{ bm = await createImageBitmap(blob) }catch(e){ const u = URL.createObjectURL(blob); try{ const im = new Image(); im.src = u; await im.decode(); bm = im }finally{ setTimeout(() => URL.revokeObjectURL(u), 1000) } }
  const w = Math.min(maxW || 400, bm.width), h = Math.round(bm.height * w / bm.width), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h); if(bm.close) bm.close();
  return new Promise(ok => c.toBlob(b => ok(b), 'image/webp', q || .82)) }
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
  if(b.fmt === 'imgs' && b.src.kind === 'blob') return {n:1, toc:[], async page(){ const u8 = new Uint8Array(await b.src.blob.slice(0, 16).arrayBuffer()); return new Blob([b.src.blob], {type:sniff(u8) || MIME[ext(b.name)] || 'image/jpeg'}) }};
  if(b.fmt === 'imgs'){
    const files = b.src.kind === 'link' || b.src.kind === 'drive' ? b.src.files.slice().sort((x, y) => pageSort(x.name, y.name)) : b.src.fids.slice().sort((x, y) => pageSort(x.name, y.name));
    return {n:files.length, toc:[], async page(i){ const f = files[i];
      if(b.src.kind === 'link'){ const u8 = new Uint8Array(await linkRead(f.uri, f.name, 0, f.size)); return imgBlob(u8, f.name) }
      if(b.src.kind === 'drive'){ const u8 = new Uint8Array(await driveRead(f.id, 0, f.size)); return imgBlob(u8, f.name) }
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
async function loadLib(){ await loadCols(); BOOKS = await dbAll('books'); BK = Object.fromEntries(BOOKS.map(b => [b.id, b])); STATE = {}; for(const s of await dbAll('state')) STATE[s.id] = s;
  for(const id of await tx('covers', 'readonly', st => st.getAllKeys())) COV.add(id);
  await dropDoubles(); await renameFix() }
/* books added before the file-name reader knew a pattern (like "De Rode Ridder -001- Title", 20 Oct): read their names again, once */
async function renameFix(){ const ch = [];
  for(const b of BOOKS){ if(b.series || b.num != null || !b.name || b.fmt === 'imgs') continue; const p = parseName(b.name, b.dir); if(!p.series || p.num == null) continue;
    const old = String(b.name).replace(/\.[a-z0-9]+$/i, ''); b.series = p.series; b.num = p.num; b.vol = p.vol; if(!b.title || b.title === p.clean || b.title === old) b.title = p.title; ch.push(b) }
  for(const b of ch) await dbPut('books', b); if(ch.length) L('add', `file names read again: ${ch.length} books now in a series`) }
/* the same file twice on a shelf (added once through its own folder and once through a folder around it): keep one – the one you read in, else the oldest */
async function dropDoubles(){ const by = {}; for(const b of BOOKS) if(b.fmt !== 'imgs' && b.name && b.size) (by[b.shelf + '|' + b.name + '|' + b.size] = by[b.shelf + '|' + b.name + '|' + b.size] || []).push(b);
  const gone = []; for(const l of Object.values(by)) if(l.length > 1){ l.sort((a, b) => ((STATE[b.id] || {}).last || 0) - ((STATE[a.id] || {}).last || 0) || a.added - b.added); gone.push(...l.slice(1)) }
  if(!gone.length) return; const g = new Set(gone.map(b => b.id));
  await dbDelMany('books', [...g]); await dbDelMany('covers', [...g]).catch(() => {}); await dbDelMany('state', [...g]).catch(() => {});
  for(const id of g){ delete BK[id]; delete STATE[id]; COV.delete(id) } BOOKS = BOOKS.filter(b => !g.has(b.id));
  L('start', `removed ${gone.length} doubles`); setTimeout(() => toast(`${plural(gone.length, 'double')} removed (the same comic was in two of your folders)`, 5000), 800) }
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
      <button class="btn" id="adgd">From Google Drive</button><div class="muted small" style="margin:-2px 0 0">A Drive folder of yours that is shared with a link: read from Drive, Download keeps a copy on the phone.</div>
      ${window.NVPC && NVPC.native ? '<button class="btn" id="adpc">From my PC</button><div class="muted small" style="margin:-2px 0 0">What the Nightvault PC app has: pick books, a range or a full series to keep on the phone.</div>' : ''}
      ${dirOK ? '<button class="btn" id="add">Pick a whole folder</button><div class="muted small" style="margin:-2px 0 0">Folders of pictures become one book each.</div>' : ''}</div>`);
  if($('#adl')) $('#adl').onclick = () => { closeSheet(); addFolder(sh.id) };
  if($('#adpc')) $('#adpc').onclick = () => pcSheet(sh.id);
  $('#adgd').onclick = () => driveSheet(sh.id);
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

/* ---------- On my PC: what the Nightvault PC app has (comics, manga, books, RPG) – save to the phone book by book, a range ("1-12, 15") or the whole series ----------
   Needs the Android app + the PC paired (The Nightvault > Take with me, shared ../hub/nvpc.js). A saved book is an ordinary book copied into the app, so it works offline. */
let PCB = null, PCBAT = 0, PCALL = false, PCQ = '', PCN = {};
const pcKinds = sh => sh === 'manga' || isManga(sh) ? ['manga'] : sh === 'comics' ? ['comic'] : sh === 'books' ? ['book'] : sh === 'rulebooks' || sh === 'rpg' ? ['rpg'] : null;
const pcKey = f => f.name + '|' + f.size;
const pcHave = () => new Set(BOOKS.filter(b => b.fmt !== 'imgs').map(b => b.name + '|' + b.size));
async function pcList(fresh){
  if(PCB && !fresh && Date.now() - PCBAT < 60000) return PCB;
  const j = await NVPC.list('books', null, fresh); PCB = j.items || []; PCBAT = Date.now(); return PCB }
async function pcSheet(shelf){
  if(!(window.NVPC && NVPC.native && NVPC.pc)){ sheet(`<h3>On my PC</h3><p class="muted">Connect the Nightvault PC app first: open <b>The Nightvault</b> → <b>Take with me</b> and pair it with the code from the PC (Settings → Phone access).</p><button class="btn primary" style="width:100%" id="pcok">OK</button>`); $('#pcok').onclick = closeSheet; return }
  sheet(`<h3>On my PC</h3><div class="prog busy"><i></i></div><div class="muted small" id="pcst">Asking the PC…</div>`, true);
  let list; try{ list = await pcList(true) }catch(e){ sheet(`<h3>On my PC</h3><p class="muted">${esc(/Failed to fetch|NetworkError|timeout/i.test(e.message || '') ? 'Can\'t reach the PC. Is the phone on the home Wi-Fi and is Nightvault running on the PC?' : e.message || String(e))}</p><button class="btn primary" style="width:100%" id="pcok">OK</button>`); $('#pcok').onclick = closeSheet; return }
  try{ const r = await fetch(NVPC.url('/nv/news'), {cache:'no-store'}); PCN = r.ok ? ((await r.json()).items || {}) : {} }catch(e){ PCN = {} }
  pcListDraw(shelf) }
const pcNewN = s => { const n = PCN[s.gid]; return n ? (Array.isArray(n.new) ? n.new.length : n.new || 0) : 0 };
function pcListDraw(shelf){
  const kinds = pcKinds(shelf), have = pcHave(), sh = shelfOf(shelf);
  let rows = (PCB || []).filter(s => PCALL || !kinds || kinds.includes(s.kind));
  const q = norm(PCQ); if(q) rows = rows.filter(s => norm(s.name).includes(q));
  const row = s => { const on = s.files.filter(f => have.has(pcKey(f))).length;
    return `<div class="pcr" data-sid="${esc(s.id)}" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer">
      <div style="width:42px;height:60px;border-radius:5px;background:#252d3a;overflow:hidden;flex:none;position:relative">${pcNewN(s) ? `<span class="newb" style="top:3px;left:3px;font-size:9.5px;padding:1px 6px">NEW</span>` : ''}${s.cover ? `<img src="${NVPC.url('/nv/bcover?id=' + s.id)}" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()">` : ''}</div>
      <div style="min-width:0;flex:1"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</div>
      <div class="muted small">${plural(s.count, 'book')} · ${mb(s.size)}${on ? ` · ${on} on the phone` : ''}</div><div class="muted small">${esc(s.collname)}${pcNewN(s) ? ` · <b style="color:#ff6b86">${pcNewN(s)} new online, not on the PC yet</b>` : ''}</div></div></div>` };
  sheet(`<h3>On my PC → ${esc(sh.name)}</h3>
    <input type="search" id="pcq" placeholder="Search the PC's library" value="${esc(PCQ)}">
    <label class="muted small" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="pcall" ${PCALL || !kinds ? 'checked' : ''}> Show everything on the PC, not just ${esc(sh.name.toLowerCase())}</label>
    <div style="max-height:56vh;overflow:auto" id="pclist">${rows.length ? rows.map(row).join('') : `<p class="muted">${(PCB || []).length ? 'Nothing here matches.' : 'The PC has no comics, manga or books yet.'}</p>`}</div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" id="pcnews">Check the PC for new releases</button><button class="btn" style="flex:1" id="pcx">Close</button></div>`, true);
  $('#pcx').onclick = closeSheet;
  $('#pcnews').onclick = async () => { try{ await fetch(NVPC.url('/nv/news?run=1'), {cache:'no-store'}); toast('The PC is checking – look again in a few minutes (the PC does it every night as well)', 5000) }catch(e){ toast('Can\'t reach the PC') } };
  $('#pcall').onchange = e => { PCALL = e.target.checked; pcListDraw(shelf) };
  let t = 0; $('#pcq').oninput = e => { PCQ = e.target.value; clearTimeout(t); t = setTimeout(() => { pcListDraw(shelf); const i = $('#pcq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length) }, 250) };
  $('#pclist').onclick = e => { const r = e.target.closest('.pcr'); if(r) pcSeries(shelf, r.dataset.sid) } }
/* "1-12, 15" → the files with those numbers */
function pcRange(txt, files){ const want = [];
  for(const part of String(txt).split(/[,;\s]+/).filter(Boolean)){ const m = part.match(/^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?$/); if(!m) return null; want.push([+m[1], m[2] != null ? +m[2] : +m[1]]) }
  return files.filter(f => f.number != null && want.some(([a, b]) => f.number >= Math.min(a, b) && f.number <= Math.max(a, b))) }
function pcSeries(shelf, sid){
  const s = (PCB || []).find(x => x.id === sid); if(!s) return;
  const have = pcHave(), todo = s.files.filter(f => !have.has(pcKey(f))), W2 = s.kind === 'manga' ? 'volume' : s.kind === 'comic' ? 'issue' : 'book';
  const lab = f => f.number != null ? `${W2[0].toUpperCase() + W2.slice(1)} ${f.number}` : f.name.replace(/\.[^.]+$/, '');
  sheet(`<h3>${esc(s.name)}</h3><div class="muted small" style="margin:-6px 0 8px">${plural(s.count, 'book')} · ${mb(s.size)} · ${plural(s.count - todo.length, 'one')} already on the phone</div>${(n => n && n.new && (n.new.length || n.new > 0) ? `<div class="newbar on" style="margin:0 0 10px"><div class="nbt"><b>New online: ${Array.isArray(n.new) ? n.new.slice(0, 10).join(', ') : n.new + ' more'}</b><div class="muted small">Not on your PC yet – add ${Array.isArray(n.new) && n.new.length === 1 ? 'it' : 'them'} to the server.</div></div></div>` : '')(PCN[s.gid])}
    <div class="mlist"><button class="btn primary" id="pcfull" ${todo.length ? '' : 'disabled'}>Save the full series (${todo.length} not on the phone yet · ${mb(todo.reduce((n, f) => n + f.size, 0))})</button>
    <div style="display:flex;gap:8px"><input id="pcrng" placeholder="Range, like 1-12, 15" style="flex:1" inputmode="text"><button class="btn" id="pcrg">Save range</button></div></div>
    <div class="muted small" style="margin:12px 0 4px">Or tick single books:</div>
    <div id="pcfiles" style="max-height:38vh;overflow:auto">${s.files.map((f, i) => { const on = have.has(pcKey(f));
      return `<label class="opt" style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)"><input type="checkbox" data-i="${i}" ${on ? 'checked disabled' : ''}><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(lab(f))}</span><span class="muted small">${on ? '✓ on phone' : mb(f.size)}</span></label>` }).join('')}</div>
    <div class="mlist" style="margin-top:10px"><button class="btn" id="pcsel">Save the ticked books</button><button class="btn" id="pcback">Back</button></div>`, true);
  $('#pcback').onclick = () => pcListDraw(shelf);
  const go = fs => { fs = fs.filter(f => !have.has(pcKey(f))); if(!fs.length){ toast('Nothing new to save'); return } pcSave(shelf, s, fs) };
  $('#pcfull').onclick = () => go(s.files);
  $('#pcrg').onclick = () => { const r = pcRange($('#pcrng').value, s.files); if(!r){ toast('Type numbers like 1-12, 15'); return } if(!r.length){ toast('No ' + W2 + 's with those numbers'); return } go(r) };
  $('#pcsel').onclick = () => { const fs = [...document.querySelectorAll('#pcfiles input:checked:not(:disabled)')].map(c => s.files[+c.dataset.i]); if(!fs.length){ toast('Tick at least one book'); return } go(fs) } }
/* download one at a time (the PC sends it over the home Wi-Fi), put each on the shelf as soon as it is there */
let PCDL = null;
async function pcSave(shelf, s, fs){
  const me = PCDL = {stop:false}, total = fs.reduce((n, f) => n + f.size, 0); let done = 0, bytes = 0, added = 0, failed = 0; const errs = [];
  try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); const e = await navigator.storage.estimate();
    if(e && e.quota && e.quota - e.usage < total * 1.1){ toast(`Not enough space: ${mb(total)} needed, ${mb(e.quota - e.usage)} free`, 5000); return } }catch(e){}
  awake(true);
  sheet(`<h3>Saving to the phone…</h3><div class="prog"><i id="pcp"></i></div><div class="muted small" id="pct" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">0 of ${fs.length}</div>
    <p class="muted small">Keep the app open and stay on the home Wi-Fi. Books are on the shelf as soon as each one is there.</p><button class="btn" id="pcstop" style="width:100%">Stop (keep what is saved)</button>`, true);
  $('#pcstop').onclick = () => { me.stop = true; $('#pcstop').disabled = true; $('#pcstop').textContent = 'Stopping…' };
  const draw2 = (extra) => { const p = $('#pcp'), t = $('#pct'); if(p) p.style.width = (100 * (bytes + (extra || 0)) / Math.max(1, total)) + '%'; if(t) t.textContent = `${done} of ${fs.length} · ${mb(bytes + (extra || 0))} of ${mb(total)}` };
  for(const f of fs){ if(me.stop) break;
    try{ const r = await fetch(NVPC.url('/nv/file?id=' + encodeURIComponent(f.id)), {cache:'no-store'}); if(!r.ok) throw new Error('The PC answered ' + r.status);
      const parts = []; let got = 0;
      if(r.body && r.body.getReader){ const rd = r.body.getReader(); for(;;){ const {done:d, value} = await rd.read(); if(d) break; parts.push(value); got += value.length; draw2(got); if(me.stop){ try{ rd.cancel() }catch(e){} break } } }
      else { parts.push(await r.arrayBuffer()); got = parts[0].byteLength }
      if(me.stop) break;
      const file = new File(parts, f.name, {type:'application/octet-stream'});
      if(f.size && Math.abs(file.size - f.size) > 16) throw new Error('only part of the file arrived');
      const {items, notyet} = toItems([{f:file, path:f.name}]);
      added += (await scan(items, shelf, null, notyet, true)) || 0; bytes += f.size; done++; draw2() }
    catch(e){ failed++; done++; errs.push(f.name + ': ' + (e.message || e)); LE('pc', 'could not save ' + f.name, e) } }
  PCDL = null; awake(false); closeSheet(); draw();
  toast(`${plural(added, 'book')} saved to the phone${me.stop ? ' (stopped)' : ''}${failed ? ` · ${failed} failed` : ''}`, 6000);
  if(failed) setTimeout(() => { sheet(`<h3>${plural(failed, 'book')} could not be saved</h3><div style="max-height:46vh;overflow:auto;font-size:12.5px" class="muted">${errs.slice(0, 40).map(esc).join('<br>')}</div><button class="btn primary" style="width:100%;margin-top:12px" id="errok">OK</button>`); $('#errok').onclick = closeSheet }, 400) }

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
async function scan(items, shelf, folder, notyet, quiet){
  const key = it => folder ? (it.kind === 'imgs' ? folder.tree + '|' + it.path : it.f.uri) : (it.kind === 'imgs' ? 'dir|' + it.path + '|' + it.files.length : it.f.name + '|' + it.f.size);
  const bkey = b => b.src.kind === 'link' || b.src.kind === 'drive' ? (b.fmt === 'imgs' ? b.src.tree + '|' + b.dir2 : b.src.uri) : (b.fmt === 'imgs' ? 'dir|' + b.dir2 + '|' + b.src.fids.length : b.name + '|' + b.size);
  const same = new Set(BOOKS.filter(b => b.shelf === shelf && b.fmt !== 'imgs').map(b => b.name + '|' + b.size));   // the same file through another folder (a folder inside a folder you added)
  const have = new Set(BOOKS.filter(b => b.shelf === shelf).map(bkey)), fresh = items.filter(it => !have.has(key(it)) && !(it.kind === 'file' && same.has(it.f.name + '|' + it.f.size)));
  let removed = 0;
  if(folder){ const seen = new Set(items.map(key)), gone = BOOKS.filter(b => b.shelf === shelf && (b.src.kind === 'link' || b.src.kind === 'drive') && b.src.tree === folder.tree && !seen.has(bkey(b)));
    if(gone.length){ removed = gone.length; await dbDelMany('books', gone.map(b => b.id)); const g = new Set(gone.map(b => b.id)); BOOKS = BOOKS.filter(b => !g.has(b.id)); for(const id of g) delete BK[id] } }
  if(!fresh.length && quiet) return 0;
  if(!fresh.length){ awake(false); closeSheet(); draw(); toast(items.length || removed ? `No new books${removed ? ` · ${plural(removed, 'book')} that are gone were removed` : ''}` : `No books found there${notyet ? ` (${notyet} in a format Bookcase can't read yet: CB7, MOBI …)` : ''}`, 5000); return }
  if(!folder){ const total = fresh.reduce((a, it) => a + (it.kind === 'imgs' ? it.files.reduce((n, f) => n + f.size, 0) : it.f.size), 0);
    try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist() }catch(e){}
    try{ const e = await navigator.storage.estimate(); if(e && e.quota && e.quota - e.usage < total * 1.05){ closeSheet(); toast(`Not enough space: ${mb(total)} needed, ${mb(e.quota - e.usage)} free`, 5000); return } }catch(e){} }
  SCAN = {stop:false}; const me = SCAN; if(!quiet) awake(true);
  if(!quiet) sheet(`<h3>${folder ? 'Reading your books…' : 'Copying books into the app…'}</h3><div class="prog"><i id="sp"></i></div><div class="muted small" id="stx" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">0 of ${fresh.length} · starting…</div>
    <p class="muted small">The screen stays on while books are added.</p><button class="btn" id="sstop" style="width:100%">Stop (keep what is read so far)</button>`, true);
  if(!quiet) $('#sstop').onclick = () => { me.stop = true; $('#sstop').disabled = true; $('#sstop').textContent = 'Stopping…' };
  let done = 0, added = 0, failed = 0, i = 0; const now = Date.now(), errs = [], tops = pubTops(items.map(it => it.dir).concat(BOOKS.filter(b => b.shelf === shelf).map(b => b.dir)));
  const one = async it => {
    const b = {id:uid(), shelf, added:now, dir:it.dir || '', dir2:it.path, pubDir:pubFolder(it.dir, tops)};
    if(it.kind === 'imgs'){ const fs = it.files.slice().sort((x, y) => pageSort(x.name, y.name)), p = parseName(it.name, it.dir);
      Object.assign(b, {fmt:'imgs', name:it.name, title:p.title || (p.series ? '' : p.clean), series:p.series, num:p.num, vol:p.vol, year:p.year, pages:fs.length, size:fs.reduce((n, f) => n + f.size, 0)});
      if(folder) b.src = folder.drive ? {kind:'drive', tree:folder.tree, files:fs.map(f => ({uri:f.uri, id:f.id, name:f.name, size:f.size}))} : {kind:'link', tree:folder.tree, files:fs.map(f => ({uri:f.uri, name:f.name, size:f.size}))};
      else { const fids = []; for(const f of fs){ const fid = uid(); await dbPut('files', {id:fid, blob:f}); fids.push({fid, name:f.name}) } b.src = {kind:'copy', fids} }
      try{ const f0 = fs.find(f => /cover|front/i.test(f.name)) || fs[0]; const dt = folder && folder.drive && f0.thumb ? await gdThumb(f0.thumb) : null; if(dt){ await setCover(b.id, await thumb(dt)); throw 0 }
        const u8 = folder ? new Uint8Array(folder.drive ? await driveRead(f0.id, 0, f0.size) : await linkRead(f0.uri, f0.name, 0, f0.size)) : new Uint8Array(await f0.arrayBuffer()); await setCover(b.id, await thumb(imgBlob(u8, f0.name))) }catch(e){} }
    else { const f = it.f, src = folder ? (folder.drive ? srcFromDrive(f) : srcFromLink(f)) : srcFromBlob(f, f.name), md = folder && folder.drive ? await driveMeta(src, f, it.dir) : await readMeta(src, f.name, it.dir);
      Object.assign(b, {fmt:md.fmt, name:f.name, size:f.size, publisher:md.publisher || '', title:md.title, series:md.series, num:md.num, vol:md.vol, writer:md.writer, artist:md.artist, year:md.year, desc:md.desc, pages:md.pages, rtl:md.rtl, later:md.later || false});
      if(folder) b.src = folder.drive ? {kind:'drive', uri:f.uri, id:f.id, name:f.name, size:f.size, tree:folder.tree} : {kind:'link', uri:f.uri, name:f.name, size:f.size, tree:folder.tree};
      else { const fid = uid(); await dbPut('files', {id:fid, blob:f}); b.src = {kind:'copy', fid} }
      if(md.cover) try{ await setCover(b.id, await thumb(md.cover)) }catch(e){ LE('cover', 'could not make the cover of ' + f.name, e) } }
    await dbPut('books', b); BOOKS.push(b); BK[b.id] = b; added++ };
  const work = async () => { while(i < fresh.length && !me.stop){ const it = fresh[i++], nm = it.kind === 'imgs' ? it.name : it.f.name;
      if(GDBLOCK > Date.now() && folder && folder.drive){ me.stop = true; errs.push(GDBUSY); break }
      try{ await Promise.race([one(it), new Promise((ok, no) => setTimeout(() => no(new Error('took too long – skipped (try “Look again” later)')), 180000))]) }catch(err){ failed++; errs.push(nm + ': ' + (err.message || err)); LE('add', 'could not add ' + nm, err); if(err && err.name === 'QuotaExceededError'){ me.stop = true; toast('The phone is full', 5000) } }
      done++; if(done % 25 === 0 || done === fresh.length) L('add', `${done} of ${fresh.length} read (${added} added, ${failed} failed)`, errs.slice(-3));
      const p = $('#sp'), s = $('#stx'); if(p) p.style.width = (100 * done / fresh.length) + '%'; if(s) s.textContent = `${done} of ${fresh.length} · ${nm}` } };
  await Promise.all([work(), work()]);
  SCAN = null; if(quiet){ regroup(); draw(); return added }
  awake(false); closeSheet(); draw();
  L('add', `${added} added, ${failed} failed`, errs.slice(0, 20));
  { regroup(); const nb = BOOKS.filter(b => b.shelf === shelf && b.added === now); L('add', 'publishers', nb.map(b => `${b.name} → ${pubSource(b).p || '-'} (${pubSource(b).how || 'none'})`).slice(0, 200)) }
  toast(`${plural(added, 'book')} added${removed ? ` · ${removed} gone` : ''}${failed ? ` · ${failed} could not be read` : ''}${notyet ? ` · ${notyet} in a format not supported yet` : ''}`, 6000);
  if(!failed && shelfOf(shelf).byPub && canLookOnline(shelf) && BOOKS.some(b => b.shelf === shelf && b.added === now && (!pubSource(b).p || pubSource(b).how === 'guess'))) setTimeout(() => { const n = BOOKS.filter(b => b.shelf === shelf && b.added === now && (!pubSource(b).p || pubSource(b).how === 'guess')).length;
    sheet(`<h3>Look them up online?</h3><p class="muted small">${plural(n, 'comic')} of what you just added ${n === 1 ? 'has' : 'have'} no publisher in the file. Bookcase can look it up online (${esc(srcOrder(shelf).map(x => SRC_NAME[x]).join(', '))}).</p><div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Not now</button><button class="btn primary" style="flex:2" id="cvnow">Look them up</button></div>`); $('#cvnow').onclick = () => cvLookup(shelf, false) }, 700);
  if(!failed && isManga(shelf) && shelfOf(shelf).fullSeries && canLookOnline(shelf) && BOOKS.some(b => b.shelf === shelf && b.added === now && !b.cv)) setTimeout(() => { const n = new Set(BOOKS.filter(b => b.shelf === shelf && b.added === now && !b.cv).map(b => norm(b.series || b.title))).size;
    sheet(`<h3>Look them up online?</h3><p class="muted small">Bookcase can look up ${plural(n, 'series', 'series')} of what you just added: every volume with its cover (the ones you don't have show grey), the story, writer and artist. It uses ${esc(srcOrder(shelf).map(x => SRC_NAME[x]).join(' and '))} – no key needed.</p><div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Not now</button><button class="btn primary" style="flex:2" id="cvnow">Look them up</button></div>`); $('#cvnow').onclick = () => cvLookup(shelf, false) }, 700);
  if(failed) setTimeout(() => sheet(`<h3>${plural(failed, 'file')} could not be read</h3><div style="max-height:46vh;overflow:auto;font-size:12.5px" class="muted">${errs.slice(0, 60).map(esc).join('<br>')}</div><button class="btn primary" style="width:100%;margin-top:12px" id="errok">OK</button>`), 400), setTimeout(() => { const b = $('#errok'); if(b) b.onclick = closeSheet }, 500) }
async function lookAgain(f){ if(/^gd:/.test(f.tree)) return driveAdd(f.shelf, {id:f.tree.slice(3), name:f.name}); if(!NvFiles) return; await addFolder(f.shelf, {tree:f.tree, name:f.name}) }

/* ---------- groups: the shared way of every Nightvault app (../hub/nvgroups.js, plans/shared-groups.md) – one engine per shelf ----------
   automatic group = the series (Naruto, Saga, …); on the Books shelf a writer's books without a series make a tile too */
const GRS = {};
function grOf(sh){ if(GRS[sh]) return GRS[sh]; const s = shelfOf(sh);
  return GRS[sh] = NVGROUPS.make({prefix:'nvBooks.' + sh, app:'bookcase-' + sh, title:'Bookcase · ' + s.name, itemsKey:'itemGroup', norm, key:b => b.id,
    hay:b => [b.title, b.series, b.writer].filter(Boolean).join(' '), kinds:{series:'Series', author:'Writer', publisher:'Publisher'},
    auto:b => b.series ? {key:'s:' + norm(b.series), name:b.series, kind:'series'} : s.authors && b.writer ? {key:'a:' + norm(b.writer), name:b.writer, kind:'author'} : null,
    onRekey:async (from, to) => { const id = 'grp:' + sh + ':' + from; if(!COV.has(id)) return; const c = await dbGet('covers', id).catch(() => null); if(c){ await setCover('grp:' + sh + ':' + to, c.blob); draw() } }}) }
const groupsOf = sh => GROUPCACHE[sh] || (GROUPCACHE[sh] = withPublishers(sh, oneIssueSeries(sh, grOf(sh).build(inShelf(sh)))));
/* "Show every issue of a series" on: one comic of a series is enough for a series tile (it opens to the whole list, the rest grey) */
function oneIssueSeries(sh, r){ if(!shelfOf(sh).fullSeries) return r; const G = grOf(sh), ov = G.read('items'), par = G.read('parent'), have = new Set(r.groups.map(g => g.key)), keep = [];
  for(const b of r.singles){ const key = b.series ? 's:' + norm(b.series) : ''; if(!key || ov[b.id] !== undefined || have.has(key)){ keep.push(b); continue }
    const g = {key, name:G.read('label')[key] || b.series, kind:'series', items:[b], kids:[], parent:null}; const pp = par[key]; if(pp && pp !== '_top') g.parent = pp; r.groups.push(g); have.add(key) }
  r.singles = keep; const by = Object.fromEntries(r.groups.map(g => [g.key, g])); for(const g of r.groups) if(g.parent && by[g.parent] && !by[g.parent].kids.includes(g)) by[g.parent].kids.push(g); for(const g of r.groups) g.all = G.all(g);
  return r }
/* publishers: Comics › Marvel › Spider-Man › the volumes. A series (and a book without a series) goes into its publisher's tile by itself;
   the publisher comes from the file (ComicInfo.xml Publisher, the EPUB's publisher), else from the folder (Comics/Marvel/…), else "Edit details".
   Anything placed by hand wins: a series put inside another group stays there, a book set to "its own tile" stays on its own.
   Switch per shelf (shelf ⚙ → "Bundle series by publisher"); on by default for Comics. */
const PUB_ALIAS = [[/^marvel( comics| entertainment| worldwide)?$/i, 'Marvel'], [/^dc( comics| entertainment)?$/i, 'DC'], [/^dark ?horse( comics| books)?$/i, 'Dark Horse'], [/^image( comics)?$/i, 'Image'], [/^idw( publishing)?$/i, 'IDW'], [/^boom!?( studios)?$/i, 'BOOM! Studios'], [/^dynamite( entertainment)?$/i, 'Dynamite'], [/^titan( comics)?$/i, 'Titan'], [/^archie( comics)?$/i, 'Archie'], [/^valiant( entertainment| comics)?$/i, 'Valiant'], [/^ablaze( publishing)?$/i, 'Ablaze'], [/^aftershock( comics)?$/i, 'AfterShock'], [/^oni( press)?$/i, 'Oni Press'], [/^vault( comics)?$/i, 'Vault']];
const cleanPub = p => { p = String(p || '').trim(); for(const [re, n] of PUB_ALIAS) if(re.test(p)) return n; return p };
/* Marvel/Spider-Man/x.cbz → Marvel; DC/Watchmen.cbz → DC too, but only when that folder also holds series folders (tops) – a folder like 'Loose' is no publisher */
const NOT_PUB_DIR = /\b(19|20)\d\d[.\-_ ]\d\d|\b(weekly|week|pack|packs|0-?day|download|downloads|torr|torrents?|new|incoming|unsorted|misc|loose|to ?read|read|comics?|books?|manga|ebooks?|digital|scans?|temp|tmp)\b/i;
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
  'BOOM! Studios':'something is killing the children|house of slaughter|power rangers',
  Rebellion:'judge dredd|2000ad|2000 ad|2000ad prog|judge anderson',
  Dynamite:'vampirella|red sonja|the boys'};
/* names of more than one word, and distinctive single names, count anywhere in the series name ("Absolute Batman", "Uncanny X-Men");
   other single words (Saga, Flash, Titans, Thor …) only when they are the whole name apart from words like "The", "Absolute", "Amazing" */
const ANYWHERE = new Set('2000ad vampirella marvel dc batman superman wolverine deadpool avengers nightwing aquaman supergirl superboy batgirl batwoman catwoman hellboy spawn daredevil punisher hawkeye carnage venom dceased bprd tmnt'.split(' '));
const PREFIX_RE = /^((the|absolute|ultimate|all new|all new all different|amazing|uncanny|immortal|superior|spectacular|astonishing|sensational|new|savage|mighty|dark|young|original|untold|unstoppable) )+/;
const guessPub = name => { const n = norm(name), bare = n.replace(PREFIX_RE, '').trim();
  for(const [p, w] of Object.entries(KNOWN_PUB)) for(const k of w.split('|')){ if(k.includes(' ') || ANYWHERE.has(k)){ if((' ' + n + ' ').includes(' ' + k + ' ')) return p } else if(bare === k || n === k) return p }
  return '' };
let PUBLEARN = null;   // series → publisher, from the books that have one (rebuilt with the groups)
function pubLearn(){ if(PUBLEARN) return PUBLEARN; const c = {};
  for(const b of BOOKS){ const p = pubDirect(b).p; if(!p || !b.series) continue; const k = norm(b.series); (c[k] = c[k] || {})[p] = (c[k][p] || 0) + 1 }
  PUBLEARN = {}; for(const [k, ps] of Object.entries(c)) PUBLEARN[k] = Object.keys(ps).sort((a, b) => ps[b] - ps[a])[0]; return PUBLEARN }
/* a publisher written in the file name: "Junk Punch 03 (of 05) (2026) (Mad Cave Studios) (Digital).cbz" */
const PUB_WORD = /\b(comics|entertainment|studios|press|publishing|publications|books|media|productions|group)$|^(marvel|dc|image|idw|boom!?|dark horse|titan|ablaze|oni|aftershock|vault|scout|zenescope|archie|valiant|rebellion|humanoids|fantagraphics|top cow|skybound|mad cave|ahoy|awa|source point|massive|bad idea|whatnot|behemoth)\b/i;
const pubFromName = n => { for(const m of String(n || '').matchAll(/\(([^()]{2,40})\)/g)){ const t = m[1].trim(); if(/^(of \d+|\d{4}|digital.*|webrip|.*-(dcp|empire)|limited series|series|one-?shot|\d+p|c2c|f|fixed|hd|.*rip)$/i.test(t)) continue; if(PUB_WORD.test(t)) return t } return '' };
/* what the book itself says: the file, the file name, the folder, Comic Vine */
function pubDirect(b){ if(b.publisher) return {p:cleanPub(b.publisher), how:'file'}; const pn = pubFromName(b.name); if(pn) return {p:cleanPub(pn), how:'name'};
  if(b.pubDir && !NOT_PUB_DIR.test(b.pubDir)) return {p:cleanPub(b.pubDir), how:'folder'}; if(b.cvPub) return {p:cleanPub(b.cvPub), how:'online'}; return {p:'', how:''} }
function pubSource(b){ const d = pubDirect(b); if(d.p) return d; if(b.cvPub) return {p:cleanPub(b.cvPub), how:'online'};
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

/* ---------- remote covers (a volume of a list: MangaDex …) ----------
   Shown from the address at once in a browser. In the Android app the ones from MangaDex are fetched ONE BY ONE (two at a time, a small pause, 3 tries;
   CapacitorHttp = no CORS), shrunk to a small WebP and kept on the phone (covers store, id 'rc:<address>'): MangaDex's picture server stopped answering after
   about 14 pictures when the web view asked for a whole series at once (owner, 21 Oct), and now the grey covers also show without internet (a work wifi
   that blocks MangaDex). A picture that still fails falls back to the plain address. */
let RC_ON = NATIVE; const RCQ = {run:0, q:[], p:{}, ok:0, fail:0};
const rcWant = u => RC_ON && /^https:\/\/uploads\.mangadex\.org\//.test(String(u));
const rcId = u => 'rc:' + String(u).replace(/^https?:\/\//, '');
const remImg = u => rcWant(u) ? `<img class="b" data-rc="${esc(u)}" alt=""><img class="f" data-rc="${esc(u)}" alt="">` : `<img class="b" src="${esc(u)}" alt="" loading="lazy"><img class="f" src="${esc(u)}" alt="" loading="lazy">`;
const rcIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ rcIO.unobserve(e.target); rcLoad(e.target) } }, {rootMargin:'400px'}) : null;
function lazyRemote(root){ (root || document).querySelectorAll('img[data-rc]').forEach(im => { if(im.dataset.rcd) return; if(COV.has(rcId(im.dataset.rc)) || !rcIO) rcLoad(im); else rcIO.observe(im) }) }
async function rcLoad(im){ if(im.dataset.rcd) return; im.dataset.rcd = '1'; const u = im.dataset.rc, id = rcId(u);
  const show = url => document.querySelectorAll('img[data-rc]').forEach(x => { if(x.dataset.rc === u && x.getAttribute('src') !== url){ x.dataset.rcd = '1'; x.src = url } });
  let url = await coverUrl(id); if(!url){ const b = await rcFetch(u); if(b){ try{ await setCover(id, b); url = await coverUrl(id) }catch(e){ LE('manga', 'cover not saved', e) } } }
  show(url || u) }
function rcFetch(u){ return RCQ.p[u] || (RCQ.p[u] = new Promise(ok => { RCQ.q.push({u, ok, n:0}); rcPump() }).then(b => { delete RCQ.p[u]; return b })) }
async function rcPump(){ if(RCQ.run >= 2) return; const j = RCQ.q.shift(); if(!j) return; RCQ.run++;
  try{ const t = await thumb(await cvImage(j.u), 240, .78); RCQ.ok++; j.ok(t) }
  catch(e){ if(++j.n < 3) setTimeout(() => { RCQ.q.push(j); rcPump() }, 1500 * j.n); else { RCQ.fail++; if(RCQ.fail <= 5) LE('manga', 'cover failed ' + j.u, e); j.ok(null) } }
  RCQ.run--; await sleep(120); if(RCQ.q.length) rcPump(); else if(!RCQ.run) L('manga', 'covers kept on the phone', {ok:RCQ.ok, failed:RCQ.fail}) }

/* ---------- covers on screen (filled in when they scroll into view) ---------- */
const covIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ covIO.unobserve(e.target); fillCov(e.target) } }, {rootMargin:'300px'}) : null;
function phHTML(b, label){ const h = hue((b.series || b.title || '') + b.shelf); return `<div class="ph" style="--c1:hsl(${h} 45% 28%);--c2:hsl(${(h + 40) % 360} 40% 14%)"><i>${esc((b.fmt || '').toUpperCase())}</i>${esc(label || dispTitle(b))}<span>${esc(b.writer || '')}</span></div>` }
function coverHTML(b, cls, extra){ return `<div class="cv ${cls || ''}" data-cov="${esc(b.id)}">${phHTML(b)}${extra || ''}</div>` }
async function fillCov(el){ const u = await coverUrl(el.dataset.cov); if(!u) return; const ph = el.querySelector('.ph'); if(ph) ph.remove(); el.querySelectorAll('img').forEach(i => i.remove()); el.insertAdjacentHTML('afterbegin', `<img class="b" src="${u}" alt=""><img class="f" src="${u}" alt="">`) }
function lazyCovers(root){ lazyRemote(root); (root || document).querySelectorAll('[data-cov]').forEach(el => { if(!COV.has(el.dataset.cov)) return; covIO ? covIO.observe(el) : fillCov(el) }) }
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
  return `<div class="bk stack" data-grp="${esc(g.key)}">${groupCoverHTML(sh, g)}${newBadge(grNew(g))}${G.isPinned('gr:' + g.key) ? PINB : ''}<span class="cdl">${(() => { const c = g.kind === 'series' && shelfOf(sh).fullSeries && COLS[grVid(g)]; return c ? (st => `${st.have} of ${st.total}`)(colStats(c)) : all.length ? plural(all.length, 'book') : 'empty' })()}</span>
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
  if(['col', 'colser', 'disc', 'cvser', 'arcs', 'arc'].includes(v.v)) $('#addbtn').hidden = true;
  $('#hubback').hidden = !(fromHub() && V.length < 2);
  let h = '';
  if(v.v === 'shelves'){ $('#vtitle').textContent = 'Bookcase'; document.title = 'Nightvault Bookcase';
    const last = BOOKS.filter(b => started(b) && !STATE[b.id].finished).sort((a, b) => STATE[b.id].last - STATE[a.id].last)[0];
    if(last) h += contCard(last, true);
    h += upNextHTML(null, last);
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
    if(showColTabs(s.id)) h += colTabs(s.id, 'books') + (s.fullSeries ? newBar(s.id) : '');
    h += `<input type="search" id="q" placeholder="Search ${esc(s.name.toLowerCase())}, series, writers" value="${esc(Q[s.id] || '')}" style="margin:2px 0 8px">`;
    if(q){ const {groups:gs} = groupsOf(s.id), where = {}; for(const g of gs) for(const b of g.items) where[b.id] = G.path(g, gs);
      const gm = gs.filter(g => norm(g.name).includes(q)).slice(0, 12), bm = all.filter(b => norm([b.title, b.series, b.writer, b.artist, b.name, publisherOf(b)].join(' ')).includes(q)).sort(seriesOrder);
      if(!gm.length && !bm.length) h += '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
      if(gm.length) h += `<div class="sec">Groups</div><div class="grid">${gm.map(g => groupTile(s.id, g).replace(/<div class="a">[^<]*<\/div>/, g.parent ? `<div class="a">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : '$&')).join('')}</div>`;
      if(bm.length) h += `<div class="sec">Books</div><div class="grid">${bm.slice(0, 300).map(b => bookTile(b).replace(/<div class="a">[^<]*<\/div>/, where[b.id] ? `<div class="a">in ${esc(where[b.id])}</div>` : '$&')).join('')}</div>` }
    else { const lastS = all.filter(b => started(b) && !STATE[b.id].finished).sort((a, b) => STATE[b.id].last - STATE[a.id].last)[0]; if(lastS && f === 'all') h += contCard(lastS); if(f === 'all') h += upNextHTML(s.id, lastS);
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
    body.innerHTML = h; lazyCovers(body); hookShelf(s); hookNew(s.id); return }
  if(v.v === 'group'){ const G = grOf(v.shelf), g = groupByKey(v.shelf, v.key); if(!g){ V.pop(); return draw() }
    const gs = groupsOf(v.shelf).groups, all = g.all, rd = all.filter(b => (STATE[b.id] || {}).finished).length, ord = all.slice().sort(seriesOrder);
    const nextB = ord.find(b => started(b) && !STATE[b.id].finished) || ord.find(b => !(STATE[b.id] || {}).finished);
    $('#vtitle').textContent = ''; document.title = g.name + ' · Bookcase';
    h += `<div class="alhead"><div class="stack" style="flex:none"><div class="gcv" style="width:min(30vw,130px)">${groupCoverHTML(v.shelf, g)}</div></div><div style="min-width:0;flex:1"><b>${esc(g.name)}</b>
      ${g.parent ? `<div class="lnk small" data-gotogrp="${esc(g.parent)}">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : ''}
      <div class="muted small">${esc(G.label(g))} · ${(g.kids || []).length ? plural(g.kids.length, 'group') + ' · ' : ''}${plural(all.length, 'book')}${rd ? ` · ${rd} read` : ''}</div>
      ${[...new Set(all.map(b => b.writer).filter(Boolean))].length === 1 ? `<div class="muted small">${esc(all.find(b => b.writer).writer)}</div>` : ''}</div></div>`;
    h += `<div class="mbar">${nextB ? `<button class="btn primary" data-read="${esc(nextB.id)}" style="flex:1;min-width:0"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${started(nextB) ? 'Continue' : 'Read'}: ${esc(g.kind === 'series' ? (nextB.vol || nextB.title) : dispTitle(nextB))}</span></button>` : ''}<button class="ib" id="gmenu" aria-label="More for this group">${IC_DOTS}</button></div>`;
    const full = g.kind === 'series' && shelfOf(v.shelf).fullSeries, fvid = full && grVid(g), fc = fvid && COLS[fvid];
    if(full && fc){ /* every issue of the series: yours in colour (tap = the comic), the others grey (tap = Find it / on paper) */
      const st = colStats(fc), f = S.filter['grp'] || 'all', d = colDigital(fc), P = fc.phys || {}, inList = new Set(fc.issues.map(i => numKey(i.num)));
      const pass = i => { const k = numKey(i.num), D = !!d[k], Pp = !!P[k]; return f === 'have' ? D || Pp : f === 'miss' ? !D && !Pp : true };
      h += `<div class="mtot">${esc(fc.name)}${fc.start ? ` (${esc(fc.start)})` : ''} · you have ${st.have} of ${st.total} <span class="muted">· ${SRC_NAME[srcOf(fc.vid)]}</span>${st.phys ? ` · ${st.phys} on paper` : ''}</div><div class="pbar" style="margin:0 0 8px"><i style="width:${st.total ? Math.round(100 * st.have / st.total) : 0}%"></i></div>`;
      h += infoHTML(fc);
      h += `<div class="chips">${[['all', 'All ' + W(v.shelf).is], ['have', 'I have'], ['miss', 'Missing']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-gif="${k}">${t}</button>`).join('')}<button class="chip" data-col="${fvid}">⋯ List</button></div>`;
      const kids = sortTiles(g.kids || [], 'title'); if(kids.length) h += `<div class="grid">${kids.map(x => groupTile(v.shelf, x)).join('')}</div>`;
      h += issueGridHTML(fc, pass);
      const extra = g.items.filter(b => b.num == null || !inList.has(numKey(b.num))).sort(seriesOrder);
      if(extra.length && f !== 'miss') h += `<div class="sec">Also in this group</div><div class="grid">${extra.map(bookTile).join('')}</div>`;
      body.innerHTML = h; lazyCovers(body); hookGrid(v.shelf); $('#gmenu').onclick = () => groupMenu(v.shelf, g);
      body.querySelectorAll('[data-gif]').forEach(b => b.onclick = () => { S.filter['grp'] = b.dataset.gif; saveS(); draw() });
      body.querySelectorAll('[data-iss]').forEach(el => el.onclick = () => { const b = d[el.dataset.iss]; if(b) go({v:'book', id:b.id}); else issueSheet(fc, fc.issues.find(i => numKey(i.num) === el.dataset.iss)) });
      return }
    if(full){ const st0 = SERLOAD[v.shelf + '|' + g.key];
      h += canLookOnline(v.shelf) ? `<div class="mtot" id="serload">${st0 === 'none' ? `This series was not found online by this name – open a ${W(v.shelf).c} → ⋯ → Look up online to pick it.` : st0 && st0.startsWith('err:') ? esc(st0.slice(4)) : `Looking up every ${W(v.shelf).i} of this series…`}</div>`
        : whyNoSource(v.shelf) === 'nokey' ? `<button class="btn" id="serkey" style="width:100%;margin-bottom:8px">See every issue of this series (needs your Comic Vine key)</button>` : `<div class="mtot">${esc(whyNoSource(v.shelf))}</div>` }
    h += `<div class="mbar">${sortSel('inside', 'grp:' + v.shelf + ':' + g.key)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button></div>`;
    const kids = sortTiles(g.kids || [], sortOf('inside', 'grp:' + v.shelf + ':' + g.key)), k = sortOf('inside', 'grp:' + v.shelf + ':' + g.key), items = k === 'series' ? g.items.slice().sort(seriesOrder) : sortTiles(g.items, k);
    h += `<div class="grid">${G.pinFirst([...kids, ...items], x => (x.items ? 'gr:' + x.key : 'it:' + x.id)).map(x => x.items ? groupTile(v.shelf, x) : bookTile(x)).join('')}</div>`;
    if(!all.length) h += `<p class="muted small" style="margin-top:12px">Empty. Tap ⋯ → <b>Add books…</b> to put books in it.</p>`;
    body.innerHTML = h; lazyCovers(body); hookGrid(v.shelf); $('#gmenu').onclick = () => groupMenu(v.shelf, g);
    if(full){ const k = $('#serkey'); if(k) k.onclick = () => cvKeySheet(() => serEnsure(v.shelf, g)); else if(!SERLOAD[v.shelf + '|' + g.key] && canLookOnline(v.shelf)) serEnsure(v.shelf, g) } return }
  if(v.v === 'book') return drawBook(v.id);
  if(v.v === 'col') return drawCol(v);
  if(v.v === 'colser') return drawColSer(v);
  if(v.v === 'disc') return drawDisc(v);
  if(v.v === 'cvser') return drawCvSer(v);
  if(v.v === 'arcs') return drawArcs(v);
  if(v.v === 'arc') return drawArc(v) }
function contCard(b, withShelf){ const s = STATE[b.id], p = progress(b);
  return `<div class="cont" data-read="${esc(b.id)}">${coverHTML(b)}<div style="flex:1;min-width:0"><small>CONTINUE READING${withShelf ? ' · ' + esc(shelfOf(b.shelf).name.toUpperCase()) : ''}</small><b>${esc(dispTitle(b))}</b>
    <div class="muted small">${b.fmt === 'epub' && s.flow ? Math.round(p * 100) + '%' : `Page ${s.page + 1} of ${s.pages || b.pages || '?'}`}</div><div class="pbar"><i style="width:${Math.round(p * 100)}%"></i></div></div></div>` }
function storeLine(sh){ const bs = sh ? inShelf(sh) : BOOKS, cp = bs.filter(b => b.src && b.src.kind === 'copy'), used = cp.reduce((a, b) => a + (b.size || 0), 0), ln = bs.length - cp.length;
  return bs.length ? `<div class="store">${plural(bs.length, 'book')}${ln ? ` · ${ln} read from phone folders` : ''}${cp.length ? ` · ${plural(cp.length, 'copy', 'copies')} in the app, ${mb(used)}` : ''}</div>` : '' }

/* clicks on the screens */
$('#body').addEventListener('click', e => {
  if(selSkip){ selSkip = false; return }
  const t = e.target, el = t.closest('[data-shelf],[data-book],[data-grp],[data-read],[data-filter],[data-selstart],[data-gotogrp],[data-tabgo],[data-col],[data-allis],#newshelf,#newgrp');
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
  if(el.dataset.selstart) return selStart();
  if(el.dataset.tabgo){ const t = el.dataset.tabgo; if(t === v.v) return; if(t === 'books'){ if(v.v === 'col' || v.v === 'arcs'){ V.pop(); draw() } return }
    if(v.v === 'col' || v.v === 'arcs'){ V[V.length - 1] = {v:t, shelf:v.shelf}; draw() } else go({v:t, shelf:v.shelf}); return }
  if(el.dataset.col) return go({v:'colser', shelf:v.shelf, vid:vidOf(el.dataset.col)});
  if(el.dataset.allis){ const vid = vidOf(el.dataset.allis), b = BOOKS.find(x => x.cv && x.cv.id === vid); if(COLS[vid]) return go({v:'colser', shelf:v.shelf, vid});
    colAdd(v.shelf, {id:vid, name:b.cv.name, start:b.cv.start, pub:b.cvPub || publisherOf(b)}).then(c => go({v:'colser', shelf:v.shelf, vid:c.vid})).catch(err => { closeSheet(); toast(err.message || String(err), 5000) }) } });
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
  const where = b.src.kind === 'link' ? 'In a folder on this phone' : b.src.kind === 'drive' ? 'On Google Drive' + (b.src.fid ? ' · downloaded to this phone' : '') : 'Copied into the app';
  const facts = [['Publisher', (() => { const x = pubSource(b); return x.p ? esc(x.p) + ({folder:' <span class="muted">· from the folder</span>', name:' <span class="muted">· from the file name</span>', online:' <span class="muted">· from Comic Vine</span>', series:' <span class="muted">· like the rest of this series</span>', guess:' <span class="muted">· guessed from the name – fix it with Edit details</span>'}[x.how] || '') : '' })()], ['Series', b.series ? `<span class="lnk" data-gotogrp2="1">${esc(b.series)}</span>${b.vol ? ' · ' + esc(b.vol) : ''}` : ''], ['Writer', esc(b.writer)], ['Artist', esc(b.artist)], ['Year', esc(b.year)],
    ['Pages', b.pages ? String(b.pages) : ''], ['Reading', b.rtl ? 'Right to left (manga)' : b.rtl === false ? 'Left to right' : ''], ['Online', b.cv ? esc(b.cv.name) + (b.cv.start ? ` (${b.cv.start})` : '') + ` <span class="muted">· ${SRC_NAME[srcOf(b.cv.id)]}</span>` : ''], ['File', `${esc((b.fmt || '').toUpperCase())}${b.size ? ' · ' + mb(b.size) : ''}`], ['Where', where + (b.dir ? ` · <span class="muted">${esc(b.dir)}</span>` : '')], ['Shelf', esc(sh.name)]].filter(x => x[1]);
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
    <button class="btn" id="bmcv">Look up online…</button><button class="btn" id="bmc">Change the cover</button><button class="btn" id="bmprint">Print…</button>
    ${b.src.kind === 'drive' ? `<button class="btn" id="bmdl">${b.src.fid ? 'Remove the downloaded copy' : 'Download to this phone (offline)'}</button>` : ''}
    <button class="btn danger" id="bmx">${b.src.kind === 'link' || b.src.kind === 'drive' ? 'Remove from Bookcase (the file stays)' : 'Remove from Bookcase'}</button></div>`);
  $('#bmg').onclick = () => groupPicker(b); $('#bms').onclick = () => shelfPicker([b.id]); $('#bme').onclick = () => editBook(b);
  $('#bmr').onclick = () => { const x = st(b.id); x.finished = !x.finished; if(x.finished){ x.last = x.last || Date.now(); x.page = Math.max(0, (x.pages || b.pages || 1) - 1) } else x.page = 0; saveState(b.id, true); closeSheet(); draw() };
  $('#bmp').onclick = () => { G.togglePin(['it:' + b.id], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  $('#bmcv').onclick = () => cvChoose(b);
  $('#bmc').onclick = () => coverSheet(b); $('#bmprint').onclick = () => { closeSheet(); printSheet(b) };
  if($('#bmdl')) $('#bmdl').onclick = () => { closeSheet(); b.src.fid ? driveUndownload([b]) : driveDownload([b]) };
  $('#bmx').onclick = () => removeBooks([b.id]) }
async function removeBooks(ids){ const bs = ids.map(id => BK[id]).filter(Boolean); if(!bs.length) return;
  const cp = bs.filter(b => b.src.kind === 'copy').length;
  if(!confirm(`Remove ${bs.length === 1 ? '“' + dispTitle(bs[0]) + '”' : plural(bs.length, 'book')} from Bookcase?${cp ? `\n\nThe ${cp === 1 ? 'copy' : cp + ' copies'} in the app will be deleted.` : ''}${bs.length - cp ? '\n\nFiles in phone folders stay where they are.' : ''}`)) return;
  for(const b of bs){ if(b.src.kind === 'drive' && b.src.fid) await dbDel('files', b.src.fid).catch(() => {});
    if(b.src.kind === 'copy'){ if(b.src.fid) await dbDel('files', b.src.fid).catch(() => {}); if(b.src.fids) await dbDelMany('files', b.src.fids.map(x => x.fid)).catch(() => {}) }
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
function selMore(){ const {sh, books} = selParts(), BS = () => books.map(id => BK[id]).filter(Boolean), G = grOf(sh), ids = [...SEL], allPinned = ids.every(x => G.isPinned(x));
  sheet(`<h3>${plural(ids.length, 'tile')} · ${plural(books.length, 'book')}</h3><div class="mlist"><button class="btn" id="smpin">${allPinned ? '★ Unpin' : '★ Pin to the top'}</button><button class="btn" id="smread">Mark as read</button><button class="btn" id="smunread">Mark as not read</button><button class="btn" id="smpub">Set the publisher…</button><button class="btn" id="smshelf">Move to another shelf…</button>${BS().some(b => b.src.kind === 'drive' && !b.src.fid && b.fmt !== 'imgs') ? `<button class="btn" id="smdl">Download to this phone (${mb(BS().filter(b => b.src.kind === 'drive' && !b.src.fid).reduce((a, b) => a + (b.size || 0), 0))})</button>` : ''}${BS().some(b => b.src.kind === 'drive' && b.src.fid) ? '<button class="btn" id="smundl">Remove the downloaded copies</button>' : ''}<button class="btn danger" id="smdel">Remove from Bookcase</button></div>`);
  if($('#smdl')) $('#smdl').onclick = () => { selEnd(true); driveDownload(BS()) }; if($('#smundl')) $('#smundl').onclick = () => { closeSheet(); selEnd(true); driveUndownload(BS()) };
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
  if((b.pages !== doc.n || b.later) && !b.handed){ b.pages = doc.n; if(b.later){ b.later = false; doc.page(0, 400).then(thumb).then(t => setCover(b.id, t)).catch(() => {}) } dbPut('books', b).catch(() => {}) }
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
  $('#reader').hidden = true; rp().innerHTML = ''; document.body.classList.remove('reading'); awake(false); if(!quiet){ if(r.b && r.b.handed) return leaveHanded(); draw() } }

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
async function closeEpub(){ if(!E) return; ePos(); saveState(E.b.id, true); for(const u of Object.values(E.res)) URL.revokeObjectURL(u); const handed = E.b.handed; E = null;
  if(handed){ $('#eframe').srcdoc = ''; $('#ereader').hidden = true; document.body.classList.remove('reading'); awake(false); return leaveHanded() } $('#eframe').srcdoc = ''; $('#ereader').hidden = true; document.body.classList.remove('reading'); awake(false); draw() }
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
    <div class="opt"><label for="ss_full">Show every ${W(sh).i} of a series, the ones you don't have grey (looked up online)</label><input type="checkbox" id="ss_full" ${s.fullSeries ? 'checked' : ''}></div>
    <div class="opt"><label for="ss_pub">Bundle series by publisher (Marvel › Spider-Man › …)</label><input type="checkbox" id="ss_pub" ${s.byPub ? 'checked' : ''}></div>
    <div class="opt"><label for="ss_aut">A writer's books without a series make one tile</label><input type="checkbox" id="ss_aut" ${s.authors ? 'checked' : ''}></div>
    ${NvFiles ? `<div class="sec">Folders on this phone</div>${folders.map((f, i) => /^gd:/.test(f.tree) ? '' : `<div class="li" style="cursor:default"><div class="n"><div>${esc(f.name)}</div><div class="s">${plural(inShelf(sh).filter(b => b.src.kind === 'link' && b.src.tree === f.tree).length, 'book')}</div></div><button class="btn sm" data-look="${i}">Look again</button><button class="btn sm danger" data-forget="${i}">Stop</button></div>`).join('') || '<p class="muted small">None yet - Add → Use a folder on this phone.</p>'}` : ''}
    ${folders.some(f => /^gd:/.test(f.tree)) ? `<div class="sec">Google Drive folders</div>${folders.map((f, i) => /^gd:/.test(f.tree) ? `<div class="li" style="cursor:default"><div class="n"><div>${esc(f.name)}</div><div class="s">${plural(inShelf(sh).filter(b => b.src.kind === 'drive' && b.src.tree === f.tree).length, 'book')} · ${inShelf(sh).filter(b => b.src.kind === 'drive' && b.src.tree === f.tree && b.src.fid).length} downloaded</div></div><button class="btn sm" data-look="${i}">Look again</button><button class="btn sm danger" data-forget="${i}">Stop</button></div>` : '').join('')}<button class="btn sm" id="ss_gdkey" style="margin-top:6px">Google key</button>` : ''}
    <div class="sec">Online</div><div class="opt"><label for="ss_kind">What is on this shelf</label><select id="ss_kind"><option value="comics" ${isManga(sh) ? '' : 'selected'}>Comics</option><option value="manga" ${isManga(sh) ? 'selected' : ''}>Manga</option></select></div>
    <div class="opt"><label for="ss_src">Where to look</label><select id="ss_src">${(isManga(sh) ? [['auto', 'MangaDex, then AniList'], ['mdx', 'Only MangaDex'], ['anl', 'Only AniList']] : [['auto', 'Comic Vine, then GCD, then Wikipedia'], ['cv', 'Only Comic Vine'], ['gcd', 'Only GCD (comics.org)'], ['wiki', 'Only Wikipedia (Dutch)']]).map(([k, t]) => `<option value="${k}" ${srcPref(sh) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${isManga(sh) ? `<div class="muted small" style="margin:-4px 0 8px">MangaDex has every volume cover of most manga, AniList has the story, writer and artist. Neither needs a key. Only official volumes are used – never chapter scans.</div><div class="mlist"><button class="btn primary" id="ss_cv">Look up the manga that are not looked up yet</button><button class="btn" id="ss_cvall">Look up all manga on this shelf</button><div class="muted small" style="margin:-2px 0 0">Once per series; the results are remembered. Needs the internet only while it looks.</div></div>` : `<div class="muted small" style="margin:-4px 0 8px">Comic Vine knows most American comics (needs your free key). GCD and Wikipedia also know Flemish and Dutch comics (Suske en Wiske, Jommeke, De Kiekeboes …) and need no key; GCD works in the Android app. The first one whose list holds all your numbers is used.</div><div class="mlist"><button class="btn primary" id="ss_cv">Look up the comics without a publisher</button><button class="btn" id="ss_cvall">Look up all comics on this shelf</button><button class="btn" id="ss_cvkey">${CV.key() ? 'Change your Comic Vine key' : 'Type your Comic Vine key'}</button><div class="muted small" style="margin:-2px 0 0">Once per series; the results are remembered. Needs the internet only while it looks.</div></div>`}
    <div class="mlist" style="margin-top:10px"><button class="btn" id="ss_reread">Read the details of all books again</button><div class="muted small" style="margin:-2px 0 0">Fills in what is missing (publisher, writer, year …). What you edited by hand stays.</div></div>
    <div class="sec">Your groups</div><div class="mlist"><button class="btn" id="ss_save">Save my groups</button><button class="btn" id="ss_load">Load from a file</button></div>
    <div class="sec">This shelf</div><div class="mlist"><button class="btn" id="ss_ren">Rename the shelf</button><button class="btn" id="ss_hide">Hide this shelf</button>${s.own ? `<button class="btn danger" id="ss_del">Remove this shelf${n ? ' (its books move to Books)' : ''}</button>` : ''}</div>`);
  $('#ss_rtl').onchange = e => { shelfSet(sh, {rtl:e.target.checked}); toast('Saved') };
  $('#ss_kind').onchange = e => { shelfSet(sh, e.target.value === 'manga' ? {kind:'manga', src:'auto', fullSeries:true} : {kind:'comics', src:'auto'}); for(const k in SERLOAD) if(k.startsWith(sh + '|')) delete SERLOAD[k]; regroup(); closeSheet(); shelfSettings(sh); draw() };
  $('#ss_src').onchange = e => { shelfSet(sh, {src:e.target.value}); for(const k in SERLOAD) if(k.startsWith(sh + '|')) delete SERLOAD[k]; toast('Saved') };
  $('#ss_full').onchange = e => { shelfSet(sh, {fullSeries:e.target.checked}); draw(); toast('Saved') };
  $('#ss_pub').onchange = e => { shelfSet(sh, {byPub:e.target.checked}); regroup(); draw(); toast(e.target.checked ? 'Series are now bundled by publisher' : 'Publisher tiles are off') };
  $('#ss_reread').onclick = () => { closeSheet(); rereadShelf(sh) };
  $('#ss_cv').onclick = () => cvLookup(sh, false); $('#ss_cvall').onclick = () => cvLookup(sh, true); if($('#ss_cvkey')) $('#ss_cvkey').onclick = () => cvKeySheet();
  $('#ss_aut').onchange = e => { shelfSet(sh, {authors:e.target.checked}); delete GRS[sh]; regroup(); draw(); toast('Saved') };
  $('.sheet').addEventListener('click', async e => { const lk = e.target.closest('[data-look]'), fg = e.target.closest('[data-forget]');
    if(lk){ closeSheet(); lookAgain(folders[+lk.dataset.look]) }
    if(fg){ const f = folders[+fg.dataset.forget], bs = inShelf(sh).filter(b => (b.src.kind === 'link' || b.src.kind === 'drive') && b.src.tree === f.tree);
      if(!confirm(`Stop using “${f.name}” for ${s.name}?${bs.length ? `\n\nIts ${plural(bs.length, 'book')} leave Bookcase (the files stay ${/^gd:/.test(f.tree) ? 'on Google Drive; downloaded copies are deleted' : 'on the phone'}).` : ''}`)) return;
      for(const b of bs) if(b.src.fid) await dbDel('files', b.src.fid).catch(() => {});
      await dbDelMany('books', bs.map(b => b.id)); const g = new Set(bs.map(b => b.id)); BOOKS = BOOKS.filter(b => !g.has(b.id)); for(const id of g) delete BK[id]; regroup();
      lsSet('nvBooks.folders', lsGet('nvBooks.folders', []).filter(x => !(x.tree === f.tree && x.shelf === sh)));
      if(NvFiles && NvFiles.forget && !/^gd:/.test(f.tree) && !lsGet('nvBooks.folders', []).some(x => x.tree === f.tree)) NvFiles.forget({tree:f.tree}).catch(() => {});
      closeSheet(); draw(); toast('Folder removed') } });
  if($('#ss_gdkey')) $('#ss_gdkey').onclick = () => driveKeySheet();
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
    <div class="sec">Find it</div><div class="mlist"><button class="btn" id="as_sites">Where to look for a book (${sites().length})</button></div>
    <div class="sec">Space</div><p class="muted small" id="as_space">…</p>
    <p class="muted small">Problems? Switch on <b>Debug mode</b> at the bottom of The Nightvault and send the log.</p>`);
  (async () => { try{ const e = await navigator.storage.estimate(), cp = BOOKS.filter(b => b.src.kind === 'copy'); $('#as_space').textContent = `${plural(BOOKS.length, 'book')} · ${plural(cp.length, 'copy', 'copies')} in the app (${mb(cp.reduce((a, b) => a + (b.size || 0), 0))}) · ${mb(Math.max(0, e.quota - e.usage))} free for the app` }catch(e){ $('#as_space').textContent = plural(BOOKS.length, 'book') } })();
  $('.sheet').addEventListener('click', e => { const u = e.target.closest('[data-up]'), ey = e.target.closest('[data-eye]');
    if(u){ const ids = shelves(true).map(s => s.id), i = +u.dataset.up; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; const own = lsGet('nvBooks.shelves', {}); own._order = ids; lsSet('nvBooks.shelves', own); appSettings(); draw() }
    if(ey){ const s = shelfOf(ey.dataset.eye); shelfSet(s.id, {hidden:!s.hidden}); appSettings(); draw() } });
  $('#as_new').onclick = () => newShelf(); $('#as_sites').onclick = () => sitesSheet() }
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
  if(/^board:/.test(P.get('open') || '')){ draw(); try{ await openHanded(P.get('open').slice(6)) }catch(e){ LE('handed', 'could not open', e); toast(e.message || String(e), 5000); setTimeout(leaveHanded, 2500) } return }
  if(sh && shelves(true).some(s => s.id === sh)) V.push({v:'shelf', shelf:sh});
  draw(); L('start', `${BOOKS.length} books`);
  setTimeout(() => { checkNew(false, true).catch(e => LE('new', 'daily check', e)) }, 4000);
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
async function cvImage(url){ const H = cvHttp(); if(H){ const r = await H.get({url, headers:{'User-Agent':UA, Accept:'image/*'}, responseType:'blob'}); const bin = atob(String(r.data).replace(/^data:[^,]*,/, '')), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type:'image/jpeg'}) }
  return (await fetch(url)).blob() }
async function cvApply(books, hit, withIssues){ if(!hit || !hit.id) return 0; let n = 0, iss = null;
  if(withIssues && srcOf(hit.id) === 'cv' && books.some(b => !b.desc || !COV.has(b.id) || !b.year)) try{ iss = await cvIssues(hit.id) }catch(e){ if(e.limit) throw e; LE('cv', 'issues', e) }
  const L = srcOf(hit.id) !== 'cv' && LISTS[hit.id], byN = {}; if(L) for(const x of L) byN[numKey(x.num)] = {year:x.date.slice(0, 4), img:x.img};
  let inf = null; if(isManga(books[0].shelf) && srcOf(hit.id) !== 'cv') try{ inf = await mangaInfo(hit.id) }catch(e){ if(e.limit) throw e; LE('manga', 'details', e) }
  for(const b of books){ b.cv = {id:hit.id, name:hit.name, start:hit.start, src:srcOf(hit.id)}; if(hit.pub) b.cvPub = hit.pub;
    if(inf){ if(!b.writer && inf.authors.length) b.writer = inf.authors.join(', '); if(!b.artist && inf.artists.length && inf.artists.join() !== inf.authors.join()) b.artist = inf.artists.join(', '); if(!b.desc && inf.desc) b.desc = inf.desc.slice(0, 1200) }
    const i = b.num == null ? null : iss ? iss[b.num] : byN[numKey(b.num)];
    if(i){ if(!b.desc && i.desc) b.desc = i.desc; if(!b.year && i.year) b.year = i.year; if(!COV.has(b.id) && i.img) try{ await setCover(b.id, await thumb(await cvImage(i.img))) }catch(e){} }
    await dbPut('books', b); n++ }
  return n }
/* shelf ⚙ / after adding: look up the comics that have no publisher (or all of them) */
async function cvLookup(sh, all){
  if(!canLookOnline(sh)){ if(whyNoSource(sh) === 'nokey') return cvKeySheet(() => cvLookup(sh, all)); toast(whyNoSource(sh), 5000); return }
  const want = inShelf(sh).filter(b => isManga(sh) ? all || !b.cv : all || !pubSource(b).p || pubSource(b).how === 'guess'), bySeries = {};
  for(const b of want) if(cvName(b)) (bySeries[cvKeyOf(b)] = bySeries[cvKeyOf(b)] || []).push(b);
  const list = Object.values(bySeries); if(!list.length){ toast('Nothing to look up'); return }
  awake(true); let stop = false, done = 0, found = 0, books = 0; const lines = [];
  sheet(`<h3>Looking up online…</h3><div class="prog"><i id="cvp"></i></div><div class="muted small" id="cvs">0 of ${plural(list.length, 'series', 'series')}</div><div id="cvl" class="small" style="max-height:34vh;overflow:auto;margin-top:6px"></div><button class="btn" id="cvstop" style="width:100%;margin-top:8px">Stop</button>`, true);
  $('#cvstop').onclick = () => { stop = true; $('#cvstop').textContent = 'Stopping…' };
  for(const bs of list){ if(stop) break;
    try{ const hit = await findSeries(sh, bs, all); if(hit.id){ found++; books += await cvApply(bs, hit, true); if(isManga(sh) && !COLS[hit.id]) try{ await colAdd(sh, {id:hit.id, name:hit.name, start:hit.start, pub:hit.pub || publisherOf(bs[0])}, true) }catch(e){ if(e.limit) throw e; LE('manga', 'list ' + hit.name, e) } } lines.unshift(`${esc(cvName(bs[0]))} → ${hit.id ? `${hit.pub ? `<b>${esc(hit.pub)}</b> · ` : isManga(sh) ? '' : '<b>?</b> · '}${esc(hit.name)}${hit.start ? ` (${hit.start})` : ''} <span class="muted">· ${SRC_NAME[srcOf(hit.id)]}</span>` : '<span class="muted">not found</span>'}`) }
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
/* search one source by hand: rows to tap (book ⋯ → Look up online, and + Add a series). books = your comics of that series (or []) */
async function srcSearch(src, q, books){ const th = u => u ? `<img class="f" src="${esc(u)}" alt="" style="object-fit:cover">` : '';
  if(src === 'mdx') return mdxRows(q, books); if(src === 'anl') return anlRows(q, books);
  if(src === 'cv'){ const j = await cvGet('search', {resources:'volume', query:q, limit:40, field_list:'id,name,start_year,publisher,count_of_issues,image'});
    const l = books.length ? cvPick(j.results || [], books).map(x => x.v) : (j.results || []).sort((a, b) => (b.count_of_issues || 0) - (a.count_of_issues || 0));
    return l.map(v => ({key:v.id, name:v.name, start:v.start_year, pub:cleanPub(v.publisher && v.publisher.name), thumb:th(v.image && v.image.thumb_url), sub:`${esc(cleanPub(v.publisher && v.publisher.name) || '?')} · ${plural(v.count_of_issues || 0, 'issue')}`,
      hit:async () => ({id:v.id, name:v.name, start:v.start_year, pub:v.publisher && v.publisher.name, n:v.count_of_issues, at:Date.now()})})) }
  if(src === 'gcd'){ const res = await gcdSearch(q), l = books.length ? gcdPick(res, books) : res.map(s => ({s, list:gcdIssueList(s)})).filter(x => x.list.length).sort((a, b) => b.list.length - a.list.length);
    return l.slice(0, 40).map(({s, list}) => ({key:'g' + s.id, name:s.name, start:s.year_began, thumb:'', sub:`${esc([String(s.country || '').toUpperCase(), s.language].filter(Boolean).join(' · '))} · ${s.year_began || '?'}–${s.year_ended || 'now'} · ${plural(list.length, 'album')}${books.length ? ` · you have ${Math.round(covOf(list, books) * books.filter(b => b.num != null).length)} of them` : ''}`,
      hit:() => gcdHit(s, list, books)})) }
  const pages = await wikiFind(q); return pages.map(p => ({key:'w' + p.id, name:p.name, start:'', thumb:'', sub:esc(p.title), hit:async () => { const pg = await wikiPage(p.id); if(pg.list.length < 5) throw new Error('No numbered album list found on that page'); return wikiHit(pg, books) }})) }
function srcChips(on, sh){ return `<div class="chips" id="srcch">${KIND_SRCS[kindOf(sh)].map(k => `<button class="chip ${on === k ? 'on' : ''}" data-src="${k}">${SRC_NAME[k]}</button>`).join('')}</div>` }
const firstSrc = sh => srcPref(sh) !== 'auto' ? srcPref(sh) : isManga(sh) ? 'mdx' : CV.key() ? 'cv' : canGcd() ? 'gcd' : 'wiki';
/* book ⋯ → "Look up online…": pick the right series yourself (for the whole series of this book), in Comic Vine, GCD or Wikipedia */
async function cvChoose(b){
  const bs = inShelf(b.shelf).filter(x => cvName(x) && norm(cvName(x)) === norm(cvName(b))); let src = firstSrc(b.shelf), rows = [];
  sheet(`<h3>Look up “${esc(cvName(b))}”</h3>${srcChips(src, b.shelf)}<div style="display:flex;gap:8px"><input type="search" id="cvq" value="${esc(cvName(b))}"><button class="btn primary" id="cvgo">Search</button></div><div class="muted small" id="cvst" style="margin:8px 0">Searching…</div><div id="cvres"></div><button class="btn" style="width:100%;margin-top:10px" onclick="closeSheet()">Close</button>`);
  const run = async () => { $('#cvst').textContent = 'Searching…'; $('#cvres').innerHTML = ''; const me = src;
    if(src === 'cv' && !CV.key()){ $('#cvst').innerHTML = 'Comic Vine needs your free key. <button class="btn sm" id="cvk2">Type it</button>'; $('#cvk2').onclick = () => cvKeySheet(() => cvChoose(b)); return }
    if(src === 'gcd' && !canGcd()){ $('#cvst').textContent = 'GCD (comics.org) can only be reached from the Nightvault Android app'; return }
    try{ rows = await srcSearch(src, $('#cvq').value.trim(), bs); if(me !== src) return;
      $('#cvst').textContent = rows.length ? `Tap the right one – it is used for ${plural(bs.length, 'book')} of this series` : 'Nothing found - try other words';
      $('#cvres').innerHTML = rows.slice(0, 15).map((r, n) => `<div class="li" data-cvr="${n}"><span class="th"><div class="cv">${r.thumb}</div></span><div class="n"><div>${esc(r.name)}${r.start ? ` (${esc(r.start)})` : ''}</div><div class="s">${r.sub}</div></div></div>`).join('') }
    catch(e){ $('#cvst').textContent = e.message || String(e) } };
  $('#cvres').onclick = async e => { const r = e.target.closest('[data-cvr]'); if(!r) return; $('#cvst').textContent = 'Saving…';
    try{ const hit = await rows[+r.dataset.cvr].hit(), c = CV.cache(); c['pick:' + cvKeyOf(b)] = hit; if(srcOf(hit.id) === 'cv') c[cvKeyOf(b)] = hit; CV.save(c);
      await cvApply(bs, hit, true); for(const k in SERLOAD) if(k.startsWith(b.shelf + '|')) delete SERLOAD[k];
      regroup(); closeSheet(); draw(); toast(`${plural(bs.length, 'book')}: ${hit.pub || '?'} · ${hit.name} (${hit.start || '?'}) · ${SRC_NAME[srcOf(hit.id)]}`, 4000) }
    catch(err){ $('#cvst').textContent = err.message || String(err) } };
  $('#srcch').onclick = e => { const c = e.target.closest('[data-src]'); if(!c) return; src = c.dataset.src; $('#srcch').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); run() };
  $('#cvgo').onclick = run; $('#cvq').onkeydown = e => { if(e.key === 'Enter') run() }; run() }

/* =====================================================================================================================
   MORE SOURCES (owner, 20 Oct: "Flemish and Dutch comics, to fill in the blanks like Comic Vine")
   GCD – Grand Comics Database (comics.org, free, no key). Very good for Belgian and Dutch albums: ONE search returns the series with
     every album number and title. GCD sends no CORS headers → only from the Android app (CapacitorHttp). Polite: one request every
     3.2 s (GCD allows 20 a minute, 200 an hour). Covers: one extra request, only when you open a missing album.
   Wikipedia NL – the "Lijst van albums van …" pages: the complete numbered list of big series (Suske en Wiske = the Vierkleurenreeks
     numbers on the cover, Jommeke, De Kiekeboes, Nero, De Rode Ridder, Urbanus …). Works from any browser.
   Ids: Comic Vine = a number, GCD = 'g<series id>', Wikipedia = 'w<page id>'. A book's b.cv = {id, name, start, src}.
   Shelf ⚙ → "Where to look": auto (Comic Vine, then GCD, then Wikipedia – the first whose list holds all your numbers wins) or one of them.
   ===================================================================================================================== */
const srcOf = id => /^g/.test(String(id)) ? 'gcd' : /^w/.test(String(id)) ? 'wiki' : /^m/.test(String(id)) ? 'mdx' : /^a\d/.test(String(id)) ? 'anl' : 'cv';
const SRC_NAME = {cv:'Comic Vine', gcd:'GCD', wiki:'Wikipedia', mdx:'MangaDex', anl:'AniList'};
const vidOf = s => /^\d+$/.test(String(s)) ? +s : String(s);
const UA = 'NightvaultBookcase/1.0 (personal app; github.com/brokeuh)';
const LISTS = {};   // id → issues, while the app is open (saves asking twice)
const GCD = {last:0, q:Promise.resolve()}, WIKI = {last:0, q:Promise.resolve()}, BLOCK = {};
function polite(who, gap, fn){ const run = who.q.then(async () => { const w = who.last + gap - Date.now(); if(w > 0) await sleep(w); who.last = Date.now(); return fn() }); who.q = run.catch(() => {}); return run }
const canGcd = () => !!cvHttp();
async function gcdGet(url){ if(!/format=json/.test(url)) url += (url.includes('?') ? '&' : '?') + 'format=json';
  return polite(GCD, 3200, async () => { const H = cvHttp(); if(!H) throw Object.assign(new Error('GCD (comics.org) can only be reached from the Nightvault Android app'), {noweb:true});
    const r = await H.get({url, headers:{Accept:'application/json', 'User-Agent':UA}, responseType:'json'});
    if(r.status === 429) throw Object.assign(new Error('GCD says: too many requests – try again in an hour'), {limit:true});
    if(r.status === 404) return null; if(r.status >= 400) throw new Error('GCD answered ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data }) }
async function wikiGet(params){ const url = 'https://nl.wikipedia.org/w/api.php?' + new URLSearchParams(Object.assign({format:'json', origin:'*', formatversion:'2'}, params));
  return polite(WIKI, 1000, async () => { let r; try{ r = await fetch(url) }catch(e){ throw new Error('Wikipedia could not be reached – no internet?') }
    if(r.status === 429) throw Object.assign(new Error('Wikipedia says: too many requests – try again later'), {limit:true});
    if(!r.ok) throw new Error('Wikipedia answered ' + r.status); return r.json() }) }

/* GCD: "1 - De Wollebollen", "1 - De Wollebollen [Herdruk 1991]", "1 [kleur] - …", "190A - …": one entry per album number (reprints left out) */
function gcdIssueList(s){ const out = [], seen = new Set(), u = s.active_issues || [];
  (s.issue_descriptors || []).forEach((t, i) => { const m = String(t).match(/^\s*(\d+(?:[.,]\d+)?)[A-Za-z]?\s*(?:\[[^\]]*\]\s*)?(?:-\s*(.*))?$/); if(!m) return;
    const num = parseFloat(m[1].replace(',', '.')), k = numKey(num); if(seen.has(k)) return; seen.add(k);
    const gid = (String(u[i] || '').match(/issue\/(\d+)/) || [])[1] || '';
    out.push({num, label:'#' + m[1], name:String(m[2] || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim(), date:'', img:'', thumb:'', gid}) });
  return oddOut(out.sort((a, b) => a.num - b.num)) }
/* a typing error far past the end ("#8134" after #384) */
const oddOut = l => { while(l.length > 3 && l[l.length - 1].num > 2 * l[l.length - 2].num + 10) l.pop(); return l };
const gcdId = s => (String(s.api_url || '').match(/series\/(\d+)/) || [])[1];
async function gcdSearch(name){ return discCache('gcds:' + norm(name), 7 * 864e5, async () => { const out = []; let url = `https://www.comics.org/api/series/name/${encodeURIComponent(name)}/`;
    for(let p = 0; url && p < 3; p++){ const j = await gcdGet(url); if(!j) break;
      for(const s of j.results || []) out.push({id:gcdId(s), name:s.name, country:s.country, language:s.language, year_began:s.year_began, year_ended:s.year_ended, publisher:s.publisher, issue_descriptors:s.issue_descriptors, active_issues:s.active_issues});
      url = j.next }
    return out }) }
async function gcdPubName(url){ const id = (String(url || '').match(/publisher\/(\d+)/) || [])[1]; if(!id) return ''; const c = lsGet('nvBooks.gcdPub', {}); if(c[id]) return c[id];
  try{ const j = await gcdGet(`https://www.comics.org/api/publisher/${id}/`); if(j && j.name){ c[id] = j.name; lsSet('nvBooks.gcdPub', c); return j.name } }catch(e){ if(e.limit) throw e } return '' }
const covOf = (list, books) => { const nums = books.map(b => b.num).filter(n => n != null); if(!nums.length) return 0; const h = new Set(list.map(i => numKey(i.num))); return nums.filter(n => h.has(numKey(n))).length / nums.length };
const bare = s => norm(s).replace(/^(de|het|the|les?|la) /, '');
function gcdPick(results, books){ const name = norm(cvName(books[0])), years = books.map(b => +b.year).filter(Boolean), y = years.length ? Math.min(...years) : 0;
  return results.map(s => { const vn = norm(s.name); let sc = vn === name ? 60 : bare(vn) === bare(name) ? 55 : vn.includes(bare(name)) ? 15 : 0;
      if(s.language === 'nl') sc += 15; if(s.country === 'be' || s.country === 'nl') sc += 5;
      const list = gcdIssueList(s), cov = covOf(list, books); sc += Math.round(cov * 30) + Math.min(10, list.length / 20);
      if(y && s.year_began && s.year_began > y + 1) sc -= 20;
      return {s, sc, cov, list} }).filter(x => x.list.length).sort((a, b) => b.sc - a.sc) }
async function gcdHit(s, list, books){ LISTS['g' + s.id] = list;
  return {id:'g' + s.id, name:s.name, start:s.year_began || '', pub:await gcdPubName(s.publisher), n:list.length, cov:books ? covOf(list, books) : 0, src:'gcd', at:Date.now()} }
async function gcdSeries(books, force){ const k = 'gcd:' + cvKeyOf(books[0]), c = CV.cache(); if(!force && c[k] && (c[k].id || Date.now() - c[k].at < 14 * 864e5)) return c[k];
  const best = gcdPick(await gcdSearch(cvName(books[0])), books)[0];
  const hit = best && best.sc >= 50 ? await gcdHit(best.s, best.list, books) : {id:0, at:Date.now()};
  const c2 = CV.cache(); c2[k] = hit; CV.save(c2); return hit }
async function gcdCover(c, i){ if(i.img || !i.gid || !canGcd()) return false; const j = await gcdGet(`https://www.comics.org/api/issue/${i.gid}/`); if(!j) return false;
  i.img = i.thumb = j.cover || ''; i.date = i.date || j.publication_date || ''; if(!i.name && j.title) i.name = j.title; i.gcdDone = 1; if(c && c.id) await colSave(c); return !!i.img }

/* Wikipedia: the numbered album list in a "Lijst van albums van …" page – tables (Nummer / VK | Titel | Datum) or "# [[Title]]" lists */
const wikiClean = t => String(t || '').replace(/<ref[^>]*\/>|<ref[^]*?<\/ref>/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\S+\s([^\]]*)\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/^[\s*°†#]+/, '').replace(/\s+/g, ' ').trim();
function wikiCell(c){ let d = 0, cut = -1; const s = String(c);   // drop 'style="…"|' in front of a cell, but not the | inside [[a|b]]
  for(let i = 0; i < s.length; i++){ const two = s.substr(i, 2); if(two === '[[' || two === '{{'){ d++; i++ } else if(two === ']]' || two === '}}'){ d--; i++ } else if(s[i] === '|' && !d){ cut = i; break } }
  return wikiClean(cut >= 0 && /=/.test(s.slice(0, cut)) ? s.slice(cut + 1) : s) }
function wikiSplit(line, sep){ const out = []; let d = 0, cur = '';   // split "a || b" but not inside [[ ]] / {{ }}
  for(let i = 0; i < line.length; i++){ const two = line.substr(i, 2);
    if(two === '[[' || two === '{{'){ d++; cur += two; i++; continue } if(two === ']]' || two === '}}'){ d--; cur += two; i++; continue }
    if(!d && two === sep){ out.push(cur); cur = ''; i++; continue } cur += line[i] }
  out.push(cur); return out }
function wikiAlbums(text){ const blocks = []; text = String(text || '').replace(/inhoud\s*=\s*#/g, 'inhoud=\n#');
  for(const m of text.matchAll(/\{\|[^]*?\n\|\}/g)){ const rows = m[0].replace(/^\{\|[^\n]*/, '').split(/\n\|-[^\n]*/); let head = null; const ent = [];
    for(const r of rows){ const cells = []; let isHead = false;
      for(const ln of r.split('\n')){ const l = ln.trim(); if(!l) continue;
        if(l[0] === '!'){ isHead = true; wikiSplit(l.slice(1), '!!').forEach(x => cells.push(wikiCell(x))) }
        else if(l[0] === '|' && l[1] !== '}'){ wikiSplit(l.slice(1), '||').forEach(x => cells.push(wikiCell(x))) }
        else if(cells.length) cells[cells.length - 1] += ' ' + wikiClean(l) }
      if(!cells.length) continue;
      if(isHead || cells.some(x => /^(nr\.?|nummer|titel|no\.?)$/i.test(x))){ if(cells.some(x => /^(nr\.?|nummer|titel|no\.?|vk)$/i.test(x))) head = cells; continue }
      if(!head) continue;
      const ix = re => head.findIndex(x => re.test(x)), nc = ix(/^vk$/i) >= 0 ? ix(/^vk$/i) : Math.max(0, ix(/^(nr\.?|nummer|no\.?|#)$/i)),
        tc = ix(/titel|verhaal|album/i) >= 0 ? ix(/titel|verhaal|album/i) : nc + 1, yc = ix(/datum|jaar|druk|uitgave|verschen|^van$/i);
      const mm = String(cells[nc] || '').match(/^\d+(?:[.,]\d+)?/), n = mm ? parseFloat(mm[0].replace(',', '.')) : NaN, t = cells[tc] || '';
      if(isNaN(n) || !t) continue; ent.push({num:n, name:t, date:((yc >= 0 && cells[yc] || '').match(/\b(1[89]|20)\d\d\b/) || [''])[0]}) }
    if(ent.length) blocks.push({table:true, ent}) }
  let run = null;   // "# [[Title]]" lists (numbered 1, 2, 3 … by MediaWiki)
  for(const ln of text.replace(/\{\|[^]*?\n\|\}/g, '').split('\n')){ const m = ln.match(/^#(?![#*:])\s*(.*)$/);
    if(m){ if(!run) blocks.push(run = {table:false, ent:[], n:0}); run.n++; const t = wikiClean(m[1]).replace(/\s*\(\d{4}\)\s*$/, ''); if(t) run.ent.push({num:run.n, name:t.replace(/\}+\s*$/, '').trim(), date:(m[1].match(/\((\d{4})\)/) || [''])[1] || ''}) }
    else if(ln.trim()) run = null }
  const good = blocks.filter(b => b.ent.length >= 5).sort((a, b) => b.ent.length - a.ent.length); if(!good.length) return [];
  const out = good[0].ent.slice(), have = new Set(out.map(e => numKey(e.num)));
  for(const b of good.slice(1)) if(b.table && good[0].table && !b.ent.some(e => have.has(numKey(e.num)))){ out.push(...b.ent); b.ent.forEach(e => have.add(numKey(e.num))) }  // Nero: one table per newspaper, the numbers go on
  const seen = new Set(); return out.filter(e => !seen.has(numKey(e.num)) && seen.add(numKey(e.num))).sort((a, b) => a.num - b.num)
    .map(e => ({num:e.num, label:'#' + e.num, name:e.name, date:e.date, img:'', thumb:''})) }
const wikiSerName = t => String(t).replace(/^lijst van (de )?(albums|verhalen|stripalbums|stripverhalen|delen)( van| uit)? /i, '').replace(/\s*\(.*\)\s*$/, '');
async function wikiFind(name){ return discCache('wikis:' + norm(name), 14 * 864e5, async () => {
    const j = await wikiGet({action:'query', list:'search', srsearch:'intitle:lijst ' + name, srlimit:15, srnamespace:0});
    return ((j.query || {}).search || []).filter(r => /^lijst van (de )?(albums|verhalen|stripalbums|stripverhalen|delen)/i.test(r.title)).map(r => ({id:r.pageid, title:r.title, name:wikiSerName(r.title)})) }) }
async function wikiPage(pageid){ return discCache('wikip:' + pageid, 14 * 864e5, async () => {
    const j = await wikiGet({action:'parse', pageid, prop:'wikitext', redirects:1}); const p = j.parse || {};
    if(!p.wikitext) throw new Error('Wikipedia: that page is gone'); return {id:p.pageid, title:p.title, name:wikiSerName(p.title), list:wikiAlbums(typeof p.wikitext === 'string' ? p.wikitext : p.wikitext['*'])} }) }
function wikiHit(pg, books){ LISTS['w' + pg.id] = pg.list; return {id:'w' + pg.id, name:pg.name, start:(pg.list.find(i => i.date) || {}).date || '', pub:'', n:pg.list.length, cov:books ? covOf(pg.list, books) : 0, src:'wiki', at:Date.now()} }
async function wikiSeries(books, force){ const k = 'wiki:' + cvKeyOf(books[0]), c = CV.cache(); if(!force && c[k] && (c[k].id || Date.now() - c[k].at < 14 * 864e5)) return c[k];
  const name = bare(cvName(books[0])), cands = (await wikiFind(cvName(books[0]))).filter(p => bare(p.name) === name || bare(p.name).includes(name) || name.includes(bare(p.name)));
  let best = null; for(const p of cands.slice(0, 2)){ const pg = await wikiPage(p.id); if(pg.list.length < 5) continue; const h = wikiHit(pg, books); if(!best || h.cov > best.cov) best = h; if(h.cov >= 1) break }
  const hit = best || {id:0, at:Date.now()}, c2 = CV.cache(); c2[k] = hit; CV.save(c2); return hit }

/* =====================================================================================================================
   MANGA (owner, 21 Oct: "manga get what comics already have") – MangaDex + AniList, no key, both let web pages ask (CORS ok, checked 21 Oct).
   MangaDex (api.mangadex.org): search (`manga?title=`, with the cover) → `cover?manga[]=<id>` = one picture per VOLUME with its volume number
     (100 per request) → the volume grid; pictures at uploads.mangadex.org/covers/<id>/<file>.256.jpg (.512.jpg for the big one).
     Polite: one request every 0.35 s (limit 5 a second). Only official volume covers – chapters / scan pages are never asked.
   AniList (graphql.anilist.co): story, writer / artist, genres, status, number of volumes, score. MangaDex's `links.al` is the AniList id.
     Polite: one request every 2.2 s (limit 30 a minute). A series AniList knows the volumes of can be a list by itself (id 'a<id>').
   Ids: MangaDex = 'm<uuid>', AniList = 'a<number>' (next to Comic Vine = number, GCD = 'g…', Wikipedia = 'w…'). b.cv = {id, name, start, src}.
   The series details are kept inside the collection list (c.info) and cached in kv 'disc:mxi:<id>'.
   ===================================================================================================================== */
const MDX = {last:0, q:Promise.resolve()}, ANL = {last:0, q:Promise.resolve()};
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const MSTAT = {FINISHED:'Finished', RELEASING:'Ongoing', NOT_YET_RELEASED:'Not out yet', CANCELLED:'Cancelled', HIATUS:'On hiatus', completed:'Finished', ongoing:'Ongoing', hiatus:'On hiatus', cancelled:'Cancelled'};
async function mdxGet(path, params){ const qs = new URLSearchParams(); for(const [k, v] of (params || [])) qs.append(k, v);
  const url = 'https://api.mangadex.org/' + path + (params && params.length ? '?' + qs : '');
  return polite(MDX, 350, async () => { let r; try{ r = await fetch(url, {headers:{Accept:'application/json'}}) }catch(e){ LE('manga', 'MangaDex fetch ' + path, e); throw new Error('MangaDex could not be reached from this network – a work or school wifi often blocks it, try mobile data') }
    if(r.status === 429) throw Object.assign(new Error('MangaDex says: too many requests – try again in a few minutes'), {limit:true});
    if(r.status === 404) return null; if(!r.ok) throw new Error('MangaDex answered ' + r.status); return r.json() }) }
async function anlGet(query, variables){
  return polite(ANL, 2200, async () => { let r; try{ r = await fetch('https://graphql.anilist.co', {method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json'}, body:JSON.stringify({query, variables})}) }catch(e){ LE('manga', 'AniList fetch', e); throw new Error('AniList could not be reached from this network – a work or school wifi may block it, try mobile data') }
    if(r.status === 429) throw Object.assign(new Error('AniList says: too many requests – try again in a minute'), {limit:true});
    if(r.status === 404) return null; let j = null; try{ j = await r.json() }catch(e){}
    if(!r.ok || !j) throw new Error('AniList answered ' + r.status); if(j.errors && !j.data) throw new Error('AniList: ' + ((j.errors[0] || {}).message || 'error')); return j.data }) }

/* ---- MangaDex ---- */
const mdxName = m => { const t = m.attributes.title || {}; return t.en || t['ja-ro'] || Object.values(t)[0] || ((m.attributes.altTitles || []).map(x => x.en).find(Boolean)) || '?' };
const mdxAllNames = m => [...Object.values(m.attributes.title || {}), ...(m.attributes.altTitles || []).flatMap(o => Object.values(o))].filter(x => typeof x === 'string');
function mdxCover(m, size){ const r = (m.relationships || []).find(x => x.type === 'cover_art'), f = r && r.attributes && r.attributes.fileName; return f ? `https://uploads.mangadex.org/covers/${m.id}/${f}${size ? '.' + size + '.jpg' : ''}` : '' }
function mdxNorm(m){ const a = m.attributes || {}, rel = m.relationships || [], who = t => [...new Set(rel.filter(x => x.type === t && x.attributes && x.attributes.name).map(x => x.attributes.name))];
  const tg = (a.tags || []).map(t => ({g:t.attributes && t.attributes.group, n:t.attributes && t.attributes.name && t.attributes.name.en || ''})), has = n => tg.some(t => t.n === n), d = a.description || {};
  return {id:m.id, name:mdxName(m), names:mdxAllNames(m).slice(0, 60), year:a.year || '', status:a.status || '', last:parseFloat(a.lastVolume) || 0, al:String((a.links || {}).al || ''), mal:String((a.links || {}).mal || ''), demo:a.publicationDemographic || '', lang:a.originalLanguage || 'ja',
    desc:d.en || Object.values(d)[0] || '', authors:who('author'), artists:who('artist'), genres:tg.filter(t => t.g === 'genre' && t.n).map(t => t.n), dj:has('Doujinshi'), oneshot:has('Oneshot'), anth:has('Anthology'), thumb:mdxCover(m, '256')} }
async function mdxSearch(name){ return discCache('mdxs:' + norm(name), 7 * 864e5, async () => {
    const j = await mdxGet('manga', [['title', name], ['limit', 15], ['order[relevance]', 'desc'], ['includes[]', 'cover_art'], ['contentRating[]', 'safe'], ['contentRating[]', 'suggestive'], ['contentRating[]', 'erotica']]);
    const out = ((j && j.data) || []).map(mdxNorm); L('manga', 'MangaDex search ' + name, out.slice(0, 6).map(x => `${x.name} (${x.year || '?'}) ${x.id}`)); return out }) }
async function mdxMeta(id){ return discCache('mdxm:' + id, 7 * 864e5, async () => { const j = await mdxGet('manga/' + id, [['includes[]', 'author'], ['includes[]', 'artist'], ['includes[]', 'cover_art']]);
    if(!j || !j.data) throw new Error('MangaDex does not know this series any more'); return mdxNorm(j.data) }) }
/* the best series for these books: same name (also in the other languages), not a fan work, started before your book, holds your numbers */
function mdxPick(res, books){ const name = norm(cvName(books[0])), maxN = Math.max(0, ...books.map(b => b.num || 0));
  return res.map((r, idx) => { const ns = r.names.map(norm); let s = ns.includes(name) ? 60 : ns.some(x => bare(x) === bare(name)) ? 55 : ns.some(x => x.length > 2 && (x.includes(name) || name.includes(x))) ? 20 : 0;
    if(norm(r.name) === name) s += 5; if(r.dj) s -= 40; if(r.oneshot) s -= 25; if(r.anth) s -= 15; if(/\b(colou?red|spin ?off|side story|gaiden|omake|academy|official)\b/i.test(r.name) && !/\b(colou?red|spin ?off|side story|gaiden|omake|academy|official)\b/i.test(name)) s -= 12;
    if(maxN && r.last) s += r.last >= maxN ? 10 : -10; return {r, s:s - idx * 0.5} }).sort((a, b) => b.s - a.s) }
/* every volume with its cover */
async function mdxList(id, fresh){ if(fresh) await dbDel('kv', 'disc:mdxl:' + id).catch(() => {});
  return discCache('mdxl:' + id, 864e5, async () => { const meta = await mdxMeta(id).catch(() => null), by = {}, all = [];
    for(let off = 0; off < 1500; off += 100){ const j = await mdxGet('cover', [['manga[]', id], ['limit', 100], ['offset', off], ['order[volume]', 'asc']]); if(!j) break; all.push(...(j.data || [])); if(!(j.data || []).length || off + 100 >= (j.total || 0)) break }
    const pref = [(meta && meta.lang) || 'ja', 'en'];
    for(const c of all){ const a = c.attributes || {}, v = String(a.volume == null ? '' : a.volume).trim(); if(!/^\d+(\.\d+)?$/.test(v) || !a.fileName) continue;
      const k = numKey(v), rank = pref.indexOf(a.locale) < 0 ? 9 : pref.indexOf(a.locale);
      if(!by[k] || rank < by[k].rank || (rank === by[k].rank && String(a.updatedAt || '') > by[k].up)) by[k] = {num:parseFloat(v), file:a.fileName, rank, up:String(a.updatedAt || '')} }
    const last = meta && meta.status === 'completed' ? meta.last : 0;   // a finished series: a volume without a picture is still a volume
    if(last > 0 && last <= 500 && Object.keys(by).length) for(let n = 1; n <= last; n++) if(!by[numKey(n)]) by[numKey(n)] = {num:n, file:'', rank:99, up:''};
    const out = Object.values(by).sort((a, b) => a.num - b.num).map(x => ({num:x.num, label:'Vol. ' + x.num, name:'', date:'', img:x.file ? `https://uploads.mangadex.org/covers/${id}/${x.file}.512.jpg` : '', thumb:x.file ? `https://uploads.mangadex.org/covers/${id}/${x.file}.256.jpg` : ''}));
    L('manga', 'volumes of ' + (meta ? meta.name : id), {volumes:out.length, covers:all.length, last}); return out }) }
function mdxHit(r, list, books){ LISTS['m' + r.id] = list; return {id:'m' + r.id, name:r.name, start:r.year || '', pub:'', n:list.length, cov:books ? covOf(list, books) : 0, src:'mdx', at:Date.now()} }
async function mdxSeries(books, force){ const k = 'mdx:' + cvKeyOf(books[0]), c = CV.cache(); if(!force && c[k] && (c[k].id || Date.now() - c[k].at < 14 * 864e5)) return c[k];
  const best = mdxPick(await mdxSearch(cvName(books[0])), books)[0]; let hit = {id:0, at:Date.now()};
  if(best && best.s >= 40){ const list = await mdxList(best.r.id); if(list.length) hit = mdxHit(best.r, list, books) }
  const c2 = CV.cache(); c2[k] = hit; CV.save(c2); return hit }
async function mdxRows(q, books){ const res = await mdxSearch(q), l = books.length ? mdxPick(res, books).map(x => x.r) : res;
  return l.slice(0, 20).map(r => ({key:'m' + r.id, name:r.name, start:r.year || '', pub:'', thumb:r.thumb ? `<img class="f" src="${esc(r.thumb)}" alt="" style="object-fit:cover">` : '',
    sub:esc([MSTAT[r.status] || '', r.last ? plural(r.last, 'volume') : '', cap(r.demo), r.dj ? 'fan work' : r.oneshot ? 'one-shot' : ''].filter(Boolean).join(' · ')) || '&nbsp;',
    hit:async () => { const list = await mdxList(r.id); if(!list.length) throw new Error('MangaDex has no volume pictures for this series – try AniList'); return mdxHit(r, list, books) }})) }

/* ---- AniList ---- */
const AL_S = 'id idMal title{romaji english native} synonyms format status volumes chapters startDate{year} coverImage{large} countryOfOrigin';
const AL_F = AL_S + ' endDate{year} genres averageScore description(asHtml:false) staff(perPage:10,sort:RELEVANCE){edges{role node{name{full}}}} siteUrl';
const anlNorm = m => ({id:m.id, name:m.title.english || m.title.romaji || m.title.native || '?', names:[m.title.english, m.title.romaji, m.title.native, ...(m.synonyms || [])].filter(Boolean), year:(m.startDate && m.startDate.year) || '', status:m.status, volumes:m.volumes || 0, format:m.format, thumb:(m.coverImage && m.coverImage.large) || '', raw:m});
async function anlSearch(name){ return discCache('anls:' + norm(name), 7 * 864e5, async () => {
    const d = await anlGet(`query($s:String){Page(perPage:12){media(search:$s,type:MANGA,format_not_in:[NOVEL],sort:SEARCH_MATCH){${AL_S}}}}`, {s:name});
    const out = (((d || {}).Page || {}).media || []).map(anlNorm); L('manga', 'AniList search ' + name, out.slice(0, 6).map(x => `${x.name} (${x.year || '?'}) vol ${x.volumes || '?'} #${x.id}`)); return out }) }
async function anlById(id){ return discCache('anlm:' + id, 3 * 864e5, async () => { const d = await anlGet(`query($id:Int){Media(id:$id,type:MANGA){${AL_F}}}`, {id:+id}); return d && d.Media ? anlNorm(d.Media) : null }) }
const anlVols = n => Array.from({length:n}, (_, i) => ({num:i + 1, label:'Vol. ' + (i + 1), name:'', date:'', img:'', thumb:''}));
async function anlList(id){ const m = await anlById(id); if(!m || !m.volumes) throw new Error('AniList does not know how many volumes this series has (it is still running?) – try MangaDex'); return anlVols(m.volumes) }
function anlHit(r, books){ const list = anlVols(r.volumes); LISTS['a' + r.id] = list; return {id:'a' + r.id, name:r.name, start:r.year || '', pub:'', n:r.volumes, cov:books ? covOf(list, books) : 0, src:'anl', at:Date.now()} }
function anlScore(r, name){ const ns = r.names.map(norm); let s = ns.includes(name) ? 60 : ns.some(x => bare(x) === bare(name)) ? 55 : ns.some(x => x.length > 2 && (x.includes(name) || name.includes(x))) ? 20 : 0; if(r.format === 'ONE_SHOT') s -= 30; return s }
async function anlSeries(books, force){ const k = 'anl:' + cvKeyOf(books[0]), c = CV.cache(); if(!force && c[k] && (c[k].id || Date.now() - c[k].at < 14 * 864e5)) return c[k];
  const name = norm(cvName(books[0])), best = (await anlSearch(cvName(books[0]))).filter(r => r.volumes).map(r => ({r, s:anlScore(r, name)})).sort((a, b) => b.s - a.s)[0];
  const hit = best && best.s >= 40 ? anlHit(best.r, books) : {id:0, at:Date.now()}, c2 = CV.cache(); c2[k] = hit; CV.save(c2); return hit }
async function anlRows(q, books){ const name = norm(q), l = (await anlSearch(q)).filter(r => r.volumes).sort((a, b) => anlScore(b, name) - anlScore(a, name));
  return l.slice(0, 20).map(r => ({key:'a' + r.id, name:r.name, start:r.year || '', pub:'', thumb:r.thumb ? `<img class="f" src="${esc(r.thumb)}" alt="" style="object-fit:cover">` : '',
    sub:esc([MSTAT[r.status] || '', plural(r.volumes, 'volume'), String(r.format || '').replace('_', '-').toLowerCase() === 'manga' ? '' : cap(String(r.format || '').replace('_', '-').toLowerCase())].filter(Boolean).join(' · ')), hit:async () => anlHit(r, books)})) }
/* writer and artist from AniList's staff roles ("Story & Art", "Story", "Art" – not assistants, translators, editors) */
function anlPeople(edges){ const au = [], ar = [], add = (l, n) => { if(!l.includes(n)) l.push(n) };
  for(const e of edges || []){ const r = e.role || '', n = e.node && e.node.name && e.node.name.full; if(!n || /assistant|translat|editing|editor|lettering|touch-up|supervis|design|cooperation|color/i.test(r)) continue;
    if(/^story\s*&\s*art/i.test(r)){ add(au, n); add(ar, n) } else if(/^(story|original (creator|story)|author)/i.test(r)) add(au, n); else if(/^(art|illustration)/i.test(r)) add(ar, n) }
  return {au, ar} }
/* the details of a series: MangaDex (+ AniList when it knows the series). kept 7 days */
function mangaMerge(meta, al){ const r = al && al.raw, p = r ? anlPeople(r.staff && r.staff.edges) : {au:[], ar:[]};
  return {desc:cvStrip((r && r.description) || (meta && meta.desc) || '').slice(0, 3000), authors:p.au.length ? p.au : meta ? meta.authors : [], artists:p.ar.length ? p.ar : meta ? meta.artists : [], genres:r && r.genres && r.genres.length ? r.genres : meta ? meta.genres : [],
    status:MSTAT[(r && r.status) || (meta && meta.status)] || '', volumes:(r && r.volumes) || (meta && meta.status === 'completed' && meta.last) || 0, chapters:(r && r.chapters) || 0, year:(r && r.startDate && r.startDate.year) || (meta && meta.year) || '',
    score:(r && r.averageScore) || 0, al:al ? al.id : 0, mal:(r && r.idMal) || (meta && meta.mal) || '', demo:meta ? meta.demo : '', url:r ? r.siteUrl : '', at:Date.now()} }
async function mangaInfo(vid, fresh){ if(fresh) await dbDel('kv', 'disc:mxi:' + vid).catch(() => {});
  return discCache('mxi:' + vid, 7 * 864e5, async () => { const s = srcOf(vid); let meta = null, al = null;
    if(s === 'mdx'){ meta = await mdxMeta(String(vid).slice(1)); if(meta.al) al = await anlById(meta.al).catch(e => { if(e.limit) throw e; LE('manga', 'AniList by id', e); return null });
      else { const nm = norm(meta.name), r = (await anlSearch(meta.name).catch(() => [])).map(x => ({x, s:anlScore(x, nm)})).sort((a, b) => b.s - a.s)[0]; if(r && r.s >= 55) al = await anlById(r.x.id).catch(() => null) } }
    else al = await anlById(String(vid).slice(1));
    const info = mangaMerge(meta, al); L('manga', 'details ' + vid, {authors:info.authors, genres:info.genres, status:info.status, volumes:info.volumes, al:info.al}); return info }) }
/* the "About" block of a manga series page */
function infoHTML(c){ const i = c && c.info; if(!i || !isManga(c.shelf)) return '';
  const line = [i.authors.join(', ') + (i.artists.length && i.artists.join() !== i.authors.join() ? ' (art: ' + i.artists.join(', ') + ')' : ''), [i.status, i.volumes ? plural(i.volumes, 'volume') : ''].filter(Boolean).join(' · '), i.genres.slice(0, 5).join(', '), i.year ? 'since ' + i.year : '', i.score ? i.score + '/100' : ''].filter(Boolean);
  return `<div class="sec">About</div>${i.desc ? `<div class="desc clip" id="sdesc">${esc(i.desc)}</div>${i.desc.length > 300 ? '<button class="btn sm" id="smore" style="margin-top:6px">More</button>' : ''}` : ''}<div class="muted small" style="margin:8px 0">${line.map(esc).join(' · ')}</div><div class="muted small" style="margin:0 0 6px;opacity:.7">Details from MangaDex${i.al ? ' and AniList' : ''}</div>` }
document.addEventListener('click', e => { const m = e.target.closest('#smore'); if(!m) return; const d = $('#sdesc'); if(d) d.classList.remove('clip'); m.remove() });

/* every issue of a list, from where it came from */
async function allIssues(vid, onPage, fresh){ if(LISTS[vid] && !fresh) return LISTS[vid]; const s = srcOf(vid);
  if(s === 'gcd'){ const j = await gcdGet(`https://www.comics.org/api/series/${String(vid).slice(1)}/`); if(!j) throw new Error('GCD does not know this series any more'); return LISTS[vid] = gcdIssueList(j) }
  if(s === 'wiki'){ if(fresh) await dbDel('kv', 'disc:wikip:' + String(vid).slice(1)).catch(() => {}); return LISTS[vid] = (await wikiPage(String(vid).slice(1))).list }
  if(s === 'mdx') return LISTS[vid] = await mdxList(String(vid).slice(1), fresh);
  if(s === 'anl') return LISTS[vid] = await anlList(String(vid).slice(1));
  return cvAllIssues(vid, onPage) }
/* which sources a shelf may use right now */
const srcPref = sh => { const p = shelfOf(sh).src || 'auto'; return p === 'auto' || KIND_SRCS[kindOf(sh)].includes(p) ? p : 'auto' };
function srcOrder(sh){ const p = srcPref(sh); return (p === 'auto' ? KIND_SRCS[kindOf(sh)] : [p]).filter(s => !(BLOCK[s] > Date.now()) && (s !== 'cv' || CV.key()) && (s !== 'gcd' || canGcd())) }
const canLookOnline = sh => srcOrder(sh).length > 0;
const whyNoSource = sh => { const p = srcPref(sh); return p === 'cv' && !CV.key() ? 'nokey' : p === 'gcd' && !canGcd() ? 'GCD (comics.org) can only be reached from the Nightvault Android app' : BLOCK[p] > Date.now() ? SRC_NAME[p] + ' said: too many requests – try again in an hour' : '' };
/* the best series for these books: a series you picked by hand wins; then each source in turn, until one holds all your numbers */
async function findSeries(sh, books, force){ const k = cvKeyOf(books[0]), c = CV.cache(); if(c['pick:' + k] && c['pick:' + k].id) return c['pick:' + k];
  const order = srcOrder(sh); if(!order.length){ const w = whyNoSource(sh); throw Object.assign(new Error(w === 'nokey' ? 'Type your Comic Vine key first (shelf ⚙ → Online)' : w || 'Nothing to look in'), {nokey:w === 'nokey'}) }
  const maxN = Math.max(0, ...books.map(b => b.num || 0)); let best = null, pub = ''; const hasNums = books.some(b => b.num != null);
  for(const s of order){ let hit;
    try{ hit = s === 'cv' ? await cvSeries(books, force) : s === 'gcd' ? await gcdSeries(books, force) : s === 'mdx' ? await mdxSeries(books, force) : s === 'anl' ? await anlSeries(books, force) : await wikiSeries(books, force) }
    catch(e){ if(e.limit) BLOCK[s] = Date.now() + 3600e3; if(order.length === 1) throw e; LE('src', SRC_NAME[s] + ' ' + cvName(books[0]), e); continue }
    if(!hit || !hit.id) continue; if(hit.pub && !pub) pub = hit.pub;
    const cov = s === 'cv' ? (!maxN || hit.n >= maxN ? 1 : (hit.n || 0) / maxN) : hit.cov || 0;
    if(!best || cov > best.cov){ best = Object.assign({}, hit, {cov, src:s}) } if(cov >= 1 || (!hasNums && best)) break }
  if(best && !best.pub && pub) best.pub = pub;
  return best || {id:0} }

/* =====================================================================================================================
   COLLECTION LISTS (like the card binder): every issue of a series from Comic Vine – grey when you don't have it, in colour when you
   do, with a D badge (digital: a file in Bookcase) and a P badge (paper: ticked by hand, with an optional price).
   Stored in IndexedDB kv as 'col:<Comic Vine series id>' = {id, vid, shelf, name, start, pub, count, issues:[{num, label, name, date, img, thumb}],
   phys:{'<num>':{price, at}}, at}. Digital = a book of this shelf with b.cv.id = vid (or the same series name when it was never looked up).
   ===================================================================================================================== */
let COLS = {};
async function loadCols(){ COLS = {}; for(const r of await dbAll('kv')) if(String(r.id).startsWith('col:')) COLS[r.vid] = r; await loadArcs() }
const colSave = c => dbPut('kv', c);
const colsOf = sh => Object.values(COLS).filter(c => c.shelf === sh);
const numKey = n => String(parseFloat(n));
/* your digital copies of a list: number → book */
function colDigital(c){ const m = {}; for(const b of inShelf(c.shelf)){ if(b.num == null) continue;
    if((b.cv && b.cv.id === c.vid) || (b.series && (!b.cv || srcOf(b.cv.id) !== srcOf(c.vid)) && bare(b.series) === bare(c.name))) if(!m[numKey(b.num)]) m[numKey(b.num)] = b }
  return m }
function colStats(c){ const d = colDigital(c), have = c.issues.filter(i => d[numKey(i.num)] || (c.phys || {})[numKey(i.num)]).length,
    price = Object.values(c.phys || {}).reduce((a, x) => a + (+x.price || 0), 0);
  return {have, total:c.issues.length, dig:c.issues.filter(i => d[numKey(i.num)]).length, phys:c.issues.filter(i => (c.phys || {})[numKey(i.num)]).length, price} }
const money = n => n ? '€ ' + n.toFixed(2).replace('.', ',') : '';
/* all issues of a Comic Vine series (100 per request) */
async function cvAllIssues(vid, onPage){ const out = []; for(let off = 0; off < 2000; off += 100){
    const j = await cvGet('issues', {filter:'volume:' + vid, sort:'cover_date:asc', limit:100, offset:off, field_list:'id,issue_number,name,cover_date,image'});
    for(const i of j.results || []){ const n = parseFloat(i.issue_number); out.push({num:isNaN(n) ? out.length + 1 : n, label:'#' + i.issue_number, name:i.name || '', date:i.cover_date || '', img:i.image && (i.image.medium_url || i.image.small_url) || '', thumb:i.image && (i.image.small_url || i.image.thumb_url) || ''}) }
    onPage && onPage(out.length, j.number_of_total_results);
    if(!j.results || j.results.length < 100 || out.length >= (j.number_of_total_results || 0)) break }
  return out.sort((a, b) => a.num - b.num) }
async function colAdd(sh, v, quiet){ /* v: {id, name, start_year|start, publisher|pub, count_of_issues|count} */
  const vid = v.id; if(COLS[vid]) return COLS[vid];
  if(!quiet) sheet(`<h3>Getting the issues of ${esc(v.name)}…</h3><div class="prog busy"><i></i></div><div class="muted small" id="cas"></div>`, true);
  const issues = await allIssues(vid, (n, t) => { const s = $('#cas'); if(s) s.textContent = `${n} of ${t || '?'} ${W(sh).is}` });
  const c = {id:'col:' + vid, vid, shelf:sh, name:v.name, start:v.start_year || v.start || '', pub:(v.publisher && v.publisher.name) || v.pub || '', count:issues.length, issues, phys:{}, at:Date.now()};
  if(isManga(sh)) try{ c.info = await mangaInfo(vid) }catch(e){ LE('manga', 'details ' + v.name, e) }
  COLS[vid] = c; await colSave(c); if(!quiet) closeSheet(); return c }

/* ---------- New volumes / issues: a daily check of the lists you keep, marked NEW on the tiles ----------
   A list (COLS) remembers what it had; the check fetches it again and anything new is kept in c.newN (numbers) until you own it or tap Seen. */
const NEWKEY = 'nvBooks.newCheck';
const newKeys = c => (c.newN || []).filter(k => { const d = colDigital(c); return !d[k] && !(c.phys || {})[k] });
const newCount = c => newKeys(c).length;
const colsNew = sh => colsOf(sh).filter(newCount);
const newBadge = n => n ? `<span class="newb">NEW${n > 1 ? ' · ' + n : ''}</span>` : '';
/* a tile for a group (a series, or a group holding series): how many new volumes are inside */
function grNew(g){ const all = g.all || g.items || [], seen = new Set(); let n = 0;
  for(const b of all){ const id = b.cv && b.cv.id; if(!id || seen.has(id) || !COLS[id]) continue; seen.add(id); n += newCount(COLS[id]) }
  return n }
function missingOf(c){ const st = colStats(c); return Math.max(0, st.total - st.have) }
async function checkList(c){
  const old = new Set(c.issues.map(i => numKey(i.num)));
  if(srcOf(c.vid) === 'anl') await dbDel('kv', 'disc:anlm:' + String(c.vid).slice(1)).catch(() => {});
  const fresh = await allIssues(c.vid, null, true);
  c.chk = Date.now();
  if(!fresh || !fresh.length || fresh.length < c.issues.length){ await colSave(c); return 0 }
  const add = fresh.map(i => numKey(i.num)).filter(k => !old.has(k));
  if(add.length){ c.issues = fresh; c.count = fresh.length; c.newN = [...new Set([...(c.newN || []), ...add])]; c.newAt = Date.now() }
  else if(fresh.length === c.issues.length) c.issues = fresh;      // same numbers: take the newer covers and names
  await colSave(c); return add.length }
const colDue = c => { const done = c.info && /finish|complete|cancel/i.test(c.info.status || ''); return Date.now() - (c.chk || 0) > (done ? 7 * 864e5 : 20 * 36e5) }
let NEWRUN = null;
async function checkNew(force, quiet){
  if(NEWRUN) return NEWRUN;
  return NEWRUN = (async () => { let n = 0, series = 0, tried = 0, bad = 0; const list = Object.values(COLS).filter(c => force || colDue(c)), bad2 = new Set();
    for(const c of list){ const s = srcOf(c.vid); if(bad2.has(s) || BLOCK[s] > Date.now()) continue;
      tried++; try{ const a = await checkList(c); if(a){ n += a; series++ } }catch(e){ bad++; bad2.add(s); LE('new', 'check ' + c.name, e) }
      if(!quiet && tried % 5 === 0) toast(`Checking for new ones… ${tried} of ${list.length}`, 1500);
      await sleep(400) }
    try{ localStorage.setItem(NEWKEY, String(Date.now())) }catch(e){}
    L('new', `checked ${tried} lists, ${n} new in ${series} series, ${bad} could not be reached`);
    if(tried || force){ draw(); if(!quiet || n) toast(n ? `${plural(n, 'new volume or issue', 'new volumes or issues')} in ${plural(series, 'series', 'series')}` : bad ? 'Could not reach the online sources – a work or school wifi may block them' : 'Nothing new', 5000) }
    return {n, series, tried, bad} })().finally(() => { NEWRUN = null }) }
/* the strip on top of a shelf / its lists: what is new + Check now */
function newBar(sh){ const cs = colsNew(sh); if(!colsOf(sh).length) return '';
  let last = 0; try{ last = +localStorage.getItem(NEWKEY) || 0 }catch(e){}
  const when = last ? (Date.now() - last < 36e5 ? 'just now' : Date.now() - last < 864e5 ? 'today' : Math.round((Date.now() - last) / 864e5) + ' days ago') : 'never';
  return `<div class="newbar${cs.length ? ' on' : ''}">${cs.length ? `<div class="nbt"><b>${plural(cs.length, 'series', 'series')} with new ${isManga(sh) ? 'volumes' : 'issues'}</b>
    <div class="nbl">${cs.slice(0, 8).map(c => `<button class="chip" data-newgo="${esc(c.vid)}">${esc(c.name)} · ${newCount(c)}</button>`).join('')}${cs.length > 8 ? `<span class="muted small">+${cs.length - 8} more</span>` : ''}</div></div>` : `<div class="muted small nbt">Nothing new · checked ${when}</div>`}
    <button class="btn sm" id="newcheck">${NEWRUN ? 'Checking…' : 'Check now'}</button></div>` }
function hookNew(sh){ const b = $('#newcheck'); if(b) b.onclick = async () => { b.disabled = true; b.textContent = 'Checking…'; toast('Looking for new ones – this can take a minute', 3000); await checkNew(true) };
  document.querySelectorAll('[data-newgo]').forEach(el => el.onclick = () => go({v:'colser', shelf:sh, vid:el.dataset.newgo})) }

/* the Collection lists page of a shelf: per publisher, a tile per series with "12 of 40" */
function colTile(c){ const st = colStats(c), d = colDigital(c), first = c.issues.find(i => d[numKey(i.num)]) ;
  const cov = first ? coverHTML(d[numKey(first.num)]) : `<div class="cv">${c.issues[0] && c.issues[0].thumb ? `${remImg(c.issues[0].thumb)}` : phHTML({title:c.name, shelf:c.shelf}, c.name)}</div>`;
  return `<div class="bk stack" data-col="${c.vid}">${cov}${newBadge(newCount(c))}<span class="cdl">${st.have} of ${st.total}</span><div class="pbar"><i style="width:${st.total ? Math.round(100 * st.have / st.total) : 0}%"></i></div><div class="t">${esc(c.name)}${c.start ? ` (${esc(c.start)})` : ''}</div>
    <div class="a">${[st.dig ? st.dig + ' D' : '', st.phys ? st.phys + ' P' : '', money(st.price), st.total > st.have && st.have ? (st.total - st.have) + ' missing' : ''].filter(Boolean).join(' · ') || 'none yet'}</div></div>` }
function drawCol(v){ const s = shelfOf(v.shelf), cs = colsOf(v.shelf), q = norm(Q['col:' + v.shelf] || '');
  $('#vtitle').textContent = s.name; document.title = 'Collection · ' + s.name;
  let h = colTabs(v.shelf, 'col') + newBar(v.shelf);
  h += `<div class="mbar"><button class="btn primary sm" id="coladd">+ Add a series</button>${isManga(v.shelf) ? '' : '<button class="btn sm" id="coldisc">Discover</button>'}<button class="btn sm" id="colmine">Add the series I have</button></div>`;
  if(!cs.length){ h += `<div class="empty"><h2 style="margin:4px 0;font-size:17px">No collection lists yet</h2><p class="muted small" style="margin:0 0 6px">${isManga(v.shelf) ? `A list shows every volume of a series (from MangaDex and AniList): grey when you don't have it, in colour when you do (D = digital, P = on paper).` : `A list shows every issue of a series (from Comic Vine, GCD or Wikipedia): grey when you don't have it, in colour when you do (D = digital, P = on paper).`}</p><p class="muted small" style="margin:0">Tap <b>+ Add a series</b> to pick one, or <b>Add the series I have</b> for the series of your ${W(v.shelf).cs} that were looked up online.</p></div>`; $('#body').innerHTML = h; hookCol(v); return }
  const all = cs.map(colStats), tot = all.reduce((a, x) => ({have:a.have + x.have, total:a.total + x.total, price:a.price + x.price}), {have:0, total:0, price:0});
  h += `<input type="search" id="colq" placeholder="Search your lists" value="${esc(Q['col:' + v.shelf] || '')}" style="margin:2px 0 8px"><div class="mtot">${plural(cs.length, 'series', 'series')} · ${tot.have} of ${tot.total} issues${tot.price ? ' · paper ' + money(tot.price) : ''}</div>`;
  const byPub = {}; for(const c of cs) if(!q || norm(c.name + ' ' + c.pub).includes(q)) (byPub[cleanPub(c.pub) || (isManga(v.shelf) ? 'Manga' : 'Other')] = byPub[cleanPub(c.pub) || (isManga(v.shelf) ? 'Manga' : 'Other')] || []).push(c);
  for(const p of Object.keys(byPub).sort(coll.compare)) h += `<div class="sec">${esc(p)}</div><div class="grid">${byPub[p].sort((a, b) => coll.compare(a.name, b.name) || (+a.start || 0) - (+b.start || 0)).map(colTile).join('')}</div>`;
  $('#body').innerHTML = h; lazyCovers($('#body')); hookCol(v); hookNew(v.shelf) }
const colTabs = (sh, on) => `<div class="chips"><button class="chip ${on === 'books' ? 'on' : ''}" data-tabgo="books">My ${esc(shelfOf(sh).name.toLowerCase())}</button><button class="chip ${on === 'col' ? 'on' : ''}" data-tabgo="col">Collection lists${colsOf(sh).length ? ' (' + colsOf(sh).length + ')' : ''}</button>${isManga(sh) ? '' : `<button class="chip ${on === 'arcs' ? 'on' : ''}" data-tabgo="arcs">Reading orders${arcsOf(sh).length ? ' (' + arcsOf(sh).length + ')' : ''}</button>`}</div>`;
const showColTabs = sh => colsOf(sh).length || arcsOf(sh).length || shelfOf(sh).byPub || shelfOf(sh).fullSeries;
function hookCol(v){ const a = $('#coladd'); if(a) a.onclick = () => colSearch(v.shelf); const dz = $('#coldisc'); if(dz) dz.onclick = () => CV.key() ? go({v:'disc', shelf:v.shelf, tab:'week'}) : cvKeySheet(() => go({v:'disc', shelf:v.shelf, tab:'week'})); const m = $('#colmine'); if(m) m.onclick = () => colMine(v.shelf);
  const q = $('#colq'); if(q) q.oninput = () => { Q['col:' + v.shelf] = q.value; clearTimeout(q._t); q._t = setTimeout(() => { const p = q.selectionStart; draw(); const n = $('#colq'); if(n){ n.focus(); try{ n.setSelectionRange(p, p) }catch(e){} } }, 250) } }
/* + Add a series: search Comic Vine, GCD or Wikipedia, tap one */
function colSearch(sh, pre){ let src = firstSrc(sh), rows = [], pub = '';
  sheet(`<h3>Add a series</h3>${srcChips(src, sh)}<div style="display:flex;gap:8px"><input type="search" id="csq" placeholder="Series name, like Saga or Suske en Wiske" value="${esc(pre || '')}"><button class="btn primary" id="csgo">Search</button></div>
    <div class="chips" id="cspubs"></div><div class="muted small" id="csst" style="margin:6px 0"></div><div id="csres"></div><button class="btn" style="width:100%;margin-top:10px" onclick="closeSheet()">Close</button>`);
  const show = () => { const list = rows.map((r, n) => [r, n]).filter(([r]) => !pub || r.pub === pub);
    const pubs = [...new Set(rows.map(r => r.pub).filter(Boolean))].sort(coll.compare);
    $('#cspubs').innerHTML = pubs.length > 1 ? [''].concat(pubs).map(p => `<button class="chip ${p === pub ? 'on' : ''}" data-cpub="${esc(p)}">${p ? esc(p) : 'All publishers'}</button>`).join('') : '';
    $('#csres').innerHTML = list.map(([r, n]) => `<div class="li" data-cadd="${n}"><span class="th"><div class="cv">${r.thumb}</div></span><div class="n"><div>${esc(r.name)}${r.start ? ` (${esc(r.start)})` : ''}</div><div class="s">${r.sub}</div></div><span class="r">${COLS[r.key] ? '✓ in your lists' : ''}</span></div>`).join('') };
  const run = async () => { const q = $('#csq').value.trim(); if(!q) return; $('#csst').textContent = 'Searching…'; $('#csres').innerHTML = ''; $('#cspubs').innerHTML = ''; const me = src;
    if(src === 'cv' && !CV.key()){ $('#csst').innerHTML = 'Comic Vine needs your free key. <button class="btn sm" id="csk">Type it</button>'; $('#csk').onclick = () => cvKeySheet(() => colSearch(sh, q)); return }
    if(src === 'gcd' && !canGcd()){ $('#csst').textContent = 'GCD (comics.org) can only be reached from the Nightvault Android app'; return }
    try{ rows = await srcSearch(src, q, []); if(me !== src) return; pub = ''; $('#csst').textContent = rows.length ? 'Tap a series to add its list' : 'Nothing found - try other words'; show() }catch(e){ $('#csst').textContent = e.message || String(e) } };
  $('#csgo').onclick = run; $('#csq').onkeydown = e => { if(e.key === 'Enter') run() }; setTimeout(() => $('#csq').focus(), 50); if(pre) run();
  $('.sheet').addEventListener('click', async e => { const ch = e.target.closest('[data-src]'); if(ch){ src = ch.dataset.src; $('#srcch').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === ch)); return run() }
    const p = e.target.closest('[data-cpub]'); if(p){ pub = p.dataset.cpub; return show() }
    const r = e.target.closest('[data-cadd]'); if(!r) return; const row = rows[+r.dataset.cadd];
    try{ if(COLS[row.key]) return go({v:'colser', shelf:sh, vid:row.key}); $('#csst').textContent = 'Getting the list…'; const hit = await row.hit(); const c = await colAdd(sh, hit); go({v:'colser', shelf:sh, vid:c.vid}) }catch(err){ toast(err.message || String(err), 5000) } }) }
/* Add the series I have: every Comic Vine series of the comics on this shelf */
async function colMine(sh){
  const want = {}; for(const b of inShelf(sh)) if(b.cv && b.cv.id && !COLS[b.cv.id]) want[b.cv.id] = {id:b.cv.id, name:b.cv.name, start:b.cv.start, pub:b.cvPub || publisherOf(b)};
  const list = Object.values(want); if(!CV.key() && list.some(v => srcOf(v.id) === 'cv')) return cvKeySheet(() => colMine(sh));
  if(!list.length){ toast(inShelf(sh).some(b => b.cv) ? 'All your looked-up series already have a list' : `First look your ${W(sh).cs} up online (shelf ⚙ → Online)`, 5000); return }
  awake(true); let stop = false, n = 0;
  sheet(`<h3>Making ${plural(list.length, 'list')}…</h3><div class="prog"><i id="cmp"></i></div><div class="muted small" id="cms"></div><button class="btn" id="cmstop" style="width:100%;margin-top:8px">Stop</button>`, true);
  $('#cmstop').onclick = () => { stop = true };
  for(const v of list){ if(stop) break; try{ await colAdd(sh, v, true) }catch(e){ toast(e.message || String(e), 5000); LE('col', v.name, e); if(e.limit || /key/.test(e.message || '')) break }
    n++; const p = $('#cmp'), s = $('#cms'); if(p) p.style.width = (100 * n / list.length) + '%'; if(s) s.textContent = `${n} of ${list.length} · ${v.name}` }
  awake(false); closeSheet(); draw(); toast(`${plural(n, 'list')} made`) }

/* one series: every issue */
function issueGridHTML(c, pass){ const d = colDigital(c), P = c.phys || {};
  return `<div class="grid">${c.issues.filter(pass).map(i => { const k = numKey(i.num), b = d[k], p = P[k], own = b || p;
      const cov = b ? coverHTML(b) : `<div class="cv">${i.thumb ? `${remImg(i.thumb)}` : phHTML({title:c.name, shelf:c.shelf}, c.name)}</div>`;
      return `<div class="bk iss ${own ? '' : 'miss'}" data-iss="${esc(k)}">${cov.replace(/<\/div>$/, `${(c.newN || []).includes(k) && !own ? '<span class="newb in">NEW</span>' : ''}<span class="vol">${esc(i.label)}</span>${b ? '<span class="bd dg">D</span>' : ''}${p ? `<span class="bd pp${b ? '' : ' solo'}">P</span>` : ''}</div>`)}<div class="t">${esc(i.name || c.name + ' ' + i.label)}</div><div class="a">${esc([i.date.slice(0, 4), p && p.price ? money(+p.price) : ''].filter(Boolean).join(' · ') || ' ')}</div></div>` }).join('')}</div>`; }
function drawColSer(v){ const c = COLS[v.vid]; if(!c){ V.pop(); return draw() } const d = colDigital(c), st = colStats(c), f = S.filter['colser'] || 'all';
  $('#vtitle').textContent = ''; document.title = c.name + ' · Collection';
  let h = `<div class="alhead" style="align-items:center"><div style="min-width:0;flex:1"><b>${esc(c.name)}${c.start ? ` (${esc(c.start)})` : ''}</b><div class="muted small">${esc(cleanPub(c.pub) || '')}${c.pub ? ' · ' : ''}${st.have} of ${st.total} ${W(c.shelf).is}</div>
    <div class="muted small">${st.dig} digital · ${st.phys} on paper${st.price ? ' · ' + money(st.price) : ''}</div><div class="pbar" style="max-width:260px"><i style="width:${st.total ? Math.round(100 * st.have / st.total) : 0}%"></i></div></div><button class="ib" id="csmenu" aria-label="More for this list">${IC_DOTS}</button></div>`;
  { const nk = newKeys(c); if(nk.length) h += `<div class="newbar on"><div class="nbt"><b>${plural(nk.length, 'new ' + W(c.shelf).i, 'new ' + W(c.shelf).is)}: ${nk.slice(0, 8).join(', ')}${nk.length > 8 ? ' …' : ''}</b><div class="muted small">Not in your ${W(c.shelf).cs} yet. It goes away when you add it.</div></div><button class="btn sm" id="newseen">Seen</button></div>` }
  h += infoHTML(c);
  h += `<div class="chips">${[['all', 'All'], ['have', 'I have'], ['miss', 'Missing'], ['dig', 'Digital'], ['phys', 'On paper']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-csf="${k}">${t}</button>`).join('')}</div>`;
  const P = c.phys || {}, pass = i => { const k = numKey(i.num), D = !!d[k], Pp = !!P[k]; return f === 'have' ? D || Pp : f === 'miss' ? !D && !Pp : f === 'dig' ? D : f === 'phys' ? Pp : true };
  h += issueGridHTML(c, pass);
  $('#body').innerHTML = h; lazyCovers($('#body'));
  $('#csmenu').onclick = () => colMenu(c);
  if($('#newseen')) $('#newseen').onclick = async () => { c.newN = []; await colSave(c); draw() };
  $('#body').querySelectorAll('[data-csf]').forEach(b => b.onclick = () => { S.filter['colser'] = b.dataset.csf; saveS(); draw() });
  $('#body').querySelectorAll('[data-iss]').forEach(el => el.onclick = () => issueSheet(c, c.issues.find(i => numKey(i.num) === el.dataset.iss))) }
function issueSheet(c, i){ const k = numKey(i.num), b = colDigital(c)[k], p = (c.phys || {})[k], title = `${c.name} ${i.label}`;
  sheet(`<div style="display:flex;gap:14px;align-items:flex-start">${i.img ? `<img src="${esc(i.img)}" alt="" style="width:110px;border-radius:8px;flex:none">` : ''}<div style="min-width:0"><h3 style="margin:0 0 4px" data-issk="${esc(c.vid + ':' + k)}">${esc(title)}</h3>
      ${i.name ? `<div class="muted small">${esc(i.name)}</div>` : ''}<div class="muted small">${esc(i.date || '')}</div>
      <div style="margin-top:8px;display:flex;gap:6px">${b ? '<span class="bd dg" style="position:static">D</span> <span class="small">Digital – in Bookcase</span>' : ''}${p ? '<span class="bd pp" style="position:static">P</span> <span class="small">On paper</span>' : ''}${!b && !p ? '<span class="small muted">You don\'t have this one yet</span>' : ''}</div></div></div>
    ${b ? `<button class="btn primary" id="isopen" style="width:100%;margin-top:12px">${started(b) ? 'Continue reading' : 'Read'}</button>` : ''}
    ${c.id ? `<div class="opt" style="margin-top:8px"><label for="isph">I have it on paper</label><input type="checkbox" id="isph" ${p ? 'checked' : ''}></div>` : '<p class="muted small" style="margin:10px 0 0">Add this series to your collection lists to mark issues as on paper.</p>'}
    <div class="opt" id="isprow" ${p && c.id ? '' : 'hidden'}><label for="ispr">Price or value (optional)</label><input type="number" id="ispr" step="0.01" min="0" value="${p && p.price ? esc(p.price) : ''}" style="width:110px" placeholder="€"></div>
    ${!b ? `<div class="sec">Find it</div><div class="mlist">${sites().map((x, n) => `<button class="btn" data-site="${n}">Find it on ${esc(x.name)}</button>`).join('')}<button class="btn" id="iscopy">Copy “${esc(title)}”</button></div>` : ''}`);
  if($('#isopen')) $('#isopen').onclick = () => { closeSheet(); openReader(b) };
  if(!i.img && i.gid && !i.gcdDone && canGcd()) gcdCover(c, i).then(ok => { if(!ok) return; const open = !!$(`[data-issk="${CSS.escape(c.vid + ':' + k)}"]`); if(['colser', 'group'].includes(cur().v)) draw(); if(open) issueSheet(c, i) }).catch(e => LE('gcd', 'cover', e));
  const saveP = async () => { c.phys = c.phys || {}; if($('#isph').checked){ c.phys[k] = {price:$('#ispr').value.trim(), at:(c.phys[k] || {}).at || Date.now()} } else delete c.phys[k]; await colSave(c); draw() };
  if($('#isph')){ $('#isph').onchange = () => { $('#isprow').hidden = !$('#isph').checked; saveP() }; $('#ispr').onchange = saveP }
  if($('#iscopy')) $('#iscopy').onclick = () => copyText(title);
  $('.sheet').addEventListener('click', e => { const s = e.target.closest('[data-site]'); if(s) openSite(sites()[+s.dataset.site], title) }) }
function colMenu(c){ sheet(`<h3>${esc(c.name)}</h3><div class="mlist"><button class="btn" id="cmphys">Mark ${W(c.shelf).is} on paper…</button><button class="btn" id="cmnew">Check for new ${W(c.shelf).is}</button><button class="btn" id="cmcopy">Copy the missing ${W(c.shelf).is} as a list</button><button class="btn danger" id="cmdel">Remove this list</button></div><p class="muted small">Removing the list keeps your ${W(c.shelf).cs}.</p>`);
  $('#cmphys').onclick = async () => { const t = await ask(`Which ${W(c.shelf).is} do you have on paper?`, 'Like 1-12, 15, 20', '', 'Mark them'); if(!t) return; const want = new Set();
    for(const part of t.split(/[,; ]+/)){ const m = part.match(/^#?(\d+(?:\.\d+)?)(?:-#?(\d+(?:\.\d+)?))?$/); if(!m) continue; const a = +m[1], z = m[2] != null ? +m[2] : a; for(const i of c.issues) if(i.num >= a && i.num <= z) want.add(numKey(i.num)) }
    c.phys = c.phys || {}; for(const k of want) c.phys[k] = c.phys[k] || {price:'', at:Date.now()}; await colSave(c); draw(); toast(`${plural(want.size, W(c.shelf).i)} marked as on paper`) };
  $('#cmnew').onclick = async () => { closeSheet(); try{ const old = c.issues.length; c.issues = await allIssues(c.vid, null, true); c.count = c.issues.length; c.at = Date.now(); await colSave(c); draw(); toast(c.issues.length > old ? `${plural(c.issues.length - old, 'new ' + W(c.shelf).i)}` : 'No new ' + W(c.shelf).is) }catch(e){ toast(e.message || String(e), 5000) } };
  $('#cmcopy').onclick = () => { const d = colDigital(c), P = c.phys || {}; copyText(c.issues.filter(i => !d[numKey(i.num)] && !P[numKey(i.num)]).map(i => `${c.name} ${i.label}`).join('\n')) };
  $('#cmdel').onclick = async () => { if(!confirm(`Remove the list “${c.name}”? Your ${W(c.shelf).cs} stay.`)) return; await dbDel('kv', c.id); delete COLS[c.vid]; closeSheet(); V.pop(); draw() } }

/* "Find it on …": websites the owner picks himself (app ⚙ → Where to look), {q} = what is searched; and "Copy" for anywhere else */
const SITE_PRESETS = [{name:'Google', url:'https://www.google.com/search?q={q}'}, {name:'Humble Bundle', url:'https://www.humblebundle.com/store/search?search={q}'},
  {name:'DriveThruComics', url:'https://www.drivethrucomics.com/browse.php?keywords={q}'}, {name:'Amazon', url:'https://www.amazon.com/s?k={q}'},
  {name:'BookWalker', url:'https://global.bookwalker.jp/search/?word={q}'}, {name:'bol.com', url:'https://www.bol.com/be/nl/s/?searchtext={q}'}];
const sites = () => lsGet('nvBooks.sites', null) || SITE_PRESETS.slice(0, 1);
function openSite(s, q){ const url = s.url.includes('{q}') ? s.url.split('{q}').join(encodeURIComponent(q)) : s.url + encodeURIComponent(q); L('find', s.name + ': ' + q); window.open(url, '_blank') }
async function copyText(t){ try{ await navigator.clipboard.writeText(t); toast('Copied') }catch(e){ const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try{ document.execCommand('copy'); toast('Copied') }catch(x){ toast('Could not copy') } a.remove() } }
function sitesSheet(){ const l = sites();
  sheet(`<h3>Where to look for a book</h3><p class="muted small" style="margin:0 0 8px">These show as “Find it on …” for a comic you don't have yet. Add your own: a name, and the site's search address with <b>{q}</b> where the title goes (search something on the site, copy the address and replace the words with {q}).</p>
    ${l.map((s, i) => `<div class="li" style="cursor:default"><div class="n"><div>${esc(s.name)}</div><div class="s" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.url)}</div></div><button class="btn sm" data-sup="${i}" ${i ? '' : 'disabled'}>↑</button><button class="btn sm danger" data-sdel="${i}">✕</button></div>`).join('') || '<p class="muted small">None – add one below.</p>'}
    <div class="sec">Add a site</div><div class="field"><input type="text" id="sn" placeholder="Name, like My comic shop"></div><div class="field"><input type="text" id="su" placeholder="https://…/search?q={q}" autocapitalize="off" spellcheck="false"></div><button class="btn primary" id="sadd" style="width:100%">Add</button>
    <div class="sec">Or add a ready one</div><div class="chips">${SITE_PRESETS.filter(p => !l.some(x => x.url === p.url)).map(p => `<button class="chip" data-spre="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>`);
  const save = x => { lsSet('nvBooks.sites', x); sitesSheet() };
  $('#sadd').onclick = () => { const n = $('#sn').value.trim(), u = $('#su').value.trim(); if(!n || !/^https?:\/\//i.test(u)){ toast('Type a name and an address that starts with https://', 4000); return } save(l.concat({name:n, url:u})) };
  $('.sheet').addEventListener('click', e => { const up = e.target.closest('[data-sup]'), del = e.target.closest('[data-sdel]'), pre = e.target.closest('[data-spre]');
    if(up){ const i = +up.dataset.sup, x = l.slice(); [x[i - 1], x[i]] = [x[i], x[i - 1]]; save(x) } if(del){ const x = l.slice(); x.splice(+del.dataset.sdel, 1); save(x) }
    if(pre) save(l.concat(SITE_PRESETS.find(p => p.name === pre.dataset.spre))) }) }

/* the series page fetches the whole list by itself (once): find the series on Comic Vine if needed, then all its issues */
const SERLOAD = {};
const grVid = g => { const b = (g.all || g.items || []).find(x => x.cv && x.cv.id); return b ? b.cv.id : 0 };
async function serEnsure(sh, g){ const k = sh + '|' + g.key; if(SERLOAD[k] === 'busy') return; SERLOAD[k] = 'busy';
  const say = t => { const el = $('#serload'); if(el) el.textContent = t };
  try{ let vid = grVid(g);
    if(!vid){ say('Finding this series online…'); const books = g.items.filter(b => cvName(b)); if(!books.length){ SERLOAD[k] = 'none'; return }
      const hit = await findSeries(sh, books); if(!hit.id){ SERLOAD[k] = 'none'; return redrawIf(g) } await cvApply(books, hit, false); regroup(); vid = hit.id }
    if(!COLS[vid]){ say(`Getting every ${W(sh).i} from ${SRC_NAME[srcOf(vid)]}…`); const b = (g.all || g.items).find(x => x.cv && x.cv.id === vid) || g.items[0];
      await colAdd(sh, {id:vid, name:b.cv ? b.cv.name : g.name, start:b.cv ? b.cv.start : '', pub:b.cvPub || publisherOf(b)}, true) }
    SERLOAD[k] = 'done' }
  catch(e){ SERLOAD[k] = 'err:' + (e.message || String(e)); LE('cv', 'series list ' + g.name, e) }
  redrawIf(g) }
function redrawIf(g){ const v = cur(); if(v.v === 'group' && (v.key === g.key || (groupByKey(v.shelf, v.key) || {}).name === g.name)) draw(); else if(v.v === 'shelf') draw() }

/* =====================================================================================================================
   DISCOVER (owner, 19 Oct: "browse what's out there and discover new comics"): look around on Comic Vine without adding anything.
   New this week / this month (issues by their shop date), or every series of a publisher (A–Z, with a search). Tap one = preview of
   the whole series (your comics in colour, the rest grey) with "Add to my lists". Answers are kept for a day (kv 'disc:…').
   ===================================================================================================================== */
const DISC_PUBS = ['Marvel', 'DC Comics', 'Image', 'Dark Horse Comics', 'IDW Publishing', 'BOOM! Studios', 'Dynamite Entertainment', 'Titan Comics', 'Mad Cave Studios', 'Rebellion'];
async function discCache(key, maxAge, fn){ const c = await dbGet('kv', 'disc:' + key).catch(() => null); if(c && Date.now() - c.at < maxAge) return c.data;
  const data = await fn(); await dbPut('kv', {id:'disc:' + key, at:Date.now(), data}).catch(() => {}); return data }
const ymd = d => d.toISOString().slice(0, 10);
async function discNew(days){ const to = new Date(), from = new Date(Date.now() - days * 864e5);
  return discCache('new' + days + ':' + ymd(to), 6 * 3600e3, async () => { const out = [];
    for(let off = 0; off < 400; off += 100){ const j = await cvGet('issues', {filter:`store_date:${ymd(from)}|${ymd(to)}`, sort:'store_date:desc', limit:100, offset:off, field_list:'id,issue_number,name,store_date,image,volume'});
      for(const i of j.results || []) out.push({vid:i.volume && i.volume.id, vname:i.volume && i.volume.name, num:i.issue_number, date:i.store_date, thumb:i.image && (i.image.small_url || i.image.thumb_url) || ''});
      if(!j.results || j.results.length < 100) break }
    return out }) }
async function discPub(name){ return discCache('pub:' + norm(name), 7 * 864e5, async () => {
    const s = await cvGet('search', {resources:'publisher', query:name, limit:10, field_list:'id,name'}), p = (s.results || []).find(x => norm(x.name) === norm(name)) || (s.results || [])[0];
    if(!p) return {name, vols:[]};
    const j = await cvGet('publisher/4010-' + p.id, {field_list:'id,name,volumes'}), r = j.results || {};
    return {id:p.id, name:p.name, vols:(r.volumes || []).map(v => ({id:v.id, name:v.name}))} }) }
function drawDisc(v){ const s = shelfOf(v.shelf); $('#vtitle').textContent = 'Discover'; document.title = 'Discover · ' + s.name;
  const tabs = [['week', 'New this week'], ['month', 'New this month'], ['pub', 'By publisher']];
  let h = `<div class="chips">${tabs.map(([k, t]) => `<button class="chip ${v.tab === k ? 'on' : ''}" data-dtab="${k}">${t}</button>`).join('')}</div><div class="muted small" id="dst">Loading from Comic Vine…</div><div id="dbody"></div>`;
  $('#body').innerHTML = h;
  $('#body').querySelectorAll('[data-dtab]').forEach(b => b.onclick = () => { v.tab = b.dataset.dtab; draw() });
  const st = t => { const e = $('#dst'); if(e) e.textContent = t }, me = v;
  const mine = new Set(BOOKS.filter(b => b.cv && b.cv.id).map(b => b.cv.id));
  if(v.tab === 'week' || v.tab === 'month') discNew(v.tab === 'week' ? 7 : 31).then(list => { if(cur() !== me) return;
      const seen = new Set(), l = list.filter(i => i.vid && !seen.has(i.vid + '|' + i.num) && seen.add(i.vid + '|' + i.num));
      st(`${plural(l.length, 'new comic')} · tap one to see its whole series${l.length >= 400 ? ' (the newest 400)' : ''}`);
      $('#dbody').innerHTML = `<div class="grid">${l.map(i => `<div class="bk" data-cvs="${i.vid}"><div class="cv">${i.thumb ? `${remImg(i.thumb)}` : phHTML({title:i.vname, shelf:v.shelf}, i.vname)}<span class="vol">#${esc(i.num)}</span>${mine.has(i.vid) || COLS[i.vid] ? '<span class="bd dg">✓</span>' : ''}</div><div class="t">${esc(i.vname)}</div><div class="a">${esc(i.date || '')}</div></div>`).join('')}</div>` }).catch(e => st(e.message || String(e)));
  if(v.tab === 'pub'){ const seenP = new Set(), pubs = DISC_PUBS.concat(BOOKS.filter(b => b.shelf === v.shelf).map(publisherOf).filter(Boolean)).filter(p => { const k = norm(cleanPub(p)); if(seenP.has(k)) return false; seenP.add(k); return true });
    v.pub = v.pub || pubs[0];
    $('#dbody').innerHTML = `<div class="chips">${pubs.map(p => `<button class="chip ${cleanPub(p) === cleanPub(v.pub) ? 'on' : ''}" data-dpub="${esc(p)}">${esc(cleanPub(p))}</button>`).join('')}</div><input type="search" id="dq" placeholder="Search in this publisher's series" value="${esc(v.q || '')}" style="margin:4px 0 8px"><div id="dlist"></div>`;
    $('#dbody').querySelectorAll('[data-dpub]').forEach(b => b.onclick = () => { v.pub = b.dataset.dpub; v.q = ''; draw() });
    discPub(v.pub).then(P => { if(cur() !== me) return;
      const show = () => { const q = norm(v.q || ''), l = P.vols.filter(x => !q || norm(x.name).includes(q)).sort((a, b) => coll.compare(a.name, b.name));
        st(`${cleanPub(P.name)}: ${plural(P.vols.length, 'series', 'series')} on Comic Vine${q ? ` · ${l.length} found` : ''} · tap one to see all its issues`);
        $('#dlist').innerHTML = l.slice(0, 600).map(x => `<div class="li" data-cvs="${x.id}"><div class="n"><div>${esc(x.name)}</div></div><span class="r">${mine.has(x.id) ? '✓ you have comics' : COLS[x.id] ? '✓ in your lists' : ''}</span></div>`).join('') + (l.length > 600 ? `<p class="muted small">… and ${l.length - 600} more – type to narrow it down</p>` : '') };
      show(); const q = $('#dq'); q.oninput = () => { v.q = q.value; clearTimeout(q._t); q._t = setTimeout(show, 200) } }).catch(e => st(e.message || String(e))) }
  $('#dbody').onclick = e => { const t = e.target.closest('[data-cvs]'); if(t) go({v:'cvser', shelf:v.shelf, vid:+t.dataset.cvs}) } }   // on #dbody (new every draw), so one tap opens it once
/* a series from Comic Vine, before (or without) adding it: every issue, yours in colour */
const CVSER = {};
async function cvSerInfo(vid){ if(CVSER[vid]) return CVSER[vid];
  return CVSER[vid] = discCache('ser:' + vid, 864e5, async () => { const j = await cvGet('volume/4050-' + vid, {field_list:'id,name,start_year,publisher,count_of_issues,image,deck,description'}), r = j.results || {};
    return {id:r.id, name:r.name, start:r.start_year, pub:r.publisher && r.publisher.name, n:r.count_of_issues, img:r.image && (r.image.medium_url || r.image.small_url), about:cvStrip(r.deck || r.description).slice(0, 1500)} }) }
function drawCvSer(v){ if(COLS[v.vid]){ V[V.length - 1] = {v:'colser', shelf:v.shelf, vid:v.vid}; return draw() }
  $('#vtitle').textContent = ''; $('#body').innerHTML = '<div class="muted small" id="cst">Loading from Comic Vine…</div>'; const me = v;
  (async () => { try{ const info = await cvSerInfo(v.vid); if(cur() !== me) return; document.title = info.name + ' · Discover';
      let h = `<div class="alhead" style="align-items:flex-start">${info.img ? `<div class="cv" style="width:min(30vw,130px)"><img class="f" src="${esc(info.img)}" alt="" style="object-fit:cover"></div>` : ''}<div style="min-width:0;flex:1"><b>${esc(info.name)}${info.start ? ` (${esc(info.start)})` : ''}</b><div class="muted small">${esc(cleanPub(info.pub) || '')} · ${plural(info.n || 0, 'issue')}</div></div></div>
        <button class="btn primary" id="cvsadd" style="width:100%">Add to my collection lists</button>${info.about ? `<div class="desc clip" style="margin-top:12px" id="cvsab">${esc(info.about)}</div>` : ''}
        <div class="sec">Issues</div><div class="muted small" id="cst">Getting the issues…</div><div id="cvsgrid"></div>`;
      $('#body').innerHTML = h;
      $('#cvsadd').onclick = async () => { try{ const c = await colAdd(v.shelf, {id:info.id, name:info.name, start:info.start, pub:info.pub}); toast(`${info.name} added to your lists`); V[V.length - 1] = {v:'colser', shelf:v.shelf, vid:c.vid}; draw() }catch(e){ closeSheet(); toast(e.message || String(e), 5000) } };
      if(info.about && $('#cvsab')) $('#cvsab').onclick = e => e.currentTarget.classList.toggle('clip');
      if((info.n || 0) > 300){ $('#cst').innerHTML = `${plural(info.n, 'issue')} – a long series. <button class="btn sm" id="cvsall">Show them all</button>`; $('#cvsall').onclick = () => loadIss(); return }
      loadIss();
      async function loadIss(){ try{ $('#cst').textContent = 'Getting the issues…';
        const issues = await discCache('iss:' + v.vid, 864e5, () => cvAllIssues(v.vid, (n, t) => { const e = $('#cst'); if(e) e.textContent = `Getting the issues… ${n} of ${t || '?'}` })); if(cur() !== me) return;
        const tmp = {vid:v.vid, shelf:v.shelf, name:info.name, issues, phys:{}}, d = colDigital(tmp);
        $('#cst').textContent = `You have ${Object.keys(d).length} of ${issues.length}`; $('#cvsgrid').innerHTML = issueGridHTML(tmp, () => true); lazyCovers($('#cvsgrid'));
        $('#cvsgrid').querySelectorAll('[data-iss]').forEach(el => el.onclick = () => { const b = d[el.dataset.iss]; if(b) go({v:'book', id:b.id}); else issueSheet(tmp, issues.find(i => numKey(i.num) === el.dataset.iss)) }) }catch(e){ const el = $('#cst'); if(el) el.textContent = e.message || String(e) } } }
    catch(e){ const el = $('#cst'); if(el) el.textContent = e.message || String(e) } })() }

/* =====================================================================================================================
   UP NEXT (owner, 21 Oct – idea from Marvel Unlimited): a row on the home screen and on a shelf with, for every series you are reading,
   the next one: the comic you are in, else the next one you have that is not read yet. When the next NUMBER is missing (a collection
   list knows it, and it's not on paper) a grey tile shows it – tap = Find it. Newest read series first, at most 15.
   ===================================================================================================================== */
const listFor = b => (b.cv && COLS[b.cv.id]) || (b.series ? colsOf(b.shelf).find(c => bare(c.name) === bare(b.series)) : null) || null;
function upNext(sh, skip){ const out = [], seen = new Set();
  const touched = (sh ? inShelf(sh) : BOOKS).filter(b => b.series && started(b)).sort((a, b) => lastRead(b) - lastRead(a));
  for(const b of touched){ const key = b.shelf + '|' + norm(b.series); if(seen.has(key)) continue; seen.add(key);
    const l = seriesList(b); let hi = -1; l.forEach((x, i) => { if(started(x)) hi = Math.max(hi, i) }); const at = l[hi] || b;
    const nxt = !(STATE[at.id] || {}).finished ? at : l.slice(hi + 1).find(x => !(STATE[x.id] || {}).finished) || null;
    const c = at.num != null && (STATE[at.id] || {}).finished ? listFor(at) : null;
    if(c){ const d = colDigital(c), P = c.phys || {}, want = c.issues.find(i => i.num > at.num && !P[numKey(i.num)]);
      if(want && !d[numKey(want.num)] && (!nxt || nxt.num == null || nxt.num > want.num)){ out.push({miss:true, c, i:want, b:at}); if(out.length >= 15) break; continue } }
    if(nxt && nxt !== skip) out.push({b:nxt}); if(out.length >= 15) break }
  return out }
function upNextHTML(sh, skip){ const l = upNext(sh, skip); if(!l.length) return '';
  UPN = l; return `<div class="sec">Up next</div><div class="hrow">${l.map((x, n) => x.miss
      ? `<div class="bk iss miss" data-upmiss="${n}"><div class="cv">${x.i.thumb ? `${remImg(x.i.thumb)}` : phHTML({title:x.c.name, shelf:x.c.shelf}, x.c.name)}<span class="vol">${esc(x.i.label)}</span></div><div class="t">${esc(x.b.series)} ${esc(x.i.label)}</div><div class="a">You don't have it yet</div></div>`
      : bookTile(x.b)).join('')}</div>` }
let UPN = [];
document.addEventListener('click', e => { const t = e.target.closest('[data-upmiss]'); if(!t) return; const x = UPN[+t.dataset.upmiss]; if(x) issueSheet(x.c, x.i) });

/* =====================================================================================================================
   READING ORDERS (owner, 21 Oct – idea from Marvel Unlimited's reading guides): a story arc or event from Comic Vine (Secret Wars,
   House of X …) as one list across several series, in reading order: yours in colour (tap = read), the others grey (tap = Find it).
   Comic Vine: search?resources=story_arc → story_arc/4045-<id> (its issues) → issues?filter=id:a|b|c (number, series, date, cover,
   100 per request). Order: by cover date (year-month), Comic Vine's own order inside a month (tie-ins come out together).
   Stored in kv 'arc:<id>' = {id, aid, shelf, name, pub, deck, img, items:[{iid, vid, vname, num, label, name, date, img, thumb}], at}.
   ===================================================================================================================== */
let ARCS = {};
async function loadArcs(){ ARCS = {}; for(const r of await dbAll('kv')) if(String(r.id).startsWith('arc:')) ARCS[r.aid] = r }
const arcsOf = sh => Object.values(ARCS).filter(a => a.shelf === sh);
/* your comic for an item of an order: the same Comic Vine series and number, else the same series name and number */
function arcOwned(a){ const by = {}, byName = {};
  for(const b of inShelf(a.shelf)){ if(b.num == null) continue; if(b.cv && srcOf(b.cv.id) === 'cv') by[b.cv.id + '|' + numKey(b.num)] = by[b.cv.id + '|' + numKey(b.num)] || b;
    else if(b.series) byName[bare(b.series) + '|' + numKey(b.num)] = byName[bare(b.series) + '|' + numKey(b.num)] || b }
  const m = {}; for(const it of a.items){ const b = by[it.vid + '|' + numKey(it.num)] || byName[bare(it.vname) + '|' + numKey(it.num)]; if(b) m[it.iid] = b } return m }
function arcStats(a){ const m = arcOwned(a), P = it => ((COLS[it.vid] || {}).phys || {})[numKey(it.num)];
  return {total:a.items.length, have:a.items.filter(it => m[it.iid] || P(it)).length, read:a.items.filter(it => m[it.iid] && (STATE[m[it.iid].id] || {}).finished).length, m, P} }
async function arcFetch(aid, onStep){ const j = await cvGet('story_arc/4045-' + aid, {field_list:'id,name,deck,description,publisher,image,issues'}), r = j.results || {};
  const ids = (r.issues || []).map(x => x.id), info = {};
  for(let i = 0; i < ids.length; i += 100){ onStep && onStep(i, ids.length);
    const k = await cvGet('issues', {filter:'id:' + ids.slice(i, i + 100).join('|'), limit:100, field_list:'id,issue_number,name,cover_date,store_date,image,volume'});
    for(const x of k.results || []) info[x.id] = x }
  const items = ids.map((id, n) => { const x = info[id]; if(!x || !x.volume) return null; const num = parseFloat(x.issue_number);
      return {iid:id, vid:x.volume.id, vname:x.volume.name, num:isNaN(num) ? 0 : num, label:'#' + x.issue_number, name:x.name || '', date:x.cover_date || x.store_date || '', img:x.image && (x.image.medium_url || x.image.small_url) || '', thumb:x.image && (x.image.small_url || x.image.thumb_url) || '', n} }).filter(Boolean)
    .sort((a, b) => (a.date.slice(0, 7) || '9999').localeCompare(b.date.slice(0, 7) || '9999') || a.n - b.n);
  return {name:r.name, pub:r.publisher && r.publisher.name || '', deck:cvStrip(r.deck || r.description).slice(0, 1500), img:r.image && (r.image.medium_url || r.image.small_url) || '', items} }
async function arcAdd(sh, aid){ if(ARCS[aid]) return ARCS[aid];
  sheet(`<h3>Getting the reading order…</h3><div class="prog busy"><i></i></div><div class="muted small" id="aas"></div>`, true);
  try{ const f = await arcFetch(aid, (n, t) => { const s = $('#aas'); if(s) s.textContent = `${n} of ${t} issues`; });
    const a = Object.assign({id:'arc:' + aid, aid, shelf:sh, at:Date.now()}, f); ARCS[aid] = a; await dbPut('kv', a); closeSheet(); return a }
  catch(e){ closeSheet(); throw e } }
function arcTile(a){ const st = arcStats(a), first = a.items.find(it => st.m[it.iid]);
  const cov = first ? coverHTML(st.m[first.iid]) : `<div class="cv">${a.img || (a.items[0] || {}).thumb ? `${remImg(a.img || a.items[0].thumb)}` : phHTML({title:a.name, shelf:a.shelf}, a.name)}</div>`;
  return `<div class="bk stack" data-arc="${a.aid}">${cov}<span class="cdl">${st.have} of ${st.total}</span><div class="pbar"><i style="width:${st.total ? Math.round(100 * st.read / st.total) : 0}%"></i></div><div class="t">${esc(a.name)}</div><div class="a">${esc([cleanPub(a.pub), st.read ? st.read + ' read' : ''].filter(Boolean).join(' · ') || ' ')}</div></div>` }
function drawArcs(v){ const s = shelfOf(v.shelf), as = arcsOf(v.shelf).sort((a, b) => coll.compare(a.name, b.name));
  $('#vtitle').textContent = s.name; document.title = 'Reading orders · ' + s.name;
  let h = colTabs(v.shelf, 'arcs') + `<div class="mbar"><button class="btn primary sm" id="arcadd">+ Find a reading order</button></div>`;
  h += as.length ? `<div class="mtot">${plural(as.length, 'reading order')}</div><div class="grid">${as.map(arcTile).join('')}</div>`
    : `<div class="empty"><h2 style="margin:4px 0;font-size:17px">No reading orders yet</h2><p class="muted small" style="margin:0">A reading order is a big story or event told over several series (like <b>Secret Wars</b>, <b>House of X</b> or <b>Court of Owls</b>), in the order to read it: yours in colour, the others grey. Tap <b>+ Find a reading order</b>. (Comic Vine)</p></div>`;
  $('#body').innerHTML = h; lazyCovers($('#body'));
  $('#arcadd').onclick = () => arcSearch(v.shelf);
  $('#body').querySelectorAll('[data-arc]').forEach(el => el.onclick = () => go({v:'arc', shelf:v.shelf, aid:+el.dataset.arc})) }
function arcSearch(sh){ if(!CV.key()) return cvKeySheet(() => arcSearch(sh)); let res = [];
  sheet(`<h3>Find a reading order</h3><div style="display:flex;gap:8px"><input type="search" id="asq" placeholder="An event or story, like Secret Wars or Civil War"><button class="btn primary" id="asgo">Search</button></div><div class="muted small" id="asst" style="margin:6px 0">Reading orders come from Comic Vine's story arcs.</div><div id="asres"></div><button class="btn" style="width:100%;margin-top:10px" onclick="closeSheet()">Close</button>`);
  const run = async () => { const q = $('#asq').value.trim(); if(!q) return; $('#asst').textContent = 'Searching…'; $('#asres').innerHTML = '';
    try{ const j = await cvGet('search', {resources:'story_arc', query:q, limit:30, field_list:'id,name,publisher,image,deck,count_of_isssue_appearances'}); res = j.results || [];
      $('#asst').textContent = res.length ? 'Tap one to get its reading order' : 'Nothing found - try other words';
      $('#asres').innerHTML = res.map((r, n) => `<div class="li" data-ares="${n}"><span class="th"><div class="cv">${r.image && r.image.thumb_url ? `<img class="f" src="${esc(r.image.thumb_url)}" alt="" style="object-fit:cover">` : ''}</div></span><div class="n"><div>${esc(r.name)}</div><div class="s">${esc(cleanPub(r.publisher && r.publisher.name) || '?')}${r.count_of_isssue_appearances ? ' · ' + plural(r.count_of_isssue_appearances, 'issue') : ''}</div></div><span class="r">${ARCS[r.id] ? '✓ yours' : ''}</span></div>`).join('') }
    catch(e){ $('#asst').textContent = e.message || String(e) } };
  $('#asgo').onclick = run; $('#asq').onkeydown = e => { if(e.key === 'Enter') run() }; setTimeout(() => $('#asq').focus(), 50);
  $('#asres').onclick = async e => { const r = e.target.closest('[data-ares]'); if(!r) return; const x = res[+r.dataset.ares];
    try{ const a = await arcAdd(sh, x.id); go({v:'arc', shelf:sh, aid:a.aid}) }catch(err){ toast(err.message || String(err), 5000) } } }
function drawArc(v){ const a = ARCS[v.aid]; if(!a){ V.pop(); return draw() } const st = arcStats(a), f = S.filter['arc'] || 'all';
  $('#vtitle').textContent = ''; document.title = a.name + ' · Reading order';
  const next = a.items.find(it => st.m[it.iid] && !(STATE[st.m[it.iid].id] || {}).finished), nb = next && st.m[next.iid];
  let h = `<div class="alhead" style="align-items:center"><div style="min-width:0;flex:1"><b>${esc(a.name)}</b><div class="muted small">${esc(cleanPub(a.pub))}${a.pub ? ' · ' : ''}reading order of ${plural(st.total, 'issue')}</div>
    <div class="muted small">you have ${st.have} · read ${st.read}</div><div class="pbar" style="max-width:260px"><i style="width:${st.total ? Math.round(100 * st.read / st.total) : 0}%"></i></div></div><button class="ib" id="armenu" aria-label="More for this reading order">${IC_DOTS}</button></div>`;
  if(nb) h += `<div class="mbar"><button class="btn primary" data-read="${esc(nb.id)}" style="flex:1;min-width:0"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${started(nb) ? 'Continue' : 'Read next'}: ${esc(next.vname)} ${esc(next.label)}</span></button></div>`;
  if(a.deck) h += `<div class="desc clip" id="arab" style="margin-bottom:8px">${esc(a.deck)}</div>`;
  h += `<div class="chips">${[['all', 'All'], ['have', 'I have'], ['miss', 'Missing'], ['unread', 'Not read yet']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-arf="${k}">${t}</button>`).join('')}</div>`;
  const pass = it => { const b = st.m[it.iid], p = st.P(it); return f === 'have' ? b || p : f === 'miss' ? !b && !p : f === 'unread' ? !(b && (STATE[b.id] || {}).finished) : true };
  h += `<div class="grid">${a.items.map((it, n) => [it, n]).filter(([it]) => pass(it)).map(([it, n]) => { const b = st.m[it.iid], p = st.P(it), done = b && (STATE[b.id] || {}).finished;
      const cov = b ? coverHTML(b) : `<div class="cv">${it.thumb ? `${remImg(it.thumb)}` : phHTML({title:it.vname, shelf:a.shelf}, it.vname)}</div>`;
      return `<div class="bk iss ${b || p ? '' : 'miss'}" data-ait="${n}">${cov.replace(/<\/div>$/, `<span class="vol">${n + 1}</span>${b ? '<span class="bd dg">D</span>' : ''}${p ? `<span class="bd pp${b ? '' : ' solo'}">P</span>` : ''}${done ? '<span class="done">READ</span>' : ''}</div>`)}<div class="t">${esc(it.vname)} ${esc(it.label)}</div><div class="a">${esc([it.date.slice(0, 7), it.name].filter(Boolean).join(' · ') || ' ')}</div></div>` }).join('')}</div>`;
  $('#body').innerHTML = h; lazyCovers($('#body'));
  if($('#arab')) $('#arab').onclick = e => e.currentTarget.classList.toggle('clip');
  $('#body').querySelectorAll('[data-arf]').forEach(b => b.onclick = () => { S.filter['arc'] = b.dataset.arf; saveS(); draw() });
  $('#body').querySelectorAll('[data-ait]').forEach(el => el.onclick = () => { const it = a.items[+el.dataset.ait], b = st.m[it.iid]; if(b) return go({v:'book', id:b.id});
    const c = COLS[it.vid] || {vid:it.vid, shelf:a.shelf, name:it.vname, issues:[], phys:{}}, i = (c.issues || []).find(x => numKey(x.num) === numKey(it.num)) || {num:it.num, label:it.label, name:it.name, date:it.date, img:it.img, thumb:it.thumb};
    issueSheet(c, i); if(!COLS[it.vid]) $('.sheet').insertAdjacentHTML('beforeend', `<button class="btn" id="araddser" style="width:100%;margin-top:8px">Add ${esc(it.vname)} to my collection lists</button>`);
    const ad = $('#araddser'); if(ad) ad.onclick = async () => { try{ await colAdd(a.shelf, {id:it.vid, name:it.vname}); toast(`${it.vname} added to your lists`); draw() }catch(e){ toast(e.message || String(e), 5000) } } });
  $('#armenu').onclick = () => { sheet(`<h3>${esc(a.name)}</h3><div class="mlist"><button class="btn" id="arnew">Check Comic Vine again</button><button class="btn" id="arcopy">Copy the missing issues as a list</button><button class="btn danger" id="ardel">Remove this reading order</button></div><p class="muted small">Removing it keeps your comics.</p>`);
    $('#arnew').onclick = async () => { closeSheet(); try{ const f2 = await arcFetch(a.aid); Object.assign(a, f2, {at:Date.now()}); await dbPut('kv', a); draw(); toast(plural(a.items.length, 'issue') + ' in this reading order') }catch(e){ toast(e.message || String(e), 5000) } };
    $('#arcopy').onclick = () => copyText(a.items.filter(it => !st.m[it.iid] && !st.P(it)).map(it => `${it.vname} ${it.label}`).join('\n'));
    $('#ardel').onclick = async () => { if(!confirm(`Remove the reading order “${a.name}”? Your comics stay.`)) return; await dbDel('kv', a.id); delete ARCS[a.aid]; closeSheet(); V.pop(); draw() } } }

/* ---------- a file handed over by another app: Boardgames' rulebooks, errata and fan-made files (plans/boardgames.md) ----------
   books/index.html?open=board:<file id> reads the file from Boardgames' own storage (IndexedDB nvBoard: files = details, blobs = the file)
   and opens it in this reader. It is NOT put on a shelf; only the reading place and bookmarks are kept (state 'board:<id>').
   Closing the reader goes back to Boardgames. */
async function openHanded(id){
  const d = await new Promise(ok => { try{ const r = indexedDB.open('nvBoard'); r.onupgradeneeded = () => { try{ r.transaction.abort() }catch(e){} }; r.onsuccess = () => ok(r.result); r.onerror = () => ok(null) }catch(e){ ok(null) } });
  if(!d || !d.objectStoreNames.contains('files') || !d.objectStoreNames.contains('blobs')){ if(d) d.close(); throw new Error('This file is not on this device any more') }
  const get = (s, k) => new Promise((ok, no) => { const q = d.transaction(s).objectStore(s).get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error) });
  let f, bl; try{ f = await get('files', id); bl = await get('blobs', id) }finally{ d.close() }
  if(!f || !bl || !bl.blob) throw new Error('This file is not on this device any more');
  const blob = bl.blob, name = f.fname || f.name || 'file', src = srcFromBlob(blob, name);
  const fmt = IMG_RE.test(name) || /^image\//.test(blob.type) ? 'imgs' : await realFmt(src, name);
  if(!fmt) throw new Error('Bookcase cannot show this kind of file');
  const b = {id:'board:' + id, shelf:'rulebooks', handed:true, fmt, title:f.name || name, name, size:blob.size, pages:0, src:{kind:'blob', blob}};
  BK[b.id] = b;                                    // not in BOOKS, so it shows on no shelf
  document.title = b.title + ' · Boardgames';
  await openReader(b) }
function leaveHanded(){ if(history.length > 1) history.back(); else location.replace('../boardgames/index.html') }

/* =====================================================================================================================
   GOOGLE DRIVE AS A SOURCE (owner, 21 Oct): a Drive folder of YOUR OWN, shared with "Anyone with the link can view", works like a phone
   folder – Bookcase looks through it and its subfolders and fills the shelf; you read straight from Drive (PDF/CBZ in parts with Range,
   no full download to open a book); "Download to this phone" keeps a copy for offline / print (b.src.fid; Remove the downloaded copy).
   Drive API v3 with the owner's own API key (restricted to the Drive API; kept on this device: nvBooks.gkey, never in the code).
   Checked 21 Oct (probe-drive.yml): CORS ok (also the Range preflight), alt=media + Range → 206, thumbnailLink = a ready cover (CORS *).
   Folders are remembered in nvBooks.folders as {tree:'gd:<folder id>', name, shelf}; a book: src {kind:'drive', uri:'gd:<file id>', id, name, size, tree}.
   No "share with friends": this is for your own folder only (owner agreed, 21 Oct).
   ===================================================================================================================== */
const GD = 'https://www.googleapis.com/drive/v3/', gkey = () => lsGet('nvBooks.gkey', '');
const gdFolderId = t => { t = String(t || '').trim(); const m = t.match(/folders\/([A-Za-z0-9_-]{10,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || t.match(/^([A-Za-z0-9_-]{20,})$/); return m ? m[1] : '' };
const fetchT = (url, opt, ms) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, Object.assign({}, opt || {}, {signal:c.signal})).finally(() => clearTimeout(t)) };
async function gdFetch(url, hdr, ms){ let r;
  try{ r = await fetchT(url, {headers:hdr || {}, cache:'no-store'}, ms || 60000) }catch(e){ throw new Error(e && e.name === 'AbortError' ? 'Google Drive took too long to answer' : 'Google Drive could not be reached – no internet?') }
  if(r.status === 403 || r.status === 400){ let m = ''; try{ m = ((await r.json()).error || {}).message || '' }catch(e){} throw new Error(/key/i.test(m) ? 'Google says the key is not right (Bookcase ⚙ → Google key)' : /rate|quota|limit/i.test(m) ? 'Google says: too many requests – try again in a few minutes' : 'Google Drive refused: ' + (m || r.status)) }
  if(r.status === 404) throw new Error('Not found on Google Drive – is the folder shared with “Anyone with the link”?');
  if(!r.ok && r.status !== 206) throw new Error('Google Drive answered ' + r.status); return r }
/* The Android app reads Drive with Android's own connection (CapacitorHttp): from the app's web view (origin https://localhost) Drive's
   file downloads failed with "Failed to fetch" (owner's log, 22 Oct) – listing and covers worked. A browser uses fetch (CORS is fine there). */
const b64u8 = d => { const bin = atob(String(d || '').replace(/^data:[^,]*,/, '')), u8 = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8 };
/* Google's "Sorry… unusual traffic" page (owner's phone, 22 Oct, after adding 1,800 books): Google thinks the requests come from a robot.
   It goes away by itself after a while; until then Bookcase stops asking (asking more makes it last longer). */
let GDBLOCK = 0; const GDBUSY = 'Google is pausing downloads from this phone for a while (it saw a lot of requests at once and thinks it might be a robot). Try again in an hour or two – or on another network (home wifi instead of 5G).';
async function driveRead(id, a, z){ if(z <= a) return new ArrayBuffer(0); if(GDBLOCK > Date.now()) throw new Error(GDBUSY);
  const url = `${GD}files/${id}?alt=media&key=${encodeURIComponent(gkey())}`, H = cvHttp();
  for(let t = 0; ; t++){ try{
      if(H){ let r; try{ r = await H.get({url, headers:{Range:`bytes=${a}-${z - 1}`}, responseType:'blob', connectTimeout:30000, readTimeout:90000}) }catch(e){ throw new Error('Google Drive could not be reached – no internet?') }
        if(r.status === 403 || r.status === 400){ let why = ''; try{ const t = typeof r.data === 'string' ? (r.data.length < 20000 ? (() => { try{ return new TextDecoder().decode(b64u8(r.data)) }catch(x){ return r.data } })() : '') : JSON.stringify(r.data); const j = JSON.parse(t.slice(t.indexOf('{'))); why = ((j.error || {}).errors || [{}])[0].reason + ': ' + (j.error || {}).message }catch(x){ why = String(typeof r.data === 'string' ? r.data.slice(0, 300) : JSON.stringify(r.data || '').slice(0, 300)) }
          LE('drive', `refused ${r.status} for ${id}`, why);
          if(/Sorry\.\.\.|unusual traffic|automated queries/i.test(String(r.data && typeof r.data === 'string' && r.data.length < 20000 ? (() => { try{ return new TextDecoder().decode(b64u8(r.data)) }catch(x){ return r.data } })() : '') + why)){ GDBLOCK = Date.now() + 30 * 60000; throw new Error(GDBUSY) }
          throw new Error(/key/i.test(why) && !/quota|limit/i.test(why) ? 'Google says the key is not right (Bookcase ⚙ → Google key)' : `Google Drive refused (${r.status}): ${why.slice(0, 160)}`) }
        if(r.status === 404) throw new Error('Not found on Google Drive – is the folder still shared with “Anyone with the link”?');
        if(r.status >= 400) throw new Error('Google Drive answered ' + r.status);
        const u8 = b64u8(r.data); return (r.status === 200 && u8.length > z - a ? u8.slice(a, z) : u8).buffer }
      const r = await gdFetch(url, {Range:`bytes=${a}-${z - 1}`}), b = await r.arrayBuffer();
      return r.status === 200 && b.byteLength > z - a ? b.slice(a, z) : b }catch(e){ if(t >= 2 || /key|refused|Not found|pausing/.test(e.message)) throw e; await sleep(800 * (t + 1)) } } }
/* the whole file (Download to this phone): in 8 MB parts, so a big PDF never has to fit in one answer */
async function driveBlob(f, onPart){ const parts = []; for(let a = 0; a < f.size; a += 8 * 1048576){ parts.push(await driveRead(f.id, a, Math.min(f.size, a + 8 * 1048576))); onPart && onPart(Math.min(f.size, a + 8 * 1048576), f.size) }
  return new Blob(parts, {type:f.name && /\.pdf$/i.test(f.name) ? 'application/pdf' : 'application/octet-stream'}) }
function srcFromDrive(f){ return {size:f.size, name:f.name, read:(a, z) => driveRead(f.id, a, Math.min(z, f.size)), blob:() => driveBlob(f)} }
const gdThumb = async u => { try{ const r = await fetchT(String(u).replace(/=s\d+$/, '=s600'), {}, 20000); return r.ok ? await r.blob() : null }catch(e){ return null } };
/* every file in a folder and its subfolders (one request per folder, 1000 per page) */
async function driveList(root, onStep){ const out = [], todo = [{id:root, path:''}]; let folders = 0;
  while(todo.length){ const d = todo.shift(); folders++; let tok = ''; if(folders > 1) await sleep(250);   // gently: 300+ folder requests in a row made Google suspicious
    do{ const q = new URLSearchParams({q:`'${d.id}' in parents and trashed = false`, key:gkey(), pageSize:'1000', fields:'nextPageToken,files(id,name,mimeType,size,thumbnailLink)', supportsAllDrives:'true', includeItemsFromAllDrives:'true'});
      if(tok) q.set('pageToken', tok); const j = await (await gdFetch(GD + 'files?' + q)).json();
      for(const f of j.files || []){ if(f.mimeType === 'application/vnd.google-apps.folder') todo.push({id:f.id, path:d.path + f.name + '/'});
        else if(f.size) out.push({f:{uri:'gd:' + f.id, id:f.id, name:f.name, size:+f.size, thumb:f.thumbnailLink || ''}, path:d.path + f.name}) }
      tok = j.nextPageToken || ''; onStep && onStep(out.length, folders) }while(tok) }
  return out }
/* details of a Drive book without downloading it: PDF / EPUB from the name + Drive's own cover picture (fast for 1000s of books);
   CBZ / CBR are read in parts like a phone file (ComicInfo.xml, cover page) */
async function driveMeta(src, f, dir){ const e = ext(f.name);
  if(e === 'pdf' || e === 'epub'){ const p = parseName(f.name, dir), md = {fmt:e, series:p.series, num:p.num, vol:p.vol, title:p.title || (p.series ? '' : p.clean), year:p.year, publisher:'', writer:'', artist:'', desc:'', pages:0, rtl:null, cover:null};
    if(f.thumb) md.cover = await gdThumb(f.thumb);
    if(!md.cover) md.later = true;   // no picture from Drive: the cover is made from page 1 when you first open it (opening a 60 MB PDF for every book made adding very slow)
    return md }
  const md = await readMeta(src, f.name, dir);
  if(!md.cover && f.thumb) md.cover = await gdThumb(f.thumb);
  return md }
function driveKeySheet(then){
  sheet(`<h3>Google Drive key</h3><p class="muted small" style="margin:0 0 10px">Your own Google API key (it starts with AIza), restricted to the Google Drive API. It only lets Bookcase see Drive folders that are shared with a link. It stays on this phone.</p>
    <div class="field"><label>Your key</label><input type="text" id="gdk" value="${esc(gkey())}" placeholder="AIza…" autocomplete="off" spellcheck="false"></div>
    <div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="gdksave">Save</button></div>`);
  $('#gdksave').onclick = () => { const k = $('#gdk').value.trim().replace(/\s+/g, ''); if(!/^AIza[0-9A-Za-z_-]{30,}$/.test(k)){ toast('That does not look like a Google key (it starts with AIza)', 4000); return } lsSet('nvBooks.gkey', k); closeSheet(); toast('Key saved'); if(then) then() } }
function driveSheet(shelf){ if(!gkey()) return driveKeySheet(() => driveSheet(shelf));
  sheet(`<h3>From Google Drive</h3><p class="muted small" style="margin:0 0 10px">In Google Drive: the folder → Share → General access: <b>Anyone with the link</b> (Viewer) → Copy link. Paste the link here. All folders inside it are read too.</p>
    <div class="field"><label>Folder link</label><input type="text" id="gdl" placeholder="https://drive.google.com/drive/folders/…" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label>Name (optional)</label><input type="text" id="gdn" placeholder="Like My colouring books"></div>
    <div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="gdgo">Look in this folder</button></div>
    <button class="btn sm" id="gdkey2" style="margin-top:10px">Change the Google key</button>`);
  $('#gdkey2').onclick = () => driveKeySheet(() => driveSheet(shelf));
  $('#gdgo').onclick = () => { const id = gdFolderId($('#gdl').value); if(!id){ toast('That is not a Drive folder link', 4000); return } driveAdd(shelf, {id, name:$('#gdn').value.trim() || 'Google Drive'}) } }
async function driveAdd(shelf, f){ const tree = 'gd:' + f.id;
  awake(true); sheet(`<h3>Looking in “${esc(f.name)}” on Google Drive…</h3><div class="prog busy"><i></i></div><div class="small" id="gdst">Starting…</div><p class="muted small">Only the list of files is read now – books are read from Drive when you open them.</p>`, true);
  let list; try{ list = await driveList(f.id, (n, d) => { const e = $('#gdst'); if(e) e.textContent = `${plural(n, 'file')} · ${plural(d, 'folder')}` }) }
  catch(e){ awake(false); closeSheet(); toast(e.message || String(e), 6000); LE('drive', 'list ' + f.name, e); return }
  const fl = lsGet('nvBooks.folders', []); if(!fl.some(x => x.tree === tree && x.shelf === shelf)){ fl.push({tree, name:f.name, shelf}); lsSet('nvBooks.folders', fl) }
  L('drive', `“${f.name}” for ${shelf}: ${list.length} files`);
  const {items, notyet} = toItems(list); scan(items, shelf, {tree, name:f.name, drive:true}, notyet) }
/* Download to this phone / remove the downloaded copy (the book stays, read from Drive again) */
async function driveDownload(bs){ bs = bs.filter(b => b.src.kind === 'drive' && !b.src.fid && b.fmt !== 'imgs'); if(!bs.length) return;
  const need = bs.reduce((a, b) => a + (b.size || 0), 0);
  try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); const e = await navigator.storage.estimate(); if(e && e.quota && e.quota - e.usage < need * 1.05){ toast(`Not enough space: ${mb(need)} needed, ${mb(e.quota - e.usage)} free`, 5000); return } }catch(e){}
  let stop = false, n = 0; awake(true);
  sheet(`<h3>Downloading ${plural(bs.length, 'book')} (${mb(need)})…</h3><div class="prog"><i id="gdp"></i></div><div class="muted small" id="gds"></div><button class="btn" id="gdstop" style="width:100%;margin-top:8px">Stop</button>`, true);
  $('#gdstop').onclick = () => { stop = true };
  for(const b of bs){ if(stop) break; const s = $('#gds'); if(s) s.textContent = `${n + 1} of ${bs.length} · ${b.name}`;
    try{ const blob = await driveBlob(b.src, (d, t) => { const e = $('#gds'); if(e) e.textContent = `${n + 1} of ${bs.length} · ${b.name} · ${mb(d)} of ${mb(t)}` }), fid = uid(); await dbPut('files', {id:fid, blob}); b.src.fid = fid; await dbPut('books', b) }
    catch(e){ toast(`${b.name}: ${e.message || e}`, 5000); LE('drive', 'download ' + b.name, e); if(/key|refused|too many/.test(e.message || '')) break }
    n++; const p = $('#gdp'); if(p) p.style.width = (100 * n / bs.length) + '%' }
  awake(false); closeSheet(); draw(); toast(`${plural(bs.filter(b => b.src.fid).length, 'book')} on this phone – they work without internet now`, 4000) }
async function driveUndownload(bs){ for(const b of bs) if(b.src.kind === 'drive' && b.src.fid){ await dbDel('files', b.src.fid).catch(() => {}); delete b.src.fid; await dbPut('books', b) } draw(); toast('Downloaded copy removed – the book stays, read from Drive') }
