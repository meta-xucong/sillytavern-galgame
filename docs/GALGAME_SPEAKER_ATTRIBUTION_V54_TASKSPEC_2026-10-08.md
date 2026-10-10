# Speaker Attribution v54 — Bounded TaskSpec

## Decision / risk

- **D1:** The six historical labels below are accepted as exact visible-title gold. They are pinned to canonical non-seed chat paths, source-message hashes, production page indices, and code-point spans. The #2 page already displays the expected title in the current full-chat replay; the other five are currently narrator fallback. Preserve that existing correct production result.
- **I2:** Changes can affect title attribution and quote-continuation ownership, so production-page replay, exact source spans, opposing negative cases, complete read-only replay, and frozen pagination checks are required.
- **A1:** An independent reviewer must verify evidence scope, source freeze, exact gold and negatives, and replay/report consistency before acceptance.

## Frozen v53 baseline and v54 objective

Frozen v53 final replay: 158 chats, 950 assistant messages, 18,562 production pages, 6,242 dialogue candidates (4,500 attributed, 118 anonymous first appearances, 1,624 narrator display fallbacks, 0 unresolved display rows); candidate fallback reasons sum to 1,624. Source digest is `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`. This is structural coverage, not accuracy.

v54 is limited to general source-structure evidence exposed by the six examples: retain a complete named subject when Chinese particles such as `则` follow it; recognize a unique named actor’s immediately speech-linked voice/action; preserve a still-open paired quote across only its existing production pages; and resolve a nearby pronoun speech cue only from the nearest unique explicit same-message/same-scene anchor. A heading, new scene, new named speaker, ambiguous anchor, source/document carrier, or absence of a speech/action relation blocks carry-forward. Do not add proper-name or scenario-specific rules.

The source report/ledger text `上面……写着` is narration. A map handoff by itself is not speech attribution. Where there is no unique local anchor, keep the existing display fallback and diagnostic; do not fabricate a speaker. User-requested anonymous self-introduction/first appearance behavior is outside v54 and reserved for a later manual calibration.

## Exact real-history gold

Canonical paths are non-seed JSONL files. The test must verify each SHA, production page span and exact excerpt before checking the production display-title result.

| Chat path | Source message | Page / span | Source-message SHA-256 | Expected title |
|---|---:|---|---|---|
| `galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl` | 26 | 13 / `[674,724)` | `sha256:b625d48c35864613e531108a8ac9a6dc42df47a387e16d89e4c9784da513a734` | Pippa |
| same | 38 | 5 / `[250,289)` | `sha256:002a2eda6a50ed7e120092f6e8b7455c2bfb54cae9e26f487db3594207d30f9b` | 尼布 |
| same | 42 | 10 / `[483,524)` | `sha256:0ea2638738614ab8f3022095ac5517a0649e94fc1c6343d789d5be8da272b4d5` | Pippa |
| same | 50 | 5 / `[304,352)` | `sha256:600f6f7b117da53b3c5c49eda174c3fa306db81d4e0eff20a3d475c85fddf8d1` | 胖商人 |
| same | 162 | 1 / `[67,106)` | `sha256:15480e92c9941d5a3b6d8277e11dd5837db40612402629e40c44c755130d5c02` | Lila |
| `galgame_imported_apartment5c/galgame-galgame-imported-apartment5c-entry-Apartment_5C-20260725120816.jsonl` | 0 | 6 / `[246,269)` | `sha256:a3a667ba0153ad75b04a5498688c11a6296b95c9122b039f41ddf20d3eec3a09` | Priya |

Current v53 production replay is 2/6: msg38/p5 is already `尼布`; msg26/p13, msg42/p10, msg50/p5, msg162/p1 and Apartment 5C msg0/p6 are `旁白` / `narratorFallback`. Direct index probing on msg38 without the chat-local production scope yields the malformed surface `指着头顶`; it is not the acceptance path. Keep page title replay as the source of truth and avoid regressing the full-chat result. For msg42, the immediately following page 11 (`她把账本递来，上面歪歪扭扭写着……`) is a pinned negative and must remain narrator.

## Required negatives

- Written report/ledger carrier (`账页上写着` / `报告上写着`) remains `旁白`, even when a character handles the object.
- Map transfer with no speech predicate remains `旁白`.
- A pronoun cannot inherit from a non-unique nearby anchor, across a scene/title boundary, or after a new explicit speaker.
- A cross-page quote continuation is eligible only while the same source quote remains open in the same original message/hash and exact production spans; a closed quote or different quote cannot inherit the prior speaker.

## Frozen code/data boundaries

Allowed source writes: structural helpers in `frontend/shared/src/sillytavern-adapter.js`; `frontend/player/tools/speaker-structure-replay.mjs`; exact historical and minimal positive/negative regressions in `frontend/player/tests/speaker-structure-replay.test.mjs` and corresponding shared-adapter tests if needed; only the parser/cache version literal in `frontend/player/src/main.js`; this TaskSpec, the three baseline specs, and `docs/GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md`; only generated static outputs required by the actual v54 runtime dependency graph (record exact paths and hashes before/after).

Forbidden: `createVisualNovelDisplaySegments`, `applyQuotedDialogueSpeakerContinuity`, `createPresentationPagesForMessage`, page-construction/order/count/span logic, source body formatting or spans, semantic annotations, visual assets/identity, any SillyTavern-owned source, chat files, providers, services, unrelated dirty files, broad rule/name inventories, and unrequested history repair. Historical replay is read-only; no chat writeback or external provider calls.

## Required sequence and acceptance

1. Keep this TaskSpec frozen before implementation. Add real production-page gold assertions and required negatives; run against v53 and record the expected red baseline before changing implementation.
2. Make only generic structural changes; run focused tests after each behavior. Preserve the exact source excerpts and page boundaries.
3. Run focused adapter/replay suites, the full read-only history replay with candidate fallback reason buckets, exact gold 6/6, static architecture and DOM smoke, the scoped static build/output coherence check, frozen segmenter raw-source SHA-256 comparison, and `git diff --check`.
4. Report category movement as coverage only, never as full-history accuracy. Prove source digest and chat files stayed unchanged, no source writeback/provider calls occurred, and the frozen paginator/segmenter source hash matches intake.
5. Freeze all writes and hand the exact changed-path list, commands, exit codes, hashes, gold/replay data and limitations to an independent A3 auditor. Do not claim acceptance until A3 review closes.

## v54 implementation evidence (2026-10-08)

The first production-page red run against v53 was 1/6; after the bounded source-structure changes, the exact real-history gold is 6/6. The implemented categories are: a named Latin subject followed by a voice/speech predicate; local named action cues for check/division/kneeling followed by the same quote; leading Chinese grammatical particles excluded from the subject span; an already-open quote continues through its exact existing page spans; and a Latin nearby action tail is left-trimmed before the existing unique-pronoun cue. Han voice-like prose is accepted only when the exact name is in the bounded chat-local name set, preventing `只用尖细的声音说` from becoming a fabricated speaker. No speaker-name inventory was added.

The first full replay exposed that anonymous-voice false positive; the bounded Han-name condition restored the existing negative. Final focused results: runtime regressions 57/57, presentation renderer 1/1, shared adapter 1/1, speaker replay 47/47. Exact source-backed ledger/report page and the existing map-transfer-only, NPC-first-person, scene boundary, completed-quote, ambiguous-reference and anonymous-description negatives pass. Full history replay: 158 chat files, 950 assistant messages, 18,562 production pages, 6,242 candidates; 4,519 attributed, 118 anonymous, 1,605 narrator fallbacks, 0 unresolved. Fallback reasons sum to 1,605: no-unique 1,591; narrative-framed quote 2; ambiguous local 2; dialogue shape without speaker 10; all other fixed buckets 0. Relative to v53 this moves 19 pages from fallback to attribution; it does not establish accuracy, which remains `INSUFFICIENT_EVIDENCE`.

Read-only proof: source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; structural evidence 17,806/17,806 valid, 0 unaddressable; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. Static architecture/DOM/build-output/hash/diff evidence: player and admin staging builds exited 0; only `public/game/app.js`, `public/game/index.html` app cache-buster, and the player/admin `shared/sillytavern-adapter.js` outputs were synchronized. Build version is `auto-8e544ea11df0`; app imports and index app URL use this version, parser is v54, CSS query remains `auto-8fd622b9f5f5`, and the two shared-adapter copies have SHA-256 `72ee3167ae974063858647cbf492ecd3b1a918f89b0de17094b168851be25d2f`. Player `app.js` SHA-256 is `60a9143950754752d06dc00ec030739b097cb9be544e617abfa5f0ad0411cad9`; index SHA-256 is `513fe87af4406d20344d3df817130e64af3f7c7d0229b08562358856317c81a5`. `node frontend/tools/static-architecture-audit.mjs` exited 0 (707 files, 1,515 findings, 0 prohibited active, 0 needs-review, 0 failed checks); `node frontend/tools/static-dom-smoke.mjs` exited 0 (`ok=true`); import/cache coherence check exited 0; frozen segmenter raw slice offsets `[49566,52931)`, 3,447 UTF-8 bytes, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`, unchanged from v53; `git diff --check` exited 0. No chat, provider, source body, semantic annotation, page builder, segmenter or SillyTavern file is an implementation target. The independent A3 audit remains pending; do not call this accepted until that review closes.
