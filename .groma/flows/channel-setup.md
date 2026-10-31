---
type: Groma Flow
title: Настройка канала
groma:
  id: channel-setup
---

Оператор открывает /chat-config в TUI pi, заводит аккаунт и канал. Сервисы настройки проверяют токен через Telegram Bot API и обновляют снапшот аккаунта. Успешная конфигурация сохраняется на диск, после чего канал можно запустить воркером.

## Steps

| From | To | Action |
|---|---|---|
| [Оператор](../actors/operator.md) | [TUI настройки](../systems/pi-chat/components/setup-tui.md) | Открывает /chat-config |
| [TUI настройки](../systems/pi-chat/components/setup-tui.md) | [Сервисы настройки](../systems/pi-chat/components/setup-services.md) | Проверяет токен и каналы |
| [Сервисы настройки](../systems/pi-chat/components/setup-services.md) | [Telegram Bot API](../externals/telegram-api.md) | Проверяет токен бота (getMe) |
| [TUI настройки](../systems/pi-chat/components/setup-tui.md) | [Конфигурация и хранилище](../systems/pi-chat/components/config-store.md) | Сохраняет конфигурацию |
