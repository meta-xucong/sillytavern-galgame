/** Wait for original Generate to settle before accepting persisted chat text.
 * Self-contained: serialized into the bridge browser; never edits chat data.
 */
export async function waitForOriginalGenerationCompletion({
    generate, readReply, stopGeneration = () => {}, signal = null,
    timeoutMs = 180000, readbackTimeoutMs = 30000, pollMs = 250, stopTimeoutMs = 5000,
} = {}) {
    const failure = (code) => Object.assign(new Error(code), { code });
    const cancelled = () => failure('ORIGINAL_GENERATION_CANCELLED');
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const bounded = (work, ms, code, abortSignal = signal) => {
        let timer;
        let onAbort;
        return new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(failure(code)), Math.max(1, ms));
            onAbort = () => reject(cancelled());
            abortSignal?.addEventListener('abort', onAbort, { once: true });
            Promise.resolve(work).then(resolve, reject);
            if (abortSignal?.aborted) onAbort();
        }).finally(() => {
            clearTimeout(timer);
            abortSignal?.removeEventListener('abort', onAbort);
        });
    };
    if (typeof generate !== 'function' || typeof readReply !== 'function') {
        throw new TypeError('generate and readReply must be functions');
    }
    if (signal?.aborted) throw cancelled();
    const generation = Promise.resolve().then(() => {
        if (signal?.aborted) throw cancelled();
        return generate();
    });
    try {
        await bounded(generation, timeoutMs, 'ORIGINAL_GENERATE_TIMEOUT');
    } catch (error) {
        if (['ORIGINAL_GENERATE_TIMEOUT', 'ORIGINAL_GENERATION_CANCELLED'].includes(error?.code)) {
            try { Promise.resolve(stopGeneration()).catch(() => {}); } catch { /* confirm below */ }
            try {
                await bounded(generation.catch(() => {}), stopTimeoutMs, 'ORIGINAL_GENERATION_STOP_UNCONFIRMED', null);
            } catch {
                throw failure('ORIGINAL_GENERATION_STOP_UNCONFIRMED');
            }
        }
        throw error;
    }
    const deadline = Date.now() + readbackTimeoutMs;
    let lastStatus = null;
    while (Date.now() < deadline) {
        if (signal?.aborted) throw cancelled();
        try {
            lastStatus = await bounded(readReply(), deadline - Date.now(), 'ORIGINAL_REPLY_NOT_WRITTEN');
        } catch (error) {
            if (error?.code === 'ORIGINAL_GENERATION_CANCELLED' || error?.fatal === true) throw error;
            lastStatus = null;
        }
        if (signal?.aborted) throw cancelled();
        if (lastStatus?.type === 'ready') return lastStatus.rawChat;
        // An empty placeholder is not a failure while Generate is active.
        // Even after completion, allow the original runtime's delayed save.
        await sleep(Math.max(1, Math.min(pollMs, deadline - Date.now())));
    }
    throw failure(lastStatus?.type === 'empty' ? 'ORIGINAL_EMPTY_REPLY' : 'ORIGINAL_REPLY_NOT_WRITTEN');
}
