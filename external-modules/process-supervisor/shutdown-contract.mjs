import path from 'node:path';

export const SHUTDOWN_SERVICE_KEYS = Object.freeze([
    'sillyTavern', 'configService', 'runtimeBridge', 'visualService',
    'presentationAnalysis', 'runtimeBridgeChrome', 'processSupervisor',
]);

export function createShutdownTargetPaths(repoRoot) {
    const external = path.join(repoRoot, 'external-modules');
    return Object.freeze({
        sillyTavern: path.join(repoRoot, 'server.js'),
        configService: path.join(external, 'game-config-service', 'server.mjs'),
        runtimeBridge: path.join(external, 'original-runtime-bridge', 'server.mjs'),
        visualService: path.join(external, 'visual-asset-service', 'server.mjs'),
        presentationAnalysis: path.join(external, 'presentation-analysis-service', 'server.mjs'),
        runtimeBridgeChrome: path.join(repoRoot, '.codex-longrun', 'original-runtime-bridge-chrome-claude'),
        sillyTavernStartBatch: path.join(repoRoot, 'Start.bat'),
        sillyTavernHiddenLauncher: path.join(repoRoot, 'external-modules', 'process-supervisor', 'launchers', 'StartGalgameServerHidden.cmd'),
    });
}

function normalize(value) {
    return String(value || '').replaceAll('/', '\\').toLowerCase();
}

/** Requires the full, quoted-or-token-delimited absolute argument; substrings and relative paths never match. */
export function commandLineHasExactPathArgument(commandLine, fullPath) {
    const line = normalize(commandLine);
    const target = normalize(fullPath).replace(/^"|"$/g, '');
    if (!line || !target || !/^[a-z]:\\/.test(target)) return false;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[\\s\\\"])${escaped}(?=$|[\\s\\\"])`, 'i').test(line);
}

/** Chrome is eligible only when one complete --user-data-dir argument equals this dedicated profile. */
export function commandLineHasExactUserDataDir(commandLine, profilePath) {
    const line = normalize(commandLine);
    const target = normalize(profilePath).replace(/^"|"$/g, '');
    if (!line || !target || !/^[a-z]:\\/.test(target)) return false;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\s)--user-data-dir(?:=|\\s+)"?${escaped}"?(?=$|\\s)`, 'i').test(line);
}

export function commandLineHasExactRelativeServerEntry(commandLine) {
    const line = normalize(commandLine);
    return /(?:^|[\s"])server\.js(?=$|[\s"])/i.test(line);
}

export function commandLineHasStrictRelativeServerEntry(commandLine, executablePath = '') {
    const args = stripSupportedSillyTavernPortOverride(splitWindowsCommandLine(String(commandLine || '')));
    if (args.length < 2 || args.length > 3 || !/(?:^|\\|\/)node\.exe$/i.test(args[0])) return false;
    if (String(args.at(-1) || '').toLowerCase() !== 'server.js') return false;
    if (args.length === 2) return true;
    const actualExecutable = normalize(executablePath).replace(/^"|"$/g, '');
    return Boolean(actualExecutable && normalize(args[1]).replace(/^"|"$/g, '') === actualExecutable);
}

export function commandLineHasStrictNodeScriptEntry(commandLine, executablePath = '', scriptPath = '') {
    const args = stripSupportedSillyTavernPortOverride(splitWindowsCommandLine(String(commandLine || '')));
    if (args.length < 2 || args.length > 3 || !/(?:^|\\|\/)node\.exe$/i.test(args[0])) return false;
    const executable = normalize(executablePath).replace(/^"|"$/g, '');
    const script = normalize(scriptPath).replace(/^"|"$/g, '');
    let entry;
    if (args.length === 2) entry = args[1];
    else {
        if (!executable || normalize(args[1]).replace(/^"|"$/g, '') !== executable) return false;
        entry = args[2];
    }
    const normalizedEntry = normalize(entry).replace(/^"|"$/g, '');
    return normalizedEntry === 'server.js' || Boolean(script && normalizedEntry === script);
}

export function commandLineHasStrictAbsoluteNodeScriptEntry(commandLine, executablePath = '', scriptPath = '') {
    const args = stripSupportedSillyTavernPortOverride(splitWindowsCommandLine(String(commandLine || '')));
    if (!commandLineHasStrictNodeScriptEntry(commandLine, executablePath, scriptPath) || !scriptPath) return false;
    return normalize(args.at(-1)).replace(/^"|"$/g, '') === normalize(scriptPath).replace(/^"|"$/g, '');
}

function stripSupportedSillyTavernPortOverride(args) {
    const script = String(args.at(-3) || '').replace(/^"|"$/g, '').replaceAll('/', '\\').toLowerCase();
    const isSillyTavernEntry = /(?:^|\\)server\.js$/i.test(script);
    return isSillyTavernEntry && args.at(-2) === '--port' && args.at(-1) === '8001'
        ? args.slice(0, -2)
        : args;
}

export function classifySillyTavernProcess({
    name, commandLine, executablePath = '', parentName = '', parentCommandLine = '',
    parentAvailable = undefined, parentQuerySucceeded = true,
    currentDirectory = '', currentDirectoryQuerySucceeded = false,
}, targets) {
    if (String(name || '').toLowerCase() !== 'node.exe') return 'no-match';
    if (commandLineHasStrictAbsoluteNodeScriptEntry(commandLine, executablePath, targets.sillyTavern)) return 'match';
    if (!commandLineHasStrictRelativeServerEntry(commandLine, executablePath)) return 'no-match';
    if (String(parentName || '').toLowerCase() === 'cmd.exe'
        && (commandLineHasExactPathArgument(parentCommandLine, targets.sillyTavernStartBatch)
            || commandLineHasExactPathArgument(parentCommandLine, targets.sillyTavernHiddenLauncher))) return 'match';
    if (parentQuerySucceeded !== true || parentAvailable === true) return 'ambiguous';
    if (currentDirectoryQuerySucceeded !== true || !String(currentDirectory || '').trim()) return 'ambiguous';
    return normalizeDirectory(currentDirectory) === normalizeDirectory(path.dirname(targets.sillyTavern))
        ? 'match'
        : 'no-match';
}

export function matchesSillyTavernProcess(process, targets) {
    return classifySillyTavernProcess(process, targets) === 'match';
}

function splitWindowsCommandLine(value) {
    const args = [];
    const tokenPattern = /"([^"]*)"|(\S+)/g;
    for (const match of String(value || '').matchAll(tokenPattern)) args.push(match[1] ?? match[2]);
    return args;
}

function normalizeDirectory(value) {
    return path.win32.resolve(String(value || '').replaceAll('/', '\\')).replace(/[\\]+$/, '').toLowerCase();
}
