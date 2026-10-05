"use client";

import { Button } from "@/components/ui/button";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import {
  readingLanguageNames,
  type EmptyFeedNotice,
  type ReadingLanguage,
} from "@/components/boks/reading-languages";

/**
 * What the reader sees when there is no boks to show.
 *
 * A feed emptied by the language filter has to say so. The alternative -
 * quietly adding a language back - would break the only promise this feature
 * makes, and a reader who asked for Russian and found none is also the most
 * useful thing the console can learn about what to acquire. Which notice
 * applies is decided by `emptyFeedNotice`, where it is tested.
 */
export function EmptyFeedScreen({
  notice,
  onAddLanguages,
  onChangeLanguages,
  onRetry,
}: {
  notice: EmptyFeedNotice;
  onAddLanguages: (languages: ReadingLanguage[]) => void;
  onChangeLanguages: () => void;
  onRetry: () => void;
}) {
  return (
    <main className="reader-shell grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="brand-word">boks</p>
        {notice.kind === "language" ? (
          <>
            <h1 className="mt-4 text-2xl font-semibold tracking-normal">{notice.title}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{notice.body}</p>
            {notice.offer.length > 0 && (
              <Button className="mt-4" onClick={() => onAddLanguages(notice.offer)}>
                Add {notice.offer.map((language) => readingLanguageNames[language]).join(" and ")}
              </Button>
            )}
            <Button className="mt-2 w-full" variant="ghost" onClick={onChangeLanguages}>
              Change my languages
            </Button>
          </>
        ) : notice.kind === "unreachable" ? (
          <>
            {/* The reader can act on this one, so it says what to try. The
                page itself arrived, which means our server is up and the
                network is stopping the call the app makes next - on some
                providers that call is blocked while the site is not. */}
            <h1 className="mt-4 text-2xl font-semibold tracking-normal">
              boks cannot reach its server from this network
            </h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              The page loaded, so boks itself is running. What failed is the connection your browser
              makes next, and that is usually the network in between: another Wi-Fi, mobile data, or a
              VPN normally fixes it.
            </p>
            <Button className="mt-4" onClick={onRetry}>
              Try again
            </Button>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
              Still nothing? Write to{" "}
              <a className="auth-link" href={supportMailto}>
                {supportEmail}
              </a>{" "}
              - tell us your provider and we will move the address boks talks to.
            </p>
          </>
        ) : (
          <p className="mt-3 text-[var(--muted-foreground)]">{notice.message}</p>
        )}
      </div>
    </main>
  );
}
