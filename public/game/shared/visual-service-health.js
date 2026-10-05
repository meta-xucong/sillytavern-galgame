const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/iu;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}$/iu;

/**
 * Evaluate the full player visual path: an enabled published catalog with a
 * matching profile, plus both presentation analyzers required by the player.
 */
export function evaluateVisualServiceReadiness({
    contextHttpOk = false,
    contextStatus = 0,
    visualContext = null,
    presentationHealth = null,
} = {}) {
    const activeCatalog = visualContext?.activeCatalog;
    const profile = visualContext?.visualProfile;
    const catalogReady = contextHttpOk
        && visualContext?.ok === true
        && visualContext?.enabled === true
        && isValidId(activeCatalog?.catalogId)
        && Number.isSafeInteger(activeCatalog?.catalogRevision)
        && activeCatalog.catalogRevision > 0
        && SHA256_PATTERN.test(String(activeCatalog?.catalogHash || ''))
        && isValidId(profile?.visualProfileId)
        && SHA256_PATTERN.test(String(profile?.profileHash || ''))
        && profile?.catalogId === activeCatalog.catalogId
        && profile?.catalogRevision === activeCatalog.catalogRevision
        && profile?.catalogHash === activeCatalog.catalogHash;
    const analyzerReady = presentationHealth?.serviceReady === true
        && presentationHealth?.analyzerConfigured === true
        && isNonEmptyString(presentationHealth?.analyzerScope)
        && isNonEmptyString(presentationHealth?.sceneAnalyzerScope);

    let errorCode = '';
    if (!contextHttpOk) errorCode = `VISUAL_SERVICE_HTTP_${Number(contextStatus) || 0}`;
    else if (visualContext?.ok !== true) errorCode = 'VISUAL_CATALOG_UNAVAILABLE';
    else if (visualContext.enabled !== true) errorCode = 'VISUAL_CATALOG_DISABLED';
    else if (!catalogReady) errorCode = 'VISUAL_CATALOG_CONTEXT_INCOMPLETE';
    else if (!analyzerReady) {
        errorCode = presentationHealth?.serviceReady === true && presentationHealth?.analyzerConfigured === true
            ? 'PRESENTATION_ANALYZER_SCOPE_INCOMPLETE'
            : presentationHealth?.diagnosticCode || 'PRESENTATION_ANALYZER_UNAVAILABLE';
    }

    return {
        ok: catalogReady && analyzerReady,
        catalogReady,
        analyzerReady,
        errorCode,
        enabled: visualContext?.enabled === true,
        catalogId: catalogReady ? activeCatalog.catalogId : '',
    };
}

function isValidId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
