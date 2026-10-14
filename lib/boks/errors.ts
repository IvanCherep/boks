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

import type { UiLanguage } from "@/lib/i18n/ui-language";

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
export function localizeBoksMessage(message: string, language: UiLanguage = "en") {
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
 * it replaces would have been the only clue. It is already in `language`; a
 * message that passes through is translated when the sentence is known.
 */
export function readableBoksError(error: unknown, fallback: string, language: UiLanguage = "en") {
  const message = messageOf(error).trim();
  return isReadableBoksError(message) ? localizeBoksMessage(message, language) : fallback;
}
