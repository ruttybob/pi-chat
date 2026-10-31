---
type: C4 Component
title: Конфигурация и хранилище
status: stable
groma:
  id: config-store
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/config.ts
    - scanner: typescript
      file: src/core/config-types.ts
    - scanner: typescript
      file: src/core/keys.ts
    - scanner: typescript
      file: src/core/discovery-types.ts
    - scanner: typescript
      file: src/discovery-store.ts
  technology: JSON under ~/.pi/agent/chat/
description: Держит конфиг, ключи каналов и снапшоты discovery
---

Загрузка и сохранение config.json (нетелеграм-аккаунты дропаются с предупреждением), resolve conversations (учётка/канал/топик), вывод всех путей хранилища. ensureUniqueKey выводит уникальные ключи каналов. discovery-store кэширует снапшоты обнаруженных ботов в cache/.
