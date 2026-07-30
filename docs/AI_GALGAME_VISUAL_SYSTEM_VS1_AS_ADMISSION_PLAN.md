# VS1-AS Asset Security And Catalog Implementation Verification Plan

> Status: historical/future implementation appendix v1.5; paused by VS-DOCS scope  
> Scope: retained implementation appendix only. Existing service code/evidence is preserved but not current deliverable; this document does not authorize VS1-M, binding writer, player/admin visual UI, Projection Issuer changes, VS-LLM, or SillyTavern backend/original public changes. Current route: `docs/AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`.  
> Native-first boundary: SillyTavern backend, original public frontend, original storage/routes/auth/CSRF, root dependencies, config and startup files remain frozen.

## 1. Purpose

VS1-AS is the approved asset security/catalog service batch for storing scene images, character sprites, equipment images, item icons and skill icons as removable presentation assets.

The implementation now exists only as an independent `external-modules/visual-asset-service` skeleton after VS1-AS v1.4 admission PASS and the v6 source root-fix review. It implements upload quarantine, safe PNG decode/re-encode, final served-byte hashes, closed metadata/dictionary validation, content-addressed storage, immutable unknown assets, catalog lifecycle, proof-gated player content read, admin auth/read, health whitelist and retention-safe behavior.

VS1-AS still does not implement runtime matching, binding writer, player visual UI, admin catalog UI, image generation, provider calls, VS-LLM, Projection Issuer changes, profile/manifest writes, ST resource writes or gameplay state.

## 2. Allowed And Forbidden Implementation Scope

The approved VS1-AS implementation scope is limited to:

- `external-modules/visual-asset-service/**` as an independently removable service.
- Service-local tests and fixtures under that module.
- Necessary docs/evidence/state updates.
- Pure shared schema helpers only if a reviewer explicitly approves the exact file list. No such shared expansion is required by the v6 implementation.

VS1-AS code must not modify:

- `src/**`, `server.js`, `plugins.js`, `config.yaml`.
- Original SillyTavern public frontend.
- Root `package.json` or `package-lock.json`.
- Startup scripts.
- `frontend/player/**`, `frontend/admin/**` business UI.
- `public/game/**` or `public/game-admin/**` except explicitly approved shared build consistency.
- Projection Issuer implementation, original-runtime-bridge, player save, publish/rollback core, runtime scorer, binding writer or any provider/LLM path.

## 3. Service Boundary

The visual asset service runs outside SillyTavern. It may call only explicit custom contracts and may be removed without changing SillyTavern.

It must not:

- Read SillyTavern hidden character cards, worldbooks, prompts, context, settings, internal memory or provider keys.
- Read original ST chat directly or maintain its own chat parser.
- Call original ST Generate or bottom generate endpoints.
- Write ST resources.
- Store gameplay facts such as HP, inventory ownership, skill ownership, relationship values, route, node, choice or ending state.

VS1-AS stores only assets, catalog metadata and immutable revisions. Presentation profile authority remains in the existing config/release/profile boundary; VS1-AS may consume published `visualProfileId/profileHash` as read-only scope but must not create, overwrite, publish or rollback presentation profiles.

## 4. Authentication And Routes

Hidden routes are not authentication. CORS and loopback are not authentication.

Admin write APIs must fail closed unless one of these is configured:

- `GALGAME_VISUAL_ASSET_ADMIN_TOKEN` for Bearer admin requests; or
- a reviewed external auth/proxy/mTLS/session boundary that injects a verifiable admin identity.

If the service is exposed to non-loopback without a valid admin auth boundary, admin APIs must refuse to start or reject every request. Health checks may remain unauthenticated only if they return a strict non-sensitive whitelist.

Authentication modes are mutually explicit:

- Bearer mode: `Authorization: Bearer <GALGAME_VISUAL_ASSET_ADMIN_TOKEN>` is required on every admin write/read route except health. The token must never be accepted in query strings, fragments, multipart fields, metadata, logs or evidence. Browser requests with a forged or disallowed `Origin` must still reject.
- External proxy/session mode: the reviewed proxy/session/mTLS boundary must inject a verifiable admin identity. Browser cookie/session writes must require an allowed `Origin` plus a valid CSRF token. Missing `Origin`, forged `Origin`, missing CSRF, stale CSRF, cross-origin credentials without allowlist, and preflight header mismatch must all fail closed.
- Service-internal mode: only non-browser internal function calls inside an approved service boundary may bypass HTTP. Same-origin, loopback and CORS are not sufficient proof of this mode.

CORS may only narrow allowed browser origins; it never authorizes a request. `Access-Control-Allow-Credentials: true` is allowed only for exact admin origins and only when the matching auth/CSRF mode is configured.

Player asset reads have their own browser-origin contract:

- `GALGAME_VISUAL_ASSET_PLAYER_ORIGINS` is the only approved production allowlist for browser player origins that may send `X-Galgame-Visual-Asset-Proof`.
- Same-origin deployment is allowed only when the served `/game/` origin exactly matches the configured visual asset service public origin. It still requires a valid read proof; same-origin is not authorization.
- No wildcard origin is allowed. `Access-Control-Allow-Origin: *` must never be combined with `X-Galgame-Visual-Asset-Proof`, cookies, credentials or private asset reads.
- `Access-Control-Allow-Credentials: true` is not required for the proof-header asset route and should remain absent unless a later reviewed deployment explicitly needs cookies for a separate auth layer. If enabled in a reviewed mode, it must be paired with an exact origin match and never with `*`.
- Browser `OPTIONS` preflight for the player content route may allow only method `GET`, header `X-Galgame-Visual-Asset-Proof`, and the minimal browser-required headers. Any requested method other than `GET`, any non-allowlisted request header, any unconfigured origin, forged origin, wildcard origin, or browser request with no `Origin` fails closed before proof verification.
- `Access-Control-Allow-Headers` for an accepted player preflight must be an exact allowlist that includes `X-Galgame-Visual-Asset-Proof` and only the minimal required browser headers. It must not echo arbitrary requested headers.
- The service must set `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers` on preflight responses that vary by origin/header/method.
- A failed preflight must not reveal asset existence, catalog ids, file paths, proof parse details or secret state.
- Non-browser controlled server-to-service callers must send the same compact proof in `X-Galgame-Visual-Asset-Proof` over an approved internal service path and may additionally use service authentication. They must not rely on CORS, `Origin` or `Referer` and must not put the proof in URLs, query strings, cookies, bodies or logs.

Implemented VS1-AS route surface:

| Route | Caller | Auth | Purpose |
| --- | --- | --- | --- |
| `GET /v1/health` | operator | public non-sensitive | Returns only ok/service/schema/adminAuth/catalogStore status. No counts, filenames, paths, keys or upload activity. |
| `POST /v1/admin/assets/upload` | admin service path | required | Upload one image plus closed metadata into a draft asset. |
| `GET /v1/admin/assets/:assetId/:assetVersion` | admin service path | required | Read draft or published metadata and safe thumbnails. |
| `POST /v1/admin/catalogs/draft` | admin service path | required | Create or update a draft catalog revision from validated asset refs. |
| `POST /v1/admin/catalogs/:catalogId/:revision/validate` | admin service path | required | Validate immutable unknown assets, asset hashes, URI safety and metadata schema. |
| `POST /v1/admin/catalogs/:catalogId/:revision/publish` | admin service path | required | Atomically publish an immutable catalog revision. |
| `POST /v1/admin/catalogs/:catalogId/:revision/archive` | admin service path | required | Archive a catalog revision without deleting old-save-readable assets. |
| `GET /v1/assets/:catalogId/:revision/:assetId/:assetVersion/content` | player read path | `galgame.visual-asset-read-proof.v1` required | Serve only the canonical stored bytes for the exact published asset ref bound to the caller's release/Arc/profile/catalog scope. The request cannot choose filename, extension, MIME, hash or alternate path. |
| `GET /v1/admin/assets/:assetId/:assetVersion/content` | admin read path | admin auth required | Serve draft/validated/published asset bytes only to an authenticated admin path for inspection. |

No browser endpoint may write bindings. The binding writer remains a future service-internal VS1-M gate.

Player asset reads require a short-lived `galgame.visual-asset-read-proof.v1`. Published-only is not sufficient authorization because it would allow arbitrary enumeration of published catalog assets.

## 4.1 Visual Asset Read Proof Contract

`galgame.visual-asset-read-proof.v1` is the only approved player authorization token for published asset byte reads in VS1-AS. It is purpose-specific and cannot authorize admin routes, uploads, catalog writes, binding writes, projection issuance, scorer calls or provider calls.

The only signer is the existing config-service or an explicitly reviewed controlled server boundary that already verifies active release or old-save binding scope. Browser code, the player app, the visual asset service, static files and administrator UI code must never sign this proof and must never hold the signing secret.

Required signer/verifier configuration:

- `GALGAME_VISUAL_ASSET_READ_PROOF_SECRET`: server-side signing secret only.
- `GALGAME_VISUAL_ASSET_READ_PROOF_KEY_ID`: stable key id/version included in the proof.
- Optional rotation: service may verify one previous key id for a bounded overlap window, but only if the key id is listed in server config. Unknown key id fails closed.

Signing algorithm:

- Initial approved algorithm: `HMAC-SHA256`.
- Signature uses the compact envelope below. The raw secret, signature key, canonical payload and complete compact token must not be logged.

Proof envelope:

```txt
gvarp1.<payloadB64UrlNoPadding>.<signatureB64UrlNoPadding>
```

Grammar and size:

- Prefix is exactly ASCII `gvarp1`.
- The token has exactly three dot-separated segments.
- `payloadB64UrlNoPadding` uses only `A-Z a-z 0-9 _ -`, no `=`, no whitespace, no percent encoding and no Unicode.
- `signatureB64UrlNoPadding` is the base64url-no-padding encoding of the 32-byte HMAC-SHA256 signature and is exactly 43 characters.
- Maximum complete token length is 4096 ASCII bytes.
- Maximum decoded payload length is 3072 UTF-8 bytes.

Signing input:

```txt
ASCII("gvarp1.") + payloadB64UrlNoPadding
```

Signature:

```txt
base64url_no_padding(HMAC_SHA256(secret_for_keyId, signingInput))
```

The payload is the canonical UTF-8 JSON bytes of `VisualAssetReadProofV1`. The signature does not cover a parser-specific object; it covers the exact compact-signing input above.

Canonical JSON version:

- `galgame.canonical-json.v1`.
- Payload object keys are exact ASCII protocol keys and serialized in ascending ASCII byte order at every nesting level.
- No duplicate keys are allowed in the raw JSON text before object materialization.
- Unknown keys, aliases and case variants reject before canonicalization.
- Strings in this proof payload are ASCII-only protocol strings. Non-ASCII, control characters, overlong strings and alternate Unicode normalization forms reject.
- Numbers are JSON integers only where the schema says `number`; no floats, exponent notation, negative values, `-0`, stringified numbers, `NaN`, `Infinity` or leading-plus signs.
- Serialization has no insignificant whitespace.
- The verifier must decode payload bytes as UTF-8, reject malformed UTF-8, parse with duplicate-key detection, validate the closed schema, reserialize with `galgame.canonical-json.v1`, and require byte-for-byte equality with the decoded payload before verifying the signature.
- Payload modifications, key-order changes, Unicode variants, numeric format changes, type changes, added/removed fields and truncated signatures must all fail closed.

Proof payload closed schema:

```ts
interface VisualAssetReadProofV1 {
  schemaVersion: "galgame.visual-asset-read-proof.v1";
  audience: "visual-asset-service";
  purpose: "asset-read";
  issuer: "game-config-service" | "approved-visual-proof-issuer";
  keyId: string;        // 1..64, server-configured key id
  algorithm: "HMAC-SHA256";
  issuedAt: string;     // ISO timestamp
  expiresAt: string;    // ISO timestamp, max TTL 300000ms unless reviewer approves otherwise
  nonce: string;        // 16..96 URL-safe chars, globally unique per proof
  release: {
    releaseId: string;
    scenarioId: string;
    scenarioVersion: string;
    arcId: string;
  };
  profile: {
    visualProfileId: string;
    profileHash: string;
  };
  catalog: {
    catalogId: string;
    catalogRevision: number;
    catalogHash: string;
  };
  asset: {
    assetId: string;
    assetVersion: number;
    assetContentSha256: string;
  };
  oldSave?: {
    saveIdHash: string;
    saveBindingHash: string;
  };
}
```

All ids, hashes, revision/version numbers, timestamps and nonce formats are exact and bounded. Unknown keys, aliases, wrong casing, stringified numbers, floats, NaN/Infinity, overlong fields, wrong audience, wrong purpose, unknown signer, unknown key id, unsupported algorithm, expired proof, future `issuedAt` beyond skew, missing signature, invalid signature and duplicate nonce all fail closed.

HTTP transport:

- Player asset reads must send the compact proof in `X-Galgame-Visual-Asset-Proof`.
- The proof must not be accepted from query strings, URL path, hash fragment, cookies, multipart fields, body JSON, referrer, localStorage or logs.
- `Authorization: Bearer` is reserved for admin auth and must not authorize player asset reads.
- `X-Galgame-Visual-Asset-Proof` must not authorize admin APIs.
- CORS, same-origin, loopback, `Origin`, `Referer`, route params and published catalog status are not authorization.
- Browser preflight and origin checks must follow the player-origin contract in section 4. `Origin` allowlisting is an additional source constraint only; a valid compact proof is still mandatory.

Verifier:

- The only verifier for the player content route is the visual asset service server route.
- The visual asset service must verify the compact proof before reading asset bytes.
- The visual asset service does not sign proofs.

Validation order:

1. Reject if proof is absent from `X-Galgame-Visual-Asset-Proof` or appears in a forbidden transport location.
2. Parse the compact proof within strict size limits and reject unknown keys or malformed fields.
3. Select the server-configured key by `keyId`; reject unknown, disabled or expired key id.
4. Verify HMAC over canonical payload; reject invalid signature.
5. Verify `audience`, `purpose`, `issuer`, `algorithm`, `issuedAt`, `expiresAt`, max TTL and clock skew.
6. Verify nonce has not been used. Replay cache key is `keyId + nonce + audience + purpose`; entries expire after proof expiry plus a small cleanup skew. A second use of the same nonce rejects, even for the same route. File-backed nonce storage must use an atomic create-or-fail operation, or the deployment must document and enforce a reviewed single-writer boundary; an `exists` check followed by a non-exclusive write is not sufficient.
7. Compare route `catalogId/revision/assetId/assetVersion` with proof `catalog/asset`.
8. Read the published catalog record and compare `release/profile/catalog/asset/assetContentSha256` exact scope.
9. For old-save proof, verify the proof was minted only after an approved save-binding reader confirmed `saveIdHash/saveBindingHash` and exact old release/profile/catalog scope. Client old-save fields alone are never enough.
10. Compare served final bytes hash with `assetContentSha256` immediately before response.

Failure must not fall back to active/latest catalog or to a different asset. It may return a fixed safe error to the player layer so the visual slot can show unknown/hide while SillyTavern Generate/input/save continue normally.

## 5. Closed Upload Metadata

Upload metadata must be an exact-key closed object:

```ts
interface VisualAssetUploadMetadataV1 {
  schemaVersion: "galgame.visual-asset-upload-metadata.v1";
  assetType: "scene" | "character" | "equipment" | "item" | "skill";
  role: "background" | "transparent-sprite" | "icon";
  title: string;            // 1..80 safe display chars
  tagCodes: string[];       // 0..24, stable dictionary codes from the service-selected dictionary only
  featureCodes: string[];   // 0..24, stable dictionary codes from the service-selected dictionary only
  licenseCode:
    | "user-owned"
    | "public-domain"
    | "cc0"
    | "licensed-private"
    | "unknown-restricted";
  sourceLabel?: string;     // <=120 safe admin label only
  sourceDigest?: string;    // sha256:<64 hex>
}
```

Unknown keys, aliases, duplicate arrays, oversized strings, non-string codes, unknown dictionary codes, case-variant codes, HTML/script content, URL fields, prompt/context fields, raw provider output, uploaded source text samples or gameplay facts must reject the request before any file is committed.

`sourceLabel` and `licenseCode` are admin metadata only. They must never become runtime asset URLs and must be HTML-escaped everywhere they are displayed.

## 5.1 Asset Type And Role Matrix

`assetType` and `role` are not independent knobs. Upload and catalog validation must enforce this closed matrix:

| assetType | required role | Raster constraints |
| --- | --- | --- |
| `scene` | `background` | Opaque or alpha accepted; landscape crop-safe; no transparent-sprite semantics; no animation in VS1-AS |
| `character` | `transparent-sprite` | Must have an alpha channel with non-empty transparent background unless the asset is a service-owned immutable unknown/silhouette; portrait/sprite crop-safe; no animation in VS1-AS |
| `equipment` | `icon` | Square or near-square icon crop-safe; alpha allowed; no animation in VS1-AS |
| `item` | `icon` | Square or near-square icon crop-safe; alpha allowed; no animation in VS1-AS |
| `skill` | `icon` | Square or near-square icon crop-safe; alpha allowed; no animation in VS1-AS |

Role mismatch must reject at upload or catalog validation before publish. Examples: `scene + icon`, `character + background`, `equipment + transparent-sprite`, `skill + background`.

Transparency rules:

- `character + transparent-sprite` must prove alpha support and transparent background after safe re-encode. A fully opaque character upload rejects unless it is explicitly converted by an approved admin preprocessing tool in a later gate; VS1-AS itself must not guess/remove background.
- Service-owned immutable unknown/silhouette character assets may be opaque or alpha, but their exception must be hardcoded and hash-verified.
- Icons and scenes do not require transparency, but any alpha must survive the safe re-encode if the output MIME supports it.

Size and crop rules:

- Scene backgrounds must meet configured minimum display dimensions and safe aspect-ratio/crop constraints; out-of-range panoramas, tiny images and images that cannot be safely letterboxed/cropped reject.
- Character sprites must meet configured minimum subject-area and transparent-padding bounds without requiring semantic vision analysis; if bounds cannot be verified by deterministic alpha/box checks, reject or require manual admin validation in a later UI gate.
- Icons must meet square or near-square ratio bounds and minimum pixel size; extremely wide/tall icons reject.
- Animated frames are rejected in VS1-AS for all types.

The implementation must test every assetType/role mismatch, missing alpha for character sprite, unknown/silhouette exception, animation rejection, and width/height/aspect-ratio/crop-safety failure.

## 5.2 Dictionary Contract

`tagCodes` and `featureCodes` are not open strings. They must be validated against a versioned closed dictionary selected by the service:

```ts
interface VisualDictionaryRefV1 {
  dictionaryVersion: string; // e.g. "galgame.visual-dictionary.v1"
  dictionaryHash: string;    // sha256:<64 hex> over canonical dictionary JSON
}
```

The implementation must define a complete allowed code enum or a canonical dictionary file with a stable `dictionaryVersion/dictionaryHash`. Asset records and catalog revisions must store the exact dictionary ref used for validation. Unknown codes, duplicate codes, aliases, case variants, empty codes, overlong codes and codes from another dictionary revision must fail closed.

The deterministic matcher in VS1-M may only score assets using the catalog's recorded dictionary version/hash. Upgrading the dictionary requires a new catalog revision; old saves continue to resolve through the old dictionary/catalog pair or fall back to immutable unknown.

## 6. Image Safety

Every upload must be treated as hostile input.

The implementation must:

- Sniff MIME from magic bytes and decoded image content, not from filename or `Content-Type` alone.
- Accept only the explicitly configured raster types for the asset role. SVG, HTML, PDF, archives, scripts, polyglots and damaged images must reject.
- Decode and re-encode to a server-controlled safe raster format before publishing.
- Strip EXIF, ICC/private metadata and embedded thumbnails unless a reviewer explicitly approves a safe retention list.
- Enforce byte size, width, height, total pixels, animation frame count and compression ratio limits.
- Reject zip bombs, image bombs, decompression bombs and unusually large decoded buffers.
- Write first into an isolated temporary directory, then atomically move to a content-addressed final path.
- Keep permissions restricted to the service account.
- Never shell out with untrusted filenames, metadata or path fragments.

Approved implementation limits:

- Max upload bytes: 15 MB.
- Max decoded pixels: 24,000,000.
- Max width/height: 4096 each for icons/sprites, 8192 only for scene backgrounds if explicitly approved.
- Max compression ratio: 80:1.
- Max animated frames: 1 for VS1-AS.

If the decoder is unavailable or cannot prove safe re-encoding, the service must fail closed rather than storing the original file.

VS1-AS implementation note: the approved implementation ships a service-owned, versioned PNG-only sanitizer as the default safe decoder. That decoder accepts only a conservative reviewed PNG subset, parses the actual image structure, verifies chunk integrity, enforces IHDR dimensions, pixel count, scanline size and expected inflate output limits before zlib or pixel-buffer allocation, inflates IDAT data with an output budget, validates scanline lengths and filters, reconstructs pixels, verifies actual transparent pixels for character sprites, strips metadata, rejects animation and unknown/private chunks, derives final hashes from canonical re-encoded served bytes, and rejects non-PNG or unsupported PNG formats until a later reviewed decoder adds them. Production upload accepts only the built-in decoder identity/version unless a separately reviewed production decoder is introduced. Test-only fake decoders may exercise route/lifecycle branches only behind an explicit test switch and cannot be the only evidence for metadata stripping, compression-bomb and unsafe-image behavior.

`assetContentSha256` is defined only after safe decode and re-encode. It is the SHA-256 hash of the exact final bytes that the service will serve from the published asset route. It is not the raw upload hash, not the multipart body hash and not the metadata hash.

Hash domains are separate:

- `rawUploadSha256`: optional admin audit value for the original uploaded bytes; admin-only and never used as runtime identity.
- `assetContentSha256`: final re-encoded served bytes hash; required for catalog refs, asset refs and immutable unknown assets.
- `assetMetadataHash`: hash of canonical closed asset metadata after service injection of dictionary refs and safe derived fields.
- `catalogHash`: hash of canonical catalog JSON containing exact asset refs, content hashes, metadata hashes, dictionary refs and revision fields.

Served bytes, `assetContentSha256`, route scope and catalog ref must match exactly on every read. If a file is replaced on disk, has a different final-byte hash, has a MIME mismatch, or was re-encoded with a different canonical output, the service must reject the read or return the type-specific immutable unknown; it must not serve stale or active/latest replacement bytes.

## 7. URI And Storage Rules

Asset URIs must be service-generated, content-addressed, relative paths:

```txt
/v1/assets/{catalogId}/{catalogRevision}/{assetId}/{assetVersion}/content
```

The route contains no caller-selected filename. The canonical filename and extension, if any are used internally, must be derived by the service from `assetContentSha256` and the final output MIME. A request with any additional segment, alternate filename, alternate extension, traversal token, encoded slash, query-selected format, query-selected hash, or MIME override must reject with `VISUAL_ASSET_URI_REJECTED` or 404.

Before serving, the service must compare:

- route `catalogId/catalogRevision/assetId/assetVersion`;
- published catalog record;
- stored `assetContentSha256`;
- stored canonical MIME;
- decoded/served final bytes hash.

All must match exactly.

The service must reject or never emit:

- arbitrary `http:` or `https:` runtime URLs;
- `file:`, `data:`, `blob:`, `javascript:` or protocol-relative URLs;
- path traversal;
- user-provided filename paths;
- SSRF proxy targets;
- local network or cloud metadata URLs.

The same content hash may be deduplicated internally, but asset identity remains immutable. A same `assetId`/`assetVersion` with different decoded content hash or different closed metadata hash is a conflict and must return 409/no-overwrite.

## 7.1 Admin And Player Asset DTO Isolation

Admin and player responses must use different exact-key closed schemas.

```ts
interface AdminAssetResponseV1 {
  schemaVersion: "galgame.visual-admin-asset-response.v1";
  assetId: string;
  assetVersion: number;     // positive integer
  assetType: "scene" | "character" | "equipment" | "item" | "skill";
  role: "background" | "transparent-sprite" | "icon";
  title: string;
  tagCodes: string[];
  featureCodes: string[];
  dictionaryVersion: string;
  dictionaryHash: string;
  licenseCode: "user-owned" | "public-domain" | "cc0" | "licensed-private" | "unknown-restricted";
  sourceLabel?: string;
  sourceDigest?: string;
  rawUploadSha256?: string;
  assetContentSha256: string;
  assetMetadataHash: string;
  canonicalMime: "image/png" | "image/webp" | "image/jpeg";
  width: number;
  height: number;
  status: "draft" | "validated" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
}

interface PlayerPublishedAssetResponseV1 {
  schemaVersion: "galgame.visual-player-published-asset-response.v1";
  catalogId: string;
  catalogRevision: number;  // positive integer
  catalogHash: string;
  assetId: string;
  assetVersion: number;     // positive integer
  assetType: "scene" | "character" | "equipment" | "item" | "skill";
  role: "background" | "transparent-sprite" | "icon";
  title: string;
  tagCodes: string[];
  featureCodes: string[];
  dictionaryVersion: string;
  dictionaryHash: string;
  assetContentSha256: string;
  canonicalMime: "image/png" | "image/webp" | "image/jpeg";
  width: number;
  height: number;
  assetUri: string;
}
```

`PlayerPublishedAssetResponseV1` must never include `sourceLabel`, `sourceDigest`, `rawUploadSha256`, draft/validation status, upload audit fields, local/internal file paths, temp paths, admin notes, license/source details, provider fields, raw prompt/context/resource text, raw chat text or secret-bearing diagnostics. A leak test must fail if any admin-only field appears in the player DTO or public/static build.

`assetVersion` and `catalogRevision` are positive JSON integers everywhere in VS1-AS and must match the main `VisualAssetV1` and `VisualAssetCatalogV1` contracts. Stringified numbers, floats, zero, negative values, `NaN`, `Infinity`, numeric aliases, and mixed string/number comparisons must fail closed. Hash/proof/scope comparisons must canonicalize using numeric JSON values only.

## 8. Catalog Lifecycle And Profile Authority

Catalog lifecycle:

```txt
draft -> validated -> published -> archived
```

Rules:

- Drafts are admin-only.
- Validation checks every asset body hash, decoded metadata hash, URI safety, immutable unknown assets and closed schema.
- Published catalog revisions are immutable.
- Archive only prevents new selection; old saves and old bindings may still read exact published assets.
- Publishing a new revision must not rewrite older revision assets.
- Missing or corrupted asset content after publish must resolve to the immutable unknown asset of the same type, not to active/latest catalog assets.

VS1-AS does not own the `AdaptivePresentationProfileV1` or future `AdminVisualProfile` lifecycle. Profile creation, confirmation, publishing, rollback and manifest binding remain in the existing config-service/release/profile authority that UAP5 established.

VS1-AS may consume only read-only profile identity:

- `visualProfileId`;
- `profileHash`;
- `releaseId/scenarioId/scenarioVersion/arcId` scope when a trusted caller provides it;
- published profile readback status supplied by the existing config/release boundary.

The visual asset service must not:

- create a profile;
- overwrite a profile;
- publish or rollback a profile;
- write profile fields into manifest or ST storage;
- infer HP/equipment/skill/relationship facts for a profile;
- treat latest/current profile as fallback when an exact profile hash is missing or mismatched.

Published profiles and catalogs must be referenced by exact `catalogId/catalogRevision/catalogHash` and `visualProfileId/profileHash` in the existing release/profile boundary. Old saves must restore exact versions or show unknown assets; they must not silently switch to active/latest profile or catalog.

## 8.1 Old-Save Authorization, Rollback And Retention

Old-save visual reads require a trusted authorization source:

- an approved config/save binding reader that reads the existing saved `releaseId/scenarioId/scenarioVersion/arcId/chatId/presentationProfileId/profileHash/catalogId/catalogRevision/catalogHash`; or
- a short-lived signed old-save visual proof from a reviewed service boundary.

Client-provided `oldSave`, `releaseId`, `profileHash`, `catalogRevision`, `assetId` or `chatId` fields are hints only and cannot authorize old catalog reads. If no approved reader or proof exists, the service must reject the old-save scoped request or resolve the visual slot to the type-specific immutable unknown. It must not use active release, latest catalog, latest profile, root defaults or local fixture data.

Rollback semantics:

- Rolling back active release/profile/catalog must not delete the newer or older catalog revision.
- A save created under an old release keeps reading its exact catalog/profile/hash scope after active release changes.
- Cross-release, cross-profile, cross-catalog, missing hash, mismatched hash, archived-without-retention and stale proof must fail closed.
- Catalog archive may only transition from `published` to `archived`; a `draft` or `validated` revision cannot be archived as a shortcut around publication.

Retention and garbage collection:

- Published catalog revisions referenced by any active release, rollback candidate, or known save binding must be retained for the approved save-retention window.
- Archive only prevents new matching/selection; it is not deletion.
- Deletion/GC of published asset bytes requires a separate reviewed cleanup tool that proves no active release, rollback target, or retained save references the catalog revision.
- If retention cannot be proven, the asset remains retained or resolves to immutable unknown; it must not be replaced by active/latest assets.

## 9. Immutable Unknown Assets

The service must own immutable unknown assets for exactly five bindable types:

- `scene`
- `character`
- `equipment`
- `item`
- `skill`

Each unknown asset has a fixed `assetId`, `assetVersion`, `assetContentSha256`, type and safe content body in the service catalog. These records cannot be overwritten by admin uploads.

If an asset is missing, corrupted, archived, hash-mismatched, below score threshold, has no candidates or the service is unavailable, the consuming visual layer must use the type-specific unknown asset or hide the visual slot. It must not guess another type and must not block SillyTavern Generate, player input or save/restore.

## 10. Relationship To Projection Issuer

VS1-AS does not issue projections, read ST chat or match assets.

Future VS1-M matching may consume a `VisualVisibleProjectionV1` only through a valid Projection Issuer stub/proof produced by VS1-PI. The asset service must not accept client-provided visible text, entity labels, release fields or hashes as proof of truth.

Any proof validation in VS1-AS must be limited to route admission checks explicitly reviewed for this phase. Full matching/binding remains VS1-M.

## 11. No VS-LLM In VS1-AS

Runtime visual LLM matching is not part of VS1-AS.

VS1-AS must not:

- call a provider;
- accept provider responses;
- embed a provider key;
- send visible chat, prompts, resource bodies or uploaded images to a model;
- pre-create LLM score/result fields;
- claim `usesLlm=true`.

VS-LLM remains a separate deferred strict-provider gate.

## 12. Privacy And Logs

Logs and evidence may contain:

- request id;
- stable failure code;
- asset type;
- byte size and decoded dimension;
- content hash prefix or full sha256 when needed for integrity;
- catalog/profile/revision ids;
- timing and retry count.

Logs and evidence must not contain:

- uploaded image bytes;
- EXIF/private metadata;
- raw chat text;
- prompt/context/resource body;
- provider request/response;
- API keys, admin tokens, projection secrets or proof signatures;
- full local user paths.

Health checks must not expose draft counts, asset counts, upload filenames, local storage paths, user names, secrets or recent activity.

## 13. Failure Codes

Tests must use stable non-sensitive failure codes:

- `VISUAL_ASSET_AUTH_REQUIRED`
- `VISUAL_ASSET_FORBIDDEN`
- `VISUAL_ASSET_CSRF_REQUIRED`
- `VISUAL_ASSET_ORIGIN_REJECTED`
- `VISUAL_ASSET_READ_PROOF_REQUIRED`
- `VISUAL_ASSET_READ_PROOF_FORBIDDEN_TRANSPORT`
- `VISUAL_ASSET_READ_PROOF_MALFORMED`
- `VISUAL_ASSET_READ_PROOF_NON_CANONICAL`
- `VISUAL_ASSET_READ_PROOF_INVALID_SIGNATURE`
- `VISUAL_ASSET_READ_PROOF_UNKNOWN_KEY`
- `VISUAL_ASSET_READ_PROOF_WRONG_AUDIENCE`
- `VISUAL_ASSET_READ_PROOF_WRONG_PURPOSE`
- `VISUAL_ASSET_READ_PROOF_EXPIRED`
- `VISUAL_ASSET_READ_PROOF_REPLAYED`
- `VISUAL_ASSET_READ_PROOF_SCOPE_MISMATCH`
- `VISUAL_ASSET_READ_PROOF_OLD_SAVE_UNAUTHORIZED`
- `VISUAL_ASSET_PLAYER_ORIGIN_REJECTED`
- `VISUAL_ASSET_PLAYER_PREFLIGHT_REJECTED`
- `VISUAL_ASSET_INVALID_SCHEMA`
- `VISUAL_ASSET_DICTIONARY_MISMATCH`
- `VISUAL_ASSET_UNSUPPORTED_MIME`
- `VISUAL_ASSET_DECODE_FAILED`
- `VISUAL_ASSET_REENCODE_FAILED`
- `VISUAL_ASSET_SIZE_LIMIT`
- `VISUAL_ASSET_PIXEL_LIMIT`
- `VISUAL_ASSET_COMPRESSION_LIMIT`
- `VISUAL_ASSET_POLYGLOT_REJECTED`
- `VISUAL_ASSET_URI_REJECTED`
- `VISUAL_ASSET_FINAL_HASH_MISMATCH`
- `VISUAL_ASSET_HASH_CONFLICT`
- `VISUAL_ASSET_UNKNOWN_IMMUTABLE`
- `VISUAL_CATALOG_INVALID`
- `VISUAL_CATALOG_CONFLICT`
- `VISUAL_CATALOG_NOT_PUBLISHED`
- `VISUAL_PROFILE_INVALID`
- `VISUAL_STORAGE_UNAVAILABLE`

No failure message may include uploaded bytes, raw metadata text beyond safe fixed labels, source URL, token, key, proof, prompt, provider response or raw ST content.

## 14. Evidence Matrix For Implementation Verification

Before VS1-AS implementation receives stage PASS, it must produce evidence for:

| Area | Required tests |
| --- | --- |
| Admin auth | missing token rejects, wrong token rejects, correct token allows, token in URL/log rejects or is redacted, non-loopback without auth rejects, CORS/same-origin/loopback not accepted as auth |
| CSRF/Origin | cookie/session/proxy write without Origin rejects, forged Origin rejects, cross-origin not allowlisted rejects, missing/stale CSRF rejects, preflight allowed headers exact |
| Health whitelist | health returns only ok/service/schema/adminAuth/catalogStore; no counts, filenames, paths, recent activity, keys, upload status or storage locations |
| Player asset read proof envelope | invalid compact grammar, missing segment, extra segment, padded base64url, non-base64url chars, overlong token, overlong payload, malformed UTF-8, duplicate JSON keys, unknown keys, key-order/canonical mismatch, stringified integer, float/exponent number, Unicode/non-ASCII string, payload field modification, signature truncation and signature over altered payload all fail closed |
| Player asset read proof scope | missing proof, proof in query/URL/multipart/log, forged signature, unknown keyId, wrong signer/key version, wrong audience, wrong purpose, cross release/profile/catalog/asset scope, asset hash mismatch, expired proof, replayed nonce, admin auth used as player proof, player proof used as admin auth, forged old-save proof all fail closed |
| Player asset CORS/preflight | `GALGAME_VISUAL_ASSET_PLAYER_ORIGINS` exact match required; wildcard origin rejects; `*` plus credentials rejects; forged Origin rejects; unallowed Origin rejects; browser request with no Origin rejects; OPTIONS allows only GET plus `X-Galgame-Visual-Asset-Proof` and required browser headers; requested POST/PUT/DELETE or extra headers reject; preflight failure hides asset existence |
| Closed metadata | unknown key, alias, duplicate code, oversized string, URL field, prompt/context field, gameplay fact field all reject before file commit |
| Dictionary | unknown tag/feature code, case variant, duplicate, wrong dictionaryVersion/dictionaryHash and dictionary upgrade drift all reject or require a new catalog revision |
| MIME/decode | filename spoof, `Content-Type` spoof, SVG, HTML polyglot, corrupt image, huge dimensions, compression bomb all reject |
| Re-encode/final hash | safe raster output hash is over final re-encoded bytes; EXIF/ICC/private metadata absent; raw bytes and final bytes may differ; served bytes hash, URI scope and catalog ref exact |
| URI safety | fixed `/content` route only; extra filename segment, non-canonical filename, extension override, hash query override, data/blob/javascript/http/file/path traversal rejected |
| Asset type matrix | scene/background, character/transparent-sprite alpha, unknown/silhouette exception, equipment/item/skill icon, role mismatch, animation, width/height/aspect/crop failures all covered |
| File replacement | replacing stored bytes after catalog publish causes hash mismatch rejection/unknown; no stale or active/latest replacement served |
| DTO isolation | admin DTO may include safe source/admin audit fields; player DTO exact allowlist excludes sourceLabel/sourceDigest/rawUploadSha256/status/internal paths/upload audit/license/source/provider fields |
| Hash/idempotency | same content+metadata retry skips; same id/version with different body or metadata returns 409/no-write |
| Catalog lifecycle | draft admin-only, validate requires unknown assets and hash files, publish immutable, archive does not delete old assets |
| Profile authority | visual asset service cannot create/publish/rollback/write profile or manifest; it only consumes config-service published profileId/profileHash as read-only scope |
| Old save restore | approved save reader/proof required; forged client oldSave rejected; exact old catalog/profile readable; missing/corrupt/hash mismatch returns type-specific unknown, never active/latest fallback |
| Retention/GC | archived catalog remains readable for retained saves; deletion blocked while active/rollback/save refs exist; GC requires separate reviewed proof |
| Player isolation | player cannot list drafts, upload, publish, archive, write binding or read admin metadata |
| Leak scan | frontend/static/log/evidence contain no key/token/proof/image bytes/prompt/context/resource body/raw chat/provider response |
| Boundary | no ST backend/original public/config/root deps/startup changes; no player/admin UI change unless separately approved |

## 15. Reviewer Handoff Checklist

VS1-AS implementation can be submitted for independent review when:

- This document is linked from backlog and implementation materials.
- State/progress/test-log/blockers record VS1-AS v1.4 admission PASS, implementation start, v1-v5 reviewer FAIL history and v6 source root-fix review.
- Docs diff-check, protected tracked/untracked boundary, startup EOL and state validation pass.
- Evidence inventory proves all VS1-AS v6 implementation evidence files are non-empty, no-BOM and stable.
- `external-modules/visual-asset-service/**` is the only business implementation surface touched for VS1-AS; frontend player/admin/shared/public, ST backend/original public/root/startup and VS1-M/VS-LLM paths remain untouched.

PASS of this implementation verification may mark VS1-AS complete and allow only the next planning/admission step for VS1-M. It does not authorize runtime matcher implementation, binding writer, player/admin visual UI, image generation, VS-LLM or any SillyTavern backend/original public change.
