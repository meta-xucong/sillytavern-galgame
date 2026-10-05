import { cp, mkdir, rm, copyFile, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const buildOutputRoot = path.resolve(repoRoot, process.env.GALGAME_BUILD_OUTPUT_ROOT || 'public');
const defaultBuildOutputRoot = path.join(repoRoot, 'public');
const isBuildStageRoot = path.dirname(buildOutputRoot) === repoRoot
    && /^\.codex-build-stage-[a-z0-9-]+$/iu.test(path.basename(buildOutputRoot));
if (!samePath(buildOutputRoot, defaultBuildOutputRoot) && !isBuildStageRoot) {
    throw new Error('GALGAME_BUILD_OUTPUT_ROOT must be public/ or a top-level .codex-build-stage-* directory.');
}
const buildVersion = process.env.GALGAME_BUILD_VERSION || await createSourceBuildVersion();
const buildConfig = {
    configServiceUrl: process.env.GALGAME_CONFIG_SERVICE_URL || '',
    originalRuntimeBridgeUrl: process.env.GALGAME_ORIGINAL_RUNTIME_BRIDGE_URL || '',
    scriptImportAssistantUrl: process.env.GALGAME_SCRIPT_IMPORT_ASSISTANT_URL || '',
    buildVersion,
    target: process.env.GALGAME_BUILD_TARGET || '',
};

const targets = [
    {
        name: 'player',
        source: path.join(frontendRoot, 'player', 'src'),
        output: path.join(buildOutputRoot, 'game'),
        jsInput: 'main.js',
        jsOutput: 'app.js',
    },
    {
        name: 'admin',
        source: path.join(frontendRoot, 'admin', 'src'),
        output: path.join(buildOutputRoot, 'game-admin'),
        jsInput: 'main.js',
        jsOutput: 'app.js',
    },
];

async function createSourceBuildVersion() {
    const hash = createHash('sha256');
    const roots = [
        path.join(frontendRoot, 'player', 'src'),
        path.join(frontendRoot, 'admin', 'src'),
        path.join(frontendRoot, 'shared', 'src'),
    ];
    for (const root of roots) {
        for (const filePath of await listSourceFiles(root)) {
            hash.update(path.relative(frontendRoot, filePath).replace(/\\/g, '/'));
            hash.update('\0');
            hash.update(await readFile(filePath));
            hash.update('\0');
        }
    }
    return `auto-${hash.digest('hex').slice(0, 12)}`;
}

async function listSourceFiles(root) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listSourceFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

async function copyApp(target) {
    await assertSafeBuildOutputTarget(target.output);
    await rm(target.output, { recursive: true, force: true });
    await mkdir(target.output, { recursive: true });

    const html = await readFile(path.join(target.source, 'index.html'), 'utf8');
    const publicHtml = applyBuildConfig(html.replaceAll('./main.js', './app.js'), buildConfig);
    await writeFile(path.join(target.output, 'index.html'), publicHtml, 'utf8');
    await copyFile(path.join(target.source, 'styles.css'), path.join(target.output, 'styles.css'));

    const js = await readFile(path.join(target.source, target.jsInput), 'utf8');
    const publicJs = versionModuleImports(
        rewriteSharedModulePaths(js),
        buildConfig.buildVersion,
    );
    await writeFile(path.join(target.output, target.jsOutput), publicJs, 'utf8');

    // The application entry is an ES module graph. Copy every sibling source
    // module (except main.js, emitted as app.js) so relative imports in player
    // renderers/adapters resolve in the static build.
    await copyLocalJavaScriptModules(target.source, target.output, target.jsInput, buildConfig.buildVersion, true);

    await cp(path.join(frontendRoot, 'shared', 'src'), path.join(target.output, 'shared'), {
        recursive: true,
        force: true,
    });
    await versionSharedModuleImports(path.join(target.output, 'shared'), buildConfig.buildVersion);

    const assets = path.join(target.source, 'assets');
    await cp(assets, path.join(target.output, 'assets'), {
        recursive: true,
        force: true,
    }).catch((error) => {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    });
}

async function assertSafeBuildOutputTarget(targetPath) {
    await mkdir(buildOutputRoot, { recursive: true });
    const [canonicalRepo, canonicalRoot] = await Promise.all([
        realpath(repoRoot),
        realpath(buildOutputRoot),
    ]);
    if (!samePath(canonicalRepo, repoRoot) || !samePath(canonicalRoot, buildOutputRoot)) {
        throw new Error('Build output root must not be a symlink or junction.');
    }
    const relativeTarget = path.relative(buildOutputRoot, targetPath);
    if (!['game', 'game-admin'].includes(relativeTarget)) {
        throw new Error('Build output target must be a direct app directory.');
    }
    try {
        const targetStats = await lstat(targetPath);
        if (targetStats.isSymbolicLink()) {
            throw new Error('Build output target must not be a symlink or junction.');
        }
        const canonicalTarget = await realpath(targetPath);
        if (!samePath(canonicalTarget, targetPath)) {
            throw new Error('Build output target resolves outside its declared path.');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

function samePath(left, right) {
    return path.resolve(left).toLocaleLowerCase('en-US') === path.resolve(right).toLocaleLowerCase('en-US');
}

async function copyLocalJavaScriptModules(sourceRoot, outputRoot, entryName, buildVersion, isRoot = false) {
    for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
        const sourcePath = path.join(sourceRoot, entry.name);
        const outputPath = path.join(outputRoot, entry.name);
        if (entry.isDirectory()) {
            await copyLocalJavaScriptModules(sourcePath, outputPath, entryName, buildVersion);
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.js') || (isRoot && entry.name === entryName)) continue;
        const source = await readFile(sourcePath, 'utf8');
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, versionModuleImports(rewriteSharedModulePaths(source), buildVersion), 'utf8');
    }
}

const requestedTargetNames = new Set(String(buildConfig.target || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
const selectedTargets = requestedTargetNames.size
    ? targets.filter((target) => requestedTargetNames.has(target.name))
    : targets;
if (!selectedTargets.length) {
    throw new Error(`No build targets matched GALGAME_BUILD_TARGET=${buildConfig.target}`);
}

if (selectedTargets.some((target) => target.name === 'player')) {
    const renderer = await import('./player/src/presentation-renderer.js');
    const { verifyPresentationGateReports } = await import('./shared/src/presentation-gate.js');
    const gateValidation = await verifyPresentationGateReports({
        reports: renderer.PRESENTATION_GATE_REPORTS,
        readText: (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8'),
        sha256: (value) => createHash('sha256').update(value, 'utf8').digest('hex'),
    });
    if (!gateValidation.valid) {
        throw new Error(`Invalid presentation gate report configuration: ${gateValidation.errors.join(', ')}`);
    }
}

for (const target of selectedTargets) {
    await copyApp(target);
    console.log(`Built ${target.name} -> ${path.relative(repoRoot, target.output)}`);
}

function applyBuildConfig(html, config) {
    let next = html;
    next = next.replace(/\.\/styles\.css(?:\?v=[^"']*)?/g, `./styles.css?v=${escapeHtmlAttribute(config.buildVersion)}`);
    next = next.replace(/\.\/app\.js(?:\?v=[^"']*)?/g, `./app.js?v=${escapeHtmlAttribute(config.buildVersion)}`);
    if (config.configServiceUrl) {
        next = replaceMetaContent(next, 'galgame-config-service', config.configServiceUrl);
    }
    if (config.originalRuntimeBridgeUrl) {
        next = replaceMetaContent(next, 'galgame-original-runtime-bridge', config.originalRuntimeBridgeUrl);
    }
    if (config.scriptImportAssistantUrl) {
        next = replaceMetaContent(next, 'galgame-script-import-assistant', config.scriptImportAssistantUrl);
    }
    return next;
}

async function versionSharedModuleImports(root, buildVersion) {
    const entries = await readdir(root, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            await versionSharedModuleImports(entryPath, buildVersion);
            return;
        }
        if (!entry.name.endsWith('.js')) {
            return;
        }
        const source = await readFile(entryPath, 'utf8');
        await writeFile(entryPath, versionModuleImports(source, buildVersion), 'utf8');
    }));
}

function versionModuleImports(source, buildVersion) {
    const version = escapeJavaScriptSpecifier(buildVersion);
    return source
        .replace(/(\bfrom\s*['"])(\.{1,2}\/[^'"]+\.js)(?:\?v=[^'"]*)?(['"])/g, `$1$2?v=${version}$3`)
        .replace(/(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+\.js)(?:\?v=[^'"]*)?(['"]\s*\))/g, `$1$2?v=${version}$3`);
}

function rewriteSharedModulePaths(source) {
    return String(source).replaceAll('../../shared/src/', './shared/');
}

function replaceMetaContent(html, name, value) {
    const pattern = new RegExp(`<meta\\s+name=["']${escapeRegExp(name)}["']\\s+content=["'][^"']*["']\\s*>`, 'i');
    const replacement = `<meta name="${name}" content="${escapeHtmlAttribute(value)}">`;
    return pattern.test(html)
        ? html.replace(pattern, replacement)
        : html.replace('</head>', `    ${replacement}\n</head>`);
}

function escapeHtmlAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeJavaScriptSpecifier(value) {
    return encodeURIComponent(String(value || '').replace(/['"]/g, ''));
}
