# Simple Auto Complete

An AI-powered code completion extension for VS Code. It works with a local model server (LM Studio, Ollama, ...), with Chinese LLM APIs (DeepSeek, Qwen, GLM, Kimi) and with the OpenAI Chat Completions API, and can talk to any OpenAI-compatible endpoint.

## 🚀 Features

- **AI-Powered Code Completion**: Provides intelligent completion suggestions based on your current code context
- **Local or cloud**: Integrates with local AI services like LM Studio (code stays on your machine), with the OpenAI API, or with any OpenAI-compatible server
- **API token support**: Sends a bearer token for authenticated endpoints; the token is kept in VS Code Secret Storage instead of plain-text settings
- **Thinking disabled, China LLMs first**: Sends each provider's native switch (`thinking.type`, `enable_thinking`, `chat_template_kwargs`, `reasoning_effort`) so completions come back as fast as possible
- **Actionable errors**: an active endpoint check at startup and on every settings change, the status bar, a notification carrying the API's own message, an output channel with the full request/response trail, and a **Test Connection** diagnostic command
- **Pause-based inline completions**: after you stop typing, a configurable idle delay elapses and the completion is shown as VS Code's native inline suggestion (gray ghost text). Press `Ctrl+Tab` to request one immediately
- **Status Bar Indicator**: Live status indicator with a tooltip showing provider, endpoint, model and token state
- **Multi-Language Support**: Supports code completion for popular programming languages

## 📦 Requirements

- Visual Studio Code v1.74.0+
- Either a locally running OpenAI-compatible AI service (such as [LM Studio](https://lmstudio.ai/)), or an OpenAI API key

## ⚙️ Configuration Options

This extension provides the following configurable options:

| Setting | Type | Default Value | Description |
|--------|------|--------|------|
| `simpleAutoComplete.apiEndpoint` | `string` | `"http://127.0.0.1:1234"` | Base URL of the chat API. `/v1/chat/completions` is appended when the URL does not already contain it |
| `simpleAutoComplete.provider` | `string` | `"auto"` | `auto`, `lmstudio`, `openai`, `openai-compatible`, `deepseek`, `qwen`, `glm` or `kimi`. `auto` detects the dialect from the endpoint URL and model name |
| `simpleAutoComplete.apiToken` | `string` | `""` | Bearer token sent as `Authorization: Bearer <token>`. Leave empty for local servers |
| `simpleAutoComplete.model` | `string` | `""` | Model id; required for OpenAI (e.g. `gpt-4o-mini`, `gpt-5-mini`). Empty lets LM Studio use the loaded model |
| `simpleAutoComplete.disableThinking` | `boolean` | `true` | Disables the thinking / reasoning phase for the fastest completions; the request field is chosen per provider (see below) |
| `simpleAutoComplete.maxTokens` | `number` | `128` | Maximum number of tokens generated per completion，range 16-4096 |
| `simpleAutoComplete.timeOut` | `number` | `3000` | API request timeout (Milliseconds)，range 500-30000. Cloud APIs often need more than 1000 ms |
| `simpleAutoComplete.maxContextLines` | `number` | `20` | Maximum number of lines to include as context for AI completion，range 5-100 |
| `simpleAutoComplete.triggerDelay` | `number` | `800` | Idle time (ms) the editor must stay untouched before a completion is requested，range 100-10000. `Ctrl+Tab` skips the wait |
| `simpleAutoComplete.enable` | `boolean` | `true` | Enable or disable AI completions |
| `simpleAutoComplete.extraRequestBody` | `string` | `""` | Extra JSON object merged into the request body, for provider-specific options |

### Configuration Example

Local LM Studio:

```json
{
    "simpleAutoComplete.apiEndpoint": "http://127.0.0.1:1234",
    "simpleAutoComplete.provider": "auto",
    "simpleAutoComplete.model": "",
    "simpleAutoComplete.disableThinking": true,
    "simpleAutoComplete.timeOut": 1000,
    "simpleAutoComplete.maxContextLines": 20
}
```

OpenAI:

```json
{
    "simpleAutoComplete.apiEndpoint": "https://api.openai.com",
    "simpleAutoComplete.provider": "auto",
    "simpleAutoComplete.model": "gpt-4o-mini",
    "simpleAutoComplete.disableThinking": true
}
```

DeepSeek / Qwen / GLM / Kimi:

```json
{
    "simpleAutoComplete.apiEndpoint": "https://api.deepseek.com",
    "simpleAutoComplete.model": "deepseek-flash",
    "simpleAutoComplete.disableThinking": true
}
```

```json
{
    "simpleAutoComplete.apiEndpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "simpleAutoComplete.model": "qwen3.8-max"
}
```

```json
{
    "simpleAutoComplete.apiEndpoint": "https://open.bigmodel.cn/api/paas/v4",
    "simpleAutoComplete.model": "glm-4.5"
}
```

```json
{
    "simpleAutoComplete.apiEndpoint": "https://api.moonshot.cn/v1",
    "simpleAutoComplete.model": "kimi-k2.6"
}
```

### Disabling thinking (DeepSeek, Qwen, GLM, Kimi first)

Thinking off is the single biggest speed win for completions, but every provider exposes a different switch. With `simpleAutoComplete.disableThinking` enabled (the default) the extension sends the right field for the endpoint and model:

| Provider | Endpoint example | Field sent to disable thinking |
|--------|------|------|
| DeepSeek | `https://api.deepseek.com` | `thinking.type = "disabled"` with `reasoning_effort = "none"` |
| Qwen (Model Studio / DashScope) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `enable_thinking = false` |
| GLM (Zhipu, Z.ai, Volcengine Ark / Doubao) | `https://open.bigmodel.cn/api/paas/v4`, `https://api.z.ai/api/paas/v4` | `thinking.type = "disabled"` |
| Kimi (Moonshot) | `https://api.moonshot.cn/v1` | `thinking.type = "disabled"` |
| LM Studio, vLLM, SGLang, llama.cpp | `http://127.0.0.1:1234` | `chat_template_kwargs.enable_thinking = false` |
| OpenAI | `https://api.openai.com` | `reasoning_effort = "none"`, falling back to `"minimal"` |

If a server rejects the field (HTTP 400/422), or answers with reasoning content but no code, the extension retries with the other known switches and finally without them — so a proxy or aggregator still works. Set `simpleAutoComplete.provider` explicitly when the endpoint cannot be recognized, and use `simpleAutoComplete.extraRequestBody` for anything else.

Two limitations to know about: a few models always think and cannot be turned off (Kimi K3 is documented as `thinking.type: "enabled"` only, and some Qwen models are thinking-only). In that case completions still work, just slower.

### API token

For OpenAI or any endpoint that requires authentication, set a token. The recommended way keeps it out of `settings.json`:

1. Open the Command Palette (`Ctrl/Cmd + Shift + P`)
2. Run **Simple Auto Complete: Set API Token**
3. Paste the token — it is stored in VS Code Secret Storage

The `simpleAutoComplete.apiToken` setting also works for convenience, but it is stored as plain text. A value saved through the command takes precedence.

### When something does not work

Failures are never silent. Every error is reported in three places:

| Where | What you see |
|--------|------|
| Status bar | Turns into `$(warning) Auto Complete`; hover it for the reason and the suggested fix. It returns to normal after the next successful request |
| Notification | The API's own message (for example `HTTP 401: Authentication Fails` or `HTTP 400: Model Not Exist`) plus **Show Logs** / **Open Settings** buttons. Repeats of the same error are throttled to once a minute so typing is not interrupted |
| Output channel | **Simple Auto Complete** — the full trail: request URL, thinking dialect, HTTP status, elapsed time and the raw response body |

There is also a one-shot diagnostic command, **Simple Auto Complete: Test Connection** (Command Palette). It performs a real request against the current settings, prints the detected family, the URLs it tried, the model, whether a token is configured, the exact request body and the raw response, then reports pass or fail.

Common causes it identifies for you:

| Symptom | Meaning |
|--------|------|
| `HTTP 401 / 403` | The token was rejected. Re-run **Simple Auto Complete: Set API Token** |
| `HTTP 404` | Wrong URL path. The log lists every URL that was tried (`/chat/completions` and `/v1/chat/completions` are both retried automatically) |
| `HTTP 400 ... model` | The model name was rejected. Check `simpleAutoComplete.model` |
| `Request timed out after N ms` | Raise `simpleAutoComplete.timeOut` (default `3000`) or use a faster model |
| `Connection refused` / `Cannot resolve the host` | The local server is not running, or the endpoint URL is wrong |
| `HTTP 429` **with an HTML page** (e.g. `Request Blocked`) | You configured a website, not an API. A bot filter answered instead of the API — see the table below |

If `simpleAutoComplete.model` is left empty the extension now uses the documented default for the detected provider (`deepseek-flash`, `qwen3.8-max`, `glm-4.5`, `kimi-k2.6`, `gpt-4o-mini`) instead of doing nothing, and tells you which one it used.

HTML error pages are summarized (`HTTP 429: the endpoint returned an HTML page ("Request Blocked")`) instead of being pasted into the notification, and the raw body in the log is truncated.

#### The extension checks the address for you

Nothing about the address is hardcoded: on startup, whenever `simpleAutoComplete.apiEndpoint` or the token changes, and again inside **Test Connection**, the extension sends one lightweight `GET` to the configured URL and judges it by the real answer.

| What the address answers | Verdict |
|--------|------|
| Any HTTP response that is not a web page (JSON error, `401`, `404`, plain text) | Reachable API — a working endpoint refuses an unauthenticated request exactly like this |
| An HTML page (`text/html`, e.g. Cloudflare's "Request Blocked") | Not an API: a website or a firewall answered. You get a warning with **Test Connection** / **Open Settings** |
| No answer (DNS, refused, TLS, timeout) | Unreachable. Loopback addresses stay quiet (a local server simply not running is normal); remote hosts are reported |

The verdict is always written to the **Simple Auto Complete** output channel and shown in the status bar tooltip. The request itself is never rewritten — whatever you configured is what gets used, so a private or self-hosted endpoint that no list could know about works the same way.

That check catches the most common setup mistake of all: pasting the provider's **console** URL instead of its **API** base URL. Every provider splits the two — the console is where you create the key.

| Provider | Console (wrong) | API base (right) |
|--------|------|------|
| DeepSeek | `https://platform.deepseek.com` | `https://api.deepseek.com` |
| Kimi (Moonshot) | `https://platform.moonshot.cn` | `https://api.moonshot.cn/v1` |
| GLM (Zhipu / Z.ai) | `https://www.bigmodel.cn` | `https://open.bigmodel.cn/api/paas/v4` |
| Qwen (Model Studio) | `https://bailian.console.aliyun.com` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| OpenAI | `https://platform.openai.com` | `https://api.openai.com` |

Path differences are handled at runtime too: `/v1/chat/completions` is tried first and `/chat/completions` is used automatically if the first answers 404/405 (which is what DeepSeek documents), and the working variant is remembered.

DeepSeek note: `deepseek-flash` is the current model name; `deepseek-v4-flash` is a legacy alias that is still accepted and served by the same Flash model.

## 🔧 Usage

1. **Start Local AI Service** (or bring an OpenAI API key):
   - Install and start LM Studio or another OpenAI-compatible local AI service
   - Ensure the service is running at the configured endpoint URL

2. **Configure Extension**:
   - Open VS Code settings (`Ctrl/Cmd + ,`)
   - Search for `simpleAutoComplete` and configure the API endpoint, provider, model and token

3. **Start Coding**:
   - Type in any code file, then stop typing — after `simpleAutoComplete.triggerDelay` ms (800 by default) the suggestion appears as inline ghost text
   - Press `Tab` to accept it, `Esc` to dismiss it
   - Press `Ctrl+Tab` to request a completion immediately, without waiting for the pause

> `Ctrl+Tab` is re-bound while a code editor has focus, so it no longer switches to the previous editor. Remove the binding in **Keyboard Shortcuts** (search for `simpleAutoComplete.triggerCompletion`) if you prefer the original shortcut.

## 🤝 Contributing

Feel free to submit Issues and Pull Requests to improve this extension!

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🐛 Troubleshooting

**Common Issues:**

- **Connection Refused**: Verify that the AI service is running and the endpoint URL is configured correctly
- **Slower than expected**: Keep `simpleAutoComplete.disableThinking` enabled and lower `simpleAutoComplete.maxContextLines`
- **Still slow with a reasoning model**: Some models (Kimi K3, Qwen thinking-only variants, OpenAI reasoning models) cannot fully disable thinking. Switch to a hybrid model such as `deepseek-flash`, `qwen3.8-max`, `glm-4.5` or `kimi-k2.6`
- **No Completion Suggestions**: Check that `simpleAutoComplete.enable` is `true`, then run **Simple Auto Complete: Test Connection** — it reports exactly what the API answered
- **No ghost text, but the API test passes**: Make sure `editor.inlineSuggest.enabled` is on — VS Code renders inline suggestions itself, and cannot show anything without it. Also give the editor the full `simpleAutoComplete.triggerDelay` of idle time, or press `Ctrl+Tab`

## 📄 License

MIT License - See the LICENSE file for details

## 🆘 Support

If you encounter issues or have feature suggestions, please:

- Submit a new Issue
- Consult the configuration documentation

---


# Simple Auto Complete

一个基于 AI 的智能代码补全 VSCode 扩展。既可以使用本地模型服务（LM Studio、Ollama 等），也可以使用 DeepSeek、Qwen、GLM、Kimi 等国产模型接口与 OpenAI 的 Chat Completions 接口，并兼容任意 OpenAI 格式的接口。

## 🚀 功能特性

- **AI 驱动的代码补全**：基于您当前的代码上下文提供智能补全建议
- **本地 / 云端任选**：可与 LM Studio 等本地 AI 服务集成（代码不离开本机），也可使用 OpenAI API，或任意 OpenAI 兼容服务
- **API Token 支持**：可为需要鉴权的接口发送 Bearer Token；Token 保存在 VS Code 密钥存储中，而不是明文设置里
- **关闭思考（国模优先）**：按厂商发送对应的原生参数（`thinking.type`、`enable_thinking`、`chat_template_kwargs`、`reasoning_effort`），让补全尽可能快地返回
- **可诊断的报错**：启动时与设置变更时主动探测地址可用性 + 状态栏 + 带接口原始错误的通知 + 输出面板完整请求/响应日志，并提供 **Simple Auto Complete: Test Connection** 诊断命令
- **停顿后补全**：停止输入并停顿一段可配置的时间后，以 VS Code 原生的内联补全（灰色幽灵文本）显示建议；按 `Ctrl+Tab` 可立即请求一次
- **状态栏指示器**：悬浮提示会显示当前 Provider、端点、模型与 Token 状态
- **多语言支持**：支持热门编程语言的代码补全

## 📦 安装要求

- Visual Studio Code v1.74.0+
- 本地运行的 OpenAI 兼容 AI 服务（如 [LM Studio](https://lmstudio.ai/)），或一个 OpenAI API Key

## ⚙️ 配置选项

本扩展提供以下可配置选项：

| 设置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `simpleAutoComplete.apiEndpoint` | `string` | `"http://127.0.0.1:1234"` | 接口的基础 URL；如果 URL 中还没有 `/v1/chat/completions`，会自动补全 |
| `simpleAutoComplete.provider` | `string` | `"auto"` | `auto`、`lmstudio`、`openai`、`openai-compatible`、`deepseek`、`qwen`、`glm` 或 `kimi`；`auto` 会根据端点与模型名自动判断 |
| `simpleAutoComplete.apiToken` | `string` | `""` | 以 `Authorization: Bearer <token>` 发送的 Token；本地服务可以留空 |
| `simpleAutoComplete.model` | `string` | `""` | 模型名；DeepSeek、Qwen、GLM、Kimi、OpenAI 均必填（如 `deepseek-flash`、`qwen3.8-max`、`glm-4.5`、`kimi-k2.6`）；留空时 LM Studio 使用已加载的模型 |
| `simpleAutoComplete.disableThinking` | `boolean` | `true` | 关闭思考 / 推理阶段，获得最快的补全速度；具体请求字段按厂商自动选择（见下文） |
| `simpleAutoComplete.maxTokens` | `number` | `128` | 每次补全最多生成的 token 数，范围 16-4096 |
| `simpleAutoComplete.timeOut` | `number` | `3000` | API 请求超时时间（毫秒），范围 500-30000；云端接口通常需要大于 1000 |
| `simpleAutoComplete.maxContextLines` | `number` | `20` | 最大上下文行数，范围 5-100 |
| `simpleAutoComplete.triggerDelay` | `number` | `800` | 编辑器保持无操作（不输入、不移动光标）多久后请求补全，单位毫秒，范围 100-10000；按 `Ctrl+Tab` 可跳过等待 |
| `simpleAutoComplete.enable` | `boolean` | `true` | 是否启用 AI 补全 |
| `simpleAutoComplete.extraRequestBody` | `string` | `""` | 追加合并到请求体中的 JSON 对象，用于接口特有的参数 |

### 配置示例

本地 LM Studio：

```json
{
    "simpleAutoComplete.apiEndpoint": "http://127.0.0.1:1234",
    "simpleAutoComplete.provider": "auto",
    "simpleAutoComplete.model": "",
    "simpleAutoComplete.disableThinking": true,
    "simpleAutoComplete.timeOut": 1000,
    "simpleAutoComplete.maxContextLines": 20
}
```

OpenAI：

```json
{
    "simpleAutoComplete.apiEndpoint": "https://api.openai.com",
    "simpleAutoComplete.provider": "auto",
    "simpleAutoComplete.model": "gpt-4o-mini",
    "simpleAutoComplete.disableThinking": true
}
```

DeepSeek / Qwen / GLM / Kimi：

```json
{
    "simpleAutoComplete.apiEndpoint": "https://api.deepseek.com",
    "simpleAutoComplete.model": "deepseek-flash",
    "simpleAutoComplete.disableThinking": true
}
```

```json
{
    "simpleAutoComplete.apiEndpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "simpleAutoComplete.model": "qwen3.8-max"
}
```

```json
{
    "simpleAutoComplete.apiEndpoint": "https://open.bigmodel.cn/api/paas/v4",
    "simpleAutoComplete.model": "glm-4.5"
}
```

```json
{
    "simpleAutoComplete.apiEndpoint": "https://api.moonshot.cn/v1",
    "simpleAutoComplete.model": "kimi-k2.6"
}
```

### 关闭思考（国模优先）

关闭思考是补全提速最明显的一步，但各家参数并不统一。保持 `simpleAutoComplete.disableThinking` 开启（默认）时，扩展会按端点和模型自动发送对应的字段：

| 提供方 | 端点示例 | 关闭思考所发送的字段 |
|--------|------|------|
| DeepSeek | `https://api.deepseek.com` | `thinking.type = "disabled"` 并附带 `reasoning_effort = "none"` |
| Qwen（百炼 / DashScope） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `enable_thinking = false` |
| GLM（智谱、Z.ai、火山方舟 / 豆包） | `https://open.bigmodel.cn/api/paas/v4`、`https://api.z.ai/api/paas/v4` | `thinking.type = "disabled"` |
| Kimi（Moonshot） | `https://api.moonshot.cn/v1` | `thinking.type = "disabled"` |
| LM Studio、vLLM、SGLang、llama.cpp | `http://127.0.0.1:1234` | `chat_template_kwargs.enable_thinking = false` |
| OpenAI | `https://api.openai.com` | `reasoning_effort = "none"`，被拒时回退到 `"minimal"` |

如果服务器以 HTTP 400/422 拒绝该字段，或者只返回推理内容而没有代码，扩展会自动改用其它已知开关重试，最后再退回不带这些字段，因此在代理或聚合平台上同样可用。端点无法识别时可显式设置 `simpleAutoComplete.provider`；其它厂商特有能力可用 `simpleAutoComplete.extraRequestBody`。

有两点需要了解：少数模型始终思考、无法关闭（Kimi K3 官方说明 `thinking.type` 只支持 `enabled`，另有部分 Qwen 仅思考模式）。这类情况下补全依然可用，只是速度慢一些。

### API Token

使用 OpenAI 或任何需要鉴权的接口时，需要设置 Token。推荐做法可以避免把它写进 `settings.json`：

1. 打开命令面板（`Ctrl/Cmd + Shift + P`）
2. 执行 **Simple Auto Complete: Set API Token**
3. 粘贴 Token，它会被存入 VS Code 密钥存储

`simpleAutoComplete.apiToken` 设置项也可以直接使用，但会以明文保存；通过命令保存的值优先级更高。

### 出问题时怎么排查

现在失败不再是静默的，错误会同时出现在三个地方：

| 位置 | 你会看到什么 |
|--------|------|
| 状态栏 | 变成 `$(warning) Auto Complete`，鼠标悬浮即可看到原因与修复建议；下一次请求成功后自动恢复 |
| 弹窗通知 | 直接显示接口返回的原始错误（例如 `HTTP 401: Authentication Fails`、`HTTP 400: Model Not Exist`），并带 **Show Logs** / **Open Settings** 按钮；同一错误一分钟内只提示一次，不干扰输入 |
| 输出面板 | **Simple Auto Complete** 频道，包含完整链路：请求 URL、关思考方言、HTTP 状态码、耗时以及原始响应体 |

另外提供了诊断命令 **Simple Auto Complete: Test Connection**（命令面板）：它会用当前配置真实发一次请求，打印识别出的厂商、尝试过的 URL、模型名、是否配置了 Token、完整的请求体和原始响应，最后给出通过/失败结论。

它能直接告诉你的常见原因：

| 现象 | 含义 |
|--------|------|
| `HTTP 401 / 403` | Token 被拒绝，请重新执行 **Simple Auto Complete: Set API Token** |
| `HTTP 404` | 路径不对。日志会列出所有尝试过的 URL（`/chat/completions` 与 `/v1/chat/completions` 会自动互为回退） |
| `HTTP 400 ... model` | 模型名被拒绝，请检查 `simpleAutoComplete.model` |
| `Request timed out after N ms` | 请调大 `simpleAutoComplete.timeOut`（默认 `3000`），或改用更快的模型 |
| `Connection refused` / `Cannot resolve the host` | 本地服务没启动，或端点 URL 填错 |
| `HTTP 429` **且返回 HTML 页面**（如 `Request Blocked`） | 你填的是网站地址而不是 API 地址。风控拦截页代替了接口响应，见下表 |

当 `simpleAutoComplete.model` 留空时，扩展不再什么都不做，而是使用对应厂商的官方默认模型（`deepseek-flash`、`qwen3.8-max`、`glm-4.5`、`kimi-k2.6`、`gpt-4o-mini`），并明确告知使用了哪一个。

HTML 错误页会被概括成一句人话（`HTTP 429: the endpoint returned an HTML page ("Request Blocked")`），不会再被整段贴进通知；日志里的原始响应体也会被截断。

#### 扩展会主动检查这个地址

地址判断不依赖任何硬编码清单：启动时、`simpleAutoComplete.apiEndpoint` 或 Token 变化时，以及执行 **Test Connection** 时，扩展都会向配置的 URL 发一个轻量 `GET`，用**真实响应**来判定。

| 地址的真实响应 | 判定 |
|--------|------|
| 任何不是网页的 HTTP 响应（JSON 错误、`401`、`404`、纯文本） | 可用的 API——正常的接口在未鉴权时正是这样拒绝的 |
| HTML 页面（`text/html`，例如 Cloudflare 的 `Request Blocked`） | 不是 API：返回的是网站或防火墙。会弹出警告，并提供 **Test Connection** / **Open Settings** |
| 完全没有响应（DNS、连接被拒、TLS、超时） | 无法访问。回环地址（本机服务未启动属正常）不打扰你，远程地址会明确提示 |

判定结果会写入 **Simple Auto Complete** 输出面板，并显示在状态栏悬浮提示中。**请求地址永远不会被改写**——你配的是什么就用什么，因此私有部署、自建网关这类任何清单都覆盖不到的地址同样适用。

这项检查覆盖了最常见的配置错误：把厂商的**控制台网址**当成 **API 地址**。每家厂商都分这两个域名，控制台只是申请 Key 的地方。

| 提供方 | 控制台（错） | API 地址（对） |
|--------|------|------|
| DeepSeek | `https://platform.deepseek.com` | `https://api.deepseek.com` |
| Kimi（Moonshot） | `https://platform.moonshot.cn` | `https://api.moonshot.cn/v1` |
| GLM（智谱 / Z.ai） | `https://www.bigmodel.cn` | `https://open.bigmodel.cn/api/paas/v4` |
| Qwen（百炼） | `https://bailian.console.aliyun.com` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| OpenAI | `https://platform.openai.com` | `https://api.openai.com` |

路径差异同样在运行时处理：先试 `/v1/chat/completions`，若返回 404/405 则自动改用 `/chat/completions`（DeepSeek 文档用的正是后者），并记住可用的那个。

DeepSeek 补充说明：当前模型名是 `deepseek-flash`，`deepseek-v4-flash` 是仍被接受的旧别名，由同一个 Flash 模型承接。

## 🔧 使用方法

1. **启动本地 AI 服务**（或准备 OpenAI API Key）：
   - 安装并启动 LM Studio 或其他支持 OpenAI API 的本地 AI 服务
   - 确保服务在配置的端点 URL 上运行

2. **配置扩展**：
   - 打开 VS Code 设置 (`Ctrl/Cmd + ,`)
   - 搜索 `simpleAutoComplete` 并配置端点、Provider、模型与 Token

3. **开始编码**：
   - 在任何代码文件中输入，然后停止输入；停顿 `simpleAutoComplete.triggerDelay` 毫秒（默认 800）后，建议会以灰色幽灵文本的形式出现
   - 按 `Tab` 接受建议，按 `Esc` 忽略建议
   - 按 `Ctrl+Tab` 可立即请求一次补全，无需等待停顿

> 当代码编辑器拥有焦点时，`Ctrl+Tab` 已被本扩展占用，因此不再切换到上一个编辑器。如果你更希望保留原快捷键，可在 **键盘快捷方式** 中搜索 `simpleAutoComplete.triggerCompletion` 并删除该绑定。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进此扩展！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 🐛 故障排除

**常见问题：**

- **连接被拒绝**：确认 AI 服务正在运行且端点 URL 配置正确
- **使用推理模型仍然偏慢**：部分模型（Kimi K3、Qwen 仅思考模式、OpenAI 推理模型）无法完全关闭思考，建议改用混合思考模型，如 `deepseek-flash`、`qwen3.8-max`、`glm-4.5`、`kimi-k2.6`
- **无补全建议**：检查 `simpleAutoComplete.enable` 是否为 `true`，然后执行 **Simple Auto Complete: Test Connection**，它会报告接口的真实返回
- **连接测试通过但没有幽灵文本**：请确认 `editor.inlineSuggest.enabled` 已开启——内联建议由 VS Code 本身渲染，关闭后无法显示任何内容；另外需要让编辑器静置满 `simpleAutoComplete.triggerDelay`，或直接按 `Ctrl+Tab`

## 📄 许可证

MIT License - 查看 LICENSE 文件了解详情

## 🆘 支持

如果您遇到问题或有功能建议，请：

- 提交新的 Issue
- 查阅配置文档

---
