Основной документ: `docs/handover/2026-09-19-pre-launch-qa.md`. Здесь — ответы на точечные вопросы рядом с ним.

База проверки: ветка main, Worker `066aad86`.

## Q1. Протухает ли сессия в boks?

Коротко: access-токен живёт час, сама сессия бессрочна, пока браузер её обновляет; «протухание», которое видит пользователь, — это не таймер, а сорванный refresh (долгий сон устройства, чистка хранилища, удаление аккаунта).

`jwt_expiry = 3600` — access-токен живёт 1 час (`supabase/config.toml:179`); ротация refresh-токенов включена, окно повторного использования 10 с (`supabase/config.toml:185`, `supabase/config.toml:188`).

Абсолютного срока сессии и таймаута по бездействию нет: блок `[auth.sessions]` с `timebox` и `inactivity_timeout` закомментирован (`supabase/config.toml:300-305`), то есть refresh-токен не истекает сам по себе.

Важная оговорка: `supabase/config.toml` — локальная конфигурация, и `config push` в этом проекте сознательно избегают из-за SMTP (`docs/local-environment-runbook.md:330-352`, `docs/hosting.md:75`). Реальные значения прод-проекта `vcmrvnihbptostnzaean` из кода не проверяются — их видно только в дашборде Supabase.

Клиент создаётся с `persistSession: true`, `autoRefreshToken: true`, `flowType: "pkce"` (`lib/boks/supabase-client.ts:13-22`), хранилище по умолчанию — `localStorage`, ключ `sb-vcmrvnihbptostnzaean-auth-token` (`lib/boks/supabase-client.ts:70-79`).

Пока вкладка на переднем плане, auth-js обновляет токен сам: тик раз в 30 с, обновление за 90 с до истечения (`node_modules/@supabase/auth-js/dist/main/lib/constants.js:6`, `:9`, `:13`); в фоне обновление остановлено и возобновляется по `visibilitychange` через `_recoverAndRefresh` (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:4079-4125`) — версия 2.116.0 (`package.json:35`).

Именно этот возврат во вкладку повторно эмитит `SIGNED_IN`, поэтому в ридере он отфильтрован по identity из `INITIAL_SESSION`, иначе лента перезагружалась при каждом возврате (`components/boks/reader-feed.tsx:613-645`).

Обработчика `SIGNED_OUT` и `TOKEN_REFRESHED` в приложении нет — не найдено: единственные подписки на `onAuthStateChange` это `components/boks/reader-feed.tsx:625` и кэш токена в `lib/boks/supabase-client.ts:39-41`. Сессия, умершая между действиями, обнаруживается только при следующем обращении к Supabase.

Гость: если сессии нет или refresh отклонён, `getAnonymousSupabaseUserId` чистит хранилище и заводит **нового** анонимного пользователя (`lib/boks/supabase-client.ts:182-198`), а он вызывается на каждой загрузке ленты (`components/boks/supabase-browser-data.ts:144`). Серверная история гостя привязана к user_id (`components/boks/supabase-browser-data.ts:1232-1241`), поэтому она осиротеет, а лимит «15 боксов» и профиль ранжирования переживут смену: они в localStorage (`components/boks/reader-behavior.ts:4-11`, `:98-118`) и чистятся только при выходе (`components/boks/reader-behavior.ts:72-87`).

Вошедший по ссылке: та же ошибка refresh приводит к `forgetBrokenSession` — токен удаляется, и `getCurrentSupabaseUser` возвращает null (`lib/boks/supabase-client.ts:94-97`, `:200-213`), то есть читатель молча становится гостем; при следующей загрузке ридер открывает панель входа с сохранённым сообщением (`components/boks/reader-feed.tsx:466-479`).

Дефект, косметический, но сбивает с толку: «Invalid Refresh Token» и «expired» попадают в ту же ветку, что и протухшая magic-ссылка, и человеку, который просто неделю не заходил, показывают «This sign-in link has expired or was already used. Request a new one» (`lib/boks/supabase-client.ts:99-109`, `lib/boks/magic-link-errors.ts:18-26`).

Дефект, редкий и заметный: комментарий в Worker обещает, что клиент обновит сессию и повторит запрос на 401 (`app/api/feed/route.ts:100-103`), но `loadWorkerReaderFeed` просто бросает на `!response.ok` (`components/boks/supabase-browser-data.ts:206`), а вызывающий открывает 15-минутный брейкер (`components/boks/supabase-browser-data.ts:158-162`, `components/boks/worker-feed-breaker.ts:19`) — один отвергнутый токен переводит браузер на деградированное ранжирование на 15 минут даже после восстановления сессии. Ретрая на 401 в клиенте не найдено.

Токен читается из кэша без проверки срока (`components/boks/supabase-browser-data.ts:281-287`); кэш обновляется слушателем auth-состояния (`lib/boks/supabase-client.ts:39-41`), так что он свеж ровно настолько, насколько отработал auto-refresh.

База данных JWT не отзывает: блокировка и удаление аккаунта проверяются на каждой записи триггером (`supabase/migrations/20260919200000_boks_admin_content_and_user_lifecycle.sql:89-117`), поэтому приостановленный читатель до часа ходит с рабочей сессией и получает «This boks account is suspended.» на любое действие; после удаления аккаунта строка в `auth.users` удаляется (`supabase/migrations/20260919260000_boks_prelaunch_fixes.sql:536`), и сессия умирает на ближайшем refresh — сам инициатор удаления разлогинивается сразу (`components/boks/user-auth-panel.tsx:391-395`).

Выход с устройства теперь локальный, чужие устройства не трогает (`lib/boks/supabase-client.ts:417-424`), а неудачная magic-ссылка больше не удаляет живую сессию (`lib/boks/supabase-client.ts:81-91`).

Sources read: `supabase/config.toml`, `lib/boks/supabase-client.ts`, `lib/boks/magic-link-errors.ts`, `components/boks/reader-feed.tsx`, `components/boks/reader-behavior.ts`, `components/boks/supabase-browser-data.ts`, `components/boks/worker-feed-breaker.ts`, `components/boks/user-auth-panel.tsx`, `app/api/feed/route.ts`, `supabase/migrations/20260919200000_boks_admin_content_and_user_lifecycle.sql`, `supabase/migrations/20260919260000_boks_prelaunch_fixes.sql`, `node_modules/@supabase/auth-js/dist/main/{GoTrueClient.js,lib/constants.js}`, `docs/local-environment-runbook.md`, `git log -- lib/boks/supabase-client.ts`

## Q2. Доходят ли эмбеддинги до ранкера?

Да, доходят и влияют на выдачу — на обоих путях подачи ленты, и у гостей тоже. Проверено по коду и живыми запросами к проду 2026-09-21 (Worker `9b77df13`, 43 миграции, каталог 447/447 эмбеддирован).

Маппер один, а не два: воркерный путь `/api/feed` вызывает RPC в `lib/boks/feed-service.ts:214` и отдаёт строки в `candidatesFromRollupRows` (`lib/boks/feed-service.ts:218`), браузерный путь делает то же в `components/boks/supabase-browser-data.ts:351` и `:361`. Обе ветки импортируют одну и ту же функцию из `lib/boks/supabase-reels.ts:127`, где новые поля и разбираются (`:167-170`, хелпер `toSimilarity` превращает `numeric`-строку PostgREST в число, а `null` оставляет `null`). Отдельного REST-маппинга нет: в `lib/boks/supabase-rest.ts` слова `get_recommendation_candidates` и `StoryCandidate` не найдены — это транспорт, а не разбор строк.

`for_you` читает поля напрямую: `lib/boks/recommendations/strategies/for-you.ts:108-110` (`semanticStanding` собирает `tasteSamples`, спред по `tasteSimilarity` и по `noveltyDistance` на весь набор) и `:190-191` (`standing()` даёт z-оценку кандидата). Вклад начисляется в `baseContributions` и попадает в `explanations`, которые сохраняются в `served_feed_item` (`lib/boks/feed-service.ts:330`), так что семантический вклад потом виден в аудите выдачи.

Гость получает вектор вкуса — это главное, что стоило проверить. `record_recommendation_events` пишет `user_id := auth.uid()` (`supabase/migrations/20260913200000_boks_feed_provenance.sql:8`), а анонимная сессия — это полноценный `auth.uid()`, поэтому события `complete` гостя видны CTE `my_taste` в `supabase/migrations/20260920140000_boks_candidates_language_and_vectors.sql`. На проде это подтверждено на живом анонимном читателе `94be21db`: 2 события `complete` → `tasteSamples = 2`, `tasteSimilarity` не `null` у всех 80 кандидатов (0.835…0.917), `noveltyDistance` у всех 80.

Порог достижим с запасом. Замер по тому же набору: `tasteSimilarity` mean 0.8960, sd 0.0160 (порог `spreadOf` — sd ≥ 0.004, то есть в четыре раза ниже), топ 0.9175 → z = 1.34, и 19 из 80 кандидатов стоят ≥ 0.75 sd, то есть классифицируются как `semantic`. Вклад топового кандидата ≈ 1.34 × 1.05 ≈ +1.41, плюс разница источников (`semantic` 1.95 против `discovery` 0.8) — около +2.5 против обычного discovery-кандидата, при том что авторская аффинность даёт ≤ 0.85, а глобальный prior качества ≤ 1.35. Семантика реально двигает порядок, а не шумит на четвёртом знаке.

`noveltyDistance` живёт в узком диапазоне: mean 0.0423 при sd 0.0086 — косинусное расстояние между e5-векторами мало, и мы его ещё делим на два. Абсолютные значения тут бесполезны, но вклад считается от z-оценки, а не от сырого числа, поэтому сигнал работает; порог sd тоже пройден (0.0086 > 0.004).

**Дефект: `semanticTaste` и `semanticNovelty` — мёртвый код (косметика).** Ключи объявлены в `lib/boks/recommendations/signals.ts:152-153` и считаются в `:226-227`, но их не читает никто: единственные потребители сырых полей — `for-you.ts:108-110,190-191`, а `StorySignals` в базу не пишутся (в `record_served_feed` сохраняются только `score`, `delivered_rank` и `explanations`). Ни одна стратегия не объявляет эти веса, так что при переводе трафика на любую взвешенную стратегию (`balanced`, `completion_first`) эмбеддинги не будут учитываться вовсе — это и есть единственное практическое следствие: ключи существуют как крючок, за который пока никто не держится.

Деградированный путь остаётся без семантики, и это правильно: `candidatesFromReelRows` (`lib/boks/supabase-reels.ts:206`) не заполняет новые поля, а во вьюхе `published_boks` колонки `embedding` нет вовсе (проверено: 0 колонок с таким именем). Пока брейкер держит воркер в отказе (2 минуты после сбоя), ранжирование идёт на поведенческих сигналах — `standing()` вернёт 0, и порядок остальных кандидатов не поедет.

Sources read: `lib/boks/feed-service.ts`, `lib/boks/supabase-reels.ts`, `lib/boks/supabase-rest.ts`, `lib/boks/recommendations/signals.ts`, `lib/boks/recommendations/strategies/for-you.ts`, `lib/boks/recommendations/feed.ts`, `components/boks/supabase-browser-data.ts`, `supabase/migrations/20260920140000_boks_candidates_language_and_vectors.sql`, `supabase/migrations/20260913200000_boks_feed_provenance.sql`, живые read-only запросы к проду (события по анонимности, impersonation анонимного читателя в `get_recommendation_candidates`, спред и z-оценки набора)

## Q3. Какие пути добавления текста получают эмбеддинги?

Короткий ответ: **автоматики нет ни на одном из двух входов.** Ни текст, присланный автором, ни массовая загрузка не получают вектор в момент записи — вектор появляется только после ручного запуска `node scripts/embed-catalogue.mjs`.

Путь автора: `submit_bok_for_review` вставляет бок со статусом `pending_review` (`supabase/migrations/20260919260000_boks_prelaunch_fixes.sql:352-361`) и про вектор не знает — слово `embedding` в этой миграции не встречается ни разу (0 вхождений). Одобрение тоже ничего не меняет: `review_bok_submission` только переводит статус в `published` (`:38`), вектора не создаёт.

Путь массовой загрузки: `import_boks_batch` вставляет боки и их права (`supabase/migrations/20260916140000_boks_rights_and_reports.sql`, 0 вхождений `embedding`). Мой загрузчик curated-партий `scripts/build-catalogue-sql.mjs` тоже только пишет текст и права — он лишь показывает в итоговом отчёте, сколько строк осталось без вектора (`scripts/build-catalogue-sql.mjs:389`).

Единственный путь, который реально пишет вектор, — `scripts/embed-catalogue.mjs:116` (локальный ONNX, ~7 боков в секунду). Он забирает всё, у чего вектора нет или он от снятой модели, в статусах `published` и `pending_review` (`scripts/embed-catalogue.mjs:74`).

Edge Function `embed` писать не может **по замыслу**: она отправляет `p_model: "gte-small"` (`supabase/functions/embed/index.ts:105`), а `set_bok_embedding` поднимает `22023` для любой модели, кроме `boks_embedding_model()` = `multilingual-e5-small` (`supabase/migrations/20260920120000_boks_single_embedding_model.sql`), с текстом «This catalogue is embedded with multilingual-e5-small; refusing a vector from gte-small». Оговорка: живьём отказ сейчас не воспроизвести — очередь пуста, функция вернула `found: 0` и до записи не дошла; сам страж наблюдался в работе вчера в схемном гейте, где он отклонил вектор от `test-model` с тем же кодом.

Что в очереди, а что нет: `get_boks_needing_embedding` берёт статусы `published` и `pending_review` (`supabase/migrations/20260920120000_boks_single_embedding_model.sql:97`), то есть присланный автором бок стоит в очереди с момента отправки, а не с момента одобрения — прогонять скрипт можно и до модерации. Архивные и удалённые боки в очередь не попадают.

Правка текста вектор сбрасывает, и это правильно: триггер `boks_reels_clear_stale_embedding` висит на `before update of text` (`supabase/migrations/20260920100000_boks_embeddings.sql:62`). Поэтому пересдача бока автором (`submit_bok_for_review` обновляет `text` при ревизии, `20260919260000:71-79`) и ремонтный путь загрузчика (`scripts/build-catalogue-sql.mjs:406`) возвращают бок в очередь на переэмбеддирование.

Живые факты на 2026-09-21: `boks_embedding_coverage()` → 547 published, 547 embedded, `publishedMissing: 0`, модель `multilingual-e5-small`, `lastEmbeddedAt` 13:48 UTC (то есть скрипт сегодня уже прогоняли — каталог вырос с 447 до 547, и новая сотня вектора получила). Боков в `pending_review` сейчас 0, без вектора — 0.

**Дефект: ручной шаг после каждой модерации (не блокер — ранкер деградирует безопасно, но забывается молча).** Присланный автором текст до прогона скрипта участвует в ранжировании только поведенческими сигналами: `tasteSimilarity` и `noveltyDistance` у него `null`, вклад = 0, и никакой ошибки нигде не появится. Что делать руками: после одобрения партии присланных боков (или после любой правки текстов) выполнить `node scripts/embed-catalogue.mjs` из корня репозитория; проверить результат — `publishedMissing` в `boks_embedding_coverage()`, он же виден в админке во вкладке Content.

Sources read: `supabase/migrations/20260919260000_boks_prelaunch_fixes.sql`, `supabase/migrations/20260916140000_boks_rights_and_reports.sql`, `supabase/migrations/20260920100000_boks_embeddings.sql`, `supabase/migrations/20260920120000_boks_single_embedding_model.sql`, `scripts/build-catalogue-sql.mjs`, `scripts/embed-catalogue.mjs`, `supabase/functions/embed/index.ts`, живые read-only запросы (`boks_embedding_coverage()`, `pending_review` без вектора) и один вызов функции `embed`, который вернул пустую очередь

## Q4. Когда бок считается прочитанным (complete)?

Сначала главное про терминологию: **в `reels.status` никакого `finished` нет** — ограничение таблицы допускает только `draft`, `pending_review`, `published`, `rejected`, `archived` (проверено на проде: `CHECK ((status = ANY (ARRAY['draft','pending_review','published','rejected','archived']))))`. «Прочитан» — это исход чтения у конкретного читателя, он живёт в событиях, а не в статусе бока.

Исходов ровно два: `complete` или `skip`, третьего нет (`components/boks/reader-behavior.ts:49-61`). Правило считается от ожидаемого времени чтения: `expectedReadingSeconds` = слова / 238 в минуту, при этом слова берутся из `word_count`, а `minutes × 220` — только запасной вариант, и итог не меньше 20 секунд (`components/boks/reader-behavior.ts:38-41`).

Три ветки, в этом порядке: `skip`, если активных секунд меньше `max(5, ожидание × 0.25)` (`:53`); `complete`, если прокрутка дошла до 85% и активных секунд не меньше `ожидание × 0.4` (`:56`); иначе `complete` только при активных секундах ≥ `ожидание × 0.7`, и `skip` во всех остальных случаях (`:60`).

Секунды — только передний план: часы accrue время лишь пока страница видима, и признак — видимость, а не фокус, потому что на iOS клавиатура комментария снимает фокус в самый вовлечённый момент (`components/boks/reader-clock.ts:10-16`). Каждое начисление ограничено `maxGapSeconds`, по умолчанию 120 (`components/boks/reader-clock.ts:52`), чтобы уснувший ноутбук не записал шестичасовое чтение.

Прогресс — это прокрутка контейнера текста, и здесь есть подвох: если текст целиком влез в экран (`scrollHeight <= clientHeight + 4`), прогресс жёстко равен **0**, а не 1 (`components/boks/reader-feed.tsx:1190`). Значение всегда максимум из ранее достигнутого (`:1192`).

Поводы зафиксировать исход: переход к следующему боку и к предыдущему (`components/boks/reader-feed.tsx:1260` и `:1124`), а также `pagehide` и размонтирование ридера (`:548`, `:556-562`). Уход в фон **исход не пишет** — намеренно: взгляд на уведомление через три секунды иначе навсегда зафиксировал бы `skip`, поэтому вместо вердикта отправляется heartbeat и вердикт остаётся открытым (`:538-545`, `:549-552`).

Последний бок сессии фиксируется: закрытие вкладки даёт `pagehide`, уход с ленты — размонтирование, оба ведут в `recordOutcomeRef.current("exit")`. Повторно один и тот же бок не пишется: ключ `sessionId:storyId` в `trackedOutcomes` даёт один вердикт на пару «сессия + бок» (`:1216-1219`).

Что в базе. Событие `complete` в `recommendation_events` со значением `max(5, активные секунды)` (у `skip` значение 1) и метаданными `from`, `inferred`, `progress` (`:1237-1243`). У кандидата `mine.completedAt` — это время первого события `complete` (`supabase/migrations/20260920140000_boks_candidates_language_and_vectors.sql:186`, `:242`). Таблица `views` — про другое: она пишется на **impression**, то есть на показ бока (`components/boks/reader-feed.tsx:704-705`, `components/boks/supabase-browser-data.ts:1294-1299`), и служит списку «недавно прочитанное»; ранкер её не читает — в RPC кандидатов `public.views` не встречается.

Ранкер использует именно `complete`: из этих событий строится вектор вкуса (CTE `my_taste`) и «последние прочитанные» для новизны, а `completedAt` даёт штраф за уже прочитанное. Предложение оставить отзыв на 3/10/30 боках тоже считает только `complete` (`components/boks/reader-feed.tsx:1229-1237`).

**Дефект: системный перекос против короткой лирики (не поломка, но занижает и finish rate, и вектор вкуса).** Для пьесы в один экран ветка «85% прокрутки» недостижима по построению — прогресс там 0, — поэтому остаётся только время ≥ 70% ожидания, а с полом в 20 секунд любое короткое стихотворение требует ≥ 14 секунд переднего плана. Читатель, честно прочитавший четверостишие за 8 секунд, записывается как `skip`. В каталоге около 60% поэзии, так что перекос затрагивает большинство. Разумная правка: считать прогресс равным 1, когда текст не требует прокрутки, и оставить временной порог как второе условие.

Отдельно про скрытую вкладку: сам уход в фон вердикта не пишет, но **навигация в скрытой вкладке даёт `skip`** — часы в фоне не идут, активных секунд около нуля, и первая же ветка правила срабатывает. Именно это и произошло при программном пролистывании во время тестов.

Sources read: `components/boks/reader-behavior.ts`, `components/boks/reader-clock.ts`, `components/boks/reader-feed.tsx`, `components/boks/supabase-browser-data.ts`, `supabase/migrations/20260920140000_boks_candidates_language_and_vectors.sql`, `supabase/migrations/20260910091318_boks_initial_public_schema.sql`, живой read-only запрос (`pg_constraint` по `reels.status`, счёт строк `views`)

## Q5. Влияет ли автор на ранжирование при одном издателе?

Короткий ответ: **на порядок выдачи автор сегодня не влияет никак, кроме разнесения в слейте.** Все 547 опубликованных боков лежат под одним аккаунтом (живой запрос: 1 `author_user_id`, 138 разных `author_name`), а вся персонализация по автору ключуется на аккаунте, поэтому она даёт всем кандидатам одно и то же число — а константа порядок не меняет.

`authorAffinity` мёртв по построению: профиль агрегирует историю читателя по `candidate.authorUserId` (`lib/boks/recommendations/reader-profile.ts:158-162`), ранкер читает `profile.authorAffinity[candidate.authorUserId]` (`lib/boks/recommendations/strategies/for-you.ts:185-186`). Ключ один, значение у всех 547 боков одинаковое, вклад `±0.85` сдвигает все оценки одинаково. Хуже: лайки и скипы любого из 138 писателей сваливаются в один счётчик «нравится ли мне @boks».

`isFollowingAuthor` — тоже по аккаунту (`lib/boks/recommendations/reader-profile.ts:68-70`), то есть либо +0.7 всем кандидатам, либо никому; порядок не меняется. Заодно подписка на @boks означает подписку на всех 138 писателей сразу.

`authorTrust` = `log1p(followers) × 0.24` (`lib/boks/recommendations/strategies/for-you.ts:672`), а `authorFollowers` приходит из БД посчитанным по `author_user_id`. Живой замер по набору из 200 кандидатов: `authorFollowers` = 2 у всех (1 различное значение), `authorPublishedCount` = 547 у всех. Значит доверие к автору — константа 0.264 для всего каталога.

`coldStartPrior` частично мёртв: ветки `published <= 1` и `published <= 3` (`lib/boks/recommendations/strategies/for-you.ts:690-695`) недостижимы, потому что `published` равно 547 для каждого кандидата. Остаётся ветка по счётчикам самого бока (лайки, комментарии, показы) — она варьируется, но это уже свойство бока, а не автора. Тот же `authorFollowers` входит слагаемым в `qualityPrior` (`:659`), и это слагаемое тоже константа.

Единственное место, где настоящий автор работает, — разнесение в слейте: `authorKey` берёт **сначала байлайн** и только потом аккаунт (`lib/boks/recommendations/strategies/for-you.ts:719-721`), `sameAuthor` сравнивает эти ключи (`:724-725`), а `diversityPenalty` наказывает за подряд идущих однофамильцев. В наборе из 200 кандидатов это 97 разных ключей, так что штраф реально работает и пять стихотворений Фета подряд не выйдут.

Пути, при котором байлайн участвует в персонализации, **не найдено**: в `reader-profile.ts` слово `authorName` не встречается ни разу.

Со стороны БД: `get_recommendation_candidates` считает `author_stats` группировкой по `author_user_id` (CTE `author_stats` в `supabase/migrations/20260920140000_boks_candidates_language_and_vectors.sql`), поэтому `authorPublishedCount` и `authorFollowers` при одном издателе физически не могут различаться между кандидатами.

Минимальная правка выходит небольшой и почти безрисковой. Логика ключа уже написана и проверена — это `authorKey` в `for-you.ts:719`; достаточно вынести её в общий хелпер (например, в `reader-profile.ts`) и ключевать им агрегацию `byAuthor` (`:158-162`) и чтение аффинности (`for-you.ts:185-186`). Подписки при этом остаются на аккаунте (`author_follows.author_user_id`) — это правильно: читатель подписывается на издателя, а не на мёртвого поэта.

Миграции данных не требуется: `authorAffinity` не хранится, а вычисляется из `reader` и текущего набора кандидатов на каждый запрос (`lib/boks/recommendations/reader-profile.ts:135`, вызывается в `for-you.ts:162`). Риск для разнесения авторов — минимальный: оно уже ключуется на байлайне, и извлечение того же хелпера поведение не меняет; правку стоит закрыть тестом «две пьесы одного байлайна не подряд» плюс новым «аффинность накапливается по байлайну, а не по издателю».

Для `authorTrust` и `coldStartPrior` нужна ещё агрегация по `author_name` в RPC — второй CTE рядом с `author_stats` и два дополнительных поля (`bylinePublishedCount`, и подписчиков у байлайна нет, так что доверие честнее считать от счётчиков самого байлайна). Это отдельный шаг, и он не обязателен для того, чтобы персонализация заработала.

**Дефект: персонализация по автору не работает вовсе (не блокер запуска, но это половина смысла `for_you` при каталоге из 138 поэтов).** Читателю, который дочитал три стихотворения Блока, четвёртое стихотворение Блока не поднимается ни на шаг.

Sources read: `lib/boks/recommendations/strategies/for-you.ts`, `lib/boks/recommendations/reader-profile.ts`, `supabase/migrations/20260920140000_boks_candidates_language_and_vectors.sql`, живые read-only запросы (различные значения `authorPublishedCount`/`authorFollowers`/`authorUserId`/`authorName` в наборе кандидатов; счёт аккаунтов и байлайнов в каталоге)

## Q6. DAU за 2026-09-21

Определение в коде уже есть, но недельное: `active_readers` — это различные `user_id` в событиях поверхности `reader` за неделю (`supabase/migrations/20260912200000_boks_growth_and_cohorts.sql:35-38` задаёт CTE `reader_events` как `recommendation_events where surface = 'reader'`, `:57-60` и `:67` считают уникальных читателей). Дневной DAU считаю по тому же правилу, заменив неделю на день; отдельного дневного определения в коде **не найдено**.

Числа на 16:37 UTC 21 сентября (владелец в UTC+3, у него это 19:37, и его «сегодня» началось на три часа раньше начала суток UTC — утренние часы по его времени попадают во «вчера» этого отчёта).

**С тестовым шумом:** 24 читателя с событиями — 4 вошедших и 20 анонимных, 22 различных `visitor_id`. **Без известных тестовых:** 22 читателя (4 вошедших, 18 анонимных), 20 visitor-ов, 39 сессий, 240 событий.

Тестовый список вычитает всего двух: пользователи `ddc9334c…` и `94be21db…` нашлись, а визиторы `boks-reader-0a439765…` и `boks-reader-edc8b2…` дали 38 строк событий, но принадлежат тем же двум читателям, поэтому счёт не уменьшили. То есть **вычитание известных тестов почти ничего не чистит**, и 18 анонимных — это по-прежнему в основном QA с этой машины, отделить их от настоящих людей по данным нельзя.

`served_feed` за сегодня: 29 уникальных `user_id` и 58 сессий — больше, чем читателей с событиями, потому что лента успевает быть отдана и без последующих событий чтения. Колонки `visitor_id` в `served_feed` нет (только `user_id` и `session_id`), поэтому визиторы считаются по `recommendation_events`.

Распределение активности: у вошедших (4) события с 09:17 до 15:44 UTC, двое с 3–9 событиями и двое с 10+. У анонимных (20) — с 03:52 до 15:56 UTC: двое с 1–2 событиями, одиннадцать с 3–9, семеро с 10+.

**Оговорка, которую нужно произнести прямо: анонимная сессия — это не человек.** Очищенный браузер, приватное окно или другое устройство создают нового `user_id`, поэтому анонимный DAU завышает число людей. Мера этого — за сегодня в `auth.users` создано **22 анонимных пользователя** против **одного** настоящего аккаунта: почти каждый «анонимный читатель» в этой метрике родился сегодня, то есть это устройства-сессии, а не возвращающиеся люди.

**Сколько людей реально читали: 2** — столько уникальных читателей имели хотя бы одно событие `complete` сегодня (всего 2 таких события). Это пол, а не измерение: первое `complete` в базе датировано 2026-09-20 11:14, всего их за всю историю 6, потому что запись дочитываний починили только сегодня вечером (деплой `81cb0aa9`). До этого дочитывания почти не фиксировались, так что сравнивать с прошлыми днями бессмысленно.

Честный ответ владельцу одной строкой: **DAU ≈ 22 «читателя» по формальному определению, из них 4 вошедших; людей, дочитавших хотя бы один бок, — 2; и большая часть анонимных — это сегодняшнее тестирование, а не аудитория.** Для наблюдения за запуском осмысленнее смотреть на две метрики: вошедшие читатели и читатели с `complete`.

SQL, которым считалось (воспроизводимо, только чтение): `with reader_events as (select e.user_id, e.visitor_id, e.session_id, e.event_type, e.created_at, coalesce(au.is_anonymous,false) as anonymous from public.recommendation_events e left join auth.users au on au.id = e.user_id where e.surface = 'reader' and e.created_at >= date_trunc('day', now()))` — далее пометка тестовых (`user_id in ('ddc9334c-36c0-4ea4-91d3-c5b4eb99a522','94be21db-30e1-49a3-8959-3298cfc66d30') or visitor_id = 'boks-reader-0a439765-4fbb-43e9-b6bf-01a72476fa2f' or visitor_id like 'boks-reader-edc8b2%'`), агрегация `per_reader` по `(user_id, anonymous)` со счётчиками событий и `complete`, и подсчёты `count(distinct …)`; отдельно `select count(*) filter (where coalesce(is_anonymous,false)) from auth.users where created_at >= date_trunc('day', now())` и `select count(distinct user_id), count(distinct session_id) from public.served_feed where served_at >= date_trunc('day', now())`.

Sources read: `supabase/migrations/20260912200000_boks_growth_and_cohorts.sql`, `components/boks/admin/growth.tsx`, `components/boks/client-types.ts`, живые read-only запросы к проду (`recommendation_events`, `served_feed`, `auth.users`, `information_schema.columns`)
