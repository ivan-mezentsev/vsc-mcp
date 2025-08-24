import * as assert from 'assert'
import * as vscode from 'vscode'
import { askReport, AskUserResult } from '../../tools/ask_report'

suite.skip('Ask Report Manual/Timeout Demo Test', function () {
    // Allow up to 40s for manual answer or 30s timeout + margin
    this.timeout(40000)

    let originalTimeout: number | undefined

    suiteSetup(async () => {
        // Save and set the ask-report timeout to 30 seconds for this demo test
        const cfg = vscode.workspace.getConfiguration('mcpServer')
        originalTimeout = cfg.get<number>('askReportTimeoutSeconds')
        await cfg.update('askReportTimeoutSeconds', 30, vscode.ConfigurationTarget.Global)
    })

    suiteTeardown(async () => {
        // Restore original value
        const cfg = vscode.workspace.getConfiguration('mcpServer')
        await cfg.update('askReportTimeoutSeconds', originalTimeout ?? 600, vscode.ConfigurationTarget.Global)
    })

    test('Gives 30s for manual response or auto-timeout', async () => {
        // Show a simple ask-report dialog. Tester can pick an option or wait for timeout.
        const promise = askReport({
            title: 'Ask Report — 30s Demo',
            markdown: '# Manual demo\n\nPick an option or wait for the 30s timer to expire.',
            predefinedOptions: ['Yes', 'No'],
        })

        // Await user interaction or timeout resolution
        const result: AskUserResult = await promise

        // Accept either a manual Submit or an auto-timeout Cancel
        const isSubmit = result.decision === 'Submit'
        const isTimeoutCancel = result.decision === 'Cancel' && result.timeout === true

        assert.ok(
            isSubmit || isTimeoutCancel,
            `Expected Submit or Cancel with timeout, got ${JSON.stringify(result)}`,
        )

        if (isSubmit) {
            // When submitted, ensure a non-empty value for predefined option path
            assert.ok(result.value.length > 0, 'Submit should carry a non-empty value')
        }
    })
})
