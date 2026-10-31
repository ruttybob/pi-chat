---
type: C4 Component
title: Исходящий транспорт Telegram
status: stable
groma:
  id: telegram-transport
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/live/telegram.ts
    - scanner: typescript
      file: src/live/types.ts
      symbol: LiveConnection
  group: Telegram в реальном времени
  technology: Bot API over HTTPS (sendMessage, sendMediaGroup); message_thread_id
description: Отправляет ответы и медиа в чаты
---

Каждая отправка несёт message_thread_id, когда канал - топик форума. StreamingPreview редактирует одно сообщение по мере генерации ответа (edit-in-place). Медиагруппы склеивает mergeMediaGroup.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [src/live/telegram.ts](../../../../src/live/telegram.ts) | [telegram-api](../../../externals/telegram-api.md) | Отправляет сообщения и медиа | sendMessage, sendMediaGroup |
