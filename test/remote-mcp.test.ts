import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeRemoteMcp } from "../src/config.ts";

describe("sanitizeRemoteMcp", () => {
	it("keeps explicit server → tool lists", () => {
		assert.deepEqual(sanitizeRemoteMcp("acct", { "brave-search": ["web_search"], zread: ["search"] }), {
			"brave-search": ["web_search"],
			zread: ["search"],
		});
	});

	it("drops wildcard tools and servers left without tools", () => {
		assert.deepEqual(sanitizeRemoteMcp("acct", { "brave-search": ["web_search", "*"], zread: [] }), {
			"brave-search": ["web_search"],
		});
		assert.equal(sanitizeRemoteMcp("acct", { "brave-search": ["*"] }), undefined);
	});

	it("drops malformed values", () => {
		assert.equal(sanitizeRemoteMcp("acct", "brave"), undefined);
		assert.equal(sanitizeRemoteMcp("acct", { "*": ["everything"] }), undefined);
		assert.equal(sanitizeRemoteMcp("acct", { zread: "search" }), undefined);
	});

	it("passes undefined through", () => {
		assert.equal(sanitizeRemoteMcp("acct", undefined), undefined);
	});
});
