---
type: C4 Component
title: Журнал диалогов
status: stable
groma:
  id: dialog-log
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/log.ts
  technology: JSONL append-only; file locks (.lock, .lock.append)
description: Хранит историю канала в JSONL
---

Типы записей: checkpoint, inbound, job_queued, outbound, job_completed, job_failed, error. Кросс-процессные аппенды идут через withAppendLock: recordId выделяется из хвоста журнала под локом, поэтому лидер фида и воркер канала не конфликтуют. Транскрипт помечает строки [uid:ID] для защиты от подмены пользователя. Умеет материализовать вложения и настраивать каталоги хранилища.
