---
type: C4 System
title: Telegram Bot API
description: Доставляет сообщения между пользователем и ботом
status: stable
groma:
  id: telegram-api
  technology: HTTPS, JSON
---

Входящее: long polling getUpdates - единственный потребитель на токен бота. Исходящее: sendMessage, sendMediaGroup; для топиков - message_thread_id.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [telegram-api](telegram-api.md) | [src/live/feed.ts](../../src/live/feed.ts) | Отдаёт апдейты | long polling getUpdates |
| [telegram-api](telegram-api.md) | [user](../actors/user.md) | Доставляет ответы бота | Bot API pushes |
