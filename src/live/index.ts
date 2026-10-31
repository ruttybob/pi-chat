import type { ResolvedConversation } from "../core/config-types.js";
import { connectTelegramLive } from "./telegram.js";
import type { LiveConnection } from "./types.js";

export async function connectLive(conversation: ResolvedConversation): Promise<LiveConnection> {
	return connectTelegramLive(conversation);
}
