import * as vscode from 'vscode'

// Types for ask_report tool API
// These types follow the design spec and are minimal to compile and integrate.
export type AskReportOptions = {
    // Title of the panel window; defaults to "Ask Report" if not provided
    title?: string
    // Markdown content to display in the webview
    markdown: string
    // Optional pre-filled value for the textarea in the webview
    initialValue?: string
    // Optional predefined options to render as radio buttons
    predefinedOptions?: string[]
}

export type AskUserResult = {
    // User's decision
    decision: 'Submit' | 'Cancel'
    // The submitted value (empty string for Cancel/close)
    value: string
    // True when the result was resolved due to timeout (not used in this scaffold)
    timeout?: boolean
}

// Create a webview panel for ask_report and return a placeholder Cancel result for now.
export async function askReport(opts: AskReportOptions): Promise<AskUserResult> {
    const title = opts.title ?? 'Ask Report'

    // Resolve extension media folder for localResourceRoots
    const ext = vscode.extensions.getExtension('ivan-mezentsev.vsc-mcp-server')
    const extensionUri = ext?.extensionUri ?? vscode.Uri.file('')
    const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media')

    const panel = vscode.window.createWebviewPanel(
        'mcp.askReport',
        title,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: [mediaRoot],
        },
    )

    // Prepare resource URIs for webview
    const cssUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'ask_report.css'),
    )
    const markdownDepsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'markdown-deps.js'),
    )
    const hljsCssUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'highlight.github.css'),
    )

    // Generate secure HTML with CSP, connect marked.min.js via asWebviewUri, and build UI containers.
    const nonce = generateNonce()
    const csp = [
        "default-src 'none'",
        `img-src ${panel.webview.cspSource} blob: data:`,
        `style-src ${panel.webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ')

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="${csp}" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri}" />
    <link rel="stylesheet" href="${hljsCssUri}" />
        <title>${escapeHtml(title)}</title>
    </head>
    <body>
        <div class="askreport__progress" aria-hidden="true">
            <div id="progressLine" class="askreport__progress-line"></div>
        </div>
        <header class="askreport__header" role="toolbar" aria-label="Ask report toolbar">
            <button id="copyBtn" class="btn secondary icon-btn" aria-label="Copy content" title="Copy"></button>
            <button id="saveBtn" class="btn secondary icon-btn" aria-label="Save" title="Save"></button>
            <div class="spacer"></div>
            <button id="pauseBtn" class="btn secondary icon-btn" aria-label="Pause timer" title="Pause"></button>
            <span id="timer" class="timer" aria-live="polite">0</span>
        </header>
        <main class="askreport__main">
            <section id="markdown" class="markdown" aria-label="Markdown content" tabindex="0"></section>
        </main>
        <footer class="askreport__footer askreport__dock" id="bottomDock">
            <div class="controls">
                <fieldset id="optionsFieldset" class="options" aria-label="Ask report options"></fieldset>
                <textarea id="customText" class="textarea" aria-label="Custom response" placeholder="Type your response…"></textarea>
            </div>
            <div class="actions">
                <button id="submitBtn" class="btn primary" aria-label="Submit" disabled>Submit</button>
                <button id="cancelBtn" class="btn" aria-label="Cancel">Cancel</button>
            </div>
        </footer>
    <script nonce="${nonce}" src="${markdownDepsUri}"></script>
        <script nonce="${nonce}">
            // Webview script — no external deps; relies on VS Code API provided object
            const vscode = acquireVsCodeApi();
            /** @type {{ markdown: string; initialValue?: string; options?: string[]; timeout?: number }} */
            let initData = { markdown: '', initialValue: '', options: [], timeout: 0 };

            // cache DOM
            const el = {
                markdown: document.getElementById('markdown'),
                copyBtn: document.getElementById('copyBtn'),
                saveBtn: document.getElementById('saveBtn'),
                pauseBtn: document.getElementById('pauseBtn'),
                timer: document.getElementById('timer'),
                progress: document.getElementById('progressLine'),
                options: document.getElementById('optionsFieldset'),
                textarea: document.getElementById('customText'),
                submit: document.getElementById('submitBtn'),
                cancel: document.getElementById('cancelBtn'),
                    dock: document.getElementById('bottomDock'),
            };

            let selected = '';
            let usingCustom = false;
            /** @type {number} */
            let remaining = 0;
            /** @type {boolean} */
            let paused = false;
            /** @type {number | undefined} */
            let intervalId = undefined;

            // SVG icon helpers
            function setCopyIcon() {
                if (!el.copyBtn) return;
                el.copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">\
                        <path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1z" fill="currentColor"/>\
                        <path d="M20 5H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h12v14z" fill="currentColor"/>\
                    </svg>';
            }
            function setSaveIcon() {
                if (!el.saveBtn) return;
                // Floppy disk outline icon to match outline style
                el.saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">\
                        <path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>\
                        <path d="M9 3h6v6H9V3z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>\
                        <path d="M7 21v-6h10v6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>\
                    </svg>';
            }
            function setPausePlayIcon() {
                if (!el.pauseBtn) return;
                if (paused) {
                    // show play icon
                    el.pauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">\
                            <path d="M8 5v14l11-7L8 5z" fill="currentColor"/>\
                        </svg>';
                } else {
                    // show pause icon
                    el.pauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">\
                            <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/>\
                        </svg>';
                }
            }

            function renderTimer() {
                if (!initData.timeout || initData.timeout <= 0) {
                    el.timer.textContent = '';
                    el.pauseBtn.style.display = 'none';
                    if (el.progress) { el.progress.style.width = '0%'; }
                    return;
                }
                // Only digits (no label or unit)
                el.timer.textContent = String(Math.max(0, remaining));
                el.pauseBtn.style.display = '';
                // update progress line: 100% -> 0%
                if (el.progress && typeof initData.timeout === 'number' && initData.timeout > 0) {
                    const pct = Math.max(0, Math.min(100, Math.round((remaining / initData.timeout) * 100)));
                    el.progress.style.width = pct + '%';
                }
                // ensure icon reflects state
                setPausePlayIcon();
            }

            function stopTimer() {
                if (intervalId !== undefined) {
                    clearInterval(intervalId);
                    intervalId = undefined;
                }
            }

            function disableAllInputs() {
                try { el.submit.disabled = true; } catch {}
                try { el.cancel.disabled = true; } catch {}
                try { el.textarea.disabled = true; } catch {}
                try { (el.options).setAttribute('disabled', ''); } catch {}
                try { el.pauseBtn.disabled = true; } catch {}
            }

            function startTimer() {
                stopTimer();
                if (!initData.timeout || initData.timeout <= 0) {
                    el.pauseBtn.style.display = 'none';
                    renderTimer();
                    return;
                }
                if (remaining <= 0) remaining = initData.timeout;
                intervalId = setInterval(() => {
                    if (paused) {
                        return;
                    }
                    remaining -= 1;
                    renderTimer();
                    if (remaining <= 0) {
                        stopTimer();
                        // Deactivate inputs and notify extension
                        disableAllInputs();
                        vscode.postMessage({ type: 'timeout' });
                    }
                }, 1000);
                renderTimer();
            }
            /** Enable/disable submit based on current selection rules */
            function updateSubmitState() {
                if (!initData.options || initData.options.length === 0) {
                    // Only textarea mode
                    const valid = (el.textarea.value || '').trim().length > 0;
                    el.submit.disabled = !valid;
                    return;
                }
                if (usingCustom) {
                    el.submit.disabled = ((el.textarea.value || '').trim().length === 0);
                    return;
                }
                el.submit.disabled = (selected === '');
            }

            function updateTextareaVisibility() {
                // Explicitly control display instead of relying on stylesheet defaults
                // to avoid being overridden by "textarea { display: none; }" in CSS.
                if (!initData.options || initData.options.length === 0) {
                    el.textarea.style.display = 'block';
                    return;
                }
                el.textarea.style.display = usingCustom ? 'block' : 'none';
            }

                function updateDockHeightVar() {
                    try {
                        const root = document.documentElement;
                        const h = el.dock ? (el.dock.getBoundingClientRect().height || 0) : 0;
                        root.style.setProperty('--askreport-dock-height', Math.max(96, Math.round(h)) + 'px');
                    } catch {}
                }

            function renderOptions(options) {
                el.options.innerHTML = '';
                if (!options || options.length === 0) {
                    el.options.style.display = 'none';
                    usingCustom = true; // only textarea path
                    updateTextareaVisibility();
                        updateDockHeightVar();
                    return;
                }
                el.options.style.display = '';
                const group = document.createElement('div');
                group.className = 'radio-group';
                options.forEach((opt, idx) => {
                    const id = 'opt_' + idx;
                    const label = document.createElement('label');
                    label.className = 'radio';
                    const input = document.createElement('input');
                    input.type = 'radio';
                    input.name = 'ask_report_option';
                    input.id = id;
                    input.value = opt;
                    input.addEventListener('change', () => {
                        usingCustom = false;
                        selected = input.value;
                        updateSubmitState();
                        updateTextareaVisibility();
                        updateDockHeightVar();
                        persistState();
                    });
                    const span = document.createElement('span');
                    span.textContent = opt;
                    label.appendChild(input);
                    label.appendChild(span);
                    group.appendChild(label);
                });
                // Custom option (always last)
                const customLabel = document.createElement('label');
                customLabel.className = 'radio';
                const customInput = document.createElement('input');
                customInput.type = 'radio';
                customInput.name = 'ask_report_option';
                customInput.id = 'opt_custom';
                customInput.value = '__CUSTOM__';
                customInput.addEventListener('change', () => {
                    usingCustom = true;
                    selected = '';
                    el.textarea.focus();
                    updateSubmitState();
                    updateTextareaVisibility();
                    updateDockHeightVar();
                    persistState();
                });
                const customSpan = document.createElement('span');
                customSpan.textContent = 'Custom';
                customLabel.appendChild(customInput);
                customLabel.appendChild(customSpan);
                group.appendChild(customLabel);
                el.options.appendChild(group);

                // Preselect first predefined option (matches reference UX)
                const first = group.querySelector('input[type=radio][id^="opt_"]');
                if (first) {
                    /** @type {HTMLInputElement} */ (first).checked = true;
                    selected = /** @type {HTMLInputElement} */ (first).value;
                    usingCustom = false;
                    // Ensure any listeners depending on change are fired
                    first.dispatchEvent(new Event('change'));
                } else {
                    updateSubmitState();
                    updateTextareaVisibility();
                    updateDockHeightVar();
                }
            }

            function focusFirst() {
                const firstRadio = el.options.querySelector('input[type=radio]');
                if (firstRadio) {
                    /** @type {HTMLInputElement} */ (firstRadio).focus();
                    return;
                }
                el.textarea.focus();
            }

            function getSubmitValue() {
                if (!initData.options || initData.options.length === 0) {
                    return (el.textarea.value || '').trim();
                }
                if (usingCustom) {
                    return (el.textarea.value || '').trim();
                }
                return selected;
            }

        function sendSubmit() {
                const value = getSubmitValue();
                if (!el.submit.disabled) {
                    stopTimer();
            persistState();
                    vscode.postMessage({ type: 'submit', value });
                }
            }

            function sendCancel() {
                stopTimer();
                persistState();
                vscode.postMessage({ type: 'cancel' });
            }

            // Keyboard handlers: Ctrl/Cmd+Enter for submit, Esc for cancel
            document.addEventListener('keydown', (ev) => {
                const isSubmitCombo = (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey));
                if (isSubmitCombo) {
                    ev.preventDefault();
                    sendSubmit();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    sendCancel();
                }
            });

            // Local UI events
            el.textarea.addEventListener('input', () => {
                updateSubmitState();
                persistState();
                    updateDockHeightVar();
            });
            el.copyBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'copy', text: initData.markdown || '' });
                // brief ui feedback
                el.copyBtn.classList.add('active');
                setTimeout(() => el.copyBtn.classList.remove('active'), 300);
            });
            el.saveBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'save', text: initData.markdown || '' });
                el.saveBtn.classList.add('active');
                setTimeout(() => el.saveBtn.classList.remove('active'), 300);
            });
            el.pauseBtn.addEventListener('click', () => {
                if (!initData.timeout || initData.timeout <= 0) return;
                if (!paused) {
                    paused = true;
                    el.pauseBtn.setAttribute('aria-label', 'Resume timer');
                    el.pauseBtn.setAttribute('title', 'Resume');
                } else {
                    paused = false;
                    el.pauseBtn.setAttribute('aria-label', 'Pause timer');
                    el.pauseBtn.setAttribute('title', 'Pause');
                }
                setPausePlayIcon();
                renderTimer();
                persistState();
            });
            el.submit.addEventListener('click', () => sendSubmit());
            el.cancel.addEventListener('click', () => sendCancel());

                // Recompute reserved space when viewport changes
                window.addEventListener('resize', () => updateDockHeightVar());

            window.addEventListener('message', (event) => {
                const msg = event.data;
                if (!msg || msg.type !== 'init') return;
                initData = msg.payload || initData;
                try {
                    // Render markdown using marked with HTML disabled for safety
                    if (window.marked) {
                        // Ensure GitHub-flavored markdown (tables, etc.) is enabled.
                        try {
                            if (typeof window.marked.setOptions === 'function') {
                                window.marked.setOptions({ gfm: true });
                            } else {
                                // Fallback: some versions use .use() pattern
                                window.marked.use({ gfm: true });
                            }
                        } catch {}
                        window.marked.use({ mangle: false, headerIds: false });
                        const html = window.marked.parse(initData.markdown || '', { async: false });
                        el.markdown.innerHTML = html;
                        // Highlight code blocks (auto-detect, but exclude mermaid)
                        if (window.hljs) {
                            el.markdown.querySelectorAll('pre code:not(.language-mermaid)').forEach((block) => {
                                try { window.hljs.highlightElement(block); } catch {}
                            });
                        }
                        // Render Mermaid diagrams
                        if (window.mermaid) {
                            try {
                                if (!window.mermaidInitialized) {
                                    const bodyStyle = getComputedStyle(document.body);
                                    window.mermaid.initialize({
                                        startOnLoad: false,
                                        securityLevel: 'strict',
                                        theme: 'base',
                                        themeVariables: {
                                            background: bodyStyle.getPropertyValue('--vscode-editor-background').trim(),
                                            primaryColor: bodyStyle.getPropertyValue('--vscode-editorWidget-background').trim(),
                                            primaryTextColor: bodyStyle.getPropertyValue('--vscode-editor-foreground').trim(),
                                            lineColor: bodyStyle.getPropertyValue('--vscode-editorWidget-border').trim(),
                                            nodeBorder: bodyStyle.getPropertyValue('--vscode-focusBorder').trim(),
                                        },
                                    });
                                    window.mermaidInitialized = true;
                                }

                                el.markdown.querySelectorAll('pre code.language-mermaid').forEach((block) => {
                                    const container = document.createElement('div');
                                    container.className = 'mermaid';
                                    container.textContent = block.textContent || '';
                                    block.parentElement?.replaceWith(container);
                                });
                                window.mermaid.run();
                            } catch (e) {
                                console.warn('Failed to render mermaid diagrams:', e);
                            }
                        }
                    } else {
                        el.markdown.textContent = initData.markdown || '';
                    }
                } catch {
                    el.markdown.textContent = initData.markdown || '';
                }
                // Try restoring from saved state if present
                const savedState = vscode.getState() || {};

                // Base textarea value from init unless saved has a specific value
                el.textarea.value = (typeof savedState.textareaValue === 'string')
                    ? savedState.textareaValue
                    : (initData.initialValue || '');

                // Hide textarea by default until options logic decides otherwise
                el.textarea.style.display = 'none';
                renderOptions(initData.options || []);

                // Restore selected option/custom if saved
                if (savedState && (savedState.usingCustom === true || typeof savedState.selected === 'string')) {
                    if (savedState.usingCustom) {
                        const custom = el.options.querySelector('#opt_custom');
                        if (custom) {
                            /** @type {HTMLInputElement} */ (custom).checked = true;
                            usingCustom = true;
                            selected = '';
                        }
                    } else if (typeof savedState.selected === 'string' && savedState.selected) {
                        const match = Array.from(el.options.querySelectorAll('input[type=radio]'))
                            .find((n) => /** @type {HTMLInputElement} */ (n).value === savedState.selected);
                        if (match) {
                            /** @type {HTMLInputElement} */ (match).checked = true;
                            usingCustom = false;
                            selected = /** @type {HTMLInputElement} */ (match).value;
                        }
                    }
                }

                updateSubmitState();
                updateTextareaVisibility();

                // Focus management
                focusFirst();

                // Init timer (restore remaining/pause if saved)
                const savedRemaining = typeof savedState.remaining === 'number' ? savedState.remaining : undefined;
                const savedPaused = typeof savedState.paused === 'boolean' ? savedState.paused : undefined;
                remaining = (typeof savedRemaining === 'number' && savedRemaining > 0)
                    ? savedRemaining
                    : ((typeof initData.timeout === 'number' && initData.timeout > 0) ? initData.timeout : 0);
                paused = savedPaused ?? false;

                // Setup pause button initial state
                el.pauseBtn.setAttribute('aria-label', paused ? 'Resume timer' : 'Pause timer');
                el.pauseBtn.setAttribute('title', paused ? 'Resume' : 'Pause');
                setCopyIcon();
                setSaveIcon();
                setPausePlayIcon();
                startTimer();

                // Persist initial state after rendering
                persistState();
                // Intercept clicks on links to send openExternal
                el.markdown.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target && target.tagName === 'A') {
                        e.preventDefault();
                        const href = target.getAttribute('href') || '';
                        if (href) {
                            vscode.postMessage({ type: 'openExternal', url: href });
                        }
                    }
                });
            });

            // Restore state if any; triggers the same init handler
            const saved = vscode.getState();
            if (saved && saved.initData) {
                window.postMessage({ type: 'init', payload: saved.initData }, '*');
            }

            function persistState() {
                try {
                    vscode.setState({
                        initData,
                        selected,
                        usingCustom,
                        textareaValue: el.textarea.value || '',
                        remaining,
                        paused,
                    });
                } catch {}
            }

        </script>
    </body>
</html>`

    // Read timeout from settings and send init payload
    const timeout = vscode.workspace
        .getConfiguration('mcpServer')
        .get<number>('askReportTimeoutSeconds', 60)

    // Return a promise that resolves based on webview messages or panel disposal
    return await new Promise<AskUserResult>((resolve) => {
        let settled = false
        const finalize = (res: AskUserResult) => {
            if (!settled) {
                settled = true
                try { panel.dispose() } catch { /* noop */ }
                resolve(res)
            }
        }

        const disposables: vscode.Disposable[] = []

        // Handle messages from webview
        disposables.push(
            panel.webview.onDidReceiveMessage(async (msg: any) => {
                if (!msg || typeof msg !== 'object') return
                switch (msg.type) {
                    case 'submit': {
                        const value = typeof msg.value === 'string' ? msg.value : ''
                        finalize({ decision: 'Submit', value })
                        return
                    }
                    case 'cancel': {
                        finalize({ decision: 'Cancel', value: '' })
                        return
                    }
                    case 'timeout': {
                        finalize({ decision: 'Cancel', value: '', timeout: true })
                        return
                    }
                    case 'openExternal': {
                        const url = typeof msg.url === 'string' ? msg.url : ''
                        if (url) {
                            try {
                                await vscode.env.openExternal(vscode.Uri.parse(url))
                            } catch {
                                // ignore
                            }
                        }
                        return
                    }
                    case 'copy': {
                        const text = typeof msg.text === 'string' ? msg.text : ''
                        try {
                            await vscode.env.clipboard.writeText(text)
                        } catch {
                            // ignore clipboard errors
                        }
                        return
                    }
                    case 'save': {
                        const text = typeof msg.text === 'string' ? msg.text : ''
                        try {
                            const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: text })
                            await vscode.window.showTextDocument(doc)
                        } catch {
                            // ignore errors silently (no notifications)
                        }
                        return
                    }
                    default:
                        return
                }
            }),
        )

        // Resolve Cancel if panel is closed without decision
        disposables.push(
            panel.onDidDispose(() => {
                if (!settled) {
                    settled = true
                    resolve({ decision: 'Cancel', value: '' })
                }
                disposables.forEach((d) => {
                    try { d.dispose() } catch { /* noop */ }
                })
            }),
        )

        // Send init to the webview
        void panel.webview.postMessage({
            type: 'init',
            payload: {
                markdown: opts.markdown,
                initialValue: opts.initialValue ?? '',
                options: opts.predefinedOptions ?? [],
                timeout,
            },
        })
    })
}

// Utils
function generateNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let text = ''
    for (let i = 0; i < 16; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}
