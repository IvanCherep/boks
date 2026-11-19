"use client";

import { useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { supabase } from "@/lib/boks/supabase-client";

/**
 * Studio → Authors: whether this page's owner is a verified author, who
 * publishes new boks straight away with a cover (`author_spaces.verified`,
 * `docs/author-publishing.md`). Pages the team makes are verified as they are
 * made; a page the database made for an ordinary author is not.
 */

const words = defineMessages({
  title: "Verified author",
  on: "Publishes new boks from My page straight away, with a cover; no review.",
  off: "Sends new texts for review, as every author does.",
  failed: "Could not change it. Try again.",
}, { ru: {
  title: "Верифицированный автор",
  on: "Публикует новые боки с «Моей страницы» сразу, с обложкой, без проверки.",
  off: "Отправляет новые тексты на проверку, как все авторы.",
  failed: "Не получилось изменить. Попробуйте ещё раз.",
} });

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
}

export function SpaceVerified({ spaceId }: { spaceId: string }) {
  const t = useMessages(words);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    void rpc<boolean>("studio_space_verified", { p_space_id: spaceId }).then((value) => live && setVerified(Boolean(value))).catch(() => undefined);
    return () => { live = false; };
  }, [spaceId]);

  async function toggle(next: boolean) {
    setBusy(true);
    setProblem("");
    try {
      setVerified(await rpc<boolean>("studio_set_space_verified", { p_space_id: spaceId, p_verified: next }));
    } catch {
      setProblem(t.failed);
    } finally {
      setBusy(false);
    }
  }

  if (verified === null) return null;
  return (
    <section className="asp-card">
      <label className="asp-verified">
        <input type="checkbox" checked={verified} disabled={busy} onChange={(event) => void toggle(event.target.checked)} />
        <span>
          <strong><BadgeCheck aria-hidden="true" /> {t.title}</strong>
          <small>{verified ? t.on : t.off}</small>
        </span>
      </label>
      {problem && <p className="asp-hint" role="alert">{problem}</p>}
    </section>
  );
}
