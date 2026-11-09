"""Nightvault - Games: start your games on this PC (Nightvault Games, phone app, plans/games.md).

What it does:
  * Per game system (the same ids as the phone app: snes, ps2, gc ...) the owner sets, in the PC app (Settings > Games: play on this PC):
      - a ROM folder: where his OWN backups of that system's games are (ROM files, disc images)
      - an emulator: RetroArch (one program for many systems, with a "core" per system) or a separate emulator, with its start line
  * Lists the backup files per system for the phone app (so Games can match them to the games in its list, and save them to the phone).
  * Starts a game: an emulator with a backup file, or a Steam game (steam://rungameid/<id>).

Safety: the phone can only ASK to start a file that is inside a ROM folder set here, with the emulator set here, or a Steam game by
its number. The emulator and folders can only be changed in the PC app itself (on this PC), never from the phone.
Only the owner's own backups - Nightvault never downloads games or BIOS files.
"""
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time

# --------------------------------------------------------------------------- #
# the systems (ids and names as in the phone app) and the RetroArch core that usually plays them
# --------------------------------------------------------------------------- #
SYSTEMS = [
    ("dos", "MS-DOS", "dosbox_pure"),
    ("ps2", "PlayStation 2", ""), ("ps1", "PlayStation", "swanstation"), ("ps3", "PlayStation 3", ""), ("psp", "PSP", "ppsspp"), ("vita", "PS Vita", ""),
    ("xbox", "Xbox", ""), ("x360", "Xbox 360", ""),
    ("switch", "Nintendo Switch", ""), ("wiiu", "Wii U", ""), ("wii", "Wii", "dolphin"), ("gc", "GameCube", "dolphin"), ("n64", "Nintendo 64", "mupen64plus_next"),
    ("snes", "Super Nintendo / Super Famicom", "snes9x"), ("nes", "NES / Famicom", "mesen"), ("fds", "Famicom Disk System", "mesen"),
    ("n3ds", "Nintendo 3DS / 2DS", ""), ("ds", "Nintendo DS", "melonds"), ("gba", "Game Boy Advance", "mgba"), ("gbc", "Game Boy Color", "gambatte"),
    ("gb", "Game Boy", "gambatte"), ("vb", "Virtual Boy", "mednafen_vb"), ("pmini", "Pokémon mini", "pokemini"),
    ("dc", "Dreamcast", "flycast"), ("saturn", "Sega Saturn", "mednafen_saturn"), ("s32x", "Sega 32X", "picodrive"), ("segacd", "Sega CD / Mega-CD", "genesis_plus_gx"),
    ("md", "Mega Drive / Genesis", "genesis_plus_gx"), ("sms", "Master System", "genesis_plus_gx"), ("sg1000", "SG-1000", "genesis_plus_gx"),
    ("gg", "Game Gear", "genesis_plus_gx"),
    ("jaguar", "Atari Jaguar", "virtualjaguar"), ("a7800", "Atari 7800", "prosystem"), ("a5200", "Atari 5200", "a5200"), ("a2600", "Atari 2600", "stella"),
    ("lynx", "Atari Lynx", "handy"),
    ("neogeo", "Neo Geo (AES / MVS)", "fbneo"), ("neocd", "Neo Geo CD", "neocd"), ("pce", "PC Engine / TurboGrafx-16", "mednafen_pce"),
    ("pcecd", "PC Engine CD / TurboGrafx-CD", "mednafen_pce"), ("pcfx", "PC-FX", "mednafen_pcfx"), ("3do", "3DO", "opera"), ("cdi", "Philips CD-i", "same_cdi"),
    ("coleco", "ColecoVision", "gearcoleco"), ("intv", "Intellivision", "freeintv"), ("vectrex", "Vectrex", "vecx"), ("odyssey2", "Magnavox Odyssey² / Videopac", "o2em"),
    ("arcade", "Arcade", "fbneo"),
    ("ngpc", "Neo Geo Pocket Color", "mednafen_ngp"), ("ngp", "Neo Geo Pocket", "mednafen_ngp"), ("wsc", "WonderSwan Color", "mednafen_wswan"), ("ws", "WonderSwan", "mednafen_wswan"),
    ("c64", "Commodore 64", "vice_x64sc"), ("amiga", "Amiga", "puae"), ("ast", "Atari ST", "hatari"), ("a8bit", "Atari 8-bit", "atari800"),
    ("msx", "MSX", "bluemsx"), ("zx", "ZX Spectrum", "fuse"), ("cpc", "Amstrad CPC", "cap32"), ("x68k", "Sharp X68000", "px68k"), ("pc98", "NEC PC-98", "np2kai"),
]
SYS = {s[0]: s for s in SYSTEMS}

# separate emulators: name -> (program file names it usually has, start line; {rom} = the backup file, {exe} = the program)
STANDALONE = {
    "PCSX2": (["pcsx2-qt.exe", "pcsx2.exe"], '"{exe}" -fullscreen -- "{rom}"', ["ps2"]),
    "DuckStation": (["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-qt.exe"], '"{exe}" -fullscreen -- "{rom}"', ["ps1"]),
    "RPCS3": (["rpcs3.exe"], '"{exe}" --no-gui "{rom}"', ["ps3"]),
    "PPSSPP": (["PPSSPPWindows64.exe", "PPSSPPWindows.exe"], '"{exe}" --fullscreen "{rom}"', ["psp"]),
    "Vita3K": (["Vita3K.exe"], '"{exe}" -F -r "{rom}"', ["vita"]),
    "Dolphin": (["Dolphin.exe"], '"{exe}" -b -e "{rom}"', ["gc", "wii"]),
    "Cemu": (["Cemu.exe"], '"{exe}" -f -g "{rom}"', ["wiiu"]),
    "Azahar": (["azahar.exe", "azahar-qt.exe", "lime3ds.exe", "citra-qt.exe"], '"{exe}" "{rom}"', ["n3ds"]),
    "melonDS": (["melonDS.exe"], '"{exe}" "{rom}"', ["ds"]),
    "mGBA": (["mGBA.exe"], '"{exe}" -f "{rom}"', ["gba", "gb", "gbc"]),
    "Mesen": (["Mesen.exe"], '"{exe}" "{rom}"', ["nes", "fds", "snes", "gb", "gbc", "gba", "pce", "sms", "gg", "ws", "wsc"]),
    "Snes9x": (["snes9x-x64.exe", "snes9x.exe"], '"{exe}" "{rom}"', ["snes"]),
    "Project64": (["Project64.exe"], '"{exe}" "{rom}"', ["n64"]),
    "ares": (["ares.exe"], '"{exe}" --fullscreen "{rom}"', ["n64", "snes", "nes", "md", "sms", "gg", "pce", "ngp", "ngpc", "ws", "wsc", "gb", "gbc", "gba", "ps1", "s32x", "segacd"]),
    "Redream": (["redream.exe"], '"{exe}" "{rom}"', ["dc"]),
    "Flycast": (["flycast.exe"], '"{exe}" "{rom}"', ["dc", "arcade"]),
    "xemu": (["xemu.exe"], '"{exe}" -full-screen -dvd_path "{rom}"', ["xbox"]),
    "Xenia": (["xenia_canary.exe", "xenia.exe"], '"{exe}" --fullscreen "{rom}"', ["x360"]),
    "DOSBox Staging": (["dosbox.exe"], '"{exe}" "{rom}" -fullscreen', ["dos"]),
    "WinUAE": (["winuae64.exe", "winuae.exe"], '"{exe}" -0 "{rom}"', ["amiga"]),
    "VICE": (["x64sc.exe"], '"{exe}" -autostart "{rom}"', ["c64"]),
    "MAME": (["mame.exe"], '"{exe}" -rompath "{dir}" "{name}"', ["arcade", "neogeo"]),
}
RETROARCH_LINE = '"{exe}" -f -L "{core_file}" "{rom}"'

# files in a ROM folder that are never a game
JUNK = re.compile(r"\.(sav|srm|state\d*|sta|txt|nfo|diz|jpe?g|png|gif|bmp|webp|pdf|xml|dat|ini|cfg|db|bak|sha1|md5|sfv|url|lnk|log|htm|html|mp3|ogg|wav|ini|pnach|ips|bps|ups|xdelta|cht|exe|dll|bat|sh|json)$", re.I)

_ctx = {}           # get(key, default), put(key, value) from vault.py
_cache = {"lock": threading.Lock(), "at": 0, "items": [], "files": {}}


def init(get, put):
    _ctx.update(get=get, put=put)


def config():
    try:
        c = json.loads(_ctx["get"]("games_play", "") or "{}")
    except Exception:
        c = {}
    c.setdefault("retroarch", "")
    c.setdefault("cores", "")
    c.setdefault("systems", {})
    return c


def save(d):
    """From the PC app's own Settings page only (never from the phone)."""
    c = config()
    if "retroarch" in d:
        c["retroarch"] = str(d.get("retroarch") or "").strip().strip('"')
    if "cores" in d:
        c["cores"] = str(d.get("cores") or "").strip().strip('"')
    for sid, s in (d.get("systems") or {}).items():
        if sid not in SYS and not sid.startswith("x-"):
            continue
        cur = c["systems"].get(sid, {})
        for k in ("folder", "emu", "exe", "line", "core"):
            if k in s:
                cur[k] = str(s.get(k) or "").strip().strip('"') if k != "line" else str(s.get(k) or "").strip()
        if any(cur.get(k) for k in ("folder", "emu", "exe", "line", "core")):
            c["systems"][sid] = cur
        else:
            c["systems"].pop(sid, None)
    _ctx["put"]("games_play", json.dumps(c))
    _cache["at"] = 0
    return state()


def _core_file(c, core):
    ra = c.get("retroarch") or ""
    folder = c.get("cores") or (os.path.join(os.path.dirname(ra), "cores") if ra else "")
    ext = ".dll" if sys.platform.startswith("win") else (".dylib" if sys.platform == "darwin" else ".so")
    return os.path.join(folder, f"{core}_libretro{ext}") if folder and core else ""


def _how(c, sid):
    """How this system is played: (label, command line template, problem or '')"""
    s = c["systems"].get(sid) or {}
    emu = s.get("emu") or ""
    if emu == "retroarch":
        core = s.get("core") or (SYS[sid][2] if sid in SYS else "")
        ra = c.get("retroarch") or ""
        cf = _core_file(c, core)
        bad = "" if ra and os.path.isfile(ra) else "RetroArch is not found - fill in where retroarch.exe is."
        if not bad and not core:
            bad = "Choose a RetroArch core for this system."
        elif not bad and not os.path.isfile(cf):
            bad = f"The core {core} is not installed in RetroArch (RetroArch > Online Updater > Core Downloader)."
        return f"RetroArch · {core}", RETROARCH_LINE.replace("{core_file}", cf.replace('"', '')), bad
    if emu:
        exe = s.get("exe") or ""
        if emu == "other":
            emu = "your own program"
        line = s.get("line") or (STANDALONE[emu][1] if emu in STANDALONE else '"{exe}" "{rom}"')
        bad = "" if exe and os.path.isfile(exe) else f"{emu} is not found - fill in where its program file is."
        return emu, line, bad
    return "", "", "No emulator chosen yet."


def state():
    """For the PC app's Settings card."""
    c = config()
    out = []
    for sid, name, core in SYSTEMS + [(k, k[2:].replace("-", " ").title(), "") for k in c["systems"] if k.startswith("x-")]:
        s = c["systems"].get(sid) or {}
        label, _line, bad = _how(c, sid)
        folder = s.get("folder") or ""
        out.append(dict(id=sid, name=name, core=s.get("core") or core, default_core=core, folder=folder, emu=s.get("emu") or "", exe=s.get("exe") or "",
                        line=s.get("line") or "", label=label, problem=bad if s else "",
                        folder_ok=bool(folder) and os.path.isdir(folder), standalone=[k for k, v in STANDALONE.items() if sid in v[2]]))
    return dict(retroarch=c.get("retroarch") or "", retroarch_ok=bool(c.get("retroarch")) and os.path.isfile(c.get("retroarch")),
                cores=c.get("cores") or "", systems=out, standalone={k: dict(files=v[0], line=v[1], systems=v[2]) for k, v in STANDALONE.items()},
                found=find_programs())


def find_programs():
    """Looks in the usual places for RetroArch and the separate emulators, to fill in the paths."""
    roots = [os.environ.get(k, "") for k in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "APPDATA")]
    roots += [os.path.join(os.path.expanduser("~"), d) for d in ("Desktop", "Downloads", "Documents", "Emulators", "Games")]
    roots += [d + ":\\" for d in "CDEFG"] + [os.path.join(d + ":\\", "Emulators") for d in "CDEFG"]
    names = {"retroarch.exe": "RetroArch"}
    for emu, (files, _l, _s) in STANDALONE.items():
        for f in files:
            names[f.lower()] = emu
    found = {}
    for r in roots:
        if not r or not os.path.isdir(r):
            continue
        try:
            for d1 in os.listdir(r)[:400]:
                p1 = os.path.join(r, d1)
                if os.path.isfile(p1) and d1.lower() in names:
                    found.setdefault(names[d1.lower()], p1)
                if not os.path.isdir(p1):
                    continue
                try:
                    for f in os.listdir(p1)[:200]:
                        if f.lower() in names:
                            found.setdefault(names[f.lower()], os.path.join(p1, f))
                except OSError:
                    pass
        except OSError:
            pass
    return found


# --------------------------------------------------------------------------- #
# the backup files per system (for the phone): one entry per game, with the extra files a disc needs
# --------------------------------------------------------------------------- #
def _refs(path):
    """The files a .cue / .gdi / .m3u points to (in the same folder)."""
    ext = os.path.splitext(path)[1].lower()
    out = []
    try:
        text = open(path, "r", encoding="utf-8", errors="replace").read(200000)
    except OSError:
        return out
    if ext == ".cue":
        out = re.findall(r'^\s*FILE\s+"?(.+?)"?\s+(?:BINARY|MOTOROLA|WAVE|MP3|AIFF)\s*$', text, re.I | re.M)
    elif ext == ".gdi":
        for line in text.splitlines()[1:]:
            m = re.match(r'\s*\d+\s+\d+\s+\d+\s+\d+\s+("([^"]+)"|(\S+))', line)
            if m:
                out.append(m.group(2) or m.group(3))
    elif ext == ".m3u":
        out = [l.strip() for l in text.splitlines() if l.strip() and not l.startswith("#")]
    base = os.path.dirname(path)
    res = []
    for r in out:
        p = os.path.normpath(os.path.join(base, r))
        if os.path.isfile(p):
            res.append(p)
            if p.lower().endswith((".cue", ".gdi")):
                res += _refs(p)
    return res


def _id(s):
    import hashlib
    return "g" + hashlib.sha1(s.encode("utf-8", "surrogatepass")).hexdigest()[:15]


def build(force=False):
    """All backup files in the ROM folders: [{id, sys, name, dir, size, parts:[{id, name, dir, size}]}]. Kept for 60 seconds."""
    with _cache["lock"]:
        if not force and _cache["at"] and time.time() - _cache["at"] < 60:
            return _cache
        c = config()
        items, files = [], {}
        for sid, s in c["systems"].items():
            root = s.get("folder") or ""
            if not root or not os.path.isdir(root):
                continue
            found = []
            for dirpath, dirs, names in os.walk(root):
                dirs[:] = [d for d in dirs if not d.startswith(".") and d.lower() not in ("saves", "states", "bios", "system", "screenshots", "covers", "media", "images", "manuals")]
                for n in names:
                    if not JUNK.search(n):
                        found.append(os.path.join(dirpath, n))
                if len(found) > 50000:
                    break
            used = set()
            for p in found:                                   # a playlist / cue sheet takes its pieces
                if p.lower().endswith((".m3u", ".cue", ".gdi")):
                    for r in _refs(p):
                        used.add(os.path.normcase(r))
            for p in sorted(found):
                if os.path.normcase(p) in used:
                    continue
                fid = _id(p)
                files[fid] = p
                parts = []
                for r in _refs(p):
                    rid = _id(r)
                    files[rid] = r
                    parts.append(dict(id=rid, name=os.path.basename(r), dir=_rel(os.path.dirname(r), root), size=_size(r)))
                items.append(dict(id=fid, sys=sid, name=os.path.basename(p), dir=_rel(os.path.dirname(p), root), size=_size(p) + sum(x["size"] for x in parts), parts=parts))
        _cache.update(items=items, files=files, at=time.time())
        return _cache


def _rel(d, root):
    r = os.path.relpath(d, root)
    return "" if r == "." else r.replace("\\", "/")


def _size(p):
    try:
        return os.path.getsize(p)
    except OSError:
        return 0


def listing(fresh=False):
    c = config()
    b = build(fresh)
    systems = {}
    for sid, s in c["systems"].items():
        label, _line, bad = _how(c, sid)
        systems[sid] = dict(folder=bool(s.get("folder")), emulator=label, ready=not bad, problem=bad)
    return dict(ready=True, at=b["at"], systems=systems, items=b["items"], steam=True)


def file_path(fid):
    p = _cache["files"].get(fid)
    if not p:
        build(True)
        p = _cache["files"].get(fid)
    return p


# --------------------------------------------------------------------------- #
# starting a game
# --------------------------------------------------------------------------- #
def play(fid=None, steam=None):
    if steam is not None:
        appid = str(steam)
        if not appid.isdigit():
            raise ValueError("Not a Steam game number")
        url = f"steam://rungameid/{appid}"
        if sys.platform.startswith("win"):
            os.startfile(url)               # noqa - Windows only
        else:
            subprocess.Popen(["xdg-open" if sys.platform != "darwin" else "open", url])
        return dict(ok=True, how="Steam")
    p = file_path(fid or "")
    if not p or not os.path.isfile(p):
        raise ValueError("That backup file is not on the PC (is the drive connected?)")
    c = config()
    sid = next((it["sys"] for it in _cache["items"] if it["id"] == fid), None)
    if sid is None:                                     # a part of a disc: start the disc itself
        sid = next((it["sys"] for it in _cache["items"] if any(x["id"] == fid for x in it["parts"])), None)
    if sid is None:
        raise ValueError("Unknown file")
    label, line, bad = _how(c, sid)
    if bad:
        raise ValueError(bad + " (Nightvault on the PC > Settings > Games: play on this PC)")
    s = c["systems"].get(sid) or {}
    exe = c.get("retroarch") if s.get("emu") == "retroarch" else s.get("exe")
    cmd = line.replace("{exe}", exe or "").replace("{rom}", p).replace("{dir}", os.path.dirname(p)).replace("{name}", os.path.splitext(os.path.basename(p))[0])
    args = shlex.split(cmd, posix=not sys.platform.startswith("win"))
    args = [a.strip('"') for a in args]
    subprocess.Popen(args, cwd=os.path.dirname(exe) if exe else None, close_fds=True)
    return dict(ok=True, how=label, file=os.path.basename(p))
