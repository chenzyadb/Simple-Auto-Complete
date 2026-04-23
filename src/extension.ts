import * as vscode from 'vscode';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Simple Auto Complete extension is now active!');

    // 创建状态栏项用于显示扩展状态
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(zap) Auto Complete";
    statusBarItem.tooltip = "Auto Complete Active";
    statusBarItem.show();

    // 注册补全项提供者
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        '*', // 支持所有语言
        new AICompletionProvider(statusBarItem),
        '=', ':', '.', '(', '[', ' ', '\t'
    );

    // 监听文本变化事件
    const textChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        handleTextChange(event.document);
    });

    // 监听编辑器切换事件
    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
        resetDebounceTimer();
    });

    context.subscriptions.push(
        completionProvider, 
        textChangeDisposable, 
        editorChangeDisposable,
        statusBarItem
    );
}

function handleTextChange(document: vscode.TextDocument) {
    resetDebounceTimer();
    
    // 防抖延时
    const debounceDelay = vscode.workspace.getConfiguration('simpleAutoComplete').get('debounceDelay', 200);

    debounceTimer = setTimeout(() => {
        const activeEditor = vscode.window.activeTextEditor;
        
        if (activeEditor && activeEditor.document === document) {
            getContextCode(activeEditor);
        }
    }, debounceDelay);
}

function resetDebounceTimer() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

async function getContextCode(editor: vscode.TextEditor) {
    const cursorPosition = editor.selection.active;
    const document = editor.document;
    
    const startLine = Math.max(0, cursorPosition.line - 20);
    const endLine = cursorPosition.line;
    
    const contextRange = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, document.lineAt(endLine).range.end.character)
    );
    
    const contextCode = document.getText(contextRange);
    
    // 存储上下文供补全提供者使用
    AICompletionProvider.currentContext = contextCode;
}

class AICompletionProvider implements vscode.CompletionItemProvider {
    static currentContext: string = '';
    private statusBarItem: vscode.StatusBarItem;

    constructor(statusBarItem: vscode.StatusBarItem) {
        this.statusBarItem = statusBarItem;
    }

    // 实现 handleDidShowCompletionItems 方法来处理补全项的显示
    handleDidShowCompletionItems?(context: vscode.CompletionList): void {
        // 可选的处理方法
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        return this.provideAICompletions(document, position, token, context);
    }

    private async provideAICompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        // 更新状态栏指示器
        this.statusBarItem.text = "$(sync~spin) Generating...";
        
        try {
            // 构建上下文代码 - 获取光标前的文本和一些前面的行
            const linesBefore = Math.min(20, position.line + 1); // 获取前20行或全部
            let contextStartLine = Math.max(0, position.line - linesBefore + 1);
            
            let contextCode = '';
            for (let i = contextStartLine; i <= position.line; i++) {
                const line = document.lineAt(i);
                if (i === position.line) {
                    // 当前行只取光标前的部分
                    contextCode += line.text.substring(0, position.character);
                } else {
                    contextCode += line.text + '\n';
                }
            }
            
            // 存储当前上下文供后续使用
            AICompletionProvider.currentContext = contextCode;
            
            const completion = await this.getAICompletion(contextCode);
            if (completion && completion.trim().length > 0) {
                // 截取 completion 的前几个单词作为 label
                let label = completion; 
                if (completion.length > 32) {
                    label = completion.substring(0, 32) + '...';
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
            this.showErrorNotification(error as Error);
        } finally {
            // 恢复状态栏指示器
            this.statusBarItem.text = "$(zap) Auto Complete";
        }

        return items;
    }

    private async getAICompletion(contextCode: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

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
                            role: "system",
                            content: "You are an expert code assistant. Provide only pure code completions without any markdown formatting, code block markers (like ```), language identifiers, or explanations. Return only the raw code that should be inserted directly into the editor. Do not repeat existing code from the context."
                        },
                        {
                            role: "user",
                            content: `Complete the following code based on the context. Do not repeat existing code in context. context:\n${contextCode}\n`
                        }
                    ],
                    temperature: 0.2,
                    max_tokens: 128,
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            let completion = data.choices[0]?.message?.content?.trim() || null;
            
            // 清理代码以外的多余部分
            if (completion) {
                completion = this.cleanUpCode(contextCode, completion);
            }
            
            return completion;
        } catch (error) {
            this.showErrorNotification(error as Error);
            return null;
        }
    }

    private cleanUpCode(contextCode: string, completion: string): string {
        completion = completion.replace(/^```[\w]*\n?/gm, '').replace(/\n?``` $ /gm, '').trim().split('\n')[0];

        const contextLines = contextCode.split('\n');
        const lastContextLine = contextLines[contextLines.length - 1].replace(/^\s+/, '');
        
        // 如果补全是基于最后一行的延续，移除重复部分
        if (completion.startsWith(lastContextLine)) {
            // 移除补全中与上下文重复的部分
            completion = completion.substring(lastContextLine.length);
        }
        
        return completion;
    }

    private showErrorNotification(error: Error) {
        const errorMessage = error.message;
        
        // 根据错误类型显示不同的用户提示
        if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('timeout')) {
            vscode.window.showWarningMessage(
                'AI API request timed out. Consider checking your model settings.',
                'Retry', 'Settings'
            ).then(selection => {
                if (selection === 'Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'simple-auto-complete');
                }
            });
        } else {
            // 其他错误
            vscode.window.showErrorMessage(
                `AutoComplete error: ${errorMessage}`,
                'Details', 'Report'
            ).then(selection => {
                if (selection === 'Details') {
                    // 显示详细错误信息
                    const outputChannel = vscode.window.createOutputChannel('Simple Auto Complete');
                    outputChannel.appendLine(`AI API Error: ${errorMessage}`);
                    outputChannel.show();
                }
            });
        }
    }
}

export function deactivate() {
    resetDebounceTimer();
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}