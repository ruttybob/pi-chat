---
type: C4 Component
title: Движок диалогов
status: stable
groma:
  id: runtime
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/runtime.ts
      symbol: ConversationRuntime
    - scanner: typescript
      file: src/core/runtime-types.ts
  technology: JSONL state machine
description: Ведёт очередь ходов по журналу канала
---

ConversationRuntime. Триггеры mention/message создают job_queued записи; слайс - отрезок журнала от последней границы потребления до триггера. Неудавшийся джоб границу не двигает. armAfterCurrentTail: при подключении накопленный бэклог логируется, но не триггерит. parseControlCommand разбирает stop/new/compact/status прямо из чата. absorbExternalRecords подтягивает записи, дописанные фидом из другого процесса.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [src/runtime.ts](../../../../src/runtime.ts) | [src/log.ts](../../../../src/log.ts) | Читает журнал и двигает границы | conversation locks |
