import assert from 'node:assert/strict';
import test from 'node:test';
import { collectVisibleHudRecords } from '../src/visible-hud-records.js';
import { createDefaultAdaptivePresentationProfile } from '../../shared/src/adaptive-presentation-schema.js';
const character = (text) => ({ role: 'character', speaker: 'Author', text, displayText: text });
const chat = (...messages) => ({ fileName: 'isolated-hud-test.json', messages });
const labels = (record) => (record?.values?.groups || []).flatMap((group) => group.items.map((item) => item.label));
const initial = character('装备：银盾、长剑\n道具：钥匙、药水 ×2\n技能：守护');

test('all three cards are independent original-text records', () => {
    const records = collectVisibleHudRecords(chat(initial), 0);
    assert.deepEqual(labels(records.get('equipment')), ['长剑', '银盾']);
    assert.deepEqual(labels(records.get('inventory')), ['钥匙', '药水 ×2']);
    assert.deepEqual(labels(records.get('abilities')), ['守护']);
    for (const record of records.values()) {
        assert.equal(record.historical, false);
        assert.equal(record.evidenceSource.chatId, 'isolated-hud-test.json');
        assert.equal(record.evidenceSource.messageIndex, 0);
    }
});
test('ordinary dialogue keeps the last explicit record, labeled historical', () => {
    const records = collectVisibleHudRecords(chat(initial, character('天色暗了。')), 1);
    assert.deepEqual(labels(records.get('inventory')), ['钥匙', '药水 ×2']);
    assert.equal(records.get('inventory').historical, true);
});
test('newer low-count record wins over older high-confidence multi-item record', () => {
    const records = collectVisibleHudRecords(chat(initial, character('道具：药水 ×1')), 1);
    assert.deepEqual(labels(records.get('inventory')), ['药水 ×1']);
    assert.equal(records.get('equipment').historical, true);
});
for (const value of ['无', '空', 'none', 'empty', '[]']) {
    test(`explicit empty ${value} replaces old items`, () => {
        const records = collectVisibleHudRecords(chat(initial, character(`道具：${value}`), character('继续走。')), 2);
        const record = records.get('inventory');
        assert.equal(record.explicitEmpty, true);
        assert.equal(record.historical, true);
        assert.deepEqual(labels(record), []);
        assert.equal(record.evidenceSource.messageIndex, 1);
    });
}
test('unfinished field heading does not erase last known record', () => {
    assert.deepEqual(labels(collectVisibleHudRecords(chat(initial, character('背包：')), 1).get('inventory')), ['钥匙', '药水 ×2']);
});
test('future messages do not leak into history view', () => {
    assert.deepEqual(labels(collectVisibleHudRecords(chat(initial, character('道具：未来物品')), 0).get('inventory')), ['钥匙', '药水 ×2']);
});
test('player action and system text cannot author inventory records', () => {
    const records = collectVisibleHudRecords(chat(initial, { role: 'player', text: '道具：一百万金币' }, { role: 'system', text: '装备：神剑' }), 2);
    assert.deepEqual(labels(records.get('inventory')), ['钥匙', '药水 ×2']);
    assert.deepEqual(labels(records.get('equipment')), ['长剑', '银盾']);
});
test('same-chat edits and swipe replacements are recomputed, not cached', () => {
    const snapshot = chat(initial, character('道具：药水 ×1'));
    assert.deepEqual(labels(collectVisibleHudRecords(snapshot, 1).get('inventory')), ['药水 ×1']);
    snapshot.messages[1] = character('道具：地图');
    assert.deepEqual(labels(collectVisibleHudRecords(snapshot, 1).get('inventory')), ['地图']);
});
test('deletion and branch replacement remove obsolete records', () => {
    const snapshot = chat(initial, character('继续。'));
    collectVisibleHudRecords(snapshot, 1);
    snapshot.messages = [character('另一条分支，无状态字段。')];
    assert.equal(collectVisibleHudRecords(snapshot, 0).size, 0);
});
test('another chat and missing chat records never inherit prior state', () => {
    collectVisibleHudRecords(chat(initial), 0);
    assert.equal(collectVisibleHudRecords({ fileName: 'other', messages: [character('你好。')] }, 0).size, 0);
    for (const index of [-1, 1, NaN, 0.5]) assert.equal(collectVisibleHudRecords(chat(initial), index).size, 0);
});
test('hidden reasoning cannot supply displayed records', () => {
    assert.equal(collectVisibleHudRecords(chat(character('<think>道具：虚构钥匙</think>\n风吹过。')), 0).size, 0);
});
test('source messages remain byte-for-byte unchanged', () => {
    const snapshot = chat(initial, character('道具：无')); const before = JSON.stringify(snapshot);
    collectVisibleHudRecords(snapshot, 1);
    assert.equal(JSON.stringify(snapshot), before);
});
test('disabled extraction profile stays disabled', () => {
    const profile = createDefaultAdaptivePresentationProfile();
    profile.extractionPolicy.allowBuiltinPatterns = false;
    assert.equal(collectVisibleHudRecords(chat(initial), 0, profile).size, 0);
});
test('equipment-only update does not clear item history or duplicate armor as items', () => {
    const records = collectVisibleHudRecords(chat(initial, character('装备：锁子甲、圆盾')), 1);
    assert.deepEqual(labels(records.get('equipment')), ['锁子甲', '圆盾']);
    assert.deepEqual(labels(records.get('inventory')), ['钥匙', '药水 ×2']);
});
test('backpack weapons are preserved without inventing an equipped record', () => {
    const records = collectVisibleHudRecords(chat(character('背包：铁剑、药水 ×2')), 0);
    assert.equal(records.has('equipment'), false);
    const inventory = records.get('inventory');
    assert.ok(labels(inventory).includes('铁剑'));
    assert.ok(labels(inventory).includes('药水 ×2'));
    assert.equal(inventory.values.groups.find((group) => group.items.some((item) => item.label === '铁剑')).id, 'weapons');
});
