"""One Piece card data, offline: downloads the public lists once from optcgapi.com (open, no key), keeps them in opcards.json
next to the Nightvault data, and looks cards up by number or name. Refresh whenever new sets come out. Used by the Card templates page."""
import json
import os
import re
import threading
import time

SOURCES = ["https://optcgapi.com/api/allSetCards/", "https://optcgapi.com/api/allSTCards/", "https://optcgapi.com/api/allPromoCards/"]
_LOCK = threading.Lock()
_MEM = {}


def _first(d, *keys):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", "NULL", "null"):
            return v
    return ""


def _num(v):
    try:
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return None


def normalise(c):
    """One card of the list -> dict(id, name, category, colors, cost, power, life, counter, types, attribute, rarity, set, text, trigger)."""
    text = str(_first(c, "card_text", "effect", "text", "ability") or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text).replace("&nbsp;", " ").replace("&amp;", "&").replace("\r", "").strip()
    trig = ""
    m = re.search(r"\[Trigger\]\s*(.*)$", text, re.S)
    if m:
        trig = m.group(1).strip()
        text = text[:m.start()].strip()
    colors = _first(c, "card_color", "colors", "color")
    if isinstance(colors, str):
        colors = [x.strip() for x in re.split(r"[/,]", colors) if x.strip()]
    types = _first(c, "sub_types", "types", "type", "traits")
    if isinstance(types, list):
        types = "/".join(types)
    attr = _first(c, "attribute", "attributes")
    if isinstance(attr, list):
        attr = "/".join(attr)
    return dict(id=str(_first(c, "card_set_id", "id", "card_id", "number")).strip(), name=re.sub(r"\s*\((parallel|alternate art|manga|sp)\)\s*$", "", str(_first(c, "card_name", "name")), flags=re.I).strip(),
                category=str(_first(c, "card_type", "category")), colors=colors or [], cost=_num(_first(c, "card_cost", "cost")),
                power=_num(_first(c, "card_power", "power")), life=_num(_first(c, "life")),
                counter=_num(_first(c, "counter_amount", "counter")), types=str(types or ""), attribute=str(attr or ""),
                rarity=str(_first(c, "rarity")), set=str(_first(c, "set_name", "set")), text=text, trigger=trig)


def store_path(base):
    return os.path.join(str(base), "opcards.json")


def update(base, fetch):
    """Downloads every list with fetch(url) -> bytes and keeps the cards. Returns dict(count, saved)."""
    cards, seen = [], set()
    errors = []
    for url in SOURCES:
        try:
            data = json.loads(fetch(url))
        except Exception as e:
            errors.append("%s: %s" % (url, e))
            continue
        if isinstance(data, dict):
            data = data.get("data") or data.get("cards") or []
        for c in data:
            n = normalise(c)
            key = (n["id"], n["name"], n["rarity"])
            if n["id"] and key not in seen:
                seen.add(key)
                cards.append(n)
    if not cards:
        raise ValueError("Could not download the card list (%s)" % "; ".join(errors)[:300])
    os.makedirs(str(base), exist_ok=True)
    tmp = store_path(base) + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dict(saved=time.strftime("%Y-%m-%d %H:%M"), cards=cards, errors=errors), f, ensure_ascii=False)
    os.replace(tmp, store_path(base))
    with _LOCK:
        _MEM.clear()
    return dict(count=len(cards), saved=time.strftime("%Y-%m-%d %H:%M"), errors=errors)


def _load(base):
    p = store_path(base)
    if not os.path.exists(p):
        return None
    st = os.stat(p).st_mtime
    with _LOCK:
        if _MEM.get("m") == st:
            return _MEM["d"]
    d = json.load(open(p, encoding="utf-8"))
    with _LOCK:
        _MEM.update(m=st, d=d)
    return d


def status(base):
    d = _load(base)
    return dict(have=bool(d), count=len(d["cards"]) if d else 0, saved=d["saved"] if d else "")


def find(base, q, limit=30):
    d = _load(base)
    if not d:
        return []
    q = (q or "").strip().lower()
    if not q:
        return []
    exact, part = [], []
    for c in d["cards"]:
        i, n = c["id"].lower(), c["name"].lower()
        if i == q:
            exact.append(c)
        elif i.startswith(q) or q in n:
            part.append(c)
    return (exact + part)[:limit]
