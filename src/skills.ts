import { type Dirent, constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";

export interface ChatPromptSkill {
	name: string;
	description: string;
	filePath: string;
}

function isInsideHostPath(root: string, value: string): boolean {
	const rel = relative(root, value);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function safeReadMountedText(root: string, filePath: string): Promise<string> {
	try {
		const realRoot = await realpath(root);
		const resolvedPath = await realpath(filePath);
		if (!isInsideHostPath(realRoot, resolvedPath)) return "";
		const handle = await open(resolvedPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
		try {
			const info = await handle.stat();
			if (!info.isFile()) return "";
			return await handle.readFile("utf8");
		} finally {
			await handle.close();
		}
	} catch {
		return "";
	}
}

export function parseSkillFrontmatter(content: string): { name?: string; description?: string; disabled?: boolean } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) return {};
	const frontmatter: { name?: string; description?: string; disabled?: boolean } = {};
	for (const line of match[1].split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const rawValue = line
			.slice(separator + 1)
			.trim()
			.replace(/^['"]|['"]$/g, "");
		if (key === "name") frontmatter.name = rawValue;
		if (key === "description") frontmatter.description = rawValue;
		if (key === "disable-model-invocation") frontmatter.disabled = rawValue === "true";
	}
	return frontmatter;
}

// Single source of chat skills: <account shared>/.pi/skills (ADR 0001). Legacy roots are not scanned.
export async function loadSafeChatSkills(root: string): Promise<ChatPromptSkill[]> {
	const skillsRoot = join(root, ".pi", "skills");
	const skills: ChatPromptSkill[] = [];
	async function addSkill(filePath: string, defaultName: string): Promise<void> {
		const content = await safeReadMountedText(root, filePath);
		const frontmatter = parseSkillFrontmatter(content);
		if (!frontmatter.description?.trim() || frontmatter.disabled) return;
		skills.push({ name: frontmatter.name || defaultName, description: frontmatter.description, filePath });
	}
	async function walkSkills(dir: string, depth: number): Promise<void> {
		if (depth > 8) return;
		let entries: Dirent<string>[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
			const fullPath = join(dir, entry.name);
			if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
				await addSkill(fullPath, basename(entry.name, ".md"));
				continue;
			}
			if (!entry.isDirectory()) continue;
			const skillMd = join(fullPath, "SKILL.md");
			try {
				const info = await lstat(skillMd);
				if (info.isFile()) {
					await addSkill(skillMd, entry.name);
					continue;
				}
			} catch {
				// Not a skill root; recurse below.
			}
			await walkSkills(fullPath, depth + 1);
		}
	}
	await walkSkills(skillsRoot, 0);
	return skills;
}
