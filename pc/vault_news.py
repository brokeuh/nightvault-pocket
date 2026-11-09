"""Nightvault - new volumes / issues check for the PC app (the overnight version of Bookcase's daily check).

Looks, once a day, at every comic / manga series that is in the PC library and asks the internet how many volumes or issues exist now:
  manga   -> MangaDex (volumes that have a cover, or the last volume of a finished series), AniList as the second opinion
  comics  -> the Grand Comics Database (comics.org): how many issues the series has
It remembers the answer, so the next check can say what is NEW since last time, and which numbers the PC does not have yet.
Nothing is downloaded or changed in the library: it only keeps a small list (setting "news").

vault.py calls   init(get, put, series)   once, and   start()   to run the daily thread;  vault_phone.py serves  news()  at /nv/news.
  series() -> [{gid, name, kind:'comic'|'manga'|'book'|'rpg', numbers:[owned volume/issue numbers], count}]
"""
import difflib
import json
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.request

UA = "NightvaultBookcase/1.0 (personal app; github.com/brokeuh)"
MDX = "https://api.mangadex.org"
ANL = "https://graphql.anilist.co"
GCD = "https://www.comics.org/api"
DAY = 24 * 3600

_ctx = {}
_st = {"running": False, "done": 0, "total": 0, "error": "", "thread": None}


def init(get, put, series, fetch=None):
    _ctx.update(get=get, put=put, series=series, fetch=fetch or _fetch)


def _fetch(url, data=None, headers=None, timeout=40):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"^(the|de|het|een|les?|la)\s+", "", re.sub(r"[^a-z0-9 ]+", " ", s).strip())
    return re.sub(r"\s+", " ", s).strip()


def _same(a, b):
    a, b = _norm(a), _norm(b)
    return bool(a and b) and (a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.86)


def _num(v):
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return None


def _get(url, **kw):
    f = _ctx.get("fetch") or _fetch
    return f(url, **kw)


def _mdx(name):
    """(source id, [volume numbers], status) from MangaDex, or None."""
    q = urllib.parse.urlencode([("title", name), ("limit", 5), ("order[relevance]", "desc"), ("contentRating[]", "safe"), ("contentRating[]", "suggestive"),
                                ("contentRating[]", "erotica"), ("contentRating[]", "pornographic")])
    j = _get(MDX + "/manga?" + q)
    hit = None
    for m in j.get("data", []):
        a = m.get("attributes") or {}
        names = list((a.get("title") or {}).values()) + [x for alt in a.get("altTitles") or [] for x in alt.values()]
        if any(_same(name, n) for n in names):
            hit = m
            break
    if not hit:
        return None
    time.sleep(0.4)
    vols = set()
    for off in range(0, 1500, 100):
        c = _get(MDX + "/cover?" + urllib.parse.urlencode([("manga[]", hit["id"]), ("limit", 100), ("offset", off)]))
        for x in c.get("data", []):
            n = _num((x.get("attributes") or {}).get("volume"))
            if n is not None and n > 0:
                vols.add(n)
        if off + 100 >= c.get("total", 0) or not c.get("data"):
            break
        time.sleep(0.4)
    a = hit.get("attributes") or {}
    last = _num(a.get("lastVolume"))
    if a.get("status") == "completed" and last and last < 400:
        vols |= set(range(1, int(last) + 1))
    return hit["id"], sorted(vols), a.get("status") or ""


def _anl(name):
    q = ("query($s:String){Page(perPage:5){media(search:$s,type:MANGA,sort:SEARCH_MATCH){id title{romaji english native} volumes status}}}")
    time.sleep(2.2)
    j = _get(ANL, data=json.dumps({"query": q, "variables": {"s": name}}).encode(), headers={"Content-Type": "application/json"})
    for m in ((j.get("data") or {}).get("Page") or {}).get("media") or []:
        if any(_same(name, t) for t in (m.get("title") or {}).values() if t) and m.get("volumes"):
            return "a%s" % m["id"], list(range(1, int(m["volumes"]) + 1)), (m.get("status") or "").lower()
    return None


def _gcd(name):
    """(source id, issue count) from the Grand Comics Database - a series with the same name; the biggest one wins."""
    time.sleep(3.2)
    j = _get(GCD + "/series/name/" + urllib.parse.quote(name) + "/?format=json")
    best = None
    for s in j.get("results") or []:
        if _same(name, s.get("name")) and (s.get("issue_count") or 0) > (best or {}).get("issue_count", 0):
            best = s
    return ("g%s" % str(best.get("api_url", "")).rstrip("/").rsplit("/", 1)[-1], best["issue_count"]) if best else None


def check_one(s, old):
    """The answer for one series: {src, online, newest, missing, new, at}."""
    now = int(time.time())
    res = None
    if s["kind"] == "manga":
        try:
            res = _mdx(s["name"])
        except Exception:
            res = None
        if not res or not res[1]:
            res = _anl(s["name"])
        if not res or not res[1]:
            return {"src": "", "at": now}
        src, vols, status = res
        owned = set(s.get("numbers") or [])
        prev = set(old.get("vols") or []) if old.get("src") == src else None
        new = {v for v in vols if prev is not None and v not in prev and v not in owned}
        new |= {v for v in (old.get("new") or []) if old.get("src") == src and v in vols and v not in owned}      # stays NEW until the PC has it
        return {"src": src, "status": status, "vols": vols, "online": len(vols), "newest": vols[-1], "missing": sorted(v for v in vols if v not in owned),
                "new": sorted(new), "at": now}
    if s["kind"] == "comic":
        r = _gcd(s["name"])
        if not r:
            return {"src": "", "at": now}
        src, n = r
        prev = old.get("online") if old.get("src") == src else None
        grew = max(0, n - prev) if prev is not None else 0
        newn = (old.get("newN") or 0 if old.get("src") == src else 0) + grew
        return {"src": src, "online": n, "missingN": max(0, n - (s.get("count") or 0)), "newN": newn, "at": now}
    return None


def run(force=False):
    """Check every series now (used by the daily thread and the 'Check now' button). One at a time, politely."""
    if _st["running"]:
        return
    _st.update(running=True, done=0, error="")
    try:
        old = json.loads(_ctx["get"]("news", "") or "{}")
        series = [x for x in _ctx["series"]() if x["kind"] in ("manga", "comic")]
        _st["total"] = len(series)
        out = {"at": int(time.time()), "items": {}}
        for s in series:
            o = (old.get("items") or {}).get(s["gid"]) or {}
            if not force and o.get("at") and time.time() - o["at"] < DAY * (7 if o.get("status") in ("finished", "completed") else 1) - 600:
                out["items"][s["gid"]] = o                   # checked recently
            else:
                try:
                    r = check_one(s, o)
                except Exception as e:
                    r, _st["error"] = o or {"src": "", "at": int(time.time())}, "%s: %s" % (type(e).__name__, e)
                if r:
                    out["items"][s["gid"]] = dict(r, name=s["name"], kind=s["kind"])
            _st["done"] += 1
        for gid, o in out["items"].items():                 # what is owned now is no longer new
            o.setdefault("name", "")
        _ctx["put"]("news", json.dumps(out))
    except Exception as e:
        _st["error"] = "%s: %s" % (type(e).__name__, e)
    finally:
        _st["running"] = False


def news():
    """What the phone and the PC screen show: {at, running, done, total, error, items:{gid: {...}}}."""
    try:
        d = json.loads(_ctx["get"]("news", "") or "{}")
    except Exception:
        d = {}
    own = {}
    try:
        for s in _ctx["series"]():
            own[s["gid"]] = s
    except Exception:
        pass
    items = {}
    for gid, o in (d.get("items") or {}).items():
        s = own.get(gid)
        if not s or not o.get("src"):
            continue
        if s["kind"] == "manga":
            owned = set(s.get("numbers") or [])
            miss = [v for v in o.get("vols") or [] if v not in owned]
            new = [v for v in o.get("new") or [] if v not in owned]
            items[gid] = dict(name=s["name"], kind="manga", online=o.get("online"), newest=o.get("newest"), missing=miss, new=new, src=o["src"], at=o.get("at"))
        else:
            miss = max(0, (o.get("online") or 0) - (s.get("count") or 0))
            items[gid] = dict(name=s["name"], kind="comic", online=o.get("online"), missing=miss, new=min(o.get("newN") or 0, miss), src=o["src"], at=o.get("at"))
    return {"at": d.get("at") or 0, "running": _st["running"], "done": _st["done"], "total": _st["total"], "error": _st["error"], "items": items}


def start():
    """Daily thread: a minute after start-up if the last check is over a day old, then every hour it looks if a day has passed (and it is night, or overdue)."""
    if _st["thread"] or not _ctx:
        return

    def loop():
        time.sleep(60)
        while True:
            try:
                at = (json.loads(_ctx["get"]("news", "") or "{}")).get("at") or 0
                hour = time.localtime().tm_hour
                if time.time() - at > DAY and (hour < 7 or time.time() - at > 2 * DAY or not at):
                    run()
            except Exception as e:
                _st["error"] = "%s: %s" % (type(e).__name__, e)
            time.sleep(3600)
    _st["thread"] = threading.Thread(target=loop, daemon=True)
    _st["thread"].start()


def run_async(force=True):
    if not _st["running"]:
        threading.Thread(target=run, args=(force,), daemon=True).start()
