"""CCG Trader (ccgtrader.net) card catalog for Nightvault: 295 card games, old and new.

Gives the set list of a game and downloads its card pictures into the folder layout Nightvault already reads
(<set id> - <set name>/<number>_<card name>.jpg), so the card hub, binder and scanner work for these games
like for every other game. No prices: CCG Trader has none to give.

Set codes are CCG Trader's set ids (they never change). Nightvault Pocket uses the same ids and card numbers,
so cards scanned on the phone match the cards here.
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.ccgtrader.co.uk/_/items/"
ASSET = "https://api.ccgtrader.co.uk/_/assets/{}?key=directus-large-contain"
AGENT = "Nightvault (personal card collection app)"
BUILTIN_KEYS = {22: "wow", 128: "dbzccg", 127: "dbgt"}   # same game keys as Nightvault Pocket
COPY = "https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/ccgt/{}.json"   # weekly copy, for when CCG Trader is down


class CcgtError(Exception):
    pass


def game_key(gid):
    return BUILTIN_KEYS.get(int(gid), f"ccgt{int(gid)}")


def _get(path, params=None, timeout=60):
    url = API + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "application/json"})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:          # network hiccup: try twice more
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise CcgtError(f"CCG Trader did not answer ({last})")


def _copy(name):
    try:
        req = urllib.request.Request(COPY.format(name), headers={"User-Agent": AGENT})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except Exception:
        raise CcgtError("CCG Trader is not reachable right now, and there is no copy of it on GitHub yet")


def list_games():
    """[(id, name)] of every game in the catalog, sorted by name."""
    try:
        data = _get("game", {"fields[]": ["id", "name"], "limit": -1, "sort": "name"}).get("data") or []
    except CcgtError:
        return [(g[0], g[1]) for g in _copy("index").get("games") or []]
    return [(g["id"], str(g.get("name") or "").strip()) for g in data if g.get("id")]


def rarities():
    return {r["id"]: r.get("name") or "" for r in _get("rarities", {"limit": -1}).get("data") or []}


def list_sets(gid):
    """[(code, name, released, total)] - code is the CCG Trader set id as text."""
    try:
        data = _get("set", {"fields[]": ["id", "name", "release_date"], f"filter[series.game][eq]": gid, "limit": -1}).get("data") or []
    except CcgtError:
        data = [dict(id=s["id"], name=s["name"], release_date=s.get("released")) for s in _copy(gid).get("sets") or []]
    out = [(str(s["id"]), str(s.get("name") or "").strip(), str(s.get("release_date") or "")[:10], 0) for s in data if s.get("id")]
    return sorted(out, key=lambda x: x[2] or "9999")


def set_cards(set_id):
    fields = ["name", "number", "rarity", "image.private_hash"]
    return _get("card", {"fields[]": fields, "filter[set][eq]": set_id, "sort": "number,name", "limit": -1}).get("data") or []


def _safe(text, n=80):
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", str(text or "")).strip().rstrip(".")
    return re.sub(r"\s+", " ", text)[:n] or "card"


def card_number(c):
    n = c.get("number")
    if n in (None, "", 0, "0"):
        return re.sub(r"[^a-z0-9]+", "", str(c.get("name") or "").lower()) or "x"
    return str(n)


PAUSE = 0.4          # seconds between two pictures: about 2 a second, so a free site is not overloaded


def _fetch_picture(h, path, name, num, say, stop):
    """One picture. When CCG Trader says 'too many requests' or hiccups, wait longer and try again (up to 4 times)."""
    req = urllib.request.Request(ASSET.format(h), headers={"User-Agent": AGENT})
    wait = 5
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(path + ".part", "wb") as f:
                f.write(r.read())
            os.replace(path + ".part", path)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                say(f"{name} #{num}: CCG Trader has no picture")
                return False
            retry = e.headers.get("Retry-After") if e.code in (429, 503) else None
            delay = int(retry) if retry and retry.isdigit() else wait
            err = e
        except Exception as e:
            delay, err = wait, e
        if attempt < 3:
            say(f"{name} #{num}: {err} - waiting {delay} s")
            for _ in range(min(delay, 300)):
                if stop.is_set():
                    return False
                time.sleep(1)
            wait *= 3
    try:
        os.remove(path + ".part")
    except OSError:
        pass
    say(f"{name} #{num}: picture not saved ({err})")
    return False


def download(gid, out, wanted, say, progress, stop):
    """Save the pictures of game `gid` into `out`. `wanted`: set ids or words of set names (empty = every set).
    Pictures already on disk are skipped, so a stopped download continues where it was. Also writes _ccgtrader.json
    (rarity and release dates) for Nightvault to read after the folder scan."""
    sets = list_sets(gid)
    if wanted:
        w = [x.lower() for x in wanted]
        sets = [s for s in sets if s[0] in w or any(x in s[1].lower() for x in w)]
        if not sets:
            raise CcgtError("No set matches " + ", ".join(wanted))
    rar = rarities()
    meta_path = os.path.join(out, "_ccgtrader.json")
    try:
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        meta = {"sets": {}, "cards": {}}
    got = skipped = misses = 0
    for i, (code, name, released, _t) in enumerate(sets, 1):
        if stop.is_set():
            break
        progress(f"{name} ({i}/{len(sets)}) ...")
        try:
            cards = set_cards(code)
        except CcgtError as e:
            say(f"{name}: {e}")
            continue
        folder = os.path.join(out, f"{code} - {_safe(name, 60)}")
        os.makedirs(folder, exist_ok=True)
        meta["sets"][code] = {"name": name, "released": released, "total": len(cards)}
        for c in cards:
            if stop.is_set():
                break
            num = card_number(c)
            meta["cards"][f"{code}:{num}"] = rar.get(c.get("rarity"), "")
            h = (c.get("image") or {}).get("private_hash")
            path = os.path.join(folder, f"{_safe(num, 20)}_{_safe(c.get('name'))}.jpg")
            if not h or os.path.exists(path) or os.path.exists(os.path.splitext(path)[0] + ".webp"):
                skipped += 1
                continue
            if _fetch_picture(h, path, name, num, say, stop):
                got += 1
                misses = 0
            else:
                misses += 1
                if misses >= 25:
                    say("CCG Trader keeps refusing pictures - stopped. Start the download again later; it continues where it was.")
                    stop.set()
            time.sleep(PAUSE)                # be gentle with a free site
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
    say(f"{got:,} pictures saved, {skipped:,} already there or without a picture.")


def apply_meta(conn, game, out):
    """After the folder scan: rarity, set names and release dates from _ccgtrader.json."""
    try:
        with open(os.path.join(out, "_ccgtrader.json"), encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        return
    conn.executemany("UPDATE cg_cards SET rarity=? WHERE game=? AND set_code=? AND number=?",
                     [(r, game, k.split(":", 1)[0], k.split(":", 1)[1]) for k, r in meta.get("cards", {}).items() if r])
    conn.executemany("UPDATE cg_sets SET name=?, released=? WHERE game=? AND code=?",
                     [(s["name"], s.get("released") or "", game, code) for code, s in meta.get("sets", {}).items()])
    conn.commit()
