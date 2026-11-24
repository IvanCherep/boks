import type { LegalDocumentProps } from "@/components/boks/legal/legal-layout";
import { supportEmail, supportMailto } from "@/lib/boks/contact";

export const privacyEn: Omit<LegalDocumentProps, "page" | "language"> = {
  title: "Privacy",
  effective: "Effective November 23, 2026",
  intro: "Who processes data in boks, which data and on what basis, what others can see, and how to ask for a copy, a correction or deletion. The policy covers readers and authors alike.",
  highlights: [
    { title: "Where data is kept", body: "Only in Russia: the boks database is in Moscow, and data is not transferred abroad." },
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
      id: "operator",
      title: "Who processes data",
      body: <>
        <p>
          The personal data operator of the boks service (tryboks.com and tryboks.ru) is Andrey Alekseevich Kurnosov,
          taxpayer number (INN) 182810983035 (&ldquo;we&rdquo;). Requests about data are accepted at{" "}
          <a href={supportMailto}>{supportEmail}</a>.
        </p>
        <p>
          This Privacy policy is the operator&apos;s policy on the processing of personal data (part 2 of article 18.1
          of Russian Federal Law No. 152-FZ of 27 July 2006 &ldquo;On Personal Data&rdquo;). It is the Personal data
          processing policy referred to by the offer agreement for authors and by the authors&apos; consents.
        </p>
      </>,
    },
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
      id: "authors",
      title: "Authors with an agreement",
      body: <>
        <p>
          To conclude and perform an agreement with an author we also process: surname, first name, patronymic and pen
          name; photo and biography; the texts of the works and recordings of the author reading them; links to social
          media accounts; records of accepting the offer and the consents (date and time, IP address, browser
          details, editions of the documents); payment records (date, amount, payment purpose, the sender&apos;s name as
          the bank shows it, refund details if the author gave them) and correspondence with us.
        </p>
        <p>
          The data, purposes, recipients, retention and how to withdraw are set out in detail in the{" "}
          <a href="/author/terms/processing">consent to the processing of personal data</a>, and what readers see on
          the author page and in Series is set out in the{" "}
          <a href="/author/terms/distribution">consent to the dissemination of personal data</a> (both in Russian).
          The texts of the works are processed by Yandex.Cloud LLC (Russia) for the labels recommendations are built
          on. Authors&apos; texts and recordings, including the voice, are analysed and used to train and tune boks
          software (Boks AI) within the author offer. An author&apos;s voice is not used to identify them, or to
          synthesise or clone a voice imitating theirs.
        </p>
      </>,
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
      id: "bases",
      title: "Legal bases",
      body: <>
        <p>We process data on the bases set out in article 6 of Federal Law No. 152-FZ:</p>
        <ul>
          <li>
            performance of an agreement you are a party to (clause 5 of part 1): the <a href="/terms">Terms</a>, which
            you accept by using boks, and for an author also the <a href="/author/terms/offer">offer agreement</a>;
          </li>
          <li>
            the author&apos;s consent to the processing of personal data (article 9) and to their dissemination
            (article 10.1), which the author gives with separate ticks when concluding the agreement;
          </li>
          <li>duties imposed by law, such as issuing receipts and keeping payment records (clause 2 of part 1).</li>
        </ul>
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
          The boks database and the sign-in service run in Moscow, Russia, on boks&apos;s own server in a
          Selectel data centre. All personal data is stored and processed in Russia and is not transferred abroad.
        </p>
        <p>
          Your email address is needed to sign in. To run and protect your session, boks processes your IP address and
          information about your browser.
        </p>
        <p>
          On your device, boks stores your theme, your reading languages, a local reading profile and, for guests, how
          many boks were read, in the browser&apos;s own storage. boks also sets two cookies the site needs to work:
          one keeps you signed in when the browser restarts, the other keeps the interface language so a page opens
          in it straight away. There are no ads and no third-party trackers.
        </p>
      </>,
    },
    {
      id: "retention",
      title: "How long it is kept",
      body: <>
        <p>
          For as long as your account exists, or for the length of the pilot for activity recorded without an account.
        </p>
        <p>
          An author&apos;s data related to the agreement is kept while the agreement is in force and for 3 years after
          it ends, and payment and receipt records also for the periods set by law. If the agreement ends before
          payment, the texts and recordings are deleted within the period stated in the offer agreement. When these
          periods end, the data is deleted or anonymised.
        </p>
      </>,
    },
    {
      id: "security",
      title: "How we protect data",
      body: <p>
        Connections to boks are encrypted (HTTPS). Access to the database is restricted: each user gets only their own
        data and what is published, and service data is open only to the team members who need it for their work.
        Signing in uses a link or a one-time code from an email. We also apply the other legal, organisational and
        technical measures required by article 19 of Federal Law No. 152-FZ.
      </p>,
    },
    {
      id: "delete",
      title: "Your rights: access, correction and deletion",
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
        <p>
          You have the right to learn how your data is processed, to require it to be corrected, blocked or destroyed
          if it is incomplete, out of date, inaccurate or processed unlawfully, and to withdraw a consent where
          processing rests on one (articles 9, 14 and 21 of Federal Law No. 152-FZ). Withdrawing a consent does not
          affect processing the law allows without it, such as performing an agreement. We reply within 10 working days
          of receiving a request; this may be extended by no more than 5 working days, and we will tell you why. If you
          believe we are infringing your rights, you can complain to Roskomnadzor or go to court.
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
      id: "changes",
      title: "Changes to this policy",
      body: <p>
        A new edition is published on this page with the date it takes effect. We tell users about significant changes
        in the service or by email. Earlier editions are available on request.
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
