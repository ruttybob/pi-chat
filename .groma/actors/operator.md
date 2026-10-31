---
type: C4 Actor
title: Оператор
description: Настраивает каналы и воркеры в TUI pi
status: stable
groma:
  id: operator
---

Через /chat-config заводит аккаунты, каналы и секреты; через /chat-spawn-all и соседние команды управляет воркерами каналов.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [operator](operator.md) | [index.ts](../../index.ts) | Управляет воркерами | slash commands /chat-* |
| [operator](operator.md) | [src/tui/chat-config.ts](../../src/tui/chat-config.ts) | Настраивает каналы и секреты | /chat-config TUI |
