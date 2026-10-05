import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateVisualServiceReadiness } from '../src/visual-service-health.js';

const catalog = {
    catalogId: 'galgame_player_catalog_test',
    catalogRevision: 3,
    catalogHash: `sha256:${'a'.repeat(64)}`,
};
const context = {
    ok: true,
    enabled: true,
    activeCatalog: { ...catalog },
    visualProfile: {
        visualProfileId: 'vprof_player_test',
        profileHash: `sha256:${'b'.repeat(64)}`,
        ...catalog,
    },
};
const analyzer = {
    serviceReady: true,
    analyzerConfigured: true,
    analyzerScope: 'test:presentation.v1',
    sceneAnalyzerScope: 'test:scene-continuity.v1',
    diagnosticCode: 'ready',
};

test('visual readiness requires an enabled published catalog and both analyzers', () => {
    const result = evaluateVisualServiceReadiness({
        contextHttpOk: true,
        contextStatus: 200,
        visualContext: context,
        presentationHealth: analyzer,
    });
    assert.deepEqual(result, {
        ok: true,
        catalogReady: true,
        analyzerReady: true,
        errorCode: '',
        enabled: true,
        catalogId: catalog.catalogId,
    });
});

test('an HTTP-success response with a disabled catalog is not visual-ready', () => {
    const result = evaluateVisualServiceReadiness({
        contextHttpOk: true,
        contextStatus: 200,
        visualContext: { ...context, enabled: false, visualProfile: null },
        presentationHealth: analyzer,
    });
    assert.equal(result.ok, false);
    assert.equal(result.catalogReady, false);
    assert.equal(result.errorCode, 'VISUAL_CATALOG_DISABLED');
});

test('an incomplete or mismatched catalog profile is not visual-ready', () => {
    const result = evaluateVisualServiceReadiness({
        contextHttpOk: true,
        contextStatus: 200,
        visualContext: {
            ...context,
            visualProfile: { ...context.visualProfile, catalogHash: `sha256:${'c'.repeat(64)}` },
        },
        presentationHealth: analyzer,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'VISUAL_CATALOG_CONTEXT_INCOMPLETE');
    assert.equal(result.catalogId, '');
});

test('missing active catalog identity fields are not visual-ready', () => {
    const result = evaluateVisualServiceReadiness({
        contextHttpOk: true,
        contextStatus: 200,
        visualContext: { ...context, activeCatalog: null },
        presentationHealth: analyzer,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'VISUAL_CATALOG_CONTEXT_INCOMPLETE');
});

test('both analyzer scopes must be reported before the visual path is ready', () => {
    const result = evaluateVisualServiceReadiness({
        contextHttpOk: true,
        contextStatus: 200,
        visualContext: context,
        presentationHealth: { ...analyzer, sceneAnalyzerScope: null },
    });
    assert.equal(result.ok, false);
    assert.equal(result.catalogReady, true);
    assert.equal(result.analyzerReady, false);
    assert.equal(result.errorCode, 'PRESENTATION_ANALYZER_SCOPE_INCOMPLETE');
});

test('both presentation and scene-continuity scopes are required', () => {
    const result = evaluateVisualServiceReadiness({
        contextHttpOk: true,
        contextStatus: 200,
        visualContext: context,
        presentationHealth: { ...analyzer, analyzerScope: null },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'PRESENTATION_ANALYZER_SCOPE_INCOMPLETE');
});

test('unavailable context and analyzers expose bounded diagnostic codes', () => {
    const contextFailure = evaluateVisualServiceReadiness({ contextHttpOk: false, contextStatus: 503, presentationHealth: analyzer });
    assert.equal(contextFailure.errorCode, 'VISUAL_SERVICE_HTTP_503');

    const analyzerFailure = evaluateVisualServiceReadiness({
        contextHttpOk: true,
        contextStatus: 200,
        visualContext: context,
        presentationHealth: { ...analyzer, analyzerConfigured: false, diagnosticCode: 'analyzer-not-configured' },
    });
    assert.equal(analyzerFailure.errorCode, 'analyzer-not-configured');
});
