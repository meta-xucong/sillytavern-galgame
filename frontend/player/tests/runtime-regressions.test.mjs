import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function load(name, context) {
    let start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing production function ${name}`);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const next = /\n(?:export )?(?:async )?function /u.exec(source.slice(start + 1));
    const end = next ? start + 1 + next.index : source.length;
    return context[name] = vm.runInContext(`(${source.slice(start, end)}\n)`, context);
}
function speakerContext(segment) {
    const context = vm.createContext({ activeRenderContext: {}, activeMessageIndex: 7,
        activeMessageSegments: [segment], activeSegmentIndex: 0,
        getMainCharacterName: () => 'default', isManifestNarratorSpeaker: (name) => name === 'Narrator',
    });
    load('isCharacterVisualMetadataSegment', context);
    return load('getActiveVisualSpeakerContext', context);
}
await test('actual visible speaker overrides message author', () => {
    const resolve = speakerContext({ type: 'dialogue', speaker: 'Alice' });
    assert.equal(resolve({ role: 'character', speaker: 'Author' }, 7).speaker, 'Alice');
    assert.equal(resolve({ role: 'character', speaker: 'Author' }, 7, { type: 'dialogue', speaker: 'Bob' }).speaker, 'Bob');
});
for (const [segment, role, speaker] of [
    [{ type: 'dialogue-group' }, 'group', '多人对话'],
    [{ type: 'dialogue', speaker: 'X', identityRef: { type: 'unknown' } }, 'system', '未识别'],
    [{ type: 'unattributed-dialogue' }, 'system', '未识别'],
    [{ type: 'system' }, 'system', '系统'],
    [{ type: 'narration', text: 'The wind blows.' }, 'narrator', '旁白'],
    [{ type: 'player' }, 'player', '你'],
    [{ type: 'stage' }, 'system', ''],
]) {
    await test(`override preserves ${segment.type}/${speaker} channel`, () => {
        const result = speakerContext(null)({ role: 'character', speaker: 'Author' }, 7, segment);
        assert.equal(result.role, role); assert.equal(result.speaker, speaker);
    });
}
await test('system message cannot be promoted to a character', () => {
    const result = speakerContext(null)({ role: 'system' }, 7, { type: 'dialogue', speaker: 'Bob' });
    assert.equal(result.role, 'system');
});
await test('string inventory records have complete detail-renderer fields', () => {
    const context = vm.createContext({}); load('asArray', context);
    const item = load('normalizeAdaptiveDetailItem', context)('Iron Sword');
    assert.equal(item.label, 'Iron Sword'); assert.equal(item.traits.length, 0);
    assert.equal(item.value, ''); assert.equal(item.originalName, '');
});
await test('image matches cannot invent or overwrite inventory text', () => {
    const context = vm.createContext({ activeVisualDetailHints: new Map([['equipment', [{ displayLabel: 'Iron Sword' }]]]) });
    load('asArray', context);
    assert.equal(load('getVisualDetailItems', context)('equipment', { displayLabel: 'Wrong Sword' })[0].name, 'Iron Sword');
    assert.equal(context.getVisualDetailItems('item', { displayLabel: 'Invented potion' }).length, 0);
});
await test('carried weapons retain their source group and are not hidden or relabeled', () => {
    const context = vm.createContext({ getVisualCardModule: () => 'inventory',
        activeAdaptivePanelResults: new Map([['inventory', { values: { groups: [{ id: 'weapons', items: ['Sword'] }] } }]]),
        createVisualDetailResult: () => ({ hasVisibleEvidence: false }),
    });
    const result = load('getVisualCardDetailResult', context)('item');
    assert.equal(result.hasVisibleEvidence, true);
    assert.equal(result.values.groups[0].id, 'weapons');
    assert.equal(result.values.groups[0].items[0], 'Sword');
});
await test('late context response cannot reset a newer portrait', async () => {
    let complete; let resets = 0;
    const context = vm.createContext({ visualBundleRequestToken: 1,
        getActiveVisualSpeakerContext: () => ({ role: 'character' }), getCoreVisualServiceUrl: () => 'http://unit.test',
        readCoreVisualContext: () => new Promise((resolve) => { complete = resolve; }),
        recordSceneContinuityDiagnostic: () => {},
        renderCoreVisualFallback: () => { resets++; }, markCoreVisualUnavailable: () => {}, setVisualStatus: () => {},
    });
    const result = load('renderCoreVisualPresentation', context)({ messages: [{}] }, 0, 1);
    context.visualBundleRequestToken = 2; complete(null);
    await result; assert.equal(resets, 0);
});
await test('obsolete renderer and icon work has no side effects', async () => {
    const context = vm.createContext({ visualBundleRequestToken: 2, recordSceneContinuityDiagnostic: () => {} });
    await load('renderCoreVisualDecisions', context)([], '', 1, {}, {});
    await load('applyCoreVisualIcons', context)(new Map(), '', 1);
});
await test('late JSON response cannot reset a newer portrait', async () => {
    let complete; let resets = 0; const diagnostics = [];
    const context = vm.createContext({ visualBundleRequestToken: 1,
        activeSceneContinuityAction: 'preserve',
        TextEncoder,
        getActiveVisualSpeakerContext: () => ({ role: 'character' }), getCoreVisualServiceUrl: () => 'http://unit.test',
        readCoreVisualContext: async () => ({ enabled: true, visualProfile: {} }),
        updateSceneContinuityForVisiblePage: async () => {}, createCoreVisualDecisionRequest: async () => ({ projection: { entities: [] } }),
        recordSceneContinuityDiagnostic: (stage, details) => diagnostics.push(`${stage}:${details?.reason || ''}`),
        fetch: async () => ({ ok: true, json: () => new Promise((resolve) => { complete = resolve; }) }),
        renderCoreVisualFallback: () => { resets++; }, markCoreVisualUnavailable: () => {}, setVisualStatus: () => {},
    });
    const result = load('renderCoreVisualPresentation', context)({ messages: [{}] }, 0, 1);
    for (let i = 0; i < 20 && !complete; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.ok(complete, `request stage was ${diagnostics.at(-1) || 'none'}`);
    context.visualBundleRequestToken = 2; complete({ ok: false });
    await result; assert.equal(resets, 0);
});
await test('right-hand card count and tooltip remain available without images', () => {
    const context = vm.createContext({ getVisualCardDetailResult: () => ({ hasVisibleEvidence: true }),
        getAdaptiveGroups: () => [{ items: [{ label: 'Iron Sword' }, { label: 'Shield' }] }],
        getVisualTypeLabel: () => '装备',
    });
    const caption = {}; const attributes = {};
    const summary = {};
    const icon = { querySelector: (selector) => selector === 'figcaption' ? caption : selector === 'small' ? summary : null, setAttribute: (key, value) => { attributes[key] = value; } };
    load('updateCoreVisualCardText', context)(icon, 'equipment');
    assert.equal(caption.textContent, '装备 · 2'); assert.equal(attributes.title, 'Iron Sword、Shield');
    assert.equal(summary.textContent, 'Iron Sword、Shield');
});
