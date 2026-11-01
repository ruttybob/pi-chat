import { spawnSync } from "node:child_process";
import { basename } from "node:path";

import type { GondolinMountConfig } from "./core/config-types.js";

// ADR 0002: every project mounts at /workspace/<slug>; the slug distinguishes projects,
// so one workspace can hold several mounts at once. Remounting the same project
// (ro ↔ rw) keeps the slug — derived from the repo root for git, else from the path.

// customType of the persistent mounts reminder message.
export const MOUNTS_REMINDER_CUSTOM_TYPE = "chat-mounts";

// Mounts reminders are superseded in LLM context by a newer one unless a real
// assistant reply separates them: without this, toggling mounts between turns
// stacks one user-visible message per change in the model's context.
export function collapseMountsReminders<T extends { role?: unknown; customType?: unknown }>(
	messages: readonly T[],
): T[] {
	const reminderIdx: number[] = [];
	messages.forEach((message, index) => {
		if (message?.role === "custom" && message.customType === MOUNTS_REMINDER_CUSTOM_TYPE) reminderIdx.push(index);
	});
	if (reminderIdx.length <= 1) return [...messages];
	const superseded = new Set<number>();
	for (let k = 0; k < reminderIdx.length - 1; k++) {
		let hasAssistantReply = false;
		for (let i = reminderIdx[k] + 1; i < reminderIdx[k + 1]; i++) {
			if (messages[i]?.role === "assistant") {
				hasAssistantReply = true;
				break;
			}
		}
		if (!hasAssistantReply) superseded.add(reminderIdx[k]);
	}
	if (superseded.size === 0) return [...messages];
	return messages.filter((_, index) => !superseded.has(index));
}

// djb2 → 8 hex chars; keeps same-basename projects from colliding under worktrees/.
function shortHash(value: string): string {
	let hash = 5381;
	for (const byte of Buffer.from(value, "utf8")) hash = ((hash * 33) ^ byte) >>> 0;
	return hash.toString(16).padStart(8, "0");
}

export function projectMountGuestPath(hostPath: string, repoRoot?: string): string {
	return `/workspace/${deriveWorktreeSlug(hostPath, repoRoot ?? hostPath)}`;
}

// Stable per repo root, so unmount/remount of the same project reuses its worktree.
export function deriveWorktreeSlug(hostPath: string, repoRoot = hostPath): string {
	const stem =
		basename(hostPath)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project";
	return `${stem}-${shortHash(repoRoot)}`;
}

export function upsertProjectMount(mounts: GondolinMountConfig[], entry: GondolinMountConfig): GondolinMountConfig[] {
	const idx = mounts.findIndex((mount) => mount.guestPath === entry.guestPath);
	if (idx === -1) return [...mounts, entry];
	return mounts.map((mount, i) => (i === idx ? entry : mount));
}

// Unmount matches host paths: a ro mount binds the original folder, an rw mount the
// worktree copy — callers pass the candidate paths derived from the user's argument.
export function removeProjectMount(mounts: GondolinMountConfig[], hostPaths: string[]): GondolinMountConfig[] {
	const drop = new Set(hostPaths);
	return mounts.filter((mount) => !drop.has(mount.hostPath));
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

export type EnsureWorktreeResult = { ok: true; reused: boolean } | { ok: false; error: string };

// ADR 0002: the worktree copy lives under channels/<c>/worktrees/<slug>, and <slug> is
// also its branch name. Re-creating after a manual directory delete must reuse the
// existing branch (`git worktree add <path> <branch>`): naming a new branch (-b) fails
// because the branch already exists.
export function ensureWorktree(repoRoot: string, worktreePath: string, slug: string): EnsureWorktreeResult {
	const git = (...args: string[]) => spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
	if (git("rev-parse", "--verify", "--quiet", `refs/heads/${slug}`).status === 0) {
		// The stale registration still points at the deleted path and blocks checkout.
		git("worktree", "prune");
		const added = git("worktree", "add", worktreePath, slug);
		if (added.status !== 0)
			return { ok: false, error: added.stderr.trim() || added.error?.message || "git worktree add failed" };
		return { ok: true, reused: true };
	}
	const added = git("worktree", "add", "-b", slug, worktreePath);
	if (added.status !== 0)
		return { ok: false, error: added.stderr.trim() || added.error?.message || "git worktree add failed" };
	return { ok: true, reused: false };
}
