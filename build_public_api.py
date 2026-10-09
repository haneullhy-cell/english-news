"""
공공데이터 API 찾기 — 목록 데이터 만들기

공공데이터포털이 매달 올리는 '공공데이터포털 목록개방현황' 파일(CSV)을 받아서
오픈 API만 골라 docs/public-api/data/apis.json 으로 저장합니다.

  python build_public_api.py            # 새 파일이 올라왔을 때만 다시 만들기
  python build_public_api.py --force    # 무조건 다시 만들기
  python build_public_api.py --csv 파일.csv   # 이미 받아 둔 CSV로 만들기

원본: https://www.data.go.kr/data/15062804/fileData.do
"""

import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

import requests

PAGE_URL = "https://www.data.go.kr/data/15062804/fileData.do"
OUT_DIR = Path(__file__).resolve().parent / "docs" / "public-api" / "data"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
DESC_MAX = 160
KST = dt.timezone(dt.timedelta(hours=9))

# ── 지역 추정 ─────────────────────────────────────────────
# 포털의 '공간범위'는 대부분 비어 있어서, 제공기관 이름으로 시·도를 추정합니다.
SIDO = [
    ("서울", ("서울특별시", "서울시", "서울")),
    ("부산", ("부산광역시", "부산시", "부산")),
    ("대구", ("대구광역시", "대구시", "대구")),
    ("인천", ("인천광역시", "인천시", "인천")),
    ("전남·광주", ("전남광주통합특별시", "광주광역시", "광주시", "전라남도", "전남", "광주")),
    ("대전", ("대전광역시", "대전시", "대전")),
    ("울산", ("울산광역시", "울산시", "울산")),
    ("세종", ("세종특별자치시", "세종시", "세종")),
    ("경기", ("경기도", "경기")),
    ("강원", ("강원특별자치도", "강원도", "강원")),
    ("충북", ("충청북도", "충북")),
    ("충남", ("충청남도", "충남")),
    ("전북", ("전북특별자치도", "전라북도", "전북")),
    ("경북", ("경상북도", "경북")),
    ("경남", ("경상남도", "경남")),
    ("제주", ("제주특별자치도", "제주도", "제주")),
]
FORMAL_END = ("특별시", "광역시", "특별자치시", "도")
# 짧은 이름('서울', '화성' 등)으로 시작하는 기관은 지방공기업·출연기관일 때만 지역으로 봅니다.
LOCAL_BODY = re.compile(r"(공사|공단|재단|진흥원|연구원|센터|교육청|소방본부|문화원|테크노파크)")
# 지역 이름으로 시작하지만 전국을 대상으로 하는 기관
NATIONAL_EXCEPT = ("인천국제공항공사", "인천항만공사", "부산항만공사", "울산항만공사", "여수광양항만공사",
                   "광주과학기술원", "울산과학기술원", "대구경북과학기술원", "대구경북첨단의료산업진흥재단",
                   "수도권매립지관리공사", "서울올림픽기념국민체육진흥공단", "세종학당재단")
SGG_RE = re.compile(r"^[가-힣]{1,6}(?:시|군|구)$")
SIDO_NAMES = {nm for _, names in SIDO for nm in names}


def _strip_org(org):
    org = re.sub(r"^(재단법인|사단법인|\(재\)|\(사\))\s*", "", (org or "").strip())
    return org


def _match_sido(org):
    """시·도 이름으로 시작하면 (시·도, 시·군·구, 정식이름여부)."""
    for short, names in SIDO:
        for nm in names:
            if not org.startswith(nm):
                continue
            rest = org[len(nm):]
            formal = nm.endswith(FORMAL_END)
            if not formal and not (nm.endswith("시") or LOCAL_BODY.search(rest)):
                continue
            sgg = ""
            if rest.startswith(" "):
                first = rest.strip().split(" ")[0]
                if SGG_RE.match(first):
                    sgg = first
            return short, sgg, formal
    return None


def sgg_table(orgs):
    """'경기도 화성시' 같은 정식 이름에서 시·군·구 → 시·도 표를 만듭니다(두 곳 이상에 있는 이름은 제외)."""
    seen = {}
    for org in orgs:
        m = _match_sido(_strip_org(org))
        if m and m[1] and m[2]:
            seen.setdefault(m[1], set()).add(m[0])
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


def guess_region(org, table=None):
    """제공기관 이름 → (시·도, 시·군·구). 전국 단위면 ('', '')."""
    org = _strip_org(org)
    if not org or org.startswith(NATIONAL_EXCEPT):
        return "", ""
    m = _match_sido(org)
    if m:
        return m[0], m[1]
    # '김해시도시개발공사', '화성도시공사', '강북구도시관리공단'처럼 시·군·구 이름으로 시작하는 지방공기업
    for sgg, sido in (table or {}).items():
        for head in (sgg, sgg[:-1]):
            if len(head) < 2 or head in SIDO_NAMES or not org.startswith(head):
                continue
            if LOCAL_BODY.search(org[len(head):]):
                return sido, sgg
    return "", ""


# ── 값 정리 ───────────────────────────────────────────────
def license_code(s):
    """이용허락범위 → free(제한 없음) / by(1유형) / nc(2유형) / nd(3유형) / ncnd(4유형)."""
    s = s or ""
    if "제 4유형" in s or "제4유형" in s:
        return "ncnd"
    if "제 3유형" in s or "제3유형" in s:
        return "nd"
    if "제 2유형" in s or "제2유형" in s:
        return "nc"
    if "제 1유형" in s or "제1유형" in s:
        return "by"
    nc = "상업" in s and "금지" in s
    nd = "변경금지" in s
    if nc and nd:
        return "ncnd"
    if nc:
        return "nc"
    if nd:
        return "nd"
    if "출처표시" in s:
        return "by"
    return "free"


def approval(s):
    """심의 유형 → (개발 자동승인?, 운영 자동승인?)."""
    s = (s or "").replace(" ", "")
    dev = op = None
    m = re.search(r"개발단계[:：]?([^/]+)", s)
    if m:
        dev = "자동" in m.group(1)
    m = re.search(r"운영단계[:：]?([^/]+)", s)
    if m:
        op = "자동" in m.group(1)
    if dev is None and op is None:
        auto = "자동" in s
        return auto, auto
    if dev is None:
        dev = op
    if op is None:
        op = False
    return dev, op


def api_kind(api_type, form):
    t = (api_type or "").upper()
    if "SOAP" in t:
        return "SOAP"
    if "REST" in t:
        return "REST"
    if "LINK" in t or "링크" in (form or "") or "외부" in (form or ""):
        return "LINK"
    return t.strip() or "기타"


def dev_traffic(s):
    """'개발계정 : 10000/ 운영계정 : ...' → 10000. 기관마다 다른 링크형은 0."""
    m = re.search(r"개발계정\s*[:：]\s*([\d,]+)", s or "")
    return int(m.group(1).replace(",", "")) if m else 0


def to_int(s):
    try:
        return int(re.sub(r"[^\d]", "", s or "") or 0)
    except ValueError:
        return 0


def clean(s, limit=None):
    s = re.sub(r"\s+", " ", (s or "").replace("﻿", "")).strip()
    if limit and len(s) > limit:
        s = s[:limit].rstrip() + "…"
    return s


def split_cat(s):
    parts = [p.strip() for p in (s or "").split(" - ") if p.strip()]
    return (parts[0] if parts else "기타"), (parts[1] if len(parts) > 1 else "")


# ── 내려받기 ───────────────────────────────────────────────
def get(session, url, **kw):
    """포털이 연결을 자주 끊어서, 실패하면 간격을 늘려 가며 다시 시도합니다."""
    last = None
    for i in range(8):
        try:
            r = session.get(url, timeout=(20, 90), **kw)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            wait = min(60, 3 * 2 ** i)
            print(f"  다시 시도 {i + 1}/8 ({e.__class__.__name__}) — {wait}초 뒤")
            time.sleep(wait)
    raise SystemExit(f"포털에 연결하지 못했습니다: {last}")


def find_source(session):
    html = get(session, PAGE_URL).text
    m = re.search(r'"contentUrl"\s*:\s*"([^"]*fileDownload\.do[^"]*)"', html)
    if not m:
        raise SystemExit("다운로드 주소를 찾지 못했습니다. 포털 페이지 구조가 바뀌었는지 확인해 주세요.")
    url = m.group(1).replace("&amp;", "&")
    t = re.search(r"<title>([^<|]*)", html)
    name = clean(t.group(1)) if t else ""
    d = re.search(r"_(\d{8})\s*$", name)
    date = f"{d.group(1)[:4]}-{d.group(1)[4:6]}-{d.group(1)[6:]}" if d else ""
    return url, name, date


def download(session, url, dest):
    for i in range(6):
        try:
            with session.get(url, stream=True, timeout=(20, 120)) as r:
                r.raise_for_status()
                want = int(r.headers.get("Content-Length") or 0)
                got = 0
                with open(dest, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                        got += len(chunk)
                if want and got != want:
                    raise requests.RequestException(f"{got}/{want} 바이트에서 끊김")
                print(f"  받음: {got / 1e6:.1f}MB")
                return
        except requests.RequestException as e:
            wait = min(60, 5 * 2 ** i)
            print(f"  다시 받기 {i + 1}/6 ({e}) — {wait}초 뒤")
            time.sleep(wait)
    raise SystemExit("CSV 파일을 끝까지 받지 못했습니다.")


# ── 변환 ─────────────────────────────────────────────────
def read_csv(path):
    """CSV를 한 번 훑어서 (전체 기관 이름 집합, 오픈 API 행 목록)을 돌려줍니다."""
    enc = "utf-8-sig"
    with open(path, "rb") as f:
        try:
            f.read().decode(enc)
        except UnicodeDecodeError:
            enc = "cp949"
    orgs, rows = set(), []
    with open(path, encoding=enc, errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        need = ["목록키", "목록유형", "목록명", "제공기관", "분류체계"]
        missing = [k for k in need if k not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"CSV에 필요한 열이 없습니다: {missing}")
        for r in reader:
            orgs.add(clean(r.get("제공기관")))
            if "API" in (r.get("목록유형") or "").upper():
                rows.append(r)
    return orgs, rows


def build(orgs, rows, source_name, source_date):
    # 시·군·구 표는 파일데이터까지 포함한 전체 기관 이름으로 만들어야 더 많이 잡혀요.
    table = sgg_table(orgs)
    out = []
    for r in rows:
        pk = clean(r.get("목록키"))
        if not pk.isdigit():
            continue
        cat1, cat2 = split_cat(r.get("분류체계"))
        org = clean(r.get("제공기관"))
        sido, sgg = guess_region(org, table)
        dev_auto, op_auto = approval(r.get("심의 유형"))
        out.append([
            pk,                                              # 0 목록키
            clean(r.get("목록명")),                          # 1 이름
            org,                                             # 2 제공기관
            cat1,                                            # 3 대분류
            cat2,                                            # 4 중분류
            api_kind(r.get("API 유형"), r.get("제공형태")),   # 5 REST/SOAP/LINK
            1 if op_auto else 0,                             # 6 운영계정 자동승인
            license_code(r.get("이용허락범위")),              # 7 이용허락
            to_int(r.get("다운로드_활용신청건수")),           # 8 활용신청
            to_int(r.get("조회수")),                         # 9 조회
            clean(r.get("수정일"))[:10],                     # 10 수정일
            clean(r.get("등록일"))[:10],                     # 11 등록일
            clean(r.get("설명"), DESC_MAX),                  # 12 설명
            clean(r.get("키워드")),                          # 13 키워드
            sido,                                            # 14 시·도 (추정)
            sgg,                                             # 15 시·군·구 (추정)
            dev_traffic(r.get("신청가능 트래픽")),           # 16 개발계정 하루 트래픽(모르면 0)
            clean(r.get("관리 부서명")),                     # 17 담당 부서
            1 if (r.get("비용부과유무") or "").strip() == "유료" else 0,  # 18 유료
            1 if (r.get("국가중점여부") or "").strip().upper() == "Y" else 0,  # 19 국가중점
            1 if dev_auto else 0,                            # 20 개발계정 자동승인
        ])
    out.sort(key=lambda x: -x[8])
    meta = {
        "built": dt.datetime.now(KST).strftime("%Y-%m-%d"),
        "source_date": source_date,
        "source_name": source_name,
        "count": len(out),
    }
    return out, meta


def write(out, meta):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "apis.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"저장: {OUT_DIR / 'apis.json'} ({len(out):,}개)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="같은 원본이어도 다시 만들기")
    ap.add_argument("--csv", help="이미 받아 둔 목록개방현황 CSV 경로")
    ap.add_argument("--source-date", default="", help="--csv와 함께: 원본 기준일(YYYY-MM-DD)")
    ap.add_argument("--source-name", default="", help="--csv와 함께: 원본 파일데이터명")
    args = ap.parse_args()

    if args.csv:
        orgs, rows = read_csv(args.csv)
        name = args.source_name or Path(args.csv).stem
        d = re.search(r"(\d{8})", name)
        date = args.source_date or (f"{d.group(1)[:4]}-{d.group(1)[4:6]}-{d.group(1)[6:]}" if d else "")
        out, meta = build(orgs, rows, name, date)
        write(out, meta)
        return

    s = requests.Session()
    s.headers["User-Agent"] = UA
    print("포털에서 최신 목록 파일을 찾는 중…")
    url, name, date = find_source(s)
    print(f"  최신 파일: {name} ({date})")

    meta_path = OUT_DIR / "meta.json"
    if meta_path.exists() and not args.force:
        old = json.loads(meta_path.read_text(encoding="utf-8"))
        if old.get("source_date") == date and date:
            print("이미 최신 목록입니다. 할 일이 없어요.")
            return

    with tempfile.TemporaryDirectory() as tmp:
        dest = os.path.join(tmp, "list.csv")
        print("CSV 받는 중… (100MB가 넘어서 몇 분 걸려요)")
        download(s, url, dest)
        orgs, rows = read_csv(dest)
    out, meta = build(orgs, rows, name, date)
    if len(out) < 5000:
        raise SystemExit(f"오픈 API가 {len(out)}개뿐이라 이상합니다. 저장하지 않았어요.")
    write(out, meta)


if __name__ == "__main__":
    sys.exit(main())
