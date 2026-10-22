/* Nightvault Cinema (test) – the app. Plan: plans/cinema.md in nightvault-src.
   Movies, TV shows, cartoons and anime, each on its own shelf (plus your own shelves), with one video player.
   Where videos come from: a folder on the phone (NvFiles – nothing copied), copied into the app, or the PC over the home network
   (the PC app's Phone access, shared ../hub/nvpc.js = Take with me) – and "Save to phone" copies PC videos into a phone folder for a trip.
   Parts: basics · storage · shelves · names (what a file name says) · TMDB · library · PC · groups (shared ../hub/nvgroups.js) · covers ·
   tiles · screens · title page · menus · select · adding · the player · save to phone · settings · start */
'use strict';

/* ---------- basics (the same as Games / Bookcase / Music) ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const coll = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});
const plural = (n, w, ws) => `${n} ${n === 1 ? w : (ws || w + 's')}`;
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/^(the|de|het|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const hue = s => { let h = 0; for(const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360 };
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB';
const tfmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0') };
const mins = s => { if((s || 0) > 0 && s < 60) return 'under a minute'; s = Math.round((s || 0) / 60); return s >= 60 ? `${Math.floor(s / 60)} h ${s % 60 ? (s % 60) + ' min' : ''}`.trim() : s + ' min' };
let toastT = 0; function toast(m, ms){ const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 2600) }
window.toast = toast;
const L = (a, t, d) => { try{ window.NVLOG && NVLOG.log(a, t, d) }catch(e){} }, LE = (a, t, d) => { try{ window.NVLOG && NVLOG.error(a, t, d) }catch(e){} };
const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
const S = Object.assign({sort:{}, grouped:{}, filter:{}, src:{}, guess:true, lang:'en-US', subOn:true, subLangs:['nl', 'en'], autoSubs:true, qHome:0, qAway:720, autoNext:true, rate:1, fit:false}, lsGet('nvCinema.settings', {}));
if(!S.v2){ S.v2 = 1; S.subOn = true; try{ localStorage.setItem('nvCinema.settings', JSON.stringify(S)) }catch(e){} }   // 21 Oct: subtitles on by default (Dutch, else English)
const saveS = () => lsSet('nvCinema.settings', S);
const fromHub = () => { try{ return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
try{ if(new URLSearchParams(location.search).get('nv') === 'hub') sessionStorage.setItem('nvHub', '1'); if(fromHub()) $('#hubback').hidden = false }catch(e){}
const IC_DOTS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const IC_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const PINB = '<span class="pinb">★</span>';

/* ---------- storage: IndexedDB 'nvCinema' (works offline) ----------
   titles : {id, shelf, kind:'movie'|'show', name, year, tmdb:{type, id}, tmdbTried, poster, backdrop, overview, genres:[], saga, runtime,
             seasons:{n:{name, count, poster}}, pcGid, pcCover, added, edited}
   files  : {id, tid, s, e, e2, part, etitle, name, size, dir, src:{kind:'link', uri, name, tree} | {kind:'copy', bid} | null,
             pc:{id, name, size, ext} | null, local:{uri, name, size, tree, kept} | null (a PC video saved into a phone folder), subs:[...], added}
   watch  : {id:fileId, pos, dur, done, at}
   blobs  : {id, blob, name}   (videos and subtitles copied into the app)
   covers : {id, blob}          (title id = your own picture · 'p:<title id>' = the poster kept for offline · 'grp:<shelf>:<group key>')
   kv     : {id, v}             (TMDB season lists …) */
let DB = null;
function openDB(){ return new Promise((ok, no) => { const r = indexedDB.open('nvCinema', 1);
  r.onupgradeneeded = () => { const d = r.result; for(const s of ['titles', 'files', 'watch', 'blobs', 'covers', 'kv']) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s, {keyPath:'id'}) };
  r.onblocked = () => toast('Close the other Cinema tab, then reload', 6000);
  r.onsuccess = () => ok(DB = r.result); r.onerror = () => no(r.error) }) }
function tx(store, mode, fn){ return new Promise((ok, no) => { const t = DB.transaction(store, mode), st = t.objectStore(store); let res; const q = fn(st); if(q) q.onsuccess = () => res = q.result; t.oncomplete = () => ok(res); t.onerror = t.onabort = () => no(t.error || new Error('Storage error')) }) }
const dbGet = (s, id) => tx(s, 'readonly', st => st.get(id));
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbKeys = s => tx(s, 'readonly', st => st.getAllKeys());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));
const dbPutMany = (s, arr) => tx(s, 'readwrite', st => { for(const v of arr) st.put(v) });
const dbDelMany = (s, ids) => tx(s, 'readwrite', st => { for(const id of ids) st.delete(id) });
const kvGet = async (id, d) => { const r = await dbGet('kv', id).catch(() => null); return r ? r.v : d };
const kvSet = (id, v) => dbPut('kv', {id, v}).catch(() => {});

/* ---------- shelves: Movies, TV shows, Cartoons, Anime + your own ---------- */
const BASE = [
  {id:'movies', name:'Movies', c:['#3a1620', '#1d1b33'], s:'#ffb0a8', icon:'movie', unit:['film', 'films']},
  {id:'tv', name:'TV shows', c:['#16243a', '#1a1b33'], s:'#7fb2ff', icon:'tv', unit:['show', 'shows']},
  {id:'cartoons', name:'Cartoons', c:['#3a3216', '#1d2236'], s:'#f1dc6b', icon:'star', unit:['title', 'titles']},
  {id:'anime', name:'Anime', c:['#2e1a3a', '#1a1b33'], s:'#e0a8ff', icon:'spark', unit:['title', 'titles']}];
const SHELF_ICON = {
  movie:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  tv:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 3l3 3 3-3"/>',
  star:'<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  own:'<path d="M4 5h16v14H4z"/><path d="M4 9h16"/>',
  eye:'<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'};
function shelves(all){ const set = lsGet('nvCinema.shelves', {}), hid = set.hidden || {};
  let list = BASE.map(s => Object.assign({}, s, (set[s.id] || {}).name ? {name:set[s.id].name} : {})).concat((set._own || []).map(s => Object.assign({c:['#2a2f3a', '#1a1f2e'], s:'#c4cdd8', icon:'own', unit:['title', 'titles']}, s)));
  const ord = set._order || []; list = list.map((s, i) => [s, i]).sort((a, b) => (((ord.indexOf(a[0].id) + 1) || 999) - ((ord.indexOf(b[0].id) + 1) || 999)) || a[1] - b[1]).map(x => x[0]);
  if(TITLES.some(isWant)) list.push(WANT_SHELF);
  for(const s of list) s.hidden = !!hid[s.id];
  return all ? list : list.filter(s => !s.hidden) }
/* "want to see" (calendar, 22 Oct): a title from TMDB without a video yet - it keeps its real shelf and moves there when the video comes */
const isWant = t => !!t.want && !filesOf(t).length;
const WANT_SHELF = {id:'want', name:'Want to see', c:['#3a1626', '#2a1f36'], s:'#ff9db7', icon:'eye', unit:['title', 'titles']};
const shelfOf = id => shelves(true).find(s => s.id === id) || {id, name:id, c:['#2a2f3a', '#1a1f2e'], s:'#c4cdd8', icon:'own', unit:['title', 'titles']};
const shelfIcon = (s, size) => `<svg width="${size || 26}" height="${size || 26}" viewBox="0 0 24 24" fill="none" stroke="${s.s}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SHELF_ICON[s.icon] || SHELF_ICON.own}</svg>`;
const unit = (sh, n) => { const u = shelfOf(sh).unit || ['title', 'titles']; return plural(n, u[0], u[1]) };
function addOwnShelf(name){ name = String(name || '').trim(); if(!name) return null; const hit = shelves(true).find(s => norm(s.name) === norm(name)); if(hit) return hit.id;
  const set = lsGet('nvCinema.shelves', {}), id = 'x-' + (norm(name).replace(/ /g, '-') || uid()); set._own = (set._own || []).concat({id, name}); lsSet('nvCinema.shelves', set); return id }

/* =====================================================================================================================
   NAMES – what a file name (and its folders) says: a movie "Inception (2010)", an episode "Doctor Who S01E05", "Frieren - 05",
   "1x05", "Season 2/Episode 3"; quality words (1080p, x265, WEB-DL …) and [release group] tags are dropped.
   ===================================================================================================================== */
const VID_RE = /\.(mkv|mp4|m4v|mov|avi|webm|ts|m2ts|mts|wmv|mpg|mpeg|ogv|3gp|flv|divx)$/i;
const SUB_RE = /\.(srt|vtt|ass|ssa)$/i;
const JUNK = /(?:^|\s)(2160p|1440p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10\+?|hdr|dv|x264|x265|h 264|h 265|h264|h265|hevc|avc|xvid|divx|bluray|blu ray|bdrip|brrip|bdremux|remux|web dl|webdl|webrip|web|hdtv|dvdrip|dvdscr|dvd|hdrip|amzn|nf|dsnp|hmax|atvp|aac\d?|ac3|eac3|ddp\d?|dd5|dts|truehd|atmos|flac|10bit|8bit|hi10p|proper|repack|extended|unrated|remastered|directors cut|limited|internal|multi|dual audio|subbed|dubbed|nlsubs|nl subs)(?=\s|$)/i;
const EXTRA_DIR = /^(extras?|featurettes?|behind the scenes|deleted scenes|trailers?|samples?|bonus|interviews|shorts)$/i;
const SEASON_DIR = /^(?:season|seizoen|staffel|saison|series|s)\s*(\d{1,2})(?:\s.*)?$/i;
const GENERIC = /^(movie|film|video|main|feature|title\s*\d*|vts.*|video ts|untitled)$/i;
function cleanName(s){ s = String(s || '').replace(VID_RE, '').replace(SUB_RE, '');
  s = !/\s/.test(s) && /[._]/.test(s) ? s.replace(/[._]+/g, ' ') : s.replace(/_+/g, ' ');
  return s.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\((?![^)]*\b(?:19|20)\d\d\b)[^)]*\)/g, m => /[a-z]{4}/i.test(m) && !JUNK.test(m.slice(1, -1)) ? m : ' ').replace(/\s+/g, ' ').trim() }
const cutJunk = s => { const m = (' ' + s + ' ').match(JUNK); s = m ? s.slice(0, Math.max(0, m.index - 1)) : s; return s.replace(/[\s\-–.,:(\[]+$/, '').replace(/^[\s\-–.,:)\]]+/, '').trim() };
/* "Title (2010) 1080p" → {title, year}; the LAST year that isn't the start of the name (so "2001 A Space Odyssey (1968)" works) */
function titleYear(c){ const ys = [...c.matchAll(/(?:^|[\s(\[])((?:19|20)\d\d)(?=[\s)\]]|$)/g)].filter(m => m.index > 0);
  if(ys.length){ const m = ys[ys.length - 1], before = c.slice(0, m.index); return {title:cutJunk(before.replace(/[(\[]\s*$/, '')), year:+m[1]} }
  return {title:cutJunk(c), year:null} }
/* path = folders inside the picked folder + the file name, like "Doctor Who/Season 1/Doctor.Who.S01E05.mkv" */
function parseVideo(path){
  const parts = String(path).split('/').filter(Boolean), file = parts.pop(), dirs = parts;
  if(dirs.some(d => EXTRA_DIR.test(d))) return null;
  const c = cleanName(file);
  if(/(?:^|\s)sample$/i.test(c)) return null;
  let sd = null; const sdi = [...dirs].reverse().findIndex(d => SEASON_DIR.test(d) || /^specials?$/i.test(d));
  if(sdi >= 0){ const d = dirs[dirs.length - 1 - sdi]; sd = /^specials?$/i.test(d) ? 0 : +d.match(SEASON_DIR)[1] }
  const showDir = (() => { for(let i = dirs.length - 1; i >= 0; i--){ const d = dirs[i]; if(!(SEASON_DIR.test(d) || /^specials?$/i.test(d) || /^(disc|disk|cd|dvd)\s*\d+$/i.test(d))) return {name:d, depth:i} } return null })();
  const out = {file, dirs, dir:dirs.join('/'), showDir:showDir ? showDir.name : '', top:dirs[0] || ''};
  let m, show = null, s = null, e = null, e2 = null, rest = '';
  if((m = c.match(/^(.*?)[\s\-–.]*\bS(\d{1,2})\s?E(\d{1,4})(?:\s?-?\s?E(\d{1,4}))?(?![0-9])(.*)$/i))) [show, s, e, e2, rest] = [m[1], +m[2], +m[3], m[4] ? +m[4] : null, m[5]];
  else if((m = c.match(/^(.*?)[\s\-–.]*\b(\d{1,2})x(\d{2,3})(?![0-9])(.*)$/i))) [show, s, e, rest] = [m[1], +m[2], +m[3], m[4]];
  else if((m = c.match(/^(.*?)\b(?:season|seizoen|staffel)\s?(\d{1,2})[\s\-–.]*(?:episode|aflevering|ep|folge)\s?(\d{1,4})(?![0-9])(.*)$/i))) [show, s, e, rest] = [m[1], +m[2], +m[3], m[4]];
  else if((m = c.match(/^(.+?)\s[-–]\s(?:ep?\.?\s?)?(\d{1,4})(?:v\d)?(?=\s|$)(.*)$/i)) && !/^(19|20)\d\d$/.test(m[2])) [show, e, rest] = [m[1], +m[2], m[3]];
  else if((m = c.match(/^(.*?)\b(?:episode|aflevering|ep|e)\.?\s?(\d{1,4})(?![0-9])(.*)$/i)) && (m[1].trim() || showDir)) [show, e, rest] = [m[1], +m[2], m[3]];
  else if((m = c.match(/^(\d{1,3})(?:\s*[-–.)]\s*|\s+)(.+)$/)) && showDir && !/^(19|20)\d\d$/.test(m[1])) [show, e, rest] = ['', +m[1], m[2]];
  if(e != null){
    let sh = titleYear(cleanName(show || '')), yr = sh.year; let name = sh.title;
    if(!name && showDir){ const d = titleYear(cleanName(showDir.name)); name = d.title; yr = yr || d.year }
    if(!name) return Object.assign(out, {kind:'movie', name:titleYear(c).title || c, year:titleYear(c).year});
    if(s == null) s = sd != null ? sd : 1;
    return Object.assign(out, {kind:'show', name, year:yr, s, e, e2, etitle:cutJunk(rest.replace(/^[\s\-–.:]+/, ''))}) }
  let {title, year} = titleYear(c), part = null;
  const pm = title.match(/^(.*?)[\s\-–]*\b(?:cd|part|pt|disc|disk)\s?(\d)$/i); if(pm){ title = pm[1].trim(); part = +pm[2] }
  if(showDir && (!title || GENERIC.test(title) || (!year && titleYear(cleanName(showDir.name)).year && norm(titleYear(cleanName(showDir.name)).title).startsWith(norm(title).slice(0, 6))))){
    const d = titleYear(cleanName(showDir.name)); title = d.title || title; year = d.year || year }
  return Object.assign(out, {kind:'movie', name:title || c, year, part}) }
/* subtitles next to a video: "Movie.srt", "Movie.nl.srt", "Movie.English.forced.srt", or in a Subs folder */
function subLabel(subName, vidStem){ let x = subName.replace(SUB_RE, ''); if(vidStem && x.toLowerCase().startsWith(vidStem.toLowerCase())) x = x.slice(vidStem.length);
  x = x.replace(/^[\s._-]+/, '').replace(/[._]+/g, ' ').trim(); const LANG = {en:'English', eng:'English', nl:'Nederlands', nld:'Nederlands', dut:'Nederlands', fr:'Français', fre:'Français', de:'Deutsch', ger:'Deutsch', es:'Español', spa:'Español', ja:'日本語', jpn:'日本語', it:'Italiano'};
  return x.split(' ').map(w => LANG[w.toLowerCase()] || w).join(' ') || 'Subtitles' }

/* =====================================================================================================================
   TMDB – names, posters, story, genres, film series, seasons and episode names. The owner's own free key (Settings → TMDB),
   kept on this device only. TMDB allows web pages to ask it directly, so it works in the browser and in the Android app.
   ===================================================================================================================== */
const TKEY = () => lsGet('nvCinema.tmdb', '');
const IMG = (p, w) => p ? `https://image.tmdb.org/t/p/${w || 'w342'}${p}` : '';
let tmdbLast = 0;
async function tmdb(path, params){ const k = TKEY(); if(!k) throw new Error('Add your TMDB key first: ⚙ → TMDB.');
  const w = 120 - (Date.now() - tmdbLast); if(w > 0) await sleep(w); tmdbLast = Date.now();
  const u = new URL('https://api.themoviedb.org/3' + path); for(const [a, b] of Object.entries(params || {})) if(b != null && b !== '') u.searchParams.set(a, b);
  u.searchParams.set('language', S.lang || 'en-US'); const bearer = k.length > 60; if(!bearer) u.searchParams.set('api_key', k);
  let r; try{ r = await fetch(u, {headers:Object.assign({accept:'application/json'}, bearer ? {Authorization:'Bearer ' + k} : {})}) }catch(e){ throw new Error('Can’t reach TMDB - is there internet?') }
  if(r.status === 401) throw new Error('TMDB says the key is not right - check it in ⚙ → TMDB.');
  if(r.status === 429){ await sleep(1500); return tmdb(path, params) }
  if(!r.ok) throw new Error('TMDB answered ' + r.status); return r.json() }
const fromTm = (x, type) => ({type, id:x.id, title:x.title || x.name || '', orig:x.original_title || x.original_name || '', year:+(String(x.release_date || x.first_air_date || '').slice(0, 4)) || null,
  poster:x.poster_path || '', backdrop:x.backdrop_path || '', overview:x.overview || '', lang:x.original_language || ''});
async function tmSearch(q, kind, year){ const type = kind === 'show' ? 'tv' : 'movie';
  const r = await tmdb('/search/' + type, type === 'tv' ? {query:q, first_air_date_year:year || ''} : {query:q, year:year || ''});
  let l = (r.results || []).map(x => fromTm(x, type));
  if(!l.length && year){ const r2 = await tmdb('/search/' + type, {query:q}); l = (r2.results || []).map(x => fromTm(x, type)) }
  return l }
/* the best result for a title: same name (or original name), the same year counts extra; nothing is guessed from a different name */
function bestMatch(t, res){ let best = null, bs = 0;
  res.slice(0, 10).forEach((x, i) => { let sc = 0; if(norm(x.title) === norm(t.name) || norm(x.orig) === norm(t.name)) sc += 3; else if(norm(x.title).replace(/ /g, '') === norm(t.name).replace(/ /g, '')) sc += 3;
    if(t.year && x.year){ if(x.year === t.year) sc += 2; else if(Math.abs(x.year - t.year) === 1) sc += 1; else sc -= 1 } if(i === 0) sc += .5; if(sc > bs){ bs = sc; best = x } });
  return bs >= 3 ? best : null }
async function tmDetails(type, id){ return tmdb(`/${type}/${id}`) }
const sagaName = n => String(n || '').replace(/\s*[-–]?\s*(collection|collectie|filmreeks|reeks|sammlung|saga)$/i, '').trim();
/* fill in a title from TMDB; over = the owner picked this result himself, so the name and year follow it too */
async function applyTm(t, x, over){
  const d = await tmDetails(x.type, x.id).catch(e => { LE('tmdb', 'details', e); return null }) || {};
  t.tmdb = {type:x.type, id:x.id}; t.tmdbTried = 1;
  if(over || !t.name){ t.name = x.title || t.name } if(over || !t.year) t.year = x.year || t.year;
  const pos = d.poster_path || x.poster; if(pos && (over || !t.poster)) t.poster = pos;
  if((d.backdrop_path || x.backdrop) && (over || !t.backdrop)) t.backdrop = d.backdrop_path || x.backdrop;
  if((d.overview || x.overview) && (over || !t.overview)) t.overview = d.overview || x.overview;
  if(d.genres && d.genres.length && (over || !t.genres.length)) t.genres = d.genres.map(g => g.name);
  if(d.runtime) t.runtime = d.runtime; if(d.episode_run_time && d.episode_run_time[0]) t.runtime = d.episode_run_time[0];
  if(x.type === 'movie' && d.belongs_to_collection && d.belongs_to_collection.name && (over || !t.saga)) t.saga = sagaName(d.belongs_to_collection.name);
  if(x.type === 'movie') t.collId = d.belongs_to_collection ? d.belongs_to_collection.id : 0;
  if(x.type === 'tv' && d.seasons) t.seasons = Object.fromEntries(d.seasons.map(z => [z.season_number, {name:z.name, count:z.episode_count, poster:z.poster_path || ''}]));
  if(t.poster) keepPoster(t) }
/* episode names of one season (kept for a month) */
async function seasonInfo(t, n){ if(!t.tmdb || t.tmdb.type !== 'tv' || !TKEY()) return null; const id = `tms:${t.tmdb.id}:${n}:${S.lang}`;
  const c = await kvGet(id, null); if(c && Date.now() - c.at < 30 * 864e5) return c.d;
  try{ const r = await tmdb(`/tv/${t.tmdb.id}/season/${n}`); const d = (r.episodes || []).map(x => ({e:x.episode_number, name:x.name || '', still:x.still_path || '', over:x.overview || '', date:x.air_date || '', run:x.runtime || 0}));
    kvSet(id, {at:Date.now(), d}); return d }catch(e){ return c ? c.d : null } }
/* find TMDB info for new titles by themselves (only an exact name match) */
let AUTOQ = null;
async function autoMatch(list){ if(!TKEY()) return; if(AUTOQ){ AUTOQ.again = true; return }   // busy: look again when this round is done
  const todo = (list || TITLES).filter(t => !t.tmdb && !t.tmdbTried); if(!todo.length) return;
  AUTOQ = {n:0, of:todo.length}; let ok = 0;
  for(const t of todo){ if(!TM[t.id]) continue; AUTOQ.n++;
    try{ const x = bestMatch(t, await tmSearch(t.name, t.kind, t.year)); if(x){ await applyTm(t, x, false); ok++ } t.tmdbTried = 1; await dbPut('titles', t) }
    catch(e){ LE('tmdb', 'auto ' + t.name, e); if(/key|internet/i.test(e.message)) break }
    if(AUTOQ.n % 6 === 0){ regroup(); draw() } }
  const again = AUTOQ.again; AUTOQ = null; regroup(); draw(); if(ok) toast(`TMDB: details found for ${plural(ok, 'title')}`); if(again) autoMatch() }

/* =====================================================================================================================
   LIBRARY
   ===================================================================================================================== */
let TITLES = [], TM = {}, FILES = [], FM = {}, FBT = {}, WATCH = {};
async function loadLib(){ TITLES = await dbAll('titles'); FILES = await dbAll('files'); const ws = await dbAll('watch');
  for(const t of TITLES){ t.genres = t.genres || []; t.seasons = t.seasons || {} }
  for(const f of FILES) f.subs = f.subs || [];
  WATCH = Object.fromEntries(ws.map(w => [w.id, w])); reindex(); for(const k of await dbKeys('covers')) COV.add(k) }
function reindex(){ TM = Object.fromEntries(TITLES.map(t => [t.id, t])); FM = Object.fromEntries(FILES.map(f => [f.id, f])); FBT = {};
  for(const f of FILES) (FBT[f.tid] = FBT[f.tid] || []).push(f); for(const k of Object.keys(FBT)) FBT[k].sort(epOrder); regroup() }
const epOrder = (a, b) => ((a.s === 0 ? 999 : a.s || 0) - (b.s === 0 ? 999 : b.s || 0)) || ((a.e == null ? 1e6 : a.e) - (b.e == null ? 1e6 : b.e)) || ((a.part || 0) - (b.part || 0)) || coll.compare(a.name || '', b.name || '');
const filesOf = t => FBT[t.id] || [];
async function saveTitle(t){ t.edited = Date.now(); if(!TM[t.id]){ TITLES.push(t); TM[t.id] = t } await dbPut('titles', t); regroup() }
async function saveFile(f){ if(!FM[f.id]){ FILES.push(f); FM[f.id] = f; (FBT[f.tid] = FBT[f.tid] || []).push(f); FBT[f.tid].sort(epOrder) } await dbPut('files', f) }
async function dropFiles(ids){ const set = new Set(ids); if(!set.size) return; const bl = FILES.filter(f => set.has(f.id) && f.src && f.src.kind === 'copy').map(f => f.src.bid);
  const sb = FILES.filter(f => set.has(f.id)).flatMap(f => (f.subs || []).filter(x => x.kind === 'copy').map(x => x.bid));
  await dbDelMany('files', [...set]); await dbDelMany('watch', [...set]); if(bl.length || sb.length) await dbDelMany('blobs', bl.concat(sb));
  FILES = FILES.filter(f => !set.has(f.id)); for(const id of set) delete WATCH[id]; reindex() }
async function dropTitle(t){ await dropFiles(filesOf(t).map(f => f.id)); await dbDel('titles', t.id).catch(() => {}); for(const id of [t.id, 'p:' + t.id]) await dropCover(id);
  TITLES = TITLES.filter(x => x !== t); reindex() }
function newTitle(p, shelf){ return {id:'t' + uid(), shelf, kind:p.kind, name:p.name || 'Untitled', year:p.year || null, tmdb:null, tmdbTried:0, poster:'', backdrop:'', overview:'', genres:[],
  saga:'', runtime:0, seasons:{}, added:Date.now()} }
/* the title a new file belongs to: same shelf, same kind, same name (and for a movie the same year when both know it) */
function findTitle(shelf, p){ return TITLES.find(t => t.shelf === shelf && t.kind === p.kind && norm(t.name) === norm(p.name) && (p.kind === 'show' || !t.year || !p.year || t.year === p.year))
  || TITLES.find(t => t.shelf === shelf && t.kind === p.kind && t.tmdbName && norm(t.tmdbName) === norm(p.name)) || null }
/* where a file can be played from right now */
const onPhone = f => !!(f.local || f.src);
const onPc = f => !!f.pc;
const titleOnPhone = t => filesOf(t).some(onPhone);
const titleOnPc = t => filesOf(t).some(onPc);
const playable = f => onPhone(f) || (onPc(f) && PCON !== false);
/* watched: a file is done at the end (or after 92 %); a show counts its episodes */
const W = f => WATCH[f.id] || null;
const frac = f => { const w = W(f); return w && w.dur ? Math.min(1, w.pos / w.dur) : 0 };
const isDone = f => !!(W(f) && W(f).done);
const isStarted = f => { const w = W(f); return !!w && !w.done && w.pos > 20 };
async function setWatch(f, pos, dur, done, quiet){ const w = {id:f.id, pos:done ? 0 : Math.max(0, pos || 0), dur:dur || (W(f) || {}).dur || 0, done:!!done, at:Date.now()};
  WATCH[f.id] = w; await dbPut('watch', w); if(f.pc && !quiet) pcWatch(f, w) }
async function clearWatch(f){ delete WATCH[f.id]; await dbDel('watch', f.id); if(f.pc) pcWatch(f, {pos:0, dur:0, done:false}) }
/* episodes / parts that count (a movie in 2 parts counts as one) */
const mainFiles = t => t.kind === 'show' ? filesOf(t) : filesOf(t).filter((f, i, a) => !f.part || f.part === 1 || !a.some(x => x !== f && x.part === 1));
function seenState(t){ const fs = mainFiles(t); if(!fs.length) return 'new'; const d = fs.filter(isDone).length; if(d === fs.length) return 'seen'; if(d || fs.some(isStarted)) return 'started'; return 'new' }
const lastAt = t => Math.max(0, ...filesOf(t).map(f => (W(f) || {}).at || 0));
/* the next thing to play: a started episode, else the one after the last one you watched, else the first one not watched */
function nextUp(t){ const fs = filesOf(t).filter(f => f.s !== 0 || t.kind !== 'show'), ws = fs.filter(f => W(f)).sort((a, b) => W(b).at - W(a).at), last = ws[0];
  if(last && !isDone(last)) return last;
  if(last){ const i = fs.indexOf(last); const n = fs.slice(i + 1).find(f => !isDone(f) && (!f.part || f.part === 1)); if(n) return n }
  return fs.find(f => !isDone(f) && (!f.part || f.part === 1)) || null }
const epName = (t, f) => f.e != null ? (t.kind === 'show' ? `S${f.s}·E${f.e}${f.e2 ? '–' + f.e2 : ''}` : '') : '';
const fileLabel = (t, f, info) => t.kind === 'show' ? (f.e != null ? `${f.s === 0 ? 'Special' : 'S' + f.s} · E${f.e}${f.e2 ? '–' + f.e2 : ''}${(info && info.name) || f.etitle ? ' · ' + ((info && info.name) || f.etitle) : ''}` : cleanName(f.name)) : (f.part ? 'Part ' + f.part : cleanName(f.name));

/* =====================================================================================================================
   THE PC (Take with me – ../hub/nvpc.js): the PC app's Movies / Series / Anime and your own video collections, played over
   the home network; a file the phone can't play is converted by the PC while you watch. Where you are is kept on the PC too.
   ===================================================================================================================== */
let PCON = null, PCAT = 0, PCBUSY = false;
const hasPc = () => !!(window.NVPC && NVPC.pc);
function pcShelf(g){ const c = g.coll || '', n = g.collname || '';
  if(c === 'movie') return 'movies'; if(c === 'series') return 'tv'; if(c === 'anime') return 'anime';
  if(/cartoon|tekenfilm|animat/i.test(n)) return 'cartoons'; return addOwnShelf(n || 'From my PC') }
async function pcSync(fresh, quiet){ if(!hasPc() || PCBUSY) return; PCBUSY = true;
  try{ PCON = await NVPC.reachable(!!fresh); if(!PCON){ draw(); return }
    const j = await NVPC.list('video', null, fresh); await mergePc(j); PCAT = Date.now(); lsSet('nvCinema.pcAt', PCAT); if(!quiet) toast(`My PC: ${plural((j.groups || []).length, 'title')}`) }
  catch(e){ LE('pc', 'list', e); if(!quiet) toast(e.message || String(e), 5000) }
  finally{ PCBUSY = false; draw() } }
async function mergePc(j){ const groups = Object.fromEntries((j.groups || []).map(g => [g.gid, g])), seen = new Set(), now = Date.now(), tset = [], fset = [], wset = [];
  const byGid = {}; for(const t of TITLES) if(t.pcGid) byGid[t.pcGid] = t;
  for(const it of j.items || []){ const g = groups[it.gid]; if(!g) continue; seen.add(it.id);
    let t = byGid[g.gid];
    if(!t){ const shelf = pcShelf(g), p = {kind:g.kind === 'show' ? 'show' : 'movie', name:g.name || it.title || it.name, year:g.year || null};
      t = findTitle(shelf, p) || TITLES.find(x => x.want && x.kind === p.kind && norm(x.name) === norm(p.name)) || newTitle(p, shelf); t.pcGid = g.gid; if(t.want){ t.want = false; t.shelf = shelf } byGid[g.gid] = t; if(!TM[t.id]){ TITLES.push(t); TM[t.id] = t } }
    if(!tset.includes(t)) tset.push(t);
    t.pcCover = g.cover ? g.gid : ''; if(!t.overview && g.overview) t.overview = g.overview; if(!t.genres.length && g.genres) t.genres = g.genres;
    if(!t.tmdb && g.tmdb) t.tmdb = {type:g.tmdb.type, id:+g.tmdb.id}; if(!t.saga && g.saga) t.saga = g.saga; if(!t.year && g.year) t.year = g.year;
    const fs = filesOf(t), s = t.kind === 'show' ? (it.season != null ? +it.season : (it.number != null ? 1 : null)) : null, e = t.kind === 'show' && it.number != null ? +it.number : null;
    let f = fs.find(x => x.pc && x.pc.id === it.id) || (t.kind === 'show' && e != null ? fs.find(x => !x.pc && x.s === s && x.e === e) : fs.find(x => !x.pc && (x.name === it.name || (it.size && x.size === it.size))));
    if(!f){ const pp = parseVideo((it.dir ? it.dir + '/' : '') + it.name) || {};
      f = {id:'f' + uid(), tid:t.id, s:t.kind === 'show' ? (s != null ? s : pp.s != null ? pp.s : 1) : null, e:t.kind === 'show' ? (e != null ? e : pp.e != null ? pp.e : null) : null, e2:pp.e2 || null, part:pp.part || null,
        etitle:pp.etitle || '', name:it.name, size:it.size, dir:it.dir, src:null, subs:[], added:now}; FILES.push(f); FM[f.id] = f; (FBT[t.id] = FBT[t.id] || []).push(f) }
    f.pc = {id:it.id, name:it.name, size:it.size, ext:it.ext}; if(!f.size) f.size = it.size; fset.push(f);
    /* where you are: the newest of the phone and the PC wins */
    const w = W(f); if(it.wat && (!w || it.wat * 1000 > w.at + 5000) && (it.pos > 0 || it.fin)){ const nw = {id:f.id, pos:it.fin ? 0 : it.pos, dur:it.dur || (w || {}).dur || 0, done:!!it.fin, at:Math.round(it.wat * 1000)}; WATCH[f.id] = nw; wset.push(nw) } }
  /* gone from the PC: the PC part goes; a file / title with nothing left goes too */
  const gone = FILES.filter(f => f.pc && !seen.has(f.pc.id)); for(const f of gone){ f.pc = null; fset.push(f) }
  const empty = new Set(FILES.filter(f => !f.pc && !f.src && !f.local).map(f => f.id));
  await dbPutMany('titles', tset); await dbPutMany('files', fset.filter(f => !empty.has(f.id))); if(wset.length) await dbPutMany('watch', wset);
  if(empty.size) await dropFiles([...empty]); reindex();
  const bare = TITLES.filter(t => !filesOf(t).length && t.pcGid); for(const t of bare) await dropTitle(t);
  L('pc', 'merged', {items:(j.items || []).length, titles:tset.length, gone:gone.length}); autoMatch() }
let pcwT = {};
function pcWatch(f, w){ if(!hasPc() || PCON === false) return; clearTimeout(pcwT[f.id]);
  pcwT[f.id] = setTimeout(() => fetch(NVPC.url(`/nv/watch?id=${encodeURIComponent(f.pc.id)}&pos=${(w.pos || 0).toFixed(1)}&dur=${(w.dur || 0).toFixed(1)}&fin=${w.done ? 1 : 0}`)).catch(() => {}), 1500) }

/* =====================================================================================================================
   GROUPS – the shared way of every Nightvault app (../hub/nvgroups.js, plans/shared-groups.md), one engine per shelf.
   Automatic group = the film series: TMDB's collection ("Star Wars", "Shrek"), the PC app's collection, what you typed in
   Edit details, or a guess from the name ("Shrek 2" + "Shrek the Third" … → Shrek). A series needs 2+ titles. A TV show is
   one tile by itself – its seasons and episodes are on its page.
   ===================================================================================================================== */
function guessSeries(t){ t = String(t || '').trim(); let m = t.match(/^(.{3,}?)\s*(?::|\s[-–]\s)/); if(m) return m[1].replace(/\s+(?:[IVX]{1,5}|\d{1,3})$/, '').trim();
  m = t.match(/^(.{3,}?)\s+(?:[IVX]{1,5}|\d{1,2})(?:\s|$)/); if(m && !/^(19|20)\d\d$/.test(t.slice(m[1].length).trim())) return m[1].trim(); return '' }
let SNAMES = null;
const seriesNames = () => SNAMES || (SNAMES = new Set(TITLES.filter(t => t.kind === 'movie').map(t => norm(t.saga || guessSeries(t.name))).filter(Boolean)));
const seriesOf = t => t.saga || (S.guess && t.kind === 'movie' ? (guessSeries(t.name) || (seriesNames().has(norm(t.name)) ? t.name : '')) : '');
const GRS = {};
function grOf(sh){ if(GRS[sh]) return GRS[sh]; const s = shelfOf(sh);
  return GRS[sh] = NVGROUPS.make({prefix:'nvCinema.' + sh, app:'cinema-' + sh, title:'Cinema · ' + s.name, itemsKey:'itemGroup', norm, key:t => t.id,
    hay:t => [t.name, t.saga].filter(Boolean).join(' '), kinds:{saga:'Film series'},
    auto:t => { const x = seriesOf(t); return x ? {key:'s:' + norm(x), name:x, kind:'saga'} : null },
    onRekey:async (from, to) => { const id = 'grp:' + sh + ':' + from; if(!COV.has(id)) return; const c = await dbGet('covers', id).catch(() => null); if(c){ await setCover('grp:' + sh + ':' + to, c.blob); draw() } }}) }
let GROUPCACHE = {};
const regroup = () => { GROUPCACHE = {}; SNAMES = null };
const inShelf = sh => sh === 'want' ? TITLES.filter(isWant) : TITLES.filter(t => t.shelf === sh && filesOf(t).length);
const groupsOf = sh => GROUPCACHE[sh] || (GROUPCACHE[sh] = grOf(sh).build(inShelf(sh)));
const toTop = (G, key) => G.setParent(key, null);
const grChange = (sh, fn, msg) => { const G = grOf(sh); G.change(fn); regroup(); G.undoToast(msg, () => { regroup(); selEnd(true); draw() }) };
const groupByKey = (sh, k) => groupsOf(sh).groups.find(g => g.key === k) || null;
const groupOfTitle = (sh, t) => groupsOf(sh).groups.find(x => x.items.includes(t)) || null;

/* =====================================================================================================================
   COVERS – your own picture, else the poster kept on the phone (so it shows offline), else TMDB / the PC
   ===================================================================================================================== */
async function thumb(blob, w0){
  let bm; try{ bm = await createImageBitmap(blob) }catch(e){ const u = URL.createObjectURL(blob); try{ const im = new Image(); im.src = u; await im.decode(); bm = im }finally{ setTimeout(() => URL.revokeObjectURL(u), 1000) } }
  const w = Math.min(w0 || 400, bm.width), h = Math.round(bm.height * w / bm.width), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h); if(bm.close) bm.close();
  return new Promise(ok => c.toBlob(b => ok(b), 'image/webp', .85)) }
const COV = new Set(), COVURL = {};
async function coverUrl(id){ if(!COV.has(id)) return null; if(COVURL[id]) return COVURL[id]; const c = await dbGet('covers', id).catch(() => null); if(!c){ COV.delete(id); return null } return COVURL[id] = URL.createObjectURL(c.blob) }
async function setCover(id, blob){ await dbPut('covers', {id, blob}); COV.add(id); if(COVURL[id]){ URL.revokeObjectURL(COVURL[id]); delete COVURL[id] } }
async function dropCover(id){ await dbDel('covers', id).catch(() => {}); COV.delete(id); if(COVURL[id]){ URL.revokeObjectURL(COVURL[id]); delete COVURL[id] } }
const pcCoverUrl = t => t.pcCover && hasPc() ? NVPC.url('/nv/vcover?id=' + encodeURIComponent(t.pcCover)) : '';
const remoteCover = t => IMG(t.poster) || pcCoverUrl(t);
const hasCover = t => COV.has(t.id) || COV.has('p:' + t.id) || !!remoteCover(t);
/* keep a small copy of the poster on the phone, for the plane */
const KEEPING = new Set();
async function keepPoster(t){ const u = IMG(t.poster) || pcCoverUrl(t); if(!u || KEEPING.has(t.id)) return; KEEPING.add(t.id);
  try{ const r = await fetch(u); if(!r.ok) throw new Error(r.status); await setCover('p:' + t.id, await thumb(await r.blob(), 342)); t.posterKept = u }catch(e){} finally{ KEEPING.delete(t.id) } }
const covIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for(const e of es) if(e.isIntersecting){ covIO.unobserve(e.target); fillCov(e.target) } }, {rootMargin:'300px'}) : null;
function phHTML(t, label){ const h = hue(t.saga || t.name || '');
  return `<div class="ph" style="--c1:hsl(${h} 45% 28%);--c2:hsl(${(h + 40) % 360} 40% 14%)"><i>${t.kind === 'show' ? 'SERIES' : t.kind === 'movie' ? 'FILM' : ''}</i>${esc(label || t.name)}<span>${esc(t.year || '')}</span></div>` }
function coverHTML(t, cls, extra){ return `<div class="cv ${cls || ''}" data-cov="${esc(t.id)}">${phHTML(t)}${extra || ''}</div>` }
async function fillCov(el){ const id = el.dataset.cov, t = TM[id], own = await coverUrl(id), kept = t && (t.posterKept === remoteCover(t) || !remoteCover(t)) ? await coverUrl('p:' + id) : null;
  const cand = [...new Set([own, kept, t && remoteCover(t), t && pcCoverUrl(t), await coverUrl('p:' + id)].filter(Boolean))]; if(!cand.length) return;
  el.querySelectorAll('img').forEach(i => i.remove());
  el.insertAdjacentHTML('afterbegin', `<img class="b" alt=""><img class="f" alt="">`);
  const [b, f] = el.querySelectorAll('img'); let i = 0; const set = src => { b.src = src; f.src = src };
  f.onload = () => { const ph = el.querySelector('.ph'); if(ph) ph.style.display = 'none'; if(t && !own && !COV.has('p:' + t.id) && f.src.startsWith('http')) keepPoster(t) };
  f.onerror = () => { if(++i < cand.length) set(cand[i]); else { b.remove(); f.remove() } };
  set(cand[0]) }
function lazyCovers(root){ (root || document).querySelectorAll('[data-cov]').forEach(el => { const id = el.dataset.cov; if(!COV.has(id) && !COV.has('p:' + id) && !(TM[id] && remoteCover(TM[id]))) return; covIO ? covIO.observe(el) : fillCov(el) }) }
const RNDCOV = {};
const byName = (a, b) => coll.compare(norm(a.name), norm(b.name));
const sagaOrder = (a, b) => (a.year || 9999) - (b.year || 9999) || byName(a, b);
function groupCoverHTML(sh, g){ const G = grOf(sh), c = G.cover(g.key), all = (g.all || g.items).slice().sort(sagaOrder), wc = all.filter(hasCover);
  if(c.t === 'pic' && COV.has('grp:' + sh + ':' + g.key)) return `<div class="cv" data-cov="grp:${esc(sh)}:${esc(g.key)}">${phHTML({name:g.name}, g.name)}</div>`;
  let x = null; if(c.t === 'item') x = all.find(y => y.id === c.al);
  if(c.t === 'random' && wc.length){ x = wc.find(y => y.id === RNDCOV[g.key]) || wc[Math.floor(Math.random() * wc.length)]; RNDCOV[g.key] = x.id }
  x = x || wc[0] || all[0]; if(!x) return `<div class="cv">${phHTML({name:g.name}, g.name)}</div>`;
  const h = coverHTML(x); return c.t === 'cycle' && wc.length > 1 ? h.replace('<div class="cv ', `<div data-cycle="${esc(sh)}|${esc(g.key)}" class="cv `) : h }
const CYCI = {};
setInterval(() => { if(document.hidden || !$('#player').hidden) return;
  for(const el of document.querySelectorAll('#body [data-cycle]')){ const r = el.getBoundingClientRect(); if(r.bottom < 0 || r.top > innerHeight) continue;
    const [sh, k] = el.dataset.cycle.split('|'), g = groupByKey(sh, k); if(!g) continue; const wc = g.all.filter(hasCover).sort(sagaOrder); if(wc.length < 2) continue;
    CYCI[k] = ((CYCI[k] || 0) + 1) % wc.length; el.style.transition = 'opacity .45s'; el.style.opacity = 0;
    setTimeout(() => { el.dataset.cov = wc[CYCI[k]].id; fillCov(el).then(() => el.style.opacity = 1) }, 450) } }, 4000);

/* ---------- tiles ---------- */
function titleTile(t, sh){ const G = grOf(sh || t.shelf), st = seenState(t), fs = mainFiles(t), ph = titleOnPhone(t), pc = titleOnPc(t);
  const marks = [window.calIsNew && calIsNew(t) ? '<span class="ok">NEW EP</span>' : '', isWant(t) ? '<span style="color:#ff9db7">WANT</span>' : '', !ph && pc ? '<span class="pc">PC</span>' : '', ph && filesOf(t).some(f => f.local) ? '<span class="ok">SAVED</span>' : '', t.kind === 'show' && fs.length ? `<span>${plural(fs.length, 'ep')}</span>` : ''].filter(Boolean).join('');
  const prog = t.kind === 'movie' && st === 'started' ? `<span class="pbar"><i style="width:${Math.round(100 * frac(fs[0] || {id:''}))}%"></i></span>` : t.kind === 'show' && st === 'started' ? `<span class="pbar"><i style="width:${Math.round(100 * fs.filter(isDone).length / fs.length)}%"></i></span>` : '';
  const seasons = new Set(fs.map(f => f.s).filter(s => s)).size;
  return `<div class="bk${!ph && pc && PCON === false ? ' off' : ''}" data-title="${esc(t.id)}">${coverHTML(t, '', (G.isPinned('it:' + t.id) ? PINB : '') + (st === 'seen' ? '<span class="seen">✓</span>' : '') + (marks ? `<span class="vol">${marks}</span>` : '') + prog)}
    <div class="t">${esc(t.name)}</div><div class="a">${esc([t.year, t.kind === 'show' && seasons > 1 ? plural(seasons, 'season') : ''].filter(Boolean).join(' · ') || ' ')}</div></div>` }
function groupTile(sh, g){ const all = g.all || g.items, k = (g.kids || []).length, G = grOf(sh);
  return `<div class="bk stack" data-grp="${esc(g.key)}">${groupCoverHTML(sh, g)}${G.isPinned('gr:' + g.key) ? PINB : ''}<span class="cdl">${k ? plural(k, 'group') + ' · ' : ''}${all.length ? unit(sh, all.length) : 'empty'}</span>
    <div class="t">${esc(g.name)}</div><div class="a">${esc(G.label(g))}</div></div>` }

/* =====================================================================================================================
   SCREENS – a stack of views: shelves → shelf → group → title
   ===================================================================================================================== */
let V = [{v:'shelves'}];
const cur = () => V[V.length - 1];
function go(v){ selEnd(true); V.push(v); draw(); scrollTo(0, 0) }
function back(){ if(SEL){ selEnd(); return true } if(V.length > 1){ V.pop(); draw(); return true } return false }
$('#vback').onclick = () => back();
const Q = {};
/* sort menus: the same small menu on every page, each page remembers its own choice */
const SORTS = {shelf:[['name', 'Series & name'], ['added', 'Recently added'], ['watched', 'Recently watched'], ['new', 'Newest'], ['old', 'Oldest']],
  inside:[['saga', 'Series order (by year)'], ['name', 'Name'], ['added', 'Recently added'], ['watched', 'Recently watched'], ['new', 'Newest']]};
const sortOf = (page, key) => S.sort[key || page] || SORTS[page][0][0];
const sortSel = (page, key) => `<select data-sort="${page}" data-skey="${esc(key || page)}" aria-label="Sort">${SORTS[page].map(([k, t]) => `<option value="${k}" ${sortOf(page, key) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const addedAt = x => x.items ? Math.max(0, ...(x.all || x.items).map(t => t.added || 0)) : x.added || 0;
const watchedAt = x => x.items ? Math.max(0, ...(x.all || x.items).map(lastAt)) : lastAt(x);
const yearOf = (x, newest) => x.items ? (newest ? Math.max(0, ...(x.all || x.items).map(t => t.year || 0)) : Math.min(9999, ...(x.all || x.items).map(t => t.year || 9999))) : (x.year || (newest ? 0 : 9999));
const nameOf = x => x.items ? x.name : (seriesOf(x) ? seriesOf(x) + ' ' + String(x.year || '') + ' ' + x.name : x.name);
function sortTiles(list, k){ const byN = (a, b) => coll.compare(norm(nameOf(a)), norm(nameOf(b)));
  return list.slice().sort(k === 'added' ? (a, b) => addedAt(b) - addedAt(a) : k === 'watched' ? (a, b) => watchedAt(b) - watchedAt(a) || byN(a, b)
    : k === 'new' ? (a, b) => yearOf(b, true) - yearOf(a, true) || byN(a, b) : k === 'old' || k === 'saga' ? (a, b) => yearOf(a) - yearOf(b) || byN(a, b) : byN) }
const FILTERS = [['all', 'All'], ['new', 'Not watched'], ['phone', 'On this phone'], ['pc', 'On my PC']];
const passFilter = (t, f) => f === 'all' || (f === 'new' ? seenState(t) !== 'seen' : f === 'phone' ? titleOnPhone(t) : titleOnPc(t));
const hayOf = t => norm([t.name, t.saga, seriesOf(t), t.year, (t.genres || []).join(' '), shelfOf(t.shelf).name, t.kind === 'show' ? 'series show' : 'film movie'].join(' '));

function pcLineHTML(){ if(!window.NVPC || !NVPC.native) return '';
  if(!NVPC.pc) return `<div class="pcline"><i></i><span>Films on your PC? The Nightvault › <b>My PC</b> connects to the Nightvault PC app over your home Wi‑Fi.</span><a class="btn sm" href="../hub/index.html" style="text-decoration:none">My PC</a></div>`;
  const n = TITLES.filter(titleOnPc).length, at = lsGet('nvCinema.pcAt', 0);
  return `<div class="pcline ${PCON ? 'ok' : PCON === false ? 'no' : ''}"><i></i><span>${esc(NVPC.pc.name || 'My PC')}: ${PCBUSY ? 'getting the list…' : PCON === false ? 'not reachable now (at home? Nightvault running?)' : PCON ? 'connected' : 'checking…'}${n ? ' · ' + plural(n, 'title') : ''}${at && !PCBUSY ? ' · ' + new Date(at).toLocaleDateString() : ''}</span><button class="btn sm" id="pcref">${PCBUSY ? '…' : 'Refresh'}</button></div>` }

function contHTML(){ const l = TITLES.filter(t => lastAt(t) && nextUp(t) && filesOf(t).length).sort((a, b) => lastAt(b) - lastAt(a)).slice(0, 12);
  if(!l.length) return '';
  return `<div class="sec">Continue watching</div><div class="cont">${l.map(t => { const f = nextUp(t), w = W(f), p = w && w.dur && !w.done ? Math.round(100 * w.pos / w.dur) : 0;
    return `<div class="cw" data-cw="${esc(f.id)}"><div class="pic" data-cwpic="${esc(t.id)}"><div class="cv" style="position:absolute;inset:0;aspect-ratio:auto;border-radius:0">${phHTML(t)}</div><span class="pl">${IC_PLAY.replace('<svg ', '<svg width="22" height="22" ')}</span>${p ? `<span class="bar"><i style="width:${p}%"></i></span>` : ''}</div>
      <div class="t">${esc(t.name)}</div><div class="a">${esc(t.kind === 'show' ? fileLabel(t, f) : p ? mins((w.dur || 0) - (w.pos || 0)) + ' left' : 'Next part')}</div></div>` }).join('')}</div>` }
async function fillCont(){ for(const el of document.querySelectorAll('[data-cwpic]')){ const t = TM[el.dataset.cwpic]; if(!t) continue;
  const cand = [IMG(t.backdrop, 'w500'), await coverUrl(t.id), await coverUrl('p:' + t.id), remoteCover(t)].filter(Boolean); if(!cand.length) continue;
  const im = document.createElement('img'); im.alt = ''; let i = 0; im.onerror = () => { if(++i < cand.length) im.src = cand[i]; else im.remove() }; im.onload = () => { const c = el.querySelector('.cv'); if(c) c.remove() }; im.src = cand[0]; el.prepend(im) } }

function draw(){
  const v = cur(), body = $('#body'); $('#vback').hidden = V.length < 2; $('#addbtn').hidden = v.v === 'title';
  $('#hubback').hidden = !(fromHub() && V.length < 2);
  let h = '';
  if(v.v === 'shelves'){ $('#vtitle').textContent = 'Cinema'; document.title = 'Nightvault Cinema';
    const q = norm(Q._all || '');
    h += `<input type="search" id="q" placeholder="Search films, shows, series, genres" value="${esc(Q._all || '')}" style="margin:2px 0 8px">`;
    if(q){ const hits = TITLES.filter(t => (filesOf(t).length || t.want) && hayOf(t).includes(q)).sort(byName);
      h += hits.length ? `<div class="mtot">${plural(hits.length, 'title')}</div><div class="grid">${hits.slice(0, 300).map(t => titleTile(t, t.shelf).replace(/<div class="a">[^<]*<\/div>/, `<div class="a">${esc([t.year, shelfOf(t.shelf).name].filter(Boolean).join(' · '))}</div>`)).join('')}</div>` : '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
      body.innerHTML = h; lazyCovers(body); hookSearch('_all'); hookGrid(null); return }
    h += pcLineHTML() + contHTML() + (window.calTeaserHTML ? calTeaserHTML() : '');
    h += '<div class="shelves">' + shelves().map(s => { const ts = inShelf(s.id), eps = ts.filter(t => t.kind === 'show').length;
        const fan = ts.filter(hasCover).sort((a, b) => b.added - a.added).slice(0, 3);
        return `<div class="shelf" data-shelf="${esc(s.id)}" style="background:linear-gradient(150deg,${s.c[0]},${s.c[1]})"><div class="ic">${shelfIcon(s)}</div><div class="fan">${fan.map(t => `<img data-fan="${esc(t.id)}" alt="">`).join('')}</div>
          <b>${esc(s.name)}</b><div class="s">${ts.length ? (s.id === 'movies' || !eps ? unit(s.id, ts.length) : eps === ts.length ? plural(eps, 'show') : `${plural(ts.length - eps, 'film')} · ${plural(eps, 'show')}`) : 'empty'}</div></div>` }).join('') + '</div>';
    if(!TITLES.length) h += `<div class="empty" style="margin-top:18px">${shelfIcon({s:'#ffb0a8', icon:'movie'}, 48)}<h2 style="margin:8px 0 4px;font-size:18px">No films or shows yet</h2>
      <p class="muted small" style="margin:0 0 14px">${NATIVE ? 'Tap <b>Add</b> and pick the folder on this phone with your films and series - nothing is copied. Or connect your PC (The Nightvault › My PC) and watch what is on it.' : 'Tap <b>Add</b> and pick video files: they are copied into the app. (The Android app can also use a folder on the phone and your PC.)'}</p>
      <button class="btn primary" id="emptyadd">Add videos</button>${TKEY() ? '' : '<p class="muted small" style="margin:12px 0 0">Tip: add your free TMDB key (⚙ → TMDB) for posters, the story, film series and episode names.</p>'}</div>`;
    h += storeLine();
    body.innerHTML = h; hookSearch('_all'); fillCont();
    body.querySelectorAll('[data-fan]').forEach(async im => { const t = TM[im.dataset.fan], c = [await coverUrl(t.id), await coverUrl('p:' + t.id), remoteCover(t)].filter(Boolean); let i = 0; im.onerror = () => { if(++i < c.length) im.src = c[i]; else im.remove() }; if(c.length) im.src = c[0]; else im.remove() });
    if($('#emptyadd')) $('#emptyadd').onclick = () => addSheet(); if($('#pcref')) $('#pcref').onclick = () => pcSync(true);
    return }
  if(v.v === 'shelf'){ const s = shelfOf(v.shelf), all = inShelf(s.id), q = norm(Q[s.id] || ''), f = S.filter[s.id] || 'all', G = grOf(s.id);
    $('#vtitle').textContent = s.name; document.title = s.name + ' · Cinema';
    if(!all.length){ body.innerHTML = `<div class="empty">${shelfIcon(s, 48)}<h2 style="margin:8px 0 4px;font-size:18px">Nothing here yet</h2><p class="muted small" style="margin:0 0 14px">Tap <b>Add</b> to add videos to ${esc(s.name)}.</p><button class="btn primary" id="emptyadd">Add videos</button></div>`; $('#emptyadd').onclick = () => addSheet(); return }
    h += `<input type="search" id="q" placeholder="Search ${esc(s.name.toLowerCase())}, series, genres" value="${esc(Q[s.id] || '')}" style="margin:2px 0 8px">`;
    if(q){ const {groups:gs} = groupsOf(s.id), where = {}; for(const g of gs) for(const x of g.items) where[x.id] = G.path(g, gs);
      const gm = gs.filter(g => norm(g.name).includes(q)).slice(0, 12), bm = all.filter(t => hayOf(t).includes(q)).sort(byName);
      if(!gm.length && !bm.length) h += '<p class="muted" style="text-align:center;margin-top:30px">Nothing found.</p>';
      if(gm.length) h += `<div class="sec">Groups</div><div class="grid">${gm.map(g => groupTile(s.id, g).replace(/<div class="a">[^<]*<\/div>/, g.parent ? `<div class="a">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : '$&')).join('')}</div>`;
      if(bm.length) h += `<div class="sec">${esc(s.name)}</div><div class="grid">${bm.slice(0, 300).map(t => titleTile(t, s.id).replace(/<div class="a">[^<]*<\/div>/, where[t.id] ? `<div class="a">in ${esc(where[t.id])}</div>` : '$&')).join('')}</div>` }
    else { const pcAny = all.some(titleOnPc), phAny = all.some(titleOnPhone);
      h += `<div class="chips">${FILTERS.filter(([k]) => k === 'all' || k === 'new' || (pcAny && phAny)).map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${t}</button>`).join('')}</div>`;
      const grouped = S.grouped[s.id] !== false;
      h += `<div class="mbar"><select id="grouped" aria-label="Groups"><option value="1" ${grouped ? 'selected' : ''}>Grouped</option><option value="0" ${!grouped ? 'selected' : ''}>All ${esc(unit(s.id, 2).replace(/^2 /, ''))}</option></select>${sortSel('shelf', 'shelf:' + s.id)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button><button class="btn sm" id="newgrp">+ Group</button></div>`;
      const vis = all.filter(t => passFilter(t, f)), k = sortOf('shelf', 'shelf:' + s.id), seen = all.filter(t => seenState(t) === 'seen').length;
      h += `<div class="mtot">${unit(s.id, vis.length)}${f === 'all' && seen ? ` · ${seen} watched` : ''}</div>`;
      let tiles;
      if(!grouped || f !== 'all') tiles = sortTiles(vis, k);
      else { const {groups, singles} = groupsOf(s.id); tiles = sortTiles([...groups.filter(g => !g.parent), ...singles], k) }
      tiles = G.pinFirst(tiles, x => (x.items ? 'gr:' + x.key : 'it:' + x.id));
      h += `<div class="grid">${tiles.map(x => x.items ? groupTile(s.id, x) : titleTile(x, s.id)).join('')}</div>` }
    h += storeLine(s.id);
    body.innerHTML = h; lazyCovers(body); hookSearch(s.id); hookGrid(s.id); return }
  if(v.v === 'group'){ const G = grOf(v.shelf), g = groupByKey(v.shelf, v.key); if(!g){ V.pop(); return draw() }
    const gs = groupsOf(v.shelf).groups, all = g.all, ys = all.map(x => x.year).filter(Boolean), sk = 'grp:' + v.shelf + ':' + g.key, seen = all.filter(t => seenState(t) === 'seen').length;
    $('#vtitle').textContent = ''; document.title = g.name + ' · Cinema';
    h += `<div class="alhead"><div class="stack" style="flex:none"><div class="gcv" style="width:min(30vw,130px)">${groupCoverHTML(v.shelf, g)}</div></div><div style="min-width:0;flex:1"><b>${esc(g.name)}</b>
      ${g.parent ? `<div class="lnk small" data-gotogrp="${esc(g.parent)}">in ${esc(G.path(gs.find(x => x.key === g.parent), gs))}</div>` : ''}
      <div class="muted small">${esc(G.label(g))} · ${(g.kids || []).length ? plural(g.kids.length, 'group') + ' · ' : ''}${unit(v.shelf, all.length)}${ys.length ? ` · ${Math.min(...ys)}${Math.max(...ys) > Math.min(...ys) ? '–' + Math.max(...ys) : ''}` : ''}</div>
      <div class="muted small">${esc(shelfOf(v.shelf).name)}${seen ? ` · ${seen} of ${all.length} watched` : ''}</div></div><button class="ib" id="gmenu" aria-label="More for this group">${IC_DOTS}</button></div>`;
    const nx = all.slice().sort(sagaOrder).find(t => seenState(t) !== 'seen' && nextUp(t));
    if(nx) h += `<div class="mbar"><button class="btn primary" id="gplay" style="flex:1">${IC_PLAY.replace('<svg ', '<svg width="18" height="18" ')}${seenState(nx) === 'started' ? 'Continue' : 'Play'} · ${esc(nx.name)}</button></div>`;
    h += `<div class="mbar">${sortSel('inside', sk)}<span style="flex:1"></span><button class="btn sm" data-selstart="1">Select</button></div>`;
    const k = sortOf('inside', sk), kids = sortTiles(g.kids || [], k === 'saga' ? 'old' : k), items = k === 'saga' ? g.items.slice().sort(sagaOrder) : sortTiles(g.items, k);
    h += `<div class="grid">${G.pinFirst([...kids, ...items], x => (x.items ? 'gr:' + x.key : 'it:' + x.id)).map(x => x.items ? groupTile(v.shelf, x) : titleTile(x, v.shelf)).join('')}</div>`;
    if(!all.length) h += `<p class="muted small" style="margin-top:12px">Empty. Tap ⋯ → <b>Add…</b> to put titles in it.</p>`;
    body.innerHTML = h; lazyCovers(body); hookGrid(v.shelf); $('#gmenu').onclick = () => groupMenu(v.shelf, g);
    if($('#gplay')) $('#gplay').onclick = () => play(nextUp(nx)); return }
  if(v.v === 'cal') return drawCal();
  if(v.v === 'title') return drawTitle(v.id, v.shelf) }
function storeLine(sh){ const ts = sh ? inShelf(sh) : TITLES.filter(t => filesOf(t).length); if(!ts.length) return '';
  const fs = ts.flatMap(filesOf), ph = fs.filter(onPhone), sz = ph.reduce((n, f) => n + (f.src && f.src.kind === 'copy' || f.local ? f.size || 0 : 0), 0);
  return `<div class="store">${plural(ts.length, 'title')} · ${plural(fs.length, 'video')}${fs.some(onPc) ? ` · ${fs.filter(onPc).length} on the PC` : ''}${sz ? ` · ${mb(sz)} saved on this phone` : ''}</div>` }

/* clicks on the screens */
$('#body').addEventListener('click', e => {
  if(selSkip){ selSkip = false; return }
  const t = e.target, el = t.closest('[data-shelf],[data-title],[data-grp],[data-filter],[data-selstart],[data-gotogrp],[data-cw],#newgrp');
  if(!el) return; const v = cur();
  if(SEL && el.closest('.grid') && (el.dataset.title || el.dataset.grp)){ const id = el.dataset.title ? 'it:' + el.dataset.title : 'gr:' + el.dataset.grp; SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw(); return }
  if(el.id === 'newgrp') return newGroup(v.shelf);
  if(el.dataset.cw){ const f = FM[el.dataset.cw]; if(f) play(f); return }
  if(el.dataset.shelf) return go({v:'shelf', shelf:el.dataset.shelf});
  if(el.dataset.title){ const tt = TM[el.dataset.title]; return go({v:'title', id:el.dataset.title, shelf:(tt && tt.shelf) || v.shelf}) }
  if(el.dataset.grp) return go({v:'group', shelf:v.shelf, key:el.dataset.grp});
  if(el.dataset.gotogrp){ V.pop(); if(cur().v !== 'group' || cur().key !== el.dataset.gotogrp) V.push({v:'group', shelf:v.shelf, key:el.dataset.gotogrp}); return draw() }
  if(el.dataset.filter){ S.filter[v.shelf] = el.dataset.filter; saveS(); return draw() }
  if(el.dataset.selstart) return selStart() });
$('#body').addEventListener('change', e => { const t = e.target, v = cur();
  if(t.dataset.sort){ S.sort[t.dataset.skey] = t.value; saveS(); draw() }
  if(t.id === 'grouped'){ S.grouped[v.shelf] = t.value === '1'; saveS(); draw() } });
function hookSearch(k){ const q = $('#q'); if(!q) return; q.oninput = () => { Q[k] = q.value; clearTimeout(q._t); q._t = setTimeout(() => { const p = q.selectionStart; draw(); const n = $('#q'); if(n){ n.focus(); try{ n.setSelectionRange(p, p) }catch(e){} } }, 250) } }
/* long-press a tile: select it (then tap more tiles) */
let SEL = null, selSkip = false;
function hookGrid(sh){ if(!sh) return; document.querySelectorAll('#body .grid').forEach(gr => {
  let tmr = null, sx = 0, sy = 0;
  gr.onpointerdown = e => { const el = e.target.closest('.bk'); if(!el) return; sx = e.clientX; sy = e.clientY; clearTimeout(tmr);
    tmr = setTimeout(() => { const id = el.dataset.title ? 'it:' + el.dataset.title : el.dataset.grp ? 'gr:' + el.dataset.grp : null; if(!id) return; selSkip = true; if(!SEL) selStart(id); else { SEL.has(id) ? SEL.delete(id) : SEL.add(id); selDraw() } try{ navigator.vibrate && navigator.vibrate(20) }catch(e){} }, 520) };
  gr.onpointermove = e => { if(Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(tmr) };
  gr.onpointerup = gr.onpointercancel = () => clearTimeout(tmr);
  gr.oncontextmenu = e => { if(e.target.closest('.bk')) e.preventDefault() } }) }

/* =====================================================================================================================
   THE TITLE PAGE – a film (its file or parts) or a show (seasons and episodes)
   ===================================================================================================================== */
const EPI = {};         // episode names from TMDB per 'titleId:season'
function whereText(f){ const w = [];
  if(f.local) w.push('saved on this phone'); else if(f.src) w.push(f.src.kind === 'copy' ? 'in the app' : 'on this phone');
  if(f.pc) w.push('on the PC'); return w.join(' · ') }
function drawTitle(id, sh){ const t = TM[id]; if(!t){ V.pop(); return draw() }
  sh = sh || t.shelf; const grp = groupOfTitle(t.shelf, t), fs = filesOf(t), nx = nextUp(t), st = seenState(t);
  $('#vtitle').textContent = ''; document.title = t.name + ' · Cinema';
  const ser = seriesOf(t), size = fs.reduce((n, f) => n + (f.size || 0), 0);
  let h = `<div class="hero">${t.backdrop ? `<div class="bg" style="background-image:url('${esc(IMG(t.backdrop, 'w780'))}')"></div>` : ''}
    <div class="alhead" style="align-items:flex-end">${coverHTML(t)}<div style="min-width:0;flex:1"><b>${esc(t.name)}</b>
    ${ser ? `<div class="${grp ? 'lnk' : 'muted'} small" id="tgrp">${esc(grp ? grp.name : ser)}</div>` : ''}
    <div class="muted small">${esc([t.year, t.genres.slice(0, 3).join(', '), t.runtime ? mins(t.runtime * 60) + (t.kind === 'show' ? ' per episode' : '') : ''].filter(Boolean).join(' · '))}</div>
    <div style="margin-top:6px">${titleOnPhone(t) ? '<span class="tag ok">On this phone</span>' : ''}${titleOnPc(t) ? `<span class="tag pc">On my PC${PCON === false ? ' (not reachable)' : ''}</span>` : ''}${st === 'seen' ? '<span class="tag ok">✓ Watched</span>' : ''}</div></div></div></div>`;
  const nw = nx && W(nx), left = nw && nw.dur && !nw.done && nw.pos > 20 ? nw.dur - nw.pos : 0;
  h += `<div class="mbar">${nx ? `<button class="btn primary playbig" id="tplay">${IC_PLAY.replace('<svg ', '<svg width="20" height="20" ')}${left ? 'Continue' : st === 'seen' ? 'Watch again' : 'Play'}${t.kind === 'show' ? ' ' + esc(epName(t, nx)) : nx.part ? ' part ' + nx.part : ''}</button>` : (isWant(t) ? `<button class="btn playbig" id="tplay" disabled>♥ On your want-to-see list</button>` : `<button class="btn primary playbig" id="tplay" ${fs.length ? '' : 'disabled'}>${IC_PLAY.replace('<svg ', '<svg width="20" height="20" ')}Watch again</button>`)}<button class="ib" id="tmenu" aria-label="More for this title">${IC_DOTS}</button></div>`;
  if(left) h += `<div class="prog2"><i style="width:${Math.round(100 * nw.pos / nw.dur)}%"></i></div><div class="muted small" style="margin-top:4px">${mins(left)} left${t.kind === 'show' ? ' · ' + esc(fileLabel(t, nx)) : ''}</div>`;
  if(t.kind === 'show'){ const seasons = [...new Set(fs.map(f => f.s))].sort((a, b) => (a === 0 ? 999 : a) - (b === 0 ? 999 : b)), cs = V[V.length - 1].season != null && seasons.includes(V[V.length - 1].season) ? V[V.length - 1].season : (nx ? nx.s : seasons[0]);
    cur().season = cs;
    h += `<div class="sec">Episodes · ${plural(fs.length, 'episode')}${fs.filter(isDone).length ? ` · ${fs.filter(isDone).length} watched` : ''}</div>`;
    if(seasons.length > 1) h += `<div class="chips">${seasons.map(s => { const n = fs.filter(f => f.s === s), d = n.filter(isDone).length; return `<button class="chip ${s === cs ? 'on' : ''}" data-season="${s}">${s === 0 ? 'Specials' : (t.seasons[s] && t.seasons[s].name && !/^season \d+$/i.test(t.seasons[s].name) ? esc(t.seasons[s].name) : 'Season ' + s)}${d === n.length ? ' ✓' : ''}</button>` }).join('')}</div>`;
    h += `<div id="eps">${epsHTML(t, cs)}</div>` }
  else if(fs.length > 1){ h += `<div class="sec">Files</div>${fs.map(f => fileRow(t, f)).join('')}` }
  h += '<div id="tcal"></div>';
  if(t.overview) h += `<div class="sec">Story</div><div class="desc clip" id="tdesc">${esc(t.overview)}</div>${t.overview.length > 260 ? '<button class="btn sm" id="tmore" style="margin-top:6px">More</button>' : ''}`;
  const facts = [['Series', ser ? esc(ser) + (t.saga ? '' : ' <span class="muted">(guessed from the name)</span>') : ''], ['Year', esc(t.year || '')], ['Genres', esc(t.genres.join(', '))],
    ['Shelf', esc(shelfOf(t.shelf).name)], ['Videos', fs.length > 1 || t.kind === 'show' ? `${fs.length}${size ? ' · ' + mb(size) : ''}` : size ? mb(size) : ''],
    ['Where', esc([...new Set(fs.map(whereText))].join(' / '))],
    ['File', fs.length === 1 ? `<span class="small" style="overflow-wrap:anywhere">${esc((fs[0].dir ? fs[0].dir + '/' : '') + fs[0].name)}</span>` : ''],
    ['Links', t.tmdb ? `<a href="https://www.themoviedb.org/${t.tmdb.type}/${t.tmdb.id}" target="_blank" rel="noopener">TMDB</a>` : ''],
    ['Added', new Date(t.added).toLocaleDateString()]].filter(x => x[1]);
  h += `<div class="sec">Details</div><div class="facts">${facts.map(([k, v]) => `<span>${k}</span><span style="min-width:0;overflow-wrap:anywhere">${v}</span>`).join('')}</div>`;
  if(!t.tmdb && TKEY()) h += `<button class="btn sm" id="tlook">Find it on TMDB (poster, story, series)</button>`;
  if(t.tmdb) h += `<p class="muted small" style="margin-top:14px">Info and pictures: TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB.</p>`;
  $('#body').innerHTML = h; lazyCovers($('#body'));
  $('#tmenu').onclick = () => titleMenu(t, sh);
  $('#tplay').onclick = () => { const f = nx || mainFiles(t)[0]; if(f) play(f, nx ? {} : {from:0}) };
  if($('#tmore')) $('#tmore').onclick = () => { $('#tdesc').classList.remove('clip'); $('#tmore').remove() };
  if($('#tlook')) $('#tlook').onclick = () => lookupSheet(t, true);
  if($('#tgrp')) $('#tgrp').onclick = () => { if(grp) go({v:'group', shelf:t.shelf, key:grp.key}) };
  $('#body').querySelectorAll('[data-season]').forEach(b => b.onclick = () => { cur().season = +b.dataset.season; drawTitle(id, sh) });
  hookFiles(t);
  if(window.calTitle) calTitle(t);
  if(t.kind === 'show') loadEpInfo(t, cur().season) }
function fileRow(t, f){ const w = W(f), p = w && w.dur && !w.done ? Math.round(100 * w.pos / w.dur) : 0, ok = playable(f);
  return `<div class="ep${isDone(f) ? ' seen' : ''}${ok ? '' : ' off'}" data-file="${esc(f.id)}"><div class="no">${f.part ? 'Part ' + f.part : IC_PLAY.replace('<svg ', '<svg width="20" height="20" ')}${p ? `<span class="bar"><i style="width:${p}%"></i></span>` : ''}</div>
    <div class="n"><div>${esc(f.part ? 'Part ' + f.part : cleanName(f.name))}</div><div class="s">${esc([w && w.dur ? mins(w.dur) : '', f.size ? mb(f.size) : '', whereText(f)].filter(Boolean).join(' · '))}</div></div>
    ${isDone(f) ? '<span class="mk">✓</span>' : ''}<button class="ib" data-fmenu="${esc(f.id)}" aria-label="More" style="width:36px;height:36px;border:0;background:none">${IC_DOTS}</button></div>` }
function epsHTML(t, s){ const info = EPI[t.id + ':' + s] || [], by = Object.fromEntries(info.map(x => [x.e, x]));
  return filesOf(t).filter(f => f.s === s).map(f => { const w = W(f), p = w && w.dur && !w.done ? Math.round(100 * w.pos / w.dur) : 0, x = by[f.e] || {}, ok = playable(f);
    return `<div class="ep${isDone(f) ? ' seen' : ''}${ok ? '' : ' off'}" data-file="${esc(f.id)}"><div class="no">${x.still ? `<img src="${esc(IMG(x.still, 'w185'))}" alt="" onerror="this.remove()">` : ''}${f.e != null ? 'E' + f.e + (f.e2 ? '–' + f.e2 : '') : '▶'}${p ? `<span class="bar"><i style="width:${p}%"></i></span>` : ''}</div>
      <div class="n"><div>${esc(x.name || f.etitle || (f.e != null ? 'Episode ' + f.e : cleanName(f.name)))}</div><div class="s">${esc([x.date ? x.date.slice(0, 4) : '', w && w.dur ? mins(w.dur) : x.run ? mins(x.run * 60) : '', whereText(f)].filter(Boolean).join(' · '))}</div></div>
      ${isDone(f) ? '<span class="mk">✓</span>' : ''}<button class="ib" data-fmenu="${esc(f.id)}" aria-label="More" style="width:36px;height:36px;border:0;background:none">${IC_DOTS}</button></div>` }).join('') }
function hookFiles(t){ $('#body').querySelectorAll('[data-file]').forEach(el => el.onclick = e => { const m = e.target.closest('[data-fmenu]'), f = FM[el.dataset.file]; if(!f) return; if(m) return fileMenu(t, f); play(f) }) }
async function loadEpInfo(t, s){ const k = t.id + ':' + s; if(EPI[k] || !t.tmdb || t.tmdb.type !== 'tv' || !TKEY()) return;
  const d = await seasonInfo(t, s); if(!d) return; EPI[k] = d; const v = cur(); if(v.v === 'title' && v.id === t.id && v.season === s && $('#eps')){ $('#eps').innerHTML = epsHTML(t, s); hookFiles(t) } }

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
   TITLE ⋯ and FILE ⋯
   ===================================================================================================================== */
function titleMenu(t, sh){ const G = grOf(t.shelf), pin = G.isPinned('it:' + t.id), fs = filesOf(t), pcOnly = fs.filter(f => f.pc && !f.local && !f.src), saved = fs.filter(f => f.local), seen = seenState(t) === 'seen';
  sheet(`<h3>${esc(t.name)}</h3><div class="mlist">
    ${pcOnly.length ? `<button class="btn primary" id="tmsave">Save to phone (for a trip)</button>` : ''}${saved.length ? `<button class="btn" id="tmunsave">Remove the phone copy (${mb(saved.reduce((n, f) => n + (f.local.size || f.size || 0), 0))})</button>` : ''}
    ${window.NvTvP ? '<button class="btn" id="tmtv">📺 Play on TV</button>' : ''}<button class="btn" id="tmseen">${seen ? 'Mark as not watched' : 'Mark as watched'}</button>
    <button class="btn" id="tmg">Put in a group…</button><button class="btn" id="tmp">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    <button class="btn" id="tme">Edit details</button>${TKEY() ? `<button class="btn" id="tml">${t.tmdb ? 'Find the right title again (TMDB)' : 'Find it on TMDB'}</button>` : ''}
    <button class="btn" id="tmc">Change the poster</button><button class="btn" id="tmsh">Move to another shelf</button>
    ${t.kind === 'movie' ? '<button class="btn" id="tmk">This is a TV show (episodes)</button>' : '<button class="btn" id="tmk">This is a film, not a show</button>'}
    <button class="btn danger" id="tmx">${isWant(t) ? 'Take it off my want-to-see list' : 'Remove from Cinema'}</button></div>
    <p class="muted small" style="margin:10px 0 0">Groups are per shelf: this changes “${esc(shelfOf(t.shelf).name)}”. Removing never deletes the video files themselves (only copies made inside the app).</p>`);
  if($('#tmsave')) $('#tmsave').onclick = () => saveSheet(t, pcOnly);
  if($('#tmunsave')) $('#tmunsave').onclick = () => unsave(saved);
  if($('#tmtv')) $('#tmtv').onclick = () => { const f = nextUp(t) || mainFiles(t)[0]; if(f) tvSheet(f) };
  $('#tmseen').onclick = async () => { for(const f of mainFiles(t)) seen ? await clearWatch(f) : await setWatch(f, 0, (W(f) || {}).dur, true); closeSheet(); draw(); toast(seen ? 'Marked as not watched' : 'Marked as watched') };
  $('#tmg').onclick = () => groupPicker(t, t.shelf);
  $('#tmp').onclick = () => { G.togglePin(['it:' + t.id], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  $('#tme').onclick = () => editTitle(t); if($('#tml')) $('#tml').onclick = () => lookupSheet(t, true);
  $('#tmc').onclick = () => posterSheet(t); $('#tmsh').onclick = () => shelfPicker([t]);
  $('#tmk').onclick = async () => { t.kind = t.kind === 'movie' ? 'show' : 'movie';
    for(const f of fs){ const p = parseVideo((f.dir ? f.dir + '/' : '') + f.name) || {}; if(t.kind === 'show'){ f.s = p.s != null ? p.s : 1; f.e = p.e != null ? p.e : (fs.indexOf(f) + 1) } else { f.s = f.e = null } await dbPut('files', f) }
    t.tmdb = null; t.tmdbTried = 0; await saveTitle(t); reindex(); closeSheet(); draw(); toast(t.kind === 'show' ? 'Now a TV show' : 'Now a film') };
  $('#tmx').onclick = async () => { if(isWant(t)){ await dropTitle(t); closeSheet(); V.pop(); draw(); toast('Taken off your want-to-see list'); return } removeTitles([t.id]) } }
async function removeTitles(ids){ const ts = ids.map(id => TM[id]).filter(Boolean); if(!ts.length) return;
  const pcs = ts.filter(titleOnPc).length;
  if(!confirm(`Remove ${ts.length === 1 ? '“' + ts[0].name + '”' : plural(ts.length, 'title')} from Cinema?${pcs ? '\n\nFilms and shows on your PC come back the next time the list is read from the PC (hide a PC collection in the PC app instead).' : ''}\n\nThe video files themselves are not deleted; copies made inside the app and phone copies saved from the PC are.`)) return;
  for(const t of ts){ const saved = filesOf(t).filter(f => f.local); if(saved.length) await unsave(saved, true); await dropTitle(t) }
  closeSheet(); selEnd(true); if(cur().v === 'title' && !TM[cur().id]) V.pop(); draw(); toast(plural(ts.length, 'title') + ' removed') }
function fileMenu(t, f){ const w = W(f), done = isDone(f);
  sheet(`<h3>${esc(fileLabel(t, f, (EPI[t.id + ':' + f.s] || []).find(x => x.e === f.e)))}</h3><p class="muted small" style="margin:0 0 8px;overflow-wrap:anywhere">${esc((f.dir ? f.dir + '/' : '') + f.name)}${f.size ? ' · ' + mb(f.size) : ''}<br>${esc(whereText(f))}</p><div class="mlist">
    <button class="btn primary" id="fmplay">${w && !w.done && w.pos > 20 ? 'Continue at ' + tfmt(w.pos) : 'Play'}</button>${window.NvTvP ? '<button class="btn" id="fmtv">📺 Play on TV</button>' : ''}${w && !w.done && w.pos > 20 ? '<button class="btn" id="fmstart">Play from the start</button>' : ''}
    <button class="btn" id="fmseen">${done ? 'Mark as not watched' : 'Mark as watched'}</button>
    ${t.kind === 'show' ? '<button class="btn" id="fmupto">Mark all before this one as watched</button>' : ''}
    ${f.pc && !f.local && !f.src ? '<button class="btn" id="fmsave">Save to phone</button>' : ''}${f.local ? '<button class="btn" id="fmunsave">Remove the phone copy</button>' : ''}
    <button class="btn" id="fmnum">${t.kind === 'show' ? 'Change season / episode number' : 'Change the part number'}</button>
    <button class="btn" id="fmmove">Belongs to another title…</button>
    ${f.src || f.local ? '<button class="btn danger" id="fmx">Remove this video from Cinema</button>' : ''}</div>`);
  $('#fmplay').onclick = () => { closeSheet(); play(f) }; if($('#fmtv')) $('#fmtv').onclick = () => tvSheet(f); if($('#fmstart')) $('#fmstart').onclick = () => { closeSheet(); play(f, {from:0}) };
  $('#fmseen').onclick = async () => { done ? await clearWatch(f) : await setWatch(f, 0, (w || {}).dur, true); closeSheet(); draw() };
  if($('#fmupto')) $('#fmupto').onclick = async () => { const fs = filesOf(t), i = fs.indexOf(f); for(const x of fs.slice(0, i)) if(!isDone(x) && (x.s !== 0 || f.s === 0)) await setWatch(x, 0, (W(x) || {}).dur, true); closeSheet(); draw(); toast('Marked as watched') };
  if($('#fmsave')) $('#fmsave').onclick = () => saveSheet(t, [f]);
  if($('#fmunsave')) $('#fmunsave').onclick = () => unsave([f]);
  $('#fmnum').onclick = async () => { const cur0 = t.kind === 'show' ? `${f.s}x${f.e == null ? '' : f.e}` : String(f.part || '');
    const v = await ask(t.kind === 'show' ? 'Season x episode (like 2x05, 0 = specials)' : 'Part number (empty = none)', t.kind === 'show' ? '1x01' : '1', cur0, 'Save'); if(v == null) return;
    if(t.kind === 'show'){ const m = v.match(/^\s*(\d{1,2})\s*[x×.\s]\s*(\d{1,4})\s*$/i) || v.match(/^\s*s(\d{1,2})\s*e(\d{1,4})\s*$/i); if(!m){ toast('Type it like 2x05'); return } f.s = +m[1]; f.e = +m[2]; f.e2 = null }
    else f.part = parseInt(v) || null;
    await dbPut('files', f); reindex(); draw() };
  $('#fmmove').onclick = () => moveFileSheet(t, f);
  if($('#fmx')) $('#fmx').onclick = async () => { if(!confirm('Remove this video from Cinema? (The file in your phone folder stays; a copy inside the app is deleted.)')) return;
    if(f.local) await unsave([f], true); await dropFiles([f.id]); if(!filesOf(t).length) await dropTitle(t); closeSheet(); if(!TM[t.id]) V.pop(); draw() } }
/* a file that landed in the wrong title: move it to another one (or a new one) */
function moveFileSheet(t, f){ let q = '';
  const drawL = () => { const nq = norm(q), l = TITLES.filter(x => x !== t && x.shelf === t.shelf && (!nq || norm(x.name).includes(nq))).sort(byName).slice(0, 200);
    $('#mflist').innerHTML = l.map(x => `<div class="li" data-mf="${esc(x.id)}"><span class="th">${coverHTML(x)}</span><div class="n"><div>${esc(x.name)}</div><div class="s">${esc([x.year, x.kind === 'show' ? 'TV show' : 'Film'].filter(Boolean).join(' · '))}</div></div></div>`).join('') || '<p class="muted small">Nothing found.</p>'; lazyCovers($('#mflist')) };
  sheet(`<h3>Where does this video belong?</h3><p class="muted small" style="margin:0 0 8px;overflow-wrap:anywhere">${esc(f.name)}</p><button class="btn" id="mfnew" style="width:100%;margin-bottom:8px">A new title of its own</button><input type="search" id="mfq" placeholder="Search ${esc(shelfOf(t.shelf).name.toLowerCase())}"><div id="mflist" style="max-height:48vh;overflow:auto;margin-top:8px"></div>`);
  $('#mfq').oninput = e => { q = e.target.value; drawL() }; drawL();
  const moveTo = async to => { f.tid = to.id; if(to.kind === 'show' && f.e == null){ const p = parseVideo(f.name) || {}; f.s = p.s != null ? p.s : 1; f.e = p.e != null ? p.e : filesOf(to).length + 1 } await dbPut('files', f); reindex();
    if(!filesOf(t).length) await dropTitle(t); closeSheet(); V.pop(); go({v:'title', id:to.id, shelf:to.shelf}); toast('Moved') };
  $('#mfnew').onclick = async () => { const p = parseVideo((f.dir ? f.dir + '/' : '') + f.name) || {kind:'movie', name:cleanName(f.name)}; const n = await ask('Name of the new title', '', p.name, 'Make it'); if(!n) return;
    const nt = newTitle({kind:'movie', name:n, year:p.year}, t.shelf); await saveTitle(nt); f.s = f.e = null; await moveTo(nt) };
  $('#mflist').onclick = e => { const r = e.target.closest('[data-mf]'); if(r) moveTo(TM[r.dataset.mf]) } }
function editTitle(t){
  sheet(`<h3>Edit details</h3>
    <div class="field"><label>Name</label><input type="text" id="ed_name" value="${esc(t.name)}"></div>
    <div class="field"><label>Film series (films with the same series make one tile)</label><input type="text" id="ed_saga" value="${esc(t.saga || '')}" ${!t.saga && seriesOf(t) ? `placeholder="${esc(seriesOf(t))} (guessed)"` : ''}></div>
    <div class="field"><label>Year</label><input type="number" id="ed_year" value="${esc(t.year || '')}"></div>
    <div class="field"><label>Genres (with commas)</label><input type="text" id="ed_genres" value="${esc(t.genres.join(', '))}"></div>
    <div class="field"><label>Story</label><textarea id="ed_over">${esc(t.overview || '')}</textarea></div>
    <div style="display:flex;gap:8px;margin-top:6px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="edsave">Save</button></div>`, true);
  $('#edsave').onclick = async () => { const n = $('#ed_name').value.trim(); if(!n){ toast('It needs a name'); return } t.name = n; t.saga = $('#ed_saga').value.trim(); t.overview = $('#ed_over').value.trim();
    const y = parseInt($('#ed_year').value); t.year = y > 1880 && y < 2200 ? y : null; t.genres = $('#ed_genres').value.split(',').map(x => x.trim()).filter(Boolean);
    await saveTitle(t); closeSheet(); draw(); toast('Saved') } }
/* TMDB: find the right film / show for this tile */
function lookupSheet(t, over){
  sheet(`<h3>Find “${esc(t.name)}” on TMDB</h3><div class="chips"><button class="chip ${t.kind === 'movie' ? 'on' : ''}" data-lk="movie">Film</button><button class="chip ${t.kind === 'show' ? 'on' : ''}" data-lk="show">TV show</button></div>
    <div style="display:flex;gap:8px"><input type="search" id="lkq" value="${esc(t.name + (t.year ? ' ' + t.year : ''))}"><button class="btn primary" id="lkgo">Search</button></div><div id="lkres" style="margin-top:8px"></div>`, true);
  let kind = t.kind;
  const run = async () => { const el = $('#lkres'); el.innerHTML = '<div class="prog busy"><i></i></div>'; let res;
    const raw = $('#lkq').value.trim(), ym = raw.match(/\s((?:19|20)\d\d)$/), q = ym ? raw.slice(0, ym.index) : raw;
    try{ res = await tmSearch(q, kind, ym ? +ym[1] : null) }catch(e){ el.innerHTML = `<p class="note bad">${esc(e.message)}</p>`; return }
    el.innerHTML = res.slice(0, 20).map((x, i) => `<div class="li" data-lr="${i}"><span class="th"><div class="cv">${x.poster ? `<img class="f" src="${esc(IMG(x.poster, 'w92'))}" alt="" style="object-fit:cover">` : phHTML({name:x.title, kind})}</div></span><div class="n"><div>${esc(x.title)}${x.orig && norm(x.orig) !== norm(x.title) ? ` <span class="muted small">(${esc(x.orig)})</span>` : ''}</div><div class="s">${esc([x.year, x.overview.slice(0, 90)].filter(Boolean).join(' · '))}</div></div></div>`).join('') || '<p class="muted small">Nothing found - try fewer words, or the other kind (film / TV show).</p>';
    el.onclick = async e => { const r = e.target.closest('[data-lr]'); if(!r) return; const x = res[+r.dataset.lr]; el.innerHTML = '<div class="prog busy"><i></i></div>';
      if(kind !== t.kind){ t.kind = kind; for(const f of filesOf(t)){ if(kind === 'show' && f.e == null){ const p = parseVideo(f.name) || {}; f.s = p.s != null ? p.s : 1; f.e = p.e != null ? p.e : filesOf(t).indexOf(f) + 1 } if(kind === 'movie'){ f.s = f.e = null } await dbPut('files', f) } }
      t.poster = ''; t.backdrop = ''; t.overview = over ? '' : t.overview; if(over){ t.genres = []; t.saga = '' }
      await applyTm(t, x, true); await dropCover('p:' + t.id); keepPoster(t); for(const k of Object.keys(EPI)) if(k.startsWith(t.id + ':')) delete EPI[k];
      await saveTitle(t); reindex(); closeSheet(); draw(); toast('Details filled in') } };
  $('.sheet').querySelectorAll('[data-lk]').forEach(b => b.onclick = () => { kind = b.dataset.lk; $('.sheet').querySelectorAll('[data-lk]').forEach(x => x.classList.toggle('on', x === b)); run() });
  $('#lkgo').onclick = run; $('#lkq').onkeydown = e => { if(e.key === 'Enter') run() }; run() }
/* posters: TMDB's other posters, the PC app's poster, or a picture from the phone */
function posterSheet(t){
  sheet(`<h3>Poster of “${esc(t.name)}”</h3><div class="grid" id="psopts" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${pcCoverUrl(t) ? `<div class="bk" data-pc="1"><div class="cv"><img class="f" src="${esc(pcCoverUrl(t))}" alt="" onerror="this.closest('.bk').remove()"></div><div class="a">From the PC</div></div>` : ''}</div>
    <div class="mlist" style="margin-top:10px"><button class="btn" id="pspic">A picture from the phone</button>${COV.has(t.id) ? '<button class="btn" id="psown">Stop using my own picture</button>' : ''}</div>`);
  const use = async p => { if(COV.has(t.id)) await dropCover(t.id); await dropCover('p:' + t.id); t.poster = p; await saveTitle(t); keepPoster(t); closeSheet(); draw(); toast('Poster changed') };
  if(t.tmdb && TKEY()) tmdb(`/${t.tmdb.type}/${t.tmdb.id}/images`, {include_image_language:`${(S.lang || 'en').slice(0, 2)},en,null`}).then(r => { const el = $('#psopts'); if(!el) return;
    el.insertAdjacentHTML('afterbegin', (r.posters || []).slice(0, 30).map(p => `<div class="bk" data-pp="${esc(p.file_path)}"><div class="cv"><img class="f" src="${esc(IMG(p.file_path, 'w185'))}" alt="" style="object-fit:cover"></div></div>`).join('')) }).catch(() => {});
  $('.sheet').addEventListener('click', async e => { const o = e.target.closest('[data-pp]'); if(o) return use(o.dataset.pp);
    if(e.target.closest('[data-pc]')){ try{ const r = await fetch(pcCoverUrl(t)); await setCover(t.id, await thumb(await r.blob(), 400)); closeSheet(); draw(); toast('Poster changed') }catch(err){ toast('Could not get it from the PC') } } });
  $('#pspic').onclick = () => { const i = $('#pickpic'); i.value = ''; i.onchange = async e => { const f = e.target.files[0]; if(!f) return; await setCover(t.id, await thumb(f, 500)); closeSheet(); draw(); toast('Poster changed') }; i.click() };
  if($('#psown')) $('#psown').onclick = async () => { await dropCover(t.id); closeSheet(); draw() } }
function shelfPicker(ts){
  sheet(`<h3>Move ${ts.length === 1 ? '“' + esc(ts[0].name) + '”' : plural(ts.length, 'title')} to…</h3><div class="mlist">${shelves(true).map(s => `<button class="btn" data-msh="${esc(s.id)}" style="justify-content:flex-start">${shelfIcon(s, 20)}${esc(s.name)}</button>`).join('')}
    <button class="btn" id="mshnew">+ A new shelf…</button></div>`);
  const to = async sh => { for(const t of ts){ t.shelf = sh; await saveTitle(t) } closeSheet(); selEnd(true); regroup(); if(cur().v === 'title') cur().shelf = sh; draw(); toast(`Moved to ${shelfOf(sh).name}`) };
  $('.sheet').querySelectorAll('[data-msh]').forEach(b => b.onclick = () => to(b.dataset.msh));
  $('#mshnew').onclick = async () => { const n = await ask('Name of the new shelf', 'Like Documentaries or Kids', '', 'Make it'); if(n) to(addOwnShelf(n)) } }

/* =====================================================================================================================
   GROUPS: menus (the same words as Music, Bookcase and Games)
   ===================================================================================================================== */
function newGroup(sh){ ask('New group', 'Name, like Star Wars or Pixar', '', 'Make the group').then(n => { if(!n) return; const G = grOf(sh); G.own(n); regroup();
  const g = groupByKey(sh, 'c:' + norm(n)); S.grouped[sh] = true; saveS(); draw(); toast(`Group “${n}”: ${unit(sh, g ? g.all.length : 0)}. Titles with this word in their name or series go in by themselves.`, 4500) }) }
function groupMenu(sh, g){ const G = grOf(sh), pin = G.isPinned('gr:' + g.key), pcOnly = g.all.flatMap(filesOf).filter(f => f.pc && !f.local && !f.src), saved = g.all.flatMap(filesOf).filter(f => f.local);
  sheet(`<h3>${esc(g.name)}</h3><div class="mlist"><button class="btn primary" id="gadd">Add…</button><button class="btn" id="gsub">New group inside</button><button class="btn" id="gmove">Put this group inside another group…</button><button class="btn" id="gren">Rename</button><button class="btn" id="gcov">Choose the tile cover</button><button class="btn" id="gpin">${pin ? '★ Unpin from the top' : '★ Pin to the top'}</button>
    ${pcOnly.length ? '<button class="btn" id="gsave">Save all to phone (for a trip)</button>' : ''}${saved.length ? '<button class="btn" id="gunsave">Remove the phone copies</button>' : ''}${g.kind === 'own' ? '<button class="btn danger" id="gdel">Remove this group</button>' : ''}</div>
    ${g.kind === 'own' ? '<p class="muted small" style="margin:10px 0 0">Removing the group keeps the films and shows - they show as their own tiles again (or in their series).</p>' : ''}`);
  $('#gadd').onclick = () => addItemsSheet(sh, g); $('#gsub').onclick = () => newSubGroup(sh, g); $('#gmove').onclick = () => moveGroupSheet(sh, g); $('#gren').onclick = () => renameGroup(sh, g); $('#gcov').onclick = () => groupCoverSheet(sh, g);
  $('#gpin').onclick = () => { G.togglePin(['gr:' + g.key], !pin); closeSheet(); draw(); toast(pin ? 'Unpinned' : 'Pinned: it shows first') };
  if($('#gsave')) $('#gsave').onclick = () => saveSheet({name:g.name}, pcOnly); if($('#gunsave')) $('#gunsave').onclick = () => unsave(saved);
  if($('#gdel')) $('#gdel').onclick = () => { closeSheet(); if(cur().v === 'group' && cur().key === g.key) V.pop(); grChange(sh, () => G.remove(g), `Group “${g.name}” removed`); draw() } }
function addItemsSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, where = {}; for(const x of gs) for(const b of x.items) where[b.id] = x;
  const pick = new Set(); let q = '';
  const list = () => { const nq = norm(q); return inShelf(sh).filter(b => !g.items.includes(b) && (!nq || norm([b.name, b.saga, (where[b.id] || {}).name].join(' ')).includes(nq))).sort(byName) };
  const drawL = () => { const l = list(), el = $('#aalist'); if(!el) return;
    el.innerHTML = l.slice(0, 400).map(b => `<label class="li" style="cursor:pointer"><input type="checkbox" data-aa="${esc(b.id)}" ${pick.has(b.id) ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accentd);flex:none"><span class="th">${coverHTML(b)}</span><div class="n"><div>${esc(b.name)}</div><div class="s">${esc(b.year || '')}${where[b.id] ? ' · in ' + esc(G.path(where[b.id], gs)) : ''}</div></div></label>`).join('') + (l.length > 400 ? `<p class="muted small">… and ${l.length - 400} more - type to narrow it down</p>` : '') + (!l.length ? '<p class="muted small">Nothing found.</p>' : '');
    lazyCovers(el); upd() };
  const upd = () => { $('#aago').textContent = pick.size ? `Add ${unit(sh, pick.size)}` : 'Add'; $('#aago').disabled = !pick.size };
  sheet(`<h3>Add to “${esc(g.name)}”</h3><input type="search" id="aaq" placeholder="Search name, series or group"><div id="aalist" style="max-height:52vh;overflow:auto;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="aago" disabled>Add</button></div>`, true);
  $('#aaq').oninput = e => { q = e.target.value; drawL() };
  $('#aalist').onchange = e => { const c = e.target.closest('[data-aa]'); if(!c) return; c.checked ? pick.add(c.dataset.aa) : pick.delete(c.dataset.aa); upd() };
  $('#aago').onclick = () => { grChange(sh, () => G.put([...pick], g), `${unit(sh, pick.size)} added to “${g.name}”`); closeSheet(); draw() };
  drawL() }
function newSubGroup(sh, g){ ask(`New group inside “${esc(g.name)}”`, 'Name, like Prequels or Spin-offs', '', 'Make it').then(n => { if(!n) return; const G = grOf(sh), k = G.own(n); if(k.key === g.key) return; G.setParent(k.key, g.key); regroup(); draw(); toast(`“${n}” made inside “${g.name}” - open it and add titles`) }) }
function moveGroupSheet(sh, g){ const G = grOf(sh), gs = groupsOf(sh).groups, bad = new Set(G.inside(g, gs).concat(g.key)), opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Put “${esc(g.name)}” inside…</h3>${g.parent ? '<button class="btn" id="mgtop" style="width:100%;margin-bottom:8px">Back on the main page</button>' : ''}
    ${opts.map(x => `<div class="li" data-mg="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${unit(sh, x.all.length)}</div></div></div>`).join('') || '<p class="muted small">No other groups yet. Make one with “+ Group” on the shelf.</p>'}`);
  lazyCovers($('.sheet'));
  if($('#mgtop')) $('#mgtop').onclick = () => { grChange(sh, () => toTop(G, g.key), `“${g.name}” is back on the main page`); closeSheet(); draw() };
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-mg]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.mg); grChange(sh, () => G.setParent(g.key, t.key), `“${g.name}” is now inside “${t.name}”`); closeSheet(); draw() }) }
function groupPicker(b, sh){ const G = grOf(sh), now = groupOfTitle(sh, b), all = groupsOf(sh).groups, gs = all.filter(g => !now || g.key !== now.key).sort((x, y) => coll.compare(x.name, y.name)), ov = G.read('items');
  sheet(`<h3>Put “${esc(b.name)}” in a group</h3>${now ? `<p class="muted small" style="margin:0 0 8px">Now in “${esc(now.name)}”.</p>` : ''}
    <div style="display:flex;gap:8px"><input type="text" id="gpn" placeholder="New group name" maxlength="60"><button class="btn primary" id="gpmake">Make</button></div>
    <div style="margin-top:10px">${gs.map(g => `<div class="li" data-gp="${esc(g.key)}"><span class="th">${groupCoverHTML(sh, g)}</span><div class="n"><div>${esc(G.path(g, all))}</div><div class="s">${unit(sh, g.items.length)}</div></div></div>`).join('') || '<p class="muted small">No group tiles yet.</p>'}</div>
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
function groupCoverSheet(sh, g){ const G = grOf(sh), c = G.cover(g.key), wc = g.all.filter(hasCover).sort(sagaOrder);
  const save = v => { G.setCover(g.key, v); delete RNDCOV[g.key]; closeSheet(); draw(); toast('Tile cover saved') };
  sheet(`<h3>Tile cover for “${esc(g.name)}”</h3>
    <div class="chips"><button class="chip ${!c.t ? 'on' : ''}" data-gc="">The first one</button><button class="chip ${c.t === 'random' ? 'on' : ''}" data-gc="random">A random one</button><button class="chip ${c.t === 'cycle' ? 'on' : ''}" data-gc="cycle">Changing (one after another)</button><button class="chip ${c.t === 'pic' ? 'on' : ''}" data-gc="pic">A picture from the phone</button></div>
    <div class="sec">Or pick one</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">${wc.map(b => `<div class="bk" data-gca="${esc(b.id)}" style="${c.t === 'item' && c.al === b.id ? 'outline:2px solid var(--accent);border-radius:10px' : ''}">${coverHTML(b)}<div class="a">${esc(b.name)}</div></div>`).join('') || '<p class="muted small">No posters in this group yet.</p>'}</div>`);
  lazyCovers($('.sheet'));
  $('.sheet').onclick = e => { const bt = e.target.closest('[data-gc]'), it = e.target.closest('[data-gca]');
    if(it) return save({t:'item', al:it.dataset.gca}); if(!bt) return; const t = bt.dataset.gc;
    if(t === 'pic'){ const i = $('#pickpic'); i.value = ''; i.onchange = async ev => { const f = ev.target.files[0]; if(!f) return; await setCover('grp:' + sh + ':' + g.key, await thumb(f, 500)); save({t:'pic'}) }; i.click(); return }
    save(t ? {t} : null) } }

/* ---------- select several tiles and move them at once (long-press a tile, or "Select") ---------- */
function selStart(id){ SEL = new Set(id ? [id] : []); selDraw() }
function selEnd(quiet){ if(!SEL) return; SEL = null; if(!quiet) selDraw(); else { const b = $('#msel'); if(b) b.remove(); document.querySelectorAll('#body .bk.sel').forEach(el => el.classList.remove('sel')) } }
function selDraw(){ document.querySelectorAll('#body .grid > .bk').forEach(el => { const id = el.dataset.title ? 'it:' + el.dataset.title : el.dataset.grp ? 'gr:' + el.dataset.grp : null; el.classList.toggle('sel', !!(SEL && id && SEL.has(id))) });
  let bar = $('#msel'); if(!SEL){ if(bar) bar.remove(); return }
  if(!bar){ bar = document.createElement('div'); bar.id = 'msel'; document.body.appendChild(bar) }
  const inGroup = cur().v === 'group', n = SEL.size;
  bar.innerHTML = `<b style="flex:1">${n ? plural(n, 'tile') + ' selected' : 'Tap tiles to select them'}</b><button class="btn sm primary" id="selmove" ${n ? '' : 'disabled'}>Move to…</button><button class="btn sm" id="selmore" ${n ? '' : 'disabled'}>${IC_DOTS}</button>${inGroup ? `<button class="btn sm" id="selout" ${n ? '' : 'disabled'}>Take out</button>` : ''}<button class="btn sm" id="selx">Cancel</button>`;
  $('#selx').onclick = () => selEnd(); $('#selmove').onclick = selMoveSheet; $('#selmore').onclick = selMore; if($('#selout')) $('#selout').onclick = selTakeOut }
function selParts(){ const sh = cur().shelf, gs = groupsOf(sh).groups, its = [...SEL].filter(x => x.startsWith('it:')).map(x => x.slice(3)), grs = [...SEL].filter(x => x.startsWith('gr:')).map(x => x.slice(3));
  const titles = [...new Set(its.concat(...grs.map(k => (gs.find(g => g.key === k) || {all:[]}).all.map(b => b.id))))];
  return {sh, gs, its, grs, titles} }
function selMoveSheet(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), bad = new Set(grs.flatMap(k => { const g = gs.find(x => x.key === k); return g ? G.inside(g, gs).concat(k) : [k] }));
  const opts = gs.filter(x => !bad.has(x.key)).sort((x, y) => coll.compare(G.path(x, gs), G.path(y, gs)));
  sheet(`<h3>Move ${plural(SEL.size, 'tile')} to…</h3><div style="display:flex;gap:8px"><input type="text" id="smn" placeholder="New group name" maxlength="60"><button class="btn primary" id="smmake">Make</button></div>
    <button class="btn" id="smtop" style="width:100%;margin-top:10px">The main page (own tiles)</button>
    <div style="margin-top:8px">${opts.map(x => `<div class="li" data-sm="${esc(x.key)}"><span class="th">${groupCoverHTML(sh, x)}</span><div class="n"><div>${esc(G.path(x, gs))}</div><div class="s">${unit(sh, x.all.length)}</div></div></div>`).join('')}</div>`);
  lazyCovers($('.sheet'));
  const move = t => { if(t){ G.put(its, t); for(const k of grs) G.setParent(k, t.key) } else { G.put(its, 'none'); for(const k of grs) toTop(G, k) } };
  const doit = (t, label, first) => { const n = SEL.size; grChange(sh, () => { if(first) first(); move(t) }, `${plural(n, 'tile')} moved to ${label}`); closeSheet(); selEnd(true); draw() };
  $('#smmake').onclick = () => { const n = $('#smn').value.trim(); if(!n) return; const v = cur(); doit({key:'c:' + norm(n), name:n, kind:'own'}, `“${n}”`, () => { const g = G.own(n); if(v.v === 'group' && !bad.has(v.key)) G.setParent(g.key, v.key) }) };
  $('#smtop').onclick = () => doit(null, 'the main page');
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-sm]'); if(!r) return; const t = gs.find(x => x.key === r.dataset.sm); if(t) doit(t, `“${t.name}”`) }) }
function selTakeOut(){ const {sh, gs, its, grs} = selParts(), G = grOf(sh), here = gs.find(x => x.key === cur().key), up = here && here.parent ? gs.find(x => x.key === here.parent) : null, n = SEL.size;
  grChange(sh, () => { G.put(its, up || 'none'); for(const k of grs) up ? G.setParent(k, up.key) : toTop(G, k) }, `${plural(n, 'tile')} taken out${up ? ' to “' + up.name + '”' : ' to the main page'}`); selEnd(true); draw() }
function selMore(){ const {sh, titles} = selParts(), G = grOf(sh), ids = [...SEL], allPinned = ids.every(x => G.isPinned(x)), ts = titles.map(id => TM[id]).filter(Boolean), pcOnly = ts.flatMap(filesOf).filter(f => f.pc && !f.local && !f.src);
  sheet(`<h3>${plural(ids.length, 'tile')} · ${unit(sh, ts.length)}</h3><div class="mlist"><button class="btn" id="smpin">${allPinned ? '★ Unpin' : '★ Pin to the top'}</button>
    <button class="btn" id="smseen">Mark as watched</button><button class="btn" id="smunseen">Mark as not watched</button>${pcOnly.length ? '<button class="btn" id="smsave">Save to phone</button>' : ''}
    ${TKEY() ? '<button class="btn" id="smlook">Fill in details (TMDB)</button>' : ''}<button class="btn" id="smshelf">Move to another shelf</button><button class="btn danger" id="smdel">Remove from Cinema</button></div>`);
  $('#smpin').onclick = () => { G.togglePin(ids, !allPinned); closeSheet(); selEnd(true); draw() };
  $('#smseen').onclick = async () => { for(const t of ts) for(const f of mainFiles(t)) if(!isDone(f)) await setWatch(f, 0, (W(f) || {}).dur, true); closeSheet(); selEnd(true); draw(); toast('Marked as watched') };
  $('#smunseen').onclick = async () => { for(const t of ts) for(const f of filesOf(t)) if(W(f)) await clearWatch(f); closeSheet(); selEnd(true); draw(); toast('Marked as not watched') };
  if($('#smsave')) $('#smsave').onclick = () => { selEnd(true); saveSheet({name:plural(ts.length, 'title')}, pcOnly) };
  if($('#smlook')) $('#smlook').onclick = () => { closeSheet(); selEnd(true); fillDetails(ts, true) };
  $('#smshelf').onclick = () => shelfPicker(ts);
  $('#smdel').onclick = () => removeTitles(titles) }

/* =====================================================================================================================
   ADDING VIDEOS: a folder on the phone (Android app: read where they are, nothing copied), files copied into the app,
   or the PC (its list comes by itself). Every file name is read (parseVideo), the results are shown before anything is added.
   ===================================================================================================================== */
let NvFiles = null; if(NATIVE) try{ NvFiles = Capacitor.registerPlugin('NvFiles') }catch(e){ NvFiles = null }
const NvPcP = NATIVE ? (() => { try{ return Capacitor.registerPlugin('NvPc') }catch(e){ return null } })() : null;
const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const linkUrl = (uri, name) => '/_nvfile_/' + b64url(uri) + '/' + encodeURIComponent(name);
async function awake(on){ try{ if(NvFiles && NvFiles.keepAwake) await NvFiles.keepAwake({on}) }catch(e){}
  try{ if(on && navigator.wakeLock && !awake.l) awake.l = await navigator.wakeLock.request('screen'); if(!on && awake.l){ await awake.l.release(); awake.l = null } }catch(e){} }
function addSheet(){ const v = cur(), sh = v.shelf || null;
  sheet(`<h3>Add videos${sh ? ' · ' + esc(shelfOf(sh).name) : ''}</h3><div class="mlist">
    ${NvFiles ? '<button class="btn primary" id="adfold">Use a folder on this phone</button><div class="muted small" style="margin:-2px 0 6px">Nothing is copied: the videos play from that folder. Pick the folder with your films or series - all folders inside it are read.</div>' : ''}
    <button class="btn ${NvFiles ? '' : 'primary'}" id="adcopy">${NvFiles ? 'Copy videos into the app' : 'Pick video files'}</button><div class="muted small" style="margin:-2px 0 6px">${NvFiles ? 'Takes extra space on the phone.' : 'They are copied into the app, so they play without internet. Subtitle files (.srt, .vtt) picked along come too.'}</div>
    ${'webkitdirectory' in document.createElement('input') && !NATIVE ? '<button class="btn" id="addir">Pick a whole folder</button>' : ''}
    ${window.NVPC && NVPC.native ? (NVPC.pc ? `<button class="btn" id="adpc">Get the newest list from ${esc(NVPC.pc.name || 'my PC')}</button><div class="muted small" style="margin:-2px 0 0">Films and shows in the PC app’s Watch collections show up here by themselves.</div>` : '<a class="btn" href="../hub/index.html" style="text-decoration:none">Connect my PC (The Nightvault › My PC)</a>') : ''}</div>
    <p class="muted small" style="margin:12px 0 0">Names are read from the file and folder names: “Inception (2010).mkv”, “Doctor Who/Season 1/Doctor.Who.S01E05.mkv”, “Frieren - 05.mkv”. You check them before anything is added.</p>`);
  if($('#adfold')) $('#adfold').onclick = () => linkFolder(null, sh);
  $('#adcopy').onclick = () => pickCopy(sh, false); if($('#addir')) $('#addir').onclick = () => pickCopy(sh, true);
  if($('#adpc')) $('#adpc').onclick = () => { closeSheet(); pcSync(true) } }

/* which shelf a title goes on by itself: the shelf you are on, else the folder names (anime, cartoons), else movie → Movies, show → TV shows */
function guessShelf(p, hint){ if(hint) return hint; const d = (p.dirs || []).join('/');
  if(/\banime\b/i.test(d)) return 'anime'; if(/cartoon|tekenfilm|animat|disney|pixar/i.test(d)) return 'cartoons';
  const own = shelves(true).find(s => s.id.startsWith('x-') && (p.dirs || []).some(x => norm(x) === norm(s.name))); if(own) return own.id;
  return p.kind === 'show' ? 'tv' : 'movies' }
/* entries: [{path:'Folder/sub/name.mkv', name, size, uri? | file?}] → a plan: titles with their videos and subtitles */
function makePlan(entries, hint){
  const vids = entries.filter(x => VID_RE.test(x.name) && !/^\._/.test(x.name)), subs = entries.filter(x => SUB_RE.test(x.name)), byKey = {};
  for(const x of vids){ const p = parseVideo(x.path); if(!p) continue;
    const k = p.kind + '|' + norm(p.name) + '|' + (p.kind === 'movie' ? p.year || '' : '');
    const T = byKey[k] = byKey[k] || {kind:p.kind, name:p.name, year:p.year, shelf:guessShelf(p, hint), vids:[]};
    if(!T.year && p.year) T.year = p.year;
    const dir = x.path.split('/').slice(0, -1).join('/'), stem = x.name.replace(/\.[^.]+$/, '').toLowerCase();
    const mine = subs.filter(s => { const sd = s.path.split('/').slice(0, -1), sdir = sd.join('/'), sn = s.name.toLowerCase();
      return (sdir === dir || (/^(subs?|subtitles?|ondertitels?)$/i.test(sd[sd.length - 1] || '') && sd.slice(0, -1).join('/') === dir)) && (sn.startsWith(stem) || (vids.filter(v => v.path.split('/').slice(0, -1).join('/') === dir).length === 1)) });
    T.vids.push({x, p, dir, subs:mine.map(s => ({s, label:subLabel(s.name, x.name.replace(/\.[^.]+$/, ''))}))}) }
  /* movies with the same name but no year in one of them: put together */
  for(const T of Object.values(byKey)) if(T.kind === 'movie' && !T.year){ const o = Object.values(byKey).find(y => y !== T && y.kind === 'movie' && y.year && norm(y.name) === norm(T.name)); if(o){ o.vids.push(...T.vids); T.vids = [] } }
  return Object.values(byKey).filter(T => T.vids.length).sort((a, b) => coll.compare(a.name, b.name)) }
function planSheet(plan, how, onAdd, skipped){
  const nv = plan.reduce((n, T) => n + T.vids.length, 0);
  if(!plan.length){ sheet(`<h3>No new videos found</h3><p class="muted small">${skipped ? plural(skipped, 'video') + ' were already in Cinema. ' : ''}Cinema reads MKV, MP4, M4V, MOV, AVI, WebM, TS and more.</p><button class="btn" style="width:100%" onclick="closeSheet()">OK</button>`); return }
  const opts = sel => shelves(true).map(s => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  sheet(`<h3>${plural(plan.length, 'title')} · ${plural(nv, 'video')}</h3><p class="muted small" style="margin:0 0 8px">${esc(how)}${skipped ? ` · ${skipped} already in Cinema` : ''}. Check the names and shelves - you can change everything later too.</p>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span class="muted small" style="flex:1">All on one shelf:</span><select id="plall"><option value="">(as below)</option>${opts('')}</select></div>
    <div id="plist" style="max-height:48vh;overflow:auto">${plan.map((T, i) => `<div class="li" style="cursor:default"><div class="n"><div>${esc(T.name)}${T.year ? ` <span class="muted">(${T.year})</span>` : ''}</div><div class="s">${T.kind === 'show' ? `TV show · ${plural(T.vids.length, 'episode')}${(() => { const ss = new Set(T.vids.map(v => v.p.s)); return ss.size > 1 ? ' · ' + plural(ss.size, 'season') : '' })()}` : `Film${T.vids.length > 1 ? ' · ' + plural(T.vids.length, 'file') : ''}`}${T.vids.some(v => v.subs.length) ? ' · subtitles' : ''}</div></div><select data-pl="${i}">${opts(T.shelf)}</select></div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" onclick="closeSheet()">Cancel</button><button class="btn primary" style="flex:2" id="plgo">Add ${plural(plan.length, 'title')}</button></div>`, true);
  $('#plall').onchange = e => { if(!e.target.value) return; document.querySelectorAll('[data-pl]').forEach(s => s.value = e.target.value) };
  $('#plgo').onclick = () => { document.querySelectorAll('[data-pl]').forEach(s => plan[+s.dataset.pl].shelf = s.value); onAdd(plan) } }
/* puts a plan in the library; mk(v) makes the file's src (and stores a copy when needed) */
async function addPlan(plan, mk, progress){ const now = Date.now(), fresh = []; let n = 0, failed = 0;
  for(const T of plan){ const p = {kind:T.kind, name:T.name, year:T.year};
    let t = findTitle(T.shelf, p) || TITLES.find(x => x.want && x.kind === p.kind && norm(x.name) === norm(p.name)); if(!t){ t = newTitle(p, T.shelf); await saveTitle(t); fresh.push(t) }
    if(t.want){ t.want = false; t.shelf = T.shelf; await saveTitle(t) }
    for(const v of T.vids){ n++; progress && progress(n, v.x.name);
      try{ const src = await mk(v.x), subs = []; for(const s of v.subs){ try{ const ss = await mk(s.s, true); subs.push(Object.assign(ss, {label:s.label, name:s.s.name})) }catch(e){} }
        await saveFile({id:'f' + uid(), tid:t.id, s:T.kind === 'show' ? v.p.s : null, e:T.kind === 'show' ? v.p.e : null, e2:v.p.e2 || null, part:v.p.part || null, etitle:v.p.etitle || '',
          name:v.x.name, size:v.x.size || 0, dir:v.dir, src, pc:null, local:null, subs, added:now}) }
      catch(e){ failed++; LE('add', 'could not add ' + v.x.name, e); if(/Quota|full/i.test(String(e && (e.name + e.message)))){ toast('The phone (or the app’s storage) is full', 6000); break } } } }
  reindex(); return {fresh, failed} }

/* ---------- a folder on the phone (Android): the videos play from there ---------- */
const FOLDERS = () => lsGet('nvCinema.folders', []);
async function linkFolder(f, hint){
  if(!NvFiles){ toast('Folders on the phone work in the Nightvault Android app'); return }
  try{ f = f || await NvFiles.pickFolder() }catch(e){ if(!/cancel|No folder/i.test(e.message || '')) toast(e.message || String(e)); return }
  const fl = FOLDERS().filter(x => x.tree !== f.tree); fl.push({tree:f.tree, name:f.name, hint:hint || (fl.find(x => x.tree === f.tree) || {}).hint || null}); lsSet('nvCinema.folders', fl);
  await scanFolder(fl[fl.length - 1], false) }
async function scanFolder(fo, quiet){ let list, stopped = false;
  if(!quiet){ sheet(`<h3>Reading “${esc(fo.name)}”…</h3><div class="prog busy"><i></i></div><div class="muted small" id="scs">Looking for videos…</div><button class="btn" id="scstop" style="width:100%;margin-top:10px">Stop</button>`, true);
    $('#scstop').onclick = () => { stopped = true; NvFiles.stopList().catch(() => {}); closeSheet() } }
  let hl = null; try{ hl = await NvFiles.addListener('listProgress', e => { const el = $('#scs'); if(el) el.textContent = `${e.files} files in ${plural(e.folders, 'folder')}…` }) }catch(e){}
  try{ list = (await NvFiles.list({tree:fo.tree})).files || [] }catch(e){ try{ hl && hl.remove() }catch(x){} if(!quiet && !stopped){ closeSheet(); toast(e.message || String(e), 5000) } LE('folder', 'list failed', e); return }
  try{ hl && hl.remove() }catch(x){} if(stopped) return;
  const mine = FILES.filter(f => f.src && f.src.kind === 'link' && f.src.tree === fo.tree), have = new Set(mine.map(f => f.src.uri)), there = new Set(list.map(x => x.uri));
  /* gone from the folder: they go from Cinema too (unless the PC still has them) */
  const gone = mine.filter(f => !there.has(f.src.uri));
  if(gone.length){ for(const f of gone){ f.src = null; if(f.pc) await dbPut('files', f) } await dropFiles(gone.filter(f => !f.pc && !f.local).map(f => f.id)); for(const t of TITLES.filter(t => !filesOf(t).length && !t.want)) await dropTitle(t); reindex() }
  const fresh = list.filter(x => !have.has(x.uri) && (VID_RE.test(x.name) || SUB_RE.test(x.name))).map(x => ({path:x.path, name:x.name, size:x.size, uri:x.uri}));
  /* subtitles next to videos that are already in Cinema */
  const plan = makePlan(fresh, fo.hint), skipped = list.filter(x => have.has(x.uri) && VID_RE.test(x.name)).length;
  const mk = x => ({kind:'link', uri:x.uri, name:x.name, tree:fo.tree});
  if(quiet){ if(!plan.length){ if(gone.length) draw(); return } const r = await addPlan(plan, mk); draw(); toast(`“${fo.name}”: ${plural(plan.length, 'new title')}`); autoMatch(r.fresh); return }
  planSheet(plan, `From the folder “${fo.name}” (nothing is copied)`, async pl => { closeSheet(); const r = await addPlan(pl, mk); lsSet('nvCinema.scanAt', Date.now()); draw();
    toast(`${plural(pl.length, 'title')} added${r.failed ? ` · ${r.failed} failed` : ''}${TKEY() ? ' · looking up posters…' : ''}`, 4000); autoMatch(r.fresh) }, skipped) }

/* ---------- files copied into the app ---------- */
function pickCopy(hint, dir){ const i = $('#pickvid'); i.value = ''; if(dir) i.setAttribute('webkitdirectory', ''); else i.removeAttribute('webkitdirectory');
  i.onchange = () => { const fs = [...i.files]; if(!fs.length) return;
    const entries = fs.map(f => ({path:f.webkitRelativePath || f.name, name:f.name, size:f.size, file:f})), have = new Set(FILES.filter(f => f.src && f.src.kind === 'copy').map(f => f.name + '|' + f.size));
    const fresh = entries.filter(x => !have.has(x.name + '|' + x.size)), plan = makePlan(fresh, hint), skipped = entries.length - fresh.length, size = fresh.filter(x => VID_RE.test(x.name)).reduce((n, x) => n + x.size, 0);
    planSheet(plan, `${mb(size)} will be copied into the app`, async pl => {
      let est = null; try{ est = await navigator.storage.estimate() }catch(e){}
      if(est && est.quota && est.quota - est.usage < size * 1.05 && !confirm(`These videos take ${mb(size)}, but the app only has about ${mb(est.quota - est.usage)} free. Try anyway?`)) return;
      sheet(`<h3>Copying into the app…</h3><div class="prog"><i id="cpp"></i></div><div class="muted small" id="cps" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">starting…</div><p class="muted small">Keep the app open until it is done.</p>`, true); awake(true);
      const nv = pl.reduce((n, T) => n + T.vids.length, 0);
      const r = await addPlan(pl, async (x, isSub) => { const bid = 'b' + uid(); await dbPut('blobs', {id:bid, blob:x.file, name:x.name}); return {kind:'copy', bid} }, (n, name) => { const p = $('#cpp'), s = $('#cps'); if(p) p.style.width = (100 * n / nv) + '%'; if(s) s.textContent = `${n} of ${nv} · ${name}` });
      awake(false); closeSheet(); draw(); toast(`${plural(pl.length, 'title')} added${r.failed ? ` · ${r.failed} failed` : ''}`, 4000); autoMatch(r.fresh) }, skipped) };
  i.click() }
/* TMDB for a list of titles, by hand (Settings / select several): an exact name match only */
async function fillDetails(list, again){ list = list.filter(t => again || !t.tmdb); if(!list.length){ toast('Nothing to fill in'); return } if(!TKEY()){ tmdbSheet(); return }
  for(const t of list) t.tmdbTried = 0; await dbPutMany('titles', list); autoMatch(list) }

/* =====================================================================================================================
   THE PLAYER – one for every shelf. Plays from the phone (folder / app / saved copy) when it can, else from the PC:
   as it is (seeking with byte ranges), or converted by the PC while you watch (MKV with HEVC, DTS/AC3 sound, AVI …) –
   then a jump means asking the PC again from that second (P.off). Subtitles: our own cue list, so they also line up with
   a converted stream. Where you are is saved every few seconds (and on the PC).
   ===================================================================================================================== */
const P = {f:null, t:null, mode:'', off:0, dur:0, info:null, subs:[], sub:-1, cues:[], audio:0, tok:0, url:null, saveAt:0, uiT:0, nextT:0, tried:{}};
const VINFO = {};
const IC = {
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  play:IC_PLAY, pause:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
  rw:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text></svg>',
  ff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text></svg>',
  next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5v13a1 1 0 0 0 1.5.86L16 13.5V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.5L6.5 4.64A1 1 0 0 0 5 5.5z"/></svg>',
  cc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  fit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  tv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'};
/* the PC's Cinema extras (vault_cinema.py): 2 = quality, TV, subtitles online. Older PC apps: 0 */
const pcv = () => (window.NVPC && NVPC.pc && NVPC.pc.cinema) || 0;
const qNow = () => window.NVPC && NVPC.away ? +S.qAway || 0 : +S.qHome || 0;
const pv = () => $('#pvid');
const ptime = () => { const v = pv(); if(!v) return 0; return P.mode === 'conv' ? P.off + (v.currentTime || 0) : (v.currentTime || 0) };
const pdur = () => { const v = pv(); if(!v) return P.dur || 0; return P.dur || (isFinite(v.duration) ? v.duration : 0) };
function nextFile(f){ const t = TM[f.tid]; if(!t) return null; const fs = filesOf(t), i = fs.indexOf(f);
  if(t.kind === 'show') return fs.slice(i + 1).find(x => x.s !== 0 || f.s === 0) || null;
  if(f.part) return fs.find(x => x.part === f.part + 1) || null; return null }
/* where the video comes from */
function phoneUrl(f){ if(f.local) return linkUrl(f.local.uri, f.local.name); if(f.src && f.src.kind === 'link') return linkUrl(f.src.uri, f.src.name); return null }
async function blobUrl(bid){ const b = await dbGet('blobs', bid).catch(() => null); return b ? URL.createObjectURL(b.blob) : null }
async function pcInfo(f){ if(VINFO[f.pc.id]) return VINFO[f.pc.id]; const r = await fetch(NVPC.url('/nv/vinfo?id=' + encodeURIComponent(f.pc.id)), {cache:'no-store'}); const j = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(j.error || 'The PC answered ' + r.status); return VINFO[f.pc.id] = j }

function playerHTML(){ return `<video id="pvid" playsinline preload="auto"></video><div class="wait" id="pwait" hidden></div><span class="seekfx" id="pfxl" style="left:12%"></span><span class="seekfx" id="pfxr" style="right:12%"></span>
  <div class="ui" id="pui"><div class="pt"><button class="pi" id="pclose" aria-label="Close">${IC.back}</button><div class="n"><b id="pname"></b><span id="psub"></span></div><button class="pi txt" id="pstart" hidden>Start over</button>${window.NvTvP ? `<button class="pi" id="ptv" aria-label="Play on the TV">${IC.tv}</button>` : ''}<button class="pi" id="pfit" aria-label="Fill the screen">${IC.fit}</button><button class="pi" id="pcc" aria-label="Subtitles">${IC.cc}</button><button class="pi" id="pset" aria-label="Settings">${IC.gear}</button></div>
    <div class="mid"><button class="pi" id="prw" aria-label="10 seconds back">${IC.rw}</button><button class="pi big" id="ppp" aria-label="Play or pause">${IC.play}</button><button class="pi" id="pff" aria-label="10 seconds forward">${IC.ff}</button></div>
    <div class="pb"><div class="row"><span class="time" id="pcur">0:00</span><input type="range" id="pseek" min="0" max="1000" value="0" step="1" aria-label="Position"><span class="time" id="pdur" style="text-align:right">0:00</span><button class="pi" id="pnext" aria-label="Next" hidden>${IC.next}</button></div></div></div>
  <div class="menu" id="pmenu" hidden></div><div class="nextup" id="pnextup" hidden></div><div class="msg" id="pmsg" hidden></div>` }
function pShow(on){ const el = $('#player'); clearTimeout(P.uiT); el.classList.toggle('hideui', !on); if(on && !pv().paused && $('#pmenu').hidden) P.uiT = setTimeout(() => { if(!pv().paused && $('#pmenu').hidden) el.classList.add('hideui') }, 3500) }
function pMsg(html){ const m = $('#pmsg'); if(!html){ m.hidden = true; return } m.innerHTML = html; m.hidden = false; $('#pwait').hidden = true; pShow(true) }

async function play(f, opts){ opts = opts || {};
  const t = TM[f.tid]; if(!t) return;
  if(!onPhone(f) && f.pc && !(window.NVPC && NVPC.native)){ toast('Videos on the PC play in the Nightvault Android app', 4000); return }
  const el = $('#player'); if(el.hidden){ el.innerHTML = playerHTML(); el.hidden = false; document.body.classList.add('playing'); hookPlayer();
    try{ if(document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen({navigationUI:'hide'}) }catch(e){}
    try{ screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}) }catch(e){}
    history.pushState({nvplayer:1}, '') }
  if(P.f && P.f !== f) await pSave(true);
  const tok = ++P.tok; Object.assign(P, {f, t, mode:'', off:0, dur:0, info:null, subs:[], sub:-1, cues:[], audio:0, tried:{}, saveAt:0});
  el.classList.toggle('fill', !!S.fit); $('#pnextup').hidden = true; $('#pmenu').hidden = true; pMsg(''); clearTimeout(P.nextT);
  const ep = (EPI[t.id + ':' + f.s] || []).find(x => x.e === f.e);
  $('#pname').textContent = t.name; $('#psub').textContent = t.kind === 'show' ? fileLabel(t, f, ep) : f.part ? 'Part ' + f.part : (t.year || '');
  $('#pnext').hidden = !nextFile(f); $('#pwait').hidden = false;
  const w = W(f), from = opts.from != null ? opts.from : (w && !w.done && w.pos > 20 ? Math.max(0, w.pos - 3) : 0);
  $('#pstart').hidden = !(from > 20); if(from > 20) setTimeout(() => { if(P.f === f) $('#pstart').hidden = true }, 9000);
  awake(true); L('play', 'start', {name:f.name, where:whereText(f), from:Math.round(from)});
  /* 1. from the phone */
  const purl = phoneUrl(f) || (f.src && f.src.kind === 'copy' ? await blobUrl(f.src.bid) : null);
  if(purl && !opts.pc){ P.mode = 'file'; P.url = purl; loadSubs(f, null); return pLoad(purl, from) }
  /* 2. from the PC */
  if(!f.pc){ pMsg(`<b>This video can’t be found</b><p class="muted small">${f.src ? 'Is the folder still on the phone?' : ''}</p><button class="btn" onclick="pClose()">Close</button>`); return }
  if(!(await NVPC.reachable(true))){ PCON = false; pMsg(`<b>Your PC is not reachable</b><p class="muted small">Are you at home on the same Wi‑Fi, and is Nightvault running on the PC with Phone access on?</p><div style="display:flex;gap:8px;justify-content:center"><button class="btn" onclick="pClose()">Close</button><button class="btn primary" id="pretry">Try again</button></div>`); $('#pretry').onclick = () => play(f, opts); return }
  PCON = true; let info; try{ info = await pcInfo(f) }catch(e){ LE('play', 'vinfo', e); pMsg(`<b>The PC could not open this video</b><p class="muted small">${esc(e.message)}</p><button class="btn" onclick="pClose()">Close</button>`); return }
  if(tok !== P.tok) return; P.info = info; P.dur = info.duration || 0; P.h = pcv() >= 2 ? qNow() : 0;
  P.mode = (P.h || S.conv === 'always' || (info.mode === 'transcode' && S.conv !== 'never') || opts.conv) && info.ffmpeg ? 'conv' : 'direct';
  if(P.h && info.ffmpeg && NVPC.away) toast(`Away from home: ${P.h}p (change it in ⚙ › Quality)`, 3000);
  loadSubs(f, info); pLoad(null, from); autoFindSubs(f) }
/* (re)load the source; for a converted stream: ask the PC to start at second s */
function pLoad(url, s){ const v = pv(), f = P.f; $('#pwait').hidden = false; pMsg('');
  if(P.mode === 'conv'){ P.off = Math.max(0, s || 0); v.src = NVPC.url(pcv() >= 2 ? `/nv/cin/stream?id=${encodeURIComponent(f.pc.id)}&start=${P.off.toFixed(1)}&a=${P.audio}&h=${P.h || 0}` : `/nv/vstream?id=${encodeURIComponent(f.pc.id)}&start=${P.off.toFixed(1)}&a=${P.audio}`); P._seekTo = null }
  else { if(url || P.mode === 'direct'){ v.src = url || NVPC.url('/nv/file?id=' + encodeURIComponent(f.pc.id)) } P.off = 0; P._seekTo = s > 1 ? s : null }
  v.playbackRate = S.rate || 1; const pr = v.play(); if(pr) pr.catch(() => {}); applyCues() }
function pSeek(to){ const d = pdur(); to = Math.max(0, d ? Math.min(d - 1, to) : to);
  if(P.mode === 'conv'){ pLoad(null, to) } else pv().currentTime = to; pUpd() }
function pUpd(){ const v = pv(); if(!v || !$('#pcur')) return; const cur0 = ptime(), d = pdur();
  $('#pcur').textContent = tfmt(cur0); $('#pdur').textContent = d ? tfmt(d) : '--:--'; if(!P.dragging) $('#pseek').value = d ? Math.round(1000 * cur0 / d) : 0;
  $('#ppp').innerHTML = v.paused ? IC.play : IC.pause }
async function pSave(force){ const f = P.f; if(!f) return; const c = ptime(), d = pdur(); if(!d || c < 5) return;
  if(!force && Date.now() - P.saveAt < 10000) return; P.saveAt = Date.now();
  const done = c > d * 0.92 || d - c < 90 && d > 1200 && c > d - 90;
  await setWatch(f, done ? 0 : c, d, done) }
async function pClose(){ const el = $('#player'); if(el.hidden) return; await pSave(true); P.tok++; clearTimeout(P.nextT);
  const v = pv(); try{ v.pause(); v.removeAttribute('src'); v.load() }catch(e){} if(P.url && P.url.startsWith('blob:')) URL.revokeObjectURL(P.url); P.url = null; P.f = null;
  el.hidden = true; el.innerHTML = ''; document.body.classList.remove('playing'); awake(false);
  try{ screen.orientation && screen.orientation.unlock && screen.orientation.unlock() }catch(e){}
  try{ if(document.fullscreenElement) await document.exitFullscreen() }catch(e){}
  if(history.state && history.state.nvplayer) try{ history.back() }catch(e){}
  draw() }
window.pClose = pClose;
window.addEventListener('popstate', () => { if(!$('#player').hidden) pClose() });
function pEnded(){ const f = P.f, d = pdur(), c = ptime();
  if(P.mode === 'conv' && d && c < d - 30){ L('play', 'converted stream stopped early', {at:c, d}); pLoad(null, c); return }   // the PC's stream broke off: go on from there
  setWatch(f, 0, d, true); const n = nextFile(f);
  if(!n){ pShow(true); pMsg(`<b>The end</b><p class="muted small">${esc(P.t.name)}</p><div style="display:flex;gap:8px;justify-content:center"><button class="btn" onclick="pClose()">Close</button><button class="btn primary" id="pagain">Watch again</button></div>`); $('#pagain').onclick = () => play(f, {from:0}); return }
  const t = P.t, ep = (EPI[t.id + ':' + n.s] || []).find(x => x.e === n.e); let left = 10;
  const nu = $('#pnextup'); nu.hidden = false; pShow(true);
  const tick = () => { if(!S.autoNext){ nu.innerHTML = `<b>Next: ${esc(fileLabel(t, n, ep))}</b><div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm primary" id="pnow">Play</button><button class="btn sm" id="pno">Not now</button></div>` }
    else nu.innerHTML = `<b>Next in ${left} s</b><div class="muted small" style="margin:2px 0 8px">${esc(fileLabel(t, n, ep))}</div><div style="display:flex;gap:8px"><button class="btn sm primary" id="pnow">Play now</button><button class="btn sm" id="pno">Cancel</button></div>`;
    $('#pnow').onclick = () => { clearTimeout(P.nextT); play(n, {from:0}) }; $('#pno').onclick = () => { clearTimeout(P.nextT); nu.hidden = true };
    if(S.autoNext){ if(left-- <= 0) return play(n, {from:isDone(n) ? 0 : undefined}); P.nextT = setTimeout(tick, 1000) } };
  tick() }
function pError(){ const v = pv(), f = P.f; if(!f || !v.getAttribute('src')) return; const code = v.error && v.error.code; LE('play', 'video error', {code, mode:P.mode, name:f.name, msg:v.error && v.error.message});
  if(P.mode === 'direct' && P.info && P.info.ffmpeg && !P.tried.conv){ P.tried.conv = 1; P.mode = 'conv'; toast('This phone can’t play it as it is - the PC converts it while you watch', 4000); return pLoad(null, ptime() || P._seekTo || 0) }
  if(P.mode === 'file' && f.pc && !P.tried.pc && window.NVPC && NVPC.native){ P.tried.pc = 1; toast('This phone can’t play the file itself - trying through the PC', 4000); return play(f, {pc:true, from:ptime() || undefined}) }
  pMsg(`<b>This phone can’t play this video</b><p class="muted small">${P.mode === 'conv' ? 'The PC could not convert it (is ffmpeg installed? Nightvault on the PC › Settings › Components).' : f.pc ? 'Try it through the PC: it converts videos the phone can’t play.' : 'Its video or sound format is not supported here (often HEVC/x265 video or DTS/AC3 sound). Tip: put it on the PC and watch it through the PC, or convert it to MP4.'}</p><button class="btn" onclick="pClose()">Close</button>`) }
function hookPlayer(){ const v = pv(), el = $('#player');
  v.addEventListener('loadedmetadata', () => { if(P._seekTo != null){ try{ v.currentTime = P._seekTo }catch(e){} P._seekTo = null } pUpd() });
  v.addEventListener('waiting', () => { $('#pwait').hidden = false }); v.addEventListener('playing', () => { $('#pwait').hidden = true; pShow(true) });
  v.addEventListener('canplay', () => { $('#pwait').hidden = true });
  v.addEventListener('timeupdate', () => { pUpd(); pSave(false); showCue() });
  v.addEventListener('pause', () => { pUpd(); pShow(true); pSave(true) }); v.addEventListener('play', pUpd);
  v.addEventListener('ended', pEnded); v.addEventListener('error', pError);
  /* tap: show / hide the buttons; double-tap left or right: 10 seconds */
  let lastTap = 0, tapT = 0;
  el.addEventListener('click', e => { if(e.target.closest('button,input,.menu,.nextup,.msg,a')) return;
    const now = Date.now(), side = e.clientX < innerWidth * 0.38 ? -1 : e.clientX > innerWidth * 0.62 ? 1 : 0;
    if(now - lastTap < 300 && side){ clearTimeout(tapT); lastTap = 0; jump(side * 10); return }
    lastTap = now; clearTimeout(tapT); tapT = setTimeout(() => { if(!$('#pmenu').hidden){ $('#pmenu').hidden = true; return } pShow(el.classList.contains('hideui')) }, 260) });
  el.addEventListener('pointermove', e => { if(e.pointerType === 'mouse') pShow(true) });
  $('#pclose').onclick = () => pClose();
  $('#ppp').onclick = () => { if(v.paused){ const p = v.play(); if(p) p.catch(() => {}) } else v.pause() };
  $('#prw').onclick = () => jump(-10); $('#pff').onclick = () => jump(10);
  $('#pnext').onclick = () => { const n = nextFile(P.f); if(n){ pSave(true); play(n, {from:isDone(n) ? 0 : undefined}) } };
  $('#pstart').onclick = () => { $('#pstart').hidden = true; pSeek(0) };
  $('#pfit').onclick = () => { S.fit = !S.fit; saveS(); el.classList.toggle('fill', S.fit); toast(S.fit ? 'Fills the screen (edges cut off)' : 'Whole picture') };
  const sk = $('#pseek');
  sk.oninput = () => { P.dragging = true; const d = pdur(); $('#pcur').textContent = tfmt(d * sk.value / 1000) };
  sk.onchange = () => { P.dragging = false; const d = pdur(); if(d) pSeek(d * sk.value / 1000) };
  $('#pcc').onclick = () => subMenu(); $('#pset').onclick = () => setMenu();
  if($('#ptv')) $('#ptv').onclick = async () => { const f = P.f, at = ptime(); await pClose(); tvSheet(f, {from:at}) };
  document.addEventListener('keydown', e => { if($('#player').hidden || e.target.matches('input[type=text],input[type=search],textarea')) return;
    if(e.key === ' '){ e.preventDefault(); $('#ppp').click() } else if(e.key === 'ArrowLeft') jump(-10); else if(e.key === 'ArrowRight') jump(10); else if(e.key === 'Escape') pClose() }) }
let jumpAcc = 0, jumpT = 0;
function jump(s){ const fx = $(s < 0 ? '#pfxl' : '#pfxr'); jumpAcc = Math.sign(jumpAcc) === Math.sign(s) ? jumpAcc + s : s; if(fx){ fx.textContent = (jumpAcc > 0 ? '+' : '') + jumpAcc + ' s'; fx.classList.add('on') }
  if(P.mode !== 'conv'){ pSeek(ptime() + s); clearTimeout(jumpT); jumpT = setTimeout(() => { jumpAcc = 0; document.querySelectorAll('.seekfx').forEach(x => x.classList.remove('on')) }, 700); return }
  /* a converted stream: wait until the taps stop, then ask the PC once */
  clearTimeout(jumpT); const base = ptime(); jumpT = setTimeout(() => { const to = base + jumpAcc; jumpAcc = 0; document.querySelectorAll('.seekfx').forEach(x => x.classList.remove('on')); pSeek(to) }, 650) }
function menu(html){ const m = $('#pmenu'); m.innerHTML = html; m.hidden = false; clearTimeout(P.uiT); $('#player').classList.remove('hideui') }
const QUALS = [[0, 'Original'], [1080, '1080p'], [720, '720p'], [480, '480p (saves data)']];
function setMenu(){ const v = pv(), rates = [0.75, 1, 1.25, 1.5, 1.75, 2], f = P.f, info = P.info, away = !!(window.NVPC && NVPC.away);
  menu(`<div class="h">Speed</div>${rates.map(r => `<button data-rate="${r}" class="${(S.rate || 1) === r ? 'on' : ''}">${r === 1 ? 'Normal' : r + '×'}</button>`).join('')}
    ${f && f.pc && info && info.ffmpeg && pcv() >= 2 && P.mode !== 'file' ? `<div class="h">Quality ${away ? '(away from home)' : '(at home)'}</div>${QUALS.map(([q, t]) => `<button data-q="${q}" class="${(P.h || 0) === q ? 'on' : ''}">${t}</button>`).join('')}` : ''}
    ${info && info.audio && info.audio.length > 1 ? `<div class="h">Sound</div>${info.audio.map((a, i) => `<button data-aud="${i}" class="${P.audio === i ? 'on' : ''}">${esc(a)}</button>`).join('')}` : ''}
    ${f && f.pc && info && !P.h ? `<div class="h">From the PC</div><button data-conv="direct" class="${P.mode === 'direct' ? 'on' : ''}">As it is (best picture)</button>${info.ffmpeg ? `<button data-conv="conv" class="${P.mode === 'conv' ? 'on' : ''}">Converted by the PC (plays everything)</button>` : ''}` : ''}
    ${f && f.pc && onPhone(f) ? `<div class="h">Play from</div><button data-from="phone" class="${P.mode === 'file' ? 'on' : ''}">This phone</button><button data-from="pc" class="${P.mode !== 'file' ? 'on' : ''}">The PC</button>` : ''}
    <div class="h">After an episode</div><button data-auto="1" class="${S.autoNext ? 'on' : ''}">Play the next one by itself</button><button data-auto="0" class="${!S.autoNext ? 'on' : ''}">Stop</button>`);
  $('#pmenu').onclick = e => { const b = e.target.closest('button'); if(!b) return; const at = ptime();
    if(b.dataset.rate){ S.rate = +b.dataset.rate; saveS(); v.playbackRate = S.rate }
    if(b.dataset.q != null){ const q = +b.dataset.q; S[away ? 'qAway' : 'qHome'] = q; saveS(); P.h = q;
      P.mode = q || (info.mode === 'transcode' && S.conv !== 'never') || S.conv === 'always' ? 'conv' : 'direct'; pLoad(null, at); toast(q ? `${q}p - the PC makes it smaller while you watch` : 'Original quality') }
    if(b.dataset.aud){ P.audio = +b.dataset.aud; if(P.mode !== 'conv'){ if(!info.ffmpeg){ toast('Changing the sound needs ffmpeg on the PC'); return } P.mode = 'conv' } pLoad(null, at) }
    if(b.dataset.conv){ if(b.dataset.conv !== P.mode){ P.mode = b.dataset.conv; pLoad(null, at) } }
    if(b.dataset.from){ play(f, {from:at, pc:b.dataset.from === 'pc'}); }
    if(b.dataset.auto){ S.autoNext = b.dataset.auto === '1'; saveS() }
    $('#pmenu').hidden = true; pShow(true) } }

/* ---------- subtitles: SRT / VTT / ASS (from the phone) or the PC's tracks (as WebVTT) ---------- */
/* which language a subtitle is, from its name ("Movie.nl.srt" → nl, "Nederlands", "English (forced)", "eng") */
const LANG_OF = {nl:'nl', nld:'nl', dut:'nl', nederlands:'nl', dutch:'nl', vlaams:'nl', flemish:'nl', en:'en', eng:'en', english:'en', fr:'fr', fre:'fr', fra:'fr', francais:'fr', french:'fr',
  de:'de', ger:'de', deu:'de', deutsch:'de', german:'de', es:'es', spa:'es', espanol:'es', spanish:'es', it:'it', ita:'it', italiano:'it', italian:'it', ja:'ja', jpn:'ja', japanese:'ja'};
const LANG_NAME = {nl:'Nederlands', en:'English', fr:'Français', de:'Deutsch', es:'Español', it:'Italiano', ja:'日本語'};
function langOf(label){ for(const w of norm(label).split(' ')) if(LANG_OF[w]) return LANG_OF[w]; return '' }
const prettySub = label => { const l = langOf(label), rest = norm(label).split(' ').filter(w => !LANG_OF[w]).join(' '); return l ? LANG_NAME[l] + (rest ? ' · ' + rest : '') : label };
const subDelay = f => (lsGet('nvCinema.subDelay', {})[f.id] || 0);
function setSubDelay(f, d){ const all = lsGet('nvCinema.subDelay', {}); d = Math.round(d * 10) / 10; if(d) all[f.id] = d; else delete all[f.id]; lsSet('nvCinema.subDelay', all) }
function loadSubs(f, info){ const l = [];
  for(const s of (f.local && f.local.subs) || []) l.push({label:s.label || 'Subtitles', get:() => fetch(linkUrl(s.uri, s.name)).then(r => r.text())});
  for(const s of f.subs || []) l.push({label:s.label || 'Subtitles', get:async () => s.kind === 'copy' ? (await dbGet('blobs', s.bid)).blob.text() : fetch(linkUrl(s.uri, s.name)).then(r => r.text())});
  if(info && f.pc) for(const s of info.subs || []) l.push({label:s.label, pc:1, pcid:s.id, get:() => fetch(NVPC.url(`/nv/vsub?id=${encodeURIComponent(f.pc.id)}&s=${encodeURIComponent(s.id)}`)).then(r => { if(!r.ok) throw new Error('The PC answered ' + r.status); return r.text() })});
  P.subs = l; P.sub = -1; P.cues = []; if($('#pcc')) $('#pcc').style.opacity = l.length ? 1 : .45;
  /* on: the same one as last time, else the first in the language order (Dutch, then English), synced ones first */
  if(S.subOn && l.length){ const i = bestSub(l); if(i >= 0) pickSub(i, true) } }
function bestSub(l){ let i = l.findIndex(x => norm(x.label) === norm(S.subLabel || '')); if(i >= 0) return i;
  for(const lang of S.subLangs || ['nl', 'en']){ const c = l.map((x, n) => [x, n]).filter(([x]) => langOf(x.label) === lang); if(c.length) return (c.find(([x]) => /synced|sync/i.test(x.label)) || c[c.length - 1])[1] }
  return -1 }
function subMenu(){ const f = P.f, d = f ? subDelay(f) : 0, cur0 = P.subs[P.sub], online = pcv() >= 2 && (f.pc || onPhone(f));
  menu(`<div class="h">Subtitles</div><button data-sub="-1" class="${P.sub < 0 ? 'on' : ''}">Off</button>${P.subs.map((s, i) => `<button data-sub="${i}" class="${P.sub === i ? 'on' : ''}">${esc(prettySub(s.label))}${s.pc ? ' <span class="muted small">(PC)</span>' : ''}</button>`).join('')}
    ${online ? `<button data-find="1">🔍 Find ${esc((S.subLangs || ['nl', 'en']).map(l => LANG_NAME[l] || l).join(' / '))} online…</button>` : ''}
    ${cur0 && cur0.pc && P.mode !== 'file' ? '<button data-sync="1">Sync these to the film (the PC listens)</button>' : ''}
    ${P.sub >= 0 ? `<div class="h">Timing · ${d ? (d > 0 ? 'later ' : 'earlier ') + Math.abs(d).toFixed(1) + ' s' : 'as in the file'}</div><button data-dl="-0.5">◀ Earlier 0.5 s</button><button data-dl="0.5">Later 0.5 s ▶</button>${d ? '<button data-dl="0">Back to the file’s timing</button>' : ''}` : ''}
    <div class="h">Size</div><button data-sz="-1">Smaller</button><button data-sz="1">Bigger</button>`);
  $('#pmenu').onclick = e => { const b = e.target.closest('button'); if(!b) return;
    if(b.dataset.sz){ S.subSize = Math.max(-3, Math.min(4, (S.subSize || 0) + +b.dataset.sz)); saveS(); applyCues(); return }
    if(b.dataset.dl != null){ setSubDelay(f, +b.dataset.dl === 0 ? 0 : subDelay(f) + +b.dataset.dl); showCue(); subMenu(); return }
    $('#pmenu').hidden = true; pShow(true);
    if(b.dataset.find){ findSubsNow(f); return }
    if(b.dataset.sync){ syncSubNow(f, cur0); return }
    const i = +b.dataset.sub; if(i < 0){ P.sub = -1; P.cues = []; S.subOn = false; saveS(); showCue(); return } S.subOn = true; S.subLabel = P.subs[i].label; saveS(); pickSub(i) } }
async function pickSub(i, quiet){ const s = P.subs[i], f = P.f; P.sub = i; P.cues = [];
  try{ const txt = await s.get(); if(P.f !== f || P.sub !== i) return; P.cues = parseSubs(txt); if(!P.cues.length) throw new Error('empty'); if(!quiet) toast('Subtitles: ' + prettySub(s.label)) }
  catch(e){ LE('subs', 'could not read ' + s.label, e); if(!quiet) toast('Could not read these subtitles', 3500) } showCue() }

/* ---------- subtitles found online (OpenSubtitles, through the PC: it has the file, syncs it and keeps it next to the video) ---------- */
const AUTOSUB = {}; let SUBSETUP = null;
async function subsReady(){ if(SUBSETUP != null) return SUBSETUP; if(pcv() < 2) return false;
  try{ const r = await fetch(NVPC.url('/nv/cin/subs/setup')); SUBSETUP = !!(await r.json()).ok }catch(e){ return false } return SUBSETUP }
/* OpenSubtitles' fingerprint of a video on the phone: its size + the 64-bit sums of the first and last 64 KB */
async function phoneHash(f){ let size = (f.local && f.local.size) || f.size || 0, head, tail;
  if(f.src && f.src.kind === 'copy' && !f.local){ const b = (await dbGet('blobs', f.src.bid)).blob; size = b.size; head = await b.slice(0, 65536).arrayBuffer(); tail = await b.slice(Math.max(0, size - 65536)).arrayBuffer() }
  else { const u = phoneUrl(f); head = await (await fetch(u, {headers:{Range:'bytes=0-65535'}})).arrayBuffer(); tail = await (await fetch(u, {headers:{Range:`bytes=${Math.max(0, size - 65536)}-${size - 1}`}})).arrayBuffer() }
  let h = BigInt(size); const M = (1n << 64n) - 1n;
  for(const buf of [head, tail]){ const dv = new DataView(buf.slice(0, buf.byteLength - buf.byteLength % 8)); for(let i = 0; i < dv.byteLength; i += 8) h = (h + dv.getBigUint64(i, true)) & M }
  return h.toString(16).padStart(16, '0') }
async function findSubsOnline(f){ const t = TM[f.tid], langs = (S.subLangs || ['nl', 'en']).join(',');
  if(pcv() < 2 || !(await NVPC.reachable())) throw new Error('Finding subtitles online goes through your PC (The Nightvault › My PC, with the newest PC app).');
  if(!(await subsReady())) throw new Error('Set up OpenSubtitles first: Cinema ⚙ › Subtitles online.');
  const qs = new URLSearchParams({langs, query:t.name}); if(t.tmdb) qs.set('tmdb', t.tmdb.id); if(t.kind === 'show' && f.e != null){ qs.set('season', f.s); qs.set('episode', f.e) }
  if(f.pc && !(P.f === f && P.mode === 'file')){ qs.set('id', f.pc.id); const r = await fetch(NVPC.url('/nv/cin/subs/find?' + qs)), j = await r.json().catch(() => ({}));
    if(!j.ok) throw new Error(j.error || 'The PC answered ' + r.status); delete VINFO[f.pc.id]; return Object.assign(j, {where:'pc'}) }
  qs.set('hash', await phoneHash(f)); qs.set('name', f.name);
  const r = await fetch(NVPC.url('/nv/cin/subs/hashfind?' + qs)), j = await r.json().catch(() => ({})); if(!j.ok) throw new Error(j.error || 'The PC answered ' + r.status);
  const bid = 'b' + uid(), label = (LANG_NAME[j.lang] || j.lang) + ' (online)'; await dbPut('blobs', {id:bid, blob:new Blob([j.text], {type:'text/plain'}), name:f.name + '.' + j.lang + '.srt'});
  f.subs = (f.subs || []).concat({kind:'copy', bid, label}); await dbPut('files', f);
  return Object.assign(j, {where:'phone', label, how:j.hash ? 'made for this exact file' : 'for this title', sync:'not synced (use Earlier / Later if needed)'}) }
async function findSubsNow(f, quiet){ if(!quiet) toast('Looking for subtitles online… (the PC also syncs them, this can take a minute)', 6000);
  try{ const j = await findSubsOnline(f); L('subs', 'found online', j);
    if(P.f === f){ if(j.where === 'pc'){ P.info = await pcInfo(f); loadSubs(f, P.info); const stem = f.pc.name.replace(/\.[^.]+$/, ''), lab = j.file.replace(/\.srt$/i, '').slice(stem.length).replace(/^[\s._-]+/, ''); const i = P.subs.findIndex(x => x.label === lab); if(i >= 0){ S.subOn = true; S.subLabel = lab; saveS(); pickSub(i, true) } }
      else { loadSubs(f, P.info); const i = P.subs.findIndex(x => x.label === j.label); if(i >= 0) pickSub(i, true) } }
    toast(`${LANG_NAME[j.lang] || j.lang} subtitles found (${j.how})${j.sync ? ' · ' + j.sync : ''}`, 6000); return true }
  catch(e){ LE('subs', 'find online', e); if(!quiet) toast(e.message || String(e), 6000); return false } }
async function syncSubNow(f, s){ toast('The PC listens to the film and lines the subtitles up… (up to a minute)', 6000);
  try{ const r = await fetch(NVPC.url(`/nv/cin/subs/sync?id=${encodeURIComponent(f.pc.id)}&s=${encodeURIComponent(s.pcid)}&lang=${langOf(s.label) || 'sub'}&a=${P.audio || 0}`)), j = await r.json().catch(() => ({}));
    if(!j.ok) throw new Error(j.error || 'The PC answered ' + r.status); delete VINFO[f.pc.id];
    if(P.f === f){ P.info = await pcInfo(f); loadSubs(f, P.info); const stem = f.pc.name.replace(/\.[^.]+$/, ''), lab = j.file.replace(/\.srt$/i, '').slice(stem.length).replace(/^[\s._-]+/, ''), i = P.subs.findIndex(x => x.label === lab); if(i >= 0){ S.subLabel = lab; saveS(); pickSub(i, true) } }
    setSubDelay(f, 0); toast('Synced: ' + j.sync, 5000) }catch(e){ LE('subs', 'sync', e); toast(e.message || String(e), 6000) } }
/* a PC film without Dutch / English subtitles: look for them by itself (once per film per session) */
async function autoFindSubs(f){ if(!S.autoSubs || !S.subOn || !f.pc || AUTOSUB[f.id] || pcv() < 2) return; AUTOSUB[f.id] = 1;
  if(P.subs.some(s => (S.subLangs || ['nl', 'en']).includes(langOf(s.label)))) return;
  if(!(await subsReady())) return; findSubsNow(f, true) }
function parseSubs(txt){ txt = String(txt || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n'); const out = [];
  const ts = s => { const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,:](\d{1,3})$/); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : null };
  if(/^\[Script Info\]/m.test(txt) || /^Dialogue:/m.test(txt)){   /* ASS / SSA: the Dialogue lines; styling and drawings are left out */
    const fmt = (txt.match(/^\[Events\][\s\S]*?^Format:\s*(.+)$/m) || [, 'Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'])[1].split(',').map(x => x.trim().toLowerCase());
    const si = fmt.indexOf('start'), ei = fmt.indexOf('end'), ti = fmt.indexOf('text');
    for(const line of txt.split('\n')){ if(!line.startsWith('Dialogue:')) continue; const parts = line.slice(9).split(','), text = parts.slice(ti).join(',');
      if(/\\p[1-9]/.test(text)) continue; const a = ts(parts[si]), b = ts(parts[ei]); if(a == null || b == null) continue;
      const clean = text.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim(); if(clean) out.push({a, b, text:clean}) }
    return out.sort((x, y) => x.a - y.a) }
  for(const block of txt.split(/\n{2,}/)){ const lines = block.split('\n'); const i = lines.findIndex(l => l.includes('-->')); if(i < 0) continue;
    const [x, y] = lines[i].split('-->'), a = ts(x), b = ts((y || '').trim().split(/\s+/)[0]); if(a == null || b == null) continue;
    const text = lines.slice(i + 1).join('\n').replace(/<(?!\/?[ibu]>)[^>]+>/gi, '').replace(/\{\\[^}]*\}/g, '').trim(); if(text) out.push({a, b, text}) }
  return out.sort((x, y) => x.a - y.a) }
/* our own subtitle line (works the same for a converted stream that starts later: the real time is P.off + currentTime) */
function applyCues(){ let el = $('#pcue'); if(!el && $('#player') && !$('#player').hidden){ el = document.createElement('div'); el.id = 'pcue'; $('#player').insertBefore(el, $('#pui')) }
  if(el) el.style.fontSize = `calc(clamp(16px,3.6vmin,30px) * ${Math.pow(1.15, S.subSize || 0).toFixed(3)})`; showCue() }
function showCue(){ const el = $('#pcue'); if(!el || !pv()) return; if(P.sub < 0 || !P.cues.length){ el.innerHTML = ''; return }
  const t = ptime() - subDelay(P.f), c = P.cues.filter(x => x.a <= t && x.b > t).map(x => x.text); const h = c.map(x => esc(x).replace(/&lt;(\/?[ibu])&gt;/gi, '<$1>').replace(/\n/g, '<br>')).join('<br>');
  if(el.dataset.h !== h){ el.dataset.h = h; el.innerHTML = h ? `<span>${h}</span>` : '' } }

/* =====================================================================================================================
   SAVE TO PHONE (Take with me): PC videos copied into a folder on the phone, for a plane or a camping trip. Films are too big
   for the app's own storage, so they go into a folder you pick (Android: NvPc.saveToFolder). A video the phone can't play is
   converted by the PC on the way (to MP4). Every save is one offline copy in the shared list (The Nightvault › My PC).
   ===================================================================================================================== */
const safeName = s => String(s || 'Video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Video';
const VMIME = {mp4:'video/mp4', m4v:'video/mp4', mov:'video/quicktime', mkv:'video/x-matroska', webm:'video/webm', avi:'video/x-msvideo', ts:'video/mp2t'};
async function saveSheet(t, files){ files = files.filter(f => f.pc && !f.local);
  if(!files.length){ toast('Already on this phone'); return }
  if(!NvPcP || !NvFiles){ toast('Saving from the PC works in the Nightvault Android app', 4000); return }
  if(!(await NVPC.reachable(true))){ PCON = false; toast('Your PC is not reachable - at home with Nightvault running on the PC?', 4500); draw(); return }
  const size = files.reduce((n, f) => n + (f.pc.size || f.size || 0), 0), fo = lsGet('nvCinema.saveFolder', null);
  sheet(`<h3>Save “${esc(t.name)}” to the phone</h3><p class="muted small" style="margin:0 0 10px">${plural(files.length, 'video')} · ${mb(size)}. It goes into a folder on the phone (a film is too big for the app itself) and plays without the PC or internet.</p>
    <div class="mlist">${fo ? `<button class="btn primary" id="svhere">Save into “${esc(fo.name)}”</button>` : ''}<button class="btn ${fo ? '' : 'primary'}" id="svpick">${fo ? 'Another folder…' : 'Pick the folder to save into'}</button></div>
    <p class="muted small" style="margin:10px 0 0">Tip: make a folder like “Movies to go” on the phone or SD card once. Videos the phone can’t play (HEVC, DTS…) are converted by the PC on the way - that takes longer. Remove them again with ⋯ › Remove the phone copy, or in The Nightvault › My PC.</p>`);
  if($('#svhere')) $('#svhere').onclick = () => doSave(t, files, fo);
  $('#svpick').onclick = async () => { let f; try{ f = await NvFiles.pickFolder() }catch(e){ if(!/cancel|No folder/i.test(e.message || '')) toast(e.message || String(e)); return } lsSet('nvCinema.saveFolder', f); doSave(t, files, f) } }
async function doSave(t, files, fo){ const me = {stop:false}, rec = 'save:' + uid(), uris = []; let done = 0, bytes = 0, failed = 0, saved = 0, curName = '';
  const total = files.reduce((n, f) => n + (f.pc.size || f.size || 0), 0);
  sheet(`<h3>Saving to the phone…</h3><div class="prog"><i id="svp"></i></div><div class="muted small" id="svt" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">starting…</div><p class="muted small">The screen stays on while it saves. Keep the phone near the Wi‑Fi.</p><button class="btn" id="svstop" style="width:100%">Stop after this video</button>`, true);
  $('#svstop').onclick = () => { me.stop = true; $('#svstop').disabled = true; $('#svstop').textContent = 'Stopping after this video…' }; awake(true);
  let hl = null; try{ hl = await NvPcP.addListener('saveProgress', e => { if(e.name !== curName) return; const p = $('#svp'); if(p && total) p.style.width = Math.min(100, 100 * (bytes + (e.done || 0)) / total) + '%'; const s = $('#svt'); if(s) s.textContent = `${done + 1} of ${files.length} · ${mb(e.done || 0)} · ${curName}` }) }catch(e){}
  for(const f of files){ if(me.stop) break; const tt = TM[f.tid] || t;
    try{ const info = await pcInfo(f).catch(() => null), conv = !!(info && info.mode === 'transcode' && info.ffmpeg && S.conv !== 'never');
      const stem = f.pc.name.replace(/\.[^.]+$/, ''), name = conv ? stem + '.mp4' : f.pc.name, ext = (name.split('.').pop() || '').toLowerCase();
      const folder = 'Nightvault Cinema/' + safeName(tt.name + (tt.year && tt.kind === 'movie' ? ` (${tt.year})` : '')) + (tt.kind === 'show' && f.s != null ? '/' + (f.s === 0 ? 'Specials' : 'Season ' + f.s) : '');
      curName = name; const s = $('#svt'); if(s) s.textContent = `${done + 1} of ${files.length} · ${conv ? 'converting on the PC · ' : ''}${name}`;
      const o = await NvPcP.saveToFolder({tree:fo.tree, folder, name, path:conv ? `/nv/vstream?id=${encodeURIComponent(f.pc.id)}&start=0&a=0` : '/nv/file?id=' + encodeURIComponent(f.pc.id), mime:VMIME[ext] || 'video/mp4'});
      const subs = []; for(const sb of (info && info.subs) || []){ try{ const sn = `${stem}.${safeName(sb.label)}.vtt`, so = await NvPcP.saveToFolder({tree:fo.tree, folder, name:sn, path:`/nv/vsub?id=${encodeURIComponent(f.pc.id)}&s=${encodeURIComponent(sb.id)}`, mime:'text/vtt'}); subs.push({uri:so.uri, name:sn, label:sb.label}); uris.push(so.uri) }catch(e){} }
      f.local = {uri:o.uri, name, size:o.size || 0, tree:fo.tree, rec, subs, conv, at:Date.now()}; uris.push(o.uri); await dbPut('files', f); saved++; bytes += f.pc.size || o.size || 0 }
    catch(err){ failed++; LE('save', 'could not save ' + f.name, err); if(/space|full|ENOSPC/i.test(String(err && err.message))){ me.stop = true; toast('The phone is full', 5000) } }
    done++; const p = $('#svp'); if(p && total) p.style.width = Math.min(100, 100 * bytes / total) + '%' }
  try{ hl && hl.remove() }catch(e){} awake(false);
  if(saved) NVPC.offline.add({app:'cinema', id:rec, title:t.name, size:files.filter(f => f.local && f.local.rec === rec).reduce((n, f) => n + (f.local.size || 0), 0), n:saved, files:uris, del:[]});
  L('save', `saved ${saved} of ${files.length} into ${fo.name}`, {failed}); closeSheet(); draw();
  toast(`${plural(saved, 'video')} saved to the phone${failed ? ` · ${failed} failed (debug log)` : ''}${me.stop && saved < files.length ? ' · stopped' : ''}`, 5000) }
/* remove phone copies; the PC still has them */
async function unsave(files, quiet){ files = files.filter(f => f.local); if(!files.length) return;
  if(!quiet && !confirm(`Remove the phone copy of ${plural(files.length, 'video')} (${mb(files.reduce((n, f) => n + (f.local.size || 0), 0))})? It stays on the PC.`)) return;
  const byRec = {}; for(const f of files) (byRec[f.local.rec || '-'] = byRec[f.local.rec || '-'] || []).push(f);
  for(const [rec, fs] of Object.entries(byRec)){ const r = window.NVPC && NVPC.offline.get('cinema', rec), all = FILES.filter(f => f.local && f.local.rec === rec);
    if(r && all.length === fs.length) await NVPC.offline.remove('cinema', rec);
    else { const gone = fs.flatMap(f => [f.local.uri].concat((f.local.subs || []).map(s => s.uri)));
      if(NvFiles) for(const u of gone) await NvFiles.remove({uri:u}).catch(() => {});
      if(r){ r.files = (r.files || []).filter(u => !gone.includes(u)); r.n = Math.max(0, (r.n || 0) - fs.length); r.size = all.filter(f => !fs.includes(f)).reduce((n, f) => n + (f.local.size || 0), 0); NVPC.offline.add(r) } } }
  for(const f of files){ f.local = null; if(f.pc || f.src) await dbPut('files', f) }
  const bare = files.filter(f => !f.pc && !f.src).map(f => f.id); if(bare.length) await dropFiles(bare); for(const t of TITLES.filter(t => !filesOf(t).length && !t.want)) await dropTitle(t);
  if(P.f && files.includes(P.f)) pClose(); closeSheet(); reindex(); draw(); if(!quiet) toast('Phone copy removed - it plays from the PC again when you are home') }
/* a phone copy removed in The Nightvault › My PC: forget it here too */
async function pruneSaved(){ if(!window.NVPC) return; const ch = [];
  for(const f of FILES) if(f.local && f.local.rec && !NVPC.offline.get('cinema', f.local.rec)){ f.local = null; ch.push(f) }
  if(!ch.length) return; await dbPutMany('files', ch.filter(f => f.pc || f.src)); const bare = ch.filter(f => !f.pc && !f.src).map(f => f.id); if(bare.length) await dropFiles(bare); reindex() }

/* =====================================================================================================================
   SETTINGS
   ===================================================================================================================== */
const LANGS = [['en-US', 'English'], ['nl-NL', 'Nederlands'], ['nl-BE', 'Nederlands (België)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['es-ES', 'Español'], ['it-IT', 'Italiano'], ['ja-JP', '日本語']];
function tmdbSheet(){
  sheet(`<h3>TMDB (posters, story, series, episode names)</h3><p class="note">Your key stays on this device only (not in the app, not on GitHub, not on the PC).</p>
    <div class="field"><label>API key (v3) or API read access token</label><input type="password" id="tk" value="${esc(TKEY())}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <p class="muted small" style="margin:0 0 8px">Free: make an account at <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener">themoviedb.org</a>, then Settings › API › “Create” (personal use). Copy the “API Key”.</p>
    <div class="field"><label>Language of names and stories</label><select id="tlang" style="width:100%;height:42px">${LANGS.map(([k, n]) => `<option value="${k}" ${S.lang === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" style="flex:1" id="ttest">Save and test</button><button class="btn" style="flex:1" onclick="closeSheet()">Close</button></div><div id="tres" class="small" style="margin-top:8px"></div>
    <p class="muted small" style="margin-top:12px">This app uses the TMDB API but is not endorsed or certified by TMDB.</p>`, true);
  $('#ttest').onclick = async () => { lsSet('nvCinema.tmdb', $('#tk').value.trim()); const nl = $('#tlang').value, ch = nl !== S.lang; S.lang = nl; saveS(); const el = $('#tres'); el.innerHTML = '<div class="prog busy"><i></i></div>';
    if(!TKEY()){ el.innerHTML = 'Saved (no key).'; return }
    try{ const r = await tmSearch('Inception', 'movie', 2010); el.innerHTML = `<div class="ok">✓ TMDB works (${esc((r[0] || {}).title || 'no result')})</div>`;
      const todo = TITLES.filter(t => !t.tmdb); if(todo.length){ el.innerHTML += `<div class="muted">Looking up ${plural(todo.length, 'title')} without details…</div>`; for(const t of todo) t.tmdbTried = 0; autoMatch(todo) }
      if(ch) for(const k of Object.keys(EPI)) delete EPI[k] }
    catch(e){ el.innerHTML = `<div class="bad">✗ ${esc(e.message)}</div>` } } }
function appSettings(){ const all = shelves(true), fl = FOLDERS();
  sheet(`<h3>Cinema</h3><div class="mlist"><button class="btn primary" id="as_tmdb">TMDB (posters and info)${TKEY() ? ' ✓' : ''}</button>${TKEY() ? '<button class="btn" id="as_fill">Fill in missing details (TMDB)</button>' : ''}</div>
    ${NvFiles ? `<div class="sec">Folders on this phone</div>${fl.map((f, i) => `<div class="li" style="cursor:default"><div class="n"><div>${esc(f.name)}</div><div class="s">${plural(FILES.filter(x => x.src && x.src.tree === f.tree).length, 'video')}</div></div><button class="btn sm" data-fscan="${i}">Look for new</button><button class="btn sm" data-fdel="${i}">Forget</button></div>`).join('') || '<p class="muted small">None yet.</p>'}<button class="btn" id="as_fold" style="width:100%;margin-top:6px">Add a folder</button>` : ''}
    ${window.NVPC && NVPC.native ? `<div class="sec">My PC</div>${NVPC.pc ? `<div class="muted small">${esc(NVPC.pc.name || 'PC')} · ${plural(TITLES.filter(titleOnPc).length, 'title')} from the PC</div><button class="btn" id="as_pc" style="width:100%;margin-top:6px">Get the PC's newest list</button>` : '<div class="muted small">Not connected.</div>'}<a class="btn" href="../hub/index.html" style="width:100%;margin-top:6px;text-decoration:none">The Nightvault › My PC (pair, phone copies)</a>
      ${NVPC.pc ? `<div class="sec">Away from home</div><div class="muted small">${NVPC.away ? '● Now connected through ' + esc(NVPC.pc.base.replace(/^http:\/\//, '')) + '. ' : ''}${(NVPC.pc.alts || []).length || NVPC.pc.own ? 'Away addresses: ' + esc([...(NVPC.pc.alts || []), NVPC.pc.own].filter(Boolean).map(a => a.replace(/^http:\/\//, '')).join(', ')) : 'Install <b>Tailscale</b> (free) on the PC and this phone and log in with the same account on both - Cinema then finds the PC away from home by itself.'}</div>
        <div class="opt"><label for="as_qa">Quality away from home</label><select id="as_qa">${QUALS.map(([q, t]) => `<option value="${q}" ${+S.qAway === q ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="opt"><label for="as_qh">Quality at home</label><select id="as_qh">${QUALS.map(([q, t]) => `<option value="${q}" ${+S.qHome === q ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <button class="btn sm" id="as_away" style="margin-top:4px">Type an away address…</button>` : ''}
      ${lsGet('nvCinema.saveFolder', null) ? `<div class="muted small" style="margin-top:6px">Saved videos go into “${esc(lsGet('nvCinema.saveFolder', {}).name)}”. <span class="lnk" id="as_sfx">Change</span></div>` : ''}` : ''}
    <div class="sec">Playing</div>
    <div class="opt"><label for="as_next">Play the next episode by itself</label><input type="checkbox" id="as_next" ${S.autoNext ? 'checked' : ''}></div>
    ${window.NVPC && NVPC.native ? `<div class="opt"><label for="as_conv">Videos from the PC</label><select id="as_conv"><option value="auto" ${!S.conv || S.conv === 'auto' ? 'selected' : ''}>Convert only when needed</option><option value="always" ${S.conv === 'always' ? 'selected' : ''}>Always convert (smaller, steady)</option><option value="never" ${S.conv === 'never' ? 'selected' : ''}>Never convert</option></select></div>` : ''}
    ${window.calSettingsHTML ? calSettingsHTML() : ''}
    <div class="sec">Subtitles</div>
    <div class="opt"><label for="as_sl">Language</label><select id="as_sl">${[['nl,en', 'Nederlands, else English'], ['en,nl', 'English, else Nederlands'], ['nl', 'Only Nederlands'], ['en', 'Only English']].map(([k, t]) => `<option value="${k}" ${(S.subLangs || []).join(',') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="opt"><label for="as_son">Subtitles on when a film starts</label><input type="checkbox" id="as_son" ${S.subOn ? 'checked' : ''}></div>
    ${window.NVPC && NVPC.native ? `<div class="opt"><label for="as_auto">Find them online by themselves when a PC film has none (synced by the PC)</label><input type="checkbox" id="as_auto" ${S.autoSubs ? 'checked' : ''}></div><button class="btn" id="as_os" style="width:100%;margin-top:6px">Subtitles online (OpenSubtitles)…</button>` : ''}
    <div class="opt"><label for="as_guess">Guess the film series from the name (Shrek 2 → Shrek) when TMDB has none</label><input type="checkbox" id="as_guess" ${S.guess ? 'checked' : ''}></div>
    <div class="sec">Shelves (tap ↑ to move one up)</div>
    ${all.map((s, i) => `<div class="li" style="cursor:default"><span style="width:30px;display:flex;justify-content:center">${shelfIcon(s, 20)}</span><div class="n"><div>${esc(s.name)}</div><div class="s">${unit(s.id, inShelf(s.id).length)}${s.hidden ? ' · hidden' : ''}</div></div><button class="btn sm" data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-eye="${esc(s.id)}">${s.hidden ? 'Show' : 'Hide'}</button></div>`).join('')}
    <button class="btn" id="as_shelf" style="width:100%;margin-top:6px">+ A new shelf</button>
    <div class="sec">Your list</div><div class="mlist"><button class="btn" id="as_save">Save my Cinema list (backup file)</button><button class="btn" id="as_load">Load from a backup file</button></div>
    <p class="muted small">Your list is kept on this device: titles, where the videos are, what you watched, groups. A backup file has all of that, not the videos themselves and not your TMDB key.</p>
    <p class="muted small">Info and posters: <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a> (this app uses the TMDB API but is not endorsed or certified by TMDB). Problems? Switch on <b>Debug mode</b> at the bottom of The Nightvault and send the log.</p>`);
  $('#as_tmdb').onclick = () => tmdbSheet(); if($('#as_fill')) $('#as_fill').onclick = () => { closeSheet(); fillDetails(TITLES.slice()) };
  if($('#as_fold')) $('#as_fold').onclick = () => { closeSheet(); linkFolder(null, null) };
  if($('#as_pc')) $('#as_pc').onclick = () => { closeSheet(); pcSync(true) };
  if($('#as_sfx')) $('#as_sfx').onclick = async () => { try{ const f = await NvFiles.pickFolder(); lsSet('nvCinema.saveFolder', f); appSettings() }catch(e){} };
  $('#as_next').onchange = e => { S.autoNext = e.target.checked; saveS() };
  $('#as_sl').onchange = e => { S.subLangs = e.target.value.split(','); saveS() }; if(window.calSettingsHook) calSettingsHook();
  $('#as_son').onchange = e => { S.subOn = e.target.checked; saveS() };
  if($('#as_auto')) $('#as_auto').onchange = e => { S.autoSubs = e.target.checked; saveS() };
  if($('#as_os')) $('#as_os').onclick = () => osSheet();
  if($('#as_qa')) $('#as_qa').onchange = e => { S.qAway = +e.target.value; saveS() };
  if($('#as_qh')) $('#as_qh').onchange = e => { S.qHome = +e.target.value; saveS() };
  if($('#as_away')) $('#as_away').onclick = async () => { const a = await ask('PC address away from home', 'Tailscale address, like 100.101.102.103 or my-pc', (NVPC.pc.own || '').replace(/^http:\/\//, ''), 'Save'); if(a == null) return;
    NVPC.setAway(a); const ok = await NVPC.reachable(true); toast(ok ? (NVPC.away ? 'Connected through ' + a : 'Saved - at home it uses the home address') : 'Saved - the PC does not answer right now', 4500); appSettings() };
  if($('#as_conv')) $('#as_conv').onchange = e => { S.conv = e.target.value; saveS() };
  $('#as_guess').onchange = e => { S.guess = e.target.checked; saveS(); regroup(); draw() };
  $('#as_shelf').onclick = async () => { const n = await ask('Name of the new shelf', 'Like Documentaries or Kids', '', 'Make it'); if(n){ addOwnShelf(n); draw(); appSettings() } };
  $('.sheet').addEventListener('click', async e => { const u = e.target.closest('[data-up]'), ey = e.target.closest('[data-eye]'), fs = e.target.closest('[data-fscan]'), fd = e.target.closest('[data-fdel]'), set = lsGet('nvCinema.shelves', {});
    if(u){ const ids = shelves(true).map(s => s.id), i = +u.dataset.up; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; set._order = ids; lsSet('nvCinema.shelves', set); appSettings(); draw() }
    if(ey){ set.hidden = set.hidden || {}; set.hidden[ey.dataset.eye] = !set.hidden[ey.dataset.eye]; lsSet('nvCinema.shelves', set); appSettings(); draw() }
    if(fs){ scanFolder(FOLDERS()[+fs.dataset.fscan], false) }
    if(fd){ const f = FOLDERS()[+fd.dataset.fdel], n = FILES.filter(x => x.src && x.src.tree === f.tree);
      if(!confirm(`Forget the folder “${f.name}”? Its ${plural(n.length, 'video')} leave Cinema (the files stay on the phone).`)) return;
      for(const x of n){ x.src = null; if(x.pc || x.local) await dbPut('files', x) } await dropFiles(n.filter(x => !x.pc && !x.local).map(x => x.id)); for(const t of TITLES.filter(t => !filesOf(t).length && !t.want)) await dropTitle(t);
      lsSet('nvCinema.folders', FOLDERS().filter(x => x.tree !== f.tree)); if(NvFiles && !lsGet('nvMusic.folders', []).concat(lsGet('nvAudio.folders', [])).some(x => x.tree === f.tree)) NvFiles.forget({tree:f.tree}).catch(() => {});
      reindex(); appSettings(); draw(); toast('Folder forgotten') } });
  $('#as_save').onclick = () => saveBackup(); $('#as_load').onclick = () => loadBackup() }
/* OpenSubtitles: the owner's own free account, kept on the PC (it does the searching, downloading and syncing) */
async function pcPost(path, data){ const H = NATIVE && Capacitor.Plugins && Capacitor.Plugins.CapacitorHttp, key = await NVPC.key();
  if(!H) throw new Error('Only in the Nightvault Android app');
  const r = await H.request({url:NVPC.pc.base + path + (path.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(key), method:'POST', headers:{'Content-Type':'application/json'}, data});
  const j = typeof r.data === 'string' ? JSON.parse(r.data || '{}') : r.data || {}; if(r.status >= 400) throw new Error(j.error || 'The PC answered ' + r.status); return j }
async function osSheet(){
  if(pcv() < 2 || !(await NVPC.reachable(true))){ toast('This needs your PC with the newest PC app (vault_cinema.py) - at home or through Tailscale.', 5000); return }
  let st = {}; try{ st = await (await fetch(NVPC.url('/nv/cin/subs/setup'))).json() }catch(e){}
  sheet(`<h3>Subtitles online (OpenSubtitles)</h3><p class="note">Kept on your PC (not on this phone, not on GitHub). The PC searches, downloads, lines them up with the film and saves them next to the video.</p>
    <div class="field"><label>API key</label><input type="password" id="os_k" placeholder="${st.key ? '(saved - type to change)' : ''}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label>User name</label><input type="text" id="os_u" value="${esc(st.user || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label>Password</label><input type="password" id="os_p" placeholder="${st.user ? '(saved - type to change)' : ''}" autocomplete="off"></div>
    <p class="muted small" style="margin:0 0 8px">Free: make an account at <a href="https://www.opensubtitles.com" target="_blank" rel="noopener">opensubtitles.com</a>, then in your profile “API consumers” › New consumer, and copy its API key. A free account can download a few subtitles a day - each one is downloaded once and kept.</p>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" style="flex:1" id="os_go">Save and test</button><button class="btn" style="flex:1" onclick="closeSheet()">Close</button></div><div id="os_res" class="small" style="margin-top:8px"></div>`, true);
  $('#os_go').onclick = async () => { const el = $('#os_res'); el.innerHTML = '<div class="prog busy"><i></i></div>'; const d = {user:$('#os_u').value.trim()};
    if($('#os_k').value.trim()) d.apikey = $('#os_k').value.trim(); if($('#os_p').value) d.password = $('#os_p').value;
    try{ const j = await pcPost('/nv/cin/subs/setup', d); SUBSETUP = null; el.innerHTML = j.ok ? `<div class="ok">✓ OpenSubtitles works${j.user ? ' (logged in as ' + esc(j.user) + ')' : ''}</div>` : `<div class="bad">✗ ${esc(j.error || 'did not work')}</div>` }
    catch(e){ el.innerHTML = `<div class="bad">✗ ${esc(e.message)}</div>` } } }
function shelfSettings(sh){ const s = shelfOf(sh), G = grOf(sh);
  sheet(`<h3>${esc(s.name)}</h3>
    <div class="sec" style="margin-top:4px">Your groups on this shelf</div><div class="mlist"><button class="btn" id="ss_save">Save my groups</button><button class="btn" id="ss_load">Load from a file</button></div>
    <div class="sec">This shelf</div><div class="mlist"><button class="btn" id="ss_ren">Rename this shelf</button><button class="btn" id="ss_hide">Hide this shelf</button><button class="btn" id="ss_all">All settings…</button></div>`);
  $('#ss_save').onclick = async () => { try{ const r = await G.saveBackup(); if(r !== 'cancelled') toast('Groups saved') }catch(e){ toast(e.message || String(e), 4000) } };
  $('#ss_load').onclick = async () => { const t = await G.pickFile(); if(!t) return; const c = G.checkBackup(t); if(!c.ok){ toast(c.msg, 5000); return }
    if(!confirm(c.msg + '\n\nPut these groups back? (Undo is possible right after.)')) return; G.applyBackup(c.d); regroup(); closeSheet(); draw(); G.undoToast('Groups loaded', () => { regroup(); draw() }) };
  $('#ss_ren').onclick = async () => { const n = await ask('Rename the shelf', '', s.name, 'Rename'); if(!n) return; const set = lsGet('nvCinema.shelves', {});
    if(sh.startsWith('x-')) set._own = (set._own || []).map(x => x.id === sh ? Object.assign({}, x, {name:n}) : x); else set[sh] = Object.assign({}, set[sh], {name:n});
    lsSet('nvCinema.shelves', set); draw() };
  $('#ss_hide').onclick = () => { const set = lsGet('nvCinema.shelves', {}); set.hidden = set.hidden || {}; set.hidden[sh] = true; lsSet('nvCinema.shelves', set); closeSheet(); V = [{v:'shelves'}]; draw(); toast(`${s.name} is hidden - show it again in Settings on the first page`, 4500) };
  $('#ss_all').onclick = () => appSettings() }
$('#setbtn').onclick = () => { const v = cur(); if(v.v === 'shelves' || v.v === 'title' || v.v === 'cal') appSettings(); else shelfSettings(v.shelf) };
$('#addbtn').onclick = () => addSheet();

/* ---------- backup file: titles, where the videos are, what you watched, groups and settings (not the videos, not the TMDB key) ---------- */
async function saveBackup(){ const ls = {}; for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k.startsWith('nvCinema.') && k !== 'nvCinema.tmdb') ls[k] = localStorage.getItem(k) }
  const D = new Date(), p2 = n => String(n).padStart(2, '0'), name = `nightvault-cinema_${D.getFullYear()}-${p2(D.getMonth() + 1)}-${p2(D.getDate())}.json`;
  const text = JSON.stringify({format:'nightvault-cinema', version:1, saved:D.toISOString(), titles:TITLES, files:FILES.filter(f => !(f.src && f.src.kind === 'copy')), watch:Object.values(WATCH), local:ls});
  try{ if(NATIVE){ const FS = Capacitor.registerPlugin('Filesystem'), SH = Capacitor.registerPlugin('Share'); const r = await FS.writeFile({path:name, data:text, directory:'CACHE', encoding:'utf8'}); await SH.share({title:name, files:[r.uri], dialogTitle:'Save or send ' + name}) }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:'application/json'})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000) }
    toast(`Saved ${plural(TITLES.length, 'title')}`) }catch(e){ if(!/cancel/i.test(e.message || '')) toast(e.message || String(e), 4000) } }
function loadBackup(){ const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.style.display = 'none'; document.body.appendChild(i);
  i.onchange = async () => { const f = i.files[0]; i.remove(); if(!f) return; let d; try{ d = JSON.parse(await f.text()) }catch(e){ d = null }
    if(!d || d.format !== 'nightvault-cinema' || !Array.isArray(d.titles)){ toast('This is not a Cinema backup file.', 5000); return }
    if(!confirm(`Backup from ${new Date(d.saved).toLocaleString()} with ${plural(d.titles.length, 'title')}.\n\nThis REPLACES the list in Cinema now (videos copied into the app stay). Go on?`)) return;
    const keep = FILES.filter(x => x.src && x.src.kind === 'copy');
    await tx('titles', 'readwrite', st => { st.clear() }); await tx('files', 'readwrite', st => { st.clear() }); await tx('watch', 'readwrite', st => { st.clear() });
    const tids = new Set(d.titles.map(t => t.id));
    await dbPutMany('titles', d.titles.concat(TITLES.filter(t => !tids.has(t.id) && keep.some(x => x.tid === t.id)))); await dbPutMany('files', (d.files || []).concat(keep)); await dbPutMany('watch', d.watch || []);
    for(const [k, v] of Object.entries(d.local || {})) if(k.startsWith('nvCinema.') && k !== 'nvCinema.tmdb') localStorage.setItem(k, v);
    Object.assign(S, lsGet('nvCinema.settings', {})); for(const k of Object.keys(GRS)) delete GRS[k]; await loadLib(); closeSheet(); V = [{v:'shelves'}]; draw(); toast(`Loaded ${plural(TITLES.length, 'title')}`) };
  i.click() }

/* ---------- Android back button: player → sheet → one screen back → The Nightvault ---------- */
if(window.Capacitor) try{ const A = (Capacitor.Plugins && Capacitor.Plugins.App) || Capacitor.registerPlugin('App');
  A.addListener('backButton', () => { if(!$('#player').hidden){ if(!$('#pmenu').hidden){ $('#pmenu').hidden = true; return } pClose(); return } if(sheetOpen()){ if(!$('#scrim').dataset.sticky) closeSheet(); return } if(back()) return; if(fromHub()){ location.href = '../hub/index.html'; return } A.minimizeApp && A.minimizeApp() });
  A.addListener('pause', () => { if(!$('#player').hidden) pSave(true) }) }catch(e){}
document.addEventListener('visibilitychange', () => { if(document.hidden && !$('#player').hidden) pSave(true) });

document.addEventListener('visibilitychange', () => { if(document.hidden) window.NVHERE && NVHERE.save('nvCinema.here', {V}) }); addEventListener('pagehide', () => window.NVHERE && NVHERE.save('nvCinema.here', {V}));   // back where you were (../hub/nvlog.js)
/* ---------- start ---------- */
(async () => {
  try{ await openDB(); await loadLib() }catch(e){ $('#body').innerHTML = `<p class="muted">Cinema could not open its storage: ${esc(e.message || e)}</p>`; return }
  await pruneSaved().catch(e => LE('start', 'prune', e));
  const Pq = new URLSearchParams(location.search), sh = Pq.get('shelf');
  if(sh) V.push({v:'shelf', shelf:sh});
  { const h = window.NVHERE && NVHERE.take('nvCinema.here'); if(h && Array.isArray(h.V) && h.V.length) V = h.V }
  if(Pq.get('title') && TM[Pq.get('title')]) V = [{v:'shelves'}, {v:'title', id:Pq.get('title'), shelf:TM[Pq.get('title')].shelf}];
  if(Pq.get('view') === 'cal') V = [{v:'shelves'}, {v:'cal'}];
  if(window.calStart) await calStart();
  try{ draw() }catch(e){ V = [{v:'shelves'}]; draw() } L('start', `${TITLES.length} titles, ${FILES.length} videos`);
  if(hasPc()) pcSync(false, true);
  setTimeout(() => autoMatch(), 1500);
  /* folders on the phone: look for new videos now and then (quietly) */
  if(NvFiles && FOLDERS().length && Date.now() - lsGet('nvCinema.scanAt', 0) > 6 * 3600e3) setTimeout(async () => { for(const f of FOLDERS()) await scanFolder(f, true).catch(() => {}); lsSet('nvCinema.scanAt', Date.now()) }, 4000);
  window.NVCINEMA = {get titles(){ return TITLES }, get files(){ return FILES }, get watch(){ return WATCH }, P, draw, go, play, pClose, parseVideo, makePlan, addPlan, mergePc, pcSync, parseSubs, guessSeries, seriesOf, nextUp, bestMatch, autoMatch, setWatch, groupsOf, get V(){ return V }};   // for testing
})();
