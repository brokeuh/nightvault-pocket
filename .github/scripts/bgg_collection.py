"""Nightvault Boardgames: the owner's BoardGameGeek collection -> data/boardgames/collection.json

Run by .github/workflows/bgg.yml (daily). Needs the repository secrets BGG_USERNAME and BGG_TOKEN (the application token from
boardgamegeek.com/applications - BGG's XML API refuses requests without one). Asks BGG for:
  1. the collection (games and expansions apart, because BGG labels expansions as games otherwise), with stats
  2. the details of every game in it (players, play time, age, complexity, expansion links, designers ...), 20 at a time
  3. the logged plays (for the play history, last played)
Polite: one request at a time with a pause, waits when BGG says "202 = preparing" or "429 = too many".
For testing: BGG_SAMPLES=<folder> reads collection_boardgame.xml / collection_boardgameexpansion.xml / thing_<n>.xml / plays_<n>.xml
from that folder instead of asking BGG.
"""
import datetime, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

USER = os.environ.get("BGG_USERNAME", "").strip()
TOKEN = os.environ.get("BGG_TOKEN", "").strip()
SAMPLES = os.environ.get("BGG_SAMPLES", "")
OUT = os.environ.get("BGG_OUT", "data/boardgames/collection.json")
API = "https://boardgamegeek.com/xmlapi2/"
_thing_n = [0]
_plays_n = [0]


def get(path):
    if SAMPLES:
        name = path.split("?")[0]
        if name == "collection":
            name += "_" + urllib.parse.parse_qs(path.split("?", 1)[1]).get("subtype", ["boardgame"])[0]
        elif name == "thing":
            _thing_n[0] += 1; name += f"_{_thing_n[0]}"
        elif name == "plays":
            _plays_n[0] += 1; name += f"_{_plays_n[0]}"
        p = os.path.join(SAMPLES, name + ".xml")
        return open(p, "rb").read() if os.path.exists(p) else b"<items/>"
    for attempt in range(12):
        req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + TOKEN,
                                                         "User-Agent": "Nightvault/0.1 (personal board game shelf, once a day)"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                if r.status == 202:
                    print("BGG is preparing the list ..."); time.sleep(6); continue
                data = r.read()
                time.sleep(2.5)
                return data
        except urllib.error.HTTPError as e:
            if e.code == 202:
                time.sleep(6); continue
            if e.code == 429 or e.code >= 500:
                time.sleep(10 + 5 * attempt); continue
            if e.code in (401, 403):
                sys.exit(f"BoardGameGeek refused the token (error {e.code}). Check the BGG_TOKEN secret and that the application is approved on BGG.")
            raise
        except urllib.error.URLError:
            time.sleep(10); continue
    sys.exit("BoardGameGeek kept saying 'busy' - try again later.")


def kid(e, n):
    return next((c for c in e if c.tag == n), None) if e is not None else None


def val(e, n, attr="value"):
    c = kid(e, n)
    return (c.get(attr) or "") if c is not None else ""


def txt(e, n):
    c = kid(e, n)
    return (c.text or "").strip() if c is not None and c.text else ""


def num(x, f=float):
    try:
        v = f(x)
        return v if v else None
    except (TypeError, ValueError):
        return None


def check(root):
    if root.tag == "errors" or root.tag == "error":
        sys.exit("BoardGameGeek: " + " ".join(t.strip() for t in root.itertext() if t.strip()))
    m = kid(root, "error")
    if m is not None:
        sys.exit("BoardGameGeek: " + " ".join(t.strip() for t in m.itertext() if t.strip()))


def collection():
    games = {}
    for sub in ("boardgame", "boardgameexpansion"):
        q = {"username": USER, "stats": 1, "subtype": sub}
        if sub == "boardgame":
            q["excludesubtype"] = "boardgameexpansion"
        root = ET.fromstring(get("collection?" + urllib.parse.urlencode(q)))
        check(root)
        for it in root.findall("item"):
            gid = num(it.get("objectid"), int)
            if not gid:
                continue
            st = kid(it, "status")
            s = {k: (st.get(k) == "1") for k in ("own", "prevowned", "fortrade", "want", "wanttoplay", "wanttobuy", "wishlist", "preordered")} if st is not None else {}
            if not (s.get("own") or s.get("wishlist") or s.get("preordered") or s.get("wanttobuy") or s.get("want")):
                continue
            stats, rating = kid(it, "stats"), kid(kid(it, "stats"), "rating")
            rank = None
            ranks = kid(rating, "ranks")
            if ranks is not None:
                rank = next((num(r.get("value"), int) for r in ranks if r.get("name") == "boardgame"), None)
            g = games.get(gid) or {}
            g.update(id=gid, name=txt(it, "name") or g.get("name", ""), year=num(txt(it, "yearpublished"), int),
                     type="expansion" if sub == "boardgameexpansion" else "game",
                     image=txt(it, "image"), thumb=txt(it, "thumbnail"),
                     status=dict(own=s.get("own", False), wishlist=s.get("wishlist", False),
                                 wishPriority=num(st.get("wishlistpriority"), int) if st is not None and s.get("wishlist") else None,
                                 preordered=s.get("preordered", False), wantToBuy=s.get("wanttobuy", False), want=s.get("want", False),
                                 prevOwned=s.get("prevowned", False), forTrade=s.get("fortrade", False)),
                     myRating=num(rating.get("value") if rating is not None else None), rating=num(val(rating, "average")),
                     rank=rank, plays=num(txt(it, "numplays"), int) or 0,
                     comment=txt(it, "comment") or txt(it, "wishlistcomment"), modified=st.get("lastmodified", "") if st is not None else "",
                     players=[num(stats.get("minplayers"), int), num(stats.get("maxplayers"), int)] if stats is not None else [None, None],
                     time=[num(stats.get("minplaytime"), int), num(stats.get("maxplaytime"), int)] if stats is not None else [None, None])
            games[gid] = g
    return games


def details(games):
    ids = sorted(games)
    for i in range(0, len(ids), 20):
        root = ET.fromstring(get("thing?" + urllib.parse.urlencode({"id": ",".join(map(str, ids[i:i + 20])), "stats": 1})))
        check(root)
        for it in root.findall("item"):
            gid = num(it.get("id"), int)
            g = games.get(gid)
            if not g:
                continue
            mn, mx = num(val(it, "minplayers"), int), num(val(it, "maxplayers"), int)
            t0, t1 = num(val(it, "minplaytime"), int), num(val(it, "maxplaytime"), int)
            if mn or mx: g["players"] = [mn, mx]
            if t0 or t1: g["time"] = [t0, t1]
            g["age"] = num(val(it, "minage"), int)
            ratings = kid(kid(it, "statistics"), "ratings")
            g["weight"] = num(val(ratings, "averageweight"))
            if g.get("rating") is None: g["rating"] = num(val(ratings, "average"))
            if not g.get("image"): g["image"] = txt(it, "image")
            if not g.get("thumb"): g["thumb"] = txt(it, "thumbnail")
            about = html.unescape(html.unescape(txt(it, "description")))
            about = re.sub(r"[ \t]+", " ", about).strip()
            g["about"] = about[:1500] + ("…" if len(about) > 1500 else "")
            links = it.findall("link")
            pick = lambda t, n=6: [l.get("value") for l in links if l.get("type") == t][:n]
            g["designers"], g["publishers"] = pick("boardgamedesigner"), pick("boardgamepublisher", 3)
            g["categories"], g["mechanics"] = pick("boardgamecategory"), pick("boardgamemechanic", 8)
            # an expansion links to its base game with inbound="true"; a base game links to its expansions without it
            ex = [num(l.get("id"), int) for l in links if l.get("type") == "boardgameexpansion"]
            if it.get("type") == "boardgameexpansion" or g["type"] == "expansion":
                g["type"] = "expansion"
                g["expands"] = [x for x in ex if x]
            else:
                g["expansions"] = [x for x in ex if x]


def plays(games):
    out, page = [], 1
    while page <= 30:                             # 100 plays per page, up to 3000
        root = ET.fromstring(get("plays?" + urllib.parse.urlencode({"username": USER, "page": page})))
        check(root)
        ps = root.findall("play")
        for p in ps:
            item = kid(p, "item")
            gid = num(item.get("objectid"), int) if item is not None else None
            pl = []
            for x in (list(kid(p, "players")) if kid(p, "players") is not None else []):
                pl.append(dict(n=x.get("name") or x.get("username") or "", u=x.get("username") or "", s=x.get("score") or "",
                               w=x.get("win") == "1"))
            out.append(dict(id=num(p.get("id"), int), date=p.get("date") or "", game=gid, name=item.get("name") if item is not None else "",
                            qty=num(p.get("quantity"), int) or 1, len=num(p.get("length"), int), loc=p.get("location") or "",
                            note=txt(p, "comments")[:300], players=pl))
        total = num(root.get("total"), int) or 0
        if not ps or page * 100 >= total:
            break
        page += 1
    last = {}
    for p in out:
        if p["game"] and p["date"] > last.get(p["game"], ""):
            last[p["game"]] = p["date"]
    for gid, d in last.items():
        if gid in games:
            games[gid]["lastPlayed"] = d
    return out


def main():
    if not USER or (not TOKEN and not SAMPLES):
        sys.exit("Add the repository secrets BGG_USERNAME and BGG_TOKEN first (Settings → Secrets and variables → Actions).")
    games = collection()
    print(f"{len(games)} games/expansions in the collection")
    if games:
        details(games)
    ps = plays(games)
    print(f"{len(ps)} plays")
    data = dict(format="nightvault-bgg", version=1, user=USER,
                fetched=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                games=sorted(games.values(), key=lambda g: g["name"].lower()), plays=ps)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8"))
        except Exception:
            pass
    if old and {k: v for k, v in old.items() if k != "fetched"} == {k: v for k, v in data.items() if k != "fetched"}:
        print("Nothing changed on BGG.")
        return
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("Saved", OUT)


if __name__ == "__main__":
    main()
