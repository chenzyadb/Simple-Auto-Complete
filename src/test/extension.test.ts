import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';

const EXTENSION_ID = 'chenzyadb.simple-auto-complete';
const IDLE_DELAY_MS = 900;
const TYPING_INTERVAL_MS = 150;
const COMPLETION = 'return a + b';

interface StubServer {
    endpoint: string;
    /** Request bodies of every POST the extension made. */
    requests: string[];
    close: () => Promise<void>;
}

/** Minimal OpenAI-compatible server: answers with one completion and records what was asked. */
async function startStubServer(): Promise<StubServer> {
    const requests: string[] = [];
    const server = http.createServer((request, response) => {
        if (request.method !== 'POST') {
            // The endpoint probe uses a GET; an unauthenticated 401 means "this is an API".
            response.writeHead(401, { 'content-type': 'application/json' });
            response.end('{"error":{"message":"no token"}}');
            return;
        }

        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            requests.push(Buffer.concat(chunks).toString('utf8'));
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: COMPLETION } }],
            }));
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return {
        endpoint: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

const SETTINGS: Record<string, unknown> = {
    enable: true,
    provider: 'openai-compatible',
    model: 'stub-model',
    disableThinking: false,
    triggerDelay: IDLE_DELAY_MS,
    timeOut: 5000,
    extraRequestBody: '',
};

async function applySettings(values: Record<string, unknown>): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('simpleAutoComplete');
    for (const [key, value] of Object.entries(values)) {
        await configuration.update(key, value, vscode.ConfigurationTarget.Global);
    }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

suite('Simple Auto Complete', function () {
    // Each case deliberately waits for a real idle pause, so mocha's default 2 s is too short.
    this.timeout(30000);

    let stub: StubServer;

    setup(async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `the extension ${EXTENSION_ID} must be installed in the test host`);
        await extension.activate();

        stub = await startStubServer();
        await applySettings({ ...SETTINGS, apiEndpoint: stub.endpoint });
    });

    teardown(async () => {
        await stub.close();
        // Do not leak the stub endpoint into the next run's user settings.
        await applySettings({ apiEndpoint: undefined });
    });

    test('asks the API only after the editor has been idle', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'python',
            content: 'def add(a, b):\n    return a',
        });
        const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
        await sleep(150);

        // Type faster than the idle delay: the pending request must be dropped every time.
        for (let index = 0; index < 6; index++) {
            await editor.edit((builder) => builder.insert(new vscode.Position(0, index), 'x'));
            await sleep(TYPING_INTERVAL_MS);
        }
        assert.strictEqual(stub.requests.length, 0, 'no request may be sent while the user keeps typing');

        // Park the cursor behind the code and stop touching the editor.
        const end = document.lineAt(document.lineCount - 1).range.end;
        editor.selection = new vscode.Selection(end, end);

        // Exactly one request must go out after the pause.
        await sleep(IDLE_DELAY_MS + 1500);
        assert.strictEqual(stub.requests.length, 1, 'exactly one request once the editor goes idle');

        const body = JSON.parse(stub.requests[0]) as {
            model?: string;
            messages?: Array<{ role?: string; content?: string }>;
        };
        assert.strictEqual(body.model, 'stub-model');
        const prompt = body.messages?.[0]?.content ?? '';
        assert.match(prompt, /xxxxxxdef add/, `the prompt must carry the code context, got: ${prompt}`);
    });

    test('the trigger command skips the pause and is bound to Ctrl+Tab', async () => {
        const manifest = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON as {
            contributes?: { keybindings?: Array<{ command?: string; key?: string; when?: string }> };
        };
        const binding = manifest.contributes?.keybindings?.find(
            (entry) => entry.command === 'simpleAutoComplete.triggerCompletion'
        );
        assert.ok(binding, 'the manifest must bind a shortcut to the trigger command');
        assert.strictEqual(binding.key, 'ctrl+tab');
        assert.match(binding.when ?? '', /editorTextFocus/);

        // Push the idle delay far out, so the shortcut is the only possible source of a request.
        await applySettings({ triggerDelay: 60000 });
        const document = await vscode.workspace.openTextDocument({
            language: 'python',
            content: 'def add(a, b):\n    return a',
        });
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
        await sleep(150);
        assert.strictEqual(stub.requests.length, 0, 'the idle delay must not have elapsed yet');

        await vscode.commands.executeCommand('simpleAutoComplete.triggerCompletion');
        await sleep(500);
        assert.strictEqual(stub.requests.length, 1, 'the command must ask for a completion right away');
    });
});
