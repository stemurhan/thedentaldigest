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
APF_BASE = "https://v3.football.api-sports.io/"
APF_KEY = (os.getenv("API_FOOTBALL_KEY") or "").strip()
APF_LEAGUES = {"tur.1": 203, "eng.1": 39, "esp.1": 140, "ger.1": 78, "ita.1": 135, "fra.1": 61}


# ---- Ligler ----------------------------------------------------------------
def L(id, tr, ru, tk, g, cup=False, nat=False, tier=1, tsdb=None, table=True, b=None):
    return {"id": id, "n": {"tr": tr, "ru": ru, "tk": tk}, "g": g, "cup": cup, "nat": nat, "tier": tier,
            "tsdb": tsdb, "table": table, "b": b}


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
    L("bel.1", "Belçika Pro Lig", "Про-лига Бельгии", "Belgiýa Pro-ligasy", "ot", b="BEL"),
    L("sco.1", "İskoçya Premiership", "Премьершип Шотландии", "Şotlandiýa Premýerşipi", "ot", b="SCO"),
    # Diger Avrupa ve dunya ligleri (ESPN; oranlar cogunlukla Nesine'den). Takvim yili ile oynanan liglerde
    # (Brezilya, Arjantin, MLS, Japonya, Sili, Iskandinavya) sezon Temmuz'da kesildigi icin puan tablosu gosterilmez.
    L("eng.5", "İngiltere Ulusal Lig (5. Lig)", "Национальная лига Англии (5-я лига)", "Angliýa Milli ligasy (5-nji liga)", "en", tier=2),
    L("sco.2", "İskoçya Championship", "Чемпионшип Шотландии", "Şotlandiýa Çempionşipi", "ot", tier=2, b="SCO"),
    L("gre.1", "Yunanistan Süper Lig", "Суперлига Греции", "Gresiýa Superligasy", "ot", b="GRE"),
    L("aut.1", "Avusturya Bundesliga", "Бундеслига Австрии", "Awstriýa Bundesligasy", "ot", b="AUT"),
    L("sui.1", "İsviçre Süper Lig", "Суперлига Швейцарии", "Şweýsariýa Superligasy", "ot", b="SUI"),
    L("den.1", "Danimarka Süper Lig", "Суперлига Дании", "Daniýa Superligasy", "ot", b="DEN"),
    L("swe.1", "İsveç Allsvenskan", "Аллсвенскан (Швеция)", "Şwesiýa Allswenskan", "ot", table=False, b="SWE"),
    L("nor.1", "Norveç Eliteserien", "Элитсерия (Норвегия)", "Norwegiýa Eliteserien", "ot", table=False, b="NOR"),
    L("ksa.1", "Suudi Arabistan Pro Lig", "Про-лига Саудовской Аравии", "Saud Arabystanynyň Pro-ligasy", "wd", b="KSA"),
    L("bra.1", "Brezilya Serie A", "Серия A Бразилии", "Braziliýa A Seriýasy", "wd", table=False, b="BRA"),
    L("bra.2", "Brezilya Serie B", "Серия B Бразилии", "Braziliýa B Seriýasy", "wd", tier=2, table=False, b="BRA"),
    L("arg.1", "Arjantin Ligi", "Чемпионат Аргентины", "Argentina ligasy", "wd", table=False, b="ARG"),
    L("usa.1", "ABD MLS", "MLS (США)", "ABŞ MLS", "wd", table=False, b="USA"),
    L("mex.1", "Meksika Liga MX", "Лига MX (Мексика)", "Meksika Liga MX", "wd", b="MEX"),
    L("jpn.1", "Japonya J1 Ligi", "Джей-лига 1 (Япония)", "Ýaponiýa J1 ligasy", "wd", table=False, b="JPN"),
    L("chi.1", "Şili Primera", "Примера Чили", "Çili Primera ligasy", "wd", table=False, b="CHI"),
    L("aus.1", "Avustralya A-League", "A-League (Австралия)", "Awstraliýa A-League", "wd", b="AUS"),
    # ESPN'de olmayan Dogu Avrupa ligleri: TheSportsDB (gol / kart ayrintisi ve ilk yari skoru yok)
    L("pol.1", "Polonya Ekstraklasa", "Экстракласа (Польша)", "Polşa Ekstraklasa", "ot", tsdb=4422, b="POL"),
    L("cze.1", "Çekya 1. Lig", "Первая лига Чехии", "Çehiýa 1-nji ligasy", "ot", tsdb=4631, b="CZE"),
    L("cro.1", "Hırvatistan 1. HNL", "Первая лига Хорватии", "Horwatiýa 1-nji ligasy", "ot", tsdb=4629, b="CRO"),
    L("srb.1", "Sırbistan Süper Lig", "Суперлига Сербии", "Serbiýa Superligasy", "ot", tsdb=4671, b="SRB"),
    L("rou.1", "Romanya Liga 1", "Лига 1 (Румыния)", "Rumyniýa Liga 1", "ot", tsdb=4691, b="ROU"),
    L("ukr.1", "Ukrayna Premier Lig", "Премьер-лига Украины", "Ukraina Premýer-ligasy", "ot", tsdb=4354, b="UKR"),
]
LGMAP = {l["id"]: l for l in LEAGUES}

HISTORY_START = "2025-08-01"   # aralarindaki maclar icin gecmis
DAYS_AHEAD = 7                 # bultende kac gun ilerisi (daha uzak maclarda bahis siteleri henuz oran acmiyor)
DETAIL_DAYS = 8                # kadro + oyuncu istatistigi kac gun ilerisi icin
RESULT_DAYS = 14               # sonuclar sayfasi / kupon sonuclandirma
STATS_FROM = "2026-11-20"   # isabet istatistikleri ve analizci karnesi 20.11.2026 (Askabat gece yarisi) itibariyla sayilir (yeni liglerle sifirlandi)
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
def halves(details, hid, aid, hs, as_):
    """Gol dakikalarindan devre skorlari: ([ilk yari], [ikinci yari]). Uzatma golleri (90+ disi 91-120) yarilara
    sayilmaz. Sayim mac skoruyla tutmazsa (eksik veri) None doner; kendi kalesine gol takimi iki yonde de denenir."""
    goals = []
    for d in details:
        if not d.get("scoringPlay") or d.get("shootout"):
            continue
        tid = str((d.get("team") or {}).get("id") or "")
        disp = str((d.get("clock") or {}).get("displayValue") or "")
        num = "".join(ch for ch in disp.split("'")[0] if ch.isdigit())
        if not num or tid not in (hid, aid):
            return None
        goals.append((int(num), tid == hid, bool(d.get("ownGoal"))))
    for flip in (False, True):
        cnt = {"h1": [0, 0], "h2": [0, 0], "all": [0, 0]}
        for mn, home, og in goals:
            side = 0 if home != (og and flip) else 1
            cnt["all"][side] += 1
            if mn <= 45:
                cnt["h1"][side] += 1
            elif mn <= 90:
                cnt["h2"][side] += 1
        if cnt["all"] == [hs, as_]:
            return cnt["h1"], cnt["h2"]
        if not any(g[2] for g in goals):
            break
    return None


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

        ev = {"id": str(e["id"]), "lg": lg, "d": e["date"], "state": st.get("state"),
              "status": st.get("name"), "slug": (e.get("season") or {}).get("slug", ""),
              "h": tm(comp["home"]), "a": tm(comp["away"]), "hs": sc(comp["home"]), "as": sc(comp["away"]),
              "v": fx((c.get("venue") or {}).get("fullName") or "")}
        if lg != "nba" and st.get("state") == "post":
            hv = halves(c.get("details") or [], ev["h"]["id"], ev["a"]["id"], ev["hs"], ev["as"])
            if hv:
                ev["h1"], ev["h2"] = hv
        return ev
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


def apf_get(path, ttl=3 * 3600):
    """API-Football getter (3 saatlik agresif onbellek)."""
    if not APF_KEY:
        return None
    key = re.sub(r"[^a-z0-9_.-]+", "_", path.lower())
    cpath = os.path.join(CACHE, "apf", key + ".json")
    c = cache_read(cpath)
    if c and time.time() - c.get("ts", 0) < ttl:
        return c.get("d")
    try:
        req = urllib.request.Request(
            APF_BASE + path.lstrip("/"),
            headers={"User-Agent": "Mozilla/5.0", "x-apisports-key": APF_KEY, "Accept-Encoding": "gzip"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            d = json.loads(raw.decode("utf-8"))
            cache_write(cpath, {"ts": time.time(), "d": d})
            return d
    except Exception:
        return (c or {}).get("d")


def load_apf_preds(upcoming):
    """Onumuzdeki 3 gunde, sadece 1. lig maclari icin API-Football tahminlerini yukler."""
    out = {}
    if not APF_KEY:
        return out

    def pct(v):
        try:
            if v is None:
                return None
            if isinstance(v, str):
                v = v.strip().replace("%", "")
            x = float(v)
            if x > 1:
                x /= 100.0
            return min(max(x, 0.0), 1.0)
        except Exception:
            return None

    horizon = NOW + timedelta(days=3)
    targets = defaultdict(set)  # (YYYY-MM-DD, apf_league) -> {(home_norm, away_norm)}
    for m in upcoming:
        try:
            if m["lg"] not in APF_LEAGUES or not (NOW - timedelta(hours=1) <= m["dt"] <= horizon):
                continue
            day = m["dt"].strftime("%Y-%m-%d")
            targets[(day, APF_LEAGUES[m["lg"]])].add((norm(m["h"]["n"]), norm(m["a"]["n"])))
        except Exception:
            continue

    pred_calls, pred_cap = 0, 72
    for (day, league_id), pairs in sorted(targets.items()):
        try:
            fx = apf_get(f"fixtures?date={day}&league={league_id}") or {}
            for item in fx.get("response") or []:
                try:
                    teams = item.get("teams") or {}
                    hn = (teams.get("home") or {}).get("name") or ""
                    an = (teams.get("away") or {}).get("name") or ""
                    nk = (norm(hn), norm(an))
                    rk = (nk[1], nk[0])
                    if nk not in pairs and rk not in pairs:
                        continue
                    if pred_calls >= pred_cap:
                        return out
                    fid = ((item.get("fixture") or {}).get("id"))
                    if not fid:
                        continue
                    pred_calls += 1
                    pd = apf_get(f"predictions?fixture={fid}") or {}
                    pr = ((pd.get("response") or [{}])[0].get("predictions") or {})
                    per = pr.get("percent") or {}

                    w = pct(per.get("home"))
                    d = pct(per.get("draw"))
                    l = pct(per.get("away"))
                    if None in (w, d, l):
                        continue
                    sm = w + d + l
                    if sm <= 0:
                        continue
                    w, d, l = w / sm, d / sm, l / sm

                    o25 = pct(per.get("over_2.5")) or pct(per.get("over25")) or 0.5
                    u25 = pct(per.get("under_2.5")) or pct(per.get("under25"))
                    if u25 is None:
                        u25 = max(0.0, min(1.0, 1 - o25))
                    by = pct(per.get("btts_yes")) or pct(per.get("btts")) or 0.5
                    bn = pct(per.get("btts_no"))
                    if bn is None:
                        bn = max(0.0, min(1.0, 1 - by))

                    out[nk] = {
                        "w": w,
                        "d": d,
                        "l": l,
                        "u25": u25,
                        "o25": o25,
                        "btts_yes": by,
                        "btts_no": bn,
                    }
                except Exception:
                    continue
        except Exception:
            continue
    return out


def tsdb_events(lg):
    """Bir ligin sezon fiksturunu tur tur okur; bitmis turlar onbellekten gelir."""
    lid, season = lg["tsdb"], f"{SEASON_START.year}-{SEASON_START.year + 1}"
    out, fails, empties = [], 0, 0
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
            empties += 1
            if empties >= 2:                  # iki bos tur ust uste: sezon fiksturu bitti
                break
            continue
        empties = 0
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
    for i in range(2):
        for j in range(2):
            mat[i][j] *= _dc_tau(i, j, lh, la)
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
              "fra.1": "Q142", "fra.2": "Q142", "ned.1": "Q55", "ned.2": "Q55", "por.1": "Q45", "por.2": "Q45", "bel.1": "Q31",
              "eng.5": "Q145", "sco.2": "Q145", "gre.1": "Q41", "aut.1": "Q40", "sui.1": "Q39", "den.1": "Q35",
              "swe.1": "Q34", "nor.1": "Q20", "ksa.1": "Q851", "bra.1": "Q155", "bra.2": "Q155", "arg.1": "Q414",
              "usa.1": "Q30", "mex.1": "Q96", "jpn.1": "Q17", "chi.1": "Q298", "aus.1": "Q408",
              "pol.1": "Q36", "cze.1": "Q213", "cro.1": "Q224", "srb.1": "Q403", "rou.1": "Q218", "ukr.1": "Q212"}
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
    s = s.strip("«»\"“”„'").strip()               # Wikidata'daki tirnakli etiketler («Ла-Лувьер»)
    for _ in range(2):
        s = STRIP_RE.sub("", s).strip()
    if s[:1].islower():                             # "brommapojkarna" -> "Brommapojkarna"
        s = s[:1].upper() + s[1:]
    return s if len(s) <= 34 else ""


# Wikidata etiketi alt takima / akademiye aitse (or. Chelsea -> "Резервисты и Академия ФК «Челси»") kullanilmaz
RESERVE_LAB_RE = re.compile(r"(Резерв|Академ|Молод|дубл|\bU-?\d{2}\b|Reserv|Akademi|Altyap|Gençlik|Kadın|\s(B|II)$)", re.I)
# Turkcede karsiligi olmayan takim adlarinda sehir adlari Turkce yazilir (Spartak Moskova ile Rodina Moscow yan yana durmasin)
TR_CITY = (("Moscow", "Moskova"), ("Warsaw", "Varşova"), ("Belgrade", "Belgrad"), ("Bucharest", "Bükreş"),
           ("Prague", "Prag"), ("Athens", "Atina"), ("Kyiv", "Kiev"), ("Lisbon", "Lizbon"), ("Vienna", "Viyana"),
           ("Copenhagen", "Kopenhag"), ("Munich", "Münih"), ("Cologne", "Köln"), ("Seville", "Sevilla"))


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
                elif mst == 88 and all(ok(oc.get(i)) for i in (1, 2, 3)):
                    o["iy"] = [oc[1], oc[2], oc[3]]              # ilk yari sonucu: 1 / X / 2
                elif mst == 90 and all(ok(oc.get(i)) for i in range(1, 10)):
                    o["hf"] = [oc[i] for i in range(1, 10)]      # IY/MS: 1/1 1/X 1/2 X/1 X/X X/2 2/1 2/X 2/2
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
    # Wikidata'da baska bir kulupla (ya da alt takimla) eslesen veya okunmasi zor etiketi olanlar
    "Paris FC": {"tr": "Paris FC", "ru": "Пари Франс", "tk": "Pari FK"},
    "Lyon": {"tr": "Lyon", "ru": "Лион", "tk": "Lion"},
    "Dynamo Makhachkala": {"tr": "Dinamo Mahaçkale", "ru": "Динамо Махачкала", "tk": "Dinamo Mahaçkala"},
    "IF Brommapojkarna": {"tr": "Brommapojkarna", "ru": "Броммапойкарна", "tk": "Brommapoýkarna"},
    "Al Taawoun": {"tr": "Al Taawoun", "ru": "Аль-Таавун", "tk": "Al-Taawun"},
    "Neom SC": {"tr": "Neom", "ru": "Неом", "tk": "Neom"},
    "Ural Yekaterinburg": {"tr": "Ural Yekaterinburg", "ru": "Урал", "tk": "Ural Ýekaterinburg"},
    "Iberia 1999": {"tr": "Iberia 1999", "ru": "Иберия 1999", "tk": "Iberiýa 1999"},
    "Grêmio": {"tr": "Grêmio", "ru": "Гремио", "tk": "Gremio"},
    "Pisa": {"tr": "Pisa", "ru": "Пиза", "tk": "Piza"},
    "Chelsea": {"tr": "Chelsea", "ru": "Челси", "tk": "Çelsi"},
    "Albacete": {"tr": "Albacete", "ru": "Альбасете", "tk": "Albasete"},
    "IMT Novi Beograd": {"tr": "IMT Novi Beograd", "ru": "ИМТ Нови Београд", "tk": "IMT Nowi Beograd"},
    "Red Star Belgrade": {"tr": "Kızılyıldız", "ru": "Црвена звезда", "tk": "Crwena Zwezda"},
    "LAFC": {"tr": "Los Angeles FC", "ru": "Лос-Анджелес", "tk": "Los-Anjeles FK"},
    "Rodina Moscow": {"tr": "Rodina Moskova", "ru": "Родина", "tk": "Rodina Moskwa"},
    "Veles Moscow": {"tr": "Veles Moskova", "ru": "Велес", "tk": "Weles Moskwa"},
    "Legia Warsaw": {"tr": "Legia Varşova", "ru": "Легия", "tk": "Legiýa Warşawa"},
    "AS Monaco": {"tr": "Monaco", "ru": "Монако", "tk": "Monako"},
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
                if lab and RESERVE_LAB_RE.search(lab) and not RESERVE_RE.search(t["n"]):
                    lab = ""                # alt takim / akademi etiketi ana takima yazilmaz
                if lab:
                    t[lg] = lab
        if not t.get("tr") and tid not in nat_ids:
            tr_ = t["n"]
            for a_, b_ in TR_CITY:
                tr_ = re.sub(r"\b" + a_ + r"\b", b_, tr_)
            if tr_ != t["n"]:
                t["tr"] = tr_
    print(f"   {hit}/{len(teams)} takim adi eslesti", flush=True)


# ---- MollaMyrat'in kuponu (gunluk kupon + haftalik takip) ------------------
MOLLA = os.path.join(ROOT, "data", "molla.json")
MOLLA_DAYS = 2                 # kupon kac gunu kapsar / kac gunde bir yenilenir
TIP_KEYS = ["1", "X", "2", "1X", "X2", "O2.5", "U2.5", "KGV", "KGY"]
MOLLA_HI = 20.0                # surpriz kuponun en dusuk toplam orani
MOLLA_BIG = 35.0               # yuksek oran kuponunun en dusuk toplam orani
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


# ---- Tutarli karar zinciri ----------------------------------------------------
# Bir mac icin gosterilen her sey (sonuc olasiliklari, tahmini skor, ilk yari skoru, Analiz365 tahmini,
# kupon secimleri) AYNI olasilik dagilimindan ve su sirayla turetilir:
#   1) en olasi sonuc (1 / X / 2)     2) o sonuc icindeki en olasi skor
#   3) bu skora ulasilabilen en olasi ilk yari skoru     4) bu skorla celismeyen secimler
OUTC = ("1", "X", "2")


def _oc(i, j):
    return 0 if i > j else 1 if i == j else 2


def full_matrix(lh, la, n=8):
    ph, pa = pois(lh), pois(la)
    mat = [[ph[i] * pa[j] * (_dc_tau(i, j, lh, la) if i < 2 and j < 2 else 1) for j in range(n + 1)] for i in range(n + 1)]
    t_ = sum(map(sum, mat))
    return [[v / t_ for v in r] for r in mat]


# Yayinlanmis kupon secimleri taahhuttur: kupon surdukce o macin tahmini skoru bu secimlerle celismez.
# PINS[mac] = skorun saglamasi gereken kosullar; PIN_HT[mac] = IY/MS kuponundaki ilk yari sonucu;
# PINS_AG[(mac, analizci)] = analizcinin kendi kuponundaki secimler.
PINS, PIN_HT, PINS_AG = defaultdict(list), {}, defaultdict(list)


def pin_fns(items):
    out = []
    for kind, v in items:
        if kind == "k":
            out.append(lambda i, j, v=v: wins(v, i, j))
        elif kind == "s":
            out.append(lambda i, j, v=v: [i, j] == list(v))
        elif kind == "ft":
            out.append(lambda i, j, v=v: OUTC[_oc(i, j)] == v)
    return out


def load_pins():
    """Guncel donemin ortak kuponlari, skor ve IY/MS kuponu, yedek kupon ve analizci kuponlarindaki secimler."""
    PINS.clear()
    PIN_HT.clear()
    PINS_AG.clear()
    st_ = cache_read(MOLLA) or {}
    cks = sorted(st_.get("coupons") or {})
    later = NOW - timedelta(minutes=5)
    alive = lambda x: pdate(x["d"]) > later
    if cks:
        c = st_["coupons"][cks[-1]]
        for x in list(c.get("picks") or []) + (c.get("hi") or {}).get("picks", []) + (c.get("sys") or {}).get("picks", []) + \
                (c.get("big") or {}).get("picks", []):
            if alive(x):
                PINS[x["id"]].append(("k", x["k"]))
        for x in (c.get("sk") or {}).get("picks", []):
            if alive(x) and x.get("sc"):
                PINS[x["id"]].append(("s", x["sc"]))
        for x in (c.get("hf") or {}).get("picks", []) + (c.get("hfs") or {}).get("picks", []):
            if alive(x) and x["k"].startswith("HF"):
                PINS[x["id"]].append(("ft", x["k"][4]))
                PIN_HT[x["id"]] = x["k"][2]
        for a_, own in (c.get("ac") or {}).items():
            for x in own.get("main", []) + own.get("hi", []) + (own.get("sys") or {}).get("picks", []) + own.get("big", []):
                if alive(x):
                    PINS_AG[(x["id"], a_)].append(x["k"])
    for x in (st_.get("next") or {}).get("picks", []):
        if alive(x):
            PINS[x["id"]].append(("k", x["k"]))
    print(f"   Taahhut: {len(PINS)} macta kupon secimi, {len(PINS_AG)} analizci secimi", flush=True)


def consistent_score(mat, lim=6, pr=None, fns=()):
    """En olasi sonuc icindeki en olasi skor. Doner: ([ev, dep], skor olasiligi, [p1, px, p2]).
    pr verilirse sonuc o olasiliklara gore secilir (heyetin ortak olasiliklari).
    fns: skorun saglamasi gereken kosullar (yayinlanmis kupon secimleri). Once 'en olasi sonuc + kosullar',
    olmazsa 'kosullar', o da olmazsa yalnizca en olasi sonuc."""
    n = min(len(mat), lim)
    if pr is None:
        pr = [0.0, 0.0, 0.0]
        for i in range(len(mat)):
            for j in range(len(mat)):
                pr[_oc(i, j)] += mat[i][j]
    o = max(range(3), key=lambda x: pr[x])
    allc = [(i, j) for i in range(n) for j in range(n)]
    ok = lambda t_: all(f(*t_) for f in fns)
    for cand in ([t_ for t_ in allc if _oc(*t_) == o and ok(t_)], [t_ for t_ in allc if ok(t_)],
                 [t_ for t_ in allc if _oc(*t_) == o]):
        if cand:
            i, j = max(cand, key=lambda t_: mat[t_[0]][t_[1]])
            return [i, j], mat[i][j], pr


def consistent_ht(lh, la, sc, f=0.45, ht_out=None):
    """Mac sonu skoruna (sc) ulasilabilen en olasi ilk yari skoru: P(IY i-j) * P(ikinci yari sc-i, sc-j).
    ht_out: IY/MS kuponunda yayinlanmis ilk yari sonucu (varsa ona uyan skorlar arasindan)."""
    h1, a1 = pois(lh * f), pois(la * f)
    h2, a2 = pois(lh * (1 - f)), pois(la * (1 - f))
    cand = [(i, j) for i in range(sc[0] + 1) for j in range(sc[1] + 1)]
    if ht_out:
        cand = [t_ for t_ in cand if OUTC[_oc(*t_)] == ht_out] or cand
    return list(max(cand, key=lambda t_: h1[t_[0]] * a1[t_[1]] * h2[sc[0] - t_[0]] * a2[sc[1] - t_[1]]))


def committee_p(lam_, pv, n=8, mid=None):
    """Analiz365 = analizci heyeti: her analizcinin skor matrisi AG_W agirligiyla ortalanir. Bu tek dagilimdan
    sonuc olasiliklari, alt/ust, karsilikli gol, tahmini skor ve ilk yari skoru turetilir."""
    W = {a: AG_W.get(a, 1.0) for a in lam_}
    tw = sum(W.values())
    mats = {a: full_matrix(*l_, n=n) for a, l_ in lam_.items()}
    M = [[sum(W[a] * mats[a][i][j] for a in mats) / tw for j in range(n + 1)] for i in range(n + 1)]
    lh = sum(W[a] * l_[0] for a, l_ in lam_.items()) / tw
    la = sum(W[a] * l_[1] for a, l_ in lam_.items()) / tw
    # olasiliklar analizcilerin kendi olasiliklarinin agirlikli ortalamasi (piyasa ajani gercek oranlari kullanir);
    # skor, bu olasiliklara gore en olasi sonucun icinde heyet matrisinin en olasi skoru
    c = lambda k: wmean(pv, k)
    pr = [c("1"), c("X"), c("2")]
    sc, sp, _ = consistent_score(M, pr=pr, fns=pin_fns(PINS.get(mid, [])))
    r4 = lambda v: round(v, 4)
    top = sorted(((M[i][j], i, j) for i in range(6) for j in range(6)), reverse=True)[:6]
    return {"lh": round(lh, 2), "la": round(la, 2), "p1": r4(pr[0]), "px": r4(pr[1]), "p2": r4(1 - pr[0] - pr[1]),
            "o15": r4(c("O1.5")), "o25": r4(c("O2.5")), "o35": r4(c("O3.5")), "btts": r4(c("KGV")),
            "score": sc, "sp": r4(sp), "ht": consistent_ht(lh, la, sc, ht_out=PIN_HT.get(mid)),
            "top": [[i, j, r4(v)] for v, i, j in top]}


def agent_score(lam_a, mid=None, a=None):
    fns = pin_fns([("k", k) for k in PINS_AG.get((mid, a), [])]) if mid else ()
    return consistent_score(full_matrix(*lam_a), fns=fns)[0]


def analiz_tip(m):
    """Analiz365 tahmini: tahmini skorla celismeyen secenekler icinde nihai olasiligi en yuksek olan (oran 1.30+).
    Onay: kendi olasiligi %50'yi gecen analizciler + (orani degerli bulursa) Rifki."""
    p, o, sc = m["p"], m["o"], m["p"]["score"]
    pr = _pvec(p)
    cands = [k for k in AG_KEYS if o.get(k) and o[k] >= 1.3 and wins(k, *sc)] or \
            [k for k in AG_KEYS if o.get(k) and wins(k, *sc)]
    if not cands:
        return None
    k = max(cands, key=lambda x: pr[x])
    pv = agent_probs(m)
    v = sum(1 for a in VOTE_AGENTS if a in pv and pv[a][k] >= 0.5)
    if len(pv) >= 3 and m.get("src") != "model" and m["lg"] != "fifa.friendly" and wmean(pv, k) * o[k] - 1 >= -0.05:
        v += 1
    return {"k": k, "p": round(pr[k], 4), "o": o[k], "v": v}


def tip_of(m):
    if m.get("cons"):                               # tahmin arsivi de Analiz365 tahminini kaydeder
        return m["cons"]["p"], m["cons"]["k"], m["cons"]["o"]
    p = m["p"]
    pr = {"1": p["p1"], "X": p["px"], "2": p["p2"], "1X": p["p1"] + p["px"], "X2": p["px"] + p["p2"],
          "O2.5": p["o25"], "U2.5": 1 - p["o25"], "KGV": p["btts"], "KGY": 1 - p["btts"]}
    c = [(pr[k], k, m["o"][k]) for k in TIP_KEYS if m["o"].get(k)]
    fit = [x for x in c if wins(x[1], *p["score"])]
    c = fit or c
    good = [x for x in c if x[2] >= 1.3]
    c = good or c
    return max(c)


# ---- Analiz ajanlari (MollaMyrat kuponlarini bes bagimsiz ajan birlikte kurar) ----
# Her ajan ayni maca kendi verisiyle bakar ve her secenek icin kendi olasiligini uretir:
#   st  Istatistik : sitenin Poisson/xG modeli (sezon gucu + piyasa harmani)
#   mk  Piyasa     : bahis sitelerinin oranlarindan paydan arindirilmis olasilik (site orani yoksa cekimser)
#   fm  Form       : yalnizca son 6 macin attigi/yedigi gol ortalamasi
#   sh  Saha       : ev sahibinin ic saha, konugun deplasman sezon karnesi
#   vr  Deger/Risk : diger ajanlarin ortak olasiligini oranla karsilastirir (beklenen getiri) + risk suzgeci
# Dixon-Coles duzeltmesi (dusuk skor kombinasyonlari icin)
DC_RHO = -0.05
def _dc_tau(i, j, lh, la, rho=DC_RHO):
    if i == 0 and j == 0:
        return 1 - lh * la * rho
    if i == 1 and j == 0:
        return 1 + la * rho
    if i == 0 and j == 1:
        return 1 + lh * rho
    if i == 1 and j == 1:
        return 1 - rho
    return 1.0


# Lig bazli ev sahibi / deplasman gol ortalamalari (Bayesian prior)
LG_GOALS = {
    "tur.1": (1.55, 1.08), "tur.2": (1.50, 1.05),
    "eng.1": (1.42, 1.18), "eng.2": (1.45, 1.20),
    "esp.1": (1.50, 1.20), "ger.1": (1.60, 1.30),
    "ita.1": (1.42, 1.08), "fra.1": (1.48, 1.12),
    "rus.1": (1.50, 1.05), "ned.1": (1.58, 1.25),
    "por.1": (1.45, 1.10), "bel.1": (1.52, 1.18),
}
_LG_DEFAULT = (1.45, 1.15)


# Bes analizci. Ilk dordu kendi gol beklentisini (xG) ve her secenek icin kendi olasiligini uretir:
#   fn  Fenasi     : lig gol ortalamasi + ev sahibi avantaji, rakip gucune gore duzeltilmis ic saha / deplasman
#                    hucum-savunma katsayilari (az macta lig ortalamasina cekilir), eksik oyuncu, dinlenme suresi
#   st  Istatistik : sitenin Poisson/xG modeli (sezon gucu + piyasa harmani)
#   mk  Piyasa     : bahis sitelerinin oranlarindan paydan arindirilmis olasilik (site orani yoksa cekimser)
#   fm  Form       : yalnizca son 6 mac (yeni maclar daha agir)
#   vr  Deger/Risk : diger dordunun ortak olasiligini oranla karsilastirir (beklenen getiri) + risk suzgeci
AGENTS = ["fn", "st", "mk", "fm", "vr"]
VOTE_AGENTS = AGENTS[:4]
apf_preds = {}
AG_KEYS = ["1", "X", "2", "1X", "12", "X2", "O1.5", "U1.5", "O2.5", "U2.5", "O3.5", "U3.5", "KGV", "KGY"]
# kupon turleri: oran araligi, olasilik ajanlarinin onay esigi, deger ajaninin en dusuk beklenen getirisi
DC_KEYS = ("1X", "12", "X2")
AG_TYPES = {
    # banko: cifte sans yok (surekli cifte sans gercekci degil); MS 1/0/2, karsilikli gol ve alt/ust karisik
    "main": {"lo": 1.15, "hi": 1.62, "need": lambda o: 0.62, "ev": -0.08, "keys": [k for k in AG_KEYS if k not in DC_KEYS]},
    "hi": {"lo": 1.80, "hi": 4.50, "need": lambda o: max(0.30, 0.90 / o), "ev": -0.02},
    "sys": {"lo": 1.45, "hi": 2.40, "need": lambda o: 0.50, "ev": -0.05},
    "big": {"lo": 1.60, "hi": 4.00, "need": lambda o: max(0.30, 0.85 / o), "ev": -0.03},
}


def mk_family(k):
    """Pazar ailesi: banko kuponda ayni aileden en fazla yarisi olabilir (karisik kupon)."""
    return "ms" if k in ("1", "X", "2") else "dc" if k in DC_KEYS else "kg" if k[:2] == "KG" else "ou"


def mix_pick(rows, n, key_of):
    """rows (en guclu basta) icinden en fazla n tane; her pazar ailesinden en fazla ceil(n/2).
    Yeterli cesitlilik yoksa kalan yerler siradaki en guclu secimlerle doldurulur."""
    cap, out, cnt, rest = (n + 1) // 2, [], defaultdict(int), []
    for r in rows:
        if len(out) >= n:
            break
        f = mk_family(key_of(r))
        if cnt[f] < cap:
            out.append(r)
            cnt[f] += 1
        else:
            rest.append(r)
    return out + rest[:max(0, n - len(out))]


def _pvec(p):
    return {"1": p["p1"], "X": p["px"], "2": p["p2"], "1X": p["p1"] + p["px"], "12": p["p1"] + p["p2"],
            "X2": p["px"] + p["p2"], "O1.5": p["o15"], "U1.5": 1 - p["o15"], "O2.5": p["o25"], "U2.5": 1 - p["o25"],
            "O3.5": p["o35"], "U3.5": 1 - p["o35"], "KGV": p["btts"], "KGY": 1 - p["btts"]}


def _clampl(v, lo=0.2, hi=3.6):
    return min(max(v, lo), hi)


FN_K, FN_HALF = 4.0, 150.0     # Fenasi: lig ortalamasina cekme gucu (mac), mac agirliginin yari omru (gun)


def fenasi_strengths(season, avg_h, avg_a):
    """Fenasi 1-2. adim: lig ortalamasina gore ic saha / deplasman hucum ve savunma katsayilari.
    Katsayilar rakiplerin gucune gore duzeltilir ve az macta 1.0'a (lig ortalamasina) cekilir."""
    K = FN_K
    raw = defaultdict(lambda: {"hgf": 0.0, "hga": 0.0, "hp": 0.0, "agf": 0.0, "aga": 0.0, "ap": 0.0, "hn": 0, "an": 0})
    ref = max((g["dt"] for g in season), default=NOW)
    wt = {}
    for g in season:                                 # yeni maclar daha agir: 150 gunde agirlik yariya iner
        w = wt[g["id"]] = 0.5 ** ((ref - g["dt"]).total_seconds() / 86400 / FN_HALF)
        h, a = raw[g["h"]["id"]], raw[g["a"]["id"]]
        h["hgf"] += w * g["hs"]
        h["hga"] += w * g["as"]
        h["hp"] += w
        h["hn"] += 1
        a["agf"] += w * g["as"]
        a["aga"] += w * g["hs"]
        a["ap"] += w
        a["an"] += 1
    shr = lambda v, n, avg: (v + K * avg) / (n + K) / avg
    base = {t: {"ha": shr(r["hgf"], r["hp"], avg_h), "hd": shr(r["hga"], r["hp"], avg_a),
                "aa": shr(r["agf"], r["ap"], avg_a), "ad": shr(r["aga"], r["ap"], avg_h)} for t, r in raw.items()}
    exp = defaultdict(lambda: {"ha": 0.0, "hd": 0.0, "aa": 0.0, "ad": 0.0})
    for g in season:                                 # ortalama bir takim ayni rakiplere karsi ne atar / yerdi
        H, A = g["h"]["id"], g["a"]["id"]
        w = wt[g["id"]]
        exp[H]["ha"] += w * avg_h * base[A]["ad"]
        exp[H]["hd"] += w * avg_a * base[A]["aa"]
        exp[A]["aa"] += w * avg_a * base[H]["hd"]
        exp[A]["ad"] += w * avg_h * base[H]["ha"]
    out = {}
    for t, r in raw.items():
        e = exp[t]
        out[t] = {"ha": (r["hgf"] + K * avg_h) / (e["ha"] + K * avg_h), "hd": (r["hga"] + K * avg_a) / (e["hd"] + K * avg_a),
                  "aa": (r["agf"] + K * avg_a) / (e["aa"] + K * avg_a), "ad": (r["aga"] + K * avg_h) / (e["ad"] + K * avg_h),
                  "n": [r["hn"], r["an"]]}
    return out


def fenasi_lambdas(S, avg_h, avg_a, hid, aid, by_team, lg, dt, sqh, sqa):
    """Fenasi 2-4. adim: iki takimin beklenen golu. Doner: (ev xG, deplasman xG, dinlenme gunleri, eksik sayilari)
    ya da veri yetersizse None."""
    K = 4.0
    h, a = S.get(hid), S.get(aid)

    def overall(tid):                                # lig karnesi yetersizse: tum kulvarlardaki son 10 mac
        g = by_team[tid][-10:]
        if len(g) < 3:
            return None
        gf = sum(x["hs"] if x["h"]["id"] == tid else x["as"] for x in g)
        ga = sum(x["as"] if x["h"]["id"] == tid else x["hs"] for x in g)
        avg = (avg_h + avg_a) / 2
        return (gf + K * avg) / (len(g) + K) / avg, (ga + K * avg) / (len(g) + K) / avg

    if h and a and h["n"][0] >= 3 and a["n"][1] >= 3:
        lh, la = avg_h * h["ha"] * a["ad"], avg_a * a["aa"] * h["hd"]
    else:
        if lg["nat"]:                                # milli takimlarda ortak lig yok: rakip gucu olculemez, cekimser
            return None
        oh, oa = overall(hid), overall(aid)
        if not oh or not oa:
            return None
        lh, la = avg_h * oh[0] * oa[1], avg_a * oa[0] * oh[1]
    if lg["id"] == "fifa.friendly":                  # hazirlik maci: ev sahibi avantaji zayif
        lh, la = lh * 0.95, la * 1.05
    rest = []
    for tid in (hid, aid):
        prev = [g["dt"] for g in by_team[tid] if g["dt"] < dt]
        rest.append(int((dt - prev[-1]).total_seconds() // 86400) if prev else None)
    if rest[0] is not None and rest[0] < 4:          # 4 gunden az dinlenme: kendi hucumu duser, rakibinki artar
        lh, la = lh * 0.97, la * 1.02
    if rest[1] is not None and rest[1] < 4:
        la, lh = la * 0.97, lh * 1.02
    out_n = [len((sqh or {}).get("out") or []), len((sqa or {}).get("out") or [])]
    lh *= max(0.85, 1 - 0.04 * out_n[0]) * min(1.08, 1 + 0.015 * out_n[1])   # eksik oyuncu: kendi golu azalir,
    la *= max(0.85, 1 - 0.04 * out_n[1]) * min(1.08, 1 + 0.015 * out_n[0])   # rakibin beklentisi biraz artar
    return _clampl(lh), _clampl(la), rest, out_n


def half_probs(lh, la, f=0.45):
    """Ilk yari sonucu ve IY/MS olasiliklari. Gollerin %45'i ilk yarida atilir varsayimi; yarilar bagimsiz.
    Doner: ([1, X, 2], [1/1, 1/X, 1/2, X/1, X/X, X/2, 2/1, 2/X, 2/2])."""
    G = 6
    h1, a1 = pois(lh * f)[:G + 1], pois(la * f)[:G + 1]
    h2, a2 = pois(lh * (1 - f))[:G + 1], pois(la * (1 - f))[:G + 1]
    d2 = defaultdict(float)
    for k in range(G + 1):
        for l in range(G + 1):
            d2[k - l] += h2[k] * a2[l]
    iy, hf = [0.0] * 3, [0.0] * 9
    for i in range(G + 1):
        for j in range(G + 1):
            pr = h1[i] * a1[j]
            a_ = 0 if i > j else 1 if i == j else 2
            iy[a_] += pr
            for dd, q in d2.items():
                fd = i - j + dd
                hf[a_ * 3 + (0 if fd > 0 else 1 if fd == 0 else 2)] += pr * q
    s1, s2 = sum(iy), sum(hf)
    return [x / s1 for x in iy], [x / s2 for x in hf]


# analizcilerin ortak olasiliktaki agirligi; geriye donuk testte olculen Brier puanindan hesaplanir
AG_W = {"fn": 1.0, "st": 1.0, "mk": 1.0, "fm": 1.0}


def wmean(pv, k):
    """Analizcilerin k secenegine verdigi olasiligin agirlikli ortalamasi."""
    tw = sum(AG_W.get(a, 1.0) for a in pv)
    return sum(AG_W.get(a, 1.0) * v[k] for a, v in pv.items()) / tw


def backtest_agents(done, days=45):
    """Geriye donuk test: son `days` gunun lig maclari, her biri yalnizca kendisinden ONCEKI maclarin verisiyle
    tahmin edilip gercek sonucla karsilastirilir. Piyasa ajani, sitenin yayinladigi oran arsivi (data/odds.json)
    olan maclarda test edilir; arsiv 45 gunluk oldugu icin orneklem zamanla buyur.
    Doner: {ajan: {"n", "hit" (mac sonucu isabeti), "ou" (2.5 alt/ust isabeti), "br" (Brier, dusuk iyi)}}."""
    res = {a: {"n": 0, "hit": 0, "ou": 0, "br": 0.0} for a in ("fn", "st", "fm", "mk")}
    arc = cache_read(os.path.join(ROOT, "data", "odds.json")) or {}
    start = NOW - timedelta(days=days)
    seen, th, mxc = defaultdict(list), defaultdict(list), {}
    for e in sorted((x for x in done if x["dt"] >= SEASON_START), key=lambda x: x["dt"]):
        lid, hid, aid = e["lg"], e["h"]["id"], e["a"]["id"]
        lg = LGMAP[lid]
        if e["dt"] >= start and not lg["nat"] and len(seen[lid]) >= 20:
            st_, avg_h, avg_a = team_stats(seen[lid])
            lam = {}
            fl = fenasi_lambdas(fenasi_strengths(seen[lid], avg_h, avg_a), avg_h, avg_a, hid, aid, th, lg, e["dt"], None, None)
            if fl:
                lam["fn"] = fl[:2]

            def fr(tid):
                g5 = th[tid][-5:]
                if not g5:
                    return 0.5
                pts = 0
                for g in g5:
                    gf, ga = (g["hs"], g["as"]) if g["h"]["id"] == tid else (g["as"], g["hs"])
                    pts += 3 if gf > ga else 1 if gf == ga else 0
                return pts / (3 * len(g5))

            fk = (lid, e["dt"].date())
            if fk not in mxc:
                mxc[fk] = maher_fit([g for g in seen[lid] if g["dt"] < e["dt"] - timedelta(hours=3)] or seen[lid], e["dt"])
            mxl = maher_lambdas(mxc[fk], hid, aid)
            if mxl:
                lam["st"] = mxl
            gh, ga_ = th[hid][-6:][::-1], th[aid][-6:][::-1]
            if len(gh) >= 3 and len(ga_) >= 3:
                def wavg(games, tid, scored):
                    ws = [0.80 ** i for i in range(len(games))]
                    vals = [(g["hs"] if (g["h"]["id"] == tid) == scored else g["as"]) for g in games]
                    return sum(w * v for w, v in zip(ws, vals)) / sum(ws)
                lam["fm"] = (_clampl(0.5 * (wavg(gh, hid, True) + wavg(ga_, aid, False)) * 1.10),
                             _clampl(0.5 * (wavg(ga_, aid, True) + wavg(gh, hid, False)) * 0.92))
            oa = (arc.get(e["id"]) or {}).get("o") or {}
            if all(oa.get(k_) for k_ in ("1", "X", "2")):
                iv = [1 / oa["1"], 1 / oa["X"], 1 / oa["2"]]
                lam["mk"] = market_lambdas(*[x / sum(iv) for x in iv])
            out = 0 if e["hs"] > e["as"] else 1 if e["hs"] == e["as"] else 2
            for a, (lh, la) in lam.items():
                pr = predict(lh, la)
                ps = [pr["p1"], pr["px"], pr["p2"]]
                r = res[a]
                r["n"] += 1
                r["hit"] += int(max(range(3), key=lambda i: ps[i]) == out)
                r["ou"] += int((pr["o25"] >= 0.5) == (e["hs"] + e["as"] > 2))
                r["br"] += sum((ps[i] - (1 if i == out else 0)) ** 2 for i in range(3))
        seen[lid].append(e)
        th[hid].append(e)
        th[aid].append(e)
    for r in res.values():
        r["br"] = round(r["br"] / r["n"], 4) if r["n"] else None
    return res


# Behcet (Istatistik): zaman agirlikli Maher / Dixon-Coles modeli. Ligdeki tum maclardan her takimin hucum (a)
# ve savunma (b) gucu, ev sahibi avantaji (g) ve lig gol seviyesi (mu) en cok olabilirlikle (Poisson) bulunur:
#   ev beklenen gol = mu * g * a_ev * b_dep      deplasman beklenen gol = mu * a_dep * b_ev
# Yeni maclar daha agir (120 gunde yari agirlik); her takima MX_K sanal ortalama mac eklenir (kucuk orneklem).
# Geriye donuk testte (1394 lig maci) mac sonucu isabeti %49.6 -> %51.9 (eski istatistik modeline gore).
MX_HALF, MX_K = 120.0, 6.0


def maher_fit(games, ref, half=MX_HALF, K=MX_K, iters=25):
    if len(games) < 10:
        return None
    w = [0.5 ** (max(0.0, (ref - g["dt"]).total_seconds()) / 86400 / half) for g in games]
    teams = {x for g in games for x in (g["h"]["id"], g["a"]["id"])}
    a = {t: 1.0 for t in teams}
    b = {t: 1.0 for t in teams}
    sw = sum(w)
    hg = sum(wi * g["hs"] for wi, g in zip(w, games)) / sw
    ag = sum(wi * g["as"] for wi, g in zip(w, games)) / sw
    gam, mu = max(hg, 0.3) / max(ag, 0.3), max(ag, 0.3)
    for _ in range(iters):
        na, da = {t: K for t in teams}, {t: K for t in teams}
        for wi, g in zip(w, games):
            h, A = g["h"]["id"], g["a"]["id"]
            na[h] += wi * g["hs"]
            da[h] += wi * mu * gam * b[A]
            na[A] += wi * g["as"]
            da[A] += wi * mu * b[h]
        a = {t: na[t] / da[t] for t in teams}
        nb, db = {t: K for t in teams}, {t: K for t in teams}
        for wi, g in zip(w, games):
            h, A = g["h"]["id"], g["a"]["id"]
            nb[A] += wi * g["hs"]
            db[A] += wi * mu * gam * a[h]
            nb[h] += wi * g["as"]
            db[h] += wi * mu * a[A]
        b = {t: nb[t] / db[t] for t in teams}
        ma, mb = sum(a.values()) / len(a), sum(b.values()) / len(b)
        a = {t: v / ma for t, v in a.items()}
        b = {t: v / mb for t, v in b.items()}
        eh = sum(wi * a[g["h"]["id"]] * b[g["a"]["id"]] for wi, g in zip(w, games))
        ea = sum(wi * a[g["a"]["id"]] * b[g["h"]["id"]] for wi, g in zip(w, games))
        mu = sum(wi * g["as"] for wi, g in zip(w, games)) / ea
        gam = (sum(wi * g["hs"] for wi, g in zip(w, games)) / eh) / mu
    return {"a": a, "b": b, "mu": mu, "g": gam}


def maher_lambdas(fit, hid, aid):
    if not fit or hid not in fit["a"] or aid not in fit["a"]:
        return None
    return (_clampl(fit["mu"] * fit["g"] * fit["a"][hid] * fit["b"][aid]),
            _clampl(fit["mu"] * fit["a"][aid] * fit["b"][hid]))


def form_lambdas(fh, fa, decay=0.80):
    """Coskun (Form): son 6 macin atilan / yenen gol ortalamasi (yeni maclar daha agir)."""
    if len(fh) < 3 or len(fa) < 3:
        return None

    def wavg(lst, key):
        ws = [decay ** i for i in range(len(lst))]
        return sum(w * x[key] for w, x in zip(ws, lst)) / sum(ws)

    return (_clampl(0.5 * (wavg(fh, "gf") + wavg(fa, "ga")) * 1.10),
            _clampl(0.5 * (wavg(fa, "gf") + wavg(fh, "ga")) * 0.92))


# Analiz365 tahmininin model kismi: Behcet x2 + eski istatistik modeli + Form (geriye donuk testte en iyi Brier)
BLEND_W = {"mx": 2.0, "old": 1.0, "fm": 1.0}


def blend_lambdas(parts):
    ks = [k for k in BLEND_W if parts.get(k)]
    tw = sum(BLEND_W[k] for k in ks)
    return (sum(BLEND_W[k] * parts[k][0] for k in ks) / tw, sum(BLEND_W[k] * parts[k][1] for k in ks) / tw)


def agent_probs(m, lam=None):
    """Doner: {ajan: {secenek: olasilik}}; verisi yetmeyen ajan sozlukte yer almaz (cekimser).
    lam verilirse her ajanin gol beklentisi (ev, deplasman) oraya yazilir."""
    out = {}
    stl = tuple(m["mx"]) if m.get("mx") else (m["p"]["lh"], m["p"]["la"])
    out["st"] = _pvec(predict(*stl))
    if lam is not None:
        lam["st"] = stl
    if m.get("fn"):
        out["fn"] = _pvec(predict(m["fn"][0], m["fn"][1]))
        if lam is not None:
            lam["fn"] = (m["fn"][0], m["fn"][1])
    o, ss = m["o"], m.get("ss") or {}
    # Piyasa: yalnizca gercek site orani varsa
    if m.get("src") and m["src"] != "model" and all(o.get(k) for k in ("1", "X", "2")):
        inv = [1 / o["1"], 1 / o["X"], 1 / o["2"]]
        s = sum(inv)
        q = [x / s for x in inv]
        mh, ma = market_lambdas(*q)
        if ss.get("ou25", "model") != "model" and o.get("O2.5") and o.get("U2.5"):
            inv_o, inv_u = 1 / o["O2.5"], 1 / o["U2.5"]
            target_o25 = inv_o / (inv_o + inv_u)
            t_lo, t_hi = 0.5, 7.0
            for _ in range(18):
                t_mid = (t_lo + t_hi) / 2
                p_mid = 1 - sum(math.exp(-t_mid) * t_mid ** k / math.factorial(k) for k in range(3))
                if p_mid < target_o25:
                    t_lo = t_mid
                else:
                    t_hi = t_mid
            target_total = (t_lo + t_hi) / 2
            cur_total = mh + ma
            if cur_total > 0.01:
                scale = 0.60 * (target_total / cur_total) + 0.40
                mh = _clampl(mh * scale)
                ma = _clampl(ma * scale)
        v = _pvec(predict(mh, ma))                     # 1X2 oranlarinin ima ettigi gol dagilimi
        if lam is not None:
            lam["mk"] = (mh, ma)
        v.update({"1": q[0], "X": q[1], "2": q[2], "1X": q[0] + q[1], "12": q[0] + q[2], "X2": q[1] + q[2]})
        for grp, a, b in (("ou15", "O1.5", "U1.5"), ("ou25", "O2.5", "U2.5"), ("ou35", "O3.5", "U3.5"), ("kg", "KGV", "KGY")):
            if ss.get(grp, "model") != "model" and o.get(a) and o.get(b):
                ia, ib = 1 / o[a], 1 / o[b]
                v[a], v[b] = ia / (ia + ib), ib / (ia + ib)
        out["mk"] = v
    # Form: son 6 mac
    fl_ = form_lambdas((m.get("f") or {}).get("h") or [], (m.get("f") or {}).get("a") or [])
    if fl_:
        out["fm"] = _pvec(predict(*fl_))
        if lam is not None:
            lam["fm"] = fl_
    return out


def agent_eval(m, k, typ, pv=None):
    """Bir secenegi ajanlara sorar. Doner: (onay sayisi, ortak olasilik, [[deger, onay] ya da None] xN)."""
    pv = pv or agent_probs(m)
    cfg, o = AG_TYPES[typ], m["o"][k]
    need, row, ps = cfg["need"](o), [], []
    for a in VOTE_AGENTS:
        if a in pv:
            p = pv[a][k]
            ps.append(p)
            row.append([round(p, 3), int(p >= need)])
        else:
            row.append(None)
    cons = wmean(pv, k)
    # Deger/Risk: gercek site orani yoksa ya da mac ongorulemezse onay vermez
    ev = cons * o - 1
    risky = m.get("src") == "model" or m["lg"] == "fifa.friendly" or len(ps) < 3
    row.append([round(ev, 3), int(ev >= cfg["ev"] and not risky)])
    return sum(x[1] for x in row if x), cons, row


def agent_best(m):
    """Her ajanin bu macta en cok guvendigi secim (oran 1.30+) ve gol beklentisi:
    {ajan: [secenek, olasilik, ev xG, deplasman xG]}; Deger ajani icin [secenek, beklenen getiri]."""
    lam = {}
    pv = agent_probs(m, lam)
    ks = [k for k in AG_KEYS if m["o"].get(k) and m["o"][k] >= 1.3]
    out = {}
    if not ks:
        return out
    for a in VOTE_AGENTS:
        if a in pv:
            sa = agent_score(lam[a], m["id"], a)     # analizci kendi tahmini skoruyla celisen secimi yapmaz
            ka = [x for x in ks if wins(x, *sa)] or                 [x for x in AG_KEYS if m["o"].get(x) and wins(x, *sa)] or ks   # oran esigi esner, tutarlilik esnemez
            k = max(ka, key=lambda x: pv[a][x])
            if pv[a][k] < 0.5:
                # kendi skoruyla celismeyen en iyi secim bile %50'nin altinda: karsi taraf daha olasi demektir.
                # Ajan bu macta "en guvendigi secim" gostermez (cekimser); gol beklentisi raporda kalir.
                out[a] = [None, round(pv[a][k], 3), round(lam[a][0], 2), round(lam[a][1], 2), sa]
                continue
            out[a] = [k, round(pv[a][k], 3), round(lam[a][0], 2), round(lam[a][1], 2), sa]
    if len(pv) >= 3 and m.get("src") != "model":
        cons = lambda k: wmean(pv, k)
        c = [k for k in ks if cons(k) >= 0.4 and wins(k, *m["p"]["score"])]
        if c:
            k = max(c, key=lambda x: cons(x) * m["o"][x])
            ev = cons(k) * m["o"][k] - 1
            if ev >= 0:                              # beklenen getirisi negatifse Rifki pas gecer
                out["vr"] = [k, round(ev, 3)]
    return out


def own_coupons(pool, base, types=("main", "hi", "sys", "big"), avoid=None):
    """Her analizcinin yalnizca kendi olasiliklariyla kurdugu banko / surpriz / sistem / yuksek oran kuponu.
    avoid: {analizci: kullanilmis mac kimlikleri} (sonradan eklenen kupon ayni maclari tekrar kullanmaz)."""
    mean = lambda xs: sum(xs) / len(xs)
    pvs, scs = {}, {}
    for m in pool:
        lam = {}
        pvs[m["id"]] = agent_probs(m, lam)
        scs[m["id"]] = {a: agent_score(l_, m["id"], a) for a, l_ in lam.items()}
        scs[m["id"]]["vr"] = m["p"]["score"]
    res = {}
    for a in AGENTS:
        used, res[a] = set((avoid or {}).get(a, ())), {}
        for typ in types:
            cfg, c = AG_TYPES[typ], []
            for m in pool:
                pv = pvs[m["id"]]
                if m["id"] in used:
                    continue
                if a == "vr":
                    if m.get("src") == "model" or m["lg"] == "fifa.friendly" or len(pv) < 3:
                        continue
                elif a not in pv:
                    continue
                best = None
                for k in cfg.get("keys", AG_KEYS):
                    o = m["o"].get(k)
                    if not o or not cfg["lo"] <= o <= cfg["hi"] or not wins(k, *scs[m["id"]][a]):
                        continue
                    if a == "vr":
                        pr = wmean(pv, k)
                        rank = pr * o - 1
                        ok = rank >= cfg["ev"] and pr >= {"main": 0.60, "sys": 0.46, "hi": 0.28, "big": 0.26}[typ]
                    else:
                        pr = pv[a][k]
                        rank = pr * o if typ in ("hi", "big") else pr
                        ok = pr >= cfg["need"](o)
                    if ok and (best is None or rank > best[0]):
                        best = (rank, pr, k, o)
                if best:
                    c.append(best + (m,))
            c.sort(key=lambda x: -x[0])
            if typ == "main":
                sel = mix_pick(c, 5, lambda x: x[2])
            elif typ == "sys":
                sel = c[:MOLLA_SYS[1]] if len(c) >= MOLLA_SYS[0] + 1 else []
            else:
                target, cap = (MOLLA_BIG, 9) if typ == "big" else (MOLLA_HI, 7)
                sel, tot = [], 1.0
                for x in c[:cap]:
                    sel.append(x)
                    tot *= x[3]
                    if tot >= target:
                        break
                if tot < target:
                    sel = []
            used |= {x[4]["id"] for x in sel}
            recs = [dict(base(m), k=k, o=o, p=round(pr, 3), sc=m["p"]["score"])
                    for _, pr, k, o, m in sorted(sel, key=lambda x: x[4]["d"])]
            res[a][typ] = {"k": MOLLA_SYS[0], "picks": recs} if typ == "sys" else recs
    return res


# ---- Devre ve skor kuponlari: ajanlarin ortak karariyla (ilk yari sonucu, ikinci yari sonucu, mac skoru) ----
XK_TYPES = ("hf", "sk", "hfs")        # ilk yari / mac sonucu (IY/MS), mac skoru ve IY/MS sistem kuponu
XK_ALL = ("iy", "y2", "hf", "sk", "hfs")  # sonuclandirma: eski (ayri ilk yari / ikinci yari) kuponlar da
XK_N = {"hf": 3, "sk": 2, "hfs": 8}     # her kupondaki mac sayisi (skor kuponu 2 mac: 3'lu skor kuponu neredeyse hic tutmaz)
XK_ALT = {"hf": 1, "hfs": 3}            # IY/MS kuponlarinda en az bu kadar "1/1 - 2/2 disi" secim (X/1, X/X, X/2 ...)
# Skor kuponu: gecmis tahmin arsivinde (646 mac) olculen isabet. Model "once en olasi sonuc" kurali yuzunden
# denk maclarda 1-1'i hic secmiyor, favori maclarda 1-0'a takiliyordu:
#   denk mac (favori < %45)  -> 1-1 %12.4 (model skoru %7.4)
#   favori >= %55            -> 2-0 / 0-2 %17-20 (1-0 %6.6)
SK_RATE = {"fav": 0.18, "draw": 0.124, "chain": 0.11}
HFS_K = 5                               # IY/MS sistem kuponu: 8 macin en az 5'i (5'li kolonlar, 56 kolon)
XK_NEED = 0.30                          # IY/MS secenegi icin bir ajanin onay esigi
XK_HF_MIN = 0.12                        # IY/MS kuponuna girecek secenegin en dusuk ortak olasiligi
HF_KEYS = ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"]
HALF_F = 0.45                           # gollerin ilk yariya dusen payi (half_probs ile ayni)


def wins_x(k, e):
    """Devre / skor seceneklerini de bilen sonuc kontrolu. Devre skoru bilinmiyorsa None."""
    if k[:1] == "S" and "-" in k:
        a, b = k[1:].split("-")
        return [e["hs"], e["as"]] == [int(a), int(b)]
    if k[:2] == "HF":                       # IY/MS: ilk yari sonucu / mac sonucu
        if not e.get("h1"):
            return None
        a, b = k[2:].split("/")
        return wins(a, *e["h1"]) and wins(b, e["hs"], e["as"])
    if k[:2] in ("IY", "2Y"):
        hv = e.get("h1") if k[:2] == "IY" else e.get("h2")
        return wins(k[2:], *hv) if hv else None
    return wins(k, e["hs"], e["as"])


def _res3(lh, la):
    """Bagimsiz Poisson ile 1 / X / 2 olasiliklari."""
    ph, pa = pois(lh)[:9], pois(la)[:9]
    w = sum(ph[i] * pa[j] for i in range(9) for j in range(9) if i > j)
    d = sum(ph[i] * pa[i] for i in range(9))
    s_ = sum(ph) * sum(pa)
    return [w / s_, d / s_, (s_ - w - d) / s_]


def _score_mat(lh, la):
    ph, pa = pois(lh), pois(la)
    mat = [[ph[i] * pa[j] * (_dc_tau(i, j, lh, la) if i < 2 and j < 2 else 1) for j in range(6)] for i in range(6)]
    tot = sum(map(sum, mat))
    return [[v / tot for v in r] for r in mat]


def sk_choice(cm, chain, p1, p2):
    """Skor kuponu icin skor: arsivde daha isabetli cikan kurala gore (SK_RATE). Doner: (skor, kural)."""
    fav = max(p1, p2)
    if fav < 0.45:
        return (1, 1), "draw"
    if p1 >= 0.55:
        return (2, 0), "fav"
    if p2 >= 0.55:
        return (0, 2), "fav"
    return tuple(chain), "chain"


def extra_coupons(pool, base, taken=None):
    """IY/MS ve mac skoru kuponlari. Her ajan kendi gol beklentisinden IY/MS ve skor olasiligi uretir;
    piyasa ajani IY/MS icin Nesine orani varsa onu kullanir. Ortak olasilik agirlikli ortalamadir;
    secim, en cok ajanin onayladigi (sonra ortak olasiligi en yuksek) maclardan kurulur.
    taken: {mac: [diger kuponlardaki secimler]} - skor kuponu bu secimlerle celisen skoru secmez."""
    taken = taken or {}
    cand = {x: [] for x in XK_TYPES}
    for m in pool:
        lg = LGMAP.get(m["lg"]) or {}
        if m["lg"] == "fifa.friendly":                   # hazirlik maclari ongorulemez
            continue
        no_ht = bool(lg.get("tsdb"))                     # TheSportsDB ilk yari skoru vermez: IY/MS'e giremez, skor kuponuna girer
        lam = {}
        agent_probs(m, lam)
        ags = [a for a in VOTE_AGENTS if a in lam]
        if len(ags) < 3:
            continue
        xo = m.get("xo") or {}
        W = {a: AG_W.get(a, 1.0) for a in ags}
        tw = sum(W.values())
        risky = m.get("src") == "model"
        bonus = 0.02 if not risky else 0.0
        # IY/MS: her ajanin gol beklentisinden 9 sonucun olasiligi; piyasa ajani Nesine IY/MS orani varsa onu kullanir
        hf_real = (xo.get("s") or ["model", "model"])[-1] != "model" and xo.get("hf")
        pa = {}
        for a in ags:
            pa[a] = half_probs(lam[a][0], lam[a][1], HALF_F)[1]
            if a == "mk" and hf_real:
                inv = [1 / x for x in xo["hf"]]
                pa[a] = [x / sum(inv) for x in inv]
        best = None
        sc0, ht0 = m["p"]["score"], m["p"].get("ht") or [0, 0]
        if no_ht:
            HF_SKIP = True
        else:
            HF_SKIP = False
        hf_ok = OUTC[_oc(*ht0)] + "/" + OUTC[_oc(*sc0)]   # tahmini ilk yari ve mac sonu skoruyla ayni IY/MS
        for i, r in enumerate(HF_KEYS):
            if HF_SKIP or r != hf_ok:
                continue
            cons = sum(W[a] * pa[a][i] for a in ags) / tw
            o = (xo.get("hf") or [None] * 9)[i] or odd(cons)
            if o < 1.3 or cons < XK_HF_MIN:                 # dokuz secenekli pazar: tek sonuc nadiren %30'u gecer
                continue
            row = [[round(pa[a][i], 3), int(pa[a][i] >= XK_NEED)] if a in pa else None for a in VOTE_AGENTS]
            ev = cons * o - 1
            row.append([round(ev, 3), int(ev >= -0.08 and not risky)])
            v = sum(x[1] for x in row if x)
            key = (v, cons + bonus)
            if best is None or key > best[0]:
                best = (key, "HF" + r, o, cons, v, row)
        if best:
            cand["hf"].append((best[0], dict(base(m), k=best[1], o=round(best[2], 2), p=round(best[3], 3),
                                            sc=m["p"]["score"], v=best[4], ag=best[5],
                                            os="Nesine" if hf_real else "model")))
        # mac skoru: arsivde daha isabetli cikan kurala gore secilen skor (sk_choice); onay = o skoru en olasi
        # (ya da ilk ikide) goren ajanlar. Diger kuponlardaki secimlerle (PINS / taken) celisen skor secilmez.
        mats = {a: _score_mat(*lam[a]) for a in ags}
        cm = [[sum(W[a] * mats[a][i][j] for a in ags) / tw for j in range(6)] for i in range(6)]
        p1_ = sum(cm[i][j] for i in range(6) for j in range(6) if i > j)
        p2_ = sum(cm[i][j] for i in range(6) for j in range(6) if i < j)
        (ci, cj), rule = sk_choice(cm, m["p"]["score"], p1_, p2_)
        keys_ = list(taken.get(m["id"], [])) + [k_ for t_, k_ in PINS.get(m["id"], []) if t_ == "k"]
        if any(not wins_x(k_, {"hs": ci, "as": cj}) for k_ in keys_ if k_[:2] not in ("HF", "IY", "2Y")):
            (ci, cj), rule = tuple(m["p"]["score"]), "chain"     # diger kuponla celisirse modelin skoru
        if ci > 5 or cj > 5:
            continue
        cons = cm[ci][cj]
        row = []
        for a in VOTE_AGENTS:
            if a not in mats:
                row.append(None)
                continue
            top2 = sorted(((mats[a][i][j], (i, j)) for i in range(6) for j in range(6)), reverse=True)[:2]
            row.append([round(mats[a][ci][cj], 3), int((ci, cj) in [x[1] for x in top2])])
        o = odd(cons)
        row.append([round(cons * o - 1, 3), int(not risky)])
        v = sum(x[1] for x in row if x)
        est = 0.5 * cons + 0.5 * SK_RATE[rule]          # beklenen isabet: model + arsiv olcumu
        cand["sk"].append(((est + bonus, v), dict(base(m), k=f"S{ci}-{cj}", o=o, p=round(cons, 3),
                                                   sc=[ci, cj], v=v, ag=row, os="model")))
    def hf_mix(rows, n, alt):
        """IY/MS: siradaki en guclu secimler, ama en az `alt` tanesi 1/1 - 2/2 disi (X/1, X/X, X/2, 1/X ...).
        Favori maclarda 1/1 hep en olasi cikar; cesitlilik icin ilk yarisi berabere bitmesi beklenen maclar da girer."""
        fav = lambda x: x[1]["k"] in ("HF1/1", "HF2/2")
        alts = [x for x in rows if not fav(x)][:alt]
        rest = [x for x in rows if x not in alts][:n - len(alts)]
        return alts + rest

    out = {}
    hf_rows = sorted(cand["hf"], key=lambda x: (-x[0][0], -x[0][1]))
    c = hf_mix(hf_rows, XK_N["hf"], XK_ALT["hf"])
    if len(c) >= 2:
        out["hf"] = {"picks": sorted((x[1] for x in c), key=lambda r: r["d"])}
    c = sorted(cand["sk"], key=lambda x: (-x[0][0], -x[0][1]))[:XK_N["sk"]]
    if len(c) >= 2:
        out["sk"] = {"picks": sorted((x[1] for x in c), key=lambda r: r["d"])}
    # IY/MS sistem kuponu: ajanlarin en cok onayladigi 8 IY/MS secimi (en az 3'u 1/1 - 2/2 disi); 5'li tum
    # kombinasyonlar ayri kolondur, en az 5 mac tutarsa kazandirir. Tam 8 uygun mac yoksa kurulmaz (5/8 sabit).
    c = hf_mix(hf_rows, XK_N["hfs"], XK_ALT["hfs"])
    if len(c) == XK_N["hfs"]:
        out["hfs"] = {"k": HFS_K, "picks": sorted((x[1] for x in c), key=lambda r: r["d"])}
    return out


def coupon_lost(v, t):
    """Kupon kaybetti mi? Liste ya da {"k", "picks"}; sistem kuponunda (sys / hfs) kural: kayip > N - k."""
    pk = v if isinstance(v, list) else (v or {}).get("picks", [])
    if not pk:
        return False
    no = sum(1 for x in pk if x.get("ok") is False)
    if t in ("sys", "hfs"):
        return no > len(pk) - ((v or {}).get("k") or MOLLA_SYS[0])
    return no > 0


def coupon_done(v, t):
    """Kupon sonuclandi mi (kaybetti ya da tum maclari bitti)?"""
    pk = v if isinstance(v, list) else (v or {}).get("picks", [])
    return bool(pk) and (coupon_lost(v, t) or all("ok" in x for x in pk))


def taken_of(c):
    """Bir donemin ana kuponlarindaki secimler: {mac: [secimler]} (skor kuponu bunlarla celismez)."""
    t = defaultdict(list)
    for x in list(c.get("picks") or []) + (c.get("hi") or {}).get("picks", []) +             (c.get("sys") or {}).get("picks", []) + (c.get("big") or {}).get("picks", []):
        t[x["id"]].append(x["k"])
    return t


def coupon_picks(c):
    """Bir donemin tum kuponlarindaki secimler (ortak + analizcilerin kendi kuponlari + devre / skor kuponlari)."""
    out = list(c["picks"]) + (c.get("hi") or {}).get("picks", []) + (c.get("sys") or {}).get("picks", []) + \
        (c.get("big") or {}).get("picks", [])
    for x in XK_ALL:
        out += (c.get(x) or {}).get("picks", [])
    for own in (c.get("ac") or {}).values():
        out += own.get("main", []) + own.get("hi", []) + (own.get("sys") or {}).get("picks", []) + own.get("big", [])
    return out


def agent_panel(pool, typ, avoid=()):
    """Havuzdaki her mac icin ajanlarin en cok onayladigi secenegi bulur.
    Doner: [(onay, ortak olasilik, secenek, oran, ajan satiri, mac)] - en guclu ortak karar basta."""
    cfg, out = AG_TYPES[typ], []
    for m in pool:
        if m["id"] in avoid:
            continue
        pv, best = agent_probs(m), None
        for k in cfg.get("keys", AG_KEYS):
            o = m["o"].get(k)
            if not o or not cfg["lo"] <= o <= cfg["hi"] or not wins(k, *m["p"]["score"]):
                continue
            v, cons, row = agent_eval(m, k, typ, pv)
            key = (v, cons * o if typ == "hi" else cons)
            if best is None or key > best[0]:
                best = (key, v, cons, k, o, row)
        if best:
            out.append(best[1:] + (m,))
    out.sort(key=lambda x: (-x[0], -x[1]))
    return out


def molla(matches, done_by_id, src_team, use):
    state = cache_read(MOLLA) or {"coupons": {}}
    today = (NOW + timedelta(hours=5)).strftime("%Y-%m-%d")   # Askabat gunu
    # 1) bitmis maclari sonuclandir (kaybedip arsive tasinan kuponlar dahil)
    state.setdefault("arch", {})
    for c in list(state["coupons"].values()) + [e for es in state["arch"].values() for e in es]:
        for pk in coupon_picks(c):
            e = done_by_id.get(pk["id"])
            if e and "res" not in pk:
                pk["res"] = [e["hs"], e["as"]]
                pk["ok"] = wins_x(pk["k"], e)
                if pk["k"][:2] in ("IY", "2Y", "HF") and e.get("h1"):
                    pk["hr"] = e["h2"] if pk["k"][:2] == "2Y" else e["h1"]
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
    # guncel kuponda tutmayan mac varsa iki gun beklenmeden yeni kupon yayinlanir
    # (sistem kuponu haric: 3/5 kurali tek kayibi normal sayar; bugunun kuponu zaten varsa bir daha uretilmez)
    # ayni gun icinde de: kaybeden kuponun yerine hemen yenisi gelir (anahtar: gun + harf, or. 2026-11-17b)
    busted = False          # kaybeden kuponlar artik donem icinde yerinde yenilenir (asagida 2-)
    due = not keys or busted or (day0 - datetime.strptime(keys[-1][:10], "%Y-%m-%d")).days >= MOLLA_DAYS
    if keys and ("ac" not in state["coupons"][keys[-1]] or state["coupons"][keys[-1]].get("cv") != 2):
        due = True                                   # tutarli karar zincirine gecis: guncel kupon bir kez yeniden kurulur

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

    def window(key=None):
        """Kuponda yeralacak maclar: onumuzdeki en fazla 48 saat icinde oynanacaklar."""
        return [m for m in matches if NOW + timedelta(minutes=15) < pdate(m["d"]) <= NOW + timedelta(hours=48)]

    def high_coupon(pool, avoid=()):
        """Toplam orani en az MOLLA_HI olan kupon: olasiligi en yuksek orta oranli secimler.
        Ana kuponda yeralan maclari (avoid) tekrar secmez: uc kupon farkli maclardan kurulur."""
        pool = [m for m in pool if m["id"] not in avoid]
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
            if m["id"] in avoid:              # ana/yuksek oran kuponundaki maclar sistem kuponuna giremez
                continue
            opts = [x for x in options(m, 1.5, 2.8) if x[0] >= 0.48]
            if opts:
                best = max(opts, key=lambda x: x[0])
                c.append((-(best[0] + penalty(m)), best, m))
        c.sort(key=lambda x: x[0])
        c = c[:n]
        if len(c) < need + 1:
            return None
        c.sort(key=lambda x: x[2]["d"])
        return {"k": need, "picks": [rec(t, m) for _, t, m in c]}

    def arec(x):
        v, cons, k, o, row, m = x
        return dict(base(m), k=k, o=o, p=round(cons, 3), sc=m["p"]["score"], v=v, ag=row)

    by_date = lambda xs: sorted(xs, key=lambda x: x[5]["d"])

    def banko(pool, avoid=()):
        """Banko: en az 4 ajanin (yoksa 3) onayladigi dusuk oranli secimler."""
        pan = agent_panel(pool, "main", avoid)
        kf = lambda x: x[2]
        got = mix_pick([x for x in pan if x[0] >= 4], 6, kf)
        if len(got) < 3:
            got = mix_pick([x for x in pan if x[0] >= 3], 6, kf)
        return got if len(got) >= 3 else mix_pick(pan, 3, kf)

    def big_coupon(pool, avoid=()):
        """Yuksek oran: analizcilerin en cok onayladigi orta-yuksek oranli secimler; toplam oran en az MOLLA_BIG."""
        pan_b = agent_panel(pool, "big", avoid)
        for minv in (3, 2, 0):
            got, tot = [], 1.0
            for x in [y for y in pan_b if y[0] >= minv][:9]:
                got.append(x)
                tot *= x[3]
                if tot >= MOLLA_BIG:
                    return got
        return None

    if due:
        until = (day0 + timedelta(days=MOLLA_DAYS - 1)).strftime("%Y-%m-%d")
        pool = window(today)
        picks = banko(pool)
        # kaybeden kuponun yerine: sitede hemen gosterilen yedek kupon gecerliyse (maclari baslamamis) aynen yayinlanir
        res_ = [r for r in (state.get("next") or {}).get("picks", []) if pdate(r["d"]) > NOW + timedelta(minutes=10)]
        reserve = busted and len(res_) >= 3 and len(res_) == len((state.get("next") or {}).get("picks", []))
        used = {r["id"] for r in res_} if reserve else {x[5]["id"] for x in picks}
        # Surpriz: ajanlarin "orani degerinin altinda" buldugu yuksek oranli secimler; toplam oran en az MOLLA_HI
        pan_hi, hi = agent_panel(pool, "hi", used), None
        for minv in (3, 2, 0):
            got, tot = [], 1.0
            for x in [y for y in pan_hi if y[0] >= minv][:7]:
                got.append(x)
                tot *= x[3]
                if tot >= MOLLA_HI:
                    break
            if tot >= MOLLA_HI:
                hi = got
                break
        used |= {x[5]["id"] for x in hi or []}
        # Sistem: orta oranli, en cok onay alan 5 mac (3'lu kolonlar)
        need, n = MOLLA_SYS
        pan_sys = agent_panel(pool, "sys", used)
        sy = [x for x in pan_sys if x[0] >= 3][:n]
        if len(sy) < n:
            sy = pan_sys[:n]
        used |= {x[5]["id"] for x in sy}
        big = big_coupon(pool, used)
        # Ajan raporlari: her ajanin havuzda tek basina en cok guvendigi maclar
        best = [(m, agent_best(m)) for m in pool]
        rep_ = {}
        for a_ in AGENTS:
            rows = sorted(((b[a_][1], b[a_][0], m) for m, b in best if a_ in b and b[a_][0]), key=lambda x: -x[0])[:4]
            rep_[a_] = [dict(base(m), k=k, o=m["o"][k], p=v) for v, k, m in rows]

        def sprob(m):
            if m["p"].get("sp"):
                return m["p"]["sp"]
            sc = m["p"]["score"]
            return next((x[2] for x in m["p"]["top"] if x[:2] == sc), m["p"]["top"][0][2])

        best_sc = sorted(pool, key=lambda m: -(sprob(m) + penalty(m) / 3))[:5]
        if len(picks) < 3 and not reserve:
            print(f"   MollaMyrat: 48 saatlik pencerede yeterli mac yok ({len(pool)} mac), yeni kupon bekletiliyor", flush=True)
            picks = []
        if picks:
            cpn = {"v": 2, "until": until,
                   "picks": res_ if reserve else [arec(x) for x in by_date(picks)],
                   "scores": [dict(base(m), sc=m["p"]["score"], sp=round(sprob(m), 3)) for m in
                              sorted(best_sc, key=lambda m: m["d"])],
                   "panel": {"n": len(pool), "rep": rep_}, "ac": own_coupons(pool, base)}
            if hi:
                cpn["hi"] = {"picks": [arec(x) for x in by_date(hi)]}
            if big:
                cpn["big"] = {"picks": [arec(x) for x in by_date(big)]}
            if len(sy) >= need + 1:
                cpn["sys"] = {"k": need, "picks": [arec(x) for x in by_date(sy)]}
            cpn.update(extra_coupons(pool, base, taken_of(cpn)))
            cpn["xk"] = 2
            cpn["cv"] = 2
            key = today
            n_ = 0
            while key in state["coupons"]:                # ayni gun ikinci kupon: 2026-11-17b, c ...
                n_ += 1
                key = today + chr(ord("a") + n_)
            state["coupons"][key] = cpn
            print(f"   MollaMyrat ajan heyeti: {len(pool)} mac tarandi -> banko {len(picks)}, "
                  f"surpriz {len(hi or [])}, sistem {len(sy) if len(sy) >= need + 1 else 0}", flush=True)
    # 2-) kaybeden kupon: yerine hemen yenisi. Kaybeden kupon arsive (state["arch"]) tasinir ve guncel donemden
    #     cikarilir; asagidaki doldurma adimlari (2a-2c) bos kalan turu ayni calismada yeniden kurar.
    keys = sorted(state["coupons"])
    if keys:
        ck = keys[-1]
        cur = state["coupons"][ck]
        lost_j = [t for t in ("picks", "hi", "sys", "big") + XK_TYPES
                  if coupon_lost(cur.get(t), t) and (t != "picks" or cur.get("ac"))]
        lost_a = [(a_, t) for a_, o_ in (cur.get("ac") or {}).items() for t in ("main", "hi", "sys", "big")
                  if coupon_lost(o_.get(t), t)]
        if lost_j or lost_a:
            ent = {"until": cur.get("until"), "picks": [], "ac": {}}
            for t in lost_j:
                if t == "picks":
                    ent["picks"], cur["picks"] = cur["picks"], []
                else:
                    ent[t] = cur.pop(t)
            for a_, t in lost_a:
                ent["ac"].setdefault(a_, {})[t] = cur["ac"][a_][t]
                cur["ac"][a_][t] = {"k": MOLLA_SYS[0], "picks": []} if t == "sys" else []
            state["arch"].setdefault(ck, []).append(ent)
            print(f"   MollaMyrat: kaybeden kupon yenileniyor: {lost_j} {lost_a}", flush=True)
        # analizcilerin bos kalan kendi kuponlari (kaybedip arsive giden ya da sonuclanip silinen): ayni tur yeniden,
        # analizcinin bekleyen kuponlarindaki maclar haric
        empty_ = lambda o_, t: not ((o_.get("sys") or {}).get("picks") if t == "sys" else o_.get(t))
        fill_a = [(a_, t) for a_, o_ in (cur.get("ac") or {}).items() for t in ("main", "hi", "sys", "big") if empty_(o_, t)]
        if fill_a:
            pool_ = window(ck)
            for t in sorted({t for _, t in fill_a}):
                av = {a_: {x["id"] for k_ in ("main", "hi", "big") for x in o_.get(k_, [])} |
                      {x["id"] for x in (o_.get("sys") or {}).get("picks", [])}
                      for a_, o_ in cur["ac"].items()}
                ob = own_coupons(pool_, base, (t,), av)
                for a_, t2 in fill_a:
                    if t2 == t and not empty_({t: (ob.get(a_) or {}).get(t)}, t):
                        cur["ac"][a_][t] = ob[a_][t]
        # banko bossa (kaybetti ya da sonuclanan kupon silindi): yedek kupon gecerliyse o, yoksa yeni banko
        if cur.get("ac") is not None and not cur.get("picks"):
            nx_ = (state.get("next") or {}).get("picks", [])
            res_ = [r for r in nx_ if pdate(r["d"]) > NOW + timedelta(minutes=10)]
            if len(res_) >= 3 and len(res_) == len(nx_):
                cur["picks"] = res_
            else:
                avoid_ = set(taken_of(cur))
                nb = banko(window(today), avoid_)
                if len(nb) >= 3:
                    cur["picks"] = [arec(x) for x in by_date(nb)]
            if cur.get("picks"):
                print(f"   MollaMyrat: yeni banko kupon yayinlandi ({len(cur['picks'])} mac)", flush=True)
    # 2a) yuksek oran kuponu (35+): donemde yoksa bir kez eklenir; ortak ve analizciler daha once kullandiklari
    #     maclari tekrar kullanmaz. Kurulan kupon sonradan degismez.
    keys = sorted(state["coupons"])
    if keys and "big" not in state["coupons"][keys[-1]] and "ac" in state["coupons"][keys[-1]]:
        cur = state["coupons"][keys[-1]]
        pool = window(keys[-1])
        used = {x["id"] for x in cur["picks"] + (cur.get("hi") or {}).get("picks", []) + (cur.get("sys") or {}).get("picks", [])}
        bg = big_coupon(pool, used)
        cur["big"] = {"picks": [arec(x) for x in by_date(bg)]} if bg else {"picks": []}
        av = {a_: {x["id"] for x in o_.get("main", []) + o_.get("hi", []) + (o_.get("sys") or {}).get("picks", [])}
              for a_, o_ in cur["ac"].items()}
        ob = own_coupons(pool, base, ("big",), av)
        for a_, o_ in cur["ac"].items():
            if not o_.get("big"):                    # bekleyen kendi kuponu korunur; yalnizca bos olan kurulur
                o_["big"] = (ob.get(a_) or {}).get("big", [])
        print(f"   MollaMyrat: yuksek oran kuponu eklendi (ortak {len(cur['big']['picks'])} mac, "
              f"analizciler {[len(o_['big']) for o_ in cur['ac'].values()]})", flush=True)
    # 2b) guncel kuponun yaninda yuksek oranli ve sistem kuponu (bir kez uretilir, sonra degismez)
    keys = sorted(state["coupons"])
    if keys:
        cur = state["coupons"][keys[-1]]
        if "hi" not in cur or "sys" not in cur:
            pool = window(keys[-1])
            if "hi" not in cur:
                hc = high_coupon(pool, {x["id"] for x in cur["picks"]})
                if hc:
                    cur["hi"] = hc
            if "sys" not in cur:
                avoid = {x["id"] for x in cur["picks"]} | {x["id"] for x in (cur.get("hi") or {}).get("picks", [])}
                sc_ = system_coupon(pool, avoid)
                if sc_:
                    cur["sys"] = sc_
    # 2c) devre ve skor kuponlari (guncel kuponda yoksa bir kez uretilir; baslamis maclar alinmaz)
    keys = sorted(state["coupons"])
    if keys and any(not (state["coupons"][keys[-1]].get(x) or {}).get("picks") for x in XK_TYPES)             and state["coupons"][keys[-1]].get("xk", 0) >= 2:
        cur = state["coupons"][keys[-1]]
        ex = extra_coupons(window(keys[-1]), base, taken_of(cur))
        for x in XK_TYPES:
            if not (cur.get(x) or {}).get("picks") and x in ex:
                cur[x] = ex[x]
                print(f"   MollaMyrat: bos kalan {x} kuponu dolduruldu ({len(ex[x]['picks'])} mac)", flush=True)
    if keys and state["coupons"][keys[-1]].get("xk", 0) < 2:
        cur = state["coupons"][keys[-1]]
        cur.pop("iy", None)                          # ayri ilk yari / ikinci yari kuponlari IY/MS kuponuyla degisti
        cur.pop("y2", None)
        ex = extra_coupons(window(keys[-1]), base)
        for x in XK_TYPES:
            if x not in cur and x in ex:             # mevcut skor kuponu korunur
                cur[x] = ex[x]
        cur["xk"] = 2
    # 2d) yedek banko kupon: guncel kupon kaybederse site bunu hemen gosterir, sonraki guncellemede resmi kupon olur
    keys = sorted(state["coupons"])
    if keys:
        cur = state["coupons"][keys[-1]]
        nx = banko(window(today), {x["id"] for x in cur["picks"]})
        state["next"] = {"picks": [arec(x) for x in by_date(nx)]} if len(nx) >= 3 else None
    # 3) eski kayitlari at, kaydet
    keep = (NOW - timedelta(days=400)).strftime("%Y-%m-%d")
    state["coupons"] = {k: v for k, v in state["coupons"].items() if k >= keep}
    state["arch"] = {k: v for k, v in state.get("arch", {}).items() if k in state["coupons"]}
    cache_write(MOLLA, state)
    show = keep
    # eski donemlerde analizcilerin kendi kuponlari ve raporlari yayinlanmaz (dosya sismesin); son 4 donem tam
    for i, k in enumerate(sorted(state["coupons"], reverse=True)):
        if i >= 12:
            state["coupons"][k].pop("ac", None)
            state["coupons"][k].pop("panel", None)
    cache_write(MOLLA, state)
    out = []
    for i, (k, v) in enumerate(sorted(state["coupons"].items(), reverse=True)):
        if k < show:
            continue
        v = dict(v, date=k)
        if i >= 4:
            v.pop("ac", None)
            v.pop("panel", None)
        out.append(v)
        for j, e in enumerate(state["arch"].get(k, [])):   # kaybedip yenilenen kuponlar donemin hemen ardindan
            e = dict(e, date=f"{k}~{j + 1}", arch=1)
            if i >= 4:
                e.pop("ac", None)
            out.append(e)
    for c in out:
        reps = [x for rows in ((c.get("panel") or {}).get("rep") or {}).values() for x in rows]
        for x in coupon_picks(c) + c.get("scores", []) + reps:
            use(x["h"])
            use(x["a"])
    nxt = state.get("next")
    for x in (nxt or {}).get("picks", []):
        use(x["h"])
        use(x["a"])
    return {"today": today, "coupons": out, "next": nxt}


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


# ---- Basketbol analiz ajanlari (NBA) ----------------------------------------
# Her ajan macin sayi farkini ve toplam sayisini kendi verisinden tahmin eder; fark ve toplam
# normal dagilimla (fark sd 12.5, toplam sd 18.5) mac sonucu / alt-ust olasiligina cevrilir.
#   pw  Guc Siralamasi  : sezonun tum maclarindan atilan / yenen sayi gucu
#   mk  Piyasa          : bahis sitesi oranlarindan paydan arindirilmis olasilik (site orani yoksa cekimser)
#   fm  Form            : yalnizca son 6 mac
#   rs  Saha ve Dinlenme: ic saha / deplasman karnesi + dinlenme gunu (art arda gun maci cezasi)
#   in  Kadro           : sakatlik raporu; eksik oyuncu takimin sayi / asist / ribaund lideriyse etkisi buyur
BB_AGENTS = ["pw", "mk", "fm", "rs", "in"]
BB_NEED = 0.55                 # bir ajanin secenegi onaylamasi icin verdigi en dusuk olasilik
BB_B2B, BB_RESTED = -2.2, 0.6  # art arda gun maci cezasi / 3+ gun dinlenme katkisi (sayi)


def bb_inj_penalty(inj, leaders):
    """Eksik oyuncularin takima maliyeti (sayi). Lider eksigi agir, digerleri hafif sayilir."""
    lead = {}
    for x in leaders or []:
        lead[x["n"]] = max(lead.get(x["n"], 0), 3.2 if x.get("k") == "pts" else 2.0)
    pen = 0.0
    for x in inj or []:
        st_ = (x.get("s") or "").lower()
        w = 1.0 if "out" in st_ else 0.4 if ("day" in st_ or "doubt" in st_ or "question" in st_) else 0.0
        pen += w * lead.get(x["n"], 0.5)
    return min(pen, 7.5)


def bb_agent_probs(est, line, mk):
    """est: {ajan: (fark, toplam)} -> {ajan: {secenek: olasilik}}; mk: piyasa olasiliklari (ya da None)."""
    out = {}
    for a, (mg, tot) in est.items():
        p1, po = phi(mg / 12.5), 1 - phi((line - tot) / 18.5)
        out[a] = {"1": p1, "2": 1 - p1, "BO": po, "BU": 1 - po}
    if mk:
        out["mk"] = mk
    return out


def bb_consensus(pv, o, line, score):
    """Ajanlarin en cok onayladigi secenek. Doner: (secenek, ortak olasilik, onay, ajan satiri)."""
    best = None
    for k in ("1", "2", "BO", "BU"):
        if not o.get(k):
            continue
        row, ps = [], []
        for a in BB_AGENTS:
            p = (pv.get(a) or {}).get(k)
            if p is None:
                row.append(None)
            else:
                ps.append(p)
                row.append([round(p, 3), int(p >= BB_NEED)])
        if not ps:
            continue
        v, cons = sum(x[1] for x in row if x), sum(ps) / len(ps)
        key = (bb_wins(k, score[0], score[1], line), o[k] >= 1.3, v, cons)
        if best is None or key > best[0]:
            best = (key, k, cons, v, row)
    return best[1:]


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
    # dinlenme: takimin bu mactan onceki son maci (oynanmis ya da programda) kac gun once
    sched = defaultdict(list)
    for e in allev:
        if not any(w in (e["status"] or "") for w in ("POSTPONED", "CANCEL")):
            sched[e["h"]["id"]].append(e["dt"])
            sched[e["a"]["id"]].append(e["dt"])

    def rest_days(tid, dt):
        prev = [x for x in sched[tid] if x < dt - timedelta(hours=2)]
        # NBA sayimi: art arda gunlerde mac = 0 gun dinlenme
        return None if not prev else max(0, round((dt - prev[-1]).total_seconds() / 86400) - 1)

    def fatigue(r):
        return 0.0 if r is None else BB_B2B if r == 0 else BB_RESTED if r >= 3 else 0.0

    matches = []
    for m in up:
        hid, aid = m["h"]["id"], m["a"]["id"]
        h, a = st[hid]["all"], st[aid]["all"]
        eh = avg + (rate(h["pf"], h["p"]) - avg) + (rate(a["pa"], a["p"]) - avg) + 1.6
        ea = avg + (rate(a["pf"], a["p"]) - avg) + (rate(h["pa"], h["p"]) - avg) - 1.6
        model = [round(eh, 1), round(ea, 1)]
        est = {"pw": (eh - ea, eh + ea)}              # ajan tahminleri: (sayi farki, toplam sayi)
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
        sm = summ.get(m["id"]) or {}
        side = lambda tid, k, dflt: (sm.get(tid) or {}).get(k) or dflt
        # --- ajan ekibi ---
        fh, fa = form_of(hid), form_of(aid)
        if len(fh) >= 3 and len(fa) >= 3:
            av = lambda f, k: sum(x[k] for x in f) / len(f)
            fe_h = (av(fh, "gf") + av(fa, "ga")) / 2 + 1.6
            fe_a = (av(fa, "gf") + av(fh, "ga")) / 2 - 1.6
            est["fm"] = (fe_h - fe_a, fe_h + fe_a)
        hs_, as__ = st[hid]["home"], st[aid]["away"]
        rest = [rest_days(hid, m["dt"]), rest_days(aid, m["dt"])]
        if hs_["p"] >= 3 and as__["p"] >= 3:
            re_h = (rate(hs_["pf"], hs_["p"]) + rate(as__["pa"], as__["p"])) / 2 + fatigue(rest[0])
            re_a = (rate(as__["pf"], as__["p"]) + rate(hs_["pa"], hs_["p"])) / 2 + fatigue(rest[1])
            est["rs"] = (re_h - re_a, re_h + re_a)
        pen = [bb_inj_penalty(side(hid, "inj", []), side(hid, "pl", [])),
               bb_inj_penalty(side(aid, "inj", []), side(aid, "pl", []))]
        if sm:                                        # sakatlik raporu gelmis maclarda
            pm, pt = est["pw"]
            est["in"] = (pm - pen[0] + pen[1], pt - 0.6 * (pen[0] + pen[1]))
        mkp = None
        if alt:                                       # yalnizca gercek site orani varsa
            mkp = {"1": q1, "2": 1 - q1}
            if alt.get("line") and alt.get("O") and alt.get("U"):
                io_, iu_ = 1 / alt["O"], 1 / alt["U"]
                mkp["BO"], mkp["BU"] = io_ / (io_ + iu_), iu_ / (io_ + iu_)
        pv = bb_agent_probs(est, line, mkp)
        # yayinlanan tahmin ajanlarin ortalamasidir: olasilik, sayi farki, toplam ve skor ayni kaynaktan gelir
        mean = lambda xs: sum(xs) / len(xs)
        p1 = mean([v["1"] for v in pv.values()])
        po = mean([v["BO"] for v in pv.values() if "BO" in v])
        cm = mean([v[0] for v in est.values()] + ([eh - ea] if alt else []))
        total = mean([v[1] for v in est.values()] + ([eh + ea] if alt else []))
        if (cm >= 0) != (p1 >= 0.5):                  # fark ile olasilik ayni tarafi gostersin
            cm = 0.5 if p1 >= 0.5 else -0.5
        sh, sa = round((total + cm) / 2), round((total - cm) / 2)
        if sh == sa or (sh > sa) != (p1 >= 0.5):
            sh, sa = (max(sh, sa) + (sh == sa), min(sh, sa)) if p1 >= 0.5 else (min(sh, sa), max(sh, sa) + (sh == sa))
        tk, tcons, tv, trow = bb_consensus(pv, o, line, (sh, sa))
        tp = (tcons, tk, o[tk])
        ok_ks = [k for k in ("1", "2", "BO", "BU") if o.get(k) and o[k] >= 1.3] or [k for k in ("1", "2", "BO", "BU") if o.get(k)]
        ag = {}
        for a_ in BB_AGENTS:
            ks_ = [k for k in ok_ks if k in (pv.get(a_) or {})]
            if ks_:
                bk = max(ks_, key=lambda k: pv[a_][k])
                ag[a_] = [bk, round(pv[a_][bk], 3)]
        n_out = lambda tid: sum(1 for x in side(tid, "inj", []) if "out" in (x.get("s") or "").lower())
        h2h = [{"d": g["d"], "lg": "nba", "h": "b" + g["h"]["id"], "a": "b" + g["a"]["id"], "hs": g["hs"], "as": g["as"]}
               for g in by_team[hid] if {g["h"]["id"], g["a"]["id"]} == {hid, aid}][-6:][::-1]
        matches.append({"id": "b" + m["id"], "sport": "bb", "lg": "nba", "d": m["d"], "h": "b" + hid,
                        "a": "b" + aid, "v": m["v"], "src": src, "o": o, "line": line,
                        "p": {"p1": round(p1, 4), "p2": round(1 - p1, 4), "score": [sh, sa], "total": round(total, 1),
                              "margin": round(cm, 1), "po": round(po, 4), "model": model},
                        "tip": {"k": tp[1], "p": round(tp[0], 4), "o": tp[2], "v": tv, "ag": trow},
                        "ag": ag, "agx": {"rest": rest, "out": [n_out(hid), n_out(aid)],
                                          "pen": [round(pen[0], 1), round(pen[1], 1)],
                                          # Analiz sekmesi: her ajanin (sayi farki, toplam) tahmini, lig ortalamasi, toplam cizgisinin kaynagi
                                          "est": {a_: [round(v[0], 1), round(v[1], 1)] for a_, v in est.items()},
                                          "avg": round(avg, 1), "lsrc": alt["name"] if alt and alt.get("line") else "model"},
                        "f": {"h": fh, "a": fa}, "h2h": h2h,
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

    tables, lstats, fstr, mxfit = {}, {}, {}, {}
    load_pins()
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
        fstr[lid] = fenasi_strengths(season, lstats[lid][1], lstats[lid][2])
        mxfit[lid] = maher_fit(season, NOW)

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

    global apf_preds
    apf_preds = load_apf_preds(upcoming)
    if apf_preds:
        print(f"   API-Football: {len(apf_preds)} mac tahmini", flush=True)

    print("4/6 Tahminler ve analiz...", flush=True)
    if os.getenv("ANALIZ_TUNE"):                     # gelistirme: Fenasi ayarlarini geriye donuk testle karsilastir
        global FN_K, FN_HALF
        for FN_K, FN_HALF in ((4, 150), (4, 9999), (8, 150), (8, 9999), (12, 9999), (6, 300), (10, 300), (16, 9999)):
            r = backtest_agents(done)["fn"]
            print(f"   TUNE K={FN_K} yari omur={FN_HALF}: {r['hit']}/{r['n']} = {r['hit'] / r['n']:.3f}, ust/alt {r['ou'] / r['n']:.3f}, Brier {r['br']}", flush=True)
        sys.exit(0)
    agbt = {}
    try:
        agbt = backtest_agents(done)
        brs = [r["br"] for r in agbt.values() if r["n"] >= 100 and r["br"]]
        if brs:
            for a_, r in agbt.items():
                if r["n"] >= 100 and r["br"]:
                    AG_W[a_] = round(math.exp(-10 * (r["br"] - min(brs))), 3)
            if not (agbt.get("mk", {}).get("n", 0) >= 100 and agbt["mk"]["br"]):
                AG_W["mk"] = round(max(AG_W[a_] for a_ in ("fn", "st", "fm")) * 1.15, 3)   # yeterli arsiv yoksa: en iyi modelden biraz agir
        print("   Geriye donuk test (45 gun): " + ", ".join(
            f"{a_} {r['hit']}/{r['n']} Brier {r['br']} agirlik {AG_W[a_]}" for a_, r in agbt.items()), flush=True)
    except Exception as ex:
        print("   geriye donuk test atlandi:", ex, flush=True)

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
        old_l = model_lambdas(st, avg_h, avg_a, hid, aid, form_ratio(fh), form_ratio(fa))
        mx_l = maher_lambdas(mxfit.get(lid), hid, aid)
        lh, la = blend_lambdas({"mx": mx_l, "old": old_l, "fm": form_lambdas(fh, fa)})
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
        sc_, sp_, _ = consistent_score(full_matrix(lh, la))
        p["score"], p["sp"] = sc_, round(sp_, 4)
        p["ht"] = consistent_ht(lh, la, sc_)
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
        # cifte sans iki sonucu birden kapsar: orani her iki tek sonuc oranindan da dusuk olmalidir
        for k_, (a_, b_) in (("1X", ("1", "X")), ("12", ("1", "2")), ("X2", ("X", "2"))):
            if mk.get(k_) and mk.get(a_) and mk.get(b_) and mk[k_] > min(mk[a_], mk[b_]) - 0.005:
                mk[k_] = round(max(1.01, 1 / (1 / mk[a_] + 1 / mk[b_])), 2)
        h2h = []
        for g in by_team[hid]:
            if {g["h"]["id"], g["a"]["id"]} == {hid, aid}:
                h2h.append({"d": g["d"], "lg": g["lg"], "h": g["h"]["id"], "a": g["a"]["id"],
                            "hs": g["hs"], "as": g["as"]})
        h2h = h2h[-6:][::-1]
        detail = m["dt"] <= NOW + timedelta(days=DETAIL_DAYS)
        sqh, sqa = (squad(hid, lid), squad(aid, lid)) if detail else (None, None)
        fnl = fenasi_lambdas(fstr[lid], avg_h, avg_a, hid, aid, by_team, lg, m["dt"], sqh, sqa)
        rec = {"id": m["id"], "lg": lid, "d": m["d"], "h": hid, "a": aid, "v": m["v"],
               "src": ref_name, "ou": ou_src, "ss": ss,
               "o": mk, "p": p, "f": {"h": fh, "a": fa}, "h2h": h2h,
               "st": {"h": dict(st[hid]["home"]), "a": dict(st[aid]["away"])},
               "sq": {"h": sqh, "a": sqa},
               "pl": {"h": rosters.get((lid, hid), []), "a": rosters.get((lid, aid), [])}}
        if m.get("tr"):
            rec["tr"] = m["tr"]
        # ilk yari sonucu ve IY/MS: Nesine orani varsa o, yoksa model
        hp_iy, hp_hf = half_probs(p["lh"], p["la"])
        rec["xo"] = {"iy": (nes or {}).get("iy") or [odd(x) for x in hp_iy],
                     "hf": (nes or {}).get("hf") or [odd(x) for x in hp_hf],
                     "s": ["Nesine" if (nes or {}).get("iy") else "model", "Nesine" if (nes or {}).get("hf") else "model"]}
        rec["xp"] = {"iy": [round(x, 3) for x in hp_iy], "hf": [round(x, 3) for x in hp_hf]}
        if mx_l:
            rec["mx"] = [round(mx_l[0], 3), round(mx_l[1], 3)]
        if fnl:
            rec["fn"] = [fnl[0], fnl[1]]
            rec["agx"] = {"rest": fnl[2], "out": fnl[3]}
        # Analiz365 = analizci heyetinin agirlikli ortak dagilimi (tek kaynak)
        lam_ = {}
        pv_ = agent_probs(rec, lam_)
        if lam_:
            p = rec["p"] = committee_p(lam_, {a: v for a, v in pv_.items() if a in lam_}, mid=m["id"])
            pv0 = _pvec(p)
            for grp, ks_ in (("ms", ("1", "X", "2")), ("dc", ("1X", "12", "X2")), ("ou15", ("O1.5", "U1.5")),
                             ("ou25", ("O2.5", "U2.5")), ("ou35", ("O3.5", "U3.5")), ("kg", ("KGV", "KGY"))):
                if ss.get(grp, "model") == "model":    # site orani olmayan pazarlar heyetin olasiligindan
                    for k_ in ks_:
                        mk[k_] = odd(pv0[k_])
            hp_iy, hp_hf = half_probs(p["lh"], p["la"])
            if rec["xo"]["s"][0] == "model":
                rec["xo"]["iy"] = [odd(x) for x in hp_iy]
            if rec["xo"]["s"][1] == "model":
                rec["xo"]["hf"] = [odd(x) for x in hp_hf]
            rec["xp"] = {"iy": [round(x, 3) for x in hp_iy], "hf": [round(x, 3) for x in hp_hf]}
        for k_, (a_, b_) in (("1X", ("1", "X")), ("12", ("1", "2")), ("X2", ("X", "2"))):
            if mk.get(k_) and mk.get(a_) and mk.get(b_) and mk[k_] > min(mk[a_], mk[b_]) - 0.005:
                mk[k_] = round(max(1.01, 1 / (1 / mk[a_] + 1 / mk[b_])), 2)
        rec["ag"] = agent_best(rec)
        rec["cons"] = analiz_tip(rec)
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
                          "t3": [x[:2] for x in m["p"]["top"][:3]],
                          "p": [m["p"]["p1"], m["p"]["px"], m["p"]["p2"]],
                          "ag": {a: v[0] for a, v in (m.get("ag") or {}).items() if v[0]}}
    for m in (bb or {}).get("matches", []):
        preds[m["id"]] = {"d": m["d"], "lg": "nba", "sc": m["p"]["score"], "k": m["tip"]["k"], "o": m["tip"]["o"],
                          "ln": m["line"], "p": [m["p"]["p1"], 0, m["p"]["p2"]],
                          "ag": {a: v[0] for a, v in (m.get("ag") or {}).items() if v[0]}}
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
    acc = {"n": 0, "tip": 0, "res": 0, "sc": 0, "sc3": 0, "n3": 0, "lg": {}}
    agacc, agaccbb = {}, {}
    # sayac sifirlamasi: STATS_FROM gununun Askabat gece yarisindan (UTC 19:00, onceki gun) once oynananlar sayilmaz
    stats_from = (pdate(STATS_FROM) if "T" in STATS_FROM else
                  datetime.strptime(STATS_FROM, "%Y-%m-%d").replace(tzinfo=timezone.utc) - timedelta(hours=5))
    since = max(NOW - timedelta(days=30), stats_from)
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
        if pv.get("t3"):
            acc["n3"] += 1
            acc["sc3"] += int([hs, as_] in pv["t3"])
        row = acc["lg"].setdefault(e["lg"], [0, 0])
        row[0] += 1
        row[1] += int(t_ok)
        # analizci karnesi: her ajanin mac baslamadan kaydedilen secimi sonucla karsilastirilir
        for a_, k_ in (pv.get("ag") or {}).items():
            if a_ in AGENTS:
                r_ = agacc.setdefault(a_, [0, 0])
                r_[0] += 1
                r_[1] += int(wins(k_, hs, as_))

    # ---- son 30 gunluk isabet (basketbol) ----
    accbb = {"n": 0, "tip": 0, "res": 0}
    for bid, e in ((bb or {}).pop("_done", None) or {}).items():
        pv = preds.get(bid)
        if not pv or e["dt"] < since:
            continue
        accbb["n"] += 1
        accbb["tip"] += int(bb_wins(pv["k"], e["hs"], e["as"], pv.get("ln", 0)))
        accbb["res"] += int((pv["p"][0] >= pv["p"][2]) == (e["hs"] > e["as"]))
        for a_, k_ in (pv.get("ag") or {}).items():
            if a_ in BB_AGENTS:
                r_ = agaccbb.setdefault(a_, [0, 0])
                r_[0] += 1
                r_[1] += int(bb_wins(k_, e["hs"], e["as"], pv.get("ln", 0)))

    # ---- mac detayi (form, aralarindaki maclar, karne, kadro, oyuncular) lig dosyalarina ayrilir:
    #      acilista inen data.js kuculur, detay yalnizca mac acilinca yuklenir ----
    ddir = os.path.join(ROOT, "data", "detail")
    detail = defaultdict(dict)
    for m in matches:
        m.pop("fn", None)
        m.pop("mx", None)
        detail[m["lg"]][m["id"]] = {k: m.pop(k) for k in ("f", "h2h", "st", "sq", "pl", "xp") if k in m}
    os.makedirs(ddir, exist_ok=True)
    for lid, rows in detail.items():
        cache_write(os.path.join(ddir, lid + ".json"), rows)
    for fn in os.listdir(ddir):
        if fn.endswith(".json") and fn[:-5] not in detail:
            os.remove(os.path.join(ddir, fn))

    data = {"updated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "split": 1,
            "leagues": [{"id": l["id"], "n": l["n"], "g": l["g"], "cup": l["cup"], "nat": l["nat"], "tier": l["tier"], "tsdb": bool(l["tsdb"]), "b": l.get("b")}
                        for l in LEAGUES],
            "teams": teams, "tables": tables, "matches": matches, "results": results, "bb": bb, "molla": molla_data, "recent": recent, "acc": acc, "accbb": accbb, "since": STATS_FROM,
            "agacc": agacc, "agaccbb": agaccbb, "agents": AGENTS,
            "agbt": agbt, "agw": AG_W}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.AHAL_DATA=")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")
    os.replace(tmp, OUT)
    try:
        write_seo_pages(data)
    except Exception as ex:                       # SEO sayfalari bulteni asla durdurmaz
        print("   SEO sayfalari atlandi:", ex, flush=True)
    print(f"Bitti: {len(matches)} mac, {len(results)} sonuc -> {OUT} "
          f"({os.path.getsize(OUT) // 1024} KB, {time.time() - t0:.0f} sn)", flush=True)


# ---- Arama motorlari icin statik lig sayfalari + site haritasi ------------------------------
# Uygulama "#/" adresleriyle calistigi icin arama motorlari mac / analiz icerigini goremez.
# Her lig icin yaklasan maclari ve Analiz365 tahminini duz HTML olarak yazan bir sayfa uretilir
# (lig/<lig>.html); ziyaretci sayfadaki baglantiyla uygulamaya gecer. sitemap.xml bunlari listeler.
SITE_URL = "https://" + (open(os.path.join(ROOT, "CNAME"), encoding="utf-8").read().strip()
                         if os.path.exists(os.path.join(ROOT, "CNAME")) else "thedentaldigest.org")
SEO_TZ = timezone(timedelta(hours=3))          # sayfalar Turkce: saatler TSI
SEO_LAB = {"1": "MS 1", "X": "MS X", "2": "MS 2", "1X": "Çifte Şans 1X", "12": "Çifte Şans 12", "X2": "Çifte Şans X2",
           "KGV": "Karşılıklı Gol Var", "KGY": "Karşılıklı Gol Yok"}
SEO_DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
SEO_MON = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]


def seo_lab(k):
    if k in SEO_LAB:
        return SEO_LAB[k]
    if k[:1] in "OU":
        return ("Üst " if k[0] == "O" else "Alt ") + k[1:]
    return k


def write_seo_pages(data):
    from html import escape as H
    teams = data["teams"]
    tn = lambda i: (teams.get(i) or {}).get("tr") or (teams.get(i) or {}).get("n") or "?"
    odir = os.path.join(ROOT, "lig")
    os.makedirs(odir, exist_ok=True)
    by_lg = defaultdict(list)
    for m in data["matches"]:
        by_lg[m["lg"]].append(m)
    made = []
    for l in data["leagues"]:
        ms = sorted(by_lg.get(l["id"], []), key=lambda m: m["d"])
        if not ms:
            continue
        name = l["n"].get("tr") or l["id"]
        rows, day = [], None
        for m in ms[:60]:
            dt = pdate(m["d"]).astimezone(SEO_TZ)
            dk = f"{dt.day} {SEO_MON[dt.month - 1]} {SEO_DAYS[dt.weekday()]}"
            if dk != day:
                rows.append(f'<tr class="d"><th colspan="4">{dk}</th></tr>')
                day = dk
            c = m.get("cons") or {}
            p = m.get("p") or {}
            sc = p.get("score")
            tip = f'{H(seo_lab(c["k"]))} <small>({c["o"]:.2f})</small>' if c.get("k") else "–"
            rows.append(f'<tr><td>{dt:%H:%M}</td><td><a href="../#/mac/{H(m["id"])}">{H(tn(m["h"]))} – {H(tn(m["a"]))}</a></td>'
                        f'<td>{f"{sc[0]}-{sc[1]}" if sc else "–"}</td><td>{tip}</td></tr>')
        desc = (f"{name} maç programı, oranlar ve Analiz365 skor tahminleri: "
                + ", ".join(f"{tn(m['h'])} – {tn(m['a'])}" for m in ms[:4]) + ".")[:300]
        url = f"{SITE_URL}/lig/{l['id']}.html"
        html_ = f"""<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{H(name)} Tahminleri ve Maç Programı — Analiz365</title>
<meta name="description" content="{H(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:title" content="{H(name)} Tahminleri — Analiz365">
<meta property="og:description" content="{H(desc)}">
<meta property="og:url" content="{url}">
<link rel="icon" href="../img/icon.svg" type="image/svg+xml">
<style>
:root{{--bg:#0b1220;--s1:#121b2e;--tx:#e6edf7;--mut:#8b9ab3;--line:#22304a;--ac:#22c55e}}
body{{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}}
main{{max-width:860px;margin:0 auto;padding:20px 16px 40px}}
a{{color:var(--ac)}} h1{{font-size:24px;margin:8px 0}} p{{color:var(--mut)}}
table{{width:100%;border-collapse:collapse;background:var(--s1);border-radius:12px;overflow:hidden}}
td,th{{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left}} tr.d th{{color:var(--mut);font-weight:600;font-size:13px}}
small{{color:var(--mut)}} .btn{{display:inline-block;margin:12px 0;padding:10px 16px;border-radius:10px;background:var(--ac);color:#06110a;font-weight:700;text-decoration:none}}
</style>
</head>
<body>
<main>
<a href="../">← Analiz365</a>
<h1>{H(name)} tahminleri ve maç programı</h1>
<p>Yaklaşan {H(name)} maçları, Analiz365 modelinin tahmini skoru ve beş analiz ajanının ortak tahmini. Saatler Türkiye saatine (TSİ) göredir. Son güncelleme: {NOW.astimezone(SEO_TZ):%d.%m.%Y %H:%M}.</p>
<a class="btn" href="../#/">Canlı bülten ve detaylı analiz</a>
<table>
<thead><tr><th>Saat</th><th>Maç</th><th>Tahmini skor</th><th>Analiz365 tahmini</th></tr></thead>
<tbody>
{chr(10).join(rows)}
</tbody>
</table>
<p>Tahminler istatistiksel modele dayanır, kesinlik içermez. 18 yaşından küçüklerin bahis oynaması yasaktır.</p>
</main>
</body>
</html>
"""
        with open(os.path.join(odir, l["id"] + ".html"), "w", encoding="utf-8") as f:
            f.write(html_)
        made.append(l["id"])
    for fn in os.listdir(odir):                       # bultende maci kalmayan ligin sayfasi kaldirilir
        if fn.endswith(".html") and fn[:-5] not in made:
            os.remove(os.path.join(odir, fn))
    today = NOW.strftime("%Y-%m-%d")
    urls = [f'  <url><loc>{SITE_URL}/</loc><lastmod>{today}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>']
    urls += [f'  <url><loc>{SITE_URL}/lig/{i}.html</loc><lastmod>{today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>'
             for i in made]
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + "\n".join(urls) + "\n</urlset>\n")
    print(f"   SEO: {len(made)} lig sayfasi + sitemap.xml", flush=True)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
