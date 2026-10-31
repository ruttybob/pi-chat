# pi-chat

A pi extension that bridges **Telegram** to a sandboxed pi session. Each connected chat gets its own [Gondolin](https://github.com/earendil-works/gondolin) micro-VM with persistent workspace, shared storage, memory, and skills.

```
Telegram ←→ Account feed ←→ Runtime (log, jobs, slices) ←→ pi agent
                                 ↕
                         Gondolin VM (Alpine + bash)
                         /workspace  /shared
```

- **One VM per conversation.** A conversation is a DM, a group, or a **forum topic** (supergroup with Topics enabled; General = topic 1). Started on `/chat-connect`, closed on `/chat-disconnect`.
- **One account-level poller.** Telegram allows a single `getUpdates` consumer per bot token, so the first connected process per account takes a feed lock and fans updates out to conversation logs by (chat id, thread id). Followers tail their own logs and take over the feed if the leader dies.
- **One JSONL log per conversation.** Append-only event stream: `inbound`, `outbound`, `job_queued`, `job_completed`, `job_failed`, `error`, `checkpoint`.
- **Trigger-based dispatch.** Mentions in groups/topics, every message in DMs. Failed jobs do not advance the consumption boundary.
- **File tools run inside the VM** (`read`, `write`, `edit`, `bash` — reachable through codemode scripts); `chat_history`, `chat_attach`, `chat_workers`, `chat_request_secret` run on the host.
- **Worker-per-conversation.** `/chat-spawn-all` launches one detached tmux/pi worker per configured channel using the `--chat-conversation <account/channel>` extension flag. Workers write status JSON to `~/.pi/agent/chat/worker-status/`.

## Topics (forum groups)

Topics in a supergroup behave like Discord channels: **one topic = one conversation = one VM/workspace/memory**.

- The group must have Topics enabled (Bot API reports `is_forum: true`).
- Configure via `/chat-config` → account → **Add topic (observe)** — post any message in the topic and its thread id is picked up — or **Create topic (bot)** — the bot creates the topic itself (needs the bot to be a group admin with \"Manage Topics\" / `can_manage_topics`).
- **General** is topic `message_thread_id = 1` and is configured like any other topic.
- The agent can create topics itself: the bot token is auto-provisioned as the Gondolin secret `bot_token` (hosts: `api.telegram.org`). The VM only ever sees a placeholder; the real value is substituted on egress. A `forum_topic_created` service message in a configured group auto-registers the topic as a new channel (worker connects on the next `/chat-spawn-all` or reconnect).
- Messages in topics that are not configured are ignored.

## Access to tools

- Per-channel whitelist in `config.json`: `"tools": ["read", "write", "edit", "bash", "chat_history", "chat_attach"]` on a channel. Applies during remote turns (direct **and** codemode-nested calls; `codemode` itself counts as a tool name). Omitted = everything allowed.
- Config secrets (global/account/channel, `gondolin.secrets`) are injected by Gondolin into outgoing HTTP only to the hosts listed per secret; the agent never sees values.

## Mounted folders

Per channel in `config.json`:

```json
"gondolin": {
	"mounts": [{ "hostPath": "~/projects/myapp", "readOnly": false }]
}
```

- Read-only by default; set `"readOnly": false` to let the agent modify host files.
- Guest path defaults to `/workspace/<folder name>` (must stay under `/workspace` or `/shared`).
- The mount list is injected into the agent's system prompt.

## Entry point

`index.ts` — Extension factory. Registers tools, commands, event handlers, connection lifecycle, and tmux spawning.

## Key files

### Core types

- `src/core/config-types.ts` — Config, account, channel (incl. `threadId`), secret, mount, and resolved conversation types.
- `src/core/runtime-types.ts` — Log record types, job types, dispatch types.
- `src/core/keys.ts` — Channel key derivation, unique-key helper.

### Config & storage

- `src/config.ts` — Load/save config (drops non-Telegram accounts), resolve conversations, storage paths. Everything under `~/.pi/agent/chat/`.
- `src/discovery-store.ts` — Read/write discovery snapshots.
- `src/log.ts` — JSONL log read/write, conversation locks, append locks (cross-process single-writer), attachment materialization, directory setup.

### Runtime

- `src/runtime.ts` — `ConversationRuntime`: log state machine, trigger logic, job queue, slice construction, prompt building. Absorbs records appended by the account feed.

### Telegram live layer

- `src/live/telegram.ts` — Outbound transport (send/typing/streaming preview, `message_thread_id` on every send) + Bot API helpers.
- `src/live/feed.ts` — Account-level `getUpdates` poller: feed lock, cursor state, (chat id, thread id) fan-out, media-group debounce, `forum_topic_created` auto-registration.
- `src/live/types.ts` — `LiveConnection` interface.
- `src/live/common.ts` — Attachment download/storage, MIME detection, mention detection.

### Gondolin sandbox

- `src/gondolin.ts` — `ConversationSandbox`: VM lifecycle, bot-token secret provisioning (URL-path rewrite hook), extra host-folder mounts (read-only wrapper), tool operation factories, guest/host path translation.

### Secrets

- `src/secrets.ts` — Encrypted secret exchange: RSA keypair generation, widget URL construction, hybrid RSA-OAEP + AES-256-GCM decryption.

### Rendering

- `src/render/format.ts` — Telegram markdown normalization and message length limits.
- `src/render/chunking.ts` — Text chunking for Telegram message limits.
- `src/render/streaming.ts` — Chunked preview transport.

### Services (setup)

- `src/services/index.ts` — Account snapshot refresh, identity update.
- `src/services/telegram.ts` — Telegram bot validation.
- `src/services/types.ts` — Shared service types.

### TUI

- `src/tui/chat-config.ts` — `/chat-config` UI: accounts, channels/topics, access policy, secrets.
- `src/tui/dialogs.ts` — Shared dialog helpers.
- `src/tui/telegram-setup.ts` — Guided Telegram setup: DM, group, topic (observe or bot-created).

## Storage layout

```
~/.pi/agent/chat/
├── config.json
├── cache/
├── accounts/<account>/
│   ├── feed.lock                  → account getUpdates leadership
│   ├── feed.json                  → account poller cursor / forum cache
│   ├── shared/                    → /shared in VM (account-wide)
│   │   ├── memory.md
│   │   └── skills/
│   └── channels/<channel>/
│       ├── channel.jsonl
│       ├── .lock / .lock.append
│       ├── workspace/             → /workspace in VM (per topic!)
│       │   ├── memory.md
│       │   ├── skills/
│       │   ├── incoming/
│       │   ├── .secrets/
│       │   └── SYSTEM.md
│       └── gondolin/
│           └── session.json
```

## Job/slice semantics

- `job_queued` records a trigger. `sliceStartRecordId` is derived at dispatch time from the last `job_completed.triggerRecordId`.
- Failed jobs do not advance the consumption boundary.
- The prompt slice includes all inbound records between the last completed boundary and the trigger.
- On connect, backlog records are logged but do not trigger until a new trigger arrives (arming).

## Remote control commands

Parsed by `ConversationRuntime.parseControlCommand()`: `stop`, `new`, `compact`, `status`.

## Secret exchange flow

1. Agent calls `chat_request_secret` tool → RSA keypair generated, widget URL sent to chat.
2. User opens `pi.dev/secret#<base64>`, pastes secret, gets encrypted blob.
3. User pastes `!secret:<id>:<payload>` back into chat.
4. pi-chat intercepts (before trigger check), decrypts, writes to `/workspace/.secrets/<name>`, notifies agent.

## Conventions

- `npm run check` = biome + tsc.
- No ambient host env leaks into VM.
- All paths shown to the model use guest-relative paths (`/workspace/...`, `/shared/...`).
- Transcript lines include `[uid:ID]` for tamper-resistant user identification.
