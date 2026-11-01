// Assert-based self-check for the pure project-mount helpers (ADR 0002).
// Run: node scripts/project-mount-selfcheck.ts
import assert from "node:assert/strict";
import {
	deriveWorktreeSlug,
	formatMountsReminder,
	type GondolinMountConfig,
	mountsSignature,
	PROJECT_MOUNT_GUEST_PATH,
	removeProjectMount,
	upsertProjectMount,
} from "../src/project-mount.ts";

// ADR 0002: fixed guest path.
assert.equal(PROJECT_MOUNT_GUEST_PATH, "/workspace/project");

// Slug: sanitized, stable, and distinct per repo even with equal basenames.
const slug = deriveWorktreeSlug("/Users/me/My App", "/Users/me/My App");
assert.match(slug, /^[a-z0-9][a-z0-9-]*$/);
assert.equal(slug, deriveWorktreeSlug("/Users/me/My App", "/Users/me/My App"));
assert.notEqual(slug, deriveWorktreeSlug("/Users/other/My App", "/Users/other/My App"));

// Upsert replaces the project mount, keeps unrelated mounts, appends when absent.
const unrelated: GondolinMountConfig = { hostPath: "/tmp/data", guestPath: "/workspace/data" };
const ro: GondolinMountConfig = { hostPath: "/repo", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: true };
assert.deepEqual(upsertProjectMount([], ro), [ro]);
const replaced = upsertProjectMount([unrelated, ro], { ...ro, hostPath: "/repo2", readOnly: false });
assert.equal(replaced.length, 2);
assert.deepEqual(replaced[0], unrelated);
assert.deepEqual(replaced[1], { hostPath: "/repo2", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: false });

// Remove drops only the project mount and tolerates absence.
assert.deepEqual(removeProjectMount([unrelated, ro]), [unrelated]);
assert.deepEqual(removeProjectMount([unrelated]), [unrelated]);
assert.deepEqual(removeProjectMount([]), []);

// Signature: identical settings match, any change differs.
const rw = { hostPath: "/repo2", guestPath: PROJECT_MOUNT_GUEST_PATH, readOnly: false, worktree: true };
assert.equal(mountsSignature([ro]), mountsSignature([{ ...ro }]));
assert.notEqual(mountsSignature([ro]), mountsSignature([rw]));
assert.notEqual(mountsSignature([]), mountsSignature([rw]));

// Reminder (ADR 0002 format): VM path + RO/RW + host source + RW instruction.
assert.equal(formatMountsReminder([]), "");
const roText = formatMountsReminder([ro]);
assert.match(roText, /\/workspace\/project/);
assert.match(roText, /\/repo/);
assert.match(roText, /read-only/);
assert.doesNotMatch(roText, /read-write/);
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

console.log("project-mount selfcheck: ok");
