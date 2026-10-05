# Game Config Service

This optional service will hold shared Galgame scenario releases when local
browser storage is no longer enough.

It must run independently from SillyTavern.

The static player and admin apps discover this service from
`meta[name="galgame-config-service"]` or `window.GALGAME_CONFIG_SERVICE_URL`.
Do not store API keys or administrator secrets in those frontend values.

## Local Service

This folder includes a minimal standalone Node service:

This service now also contains the VS-CODE-P minimal visual projection issuer
boundary, the VS-CODE-3A current-release player visual session gateway, and
the VS-CODE-3B same-origin player asset proxy. It can issue short-lived
visible-text projections from the active published release and target original
chat readback, expose a service-to-service projection stub read route, assemble
a player visual bundle by calling the separate visual-asset-service internal
match adapter, and exchange short-lived ticket refs for PNG bytes through the
same-origin proxy.

It does not implement the visual matching core, a binding writer/store, player
visual UI, provider/LLM calls, or SillyTavern resource writes.

VS-CODE-3C entity selection is limited to the player visual bundle route. When
`requestedEntityKeys` is omitted or `[]`, the service selects bindable entity
keys from the trusted projection stub after server-side projection readback,
filters `unknown`, and uses an internal `selectedEntityKeys` array for
match/ticket calls and bundle success/recovery source summaries. Non-empty
legacy `requestedEntityKeys` requests remain supported as selection references
only. This does not expand the shared projection extractor: current real
projection coverage uses the shared visible helper for `character`,
explicit-label `scene`, `equipment`, `item`, and `skill` entities plus
unbindable `unknown` visible fragments. It still does not infer scene,
equipment, item, or skill facts from ordinary natural-language narration.
Projection/stub provenance now reports
`galgame.visual-projection-shared.v2` for this five-type helper behavior.

For a setup where SillyTavern is already running on port 8001, use the
project-owned services launcher below. It starts both self-owned services with
one shared `GALGAME_BRIDGE_PROOF_SECRET`. For the complete local stack, use
`external-modules/process-supervisor/launchers/Start_Galgame_All.bat`; it
starts SillyTavern on port 8000 and points the services at that instance.
The secret is loaded only into each child process environment; it is never
placed in a command argument, log, browser response, or static frontend file.
If the shared local secret file is missing or empty, the startup scripts stop
without starting either service. The config health response exposes
`runtimeProof.configured`; an unconfigured proof issuer returns 503.

```powershell
.\external-modules\process-supervisor\launchers\StartGalgameServices.cmd
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
- `GALGAME_VISUAL_PROJECTION_SECRET`
- `GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN`
- `GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN`
- `GALGAME_VISUAL_PROJECTION_TTL_MS`
- `GALGAME_VISUAL_RESTORE_ISSUER_SERVICE_TOKEN`
- `GALGAME_VISUAL_RESTORE_PROOF_SECRET`
- `GALGAME_VISUAL_RESTORE_PROOF_KEY_ID`
- `GALGAME_VISUAL_RESTORE_PROOF_TTL_MS`
- `GALGAME_PLAYER_VISUAL_GATEWAY_ORIGINS`
- `GALGAME_PLAYER_VISUAL_GATEWAY_TRUSTED_PROXY_MODE`
- `GALGAME_PLAYER_VISUAL_GATEWAY_SESSION_HEADER`
- `GALGAME_PLAYER_VISUAL_GATEWAY_CSRF_HEADER`
- `GALGAME_PLAYER_VISUAL_GATEWAY_CSRF_COOKIE`
- `GALGAME_VISUAL_MATCH_INTERNAL_BASE_URL`
- `GALGAME_VISUAL_MATCH_SERVICE_TOKEN`
- `GALGAME_VISUAL_ASSET_SERVICE_BASE_URL`
- `GALGAME_VISUAL_ASSET_INTERNAL_READ_TOKEN`
- `GALGAME_VISUAL_ASSET_INTERNAL_TIMEOUT_MS`

## Visual Projection Issuer Boundary

```http
POST /v1/visual/projections
GET  /v1/visual/projection-stubs/{projectionId}
```

`POST /v1/visual/projections` requires
`Authorization: Bearer <GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN>` for every
HTTP request, including loopback. Browser `Origin`, query proof, cookie proof,
and `X-Galgame-Visual-Projection-Proof` on this issuer route are rejected. The
request body must be the closed
`galgame.visual-projection-issuance-request.v1` shape.

`GET /v1/visual/projection-stubs/{projectionId}` requires
`Authorization: Bearer <GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN>`. Browser
requests, query tokens, bad projection ids, missing stubs, and expired stubs are
rejected. The response body is the exact `VisualProjectionStubV1` object and
must not include proof text, raw chat, prompt/context, resource bodies, or
secrets.

VS-CODE-P is a single-process memory MVP:

- `MemoryVisualProjectionStore` is not persistent and is not shared across
  service processes.
- TTL is capped at 300 seconds.
- Restarting this service invalidates every projection, proof, stub,
  idempotency entry, and nonce record.
- After restart, an old `projectionId` stub read returns missing instead of
  falling back to active/default/latest projection data.
- Reusing the same request after restart creates a fresh short-lived
  projection/proof/stub from current active release and target chat readback;
  it does not replay the old proof or old stub.
- Multi-process deployment or persistent projection/stub/nonce storage needs a
  separate reviewed gate before production use.

## Visual Restore Proof Issuer Boundary

```http
POST /v1/visual/restore-proofs/old-save
POST /v1/visual/restore-proofs/rollback
```

VS-CODE-2B-S-A adds only an authority issuer for future old-save and rollback
visual binding restore. It signs compact, short-lived proof tokens for a future
restore verifier. It does not restore bindings, read visual assets, write player
saves, activate or roll back releases, call SillyTavern Generate, or modify
manifest/profile/ST resources.

Every HTTP request to these two routes requires
`Authorization: Bearer <GALGAME_VISUAL_RESTORE_ISSUER_SERVICE_TOKEN>`,
including loopback calls. Browser-like `Origin`/Fetch metadata, query tokens,
cookies, `X-Galgame-Visual-Restore-Proof`, and
`X-Galgame-Visual-Projection-Proof` are rejected. Same-process callers must call
the exported issuer functions directly instead of using HTTP as an auth bypass.

Signing requires:

- `GALGAME_VISUAL_RESTORE_PROOF_SECRET`
- `GALGAME_VISUAL_RESTORE_PROOF_KEY_ID` matching
  `vis_restore_key_[a-z0-9_-]{8,40}`

TTL is capped at 120 seconds. Issuer idempotency is memory-only in this batch:
restart invalidates proof issuance idempotency and nonce history, and any new
proof must be created only after rereading the trusted authority.

Old-save proof issuance requires an injected trusted save-binding reader. If no
approved reader is configured, the route fails closed with
`VISUAL_RESTORE_SAVE_READER_UNCONFIGURED`.

Rollback proof issuance requires an injected trusted committed rollback-event
reader. A release that merely exists in publish history is not enough; the event
must match the expected rollback request id, event hash, rolled-back timestamp,
target release, target Arc, profile/catalog/dictionary scope, and release hash.
If no approved event reader is configured, the route fails closed with
`VISUAL_RESTORE_ROLLBACK_EVENT_REQUIRED`.

## Player Visual Session Gateway Boundary

```http
POST /v1/player/visual-bundle
GET  /v1/player/visual-assets/{ticketId}/content
```

VS-CODE-3A adds the current-release player visual session bundle gateway.
VS-CODE-3B adds only short-lived `PlayerVisualAssetTicketRefV1` values and a
same-origin PNG proxy for those tickets. It does not render player UI, restore
old saves, call Generate, write SillyTavern resources, or persist bindings in
this service.

Production auth is intentionally narrow:

- a reviewed reverse proxy or equivalent deployment boundary must inject
  `X-Galgame-Player-Session`;
- browser CSRF uses `X-Galgame-Player-CSRF` plus the
  `galgame_player_csrf` same-origin cookie;
- `Origin` must match `GALGAME_PLAYER_VISUAL_GATEWAY_ORIGINS`;
- `GALGAME_PLAYER_VISUAL_GATEWAY_TRUSTED_PROXY_MODE` must be `required`;
- unconfigured proxy/session/CSRF/origin contracts fail closed.

This service does not provide a player session store, login route, session
issuer, refresh flow, or authentication substitute. Production must provide an
approved `playerVisualSessionReader` dependency from the deployment boundary;
test readers are test doubles only and are not a production fallback. A
browser-supplied `X-Galgame-Player-Session` header is untrusted unless the
reviewed proxy boundary has stripped client copies and injected the value.

The gateway reuses the existing VS-CODE-P projection issuer and calls the
VS-CODE-3A-MA internal visual-match adapter at
`{GALGAME_VISUAL_MATCH_INTERNAL_BASE_URL}/v1/internal/visual-match` using the
server-only `GALGAME_VISUAL_MATCH_SERVICE_TOKEN`. It must not call the
browser-facing `/v1/visual-match`.

The returned `bindings` are response-only projections from the same
`VisualMatchResultV1`: there is no binding store, no new binding writer, no
second binding authority and no persistence in this service. Each projected
`VisualBindingV1` uses the internal visual-match idempotency key and is
validated before returning.

`assetReadTickets` contains browser-safe refs only:

- `schemaVersion`;
- `ticketId`;
- `proxyPath`;
- `bindingId`;
- `entityKey`;
- `assetId`;
- `assetVersion`;
- `expiresAt`.

It never includes `assetMetadataHash`, `catalogRefHash`, internal scope, proof,
token, raw asset path, source chat text, prompt, context, or provider data.
Those details stay in a short-lived server-side ticket record. Metadata hashes
are resolved only by the server from the trusted visual catalog before a ticket
is issued.

`GET /v1/player/visual-assets/{ticketId}/content` requires the same reviewed
reverse-proxy player session boundary. It rejects query strings,
Authorization, cookies, and visual proof headers. The route calls the
visual-asset-service internal content-read endpoint with
`GALGAME_VISUAL_ASSET_INTERNAL_READ_TOKEN`, verifies returned `image/png`
bytes and the `X-Galgame-Asset-Content-Sha256` header, then streams the PNG
with `Cache-Control: no-store`.

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
