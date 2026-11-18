"""Proxyshop template importer: reads a layered Proxyshop PSD (from a folder, a .zip or a .7z) on this PC and saves the
pieces the Magic card maker needs - every picture layer shrunk to card size, plus where every layer and text box sits -
as a small 'frame pack' folder.  Nothing is uploaded; the big PSD is only ever read, one layer at a time.
Uses the PSD reader of the Card templates tool (vault_template) and the small 7z reader (vault_un7z)."""
import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

import vault_template as vtpl
import vault_un7z as un7z

SCALE_W = 1632           # card width of the saved pieces (a PSD card is ~3264 wide, so this is half size)


def _safe(s):
    return re.sub(r"[^A-Za-z0-9._ \-]", "_", s).strip(" .")[:80] or "x"


def pack_dir(root, template):
    return Path(root) / "proxyshop" / _safe(template)


def import_psd(psd_path, out_dir, progress=None, scale_w=SCALE_W):
    """Saves layers.json + layers/NNN.png.  Returns the number of pictures saved.  Hidden layers are kept too: Proxyshop
    templates ship every colour variant switched off and switch the right one on when it renders a card."""
    from PIL import Image
    import io
    sc = vtpl.scan(psd_path)
    W, H = sc["size"]
    f = scale_w / float(W)
    out = Path(out_dir)
    (out / "layers").mkdir(parents=True, exist_ok=True)
    # path of every layer (group names from the bottom-up divider markers)
    path, items, stack = [], [], []
    for r in reversed(sc["layers"]):               # top to bottom, like Photoshop
        s = r["section"]
        if s == 3:
            if stack:
                stack.pop()
            continue
        items.append((list(stack), r))
        if s in (1, 2):
            stack.append(r["name"])
    meta = []
    todo = [(g, r) for g, r in items if r["section"] not in (1, 2)]
    n = 0
    for k, (g, r) in enumerate(todo):
        L, T, R, B = r["rect"]
        row = dict(i=r["i"], path=g, name=r["name"], visible=r["visible"], blend=r["blend"], opacity=r["opacity"],
                   text=r["text"], rect=[round(L * f, 1), round(T * f, 1), round(R * f, 1), round(B * f, 1)])
        if R > L and B > T and not r["text"] and "Legal" not in g[:1]:
            try:
                im, _l, _t = vtpl.layer_image(psd_path, r["i"])
                if abs(f - 0.5) < 0.01:
                    im = im.reduce(2)                       # exact half size, much faster than a resize
                else:
                    im = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.BOX)
                fn = "layers/%03d.png" % r["i"]
                im.save(out / fn, "PNG", compress_level=3)
                row["file"] = fn
                n += 1
            except Exception as e:                  # a layer we cannot read must not stop the whole template
                row["error"] = str(e)[:120]
        meta.append(row)
        if progress:
            progress((k + 1) / max(len(todo), 1))
    H2 = round(H * f)
    (out / "layers.json").write_text(json.dumps(dict(size=[scale_w, H2], source_size=[W, H], layers=meta), ensure_ascii=False))
    return n


def find_templates(folder):
    """Every PSD (or PSD inside a zip / 7z) under `folder`: [dict(kind, path, member, name, size)]."""
    res = []
    for p in sorted(Path(folder).rglob("*")):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        try:
            if ext == ".psd":
                res.append(dict(kind="psd", path=str(p), member=None, name=p.stem, size=p.stat().st_size))
            elif ext == ".zip":
                with zipfile.ZipFile(p) as z:
                    for i in z.infolist():
                        if i.filename.lower().endswith(".psd"):
                            res.append(dict(kind="zip", path=str(p), member=i.filename, name=Path(i.filename).stem, size=i.file_size))
            elif ext == ".7z":
                for nm, sz, _f in un7z.listing(str(p))[0]:
                    if nm.lower().endswith(".psd"):
                        res.append(dict(kind="7z", path=str(p), member=nm, name=Path(nm).stem, size=sz))
        except Exception as e:
            res.append(dict(kind="error", path=str(p), member=None, name=p.name, size=0, error=str(e)[:160]))
    return res


def import_one(t, root, progress=None):
    """Imports one entry of find_templates().  Unpacks big archives into a temporary folder that is deleted afterwards."""
    out = pack_dir(root, t["name"])
    tmp = None
    try:
        if t["kind"] == "psd":
            src = t["path"]
        else:
            tmp = tempfile.mkdtemp(prefix="nv_psd_")
            src = os.path.join(tmp, "t.psd")
            if t["kind"] == "zip":
                with zipfile.ZipFile(t["path"]) as z, z.open(t["member"]) as a, open(src, "wb") as b:
                    shutil.copyfileobj(a, b, 1 << 20)
            else:
                un7z.extract(t["path"], t["member"], src)
        return import_psd(src, out, progress)
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
