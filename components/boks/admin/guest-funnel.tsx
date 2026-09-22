"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GuestFunnel } from "@/components/boks/client-types";
import { loadGuestFunnel } from "@/components/boks/supabase-browser-data";
import { biggestDrop, funnelSteps, percent } from "@/components/boks/admin/guest-funnel-steps";

const windows = [7, 14, 30] as const;

const reasonLabels: Record<string, string> = {
  limit: "Hit the 15-bok limit",
  like: "Tried to like",
  comment: "Tried to comment",
  follow: "Tried to follow",
  notice: "Guest notice",
  manual: "Tapped the account button",
  signin: "Chose sign in",
  unknown: "Unknown",
};

const landingLabels: Record<string, string> = {
  home: "The home page",
  shared_bok: "A shared bok link",
};

/**
 * The people who do not sign up, and where they stop.
 *
 * Built for one question: "we bring people, why does nobody register?". So the
 * page is a funnel first - from arriving to reading to meeting the sign-up to
 * asking for a link to having an account - with the step that loses the most
 * named in a sentence, and then the pieces that explain it: how much guests
 * read, which wall they met, and where they came from.
 *
 * Counted by **device**, not by person or by anonymous user: a guest's
 * anonymous user is abandoned when they sign up, while the device id carries
 * across, which is the only way a conversion can be seen at all. A person on
 * two devices is two here, and a cleared browser is a new one.
 */
export function GuestFunnelPanel() {
  const [days, setDays] = useState<(typeof windows)[number]>(14);
  const [data, setData] = useState<GuestFunnel | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (window: number) => {
    setBusy(true);
    try {
      setData(await loadGuestFunnel(window));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the guest funnel.");
    } finally {
      setBusy(false);
    }
  }, []);

  // Off the render path, like the other admin tables.
  useEffect(() => {
    const handle = window.setTimeout(() => refresh(days).catch(() => undefined), 0);
    return () => window.clearTimeout(handle);
  }, [days, refresh]);

  const steps = data ? funnelSteps(data.funnel) : [];
  const drop = biggestDrop(steps);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Guests</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Visitors without an account, counted by device, over the last {days} days.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="admin-segmented" aria-label="Window">
            {windows.map((window) => (
              <button key={window} type="button" aria-pressed={days === window} onClick={() => setDays(window)}>
                {window} days
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => void refresh(days)} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {status && <p className="p-6 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}

      {data && (
        <div className="grid gap-6 p-4">
          {drop && (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 text-sm leading-6">
              <strong>Where guests are lost most:</strong> between &ldquo;{drop.from.label.toLowerCase()}&rdquo; and
              &ldquo;{drop.to.label.toLowerCase()}&rdquo; - {percent(drop.to.ofPrevious)} make it ({drop.to.count} of{" "}
              {drop.from.count}).
            </p>
          )}

          <div>
            <h3 className="text-sm font-semibold">From arriving to an account</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted-foreground)]">
                  <th className="py-1 font-medium">Step</th>
                  <th className="py-1 text-right font-medium">Devices</th>
                  <th className="py-1 text-right font-medium">Of the step before</th>
                  <th className="py-1 text-right font-medium">Of all guests</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.key} className="border-t border-[var(--border)]">
                    <td className="py-2">{step.label}</td>
                    <td className="py-2 text-right tabular-nums">{step.count}</td>
                    <td className="py-2 text-right tabular-nums">{percent(step.ofPrevious)}</td>
                    <td className="py-2 text-right tabular-nums">{percent(step.ofAll)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {data.funnel.cameBack} guest devices came back on another day. Median reading time of a guest who
              started: {data.medianGuestMinutes ?? 0} min.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold">How much guests read</h3>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {[
                    ["Nothing finished", data.readsPerGuest.none],
                    ["1-2 boks", data.readsPerGuest.oneOrTwo],
                    ["3-9 boks", data.readsPerGuest.threeToNine],
                    ["10-14 boks", data.readsPerGuest.tenToFourteen],
                    ["15 or more", data.readsPerGuest.fifteenPlus],
                  ].map(([label, count]) => (
                    <tr key={label as string} className="border-t border-[var(--border)]">
                      <td className="py-2">{label}</td>
                      <td className="py-2 text-right tabular-nums">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                The 15-bok limit: {data.limit.hit} hit it, {data.limit.requested} asked for a link,{" "}
                {data.limit.converted} created an account.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold">Which wall they met</h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-1 font-medium">Reason</th>
                    <th className="py-1 text-right font-medium">Shown</th>
                    <th className="py-1 text-right font-medium">Asked for a link</th>
                  </tr>
                </thead>
                <tbody>
                  {data.prompts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-2 text-[var(--muted-foreground)]">
                        No sign-up prompts recorded yet.
                      </td>
                    </tr>
                  )}
                  {data.prompts.map((row) => (
                    <tr key={row.reason} className="border-t border-[var(--border)]">
                      <td className="py-2">{reasonLabels[row.reason] ?? row.reason}</td>
                      <td className="py-2 text-right tabular-nums">{row.prompts}</td>
                      <td className="py-2 text-right tabular-nums">
                        {row.requests}
                        {row.prompts > 0 ? ` (${percent(row.requests / row.prompts)})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              { title: "Landed on", rows: data.sources.landing, labels: landingLabels },
              { title: "Came from", rows: data.sources.referrer, labels: { direct: "Direct / unknown" } as Record<string, string> },
              { title: "Campaign (utm)", rows: data.sources.campaign, labels: {} as Record<string, string> },
            ].map((block) => (
              <div key={block.title}>
                <h3 className="text-sm font-semibold">{block.title}</h3>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {block.rows.length === 0 && (
                      <tr>
                        <td className="py-2 text-[var(--muted-foreground)]">Nothing recorded yet.</td>
                      </tr>
                    )}
                    {block.rows.map((row) => (
                      <tr key={row.value} className="border-t border-[var(--border)]">
                        <td className="py-2 break-all">{block.labels[row.value] ?? row.value}</td>
                        <td className="py-2 text-right tabular-nums">{row.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-sm font-semibold">Day by day</h3>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-1 font-medium">Day (UTC)</th>
                    <th className="py-1 text-right font-medium">Guest devices</th>
                    <th className="py-1 text-right font-medium">New</th>
                    <th className="py-1 text-right font-medium">Finished a bok</th>
                    <th className="py-1 text-right font-medium">Saw sign-up</th>
                    <th className="py-1 text-right font-medium">Asked for a link</th>
                    <th className="py-1 text-right font-medium">New accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((row) => (
                    <tr key={row.day} className="border-t border-[var(--border)]">
                      <td className="py-2">{row.day}</td>
                      <td className="py-2 text-right tabular-nums">{row.guests}</td>
                      <td className="py-2 text-right tabular-nums">{row.newGuests}</td>
                      <td className="py-2 text-right tabular-nums">{row.readers}</td>
                      <td className="py-2 text-right tabular-nums">{row.prompts}</td>
                      <td className="py-2 text-right tabular-nums">{row.requests}</td>
                      <td className="py-2 text-right tabular-nums">{row.newAccounts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            Read with care. A device is not a person: a cleared browser or a second phone counts again, and the
            team&apos;s own testing is in these numbers. Sign-up prompts, link requests and visit sources are
            recorded from {data.journeySince ? new Date(data.journeySince).toLocaleDateString() : "today"}{" "}
            onwards, so those steps undercount earlier days. &ldquo;Finished&rdquo; is only reliable from
            21 September, when finishing a short poem started being recorded correctly.
          </p>
        </div>
      )}
    </section>
  );
}
