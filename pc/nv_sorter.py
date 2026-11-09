"""Nightvault Sorter – puts books into publisher folders (owner, 21 Oct 2026).

Made for the colouring books on Google Drive: with "Google Drive for desktop" the Drive is a normal folder on the PC
(like G:\\My Drive\\…). The Sorter looks at an INBOX folder ("New to sort"), suggests a publisher folder for every file and
moves the ticked ones into TARGET\\<publisher> ("Cozy Books sorted\\Emily Cozy"). Moving inside the Drive is a rename, so
Google only moves the file – nothing is uploaded again. Nothing is ever deleted; "Undo last move" puts files back.

How it guesses (best first):
  1. your own choices: when you pick a publisher by hand, the distinctive word of that file is remembered ("emilycozy" → Emily Cozy)
  2. the name of a publisher folder inside the file name ("22_EmilyCozy_FairyBuddies.pdf" → folder "Emily Cozy")
  3. words that only show up in the files of ONE publisher folder (learned from the books already sorted)
  4. an author at the end of the name ("… - Naomi Lord.pdf") → a NEW folder (not ticked: you decide)

Start: double-click "Nightvault Sorter.bat" (or: py -3 nv_sorter.py). It opens http://127.0.0.1:8766 in the browser.
Settings and memory: sorter.json next to this file. Only Python's standard library is used.
"""
import json, os, re, shutil, sys, threading, time, unicodedata, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
CONF = os.path.join(HERE, 'sorter.json')
PORT = int(os.environ.get('NV_SORTER_PORT', '8766'))
BOOK_EXT = {'.pdf', '.cbz', '.cbr', '.zip', '.rar', '.epub', '.cb7', '.7z', '.jpg', '.jpeg', '.png', '.webp', '.avif'}
SKIP_DIRS = {'images', "pdf's", 'pdfs', 'pdf'}          # sub folders that belong to a book set, not a publisher
COMMON = {'the', 'and', 'for', 'with', 'book', 'books', 'coloring', 'colouring', 'color', 'colour', 'world', 'pdf', 'com', 'www',
          'edition', 'vol', 'volume', 'part', 'cute', 'cozy', 'little', 'adult', 'kids', 'pages', 'page', 'art', 'class', 'collection'}
LOCK = threading.Lock()


def load():
    try:
        with open(CONF, encoding='utf-8') as f:
            c = json.load(f)
    except Exception:
        c = {}
    c.setdefault('inbox', ''); c.setdefault('target', ''); c.setdefault('aliases', {}); c.setdefault('history', []); c.setdefault('auto', False)
    return c


def save(c):
    tmp = CONF + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(c, f, ensure_ascii=False, indent=1)
    os.replace(tmp, CONF)


def compact(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '', s)


def words(name):
    """'22_EmilyCozy_FairyBuddies_ColoringWorld.pdf' → ['emily', 'cozy', 'emilycozy', 'fairy', 'buddies', 'fairybuddies', …]"""
    stem = os.path.splitext(name)[0]
    out = []
    for part in re.split(r'[\s_\-.()\[\]+,&!@#]+', stem):
        if not part or part.isdigit():
            continue
        pieces = re.findall(r'[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+', part)
        for p in pieces:
            c = compact(p)
            if len(c) >= 3 and not c.isdigit():
                out.append(c)
        c = compact(part)
        if len(pieces) > 1 and len(c) >= 4:
            out.append(c)
    return out


def publishers(target):
    if not target or not os.path.isdir(target):
        return []
    return sorted([d for d in os.listdir(target) if os.path.isdir(os.path.join(target, d)) and not d.startswith('.')], key=str.lower)


def book_files(folder, skip_dirs=True):
    """every book file under a folder (relative paths)"""
    out = []
    for dp, dn, fn in os.walk(folder):
        dn[:] = [d for d in dn if not d.startswith('.')]
        for f in fn:
            if os.path.splitext(f)[1].lower() in BOOK_EXT and not f.startswith('.'):
                out.append(os.path.relpath(os.path.join(dp, f), folder))
    return sorted(out, key=str.lower)


def learn_words(target, pubs):
    """words that (almost) only show up in the files of one publisher folder → that publisher"""
    seen = {}
    for p in pubs:
        for rel in book_files(os.path.join(target, p)):
            for w in set(words(os.path.basename(rel))):
                if w in COMMON:
                    continue
                seen.setdefault(w, {}).setdefault(p, 0)
                seen[w][p] += 1
    out = {}
    for w, by in seen.items():
        top = max(by, key=by.get); n = by[top]; total = sum(by.values())
        if n >= 2 and n / total >= 0.9:
            out[w] = top
    return out


def author_of(name):
    stem = os.path.splitext(name)[0].replace('_', ' ').strip()
    m = re.search(r'\s[-–]\s+([A-Z][\w\'.]+(?:\s+[A-Z][\w\'.]+){0,3})\s*$', stem)
    return m.group(1).strip() if m else ''


def suggest(name, pubs, aliases, learned):
    ws = words(name); cn = compact(os.path.splitext(name)[0])
    for w in ws:                                                    # 1. your own choices
        if w in aliases and aliases[w] in pubs:
            return aliases[w], 'you chose this before', 'sure'
    best = ''
    for p in pubs:                                                  # 2. the folder name inside the file name
        cp = compact(p)
        if len(cp) >= 4 and cp in cn and len(cp) > len(compact(best)):
            best = p
    if best:
        return best, 'the folder name is in the file name', 'sure'
    votes = {}
    for w in ws:                                                    # 3. words only that publisher uses
        if w in learned and learned[w] in pubs:
            votes[learned[w]] = votes.get(learned[w], 0) + 1
    if votes:
        p = max(votes, key=votes.get)
        return p, 'words from the books already in that folder', 'sure' if len(votes) == 1 else 'maybe'
    a = author_of(name)                                             # 4. an author → a new folder
    if a:
        for p in pubs:
            if compact(p) == compact(a):
                return p, 'the author is in the name', 'sure'
        return a, 'the author is in the name (new folder)', 'new'
    return '', 'no idea yet – pick one', 'unknown'


def plan(c):
    inbox, target = c['inbox'], c['target']
    if not (inbox and os.path.isdir(inbox) and target and os.path.isdir(target)):
        return []
    pubs = publishers(target); learned = learn_words(target, pubs); rows = []
    for rel in book_files(inbox):
        name = os.path.basename(rel)
        p, why, how = suggest(name, pubs, c['aliases'], learned)
        try:
            size = os.path.getsize(os.path.join(inbox, rel))
        except OSError:
            size = 0
        rows.append({'rel': rel, 'name': name, 'size': size, 'pub': p, 'why': why, 'how': how})
    return rows


def free_name(folder, name):
    base, ext = os.path.splitext(name); n = 2; cand = name
    while os.path.exists(os.path.join(folder, cand)):
        cand = f'{base} ({n}){ext}'; n += 1
    return cand


def remember(c, name, pub, target, learned):
    """a choice by hand: remember a word of the file name for this publisher – only a word that the publisher's other books
    have too (so "Little Cats" → KIKY does not make every cat book KIKY)"""
    others = set()
    for rel in book_files(os.path.join(target, pub)):
        if os.path.basename(rel) != name:
            others |= set(words(os.path.basename(rel)))
    for w in words(name):
        if w in COMMON or len(w) < 4 or w not in others or learned.get(w) not in (None, pub):
            continue
        c['aliases'][w] = pub
        return


def move(c, moves):
    inbox, target = c['inbox'], c['target']
    pubs = publishers(target); learned = learn_words(target, pubs); batch = []; errors = []
    for m in moves:
        rel, pub = m.get('rel', ''), (m.get('pub') or '').strip()
        if not pub or re.search(r'[\\/:*?"<>|]', pub) or pub in ('.', '..'):
            errors.append(f'{rel}: not a usable folder name'); continue
        src = os.path.normpath(os.path.join(inbox, rel))
        if not src.startswith(os.path.normpath(inbox) + os.sep) or not os.path.isfile(src):
            errors.append(f'{rel}: not found'); continue
        dest_dir = os.path.join(target, pub)
        try:
            made = not os.path.isdir(dest_dir)
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, free_name(dest_dir, os.path.basename(rel)))
            shutil.move(src, dest)
            batch.append({'from': src, 'to': dest, 'made': made})
            if m.get('byhand'):
                remember(c, os.path.basename(rel), pub, target, learned)
        except Exception as e:
            errors.append(f'{rel}: {e}')
    if batch:
        c['history'] = (c['history'] + [{'at': time.strftime('%Y-%m-%d %H:%M'), 'moves': batch}])[-30:]
    save(c)
    return len(batch), errors


def undo(c):
    if not c['history']:
        return 0, ['Nothing to undo']
    batch = c['history'].pop(); n = 0; errors = []
    for m in reversed(batch['moves']):
        try:
            os.makedirs(os.path.dirname(m['from']), exist_ok=True)
            back = os.path.join(os.path.dirname(m['from']), free_name(os.path.dirname(m['from']), os.path.basename(m['from'])))
            shutil.move(m['to'], back); n += 1
            d = os.path.dirname(m['to'])
            if m.get('made') and os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)                                          # a folder the Sorter made and is empty again
        except Exception as e:
            errors.append(f"{os.path.basename(m['to'])}: {e}")
    save(c)
    return n, errors


def subfolders(path):
    if not path:
        if os.name == 'nt':
            import string
            return [f'{d}:\\' for d in string.ascii_uppercase if os.path.isdir(f'{d}:\\')]
        return ['/']
    try:
        return sorted([os.path.join(path, d) for d in os.listdir(path) if os.path.isdir(os.path.join(path, d)) and not d.startswith(('.', '$'))], key=str.lower)
    except OSError:
        return []


def auto_loop():
    while True:
        time.sleep(60)
        with LOCK:
            c = load()
            if c.get('auto'):
                rows = [r for r in plan(c) if r['how'] == 'sure']
                if rows:
                    n, _ = move(c, [{'rel': r['rel'], 'pub': r['pub']} for r in rows])
                    print(f'auto: {n} moved')


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype='application/json; charset=utf-8'):
        b = body if isinstance(body, bytes) else (json.dumps(body, ensure_ascii=False) if not isinstance(body, str) else body).encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == '/':
            return self.send(200, PAGE, 'text/html; charset=utf-8')
        if u.path == '/api/state':
            with LOCK:
                c = load(); pubs = publishers(c['target'])
                return self.send(200, {'inbox': c['inbox'], 'target': c['target'], 'auto': c['auto'], 'pubs': pubs, 'rows': plan(c),
                                       'undo': (c['history'][-1]['at'] + ' · ' + str(len(c['history'][-1]['moves'])) + ' files') if c['history'] else '',
                                       'ok': bool(c['inbox'] and os.path.isdir(c['inbox']) and c['target'] and os.path.isdir(c['target']))})
        if u.path == '/api/browse':
            p = (q.get('path') or [''])[0]
            return self.send(200, {'path': p, 'up': os.path.dirname(p.rstrip('\\/')) if p and os.path.dirname(p.rstrip('\\/')) != p.rstrip('\\/') else '', 'dirs': subfolders(p)})
        self.send(404, {'error': 'not found'})

    def do_POST(self):
        u = urlparse(self.path)
        if self.headers.get('Origin') not in (None, f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
            return self.send(403, {'error': 'not from this PC'})
        with LOCK:
            c = load(); b = self.body()
            if u.path == '/api/config':
                for k in ('inbox', 'target'):
                    if k in b:
                        c[k] = b[k].strip().strip('"')
                if 'auto' in b:
                    c['auto'] = bool(b['auto'])
                save(c); return self.send(200, {'ok': True})
            if u.path == '/api/move':
                n, err = move(c, b.get('moves') or []); return self.send(200, {'moved': n, 'errors': err})
            if u.path == '/api/undo':
                n, err = undo(c); return self.send(200, {'back': n, 'errors': err})
        self.send(404, {'error': 'not found'})


PAGE = r'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nightvault Sorter</title>
<style>
:root{--bg:#0b0e13;--card:#151a22;--line:#262e3b;--txt:#e8ecf2;--dim:#93a0b4;--acc:#c9893a;--ok:#5fd08b;--warn:#e6b450;--bad:#e8776b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:18px 16px 60px}h1{font-size:22px;margin:0 0 2px}.dim{color:var(--dim)}.small{font-size:12.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}.row label{min-width:120px;color:var(--dim)}
input[type=text],select{background:#0f131a;color:var(--txt);border:1px solid var(--line);border-radius:9px;padding:7px 9px;font:inherit}
input[type=text]{flex:1;min-width:240px}button{background:#222a36;color:var(--txt);border:1px solid #33405a;border-radius:9px;padding:7px 12px;font:inherit;cursor:pointer}
button.pri{background:var(--acc);border-color:var(--acc);color:#1a1206;font-weight:700}button:disabled{opacity:.5;cursor:default}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.chip{border-radius:99px;padding:5px 12px}.chip.on{background:#3a2816;border-color:var(--acc);color:#f3c58a}
table{width:100%;border-collapse:collapse}td,th{padding:6px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--dim);font-weight:600;font-size:12.5px}
td.n{word-break:break-word}td select{max-width:240px}.how{font-size:11.5px;padding:2px 8px;border-radius:99px;white-space:nowrap}
.sure{background:#173a2a;color:var(--ok)}.maybe{background:#3a3216;color:var(--warn)}.new{background:#16283a;color:#7fc3ff}.unknown{background:#3a1c1a;color:var(--bad)}
#browse{position:fixed;inset:0;background:#000a;display:none;align-items:center;justify-content:center}#browse .card{width:min(560px,92vw);max-height:80vh;overflow:auto}
.li{padding:7px 8px;border-radius:8px;cursor:pointer}.li:hover{background:#1d2430}#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#222a36;padding:10px 16px;border-radius:12px;display:none}
</style></head><body><main>
<h1>Nightvault Sorter</h1><div class="dim small">Puts books from your “to sort” folder into publisher folders. Nothing is deleted; Undo puts files back.</div>
<div class="card"><div class="row"><label>To sort</label><input type="text" id="inbox" placeholder="G:\My Drive\Colouring books\New to sort"><button data-br="inbox">Browse…</button></div>
<div class="row"><label>Publisher folders in</label><input type="text" id="target" placeholder="G:\My Drive\Colouring books\Cozy Books sorted"><button data-br="target">Browse…</button></div>
<div class="row"><label></label><button class="pri" id="savecfg">Save and look</button><label style="min-width:0;color:var(--txt)"><input type="checkbox" id="auto"> Move the sure ones by themselves every minute while the Sorter is open</label></div></div>
<div id="list"></div></main>
<div id="browse"><div class="card"><b id="brp"></b><div id="brl" style="margin:8px 0"></div><div class="row"><button id="brok" class="pri">Use this folder</button><button id="brx">Cancel</button></div></div></div>
<div id="toast"></div>
<script>
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
let S = null, F = 'all', PICK = {}, TICK = {};
const toast = t => { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => e.style.display = 'none', 4000) };
const api = async (p, b) => { const r = await fetch(p, b ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)} : {}); return r.json() };
async function load(){ S = await api('/api/state'); $('#inbox').value = S.inbox; $('#target').value = S.target; $('#auto').checked = S.auto; PICK = {}; TICK = {};
  for(const r of S.rows){ PICK[r.rel] = r.pub; TICK[r.rel] = r.how === 'sure' } draw() }
function draw(){ if(!S.ok){ $('#list').innerHTML = '<div class="card dim">Pick the two folders above. With Google Drive for desktop your Drive is a drive letter (often G:) → My Drive.</div>'; return }
  const cnt = k => S.rows.filter(r => k === 'all' || r.how === k).length, rows = S.rows.filter(r => F === 'all' || r.how === F), n = S.rows.filter(r => TICK[r.rel] && PICK[r.rel]).length;
  let h = `<div class="card"><div class="row" style="justify-content:space-between"><b>${S.rows.length} files to sort · ${S.pubs.length} publisher folders</b><span><button id="look">Look again</button> <button id="undo" ${S.undo ? '' : 'disabled'} title="${esc(S.undo)}">Undo last move</button> <button class="pri" id="go" ${n ? '' : 'disabled'}>Move ${n} ticked</button></span></div>`;
  h += `<div class="chips">${[['all','All'],['sure','Sure'],['maybe','Not sure'],['new','New folder'],['unknown','No idea']].map(([k,t]) => `<button class="chip ${F === k ? 'on' : ''}" data-f="${k}">${t} (${cnt(k)})</button>`).join('')}
    <span style="flex:1"></span><button data-tickall="1">Tick all shown</button><button data-tickall="0">Untick all shown</button></div>`;
  h += `<table><tr><th></th><th>File</th><th>Publisher folder</th><th>Why</th></tr>${rows.slice(0, 1500).map(r => `<tr><td><input type="checkbox" data-t="${esc(r.rel)}" ${TICK[r.rel] ? 'checked' : ''}></td>
    <td class="n">${esc(r.name)}<div class="dim small">${esc(r.rel.includes('\\') || r.rel.includes('/') ? r.rel.replace(/[\\/][^\\/]*$/, '') + ' · ' : '')}${mb(r.size)}</div></td>
    <td><select data-p="${esc(r.rel)}"><option value="">– pick –</option>${[...new Set([...(PICK[r.rel] && !S.pubs.includes(PICK[r.rel]) ? [PICK[r.rel]] : []), ...S.pubs])].map(p => `<option ${p === PICK[r.rel] ? 'selected' : ''}>${esc(p)}</option>`).join('')}<option value="__new">New folder…</option></select></td>
    <td><span class="how ${r.how}">${esc(r.why)}</span></td></tr>`).join('')}</table>${rows.length > 1500 ? '<div class="dim small">Showing the first 1500.</div>' : ''}</div>`;
  $('#list').innerHTML = h }
document.addEventListener('click', async e => { const t = e.target;
  if(t.dataset.f){ F = t.dataset.f; draw() }
  if(t.dataset.tickall){ for(const r of S.rows) if(F === 'all' || r.how === F) TICK[r.rel] = t.dataset.tickall === '1'; draw() }
  if(t.id === 'look') load();
  if(t.id === 'savecfg'){ await api('/api/config', {inbox:$('#inbox').value, target:$('#target').value}); load() }
  if(t.id === 'go'){ const moves = S.rows.filter(r => TICK[r.rel] && PICK[r.rel]).map(r => ({rel:r.rel, pub:PICK[r.rel], byhand:PICK[r.rel] !== r.pub}));
    t.disabled = true; t.textContent = 'Moving…'; const r = await api('/api/move', {moves}); toast(`${r.moved} moved${r.errors.length ? ' · ' + r.errors.length + ' could not: ' + r.errors[0] : ''}`); load() }
  if(t.id === 'undo'){ if(!confirm('Put the files of the last move back where they were?')) return; const r = await api('/api/undo', {}); toast(`${r.back} files put back${r.errors.length ? ' · ' + r.errors[0] : ''}`); load() }
  if(t.dataset.br){ BR.key = t.dataset.br; br($('#' + BR.key).value) }
  const li = t.closest('[data-dir]'); if(li) br(li.dataset.dir);
  if(t.id === 'brok'){ $('#' + BR.key).value = BR.path; $('#browse').style.display = 'none' }
  if(t.id === 'brx') $('#browse').style.display = 'none' });
document.addEventListener('change', async e => { const t = e.target;
  if(t.dataset.t){ TICK[t.dataset.t] = t.checked; draw() }
  if(t.dataset.p){ let v = t.value; if(v === '__new'){ v = (prompt('Name of the new publisher folder') || '').trim(); if(!v){ draw(); return } } PICK[t.dataset.p] = v; TICK[t.dataset.p] = !!v; draw() }
  if(t.id === 'auto'){ await api('/api/config', {auto:t.checked}); toast(t.checked ? 'Sure ones are moved by themselves every minute while this is open' : 'Automatic moving is off') } });
const BR = {key:'', path:''};
async function br(p){ const r = await api('/api/browse?path=' + encodeURIComponent(p || '')); BR.path = r.path; $('#browse').style.display = 'flex';
  $('#brp').textContent = r.path || 'This PC'; $('#brl').innerHTML = (r.path ? `<div class="li" data-dir="${esc(r.up)}">⬆ Up</div>` : '') + r.dirs.map(d => `<div class="li" data-dir="${esc(d)}">📁 ${esc(d.replace(/^.*[\\/](?=.)/, ''))}</div>`).join('');
  $('#brok').disabled = !r.path }
load();
</script></body></html>'''


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    threading.Thread(target=auto_loop, daemon=True).start()
    url = f'http://127.0.0.1:{PORT}/'
    print('Nightvault Sorter is running at', url, '– close this window to stop it.')
    if '--no-browser' not in sys.argv:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
