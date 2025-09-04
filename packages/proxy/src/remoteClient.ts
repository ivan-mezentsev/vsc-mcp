import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
	getSsePort,
	isNoServerError,
	resetSsePort,
	resolveSsePortWithRetry,
} from "./discovery";
import type { Env } from "./env";
import type { Logger } from "./logger";

export interface RemoteClient {
	client: Client;
	close: () => Promise<void>;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function sseUrl(env: Env, port: number): URL {
	// Limit to configured host/path with resolved SSE port only for security
	return new globalThis.URL(
		`http://${env.DISCOVERY_HOST}:${port}${env.DISCOVERY_PATH}`
	);
}

export async function connectWithReconnects(
	env: Env,
	logger: Logger,
	workspaceFolder?: string
): Promise<RemoteClient> {
	const maxAttempts = env.PROXY_RETRY_LIMIT;

	let attempt = 0;
	let lastErr: Error | undefined;
	// Ensure we have a resolved SSE port before first connect
	let port = getSsePort();
	if (!port) {
		if (workspaceFolder) {
			logger.info(
				"SSE port not set; starting discovery with workspaceFolder"
			);
			port = await resolveSsePortWithRetry(env, logger, workspaceFolder);
		} else {
			// Do NOT perform discovery without workspaceFolder; use DISCOVERY_PORT directly
			port = env.DISCOVERY_PORT;
			logger.debug(
				`SSE port not set and no workspaceFolder; using discovery port ${port} (no SSE_PORT ops)`
			);
		}
	}

	while (attempt <= maxAttempts) {
		const url = sseUrl(env, port);
		try {
			logger.debug(`attempting SSE connect to ${url.toString()}`);
			const client = new Client({
				name: "vsc-mcp",
				version: "1.0.0",
			});
			const transport = new SSEClientTransport(url);
			await client.connect(transport);
			logger.info(`Connected to SSE at ${url.toString()}`);

			return {
				client,
				close: async () => {
					try {
						await client.close();
					} catch {
						// swallow close errors
					}
					logger.info(`Disconnected from SSE at ${url.toString()}`);
				},
			};
		} catch (_e) {
			lastErr = _e as Error;
			// If server is gone, reset port and redo discovery before retrying
			if (isNoServerError(_e)) {
				// Only manipulate SSE_PORT if we actually had performed discovery (i.e., SSE_PORT is set)
				if (getSsePort() !== undefined) {
					logger.warn(
						`SSE connect network error: ${lastErr.message}; resetting SSE_PORT and re-discovering`
					);
					resetSsePort();
					if (workspaceFolder) {
						port = await resolveSsePortWithRetry(
							env,
							logger,
							workspaceFolder
						);
						// Do not increase attempt counter for recoverable re-discovery path
						continue;
					} else {
						// No workspaceFolder available: fall back to DISCOVERY_PORT again without discovery
						port = env.DISCOVERY_PORT;
						// and continue with normal retry/backoff below
					}
				} else {
					// We were using DISCOVERY_PORT fallback without SSE_PORT set; just proceed with backoff
				}
			}

			if (attempt === maxAttempts) break;
			const backoffMs = Math.min(30_000, 2 ** attempt * 200);
			logger.warn(
				`SSE connect failed (attempt ${attempt + 1}/${maxAttempts + 1}): ${lastErr.message}; retrying in ${backoffMs}ms`
			);
			await delay(backoffMs);
			attempt += 1;
		}
	}

	// Use last attempted URL for message
	const finalUrl = sseUrl(env, port);
	logger.error(
		`Failed to connect to SSE at ${finalUrl.toString()} after ${maxAttempts + 1} attempts: ${lastErr?.message ?? "unknown error"}`
	);
	throw new Error("SSE connection failed");
}
