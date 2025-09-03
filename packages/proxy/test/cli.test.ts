/** Smoke test for CLI start without wiring (TypeScript + Jest) */
// existing
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

describe("vsc-mcp CLI", () => {
	test("binary builds and runs with exit code 0", done => {
		const pkgRoot = path.resolve(__dirname, "..");
		const distBin = path.join(pkgRoot, "dist", "bin.js");

		if (!fs.existsSync(distBin)) {
			return done.fail(
				"dist/bin.js is missing; run `npm run build` in packages/proxy before tests"
			);
		}

		const child = spawn("node", [distBin], {
			env: { ...process.env },
		});

		let stderr = "";
		child.stderr.on("data", d => {
			stderr += String(d);
		});

		child.on("close", code => {
			expect(code).toBe(0);
			expect(stderr).toContain("vsc-mcp: CLI stub is ready");
			done();
		});
	});
});
