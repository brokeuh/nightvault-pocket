/* The Nightvault – splash screen of every app (23 Oct 2026; plan: plans/ui.md "Splash screen").
   "Nightvault" + the name of the app that opens, its icon in that app's colour from the chosen theme (nvtheme.js), ~1.2 s, tap to skip.
   One switch for all apps: localStorage `nvSplash` = false turns it off (hub: ☰ > All themes & colours > "Show the logo when an app opens").
   Use, as the FIRST thing in <body> (after nvtheme.js has run in <head>):
     <script src="../hub/nvsplash.js" data-app="bookcase"></script>        (apps with modes set  window.NV_APP  first, like Audio does)
   Scanner and Binder (Pocket) keep their own animated mark but use the same switch and the same words (they read NVSPLASH.on / NVSPLASH.name). */
(function(){
  'use strict';
  const NAMES = {scanner:'Scanner', binder:'Binder', convert:'Convert', control:'Control', go:'GO', bookcase:'Bookcase', music:'Music', audiobooks:'Audiobooks', cinema:'Cinema', boardgames:'Boardgames', print3d:'3D Print', collectables:'Collectables', games:'Games'};
  const isOn = () => { try{ return JSON.parse(localStorage.getItem('nvSplash')) !== false }catch(e){ return true } };
  const app = (document.currentScript && document.currentScript.dataset.app) || window.NV_APP || '';
  window.NVSPLASH = {names:NAMES, get on(){ return isOn() }, set(v){ try{ localStorage.setItem('nvSplash', JSON.stringify(!!v)) }catch(e){} }, name:id => NAMES[id || app] || ''};
  if(!app || !NAMES[app] || !isOn() || /[?&]nvresume=1\b/.test(location.search)) return;
  const ICON = {
    scanner:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"></path><rect x="8" y="7" width="8" height="10" rx="1"></rect></svg>`,
    binder:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="11" height="15" rx="2"></rect><path d="M9 21h9a2 2 0 0 0 2-2V8"></path></svg>`,
    convert:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="10" height="13" rx="1.5"></rect><path d="M16 9h4v11H9v-3"></path><path d="M13 13l3 3"></path></svg>`,
    go:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M4 12h5M15 12h5"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    bookcase:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 20h18"></path><rect x="4" y="5" width="4" height="15" rx="1"></rect><rect x="9" y="8" width="4" height="12" rx="1"></rect><path d="M15.2 9.2l3.6-1 2.9 11-3.6 1z"></path></svg>`,
    music:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"></path><circle cx="6.5" cy="18" r="2.5"></circle><circle cx="17.5" cy="16" r="2.5"></circle></svg>`,
    audiobooks:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"></path><rect x="3" y="14" width="4" height="6" rx="1.5"></rect><rect x="17" y="14" width="4" height="6" rx="1.5"></rect><path d="M12 9v8M9.5 10.5c1 0 1.9.3 2.5.8.6-.5 1.5-.8 2.5-.8"></path></svg>`,
    cinema:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4"></path></svg>`,
    boardgames:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2.5"></rect><circle cx="9" cy="9" r="1.2"></circle><circle cx="15" cy="15" r="1.2"></circle><circle cx="15" cy="9" r="1.2"></circle><circle cx="9" cy="15" r="1.2"></circle></svg>`,
    print3d:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"></path><path d="M4 7.5l8 4.5 8-4.5M12 12v9"></path></svg>`,
    collectables:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.8z"></path></svg>`,
    games:c => `<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9h10a4 4 0 0 1 3.9 4.9l-.6 2.6a2 2 0 0 1-3.4.9L15 15H9l-1.9 2.4a2 2 0 0 1-3.4-.9l-.6-2.6A4 4 0 0 1 7 9z"></path><path d="M8 11.5v2M7 12.5h2"></path><circle cx="15.5" cy="12" r=".8"></circle><circle cx="17" cy="13.5" r=".8"></circle></svg>`,
    control:c =>`<svg width="${c}" height="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"></path><circle cx="9" cy="6" r="2"></circle><circle cx="15" cy="12" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>`};
  const col = (() => { try{ return NVTHEME.resolve(app).vars['--accent'] }catch(e){ return '#6fa8ff' } })();
  const css = `#nvsplash{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 20px;background:var(--bg,#0b0e13);color:var(--text,#e9edf2);transition:opacity .4s,visibility .4s}
#nvsplash.out{opacity:0;visibility:hidden;pointer-events:none}
#nvsplash .t{width:104px;height:104px;border-radius:30px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--c) 20%,var(--pan,#151a22));color:var(--c);box-shadow:0 0 0 1px color-mix(in srgb,var(--c) 30%,transparent),0 12px 40px color-mix(in srgb,var(--c) 22%,transparent);animation:nvspIn .55s cubic-bezier(.2,.8,.2,1) both}
#nvsplash .t svg{width:58px;height:58px}
#nvsplash small{font:700 12px/1 'DM Sans',system-ui,sans-serif;letter-spacing:.32em;color:var(--dim2,#8fa0b2);margin-bottom:-4px;animation:nvspUp .5s .15s both}
#nvsplash b{font:700 clamp(26px,9vw,40px)/1.15 Unbounded,'DM Sans',system-ui,sans-serif;color:var(--accentt,var(--c));white-space:nowrap;animation:nvspUp .5s .22s both}
@keyframes nvspIn{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:none}}@keyframes nvspUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#nvsplash *{animation:none!important}}`;
  const mount = () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const el = document.createElement('div'); el.id = 'nvsplash'; el.setAttribute('aria-hidden', 'true'); el.style.setProperty('--c', col);
    el.innerHTML = `<div class="t">${(ICON[app] || ICON.control)(58)}</div><small>NIGHTVAULT</small><b>${NAMES[app].replace(/</g, '&lt;')}</b>`;
    document.body.insertBefore(el, document.body.firstChild);
    const w = el.querySelector('b'), fit = () => { w.style.transform = ''; const room = innerWidth - 40, need = w.scrollWidth; if(need > room) w.style.transform = `scale(${room / need})` }; fit(); document.fonts && document.fonts.ready.then(fit);
    const go = () => { if(!el.isConnected || el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => { el.remove(); st.remove() }, 450) };
    el.onclick = go; setTimeout(go, matchMedia('(prefers-reduced-motion: reduce)').matches ? 450 : 1250) };
  if(document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
