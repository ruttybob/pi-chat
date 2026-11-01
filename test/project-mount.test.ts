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
	PROJECT_MOUNT_GUEST_PATH,
	removeProjectMount,
	upsertProjectMount,
} from "../src/project-mount.ts";

test("project mount uses the fixed guest path (ADR 0002)", () => {
	assert.equal(PROJECT_MOUNT_GUEST_PATH, "/workspace/project");
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
	assert.deepEqual(
		result.filter((m) => m.customType === "chat-mounts").length,
		1,
	);
	assert.equal(result.at(-1)?.customType, "chat-mounts");
	assert.equal(result.filter((m) => m.customType === "chat-context").length, 1);
	assert.deepEqual(result.filter((m) => m.role === "user"), [msg("user"), msg("user")]);
});

test("mount reminders separated by assistant replies are all kept", () => {
	const messages = [
		msg("custom", "chat-mounts"),
		msg("assistant"),
		msg("custom", "chat-mounts"),
	];
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

test("upsert replaces the project mount and keeps unrelated mounts", () => {
	const unrelated: GondolinMountConfig = { hostPath: "/tmp/data", guestPath: "/workspace/data" };
	const ro: GondolinMountConfig = { hostPath: "/repo", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: true };
	assert.deepEqual(upsertProjectMount([], ro), [ro]);
	const replaced = upsertProjectMount([unrelated, ro], { ...ro, hostPath: "/repo2", readOnly: false });
	assert.equal(replaced.length, 2);
	assert.deepEqual(replaced[0], unrelated);
	assert.deepEqual(replaced[1], { hostPath: "/repo2", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: false });
});

test("remove drops only the project mount and tolerates absence", () => {
	const unrelated: GondolinMountConfig = { hostPath: "/tmp/data", guestPath: "/workspace/data" };
	const ro: GondolinMountConfig = { hostPath: "/repo", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: true };
	assert.deepEqual(removeProjectMount([unrelated, ro]), [unrelated]);
	assert.deepEqual(removeProjectMount([unrelated]), [unrelated]);
	assert.deepEqual(removeProjectMount([]), []);
});

test("signature matches identical mounts and differs on any change", () => {
	const ro: GondolinMountConfig = { hostPath: "/repo", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: true };
	const rw: GondolinMountConfig = {
		hostPath: "/repo2",
		guestPath: PROJECT_MOUNT_GUEST_PATH,
		readOnly: false,
		worktree: true,
	};
	assert.equal(mountsSignature([ro]), mountsSignature([{ ...ro }]));
	assert.notEqual(mountsSignature([ro]), mountsSignature([rw]));
	assert.notEqual(mountsSignature([]), mountsSignature([rw]));
});

test("reminder shows VM path, RO/RW, host source, and the RW worktree instruction (ADR 0002)", () => {
	assert.equal(formatMountsReminder([]), "");
	const ro: GondolinMountConfig = { hostPath: "/repo", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: true };
	const roText = formatMountsReminder([ro]);
	assert.match(roText, /\/workspace\/project/);
	assert.match(roText, /\/repo/);
	assert.match(roText, /read-only/);
	assert.doesNotMatch(roText, /read-write/);
	const rw: GondolinMountConfig = {
		hostPath: "/repo2",
		guestPath: PROJECT_MOUNT_GUEST_PATH,
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
});
