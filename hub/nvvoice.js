/* The Nightvault – read-aloud VOICES, shared by every app that reads aloud (Audiobooks: EPUBs from Bookcase; Bookcase: Read along).
   Natural voices made on the phone itself (native NvTts engine "@nv" = sherpa-onnx: Kokoro for English, Piper for Dutch), downloaded once
   from the release "voices" (list: data/voices.json, made by the workflow "Voices for read aloud"), or the phone's own text-to-speech voices.
   The choice is kept in Audiobooks' settings (localStorage nvAudio.settings: nvVoice {en, nl}, ttsEngine, ttsVoices {en, nl}).

     NVVOICE.voiceFor(lang)         → {engine, voice, lang} for NvTts.synth (a natural voice when one is chosen for that language)
     NVVOICE.hasNatural(lang)        → true when a natural voice is chosen for that language
     NVVOICE.open(ui, opts)          → the voice screen (download, pick, sample, the phone's voices); ui = {sheet, closeSheet, toast}
     NVVOICE.offer(ui, lang, done)   → once per language: "A natural voice?" with a Download button (done(true) when one is ready)
   Pages using it need the app's sheet / .li / .opt / .prog / .btn / .chip styles (Audiobooks and Bookcase have them). */
(function(){
  if(window.NVVOICE) return;
  const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  let T = null; if(NATIVE) try{ T = Capacitor.registerPlugin('NvTts') }catch(e){ T = null }
  const KEY = 'nvAudio.settings';
  const get = () => { try{ return JSON.parse(localStorage.getItem(KEY) || '{}') || {} }catch(e){ return {} } };
  const put = patch => { const s = Object.assign(get(), patch); try{ localStorage.setItem(KEY, JSON.stringify(s)) }catch(e){} return s };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const mb = n => n >= 1048576 ? Math.round(n / 1048576) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB';
  const log = (t, d) => { try{ window.NVLOG && NVLOG.log('voice', t, d) }catch(e){} };
  const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fileUrl = (uri, name) => '/_nvfile_/' + b64url(uri) + '/' + encodeURIComponent(name);
  const URL_LIST = NATIVE ? 'https://brokeuh.github.io/nightvault-pocket/data/voices.json' : '../data/voices.json';
  const KOKORO = [['Bella', 'US, woman', 1], ['Sarah', 'US, woman', 3], ['Nicole', 'US, woman, soft', 2], ['Sky', 'US, woman', 4], ['Adam', 'US, man', 5], ['Michael', 'US, man', 6], ['Emma', 'British, woman', 7], ['Isabella', 'British, woman', 8], ['George', 'British, man', 9], ['Lewis', 'British, man', 10], ['Default', 'US, woman', 0]];
  const NAME = {'kokoro-int8-en-v0_19':['Kokoro', 'English · 11 natural voices'], 'vits-piper-nl_BE-nathalie-medium-int8':['Nathalie', 'Dutch (Flemish) · woman'], 'vits-piper-nl_NL-pim-medium-int8':['Pim', 'Dutch (Netherlands) · man']};
  const speakers = id => /kokoro/.test(id) ? KOKORO.map(([n, d, sid]) => ({v:id + '#' + sid, t:n + ' (' + d + ')'})) : [{v:id + '#0', t:(NAME[id] || [id])[0]}];
  let CAT = null;
  async function catalog(){ if(CAT) return CAT; try{ CAT = ((await (await fetch(URL_LIST + '?d=' + new Date().toISOString().slice(0, 10), {cache:'no-cache'})).json()).voices || []) }catch(e){ CAT = [] } return CAT }
  async function packs(){ if(!T) return []; try{ return (await T.installed()).voices || [] }catch(e){ return [] } }
  const lang2 = l => String(l || 'en').slice(0, 2).toLowerCase() === 'nl' ? 'nl' : 'en';
  function voiceFor(lang){ const s = get(), l = lang2(lang), nv = (s.nvVoice || {})[l];
    return nv ? {engine:'@nv', voice:nv, lang:l} : {engine:s.ttsEngine === '@nv' ? '' : s.ttsEngine || '', voice:(s.ttsVoices || {})[l] || '', lang:l} }
  const hasNatural = lang => !!(get().nvVoice || {})[lang2(lang)];
  function choose(l, v){ const s = get(), nv = Object.assign({}, s.nvVoice); if(v) nv[l] = v; else delete nv[l]; put({nvVoice:nv}); NV.changed() }
  /* download one pack; prog(html) shows how far */
  async function download(v, prog, ui){ let lis = null; const show = h => { try{ prog && prog(h) }catch(e){} };
    try{ show('<div class="prog"><i style="width:2%"></i></div><span class="muted small">Starting the download…</span>');
      lis = await T.addListener('voiceProgress', e => { if(e.id !== v.id) return; const pc = e.total ? Math.round(100 * e.done / e.total) : 0;
        show(e.step === 'unpack' ? '<div class="prog busy"><i style="width:100%"></i></div><span class="muted small">Unpacking…</span>' : `<div class="prog"><i style="width:${pc}%"></i></div><span class="muted small">${mb(e.done)} of ${mb(e.total || v.size)}</span>`) });
      await T.download({id:v.id, url:v.url, cfg:{kind:v.kind, model:v.model, voices:v.voices, tokens:v.tokens, dataDir:v.dataDir, lang:v.lang}});
      if(!(get().nvVoice || {})[v.lang]) choose(v.lang, speakers(v.id)[0].v);
      log('downloaded', v.id); return true
    }catch(e){ log('download failed', String(e && e.message || e)); ui && ui.toast && ui.toast(e.message || String(e), 6000); return false }finally{ if(lis && lis.remove) lis.remove() } }

  /* the voice screen */
  async function open(ui, opts){ opts = opts || {};
    if(!T){ ui.sheet('<h3>Read-aloud voice</h3><p class="muted small">Reading aloud works in the Android app.</p>'); return }
    ui.sheet('<h3>Read-aloud voice</h3><p class="muted small">Looking for the voices…</p>');
    const [cat, have0] = await Promise.all([catalog(), packs()]), have = new Set(have0.map(x => x.id)), s = get();
    const sel = l => { const own = cat.filter(v => v.lang === l && have.has(v.id)).flatMap(v => speakers(v.id)), cur = (s.nvVoice || {})[l] || '';
      return `<select data-nvl="${l}" style="max-width:62%"><option value="">The phone's own voice</option>${own.map(o => `<option value="${esc(o.v)}" ${cur === o.v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>` };
    ui.sheet(`<h3>Read-aloud voice</h3><p class="muted small" style="margin:0 0 6px">${esc(opts.intro || 'For EPUBs read aloud in Audiobooks and for Read along in Bookcase.')}</p>
      <div class="sec" style="margin-top:8px">Natural voices – download once, then they work without internet</div>
      ${cat.map(v => `<div class="li" style="cursor:default;flex-wrap:wrap"><div class="n"><div style="color:var(--text)">${esc((NAME[v.id] || [v.id])[0])}</div><div class="s">${esc((NAME[v.id] || ['', v.lang])[1])} · ${mb(v.size)}</div></div>
        ${have.has(v.id) ? `<span class="muted small">✓ on this phone</span><button class="x" data-vrm="${esc(v.id)}" aria-label="Remove this voice" style="background:none;border:0;color:var(--dim);font-size:16px;padding:4px 8px;cursor:pointer">✕</button>` : `<button class="btn sm primary" data-vdl="${esc(v.id)}">Download</button>`}<div data-vprog="${esc(v.id)}" style="flex-basis:100%"></div></div>`).join('') || '<p class="muted small">The list of voices could not be loaded - check the internet connection.</p>'}
      <div class="sec">Which voice reads</div>
      <div class="opt"><label>English books</label>${sel('en')}</div><div class="opt"><label>Dutch books</label>${sel('nl')}</div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="nvvtest" style="flex:1">Listen to a sample</button><button class="btn" id="nvvphone" style="flex:1">The phone's voices…</button></div>
      <p class="muted small" id="nvvmsg" style="margin:8px 0 0">Natural voices are made on the phone itself: a fast phone keeps up easily, an older one may need a moment now and then.</p>`);
    const root = document.querySelector('.sheet') || document;
    root.addEventListener('change', e => { const sl = e.target.closest('[data-nvl]'); if(!sl) return; choose(sl.dataset.nvl, sl.value) });
    root.addEventListener('click', async e => { const d = e.target.closest('[data-vdl]'), r = e.target.closest('[data-vrm]');
      if(d){ const v = cat.find(x => x.id === d.dataset.vdl); d.disabled = true; const box = root.querySelector(`[data-vprog="${CSS.escape(v.id)}"]`);
        if(await download(v, h => { if(box && box.isConnected) box.innerHTML = h }, ui)){ ui.toast('Voice ready'); open(ui, opts) } else d.disabled = false }
      if(r){ await T.removeVoice({id:r.dataset.vrm}).catch(() => {}); const nv = Object.assign({}, get().nvVoice); for(const k of Object.keys(nv)) if(String(nv[k]).startsWith(r.dataset.vrm + '#')) delete nv[k]; put({nvVoice:nv}); NV.changed(); ui.toast('Voice removed'); open(ui, opts) } });
    const msg = t => { const m = document.getElementById('nvvmsg'); if(m) m.textContent = t };
    document.getElementById('nvvtest').onclick = async () => { const vs = ['en', 'nl'].map(voiceFor), v = vs.find(x => x.engine === '@nv') || vs[0]; msg('Making the sample…');
      try{ const t0 = Date.now(), r = await T.synth(Object.assign({text:v.lang === 'nl' ? 'Hallo. Zo klinken je boeken. Het was een donkere, stormachtige nacht.' : 'Hello. This is how your books will sound. It was a dark and stormy night, and the rain fell in torrents.', id:'sample'}, v));
        const a = new Audio(fileUrl(r.uri, 'sample.wav')); await a.play(); msg(r.secs ? `Playing the sample (made in ${((r.ms || Date.now() - t0) / 1000).toFixed(1)} s for ${r.secs.toFixed(1)} s of speech)` : 'Playing the sample') }catch(e){ msg('No sound: ' + (e.message || e)) } };
    document.getElementById('nvvphone').onclick = () => phoneVoices(ui, opts) }

  /* the phone's own text-to-speech engines and voices (used for a language without a natural voice) */
  async function phoneVoices(ui, opts){ ui.sheet('<h3>The phone\'s voices</h3><p class="muted small">Looking…</p>');
    const s = get(), eng = s.ttsEngine === '@nv' ? '' : s.ttsEngine || '';
    let en = {engines:[], default:''}; try{ en = await T.engines({engine:eng}) }catch(e){}
    let vs = []; try{ vs = ((await T.voices({engine:eng})).voices || []).filter(v => v.installed !== false) }catch(e){}
    const opt = l => `<option value="">The engine's own choice</option>` + vs.filter(v => v.lang.toLowerCase().startsWith(l)).sort((a, b) => (b.quality - a.quality) || (a.network - b.network) || a.name.localeCompare(b.name))
      .map(v => `<option value="${esc(v.name)}" ${((s.ttsVoices || {})[l] || '') === v.name ? 'selected' : ''}>${esc(v.name)}${v.network ? ' (needs internet)' : ''}</option>`).join('');
    ui.sheet(`<h3>The phone's voices</h3><p class="muted small" style="margin:0 0 8px">Used for a language that has no natural voice picked. They come from a text-to-speech engine on this phone (usually Google's).</p>
      <div class="opt"><label>Engine</label><select id="nvveng" style="max-width:62%"><option value="">The phone's default${en.default ? ' (' + esc((en.engines.find(x => x.name === en.default) || {}).label || en.default) + ')' : ''}</option>${en.engines.map(x => `<option value="${esc(x.name)}" ${eng === x.name ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      <div class="opt"><label>English</label><select id="nvven" style="max-width:62%">${opt('en')}</select></div><div class="opt"><label>Dutch</label><select id="nvvnl" style="max-width:62%">${opt('nl')}</select></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="nvvback" style="flex:1">‹ Natural voices</button><button class="btn" id="nvvset" style="flex:1">Phone settings</button></div>`);
    document.getElementById('nvveng').onchange = e => { put({ttsEngine:e.target.value, ttsVoices:{}}); NV.changed(); phoneVoices(ui, opts) };
    const sv = () => { put({ttsVoices:{en:document.getElementById('nvven').value, nl:document.getElementById('nvvnl').value}}); NV.changed() };
    document.getElementById('nvven').onchange = sv; document.getElementById('nvvnl').onchange = sv;
    document.getElementById('nvvback').onclick = () => open(ui, opts);
    document.getElementById('nvvset').onclick = () => T.openSettings().catch(e => ui.toast(e.message || String(e))) }

  /* once per language: offer the natural voice where reading aloud starts */
  async function offer(ui, lang, done){ const l = lang2(lang); if(!T || hasNatural(l)) return;
    const flag = 'nvVoice.offered.' + l; try{ if(localStorage.getItem(flag)) return }catch(e){}
    const cat = (await catalog()).filter(v => v.lang === l); if(!cat.length) return; const v = cat[0];
    if((await packs()).some(x => x.id === v.id)){ choose(l, speakers(v.id)[0].v); done && done(true); return }
    try{ localStorage.setItem(flag, String(Date.now())) }catch(e){}
    ui.sheet(`<h3>A natural voice?</h3><p class="muted small">Right now the phone's own voice reads. Nightvault can download a natural-sounding voice (<b>${esc((NAME[v.id] || [v.id])[0])}</b>, ${mb(v.size)}) once - then it works without internet. You can change it any time in the voice settings.</p><div id="nvvofp"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" style="flex:1" id="nvvofno">Not now</button><button class="btn primary" style="flex:2" id="nvvofgo">Download the voice</button></div>`);
    document.getElementById('nvvofno').onclick = () => ui.closeSheet();
    document.getElementById('nvvofgo').onclick = async () => { const b = document.getElementById('nvvofgo'); b.disabled = true;
      if(await download(v, h => { const p = document.getElementById('nvvofp'); if(p) p.innerHTML = h }, ui)){ ui.closeSheet(); ui.toast('Natural voice ready'); done && done(true) } else b.disabled = false } }

  const NV = {voiceFor, hasNatural, open, offer, catalog, packs, download, speakers, names:NAME, fileUrl, get available(){ return !!T },
    /* apps listen here to drop sounds made with the old voice */
    changed(){ try{ window.dispatchEvent(new CustomEvent('nvvoice')) }catch(e){} }};
  window.NVVOICE = NV;
})();
