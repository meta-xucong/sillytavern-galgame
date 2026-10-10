# Speaker Attribution Stateful Optimization — Frozen TaskSpec

## v53 bounded real-history correction override (2026-10-08)

v53 supersedes conflicting v52 acceptance statements only for the six exact historical rows below. v52 remains the unchanged starting implementation and whole-history comparison baseline. The v53 fixture is source-backed: each expected title is bound to its original chat-relative path, `sourceMessageIndex`, visible-message SHA-256, production `pageIndex`, and exact production `sourceSpan`; the test reads original chat files read-only and verifies those values before scoring the production-page title. It does not synthesize or rewrite historical dialogue.

Frozen v52 baseline for comparison: 158 chat files, 950 assistant messages, 18,562 production pages, 6,402 dialogue candidates (4,971 attributed, 103 anonymous introductions, 1,328 narrator fallbacks, 0 unresolved display rows); source-set digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`. This remains a category-coverage baseline, not an accuracy claim.

### v53 bounded evidence rules

- **Named action/reaction before speech:** accept a unique person-shaped named subject followed by a physical reaction/action and a colon-led quote, including comma-separated observable action details. Generic physical cues such as breathing hard or freezing in surprise may be recognized; never add a proper-name-specific rule. A source/document/report frame or a non-person subject remains ineligible.
- **Transfer-frame speech subject:** when a report/object transfer is followed by a direct speech cue such as `说`, attribute only to the exact subject span before the grammatical transfer boundary (`把`/`摊开`/`展开`). Never extend a generic Han speaker span through `把` or into the object. If there is no safe whole subject boundary, or if a document-carrier cue such as `报告上写着` introduces the text, retain narrator fallback.
- **Player first-person action:** an unquoted first-person narration/action lead such as `我压低声音：` immediately introducing a quote may display as `你`. The cue must lie outside every quote span and must be a first-person action/reporting lead. First person inside an NPC quotation is never player evidence.
- **Player title evidence contract:** preserve exact source evidence as `speaker.sourceText='我'` with a span that slices the exact `我`; set only the display label `speaker.text`/`displayText='你'` and top-level title `text='你'`. Accept this mapping only for the exact `player-first-person-action` rule, only when the structural parser proved the cue is outside quote spans and directly introduces the utterance. The main adapter validator and renderer re-check this rule ID, exact source surface, exact display alias, source message hash/span and current page span. Do not create/resolve identity or avatar from this label. All other speaker evidence keeps the source title and speaker text equal.
- **Honorific-only visible title:** a directly attributed live speaker may display a canonical stem with a recognized honorific suffix removed only under `honorific-display-title`. Preserve the source-backed surface in `speaker.sourceText` and its original span (for example `speaker.sourceText='马库斯伯爵'`), while `speaker.text`, `displayText`, and the top-level title contain only the exact suffix-stripped stem (`马库斯`). Main and renderer validators accept this mapping only for that rule, with the original source span, current hash/page span, and a directly anchored action-speech cue. Do not apply to title-like document text or ordinary mentions; the alias is display-only and cannot be used to create or resolve identity/avatar.
- **Named target plus pronoun reaction:** resolve a pronoun-led immediate reaction/quote only from one nearest, explicit named actor/target in the same source message and same scene, with no competing actor or intervening speaker cue. A mere name mention or distant roster name is insufficient.
- **Same-message pronoun continuation across a structured heading:** a uniquely anchored speaker may continue only when a local third-person physical action explicitly bridges to the next quote, the existing source has no new speaker/scene conflict, and any intervening non-dialogue heading is only a structural subsection. The current target must still have that local bridge; a closed utterance or prior speaker by itself does not carry across a player turn.
- **Chat-local observed speaker evidence:** the display-only observed-name lexicon counts only explicit anchors within the preceding eight positions supplied by the caller and resets at an opening scene/title boundary. Player/empty entries consume a position in the live snapshot but cannot add name evidence. It never carries an owner or pronoun across messages/scenes; each target message still needs its own local structural cue and exact source span. Arbitrary mentions, headings, player turns, and a prior speaker by themselves cannot assign a quote. A different explicit speaker in the current message is resolved by that message's own cue, not by historical turn ownership.
- **Honorific display form:** for a uniquely attributed live speaker, a recognized title suffix may be removed from visible `titleText` only (for example `马库斯伯爵` → `马库斯`). Keep raw source evidence and span in `speaker.sourceText`; the visible alias cannot create or change entity/identity evidence. Do not rewrite source text, globally replace names, or alter written-document titles.
- Explicit unique speaker/group evidence remains higher priority. Anonymous first appearance stays `？？？`; genuinely unclosed quotation stays `未识别`; closed but unresolved speech uses the already-approved display-only `旁白` fallback and remains diagnostically unresolved.

### v53 exact historical gold

The six exact rows are stored in `frontend/player/tests/speaker-structure-replay.test.mjs`; the fixture asserts source text excerpts and hashes against the real chat files before checking replay output:

| Chat path | Message | Page / code-point span | Source-message hash | Expected visible title |
|---|---:|---|---|---|
| Dungeon Master campaign chat | 592 | 6 / `[303,340)` | `sha256:964ce4e190fe8e2f968b41db3b9264124f4f0b91ca2762edcb8b049cc3643c5c` | 格雷戈 |
| Dungeon Master campaign chat | 328 | 5 / `[187,200)` | `sha256:e417f4e0dc25f900be38b3f1bd2b093c27db417f2181f9bca857fbf84cd348ca` | 暗影祭司 |
| Dungeon Master campaign chat | 70 | 4 / `[220,256)` | `sha256:7e5ae2764e77c212ca30d58eb522e024d665fa507ca00bd3b6a13c271943586d` | 维斯坎特 |
| Evelyn chat | 36 | 16 / `[506,534)` | `sha256:8d942482afb211827554dfafec5dc2247fcd700d8a78a7b7e05feb548804c56b` | 你 |
| Dungeon Master campaign chat | 472 | 5 / `[133,180)` | `sha256:cd9e31e04296d68a7b35cb9b3f4b9c95af1872676c5cbb07b8d9d13f6d8f4d3b` | 加里克爵士 |
| Dungeon Master campaign chat | 476 | 18 / `[970,1023)` | `sha256:c1759caab7ac8350277f1e491e09438341ffbc91e34c745e612fb541fc38a750` | 马库斯 |

The title is the user-visible result from the unchanged replay production segmenter/page projection; test output also retains the exact page index, span, message hash, and non-empty `ruleId`. The test first failed against v52 for all six rows: the first five rendered `旁白`, while msg476 rendered `马库斯伯爵`.

### v53 D / I / A and allowed writes

- **D0:** These six historical visible titles and their source spans are exact, user-confirmed labels; the previously established anonymous/open-quote/narrator fallback precedence remains unchanged.
- **I2:** The bounded helper change affects source-message anchors and display-name projection, so tests must prove exact production page indices/spans remain unchanged and no cross-chat or name-mention leakage occurs.
- **A1:** Independent audit verifies only the permitted structural helpers changed, all six raw-history golds pass, the complete read-only replay remains within the same source digest/page inventory, and original SillyTavern/page-builder/segmenter boundaries remain untouched.
- v53 may change only the structural attribution/index and title-only projection helpers in `frontend/shared/src/sillytavern-adapter.js`; parser/cache version literal, same-chat prior-explicit-speaker cache integration, and the exact special-rule evidence validator in `frontend/player/src/main.js`; the exact `player-first-person-action` / `honorific-display-title` title-evidence allowlist/validation path in `frontend/player/src/presentation-renderer.js`; replay evidence rules in `frontend/player/tools/speaker-structure-replay.mjs`; tests in `frontend/shared/tests/sillytavern-adapter.test.mjs`, `frontend/player/tests/speaker-structure-replay.test.mjs`, `frontend/player/tests/presentation-renderer.test.mjs`, and only related runtime title assertions; this TaskSpec, the three baseline documents, historical replay plan, full-message speaker evidence report; and generated `public/game/app.js`, `public/game/presentation-renderer.js`, player/admin `shared/sillytavern-adapter.js`, plus the exact player `app.js` cache-buster. The renderer output is included because the player entry imports its exact title-evidence validator at runtime. The candidate fallback reason validator must compare a speaker's span against `sourceText` when a display-only alias is present, otherwise against `text`. All other write paths remain forbidden. No chat/provider/ST-source/page-construction/segmenter/body-rendering changes.
- Before implementation, the exact raw-chat fixture was run against v52 and failed 6/6 as documented above. Re-run it after each bounded helper category and only then run full regression/replay/audits.

### v53 final verification snapshot

- Production-page exact historical gold: 6/6 title matches. The dedicated command `node --test --test-name-pattern="v53 historical gold" frontend/player/tests/speaker-structure-replay.test.mjs` exited 0 (1 test passed). Latest focused results are recorded in the v53 A2 closure addendum below; do not use this earlier snapshot to imply those suites ran after the transfer-frame fix.
- The earlier in-progress v53 replay metrics below are superseded by the final A2-bounded replay. The current exact result is 6,242 candidates (4,500 attributed, 118 anonymous, 1,624 narrator display fallbacks, 0 unresolved display rows); the observed-name scope correction intentionally trades broad name reuse for bounded evidence and materially shifts candidate categories. This is a distribution change, not a measured accuracy gain.
- Frozen segmenter raw UTF-8 exact-slice SHA-256: `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`, identical to intake.
- Isolated `frontend/build-static.mjs` player/admin build exited 0 with version `auto-fbaeb8e6e97c`. Only runtime dependencies were synchronized: player `app.js`, player `presentation-renderer.js`, player and admin `shared/sillytavern-adapter.js`, plus the exact player `index.html` app.js cache-buster. The stylesheet query remains `auto-8fd622b9f5f5`. Staging/public SHA-256 pairs match: app `b5b653850699cf19cbb3414051b5efc34c44b7d336aab63ceac66689c90f963a`; renderer `2a51ceee1afa2098a71335b32f04abff3b7b5e9f6f0b054bfd0f4b51717c43d3`; player/admin adapter `cab1afd157f9ae19eb4e16466a981e973847bc3d4e223745b547d054dc11e0e5`. Other dirty build outputs were not synchronized.
- Static DOM smoke exited 0 (`ok=true`, player syntax/route isolation true). Full architecture audit exited 0 (`totalFiles=707`, `prohibitedActiveCount=0`, `needsReviewCount=0`, `failedChecks=[]`) after synchronizing only the generated admin adapter required by the shared-build invariant. `git diff --check` exited 0; Git emitted line-ending normalization warnings only.
- The full replay reports `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. No player service or SillyTavern process was started for this read-only parser task.

### v53 A2 bounded correction addendum (2026-10-08)

The stale replay assertions now expect the actual parser version `full-message-speaker-index.v53`. The observed-name scope is limited to the preceding eight caller-supplied message positions (empty/player entries consume a position) and resets before a recognized opening scene/title message. It is a candidate-name lexicon only; it does not carry speaker ownership or pronouns across messages or scenes. Exact regressions cover the scene reset, expiry window, a pronoun with no same-scene antecedent, and source-transfer speech/document frames. In `马库斯把报告递给你，说：“…”`, the source subject span is exactly `马库斯` `[0,3)`, and the replay title is `马库斯`; `马库斯把` is rejected. A transfer action without a direct `说` cue and `马库斯把报告递给你，报告上写着：“…”` remain narrator fallback.

Final A2-bound verification (all commands run after the bounded source correction): `runtime-regressions` 57/57; `presentation-renderer` 1/1; shared adapter 1/1; speaker replay tests 46/46; all exit 0. Six source-backed historical golds remain 6/6. Full read-only replay exited 0: 158 chat files, 950 assistant messages, 18,562 unchanged production pages, 6,242 dialogue candidates; 4,500 attributed, 118 anonymous introductions, 1,624 narrator display fallbacks, 0 probable titles, 0 unresolved display rows. Candidate-only fallback reasons sum exactly to 1,624: no unique speaker evidence 1,610; narrative-shaped unattributed quote 2; ambiguous local reference 2; dialogue shape without speaker 10; conflicting evidence, ambiguous quote structure, and open quote without unique speaker are all zero. There are 1,659 unique unresolved dialogue spans / 1,834 page links / 151 multi-page spans; these are diagnostics, not 1,659 additional candidate titles. Evidence validation is 17,806/17,806 with 0 unaddressable pages; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`; source digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`.

Against frozen v52, the final bounded v53 replay has 160 fewer candidates, 471 fewer attributed pages, 15 more anonymous introductions, and 296 more narrator display fallbacks. The earlier in-progress v53 counts (6,404 candidates) are superseded. This sizeable conservative category shift follows the bounded eight-position/scene-reset name lexicon; it is not evidence that all downgraded pages are true narration or that accuracy improved. Overall `speakerAccuracy=INSUFFICIENT_EVIDENCE` because complete published speaker scopes and a representative full-history gold set are unavailable. Candidate-shape diagnostics (quoted 147, quote plus speech cue 30, post-quote cue 1, line-colon 399, dash-led 569, multi-quote 125) are overlapping indicators, not an exhaustive partition. A follow-up should take a read-only stratified sample from the largest no-unique-evidence bucket, pin each excerpt by chat/message hash/page/span, get user labels for recurring shapes, then add paired positive and source/document/scene-conflict negatives before another full replay.

Frozen segmenter raw UTF-8 exact-slice SHA-256 remains `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`, identical to intake. Player/admin static output hashes match their isolated stage artifacts; index app cache key is `auto-fbaeb8e6e97c`, CSS key unchanged. DOM smoke and full architecture audit exited 0; the latter scanned 707 files with 0 prohibited active findings, 0 needs-review findings, and no failed checks. `git diff --check` exited 0. Independent A2 review remains pending; no SillyTavern source, chat data, semantic text, production pagination or provider behavior was changed.

## v52 bounded implementation override (2026-10-08)

v52 extends the v51 display-title behavior with a small set of general source-evidence rules. The v51 replay is the frozen read-only baseline: 158 chats, 950 assistant messages, 18,562 production pages, 6,379 dialogue candidates (4,908 attributed, 105 anonymous introductions, 1,366 narrator fallbacks, 0 probable, 0 unresolved), source-set digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`. The replay reason counter currently also includes 128 non-candidate narrative pages; v52 must split candidate fallback reasons from all-page narrator diagnostics rather than mixing denominators.

### Frozen v52 evidence rules

- Resolve a quote from a direct speaker or named-action anchor anywhere in the same original assistant message only when it is the nearest unique valid anchor in the same scene and no later stronger cue names another speaker. Scene headings, scene-location transitions, a new named subject, a closed turn with a competing actor, or conflicting speaker evidence stop carry-forward. Do not cross chats or original messages.
- Preserve actual quote state. Only a source-verified continuation of the same still-open quoted utterance may carry its owner across existing display pages; a closed quote does not inherit by proximity. Keep exact source spans/hashes and validate them against the full message.
- Use the player title `你` only for an explicit first-person action/speech cue outside all quote spans (for example, an unquoted narration lead such as `我压低声音：`). First-person words inside a character's quoted utterance are never player evidence.
- A live physical actor who performs an action and immediately speaks may own the following quote. Text explicitly framed as written/reported content (a report, letter, inscription, system text, or equivalent carrier) remains `旁白` unless a separate live-speaker cue directly owns the speech.
- A crowd/group title such as `人群` requires an explicit same-message collective source and a contiguous group of anonymous quotes; otherwise retain the v51 narrator fallback. Do not infer a character from mention, story plausibility, or a group from quote plurality alone.
- Explicit named speaker/group evidence wins. Anonymous first appearance remains `？？？`. A quote that is genuinely unclosed remains `未识别`. Closed/complete but uniquely unattributed speech remains display-only `旁白` under the v51 contract.

### Latest ten user-calibrated regression cases

1. `Pippa`: resolve through a unique earlier direct quote/action anchor in the same original message, including across existing pages, until a scene boundary or stronger speaker cue.
2. `格雷戈`: strong named action-plus-speech attribution; preserve the exact source spelling and do not add aliases.
3. `你`: an unquoted first-person narration action cue identifies the player; negative: NPC first person inside quotes never identifies `你`.
4. `旁白`: quoted content carried by a document/written artifact without live speech evidence.
5. `人群`: multiple anonymous quotes after an explicit same-message rumor/crowd source; negative: quote plurality without a collective source stays `旁白`.
6. `旁白`: a short command such as `行动！` after the opening title is not a new speaker.
7. `暗影祭司`: named character action/reaction followed by a colon and quoted speech.
8. `维斯坎特`: nearest unique named actor plus an immediate pronoun-led hit/reaction in the same scene.
9. `加里克爵士`: source explicitly names him in messages 470/472, so the relevant historical line resolves to that exact source name rather than `？？？`.
10. `马库斯`: a live actor physically opening/spreading a report and speaking aloud is attributed to Marcus; text presented as the report's written contents remains `旁白`.

### v52 risk level and D/I/A

- **D0:** the ten labels and narrator/anonymous/open-quote precedence are user-confirmed; `格雷戈` retains source spelling.
- **I2:** same-message evidence must safely project across the exact existing page spans and keep quote openness, scene boundaries, and conflict precedence stable. No production page creation or resegmentation is involved.
- **A1:** independent review must verify the frozen segmenter/page-builder hashes, quote/source-span invariants, test/replay evidence, and source freeze.
- Route provenance remains `ROUTE_UNVERIFIED` unless independently observed.

### v52 permitted changes and closure

v52 may edit only the structural attribution/index and projection helpers in `frontend/shared/src/sillytavern-adapter.js`; replay accounting in `frontend/player/tools/speaker-structure-replay.mjs`; targeted regressions in `frontend/shared/tests/sillytavern-adapter.test.mjs`, `frontend/player/tests/speaker-structure-replay.test.mjs`, and only relevant title assertions in `frontend/player/tests/runtime-regressions.test.mjs`; parser/cache version literals in `frontend/player/src/main.js`; this TaskSpec, the Native-first/Design/Frontend baseline documents, the historical replay plan, and the full-message speaker evidence report; plus generated `public/game/app.js`, `public/game/shared/sillytavern-adapter.js`, `public/game-admin/shared/sillytavern-adapter.js`, and the exact `public/game/index.html` app.js cache-buster value. No other files are in scope.

Run focused tests, exact ten-case gold, the full-history read-only replay, frozen segmenter hash comparison, player/admin build and cache coherence, static architecture audit, DOM smoke, and `git diff --check`. Replay must report `sourceUnchanged=true`, `chatWriteback=false`, and `externalProviderCalls=0`. All unresolved/ambiguous closed speech may continue to display narrator fallback, with diagnostics intact; coverage changes are not accuracy. Freeze all writes after tests and hand the exact tree to independent A1.

## Goal

Reduce false `未识别` page titles and improve reusable speaker attribution across scripts by making title projection reason over message-local utterance continuity, bidirectional attribution cues, and uniquely resolvable local references. For closed/complete speech without unique speaker evidence, use the user's accepted `旁白` display fallback. Preserve `？？？` for a clearly anonymous first appearance. Keep diagnostic evidence separate from the visible fallback so coverage changes are not reported as speaker accuracy.

## v51 display fallback contract — documentation closure (2026-10-08)

This latest display-title exception supersedes older baseline wording that requires every speech span lacking a unique speaker to display `未识别`. It applies only when speech is closed/complete and no unique speaker is supported:

- Keep the semantic segment as dialogue/unattributed (or preserve its existing semantic annotation); do not rewrite it to narration. Speaker identity remains unresolved.
- The visible title and renderer visual context use the existing narrator display path: title `旁白`, renderer `role=narrator`, and only the neutral `CORE_NARRATOR_PLACEHOLDER_URL`/existing `narrator` channel. Do not use a character-catalog portrait or create a character/avatar binding.
- Explicit speaker/group evidence has priority. An anonymous first appearance remains `？？？`. A genuinely unclosed quote remains `未识别` and does not use this fallback.
- The fallback is a display classification, not proof that the utterance is narration. It creates no speaker identity, roster entry, persistent role, or avatar binding.

This exception does not change semantic annotation, source body, production segments/pages, pagination, source spans, chat data, or SillyTavern-owned code. Matching rules are recorded in the Native-first, Design, and Frontend baseline documents.

## D / I / A

- **D0:** The user accepted the preceding design direction. Explicit unique speaker/group evidence wins; a clearly anonymous first appearance remains ？？？; closed/complete speech without a unique speaker uses the neutral narrator display fallback; unclosed quotes remain 未识别. No speaker identity is created from fallback.
- **I2:** This changes a cross-page/source-span invariant across structural evidence, existing-page projection, and historical replay; a concrete baseline snapshot is required.
- **A1:** Independent review must verify page/source-span immutability, fallback semantics, evidence accuracy, and the SillyTavern source freeze.
- Requested route for this v52 writer dispatch: Execute `I2 / gpt-6-luna / xhigh`. Actual route provenance is `ROUTE_UNVERIFIED`; do not claim the requested route was verified.

## Frozen baseline

- Repository: `D:\AI\SillyTavern`; HEAD at intake: `c59b194f6f8ebb663f2cd24a5fdc257cc5ec93e9`.
- The worktree already had 84 modified/untracked paths at intake. Treat all existing changes as user-owned baseline; do not reset, clean, revert, or reformat them.
- v52 frozen comparison baseline is parser v51, recorded read-only: 158 chats, 950 assistant messages, 18,562 production pages, 6,379 dialogue-candidate pages; 4,908 attributed, 105 anonymous introductions, 0 probable titles, 1,366 narrator fallbacks, 0 unresolved display rows. Source-set digest is `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`. The v51 reason counter mixed 128 non-candidate narrative-page diagnostics into its all-page counts; v52 must separate those from candidate-only fallback reasons. Overall accuracy is `INSUFFICIENT_EVIDENCE` because complete per-chat rosters and page-level gold are unavailable.
- Starting segmenter snapshot: `createVisualNovelDisplaySegments` in `frontend/shared/src/sillytavern-adapter.js`, lines 1368–1434 at intake, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`.
- The source segmenter and page construction already differ from Git HEAD due pre-existing work. This task must preserve the exact starting behavior and must not broaden or repair those pre-existing changes.

## In scope

- Deterministic structural display-title attribution only.
- Same-original-message attribution in both directions around a quote (speaker/action before it or explicit post-quote attribution).
- Ignore an orphan ASCII double quote only when no quote is open and the mark is the last non-whitespace character on its line; this prevents a stray closer from shifting later quote pairs. Real openers followed by text remain valid.
- Carry a speaker only across a source-verified continuation of the same still-open utterance; do not carry a closed turn by proximity alone.
- Resolve pronouns/role references only when exactly one explicit, nearby, same-message actor anchor is available. If ambiguous, use the narrator fallback.
- Preserve anonymous-first-appearance `？？？`, explicit group labels, player `你`, titles, choices, and structured game information behavior already confirmed by user rules.
- Add diagnostic replay buckets that distinguish confirmed attribution, anonymous introduction, probable evidence, and narrator fallback/remaining ambiguity.
- Update the three baseline documents and historical replay record consistently before/with code behavior changes.
- Bump the structural parser/cache version and synchronize only the generated player entry/shared adapter files needed for this parser.

## Non-goals

- No LLM/provider request, API-key use, semantic analyzer activation, or live story generation.
- No SillyTavern-owned source edits; no chat writes, body edits, message deletions, or state/roster mutation.
- No changes to `createVisualNovelDisplaySegments`, `applyQuotedDialogueSpeakerContinuity`, production page construction, pagination order/count, body rendering, whitespace, or source spans.
- No speaker/avatar identity creation from narrator fallback, no image selection changes, and no cross-chat name/alias learning.
- No cleanup/revert of unrelated dirty worktree changes.

## Allowed write set

- `frontend/shared/src/sillytavern-adapter.js` — only structural attribution helpers/evidence projection/version literals; the frozen segmenter symbols above are forbidden.
- `frontend/player/src/main.js` — parser/cache version literal only; `createPresentationPagesForMessage` and page construction are forbidden.
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs`
- `frontend/player/tests/runtime-regressions.test.mjs` — only assertions for unresolved structural display titles; page/body/pagination assertions remain frozen.
- `frontend/shared/tests/sillytavern-adapter.test.mjs`
- `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`
- `docs/GALGAME_DESIGN_SPEC.md`
- `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`
- `docs/GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md`
- generated outputs only: `public/game/app.js`, `public/game/shared/sillytavern-adapter.js`, `public/game-admin/shared/sillytavern-adapter.js`.
- `public/game/index.html` — task-specific allowance added 2026-10-08: update only the `app.js?v=...` cache-buster to the exact version from the isolated generated player entry; do not replace the file or alter any other byte.

## Hard constraints

1. Freeze all original SillyTavern code. No writes under `src/**`, `server.js`, `plugins.js`, `config.yaml`, root package manifests, original `public/index.html`, `public/script.js`, `public/style.css`, or extensions.
2. Preserve the exact frozen segmenter snapshot and starting page-construction behavior. No semantic logic may add, remove, split, merge, reorder, trim, or rewrite production pages or spans.
3. Evidence must be tied to exact current-message code-point source spans and hashes. A fallback label must not be represented as a discovered speaker.
4. Historical replay is read-only and reports accuracy as insufficient without complete gold data.
5. New tests include positive and negative/ambiguous forms; exact current user golds remain stable.

## Acceptance checks

- Existing manual speaker/title fixtures and the latest ten labels pass against exact visible `titleText`, including `全员` without a redundant suffix, a document-text narration negative, and the user-approved narrator fallback for the ambiguous Pippa/Durik quote.
- Add generalized variants for before/after quote attribution, same-open-quote page continuation, unique vs ambiguous reference resolution, narrator fallback, anonymous first appearance, and conflict cases.
- Add a historical-shape regression for an orphan line-ending quote followed by valid speaker quotes and unquoted narration; verify that exact existing production page spans remain unchanged and a genuinely unclosed quote remains `未识别`.
- Direct segmenter regression fixtures keep exact page count, order, and source spans from intake; diff shows no edits to frozen symbols or page-construction function.
- Full-history v52 replay completes read-only, reports baseline/current counts and candidate-only fallback reasons separately from all-page diagnostics, validates every source evidence span, and confirms source unchanged/no chat writes/no provider calls. Do not claim accuracy without gold labels.
- Run focused tests, static architecture audit, static DOM smoke, and `git diff --check`.
- Independent read-only A1 audit of the frozen final version returns PASS. Any FAIL requires a bounded correction and a new fixed-version audit.

## Handoff status

Frozen for one implementation writer. Existing dirty worktree contents are not authorized for cleanup. No source-fidelity sidecar is required because this task does not derive behavior from a named external repository revision.

## v52 final implementation evidence

The v52 exact-title gold has 10/10 correct visible title matches. A bounded regression additionally verifies post-quote attribution in `“你刚才敲的位置……” Ren低声说，“不是窗。”`, including without an available published roster, and verifies that `她平静地说` is not accepted as a speaker name. That cross-page second utterance is projected only when the unchanged production segmenter returns an addressable source span; the tested fixture includes subsequent source text so its existing span remains addressable.

Final full read-only replay: 158 chats, 950 assistant messages, 18,562 existing pages, 6,402 dialogue candidates; 4,971 attributed, 103 anonymous introductions, 0 probable, 1,328 narrator fallbacks, 0 unresolved display rows. Candidate reason denominator: 1,317 no unique speaker evidence + 2 narrative-shaped unattributed quote + 4 ambiguous local reference + 5 dialogue shape without speaker = 1,328; other fixed buckets are zero. All-page narrator diagnostics total 1,447, including 119 noncandidate narrative pages. Compared to recorded v51: candidate +23, attributed +63, anonymous −2, fallback −38. No per-page v51/v52 transition artifact was produced, so this net delta is not attributed to individual rules and is not an accuracy score.

Replay evidence spans validated 17,818/17,818; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`, source-set digest unchanged at `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`. Overall speaker accuracy remains `INSUFFICIENT_EVIDENCE` because published roster scopes and a full human holdout are unavailable.
