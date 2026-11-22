"use client";

import "@/app/author-agreement.css";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadPaymentDetails,
  loadSpaceAgreement,
  loadStudioAgreements,
  markAuthorPayment,
  savePaymentDetails,
  updateAuthorPayment,
} from "@/components/boks/author-spaces/data";
import { readableBoksError } from "@/lib/boks/errors";
import { legalHref, legalKinds, planName, rub, ruDate, type AuthorPlan, type PaymentDetails, type PayState, type StudioAgreement } from "@/lib/boks/author/agreement";
import { useUiLanguage } from "@/components/boks/ui-language";

/**
 * Studio's side of the online contract (`docs/author-agreements.md`): the
 * plan on an invitation, the contract of a page's author with «Оплата
 * получена», every contract in Studio → Authors, and the payment details
 * the authors see. The team works in Russian, so this screen is Russian only.
 */

export const invitePlans: { value: AuthorPlan | ""; label: string }[] = [
  { value: "page", label: `${planName.page}, ${rub(30000)}` },
  { value: "launch", label: `${planName.launch}, бесплатно` },
  { value: "page_no_promotion", label: `${planName.page_no_promotion}, ${rub(500000)}` },
  { value: "", label: "Без договора на сайте (особый проект)" },
];

const stateLabel: Record<PayState, string> = {
  free: "бесплатный тариф",
  awaiting: "ждём оплату",
  reported: "автор сообщил об оплате",
  paid: "оплачено",
  cancelled: "расторгнут",
};

const docShort = { author_offer: "оферта", author_pd_processing: "согласие на обработку", author_pd_distribution: "согласие на распространение" } as const;

/** The plan and the name for the contract, inside «Пригласить автора». */
export function InvitePlanFields({
  plan,
  setPlan,
  legalName,
  setLegalName,
}: {
  plan: AuthorPlan | "";
  setPlan: (plan: AuthorPlan | "") => void;
  legalName: string;
  setLegalName: (name: string) => void;
}) {
  return (
    <>
      <label className="asp-field">
        <span>Тариф (договор-оферта)</span>
        <select className="asp-select" value={plan} onChange={(event) => setPlan(event.target.value as AuthorPlan | "")}>
          {invitePlans.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <small>
          {plan
            ? "Автор примет оферту этого тарифа и два согласия галочками на экране приглашения. Кабинет откроется сразу, страница читателям только после оплаты."
            : "Приглашение без оферты: договор с автором оформлен отдельно."}
        </small>
      </label>
      {plan && (
        <label className="asp-field">
          <span>ФИО для договора (необязательно)</span>
          <Input value={legalName} autoComplete="off" maxLength={200} placeholder="Иванова Анна Сергеевна" onChange={(event) => setLegalName(event.target.value)} />
          <small>Подставится автору, он проверит и исправит.</small>
        </label>
      )}
    </>
  );
}

function AgreementFacts({ agreement }: { agreement: StudioAgreement }) {
  return (
    <dl className="aag-facts">
      <div><dt>Договор</dt><dd>№ {agreement.number} от {ruDate(agreement.acceptedAt)}, «{planName[agreement.plan]}», {agreement.priceRub ? rub(agreement.priceRub) : "бесплатно"}</dd></div>
      <div><dt>Автор</dt><dd>{agreement.legalName}{agreement.handle ? ` · @${agreement.handle}` : ""} · {agreement.email}</dd></div>
      <div><dt>Оплата</dt><dd>
        <span className={`aag-state aag-state--${agreement.payState}`}>{stateLabel[agreement.payState]}</span>
        {agreement.payState === "awaiting" && agreement.payDue ? ` · до ${ruDate(agreement.payDue)}` : ""}
        {agreement.payState === "reported" && agreement.reportedAt ? ` · ${new Date(agreement.reportedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
        {agreement.payState === "paid" ? ` · ${agreement.paidAmountRub ? rub(agreement.paidAmountRub) : ""} ${ruDate(agreement.periodStart)}, год до ${ruDate(agreement.periodEnd)}` : ""}
        {agreement.receiptUrl && <> · <a href={agreement.receiptUrl} target="_blank" rel="noreferrer noopener">чек</a></>}
      </dd></div>
      <div><dt>Акцепт</dt><dd>
        {new Date(agreement.acceptedAt).toLocaleString("ru-RU")} · IP {agreement.acceptedIp ?? "нет"} ·{" "}
        {legalKinds.map((kind, n) => (
          <span key={kind}>{n > 0 && ", "}<a href={legalHref(kind, agreement.documents[kind])} target="_blank" rel="noreferrer noopener">{docShort[kind]} {agreement.documents[kind]}</a></span>
        ))}
      </dd></div>
    </dl>
  );
}

/** «Оплата получена», the receipt and undoing a mistaken mark. */
function PaymentActions({ agreement, onChange }: { agreement: StudioAgreement; onChange: (next: StudioAgreement) => void }) {
  const language = useUiLanguage();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  const [open, setOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState(String(agreement.priceRub));
  const [receipt, setReceipt] = useState(agreement.receiptUrl ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function run(action: () => Promise<StudioAgreement>) {
    setBusy(true);
    setProblem("");
    try {
      onChange(await action());
      setOpen(false);
    } catch (error) {
      setProblem(readableBoksError(error, "Не получилось.", language));
    } finally {
      setBusy(false);
    }
  }

  if (agreement.payState === "awaiting" || agreement.payState === "reported") {
    return (
      <div className="aag-team">
        {!open ? (
          <Button size="sm" onClick={() => setOpen(true)}>Оплата получена</Button>
        ) : (
          <div className="aag-team__form">
            <label className="asp-field"><span>День поступления</span><Input type="date" value={paidOn} max={today} onChange={(event) => setPaidOn(event.target.value)} /></label>
            <label className="asp-field"><span>Сумма, ₽</span><Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} /></label>
            <label className="asp-field"><span>Ссылка на чек из «Мой налог»</span><Input value={receipt} placeholder="https://lknpd.nalog.ru/api/v1/receipt/…" onChange={(event) => setReceipt(event.target.value)} /><small>Можно добавить позже.</small></label>
            <label className="asp-field"><span>Заметка для команды</span><Input value={note} placeholder="Перевод СБП от Анны С." onChange={(event) => setNote(event.target.value)} /></label>
            {Number(amount) !== agreement.priceRub && <p className="asp-warn">Сумма отличается от цены тарифа ({rub(agreement.priceRub)}).</p>}
            <div className="asp-buttons">
              <Button size="sm" disabled={busy || !paidOn || !Number(amount)} onClick={() => void run(() => markAuthorPayment(agreement.id, paidOn, Number(amount), receipt.trim(), note.trim()))}>Подтвердить оплату</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            </div>
          </div>
        )}
        {problem && <p className="asp-warn" role="alert">{problem}</p>}
      </div>
    );
  }
  if (agreement.payState === "paid") {
    return (
      <div className="aag-team">
        {!open ? (
          <div className="asp-buttons">
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{agreement.receiptUrl ? "Изменить чек" : "Добавить чек"}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => updateAuthorPayment(agreement.id, "unmark"))}>Снять отметку об оплате</Button>
          </div>
        ) : (
          <div className="aag-team__form">
            <label className="asp-field"><span>Ссылка на чек из «Мой налог»</span><Input value={receipt} onChange={(event) => setReceipt(event.target.value)} /></label>
            <div className="asp-buttons">
              <Button size="sm" disabled={busy} onClick={() => void run(() => updateAuthorPayment(agreement.id, "receipt", receipt.trim()))}>Сохранить</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            </div>
          </div>
        )}
        {problem && <p className="asp-warn" role="alert">{problem}</p>}
      </div>
    );
  }
  return null;
}

/** On a page in Studio → Authors: its author's contract. */
export function SpaceAgreementPanel({ spaceId }: { spaceId: string }) {
  const [agreement, setAgreement] = useState<StudioAgreement | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadSpaceAgreement(spaceId).then((value) => live && setAgreement(value), () => live && setAgreement(null));
    return () => {
      live = false;
    };
  }, [spaceId]);
  if (!agreement) return null;
  return (
    <section className="asp-card aag-studio">
      <header className="asp-card__head"><h2>Договор и оплата</h2></header>
      <AgreementFacts agreement={agreement} />
      <PaymentActions agreement={agreement} onChange={setAgreement} />
    </section>
  );
}

/** Studio → Authors: every contract, waiting payments first, and the payment details. */
export function AuthorAgreements() {
  const [rows, setRows] = useState<StudioAgreement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const load = useCallback(() => loadStudioAgreements().then((next) => { setRows(next); setFailed(false); }, () => setFailed(true)), []);
  useEffect(() => void load(), [load]);
  const waiting = rows?.filter((row) => row.payState === "awaiting" || row.payState === "reported").length ?? 0;

  return (
    <section className="author-applications aag-studio">
      <header>
        <div>
          <h2>Договоры авторов{waiting ? ` · ждут оплаты: ${waiting}` : ""}</h2>
          <p>Автор принимает оферту и два согласия на экране приглашения, платит по QR-коду из кабинета и нажимает «Я оплатил(а)». Проверьте поступление в банке и нажмите «Оплата получена»: страница сможет открыться читателям, год пойдёт с этого дня.</p>
        </div>
        <div className="asp-buttons">
          <Button variant="outline" size="sm" onClick={() => setDetailsOpen(!detailsOpen)}>Реквизиты для оплаты</Button>
          <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />Обновить</Button>
        </div>
      </header>
      {detailsOpen && <PaymentDetailsForm onClose={() => setDetailsOpen(false)} />}
      {failed && <p className="author-applications__error">Не удалось загрузить договоры.</p>}
      {rows?.length === 0 && <p className="author-applications__muted">Договоров пока нет.</p>}
      <ul>
        {rows?.map((row) => (
          <li key={row.id}>
            <AgreementFacts agreement={row} />
            <PaymentActions agreement={row} onChange={(next) => setRows((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const detailFields: { key: keyof PaymentDetails; label: string; hint?: string; placeholder?: string }[] = [
  { key: "recipient", label: "Получатель (ФИО полностью)", placeholder: "Курносов Андрей Алексеевич" },
  { key: "inn", label: "ИНН получателя", hint: "12 цифр" },
  { key: "account", label: "Счёт получателя", hint: "20 цифр" },
  { key: "bank", label: "Банк", placeholder: "АО «АЛЬФА-БАНК»" },
  { key: "bic", label: "БИК", hint: "9 цифр" },
  { key: "corrAccount", label: "Корр. счёт", hint: "20 цифр" },
  { key: "sbpPhone", label: "Телефон для СБП", placeholder: "+7 900 000-00-00" },
  { key: "sbpBank", label: "Банк для СБП", placeholder: "Альфа-Банк" },
  { key: "payLink", label: "Готовая ссылка на оплату (необязательно)", hint: "Если банк дал ссылку или QR СБП: QR-код в кабинете будет вести на неё вместо реквизитов." },
];

function PaymentDetailsForm({ onClose }: { onClose: () => void }) {
  const language = useUiLanguage();
  const [details, setDetails] = useState<Partial<PaymentDetails>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void loadPaymentDetails().then((value) => setDetails(value ?? {}), () => setMessage("Не удалось загрузить реквизиты."));
  }, []);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      setDetails((await savePaymentDetails(details)) ?? {});
      setMessage("Сохранено. Авторы увидят эти реквизиты в кабинете.");
    } catch (error) {
      setMessage(readableBoksError(error, "Не удалось сохранить.", language));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="aag-details">
      <p className="author-applications__muted">QR-код в кабинете автора собирается из этих реквизитов (формат банковской квитанции): сумма и назначение с номером договора заполняются сами. Проверьте его в паре банковских приложений, прежде чем отправлять авторам.</p>
      <div className="aag-details__grid">
        {detailFields.map((field) => (
          <label key={field.key} className="asp-field">
            <span>{field.label}</span>
            <Input value={String(details[field.key] ?? "")} placeholder={field.placeholder} onChange={(event) => setDetails({ ...details, [field.key]: event.target.value })} />
            {field.hint && <small>{field.hint}</small>}
          </label>
        ))}
      </div>
      {message && <p className="asp-notice" role="status">{message}</p>}
      <div className="asp-buttons">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Сохранить реквизиты</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    </div>
  );
}
