import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Env } from "./env";
import type { Logger } from "./logger";

export interface RemoteClient {
	client: Client;
	close: () => Promise<void>;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function buildBaseUrl(env: Env): URL {
	// Limit to configured host/port/path only for security
	const url = new globalThis.URL(
		`http://${env.DISCOVERY_HOST}:${env.DISCOVERY_PORT}${env.DISCOVERY_PATH}`
	);
	return url;
}

export async function connectWithReconnects(
	env: Env,
	logger: Logger
): Promise<RemoteClient> {
	const baseUrl = buildBaseUrl(env);
	const maxAttempts = env.PROXY_RETRY_LIMIT;

	let attempt = 0;
	let lastErr: Error | undefined;
	while (attempt <= maxAttempts) {
		try {
			const client = new Client({
				name: "vsc-mcp",
				version: "1.0.0",
			});
			const transport = new SSEClientTransport(baseUrl);
			await client.connect(transport);
			logger.info(`Connected to SSE at ${baseUrl.toString()}`);

			return {
				client,
				close: async () => {
					try {
						await client.close();
					} catch {
						// swallow close errors
					}
				},
			};
		} catch (_e) {
			lastErr = _e as Error;
			if (attempt === maxAttempts) break;
			const backoffMs = Math.min(30_000, 2 ** attempt * 200);
			logger.warn(
				`SSE connect failed (attempt ${attempt + 1}/${maxAttempts + 1}): ${lastErr.message}; retrying in ${backoffMs}ms`
			);
			await delay(backoffMs);
			attempt += 1;
		}
	}

	logger.error(
		`Failed to connect to SSE at ${baseUrl.toString()} after ${maxAttempts + 1} attempts: ${lastErr?.message ?? "unknown error"}`
	);
	throw new Error("SSE connection failed");
}
