import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getAccountStorageDir, loadChatConfig, resolveConversation } from "../config.js";
import type { ConfiguredChannel, TelegramAccountConfig } from "../core/config-types.js";
import type { InboundMessageInput } from "../core/runtime-types.js";
import { acquireFileLock, releaseFileLock } from "../log.js";
import {
	callTelegramApi,
	getLatestUpdateId,
	mergeMediaGroup,
	messageToInput,
	type TelegramMessage,
	type TelegramUpdate,
} from "./telegram.js";

export interface AccountFeedCallbacks {
	// own=true: this process owns the conversation (full runtime path).
	// own=false: append the record to the target conversation log for its worker to absorb.
	onInbound(
		target: import("../core/config-types.js").ResolvedConversation,
		input: InboundMessageInput,
		own: boolean,
	): Promise<void>;
	onTopicCreated(chatId: string, threadId: number, name: string): Promise<void>;
	onError(error: Error): Promise<void>;
}

interface FeedState {
	cursor?: number;
	forumChats?: Record<string, boolean>;
}

export interface AccountFeed {
	readonly leader: boolean;
	stop(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One getUpdates consumer per bot token (Telegram allows exactly one), so the feed
// runs at account level: the first connected process wins the lock and fans updates
// out to conversation logs by (chat_id, thread_id); followers tail their own logs.
export function startAccountFeed(options: {
	accountId: string;
	botToken: string;
	ownChannelKey: string;
	ownerId: string;
	callbacks: AccountFeedCallbacks;
}): AccountFeed {
	const { accountId, botToken, ownChannelKey, ownerId, callbacks } = options;
	const lockPath = join(getAccountStorageDir(accountId), "feed.lock");
	const statePath = join(getAccountStorageDir(accountId), "feed.json");
	const controller = new AbortController();
	const state: FeedState = {};
	const mediaGroups = new Map<string, { updates: TelegramUpdate[]; timer?: ReturnType<typeof setTimeout> }>();
	let leader = false;
	let stopped = false;
	let promoteTimer: ReturnType<typeof setInterval> | undefined;

	const persistState = async (): Promise<void> => {
		await writeFile(statePath, JSON.stringify(state), "utf8").catch(() => undefined);
	};

	const isForum = async (chatId: string): Promise<boolean> => {
		const cached = state.forumChats?.[chatId];
		if (cached !== undefined) return cached;
		let value = false;
		try {
			const chat = await callTelegramApi<{ is_forum?: boolean }>(botToken, "getChat", { chat_id: Number(chatId) });
			value = chat.is_forum ?? false;
		} catch {
			value = false;
		}
		state.forumChats = { ...(state.forumChats ?? {}), [chatId]: value };
		await persistState();
		return value;
	};

	const dispatch = async (message: TelegramMessage): Promise<void> => {
		const config = await loadChatConfig();
		const account = config.accounts[accountId];
		if (!account || account.service !== "telegram") return;
		const chatId = String(message.chat.id);
		const rawThread =
			message.is_topic_message || message.message_thread_id !== undefined ? message.message_thread_id : undefined;
		const threadId = rawThread ?? ((await isForum(chatId)) ? 1 : undefined);
		const entry = Object.entries(account.channels).find(
			([, channel]: [string, ConfiguredChannel]) => channel.id === chatId && channel.threadId === threadId,
		);
		if (!entry) return;
		const conversation = resolveConversation(config, `${accountId}/${entry[0]}`);
		if (!conversation) return;
		const input = await messageToInput(conversation, account as TelegramAccountConfig, message);
		if (!input) return;
		await callbacks.onInbound(conversation, input, entry[0] === ownChannelKey);
	};

	const flushMediaGroup = async (key: string): Promise<void> => {
		const entry = mediaGroups.get(key);
		mediaGroups.delete(key);
		if (!entry) return;
		const merged = mergeMediaGroup(entry.updates);
		if (merged) await dispatch(merged);
	};

	const handleUpdate = async (update: TelegramUpdate): Promise<void> => {
		const message = update.message || update.edited_message;
		if (!message) return;
		if (message.forum_topic_created && message.message_thread_id !== undefined) {
			await callbacks.onTopicCreated(
				String(message.chat.id),
				message.message_thread_id,
				message.forum_topic_created.name || `topic-${message.message_thread_id}`,
			);
			return;
		}
		if (message.media_group_id) {
			const key = `${message.chat.id}:${message.media_group_id}`;
			const entry = mediaGroups.get(key) ?? { updates: [] };
			entry.updates.push(update);
			if (entry.timer) clearTimeout(entry.timer);
			entry.timer = setTimeout(() => {
				void flushMediaGroup(key).catch(async (error) => {
					await callbacks.onError(error instanceof Error ? error : new Error(String(error)));
				});
			}, 1200);
			mediaGroups.set(key, entry);
			return;
		}
		await dispatch(message);
	};

	const runLoop = async (): Promise<void> => {
		while (!stopped) {
			try {
				const updates = await callTelegramApi<TelegramUpdate[]>(
					botToken,
					"getUpdates",
					{
						offset: state.cursor !== undefined ? state.cursor + 1 : undefined,
						timeout: 30,
						allowed_updates: ["message", "edited_message"],
					},
					{ signal: controller.signal },
				);
				let advanced = false;
				for (const update of updates) {
					state.cursor = update.update_id;
					advanced = true;
					await handleUpdate(update);
				}
				if (advanced) await persistState();
			} catch (error) {
				if (stopped) break;
				if (error instanceof DOMException && error.name === "AbortError") break;
				await callbacks.onError(error instanceof Error ? error : new Error(String(error)));
				await sleep(3000);
			}
		}
	};

	const becomeLeader = async (): Promise<boolean> => {
		if (leader || stopped) return leader;
		if (!(await acquireFileLock(lockPath, ownerId))) return false;
		leader = true;
		try {
			state.cursor = (JSON.parse(await readFile(statePath, "utf8")) as FeedState).cursor;
		} catch {
			// Fresh account: skip any backlog, start from the latest update.
		}
		if (state.cursor === undefined) {
			try {
				const latest = await getLatestUpdateId(botToken);
				if (latest !== undefined) state.cursor = latest;
			} catch {
				// Poll with undefined offset next time.
			}
		}
		await persistState();
		void runLoop();
		return true;
	};

	void (async () => {
		try {
			await callTelegramApi(botToken, "deleteWebhook", { drop_pending_updates: false });
		} catch {
			// No webhook configured, or transient failure: polling still works.
		}
		if (!(await becomeLeader())) {
			promoteTimer = setInterval(() => {
				void becomeLeader().catch(() => undefined);
			}, 30000);
		}
	})();

	return {
		get leader() {
			return leader;
		},
		stop: async () => {
			stopped = true;
			controller.abort();
			if (promoteTimer) clearInterval(promoteTimer);
			for (const entry of mediaGroups.values()) if (entry.timer) clearTimeout(entry.timer);
			if (leader) await releaseFileLock(lockPath);
		},
	};
}
