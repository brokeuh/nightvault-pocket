/* The Nightvault – the ☰ menu of every app (23 Oct 2026; plan: plans/ui.md "Step 2"). Shared, like nvgroups.js: fix it here and every app gets it.
   An app only adds one call after its page has loaded:
     NVMENU.make({app:'bookcase', btn:'#setbtn', hub:'../hub/index.html', backup:'bookcase',
                  items:() => [ {label:'Check for new volumes now', run:() => …, dot:'g', hint:'3 new'} , '-' , … ]})
   - `btn`: the app's own ⚙ Settings button. It stays in the page (hidden) and keeps working: the menu's "Settings" item just clicks it.
   - `items()`: what is specific to this app (called every time the menu opens). Entry: {label, run, dot:'g'|'b'|'o', hint, show:()=>bool, href}; '-' = a line.
   - `mount`:'#id' instead of `btn` for a page with no ⚙ button: the ☰ is put inside that element; `cls` = the button's class.
   - `hide`: more selectors to hide (old header icons that moved into the menu, like the old "‹ The Nightvault" link).
   - `click:'#xyz'` on an item = click that existing button (the old header icon) – so the app's own code does not change.
   Always in the menu: "The Nightvault" (only when opened from the hub) on top; at the bottom Settings, How to use & set up (nvsetup.js), Back up this app now (nvbackup.js).
   The theme is NOT here – it is chosen in the hub only; apps just follow it (nvtheme.js). NVMENU.close() returns true if it closed an open menu (for Android's back button). */
(function(){
  'use strict';
  const CSS = `
#nvmenu{position:fixed;inset:0;z-index:2147482000}
#nvmenu .scrim{position:absolute;inset:0;background:var(--scrim,rgba(0,0,0,.55))}
#nvmenu .box{position:absolute;width:min(300px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:6px;border-radius:18px;background:var(--pan,#151a22);border:1px solid var(--line,#232b36);box-shadow:0 18px 40px rgba(0,0,0,.35);color:var(--text,#e9edf2);font:14.5px/1.35 'DM Sans',system-ui,sans-serif}
#nvmenu .mi{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:44px;padding:0 12px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;text-decoration:none}
#nvmenu .mi:hover,#nvmenu .mi:active{background:var(--pan2,#10141b)}
#nvmenu .lb{display:flex;align-items:center;gap:9px}
#nvmenu .h{font-size:12px;color:var(--dim2,#8fa0b2);text-align:right}
#nvmenu .hr{height:1px;background:var(--line,#232b36);margin:4px 8px}
#nvmenu .pip{flex:none;width:9px;height:9px;border-radius:50%;background:var(--dc);box-shadow:0 0 0 2px color-mix(in srgb,var(--dc) 25%,transparent),0 0 6px var(--dc)}
#nvmenu .pip.g{--dc:var(--g,#4ee0a0)}#nvmenu .pip.b{--dc:var(--b,#6aa8ff)}#nvmenu .pip.o{--dc:var(--o,#ffa94d)}
#nvmtoast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--pan,#151a22);color:var(--text,#e9edf2);border:1px solid var(--line2,#33404f);padding:10px 14px;border-radius:12px;font:14px 'DM Sans',system-ui,sans-serif;z-index:2147483001;max-width:90vw}
[id^=nvhelp_]{display:none!important}`;
  const MENU_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>';
  const fromHub = () => { try{ if(new URLSearchParams(location.search).get('nv') === 'hub') sessionStorage.setItem('nvHub', '1'); return sessionStorage.getItem('nvHub') === '1' }catch(e){ return false } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  const ago = t => { const d = Math.round((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago' };
  let ST = null, CFG = null, BTN = null, EL = null, ITEMS = [];
  const toast = t => { let el = document.getElementById('nvmtoast'); if(!el){ el = document.createElement('div'); el.id = 'nvmtoast'; document.body.appendChild(el) } el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true }, 3200) };
  const close = () => { if(!EL) return false; EL.remove(); EL = null; return true };
  function build(){
    const c = CFG, list = [];
    if(fromHub() && c.hub) list.push({label:'The Nightvault', href:c.hub});
    if(list.length) list.push('-');
    const mid = (c.items ? c.items() : []).filter(x => x === '-' || !x.show || x.show()).map(x => x !== '-' && x.click ? Object.assign({run:() => { const b = document.querySelector(x.click); if(b) b.click() }}, x) : x);
    list.push(...mid); if(mid.length) list.push('-');
    const orig = c.btn && document.querySelector(c.btn);
    if(orig) list.push({label:'Settings', run:() => orig.click()});
    if(window.NVSETUP && NVSETUP.here && NVSETUP.apps[NVSETUP.here()]) list.push({label:'How to use & set up', run:() => NVSETUP.open(NVSETUP.here(), false)});
    if(c.backup && window.NVBACKUP && NVBACKUP.apps && NVBACKUP.apps[c.backup]){ const L = NVBACKUP.last(c.backup), old = L && Date.now() - L.at > 10 * 864e5;
      list.push({label:'Back up this app now', dot:old ? 'o' : '', hint:L ? 'last ' + ago(L.at) : 'none yet', run:async () => { try{ if(await NVBACKUP.count(c.backup)){ await NVBACKUP.save(c.backup, 'by hand'); toast('Backed up') } else toast('Nothing to back up yet') }catch(e){ toast(e.message || 'Backup failed') } }}) }
    return list }
  function open(){
    close(); ITEMS = build();
    EL = document.createElement('div'); EL.id = 'nvmenu';
    EL.innerHTML = `<div class="scrim"></div><div class="box" role="menu">${ITEMS.map((x, i) => x === '-' ? '<div class="hr"></div>' : (x.href ? `<a class="mi" href="${esc(x.href)}"` : `<button class="mi"`) + ` data-i="${i}" role="menuitem"><span class="lb">${x.dot ? `<i class="pip ${x.dot}"></i>` : ''}${esc(x.label)}</span>${x.hint ? `<span class="h">${esc(x.hint)}</span>` : ''}${x.href ? '</a>' : '</button>'}`).join('')}</div>`;
    document.body.appendChild(EL);
    const r = BTN.getBoundingClientRect(), box = EL.querySelector('.box');
    const vw = document.documentElement.clientWidth || innerWidth, w = box.offsetWidth;
    box.style.top = Math.max(8, r.bottom + 8) + 'px'; box.style.left = Math.max(8, Math.min(r.right - w, vw - w - 8)) + 'px';      // lined up with the ☰, but always fully on screen
    EL.querySelector('.scrim').onclick = close;
    EL.onclick = e => { const m = e.target.closest('.mi'); if(!m) return; const x = ITEMS[+m.dataset.i]; close(); if(x && x.run) setTimeout(() => x.run(), 0) } }
  function make(cfg){
    CFG = cfg; if(!ST){ ST = document.createElement('style'); document.head.appendChild(ST) }
    ST.textContent = CSS + ['#hubback'].concat(cfg.hide || []).map(s => s + '{display:none!important}').join('\n');
    const host = cfg.mount && document.querySelector(cfg.mount), orig = host ? null : document.querySelector(cfg.btn);
    if(!host && !orig){ console.warn('NVMENU: button not found', cfg.btn || cfg.mount); return }
    BTN = document.createElement('button'); BTN.className = cfg.cls || (orig && orig.className) || 'ib'; BTN.id = 'nvmenubtn'; BTN.type = 'button'; BTN.setAttribute('aria-label', 'Menu'); BTN.setAttribute('aria-haspopup', 'true'); BTN.innerHTML = MENU_SVG;
    BTN.onclick = () => EL ? close() : open();
    if(host) host.appendChild(BTN); else { orig.parentNode.insertBefore(BTN, orig); orig.style.display = 'none' }
    document.addEventListener('keydown', e => { if(e.key === 'Escape') close() }) }
  window.NVMENU = {make, close, open, toast, get isOpen(){ return !!EL }};
})();
