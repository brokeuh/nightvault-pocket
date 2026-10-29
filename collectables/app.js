/* Nightvault Collectables (test) – the app. Plan: plans/collectables.md in nightvault-src.
   Anything you collect. Every collection has its OWN TEMPLATE: the fields its items get (text, number, money, date, year, yes/no,
   pick-from-a-list, link, long text), made once by you, changeable later (a removed field is hidden, its data kept).
   Parts: basics · storage · templates and starters · money · items · groups (shared ../hub/nvgroups.js) · pictures · tiles ·
   screens (collections, collection, group, item) · adding and editing items · the template editor · the camera (Photo, Barcode) ·
   barcode look-up · menus · select · settings · start */
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
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateTxt = d => { if(!d) return ''; const [y, m, dd] = String(d).split('-').map(Number); if(!m) return String(d); return dd ? `${dd} ${MONTHS[m - 1].slice(0, 3)} ${y}` : `${MONTHS[m - 1]} ${y}` };
let toastT = 0;
function toast(m, ms, act){ const t = $('#toast'); t.innerHTML = esc(m) + (act ? `<button id="toastact">${esc(act.label)}</button>` : ''); t.classList.add('on'); t.classList.toggle('act', !!act);
  if(act) $('#toastact').onclick = () => { t.classList.remove('on', 'act'); act.run() };
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on', 'act'), ms || (act ? 6000 : 2600)) }
window.toast = toast;
const L = (a, t, d) => { try{ window.NVLOG && NVLOG.log(a, t, d) }catch(e){} }, LE = (a, t, d) => { try{ window.NVLOG && NVLOG.error(a, t, d) }catch(e){} };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
const S = Object.assign({sort:{}, grouped:{}, cur:'EUR'}, lsGet('nvCollect.settings', {}));
const saveS = () => lsSet('nvCollect.settings', S);
const fromHub = () => { try{ return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
try{ if(new URLSearchParams(location.search).get('nv') === 'hub') sessionStorage.setItem('nvHub', '1'); if(fromHub()) $('#hubback').hidden = false }catch(e){}
const IC_DOTS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const PINB = '<span class="pinb">★</span>';
let OCR = null; if(NATIVE) try{ OCR = Capacitor.registerPlugin('NvOcr') }catch(e){ OCR = null }
const HTTP = () => NATIVE && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;

/* ---------- storage: IndexedDB 'nvCollect' (works offline) ----------
   colls : your collections, each with its template {id, name, icon, shape, fields:[{id, name, type, options, gone}], prices, online, camera, groupBy, added}
   items : {id, coll, name, count, notes, tags:[], v:{<field id>: value}, paid, worth, code (barcode), img (picture from a look-up), pics:[picture ids], added, changed}
   pics  : {id, blob}  'p:<pic>' the photo, 't:<pic>' its small copy for tiles, 'grp:<coll>:<group key>' a group's own tile picture
   kv    : small things */
let DB = null;
function openDB(){ return new Promise((ok, no) => { const r = indexedDB.open('nvCollect', 1);
  r.onupgradeneeded = () => { const d = r.result; for(const s of ['colls', 'items', 'pics', 'kv']) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}) };
  r.onblocked = () => toast('Close the other Collectables tab, then reload', 6000);
  r.onsuccess = () => { DB = r.result; DB.onversionchange = () => { DB.close(); toast('Collectables was updated in another tab - reload this page', 6000) }; ok(DB) }; r.onerror = () => no(r.error) }) }
function tx(store, mode, fn){ return new Promise((ok, no) => { const t = DB.transaction(store, mode), st = t.objectStore(store); let res; const q = fn(st); if(q) q.onsuccess = () => res = q.result; t.oncomplete = () => ok(res); t.onerror = t.onabort = () => no(t.error || new Error('Storage error')) }) }
const dbGet = (s, id) => tx(s, 'readonly', st => st.get(id));
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbKeys = s => tx(s, 'readonly', st => st.getAllKeys());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));

/* ---------- icons for collections ---------- */
const ICONS = {
  star:'<path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.8z"/>',
  coin:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="5"/><path d="M12 9.5v5"/>',
  stamp:'<path d="M6 3h12v2a1.5 1.5 0 0 0 0 3v2a1.5 1.5 0 0 0 0 3v2a1.5 1.5 0 0 0 0 3v3H6v-3a1.5 1.5 0 0 0 0-3v-2a1.5 1.5 0 0 0 0-3V8a1.5 1.5 0 0 0 0-3z"/><rect x="9" y="8" width="6" height="7" rx="1"/>',
  figure:'<circle cx="12" cy="6" r="3"/><path d="M8 21v-6l-2-1 1.5-4h9l1.5 4-2 1v6z"/>',
  brick:'<rect x="3" y="9" width="18" height="10" rx="1.5"/><rect x="6" y="5" width="4" height="4" rx="1"/><rect x="14" y="5" width="4" height="4" rx="1"/>',
  car:'<path d="M3 15v-3l2-4h10l4 4h2v3z"/><circle cx="7.5" cy="16" r="2"/><circle cx="16.5" cy="16" r="2"/>',
  pin:'<circle cx="12" cy="10" r="6"/><path d="M12 16v5M9 21h6"/><path d="M10 9l1.5 1.5L14.5 7"/>',
  watch:'<circle cx="12" cy="12" r="6"/><path d="M12 9v3l2 1.5M9 6.5L10 3h4l1 3.5M9 17.5l1 3.5h4l1-3.5"/>',
  card:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  gem:'<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M12 21L8 9l4-6 4 6z"/>',
  globe:'<circle cx="12" cy="11" r="7"/><path d="M5 11h14M12 4c2 2 3 4.5 3 7s-1 5-3 7M12 4c-2 2-3 4.5-3 7s1 5 3 7M8 21h8M12 18v3"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>',
  box:'<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  vinyl:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r=".6"/>',
  shell:'<path d="M12 20c-5 0-8-3-8-8a8 8 0 0 1 16 0c0 5-3 8-8 8z"/><path d="M12 20V6M8 19l2-12M16 19l-2-12M5 15l5-8M19 15l-5-8"/>',
  bear:'<circle cx="7" cy="6" r="2.5"/><circle cx="17" cy="6" r="2.5"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="14" r="2"/>',
  bottle:'<path d="M10 3h4v4l2 3v11H8V10l2-3z"/><path d="M8 14h8"/>'};
const icon = (id, size, color) => `<svg width="${size || 26}" height="${size || 26}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ICONS.star}</svg>`;

/* ---------- templates: the fields of a collection ---------- */
const TYPES = [['text', 'Text'], ['number', 'Number'], ['money', 'Money'], ['date', 'Date'], ['year', 'Year'], ['yesno', 'Yes / no'], ['choice', 'Pick from a list'], ['link', 'Link'], ['long', 'Long text']];
const typeName = t => (TYPES.find(x => x[0] === t) || TYPES[0])[1];
const SHAPES = [['square', 'Square', 1], ['tall', 'Tall', .7], ['wide', 'Wide', 1.4]];
const ratio = c => (SHAPES.find(s => s[0] === (c && c.shape)) || SHAPES[0])[2];
const F = (name, type, options) => ({id:uid().slice(-6) + Math.random().toString(36).slice(2, 4), name, type, options:options || []});
const COND = ['Mint', 'Very good', 'Good', 'Worn', 'Damaged'];
/* starting points: they fill in a template you can then change */
const STARTERS = [
  {k:'coins', name:'Coins', icon:'coin', shape:'square', camera:'photo', by:'Country', hint:'Country, year, metal, condition', f:() => [F('Country', 'text'), F('Year', 'year'), F('Face value', 'text'), F('Metal', 'choice', ['Gold', 'Silver', 'Copper', 'Nickel', 'Bi-metal', 'Other']), F('Condition', 'choice', ['Uncirculated', 'Extremely fine', 'Very fine', 'Fine', 'Worn']), F('Catalogue number', 'text')]},
  {k:'stamps', name:'Stamps', icon:'stamp', shape:'tall', camera:'photo', by:'Country', hint:'Country, year, mint or used', f:() => [F('Country', 'text'), F('Year', 'year'), F('Face value', 'text'), F('Condition', 'choice', ['Mint', 'Hinged', 'Used']), F('Theme', 'text'), F('Catalogue number', 'text')]},
  {k:'pops', name:'Vinyl figures (Funko Pop! …)', icon:'figure', shape:'tall', camera:'barcode', by:'Series', hint:'Number, series, exclusive, box', f:() => [F('Number', 'text'), F('Series', 'text'), F('Exclusive', 'yesno'), F('In the box', 'yesno'), F('Box condition', 'choice', COND.concat('No box'))]},
  {k:'lego', name:'Building sets (LEGO …)', icon:'brick', shape:'square', camera:'barcode', by:'Theme', hint:'Set number, theme, pieces, complete', f:() => [F('Set number', 'text'), F('Theme', 'text'), F('Year', 'year'), F('Pieces', 'number'), F('State', 'choice', ['Sealed', 'Built', 'In parts']), F('Complete', 'yesno'), F('Box', 'yesno'), F('Instructions', 'yesno')]},
  {k:'cars', name:'Die-cast cars', icon:'car', shape:'wide', camera:'photo', by:'Brand', hint:'Brand, model, scale, box', f:() => [F('Brand', 'text'), F('Model', 'text'), F('Maker', 'text'), F('Scale', 'choice', ['1:18', '1:24', '1:43', '1:64', 'Other']), F('Year', 'year'), F('In the box', 'yesno')]},
  {k:'figures', name:'Figures & statues', icon:'figure', shape:'tall', camera:'photo', by:'Series / franchise', hint:'Series, maker, size, condition', f:() => [F('Series / franchise', 'text'), F('Maker', 'text'), F('Year', 'year'), F('Size or scale', 'text'), F('In the box', 'yesno'), F('Condition', 'choice', COND)]},
  {k:'pins', name:'Trading pins', icon:'pin', shape:'square', camera:'photo', by:'Theme', hint:'Where from, year, limited', f:() => [F('Theme', 'text'), F('Where from', 'text'), F('Year', 'year'), F('Limited edition', 'yesno')]},
  {k:'watches', name:'Watches', icon:'watch', shape:'square', camera:'photo', by:'Brand', hint:'Brand, model, movement, papers', f:() => [F('Brand', 'text'), F('Model', 'text'), F('Reference', 'text'), F('Year', 'year'), F('Movement', 'choice', ['Automatic', 'Manual', 'Quartz']), F('Box & papers', 'yesno')]},
  {k:'minerals', name:'Fossils & minerals', icon:'gem', shape:'square', camera:'photo', by:'Kind', hint:'Kind, where found, size', f:() => [F('Kind', 'text'), F('Where found', 'text'), F('Size', 'text'), F('Weight (g)', 'number')]},
  {k:'blank', name:'Start empty', icon:'star', shape:'square', camera:'photo', by:'', hint:'Only name, photos, notes, tags', f:() => []}];
const fieldsOf = c => (c.fields || []).filter(f => !f.gone);
const fieldById = (c, id) => (c.fields || []).find(f => f.id === id);
const groupField = c => { const f = c.groupBy && fieldById(c, c.groupBy); return f && !f.gone ? f : null };

/* ---------- money ---------- */
const CURS = [['EUR', '€ euro'], ['USD', '$ dollar'], ['GBP', '£ pound'], ['CHF', 'CHF franc'], ['JPY', '¥ yen']];
const money = n => { if(n == null || n === '' || isNaN(n)) return ''; try{ return new Intl.NumberFormat(undefined, {style:'currency', currency:S.cur || 'EUR', minimumFractionDigits:n % 1 ? 2 : 0, maximumFractionDigits:2}).format(n) }catch(e){ return (+n).toFixed(2) } };
const parseMoney = s => { s = String(s == null ? '' : s).trim().replace(/[^\d,.\-]/g, ''); if(!s) return null;
  if(s.includes(',') && !s.includes('.')) s = s.replace(',', '.'); else if(s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s); return isNaN(n) ? null : Math.round(n * 100) / 100 };
const cnt = it => Math.max(1, it.count || 1);
const worthOf = it => it.worth != null ? it.worth * cnt(it) : null, paidOf = it => it.paid != null ? it.paid * cnt(it) : null;
function totals(list){ let worth = 0, paid = 0, nw = 0, np = 0, both = 0, bw = 0, bp = 0;
  for(const it of list){ const w = worthOf(it), p = paidOf(it); if(w != null){ worth += w; nw++ } if(p != null){ paid += p; np++ } if(w != null && p != null){ both++; bw += w; bp += p } }
  return {worth, paid, nw, np, gain:bw - bp, both} }
const gainTxt = g => g > 0 ? `<span class="up">+${esc(money(g))}</span>` : g < 0 ? `<span class="down">−${esc(money(-g))}</span>` : esc(money(0));
function totLine(c, list){ if(!c.prices) return ''; const t = totals(list); if(!t.nw && !t.np) return '';
  return [t.nw ? `worth <b>${esc(money(t.worth))}</b>` : '', t.np ? `paid ${esc(money(t.paid))}` : '', t.both ? gainTxt(t.gain) : ''].filter(Boolean).join(' · ') }

/* ---------- collections and items ---------- */
let COLLS = [], ITEMS = [], IT = {}, CO = {};
function rebuild(){ COLLS.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.added || 0) - (b.added || 0)); CO = Object.fromEntries(COLLS.map(c => [c.id, c])); IT = Object.fromEntries(ITEMS.map(x => [x.id, x])); regroup() }
const inColl = id => ITEMS.filter(x => x.coll === id);
const valTxt = (f, v) => { if(v == null || v === '') return ''; if(f.type === 'yesno') return v === true || v === 'yes' ? 'Yes' : 'No'; if(f.type === 'money') return money(v); if(f.type === 'date') return dateTxt(v); return String(v) };
function subLine(it){ const c = CO[it.coll] || {}, fs = fieldsOf(c), gf = groupField(c);
  const bits = fs.filter(f => f !== gf && f.type !== 'long' && f.type !== 'link' && f.type !== 'yesno' && it.v && it.v[f.id] !== '' && it.v[f.id] != null).slice(0, 2).map(f => valTxt(f, it.v[f.id]));
  if(c.prices && it.worth != null) bits.unshift(money(worthOf(it)));
  return bits.join(' · ') }
async function saveItem(it){ it.changed = Date.now(); await dbPut('items', it); if(!IT[it.id]) ITEMS.push(it); rebuild() }
async function saveColl(c){ await dbPut('colls', c); if(!CO[c.id]) COLLS.push(c); rebuild() }

/* ---------- groups: the shared way of every Nightvault app (../hub/nvgroups.js, plans/shared-groups.md) – one engine per collection ----------
   automatic group: items with the same value in the template's "tiles by" field (e.g. Country, Series, Theme) */
const GRS = {};
function grOf(cid){ if(GRS[cid]) return GRS[cid];
  return GRS[cid] = NVGROUPS.make({prefix:'nvCollect.g.' + cid, app:'collectables-' + cid, title:'Collectables · ' + ((CO[cid] || {}).name || ''), itemsKey:'itemGroup', norm, key:x => x.id,
    hay:x => [x.name].concat(Object.values(x.v || {}).filter(v => typeof v === 'string')).join(' '), kinds:{field:'Same value'},
    auto:x => { const c = CO[x.coll], f = c && groupField(c), v = f && x.v ? String(x.v[f.id] == null ? '' : x.v[f.id]).trim() : ''; return v ? {key:'f:' + norm(v), name:v, kind:'field'} : null },
    onRekey:async (from, to) => { const id = 'grp:' + cid + ':' + from; if(!PICS.has(id)) return; const r = await dbGet('pics', id).catch(() => null); if(r){ await setPic('grp:' + cid + ':' + to, r.blob); draw() } }}) }
let GROUPCACHE = {};
const regroup = () => { GROUPCACHE = {} };
const groupsOf = cid => GROUPCACHE[cid] || (GROUPCACHE[cid] = grOf(cid).build(inColl(cid)));
const grChange = (cid, fn, msg) => { const G = grOf(cid); G.change(fn); regroup(); G.undoToast(msg, () => { regroup(); selEnd(true); draw() }) };
const groupByKey = (cid, k) => groupsOf(cid).groups.find(g => g.key === k) || null;
const groupOfItem = it => groupsOf(it.coll).groups.find(g => g.items.includes(it)) || null;
const G_path = (cid, g) => grOf(cid).path(g, groupsOf(cid).groups);

/* ---------- pictures: your photos, kept in the app (a big one and a small one for tiles) ---------- */
const PICS = new Set(), PICURL = {};
async function picUrl(id){ if(!PICS.has(id)) return null; if(PICURL[id]) return PICURL[id]; const r = await dbGet('pics', id).catch(() => null); if(!r){ PICS.delete(id); return null } return PICURL[id] = URL.createObjectURL(r.blob) }
async function setPic(id, blob){ await dbPut('pics', {id, blob}); PICS.add(id); if(PICURL[id]){ URL.revokeObjectURL(PICURL[id]); delete PICURL[id] } }
async function delPic(id){ await dbDel('pics', id).catch(() => {}); PICS.delete(id); if(PICURL[id]){ URL.revokeObjectURL(PICURL[id]); delete PICURL[id] } }
async function shrink(blob, max, q){
  let bm; try{ bm = await createImageBitmap(blob) }catch(e){ const u = URL.createObjectURL(blob); try{ const im = new Image(); im.src = u; await im.decode(); bm = im }finally{ setTimeout(() => URL.revokeObjectURL(u), 1000) } }
  const sc = Math.min(1, max / Math.max(bm.width, bm.height)), w = Math.round(bm.width * sc), h = Math.round(bm.height * sc), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h); if(bm.close) bm.close();
  return new Promise(ok => c.toBlob(b => ok(b), 'image/webp', q || .85)) }
/* a new photo: saved twice (1600 px to look at, 420 px for the tiles); returns its id */
async function addPhoto(blob){ const id = uid(); await setPic('p:' + id, await shrink(blob, 1600, .86)); await setPic('t:' + id, await shrink(blob, 420, .8)); return id }
async function delPhoto(id){ await delPic('p:' + id); await delPic('t:' + id) }
const pickPictures = multi => new Promise(ok => { const i = $('#pickpic'); i.value = ''; i.multiple = multi !== false; i.onchange = e => ok([...e.target.files]); i.click() });
window.imgOk = el => { const ph = el.parentNode && el.parentNode.querySelector('.ph'); if(ph) ph.style.visibility = 'hidden' };
window.imgFail = el => { const cv = el.closest('.cv'); if(cv) cv.querySelectorAll('img').forEach(i => i.remove()) };
const covIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ covIO.unobserve(e.target); fillCov(e.target) } }, {rootMargin:'300px'}) : null;
async function fillCov(el){ const u = await picUrl(el.dataset.cov); if(!u) return; el.querySelectorAll('img').forEach(i => i.remove()); el.insertAdjacentHTML('afterbegin', `<img class="b" src="${u}" alt=""><img class="f" src="${u}" alt="">`); imgOk(el.querySelector('img.f')) }
function lazyCovers(root){ (root || document).querySelectorAll('[data-cov]').forEach(el => { if(!PICS.has(el.dataset.cov)) return; covIO ? covIO.observe(el) : fillCov(el) }) }
function phHTML(name, sub, ic){ const h = hue(name || '');
  return `<div class="ph" style="--c1:hsl(${h} 40% 26%);--c2:hsl(${(h + 50) % 360} 35% 13%)">${icon(ic, 22, '#fff')}${esc(name || '')}<span>${esc(sub || '')}</span></div>` }
const hasPic = it => (it.pics || []).some(p => PICS.has('t:' + p)) || !!it.img;
function coverHTML(it, extra){ const c = CO[it.coll] || {}, p = (it.pics || []).find(x => PICS.has('t:' + x));
  const im = !p && it.img ? `<img class="b" src="${esc(it.img)}" alt="" loading="lazy" onerror="imgFail(this)"><img class="f" src="${esc(it.img)}" alt="" loading="lazy" onerror="imgFail(this)" onload="imgOk(this)">` : '';
  return `<div class="cv"${p ? ` data-cov="t:${esc(p)}"` : ''} style="--cover-ratio:${ratio(c)}">${phHTML(it.name, (fieldsOf(c)[0] && it.v ? valTxt(fieldsOf(c)[0], it.v[fieldsOf(c)[0].id]) : ''), c.icon)}${im}${extra || ''}</div>` }
const RNDCOV = {};
function groupCoverHTML(cid, g){ const G = grOf(cid), c = G.cover(g.key), all = g.all || g.items, wc = all.filter(hasPic), co = CO[cid] || {};
  if(c.t === 'pic' && PICS.has('grp:' + cid + ':' + g.key)) return `<div class="cv" data-cov="grp:${esc(cid)}:${esc(g.key)}" style="--cover-ratio:${ratio(co)}">${phHTML(g.name, '', co.icon)}</div>`;
  let it = null; if(c.t === 'item' || c.t === 'album') it = all.find(x => x.id === c.al);
  if((c.t === 'random' || c.t === 'cycle') && wc.length){ it = wc.find(x => x.id === RNDCOV[g.key]) || wc[Math.floor(Math.random() * wc.length)]; RNDCOV[g.key] = it.id }
  it = it || wc[0] || all[0]; return it ? coverHTML(it) : `<div class="cv" style="--cover-ratio:${ratio(co)}">${phHTML(g.name, '', co.icon)}</div>` }
/* "changing" tile covers: a different photo every few seconds */
setInterval(() => { if(document.hidden) return; let any = false;
  for(const cid of Object.keys(GROUPCACHE)){ const G = grOf(cid); for(const g of GROUPCACHE[cid].groups) if(G.cover(g.key).t === 'cycle'){ delete RNDCOV[g.key]; any = true } }
  const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if(any && !typing && !sheetOpen() && !SEL && !$('#cam') && (cur().v === 'coll' || cur().v === 'group')){ const y = scrollY; draw(); scrollTo(0, y) } }, 6000);

/* ---------- tiles ---------- */
function itemTile(it){ const G = grOf(it.coll);
  return `<div class="bk" data-item="${esc(it.id)}">${coverHTML(it, (G.isPinned('it:' + it.id) ? PINB : '') + (cnt(it) > 1 ? `<span class="np">×${cnt(it)}</span>` : ''))}
    <div class="t">${esc(it.name)}</div><div class="a">${esc(subLine(it) || ' ')}</div></div>` }
function groupTile(cid, g){ const all = g.all || g.items, k = (g.kids || []).length, G = grOf(cid), c = CO[cid] || {}, t = c.prices ? totals(all) : null;
  return `<div class="bk stack" data-grp="${esc(g.key)}">${groupCoverHTML(cid, g)}${G.isPinned('gr:' + g.key) ? PINB : ''}<span class="cdl">${k ? plural(k, 'group') + ' · ' : ''}${all.length ? plural(all.length, 'item') : 'empty'}</span>
    <div class="t">${esc(g.name)}</div><div class="a">${esc(t && t.nw ? money(t.worth) : G.label(g))}</div></div>` }

/* ---------- screens: a stack of views ---------- */
let V = [{v:'home'}];
const cur = () => V[V.length - 1];
function go(v){ selEnd(true); V.push(v); draw(); scrollTo(0, 0) }
function back(){ if(SEL){ selEnd(); return true } if(V.length > 1){ V.pop(); draw(); return true } return false }
$('#vback').onclick = () => back();
const Q = {};
/* sort: the same small menu on every page, each page remembers its own choice; the template's number / money / year / date / text fields can be sorted on too */
function sortsOf(c){ const l = [['name', 'Name'], ['added', 'Recently added']]; if(c.prices) l.push(['worth', 'Worth most'], ['paid', 'Paid most'], ['gain', 'Gained most']);
  for(const f of fieldsOf(c)) if(f.type !== 'long' && f.type !== 'link') l.push(['f:' + f.id, f.name]); return l }
const sortOf = (c, key) => { const k = S.sort[key]; return sortsOf(c).some(x => x[0] === k) ? k : 'name' };
const sortSel = (c, key) => `<select data-skey="${esc(key)}" aria-label="Sort">${sortsOf(c).map(([k, t]) => `<option value="${esc(k)}" ${sortOf(c, key) === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
const allOf = x => x.items ? (x.all || x.items) : [x];
function sortVal(x, k){ const all = allOf(x);
  if(k === 'added') return Math.max(0, ...all.map(i => i.added || 0));
  if(k === 'worth' || k === 'paid' || k === 'gain'){ const t = totals(all); return k === 'worth' ? t.worth : k === 'paid' ? t.paid : t.gain }
  if(k.startsWith('f:')){ const fid = k.slice(2), it = x.items ? all[0] : x; const v = it && it.v ? it.v[fid] : null; return v == null ? '' : v }
  return 0 }
function sortTiles(list, k, c){ const nm = x => norm(x.name);
  if(k === 'name' || !k) return list.slice().sort((a, b) => coll.compare(nm(a), nm(b)));
  const f = k.startsWith('f:') ? fieldById(c, k.slice(2)) : null, numeric = !f || /^(number|money|year)$/.test(f.type);
  return list.slice().sort((a, b) => { let va = sortVal(a, k), vb = sortVal(b, k);
    if(va === '' && vb !== '') return 1; if(vb === '' && va !== '') return -1;
    let r; if(numeric){ va = +va || 0; vb = +vb || 0; r = f ? va - vb : vb - va } else if(f && f.type === 'date') r = String(vb).localeCompare(String(va)); else if(f && f.type === 'yesno') r = (vb === true) - (va === true); else r = coll.compare(String(va), String(vb));
    return r || coll.compare(nm(a), nm(b)) }) }

function draw(){
  const v = cur(), body = $('#body'); $('#vback').hidden = V.length < 2;
  $('#addbtn').hidden = v.v === 'item'; $('#addlbl').textContent = v.v === 'home' ? 'New collection' : 'Add';
  $('#hubback').hidden = !(fromHub() && V.length < 2);
  document.documentElement.style.setProperty('--cover-ratio', String(v.coll && CO[v.coll] ? ratio(CO[v.coll]) : 1));
  if(v.v === 'coll' && !CO[v.coll] || v.v === 'group' && !CO[v.coll] || v.v === 'item' && !IT[v.id]){ V.pop(); return draw() }
  if(v.v === 'home') return drawHome(body);
  if(v.v === 'coll') return drawColl(body, v);
  if(v.v === 'group') return drawGroup(body, v);
  if(v.v === 'item') return drawItem(body, v.id) }

function drawHome(body){ $('#vtitle').textContent = 'Collectables'; document.title = 'Nightvault Collectables';
  let h = '';
  if(!COLLS.length){ body.innerHTML = `<div class="empty">${icon('star', 48)}<h2 style="margin:8px 0 4px;font-size:18px">What do you collect?</h2>
      <p class="muted small" style="margin:0 0 14px">Make a collection for it – coins, figures, stamps, cars, anything. You choose the fields every item gets (that is its <b>template</b>), then add items with photos, notes and what they are worth.</p>
      <button class="btn primary" id="emptynew">Make your first collection</button></div>`; $('#emptynew').onclick = () => editTemplate(null); return }
  const rec = ITEMS.slice().sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 10);
  if(rec.length > 3) h += `<div class="sec" style="margin-top:4px">Recently added</div><div style="display:flex;gap:10px;overflow-x:auto;padding:2px 0 6px;scrollbar-width:none">${rec.map(it => `<div class="bk" data-item="${esc(it.id)}" style="width:92px;flex:none">${coverHTML(it)}<div class="t">${esc(it.name)}</div><div class="a">${esc((CO[it.coll] || {}).name || '')}</div></div>`).join('')}</div>`;
  h += '<div class="shelves">' + COLLS.map(c => { const its = inColl(c.id), h0 = hue(c.name), t = c.prices ? totals(its) : null;
      const fan = its.filter(hasPic).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 3);
      return `<div class="shelf" data-coll="${esc(c.id)}" style="background:linear-gradient(150deg,hsl(${h0} 38% 22%),hsl(${(h0 + 60) % 360} 30% 13%))"><div class="ic">${icon(c.icon, 26, `hsl(${h0} 80% 78%)`)}</div><div class="fan">${fan.map(x => `<img data-fan="${esc(x.id)}" alt="" onerror="this.remove()">`).join('')}</div>
        <b>${esc(c.name)}</b><div class="s">${its.length ? plural(its.reduce((a, x) => a + cnt(x), 0), 'item') : 'empty'}${t && t.nw ? ' · ' + esc(money(t.worth)) : ''}</div></div>` }).join('')
    + `<div class="shelf add" data-newcoll="1">${icon('star', 34)}<b style="font-size:15px">New collection</b><div class="s" style="color:var(--dim)">with its own template</div></div></div>`;
  const pc = COLLS.filter(c => c.prices), t = totals(ITEMS.filter(x => CO[x.coll] && CO[x.coll].prices));
  if(pc.length && (t.nw || t.np)) h += `<div class="mtot" style="text-align:center;margin-top:16px">All collections: ${[t.nw ? `worth <b>${esc(money(t.worth))}</b>` : '', t.np ? `paid ${esc(money(t.paid))}` : '', t.both ? gainTxt(t.gain) : ''].filter(Boolean).join(' · ')}</div>`;
  body.innerHTML = h; lazyCovers(body);
  body.querySelectorAll('[data-fan]').forEach(async im => { const it = IT[im.dataset.fan], p = (it.pics || []).find(x => PICS.has('t:' + x)); const u = p ? await picUrl('t:' + p) : it.img; if(u) im.src = u; else im.remove() }) }

function searchHay(it){ const c = CO[it.coll] || {}; return norm([it.name, it.notes, it.code, (it.tags || []).join(' '), ...fieldsOf(c).map(f => valTxt(f, (it.v || {})[f.id]))].join(' ')) }
function drawColl(body, v){ const c = CO[v.coll], all = inColl(c.id), q = norm(Q[c.id] || ''), G = grOf(c.id);
  $('#vtitle').textContent = c.name; document.title = c.name + ' · Collectables';
  if(!all.length){ body.innerHTML = `<div class="empty">${icon(c.icon, 48)}<h2 style="margin:8px 0 4px;font-size:18px">No ${esc(c.name.toLowerCase())} yet</h2><p class="muted small" style="margin:0 0 14px">Add your first one: take a photo${c.camera === 'barcode' ? ', scan the barcode on the box' : ''} or type it in.</p>
      <div class="mlist" style="max-width:320px;margin:0 auto">${addButtons(c)}</div><p class="muted small" style="margin:14px 0 0">Fields of every item: ${esc(['name', 'photos', ...fieldsOf(c).map(f => f.name.toLowerCase()), c.prices ? 'paid and worth' : '', 'notes', 'tags'].filter(Boolean).join(', '))}. <span class="lnk" id="edtpl">Change the template</span></p></div>`;
    hookAdd(body, c); $('#edtpl').onclick = () => editTemplate(c); return }
  let h = `<div class="mtot">${plural(all.reduce((a, x) => a + cnt(x), 0), 'item')}${totLine(c, all) ? ' · ' + totLine(c, all) : ''}</div>`;
  h += `<input type="search" id="q" placeholder="Search ${esc(c.name.toLowerCase())}" value="${esc(Q[c.id] || '')}" style="margin:2px 0 8px">`;
  if(q){ const {groups:gs} = groupsOf(c.id), where = {}; for(const g of gs) for(const x of g.items) where[x.id] = G.path(g, gs);
    const gm = gs.filter(g => norm(g.name).includes(q)).slice(0, 12), im = all.filter(x => searchHay(x).includes(q)).sort((a, b) => coll.compare(a.name, b.name));
    if(!gm.length && !im.length) h += '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
    if(gm.length) h += `<div class="sec">Groups</div><div class="grid">${gm.map(g => groupTile(c.id, g).replace(/<div class="a">[^<]*<\/div>/, g.parent ? `<div class="a">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : '$&')).join('')}</div>`;
    if(im.length) h += `<div class="sec">Items</div><div class="grid">${im.slice(0, 300).map(x => itemTile(x).replace(/<div class="a">[^<]*<\/div>/, where[x.id] ? `<div class="a">in ${esc(where[x.id])}</div>` : '$&')).join('')}</div>` }
  else { const grouped = S.grouped[c.id] !== false, skey = 'coll:' + c.id, k = sortOf(c, skey);
    h += `<div class="mbar"><select id="grouped" aria-label="Groups"><option value="1" ${grouped ? 'selected' : ''}>Grouped</option><option value="0" ${!grouped ? 'selected' : ''}>All items</option></select>${sortSel(c, skey)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button><button class="btn sm" id="newgrp">+ Group</button></div>`;
    let tiles; if(!grouped) tiles = sortTiles(all, k, c); else { const {groups, singles} = groupsOf(c.id); tiles = sortTiles([...groups.filter(g => !g.parent), ...singles], k, c) }
    tiles = G.pinFirst(tiles, x => x.items ? 'gr:' + x.key : 'it:' + x.id);
    h += `<div class="grid">${tiles.map(x => x.items ? groupTile(c.id, x) : itemTile(x)).join('')}</div>` }
  body.innerHTML = h; lazyCovers(body);
  const qi = $('#q'); if(qi) qi.oninput = () => { Q[c.id] = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const p = qi.selectionStart; draw(); const n = $('#q'); if(n){ n.focus(); try{ n.setSelectionRange(p, p) }catch(e){} } }, 250) };
  hookGrid() }

function drawGroup(body, v){ const c = CO[v.coll], G = grOf(c.id), g = groupByKey(c.id, v.key); if(!g){ V.pop(); return draw() }
  const gs = groupsOf(c.id).groups, all = g.all;
  $('#vtitle').textContent = ''; document.title = g.name + ' · Collectables';
  let h = `<div class="alhead"><div class="stack" style="flex:none"><div class="gcv">${groupCoverHTML(c.id, g)}</div></div><div style="min-width:0;flex:1"><b>${esc(g.name)}</b>
    ${g.parent ? `<div class="lnk small" data-gotogrp="${esc(g.parent)}">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : `<div class="lnk small" data-gotocoll="1">in ${esc(c.name)}</div>`}
    <div class="muted small">${esc(G.label(g))} · ${(g.kids || []).length ? plural(g.kids.length, 'group') + ' · ' : ''}${plural(all.reduce((a, x) => a + cnt(x), 0), 'item')}</div>
    ${totLine(c, all) ? `<div class="muted small">${totLine(c, all)}</div>` : ''}</div></div>`;
  const key = 'grp:' + c.id + ':' + g.key, k = sortOf(c, key);
  h += `<div class="mbar">${sortSel(c, key)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button><button class="ib" id="gmenu" aria-label="More for this group">${IC_DOTS}</button></div>`;
  const kids = sortTiles(g.kids || [], k, c), items = sortTiles(g.items, k, c);
  h += `<div class="grid">${G.pinFirst([...kids, ...items], x => x.items ? 'gr:' + x.key : 'it:' + x.id).map(x => x.items ? groupTile(c.id, x) : itemTile(x)).join('')}</div>`;
  if(!all.length) h += `<p class="muted small" style="margin-top:12px">Empty. Tap <b>Add</b> for a new item here, or ⋯ → <b>Add items…</b> to put items in it.</p>`;
  body.innerHTML = h; lazyCovers(body); hookGrid(); $('#gmenu').onclick = () => groupMenu(c.id, g) }

/* ---------- the item page ---------- */
function drawItem(body, id){ const it = IT[id], c = CO[it.coll], g = groupOfItem(it);
  $('#vtitle').textContent = ''; document.title = it.name + ' · Collectables';
  const pics = (it.pics || []).filter(p => PICS.has('p:' + p));
  let h = pics.length || it.img ? `<div class="gal">${pics.map(p => `<div class="ph1" data-zoom="p:${esc(p)}"><img class="b" data-src="p:${esc(p)}" alt=""><img class="f" data-src="p:${esc(p)}" alt=""></div>`).join('')}${it.img ? `<div class="ph1" data-zoomurl="${esc(it.img)}"><img class="b" src="${esc(it.img)}" alt="" onerror="this.parentNode.remove()"><img class="f" src="${esc(it.img)}" alt=""></div>` : ''}</div>` : '';
  h += `<div style="margin:4px 0 10px"><b style="font-size:20px;line-height:1.25;display:block">${esc(it.name)}${cnt(it) > 1 ? ` <span class="muted" style="font-weight:500">×${cnt(it)}</span>` : ''}</b>
    <div class="lnk small" data-gotocoll="1">${esc(c.name)}</div>${g ? `<div class="lnk small" data-gotogrp2="1">in ${esc(G_path(c.id, g))}</div>` : ''}</div>
    <div class="mbar"><button class="btn primary" id="iedit" style="flex:1">Edit</button><button class="btn" id="iphoto">+ Photo</button><button class="ib" id="imenu" aria-label="More for this item">${IC_DOTS}</button></div>`;
  if(c.prices){ const w = worthOf(it), p = paidOf(it), st = [['Worth now', w != null ? money(w) : '–'], ['Paid', p != null ? money(p) : '–']];
    if(w != null && p != null) st.push(['Difference', gainTxt(w - p)]); if(cnt(it) > 1 && it.worth != null) st.push(['Worth each', money(it.worth)]);
    h += `<div class="stats">${st.map(([k, x], i) => `<div class="stat"><small>${k}</small><b>${i === 2 ? x : esc(x)}</b></div>`).join('')}</div>` }
  const facts = fieldsOf(c).filter(f => f.type !== 'long').map(f => [f.name, (it.v || {})[f.id], f]).filter(x => x[1] !== '' && x[1] != null);
  const old = (c.fields || []).filter(f => f.gone && it.v && it.v[f.id] !== '' && it.v[f.id] != null);
  if(it.code) facts.push(['Barcode', it.code, {type:'text'}]);
  if(facts.length) h += `<div class="sec">Details</div><div class="facts">${facts.map(([k, x, f]) => `<span>${esc(k)}</span><span style="min-width:0;overflow-wrap:anywhere">${f.type === 'link' ? `<a href="${esc(/^https?:/i.test(x) ? x : 'https://' + x)}" target="_blank" rel="noopener">${esc(x)}</a>` : esc(valTxt(f, x))}</span>`).join('')}</div>`;
  for(const f of fieldsOf(c).filter(f => f.type === 'long' && it.v && it.v[f.id])) h += `<div class="sec">${esc(f.name)}</div><div class="desc">${esc(it.v[f.id])}</div>`;
  if((it.tags || []).length) h += `<div class="sec">Tags</div><div>${it.tags.map(t => `<span class="tagl">${esc(t)}</span>`).join('')}</div>`;
  if(it.notes) h += `<div class="sec">Notes</div><div class="desc">${esc(it.notes)}</div>`;
  if(old.length) h += `<div class="sec">Fields no longer in the template</div><div class="facts">${old.map(f => `<span>${esc(f.name)}</span><span>${esc(valTxt(f, it.v[f.id]))}</span>`).join('')}</div><p class="muted small">Kept for you. Put the field back in the template (⚙ › Change the template) to use it again.</p>`;
  h += `<p class="muted small" style="margin-top:18px">Added ${esc(new Date(it.added || Date.now()).toLocaleDateString())}${it.changed && it.changed - (it.added || 0) > 6e4 ? ' · changed ' + esc(new Date(it.changed).toLocaleDateString()) : ''}</p>`;
  body.innerHTML = h;
  body.querySelectorAll('img[data-src]').forEach(async im => { const u = await picUrl(im.dataset.src); if(u) im.src = u });
  $('#iedit').onclick = () => editItem(it); $('#imenu').onclick = () => itemMenu(it);
  $('#iphoto').onclick = () => photoSource(async blobs => { for(const b of blobs) it.pics = (it.pics || []).concat(await addPhoto(b)); await saveItem(it); draw(); toast(plural(blobs.length, 'photo') + ' added') });
  body.querySelectorAll('[data-gotogrp2]').forEach(el => el.onclick = () => { if(g) go({v:'group', coll:c.id, key:g.key}) }) }
function zoom(src){ const z = document.createElement('div'); z.id = 'zoom'; z.innerHTML = `<img alt="">`; document.body.appendChild(z); z.onclick = () => z.remove();
  if(src.startsWith('http')) z.firstChild.src = src; else picUrl(src).then(u => { if(u) z.firstChild.src = u }) }

/* clicks on the screens */
$('#body').addEventListener('click', e => {
  if(selSkip){ selSkip = false; return }
  const t = e.target, el = t.closest('[data-coll],[data-newcoll],[data-item],[data-grp],[data-selstart],[data-gotogrp],[data-gotocoll],[data-zoom],[data-zoomurl],#newgrp');
  if(!el) return; const v = cur();
  if(SEL && el.closest('.grid') && (el.dataset.item || el.dataset.grp)){ const id = el.dataset.item ? 'it:' + el.dataset.item : 'gr:' + el.dataset.grp; SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw(); return }
  if(el.id === 'newgrp') return newGroup(v.coll);
  if(el.dataset.newcoll) return editTemplate(null);
  if(el.dataset.coll) return go({v:'coll', coll:el.dataset.coll});
  if(el.dataset.zoom) return zoom(el.dataset.zoom);
  if(el.dataset.zoomurl) return zoom(el.dataset.zoomurl);
  if(el.dataset.item) return go({v:'item', id:el.dataset.item});
  if(el.dataset.grp) return go({v:'group', coll:v.coll, key:el.dataset.grp});
  if(el.dataset.gotocoll){ const cid = v.coll || (IT[v.id] || {}).coll; while(V.length > 1 && !(cur().v === 'coll' && cur().coll === cid)) V.pop(); if(cur().v !== 'coll') V.push({v:'coll', coll:cid}); return draw() }
  if(el.dataset.gotogrp){ V.pop(); if(cur().v !== 'group' || cur().key !== el.dataset.gotogrp) V.push({v:'group', coll:v.coll, key:el.dataset.gotogrp}); return draw() }
  if(el.dataset.selstart) return selStart() });
$('#body').addEventListener('change', e => { const t = e.target, v = cur();
  if(t.dataset.skey){ S.sort[t.dataset.skey] = t.value; saveS(); draw() }
  if(t.id === 'grouped'){ S.grouped[v.coll] = t.value === '1'; saveS(); draw() } });
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
const ask = (title, ph, val, btn) => new Promise(ok => { sheet(`<h3>${title}</h3><input type="text" id="askv" placeholder="${esc(ph || '')}" value="${esc(val || '')}" maxlength="80"><div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" id="askno">Cancel</button><button class="btn primary" style="flex:2" id="askok">${btn || 'OK'}</button></div>`);
  setTimeout(() => { const i = $('#askv'); if(i){ i.focus(); i.select() } }, 50);
  const done = v => { closeSheet(); ok(v) }; $('#askno').onclick = () => done(null); $('#askok').onclick = () => done($('#askv').value.trim()); $('#askv').onkeydown = e => { if(e.key === 'Enter') done($('#askv').value.trim()) } });

/* =====================================================================================================================
   ADDING ITEMS – take a photo, scan a barcode, or type it in (the template says which comes first)
   ===================================================================================================================== */
function addButtons(c){ const b = [['photo', 'Take a photo'], ['barcode', 'Scan a barcode'], ['type', 'Type it in']];
  if(c.camera === 'barcode') b.unshift(b.splice(1, 1)[0]);
  return b.map(([k, t], i) => `<button class="btn ${i ? '' : 'primary'}" data-addhow="${k}">${t}</button>`).join('') }
function hookAdd(root, c, group){ root.querySelectorAll('[data-addhow]').forEach(b => b.onclick = () => { closeSheet(); addHow(c, b.dataset.addhow, group) }) }
function addHow(c, how, group){
  if(how === 'type') return editItem(null, c.id, {group});
  if(how === 'photo') return openCam({mode:'photo', title:'Photos of the new item', onPhotos:blobs => editItem(null, c.id, {group, blobs})});
  if(how === 'barcode') return openCam({mode:'barcode', title:'Scan the barcode', onCode:(code, shots) => codeFound(c, code, group, shots), onPhotos:blobs => editItem(null, c.id, {group, blobs})}) }
function addSheet(){ const v = cur(); if(v.v === 'home') return editTemplate(null);
  const c = CO[v.coll], group = v.v === 'group' ? v.key : null, g = group ? groupByKey(c.id, group) : null;
  sheet(`<h3>Add to ${esc(g ? g.name : c.name)}</h3><div class="mlist">${addButtons(c)}</div>`); hookAdd($('.sheet'), c, group) }
/* a barcode was read: do you have it already? else look it up and make a new item */
async function codeFound(c, code, group, blobs){ const have = ITEMS.filter(x => x.code === code);
  if(have.length){ sheet(`<h3>You already have this</h3><p class="muted small" style="margin:-4px 0 8px">Barcode ${esc(code)}</p>
      ${have.map(x => `<div class="li" data-have="${esc(x.id)}"><span class="th">${coverHTML(x)}</span><div class="n"><div>${esc(x.name)}${cnt(x) > 1 ? ' ×' + cnt(x) : ''}</div><div class="s">${esc((CO[x.coll] || {}).name || '')}</div></div></div>`).join('')}
      <div class="mlist" style="margin-top:10px"><button class="btn primary" id="hvplus">I have one more (×${cnt(have[0]) + 1})</button><button class="btn" id="hvnew">Add it as a new item</button><button class="btn" onclick="closeSheet()">Cancel</button></div>`);
    lazyCovers($('.sheet'));
    $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-have]'); if(r){ closeSheet(); go({v:'item', id:r.dataset.have}) } });
    $('#hvplus').onclick = async () => { const x = have[0]; x.count = cnt(x) + 1; await saveItem(x); closeSheet(); draw(); toast(`“${x.name}” ×${x.count}`) };
    $('#hvnew').onclick = () => { closeSheet(); lookupAndEdit(c, code, group, blobs) }; return }
  lookupAndEdit(c, code, group, blobs) }
async function lookupAndEdit(c, code, group, blobs){ toast('Looking up ' + code + '…', 8000); let r = null;
  try{ r = await lookupCode(code) }catch(e){ LE('lookup', 'failed', {code, e:String(e && e.message || e)}) }
  toast(r && r.name ? 'Found: ' + r.name : 'Not found in the free product lists - type the name', 3500);
  editItem(null, c.id, {group, code, blobs, name:r && r.name, img:r && r.img, brand:r && r.brand}) }

/* ---------- barcode look-up: free lists, no account. Books (ISBN) from Open Library, other products from UPCitemdb (100 a day).
   Inside the Android app the request goes through the app (CapacitorHttp), so sites that block web pages still answer. */
async function getJSON(url){ const H = HTTP();
  if(H){ const r = await H.get({url, headers:{Accept:'application/json', 'User-Agent':'Mozilla/5.0 (Android) NightvaultCollectables/1.0'}, responseType:'json'}); if(r.status === 404) return null; if(r.status >= 400) throw new Error(url.split('/')[2] + ' answered ' + r.status); return typeof r.data === 'string' ? JSON.parse(r.data) : r.data }
  const r = await fetch(url); if(r.status === 404) return null; if(!r.ok) throw new Error(url.split('/')[2] + ' answered ' + r.status); return r.json() }
async function lookupCode(code){ const c = String(code).replace(/\D/g, '');
  if(/^97[89]\d{10}$/.test(c)){ try{ const b = await getJSON(`https://openlibrary.org/isbn/${c}.json`);
      if(b && b.title) return {name:b.title + (b.subtitle ? ': ' + b.subtitle : ''), img:`https://covers.openlibrary.org/b/isbn/${c}-L.jpg?default=false`, src:'Open Library'} }catch(e){ LE('lookup', 'openlibrary', String(e.message || e)) } }
  if(c.length >= 8){ const j = await getJSON('https://api.upcitemdb.com/prod/trial/lookup?upc=' + c);
    const x = j && j.items && j.items[0]; if(x && x.title) return {name:x.title.trim(), brand:x.brand || '', img:(x.images || []).find(u => /^https:/.test(u)) || '', src:'UPCitemdb'} }
  return null }

/* =====================================================================================================================
   EDITING AN ITEM – the fields come from the collection's template
   ===================================================================================================================== */
function fieldInput(f, v){ const id = 'fv_' + f.id, val = v == null ? '' : v;
  switch(f.type){
    case 'number': return `<input type="number" step="any" inputmode="decimal" id="${id}" value="${esc(val)}">`;
    case 'year': return `<input type="number" inputmode="numeric" id="${id}" min="1" max="9999" value="${esc(val)}" placeholder="e.g. 1998">`;
    case 'money': return `<input type="text" inputmode="decimal" id="${id}" value="${esc(val === '' ? '' : String(val))}" placeholder="0">`;
    case 'date': return `<input type="date" id="${id}" value="${esc(val)}">`;
    case 'link': return `<input type="url" id="${id}" value="${esc(val)}" placeholder="https://…" autocapitalize="off">`;
    case 'long': return `<textarea id="${id}">${esc(val)}</textarea>`;
    case 'yesno': return `<div class="chips yn" data-yn="${id}"><button type="button" class="chip ${val === true ? 'on' : ''}" data-ynv="1">Yes</button><button type="button" class="chip ${val === false ? 'on' : ''}" data-ynv="0">No</button></div>`;
    case 'choice': { const opts = (f.options || []).slice(); if(val !== '' && !opts.includes(val)) opts.push(val);
      return `<select class="sel" id="${id}"><option value="">–</option>${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` }
    default: return `<input type="text" id="${id}" value="${esc(val)}" maxlength="200" list="dl_${f.id}"><datalist id="dl_${f.id}"></datalist>` } }
function readField(f){ const el = document.getElementById('fv_' + f.id);
  if(f.type === 'yesno'){ const on = document.querySelector(`[data-yn="fv_${f.id}"] .chip.on`); return on ? on.dataset.ynv === '1' : null }
  if(!el) return null; const s = el.value.trim(); if(!s) return null;
  if(f.type === 'number'){ const n = parseFloat(s.replace(',', '.')); return isNaN(n) ? null : n }
  if(f.type === 'year'){ const n = parseInt(s); return isNaN(n) ? null : n }
  if(f.type === 'money') return parseMoney(s);
  return s }
/* o: {group, blobs (new photos), code, name, img} for a new item */
function editItem(it, cid, o){ o = o || {}; const c = CO[it ? it.coll : cid], x = it ? JSON.parse(JSON.stringify(it)) : {id:uid(), coll:c.id, name:o.name || '', count:1, v:{}, tags:[], pics:[], code:o.code || '', img:o.img || '', added:Date.now()};
  const fs = fieldsOf(c), old = (c.fields || []).filter(f => f.gone && x.v && x.v[f.id] !== '' && x.v[f.id] != null);
  if(!it && o.brand){ const bf = fs.find(f => /^(brand|maker|merk)$/i.test(f.name) && f.type === 'text'); if(bf) x.v[bf.id] = o.brand }
  let pics = (x.pics || []).slice(); const newBlobs = (o.blobs || []).slice(), removed = [];
  const draft = () => { const t = {}; for(const f of fs.concat(old)) t[f.id] = readField(f); return t };
  const drawPhs = async () => { const el = $('#ei_phs'); if(!el) return;
    el.innerHTML = pics.map((p, i) => `<div class="p ${i === 0 ? 'first' : ''}"><img data-src="t:${esc(p)}" alt=""><button data-rmp="${i}" aria-label="Remove">✕</button></div>`).join('')
      + newBlobs.map((b, i) => `<div class="p ${!pics.length && i === 0 ? 'first' : ''}"><img data-blob="${i}" alt=""><button data-rmb="${i}" aria-label="Remove">✕</button></div>`).join('')
      + (x.img ? `<div class="p ${!pics.length && !newBlobs.length ? 'first' : ''}"><img src="${esc(x.img)}" alt="" onerror="this.parentNode.remove()"><button data-rmimg="1" aria-label="Remove">✕</button></div>` : '')
      + `<button class="add" id="ei_addp"><span style="font-size:20px">+</span>Photo</button>`;
    for(const im of el.querySelectorAll('img[data-src]')) picUrl(im.dataset.src).then(u => { if(u) im.src = u });
    for(const im of el.querySelectorAll('img[data-blob]')){ const u = URL.createObjectURL(newBlobs[+im.dataset.blob]); im.src = u; im.onload = () => URL.revokeObjectURL(u) }
    $('#ei_addp').onclick = () => photoSource(bl => { newBlobs.push(...bl); drawPhs() }) };
  sheet(`<h3>${it ? 'Edit' : 'New in ' + esc(c.name)}</h3>
    <div class="phs" id="ei_phs"></div>
    <div class="field"><label>Name</label><input type="text" id="ei_name" value="${esc(x.name)}" maxlength="160" placeholder="What is it?"></div>
    ${fs.map(f => `<div class="field"><label>${esc(f.name)}</label>${fieldInput(f, x.v[f.id])}</div>`).join('')}
    ${c.prices ? `<div class="row2"><div class="field"><label>Paid (each)</label><input type="text" inputmode="decimal" id="ei_paid" value="${esc(x.paid == null ? '' : x.paid)}" placeholder="${esc(money(0))}"></div><div class="field"><label>Worth now (each)</label><input type="text" inputmode="decimal" id="ei_worth" value="${esc(x.worth == null ? '' : x.worth)}" placeholder="${esc(money(0))}"></div></div>` : ''}
    <div class="row2"><div class="field"><label>How many</label><input type="number" id="ei_count" min="1" value="${esc(cnt(x))}"></div><div class="field"><label>Barcode</label><div style="display:flex;gap:6px"><input type="text" id="ei_code" value="${esc(x.code || '')}" inputmode="numeric" autocapitalize="off"><button class="ib" id="ei_scan" aria-label="Scan the barcode" style="height:42px">${icon('box', 20)}</button></div></div></div>
    <div class="field"><label>Tags (with commas between them)</label><input type="text" id="ei_tags" value="${esc((x.tags || []).join(', '))}" list="dl_tags" placeholder="e.g. favourite, to sell"><datalist id="dl_tags">${[...new Set(ITEMS.flatMap(y => y.tags || []))].sort(coll.compare).map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
    <div class="field"><label>Notes</label><textarea id="ei_notes">${esc(x.notes || '')}</textarea></div>
    ${old.length ? `<div class="sec">No longer in the template (kept)</div>${old.map(f => `<div class="field"><label>${esc(f.name)}</label>${fieldInput(f, x.v[f.id])}</div>`).join('')}` : ''}
    <p class="muted small" style="margin:2px 0 8px">The fields come from the template of ${esc(c.name)}. <span class="lnk" id="ei_tpl">Change the template</span></p>
    <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" style="flex:1" id="ei_no">Cancel</button><button class="btn primary" style="flex:2" id="ei_save">${it ? 'Save' : 'Add'}</button></div>`, true);
  /* suggestions for text fields: what you typed before in this field */
  for(const f of fs.filter(f => f.type === 'text')){ const dl = document.getElementById('dl_' + f.id); if(dl) dl.innerHTML = [...new Set(inColl(c.id).map(y => (y.v || {})[f.id]).filter(Boolean))].sort(coll.compare).slice(0, 200).map(v => `<option value="${esc(v)}">`).join('') }
  drawPhs();
  const sh = $('.sheet');
  sh.addEventListener('click', e => { const yn = e.target.closest('[data-ynv]'); if(yn){ const box = yn.parentNode, was = yn.classList.contains('on'); box.querySelectorAll('.chip').forEach(b => b.classList.remove('on')); if(!was) yn.classList.add('on'); return }
    const rp = e.target.closest('[data-rmp]'), rb = e.target.closest('[data-rmb]'), ri = e.target.closest('[data-rmimg]');
    if(rp){ removed.push(pics.splice(+rp.dataset.rmp, 1)[0]); drawPhs() } if(rb){ newBlobs.splice(+rb.dataset.rmb, 1); drawPhs() } if(ri){ x.img = ''; drawPhs() } });
  $('#ei_scan').onclick = () => openCam({mode:'barcode', only:'barcode', title:'Scan the barcode', onCode:code => { $('#ei_code').value = code; toast('Barcode ' + code) }});
  $('#ei_no').onclick = () => closeSheet();
  $('#ei_tpl').onclick = () => { if(confirm('Leave this item without saving and change the template?')) editTemplate(c) };
  if(!it && !x.name) setTimeout(() => { const n = $('#ei_name'); if(n && !newBlobs.length) n.focus() }, 80);
  $('#ei_save').onclick = async () => { const name = $('#ei_name').value.trim(); if(!name){ toast('Type a name'); $('#ei_name').focus(); return }
    const b = $('#ei_save'); b.disabled = true; b.textContent = 'Saving…';
    try{ x.name = name; x.v = Object.assign(x.v || {}, draft()); for(const k of Object.keys(x.v)) if(x.v[k] == null) delete x.v[k];
      if(c.prices){ x.paid = parseMoney($('#ei_paid').value); x.worth = parseMoney($('#ei_worth').value) }
      x.count = Math.max(1, parseInt($('#ei_count').value) || 1); x.code = $('#ei_code').value.trim(); x.notes = $('#ei_notes').value.trim();
      x.tags = [...new Set($('#ei_tags').value.split(',').map(t => t.trim()).filter(Boolean))];
      for(const bl of newBlobs) pics.push(await addPhoto(bl));
      for(const p of removed) await delPhoto(p);
      x.pics = pics; const target = IT[x.id] || x; Object.assign(target, x); await saveItem(target);
      if(!it && o.group){ const g = groupByKey(c.id, o.group); if(g && !inGroupByItself(target, g)){ grOf(c.id).put([target.id], g); regroup() } }
      closeSheet(); draw(); toast(it ? 'Saved' : `“${name}” added`, 3000, it ? null : {label:'Open', run:() => go({v:'item', id:target.id})}) }
    catch(e){ LE('items', 'save failed', e); b.disabled = false; b.textContent = it ? 'Save' : 'Add'; toast(e && e.name === 'QuotaExceededError' ? 'The phone is too full for these photos' : (e.message || String(e)), 5000) } } }
const inGroupByItself = (it, g) => { const now = groupOfItem(it); return now && now.key === g.key };
/* where a photo comes from: the camera, or pictures already on the phone. Opened from inside the item editor, the editor waits
   (taken off the screen, with everything typed in it) and comes back afterwards. */
function restoreSheet(node){ $('#sheets').innerHTML = ''; $('#sheets').appendChild(node) }
function photoSource(done){ const node = $('#scrim'); if(node) node.remove();
  const back = () => { if(node) restoreSheet(node); else closeSheet() };
  sheet(`<h3>Add a photo</h3><div class="mlist"><button class="btn primary" id="ps_cam">Take a photo</button><button class="btn" id="ps_pick">Pick from the phone</button><button class="btn" id="ps_x">Cancel</button></div>`, true);
  $('#ps_x').onclick = back; $('#scrim').onclick = e => { if(e.target.id === 'scrim') back() };
  $('#ps_cam').onclick = () => { $('#sheets').innerHTML = ''; openCam({mode:'photo', only:'photo', title:'Take photos', onPhotos:bl => { back(); done(bl) }, onClose:back}) };
  $('#ps_pick').onclick = async () => { const fs = await pickPictures(true); back(); if(fs.length) done(fs) } }

/* =====================================================================================================================
   THE TEMPLATE EDITOR – a new collection, or changing one (owner, 20 Oct 2026: "they make 1 template themselves that gets used
   when they add of that specific item"). Every item always has name, photos, notes, tags, how many and a barcode; the template adds the rest.
   ===================================================================================================================== */
let T = null;
function editTemplate(c){ T = c ? JSON.parse(JSON.stringify(c)) : null; T ? drawTemplate() : drawStarters() }
function drawStarters(){ sheet(`<h3>New collection</h3><p class="muted small" style="margin:-4px 0 10px">Pick a starting point – it fills in the fields, and you can change everything after.</p>
    <div class="starters">${STARTERS.map(s => `<button data-st="${s.k}">${icon(s.icon, 24)}<span><b>${esc(s.name)}</b><span>${esc(s.hint)}</span></span></button>`).join('')}</div>
    <button class="btn" style="width:100%;margin-top:12px" onclick="closeSheet()">Cancel</button>`, true);
  $('.sheet').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if(!b) return; const s = STARTERS.find(x => x.k === b.dataset.st), fs = s.f();
    T = {id:uid(), name:s.k === 'blank' ? '' : s.name.replace(/ \(.*\)$/, ''), icon:s.icon, shape:s.shape, fields:fs, prices:true, online:false, camera:s.camera, groupBy:(fs.find(f => f.name === s.by) || {}).id || '', added:Date.now(), order:COLLS.length, isNew:true};
    drawTemplate() }) }
function drawTemplate(){ const t = T, live = t.fields.filter(f => !f.gone), gone = t.fields.filter(f => f.gone), n = t.isNew ? 0 : inColl(t.id).length;
  const byOpts = live.filter(f => /^(text|choice|year|yesno|number)$/.test(f.type));
  sheet(`<h3>${t.isNew ? 'New collection' : 'Template of ' + esc(CO[t.id].name)}</h3>
    <div class="field"><label>Name of the collection</label><input type="text" id="tp_name" value="${esc(t.name)}" maxlength="50" placeholder="e.g. Coins"></div>
    <div class="field"><label>Icon</label><div class="icons">${Object.keys(ICONS).map(k => `<button type="button" class="${t.icon === k ? 'on' : ''}" data-ic="${k}" aria-label="${k}">${icon(k, 22)}</button>`).join('')}</div></div>
    <div class="sec">Fields of every item</div>
    <div class="frow fixed"><div class="fn"><b>Name, photos, how many, barcode, tags, notes</b><span>always there</span></div></div>
    ${live.map((f, i) => `<div class="frow" data-fi="${esc(f.id)}"><div class="fn"><b>${esc(f.name)}</b><span>${esc(typeName(f.type))}${f.type === 'choice' ? ': ' + esc((f.options || []).join(', ')) : ''}</span></div>
      <button class="mv" data-up="${esc(f.id)}" ${i ? '' : 'disabled'} aria-label="Up">▲</button><button class="mv" data-dn="${esc(f.id)}" ${i < live.length - 1 ? '' : 'disabled'} aria-label="Down">▼</button></div>`).join('')}
    <button class="btn" id="tp_add" style="width:100%">+ Add a field</button>
    ${gone.length ? `<div class="sec">Removed fields (their data is kept)</div>${gone.map(f => `<div class="frow"><div class="fn"><b>${esc(f.name)}</b><span>${esc(typeName(f.type))}</span></div><button class="btn sm" data-back="${esc(f.id)}">Put back</button></div>`).join('')}` : ''}
    <div class="sec">Prices</div>
    <div class="opt"><label for="tp_prices">Track prices<br><span class="muted small">What you paid and what it is worth now; the collection shows its total value.</span></label><input type="checkbox" id="tp_prices" ${t.prices ? 'checked' : ''}></div>
    <div class="opt off"><label>Check prices online<br><span class="muted small">Your own price website fills in “worth now” by itself – comes in a later update.</span></label><input type="checkbox" disabled></div>
    <div class="sec">Camera starts in</div>
    <div class="chips" id="tp_cam"><button class="chip ${t.camera !== 'barcode' ? 'on' : ''}" data-cam="photo">Photo</button><button class="chip ${t.camera === 'barcode' ? 'on' : ''}" data-cam="barcode">Barcode</button><button class="chip" disabled>Text (later)</button><button class="chip" disabled>Recognise (later)</button></div>
    <div class="sec">Tiles</div>
    <div class="field"><label>Items with the same … make one tile by themselves</label><select class="sel" id="tp_by"><option value="">– nothing, only my own groups –</option>${byOpts.map(f => `<option value="${esc(f.id)}" ${t.groupBy === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Tile shape</label><div class="chips" id="tp_shape">${SHAPES.map(([k, tt]) => `<button class="chip ${t.shape === k || !t.shape && k === 'square' ? 'on' : ''}" data-shape="${k}">${tt}</button>`).join('')}</div></div>
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" style="flex:1" id="tp_no">Cancel</button><button class="btn primary" style="flex:2" id="tp_save">${t.isNew ? 'Make the collection' : 'Save the template'}</button></div>
    ${!t.isNew ? `<button class="btn danger" id="tp_del" style="width:100%;margin-top:10px">Remove this collection${n ? ' and its ' + plural(n, 'item') : ''}</button>` : ''}`, true);
  const sh = $('.sheet'), keepName = () => { t.name = $('#tp_name').value };
  sh.addEventListener('click', e => { const el = e.target.closest('[data-ic],[data-fi],[data-up],[data-dn],[data-back],[data-cam],[data-shape]'); if(!el) return; keepName();
    if(el.dataset.ic){ t.icon = el.dataset.ic; sh.querySelectorAll('[data-ic]').forEach(b => b.classList.toggle('on', b === el)); return }
    if(el.dataset.cam){ t.camera = el.dataset.cam; sh.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b === el)); return }
    if(el.dataset.shape){ t.shape = el.dataset.shape; sh.querySelectorAll('[data-shape]').forEach(b => b.classList.toggle('on', b === el)); return }
    const mv = (id, d) => { const live2 = t.fields.filter(f => !f.gone), i = live2.findIndex(f => f.id === id), j = i + d; if(j < 0 || j >= live2.length) return; const a = t.fields.indexOf(live2[i]), b = t.fields.indexOf(live2[j]); [t.fields[a], t.fields[b]] = [t.fields[b], t.fields[a]]; t.prices = $('#tp_prices').checked; t.groupBy = $('#tp_by').value; drawTemplate() };
    if(el.dataset.up) return mv(el.dataset.up, -1); if(el.dataset.dn) return mv(el.dataset.dn, 1);
    t.prices = $('#tp_prices').checked; t.groupBy = $('#tp_by').value;
    if(el.dataset.back){ fieldById(t, el.dataset.back).gone = false; return drawTemplate() }
    if(el.dataset.fi) return editField(fieldById(t, el.dataset.fi)) });
  $('#tp_add').onclick = () => { keepName(); t.prices = $('#tp_prices').checked; t.groupBy = $('#tp_by').value; editField(null) };
  $('#tp_no').onclick = () => { T = null; closeSheet() };
  if($('#tp_del')) $('#tp_del').onclick = () => removeColl(CO[t.id]);
  $('#tp_save').onclick = async () => { keepName(); const name = t.name.trim(); if(!name){ toast('Give the collection a name'); $('#tp_name').focus(); return }
    if(COLLS.some(c => c.id !== t.id && norm(c.name) === norm(name))){ toast('You already have a collection with that name'); return }
    const fresh = t.isNew; t.name = name; t.prices = $('#tp_prices').checked; t.groupBy = $('#tp_by').value; delete t.isNew;
    const c = CO[t.id] || t; Object.assign(c, t); await saveColl(c); delete GRS[c.id]; T = null; closeSheet();
    if(fresh){ go({v:'coll', coll:c.id}); toast(`“${name}” made – add your first item`) } else { draw(); toast('Template saved') } } }
function editField(f){ const t = T, isNew = !f, x = f ? Object.assign({}, f, {options:(f.options || []).slice()}) : F('', 'text');
  const used = !isNew && !t.isNew && inColl(t.id).some(it => it.v && it.v[x.id] != null && it.v[x.id] !== '');
  const draw2 = () => { sheet(`<h3>${isNew ? 'New field' : 'Field'}</h3>
      <div class="field"><label>Name</label><input type="text" id="fe_name" value="${esc(x.name)}" maxlength="40" placeholder="e.g. Country, Year, Condition"></div>
      <div class="field"><label>Kind</label><div class="chips">${TYPES.map(([k, tt]) => `<button class="chip ${x.type === k ? 'on' : ''}" data-ty="${k}">${tt}</button>`).join('')}</div></div>
      ${x.type === 'choice' ? `<div class="field"><label>The choices (one on each line)</label><textarea id="fe_opts" placeholder="Mint\nGood\nWorn">${esc((x.options || []).join('\n'))}</textarea></div>` : ''}
      ${used ? '<p class="muted small">Items already have something in this field. Changing the kind keeps what they have.</p>' : ''}
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" id="fe_no">Back</button><button class="btn primary" style="flex:2" id="fe_ok">${isNew ? 'Add the field' : 'Done'}</button></div>
      ${!isNew ? `<button class="btn danger" id="fe_del" style="width:100%;margin-top:10px">Remove this field</button>${used ? '<p class="muted small" style="margin:6px 0 0">What items have in it is kept (hidden), so you can put the field back later.</p>' : ''}` : ''}`, true);
    setTimeout(() => { const n = $('#fe_name'); if(n && isNew && !x.name) n.focus() }, 60);
    const keep = () => { x.name = $('#fe_name').value.trim(); if($('#fe_opts')) x.options = $('#fe_opts').value.split('\n').map(s => s.trim()).filter(Boolean) };
    $('.sheet').addEventListener('click', e => { const b = e.target.closest('[data-ty]'); if(!b) return; keep(); x.type = b.dataset.ty; draw2() });
    $('#fe_no').onclick = () => drawTemplate();
    $('#fe_ok').onclick = () => { keep(); if(!x.name){ toast('Give the field a name'); return }
      if(t.fields.some(y => y.id !== x.id && !y.gone && norm(y.name) === norm(x.name))){ toast('There is already a field with that name'); return }
      if(x.type === 'choice' && !x.options.length){ toast('Type at least one choice'); return }
      if(isNew) t.fields.push(x); else Object.assign(f, x); drawTemplate() };
    if($('#fe_del')) $('#fe_del').onclick = () => { if(used) f.gone = true; else t.fields = t.fields.filter(y => y !== f); if(t.groupBy === f.id) t.groupBy = ''; drawTemplate() } };
  draw2() }
async function removeColl(c){ const its = inColl(c.id);
  if(!confirm(`Remove the collection “${c.name}”${its.length ? ` and its ${plural(its.length, 'item')} with their photos` : ''}?\n\nThis cannot be undone.`)) return;
  for(const it of its){ for(const p of it.pics || []) await delPhoto(p); await dbDel('items', it.id) }
  await dbDel('colls', c.id); ITEMS = ITEMS.filter(x => x.coll !== c.id); COLLS = COLLS.filter(x => x.id !== c.id);
  try{ for(const k of Object.keys(localStorage)) if(k.startsWith('nvCollect.g.' + c.id + '.')) localStorage.removeItem(k) }catch(e){}
  delete GRS[c.id]; rebuild(); T = null; closeSheet(); V = [{v:'home'}]; draw(); toast(`“${c.name}” removed`) }

/* =====================================================================================================================
   THE CAMERA – one screen with a mode picker (owner, 20 Oct 2026): Photo and Barcode now; Text and Recognise come later.
   Barcodes: the browser's own reader (BarcodeDetector) when it has one, otherwise in the Android app Google's ML Kit (NvOcr.barcodes).
   ===================================================================================================================== */
let CAM = null;
const CODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
let DETECTOR = undefined;
async function detector(){ if(DETECTOR !== undefined) return DETECTOR; DETECTOR = null;
  try{ if('BarcodeDetector' in window){ const have = await BarcodeDetector.getSupportedFormats(); const f = CODE_FORMATS.filter(x => have.includes(x)); if(f.length) DETECTOR = new BarcodeDetector({formats:f}) } }catch(e){ DETECTOR = null }
  return DETECTOR }
const canNative = () => !!(OCR && OCR.barcodes);
async function openCam(o){ closeCam(true); const only = o.only;
  const el = document.createElement('div'); el.id = 'cam'; document.body.appendChild(el);
  CAM = {o, mode:o.mode || 'photo', shots:[], stream:null, busy:false, loop:0, done:false};
  el.innerHTML = `<video playsinline muted autoplay></video><div class="frame" hidden></div><div class="line" hidden></div>
    <div class="ctop"><button class="cx" id="cm_x" aria-label="Close">✕</button><b id="cm_t">${esc(o.title || 'Camera')}</b></div>
    <div class="cbot"><div class="msg" id="cm_msg"></div><div class="shots" id="cm_shots"></div>
      <div class="crow"><button class="btn sm" id="cm_pick">From the phone</button><button class="shut" id="cm_shut" aria-label="Take the photo"></button><button class="btn sm" id="cm_done" hidden>Done</button><button class="btn sm" id="cm_type" hidden>Type the number</button></div>
      ${only ? '' : `<div class="modes"><button data-mode="photo">Photo</button><button data-mode="barcode">Barcode</button><button disabled title="Comes later">Text</button><button disabled title="Comes later">Recognise</button></div>`}</div>`;
  $('#cm_x').onclick = () => closeCam();
  el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#cm_shut').onclick = snap; $('#cm_done').onclick = finishPhotos;
  $('#cm_pick').onclick = async () => { const fs = await pickPictures(CAM && CAM.mode === 'photo'); if(!fs.length || !CAM) return;
    if(CAM.mode === 'photo'){ CAM.shots.push(...fs); finishPhotos(); return }
    msg('Looking for a barcode in the picture…'); const code = await codeFromBlob(fs[0]); if(code) return gotCode(code); msg('No barcode found in that picture. Try again closer, or type the number.') };
  $('#cm_type').onclick = async () => { const n = await askOver('Type the barcode number', 'The digits under the stripes'); if(n && CAM) gotCode(n.replace(/\s+/g, '')) };
  try{ CAM.stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}});
    const v = el.querySelector('video'); v.srcObject = CAM.stream; await v.play().catch(() => {}) }
  catch(e){ LE('camera', 'no camera', String(e && e.message || e)); CAM.nocam = true }
  setMode(CAM.mode) }
function msg(t){ const m = $('#cm_msg'); if(m) m.textContent = t }
async function setMode(m){ if(!CAM) return; CAM.mode = m; clearTimeout(CAM.loop);
  document.querySelectorAll('#cam [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  const bar = m === 'barcode'; $('#cam .frame').hidden = !bar; $('#cam .line').hidden = !bar;
  $('#cm_shut').hidden = bar || CAM.nocam; $('#cm_done').hidden = bar || !CAM.shots.length; $('#cm_type').hidden = !bar;
  if(CAM.nocam){ msg(bar ? 'No camera here. Pick a photo of the barcode, or type the number.' : 'No camera here (or no permission). Pick photos from the phone instead.'); return }
  if(!bar){ msg(CAM.shots.length ? 'Take more, or tap Done.' : 'Front, back, the box, details – take as many as you like.'); return }
  const d = await detector();
  if(!d && !canNative()){ msg('This browser cannot read barcodes. Type the number, or use the Android app.'); return }
  msg('Hold the barcode inside the frame.'); scanLoop() }
function frameBlob(q){ const v = document.querySelector('#cam video'); if(!v || !v.videoWidth) return Promise.resolve(null);
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  return new Promise(ok => c.toBlob(b => ok(b), 'image/jpeg', q || .92)) }
async function scanLoop(){ if(!CAM || CAM.mode !== 'barcode' || CAM.done) return; const v = document.querySelector('#cam video'), d = await detector();
  try{ if(v && v.videoWidth){
      if(d){ const r = await d.detect(v); const x = r.find(y => y.rawValue); if(x) return gotCode(x.rawValue) }
      else if(canNative()){ const b = await frameBlob(.85), code = b && await nativeCode(b); if(code) return gotCode(code) } } }
  catch(e){ LE('camera', 'barcode read', String(e && e.message || e)) }
  if(CAM) CAM.loop = setTimeout(scanLoop, d ? 250 : 700) }
const toB64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(blob) });
async function nativeCode(blob){ try{ const r = await OCR.barcodes({image:await toB64(blob)}); const x = (r.codes || []).find(y => y.value); return x ? x.value : null }catch(e){ return null } }
async function codeFromBlob(blob){ const d = await detector();
  if(d){ try{ const bm = await createImageBitmap(blob); const r = await d.detect(bm); const x = r.find(y => y.rawValue); if(x) return x.rawValue }catch(e){} }
  if(canNative()){ const small = await shrink(blob, 1600, .9); return nativeCode(small) } return null }
function gotCode(code){ if(!CAM || CAM.done) return; CAM.done = true; try{ navigator.vibrate && navigator.vibrate(60) }catch(e){}
  const fr = $('#cam .frame'); if(fr) fr.classList.add('ok'); msg('Barcode ' + code);
  const o = CAM.o, shots = CAM.shots.slice(); setTimeout(() => { closeCam(true); o.onCode && o.onCode(code, shots) }, 350) }
async function snap(){ if(!CAM || CAM.busy) return; CAM.busy = true; const b = await frameBlob(.92); CAM.busy = false; if(!b){ msg('The camera is not ready yet'); return }
  CAM.shots.push(b); try{ navigator.vibrate && navigator.vibrate(25) }catch(e){}
  const u = URL.createObjectURL(b); $('#cm_shots').insertAdjacentHTML('beforeend', `<img src="${u}" alt="">`); setMode('photo') }
function finishPhotos(){ if(!CAM) return; const o = CAM.o, shots = CAM.shots.slice(); closeCam(true); if(shots.length && o.onPhotos) o.onPhotos(shots); else if(o.onClose) o.onClose() }
function closeCam(quiet){ if(!CAM){ const el0 = $('#cam'); if(el0) el0.remove(); return } const o = CAM.o; clearTimeout(CAM.loop); CAM.done = true;
  try{ CAM.stream && CAM.stream.getTracks().forEach(t => t.stop()) }catch(e){}
  document.querySelectorAll('#cam_shots img, #cm_shots img').forEach(i => URL.revokeObjectURL(i.src));
  const el = $('#cam'); if(el) el.remove(); CAM = null; if(!quiet && o.onClose) o.onClose() }
/* a question on top of the camera */
const askOver = (title, ph) => new Promise(ok => { const d = document.createElement('div'); d.className = 'scrim'; d.style.zIndex = 70;
  d.innerHTML = `<div class="sheet"><h3>${esc(title)}</h3><input type="text" inputmode="numeric" placeholder="${esc(ph || '')}" maxlength="40"><div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1">Cancel</button><button class="btn primary" style="flex:2">OK</button></div></div>`;
  document.body.appendChild(d); const i = d.querySelector('input'), [no, yes] = d.querySelectorAll('button'); setTimeout(() => i.focus(), 50);
  const done = v => { d.remove(); ok(v) }; no.onclick = () => done(null); yes.onclick = () => done(i.value.trim()); i.onkeydown = e => { if(e.key === 'Enter') done(i.value.trim()) } });

/* =====================================================================================================================
   MENUS: an item, a group
   ===================================================================================================================== */
function itemMenu(it){ const G = grOf(it.coll), pin = G.isPinned('it:' + it.id);
  sheet(`<h3>${esc(it.name)}</h3><div class="mlist">
    <button class="btn" id="img">Put in a group…</button><button class="btn" id="imp">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    ${COLLS.length > 1 ? '<button class="btn" id="imc">Move to another collection…</button>' : ''}<button class="btn" id="imd">Make a copy</button>
    <button class="btn danger" id="imx">Remove</button></div>`);
  $('#img').onclick = () => groupPicker(it);
  $('#imp').onclick = () => { G.togglePin(['it:' + it.id], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#imc')) $('#imc').onclick = () => collPicker([it.id]);
  $('#imd').onclick = async () => { const x = JSON.parse(JSON.stringify(it)); x.id = uid(); x.added = Date.now(); x.pics = []; x.name = it.name + ' (copy)';
    for(const p of it.pics || []){ const r = await dbGet('pics', 'p:' + p).catch(() => null); if(r) x.pics.push(await addPhoto(r.blob)) }
    await saveItem(x); closeSheet(); go({v:'item', id:x.id}); toast('Copy made') };
  $('#imx').onclick = () => removeItems([it.id]) }
async function removeItems(ids){ const its = ids.map(id => IT[id]).filter(Boolean); if(!its.length) return;
  if(!confirm(`Remove ${its.length === 1 ? '“' + its[0].name + '”' : plural(its.length, 'item')} and ${its.length === 1 ? 'its' : 'their'} photos?`)) return;
  for(const it of its){ for(const p of it.pics || []) await delPhoto(p); await dbDel('items', it.id) }
  const s = new Set(ids); ITEMS = ITEMS.filter(x => !s.has(x.id)); rebuild(); closeSheet(); selEnd(true);
  if(cur().v === 'item' && s.has(cur().id)) V.pop(); draw(); toast(plural(its.length, 'item') + ' removed') }
/* another collection has other fields: values go to a field with the same name; the rest stays with the item (hidden) */
function collPicker(ids){ const from = IT[ids[0]] && IT[ids[0]].coll;
  sheet(`<h3>Move ${ids.length === 1 ? '“' + esc(IT[ids[0]].name) + '”' : plural(ids.length, 'item')} to…</h3>${COLLS.filter(c => c.id !== from).map(c => `<div class="li" data-to="${esc(c.id)}"><span style="width:34px;display:flex;justify-content:center;color:var(--accent)">${icon(c.icon, 22)}</span><div class="n"><div>${esc(c.name)}</div><div class="s">${plural(inColl(c.id).length, 'item')}</div></div></div>`).join('')}
    <p class="muted small" style="margin:10px 0 0">Fields with the same name are carried over. Anything else is kept with the item, hidden.</p>`);
  $('.sheet').addEventListener('click', async e => { const r = e.target.closest('[data-to]'); if(!r) return; const to = CO[r.dataset.to];
    for(const id of ids){ const it = IT[id]; if(!it) continue; const fc = CO[it.coll], nv = {};
      for(const [k, val] of Object.entries(it.v || {})){ const f = fieldById(fc, k), g = f && (to.fields || []).find(y => norm(y.name) === norm(f.name));
        if(g){ nv[g.id] = val; if(g.gone) g.gone = false } else { if(f && !(to.fields || []).some(y => y.id === f.id)) to.fields.push(Object.assign({}, f, {gone:true})); nv[k] = val } }
      it.v = nv; it.coll = to.id; await dbPut('items', it) }
    await dbPut('colls', to); rebuild(); closeSheet(); selEnd(true); toast(`${plural(ids.length, 'item')} moved to ${to.name}`); draw() }) }

/* ---------- groups: menus (the same words as Music, Bookcase and Boardgames) ---------- */
function newGroup(cid){ ask('New group', 'Name, like Euro coins or Star Wars', '', 'Make the group').then(n => { if(!n) return; const G = grOf(cid); G.own(n); regroup();
  const g = groupByKey(cid, 'c:' + norm(n)); S.grouped[cid] = true; saveS(); draw(); toast(`Group “${n}”: ${plural(g ? g.all.length : 0, 'item')}. Items with this word in their name go in by themselves.`, 4500) }) }
function groupMenu(cid, g){ const G = grOf(cid), pin = G.isPinned('gr:' + g.key);
  sheet(`<h3>${esc(g.name)}</h3><div class="mlist"><button class="btn primary" id="gadd">Add items…</button><button class="btn" id="gsub">New group inside</button><button class="btn" id="gmove">Put this group inside another group…</button><button class="btn" id="gren">Rename</button><button class="btn" id="gcov">Choose the tile cover</button><button class="btn" id="gpin">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>${g.kind === 'own' ? '<button class="btn danger" id="gdel">Remove this group</button>' : ''}</div>
    ${g.kind === 'own' ? '<p class="muted small" style="margin:10px 0 0">Removing the group keeps the items - they show as their own tiles again.</p>' : ''}`);
  $('#gadd').onclick = () => addItemsSheet(cid, g); $('#gsub').onclick = () => newSubGroup(cid, g); $('#gmove').onclick = () => moveGroupSheet(cid, g); $('#gren').onclick = () => renameGroup(cid, g); $('#gcov').onclick = () => groupCoverSheet(cid, g);
  $('#gpin').onclick = () => { G.togglePin(['gr:' + g.key], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#gdel')) $('#gdel').onclick = () => { closeSheet(); if(cur().v === 'group' && cur().key === g.key) V.pop(); grChange(cid, () => G.remove(g), `Group “${g.name}” removed`); draw() } }
function addItemsSheet(cid, g){ const G = grOf(cid), gs = groupsOf(cid).groups, where = {}; for(const x of gs) for(const it of x.items) where[it.id] = x;
  const pick = new Set(); let q = '';
  const list = () => { const nq = norm(q); return inColl(cid).filter(x => !g.items.includes(x) && (!nq || (searchHay(x) + ' ' + norm((where[x.id] || {}).name)).includes(nq))).sort((x, y) => coll.compare(x.name, y.name)) };
  const upd = () => { $('#aago').textContent = pick.size ? `Add ${plural(pick.size, 'item')}` : 'Add'; $('#aago').disabled = !pick.size };
  const drawL = () => { const l = list(), el = $('#aalist'); if(!el) return;
    el.innerHTML = l.slice(0, 400).map(x => `<label class="li" style="cursor:pointer"><input type="checkbox" class="cb" data-aa="${esc(x.id)}" ${pick.has(x.id) ? 'checked' : ''}><span class="th">${coverHTML(x)}</span><div class="n"><div>${esc(x.name)}</div><div class="s">${esc(subLine(x))}${where[x.id] ? ' · in ' + esc(G.path(where[x.id], gs)) : ''}</div></div></label>`).join('') + (l.length > 400 ? `<p class="muted small">… and ${l.length - 400} more - type to narrow it down</p>` : '') + (!l.length ? '<p class="muted small">Nothing found.</p>' : '');
    lazyCovers(el); upd() };
  sheet(`<h3>Add items to “${esc(g.name)}”</h3><input type="search" id="aaq" placeholder="Search name, field or group"><div id="aalist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="aago" disabled>Add</button></div>`, true);
  $('#aaq').oninput = e => { q = e.target.value; drawL() };
  $('#aalist').onchange = e => { const c = e.target.closest('[data-aa]'); if(!c) return; c.checked ? pick.add(c.dataset.aa) : pick.delete(c.dataset.aa); upd() };
  $('#aago').onclick = () => { grChange(cid, () => G.put([...pick], g), `${plural(pick.size, 'item')} added to “${g.name}”`); closeSheet(); draw() };
  drawL() }
function newSubGroup(cid, g){ ask(`New group inside “${esc(g.name)}”`, 'Name', '', 'Make it').then(n => { if(!n) return; const G = grOf(cid), k = G.own(n); if(k.key === g.key) return; G.setParent(k.key, g.key); regroup(); draw(); toast(`“${n}” made inside “${g.name}” - open it and add items`) }) }
function moveGroupSheet(cid, g){ const G = grOf(cid), gs = groupsOf(cid).groups, bad = new Set(G.inside(g, gs).concat(g.key)), opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Put “${esc(g.name)}” inside…</h3>${g.parent ? '<button class="btn" id="mgtop" style="width:100%;margin-bottom:8px">Back on the main page</button>' : ''}
    ${opts.map(x => `<div class="li" data-mg="${esc(x.key)}"><span class="th">${groupCoverHTML(cid, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'item')}</div></div></div>`).join('') || '<p class="muted small">No other groups yet. Make one with “+ Group” in the collection.</p>'}`);
  lazyCovers($('.sheet'));
  if($('#mgtop')) $('#mgtop').onclick = () => { grChange(cid, () => G.setParent(g.key, null), `“${g.name}” is back on the main page`); closeSheet(); draw() };
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-mg]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.mg); grChange(cid, () => G.setParent(g.key, t.key), `“${g.name}” is now inside “${t.name}”`); closeSheet(); draw() }) }
function groupPicker(it){ const cid = it.coll, G = grOf(cid), now = groupOfItem(it), all = groupsOf(cid).groups, gs = all.filter(g => !now || g.key !== now.key).sort((x, y) => coll.compare(x.name, y.name)), ov = G.read('items');
  sheet(`<h3>Put “${esc(it.name)}” in a group</h3>${now ? `<p class="muted small" style="margin:0 0 8px">Now in “${esc(now.name)}”.</p>` : ''}
    <div style="display:flex;gap:8px"><input type="text" id="gpn" placeholder="New group name" maxlength="60"><button class="btn primary" id="gpmake">Make</button></div>
    <div style="margin-top:10px">${gs.map(g => `<div class="li" data-gp="${esc(g.key)}"><span class="th">${groupCoverHTML(cid, g)}</span><div class="n"><div>${esc(G.path(g, all))}</div><div class="s">${plural(g.items.length, 'item')}</div></div></div>`).join('') || '<p class="muted small">No group tiles yet.</p>'}</div>
    <div class="mlist" style="margin-top:10px">${now ? '<button class="btn" id="gpout">Take it out of its group (its own tile)</button>' : ''}${ov[it.id] ? '<button class="btn" id="gpauto">Back to automatic</button>' : ''}</div>`);
  lazyCovers($('.sheet'));
  const done = (fn, m) => { grChange(cid, fn, m); closeSheet(); draw() };
  $('#gpmake').onclick = () => { const n = $('#gpn').value.trim(); if(!n) return; done(() => G.put([it.id], G.own(n)), `Put in “${n}”`) };
  if($('#gpout')) $('#gpout').onclick = () => done(() => G.put([it.id], 'none'), 'Now on its own tile');
  if($('#gpauto')) $('#gpauto').onclick = () => done(() => G.put([it.id]), 'Back to automatic');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-gp]'); if(!r) return; const g = groupByKey(cid, r.dataset.gp); if(g) done(() => G.put([it.id], g), `Put in “${g.name}”`) }) }
function renameGroup(cid, g){ const G = grOf(cid);
  ask(`Rename “${esc(g.name)}”`, 'Name', g.name, 'Rename').then(n => { if(n == null || n === g.name) return; let err = ''; G.change(() => { err = G.rename(g, n) });
    if(err){ G.undo(); toast(err, 4000); return } regroup();
    const v = cur(); if(v.v === 'group' && v.key === g.key && g.kind === 'own') v.key = 'c:' + norm(n);
    draw(); G.undoToast(`Renamed to “${n}”`, () => { regroup(); draw() }) }) }
function groupCoverSheet(cid, g){ const G = grOf(cid), c = G.cover(g.key), wc = g.all.filter(hasPic);
  const save = v => { G.setCover(g.key, v); delete RNDCOV[g.key]; closeSheet(); draw(); toast('Tile cover saved') };
  sheet(`<h3>Tile cover for “${esc(g.name)}”</h3>
    <div class="chips"><button class="chip ${!c.t ? 'on' : ''}" data-gc="">The first one</button><button class="chip ${c.t === 'random' ? 'on' : ''}" data-gc="random">A random one</button><button class="chip ${c.t === 'cycle' ? 'on' : ''}" data-gc="cycle">Changing (one after another)</button><button class="chip ${c.t === 'pic' ? 'on' : ''}" data-gc="pic">A picture from the phone</button></div>
    <div class="sec">Or pick one</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${wc.map(x => `<div class="bk" data-gca="${esc(x.id)}" style="${c.t === 'item' && c.al === x.id ? 'outline:2px solid var(--accent);border-radius:12px' : ''}">${coverHTML(x)}<div class="a">${esc(x.name)}</div></div>`).join('') || '<p class="muted small">No photos in this group yet.</p>'}</div>`);
  lazyCovers($('.sheet'));
  $('.sheet').onclick = async e => { const bt = e.target.closest('[data-gc]'), it = e.target.closest('[data-gca]');
    if(it) return save({t:'item', al:it.dataset.gca}); if(!bt) return; const t = bt.dataset.gc;
    if(t === 'pic'){ const fs = await pickPictures(false); if(!fs.length) return; await setPic('grp:' + cid + ':' + g.key, await shrink(fs[0], 600, .85)); return save({t:'pic'}) }
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
function selParts(){ const cid = cur().coll, gs = groupsOf(cid).groups, its = [...SEL].filter(x => x.startsWith('it:')).map(x => x.slice(3)), grs = [...SEL].filter(x => x.startsWith('gr:')).map(x => x.slice(3));
  const items = [...new Set(its.concat(...grs.map(k => (gs.find(g => g.key === k) || {all:[]}).all.map(x => x.id))))];
  return {cid, gs, its, grs, items} }
function selMoveSheet(){ const {cid, gs, its, grs} = selParts(), G = grOf(cid), bad = new Set(grs.flatMap(k => { const g = gs.find(x => x.key === k); return g ? G.inside(g, gs).concat(k) : [k] }));
  const opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Move ${plural(SEL.size, 'tile')} to…</h3><div style="display:flex;gap:8px"><input type="text" id="smn" placeholder="New group name" maxlength="60"><button class="btn primary" id="smmake">Make</button></div>
    <button class="btn" id="smtop" style="width:100%;margin-top:10px">The main page (own tiles)</button>
    <div style="margin-top:8px">${opts.map(x => `<div class="li" data-sm="${esc(x.key)}"><span class="th">${groupCoverHTML(cid, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'item')}</div></div></div>`).join('')}</div>`);
  lazyCovers($('.sheet'));
  const move = t => { if(t){ G.put(its, t); for(const k of grs) G.setParent(k, t.key) } else { G.put(its, 'none'); for(const k of grs) G.setParent(k, null) } };
  const doit = (t, label, first) => { const n = SEL.size; grChange(cid, () => { if(first) first(); move(t) }, `${plural(n, 'tile')} moved to ${label}`); closeSheet(); selEnd(true); draw() };
  $('#smmake').onclick = () => { const n = $('#smn').value.trim(); if(!n) return; const v = cur(); doit({key:'c:' + norm(n), name:n, kind:'own'}, `“${n}”`, () => { const g = G.own(n); if(v.v === 'group' && !bad.has(v.key)) G.setParent(g.key, v.key) }) };
  $('#smtop').onclick = () => doit(null, 'the main page');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-sm]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.sm); if(t) doit(t, `“${t.name}”`) }) }
function selTakeOut(){ const {cid, gs, its, grs} = selParts(), G = grOf(cid), here = gs.find(x => x.key === cur().key), up = here && here.parent ? gs.find(x => x.key === here.parent) : null, n = SEL.size;
  grChange(cid, () => { G.put(its, up || 'none'); for(const k of grs) G.setParent(k, up ? up.key : null) }, `${plural(n, 'tile')} taken out${up ? ' to “' + up.name + '”' : ' to the main page'}`); selEnd(true); draw() }
function selMore(){ const {items, cid} = selParts(), G = grOf(cid), ids = [...SEL], allPinned = ids.every(x => G.isPinned(x));
  sheet(`<h3>${plural(ids.length, 'tile')} · ${plural(items.length, 'item')}</h3><div class="mlist"><button class="btn" id="smpin">${allPinned ? '★ Unpin' : '★ Pin to the top'}</button>${COLLS.length > 1 ? '<button class="btn" id="smcoll">Move to another collection…</button>' : ''}<button class="btn danger" id="smdel">Remove ${plural(items.length, 'item')}</button></div>`);
  $('#smpin').onclick = () => { G.togglePin(ids, !allPinned); closeSheet(); selEnd(true); draw() };
  if($('#smcoll')) $('#smcoll').onclick = () => collPicker(items); $('#smdel').onclick = () => removeItems(items) }

/* =====================================================================================================================
   SETTINGS
   ===================================================================================================================== */
function appSettings(){ const np = ITEMS.reduce((a, x) => a + (x.pics || []).length, 0);
  sheet(`<h3>Collectables</h3>
    <div class="field"><label>Money in</label><select class="sel" id="as_cur">${CURS.map(([k, t]) => `<option value="${k}" ${S.cur === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="sec">On this phone</div>
    <p class="small" style="margin:0 0 8px">${plural(COLLS.length, 'collection')} · ${plural(ITEMS.length, 'item')} · ${plural(np, 'photo')}. Everything stays on this phone. The automatic backup (☰ › Back up this app now) keeps your collections, templates and items – <b>not the photos</b>.</p>
    <div class="sec">Coming later</div>
    <p class="muted small" style="margin:0">Prices checked online from your own website, reading text from a box or label, recognising items from a photo, and your collectables on the PC.</p>`);
  $('#as_cur').onchange = e => { S.cur = e.target.value; saveS(); draw(); toast('Saved') } }
function collSettings(cid){ const c = CO[cid], G = grOf(cid);
  sheet(`<h3>${esc(c.name)}</h3><div class="mlist"><button class="btn primary" id="cs_tpl">Change the template</button></div>
    <div class="sec">Your groups</div><div class="mlist"><button class="btn" id="cs_save">Save my groups</button><button class="btn" id="cs_load">Load from a file</button></div>
    <div class="sec">The app</div><div class="mlist"><button class="btn" id="cs_app">Collectables settings</button></div>`);
  $('#cs_tpl').onclick = () => editTemplate(c); $('#cs_app').onclick = appSettings;
  $('#cs_save').onclick = async () => { try{ const r = await G.saveBackup(); if(r !== 'cancelled') toast('Groups saved') }catch(e){ toast(e.message || String(e), 4000) } };
  $('#cs_load').onclick = async () => { const t = await G.pickFile(); if(!t) return; const ck = G.checkBackup(t); if(!ck.ok){ toast(ck.msg, 5000); return }
    if(!confirm(ck.msg + '\n\nPut these groups back? (Undo is possible right after.)')) return; G.applyBackup(ck.d); regroup(); closeSheet(); draw(); G.undoToast('Groups loaded', () => { regroup(); draw() }) } }
$('#setbtn').onclick = () => { const v = cur(), cid = v.coll || (IT[v.id] || {}).coll; if(cid && CO[cid]) collSettings(cid); else appSettings() };
$('#addbtn').onclick = () => addSheet();

/* ---------- Android back button: camera → sheet → one screen back → The Nightvault ---------- */
if(window.Capacitor) try{ const A = (Capacitor.Plugins && Capacitor.Plugins.App) || Capacitor.registerPlugin('App');
  A.addListener('backButton', () => { if(window.NVMENU && NVMENU.close()) return; if($('#zoom')){ $('#zoom').remove(); return } if(document.querySelector('body > .scrim')){ document.querySelector('body > .scrim').remove(); return }
    if(CAM){ closeCam(); return } if(sheetOpen()){ closeSheet(); return }
    if(back()) return; if(fromHub()){ location.href = '../hub/index.html'; return } A.minimizeApp && A.minimizeApp() }) }catch(e){}
document.addEventListener('visibilitychange', () => { if(document.hidden){ window.NVHERE && NVHERE.save('nvCollect.here', {V}) } });
addEventListener('pagehide', () => { window.NVHERE && NVHERE.save('nvCollect.here', {V}); if(CAM) closeCam(true) });

/* ---------- start ---------- */
(async () => {
  try{ await openDB(); const [cs, its, keys] = await Promise.all([dbAll('colls'), dbAll('items'), dbKeys('pics')]); COLLS = cs; ITEMS = its; for(const k of keys) PICS.add(k) }
  catch(e){ $('#body').innerHTML = `<p class="muted">Collectables could not open its storage: ${esc(e.message || e)}</p>`; return }
  rebuild();
  const h = window.NVHERE && NVHERE.take('nvCollect.here'); if(h && Array.isArray(h.V) && h.V.length) V = h.V;
  try{ draw() }catch(e){ V = [{v:'home'}]; draw() }
  L('start', `${COLLS.length} collections, ${ITEMS.length} items`);
  try{ window.NVBACKUP && NVBACKUP.offer && NVBACKUP.offer('collectables') }catch(e){}
  window.NVCOLLECT = {get colls(){ return COLLS }, get items(){ return ITEMS }, draw, rebuild, lookupCode, editTemplate, editItem, openCam, codeFound, totals};   // for testing
})();
