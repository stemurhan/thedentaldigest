#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analiz365 - Analiz kuponlarinda kaybeden mac var mi? (sonuclandirma zinciri ~8 dakikada bir calistirir)

Guncel donemin kuponlarindaki (ortak + analizcilerin kendi kuponlari), sonucu henuz islenmemis maclarin
canli skoruna bakar (ESPN, live.py ile ayni kaynak). Biten bir mac kuponu kaybettirdiyse cikis kodu 3 doner;
is akisi bu durumda bulten guncellemesini hemen baslatir ve guncelleme kaybeden kuponun yerine yenisini kurar
(2 saatlik zamanlayiciyi beklemeden). Devre (IY/MS) secimleri canli akistan bilinemez, atlanir.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def wins(k, hs, as_):
    tot = hs + as_
    if k[:1] == "S" and "-" in k:
        a, b = k[1:].split("-")
        return [hs, as_] == [int(a), int(b)]
    table = {"1": hs > as_, "X": hs == as_, "2": hs < as_, "1X": hs >= as_, "12": hs != as_, "X2": hs <= as_,
             "KGV": hs > 0 and as_ > 0, "KGY": not (hs > 0 and as_ > 0)}
    if k in table:
        return table[k]
    if k[:1] in "OU":
        n = float(k[1:])
        return tot > n if k[0] == "O" else tot < n
    return None


def coupons(c):
    """(tur, kupon) ciftleri: ortak kuponlar ve analizcilerin kendi kuponlari."""
    out = [("picks", c.get("picks") or [])]
    for t in ("hi", "sys", "big", "hf", "sk", "hfs"):
        if c.get(t):
            out.append((t, c[t]))
    for o in (c.get("ac") or {}).values():
        for t in ("main", "hi", "sys", "big"):
            if o.get(t):
                out.append((t, o[t]))
    return out


def main():
    try:
        st = json.load(open(os.path.join(ROOT, "data", "molla.json"), encoding="utf-8"))
    except Exception as e:
        print("izleme: molla.json okunamadi:", e)
        return 0
    keys = sorted(st.get("coupons") or {})
    if not keys:
        return 0
    cur = st["coupons"][keys[-1]]
    ev = live.build()
    fin = {k: v for k, v in ev.items() if v.get("s") == "post" and ("FULL_TIME" in v.get("n", "") or "FINAL" in v.get("n", ""))}
    if not fin:
        print("izleme: biten mac yok")
        return 0
    lost = []
    for t, v in coupons(cur):
        pk = v if isinstance(v, list) else v.get("picks", [])
        no = 0
        for x in pk:
            if x.get("ok") is False:
                no += 1
                continue
            if "ok" in x or x["id"] not in fin or x["k"][:2] in ("HF", "IY", "2Y"):
                continue
            r = fin[x["id"]]
            if wins(x["k"], r["hs"], r["as"]) is False:
                no += 1
        need = len(pk) - ((v.get("k") or 3) if t in ("sys", "hfs") else len(pk))
        if pk and no > need:
            lost.append(t)
    if lost:
        print("izleme: kaybeden kupon var (sonucu henuz islenmedi):", ", ".join(sorted(set(lost))))
        return 3
    print("izleme: kaybeden yeni kupon yok")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
