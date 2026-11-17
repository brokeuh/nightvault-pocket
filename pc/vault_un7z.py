"""Opens .7z archives (pure Python, needs only the lzma module that ships with Python) so the Proxyshop template
importer can read a PSD out of a download without 7-Zip.  Supports the usual LZMA / LZMA2 archives.
Files are streamed to disk one at a time, so a 1 GB PSD never has to fit in memory."""
import lzma
import os
import struct
import zlib


def rd_num(b, p):
    f = b[p]; p += 1; m = 0x80; v = 0
    for i in range(8):
        if f & m == 0:
            hi = f & (m - 1); v |= hi << (8 * i); return v, p
        v |= b[p] << (8 * i); p += 1; m >>= 1
    return v, p
def bitvec(b, p, n, allDefinedCheck=False):
    if allDefinedCheck:
        alld = b[p]; p += 1
        if alld: return [True]*n, p
    out = []; byte = 0; mask = 0
    for i in range(n):
        if mask == 0: byte = b[p]; p += 1; mask = 0x80
        out.append(bool(byte & mask)); mask >>= 1
    return out, p
def parse_streams(b, p):
    info = {'packPos':0,'packSizes':[],'folders':[],'subs':None}
    while True:
        t = b[p]; p += 1
        if t == 0: break
        if t == 6:  # PackInfo
            info['packPos'], p = rd_num(b, p); n, p = rd_num(b, p)
            while True:
                t2 = b[p]; p += 1
                if t2 == 0: break
                if t2 == 9:
                    for i in range(n): s, p = rd_num(b, p); info['packSizes'].append(s)
                elif t2 == 10:
                    defs, p = bitvec(b, p, n, True)
                    for d in defs:
                        if d: p += 4
        elif t == 7:  # UnpackInfo
            assert b[p] == 0x0B; p += 1
            nf, p = rd_num(b, p); ext = b[p]; p += 1; assert ext == 0
            for _ in range(nf):
                nc, p = rd_num(b, p); coders = []; nin = 0; nout = 0
                for _ in range(nc):
                    fl = b[p]; p += 1; idl = fl & 15; cid = bytes(b[p:p+idl]); p += idl
                    ni = no = 1
                    if fl & 0x10: ni, p = rd_num(b, p); no, p = rd_num(b, p)
                    props = b''
                    if fl & 0x20:
                        pl, p = rd_num(b, p); props = bytes(b[p:p+pl]); p += pl
                    coders.append((cid, props, ni, no)); nin += ni; nout += no
                npk = nin - (nout - 1)
                binds = []
                for _ in range(nout - 1):
                    a, p = rd_num(b, p); c, p = rd_num(b, p); binds.append((a, c))
                if npk > 1:
                    for _ in range(npk): _, p = rd_num(b, p)
                info['folders'].append({'coders':coders,'binds':binds,'sizes':[]})
            assert b[p] == 0x0C; p += 1
            for f in info['folders']:
                for c in f['coders']:
                    for _ in range(c[3]):
                        s, p = rd_num(b, p); f['sizes'].append(s)
            while True:
                t2 = b[p]; p += 1
                if t2 == 0: break
                if t2 == 10:
                    defs, p = bitvec(b, p, len(info['folders']), True)
                    for d in defs:
                        if d: p += 4
        elif t == 8:  # SubStreamsInfo
            nfold = len(info['folders']); counts = [1]*nfold; sizes = None
            while True:
                t2 = b[p]; p += 1
                if t2 == 0: break
                if t2 == 13:
                    for i in range(nfold): counts[i], p = rd_num(b, p)
                elif t2 == 9:
                    sizes = []
                    for i in range(nfold):
                        tot = info['folders'][i]['sizes'][-1]; s = 0
                        for _ in range(counts[i]-1):
                            v, p = rd_num(b, p); sizes.append(v); s += v
                        if counts[i]: sizes.append(tot - s)
                elif t2 == 10:
                    nd = sum(counts[i] if counts[i] != 1 else 0 for i in range(nfold))
                    defs, p = bitvec(b, p, nd, True)
                    for d in defs:
                        if d: p += 4
            if sizes is None:
                sizes = []
                for i in range(nfold):
                    if counts[i] == 1: sizes.append(info['folders'][i]['sizes'][-1])
            info['subs'] = (counts, sizes)
    return info, p


def _coder_filters(coder):
    cid, props = coder[0], coder[1]
    if cid == b"\x21":
        ds = props[0]
        dict_size = (2 | (ds & 1)) << (ds // 2 + 11) if ds < 40 else 0xFFFFFFFF
        return [{"id": lzma.FILTER_LZMA2, "dict_size": dict_size}]
    if cid == b"\x03\x01\x01":
        d = props[0]
        lc = d % 9
        d //= 9
        return [{"id": lzma.FILTER_LZMA1, "dict_size": struct.unpack("<I", props[1:5])[0], "lc": lc, "lp": d % 5, "pb": d // 5}]
    if cid == b"\x00":
        return None
    raise ValueError("This 7z uses a packing method I cannot open (%r). Unpack it once with 7-Zip instead." % (cid,))


def _folder_stream(f, base, info, fi, chunk=1 << 20):
    """Yields the unpacked bytes of one folder (single coder chain: LZMA/LZMA2/copy)."""
    fo = info["folders"][fi]
    if len(fo["coders"]) != 1:
        raise ValueError("This 7z uses a filter chain I cannot open. Unpack it once with 7-Zip instead.")
    off = base + info["packPos"] + sum(info["packSizes"][:fi])
    left = info["packSizes"][fi]
    flt = _coder_filters(fo["coders"][0])
    dec = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=flt) if flt else None
    f.seek(off)
    while left > 0:
        b = f.read(min(chunk, left))
        if not b:
            break
        left -= len(b)
        yield dec.decompress(b) if dec else b


def _read_all(f, base, info, fi):
    return b"".join(_folder_stream(f, base, info, fi))


def listing(path):
    """[(name, size)] of the files inside, in archive order, plus the internal tables needed to extract."""
    with open(path, "rb") as f:
        head = f.read(32)
        if head[:6] != b"7z\xbc\xaf\x27\x1c":
            raise ValueError("Not a 7z file.")
        nho, nhs, _ = struct.unpack("<QQI", head[12:32])
        f.seek(32 + nho)
        hdr = f.read(nhs)
        while hdr[0] == 0x17:                         # header is itself packed
            info, _p = parse_streams(hdr, 1)
            hdr = _read_all(f, 32, info, 0)
    p = 1
    sinfo = None
    names, empty = [], []
    while True:
        t = hdr[p]
        p += 1
        if t == 0:
            break
        if t == 4:
            sinfo, p = parse_streams(hdr, p)
        elif t == 5:
            nfiles, p = rd_num(hdr, p)
            empty = [False] * nfiles
            while True:
                t2 = hdr[p]
                p += 1
                if t2 == 0:
                    break
                sz, p = rd_num(hdr, p)
                q = p + sz
                if t2 == 17:
                    names = hdr[p + 1:q].decode("utf-16le").split("\x00")[:nfiles]
                elif t2 == 14:
                    empty, _p = bitvec(hdr, p, nfiles)
                p = q
    ne = [n for n, e in zip(names, empty) if not e]
    counts, sizes = sinfo["subs"]
    out, k = [], 0
    for fi, c in enumerate(counts):
        for _ in range(c):
            out.append((ne[k], sizes[k], fi))
            k += 1
    return out, sinfo


def extract(path, member, dest, progress=None):
    """Writes the file called `member` (exact name inside the archive) to `dest`. Streams; skips other folders."""
    files, info = listing(path)
    hit = [x for x in files if x[0] == member]
    if not hit:
        raise FileNotFoundError(member)
    fi = hit[0][2]
    want = [x for x in files if x[2] == fi]
    pos = 0
    start = 0
    for n, s, _f in want:
        if n == member:
            start = pos
            size = s
            break
        pos += s
    end = start + size
    seen = 0
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    with open(path, "rb") as f, open(dest, "wb") as out:
        for blk in _folder_stream(f, 32, info, fi):
            a, b = max(start - seen, 0), min(end - seen, len(blk))
            if b > a:
                out.write(blk[a:b])
            seen += len(blk)
            if progress:
                progress(min(seen, end) / max(end, 1))
            if seen >= end:
                break
