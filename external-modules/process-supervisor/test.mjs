import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProcessSupervisor, launchVisualService, PROCESS_SUPERVISOR_SERVICE_PORTS, PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL, PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS, validateShutdownServices } from './server.mjs';
import { createOriginalRuntimeBridgeServer } from '../original-runtime-bridge/server.mjs';
import { classifySillyTavernProcess, commandLineHasExactPathArgument, commandLineHasExactRelativeServerEntry, commandLineHasExactUserDataDir, commandLineHasStrictAbsoluteNodeScriptEntry, commandLineHasStrictNodeScriptEntry, commandLineHasStrictRelativeServerEntry, createShutdownTargetPaths, matchesSillyTavernProcess } from './shutdown-contract.mjs';

const names = ['sillyTavern', 'configService', 'runtimeBridge', 'visualService'];
assert.deepEqual(PROCESS_SUPERVISOR_SERVICE_PORTS, { sillyTavern: 8000, configService: 8791, runtimeBridge: 8795, visualService: 8798 });
const visualProbePorts = [];
const alreadyRunningVisual = await launchVisualService({
    tcpListenerProbe: async (port) => { visualProbePorts.push(port); return true; },
    spawnProcess: () => { throw new Error('visual service must not spawn when the registered port is already listening'); },
});
assert.deepEqual(visualProbePorts, [PROCESS_SUPERVISOR_SERVICE_PORTS.visualService], 'visual idempotence must probe the registered 8798 port');
assert.deepEqual(alreadyRunningVisual, { started: false, alreadyRunning: true });
let defaultVisualProviderPath = '';
const visualFallbackLaunch = await launchVisualService({
    tcpListenerProbe: async () => false,
    providerEnv: {},
    providerConfigReader: (filePath) => { defaultVisualProviderPath = filePath; return { valid: false }; },
    fileExists: (filePath) => String(filePath).endsWith('StartGalgameVisualAssetService.cmd'),
    spawnProcess: () => ({ unref() {} }),
});
assert.equal(path.basename(defaultVisualProviderPath), '.env.local', 'supervisor defaults to the repository-local private provider config');
assert.deepEqual(visualFallbackLaunch, { started: true });
const shutdownPaths = createShutdownTargetPaths('C:\\repo\\SillyTavern');
assert.equal(commandLineHasExactPathArgument('"C:\\Program Files\\nodejs\\node.exe" "C:\\repo\\SillyTavern\\external-modules\\original-runtime-bridge\\server.mjs"', shutdownPaths.runtimeBridge), true);
assert.equal(commandLineHasExactPathArgument('node.exe C:\\repo\\SillyTavern\\external-modules\\original-runtime-bridge\\server.mjs.backup', shutdownPaths.runtimeBridge), false, 'a longer lookalike path is never a process match');
assert.equal(commandLineHasExactPathArgument('node.exe external-modules\\original-runtime-bridge\\server.mjs', shutdownPaths.runtimeBridge), false, 'relative paths never match');
assert.equal(commandLineHasStrictNodeScriptEntry('node.exe "C:\\repo\\SillyTavern\\server.js"', 'C:\\Program Files\\nodejs\\node.exe', shutdownPaths.sillyTavern), true, 'an absolute SillyTavern entry is matched as the complete Node script argument');
assert.equal(commandLineHasStrictNodeScriptEntry('node.exe other.js C:\\repo\\SillyTavern\\server.js', 'C:\\Program Files\\nodejs\\node.exe', shutdownPaths.sillyTavern), false, 'a SillyTavern path elsewhere in a different script argv is never kill eligible');
assert.equal(commandLineHasStrictNodeScriptEntry('node.exe --inspect C:\\repo\\SillyTavern\\server.js', 'C:\\Program Files\\nodejs\\node.exe', shutdownPaths.sillyTavern), false, 'flags and extra arguments are not accepted for the ST process role');
assert.equal(commandLineHasStrictAbsoluteNodeScriptEntry('node.exe other.js C:\\repo\\SillyTavern\\server.js', 'C:\\Program Files\\nodejs\\node.exe', shutdownPaths.sillyTavern), false);
assert.equal(classifySillyTavernProcess({ name: 'node.exe', executablePath: 'C:\\Program Files\\nodejs\\node.exe', commandLine: 'node.exe other.js C:\\repo\\SillyTavern\\server.js' }, shutdownPaths), 'no-match', 'a repo path passed as a data argument is never a server role match');
assert.equal(matchesSillyTavernProcess({
    name: 'node.exe', commandLine: 'node.exe server.js', parentName: 'cmd.exe',
    parentCommandLine: 'cmd.exe /c "C:\\repo\\SillyTavern\\Start.bat"',
}, shutdownPaths), true, 'the default Start.bat launch is matched only with its exact checkout parent');
assert.equal(matchesSillyTavernProcess({
    name: 'node.exe', commandLine: 'node.exe server.js', parentName: 'cmd.exe',
    parentCommandLine: 'cmd.exe /d /c "C:\\repo\\SillyTavern\\external-modules\\process-supervisor\\launchers\\StartGalgameServerHidden.cmd"',
}, shutdownPaths), true, 'the hidden Start.bat helper is an exact repository-owned equivalent parent');
assert.equal(matchesSillyTavernProcess({
    name: 'node.exe', commandLine: 'node.exe server.js', parentName: 'cmd.exe',
    parentCommandLine: 'cmd.exe /c "C:\\repo\\SillyTavern-copy\\Start.bat"',
}, shutdownPaths), false, 'a sibling checkout cannot be terminated');
assert.equal(matchesSillyTavernProcess({
    name: 'node.exe', commandLine: 'node.exe server.js', parentName: 'powershell.exe',
    parentCommandLine: 'powershell.exe -Command Start.bat',
}, shutdownPaths), false, 'relative server entry without the exact cmd parent cannot be terminated');
assert.equal(commandLineHasExactRelativeServerEntry('node.exe server.js.bak'), false);
const legacyRelativeNode = {
    name: 'node.exe',
    executablePath: 'C:\\Program Files\\nodejs\\node.exe',
    commandLine: 'node.exe "C:\\Program Files\\nodejs\\node.exe" server.js',
    parentName: '',
    parentAvailable: false,
    parentQuerySucceeded: true,
    currentDirectoryQuerySucceeded: true,
};
assert.equal(commandLineHasStrictRelativeServerEntry(legacyRelativeNode.commandLine, legacyRelativeNode.executablePath), true);
assert.equal(classifySillyTavernProcess({ ...legacyRelativeNode, currentDirectory: 'C:\\repo\\SillyTavern' }, shutdownPaths), 'match', 'an orphan relative server.js node is eligible only when its true current directory equals this repo');
assert.equal(classifySillyTavernProcess({ ...legacyRelativeNode, currentDirectory: 'C:\\repo\\OtherSillyTavern' }, shutdownPaths), 'no-match', 'a relative server.js process from another checkout is never selected');
assert.equal(classifySillyTavernProcess({ ...legacyRelativeNode, currentDirectoryQuerySucceeded: false }, shutdownPaths), 'ambiguous', 'failed CWD query is surfaced as ambiguous instead of already-stopped');
assert.equal(matchesSillyTavernProcess({ ...legacyRelativeNode, currentDirectoryQuerySucceeded: false }, shutdownPaths), false, 'an ambiguous legacy process is never kill eligible');
assert.equal(classifySillyTavernProcess({ ...legacyRelativeNode, parentAvailable: true, currentDirectory: 'C:\\repo\\SillyTavern' }, shutdownPaths), 'ambiguous', 'a live but untrusted parent prevents CWD fallback');
assert.equal(commandLineHasStrictRelativeServerEntry('node.exe --inspect server.js', legacyRelativeNode.executablePath), false, 'extra process arguments prevent legacy fallback');
const allowlistScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shutdown-allowlist.ps1');
if (process.platform === 'win32') {
    const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'galgame-shutdown-cwd-'));
    const repoFixture = path.join(fixtureDir, 'repo');
    const otherFixture = path.join(fixtureDir, 'other');
    const fixtureEntries = [
        ['configService', path.join(repoFixture, 'external-modules', 'game-config-service', 'server.mjs')],
        ['runtimeBridge', path.join(repoFixture, 'external-modules', 'original-runtime-bridge', 'server.mjs')],
        ['visualService', path.join(repoFixture, 'external-modules', 'visual-asset-service', 'server.mjs')],
        ['presentationAnalysis', path.join(repoFixture, 'external-modules', 'presentation-analysis-service', 'server.mjs')],
    ];
    mkdirSync(repoFixture);
    mkdirSync(otherFixture);
    for (const [, entry] of fixtureEntries) {
        mkdirSync(path.dirname(entry), { recursive: true });
        writeFileSync(entry, 'setInterval(() => {}, 1000);\n');
    }
    writeFileSync(path.join(repoFixture, 'server.js'), 'setInterval(() => {}, 1000);\n');
    const fixtureProcesses = [];
    try {
        fixtureProcesses.push(spawn(process.execPath, ['server.js'], { cwd: repoFixture, stdio: 'ignore', windowsHide: true }));
        for (const [, entry] of fixtureEntries) fixtureProcesses.push(spawn(process.execPath, [entry], { cwd: repoFixture, stdio: 'ignore', windowsHide: true }));
        const processIds = fixtureProcesses.map((child) => child.pid);
        assert.ok(processIds.every(Boolean), 'temporary Node fixture processes started');
        await new Promise((resolve) => setTimeout(resolve, 300));
        const readSnapshot = (processId) => {
            const processInfo = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${processId}\"; $p | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n='CreationDate';e={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress`], { encoding: 'utf8' });
            assert.equal(processInfo.status, 0, processInfo.stderr);
            const snapshot = JSON.parse(processInfo.stdout.trim());
            assert.equal(snapshot.Name.toLowerCase(), 'node.exe');
            return snapshot;
        };
        const realSnapshots = processIds.map(readSnapshot);
        const runFixture = (targetRepo, { forceQueryFailure = false, unsupportedArchitecture = false, parentQuerySucceeded = true, processes = realSnapshots, portListeners = [], portListenerQuerySucceeded = true } = {}) => {
            const fixturePath = path.join(fixtureDir, 'fixture.json');
            writeFileSync(fixturePath, JSON.stringify({
                repoRoot: targetRepo,
                portListeners,
                portListenerQuerySucceeded,
                processes: processes.map((snapshot, index) => ({
                    ...snapshot,
                    parentAvailable: false,
                    parentQuerySucceeded: index === 0 ? parentQuerySucceeded : true,
                    forceCurrentDirectoryQueryFailure: index === 0 && forceQueryFailure,
                    forceUnsupportedArchitecture: index === 0 && unsupportedArchitecture,
                    processMachine: 0,
                    nativeMachine: unsupportedArchitecture ? 0xaa64 : 0x8664,
                })),
            }));
            const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', allowlistScript, '-Preview', '-FixturePath', fixturePath], {
                encoding: 'utf8', env: { ...process.env, GALGAME_SUPERVISOR_REPO_ROOT: targetRepo },
            });
            assert.equal(result.error, undefined, result.error?.message);
            assert.ok([0, 2].includes(result.status), result.stderr || `unexpected PowerShell exit ${result.status}`);
            return JSON.parse(result.stdout.trim());
        };
        const sameRepo = runFixture(repoFixture);
        assert.equal(sameRepo.services.sillyTavern.status, 'would-stop', `repo-root CWD fixture is selected by dry preview: ${JSON.stringify(sameRepo)}`);
        assert.equal(sameRepo.services.sillyTavern.repoCurrentDirectoryMatchCount, 1);
        for (const [serviceName] of fixtureEntries) assert.equal(sameRepo.services[serviceName].status, 'would-stop', `${serviceName} target is selected through a verified same-process handle`);
        const identifiedOwner = runFixture(repoFixture, { portListeners: [{ LocalPort: 8791, OwningProcess: processIds[1] }] });
        assert.equal(identifiedOwner.services.configService.status, 'would-stop', 'a service listener owned by a strict, held-handle identity remains a recognized target');
        assert.equal(identifiedOwner.services.configService.ambiguousCount, undefined);
        const unclassifiedPid = 910000;
        const unreadableListenerOwner = runFixture(repoFixture, {
            processes: [{ Name: 'node.exe', ProcessId: unclassifiedPid, ParentProcessId: 1, ExecutablePath: '', CommandLine: '', CreationDate: new Date().toISOString() }],
            portListeners: [{ LocalPort: 8791, OwningProcess: unclassifiedPid }],
        });
        assert.equal(unreadableListenerOwner.services.configService.status, 'failed', 'an occupied service port with unreadable CIM command line is never reported as already-stopped');
        assert.equal(unreadableListenerOwner.services.configService.ambiguousReasons[0], 'PORT_OWNER_PROCESS_IDENTITY_UNVERIFIED');
        assert.equal(unreadableListenerOwner.services.configService.remainingCount, 1);
        assert.equal(unreadableListenerOwner.services.sillyTavern.status, 'already-stopped', 'an unknown owner of the config port does not contaminate SillyTavern status');
        const queryFailure = runFixture(repoFixture, { portListenerQuerySucceeded: false });
        assert.equal(queryFailure.services.configService.status, 'failed', 'listener query errors fail closed for that service');
        const unboundOtherProcess = runFixture(repoFixture, {
            processes: [{ Name: 'node.exe', ProcessId: unclassifiedPid, ParentProcessId: 1, ExecutablePath: '', CommandLine: '', CreationDate: new Date().toISOString() }],
        });
        assert.equal(unboundOtherProcess.services.configService.status, 'already-stopped', 'an unidentified process without a target service listener is not misclassified as that service');
        const otherRepo = runFixture(otherFixture);
        assert.equal(otherRepo.services.sillyTavern.status, 'already-stopped', 'another checkout is never selected');
        assert.equal(otherRepo.services.sillyTavern.repoCurrentDirectoryMatchCount, 0);
        const unverifiable = runFixture(repoFixture, { forceQueryFailure: true });
        assert.equal(unverifiable.services.sillyTavern.status, 'failed', 'failed CWD query cannot be reported as already-stopped');
        assert.equal(unverifiable.services.sillyTavern.errorCode, 'PROCESS_IDENTITY_AMBIGUOUS');
        assert.equal(unverifiable.ok, false);
        const unsupported = runFixture(repoFixture, { unsupportedArchitecture: true });
        assert.equal(unsupported.services.sillyTavern.status, 'failed', 'unknown process architecture cannot be reported as already-stopped');
        assert.equal(unsupported.services.sillyTavern.ambiguousReasons[0], 'UNSUPPORTED_PROCESS_ARCHITECTURE');
        const parentQueryFailed = runFixture(repoFixture, { parentQuerySucceeded: false });
        assert.equal(parentQueryFailed.services.sillyTavern.status, 'failed', 'parent identity query failures are independent of the PowerShell host PID');
        const stillRunning = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@( ${processIds.join(',')} ) | ForEach-Object { Get-Process -Id $_ -ErrorAction Stop | Out-Null }`], { encoding: 'utf8' });
        assert.equal(stillRunning.status, 0, 'all dry-preview and fail-closed fixtures leave temporary Node processes untouched');
        const terminateFixturePath = path.join(fixtureDir, 'terminate-fixture.json');
        writeFileSync(terminateFixturePath, JSON.stringify({
            repoRoot: repoFixture,
            portListeners: [],
            portListenerQuerySucceeded: true,
            processes: realSnapshots.map((snapshot) => ({ ...snapshot, parentAvailable: false, parentQuerySucceeded: true })),
        }));
        const terminated = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', allowlistScript, '-TerminateFixtureProcesses', '-FixturePath', terminateFixturePath], {
            encoding: 'utf8', env: { ...process.env, GALGAME_SUPERVISOR_REPO_ROOT: repoFixture },
        });
        assert.equal(terminated.status, 0, terminated.stderr || terminated.stdout || `fixture termination exited ${terminated.status}`);
        const terminationReceipt = JSON.parse(terminated.stdout.trim());
        for (const serviceName of ['sillyTavern', ...fixtureEntries.map(([serviceName]) => serviceName)]) {
            assert.equal(terminationReceipt.services[serviceName].status, 'stopped', `${serviceName} is terminated through its verified handle`);
        }
    } finally {
        for (const fixtureProcess of fixtureProcesses) {
            if (fixtureProcess.pid && fixtureProcess.exitCode === null && fixtureProcess.signalCode === null) {
                try { fixtureProcess.kill(); } catch { /* the test child already exited */ }
                await Promise.race([once(fixtureProcess, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
            }
        }
        rmSync(fixtureDir, { recursive: true, force: true });
    }
}
assert.equal(commandLineHasExactUserDataDir('chrome.exe --user-data-dir="C:\\repo\\SillyTavern\\.codex-longrun\\original-runtime-bridge-chrome-claude"', shutdownPaths.runtimeBridgeChrome), true);
assert.equal(commandLineHasExactUserDataDir('chrome.exe --user-data-dir="C:\\repo\\SillyTavern\\.codex-longrun\\original-runtime-bridge-chrome-claude-other"', shutdownPaths.runtimeBridgeChrome), false, 'other Chrome profiles are never matched');
const fullShutdownServices = Object.fromEntries(PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.map((name) => [name, { status: name === 'processSupervisor' ? 'kept-running' : 'already-stopped' }]));
assert.equal(validateShutdownServices(fullShutdownServices, 'final'), true);
assert.equal(validateShutdownServices({ processSupervisor: { status: 'kept-running' } }, 'final'), false, 'missing required service keys fail closed');
assert.equal(validateShutdownServices({}, 'final'), false, 'an empty shutdown status never validates');
assert.equal(validateShutdownServices({ ...fullShutdownServices, mystery: { status: 'stopped' } }, 'final'), false, 'unknown service keys fail closed');
assert.equal(validateShutdownServices({ ...fullShutdownServices, visualService: { status: 'done' } }, 'final'), false, 'unknown service status values fail closed');
const repoRootForLauncherAudit = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
for (const relativePath of [
    'external-modules/process-supervisor/launchers/Start_Galgame_All.ps1',
    'external-modules/process-supervisor/launchers/VerifyGalgameServices.ps1',
    'external-modules/process-supervisor/launchers/StartGalgameVisualAssetService.cmd',
    'external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.cmd',
    'external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.ps1',
    path.join('external-modules', 'process-supervisor', 'server.mjs'),
    path.join('external-modules', 'presentation-analysis-service', 'StartGalgamePresentationAnalysisService.ps1'),
]) {
    const source = readFileSync(path.join(repoRootForLauncherAudit, relativePath), 'utf8');
    assert.doesNotMatch(source, /[A-Z]:[\\/]/, `${relativePath} must not embed a machine-specific provider path`);
}
const shutdownScriptPath = path.join(repoRootForLauncherAudit, 'external-modules', 'process-supervisor', 'shutdown-allowlist.ps1');
const cmdExecutablePath = 'C:\\Windows\\System32\\cmd.exe';
const startBatchPath = path.join(repoRootForLauncherAudit, 'Start.bat');
const hiddenServerLauncherPath = path.join(repoRootForLauncherAudit, 'external-modules', 'process-supervisor', 'launchers', 'StartGalgameServerHidden.cmd');
const runLauncherParser = (commandLine, currentDirectory = repoRootForLauncherAudit) => {
    const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', shutdownScriptPath,
        '-TestLauncherCommandParser', '-TestCommandLine', commandLine,
        '-TestExecutablePath', cmdExecutablePath, '-TestCurrentDirectory', currentDirectory,
    ], { encoding: 'utf8', env: { ...process.env, GALGAME_SUPERVISOR_REPO_ROOT: repoRootForLauncherAudit } });
    assert.equal(result.status, 0, result.stderr || 'PowerShell launcher parser fixture failed');
    return JSON.parse(result.stdout.trim());
};
assert.equal(runLauncherParser(`"${cmdExecutablePath}" /c "${startBatchPath}"`), true, 'only a direct /c invocation of the exact Start.bat is recognized');
assert.equal(runLauncherParser(`"${cmdExecutablePath}" /d /c ""${hiddenServerLauncherPath}" --galgame-hidden-child"`), true, 'the hidden wrapper requires its exact child sentinel');
assert.equal(runLauncherParser(`"${cmdExecutablePath}" /c echo ${startBatchPath}`), false, 'mentioning Start.bat after echo is not an executable launcher');
assert.equal(runLauncherParser(`"${cmdExecutablePath}" /c type ${startBatchPath}`), false, 'mentioning Start.bat after type is not an executable launcher');
assert.equal(runLauncherParser(`"${cmdExecutablePath}" /c "${startBatchPath}" --arbitrary`), false, 'extra command arguments are rejected');
assert.equal(runLauncherParser(`"${cmdExecutablePath}" /c "${startBatchPath.replace('SillyTavern', 'SillyTavern-copy')}"`), false, 'a sibling checkout launcher is rejected');
assert.equal(runLauncherParser(`"${cmdExecutablePath}" /c "${startBatchPath}"`, path.join(repoRootForLauncherAudit, 'other-checkout')), false, 'an otherwise valid launcher outside this repository CWD is rejected');
const launcherFiles = [
    'external-modules/process-supervisor/launchers/Start_Galgame_All.bat',
    'external-modules/process-supervisor/launchers/StartGalgameConfigService.cmd', 'external-modules/process-supervisor/launchers/StartGalgameRuntimeBridge.cmd', 'external-modules/process-supervisor/launchers/StartGalgameVisualAssetService.cmd',
    'external-modules/process-supervisor/launchers/StartGalgameServices.cmd', 'external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.cmd', 'external-modules/presentation-analysis-service/StartGalgamePresentationAnalysisService.cmd',
];
for (const relativePath of launcherFiles) {
    const source = readFileSync(path.join(repoRootForLauncherAudit, relativePath), 'utf8');
    assert.doesNotMatch(source, /start\s+""\s+\/min\s+cmd\s+\/c/i, `${relativePath} must not retain a minimized cmd host`);
    assert.match(source, /run-hidden\.vbs" "%~f0" --galgame-hidden-child/i, `${relativePath} exits after launching its hidden child`);
}
const rootStart = readFileSync(path.join(repoRootForLauncherAudit, 'Start.bat'), 'utf8');
const hiddenServerStart = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/launchers/StartGalgameServerHidden.cmd'), 'utf8');
const hiddenBootstrap = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/run-hidden.vbs'), 'utf8');
assert.match(rootStart, /call npm install --no-save[\s\S]*?node server\.js %\*[\s\S]*?pause/i, 'the original SillyTavern Start.bat remains untouched');
assert.doesNotMatch(rootStart, /run-hidden|StartGalgameServerHidden/i, 'custom hidden launchers never replace the frozen upstream Start.bat');
assert.match(hiddenServerStart, /Start\.bat/i, 'the custom launcher delegates dependency setup and startup to the frozen upstream launcher');
assert.match(hiddenServerStart, /run-hidden\.vbs" "%~f0" --galgame-hidden-child/i, 'direct server launcher hides its own console');
assert.doesNotMatch(hiddenServerStart, /npm install|package-lock\.json/i, 'custom launcher does not run package installation against the frozen root lockfile');
assert.doesNotMatch(hiddenServerStart, /\bpause\b/i);
const allServicesLauncher = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/launchers/Start_Galgame_All.bat'), 'utf8');
assert.match(allServicesLauncher, /start-galgame-all\.log/i, 'the all-services launcher records output and failures to its log');
assert.match(allServicesLauncher, /exit \/b %EXIT_CODE%/i, 'the hidden child returns its PowerShell exit code');
assert.doesNotMatch(allServicesLauncher, /\bpause\b/i, 'the supported all-services launcher never leaves an interactive console open');
const allServicesPowerShell = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/launchers/Start_Galgame_All.ps1'), 'utf8');
assert.match(allServicesPowerShell, /Failures\.Count -gt 0[\s\S]*?exit 1/i, 'startup health failures produce a non-zero exit code');
assert.match(allServicesPowerShell, /required runtime proof configuration is unavailable[\s\S]*?exit 1/i, 'all-services launcher fails before startup when its proof secret is missing');
assert.match(allServicesPowerShell, /runtimeProof\.configured -eq \$true/);
assert.match(allServicesPowerShell, /body\.ready -eq \$true/);
assert.match(allServicesPowerShell, /body\.proofRequired -eq \$true -and \$body\.proofConfigured -eq \$true/, 'all-services health rejects a bridge with an unconfigured proof secret');
assert.match(allServicesPowerShell, /analyzerConfigured -eq \$true/);
assert.match(allServicesPowerShell, /function Launch-Batch/);
assert.match(allServicesPowerShell, /Launch-Batch 'presentation' 'external-modules\\presentation-analysis-service\\StartGalgamePresentationAnalysisService\.cmd'/);
assert.doesNotMatch(allServicesPowerShell, /Set-Env 'GALGAME_PRESENTATION_ANALYZER_API_KEY'/, 'the all-services launcher never exports the visual provider key to sibling services');
assert.match(allServicesPowerShell, /Set-Env 'GALGAME_BRIDGE_PROOF_SECRET' ''[\s\S]*?Launch-Batch 'presentation'/, 'the runtime proof secret is cleared before presentation and visual services are launched');
const servicesHealthVerifier = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/launchers/VerifyGalgameServices.ps1'), 'utf8');
assert.match(servicesHealthVerifier, /runtimeProof\.configured -eq \$true/, 'services-only health requires the config proof issuer to be configured');
assert.match(servicesHealthVerifier, /proofRequired -eq \$true -and \$body\.proofConfigured -eq \$true/, 'services-only health distinguishes required proof from an actually configured bridge secret');
assert.match(hiddenBootstrap, /shell\.Run commandLine, 0, False/i, 'the double-click bootstrap hides the child console and exits without waiting');
const hiddenLauncher = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/StartGalgameHiddenNode.ps1'), 'utf8');
assert.match(hiddenLauncher, /Start-Process[\s\S]*?-WindowStyle Hidden[\s\S]*?-RedirectStandardOutput[\s\S]*?-RedirectStandardError/);
const analysisLauncher = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/presentation-analysis-service/StartGalgamePresentationAnalysisService.ps1'), 'utf8');
assert.match(analysisLauncher, /Start-Process[\s\S]*?-WindowStyle Hidden[\s\S]*?-RedirectStandardOutput[\s\S]*?-RedirectStandardError/);
assert.match(hiddenLauncher, /Get-CimInstance Win32_Process -ErrorAction Stop/);
assert.match(hiddenLauncher, /Stop-Process -Id \$_.ProcessId -Force -ErrorAction Stop/);
assert.match(analysisLauncher, /Get-CimInstance Win32_Process -ErrorAction Stop/);
assert.match(analysisLauncher, /Stop-Process -Id \$_.ProcessId -Force -ErrorAction Stop/);
const supervisorInstaller = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/InstallGalgameProcessSupervisor.ps1'), 'utf8');
assert.match(supervisorInstaller, /System32\\wscript\.exe/i, 'scheduled supervisor task launches through hidden Windows Script Host');
assert.match(supervisorInstaller, /run-hidden-wait\.vbs/i);
assert.match(supervisorInstaller, /New-ScheduledTaskTrigger -AtLogOn/);
const hiddenWaitLauncher = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/run-hidden-wait.vbs'), 'utf8');
assert.match(hiddenWaitLauncher, /shell\.Run\(commandLine, 0, True\)/i, 'the scheduled task remains attached to the hidden supervisor process');
assert.match(hiddenWaitLauncher, /WScript\.Quit exitCode/i, 'scheduled-task restart policy receives the child process exit code');
const shutdownScript = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/shutdown-allowlist.ps1'), 'utf8');
assert.doesNotMatch(shutdownScript, /process-supervisor\\server\.mjs/i, 'the recovery supervisor entry is never included in the termination allowlist');
assert.match(shutdownScript, /Get-NetTCPConnection -State Listen -ErrorAction Stop/i, 'listener ownership is discovered so unidentifiable active services fail closed');
assert.match(shutdownScript, /PORT_OWNER_PROCESS_IDENTITY_UNVERIFIED/);
assert.doesNotMatch(shutdownScript, /TerminateProcess\([^\n]*OwningProcess|Stop-Process\s+-Id\s+\$listener\.OwningProcess|taskkill/i, 'a listening port PID is never an eligible termination target');
assert.match(shutdownScript, /Test-ExactLauncherCommand \$parent @\(\$targets\.startBatch,\$targets\.sillyTavernHiddenLauncher\)/i);
assert.match(shutdownScript, /Get-CimInstance Win32_Process -ErrorAction Stop/g);
assert.match(shutdownScript, /CommandLineToArgvW/);
assert.match(shutdownScript, /OpenIdentity\(\[int\]\$item\.ProcessId\)/);
assert.match(shutdownScript, /QueryFullProcessImageName/);
assert.match(shutdownScript, /CreationFileTime/);
assert.match(shutdownScript, /GalgameVerifiedHandle\.Terminate\(\)/);
assert.doesNotMatch(shutdownScript, /Stop-Process\s+-Id/i, 'every shutdown target is terminated only through its verified held handle');
assert.match(shutdownScript, /parentQuerySucceeded/);
assert.match(shutdownScript, /IsWow64Process2/);
assert.match(shutdownScript, /IMAGE_FILE_MACHINE_AMD64/);
const visualTestScript = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.ps1'), 'utf8');
assert.match(visualTestScript, /\$serverCommandPattern\s*=\s*'\(\?i\).*\[regex\]::Escape\(\$resolvedServerScript\.Replace/i);
assert.match(visualTestScript, /Get-CimInstance Win32_Process -ErrorAction Stop[\s\S]*?Stop-Process -Id \$_.ProcessId -Force -ErrorAction Stop/i);
assert.match(visualTestScript, /Start-Process[\s\S]*?-WindowStyle Hidden[\s\S]*?-RedirectStandardOutput \$stdoutLog[\s\S]*?-RedirectStandardError \$stderrLog[\s\S]*?-PassThru/i);
assert.match(visualTestScript, /Invoke-WebRequest[\s\S]*?\$body\.ok -eq \$true/i, 'the hidden analyzer launcher retains its health confirmation');
const visualAnalyzerCmd = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.cmd'), 'utf8');
assert.match(visualAnalyzerCmd, /if defined GALGAME_VISUAL_PROVIDER_ENV_FILE if exist "%GALGAME_VISUAL_PROVIDER_ENV_FILE%" goto launch_hidden/i);
const visualAssetCmd = readFileSync(path.join(repoRootForLauncherAudit, 'external-modules/process-supervisor/launchers/StartGalgameVisualAssetService.cmd'), 'utf8');
assert.match(visualAssetCmd, /run-hidden\.vbs" "%~f0" --galgame-hidden-child[\s\S]*?if defined GALGAME_VISUAL_PROVIDER_ENV_FILE if exist "%GALGAME_VISUAL_PROVIDER_ENV_FILE%" goto start_controlled_visual_service/i, 'custom provider-env configuration remains behind the hidden launcher bootstrap');
assert.throws(() => createProcessSupervisor({ listenerHost: '0.0.0.0' }), /PROCESS_SUPERVISOR_LOOPBACK_ONLY/);
const readyOptionalProbes = { presentationAnalysis: async () => ({ reachable: true, healthy: true, analyzerConfigured: true }) };
const probes = Object.fromEntries(names.map((name) => [name, async () => ({ reachable: false, healthy: false })]));
const launches = [];
const server = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes,
    optionalProbes: readyOptionalProbes,
    startupConfirmationTimeoutMs: 0,
    launcher: async (name) => { launches.push(name); return { started: true }; },
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
try {
    const blocked = await fetch(`${baseUrl}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    assert.equal(blocked.status, 403);
    assert.deepEqual(launches, []);

    const recovered = await fetch(`${baseUrl}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    assert.equal(recovered.status, 200);
    const body = await recovered.json();
    assert.equal(body.ok, false);
    assert.equal(body.accepted, true);
    assert.deepEqual(launches, names);
    assert.deepEqual(Object.keys(body.services), names);

    const retiredOrigin = await fetch(`${baseUrl}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8001', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    assert.equal(retiredOrigin.status, 403);

    const runningProbes = Object.fromEntries(names.map((name) => [name, async () => ({ reachable: true, healthy: true })]));
    const runningServer = createProcessSupervisor({
        allowedOrigins: ['http://127.0.0.1:8000'],
        probes: runningProbes,
        optionalProbes: readyOptionalProbes,
        startupConfirmationTimeoutMs: 0,
        launcher: async () => assert.fail('A healthy listening service must not be restarted.'),
    });
    await new Promise((resolve) => runningServer.listen(0, '127.0.0.1', resolve));
    try {
        const noRestart = await fetch(`http://127.0.0.1:${runningServer.address().port}/v1/recover`, {
            method: 'POST',
            headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
            body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
        });
        assert.equal(noRestart.status, 200);
        assert.ok(Object.values((await noRestart.json()).services).every((entry) => entry.status === 'running'));
    } finally {
        await new Promise((resolve) => runningServer.close(resolve));
    }
} finally {
    await new Promise((resolve) => server.close(resolve));
}

const staleLaunches = [];
const staleProbes = Object.fromEntries(names.map((name) => [name, async () => name === 'runtimeBridge'
    ? { reachable: true, healthy: false, stale: true, pending: true, stopping: false }
    : { reachable: true, healthy: true }]));
const staleServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: staleProbes,
    optionalProbes: readyOptionalProbes,
    startupConfirmationTimeoutMs: 0,
    launcher: async (name) => { staleLaunches.push(name); return { started: true }; },
});
await new Promise((resolve) => staleServer.listen(0, '127.0.0.1', resolve));
try {
    const recoveredStale = await fetch(`http://127.0.0.1:${staleServer.address().port}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    const staleResult = await recoveredStale.json();
    assert.deepEqual(staleLaunches, ['runtimeBridge']);
    assert.equal(staleResult.services.runtimeBridge.restarted, true);
} finally {
    await new Promise((resolve) => staleServer.close(resolve));
}

const generatingProbes = Object.fromEntries(names.map((name) => [name, async () => name === 'runtimeBridge'
    ? { reachable: true, healthy: false, stale: false, pending: true, stopping: false }
    : { reachable: true, healthy: true }]));
const generatingServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: generatingProbes,
    optionalProbes: readyOptionalProbes,
    startupConfirmationTimeoutMs: 0,
    launcher: async () => assert.fail('A live generation must not be restarted.'),
});
await new Promise((resolve) => generatingServer.listen(0, '127.0.0.1', resolve));
try {
    const duringGeneration = await fetch(`http://127.0.0.1:${generatingServer.address().port}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    const generationResult = await duringGeneration.json();
    assert.equal(generationResult.services.runtimeBridge.status, 'running-unhealthy');
    assert.equal(generationResult.services.runtimeBridge.started, false);
} finally {
    await new Promise((resolve) => generatingServer.close(resolve));
}

const optionalLaunches = [];
const coreHealthyProbes = Object.fromEntries(names.map((name) => [name, async () => ({ reachable: true, healthy: true })]));
const optionalOfflineServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: coreHealthyProbes,
    optionalProbes: { presentationAnalysis: async () => ({ reachable: false, healthy: false, errorCode: 'PROCESS_NOT_LISTENING' }) },
    startupConfirmationTimeoutMs: 0,
    launcher: async (name) => { optionalLaunches.push(name); return { started: true }; },
});
await new Promise((resolve) => optionalOfflineServer.listen(0, '127.0.0.1', resolve));
try {
    const response = await fetch(`http://127.0.0.1:${optionalOfflineServer.address().port}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true, 'An offline optional analyzer must not mark core health abnormal.');
    assert.equal(body.accepted, true, 'An offline optional analyzer must not reject core recovery.');
    assert.deepEqual(optionalLaunches, ['presentationAnalysis'], 'Only the fixed analyzer launcher may be started.');
    assert.deepEqual(body.diagnostics.presentationAnalysis, {
        status: 'starting', reachable: false, serviceReady: false, analyzerConfigured: false, errorCode: '',
    });
} finally {
    await new Promise((resolve) => optionalOfflineServer.close(resolve));
}

let analyzerConfigured = false;
const unconfiguredOptionalServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: coreHealthyProbes,
    optionalProbes: { presentationAnalysis: async () => ({ reachable: true, healthy: true, analyzerConfigured }) },
    startupConfirmationTimeoutMs: 100,
    startupProbeIntervalMs: 1,
    launcher: async (name) => {
        assert.equal(name, 'presentationAnalysis');
        analyzerConfigured = true;
        return { started: true };
    },
});
await new Promise((resolve) => unconfiguredOptionalServer.listen(0, '127.0.0.1', resolve));
try {
    const response = await fetch(`http://127.0.0.1:${unconfiguredOptionalServer.address().port}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.diagnostics.presentationAnalysis, {
        status: 'ready', reachable: true, serviceReady: true, analyzerConfigured: true, errorCode: '',
    }, 'A reachable but unconfigured analyzer is reloaded from the fixed provider configuration.');
} finally {
    await new Promise((resolve) => unconfiguredOptionalServer.close(resolve));
}

console.log('process supervisor recovery tests passed');

const shutdownCalls = [];
const shutdownSafeServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: coreHealthyProbes,
    optionalProbes: readyOptionalProbes,
    bridgeShutdownGate: async () => ({ ok: true, gateId: 'test-gate', pending: false, stale: false, stopping: false }),
    bridgeShutdownHealthProbe: async () => ({ available: true, shutdownGate: true, pending: false, stale: false, stopping: false }),
    shutdownExecutor: async ({ operationId, gateId }) => {
        shutdownCalls.push([operationId, gateId]);
        return { ok: true, services: Object.fromEntries(['sillyTavern', 'configService', 'runtimeBridge', 'visualService', 'presentationAnalysis', 'runtimeBridgeChrome'].map((name) => [name, { status: 'already-stopped', stoppedCount: 0 }] ).concat([['processSupervisor', { status: 'kept-running' }]])) };
    },
    bridgeShutdownGateRelease: async () => true,
    shutdownDelayMs: 5,
});
await new Promise((resolve) => shutdownSafeServer.listen(0, '127.0.0.1', resolve));
try {
    const rejectedOrigin = await fetch(`http://127.0.0.1:${shutdownSafeServer.address().port}/v1/shutdown`, {
        method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
        body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }),
    });
    assert.equal(rejectedOrigin.status, 403, 'shutdown accepts only the configured player origin');
    const invalidPayload = await fetch(`http://127.0.0.1:${shutdownSafeServer.address().port}/v1/shutdown`, {
        method: 'POST', headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
        body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL, pid: 123 }),
    });
    assert.equal(invalidPayload.status, 400, 'browser-supplied process identifiers are rejected');
    const accepted = await fetch(`http://127.0.0.1:${shutdownSafeServer.address().port}/v1/shutdown`, {
        method: 'POST', headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
        body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }),
    });
    assert.equal(accepted.status, 202);
    const acceptance = await accepted.json();
    assert.equal(acceptance.accepted, true);
    assert.equal(acceptance.services.runtimeBridge.status, 'scheduled');
    assert.equal(acceptance.services.processSupervisor.status, 'kept-running');
    assert.deepEqual(shutdownCalls, [], 'the shutdown executor cannot run before the HTTP response is delivered');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(shutdownCalls, [[acceptance.operationId, 'test-gate']], 'shutdown is scheduled after the response finishes and receives the gate lease');
    const receipt = await fetch(`http://127.0.0.1:${shutdownSafeServer.address().port}/v1/shutdown/${acceptance.operationId}`, { headers: { Origin: 'http://127.0.0.1:8000', 'X-Galgame-Shutdown': '1' } });
    assert.equal(receipt.status, 200);
    const completed = await receipt.json();
    assert.equal(completed.complete, true);
    assert.equal(completed.ok, true);
    assert.equal(completed.services.processSupervisor.status, 'kept-running');
} finally {
    await new Promise((resolve) => shutdownSafeServer.close(resolve));
}

let failedOperationReleased = false;
const partialShutdownServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    bridgeShutdownGate: async () => ({ ok: true, gateId: 'partial-gate', pending: false, stale: false, stopping: false }),
    bridgeShutdownHealthProbe: async () => ({ available: true, shutdownGate: true, pending: false, stale: false, stopping: false }),
    shutdownExecutor: async () => ({
        ok: false,
        errorCode: 'UNTRUSTED_EXECUTOR_ERROR_CODE',
        services: { sillyTavern: { status: 'failed', errorCode: 'PROCESS_STILL_RUNNING' }, processSupervisor: { status: 'kept-running' } },
    }),
    bridgeShutdownGateRelease: async (gateId) => { failedOperationReleased = gateId === 'partial-gate'; return true; },
    shutdownDelayMs: 0,
});
await new Promise((resolve) => partialShutdownServer.listen(0, '127.0.0.1', resolve));
try {
    const accepted = await fetch(`http://127.0.0.1:${partialShutdownServer.address().port}/v1/shutdown`, {
        method: 'POST', headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
        body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }),
    });
    assert.equal(accepted.status, 202);
    const operation = await accepted.json();
    let receipt;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        receipt = await fetch(`http://127.0.0.1:${partialShutdownServer.address().port}/v1/shutdown/${operation.operationId}`, {
            headers: { Origin: 'http://127.0.0.1:8000', 'X-Galgame-Shutdown': '1' },
        }).then((response) => response.json());
        if (receipt.complete) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(receipt.complete, true);
    assert.equal(receipt.ok, false, 'a partial shutdown receipt never reports success');
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.errorCode, 'SHUTDOWN_PARTIAL_FAILURE', 'unknown executor error values are normalized to a known failure');
    assert.equal(receipt.services.sillyTavern.status, 'failed');
    assert.equal(failedOperationReleased, true, 'failed shutdown releases its bridge gate');
} finally {
    await new Promise((resolve) => partialShutdownServer.close(resolve));
}

let operationNow = 10_000;
let operationSequence = 0;
const boundedReceiptServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    bridgeShutdownGate: async () => ({ ok: true, gateId: `gate-${++operationSequence}`, pending: false, stale: false, stopping: false }),
    bridgeShutdownHealthProbe: async () => ({ available: true, shutdownGate: true, pending: false, stale: false, stopping: false }),
    shutdownExecutor: async () => ({ ok: true, services: fullShutdownServices }),
    shutdownOperationLimit: 2,
    shutdownOperationTtlMs: 2_000,
    now: () => operationNow,
    shutdownDelayMs: 0,
});
await new Promise((resolve) => boundedReceiptServer.listen(0, '127.0.0.1', resolve));
try {
    const base = `http://127.0.0.1:${boundedReceiptServer.address().port}`;
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
        const response = await fetch(`${base}/v1/shutdown`, {
            method: 'POST', headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
            body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }),
        });
        assert.equal(response.status, 202);
        const accepted = await response.json();
        ids.push(accepted.operationId);
        let receipt;
        for (let attempt = 0; attempt < 30; attempt += 1) {
            receipt = await fetch(`${base}/v1/shutdown/${accepted.operationId}`, { headers: { Origin: 'http://127.0.0.1:8000', 'X-Galgame-Shutdown': '1' } }).then((item) => item.json());
            if (receipt.complete) break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(receipt.complete, true);
        assert.equal(receipt.ok, true);
    }
    const statusUrl = (id) => `${base}/v1/shutdown/${id}`;
    const headers = { Origin: 'http://127.0.0.1:8000', 'X-Galgame-Shutdown': '1' };
    assert.equal((await fetch(statusUrl(ids[0]), { headers })).status, 404, 'only the oldest completed receipt is evicted after exceeding the bounded recent limit');
    assert.equal((await fetch(statusUrl(ids[1]), { headers })).status, 200);
    assert.equal((await fetch(statusUrl(ids[2]), { headers })).status, 200, 'recent completed receipts remain available');
    operationNow += 2_001;
    assert.equal((await fetch(statusUrl(ids[2]), { headers })).status, 404, 'completed receipts expire only after the configured TTL');
} finally {
    await new Promise((resolve) => boundedReceiptServer.close(resolve));
}

let releasePendingShutdown;
let pendingShutdownStarted;
const firstShutdownStarted = new Promise((resolve) => { pendingShutdownStarted = resolve; });
let activeOperationCount = 0;
const activeReceiptServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    bridgeShutdownGate: async () => ({ ok: true, gateId: `active-gate-${Math.random()}`, pending: false, stale: false, stopping: false }),
    bridgeShutdownHealthProbe: async () => ({ available: true, shutdownGate: true, pending: false, stale: false, stopping: false }),
    shutdownExecutor: async () => {
        activeOperationCount += 1;
        if (activeOperationCount === 1) {
            pendingShutdownStarted();
            return new Promise((resolve) => { releasePendingShutdown = resolve; });
        }
        return { ok: true, services: fullShutdownServices };
    },
    shutdownOperationLimit: 1,
    shutdownDelayMs: 0,
});
await new Promise((resolve) => activeReceiptServer.listen(0, '127.0.0.1', resolve));
try {
    const base = `http://127.0.0.1:${activeReceiptServer.address().port}`;
    const headers = { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' };
    const createOperation = async () => {
        const response = await fetch(`${base}/v1/shutdown`, { method: 'POST', headers, body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }) });
        assert.equal(response.status, 202);
        return response.json();
    };
    const pendingOperation = await createOperation();
    await firstShutdownStarted;
    const duplicateOperation = await createOperation();
    assert.equal(duplicateOperation.operationId, pendingOperation.operationId, 'concurrent shutdown requests share one active receipt');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(activeOperationCount, 1, 'a second shutdown never starts a second executor while the first is active');
    const pendingReceipt = await fetch(`${base}/v1/shutdown/${pendingOperation.operationId}`, { headers: { Origin: headers.Origin, 'X-Galgame-Shutdown': '1' } });
    assert.equal(pendingReceipt.status, 200, 'the completed-receipt bound never evicts an in-progress operation');
    assert.equal((await pendingReceipt.json()).complete, false);
    releasePendingShutdown({ ok: true, services: fullShutdownServices });
} finally {
    releasePendingShutdown?.({ ok: true, services: fullShutdownServices });
    await new Promise((resolve) => activeReceiptServer.close(resolve));
}

let leaseClock = 10_000;
let leaseRenewals = 0;
let resolveThreeRenewals;
const threeRenewals = new Promise((resolve) => { resolveThreeRenewals = resolve; });
let resolveLongExecutorStarted;
const longExecutorStarted = new Promise((resolve) => { resolveLongExecutorStarted = resolve; });
let longExecutorCalls = 0;
const leaseBridge = createOriginalRuntimeBridgeServer({
    allowedOrigins: ['http://127.0.0.1:8000'],
    shutdownGateTtlMs: 1_000,
    now: () => leaseClock,
    logger: { warn() {} },
    runtime: {
        getStatus: () => ({ pending: false, stale: false, stopping: false }),
        healthCheck: async () => ({ ok: true, ready: true }),
        isStopping: () => false,
    },
});
await new Promise((resolve) => leaseBridge.listen(0, '127.0.0.1', resolve));
const leaseBridgeUrl = `http://127.0.0.1:${leaseBridge.address().port}`;
const bridgeJsonPost = async (pathName, body) => fetch(`${leaseBridgeUrl}${pathName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const renewalSafeSupervisor = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    shutdownDelayMs: 0,
    shutdownGateRenewIntervalMs: 5,
    bridgeShutdownGate: async () => bridgeJsonPost('/v1/shutdown-gate', {
        protocolVersion: 'galgame.original-runtime-shutdown-gate.v1', action: 'acquire',
    }).then((response) => response.json()),
    bridgeShutdownHealthProbe: async () => fetch(`${leaseBridgeUrl}/health`).then(async (response) => {
        const body = await response.json();
        return { available: response.ok, shutdownGate: body.shutdownGate, pending: body.pending, stale: body.stale, stopping: body.stopping };
    }),
    bridgeShutdownGateRenew: async (gateId) => {
        leaseClock += 750;
        const stopResponse = await bridgeJsonPost('/v1/stop', {});
        const generationResponse = await bridgeJsonPost('/v1/generate-reply', {});
        assert.equal(stopResponse.status, 409, 'the live gate continues blocking stop across renewal cycles');
        assert.equal(generationResponse.status, 503, 'the live gate continues blocking generation across renewal cycles');
        const response = await bridgeJsonPost('/v1/shutdown-gate/renew', {
            protocolVersion: 'galgame.original-runtime-shutdown-gate.v1', action: 'renew', gateId,
        });
        const body = await response.json();
        if (response.ok) {
            leaseRenewals += 1;
            if (leaseRenewals >= 3) resolveThreeRenewals();
        }
        return response.ok && body.renewed === true && body.gateId === gateId;
    },
    bridgeShutdownGateRelease: async (gateId) => bridgeJsonPost('/v1/shutdown-gate/release', {
        protocolVersion: 'galgame.original-runtime-shutdown-gate.v1', action: 'release', gateId,
    }).then((response) => response.ok),
    shutdownExecutor: async () => {
        longExecutorCalls += 1;
        resolveLongExecutorStarted();
        await threeRenewals;
        return { ok: true, services: fullShutdownServices };
    },
});
await new Promise((resolve) => renewalSafeSupervisor.listen(0, '127.0.0.1', resolve));
try {
    const base = `http://127.0.0.1:${renewalSafeSupervisor.address().port}`;
    const headers = { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' };
    const requestShutdown = () => fetch(`${base}/v1/shutdown`, {
        method: 'POST', headers, body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }),
    });
    const first = await requestShutdown();
    assert.equal(first.status, 202);
    const active = await first.json();
    await longExecutorStarted;
    const duplicate = await requestShutdown();
    assert.equal(duplicate.status, 202);
    assert.equal((await duplicate.json()).operationId, active.operationId, 'single-flight remains reserved through lease renewals');
    await threeRenewals;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const receipt = await fetch(`${base}/v1/shutdown/${active.operationId}`, {
            headers: { Origin: headers.Origin, 'X-Galgame-Shutdown': '1' },
        }).then((response) => response.json());
        if (receipt.complete) {
            assert.equal(receipt.ok, true);
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(leaseRenewals, 3);
    assert.ok(leaseClock - 10_000 > 2_000, 'executor remained active across more than two virtual lease lifetimes');
    assert.equal(longExecutorCalls, 1, 'lease renewal never permits a second executor');
    const health = await fetch(`${leaseBridgeUrl}/health`).then((response) => response.json());
    assert.equal(health.shutdownGate, true, 'shutdown gate remains held after repeated owner renewals');
} finally {
    await new Promise((resolve) => renewalSafeSupervisor.close(resolve));
    await new Promise((resolve) => leaseBridge.close(resolve));
}

let renewalFailureAbortedExecutor = false;
let renewalFailureReleasedGate = false;
const renewalFailureServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    shutdownDelayMs: 0,
    shutdownGateRenewIntervalMs: 1,
    bridgeShutdownGate: async () => ({ ok: true, gateId: 'renewal-failure-gate', pending: false, stale: false, stopping: false }),
    bridgeShutdownHealthProbe: async () => ({ available: true, shutdownGate: true, pending: false, stale: false, stopping: false }),
    bridgeShutdownGateRenew: async () => false,
    bridgeShutdownGateRelease: async () => { renewalFailureReleasedGate = true; return true; },
    shutdownExecutor: async ({ signal }) => new Promise((resolve, reject) => {
        const failAfterAbort = () => {
            renewalFailureAbortedExecutor = true;
            reject(new Error('executor cancelled after gate renewal failed'));
        };
        if (signal.aborted) failAfterAbort();
        else signal.addEventListener('abort', failAfterAbort, { once: true });
    }),
});
await new Promise((resolve) => renewalFailureServer.listen(0, '127.0.0.1', resolve));
try {
    const base = `http://127.0.0.1:${renewalFailureServer.address().port}`;
    const accepted = await fetch(`${base}/v1/shutdown`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
        body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }),
    }).then((response) => response.json());
    let receipt;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        receipt = await fetch(`${base}/v1/shutdown/${accepted.operationId}`, {
            headers: { Origin: 'http://127.0.0.1:8000', 'X-Galgame-Shutdown': '1' },
        }).then((response) => response.json());
        if (receipt.complete) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(receipt.complete, true);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.errorCode, 'SHUTDOWN_GATE_RENEWAL_FAILED', 'renewal failure is explicit and fails closed');
    assert.equal(renewalFailureAbortedExecutor, true, 'the shutdown executor receives cancellation on lease loss');
    assert.equal(renewalFailureReleasedGate, false, 'a lost lease is not released by a non-owner');
} finally {
    await new Promise((resolve) => renewalFailureServer.close(resolve));
}

for (const unsafeState of [
    { ok: false, gateId: '', pending: false, stale: false, stopping: false },
    { ok: false, gateId: '', pending: true, stale: false, stopping: false },
    { ok: false, gateId: '', pending: true, stale: true, stopping: false },
    { ok: false, gateId: '', pending: false, stale: false, stopping: true },
]) {
    let executed = false;
    const refusedServer = createProcessSupervisor({
        allowedOrigins: ['http://127.0.0.1:8000'],
        bridgeShutdownGate: async () => unsafeState,
        shutdownExecutor: async () => { executed = true; },
    });
    await new Promise((resolve) => refusedServer.listen(0, '127.0.0.1', resolve));
    try {
        const response = await fetch(`http://127.0.0.1:${refusedServer.address().port}/v1/shutdown`, {
            method: 'POST', headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
            body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL }),
        });
        assert.equal(response.status, 409, 'pending, stale, stopping or unknown bridge state must refuse shutdown');
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(executed, false, 'refused shutdown never reaches the process executor');
    } finally {
        await new Promise((resolve) => refusedServer.close(resolve));
    }
}

let visualHealthy = false;
const startupProbes = Object.fromEntries(names.map((name) => [name, async () => name === 'visualService'
    ? { reachable: visualHealthy, healthy: visualHealthy }
    : { reachable: true, healthy: true }]));
const confirmedLaunchServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: startupProbes,
    optionalProbes: readyOptionalProbes,
    startupConfirmationTimeoutMs: 100,
    startupProbeIntervalMs: 5,
    launcher: async (name) => {
        if (name === 'visualService') visualHealthy = true;
        return { started: true };
    },
});
await new Promise((resolve) => confirmedLaunchServer.listen(0, '127.0.0.1', resolve));
try {
    const response = await fetch(`http://127.0.0.1:${confirmedLaunchServer.address().port}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    const body = await response.json();
    assert.equal(body.services.visualService.status, 'running', 'recovery reports running only after a healthy probe');
    assert.equal(body.services.visualService.started, true);
} finally {
    await new Promise((resolve) => confirmedLaunchServer.close(resolve));
}

let neverHealthy = false;
const timeoutProbes = Object.fromEntries(names.map((name) => [name, async () => name === 'visualService'
    ? { reachable: neverHealthy, healthy: neverHealthy }
    : { reachable: true, healthy: true }]));
const unconfirmedLaunchServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: timeoutProbes,
    optionalProbes: readyOptionalProbes,
    startupConfirmationTimeoutMs: 20,
    startupProbeIntervalMs: 5,
    launcher: async () => ({ started: true }),
});
await new Promise((resolve) => unconfirmedLaunchServer.listen(0, '127.0.0.1', resolve));
try {
    const response = await fetch(`http://127.0.0.1:${unconfirmedLaunchServer.address().port}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    const body = await response.json();
    assert.equal(body.services.visualService.status, 'not-started', 'a dispatched but unhealthy process is not reported as restored');
    assert.equal(body.services.visualService.started, false);
assert.equal(body.services.visualService.errorCode, 'STARTUP_HEALTH_CHECK_TIMEOUT');
assert.equal(body.ok, false);
} finally {
    await new Promise((resolve) => unconfirmedLaunchServer.close(resolve));
}

const unconfirmedAlreadyRunningServer = createProcessSupervisor({
    allowedOrigins: ['http://127.0.0.1:8000'],
    probes: timeoutProbes,
    optionalProbes: readyOptionalProbes,
    startupConfirmationTimeoutMs: 20,
    startupProbeIntervalMs: 5,
    launcher: async () => ({ started: false, alreadyRunning: true }),
});
await new Promise((resolve) => unconfirmedAlreadyRunningServer.listen(0, '127.0.0.1', resolve));
try {
    const response = await fetch(`http://127.0.0.1:${unconfirmedAlreadyRunningServer.address().port}/v1/recover`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
        body: JSON.stringify({ protocolVersion: 'galgame.process-supervisor.v1' }),
    });
    const body = await response.json();
    assert.equal(body.services.visualService.status, 'not-started', 'a TCP listener racing recovery is not healthy until its HTTP probe passes');
    assert.equal(body.services.visualService.started, false);
    assert.equal(body.services.visualService.alreadyRunning, true);
    assert.equal(body.services.visualService.errorCode, 'STARTUP_HEALTH_CHECK_TIMEOUT');
    assert.equal(body.ok, false);
} finally {
    await new Promise((resolve) => unconfirmedAlreadyRunningServer.close(resolve));
}
