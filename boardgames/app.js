/* Nightvault Boardgames (test) – the app. Plan: plans/boardgames.md in nightvault-src.
   Parts: basics · storage · BoardGameGeek data · items and shelves · plays · groups (shared ../hub/nvgroups.js) · covers · tiles ·
   screens (shelves, shelf, group, game, plays) · logging a play · sending plays to BGG (Android: NvBgg) · menus · select · settings · start */
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
const dateTxt = d => { if(!d) return ''; const [y, m, dd] = d.split('-').map(Number); if(!m) return d; const now = new Date(); return `${dd} ${MONTHS[m - 1].slice(0, 3)}${y !== now.getFullYear() ? ' ' + y : ''}` };
const agoTxt = d => { if(!d) return ''; const days = Math.round((Date.parse(today()) - Date.parse(d)) / 864e5); return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? days + ' days ago' : dateTxt(d) };
let toastT = 0; function toast(m, ms){ const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 2600) }
window.toast = toast;
const L = (a, t, d) => { try{ window.NVLOG && NVLOG.log(a, t, d) }catch(e){} }, LE = (a, t, d) => { try{ window.NVLOG && NVLOG.error(a, t, d) }catch(e){} };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
const S = Object.assign({sort:{}, grouped:{}, filter:{}, pfilter:'all'}, lsGet('nvBoard.settings', {}));
const saveS = () => lsSet('nvBoard.settings', S);
const fromHub = () => { try{ return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
try{ if(new URLSearchParams(location.search).get('nv') === 'hub') sessionStorage.setItem('nvHub', '1'); if(fromHub()) $('#hubback').hidden = false }catch(e){}
const IC_DOTS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const PINB = '<span class="pinb">★</span>';
const REMOTE = 'https://brokeuh.github.io/nightvault-pocket/';
const DATA_URL = (NATIVE ? REMOTE : '../') + 'data/boardgames/collection.json';
let NvBgg = null; if(NATIVE) try{ NvBgg = Capacitor.registerPlugin('NvBgg') }catch(e){ NvBgg = null }

/* ---------- storage: IndexedDB 'nvBoard' (works offline) ----------
   items : games and pieces added by hand {id:'own:…', shelf, name, type:'game'|'expansion', base, year, players:[a,b], time:[a,b], age, notes, forGame, count, paint, added}
   plays : plays logged here {id, game:<item id>, date, players:[{n, u, s, w}], sent:'wait'|'yes'|'fail'|'here'|'web', err, bggPlay, sentAt, at}
   pics  : {id, blob}  ('it:<item id>' own picture of an item, 'grp:<shelf>:<group key>' a group's own picture)
   kv    : {id:'bgg', data} the last BoardGameGeek file (so the shelf works offline)
   files : (v2) a game's own files – rulebook, errata, player aids, fan-made … {id, game:<item id> | 'grp:<shelf>:<group key>', kind, name, fname, size, type, added}
   blobs : (v2) {id, blob} the file itself (apart, so the automatic backup keeps the list but not the big files) */
let DB = null;
function openDB(){ return new Promise((ok, no) => { const r = indexedDB.open('nvBoard', 2);
  r.onupgradeneeded = () => { const d = r.result; for(const s of ['items', 'plays', 'pics', 'kv', 'files', 'blobs']) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}) };
  r.onblocked = () => toast('Close the other Boardgames tab, then reload', 6000);
  r.onsuccess = () => { DB = r.result; DB.onversionchange = () => { DB.close(); toast('Boardgames was updated in another tab - reload this page', 6000) }; ok(DB) }; r.onerror = () => no(r.error) }) }
function tx(store, mode, fn){ return new Promise((ok, no) => { const t = DB.transaction(store, mode), st = t.objectStore(store); let res; const q = fn(st); if(q) q.onsuccess = () => res = q.result; t.oncomplete = () => ok(res); t.onerror = t.onabort = () => no(t.error || new Error('Storage error')) }) }
const dbGet = (s, id) => tx(s, 'readonly', st => st.get(id));
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbKeys = s => tx(s, 'readonly', st => st.getAllKeys());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));
const mb = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

/* ---------- shelves ---------- */
const SHELF_ICON = {
  games:'<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>',
  wish:'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  minis:'<path d="M8 20h8M9 20l1-6-3-3 2-5 3 2 2-3 2 3-2 3 1 3-2 6"/>',
  plays:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'};
const SHELVES = [
  {id:'games', name:'Board games', c:['#1f3216', '#1a2233'], s:'#9be07a', one:'game', many:'games'},
  {id:'wish', name:'Wishlist', c:['#3a3216', '#2a1f36'], s:'#f1dc6b', one:'game', many:'games'},
  {id:'minis', name:'Miniatures & terrain', c:['#16323a', '#18203a'], s:'#7fe3ff', one:'piece', many:'pieces'}];
const shelfOf = id => SHELVES.find(s => s.id === id) || SHELVES[0];
const shelfIcon = (id, size, color) => `<svg width="${size || 26}" height="${size || 26}" viewBox="0 0 24 24" fill="none" stroke="${color || (SHELVES.find(s => s.id === id) || {s:'#9be07a'}).s}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SHELF_ICON[id] || SHELF_ICON.games}</svg>`;
const words = sh => { const s = shelfOf(sh); return [s.one, s.many] };
const shelfOpt = sh => (lsGet('nvBoard.shelfopt', {})[sh] || {});
const setShelfOpt = (sh, patch) => { const o = lsGet('nvBoard.shelfopt', {}); o[sh] = Object.assign({}, o[sh] || {}, patch); lsSet('nvBoard.shelfopt', o) };
const PAINT = ['', 'Unpainted', 'Primed', 'Painting', 'Painted', 'Done (based)'];
const painted = it => it.paint === 'Painted' || it.paint === 'Done (based)';

/* ---------- BoardGameGeek: the daily file made by the workflow "Update board games" (data/boardgames/collection.json) ---------- */
let BGG = null, BGGERR = '', BGGSTATUS = null;
/* data/boardgames/status.json: written by the job – why there are no (new) games, e.g. the secrets are missing or BGG refused the token */
async function loadStatus(){ try{ const r = await fetch(DATA_URL.replace('collection.json', 'status.json') + '?h=' + Date.now(), {cache:'no-store'}); BGGSTATUS = r.ok ? await r.json() : null }catch(e){ BGGSTATUS = null } }
const statusLine = () => BGGSTATUS && !BGGSTATUS.ok ? BGGSTATUS.error || 'The last BGG update did not work' : '';
async function loadBgg(fresh){
  try{ const r = await fetch(DATA_URL + '?h=' + (fresh ? Date.now() : new Date().toISOString().slice(0, 13)), {cache:fresh ? 'no-store' : 'no-cache'});
    if(r.status === 404){ BGGERR = 'none'; return false }
    if(!r.ok) throw new Error('BoardGameGeek list not available (' + r.status + ')');
    const d = await r.json(); if(d.format !== 'nightvault-bgg') throw new Error('Unknown file');
    BGGERR = ''; const changed = !BGG || BGG.fetched !== d.fetched; BGG = d; if(changed) await dbPut('kv', {id:'bgg', data:d}).catch(() => {}); L('bgg', `${d.games.length} games, ${d.plays.length} plays, fetched ${d.fetched}`); return changed }
  catch(e){ BGGERR = BGG ? '' : (e.message || String(e)); LE('bgg', 'could not load the BGG file', e); return false } }

/* ---------- items: BGG games + things added by hand, each on a shelf ---------- */
let OWN = [], ITEMS = [], IT = {};
function rebuild(){
  const mv = lsGet('nvBoard.shelfOf', {}); ITEMS = [];
  for(const g of (BGG && BGG.games) || []){ const st = g.status || {};
    if(!st.own && !st.wishlist && !st.preordered && !st.wantToBuy && !st.want) continue;
    ITEMS.push(Object.assign({}, g, {id:'bgg:' + g.id, bgg:g.id, src:'bgg', shelf:mv['bgg:' + g.id] || (st.own ? 'games' : 'wish'), added:g.modified ? Date.parse(g.modified.replace(' ', 'T')) || 0 : 0})) }
  for(const o of OWN) ITEMS.push(Object.assign({src:'own', type:'game'}, o));
  IT = Object.fromEntries(ITEMS.map(x => [x.id, x]));
  /* expansions: the base game they belong to (on the same shelf), so they go into its tile */
  for(const it of ITEMS){ it.baseId = null; it.expIds = [] }
  for(const it of ITEMS){ if(it.type !== 'expansion') continue;
    const cands = it.src === 'bgg' ? (it.expands || []).map(x => 'bgg:' + x) : [it.base].filter(Boolean);
    const b = cands.map(x => IT[x]).find(x => x && x.shelf === it.shelf && x.type !== 'expansion'); if(b){ it.baseId = b.id; b.expIds.push(it.id) } }
  playStats(); regroup() }
const inShelf = sh => ITEMS.filter(x => x.shelf === sh);

/* ---------- plays ---------- */
let PLAYS = [], ST = {};
/* plays per game: BGG's count + plays logged here that BGG doesn't know yet (not sent, or sent after the BGG file was made) */
function playStats(){ const at = BGG ? Date.parse(BGG.fetched) || 0 : 0; ST = {};
  for(const it of ITEMS) ST[it.id] = {n:it.plays || 0, last:it.lastPlayed || ''};
  for(const p of PLAYS){ const s = ST[p.game]; if(!s) continue; if(!(p.sent === 'yes' && p.sentAt && p.sentAt < at)) s.n++; if(p.date > s.last) s.last = p.date } }
/* every play: the ones logged here + the ones on BGG (a play sent from here shows once) */
function allPlays(){ const mine = new Set(PLAYS.filter(p => p.bggPlay).map(p => String(p.bggPlay)));
  const b = ((BGG && BGG.plays) || []).filter(p => !mine.has(String(p.id))).map(p => ({id:'b' + p.id, bggPlay:p.id, game:'bgg:' + p.game, gname:p.name, date:p.date, players:p.players || [], qty:p.qty, note:p.note, sent:'bgg'}));
  return PLAYS.concat(b).sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.at || 0) - (x.at || 0)) }
const gameName = p => (IT[p.game] || {}).name || p.gname || 'A game';
/* you: your name in plays and your BGG user name (filled in from your BGG plays when not set) */
function me(){ const o = lsGet('nvBoard.me', {}), u = o.u || (BGG && BGG.user) || ''; let n = o.n || '';
  if(!n && u) for(const p of (BGG && BGG.plays) || []){ const x = (p.players || []).find(y => y.u && y.u.toLowerCase() === u.toLowerCase() && y.n); if(x){ n = x.n; break } }
  return {n, u} }
const people = () => lsGet('nvBoard.people', []);
/* people you play with, most played with first */
function knownPeople(){ const c = {}, m = norm(me().n);
  for(const p of allPlays()) for(const x of p.players || []){ const n = (x.n || x.u || '').trim(); if(n && norm(n) !== m) c[n] = (c[n] || 0) + 1 }
  for(const p of people()) if(p.n && norm(p.n) !== m) c[p.n] = c[p.n] || 0.5;
  return Object.keys(c).sort((a, b) => c[b] - c[a] || coll.compare(a, b)) }
const userOf = name => { const m = me(); if(m.n && norm(m.n) === norm(name)) return m.u; const p = people().find(x => norm(x.n) === norm(name)); if(p) return p.u || '';
  for(const pl of allPlays()) for(const x of pl.players || []) if(x.u && norm(x.n) === norm(name)) return x.u; return '' };
const SENTTXT = {yes:['ok', 'On BGG'], bgg:['ok', 'BGG'], wait:['wait', 'Not sent yet'], fail:['bad', 'Not sent'], here:['', 'Only here'], web:['', 'This browser']};
const badge = p => { const [c, t] = SENTTXT[p.sent] || ['', '']; return t ? `<span class="badge ${c}">${t}</span>` : '' };
const playersTxt = p => (p.players || []).map(x => `${x.w ? '<span class="win">★ </span>' : ''}${esc(x.n || x.u)}${x.s !== '' && x.s != null ? ' ' + esc(x.s) : ''}`).join(' · ');

/* ---------- groups: the shared way of every Nightvault app (../hub/nvgroups.js, plans/shared-groups.md) – one engine per shelf ----------
   automatic group: a game + its expansions (Board games, Wishlist); pieces for the same game or army (Miniatures & terrain) */
const GRS = {};
function grOf(sh){ if(GRS[sh]) return GRS[sh]; const s = shelfOf(sh);
  return GRS[sh] = NVGROUPS.make({prefix:'nvBoard.' + sh, app:'boardgames-' + sh, title:'Boardgames · ' + s.name, itemsKey:'itemGroup', norm, key:x => x.id,
    hay:x => [x.name, x.forGame].filter(Boolean).join(' '), kinds:{game:'Game + expansions', for:'Game / army'},
    auto:x => { if(shelfOpt(sh).noAuto) return null;
      if(sh === 'minis') return x.forGame ? {key:'f:' + norm(x.forGame), name:x.forGame, kind:'for'} : null;
      const b = x.baseId ? IT[x.baseId] : x.expIds && x.expIds.length ? x : null; return b ? {key:'b:' + b.id, name:b.name, kind:'game'} : null },
    onRekey:async (from, to) => { const id = 'grp:' + sh + ':' + from; if(!PICS.has(id)) return; const c = await dbGet('pics', id).catch(() => null); if(c){ await setPic('grp:' + sh + ':' + to, c.blob); draw() } }}) }
let GROUPCACHE = {};
const regroup = () => { GROUPCACHE = {} };
const groupsOf = sh => GROUPCACHE[sh] || (GROUPCACHE[sh] = grOf(sh).build(inShelf(sh)));
const grChange = (sh, fn, msg) => { const G = grOf(sh); G.change(fn); regroup(); G.undoToast(msg, () => { regroup(); selEnd(true); draw() }) };
const groupByKey = (sh, k) => groupsOf(sh).groups.find(g => g.key === k) || null;
const groupOfItem = it => groupsOf(it.shelf).groups.find(g => g.items.includes(it)) || null;
/* inside a group: the base game first, then its expansions (oldest first) */
const baseFirst = (a, b) => (a.type === 'expansion') - (b.type === 'expansion') || (a.year || 9999) - (b.year || 9999) || coll.compare(a.name, b.name);
const headOf = g => (g.all || g.items).slice().sort(baseFirst)[0] || {};

/* ---------- pictures: BGG box art (from BGG's picture server), or your own picture (kept in the app) ---------- */
const PICS = new Set(), PICURL = {};
async function picUrl(id){ if(!PICS.has(id)) return null; if(PICURL[id]) return PICURL[id]; const c = await dbGet('pics', id).catch(() => null); if(!c){ PICS.delete(id); return null } return PICURL[id] = URL.createObjectURL(c.blob) }
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
async function fillCov(el){ const u = await picUrl(el.dataset.cov); if(!u) return; el.querySelectorAll('img').forEach(i => i.remove()); el.insertAdjacentHTML('afterbegin', `<img class="b" src="${u}" alt=""><img class="f" src="${u}" alt="">`) }
function lazyCovers(root){ (root || document).querySelectorAll('[data-cov]').forEach(el => { if(!PICS.has(el.dataset.cov)) return; covIO ? covIO.observe(el) : fillCov(el) }) }
function phHTML(it, label){ const h = hue(it.name || label || ''), sh = it.shelf || 'games';
  return `<div class="ph" style="--c1:hsl(${h} 40% 26%);--c2:hsl(${(h + 50) % 360} 35% 13%)">${shelfIcon(sh, 22, '#fff')}${esc(label || it.name || '')}<span>${esc(it.year || it.forGame || '')}</span></div>` }
function coverHTML(it, cls, extra, big){ const own = PICS.has('it:' + it.id), url = !own && (big ? it.image || it.thumb : it.thumb || it.image);
  const im = url ? `<img class="b" src="${esc(url)}" alt="" loading="lazy" onerror="imgFail(this)"><img class="f" src="${esc(url)}" alt="" loading="lazy" onerror="imgFail(this)" onload="imgOk(this)">` : '';
  return `<div class="cv ${cls || ''}"${own ? ` data-cov="it:${esc(it.id)}"` : ''}>${phHTML(it)}${im}${extra || ''}</div>` }
const RNDCOV = {};
function groupCoverHTML(sh, g){ const G = grOf(sh), c = G.cover(g.key), all = (g.all || g.items).slice().sort(baseFirst), wc = all.filter(x => x.thumb || x.image || PICS.has('it:' + x.id));
  if(c.t === 'pic' && PICS.has('grp:' + sh + ':' + g.key)) return `<div class="cv" data-cov="grp:${esc(sh)}:${esc(g.key)}">${phHTML({name:g.name, shelf:sh})}</div>`;
  let it = null; if(c.t === 'item') it = all.find(x => x.id === c.al);
  if((c.t === 'random' || c.t === 'cycle') && wc.length){ it = wc.find(x => x.id === RNDCOV[g.key]) || wc[Math.floor(Math.random() * wc.length)]; RNDCOV[g.key] = it.id }
  it = it || wc[0] || all[0]; return it ? coverHTML(it) : `<div class="cv">${phHTML({name:g.name, shelf:sh})}</div>` }
/* "changing" tile covers: a different box every few seconds */
setInterval(() => { if(document.hidden) return; let any = false;
  for(const sh of SHELVES.map(s => s.id)){ const G = grOf(sh); for(const g of (GROUPCACHE[sh] || {groups:[]}).groups) if(G.cover(g.key).t === 'cycle'){ delete RNDCOV[g.key]; any = true } }
  const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if(any && !typing && !sheetOpen() && !SEL && (cur().v === 'shelf' || cur().v === 'group')) { const y = scrollY; draw(); scrollTo(0, y) } }, 6000);

/* ---------- tiles ---------- */
const rng = (a, unit) => { if(!a) return ''; const [x, y] = a; if(!x && !y) return ''; return (x && y && x !== y ? `${x}–${y}` : String(x || y)) + (unit || '') };
const subLine = it => it.shelf === 'minis' ? [it.forGame, it.paint, it.count > 1 ? '×' + it.count : ''].filter(Boolean).join(' · ')
  : [rng(it.players, ' pl'), rng(it.time, ' min')].filter(Boolean).join(' · ') || (it.year ? String(it.year) : '');
function itemTile(it){ const s = ST[it.id] || {n:0}, G = grOf(it.shelf), st = it.status || {};
  const tag = it.shelf === 'wish' ? (st.preordered ? 'Pre-ordered' : st.wishPriority ? 'Wish ' + st.wishPriority : '') : it.type === 'expansion' ? 'Expansion' : '';
  return `<div class="bk" data-item="${esc(it.id)}">${coverHTML(it, '', (G.isPinned('it:' + it.id) ? PINB : '') + (tag ? `<span class="tag${it.type === 'expansion' && it.shelf !== 'wish' ? ' x' : ''}">${esc(tag)}</span>` : '') + (s.n ? `<span class="np">${s.n}×</span>` : ''))}
    <div class="t">${esc(it.name)}</div><div class="a">${esc(subLine(it) || ' ')}</div></div>` }
function groupTile(sh, g){ const all = g.all || g.items, k = (g.kids || []).length, G = grOf(sh), [one, many] = words(sh), n = all.reduce((a, x) => a + ((ST[x.id] || {}).n || 0), 0);
  const lbl = g.kind === 'game' ? (all.length - 1 ? '+' + (all.length - 1) + ' exp.' : 'game') : all.length ? plural(all.length, one, many) : 'empty';
  return `<div class="bk stack" data-grp="${esc(g.key)}">${groupCoverHTML(sh, g)}${G.isPinned('gr:' + g.key) ? PINB : ''}<span class="cdl">${k ? plural(k, 'group') + ' · ' : ''}${lbl}</span>
    <div class="t">${esc(g.name)}</div><div class="a">${esc(g.kind === 'game' ? subLine(headOf(g)) || G.label(g) : G.label(g))}${n ? ' · ' + n + '× played' : ''}</div></div>` }

/* ---------- screens: a stack of views ---------- */
let V = [{v:'shelves'}];
const cur = () => V[V.length - 1];
function go(v){ selEnd(true); V.push(v); draw(); scrollTo(0, 0) }
function back(){ if(SEL){ selEnd(); return true } if(V.length > 1){ V.pop(); draw(); return true } return false }
$('#vback').onclick = () => back();
const Q = {};
/* sort menus: the same small menu on every page, each page remembers its own choice */
const SORTS = {
  games:[['name', 'Name'], ['last', 'Last played'], ['plays', 'Most played'], ['rating', 'BGG rating'], ['mine', 'My rating'], ['weight', 'Complexity'], ['time', 'Play time'], ['year', 'Year'], ['rank', 'BGG rank'], ['added', 'Recently added']],
  wish:[['prio', 'Wish priority'], ['name', 'Name'], ['rating', 'BGG rating'], ['weight', 'Complexity'], ['year', 'Year'], ['added', 'Recently added']],
  minis:[['name', 'Name'], ['for', 'Game / army'], ['added', 'Recently added']],
  inside:[['base', 'Game first'], ['name', 'Name'], ['year', 'Year'], ['last', 'Last played'], ['plays', 'Most played'], ['added', 'Recently added']]};
const sortOf = (page, key) => S.sort[key || page] || SORTS[page][0][0];
const sortSel = (page, key) => `<select data-sort="${page}" data-skey="${esc(key || page)}" aria-label="Sort">${SORTS[page].map(([k, t]) => `<option value="${k}" ${sortOf(page, key) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const allOf = x => x.items ? (x.all || x.items) : [x];
function sortVal(x, k){ const h = x.items ? headOf(x) : x, all = allOf(x);
  switch(k){ case 'last': return all.map(i => (ST[i.id] || {}).last || '').sort().pop() || '';
    case 'plays': return all.reduce((a, i) => a + ((ST[i.id] || {}).n || 0), 0);
    case 'added': return Math.max(0, ...all.map(i => i.added || 0));
    case 'rating': return h.rating || 0; case 'mine': return h.myRating || 0; case 'weight': return h.weight || 0; case 'year': return h.year || 0;
    case 'time': return h.time ? h.time[1] || h.time[0] || 9999 : 9999; case 'rank': return h.rank || 1e9;
    case 'prio': return (h.status || {}).preordered ? 0 : (h.status || {}).wishPriority || 9;
    case 'for': return norm(h.forGame) || 'zzz'; default: return 0 } }
const nameOf = x => norm(x.items ? x.name : x.name);
function sortTiles(list, k){ const asc = k === 'time' || k === 'rank' || k === 'prio' || k === 'for';
  if(k === 'base') return list.slice().sort((a, b) => !a.items && !b.items ? baseFirst(a, b) : (!!b.items - !!a.items) || coll.compare(nameOf(a), nameOf(b)));
  if(k === 'name' || !k) return list.slice().sort((a, b) => coll.compare(nameOf(a), nameOf(b)));
  return list.slice().sort((a, b) => { const va = sortVal(a, k), vb = sortVal(b, k); const c = typeof va === 'string' ? (asc ? va.localeCompare(vb) : vb.localeCompare(va)) : asc ? va - vb : vb - va; return c || coll.compare(nameOf(a), nameOf(b)) }) }
const FILTERS = {games:[['all', 'All'], ['played', 'Played'], ['never', 'Never played'], ['exp', 'Expansions']], minis:[['all', 'All'], ['todo', 'Not painted yet'], ['done', 'Painted']], wish:[]};
const passFilter = (it, f) => f === 'played' ? (ST[it.id] || {}).n > 0 : f === 'never' ? !((ST[it.id] || {}).n > 0) : f === 'exp' ? it.type === 'expansion' : f === 'todo' ? !painted(it) : f === 'done' ? painted(it) : true;

function draw(){
  const v = cur(), body = $('#body'); $('#vback').hidden = V.length < 2;
  $('#addbtn').hidden = !(v.v === 'shelf' || v.v === 'group' || v.v === 'plays'); $('#addlbl').textContent = v.v === 'plays' ? 'Log a play' : 'Add';
  $('#hubback').hidden = !(fromHub() && V.length < 2);
  if(v.v === 'shelves') return drawShelves(body);
  if(v.v === 'shelf') return drawShelf(body, v);
  if(v.v === 'group') return drawGroup(body, v);
  if(v.v === 'game') return drawGame(body, v.id);
  if(v.v === 'plays') return drawPlays(body) }

function bggLine(){ if(!BGG) return '';
  const d = new Date(BGG.fetched); return `<div class="store">From BoardGameGeek (${esc(BGG.user)}) · updated ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${NvBgg ? '' : ' · plays are sent to BGG by the Android app'}</div>` }
function setupNote(){ if(BGG) return BGGSTATUS && !BGGSTATUS.ok && BGGSTATUS.kind !== 'nosecrets' ? `<div class="note"><b>The last BoardGameGeek update did not work.</b><br>${esc(statusLine())}<br><span class="muted small">Showing your games from ${esc(new Date(BGG.fetched).toLocaleDateString())}.</span></div>` : '';
  if(BGGSTATUS && !BGGSTATUS.ok) return `<div class="note"><b>Your BoardGameGeek games are not here yet.</b><br>${esc(statusLine())}<br><span class="muted small">See Settings (top right) for what to do.</span></div>`;
  if(BGGERR === 'none') return `<div class="note"><b>Your BoardGameGeek games are not here yet.</b><br>They come in by themselves every morning, once the GitHub job “Update board games” has your BGG user name and token. See Settings (top right) for how.</div>`;
  if(BGGERR) return `<div class="note">Could not load your BoardGameGeek games: ${esc(BGGERR)}<br><span class="muted small">Showing what is saved on this device. Check the internet connection.</span></div>`;
  return '' }
function drawShelves(body){ $('#vtitle').textContent = 'Boardgames'; document.title = 'Nightvault Boardgames';
  let h = setupNote();
  const rec = []; for(const p of allPlays()){ if(IT[p.game] && !rec.includes(p.game)) rec.push(p.game); if(rec.length >= 8) break }
  if(rec.length) h += `<div class="sec" style="margin-top:4px">Recently played</div><div class="recent">${rec.map(id => { const it = IT[id]; return `<div class="bk" data-item="${esc(id)}">${coverHTML(it)}<div class="t">${esc(it.name)}</div><div class="a">${esc(agoTxt((ST[id] || {}).last))}</div></div>` }).join('')}</div>`;
  const ap = allPlays(), wait = PLAYS.filter(p => p.sent === 'wait' || p.sent === 'fail').length;
  h += '<div class="shelves">' + SHELVES.map(s => { const its = inShelf(s.id), exp = its.filter(x => x.type === 'expansion').length;
      const fan = its.filter(x => x.thumb || x.image || PICS.has('it:' + x.id)).sort((a, b) => sortVal(b, 'last').localeCompare(sortVal(a, 'last')) || (b.added || 0) - (a.added || 0)).slice(0, 3);
      return `<div class="shelf" data-shelf="${s.id}" style="background:linear-gradient(150deg,${s.c[0]},${s.c[1]})"><div class="ic">${shelfIcon(s.id)}</div><div class="fan">${fan.map(x => `<img data-fan="${esc(x.id)}" alt="" onerror="this.remove()">`).join('')}</div>
        <b>${esc(s.name)}</b><div class="s">${its.length ? plural(its.length - exp, s.one, s.many) + (exp ? ` · ${plural(exp, 'expansion')}` : '') : 'empty'}</div></div>` }).join('')
    + `<div class="shelf" data-plays="1" style="background:linear-gradient(150deg,#341a3a,#1a1b33)"><div class="ic">${shelfIcon('plays', 26, '#e0a8ff')}</div><b>Plays</b><div class="s">${ap.length ? plural(ap.length, 'play') + (wait ? ` · ${wait} not sent yet` : '') : 'log your first game night'}</div></div></div>`;
  h += bggLine();
  body.innerHTML = h; lazyCovers(body); hookGrid(null);
  body.querySelectorAll('[data-fan]').forEach(async im => { const it = IT[im.dataset.fan]; const u = PICS.has('it:' + it.id) ? await picUrl('it:' + it.id) : it.thumb || it.image; if(u) im.src = u; else im.remove() }) }

function drawShelf(body, v){ const s = shelfOf(v.shelf), all = inShelf(s.id), q = norm(Q[s.id] || ''), f = S.filter[s.id] || 'all', G = grOf(s.id), [one, many] = words(s.id);
  $('#vtitle').textContent = s.name; document.title = s.name + ' · Boardgames';
  let h = setupNote();
  if(!all.length){ body.innerHTML = h + `<div class="empty">${shelfIcon(s.id, 48)}<h2 style="margin:8px 0 4px;font-size:18px">No ${esc(s.name.toLowerCase())} yet</h2><p class="muted small" style="margin:0 0 14px">${s.id === 'minis' ? 'Add your miniatures and terrain by hand.' : s.id === 'wish' ? 'Games on your BGG wishlist show here by themselves. You can also add one by hand.' : 'Your BGG games show here by themselves every morning. You can also add one by hand.'}</p><button class="btn primary" id="emptyadd">Add by hand</button></div>`; $('#emptyadd').onclick = () => editItem(null, s.id); return }
  h += `<input type="search" id="q" placeholder="Search ${esc(s.name.toLowerCase())}" value="${esc(Q[s.id] || '')}" style="margin:2px 0 8px">`;
  if(q){ const {groups:gs} = groupsOf(s.id), where = {}; for(const g of gs) for(const x of g.items) where[x.id] = G.path(g, gs);
    const gm = gs.filter(g => norm(g.name).includes(q)).slice(0, 12), im = all.filter(x => norm([x.name, x.forGame, (x.designers || []).join(' '), x.notes].join(' ')).includes(q)).sort((a, b) => coll.compare(a.name, b.name));
    if(!gm.length && !im.length) h += '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
    if(gm.length) h += `<div class="sec">Groups</div><div class="grid">${gm.map(g => groupTile(s.id, g).replace(/<div class="a">[^<]*<\/div>/, g.parent ? `<div class="a">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : '$&')).join('')}</div>`;
    if(im.length) h += `<div class="sec">${esc(many[0].toUpperCase() + many.slice(1))}</div><div class="grid">${im.slice(0, 300).map(x => itemTile(x).replace(/<div class="a">[^<]*<\/div>/, where[x.id] ? `<div class="a">in ${esc(where[x.id])}</div>` : '$&')).join('')}</div>` }
  else { if(FILTERS[s.id].length) h += `<div class="chips">${FILTERS[s.id].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${t}</button>`).join('')}</div>`;
    const grouped = S.grouped[s.id] !== false;
    h += `<div class="mbar"><select id="grouped" aria-label="Groups"><option value="1" ${grouped ? 'selected' : ''}>Grouped</option><option value="0" ${!grouped ? 'selected' : ''}>All ${many}</option></select>${sortSel(s.id, 'shelf:' + s.id)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button><button class="btn sm" id="newgrp">+ Group</button></div>`;
    const vis = all.filter(x => passFilter(x, f)), k = sortOf(s.id, 'shelf:' + s.id), exp = vis.filter(x => x.type === 'expansion').length;
    const plays = vis.reduce((a, x) => a + ((ST[x.id] || {}).n || 0), 0);
    h += `<div class="mtot">${s.id === 'minis' ? plural(vis.length, one, many) + ` · ${vis.filter(painted).length} painted` : plural(vis.length - exp, one, many) + (exp ? ` · ${plural(exp, 'expansion')}` : '') + (plays ? ` · ${plays}× played` : '')}</div>`;
    let tiles;
    if(!grouped || f !== 'all') tiles = sortTiles(vis, k);
    else { const {groups, singles} = groupsOf(s.id); tiles = sortTiles([...groups.filter(g => !g.parent), ...singles], k) }
    tiles = G.pinFirst(tiles, x => x.items ? 'gr:' + x.key : 'it:' + x.id);
    h += `<div class="grid">${tiles.map(x => x.items ? groupTile(s.id, x) : itemTile(x)).join('')}</div>` }
  if(s.id !== 'minis') h += bggLine();
  body.innerHTML = h; lazyCovers(body);
  const qi = $('#q'); if(qi) qi.oninput = () => { Q[s.id] = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { const p = qi.selectionStart; draw(); const n = $('#q'); if(n){ n.focus(); try{ n.setSelectionRange(p, p) }catch(e){} } }, 250) };
  hookGrid(s.id) }

function drawGroup(body, v){ const G = grOf(v.shelf), g = groupByKey(v.shelf, v.key); if(!g){ V.pop(); return draw() }
  const gs = groupsOf(v.shelf).groups, all = g.all, [one, many] = words(v.shelf), head = headOf(g), n = all.reduce((a, x) => a + ((ST[x.id] || {}).n || 0), 0);
  $('#vtitle').textContent = ''; document.title = g.name + ' · Boardgames';
  let h = `<div class="alhead"><div class="stack" style="flex:none"><div class="gcv" style="width:min(32vw,140px)">${groupCoverHTML(v.shelf, g)}</div></div><div style="min-width:0;flex:1"><b>${esc(g.name)}</b>
    ${g.parent ? `<div class="lnk small" data-gotogrp="${esc(g.parent)}">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : ''}
    <div class="muted small">${esc(G.label(g))} · ${(g.kids || []).length ? plural(g.kids.length, 'group') + ' · ' : ''}${g.kind === 'game' ? `1 game + ${plural(all.length - 1, 'expansion')}` : plural(all.length, one, many)}${n ? ` · ${n}× played` : ''}</div></div></div>`;
  h += `<div class="mbar">${v.shelf !== 'minis' && all.length ? `<button class="btn primary" data-log="${esc(g.kind === 'game' ? head.id : '')}" style="flex:1">Log a play${g.kind === 'game' ? ': ' + esc(head.name) : ''}</button>` : ''}<button class="ib" id="gmenu" aria-label="More for this group">${IC_DOTS}</button></div>`;
  const key = 'grp:' + v.shelf + ':' + g.key, k = sortOf('inside', key);
  h += `<div class="mbar">${sortSel('inside', key)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button></div>`;
  const kids = sortTiles(g.kids || [], k === 'base' ? 'name' : k), items = sortTiles(g.items, k);
  h += `<div class="grid">${G.pinFirst([...kids, ...items], x => x.items ? 'gr:' + x.key : 'it:' + x.id).map(x => x.items ? groupTile(v.shelf, x) : itemTile(x)).join('')}</div>`;
  if(!all.length) h += `<p class="muted small" style="margin-top:12px">Empty. Tap ⋯ → <b>Add ${many}…</b> to put ${many} in it.</p>`;
  h += g.kind === 'game' && head.id ? filesHTML(head.id, head) : filesHTML('grp:' + v.shelf + ':' + g.key, null);
  body.innerHTML = h; lazyCovers(body); hookGrid(v.shelf); hookFiles(body); $('#gmenu').onclick = () => groupMenu(v.shelf, g) }

/* ---------- the game page ---------- */
function drawGame(body, id){ const it = IT[id]; if(!it){ V.pop(); return draw() }
  const s = ST[it.id] || {n:0}, g = groupOfItem(it), st = it.status || {}, base = it.baseId ? IT[it.baseId] : null, sh = shelfOf(it.shelf);
  $('#vtitle').textContent = ''; document.title = it.name + ' · Boardgames';
  const status = it.shelf === 'minis' ? '' : st.preordered ? 'Pre-ordered' : st.wishlist ? 'On your wishlist' + (st.wishPriority ? ` (priority ${st.wishPriority})` : '') : st.wantToBuy ? 'Want to buy' : st.want ? 'Want' : it.src === 'bgg' ? (it.shelf === 'games' ? 'In your collection' : '') : 'Added by hand';
  let h = `<div class="alhead" style="align-items:flex-start">${coverHTML(it, '', '', true)}<div style="min-width:0;flex:1"><b>${esc(it.name)}</b>
    <div class="muted small">${esc([it.year, it.type === 'expansion' ? 'Expansion' : '', it.shelf === 'minis' ? it.forGame : ''].filter(Boolean).join(' · '))}</div>
    ${base ? `<div class="lnk small" data-item="${esc(base.id)}">Expansion for ${esc(base.name)}</div>` : ''}
    ${g ? `<div class="lnk small" data-gotogrp2="1">in ${esc(G_path(it.shelf, g))}</div>` : ''}
    <div class="muted small" style="margin-top:8px">${esc(status)}${it.shelf !== 'minis' ? (status ? ' · ' : '') + (s.n ? `played ${s.n}×${s.last ? ', last ' + agoTxt(s.last) : ''}` : 'never played') : ''}</div></div></div>
    <div class="mbar">${it.shelf !== 'minis' ? `<button class="btn primary" data-log="${esc(it.id)}" style="flex:1">Log a play</button>` : `<button class="btn" id="gedit" style="flex:1">${it.src === 'own' ? 'Edit' : 'Change the picture'}</button>`}<button class="ib" id="imenu" aria-label="More for this game">${IC_DOTS}</button></div>`;
  const stats = [['Players', rng(it.players)], ['Play time', rng(it.time, ' min')], ['Age', it.age ? it.age + '+' : ''], ['Complexity', it.weight ? it.weight.toFixed(1) + ' / 5' : ''],
    ['BGG rating', it.rating ? it.rating.toFixed(1) : ''], ['BGG rank', it.rank ? '#' + it.rank : ''], ['My rating', it.myRating ? String(+it.myRating.toFixed(1)) : ''],
    ['Plays', it.shelf !== 'minis' && s.n ? String(s.n) : ''], ['Last played', s.last ? dateTxt(s.last) : ''], ['How many', it.count ? String(it.count) : ''], ['Paint', it.paint || '']].filter(x => x[1]);
  if(stats.length) h += `<div class="stats">${stats.map(([k, x]) => `<div class="stat"><small>${k}</small><b>${esc(x)}</b></div>`).join('')}</div>`;
  const exps = it.expIds.map(x => IT[x]).filter(Boolean).sort(baseFirst);
  if(exps.length) h += `<div class="sec">Expansions you have</div><div class="grid">${exps.map(itemTile).join('')}</div>`;
  h += filesHTML(it.id, it);
  const about = it.about || it.notes || '';
  if(about) h += `<div class="sec">${it.about ? 'About' : 'Notes'}</div><div class="desc clip" id="gdesc">${esc(about)}</div>${about.length > 300 ? '<button class="btn sm" id="gmore" style="margin-top:6px">More</button>' : ''}`;
  if(it.comment) h += `<div class="sec">Your note on BGG</div><div class="desc">${esc(it.comment)}</div>`;
  const facts = [['Designer', (it.designers || []).join(', ')], ['Publisher', (it.publishers || []).join(', ')], ['Categories', (it.categories || []).join(', ')], ['Mechanics', (it.mechanics || []).join(', ')],
    ['Notes', it.about && it.notes ? it.notes : ''], ['Shelf', sh.name], ['From', it.src === 'bgg' ? `<span class="lnk" data-bgg="${it.bgg}">BoardGameGeek</span>` : 'Added by hand']].filter(x => x[1]);
  h += `<div class="sec">Details</div><div class="facts">${facts.map(([k, x]) => `<span>${k}</span><span style="min-width:0;overflow-wrap:anywhere">${k === 'From' ? x : esc(x)}</span>`).join('')}</div>`;
  if(it.shelf !== 'minis'){ const ps = allPlays().filter(p => p.game === it.id || (it.expIds.includes(p.game)));
    if(ps.length) h += `<div class="sec">Plays</div>${ps.slice(0, 15).map(playLi).join('')}${ps.length > 15 ? `<button class="btn sm" data-plays="1" style="margin-top:8px">All plays</button>` : ''}` }
  body.innerHTML = h; lazyCovers(body); hookFiles(body);
  $('#imenu').onclick = () => itemMenu(it);
  if($('#gedit')) $('#gedit').onclick = () => it.src === 'own' ? editItem(it) : pictureSheet(it);
  if($('#gmore')) $('#gmore').onclick = () => { $('#gdesc').classList.remove('clip'); $('#gmore').remove() };
  body.querySelectorAll('[data-gotogrp2]').forEach(el => el.onclick = () => { if(g) go({v:'group', shelf:it.shelf, key:g.key}) }) }
const G_path = (sh, g) => grOf(sh).path(g, groupsOf(sh).groups);
const bggUrl = id => 'https://boardgamegeek.com/boardgame/' + id;
function openUrl(u){ try{ const w = window.open(u, '_blank'); if(!w) location.href = u }catch(e){ location.href = u } }

/* ---------- the plays page ---------- */
function playLi(p){ const it = IT[p.game] || {name:gameName(p), shelf:'games'};
  return `<div class="li" data-play="${esc(p.id)}"><span class="th">${coverHTML(it)}</span><div class="n"><div>${esc(gameName(p))}${p.qty > 1 ? ' ×' + p.qty : ''}</div><div class="s">${playersTxt(p) || '<span class="muted">no players</span>'}</div></div><div class="r">${esc(dateTxt(p.date))}<br>${badge(p)}</div></div>` }
function drawPlays(body){ $('#vtitle').textContent = 'Plays'; document.title = 'Plays · Boardgames';
  const f = S.pfilter || 'all', all = allPlays(), wait = all.filter(p => p.sent === 'wait' || p.sent === 'fail');
  let h = `<div class="chips"><button class="chip ${f === 'all' ? 'on' : ''}" data-pf="all">All</button><button class="chip ${f === 'wait' ? 'on' : ''}" data-pf="wait">Not sent yet${wait.length ? ' (' + wait.length + ')' : ''}</button></div>`;
  if(wait.length && NvBgg) h += `<div class="mbar"><button class="btn sm" id="sendall">Send ${plural(wait.length, 'play')} to BGG now</button></div>`;
  const list = f === 'wait' ? wait : all;
  if(!list.length) h += `<div class="empty">${shelfIcon('plays', 48, '#e0a8ff')}<h2 style="margin:8px 0 4px;font-size:18px">${f === 'wait' ? 'Everything is sent' : 'No plays yet'}</h2><p class="muted small" style="margin:0 0 14px">Tap <b>Log a play</b> after a game night: who played, the scores and who won.</p></div>`;
  let month = '';
  for(const p of list.slice(0, 500)){ const m = (p.date || '').slice(0, 7); if(m !== month){ month = m; const [y, mm] = m.split('-').map(Number); h += `<div class="sec">${mm ? MONTHS[mm - 1] + ' ' + y : 'Undated'}</div>` } h += playLi(p) }
  const wins = {}; for(const p of all) for(const x of p.players || []) if(x.w){ const n = x.n || x.u; wins[n] = (wins[n] || 0) + 1 }
  const top = Object.entries(wins).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if(top.length && f === 'all') h += `<div class="sec">Most wins</div><div class="facts">${top.map(([n, c]) => `<span>${esc(n)}</span><span>${plural(c, 'win')}</span>`).join('')}</div>`;
  body.innerHTML = h; lazyCovers(body);
  if($('#sendall')) $('#sendall').onclick = () => sendPending(true) }

/* clicks on the screens */
$('#body').addEventListener('click', e => {
  if(selSkip){ selSkip = false; return }
  const t = e.target, el = t.closest('[data-shelf],[data-item],[data-grp],[data-filter],[data-selstart],[data-gotogrp],[data-log],[data-play],[data-plays],[data-pf],[data-bgg],#newgrp');
  if(!el) return; const v = cur();
  if(SEL && el.closest('.grid') && (el.dataset.item || el.dataset.grp)){ const id = el.dataset.item ? 'it:' + el.dataset.item : 'gr:' + el.dataset.grp; SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw(); return }
  if(el.id === 'newgrp') return newGroup(v.shelf);
  if(el.dataset.shelf) return go({v:'shelf', shelf:el.dataset.shelf});
  if(el.dataset.plays) return go({v:'plays'});
  if(el.dataset.log !== undefined) return logPlay({game:el.dataset.log || null});
  if(el.dataset.play) return playSheet(el.dataset.play);
  if(el.dataset.bgg) return openUrl(bggUrl(el.dataset.bgg));
  if(el.dataset.item) return go({v:'game', id:el.dataset.item});
  if(el.dataset.grp) return go({v:'group', shelf:v.shelf, key:el.dataset.grp});
  if(el.dataset.gotogrp){ V.pop(); if(cur().v !== 'group' || cur().key !== el.dataset.gotogrp) V.push({v:'group', shelf:v.shelf, key:el.dataset.gotogrp}); return draw() }
  if(el.dataset.filter){ S.filter[v.shelf] = el.dataset.filter; saveS(); return draw() }
  if(el.dataset.pf){ S.pfilter = el.dataset.pf; saveS(); return draw() }
  if(el.dataset.selstart) return selStart() });
$('#body').addEventListener('change', e => { const t = e.target, v = cur();
  if(t.dataset.sort){ S.sort[t.dataset.skey] = t.value; saveS(); draw() }
  if(t.id === 'grouped'){ S.grouped[v.shelf] = t.value === '1'; saveS(); draw() } });
/* long-press a tile: select it (then tap more tiles) */
let SEL = null, selSkip = false;
function hookGrid(sh){ if(!sh) return; document.querySelectorAll('#body .grid').forEach(gr => {
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
   LOGGING A PLAY – date, game, players, scores, who won. Kept here, and sent to BoardGameGeek (Android app, NvBgg).
   ===================================================================================================================== */
let F = null;
function logPlay(o){ o = o || {};
  const old = o.edit ? PLAYS.find(p => p.id === o.edit) : null;
  const m = me();
  F = {edit:old ? old.id : null, game:old ? old.game : o.game || null, date:old ? old.date : today(),
    players:old ? old.players.map(x => Object.assign({}, x)) : m.n ? [{n:m.n, u:m.u, s:'', w:false}] : [{n:'', u:'', s:'', w:false}], q:''};
  drawLog() }
function drawLog(){ const it = F.game ? IT[F.game] : null;
  if(!it) return drawGamePick();
  const inUse = new Set(F.players.map(x => norm(x.n))), sugg = knownPeople().filter(n => !inUse.has(norm(n))).slice(0, 10), m = me();
  if(m.n && !inUse.has(norm(m.n))) sugg.unshift(m.n);
  const how = !it.bgg ? 'This game is not on BoardGameGeek, so the play is kept in Nightvault only.' : NvBgg ? 'Saved here and sent to BoardGameGeek right away (later, when you are offline).' : 'Kept in this browser. Plays are sent to BoardGameGeek from the Android app.';
  sheet(`<h3>${F.edit ? 'Change the play' : 'Log a play'}</h3>
    <div class="gpick">${coverHTML(it)}<div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name)}</b><span class="muted small">${esc(subLine(it))}</span></div><button class="btn sm" id="lgame">Change</button></div>
    <div class="field"><label>Date</label><input type="date" id="ldate" value="${esc(F.date)}" max="${today()}"></div>
    <div class="field"><label>Players · score · tap ★ for the winner (more than one is fine)</label><div id="lplayers">${F.players.map((x, i) => `<div class="prow"><input type="text" list="people" data-pn="${i}" value="${esc(x.n)}" placeholder="Name" autocomplete="off"><input type="text" inputmode="decimal" class="sc" data-ps="${i}" value="${esc(x.s)}" placeholder="Score"><button class="wb ${x.w ? 'on' : ''}" data-pw="${i}" aria-label="Winner">★</button><button class="xb" data-px="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
      <div class="chips">${sugg.map(n => `<button class="chip" data-padd="${esc(n)}">+ ${esc(n)}</button>`).join('')}<button class="chip" data-padd="">+ Someone new</button></div></div>
    <p class="muted small" style="margin:4px 0 10px">${how}</p>
    <div style="display:flex;gap:8px"><button class="btn" style="flex:1" id="lno">Cancel</button><button class="btn primary" style="flex:2" id="lsave">${F.edit ? 'Save' : 'Save the play'}</button></div>`, true);
  $('#people').innerHTML = knownPeople().concat(m.n ? [m.n] : []).map(n => `<option value="${esc(n)}">`).join('');
  const sh = $('.sheet');
  sh.oninput = e => { const t = e.target; if(t.dataset.pn !== undefined) F.players[+t.dataset.pn].n = t.value; if(t.dataset.ps !== undefined) F.players[+t.dataset.ps].s = t.value; if(t.id === 'ldate') F.date = t.value };
  sh.onclick = e => { const t = e.target.closest('[data-pw],[data-px],[data-padd]'); if(!t) return;
    if(t.dataset.pw !== undefined){ const x = F.players[+t.dataset.pw]; x.w = !x.w; t.classList.toggle('on', x.w); return }
    if(t.dataset.px !== undefined){ F.players.splice(+t.dataset.px, 1); return drawLog() }
    if(t.dataset.padd !== undefined){ F.players.push({n:t.dataset.padd, u:'', s:'', w:false}); drawLog(); if(!t.dataset.padd){ const ins = document.querySelectorAll('[data-pn]'); ins[ins.length - 1].focus() } } };
  $('#lgame').onclick = () => { F.game = null; drawLog() };
  $('#lno').onclick = () => { F = null; closeSheet() };
  $('#lsave').onclick = savePlay }
function drawGamePick(){ const nq = norm(F.q), base = ITEMS.filter(x => x.shelf !== 'minis'), list = base.filter(x => !nq || norm(x.name).includes(nq))
    .sort((a, b) => (b.shelf === 'games') - (a.shelf === 'games') || ((ST[b.id] || {}).last || '').localeCompare((ST[a.id] || {}).last || '') || coll.compare(a.name, b.name));
  sheet(`<h3>Which game?</h3><input type="search" id="lq" placeholder="Search your games" value="${esc(F.q)}"><div id="lglist" style="max-height:56vh;overflow:auto;margin-top:8px">
    ${list.slice(0, 200).map(x => `<div class="li" data-lg="${esc(x.id)}"><span class="th">${coverHTML(x)}</span><div class="n"><div>${esc(x.name)}</div><div class="s">${esc([x.shelf === 'wish' ? 'Wishlist' : '', x.type === 'expansion' ? 'Expansion' : '', (ST[x.id] || {}).last ? 'last ' + agoTxt(ST[x.id].last) : ''].filter(Boolean).join(' · '))}</div></div></div>`).join('') || '<p class="muted small">No games found. Add one by hand on the Board games shelf.</p>'}</div>
    <button class="btn" style="width:100%;margin-top:10px" id="lgno">Cancel</button>`, true);
  const q = $('#lq'); q.oninput = () => { F.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { drawGamePick(); const n = $('#lq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length) }, 200) };
  if(!base.length) setTimeout(() => q.blur(), 0);
  $('#lgno').onclick = () => { F = null; closeSheet() };
  $('#lglist').onclick = e => { const r = e.target.closest('[data-lg]'); if(!r) return; F.game = r.dataset.lg; drawLog() } }
async function savePlay(){ const it = IT[F.game]; if(!it) return;
  const date = $('#ldate').value || today(), players = F.players.map(x => ({n:x.n.trim(), u:'', s:String(x.s || '').trim(), w:!!x.w})).filter(x => x.n);
  for(const x of players) x.u = userOf(x.n);
  /* new names are remembered for next time */
  const ps = people(), m = me(); for(const x of players) if(norm(x.n) !== norm(m.n) && !ps.some(p => norm(p.n) === norm(x.n))) ps.push({n:x.n, u:x.u}); lsSet('nvBoard.people', ps);
  let p = F.edit ? PLAYS.find(x => x.id === F.edit) : null;
  if(!p){ p = {id:uid(), at:Date.now()}; PLAYS.push(p) }
  Object.assign(p, {game:it.id, date, players, err:'', sent:!it.bgg ? 'here' : NvBgg ? 'wait' : 'web'});
  await dbPut('plays', p); F = null; closeSheet(); playStats(); draw();
  toast(p.sent === 'wait' ? 'Play saved · sending it to BGG…' : 'Play saved');
  if(p.sent === 'wait') sendPending() }
function playSheet(id){ const p = allPlays().find(x => x.id === id); if(!p) return; const it = IT[p.game], mine = PLAYS.includes(p);
  const why = {yes:'Saved on BoardGameGeek.', bgg:'Logged on BoardGameGeek.', wait:NvBgg ? 'Not sent to BoardGameGeek yet' + (p.err ? ': ' + p.err : ' - it goes when you are online and logged in (Settings).') : '', fail:'BoardGameGeek did not take it: ' + (p.err || 'unknown reason'), here:'Kept in Nightvault only (this game is not on BoardGameGeek).', web:'Kept in this browser only. The Android app sends plays to BoardGameGeek.'}[p.sent] || '';
  sheet(`<h3>${esc(gameName(p))}</h3><div class="muted small">${esc(dateTxt(p.date))}${p.qty > 1 ? ' · ' + p.qty + ' plays' : ''} · ${badge(p)}</div>
    <div style="margin:10px 0">${(p.players || []).map(x => `<div class="li" style="cursor:default"><span class="r" style="width:20px">${x.w ? '<span class="win">★</span>' : ''}</span><div class="n"><div>${esc(x.n || x.u)}${x.u && x.n && x.u !== x.n ? ` <span class="muted small">(${esc(x.u)})</span>` : ''}</div></div><div class="r" style="font-size:15px;color:var(--text)">${esc(x.s)}</div></div>`).join('') || '<p class="muted small">No players written down.</p>'}</div>
    ${p.note ? `<p class="muted small">${esc(p.note)}</p>` : ''}<p class="muted small">${esc(why)}</p>
    <div class="mlist">${(p.sent === 'wait' || p.sent === 'fail') && NvBgg ? '<button class="btn primary" id="psend">Send to BGG now</button>' : ''}
      ${it ? '<button class="btn" id="pgame">Open the game</button>' : ''}${mine && p.sent !== 'yes' ? '<button class="btn" id="pedit">Change</button>' : ''}
      ${p.bggPlay ? '<button class="btn" id="pbgg">Open on BoardGameGeek</button>' : ''}${mine && p.sent !== 'yes' ? '<button class="btn danger" id="pdel">Delete this play</button>' : ''}</div>
    ${p.sent === 'yes' || p.sent === 'bgg' ? '<p class="muted small" style="margin:10px 0 0">To change or delete a play that is on BoardGameGeek, do it on BGG; Nightvault follows the next morning.</p>' : ''}`);
  if($('#psend')) $('#psend').onclick = async () => { closeSheet(); if(p.sent === 'fail') p.sent = 'wait'; await dbPut('plays', p); sendPending(true) };
  if($('#pgame')) $('#pgame').onclick = () => { closeSheet(); go({v:'game', id:it.id}) };
  if($('#pedit')) $('#pedit').onclick = () => logPlay({edit:p.id});
  if($('#pbgg')) $('#pbgg').onclick = () => openUrl('https://boardgamegeek.com/play/details/' + p.bggPlay);
  if($('#pdel')) $('#pdel').onclick = async () => { if(!confirm('Delete this play?')) return; PLAYS = PLAYS.filter(x => x !== p); await dbDel('plays', p.id); closeSheet(); playStats(); draw(); toast('Play deleted') } }

/* ---------- sending plays to BoardGameGeek (Android: NvBgg logs in with your BGG user name + password, like BG Stats) ---------- */
let SENDING = false;
async function sendPending(loud){ if(!NvBgg || SENDING) return; let st; try{ st = await NvBgg.status() }catch(e){ return }
  const todo = PLAYS.filter(p => p.sent === 'wait'); if(!todo.length) return;
  if(!st.loggedIn){ if(loud) toast('Log in to BoardGameGeek first: Settings (top right on the first page)', 5000); return }
  SENDING = true; let ok = 0, bad = 0, stop = '';
  for(const p of todo){ const it = IT[p.game]; if(!it || !it.bgg){ p.sent = 'here'; await dbPut('plays', p); continue }
    try{ const r = await NvBgg.logPlay({play:{objectid:it.bgg, playdate:p.date, quantity:1, length:0, location:'', comments:'',
        players:p.players.map(x => ({name:x.n, username:x.u || '', score:x.s || '', win:!!x.w}))}});
      Object.assign(p, {sent:'yes', bggPlay:r.playid, sentAt:Date.now(), err:''}); ok++; L('bgg', 'play sent', {game:it.name, playid:r.playid}) }
    catch(e){ const c = e.code || ''; LE('bgg', 'play not sent: ' + (e.message || e), {code:c, game:it.name});
      if(c === 'offline'){ p.err = 'no connection'; stop = 'No connection to BoardGameGeek - the plays go later' }
      else if(c === 'login' || c === 'password'){ p.err = e.message; stop = e.message }
      else { p.sent = 'fail'; p.err = e.message || String(e); bad++ } }
    await dbPut('plays', p); if(stop) break }
  SENDING = false; playStats(); draw();
  if(ok || bad || stop) toast([ok ? plural(ok, 'play') + ' sent to BGG' : '', bad ? plural(bad, 'play') + ' not taken by BGG (see Plays)' : '', stop].filter(Boolean).join(' · '), 4500) }
addEventListener('online', () => sendPending());

/* =====================================================================================================================
   FILES PER GAME – rulebook, errata / FAQ, player aids, scenarios, fan-made files (plans/boardgames.md, 21 Oct).
   Kept only in Boardgames (IndexedDB files + blobs). Opened in Bookcase's reader (books/index.html?open=board:<id> reads it from here,
   it never lands on a Bookcase shelf); text files in a sheet; anything else can be saved or shared.
   ===================================================================================================================== */
let FILES = [];
const KINDS = [['rules', 'Rulebook'], ['errata', 'Errata / FAQ'], ['aid', 'Player aid'], ['scenario', 'Scenario'], ['fan', 'Fan-made'], ['other', 'Other']];
const kindName = k => (KINDS.find(x => x[0] === k) || KINDS[5])[1];
const KIND_ICON = {rules:'<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 13h8M8 16h5"/>', errata:'<path d="M5 4h11l3 3v13H5z"/><path d="M12 9v4M12 16h.01"/>',
  aid:'<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 12h8M8 15h4"/>', scenario:'<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>',
  fan:'<path d="M12 3l2.6 5.6 6 .6-4.5 4 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.5-4 6-.6z"/>', other:'<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>'};
const fileExt = n => (String(n).match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
const READABLE = /^(pdf|epub|cbz|cbr|zip|rar|jpe?g|png|gif|webp|avif|bmp)$/;
const TEXTY = /^(txt|md|text|csv)$/;
const filesOf = target => FILES.filter(f => f.game === target).sort((a, b) => KINDS.findIndex(k => k[0] === a.kind) - KINDS.findIndex(k => k[0] === b.kind) || coll.compare(a.name, b.name));
/* a first guess at the kind of file, from its name (rulebook, errata …) – changed with one tap */
function guessKind(name){ const n = norm(name);
  if(/\b(errata|faq|clarification|corrections?|updates?|v\d)\b/.test(n)) return 'errata';
  if(/\b(fan|fanmade|fan made|house rules?|huisregels?|homebrew|variants?|custom|unofficial)\b/.test(n)) return 'fan';
  if(/\b(rules?|rulebook|regels?|spelregels|reglement|manual|handleiding|regeln|anleitung|regles)\b/.test(n)) return 'rules';
  if(/\b(aid|player aid|reference|cheat|summary|overview|quick)\b/.test(n)) return 'aid';
  if(/\b(scenario|campaign|mission|quest|map)\b/.test(n)) return 'scenario';
  return 'fan' }
const niceName = fname => String(fname).replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || fname;
function filesHTML(target, it){ const fs = filesOf(target);
  return `<div class="sec">Files</div>${fs.map(f => `<div class="li" data-file="${esc(f.id)}"><span class="fic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9be07a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${KIND_ICON[f.kind] || KIND_ICON.other}</svg></span><div class="n"><div>${esc(f.name)}</div><div class="s">${esc(kindName(f.kind))} · ${esc((fileExt(f.fname) || 'file').toUpperCase())} · ${mb(f.size || 0)}</div></div><button class="ib fdots" data-fmenu="${esc(f.id)}" aria-label="More for this file">${IC_DOTS}</button></div>`).join('')
    || '<p class="muted small" style="margin:0 0 6px">No files yet: the rulebook, errata, player aids or fan-made extras you downloaded.</p>'}
    <div class="mbar" style="margin-top:8px"><button class="btn sm" data-addfile="${esc(target)}">+ Add a file</button>${it && it.bgg ? `<button class="btn sm" data-bggfiles="${it.bgg}">Files on BGG</button>` : ''}</div>` }
function hookFiles(root){ root.querySelectorAll('[data-file],[data-fmenu],[data-addfile],[data-bggfiles]').forEach(el => el.onclick = e => { e.stopPropagation();
  if(el.dataset.fmenu) return fileMenu(el.dataset.fmenu);
  if(el.dataset.addfile) return pickFiles(el.dataset.addfile);
  if(el.dataset.bggfiles) return openUrl(`https://boardgamegeek.com/boardgame/${el.dataset.bggfiles}/files`);
  const f = FILES.find(x => x.id === el.dataset.file); if(f) openFile(f) }) }
function pickFiles(target){ const i = $('#pickfile'); i.value = ''; i.onchange = e => { const fs = [...e.target.files]; if(fs.length) addFilesSheet(target, fs) }; i.click() }
function addFilesSheet(target, fs){ const one = fs.length === 1; let kind = guessKind(fs[0].name);
  if(!one && fs.every(f => guessKind(f.name) === kind)) kind = guessKind(fs[0].name); else if(!one) kind = '';
  const total = fs.reduce((a, f) => a + f.size, 0);
  sheet(`<h3>Add ${one ? 'a file' : plural(fs.length, 'file')}</h3>
    ${one ? `<div class="field"><label>Name</label><input type="text" id="af_name" value="${esc(niceName(fs[0].name))}" maxlength="120"></div>` : `<p class="muted small" style="margin:0 0 8px">${fs.map(f => esc(f.name)).join('<br>')}</p>`}
    <div class="field"><label>What is it?${!one ? ' (empty = a guess per file from its name)' : ''}</label><div class="chips">${KINDS.map(([k, t]) => `<button class="chip ${kind === k ? 'on' : ''}" data-kind="${k}">${t}</button>`).join('')}</div></div>
    <p class="muted small">${mb(total)} · the file${one ? ' is' : 's are'} copied into Boardgames (works offline).</p>
    <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="af_go">Add</button></div>`, true);
  $('.sheet').addEventListener('click', e => { const c = e.target.closest('[data-kind]'); if(!c) return; kind = kind === c.dataset.kind && !one ? '' : c.dataset.kind; document.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x.dataset.kind === kind)) });
  $('#af_go').onclick = async () => { const b = $('#af_go'); b.disabled = true; b.textContent = 'Adding…';
    try{ await addFiles(target, fs.map((f, i) => ({file:f, kind:kind || guessKind(f.name), name:one ? ($('#af_name').value.trim() || niceName(f.name)) : niceName(f.name)}))); closeSheet(); draw(); toast(one ? 'File added' : plural(fs.length, 'file') + ' added') }
    catch(e){ LE('files', 'add failed', e); b.disabled = false; b.textContent = 'Add'; toast(e && e.name === 'QuotaExceededError' ? 'The phone is too full for this file' : (e.message || String(e)), 5000) } } }
async function addFiles(target, list){
  for(const x of list){ const id = uid(), f = {id, game:target, kind:x.kind || 'other', name:x.name || niceName(x.file.name), fname:x.file.name, size:x.file.size, type:x.file.type || '', added:Date.now()};
    await dbPut('blobs', {id, blob:x.file}); await dbPut('files', f); FILES.push(f); L('files', 'added', {name:f.fname, size:f.size, kind:f.kind}) } }
async function fileBlob(f){ const r = await dbGet('blobs', f.id); if(!r || !r.blob) throw new Error('The file is missing on this device'); return r.blob }
async function openFile(f){ const e = fileExt(f.fname);
  if(READABLE.test(e) || /^image\/|pdf|epub/.test(f.type)){ try{ sessionStorage.setItem('nvBoard.view', JSON.stringify({V, y:scrollY})) }catch(err){} location.href = '../books/index.html?open=board:' + encodeURIComponent(f.id); return }
  if(TEXTY.test(e) || /^text\//.test(f.type)){ try{ const t = await (await fileBlob(f)).text();
      sheet(`<h3>${esc(f.name)}</h3><div class="desc" style="white-space:pre-wrap;max-height:62vh;overflow:auto;font-size:13.5px">${esc(t.slice(0, 200000))}</div><button class="btn" style="width:100%;margin-top:10px" onclick="closeSheet()">Close</button>`) }catch(err){ toast(err.message || String(err), 4000) } return }
  sheet(`<h3>${esc(f.name)}</h3><p class="muted small">Boardgames can't show ${esc((e || 'this kind of').toUpperCase())} files itself. Save or share it to open it in another app.</p><div class="mlist"><button class="btn primary" id="fo_save">${NATIVE ? 'Share / open with…' : 'Download'}</button></div>`);
  $('#fo_save').onclick = () => { closeSheet(); saveCopy(f) } }
async function saveCopy(f){ try{ const blob = await fileBlob(f);
    if(NATIVE){ const FS = Capacitor.registerPlugin('Filesystem'), SH = Capacitor.registerPlugin('Share');
      const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(blob) });
      const w = await FS.writeFile({path:f.fname.replace(/[\\/:*?"<>|]+/g, '_'), data:b64, directory:'CACHE'});
      await SH.share({title:f.name, files:[w.uri], dialogTitle:'Save or open ' + f.name}); return }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.fname; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000) }
  catch(e){ if(!/cancel/i.test((e && e.message) || '')){ LE('files', 'save failed', e); toast(e.message || String(e), 4000) } } }
function fileMenu(id){ const f = FILES.find(x => x.id === id); if(!f) return;
  sheet(`<h3>${esc(f.name)}</h3><p class="muted small" style="margin:-4px 0 10px">${esc(f.fname)} · ${mb(f.size || 0)}</p>
    <div class="field"><label>What is it?</label><div class="chips">${KINDS.map(([k, t]) => `<button class="chip ${f.kind === k ? 'on' : ''}" data-fk="${k}">${t}</button>`).join('')}</div></div>
    <div class="mlist"><button class="btn primary" id="fm_open">Open</button><button class="btn" id="fm_ren">Rename</button><button class="btn" id="fm_save">${NATIVE ? 'Share / save a copy…' : 'Download a copy'}</button><button class="btn danger" id="fm_del">Remove this file</button></div>`);
  $('.sheet').addEventListener('click', async e => { const c = e.target.closest('[data-fk]'); if(!c) return; f.kind = c.dataset.fk; await dbPut('files', f); document.querySelectorAll('[data-fk]').forEach(x => x.classList.toggle('on', x.dataset.fk === f.kind)); draw() });
  $('#fm_open').onclick = () => { closeSheet(); openFile(f) };
  $('#fm_ren').onclick = async () => { const n = await ask('Rename the file', 'Name', f.name, 'Rename'); if(!n) return; f.name = n; await dbPut('files', f); draw() };
  $('#fm_save').onclick = () => { closeSheet(); saveCopy(f) };
  $('#fm_del').onclick = async () => { if(!confirm(`Remove “${f.name}” from Boardgames?`)) return; await removeFile(f); closeSheet(); draw(); toast('File removed') } }
async function removeFile(f, quiet){ await dbDel('blobs', f.id).catch(() => {}); await dbDel('files', f.id).catch(() => {}); FILES = FILES.filter(x => x !== f); if(!quiet) L('files', 'removed', {name:f.fname}) }

/* =====================================================================================================================
   MENUS: a game / piece, adding by hand, pictures
   ===================================================================================================================== */
function itemMenu(it){ const G = grOf(it.shelf), pin = G.isPinned('it:' + it.id), moved = lsGet('nvBoard.shelfOf', {})['bgg:' + it.bgg];
  sheet(`<h3>${esc(it.name)}</h3><div class="mlist">
    ${it.shelf !== 'minis' ? '<button class="btn primary" id="imlog">Log a play</button>' : ''}<button class="btn" id="img">Put in a group…</button><button class="btn" id="imp">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    <button class="btn" id="ims">Move to another shelf…</button>${it.src === 'own' ? '<button class="btn" id="ime">Edit</button>' : ''}<button class="btn" id="impic">Change the picture</button>
    ${it.bgg ? '<button class="btn" id="imbgg">Open on BoardGameGeek</button>' : ''}${it.src === 'own' ? `<button class="btn danger" id="imx">Remove from Boardgames</button>` : ''}</div>
    ${it.src === 'bgg' ? `<p class="muted small" style="margin:10px 0 0">This one comes from your BGG collection${moved ? ' (moved here by hand)' : ''}. To remove it, take it out of your collection on BoardGameGeek - it goes the next morning.</p>` : ''}`);
  if($('#imlog')) $('#imlog').onclick = () => logPlay({game:it.id});
  $('#img').onclick = () => groupPicker(it); $('#ims').onclick = () => shelfPicker([it.id]); $('#impic').onclick = () => pictureSheet(it);
  $('#imp').onclick = () => { G.togglePin(['it:' + it.id], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#ime')) $('#ime').onclick = () => editItem(it);
  if($('#imbgg')) $('#imbgg').onclick = () => openUrl(bggUrl(it.bgg));
  if($('#imx')) $('#imx').onclick = () => removeOwn([it.id]) }
async function removeOwn(ids){ const its = ids.map(id => IT[id]).filter(x => x && x.src === 'own'); if(!its.length){ toast('Games from BoardGameGeek are removed on BGG'); return }
  if(!confirm(`Remove ${its.length === 1 ? '“' + its[0].name + '”' : plural(its.length, 'item')} from Boardgames?${PLAYS.some(p => ids.includes(p.game)) ? '\n\nIts plays stay in the Plays list.' : ''}${ids.some(id => filesOf(id).length) ? '\n\nIts files (rulebook …) are removed too.' : ''}`)) return;
  for(const it of its){ await dbDel('items', it.id); await delPic('it:' + it.id); for(const f of filesOf(it.id)) await removeFile(f, true) }
  const g = new Set(its.map(x => x.id)); OWN = OWN.filter(x => !g.has(x.id)); rebuild(); closeSheet(); selEnd(true);
  if(cur().v === 'game' && g.has(cur().id)) V.pop(); draw(); toast(plural(its.length, 'item') + ' removed') }
function pictureSheet(it){ const has = PICS.has('it:' + it.id);
  sheet(`<h3>Picture of “${esc(it.name)}”</h3><div class="mlist"><button class="btn primary" id="pcpick">Take or pick a picture</button>${has && (it.thumb || it.image) ? '<button class="btn" id="pcbgg">Use the BoardGameGeek picture again</button>' : ''}${has && !(it.thumb || it.image) ? '<button class="btn danger" id="pcdel">Remove the picture</button>' : ''}</div>`);
  $('#pcpick').onclick = async () => { const b = await pickPicture(); if(!b) return; await setPic('it:' + it.id, b); closeSheet(); draw(); toast('Picture saved') };
  const rm = async () => { await delPic('it:' + it.id); closeSheet(); draw(); toast('Picture removed') };
  if($('#pcbgg')) $('#pcbgg').onclick = rm; if($('#pcdel')) $('#pcdel').onclick = rm }
function shelfPicker(ids){ const sh = IT[ids[0]] && IT[ids[0]].shelf;
  sheet(`<h3>Move ${ids.length === 1 ? '“' + esc(IT[ids[0]].name) + '”' : plural(ids.length, 'item')} to…</h3>${SHELVES.filter(s => s.id !== sh).map(s => `<div class="li" data-to="${s.id}"><span style="width:34px;display:flex;justify-content:center">${shelfIcon(s.id, 22)}</span><div class="n"><div>${esc(s.name)}</div><div class="s">${plural(inShelf(s.id).length, s.one, s.many)}</div></div></div>`).join('')}`);
  $('.sheet').addEventListener('click', async e => { const r = e.target.closest('[data-to]'); if(!r) return; const to = r.dataset.to, mv = lsGet('nvBoard.shelfOf', {});
    for(const id of ids){ const it = IT[id]; if(!it) continue;
      if(it.src === 'bgg'){ const home = (it.status || {}).own ? 'games' : 'wish'; if(to === home) delete mv[id]; else mv[id] = to }
      else { const o = OWN.find(x => x.id === id); o.shelf = to; await dbPut('items', o) } }
    lsSet('nvBoard.shelfOf', mv); rebuild(); closeSheet(); selEnd(true); toast(`${plural(ids.length, 'item')} moved to ${shelfOf(to).name}`); draw() }) }
/* adding (and editing) a game or a piece by hand */
function editItem(it, shelf){ const sh = it ? it.shelf : shelf || 'games', mini = sh === 'minis', o = it || {}, bases = ITEMS.filter(x => x.shelf === sh && x.type !== 'expansion' && x.id !== o.id).sort((a, b) => coll.compare(a.name, b.name));
  let pic = null;
  sheet(`<h3>${it ? 'Edit' : mini ? 'Add a miniature or terrain' : 'Add a game by hand'}</h3>
    ${!it && !mini ? '<p class="muted small" style="margin:-4px 0 10px">Games in your BoardGameGeek collection come in by themselves every morning - this is for games that are not on BGG (or not in your BGG collection).</p>' : ''}
    <div class="field"><label>Name</label><input type="text" id="ei_name" value="${esc(o.name || '')}" maxlength="120"></div>
    ${mini ? `<div class="field"><label>For which game or army (pieces for the same one make one tile)</label><input type="text" id="ei_for" list="forlist" value="${esc(o.forGame || '')}" maxlength="80"><datalist id="forlist">${[...new Set(ITEMS.filter(x => x.forGame).map(x => x.forGame)).values()].concat(inShelf('games').map(x => x.name)).map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <div class="row2"><div class="field"><label>How many</label><input type="number" id="ei_count" min="1" value="${esc(o.count || '')}"></div><div class="field"><label>Paint</label><select id="ei_paint" style="width:100%;height:42px">${PAINT.map(p => `<option value="${p}" ${o.paint === p ? 'selected' : ''}>${p || '-'}</option>`).join('')}</select></div></div>`
    : `<div class="row2"><div class="field"><label>Players (from – to)</label><div class="row2"><input type="number" id="ei_p0" min="1" value="${esc((o.players || [])[0] || '')}"><input type="number" id="ei_p1" min="1" value="${esc((o.players || [])[1] || '')}"></div></div>
      <div class="field"><label>Play time in minutes</label><div class="row2"><input type="number" id="ei_t0" min="1" value="${esc((o.time || [])[0] || '')}"><input type="number" id="ei_t1" min="1" value="${esc((o.time || [])[1] || '')}"></div></div></div>
      <div class="row2"><div class="field"><label>Year</label><input type="number" id="ei_year" value="${esc(o.year || '')}"></div><div class="field"><label>Age</label><input type="number" id="ei_age" value="${esc(o.age || '')}"></div></div>
      <div class="field"><label>Expansion for (leave empty for a game)</label><select id="ei_base" style="width:100%;height:42px"><option value="">- it is a game -</option>${bases.map(b => `<option value="${esc(b.id)}" ${o.base === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>`}
    <div class="field"><label>Notes</label><textarea id="ei_notes">${esc(o.notes || '')}</textarea></div>
    <div class="mlist"><button class="btn" id="ei_pic">${it && PICS.has('it:' + it.id) ? 'Change the picture' : 'Add a picture'}</button></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="ei_save">${it ? 'Save' : 'Add'}</button></div>`, true);
  $('#ei_pic').onclick = async () => { const b = await pickPicture(); if(b){ pic = b; $('#ei_pic').textContent = '✓ Picture chosen' } };
  $('#ei_save').onclick = async () => { const name = $('#ei_name').value.trim(); if(!name){ toast('Type a name'); return }
    const n = id => { const v = parseInt(($('#' + id) || {}).value); return isNaN(v) ? null : v };
    const x = it ? OWN.find(y => y.id === it.id) : {id:'own:' + uid(), shelf:sh, added:Date.now()};
    Object.assign(x, {name, notes:$('#ei_notes').value.trim()});
    if(mini) Object.assign(x, {type:'piece', forGame:$('#ei_for').value.trim(), count:n('ei_count'), paint:$('#ei_paint').value});
    else { const base = $('#ei_base').value; Object.assign(x, {type:base ? 'expansion' : 'game', base:base || null, players:[n('ei_p0'), n('ei_p1') || n('ei_p0')], time:[n('ei_t0'), n('ei_t1') || n('ei_t0')], year:n('ei_year'), age:n('ei_age')}) }
    await dbPut('items', x); if(!it) OWN.push(x); if(pic) await setPic('it:' + x.id, pic);
    rebuild(); closeSheet(); draw(); toast(it ? 'Saved' : `“${name}” added`) } }
function addSheet(){ const v = cur(); if(v.v === 'plays') return logPlay({}); editItem(null, v.shelf) }

/* ---------- groups: menus (the same words as Music and Bookcase) ---------- */
function newGroup(sh){ ask('New group', 'Name, like Party games or Warhammer', '', 'Make the group').then(n => { if(!n) return; const G = grOf(sh); G.own(n); regroup();
  const g = groupByKey(sh, 'c:' + norm(n)), [one, many] = words(sh); S.grouped[sh] = true; saveS(); draw(); toast(`Group “${n}”: ${plural(g ? g.all.length : 0, one, many)}. ${many[0].toUpperCase() + many.slice(1)} with this word in their name go in by themselves.`, 4500) }) }
function groupMenu(sh, g){ const G = grOf(sh), pin = G.isPinned('gr:' + g.key), [, many] = words(sh);
  sheet(`<h3>${esc(g.name)}</h3><div class="mlist"><button class="btn primary" id="gadd">Add ${many}…</button><button class="btn" id="gsub">New group inside</button><button class="btn" id="gmove">Put this group inside another group…</button><button class="btn" id="gren">Rename</button><button class="btn" id="gcov">Choose the tile cover</button><button class="btn" id="gpin">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>${g.kind === 'own' ? '<button class="btn danger" id="gdel">Remove this group</button>' : ''}</div>
    ${g.kind === 'own' ? `<p class="muted small" style="margin:10px 0 0">Removing the group keeps the ${many} - they show as their own tiles again.</p>` : ''}`);
  $('#gadd').onclick = () => addItemsSheet(sh, g); $('#gsub').onclick = () => newSubGroup(sh, g); $('#gmove').onclick = () => moveGroupSheet(sh, g); $('#gren').onclick = () => renameGroup(sh, g); $('#gcov').onclick = () => groupCoverSheet(sh, g);
  $('#gpin').onclick = () => { G.togglePin(['gr:' + g.key], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#gdel')) $('#gdel').onclick = () => { closeSheet(); if(cur().v === 'group' && cur().key === g.key) V.pop(); grChange(sh, () => G.remove(g), `Group “${g.name}” removed`); draw() } }
function addItemsSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, where = {}, [one, many] = words(sh); for(const x of gs) for(const it of x.items) where[it.id] = x;
  const pick = new Set(); let q = '';
  const list = () => { const nq = norm(q); return inShelf(sh).filter(x => !g.items.includes(x) && (!nq || norm([x.name, x.forGame, (where[x.id] || {}).name].join(' ')).includes(nq))).sort((x, y) => coll.compare(x.name, y.name)) };
  const upd = () => { $('#aago').textContent = pick.size ? `Add ${plural(pick.size, one, many)}` : 'Add'; $('#aago').disabled = !pick.size };
  const drawL = () => { const l = list(), el = $('#aalist'); if(!el) return;
    el.innerHTML = l.slice(0, 400).map(x => `<label class="li" style="cursor:pointer"><input type="checkbox" data-aa="${esc(x.id)}" ${pick.has(x.id) ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accentd);flex:none"><span class="th">${coverHTML(x)}</span><div class="n"><div>${esc(x.name)}</div><div class="s">${esc(subLine(x))}${where[x.id] ? ' · in ' + esc(G.path(where[x.id], gs)) : ''}</div></div></label>`).join('') + (l.length > 400 ? `<p class="muted small">… and ${l.length - 400} more - type to narrow it down</p>` : '') + (!l.length ? '<p class="muted small">Nothing found.</p>' : '');
    lazyCovers(el); upd() };
  sheet(`<h3>Add ${many} to “${esc(g.name)}”</h3><input type="search" id="aaq" placeholder="Search name or group"><div id="aalist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="aago" disabled>Add</button></div>`, true);
  $('#aaq').oninput = e => { q = e.target.value; drawL() };
  $('#aalist').onchange = e => { const c = e.target.closest('[data-aa]'); if(!c) return; c.checked ? pick.add(c.dataset.aa) : pick.delete(c.dataset.aa); upd() };
  $('#aago').onclick = () => { grChange(sh, () => G.put([...pick], g), `${plural(pick.size, one, many)} added to “${g.name}”`); closeSheet(); draw() };
  drawL() }
function newSubGroup(sh, g){ ask(`New group inside “${esc(g.name)}”`, 'Name, like Big box or Painted', '', 'Make it').then(n => { if(!n) return; const G = grOf(sh), k = G.own(n); if(k.key === g.key) return; G.setParent(k.key, g.key); regroup(); draw(); toast(`“${n}” made inside “${g.name}” - open it and add ${words(sh)[1]}`) }) }
function moveGroupSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, bad = new Set(G.inside(g, gs).concat(g.key)), opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs))), [one, many] = words(sh);
  sheet(`<h3>Put “${esc(g.name)}” inside…</h3>${g.parent ? '<button class="btn" id="mgtop" style="width:100%;margin-bottom:8px">Back on the main page</button>' : ''}
    ${opts.map(x => `<div class="li" data-mg="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, one, many)}</div></div></div>`).join('') || '<p class="muted small">No other groups yet. Make one with “+ Group” on the shelf.</p>'}`);
  lazyCovers($('.sheet'));
  if($('#mgtop')) $('#mgtop').onclick = () => { grChange(sh, () => G.setParent(g.key, null), `“${g.name}” is back on the main page`); closeSheet(); draw() };
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-mg]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.mg); grChange(sh, () => G.setParent(g.key, t.key), `“${g.name}” is now inside “${t.name}”`); closeSheet(); draw() }) }
function groupPicker(it){ const sh = it.shelf, G = grOf(sh), now = groupOfItem(it), all = groupsOf(sh).groups, gs = all.filter(g => !now || g.key !== now.key).sort((x, y) => coll.compare(x.name, y.name)), ov = G.read('items'), [one, many] = words(sh);
  sheet(`<h3>Put “${esc(it.name)}” in a group</h3>${now ? `<p class="muted small" style="margin:0 0 8px">Now in “${esc(now.name)}”.</p>` : ''}
    <div style="display:flex;gap:8px"><input type="text" id="gpn" placeholder="New group name" maxlength="60"><button class="btn primary" id="gpmake">Make</button></div>
    <div style="margin-top:10px">${gs.map(g => `<div class="li" data-gp="${esc(g.key)}"><span class="th">${groupCoverHTML(sh, g)}</span><div class="n"><div>${esc(G.path(g, all))}</div><div class="s">${plural(g.items.length, one, many)}</div></div></div>`).join('') || '<p class="muted small">No group tiles yet.</p>'}</div>
    <div class="mlist" style="margin-top:10px">${now ? '<button class="btn" id="gpout">Take it out of its group (its own tile)</button>' : ''}${ov[it.id] ? '<button class="btn" id="gpauto">Back to automatic</button>' : ''}</div>`);
  lazyCovers($('.sheet'));
  const done = (fn, m) => { grChange(sh, fn, m); closeSheet(); draw() };
  $('#gpmake').onclick = () => { const n = $('#gpn').value.trim(); if(!n) return; done(() => G.put([it.id], G.own(n)), `Put in “${n}”`) };
  if($('#gpout')) $('#gpout').onclick = () => done(() => G.put([it.id], 'none'), 'Now on its own tile');
  if($('#gpauto')) $('#gpauto').onclick = () => done(() => G.put([it.id]), 'Back to automatic');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-gp]'); if(!r) return; const g = groupByKey(sh, r.dataset.gp); if(g) done(() => G.put([it.id], g), `Put in “${g.name}”`) }) }
function renameGroup(sh, g){ const G = grOf(sh);
  ask(`Rename “${esc(g.name)}”`, 'Name', g.name, 'Rename').then(n => { if(n == null || n === g.name) return; let err = ''; G.change(() => { err = G.rename(g, n) });
    if(err){ G.undo(); toast(err, 4000); return } regroup();
    const v = cur(); if(v.v === 'group' && v.key === g.key && g.kind === 'own') v.key = 'c:' + norm(n);
    draw(); G.undoToast(`Renamed to “${n}”`, () => { regroup(); draw() }) }) }
function groupCoverSheet(sh, g){ const G = grOf(sh), c = G.cover(g.key), wc = g.all.filter(x => x.thumb || x.image || PICS.has('it:' + x.id)).sort(baseFirst);
  const save = v => { G.setCover(g.key, v); delete RNDCOV[g.key]; closeSheet(); draw(); toast('Tile cover saved') };
  sheet(`<h3>Tile cover for “${esc(g.name)}”</h3>
    <div class="chips"><button class="chip ${!c.t ? 'on' : ''}" data-gc="">The first one</button><button class="chip ${c.t === 'random' ? 'on' : ''}" data-gc="random">A random one</button><button class="chip ${c.t === 'cycle' ? 'on' : ''}" data-gc="cycle">Changing (one after another)</button><button class="chip ${c.t === 'pic' ? 'on' : ''}" data-gc="pic">A picture from the phone</button></div>
    <div class="sec">Or pick one</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${wc.map(x => `<div class="bk" data-gca="${esc(x.id)}" style="${c.t === 'item' && c.al === x.id ? 'outline:2px solid var(--accent);border-radius:12px' : ''}">${coverHTML(x)}<div class="a">${esc(x.name)}</div></div>`).join('') || '<p class="muted small">No pictures in this group yet.</p>'}</div>`);
  lazyCovers($('.sheet'));
  $('.sheet').onclick = async e => { const bt = e.target.closest('[data-gc]'), it = e.target.closest('[data-gca]');
    if(it) return save({t:'item', al:it.dataset.gca}); if(!bt) return; const t = bt.dataset.gc;
    if(t === 'pic'){ const b = await pickPicture(); if(!b) return; await setPic('grp:' + sh + ':' + g.key, b); return save({t:'pic'}) }
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
function selParts(){ const sh = cur().shelf, gs = groupsOf(sh).groups, its = [...SEL].filter(x => x.startsWith('it:')).map(x => x.slice(3)), grs = [...SEL].filter(x => x.startsWith('gr:')).map(x => x.slice(3));
  const items = [...new Set(its.concat(...grs.map(k => (gs.find(g => g.key === k) || {all:[]}).all.map(x => x.id))))];
  return {sh, gs, its, grs, items} }
function selMoveSheet(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), bad = new Set(grs.flatMap(k => { const g = gs.find(x => x.key === k); return g ? G.inside(g, gs).concat(k) : [k] })), [one, many] = words(sh);
  const opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Move ${plural(SEL.size, 'tile')} to…</h3><div style="display:flex;gap:8px"><input type="text" id="smn" placeholder="New group name" maxlength="60"><button class="btn primary" id="smmake">Make</button></div>
    <button class="btn" id="smtop" style="width:100%;margin-top:10px">The main page (own tiles)</button>
    <div style="margin-top:8px">${opts.map(x => `<div class="li" data-sm="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, one, many)}</div></div></div>`).join('')}</div>`);
  lazyCovers($('.sheet'));
  const move = t => { if(t){ G.put(its, t); for(const k of grs) G.setParent(k, t.key) } else { G.put(its, 'none'); for(const k of grs) G.setParent(k, null) } };
  const doit = (t, label, first) => { const n = SEL.size; grChange(sh, () => { if(first) first(); move(t) }, `${plural(n, 'tile')} moved to ${label}`); closeSheet(); selEnd(true); draw() };
  $('#smmake').onclick = () => { const n = $('#smn').value.trim(); if(!n) return; const v = cur(); doit({key:'c:' + norm(n), name:n, kind:'own'}, `“${n}”`, () => { const g = G.own(n); if(v.v === 'group' && !bad.has(v.key)) G.setParent(g.key, v.key) }) };
  $('#smtop').onclick = () => doit(null, 'the main page');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-sm]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.sm); if(t) doit(t, `“${t.name}”`) }) }
function selTakeOut(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), here = gs.find(x => x.key === cur().key), up = here && here.parent ? gs.find(x => x.key === here.parent) : null, n = SEL.size;
  grChange(sh, () => { G.put(its, up || 'none'); for(const k of grs) G.setParent(k, up ? up.key : null) }, `${plural(n, 'tile')} taken out${up ? ' to “' + up.name + '”' : ' to the main page'}`); selEnd(true); draw() }
function selMore(){ const {items} = selParts(), sh = cur().shelf, G = grOf(sh), ids = [...SEL], allPinned = ids.every(x => G.isPinned(x)), own = items.filter(id => (IT[id] || {}).src === 'own');
  sheet(`<h3>${plural(ids.length, 'tile')} · ${plural(items.length, 'item')}</h3><div class="mlist"><button class="btn" id="smpin">${allPinned ? '★ Unpin' : '★ Pin to the top'}</button><button class="btn" id="smshelf">Move to another shelf…</button>${own.length ? `<button class="btn danger" id="smdel">Remove ${plural(own.length, 'item')} added by hand</button>` : ''}</div>`);
  $('#smpin').onclick = () => { G.togglePin(ids, !allPinned); closeSheet(); selEnd(true); draw() };
  $('#smshelf').onclick = () => shelfPicker(items); if($('#smdel')) $('#smdel').onclick = () => removeOwn(own) }

/* =====================================================================================================================
   SETTINGS
   ===================================================================================================================== */
async function appSettings(){ const m = me(), ps = people();
  let st = null; if(NvBgg) try{ st = await NvBgg.status() }catch(e){ st = null }
  const d = BGG ? new Date(BGG.fetched) : null;
  sheet(`<h3>Boardgames</h3>
    <div class="sec" style="margin-top:4px">Your games from BoardGameGeek</div>
    ${BGG ? `<p class="small" style="margin:0 0 8px">From BGG user <b>${esc(BGG.user)}</b> · ${plural(BGG.games.length, 'game')} and expansions · ${plural(BGG.plays.length, 'play')}. Updated ${d.toLocaleString()}; it updates by itself every morning.</p>`
      : `<p class="small" style="margin:0 0 8px">Not set up yet. A GitHub job (“Update board games”) fetches your BGG collection, wishlist and plays every morning. It needs two <b>repository secrets</b> on <b>brokeuh/nightvault-pocket</b> (Settings → Secrets and variables → Actions):<br>• <b>BGG_USERNAME</b> – your BGG user name<br>• <b>BGG_TOKEN</b> – the application token from boardgamegeek.com/applications (the one the PC app uses works too).<br>Then run it once from the Control page or GitHub's Actions tab.</p>`}
    ${statusLine() ? `<div class="note" style="margin:0 0 8px"><b>Last BGG update:</b> ${esc(statusLine())}${BGGSTATUS.kind === 'token' ? '<br>Make a new token on boardgamegeek.com/applications and put it in the BGG_TOKEN secret.' : BGGSTATUS.kind === 'bgg' && /user ?name/i.test(statusLine()) ? '<br>Check the BGG_USERNAME secret (your BGG user name, not your e-mail).' : ''}</div>` : ''}
    <div class="mlist"><button class="btn" id="as_reload">Check for new BGG data now</button></div>
    <div class="sec">Send plays to BoardGameGeek</div>
    ${NvBgg ? (st && st.loggedIn ? `<p class="small" style="margin:0 0 8px">Logged in as <b>${esc(st.username)}</b>. New plays go to BGG by themselves.</p><div class="mlist"><button class="btn" id="as_logout">Log out of BGG</button></div>`
      : `<p class="muted small" style="margin:0 0 8px">BGG has no official way for apps to log plays, so Boardgames logs in like the BGG website does (as BG Stats does). Your password stays on this phone only, in the app's own storage.</p>
        <div class="field"><input type="text" id="as_u" placeholder="BGG user name" value="${esc(m.u)}" autocomplete="username" autocapitalize="off"></div><div class="field"><input type="password" id="as_p" placeholder="BGG password" autocomplete="current-password"></div><div class="mlist"><button class="btn primary" id="as_login">Log in to BGG</button></div>`)
      : '<p class="muted small" style="margin:0">This works in the Android app (a web page is not allowed to talk to BGG). Plays you log in this browser stay in this browser.</p>'}
    <div class="sec">You</div>
    <div class="row2"><div class="field"><label>Your name in plays</label><input type="text" id="as_mn" value="${esc(m.n)}" placeholder="Jochem"></div><div class="field"><label>Your BGG user name</label><input type="text" id="as_mu" value="${esc(lsGet('nvBoard.me', {}).u || '')}" placeholder="${esc((BGG && BGG.user) || '')}" autocapitalize="off"></div></div>
    <div class="sec">People you play with</div>
    <p class="muted small" style="margin:0 0 6px">Give someone their BGG user name and their plays show up on their BGG account too.</p>
    <div id="as_people">${ps.map((p, i) => `<div class="prow"><input type="text" data-pn="${i}" value="${esc(p.n)}" placeholder="Name"><input type="text" data-pu="${i}" value="${esc(p.u || '')}" placeholder="BGG user (optional)" autocapitalize="off" style="flex:1"><button class="xb" data-px="${i}" aria-label="Remove">✕</button></div>`).join('') || '<p class="muted small">Names are remembered when you log a play.</p>'}</div>
    <p class="muted small" style="margin-top:14px">Groups: each shelf's ⚙ (top right inside the shelf) saves or loads its groups. Problems? Switch on <b>Debug mode</b> at the bottom of The Nightvault and send the log.</p>`);
  const saveMe = () => lsSet('nvBoard.me', {n:$('#as_mn').value.trim(), u:$('#as_mu').value.trim()});
  $('#as_mn').onchange = saveMe; $('#as_mu').onchange = saveMe;
  $('#as_people').onchange = e => { const t = e.target, l = people(); if(t.dataset.pn !== undefined) l[+t.dataset.pn].n = t.value.trim(); if(t.dataset.pu !== undefined) l[+t.dataset.pu].u = t.value.trim(); lsSet('nvBoard.people', l.filter(p => p.n)) };
  $('#as_people').onclick = e => { const x = e.target.closest('[data-px]'); if(!x) return; const l = people(); l.splice(+x.dataset.px, 1); lsSet('nvBoard.people', l); appSettings() };
  $('#as_reload').onclick = async () => { $('#as_reload').disabled = true; $('#as_reload').textContent = 'Checking…'; await loadStatus(); const ch = await loadBgg(true); if(ch) rebuild(); draw(); toast(ch ? 'New BGG data loaded' : BGGERR === 'none' ? 'No BGG data yet - see the steps above' : BGGERR ? BGGERR : 'Nothing new from BGG', 4000); appSettings() };
  if($('#as_login')) $('#as_login').onclick = async () => { const b = $('#as_login'); b.disabled = true; b.textContent = 'Logging in…';
    try{ await NvBgg.login({username:$('#as_u').value.trim(), password:$('#as_p').value}); toast('Logged in to BGG'); appSettings(); sendPending(true) }
    catch(e){ toast(e.message || String(e), 5000); b.disabled = false; b.textContent = 'Log in to BGG' } };
  if($('#as_logout')) $('#as_logout').onclick = async () => { await NvBgg.logout(); toast('Logged out of BGG'); appSettings() } }
function shelfSettings(sh){ const s = shelfOf(sh), G = grOf(sh), o = shelfOpt(sh);
  sheet(`<h3>${esc(s.name)}</h3>
    <div class="opt"><label for="ss_auto">${sh === 'minis' ? 'Pieces for the same game or army make one tile' : 'Expansions go into their game\'s tile'}</label><input type="checkbox" id="ss_auto" ${o.noAuto ? '' : 'checked'}></div>
    <div class="sec">Your groups</div><div class="mlist"><button class="btn" id="ss_save">Save my groups</button><button class="btn" id="ss_load">Load from a file</button></div>`);
  $('#ss_auto').onchange = e => { setShelfOpt(sh, {noAuto:!e.target.checked}); regroup(); draw(); toast('Saved') };
  $('#ss_save').onclick = async () => { try{ const r = await G.saveBackup(); if(r !== 'cancelled') toast('Groups saved') }catch(e){ toast(e.message || String(e), 4000) } };
  $('#ss_load').onclick = async () => { const t = await G.pickFile(); if(!t) return; const c = G.checkBackup(t); if(!c.ok){ toast(c.msg, 5000); return }
    if(!confirm(c.msg + '\n\nPut these groups back? (Undo is possible right after.)')) return; G.applyBackup(c.d); regroup(); closeSheet(); draw(); G.undoToast('Groups loaded', () => { regroup(); draw() }) } }
$('#setbtn').onclick = () => { const v = cur(); if(v.v === 'shelf' || v.v === 'group') shelfSettings(v.shelf); else if(v.v === 'game' && IT[v.id]) shelfSettings(IT[v.id].shelf); else appSettings() };
$('#addbtn').onclick = () => addSheet();

/* ---------- Android back button: sheet → one screen back → The Nightvault ---------- */
if(window.Capacitor) try{ const A = (Capacitor.Plugins && Capacitor.Plugins.App) || Capacitor.registerPlugin('App');
  A.addListener('backButton', () => { if(window.NVMENU && NVMENU.close()) return; if(sheetOpen()){ if(!$('#scrim').dataset.sticky){ closeSheet(); return } F = null; closeSheet(); return }
    if(back()) return; if(fromHub()){ location.href = '../hub/index.html'; return } A.minimizeApp && A.minimizeApp() }) }catch(e){}
document.addEventListener('visibilitychange', () => { if(!document.hidden) sendPending() });

document.addEventListener('visibilitychange', () => { if(document.hidden) window.NVHERE && NVHERE.save('nvBoard.here', {V}) }); addEventListener('pagehide', () => window.NVHERE && NVHERE.save('nvBoard.here', {V}));   // back where you were (../hub/nvlog.js)
/* ---------- start ---------- */
(async () => {
  try{ await openDB();
    const [own, plays, keys, kv, files] = await Promise.all([dbAll('items'), dbAll('plays'), dbKeys('pics'), dbGet('kv', 'bgg'), dbAll('files')]);
    OWN = own; PLAYS = plays; FILES = files; for(const k of keys) PICS.add(k); if(kv && kv.data) BGG = kv.data }
  catch(e){ $('#body').innerHTML = `<p class="muted">Boardgames could not open its storage: ${esc(e.message || e)}</p>`; return }
  rebuild();
  const P = new URLSearchParams(location.search), sh = P.get('shelf'); if(sh && SHELVES.some(s => s.id === sh)) V.push({v:'shelf', shelf:sh});
  if(P.get('plays')) V.push({v:'plays'});
  /* back from Bookcase's reader: the same page as before (game page, group …) */
  let back0 = null; try{ back0 = JSON.parse(sessionStorage.getItem('nvBoard.view') || 'null'); sessionStorage.removeItem('nvBoard.view') }catch(e){}
  if(back0 && Array.isArray(back0.V) && back0.V.length) V = back0.V;
  else { const h = window.NVHERE && NVHERE.take('nvBoard.here'); if(h && Array.isArray(h.V) && h.V.length) V = h.V }
  try{ draw() }catch(e){ V = [{v:'shelves'}]; draw() } if(back0 && back0.y) scrollTo(0, back0.y); L('start', `${ITEMS.length} items, ${PLAYS.length} own plays`);
  const [ch] = await Promise.all([loadBgg(false), loadStatus()]); if(ch) rebuild(); if(ch || BGGERR || (BGGSTATUS && !BGGSTATUS.ok)) draw();
  sendPending();
  window.NVBOARD = {get items(){ return ITEMS }, get plays(){ return PLAYS }, get files(){ return FILES }, addFiles, openFile, allPlays, logPlay, draw, rebuild, loadBgg, sendPending};   // for testing
})();
