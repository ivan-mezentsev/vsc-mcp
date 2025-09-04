import { describe, expect, it, jest } from "@jest/globals";
import { readEnv } from "../src/env";
import { createLogger } from "../src/logger";

// Default mock for SSE transport
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: jest.fn(() => ({})),
}));

describe("connectWithReconnects", () => {
	const logger = createLogger("error");

	it("connects on first try", async () => {
		jest.resetModules();
		jest.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
			Client: jest.fn(() => ({
				connect: jest.fn(() => Promise.resolve()),
				close: jest.fn(() => Promise.resolve()),
			})),
		}));
		const { connectWithReconnects } = await import("../src/remoteClient");
		process.env.DISCOVERY_HOST = "localhost";
		process.env.DISCOVERY_PORT = "60100";
		process.env.DISCOVERY_PATH = "/sse";
		process.env.PROXY_RETRY_LIMIT = "1";

		const env = readEnv();
		const remote = await connectWithReconnects(env, logger);
		await remote.close();
	});

	it("retries up to limit then throws", async () => {
		jest.resetModules();
		jest.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
			Client: jest.fn(() => ({
				connect: jest.fn(() => Promise.reject(new Error("boom"))),
				close: jest.fn(() => Promise.resolve()),
			})),
		}));
		const { connectWithReconnects } = await import("../src/remoteClient");

		process.env.DISCOVERY_HOST = "localhost";
		process.env.DISCOVERY_PORT = "60100";
		process.env.DISCOVERY_PATH = "/sse";
		process.env.PROXY_RETRY_LIMIT = "2"; // total 3 attempts

		const env = readEnv();

		await expect(connectWithReconnects(env, logger)).rejects.toThrow(
			/SSE connection failed/
		);
	});
});
