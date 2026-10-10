# Speaker Attribution v55 — Bounded TaskSpec

## Decision and risk

- **D0:** The human-labeled source cases and limits are fixed below. The implementation may add only generic same-message structural evidence; it may not expand the gold set by inference.
- **I2:** A quote may be split across existing display pages, and same-message actor context must not be confused with headings, source text, nonverbal sound effects, or another speaker. Verify production-page projection, exact source spans, negative cases, and full-history replay.
- **A1:** Independent read-only review is required before acceptance.

## Objective

Recover three high-confidence real historical speaker titles through existing production page spans:

1. A named subject's immediate action chain ending in a colon-introduced, language-bearing quote may identify that quote; if the quote remains open across production pages, the same speaker applies to each page intersecting the same source quote.
2. A unique explicit named character subject in the same source message may anchor a subsequent pronoun-linked speech turn within that same scene, including after an anonymous self-introduction. The introductory quote stays `？？？` under the established anonymous-first-appearance rule. This local title inference must stop at a scene/title boundary, a competing/new character, or a source/document-text frame.

These are display-title attributions only. They do not create persistent identity, roster entries, avatar bindings, or semantic annotation. No cross-message or cross-chat ownership carry-forward is allowed.

## Exact source-bound production gold

All indexes and spans are Unicode code-point offsets from the unchanged `createVisualNovelDisplaySegments` output. Tests must assert the source message hash, exact visible excerpt, production page index/span, and final replay `titleText`/`ruleId`.

| Chat path | Source message | Page / span | Source-message SHA-256 | Exact visible page excerpt | Expected title |
|---|---:|---|---|---|---|
| `galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl` | 36 | 8 / `[378,449)` | `sha256:ec78fed1c3c5d8b7b8fc5072d1f4a56db57f920327d4dbad4b2bbcb5354f8a87` | `物品鉴别检定：\`d20 + 0 = 11\`，你只能判断它不是普通货，但具体魔力不明。Pippa探头看了一眼，吹了声口哨：“哦，那玩意儿会咬人。` | Pippa |
| same | 36 | 9 / `[451,473)` | same | `可能咬别人，也可能咬你。经典好刀，坏主意。”` | Pippa |
| `default_Seraphina/Seraphina - 2023-5-12 @21h 32m 29s 224ms.jsonl` | 2 | 3 / `[108,144)` | `sha256:757212f1d995fb01c49ab08faa14b806456784b44551455e23038c6be463c93c` | `“那么，茶里王——在你踏入这片森林之前，你心里最放不下的，究竟是什么？”` | Seraphina |
| same | 4 | 3 / `[117,150)` | `sha256:7e2e539fc281a51d0d05405a10a83d2e921a3418f0ad6d4cb4e0caff21f74056` | `“茶里王，在来到这片森林之前，你心里一直轻轻挂念着的，是什么呢？”` | Seraphina |

Preserve the preceding same-message self-introduction pages as `？？？`: message 2 page 1 `[43,85)` and message 4 page 1 `[38,85)`. They must not be upgraded merely because a later same-message title is resolved.

## Required opposing cases

- A standalone nonverbal sound effect or whistle without a language-bearing utterance does not make its actor a speaker. Keep existing generic sound-effect handling.
- The written ledger/report following the Pippa quote remains narration and does not inherit Pippa.
- A quote carried by a book, report, map, or other object remains narration even when a named character handles or opens that object.
- The same-message pronoun bridge must not cross an opening scene/title, a new explicit character, or a source/document carrier; the new character's quote must remain attributed only when it has its own direct evidence.
- No cross-message speaker inheritance, no inference from roster membership alone, and no change to anonymous self-introduction behavior.

## Frozen boundaries

Allowed: generic structural helpers in `frontend/shared/src/sillytavern-adapter.js`; v55 parser-version literals in `frontend/player/src/main.js` and `frontend/player/tools/speaker-structure-replay.mjs`; exact source-bound replay tests in `frontend/player/tests/speaker-structure-replay.test.mjs` and required shared-adapter tests; this TaskSpec, the three Galgame baseline documents, and the historical replay plan; only generated static outputs required by the player runtime dependency graph (record the exact synchronized paths and hashes).

Forbidden: `createVisualNovelDisplaySegments`, `applyQuotedDialogueSpeakerContinuity`, page construction/order/count/span logic, source body formatting, semantic annotations, renderer behavior except generated output required by the current source graph, visual identity/assets, SillyTavern-owned code/configuration, chat files, provider calls, external services, unrelated dirty files, and broad scenario/name inventories.

## Required sequence and acceptance

1. Pin the exact historical production pages and run the replay test red against v54 before changing production behavior.
2. Make only generic structural changes demonstrated by the golds, with the required negatives above. Keep the original anonymous introductory titles and all page spans unchanged.
3. Run the exact v55 historical gold, relevant focused suites, full-history read-only replay, static architecture audit, DOM smoke, scoped build/cache coherence, frozen segmenter raw-source hash, and `git diff --check`.
4. Report coverage movement separately from accuracy. Prove the chat/source digest did not change, `chatWriteback=false`, `externalProviderCalls=0`, and the frozen page-segmenter source hash is identical to the v54 intake.
5. Freeze writes and hand exact paths, commands, exit codes, hashes, gold/replay counts, and limitations to an independent A4 auditor. Do not claim acceptance until A4 closes.

## Implementation status

TaskSpec frozen before implementation. Source-bound red tests confirmed all four target production pages initially fell back to narrator while both anonymous introductions remained `？？？`. The v55 focused production replay now passes 4/4 target pages and preserves 2/2 anonymous introductions; bounded negative cases pass. Requested execution route `Execute I2 / gpt-6-luna / xhigh` is not independently verified; do not claim route verified. Full-history replay and the requested static checks are complete; the frozen change set is awaiting independent A4 review.

## v55 implementation and verification record

- Exact production-page gold: Pippa message 36 pages 8/9 and Seraphina messages 2/4 page 3 all match (`4/4`); anonymous first-introduction pages remain `？？？` (`2/2`). The bounded negative suite passes for nonverbal whistle, new scene, explicit competing speaker, and written carrier. Source-message hashes, page spans, exact excerpts, evidence spans, production title and rule ID are asserted by `frontend/player/tests/speaker-structure-replay.test.mjs`.
- Four required suites exited 0: runtime regressions `57/57`, presentation renderer `1/1`, shared adapter `1/1`, structural replay `49/49`. The focused v55-only replay also exited 0 (`2/2`).
- Read-only full-history replay exited 0: 158 chats, 950 assistant messages, 18,562 existing pages, 6,240 candidate pages; 4,524 attributed, 118 anonymous, 1,598 display narrator fallback, 0 probable, 0 unresolved. Fixed candidate fallback reasons total exactly 1,598: no unique speaker evidence 1,584; narrative-shape quote 2; ambiguous local reference 2; dialogue shape without speaker 10; all other fixed buckets 0. All-page narrator diagnostics total 1,736 (138 non-candidate rows in addition to candidate fallbacks). 17,806/17,806 evidence pages validate; 0 unaddressable. `speakerAccuracy=INSUFFICIENT_EVIDENCE`.
- v54-to-v55 category deltas: candidate pages −2, attributed +5, anonymous 0, display fallback −7. No transition artifact assigns each changed row to a rule, so this is coverage distribution only, not an accuracy gain.
- Source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`.
- Both staged builds exited 0. Synchronized generated outputs only: `public/game/app.js` (SHA-256 `928b11db6405cd9603f18c24841e9634a13c7159a87f3fb81a6b058c6c67935f`), `public/game/index.html` app query only (SHA-256 `03d1335121404bce4b8c5ae8c6dac930218207617a4ab63759a3abb82fccf560`), `public/game/shared/sillytavern-adapter.js` and `public/game-admin/shared/sillytavern-adapter.js` (each SHA-256 `6cf0385d8b525e9235b28d353888cbc6cc04b5ccd15b4431eb63209989431e22`). Build/cache version is `auto-c90f3fcf76b9`; player imports and app query agree; stylesheet cache remains `auto-8fd622b9f5f5`.
- `node frontend/tools/static-architecture-audit.mjs` exited 0: 707 files, 1,515 findings, 0 prohibited active, 0 needs-review, 0 failed checks. `node frontend/tools/static-dom-smoke.mjs` exited 0 (`ok=true`). Cache/runtime coherence is covered by runtime `57/57` and exact staged/static byte hashes.
- Frozen segmenter raw UTF-8 slice from `createVisualNovelDisplaySegments` up to `applyQuotedDialogueSpeakerContinuity` remains offsets `[49566,52931)`, 3,447 bytes, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`, equal to v54 intake. `git diff --check` exited 0; Git emitted only existing LF/CRLF notices.
- A4 independent audit is pending. Do not treat this implementation record as final acceptance until A4 closes.