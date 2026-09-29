import { buildMediaJobRequest, createMediaIdempotencyKey, getAssetUrl } from './protocol.js?v=auto-2a72e2a79a23';

export class ExternalMediaProvider {
    constructor(config = {}) {
        this.enabled = Boolean(config.enabled);
        this.endpoint = String(config.endpoint || '').replace(/\/+$/, '');
    }

    isReady() {
        return this.enabled && /^https?:\/\//.test(this.endpoint);
    }

    async healthCheck(signal) {
        if (!this.isReady()) {
            return { ok: false, mode: 'disabled' };
        }

        const response = await fetch(`${this.endpoint}/v1/health`, { signal });
        return {
            ok: response.ok,
            status: response.status,
        };
    }

    async createJob(request, idempotencyKey, signal) {
        if (!this.isReady()) {
            return fallbackJob(request);
        }

        const response = await fetch(`${this.endpoint}/v1/media/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(request),
            signal,
        });

        if (!response.ok) {
            throw new Error('MEDIA_JOB_REJECTED');
        }

        return response.json();
    }

    async getJob(jobId, signal) {
        if (!this.isReady()) {
            return { job_id: jobId, status: 'failed' };
        }

        const response = await fetch(`${this.endpoint}/v1/media/jobs/${encodeURIComponent(jobId)}`, { signal });
        if (!response.ok) {
            throw new Error('MEDIA_JOB_LOOKUP_FAILED');
        }
        return response.json();
    }
}

export async function requestMediaForEvent({ provider, manifest, release, state, event, signal }) {
    const request = buildMediaJobRequest({ manifest, release, state, event });
    const idempotencyKey = createMediaIdempotencyKey(release.releaseId, state.sessionId, event.id);
    const timeout = createTimeoutSignal(request.policy.timeout_ms, signal);

    try {
        const job = await createJobWithRetry(provider, request, idempotencyKey, timeout.signal);
        return {
            ok: true,
            idempotencyKey,
            request,
            job,
            fallbackUrl: getAssetUrl(manifest, request.policy.fallback_asset),
        };
    } catch {
        return {
            ok: false,
            idempotencyKey,
            request,
            job: fallbackJob(request),
            fallbackUrl: getAssetUrl(manifest, request.policy.fallback_asset),
        };
    } finally {
        timeout.clear();
    }
}

async function createJobWithRetry(provider, request, idempotencyKey, signal) {
    try {
        return await provider.createJob(request, idempotencyKey, signal);
    } catch (error) {
        if (signal?.aborted) {
            throw error;
        }
        return provider.createJob(request, idempotencyKey, signal);
    }
}

function createTimeoutSignal(timeoutMs, parentSignal) {
    if (parentSignal) {
        return {
            signal: parentSignal,
            clear() {},
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
        signal: controller.signal,
        clear() {
            clearTimeout(timer);
        },
    };
}

function fallbackJob(request) {
    return {
        job_id: `fallback_${request.event.event_id}`,
        request_id: request.request_id,
        status: 'failed',
        error: {
            code: 'MEDIA_PROVIDER_UNAVAILABLE',
            retryable: true,
        },
    };
}
