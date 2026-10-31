import type { ChatService } from "./config-types.js";

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

export function makeAccountKey(service: ChatService, label: string): string {
	const base = slugify(label) || service;
	return `${service}-${base}`;
}

export function makeChannelKey(label: string, fallbackId: string): string {
	return slugify(label) || fallbackId;
}

export function ensureUniqueKey(existing: Record<string, unknown>, base: string): string {
	if (!existing[base]) return base;
	let index = 2;
	while (existing[`${base}-${index}`]) index += 1;
	return `${base}-${index}`;
}
