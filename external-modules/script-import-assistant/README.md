# Script Import Assistant

External service for turning uploaded script text into an administrator-only import draft and, after confirmation, original SillyTavern resource references.

This module is independent from SillyTavern. It does not modify `src/**`, `server.js`, `plugins.js`, original `public/**`, root dependencies, or original Generate behavior.

## Scope

Implemented administrator contract:

- `GET /v1/health`
- `POST /v1/admin/script-import/drafts`
- `POST /v1/admin/script-import/drafts/{draftId}/redeploy`
- `POST /v1/admin/script-import/drafts/{draftId}/confirm`

`confirm` writes explicitly named `Galgame_AIImport_*` original SillyTavern character/worldbook/chat-seed resources through existing ST APIs, then returns a references-only manifest draft. It does not publish an active release. The administrator must still use the existing publish/rollback flow.

Idempotency is fail-closed: if a target resource already exists with the same source/body hash, it is reused; if the hash or source differs, the service refuses to overwrite it.

## Security

`/v1/admin/**` is fail-closed. Configure one of:

- `GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN`
- `GALGAME_SCRIPT_ASSISTANT_TRUST_EXTERNAL_AUTH=true` behind a real reverse proxy, independent admin service, mTLS, or equivalent controlled session

If neither is configured, administrator requests are rejected. CORS and hidden routes are not authentication.

Optional:

- `GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN_EXPIRES_AT`
- `GALGAME_SCRIPT_ASSISTANT_CORS_ORIGIN`
- `GALGAME_SCRIPT_ASSISTANT_TRUSTED_PROXY_TOKEN`

`GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN_EXPIRES_AT` is fail-closed: if it is present but cannot be parsed as a date, all administrator routes are rejected.

`GALGAME_SCRIPT_ASSISTANT_TRUST_EXTERNAL_AUTH=true` is not authentication by itself. It is allowed without a proxy token only on loopback. If the service is exposed on a non-loopback host, configure `GALGAME_SCRIPT_ASSISTANT_TRUSTED_PROXY_TOKEN`; the reverse proxy or admin service must inject it as `X-Galgame-Trusted-Proxy-Token` after authenticating the administrator. Direct requests without that proof are rejected.

If a browser sends an `Origin` header to `/v1/admin/**`, it must match an explicit `GALGAME_SCRIPT_ASSISTANT_CORS_ORIGIN` allowlist entry. With no allowlist, cross-origin administrator requests are rejected even when the Bearer token is correct.

Health output reports whether authentication and LLM settings are configured, but never returns tokens, keys, prompts, draft counts, import activity metrics, upload bodies, character card bodies, or world book bodies.

## LLM Key Boundary

AA1 only wires service-side LLM configuration status and key boundaries. It does not call an LLM yet, and draft output remains deterministic with `usesLlm=false`. Real server-side LLM planning is deferred to a later phase with its own prompt and log redaction tests.

The service may read the same server-side key source as SillyTavern through:

- `GALGAME_SCRIPT_ASSISTANT_LLM_BASE_URL`
- `GALGAME_SCRIPT_ASSISTANT_LLM_MODEL`
- `GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY`
- `GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY_ENV`

Keys stay in the service process or deployment secret source. They must not be written to `/game/`, `/game-admin/`, static files, manifest, localStorage, IndexedDB, screenshots, or logs.

## No-LLM Mode

Without LLM settings, the service uses an import-only deterministic summarizer/import-plan generator. It can produce only:

- administrator summary
- resource reference plan
- safe warnings

It must never produce player dialogue, choices, nodes, endings, runtime story, local story state, or a player manifest body. The player `/game/` route must never call this service.

## Run

```powershell
$env:GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN='change-me'
node external-modules/script-import-assistant/server.mjs
```

Default URL: `http://127.0.0.1:8796`.

## Test

```powershell
node external-modules/script-import-assistant/test.mjs
```
