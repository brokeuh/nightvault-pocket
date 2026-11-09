"""Nightvault Cinema - the PC side of the extras (21 October 2026). Used by vault_phone.py for every address under /nv/cin/.

  Quality (watching away from home, weak Wi-Fi):
    GET /nv/cin/stream?id=..&start=s&a=n&h=720&fmt=mp4|ts&burn=<sub id>   -> converted on the fly; h = 0 keeps the size
  On the TV (the phone tells the TV which address to play; the TV fetches it from here itself - DLNA, not screen casting):
    GET /nv/cin/tv/<id>/<name>?k=..&cap=<sub id>                             -> the file as it is (byte ranges, DLNA headers,
                                                                                Samsung's subtitle header when cap is given)
    GET /nv/cin/tvs/<id>/<start>/<audio>/<h>/<burn or ->/v.ts?k=..           -> converted to MPEG-TS for the TV, subtitles burned in
    GET /nv/cin/tvsub/<id>/<sub id>/<shift>/s.srt?k=..                        -> a subtitle as SRT (shifted back by `shift` seconds)
  Subtitles found online and synced to the film:
    GET  /nv/cin/subs/setup                     -> {ok, user, key} (is OpenSubtitles set up; the password is never sent back)
    POST /nv/cin/subs/setup  {apikey, user, password}  -> tests the login and keeps it on the PC
    GET  /nv/cin/subs/find?id=..&langs=nl,en     -> finds, downloads, syncs and saves "<film>.<lang>.srt" next to the video
    GET  /nv/cin/subs/sync?id=..&s=<sub id>      -> syncs a subtitle that is already there (saved as "<film>.<lang>.synced.srt")
    GET  /nv/cin/subs/hashfind?hash=..&size=..&name=..&langs=..   -> for a video only on the phone: the subtitle text (no syncing)

The sync: the film's sound is turned into "talking / quiet" (ffmpeg's silencedetect), or - better - a subtitle track inside the file is
used as the guide; the subtitle is then moved (and stretched for 23.976 <-> 25 fps) to where it fits best. alass or ffsubsync are used
instead when they are installed (nightvault_tools or PATH)."""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

_ctx = {}           # set by vault_phone: get, put, ffmpeg(), cache_dir, video (vault.py's functions), vfile(id) -> path, log(text)
OS_API = os.environ.get("NIGHTVAULT_OS_API", "https://api.opensubtitles.com/api/v1")
UA = "Nightvault v1"
DLNA_FLAGS = "01700000000000000000000000000000"
TV_MIME = {".mkv": "video/x-matroska", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
           ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".webm": "video/webm", ".wmv": "video/x-ms-wmv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg"}
HEIGHT_RATE = {2160: "16M", 1440: "10M", 1080: "6M", 720: "3M", 480: "1.2M", 360: "800k"}
LANG_NAMES = {"nl": "Nederlands", "en": "English", "fr": "Français", "de": "Deutsch", "es": "Español", "it": "Italiano"}
_lock = threading.Lock()
_token = {"t": "", "at": 0, "base": ""}


def setup(**kw):
    _ctx.update(kw)


def _ff():
    return _ctx["ffmpeg"]() if _ctx.get("ffmpeg") else shutil.which("ffmpeg")


def _ffprobe():
    ff = _ff()
    if not ff:
        return None
    d, n = os.path.split(ff)
    p = os.path.join(d, n.replace("ffmpeg", "ffprobe"))
    return p if os.path.exists(p) else shutil.which("ffprobe")


def _log(text):
    try:
        _ctx.get("log") and _ctx["log"](text)
    except Exception:
        pass


def probe(path):
    exe = _ffprobe()
    if not exe:
        return {}
    try:
        r = subprocess.run([exe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], capture_output=True, timeout=90)
        d = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
    except Exception:
        return {}
    st = d.get("streams") or []
    v = next((x for x in st if x.get("codec_type") == "video" and not (x.get("disposition") or {}).get("attached_pic")), {}) or {}
    fr = v.get("r_frame_rate") or "0/1"
    try:
        a, b = fr.split("/")
        fps = float(a) / float(b or 1)
    except Exception:
        fps = 0
    return dict(vcodec=v.get("codec_name", ""), pix_fmt=v.get("pix_fmt", ""), height=v.get("height") or 0, fps=fps,
                duration=float((d.get("format") or {}).get("duration") or 0),
                audio=[x.get("codec_name", "") for x in st if x.get("codec_type") == "audio"],
                subs=[x.get("codec_name", "") for x in st if x.get("codec_type") == "subtitle"])


# --------------------------------------------------------------------------------------------------------------------- #
# subtitles: read, shift, write
# --------------------------------------------------------------------------------------------------------------------- #
def _ts(s):
    m = re.match(r"^\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,:](\d{1,3})\s*$", s or "")
    if not m:
        return None
    return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4).ljust(3, "0")) / 1000


def parse_subs(text):
    """SRT / VTT / ASS -> [(start, end, text)] sorted."""
    text = (text or "").replace("﻿", "").replace("\r\n", "\n").replace("\r", "\n")
    out = []
    if re.search(r"^\[Script Info\]", text, re.M) or re.search(r"^Dialogue:", text, re.M):
        fm = re.search(r"^\[Events\][\s\S]*?^Format:\s*(.+)$", text, re.M)
        fmt = [x.strip().lower() for x in (fm.group(1) if fm else "Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text").split(",")]
        si, ei, ti = fmt.index("start"), fmt.index("end"), fmt.index("text")
        for line in text.split("\n"):
            if not line.startswith("Dialogue:"):
                continue
            parts = line[9:].split(",")
            body = ",".join(parts[ti:])
            if re.search(r"\\p[1-9]", body):
                continue
            a, b = _ts(parts[si]), _ts(parts[ei])
            clean = re.sub(r"\{[^}]*\}", "", body).replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ").strip()
            if a is not None and b is not None and clean:
                out.append((a, b, clean))
    else:
        for block in re.split(r"\n{2,}", text):
            lines = block.split("\n")
            i = next((n for n, l in enumerate(lines) if "-->" in l), -1)
            if i < 0:
                continue
            x, y = lines[i].split("-->", 1)
            a, b = _ts(x), _ts((y.strip().split() or [""])[0])
            body = "\n".join(lines[i + 1:]).strip()
            if a is not None and b is not None and body:
                out.append((a, b, body))
    out.sort(key=lambda c: c[0])
    return out


def _fmt(t, sep=","):
    t = max(0.0, t)
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{sep}{ms % 1000:03d}"


def to_srt(cues, shift=0.0):
    out, n = [], 0
    for a, b, t in cues:
        a, b = a - shift, b - shift
        if b <= 0:
            continue
        n += 1
        out.append(f"{n}\n{_fmt(a)} --> {_fmt(b)}\n{t}\n")
    return "\n".join(out)


def _read_text(raw):
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16", "replace")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def sub_text(path, sid):
    """A subtitle the PC knows (vault.py's ids: x<n> file next to the video, e<n> track inside) as text."""
    return _ctx["video"]["sub"](path, sid)


# --------------------------------------------------------------------------------------------------------------------- #
# converting on the fly: quality (height), MP4 for the phone or MPEG-TS for a TV, subtitles burned in
# --------------------------------------------------------------------------------------------------------------------- #
def stream_cmd(path, start=0.0, audio=0, height=0, fmt="mp4", burn=None):
    """The ffmpeg command and the folder to run it in (for the burned-in subtitle file), or (None, None) without ffmpeg."""
    ff = _ff()
    if not ff:
        return None, None
    pr = probe(path)
    cwd = None
    vf = []
    if height and (pr.get("height") or 9999) > height:
        vf.append(f"scale=-2:{int(height)}")
    if burn:
        cues = parse_subs(sub_text(path, burn))
        if cues:
            cwd = str(_ctx["cache_dir"])
            os.makedirs(cwd, exist_ok=True)
            name = "nvburn_" + hashlib.md5(f"{path}|{burn}|{start}".encode()).hexdigest()[:10] + ".srt"
            with open(os.path.join(cwd, name), "w", encoding="utf-8") as fh:
                fh.write(to_srt(cues, start))            # the converted stream starts at 0 = `start` in the film
            vf.append(f"subtitles={name}:force_style='FontName=Arial,FontSize=24,Outline=2,Shadow=0,MarginV=28'")
    copy = not vf and pr.get("vcodec") == "h264" and pr.get("pix_fmt") in ("yuv420p", "yuvj420p")
    cmd = [ff, "-v", "error", "-ss", f"{max(0.0, start):.3f}", "-i", path, "-map", "0:v:0", "-map", f"0:a:{int(audio)}?", "-sn"]
    if copy:
        cmd += ["-c:v", "copy"]
    else:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"]
        if height:
            rate = HEIGHT_RATE.get(int(height), "3M")
            cmd += ["-maxrate", rate, "-bufsize", str(int(float(rate.rstrip("Mk")) * 2)) + rate[-1]]
        if not vf:
            vf.append("scale=w='min(1920,iw)':h=-2")
        cmd += ["-vf", ",".join(vf)]
    cmd += ["-c:a", "aac", "-ac", "2", "-b:a", "160k", "-max_muxing_queue_size", "1024"]
    if fmt == "ts":
        cmd += ["-f", "mpegts", "pipe:1"]
    else:
        cmd += ["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"]
    return cmd, cwd


def _pipe(h, cmd, cwd, ctype, extra=None):
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=cwd)
    try:
        h.send_response(200)
        h.send_header("Content-Type", ctype)
        h.send_header("Access-Control-Allow-Origin", "*")
        h.send_header("Cache-Control", "no-store")
        h.send_header("Connection", "close")
        for k, v in (extra or {}).items():
            h.send_header(k, v)
        h.end_headers()
        h.close_connection = True
        if h.command == "HEAD":
            return
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            h.wfile.write(chunk)
    finally:
        try:
            proc.kill()
            proc.wait(timeout=5)
        except Exception:
            pass


def _dlna(ctype, seek=True):
    return {"contentFeatures.dlna.org": f"DLNA.ORG_OP={'01' if seek else '00'};DLNA.ORG_CI={'0' if seek else '1'};DLNA.ORG_FLAGS={DLNA_FLAGS}",
            "transferMode.dlna.org": "Streaming", "Server": "Nightvault/1 UPnP/1.0 DLNADOC/1.50"}


def _send_file(h, path, ctype, extra):
    size = os.path.getsize(path)
    start, end, code = 0, size - 1, 200
    m = re.match(r"bytes=(\d*)-(\d*)", h.headers.get("Range") or "")
    if m and (m.group(1) or m.group(2)):
        if m.group(1) == "":
            start = max(0, size - int(m.group(2)))
        else:
            start = int(m.group(1))
            if m.group(2):
                end = min(int(m.group(2)), size - 1)
        code = 206
        if start >= size or start > end:
            h.send_response(416)
            h.send_header("Content-Range", f"bytes */{size}")
            h.send_header("Content-Length", "0")
            h.end_headers()
            return
    h.send_response(code)
    h.send_header("Content-Type", ctype)
    h.send_header("Accept-Ranges", "bytes")
    h.send_header("Content-Length", str(end - start + 1))
    h.send_header("Access-Control-Allow-Origin", "*")
    if code == 206:
        h.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    for k, v in extra.items():
        h.send_header(k, v)
    h.end_headers()
    if h.command == "HEAD":
        return
    with open(path, "rb") as fh:
        fh.seek(start)
        left = end - start + 1
        while left > 0:
            chunk = fh.read(min(262144, left))
            if not chunk:
                break
            h.wfile.write(chunk)
            left -= len(chunk)


# --------------------------------------------------------------------------------------------------------------------- #
# OpenSubtitles (the owner's own account; kept on the PC)
# --------------------------------------------------------------------------------------------------------------------- #
def os_hash(path=None, size=None, head=None, tail=None):
    """OpenSubtitles' file fingerprint: size + the 64-bit sums of the first and last 64 KB."""
    if path:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            head = fh.read(65536)
            fh.seek(max(0, size - 65536))
            tail = fh.read(65536)
    h = size
    for chunk in (head, tail):
        chunk = chunk + b"\0" * (-len(chunk) % 8)
        for (x,) in struct.iter_unpack("<Q", chunk):
            h = (h + x) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"


def _os_req(path, data=None, token=None, method=None, base=None):
    key = _ctx["get"]("os_apikey", "")
    if not key:
        raise RuntimeError("OpenSubtitles is not set up yet (Cinema > Settings > Subtitles online).")
    url = (base or OS_API).rstrip("/") + path
    hd = {"Api-Key": key, "User-Agent": UA, "Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        hd["Content-Type"] = "application/json"
    if token:
        hd["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=body, headers=hd, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("message") or e.reason
        except Exception:
            msg = e.reason
        if e.code == 401:
            raise RuntimeError("OpenSubtitles says the key or the login is not right.")
        if e.code == 406 or e.code == 429:
            raise RuntimeError(f"OpenSubtitles: {msg} (the free account has a small number of downloads per day)")
        raise RuntimeError(f"OpenSubtitles answered {e.code}: {msg}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Can't reach OpenSubtitles from the PC: {e.reason}")


def _login(force=False):
    if not force and _token["t"] and time.time() - _token["at"] < 20 * 3600:
        return _token["t"], _token["base"]
    user, pw = _ctx["get"]("os_user", ""), _ctx["get"]("os_password", "")
    if not user:
        return "", ""
    r = _os_req("/login", {"username": user, "password": pw})
    base = r.get("base_url") or ""
    _token.update(t=r.get("token") or "", at=time.time(), base=("https://" + base + "/api/v1") if base and not base.startswith("http") else base)
    return _token["t"], _token["base"]


def os_search(langs, moviehash=None, query=None, tmdb=None, season=None, episode=None):
    p = {"languages": ",".join(langs)}
    if moviehash:
        p["moviehash"] = moviehash
    if tmdb:
        if season is not None and episode is not None:
            p.update(parent_tmdb_id=tmdb, season_number=season, episode_number=episode)
        else:
            p["tmdb_id"] = tmdb
    elif query:
        p["query"] = query
        if season is not None and episode is not None:
            p.update(season_number=season, episode_number=episode)
    r = _os_req("/subtitles?" + urllib.parse.urlencode(sorted(p.items())))
    out = []
    for d in r.get("data") or []:
        a = d.get("attributes") or {}
        f = (a.get("files") or [{}])[0]
        if not f.get("file_id"):
            continue
        out.append(dict(file_id=f["file_id"], name=f.get("file_name") or "", lang=(a.get("language") or "").lower(), hash=bool(a.get("moviehash_match")),
                        downloads=a.get("download_count") or 0, fps=a.get("fps") or 0, release=a.get("release") or "", hi=bool(a.get("hearing_impaired")),
                        ai=bool(a.get("ai_translated") or a.get("machine_translated"))))
    return out


def os_pick(found, langs):
    """the best one: made for this exact file first, then the language order, no machine translations, then the most downloaded"""
    order = {l: i for i, l in enumerate(langs)}
    found = [x for x in found if x["lang"][:2] in order]
    found.sort(key=lambda x: (not x["hash"], order.get(x["lang"][:2], 9), x["ai"], x["hi"], -x["downloads"]))
    return found[0] if found else None


def os_download(file_id):
    tok, base = _login()
    r = _os_req("/download", {"file_id": file_id}, token=tok or None, base=base or None)
    link = r.get("link")
    if not link:
        raise RuntimeError("OpenSubtitles gave no download link" + (f" ({r.get('message')})" if r.get("message") else ""))
    with urllib.request.urlopen(urllib.request.Request(link, headers={"User-Agent": UA}), timeout=60) as resp:
        return _read_text(resp.read()), r.get("remaining")


# --------------------------------------------------------------------------------------------------------------------- #
# syncing a subtitle to the film
# --------------------------------------------------------------------------------------------------------------------- #
STEP = 0.1                                   # seconds per slot
RATIOS = [1.0, 25 / 23.976, 23.976 / 25, 24 / 25, 25 / 24, 23.976 / 24, 24 / 23.976, 30 / 29.97, 29.97 / 30]


def speech_parts(path, audio=0):
    """[(start, end)] where someone (probably) talks: ffmpeg finds the quiet parts of the voice band, the rest is talking."""
    ff = _ff()
    if not ff:
        raise RuntimeError("ffmpeg is needed on the PC to sync subtitles")
    r = subprocess.run([ff, "-v", "info", "-nostats", "-i", path, "-map", f"0:a:{int(audio)}?", "-vn", "-sn", "-ac", "1", "-ar", "16000",
                        "-af", "highpass=f=250,lowpass=f=3200,silencedetect=n=-30dB:d=0.35", "-f", "null", "-"], capture_output=True, timeout=1800)
    log = r.stderr.decode("utf-8", "replace")
    dur = 0.0
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", log)
    if m:
        dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    quiet, s0 = [], None
    for line in log.splitlines():
        a = re.search(r"silence_start:\s*(-?[\d.]+)", line)
        b = re.search(r"silence_end:\s*(-?[\d.]+)", line)
        if a:
            s0 = max(0.0, float(a.group(1)))
        if b and s0 is not None:
            quiet.append((s0, float(b.group(1))))
            s0 = None
    if s0 is not None:
        quiet.append((s0, dur or s0))
    talk, t = [], 0.0
    for a, b in quiet:
        if a > t + 0.05:
            talk.append((t, a))
        t = max(t, b)
    if dur and dur > t + 0.05:
        talk.append((t, dur))
    return talk


def _bits(parts, scale=1.0):
    n = 0
    for a, b in parts:
        i, j = int(a * scale / STEP), int(b * scale / STEP)
        if j > i >= 0:
            n |= ((1 << (j - i)) - 1) << i
    return n


def _pop(x):
    return x.bit_count() if hasattr(x, "bit_count") else bin(x).count("1")


def best_fit(ref_parts, cues, max_shift=180.0):
    """the stretch and shift that put the subtitle lines on the guide (talking or another subtitle) best: (scale, shift, score, before)"""
    ref = _bits(ref_parts)
    ms = int(max_shift / STEP)
    sub_parts = [(a, b) for a, b, _ in cues]
    total = sum(b - a for a, b in sub_parts) / STEP or 1
    base = _pop(ref & _bits(sub_parts))
    best = (1.0, 0.0, base)
    for r in RATIOS:
        s = _bits(sub_parts, r)
        for k in range(-ms, ms + 1, 2):             # first every other slot ...
            sc = _pop(ref & ((s << k) if k >= 0 else (s >> -k)))
            if sc > best[2]:
                best = (r, k * STEP, sc)
    r, sh, _ = best
    s = _bits(sub_parts, r)
    k0 = int(round(sh / STEP))
    for k in range(k0 - 2, k0 + 3):                 # ... then the slots next to the best one
        sc = _pop(ref & ((s << k) if k >= 0 else (s >> -k)))
        if sc > best[2]:
            best = (r, k * STEP, sc)
    return best[0], best[1], best[2] / total, base / total


def _tool(name):
    tools = os.path.join(str(_ctx.get("tools_dir") or ""), name)
    for c in (os.path.join(tools, name + ".exe"), os.path.join(tools, name), os.path.join(tools, name + "-cli.exe")):
        if os.path.exists(c):
            return c
    return shutil.which(name) or shutil.which(name + "-cli")


def sync_text(path, text, audio=0):
    """the subtitle text lined up with the film -> (srt text, how: str). Tries alass / ffsubsync when installed, else our own way."""
    cues = parse_subs(text)
    if not cues:
        raise RuntimeError("This subtitle file has no lines")
    work = str(_ctx["cache_dir"])
    os.makedirs(work, exist_ok=True)
    tag = hashlib.md5((path + text[:200]).encode("utf-8", "replace")).hexdigest()[:10]
    src, dst = os.path.join(work, f"nvsync_{tag}_in.srt"), os.path.join(work, f"nvsync_{tag}_out.srt")
    with open(src, "w", encoding="utf-8") as fh:
        fh.write(to_srt(cues))
    for name, cmd in (("alass", lambda x: [x, path, src, dst]), ("ffsubsync", lambda x: [x, path, "-i", src, "-o", dst])):
        exe = _tool(name)
        if not exe:
            continue
        try:
            subprocess.run(cmd(exe), capture_output=True, timeout=1800)
            if os.path.exists(dst) and parse_subs(open(dst, encoding="utf-8", errors="replace").read()):
                out = open(dst, encoding="utf-8", errors="replace").read()
                return out, name
        except Exception as e:
            _log(f"{name} failed: {e}")
    # our own way: a text subtitle inside the file is the best guide, else the sound
    guide, how = None, "the sound"
    try:
        pr = probe(path)
        for i, c in enumerate(pr.get("subs") or []):
            if c in ("subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text"):
                g = parse_subs(sub_text(path, f"e{i}"))
                if len(g) > 20:
                    guide, how = [(a, b) for a, b, _ in g], "the subtitles inside the file"
                    break
    except Exception:
        guide = None
    if not guide:
        guide = speech_parts(path, audio)
    scale, shift, score, before = best_fit(guide, cues)
    if score <= before + 0.02:                      # no clear improvement: keep it as it was
        return to_srt(cues), f"already in sync (checked against {how})"
    moved = [(a * scale + shift, b * scale + shift, t) for a, b, t in cues]
    first = cues[0][0] * scale + shift - cues[0][0]                  # how much the first line moved
    word = f"{abs(first):.1f} s {'earlier' if first < 0 else 'later'}"
    return to_srt(moved), f"synced: {word}" + (" and the speed fixed (23.976/25 fps)" if abs(scale - 1) > 1e-4 else "") + f", lined up with {how}"


def _save_next_to(path, lang, text, synced=False):
    stem = os.path.splitext(path)[0]
    tail = f".{lang}{'.synced' if synced else ''}"
    name = stem + tail + ".srt"
    n = 2
    while os.path.exists(name):
        name = f"{stem}{tail}.{n}.srt"
        n += 1
    with open(name, "w", encoding="utf-8") as fh:
        fh.write(text)
    return name


def find_subs(path, langs, tmdb=None, season=None, episode=None, query=None):
    """search (file fingerprint first, then the title), download the best one, sync it, save it next to the video"""
    with _lock:
        found = os_search(langs, moviehash=os_hash(path))
        pick = os_pick([x for x in found if x["hash"]], langs)
        if not pick:
            found = os_search(langs, tmdb=tmdb, season=season, episode=episode, query=None if tmdb else query)
            pick = os_pick(found, langs)
        if not pick:
            return dict(ok=False, error="No " + " / ".join(LANG_NAMES.get(l, l) for l in langs) + " subtitles found online for this video.")
        text, left = os_download(pick["file_id"])
        how = "made for this exact file" if pick["hash"] else "for this title"
        try:
            text2, shown = sync_text(path, text)
        except Exception as e:
            text2, shown = to_srt(parse_subs(text)) or text, f"not synced ({e})"
        saved = _save_next_to(path, pick["lang"][:2], text2)
        _log(f"subtitle {pick['lang']} for {os.path.basename(path)}: {how}, {shown} -> {os.path.basename(saved)}")
        return dict(ok=True, lang=pick["lang"][:2], file=os.path.basename(saved), how=how, sync=shown, remaining=left)


# --------------------------------------------------------------------------------------------------------------------- #
# the addresses (called by vault_phone.PhoneHandler, after it checked the pairing code)
# --------------------------------------------------------------------------------------------------------------------- #
def _video(fid):
    p = _ctx["vfile"](fid)
    if not p or not os.path.exists(p):
        raise FileNotFoundError("That video is not here (is the drive connected?)")
    return p


def handle(h, p, q):
    try:
        if p == "/nv/cin/stream":
            path = _video(q.get("id", ""))
            fmt = "ts" if q.get("fmt") == "ts" else "mp4"
            cmd, cwd = stream_cmd(path, float(q.get("start", "0") or 0), int(q.get("a", "0") or 0), int(q.get("h", "0") or 0), fmt, q.get("burn") or None)
            if not cmd:
                return h._send(501, {"error": "ffmpeg is missing on the PC (Nightvault > Settings > Components)."})
            return _pipe(h, cmd, cwd, "video/mp2t" if fmt == "ts" else "video/mp4")
        if p.startswith("/nv/cin/tv/"):
            parts = p.split("/")                                  # '', nv, cin, tv, <id>, <name>
            path = _video(parts[4])
            ctype = TV_MIME.get(os.path.splitext(path)[1].lower(), "video/mp4")
            extra = _dlna(ctype)
            if q.get("cap"):
                extra["CaptionInfo.sec"] = f"http://{h.headers.get('Host')}/nv/cin/tvsub/{parts[4]}/{q['cap']}/0/s.srt?k={q.get('k', '')}"
            return _send_file(h, path, ctype, extra)
        if p.startswith("/nv/cin/tvs/"):
            _, _, _, _, fid, start, audio, height, burn = p.split("/")[:9]
            path = _video(fid)
            cmd, cwd = stream_cmd(path, float(start or 0), int(audio or 0), int(height or 0), "ts", None if burn in ("", "-") else burn)
            if not cmd:
                return h._send(501, {"error": "ffmpeg is missing on the PC"})
            return _pipe(h, cmd, cwd, "video/mp2t", _dlna("video/mp2t", seek=False))
        if p.startswith("/nv/cin/tvsub/"):
            _, _, _, _, fid, sid, shift = p.split("/")[:7]
            path = _video(fid)
            return h._send(200, to_srt(parse_subs(sub_text(path, sid)), float(shift or 0)), "text/srt; charset=utf-8", _dlna("text/srt"))
        if p == "/nv/cin/subs/setup":
            return h._send(200, dict(ok=bool(_ctx["get"]("os_apikey", "")), user=_ctx["get"]("os_user", ""), key=bool(_ctx["get"]("os_apikey", ""))))
        if p == "/nv/cin/subs/find":
            path = _video(q.get("id", ""))
            langs = [x for x in (q.get("langs") or "nl,en").split(",") if x]
            s, e = q.get("season"), q.get("episode")
            r = find_subs(path, langs, tmdb=q.get("tmdb") or None, season=int(s) if s not in (None, "") else None,
                          episode=int(e) if e not in (None, "") else None, query=q.get("query") or None)
            return h._send(200 if r.get("ok") else 404, r)
        if p == "/nv/cin/subs/sync":
            path = _video(q.get("id", ""))
            text = sub_text(path, q.get("s", ""))
            out, how = sync_text(path, text, int(q.get("a", "0") or 0))
            lab = re.sub(r"[^a-z]", "", (q.get("lang") or "").lower())[:3] or "sub"
            saved = _save_next_to(path, lab, out, synced=True)
            return h._send(200, dict(ok=True, file=os.path.basename(saved), sync=how))
        if p == "/nv/cin/subs/hashfind":
            langs = [x for x in (q.get("langs") or "nl,en").split(",") if x]
            found = os_search(langs, moviehash=q.get("hash"))
            pick = os_pick([x for x in found if x["hash"]], langs)
            if not pick:
                s, e = q.get("season"), q.get("episode")
                found = os_search(langs, tmdb=q.get("tmdb") or None, season=int(s) if s not in (None, "") else None,
                                  episode=int(e) if e not in (None, "") else None, query=None if q.get("tmdb") else q.get("name"))
                pick = os_pick(found, langs)
            if not pick:
                return h._send(404, dict(ok=False, error="No subtitles found online for this video."))
            text, left = os_download(pick["file_id"])
            return h._send(200, dict(ok=True, lang=pick["lang"][:2], hash=pick["hash"], text=to_srt(parse_subs(text)) or text, remaining=left))
        return h._send(404, {"error": "Not found"})
    except FileNotFoundError as e:
        return h._send(404, {"error": str(e)})
    except RuntimeError as e:
        return h._send(502, {"ok": False, "error": str(e)})


def handle_post(h, p, body):
    if p == "/nv/cin/subs/setup":
        try:
            d = json.loads(body.decode("utf-8") or "{}")
        except ValueError:
            return h._send(400, {"error": "bad request"})
        for k in ("apikey", "user", "password"):
            if k in d and (k != "password" or d[k]):
                _ctx["put"]("os_" + k, (d[k] or "").strip())
        _token.update(t="", at=0, base="")
        try:
            if _ctx["get"]("os_user", ""):
                _login(True)
            else:
                _os_req("/infos/formats")
            return h._send(200, dict(ok=True, user=_ctx["get"]("os_user", "")))
        except RuntimeError as e:
            return h._send(200, dict(ok=False, error=str(e)))
    return h._send(404, {"error": "Not found"})
