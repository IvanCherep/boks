import type { Metadata } from "next";

import { supportEmail, supportMailto } from "@/lib/boks/contact";

export const metadata: Metadata = {
  title: "Privacy · boks",
  description: "What boks collects during the pilot, why, where it is kept, and how to delete it.",
};

const effectiveDate = "September 19, 2026";

/**
 * Written from what the product actually does - the tables, the event stream,
 * the device storage - so it can be checked against the code. When the data
 * boks keeps changes, this page changes with it.
 */
export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <article className="legal-document">
        <a href="/" className="brand-word brand-button">
          boks
        </a>
        <p className="mt-8 text-sm font-semibold text-[var(--muted-foreground)]">Effective {effectiveDate}</p>
        <h1>Privacy</h1>
        <p>
          boks is in an early pilot. This page says what it keeps about you, why, where, and how to remove it. It
          goes with the <a href="/terms">Terms of Use</a>.
        </p>

        <h2>What boks keeps</h2>
        <p>
          <strong>Your account:</strong> your email address, used only to send you sign-in links, and your public
          @nickname, which starts from the part of your email before the @ and can be changed in Settings. Also the
          reading languages you choose and when you accepted the Terms.
        </p>
        <p>
          <strong>What you do in the reader:</strong> which boks you were shown and opened, how long each was on
          screen, how far you scrolled, whether you finished or moved on, and your likes, comments, follows, shares
          and reports.
        </p>
        <p>
          <strong>What you publish:</strong> the boks you submit, their review history, and anything you tell us about
          the rights to publish them.
        </p>
        <p>
          <strong>Without an account:</strong> boks gives your browser an anonymous id and keeps the same reading
          activity under it. It is not linked to an email.
        </p>

        <h2>Why</h2>
        <p>
          To run the service, to recommend boks you are likely to enjoy, to compare ways of recommending them, and to
          understand how the pilot is used. boks does not sell your data and shows no advertising.
        </p>

        <h2>What others can see</h2>
        <p>
          Your @nickname, your comments and the boks you publish are visible to other readers. Your email, likes,
          follows and reading activity are not.
        </p>

        <h2>Where it is kept</h2>
        <p>
          The database and sign-in run on Supabase, in its London region. The site is served by Cloudflare. Sign-in
          emails are sent by Resend. On your device, boks stores your theme, your reading languages, a local reading
          profile and, for guests, how many boks were read, in the browser&apos;s own storage. There are no
          third-party trackers.
        </p>

        <h2>Deleting it</h2>
        <p>
          Signed in, open Settings and choose <strong>Delete account</strong>. That removes your email, profile,
          likes, comments, follows and reading history. Boks you published are hidden and no longer carry your name.
          As a guest, clearing this site&apos;s data in your browser removes what is stored on your device.
        </p>

        <h2>Contact</h2>
        <p>
          Write to <a href={supportMailto}>{supportEmail}</a> about anything on this page: what is stored about
          you, a copy of it, or deleting it. One person reads that mailbox during the pilot.
        </p>
      </article>
    </main>
  );
}
