# VS1-PI Projection Issuer Code Admission Plan

> Status: historical/future implementation appendix v1.3; paused by VS-DOCS scope  
> Date: 2026-07-30  
> Parent spec: `docs/AI_GALGAME_VISUAL_SYSTEM_DEVELOPMENT_SPEC.md` v1.3  
> Scope: retained planning/admission appendix only; no implementation is authorized by this file. Current route: `docs/AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`.

## 1. Goal

VS1-PI prepares the code gate for a trusted Projection Issuer that turns original SillyTavern target chat readback into a bounded `VisualVisibleProjectionV1`, stores a short-lived server-side projection stub, and signs a short-lived projection proof.

This is the server-boundary counterpart to VS1-SG. VS1-SG only validates contract shape; VS1-PI is where future code may prove release/chat/profile/catalog scope and issue a trusted projection proof.

VS1-PI does not implement the visual asset service, image catalog, asset upload, runtime scorer, binding writer, player rendering, admin visual catalog UI, or runtime visual LLM matcher.

## 2. Allowed Code Admission Scope

Allowed for a later implementation batch only after reviewer PASS:

- `external-modules/game-config-service/**`
  - Add a narrow Projection Issuer route and in-memory/file-backed short-lived stub store if approved.
  - Reuse existing config-service active release, manifest, release history and rollback validation.
  - Reuse existing `SillyTavernOriginalChatBridge` for target chat readback.
- `frontend/shared/**`
  - Import existing VS1-SG validators only.
  - Add small pure helpers only if needed for canonical projection hashing or visible projection construction.
  - If implementation touches visible chat parsing, the only approved path is the existing SillyTavern adapter/shared helper used by player display/readback. `game-config-service` must not keep a second raw chat parser.
- `external-modules/game-config-service/test.mjs`
  - Add service tests for proof/stub issuance and failure cases.
- `frontend/shared/tests/**`
  - Add pure helper tests if shared helpers are touched.
- `public/game/shared/**` and `public/game-admin/shared/**`
  - Rebuild shared outputs only if shared source changes; build consistency only.
- `docs/**` and `.codex-longrun/**`
  - Update docs, evidence and state.

Default forbidden unless a new reviewer gate explicitly approves:

- `frontend/player/**`
- `frontend/admin/**`
- non-shared `public/game/**` or `public/game-admin/**`
- `external-modules/visual-asset-service/**`
- image upload/catalog storage/runtime scorer/binding writer
- provider or LLM matcher
- `src/**`, `server.js`, `plugins.js`, original SillyTavern `public/**`, `config.yaml`, root dependencies and startup scripts

## 3. Production Boundary

Projection Issuer belongs to a controlled server boundary, preferably the existing `game-config-service`.

It must:

- run independently from SillyTavern backend;
- use only existing SillyTavern HTTP APIs through `SillyTavernOriginalChatBridge`;
- not import, patch or call SillyTavern backend internals;
- not add SillyTavern routes, middleware, storage, startup behavior or frontend globals;
- not expose proof signing keys to browser/static/localStorage/manifest/logs;
- fail closed when signing secret, release, manifest, profile, catalog or ST readback is unavailable.

CORS and same-origin are not authentication. Any admin or service-internal write/read boundary needs explicit token/proxy/session protection. Player proof requests must be authorized by active or old-save release scope, not by arbitrary client-submitted ids.

## 4. Production Caller And Authorization

VS1-PI uses one production caller model:

- `POST /v1/visual/projections` is service-internal only.
- The browser/player page must not call this route directly.
- CORS is disabled for this route by default. If the service is behind a same-origin reverse proxy, CORS still remains only source filtering, not authentication.
- Every HTTP `POST /v1/visual/projections` request, including loopback, must be authenticated by `GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN` or an equivalent reviewed proxy/mTLS service proof.
- If no valid service token/proxy/mTLS boundary is configured, the HTTP route must reject or the service must refuse to enable the route.

Approved caller:

- a same-process internal function call that does not traverse HTTP, sockets, fetch, loopback, browser CORS or any route handler; or
- a future service-internal HTTP caller with `Authorization: Bearer <GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN>` and audience `visual-projection-issuer`.

Explicitly forbidden:

- browser-direct player call;
- browser-held service token;
- client-generated request proof;
- using releaseId/chatId/profile/catalog fields as authorization;
- using the output projection proof as authorization for the request that created it;
- treating loopback, same-origin or CORS as proof that a request came from the same process.

Route auth draft:

| Field | Rule |
| --- | --- |
| Route | `POST /v1/visual/projections` |
| HTTP caller | service-internal only; browser never direct |
| Internal caller | same-process function call only; no HTTP route, no socket, no loopback |
| HTTP auth header | required for every HTTP POST, including loopback: `Authorization: Bearer <service-token>` |
| Env name | `GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN` |
| Audience | `visual-projection-issuer` |
| Loopback | HTTP loopback still requires service token or reviewed proxy/mTLS proof |
| Non-loopback | must require service token or equivalent proxy/mTLS proof |
| CORS | no wildcard; no credentialed browser CORS for this route |
| CSRF | browser is not a caller; if proxied through a browser route in the future, that route needs its own separate CSRF/session review |
| Rate limit | per release/chat/profile scope and per service token |
| Body size | max 8KB |
| Idempotency | required `idempotencyKey`; duplicate identical request reuses projection/stub until expiry |

## 5. Projection Issuer API Draft

### 5.1 POST `/v1/visual/projections`

Input:

```ts
interface VisualProjectionRequestV1 {
  protocolVersion: "galgame.visual-projection-request.v1";
  releaseId: string;
  scenarioId: string;
  scenarioVersion: string;
  arcId: string;
  chatId: string;
  sourceMessageIndex?: number;
  profileId: string;
  profileHash: string;
  catalogId: string;
  catalogRevision: number;
  catalogHash: string;
  dictionaryVersion: string;
  dictionaryHash: string;
  expectedSourceMessageHash?: string;
  oldSave?: {
    saveId: string;
    saveBindingHash: string;
  };
  idempotencyKey: string;
}
```

Rules:

- Unknown root/nested fields fail.
- Request ids are indexes and hints only. They do not authorize access.
- Active release path must match current active release and manifest.
- Old-save path must match a trusted server-side save binding or signed old-save proof. The request `oldSave` object is a lookup hint only.
- Missing or mismatched profile/catalog/dictionary hashes fail.
- `sourceMessageIndex` absent means latest visible message, but only after canonical target chat readback.
- `expectedSourceMessageHash` is optional and untrusted. If present, the server compares it with the canonical readback hash and fails on mismatch; if absent, the server derives the hash and includes it in response/proof.
- Request body must not include visible text, source snippets, provider output, prompt, context, character card or worldbook body.

Response:

```ts
interface VisualProjectionResponseV1 {
  ok: true;
  protocolVersion: "galgame.visual-projection-response.v1";
  projection: VisualVisibleProjectionV1;
  stub: {
    projectionId: string;
    projectionHash: string;
    expiresAt: string;
  };
  proof: VisualProjectionProofV1;
  evidence: {
    releaseId: string;
    scenarioId: string;
    scenarioVersion: string;
    arcId: string;
    chatIdHash: string;
    sourceMessageIndex: number;
    sourceMessageHash: string;
    profileId: string;
    profileHash: string;
    catalogId: string;
    catalogRevision: number;
    catalogHash: string;
    dictionaryVersion: string;
    dictionaryHash: string;
    entityCount: number;
    source: "config-service-target-chat-readback";
  };
}
```

Failure:

- returns `ok:false` with a stable error code;
- never returns local/default projection;
- never returns source text, prompt, context, provider response, resource body, secret, token or signature internals.

## 6. Canonical Projection Construction

VS1-PI must use one canonical projection path:

1. Resolve active or old-save release through the config store.
2. Validate release and manifest with presentation profile hash required.
3. Resolve Arc, target character/avatar, chatSeedId and target chatId.
4. Use `SillyTavernOriginalChatBridge` to list chats and read exact target chat.
5. Verify target chat is allowed for the release/Arc and, if needed, seed-derived.
6. Select latest or requested visible message by stable message index.
7. Build bounded visible projection through the approved shared extractor/projection helper.
8. Validate `VisualVisibleProjectionV1` using VS1-SG.
9. Store a short-lived stub keyed by projectionId.
10. Sign proof over projectionHash, sourceMessageHash, release/profile/catalog/dictionary scope, nonce and expiry.

The visual service must not repeat these steps or parse ST chat itself. It can only read the server-side stub/proof through the approved service boundary.

Message selection rules:

- Visible messages exclude system metadata and empty messages.
- Message normalization uses the same existing ST adapter visible-message rules used for display/readback, including `extra.display_text || mes`, system/empty filtering, bounded sanitization and canonical visible-message ordering.
- `sourceMessageIndex` is an index into the canonical visible-message sequence after the chat header/meta row is ignored and system/empty messages are filtered. It is not a raw ST chat array offset.
- Missing `sourceMessageIndex` selects the latest visible message.
- Out-of-range index fails closed.
- If a selected message has no normalized visible text and no extractable entity, projection issuance fails closed or returns an empty valid projection only when explicitly tested.
- `expectedSourceMessageHash`, when provided, is compared only after canonical readback; mismatch fails closed.

## 7. Stub Store

Stub requirements:

- server-side only;
- TTL default no more than 5 minutes;
- bounded count and byte size;
- no complete chat text or message body;
- stores only `VisualProjectionStubV1` and non-sensitive indexes;
- atomic write/update if file-backed;
- expired stubs are purged;
- missing, expired or hash-mismatched stub fails closed.

## 8. Proof Requirements

Projection proof must:

- be signed by a server-side secret not present in browser/static/logs;
- include audience `visual-asset-service` and purpose `visual-match`;
- include projectionHash, sourceMessageHash, releaseId, scenarioId, scenarioVersion, arcId, chatId, profileId/profileHash, catalogId/catalogRevision/catalogHash, sourceMessageIndex, extractorVersion, dictionaryVersion/dictionaryHash, nonce, issuedAt and expiresAt;
- reject expired, stale, wrong audience, wrong purpose, cross-release, cross-chat, cross-profile, cross-catalog, cross-dictionary and replayed proof;
- use constant-time signature comparison in the server verifier;
- include a replay cache at the visual-service/server boundary in the future implementation.

VS1-PI issuer responsibilities:

- create a signed nonce and use that nonce as the only proof/replay identity exposed by the VS1-SG proof schema;
- store issued nonce and request body hash in issuer stub metadata until expiry;
- reject duplicate idempotency keys with different body hash;
- prevent projection stub/proof overwrite when different idempotency keys request the same canonical message. Implementations must either reject a projectionId conflict or derive projectionId from request identity so old stubs remain addressable;
- reject duplicate nonce generation attempts in issuer state;
- never expose signing secret;
- allow local helper tests to verify signature shape and internal-function signature checking only if those helpers are explicitly listed in the implementation file scope.

Future visual-service verifier responsibilities:

- verify proof signature;
- verify stub readback;
- enforce replay cache on actual visual-match use;
- reject expired/replayed/stale/cross-scope proof.

If VS1-PI implementation includes a server-side verification helper, that helper must be explicitly listed in the file/route/test contract. Otherwise VS1-PI tests must not claim full visual-service replay rejection; they may only prove issuer nonce uniqueness, expiry, idempotency and stub behavior.

VS1-PI may add proof signing and stub storage only after code admission PASS. VS1-SG browser-visible validators must still remain shape-only.

## 9. Old Save Authorization

Old save projection is allowed only through a trusted authorization source.

Accepted sources:

1. server-side save binding readback from an existing reviewed save store; or
2. a future signed old-save visual proof with audience `visual-projection-issuer`, exact release/profile/catalog/dictionary scope, saveId, saveBindingHash, nonce and expiry.

VS1-PI first implementation should prefer server-side readback only if the save store and exact binding path are already available in the approved custom boundary. If not available, old-save issuance must remain deferred rather than trusting client fields.

Rules:

- `oldSave.saveId` and `oldSave.saveBindingHash` are hints only.
- Client-provided release/profile/catalog fields are not old-save authorization.
- Old save cannot fall back to current active release.
- Old catalog/profile mismatch returns fail-closed.
- Missing old profile/catalog/release returns fail-closed.
- Forged saveId, forged hash, cross release/profile/catalog and active fallback all reject.
- Old asset/catalog absence later resolves unknown in visual matching; it does not rebind under active catalog.

## 10. Logging And Privacy

Logs/evidence may include:

- stable error code;
- release/scenario/version/arc ids;
- hashed chatId/sourceMessageHash/projectionHash;
- profileId/profileHash;
- catalogId/revision/hash;
- dictionaryVersion/hash;
- entity count;
- timing and expiry category.

Logs/evidence must not include:

- full chat text;
- visible message snippets;
- provider prompt/response;
- character card/worldbook/preset/context body;
- API keys, proof secret, token, signature internals;
- arbitrary client-submitted summaries.

## 11. Fail-Closed Matrix

VS1-PI implementation must reject:

- no signing secret;
- no active release;
- releaseId/scenario/version/Arc mismatch;
- profileId/profileHash mismatch;
- catalogId/revision/hash mismatch;
- dictionaryVersion/hash mismatch;
- target chat missing from ST chat list;
- target chat readback unavailable;
- sourceMessageIndex out of range;
- `expectedSourceMessageHash` mismatch when the optional hint is present;
- canonical readback hash generation failure;
- generated projection failing VS1-SG validation;
- stub write/readback mismatch;
- expired proof;
- replayed proof;
- wrong audience or purpose;
- stale or cross-release proof;
- oversized request or projection;
- any prompt/context/resource/provider/raw text field.

All failures must preserve ordinary ST Generate/input flow and produce no local story, no default projection and no guessed visual binding.

## 12. Exact Implementation Contract Required Before Code

Any future VS1-PI implementation request must list:

| Item | Required value before implementation |
| --- | --- |
| Files | exact touched files; expected initial set is `external-modules/game-config-service/server.mjs`, `external-modules/game-config-service/test.mjs`; optional shared pure helper changes such as `frontend/shared/src/sillytavern-adapter.js` visible-message helper or `frontend/shared/src/visual-system-schema.js` helper-only changes; optional shared tests; rebuilt shared public outputs |
| Route | `POST /v1/visual/projections` only |
| Auth | internal function call for same-process use; every HTTP POST, including loopback, requires `Authorization: Bearer <GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN>` or reviewed proxy/mTLS proof |
| Non-loopback | fail-closed without service token/proxy/mTLS proof |
| Secret env | `GALGAME_VISUAL_PROJECTION_SECRET` for signing; missing secret disables issuer |
| Token env | `GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN` for all HTTP route caller auth |
| TTL env | `GALGAME_VISUAL_PROJECTION_TTL_MS`, default <= 300000 |
| Stub store | memory first unless file-backed atomicity is explicitly reviewed |
| Idempotency | `idempotencyKey` + request body hash; conflict rejects; distinct idempotency keys for the same canonical message must not overwrite earlier projection stubs/proofs |
| Old save | server-side readback only, or deferred if no approved save-binding reader exists |
| Verifier | issuer helper only unless full server verifier is listed and tested |
| Logging | fixed no-leak schema from section 10 |
| Evidence paths | unique `.codex-longrun/evidence/vs1-pi-*` files; failures preserved as superseded |

## 13. Test And Evidence Matrix

Required before VS1-PI implementation can be called locally passed:

| Gate | Evidence |
| --- | --- |
| Syntax | `node --check external-modules/game-config-service/server.mjs` and touched shared files |
| Service tests | `external-modules/game-config-service/test.mjs` covers projection happy path and all fail-closed cases |
| Shared tests | VS1-SG tests still pass |
| Route auth | HTTP loopback no token rejects; wrong token rejects; correct token allows; non-loopback no token rejects; cross-origin browser direct requests reject |
| Internal caller | same-process internal function path tested separately and never passes through HTTP route auth bypass |
| Request size/rate | oversized body and rate-limited scope reject |
| Active release scope | active release exact profile/catalog/dictionary proof succeeds |
| Old save scope | exact server-side old save binding succeeds if implemented; otherwise old-save path is explicitly deferred and rejects |
| Shared visible helper parity | issuer and player display/readback use the same shared visible-message helper; service source contains no duplicated raw chat parser |
| Canonical message index | fixture covers header/meta/system/empty/player/original-reply messages; `sourceMessageIndex` is canonical visible sequence index and not raw ST array offset |
| Cross scope | cross chat/release/profile/catalog/dictionary rejects |
| Expiry/idempotency | expired proof/stub and idempotency conflict reject |
| Projection overwrite | distinct idempotency keys for the same canonical message do not overwrite existing projection stubs/proofs |
| Replay | issuer nonce uniqueness tested; full visual-service replay rejection only if verifier helper is in this phase |
| Stub mismatch | missing/hash mismatch/expired stub rejects |
| No leak | logs/evidence contain hashes/counts only, no source text/provider/prompt/context/resource body |
| Player leak | active player app does not call proof signing, stub store, visual service admin, binding writer or provider |
| Architecture | static architecture/source-public ok with 0 prohibited/needs-review/failed checks |
| Protected boundary | ST backend/original public/root deps/config/startup status/diff empty and startup EOL clean |
| State | state/progress/test-log/blockers/evidence inventory consistent |

## 14. Code Admission Request Contents

Before code starts, the implementation request to reviewer must include:

- exact file list;
- exact new routes and auth mode;
- proof secret source and fail-closed behavior;
- stub storage choice and TTL;
- old-save authorization path;
- no-leak log schema;
- test commands and evidence paths;
- confirmation that VS-LLM remains deferred;
- confirmation that visual service, asset catalog, binding writer, scorer, player rendering and admin UI are not part of VS1-PI.
