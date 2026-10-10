# Structural Speaker Direct-Cue Coverage Improvement

Date: 2026-10-07  
Status: v8 implemented; historical coverage replay complete; accuracy remains unverified

## Objective

Recover directly attributed dialogue whose speaker is followed by a speech verb that is absent from the current cue set. Keep the existing conservative attribution model: the speaker name must still be directly tied to a speech cue and the quote must be bound to the original message span.

## Audit findings

The fixed, read-only history snapshot is 158 chats / 939 assistant messages, with source-set digest `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`.

- The old headline of 5,210 unresolved pages is page-level. The same unresolved quote can appear on multiple production pages; one replay associated 5,210 pages with 4,358 unique quote spans and found 691 spans spanning multiple consecutive pages. Do not treat page count as the number of distinct speaker misses.
- Applying the active manifest roster alone moved confirmed attribution from 297 to 301 pages. A static roster is not the coverage fix.
- A broad candidate scan found many `known name + action + colon + quote` forms. These are **not** direct attribution: e.g. `Pippa翻开账本：“…”` can be narration followed by a quote. Existing authoritative specifications explicitly prohibit promoting such action/relationship/location clauses to confirmed speakers. Do not add this rule, do not use a chat-local roster as proof, and do not infer from adjacency.
- A narrower scan found at least 54 unique spans with a direct speech-predicate shape that is not represented in the current cue list. Repeated examples include `补充`, `嘀咕`, `提醒`, `回应`, `插话`, and `解释` immediately before a colon and quote. The 54 is a candidate-coverage count, not accuracy or a complete count; no gold labels were used.

## Root cause

The direct-cue parser uses a small fixed vocabulary. When a clear speech predicate such as `Pippa补充：“…”` or `Elena提醒：“…”` is absent from that list, the exact name-plus-speech-verb structure is missed and the quote stays unattributed. A historical tail-shape scan also found common vocal predicates (`尖叫`, `怒吼`, `咆哮`, `嘶声`, `低语`, `嘟囔`) and direct delivery forms (`低声道`, `轻声道`, `喃喃道`). Common neighboring actions such as `点头`, `冷笑`, and `摇头` also occur, but do not prove the following quote belongs to that character and stay excluded.

## Minimal change

1. Extend the existing direct speech cue list with the data-supported verbs `补充`, `嘀咕`, `提醒`, `回应`, `插话`, `解释`, `低声道`, `轻声道`, `尖叫`, `怒吼`, `咆哮`, `嘶声`, `低语`, `喃喃道`, and `嘟囔`.
2. Do not widen the accepted modifier grammar. Do not accept arbitrary `name + action + colon + quote` shapes.
3. Keep published-name and explicit unknown-name gates, exact quote/source spans, speaker-conflict rejection, record/title guards, and page-local projection unchanged.
4. Keep speaker indexing as display-only title evidence. Do not modify semantic type, identity, avatar selection, roster, party, status, or story state.
5. Add unique unresolved utterance and multi-page continuation counts to the history replay summary. Keep page-level counts too, with labels that make the unit clear.

The attribution change is limited to `STRUCTURAL_SPEECH_CUES` and its matching post-quote cue grammar in `frontend/shared/src/sillytavern-adapter.js`. It does not change `parseNarrativeDialogueParagraph`, its four-field probable-hint generation, or the quote scanner. The post-quote Chinese-name capture is non-greedy so a compound cue such as `低声道` is not split into a longer guessed name plus the one-character cue `道`. Existing dialogue-shape detection can recognize an additional page when a new cue is its only speech evidence, so replay must report and explain any candidate-denominator delta instead of assuming it is invariant.

Because the parser's accepted cue set is part of its cache identity, the structural index/parser version advances from v7 to v8.

## Non-goals and hard boundaries

- No LLM/provider call.
- No learned or cross-message speaker roster.
- No nearest-speaker inheritance, action-verb inference, entity frequency voting, or general `Name:` recognition.
- No edits to SillyTavern-owned code or data.
- No changes to `formatVisualNovelDisplayText()`, `createVisualNovelDisplaySegments()`, page count/order, segment text/type, source spans, body rendering, chat storage, or save data.

## Verification

1. Focused parser cases: accept each added speech cue for a published Latin/Han speaker and a structurally admissible new multi-character speaker; preserve exact source spans and `speaker` evidence.
2. Negative cases: `Name翻开账本：“…”`, `Name点头：“…”`, bare unknown `Name: “…”`, `Status: “…”`, unrelated quote/title text, and conflicting before/after attributions must not become confirmed speakers.
3. Pagination guard: compare production page count/order, body text, segment type, and source spans before and after title projection.
4. Historical replay against the same fixed source digest: report confirmed/probable/unresolved pages, unique unresolved spans, recovered direct-cue spans, and multi-page spans. Require zero source writeback and zero provider calls. Without a gold holdout, label the result coverage-only and do not claim accuracy.

## Acceptance

## v7 implementation and scoped historical result

The first six direct cues were implemented in `frontend/shared/src/sillytavern-adapter.js`; the player structural parser cache version was v7. Replay reported unique unresolved spans, their page links, multi-page spans, and the utterances attributed by the added cues. `parseNarrativeDialogueParagraph` and its probable-hint generation were not changed.

With the active release roster applied per chat, the before/after replay used the same source digest. Confirmed speaker-title pages increased from 301 to 428 (+127); probable display titles changed from 516 to 507; unresolved candidate pages decreased from 5,871 to 5,745 (-126), while the candidate denominator moved from 6,172 to 6,173 (+1) because one page gained direct dialogue evidence. The new cues account for 89 attributed utterance spans: `补充` 72, `提醒` 6, `回应` 5, `插话` 6, `嘀咕` 0, `解释` 0. Current replay has 4,796 unique unresolved spans, 5,872 span-to-page links, and 792 multi-page spans. The 4,796 count is not a measured before/after reduction because the old replay did not record this metric.

The targeted parser/replay/runtime suites passed 74/74. Replay remained coverage-only (`speakerAccuracy=INSUFFICIENT_EVIDENCE`), with source unchanged, no chat writeback, and no provider calls. These figures show improved structural coverage, not gold accuracy; most quote spans still had no directly detectable speaker anchor and remained unresolved.

## v8 follow-up: historical cue-tail replay

A second scan of the same fixed 158-chat / 939-message snapshot counted unresolved quote prefixes without emitting their text. It found 3,273 unresolved spans whose immediate pre-quote text ended in a colon. This is not safe evidence by itself: the same shape is used for character labels, status fields, and strategy headings, and the frontend baseline explicitly keeps an unlisted `Name: “quote”` unresolved. The implementation therefore does not relax that boundary.

The same scan found high-frequency vocal predicates. The v8 change adds only those direct speech forms and keeps gesture-only forms such as `点头` and `冷笑` excluded. It also fixes greedy suffix parsing that could split `低声道` into a longer guessed name plus `道`.

On a same-digest, unscoped replay (158 chats / 939 assistant messages / 18,169 pages), v7 to v8 changed:

- Confirmed attributed pages: 425 → 462 (+37).
- Unresolved candidate pages: 5,747 → 5,710 (-37).
- Unique unresolved quote spans: 4,797 → 4,759 (-38).
- Added-cue-attributed utterance spans, cumulative: 89 → 128 (+39). The v8-only additions accounted for 39: `尖叫` 24, `怒吼` 8, `咆哮` 6, `低声道` 1; other newly added cues had no recovered spans in this snapshot.
- Candidate denominator stayed 6,172. Source digest stayed `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`.

The original 74 targeted tests passed before the v8 expansion; the expanded suite also passed 74/74 after it. Replay is still coverage-only with no gold labels, and the direct-cue change is a modest improvement, not evidence that the title classifier is broadly accurate. The remaining unresolved items mostly lack an allowed direct speaker anchor; making those rare would require changing the explicit ambiguity policy or adding authored speaker labels, not continuing to guess from adjacent actions.

Accept only if the new direct-cue cases are recognized, all negative cases stay fail-closed, body pagination remains identical, the source digest is unchanged, and replay reports the cue-specific attributed span count and unique unresolved-span count separately. Do not count speculative gesture/action matches as a recovery.
