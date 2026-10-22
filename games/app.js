/* Nightvault Games (test) – the app. Plan: plans/games.md in nightvault-src.
   A list of the games you own (every platform: PC, consoles, retro, handhelds, phone) and the games you want (Wishlist). Not a player.
   Parts: basics · storage · platforms and stores · shelves · online (IGDB, Steam, SteamGridDB – the owner's own keys, on this device only) ·
   library · groups (shared ../hub/nvgroups.js) · covers · tiles · screens · the game page · adding · copies · menus · select · settings · start */
'use strict';

/* ---------- basics (the same as Bookcase / Music) ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const coll = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});
const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const hue = s => { let h = 0; for(const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360 };
let toastT = 0; function toast(m, ms){ const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 2600) }
window.toast = toast;
const L = (a, t, d) => { try{ window.NVLOG && NVLOG.log(a, t, d) }catch(e){} }, LE = (a, t, d) => { try{ window.NVLOG && NVLOG.error(a, t, d) }catch(e){} };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
const S = Object.assign({sort:{}, grouped:{}, filter:{}, guess:true}, lsGet('nvGames.settings', {}));
const saveS = () => lsSet('nvGames.settings', S);
const fromHub = () => { try{ return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
try{ if(new URLSearchParams(location.search).get('nv') === 'hub') sessionStorage.setItem('nvHub', '1'); if(fromHub()) $('#hubback').hidden = false }catch(e){}
const IC_DOTS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const PINB = '<span class="pinb">★</span>';

/* ---------- storage: IndexedDB 'nvGames' (works offline) ----------
   games  : {id, title, year, series, summary, genres:[], igdb, igdbUrl, igdbCover, steam, plats:[platform ids from IGDB], cover (picture address),
             wish (on the wishlist), wishPlats:[platform ids], copies:[{id, plat, kind:'digital'|'physical', store, box, region, added}], added}
   covers : {id, blob}   (game id = your own picture, or 'grp:<shelf>:<group key>' for a group's own picture)
   kv     : {id, ...} */
let DB = null;
function openDB(){ return new Promise((ok, no) => { const r = indexedDB.open('nvGames', 1);
  r.onupgradeneeded = () => { const d = r.result; for(const s of ['games', 'covers', 'kv']) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}) };
  r.onblocked = () => toast('Close the other Games tab, then reload', 6000);
  r.onsuccess = () => ok(DB = r.result); r.onerror = () => no(r.error) }) }
function tx(store, mode, fn){ return new Promise((ok, no) => { const t = DB.transaction(store, mode), st = t.objectStore(store); let res; const q = fn(st); if(q) q.onsuccess = () => res = q.result; t.oncomplete = () => ok(res); t.onerror = t.onabort = () => no(t.error || new Error('Storage error')) }) }
const dbGet = (s, id) => tx(s, 'readonly', st => st.get(id));
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbKeys = s => tx(s, 'readonly', st => st.getAllKeys());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));
const dbPutMany = (s, arr) => tx(s, 'readwrite', st => { for(const v of arr) st.put(v) });
const dbClear = s => tx(s, 'readwrite', st => st.clear());

/* ---------- platforms and stores ----------
   Text names only – never console or store logos (owner's rule). igdb = IGDB's platform ids, to turn IGDB results into our platforms. */
const FAM = {
  pc:{c:['#16323a', '#18203a'], s:'#7fe3ff'}, ps:{c:['#16243a', '#1a1b33'], s:'#7fb2ff'}, xbox:{c:['#1a3216', '#1a2233'], s:'#9be07a'},
  nin:{c:['#3a1620', '#1d1b33'], s:'#ff9db7'}, sega:{c:['#162a3a', '#1f1b33'], s:'#8fc4ff'}, atari:{c:['#3a2216', '#1d1b33'], s:'#ffb08a'},
  retro:{c:['#3a2816', '#1d2236'], s:'#f0b46a'}, comp:{c:['#2a3216', '#1a1f2e'], s:'#d4f08a'},
  mobile:{c:['#2e1a3a', '#1a1b33'], s:'#e0a8ff'}, other:{c:['#2a2f3a', '#1a1f2e'], s:'#c4cdd8'}};
/* sections of the start page, in this order (owner, 19 Oct: a square tile for every known game system and handheld) */
const SECS = [['list', 'Your list'], ['pc', 'PC'], ['ps', 'PlayStation'], ['xbox', 'Xbox'], ['nin', 'Nintendo'], ['ninh', 'Nintendo handhelds'], ['sega', 'Sega'],
  ['atari', 'Atari'], ['retro', 'Other consoles'], ['hand', 'Other handhelds'], ['comp', 'Home computers'], ['mobile', 'Phone and tablet'], ['own', 'Your own systems']];
const P = (id, name, short, fam, sec, igdb, icon) => ({id, name, short, fam, sec, igdb:igdb || [], icon});
const PLATS = [
  P('pc', 'PC', 'PC', 'pc', 'pc', [6, 3, 14], 'pc'), P('dos', 'MS-DOS', 'DOS', 'pc', 'pc', [13], 'pc'),
  P('ps5', 'PlayStation 5', 'PS5', 'ps', 'ps', [167]), P('ps4', 'PlayStation 4', 'PS4', 'ps', 'ps', [48]), P('ps3', 'PlayStation 3', 'PS3', 'ps', 'ps', [9]),
  P('ps2', 'PlayStation 2', 'PS2', 'ps', 'ps', [8]), P('ps1', 'PlayStation', 'PS1', 'ps', 'ps', [7]),
  P('vita', 'PS Vita', 'VITA', 'ps', 'ps', [46], 'hand'), P('psp', 'PSP', 'PSP', 'ps', 'ps', [38], 'hand'),
  P('xsx', 'Xbox Series X|S', 'XSX', 'xbox', 'xbox', [169]), P('xone', 'Xbox One', 'XONE', 'xbox', 'xbox', [49]), P('x360', 'Xbox 360', '360', 'xbox', 'xbox', [12]),
  P('xbox', 'Xbox', 'XBOX', 'xbox', 'xbox', [11]),
  P('switch2', 'Nintendo Switch 2', 'SW2', 'nin', 'nin', [508]), P('switch', 'Nintendo Switch', 'SWITCH', 'nin', 'nin', [130]), P('wiiu', 'Wii U', 'WII U', 'nin', 'nin', [41]),
  P('wii', 'Wii', 'WII', 'nin', 'nin', [5]), P('gc', 'GameCube', 'GC', 'nin', 'nin', [21]), P('n64', 'Nintendo 64', 'N64', 'nin', 'nin', [4]),
  P('snes', 'Super Nintendo / Super Famicom', 'SNES', 'nin', 'nin', [19, 58]), P('nes', 'NES / Famicom', 'NES', 'nin', 'nin', [18, 99]),
  P('fds', 'Famicom Disk System', 'FDS', 'nin', 'nin', [51]),
  P('n3ds', 'Nintendo 3DS / 2DS', '3DS', 'nin', 'ninh', [37], 'hand'), P('ds', 'Nintendo DS', 'DS', 'nin', 'ninh', [20], 'hand'),
  P('gba', 'Game Boy Advance', 'GBA', 'nin', 'ninh', [24], 'hand'), P('gbc', 'Game Boy Color', 'GBC', 'nin', 'ninh', [22], 'hand'),
  P('gb', 'Game Boy', 'GB', 'nin', 'ninh', [33], 'hand'), P('vb', 'Virtual Boy', 'VB', 'nin', 'ninh', [87], 'hand'),
  P('gw', 'Game & Watch', 'G&W', 'nin', 'ninh', [], 'hand'), P('pmini', 'Pokémon mini', 'MINI', 'nin', 'ninh', [166], 'hand'),
  P('dc', 'Dreamcast', 'DC', 'sega', 'sega', [23]), P('saturn', 'Sega Saturn', 'SATURN', 'sega', 'sega', [32]), P('s32x', 'Sega 32X', '32X', 'sega', 'sega', [30]),
  P('segacd', 'Sega CD / Mega-CD', 'MCD', 'sega', 'sega', [78]), P('md', 'Mega Drive / Genesis', 'MD', 'sega', 'sega', [29]),
  P('sms', 'Master System', 'SMS', 'sega', 'sega', [64]), P('sg1000', 'SG-1000', 'SG-1000', 'sega', 'sega', [84]),
  P('gg', 'Game Gear', 'GG', 'sega', 'sega', [35], 'hand'), P('pico', 'Sega Pico', 'PICO', 'sega', 'sega', []),
  P('jaguar', 'Atari Jaguar', 'JAGUAR', 'atari', 'atari', [62]), P('a7800', 'Atari 7800', '7800', 'atari', 'atari', [60]),
  P('a5200', 'Atari 5200', '5200', 'atari', 'atari', [66]), P('a2600', 'Atari 2600', '2600', 'atari', 'atari', [59]),
  P('lynx', 'Atari Lynx', 'LYNX', 'atari', 'atari', [61], 'hand'),
  P('neogeo', 'Neo Geo (AES / MVS)', 'NEO GEO', 'retro', 'retro', [80, 79]), P('neocd', 'Neo Geo CD', 'NGCD', 'retro', 'retro', [136]),
  P('pce', 'PC Engine / TurboGrafx-16', 'PCE', 'retro', 'retro', [86]), P('pcecd', 'PC Engine CD / TurboGrafx-CD', 'PCE-CD', 'retro', 'retro', [150]),
  P('pcfx', 'PC-FX', 'PC-FX', 'retro', 'retro', [274]), P('3do', '3DO', '3DO', 'retro', 'retro', [50]), P('cdi', 'Philips CD-i', 'CD-i', 'retro', 'retro', [117]),
  P('coleco', 'ColecoVision', 'COLECO', 'retro', 'retro', [68]), P('intv', 'Intellivision', 'INTV', 'retro', 'retro', [67]),
  P('vectrex', 'Vectrex', 'VECTREX', 'retro', 'retro', [70]), P('odyssey2', 'Magnavox Odyssey² / Videopac', 'ODY²', 'retro', 'retro', [133]),
  P('ouya', 'Ouya', 'OUYA', 'retro', 'retro', [72]), P('stadia', 'Google Stadia', 'STADIA', 'retro', 'retro', [170]),
  P('evercade', 'Evercade', 'EVERCADE', 'retro', 'retro', []), P('arcade', 'Arcade', 'ARCADE', 'retro', 'retro', [52]),
  P('ngpc', 'Neo Geo Pocket Color', 'NGPC', 'retro', 'hand', [120], 'hand'), P('ngp', 'Neo Geo Pocket', 'NGP', 'retro', 'hand', [119], 'hand'),
  P('wsc', 'WonderSwan Color', 'WSC', 'retro', 'hand', [123], 'hand'), P('ws', 'WonderSwan', 'WS', 'retro', 'hand', [57], 'hand'),
  P('ngage', 'N-Gage', 'N-GAGE', 'retro', 'hand', [42], 'hand'), P('playdate', 'Playdate', 'PLAYDATE', 'retro', 'hand', [], 'hand'),
  P('gamecom', 'Game.com', 'GAME.COM', 'retro', 'hand', [], 'hand'),
  P('c64', 'Commodore 64', 'C64', 'comp', 'comp', [15], 'pc'), P('amiga', 'Amiga', 'AMIGA', 'comp', 'comp', [16], 'pc'),
  P('ast', 'Atari ST', 'ST', 'comp', 'comp', [63], 'pc'), P('a8bit', 'Atari 8-bit', 'ATARI 8', 'comp', 'comp', [65], 'pc'),
  P('msx', 'MSX', 'MSX', 'comp', 'comp', [27], 'pc'), P('zx', 'ZX Spectrum', 'ZX', 'comp', 'comp', [26], 'pc'), P('cpc', 'Amstrad CPC', 'CPC', 'comp', 'comp', [25], 'pc'),
  P('x68k', 'Sharp X68000', 'X68K', 'comp', 'comp', [121], 'pc'), P('pc98', 'NEC PC-98', 'PC-98', 'comp', 'comp', [149], 'pc'),
  P('android', 'Android', 'ANDROID', 'mobile', 'mobile', [34], 'phone'), P('ios', 'iPhone / iPad', 'iOS', 'mobile', 'mobile', [39], 'phone')];
const IGDB_PLAT = {}; for(const p of PLATS) for(const i of p.igdb || []) IGDB_PLAT[i] = p.id;
/* your own platforms (Other… → a name), stored as {id:'x-…', name} */
const ownPlats = () => lsGet('nvGames.plats', []);
const allPlats = () => PLATS.concat(ownPlats().map(p => Object.assign({short:p.name.toUpperCase(), fam:'other', sec:'own'}, p)));
const platOf = id => allPlats().find(p => p.id === id) || {id, name:id, short:String(id).toUpperCase(), fam:'other'};
function addOwnPlat(name){ name = String(name || '').trim(); if(!name) return null; const hit = allPlats().find(p => norm(p.name) === norm(name) || norm(p.short) === norm(name)); if(hit) return hit.id;
  const id = 'x-' + norm(name).replace(/ /g, '-'); lsSet('nvGames.plats', ownPlats().concat({id, name})); return id }
const STORES = {steam:['Steam', 'Steam'], gog:['GOG', 'GOG'], epic:['Epic Games', 'Epic'], ea:['EA app', 'EA'], ubisoft:['Ubisoft Connect', 'Ubisoft'], battlenet:['Battle.net', 'B.net'],
  itch:['itch.io', 'itch'], amazon:['Amazon Games', 'Amazon'], msstore:['Microsoft Store / Game Pass', 'MS Store'], psn:['PlayStation Store', 'PS Store'],
  xbox:['Xbox Store', 'Xbox Store'], eshop:['Nintendo eShop', 'eShop'], app:['App store', 'App store'], own:['My own install (no launcher)', 'Own install'], backup:['My own backup (ROM / disc image)', 'Backup'], other:['Other / not sure', 'Digital']};
const storesFor = plat => { const f = platOf(plat).fam; return f === 'pc' ? ['steam', 'gog', 'epic', 'ea', 'ubisoft', 'battlenet', 'itch', 'amazon', 'msstore', 'own', 'backup', 'other']
  : f === 'ps' ? ['psn', 'backup', 'other'] : f === 'xbox' ? ['xbox', 'msstore', 'backup', 'other'] : f === 'nin' ? ['eshop', 'backup', 'other'] : f === 'mobile' ? ['app', 'other'] : ['backup', 'own', 'other'] };
const BOX = {sealed:'Sealed', cib:'Complete in box', nomanual:'Box, no manual', loose:'Loose (game only)'};
const BOXS = {sealed:'Sealed', cib:'CIB', nomanual:'Boxed', loose:'Loose'};
const REGIONS = ['PAL', 'NTSC-U', 'NTSC-J', 'Other'];
const copyText = c => c.kind === 'physical' ? ['Physical', BOX[c.box], c.region].filter(Boolean).join(' · ') : (STORES[c.store] || STORES.other)[0];
const copyShort = c => c.kind === 'physical' ? (BOXS[c.box] || 'Boxed') + (c.region && c.region !== 'Other' ? ' ' + c.region : '') : (STORES[c.store] || STORES.other)[1];
const PLAT_ICON = {
  pad:'<path d="M7 9h10a4 4 0 0 1 3.9 4.9l-.6 2.6a2 2 0 0 1-3.4.9L15 15H9l-1.9 2.4a2 2 0 0 1-3.4-.9l-.6-2.6A4 4 0 0 1 7 9z"/><path d="M8 11.5v2M7 12.5h2"/><circle cx="15.5" cy="12" r=".8"/><circle cx="17" cy="13.5" r=".8"/>',
  pc:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  hand:'<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><rect x="8.5" y="5" width="7" height="6" rx="1"/><path d="M9 15.5h2M10 14.5v2"/><circle cx="15" cy="15.5" r=".8"/>',
  phone:'<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  all:'<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  wish:'<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'};

/* ---------- shelves: All games, one per platform you have games for, Wishlist ---------- */
function shelves(all){
  const set = lsGet('nvGames.shelves', {}), hid = set.hidden || {};
  const ps = allPlats().map(p => Object.assign({}, FAM[p.fam] || FAM.other, {id:p.id, name:p.name, short:p.short, sec:p.sec || 'own', icon:p.icon || 'pad', plat:true}));
  const list = [{id:'all', name:'All games', c:['#1c1f3e', '#151a2e'], s:'#a9b4ff', icon:'all', sec:'list'}, {id:'wish', name:'Wishlist', c:['#3a1626', '#2a1f36'], s:'#ff9db7', icon:'wish', sec:'list'}, ...ps];
  for(const s of list) s.hidden = !!hid[s.id];
  return all ? list : list.filter(s => !s.hidden) }
const shelfOf = id => shelves(true).find(s => s.id === id) || Object.assign({}, FAM[platOf(id).fam] || FAM.other, {id, name:platOf(id).name, icon:platOf(id).icon || (platOf(id).fam === 'pc' ? 'pc' : 'pad'), plat:true});
const shelfIcon = (s, size) => `<svg width="${size || 26}" height="${size || 26}" viewBox="0 0 24 24" fill="none" stroke="${s.s}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${PLAT_ICON[s.icon] || PLAT_ICON.pad}</svg>`;
const owned = g => g.copies.length > 0;
function inShelf(sh){ return sh === 'all' ? GAMES.filter(owned) : sh === 'wish' ? GAMES.filter(g => g.wish) : GAMES.filter(g => g.copies.some(c => c.plat === sh)) }

/* =====================================================================================================================
   ONLINE: IGDB (game info + covers), SteamGridDB (more covers), Steam (your library + wishlist). The owner's own free keys,
   typed in once in Settings and kept on this device only (localStorage nvGames.keys) – never in the app's code or a repository.
   These websites don't let a web page ask them directly (no CORS), so the Android app asks with Android's own connection (CapacitorHttp).
   ===================================================================================================================== */
const KEYS = () => lsGet('nvGames.keys', {});
const hasIgdb = () => { const k = KEYS(); return !!(k.igdbId && k.igdbSecret) };
const NOWEB = 'The website is not allowed to ask this site directly - it works in the Android app.';
const HTTP = () => NATIVE && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp;
async function net(url, o){ o = o || {}; const method = o.method || 'GET', headers = o.headers || {}, H = HTTP(), host = new URL(url).host;
  const fail = (st, t) => Object.assign(new Error(`${host} answered ${st}`), {status:st, text:t});
  if(H){ const r = await H.request({url, method, headers, data:o.body, responseType:'text'}); const t = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    if(r.status >= 400) throw fail(r.status, t); return o.text ? t : (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) }
  let r; try{ r = await fetch(url, {method, headers, body:o.body}) }catch(e){ throw Object.assign(new Error(NOWEB), {noweb:true}) }
  const t = await r.text(); if(!r.ok) throw fail(r.status, t); return o.text ? t : JSON.parse(t) }

/* IGDB: a token from Twitch (client id + secret), then Apicalypse queries. Max 4 requests a second. */
let igdbLast = 0;
async function igdbToken(force){ const k = KEYS(), t = lsGet('nvGames.igdbTok', null);
  if(!k.igdbId || !k.igdbSecret) throw new Error('Add your IGDB keys first: Settings → Online lookup.');
  if(!force && t && t.id === k.igdbId && t.exp > Date.now() + 60000) return t.tok;
  const r = await net(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(k.igdbId)}&client_secret=${encodeURIComponent(k.igdbSecret)}&grant_type=client_credentials`, {method:'POST'});
  if(!r.access_token) throw new Error('Twitch did not give a key - check the Client ID and Secret.');
  lsSet('nvGames.igdbTok', {id:k.igdbId, tok:r.access_token, exp:Date.now() + (r.expires_in || 3600) * 1000}); return r.access_token }
async function igdb(body, ep){ const w = 260 - (Date.now() - igdbLast); if(w > 0) await sleep(w); igdbLast = Date.now();
  const go = async tok => net('https://api.igdb.com/v4/' + (ep || 'games'), {method:'POST', body, headers:{'Client-ID':KEYS().igdbId, Authorization:'Bearer ' + tok, Accept:'application/json', 'Content-Type':'text/plain'}});
  try{ return await go(await igdbToken()) }catch(e){ if(e.status === 401){ return go(await igdbToken(true)) } throw e } }
const igdbImg = (id, size) => id ? `https://images.igdb.com/igdb/image/upload/t_${size || 'cover_big'}/${id}.jpg` : '';
const IGDB_FIELDS = 'name,first_release_date,cover.image_id,platforms,franchises.name,collections.name,summary,genres.name,url';
function fromIgdb(x){ const fr = (x.franchises || [])[0], co = (x.collections || [])[0];
  return {src:'igdb', igdb:x.id, title:x.name, year:x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null,
    plats:[...new Set((x.platforms || []).map(p => IGDB_PLAT[typeof p === 'object' ? p.id : p]).filter(Boolean))],
    series:(fr && fr.name) || (co && co.name) || '', summary:x.summary || '', genres:(x.genres || []).map(g => g.name).filter(Boolean), igdbUrl:x.url || '',
    cover:x.cover && x.cover.image_id ? igdbImg(x.cover.image_id) : '', thumb:x.cover && x.cover.image_id ? igdbImg(x.cover.image_id, 'cover_small') : ''} }
async function igdbSearch(q){ const qq = q.replace(/["\\]/g, ' ').trim(); if(!qq) return [];
  let r; try{ r = await igdb(`search "${qq}"; fields ${IGDB_FIELDS}; where version_parent = null; limit 25;`) }
  catch(e){ if(e.status !== 400) throw e; LE('igdb', 'full query refused, trying a small one', e.text); r = await igdb(`search "${qq}"; fields name,first_release_date,cover.image_id,platforms,summary; limit 25;`) }
  return (r || []).map(fromIgdb) }
async function igdbById(id){ const r = await igdb(`fields ${IGDB_FIELDS}; where id = ${+id};`).catch(async e => { if(e.status !== 400) throw e; return igdb(`fields name,first_release_date,cover.image_id,platforms,summary; where id = ${+id};`) }); return r && r[0] ? fromIgdb(r[0]) : null }

/* Steam: a store search needs no key; your library and wishlist need your Steam Web API key + Steam ID (your profile must show its games) */
const steamCover = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
const steamWide = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
async function steamSearch(q){ const r = await net(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=NL`);
  return ((r && r.items) || []).filter(x => x.type === 'app' || !x.type).map(x => ({src:'steam', steam:x.id, title:x.name, plats:['pc'], cover:steamCover(x.id), cover2:steamWide(x.id), thumb:x.tiny_image || steamWide(x.id)})) }
async function steamId(){ const k = KEYS(), v = String(k.steamId || '').trim(); if(!v) throw new Error('Fill in your Steam ID or profile link first.');
  let m = v.match(/(\d{17})/); if(m) return m[1];
  m = v.match(/\/id\/([^/?#]+)/); const name = m ? m[1] : v;
  const r = await net(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(k.steamKey)}&vanityurl=${encodeURIComponent(name)}`);
  if(!r.response || !r.response.steamid) throw new Error(`Steam doesn't know the profile name “${name}”.`); return r.response.steamid }
async function steamOwned(){ const k = KEYS(); if(!k.steamKey) throw new Error('Fill in your Steam Web API key first.');
  const id = await steamId(), r = await net(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(k.steamKey)}&steamid=${id}&include_appinfo=1&include_played_free_games=1&format=json`);
  if(!r.response || !r.response.games) throw new Error('Steam gave no games. Is your profile and its “Game details” set to Public in Steam’s privacy settings?');
  return r.response.games.map(x => ({appid:x.appid, name:x.name})) }
async function steamWishlist(){ const id = await steamId(), k = KEYS().steamKey, r = await net(`https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${id}${k ? '&key=' + encodeURIComponent(k) : ''}`);
  return ((r.response || {}).items || []).map(x => x.appid) }
async function steamName(appid){ const r = await net(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic&l=english`), d = r && r[appid];
  return d && d.success && d.data ? d.data.name : null }

/* SteamGridDB: more covers (tall 600×900 'grids') */
async function sgdb(path){ const k = KEYS(); if(!k.sgdbKey) throw new Error('Add your SteamGridDB key: Settings → Online lookup.');
  const r = await net('https://www.steamgriddb.com/api/v2/' + path, {headers:{Authorization:'Bearer ' + k.sgdbKey}}); if(r && r.success === false) throw new Error((r.errors || []).join(', ') || 'SteamGridDB said no'); return r.data }
async function sgdbCovers(g){ let id = null;
  if(g.steam){ try{ const d = await sgdb('games/steam/' + g.steam); id = d && d.id }catch(e){} }
  if(!id){ const d = await sgdb('search/autocomplete/' + encodeURIComponent(g.title)); const hit = (d || []).find(x => norm(x.name) === norm(g.title)) || (d || [])[0]; id = hit && hit.id }
  if(!id) return [];
  const d = await sgdb(`grids/game/${id}?dimensions=600x900&types=static`); return (d || []).slice(0, 40).map(x => ({url:x.url, thumb:x.thumb || x.url})) }
const netMsg = e => e && e.noweb ? NOWEB : e && /answered 40[13]/.test(e.message) ? e.message + ' - check the key in Settings → Online lookup.' : (e && e.message) || String(e);

/* =====================================================================================================================
   LIBRARY
   ===================================================================================================================== */
let GAMES = [], GM = {};
async function loadLib(){ GAMES = await dbAll('games'); for(const g of GAMES){ g.copies = g.copies || []; g.genres = g.genres || []; g.plats = g.plats || [] }
  GM = Object.fromEntries(GAMES.map(g => [g.id, g])); for(const k of await dbKeys('covers')) COV.add(k); regroup() }
async function saveGame(g){ g.edited = Date.now(); if(!GM[g.id]){ GAMES.push(g); GM[g.id] = g } await dbPut('games', g); regroup() }
async function dropGame(g){ await dbDel('games', g.id).catch(() => {}); await dbDel('covers', g.id).catch(() => {}); COV.delete(g.id); GAMES = GAMES.filter(x => x !== g); delete GM[g.id]; regroup() }
function newGame(info){ return {id:'g' + uid(), title:info.title || 'Untitled', year:info.year || null, series:info.series || '', summary:info.summary || '', genres:info.genres || [],
  igdb:info.igdb || null, igdbUrl:info.igdbUrl || '', igdbCover:info.src === 'igdb' ? info.cover || '' : '', steam:info.steam || null, plats:info.plats || [],
  cover:info.steam ? steamCover(info.steam) : info.cover || '', cover2:info.steam ? (info.cover && info.src === 'igdb' ? info.cover : steamWide(info.steam)) : '', wish:false, wishPlats:[], copies:[], added:Date.now()} }
/* the same game already in your list? (same IGDB game, same Steam app, or the same name) */
const findSame = info => GAMES.find(g => (info.igdb && g.igdb === info.igdb) || (info.steam && g.steam === info.steam)) || GAMES.find(g => norm(g.title) === norm(info.title)) || null;
/* fill in what is missing from an IGDB result; what you typed yourself stays */
function applyInfo(g, x, over){ for(const k of ['year', 'series', 'summary', 'igdbUrl']) if(x[k] && (over || !g[k])) g[k] = x[k];
  if(x.genres && x.genres.length && (over || !g.genres.length)) g.genres = x.genres;
  if(x.plats && x.plats.length) g.plats = [...new Set(g.plats.concat(x.plats))];
  if(x.igdb) g.igdb = x.igdb; if(x.src === 'igdb' && x.cover){ g.igdbCover = x.cover; if(!g.cover) g.cover = x.cover; else if(g.steam && !g.cover2) g.cover2 = x.cover }
  if(x.steam && !g.steam){ g.steam = x.steam; if(!g.cover || g.cover === g.igdbCover){ g.cover2 = g.cover; g.cover = steamCover(x.steam) } }
  if(over && x.title) g.title = x.title }

/* =====================================================================================================================
   GROUPS – the shared way of every Nightvault app (../hub/nvgroups.js, plans/shared-groups.md), one engine per shelf.
   Automatic group = the series: IGDB's franchise (or collection), what you typed in Edit details, or a guess from the name
   ("Final Fantasy VII" + "Final Fantasy X" → Final Fantasy; "Halo 3" → Halo; "Mass Effect: Andromeda" → Mass Effect). A series needs 2+ games.
   ===================================================================================================================== */
const ROMAN_END = /\s+(?:[IVX]{1,5}|\d{1,3})(?:\s*[:\-–].*)?$/;
function guessSeries(t){ t = String(t || '').replace(/[™®©]/g, '').trim(); let m = t.match(/^(.{3,}?)\s*(?::|\s[-–]\s)/); if(m) return m[1].replace(ROMAN_END, '').trim();
  m = t.match(/^(.{3,}?)\s+(?:[IVX]{1,5}|\d{1,3})(?:\s|$)/); if(m && !/^(19|20)\d\d$/.test(t.slice(m[1].length).trim())) return m[1].trim(); return '' }
/* "Portal" itself joins the series that "Portal 2" makes */
let SNAMES = null;
const seriesNames = () => SNAMES || (SNAMES = new Set(GAMES.map(g => norm(g.series || guessSeries(g.title))).filter(Boolean)));
const seriesOf = g => g.series || (S.guess ? (guessSeries(g.title) || (seriesNames().has(norm(g.title)) ? g.title.replace(/[™®©]/g, '').trim() : '')) : '');
const GRS = {};
function grOf(sh){ if(GRS[sh]) return GRS[sh]; const s = shelfOf(sh);
  return GRS[sh] = NVGROUPS.make({prefix:'nvGames.' + sh, app:'games-' + sh, title:'Games · ' + s.name, itemsKey:'itemGroup', norm, key:g => g.id,
    hay:g => [g.title, g.series].filter(Boolean).join(' '), kinds:{series:'Series'},
    auto:g => { const x = seriesOf(g); return x ? {key:'s:' + norm(x), name:x, kind:'series'} : null },
    onRekey:async (from, to) => { const id = 'grp:' + sh + ':' + from; if(!COV.has(id)) return; const c = await dbGet('covers', id).catch(() => null); if(c){ await setCover('grp:' + sh + ':' + to, c.blob); draw() } }}) }
let GROUPCACHE = {};
const regroup = () => { GROUPCACHE = {}; SNAMES = null };
const groupsOf = sh => GROUPCACHE[sh] || (GROUPCACHE[sh] = grOf(sh).build(inShelf(sh)));
const toTop = (G, key) => G.setParent(key, null);
const grChange = (sh, fn, msg) => { const G = grOf(sh); G.change(fn); regroup(); G.undoToast(msg, () => { regroup(); selEnd(true); draw() }) };
const groupByKey = (sh, k) => groupsOf(sh).groups.find(g => g.key === k) || null;
const groupOfGame = (sh, g) => groupsOf(sh).groups.find(x => x.items.includes(g)) || null;

/* =====================================================================================================================
   COVERS – a picture address from IGDB / Steam / SteamGridDB, or your own picture (kept in the app, small WebP)
   ===================================================================================================================== */
async function thumb(blob){
  let bm; try{ bm = await createImageBitmap(blob) }catch(e){ const u = URL.createObjectURL(blob); try{ const im = new Image(); im.src = u; await im.decode(); bm = im }finally{ setTimeout(() => URL.revokeObjectURL(u), 1000) } }
  const w = Math.min(500, bm.width), h = Math.round(bm.height * w / bm.width), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h); if(bm.close) bm.close();
  return new Promise(ok => c.toBlob(b => ok(b), 'image/webp', .85)) }
const COV = new Set(), COVURL = {};
async function coverUrl(id){ if(!COV.has(id)) return null; if(COVURL[id]) return COVURL[id]; const c = await dbGet('covers', id).catch(() => null); if(!c){ COV.delete(id); return null } return COVURL[id] = URL.createObjectURL(c.blob) }
async function setCover(id, blob){ await dbPut('covers', {id, blob}); COV.add(id); if(COVURL[id]){ URL.revokeObjectURL(COVURL[id]); delete COVURL[id] } }
async function dropCover(id){ await dbDel('covers', id).catch(() => {}); COV.delete(id); if(COVURL[id]){ URL.revokeObjectURL(COVURL[id]); delete COVURL[id] } }
const hasCover = g => COV.has(g.id) || !!g.cover;
const covIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ covIO.unobserve(e.target); fillCov(e.target) } }, {rootMargin:'300px'}) : null;
function phHTML(g, label){ const h = hue(seriesOf(g) || g.title || ''), c = g.copies && g.copies[0];
  return `<div class="ph" style="--c1:hsl(${h} 45% 28%);--c2:hsl(${(h + 40) % 360} 40% 14%)"><i>${esc(c ? platOf(c.plat).short : '')}</i>${esc(label || g.title)}<span>${esc(g.year || '')}</span></div>` }
function coverHTML(g, cls, extra){ return `<div class="cv ${cls || ''}" data-cov="${esc(g.id)}">${phHTML(g)}${extra || ''}</div>` }
/* fills a cover box: your own picture, else the picture address (Steam's tall picture can be missing for old games → its wide one / IGDB's) */
async function fillCov(el){ const id = el.dataset.cov, g = GM[id], own = await coverUrl(id);
  const cand = [...new Set([own, g && g.cover, g && g.cover2, g && g.igdbCover].filter(Boolean))]; if(!cand.length) return;
  el.querySelectorAll('img').forEach(i => i.remove());
  el.insertAdjacentHTML('afterbegin', `<img class="b" alt="" referrerpolicy="no-referrer"><img class="f" alt="" referrerpolicy="no-referrer">`);
  const [b, f] = el.querySelectorAll('img'); let i = 0; const set = src => { b.src = src; f.src = src };
  f.onload = () => { const ph = el.querySelector('.ph'); if(ph) ph.style.display = 'none' };
  f.onerror = () => { if(++i < cand.length) set(cand[i]); else { b.remove(); f.remove() } };   // Steam's tall picture is missing for some games → the next picture
  set(cand[0]) }
function lazyCovers(root){ (root || document).querySelectorAll('[data-cov]').forEach(el => { const id = el.dataset.cov; if(!COV.has(id) && !(GM[id] && GM[id].cover)) return; covIO ? covIO.observe(el) : fillCov(el) }) }
const RNDCOV = {};
const byTitle = (a, b) => coll.compare(norm(a.title), norm(b.title));
const seriesOrder = (a, b) => (a.year || 9999) - (b.year || 9999) || byTitle(a, b);
function groupCoverHTML(sh, g){ const G = grOf(sh), c = G.cover(g.key), all = (g.all || g.items).slice().sort(seriesOrder), wc = all.filter(hasCover);
  if(c.t === 'pic' && COV.has('grp:' + sh + ':' + g.key)) return `<div class="cv" data-cov="grp:${esc(sh)}:${esc(g.key)}">${phHTML({title:g.name}, g.name)}</div>`;
  let x = null; if(c.t === 'item') x = all.find(y => y.id === c.al);
  if(c.t === 'random' && wc.length){ x = wc.find(y => y.id === RNDCOV[g.key]) || wc[Math.floor(Math.random() * wc.length)]; RNDCOV[g.key] = x.id }
  x = x || wc[0] || all[0]; if(!x) return `<div class="cv">${phHTML({title:g.name}, g.name)}</div>`;
  const h = coverHTML(x); return c.t === 'cycle' && wc.length > 1 ? h.replace('<div class="cv ', `<div data-cycle="${esc(sh)}|${esc(g.key)}" class="cv `) : h }
const CYCI = {};
setInterval(() => { if(document.hidden) return;
  for(const el of document.querySelectorAll('#body [data-cycle]')){ const r = el.getBoundingClientRect(); if(r.bottom < 0 || r.top > innerHeight) continue;
    const [sh, k] = el.dataset.cycle.split('|'), g = groupByKey(sh, k); if(!g) continue; const wc = g.all.filter(hasCover).sort(seriesOrder); if(wc.length < 2) continue;
    CYCI[k] = ((CYCI[k] || 0) + 1) % wc.length; el.style.transition = 'opacity .45s'; el.style.opacity = 0;
    setTimeout(() => { el.dataset.cov = wc[CYCI[k]].id; fillCov(el).then(() => el.style.opacity = 1) }, 450) } }, 4000);

/* ---------- tiles ---------- */
/* small marks on a tile: on a platform shelf where you have it (Steam, GOG, CIB PAL …); on All games which platforms */
function marks(g, sh){ let l;
  if(sh === 'wish') l = (g.wishPlats || []).map(p => ({t:platOf(p).short}));
  else if(sh === 'all') l = [...new Set(g.copies.map(c => c.plat))].map(p => ({t:platOf(p).short}));
  else l = g.copies.filter(c => c.plat === sh).map(c => ({t:copyShort(c), p:c.kind === 'physical'}));
  const seen = new Set(); l = l.filter(x => !seen.has(x.t) && seen.add(x.t));
  if(typeof canPlay === 'function' && canPlay(g)) l.unshift({t:'▶'});   // you can start it (a backup file or a Steam game)
  return l.length ? `<span class="vol">${l.slice(0, 3).map(x => `<span${x.p ? ' class="ph2"' : ''}>${esc(x.t)}</span>`).join('')}${l.length > 3 ? `<span>+${l.length - 3}</span>` : ''}</span>` : '' }
function gameTile(g, sh){ const G = grOf(sh);
  return `<div class="bk" data-game="${esc(g.id)}">${coverHTML(g, '', (G.isPinned('it:' + g.id) ? PINB : '') + (g.wish && sh !== 'wish' ? '<span class="wish">WISH</span>' : '') + marks(g, sh))}
    <div class="t">${esc(g.title)}</div><div class="a">${esc([g.year, sh === 'all' || sh === 'wish' ? '' : (g.copies.filter(c => c.plat !== sh).length ? 'also ' + [...new Set(g.copies.filter(c => c.plat !== sh).map(c => platOf(c.plat).short))].join(', ') : '')].filter(Boolean).join(' · ') || ' ')}</div></div>` }
function groupTile(sh, g){ const all = g.all || g.items, k = (g.kids || []).length, G = grOf(sh);
  return `<div class="bk stack" data-grp="${esc(g.key)}">${groupCoverHTML(sh, g)}${G.isPinned('gr:' + g.key) ? PINB : ''}<span class="cdl">${k ? plural(k, 'group') + ' · ' : ''}${all.length ? plural(all.length, 'game') : 'empty'}</span>
    <div class="t">${esc(g.name)}</div><div class="a">${esc(G.label(g))}</div></div>` }

/* =====================================================================================================================
   SCREENS – a stack of views: shelves → shelf → group → game
   ===================================================================================================================== */
let V = [{v:'shelves'}];
const cur = () => V[V.length - 1];
function go(v){ selEnd(true); V.push(v); draw(); scrollTo(0, 0) }
function back(){ if(SEL){ selEnd(); return true } if(V.length > 1){ V.pop(); draw(); return true } return false }
$('#vback').onclick = () => back();
const Q = {};
/* sort menus: the same small menu on every page, each page remembers its own choice */
const SORTS = {shelf:[['series', 'Series & title'], ['title', 'Title'], ['added', 'Recently added'], ['new', 'Newest games'], ['old', 'Oldest games']],
  inside:[['series', 'Series order (by year)'], ['title', 'Title'], ['added', 'Recently added'], ['new', 'Newest games']]};
const sortOf = (page, key) => S.sort[key || page] || SORTS[page][0][0];
const sortSel = (page, key) => `<select data-sort="${page}" data-skey="${esc(key || page)}" aria-label="Sort">${SORTS[page].map(([k, t]) => `<option value="${k}" ${sortOf(page, key) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const addedAt = x => x.items ? Math.max(0, ...(x.all || x.items).map(g => g.added || 0)) : x.added || 0;
const yearOf = (x, newest) => x.items ? (newest ? Math.max(0, ...(x.all || x.items).map(g => g.year || 0)) : Math.min(9999, ...(x.all || x.items).map(g => g.year || 9999))) : (x.year || (newest ? 0 : 9999));
const nameOf = x => x.items ? x.name : (seriesOf(x) ? seriesOf(x) + ' ' + x.title : x.title);
function sortTiles(list, k){ return list.slice().sort(k === 'title' ? (a, b) => coll.compare(norm(a.items ? a.name : a.title), norm(b.items ? b.name : b.title))
  : k === 'added' ? (a, b) => addedAt(b) - addedAt(a) : k === 'new' ? (a, b) => yearOf(b, true) - yearOf(a, true) || coll.compare(norm(nameOf(a)), norm(nameOf(b)))
  : k === 'old' ? (a, b) => yearOf(a) - yearOf(b) || coll.compare(norm(nameOf(a)), norm(nameOf(b)))
  : (a, b) => coll.compare(norm(nameOf(a)), norm(nameOf(b)))) }
const FILTERS = [['all', 'All'], ['physical', 'Physical'], ['digital', 'Digital']];
const passFilter = (g, f, sh) => { if(f === 'all' || sh === 'wish') return true; const cs = sh === 'all' ? g.copies : g.copies.filter(c => c.plat === sh); return cs.some(c => c.kind === f) };
const hayOf = g => norm([g.title, g.series, guessSeries(g.title), g.year, (g.genres || []).join(' '), g.copies.map(c => platOf(c.plat).name + ' ' + platOf(c.plat).short + ' ' + copyText(c)).join(' ')].join(' '));

/* square system tile: up to 4 covers of its newest games behind the system's name (text only, no logos), number of games in the corner */
function sysTile(s){ const gs = inShelf(s.id), n = gs.length, ph = s.id === 'wish' ? 0 : gs.filter(g => g.copies.some(c => c.kind === 'physical' && (s.id === 'all' || c.plat === s.id))).length;
  const cov = gs.filter(hasCover).sort((a, b) => b.added - a.added).slice(0, 4), lbl = s.short || '', fs = lbl.length > 9 ? 13 : lbl.length > 7 ? 15 : lbl.length > 5 ? 18 : lbl.length > 3 ? 22 : 27;
  return `<div class="bk st${n ? '' : ' off'}" data-shelf="${esc(s.id)}"><div class="sq" style="background:linear-gradient(150deg,${s.c[0]},${s.c[1]})">
    ${cov.length ? `<div class="mos m${cov.length}">${cov.map(g => `<img data-fan="${esc(g.id)}" alt="" referrerpolicy="no-referrer">`).join('')}</div>` : ''}
    <div class="sqi">${shelfIcon(s, lbl ? 20 : 34)}</div>${lbl ? `<div class="sqn" style="color:${s.s};font-size:${fs}px">${esc(lbl)}</div>` : ''}${n ? `<span class="cdl">${n}</span>` : ''}</div>
    <div class="t">${esc(s.name)}</div><div class="a">${n ? plural(n, 'game') + (ph ? ` · ${ph} physical` : '') : 'empty'}</div></div>` }
function draw(){
  const v = cur(), body = $('#body'); $('#vback').hidden = V.length < 2; $('#addbtn').hidden = v.v === 'game';
  $('#hubback').hidden = !(fromHub() && V.length < 2);
  let h = '';
  if(v.v === 'shelves'){ $('#vtitle').textContent = 'Games'; document.title = 'Nightvault Games';
    const q = norm(Q._all || '');
    h += `<input type="search" id="q" placeholder="Search all your games" value="${esc(Q._all || '')}" style="margin:2px 0 8px">`;
    if(q){ const hits = GAMES.filter(g => hayOf(g).includes(q)).sort(byTitle);
      h += hits.length ? `<div class="mtot">${plural(hits.length, 'game')}</div><div class="grid">${hits.slice(0, 300).map(g => gameTile(g, owned(g) ? 'all' : 'wish')).join('')}</div>` : '<p class="muted" style="text-align:center;margin-top:30px">Nothing found. Tap <b>Add</b> to add it.</p>';
      body.innerHTML = h; lazyCovers(body); hookSearch('_all'); hookGrid(null); return }
    /* a square tile for every game system and handheld (like the album tiles in Music), in sections; systems without games are dimmed */
    const withGames = S.sysAll === false;
    h += `<div class="chips"><button class="chip ${!withGames ? 'on' : ''}" data-sysall="1">All systems</button><button class="chip ${withGames ? 'on' : ''}" data-sysall="0">Only systems with games</button></div>`;
    const shown = shelves(), cnt = {}; for(const x of shown) cnt[x.id] = inShelf(x.id).length;
    if(withGames) h += `<div class="grid sys">${SECS.flatMap(([sec]) => shown.filter(x => x.sec === sec && (cnt[x.id] || sec === 'list'))).map(sysTile).join('')}</div>`;   // just your systems, together
    else for(const [sec, title] of SECS){ const l = shown.filter(x => x.sec === sec); if(!l.length) continue;
      h += `${sec === 'list' ? '' : `<div class="sec">${esc(title)}</div>`}<div class="grid sys">${l.map(sysTile).join('')}</div>` }
    if(!GAMES.length) h = h.replace('<div class="chips">', () => `<div class="empty" style="margin:4px 0 14px">${shelfIcon({s:'#a9b4ff', icon:'pad'}, 48)}<h2 style="margin:8px 0 4px;font-size:18px">No games yet</h2>
      <p class="muted small" style="margin:0 0 14px">Tap <b>Add</b> to search a game by name, or bring in your Steam library. Or tap a system below and add its games there.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" id="emptyadd">Add a game</button><button class="btn" id="emptysteam">Import from Steam</button></div>
      ${hasIgdb() ? '' : '<p class="muted small" style="margin:12px 0 0">Tip: add your free IGDB key in Settings (⚙ → Online lookup) to find every game with its cover and series.</p>'}</div>` + '<div class="chips">');
    h += storeLine();
    body.innerHTML = h; hookSearch('_all');
    body.querySelectorAll('[data-sysall]').forEach(b => b.onclick = () => { S.sysAll = b.dataset.sysall === '1'; saveS(); draw() });
    body.querySelectorAll('[data-fan]').forEach(async im => { const g = GM[im.dataset.fan], u = await coverUrl(g.id) || g.cover; im.onerror = () => { if(g.cover2 && im.src !== g.cover2) im.src = g.cover2; else im.remove() }; im.src = u });
    if($('#emptyadd')) $('#emptyadd').onclick = () => addSheet(); if($('#emptysteam')) $('#emptysteam').onclick = () => keysSheet(true);
    return }
  if(v.v === 'shelf'){ const s = shelfOf(v.shelf), all = inShelf(s.id), q = norm(Q[s.id] || ''), f = S.filter[s.id] || 'all', G = grOf(s.id);
    $('#vtitle').textContent = s.name; document.title = s.name + ' · Games';
    if(!all.length){ body.innerHTML = `<div class="empty">${shelfIcon(s, 48)}<h2 style="margin:8px 0 4px;font-size:18px">${s.id === 'wish' ? 'Your wishlist is empty' : 'No games here yet'}</h2><p class="muted small" style="margin:0 0 14px">${s.id === 'wish' ? 'Tap <b>Add</b>, find a game and choose <b>On my wishlist</b>.' : 'Tap <b>Add</b> and search a game by name.'}</p><button class="btn primary" id="emptyadd">Add a game</button></div>`; $('#emptyadd').onclick = () => addSheet(); return }
    h += `<input type="search" id="q" placeholder="Search ${esc(s.name.toLowerCase())}, series, genres" value="${esc(Q[s.id] || '')}" style="margin:2px 0 8px">`;
    if(q){ const {groups:gs} = groupsOf(s.id), where = {}; for(const g of gs) for(const x of g.items) where[x.id] = G.path(g, gs);
      const gm = gs.filter(g => norm(g.name).includes(q)).slice(0, 12), bm = all.filter(g => hayOf(g).includes(q)).sort(byTitle);
      if(!gm.length && !bm.length) h += '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
      if(gm.length) h += `<div class="sec">Groups</div><div class="grid">${gm.map(g => groupTile(s.id, g).replace(/<div class="a">[^<]*<\/div>/, g.parent ? `<div class="a">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : '$&')).join('')}</div>`;
      if(bm.length) h += `<div class="sec">Games</div><div class="grid">${bm.slice(0, 300).map(g => gameTile(g, s.id).replace(/<div class="a">[^<]*<\/div>/, where[g.id] ? `<div class="a">in ${esc(where[g.id])}</div>` : '$&')).join('')}</div>` }
    else { if(s.id !== 'wish') h += `<div class="chips">${FILTERS.map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${t}</button>`).join('')}${s.plat ? `<span style="flex:1"></span><button class="chip" data-howplay="${esc(s.id)}">▶ How to play</button>` : ''}</div>`;
      const grouped = S.grouped[s.id] !== false;
      h += `<div class="mbar"><select id="grouped" aria-label="Groups"><option value="1" ${grouped ? 'selected' : ''}>Grouped</option><option value="0" ${!grouped ? 'selected' : ''}>All games</option></select>${sortSel('shelf', 'shelf:' + s.id)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button><button class="btn sm" id="newgrp">+ Group</button></div>`;
      const vis = all.filter(g => passFilter(g, f, s.id)), k = sortOf('shelf', 'shelf:' + s.id), ph = all.filter(g => passFilter(g, 'physical', s.id)).length;
      h += `<div class="mtot">${plural(vis.length, 'game')}${f === 'all' && s.id !== 'wish' && ph ? ` · ${ph} physical · ${all.length - ph} only digital` : ''}</div>`;
      let tiles;
      if(!grouped || (f !== 'all' && s.id !== 'wish')) tiles = sortTiles(vis, k);
      else { const {groups, singles} = groupsOf(s.id); tiles = sortTiles([...groups.filter(g => !g.parent), ...singles], k) }
      tiles = G.pinFirst(tiles, x => (x.items ? 'gr:' + x.key : 'it:' + x.id));
      h += `<div class="grid">${tiles.map(x => x.items ? groupTile(s.id, x) : gameTile(x, s.id)).join('')}</div>` }
    h += storeLine(s.id);
    body.innerHTML = h; lazyCovers(body); hookSearch(s.id); hookGrid(s.id); return }
  if(v.v === 'group'){ const G = grOf(v.shelf), g = groupByKey(v.shelf, v.key); if(!g){ V.pop(); return draw() }
    const gs = groupsOf(v.shelf).groups, all = g.all, ys = all.map(x => x.year).filter(Boolean), sk = 'grp:' + v.shelf + ':' + g.key;
    $('#vtitle').textContent = ''; document.title = g.name + ' · Games';
    h += `<div class="alhead"><div class="stack" style="flex:none"><div class="gcv" style="width:min(30vw,130px)">${groupCoverHTML(v.shelf, g)}</div></div><div style="min-width:0;flex:1"><b>${esc(g.name)}</b>
      ${g.parent ? `<div class="lnk small" data-gotogrp="${esc(g.parent)}">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : ''}
      <div class="muted small">${esc(G.label(g))} · ${(g.kids || []).length ? plural(g.kids.length, 'group') + ' · ' : ''}${plural(all.length, 'game')}${ys.length ? ` · ${Math.min(...ys)}${Math.max(...ys) > Math.min(...ys) ? '–' + Math.max(...ys) : ''}` : ''}</div>
      <div class="muted small">${esc(shelfOf(v.shelf).name)}</div></div><button class="ib" id="gmenu" aria-label="More for this group">${IC_DOTS}</button></div>`;
    h += `<div class="mbar">${sortSel('inside', sk)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button></div>`;
    const k = sortOf('inside', sk), kids = sortTiles(g.kids || [], k === 'series' ? 'old' : k), items = k === 'series' ? g.items.slice().sort(seriesOrder) : sortTiles(g.items, k);
    h += `<div class="grid">${G.pinFirst([...kids, ...items], x => (x.items ? 'gr:' + x.key : 'it:' + x.id)).map(x => x.items ? groupTile(v.shelf, x) : gameTile(x, v.shelf)).join('')}</div>`;
    if(!all.length) h += `<p class="muted small" style="margin-top:12px">Empty. Tap ⋯ → <b>Add games…</b> to put games in it.</p>`;
    body.innerHTML = h; lazyCovers(body); hookGrid(v.shelf); $('#gmenu').onclick = () => groupMenu(v.shelf, g); return }
  if(v.v === 'game') return drawGame(v.id, v.shelf) }
function storeLine(sh){ const gs = sh ? inShelf(sh) : GAMES; if(!gs.length) return '';
  const o = gs.filter(owned), cps = o.reduce((a, g) => a + (sh && sh !== 'all' && sh !== 'wish' ? g.copies.filter(c => c.plat === sh).length : g.copies.length), 0), w = sh ? 0 : GAMES.filter(g => g.wish).length;
  return `<div class="store">${plural(gs.length, 'game')}${cps > o.length ? ` · ${plural(cps, 'copy', 'copies')}` : ''}${w ? ` · ${w} on your wishlist` : ''}</div>` }

/* clicks on the screens */
$('#body').addEventListener('click', e => {
  if(selSkip){ selSkip = false; return }
  const t = e.target, el = t.closest('[data-shelf],[data-game],[data-grp],[data-filter],[data-selstart],[data-gotogrp],#newgrp');
  if(!el) return; const v = cur();
  if(SEL && el.closest('.grid') && (el.dataset.game || el.dataset.grp)){ const id = el.dataset.game ? 'it:' + el.dataset.game : 'gr:' + el.dataset.grp; SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw(); return }
  if(el.id === 'newgrp') return newGroup(v.shelf);
  if(el.dataset.shelf) return go({v:'shelf', shelf:el.dataset.shelf});
  if(el.dataset.game) return go({v:'game', id:el.dataset.game, shelf:v.shelf || (owned(GM[el.dataset.game] || {copies:[]}) ? 'all' : 'wish')});
  if(el.dataset.grp) return go({v:'group', shelf:v.shelf, key:el.dataset.grp});
  if(el.dataset.gotogrp){ V.pop(); if(cur().v !== 'group' || cur().key !== el.dataset.gotogrp) V.push({v:'group', shelf:v.shelf, key:el.dataset.gotogrp}); return draw() }
  if(el.dataset.filter){ S.filter[v.shelf] = el.dataset.filter; saveS(); return draw() }
  if(el.dataset.selstart) return selStart() });
$('#body').addEventListener('click', e => { const b = e.target.closest('[data-howplay]'); if(b) howToPlay(b.dataset.howplay) });
$('#body').addEventListener('change', e => { const t = e.target, v = cur();
  if(t.dataset.sort){ S.sort[t.dataset.skey] = t.value; saveS(); draw() }
  if(t.id === 'grouped'){ S.grouped[v.shelf] = t.value === '1'; saveS(); draw() } });
function hookSearch(k){ const q = $('#q'); if(!q) return; q.oninput = () => { Q[k] = q.value; clearTimeout(q._t); q._t = setTimeout(() => { const p = q.selectionStart; draw(); const n = $('#q'); if(n){ n.focus(); try{ n.setSelectionRange(p, p) }catch(e){} } }, 250) } }
/* long-press a tile: select it (then tap more tiles) */
let SEL = null, selSkip = false;
function hookGrid(sh){ if(!sh) return; document.querySelectorAll('#body .grid').forEach(gr => {
  let tmr = null, sx = 0, sy = 0;
  gr.onpointerdown = e => { const el = e.target.closest('.bk'); if(!el) return; sx = e.clientX; sy = e.clientY; clearTimeout(tmr);
    tmr = setTimeout(() => { const id = el.dataset.game ? 'it:' + el.dataset.game : el.dataset.grp ? 'gr:' + el.dataset.grp : null; if(!id) return; selSkip = true; if(!SEL) selStart(id); else { SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw() } try{ navigator.vibrate && navigator.vibrate(20) }catch(e){} }, 520) };
  gr.onpointermove = e => { if(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(tmr) };
  gr.onpointerup = gr.onpointercancel = () => clearTimeout(tmr);
  gr.oncontextmenu = e => { if(e.target.closest('.bk')) e.preventDefault() } }) }

/* ---------- the game page ---------- */
function drawGame(id, sh){ const g = GM[id]; if(!g){ V.pop(); return draw() }
  sh = sh || (owned(g) ? 'all' : 'wish'); const grp = groupOfGame(sh, g);
  $('#vtitle').textContent = ''; document.title = g.title + ' · Games';
  const ser = seriesOf(g), pl = [...new Set(g.copies.map(c => c.plat))];
  let h = `<div class="alhead" style="align-items:flex-start">${coverHTML(g)}<div style="min-width:0;flex:1"><b>${esc(g.title)}</b>
    ${ser ? `<div class="${grp ? 'lnk' : 'muted'} small" data-gotogrp2="1">${esc(grp ? grp.name : ser)}</div>` : ''}<div class="muted small">${esc([g.year, g.genres.slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</div>
    <div style="margin-top:8px">${pl.map(p => `<span class="tag">${esc(platOf(p).short)}</span>`).join('')}${g.wish ? '<span class="tag" style="color:#ff9db7">♥ Wishlist</span>' : ''}</div></div></div>
    ${playRowHTML(g)}<div class="mbar"><button class="btn ${canPlay(g) ? '' : 'primary'}" id="gaddcopy" style="flex:1">${owned(g) ? '+ Add a copy' : g.wish ? 'I got it' : '+ Add a copy'}</button><button class="ib" id="gmenu2" aria-label="More for this game">${IC_DOTS}</button></div>`;
  h += `<div class="sec">${owned(g) ? 'Your copies' : 'You don’t own it yet'}</div>`;
  h += g.copies.length ? g.copies.map(c => { const p = platOf(c.plat), f = FAM[p.fam] || FAM.other;
      return `<div class="copy" data-copy="${esc(c.id)}"><span class="pl" style="background:linear-gradient(150deg,${f.c[0]},${f.c[1]});color:${f.s}">${esc(p.short)}</span><div class="n"><div>${esc(p.name)}</div><div class="s">${esc(copyText(c))}</div>${romTags(c) ? `<div>${romTags(c)}</div>` : ''}</div><span class="muted small">Edit</span></div>` }).join('')
    : `<p class="muted small">${g.wish ? `On your wishlist${g.wishPlats.length ? ' for ' + g.wishPlats.map(p => platOf(p).name).join(', ') : ''}. Tap <b>I got it</b> when you have it.` : 'No copies.'}</p>`;
  if(g.summary) h += `<div class="sec">About</div><div class="desc clip" id="gdesc">${esc(g.summary)}</div>${g.summary.length > 300 ? '<button class="btn sm" id="gmore" style="margin-top:6px">More</button>' : ''}`;
  const facts = [['Series', esc(ser) + (g.series ? '' : ser ? ' <span class="muted">(guessed from the name)</span>' : '')], ['Released', esc(g.year || '')], ['Genres', esc(g.genres.join(', '))],
    ['Also on', esc(g.plats.filter(p => !pl.includes(p)).map(p => platOf(p).short).join(', '))],
    ['Links', [g.steam ? `<a href="https://store.steampowered.com/app/${g.steam}/" target="_blank" rel="noopener">Steam store</a>` : '', g.igdbUrl ? `<a href="${esc(g.igdbUrl)}" target="_blank" rel="noopener">IGDB</a>` : ''].filter(Boolean).join(' · ')],
    ['Added', new Date(g.added).toLocaleDateString()]].filter(x => x[1]);
  h += `<div class="sec">Details</div><div class="facts">${facts.map(([k, v]) => `<span>${k}</span><span style="min-width:0;overflow-wrap:anywhere">${v}</span>`).join('')}</div>`;
  if(!g.igdb && hasIgdb()) h += `<button class="btn sm" id="glook">Look up details online (IGDB)</button>`;
  $('#body').innerHTML = h; lazyCovers($('#body'));
  $('#gmenu2').onclick = () => gameMenu(g, sh); hookPlay(g);
  $('#gaddcopy').onclick = () => copySheet(g, null, {plat:sh !== 'all' && sh !== 'wish' ? sh : (g.wishPlats[0] || null)});
  if($('#gmore')) $('#gmore').onclick = () => { $('#gdesc').classList.remove('clip'); $('#gmore').remove() };
  if($('#glook')) $('#glook').onclick = () => lookupSheet(g);
  document.querySelectorAll('[data-copy]').forEach(el => el.onclick = () => copySheet(g, g.copies.find(c => c.id === el.dataset.copy)));
  document.querySelectorAll('[data-gotogrp2]').forEach(el => el.onclick = () => { if(grp) go({v:'group', shelf:sh, key:grp.key}) }) }

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
   ADDING A GAME: search by name (your own list, IGDB with your key, else the Steam store), or type it in by hand
   ===================================================================================================================== */
function addSheet(){ const v = cur(), ctx = {plat:v.shelf && v.shelf !== 'all' && v.shelf !== 'wish' ? v.shelf : null, wish:v.shelf === 'wish'};
  sheet(`<h3>Add a game${ctx.plat ? ' · ' + esc(platOf(ctx.plat).name) : ctx.wish ? ' to your wishlist' : ''}</h3>
    <div style="display:flex;gap:8px"><input type="search" id="adq" placeholder="Name of the game" autocomplete="off" enterkeyhint="search"><button class="btn primary" id="adgo">Search</button></div>
    <p class="muted small" style="margin:6px 2px 0">${hasIgdb() ? 'Searches IGDB (every platform, with covers).' : NATIVE ? 'Searches the Steam store. For console and retro games add your free IGDB key: ⚙ → Online lookup.' : 'On the website you add games by hand. The Android app can search IGDB and Steam.'}</p>
    <div id="adres" style="margin-top:8px"></div>
    <div class="mlist" style="margin-top:10px"><button class="btn" id="adsteam">Import my Steam library</button></div>`, true);
  setTimeout(() => $('#adq').focus(), 60);
  let tok = 0;
  const run = async () => { const q = $('#adq').value.trim(), el = $('#adres'); if(!q) return; const me = ++tok;
    const mine = GAMES.filter(g => norm(g.title).includes(norm(q))).sort(byTitle).slice(0, 6);
    let h = mine.length ? `<div class="sec" style="margin-top:6px">Already in your games</div>${mine.map(g => `<div class="li" data-mine="${esc(g.id)}"><span class="th">${coverHTML(g)}</span><div class="n"><div>${esc(g.title)}</div><div class="s">${esc(g.copies.map(c => platOf(c.plat).short + ' ' + copyShort(c)).join(' · ') || (g.wish ? 'Wishlist' : ''))}</div></div><span class="r">+ copy</span></div>`).join('')}` : '';
    const hand = `<div class="li" data-hand="1"><span class="th"><div class="cv">${phHTML({title:q})}</div></span><div class="n"><div>Add “${esc(q)}” by hand</div><div class="s">Name only – you can add a picture later</div></div></div>`;
    el.innerHTML = h + `<div class="sec">Online</div><div class="prog busy"><i></i></div>` + hand; lazyCovers(el);
    let res = [], err = '';
    try{ res = hasIgdb() ? await igdbSearch(q) : await steamSearch(q) }catch(e){ err = netMsg(e); LE('search', q, e) }
    if(me !== tok) return;
    if(ctx.plat) res.sort((a, b) => (b.plats.includes(ctx.plat) ? 1 : 0) - (a.plats.includes(ctx.plat) ? 1 : 0));
    window._ADRES = res;
    h += `<div class="sec">${hasIgdb() ? 'IGDB' : 'Steam store'}</div>` + (err ? `<p class="note bad">${esc(err)}</p>` : res.length ? res.map((x, i) => `<div class="li" data-res="${i}"><span class="th"><div class="cv">${x.thumb ? `<img class="f" src="${esc(x.thumb)}" alt="" referrerpolicy="no-referrer" style="object-fit:cover">` : phHTML(x)}</div></span><div class="n"><div>${esc(x.title)}</div><div class="s">${esc([x.year, x.plats.slice(0, 6).map(p => platOf(p).short).join(', ')].filter(Boolean).join(' · '))}</div></div>${findSame(x) ? '<span class="r">in your list</span>' : ''}</div>`).join('') : '<p class="muted small">Nothing found online.</p>');
    el.innerHTML = h + `<div class="sec">Not there?</div>` + hand; lazyCovers(el) };
  $('#adgo').onclick = run; $('#adq').onkeydown = e => { if(e.key === 'Enter') run() };
  $('#adsteam').onclick = () => keysSheet(true);
  $('#adres').onclick = e => { const m = e.target.closest('[data-mine]'), r = e.target.closest('[data-res]'), hd = e.target.closest('[data-hand]');
    if(m){ const g = GM[m.dataset.mine]; return copySheet(g, null, ctx) }
    if(r){ const x = window._ADRES[+r.dataset.res], same = findSame(x); return pickedSheet(x, same, ctx) }
    if(hd) return pickedSheet({src:'hand', title:$('#adq').value.trim(), plats:[]}, findSame({title:$('#adq').value.trim()}), ctx) } }
/* after picking a result: own it (→ which copy) or put it on the wishlist */
function pickedSheet(x, same, ctx){
  sheet(`<h3>${esc(x.title)}</h3>${same ? `<p class="note">You already have this game${same.copies.length ? ' (' + esc(same.copies.map(c => platOf(c.plat).short + ' ' + copyShort(c)).join(', ')) + ')' : same.wish ? ' on your wishlist' : ''}. A new copy goes into the same tile.</p>` : ''}
    <div class="mlist"><button class="btn primary" id="pkown">I have it</button><button class="btn" id="pkwish">${same && same.wish ? 'It is on my wishlist already' : 'On my wishlist'}</button></div>`, true);
  const make = () => { if(same){ if(x.src === 'igdb' && !same.igdb){ applyInfo(same, x) } return same } const g = newGame(x); return g };
  $('#pkown').onclick = () => copySheet(make(), null, Object.assign({}, ctx, {suggest:x.plats}));
  $('#pkwish').onclick = () => { const g = make(); if(same && same.wish){ closeSheet(); return }
    wishSheet(g, x.plats, ctx) } }
function wishSheet(g, suggest, ctx){ const pick = new Set(g.wishPlats.length ? g.wishPlats : ctx && ctx.plat ? [ctx.plat] : []), cand = [...new Set((suggest || []).concat(g.plats, ctx && ctx.plat ? [ctx.plat] : []))];
  sheet(`<h3>${esc(g.title)} · wishlist</h3><p class="muted small" style="margin:0 0 6px">For which platform? (Optional - pick none for “any”.)</p>
    <div class="chips" id="wpl">${(cand.length ? cand : ['pc', 'ps5', 'switch', 'xsx']).map(p => `<button class="chip ${pick.has(p) ? 'on' : ''}" data-wp="${esc(p)}">${esc(platOf(p).short)}</button>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="wsave">Put on my wishlist</button></div>`, true);
  $('#wpl').onclick = e => { const b = e.target.closest('[data-wp]'); if(!b) return; pick.has(b.dataset.wp) ? pick.delete(b.dataset.wp) : pick.add(b.dataset.wp); b.classList.toggle('on') };
  $('#wsave').onclick = async () => { g.wish = true; g.wishPlats = [...pick]; await saveGame(g); closeSheet(); draw(); toast(`“${g.title}” is on your wishlist`) } }

/* ---------- a copy: platform, digital (which store) or physical (what's included + region) ---------- */
function copySheet(g, c, ctx, draft){ ctx = ctx || {}; const isNew = !c;
  const d = draft ? draft : c ? Object.assign({}, c) : {id:'c' + uid(), plat:ctx.plat || (ctx.suggest || g.plats || []).find(p => PLATS.some(q => q.id === p)) || (g.wishPlats || [])[0] || null, kind:'digital', store:'', box:'cib', region:'PAL', added:Date.now()};
  if(isNew && d.plat && !d.store) d.store = storesFor(d.plat)[0];
  const sugg = [...new Set([].concat(ctx.suggest || [], g.plats || [], g.wishPlats || [], g.copies.map(x => x.plat), d.plat ? [d.plat] : []))].filter(Boolean);
  const drawC = () => { const el = $('#cpbody'); if(!el) return;
    const chipsP = (sugg.length ? sugg : ['pc', 'ps5', 'ps4', 'switch', 'xsx']).map(p => `<button class="chip ${d.plat === p ? 'on' : ''}" data-cp="${esc(p)}">${esc(platOf(p).short)}</button>`).join('');
    el.innerHTML = `<div class="sec" style="margin-top:4px">Platform</div><div class="chips">${chipsP}</div>
      <select id="cpall" style="width:100%;height:40px"><option value="">${d.plat && !sugg.includes(d.plat) ? esc(platOf(d.plat).name) : 'Another platform…'}</option>${allPlats().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="+">+ A platform that is not in this list…</option></select>
      ${d.plat ? `<div class="sec">How do you have it?</div><div class="chips"><button class="chip ${d.kind === 'digital' ? 'on' : ''}" data-ck="digital">Digital</button><button class="chip ${d.kind === 'physical' ? 'on' : ''}" data-ck="physical">Physical (box / cartridge / disc)</button></div>
      ${d.kind === 'digital' ? `<div class="sec">Where</div><div class="chips">${storesFor(d.plat).map(s => `<button class="chip ${d.store === s ? 'on' : ''}" data-cs="${s}">${esc(STORES[s][0])}</button>`).join('')}</div>`
        : `<div class="sec">What's included</div><div class="chips">${Object.entries(BOX).map(([k, t]) => `<button class="chip ${d.box === k ? 'on' : ''}" data-cb="${k}">${t}</button>`).join('')}</div>
           <div class="sec">Region</div><div class="chips">${REGIONS.map(r => `<button class="chip ${d.region === r ? 'on' : ''}" data-cr="${r}">${r}</button>`).join('')}</div>`}` : ''}` };
  sheet(`<h3>${isNew ? 'Add a copy' : 'Your copy'} · ${esc(g.title)}</h3><div id="cpbody"></div>
    ${d.rom && (d.rom.phone || d.rom.pc) ? `<div class="sec">Backup file</div>${['phone', 'pc'].filter(w => d.rom[w]).map(w => `<div class="li" style="cursor:default"><div class="n"><div>${esc(d.rom[w].name)}</div><div class="s">${w === 'phone' ? 'On this phone' : 'On my PC'}${d.rom[w].size ? ' · ' + ((d.rom[w].size / 1048576) < 1 ? Math.max(1, Math.round(d.rom[w].size / 1024)) + ' KB' : Math.round(d.rom[w].size / 1048576) + ' MB') : ''}</div></div><button class="btn sm" data-romforget="${w}">Forget</button></div>`).join('')}<p class="muted small" style="margin:4px 0 0">Forget only removes the link here; the file stays.</p>` : ''}
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="cpsave">${isNew ? 'Add' : 'Save'}</button></div>
    ${!isNew ? `<div class="mlist" style="margin-top:10px">${g.copies.length > 1 ? '<button class="btn" id="cpsplit">This is a different game – make it its own tile</button>' : ''}<button class="btn danger" id="cpdel">Remove this copy</button></div>` : ''}`, true);
  drawC();
  document.querySelectorAll('[data-romforget]').forEach(b => b.onclick = () => { d.rom = Object.assign({}, d.rom); delete d.rom[b.dataset.romforget]; b.closest('.li').remove(); toast('Forgotten - tap Save') });
  $('#cpbody').onclick = e => { const t = e.target.closest('[data-cp],[data-ck],[data-cs],[data-cb],[data-cr]'); if(!t) return;
    if(t.dataset.cp){ d.plat = t.dataset.cp; if(!storesFor(d.plat).includes(d.store)) d.store = storesFor(d.plat)[0] }
    if(t.dataset.ck){ d.kind = t.dataset.ck; if(d.kind === 'digital' && !d.store) d.store = storesFor(d.plat)[0] }
    if(t.dataset.cs) d.store = t.dataset.cs; if(t.dataset.cb) d.box = t.dataset.cb; if(t.dataset.cr) d.region = t.dataset.cr; drawC() };
  $('#cpbody').onchange = async e => { if(e.target.id !== 'cpall') return; let v = e.target.value;
    if(v === '+'){ const n = await ask('Which platform?', 'Name, like Atari Lynx or Commodore 64', '', 'Add'); if(n){ d.plat = addOwnPlat(n); d.store = storesFor(d.plat)[0] }
      return copySheet(g, c, Object.assign({}, ctx, {suggest:[d.plat].concat(sugg)}), d) }   // the question replaced the sheet: open it again with what was picked
    if(v){ d.plat = v; if(!sugg.includes(v)) sugg.push(v); if(!storesFor(v).includes(d.store)) d.store = storesFor(v)[0] } drawC() };
  $('#cpsave').onclick = async () => { if(!d.plat){ toast('Pick the platform first'); return }
    if(d.kind === 'digital'){ delete d.box; delete d.region } else delete d.store;
    const was = g.copies.findIndex(x => x.id === d.id); if(was >= 0) g.copies[was] = d; else g.copies.push(d);
    let msg = isNew ? `Added: ${g.title} (${platOf(d.plat).short})` : 'Saved';
    if(g.wish && isNew){ g.wish = false; msg += ' - taken off your wishlist' }
    await saveGame(g); closeSheet(); draw(); toast(msg, 3500) };
  if($('#cpdel')) $('#cpdel').onclick = async () => { g.copies = g.copies.filter(x => x.id !== d.id);
    if(!g.copies.length && !g.wish){ if(!confirm(`This was your only copy of “${g.title}”. Remove the game from Games? (Cancel = keep it on your wishlist.)`)){ g.wish = true } else { await dropGame(g); closeSheet(); if(cur().v === 'game') V.pop(); draw(); toast('Removed'); return } }
    await saveGame(g); closeSheet(); draw(); toast('Copy removed') };
  if($('#cpsplit')) $('#cpsplit').onclick = async () => { g.copies = g.copies.filter(x => x.id !== d.id); const n = newGame({title:g.title + ' (other)', year:g.year}); n.copies = [d]; n.cover = g.cover; n.cover2 = g.cover2;
    await saveGame(g); await saveGame(n); closeSheet(); go({v:'game', id:n.id, shelf:d.plat}); toast('Now its own tile - fix its name with ⋯ → Edit details or Look up details', 4500) } }
/* =====================================================================================================================
   GAME ⋯
   ===================================================================================================================== */
function gameMenu(g, sh){ const G = grOf(sh), pin = G.isPinned('it:' + g.id);
  sheet(`<h3>${esc(g.title)}</h3><div class="mlist">
    <button class="btn" id="gmg">Put in a group…</button><button class="btn" id="gmp">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    <button class="btn" id="gme">Edit details</button>${hasIgdb() ? `<button class="btn" id="gml">${g.igdb ? 'Find the right game again (IGDB)' : 'Look up details online (IGDB)'}</button>` : ''}
    <button class="btn" id="gmc">Change the cover</button><button class="btn" id="gmm">This is the same game as…</button>
    <button class="btn" id="gmw">${g.wish ? '♥ Take off my wishlist' : '♥ Put on my wishlist'}</button>
    <button class="btn danger" id="gmx">Remove from Games</button></div>
    <p class="muted small" style="margin:10px 0 0">Groups are per shelf: this changes “${esc(shelfOf(sh).name)}”.</p>`);
  $('#gmg').onclick = () => groupPicker(g, sh);
  $('#gmp').onclick = () => { G.togglePin(['it:' + g.id], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  $('#gme').onclick = () => editGame(g); if($('#gml')) $('#gml').onclick = () => lookupSheet(g, true);
  $('#gmc').onclick = () => coverSheet(g); $('#gmm').onclick = () => mergeSheet(g);
  $('#gmw').onclick = async () => { if(g.wish){ g.wish = false; if(!owned(g)){ if(confirm(`“${g.title}” has no copies. Remove it from Games?`)){ await dropGame(g); closeSheet(); V.pop(); draw(); return } } await saveGame(g); closeSheet(); draw(); toast('Taken off your wishlist') } else wishSheet(g, g.plats) };
  $('#gmx').onclick = () => removeGames([g.id]) }
async function removeGames(ids){ const gs = ids.map(id => GM[id]).filter(Boolean); if(!gs.length) return;
  if(!confirm(`Remove ${gs.length === 1 ? '“' + gs[0].title + '”' : plural(gs.length, 'game')} from Games? (All copies and the wishlist mark go.)`)) return;
  for(const g of gs) await dropGame(g); closeSheet(); selEnd(true); if(cur().v === 'game' && !GM[cur().id]) V.pop(); draw(); toast(plural(gs.length, 'game') + ' removed') }
function editGame(g){
  sheet(`<h3>Edit details</h3>
    ${[['title', 'Name'], ['series', 'Series (games with the same series make one tile)'], ['year', 'Year it came out']].map(([k, t]) => `<div class="field"><label>${t}</label><input type="${k === 'year' ? 'number' : 'text'}" id="ed_${k}" value="${esc(g[k] == null ? '' : g[k])}" ${k === 'series' && !g.series && guessSeries(g.title) ? `placeholder="${esc(guessSeries(g.title))} (guessed)"` : ''}></div>`).join('')}
    <div class="field"><label>Genres (with commas)</label><input type="text" id="ed_genres" value="${esc(g.genres.join(', '))}"></div>
    <div class="field"><label>About</label><textarea id="ed_summary">${esc(g.summary || '')}</textarea></div>
    <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="edsave">Save</button></div>`, true);
  $('#edsave').onclick = async () => { const t = $('#ed_title').value.trim(); if(!t){ toast('The game needs a name'); return } g.title = t; g.series = $('#ed_series').value.trim(); g.summary = $('#ed_summary').value.trim();
    const y = parseInt($('#ed_year').value); g.year = y > 1950 && y < 2200 ? y : null; g.genres = $('#ed_genres').value.split(',').map(x => x.trim()).filter(Boolean);
    await saveGame(g); closeSheet(); draw(); toast('Saved') } }
/* IGDB: find the right game for this tile and fill in year, series, about, genres, cover */
function lookupSheet(g, over){
  sheet(`<h3>Look up “${esc(g.title)}”</h3><div style="display:flex;gap:8px"><input type="search" id="lkq" value="${esc(g.title)}"><button class="btn primary" id="lkgo">Search</button></div><div id="lkres" style="margin-top:8px"></div>`, true);
  const run = async () => { const el = $('#lkres'); el.innerHTML = '<div class="prog busy"><i></i></div>'; let res;
    try{ res = await igdbSearch($('#lkq').value.trim()) }catch(e){ el.innerHTML = `<p class="note bad">${esc(netMsg(e))}</p>`; return }
    const myP = g.copies.map(c => c.plat); res.sort((a, b) => (norm(b.title) === norm(g.title)) - (norm(a.title) === norm(g.title)) || (b.plats.some(p => myP.includes(p)) - a.plats.some(p => myP.includes(p))));
    el.innerHTML = res.map((x, i) => `<div class="li" data-lk="${i}"><span class="th"><div class="cv">${x.thumb ? `<img class="f" src="${esc(x.thumb)}" alt="" referrerpolicy="no-referrer" style="object-fit:cover">` : phHTML(x)}</div></span><div class="n"><div>${esc(x.title)}</div><div class="s">${esc([x.year, x.plats.slice(0, 6).map(p => platOf(p).short).join(', ')].filter(Boolean).join(' · '))}</div></div></div>`).join('') || '<p class="muted small">Nothing found - try fewer words.</p>';
    el.onclick = async e => { const r = e.target.closest('[data-lk]'); if(!r) return; const x = res[+r.dataset.lk];
      applyInfo(g, x, over || norm(x.title) !== norm(g.title) ? true : false); if(over && x.cover && !g.steam){ g.cover = x.cover } await saveGame(g); closeSheet(); draw(); toast('Details filled in') } };
  $('#lkgo').onclick = run; $('#lkq').onkeydown = e => { if(e.key === 'Enter') run() }; run() }
/* covers: IGDB, Steam, SteamGridDB (many choices), your own picture */
function coverSheet(g){
  const opts = [g.igdbCover && {u:g.igdbCover, t:'IGDB'}, g.steam && {u:steamCover(g.steam), t:'Steam'}, g.steam && {u:steamWide(g.steam), t:'Steam (wide)'}].filter(Boolean);
  sheet(`<h3>Cover of “${esc(g.title)}”</h3><div class="grid" id="cvopts" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${opts.map(o => `<div class="bk" data-cu="${esc(o.u)}"><div class="cv"><img class="f" src="${esc(o.u)}" alt="" referrerpolicy="no-referrer" onerror="this.closest('.bk').remove()"></div><div class="a">${o.t}</div></div>`).join('')}</div>
    <div class="mlist" style="margin-top:10px">${KEYS().sgdbKey ? '<button class="btn" id="cvsg">More covers (SteamGridDB)</button>' : ''}<button class="btn" id="cvpic">A picture from the phone</button>${COV.has(g.id) ? '<button class="btn" id="cvown">Stop using my own picture</button>' : ''}</div>
    <div id="cvsgres"></div>${KEYS().sgdbKey ? '' : '<p class="muted small" style="margin:8px 0 0">More choices: add a free SteamGridDB key in ⚙ → Online lookup.</p>'}`);
  const use = async u => { g.cover = u; if(COV.has(g.id)) await dropCover(g.id); await saveGame(g); closeSheet(); draw(); toast('Cover changed') };
  $('.sheet').addEventListener('click', e => { const o = e.target.closest('[data-cu]'); if(o) use(o.dataset.cu) });
  $('#cvpic').onclick = () => { const i = $('#pickpic'); i.value = ''; i.onchange = async e => { const f = e.target.files[0]; if(!f) return; await setCover(g.id, await thumb(f)); closeSheet(); draw(); toast('Cover changed') }; i.click() };
  if($('#cvown')) $('#cvown').onclick = async () => { await dropCover(g.id); closeSheet(); draw() };
  if($('#cvsg')) $('#cvsg').onclick = async () => { const el = $('#cvsgres'); el.innerHTML = '<div class="prog busy"><i></i></div>';
    try{ const l = await sgdbCovers(g); el.innerHTML = l.length ? `<div class="sec">SteamGridDB</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${l.map(x => `<div class="bk" data-cu="${esc(x.url)}"><div class="cv"><img class="b" src="${esc(x.thumb)}" alt="" referrerpolicy="no-referrer"><img class="f" src="${esc(x.thumb)}" alt="" referrerpolicy="no-referrer"></div></div>`).join('')}</div>` : '<p class="muted small">No covers found there.</p>' }
    catch(e){ el.innerHTML = `<p class="note bad">${esc(netMsg(e))}</p>` } } }
/* two tiles that are the same game: move this tile's copies into the other one */
function mergeSheet(g){ let q = '';
  const drawL = () => { const nq = norm(q), l = GAMES.filter(x => x !== g && (!nq || norm(x.title).includes(nq))).sort(byTitle).slice(0, 200);
    $('#mglist').innerHTML = l.map(x => `<div class="li" data-mg="${esc(x.id)}"><span class="th">${coverHTML(x)}</span><div class="n"><div>${esc(x.title)}</div><div class="s">${esc(x.copies.map(c => platOf(c.plat).short + ' ' + copyShort(c)).join(' · ') || (x.wish ? 'Wishlist' : ''))}</div></div></div>`).join('') || '<p class="muted small">Nothing found.</p>'; lazyCovers($('#mglist')) };
  sheet(`<h3>“${esc(g.title)}” is the same game as…</h3><p class="muted small" style="margin:0 0 8px">Its copies move into the game you pick, and this tile goes.</p><input type="search" id="mgq" placeholder="Search" value="${esc(guessSeries(g.title) || g.title.split(/[:\-–]/)[0])}"><div id="mglist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>`);
  q = $('#mgq').value; $('#mgq').oninput = e => { q = e.target.value; drawL() }; drawL();
  $('#mglist').onclick = async e => { const r = e.target.closest('[data-mg]'); if(!r) return; const to = GM[r.dataset.mg]; if(!confirm(`Put the ${plural(g.copies.length, 'copy', 'copies')} of “${g.title}” into “${to.title}”?`)) return;
    to.copies = to.copies.concat(g.copies); if(g.wish && !owned(to)) to.wish = true; for(const k of ['steam', 'igdb', 'year', 'series', 'summary', 'igdbUrl', 'igdbCover']) if(!to[k] && g[k]) to[k] = g[k];
    to.plats = [...new Set(to.plats.concat(g.plats))]; await saveGame(to); await dropGame(g); closeSheet(); V.pop(); go({v:'game', id:to.id, shelf:cur().shelf}); toast('Put together') } }

/* =====================================================================================================================
   GROUPS: menus (the same words as Music and Bookcase)
   ===================================================================================================================== */
function newGroup(sh){ ask('New group', 'Name, like Star Wars or Mario', '', 'Make the group').then(n => { if(!n) return; const G = grOf(sh); G.own(n); regroup();
  const g = groupByKey(sh, 'c:' + norm(n)); S.grouped[sh] = true; saveS(); draw(); toast(`Group “${n}”: ${plural(g ? g.all.length : 0, 'game')}. Games with this word in their name or series go in by themselves.`, 4500) }) }
function groupMenu(sh, g){ const G = grOf(sh), pin = G.isPinned('gr:' + g.key);
  sheet(`<h3>${esc(g.name)}</h3><div class="mlist"><button class="btn primary" id="gadd">Add games…</button><button class="btn" id="gsub">New group inside</button><button class="btn" id="gmove">Put this group inside another group…</button><button class="btn" id="gren">Rename</button><button class="btn" id="gcov">Choose the tile cover</button><button class="btn" id="gpin">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>${g.kind === 'own' ? '<button class="btn danger" id="gdel">Remove this group</button>' : ''}</div>
    ${g.kind === 'own' ? '<p class="muted small" style="margin:10px 0 0">Removing the group keeps the games - they show as their own tiles again (or in their series).</p>' : ''}`);
  $('#gadd').onclick = () => addItemsSheet(sh, g); $('#gsub').onclick = () => newSubGroup(sh, g); $('#gmove').onclick = () => moveGroupSheet(sh, g); $('#gren').onclick = () => renameGroup(sh, g); $('#gcov').onclick = () => groupCoverSheet(sh, g);
  $('#gpin').onclick = () => { G.togglePin(['gr:' + g.key], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#gdel')) $('#gdel').onclick = () => { closeSheet(); if(cur().v === 'group' && cur().key === g.key) V.pop(); grChange(sh, () => G.remove(g), `Group “${g.name}” removed`); draw() } }
function addItemsSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, where = {}; for(const x of gs) for(const b of x.items) where[b.id] = x;
  const pick = new Set(); let q = '';
  const list = () => { const nq = norm(q); return inShelf(sh).filter(b => !g.items.includes(b) && (!nq || norm([b.title, b.series, (where[b.id] || {}).name].join(' ')).includes(nq))).sort(byTitle) };
  const drawL = () => { const l = list(), el = $('#aalist'); if(!el) return;
    el.innerHTML = l.slice(0, 400).map(b => `<label class="li" style="cursor:pointer"><input type="checkbox" data-aa="${esc(b.id)}" ${pick.has(b.id) ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accentd);flex:none"><span class="th">${coverHTML(b)}</span><div class="n"><div>${esc(b.title)}</div><div class="s">${esc(b.year || '')}${where[b.id] ? ' · in ' + esc(G.path(where[b.id], gs)) : ''}</div></div></label>`).join('') + (l.length > 400 ? `<p class="muted small">… and ${l.length - 400} more - type to narrow it down</p>` : '') + (!l.length ? '<p class="muted small">Nothing found.</p>' : '');
    lazyCovers(el); upd() };
  const upd = () => { $('#aago').textContent = pick.size ? `Add ${plural(pick.size, 'game')}` : 'Add'; $('#aago').disabled = !pick.size };
  sheet(`<h3>Add games to “${esc(g.name)}”</h3><input type="search" id="aaq" placeholder="Search name, series or group"><div id="aalist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="aago" disabled>Add</button></div>`, true);
  $('#aaq').oninput = e => { q = e.target.value; drawL() };
  $('#aalist').onchange = e => { const c = e.target.closest('[data-aa]'); if(!c) return; c.checked ? pick.add(c.dataset.aa) : pick.delete(c.dataset.aa); upd() };
  $('#aago').onclick = () => { grChange(sh, () => G.put([...pick], g), `${plural(pick.size, 'game')} added to “${g.name}”`); closeSheet(); draw() };
  drawL() }
function newSubGroup(sh, g){ ask(`New group inside “${esc(g.name)}”`, 'Name, like Remakes or Spin-offs', '', 'Make it').then(n => { if(!n) return; const G = grOf(sh), k = G.own(n); if(k.key === g.key) return; G.setParent(k.key, g.key); regroup(); draw(); toast(`“${n}” made inside “${g.name}” - open it and add games`) }) }
function moveGroupSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, bad = new Set(G.inside(g, gs).concat(g.key)), opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Put “${esc(g.name)}” inside…</h3>${g.parent ? '<button class="btn" id="mgtop" style="width:100%;margin-bottom:8px">Back on the main page</button>' : ''}
    ${opts.map(x => `<div class="li" data-mg="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'game')}</div></div></div>`).join('') || '<p class="muted small">No other groups yet. Make one with “+ Group” on the shelf.</p>'}`);
  lazyCovers($('.sheet'));
  if($('#mgtop')) $('#mgtop').onclick = () => { grChange(sh, () => toTop(G, g.key), `“${g.name}” is back on the main page`); closeSheet(); draw() };
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-mg]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.mg); grChange(sh, () => G.setParent(g.key, t.key), `“${g.name}” is now inside “${t.name}”`); closeSheet(); draw() }) }
function groupPicker(b, sh){ const G = grOf(sh), now = groupOfGame(sh, b), all = groupsOf(sh).groups, gs = all.filter(g => !now || g.key !== now.key).sort((x, y) => coll.compare(x.name, y.name)), ov = G.read('items');
  sheet(`<h3>Put “${esc(b.title)}” in a group</h3>${now ? `<p class="muted small" style="margin:0 0 8px">Now in “${esc(now.name)}”.</p>` : ''}
    <div style="display:flex;gap:8px"><input type="text" id="gpn" placeholder="New group name" maxlength="60"><button class="btn primary" id="gpmake">Make</button></div>
    <div style="margin-top:10px">${gs.map(g => `<div class="li" data-gp="${esc(g.key)}"><span class="th">${groupCoverHTML(sh, g)}</span><div class="n"><div>${esc(G.path(g, all))}</div><div class="s">${plural(g.items.length, 'game')}</div></div></div>`).join('') || '<p class="muted small">No group tiles yet.</p>'}</div>
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
function groupCoverSheet(sh, g){ const G = grOf(sh), c = G.cover(g.key), wc = g.all.filter(hasCover).sort(seriesOrder);
  const save = v => { G.setCover(g.key, v); delete RNDCOV[g.key]; closeSheet(); draw(); toast('Tile cover saved') };
  sheet(`<h3>Tile cover for “${esc(g.name)}”</h3>
    <div class="chips"><button class="chip ${!c.t ? 'on' : ''}" data-gc="">The first game</button><button class="chip ${c.t === 'random' ? 'on' : ''}" data-gc="random">A random one</button><button class="chip ${c.t === 'cycle' ? 'on' : ''}" data-gc="cycle">Changing (one after another)</button><button class="chip ${c.t === 'pic' ? 'on' : ''}" data-gc="pic">A picture from the phone</button></div>
    <div class="sec">Or pick one</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${wc.map(b => `<div class="bk" data-gca="${esc(b.id)}" style="${c.t === 'item' && c.al === b.id ? 'outline:2px solid var(--accent);border-radius:10px' : ''}">${coverHTML(b)}<div class="a">${esc(b.title)}</div></div>`).join('') || '<p class="muted small">No covers in this group yet.</p>'}</div>`);
  lazyCovers($('.sheet'));
  $('.sheet').onclick = e => { const bt = e.target.closest('[data-gc]'), it = e.target.closest('[data-gca]');
    if(it) return save({t:'item', al:it.dataset.gca}); if(!bt) return; const t = bt.dataset.gc;
    if(t === 'pic'){ const i = $('#pickpic'); i.value = ''; i.onchange = async ev => { const f = ev.target.files[0]; if(!f) return; await setCover('grp:' + sh + ':' + g.key, await thumb(f)); save({t:'pic'}) }; i.click(); return }
    save(t ? {t} : null) } }

/* ---------- select several tiles and move them at once (long-press a tile, or "Select") ---------- */
function selStart(id){ SEL = new Set(id ? [id] : []); selDraw() }
function selEnd(quiet){ if(!SEL) return; SEL = null; if(!quiet) selDraw(); else { const b = $('#msel'); if(b) b.remove() } }
function selDraw(){ document.querySelectorAll('#body .grid > .bk').forEach(el => { const id = el.dataset.game ? 'it:' + el.dataset.game : el.dataset.grp ? 'gr:' + el.dataset.grp : null; el.classList.toggle('sel', !!(SEL && id && SEL.has(id))) });
  let bar = $('#msel'); if(!SEL){ if(bar) bar.remove(); return }
  if(!bar){ bar = document.createElement('div'); bar.id = 'msel'; document.body.appendChild(bar) }
  const inGroup = cur().v === 'group', n = SEL.size;
  bar.innerHTML = `<b style="flex:1">${n ? plural(n, 'tile') + ' selected' : 'Tap tiles to select them'}</b><button class="btn sm primary" id="selmove" ${n ? '' : 'disabled'}>Move to…</button><button class="btn sm" id="selmore" ${n ? '' : 'disabled'}>${IC_DOTS}</button>${inGroup ? `<button class="btn sm" id="selout" ${n ? '' : 'disabled'}>Take out</button>` : ''}<button class="btn sm" id="selx">Cancel</button>`;
  $('#selx').onclick = () => selEnd(); $('#selmove').onclick = selMoveSheet; $('#selmore').onclick = selMore; if($('#selout')) $('#selout').onclick = selTakeOut }
function selParts(){ const sh = cur().shelf, gs = groupsOf(sh).groups, its = [...SEL].filter(x => x.startsWith('it:')).map(x => x.slice(3)), grs = [...SEL].filter(x => x.startsWith('gr:')).map(x => x.slice(3));
  const games = [...new Set(its.concat(...grs.map(k => (gs.find(g => g.key === k) || {all:[]}).all.map(b => b.id))))];
  return {sh, gs, its, grs, games} }
function selMoveSheet(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), bad = new Set(grs.flatMap(k => { const g = gs.find(x => x.key === k); return g ? G.inside(g, gs).concat(k) : [k] }));
  const opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Move ${plural(SEL.size, 'tile')} to…</h3><div style="display:flex;gap:8px"><input type="text" id="smn" placeholder="New group name" maxlength="60"><button class="btn primary" id="smmake">Make</button></div>
    <button class="btn" id="smtop" style="width:100%;margin-top:10px">The main page (own tiles)</button>
    <div style="margin-top:8px">${opts.map(x => `<div class="li" data-sm="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${plural(x.all.length, 'game')}</div></div></div>`).join('')}</div>`);
  lazyCovers($('.sheet'));
  const move = t => { if(t){ G.put(its, t); for(const k of grs) G.setParent(k, t.key) } else { G.put(its, 'none'); for(const k of grs) toTop(G, k) } };
  const doit = (t, label, first) => { const n = SEL.size; grChange(sh, () => { if(first) first(); move(t) }, `${plural(n, 'tile')} moved to ${label}`); closeSheet(); selEnd(true); draw() };
  $('#smmake').onclick = () => { const n = $('#smn').value.trim(); if(!n) return; const v = cur(); doit({key:'c:' + norm(n), name:n, kind:'own'}, `“${n}”`, () => { const g = G.own(n); if(v.v === 'group' && !bad.has(v.key)) G.setParent(g.key, v.key) }) };
  $('#smtop').onclick = () => doit(null, 'the main page');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-sm]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.sm); if(t) doit(t, `“${t.name}”`) }) }
function selTakeOut(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), here = gs.find(x => x.key === cur().key), up = here && here.parent ? gs.find(x => x.key === here.parent) : null, n = SEL.size;
  grChange(sh, () => { G.put(its, up || 'none'); for(const k of grs) up ? G.setParent(k, up.key) : toTop(G, k) }, `${plural(n, 'tile')} taken out${up ? ' to “' + up.name + '”' : ' to the main page'}`); selEnd(true); draw() }
function selMore(){ const {sh, games} = selParts(), G = grOf(sh), ids = [...SEL], allPinned = ids.every(x => G.isPinned(x));
  sheet(`<h3>${plural(ids.length, 'tile')} · ${plural(games.length, 'game')}</h3><div class="mlist"><button class="btn" id="smpin">${allPinned ? '★ Unpin' : '★ Pin to the top'}</button>${hasIgdb() ? '<button class="btn" id="smlook">Fill in details online (IGDB)</button>' : ''}<button class="btn danger" id="smdel">Remove from Games</button></div>`);
  $('#smpin').onclick = () => { G.togglePin(ids, !allPinned); closeSheet(); selEnd(true); draw() };
  if($('#smlook')) $('#smlook').onclick = () => { closeSheet(); selEnd(true); fillDetails(games.map(id => GM[id]).filter(Boolean), true) };
  $('#smdel').onclick = () => removeGames(games) }

/* =====================================================================================================================
   IMPORT FROM STEAM and FILL IN DETAILS
   ===================================================================================================================== */
async function awake(on){ try{ if(on && navigator.wakeLock && !awake.l) awake.l = await navigator.wakeLock.request('screen'); if(!on && awake.l){ await awake.l.release(); awake.l = null } }catch(e){} }
function busySheet(title){ sheet(`<h3>${title}</h3><div class="prog"><i id="bp"></i></div><div class="muted small" id="bs">Starting…</div><button class="btn" id="bstop" style="width:100%;margin-top:10px">Stop</button>`, true);
  const o = {stop:false, set:(n, of, t) => { const p = $('#bp'), s = $('#bs'); if(p) p.style.width = (of ? 100 * n / of : 0) + '%'; if(s) s.textContent = t }}; $('#bstop').onclick = () => { o.stop = true }; return o }
async function steamImport(withWish){ let list;
  const b = busySheet('Importing from Steam…'); b.set(0, 0, 'Asking Steam for your games…'); awake(true);
  try{ list = await steamOwned() }catch(e){ awake(false); closeSheet(); toast(netMsg(e), 7000); LE('steam', 'owned', e); return }
  let added = 0, copies = 0, n = 0; const fresh = [];
  for(const x of list){ if(b.stop) break; n++;
    let g = GAMES.find(y => y.steam === x.appid) || GAMES.find(y => norm(y.title) === norm(x.name) && (!y.steam));
    if(!g){ g = newGame({title:x.name, steam:x.appid, plats:['pc']}); added++ ; fresh.push(g) }
    if(!g.steam){ g.steam = x.appid; if(!g.cover || g.cover === g.igdbCover){ g.cover2 = g.cover; g.cover = steamCover(x.appid) } }
    if(!g.copies.some(c => c.plat === 'pc' && c.store === 'steam')){ g.copies.push({id:'c' + uid(), plat:'pc', kind:'digital', store:'steam', added:Date.now()}); copies++ }
    if(g.wish) g.wish = false;
    g.edited = Date.now(); if(!GM[g.id]){ GAMES.push(g); GM[g.id] = g }
    if(n % 50 === 0){ b.set(n, list.length, `${n} of ${list.length} · ${x.name}`); await dbPutMany('games', GAMES.slice()) } }
  await dbPutMany('games', GAMES.slice()); regroup();
  let wished = 0;
  if(withWish && !b.stop){ let ids = []; try{ b.set(0, 0, 'Asking Steam for your wishlist…'); ids = await steamWishlist() }catch(e){ LE('steam', 'wishlist', e); toast('Could not read the Steam wishlist: ' + netMsg(e), 5000) }
    ids = ids.filter(id => !GAMES.some(g => g.steam === id)); let i = 0;
    for(const id of ids.slice(0, 400)){ if(b.stop) break; i++; b.set(i, Math.min(ids.length, 400), `Wishlist ${i} of ${Math.min(ids.length, 400)}`);
      let name = null; try{ name = await steamName(id) }catch(e){ if(e.status === 429){ await sleep(30000); try{ name = await steamName(id) }catch(e2){} } }
      if(!name) continue; const g = newGame({title:name, steam:id, plats:['pc']}); g.wish = true; g.wishPlats = ['pc']; await saveGame(g); wished++; await sleep(350) } }
  awake(false); closeSheet(); regroup(); draw();
  lsSet('nvGames.steamAt', Date.now()); L('steam', 'import', {games:list.length, added, copies, wished});
  toast(`Steam: ${plural(list.length, 'game')} · ${added} new, ${copies} copies added${wished ? ` · ${wished} on your wishlist` : ''}`, 6000);
  if(hasIgdb() && fresh.length && confirm(`Fill in the details (year, series, about) of the ${plural(fresh.length, 'new game')} from IGDB now? It takes about ${Math.ceil(fresh.length / 3 / 60) || 1} minute(s).`)) fillDetails(fresh) }
/* IGDB details for games that don't have them yet: only an exact name match (PC first for Steam games) – nothing is guessed */
async function fillDetails(list, again){ list = list.filter(g => again || !g.igdb); if(!list.length){ toast('Nothing to fill in'); return }
  const b = busySheet('Filling in details from IGDB…'); awake(true); let n = 0, ok = 0, miss = 0;
  for(const g of list){ if(b.stop) break; n++; b.set(n, list.length, `${n} of ${list.length} · ${g.title}`);
    try{ const res = await igdbSearch(g.title.replace(/[™®©]/g, '')), myP = g.copies.map(c => c.plat).concat(g.wishPlats || []);
      const same = res.filter(x => norm(x.title) === norm(g.title)), x = same.find(y => y.plats.some(p => myP.includes(p))) || same[0];
      if(x){ applyInfo(g, x); await dbPut('games', g); ok++ } else miss++ }
    catch(e){ LE('igdb', 'fill ' + g.title, e); if(e.noweb || e.status === 401 || e.status === 403){ toast(netMsg(e), 6000); break } } }
  awake(false); closeSheet(); regroup(); draw(); toast(`${plural(ok, 'game')} filled in${miss ? ` · ${miss} not found by exact name (use ⋯ → Look up details)` : ''}`, 5000) }

/* =====================================================================================================================
   SETTINGS
   ===================================================================================================================== */
function keysSheet(steamFirst){ const k = KEYS();
  const f = (id, t, ph, type) => `<div class="field"><label>${t}</label><input type="${type || 'text'}" id="k_${id}" value="${esc(k[id] || '')}" placeholder="${esc(ph || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`;
  const steam = `<div class="sec" style="margin-top:4px">Steam (your library and wishlist)</div>
    ${f('steamKey', 'Steam Web API key', '32 letters and numbers', 'password')}${f('steamId', 'Your Steam ID or profile link', 'steamcommunity.com/id/yourname or 7656119…')}
    <p class="muted small" style="margin:0 0 8px">Get the key at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener">steamcommunity.com/dev/apikey</a> (any domain name, e.g. localhost). In Steam's privacy settings, “Game details” must be Public.</p>
    <div class="opt"><label for="k_wish">Also bring in my Steam wishlist</label><input type="checkbox" id="k_wish" checked></div>
    <button class="btn primary" id="k_steam" style="width:100%;margin-top:6px">Import my Steam games</button>${lsGet('nvGames.steamAt', 0) ? `<p class="muted small">Last import ${new Date(lsGet('nvGames.steamAt', 0)).toLocaleString()}. Importing again only adds what is new.</p>` : ''}`;
  const igdbH = `<div class="sec">IGDB (names, covers, series for every platform)</div>
    ${f('igdbId', 'Client ID', '', 'text')}${f('igdbSecret', 'Client Secret', '', 'password')}
    <p class="muted small" style="margin:0 0 8px">Free: log in at <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener">dev.twitch.tv/console/apps</a> (Twitch account with two-step login), “Register Your Application”, OAuth Redirect URL <b>http://localhost</b>, category “Application Integration”, client type “Confidential”. Copy the Client ID, then “New Secret”.</p>
    <div class="sec">SteamGridDB (more covers, optional)</div>${f('sgdbKey', 'API key', '', 'password')}
    <p class="muted small" style="margin:0 0 8px">Free: log in at <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noopener">steamgriddb.com → Preferences → API</a>.</p>`;
  sheet(`<h3>${steamFirst ? 'Import from Steam' : 'Online lookup'}</h3>
    <p class="note">Your keys stay on this device only (not in the app, not on GitHub, not on the PC). ${NATIVE ? '' : '<b>On the website these sites can’t be reached - use the Android app.</b>'}</p>
    ${steamFirst ? steam + igdbH : igdbH + steam}
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" style="flex:1" id="k_test">Save and test</button><button class="btn" style="flex:1" onclick="closeSheet()">Close</button></div><div id="k_res" class="small" style="margin-top:8px"></div>`, true);
  const save = () => { const n = {}; for(const id of ['igdbId', 'igdbSecret', 'sgdbKey', 'steamKey', 'steamId']) n[id] = $('#k_' + id).value.trim(); if(n.igdbId !== k.igdbId) lsSet('nvGames.igdbTok', null); lsSet('nvGames.keys', n); return n };
  $('#k_test').onclick = async () => { const n = save(), el = $('#k_res'), out = []; el.innerHTML = '<div class="prog busy"><i></i></div>';
    if(n.igdbId){ try{ const r = await igdbSearch('Tetris'); out.push(`<div class="ok">✓ IGDB works (${r.length} results for Tetris)</div>`) }catch(e){ out.push(`<div class="bad">✗ IGDB: ${esc(netMsg(e))}</div>`) } }
    if(n.sgdbKey){ try{ await sgdb('search/autocomplete/tetris'); out.push('<div class="ok">✓ SteamGridDB works</div>') }catch(e){ out.push(`<div class="bad">✗ SteamGridDB: ${esc(netMsg(e))}</div>`) } }
    if(n.steamKey){ try{ const l = await steamOwned(); out.push(`<div class="ok">✓ Steam works (${plural(l.length, 'game')} on your account)</div>`) }catch(e){ out.push(`<div class="bad">✗ Steam: ${esc(netMsg(e))}</div>`) } }
    el.innerHTML = out.join('') || 'Saved.'; draw() };
  $('#k_steam').onclick = () => { save(); const w = $('#k_wish').checked; steamImport(w) } }
function appSettings(){ const all = shelves(true);
  sheet(`<h3>Games</h3><div class="mlist"><button class="btn primary" id="as_keys">Online lookup (IGDB, SteamGridDB)</button><button class="btn" id="as_steam">Import from Steam</button>${window.NVPC && NVPC.native ? '<button class="btn" id="as_pcroms">Look for game backups on my PC</button>' : ''}${hasIgdb() ? '<button class="btn" id="as_fill">Fill in missing details (IGDB)</button>' : ''}</div>
    <div class="opt" style="margin-top:6px"><label for="as_guess">Guess the series from the name (Halo 3 → Halo) when a game has none</label><input type="checkbox" id="as_guess" ${S.guess ? 'checked' : ''}></div>
    <div class="sec">Hidden systems</div>
    ${all.filter(s => s.hidden).map(s => `<div class="li" style="cursor:default"><span style="width:30px;display:flex;justify-content:center">${shelfIcon(s, 20)}</span><div class="n"><div>${esc(s.name)}</div><div class="s">${plural(inShelf(s.id).length, 'game')}</div></div><button class="btn sm" data-eye="${esc(s.id)}">Show</button></div>`).join('') || '<p class="muted small">None. Hide a system you never use: open it → ⚙ → Hide this system.</p>'}
    <div class="sec">Your list</div><div class="mlist"><button class="btn" id="as_save">Save all my games (backup file)</button><button class="btn" id="as_load">Load games from a backup file</button></div>
    <p class="muted small">Your games are kept on this device. A backup file has your games, copies, wishlist and groups (not your own pictures).</p>
    <p class="muted small">Game info and covers: <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB.com</a>, <a href="https://www.steamgriddb.com" target="_blank" rel="noopener">SteamGridDB</a> and Steam. Problems? Switch on <b>Debug mode</b> at the bottom of The Nightvault and send the log.</p>`);
  if($('#as_pcroms')) $('#as_pcroms').onclick = () => scanPc(null);
  $('#as_keys').onclick = () => keysSheet(false); $('#as_steam').onclick = () => keysSheet(true);
  if($('#as_fill')) $('#as_fill').onclick = () => fillDetails(GAMES.slice());
  $('#as_guess').onchange = e => { S.guess = e.target.checked; saveS(); regroup(); draw() };
  $('.sheet').addEventListener('click', e => { const ey = e.target.closest('[data-eye]'), set = lsGet('nvGames.shelves', {});
    if(ey){ set.hidden = set.hidden || {}; set.hidden[ey.dataset.eye] = !set.hidden[ey.dataset.eye]; lsSet('nvGames.shelves', set); appSettings(); draw() } });
  $('#as_save').onclick = () => saveBackup(); $('#as_load').onclick = () => loadBackup() }
function shelfSettings(sh){ const s = shelfOf(sh), G = grOf(sh);
  sheet(`<h3>${esc(s.name)}</h3>${s.plat ? `<div class="mlist" style="margin-bottom:6px"><button class="btn primary" id="ss_play">▶ How to play ${esc(s.short || s.name)}</button></div>` : ''}
    <div class="sec" style="margin-top:4px">Your groups on this shelf</div><div class="mlist"><button class="btn" id="ss_save">Save my groups</button><button class="btn" id="ss_load">Load from a file</button></div>
    <div class="sec">This shelf</div><div class="mlist"><button class="btn" id="ss_hide">Hide this system</button><button class="btn" id="ss_all">All settings…</button></div>`);
  $('#ss_save').onclick = async () => { try{ const r = await G.saveBackup(); if(r !== 'cancelled') toast('Groups saved') }catch(e){ toast(e.message || String(e), 4000) } };
  $('#ss_load').onclick = async () => { const t = await G.pickFile(); if(!t) return; const c = G.checkBackup(t); if(!c.ok){ toast(c.msg, 5000); return }
    if(!confirm(c.msg + '\n\nPut these groups back? (Undo is possible right after.)')) return; G.applyBackup(c.d); regroup(); closeSheet(); draw(); G.undoToast('Groups loaded', () => { regroup(); draw() }) };
  $('#ss_hide').onclick = () => { const set = lsGet('nvGames.shelves', {}); set.hidden = set.hidden || {}; set.hidden[sh] = true; lsSet('nvGames.shelves', set); closeSheet(); V = [{v:'shelves'}]; draw(); toast(`${s.name} is hidden - show it again in ⚙ on the first page`, 4500) };
  $('#ss_all').onclick = () => appSettings(); if($('#ss_play')) $('#ss_play').onclick = () => howToPlay(sh) }
$('#setbtn').onclick = () => { const v = cur(); if(v.v === 'shelves' || v.v === 'game') appSettings(); else shelfSettings(v.shelf) };
$('#addbtn').onclick = () => addSheet();

/* ---------- backup file of the whole list (games + groups + settings; your keys are NOT in it) ---------- */
async function saveBackup(){ const ls = {}; for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k.startsWith('nvGames.') && !/^nvGames\.(keys|igdbTok)$/.test(k)) ls[k] = localStorage.getItem(k) }
  const D = new Date(), p2 = n => String(n).padStart(2, '0'), name = `nightvault-games_${D.getFullYear()}-${p2(D.getMonth() + 1)}-${p2(D.getDate())}.json`;
  const text = JSON.stringify({format:'nightvault-games', version:1, saved:D.toISOString(), games:GAMES, local:ls});
  try{ if(NATIVE){ const FS = Capacitor.registerPlugin('Filesystem'), SH = Capacitor.registerPlugin('Share'); const r = await FS.writeFile({path:name, data:text, directory:'CACHE', encoding:'utf8'}); await SH.share({title:name, files:[r.uri], dialogTitle:'Save or send ' + name}) }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:'application/json'})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000) }
    lsSet('nvGames.savedAt', Date.now()); toast(`Saved ${plural(GAMES.length, 'game')}`) }catch(e){ if(!/cancel/i.test(e.message || '')) toast(e.message || String(e), 4000) } }
function loadBackup(){ const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.style.display = 'none'; document.body.appendChild(i);
  i.onchange = async () => { const f = i.files[0]; i.remove(); if(!f) return; let d; try{ d = JSON.parse(await f.text()) }catch(e){ d = null }
    if(!d || d.format !== 'nightvault-games' || !Array.isArray(d.games)){ toast('This is not a Games backup file.', 5000); return }
    if(!confirm(`Backup from ${new Date(d.saved).toLocaleString()} with ${plural(d.games.length, 'game')}.\n\nThis REPLACES the ${plural(GAMES.length, 'game')} in Games now. Go on?`)) return;
    await dbClear('games'); await dbPutMany('games', d.games); for(const [k, v] of Object.entries(d.local || {})) if(k.startsWith('nvGames.') && !/^nvGames\.(keys|igdbTok)$/.test(k)) localStorage.setItem(k, v);
    Object.assign(S, lsGet('nvGames.settings', {})); for(const k of Object.keys(GRS)) delete GRS[k]; await loadLib(); closeSheet(); V = [{v:'shelves'}]; draw(); toast(`Loaded ${plural(GAMES.length, 'game')}`) };
  i.click() }

/* ---------- Android back button: sheet → one screen back → The Nightvault ---------- */
if(window.Capacitor) try{ const A = (Capacitor.Plugins && Capacitor.Plugins.App) || Capacitor.registerPlugin('App');
  A.addListener('backButton', () => { if(sheetOpen()){ closeSheet(); return } if(back()) return; if(fromHub()){ location.href = '../hub/index.html'; return } A.minimizeApp && A.minimizeApp() }) }catch(e){}

document.addEventListener('visibilitychange', () => { if(document.hidden) window.NVHERE && NVHERE.save('nvGames.here', {V}) }); addEventListener('pagehide', () => window.NVHERE && NVHERE.save('nvGames.here', {V}));   // back where you were (../hub/nvlog.js)
/* ---------- start ---------- */
(async () => {
  try{ await openDB(); await loadLib() }catch(e){ $('#body').innerHTML = `<p class="muted">Games could not open its storage: ${esc(e.message || e)}</p>`; return }
  const P = new URLSearchParams(location.search), sh = P.get('shelf');
  if(sh) V.push({v:'shelf', shelf:sh});
  { const h = window.NVHERE && NVHERE.take('nvGames.here'); if(h && Array.isArray(h.V) && h.V.length) V = h.V }
  try{ draw() }catch(e){ V = [{v:'shelves'}]; draw() } L('start', `${GAMES.length} games`);
  window.NVGAMES = {get games(){ return GAMES }, draw, cleanRom:(...a) => cleanRom(...a), romEntries:(...a) => romEntries(...a), guessSeries, fromIgdb, steamImport, fillDetails, saveGame, newGame, net, go};   // for testing
})();
