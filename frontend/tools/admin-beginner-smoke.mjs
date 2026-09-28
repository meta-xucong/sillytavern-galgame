import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || '');
const evidencePath = args.evidence
    ? path.resolve(repoRoot, args.evidence)
    : path.join(repoRoot, '.codex-longrun/evidence/admin-beginner-simple-smoke.json');
const types = ['scene', 'character', 'equipment', 'item', 'skill'];
const failures = [];
const checks = [];

const adminHtml = await loadText('/game-admin/index.html', path.join(repoRoot, 'public/game-admin/index.html'));
const adminJs = await loadText('/game-admin/app.js', path.join(repoRoot, 'public/game-admin/app.js'));
const playerHtml = await loadText('/game/index.html', path.join(repoRoot, 'public/game/index.html'));

runCheck('current-two-entry-navigation', () => {
    const tabs = [...adminHtml.matchAll(/<button[^>]*data-tab="([^"]+)"[^>]*>([^<]*)<\/button>/g)]
        .map((match) => ({ id: match[1], label: normalizeSpace(match[2]) }));
    assert.deepEqual(tabs, [
        { id: 'dashboard', label: '上传剧本' },
        { id: 'enhancements', label: '上传图片' },
    ]);
});

runCheck('one-script-upload-entry', () => {
    const card = extractArticle(adminHtml, 'data-script-assistant-card="upload"');
    assert.equal(count(card, /<input\b[^>]*type="file"/g), 1);
    assert.equal(count(card, /id="scriptFileInput"/g), 1);
    assert.ok(card.includes('上传剧本'));
    for (const id of ['organizeScriptButton', 'redeployScriptButton', 'confirmScriptDraftButton']) {
        const control = card.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`));
        assert.ok(control && /\bhidden\b/.test(control[0]), `legacy script control ${id} is visible`);
    }
});

runCheck('five-simple-png-entries', () => {
    const card = extractArticle(adminHtml, 'data-enhancement-card="visual-assets"');
    const entries = [...card.matchAll(/data-simple-visual-type="([^"]+)"/g)].map((match) => match[1]);
    const inputs = [...card.matchAll(/<input\b[^>]*class="[^"]*simple-visual-upload-input[^>]*>/g)].map((match) => match[0]);
    assert.deepEqual(entries, types);
    assert.equal(inputs.length, types.length);
    assert.deepEqual(inputs.map((input) => input.match(/data-visual-upload-type="([^"]+)"/)?.[1]), types);
    assert.ok(inputs.every((input) => /type="file"/.test(input) && /accept="image\/png"/.test(input)));
    assert.equal(card.includes('id="visualUploadForm"'), false);
});

runCheck('no-advanced-visual-controls', () => {
    const card = extractArticle(adminHtml, 'data-enhancement-card="visual-assets"');
    const text = htmlText(card).toLowerCase();
    for (const term of ['检查服务', '连接测试', '恢复默认', '发布策略', '接口地址', '匹配分数', 'provider', '模型', '提示词', '上下文', 'token', 'hash', 'catalog', 'profile', 'proof']) {
        assert.equal(text.includes(term.toLowerCase()), false, `visual card exposes ${term}`);
    }
    for (const id of ['visualAssetTypeSelect', 'visualAssetTitleInput', 'visualTagCodesInput', 'visualAssetFileInput', 'visualPublishCatalogButton', 'visualEnableButton', 'visualDisableButton', 'visualRestoreDefaultsButton']) {
        assert.equal(card.includes(`id="${id}"`), false, `legacy visual control remains: ${id}`);
    }
});

runCheck('minimal-visual-request-surface', () => {
    assert.ok(adminJs.includes('/v1/admin/visual/upload'));
    assert.ok(adminJs.includes('/v1/admin/visual/publish'));
    assert.ok(adminJs.includes('/v1/local-admin/visual/upload'));
    assert.ok(adminJs.includes('/v1/local-admin/visual/publish'));
    assert.equal(/['"]Authorization['"]\s*:|\bBearer\s+/i.test(adminJs), false);
    assert.equal(/visual-match|visual-bundle|asset-ticket|playerVisualSessionReader|projection.?proof/i.test(adminJs), false);
});

runCheck('player-admin-route-isolation', () => {
    assert.equal(/game-admin|后台|管理端|管理员/.test(htmlText(playerHtml)), false);
});

const result = {
    schemaVersion: 'galgame.admin-beginner-simple-smoke.v2',
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    baseUrl: baseUrl || 'public-files',
    contract: {
        scriptUploadEntries: 1,
        visualUploadEntries: types,
        visibleTechnicalVisualControls: false,
        legacyAdminWizardIsNotActiveContract: true,
    },
    checks,
    failures,
};
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
    process.exitCode = 1;
}

function runCheck(name, fn) {
    try {
        fn();
        checks.push({ name, ok: true });
    } catch (error) {
        checks.push({ name, ok: false, error: error.message });
        failures.push(`${name}: ${error.message}`);
    }
}

async function loadText(urlPath, localPath) {
    if (baseUrl) {
        try {
            const actualPath = urlPath === '/game-admin/index.html' ? '/game-admin/' : urlPath === '/game/index.html' ? '/game/' : urlPath;
            const response = await fetch(`${baseUrl}${actualPath}`);
            if (response.ok) {
                return response.text();
            }
        } catch {
            // Public build remains the deterministic fallback for this static smoke.
        }
    }
    return readFile(localPath, 'utf8');
}

function extractArticle(html, marker) {
    const markerIndex = html.indexOf(marker);
    assert.notEqual(markerIndex, -1, `missing admin marker ${marker}`);
    const start = html.lastIndexOf('<article', markerIndex);
    assert.notEqual(start, -1, `missing article start for ${marker}`);
    const tagPattern = /<\/?article\b[^>]*>/gi;
    tagPattern.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tagPattern.exec(html))) {
        if (match[0].startsWith('</')) {
            depth -= 1;
            if (depth === 0) {
                return html.slice(start, tagPattern.lastIndex);
            }
        } else {
            depth += 1;
        }
    }
    throw new Error(`unterminated article for ${marker}`);
}

function htmlText(value) {
    return normalizeSpace(String(value || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'));
}

function normalizeSpace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function count(value, pattern) {
    return [...value.matchAll(pattern)].length;
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--')) continue;
        parsed[value.slice(2)] = values[index + 1] && !values[index + 1].startsWith('--') ? values[++index] : 'true';
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}
