import { describe, it, jest } from "@jest/globals";
import { readEnv } from "../src/env";
import { createLogger } from "../src/logger";

// Default mock for SSE transport
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: jest.fn(() => ({})),
}));

describe("connectWithReconnects", () => {
	const logger = createLogger("error");

	it("performs discovery then connects on first try", async () => {
		jest.resetModules();
		// Mock discovery to return fixed port
		jest.doMock("../src/discovery", () => ({
			getSsePort: jest.fn(() => undefined),
			resetSsePort: jest.fn(() => void 0),
			resolveSsePortWithRetry: jest.fn(async () => 61234),
			isNoServerError: jest.fn(() => false),
		}));
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
		const remote = await connectWithReconnects(env, logger, "/ws");
		await remote.close();
	});

	it("on network error resets SSE port and re-discovers", async () => {
		jest.resetModules();
		const connectMock = jest
			.fn<() => Promise<void>>()
			// First connect fails with network error
			.mockRejectedValueOnce(
				Object.assign(new Error("ECONNREFUSED"), {
					code: "ECONNREFUSED",
				})
			)
			// Second connect succeeds
			.mockResolvedValueOnce(undefined);
		jest.doMock("../src/discovery", () => ({
			getSsePort: jest.fn(() => 61234),
			resetSsePort: jest.fn(() => void 0),
			resolveSsePortWithRetry: jest.fn(async () => 61235),
			isNoServerError: jest.fn(
				(e: unknown) => (e as { code?: string }).code === "ECONNREFUSED"
			),
		}));
		jest.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
			Client: jest.fn(() => ({
				connect: connectMock,
				close: jest.fn(() => Promise.resolve()),
			})),
		}));
		const { connectWithReconnects } = await import("../src/remoteClient");

		process.env.DISCOVERY_HOST = "localhost";
		process.env.DISCOVERY_PORT = "60100";
		process.env.DISCOVERY_PATH = "/sse";
		process.env.PROXY_RETRY_LIMIT = "2";

		const env = readEnv();
		const remote = await connectWithReconnects(env, logger, "/ws");
		await remote.close();
	});

	it("does not perform discovery without workspaceFolder; uses DISCOVERY_PORT", async () => {
		jest.resetModules();
		const resolveSpy = jest.fn(async () => {
			throw new Error("resolveSsePortWithRetry should not be called");
		});
		jest.doMock("../src/discovery", () => ({
			getSsePort: jest.fn(() => undefined),
			resetSsePort: jest.fn(() => void 0),
			resolveSsePortWithRetry: resolveSpy,
			isNoServerError: jest.fn(() => false),
		}));
		jest.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
			Client: jest.fn(() => ({
				connect: jest.fn(() => Promise.resolve()),
				close: jest.fn(() => Promise.resolve()),
			})),
		}));
		const { connectWithReconnects } = await import("../src/remoteClient");
		const { SSEClientTransport } = await import(
			"@modelcontextprotocol/sdk/client/sse.js"
		);

		process.env.DISCOVERY_HOST = "localhost";
		process.env.DISCOVERY_PORT = "60100";
		process.env.DISCOVERY_PATH = "/sse";
		process.env.PROXY_RETRY_LIMIT = "1";

		const env = readEnv();
		const remote = await connectWithReconnects(env, logger /* no wf */);
		await remote.close();

		expect(resolveSpy).not.toHaveBeenCalled();
		const firstUrl = (SSEClientTransport as unknown as jest.Mock).mock
			.calls[0][0] as URL;
		expect(firstUrl.toString()).toBe("http://localhost:60100/sse");
	});
});
