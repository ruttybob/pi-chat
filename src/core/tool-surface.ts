// Direct chat tools: declared to the model only while a conversation is connected.
export const CHAT_TOOLS = ["chat_history", "chat_attach", "chat_workers", "chat_request_secret"];

// Canonical allowed set for conversation-bound sessions (ADR 0001): VM delegates,
// chat tools and codemode. Host tools (bg, subagent, host MCP) are dropped; the
// tool_call hook keeps a defense-in-depth whitelist for remote turns.
export const CONVERSATION_BOUND_TOOLS = ["read", "write", "edit", "bash", ...CHAT_TOOLS, "codemode"];

// pi names MCP server tools `mcp__<server>__<tool>` (everything but [A-Za-z0-9_] becomes
// `_`) and registers resource tools that reach MCP servers too (mirrors pi's isMcpToolName).
const MCP_RESOURCE_TOOLS = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);

export function isMcpToolName(name: string): boolean {
	return name.startsWith("mcp__") || MCP_RESOURCE_TOOLS.has(name);
}

// remoteMcp allowlist (ADR 0001, ticket #3): server name → explicit tool names as the
// server exposes them; wildcards are not supported. Unset or empty means MCP is
// unavailable in conversation-bound sessions.
export type RemoteMcpAllowlist = Record<string, string[]>;

export function mcpToolName(server: string, tool: string): string {
	return `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
}

export function remoteMcpAllowedTools(allowlist: RemoteMcpAllowlist | undefined): Set<string> {
	const allowed = new Set<string>();
	for (const [server, tools] of Object.entries(allowlist ?? {})) {
		for (const tool of tools) allowed.add(mcpToolName(server, tool));
	}
	return allowed;
}

// Single source of truth for the tool surface of conversation-bound sessions: VM delegates,
// chat tools and codemode, plus MCP tools that the account's remoteMcp allowlist admits.
export function conversationBoundSessionTools(knownTools: string[], mcpAllowed?: ReadonlySet<string>): string[] {
	const allowed = mcpAllowed ?? new Set<string>();
	return [
		...CONVERSATION_BOUND_TOOLS.filter((name) => knownTools.includes(name)),
		...knownTools.filter((name) => isMcpToolName(name) && allowed.has(name)),
	];
}
