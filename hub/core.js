/* The Nightvault core (test): which apps are installed, what they offer, installing / updating / removing them.
   Every Nightvault app can load this file and ask, for example, NV.need('convert'): it answers with the installed app that offers
   it, or - when none is installed - which app would, so the app can hide the feature or offer "Install Nightvault Convert".
   Removing an app only removes its downloaded files: shared data (the collection, settings) is never touched. */
(function(){
  const HUB = new URL('./', document.currentScript ? document.currentScript.src : location.href).href;   // .../hub/
  const SITE = new URL('../', HUB).href;                                                                    // the site root
  const REG = 'nvHub.installed';
  const get = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
  const set = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
  let _cat = null;
  const NV = {
    site:SITE, hub:HUB,
    /* the app list from GitHub (versions, sizes, what each app offers and uses) */
    catalog(fresh){ if(!_cat || fresh) _cat = fetch(HUB + 'apps.json', {cache:'no-cache'}).then(r => { if(!r.ok) throw new Error('App list not available (' + r.status + ')'); return r.json() }).then(j => j.apps || []).catch(e => { _cat = null; throw e }); return _cat },
    installed(){ return get(REG, {}) },
    isInstalled(id){ return !!NV.installed()[id] },
    async app(id){ return (await NV.catalog()).find(a => a.id === id) || null },
    url(app){ return app && app.entry ? SITE + app.entry : null },
    /* who offers a service: {ok:true, app} when an installed app does, else {ok:false, app:<the app that would>} */
    async need(service){ const cat = await NV.catalog(), inst = NV.installed(), all = cat.filter(a => (a.provides || []).includes(service));
      const have = all.find(a => inst[a.id]); return have ? {ok:true, app:have} : {ok:false, app:all.find(a => !a.soon) || all[0] || null} },
    updateAvailable(app){ const i = NV.installed()[app.id]; return !!(i && app.version && i.version !== app.version) },
    /* download every file of an app (kept in the browser's app storage); onProgress(doneBytes, totalBytes) */
    async install(id, onProgress){
      const app = await NV.app(id); if(!app) throw new Error('Unknown app: ' + id); if(app.soon) throw new Error(app.name + ' is not ready yet');
      const total = app.size || 1; let done = 0, cache = null;
      try{ if(self.caches){ await caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('nvapp-' + id + '-')).map(k => caches.delete(k)))); cache = await caches.open('nvapp-' + id + '-' + app.version) } }catch(e){ cache = null }
      for(const f of app.files || []){
        const u = SITE + f.path + '?v=' + app.hash, r = await fetch(u, {cache:'no-cache'});
        if(!r.ok) throw new Error(`Could not download ${f.path} (${r.status})`);
        const b = await r.arrayBuffer(); done += b.byteLength;
        if(cache) try{ await cache.put(SITE + f.path, new Response(b, {headers:{'Content-Type':r.headers.get('Content-Type') || 'application/octet-stream'}})) }catch(e){}
        onProgress && onProgress(Math.min(done, total), total) }
      const reg = NV.installed(); reg[id] = {version:app.version, size:app.size, at:Date.now()}; set(REG, reg);
      return app },
    async remove(id){ try{ if(self.caches) await caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('nvapp-' + id + '-')).map(k => caches.delete(k)))) }catch(e){}
      const reg = NV.installed(); delete reg[id]; set(REG, reg) },
    /* for apps opened from The Nightvault: go back to the tiles */
    home(){ location.href = HUB }
  };
  window.NV = NV;
})();
