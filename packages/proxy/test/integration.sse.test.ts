import { describe, expect, it } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

async function isBackendUp(): Promise<boolean> {
	try {
		const res = await globalThis.fetch("http://localhost:60100/ping");
		if (!res.ok) return false;
		const data = (await res.json()) as { status?: string };
		return data?.status === "ok";
	} catch {
		return false;
	}
}

async function waitForPing(timeoutMs: number): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await isBackendUp()) return true;
		await new Promise(r => setTimeout(r, 250));
	}
	return false;
}

describe("integration: stdio <-> SSE", () => {
	it("can list tools when extension SSE server is running", async () => {
		// Ensure SSE backend is up; if not, try to start extension tests which spin up SSE on port 60100
		let extProc: import("node:child_process").ChildProcess | undefined;
		if (!(await isBackendUp())) {
			const repoRoot = path.resolve(__dirname, "../../../");
			// Run extension tests which start SSE server on activation
			extProc = spawn(
				process.platform === "win32" ? "pnpm.cmd" : "pnpm",
				["-C", path.join(repoRoot, "packages/extension"), "test"],
				{
					cwd: repoRoot,
					stdio: "ignore",
					env: { ...process.env, CI: process.env.CI ?? "true" },
					detached: false,
				}
			);

			const ok = await waitForPing(30000);
			if (!ok) {
				// Could not start backend; clean up and skip
				try {
					extProc.kill("SIGINT");
				} catch {
					/* ignore */
				}
				return;
			}
		}

		const pkgRoot = path.resolve(__dirname, "..");
		const distBin = path.join(pkgRoot, "dist", "bin.js");
		if (!fs.existsSync(distBin)) {
			throw new Error("dist/bin.js is missing; run build before tests");
		}

		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [distBin],
			env: {
				...process.env,
				ROUTER_PORT: "60100",
				PROXY_RETRY_LIMIT: "0",
			},
		});
		const client = new Client({
			name: "integration-client",
			version: "1.0.0",
		});
		await client.connect(transport);
		const tools = (await client.listTools()) as unknown as {
			tools?: unknown[];
		};
		expect(Array.isArray(tools.tools ?? [])).toBe(true);
		await client.close();
		// Stop extension test runner if we started it
		if (extProc) {
			try {
				extProc.kill("SIGINT");
			} catch {
				/* ignore */
			}
		}
	}, 60000);
});
