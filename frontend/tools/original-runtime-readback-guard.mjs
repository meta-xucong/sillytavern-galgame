/** Structural admission check; behavioral lifecycle tests remain mandatory. */
export function hasOriginalTargetReadback(source, lifecycleSource) {
    const stripComments = (text) => String(text).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    const bridge = stripComments(source);
    const lifecycle = stripComments(lifecycleSource);
    return /import\s*\{\s*waitForOriginalGenerationCompletion\s*\}\s*from\s*['"]\.\/generation-lifecycle\.mjs['"]/u.test(bridge)
        && /readTargetRawChat/u.test(bridge)
        && /currentMatchesTargetBeforeGeneration/u.test(bridge)
        && /const\s+readTargetReplyStatus\s*=\s*async\s*\(\)\s*=>/u.test(bridge)
        && /ORIGINAL_TARGET_CHAT_BINDING_LOST/u.test(bridge)
        && /ORIGINAL_TARGET_CHAT_CHANGED/u.test(bridge)
        && /const\s+finalRawChat\s*=\s*await\s*\(\$\{waitForOriginalGenerationCompletion\.toString\(\)\}\)\(\{/u.test(bridge)
        && /generate:\s*\(\)\s*=>\s*ctx\.generate\(/u.test(bridge)
        && /readReply:\s*readTargetReplyStatus\s*,/u.test(bridge)
        && /snapshot\(finalRawChat,\s*targetChatId\)/u.test(bridge)
        && /await\s+bounded\(generation,\s*timeoutMs,\s*['"]ORIGINAL_GENERATE_TIMEOUT['"]\)/u.test(lifecycle)
        && /lastStatus\s*=\s*await\s+bounded\(readReply\(\)/u.test(lifecycle)
        && lifecycle.indexOf('await bounded(generation,') < lifecycle.indexOf('await bounded(readReply(),')
        && /lastStatus\?\.type\s*===\s*['"]ready['"]\)\s*return\s+lastStatus\.rawChat/u.test(lifecycle);
}
