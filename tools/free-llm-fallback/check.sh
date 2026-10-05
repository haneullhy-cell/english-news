#!/usr/bin/env bash
# 프록시가 Anthropic 형식(/v1/messages)으로 답하는지, 어느 모델이 받았는지 확인합니다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/.env" ] && { set -a; . "$HERE/.env"; set +a; }
PORT="${LITELLM_PORT:-4000}"
for m in free free-fast; do
  echo "== $m"
  curl -s "http://127.0.0.1:${PORT}/v1/messages" \
    -H "x-api-key: ${LITELLM_MASTER_KEY:-sk-free-local}" \
    -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
    -d "{\"model\":\"$m\",\"max_tokens\":40,\"messages\":[{\"role\":\"user\",\"content\":\"한 단어로 인사해\"}]}" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("model"), "->", "".join(b.get("text","") for b in d.get("content",[])) or d)'
done
