/* The Nightvault – shared groups: the ONE way every app puts its things (albums, films, games, boxes …) in tiles that can be groups,
   groups inside groups (no depth limit), with pins, a chosen tile cover, rename, undo and a backup file. Built first in Music.
   The rules and words are in plans/shared-groups.md. Load ../hub/nvgroups.js, then make one engine per app:

     const GR = NVGROUPS.make({
       prefix:'nvMusic',                       // localStorage keys: <prefix>.groups / .albumGroup / .groupParent / .groupCover / .pinned / .groupName
       app:'music', title:'Music',             // for the backup file
       itemsKey:'albumGroup',                  // name of the "put by hand" store (Music keeps its old name)
       key: it => it.key,                      // the item's own key
       hay: it => it.title + ' ' + it.artist,  // the words an own group name is matched against (whole words, longest name wins)
       auto: it => ({key:'a:..', name, kind}) || null,   // the automatic group (artist, series …), or null for none
       norm: s => …,                           // optional: how names are compared
       onRekey: (oldKey, newKey) => …          // optional: a group got a new key (rename) - move app data stored under the old key
     });

   GR.build(items) → {groups, singles}: groups have key, name, kind ('own' | the auto kinds), items (directly in it), kids, parent, all
   GR.all(g) · GR.path(g, gs) · GR.inside(g, gs) · GR.own(name) · GR.setParent(key, parentKey|null) · GR.put(itemKeys, g | 'none' | undefined)
   GR.rename(g, newName) → '' or a reason · GR.remove(g) · GR.pins() · GR.isPinned(id) · GR.togglePin(ids, on) · GR.pinFirst(list, idOf)
   GR.cover(gKey) / GR.setCover(gKey, choice|null) · GR.label(g)
   Undo:   GR.change(fn) runs fn after taking a snapshot;  GR.undoToast(message, redraw) shows "message · Undo" for 6 s
   Backup: GR.saveBackup() (share menu on Android, a download in a browser) · GR.restoreBackup(redraw) (pick the file, check it, put it back) */
(function(){
  const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const FORMAT = 'nightvault-groups';
  const log = (t, d) => { try{ window.NVLOG && NVLOG.log('groups', t, d) }catch(e){} };
  const stdNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  function make(o){
    const norm = o.norm || stdNorm, P = o.prefix, IK = o.itemsKey || 'itemGroup', keyOf = o.key || (x => x.key);
    const NAMES = {groups:'groups', items:IK, parent:'groupParent', cover:'groupCover', pinned:'pinned', label:'groupName'};
    const EMPTY = {groups:[], items:{}, parent:{}, cover:{}, pinned:[], label:{}};
    const lk = n => P + '.' + NAMES[n];
    const rd = n => { try{ const v = localStorage.getItem(lk(n)); return v == null ? JSON.parse(JSON.stringify(EMPTY[n])) : JSON.parse(v) }catch(e){ return JSON.parse(JSON.stringify(EMPTY[n])) } };
    const wr = (n, v) => { try{ localStorage.setItem(lk(n), JSON.stringify(v)) }catch(e){} };
    const ownKey = name => 'c:' + norm(name);
    const GR = {norm, read:rd, write:wr};

    /* ---------- which group each item is in ---------- */
    GR.build = function(items){
      const own = rd('groups'), ov = rd('items'), lab = rd('label'), G = {}, alone = [];
      const put = (key, name, kind, it) => { (G[key] = G[key] || {key, name, kind, items:[]}).items.push(it) };
      for(const g of own) if(norm(g.name)) G[ownKey(g.name)] = G[ownKey(g.name)] || {key:ownKey(g.name), name:g.name, kind:'own', items:[]};
      const ownBy = own.filter(g => norm(g.name)).sort((x, y) => norm(y.name).length - norm(x.name).length);
      for(const it of items){ const o = ov[keyOf(it)];
        if(o === 'none'){ alone.push(it); continue }
        if(o && o.key){ put(o.key, o.name, o.kind, it); continue }
        const hay = ' ' + norm(GR._hay(it)) + ' ', c = ownBy.find(g => hay.includes(' ' + norm(g.name) + ' '));   // whole words; the longest name wins
        if(c){ put(ownKey(c.name), c.name, 'own', it); continue }
        const a = GR._auto(it);
        if(a && a.key) put(a.key, a.name, a.kind, it); else alone.push(it) }
      /* a group can sit inside another group: <prefix>.groupParent {groupKey: parentKey} */
      const par = rd('parent'), hasKids = new Set(Object.values(par)), groups = [], singles = alone.slice();
      for(const g of Object.values(G)){ if(g.items.length > 1 || g.kind === 'own' || par[g.key] || hasKids.has(g.key)) groups.push(g); else if(g.items.length) singles.push(g.items[0]) }
      const byKey = Object.fromEntries(groups.map(g => [g.key, g]));
      for(const g of groups){ if(lab[g.key] && g.kind !== 'own') g.name = lab[g.key]; g.kids = []; g.parent = byKey[par[g.key]] && par[g.key] !== g.key ? par[g.key] : null }
      for(const g of groups) if(g.parent){ let p = byKey[g.parent], n = 0; while(p && p.parent && n++ < 20) p = byKey[p.parent]; if(n >= 20) g.parent = null; else byKey[g.parent].kids.push(g) }
      for(const g of groups) g.all = GR.all(g);
      return {groups, singles} };
    GR._hay = it => o.hay ? o.hay(it) : '';
    GR._auto = it => o.auto ? o.auto(it) : null;
    /* every item in a group and in the groups inside it */
    GR.all = (g, seen) => { seen = seen || new Set(); if(seen.has(g.key)) return []; seen.add(g.key); return g.items.concat(...(g.kids || []).map(k => GR.all(k, seen))) };
    GR.path = (g, gs) => { const by = Object.fromEntries(gs.map(x => [x.key, x])), out = [g.name]; let p = by[g.parent], n = 0; while(p && n++ < 20){ out.unshift(p.name); p = by[p.parent] } return out.join(' › ') };
    GR.inside = (g, gs) => { const out = []; const walk = k => { for(const x of gs) if(x.parent === k && !out.includes(x.key)){ out.push(x.key); walk(x.key) } }; walk(g.key); return out };
    GR.label = g => g.kind === 'own' ? 'Your group' : (o.kinds && o.kinds[g.kind]) || g.kind;

    /* ---------- changes ---------- */
    GR.own = name => { const l = rd('groups'); if(!l.some(x => norm(x.name) === norm(name))) l.push({name}); wr('groups', l); return {key:ownKey(name), name, kind:'own'} };
    GR.setParent = (key, parent) => { const par = rd('parent'); if(parent) par[key] = parent; else delete par[key]; wr('parent', par) };
    GR.put = (keys, g) => { const ov = rd('items'); for(const k of keys){ if(g === undefined) delete ov[k]; else ov[k] = g === 'none' ? 'none' : {key:g.key, name:g.name, kind:g.kind} } wr('items', ov) };
    /* a group's key changed: move everything that points at it */
    function rekey(from, to, name, kind){
      const ov = rd('items'); for(const k of Object.keys(ov)) if(ov[k] && ov[k].key === from) ov[k] = {key:to, name, kind}; wr('items', ov);
      const par = rd('parent'), np = {}; for(const [k, v] of Object.entries(par)) np[k === from ? to : k] = v === from ? to : v; wr('parent', np);
      const cv = rd('cover'); if(cv[from]){ cv[to] = cv[from]; delete cv[from] } wr('cover', cv);
      wr('pinned', rd('pinned').map(x => x === 'gr:' + from ? 'gr:' + to : x));
      try{ o.onRekey && o.onRekey(from, to) }catch(e){} }
    GR.rename = function(g, name){
      name = String(name || '').trim(); if(!norm(name)) return 'Type a name';
      if(name === g.name) return '';
      if(g.kind !== 'own'){ const lab = rd('label'); lab[g.key] = name; wr('label', lab); log('renamed', {from:g.name, to:name}); return '' }   // an artist / series tile keeps finding its items; only the name on the tile changes
      const to = ownKey(name), own = rd('groups');
      if(to !== g.key && own.some(x => ownKey(x.name) === to)) return `There is already a group called “${name}”`;
      /* the items in it now stay in it, also when the new name doesn't match their names */
      const ov = rd('items'); for(const it of g.items){ const k = keyOf(it); if(ov[k] === undefined) ov[k] = {key:g.key, name:g.name, kind:'own'} } wr('items', ov);
      wr('groups', own.map(x => ownKey(x.name) === g.key ? Object.assign({}, x, {name}) : x));
      rekey(g.key, to, name, 'own'); log('renamed', {from:g.name, to:name}); return '' };
    GR.remove = function(g){
      if(g.kind === 'own') wr('groups', rd('groups').filter(x => ownKey(x.name) !== g.key));
      const ov = rd('items'); for(const k of Object.keys(ov)) if(ov[k] && ov[k].key === g.key) delete ov[k]; wr('items', ov);
      const par = rd('parent'); for(const k of Object.keys(par)) if(par[k] === g.key){ if(g.parent) par[k] = g.parent; else delete par[k] } delete par[g.key]; wr('parent', par);
      const lab = rd('label'); delete lab[g.key]; wr('label', lab);
      wr('pinned', rd('pinned').filter(x => x !== 'gr:' + g.key)) };

    /* ---------- pins: always first on the page they are on ('it:<key>' / 'gr:<key>' in pin order; Music uses 'al:') ---------- */
    GR.pins = () => rd('pinned');
    GR.isPinned = id => rd('pinned').includes(id);
    GR.togglePin = (ids, on) => { let l = rd('pinned'); for(const id of ids){ const has = l.includes(id), want = on === undefined ? !has : on; if(want && !has) l.push(id); if(!want && has) l = l.filter(x => x !== id) } wr('pinned', l) };
    GR.pinFirst = (list, idOf) => { const l = rd('pinned'); if(!l.length) return list; const at = new Map(l.map((x, i) => [x, i]));
      return list.map((x, i) => [x, i]).sort((p, q) => { const a = at.has(idOf(p[0])) ? at.get(idOf(p[0])) : 1e9, b = at.has(idOf(q[0])) ? at.get(idOf(q[0])) : 1e9; return a - b || p[1] - q[1] }).map(x => x[0]) };

    /* ---------- tile cover choice: {t:'random'|'cycle'|'pic'|'item', al:itemKey} ---------- */
    GR.cover = k => rd('cover')[k] || {};
    GR.setCover = (k, v) => { const all = rd('cover'); if(v) all[k] = v; else delete all[k]; wr('cover', all) };

    /* ---------- undo: one step back ---------- */
    let SNAP = null;
    const snapshot = () => Object.fromEntries(Object.keys(NAMES).map(n => [n, localStorage.getItem(lk(n))]));
    GR.change = fn => { SNAP = snapshot(); return fn() };
    GR.undo = () => { if(!SNAP) return false; for(const [n, v] of Object.entries(SNAP)){ try{ v == null ? localStorage.removeItem(lk(n)) : localStorage.setItem(lk(n), v) }catch(e){} } SNAP = null; log('undo'); return true };
    GR.undoToast = (msg, redraw) => {
      let el = document.getElementById('nvundo');
      if(!el){ el = document.createElement('div'); el.id = 'nvundo';
        el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:200;display:flex;align-items:center;gap:12px;max-width:calc(100% - 32px);padding:10px 10px 10px 16px;border-radius:14px;background:var(--panel,#1b2130);color:var(--text,#e8ecf3);border:1px solid var(--line,#2b3446);box-shadow:0 8px 28px rgba(0,0,0,.45);font-size:14px';
        document.body.appendChild(el) }
      el.innerHTML = '<span style="flex:1;min-width:0"></span><button type="button" style="flex:none;border:0;border-radius:10px;padding:8px 14px;font:inherit;font-weight:700;background:var(--accentd,#3b6fd8);color:#fff">Undo</button>';
      el.firstChild.textContent = msg; el.hidden = false;
      const t = document.getElementById('toast'); if(t) t.classList.remove('on');   // the app's own small message would sit on top of it
      clearTimeout(GR._ut); GR._ut = setTimeout(() => { el.hidden = true; SNAP = null }, 6000);
      el.querySelector('button').onclick = () => { clearTimeout(GR._ut); el.hidden = true; if(GR.undo()){ redraw && redraw(); const t2 = document.getElementById('toast'); if(t2 && window.toast) toast('Undone') } } };

    /* ---------- backup file ---------- */
    GR.backupData = () => {
      const d = Object.fromEntries(Object.keys(NAMES).map(n => [n, rd(n)]));
      return {format:FORMAT, version:1, app:o.app, title:o.title || o.app, saved:new Date().toISOString(), groups:d.groups.length, data:d} };
    GR.saveBackup = async function(){
      const D = new Date(), p2 = n => String(n).padStart(2, '0'), name = `nightvault-${o.app}-groups_${D.getFullYear()}-${p2(D.getMonth() + 1)}-${p2(D.getDate())}_${p2(D.getHours())}${p2(D.getMinutes())}.json`, text = JSON.stringify(GR.backupData(), null, 1);
      try{
        if(NATIVE){ const FS = Capacitor.registerPlugin('Filesystem'), SH = Capacitor.registerPlugin('Share');
          const r = await FS.writeFile({path:name, data:text, directory:'CACHE', encoding:'utf8'});
          await SH.share({title:name, files:[r.uri], dialogTitle:'Save or send ' + name}); log('backup shared', {name}); return 'shared' }
        const blob = new Blob([text], {type:'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000); log('backup saved', {name}); return 'saved' }
      catch(e){ if(/cancel/i.test((e && e.message) || '')) return 'cancelled'; log('backup failed', {err:(e && e.message) || String(e)}); throw e } };
    /* checks a backup file; gives back {ok, msg, info} without changing anything */
    GR.checkBackup = function(text){
      let d; try{ d = JSON.parse(text) }catch(e){ return {ok:false, msg:'This is not a groups backup file.'} }
      if(!d || d.format !== FORMAT || !d.data) return {ok:false, msg:'This is not a groups backup file.'};
      if(d.app !== o.app) return {ok:false, msg:`This file is from ${d.title || d.app}, not from ${o.title || o.app}.`};
      return {ok:true, d, msg:`Groups from ${new Date(d.saved).toLocaleString()}: ${d.groups} of your own groups, ${Object.keys(d.data.items || {}).length} placed by hand, ${(d.data.pinned || []).length} pinned.`} };
    GR.applyBackup = d => { SNAP = snapshot(); for(const n of Object.keys(NAMES)){ const v = d.data[n]; if(v !== undefined && typeof v === typeof EMPTY[n] && Array.isArray(v) === Array.isArray(EMPTY[n])) wr(n, v) } log('backup restored', {saved:d.saved}) };
    /* opens the file picker; resolves with the file's text (or null) */
    GR.pickFile = () => new Promise(ok => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.style.display = 'none';
      i.onchange = async () => { const f = i.files[0]; i.remove(); ok(f ? await f.text() : null) }; document.body.appendChild(i); i.click() });
    return GR }

  window.NVGROUPS = {make, norm:stdNorm};
})();
