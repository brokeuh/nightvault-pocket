"""More card games for Nightvault - the same ones Nightvault Pocket (the phone app) has, with the same set codes and
card numbers, so cards sent from the phone land on the right card here.

  - Gundam, Digimon, Flesh and Blood, Sorcery, Weiss Schwarz, Dragon Ball (Fusion World, Masters, Panini DBZ):
    the daily card lists the phone app uses (TCGplayer, copied to github.com/brokeuh/nightvault-pocket/data):
    sets, numbers, rarity, card text, prices (converted to EUR) and pictures
  - One Piece: optcgapi.com (cards, text, pictures, TCGplayer prices)
  - Star Wars CCG (Decipher + the Players Committee's virtual sets): github.com/swccgpc/swccg-card-json

Pictures are saved like every other game: <set code> - <set name>/<number>_<card name>.jpg, so the card hub,
binder and scanner work for these games too. A stopped download continues where it was.
"""
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

AGENT = "Nightvault (personal card collection app)"
DATA = "https://raw.githubusercontent.com/brokeuh/nightvault-pocket/main/data/"
SWCCG = "https://raw.githubusercontent.com/swccgpc/swccg-card-json/main/"
OPTCG = "https://optcgapi.com/api/"
OPPP_KEY = ""                # the owner's oppp.online supporter key; vault.py fills it in from the settings (never logged, never sent anywhere else)
OPPP = "https://oppp.online/api/"
PAUSE = 0.25                 # seconds between pictures - gentle on the sites
META = "_nightvault.json"

TCG = lambda label, color, site="TCGplayer (daily copy)": dict(kind="tcg", label=label, color=color, site=site)
SOURCES = {
    "onepiece": dict(kind="optcg", label="One Piece Card Game", color="#c8453b", site="optcgapi.com"),
    "onepiece_oppp": dict(kind="optcg", oppp=True, label="One Piece (OPPP, full resolution with your key)", color="#a83a31", site="oppp.online (supporter key)"),
    "swccg": dict(kind="swccg", label="Star Wars CCG (Decipher)", color="#a08a52", site="SWCCG Players Committee"),
    "gundam": TCG("Gundam Card Game", "#3f7fd9"),
    "digimon": TCG("Digimon Card Game", "#f08a24"),
    "fab": TCG("Flesh and Blood", "#a3262a"),
    "sorcery": TCG("Sorcery: Contested Realm", "#8d7a4e"),
    "ws": TCG("Weiss Schwarz", "#c9c9d6"),
    "dbsfw": TCG("Dragon Ball Super: Fusion World", "#f2a51a"),
    "dbsm": TCG("Dragon Ball Super (Masters)", "#e56b1f"),
    "dbz": TCG("Dragon Ball Z TCG (Panini)", "#d9482b"),
}
for _k, _v in SOURCES.items():
    _v.setdefault("hint", "set code, e.g. " + {"onepiece": "op01 st10", "swccg": "1 2 200"}.get(_k, "the codes in List sets"))
    _v["note"] = {"tcg": "Cards, text, rarity and prices from TCGplayer's daily price list (the same data the phone app uses).",
                  "optcg": "Cards, text and TCGplayer prices from the One Piece card database.",
                  "swccg": "Every Decipher set and the Players Committee's virtual sets, with card text."}[_v["kind"]]

# CCG Trader catalog games the phone app has built in (added to the card hub automatically)
CATALOG_DEFAULTS = {"wow": (22, "World of Warcraft TCG", "#5c7bb0"), "dbzccg": (128, "Dragon Ball Z CCG (Score)", "#c4502e"),
                    "dbgt": (127, "Dragon Ball GT TCG (Score)", "#b8562a")}


class DataError(Exception):
    pass


def _get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "application/json"})
    last = None
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(2 * (a + 1))
    raise DataError(f"could not load {url.split('/')[2]} ({last})")


def norm_num(n):
    m = re.match(r"0*(\d+)(.*)", str(n))
    return (str(int(m.group(1))) + m.group(2)) if m else str(n)


def slug(t):                                        # same as the phone app: accents dropped, letters and digits only
    t = unicodedata.normalize("NFD", str(t or "").lower())
    return re.sub(r"[^a-z0-9]+", "", "".join(ch for ch in t if not unicodedata.combining(ch)))


def _safe(text, n=80):
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", str(text or "")).strip().rstrip(".")
    return re.sub(r"\s+", " ", text)[:n] or "card"


def enc_num(num):
    """A card number as it can stand in a file name (Nightvault reads the part before the first _)."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "~", str(num).replace("_", "~u").replace("/", "~s").replace(" ", "~w"))


_FX = {}


def usd_eur():
    if "r" not in _FX:
        _FX["r"] = 0.92
        for url, path in (("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR", ("rates", "EUR")),
                          ("https://open.er-api.com/v6/latest/USD", ("rates", "EUR"))):
            try:
                d = _get(url, 20)
                _FX["r"] = float(d[path[0]][path[1]])
                break
            except Exception:
                continue
    return _FX["r"]


def _eur(v):
    try:
        return round(float(v) * usd_eur(), 2) if v not in (None, "", "NULL") else None
    except Exception:
        return None


# ---------------------------------------------------------------- each source: sets and cards
# a card here: dict(set, setname, released, num (as the phone app has it), name, img, rarity, price_eur, ctype, rules)

_cache = {}


def _tcg(key):
    if key not in _cache:
        d = _get(DATA + key + ".json")
        try:
            tx = _get(DATA + "text/" + key + ".json", 300)
        except DataError:
            tx = {}
        _cache[key] = (d, tx)
    return _cache[key]


def _tcg_cards(key):
    d, tx = _tcg(key)
    out = []
    for r in d.get("cards", []):
        st = d["sets"][r[0]]
        pid = r[4] if len(r) > 4 else None
        img = ""
        if len(r) > 7 and r[7]:
            img = d["imgBase"].replace("{}", r[7]) if d.get("imgBase") else r[7]
        elif pid:
            img = f"https://tcgplayer-cdn.tcgplayer.com/product/{pid}_in_1000x1000.jpg"
        t = tx.get(str(pid)) or ["", ""]
        out.append(dict(set=st["code"], setname=st.get("name") or st["code"].upper(), released=st.get("released") or "",
                        num=norm_num(r[1]) if r[1] else slug(r[2]), name=r[2], img=img, rarity=r[3] or "",
                        price=_eur(r[5] if len(r) > 5 else None), ctype=(t[0] or "")[:200], rules=t[1] or ""))
    return out


def _clean(t):
    t = re.sub(r"<br\s*/?>", "\n", str(t or ""), flags=re.I)
    return re.sub(r"<[^>]+>", "", t).replace("&nbsp;", " ").replace("&amp;", "&").strip()


def _optcg_cards():
    if "optcg" not in _cache:
        rows = []
        for p in ("allSetCards/", "allSTCards/"):
            try:
                rows += _get(OPTCG + p)
            except DataError:
                pass
        if not rows:
            raise DataError("the One Piece card database did not answer")
        _cache["optcg"] = rows
    out = []
    for c in _cache["optcg"]:
        sid = str(c.get("card_set_id") or "")
        if "-" not in sid:
            continue
        s0, n = sid.split("-", 1)
        v = (str(c.get("card_image_id") or "").split("_") + [""])[1]
        base = re.sub(r"\s*\((parallel|alternate art|manga|sp)\)\s*$", "", str(c.get("card_name") or ""), flags=re.I).strip()
        nul = lambda x: "" if x in (None, "NULL") else str(x)
        out.append(dict(set=s0.lower(), code=sid, v=v, setname=c.get("set_name") or s0, released="", num=norm_num(n) + ("-" + v if v else ""),
                        name=base + (" (Parallel)" if re.search("parallel", str(c.get("card_name") or ""), re.I) else ""),
                        img=c.get("card_image") or "", rarity=nul(c.get("rarity")), price=_eur(c.get("market_price")),
                        ctype=" · ".join(x for x in (nul(c.get("card_type")), nul(c.get("card_color")), nul(c.get("sub_types"))) if x),
                        rules=_clean(c.get("card_text"))))
    return out


def _swccg_cards():
    if "swccg" not in _cache:
        cards = []
        for side in ("Light", "Dark"):
            cards += _get(SWCCG + side + ".json").get("cards", [])
        try:
            sets = {str(s["id"]).lower(): s for s in _get(SWCCG + "sets.json")}
        except DataError:
            sets = {}
        _cache["swccg"] = (cards, sets)
    cards, sets = _cache["swccg"]
    out = []
    for c in cards:
        fr = c.get("front") or {}
        code = str(c.get("set") or "").lower()
        if not code or not fr.get("imageUrl"):
            continue
        s = sets.get(code, {})
        rel = str(s.get("date_release") or "")
        out.append(dict(set=code, setname=s.get("name") or "Set " + code, released="" if rel.startswith("0000") else rel[:10],
                        num=str(c.get("gempId") or c.get("id")), name=re.sub(r"[•<>]", "", str(fr.get("title") or "")).strip(),
                        img=fr["imageUrl"], rarity=c.get("rarity") or "", price=None,
                        ctype=" · ".join(x for x in (fr.get("type"), fr.get("subType"), c.get("side")) if x), rules=_clean(fr.get("gametext"))))
    return out


def cards(key):
    kind = SOURCES[key]["kind"]
    return _tcg_cards(key) if kind == "tcg" else _optcg_cards() if kind == "optcg" else _swccg_cards()


def list_sets(key):
    """[(code, name, released, total)] for the set list (nothing is downloaded)."""
    seen = {}
    for c in cards(key):
        e = seen.setdefault(c["set"], [c["set"], c["setname"], c["released"], 0])
        e[3] += 1
    return sorted((tuple(x) for x in seen.values()), key=lambda x: x[2] or "9999")


# ---------------------------------------------------------------- download

def _fetch(url, path, say, stop, label):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    wait, err = 5, None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(path + ".part", "wb") as f:
                f.write(r.read())
            os.replace(path + ".part", path)
            return True
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return False
            ra = e.headers.get("Retry-After") if e.code in (429, 503) else None
            delay, err = (int(ra) if ra and ra.isdigit() else wait), e
        except Exception as e:
            delay, err = wait, e
        if attempt < 3:
            say(f"{label}: {err} - waiting {delay} s")
            for _ in range(min(delay, 300)):
                if stop.is_set():
                    return False
                time.sleep(1)
            wait *= 3
    try:
        os.remove(path + ".part")
    except OSError:
        pass
    say(f"{label}: picture not saved ({err})")
    return False


def download(key, out, wanted, say, progress, stop):
    """Save the pictures of game `key` into `out`. `wanted`: set codes or words of set names (empty = every set)."""
    oppp = bool(SOURCES[key].get("oppp"))
    if oppp:
        if not OPPP_KEY:
            raise DataError("Add your OPPP key first (Settings > Card games > OPPP key).")
        try:
            _get(f"{OPPP}{OPPP_KEY}/card-info/OP01-001", 30)
        except DataError as e:
            raise DataError("OPPP did not accept your key (or did not answer). Check the key - or your supporter period has ended.")
    allc = cards(key)
    sets = {}
    for c in allc:
        sets.setdefault(c["set"], c)
    pick = list(sets)
    if wanted:
        w = [x.lower() for x in wanted]
        exact = [s for s in pick if s in w]                      # a set code wins; words of set names only for the rest
        rest = [x for x in w if x not in exact]
        pick = exact + [s for s in pick if s not in exact and any(x in sets[s]["setname"].lower() for x in rest)]
        if not pick:
            raise DataError("No set matches " + ", ".join(wanted))
    meta_path = os.path.join(out, META)
    try:
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        meta = {"sets": {}, "cards": {}}
    got = skipped = misses = 0
    for i, code in enumerate(pick, 1):
        if stop.is_set():
            break
        s = sets[code]
        progress(f"{s['setname']} ({i}/{len(pick)}) ...")
        folder = os.path.join(out, f"{_safe(code, 20)} - {_safe(s['setname'], 60)}")
        os.makedirs(folder, exist_ok=True)
        meta["sets"][code] = {"name": s["setname"], "released": s["released"]}
        for c in (x for x in allc if x["set"] == code):
            if stop.is_set():
                break
            e = enc_num(c["num"])
            meta["cards"][f"{code}|{e}"] = {"n": c["num"], "r": c["rarity"], "p": c["price"], "t": c["ctype"], "x": c["rules"][:3000]}
            img, sub, ext = c["img"], "", "jpg"
            if oppp:                                      # HQ = full-resolution original; parallels = alternate arts (AA, AA1, ...: numbering is a guess, a miss is just skipped)
                ac = c["code"] + (("AA" if int(c["v"][1:] or 0) <= 1 else "AA" + str(int(c["v"][1:]) - 1)) if re.fullmatch(r"p\d+", c.get("v") or "") else "")
                img, sub, ext = f"{OPPP}{OPPP_KEY}/cards/HQ/{urllib.parse.quote(ac)}", ("Alternate art" if c.get("v") else ""), "png"
                if c.get("v") and not re.fullmatch(r"p\d+", c["v"]):
                    continue
            if sub:
                os.makedirs(os.path.join(folder, sub), exist_ok=True)
            path = os.path.join(folder, sub, f"{e}_{_safe(c['name'])}.{ext}")
            if not img or os.path.exists(path) or os.path.exists(os.path.splitext(path)[0] + ".webp"):
                skipped += 1
                continue
            if _fetch(img, path, say, stop, f"{s['setname']} #{c['num']}"):
                got += 1
                misses = 0
            else:
                misses += 1
                if misses >= 25:
                    say("The picture site keeps refusing - stopped. Start the download again later; it continues where it was.")
                    stop.set()
            time.sleep(0.6 if oppp else PAUSE)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
    say(f"{got:,} pictures saved, {skipped:,} already there or without a picture.")


def apply_meta(conn, game, out):
    """After the folder scan: real card numbers, rarity, card type, text, prices (EUR), set names and dates."""
    try:
        with open(os.path.join(out, META), encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        return
    rows = []
    for k, v in meta.get("cards", {}).items():
        code, e = k.split("|", 1)
        rows.append((v.get("n") or e, v.get("r") or "", v.get("t") or "", v.get("x") or "", v.get("p"), game, code, norm_num(e)))
    conn.executemany("UPDATE OR IGNORE cg_cards SET number=?, rarity=?, ctype=?, rules=CASE WHEN COALESCE(rules,'')='' THEN ? ELSE rules END, price=? "
                     "WHERE game=? AND set_code=? AND number=?", rows)
    conn.executemany("UPDATE cg_sets SET name=?, released=? WHERE game=? AND code=?",
                     [(s["name"], s.get("released") or "", game, code) for code, s in meta.get("sets", {}).items()])
    conn.commit()
