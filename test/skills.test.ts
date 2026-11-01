import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSafeChatSkills } from "../src/skills.ts";

test("discovers skills only from <root>/.pi/skills", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-chat-skills-"));
	await mkdir(join(root, ".pi", "skills", "packed"), { recursive: true });
	await mkdir(join(root, "skills"), { recursive: true });
	await writeFile(join(root, "skills", "legacy.md"), "---\ndescription: legacy skill at the old path\n---\n");
	await writeFile(join(root, ".pi", "skills", "single.md"), "---\nname: single\ndescription: single-file skill\n---\n");
	await writeFile(join(root, ".pi", "skills", "packed", "SKILL.md"), "---\ndescription: packed skill\n---\n");

	const skills = await loadSafeChatSkills(root);
	skills.sort((a, b) => a.name.localeCompare(b.name));

	assert.deepEqual(
		skills.map((skill) => [skill.name, skill.description]),
		[
			["packed", "packed skill"],
			["single", "single-file skill"],
		],
	);
	assert.ok(skills.every((skill) => skill.filePath.includes(`${join(root, ".pi", "skills")}/`)));
});

test("skips skills without a description and disabled skills", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-chat-skills-"));
	await mkdir(join(root, ".pi", "skills"), { recursive: true });
	await writeFile(join(root, ".pi", "skills", "no-description.md"), "---\nname: no-description\n---\n");
	await writeFile(
		join(root, ".pi", "skills", "disabled.md"),
		"---\ndescription: turned off\ndisable-model-invocation: true\n---\n",
	);
	await writeFile(join(root, ".pi", "skills", "kept.md"), "---\ndescription: kept skill\n---\n");

	const skills = await loadSafeChatSkills(root);
	assert.deepEqual(skills, [
		{ name: "kept", description: "kept skill", filePath: join(root, ".pi", "skills", "kept.md") },
	]);
});
