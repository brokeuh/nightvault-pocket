/* =====================================================================================================================
   TRANSLATE THE BUBBLES (Android app; loaded after panelview.js). Plan: plans/bookcase.md ("Translate the bubbles").
   Google's on-device translator (ML Kit, plugin NvTranslate): about 30 MB per language, downloaded once, works offline after that.
   The text of the bubbles comes from Read along's text reader (raPageBubbles); here it is translated, page by page (a page ahead, because
   raAhead / the panel plans ask for the next page early), and kept per book. It is shown as a caption card above the Read along bar
   (tap the card = the original), and read aloud in the voice of the chosen language when "Read the translation" is on.
   ===================================================================================================================== */
'use strict';

let NvTrans = null; if(NATIVE) try{ NvTrans = Capacitor.registerPlugin('NvTranslate') }catch(e){}
const TRCOMMON = ['nl', 'fr', 'de', 'es', 'it', 'pt', 'pl', 'sv', 'da', 'no', 'fi', 'cs', 'tr', 'ru', 'uk', 'el', 'ro', 'hu', 'id', 'vi', 'ar', 'hi', 'ko', 'ja', 'zh'];
const trName = c => { try{ return new Intl.DisplayNames(['en'], {type:'language'}).of(c) || c }catch(e){ return c } };
const trOn = () => !!(NvTrans && lsGet('nvBooks.trOn', false) && lsGet('nvBooks.trTo', ''));
const trTo = () => lsGet('nvBooks.trTo', 'nl');
const trSpeak = () => lsGet('nvBooks.trSpeak', true);
const trVoice = () => window.NVVOICE ? NVVOICE.voiceFor(trTo()) : {engine:'', voice:'', lang:trTo()};
let trWarned = 0;

/* ---- the text: ALL CAPS lettering is already made into sentences by raClean (the text reader's bubbles come through it) ---- */
const trContinues = (a, b) => /(…|\.\.\.|,|—|–|-)$/.test(a) && !!b;

/* ---- the memory of this book (a page is never translated twice) ---- */
async function trMem(){ if(!R) return null; const to = trTo(); if(R.trMem && R.trMemTo === to) return R.trMem; const id = 'tr:' + R.b.id + ':' + to;
  const rec = (R.b.handed ? null : await dbGet('kv', id).catch(() => null)) || {id, m:{}}; R.trMem = rec; R.trMemTo = to; return rec }
let trSaveT = 0;
function trMemSave(){ clearTimeout(trSaveT); const r = R; trSaveT = setTimeout(() => { if(r && r.trMem && !r.b.handed) dbPut('kv', r.trMem).catch(() => {}) }, 1200) }

/* ---- translate the bubbles of one page (or strip window): bubbles that carry on in the next one are translated together ---- */
async function trApply(bs){ if(!trOn() || !R) return; const to = trTo(), todo = bs.filter(b => b.trTo !== to && raWanted(b)); if(!todo.length) return;
  const items = []; for(let i = 0; i < todo.length; i++){ const b = todo[i], nx = todo[i + 1];
    if(nx && nx.p === b.p && trContinues(b.say, nx.say)){ items.push({bs:[b, nx], text:b.say + ' ' + nx.say}); i++ } else items.push({bs:[b], text:b.say}) }
  const mem = await trMem(), need = [...new Set(items.map(it => it.text).filter(t => mem.m[t] == null))];
  if(need.length){ const t0 = Date.now();
    try{ const r = await NvTrans.translate({from:'en', to, texts:need}); need.forEach((t, i) => { mem.m[t] = r.texts[i] || '' }); trMemSave(); L('translate', `${need.length} texts to ${to} in ${Date.now() - t0} ms`) }
    catch(e){ LE('translate', 'translate', e); if(Date.now() - trWarned > 20000){ trWarned = Date.now(); toast(/not on this phone/i.test(e.message || '') ? 'Download the language first: Read along bar › 🌐' : 'Translating failed: ' + (e.message || e), 4500) } return } }
  for(const it of items){ const tr = mem.m[it.text]; it.bs.forEach((b, k) => { b.trTo = to; b.tr = k === 0 ? tr : ''; b.trJoined = it.bs.length > 1 && k > 0 }) } }

/* ---- the caption card ---- */
let trShowOrig = false, trLastB = null;
function trCaption(){ let c = $('#rcap'); const b = RA && RA.bubbles && RA.i != null ? RA.bubbles[RA.i] : null;
  if(!b || !trOn() || b.trTo !== trTo()){ if(c) c.remove(); return }
  if(trLastB !== b){ trLastB = b; trShowOrig = false }
  let t = b.tr, o = b.say; if(b.trJoined){ const a = RA.bubbles[RA.i - 1]; if(a){ t = a.tr; o = a.say + ' ' + b.say } }
  else { const n = RA.bubbles[RA.i + 1]; if(n && n.trJoined) o = b.say + ' ' + n.say }
  if(!t){ if(c) c.remove(); return }
  if(!c){ c = document.createElement('div'); c.id = 'rcap'; $('#reader').appendChild(c); c.onclick = () => { trShowOrig = !trShowOrig; trCaption() } }
  c.classList.toggle('orig', trShowOrig); c.textContent = trShowOrig ? o : t }

/* ---- the sheet: on/off, language, model, voice ---- */
async function trSheet(){ if(!NvTrans) return toast('Translating works in the Android app'); if(RA) raPause();
  let langs = []; try{ langs = (await NvTrans.languages()).languages }catch(e){ langs = TRCOMMON }
  const to = lsGet('nvBooks.trTo', '') || 'nl', ordered = [...TRCOMMON.filter(c => langs.includes(c)), ...langs.filter(c => !TRCOMMON.includes(c) && c !== 'en').sort((a, b) => trName(a).localeCompare(trName(b)))];
  let have = false; try{ have = (await NvTrans.status({lang:to})).downloaded }catch(e){}
  sheet(`<h3>Translate the bubbles</h3>
    <p class="muted small" style="margin-top:0">Google's translator on this phone, free. The comic is read in English; the translation shows as a caption under the bubble you are on. Tap the caption to see the original.</p>
    <div class="opt"><label for="t_on">Translate</label><input type="checkbox" id="t_on" ${lsGet('nvBooks.trOn', false) ? 'checked' : ''}></div>
    <div class="sec">Translate to</div><select id="t_to" class="inp" style="width:100%">${ordered.map(c => `<option value="${c}" ${c === to ? 'selected' : ''}>${esc(trName(c))}</option>`).join('')}</select>
    <div class="opt" style="margin-top:8px"><label for="t_sp">Read the translation aloud (in that language's voice)</label><input type="checkbox" id="t_sp" ${trSpeak() ? 'checked' : ''}></div>
    <p class="muted small" id="t_st" style="margin:8px 0 4px">${have ? `${esc(trName(to))} is on this phone – it works without internet.` : `${esc(trName(to))} is not on this phone yet: a download of about 30 MB, once.`}</p>
    <div class="mlist"><button class="btn primary" id="t_dl" ${have ? 'hidden' : ''}>Download ${esc(trName(to))}</button><button class="btn" id="t_rm" ${have ? '' : 'hidden'}>Remove ${esc(trName(to))} from this phone</button></div>`);
  const redo = () => { R.trMem = null; closeSheet(); if(PN) pnReplan(); else if(RA){ RA.bubbles = null; raOnPage() } trCaption() };
  $('#t_on').onchange = async e => { lsSet('nvBooks.trOn', e.target.checked); if(e.target.checked){ lsSet('nvBooks.trTo', $('#t_to').value); if(!have) toast('Tap Download first, then it translates', 3500) } trCaption(); if(e.target.checked && have) redo() };
  $('#t_sp').onchange = e => { lsSet('nvBooks.trSpeak', e.target.checked); if(RA) RA.syn = new Map() };
  $('#t_to').onchange = () => { lsSet('nvBooks.trTo', $('#t_to').value); R.trMem = null; trSheet() };
  $('#t_dl').onclick = async () => { const b = $('#t_dl'); b.disabled = true; b.textContent = 'Downloading…'; $('#t_st').textContent = 'Downloading – this can take a minute.';
    try{ await NvTrans.download({lang:$('#t_to').value}); lsSet('nvBooks.trTo', $('#t_to').value); toast(trName($('#t_to').value) + ' is ready'); trSheet() }catch(e){ LE('translate', 'download', e); b.disabled = false; b.textContent = 'Try again'; $('#t_st').textContent = 'The download failed: ' + (e.message || e) } };
  $('#t_rm').onclick = async () => { try{ await NvTrans.remove({lang:$('#t_to').value}); toast('Removed'); trSheet() }catch(e){ toast('Could not remove: ' + (e.message || e)) } } }
