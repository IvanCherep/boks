Основной документ: `docs/handover/2026-09-19-pre-launch-qa.md`. Здесь — ответы на точечные вопросы рядом с ним.

База проверки: ветка main, Worker `066aad86`, репозиторий `/Users/iegorov/Documents/Codex/2026-09-09/fd`.

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
