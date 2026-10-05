# Galgame process supervisor

The optional loopback service on `127.0.0.1:8790` backs the player **Reset**
button. It checks the fixed core services on ports 8000, 8791, 8795, and 8798.
If a core port is not listening, it starts only that service from the
repository's existing launcher (or starts SillyTavern with `node server.js`).
The presentation analysis service on port 8801 is checked and reported under
`diagnostics.presentationAnalysis`; if it is not listening or is running without
an analyzer, Reset starts it using the fixed
`external-modules/presentation-analysis-service/StartGalgamePresentationAnalysisService.cmd`
launcher. The launcher reads only the server-side semantic planner provider
settings from the configured local `.env.local`, passes them to the isolated
loopback process, and never logs the key. Its status is optional and never
changes the response's core `ok` or `accepted` state. If no provider
configuration is available, it reports `running-unconfigured`; provider
readiness is diagnostic only.

The supervisor does not stop a process merely because its health endpoint is
unhealthy. A runtime
bridge explicitly marked as both stale and pending, and not stopping, is the
only exception: the existing bridge launcher restarts that timed-out bridge.
An ordinary pending generation is never restarted.

The recovery endpoint accepts one fixed protocol, has no arbitrary command or
PID input, binds only to loopback, and permits browser requests only from the
local SillyTavern/Galgame origins. Recovery logs contain service names and
health states only, including the optional analyzer's ready/configured
booleans; they never contain provider keys or chat content.

Project-owned Windows launchers live under
external-modules/process-supervisor/launchers/. Start the complete local stack
with .\external-modules\process-supervisor\launchers\Start_Galgame_All.bat.
The services-only launcher targets an already-running SillyTavern on port 8001;
its health verifier requires the config proof issuer and bridge proof verifier
to report configured before returning success.
The Origin/header check is a browser CSRF guard, not user authentication. The
manager is a single-user loopback utility and exposes only this bounded,
fixed-service recovery operation; it is not intended for a shared or remote
deployment.

Install a current-user logon task so the browser has a manager available even
after Windows restarts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\external-modules\process-supervisor\InstallGalgameProcessSupervisor.ps1
```

The scheduled task runs with the current user's interactive limited token. To
remove it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\external-modules\process-supervisor\UninstallGalgameProcessSupervisor.ps1
```

The task can be started again from Task Scheduler without touching SillyTavern
chats or player saves. When an already-listening service fails its health
probe, Reset reports the remaining issue and preserves that process for
diagnosis instead of force-killing it.

## One-click shutdown

`POST /v1/shutdown` accepts only `galgame.process-supervisor-shutdown.v1` from
the local player origin. It returns 409 and retains every service unless the
runtime bridge is reachable and explicitly reports `pending=false`, `stale=false`,
and `stopping=false`. The bridge first grants a short shutdown lease that blocks
new generation and competing stop requests. On acceptance, the supervisor sends
202 with per-service `scheduled` states, then shuts down asynchronously. The UI
polls `GET /v1/shutdown/{operationId}` and may close its current tab only after a
final receipt confirms every requested service is stopped or already stopped.
Query failures, partial shutdown, or timeouts keep the page open and report
failure. The 8790 process supervisor is reported as `kept-running` so a later
player reset can restart the game services. Receipts retain in-progress
operations and keep at most the 32 most recent completed operations for five
minutes. The bridge shutdown lease expires after 60 seconds; health, generation,
and gate routes lazily clear an expired lease so a crashed supervisor cannot
leave generation permanently blocked. While shutdown runs, the supervisor
renews the lease every 15 seconds through `POST /v1/shutdown-gate/renew` using
the same owner `gateId`. The bridge renews only a matching, unexpired lease and
continues rejecting generation and stop requests. If renewal fails, the
supervisor aborts its shutdown executor, waits for it to stop, records
`SHUTDOWN_GATE_RENEWAL_FAILED`, and does not release a lease it can no longer
prove it owns.

The shutdown allowlist terminates Node processes only when strict argument
parsing proves the complete script entry is a registered absolute path under
this checkout. SillyTavern's relative `server.js` form is eligible only with
exactly that script argument and either an exact registered launcher parent or
an exited parent plus a native read-only process query proving the current
directory equals this checkout root. Before selection, the same held process
handle must confirm process creation time, image path, and command line; the
verified handle is also used for termination, avoiding PID reuse between check
and stop. A live untrusted parent or failed/unsupported CWD, architecture,
permission, or identity query is reported as ambiguous failure; it is never
treated as already stopped or terminated. Chrome processes are eligible only
when their complete `--user-data-dir` is the dedicated original-runtime-bridge
profile. Fixed service-port listener PIDs are used only to detect an active
listener that did not pass the strict process-identity check; an unverified
owner or listener-query failure marks that service ambiguous and fails closed.
A port PID is never added to the termination target list. Process names,
substring matches, and browser-supplied data never authorize termination.
Accepted shutdown uses forced termination after the bridge generation gate and
cannot be rolled back.
`Start.bat` and the project service launchers use a hidden bootstrap; service
output remains in `.codex-longrun` logs. The player requests closure of only its
current tab; if the browser denies that request, only that tab is replaced with
a simple “已关闭” screen.
