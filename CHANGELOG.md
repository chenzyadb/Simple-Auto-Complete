# Change Log

## 0.5.0

- **Built-in inline completions instead of the completion list**: the extension now uses `vscode.languages.registerInlineCompletionItemProvider` and renders suggestions as VS Code's native gray ghost text. The old `CompletionItemProvider` and its trigger characters (`=`, `:`, `+`, `(`, space, ...) are gone, so nothing is inserted into the suggestion widget any more
- **Pause instead of symbols**: no completion is requested while you are typing. After the editor has focus and stays untouched (no typing, no cursor movement) for the new `simpleAutoComplete.triggerDelay` (default 800 ms, range 100-10000), one request is sent and the ghost text appears. Any keystroke or cursor move cancels the pending request and restarts the countdown
- **New command and keybinding: Ctrl+Tab triggers a completion immediately**, without waiting for the pause (**Simple Auto Complete: Trigger Completion Now**, registered as `simpleAutoComplete.triggerCompletion`). The binding only applies when a text editor has focus and `simpleAutoComplete.enable` is true; outside of that, `Ctrl+Tab` keeps its normal behavior. Note that inside a code editor the shortcut no longer switches to the previously used editor — remove the binding in **Keyboard Shortcuts** if you prefer the original behavior
- Only one request per pause: the idle timer decides when to request, and a per-position cache means VS Code's own follow-up invocations cost no extra API call
- Works for every language (`*`) and no longer needs trigger characters, so completions also appear in positions the old character list never covered
- A warning with an **Enable It** action is shown when `editor.inlineSuggest.enabled` is off, because VS Code cannot render inline suggestions without it
- Ghost text is inserted as a plain string instead of a snippet, so `$1`-style text in generated code is no longer interpreted as a snippet placeholder
- Status bar tooltip now also shows the idle delay

## 0.4.0

- **API token support**: new `simpleAutoComplete.apiToken` setting, plus the command **Simple Auto Complete: Set API Token** which stores the token in VS Code Secret Storage (takes precedence over the setting)
- **Errors are no longer silent**: failures now show up in the status bar (`$(warning) Auto Complete` with the reason in the tooltip), in a throttled notification that carries the API's own message (with **Show Logs** / **Open Settings**), and in the **Simple Auto Complete** output channel with the request URL, thinking dialect, HTTP status, elapsed time and raw response body
- **Active endpoint check**: instead of matching a hardcoded list of hosts, the extension sends one lightweight `GET` to the configured address on startup, whenever `apiEndpoint`/`apiToken` change, and inside **Test Connection**. An HTML answer means a website or firewall, any other HTTP answer means a reachable API, and no answer means unreachable. The verdict goes to the output channel, the status bar tooltip and (for a website or an unreachable remote host) a warning with **Test Connection** / **Open Settings**. The configured URL is never rewritten, so private endpoints work too
- **HTML error pages are readable**: a bot-filter/WAF page (for example Cloudflare's "Request Blocked" with HTTP 429) is reported as `HTTP 429: the endpoint returned an HTML page ("Request Blocked")` with a hint that the URL is a website, instead of dumping raw HTML into the notification. The log keeps a truncated copy. A JSON 429 is still reported as a rate limit
- **New command: Simple Auto Complete: Test Connection** — sends a real request and reports the detected provider, the URLs tried, the model, the token state, the exact request body and the raw response, plus a hint for 401/403/404/400/timeout
- **Timeout fixed**: the default `simpleAutoComplete.timeOut` was 1000 ms, which silently cancelled most cloud requests; it is now 3000 ms (range 500-30000) and a timeout is reported with the exact value to raise
- **Model fallback instead of doing nothing**: when `simpleAutoComplete.model` is empty the documented default for the detected provider is used (`deepseek-flash`, `qwen3.8-max`, `glm-4.5`, `kimi-k2.6`, `gpt-4o-mini`) and the user is told which one
- **URL path fallback**: `/v1/chat/completions` is tried first, a 404/405 transparently retries `/chat/completions` (the path DeepSeek documents), and the working variant is remembered. No host-specific path rules. Full URLs and `/api/paas/v4`-style endpoints are still accepted
- **Smarter retries**: the thinking dialect is only retried when the server actually complains about that field, so a bad model name or token now fails immediately instead of after four attempts
- Network failures report the underlying cause (`fetch failed` is unwrapped), including DNS, refused connections and TLS errors
- **Chinese LLM support first**: DeepSeek, Qwen (DashScope / SiliconFlow), GLM (Zhipu, Z.ai, Volcengine Ark / Doubao) and Kimi (Moonshot) are detected from the endpoint URL and model name. New `simpleAutoComplete.provider` values `deepseek` / `qwen` / `glm` / `kimi`
- **Thinking disabled per provider** (the main speed win): DeepSeek gets `thinking.type = disabled` + `reasoning_effort = none`, Qwen gets `enable_thinking = false`, GLM/Kimi get `thinking.type = disabled`, local servers get `chat_template_kwargs.enable_thinking = false`, OpenAI gets `reasoning_effort = none` with a `minimal` fallback
- **Self-healing retries**: if a server rejects the field (400/422) or answers with reasoning but no code, the extension retries with the other known switches and finally without them
- **OpenAI support**: works with the OpenAI Chat Completions API (`max_completion_tokens`, o-series parameter rules) as well as LM Studio and any OpenAI-compatible server
- Non-OpenAI requests now send only widely supported fields (`frequency_penalty` / `presence_penalty` were dropped; DeepSeek documents them as deprecated), lowering the chance of a 400
- Endpoint URLs are normalized, so `/v1/chat/completions` is only appended when needed (`/v1`, `/api/paas/v4` and full paths all work)
- New `simpleAutoComplete.model`, `simpleAutoComplete.maxTokens`, `simpleAutoComplete.enable` and `simpleAutoComplete.extraRequestBody` settings; a warning is shown when a cloud API is used without a model
- Status bar tooltip now shows the detected API family, endpoint, model and token state; API errors include the response detail
- Fixed Markdown code-fence stripping and leak of cancellation listeners

- Initial release
