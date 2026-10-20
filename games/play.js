/* Nightvault Games – PLAY (owner, 20 October 2026): start the games you own digitally.
   - Your own backups (ROM files, disc images) per system: a folder on this phone, and/or the ROM folders of the PC app.
     "Look for games" matches the files to the games in your list (by name) and can add the ones that are not in it yet.
   - On this phone: an emulator app opens the file (NvLaunch, Android only). Per system tile: ⚙ → How to play → which emulator.
     "Let Android ask" works with any emulator that opens files; presets start RetroArch (with a core) and the usual emulators directly.
   - On my PC: the PC app starts it with the emulator set THERE (Settings > Games: play on this PC), or a Steam game (vault_games.py, /nv/play).
   - Save to phone: a backup on the PC is copied once into the system's phone folder (NvPc.saveToFolder; a disc's .bin files come along),
     then it plays offline. Playing straight over Wi-Fi is not done: other apps can't read Nightvault's own PC connection.
   Only your own backups – Nightvault never downloads games or BIOS files. Plan: plans/games.md. Loaded after app.js (uses its helpers). */
'use strict';
let NvLaunch = null, NvFilesG = null, NvPcG = null;
if(NATIVE) try{ NvLaunch = Capacitor.registerPlugin('NvLaunch'); NvFilesG = Capacitor.registerPlugin('NvFiles'); NvPcG = Capacitor.registerPlugin('NvPc') }catch(e){}
const PCOK = () => !!(window.NVPC && NVPC.native && NVPC.pc);

/* RetroArch cores on Android per system (the usual one; can be changed per system) */
const ACORE = {nes:'fceumm', fds:'fceumm', snes:'snes9x', n64:'mupen64plus_next_gles3', gb:'gambatte', gbc:'gambatte', gba:'mgba', ds:'melonds', vb:'mednafen_vb',
  pmini:'pokemini', md:'genesis_plus_gx', sms:'genesis_plus_gx', gg:'genesis_plus_gx', sg1000:'genesis_plus_gx', segacd:'genesis_plus_gx', s32x:'picodrive',
  saturn:'yabasanshiro', dc:'flycast', ps1:'swanstation', psp:'ppsspp', gc:'dolphin', wii:'dolphin', a2600:'stella2014', a5200:'a5200', a7800:'prosystem',
  lynx:'handy', jaguar:'virtualjaguar', neogeo:'fbneo', arcade:'fbneo', neocd:'neocd', pce:'mednafen_pce_fast', pcecd:'mednafen_pce_fast', pcfx:'mednafen_pcfx',
  '3do':'opera', ngp:'mednafen_ngp', ngpc:'mednafen_ngp', ws:'mednafen_wswan', wsc:'mednafen_wswan', coleco:'gearcoleco', intv:'freeintv', vectrex:'vecx',
  odyssey2:'o2em', c64:'vice_x64', amiga:'puae', ast:'hatari', a8bit:'atari800', msx:'bluemsx', zx:'fuse', cpc:'cap32', x68k:'px68k', pc98:'np2kai', dos:'dosbox_pure', cdi:'same_cdi'};
/* emulator apps on Android: how each one is started (best known; if one doesn't start, "Let Android ask" always works) */
const AEMU = {
  retroarch:{name:'RetroArch', pkgs:['com.retroarch.aarch64', 'com.retroarch', 'com.retroarch.ra32'], mode:'retroarch'},
  ppsspp:{name:'PPSSPP', pkgs:['org.ppsspp.ppssppgold', 'org.ppsspp.ppsspp'], mode:'view', cls:'org.ppsspp.ppsspp.PpssppActivity', sys:['psp']},
  dolphin:{name:'Dolphin', pkgs:['org.dolphinemu.dolphinemu', 'org.dolphinemu.mmjr'], mode:'extraArray', key:'AutoStartFiles', cls:'org.dolphinemu.dolphinemu.ui.main.MainActivity', sys:['gc', 'wii']},
  nethersx2:{name:'NetherSX2 / AetherSX2', pkgs:['xyz.aethersx2.android', 'xyz.aethersx2.custom'], mode:'extra', key:'bootPath', cls:'xyz.aethersx2.android.EmulationActivity', sys:['ps2']},
  duckstation:{name:'DuckStation', pkgs:['com.github.stenzek.duckstation'], mode:'extra', key:'bootPath', cls:'com.github.stenzek.duckstation.EmulationActivity', sys:['ps1']},
  drastic:{name:'DraStic', pkgs:['com.dsemu.drastic'], mode:'extra', key:'GAMEPATH', path:true, cls:'com.dsemu.drastic.DraSticActivity', sys:['ds']},
  melonds:{name:'melonDS', pkgs:['me.magnum.melonds'], mode:'view', sys:['ds']},
  azahar:{name:'Azahar / Lime3DS', pkgs:['org.azahar_emu.azahar', 'io.github.lime3ds.android'], mode:'view', sys:['n3ds']},
  redream:{name:'Redream', pkgs:['io.recompiled.redream'], mode:'view', sys:['dc']},
  flycast:{name:'Flycast', pkgs:['com.flycast.emulator'], mode:'view', sys:['dc', 'arcade', 'neogeo']},
  m64:{name:'Mupen64Plus FZ', pkgs:['org.mupen64plusae.v3.fzurita.pro', 'org.mupen64plusae.v3.fzurita'], mode:'view', sys:['n64']},
  myboy:{name:'My Boy!', pkgs:['com.fastemulator.gba', 'com.fastemulator.gbafree'], mode:'view', sys:['gba']},
  myoldboy:{name:'My OldBoy!', pkgs:['com.fastemulator.gbc', 'com.fastemulator.gbcfree'], mode:'view', sys:['gb', 'gbc']}};
const playAll = () => lsGet('nvGames.play', {});
const playSet = sys => playAll()[sys] || {};
const playPut = (sys, patch) => { const a = playAll(); a[sys] = Object.assign({}, a[sys] || {}, patch); lsSet('nvGames.play', a) };
const emuOf = sys => playSet(sys).emu || 'chooser';
const emuName = sys => { const e = emuOf(sys), s = playSet(sys); return e === 'chooser' ? 'Android asks which app' : e === 'retroarch' ? `RetroArch (${s.core || ACORE[sys] || 'core?'})` : e === 'app' ? (s.pkg || 'your app') : (AEMU[e] || {}).name || e };
const emusFor = sys => Object.entries(AEMU).filter(([k, e]) => k !== 'retroarch' && (e.sys || []).includes(sys));

/* ---------- backup files → one entry per game ---------- */
const NOTGAME = /\.(sav|srm|state\d*|sta|txt|nfo|diz|jpe?g|png|gif|bmp|webp|pdf|xml|dat|ini|cfg|db|bak|sha1|md5|sfv|url|lnk|log|html?|mp3|ogg|wav|pnach|ips|bps|ups|xdelta|cht|exe|dll|bat|sh|json|mp4|mkv)$/i;
const SHEETS = /\.(cue|gdi|m3u)$/i, TRACK = /\.(bin|raw|img|wav|sub|ecm)$/i;
/* "Legend of Zelda, The - A Link to the Past (USA) (Rev 1) [!].sfc" → {title:"The Legend of Zelda - A Link to the Past", disc:0} */
function cleanRom(name){ let t = String(name).replace(/\.[a-z0-9]{1,5}$/i, ''), disc = 0;
  const d = t.match(/[([]\s*(?:disc|disk|cd)\s*(\d+)(?:\s*of\s*\d+)?\s*[)\]]/i); if(d) disc = +d[1];
  t = t.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(.+?), (The|A|An)\b(.*)$/i, (m, a, b, c) => `${b} ${a}${c}`);
  return {title:t, disc} }
/* files: [{name, dir, ...}] → entries [{title, disc, file, others:[files of other discs]}] (a disc's tracks are left out: the cue / gdi / m3u is the game) */
function romEntries(files){
  const byDir = {}; for(const f of files) (byDir[f.dir] = byDir[f.dir] || []).push(f);
  const keep = [];
  for(const l of Object.values(byDir)){ const hasM3u = l.some(f => /\.m3u$/i.test(f.name)), hasSheet = l.some(f => /\.(cue|gdi)$/i.test(f.name));
    for(const f of l){ if(NOTGAME.test(f.name)) continue; if(hasM3u && /\.(cue|gdi|chd|bin|iso|img)$/i.test(f.name)) continue; if(hasSheet && TRACK.test(f.name)) continue; keep.push(f) } }
  const by = {}; for(const f of keep){ const c = cleanRom(f.name), k = norm(c.title); if(!k) continue; (by[k] = by[k] || []).push(Object.assign({}, f, {title:c.title, disc:c.disc})) }
  return Object.values(by).map(l => { l.sort((a, b) => (/\.m3u$/i.test(b.name) - /\.m3u$/i.test(a.name)) || (a.disc || 0) - (b.disc || 0));
    return {title:l[0].title, file:l[0], discs:l.length} }) }
/* put the found files on the games in the list; returns {matched, fresh} */
function matchRoms(sys, entries, where){ let matched = 0, same = 0; const fresh = [];
  for(const en of entries){ const k = norm(en.title);
    const g = GAMES.find(x => x.copies.some(c => c.plat === sys) && norm(x.title) === k) || GAMES.find(x => norm(x.title) === k);
    if(!g){ fresh.push(en); continue }
    if(g.copies.some(c => c.rom && c.rom[where] && (c.rom[where].uri || c.rom[where].id) === (en.file.uri || en.file.id))){ same++; continue }
    const cs = g.copies.filter(c => c.plat === sys && !(c.rom && c.rom[where]));
    let c = cs.find(x => x.store === 'backup') || cs.find(x => x.kind === 'physical') || cs[0];
    if(!c){ c = {id:'c' + uid(), plat:sys, kind:'digital', store:'backup', added:Date.now()}; g.copies.push(c) }
    c.rom = Object.assign({}, c.rom || {}, {[where]:romRef(en.file, where)}); if(g.wish) g.wish = false; matched++; GM[g.id]._dirty = true }
  return {matched, same, fresh} }
const romRef = (f, where) => where === 'phone' ? {uri:f.uri, name:f.name, size:f.size || 0, tree:f.tree || ''} : {id:f.id, name:f.name, size:f.size || 0, parts:(f.parts || []).map(p => ({id:p.id, name:p.name, size:p.size}))};
async function saveDirty(){ const d = GAMES.filter(g => g._dirty); for(const g of d){ delete g._dirty; g.edited = Date.now() } if(d.length) await dbPutMany('games', d); regroup() }
function scanDone(sys, where, r){
  const names = r.fresh.map(e => e.title).sort((a, b) => coll.compare(a, b));
  sheet(`<h3>${esc(platOf(sys).name)}: ${where === 'phone' ? 'this phone' : 'your PC'}</h3>
    <p>${plural(r.matched, 'backup')} put on games in your list${r.same ? ` · ${r.same} already known` : ''}.</p>
    ${names.length ? `<p>${plural(names.length, 'game')} ${names.length === 1 ? 'is' : 'are'} not in your list yet:</p><div class="note" style="max-height:30vh;overflow:auto">${names.slice(0, 300).map(esc).join('<br>')}${names.length > 300 ? '<br>…' : ''}</div>
      <div class="mlist"><button class="btn primary" id="scadd">Add ${plural(names.length, 'game')} to my list</button><button class="btn" onclick="closeSheet()">Not now</button></div>
      <p class="muted small">They get the name of the file${hasIgdb() ? '; you can fill in covers and details from IGDB right after' : ''}.</p>` : '<button class="btn primary" style="width:100%" onclick="closeSheet()">OK</button>'}`);
  if($('#scadd')) $('#scadd').onclick = async () => { const made = [];
    for(const en of r.fresh){ const g = newGame({title:en.title, plats:[sys]}); g.copies.push({id:'c' + uid(), plat:sys, kind:'digital', store:'backup', added:Date.now(), rom:{[where]:romRef(en.file, where)}}); made.push(g); GAMES.push(g); GM[g.id] = g }
    await dbPutMany('games', made); regroup(); closeSheet(); draw(); toast(`${plural(made.length, 'game')} added`);
    if(hasIgdb() && confirm(`Fill in covers and details of the ${plural(made.length, 'new game')} from IGDB now?`)) fillDetails(made) } }
async function scanPhone(sys){ const s = playSet(sys); if(!NvFilesG){ toast('This works in the Android app'); return } if(!s.folder){ await pickPhoneFolder(sys); return }
  const b = busySheet('Looking in ' + esc(s.folder.name) + '…'); b.set(0, 0, 'Looking for backup files…'); let r;
  try{ r = await NvFilesG.list({tree:s.folder.tree}) }catch(e){ closeSheet(); toast(e.message || String(e), 5000); return }
  const files = (r.files || []).map(f => ({uri:f.uri, name:f.name, size:f.size, tree:s.folder.tree, dir:f.path.slice(0, f.path.length - f.name.length)}));
  const m = matchRoms(sys, romEntries(files), 'phone'); await saveDirty(); L('play', 'phone scan', {sys, files:files.length, matched:m.matched, fresh:m.fresh.length}); draw(); scanDone(sys, 'phone', m) }
async function pickPhoneFolder(sys){ if(!NvFilesG){ toast('This works in the Android app'); return }
  try{ const f = await NvFilesG.pickFolder(); if(!f || !f.tree) return; playPut(sys, {folder:{tree:f.tree, name:f.name}}); toast(`${platOf(sys).short}: folder “${f.name}”`); return scanPhone(sys) }catch(e){ if(!/cancel/i.test(e.message || '')) toast(e.message || String(e), 4000) } }
/* the PC's ROM folders (all systems at once, or one) */
async function scanPc(only){ if(!PCOK()){ toast('Pair your PC first: The Nightvault → My PC', 4500); return }
  const b = busySheet('Looking on your PC…'); b.set(0, 0, 'Asking the PC for your backups…'); let j;
  try{ if(!await NVPC.reachable(true)) throw new Error('Your PC is not reachable - is it on, with Nightvault running and Phone access switched on?'); j = await NVPC.list('games', null, true) }
  catch(e){ closeSheet(); toast(/too old|404/.test(e.message) ? 'Copy the newest vault.py, vault_phone.py and vault_games.py to the PC first.' : e.message || String(e), 6000); return }
  lsSet('nvGames.pcplay', {at:Date.now(), systems:j.systems || {}});
  const bySys = {}; for(const it of j.items || []) if(!only || it.sys === only) (bySys[it.sys] = bySys[it.sys] || []).push(Object.assign({}, it, {dir:it.dir || ''}));
  let tot = {matched:0, same:0, fresh:[]}; const freshBy = {};
  for(const [sys, l] of Object.entries(bySys)){ const m = matchRoms(sys, romEntries(l), 'pc'); tot.matched += m.matched; tot.same += m.same; if(m.fresh.length) freshBy[sys] = m.fresh }
  await saveDirty(); draw(); L('play', 'pc scan', {only, items:(j.items || []).length, matched:tot.matched});
  const syss = Object.keys(freshBy);
  if(syss.length <= 1) return scanDone(syss[0] || only || Object.keys(bySys)[0] || 'pc', 'pc', {matched:tot.matched, same:tot.same, fresh:freshBy[syss[0]] || []});
  sheet(`<h3>Your PC</h3><p>${plural(tot.matched, 'backup')} put on games in your list${tot.same ? ` · ${tot.same} already known` : ''}.</p><p>Not in your list yet:</p>
    ${syss.map(s => `<div class="li" data-scs="${esc(s)}"><div class="n"><div>${esc(platOf(s).name)}</div><div class="s">${plural(freshBy[s].length, 'game')}</div></div><span class="r">Add…</span></div>`).join('')}
    <button class="btn" style="width:100%;margin-top:10px" onclick="closeSheet()">Done</button>`);
  $('.sheet').addEventListener('click', e => { const r = e.target.closest('[data-scs]'); if(r) scanDone(r.dataset.scs, 'pc', {matched:0, same:0, fresh:freshBy[r.dataset.scs]}) }) }

/* ---------- what can be played ---------- */
const romPhone = c => !!(c.rom && c.rom.phone && c.rom.phone.uri);
const romPc = c => !!(c.rom && c.rom.pc && c.rom.pc.id);
const steamCopy = g => g.steam && g.copies.find(c => c.plat === 'pc' && c.store === 'steam');
const canPlay = g => g.copies.some(c => romPhone(c) || romPc(c)) || !!steamCopy(g);
function playRowHTML(g){ if(!canPlay(g)) return '';
  const ph = g.copies.find(romPhone), pc = g.copies.find(romPc), st = steamCopy(g), b = [];
  if(ph) b.push(`<button class="btn primary" data-play="phone:${esc(ph.id)}" style="flex:1">▶ Play${pc || st ? ' on this phone' : ''}</button>`);
  if(pc || st) b.push(`<button class="btn ${ph ? '' : 'primary'}" data-play="pc:${esc((pc || st).id)}" style="flex:1">▶ Play on my PC</button>`);
  if(pc && !ph) b.push(`<button class="btn" data-play="save:${esc(pc.id)}">Save to phone</button>`);
  return `<div class="mbar">${b.join('')}</div>` }
function romTags(c){ return (romPhone(c) ? '<span class="tag" style="color:var(--green)">On this phone</span>' : '') + (romPc(c) ? '<span class="tag" style="color:#7fe3ff">On my PC</span>' : '') + (c.store === 'steam' ? '' : '') }
function hookPlay(g){ document.querySelectorAll('[data-play]').forEach(b => b.onclick = () => { const [how, id] = b.dataset.play.split(':'), c = g.copies.find(x => x.id === id); if(!c) return;
  if(how === 'phone') playOnPhone(g, c); else if(how === 'pc') playOnPc(g, c); else saveToPhone(g, c) }) }
async function playOnPhone(g, c){ const sys = c.plat, s = playSet(sys), e = emuOf(sys), f = c.rom.phone;
  if(!NvLaunch){ toast('Playing on the phone works in the Android app'); return }
  const o = {uri:f.uri, title:'Play ' + g.title + ' with…'};
  if(e === 'chooser') o.mode = 'chooser';
  else if(e === 'retroarch') Object.assign(o, {mode:'retroarch', pkgs:AEMU.retroarch.pkgs, core:s.core || ACORE[sys] || ''});
  else if(e === 'app') Object.assign(o, {mode:s.mode || 'view', pkgs:[s.pkg], cls:s.cls || '', key:s.key || ''});
  else { const p = AEMU[e]; if(!p){ o.mode = 'chooser' } else Object.assign(o, {mode:p.mode, pkgs:p.pkgs, cls:p.cls || '', key:p.key || '', path:!!p.path}) }
  L('play', 'phone', {game:g.title, sys, emu:e, file:f.name});
  try{ await NvLaunch.launch(o); g.played = Date.now(); saveGame(g) }
  catch(err){ LE('play', 'phone start failed', {emu:e, err:err.message}); const msg = err.message || String(err);
    sheet(`<h3>Could not start it</h3><p>${esc(msg)}</p><p class="muted small">Emulator for ${esc(platOf(sys).name)}: ${esc(emuName(sys))}.</p>
      <div class="mlist"><button class="btn primary" id="pfask">Let Android ask which app</button><button class="btn" id="pfhow">How to play ${esc(platOf(sys).short)}…</button></div>`);
    $('#pfask').onclick = () => { closeSheet(); NvLaunch.launch({mode:'chooser', uri:f.uri, title:'Play ' + g.title + ' with…'}).catch(e2 => toast(e2.message || String(e2), 5000)) };
    $('#pfhow').onclick = () => howToPlay(sys) } }
async function playOnPc(g, c){ if(!PCOK()){ toast('Pair your PC first: The Nightvault → My PC', 4500); return }
  const q = romPc(c) ? 'id=' + encodeURIComponent(c.rom.pc.id) : 'steam=' + encodeURIComponent(g.steam);
  toast('Starting on your PC…');
  try{ if(!await NVPC.reachable()) throw new Error('Your PC is not reachable - is it on, with Nightvault running?');
    const r = await fetch(NVPC.url('/nv/play?' + q), {cache:'no-store'}), j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(j.error || 'The PC answered ' + r.status);
    toast(`Started on your PC${j.how ? ' with ' + j.how : ''}`, 3500); L('play', 'pc', {game:g.title, how:j.how}); g.played = Date.now(); saveGame(g) }
  catch(e){ LE('play', 'pc start failed', e.message); toast(/too old|404/.test(e.message) ? 'Copy the newest vault.py, vault_phone.py and vault_games.py to the PC first.' : e.message || String(e), 6000) } }
/* copy a backup from the PC into this system's phone folder once (a disc's track files too), then it plays offline */
async function saveToPhone(g, c){ const sys = c.plat, pf = c.rom.pc;
  if(!NvPcG || !PCOK()){ toast('Pair your PC first: The Nightvault → My PC', 4500); return }
  let s = playSet(sys);
  if(!s.folder){ if(!confirm(`Pick the folder on this phone for your ${platOf(sys).name} games (it is used from now on).`)) return;
    try{ const f = await NvFilesG.pickFolder(); if(!f || !f.tree) return; playPut(sys, {folder:{tree:f.tree, name:f.name}}); s = playSet(sys) }catch(e){ return } }
  const files = (pf.parts || []).concat([{id:pf.id, name:pf.name, size:pf.size}]), total = pf.size || files.reduce((a, x) => a + (x.size || 0), 0), sub = pf.parts && pf.parts.length ? cleanRom(pf.name).title.replace(/[\\/:*?"<>|]/g, '') : '';
  if(!await NVPC.reachable(true)){ toast('Your PC is not reachable - is it on, with Nightvault running?', 5000); return }
  const b = busySheet(`Saving ${esc(g.title)} to this phone…`); let done = 0, lis = null, res = null; awake(true);
  try{ lis = await NvPcG.addListener('saveProgress', e => b.set(done + (e.done || 0), total, `${(((done + (e.done || 0)) / 1048576) | 0)} of ${(total / 1048576) | 0} MB · ${e.name || ''}`)) }catch(e){}
  try{ for(const f of files){ if(b.stop) throw new Error('Stopped');
      const r = await NvPcG.saveToFolder({tree:s.folder.tree, folder:sub, name:f.name, path:'/nv/gfile?id=' + encodeURIComponent(f.id)}); done += r.size || f.size || 0; if(f.id === pf.id) res = r }
    c.rom = Object.assign({}, c.rom, {phone:{uri:res.uri, name:pf.name, size:total, tree:s.folder.tree}}); await saveGame(g);
    closeSheet(); draw(); L('play', 'saved to phone', {game:g.title, size:total});
    sheet(`<h3>Saved on this phone</h3><p>${esc(g.title)} is in “${esc(s.folder.name)}${sub ? '/' + esc(sub) : ''}” and plays without the PC now.</p><div class="mlist"><button class="btn primary" id="svplay">▶ Play now</button><button class="btn" onclick="closeSheet()">Later</button></div>`);
    $('#svplay').onclick = () => { closeSheet(); playOnPhone(g, c) } }
  catch(e){ closeSheet(); toast('Not saved: ' + (e.message || e), 6000); LE('play', 'save to phone', e.message) }
  finally{ awake(false); try{ lis && lis.remove() }catch(e){} } }

/* ---------- How to play (per system tile: ⚙) ---------- */
async function howToPlay(sys){ const s = playSet(sys), e = emuOf(sys), p = platOf(sys), pcs = (lsGet('nvGames.pcplay', {}).systems || {})[sys];
  const opts = [['chooser', 'Let Android ask which app (works with any emulator)'], ...(ACORE[sys] ? [['retroarch', 'RetroArch']] : []), ...emusFor(sys).map(([k, x]) => [k, x.name]), ['app', 'Another app (type its package name)…']];
  sheet(`<h3>How to play · ${esc(p.name)}</h3>
    ${NATIVE ? '' : '<p class="note">Starting games works in the Android app. On the website you can only see your list.</p>'}
    <div class="sec" style="margin-top:4px">On this phone</div>
    <div class="field"><label>Emulator app</label><select id="hpemu" style="width:100%;height:42px">${opts.map(([k, t]) => `<option value="${k}" ${e === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><div class="muted small" id="hpinst" style="margin-top:4px"></div></div>
    <div class="field" id="hpcore" ${e === 'retroarch' ? '' : 'hidden'}><label>RetroArch core (installed in RetroArch: Load Core → Download a Core)</label><input type="text" id="hpcorev" value="${esc(s.core || '')}" placeholder="${esc(ACORE[sys] || '')}"></div>
    <div id="hpapp" ${e === 'app' ? '' : 'hidden'}><div class="field"><label>Package name (from the app's Play Store link: id=…)</label><input type="text" id="hppkg" value="${esc(s.pkg || '')}" placeholder="com.example.emulator" autocapitalize="off"></div></div>
    <div class="field"><label>Folder with your ${esc(p.short)} backups on this phone</label><div style="display:flex;gap:8px;align-items:center"><span class="muted small" style="flex:1;min-width:0;overflow-wrap:anywhere">${s.folder ? esc(s.folder.name) : 'none yet'}</span><button class="btn sm" id="hpfold">${s.folder ? 'Other folder' : 'Pick folder'}</button>${s.folder ? '<button class="btn sm primary" id="hpscan">Look for games</button>' : ''}</div></div>
    <p class="muted small">${e === 'retroarch' ? 'RetroArch needs “All files access” (Android settings → Apps → RetroArch → Permissions) to open the file. ' : ''}Some systems need the console’s BIOS file inside the emulator (PS1, PS2, Saturn …) – from your own console.</p>
    <div class="sec">On my PC</div>
    ${PCOK() ? `<p class="small">${pcs ? (pcs.ready ? `Ready on the PC: ${esc(pcs.emulator)}` : `<span class="bad">${esc(pcs.problem || 'Not set up on the PC')}</span>`) : 'Set the backup folder and emulator in Nightvault on the PC: Settings → Games: play on this PC.'}</p>
      <button class="btn" id="hppc" style="width:100%">Look for ${esc(p.short)} games on my PC</button>` : `<p class="muted small">Pair your PC in The Nightvault → My PC. Then set the backup folder and emulator in Nightvault on the PC: Settings → Games: play on this PC.</p>`}
    <div style="display:flex;gap:8px;margin-top:14px"><button class="btn primary" style="flex:1" id="hpsave">Save</button></div>`, true);
  const upd = () => { const v = $('#hpemu').value; $('#hpcore').hidden = v !== 'retroarch'; $('#hpapp').hidden = v !== 'app'; inst(v) };
  const inst = async v => { const el = $('#hpinst'); if(!el) return; el.textContent = ''; if(!NvLaunch || v === 'chooser' || v === 'app') return;
    try{ const r = await NvLaunch.installed({pkgs:AEMU[v].pkgs}); const ok = (r.installed || []).length; if($('#hpinst')) $('#hpinst').innerHTML = ok ? '<span class="ok">✓ installed</span>' : '<span class="bad">Not installed on this phone</span>' }catch(e){} };
  $('#hpemu').onchange = upd; upd();
  const save = () => { const v = $('#hpemu').value; playPut(sys, {emu:v, core:$('#hpcorev').value.trim(), pkg:$('#hppkg').value.trim()}) };
  $('#hpsave').onclick = () => { save(); closeSheet(); draw(); toast('Saved') };
  $('#hpfold').onclick = () => { save(); closeSheet(); pickPhoneFolder(sys) };
  if($('#hpscan')) $('#hpscan').onclick = () => { save(); closeSheet(); scanPhone(sys) };
  if($('#hppc')) $('#hppc').onclick = () => { save(); closeSheet(); scanPc(sys) } }
