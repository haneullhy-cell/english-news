#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
매일 아침 인스타그램·네이버에 올라온 공동구매(공구) 글을 모아서
'공구 모아' 앱(docs/gonggu)이 읽는 목록으로 저장하고,
새 공구가 있으면 카카오톡 "나와의 채팅"으로 알려 줍니다.

동작 순서:
  1. 인스타그램 해시태그 글 가져오기 (Apify — APIFY_TOKEN이 있을 때)
  2. 네이버 블로그·카페 글 가져오기 (NAVER_CLIENT_ID/SECRET이 있을 때)
  3. AI로 진짜 공구 안내 글만 고르고 상품·가격·기간 뽑기
     (AI가 안 되면 글에서 날짜·가격을 직접 찾아서 씀)
  4. 어제까지 모은 목록과 합치고, 끝난 공구는 빼서 저장
  5. 새 공구가 있으면 카카오톡으로 알림

인스타그램은 로그인하지 않으면 해시태그 글을 볼 수 없어서
대신 가져와 주는 Apify 서비스를 씁니다. (월 5달러 무료 크레딧 안에서 돌도록 맞춤)
네이버 검색 API는 무료입니다. 둘 중 하나만 있어도 돌아갑니다.

카카오 토큰·Gemini 호출은 send_news.py 것을 그대로 씁니다.
GitHub Actions에서 매일 자동 실행됩니다.
"""

import os
import sys
import json
import re
import html
from datetime import date, datetime, timedelta

import requests

from send_news import (
    KST, TODAY, DOCS_DIR, PAGES_URL,
    log, call_gemini, refresh_kakao_token, update_github_secret,
)

# ─────────────────────────────────────────────────────────────
# 설정 — 찾고 싶은 공구가 바뀌면 여기만 고치면 됩니다
# ─────────────────────────────────────────────────────────────

# 인스타그램에서 볼 해시태그 (# 없이). 하나당 하루 RESULTS_PER_TAG개씩 가져옵니다.
# 글 하나에 약 0.0026달러 → 3개 × 15개 × 30일 ≈ 월 3.5달러 (무료 크레딧 5달러 안)
HASHTAGS = ["육아공구", "아기공구", "유아공구"]
RESULTS_PER_TAG = 15
APIFY_MAX_USD = 0.15     # 한 번 실행에 이 금액을 넘으면 Apify가 알아서 멈춥니다

# 네이버 블로그·카페에서 찾을 검색어 (무료, 하루 25,000번까지)
NAVER_QUERIES = ["육아 공구 오픈", "아기 공구 오픈", "유아 공동구매"]
NAVER_PER_QUERY = 20

FRESH_DAYS = 10          # 이보다 오래된 글은 가져오지 않음
NO_END_KEEP_DAYS = 7     # 마감일을 못 찾은 공구는 올라온 뒤 며칠 동안 보여줄지
AI_BATCH = 25            # AI에게 한 번에 보여줄 글 수

CATEGORIES = [
    "아기옷·신발", "장난감·교구", "책·학습", "수유·위생", "먹거리",
    "가구·침구", "외출용품", "주방·생활", "엄마 뷰티·패션", "기타",
]

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "").strip()
NAVER_ID = os.environ.get("NAVER_CLIENT_ID", "").strip()
NAVER_SECRET = os.environ.get("NAVER_CLIENT_SECRET", "").strip()

OUT_DIR = os.path.join(DOCS_DIR, "gonggu", "data")
DEALS_FILE = os.path.join(OUT_DIR, "deals.json")
SEEN_FILE = os.path.join(OUT_DIR, "seen.json")

TODAY_D = TODAY.date()
TODAY_STR = TODAY_D.isoformat()


# ─────────────────────────────────────────────────────────────
# 1. 인스타그램 (Apify)
# ─────────────────────────────────────────────────────────────

def fetch_instagram():
    """해시태그 글을 가져온다. 설정이 없거나 실패하면 None."""
    if not APIFY_TOKEN:
        log("APIFY_TOKEN이 없어 인스타그램은 건너뜁니다.")
        return None
    log(f"인스타그램 #{' #'.join(HASHTAGS)} 가져오는 중... (1~3분)")
    try:
        res = requests.post(
            "https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items",
            params={"maxTotalChargeUsd": APIFY_MAX_USD},
            headers={"Authorization": f"Bearer {APIFY_TOKEN}"},
            json={"hashtags": HASHTAGS, "resultsType": "posts",
                  "resultsLimit": RESULTS_PER_TAG},
            timeout=320,
        )
    except requests.RequestException as e:
        log(f"  인스타그램 가져오기 실패: {e}")
        return None
    if res.status_code not in (200, 201):
        log(f"  인스타그램 가져오기 실패 ({res.status_code}): {res.text[:300]}")
        log("  → Apify 이번 달 사용 한도를 넘었거나 토큰이 틀렸을 수 있어요. "
            "console.apify.com → Billing 에서 확인하세요. (한도는 다음 달 사용 기간이 시작되면 풀립니다)")
        return None

    posts = []
    for it in res.json():
        code = it.get("shortCode")
        text = (it.get("caption") or "").strip()
        if not code or not text:
            continue      # 실패한 해시태그는 오류 항목으로 들어옴
        owner = it.get("ownerUsername") or ""
        posts.append({
            "id": f"ig:{code}",
            "src": "insta",
            "url": it.get("url") or f"https://www.instagram.com/p/{code}/",
            "seller": f"@{owner}" if owner else "",
            "text": text,
            "posted": to_kst_date(it.get("timestamp")),
        })
    log(f"  인스타그램 글 {len(posts)}개")
    return posts


def to_kst_date(ts):
    """'2026-10-05T03:21:00.000Z' → 한국 날짜 '2026-10-05'. 못 읽으면 오늘."""
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt.astimezone(KST).date().isoformat()
    except ValueError:
        return TODAY_STR


# ─────────────────────────────────────────────────────────────
# 2. 네이버 블로그·카페
# ─────────────────────────────────────────────────────────────

def clean_naver(s):
    """검색 결과의 <b> 태그와 &quot; 같은 글자를 없앤다."""
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def fetch_naver():
    """검색어로 블로그·카페 최신 글을 가져온다. 설정이 없거나 다 실패하면 None."""
    if not (NAVER_ID and NAVER_SECRET):
        log("NAVER_CLIENT_ID/SECRET이 없어 네이버는 건너뜁니다.")
        return None
    log("네이버 블로그·카페 검색 중...")
    posts, ok = [], False
    for kind, src in (("blog", "blog"), ("cafearticle", "cafe")):
        for q in NAVER_QUERIES:
            try:
                res = requests.get(
                    f"https://openapi.naver.com/v1/search/{kind}.json",
                    params={"query": q, "display": NAVER_PER_QUERY, "sort": "date"},
                    headers={"X-Naver-Client-Id": NAVER_ID,
                             "X-Naver-Client-Secret": NAVER_SECRET},
                    timeout=20,
                )
            except requests.RequestException as e:
                log(f"  네이버 {kind} '{q}' 실패: {e}")
                continue
            if res.status_code != 200:
                log(f"  네이버 {kind} '{q}' 실패 ({res.status_code}): {res.text[:200]}")
                continue
            ok = True
            for it in res.json().get("items", []):
                link = it.get("link") or ""
                title = clean_naver(it.get("title"))
                if not link or not title:
                    continue
                pd = it.get("postdate") or ""          # 블로그만 있음 (YYYYMMDD)
                posted = f"{pd[:4]}-{pd[4:6]}-{pd[6:8]}" if len(pd) == 8 else TODAY_STR
                posts.append({
                    "id": f"{'nb' if src == 'blog' else 'nc'}:{link.split('://', 1)[-1]}",
                    "src": src,
                    "url": link,
                    "seller": clean_naver(it.get("bloggername") or it.get("cafename")),
                    "text": f"{title}\n{clean_naver(it.get('description'))}",
                    "posted": posted,
                })
    if not ok:
        log("  → 네이버 키가 틀렸거나, 네이버 개발자센터 애플리케이션에 '검색' API가 "
            "추가돼 있지 않을 수 있어요.")
        return None
    log(f"  네이버 글 {len(posts)}개")
    return posts


# ─────────────────────────────────────────────────────────────
# 3. 글에서 정보 뽑기 — AI가 없어도 돌아가는 기본 규칙
# ─────────────────────────────────────────────────────────────

# 10/7, 10.7, 10월 7일, 2026.10.07
_D = r"(?:(20\d{2})\s*[./-]\s*)?(\d{1,2})\s*(?:[./]|월\s*)(\d{1,2})(?![\d,%])\s*일?"
# (화), 화요일
_DOW = r"\s*(?:\(\s*[월화수목금토일]\s*\)|[월화수목금토일]요일)?"
# 오전 10시, 20:00, 밤 11시 59분
_TIME = (r"(?:\s*(?:오전|오후|낮|밤|저녁|아침|AM|PM|am|pm)?\s*"
         r"\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분)?))?")
_TILDE = r"\s*(?:부터)?\s*[~∼〜\-–—]\s*"

RANGE_RE = re.compile(_D + _DOW + _TIME + _TILDE + r"(?:" + _D + r"|(\d{1,2})\s*일)")
END_RE = re.compile(r"[~∼〜]\s*" + _D + r"|" + _D + _DOW + _TIME
                    + r"\s*(?:까지|마감|자정|종료)")
START_RE = re.compile(_D + _DOW + _TIME + r"\s*(?:오픈|OPEN|Open|open|시작)")

PRICE_RE = re.compile(r"(?:공구가|공구\s*가격|특가|할인가|혜택가|최종가)\s*[:：]?[^\d\n]{0,8}"
                      r"(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원")
PERCENT_RE = re.compile(r"(최대\s*)?(\d{1,2})\s*%\s*(?:할인|OFF|off|세일|SALE|sale)")

NOT_DEAL_RE = re.compile(r"후기|리뷰|언박싱|완판|마감\s*(?:감사|되었|됐|했)|종료\s*(?:감사|되었|됐)|"
                         r"(?:인플루언서|셀러|체험단|판매자)\s*모집")

CAT_WORDS = {
    "아기옷·신발": "내복|바디수트|우주복|아기옷|아동복|유아복|신발|양말|잠옷|파자마|점퍼|패딩|수영복|래시가드|턱받이",
    "장난감·교구": "장난감|교구|블록|퍼즐|놀잇감|인형|자석|보드게임|레고|촉감|원목",
    "책·학습": "전집|그림책|도서|동화|학습지|워크북|한글|영어|세이펜|책\\b",
    "수유·위생": "젖병|분유|수유|기저귀|물티슈|로션|베이비크림|샴푸|바스|세제|치약|칫솔|빨대컵|쪽쪽이|소독|체온계",
    "먹거리": "이유식|간식|과일|한우|고기|쌀|떡|과자|주스|유산균|영양제|반찬|밀키트|고구마|사과|귤|김치",
    "가구·침구": "매트|침대|범퍼|이불|베개|책상|의자|수납|가구|커튼|러그|매트리스|토퍼",
    "외출용품": "유모차|카시트|아기띠|힙시트|웨건|킥보드|자전거|기저귀가방|외출",
    "주방·생활": "식기|주방|냄비|프라이팬|도마|청소|가습기|건조기|공기청정|정수기|수건|생활용품",
    "엄마 뷰티·패션": "화장품|스킨케어|세럼|선크림|쿠션|마스크팩|가디건|니트|코트|여성복|맘룩",
}

EMOJI_RE = re.compile("[\U00010000-\U0010FFFF☀-➿⬀-⯿️‍←-⇿]")


def make_date(y, m, d, posted):
    """연도가 없으면 글 올린 날 기준으로 가장 가까운 날짜로 맞춘다."""
    try:
        m, d = int(m), int(d)
        base = date.fromisoformat(posted)
        if y:
            return date(int(y), m, d)
        dt = date(base.year, m, d)
        if dt < base - timedelta(days=180):     # 12월 글에 적힌 1월
            dt = date(base.year + 1, m, d)
        elif dt > base + timedelta(days=180):   # 1월 글에 적힌 12월
            dt = date(base.year - 1, m, d)
        return dt
    except (TypeError, ValueError):
        return None


def first_date(groups, posted):
    """정규식 그룹들 중 처음 채워진 (연, 월, 일) 세 칸을 날짜로."""
    for i in range(0, len(groups) - 2, 3):
        if groups[i + 1] and groups[i + 2]:
            return make_date(groups[i], groups[i + 1], groups[i + 2], posted)
    return None


def find_dates(text, posted):
    """글에서 공구 시작일·마감일을 찾는다. 못 찾으면 빈 문자열."""
    start = end = None
    m = RANGE_RE.search(text)
    if m:
        g = m.groups()
        start = make_date(g[0], g[1], g[2], posted)
        if g[4] and g[5]:
            end = make_date(g[3], g[4], g[5], posted)
        elif g[6] and start:                       # 10월 7일 ~ 10일
            end = make_date(start.year, start.month, g[6], posted)
        if start and end and end < start:
            start = end = None
    if not end:
        m = END_RE.search(text)
        if m:
            end = first_date(m.groups(), posted)
    if not start:
        m = START_RE.search(text)
        if m:
            start = first_date(m.groups(), posted)
    if start and end and end < start:
        start = None
    return (start.isoformat() if start else "", end.isoformat() if end else "")


def find_price(text):
    m = PRICE_RE.search(text)
    if m:
        return f"{m.group(1)}원"
    m = PERCENT_RE.search(text)
    if m:
        return f"{'최대 ' if m.group(1) else ''}{m.group(2)}% 할인"
    return ""


def guess_category(text):
    scores = {cat: len(re.findall(words, text)) for cat, words in CAT_WORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else "기타"


def guess_title(text):
    """첫 줄에서 해시태그·이모지·[공구] 같은 말머리를 빼고 상품 이름으로 쓴다."""
    for line in text.splitlines():
        s = EMOJI_RE.sub("", line)
        s = re.sub(r"[#@]\S+", "", s)
        s = re.sub(_D + _DOW + _TIME, "", s)
        s = re.sub(r"(?:오늘|내일|금일)?\s*(?:마감|까지|임박)\s*!*", "", s)
        s = re.sub(r"[\[【(<]?\s*공구\s*(?:오픈|예정|진행|중|안내|OPEN|open)?\s*[\]】)>]?", "", s)
        s = re.sub(r"\s+", " ", s).strip(" -_~|·:,.!/*♡♥★☆")
        if re.search(r"[가-힣A-Za-z]{2}", s):
            return s[:30]
    return ""


def basic_info(post):
    """AI 없이 정규식만으로 뽑은 정보."""
    text = post["text"]
    start, end = find_dates(text, post["posted"])
    return {
        "deal": not NOT_DEAL_RE.search(text[:150]),
        "title": guess_title(text),
        "cat": guess_category(text),
        "price": find_price(text),
        "start": start,
        "end": end,
        "how": "",
    }


# ─────────────────────────────────────────────────────────────
# 4. AI로 공구 안내 글만 고르고 정보 뽑기
# ─────────────────────────────────────────────────────────────

PROMPT = """아래는 인스타그램·네이버 블로그·카페에서 '공구' 키워드로 모은 글입니다.
각 글이 "지금 참여할 수 있거나 곧 열리는 공동구매(공구) 안내 글"인지 판단하고,
맞으면 정보를 뽑아 주세요. 오늘은 {today} 입니다.

## 공구 안내 글이 아닌 것 (deal=false)
- 공구로 산 물건 후기·언박싱
- 이미 끝난 공구 (마감 감사 인사, 완판 안내)
- 공구를 진행할 인플루언서·판매자·체험단 모집
- 공구와 상관없는 글 (해시태그만 붙인 일상 글 등)

## 뽑을 정보 — 글에 없으면 빈 문자열. 절대 지어내지 마세요.
- title: 상품 이름. 브랜드가 있으면 앞에. 25자 이내. 여러 상품이면 대표 상품 + " 외"
- cat: 다음 중 하나 — {categories}
- price: 공구 가격 (예: "29,900원", "최대 40% 할인"). 정가 말고 공구가.
- start: 공구 시작일 YYYY-MM-DD
- end: 공구 마감일 YYYY-MM-DD
- how: 사는 방법 짧게 (예: "프로필 링크", "DM", "댓글", "카톡 채널", "스마트스토어")
- 날짜에 연도가 없으면 글 올린 날(posted)과 가장 가까운 연도로

글 하나도 빠짐없이, 받은 id 그대로 JSON 배열로만 답하세요:
[{{"id": "...", "deal": true, "title": "", "cat": "", "price": "", "start": "", "end": "", "how": ""}}]

## 글 목록
{posts}
"""

def valid_iso(val):
    """'2026-10-07'처럼 실제로 있는 날짜인가 ('2026-13-01' 같은 건 버림)"""
    try:
        return date.fromisoformat(val).isoformat() == val
    except ValueError:
        return False


def ask_ai(batch):
    """글 묶음을 AI에게 보여주고 {id: 정보}를 돌려준다. 실패하면 빈 dict."""
    lines = "\n".join(json.dumps({"id": p["id"], "posted": p["posted"],
                                  "text": p["text"][:800]}, ensure_ascii=False)
                      for p in batch)
    prompt = PROMPT.format(today=TODAY_STR, categories=", ".join(CATEGORIES), posts=lines)
    for attempt in range(1, 3):
        try:
            raw = call_gemini(prompt)
            data = json.loads(raw)
            if isinstance(data, dict):      # {"items": [...]} 처럼 감싸서 줄 때
                data = next((v for v in data.values() if isinstance(v, list)), [])
            return {str(d.get("id")): d for d in data if isinstance(d, dict)}
        except json.JSONDecodeError as e:
            log(f"  AI 응답이 JSON이 아님 (시도 {attempt}): {e}")
        except RuntimeError as e:           # 무료 한도 초과 등 — 다시 해도 안 됨
            log(f"  AI 호출 실패: {e}")
            break
    return {}


def merge_info(basic, ai):
    """AI가 뽑은 정보를 쓰되, 형식이 틀리거나 빈 칸은 기본 규칙 값으로 채운다."""
    if not ai:
        return basic
    info = dict(basic)
    info["deal"] = bool(ai.get("deal"))
    for key in ("title", "price", "how"):
        val = str(ai.get(key) or "").strip()
        if val:
            info[key] = val[:40]
    if ai.get("cat") in CATEGORIES:
        info["cat"] = ai["cat"]
    for key in ("start", "end"):
        val = str(ai.get(key) or "").strip()
        if valid_iso(val):
            info[key] = val
    if info["start"] and info["end"] and info["end"] < info["start"]:
        info["start"] = ""
    return info


def analyze(posts):
    """공구 안내 글만 골라 정보를 붙여서 돌려준다."""
    results = []
    for i in range(0, len(posts), AI_BATCH):
        batch = posts[i:i + AI_BATCH]
        log(f"AI로 글 분류 중... ({i + 1}~{i + len(batch)} / {len(posts)})")
        ai = ask_ai(batch)
        if not ai:
            log("  AI 없이 글에서 날짜·가격만 찾아서 씁니다.")
        for p in batch:
            info = merge_info(basic_info(p), ai.get(p["id"]))
            results.append((p, info))
    return results


# ─────────────────────────────────────────────────────────────
# 5. 저장 — 어제 목록과 합치고 끝난 공구 빼기
# ─────────────────────────────────────────────────────────────

def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def is_alive(d):
    """아직 보여줄 공구인가 — 마감일이 지나지 않았거나, 마감일을 모르면 올라온 지 7일 이내."""
    if d.get("end"):
        return d["end"] >= TODAY_STR
    return d["posted"] >= (TODAY_D - timedelta(days=NO_END_KEEP_DAYS)).isoformat()


def same_key(d):
    """같은 공구를 여러 번 올린 글을 하나로 보기 위한 열쇠."""
    title = re.sub(r"[^가-힣A-Za-z0-9]", "", d.get("title", "")).lower()
    return (d.get("seller", ""), title) if title else (d["id"],)


def make_deal(post, info):
    text = re.sub(r"\n{3,}", "\n\n", post["text"]).strip()
    end = info["end"]
    # 올린 날보다 45일 넘게 뒤인 마감일은 잘못 읽었을 가능성이 커서 버린다
    if end and end > (date.fromisoformat(post["posted"]) + timedelta(days=45)).isoformat():
        end = ""
    return {
        "id": post["id"],
        "src": post["src"],
        "url": post["url"],
        "seller": post["seller"],
        "title": info["title"] or "공구 안내",
        "cat": info["cat"],
        "price": info["price"],
        "start": info["start"],
        "end": end,
        "how": info["how"],
        "text": text[:400] + ("…" if len(text) > 400 else ""),
        "posted": post["posted"],
        "found": TODAY_STR,
    }


def main():
    insta = fetch_instagram()
    naver = fetch_naver()
    if insta is None and naver is None:
        print(f"""
{'!' * 62}
  공구 글을 가져올 곳이 하나도 없습니다.

  GitHub 저장소 → Settings → Secrets and variables → Actions 에서
  아래 둘 중 하나 이상을 등록해 주세요. (둘 다 있으면 제일 좋아요)

  · 인스타그램: APIFY_TOKEN
      apify.com 가입 → Settings → API & Integrations 의 토큰
  · 네이버(무료): NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
      developers.naver.com → 애플리케이션 등록 → 사용 API '검색'

  이미 등록했다면 위 로그에서 실패 이유를 확인해 주세요.
{'!' * 62}
""", flush=True)
        sys.exit(1)

    old = load_json(DEALS_FILE, {"items": []})
    seen = load_json(SEEN_FILE, {})
    cutoff = (TODAY_D - timedelta(days=FRESH_DAYS)).isoformat()

    # 처음 보는 글, 최근 글, '공구' 말이 들어간 글만 AI에게 보낸다
    fresh, ids = [], set()
    for p in (insta or []) + (naver or []):
        if p["id"] in seen or p["id"] in ids or p["posted"] < cutoff:
            continue
        if not re.search(r"공구|공동구매", p["text"]):
            continue
        ids.add(p["id"])
        fresh.append(p)
    log(f"새로 볼 글 {len(fresh)}개")

    deals = [d for d in old.get("items", []) if is_alive(d)]
    keys = {same_key(d) for d in deals}
    new = []
    for post, info in analyze(fresh):
        seen[post["id"]] = TODAY_STR
        if not info["deal"]:
            continue
        d = make_deal(post, info)
        if not is_alive(d) or same_key(d) in keys:
            continue
        keys.add(same_key(d))
        deals.append(d)
        new.append(d)
    log(f"새 공구 {len(new)}개 / 전체 {len(deals)}개 (끝난 공구 "
        f"{len(old.get('items', [])) - (len(deals) - len(new))}개 정리)")

    status = lambda r, on: "ok" if r is not None else ("error" if on else "off")
    deals.sort(key=lambda d: (d["found"], d["posted"]), reverse=True)
    out = {
        "updated": TODAY.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "sources": {"insta": status(insta, APIFY_TOKEN),
                    "naver": status(naver, NAVER_ID and NAVER_SECRET)},
        "hashtags": HASHTAGS,
        "items": deals,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(DEALS_FILE, "w", encoding="utf-8") as f:
        f.write(dump_items(out))
    # 한 달 지난 글 기록은 지운다 (그때쯤이면 FRESH_DAYS에 걸려 다시 안 들어옴)
    month_ago = (TODAY_D - timedelta(days=30)).isoformat()
    seen = {k: v for k, v in seen.items() if v >= month_ago}
    with open(SEEN_FILE, "w", encoding="utf-8") as f:
        json.dump(seen, f, ensure_ascii=False, indent=0, sort_keys=True)
    log(f"저장: {DEALS_FILE}")

    if new:
        try:
            send_kakao(new, deals)
        except Exception as e:   # 알림이 실패해도 모은 목록은 저장되도록
            log(f"카카오톡 알림 실패 (목록은 저장됨): {e}")
    else:
        log("새 공구가 없어 카카오톡은 보내지 않습니다.")
    log("전부 완료!")


def dump_items(out):
    """공구 하나를 한 줄에 — 날마다 바뀐 부분을 GitHub에서 보기 쉽게."""
    head = {k: v for k, v in out.items() if k != "items"}
    body = ",\n".join(json.dumps(d, ensure_ascii=False) for d in out["items"])
    text = json.dumps(head, ensure_ascii=False)[:-1]
    return f'{text}, "items": [\n{body}\n]}}\n'


# ─────────────────────────────────────────────────────────────
# 6. 카카오톡 알림
# ─────────────────────────────────────────────────────────────

def short_date(iso):
    d = date.fromisoformat(iso)
    return f"{d.month}/{d.day}"


def send_kakao(new, deals):
    """새 공구 몇 개를 마감 빠른 순으로. 기본 텍스트 템플릿은 200자 제한이다."""
    page_url = f"{PAGES_URL}/gonggu/" if PAGES_URL else "https://www.instagram.com"
    closing = sum(1 for d in deals if d["end"] == TODAY_STR)
    head = f"🛒 새 공구 {len(new)}개" + (f" · 오늘 마감 {closing}개" if closing else "")

    lines = []
    for d in sorted(new, key=lambda d: d["end"] or "9999"):
        when = f" (~{short_date(d['end'])})" if d["end"] else ""
        line = f"· {d['title'][:22]}{when}"
        if len(head) + sum(len(x) + 1 for x in lines) + len(line) + len(page_url) + 6 > 195:
            break
        lines.append(line)
    text = "\n\n".join([head, "\n".join(lines), page_url])[:200]

    access_token, new_refresh = refresh_kakao_token()
    if new_refresh:
        update_github_secret("KAKAO_REFRESH_TOKEN", new_refresh)

    template = {
        "object_type": "text",
        "text": text,
        "link": {"web_url": page_url, "mobile_web_url": page_url},
        "button_title": "공구 모아 보기",
    }
    log("카카오톡 발송 중...")
    res = requests.post(
        "https://kapi.kakao.com/v2/api/talk/memo/default/send",
        headers={"Authorization": f"Bearer {access_token}"},
        data={"template_object": json.dumps(template, ensure_ascii=False)},
        timeout=20,
    )
    if res.status_code != 200:
        raise RuntimeError(f"카카오톡 발송 실패 ({res.status_code}): {res.text}")
    log("카카오톡 발송 완료")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"오류: {e}")
        sys.exit(1)
