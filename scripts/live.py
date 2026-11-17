#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analiz365 - canli skor yedegi.

Tarayici canli skoru dogrudan ESPN'den okur; ESPN'e ulasamayan cihazlarda (bazi mobil aglar /
tarayicilar) site yedek kaynaga duser: su an oynanan maclarin skoru, dakikasi ve golleri.
- publish(): Supabase Storage'daki herkese acik "live/live.json" dosyasina yazar
  (sonuclandirma is akisi her calismada cagirir, ~8 dakikada bir).
- main(): ayni veriyi depodaki data/live.json dosyasina yazar (ayri bir is akisi icin).
Oynanan mac yoksa dosya bir kez bosaltilir, sonra dokunulmaz.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "live.json")
NOW = datetime.now(timezone.utc)
SITE = "https://site.api.espn.com/apis/site/v2/sports/"


def pdate(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def get(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def load_data():
    with open(os.path.join(ROOT, "data", "data.js"), encoding="utf-8") as f:
        s = f.read()
    return json.loads(s[s.index("{"):s.rindex("}") + 1])


def build():
    """Oynanan maclarin canli durumu: {mac_id: {s, hs, as, n, c, g}}."""
    D = load_data()
    want = {}                                       # (lig, gun) -> {mac kimlikleri}
    cands = [(m, False) for m in (D.get("matches") or []) + (D.get("recent") or [])]
    cands += [(m, True) for m in ((D.get("bb") or {}).get("matches") or [])]
    for m, bb in cands:
        mid, dt = str(m.get("id", "")), pdate(m.get("d", ""))
        if not dt or mid[:1] == "T":                # TheSportsDB maclari ESPN'de yok
            continue
        if not (NOW - timedelta(hours=4.5 if bb else 3.3) < dt <= NOW + timedelta(minutes=2)):
            continue
        lg = "basketball/nba" if bb else "soccer/" + m["lg"]
        for d in {dt.strftime("%Y%m%d"), (dt - timedelta(hours=6)).strftime("%Y%m%d")}:
            want.setdefault((lg, d), set()).add(mid)
    ev = {}
    for (lg, day), ids in want.items():
        d = get(f"{SITE}{lg}/scoreboard?dates={day}&limit=200")
        for e in (d or {}).get("events", []):
            bb = lg.startswith("basketball")
            eid = ("b" if bb else "") + str(e.get("id"))
            if eid not in ids and str(e.get("id")) not in ids:
                continue
            st = (e.get("status") or {}).get("type") or {}
            if st.get("state") not in ("in", "post") or any(w in (st.get("name") or "") for w in
                                                             ("POSTPON", "CANCEL", "ABANDON", "SUSPEND", "DELAY")):
                continue
            c = e["competitions"][0]
            comp = {x["homeAway"]: x for x in c["competitors"]}
            h, a = comp["home"], comp["away"]
            rec = {"s": "post" if st["state"] == "post" else "in", "hs": int(h.get("score") or 0),
                   "as": int(a.get("score") or 0), "n": st.get("name") or "",
                   "c": "" if st["state"] == "post" else (st.get("shortDetail") if bb else (e.get("status") or {}).get("displayClock")) or ""}
            if not bb:
                rec["g"] = [{"m": (x.get("clock") or {}).get("displayValue") or "",
                             "s": "h" if str((x.get("team") or {}).get("id")) == str(h["team"]["id"]) else "a",
                             "p": ((x.get("athletesInvolved") or [{}])[0] or {}).get("displayName") or "",
                             "og": bool(x.get("ownGoal")), "pk": bool(x.get("penaltyKick"))}
                            for x in c.get("details") or [] if x.get("scoringPlay") and not x.get("shootout")]
            ev[eid] = rec
    return ev


def payload(ev):
    return {"t": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "ev": ev}


def publish(url, key):
    """Canli durumu Supabase Storage'a (herkese acik 'live' kovasi) yazar."""
    url = "".join((url or "").split()).rstrip("/")
    key = "".join((key or "").split())
    if not url or not key:
        return
    h = {"apikey": key, "User-Agent": "analiz365-live/1.0 (python-urllib)"}
    if key.startswith("eyJ"):
        h["Authorization"] = "Bearer " + key

    def call(path, method, data, ctype="application/json", extra=None):
        hh = dict(h, **{"Content-Type": ctype}, **(extra or {}))
        req = urllib.request.Request(url + path, data=data, method=method, headers=hh)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status

    ev = build()
    old = get(f"{url}/storage/v1/object/public/live/live.json?t={int(NOW.timestamp())}")
    if not ev and old is not None and not old.get("ev"):   # mac yok ve dosya zaten bos: dokunma
        print("canli: oynanan mac yok")
        return
    # dosya hic yoksa (old None) mac olmasa da kova ve bos dosya olusturulur
    body = json.dumps(payload(ev), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    try:
        call("/storage/v1/bucket", "POST", json.dumps({"id": "live", "name": "live", "public": True}).encode())
    except Exception:
        pass                                        # kova zaten var
    call("/storage/v1/object/live/live.json", "POST", body,
         extra={"x-upsert": "true", "cache-control": "max-age=20"})
    print(f"canli: {len(ev)} mac Supabase'e yazildi")


def main():
    ev = build()
    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        old = {}
    if not ev and not old.get("ev"):
        print("Canli mac yok; dosya degismedi.")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload(ev), f, ensure_ascii=False, separators=(",", ":"))
    print(f"Canli skor: {len(ev)} mac yazildi.")


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:                          # canli yedek hicbir zaman is akisini bozmasin
        print("canli skor atlandi:", ex)
    sys.exit(0)
