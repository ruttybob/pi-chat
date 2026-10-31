# Telegram Bot API: темы (topics) в личных чатах с ботом

- **Дата исследования:** 2026-11-01
- **Вопрос:** что именно поддерживает Telegram Bot API для тем/потоков (threads) в личных чатах (DM) пользователя с ботом: как режим включается, кто и какими методами создаёт/меняет/удаляет темы, какие события и поля получает бот, как адресуются сообщения по темам, какие есть ограничения. Всё проверено по первоисточникам (core.telegram.org; MTProto-документация; ToS для разработчиков ботов). Без предположений о названиях фич и версиях API.
- **Контекст репозитория:** pi-chat строит модель «один разговор = один VM/workspace/сессия», где разговор — это DM, группа или форумный топик. Исследование отвечает на вопрос, можно ли распространить модель на несколько параллельных тем внутри одного DM с ботом.

---

## Ключевые находки (кратко)

1. **Фича официально существует и называется «Topics in private chats»** (в Bot API) / **«Threaded mode»** для ботов (в MTProto-документации). Включается разработчиком бота через @BotFather. Целевой сценарий — как раз AI-чатботы: «this mode is especially useful for AI chatbots». [MTProto: /api/forum, раздел «Bot forums»; /api/bots/ai, раздел «Bot forums»; /bots/features, раздел «Topics in Private Chats»]
2. **Bot API 9.3 (31 декабря 2025) ввёл базовую поддержку тем в личных чатах**: поля «message_thread_id» и «is_topic_message» в «Message» для приватных чатов; параметр «message_thread_id» во всех основных методах отправки (sendMessage, sendPhoto, …, sendMediaGroup, copyMessage(s), forwardMessage(s)), в sendChatAction, а также в editForumTopic, deleteForumTopic и unpinAllForumTopicMessages; поле «has_topics_enabled» в «User»; поле «is_name_implicit» в «ForumTopic» и «ForumTopicCreated». [changelog, раздел «Bot API 9.3» → «Topics in private chats»]
3. **Bot API 9.4 (9 февраля 2026) разрешил ботам самим создавать темы в личных чатах** методом «createForumTopic», и дал боту настройку (через Mini App @BotFather) запретить пользователям создавать и удалять темы; добавлено поле «allows_users_to_create_topics» в «User». [changelog, раздел «Bot API 9.4»]
4. **В личном чате боту доступны: createForumTopic, editForumTopic, deleteForumTopic, unpinAllForumTopicMessages.** Методы closeForumTopic и reopenForumTopic в документации описаны только «in a forum supergroup chat» — для личных чатов не заявлены. Методы General-топика (editGeneralForumTopic и т.п.) — тоже только supergroup. [страницы методов /bots/api]
5. **Пользователь может создавать/менять/удалять темы в DM с ботом только если бот это разрешил** (MTProto-флаг «bot_forum_can_manage_topics», выключатель «Disallow users to create new threads» в @BotFather; иначе клиент пользователя получает RPC-ошибку «BOT_FORUM_CREATE_FORBIDDEN»). При этом **отправка сообщения без темы всегда возможна** и попадает в неудаляемый общий «General»-топик с id=1. [MTProto: /api/forum]
6. **Определить режим у бота можно только через getMe** (поле «has_topics_enabled», а также «allows_users_to_create_topics»). Поле «Chat.is_forum» для приватных чатов не предусмотрено (оно описано только для supergroup). Принадлежность конкретного сообщения теме — по «Message.message_thread_id» и «Message.is_topic_message». [типы User, Chat, Message]
7. **Получить список тем средствами Bot API нельзя** — метода листинга тем нет вовсе (есть только getForumTopicIconStickers). Сервисного сообщения об удалении темы в Bot API тоже нет (типа «ForumTopicDeleted» не существует; единственный update про удаление сообщений — BusinessMessagesDeleted для business-аккаунтов). В MTProto удаление темы доставляется как updateDeleteMessages. [индекс методов /bots/api; список типов /bots/api/types; MTProto /api/forum]
8. **Ограничения:** имя темы — 1–128 символов при создании (0–128 при редактировании); «icon_color» — только одно из шести фиксированных значений; иконка — custom emoji из списка getForumTopicIconStickers. **Коммерческое условие:** пока фича включена у бота, с покупок Telegram Stars внутри этого бота/Mini App удерживается невозвратный сбор 15% (ToS §6.2.6). [createForumTopic, editForumTopic; telegram.org/tos/bot-developers §6.2.6]
9. **Не путать с «DirectMessagesTopic» (Bot API 9.2, 15 августа 2025)** — это отдельная фича «Direct Messages in Channels» («прямые сообщения каналов», MTProto monoforum), где topic_id — идентификатор переписки пользователя с каналом. К темам в DM с ботом отношения не имеет. [changelog, раздел «Bot API 9.2» → «Direct Messages in Channels»; /api/forum, раздел «Monoforums»]
10. **Стриминг ответов (live drafts) работает по темам:** каждый live draft идентифицируется тройкой (random_id, chat_id, topic_id); рейт-лимиты sendMessageDraft/sendChatAction — 20 вызовов / 5 секунд и 40 / 30 секунд на peer. [/api/bots/ai, раздел «Live response streaming»]

---

## Детали по каждой находке

### 1. Название и включение фичи

**Утверждение.** Официальное название в документации Bot API — «Topics in private chats»; в MTProto-документации режим для ботов называется «Threaded mode»; включается только через @BotFather.

Цитаты:

- «Bots can also behave like forums if **Threaded mode** is enabled via @botfather, this mode is especially useful for AI chatbots». — https://core.telegram.org/api/forum , раздел «Bot forums» (абзац после схемы полей «user»).
- «**Topics in Private Chats** — Bots and users can organize long-running private conversations into separate topics – for example, one topic for an order, another for technical support and a third for a recurring task.» — https://core.telegram.org/bots/features , раздел «Topics in Private Chats».
- «**Private-chat topics need to be enabled for the bot via @BotFather.** See createForumTopic, editForumTopic and deleteForumTopic for more information.» — там же, конец раздела (цитата в blockquote).
- «Note: this feature is subject to an additional fee for Telegram Star purchases as described in Section 6.2.6 of our Terms of Service for Bot Developers.» — https://core.telegram.org/api/bots/ai , раздел «Bot forums».

### 2. Bot API 9.3 (31.12.2025) — базовая поддержка

**Утверждение.** Версия 9.3 — первая, где темы поддержаны в приватных чатах: приём/отправка сообщений по темам, управление темами (частичное), флаги обнаружения режима.

Цитаты из changelog (все — https://core.telegram.org/bots/api-changelog , раздел «Bot API 9.3», подраздел **«Topics in private chats»**):

- «Added the field **has_topics_enabled** to the class User, which can be used to determine whether forum topic mode is enabled for the bot in private chats.»
- «Supported the fields **message_thread_id** and **is_topic_message** in the class Message for messages in private chats with forum topic mode enabled.»
- «Supported the parameter **message_thread_id** in private chats with topics in the methods sendMessage, sendPhoto, sendVideo, sendAnimation, sendAudio, sendDocument, sendPaidMedia, sendSticker, sendVideoNote, sendVoice, sendLocation, sendVenue, sendContact, sendPoll, sendDice, sendInvoice, sendGame, **sendMediaGroup**, copyMessage, copyMessages, forwardMessage, and forwardMessages, allowing bots to send a message to a specific topic.»
- «Supported the parameter message_thread_id in private chats with topics in the method **sendChatAction**.»
- «Supported the parameter message_thread_id in private chats with topics in the methods **editForumTopic, deleteForumTopic, and unpinAllForumTopicMessages**, allowing bots to manage topics in private chats.»
- «Added the field **is_name_implicit** to the classes ForumTopic and ForumTopicCreated.»

Замечание: closeForumTopic и reopenForumTopic в этом списке 9.3 **отсутствуют** — это согласуется с их страницами методов (см. п. 4).

### 3. Bot API 9.4 (09.02.2026) — создание тем ботом и запрет тем для пользователей

**Утверждение.** Создавать темы в личных чатах бот может начиная с 9.4; бот также может запретить пользователям создавать/удалять темы.

Цитаты (https://core.telegram.org/bots/api-changelog , раздел «Bot API 9.4»):

- «**Allowed bots to create topics in private chats using the method createForumTopic.**»
- «**Allowed bots to prevent users from creating and deleting topics in private chats** through a new setting in the @BotFather Mini App.»
- «Added the field **allows_users_to_create_topics** to the class User.»

Хронология по темам в целом (для полноты): сами форумные темы в **группах** появились в Bot API 6.3 (5 ноября 2022, раздел «Topics in Groups»): «Added support for Topics in Groups» и метод createForumTopic. Новых изменений по темам в личных чатах после 9.4 вплоть до актуальной версии changelog **не было**.

### 4. Точный состав методов Bot API для личных чатов

**Утверждение.** Доступно: createForumTopic, editForumTopic, deleteForumTopic, unpinAllForumTopicMessages. Недоступно (описано только для supergroup): closeForumTopic, reopenForumTopic, все методы General-топика, а также любой листинг тем.

Цитаты со страниц методов (https://core.telegram.org/bots/api , якоря указаны):

- createForumTopic (https://core.telegram.org/bots/api#createforumtopic): «Use this method to create a topic in **a forum supergroup chat or a private chat with a user**. In the case of a supergroup chat the bot must be an administrator in the chat for this to work and must have the *can_manage_topics* administrator right. **Returns information about the created topic as a ForumTopic object.**» Параметры: «name | String | Yes | Topic name, **1-128 characters**»; «icon_color | Integer | Optional | … must be one of **7322096 (0x6FB9F0), 16766590 (0xFFD67E), 13338331 (0xCB86DB), 9367192 (0x8EEE98), 16749490 (0xFF93B2), or 16478047 (0xFB6F5F)**»; «icon_custom_emoji_id | String | Optional | … Use getForumTopicIconStickers to get all allowed custom emoji identifiers». Требования администратора для приватного чата не указаны (их нет по определению — бот и есть владелец чата).
- editForumTopic (…/bots/api#editforumtopic): «edit name and icon of a topic in **a forum supergroup chat or a private chat with a user**…»; «name | String | Optional | New topic name, **0-128 characters**. If not specified or empty, the current name of the topic will be kept.»
- deleteForumTopic (…/bots/api#deleteforumtopic): «delete a forum topic **along with all its messages** in a forum supergroup chat or **a private chat with a user**…» (для supergroup требуется право can_delete_messages).
- unpinAllForumTopicMessages (…/bots/api#unpinallforumtopicmessages): «clear the list of pinned messages in a forum topic in a forum supergroup chat or **a private chat with a user**…».
- closeForumTopic (…/bots/api#closeforumtopic): «close an open topic in **a forum supergroup chat**. The bot must be an administrator…» — приватные чаты не упомянуты.
- reopenForumTopic (…/bots/api#reopenforumtopic): «reopen a closed topic in **a forum supergroup chat**…» — приватные чаты не упомянуты.
- getForumTopicIconStickers (…/bots/api#getforumtopiciconstickers): «get custom emoji stickers, which can be used as a forum topic icon by any user. Requires no parameters.» — единственный «читающий» метод про темы.
- Полный индекс методов (https://core.telegram.org/bots/api , список методов, блок Forum topics) содержит ровно: getForumTopicIconStickers, createForumTopic, editForumTopic, closeForumTopic, reopenForumTopic, deleteForumTopic (+ unpinAllForumTopicMessages и методы General-топика в соседнем блоке). **Метода «получить список тем» или «получить тему по id» нет.** Методы General-топика (editGeneralForumTopic, closeGeneralForumTopic, hideGeneralForumTopic, unhideGeneralForumTopic, unpinAllGeneralForumTopicMessages) описаны только для supergroup.

**Утверждение (лимиты).** Единственные задокументированные лимиты: длина имени (1–128 при создании, 0–128 при редактировании) и фиксированный набор из шести цветов иконки. Лимит на количество тем в чате в первоисточниках не найден (см. «Что не удалось подтвердить»).

### 5. Типы: ForumTopic, ForumTopicCreated, ForumTopicEdited

**Утверждение.** createForumTopic возвращает ForumTopic; о создании темы бот узнаёт по сервисному сообщению forum_topic_created (ForumTopicCreated); переименование — forum_topic_edited (ForumTopicEdited).

Цитаты (https://core.telegram.org/bots/api#forumtopic , …#forumtopiccreated , …#forumtopicedited):

- ForumTopic: «message_thread_id | Integer | Unique identifier of the forum topic»; «name | String»; «icon_color | Integer»; «icon_custom_emoji_id | String | *Optional*»; «**is_name_implicit** | True | *Optional*. **True, if the name of the topic wasn’t specified explicitly by its creator and likely needs to be changed by the bot**».
- ForumTopicCreated: «name | String»; «icon_color | Integer»; «icon_custom_emoji_id | String | *Optional*»; «**is_name_implicit** | True | *Optional*» — «This object represents a service message about a new forum topic created in the chat.» (ограничение по типу чата в описании нет).
- ForumTopicEdited: «name | String | *Optional*. New name of the topic, if it was edited»; «icon_custom_emoji_id | String | *Optional*… an empty string if the icon was removed».

Поле «is_name_implicit» появилось ровно в разделе 9.3 «Topics in private chats» — оно осмыслено прежде всего для тем, создаваемых пользователем в DM (имя генерируется автоматически, и бот-владелец может его поменять).

### 6. Как бот обнаруживает режим и адресует сообщения

**Утверждение.** Режим тем в DM виден только через getMe (флаги на «User»); у «Chat» признака форумности для приватных чатов нет; адресация — параметр «message_thread_id» в send-методах; входящие — по «Message.message_thread_id»/«is_topic_message».

Цитаты:

- User (https://core.telegram.org/bots/api#user): «**has_topics_enabled** | True | *Optional*. **True, if the bot has forum topic mode enabled in private chats. Returned only in getMe.**»; «**allows_users_to_create_topics** | True | *Optional*. **True, if the bot allows users to create and delete topics in private chats. Returned only in getMe.**»
- Chat (…/bots/api#chat): «**is_forum** | True | *Optional*. **True, if the supergroup chat is a forum (has topics enabled)**» — сформулировано только для supergroup.
- Message (…/bots/api#message): «**message_thread_id** | Integer | *Optional*. **Unique identifier of a message thread or forum topic to which the message belongs; for supergroups and private chats only**»; «**is_topic_message** | True | *Optional*. **True, if the message is sent to a topic in a forum supergroup or a private chat with the bot**».
- sendMessage (…/bots/api#sendmessage): «**message_thread_id** | Integer | Optional | Unique identifier for the target message thread (topic) of a forum; **for forum supergroups and private chats of bots with forum topic mode enabled only**».
- sendMediaGroup (…/bots/api#sendmediagroup): параметр «message_thread_id» с той же формулировкой («for forum supergroups and private chats of bots with forum topic mode enabled only»). Иного поведения медиагрупп по темам документация не описывает: медиагруппа целиком уходит в указанную тему.
- sendChatAction (…/bots/api#sendchataction): «message_thread_id | Integer | Optional | Unique identifier for the target message thread…; **for supergroups and private chats of bots with forum topic mode enabled only**».

Следствие для pi-chat: фактическую принадлежность сообщения теме бот узнаёт только из входящих сообщений; единый «флаг форумности чата» из getChat для DM получить нельзя.

### 7. MTProto-семантика: кто создаёт темы, «General», удаление, ошибки

**Утверждение.** На уровне MTProto: бот в режиме «Threaded mode» может создавать/менять/удалять темы в чатах с пользователями; пользователь — только если бот выставил флаг «bot_forum_can_manage_topics»; у каждого форума есть неудаляемый «General»-топик с id=1, куда попадают сообщения без темы; удаление темы удаляет все её сообщения, включая сервисное сообщение о создании, и доставляется как updateDeleteMessages (для бот-форумов).

Цитаты (https://core.telegram.org/api/forum , если не указано иное):

- Флаги User: «**bot_forum_view** | flags2.16?true | Whether the bot behaves like a forum, i.e. the Threaded mode was activated for it in @botfather»; «**bot_forum_can_manage_topics** | flags2.17?true | Whether the bot allows users to create and modify forum topics in the private chat with it».
- Про управление темами пользователями: «If set, users can create, modify and delete topics in the private chat with the bot, otherwise this is not possible. **Controlled by the «Disallow users to create new threads» toggle in @botfather, in the Edit bot section: if enabled, only the bot can create, modify or delete topics**», а попытки со стороны пользователя завершаются RPC-ошибкой **BOT_FORUM_CREATE_FORBIDDEN**.
- «**Note: the API always allows users to send topic-less messages (that end up in the «General» topic), regardless of the value of this flag; however, graphical clients should automatically create a topic before sending any message (in which case the topic-less message is never sent).**» Рядом: если флаг сброшен, клиент показывает подсказку «Type any message to create a new thread».
- «**Every forum has a non-deletable «General» topic, with id=1. As for other topics, their ID is equal to the identifier of the messageActionTopicCreate service message that generated them.**» (раздел «Forum topics»). Далее: только «General» может быть скрыт (messages.hideForumTopic); методы модификации тем доступны: пользователям с правами manage_topics (группы-форумы), ботам (бот-форумы), любому пользователю (бот-форумы при bot_forum_can_manage_topics).
- Создание темы: messages.createForumTopic генерирует сервисное сообщение messageActionTopicCreate; правка — messages.editForumTopic → messageActionTopicEdit (разделы о создании/правке тем).
- Удаление: «messages.deleteTopicHistory deletes the whole topic history, including all messages and the topic itself»; «**deleting a topic deletes all of its messages, including the «topic created» service message**»; обновления: «updateDeleteChannelMessages (for groups) or **updateDeleteMessages (for bot forums, i.e. private chats with users)**»; при запросе messages.getForumTopicsByID для удалённой темы может вернуться forumTopicDeleted (раздел «Deleting forum topics»).
- Уведомления: объект forumTopic содержит «notify_settings | PeerNotifySettings» — настройки уведомлений **на тему** (схема forumTopic в разделе «Forum topics»).
- «Note: this feature is subject to an additional fee for Telegram Star purchases as described in Section 6.2.6 of our Terms of Service for Bot Developers.» (https://core.telegram.org/api/forum , вводный раздел; дублируется на /api/bots/ai).

### 8. Стриминг ответов по темам (важно для AI-чатботов)

**Утверждение.** Live-черновики (потоковый показ генерации) маршрутизируются по темам бот-форума; лимиты задокументированы.

Цитаты (https://core.telegram.org/api/bots/ai , раздел «Live response streaming»):

- «Every live draft is identified by a combination of the following values: **Live draft ID, contained in sendMessageTextDraftAction.random_id; Chat ID; Topic ID (for bot forums)**.»
- «Max **20 calls in 5 seconds**; Max **40 calls in 30 seconds**. These ratelimits apply per peer…»; «The same ratelimits apply to the bot API counterparts of messages.setTyping, like **sendMessageDraft**, sendChatAction, and so on.»

### 9. ToS: коммерческое условие фичи

**Утверждение.** Включение тем в приватных чатах влечёт комиссию 15% с покупок Telegram Stars внутри бота/Mini App, пока фича включена.

Цитата (https://telegram.org/tos/bot-developers , раздел **«6.2.6. Enabling Topics in Private Chats»**):

- «Developers may use @BotFather to enable topics in private chats for one or more **eligible TPAs** they own, thereby permitting the use of topics in one-on-one chats with users and the streaming of message drafts…»
- «By enabling topics in private chats for a TPA, developers acknowledge and agree that **all subsequent Telegram Stars purchases carried out within that TPA shall be subject to a non-refundable fee of 15%**, which will be automatically withheld by Telegram. This fee shall apply only for the duration that topics in private chats remain enabled for the TPA.»

Здесь TPA = «Third Party Apps» — «Bots and Mini Apps» (определение в преамбуле того же документа). Ссылка на этот раздел стоит прямо на странице /api/forum рядом с описанием Threaded mode.

### 10. DirectMessagesTopic — другая фича, не путать

**Утверждение.** Класс «DirectMessagesTopic» и параметр «direct_messages_topic_id» относятся к «прямым сообщениям каналов» (MTProto monoforum), а не к темам в DM с ботом.

Цитаты:

- Changelog (https://core.telegram.org/bots/api-changelog , раздел «Bot API 9.2», 15 августа 2025, подраздел «Direct Messages in Channels»): новые поля «is_direct_messages», «direct_messages_topic», «parent_chat» и параметр «direct_messages_topic_id» в send-методах.
- https://core.telegram.org/bots/api#directmessagestopic : «**DirectMessagesTopic** — Describes a topic of a **direct messages chat**. | topic_id | Integer | … | user | User | *Optional*. Information about the user that created the topic.»
- https://core.telegram.org/bots/features (раздел «Direct Messages in Channels»): «Channels can have a dedicated forum-like directory for direct messages where users can privately **contact the channel** staff in a chat topic…»
- MTProto: https://core.telegram.org/api/monoforum («Monoforums») — отдельный механизм переписки подписчиков с каналом.

### 11. Следствия для дизайна pi-chat (кратко)

- Модель «одна тема DM = один workspace/сессия» **реализуема**: бот включает Threaded mode через @BotFather, сам создаёт темы через createForumTopic (id темы = message_thread_id) и адресует все отправки параметром message_thread_id.
- Список тем через API не получить — маппинг «message_thread_id → workspace» нужно вести самому, наполняя его из ответов createForumTopic и из входящих сервисных сообщений forum_topic_created.
- Входящее сообщение темы отличать по message.is_topic_message + message.message_thread_id; признак Chat.is_forum для DM бесполезен.
- Функций close/reopen темы в DM нет; удаление темы пользователем бот напрямую не увидит (нет соответствующего update) — нужен reconciliation (например, обработка ошибки при отправке в несуществующую тему).
- До включения фичи учесть условие ToS §6.2.6 (15% с Stars-покупок, пока включено).

---

## Что не удалось подтвердить

Перечислено явно, чтобы не принимать на веру:

1. **Приходит ли боту сервисное сообщение forum_topic_created в DM, когда тему создаёт пользователь** (а не сам бот). Прямой фразы в Bot API-документации нет: описание Message.forum_topic_created не привязано к типу чата, а MTProto-документация подтверждает лишь генерацию сервисного сообщения messageActionTopicCreate при создании темы вообще. Вывод «приходит» — сильное следствие (в т.ч. из добавления is_name_implicit именно в разделе 9.3), требующее живой проверки.

2. **Семантика «General»-топика (id=1) на уровне Bot API в DM.** MTProto гарантирует неудаляемый General с id=1 и что сообщения без темы попадают туда; но Bot API нигде не пишет, можно ли в приватном чате указать message_thread_id=1 и считается ли отправка без message_thread_id отправкой в General.

3. **Автогенерация имени темы из первого сообщения** (is_name_implicit=true) для пользовательских тем в DM — предполагается, но нигде не сформулирована явно.

4. **Максимальное количество тем в чате** — ни Bot API, ни /api/forum лимита не называют.

5. **Фактическая ошибка closeForumTopic/reopenForumTopic в приватном чате.** Документация просто не упоминает приватные чаты (как и changelog 9.3); явного «не поддерживается» нет. Проверка — только живым вызовом.

6. **Как Bot API-бот узнаёт об удалении темы пользователем.** Сервисного типа ForumTopicDeleted в Bot API нет, update об удалении обычных сообщений в DM нет (есть только BusinessMessagesDeleted для business-соединений). MTProto доставляет updateDeleteMessages, но Bot API его не отдаёт. Поведение API при отправке в удалённую тему (какая ошибка) не задокументировано.

7. **Критерий «eligible TPAs»** в ToS §6.2.6 — условия отбора ботов, для которых доступна фича, в тексте раздела не раскрыты.

8. **Поведение уведомлений на уровне Bot API**: MTProto имеет per-topic notify_settings, Bot API их не показывает; как сервер решает, когда доставить push по теме бота, — не задокументировано.

9. **Нуждается ли приём forum_topic_* сервисных сообщений в DM в специальном allowed_updates** — в документации getUpdates/allowed_updates отдельные значения для сервисных сообщений тем не описаны (они приходят внутри обычного update типа message); прямого подтверждения нет.

---

### Первоисточники (все проверены 2026-11-01)

- Changelog: https://core.telegram.org/bots/api-changelog (разделы «Bot API 6.3», «9.2», «9.3» → «Topics in private chats», «9.4»; актуальная версия на дату исследования — Bot API 10.3 от 24 августа 2026, изменений по темам в DM после 9.4 нет)
- Методы: https://core.telegram.org/bots/api#createforumtopic , #editforumtopic , #deleteforumtopic , #closeforumtopic , #reopenforumtopic , #unpinallforumtopicmessages , #getforumtopiciconstickers , #sendmessage , #sendmediagroup , #sendchataction
- Типы: https://core.telegram.org/bots/api#user , #chat , #message , #forumtopic , #forumtopiccreated , #forumtopicedited , #directmessagestopic ; список типов: https://core.telegram.org/bots/api/types
- MTProto: https://core.telegram.org/api/forum (разделы «Forum topics», флаги bot_forum_*, «Deleting forum topics»), https://core.telegram.org/api/bots/ai , https://core.telegram.org/api/monoforum
- Обзор для разработчиков: https://core.telegram.org/bots/features (раздел «Topics in Private Chats»)
- Условия использования: https://telegram.org/tos/bot-developers , раздел 6.2.6 «Enabling Topics in Private Chats»
