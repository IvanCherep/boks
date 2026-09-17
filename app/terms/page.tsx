
const effectiveDate = "September 11, 2026";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <article className="legal-document">
        <a href="/" className="brand-word brand-button">
          boks
        </a>
        <p className="mt-8 text-sm font-semibold text-[var(--muted-foreground)]">Effective {effectiveDate}</p>
        <h1>Terms of Use</h1>
        <p>
          These Terms describe the basic rules for using boks during the MVP and early testing period. By creating an
          account, reading, commenting, liking, sharing, or publishing content, you agree to these Terms.
        </p>

        <h2>Accounts</h2>
        <p>
          Readers can create an account with an email magic link to continue reading after the guest limit and to keep
          a reading history. You are responsible for keeping access to your email account secure and for activity from
          your boks account.
        </p>

        <h2>Reader Signals</h2>
        <p>
          boks collects product signals such as viewed boks, reading time, scroll progress, likes, comments, shares,
          skips, and account settings. We use these signals to operate the prototype, improve recommendations, compare
          recommendation algorithms, understand product demand, and prepare business analytics.
        </p>

        <h2>Author Content</h2>
        <p>
          Authors keep ownership of stories, excerpts, fragments, comments, names, handles, and other material they
          publish or submit to boks. By submitting content, you give boks a worldwide, non-exclusive, royalty-free
          license to host, store, copy, format, display, distribute, recommend, promote, excerpt, and share that content
          through boks and related marketing or investor materials for the service.
        </p>
        <p>
          This license lets boks show author work to readers, use it in feeds and recommendations, present it in product
          demos, and advertise or explain the boks service. You confirm that you have the rights needed to submit the
          content and that it does not violate another person&apos;s rights.
        </p>

        <h2>Moderation</h2>
        <p>
          boks may review, limit, remove, or refuse content or accounts when needed to protect readers, authors, the
          product, or legal compliance. Content that is unlawful, infringing, abusive, deceptive, or harmful is not
          allowed.
        </p>

        <h2>Prototype Status</h2>
        <p>
          boks is an MVP. Features, recommendation behavior, metrics, limits, and availability may change while the
          product is being tested. The service is provided without guarantees of uninterrupted availability or specific
          business results.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about these Terms, access, or content removal, contact the boks team through the founder or
          administrator running the current pilot.
        </p>

        <p className="legal-note">
          This starter agreement is practical MVP product copy. Before onboarding a large author base, paid users, or
          commercial partners, have counsel adapt it to the company, jurisdiction, and monetization model.
        </p>
      </article>
    </main>
  );
}
