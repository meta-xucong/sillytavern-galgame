import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import vm from 'node:vm';
import { waitForOriginalGenerationCompletion as wait } from './generation-lifecycle.mjs';
import { BrowserOriginalRuntimeBridge, generateInOriginalRuntimeExpression } from './server.mjs';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const options = { timeoutMs: 200, readbackTimeoutMs: 60, pollMs: 2, stopTimeoutMs: 20 };
const ready = { type: 'ready', rawChat: [{ mes: 'complete original reply' }] };
const empty = { type: 'empty', rawChat: [{ mes: '' }] };
const code = (expected) => (error) => error?.code === expected;
await test('empty placeholder is never read or deleted during generation', async () => {
    let finished = false;
    const rawChat = await wait({ ...options,
        generate: async () => { await sleep(30); finished = true; },
        readReply: async () => { assert.equal(finished, true); return ready; },
    });
    assert.equal(rawChat, ready.rawChat);
    assert.equal(empty.rawChat[0].mes, '');
});
await test('partial persisted text cannot finish a running generation', async () => {
    let finished = false;
    await wait({ ...options, generate: async () => { await sleep(40); finished = true; },
        readReply: async () => { assert.ok(finished); return ready; } });
});
await test('completion may precede original chat save', async () => {
    let reads = 0;
    assert.equal(await wait({ ...options, generate: async () => {},
        readReply: async () => (++reads < 3 ? empty : ready) }), ready.rawChat);
    assert.equal(reads, 3);
});
await test('final empty reply fails without editing original data', async () => {
    const before = JSON.stringify(empty);
    await assert.rejects(wait({ ...options, generate: async () => {}, readReply: async () => empty }), code('ORIGINAL_EMPTY_REPLY'));
    assert.equal(JSON.stringify(empty), before);
});
await test('provider rejection is preserved; partial saved text cannot mask it', async () => {
    const failure = Object.assign(new Error('upstream unavailable'), { code: 'UPSTREAM_503' });
    await assert.rejects(wait({ ...options, generate: async () => { throw failure; },
        readReply: async () => { assert.fail('must not accept partial data after provider error'); } }), (error) => error === failure);
});
await test('transient readback failure recovers after original completion', async () => {
    let reads = 0;
    await wait({ ...options, generate: async () => {}, readReply: async () => {
        if (++reads === 1) throw new Error('temporary read failure');
        return ready;
    } });
    assert.equal(reads, 2);
});
await test('missing saved reply times out rather than claiming success', async () => {
    await assert.rejects(wait({ ...options, generate: async () => {}, readReply: async () => null }), code('ORIGINAL_REPLY_NOT_WRITTEN'));
});
await test('chat drift is fatal, not retried into a false success', async () => {
    await assert.rejects(wait({ ...options, generate: async () => {}, readReply: async () => {
        throw Object.assign(new Error('chat drift'), { code: 'ORIGINAL_TARGET_CHAT_CHANGED', fatal: true });
    } }), code('ORIGINAL_TARGET_CHAT_CHANGED'));
});
await test('timeout requests stop and waits for its confirmation', async () => {
    let finish; let stopped = 0;
    await assert.rejects(wait({ ...options, timeoutMs: 10,
        generate: () => new Promise((resolve) => { finish = resolve; }),
        readReply: async () => ready,
        stopGeneration: () => { stopped++; finish(); },
    }), code('ORIGINAL_GENERATE_TIMEOUT'));
    assert.equal(stopped, 1);
});
await test('unconfirmed stop stays fail-closed', async () => {
    await assert.rejects(wait({ ...options, timeoutMs: 5, stopTimeoutMs: 5,
        generate: () => new Promise(() => {}), readReply: async () => ready,
    }), code('ORIGINAL_GENERATION_STOP_UNCONFIRMED'));
});
await test('cancelled operation never accepts a partial reply', async () => {
    const controller = new AbortController(); let finish;
    const timer = setTimeout(() => controller.abort(), 10);
    try {
        await assert.rejects(wait({ ...options, signal: controller.signal,
            generate: () => new Promise((resolve) => { finish = resolve; }),
            stopGeneration: () => finish(), readReply: async () => ready,
        }), code('ORIGINAL_GENERATION_CANCELLED'));
    } finally { clearTimeout(timer); }
});
await test('already cancelled request does not invoke original Generate', async () => {
    await assert.rejects(wait({ ...options, signal: AbortSignal.abort(),
        generate: () => assert.fail('must not generate'), readReply: async () => ready,
    }), code('ORIGINAL_GENERATION_CANCELLED'));
});
await test('serialized browser helper has no Node-only dependencies', async () => {
    const browserWait = vm.runInNewContext(`(${wait.toString()})`, { setTimeout, clearTimeout });
    assert.equal(await browserWait({ ...options, generate: async () => {}, readReply: async () => ready }), ready.rawChat);
    const expression = generateInOriginalRuntimeExpression({ avatar: 'test.png', chatId: 'isolated-test', timeoutMs: 1000 });
    new vm.Script(expression);
    assert.ok(expression.includes(wait.toString()));
    assert.ok(!expression.includes('const replyWritten ='));
});
await test('bridge requires restart when original stop is unconfirmed', async () => {
    const bridge = new BrowserOriginalRuntimeBridge({ chromePath: 'test-only-no-browser', providerRetryDelaysMs: [] });
    bridge.ensurePage = async () => {};
    bridge.evaluate = async () => ({ ok: false, errorCode: 'ORIGINAL_GENERATION_STOP_UNCONFIRMED' });
    let closed = false;
    bridge.close = () => { closed = true; };
    await assert.rejects(bridge.generateReplyOnceUnsafe({ sillyTavernBaseUrl: 'http://127.0.0.1:8000', avatar: 'test.png', chatId: 'test' }), code('ORIGINAL_GENERATION_STOP_UNCONFIRMED'));
    assert.equal(closed, true);
    assert.equal(bridge.getStatus().ready, false);
});
await test('CDP timeout contains the old browser and returns the bridge to idle', async () => {
    const bridge = new BrowserOriginalRuntimeBridge({ chromePath: 'test-only-no-browser', providerRetryDelaysMs: [] });
    let evaluations = 0;
    let closeCount = 0;
    bridge.ensurePage = async () => {};
    bridge.evaluate = async () => {
        evaluations += 1;
        if (evaluations === 1) throw Object.assign(new Error('evaluation timed out'), { code: 'CDP_EVALUATION_TIMEOUT' });
        return {
            ok: true,
            chatId: 'retry-chat',
            generatedText: 'new original reply',
            rawChat: [{ mes: 'new original reply' }],
        };
    };
    bridge.close = async () => {
        closeCount += 1;
        bridge.chrome = null;
        bridge.browser = null;
        bridge.targetId = null;
        bridge.sessionId = null;
    };

    await assert.rejects(bridge.generateReply({
        sillyTavernBaseUrl: 'http://127.0.0.1:8000', avatar: 'test.png', chatId: 'retry-chat',
    }), code('CDP_EVALUATION_TIMEOUT'));
    assert.equal(closeCount, 1);
    assert.equal(bridge.getStatus().stopping, false);
    assert.equal(bridge.getStatus().pending, false);
    assert.equal(bridge.getStatus().ready, true);
    assert.equal(bridge.lastGeneration.errorCode, 'CDP_EVALUATION_TIMEOUT');

    const retried = await bridge.generateReply({
        sillyTavernBaseUrl: 'http://127.0.0.1:8000', avatar: 'test.png', chatId: 'retry-chat',
    });
    assert.equal(retried.generatedText, 'new original reply');
    assert.equal(evaluations, 2);
});
await test('bridge confirms isolated browser exit before completing close', async () => {
    const bridge = new BrowserOriginalRuntimeBridge({ chromePath: 'test-only-no-browser' });
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => {
        setImmediate(() => {
            child.signalCode = 'SIGTERM';
            child.emit('exit', null, 'SIGTERM');
        });
        return true;
    };
    bridge.chrome = child;
    bridge.browser = { send: async () => ({}) };
    bridge.targetId = 'isolated-target';
    bridge.sessionId = 'isolated-session';

    await bridge.close();

    assert.equal(bridge.chrome, null);
    assert.equal(bridge.browser, null);
    assert.equal(bridge.targetId, null);
    assert.equal(bridge.sessionId, null);
});
await test('hung chat readback is bounded', async () => {
    await assert.rejects(wait({ ...options, readbackTimeoutMs: 10,
        generate: async () => {}, readReply: () => new Promise(() => {}),
    }), code('ORIGINAL_REPLY_NOT_WRITTEN'));
});
