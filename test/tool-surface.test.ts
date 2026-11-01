import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_TOOLS, CONVERSATION_BOUND_TOOLS, conversationBoundSessionTools } from "../src/core/tool-surface.ts";

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
