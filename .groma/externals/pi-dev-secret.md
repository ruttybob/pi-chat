---
type: C4 System
title: pi.dev - сервис секретов
description: Принимает и отдаёт зашифрованные секреты
status: stable
groma:
  id: pi-dev-secret
  technology: RSA-OAEP + AES-256-GCM widget
---

Виджет pi.dev/secret: запрос секрета создаётся в расширении, пользователь вставляет зашифрованный ответ в чат, расширение расшифровывает его и кладёт в /workspace/.secrets/.
