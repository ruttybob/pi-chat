---
type: C4 Component
title: Секреты
status: stable
groma:
  id: secrets
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/secrets.ts
  technology: RSA-OAEP + AES-256-GCM
description: Обменивается секретами через pi.dev
---

createSecretRequest и tryDecryptSecret: агент запрашивает секрет у пользователя прямо в чате, зашифрованный ответ расшифровывается и сохраняется файлом в /workspace/.secrets/.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [src/secrets.ts](../../../../src/secrets.ts) | [pi-dev-secret](../../../externals/pi-dev-secret.md) | Обменивается секретами | RSA-OAEP + AES-256-GCM |
