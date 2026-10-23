/* The Nightvault – first-time SET-UP and HOW TO USE for every app (shared, like nvgroups.js / nvbackup.js). Owner, 23 Oct 2026:
   "a setup prompt for every app when opening it for the first time, for setting up API keys with links where to get them, and how to use
   every app" + "when we make future updates with new features, or new API / site set-ups / logins, add them automatically".

   Every app page loads <script src="../hub/nvsetup.js"></script> (in <head>, after nvbackup.js). The page's app comes from its address.
   - First time an app opens: a short tour (what it does, how to use it) and the set-up steps (keys, logins, the PC), each with a link to
     where you get it and plain step-by-step words. Everything can be skipped and done later.
   - Every STEP HAS AN ID. What you have seen is kept per app (localStorage nvSetup = {app: {seen:[ids], at}}). When an update adds a step,
     the app shows ONLY the new steps the next time it opens ("New in Cinema"). So:
     ► A FUTURE CHAT that adds a feature worth explaining, or a new key / login / site set-up, ADDS A STEP HERE (new unique id, `added` date)
       – never change an old id (that would show it again to everyone). Key steps say where the app keeps the value (ls / field).
   - A "?" button next to the app's ⚙ opens it all again (tour + set-up), also NVSETUP.open(app).
   Steps: {id, added, icon, title, body}                         – a tour page
          {id, added, icon, title, body, how:[…], link:{url, text}, keys:[{ls, field?, json?, label, ph, pattern?, secret?}], test?, android?}
                                                                 – a set-up page (inputs saved straight into the app's own storage)
          {id, added, icon, title, body, go:{url, text}}         – a page with a button to another place (e.g. The Nightvault › My PC) */
(function(){
  const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const get = (k, d) => { try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) }catch(e){ return d } };
  const set = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) }catch(e){} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const log = (t, d) => { try{ window.NVLOG && NVLOG.log('setup', t, d) }catch(e){} };
  const MYPC = {id:'mypc', added:'2026-10-23', icon:'🖥️', title:'Your PC (optional)', body:'With the Nightvault PC app on your computer, this app also shows what is on the PC, over your home Wi‑Fi. Connect once in The Nightvault › <b>My PC</b>: on the PC open Nightvault › Settings › <b>Phone access</b>, switch it on, and type the address and code it shows.', go:{url:'../hub/index.html', text:'The Nightvault › My PC'}, android:true};

  /* ---------- the apps ---------- */
  const APPS = {
    cinema:{name:'Cinema', prefix:'nvCinema.', steps:[
      {id:'newglow', added:'2026-10-23', icon:'✨', title:'New things glow', body:'Anything new in the app (from a scan of your SD card, a PC sync or added by hand) gets a green glow. It stays for 24 hours from the moment you first see it, or until you open it. A dot on the ☰ button tells you when something needs attention.'},
      {id:'welcome', added:'2026-10-23', icon:'🎬', title:'Welcome to Nightvault Cinema', body:'Your films, TV shows, cartoons and anime, each on its own shelf, with one video player. Your list stays on this phone.'},
      {id:'add', added:'2026-10-23', icon:'➕', title:'Add your videos', body:'Tap <b>Add</b>: pick the folder on this phone with your films and series (nothing is copied), or copy files into the app. Names are read from the file names - you check them first. Films and shows on your PC come by themselves once your PC is connected.'},
      {id:'play', added:'2026-10-23', icon:'▶️', title:'Watching', body:'Tap a poster, then <b>Play</b>. Cinema remembers where you stopped and plays the next episode by itself. Subtitles: the <b>CC</b> button (Dutch first, else English; Earlier / Later if they are off). ⚙ in the player: speed, sound, quality.'},
      {id:'tv', added:'2026-10-23', icon:'📺', title:'Play on your TV', body:'⋯ › <b>Play on TV</b> (or the TV button in the player): the phone finds your Samsung, LG or other TV on the Wi‑Fi and tells it what to play - the TV fetches the film itself in full quality. The phone becomes the remote.'},
      {id:'groups', added:'2026-10-23', icon:'🗂️', title:'Groups and film series', body:'Films of one series make one tile by themselves (Shrek, Star Wars). Make your own groups with <b>+ Group</b>, long-press tiles to move several at once, ⋯ for more.'},
      {id:'calendar', added:'2026-10-23', icon:'📅', title:'Coming soon', body:'The <b>📅</b> button: new episodes of your shows, the next film of your series, your want-to-see list and everything coming to cinemas and streaming in Belgium - with a reminder on the day.'},
      {id:'tmdb', added:'2026-10-23', icon:'🔑', title:'TMDB (posters, story, dates)', body:'A free key from TMDB gives posters, the story, film series, episode names and the calendar. It stays on this phone.',
        how:['Make a free account at themoviedb.org.', 'Open your profile › <b>Settings › API</b> › <b>Create</b> (choose “Developer”, personal use).', 'Copy the <b>API Key</b> and paste it here.'],
        link:{url:'https://www.themoviedb.org/settings/api', text:'Get a free TMDB key'},
        keys:[{ls:'nvCinema.tmdb', json:true, label:'TMDB API key', ph:'32 letters and numbers', pattern:/^[0-9a-f]{32}$|^ey[\w.-]{60,}$/i, secret:true}],
        test:async v => { const bearer = v.length > 60, r = await fetch('https://api.themoviedb.org/3/configuration' + (bearer ? '' : '?api_key=' + encodeURIComponent(v)), {headers:bearer ? {Authorization:'Bearer ' + v} : {}}); if(r.status === 401) throw new Error('TMDB says this key is not right'); if(!r.ok) throw new Error('TMDB answered ' + r.status); return 'TMDB works' }},
      MYPC,
      {id:'tailscale', added:'2026-10-23', icon:'🌍', title:'Away from home (optional)', body:'To watch the films on your PC when you are not home: install the free <b>Tailscale</b> app on the PC and on this phone and log in with the same account on both. Cinema then finds your PC by itself, also on mobile data (720p to save data).', go:{url:'https://tailscale.com/download', text:'Get Tailscale'}, android:true},
      {id:'opensubs', added:'2026-10-23', icon:'💬', title:'Subtitles online (optional)', body:'With a free OpenSubtitles account your PC finds Dutch / English subtitles for films that have none and lines them up with the film. Make an account at opensubtitles.com, then in Cinema: <b>⚙ › Subtitles online</b> (it is kept on your PC).', go:{url:'https://www.opensubtitles.com/en/users/sign_up', text:'Make a free OpenSubtitles account'}, android:true}]},
    games:{name:'Games', prefix:'nvGames.', steps:[
      {id:'welcome', added:'2026-10-23', icon:'🎮', title:'Welcome to Nightvault Games', body:'A list of your computer, console, retro and handheld games - one tile per game with all your copies (Steam, physical, …) - and a wishlist. It does not play the games.'},
      {id:'add', added:'2026-10-23', icon:'➕', title:'Add games', body:'Tap <b>Add</b> and search a game by name, then <b>I have it</b> (platform, digital store or physical with what is included and the region) or <b>On my wishlist</b>. A shelf appears by itself for every platform.'},
      {id:'groups', added:'2026-10-23', icon:'🗂️', title:'Series and groups', body:'Games of one series make one tile (Halo, Zelda). Make your own groups with <b>+ Group</b>; ⋯ on a game for more (merge two tiles, change the cover).'},
      {id:'igdb', added:'2026-10-23', icon:'🔑', title:'IGDB (every game, with covers)', body:'Free keys from IGDB (via Twitch) find every game on every platform, with its cover and series. They stay on this phone. Works in the Android app.',
        how:['Log in at dev.twitch.tv/console/apps (a Twitch account with two-step login).', '<b>Register Your Application</b>: any name, OAuth Redirect URL <b>http://localhost</b>, category “Application Integration”, client type “Confidential”.', 'Copy the <b>Client ID</b>, then <b>New Secret</b> and copy that too.'],
        link:{url:'https://dev.twitch.tv/console/apps', text:'Open the Twitch developer console'},
        keys:[{ls:'nvGames.keys', field:'igdbId', label:'Client ID', ph:''}, {ls:'nvGames.keys', field:'igdbSecret', label:'Client Secret', ph:'', secret:true, clear:'nvGames.igdbTok'}], android:true},
      {id:'steam', added:'2026-10-23', icon:'🔑', title:'Steam (import your library)', body:'Bring in all your Steam games and your wishlist at once.',
        how:['Get a key at steamcommunity.com/dev/apikey (any domain name, e.g. localhost).', 'In Steam’s privacy settings set “Game details” to <b>Public</b>.', 'Paste the key and your Steam profile link. Then Games › ⚙ › <b>Import from Steam</b>.'],
        link:{url:'https://steamcommunity.com/dev/apikey', text:'Get a Steam Web API key'},
        keys:[{ls:'nvGames.keys', field:'steamKey', label:'Steam Web API key', ph:'32 letters and numbers', secret:true}, {ls:'nvGames.keys', field:'steamId', label:'Your Steam ID or profile link', ph:'steamcommunity.com/id/yourname'}], android:true},
      {id:'sgdb', added:'2026-10-23', icon:'🖼️', title:'SteamGridDB (more covers, optional)', body:'Many more covers to choose from.', how:['Log in at steamgriddb.com (with Steam).', 'Preferences › <b>API</b> › copy the key.'],
        link:{url:'https://www.steamgriddb.com/profile/preferences/api', text:'Get a SteamGridDB key'}, keys:[{ls:'nvGames.keys', field:'sgdbKey', label:'SteamGridDB API key', ph:'', secret:true}], android:true}]},
    bookcase:{name:'Bookcase', prefix:'nvBooks.', steps:[
      {id:'newglow', added:'2026-10-23', icon:'✨', title:'New things glow', body:'Anything new in the app (from a scan of your SD card, a PC sync or added by hand) gets a green glow. It stays for 24 hours from the moment you first see it, or until you open it. A dot on the ☰ button tells you when something needs attention.'},
      {id:'welcome', added:'2026-10-23', icon:'📚', title:'Welcome to Nightvault Bookcase', body:'Comics, manga, books, rulebooks, RPG books and colouring books on their own shelves, with one reader for CBZ, CBR, PDF, EPUB and picture folders.'},
      {id:'add', added:'2026-10-23', icon:'➕', title:'Add your books', body:'Tap <b>Add</b> on a shelf: pick a folder on this phone (nothing is copied) or files to copy into the app. Series are put together by themselves; the reader remembers your page.'},
      {id:'read', added:'2026-10-23', icon:'📖', title:'Reading', body:'Tap the edges or swipe to turn pages (right-to-left for manga), pinch to zoom. At the end the reader offers the next volume.'},
      {id:'comicvine', added:'2026-10-23', icon:'🔑', title:'Comic Vine (comics info, optional)', body:'A free key from Comic Vine looks up the publisher, series and story of your comics. It stays on this phone.',
        how:['Make a free account at comicvine.gamespot.com.', 'Open comicvine.gamespot.com/api - your key is on that page.', 'Paste it here.'],
        link:{url:'https://comicvine.gamespot.com/api/', text:'Get a free Comic Vine key'}, keys:[{ls:'nvBooks.cvKey', json:true, label:'Comic Vine key', ph:'40 letters and numbers', pattern:/^[0-9a-f]{40}$/i, secret:true}]},
      MYPC]},
    boardgames:{name:'Boardgames', prefix:'nvBoard.', steps:[
      {id:'welcome', added:'2026-10-23', icon:'🎲', title:'Welcome to Nightvault Boardgames', body:'The board games you own (from BoardGameGeek), your wishlist, miniatures and terrain, and the plays of your game nights.'},
      {id:'plays', added:'2026-10-23', icon:'🏆', title:'Log a play', body:'Open a game › <b>Log a play</b>: date, players, who won and the scores. Plays are kept here and can be sent to BoardGameGeek.'},
      {id:'bgg', added:'2026-10-23', icon:'🔑', title:'BoardGameGeek', body:'Your BGG games come in by themselves every morning once the GitHub job has your BGG user name and token, and plays are sent with your BGG login - both in Boardgames › <b>⚙ Settings</b> (top right), with the steps there.', go:{url:'https://boardgamegeek.com/login', text:'BoardGameGeek'}}]},
    music:{name:'Music', prefix:'nvMusic.', steps:[
      {id:'newglow', added:'2026-10-23', icon:'✨', title:'New things glow', body:'Anything new in the app (from a scan of your SD card, a PC sync or added by hand) gets a green glow. It stays for 24 hours from the moment you first see it, or until you open it. A dot on the ☰ button tells you when something needs attention.'},
      {id:'welcome', added:'2026-10-23', icon:'🎵', title:'Welcome to Nightvault Music', body:'Your own music: albums, artists, songs and playlists, with a big “now playing” screen. It keeps playing with the screen off.'},
      {id:'add', added:'2026-10-23', icon:'➕', title:'Add your music', body:'Tap <b>Add</b> and pick your music folder on this phone - nothing is copied, all folders inside are read. Or copy songs into the app.'},
      {id:'groups', added:'2026-10-23', icon:'🗂️', title:'Groups', body:'Albums of one artist or series make one tile. Make your own groups, put groups inside groups, pin favourites to the top.'},
      MYPC]},
    audiobooks:{name:'Audiobooks', prefix:'nvAudio.', steps:[
      {id:'welcome', added:'2026-10-23', icon:'🎧', title:'Welcome to Nightvault Audiobooks', body:'Your audiobooks, with a player that remembers where you were in every book. Faster or slower, a sleep timer, chapters.'},
      {id:'add', added:'2026-10-23', icon:'➕', title:'Add your books', body:'Tap <b>Add</b> and pick the folder with your audiobooks: one M4B per book, one long MP3/M4A, or a folder of MP3s per book. Nothing is copied.'}]},
    print3d:{name:'3D Print', prefix:'nvPrint.', steps:[
      {id:'welcome', added:'2026-10-23', icon:'🧊', title:'Welcome to Nightvault 3D Print', body:'Your 3D models (STL, OBJ, 3MF) with a 3D viewer, projects with their pictures and print files, and a log of what you printed.'},
      {id:'add', added:'2026-10-23', icon:'➕', title:'Add models', body:'Tap <b>Add</b> and pick a folder or files. One folder or ZIP = one project tile.'},
      MYPC]},
    convert:{name:'Convert', prefix:'nvConvert', steps:[
      {id:'welcome', added:'2026-10-23', icon:'🖼️', title:'Welcome to Nightvault Convert', body:'Makes your pictures smaller: WebP and/or AVIF, in the browser - nothing is uploaded. Pick pictures or a whole folder, choose the format and quality, then download them (as a ZIP).'}]}
  };

  /* the app this page is (from its address) */
  function here(){ const p = location.pathname, q = location.search;
    if(/\/audio\//.test(p)) return /mode=music/.test(q) ? 'music' : 'audiobooks';
    if(/\/tools\/convert\//.test(p)) return 'convert';
    const m = p.match(/\/(books|games|boardgames|cinema|print3d)\//); return m ? (m[1] === 'books' ? 'bookcase' : m[1]) : null }
  const usable = s => !(s.android && !NATIVE);
  const seen = app => (get('nvSetup', {})[app] || {}).seen || [];
  function markSeen(app, ids){ const all = get('nvSetup', {}), a = all[app] || {seen:[]}; a.seen = [...new Set(a.seen.concat(ids))]; a.at = Date.now(); all[app] = a; set('nvSetup', all) }
  /* a key's current value in the app's own storage */
  function keyVal(k){ const v = get(k.ls, k.field ? {} : ''); return String((k.field ? (v || {})[k.field] : v) || '') }
  function keySave(k, val){ if(k.field){ const o = get(k.ls, {}) || {}; o[k.field] = val; set(k.ls, o) } else if(k.json) set(k.ls, val || null); else { try{ val ? localStorage.setItem(k.ls, val) : localStorage.removeItem(k.ls) }catch(e){} } if(k.clear) set(k.clear, null) }
  const done = s => !s.keys || s.keys.every(k => keyVal(k));

  /* ---------- the window ---------- */
  function css(){ if(document.getElementById('nvsetcss')) return; const st = document.createElement('style'); st.id = 'nvsetcss';
    st.textContent = `#nvset{position:fixed;inset:0;z-index:300;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.5 'DM Sans',system-ui,sans-serif;color:var(--text,#e9edf2)}
      #nvset .box{width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--pan,#151a22);border:1px solid var(--line,#232b36);border-radius:22px;padding:22px 20px 18px;box-shadow:0 20px 60px #000a}
      #nvset .ic{font-size:40px;line-height:1;text-align:center}#nvset .st{text-align:center;font-size:12px;color:var(--dim,#9aa7b5);margin:8px 0 2px}
      #nvset h3{text-align:center;margin:0 0 8px;font-size:19px}#nvset p{margin:0 0 10px;font-size:14px;color:#d4dbe3}#nvset ol{margin:0 0 10px;padding-left:20px;font-size:13.5px;color:#d4dbe3}#nvset li{margin:3px 0}
      #nvset .new{display:block;text-align:center;font-size:11px;font-weight:800;letter-spacing:.6px;color:var(--accent,#ffb0a8);text-transform:uppercase}
      #nvset label{display:block;font-size:12.5px;color:var(--dim,#9aa7b5);margin:8px 0 4px}#nvset input{width:100%;box-sizing:border-box;min-height:42px;border-radius:12px;border:1px solid var(--line,#232b36);background:var(--pan2,#10141b);color:inherit;padding:0 12px;font:inherit;font-size:14.5px}
      #nvset .lk{display:flex;align-items:center;justify-content:center;gap:6px;height:42px;border-radius:12px;border:1px solid var(--line,#232b36);background:var(--pan2,#10141b);color:var(--blue,#7fb2ff);text-decoration:none;font-size:14px;margin:4px 0 6px}
      #nvset .row{display:flex;gap:8px;margin-top:14px}#nvset .row button{flex:1;height:44px;border-radius:13px;border:1px solid var(--line,#232b36);background:var(--pan2,#10141b);color:inherit;font:inherit;font-size:14.5px;cursor:pointer}
      #nvset .row button.p{background:var(--accentd,#3b6fd8);border-color:var(--accentb,#3b6fd8);color:#fff;font-weight:700;flex:1.6}
      #nvset .dots{display:flex;justify-content:center;gap:5px;margin-top:12px}#nvset .dots i{width:7px;height:7px;border-radius:50%;background:#3a4553}#nvset .dots i.on{background:var(--accent,#ffb0a8)}
      #nvset .res{font-size:13px;margin-top:6px}#nvset .ok{color:#8fe0a0}#nvset .bad{color:#ef8a8f}#nvset .ok2{display:block;text-align:center;color:#8fe0a0;font-size:13px;margin-bottom:6px}
      .nvhelp{font-weight:800;font-size:17px}`;
    document.head.appendChild(st) }
  let NOW = null;
  function show(app, steps, i, isNew){ css(); const a = APPS[app], s = steps[i], last = i === steps.length - 1; NOW = {app, steps, i, isNew};
    let el = document.getElementById('nvset'); if(!el){ el = document.createElement('div'); el.id = 'nvset'; document.body.appendChild(el) }
    const keys = s.keys || [];
    el.innerHTML = `<div class="box">${isNew ? `<span class="new">New in ${esc(a.name)}</span>` : ''}<div class="ic">${s.icon || '✨'}</div><div class="st">${i + 1} / ${steps.length}</div><h3>${esc(s.title)}</h3>
      ${done(s) && keys.length ? '<span class="ok2">✓ Already set up</span>' : ''}<p>${s.body}</p>${s.how ? `<ol>${s.how.map(x => `<li>${x}</li>`).join('')}</ol>` : ''}
      ${s.link ? `<a class="lk" href="${esc(s.link.url)}" target="_blank" rel="noopener">${esc(s.link.text)} ↗</a>` : ''}${s.go ? `<a class="lk" href="${esc(s.go.url)}" ${/^https?:/.test(s.go.url) ? 'target="_blank" rel="noopener"' : ''}>${esc(s.go.text)}${/^https?:/.test(s.go.url) ? ' ↗' : ' ›'}</a>` : ''}
      ${keys.map((k, n) => `<label for="nvk${n}">${esc(k.label)}</label><input id="nvk${n}" type="${k.secret ? 'password' : 'text'}" value="${esc(keyVal(k))}" placeholder="${esc(k.ph || '')}" autocomplete="off" autocapitalize="off" spellcheck="false">`).join('')}
      <div class="res" id="nvres"></div>
      <div class="row">${i ? '<button id="nvback">Back</button>' : '<button id="nvskip">Skip all</button>'}${keys.length ? '<button id="nvlater">Later</button>' : ''}<button class="p" id="nvnext">${keys.length ? 'Save' : last ? 'Start' : 'Next'}</button></div>
      <div class="dots">${steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div></div>`;
    const next = () => { markSeen(app, [s.id]); if(last) close(); else show(app, steps, i + 1, isNew) };
    if(document.getElementById('nvback')) document.getElementById('nvback').onclick = () => show(app, steps, i - 1, isNew);
    if(document.getElementById('nvskip')) document.getElementById('nvskip').onclick = () => { markSeen(app, steps.map(x => x.id)); log('skipped', {app}); close() };
    if(document.getElementById('nvlater')) document.getElementById('nvlater').onclick = next;
    document.getElementById('nvnext').onclick = async () => { if(!keys.length) return next();
      const vals = keys.map((k, n) => document.getElementById('nvk' + n).value.trim().replace(/\s+/g, k.field === 'steamId' ? '' : '')), res = document.getElementById('nvres');
      for(let n = 0; n < keys.length; n++) if(vals[n] && keys[n].pattern && !keys[n].pattern.test(vals[n])){ res.innerHTML = `<span class="bad">That does not look like a ${esc(keys[n].label)} - check it.</span>`; return }
      keys.forEach((k, n) => keySave(k, vals[n])); log('saved', {app, step:s.id, filled:vals.filter(Boolean).length});
      if(s.test && vals[0]){ res.innerHTML = 'Checking…'; try{ res.innerHTML = `<span class="ok">✓ ${esc(await s.test(vals[0]))}</span>`; setTimeout(next, 900) }catch(e){ res.innerHTML = `<span class="bad">✗ ${esc(e.message || e)} - saved anyway, change it any time.</span>` } return }
      next() } }
  function close(){ const el = document.getElementById('nvset'); if(el) el.remove(); NOW = null; try{ window.dispatchEvent(new Event('nvsetup-done')) }catch(e){} }

  /* ---------- open: everything (the ? button), or only what is new / not seen ---------- */
  function open(app, onlyNew){ app = app || here(); const a = APPS[app]; if(!a) return false;
    const all = a.steps.filter(usable), have = new Set(seen(app)), list = onlyNew ? all.filter(s => !have.has(s.id)) : all;
    if(!list.length) return false; show(app, list, 0, onlyNew && have.size > 0); return true }
  /* when an app opens: first time = everything; later = only the new steps (a feature or a key added by an update) */
  function auto(){ const app = here(), a = APPS[app]; if(!a) return;
    const all = a.steps.filter(usable), have = new Set(seen(app)), fresh = all.filter(s => !have.has(s.id));
    if(!fresh.length) return;
    if(!have.size && !FRESH && all.filter(s => s.keys).every(done)){ markSeen(app, all.map(s => s.id)); return }   // someone who already used the app before this existed and has everything set up: no tour now (the ? button has it)
    if(document.querySelector('#nvset, .scrim, #player:not([hidden]), #modal > *')) { setTimeout(auto, 3000); return }
    show(app, fresh, 0, have.size > 0) }
  /* was this app's storage empty when the page started (before the app wrote its first settings)? */
  const FRESH = (() => { const a = APPS[here()]; if(!a) return false; try{ for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k && k.startsWith(a.prefix) && !/\.here$/.test(k)) return false } }catch(e){} return true })();
  /* the "?" button next to the app's ⚙ */
  function button(){ for(const id of ['setbtn', 'msetbtn']){ const sb = document.getElementById(id); if(!sb || document.getElementById('nvhelp_' + id)) continue;
      const b = document.createElement('button'); b.className = sb.className || 'ib'; b.id = 'nvhelp_' + id; b.setAttribute('aria-label', 'How to use and set up'); b.innerHTML = '<span class="nvhelp">?</span>';
      b.onclick = () => open(here(), false); sb.parentNode.insertBefore(b, sb) } }
  window.NVSETUP = {apps:APPS, here, open, auto, seen, markSeen, get fresh(){ return FRESH }};
  const start = () => { css(); button(); setTimeout(auto, 1800) };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
