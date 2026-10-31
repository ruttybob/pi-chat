---
type: C4 Component
title: Рендеринг исходящих
status: stable
groma:
  id: render
  parent: pi-chat
  code:
    - scanner: typescript
      file: src/render/format.ts
    - scanner: typescript
      file: src/render/chunking.ts
      symbol: chunkText
    - scanner: typescript
      file: src/render/streaming.ts
    - scanner: typescript
      file: src/render/streaming-markdown.ts
      symbol: StreamingMarkdownRenderer
  technology: 4096 chars per message, Telegram markdown
description: Готовит текст к лимитам Telegram
---

formatMarkdownForService нормализует разметку, chunkText режет длинные тексты, StreamingPreview и StreamingMarkdownRenderer ведут потоковое превью с правкой одного сообщения. Для сервисных сообщений - отдельные лимиты чанкинга.
