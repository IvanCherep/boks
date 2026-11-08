import { ReaderBackIcon } from "@/components/boks/reader/reader-icons";
import { supportEmail, supportMailto } from "@/lib/boks/contact";

const effectiveDate = "November 9, 2026";

export function PrivacyEn() {
  return (
    <main className="legal-page legal-v44">
      <article className="legal-document">
        <header className="social-page-header"><a className="social-icon" href="/" aria-label="Back to reading"><ReaderBackIcon /></a><span>Privacy</span><span /></header>
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
        <p>
          <strong>How you arrived:</strong> for each visit, the country your connection comes from (worked out by
          our server from your network address at the moment of the visit, with the country database of{" "}
          <a href="https://db-ip.com">DB-IP</a>; the address itself is not kept for this), whether you came through a
          shared link, the site that sent you, and any campaign tag in the link. This tells us who our readers are
          and which languages to add next.
        </p>
        <p>
          <strong>Feedback you send:</strong> the text you write in the feedback box, where you opened it, how many
          boks you had read at the time, your browser&apos;s anonymous id, and your @nickname if you are signed in.
          Only the boks team can read it. An email to our address reaches us through Cloudflare, which forwards it to
          the team&apos;s inbox.
        </p>

        <h2>Why</h2>
        <p>
          To run the service, to recommend boks you are likely to enjoy, to compare ways of recommending them, and to
          understand how the pilot is used. boks does not sell your data and shows no advertising.
        </p>
        <p>
          <strong>How recommendations are made:</strong> the texts themselves are analysed to find pieces that
          resemble one another, and what you have read, finished and liked is compared against them on boks&apos;s own
          servers when your feed is built. Nothing about you is sent to anyone else to do this, and nothing is
          decided about you beyond which bok to show next.
        </p>

        <h2>What others can see</h2>
        <p>
          Your @nickname, your comments and the boks you publish are visible to other readers. Your email, likes,
          follows and reading activity are not.
        </p>

        <h2>Where it is kept</h2>
        <p>
          The site, the database and sign-in run on boks&apos;s own server in a Selectel data centre in Moscow
          (Russia). Sign-in emails are sent by Resend, which receives your email address and the text of the email
          to do so. Email to our address is forwarded by Cloudflare.
        </p>
        <p>
          To make sign-in work and keep it secure, each sign-in session, including a guest one, records the network
          address and the kind of browser it was opened from. They are kept for as long as the session exists: it is
          deleted when you sign out or delete your account. They are used for nothing else.
        </p>
        <p>
          On your device, boks stores your theme, your reading languages, a local reading profile and, for guests,
          how many boks were read, in the browser&apos;s own storage. There are no third-party trackers.
        </p>

        <h2>How long it is kept</h2>
        <p>
          For as long as your account exists, or for the length of the pilot for activity recorded without an
          account. Until November 7, 2026 the boks database was hosted by Supabase in London. A copy of it as of that
          date stays there for a while as a backup and will then be deleted; nothing new goes there.
        </p>

        <h2>Deleting it</h2>
        <p>
          Signed in, open Settings and choose <strong>Delete account</strong>. That removes your email, profile,
          likes, comments, follows and reading history. Boks you published are hidden and no longer carry your name.
          As a guest, clearing this site&apos;s data in your browser removes what is stored on your device.
        </p>

        <h2>Age</h2>
        <p>
          Accounts are for people aged 16 and over, and boks does not knowingly keep data about anyone younger. If you
          believe a child has created an account, tell us and we will delete it.
        </p>

        <h2>Contact</h2>
        <p>
          Write to <a href={supportMailto}>{supportEmail}</a> about anything on this page: what is stored about
          you, a copy of it, correcting it, or deleting it - including feedback you sent or activity recorded without
          an account. One person reads that mailbox during the pilot.
        </p>
      </article>
    </main>
  );
}
