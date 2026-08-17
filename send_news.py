#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
매일 아침 9살 아이용 영어 기사를 만들어서 카카오톡 "나와의 채팅"으로 보냅니다.

동작 순서:
  1. 카카오 refresh token으로 access token 발급
  2. DOGOnews에서 아직 안 쓴 최신 기사 하나 고르기
  3. AI로 아이용(영어) + 엄마용(한국어) 자료 만들기
  4. HTML 페이지로 저장 (GitHub Pages로 공개됨)
  5. 카카오톡으로 제목 + 요약 + 링크 발송
  6. 카카오 refresh token이 갱신됐으면 GitHub Secret 자동 업데이트

GitHub Actions에서 매일 자동 실행됩니다.
"""

import os
import sys
import json
import re
import html
import time
from datetime import datetime, timezone, timedelta

import requests
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────

KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST)
DATE_STR = TODAY.strftime("%Y-%m-%d")


def need(name):
    """필수 Secret을 읽는다. 없으면 알아보기 쉬운 메시지로 종료."""
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"""
{'!' * 62}
  Secret '{name}' 이(가) 비어 있습니다.

  GitHub 저장소 → Settings → Secrets and variables → Actions 에서
  이름이 '{name}' 인 Secret이 등록돼 있는지 확인하세요.
  대소문자와 밑줄(_)까지 정확히 같아야 합니다.
{'!' * 62}
""", flush=True)
        sys.exit(1)
    return value


KAKAO_REST_API_KEY = need("KAKAO_REST_API_KEY")
KAKAO_REFRESH_TOKEN = need("KAKAO_REFRESH_TOKEN")
GEMINI_API_KEY = need("GEMINI_API_KEY")

# 선택 사항 — 있으면 토큰 자동 갱신, 없으면 만료 시 알림만
GH_PAT = os.environ.get("GH_PAT", "").strip()
GH_REPO = os.environ.get("GITHUB_REPOSITORY", "").strip()   # "사용자명/저장소명"

# GitHub Pages 주소는 저장소 이름에서 자동으로 만듭니다 (따로 설정할 필요 없음)
PAGES_URL = os.environ.get("PAGES_URL", "").strip().rstrip("/")
if not PAGES_URL and "/" in GH_REPO:
    _owner, _repo = GH_REPO.split("/", 1)
    PAGES_URL = f"https://{_owner.lower()}.github.io/{_repo}"

DOCS_DIR = "docs"
HISTORY_FILE = os.path.join(DOCS_DIR, "history.json")

# 구글 Gemini 무료 등급을 씁니다. 하루 250~1,500건 무료인데 우리는 하루 1건.
# 앞의 모델이 안 되면 뒤 것을 차례로 시도합니다. (모델 이름은 가끔 바뀝니다)
GEMINI_MODELS = [
    "gemini-flash-latest",
    "gemini-pro-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
]

UA = {"User-Agent": "Mozilla/5.0 (compatible; DailyEnglishNews/1.0)"}


def log(msg):
    print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] {msg}", flush=True)


# ─────────────────────────────────────────────────────────────
# 1. 카카오 토큰
# ─────────────────────────────────────────────────────────────

def refresh_kakao_token():
    """refresh token으로 access token을 발급받는다.

    카카오는 refresh token의 남은 유효기간이 1개월 미만일 때만
    새 refresh token을 함께 내려준다. 그때는 저장해둬야 한다.
    """
    log("카카오 access token 발급 중...")
    res = requests.post(
        "https://kauth.kakao.com/oauth/token",
        data={
            "grant_type": "refresh_token",
            "client_id": KAKAO_REST_API_KEY,
            "refresh_token": KAKAO_REFRESH_TOKEN,
        },
        timeout=20,
    )
    if res.status_code != 200:
        raise RuntimeError(
            f"카카오 토큰 발급 실패 ({res.status_code}): {res.text}\n"
            "→ KAKAO_REFRESH_TOKEN이 만료됐을 수 있어요. "
            "get_token.ps1을 다시 실행해서 새 토큰을 받아 Secret에 넣어주세요."
        )
    data = res.json()
    access_token = data["access_token"]
    new_refresh = data.get("refresh_token")  # 없으면 None (정상)
    if new_refresh:
        log("카카오가 새 refresh token을 발급했습니다. 저장을 시도합니다.")
    return access_token, new_refresh


def update_github_secret(name, value):
    """GitHub Secret을 자동으로 갱신한다. GH_PAT이 없으면 건너뛴다."""
    if not (GH_PAT and GH_REPO):
        log("GH_PAT이 없어 Secret 자동 갱신을 건너뜁니다. (수동 갱신 필요)")
        return False
    try:
        from nacl import encoding, public
    except ImportError:
        log("PyNaCl이 없어 Secret 자동 갱신 실패")
        return False

    headers = {
        "Authorization": f"Bearer {GH_PAT}",
        "Accept": "application/vnd.github+json",
    }
    key_res = requests.get(
        f"https://api.github.com/repos/{GH_REPO}/actions/secrets/public-key",
        headers=headers, timeout=20,
    )
    if key_res.status_code != 200:
        log(f"Secret 공개키 조회 실패: {key_res.status_code} {key_res.text}")
        return False
    key_data = key_res.json()

    pk = public.PublicKey(key_data["key"].encode(), encoding.Base64Encoder())
    encrypted = public.SealedBox(pk).encrypt(value.encode())
    import base64
    encrypted_b64 = base64.b64encode(encrypted).decode()

    put_res = requests.put(
        f"https://api.github.com/repos/{GH_REPO}/actions/secrets/{name}",
        headers=headers,
        json={"encrypted_value": encrypted_b64, "key_id": key_data["key_id"]},
        timeout=20,
    )
    ok = put_res.status_code in (201, 204)
    log(f"Secret 갱신 {'성공' if ok else '실패 ' + str(put_res.status_code)}")
    return ok


# ─────────────────────────────────────────────────────────────
# 2. 기사 고르기
# ─────────────────────────────────────────────────────────────

# 아침에 아이와 읽기 부적절한 주제
# 주의: 단어 단위로 정확히 비교합니다. 부분 문자열로 비교하면
#       penguin 안의 "gun", award 안의 "war" 때문에 좋은 기사가 걸러집니다.
BAD_WORDS = {
    "war", "wars", "guns", "shooting", "shot", "kill", "killed", "killing",
    "death", "deaths", "died", "dead", "murder", "attack", "attacks",
    "bomb", "bombing", "terror", "crime", "arrest", "arrested",
    "wildfire", "wildfires", "fire", "fires", "disaster", "hurricane",
    "earthquake", "flood", "floods", "crash", "crashes", "election",
    "president", "protest", "protests", "abuse", "drug", "drugs",
    "missile", "conflict", "victim", "victims", "injured", "wounded",
    "violence", "shooter", "invasion", "troops", "refugee", "refugees",
}


def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"used_urls": [], "issues": []}


def save_history(hist):
    os.makedirs(DOCS_DIR, exist_ok=True)
    hist["used_urls"] = hist["used_urls"][-120:]  # 최근 120개만 유지
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=2)


def _dogonews_candidates(used):
    """DOGOnews 첫 화면에서 안 쓴 기사 목록을 뽑는다."""
    res = requests.get("https://www.dogonews.com/", headers=UA, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not re.search(r"/\d{4}/\d{1,2}/\d{1,2}/", href):
            continue
        url = href if href.startswith("http") else "https://www.dogonews.com" + href
        if url in seen or url in used:
            continue
        seen.add(url)

        slug_words = set(url.rsplit("/", 1)[-1].lower().split("-"))
        hits = slug_words & BAD_WORDS
        if hits:
            log(f"  건너뜀 (부적절 주제: {', '.join(hits)})")
            continue
        out.append(url)
    return out


def _newsround_candidates(used):
    """BBC Newsround에서 안 쓴 기사 목록을 뽑는다.

    DOGOnews는 주 2~3편뿐이라 재고가 자주 바닥난다.
    Newsround는 매일 올라와서 빈 날을 메워준다.
    """
    res = requests.get("https://www.bbc.co.uk/newsround", headers=UA, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/newsround/" not in href or not re.search(r"/\d{7,9}", href):
            continue
        url = href if href.startswith("http") else "https://www.bbc.co.uk" + href
        url = url.split("?")[0]
        if url in seen or url in used:
            continue
        seen.add(url)

        slug_words = set(re.split(r"[-/]", url.lower()))
        hits = slug_words & BAD_WORDS
        if hits:
            log(f"  건너뜀 (부적절 주제: {', '.join(hits)})")
            continue
        out.append(url)
    return out


def pick_article(history):
    """기사를 고른다. DOGOnews를 먼저 보고, 없으면 BBC Newsround."""
    used = set(history.get("used_urls", []))

    log("DOGOnews에서 기사 목록 가져오는 중...")
    try:
        candidates = _dogonews_candidates(used)
    except Exception as e:
        log(f"  DOGOnews 실패: {e}")
        candidates = []

    if candidates:
        log(f"후보 {len(candidates)}개 중 첫 번째 선택")
        return candidates[0]

    log("DOGOnews에 새 기사가 없어 BBC Newsround로 넘어갑니다...")
    try:
        candidates = _newsround_candidates(used)
    except Exception as e:
        log(f"  Newsround 실패: {e}")
        candidates = []

    if not candidates:
        raise RuntimeError("두 곳 모두에서 쓸 만한 새 기사를 찾지 못했습니다.")

    log(f"Newsround 후보 {len(candidates)}개 중 첫 번째 선택")
    return candidates[0]


# 저작권 걱정 없이 쓸 수 있는 사진의 출처 표기
# (미국 정부 저작물은 저작권 자체가 없습니다)
PUBLIC_DOMAIN_HINTS = [
    "public domain", "publicdomain",
    "nasa", "noaa", "usgs", "nps.gov", "national park service",
    "u.s. air force", "u.s. navy", "u.s. army", "usda",
    "library of congress", "smithsonian open access",
    "creative commons", "cc by", "cc-by", "cc0",
    "wikimedia", "wikipedia", "flickr",
]


def find_video(page_html):
    """기사 본문의 유튜브 영상 하나를 찾는다.

    페이지에는 사이드바·추천 영상까지 여러 개가 들어있는데,
    기사 영상은 출처 표기('Resources:') 바로 아래에 붙는다.
    그래서 Resources 직후 5000자 안에서 찾은 첫 영상만 인정한다.
    """
    cutoff = page_html.find("Resources:")
    if cutoff < 0:
        return None

    for m in re.finditer(r"embed/([A-Za-z0-9_-]{11})", page_html):
        if cutoff < m.start() < cutoff + 5000:
            log(f"  영상 발견: {m.group(1)}")
            return m.group(1)
    return None


def find_video_browser(url):
    """진짜 브라우저로 페이지를 그려서 기사 본문의 영상을 찾는다.

    DOGOnews는 영상을 자바스크립트로 나중에 끼워넣기 때문에
    원본 HTML만 봐서는 어느 영상이 기사 것인지 알 수 없다.
    그래서 브라우저로 페이지를 실제로 그린 뒤,
    '기사 본문 영역(왼쪽 컬럼, 제목 아래 ~ 출처 표기 근처)'에
    나타난 유튜브 영상만 골라낸다. 오른쪽 사이드바 추천 영상은 제외.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("  playwright 없음 — 영상 찾기 건너뜀")
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1500)

            # 천천히 끝까지 스크롤해서 지연 로딩(lazy load)을 깨운다
            for _ in range(14):
                page.mouse.wheel(0, 900)
                page.wait_for_timeout(350)
            page.wait_for_timeout(1200)

            data = page.evaluate("""() => {
                const out = {vids: [], h1y: 0, resY: null};
                const h1 = document.querySelector('h1');
                if (h1) out.h1y = h1.getBoundingClientRect().top + scrollY;

                const walker = document.createTreeWalker(
                    document.body, NodeFilter.SHOW_TEXT);
                let n;
                while ((n = walker.nextNode())) {
                    if (n.textContent.includes('Resources:')) {
                        out.resY = n.parentElement
                            .getBoundingClientRect().top + scrollY;
                        break;
                    }
                }

                document.querySelectorAll('iframe').forEach(f => {
                    const m = (f.src || '').match(/embed\\/([A-Za-z0-9_-]{11})/);
                    if (!m) return;
                    const r = f.getBoundingClientRect();
                    out.vids.push({id: m[1],
                                   x: r.left + scrollX,
                                   y: r.top + scrollY,
                                   w: r.width});
                });
                return out;
            }""")
            browser.close()
    except Exception as e:
        log(f"  브라우저 영상 찾기 실패(건너뜀): {e}")
        return None

    vids = data.get("vids") or []
    h1y = data.get("h1y") or 0
    res_y = data.get("resY")
    y_limit = (res_y + 1000) if res_y else None

    log(f"  화면에 그려진 영상 {len(vids)}개")
    for v in vids:
        in_main_column = v["x"] < 900 and v["w"] > 300
        below_title = v["y"] > h1y
        in_article = (y_limit is None) or (v["y"] < y_limit)
        if in_main_column and below_title and in_article:
            log(f"  기사 영상 발견: {v['id']}")
            return v["id"]

    log("  기사 본문 영역에 영상 없음")
    return None


def find_free_image(soup):
    """출처가 퍼블릭 도메인인 사진만 골라서 가져온다.

    AP·로이터 같은 유료 사진은 재사용 권한이 없으므로 건너뛴다.
    """
    for img in soup.find_all("img"):
        src = img.get("src") or ""
        if "cdn" not in src or not src.startswith("http"):
            continue

        # 사진 바로 뒤의 설명글에서 출처를 찾는다
        caption = ""
        node = img
        for _ in range(4):
            node = node.find_next(["em", "figcaption", "p", "span"])
            if node is None:
                break
            text = node.get_text(" ", strip=True)
            if "credit" in text.lower() or "©" in text:
                caption = text
                break

        if not caption:
            continue

        low = caption.lower()
        if any(hint in low for hint in PUBLIC_DOMAIN_HINTS):
            log(f"  퍼블릭 도메인 사진 발견: {caption[:70]}")
            return {"src": src, "caption": caption}

    log("  쓸 수 있는 사진 없음 (저작권 있는 사진은 건너뜁니다)")
    return None


def fetch_article(url):
    log(f"기사 읽는 중: {url}")
    res = requests.get(url, headers=UA, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    title = soup.find("h1")
    title = title.get_text(strip=True) if title else "Today's News"

    paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
    body = "\n".join(p for p in paragraphs if len(p) > 60)

    if len(body) < 200:
        raise RuntimeError("기사 본문을 제대로 읽지 못했습니다.")

    video = find_video_browser(url)
    image = find_free_image(soup)

    return {
        "title": title,
        "body": body[:6000],
        "url": url,
        "video": video,
        "image": image,
    }


# ─────────────────────────────────────────────────────────────
# 3. AI로 내용 만들기
# ─────────────────────────────────────────────────────────────

PROMPT = """당신은 한국에 사는 9살(초등 3학년) 아이를 위한 영어 학습 자료를 만듭니다.
아이는 영어를 배우는 중이고, 수준은 CEFR A1~A2입니다.
아침에 5분 안에 읽을 분량이어야 합니다.

자료는 두 부분으로 나뉩니다.
  · 아이가 보는 면 — 100% 영어. 한국어가 한 글자도 들어가면 안 됩니다.
  · 엄마가 보는 면 — 한국어. 아이를 도와주기 위한 참고용입니다.

아래 원문 기사를 바탕으로 만드세요.

<원문>
제목: {title}

{body}
</원문>

다음 JSON 형식으로만 답하세요. 다른 말은 쓰지 마세요.

{{
  "title_en": "쉬운 영어 제목 (8단어 이내)",
  "article_en": ["문단1", "문단2", "문단3", "문단4"],
  "words": [
    {{"en": "meteor",
      "def_en": "a small rock from space that burns and makes a bright line in the sky",
      "ko": "유성, 별똥별"}}
  ],
  "question_en": "아이에게 던질 영어 질문 1개",

  "title_ko": "한국어 제목",
  "summary_ko": "한국어 요약 2~3문장",
  "question_ko": "question_en의 한국어 번역",
  "tip_ko": "아이와 이 기사로 대화할 때 도움이 될 한 문장",

  "glossary": {{"tonight": "오늘 밤", "special": "특별한", "burn": "타다"}},

  "quiz": [
    {{"q": "Why do meteors make bright lines?",
      "choices": ["They are stars", "They burn in the air", "They are lights"],
      "answer": 1,
      "why_ko": "기사에 '공기와 부딪혀 타면서 빛이 난다'고 나와요."}}
  ]
}}

[아이용 규칙 — 여기엔 한국어 금지]
- article_en은 전체 합쳐서 반드시 **250~320 단어**. 문단은 5~7개.
  원문의 내용을 충분히 담으세요. 어떻게/왜에 해당하는 설명과
  구체적인 숫자·예시를 빼지 말고 넣으세요.
- **난이도 목표: Flesch-Kincaid 3.0~3.5 (미국 초등3학년)**. 이게 가장 중요합니다.
  · 평균 문장 길이를 **10~13단어**로 맞추세요. 너무 짧은 문장만 쓰지 마세요.
  · and, but, because, so, when, if 같은 연결어로 문장을 자연스럽게 엮으세요.
  · 2음절 이상 단어도 적당히 쓰세요 (important, discover, protect 같은 수준).
  · 너무 쉬우면(2.0 수준) 아이가 지루해합니다. 살짝 도전되게 쓰세요.
  문장은 여전히 짧고 쉽게 유지하면서, 내용을 더 자세히 담으세요.
  원문을 그대로 베끼지 말고 다시 쓰세요.
- words는 7~9개. 기사에 실제로 나온 단어만 고르세요.
- def_en(영영 뜻)이 이 자료의 핵심입니다. 아주 쉽게 쓰세요:
  · 9살이 이미 아는 단어로만 설명 (약 500개 기초 단어 수준)
  · 15단어 이내 한 문장
  · 설명하려는 단어 자체를 설명 안에 쓰지 마세요
  · 어려운 단어로 어려운 단어를 설명하지 마세요
  · 나쁜 예: "comet = a celestial body orbiting the sun"
  · 좋은 예: "comet = a big ball of ice and dust that moves around the sun"
- question_en은 정답이 없고 아이가 자기 생각을 말할 수 있는 질문 1개만.

[엄마용 규칙]
- summary_ko는 영어를 못 읽어도 내용을 알 수 있게.
- ko는 그 단어의 한국어 뜻 (엄마가 막혔을 때 참고용).
- tip_ko는 잔소리 말고 실용적으로. 예: "우리 동네에서도 보이니까 오늘 밤에 같이 나가보세요."

[glossary 규칙 — 중요]
아이가 기사를 읽다가 모르는 단어를 눌러보는 기능에 쓰입니다.
- article_en에 나온 단어를 **빠짐없이** 넣으세요. 하나도 빠뜨리지 마세요.
- 기사에 나온 **그 형태 그대로**를 키로 쓰세요. 소문자로 바꿔서.
  (예: 기사에 "meteors"가 있으면 키도 "meteors")
- 값은 **문맥에 맞는 한국어 뜻 하나만.** 짧게. 여러 뜻을 나열하지 마세요.
- a, an, the, is, are, of, to, in, on, and, or, but 같은 아주 기초적인 말은 빼도 됩니다.
- 동사는 원형 뜻이 아니라 그 자리에서 쓰인 뜻으로. (예: "left" → "남긴")

[quiz 규칙]
아이가 지문을 이해했는지 확인하는 객관식 문제 **3개**를 만듭니다.
- 질문과 보기는 **전부 영어.** 지문에 쓴 단어 수준을 넘지 마세요.
- 보기는 **3개씩.** answer는 정답 보기의 번호(0, 1, 2 중 하나).
- 답이 article_en 안에 분명히 있어야 합니다. 추측해야 하는 문제는 안 됩니다.
- 1번은 쉽게(사실 확인), 2번은 보통, 3번은 조금 생각해야 하게.
- why_ko는 **한국어 해설 한 문장.** 엄마가 아이한테 설명해줄 때 쓰는 것.
"""


def call_gemini(prompt):
    """Gemini 무료 등급 호출. 모델 이름이 바뀌었을 수 있으니 차례로 시도한다."""
    last_error = ""
    for model in GEMINI_MODELS:
        res = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": GEMINI_API_KEY,
                     "Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 8192,
                    # JSON 모드 — 문법이 깨진 JSON이 나오는 것을 막아준다
                    "responseMimeType": "application/json",
                },
            },
            timeout=60,
        )
        if res.status_code == 200:
            log(f"  ({model} 사용)")
            data = res.json()
            try:
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
            except (KeyError, IndexError):
                last_error = f"{model}: 응답 형식이 예상과 다름 — {str(data)[:300]}"
                continue

        if res.status_code == 404:
            log(f"  {model} 없음, 다음 모델 시도")
            last_error = f"{model}: 모델 없음"
            continue

        if res.status_code == 429:
            raise RuntimeError(
                "Gemini 무료 한도를 초과했습니다. 하루 뒤 자동으로 풀립니다.\n"
                "→ 하루 1건만 쓰는 구조라 보통 일어나지 않습니다. "
                "키가 다른 곳에서도 쓰이고 있는지 확인해보세요."
            )

        # 503(서버 혼잡) 등 — 이 모델은 포기하고 다음 모델을 시도한다
        last_error = f"{model}: {res.status_code} {res.text[:300]}"
        log(f"  {model} 응답 {res.status_code}, 다음 모델 시도")
        continue

    raise RuntimeError(
        f"Gemini 호출 실패 — {last_error}\n"
        "→ GEMINI_API_KEY가 올바른지 확인하세요. "
        "aistudio.google.com 에서 새로 발급받을 수 있습니다."
    )


def make_content(title, body):
    """AI 호출 + JSON 파싱. 실패하면 최대 3번까지 다시 시도한다."""
    last_error = None

    for attempt in range(1, 6):
        log(f"AI로 아이 수준 자료 만드는 중... (시도 {attempt}/3)")
        try:
            text = call_gemini(PROMPT.format(title=title, body=body))
        except Exception as e:
            last_error = e
            log(f"  AI 호출 실패({e}) — 20초 쉬었다가 다시 시도")
            time.sleep(20)
            continue
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            m = re.search(r"\{.*\}", text, re.S)
            if m:
                try:
                    data = json.loads(m.group(0))
                except json.JSONDecodeError:
                    last_error = e
                    log(f"  JSON 파싱 실패, 다시 시도합니다: {e}")
                    continue
            else:
                last_error = e
                log(f"  JSON 파싱 실패, 다시 시도합니다: {e}")
                continue

        # 필수 항목이 다 있는지 확인
        missing = [k for k in ("title_en", "article_en", "words", "question_en",
                               "title_ko", "summary_ko", "question_ko")
                   if not data.get(k)]
        if missing:
            last_error = RuntimeError(f"빠진 항목: {missing}")
            log(f"  항목이 빠졌습니다 {missing}, 다시 시도합니다")
            continue

        return data

    raise RuntimeError(f"5번 시도했지만 자료를 만들지 못했습니다: {last_error}")


# ─────────────────────────────────────────────────────────────
# 읽기 난이도 계산 (Flesch-Kincaid)
# ─────────────────────────────────────────────────────────────

def count_syllables(word):
    """영어 단어의 음절 수를 어림잡는다."""
    word = word.lower().strip(".,!?;:\"'()")
    if not word:
        return 0
    vowels = "aeiouy"
    count = 0
    prev_was_vowel = False
    for ch in word:
        is_vowel = ch in vowels
        if is_vowel and not prev_was_vowel:
            count += 1
        prev_was_vowel = is_vowel
    if word.endswith("e") and count > 1:
        count -= 1
    return max(1, count)


def reading_level(paragraphs):
    """Flesch-Kincaid 학년 수준을 계산한다.

    AR(ATOS) 지수와 계산 방식이 다르지만 대체로 비슷한 범위로 나온다.
    공식 AR 지수가 아니라 '문장 길이와 단어 길이로 낸 추정치'다.
    """
    text = " ".join(paragraphs)
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    words = [w for w in re.findall(r"[A-Za-z']+", text)]

    if not sentences or not words:
        return None

    syllables = sum(count_syllables(w) for w in words)
    wps = len(words) / len(sentences)
    spw = syllables / len(words)

    grade = 0.39 * wps + 11.8 * spw - 15.59
    grade = max(0.5, round(grade, 1))

    return {"grade": grade, "words": len(words), "sentences": len(sentences)}


# ─────────────────────────────────────────────────────────────
# 4. HTML 만들기
# ─────────────────────────────────────────────────────────────

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>오늘의 영어신문 — {date_en}</title>
<style>
  *{{box-sizing:border-box}}
  body{{font-family:"Malgun Gothic","맑은 고딕",-apple-system,BlinkMacSystemFont,sans-serif;
    max-width:680px;margin:0 auto;padding:32px 20px 60px;color:#1a1a1a;
    line-height:1.75;background:#fff;-webkit-text-size-adjust:100%}}
  .date{{font-size:13px;color:#888;letter-spacing:1px;margin-bottom:6px}}
  h1{{font-size:27px;line-height:1.35;margin:0 0 6px;letter-spacing:-0.5px}}
  .title-ko{{font-size:17px;color:#666;margin-bottom:24px;font-weight:500}}
  .meta-row{{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 20px}}
  .src-badge{{display:inline-block;background:#e8eef8;color:#2d4a7a;font-size:12px;
    padding:5px 11px;border-radius:20px;font-weight:700;white-space:nowrap}}
  .level{{display:inline-block;background:#1a1a1a;color:#fff;font-size:12px;
    padding:5px 11px;border-radius:20px;letter-spacing:0.3px;white-space:nowrap}}
  .src-link{{font-size:13px;color:#666;text-decoration:none;border-bottom:1px solid #ccc}}
  .orig-btn{{display:block;text-align:center;background:#2d6cdf;color:#fff;
    text-decoration:none;padding:15px;border-radius:8px;font-size:16px;font-weight:700;
    margin:4px 0 8px}}
  .orig-note{{font-size:12px;color:#888;line-height:1.6;margin:0 0 22px;text-align:center}}
  .hero{{width:100%;border-radius:8px;display:block;margin:0 0 6px}}
  .hero-cap{{font-size:11px;color:#999;line-height:1.5;margin:0 0 16px;text-align:center}}
  .vid-btn{{display:block;text-align:center;background:#c0392b;color:#fff;
    text-decoration:none;padding:15px;border-radius:8px;font-size:16px;font-weight:700;
    margin:0 0 10px}}
  .level-note{{background:#f8f8f6;padding:14px 16px;font-size:13px;color:#666;
    line-height:1.7;border-left:3px solid #ccc}}
  hr{{border:none;border-top:2px solid #1a1a1a;margin:0 0 28px}}
  h2{{font-size:15px;margin:36px 0 12px;padding-bottom:7px;border-bottom:1px solid #ddd;
    letter-spacing:1px;color:#555}}
  .article{{font-size:19px;line-height:2.0}}
  .article p{{margin:0 0 16px}}
  table{{width:100%;border-collapse:collapse;font-size:16px}}
  th{{text-align:left;background:#f5f5f5;padding:10px 12px;font-size:13px;color:#555;
    border-bottom:2px solid #ddd}}
  td{{padding:10px 12px;border-bottom:1px solid #eee}}
  td:first-child{{font-weight:700;width:32%}}
  td:nth-child(2){{color:#999;width:24%;font-size:14px}}
  .summary{{background:#f8f8f6;padding:20px;border-left:4px solid #1a1a1a;font-size:16px;
    line-height:1.9}}
  .question{{border:2px solid #1a1a1a;padding:22px;text-align:center}}
  .question .en{{font-size:19px;font-weight:700;line-height:1.5}}
  .say-btn{{float:right;font-family:inherit;font-size:12px;font-weight:700;
    background:#1a1a1a;color:#fff;border:none;border-radius:20px;padding:6px 14px;
    cursor:pointer;letter-spacing:0}}
  .say-btn.playing{{background:#c0392b}}
  .hint{{float:right;font-size:11px;color:#aaa;font-weight:400;letter-spacing:0;
    padding-top:4px}}
  .words-def{{font-size:16px;column-count:2;column-gap:26px}}
  .words-def dt,.words-def dd{{break-inside:avoid}}
  .words-def dt{{font-weight:700;margin-top:14px;cursor:pointer;display:inline-block;
    border-bottom:2px dotted #bbb}}
  .words-def dt:active{{color:#c0392b}}
  .words-def dd{{margin:2px 0 0;padding-left:0;color:#444;line-height:1.65}}
  .parent{{margin-top:56px;padding-top:0;border-top:6px double #ccc}}
  .parent-tag{{display:inline-block;background:#1a1a1a;color:#fff;font-size:12px;
    padding:5px 12px;border-radius:4px;letter-spacing:1px;margin:24px 0 4px}}
  .parent h3{{font-size:16px;margin:24px 0 8px;color:#444}}
  .parent .summary{{background:#f8f8f6;padding:18px;border-left:4px solid #1a1a1a;
    font-size:15px;line-height:1.85}}
  .parent table{{font-size:15px}}
  .parent .tip{{background:#fffdf0;border:1px dashed #d8cb8a;padding:16px 18px;
    font-size:15px;line-height:1.8}}
  .qz{{margin:0 0 26px}}
  .qz-q{{font-size:17px;font-weight:700;margin:0 0 10px;line-height:1.5}}
  .qz-c{{display:block;width:100%;text-align:left;font-family:inherit;font-size:16px;
    background:#fff;border:1.5px solid #ddd;border-radius:8px;padding:12px 14px;
    margin:0 0 8px;cursor:pointer;line-height:1.4}}
  .qz-c.right{{background:#e8f6ec;border-color:#4a9d6a;font-weight:700}}
  .qz-c.wrong{{background:#fdecea;border-color:#d9534f;text-decoration:line-through;
    color:#999}}
  .qz-done{{font-size:14px;color:#4a9d6a;font-weight:700;margin:4px 0 0}}
  .w{{cursor:pointer;border-radius:3px;padding:0 1px}}
  .w:active{{background:#ffe9a8}}
  .w.on{{background:#ffe9a8}}
  #wordbar{{position:fixed;left:0;right:0;bottom:0;background:#1a1a1a;color:#fff;
    padding:16px 20px;transform:translateY(110%);transition:transform .18s ease;
    z-index:99;box-shadow:0 -2px 12px rgba(0,0,0,.2)}}
  #wordbar.show{{transform:translateY(0)}}
  #wb-en{{font-size:20px;font-weight:700;margin-right:12px}}
  #wb-ko{{font-size:16px;color:#ffe9a8}}
  #wb-x{{float:right;font-size:20px;color:#888;cursor:pointer;line-height:1.2}}
  .btns{{display:flex;flex-wrap:wrap;gap:10px;margin:40px 0 0}}
  body.pdf-mode .btns,body.pdf-mode .say-btn,body.pdf-mode .hint,
  body.pdf-mode #wordbar,body.pdf-mode .orig-btn,body.pdf-mode .vid-btn,
  body.pdf-mode #pdf-msg,body.pdf-mode .orig-note,
  body.pdf-mode .meta-row{{display:none !important}}
  body.pdf-mode footer{{margin-top:16px;padding-top:10px}}
  body.pdf-mode{{padding-bottom:0;width:680px;max-width:680px}}
  body.pdf-mode table{{table-layout:fixed;width:100%}}
  body.pdf-mode td,body.pdf-mode th{{word-break:keep-all;overflow-wrap:anywhere}}
  body.pdf-mode td:first-child{{width:15%}}
  body.pdf-mode .parent table{{font-size:13px}}
  body.pdf-mode .parent td{{padding:7px 9px;line-height:1.5}}
  body.pdf-mode .w{{background:none}}
  body.no-article #p-title,body.no-article #p-summary,
  body.no-article #p-words-h,body.no-article #p-words,
  body.no-article #p-q-h,body.no-article #p-q,body.no-article #p-tip,
  body.no-article #p-lv-h,body.no-article #p-lv,
  body.no-article #p-src-h,body.no-article #p-src{{display:none}}
  body.no-article #read-h2,body.no-article #read-hint,
  body.no-article #article{{display:none}}
  @media print{{ .say-btn,.hint,#wordbar,.orig-btn,.orig-note{{display:none}}
    .w{{background:none}} }}
  .print-btn{{flex:1;padding:15px;font-size:15px;font-weight:700;background:#1a1a1a;
    color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit}}
  .print-btn.alt{{background:#fff;color:#1a1a1a;border:1.5px solid #1a1a1a}}
  #pdf-msg{{position:fixed;left:0;right:0;bottom:0;z-index:120;
    background:#1a1a1a;color:#fff;padding:14px;font-size:15px;
    text-align:center;display:none}}
  #pdf-msg.on{{display:block}}
  footer{{margin-top:36px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#aaa}}
  footer a{{color:#aaa}}
  body.kid-only .parent{{display:none}}
  @media print{{
    body{{padding:0;font-size:12pt;max-width:100%}}
    .article{{font-size:13pt;line-height:1.8}}
    h1{{font-size:19pt}}
    h2{{margin:18px 0 9px}}
    .btns{{display:none}}
    .parent{{page-break-before:always;border-top:none;margin-top:0}}
    @page{{margin:15mm}}
  }}
</style>
</head>
<body>

<div class="date">{date_en}</div>
<h1>{title_en}</h1>
<div class="meta-row">
  <span class="src-badge">{source_name}</span>
  <span class="level">{level_badge}</span>
</div>

{media_html}

<a class="orig-btn" href="{source_url}" target="_blank" rel="noopener">
  원문 기사 보기 (사진 더 있음)
</a>
<hr>

<h2 id="read-h2">READ <button class="say-btn" onclick="sayArticle(this)">🔊 들어보기</button></h2>
<p id="read-hint" class="hint" style="float:none;text-align:right;margin:-6px 0 10px">모르는 단어를 누르면 뜻이 나와요</p>
<div class="article" id="article">
{article_html}
</div>

<h2>WORDS <span class="hint">단어를 누르면 소리가 나요</span></h2>
<dl class="words-def">
{words_en_html}
</dl>

<h2>QUIZ <span class="hint">답을 골라보세요</span></h2>
{quiz_html}

<h2>THINK</h2>
<div class="question">
  <div class="en">{question_en}</div>
</div>

<div class="parent">
  <div class="parent-tag">엄마 보는 곳</div>
  <h3 id="p-title">{title_ko}</h3>

  <div id="p-summary" class="summary">{summary_ko}</div>

  <h3 id="p-words-h">단어 한국어 뜻</h3>
  <table id="p-words">
  <tr><th>영어</th><th>뜻</th></tr>
  {words_ko_html}
  </table>

  <h3 id="p-q-h">오늘의 질문</h3>
  <p id="p-q" style="font-size:15px;margin-bottom:14px">{question_ko}</p>

  <div id="p-tip" class="tip">{tip_ko}</div>

  <h3>퀴즈 정답과 해설</h3>
  {quiz_answers_html}

  <h3 id="p-lv-h">읽기 레벨</h3>
  <div id="p-lv" class="level-note">{level_note}</div>

  <h3 id="p-src-h">원문</h3>
  <p id="p-src" style="font-size:15px">
    원문 주소<br>
    원래 글은 여기서 보실 수 있어요:<br>
    <a href="{source_url}" target="_blank" rel="noopener">{source_url}</a>
  </p>
</div>

<div class="btns">
  <button class="print-btn" onclick="savePdf('kid')">지문+문제 PDF</button>
  <button class="print-btn" onclick="savePdf('quiz')">문제만 PDF (지문 빼고)</button>
  <button class="print-btn alt" onclick="savePdf('all')">전체 PDF (엄마 면)</button>
</div>
<div id="pdf-msg"></div>

<footer>
  출처: <a href="{source_url}">{source_name}</a> · 쉬운 영어로 다시 썼습니다.<br>
  <a href="./">지난 신문 보기</a>
</footer>

<div id="wordbar">
  <span id="wb-x" onclick="hideBar()">×</span>
  <span id="wb-en"></span><span id="wb-ko"></span>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script>
var PDF_DATE  = "{date_file}";
var GLOSSARY  = {glossary_json};

/* ── 단어 눌러서 뜻 보기 ──────────────────────────────── */

function pick(btn, idx) {{
  var box = btn.parentNode;
  if (box.dataset.done === '1') return;
  var ans = parseInt(box.dataset.a, 10);

  if (idx === ans) {{
    btn.className = 'qz-c right';
    box.dataset.done = '1';
    var msg = document.createElement('p');
    msg.className = 'qz-done';
    msg.textContent = '정답이에요!';
    box.appendChild(msg);
  }} else {{
    btn.className = 'qz-c wrong';
  }}
}}

var lastWordEl = null;
var barTimer = null;

function hideBar() {{
  document.getElementById('wordbar').classList.remove('show');
  if (lastWordEl) lastWordEl.classList.remove('on');
}}

function tapWord(el) {{
  var raw = el.textContent.trim();
  var key = raw.toLowerCase().replace(/[^a-z'-]/g, '');
  var ko  = GLOSSARY[key] || GLOSSARY[key.replace(/[',-]/g, '')] || '';

  if (lastWordEl) lastWordEl.classList.remove('on');
  el.classList.add('on');
  lastWordEl = el;

  document.getElementById('wb-en').textContent = raw;
  document.getElementById('wb-ko').textContent = ko ? ko : '(뜻 없음)';
  document.getElementById('wordbar').classList.add('show');

  clearTimeout(barTimer);
  barTimer = setTimeout(hideBar, 6000);

  speak(raw, 0.7);
}}

/* ── 읽어주기 (브라우저 내장 음성) ────────────────────── */

var enVoice = null;

function pickVoice() {{
  var vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  if (!vs.length) return;
  var prefer = ['Samantha', 'Karen', 'Google US English', 'Microsoft Aria',
                'Microsoft Jenny', 'Alex', 'Daniel'];
  for (var i = 0; i < prefer.length; i++) {{
    for (var j = 0; j < vs.length; j++) {{
      if (vs[j].name.indexOf(prefer[i]) === 0) {{ enVoice = vs[j]; return; }}
    }}
  }}
  for (var k = 0; k < vs.length; k++) {{
    if (vs[k].lang && vs[k].lang.toLowerCase().indexOf('en') === 0) {{
      enVoice = vs[k]; return;
    }}
  }}
}}

if (window.speechSynthesis) {{
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}}

function speak(text, rate, onEnd) {{
  if (!window.speechSynthesis) {{
    alert('이 브라우저는 읽어주기를 지원하지 않아요. 크롬이나 사파리에서 열어보세요.');
    return;
  }}
  speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  u.pitch = 1;
  if (enVoice) u.voice = enVoice;
  if (onEnd) {{ u.onend = onEnd; u.onerror = onEnd; }}
  speechSynthesis.speak(u);
}}

function sayWord(el) {{
  speak(el.textContent.trim(), 0.75);
}}

function sayArticle(btn) {{
  if (speechSynthesis.speaking && btn.classList.contains('playing')) {{
    speechSynthesis.cancel();
    btn.classList.remove('playing');
    btn.textContent = '🔊 들어보기';
    return;
  }}
  var ps = document.querySelectorAll('#article p');
  var text = '';
  for (var i = 0; i < ps.length; i++) {{ text += ps[i].textContent + ' '; }}

  btn.classList.add('playing');
  btn.textContent = '■ 멈추기';

  speak(text, 0.82, function() {{
    btn.classList.remove('playing');
    btn.textContent = '🔊 들어보기';
  }});
}}

/* ── PDF 저장 ─────────────────────────────────────────── */

function savePdf(mode) {{
  var btns = document.querySelector('.btns');
  var msg  = document.getElementById('pdf-msg');

  if (typeof html2pdf === 'undefined') {{
    msg.textContent = 'PDF 기능을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해주세요.';
    return;
  }}

  var bar = document.getElementById('wordbar');
  if (bar && bar.parentNode) {{ bar.parentNode.removeChild(bar); }}
  document.body.classList.add('pdf-mode');
  if (mode === 'kid') {{ document.body.classList.add('kid-only'); }}
  if (mode === 'quiz') {{ document.body.classList.add('no-article'); }}
  btns.style.display = 'none';
  msg.textContent = 'PDF 만드는 중... 잠시만요';
  msg.classList.add('on');

  var filename = PDF_DATE + '-영어신문-' +
    (mode === 'kid' ? '지문문제' : mode === 'quiz' ? '문제만' : '전체') + '.pdf';

  var opt = {{
    margin:      [12, 10, 12, 10],
    filename:    filename,
    image:       {{ type: 'jpeg', quality: 0.98 }},
    html2canvas: {{ scale: 2, useCORS: true, scrollY: 0,
                    windowWidth: 720, width: 680 }},
    jsPDF:       {{ unit: 'mm', format: 'a4', orientation: 'portrait' }},
    pagebreak:   {{ mode: ['avoid-all'] }}
  }};

  function done() {{
    btns.style.display = '';
    document.body.classList.remove('pdf-mode');
    document.body.classList.remove('kid-only');
    document.body.classList.remove('no-article');
    msg.textContent = '';
    msg.classList.remove('on');
    if (bar) {{ document.body.appendChild(bar); }}
  }}

  html2pdf().set(opt).from(document.body).save().then(done).catch(function(e) {{
    done();
    msg.textContent = 'PDF 저장에 실패했습니다: ' + e;
  }});
}}
</script>

</body>
</html>
"""


def esc(s):
    return html.escape(str(s))


WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’-]*")


def wrap_words(paragraph, gloss_keys):
    """문단의 각 단어를 눌러볼 수 있게 <span>으로 감싼다."""
    out = []
    pos = 0
    for m in WORD_RE.finditer(paragraph):
        out.append(esc(paragraph[pos:m.start()]))
        word = m.group(0)
        key = re.sub(r"[^a-z'’-]", "", word.lower())
        if key in gloss_keys:
            out.append(f'<span class="w" onclick="tapWord(this)">{esc(word)}</span>')
        else:
            out.append(esc(word))
        pos = m.end()
    out.append(esc(paragraph[pos:]))
    return "".join(out)


def render_media(art):
    """사진(퍼블릭 도메인만)과 영상 버튼 HTML을 만든다."""
    parts = []

    img = art.get("image")
    if img:
        parts.append(
            f'<img class="hero" src="{esc(img["src"])}" alt="">'
            f'<p class="hero-cap">{esc(img["caption"])}</p>'
        )

    vid = art.get("video")
    if vid:
        parts.append(
            f'<a class="vid-btn" href="https://www.youtube.com/watch?v={esc(vid)}" '
            f'target="_blank" rel="noopener">▶ 오늘의 영상 보기</a>'
        )

    return "\n".join(parts)


def render_quiz(quiz):
    """아이 면 — 눌러서 채점되는 객관식 문제."""
    if not quiz:
        return "<p style='color:#999;font-size:14px'>이번 기사는 문제가 없어요.</p>"

    blocks = []
    for i, q in enumerate(quiz, 1):
        choices = q.get("choices") or []
        ans = q.get("answer", 0)
        btns = "\n".join(
            f'    <button class="qz-c" onclick="pick(this,{j})">'
            f'{chr(65 + j)}. {esc(ch)}</button>'
            for j, ch in enumerate(choices)
        )
        blocks.append(
            f'  <div class="qz" data-a="{int(ans)}">\n'
            f'    <p class="qz-q">{i}. {esc(q.get("q",""))}</p>\n'
            f'{btns}\n  </div>'
        )
    return "\n".join(blocks)


def render_quiz_answers(quiz):
    """엄마 면 — 정답과 한국어 해설."""
    if not quiz:
        return "<p style='font-size:15px'>이번 기사는 문제가 없어요.</p>"

    rows = []
    for i, q in enumerate(quiz, 1):
        choices = q.get("choices") or []
        ans = q.get("answer", 0)
        correct = choices[ans] if 0 <= ans < len(choices) else ""
        rows.append(
            f"<tr><td>{i}번</td>"
            f"<td><b>{chr(65 + int(ans))}. {esc(correct)}</b><br>"
            f"<span style='color:#777;font-size:14px'>{esc(q.get('why_ko',''))}</span></td></tr>"
        )
    return ("<table><tr><th>문제</th><th>정답과 해설</th></tr>"
            + "".join(rows) + "</table>")


def render_html(c, source_url, art=None):
    art = art or {}
    # 단어장 — 키를 소문자로 정리
    glossary = {}
    for k, v in (c.get("glossary") or {}).items():
        key = re.sub(r"[^a-z'’-]", "", str(k).lower())
        if key and v:
            glossary[key] = str(v)

    article_html = "\n".join(
        f"  <p>{wrap_words(p, glossary)}</p>" for p in c["article_en"]
    )

    # 아이 면 — 영영 뜻만
    words_en_html = "\n".join(
        f'<dt onclick="sayWord(this)">{esc(w.get("en",""))}</dt>'
        f'<dd>{esc(w.get("def_en",""))}</dd>'
        for w in c.get("words", [])
    )
    # 엄마 면 — 한국어 뜻
    words_ko_html = "\n".join(
        f"<tr><td>{esc(w.get('en',''))}</td><td>{esc(w.get('ko',''))}</td></tr>"
        for w in c.get("words", [])
    )

    # 읽기 난이도
    lv = reading_level(c["article_en"])
    orig_lv = reading_level([art.get("body", "")]) if art.get("body") else None
    if lv:
        level_badge = f"읽기 레벨 약 {lv['grade']} (AR 환산 추정)"
        level_note = (
            f"<b>원문</b>  {orig_lv['grade'] if orig_lv else '-'} 수준"
            f"  ({orig_lv['words'] if orig_lv else '-'}단어)<br>"
            f"<b>이 글</b>  {lv['grade']} 수준"
            f"  ({lv['words']}단어, {lv['sentences']}문장)<br><br>"
            "Flesch-Kincaid 방식으로 문장 길이와 단어 길이를 계산한 추정치예요. "
            "르네상스러닝의 공식 AR(ATOS) 지수는 아닙니다. "
            "아이가 편하게 읽으면 맞는 수준이고, 자꾸 막히면 알려주세요."
        )
    else:
        level_badge = "읽기 레벨 측정 불가"
        level_note = "이번 글은 읽기 레벨을 계산하지 못했습니다."

    if "bbc.co.uk" in source_url:
        source_name = "BBC Newsround"
    elif "dogonews" in source_url:
        source_name = "DOGOnews"
    else:
        source_name = "출처"

    return HTML_TEMPLATE.format(
        date_en=TODAY.strftime("%A, %B %d, %Y"),
        date_file=DATE_STR,
        media_html=render_media(art),
        quiz_html=render_quiz(c.get("quiz")),
        quiz_answers_html=render_quiz_answers(c.get("quiz")),
        glossary_json=json.dumps(glossary, ensure_ascii=False),
        title_en=esc(c["title_en"]),
        source_name=esc(source_name),
        level_badge=esc(level_badge),
        level_note=level_note,
        article_html=article_html,
        words_en_html=words_en_html,
        question_en=esc(c["question_en"]),
        title_ko=esc(c.get("title_ko", "")),
        summary_ko=esc(c.get("summary_ko", "")),
        words_ko_html=words_ko_html,
        question_ko=esc(c.get("question_ko", "")),
        tip_ko=esc(c.get("tip_ko", "")),
        source_url=esc(source_url),
    )


INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>오늘의 영어신문</title>
<style>
body{{font-family:"Malgun Gothic","맑은 고딕",-apple-system,sans-serif;max-width:640px;
margin:0 auto;padding:40px 20px;line-height:1.7;color:#1a1a1a}}
h1{{font-size:26px;margin-bottom:4px}}
.sub{{color:#888;font-size:14px;margin-bottom:32px}}
ul{{list-style:none;padding:0}}
li{{padding:16px 0;border-bottom:1px solid #eee}}
a{{color:#1a1a1a;text-decoration:none;font-weight:600;font-size:17px}}
a:hover{{text-decoration:underline}}
.d{{display:block;color:#aaa;font-size:13px;font-weight:400;margin-top:3px}}
</style></head><body>
<h1>오늘의 영어신문</h1>
<div class="sub">9살을 위한 하루 5분 영어</div>
<ul>
{items}
</ul>
</body></html>
"""


def render_index(issues):
    items = "\n".join(
        f'<li><a href="{esc(i["file"])}">{esc(i["title_ko"])}'
        f'<span class="d">{esc(i["date"])} · {esc(i["title_en"])}</span></a></li>'
        for i in reversed(issues[-60:])
    )
    return INDEX_TEMPLATE.format(items=items)


# ─────────────────────────────────────────────────────────────
# 5. 카카오톡 발송
# ─────────────────────────────────────────────────────────────

def send_kakao(access_token, content, page_url):
    """카카오톡 나와의 채팅으로 발송.

    카카오 기본 텍스트 템플릿은 200자 제한이다.
    문장 중간이 잘리지 않도록 요약부터 줄여서 맞춘다.
    """
    head = f"📰 오늘의 영어신문\n{content['title_ko']}"
    tail = f"💬 {content['question_ko']}\n{page_url}"
    summary = content["summary_ko"]

    # 머리말 + 질문은 반드시 남기고, 남는 공간만큼만 요약을 넣는다
    room = 195 - len(head) - len(tail) - 4      # 4 = 줄바꿈 여백
    if room < 20:
        summary = ""
    elif len(summary) > room:
        cut = summary[:room]
        # 문장 끝에서 자르기
        for mark in (". ", "! ", "? ", "다. ", "요. "):
            idx = cut.rfind(mark)
            if idx > room * 0.4:
                cut = cut[: idx + len(mark) - 1]
                break
        else:
            cut = cut.rstrip() + "..."
        summary = cut

    text = f"{head}\n\n{summary}\n\n{tail}" if summary else f"{head}\n\n{tail}"
    text = text[:200]

    template = {
        "object_type": "text",
        "text": text,
        "link": {"web_url": page_url, "mobile_web_url": page_url},
        "button_title": "전체 보기 · 인쇄",
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


# ─────────────────────────────────────────────────────────────
# 실행
# ─────────────────────────────────────────────────────────────

def main():
    access_token, new_refresh = refresh_kakao_token()
    if new_refresh:
        update_github_secret("KAKAO_REFRESH_TOKEN", new_refresh)

    history = load_history()
    url = pick_article(history)
    art = fetch_article(url)
    source_url = art["url"]
    content = make_content(art["title"], art["body"])

    os.makedirs(DOCS_DIR, exist_ok=True)
    filename = f"{DATE_STR}.html"
    with open(os.path.join(DOCS_DIR, filename), "w", encoding="utf-8") as f:
        f.write(render_html(content, source_url, art))
    log(f"HTML 저장: {DOCS_DIR}/{filename}")

    history["used_urls"].append(source_url)
    history.setdefault("issues", []).append({
        "date": DATE_STR,
        "file": filename,
        "title_en": content["title_en"],
        "title_ko": content["title_ko"],
    })
    with open(os.path.join(DOCS_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(render_index(history["issues"]))
    save_history(history)

    page_url = f"{PAGES_URL}/{filename}" if PAGES_URL else source_url
    send_kakao(access_token, content, page_url)

    log("전부 완료!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"오류: {e}")
        sys.exit(1)
