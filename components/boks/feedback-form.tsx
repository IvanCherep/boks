"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readableBoksError } from "@/lib/boks/errors";
import { sendBoksFeedback } from "@/components/boks/supabase-browser-data";
import type { FeedbackSurface } from "@/components/boks/feedback";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages(
  {
    failed: "Could not send that. Try again in a moment.",
    sent: "Sent. Every note is read.",
    prompt: "What you liked, what annoyed you, what is missing. Nothing is too small.",
    placeholder: "What would make boks better for you?",
    label: "Your feedback",
    sending: "Sending…",
    send: "Send feedback",
    noAccount: "No account or email needed. Your name is attached only if you are signed in.",
  },
  {
    ru: {
      failed: "Не получилось отправить. Попробуйте через минуту.",
      sent: "Отправлено. Мы читаем каждое сообщение.",
      prompt: "Что понравилось, что раздражало, чего не хватает. Мелочей не бывает.",
      placeholder: "Что сделало бы boks лучше для вас?",
      label: "Ваш отзыв",
      sending: "Отправляем…",
      send: "Отправить отзыв",
      noAccount: "Аккаунт и email не нужны. Ваше имя прикрепится, только если вы вошли.",
    },
  }
);

/**
 * The feedback box, in one component because it appears in two places: inside
 * Settings, where a reader goes to say something unprompted, and inside a sheet
 * the reader is offered after their third, tenth and thirtieth bok.
 *
 * A guest can send without an account, because the readers most worth hearing
 * from are the ones who have not signed up - asking them to register first is
 * asking them to leave. Since 20260925160420 the RPC wants a Supabase session
 * rather than the bare publishable key; a guest always has an anonymous one,
 * so nothing is asked of them.
 *
 * The words here are short on purpose. This used to open with five lines about
 * why feedback matters, and a reader interrupted mid-story reads none of them -
 * https://github.com/IvanCherep/boks/issues/3. What is left is the one line
 * that answers "what do you want from me" and the one that answers "what will
 * this cost me".
 */
export function FeedbackForm({
  surface,
  boksRead,
  visitorId,
  onSent,
  autoFocus = false,
}: {
  surface: FeedbackSurface;
  /** Boks read on this device, stored with the note so it can be read in context. */
  boksRead?: number;
  visitorId?: string;
  onSent?: () => void;
  autoFocus?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const t = useMessages(messages);

  async function submit() {
    const text = message.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendBoksFeedback({ message: text, surface, boksRead, visitorId });
      setSent(true);
      setMessage("");
      onSent?.();
    } catch (caught) {
      setError(readableBoksError(caught, t.failed));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm leading-6 text-[var(--muted-foreground)]" role="status">
        {t.sent}
      </p>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
        {t.prompt}
      </p>
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={4000}
        rows={5}
        placeholder={t.placeholder}
        aria-label={t.label}
        autoFocus={autoFocus}
      />
      {error && (
        <p className="text-sm text-[var(--destructive)]" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || message.trim().length < 2}>
        <Send className="size-4" />
        {busy ? t.sending : t.send}
      </Button>
      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
        {t.noAccount}
      </p>
    </form>
  );
}
