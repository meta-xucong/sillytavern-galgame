# Original Runtime Bridge

This optional local service delegates custom Galgame continuation to the original SillyTavern frontend runtime.

It does not compose prompts, read character/world-book bodies, call bottom model generation endpoints directly, or store model credentials. It opens the original SillyTavern page in an isolated browser process, selects the bound original character/chat, calls the original runtime generate function, and returns the updated original chat.

## Start

For this repository's local Galgame setup, prefer the root script:

```powershell
.\external-modules\process-supervisor\launchers\StartGalgameServices.cmd
```

It starts the config service and this bridge with the same local proof secret,
targets an already-running SillyTavern instance at `http://127.0.0.1:8001`,
and replaces stale local bridge/config-service processes before starting fresh
ones. For the complete local stack, use
`external-modules/process-supervisor/launchers/Start_Galgame_All.bat`, which
starts SillyTavern at port 8001 and configures its services for that instance.

```powershell
$env:SILLYTAVERN_BASE_URL = 'http://127.0.0.1:8001'
$env:GALGAME_SILLYTAVERN_BASE_URL = 'http://127.0.0.1:8001'
$env:GALGAME_ALLOWED_ORIGINS = 'http://127.0.0.1:8001'
$env:GALGAME_BRIDGE_PROOF_SECRET = '<runtime proof signing secret>'
node external-modules\original-runtime-bridge\server.mjs
```

The root startup scripts read the same local proof-secret file without putting
the value in command arguments or logs. Missing or empty proof configuration
fails closed; the config service health endpoint reports
`runtimeProof.configured=false` and the issuer returns 503. The bridge health
endpoint reports `proofRequired=true`; generation rejects every request when
the proof secret is absent. The bridge never reads the SillyTavern API key.

Default URL: `http://127.0.0.1:8795`

If `HOST` is set to a non-loopback address, `GALGAME_BRIDGE_TOKEN` is required and requests must use `Authorization: Bearer ...`. CORS is only browser-origin filtering and is not treated as authentication.

## Player Build

Build `/game/` with:

```powershell
$env:GALGAME_ORIGINAL_RUNTIME_BRIDGE_URL = 'http://127.0.0.1:8795'
node frontend\build-static.mjs
```

The player page only calls `/v1/generate-reply` with an original character avatar and original chat id.

Generation requests also need a short-lived `galgame.original-runtime-bridge-proof.v1` binding proof. The proof is signed outside the browser with `GALGAME_BRIDGE_PROOF_SECRET`, covers audience, expiry, nonce, release, Arc, target character/group, and allowed chat ids, and is verified by the bridge before original `Generate()` is called. Plain client-supplied release/Arc/chat JSON is treated as an index only, not authorization.

Operations can sign a binding reference JSON with:

```powershell
$env:GALGAME_BRIDGE_PROOF_SECRET = '<runtime proof signing secret>'
node external-modules\original-runtime-bridge\sign-proof.mjs --binding .\binding.json
```

Never put `GALGAME_BRIDGE_PROOF_SECRET`, `GALGAME_BRIDGE_TOKEN`, API keys, or model credentials in static frontend files.

## Boundary

Allowed:

- Run independently from the SillyTavern backend.
- Use the original SillyTavern frontend runtime as the approved generation authority.
- Return original chat snapshots for Galgame display.
- Verify signed release/Arc/target/chat binding proofs and reject expired, replayed, forged, arbitrary, or cross-target requests.
- Stop safely through `/v1/stop`, request original runtime stop for pending generation, return explicit `forced` / `stopMode` / `pendingTaskFailed` diagnostics on timeout, fail the in-flight request instead of returning a fabricated success, then reject new generation tasks until the process is restarted.

An outer CDP evaluation timeout also marks the bridge `recoveryRequired=true`
and `ready=false`. The timed-out renderer may have completed a chat write without
returning its result, so this process rejects another generation rather than
reusing ambiguous browser state. The player Reset flow replaces only this
isolated bridge process and Chrome profile. After recovery, the player syncs the
exact original chat before offering another generation, preventing duplicate
player messages or assistant replies.

The process supervisor uses `/v1/shutdown-gate` to acquire a 60-second owner
lease before shutting down the fixed service allowlist. During a long shutdown,
it renews through `POST /v1/shutdown-gate/renew` with the same `gateId` and
`galgame.original-runtime-shutdown-gate.v1` protocol. Renewals are accepted only
for the current, unexpired owner while no generation or stop request is
admitted. Lease loss causes the supervisor to cancel its shutdown executor and
fail closed; it never releases a lease whose ownership could not be confirmed.

Forbidden:

- Modify `src/**`, `server.js`, `plugins.js`, original `public/script.js`, or original `public/index.html`.
- Call `/api/backends/*/generate` or `/api/novelai/generate` from the custom player.
- Copy `Generate()` into the custom frontend.
- Add local scripted story text, choices, branches, endings, or plot state.
- Accept unsigned frontend-provided allowlist JSON as authorization.
