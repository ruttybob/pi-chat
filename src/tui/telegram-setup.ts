import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

import { saveChatConfig } from "../config.js";
import type { AccessPolicy, ChatConfig, ConfiguredChannel, TelegramAccountConfig } from "../core/config-types.js";
import { ensureUniqueKey, makeAccountKey, makeChannelKey } from "../core/keys.js";
import { refreshAccountSnapshot, updateAccountIdentityFromSnapshot, validateAccountDraft } from "../services/index.js";
import { runWithLoader, selectItem, showNotice } from "./dialogs.js";

interface TelegramApiResponse<T> {
	ok: boolean;
	result?: T;
	description?: string;
}

interface TelegramUser {
	id: number;
	username?: string;
	first_name?: string;
	last_name?: string;
}

interface TelegramChat {
	id: number;
	type: string;
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
	is_forum?: boolean;
}

interface TelegramMessage {
	message_id: number;
	chat: TelegramChat;
	from?: TelegramUser;
	text?: string;
	caption?: string;
	message_thread_id?: number;
	is_topic_message?: boolean;
	forum_topic_created?: {
		name: string;
		message_thread_id: number;
	};
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
}

type TelegramSetupMode = "dm" | "group" | "topic";

interface ObservedTelegramTarget {
	chatId: string;
	chatName: string;
	userId?: string;
	userName?: string;
	threadId?: number;
	topicName?: string;
}

function displayName(user: TelegramUser | undefined): string | undefined {
	if (!user) return undefined;
	return user.username || [user.first_name, user.last_name].filter(Boolean).join(" ") || String(user.id);
}

function chatDisplayName(chat: TelegramChat): string {
	return chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || String(chat.id);
}

async function callTelegram<T>(botToken: string, method: string, body: Record<string, unknown>): Promise<T> {
	const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await response.json()) as TelegramApiResponse<T>;
	if (!response.ok || !data.ok || data.result === undefined)
		throw new Error(data.description || `Telegram API ${method} failed`);
	return data.result;
}

async function getLatestUpdateId(botToken: string): Promise<number | undefined> {
	const updates = await callTelegram<TelegramUpdate[]>(botToken, "getUpdates", { offset: -1, limit: 1, timeout: 0 });
	return updates.at(-1)?.update_id;
}

function buildSetupMessage(mode: TelegramSetupMode, botUsername?: string): string {
	const webLink = botUsername ? `https://web.telegram.org/k/#@${botUsername}` : undefined;
	const appLink = botUsername ? `tg://resolve?domain=${botUsername}` : undefined;
	const lines = [
		mode === "dm" ? "Telegram DM setup" : mode === "topic" ? "Telegram topic setup" : "Telegram group setup",
		"",
	];
	if (botUsername) {
		lines.push(`Bot: @${botUsername}`);
		lines.push(`Open in Telegram Web: ${webLink}`);
		lines.push(`Open on device: ${appLink}`);
		lines.push("");
	}
	if (mode === "dm") lines.push("Open the bot DM and send /start.");
	else if (mode === "topic") {
		lines.push("Send any message in the target forum topic (including General).");
		lines.push("Creating a topic in Telegram works too — its first message is enough.");
	} else {
		lines.push("Add the bot to the target group.");
		lines.push("Then send /start or mention the bot in that group.");
	}
	return lines.join("\n");
}

function matchObservedTarget(message: TelegramMessage, mode: TelegramSetupMode): ObservedTelegramTarget | undefined {
	if (mode === "dm" && message.chat.type !== "private") return undefined;
	if (mode === "group" && message.chat.type !== "group" && message.chat.type !== "supergroup") return undefined;
	if (mode === "topic") {
		if (message.chat.type !== "supergroup") return undefined;
		const threadId = message.forum_topic_created?.message_thread_id ?? message.message_thread_id;
		if (threadId === undefined) return undefined;
		return {
			chatId: String(message.chat.id),
			chatName: chatDisplayName(message.chat),
			userId: message.from ? String(message.from.id) : undefined,
			userName: displayName(message.from),
			threadId,
			topicName: message.forum_topic_created?.name,
		};
	}
	return {
		chatId: String(message.chat.id),
		chatName: chatDisplayName(message.chat),
		userId: message.from ? String(message.from.id) : undefined,
		userName: displayName(message.from),
	};
}

async function observeTelegramTarget(
	ctx: ExtensionContext,
	botToken: string,
	botUsername: string | undefined,
	mode: TelegramSetupMode,
): Promise<ObservedTelegramTarget | undefined> {
	const message = buildSetupMessage(mode, botUsername);
	const result = await ctx.ui.custom<ObservedTelegramTarget | undefined>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, message, { cancellable: true });
		loader.onAbort = () => done(undefined);
		void (async () => {
			try {
				await callTelegram(botToken, "deleteWebhook", { drop_pending_updates: false });
				let offset = (await getLatestUpdateId(botToken)) ?? 0;
				while (!loader.signal.aborted) {
					const updates = await callTelegram<TelegramUpdate[]>(botToken, "getUpdates", {
						offset: offset + 1,
						timeout: 30,
						allowed_updates: ["message", "edited_message"],
					});
					for (const update of updates) {
						offset = update.update_id;
						const observed = matchObservedTarget(
							update.message || update.edited_message || ({} as TelegramMessage),
							mode,
						);
						if (observed) {
							done(observed);
							return;
						}
					}
				}
			} catch {
				done(undefined);
			}
		})();
		return loader;
	});
	return result;
}

export async function createTelegramAccountWithGuidedSetup(
	ctx: ExtensionContext,
	config: ChatConfig,
): Promise<string | undefined> {
	const token = await ctx.ui.input("Telegram bot token", "123456:ABCDEF...");
	if (!token?.trim()) return undefined;
	const validation = await runWithLoader(ctx, "Validating Telegram bot token...", () =>
		validateAccountDraft({ service: "telegram", botToken: token.trim() }),
	);
	if (validation.error) {
		await showNotice(ctx, "Telegram setup error", validation.error, "error");
		return undefined;
	}
	if (!validation.value) return undefined;
	const accountLabel = await ctx.ui.input(
		"Account label",
		validation.value.identity.userName || validation.value.identity.name || "telegram",
	);
	if (accountLabel === undefined) return undefined;
	const baseAccountKey = makeAccountKey(
		"telegram",
		accountLabel.trim() || validation.value.identity.userName || validation.value.identity.name,
	);
	const accountKey = ensureUniqueKey(config.accounts, baseAccountKey);
	let account: TelegramAccountConfig = {
		service: "telegram",
		name: accountLabel.trim() || undefined,
		botToken: token.trim(),
		channels: {},
		access: { ignoreBots: true },
	};
	const snapshot = await runWithLoader(ctx, "Fetching Telegram bot info...", () =>
		refreshAccountSnapshot(accountKey, account),
	);
	if (snapshot.error) {
		await showNotice(ctx, "Telegram setup error", snapshot.error, "error");
		return undefined;
	}
	if (!snapshot.value) return undefined;
	account = updateAccountIdentityFromSnapshot(account, snapshot.value) as TelegramAccountConfig;
	config.accounts[accountKey] = account;
	await saveChatConfig(config);
	await showNotice(ctx, "Telegram account created", `Created ${accountKey}`, "info");
	return accountKey;
}

export async function addTelegramObservedTargetToAccount(
	ctx: ExtensionContext,
	config: ChatConfig,
	accountId: string,
	account: TelegramAccountConfig,
	mode: TelegramSetupMode,
): Promise<string | undefined> {
	const observed = await observeTelegramTarget(ctx, account.botToken, account.botUsername, mode);
	if (!observed) return undefined;
	const channelAccess: AccessPolicy =
		mode === "dm"
			? {
					trigger: "message",
					ignoreBots: true,
					allowedUserIds: observed.userId ? [observed.userId] : undefined,
				}
			: { trigger: "mention", ignoreBots: true };
	const channel: ConfiguredChannel = {
		id: observed.chatId,
		dm: mode === "dm",
		access: channelAccess,
	};
	let baseChannelKey: string;
	if (mode === "topic") {
		const topicName = observed.topicName || `topic-${observed.threadId}`;
		channel.threadId = observed.threadId;
		channel.name = topicName;
		baseChannelKey = makeChannelKey(`${observed.chatName}-${topicName}`, `${observed.chatId}-${observed.threadId}`);
	} else {
		channel.name = observed.chatName;
		baseChannelKey = makeChannelKey(
			mode === "dm" ? `dm-${observed.userName || observed.chatName}` : observed.chatName,
			observed.chatId,
		);
	}
	const channelKey = ensureUniqueKey(account.channels, baseChannelKey);
	account.channels[channelKey] = channel;
	config.accounts[accountId] = account;
	await saveChatConfig(config);
	await showNotice(ctx, "Telegram channel configured", `Configured ${accountId}/${channelKey}`, "info");
	return channelKey;
}

// Bot-created topic: needs the bot to be a group admin with "Manage Topics".
export async function createTelegramTopicChannel(
	ctx: ExtensionContext,
	config: ChatConfig,
	accountId: string,
	account: TelegramAccountConfig,
): Promise<string | undefined> {
	const groupChannels = Object.entries(account.channels).filter(
		([, channel]) => !channel.dm && channel.threadId === undefined,
	);
	if (groupChannels.length === 0) {
		await showNotice(
			ctx,
			"No group channel",
			"Add a group channel first — topics are created inside a configured group.",
			"warning",
		);
		return undefined;
	}
	const picked = await selectItem(
		ctx,
		"Create topic in which group?",
		groupChannels.map(([key, channel]) => ({ value: key, label: channel.name ?? key })),
	);
	if (!picked) return undefined;
	const group = account.channels[picked];
	if (!group) return undefined;
	const topicName = await ctx.ui.input("New topic name", "e.g. bugs");
	if (!topicName?.trim()) return undefined;
	const result = await runWithLoader(ctx, "Creating topic...", () =>
		callTelegram<{ message_thread_id: number }>(account.botToken, "createForumTopic", {
			chat_id: Number(group.id),
			name: topicName.trim(),
		}),
	);
	if (result.error) {
		await showNotice(
			ctx,
			"Create topic failed",
			`${result.error}\n\nThe bot must be a group admin with 'Manage Topics' (can_manage_topics).`,
			"error",
		);
		return undefined;
	}
	if (!result.value) return undefined;
	const channelKey = ensureUniqueKey(
		account.channels,
		makeChannelKey(`${group.name ?? group.id}-${topicName.trim()}`, `${group.id}-${result.value.message_thread_id}`),
	);
	account.channels[channelKey] = {
		id: group.id,
		name: topicName.trim(),
		threadId: result.value.message_thread_id,
		access: { trigger: "mention", ignoreBots: true },
	};
	config.accounts[accountId] = account;
	await saveChatConfig(config);
	await showNotice(
		ctx,
		"Topic configured",
		`Configured ${accountId}/${channelKey} (thread ${result.value.message_thread_id})`,
		"info",
	);
	return channelKey;
}
