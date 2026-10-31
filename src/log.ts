import { appendFile, copyFile, lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import type {
	AttachmentInput,
	AttachmentKind,
	ChatLogRecord,
	InboundMessageInput,
	InboundMessageRecord,
	ResolvedConversation,
	StoredAttachment,
} from "../types.js";

function guessAttachmentKind(path: string): AttachmentKind {
	const ext = extname(path).toLowerCase();
	if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
	if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) return "audio";
	if ([".mp4", ".mov", ".webm"].includes(ext)) return "video";
	return "file";
}

function guessMimeType(path: string): string | undefined {
	const ext = extname(path).toLowerCase();
	if (ext === ".png") return "image/png";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".gif") return "image/gif";
	if (ext === ".webp") return "image/webp";
	if (ext === ".mp3") return "audio/mpeg";
	if (ext === ".wav") return "audio/wav";
	if (ext === ".ogg") return "audio/ogg";
	if (ext === ".mp4") return "video/mp4";
	if (ext === ".json") return "application/json";
	if (ext === ".md") return "text/markdown";
	if (ext === ".txt" || ext === ".log") return "text/plain";
	return undefined;
}

function sanitizeFileName(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function ensureRegularFile(path: string): Promise<void> {
	try {
		const info = await lstat(path);
		if (!info.isSymbolicLink()) return;
		await unlink(path);
		await writeFile(path, "", "utf8");
	} catch {
		await writeFile(path, "", { flag: "a" });
	}
}

function isInside(root: string, value: string): boolean {
	const rel = relative(resolve(root), resolve(value));
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

export async function ensureConversationDirs(conversation: ResolvedConversation): Promise<void> {
	await mkdir(conversation.accountDir, { recursive: true });
	await mkdir(conversation.sharedDir, { recursive: true });
	await mkdir(conversation.conversationDir, { recursive: true });
	await mkdir(dirname(conversation.logPath), { recursive: true });
	await mkdir(dirname(conversation.lockPath), { recursive: true });
	await mkdir(conversation.workspaceDir, { recursive: true });
	await mkdir(conversation.gondolinDir, { recursive: true });
	await mkdir(conversation.filesDir, { recursive: true });
	await ensureRegularFile(conversation.accountMemoryPath);
	await ensureRegularFile(conversation.channelMemoryPath);
}

export async function readConversationLog(conversation: ResolvedConversation): Promise<ChatLogRecord[]> {
	try {
		const content = await readFile(conversation.logPath, "utf8");
		return content
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ChatLogRecord)
			.sort((a, b) => a.recordId - b.recordId);
	} catch {
		return [];
	}
}

export async function appendConversationRecord(
	conversation: ResolvedConversation,
	record: ChatLogRecord,
): Promise<void> {
	await ensureConversationDirs(conversation);
	await appendFile(conversation.logPath, `${JSON.stringify(record)}\n`, "utf8");
}

function extractOwnerPid(owner: string): number | undefined {
	const match = owner.match(/^pi-chat-(\d+)-/);
	if (!match) return undefined;
	const pid = Number(match[1]);
	return Number.isFinite(pid) ? pid : undefined;
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : undefined;
		return code === "EPERM";
	}
}

export async function acquireConversationLock(conversation: ResolvedConversation, owner: string): Promise<void> {
	await ensureConversationDirs(conversation);
	try {
		const handle = await open(conversation.lockPath, "wx");
		try {
			await handle.writeFile(`${owner}\n`, "utf8");
		} finally {
			await handle.close();
		}
		return;
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : undefined;
		if (code !== "EEXIST") throw error;
	}
	const existingOwner = (await readFile(conversation.lockPath, "utf8")).trim();
	const existingPid = extractOwnerPid(existingOwner);
	if (existingPid !== undefined && !isPidAlive(existingPid)) {
		await unlink(conversation.lockPath).catch(() => undefined);
		const handle = await open(conversation.lockPath, "wx");
		try {
			await handle.writeFile(`${owner}\n`, "utf8");
		} finally {
			await handle.close();
		}
		return;
	}
	throw new Error(`Conversation is already locked by ${existingOwner || "another pi-chat session"}`);
}

export async function releaseConversationLock(conversation: ResolvedConversation): Promise<void> {
	await unlink(conversation.lockPath).catch(() => undefined);
}

export async function materializeAttachments(
	conversation: ResolvedConversation,
	messageId: string,
	attachments: AttachmentInput[] | undefined,
): Promise<StoredAttachment[]> {
	if (!attachments?.length) return [];
	await ensureConversationDirs(conversation);
	const stored: StoredAttachment[] = [];
	for (const [index, attachment] of attachments.entries()) {
		const fileStats = await lstat(attachment.path);
		if (!fileStats.isFile()) throw new Error(`Attachment is not a regular file: ${attachment.path}`);
		const fileName = sanitizeFileName(attachment.name || basename(attachment.path));
		const targetPath = isInside(conversation.filesDir, attachment.path)
			? attachment.path
			: join(conversation.filesDir, `${Date.now()}-${messageId}-${index + 1}-${fileName}`);
		if (targetPath !== attachment.path) await copyFile(attachment.path, targetPath);
		stored.push({
			kind: attachment.kind || guessAttachmentKind(attachment.path),
			name: fileName,
			mimeType: attachment.mimeType || guessMimeType(attachment.path),
			size: fileStats.size,
			remoteUrl: attachment.remoteUrl,
			originalPath: targetPath === attachment.path ? undefined : attachment.path,
			localPath: targetPath,
		});
	}
	return stored;
}

export function buildBaseRecordFields(conversation: ResolvedConversation, recordId: number) {
	return {
		recordId,
		timestamp: new Date().toISOString(),
		service: conversation.service,
		accountId: conversation.accountId,
		channelKey: conversation.channelKey,
		channelId: conversation.channel.id,
		scope: "channel" as const,
	};
}

export function nextMessageId(service: string): string {
	return `${service}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeInboundMessage(input: InboundMessageInput, botName: string): InboundMessageInput {
	const text = input.text.trim();
	const mentionPattern = new RegExp(`@${botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
	return { ...input, text, mentionedBot: input.mentionedBot ?? mentionPattern.test(text), isBot: input.isBot ?? false };
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function acquireFileLock(path: string, owner: string): Promise<boolean> {
	try {
		const handle = await open(path, "wx");
		try {
			await handle.writeFile(`${owner}\n`, "utf8");
		} finally {
			await handle.close();
		}
		return true;
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : undefined;
		if (code !== "EEXIST") throw error;
	}
	const existingOwner = (await readFile(path, "utf8").catch(() => "")).trim();
	const existingPid = extractOwnerPid(existingOwner);
	if (existingPid === undefined || isPidAlive(existingPid)) return false;
	await unlink(path).catch(() => undefined);
	try {
		const handle = await open(path, "wx");
		try {
			await handle.writeFile(`${owner}\n`, "utf8");
		} finally {
			await handle.close();
		}
		return true;
	} catch {
		return false;
	}
}

export async function releaseFileLock(path: string): Promise<void> {
	await unlink(path).catch(() => undefined);
}

export async function readLogTailRecords(logPath: string, bytes = 16384): Promise<ChatLogRecord[]> {
	try {
		const handle = await open(logPath, "r");
		try {
			const size = (await handle.stat()).size;
			const start = Math.max(0, size - bytes);
			const buffer = Buffer.alloc(size - start);
			await handle.read(buffer, 0, buffer.length, start);
			const lines = buffer.toString("utf8").split("\n").filter(Boolean);
			if (start > 0) lines.shift();
			const records: ChatLogRecord[] = [];
			for (const line of lines) {
				try {
					records.push(JSON.parse(line) as ChatLogRecord);
				} catch {
					// Skip malformed tail lines.
				}
			}
			return records;
		} finally {
			await handle.close();
		}
	} catch {
		return [];
	}
}

export async function withAppendLock<T>(
	conversation: ResolvedConversation,
	owner: string,
	fn: () => Promise<T>,
): Promise<T> {
	// The account-level feed leader may fan out an inbound message to a channel whose worker/storage was never initialized (e.g. auto-registered forum topic).
	await ensureConversationDirs(conversation);
	const path = `${conversation.lockPath}.append`;
	for (let attempt = 0; ; attempt++) {
		if (await acquireFileLock(path, owner)) {
			try {
				return await fn();
			} finally {
				await releaseFileLock(path);
			}
		}
		if (attempt >= 100) throw new Error(`Append lock busy: ${path}`);
		await sleep(20);
	}
}

// Remote inbound from the account feed leader: allocates a recordId under the
// append lock so the conversation worker (a different process) can absorb it later.
export async function appendRemoteInbound(
	conversation: ResolvedConversation,
	owner: string,
	input: InboundMessageInput,
): Promise<InboundMessageRecord | undefined> {
	return withAppendLock(conversation, owner, async () => {
		const tail = await readLogTailRecords(conversation.logPath);
		if (input.messageId && tail.some((record) => record.type === "inbound" && record.messageId === input.messageId))
			return undefined;
		const maxId = tail.reduce((max, record) => Math.max(max, record.recordId), 0);
		const normalized = normalizeInboundMessage(input, conversation.botName);
		const messageId = normalized.messageId || nextMessageId(conversation.service);
		const attachments = await materializeAttachments(conversation, messageId, normalized.attachments);
		const record: InboundMessageRecord = {
			type: "inbound",
			...buildBaseRecordFields(conversation, maxId + 1),
			messageId,
			userId: normalized.userId,
			userName: normalized.userName,
			text: normalized.text,
			mentionedBot: normalized.mentionedBot ?? false,
			isBot: normalized.isBot ?? false,
			attachments,
		};
		await appendConversationRecord(conversation, record);
		return record;
	});
}

// Feed fan-out error for this channel: same cross-process recordId allocation as
// appendRemoteInbound, so the worker sees it even before its first connect.
export async function appendRemoteError(
	conversation: ResolvedConversation,
	owner: string,
	message: string,
): Promise<void> {
	await withAppendLock(conversation, owner, async () => {
		const tail = await readLogTailRecords(conversation.logPath);
		const maxId = tail.reduce((max, record) => Math.max(max, record.recordId), 0);
		await appendConversationRecord(conversation, {
			type: "error",
			...buildBaseRecordFields(conversation, maxId + 1),
			message,
		});
	});
}
