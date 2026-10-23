/* The Nightvault – glow on NEW items (23 Oct 2026; plan: plans/ui.md). Shared: fix it here and every app gets it.
   An app adds one call after its data has loaded:
     NVNEW.watch({app:'bookcase', sel:'[data-col]', key:el => el.dataset.col, keys:() => Object.keys(COLS)})
   - `keys()` = every item the app has (from its data, not from the screen). Items that appear later (a scan of the SD card, a PC sync,
     something added by hand) are NEW.
   - The 24 hours start when the person FIRST OPENS THE APP with that item in it – not when the item arrived. The glow stops when the item is opened or after 24 h.
   - The first time an app is used everything it already has counts as old (no glow on an existing collection).
   - `sel` / `key` = the tiles on screen; they get the class `nvglow`. State: localStorage `nvItems` = {app:{b:1, k:{key:startedAt | 0 = old/opened}}}. */
(function(){
  'use strict';
  const H24 = 24 * 36e5, LS = 'nvItems';
  const CSS = `.nvglow{outline:2px solid var(--g,#4ee0a0)!important;outline-offset:-2px;box-shadow:0 0 0 1px var(--g,#4ee0a0),0 0 16px color-mix(in srgb,var(--g,#4ee0a0) 55%,transparent)!important;animation:nvglowp 2.6s ease-in-out infinite}
@keyframes nvglowp{50%{box-shadow:0 0 0 1px var(--g,#4ee0a0),0 0 6px color-mix(in srgb,var(--g,#4ee0a0) 30%,transparent)}}
@media (prefers-reduced-motion:reduce){.nvglow{animation:none}}`;
  const load = () => { try{ return JSON.parse(localStorage.getItem(LS)) || {} }catch(e){ return {} } };
  const save = o => { try{ localStorage.setItem(LS, JSON.stringify(o)) }catch(e){} };
  function watch(cfg){
    if(!document.getElementById('nvnewcss')){ const s = document.createElement('style'); s.id = 'nvnewcss'; s.textContent = CSS; document.head.appendChild(s) }
    let last = -1, timer = 0;
    const scan = () => {
      let keys = []; try{ keys = cfg.keys() || [] }catch(e){}
      const all = load(), st = all[cfg.app] || (all[cfg.app] = {b:0, k:{}}); let ch = false;
      if(keys.length){
        if(!st.b){ if(keys.length === last){ for(const k of keys) st.k[k] = 0; st.b = 1; ch = true } last = keys.length }      // first use: wait until the list stopped growing, then everything is "old"
        else for(const k of keys) if(!(k in st.k)){ st.k[k] = Date.now(); ch = true }
      }
      if(ch) save(all); paint(st) };
    const paint = st => { const now = Date.now();
      document.querySelectorAll(cfg.sel).forEach(el => { const k = cfg.key(el), t = k != null && st.k[k]; el.classList.toggle('nvglow', !!(t > 0 && now - t < H24)) }) };
    const later = () => { clearTimeout(timer); timer = setTimeout(scan, 250) };
    new MutationObserver(later).observe(document.body, {childList:true, subtree:true});
    document.addEventListener('click', e => { const el = e.target.closest(cfg.sel); if(!el) return; const k = cfg.key(el), all = load(), st = all[cfg.app]; if(st && k != null && st.k[k] > 0){ st.k[k] = 0; save(all); el.classList.remove('nvglow') } }, true);
    setInterval(scan, 4000); setTimeout(scan, 1500) }
  window.NVNEW = {watch};
})();
