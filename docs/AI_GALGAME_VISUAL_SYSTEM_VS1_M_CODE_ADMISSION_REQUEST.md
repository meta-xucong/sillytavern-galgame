# VS1-M Deterministic Matcher And Binding Lifecycle Code Admission Request

> Status: paused / historical code-admission material after user scope correction  
> Date: 2026-07-30  
> Parent documents: `docs/AI_GALGAME_VISUAL_SYSTEM_DEVELOPMENT_SPEC.md`, `docs/AI_GALGAME_VISUAL_SYSTEM_VS1_M_ADMISSION_PLAN.md` v1.2  
> Scope: docs/state/evidence preparation only. This file is retained as historical future-implementation material; it does not authorize implementation.

## 0. User Scope Correction

2026-07-30 用户确认当前只需要“视觉资产匹配与扩展方案”的开发文档。VS1-M implementation、visual-match route、binding writer、ProjectionReceipt 持久化、Projection Stub GET、visual-asset-service 生产接入、玩家/管理员视觉 UI 和 VS-LLM 均暂停。

已有代码和证据按要求保留，不删除、不回滚、不清理；但本文件不得再被当作当前代码准入或继续实现的授权。若未来要恢复实现，必须由用户重新明确授权，并重新提交独立 code-admission/reviewer gate。

## 1. Admission Basis

Independent reviewer PASSed VS1-M admission v1.2. The approved document closed the previous protocol drift:

- projection ids stay on the existing `^vvp_[a-z0-9_-]{12,80}$` family;
- entity keys stay on the existing `^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$` family and maximum 96 characters;
- idempotency keys stay on the existing `^idem_[A-Za-z0-9._:-]{16,120}$` family;
- bounded matchable entities come from existing `VisualProjectionStubV1.entities`, not a new proof field;
- `VisualMatchResultV1` must pass the existing `validateVisualMatchResult()` guard and include `matchId`, `bindingId`, `entityKey` and complete provenance;
- public `VisualBindingV1` must pass the existing `validateVisualBinding()` guard and must not receive store-only fields;
- `bindingHash`, `projectionHash`, `assetMetadataHash` and `retentionScopes` are service-internal persistence metadata only;
- reason codes reuse the existing `VISUAL_REASON_CODES`;
- player binding-read route remains deferred;
- VS-LLM remains deferred/no-claim.

This request asks for permission to prepare the next implementation batch only. It is not a request to implement VS-LLM, player visual UI, admin visual UI, Projection Issuer changes beyond the named read-only stub GET route, or SillyTavern backend changes.

v1.0 independent review failed because the package did not provide a production-usable Projection Stub read chain for the independent visual asset service, and because binding-store startup validation depended on short-lived stubs/proofs that can legitimately expire before old saves need restoration. v1.1 corrects those two admission blockers by adding a reviewed service-to-service stub read route to the future file scope and by introducing a persistent projection receipt for binding provenance.

## 2. Future Implementation Goal

If this code-admission request receives independent reviewer PASS, the future VS1-M implementation may add a deterministic visual matcher and service-internal display-binding lifecycle to the existing removable visual asset service.

The future implementation may:

- accept a closed `VisualMatchRequestV1`;
- verify an existing `VisualProjectionProofV1` and its matching server-side `VisualProjectionStubV1`;
- select candidate assets only from the exact published or old-save-authorized catalog/profile/dictionary scope;
- apply deterministic score policy and type-specific immutable unknown fallback;
- create or reuse a display-only `VisualBindingV1` through a service-internal writer;
- return a `VisualMatchResultV1` that passes the existing shared validator;
- persist service-internal `VisualBindingStoreRecordV1` records for replay, conflict rejection and old-save exact restore.

The future implementation must not:

- read SillyTavern chats or hidden resources;
- create a second chat parser or duplicate the Projection Issuer extractor;
- call ST Generate or bottom generate endpoints;
- write ST resources, manifests, release state, profile authority or player saves;
- infer gameplay facts such as obtained item, equipped weapon, learned skill, HP, quest state, relationship state, node, choice or ending;
- call an LLM/provider or accept provider output;
- expose any browser route that writes bindings or searches arbitrary player bindings.
- VS-LLM remains deferred/no-claim; no provider/LLM module may be added.

## 3. Exact File Scope Requested For A Later Implementation

Allowed files if a later reviewer explicitly approves implementation:

- `external-modules/visual-asset-service/server.mjs`
  - add closed request parsing for `POST /v1/visual-match`;
  - add projection proof verification and projection stub reader integration;
  - add deterministic candidate filter/scorer;
  - add service-internal binding writer and binding store record validation;
  - add health whitelist fields only if non-sensitive and fixed.
- `external-modules/visual-asset-service/test.mjs`
  - add service-local route, proof, scorer, binding and persistence tests.
- `external-modules/visual-asset-service/README.md`
  - document only the new route, env, failure codes and deployment boundary.
- `external-modules/game-config-service/server.mjs`
  - add only `GET /v1/visual/projection-stubs/:projectionId` as a read-only service-to-service Projection Stub route;
  - do not change `POST /v1/visual/projections`, proof issuance semantics, ST readback behavior, release/profile/catalog authority, or any SillyTavern backend route.
- `external-modules/game-config-service/test.mjs`
  - add only service-to-service stub route auth, scope, expiry and no-leak tests.
- `.codex-longrun/**`
  - evidence, state, progress, test-log and blocker updates.

Read-only imports are allowed from `frontend/shared/src/visual-system-schema.js` only for pure constants/validators such as:

- `validateVisualProjectionProofShape`;
- `validateVisualProjectionStub`;
- `validateVisualMatchResult`;
- `validateVisualBinding`;
- `applyVisualScorePolicy`;
- `resolveVisualMatchResultForScope`;
- immutable unknown asset helpers/constants.

No `frontend/shared/**` source change is requested in this code-admission package. If implementation needs a new shared helper, it must pause and submit a separate shared-schema/helper gate with an exact file list.

Default forbidden files remain:

- `src/**`, `server.js`, `plugins.js`, `config.yaml`;
- original SillyTavern public frontend;
- root `package.json` or `package-lock.json`;
- startup scripts;
- `frontend/player/**`, `frontend/admin/**`;
- non-shared `public/game/**`, `public/game-admin/**`;
- `external-modules/game-config-service/**` changes except the explicitly listed read-only `GET /v1/visual/projection-stubs/:projectionId` route and its tests;
- `external-modules/original-runtime-bridge/**`;
- any provider/LLM module.

## 4. Route Contract

The only future browser-facing route requested by VS1-M is:

```http
POST /v1/visual-match
Content-Type: application/json
X-Galgame-Visual-Projection-Proof: <base64url-no-padding canonical JSON VisualProjectionProofV1>
```

The header serialization is transport-only. It must not introduce a new proof schema, envelope field or id family. Decoding must yield exactly the existing `VisualProjectionProofV1` object and must pass the existing shared proof-shape validator before cryptographic verification.

Request body:

```ts
interface VisualMatchRequestV1 {
  schemaVersion: "galgame.visual-match-request.v1";
  projectionId: string;
  entityKey: string;
  entityType: "scene" | "character" | "equipment" | "item" | "skill";
  idempotencyKey: string;
}
```

Request limits:

- body maximum: 4096 UTF-8 bytes;
- exact keys only: `schemaVersion`, `projectionId`, `entityKey`, `entityType`, `idempotencyKey`;
- duplicate JSON keys fail before object materialization;
- unknown root/nested keys fail;
- ids are ASCII only and use existing shared regexes;
- `entityType: "unknown"` fails because it is not bindable;
- proof token must not appear in query string, URL fragment, cookies, request body, multipart fields, localStorage, logs or evidence;
- browser CORS must use the existing exact player-origin allowlist and exact preflight header list, but Origin/CORS is not authorization.

Forbidden routes for this batch:

- no player `GET /v1/bindings/:bindingId`;
- no browser `POST /v1/bindings`;
- no asset upload/catalog/profile/admin route changes;
- no Projection Issuer route changes except the read-only service-to-service stub route defined in section 6.

## 5. Projection Proof Verifier

The visual asset service must verify the existing `VisualProjectionProofV1` as a server responsibility. Shared proof shape validation is not authorization.

Verifier requirements:

- secret source: `GALGAME_VISUAL_PROJECTION_SECRET` or a reviewed server-side key source shared with the Projection Issuer;
- if no verifier secret/key is configured, `POST /v1/visual-match` must reject with `VISUAL_MATCH_PROOF_VERIFIER_UNCONFIGURED`;
- proof shape must pass `validateVisualProjectionProofShape()`;
- proof `audience` must be `visual-asset-service`;
- proof `purpose` must be `visual-match`;
- proof timestamps must be valid, not expired, not too far in the future and within the approved TTL;
- proof signature must be verified with constant-time comparison;
- signing input must match VS1-PI: canonical JSON of the proof object with `signature: ""`;
- wrong signature, wrong audience, wrong purpose, wrong release/profile/catalog/dictionary scope, malformed proof, unknown key, extra field, wrong hash format or expired proof fails closed.

Proof reuse semantics:

- do not consume the proof nonce globally on the first entity match;
- match replay cache key is `proof.nonce + projectionId + entityKey + idempotencyKey`;
- exact replay returns the same match/binding result;
- same proof may be used for different bindable entities only when each entity appears in the trusted stub;
- same idempotency key with changed projection/entity/source/profile/catalog/dictionary/body hash returns conflict;
- expired proof or deleted/missing stub fails closed.

## 6. Projection Stub Reader

VS1-M implementation must not read ST chat or reconstruct projection data. It can consume only the server-side stub produced by VS1-PI.

Production reader model:

- the independent visual asset service must use a reviewed service-to-service stub reader, not a browser-supplied stub and not a second ST parser;
- the reviewed HTTP reader is `GET /v1/visual/projection-stubs/:projectionId` on the existing game-config-service boundary;
- all HTTP calls, including loopback, require `Authorization: Bearer <GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN>` or a separately reviewed proxy/mTLS proof;
- CORS is disabled for this route; browsers are not allowed callers;
- `projectionId` must match the existing shared `^vvp_[a-z0-9_-]{12,80}$` pattern;
- the response body must be exactly `VisualProjectionStubV1` and must pass `validateVisualProjectionStub()`;
- the response must not include raw visible text, proof tokens, signature material, service secrets, full chat bodies, prompt/context/resource body, provider output, upload bytes or unrelated release/catalog data;
- missing token, wrong token, query-token transport, browser Origin, malformed id, missing stub, expired stub or deleted stub fails closed with a stable non-sensitive code;
- if the visual asset service has no configured `GALGAME_VISUAL_PROJECTION_STUB_BASE_URL` and no approved internal function reader, `POST /v1/visual-match` rejects with `VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE` and must not claim production readiness.

Same-process reader model:

- same-process access is allowed only as a direct internal function call that does not traverse HTTP, loopback, fetch, a route handler, a browser, or a socket;
- same-process tests must be marked test-only or same-process-only and must not be used to claim independent external-module deployment unless the HTTP stub reader tests also pass.

Stub validation:

- call `validateVisualProjectionStub()`;
- compare proof and stub exact fields: projectionId/projectionHash/sourceMessageHash/release/scenario/version/Arc/chat/profile/catalog/sourceMessageIndex/extractorVersion/dictionaryVersion/dictionaryHash/expiresAt;
- compare request `projectionId` to proof and stub;
- require request `entityKey` and `entityType` to exactly equal one canonical bindable entry in `stub.entities`;
- reject duplicate stub entity keys, `entityType: "unknown"` request, missing entity, cross-chat/release/profile/catalog/dictionary, stale source hash or expired stub.

The visual asset service must not trust browser-submitted labels, tags, candidates, scores, reason codes, asset ids or binding ids.

## 7. Catalog/Profile/Dictionary Scope

The matcher can read only the catalog/profile/dictionary scope proven by the projection proof and stub.

Catalog requirements:

- catalog id/revision/hash exact equality with proof and stub;
- catalog status `published`, or `archived` only with trusted old-save retention authorization;
- candidate refs must include `assetId`, `assetVersion`, `assetType`, `assetContentSha256`, `assetMetadataHash`;
- asset record must exist and match ref type/content hash/metadata hash/dictionaryVersion/dictionaryHash;
- draft, validated-only, archived-without-retention, missing content, hash mismatch, metadata mismatch, wrong MIME, wrong role or dictionary mismatch assets are not candidates.

Profile requirements:

- profile id/hash are read-only authority from the projection proof/stub;
- VS1-M must not create, edit, publish, rollback or infer profile authority;
- if no trusted profile reader exists in the future implementation, route must reject or return unknown; it must not use active/latest profile fallback.

Dictionary requirements:

- dictionaryVersion/dictionaryHash must match proof, stub, catalog and profile;
- no service upgrade may silently rematch old bindings against a newer dictionary;
- dictionary unavailable or hash mismatch resolves to unknown/recovery, not active/latest.

## 8. Content Hash Format Compatibility Gate

The existing shared match/binding validators expect `assetContentSha256` in `VisualMatchResultV1` and `VisualBindingV1` to be a plain 64-hex content hash. The existing visual asset service stores several asset/catalog fields as `sha256:<64 hex>` references.

The future implementation must not rely on implicit string equality between these forms.

Required compatibility rules:

- implement an explicit conversion boundary for service asset refs to shared match/binding refs;
- conversion from `sha256:<64 hex>` to plain `<64 hex>` is allowed only for the public shared `assetContentSha256` field;
- conversion from plain `<64 hex>` back to `sha256:<64 hex>` is allowed only when verifying asset-service catalog/content proof scope;
- any other format fails closed;
- tests must prove generated `VisualMatchResultV1` and `VisualBindingV1` pass shared validators while internal asset read/proof checks still match the asset-service catalog/content records;
- no public schema field may be added to carry both formats unless a separate schema gate approves it.

## 9. Immutable Unknown Compatibility Gate

VS1-M unknown fallback must use type-specific immutable unknown assets and must still pass shared validators.

Before enabling any successful unknown fallback result, implementation must run a compatibility check:

- shared `IMMUTABLE_UNKNOWN_VISUAL_ASSETS` for scene/character/equipment/item/skill;
- visual asset service published catalog refs for `unknown_scene`, `unknown_character`, `unknown_equipment`, `unknown_item`, `unknown_skill`;
- generated `VisualMatchResultV1`;
- generated `VisualBindingV1`;
- future asset read proof/content read expectations.

If shared immutable unknown refs and visual-asset-service unknown refs cannot be proven compatible, VS1-M must fail closed and record a blocker. It must not silently remap unknown assets, guess `unknown_item`, overwrite service-owned unknown records, or return a public binding that fails `validateVisualBinding()`.

Current compatibility warning: the shared immutable unknown refs use fixed placeholder content hashes, while the VS1-AS service-owned `unknown_*` assets are generated from canonical transparent PNG bytes. A future implementation must treat this as an active compatibility gate until it is resolved by a separately reviewed schema/asset reconciliation or by exact hash agreement. It must not silently translate one unknown ref family into the other.

## 10. Deterministic Matcher

The matcher must be deterministic-only.

Input facts:

- only `stub.entities[*].displayLabel`;
- only `stub.entities[*].visibleAttributes[*]`;
- only fixed profile/catalog/dictionary metadata already in trusted server stores;
- no raw chat text;
- no prompt/context/resource body;
- no provider output.

Candidate scoring:

- score is an integer 0..100;
- scoreBand is one of existing `unknown`, `low`, `medium`, `high`;
- reasonCodes are existing `VISUAL_REASON_CODES`, unique, 1..8;
- score policy must pass `applyVisualScorePolicy()` or a stricter service wrapper;
- unknown/duplicate/free-text reason codes fail;
- tie-break order is stable: higher score, exact type/role match, more dictionary signal matches, lower assetVersion only for same assetId/content hash, lexical assetId, assetContentSha256.

Entity gates:

- scene may use bounded visible environment/place/time/mood hints; ambiguous scene evidence can produce only low-confidence TTL scene binding or unknown;
- character concrete sprite requires explicit appearance evidence or approved non-factual silhouette/template policy; probable/ambiguous identity or appearance caps score at 19 and cannot create concrete fixed binding;
- equipment/item/skill require explicit visible label; missing label caps score at 0;
- visible traits may improve score but missing traits are not filled from D&D rules, hidden resources, names, stereotypes, class, faction or role title.

The matcher must never create item ownership, equipment state, skill ownership, HP, quest, relationship, route, node, choice or ending state.

## 11. VisualBindingStoreRecordV1

`VisualBindingV1` remains the public display-only DTO and must pass `validateVisualBinding()`. Store-only metadata lives in an internal record:

```ts
interface VisualProjectionReceiptV1 {
  schemaVersion: "galgame.visual-projection-receipt.v1";
  projectionId: string;
  projectionHash: string;        // sha256:<64 hex>
  releaseId: string;
  scenarioId: string;
  scenarioVersion: string;
  arcId: string;
  chatId: string;
  visualProfileId: string;
  profileHash: string;           // sha256:<64 hex>
  catalogId: string;
  catalogRevision: number;
  catalogHash: string;           // sha256:<64 hex>
  dictionaryVersion: string;
  dictionaryHash: string;        // sha256:<64 hex>
  extractorVersion: string;
  sourceMessageIndex: number;
  sourceMessageHash: string;     // sha256:<64 hex>
  entityKey: string;
  entityType: "scene" | "character" | "equipment" | "item" | "skill";
  proofNonceHash: string;        // sha256:<64 hex>, never the nonce itself
  proofIssuedAt: string;
  proofExpiresAt: string;
  receiptCreatedAt: string;
}

interface VisualBindingStoreRecordV1 {
  schemaVersion: "galgame.visual-binding-store-record.v1";
  binding: VisualBindingV1;
  bindingHash: string;        // sha256:<64 hex>
  projectionReceipt: VisualProjectionReceiptV1;
  projectionReceiptHash: string; // sha256:<64 hex>
  assetMetadataHash: string;  // sha256:<64 hex>
  retentionScopes: Array<{
    kind: "active-release" | "rollback-target" | "approved-old-save";
    scopeId: string;
    scopeHash: string;        // sha256:<64 hex>
    expiresAt?: string;
  }>;
  storageCreatedAt: string;
  storageUpdatedAt: string;
}
```

Closed schema limits:

- exact keys only;
- `schemaVersion` exact;
- record serialized size maximum 64KB;
- `projectionReceipt` serialized size maximum 16KB;
- `retentionScopes` maximum 32 entries;
- `scopeId` ASCII 1..128 and not URL/path-like;
- no duplicate retention scope key;
- all timestamps are ISO strings;
- `catalogRevision` and `sourceMessageIndex` are safe non-negative integers in their approved ranges;
- `entityKey` and `entityType` must match both the public binding and the original verified stub entity;
- unknown fields, duplicate JSON keys, prototype pollution keys, wrong hash format, overlong strings or invalid retention kind fail closed.

Canonicalization:

- `bindingHash` is `sha256:<64 hex>`: SHA-256 over canonical JSON v1 of the public `binding` object after `validateVisualBinding()` passes;
- `projectionReceiptHash` is `sha256:<64 hex>`: SHA-256 over canonical JSON v1 of `projectionReceipt` after the closed receipt validator passes;
- store startup must recompute `bindingHash` and `projectionReceiptHash`;
- store startup must verify the public binding's release/profile/catalog/dictionary/source/entity/asset provenance agrees with `projectionReceipt` and service-internal asset metadata;
- store startup must verify `assetMetadataHash` still matches the referenced asset metadata record;
- store startup must not call the short-lived Projection Stub route or require an unexpired proof/stub for an already persisted binding;
- expired or deleted projection stubs do not make a previously valid stored binding corrupt by themselves;
- any mismatch fails closed and must not silently delete or rewrite the record.

Projection receipt lifecycle:

- `projectionReceipt` is created only after the live `VisualProjectionProofV1` and `VisualProjectionStubV1` have already been verified for the current match request;
- it stores only bounded non-raw provenance and never stores raw visible text, proof token, nonce, signature, prompt/context/resource body, provider output, upload bytes or a client-supplied summary;
- it is immutable after binding creation;
- exact idempotency replay must reuse the same public binding and the same receipt hash;
- changed proof/stub/source/entity/profile/catalog/dictionary under the same idempotency key returns 409/no-overwrite;
- a stored binding without a valid receipt is invalid for VS1-M and must not be silently migrated to active/latest profile or catalog.

Persistence:

- production CLI must use a file-backed or equivalent persistent binding store if `POST /v1/visual-match` can create bindings;
- memory binding store is test-only or route-disabled;
- writes are atomic;
- duplicate binding id with different canonical body fails;
- exact replay reuses the existing binding body;
- corrupt records fail startup or request validation, not last-write-wins.

## 12. Binding Writer And Lifecycle

The writer is service-internal only. Browser requests never call it directly.

Writer inputs:

- validated request;
- verified proof;
- verified stub;
- verified catalog/profile/dictionary candidate;
- validated `VisualMatchResultV1`;
- trusted active release or trusted old-save authorization when retention is needed.

Writer outputs:

- public `VisualBindingV1`;
- immutable internal `VisualProjectionReceiptV1`;
- internal `VisualBindingStoreRecordV1`;
- `VisualMatchResultV1` referencing the created or reused binding.

Lifecycle rules:

- exact idempotency replay returns the same binding id and body;
- changed input under the same idempotency key returns 409/no-overwrite;
- scene can create a newer binding only by monotonic sourceMessageIndex and TTL policy; old scene binding stays readable internally;
- character binding is fixed after explicit evidence;
- equipment/item/skill binding is fixed on first explicit visible label under exact release/profile/catalog/dictionary scope;
- old save reads exact saved binding ids first through trusted save-binding authority and validates the stored `projectionReceipt` plus retention scope;
- missing receipt, missing binding, hash mismatch, archived-without-retention, profile/catalog/dictionary mismatch or absent trusted old-save reader returns unknown/recovery; no active/latest rematch.

Startup and lazy verification:

- startup validates persisted record shape, public binding hash, projection receipt hash, asset metadata hash, duplicate ids and retention scope integrity only;
- startup does not require the short-lived stub/proof to still exist;
- live visual-match requests must always fetch or internally read the current trusted stub and verify exact proof/stub/request scope before creating or reusing a binding for that live proof;
- old-save reads must use trusted save-binding authority plus the stored receipt and retained catalog/profile/asset scope; if the saved binding's receipt is missing or mismatched, return unknown/recovery and do not rematch against current active state;
- retention cleanup must not remove catalog, asset or binding records referenced by an unexpired `approved-old-save` or `rollback-target` retention scope.

`GET /v1/bindings/:bindingId` stays deferred. Any future browser-readable binding route needs a separate `galgame.visual-binding-read-proof.v1` or equivalent approved proof gate.

## 13. Failure Codes

Future implementation must use stable non-sensitive failure codes, including:

- `VISUAL_MATCH_AUTH_REQUIRED`
- `VISUAL_MATCH_ORIGIN_REJECTED`
- `VISUAL_MATCH_PREFLIGHT_REJECTED`
- `VISUAL_MATCH_REQUEST_INVALID`
- `VISUAL_MATCH_PROOF_FORBIDDEN_TRANSPORT`
- `VISUAL_MATCH_PROOF_INVALID`
- `VISUAL_MATCH_PROOF_VERIFIER_UNCONFIGURED`
- `VISUAL_MATCH_PROOF_REPLAYED`
- `VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE`
- `VISUAL_MATCH_PROJECTION_STUB_AUTH_REQUIRED`
- `VISUAL_MATCH_PROJECTION_STUB_AUTH_INVALID`
- `VISUAL_MATCH_PROJECTION_STUB_BROWSER_FORBIDDEN`
- `VISUAL_MATCH_PROJECTION_STUB_MISSING`
- `VISUAL_MATCH_SCOPE_MISMATCH`
- `VISUAL_MATCH_PROFILE_INVALID`
- `VISUAL_MATCH_CATALOG_INVALID`
- `VISUAL_MATCH_DICTIONARY_MISMATCH`
- `VISUAL_MATCH_ENTITY_INVALID`
- `VISUAL_MATCH_CONTENT_HASH_FORMAT_MISMATCH`
- `VISUAL_MATCH_UNKNOWN_COMPATIBILITY_FAILED`
- `VISUAL_MATCH_CANDIDATE_EMPTY`
- `VISUAL_MATCH_SCORE_BELOW_THRESHOLD`
- `VISUAL_BINDING_CONFLICT`
- `VISUAL_BINDING_STORAGE_INVALID`
- `VISUAL_BINDING_PROJECTION_RECEIPT_INVALID`
- `VISUAL_BINDING_BROWSER_WRITE_FORBIDDEN`
- `VISUAL_BINDING_OLD_SAVE_UNAUTHORIZED`
- `VISUAL_UNKNOWN_FALLBACK`

Errors and logs must not include raw visible text, prompt/context/resource body, provider output, proof token, secret, uploaded image bytes, local path, full catalog contents or binding ids beyond scoped test evidence.

## 14. Test Matrix Required For Implementation Approval

A later implementation batch must add or refresh tests for:

| Area | Required tests |
| --- | --- |
| Route auth/CORS | missing proof, proof in query/body/cookie, wrong Origin, no Origin browser request, preflight wrong method/header, loopback without proof all reject |
| Request schema | exact keys, duplicate JSON keys, wrong types, overlong body, invalid id patterns, `entityType: "unknown"`, prototype pollution all reject |
| Proof verification | missing secret, malformed header serialization, invalid shape, wrong audience/purpose, expired, future issuedAt, wrong signature, extra field all reject |
| Service-to-service stub route | game-config-service `GET /v1/visual/projection-stubs/:projectionId` missing token, wrong token, query token, browser Origin, malformed id, missing stub, expired stub and no-leak response all reject or return exact stable failure; correct token returns exactly `VisualProjectionStubV1` and no raw text/proof secret |
| Stub reader | visual asset service without configured production reader rejects; HTTP stub reader uses the exact base URL/token; missing stub, expired stub, hash mismatch, scope mismatch, duplicate entity keys, entity not in stub, unknown entity request all reject; same-process reader tests are labeled same-process-only |
| Proof reuse | exact replay returns same binding; different entity in stub allowed; entity not in stub rejected; same idempotency key with changed input conflicts |
| Hash compatibility | service prefixed content hash converts only at approved boundary; generated match/binding pass shared validators; asset read/proof scope still matches service catalog |
| Unknown compatibility | five type-specific unknown fallbacks pass shared validators and service catalog compatibility, or implementation stops with `VISUAL_MATCH_UNKNOWN_COMPATIBILITY_FAILED` |
| Candidate filtering | draft/validated-only, archived without old-save, wrong type/role, content hash mismatch, metadata hash mismatch, dictionary mismatch and missing bytes excluded |
| Score policy | finite 0..100, score band enum, strict reason code enum, deterministic tie-break, score<20 unknown |
| Character gate | explicit appearance succeeds; probable/ambiguous caps at 19; name/stereotype/class/faction cannot create concrete sprite |
| Equipment/item/skill gate | explicit visible label required; missing label caps at 0; traits are never defaulted from rules |
| Binding writer | exact replay, 409 conflict, no browser write, file-backed persistence, restart readback, corrupt record fail-closed |
| Projection receipt | binding creation persists receipt only after live proof/stub verification; receipt has no raw text/proof token/nonce/signature; startup recomputes receipt hash without calling expired stub; corrupt/missing receipt fails; same idempotency exact replay reuses receipt |
| Lifecycle | scene TTL/monotonic refresh, old scene binding retained, character fixed, equipment/item/skill first-label fixed |
| Old save | trusted old-save reader required; missing/forged old save rejects; deleted/expired historical stub does not break a valid stored receipt; old binding exact readback uses saved binding id + receipt + retention scope; no active/latest fallback |
| Startup validation | startup validates binding/store/receipt/asset metadata hashes and duplicate ids, but does not depend on short-lived proof/stub availability; missing receipt cannot be silently migrated |
| No leakage | logs/evidence omit raw text, prompts, proof tokens, secrets, provider output, uploaded bytes and local paths |
| Regression | VS1-SG shared tests, VS1-PI game-config-service tests, VS1-AS service tests, static architecture/source-public if applicable, protected/frozen/startup boundary and state validation |

Implementation evidence must preserve failures as superseded rather than overwriting them.

## 15. Reviewer Handoff Checklist

This code-admission request can be submitted for independent review when:

- VS1-M admission v1.2 PASS is recorded in state/progress/test-log/blockers;
- backlog points to this code-admission request;
- state is planning or verifying for VS1-M code-admission preparation, not implementation;
- no matcher/binding writer code has been added;
- no player/admin UI, VS-LLM/provider, ST backend/original public/root/startup path has changed;
- no Projection Issuer implementation has changed yet; this request only asks future permission for the read-only stub GET route named in section 6;
- docs coverage, diff-check, protected boundary/startup EOL, state validation and evidence inventory pass.

PASS of this request may authorize only the exact implementation scope in section 3. It still does not authorize VS-LLM, player/admin visual UI, Projection Issuer changes beyond the named read-only stub GET route, ST backend/original public changes, profile/manifest/ST writes or gameplay state.
