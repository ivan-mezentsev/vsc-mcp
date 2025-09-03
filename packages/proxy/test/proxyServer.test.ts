function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
	if (typeof msg !== "object" || msg === null) return false;
	const obj = msg as Record<string, unknown>;
	if (obj["jsonrpc"] !== "2.0") return false;
	if (!("id" in obj)) return false;
	if (!("result" in obj) && !("error" in obj)) return false;
	return true;
}

function hasToolsResult(
	result: unknown
): result is { tools: Array<{ name: string }> } {
	if (typeof result !== "object" || result === null) return false;
	const r = result as { tools?: unknown };
	if (!Array.isArray(r.tools)) return false;
	const first = r.tools[0] as unknown;
	return (
		!first ||
		(typeof first === "object" && first !== null && "name" in first)
	);
}

function isToolErrorResult(
	result: unknown
): result is { isError: boolean; content?: Array<{ text?: string }> } {
	if (typeof result !== "object" || result === null) return false;
	const r = result as { isError?: unknown };
	return typeof r.isError === "boolean";
}
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ServerResult } from "@modelcontextprotocol/sdk/types.js";
import { createProxyServer, type RemoteApi } from "../src/proxyServer";

function makeMockClient(): jest.Mocked<RemoteApi> {
	return {
		getServerVersion: jest.fn(() => ({ name: "remote", version: "1.0.0" })),
		ping: jest.fn(async () => ({})),
		// prompts
		listPrompts: jest.fn(async () => ({ prompts: [] }) as ServerResult),
		getPrompt: jest.fn(async () => ({ messages: [] }) as ServerResult),
		// resources
		listResources: jest.fn(async () => ({ resources: [] }) as ServerResult),
		listResourceTemplates: jest.fn(
			async () => ({ templates: [] }) as ServerResult
		),
		readResource: jest.fn(async () => ({ contents: [] }) as ServerResult),
		subscribeResource: jest.fn(async () => ({})),
		unsubscribeResource: jest.fn(async () => ({})),
		// logging
		setLoggingLevel: jest.fn(async () => ({})),
		// tools
		listTools: jest.fn(async () => ({ tools: [] }) as ServerResult),
		callTool: jest.fn(
			async () =>
				({ content: [{ type: "text", text: "ok" }] }) as ServerResult
		),
		// completion
		complete: jest.fn(
			async () => ({ completion: { values: [] } }) as ServerResult
		),
	} as jest.Mocked<RemoteApi>;
}

async function pairServerWithProxy(server: Server) {
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	return b; // return the client-side transport
}

type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: unknown;
};

describe("proxyServer", () => {
	let mockClient: jest.Mocked<RemoteApi>;

	beforeEach(() => {
		mockClient = makeMockClient();
	});

	it("list_tools happy path", async () => {
		mockClient.listTools.mockResolvedValueOnce({
			tools: [{ name: "t" }],
		} as ServerResult);
		const proxy = await createProxyServer(mockClient);
		const clientTransport = await pairServerWithProxy(proxy);

		// Send tools/list request via transport-level request API
		const req = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
			params: {},
		} as const;

		// InMemoryTransport does not provide direct request helper; simulate via Protocol wire
		// We'll expect that server responded by enqueuing a response with same id.
		// To capture, we attach onmessage to the client-side transport.
		const responses: JsonRpcResponse[] = [];
		clientTransport.onmessage = (msg: unknown) => {
			if (isJsonRpcResponse(msg)) {
				responses.push(msg);
			}
		};

		await clientTransport.send(req);

		// Allow event loop to process
		await new Promise(r => setTimeout(r, 0));

		expect(responses.length).toBe(1);
		expect(responses[0].id).toBe(1);
		expect("result" in responses[0]).toBe(true);
		expect(hasToolsResult(responses[0].result)).toBe(true);
		if (hasToolsResult(responses[0].result)) {
			expect(responses[0].result.tools[0].name).toBe("t");
		}
	});

	it("call_tool error is converted to isError result", async () => {
		mockClient.callTool.mockRejectedValueOnce(new Error("boom"));
		const proxy = await createProxyServer(mockClient);
		const clientTransport = await pairServerWithProxy(proxy);

		const req = {
			jsonrpc: "2.0",
			id: 42,
			method: "tools/call",
			params: { name: "x", arguments: {} },
		} as const;

		const responses: JsonRpcResponse[] = [];
		clientTransport.onmessage = (msg: unknown) => {
			if (isJsonRpcResponse(msg)) {
				responses.push(msg);
			}
		};

		await clientTransport.send(req);
		await new Promise(r => setTimeout(r, 0));

		expect(responses.length).toBe(1);
		const res = responses[0];
		expect(res.id).toBe(42);
		expect("result" in res).toBe(true);
		expect(isToolErrorResult(res.result)).toBe(true);
		if (isToolErrorResult(res.result)) {
			expect(res.result.isError).toBe(true);
			expect(res.result.content?.[0]?.text).toContain("boom");
		}
	});

	it("call_tool happy path", async () => {
		mockClient.callTool.mockResolvedValueOnce({
			content: [{ type: "text", text: "worked" }],
		} as ServerResult);
		const proxy = await createProxyServer(mockClient);
		const clientTransport = await pairServerWithProxy(proxy);

		const req = {
			jsonrpc: "2.0" as const,
			id: 7,
			method: "tools/call",
			params: { name: "x", arguments: {} },
		};

		const responses: JsonRpcResponse[] = [];
		clientTransport.onmessage = (msg: unknown) => {
			if (isJsonRpcResponse(msg)) {
				responses.push(msg);
			}
		};

		await clientTransport.send(req);
		await new Promise(r => setTimeout(r, 0));

		expect(responses.length).toBe(1);
		const res = responses[0];
		expect(res.id).toBe(7);
		expect("result" in res).toBe(true);
		// narrow to content array shape
		const result = res.result as { content?: Array<{ text?: string }> };
		expect(result.content?.[0]?.text).toBe("worked");
	});
});
