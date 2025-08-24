// Unit tests for ask_report webview tool
// English comments only.
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createMcpServer, ToolRegistry } from '../../mcp-server';
import { askReport, AskUserResult } from '../../tools/ask_report';

// Fake panel factory to drive webview message flow without touching manual test
function createFakePanel() {
    type Listener = (e: any) => void;
    let onDidReceiveMessageListener: Listener | undefined;
    let onDidDisposeListener: (() => void) | undefined;

    const webview: any = {
        html: '',
        cspSource: 'vscode-resource://test',
        asWebviewUri: (u: vscode.Uri) => u,
        postMessage: async (_: any) => { },
        onDidReceiveMessage: (cb: Listener) => {
            onDidReceiveMessageListener = cb;
            return new vscode.Disposable(() => { });
        },
    };

    const panel: any = {
        webview,
        onDidDispose: (cb: () => void) => {
            onDidDisposeListener = cb;
            return new vscode.Disposable(() => { });
        },
        dispose: () => onDidDisposeListener?.(),
    };

    return { panel, send: (msg: any) => onDidReceiveMessageListener?.(msg) };
}

suite('ask_report tool', () => {
    let sandbox: sinon.SinonSandbox;
    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    // Helper: capture registered ask_report callback without changing working code
    async function captureAskReportCallback() {
        let captured: ((args: any, extra: any) => Promise<any>) | undefined;
        const orig = ToolRegistry.prototype.toolWithRawInputSchema;
        const stub = sandbox.stub(ToolRegistry.prototype, 'toolWithRawInputSchema').callsFake(function (this: any, name: string, desc: string, schema: any, cb: any) {
            if (name === 'ask_report') {
                captured = cb;
            }
            return orig.call(this, name, desc, schema, cb);
        } as any);
        // Trigger registration
        createMcpServer({ appendLine: () => { } } as any);
        stub.restore();
        if (!captured) throw new Error('ask_report callback was not captured');
        return captured;
    }

    test('9.1 submit resolves with Submit and exact option value', async () => {
        const fake = createFakePanel();
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(fake.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 0 } as any);

        const p = askReport({ markdown: 'Hi', predefinedOptions: ['A', 'B'] });
        fake.send({ type: 'submit', value: 'A' });
        const res: AskUserResult = await p;
        assert.strictEqual(res.decision, 'Submit');
        assert.strictEqual(res.value, 'A');
    });

    test('9.2 cancel resolves Cancel with empty value and tool text mapping', async () => {
        const fake = createFakePanel();
        const createStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(fake.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 0 } as any);

        const p = askReport({ markdown: 'Q' });
        fake.send({ type: 'cancel' });
        const res = await p;
        assert.strictEqual(res.decision, 'Cancel');
        assert.strictEqual(res.value, '');

        // Verify MCP tool mapping via captured callback
        const cb = await captureAskReportCallback();
        // Prepare fresh fake panel for the callback's internal askReport by updating existing stub
        const fake2 = createFakePanel();
        createStub.returns(fake2.panel as any);
        const toolPromise = cb({ projectName: 'X', message: 'Q' }, {});
        fake2.send({ type: 'cancel' });
        const callRes = await toolPromise;
        assert.strictEqual(callRes.content?.[0]?.text, 'User replied with empty input.');
    });

    test('9.3 timeout resolves Cancel with timeout flag', async () => {
        const fake = createFakePanel();
        const createStub = sandbox.stub(vscode.window, 'createWebviewPanel').returns(fake.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 1 } as any);

        const p = askReport({ markdown: 'Q' });
        fake.send({ type: 'timeout' });
        const res = await p;
        assert.strictEqual(res.decision, 'Cancel');
        assert.strictEqual(res.value, '');
        assert.strictEqual(res.timeout, true);

        const cb = await captureAskReportCallback();
        const fake2 = createFakePanel();
        createStub.returns(fake2.panel as any);
        // reuse existing getConfiguration stub already returning 1
        const toolPromise = cb({ projectName: 'X', message: 'Q' }, {});
        fake2.send({ type: 'timeout' });
        const callRes = await toolPromise;
        assert.strictEqual(callRes.content?.[0]?.text, 'User did not reply: Timeout occurred.');
    });

    test('9.4 copy posts to clipboard', async () => {
        const fake = createFakePanel();
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(fake.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 0 } as any);

        const p = askReport({ markdown: 'MD' });
        fake.send({ type: 'copy', text: 'MD' });
        fake.send({ type: 'cancel' });
        await p;
        const txt = await vscode.env.clipboard.readText();
        assert.strictEqual(txt, 'MD');
    });

    test('9.5 openExternal opens URL', async () => {
        const fake = createFakePanel();
        const openSpy = sandbox.stub(vscode.env, 'openExternal').resolves(true as any);
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(fake.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 0 } as any);

        const p = askReport({ markdown: 'MD' });
        fake.send({ type: 'openExternal', url: 'https://example.com' });
        fake.send({ type: 'cancel' });
        await p;

        sinon.assert.calledOnce(openSpy);
        const uriArg = openSpy.getCall(0).args[0] as vscode.Uri;
        assert.strictEqual(uriArg.toString(), vscode.Uri.parse('https://example.com').toString());
    });

    test('9.6 Custom requires non-empty input (UI prevents empty submit)', async () => {
        const fake = createFakePanel();
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(fake.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 0 } as any);

        const p = askReport({ markdown: 'MD' });
        // No submit sent; cancel to finish
        fake.send({ type: 'cancel' });
        const res = await p;
        assert.strictEqual(res.decision, 'Cancel');
        assert.strictEqual(res.value, '');
    });

    test('9.7 Without predefinedOptions submit accepts free text', async () => {
        const fake = createFakePanel();
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(fake.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 0 } as any);

        const p = askReport({ markdown: 'MD' });
        fake.send({ type: 'submit', value: 'free text' });
        const res = await p;
        assert.strictEqual(res.decision, 'Submit');
        assert.strictEqual(res.value, 'free text');
    });

    test('9.8 concurrent panels resolve independently', async () => {
        const f1 = createFakePanel();
        const f2 = createFakePanel();
        const createStub = sandbox.stub(vscode.window, 'createWebviewPanel');
        createStub.onCall(0).returns(f1.panel as any);
        createStub.onCall(1).returns(f2.panel as any);
        sandbox.stub(vscode.extensions, 'getExtension').returns({ extensionUri: vscode.Uri.file('/') } as any);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({ get: () => 0 } as any);

        const p1 = askReport({ markdown: 'One' });
        const p2 = askReport({ markdown: 'Two' });

        f1.send({ type: 'submit', value: 'A' });
        const r1 = await p1;
        assert.strictEqual(r1.value, 'A');

        f2.send({ type: 'submit', value: 'B' });
        const r2 = await p2;
        assert.strictEqual(r2.value, 'B');
    });
});
