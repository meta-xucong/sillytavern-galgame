import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectionHealthMonitor } from '../src/connection-health.js';

test('health monitor probes all services and exposes one snapshot', async () => {
    const monitor = createConnectionHealthMonitor({
        timeoutMs: 100,
        probes: {
            sillyTavern: async () => ({ ok: true, version: 'test' }),
            configService: async () => ({ ok: true }),
            runtimeBridge: async () => ({ ok: false, errorCode: 'BRIDGE_OFFLINE' }),
            visualService: async () => ({ ok: true, catalog: 'test' }),
        },
    });
    const snapshot = await monitor.probeNow();
    assert.equal(snapshot.protocolVersion, 'galgame.connection-health.v1');
    assert.equal(snapshot.services.sillyTavern.status, 'up');
    assert.equal(snapshot.services.runtimeBridge.errorCode, 'BRIDGE_OFFLINE');
    assert.equal(snapshot.services.visualService.status, 'up');
    assert.equal(snapshot.overall, 'degraded');
});

test('timeouts become down and recovery resets consecutive failures', async () => {
    let resolveProbe;
    const monitor = createConnectionHealthMonitor({
        timeoutMs: 15,
        probes: {
            sillyTavern: () => new Promise((resolve) => { resolveProbe = resolve; }),
        },
    });
    const first = await monitor.probeNow();
    assert.equal(first.services.sillyTavern.status, 'down');
    assert.equal(first.services.sillyTavern.errorCode, 'HEALTH_CHECK_TIMEOUT');
    resolveProbe?.({ ok: true });
    monitor.setProbe('sillyTavern', async () => ({ ok: true }));
    const second = await monitor.probeNow();
    assert.equal(second.services.sillyTavern.status, 'up');
    assert.equal(second.services.sillyTavern.consecutiveFailures, 0);
});

test('generation status is visible independently of transport probes', async () => {
    const monitor = createConnectionHealthMonitor();
    monitor.recordGenerationStart({ requestId: 'req-1' });
    assert.equal(monitor.getSnapshot().services.generation.status, 'pending');
    monitor.recordGeneration({ ok: false, requestId: 'req-1', errorCode: 'GENERATION_TIMEOUT' });
    const failed = monitor.getSnapshot();
    assert.equal(failed.services.generation.status, 'down');
    assert.equal(failed.services.generation.errorCode, 'GENERATION_TIMEOUT');
    monitor.recordGeneration({ ok: true, requestId: 'req-2', latencyMs: 12 });
    const recovered = monitor.getSnapshot();
    assert.equal(recovered.services.generation.status, 'up');
    assert.equal(recovered.services.generation.consecutiveFailures, 0);
});

test('listeners receive immediate and changed snapshots; stop cancels polling', async () => {
    const events = [];
    const monitor = createConnectionHealthMonitor({
        intervalMs: 1_000,
        probes: { sillyTavern: async () => ({ ok: true }) },
    });
    const unsubscribe = monitor.subscribe((snapshot) => events.push(snapshot.sequence));
    await monitor.probeNow();
    unsubscribe();
    monitor.stop();
    assert.deepEqual(events, [0, 1]);
});
