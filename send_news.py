#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
매일 아침 9살 아이용 영어 기사를 만들어서 카카오톡 "나와의 채팅"으로 보냅니다.

동작 순서:
  1. 카카오 refresh token으로 access token 발급
  2. DOGOnews에서 아직 안 쓴 최신 기사 하나 고르기
  3. AI로 아이용(영어) + 엄마용(한국어) 자료 만들기
  4. 읽기 레벨 계산 후 HTML 페이지로 저장 (GitHub Pages로 공개됨)
  5. 카카오톡으로 제목 + 요약 + 링크 발송
  6. 카카오 refresh token이 갱신됐으면 GitHub Secret 자동 업데이트

GitHub Actions에서 매일 자동 실행됩니다.
"""

import os
import sys
import json
import re
import html
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

# GitHub Pages 주소는 저장소 이름에서 자동으로 만듭니다
PAGES_URL = os.environ.get("PAGES_URL", "").strip().rstrip("/")
if not PAGES_URL and "/" in GH_REPO:
    _owner, _repo = GH_REPO.split("/", 1)
    PAGES_URL = f"https://{_owner.lower()}.github.io/{_repo}"

DOCS_DIR = "docs"
HISTORY_FILE = os.path.join(DOCS_DIR, "history.json")

# 구글 Gemini. 앞의 모델이 안 되면 뒤 것을 차례로 시도합니다.
GEMINI_MODELS = [
    "gemini-flash-latest",
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
    """refresh token으로 access token을 발급받는다."""
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
    new_refresh = data.get("refresh_token")
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
    hist["used_urls"] = hist["used_urls"][-120:]
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=2)


def pick_article(history):
    """DOGOnews 첫 화면에서 아직 안 쓴 적당한 기사 하나를 고른다."""
    log("DOGOnews에서 기사 목록 가져오는 중...")
    res = requests.get("https://www.dogonews.com/", headers=UA, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    used = set(history.get("used_urls", []))
    candidates = []
    seen = set()

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
            log(f"  건너뜀 (부적절 주제: {', '.join(hits)}): {url.rsplit('/', 1)[-1][:50]}")
            continue
        candidates.append(url)

    if not candidates:
        raise RuntimeError("쓸 만한 새 기사를 찾지 못했습니다.")

    log(f"후보 {len(candidates)}개 중 첫 번째 선택")
    return candidates[0]


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

    return title, body[:6000], url


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

  "glossary": {{"tonight": "오늘 밤", "special": "특별한", "burn": "타다"}}
}}

[아이용 규칙 — 여기엔 한국어 금지]
- article_en은 전체 합쳐서 반드시 100~150 단어. 문장은 짧고 쉽게.
  원문을 그대로 베끼지 말고 다시 쓰세요.
- words는 5~7개. 기사에 실제로 나온 단어만 고르세요.
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
"""


def call_gemini(prompt):
    """Gemini 호출. 모델 이름이 바뀌었을 수 있으니 차례로 시도한다."""
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
                    "maxOutputTokens": 3000,
                    # JSON 모드 — 문법이 깨진 JSON이 나오는 것을 막아준다
                    "responseMimeType": "application/json",
                },
            },
            timeout=120,
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
                "Gemini 한도를 초과했습니다. 하루 뒤 자동으로 풀립니다."
            )

        last_error = f"{model}: {res.status_code} {res.text[:300]}"
        break

    raise RuntimeError(
        f"Gemini 호출 실패 — {last_error}\n"
        "→ GEMINI_API_KEY가 올바른지 확인하세요."
    )


def make_content(title, body):
    """AI 호출 + JSON 파싱. 실패하면 최대 3번까지 다시 시도한다."""
    last_error = None

    for attempt in range(1, 4):
        log(f"AI로 아이 수준 자료 만드는 중... (시도 {attempt}/3)")
        text = call_gemini(PROMPT.format(title=title, body=body))
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

        missing = [k for k in ("title_en", "article_en", "words", "question_en",
                               "title_ko", "summary_ko", "question_ko")
                   if not data.get(k)]
        if missing:
            last_error = RuntimeError(f"빠진 항목: {missing}")
            log(f"  항목이 빠졌습니다 {missing}, 다시 시도합니다")
            continue

        return data

    raise RuntimeError(f"3번 시도했지만 자료를 만들지 못했습니다: {last_error}")


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
    """Flesch-Kincaid 학년 수준. 공식 AR 지수가 아니라 추정치다."""
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
  .meta-row{{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 14px}}
  .level{{display:inline-block;background:#1a1a1a;color:#fff;font-size:12px;
    padding:5px 11px;border-radius:20px;letter-spacing:0.3px;white-space:nowrap}}
  .src-link{{font-size:13px;color:#666;text-decoration:none;border-bottom:1px solid #ccc}}
  .orig-btn{{display:block;text-align:center;background:#2d6cdf;color:#fff;
    text-decoration:none;padding:15px;border-radius:8px;font-size:16px;font-weight:700;
    margin:4px 0 8px}}
  .orig-note{{font-size:12px;color:#888;line-height:1.6;margin:0 0 22px;text-align:center}}
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
  .words-def{{font-size:17px}}
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
  .btns{{display:flex;gap:10px;margin:40px 0 0}}
  .print-btn{{flex:1;padding:15px;font-size:15px;font-weight:700;background:#1a1a1a;
    color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit}}
  .print-btn.alt{{background:#fff;color:#1a1a1a;border:1.5px solid #1a1a1a}}
  #pdf-msg{{margin-top:12px;font-size:14px;color:#666;text-align:center}}
  footer{{margin-top:36px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#aaa}}
  footer a{{color:#aaa}}
  body.kid-only .parent{{display:none}}
  @media print{{
    body{{padding:0;font-size:12pt;max-width:100%}}
    .article{{font-size:13pt;line-height:1.8}}
    h1{{font-size:19pt}}
    h2{{margin:18px 0 9px}}
    .btns,.say-btn,.hint,#wordbar,.orig-btn,.orig-note{{display:none}}
    .w{{background:none}}
    .parent{{page-break-before:always;border-top:none;margin-top:0}}
    @page{{margin:15mm}}
  }}
</style>
</head>
<body>

<div class="date">{date_en}</div>
<h1>{title_en}</h1>
<div class="meta-row">
  <span class="level">{level_badge}</span>
</div>

<a class="orig-btn" href="{source_url}" target="_blank" rel="noopener">
  📷 사진 있는 원문 보기 · 인쇄하기
</a>
<p class="orig-note">
  원문 페이지 아래쪽 <b>Print</b> 버튼을 누르면 광고와 댓글이 빠진 인쇄용 화면이 뜹니다.
  거기서 <b>PDF로 저장</b>하시면 사진까지 그대로 나와요.
</p>
<hr>

<h2>READ <button class="say-btn" onclick="sayArticle(this)">🔊 들어보기</button></h2>
<p class="hint" style="float:none;text-align:right;margin:-6px 0 10px">모르는 단어를 누르면 뜻이 나와요</p>
<div class="article" id="article">
{article_html}
</div>

<h2>WORDS <span class="hint">단어를 누르면 소리가 나요</span></h2>
<dl class="words-def">
{words_en_html}
</dl>

<h2>THINK</h2>
<div class="question">
  <div class="en">{question_en}</div>
</div>

<div class="parent">
  <div class="parent-tag">엄마 보는 곳</div>
  <h3>{title_ko}</h3>

  <div class="summary">{summary_ko}</div>

  <h3>단어 한국어 뜻</h3>
  <table>
  <tr><th>영어</th><th>뜻</th></tr>
  {words_ko_html}
  </table>

  <h3>오늘의 질문</h3>
  <p style="font-size:15px;margin-bottom:14px">{question_ko}</p>

  <div class="tip">{tip_ko}</div>

  <h3>읽기 레벨</h3>
  <div class="level-note">{level_note}</div>

  <h3>원문</h3>
  <p style="font-size:15px">
    이 기사는 원문을 9살 수준으로 다시 쓴 것입니다.
    원래 글은 여기서 보실 수 있어요:<br>
    <a href="{source_url}" target="_blank" rel="noopener">{source_url}</a>
  </p>
</div>

<div class="btns">
  <button class="print-btn" onclick="savePdf('kid')">아이 것만 PDF 저장</button>
  <button class="print-btn alt" onclick="savePdf('all')">전체 PDF 저장</button>
</div>
<div id="pdf-msg"></div>

<footer>
  출처: <a href="{source_url}">DOGOnews</a> · 9살 수준에 맞춰 쉬운 영어로 다시 썼습니다.<br>
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

  hideBar();
  if (mode === 'kid') {{ document.body.classList.add('kid-only'); }}
  btns.style.display = 'none';
  msg.textContent = 'PDF 만드는 중... 잠시만요';

  var filename = PDF_DATE + '-영어신문-' + (mode === 'kid' ? '아이' : '전체') + '.pdf';

  var opt = {{
    margin:      [12, 10, 12, 10],
    filename:    filename,
    image:       {{ type: 'jpeg', quality: 0.98 }},
    html2canvas: {{ scale: 2, useCORS: true, scrollY: 0 }},
    jsPDF:       {{ unit: 'mm', format: 'a4', orientation: 'portrait' }},
    pagebreak:   {{ mode: ['css', 'legacy'], before: '.parent' }}
  }};

  function done() {{
    btns.style.display = '';
    document.body.classList.remove('kid-only');
    msg.textContent = '';
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


def render_html(c, source_url):
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
    if lv:
        level_badge = f"읽기 레벨 약 {lv['grade']} (AR 환산 추정)"
        level_note = (
            f"이 글의 읽기 레벨은 <b>약 {lv['grade']}</b>입니다. "
            f"단어 {lv['words']}개, 문장 {lv['sentences']}개.<br><br>"
            "Flesch-Kincaid 방식으로 <b>문장 길이와 단어 길이를 계산한 추정치</b>예요. "
            "르네상스러닝이 매기는 <b>공식 AR(ATOS) 지수는 아닙니다.</b> "
            "숫자가 비슷한 범위로 나오긴 하지만 참고용으로만 봐주세요. "
            "아이가 편하게 읽으면 맞는 수준이고, 자꾸 막히면 알려주세요. 더 쉽게 조정할게요."
        )
    else:
        level_badge = "읽기 레벨 측정 불가"
        level_note = "이번 글은 읽기 레벨을 계산하지 못했습니다."

    return HTML_TEMPLATE.format(
        date_en=TODAY.strftime("%A, %B %d, %Y"),
        date_file=DATE_STR,
        glossary_json=json.dumps(glossary, ensure_ascii=False),
        title_en=esc(c["title_en"]),
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
    """카카오톡 나와의 채팅으로 발송. 텍스트는 200자 제한."""
    head = f"📰 오늘의 영어신문\n{content['title_ko']}"
    tail = f"💬 {content['question_ko']}"
    summary = content["summary_ko"]

    room = 195 - len(head) - len(tail) - 4
    if room < 20:
        summary = ""
    elif len(summary) > room:
        cut = summary[:room]
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
        "button_title": "읽기 · 듣기 · 인쇄",
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
    title, body, source_url = fetch_article(url)
    content = make_content(title, body)

    os.makedirs(DOCS_DIR, exist_ok=True)
    filename = f"{DATE_STR}.html"
    with open(os.path.join(DOCS_DIR, filename), "w", encoding="utf-8") as f:
        f.write(render_html(content, source_url))
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
