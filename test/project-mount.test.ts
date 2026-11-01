import assert from "node:assert/strict";
import test from "node:test";
import {
	deriveWorktreeSlug,
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

test("worktree slug is sanitized, stable, and distinct per repo", () => {
	const slug = deriveWorktreeSlug("/Users/me/My App", "/Users/me/My App");
	assert.match(slug, /^[a-z0-9][a-z0-9-]*$/);
	assert.equal(slug, deriveWorktreeSlug("/Users/me/My App", "/Users/me/My App"));
	assert.notEqual(slug, deriveWorktreeSlug("/Users/other/My App", "/Users/other/My App"));
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
