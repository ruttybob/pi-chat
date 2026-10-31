---
type: C4 Component
title: Точка входа расширения
status: stable
groma:
  id: extension-entry
  parent: pi-chat
  code:
    - scanner: typescript
      file: index.ts
    - scanner: typescript
      file: types.ts
  technology: pi Extension API, codemode tool delegates, tmux
description: Собирает инструменты, команды и подключение канала
---

Фабрика Extension (index.ts). Регистрирует делегаты инструментов, исполняемые в ВМ (read/write/edit/bash, exposure codemode), и хост-инструменты chat_history, chat_attach, chat_workers, chat_request_secret. При подключении канала поднимает ConversationRuntime, фид и песочницу, вешает колбэки фида (onInbound, onTopicCreated, onError) и запускает tail-поллер каждые 2с: runtime.absorbExternalRecords -> tryDispatch -> pi.sendUserMessage. Команды /chat-config, /chat-spawn-all, /chat-workers, /chat-open-all, /chat-kill-all; снапшоты статуса воркеров каждые 15с в ~/.pi/agent/chat/worker-status/. types.ts - публичный barrel типов пакета.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [index.ts](../../../../index.ts) | [src/runtime.ts](../../../../src/runtime.ts) | Диспатчит промпты ходов | absorbExternalRecords + tryDispatch, 2s poll |
| [index.ts](../../../../index.ts) | [src/live/index.ts](../../../../src/live/index.ts) | Подключает фид канала | connectLive + callbacks |
| [index.ts](../../../../index.ts) | [pi](../../../externals/pi.md) | Отправляет промпт хода | pi.sendUserMessage |
| [index.ts](../../../../index.ts) | [src/live/telegram.ts](../../../../src/live/telegram.ts) | Отправляет ответы и сервисные сообщения | send, sendImmediate |
| [index.ts](../../../../index.ts) | [src/gondolin.ts](../../../../src/gondolin.ts) | Держит ВМ диалога | ConversationSandbox lifecycle |
