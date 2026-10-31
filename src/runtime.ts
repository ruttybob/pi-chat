import { randomUUID } from "node:crypto";

import type {
	ChatLogRecord,
	ConversationStatus,
	DispatchableJob,
	InboundMessageInput,
	InboundMessageRecord,
	JobQueuedRecord,
	PendingJob,
	ResolvedConversation,
} from "../types.js";
import {
	acquireConversationLock,
	appendConversationRecord,
	buildBaseRecordFields,
	ensureConversationDirs,
	materializeAttachments,
	nextMessageId,
	normalizeInboundMessage,
	readConversationLog,
	readLogTailRecords,
	releaseConversationLock,
	withAppendLock,
} from "./log.js";

function isDMConversation(conversation: ResolvedConversation): boolean {
	return conversation.channel.dm ?? false;
}

function toGuestDisplayPath(conversation: ResolvedConversation, localPath: string): string {
	if (localPath === conversation.workspaceDir || localPath.startsWith(`${conversation.workspaceDir}/`)) {
		const suffix = localPath.slice(conversation.workspaceDir.length).replace(/^\//, "");
		return suffix ? `/workspace/${suffix}` : "/workspace";
	}
	if (localPath === conversation.sharedDir || localPath.startsWith(`${conversation.sharedDir}/`)) {
		const suffix = localPath.slice(conversation.sharedDir.length).replace(/^\//, "");
		return suffix ? `/shared/${suffix}` : "/shared";
	}
	return localPath;
}

function formatTranscriptRecord(conversation: ResolvedConversation, record: ChatLogRecord): string[] {
	if (record.type !== "inbound") return [];
	const lines = [
		`- [${record.timestamp}] [uid:${record.userId}] ${record.userName ?? "unknown"}: ${record.text || "(no text)"}`,
	];
	if (record.attachments.length > 0) {
		lines.push("  attachments:");
		for (const attachment of record.attachments)
			lines.push(
				`  - ${toGuestDisplayPath(conversation, attachment.localPath)}${attachment.mimeType ? ` (${attachment.mimeType})` : ""}`,
			);
	}
	return lines;
}

function getLatestTriggerRecord(records: ChatLogRecord[], job: PendingJob): InboundMessageRecord | undefined {
	const triggerRecord = records.find((record) => record.recordId === job.triggerRecordId);
	if (!triggerRecord || triggerRecord.type !== "inbound") return undefined;
	return triggerRecord;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ConversationRuntime {
	readonly conversation: ResolvedConversation;
	private readonly ownerId: string;
	private records: ChatLogRecord[] = [];
	private nextRecordId = 1;
	private pendingJobs: PendingJob[] = [];
	private activeJob: PendingJob | undefined;
	private armedAfterRecordId: number | undefined;

	constructor(conversation: ResolvedConversation, ownerId: string) {
		this.conversation = conversation;
		this.ownerId = ownerId;
	}

	static async connect(conversation: ResolvedConversation, ownerId: string): Promise<ConversationRuntime> {
		const runtime = new ConversationRuntime(conversation, ownerId);
		await runtime.initialize();
		return runtime;
	}

	private async initialize(): Promise<void> {
		await ensureConversationDirs(this.conversation);
		await acquireConversationLock(this.conversation, this.ownerId);
		this.records = await readConversationLog(this.conversation);
		this.nextRecordId = this.records.reduce((max, record) => Math.max(max, record.recordId), 0) + 1;
	}

	armAfterCurrentTail(): void {
		this.armedAfterRecordId = this.records.at(-1)?.recordId ?? 0;
	}

	isArmed(): boolean {
		return this.armedAfterRecordId !== undefined;
	}

	async disconnect(): Promise<void> {
		await releaseConversationLock(this.conversation);
	}

	// Single-writer guarantee: the account feed leader (another process) also appends
	// remote inbound records, so allocate recordId under the append lock from the log tail.
	private async appendRecord(record: ChatLogRecord): Promise<ChatLogRecord> {
		return withAppendLock(this.conversation, this.ownerId, async () => {
			const tail = await readLogTailRecords(this.conversation.logPath);
			const tailMax = tail.reduce((max, item) => Math.max(max, item.recordId), 0);
			const stored: ChatLogRecord = { ...record, recordId: Math.max(tailMax + 1, this.nextRecordId) };
			this.records.push(stored);
			this.nextRecordId = stored.recordId + 1;
			await appendConversationRecord(this.conversation, stored);
			return stored;
		});
	}

	private getLastQueuedTriggerRecordId(): number {
		let last = 0;
		for (const record of this.records) {
			if (record.type === "job_queued") last = Math.max(last, record.triggerRecordId);
		}
		return last;
	}

	private getLastCompletedTriggerRecordId(): number {
		let last = 0;
		for (const record of this.records) {
			if (record.type !== "job_completed") continue;
			last = Math.max(last, record.triggerRecordId);
		}
		return last;
	}

	private isAllowedInput(message: Pick<InboundMessageInput, "userId" | "isBot">): boolean {
		const access = this.conversation.access;
		if ((message.isBot ?? false) && (access.ignoreBots ?? true)) return false;
		if (access.allowedUserIds?.length && !access.allowedUserIds.includes(message.userId)) return false;
		return true;
	}

	private isAllowedMessage(message: InboundMessageRecord): boolean {
		return this.isAllowedInput(message);
	}

	parseControlCommand(input: InboundMessageInput): "stop" | "new" | "compact" | "status" | undefined {
		const normalized = normalizeInboundMessage(input, this.conversation.botName);
		if (!this.isAllowedInput(normalized)) return undefined;
		const account = this.conversation.account;
		let text = normalized.text;
		const botUserId = "botUserId" in account ? account.botUserId : undefined;
		if (botUserId) text = text.replace(new RegExp(`<@!?${escapeRegExp(botUserId)}>`, "g"), " ");
		const aliases = [this.conversation.botName, "botUsername" in account ? account.botUsername : undefined].filter(
			Boolean,
		);
		for (const alias of aliases) text = text.replace(new RegExp(`@${escapeRegExp(alias || "")}\\b`, "ig"), " ");
		const command = text.replace(/\s+/g, " ").trim().toLowerCase();
		if (command === "stop" || command === "/stop") return "stop";
		if (command === "new" || command === "/new") return "new";
		if (command === "compact" || command === "/compact") return "compact";
		if (command === "status" || command === "/status") return "status";
		return undefined;
	}

	matchesStopCommand(input: InboundMessageInput): boolean {
		return this.parseControlCommand(input) === "stop";
	}

	private shouldTriggerJob(message: InboundMessageRecord): false | "mention" | "dm" {
		if (!this.isAllowedMessage(message)) return false;
		if (isDMConversation(this.conversation)) return "dm";
		if ((this.conversation.access.trigger ?? "mention") === "message") return "mention";
		return message.mentionedBot ? "mention" : false;
	}

	private shouldQueueTrigger(recordId: number): boolean {
		if (this.armedAfterRecordId === undefined) return false;
		return recordId > Math.max(this.armedAfterRecordId, this.getLastQueuedTriggerRecordId());
	}

	private async queueTrigger(record: InboundMessageRecord): Promise<boolean> {
		const trigger = this.shouldTriggerJob(record);
		if (!trigger || !this.shouldQueueTrigger(record.recordId)) return false;
		const queuedRecord = (await this.appendRecord({
			type: "job_queued",
			...buildBaseRecordFields(this.conversation, 0),
			jobId: randomUUID(),
			trigger,
			triggerRecordId: record.recordId,
		})) as JobQueuedRecord;
		this.pendingJobs.push({
			jobId: queuedRecord.jobId,
			trigger: queuedRecord.trigger,
			triggerRecordId: queuedRecord.triggerRecordId,
			queuedRecordId: queuedRecord.recordId,
		});
		return true;
	}

	async ingestInbound(input: InboundMessageInput): Promise<{ record: InboundMessageRecord; jobQueued: boolean }> {
		const normalized = normalizeInboundMessage(input, this.conversation.botName);
		const messageId = normalized.messageId || nextMessageId(this.conversation.service);
		const attachments = await materializeAttachments(this.conversation, messageId, normalized.attachments);
		const stored = (await this.appendRecord({
			type: "inbound",
			...buildBaseRecordFields(this.conversation, 0),
			messageId,
			userId: normalized.userId,
			userName: normalized.userName,
			text: normalized.text,
			mentionedBot: normalized.mentionedBot ?? false,
			isBot: normalized.isBot ?? false,
			attachments,
		})) as InboundMessageRecord;
		const jobQueued = await this.queueTrigger(stored);
		return { record: stored, jobQueued };
	}

	// Absorb records appended by the account feed leader (remote inbound for this
	// conversation). Returns true when new jobs were queued.
	async absorbExternalRecords(): Promise<boolean> {
		const fresh = await readConversationLog(this.conversation);
		if (fresh.length <= this.records.length) return false;
		const known = new Set(this.records.map((record) => record.recordId));
		const incoming = fresh.filter(
			(record): record is InboundMessageRecord => record.type === "inbound" && !known.has(record.recordId),
		);
		this.records = fresh;
		this.nextRecordId = Math.max(
			this.nextRecordId,
			fresh.reduce((max, record) => Math.max(max, record.recordId), 0) + 1,
		);
		let changed = false;
		for (const record of incoming) {
			if (record.type !== "inbound") continue;
			if (await this.queueTrigger(record)) changed = true;
		}
		return changed;
	}

	beginNextJob(): DispatchableJob | undefined {
		if (this.activeJob || this.pendingJobs.length === 0) return undefined;
		const job = this.pendingJobs.shift();
		if (!job) return undefined;
		this.activeJob = job;
		const triggerRecord = getLatestTriggerRecord(this.records, job);
		return { job, prompt: this.buildPrompt(job), triggerMessageId: triggerRecord?.messageId };
	}

	private buildPrompt(job: PendingJob): string {
		const completedBoundary = this.getLastCompletedTriggerRecordId();
		const slice = this.records.filter(
			(record) =>
				record.recordId > completedBoundary && record.recordId <= job.triggerRecordId && record.type === "inbound",
		);
		const lines: string[] = [];
		for (const record of slice) lines.push(...formatTranscriptRecord(this.conversation, record));
		return lines.join("\n").trim();
	}

	async completeActiveJob(text: string, remoteMessageId?: string, attachmentPaths?: string[]): Promise<void> {
		const job = this.activeJob;
		if (!job) return;
		let outboundRecordId: number | undefined;
		const trimmed = text.trim();
		if (trimmed.length > 0 || (attachmentPaths?.length ?? 0) > 0) {
			const triggerRecord = getLatestTriggerRecord(this.records, job);
			const outbound = (await this.appendRecord({
				type: "outbound",
				...buildBaseRecordFields(this.conversation, 0),
				messageId: remoteMessageId || nextMessageId(this.conversation.service),
				text: trimmed,
				replyToMessageId: triggerRecord?.messageId,
				jobId: job.jobId,
				attachments: attachmentPaths?.length ? [...attachmentPaths] : undefined,
			})) as { recordId: number };
			outboundRecordId = outbound.recordId;
		}
		await this.appendRecord({
			type: "job_completed",
			...buildBaseRecordFields(this.conversation, 0),
			jobId: job.jobId,
			triggerRecordId: job.triggerRecordId,
			outboundRecordId,
		});
		this.activeJob = undefined;
	}

	async failActiveJob(error: string): Promise<void> {
		const job = this.activeJob;
		if (!job) return;
		await this.appendRecord({
			type: "job_failed",
			...buildBaseRecordFields(this.conversation, 0),
			jobId: job.jobId,
			triggerRecordId: job.triggerRecordId,
			error,
		});
		this.activeJob = undefined;
	}

	async appendError(message: string): Promise<void> {
		await this.appendRecord({ type: "error", ...buildBaseRecordFields(this.conversation, 0), message });
	}

	findHistory(options: { query?: string; after?: string; before?: string; limit?: number }): Array<ChatLogRecord> {
		const query = options.query?.toLowerCase();
		const after = options.after ? Date.parse(options.after) : undefined;
		const before = options.before ? Date.parse(options.before) : undefined;
		const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
		const filtered = this.records.filter((record) => {
			if (record.type !== "inbound" && record.type !== "outbound") return false;
			const ts = Date.parse(record.timestamp);
			if (after !== undefined && !(ts >= after)) return false;
			if (before !== undefined && !(ts <= before)) return false;
			if (!query) return true;
			const speaker = record.type === "inbound" ? (record.userName ?? record.userId) : "assistant";
			return `${speaker}\n${record.text}`.toLowerCase().includes(query);
		});
		return filtered.slice(Math.max(0, filtered.length - limit));
	}

	getStatus(): ConversationStatus {
		return {
			conversationId: this.conversation.conversationId,
			conversationName: this.conversation.conversationName,
			logPath: this.conversation.logPath,
			queueLength: this.pendingJobs.length,
			hasActiveJob: this.activeJob !== undefined,
			recordCount: this.records.length,
			lastRecordId: this.records.at(-1)?.recordId ?? 0,
		};
	}
}
