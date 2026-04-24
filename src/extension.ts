import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // 创建状态栏项用于显示扩展状态
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(zap) Auto Complete";
    statusBarItem.tooltip = "Auto Complete Active";
    statusBarItem.show();

    // 创建补全提供者实例
    const aiCompletionProvider = new AICompletionProvider(statusBarItem);

    // 注册补全项提供者
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        '*',
        aiCompletionProvider,
        '=', ':', '+', '-', '*', '/', '%', '&', '|', ',', '(', '[', '{', '<', '>', '\'', '\"'
    );

    // 添加到VSCode订阅管理
    context.subscriptions.push(completionProvider, statusBarItem);
}

class AICompletionProvider implements vscode.CompletionItemProvider {
    private statusBarItem: vscode.StatusBarItem;
    private currentAbortController: AbortController | null = null;

    constructor(statusBarItem: vscode.StatusBarItem) {
        this.statusBarItem = statusBarItem;
    }

    handleDidShowCompletionItems?(context: vscode.CompletionList): void { }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        // 检查触发上下文
        if (context.triggerCharacter === '\t') {
            console.log('Tab triggered completion');
        }
        
        // 取消之前的请求
        if (this.currentAbortController) {
            this.currentAbortController.abort();
        }
        
        // 创建新的AbortController用于当前请求
        this.currentAbortController = new AbortController();
        
        // 监听VSCode的取消令牌
        token.onCancellationRequested(() => {
            if (this.currentAbortController) {
                this.currentAbortController.abort();
            }
        });

        return this.provideAICompletions(document, position, token, context);
    }

    async provideAICompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        // 更新状态栏指示器
        this.statusBarItem.text = "$(sync~spin) Generating...";
        
        try {
            const linesBefore = Math.min(100, position.line + 1); // 获取前100行
            let contextStartLine = Math.max(0, position.line - linesBefore + 1);
            
            // 获取当前行光标前的内容
            const currentLine = document.lineAt(position.line).text;
            let contextCode = '\n' + currentLine.substring(0, position.character);

            // 上下文行数限制
            const maxContextLines = vscode.workspace.getConfiguration('simpleAutoComplete').get("maxContextLines", 20);

            // 获取一些前面的行
            if (position.line > 0) {
                let contextLines = 1;
                for (let i = (position.line - 1); i >= contextStartLine; i--) {
                    const lineText = document.lineAt(i).text;

                    // 忽略空行
                    if (lineText.trim().length > 0) {
                        contextCode = lineText + '\n' + contextCode;
                        contextLines++;
                    }

                    // 达到上下文行数限制, 退出循环
                    if (contextLines >= maxContextLines) {
                        break;
                    }
                }
            }

            const completion = await this.getAICompletion(document.fileName, document.languageId, contextCode);
            
            // 检查请求是否被取消
            if (token.isCancellationRequested || (this.currentAbortController && this.currentAbortController.signal.aborted)) {
                return []; // 请求被取消，返回空数组
            }
            
            if (completion && completion.trim().length > 0) {
                // 截取 completion 的前几个单词作为 label
                let label = completion; 
                if (completion.length > 100) {
                    label = completion.substring(0, 100);
                }
                
                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
                item.insertText = new vscode.SnippetString(completion);
                item.documentation = new vscode.MarkdownString('Simple Auto Complete');
                item.detail = 'AutoComplete';
                item.preselect = true;
                item.sortText = '0';

                items.push(item);
            }
        } catch (error) {
            this.handleError(error as Error);
        } finally {
            // 清理当前的AbortController
            if (this.currentAbortController) {
                this.currentAbortController = null;
            }
            // 恢复状态栏指示器
            this.statusBarItem.text = "$(zap) Auto Complete";
        }

        return items;
    }

    private async getAICompletion(fileName: string, fileType: string, contextCode: string): Promise<string | null> {
        try {
            // 使用当前的AbortController
            const controller = this.currentAbortController;
            
            // 如果没有controller或者已经被取消，则直接返回
            if (!controller || controller.signal.aborted) {
                throw new Error('Request already cancelled');
            }

            const timeOutMs = vscode.workspace.getConfiguration('simpleAutoComplete').get("timeOut", 1000);
            const timeoutId = setTimeout(() => controller.abort(), timeOutMs);

            // 向AI发送请求
            const apiEndPoint = vscode.workspace.getConfiguration('simpleAutoComplete').get('apiEndpoint', 'http://127.0.0.1:1234');
            const response = await fetch(apiEndPoint + '/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "",
                    messages: [
                        {
                            role: "user",
                            content: `You are an expert ${fileType} language Code Assistant.\nPlease complete the code.\nOutput ONLY the code that should be added, NO markdown, NO backticks, NO explanations.\nDO NOT repeat any code from context.\n\n\"${fileName}\" context:\n${contextCode}\n`
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 128,
                    stop: ["<|endoftext|>", "\n\n"],
                    top_p: 0.95, 
                    frequency_penalty: 0,
                    presence_penalty: 0, 
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // 再次检查是否被取消
            if (controller.signal.aborted) {
                throw new Error('Request was cancelled');
            }

            if (!response.ok) {
                throw new Error(`OpenAI API returned status ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            let completion = data.choices[0]?.message?.content?.trim() || null;
            
            // 清理代码以外的多余部分
            if (completion) {
                completion = this.cleanUpCode(contextCode, completion);
            }
            
            return completion;
        } catch (error) {
            this.handleError(error as Error);
            return null;
        }
    }

    private cleanUpCode(contextCode: string, completion: string): string {
        // 移除Markdown部分并获取第一行
        completion = completion.replace(/^```[\w]*\n?/gm, '').replace(/\n?``` $ /gm, '').trim().split('\n')[0];

        // 按行分割上下文
        const contextLines = contextCode.split('\n');
        
        // 获取上下文的最后一行（去除前导空格）
        const lastContextLine = contextLines[contextLines.length - 1].trimStart();
        
        // 去除重复部分
        const index = completion.indexOf(lastContextLine);
        if (index !== -1) {
            return completion.substring(index + lastContextLine.length);
        }
        
        return completion;
    }

    // 处理全部的错误信息
    private handleError(error: Error) {
        console.log('AutoComplete Error: ' + error.message);
    }
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}