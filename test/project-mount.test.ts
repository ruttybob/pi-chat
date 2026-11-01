import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collapseMountsReminders,
	deriveWorktreeSlug,
	ensureWorktree,
	formatMountsReminder,
	type GondolinMountConfig,
	mountsSignature,
	projectMountGuestPath,
	removeProjectMount,
	upsertProjectMount,
} from "../src/project-mount.ts";

test("guest paths are /workspace/<slug> and distinct per project (ADR 0002)", () => {
	// A git repo mounts under its repo-root slug — the same slug whether mounted ro or rw.
	const repo = projectMountGuestPath("/Users/me/My App", "/Users/me/My App");
	assert.equal(repo, `/workspace/${deriveWorktreeSlug("/Users/me/My App", "/Users/me/My App")}`);
	assert.match(repo, /^\/workspace\/[a-z0-9][a-z0-9-]*$/);
	// Non-git folders hash their own path.
	const plain = projectMountGuestPath("/data/site");
	assert.equal(plain, `/workspace/${deriveWorktreeSlug("/data/site", "/data/site")}`);
	assert.notEqual(repo, projectMountGuestPath("/Users/other/My App", "/Users/other/My App"));
});

// Mounts reminders collapse in LLM context: a reminder is superseded by a newer
// one unless a real assistant reply separates them (feedback, 2026-11-01).
type CtxMsg = { role?: string; customType?: string };
const msg = (role: string, customType?: string): CtxMsg => ({ role, customType });

test("stacked mount reminders collapse to the latest when no assistant reply separates them", () => {
	const messages = [
		msg("user", undefined),
		msg("custom", "chat-mounts"),
		msg("custom", "chat-mounts"),
		msg("custom", "chat-context"),
		msg("custom", "chat-mounts"),
		msg("user"),
		msg("custom", "chat-mounts"),
	];
	const result = collapseMountsReminders(messages);
	assert.deepEqual(result.filter((m) => m.customType === "chat-mounts").length, 1);
	assert.equal(result.at(-1)?.customType, "chat-mounts");
	assert.equal(result.filter((m) => m.customType === "chat-context").length, 1);
	assert.deepEqual(
		result.filter((m) => m.role === "user"),
		[msg("user"), msg("user")],
	);
});

test("mount reminders separated by assistant replies are all kept", () => {
	const messages = [msg("custom", "chat-mounts"), msg("assistant"), msg("custom", "chat-mounts")];
	assert.equal(collapseMountsReminders(messages).length, 3);
});

test("context without mount reminders is returned unchanged", () => {
	const messages = [msg("user"), msg("assistant"), msg("custom", "chat-context")];
	assert.deepEqual(collapseMountsReminders(messages), messages);
	assert.deepEqual(collapseMountsReminders([msg("custom", "chat-mounts")]), [msg("custom", "chat-mounts")]);
});

test("worktree slug is sanitized, stable, and distinct per repo", () => {
	const slug = deriveWorktreeSlug("/Users/me/My App", "/Users/me/My App");
	assert.match(slug, /^[a-z0-9][a-z0-9-]*$/);
	assert.equal(slug, deriveWorktreeSlug("/Users/me/My App", "/Users/me/My App"));
	assert.notEqual(slug, deriveWorktreeSlug("/Users/other/My App", "/Users/other/My App"));
});

test("ensureWorktree recreates a manually deleted worktree by reusing its branch", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-chat-wt-"));
	const repo = join(root, "repo");
	mkdirSync(repo, { recursive: true });
	const run = (args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
	run(["init", "-q"]);
	writeFileSync(join(repo, "f.txt"), "x");
	run(["add", "f.txt"]);
	run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

	const wt = join(root, "wt");
	assert.deepEqual(ensureWorktree(repo, wt, "proj-ab12cd34"), { ok: true, reused: false });
	assert.equal(existsSync(join(wt, "f.txt")), true);

	// Manual delete: the branch survives, the worktree registration goes stale.
	rmSync(wt, { recursive: true });
	assert.deepEqual(ensureWorktree(repo, wt, "proj-ab12cd34"), { ok: true, reused: true });
	const branch = spawnSync("git", ["-C", wt, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
	assert.equal(branch.stdout.trim(), "proj-ab12cd34");
});

test("upsert keeps one mount per guest path: projects coexist, remounts replace", () => {
	const data: GondolinMountConfig = { hostPath: "/tmp/data", guestPath: "/workspace/data" };
	const repoRo: GondolinMountConfig = { hostPath: "/repo", guestPath: "/workspace/repo-aaaa", readOnly: true };
	assert.deepEqual(upsertProjectMount([], repoRo), [repoRo]);
	// A different project adds a second mount.
	const site: GondolinMountConfig = { hostPath: "/site", guestPath: "/workspace/site-bbbb", readOnly: true };
	assert.deepEqual(upsertProjectMount([data, repoRo], site), [data, repoRo, site]);
	// Remounting the same guest path (ro → rw) replaces in place.
	const replaced = upsertProjectMount([data, repoRo, site], {
		hostPath: "/repo/.worktrees/repo-aaaa",
		guestPath: "/workspace/repo-aaaa",
		readOnly: false,
		worktree: true,
	});
	assert.equal(replaced.length, 3);
	assert.deepEqual(replaced[1], {
		hostPath: "/repo/.worktrees/repo-aaaa",
		guestPath: "/workspace/repo-aaaa",
		readOnly: false,
		worktree: true,
	});
});

test("remove drops mounts by host path and tolerates absence", () => {
	const data: GondolinMountConfig = { hostPath: "/tmp/data", guestPath: "/workspace/data" };
	const repoRo: GondolinMountConfig = { hostPath: "/repo", guestPath: "/workspace/repo-aaaa", readOnly: true };
	const repoWt: GondolinMountConfig = {
		hostPath: "/conv/worktrees/repo-aaaa",
		guestPath: "/workspace/repo-aaaa",
		readOnly: false,
		worktree: true,
	};
	// ro unmount matches the original path; rw unmount matches the worktree copy path.
	assert.deepEqual(removeProjectMount([data, repoRo], ["/repo"]), [data]);
	assert.deepEqual(removeProjectMount([data, repoWt], ["/conv/worktrees/repo-aaaa"]), [data]);
	assert.deepEqual(removeProjectMount([data, repoWt], ["/other"]), [data, repoWt]);
	assert.deepEqual(removeProjectMount([], ["/repo"]), []);
});

test("signature matches identical mounts and differs on any change", () => {
	const ro: GondolinMountConfig = { hostPath: "/repo", guestPath: "/workspace/repo-aaaa", readOnly: true };
	const rw: GondolinMountConfig = {
		hostPath: "/repo2",
		guestPath: "/workspace/repo2-bbbb",
		readOnly: false,
		worktree: true,
	};
	assert.equal(mountsSignature([ro]), mountsSignature([{ ...ro }]));
	assert.notEqual(mountsSignature([ro]), mountsSignature([rw]));
	assert.notEqual(mountsSignature([]), mountsSignature([rw]));
});

test("reminder shows VM path, RO/RW, host source, and the RW worktree instruction (ADR 0002)", () => {
	assert.equal(formatMountsReminder([]), "");
	const ro: GondolinMountConfig = { hostPath: "/repo", guestPath: "/workspace/repo-aaaa", readOnly: true };
	const roText = formatMountsReminder([ro]);
	assert.match(roText, /\/workspace\/repo-aaaa/);
	assert.match(roText, /\/repo/);
	assert.match(roText, /read-only/);
	assert.doesNotMatch(roText, /read-write/);
	const rw: GondolinMountConfig = {
		hostPath: "/repo2",
		guestPath: "/workspace/repo2-bbbb",
		readOnly: false,
		worktree: true,
	};
	const rwText = formatMountsReminder([rw]);
	assert.match(rwText, /read-write/);
	assert.match(rwText, /worktree copy/);
	assert.match(rwText, /original/);
	assert.match(rwText, /commit/);
	// rw without the worktree flag is a non-git bind-as-is: edits touch the original.
	const directText = formatMountsReminder([{ ...rw, worktree: undefined }]);
	assert.match(directText, /read-write/);
	assert.match(directText, /original folder/);
	assert.doesNotMatch(directText, /worktree copy/);
	// Several projects appear in one reminder.
	const both = formatMountsReminder([ro, rw]);
	assert.match(both, /\/workspace\/repo-aaaa/);
	assert.match(both, /\/workspace\/repo2-bbbb/);
});
