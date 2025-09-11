import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	getSsePort,
	isNoServerError,
	resetSsePort,
	resolveSsePortWithRetry,
} from "./discovery.js";
import type { Env } from "./env.js";
import { readEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { createProxyServer, type RemoteApi } from "./proxyServer.js";
import { connectWithReconnects } from "./remoteClient.js";

type SignalName = "SIGINT" | "SIGTERM";
// Strictly typed bridge from SDK Client to our RemoteApi expected by proxyServer
function createRemoteApi(
	client: Client,
	env: Env,
	logger: ReturnType<typeof createLogger>
): RemoteApi {
	// Use a very large timeout to effectively disable MCP request timeouts on the proxy side
	// Keep below 2^31-1 to satisfy Node.js timer limits
	const BIG_TIMEOUT_MS = 2_147_483_647; // ~24.8 days
	const NO_TIMEOUT_OPTIONS = {
		timeout: BIG_TIMEOUT_MS,
		// Enable extension-friendly behavior: keep extending on progress just in case
		resetTimeoutOnProgress: true as const,
		// Do not specify maxTotalTimeout to avoid a hard cap
	};
	// Track current connected port; initial connect is to DISCOVERY_PORT unless later reconnected
	let currentPort: number | undefined = env.DISCOVERY_PORT;

	const sseUrl = (port: number) =>
		new URL(`http://${env.DISCOVERY_HOST}:${port}${env.DISCOVERY_PATH}`);

	async function ensureConnectedForWorkspaceFolder(
		wf?: string
	): Promise<void> {
		// Only perform discovery if workspaceFolder is provided and SSE_PORT is not set
		if (wf && getSsePort() === undefined) {
			const port = await resolveSsePortWithRetry(env, logger, wf);
			if (currentPort !== port) {
				try {
					await client.close().catch(() => {});
				} catch {
					/* ignore */
				}
				await client.connect(
					new (
						await import("@modelcontextprotocol/sdk/client/sse.js")
					).SSEClientTransport(sseUrl(port))
				);
				currentPort = port;
			}
		}
	}

	return {
		getServerVersion: () => {
			// Provide dynamic version (YYYY.MM.DD) to force VS Code MCP cache invalidation when proxy restarts
			const now = new Date();
			const version = [
				now.getFullYear(),
				String(now.getMonth() + 1).padStart(2, "0"),
				String(now.getDate()).padStart(2, "0"),
			].join(".");
			return { version };
		},
		ping: async () => {
			const now = () => new Date().toISOString();
			console.error(`[remote] ${now()} proxy->SSE PING (list_tools)`);
			await client.listTools({}, NO_TIMEOUT_OPTIONS);
			console.error(`[remote] ${now()} SSE->proxy PING done`);
			return {};
		},
		// prompts
		listPrompts: async () => {
			const now = () => new Date().toISOString();
			console.error(`[remote] ${now()} proxy->SSE LIST_PROMPTS`);
			const r = await client.listPrompts({}, NO_TIMEOUT_OPTIONS);
			console.error(`[remote] ${now()} SSE->proxy LIST_PROMPTS done`);
			return r;
		},
		getPrompt: (params: unknown) => {
			if (
				typeof params === "object" &&
				params !== null &&
				typeof (params as { name?: unknown }).name === "string"
			) {
				const now = () => new Date().toISOString();
				console.error(
					`[remote] ${now()} proxy->SSE GET_PROMPT name=${(params as { name: string }).name}`
				);
				return client.getPrompt(
					params as {
						name: string;
						arguments?: Record<string, string>;
						_meta?: { progressToken?: string | number };
					},
					NO_TIMEOUT_OPTIONS
				);
			}
			// If params is missing, pass an empty object to satisfy overloads
			const safeParams = (params ?? {}) as never;
			const now = () => new Date().toISOString();
			console.error(`[remote] ${now()} proxy->SSE GET_PROMPT (no-args)`);
			return client.getPrompt(safeParams, NO_TIMEOUT_OPTIONS);
		},
		// resources
		listResources: async (params: unknown) => {
			const now = () => new Date().toISOString();
			console.error(`[remote] ${now()} proxy->SSE LIST_RESOURCES`);
			const r = await client.listResources(
				(params ?? {}) as Record<string, unknown>,
				NO_TIMEOUT_OPTIONS
			);
			console.error(`[remote] ${now()} SSE->proxy LIST_RESOURCES done`);
			return r;
		},
		listResourceTemplates: async (params: unknown) => {
			const now = () => new Date().toISOString();
			console.error(
				`[remote] ${now()} proxy->SSE LIST_RESOURCE_TEMPLATES`
			);
			const r = await client.listResourceTemplates(
				(params ?? {}) as Record<string, unknown>,
				NO_TIMEOUT_OPTIONS
			);
			console.error(
				`[remote] ${now()} SSE->proxy LIST_RESOURCE_TEMPLATES done`
			);
			return r;
		},
		readResource: (params: unknown) => {
			if (
				typeof params === "object" &&
				params !== null &&
				typeof (params as { uri?: unknown }).uri === "string"
			) {
				const now = () => new Date().toISOString();
				console.error(
					`[remote] ${now()} proxy->SSE READ_RESOURCE uri=${(params as { uri: string }).uri}`
				);
				return client.readResource(
					params as {
						uri: string;
						_meta?: { progressToken?: string | number };
					},
					NO_TIMEOUT_OPTIONS
				);
			}
			const now = () => new Date().toISOString();
			console.error(
				`[remote] ${now()} proxy->SSE READ_RESOURCE (no-args)`
			);
			return client.readResource(
				(params ?? {}) as never,
				NO_TIMEOUT_OPTIONS
			);
		},
		subscribeResource: async (_params: unknown) => {
			return {};
		},
		unsubscribeResource: async (_params: unknown) => {
			return {};
		},
		// logging
		setLoggingLevel: async (_level: unknown) => {
			return {};
		},
		// tools
		listTools: async (params: unknown) => {
			const now = () => new Date().toISOString();
			console.error(`[remote] ${now()} proxy->SSE LIST_TOOLS`);
			const r = await client.listTools(
				(params ?? {}) as Record<string, unknown>,
				NO_TIMEOUT_OPTIONS
			);
			console.error(`[remote] ${now()} SSE->proxy LIST_TOOLS done`);
			return r;
		},
		callTool: async (params: unknown) => {
			const now = () => new Date().toISOString();
			const name =
				typeof (params as { name?: unknown } | undefined)?.name ===
				"string"
					? (params as { name: string }).name
					: "<unknown>";
			// Extract workspaceFolder if present in arguments
			const wf = (() => {
				try {
					const a = (
						params as { arguments?: { workspaceFolder?: unknown } }
					)?.arguments?.workspaceFolder;
					return typeof a === "string" && a.length > 0
						? a
						: undefined;
				} catch {
					return undefined;
				}
			})();
			// Ensure discovery/reconnect only when workspaceFolder is available
			await ensureConnectedForWorkspaceFolder(wf);
			console.error(
				`[remote] ${now()} proxy->SSE CALL_TOOL name=${name}`
			);
			if (
				typeof params === "object" &&
				params !== null &&
				typeof (params as { name?: unknown }).name === "string"
			) {
				try {
					const r = await client.callTool(
						params as {
							name: string;
							arguments?: Record<string, unknown>;
							_meta?: { progressToken?: string | number };
						},
						undefined,
						NO_TIMEOUT_OPTIONS
					);
					console.error(
						`[remote] ${now()} SSE->proxy CALL_TOOL done name=${name} isError=${(r as { isError?: boolean }).isError === true}`
					);
					return r;
				} catch (e) {
					// If network error and we have wf, reset and re-discover then retry once
					if (wf && isNoServerError(e)) {
						resetSsePort();
						await ensureConnectedForWorkspaceFolder(wf);
						const r = await client.callTool(
							params as {
								name: string;
								arguments?: Record<string, unknown>;
								_meta?: { progressToken?: string | number };
							},
							undefined,
							NO_TIMEOUT_OPTIONS
						);
						console.error(
							`[remote] ${now()} SSE->proxy CALL_TOOL done name=${name} isError=${(r as { isError?: boolean }).isError === true}`
						);
						return r;
					}
					throw e;
				}
			}
			const r = await client.callTool(
				params as never,
				undefined,
				NO_TIMEOUT_OPTIONS
			);
			console.error(
				`[remote] ${now()} SSE->proxy CALL_TOOL done name=${name} isError=${(r as { isError?: boolean }).isError === true}`
			);
			return r;
		},
		// completion
		complete: (params: unknown) => {
			if (
				typeof params === "object" &&
				params !== null &&
				typeof (
					params as { argument?: { name?: unknown; value?: unknown } }
				).argument?.name === "string" &&
				typeof (
					params as { argument?: { name?: unknown; value?: unknown } }
				).argument?.value === "string"
			) {
				const now = () => new Date().toISOString();
				console.error(
					`[remote] ${now()} proxy->SSE COMPLETE argName=${(params as { argument: { name: string } }).argument.name}`
				);
				return client.complete(
					params as {
						ref:
							| { type: "ref/resource"; uri: string }
							| { type: "ref/prompt"; name: string };
						argument: { name: string; value: string };
						context?: Record<string, unknown>;
						_meta?: { progressToken?: string | number };
					},
					NO_TIMEOUT_OPTIONS
				);
			}
			const now = () => new Date().toISOString();
			console.error(`[remote] ${now()} proxy->SSE COMPLETE (no-args)`);
			return client.complete((params ?? {}) as never, NO_TIMEOUT_OPTIONS);
		},
	};
}

export async function stdioMain(): Promise<void> {
	const env = readEnv();
	const logger = createLogger(env.PROXY_LOG_LEVEL);
	console.error(
		`[boot] ${new Date().toISOString()} proxy starting with DISCOVERY http://${env.DISCOVERY_HOST}:${env.DISCOVERY_PORT}${env.DISCOVERY_PATH}`
	);
	// Best-effort read of version from package.json (works in dev). Fallback to npm env var.
	try {
		let version: string | undefined;
		try {
			const here = dirname(fileURLToPath(import.meta.url));
			const pkgPath = resolve(here, "../package.json");
			const raw = readFileSync(pkgPath, "utf8");
			version = (JSON.parse(raw) as { version?: unknown })?.version as
				| string
				| undefined;
		} catch {
			// ignore fs/JSON errors
		}
		if (!version && typeof process.env.npm_package_version === "string") {
			version = process.env.npm_package_version;
		}
		if (version) {
			console.error(
				`[boot] ${new Date().toISOString()} proxy running version ${version}`
			);
		}
	} catch {
		// ignore outer errors
	}

	// Connect to remote SSE backend with reconnects
	let server: Server | undefined;
	let remoteClose: (() => Promise<void>) | undefined;
	try {
		const { client, close } = await connectWithReconnects(env, logger);
		remoteClose = close;

		const remoteApi = createRemoteApi(client, env, logger);
		server = await createProxyServer(remoteApi);

		// Wire stdio transport
		const transport = new StdioServerTransport();
		console.error(
			`[stdio] ${new Date().toISOString()} stdio transport created`
		);
		await server.connect(transport);
		console.error(
			`[stdio] ${new Date().toISOString()} stdio transport connected`
		);
		logger.info("stdio proxy is running (stdin<->SSE)");
	} catch (e) {
		const msg = (e as Error)?.message ?? String(e);
		// Single-line diagnostic on startup failure (R1/R10)
		logger.error(`startup failed: ${msg}`);
		try {
			await remoteClose?.();
		} catch {
			/* ignore */
		}
		process.exit(1);
	}

	let shuttingDown = false;
	let parentWatch: ReturnType<typeof globalThis.setInterval> | undefined;
	const stopWatchers = () => {
		if (parentWatch) {
			globalThis.clearInterval(parentWatch);
			parentWatch = undefined;
		}
	};

	const graceful = async (
		signal:
			| SignalName
			| "STDIN_EOF"
			| "PARENT_GONE"
			| "SIGPIPE"
			| "UNHANDLED"
	) => {
		if (shuttingDown) return;
		shuttingDown = true;
		stopWatchers();
		createLogger(env.PROXY_LOG_LEVEL).info(
			`received ${signal}, shutting down`
		);
		const forceExit = setTimeout(() => {
			// In case close hangs due to pending timers/sockets
			process.exit(0);
		}, 1500);
		forceExit.unref?.();
		try {
			await server?.close();
		} catch {
			/* ignore */
		}
		try {
			await remoteClose?.();
		} catch {
			/* ignore */
		}
		// Let stdout flush
		setTimeout(() => process.exit(0), 0);
	};

	// Core signals
	process.once("SIGINT", () => void graceful("SIGINT"));
	process.once("SIGTERM", () => void graceful("SIGTERM"));
	process.once("SIGHUP", () => void graceful("SIGTERM"));
	process.once("SIGPIPE", () => void graceful("SIGPIPE"));

	// Exit when IDE closes stdio
	try {
		process.stdin.on("end", () => void graceful("STDIN_EOF"));
		process.stdin.on("close", () => void graceful("STDIN_EOF"));
		process.stdin.on("error", () => void graceful("STDIN_EOF"));
		process.stdout.on("error", (_err: unknown) => {
			// EPIPE/closed stdout – terminate silently
			void graceful("SIGPIPE");
		});
	} catch {
		// ignore
	}

	// Watch parent process (VS Code Extension Host). If it dies, exit.
	const initialParentPid = process.ppid;
	parentWatch = globalThis.setInterval(() => {
		try {
			// If parent exited, this throws (or ppid becomes 1 on Unix)
			process.kill(initialParentPid, 0);
			if (process.ppid === 1) {
				void graceful("PARENT_GONE");
			}
		} catch {
			void graceful("PARENT_GONE");
		}
	}, 2000);
	parentWatch.unref?.();

	// Fail-fast on unhandled errors to avoid half-dead processes
	process.on("unhandledRejection", () => void graceful("UNHANDLED"));
	process.on("uncaughtException", () => void graceful("UNHANDLED"));
}
