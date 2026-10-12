#!/usr/bin/env python3
"""Makes hub/apps.json from hub/apps.src.json: every app gets a version (from the contents of its files) and its download size.
Run from anywhere; the GitHub job 'Update app list' runs it after every change to an app."""
import hashlib, json, os, time
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = json.load(open(os.path.join(root, 'hub', 'apps.src.json'), encoding='utf-8'))
try: old = {a['id']: a for a in json.load(open(os.path.join(root, 'hub', 'apps.json'), encoding='utf-8'))['apps']}
except Exception: old = {}
out = []
for a in src['apps']:
    h, size, files = hashlib.sha256(), 0, []
    for f in a.get('files', []):
        p = os.path.join(root, f)
        if not os.path.isfile(p): raise SystemExit(f"{a['id']}: missing file {f}")
        b = open(p, 'rb').read(); h.update(f.encode() + b'\0' + b); size += len(b); files.append({"path": f, "size": len(b)})
    e = dict(a, files=files, size=size, hash=h.hexdigest()[:12])
    o = old.get(a['id'])
    e['version'] = o['version'] if o and o.get('hash') == e['hash'] else time.strftime('%Y.%m.%d.%H%M')
    e['updated'] = o.get('updated') if o and o.get('hash') == e['hash'] else time.strftime('%Y-%m-%d')
    out.append(e)
json.dump({"format": "nightvault-apps", "v": 1, "apps": out}, open(os.path.join(root, 'hub', 'apps.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for e in out: print(f"{e['id']:8} {e['version']:16} {e['size'] / 1024:8.0f} KB  {len(e['files'])} files")
