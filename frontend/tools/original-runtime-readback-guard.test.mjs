import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { hasOriginalTargetReadback } from './original-runtime-readback-guard.mjs';
const bridge = await readFile(new URL('../../external-modules/original-runtime-bridge/server.mjs', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../../external-modules/original-runtime-bridge/generation-lifecycle.mjs', import.meta.url), 'utf8');
test('actual awaited original generation and bound readback satisfy admission', () => {
    assert.equal(hasOriginalTargetReadback(bridge, lifecycle), true);
});
for (const [name, pattern, replacement] of [
    ['missing helper import', /import \{ waitForOriginalGenerationCompletion \}[^\n]+/u, ''],
    ['wrong helper module', /from '\.\/generation-lifecycle.mjs'/u, "from './unverified.mjs'"],
    ['not awaiting completion', /const finalRawChat = await/u, 'const finalRawChat ='],
    ['unbound readback callback', /readReply: readTargetReplyStatus/u, 'readReply: readCachedChat'],
    ['wrong chat in returned snapshot', /snapshot\(finalRawChat, targetChatId\)/u, 'snapshot(finalRawChat, otherChatId)'],
    ['missing binding loss rejection', /ORIGINAL_TARGET_CHAT_BINDING_LOST/gu, 'IGNORED'],
    ['missing prefix change rejection', /ORIGINAL_TARGET_CHAT_CHANGED/gu, 'IGNORED'],
]) test(name, () => {
    const changed = bridge.replace(pattern, replacement);
    assert.notEqual(changed, bridge, 'mutation must affect the real implementation');
    assert.equal(hasOriginalTargetReadback(changed, lifecycle), false);
});
test('comments cannot replace the readback implementation', () => {
    assert.equal(hasOriginalTargetReadback(`/* ${bridge} */`, ''), false);
});
test('readback must not bypass generation completion', () => {
    const changed = lifecycle.replace('await bounded(generation,', 'bounded(generation,');
    assert.equal(hasOriginalTargetReadback(bridge, changed), false);
});
