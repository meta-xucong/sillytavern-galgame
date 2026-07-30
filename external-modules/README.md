# Galgame External Modules

This directory is reserved for optional services that run outside the
SillyTavern backend.

Rules:

- Do not import or patch SillyTavern backend code.
- Communicate through explicit HTTP or WebSocket contracts.
- Keep secrets in the external service runtime, never in static frontend code.
- Services must be removable without changing SillyTavern.

Current placeholders:

- `game-config-service/`: shared scenario publishing and active release API.
- `media-gateway/`: provider-neutral image and future video task API.
- `original-runtime-bridge/`: user-approved local bridge that delegates
  continuation to the original SillyTavern frontend runtime without copying
  prompt assembly or calling bottom model endpoints from the custom player.
- `visual-asset-service/`: retained visual-asset prototype. It is currently
  paused historical material under the VS-DOCS route and is not started,
  imported by the player, or treated as a production dependency.

Visual asset scope control:

- The current visual route is documented in
  `docs/AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`.
- Existing visual-asset-service and game-config-service projection code is
  retained for traceability, but it is not an active delivery phase. Do not
  continue its matcher, binding, projection or asset work from an old
  reviewer PASS. A new explicit user authorization and code-admission gate is
  required.
- The visual service must remain removable. No SillyTavern backend route,
  original frontend route, startup script, root dependency or player runtime
  may depend on it during the paused docs-only phase.

Removed native-first boundary:

- `narrative-gateway/` was removed. Custom external modules must not request,
  parse, normalize, or advance story text as a parallel Galgame runtime. Actual
  text continuation must come from the original SillyTavern runtime through the
  approved bridge or a future upstream runtime API.
