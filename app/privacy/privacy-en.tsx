import type { LegalDocumentProps } from "@/components/boks/legal/legal-layout";
import { supportEmail, supportMailto } from "@/lib/boks/contact";

export const privacyEn: Omit<LegalDocumentProps, "page" | "language"> = {
  title: "Privacy",
  effective: "Effective November 14, 2026",
  intro: "What data boks uses, what other readers can see, and how to ask for a copy, a correction or deletion.",
  highlights: [
    { title: "Where data is kept", body: "The main boks database is in Moscow, Russia." },
    {
      title: "What others see",
      body: "Public comments and your @nickname, published texts and their bylines. An author page also shows a name and photo if you added them.",
    },
    {
      title: "Managing your data",
      body: "You can delete your account in Settings. For a copy, a correction or deletion of guest reading data, write to support.",
    },
  ],
  sections: [
    {
      id: "data",
      title: "What data we use",
      body: <>
        <p>
          <strong>Your account:</strong> your email address, which is needed to sign in, and your public @nickname,
          which starts from the part of your email before the @ and can be changed in Settings. Also the reading
          languages you choose and when you accepted the <a href="/terms">Terms</a>. If you publish, your author page
          keeps a name and photo if you added them.
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
          <strong>How you arrived:</strong> for each visit, the country your connection comes from (worked out by our
          server from your network address at the moment of the visit, with the country database of{" "}
          <a href="https://db-ip.com">DB-IP</a>; the address itself is not kept for this), whether you came through a
          shared link, the site that sent you, and any campaign tag in the link. This tells us who our readers are and
          which languages to add next.
        </p>
        <p>
          <strong>Feedback you send:</strong> the text you write in the feedback box, where you opened it, how many
          boks you had read at the time, your browser&apos;s anonymous id, and your @nickname if you are signed in.
          Only the boks team can read it.
        </p>
      </>,
    },
    {
      id: "guest",
      title: "Reading as a guest",
      body: <p>
        You can read without an account. boks keeps a random id in your browser and links your actions in the reader
        to it. If you sign in from the same browser, some of what you did before signing in can be matched to your
        account.
      </p>,
    },
    {
      id: "why",
      title: "Why",
      body: <>
        <p>
          To run the service, to recommend boks you are likely to enjoy, to compare ways of recommending them, and to
          understand how the pilot is used. boks does not sell your data and shows no advertising.
        </p>
        <p>
          <strong>How recommendations are made:</strong> the texts themselves are analysed to find pieces that
          resemble one another, and what you have read, finished and liked is compared against them on boks&apos;s own
          servers when your feed is built. Nothing about you is sent to anyone else to do this, and nothing is decided
          about you beyond which bok to show next.
        </p>
      </>,
    },
    {
      id: "visible",
      title: "What others can see",
      body: <p>
        Other readers can see your @nickname and your public comments, the texts you publish and their bylines. An
        author page also shows a name and photo if you added them. Your email, likes, follows and reading activity
        are not visible.
      </p>,
    },
    {
      id: "storage",
      title: "Where data is kept",
      body: <>
        <p>
          The main boks database and the sign-in service run in Moscow, Russia, on boks&apos;s own server in a
          Selectel data centre. To deliver the email with your sign-in link or code, we use an email provider, which
          receives your address and the content of the email to deliver it. Email sent to support reaches the
          team&apos;s inbox through an email forwarding service.
        </p>
        <p>
          Your email address is needed to sign in. To run and protect your session, boks processes your IP address and
          information about your browser.
        </p>
        <p>
          On your device, boks stores your theme, your reading languages, a local reading profile and, for guests, how
          many boks were read, in the browser&apos;s own storage. There are no third-party trackers.
        </p>
      </>,
    },
    {
      id: "retention",
      title: "How long it is kept",
      body: <p>
        For as long as your account exists, or for the length of the pilot for activity recorded without an account.
        Until November 7, 2026 the boks database was hosted by Supabase in London. A copy of it as of that date stays
        there for a while as a backup and will then be deleted; nothing new goes there.
      </p>,
    },
    {
      id: "delete",
      title: "Access, correction and deletion",
      body: <>
        <p>
          To delete your account, open <strong>Settings</strong> and choose <strong>Delete account</strong>. That
          removes your email, profile, likes, comments, follows and reading history. Texts you published are hidden.
        </p>
        <p>
          Clearing this site&apos;s data in your browser removes what is stored on your device. To find out what boks
          still holds, or to ask for a copy, a correction or deletion, write to{" "}
          <a href={supportMailto}>{supportEmail}</a>. You can also write there about guest reading data and feedback
          you sent.
        </p>
      </>,
    },
    {
      id: "age",
      title: "Age",
      body: <p>
        Accounts are for people aged 16 and over, and boks does not knowingly keep data about anyone younger. If you
        believe a child has created an account, tell us and we will delete it.
      </p>,
    },
    {
      id: "contact",
      title: "Contact",
      body: <p>
        Write to <a href={supportMailto}>{supportEmail}</a> about anything on this page.
      </p>,
    },
  ],
};
