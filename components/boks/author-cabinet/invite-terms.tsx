"use client";

import { useEffect, useState } from "react";
import { legalHref, legalNameProblem, planName, rub, type DocumentKind, type InviteTerms } from "@/lib/boks/author/agreement";

/**
 * The contract on the invitation screen (`docs/author-agreements.md`): the
 * plan the team chose, the full name for the contract, and three separate
 * boxes, none ticked beforehand: the offer, the consent to processing and the
 * consent to distribution (152-ФЗ wants each consent on its own). The button
 * below works once the name is written and every box is ticked.
 */

export type InviteTermsState = ReturnType<typeof useInviteTerms>;

export function useInviteTerms(
  token: string | null,
  inviteId: string | null,
  load: (token: string | null, inviteId: string | null) => Promise<InviteTerms | null>,
) {
  // The answer for the invitation it was asked about: loading until it is this one's.
  const key = token || inviteId ? `${token ?? ""}:${inviteId ?? ""}` : "";
  const [answer, setAnswer] = useState<{ key: string; value: InviteTerms | null } | null>(null);
  const [name, setName] = useState("");
  const [ticked, setTicked] = useState<Set<DocumentKind>>(new Set());
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!key) return;
    let live = true;
    load(token, inviteId)
      .then((value) => {
        if (!live) return;
        setAnswer({ key, value });
        if (value?.legalName) setName(value.legalName);
      })
      .catch(() => live && setAnswer({ key, value: null }));
    return () => {
      live = false;
    };
  }, [key, token, inviteId, load]);
  const loading = Boolean(key) && answer?.key !== key;
  const value = key && answer?.key === key ? answer.value : null;

  const nameProblem = legalNameProblem(name);
  const ready = Boolean(value) && !nameProblem && Boolean(value?.documents.length) && value!.documents.every((doc) => ticked.has(doc.kind));

  return {
    value,
    loading,
    name,
    setName: (next: string) => { setName(next); setTouched(true); },
    touched,
    nameProblem,
    ticked,
    toggle(kind: DocumentKind) {
      const next = new Set(ticked);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      setTicked(next);
    },
    ready,
    payload(): Record<string, string> {
      const out: Record<string, string> = { legalName: name.replace(/\s+/g, " ").trim() };
      for (const doc of value?.documents ?? []) out[doc.kind] = doc.version;
      return out;
    },
  };
}

const boxText: Record<DocumentKind, { before: string; link: string; after: string }> = {
  author_offer: { before: "Я прочитал(а) и принимаю ", link: "договор-оферту", after: "" },
  author_partner_offer: { before: "Я прочитал(а) и принимаю ", link: "договор-оферту о сотрудничестве", after: "" },
  author_pd_processing: { before: "Даю ", link: "согласие на обработку персональных данных", after: "" },
  author_pd_distribution: { before: "Даю ", link: "согласие на распространение персональных данных", after: ": имя, фото, биография и голос будут на моей странице" },
};

export function InviteTermsBlock({ terms, pageOpen = false }: { terms: InviteTermsState; pageOpen?: boolean }) {
  const value = terms.value;
  if (!value) return null;
  const paid = value.priceRub > 0;
  return (
    <div className="aag-terms">
      <div className="aag-plan">
        <span className="aag-plan__name">
          Тариф «{planName[value.plan]}»
          {value.seriesPerYear ? <small className="aag-plan__more">до {value.seriesPerYear} серий в год, не чаще одной в неделю</small> : null}
        </span>
        <span className="aag-plan__price">{paid ? `${rub(value.priceRub)} за год` : "бесплатно"}</span>
      </div>
      {paid ? (
        <p className="aag-lead">
          Сейчас платить не нужно. Кабинет откроется сразу: добавьте тексты и запишите голос. Оплатить можно в течение {value.payDays} дней
          по QR-коду из кабинета. {pageOpen ? "Редакция начнёт делать Series после оплаты." : "Страница откроется читателям, а редакция начнёт делать Series после оплаты."}
        </p>
      ) : (
        <p className="aag-lead">
          {value.plan === "partner"
            ? "Кабинет откроется сразу. Платить ничего не нужно. Ваша часть: пост со ссылкой на каждую вышедшую Series в своём открытом аккаунте (раздел 6 договора)."
            : "Кабинет откроется сразу. Условие тарифа: делиться каждой вышедшей Series в своём открытом аккаунте (раздел 6 договора)."}
        </p>
      )}

      <label className="aag-field">
        <span>Фамилия, имя и отчество для договора</span>
        <input
          value={terms.name}
          autoComplete="name"
          maxLength={200}
          placeholder="Иванова Анна Сергеевна"
          aria-invalid={terms.touched && Boolean(terms.nameProblem)}
          onChange={(event) => terms.setName(event.target.value)}
        />
        {terms.touched && terms.nameProblem && <small className="aag-field__problem">{terms.nameProblem}</small>}
      </label>

      <ul className="aag-boxes">
        {value.documents.map((doc) => {
          const text = boxText[doc.kind];
          return (
            <li key={doc.kind}>
              <label className="aag-box">
                <input type="checkbox" checked={terms.ticked.has(doc.kind)} onChange={() => terms.toggle(doc.kind)} />
                <span>
                  {text.before}
                  <a href={legalHref(doc.kind, doc.version)} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>
                    {text.link}
                  </a>
                  {doc.kind === "author_offer" || doc.kind === "author_partner_offer" ? ` по тарифу «${planName[value.plan]}»` : ""}
                  {text.after}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="aag-small">
        Договор заключается в электронной форме. Вход по коду из письма служит простой электронной подписью. Номер договора и все
        документы будут в кабинете.
      </p>
    </div>
  );
}
