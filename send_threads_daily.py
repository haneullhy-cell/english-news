#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
매일 아침, 오늘 스레드에 올릴 '하루 세트'를 만들어 카카오톡으로 보냅니다.
(쿠팡 파트너스 수익이 잘 나는 계정들의 운영 패턴을 그대로 따릅니다)

하루 세트 — 올리는 순서대로:
  1. 일상 한 줄 글      — 사진 1~2장 + 짧은 한 줄. 링크 없음. (노출·댓글용)
  2. 상품 티저 글       — 상품 사진 + "이거 어때?" 식 질문. 링크 없음. (반응 모으기)
  3. [광고] 링크 글     — 2번 글의 답글로. 광고 문구 + 한 줄 + 쿠팡 링크. (수익)
  4. 스친 모으기 글     — 맞팔·하트·리포스트 교환 글. (팔로워 늘리기)
  + 댓글 답변 템플릿    — 달리는 댓글마다 짧게 달아 주는 말

동작:
  1. 최근 14일 동안 쓴 상품·소재와 겹치지 않게 AI(Gemini)로 오늘 세트 생성
     (사진·써 본 느낌·가격처럼 직접 채워야 하는 부분은 [대괄호 칸]으로 비워 둠)
  2. 복사 버튼이 있는 HTML 페이지로 저장 (GitHub Pages)
  3. 카카오톡 "나와의 채팅"으로 발송
  4. (선택) THREADS_ACCESS_TOKEN 이 있으면 사진이 필요 없는 4번 '스친 글'은
     Threads 공식 API로 바로 올립니다. 사진·링크가 필요한 1~3번은 복사해서 올립니다.

카카오 토큰·Gemini 호출·GitHub 시크릿 갱신은 send_news.py 것을 그대로 씁니다.

THREADS_ACCESS_TOKEN 받는 법 (선택, 10분):
  1. developers.facebook.com → 앱 만들기 → 사용 사례 'Threads API' 추가
  2. 앱 대시보드 → Threads → '사용자 토큰 생성기'에서 내 스레드 계정으로 토큰 발급
     (권한 threads_basic, threads_content_publish)
  3. 그 토큰을 저장소 Settings → Secrets → THREADS_ACCESS_TOKEN 에 넣기
  스크립트가 매일 갱신하므로(60일 만료) 한 번만 넣으면 됩니다. GH_PAT 가 있어야 갱신 저장이 됩니다.
사용:  python send_threads_daily.py            (평소: AI 생성 + 카톡)
       python send_threads_daily.py --sample   (AI·카톡 없이 예시 세트로 페이지만 만들어 보기)
"""

import os
import re
import sys
import json
import time
from datetime import timedelta

import requests

from send_news import (
    TODAY, DOCS_DIR, PAGES_URL,
    log, esc, call_gemini, refresh_kakao_token, update_github_secret,
)
from send_threads import NICHE, AUDIENCE, DISCLOSURE, THREADS_LIMIT, upcoming_events, SEASONS

# ─────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────

OUT_DIR = os.path.join(DOCS_DIR, "threads-daily")
HISTORY_FILE = os.path.join(OUT_DIR, "history.json")
DAY = TODAY.date()
DAY_STR = DAY.isoformat()
WEEKDAY = "월화수목금토일"[DAY.weekday()]
DAY_LABEL = f"{DAY.month}/{DAY.day}({WEEKDAY})"

# 스친 글에 붙일 토픽 태그 (스레드 주제). 맞팔 커뮤니티에서 많이 쓰는 태그.
FOLLOW_TOPIC = os.environ.get("THREADS_FOLLOW_TOPIC", "1000명프로젝트").strip()

# 스레드 공식 API (있으면 4번 스친 글만 자동 게시)
THREADS_TOKEN = os.environ.get("THREADS_ACCESS_TOKEN", "").strip()
AUTO_POST = os.environ.get("THREADS_AUTO_POST", "1").strip() not in ("0", "false", "no", "")
THREADS_API = "https://graph.threads.net/v1.0"

# 댓글에 짧게 달아 주는 말 — 수익 잘 나는 계정들은 모든 댓글에 1~3어절로 답합니다
REPLY_SNIPPETS = [
    "반가워요~~ 반하리 완💗", "스하리 완! 자주 봐요🔥", "고마워요❤️ 오늘도 화이팅!",
    "헉 저도요 ㅋㅋㅋ", "맞아요 ㅠㅠ 공감", "링크 첫 댓글에 있어요👀",
    "써 보고 후기 남길게요!", "오늘도 좋은 하루💗",
]


# ─────────────────────────────────────────────────────────────
# 1. 기록
# ─────────────────────────────────────────────────────────────

def load_history():
    try:
        with open(HISTORY_FILE, encoding="utf-8") as f:
            h = json.load(f)
            h.setdefault("days", [])
            return h
    except (FileNotFoundError, json.JSONDecodeError):
        return {"days": []}


def save_history(hist):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────────────────────
# 2. AI로 하루 세트 만들기
# ─────────────────────────────────────────────────────────────

PROMPT = """당신은 스레드(Threads)에서 {niche} 계정을 키우며 쿠팡 파트너스로 수익을 내는 운영자의 글쓰기 도우미입니다.
독자: {audience}
오늘: {day}

잘 되는 계정들의 패턴을 그대로 따릅니다.
- 글은 아주 짧게. 1~2줄, 말하듯이 반말. "ㅋㅋ", ";;", "ㄷㄷ", "~" 같은 입말을 씁니다. 이모지는 글 하나에 1개 이하.
- 정보 전달이 아니라 "나 지금 이거 하는 중" 식의 일상 공유. 사진이 주인공이고 글은 캡션입니다.
- 상품은 설명하지 않고 반응을 묻습니다. ("이 디자인 소화 가능? 불가능?", "이거 사도 됨?")
- 링크는 본문에 절대 넣지 않고, [광고] 글에만 넣습니다.

## 오늘 세트 (4개)
1. daily   — 일상 한 줄. 지금 시각대(아침·점심)에 맞는 일상. 링크 없음. 사진 칸 필수.
2. teaser  — 상품 티저. 상품 종류는 아래 '오늘의 상품 종류' 중 하나. 질문으로 끝내기. 링크 없음. 사진 칸 필수.
3. ad      — 2번의 답글로 달 [광고] 글. 아래 형식 그대로:
             "[광고] {disclosure}" 줄 다음에 빈 줄, 그다음 상품에 대한 한 줄(20자 이내), 그다음 "[쿠팡 링크]".
4. follow  — 스친(스레드 친구) 모으기 글. 하트·리포스트·팔로우하면 나도 바로 해 준다는 약속. 3줄 이내.
             최근 7일에 쓴 문장과 다르게. 이모지 2개 이하.

## 오늘의 상품 종류 (하나만 고르세요. 최근 14일에 쓴 것: {used})
{candidates}

## 다가오는 일정 / 계절
{events}
- {m1}월: {season1}

## 꼭 지킬 것
- 써 본 적 없는 느낌을 지어내지 마세요. 촉감·효과·아이 반응·가격처럼 직접 겪어야 아는 부분은
  [대괄호 칸]으로 비우고 칸 안에 무엇을 채울지 적으세요. 예: [쿠션 밟았을 때 느낌 한 단어]
- 브랜드·모델명·가격·할인율을 지어내지 마세요. 종류만 쓰세요. 상품은 글쓴이가 고릅니다.
- 효과·안전 장담, 불안 조장, "이거 모르면 손해" 식 낚시 금지.
- 광고 문구는 ad 에만, 정확히 위 형식으로.

## 출력 (JSON만)
{{
  "product": "오늘 고른 상품 종류",
  "search": "쿠팡 검색창에 넣을 검색어",
  "why": "왜 오늘 이 상품인지 한 줄",
  "posts": [
    {{"kind": "daily",  "text": "글", "photo": "어떤 사진을 찍을지 한 줄"}},
    {{"kind": "teaser", "text": "글", "photo": "어떤 사진을 찍을지 한 줄"}},
    {{"kind": "ad",     "text": "글", "photo": ""}},
    {{"kind": "follow", "text": "글", "photo": ""}}
  ],
  "reply_tip": "오늘 댓글에 답할 때 분위기 한 줄"
}}
"""

KINDS = ["daily", "teaser", "ad", "follow"]
KIND_LABEL = {
    "daily": ("① 일상 한 줄", "아침에. 사진 1~2장 + 이 글. 링크 없음."),
    "teaser": ("② 상품 티저", "점심쯤. 상품 사진 2장 + 이 글. 링크 없음. 올리자마자 ③을 답글로."),
    "ad": ("③ [광고] 링크 글", "②의 답글로. [쿠팡 링크] 자리에 파트너스 링크를 넣고 올리세요."),
    "follow": ("④ 스친 모으기", "저녁에. 토픽 태그 '" + FOLLOW_TOPIC + "' 달기. 토큰이 있으면 자동으로 올라갑니다."),
}

# 상품 후보 — 계절·일정에 맞춰 AI가 하나 고릅니다. 계정 콘셉트를 바꾸면 여기만 고치세요.
CANDIDATES = [
    "아이 실내화·운동화", "아이 물병·빨대컵", "간식 보관 용기", "유아 식판", "아이 칫솔·치약",
    "아이 우산·레인부츠", "유아 책가방", "미술 놀이 세트", "보드게임", "한글·수 학습 교구",
    "아이 방 정리함", "자동차 카시트 용품", "아이 선크림", "핸디 선풍기·손난로", "유아 침구",
    "주방 가전(에어프라이어·전기포트)", "커피·차", "엄마 운동화", "엄마 가방", "집 정리 용품",
]


def clean_posts(raw):
    by_kind = {}
    for p in raw or []:
        if not isinstance(p, dict):
            continue
        kind = str(p.get("kind", "")).strip().lower()
        text = str(p.get("text", "")).strip()
        if kind in KINDS and text:
            by_kind[kind] = {"kind": kind, "text": text,
                             "photo": str(p.get("photo", "")).strip()}
    # [광고] 글은 형식을 프로그램이 보장한다
    if "ad" in by_kind:
        t = by_kind["ad"]["text"]
        lines = [ln.strip() for ln in t.split("\n")
                 if ln.strip() and not re.search(r"쿠팡\s*파트너스|수수료|^\[광고\]|\[쿠팡 링크\]", ln)]
        one = (lines[0] if lines else "자세히 보면 예쁜 것 같기두 ㅎㅎ")[:40]
        by_kind["ad"]["text"] = f"[광고] {DISCLOSURE}\n\n{one}\n\n[쿠팡 링크]"
    return [by_kind[k] for k in KINDS if k in by_kind]


def make_set(history):
    recent = history["days"][-14:]
    used = ", ".join(d.get("product", "") for d in recent if d.get("product")) or "(없음)"
    recent_follow = [d.get("follow", "") for d in history["days"][-7:] if d.get("follow")]
    events = upcoming_events(DAY, days=21)
    prompt = PROMPT.format(
        niche=NICHE, audience=AUDIENCE, day=DAY_LABEL, disclosure=DISCLOSURE,
        used=used, candidates="\n".join(f"- {c}" for c in CANDIDATES),
        events="\n".join(f"- {name}: {dt.month}/{dt.day} (D-{dd})" for dt, name, dd in events)
               or "- (3주 안에 큰 일정 없음)",
        m1=DAY.month, season1=SEASONS[DAY.month],
    )
    if recent_follow:
        prompt += "\n## 최근 7일 스친 글 (이 문장들과 다르게)\n" + "\n".join(f"- {t}" for t in recent_follow)

    last_error = None
    for attempt in range(1, 4):
        log(f"AI로 오늘 세트 만드는 중... (시도 {attempt}/3)")
        try:
            text = call_gemini(prompt)
        except Exception as e:
            last_error = e
            log(f"  AI 호출 실패({e}) — 20초 쉬었다가 다시 시도")
            time.sleep(20)
            continue
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", text, re.S)
            try:
                data = json.loads(m.group(0)) if m else None
            except json.JSONDecodeError:
                data = None
        if not isinstance(data, dict):
            last_error = RuntimeError("JSON 파싱 실패")
            log("  JSON 파싱 실패, 다시 시도합니다")
            continue
        posts = clean_posts(data.get("posts"))
        if len(posts) < 4 or not data.get("product"):
            last_error = RuntimeError(f"항목 부족 — 글 {len(posts)}개, 상품 {bool(data.get('product'))}")
            log(f"  {last_error}, 다시 시도합니다")
            continue
        for p in posts:
            if len(p["text"]) > THREADS_LIMIT:
                p["text"] = p["text"][:THREADS_LIMIT]
        return {
            "product": str(data["product"]).strip(),
            "search": str(data.get("search") or data["product"]).strip(),
            "why": str(data.get("why", "")).strip(),
            "posts": posts,
            "reply_tip": str(data.get("reply_tip", "")).strip(),
        }
    raise RuntimeError(f"3번 시도했지만 세트를 만들지 못했습니다: {last_error}")


SAMPLE = {
    "product": "아이 실내화·운동화",
    "search": "유아 실내화",
    "why": "새 학기 실내화 갈아 줄 때",
    "posts": [
        {"kind": "daily", "text": "다들 맛점 ~", "photo": "오늘 점심 사진 1~2장"},
        {"kind": "teaser", "text": "애 실내화 새로 샀는데 [밟았을 때 느낌 한 단어] ;; 이 색 소화 가능? 불가능?",
         "photo": "실내화 정면 + 신은 발 사진"},
        {"kind": "ad", "text": f"[광고] {DISCLOSURE}\n\n자세히 보면 예쁜 것 같기두 ㅎㅎ\n\n[쿠팡 링크]", "photo": ""},
        {"kind": "follow", "text": "오늘도 스친 구하는 중👀\n하트 하나 남기고 가면 나도 바로 스하리 갈게🔥", "photo": ""},
    ],
    "reply_tip": "짧게, 반말로, 이모지 하나",
}


# ─────────────────────────────────────────────────────────────
# 3. HTML 페이지
# ─────────────────────────────────────────────────────────────

PAGE_STYLE = """
body{font-family:"Malgun Gothic","맑은 고딕",-apple-system,BlinkMacSystemFont,sans-serif;
  max-width:640px;margin:0 auto;padding:28px 16px 60px;line-height:1.65;color:#1a1a1a;background:#fff}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:18px;margin:36px 0 12px}
.sub{color:#888;font-size:14px}
.prod{margin:16px 0 0;padding:14px 16px;background:#f6f3ee;border-radius:12px}
.prod b{font-size:17px}
.prod a{float:right;font-size:12px;color:#c0392b;font-weight:700;text-decoration:none}
.prod small{display:block;color:#666;font-size:13px;margin-top:2px}
.post{border:1px solid #e6e6e6;border-radius:14px;padding:16px;margin-bottom:16px}
.ph{font-weight:800;font-size:15px;margin-bottom:4px}
.when{font-size:13px;color:#666;margin-bottom:10px}
.body{white-space:pre-wrap;font-size:15px;padding:12px;background:#fafafa;border-radius:10px}
.photo{font-size:13px;color:#2b4c7e;margin-top:8px}
mark{background:#fff1a8;border-radius:4px;padding:0 2px}
.row{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
.btn{font:inherit;font-size:14px;font-weight:700;padding:9px 16px;border:none;border-radius:10px;
  background:#1a1a1a;color:#fff;cursor:pointer}
.cnt{font-size:13px;color:#888;margin-left:auto}
.cnt.over{color:#c0392b;font-weight:700}
.posted{font-size:13px;color:#1a7f37;font-weight:700}
.snip{display:flex;flex-wrap:wrap;gap:6px}
.snip button{font:inherit;font-size:13px;padding:6px 10px;border:1px solid #ddd;border-radius:999px;background:#fff;cursor:pointer}
.rules{font-size:13px;color:#666;background:#f7f7f7;border-radius:12px;padding:14px 16px 14px 32px;margin-top:36px}
.rules li{margin-bottom:4px}
a.more{color:#2b4c7e}
"""

PAGE_SCRIPT = """
const LIMIT=%d;
function done(b){const o=b.textContent;b.textContent='복사됨 ✓';setTimeout(()=>b.textContent=o,1500);}
function fallback(t,b){const a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';
  document.body.appendChild(a);a.select();try{document.execCommand('copy');done(b);}catch(e){window.prompt('길게 눌러 복사하세요',t);}a.remove();}
function copy(t,b){if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(()=>done(b),()=>fallback(t,b));}else{fallback(t,b);}}
document.querySelectorAll('.copy').forEach(b=>b.addEventListener('click',()=>copy(b.dataset.t,b)));
document.querySelectorAll('.cnt').forEach(el=>{const n=[...el.dataset.t].length;el.textContent=n+' / '+LIMIT+'자';el.classList.toggle('over',n>LIMIT);});
""" % THREADS_LIMIT

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex">
<title>오늘 스레드 {day}</title>
<style>{style}</style></head><body>
<h1>오늘 스레드 세트</h1>
<div class="sub">{day} · {niche} · <a class="more" href="index.html">지난 세트</a></div>
<div class="prod"><a href="https://www.coupang.com/np/search?q={search}" target="_blank" rel="noopener">쿠팡에서 찾기 ›</a>
<b>오늘 상품: {product}</b><small>{why}</small></div>

<h2>✍️ 올리는 순서대로</h2>
<p class="sub">[복사]를 누르면 그대로 붙여넣을 수 있어요. <mark>[노란 칸]</mark>은 직접 찍은 사진·느낌으로 채우세요.</p>
{posts}

<h2>💬 댓글 답변 (눌러서 복사)</h2>
<p class="sub">{reply_tip}</p>
<div class="snip">{snips}</div>

<ul class="rules">
<li>글 하나에 링크 하나, 그것도 [광고] 글에만. 본문에 링크를 넣으면 노출이 확 줄어요.</li>
<li>[칸]을 못 채운 글은 올리지 마세요. 안 써 본 상품을 써 본 것처럼 쓰면 가짜 후기(표시광고법)예요.</li>
<li>광고 문구는 [광고] 글 맨 위에, 지우지 말고 그대로.</li>
<li>댓글은 전부, 짧게, 빨리. 올린 뒤 30분은 댓글만 달아 주세요.</li>
<li>스친 글은 하루 1개까지. 같은 문장을 반복하면 스팸으로 분류돼요.</li>
<li>링크는 <a class="more" href="https://partners.coupang.com/">쿠팡 파트너스</a>에서 만들어 넣으세요.</li>
</ul>
<script>{script}</script>
</body></html>
"""


def mark_blanks(s):
    return re.sub(r"\[([^\[\]\n]{1,80})\]", r"<mark>[\1]</mark>", s)


def render_post(p, posted_url=None):
    label, when = KIND_LABEL[p["kind"]]
    photo = f'<div class="photo">📷 {esc(p["photo"])}</div>' if p["photo"] else ""
    posted = f'<a class="posted" href="{esc(posted_url)}" target="_blank" rel="noopener">✅ 자동으로 올렸어요 ›</a>' if posted_url else ""
    return f"""<div class="post">
<div class="ph">{esc(label)}</div><div class="when">{esc(when)}</div>
<div class="body">{mark_blanks(esc(p["text"]))}</div>{photo}
<div class="row"><button class="btn copy" data-t="{esc(p["text"])}">복사</button>{posted}
<span class="cnt" data-t="{esc(p["text"])}"></span></div>
</div>"""


def render_page(plan, posted):
    posts = "\n".join(render_post(p, posted.get(p["kind"])) for p in plan["posts"])
    snips = "".join(f'<button class="copy" data-t="{esc(s)}">{esc(s)}</button>' for s in REPLY_SNIPPETS)
    return PAGE_TEMPLATE.format(
        day=esc(DAY_LABEL), niche=esc(NICHE), product=esc(plan["product"]),
        search=requests.utils.quote(plan["search"]), why=esc(plan["why"]),
        posts=posts, reply_tip=esc(plan["reply_tip"]), snips=snips,
        style=PAGE_STYLE, script=PAGE_SCRIPT,
    )


INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex">
<title>오늘 스레드 세트</title>
<style>
body{{font-family:"Malgun Gothic","맑은 고딕",-apple-system,sans-serif;max-width:640px;
margin:0 auto;padding:40px 20px;line-height:1.7;color:#1a1a1a;background:#fff}}
h1{{font-size:26px;margin-bottom:4px}} .sub{{color:#888;font-size:14px;margin-bottom:32px}}
ul{{list-style:none;padding:0}} li{{padding:16px 0;border-bottom:1px solid #eee}}
a{{color:#1a1a1a;text-decoration:none;font-weight:600;font-size:17px}} a:hover{{text-decoration:underline}}
.d{{display:block;color:#aaa;font-size:13px;font-weight:400;margin-top:3px}}
</style></head><body>
<h1>오늘 스레드 세트</h1>
<div class="sub">매일 아침, 그날 올릴 {niche} 글 4개</div>
<ul>
{items}
</ul>
</body></html>
"""


def render_index(days):
    items = "\n".join(
        f'<li><a href="{esc(d["file"])}">{esc(d["product"])}<span class="d">{esc(d["label"])}</span></a></li>'
        for d in reversed(days)
    )
    return INDEX_TEMPLATE.format(niche=esc(NICHE), items=items)


# ─────────────────────────────────────────────────────────────
# 4. 스레드 공식 API — 사진이 필요 없는 글만 자동 게시
# ─────────────────────────────────────────────────────────────

def threads_post(text, topic_tag=None):
    """글 하나를 올리고 permalink 를 돌려준다. 실패하면 예외."""
    params = {"media_type": "TEXT", "text": text, "access_token": THREADS_TOKEN}
    if topic_tag:
        params["topic_tag"] = topic_tag
    r = requests.post(f"{THREADS_API}/me/threads", data=params, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"컨테이너 생성 실패 ({r.status_code}): {r.text[:300]}")
    creation_id = r.json()["id"]
    time.sleep(3)  # 스레드가 컨테이너를 처리할 시간
    r = requests.post(f"{THREADS_API}/me/threads_publish",
                      data={"creation_id": creation_id, "access_token": THREADS_TOKEN}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"게시 실패 ({r.status_code}): {r.text[:300]}")
    media_id = r.json()["id"]
    r = requests.get(f"{THREADS_API}/{media_id}",
                     params={"fields": "permalink", "access_token": THREADS_TOKEN}, timeout=30)
    return r.json().get("permalink") if r.status_code == 200 else f"https://www.threads.net/post/{media_id}"


def threads_refresh_token():
    """장기 토큰은 60일짜리. 매일 갱신해 두면 끊기지 않는다 (발급 24시간 뒤부터 갱신 가능)."""
    r = requests.get("https://graph.threads.net/refresh_access_token",
                     params={"grant_type": "th_refresh_token", "access_token": THREADS_TOKEN}, timeout=30)
    if r.status_code == 200 and r.json().get("access_token"):
        new = r.json()["access_token"]
        if new != THREADS_TOKEN:
            update_github_secret("THREADS_ACCESS_TOKEN", new)
            log("스레드 토큰 갱신")
    else:
        log(f"스레드 토큰 갱신 건너뜀 ({r.status_code}): {r.text[:120]}")


def auto_post(plan):
    posted = {}
    if not (THREADS_TOKEN and AUTO_POST):
        return posted
    for p in plan["posts"]:
        if p["kind"] != "follow":
            continue  # 사진·링크가 필요한 글은 사람이 올린다
        try:
            posted[p["kind"]] = threads_post(p["text"], FOLLOW_TOPIC or None)
            log(f"스레드 자동 게시: {p['kind']} → {posted[p['kind']]}")
        except Exception as e:
            log(f"스레드 자동 게시 실패({p['kind']}): {e} — 페이지에서 복사해 올리세요")
    try:
        threads_refresh_token()
    except Exception as e:
        log(f"스레드 토큰 갱신 실패: {e}")
    return posted


# ─────────────────────────────────────────────────────────────
# 5. 카카오톡
# ─────────────────────────────────────────────────────────────

def send_kakao(access_token, plan, page_url, posted):
    head = f"🧵 오늘 스레드 세트 ({DAY_LABEL})\n📦 {plan['product']}"
    tail = "④ 스친 글은 자동으로 올렸어요" if posted.get("follow") else "①②③④ 순서로 복사해 올리세요"
    text = "\n\n".join([head, tail, page_url])[:200]
    template = {
        "object_type": "text", "text": text,
        "link": {"web_url": page_url, "mobile_web_url": page_url},
        "button_title": "오늘 글 복사",
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
    sample = "--sample" in sys.argv
    history = load_history()

    if sample:
        plan, posted, access_token = SAMPLE, {}, None
    else:
        access_token, new_refresh = refresh_kakao_token()
        if new_refresh:
            update_github_secret("KAKAO_REFRESH_TOKEN", new_refresh)
        plan = make_set(history)
        posted = auto_post(plan)

    os.makedirs(OUT_DIR, exist_ok=True)
    filename = f"{DAY_STR}.html"
    with open(os.path.join(OUT_DIR, filename), "w", encoding="utf-8") as f:
        f.write(render_page(plan, posted))
    log(f"HTML 저장: {OUT_DIR}/{filename}")

    history["days"] = [d for d in history["days"] if d["date"] != DAY_STR]
    follow = next((p["text"] for p in plan["posts"] if p["kind"] == "follow"), "")
    history["days"].append({"date": DAY_STR, "label": DAY_LABEL, "file": filename,
                            "product": plan["product"], "follow": follow, "posted": posted})
    history["days"].sort(key=lambda d: d["date"])
    save_history(history)
    with open(os.path.join(OUT_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(render_index(history["days"]))

    if sample:
        log("예시 모드: 카카오톡은 보내지 않았습니다")
        return
    page_url = f"{PAGES_URL}/threads-daily/{filename}" if PAGES_URL else filename
    send_kakao(access_token, plan, page_url, posted)


if __name__ == "__main__":
    main()
