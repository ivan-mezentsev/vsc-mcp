/**
 * CLI entry for vsc-mcp stdio proxy
 * - Validates Node version (>=18)
 * - Starts stdio <-> SSE proxy
 * Code comments in English only.
 */
import { stdioMain } from "./stdioMain.js";

const requiredMajor = 18;
const nodeVersion = process.versions.node.split(".");
const major = Number(nodeVersion[0] ?? 0);
if (Number.isNaN(major) || major < requiredMajor) {
	process.stderr.write(
		`vsc-mcp requires Node >= ${requiredMajor}, current: ${process.versions.node}\n`
	);
	process.exit(1);
}

void stdioMain();
