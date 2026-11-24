"use client";

import "@/app/author-desk.css";
import "@/app/author-agreement.css";
import "@/app/author-billing.css";
import { useCallback, useEffect, useState } from "react";
import { AgreementCard, awaitingPayment } from "@/components/boks/author-cabinet/agreement-card";
import { loadMyBilling } from "@/components/boks/author-spaces/data";
import { readableBoksError } from "@/lib/boks/errors";
import {
  agreementDocKind,
  legalHref,
  legalKinds,
  legalVersionLabel,
  paymentKindName,
  planName,
  rub,
  ruDate,
  type AuthorAgreement,
  type AuthorPayment,
  type BillingAgreement,
  type LegalKind,
  type MyBilling,
} from "@/lib/boks/author/agreement";

/*
 * «Договор и оплаты» (`docs/author-agreements.md`, "Contract and payments"):
 * one quiet page with the contract, its year, every payment with its receipt
 * and the documents the author accepted. The Workshop speaks of money only
 * while a payment is asked for; the rest of the time it lives here, one link
 * away at the foot of the Workshop and of My page.
 */

const docName: Record<LegalKind, string> = {
  author_offer: "Договор-оферта",
  author_pd_processing: "Согласие на обработку персональных данных",
  author_pd_distribution: "Согласие на распространение персональных данных",
};

const stateLabel: Record<AuthorPayment["state"], string> = {
  awaiting: "Ждёт оплаты",
  reported: "Проверяем поступление",
  paid: "Оплачено",
  waived: "Без оплаты",
  cancelled: "Отменено",
};

function seriesWord(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? "серия" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "серии" : "серий";
}

export function AuthorBilling() {
  const [data, setData] = useState<MyBilling | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "signed-out" | "failed">("loading");
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await loadMyBilling());
      setStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "");
      if (/Sign in first|JWT|not authenticated/i.test(message)) setStatus("signed-out");
      else {
        setProblem(readableBoksError(error, "Не получилось загрузить. Проверьте интернет и попробуйте ещё раз.", "ru"));
        setStatus("failed");
      }
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const current = data?.agreements.find((agreement) => agreement.payState !== "cancelled") ?? null;
  const past = data?.agreements.filter((agreement) => agreement !== current) ?? [];
  const partner = data?.billing === "partner";
  const payments = data?.agreements.flatMap((agreement) => agreement.payments.map((payment) => ({ payment, agreement }))) ?? [];

  return (
    <main className="acab desk bil">
      <header className="desk-top">
        <a href="/author/desk" className="desk-brand">
          boks <span>Мастерская</span>
        </a>
        <nav className="desk-top-links">
          <a href="/author/desk">← В мастерскую</a>
        </nav>
      </header>

      <div className="bil-body">
        {status === "loading" ? (
          <div className="desk-loading" aria-busy="true" aria-label="Загружаем">
            <span />
            <span />
            <span />
          </div>
        ) : status === "signed-out" ? (
          <div className="desk-empty">
            <h3>Войдите, чтобы увидеть договор</h3>
            <a className="desk-btn desk-btn-red" href="/author">Войти</a>
          </div>
        ) : status === "failed" ? (
          <div className="desk-empty">
            <h3>Не получилось открыть</h3>
            <p>{problem}</p>
            <button type="button" className="desk-btn desk-btn-red" onClick={() => void load()}>Попробовать ещё раз</button>
          </div>
        ) : !current ? (
          <div className="desk-empty">
            <h3>Договора пока нет</h3>
            <p>Вы публикуетесь в boks по договорённости с редакцией. Если появится договор, он и все документы будут здесь.</p>
            <a className="desk-btn desk-btn-ink" href="/author/desk">В мастерскую</a>
          </div>
        ) : (
          <>
            <h1 className="bil-title">{partner || current.priceRub === 0 ? "Договор" : "Договор и оплаты"}</h1>
            <p className="bil-lead">
              {partner || current.priceRub === 0
                ? "Вы публикуетесь в boks по договорённости с редакцией, без оплаты. Здесь ваш договор и документы, которые вы приняли."
                : "Ваш тариф, оплаты с чеками и документы. В мастерской мы напомним об этом, только если что-то понадобится от вас."}
            </p>

            {awaitingPayment(current) ? (
              <div className="bil-pay">
                <AgreementCard agreement={current} onChange={() => void load()} compact pageOpen />
              </div>
            ) : null}

            <Contract agreement={current} partner={partner} />

            {payments.length > 0 && (
              <section className="bil-section" aria-label="Оплаты">
                <h2>Оплаты</h2>
                <ul className="bil-payments">
                  {payments.map(({ payment, agreement }) => (
                    <Payment key={payment.id} payment={payment} agreement={agreement} />
                  ))}
                </ul>
                <p className="bil-note">Чек из «Мой налог» приходит на почту {current.email}, когда мы получаем оплату, и появляется здесь.</p>
              </section>
            )}

            <section className="bil-section" aria-label="Документы">
              <h2>Документы</h2>
              <p className="bil-note">Редакции, которые вы приняли {ruDate(current.acceptedAt)}. Они действуют для вашего договора, даже если на сайте появятся новые.</p>
              <ul className="bil-docs">
                {legalKinds.map((kind) => (
                  <li key={kind}>
                    <a href={legalHref(agreementDocKind(kind, current.plan), current.documents[kind])} target="_blank" rel="noreferrer noopener">
                      <span>{docName[kind]}</span>
                      <small>редакция от {legalVersionLabel(current.documents[kind])}</small>
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            {past.length > 0 && (
              <details className="bil-section bil-past">
                <summary>Прошлые договоры ({past.length})</summary>
                <ul>
                  {past.map((agreement) => (
                    <li key={agreement.id}>
                      <b>№ {agreement.number}</b> · «{planName[agreement.plan]}» · от {ruDate(agreement.acceptedAt)}
                      {agreement.periodStart && agreement.periodEnd ? ` · ${ruDate(agreement.periodStart)} — ${ruDate(agreement.periodEnd)}` : ""}
                      {agreement.payState === "cancelled" ? " · расторгнут" : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="bil-help">
              Вопрос по договору или оплате? <a href="/author/desk#support">Напишите редакции</a>, обычно отвечаем в течение рабочего дня.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Contract({ agreement, partner }: { agreement: BillingAgreement; partner: boolean }) {
  const free = partner || agreement.priceRub === 0;
  const per = agreement.seriesPerYear;
  const used = agreement.seriesUsed;
  const status =
    agreement.payState === "paid"
      ? { tone: "ok", text: agreement.periodEnd ? `Действует до ${ruDate(agreement.periodEnd)}` : "Оплачен" }
      : agreement.payState === "reported"
        ? { tone: "wait", text: "Проверяем оплату" }
        : agreement.payState === "awaiting"
          ? { tone: "wait", text: agreement.payDue ? `Оплата до ${ruDate(agreement.payDue)}` : "Ждёт оплаты" }
          : { tone: "ok", text: "Действует" };
  return (
    <section className="bil-card" aria-label="Договор">
      <div className="bil-card__head">
        <div>
          <span className="bil-eyebrow">Тариф</span>
          <strong>«{planName[agreement.plan]}»</strong>
        </div>
        <span className={`bil-chip is-${status.tone}`}>{status.text}</span>
      </div>
      <dl className="bil-facts">
        <div>
          <dt>Договор</dt>
          <dd>№ {agreement.number} от {ruDate(agreement.acceptedAt)}</dd>
        </div>
        {!free && (
          <div>
            <dt>Стоимость</dt>
            <dd>{rub(agreement.priceRub)} за год</dd>
          </div>
        )}
        <div>
          <dt>Период</dt>
          <dd>
            {agreement.periodStart && agreement.periodEnd
              ? `${ruDate(agreement.periodStart)} — ${ruDate(agreement.periodEnd)}`
              : free
                ? "без срока"
                : "год начнётся с оплаты"}
          </dd>
        </div>
        <div>
          <dt>Серии</dt>
          <dd>{per ? `${used} из ${per} за год` : used ? `${used} ${seriesWord(used)}, без годового лимита` : "без годового лимита"}</dd>
        </div>
      </dl>
      {per ? (
        <div className="bil-meter" role="img" aria-label={`${used} из ${per} серий за год`}>
          <span style={{ width: `${Math.min(100, Math.round((used / per) * 100))}%` }} />
        </div>
      ) : null}
      {per ? <p className="bil-note">Не чаще одной серии в неделю, в порядке вашей очереди. Число в год записано в вашем договоре и не меняется до его конца.</p> : null}
    </section>
  );
}

function Payment({ payment, agreement }: { payment: AuthorPayment; agreement: AuthorAgreement }) {
  const when =
    payment.state === "paid"
      ? ruDate(payment.paidAt)
      : payment.state === "reported"
        ? `сообщили ${ruDate(payment.reportedAt)}`
        : payment.dueOn
          ? `до ${ruDate(payment.dueOn)}`
          : "";
  return (
    <li className={`bil-payment is-${payment.state}`}>
      <div className="bil-payment__what">
        <strong>{paymentKindName[payment.kind]}</strong>
        <small>
          «{planName[agreement.plan]}» · договор № {agreement.number}
          {when ? ` · ${when}` : ""}
        </small>
      </div>
      <div className="bil-payment__sum">
        <strong>{rub(payment.paidAmountRub ?? payment.amountRub)}</strong>
        <span className={`bil-chip is-${payment.state === "paid" || payment.state === "waived" ? "ok" : "wait"}`}>{stateLabel[payment.state]}</span>
      </div>
      {payment.state === "paid" ? (
        payment.receiptUrl ? (
          <a className="bil-receipt" href={payment.receiptUrl} target="_blank" rel="noreferrer noopener">Чек ↗</a>
        ) : (
          <span className="bil-receipt is-later">чек придёт на почту</span>
        )
      ) : null}
    </li>
  );
}
