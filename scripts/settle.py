#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analiz365 - uye kuponlarini sunucuda sonuclandirir (GitHub Actions, 20 dakikada bir).

Bekleyen kuponlardaki maclarin sonuclarini ESPN / TheSportsDB'den okur ve
veritabanindaki settle_coupons fonksiyonunu cagirir: kazanan kuponlarin kazanci
bakiyeye eklenir. Ortam degiskenleri: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
(GitHub > Settings > Secrets and variables > Actions). Yoksa sessizce atlanir.
"""
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# yapistirirken eklenen bosluk / satir sonlari temizlenir
URL = "".join((os.environ.get("SUPABASE_URL") or "").split()).rstrip("/")
KEY = "".join((os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").split())
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOW = datetime.now(timezone.utc)


def http(url, method="GET", body=None, headers=None):
    h = {"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"}
    h.update(headers or {})
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8") or "null")


def sb(path, method="GET", body=None):
    # Supabase gizli anahtari tarayici gibi gorunen isteklerde reddeder: sunucu kimligi kullanilir
    h = {"apikey": KEY, "Content-Type": "application/json", "User-Agent": "analiz365-settle/1.0 (python-urllib)"}
    if KEY.startswith("eyJ"):            # eski tip (JWT) anahtar; yeni "sb_secret_" anahtarlari yalnizca apikey ile
        h["Authorization"] = "Bearer " + KEY
    return http(URL + path, method, body, h)


def pdate(s):
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return NOW


def main():
    if not URL or not KEY:
        print("Supabase ayarlanmamis; sonuclandirma atlandi.")
        return
    kind = ("sb_secret" if KEY.startswith("sb_secret_") else "sb_publishable (YANLIS: gizli anahtar olmali)"
            if KEY.startswith("sb_publishable_") else "JWT" if KEY.startswith("eyJ") else "tanimsiz")
    try:
        pend = sb("/rest/v1/coupons?status=eq.pending&select=id,sels&limit=5000") or []
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            # anahtarin kendisi yazdirilmaz; yalnizca turu ve uzunlugu
            print(f"HATA: Supabase anahtari reddedildi ({e.code}). Anahtar turu: {kind}, uzunluk: {len(KEY)}. "
                  "GitHub > Settings > Secrets > SUPABASE_SERVICE_ROLE_KEY degerini Supabase > API Keys > "
                  "Secret keys satirindaki kopyala dugmesiyle yeniden yapistirin.")
            sys.exit(1)
        raise
    # oran dogrulamasi: kupondaki oran, sitede yayinlanan en yuksek orandan fazlaysa kupon gecersiz
    try:
        oarc = json.load(open(os.path.join(ROOT, "data", "odds.json"), encoding="utf-8"))
    except Exception:
        oarc = {}
    bad = []
    for c in pend:
        for s in c.get("sels") or []:
            a = oarc.get(s.get("m"))
            if not a:
                continue
            mx = a["o"].get(s.get("k"))
            try:
                o = float(s.get("o"))
            except (TypeError, ValueError):
                o = None
            if o is None or mx is None or o > mx * 1.02 + 0.01:
                bad.append(c["id"])
                break
    if bad:
        n = sb("/rest/v1/rpc/void_coupons", "POST", {"p_ids": bad})
        print(f"{n} kupon gecersiz sayildi (oran yayinlanandan yuksek)")
        pend = [c for c in pend if c["id"] not in bad]
    need = {}
    for c in pend:
        for s in c.get("sels") or []:
            if "ok" not in s:
                need[s["m"]] = (s.get("lg"), pdate(s["d"]))
    need = {k: v for k, v in need.items() if v[1] < NOW - timedelta(minutes=95)}
    print(f"{len(pend)} bekleyen kupon, sonucu aranan {len(need)} mac")
    if not need:
        return
    results = {}
    # 1) bulten verisindeki sonuclar
    try:
        raw = open(os.path.join(ROOT, "data", "data.js"), encoding="utf-8").read()
        d = json.loads(raw[raw.index("=") + 1:].rstrip().rstrip(";"))
        for r in d.get("results", []) + ((d.get("bb") or {}).get("results") or []):
            if r["id"] in need:
                results[r["id"]] = [r["hs"], r["as"]]
    except Exception as e:
        print("bulten verisi okunamadi:", e)
    # 2) canli kaynaklar
    jobs = {}
    for mid, (lg, dt) in need.items():
        if mid in results:
            continue
        if mid.startswith("T"):
            time.sleep(2.6)                 # TheSportsDB pes pese istekleri reddeder
            try:
                e = (http(f"https://www.thesportsdb.com/api/v1/json/123/lookupevent.php?id={mid[1:]}").get("events") or [None])[0]
                if e and str(e.get("strStatus", "")).upper() in ("FT", "MATCH FINISHED") and e.get("intHomeScore") is not None:
                    results[mid] = [int(e["intHomeScore"]), int(e["intAwayScore"])]
            except Exception as ex:
                print("TheSportsDB:", mid, ex)
            continue
        if not lg:
            continue
        for x in (dt, dt - timedelta(hours=6)):
            jobs.setdefault(lg, set()).add(x.strftime("%Y%m%d"))
    for lg, days in jobs.items():
        path = "basketball/nba" if lg == "nba" else "soccer/" + lg
        for day in days:
            try:
                d = http(f"https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard?dates={day}&limit=200")
            except Exception as ex:
                print("ESPN:", lg, day, ex)
                continue
            for e in d.get("events", []):
                st = e["status"]["type"]["name"]
                if st not in ("STATUS_FULL_TIME", "STATUS_FINAL"):
                    continue
                mid = ("b" if lg == "nba" else "") + str(e["id"])
                if mid in need:
                    comp = {x["homeAway"]: x for x in e["competitions"][0]["competitors"]}
                    results[mid] = [int(comp["home"]["score"]), int(comp["away"]["score"])]
    print(f"{len(results)} macin sonucu bulundu")
    if results:
        n = sb("/rest/v1/rpc/settle_coupons", "POST", {"p_results": results})
        print(f"{n} kupon sonuclandi")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
