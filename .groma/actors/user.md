---
type: C4 Actor
title: Пользователь Telegram
description: Общается с pi-агентом из Telegram
status: stable
groma:
  id: user
---

Пишет в личный чат, группу или топик форума; получает ответы, файлы и запросы секретов; может посылать управляющие команды stop/new/compact/status.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [user](user.md) | [telegram-api](../externals/telegram-api.md) | Пишет и читает сообщения | Telegram chats |
