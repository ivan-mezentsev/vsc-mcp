// new
// Discovery module: resolves SSE_PORT and stores it in-process
// Code comments in English only

import type { Env } from "./env";
import type { Logger } from "./logger";

let SSE_PORT: number | undefined; // empty by default

export function getSsePort(): number | undefined {
	return SSE_PORT;
}

export function resetSsePort(): void {
	SSE_PORT = undefined;
}

export function isNoServerError(err: unknown): boolean {
	const code = (err as { code?: unknown })?.code;
	return (
		code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ECONNRESET"
	);
}

/**
 * Resolve SSE port by polling the discovery endpoint.
 * - GET http://DISCOVERY_HOST:DISCOVERY_PORT/discovery
 * - On 404: wait 5s and retry forever
 * - On 200: expect JSON { port: number }, save and return
 */
export async function resolveSsePortWithRetry(
	env: Env,
	logger: Logger,
	workspaceFolder?: string
): Promise<number> {
	const base = `http://${env.DISCOVERY_HOST}:${env.DISCOVERY_PORT}`;
	const url = new URL(`${env.DISCOVERY_PATH}`, base);
	// Force discovery path explicitly
	url.pathname = "/discovery";
	if (workspaceFolder)
		url.searchParams.set("workspaceFolder", workspaceFolder);

	while (SSE_PORT === undefined) {
		try {
			const res = await globalThis.fetch(url);
			if (res.status === 404) {
				logger.warn("discovery 404; retry in 5s");
			} else if (res.ok) {
				const data = (await res.json()) as { port: unknown };
				if (
					typeof data.port === "number" &&
					data.port > 0 &&
					data.port <= 65535
				) {
					SSE_PORT = data.port;
					logger.info(`discovery success: SSE_PORT=${SSE_PORT}`);
					return SSE_PORT;
				}
				throw new Error("invalid discovery response");
			} else {
				throw new Error(`discovery failed: ${res.status}`);
			}
		} catch (e) {
			logger.warn(
				`discovery error: ${(e as Error).message}; retry in 5s`
			);
		}
		await new Promise(r => setTimeout(r, 5000));
	}

	return SSE_PORT as number;
}
