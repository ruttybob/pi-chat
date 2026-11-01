import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
	CHAT_CONFIG_PATH,
	loadChatConfig,
	removeAccountStorage,
	removeChannelStorage,
	saveChatConfig,
} from "../config.js";
import type {
	AccessPolicy,
	ChatAccountConfig,
	ChatConfig,
	GondolinConfig,
	GondolinSecretConfig,
	TelegramAccountConfig,
} from "../core/config-types.js";
import type { DiscoveredUser, DiscoverySnapshot } from "../core/discovery-types.js";
import { loadDiscoverySnapshot } from "../discovery-store.js";
import { refreshAccountSnapshot, updateAccountIdentityFromSnapshot } from "../services/index.js";
import { selectItem, showNotice, toggleItems } from "./dialogs.js";
import {
	addTelegramObservedTargetToAccount,
	createTelegramAccountWithGuidedSetup,
	createTelegramTopicChannel,
} from "./telegram-setup.js";

function accountDescription(account: ChatAccountConfig, snapshot: DiscoverySnapshot | undefined): string {
	const parts: string[] = [account.service];
	if (account.name) parts.push(account.name);
	if (snapshot?.identity.userName) parts.push(`@${snapshot.identity.userName}`);
	parts.push(
		`${Object.keys(account.channels).length} configured channel${Object.keys(account.channels).length === 1 ? "" : "s"}`,
	);
	return parts.join(" • ");
}

function toUserToggleItems(
	users: DiscoveredUser[],
	selectedIds: string[] = [],
): Array<{ id: string; label: string; description?: string }> {
	const items = new Map<string, { id: string; label: string; description?: string }>();
	for (const user of users) {
		items.set(user.id, {
			id: user.id,
			label: user.displayName || user.name,
			description: user.displayName && user.displayName !== user.name ? user.name : undefined,
		});
	}
	for (const id of selectedIds) if (!items.has(id)) items.set(id, { id, label: id, description: "stored id" });
	return [...items.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function defaultAccess(dm: boolean): AccessPolicy {
	return { trigger: dm ? "message" : "mention", ignoreBots: true };
}

function secretSummary(config: GondolinConfig | undefined): string {
	const count = Object.keys(config?.secrets ?? {}).length;
	return `${count} secret${count === 1 ? "" : "s"}`;
}

function isValidEnvVarName(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

async function promptSecretDraft(
	ctx: ExtensionContext,
	name?: string,
	current?: GondolinSecretConfig,
): Promise<{ name: string; secret: GondolinSecretConfig } | undefined> {
	const secretName = (await ctx.ui.input("VM env var name", name ?? "GITHUB_TOKEN"))?.trim();
	if (!secretName) return undefined;
	if (!isValidEnvVarName(secretName)) {
		await showNotice(ctx, "Invalid secret", "VM env var name must look like GITHUB_TOKEN.", "error");
		return undefined;
	}
	const valueLabel = current ? "Secret value (leave empty to keep current)" : "Secret value";
	const inputValue = (await ctx.ui.input(valueLabel, "")) ?? "";
	const secretValue = inputValue.length > 0 ? inputValue : current?.value;
	if (!secretValue) return undefined;
	const hostsRaw = (
		await ctx.ui.input("Allowed hosts (comma separated)", (current?.hosts ?? ["api.github.com"]).join(", "))
	)?.trim();
	if (!hostsRaw) return undefined;
	const hosts = hostsRaw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (hosts.length === 0) {
		await showNotice(ctx, "Invalid secret", "At least one host is required.", "error");
		return undefined;
	}
	return { name: secretName, secret: { value: secretValue, hosts } };
}

async function configureSecrets(
	ctx: ExtensionContext,
	title: string,
	config: GondolinConfig | undefined,
	onSave: (next: GondolinConfig | undefined) => Promise<void>,
): Promise<void> {
	let current: GondolinConfig = { secrets: { ...(config?.secrets ?? {}) } };
	while (true) {
		const secrets = current.secrets ?? {};
		const choice = await selectItem(ctx, title, [
			{ value: "__add__", label: "+ Add secret", description: "Expose a placeholder env var inside Gondolin" },
			...Object.entries(secrets)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, secret]) => ({
					value: name,
					label: name,
					description: secret.hosts.join(", "),
				})),
			{ value: "__save__", label: "Save" },
			{ value: "__back__", label: "Back" },
		]);
		if (!choice || choice === "__back__") return;
		if (choice === "__save__") {
			const next = Object.keys(current.secrets ?? {}).length > 0 ? current : undefined;
			await onSave(next);
			return;
		}
		if (choice === "__add__") {
			const draft = await promptSecretDraft(ctx);
			if (!draft) continue;
			current = { ...current, secrets: { ...(current.secrets ?? {}), [draft.name]: draft.secret } };
			continue;
		}
		const existing = current.secrets?.[choice];
		if (!existing) continue;
		const action = await selectItem(ctx, choice, [
			{ value: "edit", label: "Edit" },
			{ value: "delete", label: "Delete" },
			{ value: "back", label: "Back" },
		]);
		if (!action || action === "back") continue;
		if (action === "delete") {
			const nextSecrets = { ...(current.secrets ?? {}) };
			delete nextSecrets[choice];
			current = { ...current, secrets: nextSecrets };
			continue;
		}
		const draft = await promptSecretDraft(ctx, choice, existing);
		if (!draft) continue;
		const nextSecrets = { ...(current.secrets ?? {}) };
		if (draft.name !== choice) delete nextSecrets[choice];
		nextSecrets[draft.name] = draft.secret;
		current = { ...current, secrets: nextSecrets };
	}
}

async function promptAccessPolicy(
	ctx: ExtensionContext,
	current: AccessPolicy,
	snapshot: DiscoverySnapshot | undefined,
	dm: boolean,
): Promise<AccessPolicy | undefined> {
	let policy: AccessPolicy = { ...current };
	while (true) {
		const choice = await selectItem(ctx, "Access policy", [
			{ value: "trigger", label: `Trigger: ${policy.trigger ?? (dm ? "message" : "mention")}` },
			{ value: "bots", label: `Ignore bots: ${(policy.ignoreBots ?? true) ? "yes" : "no"}` },
			{ value: "users", label: `Allowed users: ${policy.allowedUserIds?.length ?? 0}` },
			{ value: "save", label: "Save" },
			{ value: "cancel", label: "Cancel" },
		]);
		if (!choice || choice === "cancel") return undefined;
		if (choice === "save") return policy;
		if (choice === "trigger") {
			const selected = await selectItem(ctx, "Trigger mode", [
				{ value: "mention", label: "Mention", description: "Only @mentions create jobs" },
				{
					value: "message",
					label: "Message",
					description: dm ? "Every DM message creates a job" : "Every matching message creates a job",
				},
			]);
			if (selected) policy = { ...policy, trigger: selected as AccessPolicy["trigger"] };
			continue;
		}
		if (choice === "bots") {
			policy = {
				...policy,
				ignoreBots: await ctx.ui.confirm(
					"Ignore bot messages",
					`Current value: ${(policy.ignoreBots ?? true) ? "yes" : "no"}`,
				),
			};
			continue;
		}
		if (choice === "users") {
			const items = toUserToggleItems(snapshot?.users ?? [], policy.allowedUserIds ?? []);
			if (items.length === 0) {
				await showNotice(ctx, "No discovered users", "No discovered users available for this account.", "warning");
				continue;
			}
			const selected = await toggleItems(ctx, "Allowed users", items, policy.allowedUserIds ?? []);
			if (selected) policy = { ...policy, allowedUserIds: selected.length > 0 ? selected : undefined };
		}
	}
}

async function configureConfiguredChannel(
	ctx: ExtensionContext,
	config: ChatConfig,
	accountId: string,
	channelKey: string,
): Promise<void> {
	const account = config.accounts[accountId];
	const channel = account?.channels[channelKey];
	if (!account || !channel) return;
	const snapshot = await loadDiscoverySnapshot(accountId);
	while (true) {
		const choice = await selectItem(ctx, `${accountId}/${channelKey}`, [
			{ value: "access", label: "Edit access policy" },
			{ value: "secrets", label: "Secrets", description: secretSummary(channel.gondolin) },
			{ value: "delete", label: "Delete channel", description: "Remove this configured channel" },
			{ value: "back", label: "Back" },
		]);
		if (!choice || choice === "back") return;
		if (choice === "access") {
			const access = await promptAccessPolicy(
				ctx,
				channel.access ?? defaultAccess(channel.dm ?? false),
				snapshot,
				channel.dm ?? false,
			);
			if (!access) continue;
			channel.access = access;
			account.channels[channelKey] = channel;
			await saveChatConfig(config);
			await showNotice(ctx, "Channel updated", `Updated ${accountId}/${channelKey}`, "info");
			continue;
		}
		if (choice === "secrets") {
			await configureSecrets(ctx, `${accountId}/${channelKey} secrets`, channel.gondolin, async (next) => {
				channel.gondolin = next;
				account.channels[channelKey] = channel;
				await saveChatConfig(config);
			});
			continue;
		}
		if (choice === "delete") {
			const ok = await ctx.ui.confirm("Delete configured channel", `Delete ${accountId}/${channelKey}?`);
			if (!ok) continue;
			delete account.channels[channelKey];
			await saveChatConfig(config);
			await removeChannelStorage(accountId, channelKey, ctx.cwd);
			await showNotice(ctx, "Channel deleted", `Deleted ${accountId}/${channelKey}`, "info");
			return;
		}
	}
}

function remoteMcpSummary(remoteMcp: Record<string, string[]> | undefined): string {
	const servers = Object.keys(remoteMcp ?? {});
	if (servers.length === 0) return "none — MCP unavailable in connected sessions";
	const tools = Object.values(remoteMcp ?? {}).flat().length;
	return `${servers.length} server${servers.length === 1 ? "" : "s"}, ${tools} tool${tools === 1 ? "" : "s"}`;
}

async function configureRemoteMcp(
	ctx: ExtensionContext,
	title: string,
	current: Record<string, string[]> | undefined,
	save: (next: Record<string, string[]> | undefined) => Promise<void>,
): Promise<void> {
	while (true) {
		const choice = await selectItem(ctx, title, [
			...Object.entries(current ?? {}).map(([server, tools]) => ({
				value: server,
				label: server,
				description: tools.join(", "),
			})),
			{ value: "__add__", label: "Add server", description: "Server name as configured in the session's mcp.json" },
			{ value: "__back__", label: "Back" },
		]);
		if (!choice || choice === "__back__") return;
		let server = choice;
		if (choice === "__add__") {
			const name = (await ctx.ui.input("MCP server name", "e.g. brave-search"))?.trim();
			if (!name) continue;
			if (!/^[A-Za-z0-9_-]+$/.test(name)) {
				await showNotice(ctx, "Invalid server name", "Use letters, digits, dashes, underscores", "warning");
				continue;
			}
			server = name;
		}
		const toolsInput = await ctx.ui.input(
			`Tools of "${server}" (comma-separated, empty removes the server)`,
			(current?.[server] ?? []).join(", "),
		);
		if (toolsInput === undefined) continue;
		const tools = toolsInput
			.split(",")
			.map((tool) => tool.trim())
			.filter(Boolean);
		if (tools.some((tool) => tool.includes("*"))) {
			await showNotice(ctx, "Wildcard not supported", "List explicit tool names only", "warning");
			continue;
		}
		const next = { ...(current ?? {}) };
		if (tools.length === 0) delete next[server];
		else next[server] = tools;
		const saved = Object.keys(next).length > 0 ? next : undefined;
		await save(saved);
		current = saved;
	}
}

async function configureTelegramAccount(ctx: ExtensionContext, accountId: string): Promise<void> {
	while (true) {
		const config = await loadChatConfig();
		const account = config.accounts[accountId] as TelegramAccountConfig | undefined;
		if (!account || account.service !== "telegram") return;
		const channelChoices = Object.entries(account.channels).map(([key, channel]) => ({
			value: key,
			label: key,
			description: `${channel.name ?? channel.id}${
				channel.dm ? " • dm" : channel.threadId !== undefined ? ` • topic ${channel.threadId}` : " • group"
			}`,
		}));
		const choice = await selectItem(ctx, `${accountId} (@${account.botUsername ?? "bot"})`, [
			{ value: "secrets", label: "Secrets", description: secretSummary(account.gondolin) },
			{ value: "remote-mcp", label: "Remote MCP", description: remoteMcpSummary(account.remoteMcp) },
			{ value: "add-dm", label: "Add DM", description: "Pair a DM by sending /start to the bot" },
			{ value: "add-group", label: "Add group", description: "Observe activity after adding the bot to a group" },
			{
				value: "add-topic",
				label: "Add topic (observe)",
				description: "Post any message in a forum topic; its thread id gets picked up",
			},
			{
				value: "create-topic",
				label: "Create topic (bot)",
				description: 'Bot creates a topic (needs admin right "Manage Topics")',
			},
			{ value: "refresh", label: "Refresh bot info" },
			{ value: "delete", label: "Delete account", description: "Remove account and all configured channels" },
			...channelChoices,
			{ value: "back", label: "Back" },
		]);
		if (!choice || choice === "back") return;
		if (choice === "secrets") {
			await configureSecrets(ctx, `${accountId} secrets`, account.gondolin, async (next) => {
				account.gondolin = next;
				config.accounts[accountId] = account;
				await saveChatConfig(config);
			});
			continue;
		}
		if (choice === "remote-mcp") {
			await configureRemoteMcp(
				ctx,
				`${accountId} remote MCP (server → allowed tools)`,
				account.remoteMcp,
				async (next) => {
					account.remoteMcp = next;
					config.accounts[accountId] = account;
					await saveChatConfig(config);
				},
			);
			continue;
		}
		if (choice === "add-dm") {
			await addTelegramObservedTargetToAccount(ctx, config, accountId, account, "dm");
			continue;
		}
		if (choice === "add-group") {
			await addTelegramObservedTargetToAccount(ctx, config, accountId, account, "group");
			continue;
		}
		if (choice === "add-topic") {
			await addTelegramObservedTargetToAccount(ctx, config, accountId, account, "topic");
			continue;
		}
		if (choice === "create-topic") {
			await createTelegramTopicChannel(ctx, config, accountId, account);
			continue;
		}
		if (choice === "refresh") {
			const fresh = await refreshAccountSnapshot(accountId, account);
			config.accounts[accountId] = updateAccountIdentityFromSnapshot(account, fresh);
			await saveChatConfig(config);
			continue;
		}
		if (choice === "delete") {
			const ok = await ctx.ui.confirm("Delete account", `Delete ${accountId} and all configured channels?`);
			if (!ok) continue;
			delete config.accounts[accountId];
			await saveChatConfig(config);
			await removeAccountStorage(accountId, ctx.cwd);
			await showNotice(ctx, "Account deleted", `Deleted ${accountId}`, "info");
			return;
		}
		await configureConfiguredChannel(ctx, config, accountId, choice);
	}
}

async function configureAccount(ctx: ExtensionContext, accountId: string): Promise<void> {
	const config = await loadChatConfig();
	const account = config.accounts[accountId];
	if (!account) return;
	if (account.service === "telegram") return configureTelegramAccount(ctx, accountId);
}

export async function runChatConfigUI(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(CHAT_CONFIG_PATH, "info");
		return;
	}
	while (true) {
		const config = await loadChatConfig();
		const snapshots = await Promise.all(
			Object.keys(config.accounts)
				.sort()
				.map(async (accountId) => ({ accountId, snapshot: await loadDiscoverySnapshot(accountId) })),
		);
		const choice = await selectItem(ctx, "pi-chat accounts", [
			{ value: "__secrets__", label: "Secrets", description: secretSummary(config.gondolin) },
			...snapshots.map(({ accountId, snapshot }) => ({
				value: accountId,
				label: accountId,
				description: accountDescription(config.accounts[accountId], snapshot),
			})),
			{ value: "__create__", label: "+ Create account", description: "Create a Telegram bot account" },
		]);
		if (!choice) return;
		if (choice === "__secrets__") {
			await configureSecrets(ctx, "pi-chat secrets", config.gondolin, async (next) => {
				config.gondolin = next;
				await saveChatConfig(config);
			});
			continue;
		}
		if (choice === "__create__") {
			const accountId = await createTelegramAccountWithGuidedSetup(ctx, config);
			if (accountId) await configureAccount(ctx, accountId);
			continue;
		}
		await configureAccount(ctx, choice);
	}
}
