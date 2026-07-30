# Galgame Visual Asset Service

> Status: paused historical prototype; not the current delivery route.  
> Current route: `docs/AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`  
> Restart condition: explicit user authorization plus a fresh code-admission review.

This directory is retained for traceability while the visual asset module is
being reorganized as the isolated VS-DOCS route. The code is not deleted,
reset, cleaned, started, imported by the player, or treated as production-ready
by the current phase.

This module is presentation-only. It does not read SillyTavern chats, character
cards, worldbooks, prompts, context, settings, provider keys or original backend
internals. It does not generate text, write SillyTavern resources, publish
profiles, or call a model provider.

## Scope

Historical VS1-AS surface (not active in the current phase):

- admin Bearer-protected upload route;
- closed upload metadata and dictionary code validation;
- hostile image upload quarantine before commit;
- default built-in safe PNG decode/re-encode boundary;
- final served-byte `assetContentSha256`;
- content-addressed byte storage with atomic bytes+MIME records;
- file-backed asset/catalog metadata storage and file-backed old-save retention
  storage for the default CLI process;
- file-backed proof nonce store using atomic create semantics for replay
  rejection across restarted or duplicated service instances;
- immutable type-specific unknown assets;
- catalog draft, validate, publish and publish-only archive lifecycle;
- admin asset metadata/content read;
- player exact content read protected by `galgame.visual-asset-read-proof.v1`;
- strict `gvarp1` compact proof envelope verification;
- `X-Galgame-Visual-Asset-Proof` browser preflight allowlist;
- public health whitelist with no activity counts or filenames.

Historical VS1-M guarded surface (not active in the current phase):

- `POST /v1/visual-match` accepts only the closed
  `galgame.visual-match-request.v1` body and
  `X-Galgame-Visual-Projection-Proof` header;
- the projection proof is verified service-side against
  `GALGAME_VISUAL_PROJECTION_SECRET`;
- production stub read is via the reviewed game-config-service
  `GET /v1/visual/projection-stubs/:projectionId` route with
  `GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN`, or a test-only internal
  reader;
- deterministic matcher and service-internal binding/receipt persistence are
  implemented behind the compatibility gate;
- `VisualProjectionReceiptV1` and `VisualBindingStoreRecordV1` are internal
  only and persist no raw visible text, proof token, nonce, signature, prompt,
  context, provider response, upload bytes, or SillyTavern resource body;
- current shared immutable unknown refs still do not match this service's
  transparent PNG unknown asset hashes, so visual-match returns
  `VISUAL_MATCH_UNKNOWN_COMPATIBILITY_FAILED` instead of silently remapping or
  creating public unknown bindings.

## Decoder Boundary

The service never stores original upload bytes as published assets. A deployment
uses the built-in versioned PNG sanitizer by default. It accepts a conservative
PNG subset only: non-interlaced 8-bit RGB/RGBA. It parses chunks, validates
CRCs, inflates IDAT data, validates scanline lengths and filters, reconstructs
pixels, checks actual transparent pixels for character sprites, strips metadata
chunks, rejects APNG/unknown chunks, and writes a canonical re-encoded PNG byte
stream before `assetContentSha256` is assigned. Non-PNG and unsupported PNG
formats remain fail-closed until a separately reviewed safe decoder adds them.
The sanitizer checks IHDR dimensions, pixel count, scanline size, and expected
inflated output length before calling zlib or allocating the pixel buffer.

If a deployment explicitly disables the decoder, upload requests fail closed
with a stable error instead of committing the file. Production upload accepts
only the built-in decoder identity/version. The local `test.mjs` can use a
controlled fake decoder only when the service is created with an explicit
test-only switch, and has a separate real PNG decoder boundary test for
metadata stripping, broken IDAT rejection, oversized IHDR preflight, APNG
rejection, and transparent-pixel validation.

Approved safety limits are enforced in two places: resource budgets are checked
from IHDR before zlib inflate or pixel-buffer allocation, and the canonical
decoded/re-encoded output is checked again before commit:

- compression ratio maximum: `80:1`;
- scene background maximum dimension: `8192`;
- character sprite and equipment/item/skill icon maximum dimension: `4096`.

## Proof Boundary

This service verifies asset-read proofs and visual projection proofs only. It
does not export or implement a proof signer. Proof signing remains owned by the
reviewed config-service or another explicitly approved issuer boundary.

Nonce replay protection is persisted under the service data directory. Consuming
a nonce uses an atomic create operation, so a second process or restarted
service cannot reuse the same unexpired proof.

## Not Implemented Here

- player or admin visual UI;
- runtime visual LLM matcher;
- Projection Issuer;
- SillyTavern backend/original public changes;
- profile, manifest, or SillyTavern resource writes.

## Current Phase Control

The current phase is documentation-only. Do not add routes, wire this service
into `/game/`, start it from a launcher, rebuild public assets for it, or
continue the matcher/binding/projection work until the user opens a new
VS-CODE gate. The existing tests and evidence remain historical reference
material and must not be used to claim that the isolated visual module is
finished.

## Local Test

```powershell
node external-modules/visual-asset-service/test.mjs
```
