# Galgame Original-Backend Custom-Frontend Implementation Audit

> Audit date: 2026-07-24
> Scope: custom player, administrator app, shared adapters, external modules,
> docs, tests, and build outputs.

## Current Conclusion

The previous native-first contraction went too far: it treated the original
SillyTavern UI as the player play surface. That has been corrected. The current
target is original SillyTavern backend/runtime authority plus a custom Galgame
player UI. Custom code must not request model generation directly, parse a
custom story protocol, advance parallel story state, or store player story
progress.

## Entry

- `/game/` renders title art, title text, three play buttons, and a custom
  Galgame stage shell.
- Start, Continue, and Load enter the custom stage in `/game/`. They must not
  navigate to the original SillyTavern UI as the normal player path.
- Start prioritizes the bound original SillyTavern `chatSeedId` and displays
  that chat seed as the opening scene. Continue and Load read the latest
  original chat for the bound character.
- The custom stage can display original chat messages and save player input
  back through original chat APIs. If the current display is the seed chat, the
  first player input is saved into a new original chat session so the seed is
  not overwritten. This is a chat read/write/display bridge only.
- Full automatic generation is not bridged. Under the current freeze there is
  no confirmed clean entry that delegates original `Generate()` without copying
  it, depending on original frontend globals, or calling bottom model
  generation endpoints.
- No administrator, story-management, model, prompt, preset, character-card, or
  world-book terminology appears in the player UI.

## Calling Chain

- Player code does not import a narrative runtime.
- Player code does not import `SillyTavernAdapter`.
- Player code calls SillyTavern APIs only through
  `SillyTavernOriginalChatBridge`.
- `SillyTavernAdapter` is read-only and administrator-facing.
- The adapter exposes health, character list, world book list, settings, and
  original-resource existence diagnostics only.
- The adapter has no `continueSession`, prompt composition, model payload, or
  generation endpoint.
- `SillyTavernOriginalChatBridge` calls only `/api/characters/chats`,
  `/api/chats/get`, and `/api/chats/save`.
- Administrator resource diagnostics also check the bound `chatSeedId` through
  the original character chat list and reject missing seed references.
- No custom player runtime path calls `/api/backends/*/generate`,
  `/api/novelai/generate`, `/api/characters/get`, or `/api/worldinfo/get`.

## State And Saves

- Custom player story saves have been removed.
- `SaveStore` has been removed from shared storage.
- Original SillyTavern chats are the only play progress authority.
- Shared storage still supports active entry metadata, local settings, and
  media endpoint configuration.

## Protocol Boundary

- `protocol.js` keeps entry metadata validation, original-resource reference
  validation, release metadata, asset URL resolution, and media request helpers.
- `SceneResult`, model-output normalization, state reduction, runtime profile
  matching, and frontend narrative state helpers have been removed.
- Story entry validation still rejects frontend-authored lines, choices, jumps,
  state changes, variables, relationships, and inventory.

## External Modules

- `external-modules/narrative-gateway/**` has been removed.
- `external-modules/game-config-service/**` remains as optional active-entry
  metadata service.
- `external-modules/media-gateway/**` remains as optional provider-neutral media
  task service.
- External modules must not request or advance story text.

## Failure Policy

The custom player currently has an original chat read/write/display path, but no
active story generation path. If the original chat bridge is unavailable, the
player remains in the custom stage and sees a recoverable not-ready state. If
the opening chat seed is missing or empty, the UI shows the same recoverable
state rather than an empty success prompt. If player input is saved, the UI
shows the saved original chat message and, while the latest original chat still
ends with the player's message, shows a recoverable waiting state with a refresh
action. It does not reopen free input until an original reply is available. There
is no local story fallback.

Media failure remains non-blocking because media is outside story authority.

## Verification Policy

Current completion evidence must use:

- Static syntax and DOM checks.
- Real browser player entry, custom stage, and route-isolation check.
- Admin resource DOM and mocked original-resource pass/reject checks.
- Read-only SillyTavern resource diagnostics when a local original service is
  available.
- Frozen boundary checks.

Do not use a custom live-generation path as evidence for this architecture. A
valid future generation test must prove that any runtime bridge delegates to
original SillyTavern chat/context/generation behavior rather than constructing
an independent prompt or `SceneResult` flow.

## Frozen Boundary

Frozen SillyTavern backend/original frontend files must remain untouched:

- `src/**`
- `server.js`
- `plugins.js`
- `config.yaml`
- root `package.json` / `package-lock.json`
- original `public/index.html`, `public/script.js`, `public/style.css`
