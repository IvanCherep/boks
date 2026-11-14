"use client";

import { useEffect, useState } from "react";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import { loadPoemManifest } from "@/components/boks/poetry/poems";
import { useMessages } from "@/components/boks/ui-language";
import { linkOnlyFilePath } from "@/lib/boks/link-only";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages(
  {
    loading: "Loading…",
    missing: "There is nothing at this link.",
    failed: "The piece did not load. Try again in a minute.",
    toBoks: "Open boks",
  },
  {
    ru: {
      loading: "Загрузка…",
      missing: "По этой ссылке ничего нет.",
      failed: "Не удалось загрузить. Попробуйте через минуту.",
      toBoks: "Открыть boks",
    },
  }
);

type Phase = { kind: "loading" } | { kind: "missing" } | { kind: "failed" } | { kind: "ready"; manifest: PoemManifest };

/**
 * A link-only poem (`docs/link-only-pieces.md`): the product's own immersive
 * player over files read through `/l/<token>/f/`. No bok stands behind it, so
 * there is no like, comment, share or next, and nothing is recorded as
 * reading - the comparison of algorithms never sees it.
 */
export function LinkOnlyPoem({
  token,
  onClose,
  curtain = false,
}: {
  token: string;
  /** Where Back goes. The link itself has nowhere to return to, so: the feed. */
  onClose?: () => void;
  /** Open behind the series curtain, playing at once (an author's page preview). */
  curtain?: boolean;
}) {
  const words = useMessages(messages);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadPoemManifest(linkOnlyFilePath(token, "manifest.json")).then(
      (manifest) => { if (!cancelled) setPhase({ kind: "ready", manifest }); },
      (error: unknown) => {
        if (cancelled) return;
        setPhase({ kind: error instanceof Error && / 404$/.test(error.message) ? "missing" : "failed" });
      }
    );
    return () => { cancelled = true; };
  }, [token]);

  if (phase.kind === "ready") {
    return (
      <ImmersivePoem
        manifest={phase.manifest}
        coverArtwork={linkOnlyFilePath(token, "cover.webp")}
        autoPlay={curtain}
        curtain={curtain}
        onClose={onClose ?? (() => window.location.assign("/"))}
      />
    );
  }

  return (
    <main className="reader-v44 reader-system-page">
      <article className="reader-system-page__body">
        <a href="/" className="brand-word brand-button">boks</a>
        <p className="mt-8 text-sm text-[var(--muted-foreground)]">
          {phase.kind === "loading" ? words.loading : phase.kind === "missing" ? words.missing : words.failed}
        </p>
        {phase.kind !== "loading" && (
          <p className="mt-4 text-sm"><a href="/">{words.toBoks}</a></p>
        )}
      </article>
    </main>
  );
}
