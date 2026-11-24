"use client";

import "@/app/author-agreement.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { loadMyAgreement, reportMyPayment } from "@/components/boks/author-spaces/data";
import { readableBoksError } from "@/lib/boks/errors";
import {
  daysToPay,
  legalHref,
  legalKinds,
  paymentPurpose,
  paymentQr,
  requisitesQr,
  phoneLabel,
  planName,
  rub,
  ruDate,
  type AuthorAgreement,
  type LegalKind,
} from "@/lib/boks/author/agreement";

/**
 * «Договор и оплата» in the cabinet (My page and the Workshop):
 * the contract's number, what it costs, how to pay by QR code or СБП, and
 * «Я оплатил(а)»; after the team marks the money, the year. The receipt is
 * not on the site: the team sends it to the author in a personal message.
 * Nothing shows for an author without an online contract.
 */

const docName: Record<LegalKind, string> = {
  author_offer: "Договор-оферта",
  author_pd_processing: "Согласие на обработку данных",
  author_pd_distribution: "Согласие на распространение",
};

export function useMyAgreement() {
  const [agreement, setAgreement] = useState<AuthorAgreement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      setAgreement(await loadMyAgreement());
    } catch {
      setAgreement(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  return { agreement, loaded, reload, setAgreement };
}

/** Whether the author's things wait for the payment before readers see them. */
export const awaitingPayment = (agreement: AuthorAgreement | null) => agreement?.payState === "awaiting" || agreement?.payState === "reported";

export function AgreementCard({
  agreement,
  onChange,
  compact = false,
  explained = false,
  pageOpen = false,
  startOpen = false,
  preview = false,
}: {
  agreement: AuthorAgreement | null;
  onChange: (next: AuthorAgreement) => void;
  /** In the Workshop: only what asks for action, the rest behind «Договор». */
  compact?: boolean;
  /** The Workshop's «Как откроется ваша страница» already says why and when: no lead while it waits for the money. */
  explained?: boolean;
  /** The author's page is open already: only the Series wait for the money. */
  pageOpen?: boolean;
  /** Opened from «Оплатить» elsewhere (the Workshop's steps): the details at once. */
  startOpen?: boolean;
  /** Studio's preview: everything as the author sees it, «Я оплатил(а)» sends nothing. */
  preview?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState("");
  const [showDocs, setShowDocs] = useState(false);

  const qr = useMemo(() => {
    if (!agreement || !awaitingPayment(agreement)) return null;
    const code = paymentQr(agreement);
    if (!code) return null;
    try {
      return { ...code, svg: renderSVG(code.value, { border: 1, ecc: "M" }) };
    } catch {
      return null;
    }
  }, [agreement]);

  const detailsQrSvg = useMemo(() => {
    if (!agreement || !awaitingPayment(agreement)) return null;
    const value = requisitesQr(agreement);
    if (!value) return null;
    try {
      return renderSVG(value, { border: 1, ecc: "M" });
    } catch {
      return null;
    }
  }, [agreement]);

  if (!agreement) return null;
  const waiting = awaitingPayment(agreement);
  const reported = agreement.payState === "reported";
  const purpose = paymentPurpose(agreement);
  const left = daysToPay(agreement.payDue);
  const pay = agreement.payment;

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  }

  async function report() {
    if (preview) {
      setProblem("Это предпросмотр: у автора эта кнопка сообщает редакции об оплате, и в Студии появляется «Проверить оплату».");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      onChange(await reportMyPayment());
      setOpen(false);
    } catch (error) {
      setProblem(readableBoksError(error, "Не удалось отправить. Попробуйте ещё раз.", "ru"));
    } finally {
      setBusy(false);
    }
  }

  const docs = (
    <ul className="aag-docs">
      {legalKinds.map((kind) => (
        <li key={kind}>
          <a href={legalHref(kind, agreement.documents[kind])} target="_blank" rel="noreferrer noopener">{docName[kind]}</a>
        </li>
      ))}
    </ul>
  );

  const title = (
    <div className="aag-card__head">
      <strong>Договор № {agreement.number}</strong>
      <span>«{planName[agreement.plan]}» · от {ruDate(agreement.acceptedAt)}</span>
    </div>
  );

  if (!waiting) {
    // Paid or free: one quiet line, the documents behind it.
    const until = agreement.periodEnd ? `действует до ${ruDate(agreement.periodEnd)}` : "";
    return (
      <section className="aag-card aag-card--done" aria-label="Договор">
        {title}
        <p className="aag-card__state">
          {agreement.payState === "paid" ? `Оплачен ${ruDate(agreement.periodStart)}` : agreement.payState === "waived" ? "Без оплаты, по договорённости с редакцией" : "Бесплатный тариф"}
          {until ? ` · ${until}` : ""}
        </p>
        <button type="button" className="aag-link" aria-expanded={showDocs} onClick={() => setShowDocs(!showDocs)}>
          {showDocs ? "Скрыть документы" : "Документы"}
        </button>
        {showDocs && docs}
      </section>
    );
  }

  return (
    <section className={`aag-card${reported ? " aag-card--reported" : ""}`} aria-label="Договор и оплата">
      {title}
      {reported ? (
        <p className="aag-card__lead">
          <strong>Спасибо, вы сообщили об оплате.</strong> Проверяем поступление, обычно в течение одного-двух рабочих дней. Когда деньги придут,
          здесь будет «Оплачен», чек мы пришлём вам на почту, а редакция начнёт делать Series. Тексты и голос можно добавлять и сейчас.
        </p>
      ) : explained ? null : (
        <p className="aag-card__lead">
          <strong>Подготовительный период.</strong> Добавляйте тексты и записывайте голос.{" "}
          {pageOpen ? "Редакция начнёт делать Series после оплаты." : "Страница откроется читателям, а редакция начнёт делать Series после оплаты."}
        </p>
      )}
      <div className="aag-due">
        <span>К оплате <strong>{rub(agreement.priceRub)}</strong></span>
        {agreement.payDue && !reported && (
          <span className={left !== null && left < 3 ? "aag-due__soon" : ""}>
            до {ruDate(agreement.payDue)}
            {left !== null && left >= 0 ? ` (${left === 0 ? "сегодня" : `осталось ${left} ${dayWord(left)}`})` : ""}
          </span>
        )}
      </div>

      {!open ? (
        <div className="aag-actions">
          <button type="button" className="btn btn-red" onClick={() => setOpen(true)}>{reported ? "Реквизиты" : "Оплатить"}</button>
          {!compact && (
            <button type="button" className="aag-link" aria-expanded={showDocs} onClick={() => setShowDocs(!showDocs)}>
              {showDocs ? "Скрыть документы" : "Документы"}
            </button>
          )}
        </div>
      ) : (
        <div className="aag-pay">
          {(pay?.payLink || pay?.sbpPhone) && (
            <div className="aag-fast">
              <strong>Оплата по СБП</strong>
              <span className="aag-fast__badge">Рекомендуем</span>
              <p>Это предпочтительный способ: по СБП мы получаем деньги гораздо быстрее, обычно за несколько минут.</p>
            </div>
          )}

          {pay?.payLink ? (
            <div className="aag-link-pay">
              <a className="btn btn-red" href={pay.payLink} target="_blank" rel="noreferrer noopener">Оплатить по СБП</a>
              <p className="aag-small">Откроется перевод в приложении вашего банка. Впишите сумму {rub(agreement.priceRub)} и, если банк спросит, назначение платежа из поля ниже.</p>
            </div>
          ) : null}

          {qr && qr.kind === "details" ? (
            <div className="aag-qr">
              <div className="aag-qr__code" role="img" aria-label="QR-код для оплаты" dangerouslySetInnerHTML={{ __html: qr.svg }} />
              <p>
                <strong>Оплата по QR-коду.</strong> Если кабинет открыт на компьютере, откройте на телефоне приложение банка, найдите «Оплата по QR» или сканер и наведите камеру: получатель, сумма и назначение заполнятся сами. Проверьте сумму: {rub(agreement.priceRub)}.
              </p>
            </div>
          ) : null}

          {pay?.sbpPhone ? (
            <div className="aag-sbp">
              <strong>Перевод по СБП по номеру телефона</strong>
              <dl>
                <div><dt>Номер телефона</dt><dd>{phoneLabel(pay.sbpPhone)} <CopyButton label="телефон" copied={copied} onCopy={() => void copy("телефон", pay.sbpPhone!)} /></dd></div>
                {pay.sbpBank && <div><dt>Банк получателя</dt><dd>{pay.sbpBank}</dd></div>}
                {pay.recipient && <div><dt>Получатель</dt><dd>{pay.recipient}</dd></div>}
                <div><dt>Сумма</dt><dd>{rub(agreement.priceRub)}</dd></div>
              </dl>
            </div>
          ) : null}

          {pay?.account && pay.bic ? (
            <details className="aag-sbp aag-requisites" open={!qr && !pay.payLink && !pay.sbpPhone}>
              <summary><strong>{pay.payLink || pay.sbpPhone ? "Другой способ: перевод по реквизитам" : "Перевод по реквизитам"}</strong></summary>
              {(pay.payLink || pay.sbpPhone) && (
                <p className="aag-small">Перевод по реквизитам может занять несколько дней. Если можете, платите по СБП.</p>
              )}
              {detailsQrSvg && (
                <div className="aag-qr">
                  <div className="aag-qr__code" role="img" aria-label="QR-код с реквизитами" dangerouslySetInnerHTML={{ __html: detailsQrSvg }} />
                  <p>Наведите камеру приложения банка: получатель, сумма и назначение заполнятся сами.</p>
                </div>
              )}
              <dl>
                {([
                  ["Получатель", pay.recipient],
                  ["Счёт получателя", pay.account],
                  ["Банк получателя", pay.bank],
                  ["БИК", pay.bic],
                  ["Корр. счёт", pay.corrAccount],
                  ["ИНН получателя", pay.inn],
                  ["КПП получателя", pay.recipientKind === "company" ? pay.kpp : null],
                  ["ИНН банка", pay.bankInn],
                  ["КПП банка", pay.bankKpp],
                ] as [string, string | null | undefined][]).filter(([, value]) => value).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value} <CopyButton label={label} copied={copied} onCopy={() => void copy(label, value!)} /></dd></div>
                ))}
                <div><dt>Сумма</dt><dd>{rub(agreement.priceRub)}</dd></div>
              </dl>
            </details>
          ) : null}

          {!qr && !pay?.sbpPhone && !pay?.payLink && !pay?.account && (
            <p className="aag-card__lead">Реквизиты для оплаты пришлёт редакция. Если письма нет, напишите нам в «Просьбы и предложения».</p>
          )}

          <div className="aag-purpose">
            <span>Назначение платежа</span>
            <p>{purpose}</p>
            <CopyButton label="назначение" copied={copied} onCopy={() => void copy("назначение", purpose)} />
          </div>
          <p className="aag-small">Чек из «Мой налог» пришлём вам на почту, когда получим оплату.</p>
          {problem && <p className="notice" role="alert">{problem}</p>}
          <div className="aag-actions">
            {!reported && <button type="button" className="btn btn-red" disabled={busy} onClick={() => void report()}>Я оплатил(а)</button>}
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>{reported ? "Свернуть" : "Позже"}</button>
          </div>
        </div>
      )}
      {showDocs && docs}
    </section>
  );
}

function CopyButton({ label, copied, onCopy }: { label: string; copied: string; onCopy: () => void }) {
  return (
    <button type="button" className="aag-copy" onClick={onCopy} aria-label={`Скопировать ${label}`}>
      {copied === label ? "Скопировано" : "Копировать"}
    </button>
  );
}

function dayWord(n: number) {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return "дней";
  const last = n % 10;
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}
