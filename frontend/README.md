# Galgame Frontend Workspace

This directory is the isolated source workspace for the native-first Galgame
entry layer.

## Directory Map

- `player/`: the custom visual novel player surface. It presents the Galgame
  UI while delegating character, world book, chat, context, and generation
  semantics to original SillyTavern capabilities.
- `admin/`: the separate administrator application for entry metadata,
  original resource reference checks, publishing index, rollback, and media
  endpoint settings.
- `shared/`: release/config helpers, read-only SillyTavern resource diagnostics,
  original chat read/write bridge, storage helpers, and media adapter contracts.
- `build-static.mjs`: copies this isolated source into `public/game/` and
  `public/game-admin/` for static serving.

No file in this directory may modify or import SillyTavern backend code.

## Native-First Boundary

Actual play must stay in the custom `/game/` Galgame UI. Original SillyTavern
remains the backend/runtime authority for resources, chats, context, and
generation semantics; it is not the player-facing UI.

The custom frontend must not:

- call model generation endpoints
- create a custom narrative runtime
- parse model output into custom branches, endings, node jumps, or parallel
  story state
- save authoritative player story progress outside original SillyTavern chats
- provide local story fallback text
- copy original character card or world book bodies

The current allowed player bridge only reads original chat lists, reads chat
messages, saves player input back to original chats, and renders those messages
in the custom Galgame stage. It does not perform automatic generation.

## Local Release Cache

The frontend uses IndexedDB-backed browser storage for active entry metadata
and media endpoint configuration. It does not store player story progress; use
original SillyTavern chats for that.

Shared deployment can use `external-modules/game-config-service/` for active
entry metadata. The endpoint is read from `meta[name="galgame-config-service"]`
or `window.GALGAME_CONFIG_SERVICE_URL`.

## Build

Run from the repository root:

```powershell
node frontend/build-static.mjs
```

The build writes only:

- `public/game/**`
- `public/game-admin/**`

## Checks

Focused checks for the native-first boundary:

```powershell
node frontend/shared/tests/protocol.test.mjs
node frontend/shared/tests/storage.test.mjs
node frontend/shared/tests/sillytavern-adapter.test.mjs
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/browser-smoke-narrow.mjs
```

`frontend/tools/sillytavern-live-check.mjs` is read-only. It checks SillyTavern
connectivity and bound resource existence; it must not send generation
requests.
