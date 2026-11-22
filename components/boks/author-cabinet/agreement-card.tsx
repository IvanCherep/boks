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
 * «Я оплатил(а)»; after the team marks the money, the year and the receipt.
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
}: {
  agreement: AuthorAgreement | null;
  onChange: (next: AuthorAgreement) => void;
  /** In the Workshop: only what asks for action, the rest behind «Договор». */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
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
          {agreement.payState === "paid" ? `Оплачен ${ruDate(agreement.periodStart)}` : "Бесплатный тариф"}
          {until ? ` · ${until}` : ""}
          {agreement.receiptUrl && (
            <> · <a href={agreement.receiptUrl} target="_blank" rel="noreferrer noopener">Чек</a></>
          )}
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
          <strong>Спасибо, вы сообщили об оплате.</strong> Проверяем поступление, обычно в течение рабочего дня. Когда деньги придут,
          здесь появится чек, а страница сможет открыться читателям. Тексты и голос можно добавлять и сейчас.
        </p>
      ) : (
        <p className="aag-card__lead">
          <strong>Подготовительный период.</strong> Добавляйте тексты и записывайте голос. Страница откроется читателям, а редакция
          начнёт делать Series после оплаты.
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
          {qr ? (
            <div className="aag-qr">
              <div className="aag-qr__code" role="img" aria-label="QR-код для оплаты" dangerouslySetInnerHTML={{ __html: qr.svg }} />
              <p>
                <strong>Оплата по QR-коду.</strong> Если кабинет открыт на компьютере, откройте на телефоне приложение банка, найдите «Оплата по QR» или сканер и наведите камеру:
                {qr.kind === "details" ? " получатель, сумма и назначение заполнятся сами." : " откроется перевод через СБП."} Проверьте сумму: {rub(agreement.priceRub)}.
              </p>
              {qr.kind === "link" && (
                <a className="btn btn-secondary aag-qr__open" href={qr.value} target="_blank" rel="noreferrer noopener">Открыть оплату на телефоне</a>
              )}
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

          {!qr && !pay?.sbpPhone && (
            <p className="aag-card__lead">Реквизиты для оплаты пришлёт редакция. Если письма нет, напишите нам в «Просьбы и предложения».</p>
          )}

          <div className="aag-purpose">
            <span>Назначение платежа</span>
            <p>{purpose}</p>
            <CopyButton label="назначение" copied={copied} onCopy={() => void copy("назначение", purpose)} />
          </div>
          <p className="aag-small">Чек из «Мой налог» появится здесь после того, как мы получим оплату.</p>
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
