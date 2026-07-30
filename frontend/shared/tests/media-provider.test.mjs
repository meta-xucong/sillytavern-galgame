import assert from 'node:assert/strict';
import { createMediaGateway, MemoryMediaJobStore } from '../../../external-modules/media-gateway/server.mjs';
import { DEMO_SCENARIO } from '../src/demo-scenario.js';
import { ExternalMediaProvider, requestMediaForEvent } from '../src/media-provider.js';
import {
    createActiveRelease,
} from '../src/protocol.js';

const server = createMediaGateway({
    store: new MemoryMediaJobStore(),
    completeDelayMs: 0,
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

try {
    const provider = new ExternalMediaProvider({
        enabled: true,
        endpoint: `http://127.0.0.1:${port}`,
    });
    assert.equal(provider.isReady(), true);
    assert.equal((await provider.healthCheck()).ok, true);

    const release = createActiveRelease(DEMO_SCENARIO);
    const state = {
        sessionId: 'native_session',
        chapterId: 'native',
        nodeId: 'live',
        sceneId: 'live',
    };
    const event = {
        id: 'cg_live_moment',
        kind: 'image',
        summary: '当前剧情生成的关键画面',
        location: 'live',
        fallbackAsset: 'default_stage',
    };
    const result = await requestMediaForEvent({
        provider,
        manifest: DEMO_SCENARIO,
        release,
        state,
        event,
    });
    assert.equal(result.ok, true);
    assert.equal(result.job.status, 'succeeded');
    assert.equal(result.request.event.event_id, 'cg_live_moment');
    assert.match(result.job.result.url, /^data:image\/svg\+xml;base64,/);

    const lookup = await provider.getJob(result.job.job_id);
    assert.equal(lookup.status, 'succeeded');
    assert.equal(lookup.request_id, result.request.request_id);

    console.log('media provider tests passed');
} finally {
    server.close();
}
