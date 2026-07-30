# Media Gateway

This optional service is the only place that should know how to call the user's
future image or video generation software.

The player and admin frontends only depend on the provider-neutral task API.

## Local Prototype

This folder includes a minimal standalone Node gateway:

```powershell
node external-modules/media-gateway/server.mjs
```

By default it listens on `127.0.0.1:8792`. The current implementation is a
mock provider: it preserves the real task protocol, idempotency, and job lookup
shape, then returns a generated SVG placeholder result. Replace the provider
internals later when the user's image/video software is ready.

Override with:

- `HOST`
- `PORT`
- `MEDIA_GATEWAY_CORS_ORIGIN`
- `MEDIA_GATEWAY_MOCK_DELAY_MS`

## Health

```http
GET /v1/health
```

## Create Job

```http
POST /v1/media/jobs
Content-Type: application/json
Idempotency-Key: <releaseId>:<sessionId>:<eventId>
```

The request body is defined in
`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`.

## Get Job

```http
GET /v1/media/jobs/{jobId}
```

The gateway must support idempotency, timeout, retryable failure reporting, and
stable result URLs or a cache layer. Media failure must not block normal story
progress.
