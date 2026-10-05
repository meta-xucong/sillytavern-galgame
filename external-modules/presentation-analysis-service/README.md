# Presentation analysis service

Optional loopback-only annotation service for the Galgame player. It labels visible assistant text for presentation; it does not generate story content or write to SillyTavern chats. The player browser does not connect to this service directly; it uses fixed browser-safe proxy routes on `visual-asset-service` at `127.0.0.1:8798`.

## Run

For the local game, run `external-modules/presentation-analysis-service/StartGalgamePresentationAnalysisService.cmd`. Scene-continuity analysis is part of visual matching, so the launcher reads only `REFERENCE_VISION_BASE_URL`, `REFERENCE_VISION_API_KEY`, and `REFERENCE_VISION_MODEL` from the repository-local `.env.local` by default; set `GALGAME_PRESENTATION_ENV_FILE` to use another private file. It never reads `SEMANTIC_PLANNER_*` or the SillyTavern gameplay credential. It starts the analyzer on `127.0.0.1:8801` without printing the API key. The reset supervisor uses this same fixed launcher if the service is offline or running without an analyzer. For a standalone run, `node external-modules/presentation-analysis-service/server.mjs` still binds only to `127.0.0.1:8801` and reports `analyzerConfigured: false` unless its documented `GALGAME_PRESENTATION_ANALYZER_*` variables are set. Port 8801 is server-internal; player requests use the versioned fixed proxy paths on port 8798.

Both scene-continuity analysis (8801) and visual asset analysis (8798) use the separate visual credential. The current visual provider uses the OpenAI-compatible chat endpoint and `doubao-seed-2.0-lite`; do not use this credential to test or call Claude/Sonnet models. Story generation remains on SillyTavern's active gameplay provider and credential.

Configure these process environment variables before starting when an approved analyzer is available:

- `GALGAME_PRESENTATION_ANALYZER_PROVIDER=anthropic` or `openai-compatible`
- `GALGAME_PRESENTATION_ANALYZER_BASE_URL=https://provider.example`
- `GALGAME_PRESENTATION_ANALYZER_API_KEY` (server process only; never printed)
- `GALGAME_PRESENTATION_ANALYZER_MODEL`
- `GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS=provider.example` (exact host allowlist)

The Anthropic adapter uses `/v1/messages`; the OpenAI-compatible adapter uses `/v1/chat/completions`. The OpenAI-compatible presentation extractor uses temperature 0 and first requests strict JSON Schema output. If the gateway rejects that response format with HTTP 400 or 422, it makes one bounded retry in JSON mode. Scene-continuity prompt v3 asks the model for exact evidence quotes rather than numeric offsets; the service resolves each unique quote against the exact visible page and computes code point spans itself. Missing or ambiguous quotes receive bounded regeneration and fail closed if still invalid. Malformed or application-invalid output receives at most two bounded regenerations within the request deadline; only a response that passes the application schema and evidence checks is returned. Rejected results are logged only with a request ID, route, safe failure category, and bounded validation paths; prompt text, model output, and credentials are never logged. Redirects, non-HTTPS endpoints, URL credentials, query parameters, and hosts outside the explicit allowlist are rejected. The player sends no provider credential. Only the two configured loopback player origins are allowed by default; use `GALGAME_PRESENTATION_PLAYER_ORIGINS` to enumerate additional exact origins. The read-only `/v1/health` endpoint answers browser preflight only for an allowlisted origin requesting `GET`, including Private Network Access preflight when requested.

## Stop / disable

Stop the Node process to disable the optional analyzer. The player should continue displaying original SillyTavern content in neutral/unknown presentation when this service is absent. Do not terminate the core SillyTavern or generation bridge to disable annotation.

## Verification

`node external-modules/presentation-analysis-service/test.mjs` exercises endpoint allowlisting, Anthropic request path, health and Origin refusal without contacting an upstream provider.
