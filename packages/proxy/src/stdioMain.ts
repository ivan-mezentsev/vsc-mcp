import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { createProxyServer, type RemoteApi } from "./proxyServer.js";
import { connectWithReconnects } from "./remoteClient.js";

type SignalName = "SIGINT" | "SIGTERM";
// Strictly typed bridge from SDK Client to our RemoteApi expected by proxyServer
function createRemoteApi(client: Client): RemoteApi {
	return {
		getServerVersion: () => {
			return undefined;
		},
		ping: async () => {
			await client.listTools();
			return {};
		},
		// prompts
		listPrompts: () => client.listPrompts(),
		getPrompt: (params: unknown) => {
			if (
				typeof params === "object" &&
				params !== null &&
				typeof (params as { name?: unknown }).name === "string"
			) {
				return client.getPrompt(
					params as {
						name: string;
						arguments?: Record<string, string>;
						_meta?: { progressToken?: string | number };
					}
				);
			}
			return client.getPrompt(params as never);
		},
		// resources
		listResources: (params: unknown) =>
			client.listResources(params as Record<string, unknown>),
		listResourceTemplates: (params: unknown) =>
			client.listResourceTemplates(params as Record<string, unknown>),
		readResource: (params: unknown) => {
			if (
				typeof params === "object" &&
				params !== null &&
				typeof (params as { uri?: unknown }).uri === "string"
			) {
				return client.readResource(
					params as {
						uri: string;
						_meta?: { progressToken?: string | number };
					}
				);
			}
			return client.readResource(params as never);
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
		listTools: (params: unknown) =>
			client.listTools(params as Record<string, unknown>),
		callTool: (params: unknown) => {
			if (
				typeof params === "object" &&
				params !== null &&
				typeof (params as { name?: unknown }).name === "string"
			) {
				return client.callTool(
					params as {
						name: string;
						arguments?: Record<string, unknown>;
						_meta?: { progressToken?: string | number };
					}
				);
			}
			return client.callTool(params as never);
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
				return client.complete(
					params as {
						ref:
							| { type: "ref/resource"; uri: string }
							| { type: "ref/prompt"; name: string };
						argument: { name: string; value: string };
						context?: Record<string, unknown>;
						_meta?: { progressToken?: string | number };
					}
				);
			}
			return client.complete(params as never);
		},
	};
}

export async function stdioMain(): Promise<void> {
	const env = readEnv();
	const logger = createLogger(env.PROXY_LOG_LEVEL);

	// Connect to remote SSE backend with reconnects
	let server: Server | undefined;
	let remoteClose: (() => Promise<void>) | undefined;
	try {
		const { client, close } = await connectWithReconnects(env, logger);
		remoteClose = close;

		const remoteApi = createRemoteApi(client);
		server = await createProxyServer(remoteApi);

		// Wire stdio transport
		const transport = new StdioServerTransport();
		await server.connect(transport);
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

	const graceful = async (signal: SignalName) => {
		createLogger(env.PROXY_LOG_LEVEL).info(
			`received ${signal}, shutting down`
		);
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

	process.once("SIGINT", () => void graceful("SIGINT"));
	process.once("SIGTERM", () => void graceful("SIGTERM"));
}
