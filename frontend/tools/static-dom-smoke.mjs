import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const evidencePath = args.evidence ? path.resolve(repoRoot, args.evidence) : '';
const playerHtmlPath = path.join(repoRoot, 'public/game/index.html');
const playerJsPath = path.join(repoRoot, 'public/game/app.js');
const adminHtmlPath = path.join(repoRoot, 'public/game-admin/index.html');
const adminJsPath = path.join(repoRoot, 'public/game-admin/app.js');
const publicProtocolPath = path.join(repoRoot, 'public/game-admin/shared/protocol.js');
const publicAdapterPath = path.join(repoRoot, 'public/game-admin/shared/sillytavern-adapter.js');
const simpleVisualTypes = ['scene', 'character', 'equipment', 'item', 'skill'];

await Promise.all([
    checkSyntax(playerJsPath),
    checkSyntax(adminJsPath),
    checkSyntax(publicProtocolPath),
    checkSyntax(publicAdapterPath),
]);

const [playerHtml, playerJs, adminHtml, adminJs, publicAdapter] = await Promise.all([
    readFile(playerHtmlPath, 'utf8'),
    readFile(playerJsPath, 'utf8'),
    readFile(adminHtmlPath, 'utf8'),
    readFile(adminJsPath, 'utf8'),
    readFile(publicAdapterPath, 'utf8'),
]);

for (const selectorNeedle of [
    'id="titleScreen"',
    'id="startButton"',
    'id="continueButton"',
    'id="loadButtonTitle"',
    'id="settingsButtonTitle"',
    'id="gameScreen"',
    'id="historyButton"',
    'id="saveButton"',
    'id="loadButtonStage"',
    'id="settingsButtonStage"',
    'id="dialogueText"',
    'id="suggestedActions"',
    'id="playerInputForm"',
    'id="historyDrawer"',
    'id="saveLoadDrawer"',
    'id="settingsDrawer"',
]) {
    assert.ok(playerHtml.includes(selectorNeedle), `player output missing ${selectorNeedle}`);
}

for (const forbiddenNeedle of [
    'id="choicePanel"',
    'id="freeInputForm"',
    'galgame-native-play-url',
    'galgame-runtime-mode',
    'galgame-narrative-gateway',
]) {
    assert.equal(playerHtml.includes(forbiddenNeedle), false, `player output still contains ${forbiddenNeedle}`);
}

const navTabs = [...adminHtml.matchAll(/<button[^>]*data-tab="([^"]+)"[^>]*>([^<]*)<\/button>/g)]
    .map((match) => ({ id: match[1], label: normalizeSpace(match[2]) }));
assert.deepEqual(navTabs, [
    { id: 'dashboard', label: '上传剧本' },
    { id: 'enhancements', label: '上传图片' },
], 'admin navigation is not the current two-entry surface');

const scriptCard = extractArticle(adminHtml, 'data-script-assistant-card="upload"');
assert.equal(count(scriptCard, /id="scriptFileInput"/g), 1, 'script area must expose one upload input');
assert.equal(count(scriptCard, /<input\b[^>]*type="file"/g), 1, 'script area exposes more than one file input');
assert.ok(/<label[^>]*class="[^"]*script-file-button/.test(scriptCard), 'script upload entry is missing');
for (const id of ['organizeScriptButton', 'redeployScriptButton', 'confirmScriptDraftButton']) {
    const button = scriptCard.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`));
    assert.ok(button && /\bhidden\b/.test(button[0]), `legacy script control ${id} must stay hidden`);
}
assert.equal(/<div[^>]*class="[^"]*one-click-flow/.test(scriptCard) && !/<div[^>]*class="[^"]*one-click-flow[^>]*\bhidden\b/.test(scriptCard), false, 'legacy script steps are visible');

const visualCard = extractArticle(adminHtml, 'data-enhancement-card="visual-assets"');
const visualEntries = [...visualCard.matchAll(/data-simple-visual-type="([^"]+)"/g)].map((match) => match[1]);
const visualInputs = [...visualCard.matchAll(/<input\b[^>]*class="[^"]*simple-visual-upload-input[^>]*>/g)]
    .map((match) => match[0]);
assert.deepEqual(visualEntries, simpleVisualTypes, 'visual card must contain one entry for each of five types');
assert.equal(visualInputs.length, simpleVisualTypes.length, 'visual card must expose five PNG inputs');
assert.deepEqual(visualInputs.map((input) => input.match(/data-visual-upload-type="([^"]+)"/)?.[1]), simpleVisualTypes);
assert.ok(visualInputs.every((input) => /type="file"/.test(input) && /accept="image\/png"/.test(input)), 'visual entries must accept PNG files only');
assert.equal(visualCard.includes('id="visualUploadForm"'), false, 'legacy visual form remains');
for (const legacyId of [
    'visualAssetTypeSelect',
    'visualAssetTitleInput',
    'visualTagCodesInput',
    'visualAssetFileInput',
    'visualPublishCatalogButton',
    'visualEnableButton',
    'visualDisableButton',
    'visualRestoreDefaultsButton',
]) {
    assert.equal(visualCard.includes(`id="${legacyId}"`), false, `legacy visual control remains: ${legacyId}`);
}
const visibleVisualText = htmlText(visualCard);
for (const forbiddenText of [
    '检查服务',
    '连接测试',
    '恢复默认',
    '发布策略',
    '匹配分数',
    '接口地址',
    'provider',
    '模型',
    '提示词',
    '上下文',
    'token',
    'hash',
    'catalog',
    'profile',
    'proof',
]) {
    assert.equal(visibleVisualText.toLowerCase().includes(forbiddenText.toLowerCase()), false, `visual card exposes ${forbiddenText}`);
}

assert.ok(adminJs.includes('/v1/admin/visual/upload'), 'admin bundle missing minimal visual upload route');
assert.ok(adminJs.includes('/v1/admin/visual/publish'), 'admin bundle missing minimal visual publish route');
assert.ok(adminJs.includes('/v1/local-admin/visual/upload'), 'admin bundle missing controlled local upload mapping');
assert.ok(adminJs.includes('/v1/local-admin/visual/publish'), 'admin bundle missing controlled local publish mapping');
assert.equal(/['"]Authorization['"]\s*:|\bBearer\s+/i.test(adminJs), false, 'admin bundle exposes an Authorization/Bearer request');
assert.equal(/visual-match|visual-bundle|asset-ticket|playerVisualSessionReader|projection.?proof/i.test(adminJs), false, 'admin bundle references a historical visual chain');

for (const forbiddenNeedle of [
    'createNarrativeRuntime',
    'continueSession',
    'normalizeSceneResult',
    'reduceSceneResult',
    '/api/backends/chat-completions/generate',
    '/api/backends/text-completions/generate',
]) {
    assert.equal(playerJs.includes(forbiddenNeedle), false, `player bundle contains old runtime needle ${forbiddenNeedle}`);
    assert.equal(publicAdapter.includes(forbiddenNeedle), false, `adapter contains old runtime needle ${forbiddenNeedle}`);
}

const forbiddenPlayerTerms = ['模型', 'API', 'Token', '提示词', '预设', '角色卡', '世界书', 'SillyTavern', 'Sampler'];
const playerVisibleOutput = playerHtml + '\n' + extractQuotedStrings(playerJs).join('\n');
assert.deepEqual(forbiddenPlayerTerms.filter((term) => playerVisibleOutput.includes(term)), [], 'player output contains forbidden terms');
assert.equal(/game-admin|后台|管理端|管理员/.test(htmlText(playerHtml)), false, 'player page exposes an admin entry');

const result = {
    schemaVersion: 'galgame.static-dom-smoke.v2',
    generatedAt: new Date().toISOString(),
    ok: true,
    player: { syntax: true, routeIsolated: true },
    admin: { navigation: navTabs, scriptUploadEntries: 1, visualUploadEntries: simpleVisualTypes.length },
    requestSurface: { upload: true, publish: true, localMapping: true, noAuthorization: true },
};
if (evidencePath) {
    await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(result, null, 2));

async function checkSyntax(filePath) {
    await execFileAsync('node', ['--check', filePath], { cwd: repoRoot, timeout: 30000 });
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

function extractQuotedStrings(source) {
    const values = [];
    const template = String.fromCharCode(96);
    for (let index = 0; index < source.length; index += 1) {
        const quote = source[index];
        if (quote === template) {
            index += 1;
            while (index < source.length) {
                if (source[index] === '\\') {
                    index += 2;
                    continue;
                }
                if (source[index] === template) break;
                index += 1;
            }
            continue;
        }
        if (quote !== "'" && quote !== '"') continue;
        let value = '';
        let valid = true;
        index += 1;
        while (index < source.length) {
            const character = source[index];
            if (character === '\\' && index + 1 < source.length) {
                value += character + source[index + 1];
                index += 2;
                continue;
            }
            if (character === '\n' || character === '\r') {
                valid = false;
                break;
            }
            if (character === quote) break;
            value += character;
            index += 1;
        }
        if (valid) values.push(value);
    }
    return values;
}
