import { createLogger } from "../src/logger";

describe("logger", () => {
	const originalError = console.error;
	let lines: string[];

	beforeEach(() => {
		lines = [];

		console.error = (msg?: unknown) => {
			lines.push(String(msg));
		};
	});

	afterEach(() => {
		console.error = originalError;
	});

	test("respects levels", () => {
		const log = createLogger("warn");
		log.debug("d");
		log.info("i");
		log.warn("w");
		log.error("e");
		expect(lines.some(l => l.includes("[debug]"))).toBe(false);
		expect(lines.some(l => l.includes("[info]"))).toBe(false);
		expect(lines.some(l => l.includes("[warn] w"))).toBe(true);
		expect(lines.some(l => l.includes("[error] e"))).toBe(true);
	});

	test("level can be changed at runtime", () => {
		const log = createLogger("error");
		log.info("i1");
		expect(lines.length).toBe(0);
		log.level = "debug";
		log.debug("d");
		expect(lines.some(l => l.includes("[debug] d"))).toBe(true);
	});
});
