import { basename } from "node:path";

import type { GondolinMountConfig } from "./core/config-types.js";

// ADR 0002: the project mount always appears at this guest path.
export const PROJECT_MOUNT_GUEST_PATH = "/workspace/project";

// djb2 → 8 hex chars; keeps same-basename projects from colliding under worktrees/.
function shortHash(value: string): string {
	let hash = 5381;
	for (const byte of Buffer.from(value, "utf8")) hash = ((hash * 33) ^ byte) >>> 0;
	return hash.toString(16).padStart(8, "0");
}

// Stable per repo root, so unmount/remount of the same project reuses its worktree.
export function deriveWorktreeSlug(hostPath: string, repoRoot: string): string {
	const stem =
		basename(hostPath)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project";
	return `${stem}-${shortHash(repoRoot)}`;
}

export function upsertProjectMount(mounts: GondolinMountConfig[], entry: GondolinMountConfig): GondolinMountConfig[] {
	return [...mounts.filter((mount) => mount.guestPath !== PROJECT_MOUNT_GUEST_PATH), entry];
}

export function removeProjectMount(mounts: GondolinMountConfig[]): GondolinMountConfig[] {
	return mounts.filter((mount) => mount.guestPath !== PROJECT_MOUNT_GUEST_PATH);
}

export function mountsSignature(mounts: GondolinMountConfig[]): string {
	return JSON.stringify(
		mounts.map((mount) => [mount.guestPath ?? "", mount.hostPath, mount.readOnly !== false, mount.worktree === true]),
	);
}

// ADR 0002 reminder format: VM path + RO/RW + host source, plus the RW worktree instruction.
export function formatMountsReminder(mounts: GondolinMountConfig[]): string {
	const lines = mounts.map((mount) => {
		const guest = mount.guestPath?.trim() || `/workspace/${basename(mount.hostPath)}`;
		const readOnly = mount.readOnly !== false;
		const source = `${guest} (${readOnly ? "read-only" : "read-write"}) ← ${mount.hostPath}`;
		if (readOnly) return `- ${source}`;
		if (mount.worktree === true)
			return `- ${source} — edits go to the git worktree copy, the original project is untouched; commit your changes to the worktree's branch.`;
		return `- ${source} — edits write through to the original folder.`;
	});
	if (lines.length === 0) return "";
	return `Project mounts (host folders are reachable only through these VM paths):\n${lines.join("\n")}`;
}
