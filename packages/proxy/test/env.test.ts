import { buildSsePath, readEnv } from "../src/env";

describe("env", () => {
	test("defaults apply when no env set", () => {
		const env = readEnv(() => ({}));
		expect(env.DISCOVERY_HOST).toBe("localhost");
		expect(env.DISCOVERY_PORT).toBe(60100);
		expect(env.DISCOVERY_PATH).toBe("/sse");
		expect(env.PROXY_RETRY_LIMIT).toBe(5);
		expect(env.PROXY_LOG_LEVEL).toBe("info");
		expect(buildSsePath(env)).toBe("/sse");
	});

	test("reads and validates numeric envs", () => {
		const env = readEnv(() => ({
			DISCOVERY_HOST: "127.0.0.1",
			DISCOVERY_PORT: "7000",
			DISCOVERY_PATH: "/stream",
			PROXY_RETRY_LIMIT: "9",
			PROXY_LOG_LEVEL: "debug",
		}));
		expect(env.DISCOVERY_HOST).toBe("127.0.0.1");
		expect(env.DISCOVERY_PORT).toBe(7000);
		expect(env.DISCOVERY_PATH).toBe("/stream");
		expect(env.PROXY_RETRY_LIMIT).toBe(9);
		expect(env.PROXY_LOG_LEVEL).toBe("debug");
	});

	test("invalid values throw with clear message", () => {
		expect(() =>
			readEnv(() => ({ DISCOVERY_PORT: "not-a-number" }))
		).toThrow(/ENV invalid/);
		expect(() =>
			readEnv(
				() => ({ PROXY_LOG_LEVEL: "verbose" }) as Record<string, string>
			)
		).toThrow(/ENV invalid/);
	});
});
