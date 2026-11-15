#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analiz365 - gunluk bulten guncelleme betigi.

Calistirma:  python scripts/update.py
Cikti:       data/data.js  (site bu dosyayi okur)

Kaynaklar
  * ESPN acik veri akisi: fikstur, sonuc, kadro, oyuncu istatistikleri, NBA.
  * Oranlar: once ESPN akisindaki "Bet 365", yoksa Nesine acik bulteni (iddaa
    programi), yoksa diger saglayici (or. DraftKings), o da yoksa Analiz365 modeli.
  * Wikidata: takim / ulke adlarinin Rusca, Turkce ve Turkmence karsiliklari.
Puan tablolari (genel / ic saha / dis saha), form, aralarindaki maclar ve skor
tahmini bu betikte hesaplanir.
"""
import difflib
import gzip
import json
import math
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "data", "data.js")
SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer/"
CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/"
BB_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/"
BB_CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/"
WD_SPARQL = "https://query.wikidata.org/sparql?format=json&query="
TSDB = "https://www.thesportsdb.com/api/v1/json/123/"


# ---- Ligler ----------------------------------------------------------------
def L(id, tr, ru, tk, g, cup=False, nat=False, tier=1, tsdb=None, table=True):
    return {"id": id, "n": {"tr": tr, "ru": ru, "tk": tk}, "g": g, "cup": cup, "nat": nat, "tier": tier,
            "tsdb": tsdb, "table": table}


LEAGUES = [
    L("tur.1", "Süper Lig", "Суперлига Турции", "Türkiýe Superligasy", "tr"),
    # Turkiye alt ligleri: TheSportsDB (ESPN akisinda yok)
    L("tur.2", "TFF 1. Lig", "Первая лига Турции", "Türkiýe 1-nji ligasy", "tr", tier=2, tsdb=4676),
    L("tur.3", "TFF 2. Lig", "Вторая лига Турции", "Türkiýe 2-nji ligasy", "tr", tier=2, tsdb=4679, table=False),
    L("rus.1", "Rusya Premier Ligi", "Российская Премьер-лига", "Russiýa Premýer-ligasy", "ru"),
    L("rus.2", "Rusya 1. Lig (FNL)", "Первая лига России (ФНЛ)", "Russiýa 1-nji ligasy (FNL)", "ru", tier=2, tsdb=4666),
    L("uefa.champions", "UEFA Şampiyonlar Ligi", "Лига чемпионов УЕФА", "UEFA Çempionlar ligasy", "eu", cup=True),
    L("uefa.europa", "UEFA Avrupa Ligi", "Лига Европы УЕФА", "UEFA Ýewropa ligasy", "eu", cup=True),
    L("uefa.europa.conf", "UEFA Konferans Ligi", "Лига конференций УЕФА", "UEFA Konferensiýa ligasy", "eu", cup=True),
    L("uefa.nations", "UEFA Uluslar Ligi", "Лига наций УЕФА", "UEFA Milletler ligasy", "nat", cup=True, nat=True),
    L("fifa.friendly", "Milli Hazırlık Maçları", "Товарищеские матчи сборных", "Ýygyndylaryň ýoldaşlyk oýunlary", "nat", cup=True, nat=True),
    L("fifa.worldq.uefa", "Dünya Kupası Avrupa Elemeleri", "Отбор ЧМ (Европа)", "Dünýä çempionatynyň saýlama tapgyry (Ýewropa)", "nat", cup=True, nat=True),
    L("uefa.euroq", "Avrupa Şampiyonası Elemeleri", "Отбор чемпионата Европы", "Ýewropa çempionatynyň saýlama tapgyry", "nat", cup=True, nat=True),
    L("caf.nations_qual", "Afrika Uluslar Kupası Elemeleri", "Отбор Кубка африканских наций", "Afrika Milletler kubogynyň saýlama tapgyry", "nat", cup=True, nat=True),
    L("eng.1", "Premier League", "Английская Премьер-лига", "Angliýa Premýer-ligasy", "en"),
    L("eng.2", "Championship (2. Lig)", "Чемпионшип (2-я лига)", "Çempionşip (2-nji liga)", "en", tier=2),
    L("eng.3", "League One (3. Lig)", "Лига 1 (3-я лига)", "Liga 1 (3-nji liga)", "en", tier=2),
    L("eng.4", "League Two (4. Lig)", "Лига 2 (4-я лига)", "Liga 2 (4-nji liga)", "en", tier=2),
    L("esp.1", "La Liga", "Ла Лига", "La Liga", "es"),
    L("esp.2", "La Liga 2 (2. Lig)", "Сегунда (2-я лига)", "La Liga 2 (2-nji liga)", "es", tier=2),
    L("ger.1", "Bundesliga", "Бундеслига", "Bundesliga", "de"),
    L("ger.2", "2. Bundesliga", "Вторая Бундеслига", "2-nji Bundesliga", "de", tier=2),
    L("ita.1", "Serie A", "Серия А", "A Seriýa", "it"),
    L("ita.2", "Serie B (2. Lig)", "Серия B (2-я лига)", "B Seriýa (2-nji liga)", "it", tier=2),
    L("fra.1", "Ligue 1", "Лига 1 (Франция)", "Liga 1 (Fransiýa)", "fr"),
    L("fra.2", "Ligue 2 (2. Lig)", "Лига 2 (Франция)", "Liga 2 (Fransiýa)", "fr", tier=2),
    L("ned.1", "Eredivisie", "Эредивизи", "Eredivisie", "nl"),
    L("ned.2", "Eerste Divisie (2. Lig)", "Первый дивизион (2-я лига)", "Eerste Divisie (2-nji liga)", "nl", tier=2),
    L("por.1", "Portekiz Ligi (Primeira Liga)", "Чемпионат Португалии (Примейра)", "Portugaliýa ligasy (Primeýra)", "pt"),
    # Portekiz 2. ligi: TheSportsDB (ESPN akisinda yok)
    L("por.2", "Portekiz 2. Lig (Liga Portugal 2)", "Вторая лига Португалии", "Portugaliýa 2-nji ligasy", "pt", tier=2, tsdb=4662),
    L("bel.1", "Belçika Pro Lig", "Про-лига Бельгии", "Belgiýa Pro-ligasy", "ot"),
    L("sco.1", "İskoçya Premiership", "Премьершип Шотландии", "Şotlandiýa Premýerşipi", "ot"),
]
LGMAP = {l["id"]: l for l in LEAGUES}

HISTORY_START = "2025-08-01"   # aralarindaki maclar icin gecmis
DAYS_AHEAD = 14                # bultende kac gun ilerisi
DETAIL_DAYS = 8                # kadro + oyuncu istatistigi kac gun ilerisi icin
RESULT_DAYS = 14               # sonuclar sayfasi / kupon sonuclandirma
MARGIN = 1.07                  # site oranlarindaki pay (model oranlari)
THREADS = 12
FINAL = {"STATUS_FULL_TIME", "STATUS_FINAL_AET", "STATUS_FINAL_PEN"}

NOW = datetime.now(timezone.utc)
SEASON_START = datetime(NOW.year if NOW.month >= 7 else NOW.year - 1, 7, 1, tzinfo=timezone.utc)


# ---- Yardimcilar -----------------------------------------------------------
def fx(s):
    """Kaynaktaki cift kodlanmis UTF-8 metinleri duzeltir (Ã‡ -> Ç)."""
    if not isinstance(s, str):
        return s
    if any(c in s for c in "ÃÅÄ"):
        for enc in ("cp1252", "latin1"):
            try:
                return s.encode(enc).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
    return s


def get(url, tries=3, ua="Mozilla/5.0"):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            time.sleep(1.5 * (i + 1))
        except Exception:
            time.sleep(1.5 * (i + 1))
    return None


def cache_read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def cache_write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def pdate(s):
    for fmt in ("%Y-%m-%dT%H:%MZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return NOW


def pmap(fn, items, label="", threads=THREADS):
    out = []
    with ThreadPoolExecutor(threads) as ex:
        for i, r in enumerate(ex.map(fn, items), 1):
            out.append(r)
            if label and i % 500 == 0:
                print(f"   {label}: {i}/{len(items)}", flush=True)
    return out


def amer(v):
    v = float(v)
    if v == 0:
        return None
    return round(1 + v / 100 if v > 0 else 1 + 100 / abs(v), 2)


def frac(v):
    v = str(v).strip().upper()
    if v in ("EVS", "EVENS", "EVEN"):
        return 2.0
    try:
        if "/" in v:
            a, b = v.split("/")
            return round(float(a) / float(b) + 1, 2)
        f = float(v)
        return round(f, 2) if f > 1 else None
    except (ValueError, ZeroDivisionError):
        return None


# ---- Fikstur / sonuc -------------------------------------------------------
def parse_event(e, lg):
    try:
        c = e["competitions"][0]
        st = e["status"]["type"]
        comp = {x["homeAway"]: x for x in c["competitors"]}

        def tm(x):
            t = x["team"]
            n = fx(t.get("displayName") or t.get("name") or "?")
            return {"id": str(t["id"]), "n": n, "s": fx(t.get("shortDisplayName") or n), "l": t.get("logo") or ""}

        def sc(x):
            try:
                return int(x.get("score") or 0)
            except (TypeError, ValueError):
                return 0

        return {"id": str(e["id"]), "lg": lg, "d": e["date"], "state": st.get("state"),
                "status": st.get("name"), "slug": (e.get("season") or {}).get("slug", ""),
                "h": tm(comp["home"]), "a": tm(comp["away"]), "hs": sc(comp["home"]), "as": sc(comp["away"]),
                "v": fx((c.get("venue") or {}).get("fullName") or "")}
    except Exception:
        return None


def load_day(job):
    lg, day = job
    key = day.strftime("%Y%m%d")
    path = os.path.join(CACHE, "sb", lg, key + ".json")
    old = day.date() <= (NOW - timedelta(days=3)).date()
    if old:
        c = cache_read(path)
        if c is not None:
            return c
    base = BB_SITE if lg == "nba" else SITE + lg + "/"
    d = get(f"{base}scoreboard?dates={key}&limit=200")
    if d is None:
        return cache_read(path) or []
    evs = [x for x in (parse_event(e, lg) for e in d.get("events", [])) if x]
    if old:
        cache_write(path, evs)
    return evs


# ---- TheSportsDB (Turkiye / Rusya alt ligleri) -----------------------------
_ts_lock = threading.Lock()
_ts_last = [0.0]


def ts_get(path):
    """Ucretsiz anahtar dakikada ~30 istek verir: istekler arasi 2.2 sn bekle."""
    for i in range(4):
        with _ts_lock:
            wait = 2.6 - (time.time() - _ts_last[0])
            if wait > 0:
                time.sleep(wait)
            _ts_last[0] = time.time()
        try:
            req = urllib.request.Request(TSDB + path, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(25 * (i + 1))
    return None


def tsdb_events(lg):
    """Bir ligin sezon fiksturunu tur tur okur; bitmis turlar onbellekten gelir."""
    lid, season = lg["tsdb"], f"{SEASON_START.year}-{SEASON_START.year + 1}"
    out, fails = [], 0
    for rnd in range(1, 51):
        path = os.path.join(CACHE, "tsdb", f"{lid}_{season}_{rnd}.json")
        c = cache_read(path)
        fresh = False
        if c is not None:
            evs = c["ev"]
            dts = [pdate(e["d"]) for e in evs]
            final = bool(evs) and all(e["status"] in FINAL for e in evs)
            near = any(NOW - timedelta(days=5) <= d <= NOW + timedelta(days=DAYS_AHEAD + 2) for d in dts)
            age = time.time() - c.get("ts", 0)
            fresh = (final and (not near or age < 20 * 3600)) or (not final and not near and age < 6 * 86400) \
                or (near and age < 3 * 3600)
        if not fresh:
            d = ts_get(f"eventsround.php?id={lid}&r={rnd}&s={season}")
            if d is None:
                # gecici hata: onbellekte ne varsa onu kullan, sonraki tura gec
                fails += 1
                for e in (c or {}).get("ev", []):
                    e["tr"] = [lid, rnd, season]
                out.extend((c or {}).get("ev", []))
                if fails >= 3:
                    break
                continue
            else:
                fails = 0
                evs = []
                for e in d.get("events") or []:
                    try:
                        stt = (e.get("strStatus") or "NS").upper()
                        if e.get("strPostponed") == "yes" or stt in ("PST", "POSTPONED", "CANC", "ABD"):
                            continue
                        done_ = stt in ("FT", "AET", "PEN", "MATCH FINISHED") and e.get("intHomeScore") is not None
                        tsv = (e.get("strTimestamp") or (e["dateEvent"] + "T" + (e.get("strTime") or "12:00:00")))[:16]
                        evs.append({
                            "id": "T" + str(e["idEvent"]), "lg": lg["id"], "d": tsv + "Z",
                            "state": "post" if done_ else "pre",
                            "status": "STATUS_FULL_TIME" if done_ else "STATUS_SCHEDULED", "slug": "",
                            "h": {"id": "T" + str(e["idHomeTeam"]), "n": e["strHomeTeam"], "s": e["strHomeTeam"],
                                  "l": e.get("strHomeTeamBadge") or ""},
                            "a": {"id": "T" + str(e["idAwayTeam"]), "n": e["strAwayTeam"], "s": e["strAwayTeam"],
                                  "l": e.get("strAwayTeamBadge") or ""},
                            "hs": int(e.get("intHomeScore") or 0), "as": int(e.get("intAwayScore") or 0),
                            "v": e.get("strVenue") or ""})
                    except Exception:
                        continue
                cache_write(path, {"ts": time.time(), "ev": evs})
        if not evs:
            break
        for e in evs:
            e["tr"] = [lid, rnd, season]      # canli skor: tarayici tum turu tek istekle okur
        out.extend(evs)
    return out


# ---- Kadro (oynanmis mac) --------------------------------------------------
def load_lineup(job):
    lg, eid = job
    path = os.path.join(CACHE, "lu", eid + ".json")
    c = cache_read(path)
    if c is not None:
        return eid, c
    d = get(f"{SITE}{lg}/summary?event={eid}")
    if d is None:
        return eid, {}
    res = {}
    for r in d.get("rosters") or []:
        tid = str((r.get("team") or {}).get("id"))
        xi, bench = [], []
        for p in r.get("roster") or []:
            a = p.get("athlete") or {}
            name = fx(a.get("displayName") or a.get("fullName") or "")
            if not name:
                continue
            if p.get("starter"):
                try:
                    place = int(p.get("formationPlace") or 0)
                except (TypeError, ValueError):
                    place = 0
                xi.append({"n": name, "j": p.get("jersey") or "",
                           "p": (p.get("position") or {}).get("abbreviation") or "", "o": place})
            else:
                bench.append(name)
        if xi:
            res[tid] = {"f": r.get("formation") or "", "xi": xi, "bench": bench, "red": []}
    for k in d.get("keyEvents") or []:
        if "red" in ((k.get("type") or {}).get("type") or "").lower():
            tid = str((k.get("team") or {}).get("id"))
            for pt in k.get("participants") or []:
                nm = fx((pt.get("athlete") or {}).get("displayName") or "")
                if nm and tid in res:
                    res[tid]["red"].append(nm)
    # kadrosu olmayan maclari da onbellekle (tekrar tekrar indirilmesin)
    cache_write(path, res)
    return eid, res


# ---- Oyuncu istatistikleri -------------------------------------------------
def load_roster(job):
    lg, tid = job
    path = os.path.join(CACHE, "ro", f"{lg}_{tid}.json")
    c = cache_read(path)
    if c and time.time() - c.get("ts", 0) < 20 * 3600:
        return (lg, tid), c["p"]
    d = get(f"{SITE}{lg}/teams/{tid}/roster")
    if d is None:
        return (lg, tid), (c or {}).get("p", [])
    out = []
    for a in d.get("athletes") or []:
        st = {}
        for cat in ((a.get("statistics") or {}).get("splits") or {}).get("categories") or []:
            for s in cat.get("stats") or []:
                st[s.get("name")] = s.get("value") or 0
        ap = int(st.get("appearances", 0))
        if ap <= 0:
            continue
        iv = lambda k: int(st.get(k, 0) or 0)
        out.append({"n": fx(a.get("displayName") or ""), "p": (a.get("position") or {}).get("abbreviation") or "",
                    "j": a.get("jersey") or "", "ap": ap, "g": iv("totalGoals"), "a": iv("goalAssists"),
                    "sh": iv("totalShots"), "sot": iv("shotsOnTarget"), "yc": iv("yellowCards"),
                    "rc": iv("redCards"), "sv": iv("saves")})
    out.sort(key=lambda p: (-p["g"], -p["a"], -p["ap"]))
    out = out[:14]
    cache_write(path, {"ts": time.time(), "p": out})
    return (lg, tid), out


# ---- Oranlar ---------------------------------------------------------------
B365 = {"preMatchFullTimeResultHome": "1", "preMatchFullTimeResultDraw": "X",
        "preMatchFullTimeResultAway": "2", "preMatchDoubleChanceHomeOrDraw": "1X",
        "preMatchDoubleChanceHomeOrAway": "12", "preMatchDoubleChanceDrawOrAway": "X2"}


def load_odds(m):
    """Doner: {'b365': {...}} ve/veya {'alt': {'name', '1','X','2', 'line','O','U'}}"""
    if m["id"].startswith("T"):      # TheSportsDB maclarinda oran akisi yok
        return m["id"], {}
    bb = m["lg"] == "nba"
    base = BB_CORE if bb else CORE + m["lg"] + "/"
    d = get(f"{base}events/{m['id']}/competitions/{m['id']}/odds")
    res = {}
    for it in (d or {}).get("items") or []:
        prov = it.get("provider") or {}
        if str(prov.get("id")) == "2000" and not bb:
            out = {}
            to = (it.get("bettingOdds") or {}).get("teamOdds") or {}
            for k, key in B365.items():
                val = frac((to.get(k) or {}).get("value", ""))
                if val:
                    out[key] = val
            for k, key in (("homeTeamOdds", "1"), ("awayTeamOdds", "2")):
                if key not in out:
                    val = ((it.get(k) or {}).get("odds") or {}).get("value")
                    if val and val > 1:
                        out[key] = round(float(val), 2)
            if "X" not in out:
                val = (it.get("drawOdds") or {}).get("value")
                if val and val > 1:
                    out["X"] = round(float(val), 2)
            try:
                hc = float((to.get("preMatchOverUnderHandicap") or {}).get("value"))
                ov = frac((to.get("preMatchGoalLineOver") or {}).get("value", ""))
                un = frac((to.get("preMatchGoalLineUnder") or {}).get("value", ""))
                if hc == 2.5 and ov and un:
                    out["O2.5"], out["U2.5"] = ov, un
            except (TypeError, ValueError):
                pass
            if all(k in out for k in ("1", "X", "2")):
                res["b365"] = out
        elif "alt" not in res:
            try:
                alt = {"name": prov.get("name") or "Piyasa",
                       "1": amer((it.get("homeTeamOdds") or {}).get("moneyLine")),
                       "2": amer((it.get("awayTeamOdds") or {}).get("moneyLine"))}
                if not bb:
                    alt["X"] = amer((it.get("drawOdds") or {}).get("moneyLine"))
                if it.get("overUnder") and it.get("overOdds") and it.get("underOdds"):
                    alt["line"] = float(it["overUnder"])
                    alt["O"] = amer(it["overOdds"])
                    alt["U"] = amer(it["underOdds"])
            except (TypeError, ValueError):
                continue
            if alt.get("1") and alt.get("2") and (bb or alt.get("X")):
                res["alt"] = alt
    return m["id"], res


# ---- Tahmin modeli (Poisson) -----------------------------------------------
MAXG = 8


def pois(lam):
    return [math.exp(-lam) * lam ** k / math.factorial(k) for k in range(MAXG + 1)]


def outcome(lh, la):
    ph, pa = pois(lh), pois(la)
    p1 = px = p2 = 0.0
    for i in range(MAXG + 1):
        for j in range(MAXG + 1):
            p = ph[i] * pa[j]
            if i > j:
                p1 += p
            elif i == j:
                px += p
            else:
                p2 += p
    s = p1 + px + p2
    return p1 / s, px / s, p2 / s


GRID = [round(0.15 + 0.05 * i, 2) for i in range(72)]
_TABLE = None


def market_lambdas(q1, qx, q2):
    """Piyasa olasiliklarina en iyi uyan gol beklentilerini bulur."""
    global _TABLE
    if _TABLE is None:
        _TABLE = [(a, b) + outcome(a, b) for a in GRID for b in GRID]
    best, be = None, 9
    for a, b, p1, px, p2 in _TABLE:
        e = (p1 - q1) ** 2 + (px - qx) ** 2 + (p2 - q2) ** 2
        if e < be:
            be, best = e, (a, b)
    return best


def team_stats(games):
    st = defaultdict(lambda: {k: {"p": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0,
                                  "cs": 0, "btts": 0, "o25": 0} for k in ("home", "away")})
    hg = ag = 0
    for g in games:
        hg += g["hs"]
        ag += g["as"]
        for side, tid, gf, ga in (("home", g["h"]["id"], g["hs"], g["as"]),
                                  ("away", g["a"]["id"], g["as"], g["hs"])):
            s = st[tid][side]
            s["p"] += 1
            s["gf"] += gf
            s["ga"] += ga
            s["w" if gf > ga else "d" if gf == ga else "l"] += 1
            s["cs"] += ga == 0
            s["btts"] += gf > 0 and ga > 0
            s["o25"] += gf + ga > 2
    n = max(len(games), 1)
    avg_h = hg / n if games else 1.5
    avg_a = ag / n if games else 1.2
    return st, max(avg_h, 0.6), max(avg_a, 0.5)


def model_lambdas(st, avg_h, avg_a, hid, aid, form_h, form_a):
    K = 4.0
    h, a = st[hid], st[aid]

    def rate(gf, n, avg):
        return (gf + K * avg) / (n + K) / avg

    att_h = rate(h["home"]["gf"], h["home"]["p"], avg_h)
    def_h = rate(h["home"]["ga"], h["home"]["p"], avg_a)
    att_a = rate(a["away"]["gf"], a["away"]["p"], avg_a)
    def_a = rate(a["away"]["ga"], a["away"]["p"], avg_h)
    avg_all = (avg_h + avg_a) / 2
    att_h_all = rate(h["home"]["gf"] + h["away"]["gf"], h["home"]["p"] + h["away"]["p"], avg_all)
    def_h_all = rate(h["home"]["ga"] + h["away"]["ga"], h["home"]["p"] + h["away"]["p"], avg_all)
    att_a_all = rate(a["home"]["gf"] + a["away"]["gf"], a["home"]["p"] + a["away"]["p"], avg_all)
    def_a_all = rate(a["home"]["ga"] + a["away"]["ga"], a["home"]["p"] + a["away"]["p"], avg_all)
    lh = avg_h * (0.6 * att_h + 0.4 * att_h_all) * (0.6 * def_a + 0.4 * def_a_all)
    la = avg_a * (0.6 * att_a + 0.4 * att_a_all) * (0.6 * def_h + 0.4 * def_h_all)
    lh *= 1 + 0.12 * (form_h - 0.5) - 0.06 * (form_a - 0.5)
    la *= 1 + 0.12 * (form_a - 0.5) - 0.06 * (form_h - 0.5)
    return min(max(lh, 0.25), 3.6), min(max(la, 0.2), 3.4)


def predict(lh, la):
    ph, pa = pois(lh), pois(la)
    mat = [[ph[i] * pa[j] for j in range(MAXG + 1)] for i in range(MAXG + 1)]
    tot = sum(map(sum, mat))
    mat = [[v / tot for v in r] for r in mat]
    p1 = sum(mat[i][j] for i in range(MAXG + 1) for j in range(MAXG + 1) if i > j)
    px = sum(mat[i][i] for i in range(MAXG + 1))
    p2 = 1 - p1 - px

    def over(n):
        return sum(mat[i][j] for i in range(MAXG + 1) for j in range(MAXG + 1) if i + j > n)

    btts = sum(mat[i][j] for i in range(1, MAXG + 1) for j in range(1, MAXG + 1))
    scores = sorted(((mat[i][j], i, j) for i in range(6) for j in range(6)), reverse=True)
    top = [[i, j, round(p, 4)] for p, i, j in scores[:6]]
    best = max((p1, "1"), (px, "X"), (p2, "2"))
    if best[0] >= 0.45:
        ok = {"1": lambda i, j: i > j, "X": lambda i, j: i == j, "2": lambda i, j: i < j}[best[1]]
        sc = next([i, j] for p, i, j in scores if ok(i, j))
    else:
        sc = [scores[0][1], scores[0][2]]
    h1, a1 = pois(lh * 0.44), pois(la * 0.44)
    ht = max(((h1[i] * a1[j], i, j) for i in range(4) for j in range(4)))
    r = lambda v: round(v, 4)
    return {"lh": round(lh, 2), "la": round(la, 2), "p1": r(p1), "px": r(px), "p2": r(p2),
            "o15": r(over(1)), "o25": r(over(2)), "o35": r(over(3)), "btts": r(btts),
            "score": sc, "ht": [ht[1], ht[2]], "top": top}


def odd(p):
    p = min(max(p, 0.012), 0.97)
    return round(max(1.01, 1 / (p * MARGIN)), 2)


# ---- Puan tablosu ----------------------------------------------------------
def build_tables(games, team_ids):
    rows = {k: {t: {"t": t, "p": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0, "pts": 0, "f": []}
                for t in team_ids} for k in ("all", "home", "away")}
    for g in sorted(games, key=lambda x: x["d"]):
        for side, tid, gf, ga in (("home", g["h"]["id"], g["hs"], g["as"]),
                                  ("away", g["a"]["id"], g["as"], g["hs"])):
            res = "W" if gf > ga else "D" if gf == ga else "L"
            for k in ("all", side):
                r = rows[k].get(tid)
                if r is None:
                    continue
                r["p"] += 1
                r["gf"] += gf
                r["ga"] += ga
                r[res.lower()] += 1
                r["pts"] += 3 if res == "W" else 1 if res == "D" else 0
                r["f"].append(res)
    out = {}
    for k, d in rows.items():
        lst = sorted(d.values(), key=lambda r: (-r["pts"], -(r["gf"] - r["ga"]), -r["gf"]))
        for r in lst:
            r["f"] = r["f"][-5:]
        out[k] = lst
    return out


# ---- Takim adlarinin cevirisi (Wikidata, toplu sorgu) ----------------------
WD_UA = "bulletin-updater/1.0 (python-urllib)"
LG_COUNTRY = {"tur.1": "Q43", "tur.2": "Q43", "tur.3": "Q43", "rus.1": "Q159", "rus.2": "Q159",
              "eng.1": "Q145", "eng.2": "Q145", "eng.3": "Q145", "eng.4": "Q145", "sco.1": "Q145",
              "esp.1": "Q29", "esp.2": "Q29", "ger.1": "Q183", "ger.2": "Q183", "ita.1": "Q38", "ita.2": "Q38",
              "fra.1": "Q142", "fra.2": "Q142", "ned.1": "Q55", "ned.2": "Q55", "por.1": "Q45", "por.2": "Q45", "bel.1": "Q31"}
# Avrupa kupalarina katilan diger ulkeler
EURO_Q = ["Q41", "Q40", "Q39", "Q213", "Q36", "Q212", "Q35", "Q34", "Q20", "Q224", "Q403", "Q218", "Q219",
          "Q28", "Q229", "Q801", "Q227", "Q232", "Q214", "Q215", "Q33", "Q27", "Q225", "Q217", "Q399", "Q230",
          "Q184", "Q189", "Q211", "Q37", "Q191", "Q222", "Q221", "Q236", "Q1246", "Q32", "Q233"]
EXTRA_NAT = ["Q21", "Q22", "Q25", "Q26", "Q1246", "Q4628", "Q1410", "Q8646", "Q14773", "Q219060", "Q865",
             "Q25279", "Q23635", "Q25228", "Q5785", "Q11703", "Q16641", "Q30971", "Q17012", "Q3769"]
NAT_ALIAS = {"Türkiye": "Turkey", "Czechia": "Czech Republic", "Bosnia-Herzegovina": "Bosnia and Herzegovina",
             "Congo DR": "Democratic Republic of the Congo", "Kyrgyz Republic": "Kyrgyzstan",
             "Chinese Taipei": "Taiwan", "Korea Republic": "South Korea", "Korea DPR": "North Korea",
             "USA": "United States of America", "United States": "United States of America",
             "Cape Verde Islands": "Cape Verde", "Congo": "Republic of the Congo", "China": "People's Republic of China",
             "St. Kitts and Nevis": "Saint Kitts and Nevis", "St. Lucia": "Saint Lucia", "Gambia": "The Gambia",
             "St. Vincent and the Grenadines": "Saint Vincent and the Grenadines", "Ireland": "Republic of Ireland"}
DROP = {"fc", "afc", "cf", "sc", "fk", "sk", "jk", "ac", "as", "cd", "ud", "sd", "rc", "rcd", "club", "de", "the",
        "pfc", "ssc", "us", "sv", "vfl", "vfb", "tsg", "bsc", "calcio", "futbol", "football", "kulubu", "1", "f", "c"}
STRIP_RE = re.compile(r"^(FC|FK|PFC|SK|JK|CF|AFC|SC|ФК|ПФК|АФК|СК)\s+|\s+(FC|FK|SK|JK|CF|AFC|SC|F\.C\.|S\.K\.|A\.Ş\.|ФК)$")


def clean_label(s):
    s = re.sub(r"\s*\(.*?\)\s*$", "", s or "").strip()
    for _ in range(2):
        s = STRIP_RE.sub("", s).strip()
    return s if len(s) <= 34 else ""


def norm(s, drop=True):
    for a_, b_ in (("ı", "i"), ("İ", "i"), ("ø", "o"), ("ß", "ss"), ("æ", "ae"), ("ł", "l"), ("đ", "d")):
        s = s.replace(a_, b_)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    toks = [t for t in re.split(r"[^a-z0-9]+", s) if t and not (drop and t in DROP)]
    return " ".join(toks)


def wd_query(key, where):
    path = os.path.join(CACHE, "wd", key + ".json")
    c = cache_read(path)
    if c and time.time() - c.get("ts", 0) < 30 * 86400:
        return c["rows"]
    q = ('SELECT ?c ?en ?ru ?tr ?tk (GROUP_CONCAT(DISTINCT ?alt;separator="|") AS ?alts) WHERE { ' + where +
         ' ?c rdfs:label ?en. FILTER(lang(?en)="en")'
         ' OPTIONAL{?c rdfs:label ?ru. FILTER(lang(?ru)="ru")} OPTIONAL{?c rdfs:label ?tr. FILTER(lang(?tr)="tr")}'
         ' OPTIONAL{?c rdfs:label ?tk. FILTER(lang(?tk)="tk")} OPTIONAL{?c skos:altLabel ?alt. FILTER(lang(?alt)="en")}'
         ' FILTER(BOUND(?ru)||BOUND(?tr)||BOUND(?tk)) } GROUP BY ?c ?en ?ru ?tr ?tk')
    time.sleep(1.5)
    d = get(WD_SPARQL + urllib.parse.quote(q), tries=2, ua=WD_UA)
    if d is None:
        return (c or {}).get("rows", [])
    rows = []
    for b_ in d["results"]["bindings"]:
        v = lambda k: (b_.get(k) or {}).get("value", "")
        rows.append({"q": v("c").rsplit("/", 1)[-1], "en": v("en"), "ru": v("ru"), "tr": v("tr"), "tk": v("tk"),
                     "alts": [x for x in v("alts").split("|") if x]})
    cache_write(path, {"ts": time.time(), "rows": rows})
    return rows


def make_index(rows, drop=True):
    idx = {}
    for r in rows:
        score = bool(r["ru"]) + bool(r["tr"]) + bool(r["tk"])
        for nm in [r["en"]] + r["alts"]:
            k = norm(nm, drop)
            if k and (k not in idx or score > idx[k][0]):
                idx[k] = (score, r)
    return idx


# ---- Nesine acik bulteni (iddaa programi: mac sonucu, cifte sans, alt/ust, KG) ----
NES_URLS = ["https://bulten.nesine.com/api/bulten/getprebultenfull",
            "https://cdnbulten.nesine.com/api/bulten/getprebultenfull"]
NES_DC = {1: "1X", 2: "12", 3: "X2"}


def nesine_load():
    """Doner: {'fb': [...], 'bb': [...]}; her kayit {'t': epoch sn, 'h', 'a', 'o': {...}}."""
    path = os.path.join(CACHE, "nesine.json")
    c = cache_read(path)
    if c and time.time() - c.get("ts", 0) < 20 * 60:
        return c["v"]
    sg = None
    for url in NES_URLS:
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/126.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*", "Accept-Encoding": "gzip",
                "Referer": "https://www.nesine.com/", "Origin": "https://www.nesine.com"})
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
            sg = json.loads(raw.decode("utf-8")).get("sg") or {}
            if sg.get("EA"):
                break
        except Exception as ex:
            print(f"   Nesine okunamadi ({url.split('/')[2]}): {ex}", flush=True)
    out = {"fb": [], "bb": []}
    if not sg or not sg.get("EA"):
        return out
    ok = lambda v: isinstance(v, (int, float)) and v > 1.01
    for e in sg["EA"]:
        if not e.get("HN") or not e.get("AN") or not e.get("ESD") or e.get("TYPE") not in (1, 2):
            continue
        o, lines = {}, []
        for m in e.get("MA") or []:
            if m.get("MS") != 1:                     # kapali / askida pazar
                continue
            oc = {x.get("N"): x.get("O") for x in m.get("OCA") or []}
            mst, sov = m.get("MST"), float(m.get("SOV") or 0)
            if e["TYPE"] == 1:
                if mst == 1 and all(ok(oc.get(i)) for i in (1, 2, 3)):
                    o["1"], o["X"], o["2"] = oc[1], oc[2], oc[3]
                elif mst == 92:
                    for i, k in NES_DC.items():
                        if ok(oc.get(i)):
                            o[k] = oc[i]
                elif mst == 101 and sov in (1.5, 2.5, 3.5) and ok(oc.get(1)) and ok(oc.get(2)):
                    o[f"U{sov}"], o[f"O{sov}"] = oc[1], oc[2]
                elif mst == 89 and ok(oc.get(1)) and ok(oc.get(2)):
                    o["KGV"], o["KGY"] = oc[1], oc[2]
            else:
                if mst == 2 and ok(oc.get(1)) and ok(oc.get(2)):
                    o["1"], o["2"] = oc[1], oc[2]
                elif mst == 114 and ok(oc.get(1)) and ok(oc.get(2)):
                    lines.append((0 if m.get("BM") else 1, abs(oc[1] - oc[2]), sov, oc[1], oc[2]))
        if lines:                                    # ana cizgi; yoksa en dengeli cizgi
            _, _, ln_, un, ov = min(lines)
            o["line"], o["U"], o["O"] = ln_, un, ov
        if o:
            out["fb" if e["TYPE"] == 1 else "bb"].append(
                {"t": int(e["ESD"] / 1000), "h": fx(e["HN"]), "a": fx(e["AN"]), "o": o})
    cache_write(path, {"ts": time.time(), "v": out})
    return out


def name_sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = set(a.split()), set(b.split())
    r = difflib.SequenceMatcher(None, a, b).ratio()
    if ta <= tb or tb <= ta:                         # "Phoenix" ~ "Phoenix Suns"
        r = max(r, 0.9 if min(len(a), len(b)) >= 4 else 0.7)
    elif ta & tb and max(len(x) for x in ta & tb) >= 5:
        r = max(r, 0.75)
    return r


def nes_find(evs, dt, hn, an, tol=1800):
    """Baslama saati ve takim adlari uyan Nesine macinin oranlari (yoksa None)."""
    t0 = dt.timestamp()
    best, second = (0, None), 0
    for e in evs:
        gap = abs(e["t"] - t0)
        if gap > tol:
            continue
        sh = max(name_sim(n, e["h"]) for n in hn)
        sa = max(name_sim(n, e["a"]) for n in an)
        sc = min(sh, sa) + 0.25 * max(sh, sa) - (0.1 if gap > 300 else 0)
        if min(sh, sa) < 0.55 and not (max(sh, sa) >= 0.9 and min(sh, sa) >= 0.4):
            continue
        if sc > best[0]:
            second, best = best[0], (sc, e)
        elif sc > second:
            second = sc
    if best[1] is None or best[0] - second < 0.08:
        return None
    return best[1]["o"]


def country_rows():
    return wd_query(
        "countries", "{ ?c wdt:P31 wd:Q3624078 } UNION { ?c wdt:P31 wd:Q6256 } UNION { VALUES ?c { "
        + " ".join("wd:" + q for q in EXTRA_NAT) + " } }")


# Wikidata'da "cok sporlu kulup" gibi farkli kayitli ya da hic bulunamayan kulupler
NAME_FIX = {
    "Barcelona": {"tr": "Barcelona", "ru": "Барселона", "tk": "Barselona"},
    "Gaziantep FK": {"tr": "Gaziantep FK", "ru": "Газиантеп", "tk": "Gaziantep"},
    "Amed SFK": {"tr": "Amedspor", "ru": "Амедспор", "tk": "Amedspor"},
    "Erzurum BB": {"tr": "Erzurumspor FK", "ru": "Эрзурумспор", "tk": "Erzurumspor"},
    "AEK Athens": {"tr": "AEK", "ru": "АЕК Афины", "tk": "AEK Afiny"},
    "OFI Crete": {"tr": "OFI", "ru": "ОФИ", "tk": "OFI"},
    "Torreense": {"tr": "Torreense", "ru": "Торреенсе", "tk": "Torreense"},
    "Hapoel Be'er": {"tr": "Hapoel Beer Şeva", "ru": "Хапоэль Беэр-Шева", "tk": "Hapoel Beer-Şewa"},
    "Olympiacos": {"tr": "Olympiakos", "ru": "Олимпиакос", "tk": "Olimpiakos"},
    "RB Salzburg": {"tr": "Red Bull Salzburg", "ru": "Ред Булл Зальцбург", "tk": "Red Bull Zalsburg"},
    "Ferencvaros": {"tr": "Ferencváros", "ru": "Ференцварош", "tk": "Ferenswaroş"},
    "Osasuna": {"tr": "Osasuna", "ru": "Осасуна", "tk": "Osasuna"},
}
RESERVE_RE = re.compile(r"(\s(B|C|II|III)$|U-?\d{2}\b|Reserve|Juvenil|Youth|Women|Atlètic|Fortuna)", re.I)


def localize(teams, nat_ids, team_country):
    need = sorted({q for q in team_country.values()} | set(EURO_Q))
    by_c, glob = {}, {}
    for q in need:
        rows = wd_query("clubs_" + q, f"?c wdt:P31 wd:Q476028; wdt:P17 wd:{q}.")
        by_c[q] = make_index(rows)
        for k, v in by_c[q].items():
            if k not in glob or v[0] > glob[k][0]:
                glob[k] = v
    cidx = make_index(country_rows(), drop=False)
    hit = 0
    for tid, t in teams.items():
        rec = None
        if tid in nat_ids:
            rec = cidx.get(norm(NAT_ALIAS.get(t["n"], t["n"]), False))
        else:
            k = norm(t["n"])
            q = team_country.get(tid)
            rec = (by_c.get(q, {}).get(k) if q else None) or glob.get(k)
            if rec is None and q and len(k) >= 4:
                ks = set(k.split())
                cands = {v[1]["q"]: v for kk, v in by_c[q].items()
                         if ks <= set(kk.split()) or (len(kk) >= 5 and set(kk.split()) <= ks)}
                if len(cands) == 1:
                    rec = next(iter(cands.values()))
        if rec and not tid in nat_ids and RESERVE_RE.search(rec[1]["en"]) and not RESERVE_RE.search(t["n"]):
            rec = None                      # alt takim (B, C, U19...) ana takimla eslesmesin
        fix = NAME_FIX.get(t["n"])
        if fix:
            t.update(fix)
            hit += 1
            continue
        if rec:
            hit += 1
            for lg in ("ru", "tr", "tk"):
                lab = clean_label(rec[1][lg])
                if lab:
                    t[lg] = lab
    print(f"   {hit}/{len(teams)} takim adi eslesti", flush=True)


# ---- MollaMyrat'in kuponu (gunluk kupon + haftalik takip) ------------------
MOLLA = os.path.join(ROOT, "data", "molla.json")
MOLLA_DAYS = 2                 # kupon kac gunu kapsar / kac gunde bir yenilenir
TIP_KEYS = ["1", "X", "2", "1X", "X2", "O2.5", "U2.5", "KGV", "KGY"]
MOLLA_HI = 20.0                # yuksek oranli kuponun en dusuk toplam orani
MOLLA_SYS = (3, 5)             # sistem kuponu: 5 macin en az 3'u (3'lu kolonlar)


def wins(k, hs, as_):
    tot = hs + as_
    if k == "1":
        return hs > as_
    if k == "X":
        return hs == as_
    if k == "2":
        return hs < as_
    if k == "1X":
        return hs >= as_
    if k == "12":
        return hs != as_
    if k == "X2":
        return hs <= as_
    if k == "KGV":
        return hs > 0 and as_ > 0
    if k == "KGY":
        return not (hs > 0 and as_ > 0)
    n = float(k[1:])
    return tot > n if k[0] == "O" else tot < n


def tip_of(m):
    p = m["p"]
    pr = {"1": p["p1"], "X": p["px"], "2": p["p2"], "1X": p["p1"] + p["px"], "X2": p["px"] + p["p2"],
          "O2.5": p["o25"], "U2.5": 1 - p["o25"], "KGV": p["btts"], "KGY": 1 - p["btts"]}
    c = [(pr[k], k, m["o"][k]) for k in TIP_KEYS if m["o"].get(k)]
    fit = [x for x in c if wins(x[1], *p["score"])]
    c = fit or c
    good = [x for x in c if x[2] >= 1.3]
    c = good or c
    return max(c)


def molla(matches, done_by_id, src_team, use):
    state = cache_read(MOLLA) or {"coupons": {}}
    today = (NOW + timedelta(hours=5)).strftime("%Y-%m-%d")   # Askabat gunu
    # 1) bitmis maclari sonuclandir
    for c in state["coupons"].values():
        for pk in c["picks"] + (c.get("hi") or {}).get("picks", []) + (c.get("sys") or {}).get("picks", []):
            e = done_by_id.get(pk["id"])
            if e and "res" not in pk:
                pk["res"] = [e["hs"], e["as"]]
                pk["ok"] = wins(pk["k"], e["hs"], e["as"])
        for sc in c.get("scores", []):
            e = done_by_id.get(sc["id"])
            if e and "res" not in sc:
                sc["res"] = [e["hs"], e["as"]]
                sc["ok"] = [e["hs"], e["as"]] == sc["sc"]
    # 2) iki gunluk kupon: her 2 gunde bir, o iki gunun en saglam maclariyla olusturulur
    #    (mac sayisi sabit degil; sonradan degistirilmez)
    keys = sorted(state["coupons"])
    if keys:
        last = state["coupons"][keys[-1]]
        if last.get("v") != 2:                       # eski (gunluk 10 macli) kurallarla uretilmis kupon: bir kez yenile
            del state["coupons"][keys[-1]]
            keys = keys[:-1]
    day0 = datetime.strptime(today, "%Y-%m-%d")
    due = not keys or (day0 - datetime.strptime(keys[-1], "%Y-%m-%d")).days >= MOLLA_DAYS

    def penalty(m):
        lg = LGMAP[m["lg"]]
        v = 0.03 if m["src"] != "model" else -0.03      # gercek piyasa orani olan maclar daha guvenilir
        if lg["tier"] > 1:
            v -= 0.04
        if m["lg"] == "fifa.friendly":                   # hazirlik maclari ongorulemez
            v -= 0.06
        return v

    def options(m, lo=1.18, hi=99.0):
        """Tahmini skorla celismeyen secenekler: [(olasilik, pazar, oran)]."""
        p = m["p"]
        pr = {"1": p["p1"], "X": p["px"], "2": p["p2"], "1X": p["p1"] + p["px"], "X2": p["px"] + p["p2"],
              "12": p["p1"] + p["p2"], "O1.5": p["o15"], "U3.5": 1 - p["o35"],
              "O2.5": p["o25"], "U2.5": 1 - p["o25"], "KGV": p["btts"], "KGY": 1 - p["btts"]}
        return [(pr[k], k, m["o"][k]) for k in pr if m["o"].get(k) and lo <= m["o"][k] <= hi
                and wins(k, *p["score"])]

    def base(m):
        return {"id": m["id"], "lg": m["lg"], "d": m["d"], "h": m["h"], "a": m["a"],
                "hn": src_team[m["h"]]["n"], "an": src_team[m["a"]]["n"]}

    def rec(t, m):
        return dict(base(m), k=t[1], o=t[2], p=round(t[0], 3), sc=m["p"]["score"])

    def window(key):
        """Kuponun kapsadigi 48 saat: simdi -> ikinci gunun sonu (Askabat 24:00 = UTC 19:00)."""
        w_end = datetime.strptime(key, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=MOLLA_DAYS) - timedelta(hours=5)
        return [m for m in matches if NOW + timedelta(minutes=15) < pdate(m["d"]) <= w_end]

    def high_coupon(pool):
        """Toplam orani en az MOLLA_HI olan kupon: olasiligi en yuksek orta oranli secimler."""
        for lo, hi, pmin, cap in ((1.5, 3.0, 0.45, 9), (1.7, 4.5, 0.33, 8)):
            c = []
            for m in pool:
                opts = [x for x in options(m, lo, hi) if x[0] >= pmin]
                if opts:
                    best = max(opts, key=lambda x: x[0] + 0.05 * min(x[2] - lo, 1))
                    c.append((best[0] + penalty(m), best, m))
            c.sort(key=lambda x: -x[0])
            out, tot = [], 1.0
            for _, t, m in c[:cap]:
                out.append((t, m))
                tot *= t[2]
                if tot >= MOLLA_HI:
                    out.sort(key=lambda x: x[1]["d"])
                    return {"picks": [rec(t_, m_) for t_, m_ in out]}
        return None

    def system_coupon(pool, avoid):
        """Sistem kuponu: oran 1.5+ en guvenilir 5 mac; 3'lu kolonlar (en az 3 dogru kazandirir)."""
        need, n = MOLLA_SYS
        c = []
        for m in pool:
            opts = [x for x in options(m, 1.5, 2.8) if x[0] >= 0.48]
            if opts:
                best = max(opts, key=lambda x: x[0])
                c.append((m["id"] in avoid, -(best[0] + penalty(m)), best, m))
        c.sort(key=lambda x: (x[0], x[1]))
        c = c[:n]
        if len(c) < need + 1:
            return None
        c.sort(key=lambda x: x[3]["d"])
        return {"k": need, "picks": [rec(t, m) for _, _, t, m in c]}

    if due:
        until = (day0 + timedelta(days=MOLLA_DAYS - 1)).strftime("%Y-%m-%d")
        pool = window(today)
        cands = []
        for m in pool:
            opts = options(m)
            if not opts:
                continue
            best = max(opts, key=lambda x: x[0] + 0.03 * min(x[2] - 1.18, 1))   # olasilik onde, oran ikinci
            cands.append((best[0] + penalty(m), best, m))
        cands.sort(key=lambda x: -x[0])
        picks = []
        for thr in (0.76, 0.71, 0.66):
            picks = [c for c in cands if c[0] >= thr]
            if len(picks) >= 3:
                break
        picks = picks[:8] or cands[:3]
        picks.sort(key=lambda x: x[2]["d"])

        def sprob(m):
            sc = m["p"]["score"]
            return next((x[2] for x in m["p"]["top"] if x[:2] == sc), m["p"]["top"][0][2])

        best_sc = sorted(pool, key=lambda m: -(sprob(m) + penalty(m) / 3))[:5]
        if picks:
            state["coupons"][today] = {
                "v": 2, "until": until,
                "picks": [rec(t, m) for _, t, m in picks],
                "scores": [dict(base(m), sc=m["p"]["score"], sp=round(sprob(m), 3)) for m in
                           sorted(best_sc, key=lambda m: m["d"])]}
    # 2b) guncel kuponun yaninda yuksek oranli ve sistem kuponu (bir kez uretilir, sonra degismez)
    keys = sorted(state["coupons"])
    if keys:
        cur = state["coupons"][keys[-1]]
        if "hi" not in cur or "sys" not in cur:
            pool = window(keys[-1])
            if "hi" not in cur:
                hc = high_coupon(pool)
                if hc:
                    cur["hi"] = hc
            if "sys" not in cur:
                avoid = {x["id"] for x in cur["picks"]} | {x["id"] for x in (cur.get("hi") or {}).get("picks", [])}
                sc_ = system_coupon(pool, avoid)
                if sc_:
                    cur["sys"] = sc_
    # 3) eski kayitlari at, kaydet
    keep = (NOW - timedelta(days=400)).strftime("%Y-%m-%d")
    state["coupons"] = {k: v for k, v in state["coupons"].items() if k >= keep}
    cache_write(MOLLA, state)
    show = keep
    out = [dict(v, date=k) for k, v in sorted(state["coupons"].items(), reverse=True) if k >= show]
    for c in out:
        for x in c["picks"] + c.get("scores", []) + (c.get("hi") or {}).get("picks", []) + (c.get("sys") or {}).get("picks", []):
            use(x["h"])
            use(x["a"])
    return {"today": today, "coupons": out}


# ---- Basketbol (NBA) -------------------------------------------------------
def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bb_wins(k, hs, as_, line):
    if k == "1":
        return hs > as_
    if k == "2":
        return hs < as_
    return hs + as_ > line if k == "BO" else hs + as_ < line


BB_TS = {"avgPoints": "ppg", "avgPointsAgainst": "opp", "fieldGoalPct": "fg", "threePointFieldGoalPct": "tp",
         "avgRebounds": "reb", "avgAssists": "ast", "avgSteals": "stl", "avgBlocks": "blk",
         "avgTotalTurnovers": "to", "Last Ten Games": "l10", "streak": "strk"}
BB_LEAD = {"pointsPerGame": "pts", "assistsPerGame": "ast", "reboundsPerGame": "reb"}


def bb_summary(eid):
    """Mac onizlemesi: takim liderleri, sakat/eksik oyuncular, takim istatistikleri."""
    path = os.path.join(CACHE, "bbs", eid + ".json")
    c = cache_read(path)
    if c and time.time() - c.get("ts", 0) < 5 * 3600:
        return eid, c["v"]
    d = get(f"{BB_SITE}summary?event={eid}")
    if d is None:
        return eid, (c or {}).get("v", {})
    res = {}

    def slot(x):
        return res.setdefault(str((x.get("team") or {}).get("id")), {"pl": [], "inj": [], "ts": {}})

    def ath(a):
        return {"n": fx(a.get("displayName") or a.get("fullName") or ""), "j": a.get("jersey") or "",
                "p": (a.get("position") or {}).get("abbreviation") or ""}

    for grp in d.get("leaders") or []:
        s = slot(grp)
        for cat in grp.get("leaders") or []:
            top = (cat.get("leaders") or [None])[0]
            k = BB_LEAD.get(cat.get("name"))
            if not top or not k:
                continue
            row = ath(top.get("athlete") or {})
            if row["n"]:
                s["pl"].append(dict(row, k=k, v=str(top.get("displayValue") or "")))
    for grp in d.get("injuries") or []:
        s = slot(grp)
        for x in (grp.get("injuries") or [])[:8]:
            row = ath(x.get("athlete") or {})
            if row["n"]:
                s["inj"].append({"n": row["n"], "p": row["p"], "s": x.get("status") or "",
                                 "t": fx((x.get("details") or {}).get("type") or "")})
    for grp in (d.get("boxscore") or {}).get("teams") or []:
        s = slot(grp)
        for x in grp.get("statistics") or []:
            k = BB_TS.get(x.get("name"))
            if k and x.get("displayValue") not in (None, ""):
                s["ts"][k] = str(x["displayValue"])
    cache_write(path, {"ts": time.time(), "v": res})
    return eid, res


def basketball():
    start = datetime(NOW.year if NOW.month >= 9 else NOW.year - 1, 10, 1, tzinfo=timezone.utc)
    days, d = [], start
    while d <= NOW + timedelta(days=8):
        days.append(d)
        d += timedelta(days=1)
    ev = {}
    for evs in pmap(load_day, [("nba", x) for x in days]):
        for e in evs:
            ev[e["id"]] = e
    allev = sorted(ev.values(), key=lambda e: e["d"])
    for e in allev:
        e["dt"] = pdate(e["d"])
    done = [e for e in allev if e["status"] == "STATUS_FINAL" and e["hs"] + e["as"] > 100]
    up = [e for e in allev if e["state"] == "pre" and e["status"] == "STATUS_SCHEDULED"
          and NOW - timedelta(hours=1) <= e["dt"] <= NOW + timedelta(days=7)]
    if not done and not up:
        return None
    new = lambda: {"p": 0, "w": 0, "pf": 0, "pa": 0, "f": []}
    st = defaultdict(lambda: {"all": new(), "home": new(), "away": new()})
    by_team = defaultdict(list)
    tot = n = 0
    for g in done:
        tot += g["hs"] + g["as"]
        n += 1
        by_team[g["h"]["id"]].append(g)
        by_team[g["a"]["id"]].append(g)
        for side, tid, pf, pa in (("home", g["h"]["id"], g["hs"], g["as"]), ("away", g["a"]["id"], g["as"], g["hs"])):
            for k in ("all", side):
                s = st[tid][k]
                s["p"] += 1
                s["w"] += pf > pa
                s["pf"] += pf
                s["pa"] += pa
                s["f"].append("W" if pf > pa else "L")
    avg = tot / (2 * n) if n else 113.0
    K = 3.0

    def rate(v, p):
        return (v + K * avg) / (p + K)

    def form_of(tid, k=6):
        out = []
        for g in by_team[tid][-k:][::-1]:
            home = g["h"]["id"] == tid
            gf, ga = (g["hs"], g["as"]) if home else (g["as"], g["hs"])
            out.append({"d": g["d"], "lg": "nba", "o": "b" + g["a" if home else "h"]["id"],
                        "ha": "H" if home else "A", "gf": gf, "ga": ga, "r": "W" if gf > ga else "L"})
        return out

    def split(s):
        return {"p": s["p"], "w": s["w"], "l": s["p"] - s["w"], "pf": s["pf"], "pa": s["pa"]}

    teams = {}
    for e in allev:
        for s in ("h", "a"):
            teams["b" + e[s]["id"]] = {"n": e[s]["n"], "s": e[s]["s"], "l": e[s]["l"]}
    odds = dict(pmap(load_odds, up))
    summ = dict(pmap(bb_summary, [m["id"] for m in up]))
    try:
        nes_bb = nesine_load()["bb"]
    except Exception:
        nes_bb = []
    matches = []
    for m in up:
        hid, aid = m["h"]["id"], m["a"]["id"]
        h, a = st[hid]["all"], st[aid]["all"]
        eh = avg + (rate(h["pf"], h["p"]) - avg) + (rate(a["pa"], a["p"]) - avg) + 1.6
        ea = avg + (rate(a["pf"], a["p"]) - avg) + (rate(h["pa"], h["p"]) - avg) - 1.6
        model = [round(eh, 1), round(ea, 1)]
        alt = (odds.get(m["id"]) or {}).get("alt")
        if not alt and nes_bb:
            no = nes_find(nes_bb, m["dt"], [m["h"]["n"], m["h"]["s"]], [m["a"]["n"], m["a"]["s"]])
            if no and no.get("1") and no.get("2"):
                alt = dict(no, name="Nesine")
        if alt:
            i1, i2 = 1 / alt["1"], 1 / alt["2"]
            q1 = i1 / (i1 + i2)
            # piyasa olasiligindan sayi farki (sd 12.5) ve varsa toplam cizgisi
            lo, hi = -40.0, 40.0
            for _ in range(40):
                mid = (lo + hi) / 2
                if phi(mid / 12.5) < q1:
                    lo = mid
                else:
                    hi = mid
            margin = 0.75 * lo + 0.25 * (eh - ea)
            total = 0.75 * alt["line"] + 0.25 * (eh + ea) if alt.get("line") else eh + ea
            eh, ea = (total + margin) / 2, (total - margin) / 2
        p1 = phi((eh - ea) / 12.5)
        total = eh + ea
        if alt:
            o = {"1": alt["1"], "2": alt["2"]}
            src = alt["name"]
        else:
            o = {"1": odd(p1), "2": odd(1 - p1)}
            src = "model"
        if alt and alt.get("line"):
            line = alt["line"]
            o["BO"], o["BU"] = alt["O"], alt["U"]
        else:
            line = round(total) + 0.5
        po = 1 - phi((line - total) / 18.5)
        if "BO" not in o:
            o["BO"], o["BU"] = odd(po), odd(1 - po)
        sh, sa = round(eh), round(ea)
        if sh == sa:
            sh += 1 if p1 >= 0.5 else -1
        # oneri: tahmini skorla celismeyen, olasiligi en yuksek pazar
        c = [(p1, "1"), (1 - p1, "2"), (po, "BO"), (1 - po, "BU")]
        c = [(p, k, o[k]) for p, k in c if o.get(k)]
        c = [x for x in c if bb_wins(x[1], sh, sa, line)] or c
        c = [x for x in c if x[2] >= 1.3] or c
        tp = max(c)
        h2h = [{"d": g["d"], "lg": "nba", "h": "b" + g["h"]["id"], "a": "b" + g["a"]["id"], "hs": g["hs"], "as": g["as"]}
               for g in by_team[hid] if {g["h"]["id"], g["a"]["id"]} == {hid, aid}][-6:][::-1]
        sm = summ.get(m["id"]) or {}
        side = lambda tid, k, dflt: (sm.get(tid) or {}).get(k) or dflt
        matches.append({"id": "b" + m["id"], "sport": "bb", "lg": "nba", "d": m["d"], "h": "b" + hid,
                        "a": "b" + aid, "v": m["v"], "src": src, "o": o, "line": line,
                        "p": {"p1": round(p1, 4), "p2": round(1 - p1, 4), "score": [sh, sa], "total": round(total, 1),
                              "margin": round(eh - ea, 1), "po": round(po, 4), "model": model},
                        "tip": {"k": tp[1], "p": round(tp[0], 4), "o": tp[2]},
                        "f": {"h": form_of(hid), "a": form_of(aid)}, "h2h": h2h,
                        "st": {"h": split(st[hid]["home"]), "a": split(st[aid]["away"]),
                               "ha": split(st[hid]["all"]), "aa": split(st[aid]["all"])},
                        "pl": {"h": side(hid, "pl", []), "a": side(aid, "pl", [])},
                        "inj": {"h": side(hid, "inj", []), "a": side(aid, "inj", [])},
                        "ts": {"h": side(hid, "ts", {}), "a": side(aid, "ts", {})}})
    cutoff = NOW - timedelta(days=RESULT_DAYS)
    results = [{"id": "b" + e["id"], "lg": "nba", "d": e["d"], "h": "b" + e["h"]["id"], "a": "b" + e["a"]["id"],
                "hs": e["hs"], "as": e["as"]} for e in done if e["dt"] >= cutoff][::-1]
    tables = {}
    for k in ("all", "home", "away"):
        tables[k] = sorted(({"t": "b" + tid, "p": s[k]["p"], "w": s[k]["w"], "l": s[k]["p"] - s[k]["w"],
                             "pf": round(s[k]["pf"] / s[k]["p"], 1), "pa": round(s[k]["pa"] / s[k]["p"], 1),
                             "f": s[k]["f"][-5:]} for tid, s in st.items() if s[k]["p"]),
                           key=lambda r: (-r["w"] / r["p"], -r["w"], -(r["pf"] - r["pa"])))
    print(f"   NBA: {len(matches)} mac, {len(results)} sonuc", flush=True)
    return {"teams": teams, "matches": matches, "results": results, "table": tables["all"], "tables": tables,
            "_done": {"b" + e["id"]: e for e in done}}


# ---- Ana akis --------------------------------------------------------------
def main():
    t0 = time.time()
    print("Analiz365 guncelleme basladi:", NOW.strftime("%Y-%m-%d %H:%M UTC"), flush=True)
    start = datetime.strptime(HISTORY_START, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end = NOW + timedelta(days=DAYS_AHEAD + 1)
    days, d = [], start
    while d <= end:
        days.append(d)
        d += timedelta(days=1)
    jobs = [(lg["id"], day) for lg in LEAGUES if not lg["tsdb"] for day in days]
    print(f"1/6 Fikstur ve sonuclar ({len(jobs)} gun-lig)...", flush=True)
    events = {}
    for evs in pmap(load_day, jobs, "fikstur"):
        for e in evs:
            events[e["id"]] = e
    for lg in LEAGUES:
        if lg["tsdb"]:
            evs = tsdb_events(lg)
            print(f"   {lg['n']['tr']}: {len(evs)} mac (TheSportsDB)", flush=True)
            for e in evs:
                events[e["id"]] = e
    allev = sorted(events.values(), key=lambda e: e["d"])
    for e in allev:
        e["dt"] = pdate(e["d"])
    done = [e for e in allev if e["status"] in FINAL]
    upcoming = [e for e in allev if e["state"] == "pre" and e["status"] == "STATUS_SCHEDULED"
                and NOW - timedelta(hours=1) <= e["dt"] <= NOW + timedelta(days=DAYS_AHEAD)]
    print(f"   {len(done)} bitmis mac, {len(upcoming)} bulten maci", flush=True)

    src_team = {}
    for e in allev:
        for s in ("h", "a"):
            src_team[e[s]["id"]] = e[s]
    teams = {}

    def use(tid):
        if tid not in teams and tid in src_team:
            t = src_team[tid]
            teams[tid] = {"n": t["n"], "s": t["s"], "l": t["l"]}

    by_team = defaultdict(list)
    for e in done:
        by_team[e["h"]["id"]].append(e)
        by_team[e["a"]["id"]].append(e)

    tables, lstats = {}, {}
    for lg in LEAGUES:
        lid = lg["id"]
        season = [e for e in done if e["lg"] == lid and e["dt"] >= SEASON_START]
        slug = ""
        if lg["cup"]:
            nxt = [e for e in upcoming if e["lg"] == lid]
            ref = nxt[0] if nxt else (season[-1] if season else None)
            slug = ref["slug"] if ref else ""
            season = [e for e in season if e["slug"] == slug] or season
            if not any(w in slug for w in ("league", "group")):
                slug = ""
        ids = {e[s]["id"] for e in season for s in ("h", "a")}
        if ids and lg["table"] and not lg["nat"] and (not lg["cup"] or slug):
            tables[lid] = build_tables(season, ids)
            for t in ids:
                use(t)
        lstats[lid] = team_stats(season)

    print("2/6 Oranlar (bet365 / diger saglayicilar)...", flush=True)
    odds = dict(pmap(load_odds, upcoming, "oran"))
    nb = sum(1 for v in odds.values() if "b365" in v)
    na = sum(1 for v in odds.values() if "b365" not in v and "alt" in v)
    print(f"   ESPN akisi: {nb} macta bet365, {na} macta diger saglayici", flush=True)

    nes_odds = {}
    try:
        nes_fb = nesine_load()["fb"]
        tr_nat = {}
        if nes_fb:
            try:
                cidx = make_index(country_rows(), drop=False)
            except Exception:
                cidx = {}
            for e in upcoming:
                if LGMAP[e["lg"]]["nat"]:
                    for sd in ("h", "a"):
                        rec = cidx.get(norm(NAT_ALIAS.get(e[sd]["n"], e[sd]["n"]), False))
                        if rec and rec[1]["tr"]:
                            tr_nat[e[sd]["id"]] = rec[1]["tr"]
        for e in upcoming:
            names = lambda t: [x for x in (t["n"], t["s"], tr_nat.get(t["id"])) if x]
            no = nes_find(nes_fb, e["dt"], names(e["h"]), names(e["a"]))
            if no and all(k in no for k in ("1", "X", "2")):
                nes_odds[e["id"]] = no
        print(f"   Nesine: bultendeki {len(nes_fb)} futbol macindan {len(nes_odds)} tanesi eslesti", flush=True)
    except Exception as ex:
        print("   Nesine atlandi:", ex, flush=True)

    print("3/6 Kadrolar ve oyuncu istatistikleri...", flush=True)
    soon = [m for m in upcoming if m["dt"] <= NOW + timedelta(days=DETAIL_DAYS) and not LGMAP[m["lg"]]["tsdb"]]
    need = {}
    for m in soon:
        n_games = 3 if LGMAP[m["lg"]]["tier"] == 1 else 1
        for s in ("h", "a"):
            for g in by_team[m[s]["id"]][-n_games:]:
                if not g["id"].startswith("T"):
                    need[g["id"]] = (g["lg"], g["id"])
    lineups = dict(pmap(load_lineup, list(need.values()), "kadro"))
    rjobs = sorted({(m["lg"], m[s]["id"]) for m in soon for s in ("h", "a")})
    rosters = dict(pmap(load_roster, rjobs, "oyuncu"))

    print("4/6 Tahminler ve analiz...", flush=True)

    def form_of(tid, n=6):
        out = []
        for g in by_team[tid][-n:][::-1]:
            home = g["h"]["id"] == tid
            gf, ga = (g["hs"], g["as"]) if home else (g["as"], g["hs"])
            opp = g["a" if home else "h"]["id"]
            use(opp)
            out.append({"d": g["d"], "lg": g["lg"], "o": opp, "ha": "H" if home else "A", "gf": gf, "ga": ga,
                        "r": "W" if gf > ga else "D" if gf == ga else "L"})
        return out

    def form_ratio(f):
        f = f[:5]
        if not f:
            return 0.5
        return sum(3 if x["r"] == "W" else 1 if x["r"] == "D" else 0 for x in f) / (3 * len(f))

    def squad(tid, lg):
        games = by_team[tid][-3:]
        lus = [(g, (lineups.get(g["id"]) or {}).get(tid)) for g in games]
        lus = [(g, l) for g, l in lus if l]
        if not lus:
            return None
        g, last = lus[-1]
        home = g["h"]["id"] == tid
        out = []
        same = [(gg, l) for gg, l in lus if gg["lg"] == lg]
        if same:
            for nm in same[-1][1].get("red", []):
                out.append({"n": nm, "w": "red"})
        prev = lus[:-1]
        if len(prev) >= 2:
            insq = {p["n"] for p in last["xi"]} | set(last.get("bench", []))
            cnt = defaultdict(int)
            for _, l in prev:
                for p in l["xi"]:
                    cnt[p["n"]] += 1
            for nm, c in cnt.items():
                if c == len(prev) and nm not in insq and not any(o["n"] == nm for o in out):
                    out.append({"n": nm, "w": "absent"})
        opp = g["a" if home else "h"]["id"]
        use(opp)
        return {"f": last["f"], "d": g["d"], "o": opp, "xi": sorted(last["xi"], key=lambda p: p["o"]), "out": out}

    matches = []
    for m in upcoming:
        lid = m["lg"]
        lg = LGMAP[lid]
        st, avg_h, avg_a = lstats[lid]
        hid, aid = m["h"]["id"], m["a"]["id"]
        use(hid)
        use(aid)
        fh, fa = form_of(hid), form_of(aid)
        lh, la = model_lambdas(st, avg_h, avg_a, hid, aid, form_ratio(fh), form_ratio(fa))
        o = odds.get(m["id"]) or {}
        b365, alt, nes = o.get("b365"), o.get("alt"), nes_odds.get(m["id"])
        # oncelik: bet365 > Nesine > diger saglayici (or. DraftKings) > Analiz365 modeli
        ref = b365 or nes or alt
        ref_name = "bet365" if b365 else "Nesine" if nes else alt["name"] if alt else "model"
        if ref:
            inv = [1 / ref["1"], 1 / ref["X"], 1 / ref["2"]]
            sm_ = sum(inv)
            mh, ma = market_lambdas(inv[0] / sm_, inv[1] / sm_, inv[2] / sm_)
            w = (0.75 if lg["cup"] else 0.5) if b365 else (0.9 if lg["cup"] else 0.6)
            lh, la = w * mh + (1 - w) * lh, w * ma + (1 - w) * la
        p = predict(lh, la)
        mk, ss = {}, {"ms": ref_name}
        if ref:
            mk.update({k: ref[k] for k in ("1", "X", "2")})
        else:
            mk.update({"1": odd(p["p1"]), "X": odd(p["px"]), "2": odd(p["p2"])})

        def pick(keys, cands):
            """Bir pazar grubunun tum secenekleri ayni kaynaktan gelir."""
            for name, src_ in cands:
                if src_ and all(src_.get(k) for k in keys):
                    return name, {k: src_[k] for k in keys}
            return "model", None

        dc_p = {"1X": p["p1"] + p["px"], "12": p["p1"] + p["p2"], "X2": p["px"] + p["p2"]}
        ss["dc"], got = pick(("1X", "12", "X2"), (("bet365", b365), ("Nesine", nes)))
        mk.update(got or {k: odd(v) for k, v in dc_p.items()})
        alt25 = {"O2.5": alt["O"], "U2.5": alt["U"]} if alt and alt.get("line") == 2.5 and alt.get("O") and alt.get("U") else None
        for n, key in ((1, "o15"), (2, "o25"), (3, "o35")):
            ks = (f"O{n}.5", f"U{n}.5")
            cands = [("bet365", b365), ("Nesine", nes)] + ([(alt["name"], alt25)] if n == 2 and alt25 else [])
            ss[f"ou{n}5"], got = pick(ks, cands)
            mk.update(got or {ks[0]: odd(p[key]), ks[1]: odd(1 - p[key])})
        ou_src = ss["ou25"]
        ss["kg"], got = pick(("KGV", "KGY"), (("Nesine", nes),))
        mk.update(got or {"KGV": odd(p["btts"]), "KGY": odd(1 - p["btts"])})
        h2h = []
        for g in by_team[hid]:
            if {g["h"]["id"], g["a"]["id"]} == {hid, aid}:
                h2h.append({"d": g["d"], "lg": g["lg"], "h": g["h"]["id"], "a": g["a"]["id"],
                            "hs": g["hs"], "as": g["as"]})
        h2h = h2h[-6:][::-1]
        detail = m["dt"] <= NOW + timedelta(days=DETAIL_DAYS)
        rec = {"id": m["id"], "lg": lid, "d": m["d"], "h": hid, "a": aid, "v": m["v"],
               "src": ref_name, "ou": ou_src, "ss": ss,
               "o": mk, "p": p, "f": {"h": fh, "a": fa}, "h2h": h2h,
               "st": {"h": dict(st[hid]["home"]), "a": dict(st[aid]["away"])},
               "sq": {"h": squad(hid, lid) if detail else None, "a": squad(aid, lid) if detail else None},
               "pl": {"h": rosters.get((lid, hid), []), "a": rosters.get((lid, aid), [])}}
        if m.get("tr"):
            rec["tr"] = m["tr"]
        matches.append(rec)

    cutoff = NOW - timedelta(days=RESULT_DAYS)
    results = []
    for e in done:
        if e["dt"] >= cutoff:
            use(e["h"]["id"])
            use(e["a"]["id"])
            results.append({"id": e["id"], "lg": e["lg"], "d": e["d"], "h": e["h"]["id"], "a": e["a"]["id"],
                            "hs": e["hs"], "as": e["as"]})
    results.reverse()

    cs = defaultdict(int)
    for m in matches:
        cs[m["src"]] += 1
    print("   Mac sonucu orani kaynagi: " + ", ".join(f"{k} {v}" for k, v in sorted(cs.items(), key=lambda x: -x[1])), flush=True)
    print("5/6 Takim adlari (TR / RU / TM)...", flush=True)
    up_ids = {m["id"] for m in upcoming}
    recent = []
    for e in allev:
        if e["id"] in up_ids or e["status"] in FINAL or not (NOW - timedelta(hours=4) <= e["dt"] <= NOW + timedelta(hours=1)):
            continue
        if any(w in (e["status"] or "") for w in ("POSTPONED", "CANCEL", "ABANDON", "SUSPEND")):
            continue
        use(e["h"]["id"])
        use(e["a"]["id"])
        recent.append({"id": e["id"], "lg": e["lg"], "d": e["d"], "h": e["h"]["id"], "a": e["a"]["id"]})
        if e.get("tr"):
            recent[-1]["tr"] = e["tr"]
    molla_data = molla(matches, {e["id"]: e for e in done}, src_team, use)
    nat_ids = {e[s]["id"] for e in allev if LGMAP[e["lg"]]["nat"] for s in ("h", "a")}
    team_country = {e[s]["id"]: LG_COUNTRY[e["lg"]] for e in allev if e["lg"] in LG_COUNTRY for s in ("h", "a")}
    try:
        localize(teams, nat_ids, team_country)
    except Exception as ex:  # ceviri servisi kapaliysa bulten yine de uretilsin
        print("   isim cevirisi atlandi:", ex, flush=True)

    print("6/6 Basketbol (NBA)...", flush=True)
    try:
        bb = basketball()
    except Exception as ex:
        print("   basketbol atlandi:", ex, flush=True)
        bb = None

    # ---- tahmin arsivi: mac baslayana kadar son tahmin saklanir, sonra donar ----
    preds_path = os.path.join(ROOT, "data", "preds.json")
    preds = cache_read(preds_path) or {}
    for m in matches:
        pr_, k_, o_ = tip_of(m)
        preds[m["id"]] = {"d": m["d"], "lg": m["lg"], "sc": m["p"]["score"], "k": k_, "o": o_,
                          "p": [m["p"]["p1"], m["p"]["px"], m["p"]["p2"]]}
    for m in (bb or {}).get("matches", []):
        preds[m["id"]] = {"d": m["d"], "lg": "nba", "sc": m["p"]["score"], "k": m["tip"]["k"], "o": m["tip"]["o"],
                          "ln": m["line"], "p": [m["p"]["p1"], 0, m["p"]["p2"]]}
    pkeep = (NOW - timedelta(days=45)).strftime("%Y-%m-%d")
    preds = {k: v for k, v in preds.items() if v["d"][:10] >= pkeep}
    cache_write(preds_path, preds)

    # ---- oran arsivi: her pazar icin yayinlanan en yuksek oran (kupon dogrulamasi icin) ----
    odds_path = os.path.join(ROOT, "data", "odds.json")
    oarc = cache_read(odds_path) or {}
    for m in matches + (bb or {}).get("matches", []):
        rec = oarc.setdefault(m["id"], {"d": m["d"], "o": {}})
        rec["d"] = m["d"]
        for k, v in m["o"].items():
            if v and v > rec["o"].get(k, 0):
                rec["o"][k] = v
    oarc = {k: v for k, v in oarc.items() if v["d"][:10] >= pkeep}
    cache_write(odds_path, oarc)

    def attach(rows):
        for r in rows:
            pv = preds.get(r["id"])
            if pv:
                r["pr"] = {"sc": pv["sc"], "k": pv["k"], "o": pv["o"]}
                if "ln" in pv:
                    r["pr"]["ln"] = pv["ln"]

    attach(results)
    if bb:
        attach(bb["results"])

    # ---- sitenin son 30 gunluk isabeti (futbol) ----
    acc = {"n": 0, "tip": 0, "res": 0, "sc": 0, "lg": {}}
    since = NOW - timedelta(days=30)
    for e in done:
        pv = preds.get(e["id"])
        if not pv or e["dt"] < since:
            continue
        hs, as_ = e["hs"], e["as"]
        out = 0 if hs > as_ else 1 if hs == as_ else 2
        t_ok = wins(pv["k"], hs, as_)
        acc["n"] += 1
        acc["tip"] += int(t_ok)
        acc["res"] += int(max(range(3), key=lambda i: pv["p"][i]) == out)
        acc["sc"] += int(pv["sc"] == [hs, as_])
        row = acc["lg"].setdefault(e["lg"], [0, 0])
        row[0] += 1
        row[1] += int(t_ok)

    # ---- son 30 gunluk isabet (basketbol) ----
    accbb = {"n": 0, "tip": 0, "res": 0}
    for bid, e in ((bb or {}).pop("_done", None) or {}).items():
        pv = preds.get(bid)
        if not pv or e["dt"] < since:
            continue
        accbb["n"] += 1
        accbb["tip"] += int(bb_wins(pv["k"], e["hs"], e["as"], pv.get("ln", 0)))
        accbb["res"] += int((pv["p"][0] >= pv["p"][2]) == (e["hs"] > e["as"]))

    data = {"updated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "leagues": [{"id": l["id"], "n": l["n"], "g": l["g"], "cup": l["cup"], "nat": l["nat"], "tier": l["tier"], "tsdb": bool(l["tsdb"])}
                        for l in LEAGUES],
            "teams": teams, "tables": tables, "matches": matches, "results": results, "bb": bb, "molla": molla_data, "recent": recent, "acc": acc, "accbb": accbb}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.AHAL_DATA=")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")
    os.replace(tmp, OUT)
    print(f"Bitti: {len(matches)} mac, {len(results)} sonuc -> {OUT} "
          f"({os.path.getsize(OUT) // 1024} KB, {time.time() - t0:.0f} sn)", flush=True)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
