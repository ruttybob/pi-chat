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

test("strips single outer quotes from frontmatter values", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-chat-skills-quotes-"));
	await mkdir(join(root, ".pi", "skills"), { recursive: true });
	await writeFile(join(root, ".pi", "skills", "single.md"), "---\ndescription: 'foo'\n---\n");
	await writeFile(join(root, ".pi", "skills", "double.md"), '---\ndescription: "foo"\n---\n');
	// A fully-quoted empty value parses to the empty string, so the skill is skipped like
	// one without a description — not because the quoting regex ate extra characters.
	await writeFile(join(root, ".pi", "skills", "empty.md"), "---\ndescription: ''\n---\n");
	await writeFile(join(root, ".pi", "skills", "inner.md"), '---\ndescription: say "hi" now\n---\n');

	const skills = await loadSafeChatSkills(root);
	skills.sort((a, b) => a.name.localeCompare(b.name));

	assert.deepEqual(
		skills.map((skill) => [skill.name, skill.description]),
		[
			["double", "foo"],
			["inner", 'say "hi" now'],
			["single", "foo"],
		],
	);
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
