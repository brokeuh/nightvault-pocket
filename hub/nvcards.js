/* The Nightvault – CARD PICTURES on the phone (shared, like nvgroups.js / nvpc.js). Plan: plans/card-downloads.md (nightvault-src).
   The PC downloaders save whole sets of card pictures into a folder; this does the same on the phone (Android app only):
   the owner picks a folder once, then picks a game and sets, and the phone saves the pictures there, in the SAME layout as the PC:
       <game>/<set code> - <set name>/<number>_<card name>.jpg        (the other face of a double-faced card: ..._back.jpg)
   so a folder can be copied between the PC and the phone. A stopped download continues where it was (files already there are skipped).
   The saving itself is native: NvFiles.download (native/plugin/NvFilesPlugin.java) – it reads each address and writes it straight into the
   folder, no web-page limits (CORS) and nothing passed through the page.

   Any app page: <script src="../hub/nvcards.js"></script>, then NVCARDS.open() (a menu item "Card pictures"); NVCARDS.close() returns true if it closed
   the screen (for the Android back button). NVCARDS.folder() = {tree, name} of the picked folder or null.
   Games in this first slice: Magic (small/normal/large/png), Lorcana and the daily-file games (Gundam, Digimon, Flesh and Blood, Sorcery, Weiss Schwarz,
   Dragon Ball). One Piece, Star Wars: Unlimited (sub-folder per version), Riftbound and Star Wars CCG added; CCG Trader games follow – add them to SRC below.
   The set / card lists are cut-down copies of Pocket's (pocket/test_src.html SETSRC): if a source changes there, change it here too. */
(function(){
  'use strict';
  const NATIVE = !!(window.Capacitor && (typeof Capacitor.isNativePlatform === 'function' ? Capacitor.isNativePlatform() : typeof Capacitor.nativePromise === 'function'));
  let F = null; if(NATIVE) try{ F = Capacitor.registerPlugin('NvFiles') }catch(e){ F = null }
  const SITE = 'https://brokeuh.github.io/nightvault-pocket/', BASE = NATIVE ? SITE : '../';
  const enc = encodeURIComponent, sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const lsGet = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
  const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
  const L = (t, d) => { try{ window.NVLOG && NVLOG.log('cardpics', t, d) }catch(e){} };
  async function getJSON(url){ const r = await fetch(url, {headers:{Accept:'application/json'}}); if(!r.ok) throw Object.assign(new Error('HTTP ' + r.status), {status:r.status}); return r.json() }

  /* ---- file names, exactly like the PC (pc/vault_tcgdata.py _safe / enc_num) ---- */
  const safe = (t, n = 80) => { let s = String(t == null ? '' : t).replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').trim().replace(/\.+$/, ''); s = s.replace(/\s+/g, ' ').slice(0, n); return s || 'card' };
  const encNum = n => String(n).replace(/_/g, '~u').replace(/\//g, '~s').replace(/ /g, '~w').replace(/[<>:"/\\|?*\x00-\x1f]/g, '~');
  const normNum = n => { const m = /^0*(\d+)(.*)$/.exec(String(n ?? '').trim()); return m ? String(+m[1]) + m[2] : String(n ?? '').trim() };
  const slugOf = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  const pad2 = v => /^\d+$/.test(String(v)) ? String(v).padStart(2, '0') : String(v);

  /* ---- the games: SRC[game] = {label, sets():[{code,name,released,total}], cards(set, quality):[{num,name,url,back?}], per: average bytes of a picture, qualities?} ---- */
  const MTG_PER = {small:20e3, normal:90e3, large:200e3, png:700e3};
  const DG = {gundam:'Gundam', digimon:'Digimon', fab:'Flesh and Blood', sorcery:'Sorcery: Contested Realm', ws:'Weiss Schwarz', dbsfw:'Dragon Ball Super: Fusion World', dbsm:'Dragon Ball Super Card Game (Masters)', dbz:'Dragon Ball Z TCG'};
  const _dg = {};
  const dgData = g => _dg[g] || (_dg[g] = (async () => {
    for(const u of [`${BASE}data/${g}.json`, `https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/${g}.json`]) try{ const d = await getJSON(u); if(d && d.cards) return d }catch(e){}
    delete _dg[g]; throw new Error('The card list of this game is not available right now') })());
  const SRC = {
    mtg:{label:'Magic: The Gathering', qualities:['small', 'normal', 'large', 'png'], defQ:'normal', per:q => MTG_PER[q] || 90e3,
      sets:async () => (await getJSON('https://api.scryfall.com/sets')).data.filter(x => !x.digital && x.card_count > 0).map(x => ({code:x.code, name:x.name, released:x.released_at || '', total:x.card_count})),
      cards:async (st, q) => { let u = 'https://api.scryfall.com/cards/search?order=set&unique=prints&q=' + enc('set:' + st.code), out = [], pages = 0;
        while(u && pages++ < 40){ const j = await getJSON(u);
          for(const c of j.data){ const fr = c.image_uris || ((c.card_faces || [])[0] || {}).image_uris || {}, bk = c.image_uris ? null : (((c.card_faces || [])[1] || {}).image_uris || null);
            if(fr[q]) out.push({num:c.collector_number, name:c.name, url:fr[q], back:bk && bk[q] ? bk[q] : ''}) }
          u = j.has_more ? j.next_page : null; if(u) await sleep(110) }
        return out } },
    lorcana:{label:'Disney Lorcana', per:() => 250e3,
      sets:async () => (await getJSON('https://api.lorcast.com/v0/sets')).results.map(x => ({code:pad2(String(x.code).toLowerCase()), id:x.id, name:x.name, released:x.released_at || '', total:0})),
      cards:async st => (await getJSON('https://api.lorcast.com/v0/sets/' + st.id + '/cards')).map(c => { const iu = (c.image_uris || {}).digital || c.image_uris || {};
        return {num:c.collector_number, name:c.name + (c.version ? ' - ' + c.version : ''), url:iu.large || iu.normal || iu.small || ''} }).filter(c => c.url) }
  };
  for(const [g, label] of Object.entries(DG)) SRC[g] = {label, per:() => 120e3,
    sets:async () => { const d = await dgData(g), n = new Map(); for(const r of d.cards) n.set(r[0], (n.get(r[0]) || 0) + 1);
      return d.sets.map((x, i) => ({code:x.code, name:x.name || String(x.code).toUpperCase(), released:x.released || '', total:n.get(i) || 0, idx:i})) },
    cards:async st => { const d = await dgData(g), out = [];
      for(const r of d.cards){ if(r[0] !== st.idx) continue; const pid = r[4];
        const url = r[7] ? (d.imgBase ? d.imgBase.replace('{}', r[7]) : r[7]) : (pid ? `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_in_1000x1000.jpg` : '');
        if(url) out.push({num:r[1] ? normNum(r[1]) : slugOf(r[2]), name:r[2], url}) }
      return out } };


  /* ---- Star Wars: Unlimited: official list; every version of a card goes in its own sub-folder of the set (Normal, Hyperspace, Showcase ...).
     Foil and Hyperspace Foil are the same picture as Normal / Hyperspace, so they are not downloaded twice. ---- */
  const SWUO = 'https://admin.starwarsunlimited.com/api/', _at = x => (x && x.data && (x.data.attributes || x.data)) || {};
  const swuVar = a => ((((a.variantTypes || {}).data || [])[0] || {}).attributes || {}).name || 'Normal';
  const swuSub = v => /^(standard|normal)$/i.test(v) ? 'Normal' : v;
  const SWU_SETS = [['sor', 'Spark of Rebellion', '2024-03-08'], ['shd', 'Shadows of the Galaxy', '2024-07-12'], ['twi', 'Twilight of the Republic', '2024-11-08'], ['jtl', 'Jump to Lightspeed', '2025-03-14'], ['lof', 'Legends of the Force', '2025-07-11'], ['sec', 'Secrets of Power', '']];
  const swuDate = d => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(d); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : d };
  const swuName = (t, sub) => String(t || '') + (sub ? ' - ' + sub : '');
  SRC.swu = {label:'Star Wars: Unlimited (a folder per version)', per:() => 150e3,
    sets:async () => {
      try{ const j = await getJSON(SWUO + 'card-expansions?locale=en&pagination[pageSize]=100'); const l = (j.data || []).map(x => { const a = x.attributes || x; return {code:String(a.code || '').toLowerCase(), name:a.name, released:String(a.releaseDate || a.publishedAt || '').slice(0, 10), total:0} }).filter(x => x.code); if(l.length) return l }catch(e){ L('swu official sets', {err:e.message}) }
      try{ const j = await getJSON('https://api.swu-db.com/sets'); const l = (Array.isArray(j) ? j : j.data || []).map(x => ({code:String(x.setId || x.code || '').toLowerCase(), name:x.fullName || x.name, released:swuDate(x.releaseDate || x.released || ''), total:x.numberCards || 0})).filter(x => x.code); if(l.length) return l }catch(e){ L('swu-db sets', {err:e.message}) }
      return SWU_SETS.map(([code, name, released]) => ({code, name, released, total:0})) },
    cards:async st => {
      try{ const out = []; let page = 1;
        while(page < 14){ const j = await getJSON(`${SWUO}card-list?locale=en&pagination[pageSize]=250&pagination[page]=${page}&sort=cardNumber&filters[variantTypes][name][$notContainsi]=foil&filters[expansion][code][$eqi]=${enc(st.code)}`);
          for(const c of j.data || []){ const a = c.attributes || c, art = _at(a.artFront), url = ((art.formats || {}).card || {}).url || art.url || '', v = swuVar(a); if(!url) continue;
            out.push({num:normNum(String(a.cardNumber ?? '').padStart(3, '0')), name:swuName(a.title, a.subtitle), url, sub:swuSub(v)}) }
          if(page >= ((j.meta || {}).pagination || {}).pageCount || !(j.data || []).length) break; page++; await sleep(120) }
        if(out.length) return out }catch(e){ L('swu official cards', {err:e.message}) }
      const j = await getJSON('https://api.swu-db.com/cards/' + enc(st.code)), l = (j.data || j || []).filter(c => c.FrontArt && !/foil/i.test(c.VariantType || ''));
      return l.map(c => ({num:normNum(c.Number), name:swuName(c.Name, c.Subtitle), url:c.FrontArt, sub:swuSub(c.VariantType || 'Normal')})) } };

  /* ---- One Piece (optcgapi.com) and Star Wars CCG (Players Committee): one big list each, cut by set - same names as the PC ---- */
  const bigList = {};
  const once = (k, f) => bigList[k] || (bigList[k] = f().catch(e => { delete bigList[k]; throw e }));
  const opAll = () => once('op', async () => { const a = await Promise.all(['allSetCards', 'allSTCards'].map(p => getJSON(`https://optcgapi.com/api/${p}/`).catch(() => []))), l = a.flat(); if(!l.length) throw new Error('The One Piece card list did not answer'); return l });
  const opBase = n => String(n || '').replace(/\s*\((\d{3}|parallel|alternate art|sp|manga|[A-Z]{2,3}\d{2}-\d{3})\)/gi, '').trim();
  SRC.onepiece = {label:'One Piece Card Game', per:() => 120e3,
    sets:async () => { const m = new Map(); for(const c of await opAll()){ const s = String(c.card_set_id || '').split('-')[0]; if(!s) continue; const e = m.get(s) || {code:s.toLowerCase(), name:c.set_name || s, released:'', total:0}; e.total++; m.set(s, e) } return [...m.values()].sort((a, b) => b.code.localeCompare(a.code)) },
    cards:async st => (await opAll()).filter(c => String(c.card_set_id || '').split('-')[0].toLowerCase() === st.code && c.card_image).map(c => { const [, n] = String(c.card_set_id).split('-'), v = String(c.card_image_id || '').split('_')[1];
      return {num:normNum(n) + (v ? '-' + v : ''), name:opBase(c.card_name) + (/parallel/i.test(c.card_name) ? ' (Parallel)' : ''), url:c.card_image} }) };
  const swAll = () => once('swccg', async () => (await Promise.all(['Light', 'Dark'].map(x => getJSON(`https://raw.githubusercontent.com/swccgpc/swccg-card-json/main/${x}.json`).then(j => j.cards || [])))).flat());
  SRC.swccg = {label:'Star Wars CCG (Decipher)', per:() => 120e3,
    sets:async () => { const meta = await getJSON('https://raw.githubusercontent.com/swccgpc/swccg-card-json/main/sets.json').catch(() => []), mm = new Map((Array.isArray(meta) ? meta : []).map(x => [String(x.id).toLowerCase(), x])), seen = new Map();
      for(const c of await swAll()){ const k = String(c.set || '').toLowerCase(); if(!k || !(c.front || {}).imageUrl) continue; const e = seen.get(k) || {code:k, name:(mm.get(k) || {}).name || 'Set ' + k, released:/^0000/.test((mm.get(k) || {}).date_release || '') ? '' : String((mm.get(k) || {}).date_release || '').slice(0, 10), total:0}; e.total++; seen.set(k, e) }
      return [...seen.values()].sort((a, b) => (a.released || '9999').localeCompare(b.released || '9999')) },
    cards:async st => (await swAll()).filter(c => String(c.set || '').toLowerCase() === st.code && (c.front || {}).imageUrl).map(c => ({num:String(c.gempId || c.id), name:String(c.front.title || '').replace(/[•<>]/g, '').trim(), url:c.front.imageUrl})) };

  /* ---- Riftbound (riftcodex; pictures from riftbound.gg because Riot's server refuses other sites) ---- */
  SRC.riftbound = {label:'Riftbound', per:() => 150e3,
    sets:async () => { const j = await getJSON('https://api.riftcodex.com/sets?size=100'); return (j.items || j || []).map(x => ({code:String(x.set_id).toLowerCase(), name:x.name || x.label || x.set_id, released:x.published_on || x.publish_date || '', total:x.card_count || 0})) },
    cards:async st => { const out = []; let page = 1;
      while(page < 8){ const j = await getJSON(`https://api.riftcodex.com/cards?set_id=${enc(st.code)}&sort=collector_number&size=100&page=${page}`);
        for(const c of j.items || []){ const sid = String((c.set || {}).set_id || '').toUpperCase(), cn = String(c.collector_number ?? '');
          out.push({num:normNum(c.riftbound_id || `${sid}-${cn.padStart(3, '0')}`), name:c.name, url:`https://static.dotgg.gg/riftbound/cards/${sid}-${cn.padStart(3, '0')}.webp`, ext:'webp'}) }
        if(!j.pages || page >= j.pages) break; page++; await sleep(120) } return out } };

  /* ---- the folder ---- */
  const folder = () => lsGet('nvCards.folder', null);
  async function pickFolder(){ if(!F) throw new Error('This needs the Android app'); const r = await F.pickFolder(); lsSet('nvCards.folder', {tree:r.tree, name:r.name}); return r }

  /* ---- the files of one set: [{dir, name, url}] named like the PC ---- */
  function itemsOf(game, st, cards, quality){
    const ext0 = game === 'mtg' && quality === 'png' ? 'png' : 'jpg', base = `${game}/${safe(st.code, 20)} - ${safe(st.name, 60)}`, out = [];
    for(const c of cards){ const stem = `${encNum(c.num)}_${safe(c.name)}`, ext = c.ext || ext0, dir = c.sub ? `${base}/${safe(c.sub, 40)}` : base;   // c.sub: one folder per version (Star Wars: Unlimited)
      out.push({dir, name:`${stem}.${ext}`, url:c.url}); if(c.back) out.push({dir, name:`${stem}_back.${ext}`, url:c.back}) }
    return out;
  }

  /* ---- the download: one set after the other, resumable ---- */
  const RUN = {on:false, stop:false};
  async function download(game, sets, quality, onProgress){
    if(!F) throw new Error('This needs the Android app');
    const fo = folder(); if(!fo) throw new Error('Choose a folder first');
    const src = SRC[game], T = {got:0, skipped:0, missed:0, bytes:0, sets:0, refused:false, stopped:false}, say = onProgress || (() => {});
    RUN.on = true; RUN.stop = false;
    let h = null; try{ h = await F.addListener('dlProgress', e => say({kind:'files', set:RUN.cur, setN:RUN.n, setOf:sets.length, done:e.done, total:e.total, got:T.got + e.got, skipped:T.skipped + e.skipped, missed:T.missed + e.missed, bytes:T.bytes + e.bytes, at:e.at})) }catch(e){}
    try{ await F.keepAwake({on:true}) }catch(e){}
    try{
      for(let i = 0; i < sets.length; i++){
        if(RUN.stop) break; const st = sets[i]; RUN.cur = st; RUN.n = i + 1;
        say({kind:'list', set:st, setN:i + 1, setOf:sets.length, got:T.got, skipped:T.skipped, missed:T.missed, bytes:T.bytes});
        let cards; try{ cards = await src.cards(st, quality) }catch(e){ L('card list failed', {game, set:st.code, err:e.message}); T.missed++; say({kind:'warn', text:`${st.name}: the card list could not be loaded (${e.message})`}); continue }
        const items = itemsOf(game, st, cards, quality); if(!items.length) continue;
        const r = await F.download({tree:fo.tree, items, pauseMs:250});
        T.got += r.got; T.skipped += r.skipped; T.missed += r.missed; T.bytes += r.bytes; T.sets++;
        L('set done', {game, set:st.code, got:r.got, skipped:r.skipped, missed:r.missed});
        if(r.refused){ T.refused = true; break } if(r.stopped || RUN.stop){ T.stopped = true; break }
      }
    } finally { RUN.on = false; try{ h && h.remove() }catch(e){} try{ await F.keepAwake({on:false}) }catch(e){} }
    if(RUN.stop) T.stopped = true;
    return T;
  }
  const stop = () => { RUN.stop = true; try{ F && F.stopDownload() }catch(e){} };

  /* ---------------------------------------------------------------- the screen */
  const CSS = `#nvc{position:fixed;inset:0;z-index:2147481000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;font:15px/1.45 'DM Sans',system-ui,sans-serif;color:var(--text,#e9edf2)}
#nvc .sh{width:100%;max-width:560px;max-height:92vh;overflow:auto;background:var(--pan,#151a22);border:1px solid var(--line,#232b36);border-bottom:0;border-radius:22px 22px 0 0;padding:16px 16px calc(18px + env(safe-area-inset-bottom,0px))}
#nvc h3{margin:0 0 6px;font-size:18px}#nvc .mu{color:var(--dim,#9aa7b5);font-size:12.5px}
#nvc .rw{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
#nvc label.lb{display:block;font-size:12.5px;color:var(--dim,#9aa7b5);margin:10px 0 4px}
#nvc select,#nvc input[type=text]{width:100%;min-height:42px;border-radius:12px;border:1px solid var(--line,#232b36);background:var(--pan2,#10141b);color:inherit;padding:0 10px;font:inherit;font-size:14.5px}
#nvc button{height:42px;border-radius:12px;border:1px solid var(--line,#232b36);background:var(--pan2,#10141b);color:inherit;font:inherit;font-size:14px;padding:0 14px;cursor:pointer}
#nvc button.p{background:var(--accentd,#4651a8);border-color:var(--accentb,#6f7be0);color:#fff;font-weight:700}#nvc button.s{height:34px;font-size:13px;padding:0 11px}#nvc button:disabled{opacity:.5}
#nvc .ls{max-height:34vh;overflow:auto;border:1px solid var(--line,#232b36);border-radius:12px;background:var(--pan2,#10141b)}
#nvc .it{display:flex;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line,#232b36)}#nvc .it:last-child{border-bottom:0}
#nvc .it input{width:22px;height:22px;flex:none;accent-color:var(--accentd,#4651a8)}#nvc .it .nm{flex:1;min-width:0}#nvc .it .nm b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#nvc .pr{height:7px;border-radius:99px;background:var(--line,#232b36);overflow:hidden;margin:10px 0 6px}#nvc .pr i{display:block;height:100%;width:0;background:var(--accent,#a9b4ff);transition:width .25s}
#nvc .nt{font-size:12.5px;color:var(--dim,#9aa7b5);background:var(--pan2,#10141b);border:1px solid var(--line,#232b36);border-radius:12px;padding:9px 12px;margin:8px 0}
#nvc .bad{color:var(--red,#ef8a8f)}#nvc .ok{color:var(--green,#8fe0a0)}`;
  const fmtMB = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB';
  const gamesList = () => Object.keys(SRC).map(g => [g, SRC[g].label]);
  let UI = null;
  function open(){
    close(); if(!document.getElementById('nvccss')){ const s = document.createElement('style'); s.id = 'nvccss'; s.textContent = CSS; document.head.appendChild(s) }
    const el = document.createElement('div'); el.id = 'nvc';
    const st = {game:lsGet('nvCards.game', 'mtg'), q:lsGet('nvCards.q', 'normal'), sets:[], picked:new Set(), find:'', loading:false};
    if(!SRC[st.game]) st.game = 'mtg';
    el.innerHTML = `<div class="sh"><h3>Card pictures</h3>
      <div class="mu">Save card pictures on this phone, in the same folders as the PC downloaders use (<b>game / set / number_name.jpg</b>). A download you stop continues where it was.</div>
      ${NATIVE && F ? '' : '<div class="nt bad">This needs the Android app. The website cannot save thousands of pictures into a folder.</div>'}
      <div class="rw"><div style="flex:1;min-width:0"><div class="mu">Folder</div><b id="nvcf" style="word-break:break-all"></b></div><button id="nvcpick" class="s">Choose</button></div>
      <label class="lb" for="nvcg">Game</label><select id="nvcg">${gamesList().map(([g, l]) => `<option value="${g}">${esc(l)}</option>`).join('')}</select>
      <div id="nvcqrow"><label class="lb" for="nvcq">Picture quality</label><select id="nvcq"></select></div>
      <div class="rw"><input type="text" id="nvcfind" placeholder="Search sets" style="flex:1;min-width:120px" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><button id="nvcall" class="s">All shown</button><button id="nvcnone" class="s">None</button></div>
      <div class="ls" id="nvcl"><div class="it mu">Loading the sets ...</div></div>
      <div class="nt" id="nvcest"></div>
      <div class="pr"><i id="nvcbar"></i></div><div class="mu" id="nvcst" style="min-height:18px"></div>
      <div class="rw"><button id="nvcgo" class="p">Download</button><button id="nvcstop" disabled>Stop</button><span style="flex:1"></span><button id="nvcx">Close</button></div></div>`;
    el.onclick = e => { if(e.target === el && !RUN.on) close() };
    document.body.appendChild(el); UI = el; const $ = s => el.querySelector(s);
    const SRCG = () => SRC[st.game];
    const fo = () => { const f = folder(); $('#nvcf').textContent = f ? f.name : 'not chosen yet'; $('#nvcf').className = f ? '' : 'bad' };
    const quals = () => { const g = SRCG(); $('#nvcqrow').hidden = !g.qualities; if(g.qualities){ if(!g.qualities.includes(st.q)) st.q = g.defQ; $('#nvcq').innerHTML = g.qualities.map(q => `<option value="${q}" ${q === st.q ? 'selected' : ''}>${q}${q === g.defQ ? ' (recommended)' : ''}</option>`).join('') } };
    const shown = () => { const f = st.find.trim().toLowerCase(); return f ? st.sets.filter(s => (s.name + ' ' + s.code).toLowerCase().includes(f)) : st.sets };
    const estimate = () => { const g = SRCG(), picked = st.sets.filter(s => st.picked.has(s.code)), known = picked.reduce((a, s) => a + s.total, 0), unk = picked.filter(s => !s.total).length;
      $('#nvcest').innerHTML = picked.length ? `${picked.length} set${picked.length === 1 ? '' : 's'} · ${known ? 'about <b>' + fmtMB(known * g.per(st.q)) + '</b> for ' + known.toLocaleString() + ' pictures' : 'size shown while it runs'}${unk && known ? ` (+ ${unk} set${unk === 1 ? '' : 's'} of unknown size)` : ''}. Pictures already in the folder are skipped.` : 'Tick the sets you want.';
      $('#nvcgo').disabled = RUN.on || !picked.length || !NATIVE || !F };
    const draw = () => { const l = shown();
      $('#nvcl').innerHTML = st.loading ? '<div class="it mu">Loading the sets ...</div>' : l.length ? l.map(s => `<label class="it"><input type="checkbox" data-c="${esc(s.code)}" ${st.picked.has(s.code) ? 'checked' : ''}><span class="nm"><b>${esc(s.name)}</b><span class="mu">${esc(String(s.code).toUpperCase())}${s.released ? ' · ' + esc(s.released.slice(0, 4)) : ''}${s.total ? ' · ' + s.total + ' cards' : ''}</span></span></label>`).join('') : '<div class="it mu">No sets found.</div>';
      el.querySelectorAll('#nvcl [data-c]').forEach(c => c.onchange = () => { c.checked ? st.picked.add(c.dataset.c) : st.picked.delete(c.dataset.c); estimate() }); estimate() };
    const load = async () => { st.loading = true; st.sets = []; st.picked.clear(); draw(); $('#nvcst').textContent = '';
      try{ const l = await SRCG().sets(); st.sets = l.sort((a, b) => String(b.released).localeCompare(String(a.released)) || a.name.localeCompare(b.name)) }catch(e){ $('#nvcst').innerHTML = `<span class="bad">Could not load the sets: ${esc(e.message)}</span>`; L('sets failed', {game:st.game, err:e.message}) }
      st.loading = false; draw() };
    $('#nvcg').value = st.game; fo(); quals(); load();
    $('#nvcg').onchange = e => { st.game = e.target.value; lsSet('nvCards.game', st.game); quals(); load() };
    $('#nvcq').onchange = e => { st.q = e.target.value; lsSet('nvCards.q', st.q); estimate() };
    $('#nvcfind').oninput = e => { st.find = e.target.value; draw() };
    $('#nvcall').onclick = () => { shown().forEach(s => st.picked.add(s.code)); draw() }; $('#nvcnone').onclick = () => { st.picked.clear(); draw() };
    $('#nvcpick').onclick = async () => { try{ await pickFolder(); fo() }catch(e){ if(e && e.code !== 'cancel') $('#nvcst').innerHTML = `<span class="bad">${esc(e.message || e)}</span>` } };
    $('#nvcx').onclick = close; $('#nvcstop').onclick = () => { stop(); $('#nvcst').textContent = 'Stopping ...' };
    $('#nvcgo').onclick = async () => {
      if(!folder()){ $('#nvcst').innerHTML = '<span class="bad">Choose a folder first.</span>'; return }
      const sets = st.sets.filter(s => st.picked.has(s.code)); if(!sets.length) return;
      $('#nvcgo').disabled = true; $('#nvcstop').disabled = false; $('#nvcpick').disabled = $('#nvcg').disabled = $('#nvcq').disabled = true; $('#nvcbar').style.width = '0';
      const warns = [];
      try{
        const T = await download(st.game, sets, st.q, p => {
          if(p.kind === 'warn'){ warns.push(p.text); return }
          const pct = p.kind === 'files' && p.total ? p.done / p.total : 0; $('#nvcbar').style.width = Math.round(((p.setN - 1) + pct) / p.setOf * 100) + '%';
          $('#nvcst').innerHTML = `${esc(p.set.name)} (${p.setN}/${p.setOf})${p.kind === 'files' ? ` · ${p.done} / ${p.total}` : ' · reading the card list ...'}<br>${p.got.toLocaleString()} saved · ${p.skipped.toLocaleString()} already there${p.missed ? ` · ${p.missed} without a picture` : ''} · ${fmtMB(p.bytes)}` });
        $('#nvcbar').style.width = T.stopped || T.refused ? $('#nvcbar').style.width : '100%';
        $('#nvcst').innerHTML = `<span class="${T.refused ? 'bad' : 'ok'}">${T.refused ? 'The picture site keeps refusing - stopped. Start again later: it continues where it was.' : T.stopped ? 'Stopped - start again to continue where it was.' : 'Done.'}</span><br>${T.got.toLocaleString()} saved · ${T.skipped.toLocaleString()} already there${T.missed ? ` · ${T.missed} without a picture` : ''} · ${fmtMB(T.bytes)}${warns.length ? '<br><span class="bad">' + warns.map(esc).join('<br>') + '</span>' : ''}`;
      }catch(e){ const msg = e && e.code === 'permission' ? 'The app may no longer write in this folder - choose it again.' : (e.message || String(e)); $('#nvcst').innerHTML = `<span class="bad">${esc(msg)}</span>`; L('download failed', {err:msg}) }
      $('#nvcstop').disabled = true; $('#nvcpick').disabled = $('#nvcg').disabled = $('#nvcq').disabled = false; estimate();
    };
  }
  function close(){ if(!UI) return false; if(RUN.on){ stop() } UI.remove(); UI = null; return true }
  window.NVCARDS = {open, close, folder, pickFolder, download, stop, SRC, itemsOf, safe, encNum, supported:() => !!(NATIVE && F)};
})();
