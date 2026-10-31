---
type: Groma Flow
title: Входящее сообщение и ответ
groma:
  id: inbound-message-and-reply
---

Пользователь пишет боту. Фид забирает апдейт и дописывает его в журнал канала. Точка входа каждые 2с опрашивает журнал, движок диалогов собирает промпт из среза истории и ставит ход. Точка входа отправляет промпт в сессию pi; инструменты агент вызывает внутри ВМ Gondolin. Поток ответа возвращается в расширение и уходит в Telegram: сначала стриминг-превью, затем финальный текст.

## Steps

| From | To | Action |
|---|---|---|
| [Пользователь Telegram](../actors/user.md) | [Telegram Bot API](../externals/telegram-api.md) | Пишет сообщение боту |
| [Telegram Bot API](../externals/telegram-api.md) | [Фид входящих](../systems/pi-chat/components/telegram-feed.md) | Доставляет апдейт (getUpdates) |
| [Фид входящих](../systems/pi-chat/components/telegram-feed.md) | [Журнал диалогов](../systems/pi-chat/components/dialog-log.md) | Дописывает входящую запись |
| [Движок диалогов](../systems/pi-chat/components/runtime.md) | [Журнал диалогов](../systems/pi-chat/components/dialog-log.md) | Подхватывает триггер и строит промпт |
| [Точка входа расширения](../systems/pi-chat/components/extension-entry.md) | [pi](../externals/pi.md) | Отправляет промпт хода агенту |
| [pi](../externals/pi.md) | [Песочница Gondolin](../systems/pi-chat/components/gondolin-sandbox.md) | Вызывает инструменты внутри ВМ |
| [pi](../externals/pi.md) | [Точка входа расширения](../systems/pi-chat/components/extension-entry.md) | Стримит ответ хода |
| [Точка входа расширения](../systems/pi-chat/components/extension-entry.md) | [Исходящий транспорт](../systems/pi-chat/components/telegram-transport.md) | Отправляет ответ |
| [Исходящий транспорт](../systems/pi-chat/components/telegram-transport.md) | [Telegram Bot API](../externals/telegram-api.md) | Передаёт сообщение |
| [Telegram Bot API](../externals/telegram-api.md) | [Пользователь Telegram](../actors/user.md) | Доставляет ответ |
