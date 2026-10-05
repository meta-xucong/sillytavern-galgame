const ANALYSIS_UPSTREAM = 'http://127.0.0.1:8801';
const MAX_ANALYSIS_REQUEST_BYTES = 48 * 1024;
const MAX_ANALYSIS_RESPONSE_BYTES = 96 * 1024;
const ROUTES = Object.freeze({
  '/v1/presentation/health': Object.freeze({ method: 'GET', upstreamPath: '/v1/health', headers: [], timeoutMs: 2_500 }),
  '/v1/presentation/annotations': Object.freeze({
    method: 'POST', upstreamPath: '/v1/presentation/annotations', versionHeader: 'x-galgame-presentation-version',
    headers: ['content-type', 'x-galgame-presentation-version'], timeoutMs: 65_000,
  }),
  '/v1/presentation/scene-continuity': Object.freeze({
    method: 'POST', upstreamPath: '/v1/presentation/scene-continuity', versionHeader: 'x-galgame-scene-continuity-version',
    headers: ['content-type', 'x-galgame-scene-continuity-version'], simpleJsonBody: true, timeoutMs: 65_000,
  }),
});

export function resolvePresentationAnalysisProxyRoute(method, pathname) {
  const route = ROUTES[String(pathname || '')];
  if (!route || ![route.method, 'OPTIONS'].includes(String(method || '').toUpperCase())) return null;
  return { ...route, pathname };
}

/**
 * Forward only the fixed, versioned player-analysis contracts to the local
 * analyzer. The browser talks to visual-asset-service (8798); no URL, host,
 * credential, cookie, or upstream header is accepted from the request.
 */
export async function handlePresentationAnalysisProxyRequest(req, res, {
  allowedOrigins = new Set(),
  fetchImpl = globalThis.fetch,
  upstreamBaseUrl = ANALYSIS_UPSTREAM,
} = {}) {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return false;
  }
  const route = resolvePresentationAnalysisProxyRoute(req.method, pathname);
  if (!route) return false;
  if (new URL(req.url, 'http://localhost').search) return sendError(res, 400, 'INVALID_REQUEST');
  const origin = String(req.headers?.origin || '');
  const allowed = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins || []);
  const requestContentType = String(req.headers?.['content-type'] || '').toLowerCase().split(';', 1)[0].trim();
  logProxyEvent('request-received', {
    route: route.pathname,
    method: String(req.method || '').toUpperCase(),
    originPresent: Boolean(origin),
    originAllowed: !origin || allowed.has(origin),
    contentType: ['application/json', 'text/plain'].includes(requestContentType) ? requestContentType : 'other',
    requestedMethod: String(req.headers?.['access-control-request-method'] || '').toUpperCase() || null,
    privateNetworkRequested: String(req.headers?.['access-control-request-private-network'] || '').toLowerCase() === 'true',
  });
  if (origin && !allowed.has(origin)) return sendError(res, 403, 'PRESENTATION_ORIGIN_REJECTED');

  if (String(req.method).toUpperCase() === 'OPTIONS') {
    return sendOptions(req, res, route, allowed);
  }
  if (!origin && route.method === 'POST') return sendError(res, 403, 'PRESENTATION_ORIGIN_REQUIRED');
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase().trim();
  const simpleSceneJsonBody = route.simpleJsonBody === true
    && /^text\/plain(?:\s*;\s*charset=utf-8)?$/u.test(contentType)
    && !Object.hasOwn(req.headers || {}, route.versionHeader);
  if (route.method === 'POST') {
    const legacyVersionedJsonBody = req.headers?.[route.versionHeader] === '1'
      && contentType.startsWith('application/json');
    if (!simpleSceneJsonBody && !legacyVersionedJsonBody) {
      return sendError(res, 400, 'INVALID_REQUEST');
    }
  }

  let body;
  if (route.method === 'POST') {
    try {
      body = await readLimitedBody(req, MAX_ANALYSIS_REQUEST_BYTES);
    } catch (error) {
      return sendError(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400,
        error?.code === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST');
    }
    if (simpleSceneJsonBody) {
      let envelope;
      try { envelope = JSON.parse(body); } catch { return sendError(res, 400, 'INVALID_REQUEST'); }
      if (envelope?.schemaVersion !== 'galgame.scene-continuity-analysis-request.v1') {
        return sendError(res, 400, 'INVALID_REQUEST');
      }
    }
  }

  const base = validateLoopbackBaseUrl(upstreamBaseUrl);
  const controller = new AbortController();
  const abortWhenClientLeaves = () => {
    if (!res.writableEnded) controller.abort();
  };
  const timeout = setTimeout(() => controller.abort(), route.timeoutMs);
  req.once?.('aborted', abortWhenClientLeaves);
  res.once?.('close', abortWhenClientLeaves);
  try {
    const headers = {};
    if (origin) headers.origin = origin;
    if (route.method === 'POST') {
      headers['content-type'] = 'application/json';
      headers[route.versionHeader] = '1';
    }
    const response = await fetchImpl(`${base}${route.upstreamPath}`, {
      method: route.method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });
    logProxyEvent('upstream-response', {
      route: route.pathname,
      status: response.status,
      ok: response.ok,
    });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_ANALYSIS_RESPONSE_BYTES) {
      return sendError(res, 502, 'ANALYZER_RESPONSE_TOO_LARGE');
    }
    let payload;
    try { payload = JSON.parse(text); } catch { return sendError(res, 502, 'ANALYZER_ENVELOPE_INVALID'); }
    if (route.pathname === '/v1/presentation/health') {
      if (!response.ok || typeof payload?.serviceReady !== 'boolean'
        || typeof payload?.analyzerConfigured !== 'boolean') {
        return sendHealthUnavailable(res, response.status || 503);
      }
      return sendJson(res, 200, {
        schemaVersion: 'galgame.presentation-analysis-proxy-health.v1',
        serviceReady: payload.serviceReady,
        analyzerConfigured: payload.analyzerConfigured,
        analyzerScope: typeof payload.analyzerScope === 'string' ? payload.analyzerScope.slice(0, 160) : null,
        sceneAnalyzerScope: typeof payload.sceneAnalyzerScope === 'string' ? payload.sceneAnalyzerScope.slice(0, 200) : null,
      });
    }
    if (!response.ok) {
      const code = typeof payload?.code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(payload.code)
        ? payload.code : 'ANALYZER_UNAVAILABLE';
      return sendJson(res, response.status, {
        schemaVersion: 'galgame.presentation-analysis-proxy-error.v1',
        code,
        ...(typeof payload?.requestId === 'string' && /^[0-9a-f-]{36}$/iu.test(payload.requestId)
          ? { requestId: payload.requestId } : {}),
      });
    }
    return sendJson(res, response.status, payload);
  } catch {
    logProxyEvent('upstream-failure', {
      route: route.pathname,
      kind: controller.signal.aborted ? 'timeout-or-client-abort' : 'network-error',
    });
    if (controller.signal.aborted && (req.aborted || res.destroyed)) return false;
    if (controller.signal.aborted) return route.pathname === '/v1/presentation/health'
      ? sendHealthUnavailable(res, 504)
      : sendError(res, 504, 'ANALYZER_TIMEOUT');
    return route.pathname === '/v1/presentation/health'
      ? sendHealthUnavailable(res, 503)
      : sendError(res, 503, 'ANALYZER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
    req.off?.('aborted', abortWhenClientLeaves);
    res.off?.('close', abortWhenClientLeaves);
  }
}

function sendOptions(req, res, route, allowedOrigins) {
  const origin = String(req.headers?.origin || '');
  const method = String(req.headers?.['access-control-request-method'] || '').toUpperCase();
  const headers = String(req.headers?.['access-control-request-headers'] || '')
    .toLowerCase().split(',').map((value) => value.trim()).filter(Boolean).sort();
  const expected = [...route.headers].sort();
  const simpleScenePreflight = route.simpleJsonBody === true && headers.length === 0;
  if (!origin || !allowedOrigins.has(origin) || method !== route.method
    || (headers.join(',') !== expected.join(',') && !simpleScenePreflight)) {
    logProxyEvent('preflight-rejected', {
      route: route.pathname,
      originAllowed: Boolean(origin && allowedOrigins.has(origin)),
      methodAllowed: method === route.method,
      headersMatched: headers.join(',') === expected.join(','),
      privateNetworkRequested: String(req.headers?.['access-control-request-private-network'] || '').toLowerCase() === 'true',
    });
    return sendError(res, 403, 'PRESENTATION_PREFLIGHT_REJECTED');
  }
  const responseHeaders = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': `${route.method}, OPTIONS`,
    'access-control-allow-headers': route.headers.join(', '),
    'access-control-max-age': '300',
    vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (String(req.headers?.['access-control-request-private-network'] || '').toLowerCase() === 'true') {
    responseHeaders['access-control-allow-private-network'] = 'true';
  }
  logProxyEvent('preflight-accepted', { route: route.pathname, privateNetworkAllowed: Boolean(responseHeaders['access-control-allow-private-network']) });
  res.writeHead(204, responseHeaders);
  return res.end();
}

async function readLimitedBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      const error = new Error('body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validateLoopbackBaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('presentation analyzer must use the fixed loopback HTTP origin');
  }
  return url.origin;
}

function sendHealthUnavailable(res, status) {
  return sendJson(res, status, {
    schemaVersion: 'galgame.presentation-analysis-proxy-health.v1',
    serviceReady: false,
    analyzerConfigured: false,
    diagnosticCode: status === 504 ? 'ANALYZER_TIMEOUT' : 'ANALYZER_UNAVAILABLE',
  });
}

function sendError(res, status, code) {
  return sendJson(res, status, { schemaVersion: 'galgame.presentation-analysis-proxy-error.v1', code });
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return false;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
  return true;
}

function logProxyEvent(event, fields) {
  process.stdout.write(`${JSON.stringify({ event: `presentation-proxy-${event}`, ...fields })}\n`);
}
