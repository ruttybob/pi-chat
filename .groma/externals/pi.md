---
type: C4 System
title: pi
description: Платформа агента, в которой живёт расширение
status: stable
groma:
  id: pi
  technology: pi coding agent
---

Расширение загружается в сессию pi; воркеры - процессы pi в tmux с флагом --chat-conversation. Ход диалога - это ход pi-сессии: расширение отправляет промпт (pi.sendUserMessage), pi вызывает инструменты обратно в расширение, ответ стримится в Telegram.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [pi](pi.md) | [src/gondolin.ts](../../src/gondolin.ts) | Выполняет инструменты в ВМ | tool delegates: read, write, edit, bash |
| [pi](pi.md) | [index.ts](../../index.ts) | Отдаёт события и ответ хода | session event hooks |
| [pi](pi.md) | [src/log.ts](../../src/log.ts) | Читает историю диалога | chat_history tool |
