import assert from 'node:assert/strict';
import { PresentationAnnotationCache } from '../src/presentation-cache.js';

let now = 1000;
const cache = new PresentationAnnotationCache({ indexedDB: null, now: () => now });
const dto = { schemaVersion: 'galgame.presentation-annotation.v1', results: [] };
await cache.put('chat/release/arc/1/hash/context/schema', dto, { sourceMessageIndex: 1, sourceMessageHash: 'hash' });
assert.deepEqual(await cache.get('chat/release/arc/1/hash/context/schema'), dto);
await cache.put('chat/release/arc/2/hash/context/schema', dto, { sourceMessageIndex: 2, sourceMessageHash: 'hash' });
assert.equal(await cache.deleteFrom('chat/release/arc/', 2), 1);
assert.deepEqual(await cache.get('chat/release/arc/1/hash/context/schema'), dto);
assert.equal(await cache.get('chat/release/arc/2/hash/context/schema'), null);
await cache.put('chat/release/arc/3/hash-v1/context/schema', dto, { sourceMessageIndex: 3, sourceMessageHash: 'hash-v1' });
await cache.put('chat/release/arc/4/hash/context/schema', dto, { sourceMessageIndex: 4, sourceMessageHash: 'hash' });
assert.equal(await cache.reconcileTimeline('chat/release/arc/', [
    { sourceMessageIndex: 3, sourceMessageHash: 'hash-v2' },
    { sourceMessageIndex: 4, sourceMessageHash: 'hash' },
]), 2);
assert.equal(await cache.get('chat/release/arc/3/hash-v1/context/schema'), null);
assert.equal(await cache.get('chat/release/arc/4/hash/context/schema'), null);
now += 31 * 24 * 60 * 60 * 1000;
assert.equal(await cache.get('chat/release/arc/1/hash/context/schema'), null);
console.log('presentation-cache: PASS');
