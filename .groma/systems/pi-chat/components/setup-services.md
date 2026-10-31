---
type: C4 Component
title: Сервисы настройки
status: stable
groma:
  id: setup-services
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/services/index.ts
    - scanner: typescript
      file: src/services/telegram.ts
      symbol: telegramDiscoveryProvider
    - scanner: typescript
      file: src/services/types.ts
  group: Настройка
  technology: 'Bot API: getMe'
description: Обновляет снапшоты и проверяет бота
---

refreshAccountSnapshot подтягивает актуальные данные аккаунта, identity обновляется из снапшота, telegramDiscoveryProvider находит каналы, доступные боту.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [src/services/telegram.ts](../../../../src/services/telegram.ts) | [telegram-api](../../../externals/telegram-api.md) | Проверяет токен бота | getMe |
| [src/services/index.ts](../../../../src/services/index.ts) | [src/discovery-store.ts](../../../../src/discovery-store.ts) | Кэширует снапшоты discovery | snapshot JSON in cache/ |
