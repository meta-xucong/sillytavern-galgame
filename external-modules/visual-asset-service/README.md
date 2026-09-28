# Galgame Visual Asset Service

Status: CORE-2 adds a minimal published-only catalog/content read path,
CORE-3 adds a pure deterministic local candidate-decision helper, and CORE-4
adds a minimal `/game` display decision endpoint on top of the existing visual
asset catalog implementation. Historical VS-CODE-2/3
service-authenticated matcher, ticket, binding and restore routes remain
present for their archived batches, but the active core path does not require
player sessions, projection proofs, asset tickets, old-save restore, providers
or VS-LLM.

This external module manages the visual asset catalog for the custom Galgame
presentation layer. It is intentionally removable and does not patch or import
SillyTavern backend code.

## Local Beginner Admin Entrypoint

For the simplified beginner backend, a local operator can start the self-owned
visual backend and open its built-in admin page:

```powershell
node external-modules/visual-asset-service/server.mjs
```

From the repository root on Windows, the self-owned launcher is:

```powershell
.\StartGalgameVisualAssetService.cmd
```

`StartGalgameServices.cmd` calls that launcher after the config service and
original-runtime bridge. Its health output is diagnostic only: if the
SillyTavern route or bridge is unavailable, the player must remain in its
normal recovery state and no local story is substituted.

Default URL:

```text
http://127.0.0.1:8798/game-admin/
```

The Windows launcher `StartGalgameVisualAssetService.cmd` uses the service-owned
data directory `external-modules/visual-asset-service/data`. This directory is
persistent runtime data for metadata, PNG content, analysis cache and visual
control; it is not evidence or state data, is ignored by Git, and must be
backed up or cleaned only as service data. The launcher binds only to loopback
and writes service stdout/stderr to `.codex-longrun/visual-asset-service.*.log`.

This page is served only from the visual-asset-service loopback process. The
service injects a same-origin visual-service URL plus a short local CSRF value
and sets an HttpOnly `galgame_visual_admin_session` cookie. Browser requests use
only the local facade:

- `GET /v1/local-admin/visual/status`;
- `POST /v1/local-admin/visual/upload`;
- `POST /v1/local-admin/visual/publish`.

The browser must not send `Authorization`, projection proof, restore proof,
asset proof, ST key, provider key, raw prompts or model settings. The legacy
production `/v1/admin/**` routes still keep their Bearer-token contract for
controlled service use, but that token is never embedded in `/game-admin/`,
public files, localStorage, query strings or logs. Static `/game-admin/` hosted
elsewhere with an empty visual-service meta remains a clear not-connected state.

## VISUAL-AI-TAGS Server-Side Image Analysis

The five beginner upload entries remain unchanged. After the built-in PNG
decoder safely strips metadata and re-encodes an image, the service may call
an independent analyzer configured only by these server-side environment
variables:

- `GALGAME_VISUAL_ANALYZER_BASE_URL`
- `GALGAME_VISUAL_ANALYZER_TOKEN`
- `GALGAME_VISUAL_ANALYZER_MODEL`
- `GALGAME_VISUAL_ANALYZER_REQUEST_STYLE` (`closed-json-http-v1` by default or
  `anthropic_messages_vision`)
- `GALGAME_VISUAL_ANALYZER_CACHE_SCOPE` (optional non-secret analyzer/config version scope)

The browser never calls this provider and never receives its token. The
server makes at most one outbound request per uncached analysis. The default
`closed-json-http-v1` style POSTs exactly `schemaVersion`, `model`, `assetType`,
`contentHash`, `imageBase64` and `task` to `/v1/analyze`. The
`anthropic_messages_vision` style normalizes a configured host or `/v1` base
URL to `/v1/messages` and sends only `model`, `max_tokens` and one user message
containing the canonical PNG plus the fixed tagging task. The Anthropic Messages
style sends only the server-side `x-api-key` and `anthropic-version` headers;
the closed-json style retains its server-side Bearer header. SillyTavern keys, provider
settings, chat text, prompts, context, character/world resources and hidden
runtime data are not read or sent. Without an independent analyzer
configuration, production uploads remain usable and record
`analysisStatus=unavailable`.

For the separately supplied deployment, the controlled service process may set
`GALGAME_VISUAL_ANALYZER_BASE_URL=https://aiself.vip/v1`,
`GALGAME_VISUAL_ANALYZER_MODEL=doubao-seed-2-0-lite-260428` and
`GALGAME_VISUAL_ANALYZER_REQUEST_STYLE=anthropic_messages_vision`. The token is
an operator-provided server-only environment value; it must never be written
to this repository, a browser bundle, an API response, local storage, logs or
evidence. A missing token intentionally leaves analysis unavailable.

For a one-command Windows controlled run that uses the same independent
Anthropic Messages credential for upload-time vision and runtime visible-text
hints, use:

```text
StartGalgameVisualAnalyzerTest.cmd
```

The wrapper prompts once for `视觉服务密钥（隐藏输入）`, starts the child service on
loopback and opens `http://127.0.0.1:8798/game-admin/`. Only the child process
receives the configured analyzer/runtime endpoints, models, request styles,
bounded cache scopes and the prompted value in both corresponding token
variables. The wrapper clears inherited copies of both token variables before
constructing the child environment, never puts the token in command-line
arguments, and clears its temporary string/BSTR/environment references on
exit. It records only non-sensitive PID/health diagnostics.

The ordinary `StartGalgameVisualAssetService.cmd` explicitly clears both token
variables and therefore remains a no-provider launcher unless a separate
server-side deployment supplies configuration. Do not paste a token into a
browser field, URL, command argument, repository file or evidence record.

Each asset stores a closed `galgame.visual-asset-analysis.v1` object and a
matching top-level `analysisStatus` of `ready`, `unavailable` or `failed`.
Provider output is limited to a short description, finite dictionary
`tagCodes`/`attributeCodes`, bounded confidence and analyzer version. The
service reads at most 64 KiB from an analyzer response, rejects a UTF-8 BOM and
duplicate JSON keys before parsing, and maps an oversized body to
`ANALYZER_RESPONSE_TOO_LARGE`. Unknown fields, URLs, scripts, unknown codes,
malformed JSON, non-finite numbers, timeouts and provider errors fail closed
while preserving the PNG and draft.
Provider non-2xx responses are reduced to fixed, non-sensitive analysis error
codes only: `401/403 -> ANALYZER_AUTH_ERROR`, `400/404/422 ->
ANALYZER_REQUEST_INVALID`, `429 -> ANALYZER_RATE_LIMITED`, `5xx ->
ANALYZER_UPSTREAM_ERROR`, and other statuses -> `ANALYZER_HTTP_ERROR`. The
provider response body is never returned, logged or persisted.
For `anthropic_messages_vision`, envelope, content-block and closed-output
failures are classified separately as `ANALYZER_ENVELOPE_INVALID`,
`ANALYZER_CONTENT_INVALID` and `ANALYZER_OUTPUT_INVALID`; OpenAI-compatible
`choices` envelopes, multiple or non-text content blocks, duplicate/unknown
output fields and other malformed closed output are never accepted as analysis.
Within Anthropic closed output, unknown fields, missing required fields,
invalid values and unknown dictionary codes use the fixed categories
`ANALYZER_OUTPUT_UNKNOWN_FIELD`, `ANALYZER_OUTPUT_MISSING_FIELD`,
`ANALYZER_OUTPUT_VALUE_INVALID` and `ANALYZER_OUTPUT_CODE_INVALID`.
Field-level value failures are then classified as
`ANALYZER_OUTPUT_DESCRIPTION_INVALID`, `ANALYZER_OUTPUT_CODES_INVALID`,
`ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID`, `ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID`,
`ANALYZER_OUTPUT_VERSION_INVALID` or
`ANALYZER_OUTPUT_DUPLICATE_CODES`, without returning the invalid value.
The fixed vision task explicitly requires `confidence` to be a JSON number in
`0 < confidence <= 1`; percentages, strings, zero, `NaN` and `Infinity` are
not rescaled or accepted.
Anthropic vision requests also set `temperature: 0` and require one complete
JSON object containing all five output fields; missing fields are rejected and
never defaulted.
Duplicate JSON keys in the provider envelope or embedded text use the separate
`ANALYZER_OUTPUT_DUPLICATE_FIELD` category and are always rejected.
The previously persisted `ANALYZER_OUTPUT_CONFIDENCE_INVALID` code remains in
the readback allowlist for restart compatibility; new responses use the
type/range categories above and are never silently rewritten.
The current AISelf diagnostic is deliberately narrower than a provider success
claim: DNS and TLS to `aiself.vip:443` are reachable, while unauthenticated
`GET https://aiself.vip/v1/models` returns HTTP 401. The earlier Ark/Sub2API
200 result used a different OpenAI-compatible route/auth contract and therefore
does not prove that AISelf accepts this Anthropic Messages route. AISelf must be
validated through the configured `/v1/messages` request with its own accepted
credential and model; this service reports only the redacted status class.
The analysis object participates in `assetMetadataHash` and therefore the
published catalog hash. Repeated analysis for the same asset type, normalized
content hash and analyzer configuration scope is cached in a closed file-backed
analysis cache under
`GALGAME_VISUAL_ASSET_DATA_DIR/analysis-cache`. The cache stores only the
validated analysis object, content/type digests and an analyzer-scope digest;
it never stores provider tokens, raw responses or task text. The cache is
reused after restart, while changing `GALGAME_VISUAL_ANALYZER_CACHE_SCOPE`,
the analyzer base URL/model, or the analyzer token digest creates a new scope
and permits a fresh analysis. Malformed, unknown-field, BOM, path-escape,
symlink or key/hash-mismatched cache records fail closed during startup.
If the cache cannot be written, the analyzer result is downgraded to
`analysisStatus=failed` with `ANALYZER_CACHE_WRITE_FAILED`; the already-saved
PNG remains a readable draft. Test-only HTTP fixtures may exercise these
branches but do not configure production AI.

Core deterministic matching uses exact overlap between normalized visible
codes and analysis tag/attribute codes. A ready candidate with no overlap, an
unavailable/failed analysis, a stale hash or a low score returns the
type-specific unknown asset. The earlier VISUAL-AI-TAGS upload phase did not
add runtime LLM calls or manifest/profile auto-binding; the existing active
`visualPresentation` scope limitation remains a separate follow-up blocker.
The separately gated VISUAL-RUNTIME-1 contract is documented below and remains
server-only.

## VISUAL-RUNTIME-1 Visible-Context Hint Adapter

The existing `POST /v1/core/visual-decisions` route also accepts the closed
request schema `galgame.visual-core-visual-decisions-request.v2`. It retains
the existing projection and expected hash fields and adds only `visibleContext`
with the current displayed message and at most three recent displayed
messages. The service and the shared visual schema normalize the same four
message fields before calculating the source hash. This is a consistency check,
not a projection/proof/session authorization mechanism.

When explicit visual entities are insufficient, the service may call an
independent runtime analyzer using only these server-side environment values:

- `GALGAME_VISUAL_RUNTIME_BASE_URL`
- `GALGAME_VISUAL_RUNTIME_TOKEN`
- `GALGAME_VISUAL_RUNTIME_MODEL`
- `GALGAME_VISUAL_RUNTIME_REQUEST_STYLE` (`closed-json-http-v1` or
  `anthropic_messages_text`)
- `GALGAME_VISUAL_RUNTIME_CACHE_SCOPE`

The browser never receives these values and never calls the analyzer. The
server sends only the bounded visible-context DTO plus a fixed extraction
instruction. It never reads or forwards ST credentials, prompts, hidden
context, character/world resources, raw chat objects or provider responses.
With `anthropic_messages_text`, the server normalizes `https://aiself.vip`,
`/v1` and `/v1/messages` forms to the Anthropic Messages `/v1/messages`
endpoint. It sends only the server model, bounded max tokens, fixed
instruction and normalized current/recent visible context, using server-only
`x-api-key` and `anthropic-version: 2023-06-01` headers. It does not send a
Bearer header. The upload-time `anthropic_messages_vision` adapter uses the
same Anthropic `x-api-key` contract, while closed-json upload analysis retains
its independent Bearer contract. The Anthropic envelope is passed through the
existing text JSON parser and the same closed runtime hint validator.
The transport is POST-only, rejects redirects, has a 3-second timeout and at
most one retry for timeout/network failures, with 16 KiB request and 32 KiB
response limits. HTTP 4xx/5xx and invalid JSON/schema responses are not
retried unnecessarily.

The analyzer response must be the closed
`galgame.visual-runtime-hints.v1` object with the current dictionary version
and hash, at most one entity per type, and only dictionary codes. Invalid,
ambiguous, unavailable, timed out or unconfigured analysis returns a bounded
placeholder understanding status; transport/schema failures use the legal
hint status `ambiguous` and the outer response carries `understandingStatus=
failed` plus a bounded error code. It never fabricates tags or deletes an
asset. Runtime hint cache is memory-only (256 entries, 300-second TTL,
in-flight deduplication) and is cleared on restart. Only validated successful
`VisualRuntimeHintV1` objects are cached; failure wrappers and error details are
never cached, so a later request may retry after a transient failure. The
RUNTIME-2 adds the closed dictionary revision 2 and
`galgame.visual-asset-analysis.v2` records. The five skill codes are retained in
addition to every revision-1 code; every analysis, catalog and runtime hint
must carry the exact dictionary version/hash. Revision-1 records cannot enter
a revision-2 active catalog. The exported migration planner is fail-closed.
When the service uses a `FileVisualAssetStore`, its default transaction writes
a service-owned temporary batch containing every v2 asset record, the catalog
and a commit marker, reads the batch back and validates it, then renames the
batch and atomically writes a root `active-migration.json` pointer. File writes
sync the temporary file before rename. Startup accepts only complete batches
and only the batch named by the validated commit pointer; orphan temporary
batches, unknown files, malformed records, hash/ref mismatches, symlinks and
path traversal fail closed. A failed activation removes the uncommitted batch
and restores the prior in-memory and pointer state, while old catalog and
asset records remain untouched. Repeating an already active migration is an
idempotent no-op. The service-owned migration entry can be called without
catalog/assets arguments; it reads the active FileVisualAssetStore pointer,
loads that catalog and collects every referenced published asset before
planning. Supplying catalog/assets remains available only to pure planner
tests. This is a recoverable pointer-commit protocol with
process-level failure semantics; it does not claim crash-level cross-file
atomicity or filesystem-directory fsync guarantees on every platform.

The legacy revision-1 to revision-2 migration is operator-controlled and never
runs during ordinary service startup. Use exactly one explicit mode:

```powershell
node external-modules/visual-asset-service/server.mjs --migrate-runtime-v2 --dry-run
node external-modules/visual-asset-service/server.mjs --migrate-runtime-v2 --execute
```

Dry-run performs the closed reanalysis plan without creating a migration batch,
active migration pointer or changing visual-control. Execute first requires
every asset analysis to be `ready`, then commits the new catalog and exact
visual-control pointer through the recoverable transaction. If analysis is
unavailable or any catalog, pointer or control write fails, the legacy catalog,
legacy active pointer, enabled state and control file remain unchanged and no
new active batch remains. The CLI prints only `ok`, mode, redacted catalog
pointer identities, asset count, readiness and a fixed `errorCode`; it never
prints a provider response, token or raw error. Legacy records are retained for
rollback/recovery and are not silently deleted.
The FileVisualAssetStore migration regression uses a real published revision-1
catalog containing all five asset types, including a transparent character
sprite and icon assets. It verifies per-type analysis dictionary/hash, content
hashes, catalog refs, fresh-store restart readback, and batch-write failure
preserving the legacy active source.

Runtime v2 scoring uses exact overlap between the validated runtime hint codes,
trusted visible attribute codes and candidate analysis tag/attribute codes.
Candidates below 60, with unavailable analysis, low confidence, generic-only
overlap, character identity/appearance gaps or negative conflicts resolve to a
placeholder. The old v1 matcher remains unchanged. Test-only injected analyzers
prove the contract but are not production AI evidence. Player natural-dialogue
wiring remains RUNTIME-3 work.

## SIMPLE-1 Visual Control State

Chapter 1 of the simple backend path adds only the persistent visual control
switch:

- schema: `galgame.visual-control.v1`;
- default state: `enabled=false`, `activeCatalog=null`;
- `GET /v1/admin/visual/status`;
- `POST /v1/admin/visual/enable`;
- `POST /v1/admin/visual/disable`.

The production CLI stores this state under
`GALGAME_VISUAL_ASSET_DATA_DIR/control/visual-control.json` with atomic writes.
Malformed JSON, BOM, unknown fields, invalid field types, orphan temp files and
symlink/path escape attempts fail closed during startup or update. Responses do
not expose store paths, tokens, filenames, uploads or secret material.

Enable/disable uses the existing admin Bearer auth and admin Origin boundary.
Enabling without an active published catalog keeps `activeCatalog=null` and
does not manufacture a usable directory. When disabled, the core decision route
returns `VISUAL_CORE_DISABLED`; when enabled without an active catalog it returns
`VISUAL_CORE_NO_ACTIVE_CATALOG`. Chapter 1 does not implement upload facade,
automatic catalog numbering, one-click publish/activate, player wiring,
projection/proof/stub/ticket/binding, old-save/rollback, provider or LLM
behavior.

If `activeCatalog` is present in the persisted control file, the service treats
it as a trusted pointer only after it exact-matches a `published` catalog record,
the catalog hash, and the existing active catalog pointer. Missing, stale,
archived, hash-mismatched or manually tampered pointers fail closed with
`VISUAL_CONTROL_ACTIVE_CATALOG_INVALID` before admin status or core decision
responses expose that pointer.

Chapter 2 adds only the simplified backend upload facade:

- schema: `galgame.visual-simple-upload-request.v1`;
- route: `POST /v1/admin/visual/upload`;
- required body fields: `schemaVersion`, `assetType`, `title`, `imageBase64`;
- optional body fields: `tagCodes`, `featureCodes`, `fileName`;
- forbidden client fields include `assetId`, `assetVersion`, `role`, hashes,
  content paths and catalog fields.

The facade reuses the existing production PNG sanitizer, metadata validator,
content store and draft asset store. The service generates `assetId` as
`asset_<type>_<12 lowercase hex>`, sets `assetVersion=1`, derives the role from
the asset type, records canonical PNG width/height/alpha/content hash and keeps
the result as a draft asset. It does not publish, activate, enable visual
control, generate a catalog, modify player/admin UI, or call any historical
visual-match/proof/ticket/binding/restore/provider path.

Chapter 3 adds the simplified backend publish+activate operation:

- schema: `galgame.visual-simple-publish-response.v1`;
- route: `POST /v1/admin/visual/publish`;
- input body: empty JSON object or no body;
- server-generated catalog id: `catalog_simple_<12 lowercase hex>`;
- server-generated catalog revision: `1`.

The operation collects the current available asset library: existing
`published` user assets plus current `draft` user assets, excluding service-owned
`unknown_*` assets and archived/unpublishable records. It strictly de-duplicates
each `assetId/assetVersion`, revalidates PNG content, metadata, role and
dictionary scope, promotes draft assets to `published`, creates a new published
catalog with the full available asset snapshot and all five immutable unknown
refs, writes the active catalog pointer, then writes `visual-control.v1` with
`enabled=true` and an exact `activeCatalog` id/revision/hash. If no draft assets
remain and an active published catalog already exists, the route returns an
idempotent no-op response for that active catalog instead of creating another
revision.

The catalog store and visual-control store are separate file-backed objects, so
Chapter 3 does not claim crash-level cross-file transaction semantics. It
implements a recoverable two-phase, in-process failure path: draft promotion
failure, catalog write failure, active pointer write failure, and control write
failure all roll back the new catalog/active pointer and restore the previous
draft assets plus previous `enabled/activeCatalog` state. Restart recovery is
covered by the underlying file stores and by the published catalog/control
readback tests. This chapter does not modify frontend/admin/player/shared/public
code, does not enable a browser UI, and does not restore projection/proof/stub,
ticket, binding, receipt, old-save/rollback, provider or LLM behavior.

## CORE-2 Published-Only Reads

The core path reuses the existing PNG sanitizer, immutable unknown assets,
file-backed metadata/content stores and admin catalog lifecycle. It adds only
read-only published catalog/content endpoints:

- `GET /v1/core/catalogs/:catalogId/:catalogRevision`
- `GET /v1/core/catalogs/:catalogId/:catalogRevision/assets/:assetId/:assetVersion/content`

Core reads are intentionally simple:

- no browser/player session, service Bearer token, projection proof, restore
  proof, asset ticket, cookie or query token is accepted;
- only `published` catalog revisions are readable;
- each content read must exact-match the requested published catalog ref,
  persisted asset metadata, canonical PNG MIME and final byte hash;
- draft, validated-only, archived, missing, mismatched or tampered records
  fail closed;
- all five immutable `unknown_*` assets are included in every catalog and are
  readable only through the same published catalog scope.

CORE-2 does not implement deterministic matching, player background/sprite/icon
selection, binding persistence, old-save/rollback restore, player asset tickets
or any SillyTavern read/write path.

## CORE-3 Deterministic Local Matcher Helper

`createCoreVisualCandidateDecisionPlan()` is a pure helper for the core path.
It consumes only a trusted local projection summary, a visual profile catalog
scope, a published catalog, and the published asset metadata records for that
catalog. It does not read ST chats, call `/v1/visual-match`, verify projection
proofs, write bindings, allocate asset tickets, read old saves, or call a
provider/LLM.

The helper is fail-closed:

- `expectedProjectionHash` and `expectedSourceMessageHash` must exactly match
  the local projection readback;
- the visual profile catalog id/revision/hash must match the published catalog;
- every candidate asset must be in the catalog and exact-match the persisted
  asset metadata/content hash;
- five immutable unknown refs must be compatible before any unknown fallback is
  returned.

The legacy v1 deterministic scorer keeps its existing fixed policy and
tie-break: score, negative-conflict count, lower integer `assetVersion`, then
`assetId` lexicographic order. `score < 20` returns the type-specific
`unknown_*` asset.
Characters require explicit appearance evidence before a concrete sprite can be
selected; equipment, item and skill require an explicit visible label before a
concrete icon can be selected.

Runtime v2 uses its own closed tie-break and does not fall through to the v1
fields: higher score, fewer semantic conflicts, higher `analysisConfidence`,
lower integer `assetVersion`, then `assetId` lexicographic order. A runtime
hint with `unavailable`, `ambiguous` or `failed` status produces a score-zero
type-specific placeholder for each visible bindable entity; it never scores
the candidate catalog with a non-ready hint.

## CORE-4 Player Display Decisions

CORE-4 exposes the local helper to the custom `/game` player without reusing
the historical visual-match, proof, ticket, or binding chain:

- `POST /v1/core/visual-decisions`

The route accepts only a closed core decision request built from the currently
visible `/game` message, a local projection summary, and the server-owned
profile returned by `GET /v1/core/visual-context`. It reads only the published
catalog and published asset records already managed by this service, then
returns deterministic decisions with read-only core content paths.

## FINAL-2 Global Active Visual Context

`GET /v1/core/visual-context` is a player-safe, read-only discovery route. It
validates the persisted visual-control state, the active catalog pointer, the
published catalog and its asset references before returning either a closed
disabled identity or the active catalog identity plus a server-derived
`global-display-v1` profile. The response has a canonical `contextHash` and
`Cache-Control: no-store`.

The route requires an exact configured player Origin (the default local
allowlist is `http://127.0.0.1:8000`, `http://localhost:8000`,
`http://127.0.0.1:8001` and `http://localhost:8001`) and rejects
query parameters, cookies, Authorization, proofs, tickets, bindings, ST or
provider headers, and unknown application headers. It never returns asset
bytes, manifest/profile data, chat content or secrets. The player reads this
context first and passes the five profile fields through unchanged to the
existing core decision route. A context/decision failure falls back locally
without blocking chat, input, Generate, save or load; the player revalidates a
failed context after a fixed 30-second cooldown.

Core player decision reads are intentionally narrow:

- no service Bearer token, projection proof, restore proof, asset ticket,
  cookie, query token, player session, binding writer, old-save reader, or
  provider call is accepted;
- browser `Origin` is allowed only when configured through
  `GALGAME_VISUAL_CORE_PLAYER_ORIGINS`; when the variable is unset, the service
  uses the finite local player defaults `http://127.0.0.1:8000`,
  `http://localhost:8000`, `http://127.0.0.1:8001` and
  `http://localhost:8001`;
- `*`, arbitrary remote origins, query tokens, bearer auth and proof headers
  are never accepted for the core player decision route;
- stale projection/source/catalog hashes return a typed failure body instead
  of a visual-match result or binding;
- successful decisions include only display data and `/v1/core/catalogs/...`
  content paths; they are not persisted and are not written to player saves.

The `/game` frontend renders the returned scene background, character
transparent sprite, and equipment/item/skill icons asynchronously. Any route,
image, hash, or catalog failure restores the default background/sprite and
type-specific unavailable icon presentation without blocking original chat,
Generate, input, save, or load behavior.

## VS-CODE-1 Scope

Implemented in this batch:

- five asset types: `scene`, `character`, `equipment`, `item`, `skill`;
- type-to-role validation:
  - `scene -> background`;
  - `character -> transparent-sprite`;
  - `equipment/item/skill -> icon`;
- admin-only upload and catalog lifecycle routes;
- built-in safe PNG sanitizer and canonical PNG output;
- final-byte `assetContentSha256`;
- `assetMetadataHash` and `catalogHash`, including asset metadata hashes;
- immutable type-specific unknown assets;
- file-backed metadata and content stores for restart recovery;
- catalog `draft -> validated -> published -> archived` plus controlled
  rollback pointer;
- admin Bearer auth fail-closed;
- public health whitelist with no filenames, counts, paths, uploads, or tokens.

Not implemented in VS-CODE-1:

- browser player asset-read route or player asset-read proof verification;
- projection issuer or runtime visible-text matching;
- visual restore proof issuance, browser player asset-read route, or binding
  read route;
- player/admin visual UI;
- provider or LLM matching;
- SillyTavern reads, writes, Generate calls, manifest/profile/save changes, or
  original backend/public changes.

## VS-CODE-2A Internal Candidate Decision Helper

VS-CODE-2A adds only service-local helper functions and tests. It does not add
an HTTP route, browser API, binding writer, persistence lifecycle, old-save
restore, player/admin UI, player asset-read, Projection Issuer extension, or
provider/LLM call.

The helper validates a closed internal `VisualCandidateDecisionInputV1`, builds
an `UnknownCompatibilityReportV1`, filters published PNG catalog candidates,
and returns an internal `VisualCandidateDecisionV1` when a deterministic choice
is possible. It reuses shared visual constants and score policy from
`frontend/shared/src/visual-system-schema.js`.

Candidate decisions are intentionally stricter than the earlier upload API:

- candidate `assetId` values must match the shared visual schema
  (`asset_*` or type-specific `unknown_*`);
- each candidate must exact-match a trusted `catalogAssetRefs` snapshot for
  asset id, version, type, final content hash, metadata hash, and catalog-ref
  hash;
- dictionary version/hash must equal the service dictionary exactly;
- profile catalog binding fields must match the candidate catalog scope;
- generated decisions must match the input scope and keep score/scoreBand and
  optional expiry within the approved TTL;
- generated decisions must also prove their asset provenance. A concrete asset
  must match both the trusted `candidates` list and `catalogAssetRefs`; an
  unknown fallback must match the type-specific shared unknown ref plus a
  compatible `UnknownCompatibilityReportV1` entry for the same catalog scope.

Current compatibility gate: shared immutable unknown refs now use the same
canonical transparent PNG content hash as the VS-CODE-1 service unknown assets.
The current `UnknownCompatibilityReportV1` is `compatible` only when all five
type-specific unknown ids, versions, content hashes, served-byte hashes,
metadata hashes and catalog-ref hashes match exactly. Legacy placeholder hashes
still produce `VISUAL_UNKNOWN_COMPATIBILITY_BLOCKED`; they are not silently
remapped to the service unknown image.

If a service unknown asset is missing, the compatibility report now returns a
closed `blocked` entry with fixed zero-hash placeholders and
`missing-service-unknown`. This is evidence-only and never a usable asset ref.
A `compatible` entry must prove that shared unknown id/version/content hash,
service unknown id/version/content hash, served-byte hash, and catalog-ref hash
all agree for the same type-specific `unknown_*` asset.

## VS-CODE-2B-R Trusted Visual Match Route

VS-CODE-2B-R adds only the current-release matching route and display-only
binding persistence:

- `POST /v1/visual-match`;
- fixed `X-Galgame-Visual-Projection-Proof` header carrying base64url canonical
  `VisualProjectionProofV1` JSON;
- proof verification compatible with the VS-CODE-P signer: canonical proof bytes
  are checked first, then HMAC-SHA256 is computed over a canonical copy whose
  `signature` field is set to `""`;
- `GALGAME_VISUAL_PROJECTION_SECRET` is required for proof verification;
- `GALGAME_VISUAL_MATCH_PLAYER_ORIGINS` is required for browser Origin
  allowlisting;
- `GALGAME_VISUAL_PROJECTION_STUB_BASE_URL` and
  `GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN` are required for the
  service-to-service projection-stub reader unless a service-local test reader
  is injected;
- `GALGAME_VISUAL_BINDING_STORE_DIR` enables the production
  `FileVisualBindingStore` and the same-root `FileVisualRestoreReplayStore`.

The route consumes only a trusted VS-CODE-P projection proof/stub and the
published visual catalog. It calls the VS-CODE-2A deterministic helper, then
creates or reuses a display-only `VisualBindingV1` and returns a
`VisualMatchResultV1`. Both public DTOs are validated by the shared schema.
The internal store uses `bindingPolicy: "current-release"` only as a lifecycle
marker; public bindings map policies by type:

- `scene -> scene-ttl`;
- `character -> session-fixed`;
- `equipment/item/skill -> entity-first-seen-fixed`.

`FileVisualBindingStore` uses digest-only path segments for idempotency and
active-entity indexes. Raw release ids, chat ids, entity keys, idempotency keys,
proof nonces and request ids are never used as path segments. Startup rejects
duplicate, corrupt, dangling, partial or hash-mismatched records. Memory stores
and injected stub readers are service-local tests only, not production fallback.

Proof replay state uses a `proofReplayKey` formula over nonce,
projection/scope/source fields, and the matched `entityKey`. The same projection
proof nonce may therefore create multiple entity-specific replay slots for one
player bundle. The nonce index still binds those slots to one exact
projection/release/profile/catalog/source scope; the same nonce with a different
scope remains a replay conflict. Each entity slot stores the public result hash
as replay value data, so exact replay can be reused while changed decisions or
provenance fail closed.

## VS-CODE-3A-MA Internal Visual Match Adapter

VS-CODE-3A-MA adds only a service-to-service adapter for the same visual-match
execution core:

- `POST /v1/internal/visual-match`;
- mandatory `Authorization: Bearer <GALGAME_VISUAL_MATCH_SERVICE_TOKEN>`;
- `GALGAME_VISUAL_MATCH_SERVICE_TOKEN` must be a server-only ASCII token,
  32..256 characters; missing or malformed configuration fails closed;
- mandatory fixed `X-Galgame-Visual-Projection-Proof` header carrying the same
  base64url canonical `VisualProjectionProofV1` JSON used by `/v1/visual-match`;
- no Origin, Cookie, OPTIONS/browser preflight, query proof, body proof, raw
  proof JSON header, restore proof header, or asset-read proof header.

The projection proof remains the business-scope proof only. It is not caller
authentication. Caller authentication for the internal route is the service
Bearer token, and missing configuration fails closed. The existing browser
`POST /v1/visual-match` route remains Origin + projection-proof based, rejects
Bearer/cookie transport, and is not converted into a service-auth route.
Missing Authorization returns `VISUAL_MATCH_SERVICE_AUTH_MISSING`; malformed
Authorization returns `VISUAL_MATCH_SERVICE_AUTH_INVALID`; a well-formed but
wrong token returns `VISUAL_MATCH_SERVICE_AUTH_REJECTED`.

The internal adapter calls the same visual-match execution core: the same request validator, projection-proof
verifier, projection-stub reader, deterministic decision helper,
FileVisualBindingStore/MemoryVisualBindingStore writer, proof replay logic, and
public DTO validators as `/v1/visual-match`. It does not add a new scorer,
binding writer, projection verifier, projection reader, public schema, player
asset-read route, frontend UI, provider, or LLM behavior.

## VS-CODE-3B Internal Asset Read Support

VS-CODE-3B adds only service-to-service asset metadata and PNG content read
support for the game-config-service same-origin player proxy:

- `POST /v1/internal/assets/metadata-resolve`;
- `POST /v1/internal/assets/content-read`;
- mandatory `Authorization: Bearer <GALGAME_VISUAL_ASSET_INTERNAL_READ_TOKEN>`;
- `GALGAME_VISUAL_ASSET_INTERNAL_READ_TOKEN` must be a server-only ASCII token,
  32..256 characters; missing or malformed configuration fails closed;
- no Origin, Cookie, OPTIONS/browser preflight, query token, projection proof,
  restore proof, asset proof, raw chat, prompt, context, provider data, or
  release/profile/save authority fields.

The metadata route consumes only asset/catalog identity fields supplied by the
trusted caller and resolves `assetMetadataHash` plus `catalogRefHash` from the
published visual catalog. The content route requires the exact metadata hash
and catalog-ref hash returned by metadata resolve, then streams canonical PNG
bytes with `Content-Type: image/png`, `Content-Length`,
`X-Galgame-Asset-Content-Sha256`, `X-Content-Type-Options: nosniff`, and
`Cache-Control: no-store`.

Authority remains split:

- game-config-service owns player session, ticket ownership, binding/entity,
  release/scenario/Arc/profile scope, and same-origin proxy decisions;
- visual-asset-service owns only service auth, published asset/catalog exact
  identity, metadata hash, catalog-ref hash, MIME, served bytes, and content
  store integrity.

These internal routes do not expose a browser asset-read API, sign player
proofs, create tickets, write bindings, restore old saves, call Projection
Issuer, render UI, or call providers/LLMs.

## VS-CODE-2B-S-B Restore Verifier

VS-CODE-2B-S-B adds only service-to-service restore verification routes:

- `POST /v1/visual/restore-bindings/old-save`;
- `POST /v1/visual/restore-bindings/rollback`;
- fixed `X-Galgame-Visual-Restore-Proof` header carrying a compact
  game-config-service proof token;
- mandatory `Authorization: Bearer <GALGAME_VISUAL_RESTORE_SERVICE_TOKEN>`;
- mandatory `GALGAME_VISUAL_RESTORE_PROOF_SECRET` and
  `GALGAME_VISUAL_RESTORE_ACCEPTED_KEY_IDS`;
- old-save proof prefix `gvosrp1`;
- rollback proof prefix `gvrrp1`.

The restore routes never sign proofs. They consume VS-CODE-2B-S-A proof tokens
only, verify HMAC-SHA256 over `prefix.payload`, reject query/body/cookie/raw
JSON proof transport, and reject browser-like requests. A matching retained
binding must already exist in the existing `FileVisualBindingStore` or
service-local test store.

The verifier returns only an existing public `VisualBindingV1`. It does not
create a new binding, rematch an asset, read active/latest catalog state, or
write SillyTavern save data. Before returning, it validates:

- public `VisualBindingV1` and stored `VisualMatchResultV1` with the shared
  schema validators;
- `entityKey` type segment, `bindingType`, receipt asset type, and unknown
  asset id type coherence;
- internal `sha256:<64hex>` asset/metadata/catalog hashes against the retained
  record and receipt;
- public `assetContentSha256` remains plain 64-hex;
- receipt `retentionId`/`retentionHash` and retention release/profile/catalog
  scope match exactly;
- old-save proofs authorize the requested binding id and chat hash;
- rollback proofs target the same retained release scope.

Restore replay is scoped by the proof nonce plus release scope and binding id.
Exact replay of the same request can be reused; changed request/proof/result
data is rejected. Failed restore attempts do not reserve replay state. In
production CLI mode, restore replay records are file-backed under
`GALGAME_VISUAL_BINDING_STORE_DIR/restore-replay` with digest-only filenames,
atomic no-overwrite commits, startup validation, expired-record cleanup, and
fail-closed handling for corrupt, partial, duplicate, path-escaped, or symlinked
records. `MemoryRestoreReplayStore` is reserved for service-local tests only.

Still not implemented after VS-CODE-2B-S-B:

- visual restore proof issuance in this service;
- player asset-read route;
- player/admin visual UI;
- binding read route or browser binding writer;
- Projection Issuer expansion;
- WebP/JPEG support;
- provider or LLM matching;
- SillyTavern backend/original public/root startup changes.

## Decoder Boundary

The service never commits the original upload bytes as published content. The
default production path accepts only the built-in versioned PNG sanitizer:

- non-interlaced 8-bit RGB/RGBA PNG only;
- PNG signature, chunk order, and CRC validation;
- zlib inflate of IDAT with a strict `maxOutputLength`;
- scanline length and filter validation;
- PNG filter reconstruction;
- real transparent-pixel detection for character sprites;
- APNG and unknown/private ancillary chunks fail closed;
- metadata chunks are stripped;
- canonical filter-0 PNG is re-encoded before the content hash is assigned.

Safety budgets are checked before zlib inflate and before pixel-buffer
allocation, then checked again after canonical output:

- maximum compression ratio: `80:1`;
- maximum decoded pixels: `24,000,000`;
- `scene` maximum dimension: `8192`;
- `character/equipment/item/skill` maximum dimension: `4096`.

Production creation requires the built-in decoder identity. Test decoder
injection is only allowed through an explicit service-local test switch.

## Admin Routes

All `/v1/admin/**` routes require:

- `Authorization: Bearer <GALGAME_VISUAL_ASSET_ADMIN_TOKEN>`;
- configured admin auth, otherwise fail closed;
- if `Origin` is present, it must match
  `GALGAME_VISUAL_ASSET_ADMIN_ORIGINS`.

Routes:

- `GET /v1/health`
- `POST /v1/admin/assets/upload`
- `GET /v1/admin/assets/:assetId/:assetVersion`
- `GET /v1/admin/assets/:assetId/:assetVersion/content`
- `POST /v1/admin/catalogs/draft`
- `GET /v1/admin/catalogs/:catalogId/:catalogRevision`
- `POST /v1/admin/catalogs/:catalogId/:catalogRevision/validate`
- `POST /v1/admin/catalogs/:catalogId/:catalogRevision/publish`
- `POST /v1/admin/catalogs/:catalogId/:catalogRevision/archive`
- `POST /v1/admin/catalogs/:catalogId/rollback`

## Local Test

```powershell
node external-modules/visual-asset-service/test.mjs
```
