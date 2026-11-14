"use client";

import { useEffect, useState } from "react";
import { acceptAuthorInvite, peekAuthorInvite, type InviteOffer, type InvitePeek } from "@/components/boks/author-spaces/data";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { pendingInviteKey } from "@/lib/boks/author/invite-link";
import { authorShareLabel } from "@/lib/boks/share-link";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { Icon, Topbar } from "./ui";

/**
 * An invitation to a page the team prepared (`/author#invite=<token>`).
 *
 * Before sign-in the screen names nobody: anyone holding the link sees the
 * same general words, and the person signs in the usual way, with the code
 * from their email. After, the database says whether the link is for this
 * address and what is waiting; nothing is bound until the author accepts.
 */

const words = defineMessages(
  {
    signInTitle: "An author's page is waiting for you",
    signInBody: "The boks team has prepared a page for you. Sign in with your email: we will send a code, and the invitation opens right after.",
    signInAction: "Sign in with email",
    checking: "Checking the invitation…",
    newTitle: "Your page in boks is ready",
    newBody: (n: number) => `The team prepared your page and ${n} work${n === 1 ? "" : "s"}. Look at everything first: readers see nothing until you press Publish yourself.`,
    withSeries: (n: number) => `${n} of them also come as Series: your reading, word by word, with illustrations.`,
    address: (handle: string) => `Address: ${authorShareLabel(handle)}. You can change it later.`,
    next: "Next you will see your page in the cabinet: every work, the preview, and the Publish button.",
    existingTitle: "You already have a page in boks",
    existingBody: (n: number) => `We will add ${n} draft${n === 1 ? "" : "s"} to your cabinet. Your name, photo, address, followers and published works stay as they are.`,
    accept: "Accept and look",
    signedInAs: (email: string) => `You are signed in as ${email}.`,
    wrongTitle: "This invitation is for another address",
    wrongBody: (hint: string) => `It was sent to ${hint}. Sign in with that address.`,
    otherEmail: "Sign in with another email",
    expired: "This invitation has expired. Ask the team for a new link.",
    revoked: "This invitation was revoked. Ask the team for a new link.",
    used: "This invitation has already been used.",
    invalid: "This invitation link is not valid. Check that it was copied whole.",
    conflict: "The page address is taken by another account. The team will send a new link.",
    failed: "Could not open the invitation.",
    back: "Back",
    language: "Language",
    workspace: "Cabinet",
  },
  {
    ru: {
      signInTitle: "Вас ждёт страница автора",
      signInBody: "Редакция boks подготовила для вас страницу. Войдите по своей почте: мы пришлём код, и приглашение сразу откроется.",
      signInAction: "Войти по почте",
      checking: "Проверяем приглашение…",
      newTitle: "Ваша страница в boks готова",
      newBody: (n: number) => `Редакция подготовила страницу и ${n} ${plural("ru", n, { one: "произведение", few: "произведения", many: "произведений", other: "произведения" })}. Сначала вы всё посмотрите: читатели ничего не увидят, пока вы сами не нажмёте «Опубликовать».`,
      withSeries: (n: number) => `${n} из них ещё и в Series: ваше чтение, слово в слово, с иллюстрациями.`,
      address: (handle: string) => `Адрес: ${authorShareLabel(handle)}. Его можно поменять потом.`,
      next: "Дальше откроется ваша страница в кабинете: все произведения, предпросмотр и кнопка «Опубликовать».",
      existingTitle: "У вас уже есть страница в boks",
      existingBody: (n: number) => `Добавим в кабинет ${n} ${plural("ru", n, { one: "черновик", few: "черновика", many: "черновиков", other: "черновика" })}. Имя, фото, адрес, подписчики и опубликованные работы останутся как есть.`,
      accept: "Принять и посмотреть",
      signedInAs: (email: string) => `Сейчас вы вошли как ${email}.`,
      wrongTitle: "Приглашение для другой почты",
      wrongBody: (hint: string) => `Оно отправлено на ${hint}. Войдите с этого адреса.`,
      otherEmail: "Войти с другой почты",
      expired: "Срок приглашения истёк. Попросите редакцию прислать новую ссылку.",
      revoked: "Приглашение отозвано. Попросите редакцию прислать новую ссылку.",
      used: "Это приглашение уже использовано.",
      invalid: "Ссылка приглашения недействительна. Проверьте, что она скопирована целиком.",
      conflict: "Адрес страницы занят другим аккаунтом. Редакция пришлёт новую ссылку.",
      failed: "Не удалось открыть приглашение.",
      back: "Назад",
      language: "Язык",
      workspace: "Кабинет",
    },
  }
);

function forget() {
  try {
    window.sessionStorage.removeItem(pendingInviteKey);
  } catch {
    // Storage may be unavailable; the token then lives only in this tab's state.
  }
}

/** Before sign-in: the same words for anyone who holds the link. */
export function InviteSignIn({ onSignIn }: { onSignIn: () => void }) {
  const t = useMessages(words);
  return (
    <main className="page detail-page amp-invite">
      <Topbar title={t.workspace} backLabel={t.back} languageLabel={t.language} onBack={() => (window.location.href = "/")} />
      <section className="empty">
        <div className="empty-letter">b.</div>
        <h1>{t.signInTitle}</h1>
        <p>{t.signInBody}</p>
        <button type="button" className="btn" style={{ marginTop: 24 }} onClick={onSignIn}>
          {t.signInAction} <Icon name="arrow" />
        </button>
      </section>
    </main>
  );
}

export function InviteScreen({
  token,
  offer,
  email,
  onAccepted,
  onSwitchAccount,
  onDismiss,
}: {
  /** From a link: the token. In the cabinet without one: the offer for this account's email. */
  token: string | null;
  offer?: InviteOffer | null;
  /** The address this session is signed in with, to say so when the invitation is for another. */
  email?: string | null;
  onAccepted: () => void;
  onSwitchAccount: () => void;
  onDismiss: () => void;
}) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [peek, setPeek] = useState<InvitePeek | null>(offer ?? null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    peekAuthorInvite(token)
      .then((answer) => {
        if (!active) return;
        if (answer.state === "accepted") {
          forget();
          onAccepted();
          return;
        }
        setPeek(answer);
      })
      .catch((error) => active && setProblem(readableBoksError(error, t.failed, language)));
    return () => {
      active = false;
    };
  }, [token, onAccepted, t.failed, language]);

  async function accept() {
    setBusy(true);
    setProblem("");
    try {
      const answer = await acceptAuthorInvite(token, offer?.inviteId ?? null);
      if (answer.state === "accepted") {
        forget();
        onAccepted();
        return;
      }
      setPeek(answer as InvitePeek);
      if (answer.state === "conflict") setProblem(t.conflict);
    } catch (error) {
      setProblem(readableBoksError(error, t.failed, language));
    } finally {
      setBusy(false);
    }
  }

  const closed = (message: string) => (
    <section className="empty">
      <div className="empty-letter">b.</div>
      <p>{message}</p>
      <button type="button" className="btn btn-secondary" style={{ marginTop: 24 }} onClick={() => { forget(); onDismiss(); }}>{t.workspace}</button>
    </section>
  );

  let body: React.ReactNode = <p className="desk-note" role="status">{problem || t.checking}</p>;
  if (peek?.state === "pending") {
    body = (
      <section className="empty">
        <div className="empty-letter">b.</div>
        <h1>{peek.existingPage ? t.existingTitle : t.newTitle}</h1>
        {peek.name && !peek.existingPage && <p className="serif amp-invite__name">{peek.name}</p>}
        <p>{peek.existingPage ? t.existingBody(peek.works) : t.newBody(peek.works)}</p>
        {Boolean(peek.series) && <p>{t.withSeries(peek.series ?? 0)}</p>}
        {peek.handle && !peek.existingPage && <p className="amp-invite__muted">{t.address(peek.handle)}</p>}
        <p className="amp-invite__muted">{t.next}</p>
        {problem && <p className="notice" role="alert">{problem}</p>}
        <button type="button" className="btn btn-red" style={{ marginTop: 24 }} disabled={busy} onClick={() => void accept()}>
          {t.accept} <Icon name="arrow" />
        </button>
      </section>
    );
  } else if (peek?.state === "wrong_email") {
    body = (
      <section className="empty">
        <div className="empty-letter">b.</div>
        <h1>{t.wrongTitle}</h1>
        <p>{t.wrongBody(peek.emailHint ?? "")}</p>
        {email && <p className="amp-invite__muted">{t.signedInAs(email)}</p>}
        <button type="button" className="btn" style={{ marginTop: 24 }} onClick={onSwitchAccount}>{t.otherEmail}</button>
      </section>
    );
  } else if (peek && peek.state !== "sign_in") {
    const message = { expired: t.expired, revoked: t.revoked, used: t.used, invalid: t.invalid, conflict: t.conflict }[peek.state as string] ?? t.invalid;
    body = closed(message);
  }

  return (
    <main className="page detail-page amp-invite">
      <Topbar title={t.workspace} backLabel={t.back} languageLabel={t.language} onBack={() => { forget(); onDismiss(); }} />
      {body}
    </main>
  );
}
