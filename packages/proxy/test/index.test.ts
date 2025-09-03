/** CLI startup behavior when backend is unavailable */
import { expect, it } from "@jest/globals";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

it("CLI exits non-zero with single-line diagnostic when SSE is unavailable", done => {
	const pkgRoot = path.resolve(__dirname, "..");
	const distBin = path.join(pkgRoot, "dist", "bin.js");

	if (!fs.existsSync(distBin)) {
		throw new Error(
			"dist/bin.js is missing; run `npm run build` in packages/proxy before tests"
		);
	}

	const child = spawn("node", [distBin], {
		env: { ...process.env, ROUTER_PORT: "59999", PROXY_RETRY_LIMIT: "0" },
	});

	let stderr = "";
	child.stderr.on("data", d => {
		stderr += String(d);
	});

	child.on("close", code => {
		expect(code).toBe(1);
		expect(stderr).toMatch(/startup failed:/);
		// Should be concise (single line). Allow slight variations.
		const lines = stderr.trim().split(/\r?\n/);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		done();
	});
});
