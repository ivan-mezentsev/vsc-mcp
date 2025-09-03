import { buildSsePath, readEnv } from "../src/env";

describe("env", () => {
	test("defaults apply when no env set", () => {
		const env = readEnv(() => ({}));
		expect(env.ROUTER_HOST).toBe("localhost");
		expect(env.ROUTER_PORT).toBe(60100);
		expect(env.ROUTER_PATH).toBe("/sse");
		expect(env.PROXY_RETRY_LIMIT).toBe(5);
		expect(env.PROXY_LOG_LEVEL).toBe("info");
		expect(buildSsePath(env)).toBe("/sse");
	});

	test("reads and validates numeric envs", () => {
		const env = readEnv(() => ({
			ROUTER_HOST: "127.0.0.1",
			ROUTER_PORT: "7000",
			ROUTER_PATH: "/stream",
			PROXY_RETRY_LIMIT: "9",
			PROXY_LOG_LEVEL: "debug",
		}));
		expect(env.ROUTER_HOST).toBe("127.0.0.1");
		expect(env.ROUTER_PORT).toBe(7000);
		expect(env.ROUTER_PATH).toBe("/stream");
		expect(env.PROXY_RETRY_LIMIT).toBe(9);
		expect(env.PROXY_LOG_LEVEL).toBe("debug");
	});

	test("invalid values throw with clear message", () => {
		expect(() => readEnv(() => ({ ROUTER_PORT: "not-a-number" }))).toThrow(
			/ENV invalid/
		);
		expect(() =>
			readEnv(
				() => ({ PROXY_LOG_LEVEL: "verbose" }) as Record<string, string>
			)
		).toThrow(/ENV invalid/);
	});
});
