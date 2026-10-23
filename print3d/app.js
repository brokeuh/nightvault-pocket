/* Nightvault 3D Print (test) – the app. Plan: plans/print3d.md in nightvault-src.
   Parts: basics · storage · files and projects · groups (shared ../hub/nvgroups.js) · pictures and previews · tiles · screens (models, project, model, prints) ·
   the 3D viewer (viewer.js) · adding (phone folder, copy into the app, ZIP downloads, the PC) · the print log · menus · select · settings · start */
'use strict';

/* ---------- basics ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const coll = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});
const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hue = s => { let h = 0; for(const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360 };
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateTxt = d => { if(!d) return ''; const [y, m, dd] = d.split('-').map(Number); if(!m) return d; return `${dd} ${MONTHS[m - 1].slice(0, 3)}${y !== new Date().getFullYear() ? ' ' + y : ''}` };
const agoTxt = d => { if(!d) return ''; const days = Math.round((Date.parse(today()) - Date.parse(d)) / 864e5); return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? days + ' days ago' : dateTxt(d) };
const mb = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const hm = min => { min = Math.round(min || 0); if(!min) return ''; const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ' ' + m + ' min' : ''}` : m + ' min' };
const mm = d => d ? d.map(x => x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')).join(' × ') + ' mm' : '';
let toastT = 0; function toast(m, ms){ const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 2600) }
window.toast = toast;
const L = (a, t, d) => { try{ window.NVLOG && NVLOG.log(a, t, d) }catch(e){} }, LE = (a, t, d) => { try{ window.NVLOG && NVLOG.error(a, t, d) }catch(e){} };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
const S = Object.assign({sort:{}, grouped:true, filter:'all', pfilter:'all', color:'#9fb8c8'}, lsGet('nvPrint.settings', {}));
const saveS = () => lsSet('nvPrint.settings', S);
const fromHub = () => { try{ return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
try{ if(new URLSearchParams(location.search).get('nv') === 'hub') sessionStorage.setItem('nvHub', '1'); if(fromHub()) $('#hubback').hidden = false }catch(e){}
const IC_DOTS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const IC_CUBE = '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>';
const cube = (size, color) => `<svg width="${size || 26}" height="${size || 26}" viewBox="0 0 24 24" fill="none" stroke="${color || '#7fd8e8'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${IC_CUBE}</svg>`;
const PINB = '<span class="pinb">★</span>';
let NvFiles = null; if(NATIVE) try{ NvFiles = Capacitor.registerPlugin('NvFiles') }catch(e){ NvFiles = null }
const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const linkUrl = (uri, name) => '/_nvfile_/' + b64url(uri) + '/' + encodeURIComponent(name);
function openUrl(u){ try{ const w = window.open(u, '_blank'); if(!w) location.href = u }catch(e){ location.href = u } }

/* ---------- storage: IndexedDB 'nvPrint' ----------
   models : one per model file {id, name, file, ext, size, root, dir, src:{kind:'link', uri, tree}|{kind:'copy', bid}|null, pc:{id, gid, cover}|null,
            local:{bid, rec}|null (a PC model kept on this phone), added, tags:[own], link, notes, todo, dims, tris, fmt, thErr, proj3mf}
   extras : the other files of a project {id, kind:'sliced'|'resin'|'scene'|'pic'|'doc', name, ext, size, root, dir, src, pc, info:{slice, project}}
   blobs  : {id, blob} files copied into the app      pics : {id, blob} 'th:<model>' preview, 'emb:<id>' picture inside a 3MF, 'it:<model>' / 'grp:<key>' own picture
   prints : {id, model, proj, title, date, printer, type:'filament'|'resin', mat, color, amount, time (min), ok, note, at}      kv : spare */
let DB = null;
function openDB(){ return new Promise((ok, no) => { const r = indexedDB.open('nvPrint', 1);
  r.onupgradeneeded = () => { const d = r.result; for(const s of ['models', 'extras', 'blobs', 'pics', 'prints', 'kv']) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}) };
  r.onblocked = () => toast('Close the other 3D Print tab, then reload', 6000);
  r.onsuccess = () => ok(DB = r.result); r.onerror = () => no(r.error) }) }
function tx(store, mode, fn){ return new Promise((ok, no) => { const t = DB.transaction(store, mode), st = t.objectStore(store); let res; const q = fn(st); if(q) q.onsuccess = () => res = q.result; t.oncomplete = () => ok(res); t.onerror = t.onabort = () => no(t.error || new Error('Storage error')) }) }
const dbGet = (s, id) => tx(s, 'readonly', st => st.get(id));
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbKeys = s => tx(s, 'readonly', st => st.getAllKeys());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));
const dbPutMany = (s, list) => tx(s, 'readwrite', st => { for(const v of list) st.put(v) });
const dbDelMany = (s, ids) => tx(s, 'readwrite', st => { for(const id of ids) st.delete(id) });

/* ---------- files and projects ---------- */
const MODEL_RE = /\.(stl|obj|3mf)$/i, FDM_RE = /\.(gcode\.3mf|gcode|bgcode)$/i, RESIN_RE = /\.(ctb|cbddlp|goo|pwmx|pwma|pwms|pwmb|pwmo|pm3|pm3m|pm3r|pm4n|prz|jxs|photon|photons|sl1|sl1s|zip\.ctb)$/i;
const SCENE_RE = /\.(lys|lyt|chitubox|step|stp|f3d|scad|blend|fcstd)$/i, PIC_RE = /\.(jpe?g|png|webp|gif|avif)$/i, DOC_RE = /\.(pdf|txt|md)$/i;
const kindOf = name => FDM_RE.test(name) ? 'sliced' : RESIN_RE.test(name) ? 'resin' : MODEL_RE.test(name) ? 'model' : SCENE_RE.test(name) ? 'scene' : PIC_RE.test(name) ? 'pic' : DOC_RE.test(name) ? 'doc' : '';
const extOf = name => (/\.gcode\.3mf$/i.test(name) ? 'gcode.3mf' : (String(name).match(/\.([a-z0-9]+)$/i) || [0, ''])[1].toLowerCase());
const stem = name => String(name).replace(/\.gcode\.3mf$/i, '').replace(/\.[a-z0-9]+$/i, '');
const niceName = name => stem(name).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || name;
/* folder names that say nothing about the project ("files", "STL", "supported" …): files in Dragon/STL/supported belong to the project "Dragon" */
const GENERIC_DIR = /^(files?|stls?|objs?|3mfs?|models?|print ?files|printfiles|supported|unsupported|pre-?supported|presupported|supports?|lychee|chitubox|images?|pictures?|photos?|renders?|parts?|bambu( ?studio)?|prusa(slicer)?|orca(slicer)?|cura|g-?code|sliced|resin|fdm|fff|\d+(\.\d+)? ?mm|\d+ ?%|scaled?|v\d+(\.\d+)*|version ?\d+)$/i;
function projOf(r){ if(!r) return null; const segs = String(r.dir || '').split('/').filter(Boolean);
  while(segs.length && GENERIC_DIR.test(segs[segs.length - 1].trim())) segs.pop();
  if(!segs.length) return null;
  const name = segs[segs.length - 1].replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return {key:'p:' + norm((r.pc ? 'pc ' : '') + (r.root || '') + ' ' + segs.join(' ')), name} }
const GENERIC_TAGS = new Set('stl stls obj 3mf 3d model models file files print prints printing printable download downloads final fixed support supports supported unsupported presupported pre mesh meshes zip new folder the and for with part parts pack set stuff misc other thingiverse printables makerworld cults version copy scaled scale body base'.split(' '));
function autoTags(m){ const out = [], parts = String(m.dir || '').split('/').filter(Boolean).slice(-4).concat([stem(m.file || m.name)]);
  for(const p of parts) for(let w of p.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_\-.()[\],+&]+/)){ w = w.toLowerCase().trim();
    if(w.length >= 3 && !GENERIC_TAGS.has(w) && !/^v?\d+([.,]\d+)?(mm)?$/.test(w) && !out.includes(w)) out.push(w) }
  if(m.dims){ const big = Math.max(...m.dims); out.push(big < 40 ? 'small' : big < 130 ? 'medium' : 'large') }
  return out.slice(0, 10) }
const tagsOf = m => { const own = m.tags || [], a = autoTags(m).filter(t => !own.some(o => norm(o) === norm(t)) && !(m.noTags || []).includes(t)); return {own, auto:a} };
const whereTxt = m => m.local ? 'Kept on this phone (from the PC)' : m.src && m.src.kind === 'link' ? 'Phone folder “' + (m.root || '') + '”' : m.src && m.src.kind === 'copy' ? 'Copied into the app' : m.pc ? 'On the PC' + (m.root ? ' · ' + m.root : '') : '';

/* ---------- models in memory ---------- */
let MODELS = [], MI = {}, EXTRAS = [], PRINTS = [];
const hidden = () => new Set(lsGet('nvPrint.hidden', []));
function reindex(){ MI = Object.fromEntries(MODELS.map(m => [m.id, m])); regroup(); printStats() }
const onPhone = m => !!(m.local || (m.src && (m.src.kind === 'copy' || (m.src.kind === 'link' && NATIVE))));
const away = m => !onPhone(m) && !(m.pc && PCON);

/* ---------- groups: the shared way of every Nightvault app (../hub/nvgroups.js, plans/shared-groups.md) ----------
   automatic group: a project = the files in one folder (Dragon/STL/supported → "Dragon"); a ZIP download is its own project */
const SH = 'models';
let GR = null;
function grOf(){ return GR || (GR = NVGROUPS.make({prefix:'nvPrint', app:'print3d', title:'3D Print', itemsKey:'itemGroup', norm, key:x => x.id,
  hay:x => [x.name, x.dir].filter(Boolean).join(' '), kinds:{proj:'Project'},
  auto:x => { if(lsGet('nvPrint.noAuto', false)) return null; const p = projOf(x); return p ? {key:p.key, name:p.name, kind:'proj'} : null },
  onRekey:async (from, to) => { const gm = lsGet('nvPrint.gmeta', {}); if(gm[from]){ gm[to] = gm[from]; delete gm[from]; lsSet('nvPrint.gmeta', gm) }
    const id = 'grp:' + from; if(!PICS.has(id)) return; const c = await dbGet('pics', id).catch(() => null); if(c){ await setPic('grp:' + to, c.blob); draw() } }})) }
let GROUPCACHE = null;
const regroup = () => { GROUPCACHE = null };
const groupsOf = () => GROUPCACHE || (GROUPCACHE = grOf().build(MODELS));
const grChange = (sh, fn, msg) => { const G = grOf(); G.change(fn); regroup(); G.undoToast(msg, () => { regroup(); selEnd(true); draw() }) };
const groupByKey = (sh, k) => groupsOf().groups.find(g => g.key === k) || null;
const groupOfItem = m => groupsOf().groups.find(g => g.items.includes(m)) || null;
const G_path = g => grOf().path(g, groupsOf().groups);
const gmeta = k => lsGet('nvPrint.gmeta', {})[k] || {};
const setGmeta = (k, patch) => { const o = lsGet('nvPrint.gmeta', {}); o[k] = Object.assign({}, o[k] || {}, patch); lsSet('nvPrint.gmeta', o) };
/* the extra files (print files, pictures) that belong with a group: those of every project inside it */
function extrasOf(g){ const keys = new Set([g.key]); for(const m of g.all || g.items){ const p = projOf(m); if(p) keys.add(p.key) }
  return EXTRAS.filter(e => { const p = projOf(e); return p && keys.has(p.key) }) }
/* the files that belong with a model: its project's, or (loose files) those starting with the same name: dragon.stl ↔ dragon.gcode.3mf, dragon.jpg */
const extrasNear = m => { const p = projOf(m); if(p) return EXTRAS.filter(e => { const q = projOf(e); return q && q.key === p.key });
  const s = norm(stem(m.file)); return EXTRAS.filter(e => e.root === m.root && e.dir === m.dir && !e.pc === !m.pc && norm(stem(e.name)).startsWith(s)) };

/* ---------- pictures: own picture > a picture with the same name in the folder > the picture inside a 3MF > our own preview > the PC's ---------- */
const PICS = new Set(), PICURL = {}, BLOBURL = {};
async function picUrl(id){
  if(id.startsWith('blob:')){ const b = id.slice(5); if(BLOBURL[b]) return BLOBURL[b]; const c = await dbGet('blobs', b).catch(() => null); return c ? (BLOBURL[b] = URL.createObjectURL(c.blob)) : null }
  if(!PICS.has(id)) return null; if(PICURL[id]) return PICURL[id]; const c = await dbGet('pics', id).catch(() => null); if(!c){ PICS.delete(id); return null } return PICURL[id] = URL.createObjectURL(c.blob) }
async function setPic(id, blob){ await dbPut('pics', {id, blob}); PICS.add(id); if(PICURL[id]){ URL.revokeObjectURL(PICURL[id]); delete PICURL[id] } }
async function delPic(id){ await dbDel('pics', id).catch(() => {}); PICS.delete(id); if(PICURL[id]){ URL.revokeObjectURL(PICURL[id]); delete PICURL[id] } }
async function thumb(blob){
  let bm; try{ bm = await createImageBitmap(blob) }catch(e){ const u = URL.createObjectURL(blob); try{ const im = new Image(); im.src = u; await im.decode(); bm = im }finally{ setTimeout(() => URL.revokeObjectURL(u), 1000) } }
  const sc = Math.min(1, 800 / Math.max(bm.width, bm.height)), w = Math.round(bm.width * sc), h = Math.round(bm.height * sc), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h); if(bm.close) bm.close();
  return new Promise(ok => c.toBlob(b => ok(b), 'image/webp', .85)) }
const pickPicture = () => new Promise(ok => { const i = $('#pickpic'); i.value = ''; i.onchange = async e => { const f = e.target.files[0]; ok(f ? await thumb(f) : null) }; i.click() });
window.imgOk = el => { const ph = el.parentNode && el.parentNode.querySelector('.ph'); if(ph) ph.style.visibility = 'hidden' };
window.imgFail = el => { const cv = el.closest('.cv'); if(cv) cv.querySelectorAll('img').forEach(i => i.remove()) };
const covIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ covIO.unobserve(e.target); fillCov(e.target) } }, {rootMargin:'300px'}) : null;
async function fillCov(el){ const u = await picUrl(el.dataset.cov); if(!u) return; el.querySelectorAll('img').forEach(i => i.remove()); el.insertAdjacentHTML('afterbegin', `<img class="b" src="${u}" alt=""><img class="f" src="${u}" alt="" onload="imgOk(this)">`) }
function lazyCovers(root){ (root || document).querySelectorAll('[data-cov]').forEach(el => { const k = el.dataset.cov; if(!k.startsWith('blob:') && !PICS.has(k)) return; covIO ? covIO.observe(el) : fillCov(el) }) }
/* a picture file (from a folder, the app or the PC): an address now, or a stored blob to load lazily */
function fileImg(e){ if(!e) return null;
  if(e.src && e.src.kind === 'link' && NATIVE) return {url:linkUrl(e.src.uri, e.name)};
  if(e.src && e.src.kind === 'copy') return {cov:'blob:' + e.src.bid};
  if(e.pc && PCON) return {url:NVPC.url('/nv/file?id=' + encodeURIComponent(e.pc.id))};
  return null }
const PHOTOWORD = /cover|preview|render|thumb|main|photo|print|showcase|title|front/i;
function photoFor(m){ const pics = extrasNear(m).filter(e => e.kind === 'pic'); if(!pics.length) return null;
  return pics.find(e => norm(stem(e.name)) === norm(stem(m.file))) || null }
function projPhoto(list){ const pics = list.filter(e => e.kind === 'pic'); if(!pics.length) return null;
  return pics.slice().sort((a, b) => (PHOTOWORD.test(b.name) - PHOTOWORD.test(a.name)) || a.dir.length - b.dir.length || coll.compare(a.name, b.name))[0] }
function coverSrc(m){ if(PICS.has('it:' + m.id)) return {cov:'it:' + m.id};
  const ph = fileImg(photoFor(m)); if(ph) return ph;
  if(PICS.has('emb:' + m.id)) return {cov:'emb:' + m.id};
  if(PICS.has('th:' + m.id)) return {cov:'th:' + m.id};
  if(m.pc && m.pc.cover && PCON) return {url:NVPC.url('/nv/mcover?id=' + encodeURIComponent(m.pc.gid))};
  return null }
const hasCover = m => !!coverSrc(m);
function phHTML(name, sub){ const h = hue(name || '');
  return `<div class="ph" style="--c1:hsl(${h} 35% 24%);--c2:hsl(${(h + 50) % 360} 30% 12%)">${cube(22, '#fff')}${esc(name || '')}<span>${esc(sub || '')}</span></div>` }
function srcHTML(c, extra, label){ const im = c && c.url ? `<img class="b" src="${esc(c.url)}" alt="" loading="lazy" onerror="imgFail(this)"><img class="f" src="${esc(c.url)}" alt="" loading="lazy" onerror="imgFail(this)" onload="imgOk(this)">` : '';
  return `<div class="cv"${c && c.cov ? ` data-cov="${esc(c.cov)}"` : ''}>${phHTML(label.n, label.s)}${im}${extra || ''}</div>` }
const coverHTML = (m, extra) => srcHTML(coverSrc(m), extra, {n:m.name, s:(m.ext || '').toUpperCase()});
const RNDCOV = {};
function groupCoverHTML(sh, g){ const G = grOf(), c = G.cover(g.key), all = (g.all || g.items).slice().sort(byName);
  if(c.t === 'pic' && PICS.has('grp:' + g.key)) return srcHTML({cov:'grp:' + g.key}, '', {n:g.name});
  let m = null; if(c.t === 'item') m = all.find(x => x.id === c.al);
  const wc = all.filter(hasCover);
  if((c.t === 'random' || c.t === 'cycle') && wc.length){ m = wc.find(x => x.id === RNDCOV[g.key]) || wc[Math.floor(Math.random() * wc.length)]; RNDCOV[g.key] = m.id }
  if(!m && !c.t){ const ph = fileImg(projPhoto(extrasOf(g))); if(ph) return srcHTML(ph, '', {n:g.name}) }
  m = m || wc[0] || all[0]; return m ? coverHTML(m) : srcHTML(null, '', {n:g.name}) }
setInterval(() => { if(document.hidden || !GROUPCACHE) return; let any = false;
  for(const g of GROUPCACHE.groups) if(grOf().cover(g.key).t === 'cycle'){ delete RNDCOV[g.key]; any = true }
  const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if(any && !typing && !sheetOpen() && !SEL && (cur().v === 'home' || cur().v === 'group')){ const y = scrollY; draw(); scrollTo(0, y) } }, 6000);

/* ---------- prints per model ---------- */
let PS = {};
function printStats(){ PS = {}; const add = (k, p) => { const s = PS[k] || (PS[k] = {n:0, ok:0, last:'', lastOk:null}); s.n++; if(p.ok !== false) s.ok++; if((p.date || '') >= s.last){ s.last = p.date || ''; s.lastOk = p.ok } };
  for(const p of PRINTS){ if(p.model) add(p.model, p); if(p.proj) add(p.proj, p) } }
const stOf = id => PS[id] || {n:0, ok:0, last:''};
function groupPrints(g){ const ids = new Set((g.all || g.items).map(m => m.id)), keys = new Set([g.key]); for(const m of g.all || g.items){ const p = projOf(m); if(p) keys.add(p.key) }
  return PRINTS.filter(p => ids.has(p.model) || (p.proj && keys.has(p.proj))) }

/* ---------- tiles ---------- */
const subLine = m => m.dims ? mm(m.dims) : [(m.ext || '').toUpperCase(), m.size ? mb(m.size) : ''].filter(Boolean).join(' · ');
function itemTile(m){ const s = stOf(m.id), G = grOf();
  const badge = s.n ? `<span class="ok${s.lastOk === false ? ' bad' : ''}">${s.lastOk === false ? '✗' : '✓'} ${s.n}×</span>` : '';
  const src = m.pc && !onPhone(m) ? `<span class="src${PCON ? '' : ' off'}">PC</span>` : '';
  return `<div class="bk${away(m) && m.pc ? ' away' : ''}" data-item="${esc(m.id)}">${coverHTML(m, (G.isPinned('it:' + m.id) ? PINB : '') + (m.todo ? '<span class="tag">To print</span>' : '') + src + badge)}
    <div class="t">${esc(m.name)}</div><div class="a">${esc(subLine(m) || ' ')}</div></div>` }
function groupTile(sh, g){ const all = g.all || g.items, k = (g.kids || []).length, G = grOf(), n = groupPrints(g).length, ex = extrasOf(g).filter(e => e.kind === 'sliced' || e.kind === 'resin').length;
  return `<div class="bk stack" data-grp="${esc(g.key)}">${groupCoverHTML(sh, g)}${G.isPinned('gr:' + g.key) ? PINB : ''}<span class="cdl">${k ? plural(k, 'group') + ' · ' : ''}${all.length ? plural(all.length, 'model') : 'empty'}</span>
    <div class="t">${esc(g.name)}</div><div class="a">${esc([g.kind === 'proj' ? '' : G.label(g), ex ? plural(ex, 'print file') : '', n ? n + '× printed' : ''].filter(Boolean).join(' · ') || G.label(g))}</div></div>` }

/* ---------- screens: a stack of views ---------- */
let V = [{v:'home'}];
const cur = () => V[V.length - 1];
function go(v){ selEnd(true); V.push(v); draw(); scrollTo(0, 0) }
function back(){ if(FULL){ fullView(false); return true } if(SEL){ selEnd(); return true } if(V.length > 1){ V.pop(); draw(); return true } return false }
$('#vback').onclick = () => back();
let Q = '';
const SORTS = {
  home:[['name', 'Name'], ['added', 'Recently added'], ['printed', 'Most printed'], ['last', 'Last printed'], ['big', 'Biggest'], ['size', 'File size']],
  inside:[['name', 'Name'], ['added', 'Recently added'], ['printed', 'Most printed'], ['last', 'Last printed'], ['big', 'Biggest'], ['size', 'File size']]};
const sortOf = (page, key) => S.sort[key || page] || SORTS[page][0][0];
const sortSel = (page, key) => `<select data-sort="${page}" data-skey="${esc(key || page)}" aria-label="Sort">${SORTS[page].map(([k, t]) => `<option value="${k}" ${sortOf(page, key) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const byName = (a, b) => coll.compare(a.name, b.name);
function sortVal(x, k){ const all = x.items ? (x.all || x.items) : [x];
  switch(k){ case 'added': return Math.max(0, ...all.map(i => i.added || 0));
    case 'printed': return x.items ? groupPrints(x).length : stOf(x.id).n;
    case 'last': return x.items ? groupPrints(x).map(p => p.date || '').sort().pop() || '' : stOf(x.id).last || '';
    case 'big': return Math.max(0, ...all.map(i => i.dims ? Math.max(...i.dims) : 0));
    case 'size': return all.reduce((n, i) => n + (i.size || 0), 0); default: return 0 } }
function sortTiles(list, k){ if(k === 'name' || !k) return list.slice().sort((a, b) => coll.compare(norm(a.name), norm(b.name)));
  return list.slice().sort((a, b) => { const va = sortVal(a, k), vb = sortVal(b, k); const c = typeof va === 'string' ? vb.localeCompare(va) : vb - va; return c || coll.compare(norm(a.name), norm(b.name)) }) }
const FILTERS = [['all', 'All'], ['todo', 'To print'], ['printed', 'Printed'], ['never', 'Never printed']];
const passFilter = (m, f) => f === 'todo' ? !!m.todo : f === 'printed' ? stOf(m.id).n > 0 : f === 'never' ? !stOf(m.id).n : true;

function draw(){
  const v = cur(), body = $('#body'); $('#vback').hidden = V.length < 2;
  if(v.v !== 'model') dropViewer();
  $('#addbtn').hidden = !(v.v === 'home' || v.v === 'prints' || v.v === 'group'); $('#addlbl').textContent = v.v === 'prints' ? 'Log a print' : 'Add';
  $('#prbtn').hidden = v.v === 'prints';
  $('#hubback').hidden = !(fromHub() && V.length < 2);
  if(v.v === 'home') return drawHome(body);
  if(v.v === 'group') return drawGroup(body, v);
  if(v.v === 'model') return drawModel(body, v.id);
  if(v.v === 'prints') return drawPrints(body) }

function pcLineHTML(){ if(!window.NVPC || !NVPC.native) return '';
  if(!NVPC.pc) return '';
  const n = MODELS.filter(m => m.pc).length, at = lsGet('nvPrint.pcAt', 0);
  return `<div class="pcline ${PCON ? 'ok' : PCON === false ? 'no' : ''}"><i></i><span>${esc(NVPC.pc.name || 'My PC')}: ${PCBUSY ? 'getting the list…' : PCON === false ? 'not reachable now (at home? Nightvault running?)' : PCON ? 'connected' : 'checking…'}${n ? ' · ' + plural(n, 'model') : ''}${at && !PCBUSY ? ' · ' + new Date(at).toLocaleDateString() : ''}</span><button class="btn sm" id="pcref">${PCBUSY ? '…' : 'Refresh'}</button></div>` }
function busyLine(){ const n = THQ.length + (THBUSY ? 1 : 0); return n > 1 ? `<div class="store" style="margin:4px 0 0">Making previews… ${n} to go</div>` : '' }
function drawHome(body){ $('#vtitle').textContent = '3D Print'; document.title = 'Nightvault 3D Print';
  if(!MODELS.length){ body.innerHTML = pcLineHTML() + `<div class="empty">${cube(48)}<h2 style="margin:8px 0 4px;font-size:18px">No models yet</h2><p class="muted small" style="margin:0 0 14px">Add your STL, OBJ and 3MF files: a folder on this phone, files (or ZIP downloads from Printables / Thingiverse) copied into the app, or the 3D models on your PC.</p><button class="btn primary" id="emptyadd">Add models</button></div>`;
    $('#emptyadd').onclick = addSheet; hookPc(); return }
  const q = norm(Q), G = grOf(), f = S.filter || 'all';
  let h = pcLineHTML() + `<input type="search" id="q" placeholder="Search models, projects and tags" value="${esc(Q)}" style="margin:2px 0 8px">`;
  if(q){ const {groups:gs} = groupsOf(), where = {}; for(const g of gs) for(const x of g.items) where[x.id] = G.path(g, gs);
    const gm = gs.filter(g => norm(g.name).includes(q)).slice(0, 12);
    const im = MODELS.filter(m => norm([m.name, m.file, m.dir, (m.tags || []).join(' '), autoTags(m).join(' '), m.notes].join(' ')).includes(q)).sort(byName);
    if(!gm.length && !im.length) h += '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
    if(gm.length) h += `<div class="sec">Projects and groups</div><div class="grid">${gm.map(g => groupTile(SH, g).replace(/<div class="a">[^<]*<\/div>/, g.parent ? `<div class="a">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : '$&')).join('')}</div>`;
    if(im.length) h += `<div class="sec">Models</div><div class="grid">${im.slice(0, 300).map(x => itemTile(x).replace(/<div class="a">[^<]*<\/div>/, where[x.id] ? `<div class="a">in ${esc(where[x.id])}</div>` : '$&')).join('')}</div>` }
  else { h += `<div class="chips">${FILTERS.map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${t}${k === 'todo' ? ` (${MODELS.filter(m => m.todo).length})` : ''}</button>`).join('')}</div>`;
    const grouped = S.grouped !== false;
    h += `<div class="mbar"><select id="grouped" aria-label="Groups"><option value="1" ${grouped ? 'selected' : ''}>Grouped</option><option value="0" ${!grouped ? 'selected' : ''}>All models</option></select>${sortSel('home')}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button><button class="btn sm" id="newgrp">+ Group</button></div>`;
    const vis = MODELS.filter(m => passFilter(m, f)), k = sortOf('home'), {groups, singles} = groupsOf();
    h += `<div class="mtot">${plural(vis.length, 'model')}${grouped && f === 'all' ? ' · ' + plural(groups.filter(g => g.kind === 'proj').length, 'project') : ''} · ${mb(vis.reduce((n, m) => n + (m.size || 0), 0))}${PRINTS.length && f === 'all' ? ' · ' + PRINTS.length + '× printed' : ''}</div>`;
    let tiles = !grouped || f !== 'all' ? sortTiles(vis, k) : sortTiles([...groups.filter(g => !g.parent), ...singles], k);
    tiles = G.pinFirst(tiles, x => x.items ? 'gr:' + x.key : 'it:' + x.id);
    h += tiles.length ? `<div class="grid">${tiles.map(x => x.items ? groupTile(SH, x) : itemTile(x)).join('')}</div>` : '<p class="muted" style="text-align:center;margin-top:30px">Nothing here yet.</p>' }
  h += busyLine();
  body.innerHTML = h; lazyCovers(body); hookPc();
  const qi = $('#q'); if(qi) qi.oninput = () => { Q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const p = qi.selectionStart; draw(); const n = $('#q'); if(n){ n.focus(); try{ n.setSelectionRange(p, p) }catch(e){} } }, 250) };
  hookGrid() }
function hookPc(){ const b = $('#pcref'); if(b) b.onclick = () => pcRefresh(true) }

/* ---------- a project / group ---------- */
function fileLi(e){ const info = e.info && e.info.slice, ic = e.kind === 'resin' ? 'Resin print file' : e.kind === 'sliced' ? 'Print file' : e.kind === 'scene' ? 'Slicer / CAD file' : e.kind === 'doc' ? 'Document' : 'File';
  const sub = info ? [hm(info.time / 60), info.grams ? info.grams + ' g' : '', [...new Set((info.fil || []).map(f => f.type).filter(Boolean))].join(' + '), info.plates > 1 ? plural(info.plates, 'plate') : ''].filter(Boolean).join(' · ') : ic + ' · ' + extOf(e.name).toUpperCase();
  const c = PICS.has('emb:' + e.id) ? {cov:'emb:' + e.id} : null;
  return `<div class="sliced" data-extra="${esc(e.id)}">${srcHTML(c, '', {n:'', s:''})}<div style="flex:1;min-width:0"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.name)}</div><div class="muted small">${esc(sub)}${e.size ? ' · ' + mb(e.size) : ''}</div></div></div>` }
function drawGroup(body, v){ const G = grOf(), g = groupByKey(SH, v.key); if(!g){ V.pop(); return draw() }
  const gs = groupsOf().groups, all = g.all, ex = extrasOf(g), meta = gmeta(g.key), prints = groupPrints(g).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#vtitle').textContent = ''; document.title = g.name + ' · 3D Print';
  let h = `<div class="alhead"><div class="stack" style="flex:none;margin-right:10px"><div class="gcv" style="width:min(32vw,140px)">${groupCoverHTML(SH, g)}</div></div><div style="min-width:0;flex:1"><b>${esc(g.name)}</b>
    ${g.parent ? `<div class="lnk small" data-gotogrp="${esc(g.parent)}">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : ''}
    <div class="muted small">${esc(g.kind === 'proj' ? 'Project' : G.label(g))} · ${(g.kids || []).length ? plural(g.kids.length, 'group') + ' · ' : ''}${plural(all.length, 'model')}${prints.length ? ` · ${prints.length}× printed` : ''}</div>
    ${meta.link ? `<div class="lnk small" data-open="${esc(meta.link)}">${esc(siteName(meta.link))}</div>` : ''}</div></div>`;
  h += `<div class="mbar"><button class="btn primary" id="glog" style="flex:1">I printed this</button><button class="ib" id="gmenu" aria-label="More for this group">${IC_DOTS}</button></div>`;
  if(meta.notes) h += `<div class="desc" style="margin:4px 0 8px">${esc(meta.notes)}</div>`;
  const pf = ex.filter(e => e.kind === 'sliced' || e.kind === 'resin' || e.kind === 'scene' || e.kind === 'doc');
  if(pf.length) h += `<div class="sec">Print files</div>${pf.sort((a, b) => (b.kind === 'sliced') - (a.kind === 'sliced') || coll.compare(a.name, b.name)).slice(0, 30).map(fileLi).join('')}`;
  const pics = ex.filter(e => e.kind === 'pic'), shown = pics.map(e => [e, fileImg(e)]).filter(x => x[1]);
  if(shown.length) h += `<div class="sec">Pictures</div><div class="recent">${shown.slice(0, 20).map(([e, c]) => `<div class="bk" data-pic="${esc(e.id)}" style="width:110px">${srcHTML(c, '', {n:'', s:''})}</div>`).join('')}</div>`;
  const key = 'grp:' + g.key, k = sortOf('inside', key);
  h += `<div class="sec">Models</div><div class="mbar">${sortSel('inside', key)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button></div>`;
  h += `<div class="grid">${G.pinFirst([...sortTiles(g.kids || [], k), ...sortTiles(g.items, k)], x => x.items ? 'gr:' + x.key : 'it:' + x.id).map(x => x.items ? groupTile(SH, x) : itemTile(x)).join('')}</div>`;
  if(!all.length) h += `<p class="muted small" style="margin-top:12px">Empty. Tap ⋯ → <b>Add models…</b> to put models in it.</p>`;
  if(prints.length) h += `<div class="sec">Prints</div>${prints.slice(0, 10).map(printLi).join('')}`;
  body.innerHTML = h; lazyCovers(body); hookGrid();
  $('#gmenu').onclick = () => groupMenu(SH, g); $('#glog').onclick = () => logPrint({proj:g.key, title:g.name}) }

/* ---------- a model: the 3D viewer, facts, tags, prints ---------- */
const siteName = u => { try{ const h = new URL(u).hostname.replace(/^www\./, ''); return ({'printables.com':'Printables', 'thingiverse.com':'Thingiverse', 'makerworld.com':'MakerWorld', 'cults3d.com':'Cults', 'myminifactory.com':'MyMiniFactory', 'thangs.com':'Thangs'})[h] ? 'Open on ' + ({'printables.com':'Printables', 'thingiverse.com':'Thingiverse', 'makerworld.com':'MakerWorld', 'cults3d.com':'Cults', 'myminifactory.com':'MyMiniFactory', 'thangs.com':'Thangs'})[h] : 'Open ' + h }catch(e){ return 'Open the link' } };
const COLORS = ['#9fb8c8', '#e8e4dc', '#3a3f45', '#d9534f', '#f0ad4e', '#5cb85c', '#4a90d9', '#9b6bd3'];
const IC = {
  reset:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  spin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M17 8.5l2 .5-.6 2"/></svg>',
  full:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  grid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>'};
function drawModel(body, id){ const m = MI[id]; if(!m){ V.pop(); return draw() }
  const s = stOf(m.id), g = groupOfItem(m), {own, auto} = tagsOf(m), ex = extrasNear(m).filter(e => e.kind !== 'pic'), prints = PRINTS.filter(p => p.model === m.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#vtitle').textContent = ''; document.title = m.name + ' · 3D Print';
  let h = `<div class="v3" id="v3"><div class="msg" id="v3msg"><div class="spin"></div><span>Opening the model…</span></div>
      <div class="vt"><button class="vb" data-v="reset" aria-label="Reset the view">${IC.reset}</button><button class="vb" data-v="spin" aria-label="Turn by itself">${IC.spin}</button><button class="vb ${S.grid === false ? '' : 'on'}" data-v="grid" aria-label="Floor grid">${IC.grid}</button>
      <span style="flex:1"></span>${COLORS.map(c => `<button class="sw" data-col="${c}" style="background:${c}${(S.color || COLORS[0]) === c ? ';box-shadow:0 0 0 2px #7fd8e8' : ''}" aria-label="Colour"></button>`).join('')}<button class="vb" data-v="full" aria-label="Full screen">${IC.full}</button></div></div>
    <div style="display:flex;gap:10px;align-items:flex-start"><div style="min-width:0;flex:1"><b style="font-size:19px;line-height:1.25;display:block">${esc(m.name)}</b>
      ${g ? `<div class="lnk small" data-gotogrp2="1">in ${esc(G_path(g))}</div>` : ''}
      <div class="muted small" style="margin-top:4px">${s.n ? `Printed ${s.n}×${s.last ? ', last ' + agoTxt(s.last) : ''}${s.n - s.ok ? ` · ${s.n - s.ok} failed` : ''}` : 'Not printed yet'}</div></div></div>
    <div class="mbar" style="margin-top:10px"><button class="btn primary" id="mlog" style="flex:1">I printed this</button><button class="btn" id="mtodo">${m.todo ? '✓ To print' : '+ To print'}</button><button class="ib" id="mmenu" aria-label="More">${IC_DOTS}</button></div>`;
  const stats = [['Size', m.dims ? mm(m.dims) : ''], ['Triangles', m.tris ? m.tris.toLocaleString() : ''], ['Format', m.fmt || (m.ext || '').toUpperCase()], ['File size', m.size ? mb(m.size) : ''],
    ['Made for', m.proj3mf ? [m.proj3mf.printer, m.proj3mf.filament, m.proj3mf.layer ? m.proj3mf.layer + ' mm layers' : ''].filter(Boolean).join(' · ') : '']].filter(x => x[1]);
  h += `<div class="stats" id="mstats">${stats.map(([k, x]) => `<div class="stat"><small>${k}</small><b>${esc(x)}</b></div>`).join('')}</div>`;
  h += `<div class="tags">${own.map(t => `<button class="tg own" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}${auto.map(t => `<button class="tg" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}<button class="tg add" id="addtag">+ tag</button></div>`;
  if(m.link) h += `<div class="mlist" style="margin:6px 0"><button class="btn" data-open="${esc(m.link)}">${esc(siteName(m.link))}</button></div>`;
  if(m.notes) h += `<div class="sec">Notes</div><div class="desc">${esc(m.notes)}</div>`;
  if(ex.length) h += `<div class="sec">Print files next to it</div>${ex.slice(0, 12).map(fileLi).join('')}`;
  if(prints.length) h += `<div class="sec">Prints</div>${prints.map(printLi).join('')}`;
  h += `<div class="sec">Details</div><div class="facts"><span>File</span><span style="min-width:0;overflow-wrap:anywhere">${esc(m.file)}</span>${m.dir ? `<span>Folder</span><span style="min-width:0;overflow-wrap:anywhere">${esc(m.dir)}</span>` : ''}<span>Where</span><span>${esc(whereTxt(m))}</span><span>Added</span><span>${m.added ? new Date(m.added).toLocaleDateString() : ''}</span></div>`;
  body.innerHTML = h; lazyCovers(body);
  $('#mmenu').onclick = () => itemMenu(m); $('#mlog').onclick = () => logPrint({model:m.id});
  $('#mtodo').onclick = async () => { m.todo = !m.todo; await dbPut('models', m); toast(m.todo ? 'On your “To print” list' : 'Off the “To print” list'); draw() };
  $('#addtag').onclick = () => ask('Add a tag', 'Like dragon, gift, tabletop', '', 'Add').then(async t => { if(!t) return; m.tags = [...new Set((m.tags || []).concat(t.split(',').map(x => x.trim()).filter(Boolean)))]; await dbPut('models', m); draw() });
  body.querySelectorAll('[data-gotogrp2]').forEach(el => el.onclick = () => { if(g) go({v:'group', key:g.key}) });
  showViewer(m) }

/* ---------- the viewer on the model page ---------- */
let VIEW = null, FULL = false, MESH = {id:null, mesh:null}, VTOK = 0;
function dropViewer(){ if(VIEW){ try{ VIEW.destroy() }catch(e){} VIEW = null } FULL = false }
function fullView(on){ const el = $('#v3'); if(!el) return; FULL = on; el.classList.toggle('full', on); if(VIEW) VIEW.draw() }
async function showViewer(m){ dropViewer(); const tok = ++VTOK, box = $('#v3'), msg = $('#v3msg');
  const fail = t => { if(tok !== VTOK || !$('#v3msg')) return; $('#v3msg').innerHTML = `${cube(40, '#55606d')}<span>${t}</span>`; };
  box.querySelector('.vt').onclick = e => { const b = e.target.closest('[data-v],[data-col]'); if(!b) return;
    if(b.dataset.col){ S.color = b.dataset.col; saveS(); if(VIEW) VIEW.setColor(S.color); box.querySelectorAll('.sw').forEach(x => x.style.boxShadow = x === b ? '0 0 0 2px #7fd8e8' : ''); return }
    const k = b.dataset.v; if(!VIEW && k !== 'full') return;
    if(k === 'reset') VIEW.reset(); if(k === 'spin') b.classList.toggle('on', VIEW.autoRotate(!VIEW.spin));
    if(k === 'grid'){ S.grid = S.grid === false; saveS(); b.classList.toggle('on', S.grid !== false); if(VIEW){ VIEW.o.grid = S.grid !== false; VIEW.draw() } }
    if(k === 'full') fullView(!FULL) };
  let mesh = MESH.id === m.id ? MESH.mesh : null;
  if(!mesh){ let blob;
    if(m.size > 60e6) $('#v3msg span').textContent = `Opening the model… (${mb(m.size)}, this takes a moment)`;
    try{ blob = await modelBlob(m) }catch(e){ return fail(esc(e.message || String(e))) }
    if(tok !== VTOK) return;
    try{ mesh = await NVMESH.parse(blob, m.file) }catch(e){ LE('viewer', 'could not read ' + m.file, e); return fail('Could not read this model: ' + esc(e.message || String(e))) }
    if(tok !== VTOK) return; MESH = {id:m.id, mesh};
    const fresh = !m.dims || !m.tris; Object.assign(m, {dims:mesh.dims.map(x => Math.round(x * 100) / 100), tris:mesh.tris, fmt:mesh.fmt}); if(fresh) dbPut('models', m).catch(() => {});
    if(!PICS.has('th:' + m.id) && !PICS.has('emb:' + m.id)) NVMESH.snapshot(mesh, 400, '#a9c2d2').then(b => b && setPic('th:' + m.id, b)).catch(() => {});
    const st = $('#mstats'); if(st && fresh){ const y = scrollY; draw(); scrollTo(0, y); return } }
  try{ const cv = document.createElement('canvas'); box.insertBefore(cv, box.firstChild);
    VIEW = new NVMESH.Viewer(cv, {color:S.color || COLORS[0], grid:S.grid !== false}).setMesh(mesh);
    $('#v3msg').remove(); box.insertAdjacentHTML('afterbegin', `<div class="dim">${esc(mm(mesh.dims))}${VIEW.shown < mesh.tris ? ' · simplified view' : ''}</div>`) }
  catch(e){ LE('viewer', 'webgl', e); fail(esc(e.message || String(e))) } }
/* the bytes of a model or file, wherever it is */
async function fileBlob(r){
  if(r.local && r.local.bid){ const c = await dbGet('blobs', r.local.bid); if(c) return c.blob }
  if(r.src && r.src.kind === 'copy'){ const c = await dbGet('blobs', r.src.bid); if(!c) throw new Error('The copy in the app is gone'); return c.blob }
  if(r.src && r.src.kind === 'link'){ if(!NATIVE) throw new Error('This file is in a phone folder - open it in the Nightvault Android app');
    const res = await fetch(linkUrl(r.src.uri, r.name || r.file)); if(!res.ok) throw new Error(res.status === 404 ? 'The file is not in the phone folder any more' : 'Could not read the file (' + res.status + ')'); return res.blob() }
  if(r.pc){ if(!(window.NVPC && NVPC.native)) throw new Error('This model is on your PC - open it in the Nightvault Android app at home');
    if(!(await NVPC.reachable(true))){ PCON = false; throw new Error('Your PC is not reachable now - at home, with Nightvault running on the PC?') }
    const res = await fetch(NVPC.url('/nv/file?id=' + encodeURIComponent(r.pc.id))); if(!res.ok) throw new Error('The PC could not send the file (' + res.status + ')'); return res.blob() }
  throw new Error('This file is not reachable') }
const modelBlob = m => fileBlob(m);

/* ---------- previews for the tiles (made in the background, one at a time) ---------- */
const THQ = []; let THBUSY = false, THDRAW = 0;
function queuePreviews(){ const have = new Set(THQ);
  for(const m of MODELS) if(!have.has(m.id) && !m.thErr && !PICS.has('th:' + m.id) && !PICS.has('emb:' + m.id) && (onPhone(m) || (m.pc && PCON && m.size < 40e6))) THQ.push(m.id);
  for(const e of EXTRAS) if(!have.has(e.id) && e.ext === 'gcode.3mf' && !e.info && !e.thErr && (fileImg(e) || e.src && e.src.kind === 'copy' || e.local)) THQ.push(e.id);
  runPreviews() }
async function runPreviews(){ if(THBUSY) return; THBUSY = true;
  try{ while(THQ.length){ const id = THQ.shift(), m = MI[id], e = !m && EXTRAS.find(x => x.id === id); const r = m || e; if(!r) continue;
      await new Promise(ok => setTimeout(ok, 30));
      if(m && cur().v === 'model'){ THQ.unshift(id); await new Promise(ok => setTimeout(ok, 1500)); continue }   /* the viewer comes first */
      try{ if(r.size > 150e6){ r.thErr = 'too big'; await dbPut(m ? 'models' : 'extras', r); continue }
        const blob = await fileBlob(r);
        if(r.ext === '3mf' || r.ext === 'gcode.3mf'){ const inf = await NVMESH.zipInfo(blob).catch(() => null);
          if(inf){ if(inf.thumb){ const t = await thumb(inf.thumb).catch(() => null); if(t) await setPic('emb:' + r.id, t) }
            if(m && inf.project) m.proj3mf = inf.project; if(e) e.info = {slice:inf.slice, project:inf.project} } }
        if(m){ const mesh = await NVMESH.parse(blob, m.file); Object.assign(m, {dims:mesh.dims.map(x => Math.round(x * 100) / 100), tris:mesh.tris, fmt:mesh.fmt});
          if(!PICS.has('emb:' + m.id)){ const b = await NVMESH.snapshot(mesh, 400, '#a9c2d2'); if(b) await setPic('th:' + m.id, b) } }
        if(e && !e.info) e.info = {};
        await dbPut(m ? 'models' : 'extras', r) }
      catch(err){ r.thErr = String(err && err.message || err).slice(0, 120); LE('preview', 'no preview for ' + (r.file || r.name), err);
        if(!/not reachable|Android app/.test(r.thErr)) await dbPut(m ? 'models' : 'extras', r).catch(() => {}); else delete r.thErr }
      softDraw() } }
  finally{ THBUSY = false; softDraw() } }
function softDraw(){ clearTimeout(THDRAW); THDRAW = setTimeout(() => { const v = cur().v, typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if((v === 'home' || v === 'group') && !typing && !sheetOpen() && !SEL){ const y = scrollY; draw(); scrollTo(0, y) } }, 900) }

/* =====================================================================================================================
   ADDING MODELS: a folder on the phone (nothing copied), files / ZIP downloads copied into the app, the PC (Take with me)
   ===================================================================================================================== */
const FOLDERS = () => lsGet('nvPrint.folders', []);
function addSheet(){ const v = cur(); if(v.v === 'prints') return logPrint({});
  sheet(`<h3>Add models</h3><div class="mlist">
    ${NvFiles ? '<button class="btn primary" id="adfold">Use a folder on this phone</button><div class="muted small" style="margin:-2px 0 6px">Nothing is copied: the models stay in that folder. All folders inside it are read; each folder with models becomes a project tile.</div>' : ''}
    <button class="btn ${NvFiles ? '' : 'primary'}" id="adcopy">Copy files into the app</button><div class="muted small" style="margin:-2px 0 6px">STL, OBJ, 3MF, Bambu print files (.gcode.3mf), pictures – and <b>ZIP downloads</b> from Printables, Thingiverse or MakerWorld (each ZIP becomes a project). Resin print files (.ctb, .goo …) are listed, not copied.</div>
    ${!NATIVE ? '<button class="btn" id="addir">Copy a whole folder into the app</button>' : ''}
    ${window.NVPC && NVPC.native ? (NVPC.pc ? `<button class="btn" id="adpc">Get the newest list from ${esc(NVPC.pc.name || 'my PC')}</button><div class="muted small" style="margin:-2px 0 0">The models in the PC app’s “3D models” collections show up here by themselves.</div>` : '<a class="btn" href="../hub/index.html" style="text-decoration:none">Connect my PC (The Nightvault › My PC)</a>') : ''}</div>`);
  if($('#adfold')) $('#adfold').onclick = () => { closeSheet(); linkFolder() };
  $('#adcopy').onclick = () => { closeSheet(); pickCopy(false) };
  if($('#addir')) $('#addir').onclick = () => { closeSheet(); pickCopy(true) };
  if($('#adpc')) $('#adpc').onclick = () => { closeSheet(); pcRefresh(true) } }
/* one record per file; dir = the folder path inside what was added */
function makeRec(x, src, root){ const kind = kindOf(x.name); if(!kind) return null; const dir = x.dir || '';
  const base = {id:'m' + uid(), name:x.name, ext:extOf(x.name), size:x.size || 0, root, dir, src, pc:null, added:Date.now()};
  if(kind === 'model') return Object.assign(base, {kind, name:niceName(x.name), file:x.name, tags:[], todo:false});
  return Object.assign(base, {id:'x' + uid(), kind}) }
async function storeRecs(recs){ const ms = recs.filter(r => r.kind === 'model'), xs = recs.filter(r => r.kind !== 'model');
  for(const r of ms) delete r.kind;
  if(ms.length) await dbPutMany('models', ms); if(xs.length) await dbPutMany('extras', xs);
  MODELS.push(...ms); EXTRAS.push(...xs); reindex(); return ms.length }

/* a folder on the phone (Android, NvFiles): the files stay there */
async function linkFolder(f){
  if(!NvFiles){ toast('Folders on the phone work in the Nightvault Android app'); return }
  try{ f = f || await NvFiles.pickFolder() }catch(e){ if(!/cancel|No folder/i.test(e.message || '')) toast(e.message || String(e)); return }
  const fl = FOLDERS().filter(x => x.tree !== f.tree); fl.push({tree:f.tree, name:f.name}); lsSet('nvPrint.folders', fl);
  await scanFolder(fl[fl.length - 1], false) }
async function scanFolder(fo, quiet){ let list, stopped = false;
  if(!quiet){ sheet(`<h3>Reading “${esc(fo.name)}”…</h3><div class="prog busy"><i></i></div><div class="muted small" id="scs">Looking for models…</div><button class="btn" id="scstop" style="width:100%;margin-top:10px">Stop</button>`, true);
    $('#scstop').onclick = () => { stopped = true; NvFiles.stopList().catch(() => {}); closeSheet() } }
  let hl = null; try{ hl = await NvFiles.addListener('listProgress', e => { const el = $('#scs'); if(el) el.textContent = `${e.files} files in ${plural(e.folders, 'folder')}…` }) }catch(e){}
  try{ list = (await NvFiles.list({tree:fo.tree})).files || [] }catch(e){ try{ hl && hl.remove() }catch(x){} if(!quiet && !stopped){ closeSheet(); toast(e.message || String(e), 5000) } LE('folder', 'list failed', e); return }
  try{ hl && hl.remove() }catch(x){} if(stopped) return;
  const hid = hidden(), mine = r => r.src && r.src.kind === 'link' && r.src.tree === fo.tree;
  const have = new Set(MODELS.filter(mine).concat(EXTRAS.filter(mine)).map(r => r.src.uri)), there = new Set(list.map(x => x.uri));
  /* gone from the folder: gone here too */
  const goneM = MODELS.filter(m => mine(m) && !there.has(m.src.uri)), goneX = EXTRAS.filter(e => mine(e) && !there.has(e.src.uri));
  if(goneM.length || goneX.length){ await dropRecs(goneM, goneX) }
  const recs = [];
  for(const x of list){ if(have.has(x.uri) || hid.has(x.uri)) continue; const parts = String(x.path || x.name).split('/').filter(Boolean);
    const r = makeRec({name:x.name, size:x.size, dir:parts.slice(1, -1).join('/')}, {kind:'link', uri:x.uri, tree:fo.tree}, fo.name); if(r) recs.push(r) }
  const n = await storeRecs(recs); lsSet('nvPrint.scanAt', Date.now());
  if(!quiet) closeSheet();
  if(n || !quiet) toast(n ? `“${fo.name}”: ${plural(n, 'new model')}` : `“${fo.name}”: nothing new${goneM.length ? ` · ${plural(goneM.length, 'model')} gone` : ''}`, 3500);
  draw(); queuePreviews() }
async function dropRecs(ms, xs){   /* a model that is also on the PC stays, as a PC model */
  for(const m of ms){ if(m.pc){ m.src = null; await dbPut('models', m) } else { await dbDel('models', m.id); for(const p of ['th:', 'emb:', 'it:']) if(PICS.has(p + m.id)) await delPic(p + m.id) } }
  for(const e of xs){ await dbDel('extras', e.id); if(PICS.has('emb:' + e.id)) await delPic('emb:' + e.id) }
  const gm = new Set(ms.filter(m => !m.pc).map(m => m.id)), gx = new Set(xs.map(e => e.id));
  MODELS = MODELS.filter(m => !gm.has(m.id)); EXTRAS = EXTRAS.filter(e => !gx.has(e.id)); reindex() }

/* files (and ZIP downloads) copied into the app */
function pickCopy(dir){ const i = $('#pickmod'); i.value = ''; if(dir) i.setAttribute('webkitdirectory', ''); else i.removeAttribute('webkitdirectory');
  i.onchange = () => { const fs = [...i.files]; if(fs.length) copyFiles(fs) }; i.click() }
async function copyFiles(fs){
  const have = new Set(MODELS.concat(EXTRAS).filter(r => r.src && r.src.kind === 'copy').map(r => r.dir + '|' + (r.file || r.name) + '|' + r.size));
  sheet(`<h3>Copying into the app…</h3><div class="prog"><i id="cpp"></i></div><div class="muted small" id="cps" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">starting…</div><p class="muted small">Keep the app open until it is done.</p>`, true);
  const prog = (n, t, name) => { const p = $('#cpp'), s = $('#cps'); if(p) p.style.width = (100 * n / Math.max(1, t)) + '%'; if(s) s.textContent = `${n} of ${t} · ${name}` };
  /* what is in the ZIP files */
  const todo = [];
  for(const f of fs){ const rel = (f.webkitRelativePath || f.name).split('/'), dir = rel.slice(0, -1).join('/');
    if(/\.zip$/i.test(f.name)){ try{ const z = await NVMESH.unzip(f), base = stem(f.name);
        for(const n of z.names){ if(/(^|\/)(__MACOSX|\.)/.test(n)) continue; const parts = n.split('/'), name = parts.pop(); if(!kindOf(name)) continue;
          todo.push({name, size:z.size(n), dir:[dir, base, ...parts].filter(Boolean).join('/'), get:() => z.blob(n)}) } }
      catch(e){ toast(`${f.name}: ${e.message || e}`, 5000); LE('copy', 'zip ' + f.name, e) } }
    else if(kindOf(f.name)) todo.push({name:f.name, size:f.size, dir, get:async () => f}) }
  const fresh = todo.filter(x => !have.has(x.dir + '|' + x.name + '|' + x.size)), size = fresh.reduce((n, x) => n + x.size, 0);
  let est = null; try{ est = await navigator.storage.estimate() }catch(e){}
  if(est && est.quota && est.quota - est.usage < size * 1.05 && !confirm(`These files take ${mb(size)}, but the app only has about ${mb(est.quota - est.usage)} free. Try anyway?`)){ closeSheet(); return }
  const recs = []; let n = 0, failed = 0;
  for(const x of fresh){ prog(++n, fresh.length, x.name);
    try{ const kind = kindOf(x.name), keepBytes = kind === 'model' || kind === 'pic' || x.name.toLowerCase().endsWith('.gcode.3mf') || kind === 'doc';
      let src = {kind:'name'};
      if(keepBytes){ const bid = 'b' + uid(), blob = await x.get(); await dbPut('blobs', {id:bid, blob}); src = {kind:'copy', bid} }
      const r = makeRec(x, src, 'In the app'); if(r) recs.push(r) }
    catch(e){ failed++; LE('copy', 'could not copy ' + x.name, e); if(/Quota|full/i.test(String(e && (e.name + e.message)))){ toast('The phone (or the app’s storage) is full', 6000); break } } }
  const added = await storeRecs(recs); closeSheet(); draw();
  toast(`${plural(added, 'model')} added${recs.length - added ? ` · ${plural(recs.length - added, 'other file')}` : ''}${todo.length - fresh.length ? ` · ${todo.length - fresh.length} already here` : ''}${failed ? ` · ${failed} failed` : ''}`, 4500);
  queuePreviews() }

/* ---------- the PC (Take with me, ../hub/nvpc.js): the PC app's "3D models" collections ---------- */
let PCON = null, PCBUSY = false;
async function pcRefresh(loud){ if(!(window.NVPC && NVPC.native && NVPC.pc) || PCBUSY) return;
  PCBUSY = true; if(loud) draw();
  try{ PCON = await NVPC.reachable(!!loud); if(!PCON){ if(loud) toast('Your PC is not reachable - at home, with Nightvault running on the PC?', 4500); return }
    const j = await NVPC.list('models', null, !!loud); await mergePc(j.items || []); lsSet('nvPrint.pcAt', Date.now());
    if(loud) toast(`My PC: ${plural((j.items || []).filter(x => kindOf(x.name) === 'model').length, 'model')}`) }
  catch(e){ LE('pc', 'list', e); if(loud) toast(/too old|Not on this PC/i.test(e.message || '') ? 'The PC app is too old for 3D Print - copy the newest vault.py and vault_phone.py to the PC' : e.message || String(e), 5000) }
  finally{ PCBUSY = false; draw(); queuePreviews() } }
async function mergePc(items){ const hid = hidden(), byPc = {}; for(const r of MODELS.concat(EXTRAS)) if(r.pc) byPc[r.pc.id] = r;
  /* a model that is on the phone too (same file name and size) shows once */
  const phone = new Set(MODELS.concat(EXTRAS).filter(r => r.src).map(r => (r.file || r.name).toLowerCase() + '|' + r.size));
  const seen = new Set(), recs = [], upd = [];
  for(const it of items){ if(hid.has('pc:' + it.id)) continue; const kind = kindOf(it.name); if(!kind) continue; seen.add(it.id);
    const pc = {id:it.id, gid:it.gid || '', cover:!!it.cover}, root = it.collname || 'PC', dir = it.dir || it.group || '';
    const old = byPc[it.id];
    if(old){ old.pc = pc; old.root = root; old.dir = dir; upd.push(old); continue }
    if(phone.has(it.name.toLowerCase() + '|' + (it.size || 0))) continue;
    const r = makeRec({name:it.name, size:it.size, dir}, null, root); if(!r) continue; r.pc = pc; r.id = 'pc:' + it.id; if(r.kind === 'model' && it.tags) r.pcTags = it.tags; recs.push(r) }
  /* gone from the PC */
  const goneM = MODELS.filter(m => m.pc && !seen.has(m.pc.id)), goneX = EXTRAS.filter(e => e.pc && !seen.has(e.pc.id));
  for(const m of goneM){ m.pc = null; if(!m.local && !m.src){ await dbDel('models', m.id) } else await dbPut('models', m) }
  for(const e of goneX) await dbDel('extras', e.id);
  MODELS = MODELS.filter(m => m.pc || m.src || m.local); EXTRAS = EXTRAS.filter(e => !goneX.includes(e));
  const um = upd.filter(r => MI[r.id]), ux = upd.filter(r => !MI[r.id]); if(um.length) await dbPutMany('models', um); if(ux.length) await dbPutMany('extras', ux);
  await storeRecs(recs) }
/* "Keep on this phone": copies PC models into the app for a trip (shows in The Nightvault › My PC › offline copies) */
async function keepOnPhone(list, title, recId){ list = list.filter(m => m.pc && !m.local);
  if(!list.length){ toast('Already on this phone'); return }
  if(!(await NVPC.reachable(true))){ PCON = false; toast('Your PC is not reachable - at home with Nightvault running on the PC?', 4500); draw(); return }
  const xs = EXTRAS.filter(e => e.pc && !e.local && list.some(m => { const a = projOf(m), b = projOf(e); return a && b && a.key === b.key }) && (e.kind === 'pic' || e.ext === 'gcode.3mf'));
  const all = list.concat(xs), size = all.reduce((n, r) => n + (r.size || 0), 0);
  if(!confirm(`Keep ${plural(list.length, 'model')}${xs.length ? ` and ${plural(xs.length, 'file')}` : ''} (${mb(size)}) on this phone?`)) return;
  sheet(`<h3>Saving on this phone…</h3><div class="prog"><i id="cpp"></i></div><div class="muted small" id="cps">starting…</div>`, true);
  const ids = []; let n = 0;
  for(const r of all){ n++; const p = $('#cpp'), s = $('#cps'); if(p) p.style.width = (100 * n / all.length) + '%'; if(s) s.textContent = `${n} of ${all.length} · ${r.file || r.name}`;
    try{ const blob = await fileBlob(r), bid = 'b' + uid(); await dbPut('blobs', {id:bid, blob}); r.local = {bid, rec:recId}; ids.push(bid); await dbPut(MI[r.id] ? 'models' : 'extras', r) }
    catch(e){ LE('keep', r.file || r.name, e) } }
  NVPC.offline.add({app:'print3d', id:recId, title, size, n:ids.length, del:[{db:'nvPrint', store:'blobs', ids}]});
  closeSheet(); draw(); toast(`${plural(ids.length, 'file')} saved on this phone`) }
async function dropKept(){ if(!(window.NVPC)) return; const ch = [];
  for(const r of MODELS.concat(EXTRAS)) if(r.local && r.local.rec && !NVPC.offline.get('print3d', r.local.rec)){ r.local = null; ch.push(r) }
  for(const r of ch) await dbPut(MI[r.id] ? 'models' : 'extras', r) }

/* =====================================================================================================================
   THE PRINT LOG – what you printed, on which printer, with what, how long, and if it worked
   ===================================================================================================================== */
const PRINTERS = () => lsGet('nvPrint.printers', [{n:'Bambu Lab', t:'filament'}, {n:'Creality / Elegoo', t:'resin'}]);
const MATS = {filament:['PLA', 'PLA+', 'PLA Silk', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PETG-CF', 'Nylon'], resin:['Standard resin', 'ABS-like resin', 'Water washable resin', '8K resin', 'Tough resin', 'Plant-based resin']};
const unitOf = t => t === 'resin' ? 'ml' : 'g';
function printLi(p){ const m = p.model ? MI[p.model] : null, g = !m && p.proj ? groupByKey(SH, p.proj) : null;
  const th = m ? coverHTML(m) : g ? groupCoverHTML(SH, g) : srcHTML(null, '', {n:p.title || ''});
  return `<div class="li" data-print="${esc(p.id)}"><span class="th">${th}</span><div class="n"><div>${esc(m ? m.name : g ? g.name : p.title || 'A print')}</div><div class="s">${esc([p.printer, p.mat, p.amount ? p.amount + ' ' + unitOf(p.type) : '', hm(p.time)].filter(Boolean).join(' · ') || ' ')}</div></div><div class="r">${esc(dateTxt(p.date))}<br>${p.ok === false ? '<span class="badge bad">✗ failed</span>' : '<span class="badge ok">✓ worked</span>'}</div></div>` }
function drawPrints(body){ $('#vtitle').textContent = 'Prints'; document.title = 'Prints · 3D Print';
  const f = S.pfilter || 'all', list = PRINTS.filter(p => f === 'ok' ? p.ok !== false : f === 'bad' ? p.ok === false : true).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));
  let h = `<div class="chips"><button class="chip ${f === 'all' ? 'on' : ''}" data-pf="all">All</button><button class="chip ${f === 'ok' ? 'on' : ''}" data-pf="ok">Worked</button><button class="chip ${f === 'bad' ? 'on' : ''}" data-pf="bad">Failed</button></div>`;
  if(PRINTS.length){ const y = String(new Date().getFullYear()), sum = l => { const ok = l.filter(p => p.ok !== false).length;
      return [['Prints', String(l.length)], ['Worked', l.length ? Math.round(100 * ok / l.length) + '%' : ''], ['Filament', fmtAmt(l.filter(p => p.type !== 'resin').reduce((n, p) => n + (+p.amount || 0), 0), 'g')],
        ['Resin', fmtAmt(l.filter(p => p.type === 'resin').reduce((n, p) => n + (+p.amount || 0), 0), 'ml')], ['Print time', hm(l.reduce((n, p) => n + (+p.time || 0), 0))]].filter(x => x[1] && x[1] !== '0') };
    const ty = PRINTS.filter(p => (p.date || '').startsWith(y));
    h += `<div class="sec">This year</div><div class="stats">${sum(ty).map(([k, x]) => `<div class="stat"><small>${k}</small><b>${esc(x)}</b></div>`).join('')}</div>`;
    if(ty.length !== PRINTS.length) h += `<div class="sec">All time</div><div class="stats">${sum(PRINTS).map(([k, x]) => `<div class="stat"><small>${k}</small><b>${esc(x)}</b></div>`).join('')}</div>` }
  if(!list.length) h += `<div class="empty">${cube(48)}<h2 style="margin:8px 0 4px;font-size:18px">No prints yet</h2><p class="muted small" style="margin:0 0 14px">Open a model and tap <b>I printed this</b>, or tap <b>Log a print</b> above.</p></div>`;
  let month = '';
  for(const p of list.slice(0, 500)){ const mo = (p.date || '').slice(0, 7); if(mo !== month){ month = mo; const [yy, m2] = mo.split('-').map(Number); h += `<div class="sec">${m2 ? MONTHS[m2 - 1] + ' ' + yy : 'Undated'}</div>` } h += printLi(p) }
  body.innerHTML = h; lazyCovers(body) }
const fmtAmt = (n, u) => !n ? '' : u === 'g' ? (n >= 1000 ? (n / 1000).toFixed(2).replace(/\.?0+$/, '') + ' kg' : Math.round(n) + ' g') : (n >= 1000 ? (n / 1000).toFixed(2).replace(/\.?0+$/, '') + ' L' : Math.round(n) + ' ml');
/* the print form. From a model or project it is filled in from a Bambu print file (.gcode.3mf) next to it, if there is one */
let F = null;
function logPrint(o){ o = o || {}; const old = o.edit ? PRINTS.find(p => p.id === o.edit) : null, prs = PRINTERS();
  F = old ? Object.assign({}, old) : {model:o.model || null, proj:o.proj || null, title:o.title || '', date:today(), printer:'', type:'filament', mat:'', color:'', amount:'', time:'', ok:true, note:''};
  if(!old){ const near = F.model && MI[F.model] ? extrasNear(MI[F.model]) : F.proj && groupByKey(SH, F.proj) ? extrasOf(groupByKey(SH, F.proj)) : [];
    const sl = o.extra ? EXTRAS.find(e => e.id === o.extra) : near.find(e => e.info && e.info.slice), resin = near.some(e => e.kind === 'resin' || /\.(lys|lyt|chitubox)$/i.test(e.name)) || (sl && sl.kind === 'resin');
    F.type = resin ? 'resin' : 'filament'; const pr = prs.find(p => p.t === F.type) || prs[0]; if(pr){ F.printer = pr.n; F.type = pr.t }
    const last = PRINTS.filter(p => p.printer === F.printer).sort((a, b) => (b.at || 0) - (a.at || 0))[0]; if(last){ F.mat = last.mat; F.color = last.color }
    if(sl && sl.info && sl.info.slice){ const s = sl.info.slice, fp = prs.filter(p => p.t === 'filament'); if(fp.length) F.printer = (fp.find(p => /bambu/i.test(p.n)) || fp[0]).n; F.time = s.time ? Math.round(s.time / 60) : ''; F.amount = s.grams || ''; const t = [...new Set((s.fil || []).map(x => x.type).filter(Boolean))].join(' + '); if(t) F.mat = t;
      if(sl.info.project && sl.info.project.printer){ const bp = prs.find(p => /bambu/i.test(p.n) && p.t === 'filament'); if(bp) F.printer = bp.n } F.type = 'filament'; F.from = sl.name } }
  drawLog() }
function drawLog(){ const prs = PRINTERS(), m = F.model ? MI[F.model] : null, g = !m && F.proj ? groupByKey(SH, F.proj) : null;
  if(!m && !g && !F.title) return pickForLog();
  const name = m ? m.name : g ? g.name : F.title, th = m ? coverHTML(m) : g ? groupCoverHTML(SH, g) : srcHTML(null, '', {n:name});
  const t = F.time ? {h:Math.floor(F.time / 60), m:F.time % 60} : {h:'', m:''};
  sheet(`<h3>${F.id ? 'Change the print' : 'I printed this'}</h3>
    <div class="gpick" style="display:flex;gap:10px;align-items:center;padding:8px;border-radius:14px;border:1px solid var(--line);background:var(--pan2);margin-bottom:10px"><div style="width:52px;flex:none">${th}</div><div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</b><span class="muted small">${esc(F.from ? 'Filled in from ' + F.from : m ? subLine(m) : g ? plural(g.all.length, 'model') : '')}</span></div><button class="btn sm" id="lchg">Change</button></div>
    <div class="field"><label>Did it work?</label><div class="res"><button class="${F.ok !== false ? 'on ok' : ''}" data-ok="1">✓ It worked</button><button class="${F.ok === false ? 'on bad' : ''}" data-ok="0">✗ It failed</button></div></div>
    <div class="row2"><div class="field"><label>Date</label><input type="date" id="ldate" value="${esc(F.date)}" max="${today()}"></div>
      <div class="field"><label>Printer</label><select id="lpr" style="width:100%;height:42px">${prs.map(p => `<option value="${esc(p.n)}" ${p.n === F.printer ? 'selected' : ''}>${esc(p.n)}</option>`).join('')}${F.printer && !prs.some(p => p.n === F.printer) ? `<option selected>${esc(F.printer)}</option>` : ''}</select></div></div>
    <div class="row2"><div class="field"><label>${F.type === 'resin' ? 'Resin' : 'Filament'}</label><input type="text" id="lmat" list="mats" value="${esc(F.mat)}" placeholder="${F.type === 'resin' ? 'ABS-like resin' : 'PLA'}"></div>
      <div class="field"><label>Colour</label><input type="text" id="lcol" value="${esc(F.color)}" placeholder="Grey"></div></div>
    <div class="row2"><div class="field"><label>${F.type === 'resin' ? 'Resin used (ml)' : 'Filament used (g)'}</label><input type="number" id="lamt" inputmode="decimal" min="0" step="any" value="${esc(F.amount)}"></div>
      <div class="field"><label>Print time</label><div class="row2"><input type="number" id="lth" min="0" placeholder="h" value="${esc(t.h)}"><input type="number" id="ltm" min="0" max="59" placeholder="min" value="${esc(t.m)}"></div></div></div>
    <div class="field"><label>Note (settings, what went wrong …)</label><textarea id="lnote" placeholder="0.2 mm layers, tree supports">${esc(F.note)}</textarea></div>
    <div style="display:flex;gap:8px"><button class="btn" style="flex:1" id="lno">Cancel</button><button class="btn primary" style="flex:2" id="lsave">${F.id ? 'Save' : 'Save the print'}</button></div>`, true);
  $('#mats').innerHTML = MATS[F.type].concat([...new Set(PRINTS.filter(p => p.type === F.type).map(p => p.mat).filter(Boolean))]).map(x => `<option value="${esc(x)}">`).join('');
  lazyCovers($('.sheet'));
  const keep = () => { F.date = $('#ldate').value; F.mat = $('#lmat').value.trim(); F.color = $('#lcol').value.trim(); F.amount = $('#lamt').value; F.note = $('#lnote').value.trim();
    const h = parseInt($('#lth').value) || 0, mi = parseInt($('#ltm').value) || 0; F.time = h * 60 + mi || '' };
  $('#lpr').onchange = e => { keep(); F.printer = e.target.value; const p = prs.find(x => x.n === F.printer); if(p && p.t !== F.type){ F.type = p.t; F.mat = ''; F.amount = '' } drawLog() };
  $('.res').onclick = e => { const b = e.target.closest('[data-ok]'); if(!b) return; keep(); F.ok = b.dataset.ok === '1'; drawLog() };
  $('#lchg').onclick = () => { keep(); F.model = null; F.proj = null; F.title = ''; drawLog() };
  $('#lno').onclick = () => { F = null; closeSheet() };
  $('#lsave').onclick = async () => { keep(); const p = F.id ? PRINTS.find(x => x.id === F.id) : {id:uid(), at:Date.now()};
    Object.assign(p, {model:F.model, proj:F.proj, title:name, date:F.date || today(), printer:F.printer, type:F.type, mat:F.mat, color:F.color, amount:F.amount === '' ? '' : +F.amount, time:F.time === '' ? '' : +F.time, ok:F.ok !== false, note:F.note});
    if(!F.id) PRINTS.push(p); await dbPut('prints', p);
    if(p.model && MI[p.model] && MI[p.model].todo && p.ok){ MI[p.model].todo = false; await dbPut('models', MI[p.model]) }
    F = null; closeSheet(); printStats(); draw(); toast(p.ok ? 'Print saved ✓' : 'Print saved (failed) - better luck next time') } }
function pickForLog(){ let q = '';
  const drawL = () => { const nq = norm(q), {groups} = groupsOf();
    const gs = groups.filter(g => g.kind === 'proj' && (!nq || norm(g.name).includes(nq))).sort(byName).slice(0, 60), ms = MODELS.filter(m => !nq || norm(m.name + ' ' + m.dir).includes(nq)).sort((a, b) => (b.todo - a.todo) || byName(a, b)).slice(0, 150);
    $('#lglist').innerHTML = (gs.length ? `<div class="sec">Projects</div>${gs.map(g => `<div class="li" data-lp="${esc(g.key)}"><span class="th">${groupCoverHTML(SH, g)}</span><div class="n"><div>${esc(g.name)}</div><div class="s">${plural(g.all.length, 'model')}</div></div></div>`).join('')}` : '')
      + (ms.length ? `<div class="sec">Models</div>${ms.map(m => `<div class="li" data-lm="${esc(m.id)}"><span class="th">${coverHTML(m)}</span><div class="n"><div>${esc(m.name)}</div><div class="s">${esc([m.todo ? 'To print' : '', m.dir].filter(Boolean).join(' · '))}</div></div></div>`).join('')}` : '')
      + (!gs.length && !ms.length ? '<p class="muted small">Nothing found. You can also type a name and log it without a model.</p>' : '');
    lazyCovers($('#lglist')) };
  sheet(`<h3>What did you print?</h3><input type="search" id="lq" placeholder="Search your models"><div id="lglist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" id="lgno">Cancel</button><button class="btn" style="flex:2" id="lgname">Something else (type a name)</button></div>`, true);
  $('#lq').oninput = e => { q = e.target.value; drawL() }; drawL();
  $('#lgno').onclick = () => { F = null; closeSheet() };
  $('#lgname').onclick = () => { const n = $('#lq').value.trim(); if(!n){ toast('Type the name in the search box first'); $('#lq').focus(); return } F.title = n; drawLog() };
  $('#lglist').onclick = e => { const r = e.target.closest('[data-lm],[data-lp]'); if(!r) return; if(r.dataset.lm) F.model = r.dataset.lm; else { F.proj = r.dataset.lp; F.title = (groupByKey(SH, F.proj) || {}).name || '' }
    const keepF = F; logPrint(F.model ? {model:F.model} : {proj:F.proj, title:F.title}); if(keepF.date) F.date = keepF.date; drawLog() } }
function printSheet(id){ const p = PRINTS.find(x => x.id === id); if(!p) return; const m = p.model ? MI[p.model] : null, g = !m && p.proj ? groupByKey(SH, p.proj) : null;
  sheet(`<h3>${esc(m ? m.name : g ? g.name : p.title)}</h3><div class="muted small">${esc(dateTxt(p.date))} · ${p.ok === false ? '<span class="badge bad">✗ failed</span>' : '<span class="badge ok">✓ worked</span>'}</div>
    <div class="facts">${[['Printer', p.printer], [p.type === 'resin' ? 'Resin' : 'Filament', [p.mat, p.color].filter(Boolean).join(', ')], ['Used', p.amount ? p.amount + ' ' + unitOf(p.type) : ''], ['Time', hm(p.time)], ['Note', p.note]].filter(x => x[1]).map(([k, v]) => `<span>${k}</span><span style="white-space:pre-line">${esc(v)}</span>`).join('')}</div>
    <div class="mlist">${m ? '<button class="btn" id="pmod">Open the model</button>' : g ? '<button class="btn" id="pmod">Open the project</button>' : ''}<button class="btn" id="pagain">Print it again</button><button class="btn" id="pedit">Change</button><button class="btn danger" id="pdel">Delete this print</button></div>`);
  if($('#pmod')) $('#pmod').onclick = () => { closeSheet(); m ? go({v:'model', id:m.id}) : go({v:'group', key:g.key}) };
  $('#pagain').onclick = () => { logPrint(m ? {model:m.id} : g ? {proj:g.key, title:g.name} : {}); Object.assign(F, {printer:p.printer, type:p.type, mat:p.mat, color:p.color, amount:p.amount, time:p.time, title:p.title}); drawLog() };
  $('#pedit').onclick = () => logPrint({edit:p.id});
  $('#pdel').onclick = async () => { if(!confirm('Delete this print?')) return; PRINTS = PRINTS.filter(x => x !== p); await dbDel('prints', p.id); closeSheet(); printStats(); draw(); toast('Print deleted') } }
function extraSheet(id){ const e = EXTRAS.find(x => x.id === id); if(!e) return; const inf = e.info && e.info.slice, pj = e.info && e.info.project;
  sheet(`<h3 style="overflow-wrap:anywhere">${esc(e.name)}</h3>${PICS.has('emb:' + e.id) ? `<div style="width:160px;margin:0 auto 10px">${srcHTML({cov:'emb:' + e.id}, '', {n:'', s:''})}</div>` : ''}
    <div class="facts">${[['Kind', e.kind === 'sliced' ? 'Print file (filament)' : e.kind === 'resin' ? 'Print file (resin)' : e.kind === 'scene' ? 'Slicer / CAD file' : 'File'], ['Print time', inf ? hm(inf.time / 60) : ''], ['Filament', inf ? [inf.grams ? inf.grams + ' g' : '', ...(inf.fil || []).map(f => [f.type, f.g ? f.g + ' g' : ''].filter(Boolean).join(' '))].filter(Boolean).join(' · ') : ''],
      ['Plates', inf && inf.plates > 1 ? String(inf.plates) : ''], ['Made for', pj ? [pj.printer, pj.layer ? pj.layer + ' mm layers' : '', pj.nozzle ? pj.nozzle + ' mm nozzle' : ''].filter(Boolean).join(' · ') : ''], ['Size', e.size ? mb(e.size) : ''], ['Folder', e.dir], ['Where', whereTxt(e)]].filter(x => x[1]).map(([k, v]) => `<span>${k}</span><span style="overflow-wrap:anywhere">${esc(v)}</span>`).join('')}</div>
    <div class="mlist"><button class="btn primary" id="xlog">I printed this</button>${e.kind === 'doc' && fileImg(e) ? '<button class="btn" id="xopen">Open</button>' : ''}</div>
    ${e.kind === 'resin' || e.kind === 'scene' ? '<p class="muted small" style="margin:10px 0 0">Print it from your slicer or printer as usual – it is listed here so you know it is there.</p>' : ''}`);
  lazyCovers($('.sheet'));
  $('#xlog').onclick = () => { const m = MODELS.find(x => { const a = projOf(x), b = projOf(e); return a && b && a.key === b.key }), p = projOf(e);
    logPrint(p ? {proj:p.key, title:p.name, extra:e.id} : {title:niceName(e.name), extra:e.id}); void m };
  if($('#xopen')) $('#xopen').onclick = () => { const c = fileImg(e); if(c && c.url) openUrl(c.url) } }
function picSheet(id){ const e = EXTRAS.find(x => x.id === id), c = fileImg(e); if(!c) return;
  sheet(`<div class="cv" style="aspect-ratio:auto;min-height:200px;max-height:72vh"${c.cov ? ` data-cov="${esc(c.cov)}"` : ''}>${c.url ? `<img class="f" src="${esc(c.url)}" alt="" style="position:static;max-height:72vh">` : ''}</div><div class="muted small" style="margin-top:8px;overflow-wrap:anywhere">${esc(e.name)}</div>`);
  lazyCovers($('.sheet')); setTimeout(() => { const i = $('.sheet .cv img.b'); if(i) i.remove(); const f = $('.sheet .cv img.f'); if(f) f.style.position = 'static' }, 400) }

/* clicks on the screens */
$('#body').addEventListener('click', e => {
  if(selSkip){ selSkip = false; return }
  const t = e.target, el = t.closest('[data-item],[data-grp],[data-filter],[data-selstart],[data-gotogrp],[data-print],[data-pf],[data-open],[data-extra],[data-pic],[data-tag],#newgrp');
  if(!el) return; const v = cur();
  if(SEL && el.closest('.grid') && (el.dataset.item || el.dataset.grp)){ const id = el.dataset.item ? 'it:' + el.dataset.item : 'gr:' + el.dataset.grp; SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw(); return }
  if(el.id === 'newgrp') return newGroup(SH);
  if(el.dataset.item) return go({v:'model', id:el.dataset.item});
  if(el.dataset.grp) return go({v:'group', key:el.dataset.grp});
  if(el.dataset.gotogrp){ V.pop(); if(cur().v !== 'group' || cur().key !== el.dataset.gotogrp) V.push({v:'group', key:el.dataset.gotogrp}); return draw() }
  if(el.dataset.filter){ S.filter = el.dataset.filter; saveS(); return draw() }
  if(el.dataset.pf){ S.pfilter = el.dataset.pf; saveS(); return draw() }
  if(el.dataset.print) return printSheet(el.dataset.print);
  if(el.dataset.open) return openUrl(el.dataset.open);
  if(el.dataset.extra) return extraSheet(el.dataset.extra);
  if(el.dataset.pic) return picSheet(el.dataset.pic);
  if(el.dataset.tag !== undefined && v.v === 'model') return tagSheet(MI[v.id], el.dataset.tag);
  if(el.dataset.selstart) return selStart() });
$('#body').addEventListener('change', e => { const t = e.target;
  if(t.dataset.sort){ S.sort[t.dataset.skey] = t.value; saveS(); draw() }
  if(t.id === 'grouped'){ S.grouped = t.value === '1'; saveS(); draw() } });
function tagSheet(m, t){ if(!m) return; const own = (m.tags || []).includes(t);
  sheet(`<h3>Tag “${esc(t)}”</h3><div class="mlist"><button class="btn primary" id="tgs">Show every model with this tag</button><button class="btn danger" id="tgx">Remove it from this model</button></div>`);
  $('#tgs').onclick = () => { closeSheet(); Q = t; V = [{v:'home'}]; draw() };
  $('#tgx').onclick = async () => { if(own) m.tags = m.tags.filter(x => x !== t); else m.noTags = [...new Set((m.noTags || []).concat(t))]; await dbPut('models', m); closeSheet(); draw() } }
/* long-press a tile: select it (then tap more tiles) */
let SEL = null, selSkip = false;
function hookGrid(){ document.querySelectorAll('#body .grid').forEach(gr => {
  let tmr = null, sx = 0, sy = 0;
  gr.onpointerdown = e => { const el = e.target.closest('.bk'); if(!el) return; sx = e.clientX; sy = e.clientY; clearTimeout(tmr);
    tmr = setTimeout(() => { const id = el.dataset.item ? 'it:' + el.dataset.item : el.dataset.grp ? 'gr:' + el.dataset.grp : null; if(!id) return; selSkip = true; if(!SEL) selStart(id); else { SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw() } try{ navigator.vibrate && navigator.vibrate(20) }catch(e){} }, 520) };
  gr.onpointermove = e => { if(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(tmr) };
  gr.onpointerup = gr.onpointercancel = () => clearTimeout(tmr);
  gr.oncontextmenu = e => { if(e.target.closest('.bk')) e.preventDefault() } }) }

/* ---------- sheets ---------- */
function sheet(html, sticky){ $('#sheets').innerHTML = `<div class="scrim" id="scrim"><div class="sheet"><div class="grab"></div>${html}</div></div>`; $('#scrim').dataset.sticky = sticky ? '1' : '';
  $('#scrim').onclick = e => { if(e.target.id === 'scrim' && !$('#scrim').dataset.sticky) closeSheet() } }
function closeSheet(){ $('#sheets').innerHTML = '' }
window.closeSheet = closeSheet;
const sheetOpen = () => !!$('#scrim');
const ask = (title, ph, val, btn) => new Promise(ok => { sheet(`<h3>${title}</h3><input type="text" id="askv" placeholder="${esc(ph || '')}" value="${esc(val || '')}" maxlength="200"><div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" id="askno">Cancel</button><button class="btn primary" style="flex:2" id="askok">${btn || 'OK'}</button></div>`);
  setTimeout(() => { const i = $('#askv'); if(i){ i.focus(); i.select() } }, 50);
  const done = v => { closeSheet(); ok(v) }; $('#askno').onclick = () => done(null); $('#askok').onclick = () => done($('#askv').value.trim()); $('#askv').onkeydown = e => { if(e.key === 'Enter') done($('#askv').value.trim()) } });

/* =====================================================================================================================
   MENUS: a model, editing, pictures, removing
   ===================================================================================================================== */
function itemMenu(m){ const G = grOf(), pin = G.isPinned('it:' + m.id);
  sheet(`<h3>${esc(m.name)}</h3><div class="mlist">
    <button class="btn" id="ime">Name, link, notes and tags</button><button class="btn" id="img">Put in a group…</button><button class="btn" id="imp">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    <button class="btn" id="impic">Change the tile picture</button>${m.pc && !m.local && window.NVPC && NVPC.native ? '<button class="btn" id="imkeep">Keep on this phone (for a trip)</button>' : ''}
    ${m.link ? `<button class="btn" id="imlink">${esc(siteName(m.link))}</button>` : ''}<button class="btn danger" id="imx">Remove from 3D Print</button></div>
    <p class="muted small" style="margin:10px 0 0">${esc(whereTxt(m))}${m.src && m.src.kind === 'link' ? ' – removing it here never deletes the file in your folder.' : ''}</p>`);
  $('#ime').onclick = () => editModel(m); $('#img').onclick = () => groupPicker(m); $('#impic').onclick = () => pictureSheet(m);
  $('#imp').onclick = () => { G.togglePin(['it:' + m.id], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#imkeep')) $('#imkeep').onclick = () => { closeSheet(); keepOnPhone([m], m.name, m.id) };
  if($('#imlink')) $('#imlink').onclick = () => openUrl(m.link);
  $('#imx').onclick = () => removeModels([m.id]) }
function editModel(m){
  sheet(`<h3>${esc(m.name)}</h3>
    <div class="field"><label>Name</label><input type="text" id="em_name" value="${esc(m.name)}" maxlength="160"></div>
    <div class="field"><label>Link to the model's page (Printables, Thingiverse, MakerWorld …)</label><input type="text" id="em_link" inputmode="url" value="${esc(m.link || '')}" placeholder="https://www.printables.com/model/…"></div>
    <div class="field"><label>Your tags (comma between them)</label><input type="text" id="em_tags" value="${esc((m.tags || []).join(', '))}" placeholder="gift, tabletop, dragon"></div>
    <div class="field"><label>Notes (settings that worked, supports, scale …)</label><textarea id="em_notes">${esc(m.notes || '')}</textarea></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="em_save">Save</button></div>`, true);
  $('#em_save').onclick = async () => { const link = $('#em_link').value.trim();
    Object.assign(m, {name:$('#em_name').value.trim() || niceName(m.file), link:link && !/^https?:\/\//i.test(link) ? 'https://' + link : link, tags:[...new Set($('#em_tags').value.split(',').map(x => x.trim()).filter(Boolean))], notes:$('#em_notes').value.trim()});
    await dbPut('models', m); regroup(); closeSheet(); draw(); toast('Saved') } }
async function removeModels(ids){ const ms = ids.map(id => MI[id]).filter(Boolean); if(!ms.length) return;
  const copies = ms.filter(m => m.src && m.src.kind === 'copy' || m.local);
  if(!confirm(`Remove ${ms.length === 1 ? '“' + ms[0].name + '”' : plural(ms.length, 'model')} from 3D Print?${copies.length ? `\n\n${plural(copies.length, 'copy', 'copies')} in the app ${copies.length === 1 ? 'is' : 'are'} deleted.` : ''}${ms.some(m => m.src && m.src.kind === 'link') ? '\n\nFiles in your phone folders are not touched.' : ''}`)) return;
  const hid = lsGet('nvPrint.hidden', []);
  for(const m of ms){ if(m.src && m.src.kind === 'link') hid.push(m.src.uri); if(m.pc) hid.push('pc:' + m.pc.id);
    if(m.src && m.src.kind === 'copy') await dbDel('blobs', m.src.bid).catch(() => {}); if(m.local) await dbDel('blobs', m.local.bid).catch(() => {});
    await dbDel('models', m.id); for(const p of ['th:', 'emb:', 'it:']) if(PICS.has(p + m.id)) await delPic(p + m.id) }
  lsSet('nvPrint.hidden', [...new Set(hid)]);
  const g = new Set(ms.map(m => m.id)); MODELS = MODELS.filter(m => !g.has(m.id)); reindex(); closeSheet(); selEnd(true);
  if(cur().v === 'model' && g.has(cur().id)) V.pop(); draw(); toast(plural(ms.length, 'model') + ' removed') }
function pictureSheet(m){ const has = PICS.has('it:' + m.id);
  sheet(`<h3>Tile picture of “${esc(m.name)}”</h3><div class="mlist"><button class="btn primary" id="pcpick">Take or pick a picture</button>${has ? '<button class="btn" id="pcdel">Use the automatic picture again</button>' : ''}<button class="btn" id="pcre">Make the 3D preview again</button></div>
    <p class="muted small" style="margin:10px 0 0">A photo of your print makes a nice tile.</p>`);
  $('#pcpick').onclick = async () => { const b = await pickPicture(); if(!b) return; await setPic('it:' + m.id, b); closeSheet(); draw(); toast('Picture saved') };
  if($('#pcdel')) $('#pcdel').onclick = async () => { await delPic('it:' + m.id); closeSheet(); draw(); toast('Back to the automatic picture') };
  $('#pcre').onclick = async () => { await delPic('th:' + m.id); delete m.thErr; await dbPut('models', m); closeSheet(); THQ.unshift(m.id); runPreviews(); toast('Making the preview again…') } }

/* ---------- groups: menus (the same words as Music, Bookcase and Boardgames) ---------- */
function newGroup(sh){ ask('New group', 'Name, like Tabletop or Gifts', '', 'Make the group').then(n => { if(!n) return; const G = grOf(); G.own(n); regroup();
  const g = groupByKey(SH, 'c:' + norm(n)); S.grouped = true; saveS(); draw(); toast(`Group “${n}”: ${plural(g ? g.all.length : 0, 'model')}. Models with this word in their name or folder go in by themselves.`, 4500) }) }
function groupMenu(sh, g){ const G = grOf(), pin = G.isPinned('gr:' + g.key), pcs = (g.all || []).filter(m => m.pc && !m.local);
  sheet(`<h3>${esc(g.name)}</h3><div class="mlist"><button class="btn primary" id="gadd">Add models…</button><button class="btn" id="glink">Link and notes</button><button class="btn" id="gsub">New group inside</button><button class="btn" id="gmove">Put this group inside another group…</button><button class="btn" id="gren">Rename</button><button class="btn" id="gcov">Choose the tile cover</button><button class="btn" id="gpin">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    ${pcs.length && window.NVPC && NVPC.native ? `<button class="btn" id="gkeep">Keep on this phone (${plural(pcs.length, 'model')} from the PC)</button>` : ''}${g.kind === 'own' ? '<button class="btn danger" id="gdel">Remove this group</button>' : ''}</div>
    ${g.kind === 'own' ? `<p class="muted small" style="margin:10px 0 0">Removing the group keeps the models - they show as their own tiles again.</p>` : ''}`);
  $('#gadd').onclick = () => addItemsSheet(sh, g); $('#gsub').onclick = () => newSubGroup(sh, g); $('#gmove').onclick = () => moveGroupSheet(sh, g); $('#gren').onclick = () => renameGroup(sh, g); $('#gcov').onclick = () => groupCoverSheet(sh, g);
  $('#glink').onclick = () => { const mt = gmeta(g.key);
    sheet(`<h3>${esc(g.name)}</h3><div class="field"><label>Link to the project's page (Printables, Thingiverse, MakerWorld …)</label><input type="text" id="gl_link" inputmode="url" value="${esc(mt.link || '')}" placeholder="https://www.printables.com/model/…"></div>
      <div class="field"><label>Notes</label><textarea id="gl_notes">${esc(mt.notes || '')}</textarea></div><div style="display:flex;gap:8px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="gl_save">Save</button></div>`, true);
    $('#gl_save').onclick = () => { const l = $('#gl_link').value.trim(); setGmeta(g.key, {link:l && !/^https?:\/\//i.test(l) ? 'https://' + l : l, notes:$('#gl_notes').value.trim()}); closeSheet(); draw(); toast('Saved') } };
  $('#gpin').onclick = () => { G.togglePin(['gr:' + g.key], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#gkeep')) $('#gkeep').onclick = () => { closeSheet(); keepOnPhone(pcs, g.name, g.key) };
  if($('#gdel')) $('#gdel').onclick = () => { closeSheet(); if(cur().v === 'group' && cur().key === g.key) V.pop(); grChange(sh, () => G.remove(g), `Group “${g.name}” removed`); draw() } }
function addItemsSheet(sh, g){ const G = grOf(), gs = groupsOf().groups, where = {}; for(const x of gs) for(const it of x.items) where[it.id] = x;
  const pick = new Set(); let q = '';
  const list = () => { const nq = norm(q); return MODELS.filter(x => !g.items.includes(x) && (!nq || norm([x.name, x.dir, (where[x.id] || {}).name].join(' ')).includes(nq))).sort(byName) };
  const upd = () => { $('#aago').textContent = pick.size ? `Add ${plural(pick.size, 'model')}` : 'Add'; $('#aago').disabled = !pick.size };
  const drawL = () => { const l = list(), el = $('#aalist'); if(!el) return;
    el.innerHTML = l.slice(0, 400).map(x => `<label class="li" style="cursor:pointer"><input type="checkbox" data-aa="${esc(x.id)}" ${pick.has(x.id) ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accentd);flex:none"><span class="th">${coverHTML(x)}</span><div class="n"><div>${esc(x.name)}</div><div class="s">${esc(subLine(x))}${where[x.id] ? ' · in ' + esc(G.path(where[x.id], gs)) : ''}</div></div></label>`).join('') + (l.length > 400 ? `<p class="muted small">… and ${l.length - 400} more - type to narrow it down</p>` : '') + (!l.length ? '<p class="muted small">Nothing found.</p>' : '');
    lazyCovers(el); upd() };
  sheet(`<h3>Add models to “${esc(g.name)}”</h3><input type="search" id="aaq" placeholder="Search name, folder or group"><div id="aalist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="aago" disabled>Add</button></div>`, true);
  $('#aaq').oninput = e => { q = e.target.value; drawL() };
  $('#aalist').onchange = e => { const c = e.target.closest('[data-aa]'); if(!c) return; c.checked ? pick.add(c.dataset.aa) : pick.delete(c.dataset.aa); upd() };
  $('#aago').onclick = () => { grChange(sh, () => G.put([...pick], g), `${plural(pick.size, 'model')} added to “${g.name}”`); closeSheet(); draw() };
  drawL() }
function newSubGroup(sh, g){ ask(`New group inside “${esc(g.name)}”`, 'Name, like Supported or Painted', '', 'Make it').then(n => { if(!n) return; const G = grOf(), k = G.own(n); if(k.key === g.key) return; G.setParent(k.key, g.key); regroup(); draw(); toast(`“${n}” made inside “${g.name}” - open it and add models`) }) }
function moveGroupSheet(sh, g){ const G = grOf(), gs = groupsOf().groups, bad = new Set(G.inside(g, gs).concat(g.key)), opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Put “${esc(g.name)}” inside…</h3>${g.parent ? '<button class="btn" id="mgtop" style="width:100%;margin-bottom:8px">Back on the main page</button>' : ''}
    ${opts.map(x => `<div class="li" data-mg="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'model')}</div></div></div>`).join('') || '<p class="muted small">No other groups yet. Make one with “+ Group” on the first page.</p>'}`);
  lazyCovers($('.sheet'));
  if($('#mgtop')) $('#mgtop').onclick = () => { grChange(sh, () => G.setParent(g.key, null), `“${g.name}” is back on the main page`); closeSheet(); draw() };
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-mg]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.mg); grChange(sh, () => G.setParent(g.key, t.key), `“${g.name}” is now inside “${t.name}”`); closeSheet(); draw() }) }
function groupPicker(m){ const G = grOf(), now = groupOfItem(m), all = groupsOf().groups, gs = all.filter(g => !now || g.key !== now.key).sort((x, y) => coll.compare(x.name, y.name)), ov = G.read('items');
  sheet(`<h3>Put “${esc(m.name)}” in a group</h3>${now ? `<p class="muted small" style="margin:0 0 8px">Now in “${esc(now.name)}”.</p>` : ''}
    <div style="display:flex;gap:8px"><input type="text" id="gpn" placeholder="New group name" maxlength="60"><button class="btn primary" id="gpmake">Make</button></div>
    <div style="margin-top:10px">${gs.map(g => `<div class="li" data-gp="${esc(g.key)}"><span class="th">${groupCoverHTML(SH, g)}</span><div class="n"><div>${esc(G.path(g, all))}</div><div class="s">${plural(g.items.length, 'model')}</div></div></div>`).join('') || '<p class="muted small">No group tiles yet.</p>'}</div>
    <div class="mlist" style="margin-top:10px">${now ? '<button class="btn" id="gpout">Take it out of its group (its own tile)</button>' : ''}${ov[m.id] ? '<button class="btn" id="gpauto">Back to automatic</button>' : ''}</div>`);
  lazyCovers($('.sheet'));
  const done = (fn, msg) => { grChange(SH, fn, msg); closeSheet(); draw() };
  $('#gpmake').onclick = () => { const n = $('#gpn').value.trim(); if(!n) return; done(() => G.put([m.id], G.own(n)), `Put in “${n}”`) };
  if($('#gpout')) $('#gpout').onclick = () => done(() => G.put([m.id], 'none'), 'Now on its own tile');
  if($('#gpauto')) $('#gpauto').onclick = () => done(() => G.put([m.id]), 'Back to automatic');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-gp]'); if(!r) return; const g = groupByKey(SH, r.dataset.gp); if(g) done(() => G.put([m.id], g), `Put in “${g.name}”`) }) }
function renameGroup(sh, g){ const G = grOf();
  ask(`Rename “${esc(g.name)}”`, 'Name', g.name, 'Rename').then(n => { if(n == null || n === g.name) return; let err = ''; G.change(() => { err = G.rename(g, n) });
    if(err){ G.undo(); toast(err, 4000); return } regroup();
    const v = cur(); if(v.v === 'group' && v.key === g.key && g.kind === 'own') v.key = 'c:' + norm(n);
    draw(); G.undoToast(`Renamed to “${n}”`, () => { regroup(); draw() }) }) }
function groupCoverSheet(sh, g){ const G = grOf(), c = G.cover(g.key), wc = g.all.filter(hasCover).sort(byName);
  const save = v => { G.setCover(g.key, v); delete RNDCOV[g.key]; closeSheet(); draw(); toast('Tile cover saved') };
  sheet(`<h3>Tile cover for “${esc(g.name)}”</h3>
    <div class="chips"><button class="chip ${!c.t ? 'on' : ''}" data-gc="">Automatic</button><button class="chip ${c.t === 'random' ? 'on' : ''}" data-gc="random">A random one</button><button class="chip ${c.t === 'cycle' ? 'on' : ''}" data-gc="cycle">Changing (one after another)</button><button class="chip ${c.t === 'pic' ? 'on' : ''}" data-gc="pic">A picture from the phone</button></div>
    <div class="sec">Or pick one</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${wc.map(x => `<div class="bk" data-gca="${esc(x.id)}" style="${c.t === 'item' && c.al === x.id ? 'outline:2px solid var(--accent);border-radius:12px' : ''}">${coverHTML(x)}<div class="a">${esc(x.name)}</div></div>`).join('') || '<p class="muted small">No pictures in this group yet.</p>'}</div>`);
  lazyCovers($('.sheet'));
  $('.sheet').onclick = async e => { const bt = e.target.closest('[data-gc]'), it = e.target.closest('[data-gca]');
    if(it) return save({t:'item', al:it.dataset.gca}); if(!bt) return; const t = bt.dataset.gc;
    if(t === 'pic'){ const b = await pickPicture(); if(!b) return; await setPic('grp:' + g.key, b); return save({t:'pic'}) }
    save(t ? {t} : null) } }

/* ---------- select several tiles and move them at once (long-press a tile, or "Select") ---------- */
function selStart(id){ SEL = new Set(id ? [id] : []); selDraw() }
function selEnd(quiet){ if(!SEL) return; SEL = null; if(!quiet) selDraw(); else { const b = $('#msel'); if(b) b.remove() } }
function selDraw(){ document.querySelectorAll('#body .grid > .bk').forEach(el => { const id = el.dataset.item ? 'it:' + el.dataset.item : el.dataset.grp ? 'gr:' + el.dataset.grp : null; el.classList.toggle('sel', !!(SEL && id && SEL.has(id))) });
  let bar = $('#msel'); if(!SEL){ if(bar) bar.remove(); return }
  if(!bar){ bar = document.createElement('div'); bar.id = 'msel'; document.body.appendChild(bar) }
  const inGroup = cur().v === 'group', n = SEL.size;
  bar.innerHTML = `<b style="flex:1">${n ? plural(n, 'tile') + ' selected' : 'Tap tiles to select them'}</b><button class="btn sm primary" id="selmove" ${n ? '' : 'disabled'}>Move to…</button><button class="btn sm" id="selmore" ${n ? '' : 'disabled'}>${IC_DOTS}</button>${inGroup ? `<button class="btn sm" id="selout" ${n ? '' : 'disabled'}>Take out</button>` : ''}<button class="btn sm" id="selx">Cancel</button>`;
  $('#selx').onclick = () => selEnd(); $('#selmove').onclick = selMoveSheet; $('#selmore').onclick = selMore; if($('#selout')) $('#selout').onclick = selTakeOut }
function selParts(){ const gs = groupsOf().groups, its = [...SEL].filter(x => x.startsWith('it:')).map(x => x.slice(3)), grs = [...SEL].filter(x => x.startsWith('gr:')).map(x => x.slice(3));
  const items = [...new Set(its.concat(...grs.map(k => (gs.find(g => g.key === k) || {all:[]}).all.map(x => x.id))))];
  return {sh:SH, gs, its, grs, items} }
function selMoveSheet(){ const {sh, gs, its, grs} = selParts(), G = grOf(), bad = new Set(grs.flatMap(k => { const g = gs.find(x => x.key === k); return g ? G.inside(g, gs).concat(k) : [k] }));
  const opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Move ${plural(SEL.size, 'tile')} to…</h3><div style="display:flex;gap:8px"><input type="text" id="smn" placeholder="New group name" maxlength="60"><button class="btn primary" id="smmake">Make</button></div>
    <button class="btn" id="smtop" style="width:100%;margin-top:10px">The main page (own tiles)</button>
    <div style="margin-top:8px">${opts.map(x => `<div class="li" data-sm="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'model')}</div></div></div>`).join('')}</div>`);
  lazyCovers($('.sheet'));
  const move = t => { if(t){ G.put(its, t); for(const k of grs) G.setParent(k, t.key) } else { G.put(its, 'none'); for(const k of grs) G.setParent(k, null) } };
  const doit = (t, label, first) => { const n = SEL.size; grChange(sh, () => { if(first) first(); move(t) }, `${plural(n, 'tile')} moved to ${label}`); closeSheet(); selEnd(true); draw() };
  $('#smmake').onclick = () => { const n = $('#smn').value.trim(); if(!n) return; const v = cur(); doit({key:'c:' + norm(n), name:n, kind:'own'}, `“${n}”`, () => { const g = G.own(n); if(v.v === 'group' && !bad.has(v.key)) G.setParent(g.key, v.key) }) };
  $('#smtop').onclick = () => doit(null, 'the main page');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-sm]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.sm); if(t) doit(t, `“${t.name}”`) }) }
function selTakeOut(){ const {sh, gs, its, grs} = selParts(), G = grOf(), here = gs.find(x => x.key === cur().key), up = here && here.parent ? gs.find(x => x.key === here.parent) : null, n = SEL.size;
  grChange(sh, () => { G.put(its, up || 'none'); for(const k of grs) G.setParent(k, up ? up.key : null) }, `${plural(n, 'tile')} taken out${up ? ' to “' + up.name + '”' : ' to the main page'}`); selEnd(true); draw() }
function selMore(){ const {items} = selParts(), G = grOf(), ids = [...SEL], allPinned = ids.every(x => G.isPinned(x)), ms = items.map(id => MI[id]).filter(Boolean), allTodo = ms.every(m => m.todo), pcs = ms.filter(m => m.pc && !m.local);
  sheet(`<h3>${plural(ids.length, 'tile')} · ${plural(items.length, 'model')}</h3><div class="mlist"><button class="btn" id="smtodo">${allTodo ? 'Off the “To print” list' : '+ To print'}</button><button class="btn" id="smpin">${allPinned ? '★ Unpin' : '★ Pin to the top'}</button>
    ${pcs.length && window.NVPC && NVPC.native ? `<button class="btn" id="smkeep">Keep ${plural(pcs.length, 'PC model')} on this phone</button>` : ''}<button class="btn danger" id="smdel">Remove ${plural(items.length, 'model')} from 3D Print</button></div>`);
  $('#smtodo').onclick = async () => { for(const m of ms) m.todo = !allTodo; await dbPutMany('models', ms); closeSheet(); selEnd(true); draw(); toast(allTodo ? 'Off the “To print” list' : plural(ms.length, 'model') + ' on your “To print” list') };
  $('#smpin').onclick = () => { G.togglePin(ids, !allPinned); closeSheet(); selEnd(true); draw() };
  if($('#smkeep')) $('#smkeep').onclick = () => { closeSheet(); selEnd(true); keepOnPhone(pcs, plural(pcs.length, 'model'), 'sel' + uid()) };
  $('#smdel').onclick = () => removeModels(items) }

/* =====================================================================================================================
   SETTINGS
   ===================================================================================================================== */
function appSettings(){ const fl = FOLDERS(), copies = MODELS.concat(EXTRAS).filter(r => r.src && r.src.kind === 'copy'), prs = PRINTERS(), noPrev = MODELS.filter(m => !PICS.has('th:' + m.id) && !PICS.has('emb:' + m.id));
  sheet(`<h3>3D Print</h3>
    ${NvFiles ? `<div class="sec" style="margin-top:4px">Folders on this phone</div>${fl.map((f, i) => `<div class="li" style="cursor:default"><div class="n"><div>${esc(f.name)}</div><div class="s">${plural(MODELS.filter(x => x.src && x.src.tree === f.tree).length, 'model')}</div></div><button class="btn sm" data-fscan="${i}">Look for new</button><button class="btn sm" data-fdel="${i}">Forget</button></div>`).join('') || '<p class="muted small">None yet.</p>'}<button class="btn" id="as_fold" style="width:100%;margin-top:6px">Add a folder</button>` : ''}
    <div class="sec">Copied into the app</div><p class="muted small" style="margin:0 0 6px">${plural(copies.length, 'file')} · ${mb(copies.reduce((n, r) => n + (r.size || 0), 0))}</p><button class="btn" id="as_copy" style="width:100%">Copy more files</button>
    ${window.NVPC && NVPC.native ? `<div class="sec">My PC</div>${NVPC.pc ? `<div class="muted small">${esc(NVPC.pc.name || 'PC')} · ${plural(MODELS.filter(m => m.pc).length, 'model')} from the PC app's 3D models</div><button class="btn" id="as_pc" style="width:100%;margin-top:6px">Get the PC's newest list</button>` : '<div class="muted small">Not connected.</div>'}<a class="btn" href="../hub/index.html" style="width:100%;margin-top:6px;text-decoration:none">The Nightvault › My PC (pair, phone copies)</a>` : ''}
    <div class="sec">Your printers</div>
    <div id="as_prs">${prs.map((p, i) => `<div class="prow" style="display:flex;gap:6px;margin-bottom:6px"><input type="text" data-prn="${i}" value="${esc(p.n)}" placeholder="Name, like Bambu Lab A1" style="flex:1;min-width:0"><select data-prt="${i}" style="height:42px"><option value="filament" ${p.t === 'filament' ? 'selected' : ''}>Filament</option><option value="resin" ${p.t === 'resin' ? 'selected' : ''}>Resin</option></select><button class="btn sm" data-prx="${i}" style="height:42px" aria-label="Remove">✕</button></div>`).join('')}</div>
    <button class="btn" id="as_pradd" style="width:100%">+ Add a printer</button>
    <div class="sec">Projects and groups</div>
    <div class="opt"><label for="as_auto">Models in the same folder (or ZIP) make one project tile</label><input type="checkbox" id="as_auto" ${lsGet('nvPrint.noAuto', false) ? '' : 'checked'}></div>
    <div class="mlist" style="margin-top:6px"><button class="btn" id="as_save">Save my groups</button><button class="btn" id="as_load">Load groups from a file</button></div>
    <div class="sec">Previews</div><p class="muted small" style="margin:0 0 6px">${noPrev.length ? plural(noPrev.length, 'model') + ' without a preview' + (noPrev.some(m => m.thErr) ? ` (${noPrev.filter(m => m.thErr).length} could not be read)` : '') : 'Every model has a preview.'}</p>
    <button class="btn" id="as_prev" style="width:100%">Make missing previews (try again)</button>
    <p class="muted small" style="margin-top:14px">Problems? Switch on <b>Debug mode</b> at the bottom of The Nightvault and send the log.</p>`);
  if($('#as_fold')) $('#as_fold').onclick = () => { closeSheet(); linkFolder() };
  $('.sheet').addEventListener('click', async e => { const s = e.target.closest('[data-fscan]'), d = e.target.closest('[data-fdel]'), x = e.target.closest('[data-prx]');
    if(s){ closeSheet(); scanFolder(fl[+s.dataset.fscan], false) }
    if(d){ const f = fl[+d.dataset.fdel]; if(!confirm(`Forget the folder “${f.name}”? Its models leave 3D Print (the files stay on the phone).`)) return;
      await dropRecs(MODELS.filter(m => m.src && m.src.tree === f.tree), EXTRAS.filter(r => r.src && r.src.tree === f.tree));
      lsSet('nvPrint.folders', fl.filter(y => y.tree !== f.tree)); if(NvFiles && !['nvMusic.folders', 'nvAudio.folders', 'nvCinema.folders', 'nvBooks.folders'].some(k => lsGet(k, []).some(y => y.tree === f.tree))) NvFiles.forget({tree:f.tree}).catch(() => {});
      draw(); appSettings() }
    if(x){ const l = PRINTERS(); l.splice(+x.dataset.prx, 1); lsSet('nvPrint.printers', l); appSettings() } });
  $('#as_prs').onchange = e => { const t = e.target, l = PRINTERS(); if(t.dataset.prn !== undefined) l[+t.dataset.prn].n = t.value.trim(); if(t.dataset.prt !== undefined) l[+t.dataset.prt].t = t.value; lsSet('nvPrint.printers', l.filter(p => p.n)) };
  $('#as_pradd').onclick = () => { const l = PRINTERS(); l.push({n:'Printer ' + (l.length + 1), t:'filament'}); lsSet('nvPrint.printers', l); appSettings() };
  $('#as_copy').onclick = () => { closeSheet(); pickCopy(false) };
  if($('#as_pc')) $('#as_pc').onclick = () => { closeSheet(); pcRefresh(true) };
  $('#as_auto').onchange = e => { lsSet('nvPrint.noAuto', !e.target.checked); regroup(); draw(); toast('Saved') };
  $('#as_save').onclick = async () => { try{ const r = await grOf().saveBackup(); if(r !== 'cancelled') toast('Groups saved') }catch(e){ toast(e.message || String(e), 4000) } };
  $('#as_load').onclick = async () => { const G = grOf(), t = await G.pickFile(); if(!t) return; const c = G.checkBackup(t); if(!c.ok){ toast(c.msg, 5000); return }
    if(!confirm(c.msg + '\n\nPut these groups back? (Undo is possible right after.)')) return; G.applyBackup(c.d); regroup(); closeSheet(); draw(); G.undoToast('Groups loaded', () => { regroup(); draw() }) };
  $('#as_prev').onclick = async () => { const ch = MODELS.filter(m => m.thErr); for(const m of ch) delete m.thErr; if(ch.length) await dbPutMany('models', ch); closeSheet(); queuePreviews(); draw(); toast(THQ.length ? `Making ${plural(THQ.length + (THBUSY ? 1 : 0), 'preview')}…` : 'Nothing to do') } }
$('#setbtn').onclick = () => appSettings();
$('#addbtn').onclick = () => cur().v === 'group' ? addItemsSheet(SH, groupByKey(SH, cur().key)) : addSheet();
$('#prbtn').onclick = () => go({v:'prints'});

/* ---------- Android back button: full screen → sheet → one screen back → The Nightvault ---------- */
if(window.Capacitor) try{ const A = (Capacitor.Plugins && Capacitor.Plugins.App) || Capacitor.registerPlugin('App');
  A.addListener('backButton', () => { if(window.NVMENU && NVMENU.close()) return; if(sheetOpen()){ F = null; closeSheet(); return }
    if(back()) return; if(fromHub()){ location.href = '../hub/index.html'; return } A.minimizeApp && A.minimizeApp() }) }catch(e){}
document.addEventListener('keydown', e => { if(e.key === 'Escape' && FULL) fullView(false) });

document.addEventListener('visibilitychange', () => { if(document.hidden) window.NVHERE && NVHERE.save('nvPrint.here', {V}) }); addEventListener('pagehide', () => window.NVHERE && NVHERE.save('nvPrint.here', {V}));   // back where you were (../hub/nvlog.js)
/* ---------- start ---------- */
(async () => {
  try{ await openDB();
    const [ms, xs, keys, ps] = await Promise.all([dbAll('models'), dbAll('extras'), dbKeys('pics'), dbAll('prints')]);
    MODELS = ms; EXTRAS = xs; PRINTS = ps; for(const k of keys) PICS.add(k) }
  catch(e){ $('#body').innerHTML = `<p class="muted">3D Print could not open its storage: ${esc(e.message || e)}</p>`; return }
  await dropKept().catch(() => {}); reindex();
  const P = new URLSearchParams(location.search); if(P.get('prints')) V.push({v:'prints'});
  { const h = window.NVHERE && NVHERE.take('nvPrint.here'); if(h && Array.isArray(h.V) && h.V.length) V = h.V }
  try{ draw() }catch(e){ V = [{v:'home'}]; draw() } L('start', `${MODELS.length} models, ${EXTRAS.length} other files, ${PRINTS.length} prints`);
  queuePreviews();
  if(window.NVPC && NVPC.native && NVPC.pc){ PCON = await NVPC.reachable(false); draw(); if(PCON && Date.now() - lsGet('nvPrint.pcAt', 0) > 3600e3) pcRefresh(false); else queuePreviews() }
  if(NvFiles && FOLDERS().length && Date.now() - lsGet('nvPrint.scanAt', 0) > 6 * 3600e3) setTimeout(async () => { for(const f of FOLDERS()) await scanFolder(f, true).catch(() => {}); lsSet('nvPrint.scanAt', Date.now()) }, 4000);
  window.NVPRINT = {get models(){ return MODELS }, get extras(){ return EXTRAS }, get prints(){ return PRINTS }, copyFiles, mergePc, logPrint, draw, groupsOf, queuePreviews, get THQ(){ return THQ }, get busy(){ return THBUSY }};   // for testing
})();
