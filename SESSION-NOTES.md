# Заметки: разбор pi-chat (сессия от 2026-02)

Саммари того, что выяснили при изучении репозитория (по README, `package.json`, `AGENTS.md` и исходникам `src/`).

## Что это

**pi-chat** — расширение (pi-package) для pi: мост из **Discord** и **Telegram** в песочницу pi-агента. Каждый подключённый чат получает собственную **Gondolin micro-VM** (QEMU, Alpine Linux); инструменты агента (`read`, `write`, `edit`, `bash`) исполняются внутри VM, `chat_history` / `chat_attach` — на хосте.

## Как работает

```
Discord/Telegram ←→ Live Adapter ←→ Runtime (log, jobs, slices) ←→ pi agent
                                        ↕
                                   Gondolin VM (Alpine + bash)
                                   /workspace  /shared
```

- Один чат = одна conversation = одна VM + один workspace.
- Ответы стримятся в чат с редактированием на месте, ответы — reply к триггеру.
- JSONL-лог на канал (`channel.jsonl`): `checkpoint`, `inbound`, `job_queued`, `outbound`, `job_completed`, `job_failed`, `error`. Неудалённые jobs не двигают границу потребления.
- Удалённое управление из чата: `stop`, `status`, `compact`, `new`.
- Память: `memory.md` аккаунта (`/shared/memory.md`) и канала (`/workspace/memory.md`) вшиваются в системный промпт каждый ход.
- Скиллы: `/shared/skills/` и `/workspace/skills/`, стандарт agentskills.io, авто-дискавери в промпт.
- Секреты: конфиг-секреты (глобальные/аккаунт/канал, подставляются Gondolin только на исходящие HTTP к разрешённым хостам, агент значения не видит) + runtime-обмен (RSA-OAEP + AES-256-GCM через `pi.dev/secret`, расшифрованный файл ложится в `/workspace/.secrets/`).

## Workspace и shared — что это на хосте

| VM | Хост | Охват |
|---|---|---|
| `/shared` | `~/.pi/agent/chat/accounts/<аккаунт>/shared/` | один на аккаунт (`memory.md`, `skills/`) |
| `/workspace` | `~/.pi/agent/chat/accounts/<аккаунт>/channels/<чат>/workspace/` | свой у каждого чата (`memory.md`, `skills/`, `incoming/`, `.secrets/`, `SYSTEM.md`) |

Обе папки — обычные директории хоста: их можно открывать в редакторе, коммитить и пушить обычным способом. VM — просто ещё один «гость» над той же папкой.

**Изоляция жёсткая**: в `src/gondolin.ts` пути валидируются (`Path is outside mounted storage`), резолв через `realpath` + проверка `isInside` — симлинки наружу не работают. Опции «примонтировать произвольную папку хоста» в конфиге нет.

**Существующие проекты**: клонировать (`git clone` внутри VM, токен через secret exchange) или скопировать проект в `channels/<чат>/workspace/`. Работать «на месте» с произвольной папкой диска нельзя.

## Жизненный цикл

```bash
pi install /path/to/pi-chat   # или pi -e /path/to/pi-chat
/chat-config                  # аккаунты, чаты, доступ, секреты
/chat-connect                 # подключить чат в текущей сессии
/chat-spawn-all               # фон: по detached tmux-воркеру на каждый чат
```

- Воркеры: `/chat-spawn-all` запускает `pi --chat-conversation <account/channel>` в tmux-сессиях; `/chat-workers`, `/chat-open-all` (тайловый дашборд), `/chat-kill-all`. Статус-снапшоты каждые 15 сек в `~/.pi/agent/chat/worker-status/` (инструмент `chat_workers` читает их же).
- «Агентов» заранее создавать не нужно — агент это просто запущенный pi с расширением; конфиг (`config.json`) описывает аккаунты и чаты.

## Специфика Telegram

Внутренний термин «channel» = конкретный **чат** Telegram (личка или группа):

- **DM**: мастер настройки ждёт `/start` в личке; `trigger: "message"` (реакция на каждое сообщение); `allowedUserIds` прибивается к первому пользователю, другие в личке бота писать не смогут.
- **Группа/супергруппа**: бот добавляется в группу, мастер ловит `/start` или упоминание; `trigger: "mention"` по умолчанию (только упоминания, переключается в access-настройках); имя канала — slug из названия группы или chat id (`src/core/keys.ts`).
- Несколько групп = несколько каналов = несколько VM (расход памяти ×N).

## Замеченные quirks / риски

- Произвольные папки хоста не примонтировать — большие существующие проекты придётся клонировать/копировать в workspace.
- В DM триггерный `/start`, который видит мастер настройки, перехватывается setup-флоу, агенту как задание не уходит.
- Версия 0.1.0 — API и команды могут меняться.
- Часть рендер-модулей (`streaming.ts`, `streaming-markdown.ts`) помечена в коде как «currently unused».

## Полезные пути

- Конфиг: `~/.pi/agent/chat/config.json`
- Логи каналов: `~/.pi/agent/chat/accounts/<acc>/channels/<chat>/channel.jsonl`
- Воркеры: `~/.pi/agent/chat/worker-status/`
