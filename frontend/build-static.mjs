import { cp, mkdir, rm, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.join(repoRoot, 'frontend');
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
        output: path.join(repoRoot, 'public', 'game'),
        jsInput: 'main.js',
        jsOutput: 'app.js',
    },
    {
        name: 'admin',
        source: path.join(frontendRoot, 'admin', 'src'),
        output: path.join(repoRoot, 'public', 'game-admin'),
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
    await rm(target.output, { recursive: true, force: true });
    await mkdir(target.output, { recursive: true });

    const html = await readFile(path.join(target.source, 'index.html'), 'utf8');
    const publicHtml = applyBuildConfig(html.replaceAll('./main.js', './app.js'), buildConfig);
    await writeFile(path.join(target.output, 'index.html'), publicHtml, 'utf8');
    await copyFile(path.join(target.source, 'styles.css'), path.join(target.output, 'styles.css'));

    const js = await readFile(path.join(target.source, target.jsInput), 'utf8');
    const publicJs = versionModuleImports(
        js.replaceAll('../../shared/src/', './shared/'),
        buildConfig.buildVersion,
    );
    await writeFile(path.join(target.output, target.jsOutput), publicJs, 'utf8');

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
