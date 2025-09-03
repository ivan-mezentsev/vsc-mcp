import { z } from "zod";

// Define supported log levels
export const logLevels = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof logLevels)[number];

// Zod schema for environment
const EnvSchema = z.object({
	ROUTER_HOST: z.string().min(1).default("localhost"),
	ROUTER_PORT: z.coerce.number().int().min(1).max(65535).default(60100),
	ROUTER_PATH: z.string().startsWith("/").default("/sse"),
	PROXY_RETRY_LIMIT: z.coerce.number().int().min(0).default(5),
	PROXY_LOG_LEVEL: z.enum(logLevels).default("info"),
});

export type Env = z.infer<typeof EnvSchema> & {
	ROUTER_PORT: number;
	PROXY_RETRY_LIMIT: number;
};

/**
 * Parse process.env into a typed Env with defaults.
 */
export function readEnv(
	getEnv: () => typeof process.env = () => process.env
): Env {
	// Copy only known keys to avoid accidental pollution
	const raw = getEnv();
	const input: Record<string, unknown> = {
		ROUTER_HOST: raw.ROUTER_HOST,
		ROUTER_PORT: raw.ROUTER_PORT,
		ROUTER_PATH: raw.ROUTER_PATH,
		PROXY_RETRY_LIMIT: raw.PROXY_RETRY_LIMIT,
		PROXY_LOG_LEVEL: raw.PROXY_LOG_LEVEL,
	};

	const parsed = EnvSchema.safeParse(input);
	if (!parsed.success) {
		// Compose first error message; do not throw untyped
		const issue = parsed.error.issues[0];
		const path = issue?.path?.join(".") || "<root>";
		throw new Error(`ENV invalid at ${path}: ${issue.message}`);
	}
	return parsed.data as Env;
}

/** Build full SSE URL path from parts (no scheme/host). */
export function buildSsePath(env: Env): string {
	// Ensure single leading slash and no trailing slash for path
	const path = env.ROUTER_PATH.startsWith("/")
		? env.ROUTER_PATH
		: `/${env.ROUTER_PATH}`;
	return path;
}
