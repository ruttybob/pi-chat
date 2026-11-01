# План: оставить только Telegram + топики как каналы

> СТАТУС: финальный. Grilling завершён: раунды 1–3 согласованы.

## Context

- pi-chat мостит Discord + Telegram в pi-агента (по VM на conversation). Решение: Discord убрать полностью, оставить только Telegram.
- Топики форум-групп Telegram должны вести себя как каналы в Discord: **один топик = одна conversation** (своя VM, workspace, память, лог).
- Дополнительно в скоупе (раунд 2): (1) управление доступами к инструментам, (2) возможность агента самому создавать топики, (3) монтирование папок хоста в VM.

## Согласованные решения (раунд 1)

1. Discord сносится целиком (код, зависимости, README).
2. Топик = отдельная conversation: threadId в конфиге канала, рантайм без изменений.
3. Добавление топика в конфиг: наблюдение сообщения через getUpdates (основной путь) + опция «бот создаёт топик сам» (createForumTopic) в setup.
4. Сообщения в несконфигурированных топиках игнорируются молча.
5. General (message_thread_id = 1) — обычный топик, добавляется так же.
6. DM и обычные группы без топиков — как сейчас, threadId опциональный.
7. Миграция config.json: discord-аккаунты выбрасываются с warning в лог.

### Раунд 2

8. Агент создаёт топики: авто-провижининг секрета bot_token (hosts: api.telegram.org) — агент дергает Bot API из VM напрямую.
9. forum_topic_created в сконфигурированной группе → авто-регистрация канала в config.json (воркер коннектится при следующем spawn-all/реконнекте).
10. Инструменты: read/write/edit/bash — с exposure: "codemode" (модель их не видит, вызов только из скриптов codemode); chat_* — отдельными direct-инструментами. codemode обязателен (codemode.mode: "on" в настройках pi; pi-chat проверяет на session_start и предупреждает). Пер-канальный whitelist режет и прямые, и вложенные вызовы.
11. Маунты папок: пер-канально, readOnly: true по умолчанию, rw — opt-in.

## Факты о топиках (Bot API, по официальной документации)

- Топики только в supergroup с режимом Topics; getChat отдаёт is_forum: true (Bot API 6.3+).
- Каждое сообщение в форуме несёт message_thread_id (+ is_topic_message). General = thread id 1.
- Отправка в топик: message_thread_id у sendMessage / всех send* / sendChatAction.
- Управление топиками (createForumTopic, edit/close/reopen/delete) требует админ-права can_manage_topics.
- **Списка существующих топиков в Bot API нет** (messages.getForumTopics — MTProto, только юзеры). Бот узнаёт топики из forum_topic_created/forum_topic_edited и из message_thread_id входящих сообщений.
- Название топика — только из service-сообщений; из обычного сообщения его не достать.
- Топики в личках с ботом (дек 2025) — вне скоупа.
- **getUpdates — один потребитель на токен.** Сейчас адаптер поллит на каждый канал (src/live/telegram.ts:271-288): два канала на одном токене конфликтуют (409 / кража апдейтов). Для N топиков одной группы нужен аккаунт-левел поллер с fan-out по (chat_id, thread_id).

## Approach

### A. Снос Discord
Удалить src/live/discord.ts, src/services/discord.ts, src/tui/discord-setup.ts; вычистить ветки из src/live/index.ts, src/services/index.ts, src/core/config-types.ts (ChatService), src/render/format.ts, src/tui/chat-config.ts, index.ts; убрать discord.js из package.json; переписать README/AGENTS.md.

### B. Топики
- ConfiguredChannel += threadId?: number; channelKey строится из chat + thread (src/core/keys.ts); threadId в ResolvedConversation (src/config.ts).
- **Аккаунт-левел поллер**: один getUpdates-цикл на аккаунт, fan-out апдейтов по (chat_id, thread_id → channelKey) в рантаймы conversation. Заодно чинит конфликт нескольких каналов на одном токене. resumeState/cursor переезжает с канала на аккаунт.
- Адаптер outbound: message_thread_id в send* и sendChatAction.
- Setup-мастер: режим «добавить топик» — наблюдение (а) или создание ботом (б); имя из forum_topic_created, fallback topic-<id>, переименование в /chat-config.
- Авто-регистрация: forum_topic_created в сконфигурированной группе создаёт канал в config.json (без авто-коннекта воркера) — см. Q2 раунда 2.

### C. Агент создаёт топики
В resolveSecretEnvironment (src/gondolin.ts:29) для telegram-аккаунта авто-добавляется секрет bot_token { value: account.botToken, hosts: ["api.telegram.org"] }. Агент вызывает Bot API из VM (curl/fetch), значение токена не видит. Плюс системная инструкция в SYSTEM.md: как создавать топики (createForumTopic), и что созданный топик зарегистрируется автоматически (см. B).

### D. Инструменты: codemode + whitelist
- read/write/edit/bash (VM-делегаты) регистрируются с exposure: "codemode" (ToolDefinition.exposure, pi extensions API) — не объявляются модели напрямую, вызываются только из скриптов codemode.
- chat_history/chat_attach/chat_workers/chat_request_secret — exposure "direct" (по умолчанию), объявлены модели отдельно.
- Требование: codemode.mode: "on" в настройках pi (иначе codemode-инструмента нет и файловые инструменты недостижимы) — pi-chat проверяет ctx.getSettings().codemode на session_start и предупреждает.
- Пер-канальный whitelist tools?: string[] в конфиге канала, enforcement в pi.on("tool_call") (index.ts:1123): режет и прямые, и вложенные (codemode) вызовы; вложенные вызовы проходят через executeTool как обычные tool_call (проверить при реализации, docs/nested-tool-calls).

### E. Монтирование папок
Конфиг канала: mounts?: [{ hostPath, guestPath?, readOnly? }] (readOnly по умолчанию true). В VM.create vfs.mounts (src/gondolin.ts:81-83) добавляются RealFSProvider-записи; guest по умолчанию /workspace/<имя папки> (не новый корень — переиспользует перевод путей); readOnly — обёртка над RealFSProvider, отклоняющая запись. hostPath валидируется (существует, realpath), список маунтов вшивается в SYSTEM.md.

## Как устроено хранение (факты, для понимания)

- Хост: accounts/<acc>/shared/ (ОДИН на аккаунт: общая память memory.md + skills/) и accounts/<acc>/channels/<chat>/workspace/ (свой на канал; после рефакторинга — на топик: личная memory.md, skills/, incoming/, .secrets/, SYSTEM.md).
- VM (QEMU Alpine от Gondolin) не копирует файлы: /workspace и /shared — это монтирование host-папок через RealFSProvider-мост (файловые операции проксируются из VM в host-процесс pi). Файлы физически всегда лежат на хосте, их можно править в редакторе и коммитить.
- Доп. маунты (E) — та же механика: ещё одна host-папка появляется в VM под /workspace/<имя>.
- /shared остаётся аккаунт-левел: общая память на все чаты/топики одного бота; workspace — личный на топик.

## Files to modify

- src/live/telegram.ts — аккаунт-левел поллер + fan-out, message_thread_id in/out, sendChatAction
- src/live/index.ts, src/core/runtime-types.ts — типы fan-out-диспетчера
- src/core/config-types.ts — threadId, mounts, tools whitelist, чистка ChatService
- src/core/keys.ts, src/config.ts — ключи и resolve с threadId
- src/gondolin.ts — доп. маунты, авто-секрет bot_token
- src/tui/telegram-setup.ts — режимы добавления топика
- index.ts — tool_call whitelist, чистка discord
- src/tui/chat-config.ts, src/services/index.ts, src/render/format.ts
- Удалить: src/live/discord.ts, src/services/discord.ts, src/tui/discord-setup.ts
- package.json, README.md, AGENTS.md

## Reuse

- makeChannelKey / ensureUniqueKey (src/core/keys.ts)
- Логика getUpdates-поллинга из текущего адаптера — переезжает на уровень аккаунта
- createHttpHooks + GondolinSecretConfig { value, hosts } — механизм для bot_token
- pi.on("tool_call") — точка enforcement whitelist
- RealFSProvider (gondolin) — доп. маунты
- chunkText / formatMarkdownForService / maxMessageLength, ConversationRuntime, логи, воркеры — без изменений

## Steps (черновик)

- [x] Снести Discord (код, зависимости, конфиг-типы, README)
- [x] threadId в конфиге/ключах/resolve
- [x] Аккаунт-левел getUpdates поллер + fan-out по (chat_id, thread_id)
- [x] Outbound: message_thread_id в send*/sendChatAction
- [x] Setup-флоу топиков (наблюдение + автосоздание)
- [x] Авто-регистрация forum_topic_created (если YES в Q2)
- [x] Секрет bot_token → агент может создавать топики (если YES в Q1)
- [x] exposure "codemode" для read/write/edit/bash + проверка настройки codemode
- [x] Пер-канальный whitelist инструментов через tool_call hook
- [x] Монтирование папок (mounts, readOnly-обёртка, SYSTEM.md)
- [x] Миграция config.json (выброс discord-аккаунтов)
- [x] README/AGENTS.md/SYSTEM.md под новую модель

## Verification

- npm run check (biome + tsc)
- Ручной сценарий: форум-группа с топиками — добавить 2 топика через setup, писать в оба параллельно (проверить fan-out: оба conversation получают свои сообщения), ответ приходит в тот же топик; typing в правильном топике; General; обычная группа; DM; два канала на одном токене одновременно.
