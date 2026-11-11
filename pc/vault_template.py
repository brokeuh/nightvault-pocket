"""Card templates: open a layered PSD (for example the merged One Piece template), choose which layer versions are on with
dropdowns, preview the card, and save a PNG or a PSD with exactly those layers switched on.
Pure Python (+ Pillow for the layer pictures) - no Photoshop and no psd-tools needed. Everything stays on this PC.
Only 8-bit RGB PSD files are supported (that is what the exports are)."""
import io
import os
import re
import struct
import threading
import zlib

_LOCK = threading.Lock()
_CACHE = {}            # path -> (mtime, size, parsed)


def _u32(d, p):
    return struct.unpack(">I", d[p:p + 4])[0]


def safe_name(n):
    n = re.sub(r"[^A-Za-z0-9._ \-()+]", "_", os.path.basename(n or "")).strip(" .")
    if not n.lower().endswith(".psd"):
        n += ".psd"
    return n[:120] or "template.psd"


def scan(path):
    """Reads the layer table of a PSD (not the pixels). Returns dict(size, layers) - layers bottom to top, with group markers."""
    st = os.stat(path)
    key = (st.st_mtime, st.st_size)
    with _LOCK:
        c = _CACHE.get(path)
        if c and c[0] == key:
            return c[1]
    with open(path, "rb") as f:
        head = f.read(26)
        if head[:4] != b"8BPS":
            raise ValueError("This is not a PSD file.")
        ver = struct.unpack(">H", head[4:6])[0]
        if ver != 1:
            raise ValueError("Only normal PSD files are supported (not the big PSB kind).")
        H, W = struct.unpack(">II", head[14:22])
        depth, mode = struct.unpack(">HH", head[22:26])
        if depth != 8 or mode != 3:
            raise ValueError("Only 8-bit RGB PSD files are supported (this one is %d-bit, mode %d)." % (depth, mode))
        p = 26
        for _ in range(2):
            f.seek(p)
            p += 4 + _u32(f.read(4), 0)
        f.seek(p)
        lm_len = _u32(f.read(4), 0)
        p += 4
        f.seek(p)
        info_len = _u32(f.read(4), 0)
        p += 4
        if info_len == 0:
            raise ValueError("This PSD has no layers.")
        f.seek(p)
        blob = f.read(info_len)
    pos = p                      # absolute offset of blob[0]
    n = abs(struct.unpack(">h", blob[:2])[0])
    q = 2
    recs = []
    for i in range(n):
        top, left, bottom, right = struct.unpack(">iiii", blob[q:q + 16])
        q += 16
        nc = struct.unpack(">H", blob[q:q + 2])[0]
        q += 2
        ch = []
        for c in range(nc):
            cid, ln = struct.unpack(">hI", blob[q:q + 6])
            q += 6
            ch.append((cid, ln))
        key_ = blob[q + 4:q + 8]
        opacity = blob[q + 8]
        flag_off = pos + q + 10
        flags = blob[q + 10]
        q += 12
        el = _u32(blob, q)
        q += 4
        end = q + el
        e = q
        e += 4 + _u32(blob, e)
        e += 4 + _u32(blob, e)
        nl = blob[e]
        name = blob[e + 1:e + 1 + nl].decode("latin1")
        e += 1 + nl + ((4 - (1 + nl) % 4) % 4)
        section = 0
        text = False
        while e + 12 <= end:
            if blob[e:e + 4] not in (b"8BIM", b"8B64"):
                break
            k = blob[e + 4:e + 8]
            ln = _u32(blob, e + 8)
            data = blob[e + 12:e + 12 + ln]
            e += 12 + ln + (ln % 2)
            if k == b"luni":
                cnt = _u32(data, 0)
                name = data[4:4 + cnt * 2].decode("utf-16-be", "replace")
            elif k == b"lsct":
                section = _u32(data, 0)
            elif k in (b"TySh", b"tySh"):
                text = True
        recs.append(dict(i=i, name=name, rect=(left, top, right, bottom), ch=ch, blend=key_.decode("latin1"), opacity=opacity,
                         flag_off=flag_off, visible=not (flags & 2), section=section, text=text))
        q = end
    off = pos + q            # pixel data of layer 0 starts here
    for r in recs:
        segs = []
        for cid, ln in r["ch"]:
            segs.append((cid, off, ln))
            off += ln
        r["segs"] = segs
    res = dict(size=(W, H), layers=recs)
    with _LOCK:
        _CACHE[path] = (key, res)
    return res


def structure(path):
    """Groups and layers in a form for the page: items from bottom to top.
    group items: dict(kind='group', name, kids=[layer...]) ; single items: dict(kind='layer', ...)"""
    sc = scan(path)
    items = []
    stack = []
    for r in sc["layers"]:
        s = r["section"]
        if s == 3:                           # end divider = start of a group when reading bottom to top
            stack.append([])
        elif s in (1, 2):
            kids = stack.pop() if stack else []
            g = dict(kind="group", name=r["name"], kids=kids)
            (stack[-1] if stack else items).append(g)
        else:
            lay = dict(kind="layer", i=r["i"], name=r["name"], visible=r["visible"], text=r["text"], op=r["opacity"],
                       blend=r["blend"], rect=list(r["rect"]), empty=(r["rect"][2] <= r["rect"][0] or r["rect"][3] <= r["rect"][1]))
            (stack[-1] if stack else items).append(lay)
    return dict(size=list(sc["size"]), items=items)


def _packbits(buf, n):
    out = bytearray()
    i = 0
    ln = len(buf)
    while len(out) < n and i < ln:
        c = buf[i]
        i += 1
        if c < 128:
            out += buf[i:i + c + 1]
            i += c + 1
        elif c > 128:
            out += buf[i:i + 1] * (257 - c)
            i += 1
    return bytes(out[:n])


def layer_png(path, index):
    """The pixels of one layer as a PNG (RGBA, the size of the layer). Returns (png_bytes, left, top)."""
    from PIL import Image
    sc = scan(path)
    r = sc["layers"][index]
    left, top, right, bottom = r["rect"]
    w, h = right - left, bottom - top
    if w <= 0 or h <= 0:
        im = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        b = io.BytesIO()
        im.save(b, "PNG")
        return b.getvalue(), 0, 0
    planes = {}
    with open(path, "rb") as f:
        for cid, off, ln in r["segs"]:
            f.seek(off)
            seg = f.read(ln)
            comp = struct.unpack(">H", seg[:2])[0]
            body = seg[2:]
            if comp == 0:
                raw = body[:w * h]
            elif comp == 1:
                cnt = struct.unpack(">%dH" % h, body[:2 * h])
                o = 2 * h
                rows = []
                for c in cnt:
                    rows.append(_packbits(body[o:o + c], w))
                    o += c
                raw = b"".join(rows)
            elif comp == 2:
                raw = zlib.decompress(body)
            else:                                    # 3 = zip with prediction
                raw = bytearray(zlib.decompress(body))
                for y in range(h):
                    base = y * w
                    for x in range(1, w):
                        raw[base + x] = (raw[base + x] + raw[base + x - 1]) & 255
                raw = bytes(raw)
            if len(raw) < w * h:
                raw = raw + b"\0" * (w * h - len(raw))
            planes[cid] = Image.frombytes("L", (w, h), raw[:w * h])
    z = Image.new("L", (w, h), 0)
    full = Image.new("L", (w, h), 255)
    rgb = [planes.get(0, z), planes.get(1, z), planes.get(2, z)]
    a = planes.get(-1, full)
    im = Image.merge("RGBA", rgb + [a])
    b = io.BytesIO()
    im.save(b, "PNG", compress_level=3)
    return b.getvalue(), left, top


def save_psd(path, dest, visible):
    """Copies the PSD to dest with exactly the layers in `visible` (set of layer indexes) switched on. Groups stay on."""
    sc = scan(path)
    data = bytearray(open(path, "rb").read())
    on = set(int(x) for x in visible)
    for r in sc["layers"]:
        if r["section"] in (1, 2, 3):
            fl = data[r["flag_off"]] & ~2
        else:
            fl = data[r["flag_off"]] & ~2
            if r["i"] not in on:
                fl |= 2
        data[r["flag_off"]] = fl
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return dest
