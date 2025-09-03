/**
 * Minimal CLI entry for vsc-mcp
 * - Validates Node version (>=18)
 * - Prints a single line to stderr and exits 0 (smoke run) when no IO is wired
 * Code comments in English only.
 */

const requiredMajor = 18;
const nodeVersion = process.versions.node.split(".");
const major = Number(nodeVersion[0] ?? 0);
if (Number.isNaN(major) || major < requiredMajor) {
	process.stderr.write(
		`vsc-mcp requires Node >= ${requiredMajor}, current: ${process.versions.node}\n`
	);
	process.exit(1);
}

process.stderr.write(
	"vsc-mcp: CLI stub is ready (stdio proxy not yet wired)\n"
);

// Keep process alive briefly so smoke tests can spawn/exit predictably
setTimeout(() => {
	process.exit(0);
}, 0);
