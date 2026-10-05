#!/usr/bin/env bash
# 무료 API 프록시를 통해 Claude Code 를 실행합니다. (평소 `claude` 는 그대로 Anthropic 을 씁니다)
# 사용:  ./claude-free.sh            또는   ./claude-free.sh "이 함수 리팩터링해 줘"
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/.env" ] && { set -a; . "$HERE/.env"; set +a; }

PORT="${LITELLM_PORT:-4000}"
if ! curl -sf "http://127.0.0.1:${PORT}/health/liveliness" >/dev/null 2>&1; then
  echo "프록시가 꺼져 있습니다. 다른 터미널에서 먼저:  $HERE/start-proxy.sh" >&2
  exit 1
fi

export ANTHROPIC_BASE_URL="http://127.0.0.1:${PORT}"
export ANTHROPIC_AUTH_TOKEN="${LITELLM_MASTER_KEY:-sk-free-local}"
unset ANTHROPIC_API_KEY

# 모든 등급을 프록시의 'free' 체인으로. 가벼운 작업은 'free-fast' 체인으로.
export ANTHROPIC_MODEL="free"
export ANTHROPIC_SMALL_FAST_MODEL="free-fast"
export ANTHROPIC_DEFAULT_OPUS_MODEL="free"
export ANTHROPIC_DEFAULT_SONNET_MODEL="free"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="free-fast"

export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export API_TIMEOUT_MS=180000

exec claude "$@"
