import http from 'node:http';
import path from 'node:path';
import {
    fileURLToPath,
    pathToFileURL,
} from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COMPLETE_DELAY_MS = Number(process.env.MEDIA_GATEWAY_MOCK_DELAY_MS || 0);

export function createMediaGateway({
    store = new MemoryMediaJobStore(),
    corsOrigin = process.env.MEDIA_GATEWAY_CORS_ORIGIN || '',
    completeDelayMs = DEFAULT_COMPLETE_DELAY_MS,
} = {}) {
    return http.createServer(async (request, response) => {
        try {
            await handleRequest(request, response, {
                store,
                corsOrigin,
                completeDelayMs,
            });
        } catch (error) {
            sendJson(response, 500, {
                error: {
                    code: error.message || 'MEDIA_GATEWAY_ERROR',
                    retryable: true,
                },
            }, { corsOrigin });
        }
    });
}

export async function handleRequest(request, response, {
    store,
    corsOrigin = '',
    completeDelayMs = 0,
}) {
    if (request.method === 'OPTIONS') {
        sendOptions(response, corsOrigin);
        return;
    }

    const url = new URL(request.url, 'http://localhost');
    const method = request.method || 'GET';
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/v1/health') {
        sendJson(response, 200, {
            ok: true,
            service: 'media-gateway',
            mode: 'mock',
            jobs: await store.count(),
        }, { corsOrigin });
        return;
    }

    if (method === 'POST' && pathname === '/v1/media/jobs') {
        const body = await readJson(request);
        const validation = validateMediaRequest(body);
        if (!validation.valid) {
            sendJson(response, 400, {
                error: {
                    code: 'MEDIA_REQUEST_INVALID',
                    retryable: false,
                    details: validation.errors,
                },
            }, { corsOrigin });
            return;
        }

        const idempotencyKey = String(request.headers['idempotency-key'] || body.request_id || '').trim();
        const job = await store.createOrReuse(body, idempotencyKey, completeDelayMs);
        sendJson(response, 200, serializeJob(job), { corsOrigin });
        return;
    }

    const jobMatch = /^\/v1\/media\/jobs\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && jobMatch) {
        const job = await store.get(decodeURIComponent(jobMatch[1]), completeDelayMs);
        if (!job) {
            sendJson(response, 404, {
                error: {
                    code: 'MEDIA_JOB_NOT_FOUND',
                    retryable: false,
                },
            }, { corsOrigin });
            return;
        }
        sendJson(response, 200, serializeJob(job), { corsOrigin });
        return;
    }

    sendJson(response, 404, {
        error: {
            code: 'NOT_FOUND',
            retryable: false,
        },
    }, { corsOrigin });
}

export class MemoryMediaJobStore {
    constructor() {
        this.jobs = new Map();
        this.idempotency = new Map();
    }

    async count() {
        return this.jobs.size;
    }

    async createOrReuse(request, idempotencyKey, completeDelayMs = 0) {
        const key = idempotencyKey || `request:${request.request_id}`;
        const existingId = this.idempotency.get(key);
        if (existingId) {
            return this.get(existingId, completeDelayMs);
        }

        const job = {
            job_id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            request_id: request.request_id,
            kind: request.kind || 'image',
            status: 'queued',
            progress: 0,
            created_at: new Date().toISOString(),
            poll_after_ms: completeDelayMs > 0 ? Math.min(completeDelayMs, 2000) : 0,
            request,
            result: null,
            error: null,
        };
        this.jobs.set(job.job_id, job);
        this.idempotency.set(key, job.job_id);
        return this.get(job.job_id, completeDelayMs);
    }

    async get(jobId, completeDelayMs = 0) {
        const job = this.jobs.get(jobId);
        if (!job) {
            return null;
        }
        return updateMockJob(job, completeDelayMs);
    }
}

function updateMockJob(job, completeDelayMs) {
    const ageMs = Date.now() - Date.parse(job.created_at);
    if (job.status === 'queued' && ageMs >= completeDelayMs) {
        job.status = 'succeeded';
        job.progress = 1;
        job.poll_after_ms = 0;
        job.result = createMockResult(job);
    } else if (job.status === 'queued') {
        job.progress = Math.max(0.05, Math.min(0.95, ageMs / Math.max(completeDelayMs, 1)));
    }
    return job;
}

function serializeJob(job) {
    const payload = {
        job_id: job.job_id,
        request_id: job.request_id,
        status: job.status,
        created_at: job.created_at,
        poll_after_ms: job.poll_after_ms,
    };
    if (job.status === 'running' || job.status === 'queued') {
        payload.progress = job.progress;
    }
    if (job.result) {
        payload.result = job.result;
    }
    if (job.error) {
        payload.error = job.error;
    }
    return payload;
}

function createMockResult(job) {
    const request = job.request || {};
    const width = Number(request.output?.width || 1536);
    const height = Number(request.output?.height || 864);
    return {
        url: createMockSvgDataUrl({
            width,
            height,
            label: `${request.kind || job.kind} mock`,
            summary: request.scene?.summary || request.event?.event_id || job.job_id,
        }),
        mime_type: 'image/svg+xml',
        width,
        height,
        sha256: '',
    };
}

function createMockSvgDataUrl({ width, height, label, summary }) {
    const safeLabel = escapeXml(label);
    const safeSummary = escapeXml(summary);
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f3b9c6"/><stop offset="1" stop-color="#8ac7d8"/></linearGradient></defs>',
        '<rect width="100%" height="100%" fill="url(#bg)"/>',
        `<text x="50%" y="46%" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(width / 24)}" fill="#26212c">${safeLabel}</text>`,
        `<text x="50%" y="55%" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(width / 42)}" fill="#3f3845">${safeSummary}</text>`,
        '</svg>',
    ].join('');
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function validateMediaRequest(request) {
    const errors = [];
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return {
            valid: false,
            errors: ['request must be an object'],
        };
    }
    if (typeof request.protocol_version !== 'string') {
        errors.push('protocol_version is required');
    }
    if (typeof request.request_id !== 'string') {
        errors.push('request_id is required');
    }
    if (!['image', 'video'].includes(request.kind)) {
        errors.push('kind must be image or video');
    }
    if (!request.event?.event_id) {
        errors.push('event.event_id is required');
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}

async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(chunk);
    }
    if (!chunks.length) {
        return {};
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new Error('INVALID_JSON');
    }
}

function sendOptions(response, corsOrigin) {
    applyCors(response, corsOrigin);
    response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    });
    response.end();
}

function sendJson(response, status, data, { corsOrigin = '' } = {}) {
    applyCors(response, corsOrigin);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(data));
}

function applyCors(response, corsOrigin) {
    if (!corsOrigin) {
        return;
    }
    response.setHeader('Access-Control-Allow-Origin', corsOrigin);
    response.setHeader('Vary', 'Origin');
}

function escapeXml(value) {
    return String(value || '').replace(/[<>&"']/g, (char) => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
    }[char]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 8792);
    const server = createMediaGateway();
    server.listen(port, host, () => {
        console.log(`Media gateway listening at http://${host}:${port}`);
    });
}
