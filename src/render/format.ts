// Formatting adapted from Vercel Chat SDK service converters (MIT).
// Source inspiration:
// - packages/adapter-telegram/src/markdown.ts

import type { ChatService } from "../core/config-types.js";

export interface RenderedChunkPayload {
	text: string;
	parseMode?: "Markdown";
}

function normalizeTelegram(markdown: string): string {
	return markdown
		.replace(/\|(.+)\|/g, (match) => (match.includes("\n") ? match : match))
		.replace(/\r\n/g, "\n")
		.trim();
}

export function formatMarkdownForService(service: ChatService, markdown: string): RenderedChunkPayload {
	if (service !== "telegram") throw new Error(`Unsupported service: ${service}`);
	return { text: normalizeTelegram(markdown), parseMode: "Markdown" };
}

export function maxMessageLength(service: ChatService): number {
	if (service !== "telegram") throw new Error(`Unsupported service: ${service}`);
	return 4096;
}
