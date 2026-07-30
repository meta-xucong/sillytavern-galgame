# Game Config Service

This optional service will hold shared Galgame scenario releases when local
browser storage is no longer enough.

It must run independently from SillyTavern.

The static player and admin apps discover this service from
`meta[name="galgame-config-service"]` or `window.GALGAME_CONFIG_SERVICE_URL`.
Do not store API keys or administrator secrets in those frontend values.

## Local Prototype

This folder includes a minimal standalone Node service:

The repository also retains a visual projection issuer/projection-stub
prototype in this service. It is paused historical material under the current
VS-DOCS route; it is not a current player dependency and must not be expanded
or wired to the visual asset service without a fresh user authorization and
code-admission review.

For this repository's local Galgame setup, prefer the root script:

```powershell
.\StartGalgameServices.cmd
```

It starts this config service and the original runtime bridge with one shared
local proof secret. This avoids the common "story loads, but LLM continuation
does not connect" failure caused by starting only one side or starting them
with different environment values.

```powershell
node external-modules/game-config-service/server.mjs
```

By default it listens on `127.0.0.1:8791` and stores data in
`external-modules/game-config-service/data/store.json`. Override with:

- `HOST`
- `PORT`
- `GALGAME_CONFIG_STORE`
- `GALGAME_CORS_ORIGIN`
- `GALGAME_ADMIN_TOKEN`
- `GALGAME_BRIDGE_PROOF_SECRET`

## Administrator Protection

If `GALGAME_ADMIN_TOKEN` is set, every `/v1/admin/**` endpoint requires one of:

- `Authorization: Bearer <token>`
- `X-Galgame-Admin-Token: <token>`
- `Cookie: galgame_admin_token=<token>`

The player read-only endpoints do not require this token.

For production, prefer a reverse proxy or this service's runtime environment to
handle administrator access. The static frontend must not carry administrator
secrets, API keys, or bearer tokens.

## Minimum Player APIs

```http
GET /v1/releases/active
GET /v1/scenarios
GET /v1/scenarios/{scenarioId}/versions/{version}/manifest
GET /v1/scenarios/{scenarioId}/versions/{version}/assets/{assetPath}
```

`GET /v1/scenarios` returns the player-facing list of playable stories. It only
contains display summaries and release references, not character card bodies,
world book entries, prompts, keys, or model settings.

## Minimum Admin APIs

```http
POST /v1/admin/scenarios/import
GET  /v1/admin/scenarios
POST /v1/admin/scenarios/{scenarioId}/versions/{version}/validate
GET  /v1/admin/releases
POST /v1/admin/releases
POST /v1/admin/releases/{releaseId}/rollback
GET  /v1/admin/health
```

The admin API must have real authentication through this service or a reverse
proxy. A hidden static admin URL is not access control.
