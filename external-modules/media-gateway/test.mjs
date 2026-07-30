import assert from 'node:assert/strict';
import {
    createMediaGateway,
    MemoryMediaJobStore,
} from './server.mjs';

const store = new MemoryMediaJobStore();
const server = createMediaGateway({
    store,
    completeDelayMs: 0,
});
await listen(server);
const baseUrl = serverBaseUrl(server);

try {
    const health = await fetchJson('/v1/health');
    assert.equal(health.ok, true);
    assert.equal(health.mode, 'mock');

    const request = {
        protocol_version: '1.0',
        request_id: 'media_test_001',
        kind: 'image',
        event: {
            release_id: 'rel_test',
            scenario_id: 'scenario_test',
            chapter_id: 'sillytavern',
            scene_id: 'live',
            node_id: 'live',
            event_id: 'cg_live_test_01',
        },
        scene: {
            summary: '当前故事中的关键画面',
        },
        characters: [],
        prompt: {
            style_id: 'scenario_default',
            positive: 'visual novel key scene',
            negative: 'low quality',
        },
        output: {
            width: 512,
            height: 288,
            format: 'webp',
        },
        policy: {
            blocking: false,
            timeout_ms: 120000,
            fallback_asset: 'default_stage',
        },
    };

    const first = await fetchJson('/v1/media/jobs', {
        method: 'POST',
        body: request,
        headers: {
            'Idempotency-Key': 'rel_test:session_test:cg_live_test_01',
        },
    });
    assert.equal(first.status, 'succeeded');
    assert.equal(first.result.width, 512);
    assert.match(first.result.url, /^data:image\/svg\+xml;base64,/);

    const second = await fetchJson('/v1/media/jobs', {
        method: 'POST',
        body: request,
        headers: {
            'Idempotency-Key': 'rel_test:session_test:cg_live_test_01',
        },
    });
    assert.equal(second.job_id, first.job_id);

    const lookup = await fetchJson(`/v1/media/jobs/${first.job_id}`);
    assert.equal(lookup.status, 'succeeded');
    assert.equal(lookup.request_id, 'media_test_001');

    const invalid = await rawFetch('/v1/media/jobs', {
        method: 'POST',
        body: { kind: 'image' },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'MEDIA_REQUEST_INVALID');

    console.log('media gateway tests passed');
} finally {
    server.close();
}

async function fetchJson(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await rawFetch(path, { method, body, headers });
    assert.equal(response.ok, true, response.body.error?.code || JSON.stringify(response.body));
    return response.body;
}

async function rawFetch(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...headers,
            ...(body === undefined ? {} : {
                'Content-Type': 'application/json',
            }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
        ok: response.ok,
        status: response.status,
        body: await response.json(),
    };
}

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function serverBaseUrl(server) {
    const { port } = server.address();
    return `http://127.0.0.1:${port}`;
}
