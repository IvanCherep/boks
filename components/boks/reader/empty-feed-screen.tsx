"use client";

import { useReaderPreferences } from "../reader-preferences";
import { BoksFlower } from "./boks-flower";
import { Button } from "@/components/ui/button";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import { localizeBoksMessage } from "@/lib/boks/errors";
import {
  readingLanguageNamesIn,
  type EmptyFeedNotice,
  type ReadingLanguage,
} from "@/components/boks/reading-languages";

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
  loading = false,
  onAddLanguages,
  onChangeLanguages,
  onRetry,
}: {
  notice: EmptyFeedNotice;
  loading?: boolean;
  onAddLanguages: (languages: ReadingLanguage[]) => void;
  onChangeLanguages: () => void;
  onRetry: () => void;
}) {
  const { preferences, t } = useReaderPreferences();
  const language = preferences.locale;
  // The load phase's own words ("Loading", "Ready") and any sentence the
  // database wrote, in the interface language.
  const message = notice.kind === "message"
    ? notice.message === "Ready" ? t("Ready", "Готово") : notice.message === "Loading" ? t("Loading…", "Загрузка…") : localizeBoksMessage(notice.message, language)
    : "";
  return (
    <main className={`reader-system-page${loading ? " reader-system-page--loading" : ""}`}>
      <div className="reader-system-page__body">
        <header className="reader-system-page__header"><span>boks</span></header>
        {notice.kind === "language" ? (
          <>
            <div className="reader-system-art reader-system-art--languages" aria-hidden="true">Аа<span>…</span></div>
            <h1 className="reader-system-title">{notice.title}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{notice.body}</p>
            {notice.offer.length > 0 && (
              <Button className="mt-4" onClick={() => onAddLanguages(notice.offer)}>
                {t("Add", "Добавить")} {notice.offer.map((code) => language === "ru" ? readingLanguageNamesIn.ru[code].toLowerCase() : readingLanguageNamesIn.en[code]).join(t(" and ", " и "))}
              </Button>
            )}
            <Button className="mt-2 w-full" variant="ghost" onClick={onChangeLanguages}>
              {t("Change my languages", "Изменить языки чтения")}
            </Button>
          </>
        ) : notice.kind === "unreachable" ? (
          <>
            <div className="reader-system-art reader-system-art--offline" aria-hidden="true">·<i>—</i>·</div>
            {/* The reader can act on this one, so it says what to try. The
                page itself arrived, which means our server is up and the
                network is stopping the call the app makes next - on some
                providers that call is blocked while the site is not. */}
            <h1 className="reader-system-title">
              {t("Couldn’t load the bok.", "Не удалось загрузить бок.")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {t("The page loaded, but the connection to the reading service failed. Try another Wi-Fi, mobile data, or a VPN.", "Страница загрузилась, но соединиться с сервисом чтения не удалось. Попробуйте другую сеть Wi-Fi, мобильный интернет или VPN.")}
            </p>
            <Button className="mt-4" onClick={onRetry}>
              {t("Try again", "Попробовать снова")}
            </Button>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
              {t("Still nothing? Write to", "Не помогло? Напишите на")}{" "}
              <a className="auth-link" href={supportMailto}>
                {supportEmail}
              </a>{" "}
              {t("— tell us your provider.", "— укажите вашего провайдера.")}
            </p>
          </>
        ) : (
          <>{loading ? <>
            <div className="reader-system-art reader-system-art--loading" aria-hidden="true"><span>b</span><BoksFlower /></div>
            <h1 className="reader-system-title">{t("Loading bok…", "Загружаем бок…")}</h1>
            <div className="reader-loading-skeleton" aria-hidden="true"><span /><span /><span /><span /><span /></div>
            <p role="status" className="reader-system-status">{t("Loading…", "Загрузка…")}</p>
          </> : <><div className="reader-system-art reader-system-art--languages" aria-hidden="true">b.</div><h1 className="reader-system-title">{t("No boks yet.", "Здесь пока нет боков.")}</h1><p>{message}</p><Button className="mt-4" onClick={onRetry}>{t("Try again", "Попробовать снова")}</Button></>}</>
        )}
      </div>
    </main>
  );
}
