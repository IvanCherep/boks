/**
 * Turns whatever a Supabase call rejected with into a sentence worth showing.
 *
 * Nothing thrown by `supabase-js` is an `Error`: a PostgREST or GoTrue failure
 * arrives as a plain object carrying `message` and `code`. Every screen tested
 * it with `error instanceof Error ? error.message : "Could not ..."`, so every
 * refusal the database had written a message for - "That nickname is taken.",
 * a daily limit, a length rule - was replaced by a generic line. The reader was
 * told that something went wrong but never what, which is indistinguishable
 * from the action having silently done nothing.
 */

import {
  deviceLanguages,
  readUiLanguagePreference,
  resolveUiLanguage,
  type UiLanguage,
} from "@/lib/i18n/ui-language";

/** Outside React: the interface language this page is showing. English on the server and in tests. */
function pageLanguage(): UiLanguage {
  if (typeof window === "undefined") return "en";
  return resolveUiLanguage(readUiLanguagePreference(), deviceLanguages());
}

/**
 * Fragments that mark a message as database plumbing rather than something a
 * person asked for. These reach a reader as noise at best, and at worst name
 * internal tables, so they are replaced by the caller's fallback. They are the
 * signature of a bug on our side; the deliberate `raise exception` messages in
 * the RPCs read as ordinary sentences and pass through.
 */
const internalMessageMarkers = [
  "violates",
  "duplicate key",
  "syntax error",
  "does not exist",
  "permission denied for",
  "invalid input syntax",
  "null value in column",
  "out of range",
  "deadlock",
  "could not serialize",
  "jwt",
  "row-level security",
];

function messageOf(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function isReadableBoksError(message: string) {
  if (!message.trim()) return false;
  const normalized = message.toLowerCase();
  return !internalMessageMarkers.some((marker) => normalized.includes(marker));
}

/**
 * The sentences a reader can be shown that are written in English somewhere
 * we do not render - the database's `raise exception` messages and the
 * sign-in explanations - in Russian. Exact sentences, because the database
 * is the authority on its rules and its wording; an unknown sentence stays
 * English rather than becoming a wrong guess.
 */
const russianSentences: Record<string, string> = {
  "That nickname is taken.": "Этот никнейм уже занят.",
  "This @nickname is already taken.": "Этот @никнейм уже занят.",
  "That nickname is reserved.": "Этот никнейм зарезервирован.",
  "Enter a nickname.": "Введите никнейм.",
  "A nickname is required.": "Нужен никнейм.",
  "A nickname can only use English letters, numbers and underscores.":
    "В никнейме можно использовать только латинские буквы, цифры и подчёркивания.",
  "A nickname has to start with a letter.": "Никнейм должен начинаться с буквы.",
  "Use at least 3 characters for @nickname.": "В @никнейме должно быть не меньше 3 символов.",
  "Type your nickname exactly to confirm.": "Для подтверждения введите свой никнейм точно.",
  "Sign in required.": "Нужно войти.",
  "Permanent sign in required.": "Нужно войти в аккаунт.",
  "A permanent user account is required.": "Нужен аккаунт.",
  "Sign in required to update your profile.": "Войдите, чтобы изменить профиль.",
  "Sign in to delete your account.": "Войдите, чтобы удалить аккаунт.",
  "Sign in to follow an author.": "Войдите, чтобы подписаться на автора.",
  "Sign in to comment.": "Войдите, чтобы комментировать.",
  "Sign up or sign in to comment.": "Войдите или зарегистрируйтесь, чтобы комментировать.",
  "Create a free account to join the conversation.": "Создайте бесплатный аккаунт, чтобы участвовать в обсуждении.",
  "Create a free account to like comments.": "Создайте бесплатный аккаунт, чтобы лайкать комментарии.",
  "Choose your @nickname before commenting.": "Выберите @никнейм, прежде чем комментировать.",
  "Create your reading profile before commenting.": "Создайте профиль читателя, прежде чем комментировать.",
  "Accept the boks terms before using this feature.": "Чтобы пользоваться этим, примите условия boks.",
  "A comment must be between 1 and 1200 characters.": "Комментарий должен быть от 1 до 1200 символов.",
  "Comments must be 1200 characters or fewer.": "Комментарий - не больше 1200 символов.",
  "Write a comment before sending.": "Сначала напишите комментарий.",
  "Replies can be one level deep.": "Отвечать можно только на один уровень.",
  "A reply must belong to the same boks.": "Ответ должен относиться к тому же тексту.",
  "That comment is no longer available.": "Этот комментарий больше недоступен.",
  "That comment no longer exists.": "Этого комментария больше нет.",
  "That conversation is no longer available.": "Это обсуждение больше недоступно.",
  "This boks is not available for comments.": "Этот текст закрыт для комментариев.",
  "You can delete only your own comments.": "Удалять можно только свои комментарии.",
  "You cannot follow yourself.": "Нельзя подписаться на себя.",
  "That author has nothing published.": "У этого автора пока ничего не опубликовано.",
  "This boks account is suspended.": "Этот аккаунт boks заблокирован.",
  "An admin account cannot delete itself. Remove its admin access first.":
    "Аккаунт администратора не может удалить себя. Сначала снимите права администратора.",
  "Admins cannot delete their own account.": "Администратор не может удалить свой аккаунт.",
  "Event limit reached. Try again later.": "Слишком много событий. Попробуйте позже.",
  "Feed request limit reached. Try again later.": "Слишком много запросов ленты. Попробуйте позже.",
  "Write a line or two first.": "Сначала напишите пару строк.",
  "That is five notes in an hour - thank you, genuinely. Send more a little later.":
    "Пять сообщений за час - спасибо, правда. Остальное пришлите чуть позже.",
  "Enter your email.": "Введите email.",
  "Supabase is not configured.": "Сервер не настроен.",
  // Writing and reporting a bok.
  "A bok must fit inside 15 minutes.": "Бок должен укладываться в 15 минут.",
  "Confirm you hold the rights to publish this bok.": "Подтвердите, что у вас есть права на публикацию этого бока.",
  "Only a refused bok of your own can be revised.": "Исправить можно только свой отклонённый бок.",
  "Sign in required to report a bok.": "Войдите, чтобы пожаловаться на бок.",
  "Sign in required to submit a bok.": "Войдите, чтобы отправить бок.",
  "Story text is required.": "Нужен текст.",
  "Text is required.": "Нужен текст.",
  "Title is required.": "Нужно название.",
  "The text needs at least one line with words in it.": "В тексте должна быть хотя бы одна строка со словами.",
  "Say what is wrong in a sentence or two, so an admin can act on it.":
    "Опишите проблему в одном-двух предложениях, чтобы администратор мог разобраться.",
  "That bok does not exist.": "Такого бока нет.",
  "That boks is not available.": "Этот бок недоступен.",
  "No published bok has that id.": "Нет опубликованного бока с таким id.",
  "That is not a bok id or a bok link.": "Это не id бока и не ссылка на бок.",
  // Studies (`/study/<key>`).
  "A boks session is required.": "Нужна сессия boks. Обновите страницу.",
  "Not a participant of this study.": "Вы не участник этого исследования.",
  "There is no such fragment.": "Такого фрагмента нет.",
  "There is no such study.": "Такого исследования нет.",
  "This participant has already answered everything.": "Вы уже ответили на все вопросы.",
  "This study is not running.": "Это исследование сейчас не проводится.",
  // Studio (admin) refusals.
  "Admin access required.": "Нужны права администратора.",
  "Admins cannot remove their own admin access.": "Администратор не может снять права с себя.",
  "Admins cannot suspend their own account.": "Администратор не может заблокировать свой аккаунт.",
  "At least one active admin must remain.": "Должен остаться хотя бы один активный администратор.",
  "At least one admin must remain.": "Должен остаться хотя бы один администратор.",
  "Anonymous users cannot become admins.": "Гость не может стать администратором.",
  "Revoke admin access before deleting this account.": "Сначала снимите права администратора, потом удаляйте аккаунт.",
  "Revoke admin access before suspending this account.": "Сначала снимите права администратора, потом блокируйте аккаунт.",
  "Unban this account before granting admin access.": "Сначала разблокируйте аккаунт, потом выдавайте права администратора.",
  "Give the user a reason for the suspension.": "Укажите причину блокировки.",
  "Rejection reason is required.": "Укажите причину отказа.",
  "Say why the bok is being taken down. The author sees it.": "Объясните, почему бок снимается. Автор это увидит.",
  "Bok is not available for review.": "Этот бок недоступен для проверки.",
  "Boks does not exist.": "Такого бока нет.",
  "Boks does not exist or is already deleted.": "Такого бока нет, или он уже удалён.",
  "Only a deleted boks can be restored.": "Восстановить можно только удалённый бок.",
  "Only a deleted boks can be permanently deleted.": "Удалить навсегда можно только удалённый бок.",
  "Type the boks title exactly to confirm permanent deletion.": "Для окончательного удаления введите название бока точно.",
  "Type the user nickname exactly to confirm deletion.": "Для удаления введите никнейм пользователя точно.",
  "Confirm publishing rights before restoring this boks.": "Перед восстановлением подтвердите права на публикацию.",
  "Confirm the rights for this batch before importing it.": "Перед импортом подтвердите права на эту партию.",
  "The publishing rights for this boks are not confirmed. Check them in the Rights tab first.":
    "Права на публикацию этого бока не подтверждены. Сначала проверьте их во вкладке «Права».",
  "That report is not open.": "Эта жалоба уже закрыта.",
  "User does not exist.": "Такого пользователя нет.",
  "At least one arm must receive traffic.": "Хотя бы один вариант должен получать трафик.",
  "At least one experiment arm is required.": "Нужен хотя бы один вариант эксперимента.",
  "Give the link a name - who it is for.": "Дайте ссылке имя: для кого она.",
  "Keep the name under 120 characters.": "Имя должно быть короче 120 символов.",
  "No link has that code.": "Нет ссылки с таким кодом.",
  "Could not find a free code; try again.": "Не удалось подобрать свободный код, попробуйте ещё раз.",
  "A code is 1-40 lowercase latin letters, digits and dashes, not starting or ending with a dash.":
    "Код: от 1 до 40 строчных латинских букв, цифр и дефисов, без дефиса в начале и в конце.",
  // Sign-in explanations (`lib/boks/supabase-client.ts`).
  "That code did not work. Check the newest email, or send a new one - asking for a new code stops the old one working.":
    "Код не подошёл. Проверьте самое новое письмо или запросите код ещё раз - новый код отменяет старый.",
  "Too many tries just now. Wait a minute and use the code from the newest email.":
    "Слишком много попыток. Подождите минуту и введите код из самого нового письма.",
  "Could not sign you in with that code.": "Не удалось войти с этим кодом.",
  "boks could not send the email right now. Try again in a few minutes.":
    "boks не смог отправить письмо. Попробуйте через несколько минут.",
  "Too many sign-in emails were requested just now. Try again in a few minutes.":
    "Слишком много писем для входа за короткое время. Попробуйте через несколько минут.",
  "This email could not be signed in.": "С этим email войти не удалось.",
  "This email already has an account. Sign in instead.": "У этого email уже есть аккаунт. Просто войдите.",
  "This sign-in link has expired or was already used. Request a new one - only the newest link works.":
    "Ссылка для входа устарела или уже использована. Запросите новую - работает только самая свежая.",
  "Could not create this account by email link. Try again in a minute.":
    "Не удалось создать аккаунт по ссылке из письма. Попробуйте через минуту.",
  "Could not send the boks email link.": "Не удалось отправить письмо от boks.",
};

const russianPatterns: [RegExp, (...groups: string[]) => string][] = [
  [/^A nickname needs at least (\d+) characters\.$/, (n) => `В никнейме должно быть не меньше ${n} символов.`],
  [/^A nickname can be at most (\d+) characters\.$/, (n) => `В никнейме может быть не больше ${n} символов.`],
  [/^No account holds the nickname @(\S+)\.$/, (h) => `Нет аккаунта с никнеймом @${h}.`],
];

/** A reader-facing English sentence in the interface language, when we know it. */
export function localizeBoksMessage(message: string, language: UiLanguage = pageLanguage()) {
  if (language !== "ru") return message;
  const exact = russianSentences[message.trim()];
  if (exact) return exact;
  for (const [pattern, render] of russianPatterns) {
    const match = message.trim().match(pattern);
    if (match) return render(...match.slice(1));
  }
  return message;
}

/**
 * `fallback` is used when the failure carries no message, or one only a
 * developer should read. It should say which action failed, since the message
 * it replaces would have been the only clue. It is already in `language` (the
 * page's interface language unless a caller says otherwise); a message that
 * passes through is translated when the sentence is known.
 */
export function readableBoksError(error: unknown, fallback: string, language: UiLanguage = pageLanguage()) {
  const message = messageOf(error).trim();
  return isReadableBoksError(message) ? localizeBoksMessage(message, language) : fallback;
}
