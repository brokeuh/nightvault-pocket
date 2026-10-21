/* Nightvault Cinema – PLAY ON TV (21 October 2026). Plan: plans/cinema.md "Cinema on a smart TV".
   NOT screen casting: the phone tells the TV (DLNA / UPnP – Samsung, LG, Sony, Philips …) which address to play; the TV fetches the
   video itself in full quality and plays it with its own player. The phone becomes the remote.
   - At home with the PC: the TV fetches from the PC (vault_cinema.py: /nv/cin/tv/… as it is, or /nv/cin/tvs/… converted to MPEG-TS
     with the subtitles burned in).
   - A video on the phone (a folder or saved for a trip – e.g. at a friend's house): the phone serves it itself (NvTv.share).
   - Subtitles: Samsung gets the SRT next to the video (CaptionInfo.sec); other TVs get them burned into the picture by the PC.
   Android plugin: NvTv (discover / get / soap / ip / share / unshare). Uses app.js's globals (same page). */
'use strict';
window.NvTvP = NATIVE && window.Capacitor && Capacitor.isPluginAvailable && Capacitor.isPluginAvailable('NvTv') ? Capacitor.registerPlugin('NvTv') : null;
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const xesc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
const hms = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` };
const unhms = t => { const m = String(t || '').match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0 };
const TVS = () => lsGet('nvCinema.tvs', []);
const isSamsung = tv => /samsung/i.test((tv.maker || '') + ' ' + (tv.server || ''));

/* ---------- finding the TVs ---------- */
async function describe(loc, extra){ const r = await NvTvP.get({url:loc, timeout:4000}); if(r.status >= 400) throw new Error('no description');
  const x = new DOMParser().parseFromString(r.text, 'text/xml'), tag = (el, n) => { const e = el.getElementsByTagName(n)[0]; return e ? e.textContent.trim() : '' };
  const base = tag(x, 'URLBase') || loc; let ctl = '';
  for(const sv of x.getElementsByTagName('service')) if(/AVTransport/i.test(tag(sv, 'serviceType'))){ ctl = tag(sv, 'controlURL'); break }
  if(!ctl) return null;
  return {id:tag(x, 'UDN') || loc, name:tag(x, 'friendlyName') || 'TV', maker:tag(x, 'manufacturer'), model:tag(x, 'modelName'), loc, ctl:new URL(ctl, base).href, server:(extra || {}).server || ''} }
async function findTvs(){ const r = await NvTvP.discover({timeout:3500}), out = [];
  for(const d of r.tvs || []){ try{ const tv = await describe(d.location, d); if(tv && !out.some(x => x.id === tv.id)) out.push(tv) }catch(e){ L('tv', 'no description from ' + d.location, e) } }
  if(out.length){ const old = TVS().filter(x => !out.some(y => y.id === x.id)); lsSet('nvCinema.tvs', out.concat(old).slice(0, 12)) }
  L('tv', 'found', out.map(t => t.name + ' · ' + t.maker)); return out }

/* ---------- UPnP commands ---------- */
async function cmd(tv, action, body){ const r = await NvTvP.soap({url:tv.ctl, service:AVT, action, body:'<InstanceID>0</InstanceID>' + (body || '')});
  if(r.status >= 400){ const m = (r.text || '').match(/<errorDescription>([^<]*)/i); throw new Error(`The TV said no to ${action}${m ? ': ' + m[1] : ' (' + r.status + ')'}`) }
  return new DOMParser().parseFromString(r.text || '<x/>', 'text/xml') }
const val = (x, n) => { const e = x.getElementsByTagName(n)[0]; return e ? e.textContent : '' };
function didl(title, url, mime, seek, sub){ const pi = `http-get:*:${mime}:DLNA.ORG_OP=${seek ? '01' : '00'};DLNA.ORG_CI=${seek ? '0' : '1'};DLNA.ORG_FLAGS=01700000000000000000000000000000`;
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">`
    + `<item id="nv1" parentID="0" restricted="1"><dc:title>${xesc(title)}</dc:title><upnp:class>object.item.videoItem.movie</upnp:class><res protocolInfo="${pi}">${xesc(url)}</res>`
    + (sub ? `<res protocolInfo="http-get:*:text/srt:*">${xesc(sub)}</res><sec:CaptionInfoEx sec:type="srt">${xesc(sub)}</sec:CaptionInfoEx><sec:CaptionInfo sec:type="srt">${xesc(sub)}</sec:CaptionInfo>` : '')
    + '</item></DIDL-Lite>' }

/* ---------- the sheet: pick a TV ---------- */
async function tvSheet(f, opts){ opts = opts || {};
  if(!NvTvP){ toast('Play on TV works in the Nightvault Android app (the newest test build)', 4500); return }
  const known = TVS();
  sheet(`<h3>Play on TV</h3><p class="muted small" style="margin:0 0 8px">The TV fetches the film itself in full quality (this is not screen casting). Phone and TV on the same Wi‑Fi.</p>
    <div id="tvl">${known.map((tv, i) => tvRow(tv, i, true)).join('')}</div><div class="prog busy" id="tvbusy"><i></i></div><div class="muted small" id="tvst">Looking for TVs…</div>
    <button class="btn" id="tvagain" style="width:100%;margin-top:8px">Look again</button>`);
  const pick = async tv => { closeSheet(); lsSet('nvCinema.tvLast', tv.id); await tvPlay(f, tv, opts) };
  const hook = list => $('#tvl').querySelectorAll('[data-tv]').forEach(el => el.onclick = () => pick(list[+el.dataset.tv]));
  hook(known);
  const look = async () => { $('#tvbusy').hidden = false; $('#tvst').textContent = 'Looking for TVs…';
    let list = []; try{ list = await findTvs() }catch(e){ LE('tv', 'discover', e) }
    if(!$('#tvl')) return; $('#tvbusy').hidden = true;
    $('#tvl').innerHTML = list.map((tv, i) => tvRow(tv, i)).join('') || known.map((tv, i) => tvRow(tv, i, true)).join('');
    $('#tvst').innerHTML = list.length ? `${plural(list.length, 'TV')} found` : 'No TV answered. Is the TV on (not on standby) and on the same Wi‑Fi? Samsung: Settings › Connection › Device connection manager › Access notification / allow. LG: Settings › Connection › “LG Connect Apps” on.';
    hook(list.length ? list : known) };
  $('#tvagain').onclick = look; look() }
const tvRow = (tv, i, old) => `<div class="li" data-tv="${i}"><span style="width:30px;display:flex;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffb0a8" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg></span><div class="n"><div>${esc(tv.name)}</div><div class="s">${esc([tv.maker, tv.model].filter(Boolean).join(' · '))}${old ? ' · used before' : ''}</div></div></div>`;

/* ---------- start a video on the TV ---------- */
const T = {tv:null, f:null, url:'', off:0, conv:false, seek:true, pos:0, dur:0, state:'', poll:0, src:'', sub:-1, subs:[], startAt:0, errTries:0, shares:[], burn:false};
async function tvSubs(f){ /* the subtitles we can give the TV: the PC's (by id) and the phone's (as text) */
  const l = [];
  if(f.pc && T.src === 'pc'){ try{ const info = await pcInfo(f); for(const s of info.subs || []) l.push({label:s.label, pcid:s.id}) }catch(e){} }
  for(const s of (f.local && f.local.subs) || []) l.push({label:s.label, get:() => fetch(linkUrl(s.uri, s.name)).then(r => r.text())});
  for(const s of f.subs || []) l.push({label:s.label, get:async () => s.kind === 'copy' ? (await dbGet('blobs', s.bid)).blob.text() : fetch(linkUrl(s.uri, s.name)).then(r => r.text())});
  return l }
const toSrt = cues => cues.map((c, i) => `${i + 1}\n${srtT(c.a)} --> ${srtT(c.b)}\n${c.text}\n`).join('\n');
const srtT = t => { const ms = Math.round(Math.max(0, t) * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` };
async function unshareAll(){ for(const t of T.shares) NvTvP.unshare({token:t}).catch(() => {}); T.shares = [] }
async function tvPlay(f, tv, opts){ opts = opts || {};
  const t = TM[f.tid]; if(!t) return; clearInterval(T.poll); await unshareAll();
  /* where the TV fetches it from: the PC at home, else the phone itself */
  const pcHere = f.pc && pcv() >= 2 && await NVPC.reachable() && !NVPC.away, phoneUri = f.local ? f.local.uri : f.src && f.src.kind === 'link' ? f.src.uri : null;
  T.src = pcHere && !opts.phone ? 'pc' : phoneUri ? 'phone' : '';
  if(!T.src){ toast(f.pc ? (NVPC.away ? 'The TV can only get films from your PC at home. Save it to the phone first (⋯ › Save to phone).' : 'Your PC is not reachable (or needs the newest PC app).') : 'Videos copied into the app can’t go to the TV - use a folder on the phone.', 6000); return }
  Object.assign(T, {tv, f, pos:0, dur:0, state:'', errTries:0});
  const w = W(f), from = opts.from != null ? opts.from : (w && !w.done && w.pos > 20 ? Math.max(0, w.pos - 3) : 0);
  T.subs = await tvSubs(f);
  if(opts.sub != null) T.sub = opts.sub;
  else { T.sub = S.subOn ? bestSub(T.subs) : -1 }
  T.burn = opts.burn != null ? opts.burn : !!(lsGet('nvCinema.tvBurn', {})[tv.id]);
  tvRemote(); tvMsg('Starting on ' + tv.name + '…');
  try{ await tvLoad(from, opts.conv) }catch(e){ LE('tv', 'play', e); tvMsg(e.message || String(e), true) } }
/* (re)start the stream: as it is (the TV jumps itself) or converted (a jump = a new stream from that second) */
async function tvLoad(from, forceConv){ const f = T.f, tv = T.tv, t = TM[f.tid], key = await NVPC.key(), s = T.sub >= 0 ? T.subs[T.sub] : null, sam = isSamsung(tv);
  let url, mime, sub = '', seek = true, conv = false;
  if(T.src === 'pc'){ const home = NVPC.home, id = encodeURIComponent(f.pc.id), ext = (f.pc.ext || '').toLowerCase();
    conv = !!forceConv || (s && s.pcid && (!sam || T.burn)) || /^(avi|wmv|flv|divx|ogv|rm|rmvb)$/.test(ext) || lsGet('nvCinema.tvConv', {})[tv.id] === 'always';
    if(conv){ url = `${home}/nv/cin/tvs/${id}/${Math.floor(from)}/0/0/${s && s.pcid ? encodeURIComponent(s.pcid) : '-'}/v.ts?k=${key}`; mime = 'video/mpeg'; seek = false; T.off = Math.floor(from) }
    else { url = `${home}/nv/cin/tv/${id}/${encodeURIComponent(f.pc.name)}?k=${key}${s && s.pcid && sam ? '&cap=' + encodeURIComponent(s.pcid) : ''}`; mime = mimeOf(f.pc.name); T.off = 0;
      if(s && s.pcid && sam) sub = `${home}/nv/cin/tvsub/${id}/${encodeURIComponent(s.pcid)}/0/s.srt?k=${key}` } }
  else { const uri = f.local ? f.local.uri : f.src.uri, name = f.local ? f.local.name : f.src.name; T.off = 0;
    if(s && s.get){ try{ const st = await NvTvP.share({text:toSrt(parseSubs(await s.get())), name:'subtitles.srt', mime:'text/srt'}); T.shares.push(st.token); sub = st.url }catch(e){ LE('tv', 'share sub', e) } }
    if(s && !sam) toast('This TV may not show subtitles from the phone - at home the PC can put them in the picture.', 5000);
    const r = await NvTvP.share({uri, name, mime:mimeOf(name), cap:sub || null}); T.shares.push(r.token); url = r.url; mime = mimeOf(name) }
  Object.assign(T, {url, conv, seek, startAt:Date.now(), dur:T.dur || (f.pc && VINFO[f.pc.id] ? VINFO[f.pc.id].duration : 0) || (W(f) || {}).dur || 0});
  L('tv', 'load', {tv:tv.name, maker:tv.maker, conv, src:T.src, from:Math.round(from), sub:s ? s.label : '', samsungSub:!!sub});
  try{ await cmd(tv, 'Stop') }catch(e){}
  await cmd(tv, 'SetAVTransportURI', `<CurrentURI>${xesc(url)}</CurrentURI><CurrentURIMetaData>${xesc(didl(t.name + (t.kind === 'show' && f.e != null ? ' · ' + epName(t, f) : ''), url, mime, seek, sub))}</CurrentURIMetaData>`);
  await cmd(tv, 'Play', '<Speed>1</Speed>');
  if(seek && from > 5){ for(let i = 0; i < 12; i++){ await sleep(800); try{ const x = await cmd(tv, 'GetTransportInfo'); if(val(x, 'CurrentTransportState') === 'PLAYING') break }catch(e){} }
    try{ await cmd(tv, 'Seek', `<Unit>REL_TIME</Unit><Target>${hms(from)}</Target>`) }catch(e){ L('tv', 'seek after start failed', e.message) } }
  T.pos = from; clearInterval(T.poll); T.poll = setInterval(tvPoll, 2000); tvDraw() }
const mimeOf = n => ({mkv:'video/x-matroska', mp4:'video/mp4', m4v:'video/mp4', mov:'video/quicktime', avi:'video/x-msvideo', webm:'video/webm', ts:'video/mp2t', m2ts:'video/mp2t', wmv:'video/x-ms-wmv'})[(String(n).split('.').pop() || '').toLowerCase()] || 'video/mp4';
async function tvPoll(){ if(!T.tv) return; let st = '', status = '';
  try{ const x = await cmd(T.tv, 'GetTransportInfo'); st = val(x, 'CurrentTransportState'); status = val(x, 'CurrentTransportStatus');
    const p = await cmd(T.tv, 'GetPositionInfo'), rel = unhms(val(p, 'RelTime')), d = unhms(val(p, 'TrackDuration'));
    if(st === 'PLAYING' || st === 'PAUSED_PLAYBACK') T.pos = T.off + rel; if(d && !T.conv) T.dur = d }
  catch(e){ T.state = 'gone'; tvDraw(); return }
  const was = T.state; T.state = st;
  /* the TV could not play it as it is: let the PC convert it (once) */
  if((status === 'ERROR_OCCURRED' || (st === 'STOPPED' && was !== 'PLAYING' && Date.now() - T.startAt > 12000 && T.pos < 2)) && T.src === 'pc' && !T.conv && T.errTries++ < 1){
    toast('The TV could not play it as it is - the PC converts it now', 5000); L('tv', 'TV refused the file, converting', {status}); return tvLoad(T.pos || 0, true) }
  if(T.dur && T.pos > 5) setWatch(T.f, T.pos, T.dur, false, Date.now() - (T.lastPc || 0) < 15000).then(() => {}); if(Date.now() - (T.lastPc || 0) > 15000) T.lastPc = Date.now();
  /* the end */
  if(st === 'STOPPED' && was === 'PLAYING' && T.dur && T.pos > T.dur * 0.9){ clearInterval(T.poll); await setWatch(T.f, 0, T.dur, true); const n = nextFile(T.f);
    if(n && S.autoNext){ tvMsg('Next episode in 8 s…'); setTimeout(() => { if(T.f && T.state === 'STOPPED') tvPlay(n, T.tv, {from:0}) }, 8000) } else tvMsg('The end') }
  tvDraw() }
async function tvSeek(to){ to = Math.max(0, T.dur ? Math.min(T.dur - 5, to) : to); T.pos = to; tvDraw();
  try{ if(T.conv) await tvLoad(to); else await cmd(T.tv, 'Seek', `<Unit>REL_TIME</Unit><Target>${hms(to)}</Target>`) }catch(e){ toast(e.message, 4000) } }
async function tvStop(){ clearInterval(T.poll); if(T.tv) try{ await cmd(T.tv, 'Stop') }catch(e){} if(T.f && T.dur && T.pos > 5) await setWatch(T.f, T.pos, T.dur, T.pos > T.dur * 0.92);
  await unshareAll(); T.tv = null; T.f = null; tvClose(); draw() }

/* ---------- the remote (on the phone) ---------- */
function tvRemote(){ let el = $('#tvr'); if(!el){ el = document.createElement('div'); el.id = 'tvr'; document.body.appendChild(el) } el.hidden = false; tvDraw() }
function tvClose(){ const el = $('#tvr'); if(el) el.remove(); const m = $('#tvmini'); if(m) m.remove() }
function tvMsg(m, bad){ T.msg = m; T.bad = !!bad; tvDraw() }
function tvDraw(){ const el = $('#tvr'); tvMini(); if(!el || el.hidden || !T.f) return; const f = T.f, t = TM[f.tid], s = T.sub >= 0 ? T.subs[T.sub] : null, p = T.dur ? Math.min(1000, Math.round(1000 * T.pos / T.dur)) : 0;
  const stTxt = {PLAYING:'Playing', PAUSED_PLAYBACK:'Paused', STOPPED:'Stopped', TRANSITIONING:'Starting…', NO_MEDIA_PRESENT:'Waiting…', gone:'The TV does not answer'}[T.state] || T.msg || 'Starting…';
  el.innerHTML = `<div class="tvbg" style="${t.backdrop ? `background-image:url('${esc(IMG(t.backdrop, 'w780'))}')` : ''}"></div><div class="tvin">
    <div class="top"><button class="ib" id="tvhide" aria-label="Back to Cinema">${IC.back}</button><h1 style="font-size:17px">📺 ${esc(T.tv.name)}</h1></div>
    <div style="display:flex;gap:14px;align-items:flex-end;margin:10px 0 14px"><div style="width:96px;flex:none">${coverHTML(t)}</div><div style="min-width:0"><b style="font-size:18px">${esc(t.name)}</b><div class="muted small">${esc(t.kind === 'show' ? fileLabel(t, f) : t.year || '')}</div>
      <div class="small" style="margin-top:6px;color:${T.bad ? 'var(--red)' : 'var(--accent)'}">${esc(T.bad ? T.msg : stTxt)}${T.conv ? ' · converted by the PC' : ''}${T.src === 'phone' ? ' · from this phone' : ''}</div></div></div>
    <div class="row" style="display:flex;align-items:center;gap:8px"><span class="time">${tfmt(T.pos)}</span><input type="range" id="tvseek" min="0" max="1000" value="${p}" style="flex:1"><span class="time">${T.dur ? tfmt(T.dur) : '--:--'}</span></div>
    <div style="display:flex;justify-content:center;gap:18px;margin:16px 0"><button class="ib tvb" id="tvrw">−30</button><button class="ib tvb big" id="tvpp">${T.state === 'PLAYING' ? IC.pause : IC.play}</button><button class="ib tvb" id="tvff">+30</button></div>
    <div class="mlist"><button class="btn" id="tvsub">Subtitles: ${esc(s ? prettySub(s.label) : 'off')}${s && T.src === 'pc' && (T.burn || !isSamsung(T.tv)) ? ' (in the picture)' : ''}</button>
      ${nextFile(f) ? '<button class="btn" id="tvnext">Next episode</button>' : ''}${T.src === 'pc' ? `<button class="btn" id="tvconv">${T.conv ? 'Play the file as it is' : 'Let the PC convert it (if the TV has trouble)'}</button>` : ''}
      <button class="btn danger" id="tvstop">Stop on the TV</button></div>
    <p class="muted small" style="margin-top:10px">Volume: the TV’s own remote. You can lock the phone - the TV keeps playing.</p></div>`;
  lazyCovers(el);
  $('#tvhide').onclick = () => { el.hidden = true; tvMini() };
  $('#tvpp').onclick = async () => { try{ if(T.state === 'PLAYING'){ await cmd(T.tv, 'Pause'); T.state = 'PAUSED_PLAYBACK' } else { await cmd(T.tv, 'Play', '<Speed>1</Speed>'); T.state = 'PLAYING' } tvDraw() }catch(e){ toast(e.message, 4000) } };
  $('#tvrw').onclick = () => tvSeek(T.pos - 30); $('#tvff').onclick = () => tvSeek(T.pos + 30);
  $('#tvseek').onchange = e => { if(T.dur) tvSeek(T.dur * e.target.value / 1000) };
  $('#tvstop').onclick = () => tvStop();
  if($('#tvnext')) $('#tvnext').onclick = async () => { const n = nextFile(f); if(T.dur) await setWatch(f, 0, T.dur, true); tvPlay(n, T.tv, {from:0}) };
  if($('#tvconv')) $('#tvconv').onclick = () => { const all = lsGet('nvCinema.tvConv', {}); if(T.conv) delete all[T.tv.id]; else all[T.tv.id] = 'always'; lsSet('nvCinema.tvConv', all); tvLoad(T.pos, !T.conv) };
  $('#tvsub').onclick = () => tvSubMenu() }
function tvSubMenu(){ const sam = isSamsung(T.tv);
  sheet(`<h3>Subtitles on the TV</h3><div class="mlist"><button class="btn ${T.sub < 0 ? 'primary' : ''}" data-ts="-1">Off</button>${T.subs.map((s, i) => `<button class="btn ${T.sub === i ? 'primary' : ''}" data-ts="${i}">${esc(prettySub(s.label))}</button>`).join('')}</div>
    ${T.src === 'pc' && sam ? `<div class="opt" style="margin-top:8px"><label for="tsburn">Put them in the picture (when the TV doesn’t show them)</label><input type="checkbox" id="tsburn" ${T.burn ? 'checked' : ''}></div>` : ''}
    <p class="muted small" style="margin:8px 0 0">${T.src === 'pc' ? (sam ? 'Samsung TVs show the subtitle file themselves.' : 'The PC puts them into the picture - changing restarts the film at the same moment.') : 'From the phone: Samsung TVs show them; other TVs can’t.'}${T.subs.length ? '' : ' No subtitles yet - start the film on the phone once to find them online.'}</p>`);
  $('.sheet').querySelectorAll('[data-ts]').forEach(b => b.onclick = () => { T.sub = +b.dataset.ts; if(T.sub >= 0){ S.subOn = true; S.subLabel = T.subs[T.sub].label } else S.subOn = false; saveS(); closeSheet(); tvLoad(T.pos) });
  if($('#tsburn')) $('#tsburn').onchange = e => { T.burn = e.target.checked; const all = lsGet('nvCinema.tvBurn', {}); if(T.burn) all[T.tv.id] = 1; else delete all[T.tv.id]; lsSet('nvCinema.tvBurn', all); closeSheet(); tvLoad(T.pos) } }
/* a small bar at the bottom while something plays on the TV and the remote is hidden */
function tvMini(){ let m = $('#tvmini'); const r = $('#tvr');
  if(!T.f || (r && !r.hidden)){ if(m) m.remove(); return }
  if(!m){ m = document.createElement('div'); m.id = 'tvmini'; document.body.appendChild(m); m.onclick = () => { const x = $('#tvr'); if(x){ x.hidden = false; tvDraw() } else tvRemote() } }
  const t = TM[T.f.tid]; m.innerHTML = `📺 <b style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t ? t.name : '')}</b><span class="small">${tfmt(T.pos)}</span>` }
window.NVTV = {T, findTvs, tvPlay, tvSheet, tvStop, didl};   // for testing
