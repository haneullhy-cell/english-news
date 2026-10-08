# Windows PowerShell 용. 프록시(start-proxy)는 먼저 켜 두세요.
#   pip install "litellm[proxy]"
#   litellm --config litellm.config.yaml --host 127.0.0.1 --port 4000   (별도 창, .env 값은 환경변수로 미리 설정)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)=([^#]*)') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim(), "Process") }
  }
}
$port = if ($env:LITELLM_PORT) { $env:LITELLM_PORT } else { "4000" }
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$port"
$env:ANTHROPIC_AUTH_TOKEN = if ($env:LITELLM_MASTER_KEY) { $env:LITELLM_MASTER_KEY } else { "sk-free-local" }
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
$env:ANTHROPIC_MODEL = "free"
$env:ANTHROPIC_SMALL_FAST_MODEL = "free-fast"
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = "free"
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = "free"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "free-fast"
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
$env:API_TIMEOUT_MS = "180000"
claude @args
