"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
exports.buildChatCompletionsUrls = buildChatCompletionsUrls;
exports.probeEndpoint = probeEndpoint;
const vscode = __importStar(require("vscode"));
const CONFIG_SECTION = 'simpleAutoComplete';
const SECRET_TOKEN_KEY = 'simpleAutoComplete.apiToken';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:1234';
const DEFAULT_TIMEOUT_MS = 3000;
const SELF_TEST_TIMEOUT_MS = 20000;
const STATUS_IDLE = '$(zap) Auto Complete';
const STATUS_BUSY = '$(sync~spin) Generating...';
const STATUS_ERROR = '$(warning) Auto Complete';
/** Hard cap on thinking-off retries, so a failing request cannot burn the whole timeout budget. */
const MAX_ATTEMPTS = 4;
/** Do not repeat the same warning notification more often than this. */
const NOTIFICATION_COOLDOWN_MS = 60000;
/** Default for `simpleAutoComplete.triggerDelay`: how long the editor must stay idle. */
const DEFAULT_TRIGGER_DELAY_MS = 800;
/** A completion is reused for this long, so a follow-up automatic call costs no extra request. */
const RESULT_CACHE_MS = 5000;
/** After a forced trigger the pause rule is ignored for this long, so the request goes through. */
const FORCE_WINDOW_MS = 2000;
/** A request failure that already carries a user-facing explanation. */
class RequestFailure extends Error {
    kind;
    detail;
    status;
    constructor(message, kind, detail = '', status) {
        super(message);
        this.name = 'RequestFailure';
        this.kind = kind;
        this.detail = detail;
        this.status = status;
    }
}
/** Model documented for each cloud family, used when `simpleAutoComplete.model` is empty. */
const DEFAULT_MODEL = {
    openai: 'gpt-4o-mini',
    deepseek: 'deepseek-flash',
    qwen: 'qwen3.8-max',
    glm: 'glm-4.5',
    kimi: 'kimi-k2.6',
};
let statusBarItem;
let outputChannel;
function activate(context) {
    // 创建状态栏项用于显示扩展状态
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = STATUS_IDLE;
    statusBarItem.show();
    outputChannel = vscode.window.createOutputChannel('Simple Auto Complete');
    // 停顿计时器决定“什么时候”请求补全，真正的请求由内联补全提供者完成
    const trigger = new InlineTriggerController();
    const aiCompletionProvider = new AIInlineCompletionProvider(context, statusBarItem, trigger);
    context.subscriptions.push(
    // 注册内联补全提供者（VS Code 原生补全接口，显示为灰色幽灵文本）
    vscode.languages.registerInlineCompletionItemProvider('*', aiCompletionProvider), vscode.commands.registerCommand('simpleAutoComplete.triggerCompletion', () => trigger.forceTrigger()), vscode.commands.registerCommand('simpleAutoComplete.setApiToken', () => setApiToken(context)), vscode.commands.registerCommand('simpleAutoComplete.clearApiToken', () => clearApiToken(context)), vscode.commands.registerCommand('simpleAutoComplete.showLogs', () => outputChannel?.show(true)), vscode.commands.registerCommand('simpleAutoComplete.testConnection', () => testConnection(context)), vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
            syncEnabledContext();
            void refreshStatusTooltip(context);
        }
        if (event.affectsConfiguration(`${CONFIG_SECTION}.apiEndpoint`) || event.affectsConfiguration(`${CONFIG_SECTION}.apiToken`)) {
            void checkEndpoint(context);
        }
        if (event.affectsConfiguration('editor.inlineSuggest.enabled')) {
            void warnIfInlineSuggestDisabled();
        }
    }), trigger, outputChannel, 
    // 添加至VSCode订阅管理
    statusBarItem);
    syncEnabledContext();
    trigger.start();
    void refreshStatusTooltip(context);
    void checkEndpoint(context);
    void warnIfInlineSuggestDisabled();
}
function deactivate() {
    statusBarItem?.dispose();
    statusBarItem = undefined;
    outputChannel?.dispose();
    outputChannel = undefined;
}
/** Every diagnostic goes to the "Simple Auto Complete" output channel; users never need the dev console. */
function log(message) {
    outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
    console.log(`Simple Auto Complete: ${message}`);
}
function readSettings() {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
        enabled: config.get('enable', true),
        provider: config.get('provider', 'auto'),
        endpoint: (config.get('apiEndpoint', DEFAULT_ENDPOINT) || DEFAULT_ENDPOINT).trim(),
        model: (config.get('model', '') || '').trim(),
        disableThinking: config.get('disableThinking', true),
        timeOutMs: config.get('timeOut', DEFAULT_TIMEOUT_MS),
        triggerDelayMs: config.get('triggerDelay', DEFAULT_TRIGGER_DELAY_MS),
        maxContextLines: config.get('maxContextLines', 20),
        maxTokens: config.get('maxTokens', 128),
        extraRequestBody: config.get('extraRequestBody', '') || '',
    };
}
async function readApiToken(context) {
    try {
        const stored = await context.secrets.get(SECRET_TOKEN_KEY);
        if (stored && stored.trim().length > 0) {
            return stored.trim();
        }
    }
    catch {
        // Secret storage unavailable; fall through to the setting.
    }
    const token = vscode.workspace.getConfiguration(CONFIG_SECTION).get('apiToken', '') || '';
    return token.trim();
}
function endpointHost(endpoint) {
    try {
        return new URL(endpoint).hostname.toLowerCase();
    }
    catch {
        return endpoint.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    }
}
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'host.docker.internal'];
/**
 * Decide which thinking-off dialect to use.
 * Priority: explicit setting -> endpoint host -> model name -> generic.
 */
function detectFamily(kind, endpoint, model) {
    switch (kind) {
        case 'lmstudio': return 'local';
        case 'openai': return 'openai';
        case 'deepseek': return 'deepseek';
        case 'qwen': return 'qwen';
        case 'glm': return 'glm';
        case 'kimi': return 'kimi';
        default: break;
    }
    const host = endpointHost(endpoint);
    if (host.includes('deepseek')) {
        return 'deepseek';
    }
    if (host.includes('dashscope') || host.includes('aliyuncs') || host.includes('bailian')) {
        return 'qwen';
    }
    if (host.includes('bigmodel') || host.includes('z.ai') || host.includes('volces') || host.includes('ark.cn')) {
        return 'glm';
    }
    if (host.includes('moonshot') || host.includes('kimi')) {
        return 'kimi';
    }
    if (host.includes('openai.com')) {
        return 'openai';
    }
    if (LOOPBACK_HOSTS.includes(host)) {
        return 'local';
    }
    const name = model.trim().toLowerCase();
    if (name.length > 0) {
        if (name.startsWith('deepseek')) {
            return 'deepseek';
        }
        if (name.startsWith('qwen')) {
            return 'qwen';
        }
        if (name.startsWith('glm') || name.startsWith('chatglm') || name.startsWith('autoglm')) {
            return 'glm';
        }
        if (name.startsWith('kimi') || name.startsWith('moonshot')) {
            return 'kimi';
        }
        if (isReasoningModel(name)) {
            return 'openai';
        }
    }
    return 'generic';
}
/**
 * Candidate chat/completions URLs for a configured endpoint.
 *
 * Providers disagree about the path, so nothing is assumed: the second entry is only used when
 * the first answers 404/405, and the variant that worked is remembered for later requests.
 */
function buildChatCompletionsUrls(endpoint) {
    const base = endpoint.trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(base)) {
        return [base];
    }
    if (/\/v\d+(\.\d+)?$/i.test(base)) {
        return [`${base}/chat/completions`, `${base.replace(/\/v\d+(\.\d+)?$/i, '')}/chat/completions`];
    }
    return [`${base}/v1/chat/completions`, `${base}/chat/completions`];
}
const O_SERIES_MODEL = /^o[1-9](\b|[-.])/;
/** OpenAI reasoning models reject or ignore most sampling parameters. */
function isReasoningModel(model) {
    const name = model.trim().toLowerCase();
    return O_SERIES_MODEL.test(name) || /^gpt-([5-9]|[1-9]\d)/.test(name) || /^gpt-oss/.test(name);
}
function templateToggle() {
    return { chat_template_kwargs: { enable_thinking: false } };
}
function enableToggle() {
    return { enable_thinking: false };
}
function typeToggle() {
    return { thinking: { type: 'disabled' } };
}
function reasoningToggle() {
    return { reasoning: { enabled: false } };
}
/**
 * Ordered list of payload variants to try when `disableThinking` is on.
 *
 * The first entry is the provider's native switch, so the common case costs exactly one
 * request. The remaining entries only run when the server rejects the field or answers with
 * reasoning but no content, which is how a wrong dialect usually shows up.
 */
function thinkingOffAttempts(family, settings) {
    if (!settings.disableThinking) {
        return [{ label: 'as-is', params: {} }];
    }
    let attempts;
    switch (family) {
        case 'deepseek':
            attempts = [
                { label: 'thinking.type+reasoning_effort', params: { thinking: { type: 'disabled' }, reasoning_effort: 'none' } },
                { label: 'thinking.type', params: typeToggle() },
                { label: 'enable_thinking', params: enableToggle() },
                { label: 'chat_template_kwargs', params: templateToggle() },
                { label: 'reasoning', params: reasoningToggle() },
            ];
            break;
        case 'qwen':
            attempts = [
                { label: 'enable_thinking', params: enableToggle() },
                { label: 'chat_template_kwargs', params: templateToggle() },
                { label: 'thinking.type', params: typeToggle() },
                { label: 'reasoning', params: reasoningToggle() },
            ];
            break;
        case 'glm':
        case 'kimi':
            attempts = [
                { label: 'thinking.type', params: typeToggle() },
                { label: 'enable_thinking', params: enableToggle() },
                { label: 'chat_template_kwargs', params: templateToggle() },
                { label: 'reasoning', params: reasoningToggle() },
            ];
            break;
        case 'local':
            attempts = [
                { label: 'chat_template_kwargs', params: templateToggle() },
                { label: 'enable_thinking', params: enableToggle() },
                { label: 'thinking.type', params: typeToggle() },
            ];
            break;
        case 'openai':
            return isReasoningModel(settings.model)
                ? [
                    { label: 'reasoning_effort:none', params: { reasoning_effort: 'none' } },
                    { label: 'reasoning_effort:minimal', params: { reasoning_effort: 'minimal' } },
                ]
                : [{ label: 'as-is', params: {} }]; // Non-reasoning OpenAI models have nothing to disable.
        default:
            // Aggregators and unknown endpoints: send the common switches together, then narrow down.
            attempts = [
                { label: 'chat_template_kwargs+enable_thinking', params: { ...templateToggle(), ...enableToggle() } },
                { label: 'thinking.type', params: typeToggle() },
                { label: 'reasoning', params: reasoningToggle() },
            ];
            break;
    }
    // The final attempt always sends no thinking field at all, so a server that rejects
    // every dialect still produces a completion instead of nothing.
    return [...attempts.slice(0, MAX_ATTEMPTS - 1), { label: 'none', params: {} }];
}
/**
 * Build the chat/completions payload.
 *
 * Speed first: low temperature, a small completion budget, no thinking, and (for non-OpenAI
 * endpoints) only the parameters every provider supports, since several 国模 APIs reject
 * unknown or deprecated fields.
 */
function buildRequestBody(family, settings, thinkingParams, fileType, fileName, contextCode) {
    const prompt = [
        `You are an expert ${fileType} language Code Assistant.`,
        'Please complete the code.',
        'Output ONLY the code that should be added, NO markdown, NO backticks, NO explanations, NO reasoning.',
        'DO NOT repeat any code from context.',
        '',
        `"${fileName}" context:`,
        contextCode,
        '',
    ].join('\n');
    const body = {
        model: settings.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: settings.maxTokens,
        stop: ['<|endoftext|>', '\n\n'],
        stream: false,
    };
    if (family === 'openai') {
        // Newer OpenAI models require max_completion_tokens and reject max_tokens.
        delete body.max_tokens;
        body.max_completion_tokens = settings.maxTokens;
        if (isReasoningModel(settings.model)) {
            delete body.temperature;
            if (O_SERIES_MODEL.test(settings.model.trim().toLowerCase())) {
                delete body.stop;
            }
        }
        else {
            body.top_p = 0.95;
            body.frequency_penalty = 0;
            body.presence_penalty = 0;
        }
    }
    if (settings.disableThinking) {
        Object.assign(body, thinkingParams);
    }
    if (settings.extraRequestBody.trim().length > 0) {
        try {
            const extra = JSON.parse(settings.extraRequestBody);
            if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
                Object.assign(body, extra);
            }
        }
        catch {
            log('Ignoring invalid simpleAutoComplete.extraRequestBody JSON.');
        }
    }
    return body;
}
/** Turn an error payload into a short, readable line for notifications. */
function extractApiMessage(detail) {
    const text = (detail ?? '').trim();
    if (text.length === 0) {
        return '';
    }
    try {
        const parsed = JSON.parse(text);
        const nested = typeof parsed.error === 'object' && parsed.error !== null
            ? parsed.error.message
            : parsed.error;
        const message = typeof nested === 'string'
            ? nested
            : (typeof parsed.message === 'string' ? parsed.message : parsed.msg);
        if (typeof message === 'string' && message.trim().length > 0) {
            return message.trim();
        }
    }
    catch {
        // Not JSON; fall back to the raw text.
    }
    return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}
/** Web consoles and WAFs answer with HTML; that must never be dumped into a notification. */
function looksLikeHtml(text) {
    const head = text.trimStart().slice(0, 200).toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml');
}
function extractHtmlTitle(text) {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}
/** One readable line for any error body, whatever the endpoint answered with. */
function describeErrorBody(status, statusText, detail) {
    if (looksLikeHtml(detail)) {
        const title = extractHtmlTitle(detail);
        return `HTTP ${status}: the endpoint returned an HTML page${title ? ` ("${title}")` : ''} instead of an API response`;
    }
    const apiMessage = extractApiMessage(detail);
    if (apiMessage.length > 0) {
        return `HTTP ${status}: ${apiMessage}`;
    }
    return `HTTP ${status} ${statusText}`.trim();
}
/** Keep huge HTML pages out of the log; JSON errors are logged in full. */
function shortBodyForLog(detail) {
    if (detail.length === 0) {
        return '(empty)';
    }
    if (looksLikeHtml(detail)) {
        return `(HTML page, ${detail.length} chars) ${detail.replace(/\s+/g, ' ').slice(0, 200)}`;
    }
    return detail.slice(0, 1000);
}
/** Only retry the next thinking dialect when the server actually complained about our field. */
function looksLikeRejectedThinkingField(status, detail, params) {
    if (status !== 400 && status !== 422) {
        return false;
    }
    const text = detail.toLowerCase();
    if (text.trim().length === 0) {
        return true; // No body: assume the extra field is the problem.
    }
    const hints = ['thinking', 'reasoning', 'chat_template', 'unknown', 'unrecognized', 'unsupported', 'extra', 'not permitted'];
    const fieldNames = Object.keys(params).map((key) => key.toLowerCase());
    return hints.some((hint) => text.includes(hint)) || fieldNames.some((name) => name.length > 0 && text.includes(name));
}
function isPathMismatch(status) {
    return status === 404 || status === 405;
}
function describeNetworkError(error, url) {
    // fetch() reports "fetch failed" and hides the real reason in `cause`.
    const cause = error.cause;
    const reason = [error.message, cause?.message].filter((part) => typeof part === 'string' && part.length > 0).join(' / ');
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(reason)) {
        return `Cannot resolve the host of ${url}. Check "simpleAutoComplete.apiEndpoint".`;
    }
    if (/ECONNREFUSED/i.test(reason)) {
        return `Connection refused by ${url}. Is the local AI server running?`;
    }
    if (/CERT|TLS|SSL/i.test(reason)) {
        return `TLS error while talking to ${url}: ${reason}`;
    }
    return `Network error while talking to ${url}: ${reason || 'unknown reason'}`;
}
/** How long the endpoint probe may take before it gives up. */
const PROBE_TIMEOUT_MS = 8000;
/**
 * Ask the address itself whether it is a usable API.
 *
 * There is no list of known hosts here: a single lightweight GET is classified from the real
 * answer. An HTML page means a website or a firewall (vendor consoles and WAFs answer that
 * way), while any other HTTP answer means the URL reaches something that speaks the API
 * protocol and merely rejected the unauthenticated request - which is what a working endpoint
 * does. This also works for private deployments that no hardcoded list could cover.
 */
async function probeEndpoint(endpoint, apiToken, timeoutMs = PROBE_TIMEOUT_MS) {
    const urls = buildChatCompletionsUrls(endpoint);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let result;
    try {
        for (const url of urls) {
            const started = Date.now();
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: apiToken.length > 0 ? { Authorization: `Bearer ${apiToken}` } : {},
                    signal: controller.signal,
                });
                const elapsed = Date.now() - started;
                const contentType = response.headers.get('content-type') ?? '';
                const text = await response.text().catch(() => '');
                if (contentType.includes('text/html') || looksLikeHtml(text)) {
                    const title = extractHtmlTitle(text);
                    result = {
                        url,
                        verdict: 'html',
                        status: response.status,
                        summary: `answered with an HTML page${title ? ` ("${title}")` : ''} (HTTP ${response.status}) instead of an API response`,
                    };
                    continue; // The other path variant may still be the real API.
                }
                return {
                    url,
                    verdict: 'reachable',
                    status: response.status,
                    summary: `answered with HTTP ${response.status} in ${elapsed} ms, which is an API response`,
                };
            }
            catch (error) {
                result = {
                    url,
                    verdict: 'unreachable',
                    summary: error.name === 'AbortError'
                        ? `did not answer within ${timeoutMs} ms`
                        : describeNetworkError(error, url),
                };
            }
        }
    }
    finally {
        clearTimeout(timeoutId);
    }
    return result ?? { url: urls[0], verdict: 'unreachable', summary: 'no response' };
}
let lastEndpointProbe = null;
const endpointWarned = new Set();
/**
 * Probe the configured endpoint in the background (on startup and whenever the address or the
 * token changes) so a wrong address is reported before it silently breaks completions.
 */
async function checkEndpoint(context) {
    const settings = readSettings();
    if (settings.endpoint.length === 0) {
        return null;
    }
    const apiToken = await readApiToken(context);
    const probe = await probeEndpoint(settings.endpoint, apiToken);
    lastEndpointProbe = { endpoint: settings.endpoint, probe };
    log(`Endpoint check: ${probe.url} -> ${probe.verdict} (${probe.summary})`);
    // A local server simply not running is normal; a website or an unreachable remote host is not.
    const worthReporting = probe.verdict === 'html'
        || (probe.verdict === 'unreachable' && !LOOPBACK_HOSTS.includes(endpointHost(settings.endpoint)));
    if (worthReporting && !endpointWarned.has(settings.endpoint)) {
        endpointWarned.add(settings.endpoint);
        const message = probe.verdict === 'html'
            ? `"${settings.endpoint}" ${probe.summary}. That is a website, not an API — use the API base URL from your provider.`
            : `"${settings.endpoint}" could not be reached: ${probe.summary}`;
        void vscode.window.showWarningMessage(`Simple Auto Complete: ${message}`, 'Test Connection', 'Open Settings').then((choice) => {
            if (choice === 'Test Connection') {
                void vscode.commands.executeCommand('simpleAutoComplete.testConnection');
            }
            if (choice === 'Open Settings') {
                void openSettings();
            }
        });
    }
    await refreshStatusTooltip(context);
    return probe;
}
async function setApiToken(context) {
    const value = await vscode.window.showInputBox({
        title: 'Simple Auto Complete: API Token',
        prompt: 'Stored in VS Code Secret Storage (never written to settings.json). Leave empty to clear.',
        placeHolder: 'sk-...',
        password: true,
        ignoreFocusOut: true,
    });
    if (value === undefined) {
        return;
    }
    const token = value.trim();
    if (token.length === 0) {
        await context.secrets.delete(SECRET_TOKEN_KEY);
        void vscode.window.showInformationMessage('Simple Auto Complete: API token cleared.');
    }
    else {
        await context.secrets.store(SECRET_TOKEN_KEY, token);
        void vscode.window.showInformationMessage('Simple Auto Complete: API token saved securely.');
    }
    await refreshStatusTooltip(context);
}
async function clearApiToken(context) {
    await context.secrets.delete(SECRET_TOKEN_KEY);
    void vscode.window.showInformationMessage('Simple Auto Complete: API token cleared.');
    await refreshStatusTooltip(context);
}
async function openSettings() {
    await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION);
}
/** Mirror `simpleAutoComplete.enable` into a context key so the Ctrl+Tab keybinding can yield to VS Code. */
function syncEnabledContext() {
    void vscode.commands.executeCommand('setContext', `${CONFIG_SECTION}.enabled`, readSettings().enabled);
}
/** Inline completions are the built-in ghost-text UI; VS Code must have it switched on to render them. */
async function warnIfInlineSuggestDisabled() {
    const enabled = vscode.workspace.getConfiguration('editor').get('inlineSuggest.enabled', true);
    if (enabled) {
        return;
    }
    log('editor.inlineSuggest.enabled is false; VS Code cannot display inline completions.');
    const choice = await vscode.window.showWarningMessage('Simple Auto Complete shows completions as inline suggestions, so "editor.inlineSuggest.enabled" has to be on.', 'Enable It');
    if (choice === 'Enable It') {
        await vscode.workspace
            .getConfiguration('editor')
            .update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global);
    }
}
async function refreshStatusTooltip(context) {
    if (!statusBarItem) {
        return;
    }
    const settings = readSettings();
    const family = detectFamily(settings.provider, settings.endpoint, settings.model);
    const model = settings.model || DEFAULT_MODEL[family] || '(server default)';
    const token = await readApiToken(context);
    const probe = lastEndpointProbe && lastEndpointProbe.endpoint === settings.endpoint ? lastEndpointProbe.probe : null;
    statusBarItem.tooltip = new vscode.MarkdownString([
        '**Simple Auto Complete**',
        '',
        `- Enabled: \`${settings.enabled}\``,
        `- API family: \`${family}\` (setting: \`${settings.provider}\`)`,
        `- Endpoint: \`${settings.endpoint}\``,
        ...(probe
            ? [probe.verdict === 'reachable'
                    ? `- Endpoint check: ✅ \`${probe.url}\` ${probe.summary}`
                    : `- Endpoint check: ⚠ \`${probe.url}\` ${probe.summary}`]
            : []),
        `- Model: \`${model}\``,
        `- Thinking disabled: \`${settings.disableThinking}\``,
        `- API token: ${token.length > 0 ? `configured (${token.length} chars)` : 'not set'}`,
        `- Timeout: \`${settings.timeOutMs} ms\``,
        `- Idle delay: \`${settings.triggerDelayMs} ms\``,
    ].join('\n'));
}
/**
 * Real request against the configured API, with a full report in the output channel.
 * This is the fastest way to see whether the endpoint, path, model or token is the problem.
 */
async function testConnection(context) {
    const settings = readSettings();
    const family = detectFamily(settings.provider, settings.endpoint, settings.model);
    const autoModel = settings.model.length === 0;
    const model = settings.model || DEFAULT_MODEL[family] || '';
    const urls = buildChatCompletionsUrls(settings.endpoint);
    const token = await readApiToken(context);
    const probe = await probeEndpoint(settings.endpoint, token);
    const attempt = thinkingOffAttempts(family, { ...settings, model })[0];
    const body = buildRequestBody(family, { ...settings, model }, attempt.params, 'python', 'connection-test.py', '\ndef add(a, b):\n    return a ');
    body.messages = [{ role: 'user', content: 'Reply with exactly: pong' }];
    if (body.max_completion_tokens !== undefined) {
        body.max_completion_tokens = 16;
    }
    else {
        body.max_tokens = 16;
    }
    log('========== connection test ==========');
    log(`provider setting : ${settings.provider}`);
    log(`detected family  : ${family}`);
    log(`endpoint         : ${settings.endpoint}`);
    log(`endpoint probe   : ${probe.url} -> ${probe.verdict} (${probe.summary})`);
    log(`request urls     : ${urls.join(', ')}`);
    log(`model            : ${model || '(empty)'}${autoModel && model ? ' (default for this family)' : ''}`);
    log(`api token        : ${token.length > 0 ? `configured (${token.length} chars)` : 'NOT SET'}`);
    log(`thinking params  : ${JSON.stringify(attempt.params)}`);
    log(`timeout          : ${settings.timeOutMs} ms for completions, ${SELF_TEST_TIMEOUT_MS} ms for this test`);
    log(`request body     : ${JSON.stringify(body)}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SELF_TEST_TIMEOUT_MS);
    let lastFailure;
    let htmlResponse = false;
    try {
        for (const url of urls) {
            const started = Date.now();
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token.length > 0 ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                const elapsed = Date.now() - started;
                const text = await response.text();
                log(`POST ${url} -> HTTP ${response.status} ${response.statusText} in ${elapsed} ms`);
                log(`response         : ${looksLikeHtml(text) ? shortBodyForLog(text) : (text.slice(0, 1200) || '(empty)')}`);
                if (response.ok) {
                    const summary = `Connection test passed: HTTP ${response.status} in ${elapsed} ms (model "${model}").`;
                    log(`RESULT: OK - ${summary}`);
                    log('=====================================');
                    void vscode.window.showInformationMessage(summary, 'Show Logs').then((choice) => {
                        if (choice === 'Show Logs') {
                            outputChannel?.show(true);
                        }
                    });
                    return;
                }
                htmlResponse = looksLikeHtml(text);
                lastFailure = describeErrorBody(response.status, response.statusText, text);
                if (isPathMismatch(response.status) && urls.indexOf(url) < urls.length - 1) {
                    log('Path not found; trying the alternate URL.');
                    continue;
                }
                break;
            }
            catch (error) {
                const reason = error.name === 'AbortError'
                    ? `no response within ${SELF_TEST_TIMEOUT_MS} ms`
                    : describeNetworkError(error, url);
                lastFailure = reason;
                log(`POST ${url} -> FAILED: ${reason}`);
                break;
            }
        }
        const hints = [];
        if (probe.verdict === 'html' || htmlResponse) {
            hints.push('The address answered with an HTML page instead of an API response, so it is a website or a firewall rather than an API. Use the API base URL from your provider.');
        }
        else if (probe.verdict === 'unreachable') {
            hints.push(`The address could not be reached: ${probe.summary}`);
        }
        if (/HTTP 40[13]/.test(lastFailure ?? '')) {
            hints.push('The token was rejected. Re-run "Simple Auto Complete: Set API Token".');
        }
        if (/HTTP 404/.test(lastFailure ?? '')) {
            hints.push(`Check "simpleAutoComplete.apiEndpoint". Tried: ${urls.join(', ')}`);
        }
        if (/HTTP 400/.test(lastFailure ?? '')) {
            hints.push(`Check "simpleAutoComplete.model" (currently "${model}") and the endpoint path.`);
        }
        if (/no response within/.test(lastFailure ?? '')) {
            hints.push('The server did not answer in time; slow network, a proxy or a cold model start can cause this.');
        }
        log(`RESULT: FAILED - ${lastFailure ?? 'unknown error'}`);
        hints.forEach((hint) => log(`HINT: ${hint}`));
        log('=====================================');
        void vscode.window.showWarningMessage(`Connection test failed: ${lastFailure ?? 'unknown error'}`, 'Show Logs', 'Open Settings').then((choice) => {
            if (choice === 'Show Logs') {
                outputChannel?.show(true);
            }
            if (choice === 'Open Settings') {
                void openSettings();
            }
        });
    }
    finally {
        clearTimeout(timeoutId);
    }
}
/**
 * Decides *when* a completion is requested.
 *
 * VS Code calls inline completion providers on its own schedule (right after every keystroke), so
 * the provider stays silent until this controller reports that the editor has been idle for
 * `simpleAutoComplete.triggerDelay` ms. When that pause is over, the inline suggestion is
 * triggered explicitly, which is what makes the ghost text appear. Ctrl+Tab (and the
 * "Trigger Completion Now" command) skips the pause entirely.
 */
class InlineTriggerController {
    disposables = [];
    timer;
    delayMs = DEFAULT_TRIGGER_DELAY_MS;
    lastActivityAt = 0;
    pauseElapsed = false;
    forceUntil = 0;
    start() {
        this.delayMs = readSettings().triggerDelayMs;
        this.disposables.push(
        // 输入内容后重新计时
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.contentChanges.length > 0 && this.isActiveDocument(event.document)) {
                this.restart();
            }
        }), 
        // 移动光标后重新计时
        vscode.window.onDidChangeTextEditorSelection((event) => {
            if (this.isActiveDocument(event.textEditor.document)) {
                this.restart();
            }
        }), vscode.window.onDidChangeActiveTextEditor(() => this.restart()), vscode.window.onDidChangeWindowState((state) => {
            if (state.focused) {
                this.restart();
            }
        }), vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(`${CONFIG_SECTION}.triggerDelay`)) {
                this.delayMs = readSettings().triggerDelayMs;
                this.restart();
            }
        }));
        this.restart();
    }
    /** True when the provider may answer right now: the pause is over, or the user forced it. */
    allowsRequest() {
        if (Date.now() < this.forceUntil) {
            return true;
        }
        return this.pauseElapsed && Date.now() - this.lastActivityAt >= Math.max(0, this.delayMs - 50);
    }
    /** Ctrl+Tab: request a completion right away instead of waiting for the pause. */
    forceTrigger() {
        if (!readSettings().enabled) {
            void vscode.window.showInformationMessage('Simple Auto Complete: completions are switched off ("simpleAutoComplete.enable").');
            return;
        }
        if (!this.activeEditor()) {
            return;
        }
        this.forceUntil = Date.now() + FORCE_WINDOW_MS;
        this.pauseElapsed = true;
        log('Completion requested by the user (forced).');
        void this.triggerInlineSuggest();
    }
    dispose() {
        this.clearTimer();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }
    /** The editor that would receive the suggestion, or undefined when no editor has focus. */
    activeEditor() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        // 输出面板等特殊文档不请求补全
        if (editor.document.uri.scheme === 'output') {
            return undefined;
        }
        if (!vscode.window.visibleTextEditors.includes(editor)) {
            return undefined;
        }
        return editor;
    }
    isActiveDocument(document) {
        return this.activeEditor()?.document === document;
    }
    /** The user touched the editor: cancel the pending request and start the idle countdown again. */
    restart() {
        this.clearTimer();
        this.pauseElapsed = false;
        this.forceUntil = 0;
        if (!this.activeEditor()) {
            return;
        }
        this.lastActivityAt = Date.now();
        this.timer = setTimeout(() => this.onPauseElapsed(), this.delayMs);
    }
    onPauseElapsed() {
        this.timer = undefined;
        if (!this.activeEditor()) {
            return;
        }
        this.pauseElapsed = true;
        log(`Editor idle for ${this.delayMs} ms; requesting a completion.`);
        void this.triggerInlineSuggest();
    }
    async triggerInlineSuggest() {
        try {
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        }
        catch (error) {
            log(`Could not trigger an inline suggestion: ${error.message}`);
        }
    }
    clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
class AIInlineCompletionProvider {
    context;
    statusBarItem;
    trigger;
    currentAbortController = null;
    cancellationListener = null;
    lastTimeoutMs = null;
    lastErrorSignature = '';
    lastErrorAt = 0;
    announcedFallback = new Set();
    /** Endpoint -> index into buildChatCompletionsUrls() that last worked. */
    workingUrl = new Map();
    /** The last completion, keyed by document version and cursor position, so a repeated call is free. */
    cachedKey = '';
    cachedText = null;
    cachedAt = 0;
    constructor(context, statusBarItem, trigger) {
        this.context = context;
        this.statusBarItem = statusBarItem;
        this.trigger = trigger;
    }
    provideInlineCompletionItems(document, position, context, token) {
        const settings = readSettings();
        if (!settings.enabled) {
            return undefined;
        }
        const explicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
        // 未达到停顿时间就不发请求，真正的时间点由 InlineTriggerController 决定
        if (!explicit && !this.trigger.allowsRequest()) {
            return undefined;
        }
        const key = `${document.uri.toString()}:${document.version}:${position.line}:${position.character}`;
        if (!explicit && key === this.cachedKey && Date.now() - this.cachedAt < RESULT_CACHE_MS) {
            return this.cachedText ? [this.buildInlineCompletionItem(this.cachedText, position)] : undefined;
        }
        // 取消之前的请求
        this.cancelActiveRequest();
        // 为当前请求创建新的 AbortController
        this.currentAbortController = new AbortController();
        this.cancellationListener = token.onCancellationRequested(() => {
            this.currentAbortController?.abort();
        });
        return this.provideAICompletions(document, position, key, settings);
    }
    cancelActiveRequest() {
        this.cancellationListener?.dispose();
        this.cancellationListener = null;
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }
    }
    isRequestCancelled() {
        return !this.currentAbortController || this.currentAbortController.signal.aborted;
    }
    async provideAICompletions(document, position, key, settings) {
        const family = detectFamily(settings.provider, settings.endpoint, settings.model);
        const effective = { ...settings, model: this.effectiveModel(family, settings.model) };
        let failed = false;
        this.statusBarItem.text = STATUS_BUSY;
        try {
            const contextCode = this.collectContext(document, position, settings.maxContextLines);
            const apiToken = await readApiToken(this.context);
            const urls = this.urlsFor(settings.endpoint);
            const completion = await this.requestCompletion(urls, apiToken, family, effective, document.fileName, document.languageId, contextCode);
            if (this.isRequestCancelled()) {
                return undefined; // 请求被取消，不再显示内容
            }
            const text = completion && completion.trim().length > 0 ? completion : null;
            this.cachedKey = key;
            this.cachedText = text;
            this.cachedAt = Date.now();
            return text ? [this.buildInlineCompletionItem(text, position)] : undefined;
        }
        catch (error) {
            failed = this.reportFailure(error, effective, family, document.languageId);
            return undefined;
        }
        finally {
            this.cancellationListener?.dispose();
            this.cancellationListener = null;
            this.currentAbortController = null;
            if (!failed) {
                this.statusBarItem.text = STATUS_IDLE;
                void refreshStatusTooltip(this.context);
            }
        }
    }
    /** Cloud APIs need a model id; fall back to the documented default and say so. */
    effectiveModel(family, configured) {
        if (configured.length > 0) {
            return configured;
        }
        const fallback = DEFAULT_MODEL[family];
        if (!fallback) {
            return '';
        }
        log(`No model configured for the ${family} API; using "${fallback}".`);
        if (!this.announcedFallback.has(family)) {
            this.announcedFallback.add(family);
            void vscode.window.showInformationMessage(`Simple Auto Complete: "simpleAutoComplete.model" is empty, using "${fallback}" for the ${family} API.`, 'Open Settings').then((choice) => {
                if (choice === 'Open Settings') {
                    void openSettings();
                }
            });
        }
        return fallback;
    }
    urlsFor(endpoint) {
        const urls = buildChatCompletionsUrls(endpoint);
        const start = this.workingUrl.get(endpoint) ?? 0;
        if (start > 0 && start < urls.length) {
            return [...urls.slice(start), ...urls.slice(0, start)];
        }
        return urls;
    }
    /** Gather the code before the cursor, capped by maxContextLines. */
    collectContext(document, position, maxContextLines) {
        const linesBefore = Math.min(100, position.line + 1);
        const contextStartLine = Math.max(0, position.line - linesBefore + 1);
        // 获取当前行光标前的内容
        const currentLine = document.lineAt(position.line).text;
        let contextCode = '\n' + currentLine.substring(0, position.character);
        if (position.line > 0) {
            let contextLines = 1;
            for (let i = position.line - 1; i >= contextStartLine; i--) {
                const lineText = document.lineAt(i).text;
                // 忽略空行
                if (lineText.trim().length > 0) {
                    contextCode = lineText + '\n' + contextCode;
                    contextLines++;
                }
                // 达到上下文行数限制，退出循环
                if (contextLines >= maxContextLines) {
                    break;
                }
            }
        }
        return contextCode;
    }
    /**
     * Ghost text is inserted verbatim, so a plain string is used: a snippet string would
     * interpret `$1`-style sequences that are perfectly normal in source code.
     *
     * The range is empty at the cursor so the suggestion only appends text; without it VS Code
     * would replace the word under the cursor.
     */
    buildInlineCompletionItem(completion, position) {
        return new vscode.InlineCompletionItem(completion, new vscode.Range(position, position));
    }
    async requestCompletion(urls, apiToken, family, settings, fileName, fileType, contextCode) {
        const controller = this.currentAbortController;
        if (!controller || controller.signal.aborted) {
            throw new Error('Request already cancelled');
        }
        this.lastTimeoutMs = null;
        const timeoutId = setTimeout(() => {
            this.lastTimeoutMs = settings.timeOutMs;
            controller.abort();
        }, settings.timeOutMs);
        try {
            const attempts = thinkingOffAttempts(family, settings);
            let lastFailure;
            let urlIndex = 0;
            for (let index = 0; index < attempts.length; index++) {
                const attempt = attempts[index];
                const isLastAttempt = index === attempts.length - 1;
                const body = buildRequestBody(family, settings, attempt.params, fileType, fileName, contextCode);
                let nextAttempt = false;
                while (urlIndex < urls.length) {
                    const url = urls[urlIndex];
                    const started = Date.now();
                    let response;
                    try {
                        response = await this.postJson(url, apiToken, body, controller.signal);
                    }
                    catch (error) {
                        const failure = error;
                        if (failure.name === 'AbortError') {
                            if (this.lastTimeoutMs !== null) {
                                throw new RequestFailure(`Request timed out after ${this.lastTimeoutMs} ms`, 'timeout');
                            }
                            throw failure; // The user kept typing; stay quiet.
                        }
                        throw new RequestFailure(describeNetworkError(failure, url), 'network', failure.message);
                    }
                    const elapsed = Date.now() - started;
                    log(`POST ${url} [${attempt.label}] -> HTTP ${response.status} in ${elapsed} ms`);
                    if (response.ok) {
                        const parsed = await this.parseCompletion(response);
                        if (parsed.content) {
                            log(`OK: completion with ${parsed.content.length} chars.`);
                            this.workingUrl.set(settings.endpoint, urlIndex);
                            return this.cleanUpCode(contextCode, parsed.content);
                        }
                        if (!parsed.reasoningOnly) {
                            log('Empty response: no content and no reasoning returned.');
                            return null;
                        }
                        if (isLastAttempt) {
                            log('Model returned reasoning only; no thinking-free dialect was accepted.');
                            return null;
                        }
                        log(`Model returned reasoning only with "${attempt.label}"; trying the next dialect.`);
                        nextAttempt = true;
                        break;
                    }
                    const detail = await this.readErrorDetail(response);
                    lastFailure = new RequestFailure(`HTTP ${response.status} ${response.statusText}`.trim(), 'http', detail, response.status);
                    log(`Response body: ${shortBodyForLog(detail)}`);
                    if (isPathMismatch(response.status) && urlIndex < urls.length - 1) {
                        urlIndex++;
                        log(`Path not found; retrying with ${urls[urlIndex]}.`);
                        continue;
                    }
                    if (!isLastAttempt && looksLikeRejectedThinkingField(response.status, detail, attempt.params)) {
                        log(`Rejected thinking field "${attempt.label}"; trying the next dialect.`);
                        nextAttempt = true;
                        break;
                    }
                    throw lastFailure;
                }
                if (nextAttempt) {
                    continue;
                }
                if (isLastAttempt) {
                    break;
                }
            }
            throw lastFailure ?? new RequestFailure('Request failed without a response', 'network');
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    postJson(url, apiToken, body, signal) {
        const headers = { 'Content-Type': 'application/json' };
        if (apiToken.length > 0) {
            headers.Authorization = `Bearer ${apiToken}`;
        }
        return fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });
    }
    async readErrorDetail(response) {
        try {
            return await response.text();
        }
        catch {
            return '';
        }
    }
    async parseCompletion(response) {
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            throw new RequestFailure('The API returned a response that is not valid JSON', 'parse', text.slice(0, 500));
        }
        if (data?.error) {
            throw new RequestFailure(extractApiMessage(text) || 'The API reported an error', 'http', text);
        }
        const choice = data?.choices?.[0];
        const message = choice?.message;
        const content = normalizeContent(message?.content ?? choice?.text);
        // Some providers return the chain of thought instead of (or next to) the answer.
        const hasReasoning = [message?.reasoning_content, message?.reasoning, choice?.reasoning_content]
            .some((value) => normalizeContent(value).length > 0);
        return {
            content: content.length > 0 ? content : null,
            reasoningOnly: content.length === 0 && hasReasoning,
        };
    }
    cleanUpCode(contextCode, completion) {
        // 移除 Markdown 代码围栏
        let cleaned = completion.replace(/^\s*```[^\n]*\n?/, '');
        cleaned = cleaned.replace(/\n?```[\s\S]*$/, '').trim();
        if (cleaned.length === 0) {
            return '';
        }
        // 只保留第一行，避免插入大段内容
        const firstLine = cleaned.split('\n')[0];
        // 去除重复部分：如果补全重复了上下文最后一行，则裁剪掉
        const lastContextLine = contextCode.split('\n').pop()?.trimStart() ?? '';
        if (lastContextLine.length > 0) {
            const index = firstLine.indexOf(lastContextLine);
            if (index !== -1) {
                return firstLine.substring(index + lastContextLine.length);
            }
        }
        return firstLine;
    }
    /**
     * Surface the failure everywhere the user can see it: status bar, output channel and a
     * throttled notification that carries the API's own message.
     */
    reportFailure(error, settings, family, languageId) {
        if (error instanceof Error && error.name === 'AbortError') {
            return false; // Cancelled by a newer request.
        }
        const failure = error instanceof RequestFailure ? error : undefined;
        const model = settings.model || '(none)';
        let message;
        let hint = '';
        if (failure?.kind === 'timeout') {
            message = failure.message;
            hint = `Raise "simpleAutoComplete.timeOut" (currently ${settings.timeOutMs} ms) or use a faster model.`;
        }
        else if (failure?.kind === 'network') {
            message = failure.message;
            hint = 'Check "simpleAutoComplete.apiEndpoint" and that the server is reachable.';
        }
        else if (failure?.kind === 'parse') {
            message = `${failure.message} (model: ${model})`;
            hint = 'The endpoint answered, but not with a chat/completions payload. Check the URL path and the model.';
        }
        else {
            const detail = failure?.detail ?? error.message;
            const status = failure?.status;
            message = status !== undefined
                ? describeErrorBody(status, '', detail)
                : `Request failed: ${extractApiMessage(detail) || 'no details'}`;
            if (status === 401 || status === 403) {
                hint = 'The API rejected the token. Re-run "Simple Auto Complete: Set API Token".';
            }
            else if (looksLikeHtml(detail)) {
                // A website or firewall answered; the model name and token are not the problem.
                hint = 'This address answered with an HTML page, so it is a website or a firewall rather than an API. Use the API base URL from your provider.';
            }
            else if (status === 404) {
                hint = `Check "simpleAutoComplete.apiEndpoint"; tried ${this.urlsFor(settings.endpoint).join(' and ')}.`;
            }
            else if (/model/i.test(message)) {
                hint = `Check "simpleAutoComplete.model" (currently "${model}").`;
            }
            else if (status === 429) {
                hint = 'Rate limited or out of quota. Retry later or check your plan.';
            }
        }
        const signature = `${failure?.kind ?? 'unknown'}:${failure?.status ?? ''}:${message}`;
        log(`FAILED [${family} / ${model} / ${languageId}]: ${message}${hint ? ` | ${hint}` : ''}`);
        this.statusBarItem.text = STATUS_ERROR;
        this.statusBarItem.tooltip = new vscode.MarkdownString([
            '**Simple Auto Complete: last request failed**',
            '',
            message,
            ...(hint ? ['', hint] : []),
            '',
            'Run **Simple Auto Complete: Show Logs** for the raw request and response.',
        ].join('\n'));
        const now = Date.now();
        if (signature === this.lastErrorSignature && now - this.lastErrorAt < NOTIFICATION_COOLDOWN_MS) {
            return true;
        }
        this.lastErrorSignature = signature;
        this.lastErrorAt = now;
        void vscode.window.showWarningMessage(`Simple Auto Complete: ${message}`, 'Show Logs', 'Open Settings').then((choice) => {
            if (choice === 'Show Logs') {
                outputChannel?.show(true);
            }
            if (choice === 'Open Settings') {
                void openSettings();
            }
        });
        return true;
    }
}
/** Chat Completions content can be a string or a list of content parts. */
function normalizeContent(value) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value
            .map((part) => (typeof part === 'string' ? part : part?.text))
            .filter((part) => typeof part === 'string')
            .join('')
            .trim();
    }
    return '';
}
//# sourceMappingURL=extension.js.map