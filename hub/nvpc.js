/* The Nightvault – Take with me: the shared connection to the owner's PC (Nightvault PC app > Settings > Phone access, vault_phone.py).
   Every Nightvault app can load this file (../hub/nvpc.js) and use window.NVPC:
     NVPC.native                  – true inside the Android app (the only place it works: the web view can't load http from the PC itself)
     NVPC.pc                      – the paired PC {base, name, kinds, at} or null
     NVPC.pair(address, code)     – checks the PC and remembers it;  NVPC.forget()
     NVPC.reachable(force)        – is the PC there right now (home network, PC on)? cached for 30 s
     NVPC.url(path)               – address for the page: NVPC.url('/nv/file?id=..') → '/_nvpc_/nv/file?id=..' (Android fetches it from the PC)
     NVPC.list(kind, onProgress)  – the PC's library of one kind ('music', later 'audiobooks', 'books', 'video'); waits while the PC builds it
     NVPC.offline                 – ONE list of offline copies for all apps (localStorage nvOffline):
         add({app, id, title, size, n, del:[{db, store, ids}]})   – del says which stored records make up the copy, so any app
         all() / of(app) / get(app, id) / keep(app, id) / remove(app, id) / size(app)  (and the hub can remove them)
   Android side: NvPcPlugin (set / get / forget / hello / saveToFolder, and the /_nvpc_/ address in MainActivity). */
(function(){
  const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  let P = null; if(NATIVE) try{ P = Capacitor.registerPlugin('NvPc') }catch(e){ P = null }
  const KEY = 'nvPc', OFF = 'nvOffline';
  const get = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
  const set = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
  const log = (t, d) => { try{ window.NVLOG && NVLOG.log('pc', t, d) }catch(e){} };
  let reach = {at:0, ok:null, p:null};
  const norm = a => { a = String(a || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, ''); return a && !/:\d+$/.test(a) ? a + ':8766' : a };
  const NVPC = {
    native:!!P,
    get pc(){ return get(KEY, null) },
    async pair(address, code){
      if(!P) throw new Error('Only in the Nightvault Android app');
      const base = 'http://' + norm(address), key = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if(!norm(address)) throw new Error('Type the address the PC shows (like 192.168.1.20)');
      if(key.length < 6) throw new Error('Type the code the PC shows (8 letters and numbers)');
      let h; try{ h = await P.hello({base, key, timeout:6000}) }catch(e){ log('pair failed', {base, err:e.message || String(e)});
        throw new Error(/code/i.test(e.message || '') ? 'The code is not right - look in Nightvault on the PC: Settings > Phone access.' : 'Can\'t reach the PC at ' + norm(address) + '. Is the phone on the same Wi-Fi, is Nightvault running on the PC, and is Phone access switched on?') }
      await P.set({base, key}); set(KEY, {base, name:h.name || 'PC', kinds:h.kinds || [], at:Date.now()}); reach = {at:Date.now(), ok:true, p:null};
      log('paired', {base, name:h.name}); return NVPC.pc },
    async forget(){ if(P) await P.forget().catch(() => {}); set(KEY, null); reach = {at:0, ok:null, p:null} },
    async reachable(force){
      if(!P || !NVPC.pc) return false;
      if(!force && reach.ok != null && Date.now() - reach.at < 30000) return reach.ok;
      if(reach.p) return reach.p;
      reach.p = P.hello({timeout:2500}).then(() => true, () => false).then(ok => { reach = {at:Date.now(), ok, p:null}; return ok });
      return reach.p },
    url(path){ return '/_nvpc_' + (path.startsWith('/') ? path : '/' + path) },
    async list(kind, onProgress, fresh){
      for(let i = 0; i < 600; i++){
        const r = await fetch(NVPC.url(`/nv/list?kind=${encodeURIComponent(kind)}${fresh && !i ? '&fresh=1' : ''}`), {cache:'no-store'});
        const j = await r.json().catch(() => ({}));
        if(!r.ok) throw new Error(j.error || 'The PC answered ' + r.status);
        if(j.ready) return j;
        onProgress && onProgress(j.done || 0, j.total || 0);
        await new Promise(ok => setTimeout(ok, 1500)) }
      throw new Error('The PC is still getting the list ready - try again in a minute') },
    offline:{
      all(){ return get(OFF, []) },
      of(app){ return NVPC.offline.all().filter(x => x.app === app) },
      get(app, id){ return NVPC.offline.all().find(x => x.app === app && x.id === id) || null },
      add(rec){ const l = NVPC.offline.all().filter(x => !(x.app === rec.app && x.id === rec.id)); l.push(Object.assign({at:Date.now()}, rec)); set(OFF, l) },
      /* "Keep on this phone": it stays, but is no longer a temporary offline copy */
      keep(app, id){ set(OFF, NVPC.offline.all().filter(x => !(x.app === app && x.id === id))) },
      size(app){ return NVPC.offline.all().filter(x => !app || x.app === app).reduce((n, x) => n + (x.size || 0), 0) },
      /* removes the stored records the copy is made of (any app's, e.g. from The Nightvault's Downloads screen) */
      async remove(app, id){ const rec = NVPC.offline.get(app, id); if(!rec) return;
        for(const d of rec.del || []) await new Promise(ok => { try{ const r = indexedDB.open(d.db); r.onerror = () => ok();
          r.onsuccess = () => { const db = r.result; if(!db.objectStoreNames.contains(d.store)){ db.close(); return ok() }
            const t = db.transaction(d.store, 'readwrite'), st = t.objectStore(d.store); for(const k of d.ids || []) st.delete(k); t.oncomplete = t.onerror = t.onabort = () => { db.close(); ok() } } }catch(e){ ok() } });
        NVPC.offline.keep(app, id); log('offline copy removed', {app, id, title:rec.title}) } }
  };
  window.NVPC = NVPC;
})();
