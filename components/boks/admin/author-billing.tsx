"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/boks/supabase-client";
import { readableBoksError } from "@/lib/boks/errors";
import { planName, rub, type AuthorPlan, type PayState } from "@/lib/boks/author/agreement";

/*
 * «Условия автора» (`docs/author-agreements.md`, "Who pays"): whether this
 * author pays. Ours (partners, special projects, everyone from before the
 * online contract) have no payment step and no yearly limit; paid ones work
 * by their contract's tariff. Switching a paid author to ours waives the
 * payment on the contract; switching back asks for it again. Russian only,
 * like the rest of the team's contract screens.
 */

type Billing = "partner" | "paid";
type SpaceBilling = {
  billing: Billing;
  owned: boolean;
  agreement: { number: string; plan: AuthorPlan; priceRub: number; payState: PayState; seriesPerYear: number | null } | null;
};

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
}

const payWords: Partial<Record<PayState, string>> = {
  awaiting: "ждём оплату",
  reported: "автор сообщил об оплате",
  paid: "оплачено",
  waived: "оплата снята редакцией",
  free: "бесплатный тариф",
};

export function SpaceBillingPanel({ spaceId }: { spaceId: string }) {
  const [state, setState] = useState<SpaceBilling | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    call<SpaceBilling>("studio_space_billing", { p_space_id: spaceId }).then(setState, () => setState(null));
  }, [spaceId]);
  useEffect(load, [load]);

  async function choose(next: Billing) {
    if (!state || next === state.billing) return;
    const unpaid = state.agreement && (state.agreement.payState === "awaiting" || state.agreement.payState === "reported");
    if (next === "partner" && unpaid && !window.confirm(`Снять оплату по договору № ${state.agreement!.number}? Автор больше не увидит «Оплатить», серии можно делать сразу.`)) return;
    setBusy(true);
    setNote("");
    try {
      setState(await call<SpaceBilling>("studio_set_space_billing", { p_space_id: spaceId, p_billing: next, p_note: null }));
      setNote(next === "partner" ? "Теперь это наш автор: без оплаты." : "Теперь автор платит по договору.");
    } catch (error) {
      setNote(readableBoksError(error, "Не получилось.", "ru"));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const a = state.agreement;
  return (
    <section className="asp-card abil">
      <header className="asp-card__head"><h2>Условия автора</h2></header>
      <div className="abil-choice" role="radiogroup" aria-label="Условия автора">
        <label>
          <input type="radio" name={`billing-${spaceId}`} checked={state.billing === "partner"} disabled={busy} onChange={() => void choose("partner")} />
          <span>
            <strong>Наш автор, без оплаты</strong>
            <small>Партнёрство, особый проект. Нет шага оплаты и годового лимита; серии выходят пачкой, когда решит редакция.</small>
          </span>
        </label>
        <label>
          <input type="radio" name={`billing-${spaceId}`} checked={state.billing === "paid"} disabled={busy} onChange={() => void choose("paid")} />
          <span>
            <strong>Платный, по договору</strong>
            <small>
              {a
                ? `Договор № ${a.number}, «${planName[a.plan]}», ${a.priceRub ? rub(a.priceRub) : "бесплатно"}${a.seriesPerYear ? `, до ${a.seriesPerYear} Series в год` : ""} · ${payWords[a.payState] ?? a.payState}.`
                : state.owned
                  ? "Нужен договор по платному тарифу: у автора его пока нет."
                  : "Тариф выбирается в приглашении ниже; после принятия автор платит до начала работы над сериями."}
            </small>
          </span>
        </label>
      </div>
      {note && <p className="aag-small" role="status">{note}</p>}
    </section>
  );
}
