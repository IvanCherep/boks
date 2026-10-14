"use client";

import { Button } from "@/components/ui/button";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import {
  readingLanguageNamesIn,
  type EmptyFeedNotice,
  type ReadingLanguage,
} from "@/components/boks/reading-languages";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages(
  {
    add: (names: string[]) => `Add ${names.join(" and ")}`,
    change: "Change my languages",
    unreachableTitle: "boks cannot reach its server from this network",
    unreachableBody:
      "The page loaded, so boks itself is running. What failed is the connection your browser makes next, and that is usually the network in between: another Wi-Fi, mobile data, or a VPN normally fixes it.",
    retry: "Try again",
    stillNothing: "Still nothing? Write to",
    tellProvider: "- tell us your provider and we will move the address boks talks to.",
  },
  {
    ru: {
      add: (names: string[]) => `Добавить: ${names.join(" и ").toLowerCase()}`,
      change: "Изменить мои языки",
      unreachableTitle: "boks не может достучаться до своего сервера из этой сети",
      unreachableBody:
        "Страница загрузилась, значит, сам boks работает. Не прошло следующее соединение браузера, и обычно дело в сети между вами: другой Wi-Fi, мобильный интернет или VPN, как правило, помогают.",
      retry: "Попробовать снова",
      stillNothing: "Всё равно не работает? Напишите на",
      tellProvider: "- укажите вашего провайдера, и мы сменим адрес, к которому обращается boks.",
    },
  }
);

/**
 * What the reader sees when there is no boks to show.
 *
 * A feed emptied by the language filter has to say so. The alternative -
 * quietly adding a language back - would break the only promise this feature
 * makes, and a reader who asked for Russian and found none is also the most
 * useful thing the console can learn about what to acquire. Which notice
 * applies is decided by `emptyFeedNotice`, where it is tested.
 */
export function EmptyFeedScreen({
  notice,
  onAddLanguages,
  onChangeLanguages,
  onRetry,
}: {
  notice: EmptyFeedNotice;
  onAddLanguages: (languages: ReadingLanguage[]) => void;
  onChangeLanguages: () => void;
  onRetry: () => void;
}) {
  const t = useMessages(messages);
  const uiLanguage = useUiLanguage();
  return (
    <main className="reader-shell grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="brand-word">boks</p>
        {notice.kind === "language" ? (
          <>
            <h1 className="mt-4 text-2xl font-semibold tracking-normal">{notice.title}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{notice.body}</p>
            {notice.offer.length > 0 && (
              <Button className="mt-4" onClick={() => onAddLanguages(notice.offer)}>
                {t.add(notice.offer.map((language) => readingLanguageNamesIn[uiLanguage][language]))}
              </Button>
            )}
            <Button className="mt-2 w-full" variant="ghost" onClick={onChangeLanguages}>
              {t.change}
            </Button>
          </>
        ) : notice.kind === "unreachable" ? (
          <>
            {/* The reader can act on this one, so it says what to try. The
                page itself arrived, which means our server is up and the
                network is stopping the call the app makes next - on some
                providers that call is blocked while the site is not. */}
            <h1 className="mt-4 text-2xl font-semibold tracking-normal">
              {t.unreachableTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {t.unreachableBody}
            </p>
            <Button className="mt-4" onClick={onRetry}>
              {t.retry}
            </Button>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
              {t.stillNothing}{" "}
              <a className="auth-link" href={supportMailto}>
                {supportEmail}
              </a>{" "}
              {t.tellProvider}
            </p>
          </>
        ) : (
          <p className="mt-3 text-[var(--muted-foreground)]">{notice.message}</p>
        )}
      </div>
    </main>
  );
}
