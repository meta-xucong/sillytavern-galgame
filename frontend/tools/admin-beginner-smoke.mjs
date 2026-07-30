import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || '');
const evidencePath = args.evidence || path.join(repoRoot, '.codex-longrun/evidence/admin-beginner-smoke.json');

const adminHtml = await loadText('/game-admin/index.html', path.join(repoRoot, 'public/game-admin/index.html'));
const adminJs = await loadText('/game-admin/app.js', path.join(repoRoot, 'public/game-admin/app.js'));
const playerHtml = await loadText('/game/index.html', path.join(repoRoot, 'public/game/index.html'));

const result = {
    ok: false,
    baseUrl: baseUrl || 'public-files',
    checks: [],
    failures: [],
};

runCheck('five-section-navigation', () => {
    const tabs = [...adminHtml.matchAll(/data-tab="([^"]+)">([^<]+)<\/button>/g)]
        .map((match) => ({ id: match[1], label: normalizeSpace(match[2]) }));
    assert.deepEqual(tabs.map((tab) => tab.id), ['dashboard', 'publish', 'library', 'enhancements', 'advanced']);
    assert.deepEqual(tabs.map((tab) => tab.label), ['一键导入', '故事上架', '故事库', '画面设置', '更多检查']);
    assert.equal(adminHtml.includes('data-tab="resources"'), false);
    assert.equal(adminHtml.includes('data-tab="presentation"'), false);
    assert.equal(adminHtml.includes('data-tab="arcs"'), false);
    assert.equal(adminHtml.includes('data-tab="media"'), false);
    assert.equal(adminHtml.includes('data-tab="status"'), false);
});

runCheck('dashboard-default-copy-is-beginner-safe', () => {
    const dashboard = extractPanel(adminHtml, 'dashboard');
    assert.ok(dashboard.includes('data-script-assistant-card="upload"'));
    assert.ok(dashboard.includes('上传剧本，一键整理'));
    assert.ok(dashboard.includes('选择剧本文件'));
    assert.ok(dashboard.includes('开始整理'));
    assert.ok(dashboard.includes('重新整理'));
    assert.ok(dashboard.includes('确认草稿'));
    assert.ok(dashboard.includes('1 上传文件'));
    assert.ok(dashboard.includes('2 自动整理'));
    assert.ok(dashboard.includes('3 确认草稿'));
    assert.ok(dashboard.includes('4 上架作品'));
    assert.ok(dashboard.includes('默认推荐故事'));
    assert.ok(dashboard.includes('去上架'));
    assert.ok(dashboard.includes('故事检查'));
    assert.ok(dashboard.includes('回复通道'));
    assert.ok(dashboard.includes('画面增强'));
    assert.equal(dashboard.includes('manifestEditor'), false);
    assert.equal(dashboard.includes('<textarea'), false);
    const text = htmlText(dashboard);
    const forbidden = [
        'raw JSON',
        'schema',
        'manifest',
        'endpoint',
        'proof',
        'runtime',
        'ArcBinding',
        'SillyTavernBindings',
        'worldbook',
        'prompt',
        'preset',
        'API key',
        'token',
        'Token',
        '角色卡',
        '世界书',
        '预设',
    ].filter((term) => text.includes(term));
    assert.deepEqual(forbidden, []);
});

runCheck('publish-wizard-has-advanced-import-only', () => {
    const publish = extractPanel(adminHtml, 'publish');
    const visiblePublish = publish.replace(/<details class="advanced-disclosure">[\s\S]*?<\/details>/, ' ');
    const visibleText = htmlText(visiblePublish);
    assert.ok(publish.includes('选择故事'));
    assert.ok(publish.includes('自动检查'));
    assert.ok(publish.includes('章节和样式'));
    assert.ok(publish.includes('上架给玩家'));
    assert.ok(publish.includes('publishStepList'));
    assert.ok(publish.includes('storyPackageSummary'));
    assert.ok(publish.includes('publishCheckList'));
    assert.ok(publish.includes('wizardTemplateSelect'));
    assert.ok(publish.includes('publishSummary'));
    assert.ok(publish.includes('publishResult'));
    assert.ok(publish.includes('先预览'));
    assert.ok(publish.includes('把草稿上架给玩家'));
    assert.ok(publish.includes('上架后的作品会出现在玩家页面的作品选择里'));
    assert.ok(publish.includes('advanced-disclosure'));
    assert.ok(publish.includes('manifestEditor'));
    assert.ok(htmlText(publish).includes('开发者导入内容'));
    assert.equal(visiblePublish.includes('manifestEditor'), false);
    assert.equal(visiblePublish.includes('fileInput'), false);
    assert.equal(publish.includes('data-script-assistant-card="upload"'), false);
    assert.equal(visibleText.includes('已导入'), false);
    assert.equal(visibleText.includes('已发布'), false);
    assert.equal(publish.includes('type="password"'), false);
    assert.equal(/admin.*token|token.*admin|Authorization|Bearer/i.test(publish), false);
});

runCheck('script-assistant-admin-code-is-readonly-and-no-secret-ui', () => {
    const requestSurface = stripFunctionSource(adminJs, 'formatScriptAssistantWarning');
    assert.ok(adminJs.includes('/v1/admin/script-import/drafts'));
    assert.ok(adminJs.includes('ready-for-publish') || adminJs.includes('可上架故事入口'));
    assert.ok(adminJs.includes("credentials: 'include'"));
    assert.equal(adminJs.includes('localStorage'), false);
    assert.equal(/['"]Authorization['"]\s*:/.test(requestSurface), false);
    assert.equal(/Authorization\s*:/i.test(requestSurface), false);
    assert.equal(/Bearer\s+\$\{|Bearer\s+['"`]|Bearer\s*\+/.test(requestSurface), false);
    assert.ok(adminJs.includes('formatScriptAssistantWarning'));
    assert.ok(/SCRIPT_IMPORT_LLM_|https?:\/\/|Bearer\\s\+|token|api\[_-\]\?key|provider/i.test(adminJs));
    assert.equal(adminJs.includes('/api/backends/chat-completions/generate'), false);
    assert.equal(adminJs.includes('/api/novelai/generate'), false);
});

runCheck('enhancements-are-separated-from-original-capabilities', () => {
    const enhancements = extractPanel(adminHtml, 'enhancements');
    const text = htmlText(enhancements);
    const cardIds = [...enhancements.matchAll(/data-enhancement-card="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(cardIds, [
        'display-template',
        'media-provider',
        'visual-assets',
        'content-notice',
        'service-check',
    ]);
    assert.ok(text.includes('游戏界面样式'));
    assert.ok(text.includes('图片和视频接口'));
    assert.ok(text.includes('背景和立绘'));
    assert.ok(text.includes('内容提示'));
    assert.ok(text.includes('服务检查'));
    assert.ok(text.includes('只影响显示'));
    assert.ok(text.includes('只影响画面'));
    assert.ok(text.includes('不影响剧情'));
    assert.ok(text.includes('不写剧情'));
    assert.ok(text.includes('密钥不放这里'));
    assert.ok(text.includes('外部媒体服务中配置'));
    assert.ok(enhancements.includes('profileModuleList'));
    assert.ok(enhancements.includes('mediaEndpointInput'));
    assert.equal(text.includes('角色卡'), false);
    assert.equal(text.includes('世界书'), false);
    assert.equal(text.includes('预设'), false);
    assert.equal(text.includes('模型'), false);
    assert.equal(text.includes('Token'), false);
    assert.equal(text.includes('API key'), false);
    assert.equal(enhancements.includes('type="password"'), false);
});

runCheck('library-uses-beginner-story-and-version-cards', () => {
    const library = extractPanel(adminHtml, 'library');
    const text = htmlText(library);
    assert.ok(library.includes('storyLibrarySummary'));
    assert.ok(library.includes('save-binding-note'));
    assert.ok(library.includes('releaseHistory'));
    assert.ok(text.includes('已有存档不会被改动'));
    assert.ok(adminJs.includes('恢复到这个版本'));
    assert.ok(adminJs.includes('已有存档仍按各自记录继续'));
    assert.equal(text.includes('manifest'), false);
    assert.equal(text.includes('schema'), false);
    assert.equal(text.includes('endpoint'), false);
    assert.equal(text.includes('proof'), false);
    assert.equal(text.includes('runtime'), false);
    assert.equal(text.includes('ArcBindingV1'), false);
    assert.equal(text.includes('SillyTavernBindingsV1'), false);
    assert.equal(text.includes('raw JSON'), false);
});

runCheck('advanced-check-retains-diagnostics-and-security-warning', () => {
    const advanced = extractPanel(adminHtml, 'advanced');
    const text = htmlText(advanced);
    assert.ok(text.includes('更多检查'));
    assert.ok(text.includes('安全提醒'));
    assert.ok(text.includes('不等于登录保护'));
    assert.ok(text.includes('反向代理'));
    assert.ok(text.includes('密钥'));
    assert.ok(advanced.includes('resourceResult'));
    assert.ok(advanced.includes('resourceLiveResult'));
    assert.ok(advanced.includes('referenceEvidenceList'));
    assert.ok(advanced.includes('runtimeEvidenceList'));
    assert.ok(advanced.includes('deferredEvidenceList'));
    assert.ok(text.includes('引用存在'));
    assert.ok(text.includes('运行中验证'));
    assert.ok(text.includes('暂未接入'));
    assert.ok(text.includes('不代表它们已经在本次回复中生效'));
    assert.ok(text.includes('隐藏只是降低误触，不等于登录保护'));
    assert.ok(advanced.includes('characterBindingList'));
    assert.ok(advanced.includes('worldBookBindingList'));
    assert.ok(advanced.includes('settingBindingList'));
    assert.ok(advanced.includes('systemStatus'));
});

runCheck('admin-code-preserves-no-claim-runtime-wording', () => {
    assert.ok(adminJs.includes('运行中验证只对已有证据的项目显示通过'));
    assert.ok(adminJs.includes('资源本体仍由原版维护入口维护'));
    assert.equal(adminJs.includes('/api/backends/chat-completions/generate'), false);
    assert.equal(adminJs.includes('/api/novelai/generate'), false);
});

runCheck('player-route-has-no-admin-entry', () => {
    const playerText = htmlText(playerHtml);
    const playerLinks = [...playerHtml.matchAll(/<(?:a|button)[^>]*(?:href|data-tab)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:a|button)>/g)]
        .map((match) => `${match[1]} ${htmlText(match[2])}`);
    const candidates = [playerText, ...playerLinks].filter((text) => /game-admin|后台|管理端|管理员|高级检查|更多检查|上架故事|作品库/.test(text));
    assert.deepEqual(candidates, []);
});

result.ok = result.failures.length === 0;
await writeFile(evidencePath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
    process.exitCode = 1;
}

function runCheck(name, fn) {
    try {
        fn();
        result.checks.push({ name, ok: true });
    } catch (error) {
        result.checks.push({ name, ok: false, error: error.message });
        result.failures.push(`${name}: ${error.message}`);
    }
}

async function loadText(urlPath, localPath) {
    if (baseUrl) {
        try {
            const response = await fetch(`${baseUrl}${urlPath === '/game-admin/index.html' ? '/game-admin/' : urlPath === '/game/index.html' ? '/game/' : urlPath}`);
            if (response.ok) {
                return response.text();
            }
        } catch {
            // Fall back to public build output below.
        }
    }
    return readFile(localPath, 'utf8');
}

function extractPanel(html, panelName) {
    const marker = `data-panel="${panelName}"`;
    const start = html.indexOf(marker);
    assert.notEqual(start, -1, `missing panel ${panelName}`);
    const sectionStart = html.lastIndexOf('<section', start);
    const nextPanel = html.indexOf('data-panel="', start + marker.length);
    const sectionEnd = nextPanel === -1 ? html.indexOf('</section>', start) + '</section>'.length : html.lastIndexOf('<section', nextPanel);
    return html.slice(sectionStart, sectionEnd);
}

function htmlText(value) {
    return normalizeSpace(String(value || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>'));
}

function normalizeSpace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripFunctionSource(source, functionName) {
    const marker = `function ${functionName}`;
    const start = source.indexOf(marker);
    if (start === -1) {
        return source;
    }
    const open = source.indexOf('{', start);
    if (open === -1) {
        return source;
    }
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return `${source.slice(0, start)}\n/* stripped ${functionName} for request-surface scan */\n${source.slice(index + 1)}`;
            }
        }
    }
    return source;
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value.startsWith('--')) {
            parsed[value.slice(2)] = values[index + 1] || '';
            index += 1;
        }
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}
