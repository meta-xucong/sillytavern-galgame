# LLM-aware reset and recovery TaskSpec

## Goal and frozen scope

The user reports a persistent `部分连接异常` state and says the player reset button has not recovered the application. Make reset diagnose the actual failure class, safely replace the runtime bridge when a recoverable LLM transport failure is confirmed, and report readiness after recovery. Preserve SillyTavern chat/save content and never restart the original SillyTavern server as part of this LLM-only recovery.

Non-goals: retry or rewrite a story response; alter chat JSONL, save data, story content, or visual assets; restart a bridge during an active/pending generation; restart on provider HTTP errors that indicate a bad key/model or an upstream application error; modify any SillyTavern-owned source.

## Baseline and risk

- Baseline HEAD: `c59b194f6f8ebb663f2cd24a5fdc257cc5ec93e9`.
- The working tree was already broadly dirty before this task. Preserve every pre-existing change and untracked file. In particular, this task begins after the separately completed Node `--use-env-proxy` bridge-launch adjustment; do not overwrite it.
- D0 / I2 / A1. D0: intended reset behavior and safety boundary are explicit. I2: supervisor probes, bridge lifecycle, launcher environment, browser reset flow, and asynchronous process replacement interact. A1: recovery and original-runtime preservation require cross-module audit.
- Current evidence: all fixed service health endpoints and the browser-origin recovery request are reachable. The player UI showed `部分连接异常` because its generation slot retained a failed generation (`这一段暂时没接上`), while service slots were connected and LLM was not yet checked. A real click on the existing reset button cleared that generation failure, ran its checks, restored the bound chat display, and produced `连接正常` with `LLM 可用`.
- Root design gap: the process supervisor restarts a core process when its port is absent and restarts the bridge only for stale-pending or `recoveryRequired` states. It does not treat the LLM transport as part of recovery. A live bridge can report healthy while its provider request path is unusable, so reset can only reprobe and leave the actual cause unchanged.

## Required behavior

1. On explicit player reset, the supervisor probes configured LLM health only when the bridge is reachable, ready, idle, and not stopping/stale. The probe uses the bridge's existing `/v1/llm-health` contract; it does not expose credentials.
2. If the LLM result is a transport-level failure (`LLM_UPSTREAM_UNREACHABLE` or `LLM_UPSTREAM_TIMEOUT`), the supervisor may replace only the verified runtime bridge process and its dedicated Chrome profile. Before replacement it must acquire the bridge's existing shutdown gate, which fences new generation admissions; a refused/busy gate means no process replacement. The hidden launcher must verify that the shutdown gate is active and the bridge is idle, non-stale, and not stopping before terminating it.
3. Provider HTTP responses such as 401/403/404/429/5xx are diagnostics, not automatic restart signals. Report them without an unbounded restart loop.
4. After a bridge replacement, wait boundedly for a fresh bridge-ready health result before checking LLM health again. If the bridge is still starting, return a pending diagnostic so the player can finish its own bounded readiness polling and perform a fresh LLM check instead of accepting the previous process's failure. Return only a redacted diagnostic.
5. If process recovery is not needed, the reset still reprobes core services and LLM. It must preserve generation/chat state according to existing behavior.
6. The player reset request timeout must exceed the bounded supervisor LLM/recovery work. Supervisor transport errors and rejected recovery requests must remain visible as stable, non-sensitive error codes instead of collapsing to an unexplained `null`.

## Allowed files

- `external-modules/process-supervisor/server.mjs`
- `external-modules/process-supervisor/test.mjs`
- `external-modules/process-supervisor/StartGalgameHiddenNode.ps1` (preserve all pre-existing edits; add only the supervisor-issued, safe LLM recovery gate)
- `external-modules/process-supervisor/README.md` (preserve all pre-existing edits)
- `frontend/shared/src/process-supervisor-adapter.js` and its focused test
- `frontend/player/src/main.js` (reset request timeout and consumption of supervisor LLM diagnostic)
- `public/game/**` only for exact player build outputs changed from those sources
- This TaskSpec and current behavior summaries in the three baseline Galgame specs.

No public player bundle change is expected. No original SillyTavern-owned path, chat data, credential field, or browser storage may be changed.

## Acceptance evidence

- Unit/integration test: idle healthy bridge + transport LLM failure causes only a targeted bridge recovery; LLM HTTP application errors do not restart; pending/stopping bridge never restarts; LLM health success causes no restart; post-restart LLM failure is reported.
- Unit test: the player recovery adapter preserves bounded HTTP/unavailable error codes, and the UI timeout is longer than the supervisor's bounded recovery probe.
- Existing process-supervisor tests pass.
- Existing reset UI continues to clear transient generation failure, rerun health probes, and reproject only the already bound chat.
- Live reset response reports service and LLM health without credential values; after recovery, player UI visibly shows connected services and current LLM result.
- `git diff --check` passes. Original SillyTavern frozen paths and chat JSONL files remain unchanged.
- Independent read-only Audit returns PASS before this task is accepted.

## Implementation and audit ledger

Implemented in this task:

- The production supervisor now probes the bridge's existing LLM health route. It replaces only the exact runtime bridge after `LLM_UPSTREAM_UNREACHABLE` or `LLM_UPSTREAM_TIMEOUT`, and only after acquiring the bridge shutdown gate. The launcher verifies the gate and bridge idle state before replacement.
- Provider HTTP failures remain diagnostics and do not restart. LLM fields are allowlisted and sanitized; credentials and upstream response bodies are excluded.
- The one-shot restart signal reaches the existing hidden bridge launcher, which rechecks bridge safety and removes that signal before starting the replacement process.
- The player recovery adapter now returns stable failure classes rather than `null`, uses a 70-second bounded request timeout (above the combined bounded probe/restart/post-probe budget), and reuses the supervisor's LLM result when available. A pending bridge diagnostic is not treated as final; after its readiness polling the player performs a fresh LLM check. UI health probing and bound-chat-only content recovery remain otherwise unchanged.
- Focused tests cover transport restart, HTTP non-restart, healthy bridge, gate-refusal admission race, pending/stopping bridge, post-restart result, probe redaction, adapter HTTP/network/timeout/protocol failures, and the launcher safety gate.

Independent read-only audit: **PASS**. The auditor specifically rechecked generation-admission fencing, launcher shutdown-gate enforcement, pending post-restart state, lease release on startup timeout, and the no-key/no-chat-data boundary.

Verification completed:

- `node external-modules/process-supervisor/test.mjs` — pass.
- `node --test frontend/shared/tests/process-supervisor-adapter.test.mjs` — pass.
- `node --check external-modules/process-supervisor/server.mjs`, `node --check frontend/player/src/main.js`, and `git diff --check` — pass.
- Real foreground player reset at `http://127.0.0.1:8001/game/` completed with `连接正常 · 酒馆 已连接 · 配置 已连接 · 运行桥 已连接 · 视觉 已连接 · LLM 可用`.
- Existing service processes on 8001, 8791, 8795, 8798, and 8801 remained running; only the 8790 supervisor process was reloaded to apply its source update.
- No SillyTavern-owned source or chat JSONL/player save data was changed.
