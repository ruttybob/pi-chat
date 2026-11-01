// Direct chat tools: declared to the model only while a conversation is connected.
export const CHAT_TOOLS = ["chat_history", "chat_attach", "chat_workers", "chat_request_secret"];

// Canonical allowed set for conversation-bound sessions (ADR 0001): VM delegates,
// chat tools and codemode. Host tools (bg, subagent, host MCP) are dropped; the
// tool_call hook keeps a defense-in-depth whitelist for remote turns.
export const CONVERSATION_BOUND_TOOLS = ["read", "write", "edit", "bash", ...CHAT_TOOLS, "codemode"];

// Single source of truth for the tool surface of conversation-bound sessions.
// Ticket #3 (remoteMcp) extends this with an MCP allowlist parameter.
export function conversationBoundSessionTools(knownTools: string[]): string[] {
	return CONVERSATION_BOUND_TOOLS.filter((name) => knownTools.includes(name));
}
