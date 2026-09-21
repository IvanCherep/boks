"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readableBoksError } from "@/lib/boks/errors";
import { sendBoksFeedback } from "@/components/boks/supabase-browser-data";
import type { FeedbackSurface } from "@/components/boks/feedback";

/**
 * The feedback box, in one component because it appears in two places: inside
 * Settings, where a reader goes to say something unprompted, and inside a sheet
 * the reader is offered after their third, tenth and thirtieth bok.
 *
 * A guest can send. That is deliberate and it is enforced on the server
 * (`submit_boks_feedback` is granted to `anon`), because the readers most worth
 * hearing from are the ones who have not signed up - asking them to register
 * first is asking them to leave.
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
      setError(readableBoksError(caught, "Could not send that. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm leading-6 text-[var(--muted-foreground)]" role="status">
        Sent — thank you. It is read, all of it. If something else comes to mind, Settings has this box
        whenever you want it.
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
        Write anything at all: what you liked, what irritated you, what is missing, the boldest idea you
        have. Nothing is too small and nothing is too far-fetched. This is how boks becomes a genuinely
        good place to read, and how the experience gets better for everyone who comes here.
      </p>
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={4000}
        rows={5}
        placeholder="What would make boks better for you?"
        aria-label="Your feedback"
        autoFocus={autoFocus}
      />
      {error && (
        <p className="text-sm text-[var(--destructive)]" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || message.trim().length < 2}>
        <Send className="size-4" />
        {busy ? "Sending…" : "Send feedback"}
      </Button>
      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
        No account, no email, nothing to fill in but this box. No name is attached unless you are signed
        in.
      </p>
    </form>
  );
}
