"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GuestFunnel } from "@/components/boks/client-types";
import { loadGuestFunnel, markTeamDevice, unmarkTeamDevice } from "@/components/boks/supabase-browser-data";
import { countryLabel } from "@/components/boks/admin/country-label";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { biggestDrop, funnelSteps, percent } from "@/components/boks/admin/guest-funnel-steps";
import { dayCountries, duration } from "@/components/boks/admin/guest-day-format";
import { GuestDayPanel } from "@/components/boks/admin/guest-day";

const windows = [7, 14, 30] as const;

/**
 * Remembered per admin browser: a filter you set yesterday should still be set.
 * The Links tab reads the same filter, so one country is hidden everywhere.
 */
const hiddenCountriesKey = "boks-guests-hidden-countries";

export function readHiddenCountries(): string[] {
  try {
    const raw = window.localStorage.getItem(hiddenCountriesKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === "string") : [];
  } catch {
    return [];
  }
}

function saveHiddenCountries(codes: string[]) {
  try {
    window.localStorage.setItem(hiddenCountriesKey, JSON.stringify(codes));
  } catch {
    // A filter that does not persist is still a filter.
  }
}

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
  series: "The series shelf",
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
  const [includeTeam, setIncludeTeam] = useState(false);
  const [hiddenCountries, setHiddenCountries] = useState<string[]>([]);
  const [filtersRead, setFiltersRead] = useState(false);
  const [data, setData] = useState<GuestFunnel | null>(null);
  const [status, setStatus] = useState("Loading…");
  const [busy, setBusy] = useState(false);
  const [teamNote, setTeamNote] = useState("");
  const [openDay, setOpenDay] = useState<string | null>(null);

  const refresh = useCallback(async (window: number, team: boolean, hidden: string[]) => {
    setBusy(true);
    try {
      setData(await loadGuestFunnel(window, { includeTeam: team, hideCountries: hidden }));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the guest funnel.");
    } finally {
      setBusy(false);
    }
  }, []);

  // The stored filter is read once, before the first load, so the first
  // numbers on screen are already the filtered ones.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setHiddenCountries(readHiddenCountries());
      setFiltersRead(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  // Off the render path, like the other admin tables.
  useEffect(() => {
    if (!filtersRead) return;
    const handle = window.setTimeout(() => refresh(days, includeTeam, hiddenCountries).catch(() => undefined), 0);
    return () => window.clearTimeout(handle);
  }, [days, includeTeam, hiddenCountries, filtersRead, refresh]);

  function toggleCountry(code: string) {
    if (code === "unknown") return;
    setHiddenCountries((current) => {
      const next = current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code];
      saveHiddenCountries(next);
      return next;
    });
  }

  async function markThisBrowser(mark: boolean) {
    const visitorId = getBrowserId("boks-reader");
    try {
      if (mark) await markTeamDevice(visitorId, "marked from the Guests tab");
      else await unmarkTeamDevice(visitorId);
      setTeamNote(mark ? "This browser is now counted as the team's." : "This browser is counted as a visitor again.");
      await refresh(days, includeTeam, hiddenCountries);
    } catch (error) {
      setTeamNote(error instanceof Error ? error.message : "Could not update this browser.");
    }
  }

  const steps = data ? funnelSteps(data.funnel) : [];
  const drop = biggestDrop(steps);

  return (
    <section className="studio-guests">
      <div className="studio-filter-line">
        <select className="field-control" aria-label="Guest measurement period" value={days} onChange={(event) => setDays(Number(event.target.value) as typeof days)}>
          {windows.map(window => <option key={window} value={window}>Last {window} days</option>)}
        </select>
        <label className="studio-team-filter"><input type="checkbox" checked={includeTeam} onChange={(event) => setIncludeTeam(event.target.checked)} /> Include team</label>
      </div>
      <Button variant="ghost" onClick={() => void refresh(days, includeTeam, hiddenCountries)} disabled={busy}><RefreshCw className="size-4" /> Refresh</Button>
      {status && <p className="p-6 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}

      {data && (
        <div className="grid gap-6">
          <div className="studio-funnel" aria-label="Guest devices from arrival to account">
            {steps.map((step) => <div key={step.key}>
              <i aria-hidden="true" style={{ width: `${Math.min(100, (step.ofAll ?? 0) * 100)}%` }} />
              <span>{step.label}</span><strong>{step.count}</strong>
            </div>)}
          </div>
          {drop && (
            <p className="studio-hint">
              <strong>Where guests are lost most:</strong> between &ldquo;{drop.from.label.toLowerCase()}&rdquo; and
              &ldquo;{drop.to.label.toLowerCase()}&rdquo; - {percent(drop.to.ofPrevious)} make it ({drop.to.count} of{" "}
              {drop.from.count}).
            </p>
          )}

          <div>
            <h3 className="text-sm font-semibold">Where they are</h3>
            <p className="studio-meta">By device’s last location. Select a country to exclude it from all measurements.</p>
            <div className="studio-countries">
              {data.countries.map((row) => {
                const total = data.countries.reduce((sum, entry) => sum + entry.devices, 0);
                return <div className="studio-country-row" key={row.country}>
                  {row.country === "unknown" ? <strong>Unknown</strong> : <button type="button" onClick={() => toggleCountry(row.country)} title="Hide this country from every measurement">{countryLabel(row.country)}</button>}
                  <strong>{row.devices} devices</strong>
                  <p>{row.country === "unknown" ? "Country unavailable · " : ""}{percent(total ? row.devices / total : null)} of devices · {row.guests} guests · {row.readers} read a bok · {row.accounts} with an account</p>
                </div>;
              })}
            </div>
            {hiddenCountries.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[var(--muted-foreground)]">Hidden:</span>
                {hiddenCountries.map((code) => (
                  <button key={code} type="button" className="admin-chip" onClick={() => toggleCountry(code)}>
                    {countryLabel(code)} ✕
                  </button>
                ))}
              </p>
            )}
          </div>

          <details className="studio-details"><summary>Team devices & measurement filters <span aria-hidden="true">+</span></summary><div className="studio-details-body">
            <p>
              <strong>Telling the team from visitors.</strong> A device ever used by an admin account is the
              team&apos;s and is left out automatically ({data.team.devices} so far, {data.team.marked} marked by hand).
              A browser the team reads in without signing in as an admin cannot be recognised that way - mark it here
              from that browser, or hide its country above.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void markThisBrowser(true)}>
                Mark this browser as the team&apos;s
              </Button>
              <Button variant="ghost" onClick={() => void markThisBrowser(false)}>
                Unmark it
              </Button>
            </div>
            {teamNote && <p className="mt-2 text-[var(--muted-foreground)]">{teamNote}</p>}
          </div></details>

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

          {data.hands && <GuestHands hands={data.hands} />}

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
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Guest devices each day: shown a bok, touched one (tap, scroll, swipe), moved on to another, finished
              one. Click a day to see every device, where it came from and what it did.
            </p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-1 font-medium">Day (UTC)</th>
                    <th className="py-1 text-right font-medium">Guest devices</th>
                    <th
                      className="py-1 text-right font-medium"
                      title="First seen that day - including devices that arrived and left before any bok loaded, so it can be more than the guest devices that read"
                    >
                      New
                    </th>
                    <th className="py-1 text-right font-medium">Shown a bok</th>
                    <th className="py-1 text-right font-medium">Touched</th>
                    <th className="py-1 text-right font-medium">Moved on</th>
                    <th className="py-1 text-right font-medium">Finished a bok</th>
                    <th className="py-1 text-right font-medium">Median time</th>
                    <th className="py-1 pl-4 font-medium">Where</th>
                    <th className="py-1 text-right font-medium">Saw sign-up</th>
                    <th className="py-1 text-right font-medium">Asked for a link</th>
                    <th className="py-1 text-right font-medium">New accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((row) => (
                    <tr
                      key={row.day}
                      className={`border-t border-[var(--border)]${openDay === row.day ? " bg-[var(--muted)]" : ""}`}
                    >
                      <td className="py-2">
                        <button
                          type="button"
                          className="author-account-link"
                          aria-expanded={openDay === row.day}
                          onClick={() => setOpenDay(openDay === row.day ? null : row.day)}
                        >
                          {row.day}
                        </button>
                      </td>
                      <td className="py-2 text-right tabular-nums">{row.guests}</td>
                      <td className="py-2 text-right tabular-nums">{row.newGuests}</td>
                      <td className="py-2 text-right tabular-nums">{row.shown ?? "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.touched ?? "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.swiped ?? "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.readers}</td>
                      <td className="py-2 text-right tabular-nums">{row.medianSeconds == null ? "-" : duration(row.medianSeconds)}</td>
                      <td className="py-2 pl-4">{row.countries?.length ? dayCountries(row.countries) : "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.prompts}</td>
                      <td className="py-2 text-right tabular-nums">{row.requests}</td>
                      <td className="py-2 text-right tabular-nums">{row.newAccounts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {openDay && (
              <div className="mt-3">
                <GuestDayPanel day={openDay} includeTeam={includeTeam} hiddenCountries={hiddenCountries} />
              </div>
            )}
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              &ldquo;Touched&rdquo; counts taps and scrolls from{" "}
              {data.hands?.since ? new Date(data.hands.since).toLocaleDateString() : "today"}; moving on to another bok
              counts on every day. &ldquo;No country&rdquo; is a device the Worker never saw - in practice the local dev
              server, which writes to the same tables.
            </p>
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

/**
 * Did guests touch a bok at all - the question between "arrived" and
 * "finished" that `start`, a timer, cannot answer. A page nobody taps is a
 * different problem from a page people try and leave.
 */
function GuestHands({ hands }: { hands: NonNullable<GuestFunnel["hands"]> }) {
  const of = (count: number) => percent(hands.shown ? count / hands.shown : null);
  const rows: [string, number][] = [
    ["Shown a bok", hands.shown],
    ["Touched one: tap, scroll or swipe", hands.touched],
    ["Tapped", hands.tapped],
    ["Scrolled the text", hands.scrolled],
    ["Swiped to another bok", hands.swiped],
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold">Did they touch it</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--muted-foreground)]">
            <th className="py-1 font-medium">Guest devices</th>
            <th className="py-1 text-right font-medium">Devices</th>
            <th className="py-1 text-right font-medium">Of those shown a bok</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, count]) => (
            <tr key={label} className="border-t border-[var(--border)]">
              <td className="py-2">{label}</td>
              <td className="py-2 text-right tabular-nums">{count}</td>
              <td className="py-2 text-right tabular-nums">{of(count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {hands.swipes} swipes to another bok in all; {hands.boksTouched} of {hands.boksShown} boks shown were
        touched. Taps and scrolls count the first touch on each bok and are recorded{" "}
        {hands.since ? `from ${new Date(hands.since).toLocaleDateString()}` : "from now on"}; swipes cover the
        whole window.
      </p>
    </div>
  );
}
