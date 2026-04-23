# Simple Auto Complete

An AI-powered intelligent code completion VSCode extension that leverages local AI models (such as LMStudio) to provide real-time smart code completion suggestions for your projects.

## 🚀 Features

- **AI-Powered Code Completion**: Provides intelligent completion suggestions based on your current code context
- **Local AI Model Support**: Integrates with local AI services like LMStudio to protect code privacy
- **Real-Time Completion**: Automatically provides completion suggestions as you type
- **Configurable Delay**: Supports adjusting debounce delay time for completion triggers
- **Status Bar Indicator**: Real-time display of completion service status
- **Multi-Language Support**: Supports code completion for popular programming languages

## 📦 Requirements

- Visual Studio Code v1.70.0+
- Locally running AI service (such as [LMStudio](https://lmstudio.ai/))
- AI service supporting OpenAI-compatible API

## ⚙️ Configuration Options

This extension provides the following configurable options:

| Setting | Type | Default Value | Description |
|--------|------|--------|------|
| `simpleAutoComplete.apiEndpoint` | `string` | `"http://127.0.0.1:1234"` | LMStudio API endpoint URL |
| `simpleAutoComplete.debounceDelay` | `number` | `200` | Delay time before triggering completion (milliseconds), range 100-1000 |

### Configuration Example

```json
{
    "simpleAutoComplete.apiEndpoint": "http://127.0.0.1:1234",
    "simpleAutoComplete.debounceDelay": 200
}
```

## 🔧 Usage

1. **Start Local AI Service**:
   - Install and start LMStudio or other OpenAI API compatible local AI service
   - Ensure the service is running at the configured endpoint URL

2. **Configure Extension**:
   - Open VSCode settings (`Ctrl/Cmd + ,`)
   - Search for `simpleAutoComplete` and configure your API endpoint

3. **Start Coding**:
   - Begin typing in any code file
   - Completion suggestions will appear automatically
   - Press `Tab` or `Enter` to accept suggestions

## 🤝 Contributing

Feel free to submit Issues and Pull Requests to improve this extension!

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🐛 Troubleshooting

**Common Issues:**

- **Connection Refused**: Verify that the AI service is running and endpoint URL is configured correctly
- **Slow Completion Response**: Try reducing the `debounceDelay` setting or upgrading hardware configuration
- **No Completion Suggestions**: Check if the `enable` setting is set to `true`

**Error Handling:**
- Network connection errors will show warning messages
- API timeouts (5 seconds) will be automatically canceled
- Service unavailability will show corresponding error notifications

## 📄 License

MIT License - See the LICENSE file for details

## 🆘 Support

If you encounter issues or have feature suggestions, please:

- Submit a new Issue
- Consult the configuration documentation

---

⭐ If this extension helps you, please star the project!


# Simple Auto Complete

一个基于 AI 的智能代码补全 VSCode 扩展，利用本地 AI 模型（如 LMStudio）为您的代码提供实时智能补全建议。

## 🚀 功能特性

- **AI 驱动的代码补全**：基于您当前的代码上下文提供智能补全建议
- **本地 AI 模型支持**：与 LMStudio 等本地 AI 服务集成，保护代码隐私
- **实时补全**：在您输入时自动提供补全建议
- **可配置延迟**：支持调整补全触发的防抖延迟时间
- **状态栏指示器**：实时显示补全服务状态
- **多语言支持**：支持热门编程语言的代码补全

## 📦 安装要求

- Visual Studio Code v1.70.0+
- 本地运行的 AI 服务（如 [LMStudio](https://lmstudio.ai/)）
- 支持 OpenAI 兼容 API 的 AI 服务

## ⚙️ 配置选项

本扩展提供以下可配置选项：

| 设置项 | 类型 | 默认值 | 描述 |
|--------|------|--------|------|
| `simpleAutoComplete.apiEndpoint` | `string` | `"http://127.0.0.1:1234"` | LMStudio API 端点 URL |
| `simpleAutoComplete.debounceDelay` | `number` | `200` | 触发补全前的延迟时间（毫秒），范围 100-1000 |

### 配置示例

```json
{
    "simpleAutoComplete.apiEndpoint": "http://127.0.0.1:1234",
    "simpleAutoComplete.debounceDelay": 200
}
```

## 🔧 使用方法

1. **启动本地 AI 服务**：
   - 安装并启动 LMStudio 或其他支持 OpenAI API 的本地 AI 服务
   - 确保服务在配置的端点 URL 上运行

2. **配置扩展**：
   - 打开 VSCode 设置 (`Ctrl/Cmd + ,`)
   - 搜索 `simpleAutoComplete` 并配置您的 API 端点

3. **开始编码**：
   - 在任何代码文件中开始输入
   - 补全建议将自动出现
   - 按 `Tab` 或 `Enter` 接受建议

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
- **补全响应慢**：尝试降低 `debounceDelay` 设置或升级硬件配置
- **无补全建议**：检查 `enable` 设置是否为 `true`

**错误处理：**
- 网络连接错误会显示警告消息
- API 超时（5秒）会自动取消请求
- 服务不可用时会显示相应的错误提示

## 📄 许可证

MIT License - 查看 LICENSE 文件了解详情

## 🆘 支持

如果您遇到问题或有功能建议，请：

- 提交新的 Issue
- 查阅配置文档

---

⭐ 如果这个扩展对您有帮助，请给项目加星！