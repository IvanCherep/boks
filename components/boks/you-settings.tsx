"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, BookOpen, Check, ChevronRight, Globe, Moon, Users } from "lucide-react";
import { ReaderBackIcon as ArrowLeft, ReaderTypeIcon as Type } from "./reader/reader-icons";
import type { BoksUserContext } from "./client-types";
import type { FollowedAuthor } from "./supabase-browser-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeSetting } from "./theme-setting";
import { ReaderPreferenceControls } from "./reader-preference-controls";
import { useReaderPreferences } from "./reader-preferences";
import { ReaderTabs } from "./series/series-view";
import { supportedReadingLanguages } from "./reading-languages";
import { FeedbackForm } from "./feedback-form";
import { readFeedbackState } from "./feedback";
import { getBrowserId } from "./reader-behavior";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import { isValidBoksHandle, maxHandleLength, minHandleLength } from "@/lib/boks/contracts";
import { bareHandle } from "./reader/handles";
import { plural } from "@/lib/i18n/messages";
import { loadMyInvites } from "./author-spaces/data";
import { PenLine } from "lucide-react";

type Page = "home" | "app-language" | "typography" | "languages" | "appearance" | "handle" | "following" | "delete" | "feedback" | "feedback-sent" | "about";

/** Presentation only: the parent retains every account and language controller. */
export function YouSettings({ user, busy, handle, setHandle, languages, saveLanguages, saveHandle, follows, unfollowing, unfollow, deleteConfirmation, setDeleteConfirmation, deleteError, deleteAccount, signOut, onSignIn, onActivity, onClose, onFeed, onSeries, initialSection }: {
  user: BoksUserContext | null; busy: boolean; handle: string; setHandle: (value: string) => void;
  languages: string[]; saveLanguages: (languages: string[]) => Promise<void>; saveHandle: () => Promise<void>;
  follows: FollowedAuthor[]; unfollowing: string | null; unfollow: (id: string) => Promise<void>;
  deleteConfirmation: string; setDeleteConfirmation: (value: string) => void; deleteError: string; deleteAccount: () => Promise<void>;
  signOut: () => Promise<void>; onSignIn: () => void; onActivity: () => void; onClose: () => void;
  onFeed?: () => void; onSeries?: () => void;
  initialSection?: "home" | "typography" | "languages" | "feedback";
}) {
  // A page the team prepared for this account: say so where the cabinet is reached.
  const [pagesWaiting, setPagesWaiting] = useState(0);
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    let active = true;
    void loadMyInvites().then((offers) => active && setPagesWaiting(offers.length));
    return () => { active = false; };
  }, [user]);
  const { preferences, t } = useReaderPreferences();
  const [page, setPage] = useState<Page>(initialSection ?? "home");
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.closest(".social-page")?.scrollTo({ top: 0 });
    contentRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [page]);
  const titles: Record<Page, string> = {
    home: user ? t("Settings", "Настройки") : t("You", "Вы"),
    "app-language": t("Settings", "Настройки"), typography: t("Reading comfort", "Удобство чтения"),
    languages: t("Reading languages", "Языки чтения"), appearance: t("Appearance", "Оформление"),
    handle: t("Your handle", "Ваше @имя"), following: t("Following", "Подписки"),
    delete: t("Delete account", "Удалить аккаунт"), feedback: t("Feedback", "Обратная связь"), "feedback-sent": t("Feedback", "Обратная связь"), about: t("About", "О boks"),
  };
  const entry = (label: string, detail: string, next: Page, icon: ReactNode) => <button type="button" className="you-entry" onClick={() => setPage(next)}><span><strong>{label}</strong><small>{detail}</small></span>{icon}</button>;
  const bokCount = (count: number) => t(`${count} ${count === 1 ? "bok" : "boks"}`, `${count} ${plural("ru", count, { one: "бок", few: "бока", many: "боков", other: "бока" })}`);
  const backToReading = <Button className="you-wide-button" onClick={onClose}>{t("Back to reading", "Вернуться к чтению")}</Button>;
  return <div className={`you-settings-screen you-settings-screen--${page}`} ref={contentRef}>
    <header className="social-page-header"><button type="button" className="social-icon" aria-label={t("Back", "Назад")} onClick={() => page !== "home" ? setPage("home") : user ? onActivity() : onClose()}><ArrowLeft /></button><span>{titles[page]}</span><span /></header>
    {page === "home" && <>
      {user ? <div className="you-settings-identity"><span className="social-monogram" aria-hidden="true">{user.handle?.[0]?.toUpperCase()}</span><div><strong translate="no">@{user.handle}</strong><small>{user.email}</small></div><button type="button" onClick={() => setPage("handle")}>{t("Edit", "Изменить")}</button></div> : <><h1 className="social-display">{t("Settings.", "Настройки.")}</h1><p className="social-muted">{t("Your app and reading preferences.", "Приложение и удобство чтения.")}</p><div className="you-invitation"><h2>{t("Your account.", "Ваш аккаунт.")}</h2><p>{t("Sign in to keep your reading history, like boks and comment.", "Войдите, чтобы сохранять историю чтения, ставить лайки и общаться.")}</p><Button onClick={onSignIn}>{t("Create an account or sign in", "Создать аккаунт или войти")}</Button></div></>}
      {user && <span className="social-eyebrow you-section-label">{t("Preferences", "Настройки чтения")}</span>}
      {entry(t("App language", "Язык приложения"), preferences.locale === "ru" ? "Русский" : "English", "app-language", <Globe />)}
      {entry(t("Reading comfort", "Удобство чтения"), t("Text size and line spacing", "Размер текста и интервал"), "typography", <Type />)}
      {entry(t("Reading languages", "Языки чтения"), languages.map(language => language === "ru" ? "Русский" : "English").join(" · "), "languages", <Globe />)}
      {entry(t("Appearance", "Оформление"), t("Light, dark or your device", "Светлое, тёмное или системное"), "appearance", <Moon />)}
      {user && <><span className="social-eyebrow you-section-label">{t("Your account", "Ваш аккаунт")}</span><button type="button" className="you-entry" onClick={onActivity}><span><strong>{t("Your activity", "Ваша активность")}</strong><small>{t("Read, liked & conversations", "Прочитанное, лайки и беседы")}</small></span><BookOpen /></button>{entry(t("Following", "Подписки"), t(`${follows.length} ${follows.length === 1 ? "account" : "accounts"}`, `Аккаунтов: ${follows.length}`), "following", <Users />)}{!user.bannedAt && <a className="you-entry" href="/author"><span><strong>{t("Author's cabinet", "Кабинет автора")}{pagesWaiting > 0 && <span className="you-entry-badge">{t("A page is ready for you", "Для вас готова страница")}</span>}</strong><small>{t("Your author page, your works, publishing", "Ваша страница автора, произведения, публикация")}</small></span><PenLine /></a>}</>}
      <div className="you-utility-links"><button type="button" onClick={() => setPage("feedback")}>{t("Feedback", "Обратная связь")}</button><button type="button" onClick={() => setPage("about")}>{t("About boks", "О boks")}</button><button type="button" onClick={user ? () => void signOut() : onClose} disabled={busy}>{user ? t("Sign out", "Выйти") : t("Keep reading", "Читать дальше")}</button></div>
      {user && <><div className="you-surface-links">{!user.bannedAt && <a href="/author">{t("Write a bok", "Написать бок")}<ArrowUpRight /></a>}{user.role === "admin" && <a href="/admin">{t("Admin", "Админка")}<ArrowUpRight /></a>}</div>{user.role !== "admin" && <button className="you-danger-link" type="button" onClick={() => setPage("delete")}>{t("Delete account", "Удалить аккаунт")}</button>}</>}
      {!user && onFeed && onSeries && <ReaderTabs className="you-tabs" active="you" seriesIsNew={false} onFeed={onFeed} onSeries={onSeries} onYou={() => contentRef.current?.closest(".social-page")?.scrollTo({ top: 0, behavior: "smooth" })} />}
    </>}
    {(page === "app-language" || page === "typography") && <ReaderPreferenceControls page={page} onDone={onClose} />}
    {page === "languages" && <><h1 className="social-display">{preferences.locale === "en" ? <>Reading<br />languages.</> : <>Языки<br />чтения.</>}</h1><p className="social-muted">{t("Only boks in languages you read. Choose at least one.", "Только боки на выбранных языках. Оставьте хотя бы один.")}</p><div className="you-reading-languages">{supportedReadingLanguages.map(language => {
      const selected = languages.includes(language); const held = user?.languageCoverage?.[language];
      return <button key={language} type="button" className={selected ? "is-selected" : ""} aria-pressed={selected} disabled={busy || selected && languages.length === 1} onClick={() => void saveLanguages(selected ? languages.filter(value => value !== language) : [...languages, language])}><span>{language === "ru" ? "Аа" : "Aa"}</span><span><strong translate="no">{language === "ru" ? "Русский" : "English"}</strong><small>{selected ? t("Selected", "Выбран") : t("Not selected", "Не выбран")}{held !== undefined ? ` · ${bokCount(held)}` : ""}</small></span><i>{selected && <Check />}</i></button>;
    })}</div>{languages.every(language => user?.languageCoverage?.[language] === 0) && <p className="social-note">{t("No available boks in these languages yet.", "На выбранных языках пока нет доступных боков.")}</p>}{backToReading}<p className="social-note">{t("Adding a language keeps your current bok. Removing one updates your feed.", "Добавление языка сохраняет текущий бок. Удаление обновляет ленту.")}</p></>}
    {page === "appearance" && <><h1 className="social-display">{t("Appearance.", "Оформление.")}</h1><div className="you-theme-sample" translate="no"><span>Emily Dickinson</span><p>And sweetest —<br />in the Gale —<br />is heard —</p><i>✦</i></div><ThemeSetting />{backToReading}</>}
    {page === "handle" && user && <><div className="you-handle-mark" aria-hidden="true">@</div><h1 className="social-display">{t("Your handle.", "Ваше @имя.")}</h1><p className="social-muted">{t("This is how you appear in comments, follows and your public profile.", "Так вы представлены в комментариях, подписках и публичном профиле.")}</p><label className="you-field">{t("Unique @handle", "Уникальное @имя")}<Input name="boks-nickname" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} minLength={minHandleLength} maxLength={maxHandleLength} value={handle} aria-invalid={handle.length > 0 && !isValidBoksHandle(handle)} onChange={event => setHandle(event.target.value)} /></label><p className="social-note">{t("English letters, numbers and underscores. Starts with a letter.", "Латинские буквы, цифры и подчёркивание. Начинается с буквы.")}</p><Button className="you-wide-button" disabled={busy || handle === user.handle || !isValidBoksHandle(handle)} onClick={() => void saveHandle()}>{t(`Save @${handle || "…"}`, `Сохранить @${handle || "…"}`)}</Button><Button className="you-wide-button" variant="outline" onClick={() => setPage("home")}>{t("Cancel", "Отмена")}</Button><p className="social-note">{t("Your published bylines stay as they were. A pen name belongs to a bok.", "Подписи опубликованных произведений не изменятся. Подпись относится к боку.")}</p></>}
    {page === "following" && <><h1 className="social-display">{t("Following.", "Подписки.")}</h1><p className="social-muted">{t("New boks from these accounts can appear in your feed.", "Новые боки этих аккаунтов могут появляться в вашей ленте.")}</p>{follows.map(author => <div className="you-follow-person" key={author.authorUserId}>{author.pageId && author.photoVersion
      // eslint-disable-next-line @next/next/no-img-element
      ? <img className="social-monogram you-follow-photo" src={`/a/${encodeURIComponent(author.authorHandle)}/photo?v=${author.photoVersion}`} alt="" width={44} height={44} />
      : <span className="social-monogram" aria-hidden="true">{(author.pageId ? author.authorName : author.authorHandle)[0]?.toUpperCase()}</span>}<a className="you-follow-name" href={`/?author=${encodeURIComponent(author.authorHandle)}`}><strong translate="no">{author.pageId ? author.authorName : `@${author.authorHandle}`}</strong><small>{author.pageId ? t("A boks editorial page", "Страница редакции boks") : bokCount(author.published)}</small></a><button type="button" disabled={unfollowing === author.authorUserId} onClick={() => void unfollow(author.authorUserId)}><Check />{t("Following", "Вы подписаны")}</button></div>)}{!follows.length && <p className="social-note">{t("Follow accounts from their profile or from a bok.", "Подпишитесь на аккаунт из его профиля или бока.")}</p>}{backToReading}</>}
    {page === "delete" && user && <><span className="social-eyebrow">{t("This cannot be undone", "Это нельзя отменить")}</span><h1 className="social-display">{t("Delete account.", "Удалить аккаунт.")}</h1><p className="social-muted">{t("We’ll delete your email, profile, likes, comments, follows and reading history.", "Будут удалены email, профиль, лайки, комментарии, подписки и история чтения.")}</p><p className="you-deletion-note">{t("Published boks are hidden and no longer carry your name.", "Опубликованные боки будут скрыты и больше не будут связаны с вашим именем.")}</p><label className="you-field">{t(`Type @${user.handle} to confirm`, `Введите @${user.handle} для подтверждения`)}<Input value={deleteConfirmation} autoComplete="off" spellCheck={false} onChange={event => setDeleteConfirmation(event.target.value)} /></label>{deleteError && <p role="alert" className="you-danger-link">{deleteError}</p>}<Button className="you-wide-button" variant="destructive" onClick={() => void deleteAccount()} disabled={busy || bareHandle(deleteConfirmation.trim()).toLowerCase() !== (user.handle ?? "").toLowerCase()}>{t("Delete my account", "Удалить мой аккаунт")}</Button><Button className="you-wide-button" variant="outline" onClick={() => setPage("home")}>{t("Keep my account", "Сохранить аккаунт")}</Button></>}
    {page === "feedback" && <><div className="you-postmark" aria-hidden="true">boks<span>FEEDBACK</span></div><h1 className="social-display">{t("Send feedback.", "Обратная связь.")}</h1><p className="social-muted">{t("Tell us about a problem or suggest an improvement.", "Расскажите о проблеме или предложите улучшение.")}</p><FeedbackForm presentation="letter" onSent={() => setPage("feedback-sent")} surface="settings" boksRead={readFeedbackState().reads} visitorId={getBrowserId("boks-reader")} /><p className="social-note">{t("For a reply, write to", "Чтобы получить ответ, напишите на")} <a href={supportMailto}>{supportEmail}</a>.</p></>}
    {page === "feedback-sent" && <><div className="you-sent-art" aria-hidden="true"><span>✓</span><i>↗</i></div><h1 className="social-display">{t("Feedback sent.", "Отзыв отправлен.")}</h1><p className="social-muted">{t("Thank you. Your feedback has been received.", "Спасибо. Ваш отзыв получен.")}</p>{backToReading}</>}
    {page === "about" && <><div className="you-about-mark" aria-hidden="true">boks<span>✳</span></div><h1 className="social-display">{t("Complete short literature.", "Короткая литература целиком.")}</h1><p className="social-muted">{t("Poems and stories you can read in 15 minutes or less.", "Стихи и рассказы, которые можно прочитать за 15 минут.")}</p>{entry(t("Feedback", "Обратная связь"), t("Every note is read", "Каждое сообщение будет прочитано"), "feedback", <ChevronRight />)}<a className="you-entry" href="/privacy" target="_blank" rel="noreferrer"><span><strong>{t("Privacy", "Конфиденциальность")}</strong><small>{t("What we keep and why", "Что мы храним и зачем")}</small></span><ArrowUpRight /></a><a className="you-entry" href="/terms" target="_blank" rel="noreferrer"><span><strong>{t("Terms", "Условия")}</strong><small>{t("Rights and shared responsibilities", "Права и обязанности")}</small></span><ArrowUpRight /></a><details className="you-licenses"><summary>{t("Open-source licences", "Лицензии открытого ПО")}</summary><p>Source Serif 4 · SIL Open Font License 1.1</p><a href="/licenses/source-serif-4-OFL.txt" target="_blank" rel="noreferrer">{t("Read font licence", "Лицензия шрифта")}</a><p>React, Supabase, Radix, Lucide</p><a href="/licenses/third-party-notices.txt" target="_blank" rel="noreferrer">{t("All software notices", "Все лицензии ПО")}</a><p>{t("Public-domain literature transcribed by Wikisource volunteers.", "Общественное достояние, оцифрованное волонтёрами Wikisource.")}</p><a href="/terms#catalogue" target="_blank" rel="noreferrer">{t("Where the texts come from", "Источники текстов")}</a></details><p className="social-note"><a href={supportMailto}>{supportEmail}</a></p></>}
  </div>;
}
