import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const playerHtmlPath = path.join(repoRoot, 'public/game/index.html');
const playerJsPath = path.join(repoRoot, 'public/game/app.js');
const adminHtmlPath = path.join(repoRoot, 'public/game-admin/index.html');
const adminJsPath = path.join(repoRoot, 'public/game-admin/app.js');
const publicProtocolPath = path.join(repoRoot, 'public/game-admin/shared/protocol.js');
const publicAdapterPath = path.join(repoRoot, 'public/game-admin/shared/sillytavern-adapter.js');

await checkSyntax(playerJsPath);
await checkSyntax(adminJsPath);
await checkSyntax(publicProtocolPath);
await checkSyntax(publicAdapterPath);

const playerHtml = await readFile(playerHtmlPath, 'utf8');
const playerJs = await readFile(playerJsPath, 'utf8');
const adminHtml = await readFile(adminHtmlPath, 'utf8');
const adminJs = await readFile(adminJsPath, 'utf8');
const publicAdapter = await readFile(publicAdapterPath, 'utf8');

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
    'id="adaptiveDetailDrawer"',
    'role="dialog"',
    'aria-modal="true"',
    'aria-labelledby="adaptiveDetailTitle"',
    'id="adaptiveDetailClose"',
]) {
    assert.ok(playerHtml.includes(selectorNeedle), 'player output missing ' + selectorNeedle);
}

for (const forbiddenNeedle of [
    'id="choicePanel"',
    'id="freeInputForm"',
    'galgame-native-play-url',
    'galgame-runtime-mode',
    'galgame-narrative-gateway',
]) {
    assert.equal(playerHtml.includes(forbiddenNeedle), false, 'player output still contains ' + forbiddenNeedle);
}

for (const selectorNeedle of [
    'data-tab="dashboard"',
    'data-tab="publish"',
    'data-tab="library"',
    'data-tab="enhancements"',
    'data-tab="advanced"',
    'id="dashboardPanel"',
    'id="publishPanel"',
    'id="libraryPanel"',
    'id="enhancementsPanel"',
    'id="advancedPanel"',
    'id="publishStepList"',
    'id="storyPackageSummary"',
    'id="publishCheckList"',
    'id="wizardTemplateSelect"',
    'id="publishSummary"',
    'id="publishResult"',
    'data-script-assistant-card="upload"',
    'id="scriptFileInput"',
    'id="organizeScriptButton"',
    'id="redeployScriptButton"',
    'id="confirmScriptDraftButton"',
    'id="scriptAssistantServiceStatus"',
    'id="scriptAssistantResult"',
    'id="scriptDraftPreview"',
    'id="arcPublishSelect"',
    'id="arcList"',
    'id="resourceResult"',
    'id="characterBindingList"',
    'id="worldBookBindingList"',
    'id="settingBindingList"',
]) {
    assert.ok(adminHtml.includes(selectorNeedle), 'admin output missing ' + selectorNeedle);
}

assert.equal(adminHtml.includes('data-tab="runtime"'), false, 'admin output still contains runtime tab');
assert.equal(adminHtml.includes('data-tab="resources"'), false, 'admin output still contains old resources tab');
assert.equal(adminHtml.includes('data-tab="presentation"'), false, 'admin output still contains old presentation tab');
assert.equal(adminHtml.includes('data-tab="arcs"'), false, 'admin output still contains old arcs tab');
assert.equal(adminHtml.includes('data-tab="media"'), false, 'admin output still contains old media tab');
assert.equal(adminHtml.includes('data-tab="status"'), false, 'admin output still contains old status tab');

for (const jsNeedle of [
    'summarizeSillyTavernBindings',
    'validateSillyTavernBindings',
    'renderResourceBindings',
]) {
    assert.ok(adminJs.includes(jsNeedle), 'admin bundle missing ' + jsNeedle);
}

for (const forbiddenNeedle of [
    'createNarrativeRuntime',
    'continueSession',
    'normalizeSceneResult',
    'reduceSceneResult',
    '/api/backends/chat-completions/generate',
    '/api/backends/text-completions/generate',
]) {
    assert.equal(playerJs.includes(forbiddenNeedle), false, 'player bundle contains old runtime needle ' + forbiddenNeedle);
    assert.equal(publicAdapter.includes(forbiddenNeedle), false, 'adapter contains old runtime needle ' + forbiddenNeedle);
}

const forbiddenPlayerTerms = ['模型', 'API', 'Token', '提示词', '预设', '角色卡', '世界书', 'SillyTavern', 'Sampler'];
const playerVisibleOutput = playerHtml + '\n' + extractQuotedStrings(playerJs).join('\n');
const forbiddenFound = forbiddenPlayerTerms.filter((term) => playerVisibleOutput.includes(term));
assert.deepEqual(forbiddenFound, [], 'player output contains forbidden terms: ' + forbiddenFound.join(', '));

console.log('static DOM smoke passed');

async function checkSyntax(filePath) {
    await execFileAsync('node', ['--check', filePath], { cwd: repoRoot, timeout: 30000 });
}

function extractQuotedStrings(source) {
    return [...source.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
        .map((match) => match[2]);
}
