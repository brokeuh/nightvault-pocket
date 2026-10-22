/* Nightvault debug log (test). Shared by every Nightvault app (same storage on the website and in the Android app).
   Debug mode on (The Nightvault → Debug mode, or NVLOG.enable()): everything is written down - errors, console messages,
   failed network requests, and what the apps report with NVLOG.log(area, text, data). A small bug button then shows the log:
   - Copy / Share: paste it into any Claude chat.
   - Send to GitHub: saved in the private repo brokeuh/nightvault-src as logs/<topic>/<time>-<app>.txt, so the chat for that topic
     can read it. Needs a GitHub token (Contents: read and write on nightvault-src), pasted once and kept on this device only.
   Android app: "Android log" adds the app's own Android messages (the NvLog plugin). */
(function(){
  if(window.NVLOG) return;
  const KEY = 'nvLog', ON = 'nvDebug', TOK = 'nvLogToken', MAX = 1500;
  const APP = (document.title || location.pathname).replace(/^Nightvault\s*/i, '') || 'app';
  const now = () => { const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0') };
  const load = () => { try{ return JSON.parse(localStorage.getItem(KEY) || '[]') }catch(e){ return [] } };
  let buf = load(), saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try{ localStorage.setItem(KEY, JSON.stringify(buf.slice(-MAX))) }catch(e){ buf = buf.slice(-MAX / 2) } }, 300) };
  const on = () => { try{ return localStorage.getItem(ON) === '1' }catch(e){ return false } };
  const str = v => { if(v == null) return ''; if(typeof v === 'string') return v; if(v instanceof Error) return v.name + ': ' + v.message + (v.stack ? ' @ ' + String(v.stack).split('\n').slice(1, 3).join(' ').trim() : '');
    try{ return JSON.stringify(v, (k, x) => x instanceof Blob ? `[${x.type || 'blob'} ${x.size} B]` : x instanceof ArrayBuffer ? `[${x.byteLength} bytes]` : x).slice(0, 2000) }catch(e){ return String(v) } };
  function add(level, area, text, data){ if(!on()) return;
    buf.push(`${now()} ${level} [${APP}${area ? '/' + area : ''}] ${str(text)}${data !== undefined ? ' ' + str(data) : ''}`); if(buf.length > MAX * 1.2) buf = buf.slice(-MAX); save(); badge() }

  // catch what goes wrong anywhere
  addEventListener('error', e => add('ERROR', 'page', e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : undefined));
  addEventListener('unhandledrejection', e => add('ERROR', 'promise', e.reason));
  for(const lv of ['log', 'warn', 'error']){ const o = console[lv]; console[lv] = function(...a){ try{ add(lv === 'log' ? 'log' : lv.toUpperCase(), 'console', a.map(str).join(' ')) }catch(e){} return o.apply(this, a) } }
  const of = window.fetch; if(of) window.fetch = async function(u, opt){ const t = Date.now(), url = String(u && u.url || u), short = url.replace(/^https?:\/\/[^/]+/, '').slice(0, 160), rg = opt && opt.headers && (opt.headers.Range || opt.headers.range);
    try{ const r = await of.apply(this, arguments); if(!r.ok || /_nvfile_/.test(url)) add(r.ok ? 'net' : 'WARN', 'fetch', `${r.status} ${short}${rg ? ' ' + rg : ''} ${Date.now() - t}ms`); return r }
    catch(e){ add('ERROR', 'fetch', `failed ${short}${rg ? ' ' + rg : ''}: ${e.message || e}`); throw e } };

  // the bug button and the log sheet
  let btn = null;
  function badge(){ if(!btn) return; btn.querySelector('b').textContent = buf.filter(l => / (ERROR|WARN) /.test(l)).length || '' }
  function ui(){ if(btn || !on() || !document.body) return;
    const st = document.createElement('style'); st.textContent = `#nvlogbtn{position:fixed;left:10px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:30;width:40px;height:40px;border-radius:50%;border:1px solid #5a3a20;background:#2a1c10;color:#f0b46a;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px #0008}
      #nvlogbtn b{position:absolute;top:-4px;right:-4px;background:#c0444a;color:#fff;font:700 10px system-ui;border-radius:9px;padding:1px 5px}#nvlogbtn b:empty{display:none}
      #nvlogsh{position:fixed;inset:0;z-index:40;background:#000b;display:flex;align-items:flex-end;justify-content:center;font:14px system-ui,sans-serif;color:#e9edf2}
      #nvlogsh>div{width:100%;max-width:640px;max-height:90vh;overflow:auto;background:#151a22;border:1px solid #232b36;border-radius:18px 18px 0 0;padding:14px 14px calc(18px + env(safe-area-inset-bottom,0px))}
      #nvlogsh pre{white-space:pre-wrap;word-break:break-word;font-size:10.5px;line-height:1.35;background:#0b0e13;border-radius:10px;padding:8px;max-height:40vh;overflow:auto;margin:8px 0}
      #nvlogsh button{height:38px;border-radius:11px;border:1px solid #232b36;background:#10141b;color:#e9edf2;font:inherit;font-size:13.5px;padding:0 12px;cursor:pointer}
      #nvlogsh button.p{background:#2a8f6a;border-color:#3fbf91;color:#fff;font-weight:700}#nvlogsh .r{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      #nvlogsh select,#nvlogsh input{height:38px;border-radius:11px;border:1px solid #232b36;background:#0b0e13;color:#e9edf2;padding:0 8px;font:inherit;font-size:13.5px}#nvlogsh .m{color:#9aa7b5;font-size:12px}`;
    document.head.appendChild(st);
    btn = document.createElement('button'); btn.id = 'nvlogbtn'; btn.setAttribute('aria-label', 'Debug log');
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5l1.5 2M15 5l-1.5 2M3 12h4M17 12h4M4 18l3-2M20 18l-3-2M4 7l3 2M20 7l-3 2"/></svg><b></b>';
    btn.onclick = sheet; document.body.appendChild(btn); badge() }
  const TOPICS = [['audiobooks', 'Audiobooks'], ['music', 'Music'], ['hub', 'The Nightvault (hub, updates)'], ['scanner', 'Scanner / Binder (Pocket)'], ['convert', 'Convert'], ['bookcase', 'Bookcase'], ['go', 'GO'], ['other', 'Something else']];
  function text(){ return `Nightvault debug log · ${new Date().toISOString()} · ${navigator.userAgent}\n` + buf.join('\n') }
  async function androidLog(){ try{ const P = window.Capacitor && Capacitor.registerPlugin('NvLog'); const r = await P.get({lines:400}); return r.text || '' }catch(e){ return '(Android log not available: ' + (e.message || e) + ')' } }
  function sheet(){
    const el = document.createElement('div'); el.id = 'nvlogsh'; const native = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
    const def = (/audio/.test(location.pathname) ? 'audiobooks' : /hub/.test(location.pathname) ? 'hub' : /test|\/$/.test(location.pathname) ? 'scanner' : /convert/.test(location.pathname) ? 'convert' : 'other');
    el.innerHTML = `<div><b style="font-size:16px">Debug log</b> <span class="m">${buf.length} lines · all Nightvault apps</span>
      <pre>${buf.slice(-60).map(l => l.replace(/[&<>]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'}[c]))).join('\n') || '(empty - do the thing that goes wrong, then look again)'}</pre>
      ${native ? '<label class="m" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="nvlA" checked style="height:18px;width:18px"> add the Android log (the app\'s own messages)</label>' : ''}
      <div class="r"><button class="p" id="nvlC">Copy for Claude</button>${navigator.share || native ? '<button id="nvlS">Share</button>' : ''}</div>
      <div class="m" style="margin-top:12px">Or save it on GitHub, for the chat about:</div>
      <div class="r"><select id="nvlT">${TOPICS.map(([v, t]) => `<option value="${v}" ${v === def ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="p" id="nvlG">Send to GitHub</button></div>
      <div id="nvlTok" class="m" hidden style="margin-top:8px">Paste a GitHub token once (fine-grained, repository <b>nightvault-src</b>, permission <b>Contents: Read and write</b>). It stays on this device.<div class="r"><input id="nvlTi" placeholder="github_pat_…" style="flex:1"><button id="nvlTs">Save</button></div></div>
      <div class="m" id="nvlMsg" style="margin-top:8px"></div>
      <div class="r" style="margin-top:14px;justify-content:space-between"><span class="r" style="margin:0"><button id="nvlX">Clear the log</button><button id="nvlOff">Debug mode off</button></span><button id="nvlClose">Close</button></div></div>`;
    document.body.appendChild(el);
    const $ = s => el.querySelector(s), msg = t => $('#nvlMsg').textContent = t;
    const full = async () => text() + (native && $('#nvlA') && $('#nvlA').checked ? '\n\n--- Android log ---\n' + await androidLog() : '');
    el.onclick = e => { if(e.target === el) el.remove() }; $('#nvlClose').onclick = () => el.remove();
    $('#nvlC').onclick = async () => { const t = await full(); try{ await navigator.clipboard.writeText(t); msg('Copied - paste it into the chat (' + Math.round(t.length / 1024) + ' KB).') }catch(e){ const ta = document.createElement('textarea'); ta.value = t; el.firstChild.appendChild(ta); ta.select(); try{ document.execCommand('copy'); msg('Copied.') }catch(x){ msg('Could not copy - select the text and copy it.') } } };
    if($('#nvlS')) $('#nvlS').onclick = async () => { const t = await full();
      try{ if(native){ const S = Capacitor.registerPlugin('Share'); await S.share({title:'Nightvault log', text:t, dialogTitle:'Send the log'}) } else await navigator.share({title:'Nightvault log', text:t}) }catch(e){ msg('Share: ' + (e.message || e)) } };
    $('#nvlG').onclick = async () => { let tok = ''; try{ tok = localStorage.getItem(TOK) || '' }catch(e){} if(!tok){ $('#nvlTok').hidden = false; return }
      const t = await full(), topic = $('#nvlT').value, d = new Date(), stamp = d.toISOString().slice(0, 19).replace(/[:T]/g, '-'), path = `logs/${topic}/${stamp}-${APP.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
      msg('Sending …');
      try{ const b64 = btoa(unescape(encodeURIComponent(t)));
        const r = await of(`https://api.github.com/repos/brokeuh/nightvault-src/contents/${path}`, {method:'PUT', headers:{Authorization:'Bearer ' + tok, Accept:'application/vnd.github+json'}, body:JSON.stringify({message:`Debug log (${topic}, ${APP})`, content:b64, committer:{name:'brokeuh', email:'jochem_petit@msn.com'}})});
        if(r.ok) msg(`Saved as ${path} - tell the ${TOPICS.find(x => x[0] === topic)[1]} chat "read the newest log".`);
        else if(r.status === 401 || r.status === 403 || r.status === 404){ msg(`GitHub said ${r.status}: the token cannot write to nightvault-src. Paste a new one.`); $('#nvlTok').hidden = false }
        else msg('GitHub said ' + r.status + ': ' + (await r.text()).slice(0, 200)) }catch(e){ msg('Could not send: ' + (e.message || e)) } };
    $('#nvlTs').onclick = () => { const v = $('#nvlTi').value.trim(); if(!v) return; try{ localStorage.setItem(TOK, v) }catch(e){} $('#nvlTok').hidden = true; $('#nvlG').click() };
    $('#nvlX').onclick = () => { buf = []; save(); badge(); el.remove() };
    $('#nvlOff').onclick = () => { NVLOG.disable(); el.remove() };
  }
  window.NVLOG = {
    log:(area, t, d) => add('info', area, t, d), warn:(area, t, d) => add('WARN', area, t, d), error:(area, t, d) => add('ERROR', area, t, d),
    get on(){ return on() }, lines:() => buf.slice(), text, open:sheet,
    enable(){ try{ localStorage.setItem(ON, '1') }catch(e){} add('info', 'debug', 'debug mode on', {app:APP, url:location.pathname + location.search}); ui() },
    disable(){ add('info', 'debug', 'debug mode off'); try{ localStorage.removeItem(ON) }catch(e){} if(btn){ btn.remove(); btn = null } } };
  if(on()){ add('info', 'start', location.pathname + location.search, {native:!!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()), ua:navigator.userAgent.slice(0, 120)});
    if(document.body) ui(); else addEventListener('DOMContentLoaded', ui) }
})();

/* Back where you were (owner, 22 Oct 2026): Android may close the Nightvault app while it is in the background (it needs the memory);
   opening it again then started on the hub. Every app page writes down where it is when it goes to the background (localStorage
   nvHere); when the Android app starts fresh on the hub (a new session) within 3 hours, the hub goes straight back to that page with
   ?nvresume=1, and an app that knows how (Bookcase) also puts back its screens and the open book. Going back to the hub on purpose
   clears it. Shared by every app because every page loads this file. */
(function(){
  const K = 'nvHere', native = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const onHub = /\/hub\/(index\.html)?$/.test(location.pathname);
  if(!onHub){
    /* NVHERE: each app keeps its own screens – NVHERE.save('<app>.here', {V}) when it goes to the background, and at the start
       NVHERE.take('<app>.here') gives them back only when the hub reopened this page after Android closed the app */
    const resumed = /[?&]nvresume=1/.test(location.search);
    if(resumed) try{ history.replaceState(null, '', location.pathname + location.search.replace(/([?&])nvresume=1(&|$)/, (m, a, b) => b ? a : '').replace(/[?&]$/, '') + location.hash) }catch(e){}
    window.NVHERE = {resumed,
      save(k, d){ try{ localStorage.setItem(k, JSON.stringify(Object.assign({}, d, {at:Date.now()}))) }catch(e){} },
      take(k, ms){ if(!resumed) return null; try{ const d = JSON.parse(localStorage.getItem(k) || 'null'); return d && Date.now() - (d.at || 0) < (ms || 3 * 3600e3) ? d : null }catch(e){ return null } }};
    const mark = () => { if(/[?&]open=/.test(location.search)) return; try{ localStorage.setItem(K, JSON.stringify({url:location.pathname + location.search.replace(/[?&]nvresume=1/, ''), at:Date.now()})) }catch(e){} };
    document.addEventListener('visibilitychange', () => { if(document.hidden) mark() }); addEventListener('pagehide', mark);
    return }
  let fresh = false; try{ fresh = !sessionStorage.getItem('nvSession'); sessionStorage.setItem('nvSession', '1') }catch(e){}
  let h = null; try{ h = JSON.parse(localStorage.getItem(K) || 'null'); localStorage.removeItem(K) }catch(e){}
  if(native && fresh && h && h.url && Date.now() - (h.at || 0) < 3 * 3600e3 && /^\/[\w-]+\//.test(h.url) && !/^\/hub\//.test(h.url)){
    try{ window.NVLOG && NVLOG.log('resume', 'back to ' + h.url) }catch(e){}
    location.replace(h.url + (h.url.includes('?') ? '&' : '?') + 'nvresume=1') }
})();
