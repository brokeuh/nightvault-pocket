/* Nightvault Cinema – COMING SOON: the calendar (22 October 2026). Plan: plans/cinema.md "calendar of upcoming films and episodes".
   From TMDB with the owner's key (on the phone, no PC needed), refreshed at most twice a day:
   - shows you have (or want to see): the next episodes and seasons (/tv/{id}, /tv/{id}/season/{n})
   - your film series: the next film (/collection/{id}) that is not in Cinema yet
   - "want to see": films / shows without a video yet, with their release dates
   - films: Belgian dates (else Dutch, else the first date): in cinemas, streaming / buy, DVD & Blu-ray (/movie/{id}/release_dates),
     and where to watch in Belgium (/{type}/{id}/watch/providers – data by JustWatch, names only, no logos)
   Views: a list by week and a month grid. Reminders on the day (Android: @capacitor/local-notifications). NEW EP marks on show tiles.
   Uses app.js's globals (same page). */
'use strict';
const CALC = {};                         // title id -> {at, events:[…], prov, status, lastAired}
const CALX = {};                         // other films of a series (not in Cinema) -> release info, by TMDB id
let CALBUSY = false;
const LN = NATIVE && window.Capacitor && Capacitor.isPluginAvailable && Capacitor.isPluginAvailable('LocalNotifications') ? Capacitor.registerPlugin('LocalNotifications') : null;
const pad2 = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dparse = k => { const [y, m, d] = String(k).slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) };
const todayKey = () => dkey(new Date());
const daysFrom = k => Math.round((dparse(k) - dparse(todayKey())) / 864e5);
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dshort = k => { const d = dparse(k); return `${DAYN[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}` };
const WHERE = {cinema:'In cinemas', digital:'Streaming & buy', physical:'DVD & Blu-ray', premiere:'Premiere', tv:'On TV', release:'Release'};

/* ---------- release dates for Belgium (else the Netherlands, else the first date) ---------- */
async function releaseInfo(mid){ const c = CALX[mid]; if(c && Date.now() - c.at < 20 * 3600e3) return c;
  const r = await tmdb(`/movie/${mid}/release_dates`), all = r.results || [];
  const pick = all.find(x => x.iso_3166_1 === 'BE') || all.find(x => x.iso_3166_1 === 'NL');
  const out = []; const T = {1:'premiere', 2:'cinema', 3:'cinema', 4:'digital', 5:'physical', 6:'tv'};
  for(const x of (pick || {}).release_dates || []){ const w = T[x.type]; if(!w || w === 'premiere') continue; const k = x.release_date.slice(0, 10); if(!out.some(y => y.where === w)) out.push({where:w, date:k}) }
  if(!out.length){ /* no Belgian/Dutch dates: the earliest date anywhere */
    let best = null; for(const c2 of all) for(const x of c2.release_dates || []) if([2, 3, 4].includes(x.type) && (!best || x.release_date < best.release_date)) best = x;
    if(best) out.push({where:best.type === 4 ? 'digital' : 'cinema', date:best.release_date.slice(0, 10), country:''}) }
  return CALX[mid] = {at:Date.now(), dates:out, country:pick ? pick.iso_3166_1 : ''} }
async function providers(type, id){ try{ const r = await tmdb(`/${type}/${id}/watch/providers`), be = (r.results || {}).BE; if(!be) return null;
  const names = l => (l || []).map(x => x.provider_name).filter((x, i, a) => a.indexOf(x) === i);
  return {stream:names(be.flatrate), rent:names(be.rent), buy:names(be.buy), link:be.link || ''} }catch(e){ return null } }

/* ---------- what is coming for one title ---------- */
async function calFetch(t){ const id = t.tmdb.id, events = [], from = dkey(new Date(Date.now() - 21 * 864e5)), until = dkey(new Date(Date.now() + 400 * 864e5)), out = {at:Date.now(), events, prov:null, status:'', lastAired:''};
  if(t.tmdb.type === 'tv'){ const d = await tmdb(`/tv/${id}`); out.status = d.status || ''; out.lastAired = (d.last_episode_to_air || {}).air_date || '';
    const seasons = [...new Set([d.next_episode_to_air && d.next_episode_to_air.season_number, d.last_episode_to_air && d.last_episode_to_air.season_number].filter(x => x != null))];
    for(const n of seasons){ let sd; try{ sd = await tmdb(`/tv/${id}/season/${n}`) }catch(e){ continue }
      for(const e of sd.episodes || []) if(e.air_date && e.air_date >= from && e.air_date <= until)
        events.push({id:`ep:${t.id}:${n}:${e.episode_number}`, date:e.air_date, kind:'ep', tid:t.id, s:n, e:e.episode_number, label:e.name || '', still:e.still_path || '', poster:t.poster}) }
    if(d.next_episode_to_air && !events.some(e => e.s === d.next_episode_to_air.season_number && e.e === d.next_episode_to_air.episode_number)){ const n = d.next_episode_to_air;
      if(n.air_date) events.push({id:`ep:${t.id}:${n.season_number}:${n.episode_number}`, date:n.air_date, kind:'ep', tid:t.id, s:n.season_number, e:n.episode_number, label:n.name || '', poster:t.poster}) }
    if(isWant(t)) out.prov = await providers('tv', id) }
  else {
    if(isWant(t) || !filesOf(t).length){ const r = await releaseInfo(id); for(const x of r.dates) if(x.date >= from && x.date <= until) events.push({id:`film:${id}:${x.where}`, date:x.date, kind:'film', tid:t.id, where:x.where, country:r.country, poster:t.poster});
      out.prov = await providers('movie', id) }
    /* the next film of the series */
    if(t.collId == null){ try{ const d = await tmdb(`/movie/${id}`); t.collId = d.belongs_to_collection ? d.belongs_to_collection.id : 0; await dbPut('titles', t) }catch(e){} }
    if(t.collId){ let c; try{ c = await tmdb(`/collection/${t.collId}`) }catch(e){ c = null }
      for(const p of (c && c.parts) || []){ if(TITLES.some(x => x.tmdb && x.tmdb.type === 'movie' && +x.tmdb.id === +p.id)) continue;
        if(p.release_date && p.release_date < from) continue;
        let dates = []; try{ dates = (await releaseInfo(p.id)).dates }catch(e){}
        if(!dates.length && p.release_date) dates = [{where:'release', date:p.release_date}];
        if(!dates.length) events.push({id:`saga:${p.id}:soon`, date:'', kind:'saga', mid:p.id, label:p.title, poster:p.poster_path || '', saga:sagaName(c.name), from:t.id});
        for(const x of dates) if(x.date >= from && x.date <= until) events.push({id:`saga:${p.id}:${x.where}`, date:x.date, kind:'saga', mid:p.id, where:x.where, label:p.title, poster:p.poster_path || '', saga:sagaName(c.name), from:t.id}) } } }
  return out }
/* which titles to look at: shows (not ended - those are looked at once a week), films of a series, want-to-see */
function calWanted(t){ if(!t.tmdb) return false; const c = CALC[t.id];
  if(isWant(t)) return true;
  if(t.tmdb.type === 'tv') return !c || !/ended|canceled/i.test(c.status || '') || Date.now() - c.at > 7 * 864e5;
  return !!(t.collId || t.collId == null) }
async function refreshCal(force, only){ if(CALBUSY || !TKEY()) return; CALBUSY = true; let n = 0;
  try{ const list = only ? [only] : TITLES.filter(calWanted), seenColl = new Set();
    for(const t of list){ const c = CALC[t.id]; if(!force && c && Date.now() - c.at < 12 * 3600e3) continue;
      if(t.tmdb.type === 'movie' && t.collId && !isWant(t)){ if(seenColl.has(t.collId) && c){ continue } seenColl.add(t.collId) }
      try{ const r = await calFetch(t); CALC[t.id] = r; await kvSet('cal:' + t.id, r); n++ }catch(e){ LE('cal', 'fetch ' + t.name, e); if(/key|internet/i.test(e.message)) break }
      if(n % 8 === 0 && cur().v === 'cal') drawCal() }
    lsSet('nvCinema.calAt', Date.now()) }
  finally{ CALBUSY = false }
  L('cal', 'refreshed', {titles:n}); await scheduleReminders().catch(e => LE('cal', 'reminders', e));
  if(cur().v === 'cal' || cur().v === 'shelves') draw() }
/* all events, newest information, no doubles (two films of the same series give the same next film) */
function calEvents(){ const out = new Map();
  for(const [tid, c] of Object.entries(CALC)){ if(!TM[tid]) continue; for(const e of c.events || []) if(!out.has(e.id)) out.set(e.id, e) }
  return [...out.values()].filter(e => e.kind !== 'saga' || !TITLES.some(x => x.tmdb && +x.tmdb.id === +e.mid && x.tmdb.type === 'movie')).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || evTitle(a).localeCompare(evTitle(b))) }
const evTitle = e => e.kind === 'saga' ? e.label : (TM[e.tid] || {}).name || '';
function evSub(e){ const t = TM[e.tid];
  if(e.kind === 'ep') return `S${e.s}·E${e.e}${e.label && !/^episode \d+$/i.test(e.label) ? ' · ' + e.label : ''}${e.e === 1 ? ' · new season' : ''}`;
  const w = WHERE[e.where] || ''; if(e.kind === 'saga') return `Next in ${e.saga || 'the series'}${w ? ' · ' + w : ''}`;
  return w + (e.country && e.country !== 'BE' ? ' (NL)' : '') + (t && isWant(t) ? ' · want to see' : '') }
/* NEW EP on a show tile: an episode aired in the last 30 days, after you last watched it (and after you added it) */
window.calIsNew = t => { const c = CALC[t.id]; if(!c || !c.lastAired || t.kind !== 'show' || isWant(t)) return false; const d = daysFrom(c.lastAired);
  return d <= 0 && d > -30 && dparse(c.lastAired).getTime() + 864e5 > Math.max(lastAt(t), t.added || 0) };

/* ---------- reminders on the day (Android) ---------- */
const RKEY = 'nvCinema.remIds';
async function scheduleReminders(){ if(!LN) return;
  try{ const old = lsGet(RKEY, []); if(old.length) await LN.cancel({notifications:old.map(id => ({id}))}) }catch(e){}
  lsSet(RKEY, []); if(!S.remind) return;
  let perm; try{ perm = await LN.checkPermissions() }catch(e){ return } if(perm.display !== 'granted') return;
  const mute = lsGet('nvCinema.calMute', {}), [hh, mm] = String(S.remindAt || '09:00').split(':').map(Number), now = Date.now(), ids = [], list = [];
  for(const e of calEvents()){ if(!e.date || mute[e.tid || e.from] || (e.kind === 'film' && !isWant(TM[e.tid] || {}))) continue;
    const at = dparse(e.date); at.setHours(hh || 0, mm || 0, 0, 0); if(at.getTime() < now || at.getTime() > now + 60 * 864e5) continue;
    const id = (hashNum(e.id) % 2000000000) + 1; ids.push(id);
    const name = evTitle(e), title = e.kind === 'ep' ? `New episode today: ${name}` : e.kind === 'saga' ? `${WHERE[e.where] || 'Out'} today: ${name}` : `${WHERE[e.where] || 'Out'} today: ${name}`;
    list.push({id, title, body:evSub(e), schedule:{at, allowWhileIdle:true}, extra:{app:'cinema', url:'cinema/index.html?nv=hub&' + (e.tid ? 'title=' + e.tid : 'view=cal')}});
    if(list.length >= 60) break }
  if(list.length) await LN.schedule({notifications:list}); lsSet(RKEY, ids); L('cal', 'reminders', {n:list.length}) }
const hashNum = s => { let h = 7; for(const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h };
async function askReminders(){ if(!LN) return false; try{ let p = await LN.checkPermissions(); if(p.display !== 'granted') p = await LN.requestPermissions(); return p.display === 'granted' }catch(e){ return false } }

/* ---------- the start page: "Coming soon" ---------- */
window.calTeaserHTML = () => { const ev = TKEY() ? calEvents().filter(e => e.date && daysFrom(e.date) >= 0 && daysFrom(e.date) <= 45).slice(0, 8) : [];
  if(!TKEY()) return `<div class="sec" style="display:flex;align-items:center">Coming soon<span style="flex:1"></span><span class="lnk" data-cal="1" style="text-transform:none;letter-spacing:0;font-weight:600">Calendar ›</span></div><p class="muted small" style="margin:0 0 8px">New episodes, the next film of your series and your want-to-see list - <span class="lnk" data-cal="1">add your free TMDB key</span> to see them.</p>`;
  if(!ev.length && !Object.keys(CALC).length) return `<div class="sec" style="display:flex;align-items:center">Coming soon<span style="flex:1"></span><span class="lnk" data-cal="1" style="text-transform:none;letter-spacing:0;font-weight:600">Calendar ›</span></div><p class="muted small" style="margin:0 0 8px">${CALBUSY ? 'Looking up what is coming…' : '<span class="lnk" data-cal="1">Open the calendar</span> to look up what is coming.'}</p>`;
  return `<div class="sec" style="display:flex;align-items:center">Coming soon<span style="flex:1"></span><span class="lnk" data-cal="1" style="text-transform:none;letter-spacing:0;font-weight:600">Calendar ›</span></div>
    ${ev.length ? `<div class="cont">${ev.map(e => `<div class="cw calw" data-calev="${esc(e.id)}"><div class="pic"><div class="cv" style="position:absolute;inset:0;aspect-ratio:auto;border-radius:0">${phHTML({name:evTitle(e), kind:e.kind === 'ep' ? 'show' : 'movie'})}</div>${evImg(e, 'w300')}<span class="when">${daysFrom(e.date) === 0 ? 'Today' : daysFrom(e.date) === 1 ? 'Tomorrow' : dshort(e.date)}</span></div><div class="t">${esc(evTitle(e))}</div><div class="a">${esc(evSub(e))}</div></div>`).join('')}</div>` : '<p class="muted small" style="margin:0 0 8px">Nothing announced in the next weeks. <span class="lnk" data-cal="1">Open the calendar</span></p>'}` };
const evImg = (e, w) => { const p = e.still || e.poster || ((TM[e.tid] || {}).backdrop) || ''; return p ? `<img src="${esc(IMG(p, w || 'w185'))}" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : '' };
document.getElementById('body').addEventListener('click', e => { if(cur().v !== 'shelves') return; const c = e.target.closest('[data-cal]'), ev = e.target.closest('[data-calev]');
  if(c){ e.stopPropagation(); go({v:'cal'}); return }
  if(ev){ e.stopPropagation(); openEvent(calEvents().find(x => x.id === ev.dataset.calev)) } }, true);
function openEvent(e){ if(!e) return; if(e.tid && TM[e.tid]) return go({v:'title', id:e.tid, shelf:TM[e.tid].shelf}); if(e.kind === 'saga') return sagaSheet(e) }

/* ---------- the calendar page: a list by week, or a month ---------- */
const CF = [['all', 'All'], ['ep', 'Episodes'], ['film', 'Films'], ['want', 'Want to see']];
function calPass(e, f){ if(f === 'all') return true; if(f === 'ep') return e.kind === 'ep'; if(f === 'film') return e.kind !== 'ep'; const t = TM[e.tid]; return !!(t && isWant(t)) }
function drawCal(){ const body = $('#body'); $('#vtitle').textContent = 'Coming soon'; document.title = 'Coming soon · Cinema';
  if(TKEY() && !CALBUSY && Date.now() - lsGet('nvCinema.calAt', 0) > 12 * 3600e3) setTimeout(() => refreshCal(false), 50);
  if(!TKEY()){ body.innerHTML = `<div class="empty">${shelfIcon({s:'#ffb0a8', icon:'cal'}, 48)}<h2 style="margin:8px 0 4px;font-size:18px">The calendar needs TMDB</h2><p class="muted small">Add your free TMDB key first (⚙ → TMDB) - it knows when episodes air and films come out.</p><button class="btn primary" id="caltm">Add the TMDB key</button></div>`; $('#caltm').onclick = () => tmdbSheet(); return }
  const f = S.calFilter || 'all', view = S.calView || 'list', all = calEvents().filter(e => calPass(e, f));
  let h = `<div class="chips">${CF.map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-cf="${k}">${t}</button>`).join('')}</div>
    <div class="mbar"><select id="calview"><option value="list" ${view === 'list' ? 'selected' : ''}>List by week</option><option value="month" ${view === 'month' ? 'selected' : ''}>Month</option></select><span style="flex:1"></span><button class="btn sm" id="calref">${CALBUSY ? 'Looking…' : '↻ Look again'}</button><button class="btn sm primary" id="calwant">♥ Want to see…</button></div>`;
  h += view === 'month' ? monthHTML(all) : listHTML(all);
  h += `<p class="muted small" style="margin-top:14px">Dates for Belgium (else the Netherlands) from TMDB${lsGet('nvCinema.calAt', 0) ? ' · looked ' + new Date(lsGet('nvCinema.calAt', 0)).toLocaleString() : ''}. Where to watch: JustWatch. ${S.remind ? (LN ? `Reminders on the day at ${esc(S.remindAt || '09:00')} (⚙).` : 'Reminders work in the Android app.') : 'Reminders are off (⚙).'}</p>`;
  body.innerHTML = h; lazyCovers(body);
  body.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => { S.calFilter = b.dataset.cf; saveS(); drawCal() });
  $('#calview').onchange = e => { S.calView = e.target.value; saveS(); drawCal() };
  $('#calref').onclick = () => { toast('Looking for new dates…'); refreshCal(true) };
  $('#calwant').onclick = () => wantSheet();
  body.querySelectorAll('[data-calev]').forEach(el => el.onclick = e => { const b = e.target.closest('[data-bell]'); const ev = calEvents().find(x => x.id === el.dataset.calev); if(b) return toggleMute(ev); openEvent(ev) });
  body.querySelectorAll('[data-mday]').forEach(el => el.onclick = () => { S.calDay = el.dataset.mday; drawCal() });
  if($('#mprev')) $('#mprev').onclick = () => { S.calMonth = shiftMonth(-1); S.calDay = ''; drawCal() };
  if($('#mnext')) $('#mnext').onclick = () => { S.calMonth = shiftMonth(1); S.calDay = ''; drawCal() };
  if(S.remind && LN && !lsGet('nvCinema.remAsked', 0)){ lsSet('nvCinema.remAsked', 1); askReminders().then(ok => ok && scheduleReminders()) } }
function evRow(e){ const t = TM[e.tid], mute = lsGet('nvCinema.calMute', {})[e.tid || e.from], d = e.date ? daysFrom(e.date) : null;
  return `<div class="li calrow" data-calev="${esc(e.id)}"><span class="th" style="width:44px"><div class="cv">${phHTML({name:evTitle(e), kind:e.kind === 'ep' ? 'show' : 'movie'})}${e.poster || (t && t.poster) ? `<img class="f" src="${esc(IMG(e.poster || t.poster, 'w92'))}" alt="" onerror="this.remove()" style="object-fit:cover">` : ''}</div></span>
    <div class="n"><div>${esc(evTitle(e))}</div><div class="s">${esc(evSub(e))}</div></div>
    <div class="r" style="text-align:right"><div style="color:${d === 0 ? 'var(--accent)' : 'inherit'}">${e.date ? (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : dshort(e.date)) : 'Date not known'}</div>${e.date && d >= 0 && S.remind ? `<span data-bell="1" style="font-size:15px;opacity:${mute ? .35 : 1}" title="Reminder">${mute ? '🔕' : '🔔'}</span>` : ''}</div></div>` }
function listHTML(all){ if(!all.length) return `<p class="muted" style="text-align:center;margin-top:30px">${CALBUSY ? 'Looking for dates…' : Object.keys(CALC).length ? 'Nothing announced yet.' : 'Tap ↻ Look again.'}<br><span class="small">Add films and shows you want to see with ♥ Want to see.</span></p>`;
  const now = new Date(), dow = (now.getDay() + 6) % 7, toEndWeek = 6 - dow, groups = [];
  const add = (name, l) => { if(l.length) groups.push(`<div class="sec">${name}</div><div class="mlist" style="gap:0">${l.map(evRow).join('')}</div>`) };
  const past = all.filter(e => e.date && daysFrom(e.date) < 0).reverse(), dated = all.filter(e => e.date && daysFrom(e.date) >= 0), undated = all.filter(e => !e.date);
  add('Today', dated.filter(e => daysFrom(e.date) === 0));
  add('This week', dated.filter(e => daysFrom(e.date) > 0 && daysFrom(e.date) <= toEndWeek));
  add('Next week', dated.filter(e => daysFrom(e.date) > toEndWeek && daysFrom(e.date) <= toEndWeek + 7));
  const later = dated.filter(e => daysFrom(e.date) > toEndWeek + 7), months = [...new Set(later.map(e => e.date.slice(0, 7)))];
  for(const m of months) add(`${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4) !== String(now.getFullYear()) ? m.slice(0, 4) : ''}`.trim(), later.filter(e => e.date.startsWith(m)));
  add('Announced, no date yet', undated); add('Out recently', past);
  return groups.join('') }
const shiftMonth = n => { const [y, m] = (S.calMonth || todayKey().slice(0, 7)).split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` };
function monthHTML(all){ const ym = S.calMonth || todayKey().slice(0, 7), [y, m] = ym.split('-').map(Number), first = new Date(y, m - 1, 1), start = (first.getDay() + 6) % 7, days = new Date(y, m, 0).getDate(), tk = todayKey();
  const by = {}; for(const e of all) if(e.date && e.date.startsWith(ym)) (by[e.date] = by[e.date] || []).push(e);
  let g = `<div class="mbar" style="justify-content:center"><button class="ib" id="mprev" aria-label="Month before">‹</button><b style="min-width:150px;text-align:center">${MON[m - 1]} ${y}</b><button class="ib" id="mnext" aria-label="Next month">›</button></div>
    <div class="mgrid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="mh">${d}</div>`).join('')}${'<div></div>'.repeat(start)}`;
  for(let d = 1; d <= days; d++){ const k = `${ym}-${pad2(d)}`, l = by[k] || [];
    g += `<div class="md${k === tk ? ' today' : ''}${S.calDay === k ? ' sel' : ''}${l.length ? ' has' : ''}" data-mday="${k}"><span>${d}</span>${l.slice(0, 2).map(e => `<i class="${e.kind}">${esc(evTitle(e).slice(0, 14))}</i>`).join('')}${l.length > 2 ? `<i class="more">+${l.length - 2}</i>` : ''}</div>` }
  g += '</div>';
  const day = S.calDay && S.calDay.startsWith(ym) ? S.calDay : null, list = day ? by[day] || [] : Object.values(by).flat();
  g += `<div class="sec">${day ? dshort(day) : MON[m - 1]}</div>${list.length ? `<div class="mlist" style="gap:0">${list.map(evRow).join('')}</div>` : '<p class="muted small">Nothing on this day.</p>'}`;
  return g }
function toggleMute(e){ const k = e.tid || e.from, all = lsGet('nvCinema.calMute', {}); if(all[k]) delete all[k]; else all[k] = 1; lsSet('nvCinema.calMute', all); scheduleReminders(); drawCal(); toast(all[k] ? 'No reminders for this one' : 'Reminder on the day') }
/* a film of your series that is not in Cinema: its dates + put it on "want to see" */
async function sagaSheet(e){ let info = null; try{ info = await releaseInfo(e.mid) }catch(x){}
  sheet(`<h3>${esc(e.label)}</h3><p class="muted small" style="margin:0 0 8px">Next in ${esc(e.saga || 'the series')}</p>
    <div class="facts">${((info || {}).dates || []).map(x => `<span>${esc(WHERE[x.where] || x.where)}</span><span>${esc(dshort(x.date))} ${x.date.slice(0, 4)}</span>`).join('') || '<span>Date</span><span>not known yet</span>'}</div>
    <div class="mlist"><button class="btn primary" id="sgw">♥ Put on my want-to-see list</button></div>`);
  $('#sgw').onclick = async () => { const t = await addWant({type:'movie', id:e.mid, title:e.label, poster:e.poster}); closeSheet(); if(t) go({v:'title', id:t.id, shelf:t.shelf}) } }

/* ---------- want to see: search TMDB (films and shows) ---------- */
function wantSheet(){
  sheet(`<h3>♥ Want to see</h3><div style="display:flex;gap:8px"><input type="search" id="wq" placeholder="Film or TV show" enterkeyhint="search"><button class="btn primary" id="wgo">Search</button></div><div id="wres" style="margin-top:8px"></div>`, true);
  const run = async () => { const q = $('#wq').value.trim(), el = $('#wres'); if(!q) return; el.innerHTML = '<div class="prog busy"><i></i></div>'; let r;
    try{ r = await tmdb('/search/multi', {query:q}) }catch(e){ el.innerHTML = `<p class="note bad">${esc(e.message)}</p>`; return }
    const res = (r.results || []).filter(x => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 20);
    el.innerHTML = res.map((x, i) => { const have = TITLES.find(t => t.tmdb && t.tmdb.type === x.media_type && +t.tmdb.id === x.id);
      return `<div class="li" data-wr="${i}"><span class="th"><div class="cv">${x.poster_path ? `<img class="f" src="${esc(IMG(x.poster_path, 'w92'))}" alt="" style="object-fit:cover">` : phHTML({name:x.title || x.name, kind:x.media_type === 'tv' ? 'show' : 'movie'})}</div></span><div class="n"><div>${esc(x.title || x.name)}</div><div class="s">${esc([x.media_type === 'tv' ? 'TV show' : 'Film', (x.release_date || x.first_air_date || '').slice(0, 4) || 'no date yet', have ? (isWant(have) ? 'already on your list' : 'already in Cinema') : ''].filter(Boolean).join(' · '))}</div></div></div>` }).join('') || '<p class="muted small">Nothing found.</p>';
    el.onclick = async e => { const row = e.target.closest('[data-wr]'); if(!row) return; const x = res[+row.dataset.wr];
      const t = await addWant({type:x.media_type, id:x.id, title:x.title || x.name, year:+(String(x.release_date || x.first_air_date || '').slice(0, 4)) || null, genres:x.genre_ids || [], lang:x.original_language || ''}); if(t){ closeSheet(); go({v:'title', id:t.id, shelf:t.shelf}) } } };
  $('#wgo').onclick = run; $('#wq').onkeydown = e => { if(e.key === 'Enter') run() }; setTimeout(() => $('#wq') && $('#wq').focus(), 50) }
async function addWant(x){ const have = TITLES.find(t => t.tmdb && t.tmdb.type === x.type && +t.tmdb.id === +x.id); if(have){ toast(isWant(have) ? 'Already on your want-to-see list' : 'Already in Cinema'); return have }
  const kind = x.type === 'tv' ? 'show' : 'movie', anim = (x.genres || []).includes(16);
  const shelf = anim && x.lang === 'ja' ? 'anime' : anim ? 'cartoons' : kind === 'show' ? 'tv' : 'movies';
  const t = newTitle({kind, name:x.title, year:x.year || null}, shelf); t.want = true;
  try{ await applyTm(t, Object.assign({type:x.type, id:x.id, title:x.title, year:x.year, poster:x.poster || '', backdrop:'', overview:'', orig:''}), true) }catch(e){}
  await saveTitle(t); regroup(); toast(`♥ ${t.name} is on your want-to-see list`);
  refreshCal(true, t).catch(() => {}); return t }

/* ---------- the title page: what is coming for this title + where to watch ---------- */
window.calTitle = async t => { const el = $('#tcal'); if(!el || !t.tmdb || !TKEY()) return;
  let c = CALC[t.id]; if(!c || Date.now() - c.at > 12 * 3600e3){ if(!calWanted(t) && !isWant(t)) return; try{ c = CALC[t.id] = await calFetch(t); kvSet('cal:' + t.id, c) }catch(e){ return } }
  if(cur().v !== 'title' || cur().id !== t.id || !$('#tcal')) return;
  const ev = (c.events || []).filter(e => !e.date || daysFrom(e.date) >= -14).slice(0, 6), p = c.prov;
  let h = ev.length ? `<div class="sec">Coming up</div><div class="mlist" style="gap:0">${ev.map(evRow).join('')}</div>` : '';
  if(t.kind === 'show' && c.status && !ev.some(e => e.kind === 'ep')) h += `<p class="muted small" style="margin:8px 0 0">${/ended|canceled/i.test(c.status) ? 'This show has ended.' : 'No new episodes announced yet.'}</p>`;
  if(p && (p.stream.length || p.rent.length || p.buy.length)) h += `<div class="sec">Where to watch in Belgium</div><div class="facts">${p.stream.length ? `<span>Streaming</span><span>${esc(p.stream.join(', '))}</span>` : ''}${p.rent.length ? `<span>Rent</span><span>${esc(p.rent.join(', '))}</span>` : ''}${p.buy.length ? `<span>Buy</span><span>${esc(p.buy.join(', '))}</span>` : ''}</div><p class="muted small" style="margin:0">Data: JustWatch${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">more</a>` : ''}</p>`;
  el.innerHTML = h; lazyCovers(el);
  el.querySelectorAll('[data-calev]').forEach(r => r.onclick = e => { const ev2 = (c.events || []).find(x => x.id === r.dataset.calev); if(e.target.closest('[data-bell]')){ toggleMute(ev2); return } if(ev2 && ev2.kind === 'saga') sagaSheet(ev2) }) };

/* ---------- start: the saved calendar, a quiet look for new dates (twice a day), the reminder buttons ---------- */
window.calStart = async () => {
  const sb = $('#setbtn'); if(sb && !$('#calbtn')){ const b = document.createElement('button'); b.className = 'ib'; b.id = 'calbtn'; b.setAttribute('aria-label', 'Coming soon (calendar)');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
    b.onclick = () => { if(cur().v !== 'cal') go({v:'cal'}) }; sb.parentNode.insertBefore(b, sb) }
  try{ for(const r of await dbAll('kv')) if(String(r.id).startsWith('cal:')) CALC[r.id.slice(4)] = r.v }catch(e){}
  if(S.remind == null){ S.remind = true; S.remindAt = S.remindAt || '09:00'; saveS() }
  if(TKEY() && Date.now() - lsGet('nvCinema.calAt', 0) > 12 * 3600e3) setTimeout(() => refreshCal(false), 6000);
  if(LN) try{ LN.addListener('localNotificationActionPerformed', a => { const x = (a && a.notification && a.notification.extra) || {}; const m = /title=([^&]+)/.exec(x.url || ''); if(m && TM[m[1]]) go({v:'title', id:m[1], shelf:TM[m[1]].shelf}); else if(/view=cal/.test(x.url || '')) go({v:'cal'}) }) }catch(e){}
  window.NVCAL = {CALC, refreshCal, calEvents, calFetch, scheduleReminders, addWant, releaseInfo} };   // for testing

/* settings: reminders (called from appSettings) */
window.calSettingsHTML = () => `<div class="sec">Calendar</div>
  <div class="opt"><label for="as_rem">Remind me on the day (new episode, film out)</label><input type="checkbox" id="as_rem" ${S.remind ? 'checked' : ''}></div>
  <div class="opt"><label for="as_remat">At</label><select id="as_remat">${['07:00', '08:00', '09:00', '12:00', '17:00', '18:00', '19:00', '20:00'].map(x => `<option ${(S.remindAt || '09:00') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
  ${LN ? '' : '<p class="muted small" style="margin:0">Reminders work in the Android app.</p>'}`;
window.calSettingsHook = () => { const r = $('#as_rem'), a = $('#as_remat'); if(!r) return;
  r.onchange = async e => { S.remind = e.target.checked; saveS(); if(S.remind && LN && !(await askReminders())){ toast('Allow notifications for Nightvault in Android’s settings to get reminders', 5000) } scheduleReminders() };
  a.onchange = e => { S.remindAt = e.target.value; saveS(); scheduleReminders() } };
