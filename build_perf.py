#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
接客業績ダッシュボード用データビルダー
  入力: Zoho CRM の COQL 結果 JSON（接客=cs_*.json / 受注車両=jo_*.json）
  出力: perf_latest.json（ダッシュボードが fetch する圧縮済みデータ）

使い方:
  python3 build_perf.py <raw_dir> <out_path>
    raw_dir 内の cs_*.json / jo_*.json をすべて読み込みます。
    各ファイルは {"data":{"data":[...]}} または {"data":[...]} の形を受け付けます。
"""
import json, sys, glob, os, re, datetime

# ── 表記ゆれの統一 ────────────────────────────────
SHOP_ALIAS = {
    "軽スタ": "軽スタ", "軽スタジアム": "軽スタ",
    "HVCP": "HVCP", "HV&コンパクト": "HVCP", "HVコンパクト": "HVCP",
    "SUV": "SUV", "ミニバン": "ミニバン",
    "アウトレット": "アウトレット", "その他": "その他",
}
# 担当者：フルネーム表記を苗字に寄せる（連名はそのまま残す）
MG_ALIAS = {
    "上野剛史": "上野", "上野　剛史": "上野",
    "石田竜大": "石田", "石田　竜大": "石田",
    "馬塚大智": "馬塚", "馬塚　大智": "馬塚",
    "本多英人": "本多", "金木琢真": "金木", "平田 美香": "平田",
}
MOT_CANON = ["Instagram","LINE","X（旧ツイッター）","Youtube","以前自社利用有","再来店",
             "家族・知人の紹介","折込チラシ","整備入庫パス","看板/店舗を見て","自社HP",
             "通りがかりに","野立て看板","ＣＳ","ＣＳ（予約）","ＣＳ（直撃）",
             "ＧＯＯ","ＧＯＯ（予約）","ＧＯＯ（直撃）"]

def defuzz(s, canon):
    """文字化け（U+FFFD）を含む値を、既知文字の並びから正規の値に寄せる。
    化けた1文字が U+FFFD 複数個になることがあるため、連続する U+FFFD を
    「1〜2文字の何か」とみなして照合する。一意に決まらなければ元の値のまま。"""
    if not s or "\ufffd" not in s:
        return s
    pat = ""
    for part in re.split(r"(\ufffd+)", s):
        if not part:
            continue
        pat += ".{1,2}" if part[0] == "\ufffd" else re.escape(part)
    hit = [c for c in canon if re.fullmatch(pat, c)]
    return hit[0] if len(hit) == 1 else s


def shop(v):
    if not v: return None
    v = defuzz(v, list(SHOP_ALIAS))
    return SHOP_ALIAS.get(v, v)

def mgr(v):
    if not v: return None
    v = v.strip()
    return MG_ALIAS.get(v, v)

def motiv(v):
    if not v: return None
    return defuzz(v, MOT_CANON)

# ── 入力読み込み ──────────────────────────────────
def rows(path):
    """COQL結果のJSONから、レコード配列を取り出す。
    Zoho MCPの戻り値は {"data":{"data":[...]}} だったり、ツール結果の保存形式で
    もう一段包まれていたりするので、'id' を持つ辞書の配列を再帰的に探す。"""
    o = json.load(open(path, encoding="utf-8"))
    best = []
    def walk(x, depth=0):
        nonlocal best
        if depth > 8:
            return
        if isinstance(x, list):
            if x and isinstance(x[0], dict) and "id" in x[0]:
                if len(x) > len(best):
                    best = x
                return
            for v in x:
                walk(v, depth + 1)
        elif isinstance(x, dict):
            for v in x.values():
                walk(v, depth + 1)
    walk(o)
    return best

def load(raw_dir, prefix):
    out = []
    for p in sorted(glob.glob(os.path.join(raw_dir, prefix + "*.json"))):
        out += rows(p)
    return out

# ── 辞書化ヘルパ ──────────────────────────────────
class Dic:
    def __init__(self): self.m = {}
    def i(self, v):
        if v is None: return -1
        if v not in self.m: self.m[v] = len(self.m)
        return self.m[v]
    def list(self): return list(self.m)

def build(raw_dir, out_path):
    cs = load(raw_dir, "cs_")
    jo = load(raw_dir, "jo_")
    if not cs or not jo:
        raise SystemExit(f"入力が足りません cs={len(cs)} jo={len(jo)}")

    # 重複除去（ページ跨ぎの取りこぼし対策）
    cs = list({r["id"]: r for r in cs}.values())
    jo = list({r["id"]: r for r in jo}.values())

    OPT = ["ローン","下取","保険","保証","コーティング","メンテパック",
           "ドラレコ","ナビ","納車前パック","タイヤ保証","ガラス保証"]
    OPT_F = ["field163","field164","field165","field150","field158","field169",
             "field157","field173","field166","field156","field223"]

    MG, MO, CA, SH, VT, DT = Dic(), Dic(), Dic(), Dic(), Dic(), Dic()

    # 接客
    cs2 = []
    for r in cs:
        dv = r.get("Date_And_Time_Of_Visit")
        if not dv: continue
        cs2.append({
            "d": dv[:10],
            "cat": r.get("First_Time_Return"),
            "mot": motiv(r.get("Motivation")),
            "mg": mgr((r.get("Manager") or {}).get("name")),
            "se": r.get("Seated") == "〇",
            "es": r.get("Estimate") == "〇",
            "cl": r.get("Contract_Closed") == "〇",
            "sh": shop(r.get("field6")),
            "vt": r.get("field12"),
            "op": (r.get("Opportunity_Data") or {}).get("id"),
        })
    cs2.sort(key=lambda x: x["d"])

    # 商談案件 → 初回来店のきっかけ／新規既存
    first = {}
    for v in cs2:
        if v["op"] and v["op"] not in first:
            first[v["op"]] = (v["mot"], v["cat"])

    # 受注車両
    jo2 = []
    for r in jo:
        dv = r.get("field184")
        if not dv: continue
        bits = 0
        for i, f in enumerate(OPT_F):
            if r.get(f): bits |= 1 << i
        mot, cat = first.get((r.get("field1") or {}).get("id"), (None, None))
        jo2.append({
            "d": dv[:10], "sh": shop(r.get("field185")), "mg": mgr(r.get("field186")),
            "sa": r.get("field183") or 0, "gp": r.get("field233") or 0,
            "vg": r.get("field226") or 0, "fg": r.get("field181") or 0,
            "cg": r.get("field232") or 0,
            "mot": mot, "cat": cat, "o": bits,
        })
    jo2.sort(key=lambda x: x["d"])

    # 日付辞書は昇順で採番
    for d in sorted({v["d"] for v in cs2} | {v["d"] for v in jo2}):
        DT.i(d)

    V = [[DT.i(v["d"]), CA.i(v["cat"]), MO.i(v["mot"]), MG.i(v["mg"]),
          (1 if v["se"] else 0) | (2 if v["es"] else 0) | (4 if v["cl"] else 0),
          SH.i(v["sh"]), VT.i(v["vt"])] for v in cs2]
    D = [[DT.i(v["d"]), SH.i(v["sh"]), MG.i(v["mg"]), v["sa"], v["gp"], v["vg"],
          v["fg"], v["cg"], MO.i(v["mot"]), CA.i(v["cat"]), v["o"]] for v in jo2]

    jst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    out = {"MG": MG.list(), "MO": MO.list(), "CA": CA.list(), "SH": SH.list(),
           "VT": VT.list(), "DT": DT.list(), "OPT": OPT, "V": V, "D": D,
           "gen": jst.strftime("%Y-%m-%d"), "synced": jst.strftime("%Y-%m-%d %H:%M")}
    json.dump(out, open(out_path, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    linked = sum(1 for r in jo if first.get((r.get("field1") or {}).get("id")))
    print(f"接客 {len(V)}件 / 受注 {len(D)}台 / 紐づけ {linked}台 "
          f"({linked/max(1,len(D))*100:.0f}%) → {out_path} "
          f"{os.path.getsize(out_path):,} bytes  synced={out['synced']}")

if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else ".",
          sys.argv[2] if len(sys.argv) > 2 else "perf_latest.json")
