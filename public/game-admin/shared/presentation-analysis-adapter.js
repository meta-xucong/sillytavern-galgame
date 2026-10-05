import {
    PRESENTATION_LIMITS,
    createPresentationAnnotationRequest,
    validatePresentationAnnotationRequestAsync,
    validatePresentationAnnotationResponse,
} from './presentation-annotation.js?v=auto-e34cf3849e79';
import {
    createSceneContinuityAnalysisRequest,
    validateSceneContinuityAnalysisRequest,
    validateSceneContinuityAnalysisResponse,
} from './scene-continuity-analysis.js?v=auto-e34cf3849e79';

const HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const HEALTH_RETRY_DELAY_MS = 180;
const HEALTH_RETRY_LIMIT = 1;
const MAX_RELEVANT_KNOWN_ENTITIES = 16;

export class PresentationAnalysisError extends Error {
    constructor(code, status = 0, { transportFailure = '' } = {}) {
        super(code);
        this.name = 'PresentationAnalysisError';
        this.code = code;
        this.status = status;
        this.transportFailure = transportFailure;
    }
}

export class PresentationAnalysisAdapter {
    constructor({ baseUrl = 'http://127.0.0.1:8798', fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
        this.baseUrl = String(baseUrl).replace(/\/$/u, '');
        this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    async healthCheck(signal) {
        const unavailable = (diagnosticCode) => ({
            serviceReady: false,
            analyzerConfigured: false,
            analyzerScope: null,
            sceneAnalyzerScope: null,
            diagnosticCode,
        });
        if (typeof this.fetchImpl !== 'function') return unavailable('health-fetch-unavailable');
        let response;
        let payload;
        let lastDiagnostic = 'health-request-failed';
        for (let attempt = 0; attempt <= HEALTH_RETRY_LIMIT; attempt += 1) {
            if (signal?.aborted) return unavailable('health-check-aborted');
            const healthResult = await fetchHealthOnce({
                fetchImpl: this.fetchImpl,
                url: `${this.baseUrl}/v1/presentation/health`,
                signal,
            });
            if (healthResult.error) {
                if (healthResult.abortedByCaller || signal?.aborted) return unavailable('health-check-aborted');
                if (healthResult.timedOut) lastDiagnostic = 'health-check-timeout';
                else {
                    const errorClass = healthResult.error?.name === 'TypeError' ? 'typeerror' : 'other';
                    const causeCode = String(healthResult.error?.cause?.code || '').toUpperCase();
                    const knownCause = ['ECONNREFUSED', 'ENOTFOUND', 'ERR_FAILED', 'ERR_BLOCKED_BY_CLIENT']
                        .find((candidate) => causeCode === candidate);
                    lastDiagnostic = `health-request-${errorClass}${knownCause ? `-${knownCause.toLowerCase()}` : ''}`;
                }
                if (attempt < HEALTH_RETRY_LIMIT && await waitForHealthRetry(signal)) continue;
                return unavailable(lastDiagnostic);
            }
            ({ response, payload } = healthResult);
            if (!response.ok) {
                lastDiagnostic = payload?.diagnosticCode || `health-http-${Number(response.status) || 0}`;
                if (isRetryableHealthStatus(response.status) && attempt < HEALTH_RETRY_LIMIT
                    && await waitForHealthRetry(signal)) continue;
                return unavailable(lastDiagnostic);
            }
            break;
        }
        if (!response.ok) return unavailable(payload?.diagnosticCode || `health-http-${Number(response.status) || 0}`);
        if (payload?.serviceReady !== true || typeof payload.analyzerConfigured !== 'boolean') {
            return unavailable('health-payload-invalid');
        }
        if (!payload.analyzerConfigured) {
            return {
                ...unavailable('analyzer-not-configured'),
                serviceReady: true,
                analyzerScope: payload.analyzerScope ?? null,
                sceneAnalyzerScope: payload.sceneAnalyzerScope ?? null,
            };
        }
        if (!isNonEmptyString(payload.analyzerScope) || !isNonEmptyString(payload.sceneAnalyzerScope)) {
            return unavailable('health-scope-incomplete');
        }
        return {
            serviceReady: true,
            analyzerConfigured: true,
            analyzerScope: payload.analyzerScope ?? null,
            sceneAnalyzerScope: payload.sceneAnalyzerScope ?? null,
            diagnosticCode: 'ready',
        };
    }

    async annotate({ request: suppliedRequest = null, scope, messages, contextMessages = [], knownEntities = [], signal } = {}) {
        let batches;
        if (suppliedRequest) {
            const validation = await validatePresentationAnnotationRequestAsync(suppliedRequest);
            if (!validation.valid) throw new PresentationAnalysisError('INVALID_REQUEST');
            batches = [suppliedRequest];
        } else {
            batches = await createPresentationBatches({ scope, messages, contextMessages, knownEntities });
        }
        const results = [];
        for (const request of batches) {
            if (signal?.aborted) throw new PresentationAnalysisError('ABORTED');
            const timeout = new AbortController();
            const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
            const forwardAbort = () => timeout.abort();
            signal?.addEventListener('abort', forwardAbort, { once: true });
            try {
                const response = await this.fetchImpl(`${this.baseUrl}/v1/presentation/annotations`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-galgame-presentation-version': '1',
                    },
                    body: JSON.stringify(request),
                    signal: timeout.signal,
                    redirect: 'error',
                    cache: 'no-store',
                    credentials: 'omit',
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok) throw new PresentationAnalysisError(payload?.code || 'ANALYZER_UNAVAILABLE', response.status);
                const validated = await validatePresentationAnnotationResponse(payload, request);
                if (!validated.valid) throw new PresentationAnalysisError('INVALID_MODEL_OUTPUT', response.status);
                results.push(...payload.results);
            } catch (error) {
                if (error instanceof PresentationAnalysisError) throw error;
                if (timeout.signal.aborted) throw new PresentationAnalysisError(signal?.aborted ? 'ABORTED' : 'ANALYZER_TIMEOUT');
                throw new PresentationAnalysisError('ANALYZER_UNAVAILABLE');
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', forwardAbort);
            }
        }
        return results;
    }

    async analyzeSceneContinuity({ request: suppliedRequest = null, scope, messageId, pageIndex, pageText, contextPages = [], previousScene = null, signal } = {}) {
        const request = suppliedRequest || await createSceneContinuityAnalysisRequest({
            scope, messageId, pageIndex, pageText, contextPages, previousScene,
        });
        if (!(await validateSceneContinuityAnalysisRequest(request)).valid) {
            throw new PresentationAnalysisError('INVALID_REQUEST');
        }
        if (signal?.aborted) throw new PresentationAnalysisError('ABORTED');
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), Math.max(this.timeoutMs, 70_000));
        const forwardAbort = () => timeout.abort();
        signal?.addEventListener('abort', forwardAbort, { once: true });
        try {
            const response = await this.fetchImpl(`${this.baseUrl}/v1/presentation/scene-continuity`, {
                method: 'POST',
                headers: {
                    // text/plain is CORS-safelisted. The endpoint and closed
                    // request schema still carry the protocol version, while
                    // avoiding fragile browser preflight to the loopback service.
                    'content-type': 'text/plain',
                },
                body: JSON.stringify(request),
                signal: timeout.signal,
                redirect: 'error',
                cache: 'no-store',
                credentials: 'omit',
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) throw new PresentationAnalysisError(payload?.code || 'ANALYZER_UNAVAILABLE', response.status);
            const validated = await validateSceneContinuityAnalysisResponse(payload, request);
            if (!validated.valid) throw new PresentationAnalysisError('INVALID_MODEL_OUTPUT', response.status);
            return { request, response: payload };
        } catch (error) {
            if (error instanceof PresentationAnalysisError) throw error;
            if (timeout.signal.aborted) throw new PresentationAnalysisError(signal?.aborted ? 'ABORTED' : 'ANALYZER_TIMEOUT');
            throw new PresentationAnalysisError('ANALYZER_UNAVAILABLE', 0, {
                transportFailure: classifyPresentationTransportFailure(error),
            });
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', forwardAbort);
        }
    }
}

function classifyPresentationTransportFailure(error) {
    const causeCode = String(error?.cause?.code || '').toUpperCase();
    if (['ECONNREFUSED', 'ENOTFOUND', 'ERR_FAILED', 'ERR_BLOCKED_BY_CLIENT'].includes(causeCode)) {
        return causeCode.toLowerCase().replace(/[^a-z0-9_-]/gu, '').slice(0, 48);
    }
    const message = String(error?.message || '').toLowerCase();
    if (/content security policy|connect-src|blocked by policy/u.test(message)) return 'browser-policy';
    if (/cors|cross-origin|preflight/u.test(message)) return 'cors';
    if (/failed to fetch|fetch failed|networkerror|load failed|network failure/u.test(message)) return 'network-fetch-failed';
    if (/invalid url|failed to parse url|only absolute urls/u.test(message)) return 'invalid-url';
    if (/signal.{0,80}not of type.{0,40}abortsignal|abortsignal.{0,80}not of type/u.test(message)) return 'invalid-abort-signal';
    if (/failed to execute.{0,40}fetch/u.test(message)) {
        const member = message.match(/(?:member|property)\s+['"]?(signal|method|headers|body|mode|cache|credentials|redirect)['"]?/u)?.[1];
        if (member) return `invalid-request-${member}`;
        if (/parameter 2 is not of type|requestinit/u.test(message)) return 'invalid-request-init';
        return 'fetch-init-rejected';
    }
    const safeMessagePrefix = message.split(':', 1)[0].replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40);
    return error?.name === 'TypeError'
        ? `typeerror-${safeMessagePrefix || 'empty-message'}`
        : `transport-${error?.name === 'Error' ? 'error' : 'unknown'}`;
}

async function fetchHealthOnce({ fetchImpl, url, signal }) {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'error',
            credentials: 'omit',
        });
        const payload = await response.json().catch(() => null);
        return { response, payload };
    } catch (error) {
        return {
            error,
            timedOut: controller.signal.aborted && !signal?.aborted,
            abortedByCaller: signal?.aborted === true,
        };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortFromCaller);
    }
}

function isRetryableHealthStatus(status) {
    return [502, 503, 504].includes(Number(status));
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function waitForHealthRetry(signal) {
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
        let timer;
        const finish = (continueRetry) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolve(continueRetry);
        };
        const abort = () => finish(false);
        timer = setTimeout(() => finish(!signal?.aborted), HEALTH_RETRY_DELAY_MS);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

export async function createPresentationBatches({ scope, messages = [], contextMessages = [], knownEntities = [] } = {}) {
    const result = [];
    let pending = [];
    for (const message of messages) {
        let request = await createPresentationAnnotationRequest({
            scope,
            messages: [...pending, message],
            contextMessages,
            knownEntities: selectRelevantKnownEntities([...pending, message], contextMessages, knownEntities),
        });
        let validation = await validatePresentationAnnotationRequestAsync(request);
        if (!validation.valid && (pending.length || validation.errors.includes('request.body-too-large'))) {
            if (pending.length) {
                result.push(await makeRequest(scope, pending, contextMessages, knownEntities));
                pending = [];
            }
            request = await makeRequest(scope, [message], contextMessages, knownEntities);
            validation = await validatePresentationAnnotationRequestAsync(request);
        }
        if (!validation.valid) throw new PresentationAnalysisError('INVALID_REQUEST');
        pending.push(message);
        if (pending.length >= PRESENTATION_LIMITS.maxBatchMessages) {
            result.push(await makeRequest(scope, pending, contextMessages, knownEntities));
            pending = [];
        }
    }
    if (pending.length) result.push(await makeRequest(scope, pending, contextMessages, knownEntities));
    return result;
}

async function makeRequest(scope, messages, contextMessages, knownEntities) {
    let context = [...contextMessages].slice(-PRESENTATION_LIMITS.maxContextMessages);
    let entities = selectRelevantKnownEntities(messages, context, knownEntities);
    while (true) {
        const request = await createPresentationAnnotationRequest({ scope, messages, contextMessages: context, knownEntities: entities });
        const validation = await validatePresentationAnnotationRequestAsync(request);
        if (validation.valid) return request;
        if (context.length) context = context.slice(1);
        else if (entities.length) entities = entities.slice(0, -1);
        else throw new PresentationAnalysisError('INVALID_REQUEST');
    }
}

function selectRelevantKnownEntities(messages, contextMessages, knownEntities) {
    const bounded = [...knownEntities].slice(0, PRESENTATION_LIMITS.maxKnownEntities);
    const sourceText = [...contextMessages, ...messages]
        .map((message) => normalizeEntitySearchText(message?.visibleText))
        .filter(Boolean)
        .join('\n');
    const relevant = [];
    const other = [];
    for (const entity of bounded) {
        const mentioned = (entity?.visibleNames || []).some((name) => {
            const normalized = normalizeEntitySearchText(name);
            return Array.from(normalized).length >= 2 && sourceText.includes(normalized);
        });
        (mentioned ? relevant : other).push(entity);
    }
    return [...relevant, ...other].slice(0, MAX_RELEVANT_KNOWN_ENTITIES);
}

function normalizeEntitySearchText(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}
