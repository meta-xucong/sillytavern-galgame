# Speaker attribution v57 — bounded local action and quote continuation

## D/I/A decision

- **D0:** The user has confirmed three historical display-title labels: Pippa, 独眼乔, and 尼布. The labels are title-only evidence; no identity or avatar binding is authorized by these examples.
- **I2:** Existing parsing finds the original page spans correctly but returns narrator fallback for these three dialogue pages. One page is directly introduced by a named actor plus a speech predicate; one is a continuation of one source quote across existing pages; one has a unique nearby named action subject in the same source message. The implementation must close only these evidence gaps and retain source-carrier, competing-speaker, and ambiguity negatives.
- **A1:** Independent A6 audit is required because shared title evidence and its replay fixtures change. No production pagination/body code may change.

## Goal and behavior

Update only display-title evidence for these hash-pinned pages:

| Chat | Assistant message | Page / source span | Message SHA-256 | Expected display title | Evidence shape |
|---|---:|---|---|---|---|
| `galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl` | 34 | page 11 `[603,665)` | `sha256:6b42ce8475296f5002f6c8362720a0dfadbdc25338175866478ff4593477d34e` | `Pippa` | Named action subject plus attached speech predicate `咧嘴道` before the quote. |
| same | 248 | page 15 `[837,874)` | `sha256:25529abce52c0f2459ffbfcf741fd658bec39a8e7d4eba4c887b5364691d3b6f` | `独眼乔` | Page intersects the single source quote `[805,875)` begun after 独眼乔's local inspection/action frame on page 14; the quote remains one attribution through the existing page break and closes at its source end. |
| same | 20 | page 4 `[175,202)` | `sha256:448d4049d5494fe5da229ecb8fb356b919c3779bde0ce85bb4c94823c1712b61` | `尼布` | A unique, nearby named action subject in the same source message immediately precedes the conversational quote; no competing speaker or scene boundary intervenes. |

Source-bound reset negative in the same Dungeon Master chat: msg 248/page 16 `[875,885)`, message hash `sha256:25529abce52c0f2459ffbfcf741fd658bec39a8e7d4eba4c887b5364691d3b6f`, exact excerpt `尼布立刻举手:"卖!` must be attributed to `尼布` and must not inherit `独眼乔` from the prior quote.

Use the exact source excerpts pinned in the production-page regression. The page segmenter remains the sole authority for page index, source span, order, and count. Quote continuation may project only from a locally established speaker onto the same source quote span in this same assistant message; a new quote/speaker or scene boundary terminates it.

## Required negative cases

- Text carried by a letter, report, ledger, task note, sign, or announcement stays narrator; opening/handling a document does not make its written contents the actor's speech.
- A map/item transfer or other action without a speech predicate does not by itself attribute a following quote to the actor.
- A new speaker quote (including `尼布立刻举手：“卖！”`) ends any earlier speaker continuation; a previous 独眼乔 quote cannot leak onto the new page.
- `他小声说` without one unique, source-local named anchor remains unresolved/fallback. No guess from roster, chat-wide occurrence alone, prior unrelated dialogue, or generic pronoun.
- A sound-effect quote does not establish a speaker. It may bridge only when an explicit action predicate immediately follows the SFX, or when the exact intervening text is a narrow voice frame (`的金属声：`, `声音：`, `嗓音：`) and one local named actor is unique. A comma/clause boundary or a new noun/entity event blocks the bridge, including when the new event has no punctuation.
- Existing explicit speaker evidence and scene/title boundaries remain stronger. Unclosed quotes remain unresolved unless the exact same source quote has one validated speaker anchor; never rewrite source text or close quote marks.

## Evidence and boundary model

- v57 introduces no cross-chat or persistent observed-speaker state. Any nearby named subject evidence is bounded to the current source message and one uninterrupted local scene; a new scene/title, competing named subject, explicit new speaker, written-text carrier, or intervening independent speech unit blocks inheritance.
- Direct named action + speech predicate is stronger than nearby-action association. A nearby named action without a speech predicate is eligible only for a single immediately following conversational quote when that subject is unique and the page-local/source-message frame is not a written carrier.
- Quote continuation is source-span continuity, not “the last speaker keeps talking” across arbitrary pages: every projected continuation must intersect the same validated source quote span and retain the original unique speaker evidence. A new quote has no inherited title absent its own local evidence.
- These rules alter only display-title evidence. They do not change semantic annotation, source body/formatting, speaker identity, roster, visual identity, avatar selection, source history, provider, or original SillyTavern behavior.

## Allowed files and forbidden paths

Allowed: this TaskSpec; three baseline docs (`GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`, `GALGAME_DESIGN_SPEC.md`, `GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`); `GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md`; generic structural title-evidence helper(s) in `frontend/shared/src/sillytavern-adapter.js`; parser/cache version literals in `frontend/player/src/main.js` and `frontend/player/tools/speaker-structure-replay.mjs`; exact source-bound regression tests in `frontend/player/tests/speaker-structure-replay.test.mjs`; generated static outputs for player/admin applications that import the changed shared adapter.

Forbidden: `createVisualNovelDisplaySegments`, `applyQuotedDialogueSpeakerContinuity`, `createPresentationPagesForMessage`, pagination/page construction, source span/body formatting, semantic annotation, renderers, visual assets, chat data, LLM/provider calls, external services, SillyTavern-owned code/configuration, unrelated dirty files, commits, and pushes. Preserve all pre-existing dirty work.

## Required implementation and acceptance sequence

1. Freeze this TaskSpec and record current source/message/page evidence before changing parser code.
2. Add exact production-page red tests for all three gold rows plus bounded negatives; verify they fail against v56 and assert source hash, exact production page index/span/text, title/rule, and any source evidence span.
3. Implement at most two generic paths: (a) named local action/speech attribution; (b) bounded unique-local-speaker association to the same conversational quote, including same-source quote continuation over existing pages. Do not add character-name or scenario-specific rules.
4. Bump parser/cache version to v57; update all three baseline documents and the historical replay report with exact evidence, limits, and final measured coverage.
5. Run focused source-bound gold/negative tests, all required replay/runtime/shared/renderer suites, one full history read-only replay, generated output/cache coherence, static architecture audit, DOM smoke, frozen segmenter hash and `git diff --check`.
6. Confirm source/chat digests are unchanged, no writeback/provider calls occurred, and existing production page spans/count/order match baseline. Freeze and hand off to independent A6 audit. Do not claim acceptance before A6 review.

## Intake baseline

- Parser: `full-message-speaker-index.v56`.
- The three production title projections currently return `旁白 / narrative-framed-quote`; their source message hashes and spans are pinned above. For msg248, v56 finds one unresolved quote `[806,874)` whose full quote bounds are `[805,875)`; page 14 begins the quote and page 15 contains its final body text. Page 16 begins the independent `尼布立刻举手：“卖！”` utterance.
- Source chat file digest: `sha256:642ceb98b8b77b91afa3914751e60d83b085d292be8a0dddcbe6e4d4e28f7e9c`; history source-set digest baseline `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`.
- Frozen segmenter source slice: UTF-16 offsets `[49566,52931)`, 3,447 UTF-8 bytes, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`.
- v56 full-history read-only replay: 158 chats, 950 assistant messages, 18,562 pages, 6,240 dialogue candidates; 4,524 attributed, 140 anonymous introductions, 1,576 narrator display fallbacks, 0 probable, 0 unresolved. `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`; accuracy remains `INSUFFICIENT_EVIDENCE`.
- Existing worktree contains unrelated earlier dirty changes. They are not part of v57 and must not be reset, staged, or synchronized unless required by the v57 dependency graph.

## Implementation / verification record

Implemented and bounded. The title index now recognizes the exact local action-subject cases and ties continuation to the same source quote span. The post-quote speaker bridge refuses a later speaker from claiming a prior long quote. An SFX bridge is allowed only for an immediately following explicit action predicate or a narrow anchored voice frame; comma/clause boundaries and new noun/entity events block it, with or without punctuation. Temporary debug logs were removed.

Version/cache is `full-message-speaker-index.v57` in the adapter, player runtime, and replay tool. The v56 anonymous-first-appearance behavior remains explicitly available under v57. Exact historical golds: 4/4 (Nibu msg20/page4, Pippa msg34/page11, Joe msg248/page15, and the independent Nibu msg248/page16 quote). Negative cases: 7/7 (written ledger, item transfer without speech cue, unanchored pronoun, new-speaker boundary, comma-separated SFX event, unpunctuated noun-led SFX event, and noun-led voice-frame event). A separate direct-action continuation positive passes. Sound-effect quotes remain without speaker anchors unless one of the two bounded continuation forms applies.

Verification: speaker replay 53/53; runtime regressions 57/57; presentation renderer 1/1; shared adapter 1/1; player and admin static outputs rebuilt and synchronized. The staged adapter SHA-256 matches each public copy (`BC9C2084D7DAEF8E0F5BF92FA74328C8E84B0C02FAF2895160C6AC47CA28C2E2`); full output parity is 33 player files and 22 admin files. Architecture audit: 707 files, 1,515 findings, 0 prohibited-active, 0 needs-review, 0 failed. Static DOM smoke `ok=true`. `git diff --check` exited 0 (line-ending advisory only). Frozen segmenter slice `[49566,52931)` is 3,447 UTF-8 bytes with SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`.

Read-only full-history replay: 158 chats, 950 assistant messages, 18,562 existing pages, 6,112 dialogue candidates (4,046 attributed, 148 anonymous, 1,918 narrator fallback, 0 unresolved); fallback reasons: no-unique 1,895, narrative-quote 2, ambiguous-local 4, dialogue-shape 17, other 0. 17,804/17,804 evidence pages valid; 0 unaddressable; digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; source unchanged, chat writeback false, external provider calls 0. Accuracy remains `INSUFFICIENT_EVIDENCE`. This distribution differs from the v56 archived summary; because the archived report lacks complete per-page predictions and invocation/scope parameters, the change is recorded as coverage drift only, not accuracy gain/loss.

Independent A6 final review: PASS. It directly imported and ran source, player, and admin adapters. All three reject comma-separated, unpunctuated noun-led, and noun-led voice-frame tower events after SFX; all three attribute the direct-action Durik continuation to Durik; all three retain the exact Joe production anchor (source hash `sha256:25529abce52c0f2459ffbfcf741fd658bec39a8e7d4eba4c887b5364691d3b6f`, speaker span `[776,779)`, utterance `[806,874)`). The three adapters share the same anchored voice-frame condition and direct-action gate. Independent focused reruns: speaker replay 53/53 and shared adapter 1/1. No source, chat, pagination, or provider mutation.
