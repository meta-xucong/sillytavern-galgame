# VS1-M Deterministic Matcher And Binding Lifecycle Admission Plan

> Status: historical/future implementation appendix v1.2; paused by VS-DOCS scope  
> Scope: retained docs/state/evidence appendix only. This document does not authorize matcher implementation, binding writer implementation, player/admin visual UI, Projection Issuer changes, VS-LLM/provider calls, or SillyTavern backend/original public changes. Current route: `AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`.  
> Upstream gates: VS1-SG, VS1-PI and VS1-AS have reviewer PASS. This plan depends on their contracts and must not introduce parallel ids, route contracts, proof fields, public DTO fields or schema migrations without a separate reviewer gate.

## 1. Purpose

VS1-M is the future deterministic visual matching and display-binding lifecycle gate. It will connect:

- trusted `VisualVisibleProjectionV1` stubs/proofs produced by VS1-PI;
- published visual catalogs/assets produced by VS1-AS;
- published presentation/visual profile identity from the existing config/release authority;
- deterministic candidate filtering, scoring, immutable unknown fallback and display-only binding records.

VS1-M must remain presentation-only. It must not decide story facts, inventory ownership, skill ownership, equipment effects, relationship values, route, node, choice, ending or combat state.

## 2. Non-Negotiable Boundaries

VS1-M must not:

- read SillyTavern chats directly or implement its own chat parser;
- read hidden ST character cards, worldbooks, prompts, presets, context, settings, provider keys or internal memory;
- call original ST Generate or any bottom model endpoint;
- write ST resources, chats, profile, manifest, release or save authority;
- call an LLM/provider or accept provider output;
- accept raw visible chat text, prompt/context/resource body, uploaded image bytes, free reason text or arbitrary regex/patterns from browser requests;
- expose a browser-direct binding writer;
- create gameplay state such as obtained item, equipped weapon, learned skill, HP, quest completion or relationship state.

VS-LLM runtime visual matcher remains deferred/no-claim and requires a separate strict-provider gate.

## 3. Allowed Future Implementation Scope

If this admission package receives independent reviewer PASS, the next implementation request may propose only:

- `external-modules/visual-asset-service/**` deterministic matcher and binding lifecycle additions;
- service-local tests and fixtures;
- optional `frontend/shared/**` pure closed-schema helpers only with an exact file list and reviewer approval;
- `.codex-longrun/**` evidence/state/log updates and matching docs.

Default forbidden paths remain:

- `src/**`, `server.js`, `plugins.js`, `config.yaml`;
- original SillyTavern public frontend;
- root `package.json` / `package-lock.json`;
- startup scripts;
- `frontend/player/**`, `frontend/admin/**`, `public/game/**`, `public/game-admin/**` business UI;
- Projection Issuer implementation changes;
- VS-LLM/provider code.

## 4. Trusted Inputs

The matcher may consume only these trusted inputs:

1. A short-lived projection proof/stub from VS1-PI.
   - The visual service must verify the proof purpose/audience/scope and read the server-side projection stub through an approved service-to-service path.
   - The visual service must not trust browser-submitted `displayLabel`, `entityKey`, `entityType`, source hashes, release/profile/catalog fields or candidate lists.
   - Projection stub validation must include `projectionId`, `projectionHash`, `sourceMessageIndex`, `sourceMessageHash`, `releaseId`, `scenarioId`, `scenarioVersion`, `arcId`, `chatId`, `profileId/profileHash`, `catalogId/catalogRevision/catalogHash`, `dictionaryVersion/dictionaryHash`, expiry and nonce/replay policy.
2. A published visual catalog from VS1-AS.
   - Catalog id/revision/hash must match the projection scope.
   - Candidate assets must be selected only from the exact published or old-save-authorized catalog revision.
3. A published visual profile from the existing config/release authority.
   - Profile id/hash must match the projection scope.
   - If no approved profile reader or signed profile stub exists, matching must reject or return type-specific unknown.
4. The versioned dictionary package.
   - Dictionary version/hash must match both catalog and profile.

Any mismatch, missing reader, stale proof, replayed proof, expired proof, old-save authorization failure or cross-release/profile/catalog/dictionary scope must fail closed. It must not fall back to active/latest catalog or profile.

## 4.1 Projection Proof Transport And Stub Read

`POST /v1/visual-match` must use a single fixed browser proof header:

```txt
X-Galgame-Visual-Projection-Proof: <serialized galgame.visual-projection-proof.v1 value>
```

Rules:

- The proof must never be accepted from query strings, URL fragments, cookies, request body, multipart fields, localStorage, logs or evidence.
- Browser requests must pass the configured player `Origin` allowlist and `OPTIONS` preflight for method `POST` and header `X-Galgame-Visual-Projection-Proof`; `Origin`/CORS is an additional source restriction, not authorization.
- Browser request with no `Origin`, forged `Origin`, unallowlisted `Origin`, wildcard origin, wildcard+credentials, missing proof, wrong header name, proof in body/query/cookie, or extra non-allowlisted preflight header fails closed.
- Loopback is not authorization. HTTP requests from loopback without a valid proof and configured service boundary reject exactly like remote requests.
- Same-process calls, if used by future tests, must be direct internal function calls and must not pass through the HTTP route, socket, fetch or loopback.
- The header value must decode to the existing `VisualProjectionProofV1` shape from `frontend/shared/src/visual-system-schema.js`; VS1-M must not add a new proof envelope or any extra proof field in this admission.

The projection stub read path must be service-to-service only:

```http
GET /v1/visual/projection-stubs/{projectionId}
Authorization: Bearer <GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN>
```

Stub read rules:

- The token source is server-side env/secret manager only and must not appear in browser/static/manifest/localStorage/logs.
- Wrong/missing token, non-loopback exposure without token/proxy/mTLS, wrong audience, wrong projection id, expired stub, replay-disabled proof, hash mismatch or scope mismatch fails closed.
- If the implementation chooses direct in-process stub read instead of HTTP, that path must be an internal function call with equivalent auth/scope tests; the browser route still cannot bypass proof validation.
- The visual service must validate the returned stub against the proof and request: `projectionId`, `projectionHash`, `sourceMessageIndex`, `sourceMessageHash`, release/scenario/version/Arc/chat, profile, catalog, dictionary, expiry and `stub.entities`.

## 4.2 Projection Proof Reuse And Replay Semantics

Projection proof is scoped to one projection. The bounded entity set is the existing `VisualProjectionStubV1.entities` array from the projection stub, not a new proof field.

Required proof payload fields are exactly the existing `VisualProjectionProofV1` fields:

- `schemaVersion: "galgame.visual-projection-proof.v1"`;
- `audience: "visual-asset-service"`;
- `purpose: "visual-match"`;
- `projectionId`;
- `projectionHash`;
- `releaseId/scenarioId/scenarioVersion/arcId/chatId`;
- `profileId/profileHash`;
- `catalogId/catalogRevision/catalogHash`;
- `sourceMessageIndex/sourceMessageHash`;
- `extractorVersion`;
- `dictionaryVersion/dictionaryHash`;
- `issuedAt`, `expiresAt`, `nonce`;
- `signature`.

Required stub fields are exactly the existing `VisualProjectionStubV1` fields, including `entities`.

`stub.entities` constraints:

- maximum 32 entities, matching `VisualVisibleProjectionV1.entities`;
- every `entityKey` must match the existing `^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$` pattern and maximum 96 characters;
- every `entityType` must be one of `scene`, `character`, `equipment`, `item`, `skill` or `unknown`;
- duplicate `entityKey` values fail closed;
- VS1-M visual-match may operate only on bindable entity types `scene`, `character`, `equipment`, `item` or `skill`; `entityType: "unknown"` in the stub is not bindable and must resolve to rejection/unknown without guessing a type;
- the request `entityKey` and `entityType` must exactly equal one canonical entry in `stub.entities`.

Replay policy:

- The same proof may be used within TTL for each bindable entity in `stub.entities` at most once per exact `idempotencyKey`.
- Exact replay of the same proof + projectionId + entityKey + idempotencyKey + source hash returns the same match/binding result.
- Same proof with a different bindable entityKey is allowed only if that entityKey appears in `stub.entities` with the same bindable `entityType`.
- Same proof with entityKey not in `stub.entities`, different projectionId, different sourceMessageHash, different release/profile/catalog/dictionary scope or stale message fails closed.
- Same proof + same entityKey + different idempotencyKey may create a new attempt only if the previous attempt did not create a conflicting binding; otherwise it must reuse exact existing binding or reject conflict. It must never overwrite.
- Reuse after `expiresAt` fails closed. Reuse after stub deletion fails closed.

This is not a general unlimited replay. The replay cache key must include at minimum proof nonce, projectionId, entityKey and idempotencyKey.

## 5. VisualMatchRequestV1

Future `POST /v1/visual-match` may accept only a minimal closed request body:

```ts
interface VisualMatchRequestV1 {
  schemaVersion: "galgame.visual-match-request.v1";
  projectionId: string;
  entityKey: string;
  entityType: "scene" | "character" | "equipment" | "item" | "skill";
  idempotencyKey: string;
}
```

Rules:

- Exact keys are only `schemaVersion`, `projectionId`, `entityKey`, `entityType` and `idempotencyKey`.
- `schemaVersion` is exactly `galgame.visual-match-request.v1`.
- `projectionId` must reuse the existing VS1-SG/VS1-PI pattern `^vvp_[a-z0-9_-]{12,80}$`. VS1-M must not introduce another projection id family.
- `entityKey` must reuse the existing VS1-SG pattern `^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$` and maximum 96 characters. VS1-M must not introduce another entity key family.
- `entityType` must be one of the bindable types `scene`, `character`, `equipment`, `item` or `skill`; request `entityType: "unknown"` fails closed even though projection stubs may contain non-bindable unknown entities.
- `idempotencyKey` must reuse the existing pattern `^idem_[A-Za-z0-9._:-]{16,120}$`. VS1-M must not widen the length or character set without a separate schema gate.
- All ids are ASCII only; Unicode, whitespace, control characters, percent-encoding, path separators `\\` or `/`, URL-like prefixes, empty strings and overlong values fail closed.
- JSON body maximum is 4096 UTF-8 bytes. Duplicate JSON keys, non-canonical JSON if a canonical parser is required, arrays/objects where strings are expected, null, booleans, numbers, NaN/Infinity, prototype keys (`__proto__`, `constructor`, `prototype`) and unknown nested objects fail closed.
- The projection proof must be supplied in `X-Galgame-Visual-Projection-Proof`, not in query strings, URLs, multipart fields, localStorage or logs.
- The request body is only an index into the trusted projection stub. It cannot add facts, labels, tags, candidates, scores, reasons, profile fields or catalog fields.
- `entityKey` and `entityType` must exactly equal a canonical entity in the trusted projection stub and must be present in `stub.entities`. They are not hints.
- Admission test requirement: entityKey and entityType must exactly equal a canonical entity in the trusted projection stub; treating them as hints is forbidden.
- `idempotencyKey` must be unique per caller attempt, but exact replay of the same request must return the same result. Same idempotency key with different projection/entity/source/catalog/profile inputs is a conflict and fails closed.
- Unknown root/nested keys, alias/case variants, duplicate keys, oversize strings, invalid ids, invalid bindable type, empty idempotency key, `unknown` type, NaN/Infinity and prototype-pollution-shaped input fail closed.
- Browser CORS/Origin may narrow allowed player origins but never authorizes the match. A valid proof is still required.

## 6. Candidate Filtering

The service must construct candidates server-side:

- Candidate `assetType` must equal bindable entity type.
- Candidate `role` must match the VS1-AS type/role matrix.
- Candidate status must be published and in the exact catalog scope, or archived only when old-save proof/retention authorizes that exact old revision.
- Candidate `assetContentSha256`, `assetMetadataHash`, `dictionaryVersion` and `dictionaryHash` must match catalog refs.
- Unknown/service-owned assets may participate only as fallback results, not as normal scored candidates unless the policy explicitly selects silhouette/unknown.
- Draft, archived-without-retention, mismatched hash, mismatched dictionary, missing bytes, wrong MIME or metadata-invalid assets are not candidates.

The browser must never send candidate assets. The visual service must never query arbitrary catalogs by client-provided ids.

## 7. Evidence Gates By Entity Type

### Scene

Scene matching may use visible environment/place/time/mood hints from the projection stub. Ambiguous scene evidence may produce a low-confidence temporary background only under the scene TTL policy. It must not become a story fact.

Scene binding refresh is allowed only by:

- a newer monotonic `sourceMessageIndex` within the same chat/release/profile/catalog scope; and
- configured TTL message count or TTL time; and
- idempotent creation of a new display binding, never overwrite of the previous binding record.

### Character

Concrete character sprite binding requires:

- explicit visible speaker/name/entity identity; and
- explicit visible appearance evidence such as clothing, species, gender presentation, age band, body or other concrete non-hidden description; or
- an admin-published non-factual silhouette/template policy.

`probable` or `ambiguous` identity/appearance evidence cannot create a concrete fixed character sprite. It caps score at 19 and must resolve to type-specific unknown or approved silhouette/template.

The matcher must not infer sensitive appearance traits from names, stereotypes, role titles, language, class, faction or gameplay role.

### Equipment, Item And Skill

Equipment, item and skill binding requires an explicit visible label in the projection stub.

Allowed examples:

- equipment: `生锈短刀`, `长弓`, `Scale mail`;
- item: `铜制乌鸦徽记`, `黑羽毛`;
- skill: `火球术`, `潜行`, `Medicine`.

Visible traits may help scoring only if they are already present in the projection stub. Missing traits must not be filled from D&D rules, hidden resources or hardcoded defaults. No explicit label means score cap is 0 and no concrete asset binding is created.

The binding only means "this visible label is displayed with this icon". It does not mean obtained, owned, equipped, learned, usable, damaged, charged or effective.

## 8. Deterministic Score Policy

The scorer must be deterministic, bounded and reproducible:

- score is a finite integer from 0 to 100;
- `scoreBand` is one of `unknown`, `low`, `medium`, `high`;
- threshold for concrete display is profile-defined but cannot be below 20;
- score below 20, empty candidates, invalid candidates, stale scope or validation failure resolves to the type-specific immutable unknown asset;
- ties are broken by a stable deterministic order: higher score, narrower entity type match, more exact dictionary signal matches, lower assetVersion only when same assetId/content hash, then lexical `assetId`, then `assetContentSha256`;
- no randomness, wall-clock freshness, provider score, browser score or localStorage value may affect the result.

The service finalizes the score and band. Browser code cannot override score, band, reasons, asset id or binding id.

## 9. Reason Code Enum

Reason codes must be the existing VS1-SG `VISUAL_REASON_CODES` closed enum. VS1-M must not introduce a parallel reason-code vocabulary. Allowed code set:

- `explicit-visible-label`
- `explicit-appearance`
- `type-match`
- `tag-overlap`
- `locale-match`
- `style-match`
- `negative-tag-conflict`
- `ambiguous-appearance-capped`
- `missing-visible-label`
- `scene-ambiguous-low-confidence`
- `candidate-empty`
- `asset-missing`
- `hash-mismatch`
- `proof-invalid`
- `projection-stale`
- `dictionary-unavailable`
- `unknown-fallback`

Unknown, duplicate, wrong-type, free-text, provider-style, URL-like or prompt-injection-shaped reason codes must fail closed. The service may map internal errors to these fixed codes for UI display, but must not expose raw provider text, prompt text, uploaded metadata, raw chat text or secrets.

## 10. VisualMatchResultV1

The response must match the existing VS1 formal `VisualMatchResultV1` schema exactly. Exact keys are:

- `schemaVersion: "galgame.visual-match-result.v1"`;
- `matchId`;
- `bindingId`;
- `entityKey`;
- `type`;
- `catalogId`;
- `catalogRevision`;
- `catalogHash`;
- `visualProfileId`;
- `profileHash`;
- `evidenceDigest`;
- `projectionId`;
- `sourceMessageIndex`;
- `sourceMessageHash`;
- `assetId`;
- `assetVersion`;
- `assetContentSha256`;
- `matcherVersion`;
- `scorerVersion`;
- `dictionaryVersion`;
- `dictionaryHash`;
- `score`;
- `scoreBand`;
- `reasonCodes`;
- `usesLlm`;
- `createdAt`;
- optional `expiresAt`.

Exact field constraints must cross-reference and pass the existing `validateVisualMatchResult()` guard in `frontend/shared/src/visual-system-schema.js`:

- `matchId` pattern `^vm_[a-z0-9_-]{12,80}$`;
- `bindingId` pattern `^vb_[a-z0-9_-]{12,80}$`;
- `entityKey` pattern `^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$`, maximum 96 characters, and exact equality with a bindable canonical entity in the trusted stub;
- `type` one of `scene`, `character`, `equipment`, `item`, `skill`;
- `catalogRevision` and `assetVersion` positive integers;
- hash fields use `sha256:[a-f0-9]{64}` where the upstream schema requires prefixed digest, and `assetContentSha256` uses the existing 64-hex content hash form;
- `score` finite integer `0..100`, `scoreBand` one of `unknown`, `low`, `medium`, `high`, `reasonCodes` unique existing enum values, `usesLlm: false`;
- unknown keys, missing required keys, wrong types, `type: "unknown"`, NaN/Infinity, duplicate reason codes and prototype-pollution-shaped values fail closed.

`bindingId` is required for any successful `VisualMatchResultV1`. A type-specific unknown fallback is still a successful display binding and must therefore create or reuse a binding id that points to the immutable unknown asset. If the service cannot safely create/reuse a binding, it must reject with a stable failure code instead of returning a partial match result.

All provenance fields are service-derived. The browser cannot provide or override them.

If the matcher cannot verify scope, source, catalog, profile, dictionary or asset integrity, the result must either:

- return a type-specific immutable unknown asset for a valid bindable type; or
- reject with a stable failure code when the bindable type itself is invalid or missing.

It must never use `type: "unknown"` in `VisualMatchResultV1`.

## 11. Binding Writer Boundary

No browser endpoint may write bindings.

Allowed future model:

- `POST /v1/visual-match` validates proof, stub, profile, catalog, dictionary, candidates, score and conflict state.
- Only after validation may a service-internal binding writer create or reuse a binding.
- If an HTTP route for `POST /v1/bindings` exists at all, it must be service-internal only, disabled for browser CORS, protected by service token/mTLS/proxy proof, and not exported by shared/player code.

Binding writer must:

- be idempotent for exact same idempotency key, projection, entity, asset, profile, catalog and source hash;
- reject conflicts with 409/no-overwrite;
- persist bindings in a production-safe store, not memory-only by default;
- store no raw visible chat text, prompt/context/resource body, provider response, uploaded image bytes or local path;
- store enough provenance to restore old saves exactly.

`VisualBindingV1` must remain exactly aligned with the existing VS1-SG closed schema. Exact public binding keys are:

- `schemaVersion: "galgame.visual-binding.v1"`;
- `bindingId`;
- `bindingType`;
- `entityKey`;
- `releaseId/scenarioId/scenarioVersion/arcId/chatId`;
- `sourceMessageIndex/sourceMessageHash`;
- `evidenceDigest`;
- `projectionId`;
- `visualProfileId/profileHash`;
- `catalogId/catalogRevision/catalogHash`;
- `assetId/assetVersion/assetContentSha256`;
- `matcherVersion/scorerVersion/dictionaryVersion/dictionaryHash`;
- `score/scoreBand/reasonCodes`;
- `bindingPolicy`;
- `idempotencyKey`;
- `createdAt/updatedAt`;
- optional `expiresAt`.

Exact field constraints must cross-reference and pass the existing `validateVisualBinding()` guard. `bindingId` must match `^vb_[a-z0-9_-]{12,80}$`, `entityKey` must match the existing entity key pattern, hash fields must use the same prefixed/plain digest forms as the shared validator, score/reason/policy must use existing enums, and unknown keys or missing required fields fail closed.

The following are service-internal persistence metadata only and must not be added to `VisualBindingV1`, `VisualMatchResultV1`, player responses or shared/player DTOs without a separate schema gate:

```ts
interface VisualBindingStoreRecordV1 {
  schemaVersion: "galgame.visual-binding-store-record.v1";
  binding: VisualBindingV1;
  bindingHash: string;
  projectionHash: string;
  assetMetadataHash: string;
  retentionScopes: Array<{
    kind: "active-release" | "rollback-target" | "approved-old-save";
    scopeId: string;
    scopeHash: string;
    expiresAt?: string;
  }>;
  storageCreatedAt: string;
  storageUpdatedAt: string;
}
```

Internal `bindingHash` is computed over canonical `VisualBindingV1` plus approved immutable service metadata as specified by the implementation gate; it is used for store integrity and old-save retention checks only. Internal `retentionScopes` are produced by trusted active release, rollback or save-binding readers; client-provided values are never accepted.

The writer may consume only:

- the validated `VisualMatchResultV1`;
- trusted release/profile/catalog/projection scope already verified by `POST /v1/visual-match`;
- a trusted active release or signed old-save authorization from config/save authority when writing or retaining old-save bindings.

Client-provided `oldSave`, `bindingIds`, `releaseId`, `chatId`, `profileHash` or `catalogHash` are hints only. Without a trusted active release reader, trusted save-binding reader or signed old-save authorization, writer must return unknown/recovery and must not create or select a binding.

## 11.1 Binding Read Route Deferral

Player `GET /v1/bindings/:bindingId` is deferred for VS1-M v1.2.

This admission does not authorize a browser-readable binding GET route unless a later review adds a closed `galgame.visual-binding-read-proof.v1` or explicitly reuses visual-match proof with exact purpose/audience/scope semantics. Until then:

- service-internal code may read bindings directly from the store after visual-match validation;
- admin debug read, if future-approved, must use admin auth and must not expose player-only or raw evidence fields;
- browser/player cannot query arbitrary binding ids;
- shared/player code must not export a binding-read client.

## 12. Binding Lifecycle

`VisualBindingV1` is display-only.

Lifecycle rules:

- Scene binding may refresh only by TTL and monotonic message sequence. Older scene bindings remain readable for old saves.
- Character binding is session/save fixed after explicit evidence. A later different concrete asset for the same character entity is a conflict unless a future reviewed admin migration exists.
- Equipment/item/skill binding is fixed for first visible label under the save/release/profile/catalog scope.
- Unknown fallback binding retains the bindable type and exact immutable unknown asset id/version/hash.
- Old save restores exact `releaseId/scenarioId/scenarioVersion/arcId/chatId/visualProfileId/profileHash/catalogId/catalogRevision/catalogHash/bindingIds`.
- Missing binding, asset hash mismatch, profile mismatch, catalog mismatch, dictionary mismatch, archived-without-retention or stale proof resolves to type-specific unknown or recovery error; never active/latest fallback.

Binding records must not become inventory, skill, ownership, unlock, quest or combat state.

## 12.1 Active Selection And Read Semantics

Current display binding selection is deterministic:

- Selection scope is exact `releaseId/scenarioId/scenarioVersion/arcId/chatId/visualProfileId/profileHash/catalogId/catalogRevision/catalogHash/dictionaryVersion/dictionaryHash`.
- For `scene`, select the newest non-expired scene binding whose `sourceMessageIndex` is less than or equal to the current projection/message index, whose TTL policy still applies, and whose source hash/projection/catalog/profile/dictionary all match. Ties are resolved by higher `sourceMessageIndex`, later `createdAt`, lexical `bindingId`.
- For `character`, select the fixed binding for the exact entityKey under the save/session scope. A newer conflicting binding for the same entityKey is not auto-selected.
- For `equipment`, `item` and `skill`, select the first visible-label binding for the exact entityKey under the save/session scope.
- Exact idempotency replay returns the same binding id and binding body.
- Same entityKey with newer scene `sourceMessageIndex` creates a new scene binding only if TTL/monotonic rules allow it; it does not overwrite the old one.
- Same entityKey with different sourceMessageIndex for character/equipment/item/skill is a conflict unless it resolves to the exact same binding body.
- Old saves read by explicit saved `bindingIds` first. If a saved binding id exists and its hash/scope matches, it wins over current active selection. If missing or mismatched, return unknown/recovery; do not rematch active/latest.
- A request without trusted old-save binding ids cannot claim old-save selection from client fields.

Tests must cover exact replay, same idempotency with changed input conflict, scene newer-message selection, scene old binding still readable by bindingId, character/equipment fixed conflict, saved binding id readback and old-save missing binding no active fallback.

## 13. Storage, Retention And Cleanup

Future binding store must:

- use atomic writes and startup validation;
- reject duplicate binding ids with different canonical body;
- reject malformed/corrupt persisted records on startup or request;
- include `bindingHash` or equivalent canonical body hash;
- retain bindings referenced by active releases, rollback targets or known saves;
- refuse cleanup while retained saves or rollback scopes reference the binding;
- keep old dictionary/catalog/profile references readable for the approved retention window.

If old retention cannot be proven, the service must return unknown/recovery rather than rematching against active/latest catalog.

## 14. API And Auth Requirements

Future route surface may include:

| Route | Caller | Auth | Purpose | Forbidden |
| --- | --- | --- | --- | --- |
| `POST /v1/visual-match` | player route or controlled service path | `X-Galgame-Visual-Projection-Proof` + exact player Origin allowlist where browser + service-to-service stub token | deterministic match and service-internal binding reuse/create | raw facts, candidate list, provider score, ST Generate |
| `GET /v1/bindings/:bindingId` | deferred | deferred pending `galgame.visual-binding-read-proof.v1` or equivalent approved proof | no browser route in VS1-M v1.2 | cross-chat search, active/latest fallback |
| `POST /v1/bindings` | service-internal only if exposed | service token/mTLS/proxy proof; no browser CORS | internal binding writer | browser direct write, shared/player client |

Health may remain unauthenticated only if it returns a strict whitelist with no counts, binding ids, catalog activity, filenames, proofs, secrets or recent match details.

## 15. Failure Codes

Future tests must use stable non-sensitive failure codes, including:

- `VISUAL_MATCH_AUTH_REQUIRED`
- `VISUAL_MATCH_ORIGIN_REJECTED`
- `VISUAL_MATCH_PREFLIGHT_REJECTED`
- `VISUAL_MATCH_PROOF_INVALID`
- `VISUAL_MATCH_PROOF_FORBIDDEN_TRANSPORT`
- `VISUAL_MATCH_PROOF_REPLAYED`
- `VISUAL_MATCH_STUB_AUTH_REQUIRED`
- `VISUAL_MATCH_PROJECTION_STUB_MISSING`
- `VISUAL_MATCH_SCOPE_MISMATCH`
- `VISUAL_MATCH_PROFILE_INVALID`
- `VISUAL_MATCH_CATALOG_INVALID`
- `VISUAL_MATCH_DICTIONARY_MISMATCH`
- `VISUAL_MATCH_ENTITY_INVALID`
- `VISUAL_MATCH_CANDIDATE_EMPTY`
- `VISUAL_MATCH_SCORE_BELOW_THRESHOLD`
- `VISUAL_BINDING_CONFLICT`
- `VISUAL_BINDING_NOT_FOUND`
- `VISUAL_BINDING_STORAGE_INVALID`
- `VISUAL_BINDING_READ_DEFERRED`
- `VISUAL_BINDING_BROWSER_WRITE_FORBIDDEN`
- `VISUAL_BINDING_OLD_SAVE_UNAUTHORIZED`
- `VISUAL_UNKNOWN_FALLBACK`

Errors must not include raw visible text, prompt/context/resource body, provider output, proof token, secret, uploaded image bytes or local path.

## 16. Evidence Matrix

VS1-M implementation may not be requested until this admission plan passes independent review. A future implementation request must produce evidence for:

| Area | Required evidence |
| --- | --- |
| Scope | no ST backend/original public/root/startup change; no player/admin UI change; no VS-LLM/provider code |
| Projection trust | visual service verifies projection proof and reads server-side stub; missing/expired/replayed/cross-chat/cross-release/hash mismatch fails |
| Projection transport | fixed `X-Galgame-Visual-Projection-Proof` header; query/body/cookie/log proof rejected; no-Origin/forged-Origin/unallowlisted Origin/preflight mismatch rejected; loopback without proof rejected |
| Stub read auth | service-to-service stub token or internal function only; wrong/missing token, browser stub read and scope mismatch rejected |
| Proof reuse | same proof allowed only for bounded entity set and exact idempotency replay; cross entity not in set/cross message/expired/stub deleted/different source hash rejected |
| Request schema | exact request keys, ASCII id formats, body size, duplicate key/canonical JSON/prototype pollution/idempotency conflict tests |
| No ST chat read | static audit proves matcher does not call ST chat APIs or duplicate visible extractor/parser |
| Profile/catalog scope | profileId/hash, catalogId/revision/hash and dictionaryVersion/hash exact; active/latest fallback rejected |
| Candidate filtering | candidates selected only from exact catalog/status/type/role/hash/dictionary; browser candidate list ignored/rejected |
| Character gating | explicit appearance required; probable/ambiguous cap=19; no stereotype/name-based sensitive inference |
| Equipment/item/skill gating | explicit visible label required; missing label cap=0; traits not defaulted from rules |
| Score policy | bounded finite score, fixed bands, score<20 unknown, deterministic tie-break, strict reason code enum |
| Unknown fallback | type-specific immutable unknown exact id/version/hash; invalid/missing bindable type does not guess item |
| Binding read deferral | player `GET /v1/bindings/:bindingId` absent or returns deferred/forbidden; no shared/player binding-read client |
| Binding writer | browser direct write rejected; service-internal writer idempotent; exact public `VisualBindingV1` schema plus internal store envelope hash; conflicts 409/no-overwrite |
| Binding lifecycle | scene TTL/monotonic refresh, deterministic active selection, old scene binding readable by id, character fixed, equipment/item/skill first visible label fixed |
| Old save | trusted save-binding reader or signed old-save authorization required; exact old release/profile/catalog/dictionary/binding restore; missing/mismatch/archived-without-retention unknown; no active/latest |
| Persistence | binding store atomic startup validation, duplicate/corrupt record fail-closed, retention-safe cleanup |
| Privacy/logs | no raw visible text, prompt/context/resource body, provider response, proof, key, uploaded bytes or local path |
| Regression | VS1-SG, VS1-PI, VS1-AS service tests and static architecture remain green |
| State/evidence | docs diff-check, protected boundary/startup EOL, state validation and no-BOM evidence inventory pass |

## 17. Reviewer Handoff Checklist

VS1-M admission can be submitted for independent review when:

- VS1-AS final reviewer PASS is recorded in state/progress/test-log/blockers.
- This document is linked from backlog.
- State is `planning` or `verifying` for VS1-M admission, not implementation.
- No VS1-M matcher/binding writer code has been added.
- No frontend player/admin UI, Projection Issuer implementation, VS-LLM/provider, ST backend/original public/root/startup path has changed.
- Docs diff-check, protected tracked/untracked boundary, startup EOL, state validation and evidence inventory pass.

PASS of this document may authorize only a later, separate VS1-M code-admission request. It does not by itself authorize implementation.
