import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readAccountRemoteMcp, sanitizeRemoteMcp } from "../src/config.ts";

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

describe("readAccountRemoteMcp", () => {
	it("reads shared/mcp.json and sanitizes it", async () => {
		const sharedDir = await mkdtemp(join(tmpdir(), "pi-chat-mcp-"));
		try {
			await writeFile(join(sharedDir, "mcp.json"), JSON.stringify({ "brave-search": ["web_search", "*"] }));
			assert.deepEqual(readAccountRemoteMcp("acct", sharedDir), { "brave-search": ["web_search"] });
		} finally {
			await rm(sharedDir, { recursive: true, force: true });
		}
	});

	it("returns undefined when the file is missing", () => {
		assert.equal(readAccountRemoteMcp("acct", "/nonexistent"), undefined);
	});

	it("returns undefined with a warning on malformed JSON", async () => {
		const sharedDir = await mkdtemp(join(tmpdir(), "pi-chat-mcp-"));
		try {
			await writeFile(join(sharedDir, "mcp.json"), "{ not json");
			assert.equal(readAccountRemoteMcp("acct", sharedDir), undefined);
		} finally {
			await rm(sharedDir, { recursive: true, force: true });
		}
	});
});
