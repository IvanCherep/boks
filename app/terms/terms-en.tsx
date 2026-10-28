import { ReaderBackIcon } from "@/components/boks/reader/reader-icons";
import { supportEmail, supportMailto } from "@/lib/boks/contact";

const effectiveDate = "September 22, 2026";

export function TermsEn() {
  return (
    <main className="legal-page legal-v44">
      <article className="legal-document">
        <header className="social-page-header"><a className="social-icon" href="/" aria-label="Back to reading"><ReaderBackIcon /></a><span>Terms</span><span /></header>
        <p className="mt-8 text-sm font-semibold text-[var(--muted-foreground)]">Effective {effectiveDate}</p>
        <h1>Terms of Use</h1>
        <p>
          These Terms are the rules for using boks during its pilot. By reading, creating an account, commenting,
          liking, sharing, sending feedback or publishing on boks, you agree to them. If you do not agree, please do
          not use the service. The <a href="/privacy">Privacy</a> page explains what boks keeps about you.
        </p>

        <h2>Accounts</h2>
        <p>
          You can read without an account. An account, created with a sign-in link sent to your email, keeps your
          reading history and lets you comment, like, follow and publish. You must be at least 16 years old to create
          one. You are responsible for keeping access to your email secure and for what is done from your account.
        </p>

        <h2 id="catalogue">The catalogue</h2>
        <p>
          The texts boks offers to read, apart from what authors publish themselves, are works of literature in the
          public domain: their authors died long enough ago that copyright has expired. Transcriptions come from
          Wikisource and its volunteers. English translations of fairy tales are those of Andrew Lang (1889), Margaret
          Hunt (1884) and H. L. Brækstad, themselves long out of copyright. boks claims no ownership of these works.
        </p>
        <p>
          Copyright lasts different lengths of time in different countries, and a work that is free in one may still
          be protected in another. boks selects texts that are in the public domain where it operates. If you believe
          a text here is still protected where you are, or that a transcription is not faithful to its source, write
          to us and we will look at it and, where warranted, remove it.
        </p>
        <p>
          The selection and arrangement of the catalogue, the boks software, design, name and logo belong to boks.
          You may read, quote and share links to anything on boks; you may not copy the catalogue in bulk or present
          it as your own.
        </p>

        <h2>Reader signals</h2>
        <p>
          boks records how the service is used: which boks you were shown and opened, reading time, scroll progress,
          likes, comments, shares, skips and settings. These signals run the service, shape your recommendations,
          let us compare ways of recommending, and help us understand the pilot. The{" "}
          <a href="/privacy">Privacy</a> page lists what is kept and how to delete it.
        </p>

        <h2>Author content</h2>
        <p>
          Authors keep ownership of everything they publish or submit to boks: texts, excerpts, comments, names and
          handles. By submitting content, you give boks a worldwide, non-exclusive, royalty-free license to host,
          store, copy, format, display, distribute, recommend, promote, excerpt and share it through boks and in
          materials that present or explain the service. The license ends when the content is removed, except for
          copies already made in the normal operation of the service, such as backups.
        </p>
        <p>
          By submitting, you confirm that the content is yours to publish - that you wrote it, or hold the rights to
          it, or that it is in the public domain - and that publishing it does not infringe anyone&apos;s copyright,
          privacy or other rights. You are responsible for what you publish. If a claim is made against boks because
          of content you submitted in breach of these Terms, you agree to cover the costs that result, to the extent
          the law allows. You can ask us to remove your content at any time.
        </p>

        <h2>Copyright complaints</h2>
        <p>
          If you hold the rights to something that appears on boks without your permission, write to{" "}
          <a href={supportMailto}>{supportEmail}</a> with: the link to the bok, the work it infringes, your name and
          how to reach you, and a statement that you are the rights holder or are authorised to act for them. We will
          hide the bok while we look into it, tell the account that published it, and remove it if the complaint
          holds. Accounts that repeatedly publish infringing content are closed.
        </p>

        <h2>What you may not do</h2>
        <p>
          Do not publish anything unlawful, infringing, hateful, harassing or deceptive; do not impersonate anyone;
          do not send spam. Do not scrape, download in bulk or copy the service by automated means, and do not try to
          get around its limits or security, or to access what is not yours. boks may review, limit, hide or remove
          content, and suspend or close accounts, when that is needed to protect readers, authors, the service or to
          comply with the law.
        </p>

        <h2>Feedback</h2>
        <p>
          We ask for your ideas and read every one. Anything you send through the feedback box or to our address may
          be used freely to improve boks - without any obligation to you, payment, or credit. Please do not send
          anything you consider confidential.
        </p>

        <h2>The service is provided as it is</h2>
        <p>
          boks is an early pilot, and it is free. Features, recommendations, limits and availability will change, and
          the service may be interrupted, contain errors, or lose data. It is provided &ldquo;as is&rdquo;, without
          warranties of any kind, to the fullest extent the law allows.
        </p>
        <p>
          To the fullest extent the law allows, boks is not liable for indirect, incidental or consequential loss,
          or for loss of data, arising from your use of the service or your inability to use it. Nothing in these
          Terms limits liability that the law does not allow to be limited.
        </p>

        <h2>Ending your use</h2>
        <p>
          You can stop using boks at any time, and delete your account from Settings. boks may suspend or close an
          account that breaks these Terms, and will say why where it can.
        </p>

        <h2>Changes to these Terms</h2>
        <p>
          boks may update these Terms as the service changes. The date at the top shows the current version.
          Significant changes will be announced in the app before they apply, and continuing to use boks after that
          means you accept them.
        </p>

        <h2>Open-source software</h2>
        <p>
          boks is built on open-source software, which remains under its own licenses. The full list, with each
          license, is at <a href="/licenses/third-party-notices.txt">/licenses/third-party-notices.txt</a>; the
          typeface, Source Serif 4, is under the{" "}
          <a href="/licenses/source-serif-4-OFL.txt">SIL Open Font License</a>.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about these Terms, a copyright complaint, or a request to remove content, write to{" "}
          <a href={supportMailto}>{supportEmail}</a>.
        </p>
      </article>
    </main>
  );
}
