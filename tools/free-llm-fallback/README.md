# Claude Code 무료 API 폴백 세팅

Claude Code 토큰 한도에 걸려도 작업이 안 끊기게, 무료 AI API 들을 한 줄로 묶어
**한도(429)·장애가 나면 자동으로 다음 모델로 넘어가게** 하는 세팅입니다.

- 무료 API 목록 출처: [mnfst/awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis) (16곳, 모델 118개, 신용카드 불필요)
- 중간 다리: [LiteLLM 프록시](https://docs.litellm.ai/docs/proxy/reliability) — Claude Code 가 쓰는 Anthropic 형식(`/v1/messages`)을 받아 각 공급자 형식으로 바꿔 주고, 실패하면 폴백 체인을 탑니다.
- 평소 `claude` 는 그대로 Anthropic 을 씁니다. `claude-free` 로 띄울 때만 무료 체인을 탑니다.

```
Claude Code ──/v1/messages──▶ LiteLLM (127.0.0.1:4000)
                                 ├─ 1. Groq        gpt-oss-120b        30 RPM / 1,000 RPD
                                 ├─ 2. Gemini      2.5 Flash (1M ctx)  15 RPM / 1,500 RPD
                                 ├─ 3. OpenRouter  nemotron-3-super:free  20 RPM / 50 RPD
                                 ├─ 4. Mistral     medium-latest       월 $10 크레딧
                                 ├─ 5. NVIDIA NIM  gpt-oss-120b        40 RPM / 10,000 RPD
                                 ├─ 6. Z AI        GLM-4.7-Flash       영구 무료, 동시 1
                                 ├─ 7. Ollama Cloud gpt-oss:120b       세션/주간 한도
                                 ├─ 8. Cohere      Command A           월 1,000회
                                 └─ 9. Kilo Code   kilo-auto/free      200 req/hr
```

## 3분 세팅

**1. 키 받기 (복붙)** — 쓸 곳만 받으면 됩니다. 2~3곳만 있어도 체인은 돕니다.

| 공급자 | 키 받는 곳 | 비고 |
| --- | --- | --- |
| Groq | https://console.groq.com/keys | 제일 빠름, 1순위 |
| Google Gemini | https://aistudio.google.com/app/apikey | 1M 컨텍스트, 긴 작업 폴백 |
| OpenRouter | https://openrouter.ai/keys | `:free` 모델 17개 |
| Mistral | https://console.mistral.ai/api-keys | Codestral 포함 |
| NVIDIA NIM | https://build.nvidia.com | Developer Program 가입 |
| Z AI | https://z.ai (국제판) | GLM-4.7-Flash 영구 무료 |
| Ollama Cloud | https://ollama.com/settings/keys | |
| Cohere | https://dashboard.cohere.com/api-keys | 비상업용 |
| Kilo Code | https://app.kilo.ai/profile | 무료 키 |

**2. 키 넣고 프록시 켜기**

```bash
cd tools/free-llm-fallback
cp .env.example .env        # 받은 키만 채우기. 안 받은 공급자는 litellm.config.yaml 에서 그 블록을 주석 처리
./start-proxy.sh            # litellm 자동 설치 후 127.0.0.1:4000 에 띄움. 이 창은 켜 두기
```

**3. 다른 터미널에서 Claude Code 실행**

```bash
./check.sh                  # free / free-fast 두 체인이 답하는지, 어느 모델이 받았는지 확인
./claude-free.sh            # 무료 체인으로 Claude Code 실행
```

편하게 쓰려면 셸 설정에 한 줄:

```bash
alias claude-free='~/english-news/tools/free-llm-fallback/claude-free.sh'
```

Windows 는 PowerShell 에서 `.\claude-free.ps1` (프록시는 `litellm --config litellm.config.yaml --port 4000` 로 별도 창에 먼저).

## 한도에 걸리면 어떻게 넘어가나

`litellm.config.yaml` 의 `router_settings` 가 전부입니다.

```yaml
fallbacks:
  - free: [free-gemini, free-openrouter, free-mistral, free-nvidia, free-zai, free-ollama, free-cohere, free-kilo]
  - free-fast: [free-fast-2, free-fast-3, free-gemini, free-kilo]
context_window_fallbacks:      # 컨텍스트가 넘치면 1M 짜리 Gemini 로
  - free: [free-gemini]
cooldown_time: 60              # 한 번 막힌 모델은 60초 쉬고 다시 시도
```

- 순서를 바꾸거나 모델을 추가하고 싶으면 `model_list` 에 블록을 하나 더 넣고 `fallbacks` 배열에 이름을 끼워 넣으면 됩니다.
- 체인 끝까지 전부 실패했을 때만 에러가 납니다. 이 레포에서 가짜 키로 돌려 본 결과, 9개 공급자를 순서대로 모두 시도하는 것을 로그로 확인했습니다.

## 알아둘 것

- **품질**: 무료 모델은 Claude 보다 도구 호출(파일 수정·명령 실행) 정확도가 떨어집니다. 작은 수정·질문·리팩터링엔 충분하고, 큰 작업은 한도가 풀린 뒤 평소 `claude` 로 하는 게 낫습니다.
- **데이터**: Gemini·Mistral·OpenRouter 무료 티어 등은 프롬프트를 학습에 쓸 수 있다고 명시합니다. 회사 코드·개인정보가 있는 레포에선 쓰지 마세요.
- **키 보관**: `.env` 는 `.gitignore` 에 올려 두었습니다. 커밋되지 않습니다.
- Claude Code 쪽은 환경변수 다섯 개만 바꿉니다(`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`). 전부 `claude-free.sh` 안에서만 설정되므로 설정 파일(`~/.claude/settings.json`)은 건드리지 않습니다.
