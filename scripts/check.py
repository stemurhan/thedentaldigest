#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analiz365 - yayin oncesi veri denetimi (is akisinda update.py'den sonra calisir).

Hata (cikis kodu 1, veri yayinlanmaz):
  * data.js okunamiyor / JSON bozuk, mac listesi bos ya da cok kucuk
  * bir macta takim adi, olasilik ya da oran eksik / gecersiz (NaN, 1.00 alti)
  * tahmini skor en olasi sonucla ya da Analiz365 tahminiyle celisiyor
  * ayrintili mac dosyasi (data/detail) eksik
Uyari (yalnizca yazdirilir): kupon secimleri, cifte sans oranlari, cevirisiz takimlar.
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
errors, warns = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def num_ok(v, lo=None):
    return isinstance(v, (int, float)) and not math.isnan(v) and not math.isinf(v) and (lo is None or v >= lo)


def outcome(i, j):
    return 0 if i > j else 1 if i == j else 2


def wins(k, h, a):
    if k == "1":
        return h > a
    if k == "X":
        return h == a
    if k == "2":
        return h < a
    if k == "1X":
        return h >= a
    if k == "12":
        return h != a
    if k == "X2":
        return h <= a
    if k == "KGV":
        return h > 0 and a > 0
    if k == "KGY":
        return not (h > 0 and a > 0)
    return h + a > float(k[1:]) if k[0] == "O" else h + a < float(k[1:])


def main():
    try:
        raw = open(os.path.join(ROOT, "data", "data.js"), encoding="utf-8").read()
        d = json.loads(raw[raw.index("=") + 1:].rstrip().rstrip(";"))
    except Exception as ex:
        print("HATA: data.js okunamadi:", ex)
        return 1
    M = d.get("matches") or []
    if len(M) < 50:
        err(f"bultende cok az mac var ({len(M)})")
    teams = d.get("teams") or {}
    lgs = {l["id"] for l in d.get("leagues") or []}
    detail_lgs = set()
    for m in M:
        mid = m.get("id")
        if m.get("h") not in teams or m.get("a") not in teams:
            err(f"{mid}: takim adi yok")
        if m.get("lg") not in lgs:
            err(f"{mid}: bilinmeyen lig {m.get('lg')}")
        detail_lgs.add(m.get("lg"))
        p = m.get("p") or {}
        pr = [p.get("p1"), p.get("px"), p.get("p2")]
        if not all(num_ok(x, 0) for x in pr) or abs(sum(pr) - 1) > 0.02:
            err(f"{mid}: sonuc olasiliklari gecersiz {pr}")
            continue
        for k, v in (m.get("o") or {}).items():
            if not num_ok(v, 1.0):
                err(f"{mid}: gecersiz oran {k}={v}")
        sc = p.get("score")
        if not (isinstance(sc, list) and len(sc) == 2):
            err(f"{mid}: tahmini skor yok")
            continue
        if outcome(*sc) != max(range(3), key=lambda i: pr[i]) and mid not in (d.get("pinned") or []):
            warn(f"{mid}: tahmini skor {sc} en olasi sonuctan farkli (kupon taahhudu olabilir)")
        c = m.get("cons")
        if c and not wins(c["k"], *sc):
            err(f"{mid}: Analiz365 tahmini {c['k']} skor {sc} ile celisiyor")
        o = m.get("o") or {}
        for k_, (a_, b_) in (("1X", ("1", "X")), ("12", ("1", "2")), ("X2", ("X", "2"))):
            if o.get(k_) and o.get(a_) and o.get(b_) and o[k_] > min(o[a_], o[b_]) + 1e-9:
                warn(f"{mid}: cifte sans {k_} orani tek sonuctan yuksek")
    if d.get("split"):
        for lg in detail_lgs:
            if not os.path.exists(os.path.join(ROOT, "data", "detail", lg + ".json")):
                err(f"ayrinti dosyasi yok: data/detail/{lg}.json")
    # kupon secimleri tahmini skorla (yalnizca uyari: yayinlanmis kuponlar sonradan degismez)
    Mi = {m["id"]: m for m in M}
    cps = (d.get("molla") or {}).get("coupons") or []
    if cps:
        c = cps[0]
        for key in ("picks",):
            for x in c.get(key) or []:
                m = Mi.get(x["id"])
                if m and not wins(x["k"], *m["p"]["score"]):
                    warn(f"kupon secimi {x['k']} ({x.get('hn')}) tahmini skorla celisiyor")
        for key in ("hi", "sys", "big"):
            for x in (c.get(key) or {}).get("picks", []):
                m = Mi.get(x["id"])
                if m and not wins(x["k"], *m["p"]["score"]):
                    warn(f"{key} kupon secimi {x['k']} ({x.get('hn')}) tahmini skorla celisiyor")
    untr = sum(1 for t in teams.values() if not t.get("tr"))
    if untr:
        warn(f"{untr} takimin Turkce adi yok")
    print(f"Denetim: {len(M)} mac, {len(errors)} hata, {len(warns)} uyari")
    for w in warns[:15]:
        print("  uyari:", w)
    for e in errors[:30]:
        print("  HATA:", e)
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
