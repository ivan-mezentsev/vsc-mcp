// new
// Unit tests for discovery.ts

import {
	getSsePort,
	isNoServerError,
	resetSsePort,
	resolveSsePortWithRetry,
} from "../src/discovery";
import type { Env } from "../src/env";
import { createLogger } from "../src/logger";

const logger = createLogger("debug");

function mockEnv(): Env {
	return {
		DISCOVERY_HOST: "localhost",
		DISCOVERY_PORT: 60100,
		DISCOVERY_PATH: "/sse",
		PROXY_LOG_LEVEL: "debug",
		PROXY_RETRY_LIMIT: 3,
	};
}

describe("discovery module", () => {
	beforeAll(() => {
		jest.setTimeout(20000);
	});
	beforeEach(() => {
		resetSsePort();
		jest.useFakeTimers();
		// No explicit spy on setTimeout needed
	});
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	test("isNoServerError detects ENOTFOUND/ECONNREFUSED/ECONNRESET", () => {
		expect(isNoServerError({ code: "ENOTFOUND" })).toBe(true);
		expect(isNoServerError({ code: "ECONNREFUSED" })).toBe(true);
		expect(isNoServerError({ code: "ECONNRESET" })).toBe(true);
		expect(isNoServerError({ code: "ETIMEDOUT" })).toBe(false);
		expect(isNoServerError({})).toBe(false);
	});

	test("resolveSsePortWithRetry parses successful port from JSON", async () => {
		const env = mockEnv();
		type ResOk = { ok: true; status: number; json: () => Promise<unknown> };
		type FetchLike = (input?: unknown, init?: unknown) => Promise<ResOk>;
		const g = globalThis as unknown as { fetch: FetchLike };
		const mockFetch = jest.spyOn(g, "fetch").mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ port: 60200 }),
		});

		const p = resolveSsePortWithRetry(env, logger, "/ws");
		await Promise.resolve();
		jest.runOnlyPendingTimers();
		const port = await p;

		expect(port).toBe(60200);
		expect(getSsePort()).toBe(60200);
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	test("resolveSsePortWithRetry retries forever on 404 with 5s intervals (simulate 2x 404 then 200)", async () => {
		const env = mockEnv();
		const calls: Array<number> = [];
		type Res404 = { ok: false; status: 404 };
		type ResOk = { ok: true; status: number; json: () => Promise<unknown> };
		type Res = Res404 | ResOk;
		type FetchLike = (input?: unknown, init?: unknown) => Promise<Res>;
		const g = globalThis as unknown as { fetch: FetchLike };
		const mockFetch = jest
			.spyOn(g, "fetch")
			.mockImplementation(async () => {
				calls.push(Date.now());
				if (calls.length <= 2) {
					const r: Res404 = { ok: false, status: 404 };
					return r;
				}
				const r: ResOk = {
					ok: true,
					status: 200,
					json: async () => ({ port: 60300 }),
				};
				return r;
			});

		const promise = resolveSsePortWithRetry(env, logger);

		// 1st 404 -> wait 5s
		await jest.advanceTimersByTimeAsync(5000);
		// 2nd 404 -> wait 5s
		await jest.advanceTimersByTimeAsync(5000);
		// then success
		const port = await promise;

		expect(port).toBe(60300);
		expect(getSsePort()).toBe(60300);
		expect(mockFetch).toHaveBeenCalledTimes(3);
	});
});
