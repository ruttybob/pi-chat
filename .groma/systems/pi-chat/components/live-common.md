---
type: C4 Component
title: Помощники live-слоя
status: stable
groma:
  id: live-common
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/live/common.ts
  group: Telegram в реальном времени
description: Разбирает вложения, MIME и упоминания
---

Скачивает и складывает входящие вложения (workspace/incoming), определяет MIME, распознаёт упоминания бота в группах.
