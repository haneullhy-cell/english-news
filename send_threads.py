#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
매주 일요일 저녁, 다음 주(월~금)에 스레드에 올릴 육아템 글감을 만들어서
카카오톡 "나와의 채팅"으로 보냅니다.

동작 순서:
  1. 앞으로 6주 안의 명절·기념일과 이번 달·다음 달 계절 이슈 뽑기
  2. AI로 이번 주 키워드 6개 + 월~금 글 초안 5개 + 미리 준비할 주제 만들기
     (직접 써 봐야 알 수 있는 부분은 지어내지 않고 [대괄호 칸]으로 비워 둠)
  3. 복사 버튼이 있는 HTML 페이지로 저장 (GitHub Pages로 공개됨)
  4. 카카오톡으로 주제 + 키워드 + 링크 발송

카카오 토큰·Gemini 호출은 send_news.py 것을 그대로 씁니다.
GitHub Actions에서 매주 자동 실행됩니다.
"""

import os
import sys
import json
import re
import time
from datetime import date, timedelta
from urllib.parse import quote

import requests

from send_news import (
    TODAY, DOCS_DIR, PAGES_URL,
    log, esc, call_gemini, refresh_kakao_token, update_github_secret,
)

# ─────────────────────────────────────────────────────────────
# 설정 — 계정 콘셉트를 바꾸고 싶으면 여기만 고치면 됩니다
# ─────────────────────────────────────────────────────────────

NICHE = "육아템"
AUDIENCE = "영유아(0~3세)와 초등 저학년 아이를 키우는 엄마·아빠"

# 쿠팡 파트너스 링크가 들어가는 글에는 이 문구가 꼭 있어야 합니다 (공정위 지침)
DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."

THREADS_LIMIT = 500      # 스레드 글 하나의 최대 글자 수
BODY_LIMIT = 350         # 첫 줄 + 광고 문구를 붙여도 500자를 넘지 않도록
LOOKAHEAD_DAYS = 42      # 명절·기념일을 몇 일 앞까지 볼지 (선물·준비물은 3~5주 전부터 찾음)

OUT_DIR = os.path.join(DOCS_DIR, "threads")
HISTORY_FILE = os.path.join(OUT_DIR, "history.json")

DAYS = ["월", "화", "수", "목", "금"]

# 다음 주 월요일 (일요일에 돌리면 내일, 월요일에 돌리면 다음 주 월요일)
MONDAY = (TODAY + timedelta(days=(7 - TODAY.weekday()) % 7 or 7)).date()
WEEK_STR = MONDAY.isoformat()
FRIDAY = MONDAY + timedelta(days=4)
WEEK_LABEL = f"{MONDAY.month}/{MONDAY.day}~{FRIDAY.month}/{FRIDAY.day}"


# ─────────────────────────────────────────────────────────────
# 1. 달력 — 다가오는 명절·기념일, 계절 이슈
# ─────────────────────────────────────────────────────────────

# (월, 일, 이름) — 해마다 날짜가 같은 날
FIXED_EVENTS = [
    (1, 1, "새해"),
    (2, 14, "밸런타인데이"),
    (3, 2, "어린이집·유치원 입학, 초등 새 학기"),
    (3, 14, "화이트데이"),
    (5, 5, "어린이날"),
    (5, 8, "어버이날"),
    (5, 15, "스승의 날"),
    (6, 6, "현충일"),
    (8, 15, "광복절"),
    (10, 3, "개천절"),
    (10, 9, "한글날"),
    (10, 31, "핼러윈"),
    (11, 11, "빼빼로데이"),
    (12, 25, "크리스마스"),
]

# 설날·추석은 음력이라 해마다 날짜가 바뀝니다. 2031년이 지나면 여기에 이어서 적어 주세요.
LUNAR_EVENTS = {
    "설날": ["2026-02-17", "2027-02-07", "2028-01-27", "2029-02-13", "2030-02-03", "2031-01-23"],
    "추석": ["2026-09-25", "2027-09-15", "2028-10-03", "2029-09-22", "2030-09-12", "2031-10-01"],
}

SEASONS = {
    1: "한겨울 추위·건조, 겨울방학, 독감·감기, 새 학기 준비 시작",
    2: "겨울방학 막바지, 입학·입소 준비물, 졸업",
    3: "새 학기·어린이집 적응, 환절기, 황사·미세먼지",
    4: "봄 나들이·소풍, 미세먼지·꽃가루, 킥보드·자전거",
    5: "가정의 달, 나들이, 자외선 시작, 얇은 옷",
    6: "초여름 더위, 장마 시작, 모기, 물놀이 준비, 수족구",
    7: "장마·폭염, 여름방학, 물놀이·휴가, 모기, 냉방",
    8: "폭염, 여름휴가, 여름방학 막바지, 개학 준비",
    9: "환절기 일교차, 가을 나들이, 추석, 독감 예방접종 시작",
    10: "가을 나들이·소풍, 일교차, 건조해지는 날씨, 핼러윈, 독감 예방접종",
    11: "초겨울, 난방·가습, 김장철, 크리스마스 선물 준비 시작",
    12: "한겨울, 크리스마스·연말, 겨울방학 시작, 독감·감기",
}


def upcoming_events(start, days=LOOKAHEAD_DAYS):
    """start부터 days일 안에 있는 명절·기념일을 [(날짜, 이름, D-day)]로 돌려준다."""
    end = start + timedelta(days=days)
    found = [(date(y, m, d), name)
             for y in (start.year, start.year + 1)
             for m, d, name in FIXED_EVENTS]
    for name, dates in LUNAR_EVENTS.items():
        found += [(date.fromisoformat(s), name) for s in dates]
        if date.fromisoformat(dates[-1]).year <= start.year:
            log(f"  LUNAR_EVENTS의 {name} 날짜가 곧 끝납니다. 다음 해 날짜를 추가해 주세요.")
    return sorted((dt, name, (dt - start).days)
                  for dt, name in found if start <= dt <= end)


# ─────────────────────────────────────────────────────────────
# 2. 기록 (같은 키워드를 매주 반복하지 않도록)
# ─────────────────────────────────────────────────────────────

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"weeks": []}


def save_history(hist):
    os.makedirs(OUT_DIR, exist_ok=True)
    hist["weeks"] = hist["weeks"][-52:]  # 최근 1년치만 유지
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────────────────────
# 3. AI로 글감 만들기
# ─────────────────────────────────────────────────────────────

PROMPT = """당신은 스레드(Threads)에서 {niche} 계정을 운영하는 부모를 돕는 콘텐츠 기획자입니다.
독자: {audience}

다음 주({week}, 월~금)에 하루 하나씩 올릴 글감을 만들어 주세요.

## 다가오는 일정 (다음 주 월요일 기준)
{events}

## 요즘 계절 이슈
- {m1}월: {season1}
- {m2}월: {season2}

## 최근에 이미 다룬 키워드 (되도록 겹치지 않게)
{used}

## 꼭 지킬 것
1. 경험을 지어내지 마세요. 글쓴이가 실제로 써 봤는지 당신은 모릅니다.
   사용 후기, 아이 반응, 고른 이유처럼 직접 겪어야 쓸 수 있는 부분은
   반드시 [대괄호 칸]으로 비워 두고, 칸 안에 무엇을 채우면 되는지 짧게 적으세요.
   예: [우리 아이가 처음 썼을 때 반응 한 줄]
2. 브랜드·모델명·가격·할인율·수치 스펙을 쓰지 마세요. 상품은 글쓴이가 직접 고릅니다.
   "가열식 가습기", "빨대컵"처럼 종류로만 쓰세요.
3. 효과·안전을 장담하는 말(낫는다, 100% 안전, 의사 추천 등)과 불안을 부추기는 말은 쓰지 마세요.
   아기 용품은 "사용 연령·KC 인증 확인하기"처럼 확인할 점을 알려 주는 쪽으로 쓰세요.
4. "100명 중 97명", "이거 모르면 손해" 같은 과장된 낚시 문구는 쓰지 마세요.
   궁금증은 구체적인 육아 상황으로 만드세요.
5. 광고 표시 문구(쿠팡 파트너스 ...)는 쓰지 마세요. 프로그램이 알아서 붙입니다.

## 스레드 글 형식
- body(본문)는 공백 포함 {body_limit}자 이내. 짧은 줄 여러 개, 줄바꿈 많이. 이모지는 글 하나에 3개 이하.
- hooks(첫 줄 후보)는 본문과 따로, 서로 다른 느낌으로 3개. 각 40자 이내. 본문에 다시 쓰지 마세요.
- 5개 글의 유형을 하나씩 섞으세요:
  체크리스트형, 비교형(이런 집엔 A / 저런 집엔 B), 경험 공유형([칸] 포함),
  미리 준비형(다가오는 일정 대비), 질문형(링크 없이 댓글 대화 유도)
- 질문형만 has_link를 false로, 나머지는 true로.
- reply: 쿠팡 링크와 함께 첫 댓글로 달 한 줄 (has_link가 false면 빈 문자열).
- check: 올리기 전에 글쓴이가 직접 확인할 점 한 줄.

## 출력 (JSON만)
{{
  "theme": "다음 주 전체를 묶는 한 줄 주제",
  "keywords": [
    {{"keyword": "키워드", "why": "왜 지금인지 한 줄", "search": "쿠팡 검색창에 넣을 검색어"}}
  ],
  "posts": [
    {{"day": "월", "type": "체크리스트형", "keyword": "관련 키워드",
      "hooks": ["첫 줄 후보1", "첫 줄 후보2", "첫 줄 후보3"],
      "body": "본문", "has_link": true, "reply": "첫 댓글 한 줄", "check": "올리기 전 확인할 점"}}
  ],
  "prep": [
    {{"topic": "3~6주 뒤를 위해 지금부터 모아 둘 주제", "when": "언제쯤 올릴지", "why": "이유 한 줄"}}
  ]
}}
keywords는 6개, posts는 월·화·수·목·금 5개, prep는 2~3개.
"""


def strip_disclosure(text):
    """AI가 광고 문구를 넣었으면 뺀다 (프로그램이 한 번만 붙인다)."""
    lines = [ln for ln in str(text).split("\n")
             if not re.search(r"쿠팡\s*파트너스|수수료를\s*제공받", ln)]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def clean_post(p, i):
    hooks = [str(h).strip() for h in (p.get("hooks") or []) if str(h).strip()][:3]
    body = strip_disclosure(p.get("body", ""))
    # 첫 줄 후보를 본문 첫 줄에 또 쓴 경우 떼어낸다
    for h in hooks:
        if body.startswith(h):
            body = body[len(h):].strip()
            break
    has_link = str(p.get("has_link", True)).strip().lower() not in ("false", "0", "no", "")
    return {
        "day": str(p.get("day") or DAYS[i % 5]).strip()[:1],
        "type": str(p.get("type", "")).strip(),
        "keyword": str(p.get("keyword", "")).strip(),
        "hooks": hooks,
        "body": body,
        "has_link": has_link,
        "reply": str(p.get("reply", "")).strip() if has_link else "",
        "check": str(p.get("check", "")).strip(),
    }


def make_plan(events, history):
    """AI 호출 + JSON 파싱. 실패하면 최대 3번까지 다시 시도한다."""
    used = [k for w in history["weeks"][-8:] for k in w.get("keywords", [])]
    m1 = MONDAY.month
    m2 = m1 % 12 + 1
    prompt = PROMPT.format(
        niche=NICHE, audience=AUDIENCE, week=WEEK_LABEL,
        events="\n".join(f"- {name}: {dt.month}/{dt.day} (D-{dd})" for dt, name, dd in events)
               or "- (6주 안에 큰 명절·기념일 없음)",
        m1=m1, season1=SEASONS[m1], m2=m2, season2=SEASONS[m2],
        used=", ".join(used) or "(없음)",
        body_limit=BODY_LIMIT,
    )

    last_error = None
    for attempt in range(1, 4):
        log(f"AI로 다음 주 스레드 글감 만드는 중... (시도 {attempt}/3)")
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
        except json.JSONDecodeError as e:
            m = re.search(r"\{.*\}", text, re.S)
            try:
                data = json.loads(m.group(0)) if m else None
            except json.JSONDecodeError:
                data = None
            if data is None:
                last_error = e
                log(f"  JSON 파싱 실패, 다시 시도합니다: {e}")
                continue

        posts = [clean_post(p, i) for i, p in enumerate(data.get("posts") or [])
                 if isinstance(p, dict)]
        posts = [p for p in posts if p["hooks"] and p["body"]]
        keywords = [k for k in (data.get("keywords") or [])
                    if isinstance(k, dict) and k.get("keyword")]
        if not data.get("theme") or len(posts) < 3 or not keywords:
            last_error = RuntimeError(
                f"항목 부족 — theme {bool(data.get('theme'))}, "
                f"글 {len(posts)}개, 키워드 {len(keywords)}개")
            log(f"  {last_error}, 다시 시도합니다")
            continue

        for p in posts:
            n = len(full_text(p))
            if n > THREADS_LIMIT:
                log(f"  ({p['day']}) {n}자 — 스레드 한도 {THREADS_LIMIT}자를 넘습니다. 올리기 전에 줄여 주세요.")

        return {
            "theme": str(data["theme"]).strip(),
            "keywords": [{"keyword": str(k["keyword"]).strip(),
                          "why": str(k.get("why", "")).strip(),
                          "search": str(k.get("search") or k["keyword"]).strip()}
                         for k in keywords],
            "posts": posts,
            "prep": [p for p in (data.get("prep") or [])
                     if isinstance(p, dict) and p.get("topic")],
        }

    raise RuntimeError(f"3번 시도했지만 글감을 만들지 못했습니다: {last_error}")


def full_text(post, hook_index=0):
    """스레드에 그대로 붙여넣을 글 (첫 줄 + 본문 + 광고 문구)."""
    parts = [post["hooks"][hook_index], post["body"]]
    if post["has_link"]:
        parts.append(DISCLOSURE)
    return "\n\n".join(parts)


# ─────────────────────────────────────────────────────────────
# 4. HTML 페이지
# ─────────────────────────────────────────────────────────────

PAGE_STYLE = """
body{font-family:"Malgun Gothic","맑은 고딕",-apple-system,BlinkMacSystemFont,sans-serif;
  max-width:640px;margin:0 auto;padding:28px 16px 60px;line-height:1.65;color:#1a1a1a;background:#fff}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:18px;margin:36px 0 12px}
.sub{color:#888;font-size:14px}
.theme{font-size:17px;font-weight:700;margin:16px 0 0;padding:14px 16px;background:#f6f3ee;border-radius:12px}
.ev{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.ev span{font-size:13px;padding:4px 10px;border-radius:999px;background:#eef3fb;color:#2b4c7e}
.kw{display:grid;gap:8px}
.kw a{display:block;padding:12px 14px;border:1px solid #e6e6e6;border-radius:12px;color:inherit;text-decoration:none}
.kw b{font-size:16px}
.kw small{display:block;color:#666;font-size:13px;margin-top:2px}
.kw em{float:right;font-style:normal;font-size:12px;color:#c0392b;font-weight:700}
.post{border:1px solid #e6e6e6;border-radius:14px;padding:16px;margin-bottom:16px}
.ph{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.day{font-weight:800;font-size:15px;background:#1a1a1a;color:#fff;border-radius:8px;padding:2px 9px}
.type{font-size:13px;color:#555;background:#f2f2f2;border-radius:999px;padding:2px 10px}
.pk{font-size:13px;color:#888}
.lbl{font-size:12px;color:#999;margin:10px 0 4px}
.hook{display:block;width:100%;text-align:left;font:inherit;font-size:15px;font-weight:600;
  padding:9px 12px;margin-bottom:6px;border:1px solid #e0e0e0;border-radius:10px;background:#fff;color:inherit;cursor:pointer}
.hook.on{border-color:#1a1a1a;background:#fafafa;box-shadow:inset 3px 0 0 #1a1a1a}
.body{white-space:pre-wrap;font-size:15px;padding:12px;background:#fafafa;border-radius:10px}
.ad{white-space:pre-wrap;font-size:13px;color:#777;padding:0 12px;margin-top:8px}
mark{background:#fff1a8;border-radius:4px;padding:0 2px}
.row{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
.btn{font:inherit;font-size:14px;font-weight:700;padding:9px 16px;border:none;border-radius:10px;
  background:#1a1a1a;color:#fff;cursor:pointer}
.btn.sub2{background:#eee;color:#1a1a1a}
.cnt{font-size:13px;color:#888;margin-left:auto}
.cnt.over{color:#c0392b;font-weight:700}
.reply{font-size:14px;margin-top:10px;padding:10px 12px;border-left:3px solid #ddd;color:#444}
.check{font-size:13px;color:#8a5a00;margin-top:10px}
.prep li{margin-bottom:8px}
.rules{font-size:13px;color:#666;background:#f7f7f7;border-radius:12px;padding:14px 16px 14px 32px;margin-top:36px}
.rules li{margin-bottom:4px}
a.more{color:#2b4c7e}
"""

PAGE_SCRIPT = """
const POSTS = JSON.parse(document.getElementById('posts').textContent);
const LIMIT = %d;
function textOf(i){const p=POSTS[i];return [p.hooks[p.pick],p.body,p.ad].filter(Boolean).join('\\n\\n');}
function done(btn){const o=btn.textContent;btn.textContent='복사됨 ✓';setTimeout(()=>btn.textContent=o,1500);}
function fallback(t,btn){const a=document.createElement('textarea');a.value=t;a.style.position='fixed';
  a.style.opacity='0';document.body.appendChild(a);a.select();
  try{document.execCommand('copy');done(btn);}catch(e){window.prompt('길게 눌러 복사하세요',t);}a.remove();}
function copy(t,btn){if(navigator.clipboard&&window.isSecureContext){
  navigator.clipboard.writeText(t).then(()=>done(btn),()=>fallback(t,btn));}else{fallback(t,btn);}}
function count(i){const n=[...textOf(i)].length;const el=document.getElementById('cnt'+i);
  el.textContent=n+' / '+LIMIT+'자';el.classList.toggle('over',n>LIMIT);}
POSTS.forEach((p,i)=>{p.pick=0;count(i);});
document.querySelectorAll('.hook').forEach(b=>b.addEventListener('click',()=>{
  const i=+b.dataset.i;POSTS[i].pick=+b.dataset.h;
  document.querySelectorAll('.hook[data-i="'+i+'"]').forEach(x=>x.classList.toggle('on',x===b));count(i);}));
document.querySelectorAll('.copy').forEach(b=>b.addEventListener('click',()=>copy(textOf(+b.dataset.i),b)));
document.querySelectorAll('.copy-reply').forEach(b=>b.addEventListener('click',()=>copy(POSTS[+b.dataset.i].reply,b)));
""" % THREADS_LIMIT

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex">
<title>스레드 글감 {week}</title>
<style>{style}</style></head><body>
<h1>다음 주 스레드 글감</h1>
<div class="sub">{week} · {niche} · <a class="more" href="index.html">지난 글감</a></div>
<div class="theme">{theme}</div>
<div class="ev">{events}</div>

<h2>🔑 이번 주 키워드</h2>
<div class="kw">{keywords}</div>

<h2>✍️ 요일별 초안</h2>
<p class="sub">첫 줄을 골라 누르고 [복사]하면 첫 줄 + 본문 + 광고 문구가 한 번에 복사돼요.
<mark>[노란 칸]</mark>은 직접 겪은 이야기로 채워 주세요.</p>
{posts}

<h2>📦 지금부터 모아 둘 주제</h2>
<ul class="prep">{prep}</ul>

<ul class="rules">
<li>[칸]을 채우지 못한 글은 올리지 마세요. 써 보지 않은 상품을 써 본 것처럼 쓰면 표시광고법 위반(가짜 후기)이 될 수 있어요.</li>
<li>링크가 있는 글에는 광고 문구를 지우지 말고, '더보기' 뒤로 숨지 않게 짧게 유지하세요.</li>
<li>아기 용품은 사용 연령과 KC 인증을 직접 확인한 뒤 링크를 거세요.</li>
<li>같은 글을 조금씩 바꿔 여러 번 올리면 스팸으로 분류돼 노출이 줄 수 있어요.</li>
<li>링크는 <a class="more" href="https://partners.coupang.com/">쿠팡 파트너스</a>에서 만들어 첫 댓글에 달아 주세요.</li>
</ul>
<script id="posts" type="application/json">{data}</script>
<script>{script}</script>
</body></html>
"""


def mark_blanks(s):
    """[채울 칸]을 노란색으로 표시한다. (esc 뒤에 부른다)"""
    return re.sub(r"\[([^\[\]\n]{1,80})\]", r"<mark>[\1]</mark>", s)


def render_post(p, i):
    hooks = "".join(
        f'<button class="hook{" on" if h == 0 else ""}" data-i="{i}" data-h="{h}">{esc(t)}</button>'
        for h, t in enumerate(p["hooks"])
    )
    reply = ""
    if p["reply"]:
        reply = (f'<div class="reply">💬 첫 댓글: {esc(p["reply"])} + 쿠팡 링크</div>')
    ad = f'<div class="ad">{esc(DISCLOSURE)}</div>' if p["has_link"] else ""
    reply_btn = (f'<button class="btn sub2 copy-reply" data-i="{i}">댓글 복사</button>'
                 if p["reply"] else "")
    check = f'<div class="check">✅ 올리기 전: {esc(p["check"])}</div>' if p["check"] else ""
    return f"""<div class="post">
<div class="ph"><span class="day">{esc(p["day"])}</span><span class="type">{esc(p["type"])}</span>
<span class="pk">{esc(p["keyword"])}</span></div>
<div class="lbl">첫 줄 고르기</div>{hooks}
<div class="lbl">본문</div><div class="body">{mark_blanks(esc(p["body"]))}</div>{ad}
{reply}{check}
<div class="row"><button class="btn copy" data-i="{i}">복사</button>{reply_btn}
<span class="cnt" id="cnt{i}"></span></div>
</div>"""


def render_page(plan, events):
    ev = "".join(f"<span>{esc(name)} D-{dd}</span>" for _, name, dd in events)
    kws = "".join(
        f'<a href="https://www.coupang.com/np/search?q={quote(k["search"])}" target="_blank" rel="noopener">'
        f'<em>쿠팡에서 찾기 ›</em><b>{esc(k["keyword"])}</b><small>{esc(k["why"])}</small></a>'
        for k in plan["keywords"]
    )
    posts = "\n".join(render_post(p, i) for i, p in enumerate(plan["posts"]))
    prep = "".join(
        f'<li><b>{esc(p["topic"])}</b> — {esc(p.get("when", ""))}'
        f'<br><small>{esc(p.get("why", ""))}</small></li>'
        for p in plan["prep"]
    ) or "<li>(없음)</li>"
    data = [{"hooks": p["hooks"], "body": p["body"],
             "ad": DISCLOSURE if p["has_link"] else "", "reply": p["reply"]}
            for p in plan["posts"]]
    return PAGE_TEMPLATE.format(
        week=esc(WEEK_LABEL), niche=esc(NICHE), theme=esc(plan["theme"]),
        events=ev, keywords=kws, posts=posts, prep=prep,
        data=json.dumps(data, ensure_ascii=False).replace("</", "<\\/"),
        style=PAGE_STYLE, script=PAGE_SCRIPT,
    )


INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="robots" content="noindex">
<title>스레드 글감</title>
<style>
body{{font-family:"Malgun Gothic","맑은 고딕",-apple-system,sans-serif;max-width:640px;
margin:0 auto;padding:40px 20px;line-height:1.7;color:#1a1a1a;background:#fff}}
h1{{font-size:26px;margin-bottom:4px}}
.sub{{color:#888;font-size:14px;margin-bottom:32px}}
ul{{list-style:none;padding:0}}
li{{padding:16px 0;border-bottom:1px solid #eee}}
a{{color:#1a1a1a;text-decoration:none;font-weight:600;font-size:17px}}
a:hover{{text-decoration:underline}}
.d{{display:block;color:#aaa;font-size:13px;font-weight:400;margin-top:3px}}
</style></head><body>
<h1>스레드 글감</h1>
<div class="sub">매주 일요일 저녁, 다음 주 {niche} 글 초안</div>
<ul>
{items}
</ul>
</body></html>
"""


def render_index(weeks):
    items = "\n".join(
        f'<li><a href="{esc(w["file"])}">{esc(w["theme"])}'
        f'<span class="d">{esc(w["label"])} · {esc(" · ".join(w["keywords"][:4]))}</span></a></li>'
        for w in reversed(weeks)
    )
    return INDEX_TEMPLATE.format(niche=esc(NICHE), items=items)


# ─────────────────────────────────────────────────────────────
# 5. 카카오톡 발송
# ─────────────────────────────────────────────────────────────

def send_kakao(access_token, plan, page_url):
    """카카오톡 나와의 채팅으로 발송. 기본 텍스트 템플릿은 200자 제한이다."""
    theme = plan["theme"]
    if len(theme) > 60:
        theme = theme[:59] + "…"
    head = f"🧵 다음 주 스레드 글감 ({WEEK_LABEL})\n{theme}"

    # 키워드는 자리가 남는 만큼만 넣는다
    kw_line = ""
    for k in plan["keywords"]:
        cand = f"{kw_line} · {k['keyword']}" if kw_line else f"🔑 {k['keyword']}"
        if len(head) + len(cand) + len(page_url) + 4 > 195:
            break
        kw_line = cand

    text = "\n\n".join(x for x in (head, kw_line, page_url) if x)[:200]
    template = {
        "object_type": "text",
        "text": text,
        "link": {"web_url": page_url, "mobile_web_url": page_url},
        "button_title": "초안 보기 · 복사",
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
    # 카카오 로그인이 안 돼도 글감은 만들어 저장한다 (카톡만 못 보냄)
    access_token, kakao_error = None, None
    try:
        access_token, new_refresh = refresh_kakao_token()
        if new_refresh:
            update_github_secret("KAKAO_REFRESH_TOKEN", new_refresh)
    except Exception as e:
        kakao_error = e
        log(f"카카오 로그인 실패 — 글감은 그대로 만들어 저장합니다.\n{e}")

    history = load_history()
    events = upcoming_events(MONDAY)
    log(f"다음 주: {WEEK_LABEL} / 다가오는 일정: "
        + (", ".join(f"{n} D-{d}" for _, n, d in events) or "없음"))
    plan = make_plan(events, history)

    os.makedirs(OUT_DIR, exist_ok=True)
    filename = f"{WEEK_STR}.html"
    with open(os.path.join(OUT_DIR, filename), "w", encoding="utf-8") as f:
        f.write(render_page(plan, events))
    log(f"HTML 저장: {OUT_DIR}/{filename}")

    # 같은 주를 다시 만들면 기록을 덮어쓴다
    history["weeks"] = [w for w in history["weeks"] if w["date"] != WEEK_STR]
    history["weeks"].append({
        "date": WEEK_STR,
        "label": WEEK_LABEL,
        "file": filename,
        "theme": plan["theme"],
        "keywords": [k["keyword"] for k in plan["keywords"]],
    })
    history["weeks"].sort(key=lambda w: w["date"])
    save_history(history)
    with open(os.path.join(OUT_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(render_index(history["weeks"]))

    # PAGES_URL은 GitHub Actions에서 자동으로 채워집니다
    page_url = f"{PAGES_URL}/threads/{filename}" if PAGES_URL else "https://www.threads.com"
    if kakao_error:
        # 실패로 끝내야 GitHub이 알림 메일을 보낸다. 글감은 워크플로가 저장한다.
        raise RuntimeError(f"글감은 저장했지만 카톡은 못 보냈어요 → {page_url}\n{kakao_error}")
    send_kakao(access_token, plan, page_url)

    log("전부 완료!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"오류: {e}")
        sys.exit(1)
