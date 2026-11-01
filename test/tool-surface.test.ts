import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHAT_TOOLS,
	CONVERSATION_BOUND_TOOLS,
	conversationBoundSessionTools,
	isMcpToolName,
	mcpToolName,
	REMOTE_TURN_TOOLS,
	remoteMcpAllowedTools,
	restoreUnconnectedTools,
} from "../src/core/tool-surface.ts";

// A realistic universe of tool names a pi session can have active: VM delegates reach
// the conversation through this extension, the rest are host tools (ADR 0001).
const FULL_SESSION = [
	"read",
	"write",
	"edit",
	"bash",
	"bg",
	"subagent",
	"codemode",
	"mcp__brave_search__web_search",
	"mcp__zread__search",
	...CHAT_TOOLS,
];

describe("REMOTE_TURN_TOOLS", () => {
	it("is the conversation-bound surface minus chat_workers, exactly what the hook allows", () => {
		assert.deepEqual(
			REMOTE_TURN_TOOLS,
			CONVERSATION_BOUND_TOOLS.filter((name) => name !== "chat_workers"),
		);
		assert.deepEqual(
			[...REMOTE_TURN_TOOLS].sort(),
			["bash", "chat_attach", "chat_history", "chat_request_secret", "codemode", "edit", "read", "write"].sort(),
		);
	});
});

describe("restoreUnconnectedTools", () => {
	it("keeps pre-connect tools and mid-session enablements, drops chat tools", () => {
		const snapshot = ["read", "write", "edit", "bash", "bg"];
		const current = [...CONVERSATION_BOUND_TOOLS, "mcp__brave_search__web_search", "bg", "subagent"];
		// codemode stays too: it is an ordinary session tool once disconnected (as are the
		// file tools, which fall back to local implementations).
		assert.deepEqual(restoreUnconnectedTools(snapshot, current), [
			"read",
			"write",
			"edit",
			"bash",
			"bg",
			"codemode",
			"mcp__brave_search__web_search",
			"subagent",
		]);
	});

	it("falls back to the current set when no snapshot exists", () => {
		assert.deepEqual(restoreUnconnectedTools([], ["read", ...CHAT_TOOLS, "subagent"]), ["read", "subagent"]);
	});
});

describe("conversationBoundSessionTools", () => {
	it("keeps only VM delegates, chat tools and codemode, in canonical order", () => {
		assert.deepEqual(conversationBoundSessionTools(FULL_SESSION), [...CONVERSATION_BOUND_TOOLS]);
	});

	it("drops host tools even when they are the only ones present", () => {
		assert.deepEqual(conversationBoundSessionTools(["bg", "subagent", "mcp__brave_search__web_search"]), []);
	});

	it("omits allowed tools that do not exist in the session", () => {
		assert.deepEqual(conversationBoundSessionTools(["read", "codemode"]), ["read", "codemode"]);
		assert.equal(conversationBoundSessionTools([]).length, 0);
	});
});

describe("isMcpToolName", () => {
	it("recognizes pi's MCP server tools and resource tools", () => {
		assert.equal(isMcpToolName("mcp__brave_search__web_search"), true);
		assert.equal(isMcpToolName("list_mcp_resources"), true);
		assert.equal(isMcpToolName("read_mcp_resource"), true);
		assert.equal(isMcpToolName("bash"), false);
		assert.equal(isMcpToolName("chat_history"), false);
	});
});

describe("remoteMcpAllowedTools", () => {
	it("expands server → tools entries to pi tool names, sanitizing dashes", () => {
		assert.deepEqual(
			[...remoteMcpAllowedTools({ "brave-search": ["web_search"], zread: ["search_docs"] })].sort(),
			["mcp__brave_search__web_search", "mcp__zread__search_docs"].sort(),
		);
	});

	it("sanitizes the whole mcp__server__tool name like pi does", () => {
		assert.equal(mcpToolName("dev-radius", "get user"), "mcp__dev_radius__get_user");
	});

	it("is empty when unset or empty — deny by default", () => {
		assert.equal(remoteMcpAllowedTools(undefined).size, 0);
		assert.equal(remoteMcpAllowedTools({}).size, 0);
	});
});

describe("conversationBoundSessionTools with remote MCP allowlist", () => {
	it("adds allowlisted MCP tools that exist in the session", () => {
		const allowed = remoteMcpAllowedTools({ "brave-search": ["web_search"] });
		assert.deepEqual(conversationBoundSessionTools(FULL_SESSION, allowed), [
			...CONVERSATION_BOUND_TOOLS,
			"mcp__brave_search__web_search",
		]);
	});

	it("denies every MCP tool without an allowlist", () => {
		assert.deepEqual(conversationBoundSessionTools(FULL_SESSION), [...CONVERSATION_BOUND_TOOLS]);
		assert.deepEqual(conversationBoundSessionTools(FULL_SESSION, remoteMcpAllowedTools({})), [
			...CONVERSATION_BOUND_TOOLS,
		]);
	});

	it("omits allowlisted MCP tools missing from the session", () => {
		const allowed = remoteMcpAllowedTools({ zread: ["search", "fetch_readme"] });
		assert.deepEqual(conversationBoundSessionTools(FULL_SESSION, allowed), [
			...CONVERSATION_BOUND_TOOLS,
			"mcp__zread__search",
		]);
	});
});
