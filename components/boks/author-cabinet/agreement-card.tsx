"use client";

import "@/app/author-agreement.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { loadMyAgreement, reportMyPayment } from "@/components/boks/author-spaces/data";
import { readableBoksError } from "@/lib/boks/errors";
import {
  agreementDocKind,
  daysToPay,
  legalHref,
  legalKinds,
  paymentPurpose,
  phoneLabel,
  gostPaymentQr,
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
  /** Kept for callers; the payment shows at once now. */
  startOpen?: boolean;
  /** Studio's preview: everything as the author sees it, «Я оплатил(а)» sends nothing. */
  preview?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState("");
  const [showDocs, setShowDocs] = useState(false);

  const detailsQr = useMemo(() => {
    if (!agreement || !awaitingPayment(agreement)) return null;
    const value = gostPaymentQr(agreement.payment, agreement.priceRub, paymentPurpose(agreement));
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
  const details = (pay?.account && pay.bic
    ? ([
        ["Получатель", pay.recipient],
        ["Счёт", pay.account],
        ["Банк", pay.bank],
        ["БИК", pay.bic],
        ["Корр. счёт", pay.corrAccount],
        ["ИНН получателя", pay.inn],
        ["КПП получателя", pay.recipientKind === "company" ? pay.kpp : null],
        ["ИНН банка", pay.bankInn],
        ["КПП банка", pay.bankKpp],
      ] as [string, string | null | undefined][])
    : []
  ).filter((row): row is [string, string] => Boolean(row[1]));
  const detailsText = [
    ...(pay?.sbpPhone ? [`СБП по номеру: ${phoneLabel(pay.sbpPhone)}${pay.sbpBank ? `, ${pay.sbpBank}` : ""}`] : []),
    ...details.map(([label, value]) => `${label}: ${value}`),
    `Сумма: ${rub(agreement.priceRub)}`,
    `Назначение: ${purpose}`,
  ].join("\n");
  // Without a СБП link the details are the way to pay: shown at once.
  const detailsOpen = showDetails || !pay?.payLink;

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
          <a href={legalHref(agreementDocKind(kind, agreement.plan), agreement.documents[kind])} target="_blank" rel="noreferrer noopener">{docName[kind]}</a>
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
          {agreement.payState === "paid" ? `Оплачен ${ruDate(agreement.periodStart)}` : agreement.payState === "waived" ? "Оплата не требуется" : "Действует"}
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
      <div className="aag-amount">
        <strong>{rub(agreement.priceRub)}</strong>
        {agreement.payDue && !reported && (
          <span className={left !== null && left < 3 ? "aag-due__soon" : ""}>Оплатить до {ruDate(agreement.payDue)}</span>
        )}
      </div>

      {pay?.payLink && !reported ? (
        <a className="aag-sbp-button" href={pay.payLink} target="_blank" rel="noreferrer noopener" aria-label="Оплатить через СБП">
          <span>Оплатить</span>
          <SbpMark />
          <span className="aag-sbp-button__word" aria-hidden="true">сбп</span>
        </a>
      ) : null}

      {details.length > 0 || pay?.sbpPhone ? (
        <div className="aag-details-pay">
          {!detailsOpen && (
            <button type="button" className="aag-link" aria-expanded={false} onClick={() => setShowDetails(true)}>Реквизиты</button>
          )}
          {detailsOpen && (
            <>
              {pay?.payLink && <p className="aag-small">Перевод по реквизитам может занять несколько дней.</p>}
              <div className="aag-req">
                {detailsQr && (
                  <figure className="aag-req__qr">
                    <div className="aag-qr__code" role="img" aria-label="QR-код с реквизитами" dangerouslySetInnerHTML={{ __html: detailsQr }} />
                    <figcaption>Наведите камеру в приложении банка: всё заполнится само</figcaption>
                  </figure>
                )}
                <dl className="aag-plain">
                  {pay?.sbpPhone && (
                    <div><dt>СБП по номеру</dt><dd>{phoneLabel(pay.sbpPhone)}{pay.sbpBank ? `, ${pay.sbpBank}` : ""}</dd></div>
                  )}
                  {details.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  ))}
                  <div><dt>Сумма</dt><dd>{rub(agreement.priceRub)}</dd></div>
                  <div><dt>Назначение</dt><dd>{purpose}</dd></div>
                </dl>
              </div>
              <button type="button" className="btn btn-secondary aag-copy-all" onClick={() => void copy("all", detailsText)}>
                {copied === "all" ? "Скопировано" : "Скопировать реквизиты"}
              </button>
              {pay?.payLink && (
                <button type="button" className="aag-link" onClick={() => setShowDetails(false)}>Скрыть реквизиты</button>
              )}
            </>
          )}
        </div>
      ) : null}

      {!pay?.payLink && details.length === 0 && !pay?.sbpPhone && (
        <p className="aag-small">Реквизиты для оплаты пришлёт редакция. Если письма нет, напишите нам в «Просьбы и предложения».</p>
      )}

      {problem && <p className="notice" role="alert">{problem}</p>}
      <div className="aag-foot">
        <span className="aag-small">Чек пришлём вам на почту.</span>
        {!reported && <button type="button" className="aag-link" disabled={busy} onClick={() => void report()}>Я оплатил(а)</button>}
        {!compact && (
          <button type="button" className="aag-link aag-link--quiet" aria-expanded={showDocs} onClick={() => setShowDocs(!showDocs)}>
            {showDocs ? "Скрыть документы" : "Документы"}
          </button>
        )}
      </div>
      {showDocs && docs}
    </section>
  );
}

/** The СБП mark (Система быстрых платежей), as on bank payment buttons. */
function SbpMark() {
  return (
    <svg className="aag-sbp-mark" viewBox="0 0 23 28" aria-hidden="true" focusable="false">
      <path fill="#5B57A2" d="M0 6.1l3.4 6.1v3.7L0 22.1z" />
      <path fill="#D90751" d="M13.1 9.9l3.2-1.96 6.5-.01-9.7 5.97z" />
      <path fill="#FAB617" d="M13.1 6.1l.02 8.1-3.4-2.1V0z" />
      <path fill="#ED6F26" d="M22.8 7.9l-6.5.01-3.2-1.96L9.7 0z" />
      <path fill="#63B22F" d="M13.1 22.1v-3.9l-3.4-2.1V28z" />
      <path fill="#1487C9" d="M16.3 20.1L3.4 12.2 0 6.1l22.8 14z" />
      <path fill="#017F36" d="M9.7 28l3.4-6.1 3.2-1.9 6.5-.01z" />
      <path fill="#984995" d="M0 22.1l9.7-6-3.3-2-3 1.8z" />
    </svg>
  );
}
