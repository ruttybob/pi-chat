---
type: C4 Component
title: TUI настройки
status: stable
groma:
  id: setup-tui
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/tui/chat-config.ts
      symbol: runChatConfigUI
    - scanner: typescript
      file: src/tui/dialogs.ts
    - scanner: typescript
      file: src/tui/telegram-setup.ts
  group: Настройка
  technology: pi TUI
description: Ведёт /chat-config и мастер подключения
---

Управление аккаунтами, каналами и топиками, политикой доступа и секретами. Guided setup: личный чат, группа или топик (observe или бот создаёт топик сам через createForumTopic). Общие диалоги вынесены в dialogs.ts.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [src/tui/chat-config.ts](../../../../src/tui/chat-config.ts) | [src/services/index.ts](../../../../src/services/index.ts) | Обновляет снапшот аккаунта | refreshAccountSnapshot |
| [src/tui/chat-config.ts](../../../../src/tui/chat-config.ts) | [src/config.ts](../../../../src/config.ts) | Сохраняет конфигурацию | config.json read/write |
| [src/tui/telegram-setup.ts](../../../../src/tui/telegram-setup.ts) | [src/services/index.ts](../../../../src/services/index.ts) | Валидирует черновик аккаунта | validateAccountDraft |
