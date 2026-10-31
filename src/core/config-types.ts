export type ChatService = "telegram";

export type TriggerMode = "mention" | "message";

export interface AccessPolicy {
	trigger?: TriggerMode;
	ignoreBots?: boolean;
	allowedUserIds?: string[];
}

export interface GondolinSecretConfig {
	value: string;
	hosts: string[];
}

export interface GondolinMountConfig {
	/** Absolute host directory to expose inside the VM (~ is expanded). */
	hostPath: string;
	/** Guest path; default /workspace/<folder name> (must be under /workspace or /shared). */
	guestPath?: string;
	/** Default true — the VM cannot write to the host folder. */
	readOnly?: boolean;
}

export interface GondolinConfig {
	secrets?: Record<string, GondolinSecretConfig>;
	mounts?: GondolinMountConfig[];
}

export interface ConfiguredChannel {
	id: string;
	name?: string;
	dm?: boolean;
	/** Forum topic (message_thread_id) in a supergroup with Topics enabled; General = 1. */
	threadId?: number;
	/** Tool whitelist for remote turns; undefined = all tools allowed. */
	tools?: string[];
	access?: AccessPolicy;
	gondolin?: GondolinConfig;
}

export interface BaseAccountConfig {
	service: ChatService;
	name?: string;
	access?: AccessPolicy;
	gondolin?: GondolinConfig;
	channels: Record<string, ConfiguredChannel>;
}

export interface TelegramAccountConfig extends BaseAccountConfig {
	service: "telegram";
	botToken: string;
	botUsername?: string;
	botUserId?: string;
}

export type ChatAccountConfig = TelegramAccountConfig;

export interface ChatConfig {
	botName?: string;
	gondolin?: GondolinConfig;
	accounts: Record<string, ChatAccountConfig>;
}

export interface ResolvedConversation {
	service: ChatService;
	botName: string;
	accountId: string;
	account: ChatAccountConfig;
	channelKey: string;
	channel: ConfiguredChannel;
	threadId?: number;
	conversationId: string;
	conversationName: string;
	access: AccessPolicy;
	gondolinSecrets: Record<string, GondolinSecretConfig>;
	accountDir: string;
	sharedDir: string;
	conversationDir: string;
	workspaceDir: string;
	gondolinDir: string;
	accountMemoryPath: string;
	channelMemoryPath: string;
	logPath: string;
	filesDir: string;
	lockPath: string;
}
