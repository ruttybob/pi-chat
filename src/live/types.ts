import type { ResolvedConversation } from "../core/config-types.js";

export interface LiveConnection {
	conversation: ResolvedConversation;
	disconnect(): Promise<void>;
	sendImmediate(text: string, replyToMessageId?: string): Promise<string | undefined>;
	send(
		text: string,
		attachmentPaths?: string[],
		signal?: AbortSignal,
		replyToMessageId?: string,
	): Promise<string | undefined>;
	startTyping(status?: string): Promise<void>;
	stopTyping(): Promise<void>;
	syncPreview(markdown: string, done?: boolean): Promise<string[]>;
	clearPreview(): Promise<void>;
	setReplyTo(messageId: string | undefined): void;
}
