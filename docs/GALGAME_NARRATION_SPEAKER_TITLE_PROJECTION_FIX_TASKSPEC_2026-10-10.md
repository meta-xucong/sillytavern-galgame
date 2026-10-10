# Narration Page Speaker Title Projection Fix

## Goal

Allow the player UI to show an exact, locally validated structural speaker title when a source-derived page is coarsely classified as narration but contains attributed dialogue. This repairs title projection only; it does not improve or replace the source parser.

## Root cause

Four independent gates disagreed:

1. A semantic `narration` annotation made a quote-bearing coarse title look authoritative, so the shared structural title parser was skipped.
2. The title memo writer accepted structural speaker evidence for unknown pages, but rejected the same evidence for a narration page.
3. The title renderer returned the semantic `旁白` label before consulting an otherwise exact page-title speaker memo.
4. The parser, player, and renderer maintained overlapping rule allowlists. `named-subject-colon-quote` was omitted from the player validator; the independent audit found three more omitted cues, and a complete comparison against `structuralQuoteSpeakerEvidenceRank` found further rank 0–2 speaker/group evidence IDs that the title contract did not accept. The parser had already selected a unique speaker or group and page projection still verified current source spans, but these supported results were rejected by the display contract.

As a result, parser evidence could exist in the full source while the active page continued to display `旁白`.

## Implementation boundary

- Preserve SillyTavern source freeze. No upstream files or APIs are changed.
- Keep the existing shared structural parser, its confidence/rank rules, source hash and span validation.
- Keep one parser-owned allowlist contract for fast/exact speaker title evidence; include all parser-selected rank 0–2 speaker/group evidence IDs that carry unique speaker and source-span evidence. Rank 3/default contextual results remain excluded. Player storage/validation and rendering consume it instead of shadow copies.
- Permit retry only for a quote-bearing narrator title; records, headings, player/system pages, and unquoted prose keep their current behavior.
- Permit title memo storage only for the current narration page and only for exact `speaker`/`group` structural evidence. Do not let this widen into prior-page relabeling.
- Let the renderer display that title only after its existing source-message hash, source index, core span, view span, evidence span, and rule validation succeeds.
- Keep semantic classification, page type, identity, visual speaker context, text, page order/count, and source spans unchanged.
- Do not modify SillyTavern chat data or make provider/API calls.

## Acceptance checks

1. A long/mixed page with semantic `narration` plus a clear structural attribution renders the attributed speaker as its title.
2. The page remains narration, identity remains unassigned, visual role remains narrator/unknown, and body/span are byte/code-point identical.
3. Unattributed quotes, sound effects, structured records, headings, stale hashes, and invalid spans do not become speaker titles.
4. Source and generated `public/game` runtime remain synchronized.
5. Player runtime and renderer regression tests pass; `git diff --check` passes.
6. A read-only replay of the latest available chat confirms title projection without writing to the chat.

## Files

- `frontend/shared/src/sillytavern-adapter.js`: expose the canonical structural title-rule contract without changing attribution parsing.
- `frontend/player/src/main.js`: align retry, memo eligibility, and current-page title projection.
- `frontend/player/src/presentation-renderer.js`: honor validated structural speaker evidence for narration titles only.
- `frontend/player/tests/runtime-regressions.test.mjs` and `frontend/player/tests/presentation-renderer.test.mjs`: positive and negative regressions.
- `public/game/app.js`, `public/game/presentation-renderer.js`, and player/admin `shared/sillytavern-adapter.js`: synchronized custom build outputs. The admin adapter copy is included only to satisfy shared-module build parity; the admin application behavior is unchanged.
- The three baseline Galgame specs record the title-only behavior and frozen boundaries.

## Verification record — 2026-10-10

- Regression suites: player runtime, renderer, and shared adapter: 73/73 passed after the independent audit and a complete rank-contract comparison. Shared tests assert all rank 0–2 parser IDs cross both display gates. Regression includes semantic narration plus explicit dash-led speech, preserves role/body/span, and verifies that unattributed quotes remain narrator.
- Static architecture audit: passed (105 files scanned, 0 prohibited active findings, 0 review findings, 0 failed checks); static DOM smoke passed.
- Build `galgame-2026-10-10-speaker-title-v4` is served from `127.0.0.1:8001`; HTML, app module, renderer, and shared rule contract return HTTP 200. The built contract contains the complete rank 0–2 parser evidence set.
- Read-only replay of chat snapshot `sha256:26284a014a06b0fc41053afad0a953f9bd6d596318e2e84c81ca23edc7bc9d2c`, assistant message 884: the original segmenter still yields 31 narration pages; nine pages receive validated speaker titles (`马库斯`, `Pippa`, `Lady Morgana`, `你`, and `维克多` across its ledger continuation). Every projected page retains narration visual context, body, page span, and semantic type. Re-reading the chat returned the same snapshot digest.
- The final live-browser visual paint was not used as acceptance evidence; verification covers current served assets plus exact renderer replay.
