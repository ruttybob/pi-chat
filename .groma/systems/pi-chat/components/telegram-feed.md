---
type: C4 Component
title: Фид входящих
status: stable
groma:
  id: telegram-feed
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/live/feed.ts
    - scanner: typescript
      file: src/live/index.ts
      symbol: connectLive
  group: Telegram в реальном времени
  technology: getUpdates long polling; feed.lock + feed.json (leadership + cursor)
description: Опрашивает getUpdates и раскладывает апдейты по каналам
---

Telegram допускает одного потребителя getUpdates на токен, поэтому поллер один на аккаунт: берёт аккаунтный лок feed.lock, курсор хранит в feed.json и раздаёт апдейты в журналы диалогов по паре (chat id, thread_id). Подписчики следят за своими логами и перехватывают лидерство, если лидер умер. Debounce медиагрупп склеивает альбомы; forum_topic_created автоматически регистрирует новый топик как канал.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [src/live/feed.ts](../../../../src/live/feed.ts) | [src/log.ts](../../../../src/log.ts) | Дописывает входящие записи | JSONL append via withAppendLock |
