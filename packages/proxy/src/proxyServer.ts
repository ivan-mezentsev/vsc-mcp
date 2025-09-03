// Create a proxy MCP Server that delegates handlers to a remote client API
// Code comments in English only
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	CompatibilityCallToolResultSchema,
	CompleteRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListToolsRequestSchema,
	ProgressNotificationSchema,
	ReadResourceRequestSchema,
	SetLevelRequestSchema,
	SubscribeRequestSchema,
	UnsubscribeRequestSchema,
	type ServerResult,
} from "@modelcontextprotocol/sdk/types.js";

// Minimal interface required from a remote MCP client used by the proxy
export interface RemoteApi {
	// session/server
	getServerVersion(): { name?: string; version?: string } | undefined;
	ping(): Promise<Record<string, unknown>>;
	// prompts
	listPrompts(): Promise<ServerResult>;
	getPrompt(params: unknown): Promise<ServerResult>;
	// resources
	listResources(params: unknown): Promise<ServerResult>;
	listResourceTemplates(params: unknown): Promise<ServerResult>;
	readResource(params: unknown): Promise<ServerResult>;
	subscribeResource(params: unknown): Promise<Record<string, unknown>>;
	unsubscribeResource(params: unknown): Promise<Record<string, unknown>>;
	// logging
	setLoggingLevel(level: unknown): Promise<Record<string, unknown>>;
	// tools
	listTools(params: unknown): Promise<ServerResult>;
	callTool(params: unknown, validator?: unknown): Promise<ServerResult>;
	// completion
	complete(params: unknown): Promise<ServerResult>;
}

export async function createProxyServer(remote: RemoteApi): Promise<Server> {
	// Initialize against remote to discover capabilities and server info
	const init = await remote.ping();
	void init; // silence unused; ping validates connectivity

	const remoteInfo = remote.getServerVersion();
	const name = remoteInfo?.name ?? "vsc-mcp-remote";
	const version = remoteInfo?.version ?? "0.0.0";

	const server = new Server(
		{ name, version },
		{ capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} } }
	);

	// Prompts
	server.setRequestHandler(ListPromptsRequestSchema, async () => {
		const result = await remote.listPrompts();
		return result as ServerResult; // validated by remote SDK
	});
	server.setRequestHandler(GetPromptRequestSchema, async req => {
		const result = await remote.getPrompt(req.params);
		return result as ServerResult;
	});

	// Resources
	server.setRequestHandler(ListResourcesRequestSchema, async req => {
		const result = await remote.listResources(req.params);
		return result as ServerResult;
	});
	server.setRequestHandler(ListResourceTemplatesRequestSchema, async req => {
		const result = await remote.listResourceTemplates(req.params);
		return result as ServerResult;
	});
	server.setRequestHandler(ReadResourceRequestSchema, async req => {
		const result = await remote.readResource(req.params);
		return result as ServerResult;
	});
	server.setRequestHandler(SubscribeRequestSchema, async req => {
		await remote.subscribeResource(req.params);
		return {} as ServerResult;
	});
	server.setRequestHandler(UnsubscribeRequestSchema, async req => {
		await remote.unsubscribeResource(req.params);
		return {} as ServerResult;
	});

	// Logging
	server.setRequestHandler(SetLevelRequestSchema, async req => {
		await remote.setLoggingLevel(req.params.level);
		return {} as ServerResult;
	});

	// Tools
	server.setRequestHandler(ListToolsRequestSchema, async req => {
		const result = await remote.listTools(req.params);
		return result as ServerResult;
	});
	server.setRequestHandler(CallToolRequestSchema, async req => {
		try {
			const result = await remote.callTool(
				req.params,
				CompatibilityCallToolResultSchema
			);
			return result as ServerResult;
		} catch (e) {
			// Convert tool-side exception to tool error result per Python reference
			const message = (e as Error).message;
			return {
				content: [{ type: "text", text: message }],
				isError: true,
			} as ServerResult;
		}
	});

	// Progress passthrough (server -> remote)
	server.setNotificationHandler(ProgressNotificationSchema, async _n => {
		// Forward as-is by sending a related notification through remote client
		// Using createMessage APIs isn't needed; clients do not expose direct notify.
		// Instead, send as a request with no result (SDK doesn't support), so ignore.
		// No-op to keep protocol compatibility; progress primarily flows remote->client.
	});

	// Completion
	server.setRequestHandler(CompleteRequestSchema, async req => {
		const result = await remote.complete(req.params);
		return result as ServerResult;
	});

	return server;
}
