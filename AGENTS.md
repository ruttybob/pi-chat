# pi-chat

Pi extension bridging Telegram to a sandboxed pi session via Gondolin micro-VMs.

## Architecture

```
Telegram ←→ Account feed ←→ Runtime (log, jobs, slices) ←→ pi agent
                                 ↕
                         Gondolin VM (Alpine + bash)
                         /workspace  /shared
```

- **One conversation = one VM.** A conversation is a DM, a group, or a forum **topic** (supergroup with Topics enabled; General = thread 1). One topic = one channel = one workspace/memory, like Discord channels.
- **One `getUpdates` poller per bot token** (Telegram allows a single consumer): `src/live/feed.ts` takes an account-level lock (`feed.lock`), persists its cursor in `feed.json`, and fans updates out to conversation logs by (chat id, thread_id). Followers tail their own logs (`runtime.absorbExternalRecords`) and take over leadership if the leader dies.
- **Cross-process log appends go through `.lock.append`** (`withAppendLock` in `src/log.ts`): recordIds are allocated from the log tail under the lock, so the feed leader and the conversation worker never collide.
- **Tools run inside the VM.** `read`/`write`/`edit`/`bash` are VM delegates registered with `exposure: "codemode"` (pi 1.4.0 API; dev types are older, hence casts); `chat_history`, `chat_attach`, `chat_workers`, `chat_request_secret` run on the host. Per-channel `tools` whitelist is enforced in the `tool_call` hook during remote turns.
- **`/chat-spawn-all`** launches one detached tmux/pi worker per configured channel using the `--chat-conversation <account/channel>` extension flag. `/chat-workers`, `/chat-open-all`, `/chat-kill-all` manage workers; status snapshots every 15s to `~/.pi/agent/chat/worker-status/`.

## Entry point

`index.ts` — Extension factory. Registers tools, commands, event handlers, connection lifecycle, tmux spawning.

## Key files

### Core types

- `src/core/config-types.ts` — Config, account, channel (`threadId`, `tools`), secret, mount, resolved conversation types.
- `src/core/runtime-types.ts` — Log record types, job types, dispatch types.
- `src/core/keys.ts` — Channel key derivation, `ensureUniqueKey`.

### Config & storage

- `src/config.ts` — Load/save config (drops non-Telegram accounts with a warning), resolve conversations, storage paths. Everything under `~/.pi/agent/chat/`.
- `src/discovery-store.ts` — Read/write discovery snapshots (cached bot identity).
- `src/log.ts` — JSONL log read/write, conversation locks, append locks, attachment materialization, directory setup.

### Runtime

- `src/runtime.ts` — `ConversationRuntime`: log state machine, triggers (`mention`/`message`), job queue, slices, prompt building, checkpoint-free catch-up arming, `absorbExternalRecords`.

### Telegram live layer

- `src/live/telegram.ts` — Outbound transport (every send carries `message_thread_id` when the channel is a topic) + Bot API helpers (`callTelegramApi`, `messageToInput`, `mergeMediaGroup`).
- `src/live/feed.ts` — Account-level `getUpdates` poller: leadership, cursor, (chat_id, thread_id) matching, media-group debounce, `forum_topic_created` auto-registration callback.
- `src/live/types.ts` — `LiveConnection`.
- `src/live/common.ts` — Attachment download/storage, MIME detection, mention detection.

### Gondolin sandbox

- `src/gondolin.ts` — `ConversationSandbox`: VM lifecycle, `resolveSecretEnvironment` (auto-provisions `bot_token` secret for `api.telegram.org` with a URL-path rewrite hook — Telegram keeps the token in the path, Gondolin only rewrites headers/query), extra mounts (`gondolin.mounts`, `ReadonlyProvider` for read-only), tool op factories, guest/host path translation with longest-prefix mount table.

### Secrets

- `src/secrets.ts` — RSA-OAEP + AES-256-GCM secret exchange via `pi.dev/secret` widget; decrypted files land in `/workspace/.secrets/`.

### Rendering

- `src/render/format.ts` — Telegram markdown normalization, 4096 limit.
- `src/render/chunking.ts` — Chunking for service message limits.
- `src/render/streaming.ts` — `StreamingPreview` (edit-in-place previews).

### Services (setup)

- `src/services/index.ts` — Account snapshot refresh, identity update.
- `src/services/telegram.ts` — Telegram bot validation.
- `src/services/types.ts` — Shared service types.

### TUI

- `src/tui/chat-config.ts` — `/chat-config` UI: accounts, channels/topics, access policy, secrets.
- `src/tui/dialogs.ts` — Shared dialog helpers.
- `src/tui/telegram-setup.ts` — Guided setup: DM, group, topic (observe / bot-created via `createForumTopic`).

## Storage layout

```
~/.pi/agent/chat/
├── config.json
├── cache/
├── accounts/<account>/
│   ├── feed.lock / feed.json      → getUpdates leadership + cursor
│   ├── shared/                    → /shared in VM
│   │   ├── memory.md
│   │   └── skills/
│   └── channels/<channel>/
│       ├── channel.jsonl
│       ├── .lock / .lock.append
│       ├── workspace/             → /workspace in VM (per topic)
│       │   ├── memory.md
│       │   ├── skills/
│       │   ├── incoming/
│       │   ├── .secrets/
│       │   └── SYSTEM.md
│       └── gondolin/session.json
```

## Log record types

`checkpoint`, `inbound`, `job_queued`, `outbound`, `job_completed`, `job_failed`, `error`.

## Job/slice semantics

- `job_queued` records a trigger; the slice spans the last completed boundary up to the trigger.
- Failed jobs do not advance the consumption boundary.
- On connect the log is armed after its current tail: backlog is logged, not triggered.

## Remote control commands

Parsed by `ConversationRuntime.parseControlCommand()`: `stop`, `new`, `compact`, `status`.

## Conventions

- `npm run check` = biome + tsc.
- No ambient host env leaks into VM.
- All paths shown to the model use guest-relative paths (`/workspace/...`, `/shared/...`).
- Transcript lines include `[uid:ID]` for tamper-resistant user identification.
