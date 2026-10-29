/* Nightvault themes – shared by every app (23 October 2026). Plan: plans/ui.md ("Theme").
   ONE saved choice (localStorage `nvTheme`) that every app can follow. An app only needs two lines:
     <script src="../hub/nvtheme.js"></script>   <script>NVTHEME.apply('<app id>')</script>
   apply() sets these colour variables on <html> (the names the apps already use, so their own CSS does not change):
     --bg --pan --pan2 --line --line2 --text --dim --dim2   backgrounds, cards, borders, text
     --accent (fills, buttons)  --accentt (the accent as text / link, always readable)  --onaccent (text on an accent fill)
     --g --b --o   the three STATUS colours (green = new, blue = update, orange = needs attention) – they never follow the theme accent,
                   only get darker versions on light themes so they stay readable
     --accentd (accent for fills with white text) --accentb --accentbg (accent tint) --blue --green --amber --red --dk (how much darker icons get on light themes) --scrim
   Saved choice = {scope:'all'|'each', keep:true|false, all:{id}, apps:{<app>:{id}}, lastDark, lastLight}; id = a preset id or 'custom'
   (custom carries c:{bg, card, text, accent}). scope 'all' = one theme for every app; 'each' = every app can have its own (apps without
   their own use the 'all' one). keep = "apps keep their own colour": the accent of an app on the shared theme stays that app's own colour.
   Presets: 8 dark + 2 light. The rest of a theme (borders, secondary text …) is DERIVED from bg, card, text and accent, and checked for contrast. */
(function(){
  'use strict';
  const KEY = 'nvTheme';
  const hx = h => { h = String(h || '').replace('#', ''); if(h.length === 3) h = h.replace(/./g, c => c + c); if(!/^[0-9a-f]{6}$/i.test(h)) return null; const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] };
  const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)) };     // t = 0 → a, t = 1 → b
  const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4) };
  const lum = h => { const [r, g, b] = hx(h); return .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b) };
  const contrast = (a, b) => { const x = lum(a), y = lum(b), hi = Math.max(x, y), lo = Math.min(x, y); return (hi + .05) / (lo + .05) };
  /* a colour that reads on `bg`: pulled toward black or white (the direction that helps) until the contrast is enough */
  const readable = (c, bg, min) => { min = min || 4.5; if(contrast(c, bg) >= min) return c; const to = lum(bg) > .4 ? '#000000' : '#ffffff';
    for(let t = .05; t <= 1.001; t += .05){ const m = mix(c, to, t); if(contrast(m, bg) >= min) return m } return to };

  const PRESETS = [
    {id:'midnight', name:'Midnight', bg:'#0b0e13', card:'#151a22', text:'#e9edf2', accent:'#6ea8ff'},
    {id:'graphite', name:'Graphite', bg:'#000000', card:'#0d0d0d', text:'#ececec', accent:'#e8e8e8'},
    {id:'forest', name:'Forest', bg:'#0e1411', card:'#131b17', text:'#e5eee8', accent:'#5fcf9a'},
    {id:'ember', name:'Ember', bg:'#15110e', card:'#1b1612', text:'#f0e8e0', accent:'#f0944a'},
    {id:'violet', name:'Violet', bg:'#110f17', card:'#161421', text:'#ece9f6', accent:'#a98bff'},
    {id:'ocean', name:'Ocean', bg:'#0b1318', card:'#101a21', text:'#e3eef2', accent:'#4cc9d9'},
    {id:'gold', name:'Gold', bg:'#000000', card:'#0e0d0a', text:'#f3ecd9', accent:'#e2b64a', isNew:true},
    {id:'rose', name:'Rose', bg:'#160f13', card:'#1d1419', text:'#f4e8ed', accent:'#f08cab', isNew:true},
    {id:'light', name:'Light', bg:'#f4f5f8', card:'#ffffff', text:'#1b1f2a', accent:'#2f6fe0'},
    {id:'sand', name:'Sand', bg:'#f3ecdf', card:'#fbf7ee', text:'#2b2418', accent:'#9a5418', isNew:true}
  ];
  const isLight = c => lum(c.bg) > lum(c.text);
  PRESETS.forEach(p => { p.light = isLight(p) });
  /* each app's own colour (the tile colour in The Nightvault) */
  const APPCOL = {hub:'#5fe0b0', scanner:'#6fa8ff', binder:'#5fe0b0', convert:'#6fd3ea', calendar:'#ffd166', control:'#c4cdd8', go:'#f1dc6b', bookcase:'#f4b25f', music:'#c58bff', audiobooks:'#7fb2ff', cinema:'#ff8f9a', boardgames:'#9be071', print3d:'#6fd3ea', collectables:'#f1dc6b', games:'#9a9cff'};
  const STATUS = {dark:{g:'#4ee0a0', b:'#6aa8ff', o:'#ffa94d', amber:'#f1dc6b', red:'#ef8a8f'}, light:{g:'#0f7a50', b:'#2459c9', o:'#a85500', amber:'#7a5d00', red:'#b3261e'}};

  /* ---------- the saved choice ---------- */
  const DEF = () => ({v:1, scope:'all', keep:true, all:{id:'midnight'}, apps:{}, lastDark:'midnight', lastLight:'light'});
  function load(){ try{ const s = JSON.parse(localStorage.getItem(KEY) || 'null'), d = DEF(); if(!s || typeof s !== 'object') return d;
    return Object.assign(d, s, {all:s.all && s.all.id ? s.all : d.all, apps:s.apps && typeof s.apps === 'object' ? s.apps : {}}) }catch(e){ return DEF() } }
  const save = s => { try{ localStorage.setItem(KEY, JSON.stringify(s)) }catch(e){} return s };
  const preset = id => PRESETS.find(p => p.id === id);
  const baseOf = T => { if(T && T.id === 'custom' && T.c && ['bg', 'card', 'text', 'accent'].every(k => hx(T.c[k]))) return Object.assign({id:'custom', name:'Your own colours'}, T.c); return preset(T && T.id) || PRESETS[0] };
  const own = (s, app) => !(s.scope === 'each' && s.apps[app]);                // does this app use the shared ('all') theme?
  const pick = (s, app) => own(s, app) ? s.all : s.apps[app];

  /* ---------- from 4 colours to every variable ---------- */
  function tokens(c, accent){
    const light = isLight(c), S = STATUS[light ? 'light' : 'dark'];
    /* on a light theme the accent is also used as TEXT/LINK colour by the apps, so it is pulled darker until it reads on the cards */
    const acc = light ? readable(readable(accent || c.accent, c.card), c.bg) : (accent || c.accent);
    let t = .46, dim = c.text; for(; t >= 0; t -= .03){ const m = mix(c.text, c.bg, t); if(contrast(m, c.card) >= 4.6 && contrast(m, c.bg) >= 4.6){ dim = m; break } }
    let dim2 = mix(c.text, c.bg, Math.min(.6, t + .12)); if(contrast(dim2, c.card) < 4.5 || contrast(dim2, c.bg) < 4.5) dim2 = dim;
    let ad = acc; for(let k = 0; k <= 1.001 && contrast('#ffffff', ad) < 4.5; k += .04) ad = mix(acc, '#000000', k);        // accent for fills with WHITE text
    const v = {'--bg':c.bg, '--pan':c.card, '--pan2':mix(c.bg, c.card, .5), '--line':mix(c.card, c.text, .14), '--line2':mix(c.card, c.text, .26), '--text':c.text, '--dim':dim, '--dim2':dim2,
      '--accent':acc, '--accentt':readable(readable(acc, c.card), c.bg), '--accentd':ad, '--accentb':mix(acc, '#000000', light ? .1 : .2), '--accentbg':mix(c.card, acc, light ? .14 : .2),
      '--onaccent':contrast('#0b0e13', acc) >= contrast('#ffffff', acc) ? '#0b0e13' : '#ffffff',
      '--g':readable(S.g, c.card), '--b':readable(S.b, c.card), '--o':readable(S.o, c.card), '--amber':readable(S.amber, c.card), '--red':readable(S.red, c.card),
      '--blue':readable(S.b, c.card), '--green':readable(S.g, c.card),
      '--dk':'0%', '--scrim':light ? 'rgba(20,26,34,.28)' : 'rgba(0,0,0,.55)'};
    return {vars:v, light};
  }
  function resolve(app, s){ s = s || load(); app = app || 'hub'; const T = pick(s, app), b = baseOf(T);
    const accent = s.keep && own(s, app) && APPCOL[app] ? APPCOL[app] : b.accent, r = tokens(b, accent);
    return {id:b.id, name:b.name, light:r.light, vars:r.vars, base:b, own:own(s, app)} }
  let APP = null;
  function apply(app){ APP = app || APP || window.NV_APP || 'hub'; const r = resolve(APP), el = document.documentElement;
    for(const k in r.vars) el.style.setProperty(k, r.vars[k]);
    el.style.colorScheme = r.light ? 'light' : 'dark'; el.setAttribute('data-nv-theme', r.id); el.setAttribute('data-nv-light', r.light ? '1' : '0');
    const m = document.querySelector('meta[name=theme-color]'); if(m) m.setAttribute('content', r.vars['--bg']);
    return r }
  window.addEventListener('storage', e => { if(e.key === KEY && APP) apply(APP) });     // another tab / app changed it

  /* ---------- changing it (target = 'all' or an app id) ---------- */
  function setPreset(target, id){ const s = load(), p = preset(id); if(!p) return s; const T = {id};
    if(target === 'all') s.all = T; else s.apps[target] = T;
    if(p.light) s.lastLight = id; else s.lastDark = id; return save(s) }
  function setCustom(target, c){ const s = load(), T = {id:'custom', c:{bg:c.bg, card:c.card, text:c.text, accent:c.accent}};
    if(target === 'all') s.all = T; else s.apps[target] = T; s.lastCustom = T.c; return save(s) }
  function setMode(target, light){ const s = load(); return setPreset(target, light ? s.lastLight : s.lastDark) }
  function setScope(scope){ const s = load(); s.scope = scope === 'each' ? 'each' : 'all'; return save(s) }
  function setKeep(on){ const s = load(); s.keep = !!on; return save(s) }
  function clearApp(app){ const s = load(); delete s.apps[app]; return save(s) }
  /* readability of own colours */
  function check(c){ const r = {text:contrast(c.text, c.bg), textCard:contrast(c.text, c.card), accent:contrast(c.accent, c.bg)};
    r.ok = r.text >= 4.5 && r.textCard >= 4.5 && r.accent >= 3; r.warn = [];
    if(r.text < 4.5 || r.textCard < 4.5) r.warn.push('The text is hard to read on the background or cards.');
    if(r.accent < 3) r.warn.push('The accent is almost invisible on the background (buttons and links).');
    return r }
  const fix = c => ({bg:c.bg, card:c.card, text:readable(c.text, mix(c.bg, c.card, .5), 7), accent:readable(c.accent, c.bg, 3)});

  const NAMES = {hub:'The Nightvault', scanner:'Scanner', binder:'Binder', convert:'Convert', calendar:'Calendar', control:'Control', go:'GO', bookcase:'Bookcase', music:'Music', audiobooks:'Audiobooks', cinema:'Cinema', boardgames:'Boardgames', print3d:'3D Print', collectables:'Collectables', games:'Games'};
  window.NVTHEME = {names:NAMES, presets:PRESETS, dark:PRESETS.filter(p => !p.light), lightOnes:PRESETS.filter(p => p.light), appColor:id => APPCOL[id] || '#6fa8ff',
    state:load, save, resolve, apply, setPreset, setCustom, setMode, setScope, setKeep, clearApp, check, fix, contrast, readable, mix, lum, isLight, hex:hx, preset,
    name:app => resolve(app).name};
})();
