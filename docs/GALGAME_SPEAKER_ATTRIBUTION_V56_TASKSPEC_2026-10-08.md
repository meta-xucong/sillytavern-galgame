# Speaker attribution v56 — anonymous first-speech display title

## Frozen decision and risk

- **D0:** The user has confirmed that a first-time speaking character without an external name cue must display as `？？？`. The exact historical example and exclusions below fix the behavior; no unresolved product choice remains.
- **I2:** The production page is currently coarse-classified as narration even though a same-message anonymous creature has a preceding language-bearing utterance and a local reported-speech cue. The fix must change only display-title evidence while respecting the existing source spans and narrator/source-text negatives.
- **A1:** A separate read-only audit is required because the change touches shared speaker evidence and must preserve production pagination, source text, identity, and media boundaries.

## Goal

On the exact first-appearance speech page identified below, project the visible title as `？？？` when the only name occurs inside that character's own closed utterance and the same source message provides an immediately local, anonymous-entity speech cue. Never extract that self-mentioned name as the speaker.

This is an anonymous display title only: `kind: classification`, `classification: unattributed-dialogue`, `text: `？？？``, `speakers: []`, with no character identity, roster entry, or avatar/media binding. Do not change the semantic annotation or source message.

## Hash-bound historical target

Canonical chat: `data/default-user/chats/galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl`

| Source message | Existing production page | Source message SHA-256 | Exact visible excerpt | Expected title |
|---:|---|---|---|---|
| 0 | page 4, `[586,878)` | `sha256:655c7df055d87f6dfe5cb1fcc338254a4eac09f7f3c59b874fdfa573e351e9ea` | `"Prepare ta be amb'shed by Gribble da Goblin, da terror of... well, dis bit o da roadside, really." The creature pulled out a blade so rusty it had tetanus written all over it. It wore a helmet that was suspiciously similar to an upturned chamber pot, complete with suspiciously brown stains.` | `？？？` |

The name `Gribble` occurs only inside this utterance. The bounded local evidence is the same-message anonymous goblin introduction and language-bearing first utterance, followed by `it screeched out like a cat in a cheese press` before this next closed quote. The cue establishes that an anonymous entity is speaking; it does not establish the in-quote name as an external identity.

## Required negative cases

- A written notice/announcement or other source-carried quote remains `旁白` with no speakers.
- An anonymous sound/descriptor without a language-bearing quote does not become `？？？` and creates no speaker.
- Existing explicit named-speaker evidence remains stronger. Existing unresolved quotes that do not meet the bounded anonymous-speech evidence retain their current behavior.
- The quoted self-reference `Gribble` must not become a `speaker`, title, identity, roster member, or avatar binding.

## Frozen boundaries and allowed files

Allowed source edits: generic display-title evidence helper(s) only in `frontend/shared/src/sillytavern-adapter.js`; parser/cache version literals in `frontend/player/src/main.js` and `frontend/player/tools/speaker-structure-replay.mjs`; hash-bound source replay and bounded negative tests in `frontend/player/tests/speaker-structure-replay.test.mjs`; this TaskSpec, the three Galgame baseline documents, and `docs/GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md`; only static outputs required by the player dependency graph (`public/game/app.js`, its app query in `public/game/index.html`, and the player/admin shared-adapter copies).

Forbidden: `createVisualNovelDisplaySegments`, `applyQuotedDialogueSpeakerContinuity`, `createPresentationPagesForMessage`, page count/order/span construction, source body formatting, semantic annotation, renderer logic, media identity/assets, chat data, provider/API calls, SillyTavern-owned code/configuration, services, and unrelated dirty files. Preserve all pre-existing dirty work.

## Required sequence and acceptance

1. Record the intake baseline and freeze this TaskSpec before source changes.
2. Add the exact production-page fixture and demonstrate it fails against v55 before changing parser behavior. Assert hash, excerpt, production page index/span, title/rule, and empty `speakers`.
3. Implement one bounded structural display-evidence path. It may use only the local anonymous entity / language-bearing speech cue; it must not read a name from the utterance, persist speaker state, or weaken the general known-speaker parser.
4. Run the exact target, negative cases, four focused suites, and one full read-only historical replay. Report bucket movement as coverage movement, not accuracy.
5. Verify chat/source digest unchanged, no writeback/provider calls, exact frozen segmenter source slice/hash, scoped player/admin dependency build outputs, architecture audit, DOM smoke, cache coherence, and `git diff --check`.
6. Stop all writes and hand the fixed diff and evidence to an independent A1 auditor. Do not claim acceptance before that review.

## Intake

- Baseline parser: `full-message-speaker-index.v55`.
- Baseline full replay: 158 chats, 950 assistant messages, 18,562 pages, 6,240 dialogue candidates; 4,524 attributed, 118 anonymous, 1,598 narrator fallbacks, 0 probable, 0 unresolved. Source digest: `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`.
- Frozen segmenter raw source slice: offsets `[49566,52931)`, 3,447 UTF-8 bytes, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`.
- Existing workspace contains extensive unrelated and earlier-task dirty files. They are baseline, not part of v56, and must be preserved.
- Requested route provenance is `ROUTE_UNVERIFIED`; no route claim is part of functional acceptance.

## Implementation and verification record

- v56 production-page test failed before the implementation: the exact page was titled `旁白 / narrative-framed-quote`; the v56 rule now projects `？？？ / anonymous-first-appearance`, with empty `speakers` and source-bounded evidence.
- Exact gold and negatives: focused v56 test 2/2; full speaker replay suite 51/51. Other focused suites: runtime regressions 57/57, presentation renderer 1/1, shared adapter 1/1.
- Final full-history read-only replay: 158 chats, 950 assistant messages, 18,562 existing production pages, 6,240 dialogue candidates; 4,524 attributed, 140 anonymous introductions, 1,576 narrator fallbacks, 0 probable, 0 unresolved. Candidate fallback reasons sum to 1,576: `no-unique-speaker-evidence` 1,562, `narrative-shape-with-unattributed-quote` 2, `ambiguous-local-reference` 2, `dialogue-shape-without-speaker` 10, others 0. Source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`; structural evidence 17,806/17,806 valid and 0 unaddressable. Accuracy remains `INSUFFICIENT_EVIDENCE`.
- Production-page v55/v56 comparison isolated exactly 22 candidate migrations from narrator fallback to anonymous display. All 22 page bodies have the same NFKC/whitespace-normalized 292-codepoint page fingerprint `sha256:2bf3825458690d7f2b41e362578041388763cff20f2247a9399a124bf85e8584`; they are duplicate archive copies of one Gribble source passage, not 22 independent examples. Source-message hash distribution: 19×`sha256:655c7df055d87f6dfe5cb1fcc338254a4eac09f7f3c59b874fdfa573e351e9ea`, 2×`sha256:240d75ce5f59bf697795c7e5490746982bc91f0fd9c8dafc54895c0798d9fdf7`, and 1×`sha256:46c0c811e60c6be7c2624e4d9da9330003348384e0bf032026c7a81076fe936a`. Their spans are `[586,878)`, `[587,879)`, and `[591,883)`; the normalized fingerprint confirms the same page text despite wrapper/offset variants. The canonical source-bound fixture remains the single gold target.
- Player/admin staged builds exited 0 at version `auto-2d9e1fab2d65`. Synchronized output SHA-256: `public/game/app.js` `756a38ee87665c53793f6220591b9dfdf98f32cf4827002dc244ff6bd47edaa7`; player and admin `shared/sillytavern-adapter.js` both `d7b844e21d16b57f2afe14372e6b5e9c215e2194d2711d04bef6d502423fac92`. Player index app query matches this version; stylesheet query remains unchanged. Cache/version checks passed.
- Architecture audit exited 0 (707 files, 1,515 findings, 0 prohibited active, 0 needs review, 0 failed checks). DOM smoke exited 0 (`ok=true`). `git diff --check` exited 0 (Git emitted only line-ending advisories for existing dirty files).
- Frozen segmenter slice rechecked at UTF-16 offsets `[49566,52931)`, 3,447 UTF-8 bytes, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`, exactly matching v55. Source body, SillyTavern source, and chat files were not changed. Independent A5 audit is pending; this is frozen for review, not accepted until that audit.
