# pi-chat

Telegram-каналы, которыми управляет pi-агент: каждый чат получает собственную песочницу (Gondolin VM), журнал и память; сообщения канала ходят через JSONL-лог, а сессия-воркер или подключённая TUI исполняют ходы агента.

## Language

**Conversation-bound session**:
Сессия pi, привязанная к каналу: воркер, запущенный с флагом `--chat-conversation`, либо TUI-сессия после `/chat-connect`. Только в такой сессии файловые инструменты исполняются в VM.
_Avoid_: connected session, worker session, чат-сессия

**Remote turn**:
Ход агента, запущенный сообщением из Telegram (упоминание или ЛС), а не человеком за клавиатурой TUI. Подчиняется whitelist'у инструментов.
_Avoid_: triggered turn, bot turn

**Project Mount**:
Монтирование рабочей директории TUI-сессии в VM канала. Три режима: unmount, read-only (по умолчанию), read-write. Переживает перезапуск сессии.
_Avoid_: cwd mount, project dir mount

**Remote MCP Allowlist**:
Список MCP-инструментов (по-инструментно, на аккаунт), доступных агенту в remote-ходах. Ведётся на хосте; из VM недоступен для записи.
_Avoid_: shared MCP config, MCP whitelist
