"""Nightvault - Phone access ("Take with me").

Lets the Nightvault phone app reach this PC's library over the HOME NETWORK: list the music, play a song (with byte ranges for
seeking), convert songs the phone cannot play (WMA, APE, WavPack, AIFF ...) to MP3 on the fly, and send album covers.

Safety:
  * Off until the owner switches it on in Settings > Phone access.
  * A second small server on its own port (8766), next to the normal one that only listens on 127.0.0.1.
  * It only answers devices on the home network (private addresses: 192.168.x.x, 10.x.x.x, 172.16-31.x.x) and only with the
    pairing code that the PC shows. It only serves files that are in the catalog - nothing else on the PC.

vault.py plugs it in with init(...): it hands over small functions (settings, the list of music files, the tag reader, ffmpeg).
The API is the same for every kind of library, so Audiobooks, Bookcase and Cinema can use it later:
  GET /nv/hello                 -> {app, v, name, kinds}
  GET /nv/list?kind=music       -> {ready, done, total, items:[...]}   (the list is built in the background the first time)
  GET /nv/file?id=..            -> the file (Range supported)
  GET /nv/stream?id=..          -> the file converted to MP3 (for formats the phone can't play)
  GET /nv/cover?id=..           -> the album cover (a picture in the album folder, else the picture inside the first song)
Video (Nightvault Cinema, 19 October 2026) - the PC's Watch collections (Movies, Series, Anime and your own video collections):
  GET /nv/list?kind=video       -> {ready, items:[one per video file], groups:[one per movie / show]}
  GET /nv/vinfo?id=..           -> {duration, mode:'direct'|'transcode', audio:[labels], subs:[{id, label}]}
  GET /nv/vstream?id=..&start=s&a=n -> the video converted on the fly to MP4 (for files the phone can't play), from second s, audio track n
  GET /nv/vsub?id=..&s=..       -> a subtitle track as WebVTT
  GET /nv/vcover?id=<group id>  -> the poster the PC app has for that movie / show
  GET /nv/watch?id=..&pos=&dur=&fin= -> remembers where you are on the PC too (the PC app's own "continue watching")
  GET /nv/list?kind=models      -> {ready, items:[one per file of a 3D model: the models plus pictures / print files in their folders]}  (3D Print)
  GET /nv/mcover?id=<group id>  -> the picture the PC app made for that 3D model
Games (Nightvault Games, 20 October 2026) - the owner's own game backups in the ROM folders set in the PC app (vault_games.py):
  GET /nv/list?kind=games       -> {ready, systems:{sys:{folder, emulator, ready, problem}}, items:[{id, sys, name, dir, size, parts:[...]}]}
  GET /nv/gfile?id=..           -> a backup file (Range supported) - for "Save to phone"
  GET /nv/play?id=..            -> starts that backup on THIS PC with the emulator set in the PC app
  GET /nv/play?steam=<app id>   -> starts a Steam game on this PC
Every request carries the pairing code as ?k=CODE (or the X-NV-Key header).
"""
import hashlib
import ipaddress
import json
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = 8766
VERSION = 1
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"          # no 0/O/1/I/L: easy to type on a phone
PHONE_PLAYS = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav", ".webm"}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
ART_DIR = re.compile(r"^(covers?|scans?|artwork|art|images?|pictures?|pics?)$", re.I)
COVER_BAD = re.compile(r"\b(back(?:cover)?|cd|disc|disk|inlay|tray|inside|booklet|label|matrix|spine|obi|small)(?![a-z])", re.I)
DISC_DIR = re.compile(r"^(disc|disk|cd|part|deel)[\s._-]*\d+$", re.I)
MIME = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo",
        ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".wmv": "video/x-ms-wmv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg", ".ogv": "video/ogg",
        ".srt": "text/plain", ".vtt": "text/vtt", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4",
        ".aac": "audio/aac", ".wav": "audio/wav", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".pdf": "application/pdf", ".cbz": "application/vnd.comicbook+zip", ".cbr": "application/vnd.comicbook-rar",
        ".cb7": "application/x-cb7", ".cbt": "application/x-cbt", ".zip": "application/zip", ".epub": "application/epub+zip", ".stl": "model/stl", ".obj": "model/obj", ".3mf": "model/3mf"}

_ctx = {}                       # functions from vault.py: get(key, default), put(key, value), music_files(), read_tags(path), ffmpeg(), cache_dir
_srv = {"server": None, "thread": None, "error": ""}
_idx = {"lock": threading.Lock(), "building": False, "ready": False, "done": 0, "total": 0, "items": [], "files": {}, "covers": {}, "at": 0}
_cover_cache = {}
_vid = {"lock": threading.Lock(), "items": [], "groups": [], "files": {}, "at": 0}     # the video list (Cinema), made when asked (60 s cache)
_bk = {"lock": threading.Lock(), "items": [], "files": {}, "at": 0}                      # the comics / manga / books list (Bookcase), 60 s cache
_mod = {"lock": threading.Lock(), "items": [], "files": {}, "at": 0}                   # the 3D model list (3D Print), made when asked (60 s cache)
GENERIC_DIR = re.compile(r"^(files?|stls?|objs?|3mfs?|models?|print ?files|supported|unsupported|pre-?supported|presupported|supports?|lychee|chitubox|parts?|sliced|resin)$", re.I)
PIC_DIR = re.compile(r"^(images?|pictures?|photos?|renders?|pics?)$", re.I)
MODEL_NEAR = re.compile(r"\.(stl|obj|3mf|gcode|bgcode|ctb|cbddlp|goo|pwmx|pwma|pwms|pwmb|pm3|pm3m|prz|jxs|sl1|sl1s|lys|lyt|chitubox|jpe?g|png|webp|pdf)$", re.I)


def _id(s):
    return hashlib.sha1(s.encode("utf-8", "surrogatepass")).hexdigest()[:16]


def new_code():
    return "".join(secrets.choice(CODE_CHARS) for _ in range(8))


def init(get, put, music_files, read_tags, ffmpeg, cache_dir, video=None, models=None, games=None, books=None):
    """Called once by vault.py at start-up. Starts the server again if the owner had switched it on.
    video (optional, for Cinema) = dict of small functions from vault.py:
      files()                    -> [{path, root, gid, coll, collname, show, kind:'movie'|'show', title, year, season, number, label, size,
                                      overview, genres, tmdb, cover, pos, dur, fin, wat}]   (one per video file in a Watch collection)
      info(path)                 -> {duration, mode, audio:[labels], subs:[{id, label}]}
      sub(path, sid)             -> WebVTT text
      cmd(path, start, audio)    -> the ffmpeg command that converts to a fragmented MP4 on stdout (None = no ffmpeg)
      cover(gid)                 -> (bytes, content type) or (None, None)
      watch(path, pos, dur, fin) -> stores the position in the PC app
    models (optional, for 3D Print) = dict from vault.py:
      files()                    -> [{path, root, gid, group, coll, collname, tags, cover}]   (one per model file in a 3D models collection)
      cover(gid)                 -> (bytes, content type) or (None, None)
    books (optional, for Bookcase) = dict from vault.py:
      files()                    -> [{path, root, gid, group, coll, collname, kind:'comic'|'manga'|'book'|'rpg', number, year, size, cover}]
      cover(gid)                 -> (bytes, content type) or (None, None)
      news() / news_run() (optional)  -> the new volumes check (vault_news.py), served at /nv/news (?run=1 starts a check now)
      Endpoints: /nv/list?kind=books (series with every file), /nv/file?id= (Range), /nv/bcover?id=<series id>
    games (optional, for Games) = the vault_games module (listing(fresh), file_path(id), play(fid, steam))"""
    _ctx.update(get=get, put=put, music_files=music_files, read_tags=read_tags, ffmpeg=ffmpeg, cache_dir=Path(cache_dir), video=video, models=models, games=games, books=books)
    if not _ctx["get"]("phone_code", ""):
        _ctx["put"]("phone_code", new_code())
    if _ctx["get"]("phone_on", "0") == "1":
        start()


def _cinema():
    """vault_cinema.py (Cinema extras: quality, TV, subtitles online) - loaded the first time it is needed; None when missing."""
    if "cinema" not in _ctx:
        try:
            import vault_cinema as vc

            def vfile(fid):
                if not _vid["files"] or fid not in _vid["files"]:
                    build_video(True)
                return _vid["files"].get(fid)
            vc.setup(get=_ctx["get"], put=_ctx["put"], ffmpeg=_ctx["ffmpeg"], cache_dir=_ctx["cache_dir"] / "cinema", video=_ctx.get("video"),
                     vfile=vfile, tools_dir=_ctx["cache_dir"] / "nightvault_tools")
            _ctx["cinema"] = vc
        except Exception:
            _ctx["cinema"] = None
    return _ctx["cinema"]


def addresses():
    """The PC's addresses on the home network (what the phone types in)."""
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))            # no packet is sent; this only asks which network card would be used
        out.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for a in socket.gethostbyname_ex(socket.gethostname())[2]:
            if a not in out:
                out.append(a)
    except Exception:
        pass
    return [a for a in out if _private(a) and not a.startswith("127.")] or out


def _private(ip):
    try:
        a = ipaddress.ip_address(ip)
        if a.version == 6 and a.ipv4_mapped:
            a = a.ipv4_mapped
        # 100.64.0.0/10 = Tailscale (watching away from home through the owner's own private network, Cinema 21 Oct)
        return a.is_private or a.is_loopback or a.is_link_local or (a.version == 4 and a in ipaddress.ip_network("100.64.0.0/10"))
    except ValueError:
        return False


def status():
    on = _srv["server"] is not None
    return dict(on=on, port=PORT, code=_ctx["get"]("phone_code", "") if _ctx else "", addresses=addresses() if on else [],
                name=socket.gethostname(), error=_srv["error"],
                music=dict(ready=_idx["ready"], done=_idx["done"], total=_idx["total"], songs=len(_idx["items"])))


def set_on(on, new=False):
    if new:
        _ctx["put"]("phone_code", new_code())
    _ctx["put"]("phone_on", "1" if on else "0")
    stop()
    if on:
        start()
    return status()


def start():
    if _srv["server"]:
        return
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", PORT), PhoneHandler)
    except OSError as e:
        _srv["error"] = f"Port {PORT} is in use or blocked: {e}"
        return
    srv.daemon_threads = True
    _srv.update(server=srv, error="", thread=threading.Thread(target=srv.serve_forever, daemon=True))
    _srv["thread"].start()
    threading.Thread(target=build_music, daemon=True).start()


def stop():
    s = _srv["server"]
    if s:
        _srv["server"] = None
        try:
            s.shutdown()
            s.server_close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# the music list: tags of every music file in the catalog, kept in a cache file so the next start is quick
# --------------------------------------------------------------------------- #
def _cache_file():
    return _ctx["cache_dir"] / "phone_music_cache.json"


def build_music(force=False):
    with _idx["lock"]:
        if _idx["building"] or (_idx["ready"] and not force and time.time() - _idx["at"] < 600):
            return
        _idx["building"] = True
    try:
        try:
            cache = json.loads(_cache_file().read_text(encoding="utf-8"))
        except Exception:
            cache = {}
        got = [(x, "") if isinstance(x, str) else (x[0], x[1] or "") for x in _ctx["music_files"]()]   # (path, the scanned folder it is in)
        roots = dict(got)
        paths = [p for p, _ in got if os.path.splitext(p)[1].lower() not in IMG_EXT]
        _idx.update(total=len(paths), done=0)
        items, files, covers, fresh = [], {}, {}, {}
        for n, p in enumerate(paths):
            _idx["done"] = n
            try:
                st = os.stat(p)
            except OSError:
                continue
            c = cache.get(p)
            if c and c[0] == st.st_mtime and c[1] == st.st_size:
                t = c[2]
            else:
                t = _ctx["read_tags"](p) or {}
                t = {k: t.get(k) for k in ("title", "artist", "album", "albumartist", "track", "disc", "year", "genre", "duration")}
            fresh[p] = [st.st_mtime, st.st_size, t]
            ext = os.path.splitext(p)[1].lower()
            fid = _id(p)
            folder = os.path.dirname(p)
            album_dir = os.path.dirname(folder) if DISC_DIR.match(os.path.basename(folder)) else folder
            cid = _id(album_dir)
            covers.setdefault(cid, [album_dir, p, folder])
            files[fid] = p
            root = roots.get(p) or ""
            rel = os.path.relpath(folder, root) if root and folder.startswith(root) else os.path.join(*Path(folder).parts[-3:])
            items.append(dict(id=fid, name=os.path.basename(p), dir="" if rel == "." else rel.replace("\\", "/"), title=t.get("title") or "", artist=t.get("artist") or "",
                              albumartist=t.get("albumartist") or "", album=t.get("album") or "", track=t.get("track") or 0, disc=t.get("disc") or 0,
                              year=str(t.get("year") or "")[:4], genre=t.get("genre") or "", dur=round(t.get("duration") or 0, 2), size=st.st_size,
                              ext=ext[1:], conv=ext not in PHONE_PLAYS, cover=cid))
        _idx.update(items=items, files=files, covers=covers, done=len(paths), ready=True, at=time.time())
        try:
            _ctx["cache_dir"].mkdir(parents=True, exist_ok=True)
            _cache_file().write_text(json.dumps(fresh), encoding="utf-8")
        except Exception:
            pass
    finally:
        _idx["building"] = False


def build_video(force=False):
    """The PC's video files for Cinema. vault.py already keeps its library in memory, so this is quick; kept for 60 s."""
    v = _ctx.get("video")
    if not v:
        return
    with _vid["lock"]:
        if not force and _vid["at"] and time.time() - _vid["at"] < 60:
            return
        items, groups, files = [], {}, {}
        for f in v["files"]():
            p = f["path"]
            fid = _id(p)
            files[fid] = p
            ext = os.path.splitext(p)[1].lower()
            root = f.get("root") or ""
            folder = os.path.dirname(p)
            rel = os.path.relpath(folder, root) if root and folder.startswith(root) else os.path.join(*Path(folder).parts[-2:])
            items.append(dict(id=fid, gid=f["gid"], name=os.path.basename(p), dir="" if rel == "." else rel.replace("\\", "/"), ext=ext[1:],
                              size=f.get("size") or 0, title=f.get("title") or "", year=f.get("year") or None, season=f.get("season"),
                              number=f.get("number"), label=f.get("label") or "", pos=f.get("pos") or 0, dur=f.get("dur") or 0,
                              fin=bool(f.get("fin")), wat=f.get("wat") or 0))
            if f["gid"] not in groups:
                groups[f["gid"]] = dict(gid=f["gid"], name=f.get("show") or "", kind=f.get("kind") or "movie", year=f.get("gyear") or f.get("year") or None,
                                        coll=f.get("coll") or "", collname=f.get("collname") or "", saga=f.get("saga") or "",
                                        overview=(f.get("overview") or "")[:2000], genres=f.get("genres") or [], tmdb=f.get("tmdb") or None,
                                        cover=bool(f.get("cover")))
        _vid.update(items=items, groups=list(groups.values()), files=files, at=time.time())


def build_models(force=False):
    """The PC's 3D models for 3D Print: every model file of a 3D models collection, plus the pictures and print files
    (Bambu .gcode.3mf, resin .ctb / .goo, Lychee / Chitubox scenes, PDFs) lying in the same folders. Kept for 60 s."""
    mo = _ctx.get("models")
    if not mo:
        return
    with _mod["lock"]:
        if not force and _mod["at"] and time.time() - _mod["at"] < 60:
            return
        items, files, seen, near = [], {}, set(), {}

        def add(p, f):
            if p in seen:
                return
            seen.add(p)
            fid = _id(p)
            files[fid] = p
            root = f.get("root") or ""
            folder = os.path.dirname(p)
            rel = os.path.relpath(folder, root) if root and folder.startswith(root) else os.path.join(*Path(folder).parts[-2:])
            try:
                size = os.path.getsize(p)
            except OSError:
                size = 0
            items.append(dict(id=fid, gid=f.get("gid") or "", name=os.path.basename(p), dir="" if rel == "." else rel.replace("\\", "/"),
                              size=size, group=f.get("group") or "", coll=f.get("coll") or "", collname=f.get("collname") or "",
                              tags=f.get("tags") or [], cover=bool(f.get("cover"))))
        def look(folder):
            if folder not in near:
                try:
                    near[folder] = [os.path.join(folder, n) for n in os.listdir(folder) if MODEL_NEAR.search(n) and os.path.isfile(os.path.join(folder, n))]
                except OSError:
                    near[folder] = []
            return near[folder]
        for f in mo["files"]():
            add(f["path"], f)
            folder = os.path.dirname(f["path"])
            spots = [folder]                                         # the other files near it: pictures, print files
            root = os.path.normcase(os.path.normpath(f.get("root") or ""))
            up = os.path.dirname(folder)
            if GENERIC_DIR.match(os.path.basename(folder)) and up != folder and os.path.normcase(os.path.normpath(up)) != root:
                spots.append(up)                                     # Dragon/STL/dragon.stl: also Dragon/ and Dragon/images/
            for sp in list(spots):
                try:
                    spots += [os.path.join(sp, d) for d in os.listdir(sp) if PIC_DIR.match(d) and os.path.isdir(os.path.join(sp, d))]
                except OSError:
                    pass
            for sp in spots:
                for q in look(sp):
                    add(q, dict(f, cover=False))
        _mod.update(items=items, files=files, at=time.time())


def build_books(force=False):
    """The PC's comics, manga, books and RPG books for Bookcase: one entry per series, each with its files (number, size, file id). Kept for 60 s."""
    bo = _ctx.get("books")
    if not bo:
        return
    with _bk["lock"]:
        if not force and _bk["at"] and time.time() - _bk["at"] < 60:
            return
        files, series = {}, {}
        for f in bo["files"]():
            p = f["path"]
            fid = _id(p)
            files[fid] = p
            s = series.get(f["gid"])
            if not s:
                s = series[f["gid"]] = dict(id=_id(f["gid"]), gid=f["gid"], name=f.get("group") or "", coll=f.get("coll") or "", collname=f.get("collname") or "",
                                            kind=f.get("kind") or "", cover=bool(f.get("cover")), files=[])
            n = f.get("number")
            s["files"].append(dict(id=fid, name=os.path.basename(p), ext=os.path.splitext(p)[1].lower().lstrip("."), size=f.get("size") or 0,
                                   number=n if isinstance(n, (int, float)) else None, year=f.get("year")))
        items = list(series.values())
        for s in items:
            s["files"].sort(key=lambda x: (x["number"] is None, x["number"] or 0, x["name"].lower()))
            s["count"] = len(s["files"])
            s["size"] = sum(x["size"] for x in s["files"])
        items.sort(key=lambda s: s["name"].lower())
        _bk.update(items=items, files=files, at=time.time())


def _file_path(fid):
    return _idx["files"].get(fid) or _vid["files"].get(fid) or _mod["files"].get(fid) or _bk["files"].get(fid)


def _cover_rank(name):
    n = os.path.splitext(name)[0].replace("_", " ").lower()
    if COVER_BAD.search(n):
        return 0
    return 4 if "front" in n else 3 if n.startswith("cover") or n.endswith("cover") else 2 if re.search(r"folder|albumart|cover", n) else 1


def find_cover(album_dir, first_song, cd_dir):
    """front > cover > folder > other picture, in the album folder, its Covers/Scans folder, then the CD folder; else the song's own picture."""
    best, score = None, 0
    for d, bonus in ((album_dir, 1), (cd_dir, 0)):
        try:
            names = os.listdir(d)
        except OSError:
            continue
        cands = [(os.path.join(d, x), bonus) for x in names if os.path.splitext(x)[1].lower() in IMG_EXT]
        for sub in names:
            if ART_DIR.match(sub) and os.path.isdir(os.path.join(d, sub)):
                try:
                    cands += [(os.path.join(d, sub, x), bonus + 2) for x in os.listdir(os.path.join(d, sub)) if os.path.splitext(x)[1].lower() in IMG_EXT]
                except OSError:
                    pass
        for f, b in cands:
            r = _cover_rank(os.path.basename(f))
            if r and r * 2 + b > score:
                best, score = f, r * 2 + b
    if best:
        with open(best, "rb") as fh:
            return fh.read(), MIME.get(os.path.splitext(best)[1].lower(), "image/jpeg")
    ff = _ctx["ffmpeg"]()
    if ff:
        try:
            r = subprocess.run([ff, "-v", "error", "-i", first_song, "-an", "-map", "0:v:0", "-frames:v", "1", "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1"],
                               capture_output=True, timeout=30)
            if r.returncode == 0 and r.stdout[:3] == b"\xff\xd8\xff":
                return r.stdout, "image/jpeg"
        except Exception:
            pass
    return None, None


# --------------------------------------------------------------------------- #
# the server for the phone
# --------------------------------------------------------------------------- #
class PhoneHandler(BaseHTTPRequestHandler):
    server_version = "NightvaultPhone/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", (extra or {}).pop("Cache-Control", "no-store"))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range, X-NV-Key")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        """Only for settings that should not travel in an address (Cinema: the OpenSubtitles login)."""
        if not _private(self.client_address[0]):
            return self._send(403, {"error": "Only devices on the home network can connect."})
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        code = _ctx["get"]("phone_code", "")
        given = (q.get("k") or self.headers.get("X-NV-Key") or "").strip().upper().replace("-", "").replace(" ", "")
        if not code or not secrets.compare_digest(given, code):
            time.sleep(0.5)
            return self._send(401, {"error": "Wrong pairing code"})
        body = self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 65536))
        if u.path.startswith("/nv/cin/") and _ctx.get("video") and _cinema():
            return _cinema().handle_post(self, u.path, body)
        return self._send(404, {"error": "Not found"})

    def do_GET(self):
        if not _private(self.client_address[0]):
            return self._send(403, {"error": "Only devices on the home network can connect."})
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        code = _ctx["get"]("phone_code", "")
        given = (q.get("k") or self.headers.get("X-NV-Key") or "").strip().upper().replace("-", "").replace(" ", "")
        if not code or not secrets.compare_digest(given, code):
            time.sleep(0.5)
            return self._send(401, {"error": "Wrong pairing code - look in Nightvault on the PC: Settings > Phone access."})
        try:
            p = u.path
            if p == "/nv/hello":
                return self._send(200, dict(app="Nightvault", v=VERSION, name=socket.gethostname(), addrs=addresses(), cinema=2 if _ctx.get("video") and _cinema() else 0, kinds=["music"] + (["video"] if _ctx.get("video") else []) + (["models"] if _ctx.get("models") else []) + (["books"] if _ctx.get("books") else []) + (["games"] if _ctx.get("games") else [])))
            if p in ("/nv/gfile", "/nv/play") or (p == "/nv/list" and q.get("kind") == "games"):
                g = _ctx.get("games")
                if not g:
                    return self._send(404, {"error": "This PC app is too old for Games - copy the newest vault.py, vault_phone.py and vault_games.py to the PC."})
                if p == "/nv/list":
                    return self._send(200, g.listing(q.get("fresh") == "1"))
                if p == "/nv/play":
                    try:
                        return self._send(200, g.play(q.get("id"), q.get("steam")))
                    except ValueError as e:
                        return self._send(400, {"error": str(e)})
                f = g.file_path(q.get("id", ""))
                if not f or not os.path.exists(f):
                    return self._send(404, {"error": "That backup file is not here (is the drive connected?)"})
                return self._file(f, "application/octet-stream")
            if p.startswith("/nv/cin/"):
                if not _ctx.get("video") or not _cinema():
                    return self._send(404, {"error": "This PC app is too old for this - copy the newest vault.py, vault_phone.py and vault_cinema.py to the PC."})
                return _cinema().handle(self, p, q)
            if p == "/nv/list" and q.get("kind") == "video":
                if not _ctx.get("video"):
                    return self._send(404, {"error": "This PC app is too old for Cinema - copy the newest vault.py and vault_phone.py to the PC."})
                build_video(q.get("fresh") == "1")
                return self._send(200, dict(ready=True, at=_vid["at"], items=_vid["items"], groups=_vid["groups"]))
            if p == "/nv/list" and q.get("kind") == "books":
                if not _ctx.get("books"):
                    return self._send(404, {"error": "This PC app is too old for Bookcase - copy the newest vault.py and vault_phone.py to the PC."})
                build_books(q.get("fresh") == "1")
                return self._send(200, dict(ready=True, at=_bk["at"], items=_bk["items"]))
            if p == "/nv/news":
                bo = _ctx.get("books") or {}
                if not bo.get("news"):
                    return self._send(200, dict(items={}, error="This PC app has no new-volumes check yet - copy the newest vault.py, vault_phone.py and vault_news.py to the PC."))
                if q.get("run") == "1" and bo.get("news_run"):
                    bo["news_run"](True)
                return self._send(200, bo["news"]())
            if p == "/nv/bcover":
                bo = _ctx.get("books")
                s = next((x for x in _bk["items"] if x["id"] == q.get("id", "")), None)
                data, ctype = bo["cover"](s["gid"]) if bo and s else (None, None)
                if not data:
                    return self._send(404, {"error": "No cover"})
                return self._send(200, data, ctype, {"Cache-Control": "max-age=86400"})
            if p == "/nv/list" and q.get("kind") == "models":
                if not _ctx.get("models"):
                    return self._send(404, {"error": "This PC app is too old for 3D Print - copy the newest vault.py and vault_phone.py to the PC."})
                build_models(q.get("fresh") == "1")
                return self._send(200, dict(ready=True, at=_mod["at"], items=_mod["items"]))
            if p == "/nv/mcover":
                mo = _ctx.get("models")
                data, ctype = mo["cover"](q.get("id", "")) if mo else (None, None)
                if not data:
                    return self._send(404, {"error": "No picture"})
                return self._send(200, data, ctype, {"Cache-Control": "max-age=86400"})
            if p in ("/nv/vinfo", "/nv/vstream", "/nv/vsub", "/nv/watch"):
                v = _ctx.get("video")
                if not v:
                    return self._send(404, {"error": "No video on this PC"})
                if not _vid["files"]:
                    build_video()
                f = _vid["files"].get(q.get("id", ""))
                if not f:
                    build_video(True)
                    f = _vid["files"].get(q.get("id", ""))
                if p == "/nv/watch":
                    if not f:
                        return self._send(404, {"error": "That video is not on the PC"})
                    v["watch"](f, float(q.get("pos", "0") or 0), float(q.get("dur", "0") or 0), q.get("fin") == "1")
                    return self._send(200, {"ok": True})
                if not f or not os.path.exists(f):
                    return self._send(404, {"error": "That video is not here (is the drive connected?)"})
                if p == "/nv/vinfo":
                    return self._send(200, v["info"](f))
                if p == "/nv/vsub":
                    return self._send(200, v["sub"](f, q.get("s", "")), "text/vtt; charset=utf-8")
                return self._vstream(f, float(q.get("start", "0") or 0), int(q.get("a", "0") or 0))
            if p == "/nv/vcover":
                v = _ctx.get("video")
                data, ctype = v["cover"](q.get("id", "")) if v else (None, None)
                if not data:
                    return self._send(404, {"error": "No poster"})
                return self._send(200, data, ctype, {"Cache-Control": "max-age=86400"})
            if p == "/nv/list":
                if q.get("kind", "music") != "music":
                    return self._send(404, {"error": "Not on this PC yet"})
                if not _idx["ready"] or q.get("fresh") == "1":
                    threading.Thread(target=build_music, args=(q.get("fresh") == "1",), daemon=True).start()
                if not _idx["ready"]:
                    return self._send(200, dict(ready=False, done=_idx["done"], total=_idx["total"], items=[]))
                return self._send(200, dict(ready=True, done=_idx["done"], total=_idx["total"], at=_idx["at"], items=_idx["items"]))
            if p in ("/nv/file", "/nv/stream"):
                f = _file_path(q.get("id", ""))
                if not f and _ctx.get("video"):
                    build_video()
                    f = _file_path(q.get("id", ""))
                if not f and _ctx.get("models"):
                    build_models()
                    f = _file_path(q.get("id", ""))
                if not f and _ctx.get("books"):
                    build_books()
                    f = _file_path(q.get("id", ""))
                if not f or not os.path.exists(f):
                    return self._send(404, {"error": "That file is not here (is the drive connected?)"})
                if p == "/nv/file":
                    return self._file(f, MIME.get(os.path.splitext(f)[1].lower(), "application/octet-stream"))
                return self._stream(f, float(q.get("start", "0") or 0))
            if p == "/nv/cover":
                c = _idx["covers"].get(q.get("id", ""))
                if not c:
                    return self._send(404, {"error": "No cover"})
                if c[0] not in _cover_cache:
                    if len(_cover_cache) > 300:
                        _cover_cache.clear()
                    _cover_cache[c[0]] = find_cover(c[0], c[1], c[2])
                data, ctype = _cover_cache[c[0]]
                if not data:
                    return self._send(404, {"error": "No cover"})
                return self._send(200, data, ctype, {"Cache-Control": "max-age=86400"})
            return self._send(404, {"error": "Not found"})
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:
            try:
                self._send(500, {"error": f"{type(e).__name__}: {e}"})
            except Exception:
                pass

    def _file(self, path, ctype):
        size = os.path.getsize(path)
        start, end, code = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1) == "":
                start = max(0, size - int(m.group(2)))
            else:
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            code = 206
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as fh:
            fh.seek(start)
            left = length
            while left > 0:
                chunk = fh.read(min(262144, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def _vstream(self, path, start, audio):
        """A video the phone can't play as it is: converted on the fly to MP4 (the same way the PC app's own player does it)."""
        cmd = _ctx["video"]["cmd"](path, max(0.0, start), max(0, audio))
        if not cmd:
            return self._send(501, {"error": "ffmpeg is missing on the PC, so this video can't be converted (Nightvault > Settings > Components)."})
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            if self.command == "HEAD":
                return
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
        finally:
            try:
                proc.kill()
                proc.wait(timeout=5)
            except Exception:
                pass

    def _stream(self, path, start):
        ff = _ctx["ffmpeg"]()
        if not ff:
            return self._send(501, {"error": "ffmpeg is missing on the PC, so this song can't be converted (Nightvault > Settings > Components)."})
        proc = subprocess.Popen([ff, "-v", "error", "-ss", f"{max(0.0, start):.3f}", "-i", path, "-vn", "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k",
                                 "-f", "mp3", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
        finally:
            try:
                proc.kill()
            except Exception:
                pass
