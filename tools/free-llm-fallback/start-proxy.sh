#!/usr/bin/env bash
# LiteLLM 프록시를 127.0.0.1:4000 에 띄웁니다. 이 창은 켜 둔 채로 다른 창에서 claude-free 를 쓰세요.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo ".env 가 없습니다. 먼저:  cp .env.example .env  하고 키를 채우세요." >&2
  exit 1
fi
set -a; . ./.env; set +a

if ! command -v litellm >/dev/null 2>&1; then
  echo "litellm 설치 중..."
  pip install -q 'litellm[proxy]'
fi

exec litellm --config litellm.config.yaml --host 127.0.0.1 --port "${LITELLM_PORT:-4000}"
