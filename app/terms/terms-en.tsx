import type { LegalDocumentProps } from "@/components/boks/legal/legal-layout";
import { supportEmail, supportMailto } from "@/lib/boks/contact";

export const termsEn: Omit<LegalDocumentProps, "page" | "language"> = {
  title: "Terms of Use",
  // The effective date stays with the version readers accepted; 14 November was an editorial pass.
  effective: "Effective September 22, 2026 · clarified November 14, 2026",
  intro: "boks is a free service for reading short literature. This page sets out the rules for reading, publishing and talking to each other, and how to make a complaint or delete your account.",
  highlights: [
    {
      title: "Start without an account",
      body: "You need one after the guest limit, and to comment, like, follow and publish.",
    },
    {
      title: "Authors keep the rights to their work",
      body: "Publications are reviewed. The license terms are below.",
    },
    {
      title: "A question about a publication?",
      body: "You can report a work from its menu. Rights holders can also write to support.",
    },
  ],
  sections: [
    {
      id: "acceptance",
      title: "Accepting these Terms",
      body: <p>
        These Terms are the rules for using boks during its pilot. By reading, creating an account, commenting,
        liking, sharing, sending feedback or publishing on boks, you agree to them. If you do not agree, please do not
        use the service. The <a href="/privacy">Privacy</a> page explains what boks keeps about you.
      </p>,
    },
    {
      id: "accounts",
      title: "Your account and signing in",
      body: <p>
        You can read without an account. To sign in, boks sends an email with a link and a six-digit code. You must be
        at least 16 years old to create an account. An account gives you your reading history, likes, comments,
        follows of authors, and sending texts for review. You are responsible for keeping access to your email secure
        and for what is done from your account.
      </p>,
    },
    {
      id: "catalogue",
      title: "The catalogue",
      body: <>
        <p>
          boks has works in the public domain and texts published by their authors or with the permission of the
          rights holders. Transcriptions of public-domain works come from Wikisource and its volunteers. English
          translations of fairy tales are those of Andrew Lang (1889), Margaret Hunt (1884) and H. L. Brækstad,
          themselves long out of copyright. boks claims no ownership of these works.
        </p>
        <p>
          The legal status of an original and of a translation can differ from country to country: a work that is free
          in one may still be protected in another. boks selects texts that are in the public domain where it operates.
          If you believe a text here is still protected where you are, or that a transcription is not faithful to its
          source, write to us and we will look at it and, where warranted, remove it.
        </p>
        <p>
          The selection and arrangement of the catalogue, the boks software, design, name and logo belong to boks. You
          may read, quote and share links to anything on boks; you may not copy the catalogue in bulk or present it as
          your own.
        </p>
      </>,
    },
    {
      id: "signals",
      title: "Reader signals",
      body: <p>
        boks records how the service is used: which boks you were shown and opened, reading time, scroll progress,
        likes, comments, shares, skips and settings. These signals run the service, shape your recommendations, let us
        compare ways of recommending, and help us understand the pilot. The <a href="/privacy">Privacy</a> page lists
        what is kept and how to delete it.
      </p>,
    },
    {
      id: "author-content",
      title: "Author content",
      body: <>
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
        <p>
          <strong>Taking a text down.</strong> In &ldquo;Your boks&rdquo; in the author cabinet you can withdraw your
          work from publication. A withdrawn text can be restored or deleted. When an account is deleted, the texts
          published from it are hidden.
        </p>
      </>,
    },
    {
      id: "complaints",
      title: "Complaints",
      body: <p>
        Open the work&apos;s menu and choose &ldquo;Report a concern&rdquo;. If you are the rights holder or act for
        them, you can also write to <a href={supportMailto}>{supportEmail}</a>. Include the link to the publication,
        name the work and describe which rights are affected. We will look into it and, where there are grounds,
        restrict access to the publication. Accounts that repeatedly publish infringing content are closed.
      </p>,
    },
    {
      id: "prohibited",
      title: "What you may not do",
      body: <p>
        Do not publish anything unlawful, infringing, hateful, harassing or deceptive; do not impersonate anyone; do
        not send spam. Do not scrape, download in bulk or copy the service by automated means, and do not try to get
        around its limits or security, or to access what is not yours. boks may review, limit, hide or remove content,
        and suspend or close accounts, when that is needed to protect readers, authors, the service or to comply with
        the law.
      </p>,
    },
    {
      id: "feedback",
      title: "Feedback",
      body: <p>
        We ask for your ideas and read every one. Anything you send through the feedback box or to our address may be
        used freely to improve boks - without any obligation to you, payment, or credit. Please do not send anything
        you consider confidential.
      </p>,
    },
    {
      id: "as-is",
      title: "The service is provided as it is",
      body: <>
        <p>
          boks is an early pilot, and it is free. Features, recommendations, limits and availability will change, and
          the service may be interrupted, contain errors, or lose data. It is provided &ldquo;as is&rdquo;, without
          warranties of any kind, to the fullest extent the law allows.
        </p>
        <p>
          To the fullest extent the law allows, boks is not liable for indirect, incidental or consequential loss, or
          for loss of data, arising from your use of the service or your inability to use it. Nothing in these Terms
          limits liability that the law does not allow to be limited.
        </p>
      </>,
    },
    {
      id: "ending",
      title: "Ending your use",
      body: <p>
        You can stop using boks at any time, and delete your account from Settings. boks may suspend or close an
        account that breaks these Terms, and will say why where it can.
      </p>,
    },
    {
      id: "changes",
      title: "Changes to these Terms",
      body: <p>
        boks may update these Terms as the service changes. The date at the top shows the current version. Significant
        changes will be announced in the app before they apply, and continuing to use boks after that means you accept
        them.
      </p>,
    },
    {
      id: "open-source",
      title: "Open-source software",
      body: <p>
        boks is built on open-source software, which remains under its own licenses. The full list, with each license,
        is at <a href="/licenses/third-party-notices.txt">/licenses/third-party-notices.txt</a>; the typeface, Source
        Serif 4, is under the <a href="/licenses/source-serif-4-OFL.txt">SIL Open Font License</a>.
      </p>,
    },
    {
      id: "contact",
      title: "Contact",
      body: <p>
        For questions about these Terms, a copyright complaint, or a request to remove content, write to{" "}
        <a href={supportMailto}>{supportEmail}</a>.
      </p>,
    },
  ],
};
