/* The Nightvault – automatic backups of EVERY app (decided with the owner 21 Oct 2026, after Music's list was emptied).
   One shared file: it knows where each app keeps its own data (localStorage keys + IndexedDB stores) and makes a backup of it
   now and then by itself. All apps live on one address in the Android app, so this file can read and put back any app's data.

   What is in a backup: the app's lists and settings (songs, playlists, favourites, play counts, groups, books and reading state,
   games, plays, films, models …). NOT in it: the media files themselves (they stay in your folders), pictures / covers (found again),
   files copied into the app, and your own API keys (type them again).

   Where:  1. inside the app (IndexedDB nvBackups, the newest 3 per app) – helps when an app's list gets emptied, like Music on 21 Oct
           2. a "backups folder" you pick once (The Nightvault > Backups) – a file there survives even removing the app (newest 5 per app)
   When:   by itself every 3 days when something changed (hub start + when an app opens); never over a good backup with an empty list.
   Offer:  an app whose list is empty while a backup has things in it asks "Put it back?".

   NVBACKUP.apps                       – {id: {title, …}}
   NVBACKUP.collect(app) / save(app, why) / auto(apps) / list(app) / load(entry) / restore(app, data, 'missing'|'replace')
   NVBACKUP.folder / pickFolder() / forgetFolder() / last(app) / count(app) / offer(app) */
(function(){
  const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  let F = null; if(NATIVE) try{ F = Capacitor.registerPlugin('NvFiles') }catch(e){ F = null }
  const FORMAT = 'nightvault-backup', EVERY = 3 * 864e5, KEEP_IN = 3, KEEP_OUT = 5;
  const log = (t, d) => { try{ window.NVLOG && NVLOG.log('backup', t, d) }catch(e){} };
  const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
  const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };

  /* Pocket keeps API keys inside its one big record: blank them, like its own backup does */
  const pocketScrub = raw => { try{ const s = JSON.parse(raw); (s.sources || []).forEach(x => x.key = ''); (s.games || []).forEach(g => { if(g.lookup) g.lookup.key = '' }); return JSON.stringify(s) }catch(e){ return raw } };
  const pocketCount = () => { let n = 0; for(const k of ['nightvault.pocket.test.v1', 'nightvault.pocket.v1']){ const s = lsGet(k, null); if(s && s.cards) n += s.cards.length } return n };
  /* every app: its localStorage prefixes, keys to leave out (API keys, caches, a running scan), its database and the stores with
     its lists (stores with pictures / files are left out), the main store (what "empty" means) and its word for one item */
  const APPS = {
    scanner:{title:'Scanner & Binder', ls:['nightvault.pocket.'], scrub:{'nightvault.pocket.test.v1':pocketScrub, 'nightvault.pocket.v1':pocketScrub}, countFn:pocketCount, word:['card', 'cards']},
    music:{title:'Music', ls:['nvMusic.'], skip:['nvMusic.scan'], db:'nvAudio', stores:['tracks', 'lists', 'mstats'], main:'tracks', word:['song', 'songs'], dedupe:{tracks:'uri'}},
    audiobooks:{title:'Audiobooks', ls:['nvAudio.'], db:'nvAudio', stores:['books', 'state'], main:'books', word:['book', 'books']},
    bookcase:{title:'Bookcase', ls:['nvBooks.'], skip:['nvBooks.cvKey'], db:'nvBooks', stores:['books', 'state'], main:'books', word:['book', 'books']},
    games:{title:'Games', ls:['nvGames.'], skip:['nvGames.keys', 'nvGames.igdbTok'], db:'nvGames', stores:['games', 'kv'], main:'games', word:['game', 'games']},
    boardgames:{title:'Boardgames', ls:['nvBoard.'], db:'nvBoard', stores:['items', 'plays', 'kv', 'files'], main:'items', word:['game', 'games']},
    cinema:{title:'Cinema', ls:['nvCinema.'], skip:['nvCinema.tmdb'], db:'nvCinema', stores:['titles', 'files', 'watch', 'kv'], main:'titles', word:['title', 'titles']},
    print3d:{title:'3D Print', ls:['nvPrint.'], db:'nvPrint', stores:['models', 'extras', 'prints', 'kv'], main:'models', word:['model', 'models']},
    hub:{title:'The Nightvault', ls:['nvHub.', 'nvOffline'], word:['setting', 'settings']}
  };
  const plural = (n, w) => `${(+n).toLocaleString()} ${n === 1 ? w[0] : w[1]}`;

  /* ---------- reading and writing an app's database, without ever creating one ---------- */
  function openDb(name){ return new Promise(ok => { let made = false;
    try{ const r = indexedDB.open(name);
      r.onupgradeneeded = () => { made = true; try{ r.transaction.abort() }catch(e){} };   // the app was never opened here: leave it alone
      r.onsuccess = () => ok(made ? (r.result.close(), null) : r.result); r.onerror = () => ok(null); r.onblocked = () => ok(null) }catch(e){ ok(null) } }) }
  const reqP = q => new Promise((ok, no) => { q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error) });
  async function storeAll(db, s){ if(!db || !db.objectStoreNames.contains(s)) return []; return reqP(db.transaction(s).objectStore(s).getAll()) }
  async function storeCount(db, s){ if(!db || !db.objectStoreNames.contains(s)) return 0; return reqP(db.transaction(s).objectStore(s).count()) }
  /* pictures and files inside a record are left out (and kept from the stored record when it is put back) */
  function strip(v, path, out){
    if(v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)){ out.push(path); return null }
    if(Array.isArray(v)) return v.map((x, i) => strip(x, path.concat(i), out));
    if(v && typeof v === 'object' && !(v instanceof Date)){ const o = {}; for(const k of Object.keys(v)) o[k] = strip(v[k], path.concat(k), out); return o }
    return v }
  const lsKeys = a => { const out = []; for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k && (a.ls || []).some(p => k === p || k.startsWith(p)) && !(a.skip || []).includes(k)) out.push(k) } return out.sort() };

  async function count(app){ const a = APPS[app]; if(!a) return 0; if(a.countFn) return a.countFn();
    if(!a.main) return lsKeys(a).length; const db = await openDb(a.db); try{ return await storeCount(db, a.main) }catch(e){ return 0 } finally{ db && db.close() } }
  async function collect(app){ const a = APPS[app]; if(!a) throw new Error('Unknown app ' + app);
    const ls = {}; for(const k of lsKeys(a)){ const v = localStorage.getItem(k); ls[k] = a.scrub && a.scrub[k] ? a.scrub[k](v) : v }
    const stores = {}, counts = {};
    if(a.db){ const db = await openDb(a.db);
      try{ for(const s of a.stores || []){ const recs = (await storeAll(db, s)).map(r => { const p = [], c = strip(r, [], p); if(p.length) c.__nvs = p; return c }); stores[s] = recs; counts[s] = recs.length } }
      finally{ db && db.close() } }
    const main = a.countFn ? a.countFn() : a.main ? counts[a.main] || 0 : Object.keys(ls).length;
    return {format:FORMAT, version:1, app, title:a.title, saved:new Date().toISOString(), main, counts, ls, stores} }
  /* what is in it, in words: "1,234 songs · 12 lists" */
  const describe = d => { const a = APPS[d.app] || {word:['item', 'items']}; const bits = [plural(d.main || 0, a.word)];
    if(d.app === 'music' && d.counts.lists) bits.push(plural(d.counts.lists, ['playlist', 'playlists']));
    if(d.app === 'boardgames' && d.counts.plays) bits.push(plural(d.counts.plays, ['play', 'plays']));
    if(d.app === 'print3d' && d.counts.prints) bits.push(plural(d.counts.prints, ['print', 'prints']));
    return bits.join(' · ') };

  /* ---------- packing: gzip when the phone can (much smaller), base64 for the Android bridge ---------- */
  async function pack(obj){ const s = JSON.stringify(obj);
    if(window.CompressionStream) return new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    return new TextEncoder().encode(s) }
  async function unpack(u8){ if(u8[0] === 0x1f && u8[1] === 0x8b) return JSON.parse(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    return JSON.parse(new TextDecoder().decode(u8)) }
  const b64 = u8 => { let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s) };
  const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u };
  const hash = s => { let h = 2166136261; for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(36) };

  /* ---------- copies inside the app (IndexedDB nvBackups) ---------- */
  let BDB = null;
  const bdb = () => BDB || (BDB = new Promise((ok, no) => { const r = indexedDB.open('nvBackups', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('b', {keyPath:'id'}); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) }));
  async function inAll(app){ const db = await bdb(); const all = await reqP(db.transaction('b').objectStore('b').getAll()); return all.filter(x => !app || x.app === app).sort((a, b) => b.at - a.at) }
  async function inPut(rec){ const db = await bdb(); await new Promise((ok, no) => { const t = db.transaction('b', 'readwrite'); t.objectStore('b').put(rec); t.oncomplete = ok; t.onerror = t.onabort = () => no(t.error) }) }
  async function inDel(id){ const db = await bdb(); await new Promise(ok => { const t = db.transaction('b', 'readwrite'); t.objectStore('b').delete(id); t.oncomplete = t.onerror = t.onabort = () => ok() }) }

  /* ---------- the backups folder (picked once; a file there survives removing the app) ---------- */
  const fileName = (app, at) => { const D = new Date(at), p = n => String(n).padStart(2, '0'); return `nightvault-${app}-backup_${D.getFullYear()}-${p(D.getMonth() + 1)}-${p(D.getDate())}_${p(D.getHours())}${p(D.getMinutes())}.json.gz` };
  const NAME_RE = /^nightvault-([a-z0-9]+)-backup_(\d{4})-(\d\d)-(\d\d)_(\d\d)(\d\d)\.json(\.gz)?$/;
  async function outList(app){ const f = NVBACKUP.folder; if(!F || !f) return [];
    const r = await F.list({tree:f.tree, depth:0}); return (r.files || []).map(x => { const m = x.name.match(NAME_RE); return m && (!app || m[1] === app) ? {where:'folder', app:m[1], at:new Date(+m[2], m[3] - 1, +m[4], +m[5], +m[6]).getTime(), uri:x.uri, name:x.name, size:x.size} : null }).filter(Boolean).sort((a, b) => b.at - a.at) }

  /* ---------- making a backup ---------- */
  async function save(app, why){
    const d = await collect(app), body = JSON.stringify([d.ls, d.stores]), h = hash(body), u8 = await pack(d), at = Date.parse(d.saved), info = {main:d.main, text:describe(d), size:u8.length, why:why || 'auto'};
    await inPut({id:app + '|' + at, app, at, hash:h, info, data:new Blob([u8])});
    for(const x of (await inAll(app)).slice(KEEP_IN)) await inDel(x.id);
    let folder = null;
    if(F && NVBACKUP.folder){ try{ await F.write({tree:NVBACKUP.folder.tree, name:fileName(app, at), data:b64(u8), mime:'application/gzip'}); folder = true;
        for(const x of (await outList(app)).slice(KEEP_OUT)) await F.remove({uri:x.uri}).catch(() => {}) }
      catch(e){ folder = false; log('folder copy failed', {app, err:e.message || String(e), code:e.code}); lsSet('nvBackup.folderErr', {at:Date.now(), msg:e.message || String(e)}) } }
    const L = lsGet('nvBackup.last', {}); L[app] = {at, hash:h, main:d.main, text:info.text, folder}; lsSet('nvBackup.last', L);
    log('saved', {app, why, main:d.main, kb:Math.round(u8.length / 1024), folder}); return {at, info, folder} }

  /* by itself: every few days when something changed - and never over a good backup with an (almost) empty list */
  let RUN = null;
  async function auto(apps){
    if(RUN) return RUN;
    RUN = (async () => { const out = [];
      for(const app of apps || Object.keys(APPS)){ try{
        const L = lsGet('nvBackup.last', {})[app], n = await count(app);
        if(!n) continue;                                                          // nothing (or an emptied list): keep the older backups as they are
        if(L && L.main >= 20 && n < L.main * 0.5){ log('skipped: far fewer than in the last backup', {app, now:n, last:L.main}); continue }
        if(L && Date.now() - L.at < EVERY) continue;
        if(L){ const d = await collect(app); if(hash(JSON.stringify([d.ls, d.stores])) === L.hash && Date.now() - L.at < 5 * EVERY){ L.at = Date.now(); const all = lsGet('nvBackup.last', {}); all[app] = L; lsSet('nvBackup.last', all); continue } }
        out.push(app, await save(app, 'auto')) }catch(e){ log('auto failed', {app, err:e.message || String(e)}) } }
      return out })().finally(() => { RUN = null });
    return RUN }

  /* ---------- all backups of one app: inside the app + in the folder ---------- */
  async function list(app){
    const ins = (await inAll(app)).map(x => ({where:'app', app:x.app, at:x.at, id:x.id, info:x.info}));
    let outs = []; try{ outs = await outList(app) }catch(e){ log('folder list failed', {err:e.message || String(e)}) }
    return ins.concat(outs).sort((a, b) => b.at - a.at) }
  async function load(e){
    if(e.where === 'app'){ const db = await bdb(); const r = await reqP(db.transaction('b').objectStore('b').get(e.id)); return unpack(new Uint8Array(await r.data.arrayBuffer())) }
    if(e.where === 'folder'){ const r = await F.read({uri:e.uri, offset:0, length:Math.max(e.size || 0, 1) + 16}); return unpack(unb64(r.data)) }
    if(e.where === 'file') return unpack(new Uint8Array(await e.file.arrayBuffer()));
    throw new Error('Unknown backup') }
  const check = (d, app) => !d || d.format !== FORMAT ? 'This is not a Nightvault backup file.' : app && d.app !== app ? `This backup is from ${d.title || d.app}, not from ${APPS[app].title}.` : '';

  /* ---------- putting it back ----------
     'missing' (recommended): adds what is not here now (songs, playlists, plays …) and settings that are empty – nothing is overwritten
     'replace': makes the app exactly like the backup (a backup of how it is now is made first) */
  const EMPTY_V = new Set([null, '', '[]', '{}', 'null', '""']);
  async function restore(app, d, mode){
    const a = APPS[app]; if(check(d, app)) throw new Error(check(d, app));
    if(mode === 'replace') try{ if(await count(app)) await save(app, 'before putting back') }catch(e){}
    let nls = 0, nrec = 0;
    for(const [k, v] of Object.entries(d.ls || {})){ if((a.skip || []).includes(k)) continue;
      if(mode === 'replace' || EMPTY_V.has(localStorage.getItem(k))){ try{ localStorage.setItem(k, v); nls++ }catch(e){} } }
    if(a.db && d.stores){ const db = await openDb(a.db);
      if(!db && Object.values(d.stores).some(l => l.length)) throw new Error(`Open ${a.title} once first, then put the backup back.`);
      try{ for(const [s, recs] of Object.entries(d.stores)){ if(!db.objectStoreNames.contains(s)) continue;
          const have = await storeAll(db, s), byId = new Map(have.map(r => [r.id, r])), dk = (a.dedupe || {})[s], dv = dk ? new Set(have.map(r => r[dk]).filter(Boolean)) : null;
          const put = [];
          for(const r0 of recs){ const r = Object.assign({}, r0), paths = r.__nvs || []; delete r.__nvs; const cur = byId.get(r.id);
            if(mode !== 'replace' && (cur || (dv && r[dk] && dv.has(r[dk])))) continue;
            for(const p of paths){ let src = cur, dst = r; for(let i = 0; i < p.length - 1 && src && dst; i++){ src = src[p[i]]; dst = dst[p[i]] } if(dst) dst[p[p.length - 1]] = src ? src[p[p.length - 1]] : null }
            put.push(r) }
          await new Promise((ok, no) => { const t = db.transaction(s, 'readwrite'), st = t.objectStore(s); if(mode === 'replace') st.clear(); for(const r of put) st.put(r); t.oncomplete = ok; t.onerror = t.onabort = () => no(t.error) });
          nrec += put.length } }
      finally{ db && db.close() } }
    log('put back', {app, mode, saved:d.saved, records:nrec, settings:nls}); return {records:nrec, settings:nls} }

  /* ---------- an app whose list is empty while a backup has things in it: offer to put it back ---------- */
  async function offer(app){
    const a = APPS[app]; if(!a) return;
    const n = await count(app), all = await list(app).catch(() => []), best = all.find(x => (x.info ? x.info.main : 1) > 0);
    const lastMain = (lsGet('nvBackup.last', {})[app] || {}).main || 0;
    if(!best || (n > 0 && !(lastMain >= 20 && n < lastMain * 0.5))) return;
    const key = app + '|' + best.at; if(lsGet('nvBackup.dismissed', []).includes(key)) return;
    let d; try{ d = await load(best) }catch(e){ log('offer: could not read the backup', {err:e.message || String(e)}); return }
    if(!d.main || (n && d.main <= n)) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
    el.innerHTML = `<div style="width:100%;max-width:520px;background:var(--panel,#151b26);color:var(--text,#e8ecf3);border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.5);font:15px/1.45 system-ui,sans-serif">
      <b style="font-size:17px">${n ? `${a.title} has far fewer ${a.word[1]} than before` : `${a.title} is empty`}</b>
      <p style="margin:8px 0;opacity:.8">There is a backup from <b>${new Date(best.at).toLocaleString()}</b> with ${describe(d)}${n ? `, now there ${n === 1 ? 'is' : 'are'} ${plural(n, a.word)}` : ''}. Put it back? Only what is missing now is added - nothing is overwritten.</p>
      ${app === 'music' || app === 'audiobooks' || app === 'bookcase' || app === 'cinema' || app === 'print3d' ? `<p style="margin:0 0 10px;opacity:.65;font-size:13px">Your files themselves stay in their folders. If something doesn't open afterwards, pick its folder again in Settings – nothing is added twice.</p>` : ''}
      <div style="display:flex;gap:8px"><button type="button" data-x="no" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--line,#2b3446);background:transparent;color:inherit;font:inherit">Not now</button>
      <button type="button" data-x="yes" style="flex:2;padding:12px;border-radius:12px;border:0;background:var(--accentd,#2f8f6a);color:#fff;font:inherit;font-weight:700">Put it back</button></div></div>`;
    document.body.appendChild(el);
    el.onclick = async e => { const b = e.target.closest('[data-x]'); if(!b) return;
      if(b.dataset.x === 'no'){ lsSet('nvBackup.dismissed', lsGet('nvBackup.dismissed', []).concat(key).slice(-30)); el.remove(); return }
      b.disabled = true; b.textContent = 'Putting it back…';
      try{ await restore(app, d, 'missing'); el.remove(); location.reload() }catch(err){ b.disabled = false; b.textContent = 'Put it back'; alertLine(el, err.message || String(err)) } } }
  const alertLine = (el, t) => { let p = el.querySelector('.nvberr'); if(!p){ p = document.createElement('p'); p.className = 'nvberr'; p.style.cssText = 'color:#f19a9a;margin:10px 0 0'; el.firstElementChild.appendChild(p) } p.textContent = t };

  /* the app this page is (from its address): Music and Audiobooks share audio/ */
  function here(){ const p = location.pathname, q = location.search;
    if(/\/audio\//.test(p)) return /mode=music/.test(q) ? 'music' : 'audiobooks';
    const m = p.match(/\/(books|games|boardgames|cinema|print3d)\//); return m ? (m[1] === 'books' ? 'bookcase' : m[1]) : null }

  const NVBACKUP = {
    native:!!F, apps:APPS, here, collect, save, auto, list, load, restore, check, describe, count, offer, plural,
    get folder(){ return lsGet('nvBackup.folder', null) },
    last:app => lsGet('nvBackup.last', {})[app] || null,
    async pickFolder(){ if(!F) throw new Error('Only in the Nightvault Android app'); const f = await F.pickFolder(); lsSet('nvBackup.folder', {tree:f.tree, name:f.name}); lsSet('nvBackup.folderErr', null); log('folder picked', {name:f.name}); return f },
    forgetFolder(){ lsSet('nvBackup.folder', null) },
    /* a browser has no folder: a backup file as a download */
    async download(app){ const d = await collect(app), u8 = await pack(d), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], {type:'application/gzip'})); a.download = fileName(app, Date.now()); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000) }
  };
  window.NVBACKUP = NVBACKUP;
  /* on an app's own page: offer a backup when its list is empty, then make one by itself when it is due (after the app has settled) */
  const app = here();
  if(app) window.addEventListener('load', () => { setTimeout(() => offer(app).catch(e => log('offer failed', {err:e.message || String(e)})), 2500); setTimeout(() => auto([app]).catch(() => {}), 20000) });
})();
