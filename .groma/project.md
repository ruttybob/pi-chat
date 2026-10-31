---
type: Groma Project
title: pi-chat
groma:
  profile: architecture
description: Расширение pi, превращающее диалоги Telegram в рабочие сессии pi
---

pi-chat живёт как расширение в процессах pi. Один диалог Telegram (личный чат, группа или топик форума) становится отдельным каналом с собственным журналом, рабочим пространством и микровиртуалкой Gondolin. Все данные - под ~/.pi/agent/chat/: config.json, журналы каналов, shared-память, workspace каждого топика.
