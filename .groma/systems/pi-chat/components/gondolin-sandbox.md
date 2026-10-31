---
type: C4 Component
title: Песочница Gondolin
status: stable
groma:
  id: gondolin-sandbox
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/gondolin.ts
  technology: Gondolin micro-VM, Alpine guest, /workspace + /shared
description: Поднимает ВМ диалога и фабрики инструментов
---

ConversationSandbox управляет жизненным циклом ВМ на диалог. resolveSecretEnvironment автоматически выдаёт секрет bot_token для api.telegram.org с rewrite-хуком: Telegram держит токен в пути запроса, Gondolin переписывает его в заголовки/query. Доп. маунты из gondolin.mounts, read-only через ReadonlyProvider. Фабрики операций read/write/edit/bash и перевод путей гость/хост по таблице маунтов с longest-prefix.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [src/gondolin.ts](../../../../src/gondolin.ts) | [gondolin](../../../externals/gondolin.md) | Управляет микровиртуалкой | gondolin npm package |
