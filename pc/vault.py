#!/usr/bin/env python3
"""
Nightvault - collection tracker (test build 0.1)
===========================================
A local web app: this program is the server, your browser is the window.

    python vault.py

Needs these files in the SAME folder:
    vault.py          (this file)
    vault_ui.html     (the pages)
    media_catalog.py  (drive scanner / file-name reading)
    media_online.py   (TMDB / Comic Vine lookups)

On the first start it sets itself up: it installs the small helper packages it uses (Pillow, numpy)
and downloads the video tool (ffmpeg) into a "nightvault_tools" folder next to the program - nothing
else on the PC is changed.  Use  --no-setup  to skip all of that.  The server listens on this PC
only (127.0.0.1), so nobody else on your network can reach it.  Your data lives in media_catalog.db
next to the program - the same database the older desktop catalog used, so earlier scans carry over.
"""

import importlib
import importlib.util
from collections import Counter
import os
import shlex
import subprocess
import sys


def _pip_command(extra=()):
    """The pip command for this Python: per-user (no admin rights needed) unless we are inside a virtual environment."""
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input"]
    if sys.prefix == getattr(sys, "base_prefix", sys.prefix):
        cmd.append("--user")
    return cmd + shlex.split(os.environ.get("NIGHTVAULT_PIP_ARGS", "")) + list(extra)


def _pip_one(packages):
    r = subprocess.run(_pip_command(packages), capture_output=True, text=True)
    if r.returncode != 0 and os.name != "nt" and "externally-managed" in (r.stdout + r.stderr):
        r = subprocess.run(_pip_command(["--break-system-packages"] + list(packages)), capture_output=True, text=True)
    return r


def _pip_install(packages):
    """-> (ok, last lines of pip's message).  Each package is installed on its own, so one that cannot be found
    (for example on a very new Python) never stops the others.  Also makes them importable in this running program."""
    if importlib.util.find_spec("pip") is None:
        try:
            import ensurepip
            ensurepip.bootstrap(user=True)
        except Exception as e:
            return False, f"pip is not available ({e})"
    failed = []
    for pkg in packages:
        r = _pip_one([pkg])
        if r.returncode != 0:
            failed.append(" ".join((r.stderr or r.stdout).strip().splitlines()[-1:]) or f"{pkg} could not be installed")
    importlib.invalidate_caches()
    try:
        import site
        site.addsitedir(site.getusersitepackages())
    except Exception:
        pass
    return not failed, "\n".join(failed)


def _first_run_packages(needed=None):
    """First start on a new PC: install the helper packages that are missing, with plain-language messages."""
    if os.environ.get("NIGHTVAULT_NO_SETUP") or "--no-setup" in sys.argv:
        return
    needed = needed or [("PIL", "pillow"), ("numpy", "numpy"), ("mutagen", "mutagen"), ("pypdfium2", "pypdfium2")]
    missing = [pip for mod, pip in needed if importlib.util.find_spec(mod) is None]
    if not missing:
        return
    print("\n  Nightvault is getting ready for the first time.")
    print(f"  Installing helper parts ({', '.join(missing)}) - about a minute, internet needed ...\n")
    ok, msg = _pip_install(missing)
    still = [pip for mod, pip in needed if importlib.util.find_spec(mod) is None]
    if still:
        print(f"  Could not install {', '.join(still)}. Nightvault starts anyway; those features stay switched off.")
        print("  Open Settings > Components inside Nightvault for what to do. (" + (msg.splitlines()[-1] if msg else "no message") + ")\n")
    else:
        print("  Helper parts are ready.\n")


def _check_install_folder():
    """Plain-language problems instead of a wall of red text: a too-old Python, or files that are not next to vault.py."""
    if sys.version_info < (3, 10):
        sys.exit("\n  Nightvault needs Python 3.10 or newer - this PC has " + ".".join(map(str, sys.version_info[:3])) +
                 ".\n  Install the newest Python from  https://www.python.org/downloads/  (tick \"Add python.exe to PATH\"), then start Nightvault again.\n")
    here = os.path.dirname(os.path.abspath(__file__))
    missing = [f for f in ("vault_ui.html", "media_catalog.py", "media_online.py") if not os.path.exists(os.path.join(here, f))]
    if missing:
        sys.exit("\n  Nightvault cannot start: these files are missing next to vault.py:\n      " + "\n      ".join(missing) +
                 "\n\n  If you opened Nightvault from inside a zip file: right-click the zip, choose \"Extract All\","
                 "\n  and start it from the new folder. All the files of Nightvault must stay together in one folder.\n")


if __name__ == "__main__":
    _check_install_folder()
    _first_run_packages()

import csv
import difflib
import gzip
import hashlib
import io
import json
import mimetypes
import posixpath
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile
import os
import re
import random
import math
import secrets
import sqlite3
import struct
import sys
import platform
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
try:
    import media_catalog as mc
except ImportError:
    sys.exit("media_catalog.py must be in the same folder as vault.py")
try:
    import media_online as online
except ImportError:
    online = None
try:
    import vault_cardsrc as cardsrc
except ImportError:
    cardsrc = None
try:
    import vault_phone as phone           # Phone access: the phone app reaches this PC's music over the home network (off until switched on)
except Exception:
    phone = None
try:
    import vault_news as vnews            # New volumes / issues: a daily look online at the manga and comic series in the library
except Exception:
    vnews = None
try:
    import vault_games as vgames          # Games: start the owner's game backups (emulators) and Steam games on this PC, also from the phone
except Exception:
    vgames = None
try:
    import vault_ccgtrader as ccgt          # the CCG Trader catalog: 295 card games (sets, numbers, pictures)
except ImportError:
    ccgt = None
try:
    import vault_tcgdata as tdata           # the other games of the phone app: One Piece, Star Wars CCG, Gundam, Digimon, FaB, ...
except Exception:
    tdata = None
try:
    import vault_opcards as opc            # One Piece card list kept offline for the Card templates page
except Exception:
    opc = None
try:
    import vault_template as vtpl          # Card templates: pick the layers of a layered PSD with dropdowns, preview, save PNG/PSD
except Exception:
    vtpl = None
try:
    import vault_proxyshop as pxs           # Proxyshop offline: card data for Photoshop templates without internet
except Exception:
    pxs = None

if os.environ.get("VAULT_DB"):
    mc.DB_PATH = Path(os.environ["VAULT_DB"])
COVER_DIR = mc.DB_PATH.parent / "vault_covers"
PHOTO_DIR = mc.DB_PATH.parent / "vault_photos"
TEMPLATE_DIR = mc.DB_PATH.parent / "vault_templates"            # layered PSD templates the owner opened (stay on this PC)
TOOLS_DIR = mc.DB_PATH.parent / "nightvault_tools"          # tools Nightvault downloads for itself (ffmpeg)
NV_UA = "Nightvault/0.1 (personal collection tracker)"
UI_FILE = HERE / "vault_ui.html"
VERSION = "0.1 test build"
BUILD = "20261113-n25"   # the page and the program must carry the same build id

# --------------------------------------------------------------------------- #
# Collections (the list in the sidebar).  Every collection has a KIND: what it behaves like.
# The kind decides which scanned files may live in it (cats) and so which viewer opens them
# (comic reader, book reader, video player, 3D viewer).  You can add your own collections in
# Settings - they pick one of these kinds and get the same abilities.
# --------------------------------------------------------------------------- #
KINDS = {
    "video":     dict(label="Videos - movies and episodes (video player)", cats=("movie", "series")),
    "comic":     dict(label="Comics (comic reader for CBZ, CBR, PDF)", cats=("comic",)),
    "manga":     dict(label="Manga (comic reader, right to left)", cats=("comic",)),
    "book":      dict(label="Books (EPUB reader)", cats=("book",)),
    "model3d":   dict(label="3D models (3D viewer for STL, OBJ, 3MF)", cats=("model",)),
    "music":     dict(label="Music (audio player)", cats=("music",)),
    "rpg":       dict(label="Roleplaying books (PDF reader with print)", cats=("book", "comic")),
    "boardgame": dict(label="Board games (with BoardGameGeek sync)", cats=()),
    "manual":    dict(label="Things you add by hand (physical or digital)", cats=()),
    "card":      dict(label="Card games", cats=()),
}
COLLECTIONS = [
    dict(id="movie", name="Movies", group="Watch", icon="movie", kind="video"),
    dict(id="series", name="Series", group="Watch", icon="device-tv", kind="video"),
    dict(id="anime", name="Anime", group="Watch", icon="sparkles", kind="video"),
    dict(id="comic", name="Comics", group="Read", icon="book-2", kind="comic"),
    dict(id="manga", name="Manga", group="Read", icon="book", kind="manga"),
    dict(id="book", name="Books", group="Read", icon="books", kind="book"),
    dict(id="colorbook", name="Colouring books", group="Read", icon="brush", kind="manual"),
    dict(id="music", name="Music", group="Listen", icon="music", kind="music"),
    dict(id="rpg", name="Roleplaying (RPG)", group="Tabletop", icon="swords", kind="rpg"),
    dict(id="boardgame", name="Board games", group="Tabletop", icon="dice-5", kind="boardgame"),
    dict(id="miniatures", name="Miniatures & terrain", group="Tabletop", icon="chess-knight", kind="manual"),
    dict(id="card", name="Cards", group="Play", icon="cards", kind="card"),
    dict(id="retro", name="Retro games", group="Play", icon="device-gamepad-2", kind="manual"),
    dict(id="rom", name="Emulators, ROMs", group="Play", icon="cpu", kind="manual"),
    dict(id="model3d", name="3D models", group="Make", icon="box", kind="model3d"),
]
for _c in COLLECTIONS:
    _c["scanned"] = bool(KINDS[_c["kind"]]["cats"])     # the drive scanner can fill it (otherwise items are added by hand)
COLL_BY_ID = {c["id"]: c for c in COLLECTIONS}
CAT_TO_COLL = {"movie": "movie", "series": "series", "comic": "comic", "book": "book", "collection": "movie", "model": "model3d", "music": "music"}
TYPE_NAMES = {c["id"]: c["name"] for c in COLLECTIONS}
RPG_WORDS = re.compile(r"(?i)(?:^|[\\/ _.\-\[(])(rpgs?|ttrpgs?|d&d|dnd|dungeons|pathfinder|starfinder|cthulhu|shadowrun|roleplaying|role-playing|savage worlds|monster manual|players? handbook|dungeon master)(?:$|[\\/ _.\-\])'s])")
MANGA_WORDS = re.compile(r"(?i)(?:^|[\\/ _.\-\[(])(manga|manhwa|manhua)(?:$|[\\/ _.\-\])])")

VAULT_SCHEMA = """
CREATE TABLE IF NOT EXISTS folder_coll (path TEXT PRIMARY KEY, coll TEXT);
CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, color TEXT);
CREATE TABLE IF NOT EXISTS ownership (cat TEXT, gkey TEXT, format TEXT, owners TEXT, location TEXT,
    notes TEXT, tags TEXT, PRIMARY KEY (cat, gkey));
CREATE TABLE IF NOT EXISTS manual_items (id INTEGER PRIMARY KEY AUTOINCREMENT, cat TEXT, name TEXT, year TEXT,
    format TEXT, owners TEXT, location TEXT, notes TEXT, tags TEXT, created REAL);
CREATE TABLE IF NOT EXISTS manual_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, cat TEXT, name TEXT, note TEXT, created REAL);
CREATE TABLE IF NOT EXISTS covers (key TEXT PRIMARY KEY, file TEXT);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS reading (path TEXT PRIMARY KEY, page INTEGER, total INTEGER, finished INTEGER,
    updated REAL);
CREATE TABLE IF NOT EXISTS watching (path TEXT PRIMARY KEY, pos REAL, duration REAL, finished INTEGER,
    updated REAL);
CREATE TABLE IF NOT EXISTS bookprog (path TEXT PRIMARY KEY, chapter INTEGER, ratio REAL, percent REAL,
    finished INTEGER, updated REAL);
CREATE TABLE IF NOT EXISTS auto_covers (key TEXT PRIMARY KEY, ext TEXT);
CREATE TABLE IF NOT EXISTS meta (gid TEXT PRIMARY KEY, tag TEXT, genres TEXT, data TEXT, fetched REAL);
CREATE TABLE IF NOT EXISTS card_index (id TEXT PRIMARY KEY, path TEXT, mtime REAL, size INTEGER, set_code TEXT,
    number TEXT, name TEXT, vec BLOB);
CREATE TABLE IF NOT EXISTS card_meta (id TEXT PRIMARY KEY, sid TEXT, set_code TEXT, number TEXT, name TEXT, set_name TEXT,
    rarity TEXT, type_line TEXT, released TEXT, eur REAL, eur_foil REAL, usd REAL, usd_foil REAL, lang TEXT);
CREATE TABLE IF NOT EXISTS wishlist (id INTEGER PRIMARY KEY AUTOINCREMENT, cat TEXT, name TEXT, note TEXT, url TEXT, date TEXT,
    source TEXT, owner INTEGER, ref TEXT, added REAL);
CREATE TABLE IF NOT EXISTS links (a TEXT, b TEXT, kind TEXT, PRIMARY KEY (a, b, kind));
CREATE TABLE IF NOT EXISTS item_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, gid TEXT, file TEXT, credit TEXT, added REAL);
CREATE INDEX IF NOT EXISTS idx_photos_gid ON item_photos(gid);
CREATE TABLE IF NOT EXISTS cg_games (id TEXT PRIMARY KEY, name TEXT, blurb TEXT, color TEXT, demo INTEGER);
CREATE TABLE IF NOT EXISTS cg_setlist (game TEXT, code TEXT, name TEXT, released TEXT, total INTEGER, PRIMARY KEY (game, code));
CREATE TABLE IF NOT EXISTS cg_sets (game TEXT, code TEXT, name TEXT, released TEXT, demo INTEGER, PRIMARY KEY (game, code));
CREATE TABLE IF NOT EXISTS cg_cards (game TEXT, set_code TEXT, number TEXT, name TEXT, rarity TEXT, ctype TEXT, cost TEXT, pt TEXT,
    rules TEXT, flavor TEXT, artist TEXT, price REAL, path TEXT, demo INTEGER, PRIMARY KEY (game, set_code, number));
CREATE TABLE IF NOT EXISTS cg_owned (game TEXT, set_code TEXT, number TEXT, foil INTEGER, qty INTEGER,
    PRIMARY KEY (game, set_code, number, foil));
CREATE TABLE IF NOT EXISTS cg_text (game TEXT, kind TEXT, body TEXT, demo INTEGER, PRIMARY KEY (game, kind));
CREATE TABLE IF NOT EXISTS cg_docs (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT, title TEXT, path TEXT, url TEXT, added REAL);
CREATE TABLE IF NOT EXISTS cg_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT, date TEXT, title TEXT, body TEXT, url TEXT,
    source TEXT, guid TEXT, demo INTEGER, UNIQUE (game, guid));
CREATE TABLE IF NOT EXISTS cg_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT, label TEXT, url TEXT, UNIQUE (game, url));
CREATE TABLE IF NOT EXISTS bgg_map (gid TEXT PRIMARY KEY, bgg_id INTEGER, last_seen REAL);
CREATE TABLE IF NOT EXISTS proxy_art (id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT, name TEXT, key TEXT, label TEXT, file TEXT, added REAL);
CREATE TABLE IF NOT EXISTS proxy_decks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, game TEXT, entries TEXT, settings TEXT, updated REAL);
CREATE TABLE IF NOT EXISTS cg_prices (game TEXT, set_code TEXT, number TEXT, src TEXT, price REAL, foil REAL, low REAL, avg30 REAL, pid INTEGER, cur TEXT, at REAL,
    PRIMARY KEY (game, set_code, number, src));
CREATE TABLE IF NOT EXISTS card_owned (id TEXT, foil INTEGER, owner INTEGER, qty INTEGER, location TEXT, updated REAL,
    PRIMARY KEY (id, foil, owner));
"""

TOKEN = secrets.token_hex(16)
PORT = 8765


def connect():
    conn = mc.db_connect()
    conn.executescript(VAULT_SCHEMA)
    for table, col, typ in (("cg_cards", "cmc", "REAL"), ("cg_cards", "colors", "TEXT"), ("cg_cards", "subtype", "TEXT"), ("cg_cards", "back_path", "TEXT"), ("cg_cards", "price_dl", "REAL"), ("cg_cards", "pxdone", "INTEGER"),
                            ("card_meta", "cmc", "REAL"), ("card_meta", "colors", "TEXT"), ("manual_items", "line_id", "INTEGER"), ("manual_lines", "parent_id", "INTEGER"), ("manual_items", "pic_url", "TEXT")):
        try:                                   # older databases get the new columns once
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    return conn


def get_setting(conn, key, default=""):
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def put_setting(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO app_settings VALUES (?,?)", (key, value))
    conn.commit()


def cv_cooldown_minutes(conn):
    """Minutes until Comic Vine accepts requests again (0 = available)."""
    if not online:
        return 0
    try:
        now, wait = time.time(), 0
        for res, n, oldest in conn.execute(
                "SELECT resource, COUNT(*), MIN(ts) FROM api_calls WHERE ts>? GROUP BY resource", (now - 3600,)):
            if n >= getattr(online, "CV_HOURLY_LIMIT", 190):
                wait = max(wait, int((oldest + 3600 - now) / 60) + 1)
        return wait
    except sqlite3.Error:
        return 0


def jl(text, default):
    try:
        v = json.loads(text) if text else default
        return v if v is not None else default
    except ValueError:
        return default


# --------------------------------------------------------------------------- #
# Library data (cached until something changes)
# --------------------------------------------------------------------------- #
_glock = threading.Lock()
_stamp = [0]
_cache = {"stamp": -1, "from_one": None, "groups": None}


def bump():
    _stamp[0] += 1


def custom_collections(conn):
    out = []
    for c in jl(get_setting(conn, "custom_colls"), []):
        if c.get("id") and c.get("kind") in KINDS:
            out.append(dict(id=c["id"], name=c.get("name") or c["id"], group=c.get("group") or "Other", icon=c.get("icon") or "folder",
                            kind=c["kind"], custom=True, scanned=bool(KINDS[c["kind"]]["cats"])))
    return out


def all_collections(conn):
    gmap = jl(get_setting(conn, "collections"), {}).get("gmap") or {}      # a collection you moved to another group in the sidebar
    out = [dict(c, custom=False) for c in COLLECTIONS] + custom_collections(conn)
    for c in out:
        if gmap.get(c["id"]):
            c["group"] = gmap[c["id"]]
    return out


def coll_map(conn):
    return {c["id"]: c for c in all_collections(conn)}


def coll_of(g):
    """The collection a group of files belongs to (set by get_groups)."""
    return g.get("coll") or CAT_TO_COLL.get(g["cat"], g["cat"])


def folder_rules(conn):
    rows = [(os.path.normcase(os.path.normpath(r["path"])), r["coll"]) for r in conn.execute("SELECT path, coll FROM folder_coll")]
    return sorted(rows, key=lambda x: -len(x[0]))


def file_coll(path, root, cat, rules, kinds):
    """Which collection a scanned file goes to when that is not the usual one for its kind of file (None = the usual one).
    A folder you assigned wins; without an assignment, comics inside a folder called manga / manhwa / manhua become Manga."""
    low = os.path.normcase(path)
    for prefix, coll in rules:
        if low == prefix or low.startswith(prefix.rstrip(os.sep) + os.sep):
            kind = kinds.get(coll)
            if kind and cat in KINDS[kind]["cats"]:
                return None if coll == CAT_TO_COLL.get(cat) else coll
            return None
    if cat in ("book", "comic") and path.lower().endswith(".pdf") and kinds.get("rpg") == "rpg":
        rel = path[len(root):] if root and path.startswith(root) else path
        if RPG_WORDS.search(os.path.basename(root.rstrip("\\/")) + os.sep + rel):   # PDFs inside a folder named RPG / D&D / Pathfinder ...
            return "rpg"
    if cat == "comic":
        rel = path[len(root):] if root and path.startswith(root) else path
        if MANGA_WORDS.search(os.path.basename(root.rstrip("\\/")) + os.sep + rel):      # the folder you added counts too
            return "manga"
    return None


def get_groups(conn, from_one):
    with _glock:
        if _cache["stamp"] == _stamp[0] and _cache["from_one"] == from_one:
            return _cache["groups"]
        st = _stamp[0]
    rules = folder_rules(conn)
    kinds = {c["id"]: c["kind"] for c in all_collections(conn)}
    rows = []
    for r in conn.execute("SELECT path, root, size, category, gkey, gname, season, number, total, year FROM files"):
        d = dict(r)
        c = file_coll(d["path"], d["root"] or "", d["category"], rules, kinds)
        if c:
            d["gkey"] = d["gkey"] + "@" + c          # the same series in two collections stays two separate items
        rows.append(d)
    groups = mc.build_groups(rows, from_one)
    if online:
        try:
            groups = online.apply_online(conn, groups, from_one)
        except Exception:
            traceback.print_exc()
    for g in groups:
        g["coll"] = g["gkey"].rsplit("@", 1)[1] if "@" in g["gkey"] else CAT_TO_COLL.get(g["cat"], g["cat"])
    with _glock:
        _cache.update(stamp=st, from_one=from_one, groups=groups)
    return groups


def gid_of(g):
    return f"{g['cat']}|{g['gkey']}"


def _news_series():
    """The comic and manga series of the library, for the daily new-volumes check (vault_news.py)."""
    conn = connect()
    try:
        colls = {c["id"]: c for c in all_collections(conn)}
        out = []
        for g in get_groups(conn, False):
            c = colls.get(coll_of(g))
            if g["cat"] != "comic" or not c or c.get("kind") not in ("comic", "manga"):
                continue
            nums = sorted({n for n in (i.get("number") for i in g["items"]) if isinstance(n, (int, float))})
            out.append(dict(gid=gid_of(g), name=g["name"], kind=c["kind"], numbers=[int(n) if n == int(n) else n for n in nums], count=len(g["items"])))
        return out
    finally:
        conn.close()


def library(conn, from_one):
    own = {(r["cat"], r["gkey"]): r for r in conn.execute("SELECT * FROM ownership")}
    covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
    genres = {r["gid"]: jl(r["genres"], []) for r in conn.execute("SELECT gid, genres FROM meta")}
    names = {c["id"]: c["name"] for c in all_collections(conn)}
    news = {}
    if vnews:
        try:
            news = vnews.news().get("items") or {}
        except Exception:
            news = {}
    out = []
    for g in get_groups(conn, from_one):
        o = own.get((g["cat"], g["gkey"]))
        gid = gid_of(g)
        out.append(dict(
            id=gid, coll=coll_of(g), type=("Manga" if coll_of(g) == "manga" else "RPG book" if coll_of(g) == "rpg" else mc.CAT_NAMES.get(g["cat"], g["cat"])),
            name=g["name"], year=g.get("year"), files=len(g["items"]),
            size=sum(i["size"] for i in g["items"]), missing=g["miss_count"], dupes=g["dupes"],
            online=g.get("online", ""), format=(o["format"] if o else "digital"),
            owners=jl(o["owners"] if o else "", []), location=(o["location"] if o else "") or "",
            tags=jl(o["tags"] if o else "", []), genres=genres.get(gid, []), manual=False, cover=gid in covers,
            newn=(len(news[gid]["new"]) if isinstance(news[gid].get("new"), list) else news[gid].get("new") or 0) if gid in news else 0))
    for r in conn.execute("SELECT * FROM manual_items"):
        gid = f"m:{r['id']}"
        out.append(dict(
            id=gid, coll=r["cat"], type=names.get(r["cat"], r["cat"]), name=r["name"], year=r["year"] or None,
            files=0, size=0, missing=0, dupes=0, online="", format=r["format"] or "physical",
            owners=jl(r["owners"], []), location=r["location"] or "", tags=jl(r["tags"], []),
            genres=genres.get(gid, []), manual=True, cover=gid in covers, line=r["line_id"]))
    return out


def line_list(conn, cat=None):
    """Product lines of a collection (or all). A line can hold series (child lines) and items. Each has its own item count (own),
    the count including everything below it (count), the number of series (sub) and the picture that stands for it:
    its own picture, else the first item with one, else the picture of its first series."""
    covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
    q, a = ("SELECT * FROM manual_lines WHERE cat=? ORDER BY name COLLATE NOCASE", (cat,)) if cat else ("SELECT * FROM manual_lines ORDER BY cat, name COLLATE NOCASE", ())
    rows = conn.execute(q, a).fetchall()
    items = {}
    for i in conn.execute("SELECT id, line_id FROM manual_items WHERE line_id IS NOT NULL ORDER BY name COLLATE NOCASE"):
        items.setdefault(i["line_id"], []).append(i["id"])
    kids = {}
    for r in rows:
        kids.setdefault(r["parent_id"], []).append(r["id"])
    ids = {r["id"] for r in rows}
    memo = {}

    def info(lid, seen=()):
        if lid in memo:
            return memo[lid]
        mine = items.get(lid, [])
        own = f"l:{lid}" in covers
        pic = f"l:{lid}" if own else next((f"m:{i}" for i in mine if f"m:{i}" in covers), "")
        total, sub = len(mine), 0
        for k in kids.get(lid, []):
            if k in seen or k == lid:
                continue
            sub += 1
            kt, kp = info(k, seen + (lid,))
            total += kt
            pic = pic or kp
        memo[lid] = (total, pic)
        return memo[lid]

    out = []
    for r in rows:
        total, pic = info(r["id"])
        par = r["parent_id"] if r["parent_id"] in ids else None
        out.append(dict(id=r["id"], cat=r["cat"], name=r["name"], note=r["note"] or "", count=total, own=len(items.get(r["id"], [])),
                        sub=len([k for k in kids.get(r["id"], []) if k != r["id"]]), parent=par, cover=pic, own_cover=f"l:{r['id']}" in covers))
    return out


def line_path(conn, lid):
    """[{id, name}] from the top line down to this one."""
    out, seen = [], set()
    while lid and lid not in seen:
        seen.add(lid)
        r = conn.execute("SELECT id, name, parent_id FROM manual_lines WHERE id=?", (lid,)).fetchone()
        if not r:
            break
        out.insert(0, dict(id=r["id"], name=r["name"]))
        lid = r["parent_id"]
    return out


def line_delete_files(conn, line_id):
    cv = conn.execute("SELECT file FROM covers WHERE key=?", (f"l:{line_id}",)).fetchone()
    if cv:
        (COVER_DIR / cv["file"]).unlink(missing_ok=True)
        conn.execute("DELETE FROM covers WHERE key=?", (f"l:{line_id}",))


def new_manual_item(conn, cat, name, line_id=None, year="", fmt="physical", notes="", tags=None):
    cur = conn.execute("INSERT INTO manual_items (cat, name, year, format, owners, location, notes, tags, created, line_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (cat, name, year, fmt, "[]", "", notes, json.dumps(tags or []), time.time(), line_id))
    return f"m:{cur.lastrowid}"


def photo_list(conn, gid):
    return [dict(id=r["id"], credit=r["credit"] or "") for r in conn.execute("SELECT id, credit FROM item_photos WHERE gid=? ORDER BY id", (gid,))]


def photo_delete_files(conn, gid):
    for r in conn.execute("SELECT file FROM item_photos WHERE gid=?", (gid,)).fetchall():
        (PHOTO_DIR / r["file"]).unlink(missing_ok=True)
    conn.execute("DELETE FROM item_photos WHERE gid=?", (gid,))


def add_photo(conn, gid, data, credit=""):
    ext = sniff_image(data)
    if ext not in (".jpg", ".png", ".webp", ".gif"):
        raise ValueError("Use a JPG, PNG, WEBP or GIF picture")
    if len(data) > 12 * 1024 * 1024:
        raise ValueError("Picture is larger than 12 MB")
    PHOTO_DIR.mkdir(exist_ok=True)
    name = hashlib.sha1(data).hexdigest()[:24] + ext
    (PHOTO_DIR / name).write_bytes(data)
    cur = conn.execute("INSERT INTO item_photos (gid, file, credit, added) VALUES (?,?,?,?)", (gid, name, credit[:120], time.time()))
    conn.commit()
    return cur.lastrowid


def item_detail(conn, gid, from_one):
    covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
    if gid.startswith("m:"):
        r = conn.execute("SELECT * FROM manual_items WHERE id=?", (int(gid[2:]),)).fetchone()
        if not r:
            raise KeyError("Item not found")
        return dict(id=gid, coll=r["cat"], type=coll_map(conn).get(r["cat"], {}).get("name", r["cat"]), name=r["name"],
                    year=r["year"], manual=True, format=r["format"], owners=jl(r["owners"], []),
                    location=r["location"] or "", notes=r["notes"] or "", tags=jl(r["tags"], []),
                    missing=[], dupes=0, online="", match=None, matchable=False, files=[], size=0, photos=photo_list(conn, gid),
                    cover=gid in covers, about=jl((conn.execute("SELECT data FROM meta WHERE gid=?", (gid,)).fetchone() or [None])[0], None),
                    line=r["line_id"], line_path=line_path(conn, r["line_id"]) if r["line_id"] else [],
                    line_name=" \u203a ".join(x["name"] for x in line_path(conn, r["line_id"])) if r["line_id"] else "")
    cat, gkey = gid.split("|", 1)
    g = next((x for x in get_groups(conn, from_one) if x["cat"] == cat and x["gkey"] == gkey), None)
    if not g:
        raise KeyError("Item not found")
    o = conn.execute("SELECT * FROM ownership WHERE cat=? AND gkey=?", (cat, gkey)).fetchone()
    items = sorted(g["items"], key=lambda r: (r["season"] or 0, r["number"] if r["number"] is not None else -1,
                                              r["path"]))
    reads = {r["path"]: dict(page=r["page"], total=r["total"], finished=bool(r["finished"]))
             for r in conn.execute("SELECT * FROM reading")}
    watches = {r["path"]: dict(pos=r["pos"], duration=r["duration"], finished=bool(r["finished"]))
               for r in conn.execute("SELECT * FROM watching")}
    books = {r["path"]: dict(percent=r["percent"], finished=bool(r["finished"]))
             for r in conn.execute("SELECT * FROM bookprog")}
    files = [dict(label=mc.item_label(cat if cat != "collection" else "movie", r), name=os.path.basename(r["path"]),
                  size=r["size"], folder=os.path.dirname(r["path"]), path=r["path"],
                  readable=os.path.splitext(r["path"])[1].lower() in readable_exts(),
                  read=reads.get(r["path"]),
                  watchable=os.path.splitext(r["path"])[1].lower() in VIDEO_EXT,
                  watch=watches.get(r["path"]),
                  bookable=os.path.splitext(r["path"])[1].lower() in BOOK_EXT,
                  model=os.path.splitext(r["path"])[1].lower() in MODEL_EXT,
                  audio=os.path.splitext(r["path"])[1].lower() in AUDIO_EXT,
                  pdf=os.path.splitext(r["path"])[1].lower() == ".pdf",
                  book=books.get(r["path"])) for r in items]
    match = g.get("match")
    return dict(
        id=gid, coll=coll_of(g), type=("Manga" if coll_of(g) == "manga" else "RPG book" if coll_of(g) == "rpg" else mc.CAT_NAMES.get(cat, cat)), name=g["name"],
        year=g.get("year"), manual=False, format=(o["format"] if o else "digital"),
        owners=jl(o["owners"] if o else "", []), location=(o["location"] if o else "") or "",
        notes=(o["notes"] if o else "") or "", tags=jl(o["tags"] if o else "", []),
        about=jl((conn.execute("SELECT data FROM meta WHERE gid=?", (gid,)).fetchone() or [None])[0], None),
        missing=[list(m) for m in g["missing"]], dupes=g["dupes"], online=g.get("online", ""),
        match=(online.describe_match(match) if online and match else None),
        matchable=bool(online and cat in ("series", "movie", "comic") and coll_of(g) in ("movie", "series", "comic")), files=files,
        size=sum(i["size"] for i in items), cover=gid in covers, photos=photo_list(conn, gid))


# --------------------------------------------------------------------------- #
# Background jobs (scan, online check, calendar refresh)
# --------------------------------------------------------------------------- #
JOB = {"running": False, "kind": "", "text": "", "log": [], "id": 0}
JOB_LOCK = threading.Lock()
STOP = threading.Event()


def start_job(kind, fn):
    with JOB_LOCK:
        if JOB["running"]:
            return False
        JOB.update(running=True, kind=kind, text="Starting ...", log=[], id=JOB["id"] + 1)
        STOP.clear()

    def run():
        conn = connect()
        try:
            fn(conn, say, progress)
        except Exception as e:
            traceback.print_exc()
            say(f"Error: {type(e).__name__}: {e}")
        finally:
            conn.close()
            bump()
            with JOB_LOCK:
                JOB.update(running=False, text="Done")

    def say(msg):
        with JOB_LOCK:
            JOB["log"].append(msg)
            del JOB["log"][:-300]

    def progress(msg):
        with JOB_LOCK:
            JOB["text"] = msg

    threading.Thread(target=run, daemon=True).start()
    return True


def job_scan(conn, say, progress):
    roots = [r["path"] for r in conn.execute("SELECT path FROM roots ORDER BY path")]
    if not roots:
        say("No folders added yet.")
        return
    for r in roots:
        if STOP.is_set():
            break
        if not os.path.isdir(r):
            say(f"Not available right now (kept in the catalog): {r}")
            continue
        say(f"Scanning {r} ...")
        res = mc.scan_root(conn, r, progress, STOP)
        if res is None:
            say("Scan stopped.")
            break
        new, changed, removed, total = res
        say(f"   {total:,} media files  ({new:,} new, {changed:,} changed, {removed:,} gone)")
    try:
        if get_setting(conn, "auto_covers", "1") == "1" and not STOP.is_set():
            bump()
            n = local_covers(conn, say, progress, get_groups(conn, False))
            if n:
                say(f"Made {n} cover{'s' if n != 1 else ''} from the first page / picture inside your own files.")
    except Exception as e:
        say(f"Covers from your files were skipped: {e}")
    say("Scan finished.")


def online_targets(conn, only=None, coll=None):
    out = []
    for g in get_groups(conn, False):
        if g["cat"] not in ("movie", "series", "comic") or coll_of(g) not in ("movie", "series", "comic"):
            continue                                    # manga and your own collections have no online lookup
        if coll and coll_of(g) != coll:
            continue
        numbered = any(i["number"] is not None for i in g["items"])
        if g["cat"] == "movie" or numbered:
            t = dict(cat=g["cat"], gkey=g["gkey"], name=g["name"], year=g.get("year"))
            if only is None or (t["cat"], t["gkey"]) == only:
                out.append(t)
    return out


def job_online(only=None, coll=None):
    def run(conn, say, progress):
        targets = online_targets(conn, only, coll)
        if not targets:
            say("Nothing to check here yet - scan some folders first." if not coll and not only
                else "Nothing to check in this selection.")
            return
        res = online.online_check(conn, targets, progress, STOP)
        say(f"Online check finished: {res.get('checked', 0)} titles checked.")
        for e in res.get("errors", []):
            say("Note: " + e)
        if not STOP.is_set():
            fetch_info(conn, say, progress, only, coll)
        if not STOP.is_set():
            fetch_covers(conn, say, progress, only, coll)
    return run


def job_calendar(days):
    def run(conn, say, progress):
        res = online.refresh_calendar(conn, days, progress, STOP)
        say("Upcoming list updated.")
        for e in res.get("errors", []):
            say("Note: " + e)
    return run


# --------------------------------------------------------------------------- #
# Comic reader: read pages out of CBZ (zip) and, when the PC can unpack them, CBR / CB7
# --------------------------------------------------------------------------- #
BOOKCASE_EXT = {".cbz", ".cbr", ".cb7", ".cbt", ".zip", ".pdf", ".epub"}
READABLE_EXT = {".cbz", ".cbr", ".cb7", ".cbt", ".zip"}
IMG_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
             ".gif": "image/gif", ".avif": "image/avif", ".bmp": "image/bmp"}
READER_CACHE = mc.DB_PATH.parent / "vault_cache"
_rlock = threading.RLock()
_pages = {}  # path -> (signature, info)


def natural_key(text):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", text)]


def is_image(name):
    parts = name.replace("\\", "/").split("/")
    base = parts[-1]
    return (bool(base) and not base.startswith(".") and "__MACOSX" not in parts
            and os.path.splitext(base)[1].lower() in IMG_TYPES)


def sniff_archive(path):
    with open(path, "rb") as f:
        head = f.read(8)
    if head[:4] in (b"PK\x03\x04", b"PK\x05\x06"):
        return "zip"
    if head[:6] == b"Rar!\x1a\x07":
        return "rar"
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        return "7z"
    return "zip" if zipfile.is_zipfile(path) else "other"


def unpack_tools():
    """Programs on this PC that can unpack RAR / 7z: Windows' built-in tar (bsdtar) or 7-Zip."""
    tools = []
    for exe in ("bsdtar", "tar"):
        found = shutil.which(exe)
        if found:
            try:
                out = subprocess.run([found, "--version"], capture_output=True, text=True, timeout=10)
                if "bsdtar" in (out.stdout + out.stderr).lower():
                    tools.append(("tar", found))
                    break
            except (OSError, subprocess.SubprocessError):
                pass
    seven = shutil.which("7z") or shutil.which("7za")
    for guess in (r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files (x86)\7-Zip\7z.exe"):
        if not seven and os.path.exists(guess):
            seven = guess
    if seven:
        tools.append(("7z", seven))
    return tools


def unpack_to_cache(path, st):
    tools = unpack_tools()
    if not tools:
        raise ValueError("This is a CBR/CB7 file. Reading it needs Windows 10's built-in 'tar' or 7-Zip "
                         "(install 7-Zip from 7-zip.org). CBZ files always work.")
    dest = READER_CACHE / hashlib.sha1(f"{path}|{st.st_mtime}|{st.st_size}".encode()).hexdigest()[:16]
    if dest.exists() and any(dest.rglob("*")):
        return dest
    dest.mkdir(parents=True, exist_ok=True)
    err = ""
    for kind, tool in tools:
        cmd = [tool, "-xf", path, "-C", str(dest)] if kind == "tar" else [tool, "x", "-y", f"-o{dest}", path]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=900)
        except (OSError, subprocess.SubprocessError) as e:
            err = str(e)
            continue
        if r.returncode == 0 and any(dest.rglob("*")):
            break
        err = (r.stderr or b"").decode("utf-8", "replace")[:200]
    else:
        shutil.rmtree(dest, ignore_errors=True)
        raise ValueError("Could not unpack this archive. " + err)
    # keep only the newest few unpacked comics
    folders = sorted((d for d in READER_CACHE.iterdir() if d.is_dir()), key=lambda d: d.stat().st_mtime)
    for old in folders[:-6]:
        shutil.rmtree(old, ignore_errors=True)
    return dest


# --- PDF pages as pictures (RPG books and PDF comics). Engines, best first: pypdfium2, PyMuPDF, poppler (pdftoppm).
_pdf_lock = threading.Lock()
_pdf_open = {}                       # path -> (signature, engine document) for the engines that keep documents open
_pdf_png = {}                        # (path, signature, page, width) -> PNG bytes, newest last
_pdf_found = [None]


def pdf_backend():
    if _pdf_found[0]:
        return _pdf_found[0]
    for mod, name in (("pypdfium2", "pdfium"), ("fitz", "fitz")):
        if importlib.util.find_spec(mod) is not None:
            _pdf_found[0] = name
            return name
    if shutil.which("pdftoppm") and shutil.which("pdfinfo"):
        _pdf_found[0] = "poppler"
        return "poppler"
    return ""


def readable_exts():
    return READABLE_EXT | ({".pdf"} if pdf_backend() else set())


def _pdf_doc(path, sig, engine):
    hit = _pdf_open.get(path)
    if hit and hit[0] == sig:
        return hit[1]
    if engine == "pdfium":
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(path)
    else:
        import fitz
        doc = fitz.open(path)
    while len(_pdf_open) >= 3:
        _, (_, old) = next(iter(_pdf_open.items()))
        _pdf_open.pop(next(iter(_pdf_open)))
        try:
            old.close()
        except Exception:
            pass
    _pdf_open[path] = (sig, doc)
    return doc


def pdf_count(path):
    st = os.stat(path)
    engine = pdf_backend()
    if not engine:
        raise ValueError("Reading PDFs inside Nightvault needs one small helper (pypdfium2). Open Settings > Components and press Set up.")
    with _pdf_lock:
        if engine == "poppler":
            out = subprocess.run(["pdfinfo", path], capture_output=True, text=True, timeout=60)
            m = re.search(r"^Pages:\s+(\d+)", out.stdout, re.M)
            if not m:
                raise ValueError("This PDF cannot be opened (it may be damaged or password protected).")
            return int(m.group(1))
        try:
            return len(_pdf_doc(path, (st.st_mtime, st.st_size), engine))
        except Exception as e:
            raise ValueError("This PDF cannot be opened (it may be damaged or password protected). " + str(e)[:80])


def pdf_png(path, n, width=1400):
    st = os.stat(path)
    sig = (st.st_mtime, st.st_size)
    width = max(200, min(int(width or 1400), 3200))
    key = (path, sig, n, width)
    with _pdf_lock:
        hit = _pdf_png.get(key)
        if hit:
            return hit
        engine = pdf_backend()
        if engine == "poppler":
            out = subprocess.run(["pdftoppm", "-f", str(n + 1), "-l", str(n + 1), "-png", "-scale-to-x", str(width), "-scale-to-y", "-1", path],
                                 capture_output=True, timeout=120)
            if out.returncode or not out.stdout:
                raise ValueError("Could not draw this page.")
            data = out.stdout
        elif engine == "pdfium":
            doc = _pdf_doc(path, sig, engine)
            page = doc[n]
            try:
                img = page.render(scale=width / max(1.0, page.get_width())).to_pil().convert("RGB")
            finally:
                page.close()
            buf = io.BytesIO()
            img.save(buf, "PNG")
            data = buf.getvalue()
        elif engine == "fitz":
            doc = _pdf_doc(path, sig, engine)
            page = doc.load_page(n)
            s = width / max(1.0, page.rect.width)
            import fitz
            data = page.get_pixmap(matrix=fitz.Matrix(s, s), alpha=False).tobytes("png")
        else:
            raise ValueError("No PDF helper installed.")
        _pdf_png[key] = data
        while len(_pdf_png) > 40:
            _pdf_png.pop(next(iter(_pdf_png)))
        return data


def comic_pages(path):
    """-> dict(kind='zip'|'dir', names=[...], dir=Path|None) - the sorted page list of a comic file."""
    st = os.stat(path)
    if path.lower().endswith(".pdf"):
        with _rlock:
            hit = _pages.get(path)
            if hit and hit[0] == (st.st_mtime, st.st_size):
                return hit[1]
        count = pdf_count(path)
        info = dict(kind="pdf", names=[""] * count, dir=None)
        with _rlock:
            _pages[path] = ((st.st_mtime, st.st_size), info)
        return info
    sig = (st.st_mtime, st.st_size)
    with _rlock:
        hit = _pages.get(path)
        if hit and hit[0] == sig:
            return hit[1]
        kind = sniff_archive(path)
        if kind == "zip":
            with zipfile.ZipFile(path) as z:
                names = sorted((n for n in z.namelist() if is_image(n)), key=natural_key)
            info = dict(kind="zip", names=names, dir=None)
        elif kind in ("rar", "7z"):
            d = unpack_to_cache(path, st)
            names = sorted((str(f.relative_to(d)).replace("\\", "/") for f in d.rglob("*")
                            if f.is_file() and is_image(f.name)), key=natural_key)
            info = dict(kind="dir", names=names, dir=d)
        else:
            raise ValueError("This file is not a comic archive I can read.")
        if not info["names"]:
            raise ValueError("No images were found inside this file.")
        _pages[path] = (sig, info)
        while len(_pages) > 12:
            _pages.pop(next(iter(_pages)))
        return info


def comic_page_bytes(path, n, width=None):
    info = comic_pages(path)
    if not 0 <= n < len(info["names"]):
        raise KeyError("No such page")
    if info["kind"] == "pdf":
        return pdf_png(path, n, width or 1400), "image/png"
    name = info["names"][n]
    ctype = IMG_TYPES[os.path.splitext(name)[1].lower()]
    if info["kind"] == "zip":
        with zipfile.ZipFile(path) as z:
            return z.read(name), ctype
    f = (info["dir"] / name).resolve()
    if info["dir"].resolve() not in f.parents:
        raise ValueError("Bad page path")
    return f.read_bytes(), ctype


# --------------------------------------------------------------------------- #
# Video player: play straight from the file when the browser can, otherwise (if ffmpeg is
# installed) convert on the fly.  Subtitles: .srt/.vtt files next to the video, or text
# subtitles inside it (needs ffmpeg).
# --------------------------------------------------------------------------- #
VIDEO_EXT = set(mc.VIDEO)
DIRECT_EXT = {".mp4", ".m4v", ".webm", ".mkv", ".mov"}
DIRECT_V = {"h264", "vp8", "vp9", "av1"}
DIRECT_A = {"aac", "mp3", "opus", "vorbis", "flac"}
TEXT_SUBS = {"subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text"}
VIDEO_MIME = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4", ".webm": "video/webm",
              ".mkv": "video/x-matroska"}
_probe_cache = {}


def _exe(name):
    return name + (".exe" if os.name == "nt" else "")


def ffbin(name):
    own = TOOLS_DIR / "ffmpeg" / "bin" / _exe(name)          # the copy Nightvault downloaded itself
    return str(own) if own.exists() else shutil.which(name)


def probe(path):
    """Codec / duration / track info via ffprobe (None when ffprobe is not installed)."""
    exe = ffbin("ffprobe")
    if not exe:
        return None
    st = os.stat(path)
    sig = (st.st_mtime, st.st_size)
    hit = _probe_cache.get(path)
    if hit and hit[0] == sig:
        return hit[1]
    try:
        r = subprocess.run([exe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                           capture_output=True, timeout=90)
        data = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    streams = data.get("streams") or []
    video = next((x for x in streams if x.get("codec_type") == "video"
                  and not (x.get("disposition") or {}).get("attached_pic")), None)
    audio = [dict(codec=x.get("codec_name", ""), lang=(x.get("tags") or {}).get("language", ""),
                  title=(x.get("tags") or {}).get("title", ""), channels=x.get("channels"))
             for x in streams if x.get("codec_type") == "audio"]
    subs = [dict(codec=x.get("codec_name", ""), lang=(x.get("tags") or {}).get("language", ""),
                 title=(x.get("tags") or {}).get("title", ""))
            for x in streams if x.get("codec_type") == "subtitle"]
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    info = dict(duration=duration, vcodec=(video or {}).get("codec_name", ""), pix_fmt=(video or {}).get("pix_fmt", ""),
                audio=audio, subs=subs)
    _probe_cache[path] = (sig, info)
    return info


def recommend_mode(path, pr):
    ext = os.path.splitext(path)[1].lower()
    can_convert = bool(ffbin("ffmpeg"))
    if pr is None:
        return "direct" if (ext in DIRECT_EXT or not can_convert) else "transcode"
    ok = (ext in DIRECT_EXT and pr["vcodec"] in DIRECT_V and pr["pix_fmt"] in ("yuv420p", "yuvj420p", "")
          and (not pr["audio"] or pr["audio"][0]["codec"] in DIRECT_A))
    return "direct" if (ok or not can_convert) else "transcode"


def external_subs(path):
    folder = os.path.dirname(path)
    stem = os.path.splitext(os.path.basename(path))[0].lower()
    found = []
    for d in (folder, os.path.join(folder, "Subs"), os.path.join(folder, "Subtitles")):
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        for n in names:
            low, ext = n.lower(), os.path.splitext(n.lower())[1]
            if ext in (".srt", ".vtt") and low.startswith(stem):
                label = n[len(stem):-len(ext)].strip(" ._-") or "Subtitles"
                found.append(dict(file=os.path.join(d, n), label=label))
    return found


def to_vtt(raw):
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16", "replace")
    else:
        for enc in ("utf-8-sig", "cp1252"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = raw.decode("latin-1")
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if text.lstrip().startswith("WEBVTT"):
        return text
    text = re.sub(r"(\d{1,2}:\d\d:\d\d),(\d{1,3})", r"\1.\2", text)
    return "WEBVTT\n\n" + text


def sub_label(s, n):
    name = " - ".join(x for x in (s.get("lang", ""), s.get("title", "")) if x)
    return name or f"Track {n + 1}"


def transcode_cmd(path, start, audio):
    """The ffmpeg command that turns a video into a fragmented MP4 on stdout (the PC player and the phone use it), or None without ffmpeg."""
    ff = ffbin("ffmpeg")
    if not ff:
        return None
    pr = probe(path) or {}
    copy_video = pr.get("vcodec") == "h264" and pr.get("pix_fmt") in ("yuv420p", "yuvj420p")
    cmd = [ff, "-v", "error", "-ss", f"{start:.3f}", "-i", path, "-map", "0:v:0", "-map", f"0:a:{audio}?", "-sn"]
    if copy_video:
        cmd += ["-c:v", "copy"]
    else:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
                "-vf", "scale=w='min(1920,iw)':h=-2"]
    cmd += ["-c:a", "aac", "-ac", "2", "-b:a", "192k", "-max_muxing_queue_size", "1024",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"]
    return cmd


def video_info(path):
    """What the player needs to know about one video: length, play as it is or convert, audio tracks, subtitles."""
    pr = probe(path)
    subs = [dict(id=f"x{i}", label=s["label"]) for i, s in enumerate(external_subs(path))]
    if pr and ffbin("ffmpeg"):
        subs += [dict(id=f"e{i}", label=sub_label(s, i)) for i, s in enumerate(pr["subs"]) if s["codec"] in TEXT_SUBS]
    return dict(duration=(pr or {}).get("duration", 0), mode=recommend_mode(path, pr), ffmpeg=bool(ffbin("ffmpeg")), probed=pr is not None,
                vcodec=(pr or {}).get("vcodec", ""), acodec=((pr or {}).get("audio") or [{}])[0].get("codec", ""),
                audio=[sub_label(a, i) + (f" ({a['codec']})" if a["codec"] else "") for i, a in enumerate((pr or {}).get("audio", []))], subs=subs)


def video_sub(path, sid):
    """One subtitle track as WebVTT: x<n> = a .srt/.vtt file next to the video, e<n> = a text track inside it (needs ffmpeg)."""
    if sid[:1] == "x":
        with open(external_subs(path)[int(sid[1:])]["file"], "rb") as fh:
            return to_vtt(fh.read())
    if sid[:1] == "e" and ffbin("ffmpeg"):
        r = subprocess.run([ffbin("ffmpeg"), "-v", "error", "-i", path, "-map", f"0:s:{int(sid[1:])}", "-f", "webvtt", "pipe:1"],
                           capture_output=True, timeout=300)
        vtt = r.stdout.decode("utf-8", "replace")
        if vtt.strip():
            return vtt
        raise ValueError("Could not read that subtitle track")
    raise KeyError("No such subtitle")


# --------------------------------------------------------------------------- #
# Book reader (EPUB): every chapter is served from inside the .epub file
# --------------------------------------------------------------------------- #
try:
    from PIL import Image as PILImage
    from PIL import ImageOps as PILImageOps
except ImportError:
    PILImage = PILImageOps = None
try:
    import numpy as np
except ImportError:
    np = None
try:
    import mutagen as MUTAGEN
except ImportError:
    MUTAGEN = None

BOOK_EXT = {".epub"}
_books = {}       # url id -> file path   (only files that were opened through /api/book/open)
_epub_cache = {}  # path -> (signature, info)


def _ln(tag):
    return tag.rsplit("}", 1)[-1]


def epub_info(path):
    st = os.stat(path)
    sig = (st.st_mtime, st.st_size)
    with _rlock:
        hit = _epub_cache.get(path)
        if hit and hit[0] == sig:
            return hit[1]
    with zipfile.ZipFile(path) as z:
        cont = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = next(e.get("full-path") for e in cont.iter() if _ln(e.tag) == "rootfile")
        opf = ET.fromstring(z.read(opf_path))
        base = posixpath.dirname(opf_path)

        def res(href, rel=base):
            return posixpath.normpath(posixpath.join(rel, unquote((href or "").split("#")[0])))

        manifest = {}
        for e in opf.iter():
            if _ln(e.tag) == "item" and e.get("id") and e.get("href"):
                manifest[e.get("id")] = dict(href=res(e.get("href")), type=e.get("media-type", ""),
                                             props=e.get("properties", ""))
        spine = []
        for e in opf.iter():
            if _ln(e.tag) == "itemref" and e.get("idref") in manifest:
                m = manifest[e.get("idref")]
                if "html" in m["type"] or m["href"].lower().endswith((".xhtml", ".html", ".htm")):
                    spine.append(m)
        if not spine:
            raise ValueError("This EPUB has no readable chapters")
        sizes = []
        for m in spine:
            try:
                sizes.append(max(1, z.getinfo(m["href"]).file_size))
            except KeyError:
                sizes.append(1)
        idx_of = {m["href"]: i for i, m in enumerate(spine)}

        def first_text(name):
            for e in opf.iter():
                if _ln(e.tag) == name and (e.text or "").strip():
                    return e.text.strip()
            return ""

        # cover image
        cover = next((m["href"] for m in manifest.values() if "cover-image" in m["props"].split()), None)
        if not cover:
            for e in opf.iter():
                if _ln(e.tag) == "meta" and e.get("name") == "cover" and e.get("content") in manifest:
                    cover = manifest[e.get("content")]["href"]
        if not cover:
            cover = next((m["href"] for k, m in manifest.items() if m["type"].startswith("image/")
                          and "cover" in (k + m["href"]).lower()), None)

        # table of contents: EPUB3 nav, else EPUB2 NCX
        toc = []

        def add(title, href, level, rel):
            target = res(href, rel)
            if target in idx_of and title.strip():
                toc.append(dict(title=" ".join(title.split()), idx=idx_of[target], frag=(href.split("#", 1) + [""])[1],
                                level=min(level, 4)))

        nav = next((m for m in manifest.values() if "nav" in m["props"].split()), None)
        if nav:
            try:
                root = ET.fromstring(z.read(nav["href"]))
                navdir = posixpath.dirname(nav["href"])
                for n in root.iter():
                    if _ln(n.tag) == "nav" and any(_ln(k) == "type" and "toc" in v.split() for k, v in n.attrib.items()):
                        def walk(ol, level):
                            for li in ol:
                                if _ln(li.tag) != "li":
                                    continue
                                a = next((c for c in li if _ln(c.tag) in ("a", "span")), None)
                                if a is not None and a.get("href"):
                                    add("".join(a.itertext()), a.get("href"), level, navdir)
                                for sub in li:
                                    if _ln(sub.tag) == "ol":
                                        walk(sub, level + 1)
                        top = next((c for c in n if _ln(c.tag) == "ol"), None)
                        if top is not None:
                            walk(top, 0)
                        break
            except (ET.ParseError, KeyError):
                toc = []
        if not toc:
            ncx = next((m for m in manifest.values() if m["type"] == "application/x-dtbncx+xml"), None)
            if ncx:
                try:
                    root = ET.fromstring(z.read(ncx["href"]))
                    ncxdir = posixpath.dirname(ncx["href"])
                    navmap = next(e for e in root.iter() if _ln(e.tag) == "navMap")

                    def walk2(parent, level):
                        for np_ in parent:
                            if _ln(np_.tag) != "navPoint":
                                continue
                            label = next((t for t in np_.iter() if _ln(t.tag) == "text"), None)
                            content = next((c for c in np_ if _ln(c.tag) == "content"), None)
                            if label is not None and content is not None:
                                add(label.text or "", content.get("src", ""), level, ncxdir)
                            walk2(np_, level + 1)
                    walk2(navmap, 0)
                except (ET.ParseError, KeyError, StopIteration):
                    toc = []
        if not toc:
            toc = [dict(title=f"Part {i + 1}", idx=i, frag="", level=0) for i in range(len(spine))]
        def all_text(name):
            return [e.text.strip() for e in opf.iter() if _ln(e.tag) == name and (e.text or "").strip()]

        info = dict(title=first_text("title"), author=first_text("creator"), authors=all_text("creator"),
                    description=re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", first_text("description"))).strip(),
                    subjects=all_text("subject"), publisher=first_text("publisher"), language=first_text("language"),
                    published=first_text("date")[:10], spine=[m["href"] for m in spine],
                    sizes=sizes, toc=toc, cover=cover, types={m["href"]: m["type"] for m in manifest.values()},
                    spine_set=set(idx_of))
    with _rlock:
        _epub_cache[path] = (sig, info)
        while len(_epub_cache) > 8:
            _epub_cache.pop(next(iter(_epub_cache)))
    return info


def epub_cover_bytes(path):
    info = epub_info(path)
    if not info["cover"]:
        return None
    with zipfile.ZipFile(path) as z:
        return z.read(info["cover"])


READER_CSS = """
:root{--bg:#16181d;--fg:#d6dae2;--link:#7fb0ff;--fs:19px;--lh:1.6;--w:44em;--ff:Georgia,'Times New Roman',serif}
html[data-theme=light]{--bg:#ffffff;--fg:#1c1c1c;--link:#2457c5}
html[data-theme=sepia]{--bg:#f3ead6;--fg:#3a3024;--link:#8a4b08}
html[data-theme=black]{--bg:#000000;--fg:#c4c9d2;--link:#6ea8ff}
html[data-font=sans]{--ff:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}
html{background:var(--bg)!important;scroll-behavior:auto!important}
body{background:transparent!important;color:var(--fg)!important;font-family:var(--ff)!important;font-size:var(--fs)!important;
  line-height:var(--lh)!important;max-width:var(--w);margin:0 auto!important;padding:2.2em 1.4em 6em!important;box-sizing:border-box!important;
  float:none!important;width:auto!important}
body *{color:inherit!important;background-color:transparent!important;font-family:inherit!important}
body pre,body code,body kbd,body samp,body tt{font-family:Consolas,'Courier New',monospace!important}
body a,body a *{color:var(--link)!important}
body img,body svg,body video{max-width:100%!important;height:auto!important;max-height:92vh;object-fit:contain}
body p{orphans:2;widows:2}
::selection{background:#4c8dff66}
"""

READER_JS = r"""
(function(){
  var root = document.documentElement, pending = null, touched = false;
  function post(m){ try{ parent.postMessage(m, '*') }catch(e){} }
  function ratio(){ var max = Math.max(1, root.scrollHeight - innerHeight); return Math.max(0, Math.min(1, scrollY / max)) }
  function report(){ post({v:'loc', path: location.pathname, ratio: ratio()}) }
  function applyCfg(c){
    root.setAttribute('data-theme', c.theme); root.setAttribute('data-font', c.font);
    root.style.setProperty('--fs', c.size + 'px'); root.style.setProperty('--lh', String(c.lh)); root.style.setProperty('--w', c.width + 'em');
  }
  function runGoto(){
    if(!pending) return; var m = pending;
    function go(){
      var max = Math.max(0, root.scrollHeight - innerHeight);
      if(m.frag){ var el = document.getElementById(m.frag) || document.getElementsByName(m.frag)[0]; if(el){ el.scrollIntoView(); return } }
      scrollTo(0, (m.ratio || 0) * max);
    }
    go(); var n = 0;
    (function again(){ if(touched || n++ > 10) return; setTimeout(function(){ if(touched) return; go(); again() }, 150) })();
    pending = null;
  }
  function page(dir){
    var max = root.scrollHeight - innerHeight;
    if(dir > 0){ if(scrollY >= max - 2) post({v:'edge', dir:1}); else scrollBy(0, innerHeight * 0.9) }
    else { if(scrollY <= 2) post({v:'edge', dir:-1}); else scrollBy(0, -innerHeight * 0.9) }
  }
  addEventListener('message', function(e){
    var m = e.data || {};
    if(m.v === 'cfg') applyCfg(m.cfg);
    else if(m.v === 'goto'){ pending = m; if(document.readyState === 'complete') runGoto() }
    else if(m.v === 'page') page(m.dir);
  });
  addEventListener('load', function(){ runGoto(); report() });
  var t; addEventListener('scroll', function(){ clearTimeout(t); t = setTimeout(report, 200) });
  var edgeAcc = 0, edgeT = 0;
  addEventListener('wheel', function(e){
    if(e.ctrlKey) return;
    var max = root.scrollHeight - innerHeight, down = e.deltaY > 0;
    if((down && scrollY >= max - 2) || (!down && scrollY <= 2)){          // already at the end / the start of the chapter
      var now = Date.now(); if(now - edgeT > 900) edgeAcc = 0; edgeT = now; edgeAcc += Math.abs(e.deltaY);
      if(edgeAcc > 160){ edgeAcc = 0; post({v:'edge', dir: down ? 1 : -1}) }
    } else edgeAcc = 0;
  }, {passive:true});
  ['wheel','touchstart','mousedown'].forEach(function(n){ addEventListener(n, function(){ touched = true }, {passive:true}) });
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(a){ var h = a.getAttribute('href') || ''; if(/^(https?:|mailto:)/i.test(h)){ e.preventDefault(); post({v:'ext', url:a.href}) } return }
    if(String(getSelection()).length) return;
    var x = e.clientX / innerWidth;
    if(x < 0.25) page(-1); else if(x > 0.75) page(1); else post({v:'bars'});
  });
  document.addEventListener('keydown', function(e){
    var k = e.key; touched = true;
    if(k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)){ e.preventDefault(); page(1) }
    else if(k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)){ e.preventDefault(); page(-1) }
    else if(k === 'Escape' || k === 't' || k === 'T' || k === 'a' || k === 'A') post({v:'key', key:k});
  });
  post({v:'ready', path: location.pathname});
})();
"""


def make_thumb(data, max_w=360, max_h=520):
    """Shrink a cover with Pillow when it is installed; otherwise keep small images only."""
    if PILImage is None:
        return data if len(data) <= 450 * 1024 else None
    try:
        im = PILImage.open(io.BytesIO(data))
        im.thumbnail((max_w, max_h))
        buf = io.BytesIO()
        im.convert("RGB").save(buf, "JPEG", quality=84)
        return buf.getvalue()
    except Exception:
        return data if len(data) <= 450 * 1024 else None


def sniff_image(data):
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    head = data[:600].lstrip()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head):
        return ".svg"
    return None


def store_cover(conn, gid, data, auto=None):
    """Save a cover image for a title. auto=None means 'chosen by the user' (never overwritten)."""
    ext = sniff_image(data)
    if not ext:
        raise ValueError("That is not a usable image")
    COVER_DIR.mkdir(exist_ok=True)
    name = hashlib.sha1(gid.encode()).hexdigest() + ext
    old = conn.execute("SELECT file FROM covers WHERE key=?", (gid,)).fetchone()
    if old and old["file"] != name:
        (COVER_DIR / old["file"]).unlink(missing_ok=True)
    (COVER_DIR / name).write_bytes(data)
    conn.execute("INSERT OR REPLACE INTO covers VALUES (?,?)", (gid, name))
    if auto:
        conn.execute("INSERT OR REPLACE INTO auto_covers VALUES (?,?)", (gid, auto))
    else:
        conn.execute("DELETE FROM auto_covers WHERE key=?", (gid,))
    conn.commit()


def local_cover_data(g, path=None, page=0):
    """Picture for a title taken from its own files (first page of a comic / PDF, EPUB cover, 3D render, album art). None if nothing works."""
    items = sorted(g["items"], key=lambda r: (r["number"] if r["number"] is not None else -1, r["path"]))
    for it in items:
        if path and it["path"] != path:
            continue
        ext = os.path.splitext(it["path"])[1].lower()
        if not os.path.exists(it["path"]):
            continue
        data = None
        try:
            if ext == ".pdf" and g["cat"] in ("comic", "book") and pdf_backend():
                data = pdf_png(it["path"], page, 600)
            elif g["cat"] == "comic" and ext in READABLE_EXT:
                data = comic_page_bytes(it["path"], page)[0]
            elif g["cat"] == "book" and ext in BOOK_EXT:
                data = epub_cover_bytes(it["path"])
            elif g["cat"] == "model" and ext in MODEL_EXT:
                data = render_model_png(load_mesh(it["path"]))
            elif g["cat"] == "music" and ext in AUDIO_EXT:
                data = folder_cover(os.path.dirname(it["path"])) or embedded_cover(it["path"])
            data = make_thumb(data) if data else None
        except Exception:
            data = None
        if data:
            return data
    return None


def local_covers(conn, say, progress, groups):
    """Give every comic / book / RPG / model / album that has no cover one made from its own files. Never replaces an existing cover."""
    covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
    todo = [g for g in groups if g["cat"] in ("comic", "book", "model", "music") and gid_of(g) not in covers]
    made = 0
    for i, g in enumerate(todo, 1):
        if STOP.is_set():
            break
        progress(f"Covers from your files {i}/{len(todo)}: {g['name']}")
        data = local_cover_data(g)
        if data:
            try:
                store_cover(conn, gid_of(g), data, "local")
                made += 1
            except Exception:
                pass
    return made


def fetch_covers(conn, say, progress, only=None, coll=None):
    """Online posters for matched titles, then covers taken from your own comic / book files.
    only = (cat, gkey) of one title, coll = one collection id; both None = everything."""
    if online.get_setting(conn, "auto_covers", "1") != "1":
        say("Covers: automatic covers are switched off in Settings.")
        return
    if not (hasattr(online, "tmdb_poster_url") and hasattr(online, "cv_cover_url") and hasattr(online, "download_image")):
        say("Covers: your media_online.py is an older version. Replace it with the newest media_online.py "
            "(same folder as vault.py), restart Nightvault, then press Get covers.")
        return
    bump()
    def wanted(g):
        return ((only is None or (g["cat"], g["gkey"]) == tuple(only))
                and (coll is None or coll_of(g) == coll))

    groups = [g for g in get_groups(conn, False) if wanted(g)]
    stats = dict(added=0, failed=0, local=0)
    covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
    auto = {r["key"]: r["ext"] for r in conn.execute("SELECT key, ext FROM auto_covers")}
    client = online.Client(conn, STOP)
    blocked = set()
    todo = [g for g in groups if g["cat"] in ("series", "movie", "comic", "collection")]
    for i, g in enumerate(todo, 1):
        if STOP.is_set():
            return
        gid = gid_of(g)
        if gid in covers and gid not in auto:
            continue  # a cover you chose yourself is never replaced
        cat = g["cat"]
        if cat == "collection":
            kind, ext_id, src, tag = "collection", g["gkey"].split(":", 1)[1], "tmdb", None
        else:
            m = online.get_match(conn, cat, g["gkey"])
            if not m or m["source"] == "none" or not m["ext_id"]:
                continue
            kind, ext_id, src = {"series": "tv", "movie": "movie", "comic": "volume"}[cat], m["ext_id"], m["source"]
        tag = f"{src}:{kind}:{ext_id}"
        if auto.get(gid) == tag and gid in covers:
            continue
        if src in blocked:
            continue
        progress(f"Covers {i}/{len(todo)}: {g['name']}")
        try:
            if src == "tmdb":
                if not client.tmdb_key:
                    blocked.add(src)
                    continue
                url = online.tmdb_poster_url(client, kind, ext_id)
            else:
                if not client.cv_key:
                    blocked.add(src)
                    continue
                url = online.cv_cover_url(client, ext_id)
            if not url:
                continue
            store_cover(conn, gid, online.download_image(url), tag)
            covers.add(gid)
            auto[gid] = tag
            stats["added"] += 1
        except online.Stopped:
            return
        except online.RateLimited as e:
            blocked.add(src)
            say(str(e))
        except (online.ApiError, ValueError, OSError) as e:
            stats["failed"] += 1
            if stats["failed"] <= 3:
                say(f"Cover for {g['name']}: {e}")
    # covers from your own files for what is still without one
    stats["local"] = local_covers(conn, say, progress, groups)
    say(f"Covers: {stats['added']} downloaded, {stats['local']} taken from your own files"
        + (f", {stats['failed']} failed" if stats["failed"] else "") + ".")
    if PILImage is None and stats["local"] == 0 and any(g["cat"] == "comic" for g in groups):
        say("Tip: install Pillow (pip install pillow) to make covers from large comic pages.")


def job_covers(only=None, coll=None):
    def run(conn, say, progress):
        if not online:
            say("media_online.py is missing.")
            return
        fetch_info(conn, say, progress, only, coll)
        if not STOP.is_set():
            fetch_covers(conn, say, progress, only, coll)
    return run


# --------------------------------------------------------------------------- #
# Details (description, genres, cast ...): from TMDB / Comic Vine, or from inside your own files
# --------------------------------------------------------------------------- #
def store_meta(conn, gid, tag, info):
    conn.execute("INSERT OR REPLACE INTO meta VALUES (?,?,?,?,?)",
                 (gid, tag, json.dumps(info.get("genres", [])), json.dumps(info), time.time()))
    conn.commit()


def online_ref(conn, g):
    """(source, kind, id) of the TMDB / Comic Vine entry a title was matched to, or None."""
    if g["cat"] == "collection":
        return "tmdb", "collection", g["gkey"].split(":", 1)[1]
    if g["cat"] not in ("series", "movie", "comic"):
        return None
    m = online.get_match(conn, g["cat"], g["gkey"])
    if not m or m["source"] == "none" or not m["ext_id"]:
        return None
    return m["source"], {"series": "tv", "movie": "movie", "comic": "volume"}[g["cat"]], m["ext_id"]


def comicinfo(path):
    """Details stored inside a CBZ (ComicInfo.xml) - or None."""
    if os.path.splitext(path)[1].lower() not in (".cbz", ".zip") or sniff_archive(path) != "zip":
        return None
    with zipfile.ZipFile(path) as z:
        name = next((n for n in z.namelist() if n.lower().endswith("comicinfo.xml")), None)
        if not name:
            return None
        root = ET.fromstring(z.read(name))

    def get(tag):
        return next(((e.text or "").strip() for e in root if _ln(e.tag).lower() == tag.lower()), "")

    info = {"source": "file", "poster": "", "url": "", "overview": get("Summary"), "tagline": "", "facts": [], "credits": [],
            "genres": [x.strip() for x in re.split(r"[,;]", get("Genre")) if x.strip()]}
    for label, tag in (("Publisher", "Publisher"), ("Year", "Year"), ("Language", "LanguageISO")):
        if get(tag):
            info["facts"].append([label, get(tag)])
    for label, tag in (("Writer", "Writer"), ("Artist", "Penciller"), ("Colors", "Colorist")):
        if get(tag):
            info["credits"].append([label, get(tag)])
    return info if (info["overview"] or info["genres"] or info["facts"] or info["credits"]) else None


def local_meta_for(g):
    if g["cat"] == "music":
        return music_meta_for(g)
    """Details read from the first usable file of a comic series or book."""
    items = sorted(g["items"], key=lambda r: (r["number"] if r["number"] is not None else -1, r["path"]))
    for it in items:
        path, ext = it["path"], os.path.splitext(it["path"])[1].lower()
        if not os.path.exists(path):
            continue
        if g["cat"] == "comic":
            info = comicinfo(path)
            if info:
                return info
        elif g["cat"] == "model" and ext in MODEL_EXT:
            return model_info(path)
        elif g["cat"] == "book" and ext in BOOK_EXT:
            e = epub_info(path)
            info = {"source": "file", "poster": "", "url": "", "overview": e["description"][:1200], "tagline": "",
                    "genres": e["subjects"][:8], "facts": [], "credits": []}
            for label, val in (("Publisher", e["publisher"]), ("Language", e["language"]), ("Published", e["published"])):
                if val:
                    info["facts"].append([label, val])
            if e["authors"]:
                info["credits"].append(["Author", ", ".join(e["authors"][:4])])
            if info["overview"] or info["genres"] or info["facts"] or info["credits"]:
                return info
    return None


def fetch_info(conn, say, progress, only=None, coll=None):
    """Fill in description, genres, cast ... for matched titles (online) and for books / comics (from the files)."""
    bump()

    def wanted(g):
        return ((only is None or (g["cat"], g["gkey"]) == tuple(only))
                and (coll is None or coll_of(g) == coll))

    groups = [g for g in get_groups(conn, False) if wanted(g)]
    have = {r["gid"]: (r["tag"], r["fetched"]) for r in conn.execute("SELECT gid, tag, fetched FROM meta")}
    can_online = bool(online and hasattr(online, "tmdb_details") and hasattr(online, "cv_volume_info"))
    client = online.Client(conn, STOP) if can_online else None
    if online and not can_online:
        say("Details: your media_online.py is an older version - replace it with the newest one.")
    stats, blocked = dict(online=0, local=0, failed=0), set()
    for i, g in enumerate(groups, 1):
        if STOP.is_set():
            return
        gid, ref = gid_of(g), (online_ref(conn, g) if can_online else None)
        tag = ":".join(ref) if ref else None
        old = have.get(gid)
        if tag and old and old[0] == tag and time.time() - old[1] < 40 * 86400:
            continue
        if not tag and old:
            continue
        progress(f"Details {i}/{len(groups)}: {g['name']}")
        info = None
        if tag and ref[0] not in blocked:
            try:
                if ref[0] == "tmdb":
                    if client.tmdb_key:
                        info = online.tmdb_details(client, ref[1], ref[2])
                    else:
                        blocked.add("tmdb")
                elif client.cv_key:
                    info = online.cv_volume_info(client, ref[2])
                else:
                    blocked.add("comicvine")
            except online.Stopped:
                return
            except online.RateLimited as e:
                blocked.add(ref[0])
                say(str(e))
            except (online.ApiError, ValueError, OSError) as e:
                stats["failed"] += 1
                if stats["failed"] <= 3:
                    say(f"Details for {g['name']}: {e}")
        if info:
            store_meta(conn, gid, tag, info)
            have[gid] = (tag, time.time())
            stats["online"] += 1
        elif not old and g["cat"] in ("comic", "book", "model", "music"):
            try:
                info = local_meta_for(g)
            except Exception:
                info = None
            if info:
                store_meta(conn, gid, "local", info)
                have[gid] = ("local", time.time())
                stats["local"] += 1
    say(f"Details: {stats['online']} fetched online, {stats['local']} read from your files"
        + (f", {stats['failed']} failed" if stats["failed"] else "") + ".")


# --------------------------------------------------------------------------- #
# Card scanner (Magic): recognise a card by the picture in its art window, using the card images
# you downloaded with the Magic downloader.  Prices come from the Scryfall data file (Cardmarket, EUR).
# --------------------------------------------------------------------------- #
ART_BOX = (0.09, 0.12, 0.91, 0.54)          # where the artwork sits on a card (fractions of width / height)
CARD_IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
_card_idx = {"stamp": None, "ids": [], "sets": [], "mat": None}
_card_lock = threading.Lock()
VEC_LEN = 12 * 16 + 6 * 8 * 3


def norm_num(n):
    m = re.match(r"0*(\d+)(.*)", str(n))
    return (str(int(m.group(1))) + m.group(2)) if m else str(n)


def card_id(set_code, number):
    return f"{str(set_code).lower()}:{norm_num(number)}"


def _vec_art(art):
    """Describe a picture of the artwork: brightness structure + coarse colour layout (both exposure / colour-cast tolerant)."""
    g = PILImageOps.autocontrast(art.convert("L"), cutoff=2).resize((12, 16), PILImage.BOX)
    lum = np.asarray(g, dtype=np.float32).ravel()
    lum -= lum.mean()
    lum /= (np.linalg.norm(lum) + 1e-6)
    c = np.asarray(art.convert("RGB").resize((6, 8), PILImage.BOX), dtype=np.float32)
    c = (c / (c.mean(axis=(0, 1), keepdims=True) + 1e-3)).ravel()
    c -= c.mean()
    c /= (np.linalg.norm(c) + 1e-6)
    return np.concatenate([lum, 0.7 * c])


def _crop_art(im, scale=1.0, dx=0.0, dy=0.0):
    w, h = im.size
    x0, y0, x1, y1 = ART_BOX
    cx, cy = (x0 + x1) / 2 + dx, (y0 + y1) / 2 + dy
    hw, hh = (x1 - x0) / 2 * scale, (y1 - y0) / 2 * scale
    return im.crop((max(0, int((cx - hw) * w)), max(0, int((cy - hh) * h)), min(w, int((cx + hw) * w)), min(h, int((cy + hh) * h))))


def card_vec(im):
    return _vec_art(_crop_art(im))


def query_vecs(im):
    """A camera picture is never placed perfectly: describe it with small shifts / zooms and keep the best fit."""
    return np.stack([_vec_art(_crop_art(im, sc, dx, dy)) for sc in (0.94, 1.0, 1.06) for dy in (-0.025, 0.0, 0.025) for dx in (-0.025, 0.0, 0.025)])


def iter_json_objects(path):
    """Cards one by one from the Scryfall data file (plain or gzip; one big list or one card per line)."""
    with open(path, "rb") as f:
        gz = f.read(2) == b"\x1f\x8b"
    dec, buf = json.JSONDecoder(), ""
    with (gzip.open(path, "rt", encoding="utf-8") if gz else open(path, "r", encoding="utf-8")) as f:
        while True:
            chunk = f.read(1 << 20)
            buf += chunk
            i = 0
            while True:
                while i < len(buf) and buf[i] in " \r\n\t,[":
                    i += 1
                if i >= len(buf) or buf[i] == "]":
                    break
                try:
                    obj, j = dec.raw_decode(buf, i)
                except json.JSONDecodeError:
                    break
                yield obj
                i = j
            buf = buf[i:]
            if not chunk:
                return


def find_bulk(conn, folder):
    explicit = get_setting(conn, "cards_bulk")
    if explicit and os.path.exists(explicit):
        return explicit
    d = Path(folder)
    for base in (d, d.parent, d.parent.parent):
        cand = base / "_scryfall_data" / "default_cards.json"
        if cand.exists():
            return str(cand)
    return None


def import_bulk(conn, bulk, say, progress):
    seen, rows, n = set(), [], 0

    def num(x):
        try:
            return float(x) if x is not None else None
        except (TypeError, ValueError):
            return None

    def flush():
        conn.executemany("INSERT OR REPLACE INTO card_meta (id, sid, set_code, number, name, set_name, rarity, type_line, released, eur, eur_foil, usd, usd_foil, lang, cmc, colors) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        conn.commit()
        rows.clear()

    for c in iter_json_objects(bulk):
        if STOP.is_set():
            return False
        if c.get("object") != "card" or not c.get("set") or not c.get("collector_number"):
            continue
        cid, lang = card_id(c["set"], c["collector_number"]), c.get("lang", "en")
        if cid in seen and lang != "en":
            continue
        seen.add(cid)
        pr = c.get("prices") or {}
        rows.append((cid, c.get("id"), c["set"].lower(), norm_num(c["collector_number"]), c.get("name"), c.get("set_name"),
                     c.get("rarity"), c.get("type_line") or "", c.get("released_at"), num(pr.get("eur")),
                     num(pr.get("eur_foil")), num(pr.get("usd")), num(pr.get("usd_foil")), lang, num(c.get("cmc")),
                     "".join(c.get("colors") or ((c.get("card_faces") or [{}])[0].get("colors") or []))))
        n += 1
        if len(rows) >= 3000:
            flush()
            progress(f"Reading the Scryfall data ... {n:,} cards")
    flush()
    say(f"Card data: {n:,} cards with set names and Cardmarket prices.")
    return True


def parse_card_file(path):
    stem = Path(path).stem
    if stem.lower().endswith("_back"):
        return None
    m = re.match(r"^([^_]+)_(.+)$", stem)
    if not m:
        return None
    num, rest = m.group(1), re.sub(r"_(front)$", "", m.group(2), flags=re.I)
    rest = re.sub(r"_([a-z]{2,3})$", "", rest)
    parent = Path(path).parent.name
    if parent.lower() == "alternate art":                 # <set>/Alternate art/<card>.png (OPPP alternate arts): the set is the folder above
        parent = Path(path).parent.parent.name
    set_code = (parent.split(" - ")[0] if " - " in parent else parent).strip().lower()
    return card_id(set_code, num), set_code, norm_num(num), rest.strip()


def _vec_file(path):
    im = PILImage.open(path)
    try:
        im.draft("RGB", (336, 468))
    except Exception:
        pass
    return card_vec(im.convert("RGB")).astype(np.float16).tobytes()


def job_cards_index(conn, say, progress):
    if PILImage is None or np is None:
        say("The card scanner needs Pillow and numpy:  python -m pip install pillow numpy   (then restart Nightvault)")
        return
    folder = get_setting(conn, "cards_folder")
    if not folder or not os.path.isdir(folder):
        say("Choose the folder with your Magic card images first.")
        return
    bulk = find_bulk(conn, folder)
    if bulk:
        st = os.stat(bulk)
        sig = f"{bulk}|{st.st_size}|{int(st.st_mtime)}|v2"
        if get_setting(conn, "cards_bulk_sig") != sig:
            progress("Reading the Scryfall data ...")
            if import_bulk(conn, bulk, say, progress):
                put_setting(conn, "cards_bulk_sig", sig)
        else:
            say("Card data: already up to date.")
    else:
        say("No Scryfall data file found next to your images - names will come from the file names and prices will be missing.")

    known = {r["id"]: (r["mtime"], r["size"], r["path"]) for r in conn.execute("SELECT id, mtime, size, path FROM card_index")}
    todo = []
    for dirpath, _dirs, files in os.walk(folder):
        if os.path.basename(dirpath).startswith("_"):
            continue
        for fn in files:
            if os.path.splitext(fn)[1].lower() not in CARD_IMG_EXT:
                continue
            path = os.path.join(dirpath, fn)
            info = parse_card_file(path)
            if not info:
                continue
            st = os.stat(path)
            k = known.get(info[0])
            if k and k[0] == st.st_mtime and k[1] == st.st_size and k[2] == path:
                continue
            todo.append((path, st, info))
    say(f"Card images: {len(todo):,} new or changed.")
    from concurrent.futures import ThreadPoolExecutor
    done = 0
    with ThreadPoolExecutor(max_workers=max(2, min(6, (os.cpu_count() or 4)))) as pool:
        batch = []
        futures = [(pool.submit(_vec_file, t[0]), t) for t in todo]
        for fut, (path, st, info) in futures:
            if STOP.is_set():
                break
            try:
                vec = fut.result()
            except Exception:
                continue
            cid, sc, num, name = info
            batch.append((cid, path, st.st_mtime, st.st_size, sc, num, name, vec))
            done += 1
            if len(batch) >= 300:
                conn.executemany("INSERT OR REPLACE INTO card_index VALUES (?,?,?,?,?,?,?,?)", batch)
                conn.commit()
                batch.clear()
                progress(f"Indexing card images {done:,}/{len(todo):,}")
        if batch:
            conn.executemany("INSERT OR REPLACE INTO card_index VALUES (?,?,?,?,?,?,?,?)", batch)
            conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM card_index").fetchone()[0]
    say(f"Card scanner ready: {total:,} cards can be recognised.")


def load_card_index(conn):
    n = conn.execute("SELECT COUNT(*), COALESCE(MAX(rowid), 0) FROM card_index").fetchone()
    stamp = (n[0], n[1])
    with _card_lock:
        if _card_idx["stamp"] == stamp:
            return _card_idx
        rows = conn.execute("SELECT id, set_code, vec FROM card_index").fetchall()
        mat = (np.frombuffer(b"".join(r["vec"] for r in rows), dtype=np.float16).reshape(len(rows), VEC_LEN).astype(np.float32)
               if rows else np.zeros((0, VEC_LEN), dtype=np.float32))
        _card_idx.update(stamp=stamp, ids=[r["id"] for r in rows], sets=np.array([r["set_code"] for r in rows]), mat=mat)
        return _card_idx


def identify_card(conn, data, sets=None, prefer=()):
    if PILImage is None or np is None:
        raise ValueError("The card scanner needs Pillow and numpy:  python -m pip install pillow numpy")
    idx = load_card_index(conn)
    if not idx["ids"]:
        raise ValueError("No card images are indexed yet - open the setup box and press 'Index card images'.")
    im = PILImage.open(io.BytesIO(data))
    im.load()
    im = im.convert("RGB")
    im.thumbnail((700, 980))
    if im.size[0] < 80 or im.size[1] < 110:
        raise ValueError("That picture is too small")
    q = query_vecs(im)
    sim = (q @ idx["mat"].T).max(axis=0)                      # best fit over the shifted / zoomed readings
    dist = np.sqrt(np.maximum(0.0, 2 * (1 + 0.49) - 2 * sim))  # 0 = identical
    if sets:
        dist = np.where(np.isin(idx["sets"], list(sets)), dist, 9.0)
    k = min(40, len(dist))
    top = np.argpartition(dist, k - 1)[:k]
    top = top[np.argsort(dist[top])]
    lead = float(dist[top[0]])
    pref = {s: n for n, s in enumerate(prefer)}
    # printings that share one artwork look the same - put the sets the user has been working with first
    group = sorted([i for i in top if dist[i] <= lead + 0.05], key=lambda i: (pref.get(str(idx["sets"][i]), 99), dist[i]))
    rest = [i for i in top if dist[i] > lead + 0.05]
    ordered = (group + rest)[:8]
    ids = [idx["ids"][i] for i in ordered]
    marks = ",".join("?" * len(ids))
    metas = {r["id"]: r for r in conn.execute(f"SELECT * FROM card_meta WHERE id IN ({marks})", ids)}
    names = {r["id"]: r["name"] for r in conn.execute(f"SELECT id, name FROM card_index WHERE id IN ({marks})", ids)}
    out = []
    for i, cid in zip(ordered, ids):
        m = metas.get(cid)
        out.append(dict(id=cid, set=str(idx["sets"][i]), number=cid.split(":", 1)[1], name=(m["name"] if m else names.get(cid, cid)),
                        set_name=(m["set_name"] if m else ""), rarity=(m["rarity"] if m else ""),
                        eur=(m["eur"] if m else None), eur_foil=(m["eur_foil"] if m else None), score=round(float(dist[i]), 3)))
    conf = "high" if lead <= HIGH_DIST else ("medium" if lead <= MEDIUM_DIST else "low")
    ambiguous = len({o["set"] for o in out if o["score"] <= lead + 0.05}) > 1
    return dict(matches=out, confidence=conf, ambiguous=ambiguous, best=round(lead, 3))


HIGH_DIST, MEDIUM_DIST = 0.65, 1.0


# --------------------------------------------------------------------------- #
# Import from Nightvault Pocket (the phone scanner).  The phone saves a JSON file; every entry has its own id (uid),
# so importing a newer export of the same phone only adds what is new since the last import.
# --------------------------------------------------------------------------- #
PHONE_FORMAT = "nightvault-phone-cards"


def _set_key(s):
    return str(s or "").strip().lower().lstrip("0") or "0"


def _num_key(n):
    return norm_num(str(n or "").strip()).lower()


def _phone_index(conn, game, cache):
    """{(set, number): (set_code, number)} and {(set, name): ...} for the card images downloaded for one game."""
    if game not in cache:
        by_num, by_name = {}, {}
        for r in conn.execute("SELECT set_code, number, name FROM cg_cards WHERE game=? AND demo=0", (game,)):
            v = (r["set_code"], r["number"])
            by_num.setdefault((_set_key(r["set_code"]), _num_key(r["number"])), v)
            by_name.setdefault((_set_key(r["set_code"]), str(r["name"] or "").lower()), v)
        cache[game] = (by_num, by_name)
    return cache[game]


def import_phone_cards(conn, data):
    if not isinstance(data, dict) or data.get("format") != PHONE_FORMAT or not isinstance(data.get("cards"), list):
        raise ValueError("That file is not a Nightvault Pocket export. On the phone, open Settings and tap 'Export for Nightvault'.")
    if int(data.get("version") or 1) >= 2 and isinstance(data.get("sync_own"), dict):
        return import_phone_sync(conn, data)
    seen = jl(get_setting(conn, "phone_import"), {})
    if not isinstance(seen, dict):
        seen = {}
    cache, unmatched = {}, []
    st = dict(added=0, entries=0, already=0, skipped=0, not_downloaded=0)
    for c in data["cards"][:50000]:
        if not isinstance(c, dict):
            st["skipped"] += 1
            continue
        game = str(c.get("game") or "").strip().lower()[:40]
        set_code = str(c.get("set") or "").strip().lower()[:40]
        number = str(c.get("number") or "").strip()[:60]
        name = str(c.get("name") or "").strip()[:200]
        uid = str(c.get("uid") or "")[:80]
        try:
            qty = max(0, min(9999, int(c.get("qty") or 0)))
        except (TypeError, ValueError):
            qty = 0
        if not game or not set_code or not number or not qty:
            st["skipped"] += 1
            continue
        foil = 1 if c.get("foil") else 0
        prev = int(seen.get(uid, 0) or 0) if uid else 0
        delta = qty - prev                      # only what is new since the last import of this phone
        if delta <= 0:
            st["already"] += 1
            continue
        if game == "mtg":
            cid = card_id(set_code, number)
            row = conn.execute("SELECT qty, location FROM card_owned WHERE id=? AND foil=? AND owner=0", (cid, foil)).fetchone()
            conn.execute("INSERT OR REPLACE INTO card_owned VALUES (?,?,?,?,?,?)",
                         (cid, foil, 0, (row["qty"] if row else 0) + delta, row["location"] if row else "", time.time()))
        else:
            by_num, by_name = _phone_index(conn, game, cache)
            hit = by_num.get((_set_key(set_code), _num_key(number))) or by_name.get((_set_key(set_code), name.lower()))
            if hit:
                sc, nb = hit
            else:
                sc, nb = set_code, norm_num(number)
                if by_num:
                    unmatched.append(f"{name} ({set_code.upper()} #{number})")
                else:
                    st["not_downloaded"] += 1
            row = conn.execute("SELECT qty FROM cg_owned WHERE game=? AND set_code=? AND number=? AND foil=?", (game, sc, nb, foil)).fetchone()
            conn.execute("INSERT OR REPLACE INTO cg_owned VALUES (?,?,?,?,?)", (game, sc, nb, foil, (row["qty"] if row else 0) + delta))
        if uid:
            seen[uid] = qty
        st["added"] += delta
        st["entries"] += 1
    conn.execute("INSERT OR REPLACE INTO app_settings VALUES (?,?)", ("phone_import", json.dumps(seen)))
    st["shared"] = merge_shared(conn, data)
    if st["shared"]:
        prices_apply_all(conn)
    conn.commit()
    st["unmatched"] = unmatched[:200]
    return st


def _sync_key(game, set_code, number, foil):
    return f"{game}|{str(set_code).lower()}|{number}|{1 if foil else 0}"


def _owned_qty(conn, game, sc, nb, foil):
    if game == "mtg":
        r = conn.execute("SELECT SUM(qty) q FROM card_owned WHERE id=? AND foil=? AND owner=0", (card_id(sc, nb), foil)).fetchone()
    else:
        r = conn.execute("SELECT qty q FROM cg_owned WHERE game=? AND set_code=? AND number=? AND foil=?", (game, sc, nb, foil)).fetchone()
    return int((r["q"] if r else 0) or 0)


def import_phone_sync(conn, data):
    """Version 2 exchange: each app sends, per card, how many copies it has of its own (its count minus what came
    from the other app). Every change - more, fewer, removed - is applied exactly once, in both directions."""
    seen = jl(get_setting(conn, "sync_seen"), {})          # phone's own count per card, as last received
    contrib = jl(get_setting(conn, "sync_contrib"), {})    # copies here that came from the phone, per card (our key)
    first = not get_setting(conn, "sync_v2")
    info = {}
    for c in data.get("cards") or []:
        if isinstance(c, dict) and c.get("game") and c.get("set") and c.get("number") is not None:
            info[_sync_key(str(c["game"]).lower(), c["set"], str(c["number"]), c.get("foil"))] = c
    cache, unmatched = {}, []
    st = dict(added=0, removed=0, entries=0, already=0, skipped=0, not_downloaded=0)
    trade = jl(get_setting(conn, "card_trade"), {})
    for k, own in list(data["sync_own"].items())[:60000]:
        try:
            game, set_code, number, foil = k.split("|")[:4]       # extra parts (language, grade from the phone) count as the same card here
            own, foil = int(own), int(foil)
        except (ValueError, TypeError):
            st["skipped"] += 1
            continue
        c = info.get(k, {})
        name = str(c.get("name") or "")
        if game == "mtg":
            sc, nb = set_code, norm_num(number)
        else:
            by_num, by_name = _phone_index(conn, game, cache)
            hit = by_num.get((_set_key(set_code), _num_key(number))) or by_name.get((_set_key(set_code), name.lower()))
            if hit:
                sc, nb = hit
            else:
                sc, nb = set_code, norm_num(number)
                if by_num:
                    unmatched.append(f"{name or '?'} ({set_code.upper()} #{number})")
                elif own > 0:
                    st["not_downloaded"] += 1
        pk = _sync_key(game, sc, nb, foil)
        have = _owned_qty(conn, game, sc, nb, foil)
        if first and k not in seen:                          # first exchange of this kind: only add copies that are missing
            delta = max(0, own - have)
        else:
            delta = own - int(seen.get(k, 0) or 0)
        delta = max(delta, -have)
        if delta:
            if game == "mtg":
                owned_change(conn, card_id(sc, nb), foil, delta)
            else:
                _owned_add(conn, game, sc, nb, foil, delta)
            st["added" if delta > 0 else "removed"] += abs(delta)
            st["entries"] += 1
        else:
            st["already"] += 1
        contrib[pk] = (min(have + delta, max(own, 0)) if first and k not in seen else int(contrib.get(pk, 0) or 0) + delta)
        if not contrib[pk]:
            contrib.pop(pk, None)
        seen[k] = own
        if c.get("trade") is not None:
            trade[f"{game}|{sc}|{nb}"] = bool(c.get("trade"))
    put_setting(conn, "sync_seen", json.dumps(seen))
    put_setting(conn, "sync_contrib", json.dumps(contrib))
    put_setting(conn, "card_trade", json.dumps(trade))
    put_setting(conn, "sync_v2", "1")
    st["shared"] = merge_shared(conn, data)
    if st["shared"]:
        prices_apply_all(conn)
    conn.commit()
    st["unmatched"] = unmatched[:200]
    return st


def _owned_add(conn, game, sc, nb, foil, delta):
    row = conn.execute("SELECT qty FROM cg_owned WHERE game=? AND set_code=? AND number=? AND foil=?", (game, sc, nb, foil)).fetchone()
    q = max(0, (row["qty"] if row else 0) + delta)
    if q:
        conn.execute("INSERT OR REPLACE INTO cg_owned VALUES (?,?,?,?,?)", (game, sc, nb, foil, q))
    else:
        conn.execute("DELETE FROM cg_owned WHERE game=? AND set_code=? AND number=? AND foil=?", (game, sc, nb, foil))


# --------------------------------------------------------------------------- #
# Shared with Nightvault Pocket (the phone app): decks, wishlist, own prices and the order of price sources.
# Both apps keep the same records; on every exchange the newest change of each record wins, and removals
# travel as small "removed at" notes, so nothing comes back that was deleted on the other side.
# --------------------------------------------------------------------------- #
SHARED_KEYS = ("decks", "decks_removed", "want", "want_removed", "my_prices", "price_order")


def shared_data(conn):
    d = {k: jl(get_setting(conn, "shared_" + k), None) for k in SHARED_KEYS}
    return dict(decks=d["decks"] or [], decks_removed=d["decks_removed"] or {}, want=d["want"] or {}, want_removed=d["want_removed"] or {},
                my_prices=d["my_prices"] or {}, price_order=d["price_order"] or {})


def merge_shared(conn, data):
    """Merge what the other app sent into ours (newest change wins). Returns how many records changed."""
    mine, n = shared_data(conn), 0
    # decks: by id, newest 'at' wins; a removal wins over an older deck
    gone = dict(mine["decks_removed"])
    for k, t in (data.get("decks_removed") or {}).items():
        if isinstance(t, (int, float)) and t > gone.get(k, 0):
            gone[k] = t
    decks = {x["id"]: x for x in mine["decks"] if isinstance(x, dict) and x.get("id")}
    for x in data.get("decks") or []:
        if not isinstance(x, dict) or not x.get("id") or not isinstance(x.get("cards"), list):
            continue
        cur = decks.get(x["id"])
        if not cur or (x.get("at") or 0) > (cur.get("at") or 0):
            decks[x["id"]] = x
            n += 1
    decks = [x for x in decks.values() if (x.get("at") or 0) >= gone.get(x["id"], 0)]
    # wishlist: by card key, newest wins; removal notes
    wgone = dict(mine["want_removed"])
    for k, t in (data.get("want_removed") or {}).items():
        if isinstance(t, (int, float)) and t > wgone.get(k, 0):
            wgone[k] = t
    want = dict(mine["want"])
    for k, x in (data.get("want") or {}).items():
        if isinstance(x, dict) and (k not in want or (x.get("added") or 0) > (want[k].get("added") or 0)):
            want[k] = x
            n += 1
    want = {k: x for k, x in want.items() if (x.get("added") or 0) >= wgone.get(k, 0)}
    # own prices: by card key, newest entry wins ([normal, foil, at]; both empty = cleared)
    myp = dict(mine["my_prices"])
    for k, x in (data.get("my_prices") or {}).items():
        if isinstance(x, list) and len(x) >= 3 and (k not in myp or (x[2] or 0) > (myp[k][2] or 0)):
            myp[k] = x[:3]
            n += 1
    po = mine["price_order"]
    o = data.get("price_order") or {}
    if isinstance(o, dict) and isinstance(o.get("order"), list) and (o.get("at") or 0) > (po.get("at") or 0):
        po = dict(order=[str(v) for v in o["order"]][:10], at=o.get("at"))
        n += 1
    cut = time.time() * 1000 - 180 * 864e5                  # removal notes older than half a year are forgotten
    for k, v in dict(decks_removed={i: t for i, t in gone.items() if t > cut}, want_removed={i: t for i, t in wgone.items() if t > cut},
                     decks=decks, want=want, my_prices=myp, price_order=po).items():
        put_setting(conn, "shared_" + k, json.dumps(v))
    return n


# --------------------------------------------------------------------------- #
# Decks - the same decks as Nightvault Pocket (kept in shared_decks, so they travel with the phone exchange).
# A deck: {id, name, game, cards:[{k:"set|number", n, side, m:{game, set, number, showSet, showNum, name, ...}}], at, rules}
# --------------------------------------------------------------------------- #
import unicodedata as _ud
DECK_MTG_TYPES = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"]
_DECK_POOL = {}


def name_key(s):
    s = str(s or "").split(" (")[0].lower()
    s = "".join(ch for ch in _ud.normalize("NFD", s) if not _ud.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _deck_type(game, ctype):
    t = str(ctype or "")
    if game == "mtg":
        return next((x for x in DECK_MTG_TYPES if x in t), "Other" if t else "")
    return re.split(r" · | — | - ", t)[0].strip()


def _deck_cost(r):
    if r["cmc"] is not None:
        return float(r["cmc"]) if r["cmc"] % 1 else int(r["cmc"])
    m = re.search(r"(\d+)", str(r["cost"] or ""))
    return int(m.group(1)) if m else None


def deck_pool(conn, game):
    """Every card of one game with what the deck search filters on (kept in memory until the card list changes)."""
    prices_ensure(conn, game)
    sig = conn.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(rules)),0), COALESCE(SUM(price),0) FROM cg_cards WHERE game=?", (game,)).fetchone()
    sig = tuple(sig)
    hit = _DECK_POOL.get(game)
    if hit and hit[0] == sig:
        return hit[1]
    sets = {r["code"]: r for r in conn.execute("SELECT code, name, released FROM cg_sets WHERE game=?", (game,))}
    pool = []
    for r in conn.execute("SELECT set_code, number, name, rarity, ctype, cost, cmc, colors, subtype, pt, rules, price, path FROM cg_cards WHERE game=? AND demo=0", (game,)):
        st = sets.get(r["set_code"])
        f = {}
        if r["rarity"]:
            f["Rarity"] = r["rarity"]
        t = _deck_type(game, r["ctype"])
        if t:
            f["Type"] = t
        sub = r["subtype"] or ""
        if sub:
            f["Subtype"] = [x for x in re.split(r"\s+" if game == "mtg" else r"\s*[/·,]\s*", sub) if x][:6]
        c = _deck_cost(r)
        if c is not None:
            f["Cost"] = c
        if r["colors"]:
            f["Color"] = list(str(r["colors"]))
        pool.append(dict(game=game, set=r["set_code"], number=r["number"], showSet=str(r["set_code"]).upper(), showNum=r["number"], name=r["name"] or "",
                         setName=st["name"] if st else "", released=(st["released"] or "") if st else "", rarity=r["rarity"] or "",
                         price=r["price"], currency="EUR", info=dict(type=r["ctype"] or "", cost=r["cost"] or "", text=r["rules"] or "", pt=r["pt"] or ""),
                         f=f, local=bool(r["path"]), _k=name_key(r["name"])))
    _DECK_POOL[game] = (sig, pool)
    return pool


def deck_owned_names(conn, game):
    out = {}
    if game == "mtg":
        rows = conn.execute("SELECT COALESCE(m.name, i.name, o.id) n, SUM(o.qty) q FROM card_owned o LEFT JOIN card_meta m ON m.id=o.id "
                            "LEFT JOIN card_index i ON i.id=o.id GROUP BY o.id")
    else:
        rows = conn.execute("SELECT COALESCE(c.name, o.number) n, SUM(o.qty) q FROM cg_owned o LEFT JOIN cg_cards c ON c.game=o.game AND c.set_code=o.set_code "
                            "AND c.number=o.number WHERE o.game=? GROUP BY o.set_code, o.number", (game,))
    for r in rows:
        k = name_key(r["n"])
        out[k] = out.get(k, 0) + int(r["q"] or 0)
    return out


def deck_card(m):
    """What a deck keeps of a card (the same fields as the phone), with a picture link the phone can show too."""
    keep = ("game", "set", "number", "showSet", "showNum", "name", "setName", "rarity", "image", "info", "f", "price", "priceFoil", "currency", "psrc", "pid", "px")
    o = {k: m[k] for k in keep if m.get(k) is not None}
    if not o.get("image") and o.get("game") == "mtg":
        o["image"] = f"https://api.scryfall.com/cards/{o['set']}/{o['number']}?format=image&version=small"
    return o


def deck_search(conn, q):
    game = q.get("game", "")
    pool = deck_pool(conn, game)
    want = jl(q.get("f") or "{}", {})
    sets = {x for x in (q.get("sets") or "").split(",") if x}
    term = name_key(q.get("q", ""))
    in_text = q.get("text") == "1"
    prints = q.get("prints") == "1"
    own = deck_owned_names(conn, game)
    only_own = q.get("owned") == "1"
    base = [m for m in pool if not sets or m["set"] in sets]
    out, seen = [], set()
    for m in base:
        if term and term not in (name_key(m["info"]["text"]) if in_text else m["_k"]):
            continue
        if only_own and not own.get(m["_k"]):
            continue
        ok = True
        for k, v in want.items():
            if not v:
                continue
            x = m["f"].get(k)
            if not (v in [str(y) for y in x] if isinstance(x, list) else x is not None and str(x) == v):
                ok = False
                break
        if not ok or (not prints and m["_k"] in seen):
            continue
        seen.add(m["_k"])
        out.append(m)
    if term and not in_text:
        out.sort(key=lambda m: not m["_k"].startswith(term))
    # filters: made from what the cards of the picked sets know
    vals = {}
    for m in base:
        for k, v in m["f"].items():
            s = vals.setdefault(k, {})
            for x in (v if isinstance(v, list) else [v]):
                s[x] = s.get(x, 0) + 1
    order = ["Color", "Type", "Subtype", "Cost", "Rarity"]
    facets = []
    for k in sorted(vals, key=lambda k: order.index(k) if k in order else 99):
        s = vals[k]
        numeric = all(isinstance(x, (int, float)) for x in s)
        if len(s) < 2 or (len(s) > 80 and not numeric and k != "Subtype"):
            continue
        opts = sorted(s) if numeric else sorted(sorted(s, key=lambda x: -s[x])[:150], key=str)
        facets.append(dict(k=k, label="Creature type" if (k == "Subtype" and game == "mtg") else k, opts=[str(x) for x in opts[:200]]))
    setl = {}
    for m in pool:
        if m["set"] not in setl:
            setl[m["set"]] = dict(code=m["set"], name=m["setName"] or m["showSet"], released=m["released"])
    res = []
    for m in out[:350]:
        c = {k: v for k, v in m.items() if k != "_k"}
        c["own"] = own.get(m["_k"], 0)
        res.append(c)
    return dict(cards=res, total=len(out), facets=facets, sets=sorted(setl.values(), key=lambda s: (s["released"] or "", s["name"]), reverse=True),
                downloaded=bool(pool))


def decks_all(conn):
    sh = shared_data(conn)
    decks = [d for d in sh["decks"] if isinstance(d, dict) and d.get("id")]
    own = {}
    for g in {d.get("game") for d in decks}:
        try:
            own[g] = deck_owned_names(conn, g)
        except Exception:
            own[g] = {}
    for d in decks:
        o = own.get(d.get("game"), {})
        for x in d.get("cards") or []:
            x["own"] = o.get(name_key((x.get("m") or {}).get("name")), 0)
    return dict(decks=decks, rules=jl(get_setting(conn, "deck_rules"), {}) or {})


def deck_save(conn, deck):
    if not isinstance(deck, dict) or not deck.get("id") or not deck.get("game"):
        raise ValueError("Not a deck")
    cards = []
    for x in deck.get("cards") or []:
        m = deck_card(x.get("m") or {})
        n = int(x.get("n") or 0)
        if n > 0 and m.get("name"):
            cards.append(dict(k=f"{m.get('set', '')}|{m.get('number', '')}", n=n, side=bool(x.get("side")), m=m))
    d = dict(id=str(deck["id"])[:40], name=str(deck.get("name") or "Deck")[:60], game=str(deck["game"]), cards=cards, at=int(time.time() * 1000))
    if isinstance(deck.get("rules"), dict):
        d["rules"] = {k: int(v) for k, v in deck["rules"].items() if k in ("min", "max", "side", "copies") and isinstance(v, (int, float))}
    sh = shared_data(conn)
    decks = [x for x in sh["decks"] if x.get("id") != d["id"]] + [d]
    put_setting(conn, "shared_decks", json.dumps(decks))
    conn.commit()
    return d


def deck_delete(conn, did):
    sh = shared_data(conn)
    put_setting(conn, "shared_decks", json.dumps([x for x in sh["decks"] if x.get("id") != did]))
    gone = sh["decks_removed"]
    gone[did] = int(time.time() * 1000)
    put_setting(conn, "shared_decks_removed", json.dumps(gone))
    conn.commit()


def deck_resolve(conn, game, text):
    """A pasted deck list ('4 Lightning Bolt (M10) 146', 'Sideboard' ...) -> cards from the downloaded card list."""
    by = {}
    for m in deck_pool(conn, game):
        by.setdefault(m["_k"], []).append(m)
    out, miss, side = [], [], False
    for raw in str(text or "").splitlines():
        ln = raw.strip()
        if not ln:
            continue
        if re.match(r"^(sideboard|side ?deck|side)\s*:?$", ln, re.I):
            side = True
            continue
        if re.match(r"^(deck|main ?deck|main|commander)\s*:?$", ln, re.I):
            side = False
            continue
        mm = re.match(r"^(\d+)\s*x?\s+(.+?)\s*(?:\(([^)]+)\)\s*([\w-]+)?)?\s*$", ln, re.I)
        if not mm:
            miss.append(ln)
            continue
        n, name, sc, nb = int(mm.group(1)), re.sub(r"\s*\*.*$", "", mm.group(2)), (mm.group(3) or "").lower(), mm.group(4) or ""
        c = by.get(name_key(name)) or []
        hit = (next((m for m in c if sc and m["set"].lower() == sc and (not nb or norm_num(m["number"]) == norm_num(nb))), None)
               or next((m for m in c if sc and m["set"].lower() == sc), None) or (c[0] if c else None))
        if hit:
            out.append(dict(n=n, side=side, m={k: v for k, v in hit.items() if k != "_k"}))
        else:
            miss.append(ln)
    return dict(cards=out, missing=miss)


# --------------------------------------------------------------------------- #
# Price sources, the same as Nightvault Pocket: Cardmarket and TCGplayer (from the daily price files on GitHub),
# your own price, and "other" (what the card download brought). The first source in your order that has a price wins;
# the order and your own prices are shared with the phone.
# --------------------------------------------------------------------------- #
PRICE_SOURCES = {"cardmarket": ("Cardmarket", "EUR"), "tcgplayer": ("TCGplayer", "USD"), "mine": ("My own price", "EUR"), "other": ("Other sources", "EUR")}
PRICE_FILES = ["https://brokeuh.github.io/nightvault-pocket/data/prices/", "https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/prices/"]
CM_SLUG = {"wow": "WoW", "ws": "WeissSchwarz", "fab": "FleshAndBlood", "digimon": "Digimon", "swu": "StarWarsUnlimited", "onepiece": "OnePiece", "lorcana": "Lorcana",
           "dbsm": "DragonBallSuper", "dbsfw": "DragonBallSuper", "riftbound": "Riftbound", "mtg": "Magic", "pokemon": "Pokemon", "ygo": "YuGiOh"}


def _pslug(t):
    return tdata.slug(t) if tdata else name_key(t).replace(" ", "")


def price_order(conn):
    o = [k for k in (shared_data(conn)["price_order"].get("order") or []) if k in PRICE_SOURCES]
    return o + [k for k in PRICE_SOURCES if k not in o]


_RATE = {}


def _usd_rate(conn=None, refresh=False):
    """Dollars to euros: fetched while prices are updated (never while a page loads), remembered between runs."""
    if refresh and tdata:
        try:
            _RATE["r"] = float(tdata.usd_eur())
            if conn is not None:
                put_setting(conn, "usd_eur", str(_RATE["r"]))
        except Exception:
            pass
    if "r" not in _RATE and conn is not None:
        try:
            _RATE["r"] = float(get_setting(conn, "usd_eur") or 0.92)
        except ValueError:
            _RATE["r"] = 0.92
    return _RATE.get("r", 0.92)


def _my_prices_for(conn, game):
    """Own prices of one game, by our card ({(set, number): [normal, foil, at]}); phone keys are matched to our cards."""
    out, cache = {}, {}
    for k, v in shared_data(conn)["my_prices"].items():
        g, _, rest = k.partition("|")
        if g != game or not isinstance(v, list) or (v[0] is None and v[1] is None):
            continue
        sc, _, nb = rest.partition("|")
        hit = conn.execute("SELECT set_code, number FROM cg_cards WHERE game=? AND set_code=? AND number=?", (game, sc, nb)).fetchone()
        if hit:
            out[(hit[0], hit[1])] = v
            continue
        by_num, _bn = _phone_index(conn, game, cache)
        h = by_num.get((_set_key(sc), _num_key(nb)))
        if h:
            out[h] = v
    return out


def prices_apply(conn, game):
    """Set each card's price to the first source (in your order) that has one."""
    if game == "mtg":
        return 0
    conn.execute("UPDATE cg_cards SET price_dl=price, pxdone=1 WHERE game=? AND demo=0 AND pxdone IS NULL", (game,))
    src = {}
    for r in conn.execute("SELECT set_code, number, src, price, foil, cur FROM cg_prices WHERE game=?", (game,)):
        src.setdefault((r["set_code"], r["number"]), {})[r["src"]] = (r["price"], r["foil"], r["cur"])
    mine = _my_prices_for(conn, game)
    order, rate, upd = price_order(conn), _usd_rate(conn), []
    for r in conn.execute("SELECT set_code, number, price, price_dl FROM cg_cards WHERE game=? AND demo=0", (game,)):
        k = (r["set_code"], r["number"])
        have = dict(src.get(k, {}))
        if r["price_dl"] is not None:
            have["other"] = (r["price_dl"], None, "EUR")
        if k in mine:
            have["mine"] = (mine[k][0], mine[k][1], "EUR")
        p = None
        for s in order:
            v = have.get(s)
            if v and (v[0] is not None or v[1] is not None):
                p = v[0] if v[0] is not None else v[1]
                if v[2] == "USD":
                    p = round(p * rate, 2)
                break
        if p != r["price"]:
            upd.append((p, game, k[0], k[1]))
    conn.executemany("UPDATE cg_cards SET price=? WHERE game=? AND set_code=? AND number=?", upd)
    conn.commit()
    return len(upd)


def prices_ensure(conn, game):
    if game != "mtg" and conn.execute("SELECT 1 FROM cg_cards WHERE game=? AND demo=0 AND pxdone IS NULL LIMIT 1", (game,)).fetchone():
        prices_apply(conn, game)


def prices_apply_all(conn):
    for (g,) in conn.execute("SELECT DISTINCT game FROM cg_cards WHERE demo=0").fetchall():
        prices_apply(conn, g)


def price_file_key(conn, game, index_games):
    if game in index_games:
        return game
    cg = catalog_games(conn).get(game)
    if cg and f"ccgt{cg.get('gid')}" in index_games:
        return f"ccgt{cg.get('gid')}"
    return None


def _get_price_json(name):
    err = None
    for base in PRICE_FILES:
        try:
            return json.loads(_fetch(base + name, 60))
        except Exception as e:
            err = e
    raise ValueError(f"Could not download {name}: {err}")


def job_prices_update(conn, say, progress):
    idx = _get_price_json("index.json")
    _usd_rate(conn, refresh=True)
    games = set(idx.get("games") or [])
    have = [r[0] for r in conn.execute("SELECT DISTINCT game FROM cg_cards WHERE demo=0 AND game<>'mtg'")]
    total = 0
    for game in have:
        if STOP.is_set():
            break
        key = price_file_key(conn, game, games)
        label = (conn.execute("SELECT name FROM cg_games WHERE id=?", (game,)).fetchone() or [game])[0]
        if not key:
            say(f"{label}: no Cardmarket or TCGplayer prices for this game.")
            continue
        progress(f"Prices for {label} ...")
        try:
            d = _get_price_json(key + ".json")
        except ValueError as e:
            say(f"{label}: {e}")
            continue
        cache, now, rows = {}, time.time(), []
        by_num, by_name = _phone_index(conn, game, cache)
        mine = {(r["set_code"], r["number"]): r["name"] for r in conn.execute("SELECT set_code, number, name FROM cg_cards WHERE game=? AND demo=0", (game,))}
        done = set()
        for k, e in (d.get("cards") or {}).items():
            sc, _, nb = k.partition("|")
            hit = (sc, nb) if (sc, nb) in mine else by_num.get((_set_key(sc), _num_key(nb)))
            if not hit:
                continue
            if e.get("c") and (e["c"][0] is not None or e["c"][1] is not None):
                c = e["c"]
                rows.append((game, hit[0], hit[1], "cardmarket", c[0], c[1], c[2] if len(c) > 2 else None, c[3] if len(c) > 3 else None, c[4] if len(c) > 4 else None, "EUR", now))
                done.add(hit)
            if e.get("t") and (e["t"][0] is not None or e["t"][1] is not None):
                t = e["t"]
                rows.append((game, hit[0], hit[1], "tcgplayer", t[0], t[1], None, None, t[2] if len(t) > 2 else None, "USD", now))
        names = d.get("names") or {}
        if names:                                   # Cardmarket by card name, when only one card has that name
            for (sc, nb), nm in mine.items():
                if (sc, nb) in done:
                    continue
                l = names.get(_pslug(re.sub(r"\([^)]*\)", "", nm or ""))) or names.get(_pslug(str(nm or "").split(" - ")[0])) or []
                if len(l) == 1:
                    c = l[0]
                    rows.append((game, sc, nb, "cardmarket", c[0], c[1], c[2], c[3], c[4], "EUR", now))
        conn.execute("DELETE FROM cg_prices WHERE game=? AND src IN ('cardmarket','tcgplayer')", (game,))
        conn.executemany("INSERT OR REPLACE INTO cg_prices VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
        conn.commit()
        n = prices_apply(conn, game)
        total += len(rows)
        say(f"{label}: {len({(r[1], r[2]) for r in rows}):,} cards with a price, {n:,} prices changed.")
    put_setting(conn, "prices_updated", str(int(time.time())))
    say(f"Done - {total:,} prices from Cardmarket and TCGplayer.")


def card_prices(conn, game, sc, nb):
    out = {}
    for r in conn.execute("SELECT * FROM cg_prices WHERE game=? AND set_code=? AND number=?", (game, sc, nb)):
        out[r["src"]] = dict(price=r["price"], foil=r["foil"], cur=r["cur"], low=r["low"], avg30=r["avg30"], pid=r["pid"], at=r["at"])
    row = conn.execute("SELECT price, price_dl, name FROM cg_cards WHERE game=? AND set_code=? AND number=?", (game, sc, nb)).fetchone()
    if row and row["price_dl"] is not None:
        out["other"] = dict(price=row["price_dl"], foil=None, cur="EUR")
    m = _my_prices_for(conn, game).get((sc, nb))
    if m:
        out["mine"] = dict(price=m[0], foil=m[1], cur="EUR", at=m[2])
    name = row["name"] if row else ""
    links = {}
    if CM_SLUG.get(game):
        cm = out.get("cardmarket") or {}
        links["cardmarket"] = (f"https://www.cardmarket.com/en/{CM_SLUG[game]}/Products?idProduct={cm['pid']}" if cm.get("pid")
                               else f"https://www.cardmarket.com/en/{CM_SLUG[game]}/Products/Search?searchString={urllib.parse.quote(name)}")
    tp = out.get("tcgplayer") or {}
    links["tcgplayer"] = f"https://www.tcgplayer.com/product/{tp['pid']}" if tp.get("pid") else f"https://www.tcgplayer.com/search/all/product?q={urllib.parse.quote(name)}"
    glabel = (conn.execute("SELECT name FROM cg_games WHERE id=?", (game,)).fetchone() or [""])[0]
    q = urllib.parse.quote((re.sub(r"\s*(TCG|CCG|Card Game)$", "", glabel.split(" (")[0]) + " " + name).strip())
    links["ebay"] = f"https://www.ebay.com/sch/i.html?_nkw={q}&LH_Sold=1&LH_Complete=1"
    links["ebayde"] = f"https://www.ebay.de/sch/i.html?_nkw={q}&LH_Sold=1&LH_Complete=1"
    return dict(order=price_order(conn), sources=out, used=row["price"] if row else None, labels={k: v[0] for k, v in PRICE_SOURCES.items()},
                links=links, rate=_usd_rate(conn), updated=get_setting(conn, "prices_updated"))


# --------------------------------------------------------------------------- #
# Your own card pictures: a folder like  <set name>/<card name>.png  (scans you made or collected).
# The set and card names are matched to the game's card list, so the cards get the same set and number as on the
# phone; pictures that match nothing are still added, under their folder's name.
# --------------------------------------------------------------------------- #
OWN_SKIP_DIR = re.compile(r"bleed|^crop$|thumb|^_|^\.", re.I)
OWN_BUCKET = re.compile(r"^(bosses|tokens?|hard mode|extras?|promos?|backs?|crop|\d+p\d+)$", re.I)


def _ckey(s):
    s = str(s or "").replace("_", "").replace("'", "").replace("\u2019", "")
    s = "".join(ch for ch in _ud.normalize("NFD", s.lower()) if not _ud.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", s)


def _skey(s):
    s = re.sub(r"^(dungeon series|dungeon decks?|raid deck|wow tcg)\s*[-:]\s*", "", str(s or "").strip(), flags=re.I)
    s = re.sub(r"^the\s+", "", s, flags=re.I)
    return _ckey(s)


def own_catalog(conn, game):
    """The game's card list from the CCG Trader backup next to Nightvault Pocket (kept in the tools folder for offline use)."""
    cg = catalog_games(conn).get(game) or {}
    gid = cg.get("gid") or ((DOWNLOADERS.get(game) or {}).get("api") or {}).get("gid")
    if not gid:
        return None
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    cache = TOOLS_DIR / f"ccgt_{gid}.json"
    data = None
    for base in ("https://brokeuh.github.io/nightvault-pocket/data/ccgt/", "https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/ccgt/"):
        try:
            raw = _fetch(f"{base}{gid}.json", 60)
            data = json.loads(raw)
            cache.write_bytes(raw)
            break
        except Exception:
            continue
    if data is None and cache.exists():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            data = None
    if data is None:
        return None
    rar = {}
    try:
        rar = json.loads(_fetch("https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/ccgt/index.json", 30)).get("rarities") or {}
    except Exception:
        pass
    return data, rar


def import_own_pictures(conn, game, folder, say, progress, cat=None):
    if not os.path.isdir(folder):
        say(f"Folder not found: {folder}")
        return 0
    if cat is None:
        progress("Getting the card list ...")
        cat = own_catalog(conn, game)
    sets, cards, rar = {}, {}, {}
    if cat:
        data, rar = cat
        for s in data.get("sets") or []:
            sets.setdefault(_skey(s["name"]), s)
        for c in data.get("cards") or []:
            nm = str(c[2] or "").strip()
            num = "" if c[1] in (None, 0, "") else str(c[1])
            cards.setdefault((str(c[0]), _ckey(nm)), (num or (tdata.slug(nm) if tdata else _ckey(nm)), nm, rar.get(str(c[3]), "") if len(c) > 3 else ""))

    def find_set(parts):
        for p in reversed(parts):                      # nearest folder that is a known set
            k = _skey(p)
            if k in sets:
                return sets[k]
            hit = [s for kk, s in sets.items() if len(k) >= 6 and len(kk) >= 6 and (kk.endswith(k) or k.endswith(kk))]
            if len(hit) == 1:
                return hit[0]
        return None

    by_set = {}
    for (sc, k) in cards:
        by_set.setdefault(sc, []).append(k)

    def match(code, stem):
        k = _ckey(stem)
        if (code, k) in cards:
            return cards[(code, k)]
        base = re.sub(r"\s*(-\s*(alternate|alt|variant|alt art)|\(\w+\)|\d+)$", "", stem, flags=re.I).strip()
        if base != stem and (code, _ckey(base)) in cards:
            return cards[(code, _ckey(base))]
        close = difflib.get_close_matches(k, by_set.get(code, []), n=1, cutoff=0.88)
        return cards[(code, close[0])] if close else None

    rows, newsets, seen, matched, n, backs = [], {}, set(), 0, 0, []
    for dirpath, dirs, files in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if not OWN_SKIP_DIR.search(d))
        rel = os.path.relpath(dirpath, folder)
        parts = [] if rel == "." else rel.replace("\\", "/").split("/")
        for fn in sorted(files):
            stem, ext = os.path.splitext(fn)
            if ext.lower() not in CARD_IMG_EXT or re.match(r"^card ?back", stem, re.I) or re.search(r"(^|\s)back$", stem, re.I):
                continue
            side = re.match(r"^(.*?)\s*-\s*(backside|back side|back)$", stem, re.I)
            if side:                                   # the other face of a card: saved with that card
                backs.append((parts, side.group(1), os.path.join(dirpath, fn)))
                continue
            st = find_set(parts)
            if st:
                code, sname, rel_date = str(st["id"]), st["name"], st.get("released") or ""
            else:
                own = [p for p in parts if not OWN_BUCKET.match(p)] or parts or ["My pictures"]
                sname = own[-1].replace("_", "'")
                code, rel_date = "own-" + (_ckey(sname)[:30] or "set"), ""
            hit = match(code, stem)
            if hit:
                number, name, rarity = hit
                matched += 1
                if (code, number) in seen:              # a second picture of the same card (alternate art)
                    name, number = stem.replace("_", "'").strip(), number + "-" + (tdata.slug(stem) if tdata else _ckey(stem))
            else:
                name, rarity = stem.replace("_", "'").strip(), ""
                number = tdata.slug(name) if tdata else _ckey(name)
            if (code, number) in seen:
                continue
            seen.add((code, number))
            newsets[code] = (sname, rel_date)
            rows.append((game, code, number, name, rarity, os.path.join(dirpath, fn)))
            n += 1
            if n % 500 == 0:
                progress(f"Reading your pictures ... {n:,}")
    norm = os.path.normcase(os.path.abspath(folder))
    old = [r for r in conn.execute("SELECT set_code, number, path FROM cg_cards WHERE game=? AND demo=0", (game,))
           if r["path"] and os.path.normcase(os.path.abspath(r["path"])).startswith(norm)]
    conn.executemany("DELETE FROM cg_cards WHERE game=? AND set_code=? AND number=?", [(game, r["set_code"], r["number"]) for r in old])
    have = {(r["set_code"], r["number"]) for r in conn.execute("SELECT set_code, number FROM cg_cards WHERE game=? AND demo=0 AND path IS NOT NULL AND path<>''", (game,))}
    rows = [r for r in rows if (r[1], r[2]) not in have]        # a downloaded picture of the same card stays
    conn.executemany("INSERT OR REPLACE INTO cg_cards (game, set_code, number, name, rarity, ctype, cost, pt, rules, flavor, artist, price, path, demo) "
                     "VALUES (?,?,?,?,?,'','','','','','',NULL,?,0)", rows)
    for code, (nm, rd) in newsets.items():
        conn.execute("INSERT OR IGNORE INTO cg_sets VALUES (?,?,?,?,0)", (game, code, nm, rd))
    front = {}
    for r in rows:
        front.setdefault((os.path.dirname(r[5]), _ckey(os.path.splitext(os.path.basename(r[5]))[0])), (r[1], r[2]))
        front.setdefault((os.path.dirname(r[5]), _ckey(r[3])), (r[1], r[2]))
    for parts_, nm, path in backs:
        hit = front.get((os.path.dirname(path), _ckey(nm)))
        if not hit:                                    # the front can sit one folder up or down (Bosses ...)
            hit = next((v for (d, k), v in front.items() if k == _ckey(nm) and os.path.dirname(d) == os.path.dirname(os.path.dirname(path))), None) \
                  or next((v for (d, k), v in front.items() if k == _ckey(nm)), None)
        if hit:
            conn.execute("UPDATE cg_cards SET back_path=? WHERE game=? AND set_code=? AND number=?", (path, game, hit[0], hit[1]))
    label = (DOWNLOADERS.get(game) or {}).get("label") or (catalog_games(conn).get(game) or {}).get("label") or game
    color = (DOWNLOADERS.get(game) or {}).get("color") or (catalog_games(conn).get(game) or {}).get("color") or "#7aa2f7"
    conn.execute("INSERT OR IGNORE INTO cg_games VALUES (?,?,?,?,0)", (game, label, "Card pictures on this PC", color))
    conn.commit()
    folders = jl(get_setting(conn, "own_pic_folders"), {}) or {}
    if folder not in folders.get(game, []):
        folders.setdefault(game, []).append(folder)
        put_setting(conn, "own_pic_folders", json.dumps(folders))
    say(f"{label}: {len(rows):,} pictures from {folder} in {len(newsets)} sets - {matched:,} matched to the card list"
        + ("" if cat else " (the card list could not be loaded, so cards keep the names of their files)") + ".")
    return len(rows)


def reimport_own_pictures(conn, game, say, progress):
    for f in (jl(get_setting(conn, "own_pic_folders"), {}) or {}).get(game, []):
        import_own_pictures(conn, game, f, say, progress)


def job_own_pictures(game, folder):
    def run(conn, say, progress):
        import_own_pictures(conn, game, folder, say, progress)
        try:
            prices_apply(conn, game)
        except Exception:
            traceback.print_exc()
    return run


def export_phone_cards(conn):
    """The whole card collection with Nightvault's prices, as a file Nightvault Pocket can open (Settings > Restore).
    Every entry gets an id starting with nv:, and its quantity is remembered, so importing it back from the phone adds nothing twice."""
    seen = jl(get_setting(conn, "phone_import"), {})
    if not isinstance(seen, dict):
        seen = {}
    labels = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM cg_games")}
    cards = []
    for r in conn.execute("SELECT o.id, o.foil, SUM(o.qty) qty, m.name, m.set_name, m.rarity, m.eur, m.eur_foil, i.name AS iname "
                          "FROM card_owned o LEFT JOIN card_meta m ON m.id=o.id LEFT JOIN card_index i ON i.id=o.id GROUP BY o.id, o.foil"):
        set_code, _, num = r["id"].partition(":")
        price = r["eur_foil"] if r["foil"] else r["eur"]
        cards.append(dict(game="mtg", set=set_code, number=num, name=r["name"] or r["iname"] or r["id"], set_name=r["set_name"] or "",
                          rarity=r["rarity"] or "", foil=bool(r["foil"]), qty=r["qty"], price=price, currency="EUR"))
    for r in conn.execute("SELECT o.game, o.set_code, o.number, o.foil, SUM(o.qty) qty, c.name, c.rarity, c.price, s.name AS set_name "
                          "FROM cg_owned o LEFT JOIN cg_cards c ON c.game=o.game AND c.set_code=o.set_code AND c.number=o.number "
                          "LEFT JOIN cg_sets s ON s.game=o.game AND s.code=o.set_code WHERE o.game NOT IN (SELECT id FROM cg_games WHERE demo=1) "
                          "GROUP BY o.game, o.set_code, o.number, o.foil"):
        cards.append(dict(game=r["game"], game_name=labels.get(r["game"], r["game"]), set=r["set_code"], number=r["number"],
                          name=r["name"] or f"{r['set_code'].upper()} #{r['number']}", set_name=r["set_name"] or "", rarity=r["rarity"] or "",
                          foil=bool(r["foil"]), qty=r["qty"], price=r["price"], currency="EUR"))
    trade = jl(get_setting(conn, "card_trade"), {})
    for c in cards:
        c["uid"] = f"nv:{c['game']}:{c['set']}:{c['number']}:{1 if c['foil'] else 0}"
        c["show_set"], c["show_number"] = c["set"].upper(), c["number"]
        if trade.get(f"{c['game']}|{c['set']}|{c['number']}"):
            c["trade"] = True
        seen[c["uid"]] = max(int(seen.get(c["uid"], 0) or 0), c["qty"])      # coming back from the phone adds nothing twice
    conn.execute("INSERT OR REPLACE INTO app_settings VALUES (?,?)", ("phone_import", json.dumps(seen)))
    conn.commit()
    contrib = jl(get_setting(conn, "sync_contrib"), {})
    sync_own = {}
    for c in cards:
        k = _sync_key(c["game"], c["set"], c["number"], c["foil"])
        sync_own[k] = sync_own.get(k, 0) + c["qty"]
    for k in list(sync_own):
        sync_own[k] -= int(contrib.get(k, 0) or 0)
    sent = jl(get_setting(conn, "sync_sent"), {})
    for k in set(contrib) | set(sent):                       # cards that are gone here: report them, so the phone removes them too
        if k not in sync_own:
            sync_own[k] = -int(contrib.get(k, 0) or 0)
    put_setting(conn, "sync_sent", json.dumps({k: 1 for k, v in sync_own.items() if v or k in contrib}))
    conn.commit()
    return dict(format=PHONE_FORMAT, version=2, source="nightvault", app="Nightvault", exported=time.strftime("%Y-%m-%dT%H:%M:%S"), cards=cards,
                full=True, sync_own=sync_own, sync_contrib=contrib, **shared_data(conn))


def owned_change(conn, cid, foil, delta, owner=0, location=""):
    row = conn.execute("SELECT qty FROM card_owned WHERE id=? AND foil=? AND owner=?", (cid, foil, owner)).fetchone()
    qty = max(0, (row["qty"] if row else 0) + delta)
    if qty == 0:
        conn.execute("DELETE FROM card_owned WHERE id=? AND foil=? AND owner=?", (cid, foil, owner))
    else:
        conn.execute("INSERT OR REPLACE INTO card_owned VALUES (?,?,?,?,?,?)", (cid, foil, owner, qty, location, time.time()))
    conn.commit()
    return qty


# --------------------------------------------------------------------------- #
# Related items + wishlist
# --------------------------------------------------------------------------- #
LINK_KINDS = {"expansion of": "Has expansion", "reprint of": "Has reprint", "part of series": "Includes",
              "same universe as": "Same universe"}
_STOP = {"the", "a", "an", "of", "and", "de", "het", "een", "in", "to", "season", "collection", "complete", "vol", "volume"}


def _stem(name):
    words = [w for w in re.findall(r"[^\W_]+", re.sub(r"\(\d{4}\)", " ", name.lower())) if w not in _STOP and not w.isdigit()]
    if not words:
        return ""
    return " ".join(words[:2]) if len(words) >= 2 and len(words[0]) <= 6 else words[0]


def related_for(conn, gid):
    items = library(conn, False)
    by_id = {x["id"]: x for x in items}
    cur = by_id.get(gid)
    if not cur:
        raise KeyError("Item not found")
    groups, seen = [], {gid}

    def add(title, ids, hint=""):
        ids = [i for i in ids if i in by_id and i not in seen][:14]
        if ids:
            seen.update(ids)
            groups.append(dict(title=title, ids=ids, hint=hint))

    # 1. links made by hand (expansion / reprint / series ...)
    links = []
    for r in conn.execute("SELECT a, b, kind FROM links WHERE a=? OR b=?", (gid, gid)):
        other = r["b"] if r["a"] == gid else r["a"]
        label = r["kind"] if r["a"] == gid else LINK_KINDS.get(r["kind"], r["kind"])
        if other in by_id:
            links.append(dict(a=r["a"], b=r["b"], kind=r["kind"], label=label, id=other))
    by_label = {}
    for l in links:
        by_label.setdefault(l["label"], []).append(l["id"])
    for label, ids in by_label.items():
        add(label[:1].upper() + label[1:], ids)
        seen.difference_update(ids)  # a linked item may also show up in the automatic groups below
    seen.update(l["id"] for l in links)
    # 2. same franchise (the name starts the same way)
    stem = _stem(cur["name"])
    if stem:
        add("Same franchise", [x["id"] for x in items if _stem(x["name"]) == stem])
    # 3. same publisher / studio / network (from the details we fetched)
    facts = {}
    for r in conn.execute("SELECT gid, data FROM meta"):
        try:
            d = json.loads(r["data"])
        except ValueError:
            continue
        for label, val in d.get("facts", []):
            if label in ("Publisher", "Studio", "Network"):
                facts[r["gid"]] = val
                break
    if gid in facts:
        add(f"Also from {facts[gid]}", [i for i, v in facts.items() if v == facts[gid]])
    # 4. similar genres inside the same collection
    mine = set(cur.get("genres") or [])
    if mine:
        need = 2 if len(mine) >= 3 else 1
        scored = sorted(((len(mine & set(x.get("genres") or [])), x["name"].lower(), x["id"]) for x in items
                         if x["coll"] == cur["coll"] and x["id"] != gid and len(mine & set(x.get("genres") or [])) >= need),
                        key=lambda t: (-t[0], t[1]))
        add("Similar genres", [t[2] for t in scored])
    wishes = [dict(id=r["id"], name=r["name"], note=r["note"] or "") for r in
              conn.execute("SELECT id, name, note FROM wishlist WHERE ref=? ORDER BY id", (gid,))]
    return dict(groups=groups, links=links, wishes=wishes)


# --------------------------------------------------------------------------- #
# Card hub: game systems -> sets -> cards.  Real games come from the card images the downloaders saved;
# the demo games below are made up (names, rules and art are all invented) so the screens can be shown.
# --------------------------------------------------------------------------- #
DOWNLOADERS = {
    "mtg": dict(label="Magic: The Gathering", script="scryfall_downloader.py", color="#b8863b", quality=["small", "normal", "large", "png"], hint="neo mh3 lea"),
    "lorcana": dict(label="Disney Lorcana", script="lorcana_downloader.py", color="#5a6bd6", quality=[], hint="1 2 D100"),
    "riftbound": dict(label="Riftbound", script="riftbound_downloader.py", color="#d6595a", quality=[], hint="ogn"),
    "swu": dict(label="Star Wars: Unlimited", script="swu_downloader.py", color="#4aa3c8", quality=[], hint="sor shd"),
}

DOWNLOADERS_BASE = dict(DOWNLOADERS)


def custom_games(conn):
    return jl(get_setting(conn, "custom_games"), {})


def catalog_games(conn):
    """Games added from the CCG Trader catalog: {key: {gid, label, color}}. The ones the phone app has built in
    (WoW TCG, Dragon Ball Z CCG, Dragon Ball GT) are added once by themselves."""
    games = jl(get_setting(conn, "ccgt_games"), {})
    if ccgt and tdata and not get_setting(conn, "ccgt_defaults_added"):
        for k, (gid, label, color) in tdata.CATALOG_DEFAULTS.items():
            if k not in games:
                games[k] = dict(gid=gid, label=label, color=color)
        put_setting(conn, "ccgt_games", json.dumps(games))
        put_setting(conn, "ccgt_defaults_added", "1")
    return games


CATALOG_COLORS = ["#7aa2f7", "#e0af68", "#9ece6a", "#f7768e", "#bb9af7", "#73daca", "#ff9e64", "#2ac3de"]


PHONE_GAMES = ["pokemon", "ygo"]          # web sources the phone app has built in: switched on from the start


def enabled_games(conn):
    """The games switched on in Settings -> Card games. The phone app's games are switched on once by themselves."""
    v = jl(get_setting(conn, "card_games"), None)
    extra = PHONE_GAMES + (list(tdata.SOURCES) if tdata else [])
    if v is None:
        return list(DOWNLOADERS_BASE) + extra
    v = [x for x in v if isinstance(x, str)]
    if not get_setting(conn, "phone_games_added"):
        v += [x for x in extra if x not in v]
        put_setting(conn, "card_games", json.dumps(v))
        put_setting(conn, "phone_games_added", "1")
    return v


def sync_downloaders(conn):
    """The games that can be downloaded right now: the four with their own script, the ready-made web sources you switched on, and the ones you added."""
    on = set(enabled_games(conn))
    new = {k: v for k, v in DOWNLOADERS_BASE.items() if k in on}
    if cardsrc:
        for k, v in cardsrc.PRESETS.items():
            if k in on:
                new[k] = dict(label=v["label"], script=None, color=v["color"], quality=[], hint=v["hint"], api=v)
        for k, v in custom_games(conn).items():
            new[k] = dict(label=v["label"], script=None, color=v.get("color") or "#8a8f9c", quality=[], hint=v.get("hint") or "", api=v)
    if tdata:
        for k, v in tdata.SOURCES.items():
            if k in on:
                new[k] = dict(label=v["label"], script=None, color=v["color"], quality=[], hint=v["hint"], api=dict(kind="tcgdata", key=k))
    if ccgt:
        for k, v in catalog_games(conn).items():
            new[k] = dict(label=v["label"], script=None, color=v.get("color") or "#8a8f9c", quality=[], hint="set id or part of a set name",
                          api=dict(kind="ccgtrader", gid=v["gid"]))
    for k in [k for k in DOWNLOADERS if k not in new]:
        DOWNLOADERS.pop(k, None)
    DOWNLOADERS.update(new)


def card_game_choices(conn):
    on, out = set(enabled_games(conn)), []
    for k, v in DOWNLOADERS_BASE.items():
        out.append(dict(id=k, label=v["label"], color=v["color"], kind="builtin", enabled=k in on, available=(HERE / v["script"]).exists(),
                        note="Downloads card images with its own script."))
    if cardsrc:
        for k, v in cardsrc.PRESETS.items():
            out.append(dict(id=k, label=v["label"], color=v["color"], kind="preset", enabled=k in on, available=True, note=v["note"], site=v["site"]))
        for k, v in custom_games(conn).items():
            out.append(dict(id=k, label=v["label"], color=v.get("color") or "#8a8f9c", kind="custom", enabled=True, available=True,
                            note="Added by you.", has_key=bool(v.get("key")), sets_url=v["sets"]["url"]))
    if tdata:
        for k, v in tdata.SOURCES.items():
            out.append(dict(id=k, label=v["label"], color=v["color"], kind="preset", enabled=k in on, available=True, note=v["note"], site=v["site"]))
    for k, v in catalog_games(conn).items():
        out.append(dict(id=k, label=v["label"], color=v.get("color") or "#8a8f9c", kind="catalog", enabled=True, available=bool(ccgt),
                        note="From the CCG Trader catalog - pictures and card numbers, no prices.", gid=v["gid"]))
    return out


DEMO_GAMES = [
    ("emberfall", "Emberfall", "A duel game of rival realms and elemental pacts.", "#e8743b"),
    ("nova", "Nova Frontier", "Command fleets and crews across the outer sectors.", "#7a5cff"),
    ("pets", "Mythic Pets", "Collect, train and trade friendly creatures.", "#3fbf8a"),
]
DEMO_SETS = [
    ("emberfall", "akg", "Ashen Kingdoms", "2024-03-15"), ("emberfall", "tdb", "Tidebound", "2024-09-20"),
    ("nova", "fct", "First Contact", "2023-06-10"), ("nova", "dsc", "Dark Sector", "2024-11-08"),
    ("pets", "gpr", "Garden Party", "2025-04-02"),
]
# game, set, number, name, rarity, type, cost, p/t, rules, flavor, artist, price (EUR)
DEMO_CARDS = [
    ("emberfall", "akg", "1", "Cinder Fox", "Common", "Creature - Beast", "2", "2/1", "Haste. When Cinder Fox enters, it deals 1 damage to any target.", "Small flame, long shadow.", "Lena Voss", 0.12),
    ("emberfall", "akg", "2", "Ashwood Sentinel", "Common", "Creature - Guardian", "3", "1/4", "Guard. Takes at most 2 damage from each source.", "It has stood there since before the road.", "Tomas Ibarra", 0.10),
    ("emberfall", "akg", "3", "Ember Courier", "Common", "Creature - Scout", "1", "1/1", "When Ember Courier dies, draw a card.", "Every message arrives warm.", "Mika Hale", 0.08),
    ("emberfall", "akg", "4", "Kiln Mage", "Uncommon", "Creature - Mage", "3", "2/2", "Pay 1: Kiln Mage gets +1/+0 until end of turn.", "Patience is just slow fire.", "Lena Voss", 0.35),
    ("emberfall", "akg", "5", "Obsidian Rampart", "Uncommon", "Structure", "2", "", "Your Guardians get +0/+1.", "Glass remembers every blow.", "Joon Park", 0.30),
    ("emberfall", "akg", "6", "Pact of Smoke", "Uncommon", "Spell", "2", "", "Return target creature to its owner's hand. Draw a card.", "A bargain signed in vapour.", "Mika Hale", 0.40),
    ("emberfall", "akg", "7", "Magma Hound", "Rare", "Creature - Beast", "4", "4/3", "Trample. Whenever Magma Hound attacks, it deals 2 damage to each opponent.", "Follow the glow, not the growl.", "Tomas Ibarra", 1.80),
    ("emberfall", "akg", "8", "Queen of the Last Hearth", "Rare", "Creature - Noble", "5", "3/5", "Your creatures have haste.", "She rules the one fire that never went out.", "Joon Park", 2.50),
    ("emberfall", "akg", "9", "Sunscorch Wyrm", "Mythic", "Creature - Dragon", "6", "6/6", "Flying. When Sunscorch Wyrm enters, destroy all structures.", "The dawn arrived early and angry.", "Lena Voss", 9.90),
    ("emberfall", "akg", "10", "Hearthfire Oath", "Common", "Spell", "1", "", "Target creature gets +2/+2 until end of turn.", "Spoken once, remembered by the flames.", "Mika Hale", 0.07),
    ("emberfall", "tdb", "1", "Tide Sprite", "Common", "Creature - Spirit", "1", "1/1", "Flying. Tide Sprite can block creatures with flying.", "Born from the foam of a quiet morning.", "Ana Reyes", 0.09),
    ("emberfall", "tdb", "2", "Coral Warden", "Common", "Creature - Guardian", "3", "2/3", "When Coral Warden enters, gain 2 life.", "The reef never forgets a debt.", "Noor Hadid", 0.11),
    ("emberfall", "tdb", "3", "Moonlit Eel", "Common", "Creature - Beast", "2", "2/1", "Moonlit Eel cannot be blocked by creatures with power 3 or more.", "Silver in the dark water.", "Ana Reyes", 0.10),
    ("emberfall", "tdb", "4", "Brine Scholar", "Uncommon", "Creature - Mage", "3", "2/3", "Pay 2: Look at the top three cards of your deck. Put one into your hand.", "Salt preserves more than fish.", "Noor Hadid", 0.40),
    ("emberfall", "tdb", "5", "Drift Anchor", "Uncommon", "Structure", "2", "", "Creatures you control cannot be returned to hand by opponents.", "Heavy enough to hold a storm.", "Joon Park", 0.25),
    ("emberfall", "tdb", "6", "Undertow", "Uncommon", "Spell", "3", "", "Tap up to two target creatures. They do not untap next turn.", "The sea takes its time.", "Ana Reyes", 0.30),
    ("emberfall", "tdb", "7", "Pearl Oracle", "Rare", "Creature - Mystic", "4", "2/4", "At the start of your turn, look at the top card of your deck.", "She speaks in tides and halves.", "Noor Hadid", 1.60),
    ("emberfall", "tdb", "8", "Salt Cartographer", "Rare", "Creature - Scout", "3", "3/2", "When Salt Cartographer enters, search your deck for a Structure.", "Every coast is a rumour until drawn.", "Tomas Ibarra", 1.40),
    ("emberfall", "tdb", "9", "Leviathan of Still Water", "Mythic", "Creature - Leviathan", "7", "7/8", "Hexproof. When Leviathan of Still Water attacks, tap all other creatures.", "Nothing moves when it breathes in.", "Ana Reyes", 11.50),
    ("emberfall", "tdb", "10", "Whisper Current", "Common", "Spell", "1", "", "Draw a card, then discard a card.", "Listen closely and it listens back.", "Noor Hadid", 0.06),
    ("nova", "fct", "1", "Scout Skiff", "Common", "Ship - Light", "1", "1/1", "Sprint. Scout Skiff can move after attacking.", "Small hull, big curiosity.", "Ravi Menon", 0.08),
    ("nova", "fct", "2", "Relay Drone", "Common", "Unit - Drone", "1", "0/2", "When Relay Drone enters, draw a card.", "Carries news faster than light.", "Ilse Brandt", 0.07),
    ("nova", "fct", "3", "Asteroid Miner", "Common", "Crew - Worker", "2", "1/2", "Tap: Add one credit.", "Rocks pay better than people.", "Ravi Menon", 0.09),
    ("nova", "fct", "4", "Void Marine", "Common", "Crew - Soldier", "3", "3/2", "Boarding 1. When Void Marine attacks a ship, deal 1 extra damage.", "Quiet vacuum, loud boots.", "Ilse Brandt", 0.12),
    ("nova", "fct", "5", "Signal Jammer", "Uncommon", "Gear", "2", "", "Opponents' Relay units cannot use abilities.", "Static is a kind of silence.", "Ravi Menon", 0.35),
    ("nova", "fct", "6", "Hull Breach", "Uncommon", "Event", "2", "", "Deal 3 damage to target ship.", "Pressure always finds the seam.", "Ilse Brandt", 0.30),
    ("nova", "fct", "7", "Nebula Cruiser", "Rare", "Ship - Heavy", "5", "5/5", "Shield 2. Nebula Cruiser cannot be targeted by events while shielded.", "It sails inside its own weather.", "Yuki Tanaka", 2.10),
    ("nova", "fct", "8", "Captain Idris Vale", "Rare", "Crew - Captain", "4", "3/3", "Your ships get +1/+0. When Idris Vale enters, repair target ship.", "The map is only a suggestion.", "Yuki Tanaka", 2.80),
    ("nova", "fct", "9", "The Silent Armada", "Mythic", "Fleet", "8", "8/8", "When The Silent Armada enters, each opponent loses half their credits.", "No engines. No warning. No survivors.", "Ravi Menon", 12.00),
    ("nova", "dsc", "1", "Shadow Probe", "Common", "Unit - Drone", "1", "1/1", "Stealth. Shadow Probe cannot be seen by opposing scanners.", "Looks, but never looked at.", "Ilse Brandt", 0.09),
    ("nova", "dsc", "2", "Dust Runner", "Common", "Ship - Light", "2", "2/2", "Sprint. When Dust Runner attacks, scry 1.", "Fast enough to outrun the dark.", "Yuki Tanaka", 0.10),
    ("nova", "dsc", "3", "Cold Reactor", "Uncommon", "Gear", "3", "", "Tap: Add two credits. It does not untap during your next untap step.", "Powerful, patient, and unwelcoming.", "Ravi Menon", 0.38),
    ("nova", "dsc", "4", "Event Horizon", "Rare", "Event", "4", "", "Remove target ship from the game.", "Past this line, the story stops.", "Yuki Tanaka", 1.90),
    ("nova", "dsc", "5", "Warden of the Rift", "Rare", "Crew - Guardian", "5", "4/6", "Shield 1. Opposing ships enter tapped.", "The door is closed. It intends to stay that way.", "Ilse Brandt", 2.20),
    ("nova", "dsc", "6", "Starlight Choir", "Mythic", "Fleet", "6", "4/4", "At the start of your turn, repair each of your ships.", "A hymn for the ones still flying.", "Yuki Tanaka", 8.40),
    ("pets", "gpr", "1", "Mossy Mochi", "Common", "Pet - Plant", "1", "1/2", "When Mossy Mochi is fed, it grows +1/+1.", "Soft, green and always snacking.", "Pia Lindqvist", 0.05),
    ("pets", "gpr", "2", "Pebble Pup", "Common", "Pet - Mineral", "1", "2/1", "Pebble Pup can play fetch (tap to return a card from discard).", "Rolls over for anyone with a snack.", "Pia Lindqvist", 0.05),
    ("pets", "gpr", "3", "Sunny Snail", "Common", "Pet - Bug", "2", "1/3", "Slow. Gains +0/+2 while it is sunny.", "Never late - the day just starts when it arrives.", "Omar Selim", 0.06),
    ("pets", "gpr", "4", "Dewdrop Duck", "Common", "Pet - Bird", "2", "2/2", "Splash: Tap target pet.", "Brings its own puddle.", "Omar Selim", 0.06),
    ("pets", "gpr", "5", "Clover Cat", "Uncommon", "Pet - Beast", "3", "2/3", "Lucky: Once per turn, reroll a coin flip.", "Found four leaves. Wanted a nap anyway.", "Pia Lindqvist", 0.25),
    ("pets", "gpr", "6", "Bramble Bunny", "Uncommon", "Pet - Beast", "2", "2/2", "Quick. Bramble Bunny cannot be blocked by pets with power 1.", "Thorns outside, marshmallow inside.", "Omar Selim", 0.22),
    ("pets", "gpr", "7", "Lantern Moth", "Rare", "Pet - Bug", "3", "2/2", "Flying. When Lantern Moth enters, look at the top card of your deck.", "Follows the porch light home.", "Pia Lindqvist", 1.10),
    ("pets", "gpr", "8", "Honeybee Knight", "Rare", "Pet - Warrior", "4", "3/3", "Sting: When Honeybee Knight deals damage, tap that pet.", "Sworn to the hive, armed with a very small lance.", "Omar Selim", 1.30),
    ("pets", "gpr", "9", "Grandpa Toadstool", "Rare", "Pet - Plant", "3", "1/4", "Your other Plants get +1/+1.", "Has opinions about everything, mostly rain.", "Pia Lindqvist", 1.00),
    ("pets", "gpr", "10", "Rainbow Koi", "Mythic", "Pet - Fish", "5", "5/5", "Splash: Return all pets to their owners' hands.", "Every ripple has a different colour.", "Omar Selim", 7.50),
]


DEMO_COLORS = {"akg": "R", "tdb": "U", "fct": "W", "dsc": "B", "gpr": "G"}
DEMO_SECOND = {"R": "W", "U": "G", "W": "U", "B": "R", "G": "W"}
DEMO_RULES = {
    "emberfall": """## The goal
Reduce your opponent's Realm from 20 to 0. Each player starts with a Realm of 20 and a hand of 5 cards.
## A turn
- Wake: untap everything you control and gain 1 Ember.
- Draw: draw a card.
- Play: put creatures, structures and spells into play by paying their cost in Ember.
- Strike: attack with your creatures. Blocked creatures fight; unblocked creatures hit the Realm.
- Rest: discard down to 7 cards.
## Keywords
- Haste: can attack the turn it arrives.
- Guard: can block any creature, even a flying one.
- Trample: excess damage goes to the Realm.
- Hexproof: cannot be chosen by your opponent's cards.
## Building a deck
40 cards or more, no more than 3 copies of the same card (1 of each Mythic).""",
    "nova": """## The goal
Destroy the opposing flagship or hold 12 Sectors at the end of your turn.
## A turn
- Refuel: add 1 credit to your pool.
- Deploy: pay credits to deploy ships, crew, gear and events.
- Manoeuvre: move ships between sectors; Sprint ships may move after attacking.
- Engage: ships in the same sector fight, damage is dealt at the same time.
## Keywords
- Shield N: prevent the next N damage to this ship each turn.
- Boarding N: when this unit attacks a ship, deal N extra damage.
- Stealth: cannot be targeted until it attacks.
## Building a deck
50 cards, one Fleet card allowed, no more than 4 copies of any card.""",
    "pets": """## The goal
Be the first trainer to collect 6 Charm tokens by winning friendly Contests.
## A turn
- Feed: feed one of your pets to grow it.
- Play: bring pets and treats into the Garden.
- Contest: choose one of your pets to enter a Contest against an opposing pet; the higher total wins a Charm.
## Keywords
- Splash: a small effect that happens when the pet enters.
- Lucky: once per turn you may flip the coin again.
- Slow: this pet enters tapped.
## Building a deck
30 cards, no more than 3 copies of any pet.""",
}
DEMO_UPDATES = [  # game, days ago, title, text
    ("emberfall", 12, "Errata: Sunscorch Wyrm", "The cost is now 5 (was 6). The ability is unchanged."),
    ("emberfall", 40, "Rules update 1.3", "Guard now also stops creatures with Haste on the turn they arrive. Examples added to the Strike step."),
    ("emberfall", 75, "New set announced: Tidebound", "A water-themed set with 10 new creatures, structures and spells."),
    ("nova", 8, "Errata: Nebula Cruiser", "Shield 2 now wears off at the end of the turn in which it triggered."),
    ("nova", 55, "Rules update 2.0", "Boarding is now written as a number (Boarding 1) and the Sprint wording is simplified."),
    ("pets", 20, "Errata: Pebble Pup", "Fetch can now return any card from your discard, not just pets."),
    ("pets", 90, "Welcome to Garden Party", "The first set is out - 10 new pets to collect and trade."),
]


def demo_colors(set_code, number, rarity, ctype):
    base = DEMO_COLORS.get(set_code, "")
    if ctype.split(" - ")[0] in ("Structure", "Gear"):
        return ""
    if rarity in ("Rare", "Mythic") and int(number) % 2 == 0:
        return base + DEMO_SECOND.get(base, "")
    return base


def seed_demo(conn):
    remove_demo(conn)
    for g in DEMO_GAMES:
        conn.execute("INSERT OR REPLACE INTO cg_games VALUES (?,?,?,?,1)", g)
        conn.execute("INSERT OR REPLACE INTO cg_text VALUES (?,?,?,1)", (g[0], "rules", DEMO_RULES.get(g[0], "")))
    for g, code, name, rel in DEMO_SETS:
        conn.execute("INSERT OR REPLACE INTO cg_sets VALUES (?,?,?,?,1)", (g, code, name, rel))
    for c in DEMO_CARDS:
        game, sc, num, name, rarity, ctype, cost, pt, rules, flavor, artist, price = c
        sub = ctype.split(" - ", 1)[1] if " - " in ctype else ""
        conn.execute("INSERT OR REPLACE INTO cg_cards (game, set_code, number, name, rarity, ctype, cost, pt, rules, flavor, artist, price, path, demo, cmc, colors, subtype) "
                     "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'',1,?,?,?)",
                     (game, sc, num, name, rarity, ctype, cost, pt, rules, flavor, artist, price, float(cost) if cost.isdigit() else None,
                      demo_colors(sc, num, rarity, ctype), sub))
    for game, ago, title, body in DEMO_UPDATES:
        d = time.strftime("%Y-%m-%d", time.localtime(time.time() - ago * 86400))
        conn.execute("INSERT OR IGNORE INTO cg_updates (game, date, title, body, url, source, guid, demo) VALUES (?,?,?,?,?,?,?,1)", (game, d, title, body, "", "demo", f"demo:{title}"))
    rnd = random.Random(5)
    for c in DEMO_CARDS:  # pretend the collection is partly complete
        if rnd.random() < 0.55:
            conn.execute("INSERT OR REPLACE INTO cg_owned VALUES (?,?,?,?,?)",
                         (c[0], c[1], c[2], 1 if (c[4] in ("Rare", "Mythic") and rnd.random() < 0.3) else 0, rnd.choice((1, 1, 1, 2, 3))))
    conn.commit()


def remove_demo(conn):
    conn.execute("DELETE FROM cg_owned WHERE game IN (SELECT id FROM cg_games WHERE demo=1)")
    for t in ("cg_cards", "cg_sets", "cg_games", "cg_text", "cg_updates"):
        conn.execute(f"DELETE FROM {t} WHERE demo=1")
    conn.commit()


def game_folder(conn, game):
    return get_setting(conn, "cards_folder" if game == "mtg" else f"cards_folder_{game}") or str(HERE / "cards" / game)


def scan_card_folder(conn, game, say, progress):
    """Read the card images a downloader saved (SET - name/number_card name.jpg) into the hub's tables."""
    folder = game_folder(conn, game)
    if not os.path.isdir(folder):
        say(f"No card folder yet for {DOWNLOADERS[game]['label']} ({folder}).")
        return 0
    conn.execute("DELETE FROM cg_cards WHERE game=? AND demo=0", (game,))
    conn.execute("DELETE FROM cg_sets WHERE game=? AND demo=0", (game,))
    sets, rows, n, backs = {}, [], 0, {}
    for dirpath, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith("_")]
        base = os.path.basename(dirpath)
        if base.lower() == "alternate art":
            base = os.path.basename(os.path.dirname(dirpath))
        for fn in files:
            if os.path.splitext(fn)[1].lower() not in CARD_IMG_EXT:
                continue
            stem, ext = os.path.splitext(fn)
            if stem.lower().endswith("_back"):          # the other face of a double-faced card
                binfo = parse_card_file(os.path.join(dirpath, stem[:-5] + ext))
                if binfo:
                    backs[(binfo[1], binfo[2])] = os.path.join(dirpath, fn)
                continue
            info = parse_card_file(os.path.join(dirpath, fn))
            if not info:
                continue
            _cid, code, number, name = info
            if " - " in base:
                sets.setdefault(code, base.split(" - ", 1)[1].strip())
            else:
                sets.setdefault(code, base)
            rows.append((game, code, number, name, os.path.join(dirpath, fn)))
            n += 1
            if n % 2000 == 0:
                progress(f"Reading card folder ... {n:,} cards")
    conn.executemany("INSERT OR REPLACE INTO cg_cards (game, set_code, number, name, rarity, ctype, cost, pt, rules, flavor, artist, price, path, demo) "
                     "VALUES (?,?,?,?,'','','','','','','',NULL,?,0)", rows)
    conn.executemany("INSERT OR REPLACE INTO cg_sets VALUES (?,?,?,'',0)", [(game, c, nm) for c, nm in sets.items()])
    conn.executemany("UPDATE cg_cards SET back_path=? WHERE game=? AND set_code=? AND number=?", [(bp, game, sc, num) for (sc, num), bp in backs.items()])
    spec = DOWNLOADERS[game]
    conn.execute("INSERT OR REPLACE INTO cg_games VALUES (?,?,?,?,0)", (game, spec["label"], "Card images downloaded to this PC", spec["color"]))
    if game == "mtg":  # prices, rarity and set details from the Scryfall data the scanner read
        conn.execute("UPDATE cg_cards SET rarity=COALESCE((SELECT rarity FROM card_meta m WHERE m.id=cg_cards.set_code||':'||cg_cards.number),''),"
                     "ctype=COALESCE((SELECT type_line FROM card_meta m WHERE m.id=cg_cards.set_code||':'||cg_cards.number),''),"
                     "price=(SELECT eur FROM card_meta m WHERE m.id=cg_cards.set_code||':'||cg_cards.number),"
                     "cmc=(SELECT cmc FROM card_meta m WHERE m.id=cg_cards.set_code||':'||cg_cards.number),"
                     "colors=(SELECT colors FROM card_meta m WHERE m.id=cg_cards.set_code||':'||cg_cards.number),"
                     "name=COALESCE((SELECT name FROM card_meta m WHERE m.id=cg_cards.set_code||':'||cg_cards.number), name) WHERE game='mtg' AND demo=0")
        conn.execute("UPDATE cg_cards SET subtype=CASE WHEN instr(ctype, '\u2014') > 0 THEN trim(substr(ctype, instr(ctype, '\u2014') + 1)) ELSE '' END WHERE game='mtg' AND demo=0")
        conn.execute("UPDATE cg_sets SET name=COALESCE((SELECT set_name FROM card_meta m WHERE m.set_code=cg_sets.code LIMIT 1), name),"
                     "released=COALESCE((SELECT released FROM card_meta m WHERE m.set_code=cg_sets.code LIMIT 1), '') WHERE game='mtg' AND demo=0")
    conn.commit()
    say(f"{spec['label']}: {n:,} cards in {len(sets)} sets.")
    if (jl(get_setting(conn, "own_pic_folders"), {}) or {}).get(game):
        reimport_own_pictures(conn, game, say, progress)
    return n


def _webp_folder(folder, replace, lossless, quality, say, progress):
    """Turn every JPG / PNG card picture under `folder` into WebP (same name, .webp). Resumable: a picture that already has its .webp is not
    converted again. With `replace` the original is deleted - only after its WebP has been written and read back."""
    if PILImage is None:
        say("Pillow is missing:  python -m pip install pillow   (then restart Nightvault)")
        return
    files = []
    for root, _d, names in os.walk(folder):
        for n in names:
            if os.path.splitext(n)[1].lower() in (".jpg", ".jpeg", ".png"):
                files.append(os.path.join(root, n))
    if not files:
        say("No JPG or PNG pictures found in that folder.")
        return
    total = len(files)
    say(f"Converting {total:,} pictures to WebP ({'lossless' if lossless else 'quality ' + str(quality)}), "
        f"{'originals are deleted afterwards' if replace else 'originals are kept'} ...")
    st = dict(done=0, made=0, skipped=0, failed=0, before=0, after=0)
    lock = threading.Lock()

    def one(src):
        if STOP.is_set():
            return
        dst = os.path.splitext(src)[0] + ".webp"
        try:
            size_in = os.path.getsize(src)
            if os.path.exists(dst) and os.path.getsize(dst) > 0:
                kind = "skipped"
                size_out = os.path.getsize(dst)
            else:
                with PILImage.open(src) as im:
                    im.load()
                    if im.mode not in ("RGB", "RGBA"):
                        im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" and "transparency" in im.info else "RGB")
                    tmp = dst + ".part"
                    if lossless:
                        im.save(tmp, "WEBP", lossless=True, quality=100, method=4)
                    else:
                        im.save(tmp, "WEBP", quality=quality, method=4)
                with PILImage.open(tmp) as chk:
                    chk.load()          # read it back: a broken file is never allowed to replace the original
                os.replace(tmp, dst)
                kind, size_out = "made", os.path.getsize(dst)
            if replace:
                os.remove(src)
            with lock:
                st[kind] += 1
                st["before"] += size_in
                st["after"] += size_out
        except Exception as e:
            try:
                os.remove(dst + ".part")
            except OSError:
                pass
            with lock:
                st["failed"] += 1
                if st["failed"] <= 5:
                    say(f"Could not convert {os.path.basename(src)}: {e}")
        finally:
            with lock:
                st["done"] += 1
                if st["done"] % 25 == 0 or st["done"] == total:
                    progress(f"WebP {st['done']:,} / {total:,} - {st['before'] / 1048576:,.0f} MB -> {st['after'] / 1048576:,.0f} MB")

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, min(8, (os.cpu_count() or 2) - 1))) as ex:
        list(ex.map(one, files))
    say(f"WebP: {st['made']:,} made, {st['skipped']:,} already done, {st['failed']:,} failed. "
        f"{st['before'] / 1073741824:,.2f} GB -> {st['after'] / 1073741824:,.2f} GB"
        f"{' (saved ' + format((st['before'] - st['after']) / 1073741824, ',.2f') + ' GB)' if st['before'] > st['after'] else ''}.")
    if STOP.is_set():
        say("Stopped - run it again to continue where it was.")


def job_to_webp(game, folder, replace, lossless, quality):
    def run(conn, say, progress):
        _webp_folder(folder, replace, lossless, quality, say, progress)
        if game in DOWNLOADERS and os.path.abspath(folder) == os.path.abspath(game_folder(conn, game)):
            scan_card_folder(conn, game, say, progress)
    return run


def _has_webp(folder):
    for root, _d, names in os.walk(folder):
        if any(n.lower().endswith(".webp") for n in names):
            return True
    return False


LEGACY_DEFAULT = {"wow", "dbzccg", "dbgt", "swccg", "dbz"}          # games that are no longer printed (all other CCG Trader games too)


def is_legacy(conn, game):
    """True for games marked "legacy / no longer in print": 'Check for new cards' leaves them alone. The owner's marks win over the defaults."""
    marks = jl(get_setting(conn, "legacy_games"), {}) or {}
    if game in marks:
        return bool(marks[game])
    return game in LEGACY_DEFAULT or game.startswith("ccgt")


def job_cards_check(keys, webp, big, lossless):
    """'Check for new cards': for every game in `keys` that is not legacy, refresh its set list and download only the sets that are not on disk yet."""
    def run(conn, say, progress):
        sync_downloaders(conn)
        ongoing = [k for k in keys if k in DOWNLOADERS and not is_legacy(conn, k)]
        skipped = [DOWNLOADERS[k]["label"] for k in keys if k in DOWNLOADERS and is_legacy(conn, k)]
        if skipped:
            say(f"Legacy games left alone: {', '.join(skipped[:12])}{' ...' if len(skipped) > 12 else ''}")
        if not ongoing:
            say("No ongoing games ticked.")
            return
        job_cards_listsets(ongoing)(conn, say, progress)
        for i, game in enumerate(ongoing, 1):
            if STOP.is_set():
                break
            spec = DOWNLOADERS[game]
            have = {str(r["code"]).lower() for r in conn.execute("SELECT code FROM cg_sets WHERE game=? AND demo=0", (game,))}
            new = [r["code"] for r in conn.execute("SELECT code FROM cg_setlist WHERE game=? ORDER BY released", (game,)) if str(r["code"]).lower() not in have]
            say(f"[{i}/{len(ongoing)}] {spec['label']}: {len(new)} new set{'s' if len(new) != 1 else ''}" if new else f"[{i}/{len(ongoing)}] {spec['label']}: nothing new")
            if not new:
                continue
            quality = spec["quality"][-1] if big and spec.get("quality") else ""
            job_cards_download(game, new, quality)(conn, say, progress)
            out = game_folder(conn, game)
            if webp and not STOP.is_set() and os.path.isdir(out):
                _webp_folder(out, True, lossless, 90, say, progress)
                scan_card_folder(conn, game, say, progress)
        say("Stopped - run it again to continue." if STOP.is_set() else "Check finished.")
    return run


def job_cards_many(keys, webp, big, lossless):
    """Download every set of each game in `keys`, one game after the other. With `webp` each finished game is converted to WebP
    (originals deleted after the WebP is checked) before the next game starts, so the disk never holds all the big originals."""
    def run(conn, say, progress):
        sync_downloaders(conn)
        todo = [k for k in keys if k in DOWNLOADERS]
        for i, game in enumerate(todo, 1):
            if STOP.is_set():
                break
            spec = DOWNLOADERS[game]
            out = game_folder(conn, game)
            say(f"[{i}/{len(todo)}] {spec['label']}")
            if webp and spec.get("script") and not spec.get("api") and os.path.isdir(out) and _has_webp(out):
                say(f"{spec['label']}: already converted to WebP - skipped here (its own script would download everything again). Use the game's own Download button for new sets.")
                continue
            quality = spec["quality"][-1] if big and spec.get("quality") else ""
            job_cards_download(game, [], quality)(conn, say, progress)
            if STOP.is_set():
                break
            if webp and os.path.isdir(out):
                _webp_folder(out, True, lossless, 90, say, progress)
                scan_card_folder(conn, game, say, progress)
        say("Stopped - run it again to continue where it was." if STOP.is_set() else "All ticked games are done.")
    return run


def job_cards_download(game, sets, quality):
    def run(conn, say, progress):
        spec = DOWNLOADERS[game]
        if (spec.get("api") or {}).get("kind") == "tcgdata":
            out = game_folder(conn, game)
            os.makedirs(out, exist_ok=True)
            say(f"Downloading {spec['label']} cards to {out} ...")
            try:
                tdata.OPPP_KEY = (get_setting(conn, "oppp_key") or "").strip()
                tdata.download(spec["api"]["key"], out, sets, say, progress, STOP)
            except tdata.DataError as e:
                say(f"{spec['label']}: {e}")
                return
            scan_card_folder(conn, game, say, progress)
            tdata.apply_meta(conn, game, out)
            if STOP.is_set():
                say("Download stopped - run it again to continue where it was.")
            return
        if (spec.get("api") or {}).get("kind") == "ccgtrader":
            out = game_folder(conn, game)
            os.makedirs(out, exist_ok=True)
            say(f"Downloading {spec['label']} card pictures from CCG Trader to {out} ...")
            try:
                ccgt.download(spec["api"]["gid"], out, sets, say, progress, STOP)
            except ccgt.CcgtError as e:
                say(f"{spec['label']}: {e}")
                return
            scan_card_folder(conn, game, say, progress)
            ccgt.apply_meta(conn, game, out)
            if STOP.is_set():
                say("Download stopped - run it again to continue where it was.")
            return
        if spec.get("api"):
            out = game_folder(conn, game)
            os.makedirs(out, exist_ok=True)
            say(f"Downloading {spec['label']} cards to {out} ...")
            try:
                cardsrc.download(spec["api"], out, sets, say, progress, STOP)
            except cardsrc.SrcError as e:
                say(f"{spec['label']}: {e}")
                return
            if STOP.is_set():
                say("Download stopped - run it again to continue.")
            else:
                scan_card_folder(conn, game, say, progress)
            return
        script = HERE / spec["script"]
        if not script.exists():
            say(f"{spec['script']} must be in the same folder as vault.py to download {spec['label']} cards.")
            return
        out = game_folder(conn, game)
        cmd = [sys.executable, "-u", str(script), "--output", out]
        if sets:
            cmd += ["--sets", *sets]
        if quality and quality in spec["quality"]:
            cmd += ["--quality", quality]
        say(f"Downloading {spec['label']} cards to {out} ...")
        env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
        proc = subprocess.Popen(cmd, cwd=str(HERE), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        buf, fd = b"", proc.stdout.fileno()
        while True:
            if STOP.is_set():
                proc.terminate()
                say("Download stopped - run it again to continue.")
                break
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            buf += chunk
            parts = re.split(rb"[\r\n]+", buf)
            buf = parts.pop()
            for seg in parts:
                line = seg.decode("utf-8", "replace").strip()
                if line:
                    progress(line[:110])
                    if "%|" not in line and not line.startswith("Traceback"):
                        say(line)
        proc.wait()
        if not STOP.is_set():
            if game == "mtg" and get_setting(conn, "cards_folder") != out:
                put_setting(conn, "cards_folder", out)
            scan_card_folder(conn, game, say, progress)
    def run_all(conn, say, progress):
        run(conn, say, progress)
        try:
            prices_apply(conn, game)
        except Exception:
            traceback.print_exc()
    return run_all


_SETLINE = re.compile(r"^\s*(\S+)\s+(?:\[[^\]]*\]\s+)?(.*?)\s+\(([^)]*)\)\s*$")


def parse_set_list(text):
    """Rows (code, name, released, total) from what a downloader prints for --list-sets."""
    out = []
    for line in text.splitlines():
        m = _SETLINE.match(line)
        if not m:
            continue
        code, name, extra = m.group(1).lower(), m.group(2).strip(), m.group(3)
        d = re.search(r"\d{4}-\d{2}-\d{2}", extra)
        n = re.search(r"(\d[\d,]*)\s+cards", extra)
        if not name or code.endswith(":"):
            continue
        out.append((code, name, d.group(0) if d else "", int(n.group(1).replace(",", "")) if n else 0))
    return out


def job_cards_listsets(games):
    def run(conn, say, progress):
        for game in games:
            spec = DOWNLOADERS[game]
            if (spec.get("api") or {}).get("kind") == "tcgdata":
                progress(f"Getting the {spec['label']} set list ...")
                try:
                    rows = tdata.list_sets(spec["api"]["key"])
                except tdata.DataError as e:
                    say(f"{spec['label']}: {e}")
                    continue
                conn.execute("DELETE FROM cg_setlist WHERE game=?", (game,))
                conn.executemany("INSERT OR REPLACE INTO cg_setlist VALUES (?,?,?,?,?)", [(game, *x) for x in rows])
                conn.commit()
                say(f"{spec['label']}: {len(rows):,} sets listed - nothing was downloaded.")
                continue
            if (spec.get("api") or {}).get("kind") == "ccgtrader":
                progress(f"Asking CCG Trader for the {spec['label']} set list ...")
                try:
                    rows = ccgt.list_sets(spec["api"]["gid"])
                except ccgt.CcgtError as e:
                    say(f"{spec['label']}: {e}")
                    continue
                conn.execute("DELETE FROM cg_setlist WHERE game=?", (game,))
                conn.executemany("INSERT OR REPLACE INTO cg_setlist VALUES (?,?,?,?,?)", [(game, *x) for x in rows])
                conn.commit()
                say(f"{spec['label']}: {len(rows):,} sets listed - nothing was downloaded.")
                continue
            if spec.get("api"):
                progress(f"Asking for the {spec['label']} set list ...")
                try:
                    rows = cardsrc.list_sets(spec["api"])
                except cardsrc.SrcError as e:
                    say(f"{spec['label']}: {e}")
                    continue
                conn.execute("DELETE FROM cg_setlist WHERE game=?", (game,))
                conn.executemany("INSERT OR REPLACE INTO cg_setlist VALUES (?,?,?,?,?)", [(game, *x) for x in rows])
                conn.commit()
                say(f"{spec['label']}: {len(rows):,} sets listed - nothing was downloaded.")
                continue
            script = HERE / spec["script"]
            if not script.exists():
                say(f"{spec['label']}: {spec['script']} is not in the Nightvault folder.")
                continue
            progress(f"Asking for the {spec['label']} set list ...")
            env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
            try:
                r = subprocess.run([sys.executable, "-u", str(script), "--list-sets"], cwd=str(HERE), env=env, capture_output=True,
                                   stdin=subprocess.DEVNULL, timeout=180)
                text = r.stdout.decode("utf-8", "replace")
            except subprocess.TimeoutExpired:
                say(f"{spec['label']}: the source did not answer in time (it may be blocked on this network).")
                continue
            rows = parse_set_list(text)
            if not rows:
                tail = (r.stderr.decode("utf-8", "replace").strip().splitlines() or text.strip().splitlines() or ["no answer"])[-1][:140]
                say(f"{spec['label']}: no sets found ({tail}).")
                continue
            conn.execute("DELETE FROM cg_setlist WHERE game=?", (game,))
            conn.executemany("INSERT OR REPLACE INTO cg_setlist VALUES (?,?,?,?,?)", [(game, *x) for x in rows])
            conn.commit()
            say(f"{spec['label']}: {len(rows):,} sets listed - nothing was downloaded.")
    return run


def job_cards_rescan(game):
    def run(conn, say, progress):
        scan_card_folder(conn, game, say, progress)
    return run


def hub_owned(conn, game):
    """{(set, number): quantity} - Magic uses the scanner's list, the other games their own."""
    out = {}
    if game == "mtg":
        for r in conn.execute("SELECT id, SUM(qty) q FROM card_owned GROUP BY id"):
            sc, _, num = r["id"].partition(":")
            out[(sc, num)] = r["q"]
    else:
        for r in conn.execute("SELECT set_code, number, SUM(qty) q FROM cg_owned WHERE game=? GROUP BY set_code, number", (game,)):
            out[(r["set_code"], r["number"])] = r["q"]
    return out


OFFICIAL_LINKS = {   # top-level official pages only (exact rulebook links can be added by the user per game)
    "mtg": [("Magic: rules and documents (official)", "https://magic.wizards.com/en/rules"), ("Scryfall - cards, sets and rulings", "https://scryfall.com")],
    "lorcana": [("Disney Lorcana (official site)", "https://www.disneylorcana.com"), ("Lorcast - card database", "https://lorcast.com")],
    "riftbound": [("Riftbound (official site)", "https://riftbound.leagueoflegends.com"), ("Riftcodex - card database", "https://riftcodex.com")],
    "swu": [("Star Wars: Unlimited (official site)", "https://starwarsunlimited.com"), ("SWU-DB - card database", "https://swudb.com")],
}
DOC_EXT = {".pdf", ".txt", ".md", ".html", ".htm", ".png", ".jpg", ".jpeg"}


def downloader_info(conn, game):
    spec = DOWNLOADERS[game]
    return dict(game=game, label=spec["label"], available=bool(spec.get("api")) or (HERE / spec["script"]).exists(), script=spec["script"] or "", api=bool(spec.get("api")),
                quality=spec["quality"], hint=spec["hint"], folder=game_folder(conn, game))


def hub_games(conn):
    out = []
    for g in conn.execute("SELECT * FROM cg_games ORDER BY demo, name"):
        n_sets = conn.execute("SELECT COUNT(*) FROM cg_sets WHERE game=?", (g["id"],)).fetchone()[0]
        n_cards = conn.execute("SELECT COUNT(*) FROM cg_cards WHERE game=?", (g["id"],)).fetchone()[0]
        owned = hub_owned(conn, g["id"])
        out.append(dict(id=g["id"], name=g["name"], blurb=g["blurb"], color=g["color"], demo=bool(g["demo"]), sets=n_sets,
                        cards=n_cards, owned_unique=len(owned), owned_total=sum(owned.values()), empty=False))
    have = {g["id"] for g in out}
    for k, v in DOWNLOADERS.items():     # games that can be downloaded appear as tiles too, so their download lives on their own page
        if k not in have:
            out.insert(len([g for g in out if not g["demo"]]), dict(id=k, name=v["label"], blurb="No cards yet - open it to download them.", color=v["color"],
                                                                      demo=False, sets=0, cards=0, owned_unique=0, owned_total=0, empty=True))
    for g in out:
        g["downloadable"] = g["id"] in DOWNLOADERS
    return dict(games=out, demo=any(g["demo"] for g in out))


def mtg_set_types(conn):
    """{set code: Scryfall set type} - for grouping the Magic sets (main sets, Commander, Secret Lair ...). Kept for a month."""
    d = jl(get_setting(conn, "scry_set_types"), {}) or {}
    if (not d.get("types") or time.time() - (d.get("at") or 0) > 30 * 86400) and time.time() - (d.get("tried") or 0) > 86400:
        d["tried"] = time.time()
        try:
            j = json.loads(_fetch("https://api.scryfall.com/sets", 10))
            d = dict(at=time.time(), tried=time.time(), types={x["code"]: x.get("set_type", "") for x in j.get("data", [])})
        except Exception:
            pass
        put_setting(conn, "scry_set_types", json.dumps(d))
    return d.get("types") or {}


def hub_sets(conn, game):
    g = conn.execute("SELECT * FROM cg_games WHERE id=?", (game,)).fetchone()
    if g:
        info = dict(id=g["id"], name=g["name"], blurb=g["blurb"], color=g["color"], demo=bool(g["demo"]))
    elif game in DOWNLOADERS:
        spec = DOWNLOADERS[game]
        info = dict(id=game, name=spec["label"], blurb="No cards downloaded yet.", color=spec["color"], demo=False)
    else:
        raise KeyError("Unknown game")
    prices_ensure(conn, game)
    owned = hub_owned(conn, game)
    own_by_set = {}
    for (sc, _n), q in owned.items():
        o = own_by_set.setdefault(sc, [0, 0])
        o[0] += 1
        o[1] += q
    prev = {}
    for r in conn.execute("SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY set_code ORDER BY CAST(number AS INTEGER), number) rn "
                          "FROM cg_cards WHERE game=?) WHERE rn<=3", (game,)):
        prev.setdefault(r["set_code"], []).append(dict(number=r["number"], name=r["name"], rarity=r["rarity"] or "", ctype=r["ctype"] or "",
                                                        cost=r["cost"] or "", pt=r["pt"] or "", rules=r["rules"] or "", flavor=r["flavor"] or "",
                                                        artist=r["artist"] or "", image=bool(r["path"])))
    out, seen = [], set()
    listed = {r["code"]: r for r in conn.execute("SELECT * FROM cg_setlist WHERE game=?", (game,))}
    for st in conn.execute("SELECT s.code, s.name, s.released, (SELECT COUNT(*) FROM cg_cards c WHERE c.game=s.game AND c.set_code=s.code) n "
                           "FROM cg_sets s WHERE s.game=? ORDER BY s.released DESC, s.name", (game,)):
        o = own_by_set.get(st["code"], [0, 0])
        L = listed.get(st["code"].lower())
        seen.add(st["code"].lower())
        out.append(dict(code=st["code"], name=st["name"], released=st["released"] or (L["released"] if L else ""), cards=st["n"], owned=o[0], copies=o[1],
                        preview=prev.get(st["code"], []), total=max(L["total"] if L else 0, st["n"]), downloaded=True))
    for code, L in listed.items():
        if code not in seen:
            out.append(dict(code=code, name=L["name"], released=L["released"] or "", cards=0, owned=0, copies=0, preview=[], total=L["total"], downloaded=False))
    if game == "mtg":
        types = mtg_set_types(conn)
        for x in out:
            x["type"] = types.get(str(x["code"]).lower(), "")
    return dict(game=info, sets=out, downloader=downloader_info(conn, game) if game in DOWNLOADERS else None,
                own_folders=(jl(get_setting(conn, "own_pic_folders"), {}) or {}).get(game, []))


def hub_cards(conn, game, set_code):
    prices_ensure(conn, game)
    st = conn.execute("SELECT * FROM cg_sets WHERE game=? AND code=?", (game, set_code)).fetchone()
    if not st:
        raise KeyError("Unknown set")
    owned = hub_owned(conn, game)
    cards = []
    for r in conn.execute("SELECT * FROM cg_cards WHERE game=? AND set_code=? ORDER BY CAST(number AS INTEGER), number", (game, set_code)):
        cards.append(dict(number=r["number"], name=r["name"], rarity=r["rarity"] or "", ctype=r["ctype"] or "", cost=r["cost"] or "",
                          pt=r["pt"] or "", rules=r["rules"] or "", flavor=r["flavor"] or "", artist=r["artist"] or "", price=r["price"],
                          cmc=r["cmc"], colors=r["colors"] or "", subtype=r["subtype"] or "", image=bool(r["path"]), back=bool(r["back_path"]),
                          qty=owned.get((set_code, r["number"]), 0)))
    g = conn.execute("SELECT * FROM cg_games WHERE id=?", (game,)).fetchone()
    return dict(game=dict(id=g["id"], name=g["name"], color=g["color"], demo=bool(g["demo"])),
                set=dict(code=st["code"], name=st["name"], released=st["released"] or ""), cards=cards)


def hub_info(conn, game):
    g = conn.execute("SELECT * FROM cg_games WHERE id=?", (game,)).fetchone()
    if not g and game not in DOWNLOADERS:
        raise KeyError("Unknown game")
    text = lambda kind: (conn.execute("SELECT body FROM cg_text WHERE game=? AND kind=?", (game, kind)).fetchone() or [""])[0]
    return dict(
        name=g["name"] if g else DOWNLOADERS[game]["label"], demo=bool(g and g["demo"]), rules=text("rules"), notes=text("notes"),
        docs=[dict(id=r["id"], title=r["title"], path=r["path"] or "", url=r["url"] or "") for r in conn.execute("SELECT * FROM cg_docs WHERE game=? ORDER BY id", (game,))],
        updates=[dict(id=r["id"], date=r["date"] or "", title=r["title"], body=r["body"] or "", url=r["url"] or "", source=r["source"] or "")
                 for r in conn.execute("SELECT * FROM cg_updates WHERE game=? ORDER BY date DESC, id DESC LIMIT 80", (game,))],
        sources=[dict(id=r["id"], label=r["label"] or "", url=r["url"]) for r in conn.execute("SELECT * FROM cg_sources WHERE game=? ORDER BY id", (game,))],
        links=[dict(title=t, url=u) for t, u in OFFICIAL_LINKS.get(game, [])], auto=game in ("mtg", "lorcana"))


def _fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "Nightvault/0.1 (personal collection tracker)", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

# --------------------------------------------------------------------------- #
# Updates: the program checks the published copy of its own files (nightvault-pocket/pc/manifest.json) and can replace them.
# Only the files named in the manifest are touched, never your data and never the files listed in UPDATE_SKIP. Old files are saved first.
# --------------------------------------------------------------------------- #
UPDATE_BASE = os.environ.get("VAULT_UPDATE_BASE") or "https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/pc/"
UPDATE_BASES = [UPDATE_BASE] if os.environ.get("VAULT_UPDATE_BASE") else [UPDATE_BASE, "https://brokeuh.github.io/nightvault-pocket/pc/", "https://cdn.jsdelivr.net/gh/brokeuh/nightvault-pocket@main/pc/"]
UPDATE_SKIP = {"media_catalog.py", "media_online.py", "vault_cardsrc.py"}       # not published: never replaced


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _upd_name_ok(name):
    """Plain file names next to vault.py, plus fonts/<file> (the free fonts for the Card templates page)."""
    if not name or "\\" in name or name.startswith(".") or name in UPDATE_SKIP:
        return False
    if "/" in name:
        d, _, f = name.partition("/")
        return d == "fonts" and f and "/" not in f and not f.startswith(".")
    return True


def _upd_manifest():
    """Try each download address in turn -> (manifest, base). Some networks (work PCs) block one of them."""
    errs = []
    for base in UPDATE_BASES:
        try:
            return json.loads(_fetch(base + "manifest.json", 20)), base
        except Exception as e:
            errs.append(f"{base.split('/')[2]}: {type(e).__name__}: {e}")
    raise ValueError("No download address answered - " + " | ".join(errs) + ". Use 'Update from a zip file' instead.")


def update_check():
    """-> dict(available, files=[names that differ], version, notes). Raises on network problems."""
    man, base = _upd_manifest()
    changed = []
    for f in man.get("files") or []:
        name = str(f.get("name") or "")
        if not _upd_name_ok(name):
            continue
        local = HERE / name
        if not local.exists() or _sha256(local) != f.get("sha256"):
            changed.append(name)
    return dict(available=bool(changed), files=changed, version=man.get("version", ""), notes=man.get("notes", []), build=BUILD, source=base.split("/")[2])


def _upd_install(new):
    """new = {name: bytes}. Keeps the old files in update_backup/<time>/ then puts the new ones in place."""
    for name, data in new.items():
        if name.endswith(".py"):
            try:
                compile(data, name, "exec")
            except SyntaxError as e:
                raise ValueError(f"{name} from the update is broken ({e.msg}) - nothing was changed.")
    backup = HERE / "update_backup" / time.strftime("%Y%m%d-%H%M%S")
    backup.mkdir(parents=True, exist_ok=True)
    for name, data in new.items():
        target = HERE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            (backup / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup / name)
        tmp = HERE / (name + ".new")
        tmp.write_bytes(data)
        os.replace(tmp, target)
    return dict(updated=sorted(new), backup=str(backup))


def update_apply():
    """Download the changed files, check them, keep the old ones in update_backup/<time>/, then put the new ones in place."""
    man, base = _upd_manifest()
    want = {f["name"]: f["sha256"] for f in man.get("files") or [] if _upd_name_ok(f.get("name") or "")}
    todo = {n: h for n, h in want.items() if not (HERE / n).exists() or _sha256(HERE / n) != h}
    if not todo:
        return dict(updated=[], backup="")
    new = {}
    for name, sha in todo.items():
        err = ""
        for b in [base] + [x for x in UPDATE_BASES if x != base]:       # the other addresses may be a little behind, so the checksum decides
            try:
                data = _fetch(b + urllib.parse.quote(name), 120)
            except Exception as e:
                err = f"{type(e).__name__}: {e}"; continue
            if hashlib.sha256(data).hexdigest() == sha:
                new[name] = data; break
            err = "downloaded file did not match"
        else:
            raise ValueError(f"{name} did not download correctly ({err}) - nothing was changed. Try again, or use 'Update from a zip file'.")
    return _upd_install(new)


def update_zip(blob):
    """Update from Nightvault-PC-latest.zip: the files inside (with the manifest checksums when it has one)."""
    import zipfile, io
    try:
        z = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise ValueError("That is not a zip file.")
    infos = [i for i in z.infolist() if not i.is_dir()]
    names = [i.filename.replace("\\", "/") for i in infos]
    top = {n.split("/")[0] for n in names if "/" in n}
    strip = len(top) == 1 and all("/" in n for n in names) and "fonts" not in top      # the zip has one folder around everything
    members = {(n.split("/", 1)[1] if strip else n): i for n, i in zip(names, infos)}
    man = {}
    if "manifest.json" in members:
        man = {f["name"]: f["sha256"] for f in json.loads(z.read(members["manifest.json"])).get("files") or []}
    if "vault.py" not in members and not man:
        raise ValueError("This zip does not look like Nightvault-PC-latest.zip.")
    new = {}
    for name, info in members.items():
        if name == "manifest.json" or not _upd_name_ok(name) or not (name.endswith((".py", ".html", ".ttf", ".txt"))):
            continue
        data = z.read(info)
        if man and name in man and hashlib.sha256(data).hexdigest() != man[name]:
            raise ValueError(f"{name} in the zip is damaged - nothing was changed.")
        if (HERE / name).exists() and _sha256(HERE / name) == hashlib.sha256(data).hexdigest():
            continue
        new[name] = data
    if not new:
        return dict(updated=[], backup="")
    return _upd_install(new)


def update_restart():
    """Start the program again with the same arguments (the browser page reloads itself)."""
    def go():
        time.sleep(0.6)
        try:
            os.execv(sys.executable, [sys.executable] + sys.argv)
        except Exception:
            traceback.print_exc()
    threading.Thread(target=go, daemon=True).start()


def parse_feed(data):
    """Entries of an RSS or Atom feed -> [{title, url, date, text, guid}]."""
    root = ET.fromstring(data)
    out = []
    for e in root.iter():
        if _ln(e.tag) not in ("item", "entry"):
            continue
        get = lambda n: next((c for c in e if _ln(c.tag) == n), None)
        text = lambda n: (get(n).text or "").strip() if get(n) is not None else ""
        link = get("link")
        url = (link.get("href") or (link.text or "")).strip() if link is not None else ""
        when = text("pubDate") or text("published") or text("updated")
        day = ""
        try:
            day = parsedate_to_datetime(when).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            day = when[:10] if re.match(r"\d{4}-\d{2}-\d{2}", when) else ""
        body = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text("description") or text("summary") or text("content")))[:400].strip()
        out.append(dict(title=text("title"), url=url, date=day, text=body, guid=text("guid") or text("id") or url or text("title")))
    return out[:20]


def job_updates_refresh(game):
    def run(conn, say, progress):
        added, today = 0, time.strftime("%Y-%m-%d")

        def add(day, title, body, url, source, guid):
            return conn.execute("INSERT OR IGNORE INTO cg_updates (game, date, title, body, url, source, guid, demo) VALUES (?,?,?,?,?,?,?,0)",
                                (game, day or today, title, body, url, source, guid)).rowcount

        cutoff = time.strftime("%Y-%m-%d", time.localtime(time.time() - 60 * 86400))
        try:
            if game == "mtg":
                progress("Reading upcoming and recent sets from Scryfall ...")
                for st in json.loads(_fetch("https://api.scryfall.com/sets")).get("data", []):
                    if (st.get("released_at") or "") >= cutoff and st.get("set_type") not in ("token", "memorabilia", "minigame"):
                        added += add(st["released_at"], f"{st['name']} ({st['code'].upper()})",
                                     f"{st.get('set_type', '').replace('_', ' ').title()} - {st.get('card_count', '?')} cards", st.get("scryfall_uri", ""), "scryfall", "set:" + st["code"])
            elif game == "lorcana":
                progress("Reading upcoming and recent sets from Lorcast ...")
                js = json.loads(_fetch("https://api.lorcast.com/v0/sets"))
                for st in (js.get("results", []) if isinstance(js, dict) else js):
                    if (st.get("released_at") or "")[:10] >= cutoff:
                        added += add(st["released_at"][:10], f"{st['name']} ({st['code']})", "New set", "https://lorcast.com", "lorcast", "set:" + str(st["code"]))
        except Exception as e:
            say(f"Could not read the set list: {e}")
        for src in conn.execute("SELECT * FROM cg_sources WHERE game=?", (game,)).fetchall():
            try:
                progress(f"Reading {src['label'] or src['url']} ...")
                for it in parse_feed(_fetch(src["url"])):
                    added += add(it["date"], it["title"], it["text"], it["url"], src["label"] or "feed", it["guid"])
            except Exception as e:
                say(f"{src['label'] or src['url']}: {e}")
        conn.commit()
        say(f"Updates: {added} new entr{'y' if added == 1 else 'ies'}.")
    return run


def hub_change(conn, game, set_code, number, delta, foil):
    if game == "mtg":
        owned_change(conn, card_id(set_code, number), 1 if foil else 0, delta)
    else:
        row = conn.execute("SELECT qty FROM cg_owned WHERE game=? AND set_code=? AND number=? AND foil=?", (game, set_code, number, foil)).fetchone()
        qty = max(0, (row["qty"] if row else 0) + delta)
        if qty:
            conn.execute("INSERT OR REPLACE INTO cg_owned VALUES (?,?,?,?,?)", (game, set_code, number, foil, qty))
        else:
            conn.execute("DELETE FROM cg_owned WHERE game=? AND set_code=? AND number=? AND foil=?", (game, set_code, number, foil))
        conn.commit()
    return hub_owned(conn, game).get((set_code, number), 0)


# --------------------------------------------------------------------------- #
# 3D models (STL / OBJ / 3MF): size, tags, a picture for the grid, and the data for the 3D viewer
# --------------------------------------------------------------------------- #
MODEL_EXT = {".stl", ".obj", ".3mf"}
MAX_TRIS = 1_500_000
GENERIC_TAGS = {"stl", "stls", "obj", "3mf", "3d", "model", "models", "file", "files", "print", "prints", "printing", "printable", "download",
                "downloads", "final", "fixed", "support", "supports", "supported", "unsupported", "presupported", "mesh", "meshes", "zip", "new",
                "folder", "the", "and", "for", "with", "part", "parts", "pack", "set", "stuff", "misc", "other", "thingiverse", "version"}


def _need_numpy():
    if np is None:
        raise ValueError("The 3D features need numpy:  python -m pip install numpy   (then restart Nightvault)")


def load_mesh(path):
    """The triangles of a model as a float32 array of shape (n, 3, 3)."""
    _need_numpy()
    ext = os.path.splitext(path)[1].lower()
    if ext == ".stl":
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(84)
        if len(head) == 84:
            n = struct.unpack("<I", head[80:84])[0]
            if n > 0 and 84 + 50 * n == size:                         # binary STL
                dt = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
                return np.ascontiguousarray(np.fromfile(path, dtype=dt, count=n, offset=84)["v"])
        with open(path, "r", errors="ignore") as f:                    # ASCII STL
            nums = re.findall(r"vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)", f.read())
        a = np.array(nums, dtype=np.float32)
        return a[: len(a) // 3 * 3].reshape(-1, 3, 3)
    if ext == ".obj":
        verts, tris = [], []
        with open(path, "r", errors="ignore") as f:
            for line in f:
                if line.startswith("v "):
                    verts.append([float(x) for x in line.split()[1:4]])
                elif line.startswith("f "):
                    idx = [int(tok.split("/")[0]) for tok in line.split()[1:]]
                    idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
                    tris += [(idx[0], idx[k], idx[k + 1]) for k in range(1, len(idx) - 1)]
        if not tris:
            raise ValueError("This OBJ file has no faces")
        return np.array(verts, dtype=np.float32)[np.array(tris, dtype=np.int64)]
    if ext == ".3mf":
        with zipfile.ZipFile(path) as z:
            name = next((n for n in z.namelist() if n.lower().endswith(".model")), None)
            if not name:
                raise ValueError("This 3MF file has no model data")
            root = ET.fromstring(z.read(name))
        parts = []
        for mesh in (e for e in root.iter() if _ln(e.tag) == "mesh"):
            v = t = None
            for child in mesh:
                if _ln(child.tag) == "vertices":
                    v = np.array([[float(x.get("x")), float(x.get("y")), float(x.get("z"))] for x in child], dtype=np.float32)
                elif _ln(child.tag) == "triangles":
                    t = np.array([[int(x.get("v1")), int(x.get("v2")), int(x.get("v3"))] for x in child], dtype=np.int64)
            if v is not None and t is not None and len(t):
                parts.append(v[t])
        if not parts:
            raise ValueError("This 3MF file has no mesh")
        return np.concatenate(parts)
    raise ValueError("Unsupported model type")


def model_tags(path, dims=None):
    folders = list(Path(path).parts)[-5:-1]
    out = []
    for part in folders + [Path(path).stem]:
        for w in re.split(r"[\s_\-\.\(\)\[\],+]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", part)):
            w = w.lower().strip()
            if len(w) >= 3 and w not in GENERIC_TAGS and not re.fullmatch(r"v?\d+([.,]\d+)?", w) and w not in out and not re.fullmatch(r"[a-z]:?", w):
                out.append(w)
    if dims:
        big = max(dims)
        out.append("small" if big < 40 else "medium" if big < 130 else "large")
    return out[:10]


def model_info(path):
    tris = load_mesh(path)
    flat = tris.reshape(-1, 3)
    lo, hi = flat.min(0), flat.max(0)
    dims = [float(x) for x in (hi - lo)]
    with open(path, "rb") as f:
        head = f.read(84)
    kind = {".stl": "STL (binary)" if len(head) == 84 and 84 + 50 * struct.unpack("<I", head[80:84])[0] == os.path.getsize(path) else "STL (text)",
            ".obj": "OBJ", ".3mf": "3MF"}[os.path.splitext(path)[1].lower()]
    return dict(source="file", poster="", url="", overview="", tagline="", genres=model_tags(path, dims),
                facts=[["Size (mm)", " × ".join(f"{d:.1f}" for d in dims)], ["Triangles", f"{len(tris):,}"], ["Format", kind],
                       ["File size", f"{os.path.getsize(path) / 1048576:.1f} MB"]], credits=[])


def render_model_png(tris, size=360):
    """A small shaded picture of a model (three-quarter view, Z up) for the grid."""
    _need_numpy()
    n = len(tris)
    if n > 120000:
        tris = tris[:: -(-n // 120000)]
    flat = tris.reshape(-1, 3)
    t = (tris - (flat.min(0) + flat.max(0)) / 2).astype(np.float32)
    yaw, pitch = math.radians(35), math.radians(26)
    cy_, sy_, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    x1 = t[..., 0] * cy_ - t[..., 1] * sy_
    y1 = t[..., 0] * sy_ + t[..., 1] * cy_
    z1 = t[..., 2]
    sx, sy = x1, y1 * sp + z1 * cp                               # screen position
    depth = (-y1 * cp + z1 * sp).mean(axis=1)                   # larger = nearer the camera
    p0, p1, p2 = (np.stack([x1, y1, z1], -1)[:, i] for i in range(3))
    nrm = np.cross(p1 - p0, p2 - p0)
    nrm /= (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9)
    light = np.array([-0.45, -0.55, 0.7], dtype=np.float32)
    light /= np.linalg.norm(light)
    cam = np.array([0.0, -cp, sp], dtype=np.float32)
    shade = np.clip(0.22 + 0.5 * np.abs(nrm @ light) + 0.4 * np.abs(nrm @ cam), 0, 1)
    span = max(sx.max() - sx.min(), sy.max() - sy.min(), 1e-6)
    sc = size * 2 * 0.86 / span
    ph = int(size * 1.4)                                           # portrait, like the tiles
    px = (sx - (sx.max() + sx.min()) / 2) * sc + size
    py = ph - (sy - (sy.max() + sy.min()) / 2) * sc
    order = np.argsort(depth)
    img = PILImage.new("RGB", (size * 2, ph * 2), (20, 23, 29))
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    base = np.array([168, 190, 222], dtype=np.float32)
    cols = (base[None, :] * shade[:, None]).astype(np.uint8)
    P = np.stack([px, py], -1)
    for i in order.tolist():
        d.polygon([tuple(P[i, 0]), tuple(P[i, 1]), tuple(P[i, 2])], fill=tuple(int(c) for c in cols[i]))
    out = io.BytesIO()
    img.resize((size, ph), PILImage.LANCZOS).save(out, "PNG")
    return out.getvalue()


def mesh_payload(path):
    tris = load_mesh(path)
    if len(tris) > MAX_TRIS:
        tris = tris[:: -(-len(tris) // MAX_TRIS)]
    flat = np.ascontiguousarray(tris.reshape(-1, 3), dtype=np.float32)
    return b"VMSH" + struct.pack("<I", len(tris)) + flat.min(0).tobytes() + flat.max(0).tobytes() + flat.tobytes()


def _demo_module():
    import importlib
    return importlib.import_module("vault_demo")


def job_demo_load(conn, say, progress):
    try:
        mod = _demo_module()
    except ImportError:
        say("vault_demo.py must be in the same folder as vault.py to load the demo.")
        return
    mod.load(sys.modules[__name__], conn, say, progress)


TIDY = {"src": None, "scan": None}


def _tidy_module():
    import importlib
    try:
        return importlib.import_module("vault_tidy")
    except ImportError:
        raise ValueError("vault_tidy.py must be in the same folder as vault.py to use Tidy up.")


def _tidy_plan(d, rescan=False):
    tm = _tidy_module()
    src = os.path.abspath((d.get("src") or "").strip().strip('"'))
    if not os.path.isdir(src):
        raise ValueError("That folder does not exist or is not reachable.")
    dest = os.path.abspath((d.get("dest") or "").strip().strip('"') or src)
    if rescan or TIDY["src"] != src or TIDY["scan"] is None:
        TIDY["scan"] = tm.scan(src, stop=STOP)
        TIDY["src"] = src
    groups = tm.build_plan(TIDY["scan"]["files"], dest, d.get("titles") or {})
    return tm, src, dest, groups


def job_tidy_apply(conn, say, progress, tm, items, dest):
    batch, moved, failed = tm.apply(conn, items, dest, say, progress, STOP)
    TIDY["scan"] = None
    if moved and conn.execute("SELECT 1 FROM roots LIMIT 1").fetchone():
        say("Updating the catalog ...")
        job_scan(conn, say, progress)


def job_tidy_undo(conn, say, progress, tm, batch):
    tm.undo(conn, batch, say, progress, STOP)
    TIDY["scan"] = None
    if conn.execute("SELECT 1 FROM roots LIMIT 1").fetchone():
        say("Updating the catalog ...")
        job_scan(conn, say, progress)


def _suggest_module():
    import importlib
    try:
        return importlib.import_module("vault_suggest")
    except ImportError:
        raise ValueError("vault_suggest.py must be in the same folder as vault.py to look things up online.")


def _dtrpg_module():
    import importlib
    try:
        return importlib.import_module("vault_dtrpg")
    except ImportError:
        raise ValueError("vault_dtrpg.py must be in the same folder as vault.py to use DriveThruRPG.")


def job_dtrpg(conn, say, progress):
    dt = _dtrpg_module()
    key = get_setting(conn, "dtrpg_key")
    if not key:
        say("No DriveThruRPG key saved yet.")
        return
    try:
        token = dt.login(key)
        raw = dt.library(token, progress, STOP)
    except dt.DtrpgError as e:
        say(str(e))
        return
    products = [dt.normalize(p) for p in raw]
    say(f"Your DriveThruRPG library has {len(products)} products. " + dt.field_report(raw))
    if raw and not any(p["name"] for p in products):
        say("No product names could be read from the answer, so nothing was matched. Please send the line above to whoever maintains Nightvault.")
        return
    covers = {r["key"]: True for r in conn.execute("SELECT key FROM covers")}
    auto = {r["key"]: r["ext"] for r in conn.execute("SELECT key, ext FROM auto_covers")}
    matched = unmatched = covered = 0
    missed = []
    groups = [g for g in get_groups(conn, False) if coll_of(g) == "rpg"]
    for i, g in enumerate(groups, 1):
        if STOP.is_set():
            break
        progress(f"Matching {i}/{len(groups)}: {g['name']}")
        p, sc = dt.best_match(g["name"], products)
        if not p:
            unmatched += 1
            missed.append(g["name"])
            continue
        gid = gid_of(g)
        matched += 1
        facts = [["Publisher", p["publisher"]]] if p["publisher"] else []
        store_meta(conn, gid, "dtrpg", dict(source="dtrpg", poster="", url=p["url"], overview=p["description"], tagline="", genres=p["tags"],
                                            facts=facts, credits=[]))
        tag = f"dtrpg:{p['id']}"
        if p["cover"] and (gid not in covers or auto.get(gid, "").startswith("local")) and auto.get(gid) != tag:
            try:
                store_cover(conn, gid, make_thumb(dt.download_image(p["cover"])) or b"", tag)
                covered += 1
            except Exception as e:
                if covered == 0:
                    say(f"Cover for {g['name']}: {e}")
    say(f"DriveThruRPG: {matched} of your books matched, {covered} covers downloaded, {unmatched} not found in your library"
        + (f" (for example: {', '.join(missed[:5])})." if missed else "."))
    if matched and not any(p["cover"] for p in products):
        say("The service sent no cover pictures; the first page of each book is used instead.")


def job_wiki_import(cat, url, tree, details):
    """tree = [{title, page, image, items:[{name,page,image}], lines:[same ...]}]: a node is a product line (or a series inside one)."""
    def run(conn, say, progress):
        sg = _suggest_module()
        try:
            root, apis = sg.wiki_apis(url)
        except Exception as e:
            say(f"Error: {e}")
            return
        extra = {urllib.parse.urlparse(root).hostname or ""}
        rows = conn.execute("SELECT id, name, parent_id FROM manual_lines WHERE cat=?", (cat,)).fetchall()
        lines = {(r["parent_id"] or 0, r["name"].lower()): r["id"] for r in rows}
        have = {}
        for r in conn.execute("SELECT id, name, line_id FROM manual_items WHERE cat=?", (cat,)):
            have[(r["line_id"] or 0, r["name"].lower())] = r["id"]
        covered = {r["key"] for r in conn.execute("SELECT key FROM covers WHERE key LIKE 'm:%'")}
        st = dict(lines=0, items=0, moved=0)
        todo, line_todo = [], []                    # (gid, item) of new items; (line id, node) of new lines that have a page

        def walk(nodes, parent):
            for n in nodes:
                if STOP.is_set():
                    return
                title = (n.get("title") or "").strip()[:60]
                lid = parent
                if title and title != "(top of the page)":
                    lid = lines.get((parent or 0, title.lower()))
                    if lid is None:
                        old = have.get((parent or 0, title.lower())) if parent is not None else None
                        if old:
                            row = conn.execute("SELECT * FROM manual_items WHERE id=?", (old,)).fetchone()
                            if row and row["owners"] in ("[]", "", None) and not (row["location"] or row["notes"]) and row["tags"] in ("[]", "", None):
                                g2 = f"m:{old}"                       # an untouched item made by an earlier import becomes the series instead
                                photo_delete_files(conn, g2)
                                conn.execute("DELETE FROM meta WHERE gid=?", (g2,))
                                cv = conn.execute("SELECT file FROM covers WHERE key=?", (g2,)).fetchone()
                                if cv:
                                    (COVER_DIR / cv["file"]).unlink(missing_ok=True)
                                    conn.execute("DELETE FROM covers WHERE key=?", (g2,))
                                conn.execute("DELETE FROM manual_items WHERE id=?", (old,))
                                have.pop((parent or 0, title.lower()), None)
                        lid = conn.execute("INSERT INTO manual_lines (cat, name, note, created, parent_id) VALUES (?,?,?,?,?)", (cat, title, "", time.time(), parent)).lastrowid
                        lines[(parent or 0, title.lower())] = lid
                        st["lines"] += 1
                        line_todo.append((lid, n))
                for it in n.get("items") or []:
                    name = (it.get("name") or "").strip()[:120]
                    if not name:
                        continue
                    prev = have.get((lid or 0, name.lower()))
                    if prev:
                        if it.get("image") and f"m:{prev}" not in covered:      # imported before, still without a picture: try again
                            todo.append((f"m:{prev}", it))
                            covered.add(f"m:{prev}")
                            conn.execute("UPDATE manual_items SET pic_url=? WHERE id=?", (it["image"][:900], prev))
                        continue
                    loose = have.get((0, name.lower()))
                    if loose and lid:                          # already in the collection, not in any line yet: put it in this one
                        conn.execute("UPDATE manual_items SET line_id=? WHERE id=?", (lid, loose))
                        have[(lid, name.lower())] = loose
                        del have[(0, name.lower())]
                        st["moved"] += 1
                        continue
                    gid = new_manual_item(conn, cat, name, lid)
                    have[(lid or 0, name.lower())] = int(gid[2:])
                    st["items"] += 1
                    todo.append((gid, it))
                    if it.get("image"):
                        conn.execute("UPDATE manual_items SET pic_url=? WHERE id=?", (it["image"][:900], int(gid[2:])))
                walk(n.get("lines") or [], lid)

        walk(tree, None)
        conn.commit()
        bump()
        say(f"Added {st['items']} items and {st['lines']} product lines / series" + (f"; {st['moved']} existing items moved into a line." if st["moved"] else "."))
        if not details or not (todo or line_todo):
            return
        titles = [it["page"] for _, it in todo if it.get("page")] + [n["page"] for _, n in line_todo if n.get("page")]
        info = {}
        if titles:
            try:
                info = sg.wiki_page_info(root, apis, titles, progress)
            except Exception as e:
                say(f"Could not read the item pages: {e}")

        errs = {}

        def fetch(it, pi):
            for cand in dict.fromkeys(x for x in (pi.get("image"), pi.get("thumb"), it.get("image")) if x):
                cand = re.sub(r"/scale-to-width-down/\d+", "/scale-to-width-down/420", cand)        # the wiki's small preview -> a bigger one
                for attempt in range(3):
                    try:
                        return sg.download_image(cand, extra_hosts=extra)
                    except Exception as e:
                        msg = str(e)
                        code = re.search(r"\b(4\d\d|5\d\d)\b", msg)
                        key = code.group(1) if code else msg[:60]
                        if attempt == 2 or not (code and code.group(1) in ("429", "500", "502", "503", "504")):
                            errs[key] = errs.get(key, 0) + 1
                            break
                        time.sleep(2 + attempt * 3)                             # the wiki asked us to slow down: wait and retry
            return None

        for lid, n in line_todo:                                   # a series gets the picture and text of its own wiki page
            if STOP.is_set():
                break
            pi = info.get(n.get("page") or "") or {}
            if pi.get("extract"):
                conn.execute("UPDATE manual_lines SET note=? WHERE id=? AND IFNULL(note,'')=''", (pi["extract"][:1500], lid))
            data = fetch(n, pi) if (n.get("page") or n.get("image")) else None
            if data:
                try:
                    store_cover(conn, f"l:{lid}", make_thumb(data) or data)
                except Exception:
                    pass
        conn.commit()
        pics = descs = 0
        for i, (gid, it) in enumerate(todo, 1):
            if STOP.is_set():
                say("Stopped. The items are added; pictures were fetched for the first ones only.")
                break
            progress(f"Pictures and descriptions {i}/{len(todo)}: {it['name']}")
            pi = info.get(it.get("page") or "") or {}
            if pi.get("extract"):
                store_meta(conn, gid, "web", dict(source="web", overview=pi["extract"][:2000], url=pi.get("url") or "", genres=[], facts=[], credits=[], poster="", tagline=""))
                descs += 1
            data = fetch(it, pi)
            time.sleep(0.15)                                                      # be gentle with the wiki's picture server
            if data:
                try:
                    add_photo(conn, gid, data, "Fan wiki")
                    store_cover(conn, gid, make_thumb(data) or data)
                    conn.execute("UPDATE manual_items SET pic_url=NULL WHERE id=?", (int(gid[2:]),))
                    pics += 1
                except Exception:
                    pass
        say(f"Details found for {descs} items, pictures for {pics}." + (f" Pictures the server could not download: {', '.join(f'{k} x{v}' for k, v in errs.items())} - your browser will fetch those now." if errs else ""))
    return run


def job_demo_remove(conn, say, progress):
    try:
        mod = _demo_module()
    except ImportError:
        say("vault_demo.py must be in the same folder as vault.py to remove the demo.")
        return
    mod.remove(sys.modules[__name__], conn, say)


# --------------------------------------------------------------------------- #
# BoardGameGeek: import your collection (the file you export from your own BGG account, or the live API with your own token)
# --------------------------------------------------------------------------- #
BGG_LABELS = {"Players", "Play time", "BGG rating", "Complexity", "My rating", "Plays logged", "BGG rank"}


def _flag(v):
    return str(v).strip() in ("1", "true", "yes")


def bgg_parse_csv(text):
    """The collection export of BoardGameGeek (CSV) -> a list of games with their status and numbers."""
    rows, seen = [], set()
    for raw in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        name, bid = r.get("objectname") or r.get("name"), r.get("objectid") or r.get("id") or ""
        if not name or not bid.isdigit() or int(bid) in seen:
            continue
        seen.add(int(bid))
        rows.append(dict(bgg_id=int(bid), name=name, year=r.get("yearpublished", ""), subtype=r.get("objecttype", "") or "boardgame",
                         own=_flag(r.get("own")), wishlist=r.get("wishlist", "") not in ("", "0"), wishlist_priority=r.get("wishlistpriority", ""),
                         preordered=_flag(r.get("preordered")), wanttobuy=_flag(r.get("wanttobuy")), rating=r.get("rating", ""), average=r.get("average", ""),
                         avgweight=r.get("avgweight", ""), rank=r.get("rank", ""), numplays=r.get("numplays", ""), minplayers=r.get("minplayers", ""),
                         maxplayers=r.get("maxplayers", ""), playingtime=r.get("playingtime", ""), comment=r.get("comment", "") or r.get("wishlistcomment", ""),
                         image="", expansion=("expansion" in (r.get("itemtype", "") + r.get("objectsubtype", "")).lower())))
    if not rows:
        raise ValueError("No games found in that file. Export your collection from BoardGameGeek as CSV and choose that file.")
    return rows


def bgg_parse_xml(data):
    root = ET.fromstring(data)
    if _ln(root.tag) == "errors":
        raise ValueError("BoardGameGeek: " + " ".join("".join(e.itertext()).strip() for e in root))
    child = lambda e, n: next((c for c in e if _ln(c.tag) == n), None)
    rows = []
    for it in root:
        if _ln(it.tag) != "item" or not (it.get("objectid") or "").isdigit():
            continue
        nm, st, stats, yr = child(it, "name"), child(it, "status"), child(it, "stats"), child(it, "yearpublished")
        rating = child(stats, "rating") if stats is not None else None
        val = lambda parent, tag: (child(parent, tag).get("value") or "") if parent is not None and child(parent, tag) is not None else ""
        rank = ""
        ranks = child(rating, "ranks") if rating is not None else None
        if ranks is not None:
            rank = next((x.get("value", "") for x in ranks if x.get("name") == "boardgame" and x.get("value", "").isdigit()), "")
        a = (stats.attrib if stats is not None else {})
        rows.append(dict(bgg_id=int(it.get("objectid")), name=(nm.text or "").strip() if nm is not None else "", year=(yr.text or "").strip() if yr is not None else "",
                         subtype=it.get("subtype", "boardgame"), own=_flag(st.get("own")) if st is not None else False,
                         wishlist=_flag(st.get("wishlist")) if st is not None else False, wishlist_priority=st.get("wishlistpriority", "") if st is not None else "",
                         preordered=_flag(st.get("preordered")) if st is not None else False, wanttobuy=_flag(st.get("wanttobuy")) if st is not None else False,
                         rating=(rating.get("value") or "") if rating is not None else "", average=val(rating, "average"), avgweight="", rank=rank,
                         numplays=(child(it, "numplays").text or "") if child(it, "numplays") is not None else "", minplayers=a.get("minplayers", ""),
                         maxplayers=a.get("maxplayers", ""), playingtime=a.get("playingtime", ""),
                         comment=(child(it, "comment").text or "") if child(it, "comment") is not None else "",
                         image=(child(it, "image").text or "").strip() if child(it, "image") is not None else "", expansion=it.get("subtype") == "boardgameexpansion"))
    return rows


def _bgg_get(path, token):
    req = urllib.request.Request("https://boardgamegeek.com/xmlapi2/" + path,
                                 headers={"Authorization": "Bearer " + token, "User-Agent": "Nightvault/0.1 (personal collection tracker)"})
    return urllib.request.urlopen(req, timeout=60)


def bgg_fetch_collection(username, token, say):
    for attempt in range(10):
        try:
            r = _bgg_get("collection?" + urllib.parse.urlencode({"username": username, "stats": 1}), token)
            if r.status == 202:                      # BoardGameGeek is preparing the list - ask again in a few seconds
                say("BoardGameGeek is preparing your collection ...")
                time.sleep(4)
                continue
            return bgg_parse_xml(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 202:
                time.sleep(4)
                continue
            if e.code in (401, 403):
                raise ValueError("BoardGameGeek refused the token (error %d). Check that it is correct and that the application is approved, "
                                 "or import your collection file instead." % e.code)
            if e.code == 429:
                time.sleep(8)
                continue
            raise ValueError(f"BoardGameGeek answered with error {e.code}.")
    raise ValueError("BoardGameGeek was too slow to prepare the collection - try again in a minute.")


def _num(x, nd=1):
    try:
        v = float(x)
        return f"{v:.{nd}f}" if v else ""
    except (TypeError, ValueError):
        return ""


def bgg_facts(r):
    f = []
    if r.get("minplayers") and r.get("maxplayers") and r["maxplayers"] != "0":
        f.append(["Players", r["minplayers"] if r["minplayers"] == r["maxplayers"] else f"{r['minplayers']}-{r['maxplayers']}"])
    if r.get("playingtime") not in ("", "0", None):
        f.append(["Play time", f"{r['playingtime']} min"])
    if _num(r.get("average")):
        f.append(["BGG rating", _num(r["average"]) + " / 10"])
    if _num(r.get("avgweight"), 2):
        f.append(["Complexity", _num(r["avgweight"], 2) + " / 5"])
    if _num(r.get("rating")):
        f.append(["My rating", _num(r["rating"]) + " / 10"])
    if r.get("numplays") not in ("", "0", None):
        f.append(["Plays logged", r["numplays"]])
    if r.get("rank", "").isdigit():
        f.append(["BGG rank", "#" + r["rank"]])
    return f


def bgg_import(conn, rows, say, progress, covers=False, with_wishlist=True):
    now = time.time()
    mapped = {r["bgg_id"]: r["gid"] for r in conn.execute("SELECT gid, bgg_id FROM bgg_map")}
    taken = set(mapped.values())
    unclaimed = {}
    for r in conn.execute("SELECT id, name FROM manual_items WHERE cat='boardgame'"):
        if f"m:{r['id']}" not in taken:
            unclaimed.setdefault(mc.key_of(re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", r["name"])), f"m:{r['id']}")
    stats = dict(new=0, updated=0, wish=0, gone=0, links=0, covers=0)
    owned = [r for r in rows if r["own"]]
    gids = {}
    for i, r in enumerate(owned, 1):
        progress(f"BoardGameGeek {i}/{len(owned)}: {r['name']}")
        gid = mapped.get(r["bgg_id"]) or unclaimed.get(mc.key_of(r["name"]))
        if gid and not conn.execute("SELECT 1 FROM manual_items WHERE id=?", (int(gid[2:]),)).fetchone():
            gid = None                                   # the item was deleted since the last sync
        if gid:
            stats["updated"] += 1
        else:
            tags = ["bgg"] + (["expansion"] if r.get("expansion") else [])
            cur = conn.execute("INSERT INTO manual_items (cat, name, year, format, owners, location, notes, tags, created) VALUES (?,?,?,?,?,?,?,?,?)",
                               ("boardgame", r["name"], r["year"], "physical", "[]", "", "", json.dumps(tags), now))
            gid = f"m:{cur.lastrowid}"
            stats["new"] += 1
        conn.execute("INSERT OR REPLACE INTO bgg_map VALUES (?,?,?)", (gid, r["bgg_id"], now))
        unclaimed.pop(mc.key_of(r["name"]), None)
        gids[r["bgg_id"]] = gid
        old = jl((conn.execute("SELECT data FROM meta WHERE gid=?", (gid,)).fetchone() or [None])[0], {}) or {}
        info = dict(source="bgg", poster="", url=f"https://boardgamegeek.com/boardgame/{r['bgg_id']}", overview=old.get("overview", ""), tagline=old.get("tagline", ""),
                    genres=old.get("genres", []), credits=old.get("credits", []),
                    facts=[x for x in old.get("facts", []) if x[0] not in BGG_LABELS] + bgg_facts(r))
        store_meta(conn, gid, "bgg", info)
        if covers and r.get("image") and online and hasattr(online, "download_image") and not conn.execute("SELECT 1 FROM covers WHERE key=?", (gid,)).fetchone():
            try:
                store_cover(conn, gid, online.download_image(r["image"]), "bgg")
                stats["covers"] += 1
            except Exception:
                pass
    # expansions: link them to the base game in the same list ("Base game: Expansion name")
    named = {gid: mc.key_of(next(x["name"] for x in owned if gids[x["bgg_id"]] == gid)) for gid in set(gids.values())}
    for r in owned:
        g = gids[r["bgg_id"]]
        for og, key in named.items():
            if og != g and len(key) >= 4 and named[g].startswith(key) and len(named[g]) > len(key) + 2 and (r.get("expansion") or ":" in r["name"] or " - " in r["name"]):
                stats["links"] += conn.execute("INSERT OR IGNORE INTO links VALUES (?,?,?)", (g, og, "expansion of")).rowcount
                break
    if with_wishlist:
        have = {(x["name"], x["source"]) for x in conn.execute("SELECT name, source FROM wishlist")}
        for r in rows:
            if r["own"] or not (r["wishlist"] or r["wanttobuy"] or r["preordered"]):
                continue
            if (r["name"], "bgg") in have:
                continue
            note = "Pre-ordered" if r["preordered"] else (f"BGG wishlist, priority {r['wishlist_priority']}" if r["wishlist_priority"] else "On my BGG wishlist")
            conn.execute("INSERT INTO wishlist (cat, name, note, url, date, source, owner, ref, added) VALUES (?,?,?,?,?,?,?,?,?)",
                         ("boardgame", r["name"], (note + (" - " + r["comment"] if r["comment"] else ""))[:300], f"https://boardgamegeek.com/boardgame/{r['bgg_id']}", "", "bgg", 0, "", now))
            stats["wish"] += 1
    # games that were synced before but are no longer owned on BoardGameGeek: flag them, never delete
    current = {r["bgg_id"] for r in owned}
    for bid, gid in mapped.items():
        row = conn.execute("SELECT tags FROM manual_items WHERE id=?", (int(gid[2:]),)).fetchone() if gid.startswith("m:") else None
        if not row:
            continue
        tags = jl(row["tags"], [])
        if bid not in current and "left BGG collection" not in tags:
            tags.append("left BGG collection")
            stats["gone"] += 1
        elif bid in current and "left BGG collection" in tags:
            tags.remove("left BGG collection")
        conn.execute("UPDATE manual_items SET tags=? WHERE id=?", (json.dumps(tags), int(gid[2:])))
    put_setting(conn, "bgg_last", json.dumps(dict(time=now, **stats)))
    conn.commit()
    bump()
    say(f"BoardGameGeek: {stats['new']} new, {stats['updated']} updated" + (f", {stats['links']} expansion link(s)" if stats["links"] else "")
        + (f", {stats['wish']} added to the wishlist" if stats["wish"] else "") + (f", {stats['covers']} cover(s)" if stats["covers"] else "")
        + (f". {stats['gone']} game(s) are no longer in your BGG collection and were tagged 'left BGG collection'." if stats["gone"] else "."))


def job_bgg_csv(text, covers, with_wishlist):
    def run(conn, say, progress):
        bgg_import(conn, bgg_parse_csv(text), say, progress, covers, with_wishlist)
    return run


def job_bgg_sync(username, token, covers, with_wishlist):
    def run(conn, say, progress):
        progress("Asking BoardGameGeek for your collection ...")
        bgg_import(conn, bgg_fetch_collection(username, token, say), say, progress, covers, with_wishlist)
    return run


# --------------------------------------------------------------------------- #
# Proxy printing: match a deck list to the cards you have, and offer every printing / art of each
# --------------------------------------------------------------------------- #
PROXY_DIR = COVER_DIR.parent / "vault_proxy"


def _proxy_key(name):
    return mc.key_of(re.sub(r"\s*//.*$", "", name or ""))


def proxy_candidates(conn, game, name, owned):
    """Every printing of a card name that has a picture here (official), plus pictures you added yourself (custom)."""
    key, full = _proxy_key(name), mc.key_of(name)
    words = sorted(re.findall(r"[A-Za-z0-9]{3,}", re.sub(r"\s*//.*$", "", name)), key=len, reverse=True)
    like = "%" + (words[0] if words else (name or "")[:4]).lower() + "%"
    out = []
    for r in conn.execute("SELECT c.*, s.name AS set_name, s.released FROM cg_cards c LEFT JOIN cg_sets s ON s.game=c.game AND s.code=c.set_code "
                          "WHERE c.game=? AND lower(c.name) LIKE ?", (game, like)):
        if _proxy_key(r["name"]) != key and mc.key_of(r["name"]) != full:
            continue
        out.append(dict(kind="official", set=r["set_code"], number=r["number"], name=r["name"], set_name=r["set_name"] or r["set_code"], released=r["released"] or "",
                        rarity=r["rarity"] or "", ctype=r["ctype"] or "", cost=r["cost"] or "", pt=r["pt"] or "", rules=r["rules"] or "", flavor=r["flavor"] or "",
                        artist=r["artist"] or "", price=r["price"], image=bool(r["path"]), back=bool(r["back_path"]), qty=owned.get((r["set_code"], r["number"]), 0)))
    for r in conn.execute("SELECT * FROM proxy_art WHERE key=? AND (game=? OR game='') ORDER BY id DESC", (key, game)):
        out.append(dict(kind="custom", id=r["id"], name=r["name"], label=r["label"] or "My art"))
    return out


# --------------------------------------------------------------------------- #
# Setup: check what Nightvault needs and install it (helper packages, video tool) - for people who
# know nothing about programming.  Everything lands next to the program; nothing system-wide changes.
# --------------------------------------------------------------------------- #
FFMPEG_SOURCES = [   # (name, zip address, checksum file)  - Windows builds, "essentials" (about 90 MB)
    ("gyan.dev", "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip", "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256"),
    ("BtbN on GitHub", "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip", ""),
]
SETUP = dict(running=False, text="", pct=0, error="", finished=0)
_setup_lock = threading.Lock()
DOWNLOADER_PACKAGES = (("requests", "requests"), ("tqdm", "tqdm"), ("ijson", "ijson"), ("pillow_avif", "pillow-avif-plugin"))


def _have(module):
    return importlib.util.find_spec(module) is not None


def _say(text, pct=None, log=False):
    SETUP["text"] = text
    if pct is not None:
        SETUP["pct"] = int(pct)
    if log:
        print("  " + text)


def refresh_optional_modules():
    """After installing Pillow / numpy while the program is running: start using them without a restart."""
    global PILImage, PILImageOps, np, MUTAGEN
    importlib.invalidate_caches()
    _pdf_found[0] = None
    try:
        import mutagen as _m
        MUTAGEN = _m
    except ImportError:
        pass
    try:
        from PIL import Image as _i, ImageOps as _o
        PILImage, PILImageOps = _i, _o
    except ImportError:
        pass
    try:
        import numpy as _n
        np = _n
    except ImportError:
        pass


def ffmpeg_auto_possible():
    return os.name == "nt" or bool(os.environ.get("NIGHTVAULT_FFMPEG_URL"))


def components_status():
    comps = []

    def add(cid, name, ok, detail, why, fix="auto"):
        comps.append(dict(id=cid, name=name, ok=bool(ok), detail=detail, why=why, fix=None if ok else fix))

    add("python", "Python", sys.version_info >= (3, 10), "version " + platform.python_version(), "Runs Nightvault (3.10 or newer is needed).", "manual")
    add("pillow", "Pictures (Pillow)", PILImage is not None, "ready" if PILImage is not None else "not installed", "Covers from comics and books, the card scanner, card printing previews, the demo comic and book.")
    add("mutagen", "Music tags (mutagen)", MUTAGEN is not None, "ready" if MUTAGEN is not None else "not installed",
        "Reads titles, artists, years and cover pictures stored inside your music files. Without it Nightvault uses the video tool (ffprobe) or the folder and file names.")
    add("pdf", "PDF pages (pypdfium2)", bool(pdf_backend()), ("ready - " + pdf_backend()) if pdf_backend() else "not installed",
        "Reads roleplaying books and PDF comics inside Nightvault, with page memory and printing. Without it PDFs open in your browser's own viewer.")
    add("numpy", "Numbers (numpy)", np is not None, "ready" if np is not None else "not installed", "3D model previews and the card scanner.")
    ff, fp = ffbin("ffmpeg"), ffbin("ffprobe")
    add("ffmpeg", "Video tools (ffmpeg)", ff and fp, ("ready - " + os.path.dirname(ff)) if ff and fp else "not installed",
        "Plays AVI, HEVC and files with DTS / AC3 sound, and gives you subtitle and audio-track choices.", "auto" if ffmpeg_auto_possible() else "manual")
    tools = unpack_tools()
    add("archives", "Reading RAR / 7z comics", bool(tools), "ready" if tools else "not found",
        "CBR and CB7 comics. Windows 10 and 11 can do this by themselves; CBZ files always work.", "manual")
    miss = [pip for mod, pip in DOWNLOADER_PACKAGES if not _have(mod)]
    add("downloaders", "Card downloaders", not miss, "ready" if not miss else "missing: " + ", ".join(miss), "Needed to download card pictures (requests, tqdm and so on).")
    return comps


def pip_install_runtime(packages):
    ok, msg = _pip_install(packages)
    refresh_optional_modules()
    return ok, msg


def install_ffmpeg():
    """Download ffmpeg + ffprobe into nightvault_tools (checked against the publisher's checksum when there is one)."""
    if os.environ.get("NIGHTVAULT_FFMPEG_URL"):
        sources = [("custom address", os.environ["NIGHTVAULT_FFMPEG_URL"], os.environ.get("NIGHTVAULT_FFMPEG_SHA256_URL", ""))]
    elif os.name == "nt":
        sources = FFMPEG_SOURCES
    else:
        raise RuntimeError("install ffmpeg with your package manager, for example  brew install ffmpeg  or  sudo apt install ffmpeg")
    tmp, last = TOOLS_DIR / "download", ""
    for label, url, sha_url in sources:
        try:
            tmp.mkdir(parents=True, exist_ok=True)
            zpath, sha = tmp / "ffmpeg.zip", hashlib.sha256()
            _say(f"Downloading the video tools from {label} ...", 1, log=True)
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": NV_UA}), timeout=40) as r, open(zpath, "wb") as f:
                total, got, shown = int(r.headers.get("Content-Length") or 0), 0, 0
                while True:
                    chunk = r.read(1 << 17)
                    if not chunk:
                        break
                    f.write(chunk)
                    sha.update(chunk)
                    got += len(chunk)
                    _say(f"Downloading the video tools ... {got / 1048576:.0f}" + (f" of {total / 1048576:.0f}" if total else "") + " MB", 100 * got / total if total else None)
                    if got - shown > 20 * 1048576:
                        shown = got
                        print(f"  ... {got / 1048576:.0f} MB")
            if sha_url:
                with urllib.request.urlopen(urllib.request.Request(sha_url, headers={"User-Agent": NV_UA}), timeout=30) as r:
                    want = re.search(r"[0-9a-fA-F]{64}", r.read().decode("ascii", "ignore"))
                if want and want.group(0).lower() != sha.hexdigest():
                    raise RuntimeError("the download was damaged (its checksum does not match)")
            _say("Unpacking the video tools ...", 99, log=True)
            bindir = TOOLS_DIR / "ffmpeg" / "bin"
            bindir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zpath) as z:
                for tool in ("ffmpeg", "ffprobe"):
                    member = next((n for n in z.namelist() if os.path.basename(n) == _exe(tool) and "/bin/" in "/" + n), None)
                    if not member:
                        raise RuntimeError(f"{_exe(tool)} is not inside that download")
                    with z.open(member) as src, open(bindir / _exe(tool), "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    os.chmod(bindir / _exe(tool), 0o755)
            if subprocess.run([str(bindir / _exe("ffmpeg")), "-version"], capture_output=True, timeout=30).returncode != 0:
                raise RuntimeError("the downloaded video tool does not run on this PC")
            shutil.rmtree(tmp, ignore_errors=True)
            return
        except Exception as e:
            last = f"{label}: {e}"
            shutil.rmtree(TOOLS_DIR / "ffmpeg", ignore_errors=True)
    shutil.rmtree(tmp, ignore_errors=True)
    raise RuntimeError(last or "download failed")


def run_setup():
    """Install whatever is missing, in the background. -> False when a setup is already running."""
    with _setup_lock:
        if SETUP["running"]:
            return False
        SETUP.update(running=True, text="Checking what is installed ...", pct=0, error="")

    def worker():
        errors = []
        try:
            need = [pip for mod, pip in (("PIL", "pillow"), ("numpy", "numpy"), ("mutagen", "mutagen"), ("pypdfium2", "pypdfium2")) if not _have(mod)]
            if need:
                _say(f"Installing {', '.join(need)} ...", 5, log=True)
                ok, msg = pip_install_runtime(need)
                if not ok:
                    errors.append(f"{', '.join(need)}: {msg.splitlines()[-1] if msg else 'failed'}")
            for mod, pip in DOWNLOADER_PACKAGES:                      # one by one, so a missing wheel for one does not block the rest
                if not _have(mod):
                    _say(f"Installing {pip} ...", 20, log=True)
                    ok, msg = pip_install_runtime([pip])
                    if not ok:
                        errors.append(f"{pip}: {msg.splitlines()[-1] if msg else 'failed'}")
            if not (ffbin("ffmpeg") and ffbin("ffprobe")) and ffmpeg_auto_possible():
                try:
                    print("  Setting up the video tools (one time, about 90 MB) ...")
                    install_ffmpeg()
                    print("  Video tools are ready.")
                except Exception as e:
                    errors.append("video tools: " + str(e))
                    print("  Could not set up the video tools: " + str(e))
        except Exception as e:
            errors.append(str(e))
        finally:
            SETUP.update(running=False, text="", pct=100, error="; ".join(errors), finished=time.time())

    threading.Thread(target=worker, daemon=True).start()
    return True


# --------------------------------------------------------------------------- #
# Music: albums come from your folders; titles, artists, years and covers are read from the files
# (with mutagen when it is installed, else with ffprobe, else from the file names)
# --------------------------------------------------------------------------- #
AUDIO_EXT = set(mc.AUDIO)
AUDIO_MIME = {".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".m4a": "audio/mp4",
              ".aac": "audio/aac", ".wav": "audio/wav", ".aiff": "audio/aiff", ".aif": "audio/aiff"}
BROWSER_AUDIO = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav"}      # these play as they are; the rest is converted with ffmpeg
IMG_NAMES = ("cover", "folder", "front", "album", "albumart", "artwork", "art")
_tag_cache = {}


def _lead_int(text):
    m = re.match(r"\s*(\d+)", str(text or ""))
    return int(m.group(1)) if m else None


def _tags_mutagen(path):
    f = MUTAGEN.File(path, easy=True)
    if f is None:
        f = MUTAGEN.File(path)
    if f is None:
        return None
    out = dict(duration=float(getattr(f.info, "length", 0) or 0) or None)
    t = f.tags
    if t is None:
        return out

    def first(*keys):
        for k in keys:
            try:
                v = t.get(k)
            except Exception:
                v = None
            if v:
                v = v[0] if isinstance(v, (list, tuple)) else v
                return str(getattr(v, "text", [v])[0] if hasattr(v, "text") else v).strip()
        return ""
    out.update(title=first("title", "TIT2"), artist=first("artist", "TPE1"), album=first("album", "TALB"), albumartist=first("albumartist", "TPE2"),
               track=_lead_int(first("tracknumber", "TRCK")), disc=_lead_int(first("discnumber", "TPOS")), year=first("date", "originaldate", "TDRC", "TYER")[:4],
               genre=first("genre", "TCON"))
    return out


def _tags_ffprobe(path):
    ff = ffbin("ffprobe")
    if not ff:
        return None
    r = subprocess.run([ff, "-v", "error", "-print_format", "json", "-show_format", path], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        return None
    fmt = json.loads(r.stdout or "{}").get("format", {})
    t = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    return dict(duration=float(fmt.get("duration") or 0) or None, title=t.get("title", ""), artist=t.get("artist", ""), album=t.get("album", ""),
                albumartist=t.get("album_artist") or t.get("albumartist", ""), track=_lead_int(t.get("track")), disc=_lead_int(t.get("disc")),
                year=(t.get("date") or t.get("year") or "")[:4], genre=t.get("genre", ""))


def read_tags(path):
    """Everything we can learn about one music file. Never raises; unknown things stay empty."""
    try:
        st = os.stat(path)
    except OSError:
        return dict(title="", artist="", album="", albumartist="", track=None, disc=None, year="", genre="", duration=None)
    hit = _tag_cache.get(path)
    if hit and hit[0] == (st.st_mtime, st.st_size):
        return hit[1]
    info = dict(title="", artist="", album="", albumartist="", track=None, disc=None, year="", genre="", duration=None)
    for reader in ((_tags_mutagen,) if MUTAGEN else ()) + (_tags_ffprobe,):
        try:
            got = reader(path)
        except Exception:
            got = None
        if got:
            info.update({k: v for k, v in got.items() if v not in (None, "")})
            if info["title"] or info["album"]:
                break
    if info["duration"] is None and path.lower().endswith(".wav"):
        try:
            import wave
            with wave.open(path) as w:
                info["duration"] = w.getnframes() / float(w.getframerate() or 1)
        except Exception:
            pass
    stem = os.path.splitext(os.path.basename(path))[0]
    if not info["title"]:
        info["title"] = re.sub(r"^\s*(?:\d{1,2}[-.])?\d{1,3}[\s._-]+", "", stem).replace("_", " ").strip() or stem
    if info["track"] is None:
        m = re.match(r"^\s*(?:\d{1,2}[-.])?(\d{1,3})(?=[\s._-])", stem)
        info["track"] = int(m.group(1)) if m else None
    _tag_cache[path] = ((st.st_mtime, st.st_size), info)
    if len(_tag_cache) > 20000:
        _tag_cache.pop(next(iter(_tag_cache)))
    return info


def folder_cover(folder):
    """cover.jpg / folder.png ... lying next to the music."""
    try:
        names = {n.lower(): n for n in os.listdir(folder)}
    except OSError:
        return None
    pics = [n for low, n in names.items() if os.path.splitext(low)[1] in (".jpg", ".jpeg", ".png", ".webp")]
    if not pics:
        if re.fullmatch(r"(?i)(?:cd|disc|disk)[\s._-]*\d+", os.path.basename(folder.rstrip("\\/"))):
            return folder_cover(os.path.dirname(folder.rstrip("\\/")))          # a disc folder: the album picture lies one level up
        return None
    pics.sort(key=lambda n: (next((i for i, w in enumerate(IMG_NAMES) if os.path.splitext(n.lower())[0] == w or os.path.splitext(n.lower())[0].startswith(w)), 99), n.lower()))
    try:
        return Path(folder, pics[0]).read_bytes()
    except OSError:
        return None


def embedded_cover(path):
    """The picture stored inside a music file (mutagen when available, else ffmpeg)."""
    if MUTAGEN:
        try:
            f = MUTAGEN.File(path)
            if f is not None:
                if getattr(f, "pictures", None):
                    return bytes(f.pictures[0].data)
                t = f.tags
                if t is not None:
                    if hasattr(t, "getall") and t.getall("APIC"):
                        return bytes(t.getall("APIC")[0].data)
                    if "covr" in t:
                        return bytes(t["covr"][0])
        except Exception:
            pass
    ff = ffbin("ffmpeg")
    if ff:
        try:
            r = subprocess.run([ff, "-v", "error", "-i", path, "-an", "-map", "0:v:0", "-frames:v", "1", "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1"],
                               capture_output=True, timeout=30)
            if r.returncode == 0 and r.stdout[:3] == b"\xff\xd8\xff":
                return r.stdout
        except Exception:
            pass
    return None


def _clock(seconds):
    m = int(round(seconds / 60))
    return f"{m // 60} h {m % 60:02d} min" if m >= 60 else f"{m} min"


def music_meta_for(g):
    files = [i["path"] for i in g["items"][:80] if os.path.exists(i["path"])]
    if not files:
        return None
    tags = [read_tags(f) for f in files]
    artists = Counter((t["albumartist"] or t["artist"]) for t in tags if (t["albumartist"] or t["artist"]))
    artist = "Various artists" if len(artists) > 3 else (artists.most_common(1)[0][0] if artists else Path(files[0]).parent.parent.name)
    years = sorted(t["year"] for t in tags if t["year"])
    genres = []
    for t in tags:
        for gen in re.split(r"[;/]", t["genre"] or ""):
            gen = gen.strip()
            if gen and gen.lower() not in (x.lower() for x in genres):
                genres.append(gen)
    total = sum(t["duration"] or 0 for t in tags)
    facts = [["Artist", artist]] + ([["Year", years[0]]] if years else []) + [["Tracks", str(len(g["items"]))]] + ([["Length", _clock(total)]] if total else []) \
        + [["Format", " / ".join(sorted({os.path.splitext(f)[1][1:].upper() for f in files}))]]
    return dict(source="file", poster="", url="", overview="", tagline="", genres=genres[:6], facts=facts, credits=[])


def music_album(conn, gid):
    cat, _, gkey = gid.partition("|")
    g = next((x for x in get_groups(conn, False) if x["cat"] == cat and x["gkey"] == gkey), None)
    if not g or cat != "music":
        raise KeyError("Album not found")
    ff = bool(ffbin("ffmpeg"))
    tracks = []
    for r in g["items"]:
        t = read_tags(r["path"])
        ext = os.path.splitext(r["path"])[1].lower()
        tracks.append(dict(path=r["path"], file=os.path.basename(r["path"]), title=t["title"], artist=t["artist"] or t["albumartist"], album=t["album"] or g["name"],
                           track=t["track"] if t["track"] is not None else r["number"], disc=t["disc"] or r["season"] or 1, duration=t["duration"], year=t["year"],
                           ext=ext, convert=ext not in BROWSER_AUDIO, playable=(ext in BROWSER_AUDIO) or ff, exists=os.path.exists(r["path"])))
    tracks.sort(key=lambda x: (x["disc"], x["track"] if x["track"] is not None else 9999, x["file"].lower()))
    arts = Counter(x["artist"] for x in tracks if x["artist"])
    return dict(id=gid, name=g["name"], artist=("Various artists" if len(arts) > 3 else (arts.most_common(1)[0][0] if arts else "")), ffmpeg=ff, tracks=tracks)


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #
def card_releases(conn, force=False):
    """Card game sets coming out soon (data/upcoming.json, made every day for Nightvault Pocket). Kept for 12 hours."""
    d = jl(get_setting(conn, "card_releases"), {}) or {}
    if force or ((not d.get("items") or time.time() - (d.get("at") or 0) > 12 * 3600) and time.time() - (d.get("tried") or 0) > 3600):
        d["tried"] = time.time()
        put_setting(conn, "card_releases", json.dumps(d))
        for base in ("https://brokeuh.github.io/nightvault-pocket/data/", "https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/"):
            try:
                j = json.loads(_fetch(base + "upcoming.json", 15))
                d = dict(at=time.time(), tried=time.time(), updated=j.get("updated"), items=j.get("items") or [])
                put_setting(conn, "card_releases", json.dumps(d))
                break
            except Exception:
                continue
    return d


KIND_WORD = {"expansion": "main set", "core": "core set", "commander": "Commander", "masters": "Masters set", "draft_innovation": "draft set", "supplemental": "special product",
             "promo": "promos", "box": "boxed set", "starter": "starter deck", "duel_deck": "duel decks", "funny": "Un-set", "masterpiece": "masterpieces", "arsenal": "collection"}


def card_release_entries(conn, days):
    d = card_releases(conn)
    today = time.strftime("%Y-%m-%d")
    end = time.strftime("%Y-%m-%d", time.localtime(time.time() + days * 86400))
    mine = {r[0] for r in conn.execute("SELECT DISTINCT game FROM cg_cards WHERE demo=0")} | {r[0] for r in conn.execute("SELECT DISTINCT game FROM cg_owned")}
    if conn.execute("SELECT 1 FROM card_owned LIMIT 1").fetchone():
        mine.add("mtg")
    out = []
    for x in d.get("items") or []:
        if not (today <= (x.get("date") or "") <= end):
            continue
        g, code = x.get("game") or "", x.get("code") or ""
        kind = KIND_WORD.get(x.get("kind") or "", x.get("kind") or "")
        url = f"https://scryfall.com/sets/{code.lower()}" if g == "mtg" and code else "https://www.tcgplayer.com/search/all/product?q=" + urllib.parse.quote(x.get("name") or "")
        out.append(dict(date=x["date"], type="Cards", title=x.get("name") or "", detail=" · ".join(v for v in (x.get("gameName"), code, kind) if v), url=url,
                        lib=g in mine, game=g, gid=f"cards:{g}:{code}"))
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "Nightvault/0.1"

    def log_message(self, fmt, *args):
        pass

    # ----- helpers
    def _host_ok(self):
        host = (self.headers.get("Host") or "").lower()
        return host in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")

    def _send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if "Cache-Control" not in (extra or {}):
            self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        self._send(code, {"error": msg})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _json(self):
        raw = self._body()
        return json.loads(raw.decode("utf-8")) if raw else {}

    # ----- routing
    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def _route(self, method):
        if not self._host_ok():
            return self._error(403, "Forbidden")
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if method == "POST" and self.headers.get("X-Vault-Token") != TOKEN:
            return self._error(403, "Missing or wrong token - reload the page.")
        if method == "GET" and u.path.startswith("/bookres/"):
            try:
                return self.book_res(u.path)
            except Exception as e:
                traceback.print_exc()
                return self._error(500, f"{type(e).__name__}: {e}")
        conn = connect()
        try:
            sync_downloaders(conn)
            self._dispatch(method, u.path, q, conn)
        except KeyError as e:
            self._error(404, str(e).strip("'\""))
        except (ValueError, json.JSONDecodeError) as e:
            self._error(400, str(e))
        except Exception as e:
            traceback.print_exc()
            self._error(500, f"{type(e).__name__}: {e}")
        finally:
            conn.close()

    def _dispatch(self, method, path, q, conn):
        if method == "GET":
            if path in ("/", "/index.html"):
                html = UI_FILE.read_text(encoding="utf-8").replace("__TOKEN__", TOKEN)
                return self._send(200, html, "text/html; charset=utf-8")
            if path == "/api/state":
                return self._send(200, self.state(conn))
            if path == "/api/games":
                if not vgames:
                    return self._error(404, "vault_games.py is missing next to vault.py")
                return self._send(200, vgames.state())
            if path == "/api/phone":
                if not phone:
                    return self._error(404, "vault_phone.py is missing next to vault.py")
                return self._send(200, phone.status())
            if path == "/api/news":
                if not vnews:
                    return self._send(200, {"items": {}, "error": "vault_news.py is missing next to vault.py"})
                if q.get("run") == "1":
                    vnews.run_async(True)
                return self._send(200, vnews.news())
            if path == "/api/library":
                return self._send(200, library(conn, q.get("from_one") == "1"))
            if path == "/api/item":
                return self._send(200, item_detail(conn, q["id"], q.get("from_one") == "1"))
            if path == "/api/job":
                with JOB_LOCK:
                    return self._send(200, dict(JOB))
            if path == "/api/calendar":
                return self._send(200, self.calendar(conn))
            if path == "/cover":
                return self.cover_get(conn, q.get("id", ""))
            if path == "/photo":
                r = conn.execute("SELECT file FROM item_photos WHERE id=?", (int(q.get("id", "0") or 0),)).fetchone()
                f = PHOTO_DIR / r["file"] if r else None
                if not f or not f.exists():
                    return self._error(404, "No photo")
                ctype = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}.get(f.suffix.lower(), "application/octet-stream")
                return self._send(200, f.read_bytes(), ctype, {"Cache-Control": "max-age=3600"})
            if path in ("/api/read/open", "/api/read/page"):
                return self.reader_get(conn, path, q)
            if path.startswith("/api/watch/"):
                return self.watch_get(conn, path, q)
            if path == "/api/model/mesh":
                if q.get("t") != TOKEN:
                    return self._error(403, "Missing token - reload the page.")
                return self._send(200, mesh_payload(self._catalog_file(conn, q.get("path", ""), MODEL_EXT)), "application/octet-stream",
                                  {"Cache-Control": "private, max-age=600"})
            if path in ("/api/book/open", "/api/book/pdf"):
                return self.book_get(conn, path, q)
            if path.startswith("/api/music/"):
                return self.music_get(conn, path, q)
            if path.startswith("/api/template/"):
                return self.template_get(path, q)
            if path.startswith("/api/cards/") or path == "/cardimg":
                return self.cards_get(conn, path, q)
            if path == "/api/pics/pending":
                rows = conn.execute("SELECT id, name, pic_url FROM manual_items WHERE pic_url IS NOT NULL AND pic_url<>'' AND ('m:'||id) NOT IN (SELECT key FROM covers) AND (?='' OR cat=?) LIMIT 3000",
                                    (q.get("cat") or "", q.get("cat") or "")).fetchall()
                return self._send(200, [dict(id=f"m:{r['id']}", name=r["name"], url=r["pic_url"]) for r in rows])
            if path == "/api/lines":
                return self._send(200, line_list(conn, q.get("cat") or None))
            if path == "/api/update/check":
                try:
                    return self._send(200, update_check())
                except Exception as e:
                    return self._send(200, dict(available=False, error=f"{type(e).__name__}: {e}", build=BUILD))
            if path == "/api/ccgtrader/games":
                if not ccgt:
                    raise ValueError("vault_ccgtrader.py must be in the same folder as vault.py.")
                have = {v["gid"] for v in catalog_games(conn).values()}
                try:
                    games = ccgt.list_games()
                except ccgt.CcgtError as e:
                    raise ValueError(str(e))
                return self._send(200, {"games": [dict(id=g, name=n, have=g in have) for g, n in games]})
            if path == "/api/cardgames":
                return self._send(200, {"games": card_game_choices(conn), "missing": cardsrc.NOT_AVAILABLE if cardsrc else [],
                                        "engine": bool(cardsrc), "sources": [x["sets_url"] for x in card_game_choices(conn) if x.get("sets_url")]})
            if path == "/api/decks":
                return self._send(200, decks_all(conn))
            if path == "/api/cardwant":
                return self._send(200, shared_data(conn)["want"])
            if path == "/api/prices/card":
                return self._send(200, card_prices(conn, q.get("game", ""), q.get("set", ""), q.get("n", "")))
            if path == "/api/prices/info":
                return self._send(200, dict(order=price_order(conn), labels={k: v[0] for k, v in PRICE_SOURCES.items()}, updated=get_setting(conn, "prices_updated")))
            if path == "/api/decks/search":
                return self._send(200, deck_search(conn, q))
            if path == "/deckimg":
                if q.get("t") != TOKEN:
                    return self._error(403, "Missing token - reload the page.")
                g = q.get("game", "")
                r = conn.execute("SELECT path FROM cg_cards WHERE game=? AND set_code=? AND number=? AND path IS NOT NULL AND path<>''", (g, q.get("set", ""), q.get("n", ""))).fetchone()
                if not r and q.get("name"):
                    k = name_key(q["name"])
                    r = next((x for x in conn.execute("SELECT name, path FROM cg_cards WHERE game=? AND lower(name) LIKE ? AND path IS NOT NULL AND path<>'' LIMIT 40",
                                                      (g, "%" + re.sub(r"[%_]", "", str(q["name"]).split(" (")[0].lower()[:30]) + "%")) if name_key(x["name"]) == k), None)
                if not r or not os.path.exists(r["path"]):
                    return self._error(404, "No image")
                ext = os.path.splitext(r["path"])[1].lower()
                return self._send(200, Path(r["path"]).read_bytes(), {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg"),
                                  {"Cache-Control": "private, max-age=3600"})
            if path == "/api/cardhub/games":
                return self._send(200, hub_games(conn))
            if path == "/api/cardhub/downloaders":
                out = []
                for k in DOWNLOADERS:
                    info = downloader_info(conn, k)
                    info["sets"] = conn.execute("SELECT COUNT(*) FROM cg_sets WHERE game=?", (k,)).fetchone()[0]
                    info["cards"] = conn.execute("SELECT COUNT(*) FROM cg_cards WHERE game=?", (k,)).fetchone()[0]
                    info["listed"] = conn.execute("SELECT COUNT(*) FROM cg_setlist WHERE game=?", (k,)).fetchone()[0]
                    info["color"] = DOWNLOADERS[k]["color"]
                    info["legacy"] = is_legacy(conn, k)
                    out.append(info)
                return self._send(200, {"games": out})
            if path == "/api/cardhub/sets":
                return self._send(200, hub_sets(conn, q["game"]))
            if path == "/api/cardhub/cards":
                return self._send(200, hub_cards(conn, q["game"], q["set"]))
            if path == "/api/proxyshop/status":          # Proxyshop offline setup: where things are
                bulk = find_bulk(conn, game_folder(conn, "mtg"))
                folder = get_setting(conn, "proxyshop_path") or ""
                r = dict(pxs.status(folder)) if pxs and folder else {"found": False}
                r["plugin_bulk"] = r.pop("bulk", "")
                r.update(available=bool(pxs), bulk=bulk or "", folder=folder)
                return self._send(200, r)
            if path == "/api/cardhub/notext":            # cards with a picture but no rules text yet (for "Read card text")
                rows = conn.execute("SELECT set_code, number, name FROM cg_cards WHERE game=? AND demo=0 AND path IS NOT NULL AND path<>'' "
                                    "AND COALESCE(rules,'')='' ORDER BY set_code, CAST(number AS INTEGER), number", (q["game"],)).fetchall()
                done = conn.execute("SELECT COUNT(*) FROM cg_cards WHERE game=? AND demo=0 AND COALESCE(rules,'')<>''", (q["game"],)).fetchone()[0]
                return self._send(200, {"cards": [dict(set=r["set_code"], number=r["number"], name=r["name"]) for r in rows], "done": done})
            if path == "/api/cardhub/textexport":        # card text for Nightvault Pocket (upload to the site as data/text/<game>.json)
                game = q["game"]
                rows = conn.execute("SELECT set_code, number, ctype, rules FROM cg_cards WHERE game=? AND demo=0 AND COALESCE(rules,'')<>''", (game,)).fetchall()
                data = json.dumps({"format": "nightvault-card-text", "game": game, "made": time.strftime("%Y-%m-%d"),
                                   "cards": {f"{r['set_code']}|{r['number']}": [r["ctype"] or "", r["rules"]] for r in rows}}, ensure_ascii=False, separators=(",", ":"))
                return self._send(200, data.encode("utf-8"), "application/json; charset=utf-8", {"Content-Disposition": f'attachment; filename="{game}.json"'})
            if path == "/api/setup/status":
                return self._send(200, dict(SETUP, components=components_status(), tools_dir=str(TOOLS_DIR), can_auto_ffmpeg=ffmpeg_auto_possible()))
            if path == "/api/demo/bgg-sample":
                return self._send(200, {"csv": _demo_module().bgg_sample_csv()})
            if path == "/api/bgg/status":
                last = jl(get_setting(conn, "bgg_last"), None)
                return self._send(200, dict(username=get_setting(conn, "bgg_user"), has_token=bool(get_setting(conn, "bgg_token")), last=last,
                                            mapped=conn.execute("SELECT COUNT(*) FROM bgg_map").fetchone()[0]))
            if path == "/api/cardhub/info":
                return self._send(200, hub_info(conn, q["game"]))
            if path == "/api/cardhub/doc":
                if q.get("t") != TOKEN:
                    return self._error(403, "Missing token - reload the page.")
                r = conn.execute("SELECT path FROM cg_docs WHERE id=?", (int(q.get("id", 0)),)).fetchone()
                if not r or not r["path"] or not os.path.exists(r["path"]) or os.path.splitext(r["path"])[1].lower() not in DOC_EXT:
                    return self._error(404, "That document is not available")
                return self.serve_file(r["path"], mimetypes.guess_type(r["path"])[0] or "application/octet-stream")
            if path == "/cardfile":
                if q.get("t") != TOKEN:
                    return self._error(403, "Missing token - reload the page.")
                r = conn.execute("SELECT path, back_path FROM cg_cards WHERE game=? AND set_code=? AND number=?", (q.get("game", ""), q.get("set", ""), q.get("n", ""))).fetchone()
                pth = r and (r["back_path"] if q.get("face") == "back" else r["path"])
                if not pth or not os.path.exists(pth):
                    return self._error(404, "No image")
                ext = os.path.splitext(pth)[1].lower()
                return self._send(200, Path(pth).read_bytes(), {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg"),
                                  {"Cache-Control": "private, max-age=3600"})
            if path == "/proxyimg":
                if q.get("t") != TOKEN:
                    return self._error(403, "Missing token - reload the page.")
                r = conn.execute("SELECT file FROM proxy_art WHERE id=?", (int(q.get("id", 0) or 0),)).fetchone()
                if not r or not (PROXY_DIR / r["file"]).exists():
                    return self._error(404, "No image")
                ext = os.path.splitext(r["file"])[1].lower()
                return self._send(200, (PROXY_DIR / r["file"]).read_bytes(), {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg"),
                                  {"Cache-Control": "private, max-age=3600"})
            if path == "/api/proxy/search":
                like = "%" + re.sub(r"[%_]", "", q.get("q", "")).strip().lower() + "%"
                return self._send(200, [r[0] for r in conn.execute("SELECT DISTINCT name FROM cg_cards WHERE game=? AND lower(name) LIKE ? ORDER BY name LIMIT 25", (q.get("game", ""), like))])
            if path == "/api/proxy/decks":
                return self._send(200, [dict(id=r["id"], name=r["name"], game=r["game"], entries=jl(r["entries"], []), settings=jl(r["settings"], {}), updated=r["updated"])
                                        for r in conn.execute("SELECT * FROM proxy_decks ORDER BY updated DESC")])
            if path == "/api/related":
                return self._send(200, related_for(conn, q["id"]))
            if path == "/api/wishlist":
                rows = conn.execute("SELECT * FROM wishlist ORDER BY cat, name, id").fetchall()
                return self._send(200, [dict(r) for r in rows])
            if path == "/api/export/missing.csv":
                return self.export_missing(conn)
            if path == "/api/cards/export-phone":
                data = export_phone_cards(conn)
                return self._send(200, json.dumps(data, ensure_ascii=False), "application/json; charset=utf-8",
                                  {"Content-Disposition": f'attachment; filename="nightvault-collection_{time.strftime("%Y-%m-%d")}.json"'})
            return self._error(404, "Not found")

        # ---- POST
        if path == "/api/cover":
            return self.cover_set(conn, q.get("id", ""))
        if path == "/api/photos/add":
            gid = q.get("id", "")
            if not gid:
                raise ValueError("Which item is this photo for?")
            return self._send(200, {"id": add_photo(conn, gid, self._body())})
        if path == "/api/proxy/art":
            data = self._body()
            ext = sniff_image(data)
            if ext not in (".jpg", ".png", ".webp"):
                raise ValueError("Please choose a JPG, PNG or WEBP picture")
            name = (q.get("name") or "").strip()
            if not name:
                raise ValueError("Which card is this art for?")
            PROXY_DIR.mkdir(exist_ok=True)
            fname = hashlib.sha1(data).hexdigest() + ext
            (PROXY_DIR / fname).write_bytes(data)
            cur = conn.execute("INSERT INTO proxy_art (game, name, key, label, file, added) VALUES (?,?,?,?,?,?)",
                               (q.get("game", ""), name, _proxy_key(name), (q.get("label") or "My art")[:60], fname, time.time()))
            conn.commit()
            return self._send(200, {"id": cur.lastrowid})
        if path == "/api/cards/identify":
            data = self._body()
            sets = {x for x in q.get("sets", "").lower().replace(" ", "").split(",") if x}
            prefer = [x for x in q.get("prefer", "").lower().split(",") if x]
            t0 = time.time()
            res = identify_card(conn, data, sets or None, prefer)
            res["ms"] = int((time.time() - t0) * 1000)
            return self._send(200, res)
        if path == "/api/template/upload":
            return self.template_upload(q)
        if path == "/api/update/zip":
            n = int(self.headers.get("Content-Length") or 0)
            if n < 100 or n > 60 << 20:
                return self._error(400, "That file is empty or too big")
            try:
                return self._send(200, update_zip(self.rfile.read(n)))
            except ValueError as e:
                return self._error(400, str(e))
        data = self._json()
        h = getattr(self, "post_" + path.strip("/").replace("api/", "", 1).replace("/", "_"), None)
        if not h:
            return self._error(404, "Not found")
        return h(conn, data)

    # ----- GET pieces
    def state(self, conn):
        saved = jl(get_setting(conn, "collections"), {})
        allc = {c["id"]: c for c in all_collections(conn)}
        order = [c for c in saved.get("order", []) if c in allc]
        order += [i for i in allc if i not in order]
        enabled = saved.get("enabled")
        if enabled is None:
            enabled = list(allc)
        else:                                     # a collection that is new in this version shows up by itself (it is yours to hide)
            enabled = list(enabled) + [i for i in allc if i not in saved.get("order", [])]
        colls = [dict(allc[i], enabled=i in enabled) for i in order]
        get = (lambda k: online.get_setting(conn, k).strip()) if online else (lambda k: "")
        return dict(
            version=VERSION, build=BUILD, collections=colls, onboarded=self._onboarded(conn), lines=line_list(conn), pending_pics={r['cat']: r['n'] for r in conn.execute("SELECT cat, COUNT(*) n FROM manual_items WHERE pic_url IS NOT NULL AND pic_url<>'' AND ('m:'||id) NOT IN (SELECT key FROM covers) GROUP BY cat")},
            layout=dict(groups=saved.get("groups") or [], collapsed=saved.get("collapsed") or []),
            lookups={k: dict(type=x.get("type"), url=x.get("url"), key_header=x.get("key_header", ""), has_key=bool(x.get("key")), also_wikipedia=x.get("also_wikipedia", True))
                     for k, x in jl(get_setting(conn, "lookup_sources"), {}).items()},
            people=[dict(id=r["id"], name=r["name"], color=r["color"]) for r in
                    conn.execute("SELECT * FROM people ORDER BY id")],
            roots=[r["path"] for r in conn.execute("SELECT path FROM roots ORDER BY path")],
            folder_rules=[dict(path=r["path"], coll=r["coll"]) for r in conn.execute("SELECT path, coll FROM folder_coll")],
            kinds=[dict(id=k, label=v["label"], scanned=bool(v["cats"])) for k, v in KINDS.items() if k != "card"],
            file_count=conn.execute("SELECT COUNT(*) FROM files").fetchone()[0],
            online=bool(online), has_tmdb=bool(get("tmdb_key")), has_cv=bool(get("comicvine_key")),
            ffmpeg=bool(ffbin("ffmpeg")), ffprobe=bool(ffbin("ffprobe")), pillow=PILImage is not None,
            cv_wait=cv_cooldown_minutes(conn),
            wish=conn.execute("SELECT COUNT(*) FROM wishlist").fetchone()[0], demo=bool(get_setting(conn, "demo")),
            setup=dict(running=SETUP["running"], text=SETUP["text"], pct=SETUP["pct"], error=SETUP["error"]),
            auto_covers=(online.get_setting(conn, "auto_covers", "1") == "1") if online else False,
            region=(online.get_setting(conn, "region", "BE") if online else "BE"),
            language=(online.get_setting(conn, "language", "en-US") if online else "en-US"),
            cal_days=int(online.get_setting(conn, "cal_days", "90") or 90) if online else 90)

    def _onboarded(self, conn):
        if get_setting(conn, "onboarded") == "1":
            return True
        if conn.execute("SELECT 1 FROM files LIMIT 1").fetchone() or conn.execute("SELECT 1 FROM roots LIMIT 1").fetchone() or get_setting(conn, "demo") \
                or get_setting(conn, "collections"):     # someone who already uses the app does not get the welcome wizard
            put_setting(conn, "onboarded", "1")
            return True
        return False

    def calendar(self, conn):
        if not online:
            return dict(entries=card_release_entries(conn, 90), updated=None, errors=["media_online.py is missing."], days=90)
        days = int(online.get_setting(conn, "cal_days", "90") or 90)
        entries, updated, errors = online.load_calendar(conn, get_groups(conn, False), days)
        try:
            entries = list(entries) + card_release_entries(conn, days)
        except Exception as e:
            errors = list(errors or []) + [f"Card releases: {e}"]
        return dict(entries=entries, updated=updated, errors=errors, days=days)

    def cover_get(self, conn, gid):
        r = conn.execute("SELECT file FROM covers WHERE key=?", (gid,)).fetchone()
        f = COVER_DIR / r["file"] if r else None
        if not f or not f.exists():
            return self._error(404, "No cover")
        ext = f.suffix.lower()
        ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
                 ".gif": "image/gif", ".svg": "image/svg+xml"}.get(ext, "application/octet-stream")
        extra = {"Cache-Control": "max-age=3600"}
        if ext == ".svg":
            extra["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
        self._send(200, f.read_bytes(), ctype, extra)

    def _catalog_file(self, conn, p, exts=None):
        exts = exts or readable_exts()
        if not p or not conn.execute("SELECT 1 FROM files WHERE path=?", (p,)).fetchone():
            raise KeyError("That file is not in the catalog")
        if not os.path.exists(p):
            raise ValueError("The file is not reachable right now (is the drive connected?)")
        if os.path.splitext(p)[1].lower() not in exts:
            raise ValueError("This kind of file cannot be opened here")
        return p

    def reader_get(self, conn, path, q):
        if q.get("t") != TOKEN:
            return self._error(403, "Missing token - reload the page.")
        p = self._catalog_file(conn, q.get("path", ""))
        if path == "/api/read/open":
            info = comic_pages(p)
            r = conn.execute("SELECT * FROM reading WHERE path=?", (p,)).fetchone()
            return self._send(200, dict(
                pages=len(info["names"]), title=os.path.splitext(os.path.basename(p))[0],
                resume=(dict(page=r["page"], total=r["total"], finished=bool(r["finished"])) if r else None)))
        data, ctype = comic_page_bytes(p, int(q.get("n", "0")), int(q.get("w", "0") or 0) or None)
        self._send(200, data, ctype, {"Cache-Control": "private, max-age=3600"})

    def book_get(self, conn, path, q):
        if q.get("t") != TOKEN:
            return self._error(403, "Missing token - reload the page.")
        if path == "/api/book/pdf":
            p = self._catalog_file(conn, q.get("path", ""), {".pdf"})
            return self.serve_file(p, "application/pdf")
        p = self._catalog_file(conn, q.get("path", ""), BOOK_EXT)
        info = epub_info(p)
        h = hashlib.sha1(p.encode()).hexdigest()[:12]
        _books[h] = p
        r = conn.execute("SELECT * FROM bookprog WHERE path=?", (p,)).fetchone()
        self._send(200, dict(
            hash=h, title=info["title"] or os.path.splitext(os.path.basename(p))[0], author=info["author"],
            spine=info["spine"], sizes=info["sizes"], toc=info["toc"],
            resume=(dict(chapter=r["chapter"], ratio=r["ratio"], percent=r["percent"], finished=bool(r["finished"]))
                    if r else None)))

    def book_res(self, path):
        """/bookres/<token>/<book id>/<file inside the epub> - chapters, images, styles, fonts."""
        parts = path.split("/", 4)
        if len(parts) < 5 or parts[2] != TOKEN:
            return self._error(403, "Forbidden")
        h, rest = parts[3], unquote(parts[4])
        cors = {"Access-Control-Allow-Origin": "*", "Cache-Control": "private, max-age=600"}
        if h == "_":
            if rest == "reader.js":
                return self._send(200, READER_JS, "application/javascript; charset=utf-8", cors)
            if rest == "reader.css":
                return self._send(200, READER_CSS, "text/css; charset=utf-8", cors)
            return self._error(404, "Not found")
        bpath = _books.get(h)
        if not bpath or not os.path.exists(bpath):
            return self._error(404, "Book not open")
        info = epub_info(bpath)
        name = posixpath.normpath(rest.lstrip("/"))
        if name.startswith("..") or name.startswith("/"):
            return self._error(403, "Forbidden")
        with zipfile.ZipFile(bpath) as z:
            try:
                data = z.read(name)
            except KeyError:
                return self._error(404, "Not found in the book")
        if name in info["spine_set"]:
            nonce = secrets.token_urlsafe(12)
            text = data.decode("utf-8-sig", "replace")
            text = re.sub(r"^\s*<\?xml[^>]*\?>", "", text)
            try:
                ET.fromstring(text.encode("utf-8"))
                ctype = "application/xhtml+xml; charset=utf-8"
            except ET.ParseError:
                ctype = "text/html; charset=utf-8"
            inj = (f'<link rel="stylesheet" type="text/css" href="/bookres/{TOKEN}/_/reader.css"/>'
                   f'<script nonce="{nonce}" src="/bookres/{TOKEN}/_/reader.js"></script>')
            if re.search(r"</head\s*>", text, re.I):
                text = re.sub(r"</head\s*>", lambda m: inj + m.group(0), text, count=1, flags=re.I)
            elif re.search(r"<body", text, re.I):
                text = re.sub(r"<body", lambda m: "<head>" + inj + "</head>" + m.group(0), text, count=1, flags=re.I)
            csp = (f"default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; "
                   f"media-src 'self'; script-src 'nonce-{nonce}'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'")
            return self._send(200, text, ctype, dict(cors, **{"Content-Security-Policy": csp}))
        ctype = info["types"].get(name) or mimetypes.guess_type(name)[0] or "application/octet-stream"
        if ctype in ("image/svg+xml",):
            cors["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
        self._send(200, data, ctype, cors)

    def cards_get(self, conn, path, q):
        if q.get("t") != TOKEN and path == "/cardimg":
            return self._error(403, "Missing token - reload the page.")
        if path == "/cardimg":
            r = conn.execute("SELECT path FROM card_index WHERE id=?", (q.get("id", ""),)).fetchone()
            if not r or not os.path.exists(r["path"]):
                return self._error(404, "No image")
            ext = os.path.splitext(r["path"])[1].lower()
            ctype = {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
            return self._send(200, Path(r["path"]).read_bytes(), ctype, {"Cache-Control": "private, max-age=3600"})
        if path == "/api/cards/status":
            tot = conn.execute("SELECT COALESCE(SUM(qty),0), COUNT(DISTINCT id) FROM card_owned").fetchone()
            return self._send(200, dict(
                folder=get_setting(conn, "cards_folder"), pillow=PILImage is not None, numpy=np is not None,
                indexed=conn.execute("SELECT COUNT(*) FROM card_index").fetchone()[0],
                known=conn.execute("SELECT COUNT(*) FROM card_meta").fetchone()[0],
                owned=tot[0], unique=tot[1]))
        if path == "/api/cards/search":
            term = "%" + q.get("q", "").strip() + "%"
            sets = [x for x in q.get("sets", "").lower().replace(" ", "").split(",") if x]
            sql = ("SELECT i.id, i.set_code, i.number, COALESCE(m.name, i.name) AS name, m.set_name, m.rarity, m.eur, m.eur_foil "
                   "FROM card_index i LEFT JOIN card_meta m ON m.id=i.id WHERE COALESCE(m.name, i.name) LIKE ?")
            args = [term]
            if sets:
                sql += " AND i.set_code IN (%s)" % ",".join("?" * len(sets))
                args += sets
            rows = conn.execute(sql + " ORDER BY name, i.set_code LIMIT 40", args).fetchall()
            return self._send(200, [dict(id=r["id"], set=r["set_code"], number=r["number"], name=r["name"], set_name=r["set_name"] or "",
                                         rarity=r["rarity"] or "", eur=r["eur"], eur_foil=r["eur_foil"], score=0) for r in rows])
        if path == "/api/cards/owned":
            rows = conn.execute(
                "SELECT o.id, o.foil, o.owner, o.qty, o.location, i.set_code AS iset, i.number AS inum, i.name AS iname, "
                "m.name, m.set_name, m.rarity, m.eur, m.eur_foil FROM card_owned o "
                "LEFT JOIN card_index i ON i.id=o.id LEFT JOIN card_meta m ON m.id=o.id ORDER BY COALESCE(m.name, i.name)").fetchall()
            out, value, unpriced = [], 0.0, 0
            for r in rows:
                price = r["eur_foil"] if r["foil"] else r["eur"]
                if price is None:
                    unpriced += r["qty"]
                else:
                    value += price * r["qty"]
                sid, _, num = r["id"].partition(":")
                out.append(dict(id=r["id"], foil=r["foil"], owner=r["owner"], qty=r["qty"], location=r["location"] or "",
                                name=r["name"] or r["iname"] or r["id"], set=r["iset"] or sid, number=r["inum"] or num,
                                set_name=r["set_name"] or "", rarity=r["rarity"] or "", price=price,
                                has_image=r["iset"] is not None))
            return self._send(200, dict(cards=out, value=round(value, 2), unpriced=unpriced,
                                        total=sum(c["qty"] for c in out), unique=len({c["id"] for c in out})))
        return self._error(404, "Not found")

    def post_games_set(self, conn, d):
        if not vgames:
            raise ValueError("vault_games.py is missing next to vault.py")
        self._send(200, vgames.save(d))

    def post_games_test(self, conn, d):
        """Settings > Games: start the first backup of a system, to see that the emulator works"""
        if not vgames:
            raise ValueError("vault_games.py is missing next to vault.py")
        b = vgames.build(True)
        it = next((x for x in b["items"] if x["sys"] == d.get("sys")), None)
        if not it:
            raise ValueError("No backup files found in that folder")
        self._send(200, vgames.play(it["id"]))

    def post_phone_set(self, conn, d):
        if not phone:
            raise ValueError("vault_phone.py is missing next to vault.py")
        self._send(200, phone.set_on(bool(d.get("on")), bool(d.get("newcode"))))

    def post_wishlist_add(self, conn, d):
        name = (d.get("name") or "").strip()
        cat = d.get("cat") or ""
        if not name:
            raise ValueError("Enter a name")
        if cat not in coll_map(conn):
            raise ValueError("Pick a collection")
        note = (d.get("note") or "").strip()
        dup = conn.execute("SELECT id FROM wishlist WHERE cat=? AND lower(name)=lower(?) AND note=?", (cat, name, note)).fetchone()
        if dup:
            return self._send(200, {"id": dup["id"], "duplicate": True})
        cur = conn.execute("INSERT INTO wishlist (cat, name, note, url, date, source, owner, ref, added) VALUES (?,?,?,?,?,?,?,?,?)",
                           (cat, name, note, (d.get("url") or "").strip(), (d.get("date") or "").strip(), d.get("source") or "manual",
                            int(d.get("owner") or 0), d.get("ref") or "", time.time()))
        conn.commit()
        self._send(200, {"id": cur.lastrowid, "duplicate": False})

    def post_wishlist_update(self, conn, d):
        conn.execute("UPDATE wishlist SET note=?, owner=? WHERE id=?", ((d.get("note") or "").strip(), int(d.get("owner") or 0), int(d["id"])))
        conn.commit()
        self._send(200, {"ok": True})

    def post_wishlist_delete(self, conn, d):
        conn.execute("DELETE FROM wishlist WHERE id=?", (int(d["id"]),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_wishlist_got(self, conn, d):
        """'I got it' - the wish becomes an item in the collection."""
        w = conn.execute("SELECT * FROM wishlist WHERE id=?", (int(d["id"]),)).fetchone()
        if not w:
            raise KeyError("Not on the wishlist any more")
        fmt = d.get("format") if d.get("format") in ("physical", "digital", "both") else "physical"
        title = w["name"] + (f" - {w['note']}" if w["note"] and w["source"] == "missing" else "")
        cur = conn.execute("INSERT INTO manual_items (cat, name, year, format, owners, location, notes, tags, created) VALUES (?,?,?,?,?,?,?,?,?)",
                           (w["cat"], title, "", fmt, json.dumps([w["owner"]] if w["owner"] else []), "", w["note"] or "", "[]", time.time()))
        conn.execute("DELETE FROM wishlist WHERE id=?", (w["id"],))
        conn.commit()
        self._send(200, {"gid": f"m:{cur.lastrowid}"})

    def post_links_add(self, conn, d):
        a, b, kind = d.get("a", ""), d.get("b", ""), d.get("kind", "")
        if kind not in LINK_KINDS:
            raise ValueError("Unknown kind of link")
        if not a or not b or a == b:
            raise ValueError("Pick two different items")
        conn.execute("INSERT OR IGNORE INTO links VALUES (?,?,?)", (a, b, kind))
        conn.commit()
        self._send(200, {"ok": True})

    def post_links_delete(self, conn, d):
        conn.execute("DELETE FROM links WHERE a=? AND b=? AND kind=?", (d["a"], d["b"], d["kind"]))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cards_setup(self, conn, d):
        folder = os.path.normpath((d.get("folder") or "").strip().strip('"'))
        if not d.get("folder", "").strip() or not os.path.isdir(folder):
            raise ValueError("That folder does not exist")
        put_setting(conn, "cards_folder", folder)
        bulk = (d.get("bulk") or "").strip().strip('"')
        if bulk:
            if not os.path.exists(bulk):
                raise ValueError("That Scryfall data file does not exist")
            put_setting(conn, "cards_bulk", bulk)
        self._send(200, {"ok": True})

    def post_prices_update(self, conn, d):
        self._send(200, {"started": start_job("prices", job_prices_update)})

    def post_prices_order(self, conn, d):
        o = [k for k in (d.get("order") or []) if k in PRICE_SOURCES]
        o += [k for k in PRICE_SOURCES if k not in o]
        put_setting(conn, "shared_price_order", json.dumps(dict(order=o, at=int(time.time() * 1000))))
        prices_apply_all(conn)
        self._send(200, {"order": o})

    def post_prices_mine(self, conn, d):
        game, sc, nb = d.get("game", ""), d.get("set", ""), str(d.get("number", ""))
        num = lambda v: None if v in (None, "") else round(float(str(v).replace(",", ".")), 2)
        myp = shared_data(conn)["my_prices"]
        myp[f"{game}|{sc}|{nb}"] = [num(d.get("price")), num(d.get("foil")), int(time.time() * 1000)]
        put_setting(conn, "shared_my_prices", json.dumps(myp))
        prices_apply(conn, game)
        self._send(200, card_prices(conn, game, sc, nb))

    def post_decks_save(self, conn, d):
        self._send(200, deck_save(conn, d.get("deck")))

    def post_decks_delete(self, conn, d):
        deck_delete(conn, str(d.get("id") or ""))
        self._send(200, {"ok": True})

    def post_decks_resolve(self, conn, d):
        self._send(200, deck_resolve(conn, d.get("game", ""), d.get("text", "")))

    def post_cardwant_add(self, conn, d):
        """Cards on the shared card wishlist (the phone's wishlist) - add, or remove with remove=true."""
        sh, now, n = shared_data(conn), int(time.time() * 1000), 0
        want, gone = sh["want"], sh["want_removed"]
        for m in d.get("cards") or []:
            if not isinstance(m, dict) or not m.get("game") or m.get("set") is None:
                continue
            k = f"{m['game']}|{m['set']}|{m.get('number', '')}"
            if d.get("remove"):
                if want.pop(k, None) is not None:
                    gone[k] = now
                    n += 1
            elif k not in want:
                want[k] = dict(game=m["game"], set=m["set"], number=m.get("number", ""), name=m.get("name", ""), showSet=m.get("showSet", ""),
                               showNum=m.get("showNum", ""), setName=m.get("setName", ""), image=deck_card(m).get("image", ""), price=m.get("price"),
                               currency=m.get("currency") or "EUR", added=now)
                n += 1
        put_setting(conn, "shared_want", json.dumps(want))
        put_setting(conn, "shared_want_removed", json.dumps(gone))
        conn.commit()
        self._send(200, {"changed": n, "want": want})

    def post_decks_rules(self, conn, d):
        r = jl(get_setting(conn, "deck_rules"), {}) or {}
        if isinstance(d.get("rules"), dict):
            r[str(d.get("game"))] = {k: int(v) for k, v in d["rules"].items() if k in ("min", "max", "side", "copies") and isinstance(v, (int, float))}
        else:
            r.pop(str(d.get("game")), None)
        put_setting(conn, "deck_rules", json.dumps(r))
        conn.commit()
        self._send(200, {"rules": r})

    def post_cardhub_own(self, conn, d):
        if d.get("game") not in {r[0] for r in conn.execute("SELECT id FROM cg_games")}:
            raise ValueError("Unknown game")
        qty = hub_change(conn, d["game"], d["set"], str(d["number"]), int(d.get("delta", 1)), 1 if d.get("foil") else 0)
        self._send(200, {"qty": qty})

    def post_cardhub_demo(self, conn, d):
        if d.get("on", True):
            seed_demo(conn)
        else:
            remove_demo(conn)
        self._send(200, {"ok": True})

    def post_cardhub_download(self, conn, d):
        game = d.get("game")
        if game not in DOWNLOADERS:
            raise ValueError("Unknown game")
        sets = [x for x in re.split(r"[,\s]+", d.get("sets", "").strip()) if x]
        self._send(200, {"started": start_job("cards-download", job_cards_download(game, sets, d.get("quality", "")))})

    def post_cardgames_enable(self, conn, d):
        valid = set(DOWNLOADERS_BASE) | (set(cardsrc.PRESETS) if cardsrc else set()) | (set(tdata.SOURCES) if tdata else set())
        put_setting(conn, "card_games", json.dumps([x for x in d.get("ids", []) if x in valid]))
        bump()
        self._send(200, {"ok": True})

    def post_cardgames_test(self, conn, d):
        if not cardsrc:
            raise ValueError("vault_cardsrc.py must be in the same folder as vault.py.")
        try:
            spec = cardsrc.clean_spec(d.get("spec") or {})
            spec, rep = cardsrc.detect(spec)
            n = len(cardsrc.list_sets(spec))
        except cardsrc.SrcError as e:
            return self._send(200, {"ok": False, "error": str(e)})
        spec.pop("key", None)
        self._send(200, {"ok": True, "report": rep, "sets": n, "spec": spec})

    def post_cardgames_add(self, conn, d):
        if not cardsrc:
            raise ValueError("vault_cardsrc.py must be in the same folder as vault.py.")
        try:
            spec = cardsrc.clean_spec(d.get("spec") or {})
        except cardsrc.SrcError as e:
            raise ValueError(str(e))
        try:
            spec, _rep = cardsrc.detect(spec)
        except cardsrc.SrcError as e:
            c, st = spec["cards"], spec["sets"]
            if not (st["code"] and c["number"] and c["image"] and c["name"]):       # cannot be checked from here - fine when every field was filled in by hand
                raise ValueError(str(e))
        existing = custom_games(conn)
        if any(v["label"].lower() == spec["label"].lower() for v in existing.values()) or any(v["label"].lower() == spec["label"].lower() for v in list(DOWNLOADERS_BASE.values()) + list(cardsrc.PRESETS.values())):
            raise ValueError("There is already a game with that name")
        base = "g_" + (re.sub(r"[^a-z0-9]+", "", spec["label"].lower()) or "game")[:20]
        gid, n = base, 2
        while gid in existing:
            gid, n = f"{base}{n}", n + 1
        existing[gid] = spec
        put_setting(conn, "custom_games", json.dumps(existing))
        bump()
        self._send(200, {"id": gid})

    def post_proxyshop_setup(self, conn, d):
        """Install the 'Nightvault Offline' plugin into Proxyshop, pointing at this PC's Scryfall card file."""
        if not pxs:
            raise ValueError("vault_proxyshop.py must be in the same folder as vault.py.")
        bulk = find_bulk(conn, game_folder(conn, "mtg"))
        if not bulk:
            raise ValueError("Nightvault has no Scryfall card file yet - download Magic cards first (Cards -> Magic -> Download cards).")
        plug = pxs.install(d.get("folder"), bulk, d.get("online", True))
        put_setting(conn, "proxyshop_path", str(d.get("folder") or "").strip().strip('"'))
        self._send(200, {"plugin": plug, "bulk": bulk, **pxs.status(d.get("folder"))})

    def post_cardhub_texts(self, conn, d):
        """Rules text read from the card pictures in the browser (Card hub -> Read card text)."""
        game, rows = d.get("game"), d.get("rows") or []
        self._known_game(conn, game)
        n = 0
        for r in rows[:200]:
            t = str(r.get("text") or "").strip()[:3000]
            if t:
                n += conn.execute("UPDATE cg_cards SET rules=? WHERE game=? AND set_code=? AND number=? AND demo=0 AND COALESCE(rules,'')=''",
                                  (t, game, str(r.get("set")), str(r.get("number")))).rowcount
        conn.commit()
        self._send(200, {"saved": n})

    def post_cardhub_many(self, conn, d):
        keys = [k for k in (d.get("games") or []) if isinstance(k, str)]
        if not keys:
            raise ValueError("Tick at least one game")
        root = (d.get("root") or "").strip().strip('"')
        if root:
            for k in keys:
                put_setting(conn, "cards_folder" if k == "mtg" else f"cards_folder_{k}", os.path.join(root, k))
        self._send(200, {"started": start_job("cards-many", job_cards_many(keys, bool(d.get("webp")), bool(d.get("big")), bool(d.get("lossless"))))})

    def post_update_apply(self, conn, d):
        self._send(200, update_apply())

    def post_update_restart(self, conn, d):
        self._send(200, {"ok": True})
        update_restart()

    def post_cardhub_opppstatus(self, conn, d):
        self._send(200, {"has_key": bool(get_setting(conn, "oppp_key"))})

    def post_cardhub_opppkey(self, conn, d):
        """Save (or clear) the owner's oppp.online supporter key. It is only kept in this PC's own settings and is never sent back to the page."""
        key = str(d.get("key") or "").strip()
        if key and not re.fullmatch(r"[0-9a-fA-F-]{20,64}", key):
            raise ValueError("That does not look like an OPPP key (letters, digits and dashes only).")
        put_setting(conn, "oppp_key", key)
        self._send(200, {"saved": bool(key)})

    def post_cardhub_check(self, conn, d):
        keys = [k for k in (d.get("games") or []) if isinstance(k, str)]
        if not keys:
            raise ValueError("Tick at least one game")
        self._send(200, {"started": start_job("cards-check", job_cards_check(keys, bool(d.get("webp")), bool(d.get("big")), bool(d.get("lossless"))))})

    def post_cardhub_legacy(self, conn, d):
        marks = jl(get_setting(conn, "legacy_games"), {}) or {}
        for k, v in (d.get("marks") or {}).items():
            marks[str(k)] = bool(v)
        put_setting(conn, "legacy_games", json.dumps(marks))
        self._send(200, {"ok": True})

    def post_ccgtrader_addall(self, conn, d):
        """Add every CCG Trader game that has card pictures (Magic, Pokemon and Yu-Gi-Oh! have better sources and are left out)."""
        if not ccgt:
            raise ValueError("vault_ccgtrader.py must be in the same folder as vault.py.")
        try:
            idx = ccgt._copy("index")
        except Exception as e:
            raise ValueError(f"The game list could not be loaded: {e}")
        games = catalog_games(conn)
        have = {v["gid"] for v in games.values()}
        n = 0
        for row in idx.get("games") or []:
            gid, name = int(row[0]), str(row[1]).strip()
            if gid in have or gid in (21, 130, 158) or (len(row) > 3 and not row[3]):
                continue
            key = ccgt.game_key(gid)
            if key in DOWNLOADERS_BASE or (cardsrc and key in cardsrc.PRESETS) or key in custom_games(conn):
                continue
            games[key] = dict(gid=gid, label=name, color=CATALOG_COLORS[len(games) % len(CATALOG_COLORS)])
            n += 1
        put_setting(conn, "ccgt_games", json.dumps(games))
        bump()
        self._send(200, {"added": n})

    def post_ccgtrader_add(self, conn, d):
        if not ccgt:
            raise ValueError("vault_ccgtrader.py must be in the same folder as vault.py.")
        gid, name = int(d.get("gid") or 0), str(d.get("name") or "").strip()
        if not gid or not name:
            raise ValueError("Pick a game from the list")
        games = catalog_games(conn)
        key = ccgt.game_key(gid)
        if key in DOWNLOADERS_BASE or (cardsrc and key in cardsrc.PRESETS) or key in custom_games(conn):
            raise ValueError("That game is already in Nightvault")
        games[key] = dict(gid=gid, label=name, color=CATALOG_COLORS[len(games) % len(CATALOG_COLORS)])
        put_setting(conn, "ccgt_games", json.dumps(games))
        bump()
        self._send(200, {"id": key})

    def post_cardgames_delete(self, conn, d):
        cat = catalog_games(conn)
        if cat.pop(d.get("id"), None) is not None:
            put_setting(conn, "ccgt_games", json.dumps(cat))
            bump()
            return self._send(200, {"ok": True})
        existing = custom_games(conn)
        if existing.pop(d.get("id"), None) is None:
            raise ValueError("Only games you added yourself can be removed")
        put_setting(conn, "custom_games", json.dumps(existing))
        bump()
        self._send(200, {"ok": True})

    def post_track(self, conn, d):
        """What the person wants to follow: collections for the sidebar and card games (first-run wizard and Settings)."""
        known = coll_map(conn)
        saved = jl(get_setting(conn, "collections"), {})
        if isinstance(d.get("collections"), list):
            order = [c for c in saved.get("order", []) if c in known] or list(known)
            order += [i for i in known if i not in order]
            saved["order"] = order
            saved["enabled"] = [c for c in d["collections"] if c in known]
            put_setting(conn, "collections", json.dumps(saved))
        if isinstance(d.get("card_games"), list):
            valid = set(DOWNLOADERS_BASE) | (set(cardsrc.PRESETS) if cardsrc else set()) | (set(tdata.SOURCES) if tdata else set())
            put_setting(conn, "card_games", json.dumps([x for x in d["card_games"] if x in valid]))
        put_setting(conn, "onboarded", "1")
        bump()
        self._send(200, {"ok": True})

    def post_cardhub_listsets(self, conn, d):
        g = d.get("game")
        games = list(DOWNLOADERS) if g in (None, "", "all") else [g]
        if any(x not in DOWNLOADERS for x in games):
            raise ValueError("Unknown game")
        self._send(200, {"started": start_job("cards-listsets", job_cards_listsets(games))})

    def _known_game(self, conn, game):
        if game not in DOWNLOADERS and not conn.execute("SELECT 1 FROM cg_games WHERE id=?", (game,)).fetchone():
            raise ValueError("Unknown game")

    def post_cardhub_notes(self, conn, d):
        self._known_game(conn, d.get("game"))
        conn.execute("INSERT OR REPLACE INTO cg_text VALUES (?,?,?,0)", (d["game"], "notes", d.get("body", "")))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cardhub_doc_add(self, conn, d):
        self._known_game(conn, d.get("game"))
        path, url = (d.get("path") or "").strip().strip('"'), (d.get("url") or "").strip()
        if path:
            if not os.path.isfile(path) or os.path.splitext(path)[1].lower() not in DOC_EXT:
                raise ValueError("That file does not exist, or is not a PDF, text, HTML or image file")
        elif not re.match(r"https?://", url):
            raise ValueError("Enter a web address (https://...) or the path of a file")
        title = (d.get("title") or "").strip() or os.path.basename(path) or url
        conn.execute("INSERT INTO cg_docs (game, title, path, url, added) VALUES (?,?,?,?,?)", (d["game"], title, path, url, time.time()))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cardhub_doc_delete(self, conn, d):
        conn.execute("DELETE FROM cg_docs WHERE id=?", (int(d["id"]),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cardhub_update_add(self, conn, d):
        self._known_game(conn, d.get("game"))
        title = (d.get("title") or "").strip()
        if not title:
            raise ValueError("Enter a title")
        day = (d.get("date") or time.strftime("%Y-%m-%d"))[:10]
        conn.execute("INSERT INTO cg_updates (game, date, title, body, url, source, guid, demo) VALUES (?,?,?,?,?,?,?,0)",
                     (d["game"], day, title, d.get("body", ""), d.get("url", ""), "mine", f"mine:{time.time()}"))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cardhub_update_delete(self, conn, d):
        conn.execute("DELETE FROM cg_updates WHERE id=?", (int(d["id"]),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cardhub_source_add(self, conn, d):
        self._known_game(conn, d.get("game"))
        url = (d.get("url") or "").strip()
        if not re.match(r"https?://", url):
            raise ValueError("Enter the web address of an RSS or Atom feed (https://...)")
        conn.execute("INSERT OR IGNORE INTO cg_sources (game, label, url) VALUES (?,?,?)", (d["game"], (d.get("label") or "").strip(), url))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cardhub_source_delete(self, conn, d):
        conn.execute("DELETE FROM cg_sources WHERE id=?", (int(d["id"]),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cardhub_updates_refresh(self, conn, d):
        self._known_game(conn, d.get("game"))
        self._send(200, {"started": start_job("updates", job_updates_refresh(d["game"]))})

    def post_cardhub_setdate(self, conn, d):
        day = (d.get("date") or "").strip()
        if day and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
            raise ValueError("Use the form 2024-03-15")
        conn.execute("UPDATE cg_sets SET released=? WHERE game=? AND code=?", (day, d["game"], d["set"]))
        conn.commit()
        self._send(200, {"ok": True})

    def post_bgg_csv(self, conn, d):
        text = d.get("csv") or ""
        bgg_parse_csv(text)                      # fail early, with a clear message, if this is not a BGG export
        self._send(200, {"started": start_job("bgg", job_bgg_csv(text, bool(d.get("covers")), d.get("wishlist", True)))})

    def post_bgg_sync(self, conn, d):
        user, token = (d.get("username") or "").strip(), (d.get("token") or "").strip() or get_setting(conn, "bgg_token")
        if not user:
            raise ValueError("Enter your BoardGameGeek user name")
        if not token:
            raise ValueError("Live sync needs a BoardGameGeek application token. Import your collection file instead, or see the note in this window.")
        put_setting(conn, "bgg_user", user)
        if d.get("token"):
            put_setting(conn, "bgg_token", token)
        self._send(200, {"started": start_job("bgg", job_bgg_sync(user, token, bool(d.get("covers")), d.get("wishlist", True)))})

    def post_cardhub_ownpics(self, conn, d):
        game, folder = d.get("game") or "", (d.get("folder") or "").strip().strip('"')
        if d.get("remove"):
            f = jl(get_setting(conn, "own_pic_folders"), {}) or {}
            f[game] = [x for x in f.get(game, []) if x != folder]
            put_setting(conn, "own_pic_folders", json.dumps(f))
            return self._send(200, {"folders": f.get(game, [])})
        if not folder or not os.path.isdir(folder):
            raise ValueError("That folder was not found. Copy its path from the address bar of File Explorer (for example E:\\CCG\\My cards).")
        self._send(200, {"started": start_job("cards-ownpics", job_own_pictures(game, folder))})

    def post_cardhub_towebp(self, conn, d):
        game = d.get("game") or ""
        folder = (d.get("folder") or "").strip().strip('"') or (game_folder(conn, game) if game in DOWNLOADERS else "")
        if not folder or not os.path.isdir(folder):
            raise ValueError("That folder was not found. Copy its path from the address bar of File Explorer.")
        q = max(50, min(100, int(d.get("quality") or 90)))
        self._send(200, {"started": start_job("cards-webp", job_to_webp(game, folder, bool(d.get("replace")), bool(d.get("lossless")), q))})

    def post_cardhub_rescan(self, conn, d):
        if d.get("game") not in DOWNLOADERS:
            raise ValueError("Unknown game")
        self._send(200, {"started": start_job("cards-rescan", job_cards_rescan(d["game"]))})

    def post_cardhub_folder(self, conn, d):
        game, folder = d.get("game"), (d.get("folder") or "").strip().strip('"')
        if game not in DOWNLOADERS:
            raise ValueError("Unknown game")
        put_setting(conn, "cards_folder" if game == "mtg" else f"cards_folder_{game}", os.path.normpath(folder))
        self._send(200, {"ok": True})

    def post_setup_run(self, conn, d):
        self._send(200, {"started": run_setup()})

    def post_demo_load(self, conn, d):
        self._send(200, {"started": start_job("demo", job_demo_load)})

    def post_demo_remove(self, conn, d):
        self._send(200, {"started": start_job("demo", job_demo_remove)})

    def post_tidy_plan(self, conn, d):
        tm, src, dest, groups = _tidy_plan(d, bool(d.get("rescan")))
        sc = TIDY["scan"]
        for g in groups:
            for it in g["items"]:
                it["extra"] = len(it["extra"])
        self._send(200, {"src": src, "dest": dest, "groups": groups, "files": len(sc["files"]), "skipped": sc["skipped"],
                         "truncated": sc["truncated"], "moves": sum(g["moves"] for g in groups)})

    def post_tidy_apply(self, conn, d):
        tm, src, dest, groups = _tidy_plan(d)
        picked = set(d.get("selected") or [])
        items = [it for g in groups for it in g["items"] if it["status"] == "move" and it["src"] in picked]
        if not items:
            raise ValueError("Nothing is ticked.")
        ok = start_job("tidy", lambda c, say, progress: job_tidy_apply(c, say, progress, tm, items, dest))
        self._send(200, {"started": ok, "count": len(items)})

    def post_tidy_history(self, conn, d):
        tm = _tidy_module()
        self._send(200, {"batches": tm.history(conn)})

    def post_tidy_undo(self, conn, d):
        tm = _tidy_module()
        batch = int(d.get("batch"))
        ok = start_job("tidy", lambda c, say, progress: job_tidy_undo(c, say, progress, tm, batch))
        self._send(200, {"started": ok})

    def post_proxy_resolve(self, conn, d):
        game = d.get("game")
        if not conn.execute("SELECT 1 FROM cg_games WHERE id=?", (game,)).fetchone():
            raise ValueError("Unknown game")
        owned = hub_owned(conn, game)
        self._send(200, {"results": [dict(name=e["name"], cands=proxy_candidates(conn, game, e["name"], owned)) for e in (d.get("entries") or [])[:400]]})

    def post_proxy_art_delete(self, conn, d):
        r = conn.execute("SELECT file FROM proxy_art WHERE id=?", (int(d["id"]),)).fetchone()
        conn.execute("DELETE FROM proxy_art WHERE id=?", (int(d["id"]),))
        if r and not conn.execute("SELECT 1 FROM proxy_art WHERE file=?", (r["file"],)).fetchone():
            (PROXY_DIR / r["file"]).unlink(missing_ok=True)
        conn.commit()
        self._send(200, {"ok": True})

    def post_proxy_decks_save(self, conn, d):
        name = (d.get("name") or "").strip() or "My deck"
        row = conn.execute("SELECT id FROM proxy_decks WHERE name=? AND game=?", (name, d.get("game", ""))).fetchone()
        vals = (name, d.get("game", ""), json.dumps(d.get("entries") or []), json.dumps(d.get("settings") or {}), time.time())
        if row:
            conn.execute("UPDATE proxy_decks SET name=?, game=?, entries=?, settings=?, updated=? WHERE id=?", vals + (row["id"],))
        else:
            conn.execute("INSERT INTO proxy_decks (name, game, entries, settings, updated) VALUES (?,?,?,?,?)", vals)
        conn.commit()
        self._send(200, {"ok": True})

    def post_proxy_decks_delete(self, conn, d):
        conn.execute("DELETE FROM proxy_decks WHERE id=?", (int(d["id"]),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_cards_index(self, conn, d):
        self._send(200, {"started": start_job("cards", job_cards_index)})

    def post_cards_import(self, conn, d):
        self._send(200, import_phone_cards(conn, d))

    def post_cards_add(self, conn, d):
        qty = owned_change(conn, d["id"], 1 if d.get("foil") else 0, int(d.get("delta", 1)), int(d.get("owner", 0)),
                           d.get("location", ""))
        self._send(200, {"qty": qty})

    def music_get(self, conn, path, q):
        if path == "/api/music/tracks":
            return self._send(200, music_album(conn, q.get("id", "")))
        if q.get("t") != TOKEN:
            return self._error(403, "Missing token - reload the page.")
        p = self._catalog_file(conn, q.get("path", ""), AUDIO_EXT)
        ext = os.path.splitext(p)[1].lower()
        if path == "/api/music/file":
            return self.serve_file(p, AUDIO_MIME.get(ext, "application/octet-stream"))
        if path == "/api/music/stream":
            return self.stream_audio(p, max(0.0, float(q.get("start", "0") or 0)))
        return self._error(404, "Not found")

    def stream_audio(self, path, start):
        """Convert a file the browser cannot play (WMA, APE, WavPack, AIFF ...) to MP3 on the fly (needs ffmpeg)."""
        ff = ffbin("ffmpeg")
        if not ff:
            raise ValueError("ffmpeg is not installed, so this file cannot be converted for the browser. Open Settings > Components.")
        proc = subprocess.Popen([ff, "-v", "error", "-ss", f"{start:.3f}", "-i", path, "-vn", "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            fd = proc.stdout.fileno()
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

    def watch_get(self, conn, path, q):
        if q.get("t") != TOKEN:
            return self._error(403, "Missing token - reload the page.")
        p = self._catalog_file(conn, q.get("path", ""), VIDEO_EXT)
        ext = os.path.splitext(p)[1].lower()
        if path == "/api/watch/info":
            pr = probe(p)
            r = conn.execute("SELECT * FROM watching WHERE path=?", (p,)).fetchone()
            subs = [dict(id=f"x{i}", label=s["label"]) for i, s in enumerate(external_subs(p))]
            if pr and ffbin("ffmpeg"):
                subs += [dict(id=f"e{i}", label=sub_label(s, i)) for i, s in enumerate(pr["subs"])
                         if s["codec"] in TEXT_SUBS]
            return self._send(200, dict(
                title=os.path.splitext(os.path.basename(p))[0], duration=(pr or {}).get("duration", 0),
                mode=recommend_mode(p, pr), ffmpeg=bool(ffbin("ffmpeg")), probed=pr is not None,
                vcodec=(pr or {}).get("vcodec", ""),
                audio=[dict(label=sub_label(a, i) + (f" ({a['codec']})" if a["codec"] else ""))
                       for i, a in enumerate((pr or {}).get("audio", []))],
                subs=subs, resume=(dict(pos=r["pos"], duration=r["duration"], finished=bool(r["finished"]))
                                   if r else None)))
        if path == "/api/watch/file":
            return self.serve_file(p, VIDEO_MIME.get(ext, "application/octet-stream"))
        if path == "/api/watch/stream":
            return self.stream_transcode(p, max(0.0, float(q.get("start", "0"))), max(0, int(q.get("a", "0"))))
        if path == "/api/watch/sub":
            sid = q.get("s", "")
            if sid[:1] == "x":
                subs = external_subs(p)
                f = subs[int(sid[1:])]["file"]
                with open(f, "rb") as fh:
                    vtt = to_vtt(fh.read())
            elif sid[:1] == "e" and ffbin("ffmpeg"):
                r = subprocess.run([ffbin("ffmpeg"), "-v", "error", "-i", p, "-map", f"0:s:{int(sid[1:])}",
                                    "-f", "webvtt", "pipe:1"], capture_output=True, timeout=300)
                vtt = r.stdout.decode("utf-8", "replace")
                if not vtt.strip():
                    raise ValueError("Could not read that subtitle track")
            else:
                raise KeyError("No such subtitle")
            return self._send(200, vtt, "text/vtt; charset=utf-8")
        return self._error(404, "Not found")

    # ----- card templates (layered PSD): vault_template.py
    def _tpl_path(self, name):
        if not vtpl:
            raise ValueError("vault_template.py is missing next to vault.py")
        f = TEMPLATE_DIR / vtpl.safe_name(name)
        if not f.exists():
            raise KeyError("That template is not here any more")
        return f

    def template_get(self, path, q):
        if not vtpl:
            return self._error(404, "vault_template.py is missing next to vault.py - update Nightvault")
        if path == "/api/template/cards_status":
            return self._send(200, opc.status(mc.DB_PATH.parent) if opc else dict(have=False, count=0, saved=""))
        if path == "/api/template/cards_find":
            return self._send(200, dict(cards=opc.find(mc.DB_PATH.parent, q.get("q", "")) if opc else []))
        if path == "/api/template/list":
            TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
            return self._send(200, {"templates": [dict(name=f.name, size=f.stat().st_size) for f in sorted(TEMPLATE_DIR.glob("*.psd"))]})
        if path == "/api/template/open":
            return self._send(200, vtpl.structure(str(self._tpl_path(q.get("name", "")))))
        if q.get("t") != TOKEN:
            return self._error(403, "Missing token - reload the page.")
        if path == "/api/template/layer":
            f = self._tpl_path(q.get("name", ""))
            i = int(q.get("i", "0"))
            if i < 0 or i >= len(vtpl.scan(str(f))["layers"]):
                return self._error(404, "No such layer")
            cdir = TEMPLATE_DIR / "cache" / f"{f.stem}_{int(f.stat().st_mtime)}_{f.stat().st_size}"
            cf = cdir / f"{i}.png"
            if not cf.exists():
                png, left, top = vtpl.layer_png(str(f), i)
                cdir.mkdir(parents=True, exist_ok=True)
                cf.write_bytes(png)
            return self._send(200, cf.read_bytes(), "image/png", {"Cache-Control": "private, max-age=86400"})
        if path == "/api/template/font":
            fn = os.path.basename(q.get("f", ""))
            ff = Path(__file__).resolve().parent / "fonts" / fn
            if fn not in ("Roboto.ttf", "RobotoCondensed.ttf") or not ff.exists():
                return self._error(404, "Font not found - update Nightvault")
            return self._send(200, ff.read_bytes(), "font/ttf", {"Cache-Control": "private, max-age=86400"})
        if path == "/api/template/out":
            f = TEMPLATE_DIR / "out" / vtpl.safe_name(q.get("f", ""))
            if not f.exists():
                return self._error(404, "That file is not here")
            return self._send(200, f.read_bytes(), "application/octet-stream",
                              {"Content-Disposition": 'attachment; filename="%s"' % f.name})
        return self._error(404, "Not found")

    def template_upload(self, q):
        if not vtpl:
            return self._error(404, "vault_template.py is missing next to vault.py - update Nightvault")
        n = int(self.headers.get("Content-Length") or 0)
        if n < 100:
            return self._error(400, "That file is empty")
        name = vtpl.safe_name(q.get("name", "template.psd"))
        TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = TEMPLATE_DIR / (name + ".part")
        got = 0
        with open(tmp, "wb") as f:
            while got < n:
                chunk = self.rfile.read(min(1 << 20, n - got))
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
        try:
            vtpl.scan(str(tmp))                     # refuses files that are not 8-bit RGB PSDs
        except Exception as e:
            tmp.unlink(missing_ok=True)
            return self._error(400, str(e))
        os.replace(tmp, TEMPLATE_DIR / name)
        return self._send(200, {"name": name})

    def post_template_save(self, conn, d):
        f = self._tpl_path(d.get("name", ""))
        stamp = time.strftime("%Y%m%d-%H%M%S")
        out = TEMPLATE_DIR / "out" / f"{f.stem}_custom_{stamp}.psd"
        vtpl.save_psd(str(f), str(out), d.get("visible") or [])
        return self._send(200, {"file": out.name, "folder": str(out.parent)})

    def post_template_cards_update(self, conn, d):
        if not opc:
            raise ValueError("vault_opcards.py is missing next to vault.py - update Nightvault")
        return self._send(200, opc.update(mc.DB_PATH.parent, _fetch))

    def post_template_delete(self, conn, d):
        f = self._tpl_path(d.get("name", ""))
        f.unlink()
        return self._send(200, {"ok": True})

    def serve_file(self, path, ctype):
        """Send a file, answering HTTP Range requests so the video can be skipped through."""
        size = os.path.getsize(path)
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
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
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            if code == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(262144, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def stream_transcode(self, path, start, audio):
        """Convert on the fly to a browser-friendly MP4 stream (needs ffmpeg)."""
        cmd = transcode_cmd(path, start, audio)
        if not cmd:
            raise ValueError("ffmpeg is not installed, so this file cannot be converted for the browser.")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            fd = proc.stdout.fileno()
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

    def export_missing(self, conn):
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["Type", "Title", "Where", "Missing"])
        for g in sorted(get_groups(conn, False), key=lambda g: (g["cat"], g["name"].lower())):
            for where, what in g["missing"]:
                w.writerow([mc.CAT_NAMES.get(g["cat"], g["cat"]), g["name"], where, what])
        self._send(200, "\ufeff" + buf.getvalue(), "text/csv; charset=utf-8",
                   {"Content-Disposition": 'attachment; filename="missing_items.csv"'})

    # ----- POST pieces
    def cover_set(self, conn, gid):
        body = self._body()
        if not gid or not body:
            raise ValueError("No image received")
        if len(body) > 12 * 1024 * 1024:
            raise ValueError("Image is larger than 12 MB")
        ctype = (self.headers.get("Content-Type") or "").lower()
        ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(ctype)
        if not ext:
            raise ValueError("Use a PNG, JPG, WEBP or GIF image")
        COVER_DIR.mkdir(exist_ok=True)
        name = hashlib.sha1(gid.encode()).hexdigest() + ext
        old = conn.execute("SELECT file FROM covers WHERE key=?", (gid,)).fetchone()
        if old and old["file"] != name:
            (COVER_DIR / old["file"]).unlink(missing_ok=True)
        (COVER_DIR / name).write_bytes(body)
        conn.execute("INSERT OR REPLACE INTO covers VALUES (?,?)", (gid, name))
        conn.execute("DELETE FROM auto_covers WHERE key=?", (gid,))
        if gid.startswith("m:") and gid[2:].isdigit():
            conn.execute("UPDATE manual_items SET pic_url=NULL WHERE id=?", (int(gid[2:]),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_read_progress(self, conn, d):
        p = self._catalog_file(conn, d.get("path", ""))
        total = max(1, int(d.get("total", 1)))
        page = min(max(1, int(d.get("page", 1))), total)
        finished = 1 if d.get("finished") else 0
        conn.execute("INSERT OR REPLACE INTO reading VALUES (?,?,?,?,?)", (p, page, total, finished, time.time()))
        conn.commit()
        self._send(200, {"ok": True})

    def post_watch_progress(self, conn, d):
        p = self._catalog_file(conn, d.get("path", ""), VIDEO_EXT)
        pos = max(0.0, float(d.get("pos", 0)))
        dur = max(0.0, float(d.get("duration", 0)))
        conn.execute("INSERT OR REPLACE INTO watching VALUES (?,?,?,?,?)",
                     (p, pos, dur, 1 if d.get("finished") else 0, time.time()))
        conn.commit()
        self._send(200, {"ok": True})

    def post_book_progress(self, conn, d):
        p = self._catalog_file(conn, d.get("path", ""), BOOK_EXT)
        pct = min(1.0, max(0.0, float(d.get("percent", 0))))
        conn.execute("INSERT OR REPLACE INTO bookprog VALUES (?,?,?,?,?,?)",
                     (p, int(d.get("chapter", 0)), min(1.0, max(0.0, float(d.get("ratio", 0)))), pct,
                      1 if d.get("finished") else 0, time.time()))
        conn.commit()
        self._send(200, {"ok": True})

    def post_book_clear(self, conn, d):
        conn.execute("DELETE FROM bookprog WHERE path=?", (d.get("path", ""),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_covers_fetch(self, conn, d):
        self._need_online()
        only, coll = self._scope(d, tuple(c["id"] for c in all_collections(conn) if c["kind"] in ("comic", "manga", "book", "model3d", "music") or c["id"] in ("movie", "series")))
        self._send(200, {"started": start_job("covers", job_covers(only, coll))})

    def _scope(self, d, allowed=("movie", "series", "comic")):
        """Which titles an online job should look at: one title (id), one collection (coll) or all."""
        only, coll = None, None
        if d.get("id"):
            if "|" not in d["id"]:
                raise ValueError("Only scanned titles can be checked online")
            cat, gkey = d["id"].split("|", 1)
            only = (cat, gkey)
        elif d.get("coll"):
            if d["coll"] not in allowed:
                raise ValueError("That collection has no online check")
            coll = d["coll"]
        return only, coll

    def post_watch_clear(self, conn, d):
        conn.execute("DELETE FROM watching WHERE path=?", (d.get("path", ""),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_read_clear(self, conn, d):
        conn.execute("DELETE FROM reading WHERE path=?", (d.get("path", ""),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_dtrpg_status(self, conn, d):
        self._send(200, {"has_key": bool(get_setting(conn, "dtrpg_key"))})

    def post_dtrpg_key(self, conn, d):
        dt = _dtrpg_module()
        key = (d.get("key") or "").strip() or get_setting(conn, "dtrpg_key")
        if not key:
            raise ValueError("Paste your Library App Key first.")
        try:
            dt.login(key)
        except dt.DtrpgError as e:
            raise ValueError(str(e))
        put_setting(conn, "dtrpg_key", key)
        self._send(200, {"ok": True})

    def post_dtrpg_sync(self, conn, d):
        _dtrpg_module()
        self._send(200, {"started": start_job("dtrpg", job_dtrpg)})

    def post_photos_delete(self, conn, d):
        r = conn.execute("SELECT file FROM item_photos WHERE id=?", (int(d.get("id", 0)),)).fetchone()
        if r:
            (PHOTO_DIR / r["file"]).unlink(missing_ok=True)
            conn.execute("DELETE FROM item_photos WHERE id=?", (int(d["id"]),))
            conn.commit()
        self._send(200, {"ok": True})

    def post_photos_cover(self, conn, d):
        r = conn.execute("SELECT gid, file FROM item_photos WHERE id=?", (int(d.get("id", 0)),)).fetchone()
        if not r or not (PHOTO_DIR / r["file"]).exists():
            raise KeyError("Photo not found")
        store_cover(conn, r["gid"], (PHOTO_DIR / r["file"]).read_bytes())
        bump()
        self._send(200, {"ok": True})

    def post_lookup_source(self, conn, d):
        """The wiki or API a collection looks things up in. type '' removes it. The key (if any) never goes back to the page."""
        cid = d.get("coll", "")
        if cid not in coll_map(conn):
            raise ValueError("Unknown collection")
        srcs = jl(get_setting(conn, "lookup_sources"), {})
        if not d.get("type"):
            srcs.pop(cid, None)
        else:
            if d["type"] not in ("wiki", "api"):
                raise ValueError("Choose a wiki or an API")
            url = (d.get("url") or "").strip()
            if not url:
                raise ValueError("Paste the address first")
            old = srcs.get(cid, {})
            srcs[cid] = dict(type=d["type"], url=url[:500], key_header=(d.get("key_header") or "").strip()[:40],
                             key=(d.get("key") or "").strip() or (old.get("key", "") if old.get("url") == url else ""), also_wikipedia=bool(d.get("also_wikipedia", True)))
        put_setting(conn, "lookup_sources", json.dumps(srcs))
        bump()
        self._send(200, {"ok": True})

    def post_lookup_source_test(self, conn, d):
        sg = _suggest_module()
        src = dict(type=d.get("type"), url=(d.get("url") or "").strip(), key_header=(d.get("key_header") or "").strip(),
                   key=(d.get("key") or "").strip() or jl(get_setting(conn, "lookup_sources"), {}).get(d.get("coll", ""), {}).get("key", ""))
        try:
            res = sg.custom_results(src, (d.get("query") or "test").strip() or "test")
        except sg.SuggestError as e:
            raise ValueError(str(e))
        self._send(200, {"count": len(res), "first": res[0]["title"] if res else "",
                         "has_text": any(r["extract"] and not r["extract"].startswith("(") for r in res), "has_image": any(r["image"] for r in res)})

    def post_suggest(self, conn, d):
        try:
            sg = _suggest_module()
            src = jl(get_setting(conn, "lookup_sources"), {}).get(d.get("coll", ""))
            self._send(200, sg.suggest(d.get("query", ""), (online.get_setting(conn, "language", "en-US") if online else "en-US").split("-")[0], src))
        except Exception as e:
            if type(e).__name__ == "SuggestError":
                raise ValueError(str(e))
            raise

    def post_suggest_apply(self, conn, d):
        """Keep what was ticked: the description, tags and pictures (the first picture can become the cover)."""
        sg = _suggest_module()
        gid = d.get("id", "")
        if not gid:
            raise ValueError("No item")
        done = dict(text=False, tags=0, photos=0, cover=False)
        if d.get("overview"):
            old = jl((conn.execute("SELECT data FROM meta WHERE gid=?", (gid,)).fetchone() or [None])[0], {}) or {}
            info = dict(old, source="web", overview=str(d["overview"])[:2000], url=str(d.get("url") or old.get("url") or ""),
                        genres=old.get("genres", []), facts=old.get("facts", []), credits=old.get("credits", []), poster=old.get("poster", ""), tagline=old.get("tagline", ""))
            store_meta(conn, gid, "web", info)
            done["text"] = True
        tags = [str(t).strip()[:40] for t in (d.get("tags") or []) if str(t).strip()]
        if tags and gid.startswith("m:"):
            row = conn.execute("SELECT tags FROM manual_items WHERE id=?", (int(gid[2:]),)).fetchone()
            have = jl(row["tags"], []) if row else []
            merged = have + [t for t in tags if t.lower() not in [h.lower() for h in have]]
            conn.execute("UPDATE manual_items SET tags=? WHERE id=?", (json.dumps(merged), int(gid[2:])))
            conn.commit()
            done["tags"] = len(merged) - len(have)
        first = True
        for pic in (d.get("images") or [])[:8]:
            try:
                src = jl(get_setting(conn, "lookup_sources"), {}).get(d.get("coll", "")) or {}
                data = sg.download_image(pic.get("url", ""), extra_hosts=({sg.source_host(src)} if src else set()))
                add_photo(conn, gid, data, pic.get("credit", ""))
                done["photos"] += 1
                if first and d.get("cover"):
                    store_cover(conn, gid, make_thumb(data) or data)
                    done["cover"] = True
                first = False
            except Exception as e:
                done["error"] = str(e)
        bump()
        self._send(200, done)

    def post_cover_page(self, conn, d):
        """Use one page of a comic / PDF as the cover (the first page unless a page number is given). You asked for it, so it replaces any cover."""
        gid = d.get("id", "")
        if "|" not in gid:
            raise ValueError("Only scanned titles can take a cover from their files")
        cat, gkey = gid.split("|", 1)
        g = next((x for x in get_groups(conn, False) if x["cat"] == cat and x["gkey"] == gkey), None)
        if not g:
            raise KeyError("Item not found")
        data = local_cover_data(g, d.get("path") or None, max(0, int(d.get("n", 0))))
        if not data:
            raise ValueError("Nothing in these files can be used as a cover (is the drive connected?)")
        store_cover(conn, gid, data, "local")
        bump()
        self._send(200, {"ok": True})

    def post_cover_reset(self, conn, d):
        r = conn.execute("SELECT file FROM covers WHERE key=?", (d["id"],)).fetchone()
        if r:
            (COVER_DIR / r["file"]).unlink(missing_ok=True)
            conn.execute("DELETE FROM covers WHERE key=?", (d["id"],))
            conn.execute("DELETE FROM auto_covers WHERE key=?", (d["id"],))
            conn.commit()
        self._send(200, {"ok": True})

    def post_ownership(self, conn, d):
        gid = d["id"]
        fmt = d.get("format") if d.get("format") in ("physical", "digital", "both") else "digital"
        owners = json.dumps([int(x) for x in d.get("owners", [])])
        tags = json.dumps([str(t).strip() for t in d.get("tags", []) if str(t).strip()])
        if gid.startswith("m:"):
            conn.execute("UPDATE manual_items SET format=?, owners=?, location=?, notes=?, tags=? WHERE id=?",
                         (fmt, owners, d.get("location", ""), d.get("notes", ""), tags, int(gid[2:])))
        else:
            cat, gkey = gid.split("|", 1)
            conn.execute("INSERT OR REPLACE INTO ownership VALUES (?,?,?,?,?,?,?)",
                         (cat, gkey, fmt, owners, d.get("location", ""), d.get("notes", ""), tags))
        conn.commit()
        self._send(200, {"ok": True})

    def post_manual(self, conn, d):
        name = (d.get("name") or "").strip()
        cat = d.get("cat")
        if not name:
            raise ValueError("Enter a name")
        if cat not in coll_map(conn):
            raise ValueError("Pick a collection")
        fmt = d.get("format") if d.get("format") in ("physical", "digital", "both") else "physical"
        line_id = d.get("line_id")
        if line_id not in (None, ""):
            ln = conn.execute("SELECT cat FROM manual_lines WHERE id=?", (int(line_id),)).fetchone()
            if not ln or ln["cat"] != cat:
                raise ValueError("That product line belongs to another collection")
            line_id = int(line_id)
        else:
            line_id = None
        cur = conn.execute(
            "INSERT INTO manual_items (cat, name, year, format, owners, location, notes, tags, created, line_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cat, name, (d.get("year") or "").strip(), fmt, json.dumps([int(x) for x in d.get("owners", [])]),
             d.get("location", ""), d.get("notes", ""), "[]", time.time(), line_id))
        conn.commit()
        bump()
        self._send(200, {"id": f"m:{cur.lastrowid}"})

    # ---- product lines inside a collection
    def _line(self, conn, lid):
        r = conn.execute("SELECT * FROM manual_lines WHERE id=?", (int(lid or 0),)).fetchone()
        if not r:
            raise KeyError("Product line not found")
        return r

    def _parent(self, conn, cat, pid, me=None):
        if pid in (None, "", 0):
            return None
        p = conn.execute("SELECT * FROM manual_lines WHERE id=?", (int(pid),)).fetchone()
        if not p or p["cat"] != cat:
            raise ValueError("That product line belongs to another collection")
        seen = set()
        while p and p["id"] not in seen:                      # a line cannot go inside itself or one of its own series
            if me is not None and p["id"] == me:
                raise ValueError("A line cannot be placed inside itself")
            seen.add(p["id"])
            p = conn.execute("SELECT * FROM manual_lines WHERE id=?", (p["parent_id"],)).fetchone() if p["parent_id"] else None
        return int(pid)

    def post_line_add(self, conn, d):
        cat, name = d.get("cat"), (d.get("name") or "").strip()[:60]
        if cat not in coll_map(conn):
            raise ValueError("Pick a collection")
        if not name:
            raise ValueError("Give the product line a name")
        par = self._parent(conn, cat, d.get("parent_id"))
        if conn.execute("SELECT 1 FROM manual_lines WHERE cat=? AND lower(name)=lower(?) AND IFNULL(parent_id,0)=?", (cat, name, par or 0)).fetchone():
            raise ValueError("There is already a product line with that name here")
        cur = conn.execute("INSERT INTO manual_lines (cat, name, note, created, parent_id) VALUES (?,?,?,?,?)", (cat, name, (d.get("note") or "")[:2000], time.time(), par))
        conn.commit()
        bump()
        self._send(200, {"id": cur.lastrowid})

    def post_line_update(self, conn, d):
        r = self._line(conn, d.get("id"))
        name = (d.get("name") or r["name"]).strip()[:60] or r["name"]
        par = self._parent(conn, r["cat"], d["parent_id"], r["id"]) if "parent_id" in d else r["parent_id"]
        if conn.execute("SELECT 1 FROM manual_lines WHERE cat=? AND lower(name)=lower(?) AND id<>? AND IFNULL(parent_id,0)=?", (r["cat"], name, r["id"], par or 0)).fetchone():
            raise ValueError("There is already a product line with that name here")
        conn.execute("UPDATE manual_lines SET name=?, note=?, parent_id=? WHERE id=?", (name, (d["note"] if "note" in d else r["note"] or "")[:2000], par, r["id"]))
        conn.commit()
        bump()
        self._send(200, {"ok": True})

    def post_line_delete(self, conn, d):
        """The line goes; its items stay in the collection (or are deleted too when asked). Its series move up one level."""
        r = self._line(conn, d.get("id"))
        n = 0
        if d.get("delete_items"):
            for it in conn.execute("SELECT id FROM manual_items WHERE line_id=?", (r["id"],)).fetchall():
                gid = f"m:{it['id']}"
                photo_delete_files(conn, gid)
                conn.execute("DELETE FROM meta WHERE gid=?", (gid,))
                cv = conn.execute("SELECT file FROM covers WHERE key=?", (gid,)).fetchone()
                if cv:
                    (COVER_DIR / cv["file"]).unlink(missing_ok=True)
                    conn.execute("DELETE FROM covers WHERE key=?", (gid,))
                conn.execute("DELETE FROM manual_items WHERE id=?", (it["id"],))
                n += 1
        else:
            conn.execute("UPDATE manual_items SET line_id=NULL WHERE line_id=?", (r["id"],))
        conn.execute("UPDATE manual_lines SET parent_id=? WHERE parent_id=?", (r["parent_id"], r["id"]))
        line_delete_files(conn, r["id"])
        conn.execute("DELETE FROM manual_lines WHERE id=?", (r["id"],))
        conn.commit()
        bump()
        self._send(200, {"deleted_items": n})

    def post_line_cover(self, conn, d):
        """Use the picture of one of the line's items as the line's own picture (or drop the line's own picture)."""
        r = self._line(conn, d.get("id"))
        if d.get("reset"):
            line_delete_files(conn, r["id"])
            conn.commit()
            bump()
            return self._send(200, {"ok": True})
        gid = d.get("from", "")
        cv = conn.execute("SELECT file FROM covers WHERE key=?", (gid,)).fetchone() if gid.startswith("m:") else None
        if not cv or not (COVER_DIR / cv["file"]).exists():
            raise ValueError("That item has no picture")
        store_cover(conn, f"l:{r['id']}", (COVER_DIR / cv["file"]).read_bytes())
        bump()
        self._send(200, {"ok": True})

    def post_line_add_names(self, conn, d):
        """Quick add: one item per line of text."""
        r = self._line(conn, d.get("id"))
        have = {x["name"].lower() for x in conn.execute("SELECT name FROM manual_items WHERE cat=?", (r["cat"],))}
        added = 0
        for raw in re.split(r"[\r\n]+", d.get("names") or ""):
            nm = raw.strip(" \t,;")[:120]
            if nm and nm.lower() not in have:
                new_manual_item(conn, r["cat"], nm, r["id"])
                have.add(nm.lower())
                added += 1
        conn.commit()
        bump()
        self._send(200, {"added": added})

    def post_manual_move(self, conn, d):
        """Put items into a product line (line_id empty = back to the collection's own page)."""
        ids = [int(str(x)[2:]) for x in d.get("ids", []) if str(x).startswith("m:")]
        lid = d.get("line_id")
        if lid in (None, ""):
            lid = None
        for i in ids:
            row = conn.execute("SELECT cat FROM manual_items WHERE id=?", (i,)).fetchone()
            if not row:
                continue
            if lid is not None:
                ln = conn.execute("SELECT cat FROM manual_lines WHERE id=?", (int(lid),)).fetchone()
                if not ln or ln["cat"] != row["cat"]:
                    raise ValueError("That product line belongs to another collection")
            conn.execute("UPDATE manual_items SET line_id=? WHERE id=?", (int(lid) if lid is not None else None, i))
        conn.commit()
        bump()
        self._send(200, {"ok": True})

    def post_line_find(self, conn, d):
        """Look for things that belong in a line on the web: a list of finds, each with a picture and a description."""
        r = self._line(conn, d.get("id"))
        sg = _suggest_module()
        coll = coll_map(conn).get(r["cat"], {})
        query = (d.get("query") or "").strip() or f"{r['name']} {coll.get('name', '')}".strip()
        try:
            src = jl(get_setting(conn, "lookup_sources"), {}).get(r["cat"])
            res = sg.suggest(query, (online.get_setting(conn, "language", "en-US") if online else "en-US").split("-")[0], src, limit=12)
        except Exception as e:
            if type(e).__name__ == "SuggestError":
                raise ValueError(str(e))
            raise
        have = {x["name"].lower() for x in conn.execute("SELECT name FROM manual_items WHERE cat=?", (r["cat"],))}
        for x in res["results"]:
            x["have"] = x["title"].lower() in have
        res["query"] = query
        self._send(200, res)

    def post_line_add_items(self, conn, d):
        """Add what was ticked as new items of the line, with description, tags and the picture as cover."""
        r = self._line(conn, d.get("id"))
        sg = _suggest_module()
        src = jl(get_setting(conn, "lookup_sources"), {}).get(r["cat"]) or {}
        extra = {sg.source_host(src)} if src else set()
        have = {x["name"].lower() for x in conn.execute("SELECT name FROM manual_items WHERE cat=?", (r["cat"],))}
        added, pics, skipped = 0, 0, 0
        for it in (d.get("items") or [])[:40]:
            title = str(it.get("title") or "").strip()[:120]
            if not title or title.lower() in have:
                skipped += 1
                continue
            tags = [str(t).strip()[:40] for t in (it.get("tags") or []) if str(t).strip()][:10]
            gid = new_manual_item(conn, r["cat"], title, r["id"], tags=tags)
            have.add(title.lower())
            added += 1
            if it.get("extract"):
                store_meta(conn, gid, "web", dict(source="web", overview=str(it["extract"])[:2000], url=str(it.get("url") or ""), genres=[], facts=[], credits=[], poster="", tagline=""))
            if it.get("image"):
                try:
                    data = sg.download_image(it["image"], extra_hosts=extra)
                    add_photo(conn, gid, data, str(it.get("credit") or "")[:120])
                    store_cover(conn, gid, make_thumb(data) or data)
                    pics += 1
                except Exception:
                    pass
        conn.commit()
        bump()
        self._send(200, {"added": added, "pictures": pics, "skipped": skipped})

    def post_wiki_outline(self, conn, d):
        """Read a wiki page and show what lists it contains (headings = product lines, entries = items)."""
        sg = _suggest_module()
        url = (d.get("url") or "").strip()
        try:
            res = sg.wiki_outline(url)
        except Exception as e:
            if type(e).__name__ == "SuggestError":
                raise ValueError(str(e))
            raise
        have = {x["name"].lower() for x in conn.execute("SELECT name FROM manual_items WHERE cat=?", (d.get("cat"),))}
        for g in res["groups"]:
            for it in g["items"]:
                it["have"] = it["name"].lower() in have
        self._send(200, res)

    def post_pics_drop(self, conn, d):
        """Pictures that no longer exist on the wiki (the browser got 404): stop trying."""
        for gid in (d.get("ids") or [])[:3000]:
            if str(gid).startswith("m:") and str(gid)[2:].isdigit():
                conn.execute("UPDATE manual_items SET pic_url=NULL WHERE id=?", (int(str(gid)[2:]),))
        conn.commit()
        self._send(200, {"ok": True})

    def post_wiki_children(self, conn, d):
        """Look inside the wiki pages of some entries: a page lists its sections (series) and the single items in them."""
        sg = _suggest_module()
        ents = [(str(e.get("page") or "")[:200], str(e.get("frag") or "")[:200], str(e.get("name") or "")[:200]) for e in (d.get("entries") or [])[:12]]
        try:
            root, apis = sg.wiki_apis((d.get("url") or "").strip())
            res = sg.wiki_children(root, apis, ents)
        except Exception as e:
            if type(e).__name__ == "SuggestError":
                raise ValueError(str(e))
            raise
        for groups in res.values():                           # the same name (Grin Grin ...) is normal in many series: duplicates are only checked inside a line
            for g in groups:
                for it in g["items"]:
                    it["have"] = False
        self._send(200, {"children": res})

    def post_wiki_import(self, conn, d):
        cat = d.get("cat")
        if cat not in coll_map(conn):
            raise ValueError("Pick a collection")
        budget = [4000]

        def clean(nodes, depth=0):
            out = []
            for n in (nodes or [])[:300]:
                if depth > 4:
                    break
                its = []
                for i in (n.get("items") or [])[:1500]:
                    if budget[0] <= 0:
                        break
                    budget[0] -= 1
                    its.append(dict(name=str(i.get("name") or "")[:120], page=str(i.get("page") or "")[:200], image=str(i.get("image") or "")[:600]))
                out.append(dict(title=str(n.get("title") or "")[:60], page=str(n.get("page") or "")[:200], image=str(n.get("image") or "")[:600], items=its, lines=clean(n.get("lines"), depth + 1)))
            return out

        def has_any(ns):
            return any(n["items"] or has_any(n["lines"]) for n in ns)
        tree = clean(d.get("tree"))
        if not has_any(tree):
            raise ValueError("Nothing was ticked")
        url = (d.get("url") or "").strip()
        if d.get("save_source") and not (jl(get_setting(conn, "lookup_sources"), {}).get(cat)):
            sg = _suggest_module()
            root, _ = sg.wiki_apis(url)
            ls = jl(get_setting(conn, "lookup_sources"), {})
            ls[cat] = dict(type="wiki", url=root, key_header="", key="", also_wikipedia=True)
            put_setting(conn, "lookup_sources", json.dumps(ls))
        self._send(200, {"started": start_job("wiki-import", job_wiki_import(cat, url, tree, bool(d.get("details", True))))})

    def post_manual_delete(self, conn, d):
        gid = d["id"]
        if not gid.startswith("m:"):
            raise ValueError("Only items added by hand can be deleted")
        conn.execute("DELETE FROM manual_items WHERE id=?", (int(gid[2:]),))
        photo_delete_files(conn, gid)
        r = conn.execute("SELECT file FROM covers WHERE key=?", (gid,)).fetchone()
        if r:
            (COVER_DIR / r["file"]).unlink(missing_ok=True)
            conn.execute("DELETE FROM covers WHERE key=?", (gid,))
        conn.commit()
        self._send(200, {"ok": True})

    def post_collections(self, conn, d):
        known = coll_map(conn)
        old = jl(get_setting(conn, "collections"), {})
        new = {"order": [c for c in d.get("order", []) if c in known],
               "enabled": [c for c in d.get("enabled", []) if c in known]}
        for k in ("groups", "collapsed"):         # sidebar layout: group order, folded groups - kept when only the order is saved
            v = d.get(k, old.get(k))
            if isinstance(v, list):
                new[k] = [str(x)[:30] for x in v][:60]
        gm = d.get("gmap", old.get("gmap"))
        if isinstance(gm, dict):
            defaults = {c["id"]: c["group"] for c in COLLECTIONS}
            defaults.update({c["id"]: c.get("group") or "Other" for c in jl(get_setting(conn, "custom_colls"), []) if c.get("id")})
            new["gmap"] = {k: str(v)[:20] for k, v in gm.items() if k in known and str(v).strip() and str(v)[:20] != defaults.get(k)}
        put_setting(conn, "collections", json.dumps(new))
        bump()
        self._send(200, {"ok": True})

    def post_collections_add(self, conn, d):
        name = (d.get("name") or "").strip()[:40]
        kind = d.get("kind")
        if not name:
            raise ValueError("Give the collection a name")
        if kind not in KINDS or kind == "card":
            raise ValueError("Pick what the collection should work like")
        existing = coll_map(conn)
        if any(c["name"].lower() == name.lower() for c in existing.values()):
            raise ValueError("There is already a collection with that name")
        base = "x_" + (re.sub(r"[^a-z0-9]+", "", name.lower()) or "collection")[:20]
        cid, n = base, 2
        while cid in existing:
            cid, n = f"{base}{n}", n + 1
        icon = d.get("icon") if re.fullmatch(r"[a-z0-9-]{2,32}", d.get("icon") or "") else "folder"
        customs = jl(get_setting(conn, "custom_colls"), [])
        customs.append(dict(id=cid, name=name, group=((d.get("group") or "").strip()[:20] or "Other"), icon=icon, kind=kind))
        put_setting(conn, "custom_colls", json.dumps(customs))
        saved = jl(get_setting(conn, "collections"), {})
        if saved:                                         # show the new one in the sidebar straight away
            saved["order"] = saved.get("order", []) + [cid]
            saved["enabled"] = saved.get("enabled", []) + [cid]
            put_setting(conn, "collections", json.dumps(saved))
        bump()
        self._send(200, {"id": cid})

    def post_collections_update(self, conn, d):
        customs = jl(get_setting(conn, "custom_colls"), [])
        c = next((x for x in customs if x.get("id") == d.get("id")), None)
        if not c:
            raise ValueError("Only collections you created yourself can be changed")
        name = (d.get("name") or c["name"]).strip()[:40]
        if any(x["id"] != c["id"] and x["name"].lower() == name.lower() for x in all_collections(conn)):
            raise ValueError("There is already a collection with that name")
        c["name"] = name
        c["group"] = (d.get("group") or c["group"]).strip()[:20] or "Other"
        sv = jl(get_setting(conn, "collections"), {})
        if sv.get("gmap", {}).pop(c["id"], None) is not None:        # the group chosen here replaces one dragged in the sidebar
            put_setting(conn, "collections", json.dumps(sv))
        if re.fullmatch(r"[a-z0-9-]{2,32}", d.get("icon") or ""):
            c["icon"] = d["icon"]
        put_setting(conn, "custom_colls", json.dumps(customs))
        bump()
        self._send(200, {"ok": True})

    def post_collections_delete(self, conn, d):
        cid = d.get("id")
        customs = jl(get_setting(conn, "custom_colls"), [])
        if not any(x.get("id") == cid for x in customs):
            raise ValueError("Only collections you created yourself can be removed")
        gone = 0
        for r in conn.execute("SELECT id FROM manual_items WHERE cat=?", (cid,)).fetchall():       # what was added by hand to it
            gid = f"m:{r['id']}"
            conn.execute("DELETE FROM manual_items WHERE id=?", (r["id"],))
            photo_delete_files(conn, gid)
            conn.execute("DELETE FROM meta WHERE gid=?", (gid,))
            cv = conn.execute("SELECT file FROM covers WHERE key=?", (gid,)).fetchone()
            if cv:
                (COVER_DIR / cv["file"]).unlink(missing_ok=True)
                conn.execute("DELETE FROM covers WHERE key=?", (gid,))
            gone += 1
        for ln in conn.execute("SELECT id FROM manual_lines WHERE cat=?", (cid,)).fetchall():
            line_delete_files(conn, ln["id"])
        conn.execute("DELETE FROM manual_lines WHERE cat=?", (cid,))
        conn.execute("DELETE FROM folder_coll WHERE coll=?", (cid,))                                  # scanned files go back to their usual place
        conn.execute("DELETE FROM wishlist WHERE cat=?", (cid,))
        put_setting(conn, "custom_colls", json.dumps([x for x in customs if x.get("id") != cid]))
        saved = jl(get_setting(conn, "collections"), {})
        if saved:
            put_setting(conn, "collections", json.dumps({"order": [c for c in saved.get("order", []) if c != cid], "enabled": [c for c in saved.get("enabled", []) if c != cid]}))
        conn.commit()
        bump()
        self._send(200, {"removed_items": gone})

    def post_roots_collection(self, conn, d):
        path, coll = os.path.normpath(d.get("path") or ""), d.get("coll") or ""
        if coll:
            c = coll_map(conn).get(coll)
            if not c or not KINDS[c["kind"]]["cats"]:
                raise ValueError("That collection cannot hold scanned files")
            conn.execute("INSERT OR REPLACE INTO folder_coll VALUES (?,?)", (path, coll))
        else:
            conn.execute("DELETE FROM folder_coll WHERE path=?", (path,))
        conn.commit()
        bump()
        self._send(200, {"ok": True})

    def post_people(self, conn, d):
        name = (d.get("name") or "").strip()
        if not name:
            raise ValueError("Enter a name")
        color = d.get("color") if re.fullmatch(r"#[0-9a-fA-F]{6}", d.get("color") or "") else "#6ea8ff"
        conn.execute("INSERT OR REPLACE INTO people (id, name, color) VALUES "
                     "((SELECT id FROM people WHERE name=?), ?, ?)", (name, name, color))
        conn.commit()
        self._send(200, {"ok": True})

    def post_people_delete(self, conn, d):
        pid = int(d["id"])
        conn.execute("DELETE FROM people WHERE id=?", (pid,))
        conn.commit()
        self._send(200, {"ok": True})

    def post_roots(self, conn, d):
        p = os.path.normpath((d.get("path") or "").strip().strip('"'))
        if not d.get("path", "").strip():
            raise ValueError("Type or paste a folder path")
        if not os.path.isdir(p):
            raise ValueError(f"That folder does not exist: {p}")
        conn.execute("INSERT OR IGNORE INTO roots VALUES (?)", (p,))
        conn.commit()
        self._send(200, {"ok": True})

    def post_roots_drives(self, conn, d):
        drives = mc.all_drives()
        for dr in drives:
            conn.execute("INSERT OR IGNORE INTO roots VALUES (?)", (dr,))
        conn.commit()
        self._send(200, {"added": drives})

    def post_roots_remove(self, conn, d):
        conn.execute("DELETE FROM roots WHERE path=?", (d["path"],))
        conn.execute("DELETE FROM files WHERE root=?", (d["path"],))
        conn.execute("DELETE FROM folder_coll WHERE path=? OR path LIKE ?", (os.path.normpath(d["path"]), os.path.normpath(d["path"]).rstrip(os.sep) + os.sep + "%"))
        conn.commit()
        bump()
        self._send(200, {"ok": True})

    def post_scan(self, conn, d):
        self._send(200, {"started": start_job("scan", job_scan)})

    def post_job_stop(self, conn, d):
        STOP.set()
        self._send(200, {"ok": True})

    def post_open(self, conn, d):
        p = d.get("path", "")
        if not conn.execute("SELECT 1 FROM files WHERE path=?", (p,)).fetchone():
            raise ValueError("That file is not in the catalog")
        if not os.path.exists(p):
            raise ValueError("The file is not reachable right now (is the drive connected?)")
        mc.open_path(p, bool(d.get("select")))
        self._send(200, {"ok": True})

    # ----- online
    def _need_online(self):
        if not online:
            raise ValueError("media_online.py is missing")

    def post_settings(self, conn, d):
        self._need_online()
        for key in ("tmdb_key", "comicvine_key", "region", "language", "cal_days", "auto_covers"):
            if key in d:
                val = str(d[key]).strip()
                if val == "" and key in ("tmdb_key", "comicvine_key") and d.get("keep_keys"):
                    continue
                online.set_setting(conn, key, val)
        self._send(200, {"ok": True})

    def post_settings_test(self, conn, d):
        self._need_online()
        res = online.test_keys(conn)
        self._send(200, [dict(name=n, ok=ok, message=m) for n, ok, m in res])

    def post_online_check(self, conn, d):
        self._need_online()
        only, coll = self._scope(d)
        self._send(200, {"started": start_job("online", job_online(only, coll))})

    def post_calendar_refresh(self, conn, d):
        self._need_online()
        days = int(online.get_setting(conn, "cal_days", "90") or 90)
        self._send(200, {"started": start_job("calendar", job_calendar(days))})

    def post_online_candidates(self, conn, d):
        self._need_online()
        cat = d["id"].split("|", 1)[0]
        try:
            client = online.Client(conn)
            self._send(200, online.candidates(client, cat, d.get("query", "").strip()))
        except online.ApiError as e:
            self._error(400, str(e))

    def post_online_setmatch(self, conn, d):
        self._need_online()
        cat, gkey = d["id"].split("|", 1)
        if d.get("ignore"):
            online.set_match(conn, cat, gkey, dict(online.NO_MATCH, confirmed=2))
            bump()
            return self._send(200, {"started": False})
        c = d["candidate"]
        online.set_match(conn, cat, gkey, dict(source=c["source"], ext_id=c["ext_id"], ext_name=c["name"],
                                               ext_year=c["year"], confirmed=2))
        bump()
        self._send(200, {"started": start_job("online", job_online((cat, gkey)))})


def find_app_browser():
    """A Chromium-based browser (Edge comes with Windows 10/11) that can show Nightvault as an app window."""
    env = os.environ.get("NIGHTVAULT_BROWSER")
    if env and os.path.exists(env):
        return env
    cands = []
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                          os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
                          os.path.join(base, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")]
    elif sys.platform == "darwin":
        cands += ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    else:
        cands += [shutil.which(n) or "" for n in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser", "brave-browser")]
    return next((c for c in cands if c and os.path.exists(c)), None)


def open_window(url, server):
    """Open Nightvault in its own window (no tabs, no address bar). Closing that window stops Nightvault.
    Falls back to the normal browser when no suitable browser is found or when the window cannot be told apart from other browser windows."""
    exe = find_app_browser()
    if not exe:
        return webbrowser.open(url)
    profile = mc.DB_PATH.parent / "vault_window"          # its own profile, so it is a separate window that can be followed
    try:
        profile.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={profile}", "--window-size=1440,920", "--no-first-run",
                                 "--no-default-browser-check", "--disable-features=Translate"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                stdin=subprocess.DEVNULL)
    except OSError:
        return webbrowser.open(url)
    started = time.time()

    def watch():
        proc.wait()
        if time.time() - started < 5:                      # it handed over to a browser that was already open: nothing to follow
            return
        waited = False
        while True:
            with JOB_LOCK:
                busy = JOB["running"]
            if not busy:
                break
            if not waited:
                print("\nThe window was closed but a task is still running - Nightvault stops when it is done.")
                waited = True
            time.sleep(5)
        print("\nWindow closed - stopping Nightvault.")
        server.shutdown()
    threading.Thread(target=watch, daemon=True).start()


def _phone_get(key, default=""):
    conn = connect()
    try:
        return get_setting(conn, key, default)
    finally:
        conn.close()


def _phone_put(key, value):
    conn = connect()
    try:
        put_setting(conn, key, value)
    finally:
        conn.close()


def _phone_music_files():
    conn = connect()
    try:
        roots = dict(conn.execute("SELECT path, root FROM files").fetchall())
        return [(i["path"], roots.get(i["path"]) or "") for g in get_groups(conn, False) if g["cat"] == "music" for i in g["items"]]
    finally:
        conn.close()


def _phone_video_files():
    """Every video file in a Watch collection (Movies, Series, Anime, your own video collections) for Nightvault Cinema on the phone."""
    conn = connect()
    try:
        colls = {c["id"]: c for c in all_collections(conn)}
        roots = dict(conn.execute("SELECT path, root FROM files").fetchall())
        covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
        metas = {r["gid"]: r for r in conn.execute("SELECT gid, genres, data FROM meta")}
        watch = {r["path"]: r for r in conn.execute("SELECT * FROM watching")}
        out = []
        for g in get_groups(conn, False):
            c = colls.get(coll_of(g))
            if not c or c.get("kind") != "video" or g["cat"] not in ("movie", "series", "collection"):
                continue
            gid = gid_of(g)
            m = metas.get(gid)
            about = (jl(m["data"], None) if m else None) or {}
            tmdb = None
            if online:
                try:
                    ref = online_ref(conn, g)
                    if ref and ref[0] == "tmdb" and ref[1] in ("movie", "tv"):
                        tmdb = dict(type=ref[1], id=ref[2])
                except Exception:
                    pass
            kind = "show" if g["cat"] == "series" else "movie"
            for r in g["items"]:
                p = r["path"]
                if os.path.splitext(p)[1].lower() not in VIDEO_EXT:
                    continue
                w = watch.get(p)
                try:
                    label = mc.item_label(g["cat"] if g["cat"] != "collection" else "movie", r)
                except Exception:
                    label = ""
                saga = g["name"] if g["cat"] == "collection" else ""
                out.append(dict(path=p, root=roots.get(p) or "", gid=gid + ("#" + (r.get("gname") or os.path.basename(p)) if saga else ""),
                                coll=c["id"], collname=c["name"], kind=kind, show=(r.get("gname") or label or g["name"]) if saga else g["name"],
                                saga=saga, title=label, year=(r.get("year") if saga else g.get("year")), gyear=(r.get("year") if saga else g.get("year")),
                                season=r.get("season"), number=r.get("number"), label=label, size=r.get("size") or 0,
                                overview=("" if saga else about.get("overview") or ""), genres=jl(m["genres"], []) if m and not saga else [],
                                tmdb=None if saga else tmdb, cover=(gid in covers) and not saga,
                                pos=w["pos"] if w else 0, dur=w["duration"] if w else 0, fin=bool(w["finished"]) if w else False, wat=w["updated"] if w else 0))
        return out
    finally:
        conn.close()


def _phone_model_files():
    """Every model file in a 3D models collection, for Nightvault 3D Print on the phone."""
    conn = connect()
    try:
        colls = {c["id"]: c for c in all_collections(conn)}
        roots = dict(conn.execute("SELECT path, root FROM files").fetchall())
        covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
        metas = {r["gid"]: r for r in conn.execute("SELECT gid, genres FROM meta")}
        out = []
        for g in get_groups(conn, False):
            c = colls.get(coll_of(g))
            if g["cat"] != "model" or not c or c.get("kind") != "model3d":
                continue
            gid = gid_of(g)
            m = metas.get(gid)
            tags = jl(m["genres"], []) if m else []
            for r in g["items"]:
                p = r["path"]
                if os.path.splitext(p)[1].lower() not in MODEL_EXT:
                    continue
                out.append(dict(path=p, root=roots.get(p) or "", gid=gid, group=g["name"], coll=c["id"], collname=c["name"],
                                tags=tags if isinstance(tags, list) else [], cover=gid in covers))
        return out
    finally:
        conn.close()


def _phone_book_files():
    """Every comic, manga, book and RPG file of the Read / Tabletop collections, for Nightvault Bookcase on the phone."""
    conn = connect()
    try:
        colls = {c["id"]: c for c in all_collections(conn)}
        roots = dict(conn.execute("SELECT path, root FROM files").fetchall())
        covers = {r["key"] for r in conn.execute("SELECT key FROM covers")}
        out = []
        for g in get_groups(conn, False):
            c = colls.get(coll_of(g))
            if g["cat"] not in ("comic", "book") or not c or c.get("kind") not in ("comic", "manga", "book", "rpg"):
                continue
            gid = gid_of(g)
            for r in g["items"]:
                p = r["path"]
                if os.path.splitext(p)[1].lower() not in BOOKCASE_EXT:
                    continue
                out.append(dict(path=p, root=roots.get(p) or "", gid=gid, group=g["name"], coll=c["id"], collname=c["name"], kind=c["kind"],
                                number=r.get("number"), year=r.get("year") or g.get("year"), size=r.get("size") or 0, cover=gid in covers))
        return out
    finally:
        conn.close()


def _phone_video_cover(gid):
    conn = connect()
    try:
        r = conn.execute("SELECT file FROM covers WHERE key=?", (gid.split("#", 1)[0],)).fetchone()
    finally:
        conn.close()
    f = COVER_DIR / r["file"] if r else None
    if not f or not f.exists():
        return None, None
    return f.read_bytes(), {".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}.get(f.suffix.lower(), "image/jpeg")


def _phone_video_watch(path, pos, dur, fin):
    conn = connect()
    try:
        conn.execute("INSERT OR REPLACE INTO watching VALUES (?,?,?,?,?)", (path, max(0.0, pos), max(0.0, dur), 1 if fin else 0, time.time()))
        conn.commit()
    finally:
        conn.close()


def main():
    global PORT
    if not UI_FILE.exists():
        sys.exit("vault_ui.html must be in the same folder as vault.py")
    args = sys.argv[1:]
    want = int(args[args.index("--port") + 1]) if "--port" in args else 8765
    server = None
    for port in range(want, want + 20):
        try:
            PORT = port
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if server is None:
        sys.exit("Could not find a free port.")
    connect().close()  # create tables
    if vgames:
        vgames.init(get=_phone_get, put=_phone_put)
    if vnews:
        try:
            vnews.init(get=_phone_get, put=_phone_put, series=_news_series)
            vnews.start()
        except Exception as e:
            print("  (new volumes check not started: " + str(e) + ")")
    if phone:
        try:
            phone.init(get=_phone_get, put=_phone_put, music_files=_phone_music_files, read_tags=read_tags,
                       ffmpeg=lambda: ffbin("ffmpeg"), cache_dir=mc.DB_PATH.parent,
                       video=dict(files=_phone_video_files, info=video_info, sub=video_sub, cmd=transcode_cmd, cover=_phone_video_cover,
                                  watch=_phone_video_watch),
                       models=dict(files=_phone_model_files, cover=_phone_video_cover),
                       books=dict(files=_phone_book_files, cover=_phone_video_cover, news=(vnews.news if vnews else None), news_run=(vnews.run_async if vnews else None)), games=vgames)
            if phone.status()["on"]:
                print(f"  Phone access is on: {', '.join(phone.addresses())} port {phone.PORT}")
        except Exception as e:
            print("  (phone access not started: " + str(e) + ")")
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Nightvault is running at {url}   (press Ctrl+C to stop)")
    if "--no-setup" not in args and not os.environ.get("NIGHTVAULT_NO_SETUP"):
        try:
            if any(c["fix"] == "auto" for c in components_status()):
                run_setup()                    # fills in what is missing while the page is already usable
        except Exception as e:
            print("  (setup check skipped: " + str(e) + ")")
    if "--no-browser" not in args:
        if "--tab" in args:                                  # the old way: a tab in the normal browser
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        else:
            threading.Timer(0.6, lambda: open_window(url, server)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping ...")
    finally:
        STOP.set()
        server.server_close()


if __name__ == "__main__":
    main()
