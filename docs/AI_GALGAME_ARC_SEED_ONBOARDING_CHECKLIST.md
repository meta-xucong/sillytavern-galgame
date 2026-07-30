# AI Galgame Arc Seed Onboarding Checklist

Status: C1.3 seed import and binding document.

This checklist records the safe process for connecting Lucifer Arc opening
chats after they exist as real SillyTavern chats. It must not be used to copy,
rename, or fabricate chat seeds from another Arc.

## Current Truth

- `lucifer-arc1` is publishable and binds `galgame-imported-lucifer-seed`.
- `lucifer-arc2`, `lucifer-arc3`, and `lucifer-arc4` now bind independent
  original SillyTavern opening chats imported from the provided World-Forge
  Lucifer draft materials:
  - `lucifer-arc2`: `galgame-imported-lucifer-arc2-seed`
  - `lucifer-arc3`: `galgame-imported-lucifer-arc3-seed`
  - `lucifer-arc4`: `galgame-imported-lucifer-arc4-seed`
- Import evidence: `.codex-longrun/evidence/lucifer-arc-seed-import.json`.
- Seed listing evidence: `.codex-longrun/evidence/lucifer-arc-seed-watch.json`.
- Administrator publish/rollback evidence:
  `.codex-longrun/evidence/admin-release-rollback.json`.
- Arc1-Arc4 worldbook bundle references exist, but `runtimeApplied` for
  worldbook/preset/instruct/system/context remains deferred/unbridged.
- The custom frontend must not supply local opening text, local story nodes, or
  local fallback dialogue for missing Arc seeds.

## Required Inputs Per Arc

For each future Arc or replacement seed that should become publishable, the
administrator must provide:

- `arcId`: for example `lucifer-arc2`.
- `chatSeedId`: the exact original SillyTavern chat file id.
- `characterRef`: the original SillyTavern character name and avatar.
- `worldBookRefs`: the already imported Arc bundle, for example
  `Galgame_Imported_Lucifer_Arc2_Bundle`.
- Preset/context references: generation preset, instruct preset, system prompt,
  and context preset by existing SillyTavern names.

The chat seed must be a real SillyTavern chat for the bound character. It must
not be a renamed seed from another Arc unless the administrator intentionally
authored it as a distinct original chat through SillyTavern and records the
source mapping.

## Safe Binding Steps

1. Read-only list the target character chats from SillyTavern.
2. Confirm the requested `chatSeedId` exists in that list.
3. Confirm the seed opens and contains at least one visible original chat line.
4. Update only the ArcBindingV1 reference fields:
   `status`, `sillyTavernBindings.target.chatSeedId`, and any reference ids that
   already exist in SillyTavern.
5. Rebuild `public/game` and `public/game-admin` from `frontend/**`.
6. Publish that Arc through the administrator publish path.

The read-only helper can be used as the first check:

```powershell
node frontend\tools\lucifer-arc-seed-watch.mjs --base-url http://127.0.0.1:8001
```

This helper only reports current resource availability. It does not mutate
SillyTavern resources or update Arc bindings.

## Required Evidence

Each newly publishable Arc must have evidence for:

- Read-only original resource diagnostic: character, worldbook bundle, preset,
  instruct, system, context, and `chatSeedId` all exist.
- Administrator publish accepts the selected Arc.
- Draft/missing seed variant is still rejected.
- Trusted config-service proof is issued only for the active release/Arc/chat.
- Original runtime bridge writes the reply to the target chat.
- Non-target chats remain unchanged.
- Player browser smoke renders the selected Arc through the custom UI.
- Old saves remain bound to their original release/Arc/chat after switching or
  rollback.

## No-Claim Rules

Do not claim any Arc is publishable until the above evidence exists. Do not show
player-facing buttons for unbridged capabilities such as regenerate, undo,
swipe, group mode, native Quick Reply, or runtime-applied preset/worldbook
switching.
