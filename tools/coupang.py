"""쿠팡 파트너스 Open API: 상품 검색 + 파트너스 링크(딥링크) 만들기.

키는 코드나 채팅에 넣지 않고 환경 변수로만 읽는다.
  COUPANG_ACCESS_KEY  쿠팡 파트너스 > 추가기능 > Open API 의 Access Key
  COUPANG_SECRET_KEY  같은 화면의 Secret Key
(Claude Code 클라우드 환경 설정의 환경 변수, 또는 GitHub Actions 시크릿)

사용 예:
  python tools/coupang.py search "유아 안전가위" --limit 5
  python tools/coupang.py link "https://www.coupang.com/vp/products/123456"
  python tools/coupang.py search "피스카스 유아 가위" --json   # 다른 스크립트에서 쓰기 좋게

검색 API는 쿠팡이 호출 횟수를 제한한다(대략 분당 몇 번 수준). 같은 검색어를 반복해서 부르지 말 것.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HOST = "https://api-gateway.coupang.com"
BASE = "/v2/providers/affiliate_open_api/apis/openapi"
DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."


class CoupangError(RuntimeError):
    pass


def _keys() -> tuple[str, str]:
    ak = os.environ.get("COUPANG_ACCESS_KEY", "").strip()
    sk = os.environ.get("COUPANG_SECRET_KEY", "").strip()
    if not ak or not sk:
        raise CoupangError(
            "COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 환경 변수가 없어요. "
            "환경 설정(또는 GitHub 시크릿)에 두 키를 넣은 뒤 다시 실행하세요."
        )
    return ak, sk


def _auth(method: str, path: str, query: str, ak: str, sk: str) -> str:
    signed_date = time.strftime("%y%m%dT%H%M%SZ", time.gmtime())
    message = signed_date + method + path + query
    sig = hmac.new(sk.encode(), message.encode(), hashlib.sha256).hexdigest()
    return f"CEA algorithm=HmacSHA256, access-key={ak}, signed-date={signed_date}, signature={sig}"


def _call(method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict:
    ak, sk = _keys()
    query = urllib.parse.urlencode(params or {})
    url = HOST + path + (f"?{query}" if query else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", _auth(method, path, query, ak, sk))
    req.add_header("Content-Type", "application/json;charset=UTF-8")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            out = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        if e.code == 401:
            raise CoupangError(f"인증 실패(401). 키가 맞는지, 시크릿 키를 바꿨다면 새 키로 넣었는지 확인하세요. {detail}")
        if e.code == 429:
            raise CoupangError("쿠팡 호출 제한에 걸렸어요(429). 1분쯤 뒤에 다시 하세요.")
        raise CoupangError(f"쿠팡 API 오류 {e.code}: {detail}")
    if str(out.get("rCode", "0")) not in ("0", "200"):
        raise CoupangError(f"쿠팡 API 응답 오류: {out.get('rCode')} {out.get('rMessage')}")
    return out


def search(keyword: str, limit: int = 5) -> list[dict]:
    """검색어로 상품을 찾는다. 결과의 productUrl 은 이미 파트너스 링크다."""
    out = _call("GET", f"{BASE}/products/search", {"keyword": keyword, "limit": max(1, min(limit, 10))})
    items = (out.get("data") or {}).get("productData") or []
    return [
        {
            "name": it.get("productName"),
            "price": it.get("productPrice"),
            "rocket": bool(it.get("isRocket")),
            "free_shipping": bool(it.get("isFreeShipping")),
            "image": it.get("productImage"),
            "link": it.get("productUrl"),
            "category": it.get("categoryName"),
        }
        for it in items
    ]


def deeplink(urls: list[str]) -> list[dict]:
    """일반 쿠팡 상품 주소를 파트너스 링크로 바꾼다."""
    out = _call("POST", f"{BASE}/v1/deeplink", body={"coupangUrls": urls})
    return [
        {"original": d.get("originalUrl"), "short": d.get("shortenUrl"), "landing": d.get("landingUrl")}
        for d in (out.get("data") or [])
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="쿠팡 파트너스 상품 검색 / 링크 변환")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search", help="상품 검색")
    s.add_argument("keyword")
    s.add_argument("--limit", type=int, default=5)
    s.add_argument("--json", action="store_true")
    l = sub.add_parser("link", help="쿠팡 주소 → 파트너스 링크")
    l.add_argument("urls", nargs="+")
    l.add_argument("--json", action="store_true")
    a = ap.parse_args()
    try:
        if a.cmd == "search":
            rows = search(a.keyword, a.limit)
            if a.json:
                print(json.dumps(rows, ensure_ascii=False, indent=2))
            else:
                for i, r in enumerate(rows, 1):
                    tag = " 로켓" if r["rocket"] else ""
                    print(f"{i}. {r['name']} — {int(r['price'] or 0):,}원{tag}\n   {r['link']}")
                if not rows:
                    print("검색 결과가 없어요.")
        else:
            rows = deeplink(a.urls)
            if a.json:
                print(json.dumps(rows, ensure_ascii=False, indent=2))
            else:
                for r in rows:
                    print(f"{r['original']}\n → {r['short']}")
        return 0
    except CoupangError as e:
        print(f"오류: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
