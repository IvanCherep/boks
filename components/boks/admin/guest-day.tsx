"use client";

import { useEffect, useState } from "react";
import type { GuestDay } from "@/components/boks/client-types";
import { loadGuestDay } from "@/components/boks/supabase-browser-data";
import {
  bokSummary,
  countryShort,
  deviceOutcome,
  outcomeLabels,
  visitSummary,
  type DeviceOutcome,
} from "@/components/boks/admin/guest-day-format";

const outcomes: DeviceOutcome[] = ["nothing", "looked", "touched", "finished"];

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One day of the Guests tab opened up: every device seen that day, in the
 * order it arrived, with where it came from and each bok it was shown - how
 * long, whether a hand touched it, how it ended. The day table says "17
 * devices, nobody finished"; this says which 17, and what they did instead.
 */
export function GuestDayPanel({
  day,
  includeTeam,
  hiddenCountries,
}: {
  day: string;
  includeTeam: boolean;
  hiddenCountries: string[];
}) {
  const [data, setData] = useState<GuestDay | null>(null);
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    let live = true;
    const handle = window.setTimeout(() => {
      setStatus("Loading…");
      loadGuestDay(day, { includeTeam, hideCountries: hiddenCountries })
        .then((result) => {
          if (!live) return;
          setData(result);
          setStatus("");
        })
        .catch((error: unknown) => {
          if (live) setStatus(error instanceof Error ? error.message : "Could not load the day.");
        });
    }, 0);
    return () => {
      live = false;
      window.clearTimeout(handle);
    };
  }, [day, includeTeam, hiddenCountries]);

  if (status || !data) return <p className="p-4 text-sm text-[var(--muted-foreground)]">{status}</p>;

  const tally = Object.fromEntries(outcomes.map((key) => [key, 0])) as Record<DeviceOutcome, number>;
  for (const device of data.devices) tally[deviceOutcome(device)] += 1;

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--border)] p-4">
      <div>
        <h4 className="text-sm font-semibold">{data.day}, device by device</h4>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {data.devices.length} devices.{" "}
          {outcomes.map((key) => `${outcomeLabels[key]}: ${tally[key]}`).join(" · ")}. Times are your local time.
        </p>
      </div>
      {data.devices.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">Nobody that day.</p>}
      <ul className="grid gap-2">
        {data.devices.map((device) => (
          <li key={`${device.device}-${device.firstAt}`} className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tabular-nums">
                {time(device.firstAt)}
                {device.lastAt !== device.firstAt ? `-${time(device.lastAt)}` : ""}
              </span>
              <span>{countryShort(device.country)}</span>
              <span className="text-[var(--muted-foreground)]">
                #{device.device} · {device.returning ? "returning" : "new"}
                {device.account ? (device.guest ? " · guest, then signed in" : " · signed in") : " · guest"}
              </span>
              <strong className="ml-auto">{outcomeLabels[deviceOutcome(device)]}</strong>
            </div>
            {device.visits.map((visit) => (
              <p key={visit.at} className="mt-1 text-[var(--muted-foreground)]">
                Arrived {time(visit.at)}: {visitSummary(visit)}
              </p>
            ))}
            {device.visits.length === 0 && (
              <p className="mt-1 text-[var(--muted-foreground)]">No visit recorded that day - an earlier session still open.</p>
            )}
            {device.boks.length > 0 && (
              <ol className="mt-2 grid gap-1">
                {device.boks.map((bok) => (
                  <li key={`${bok.at}-${bok.title}`} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums text-[var(--muted-foreground)]">{time(bok.at)}</span>
                    <span>{bok.title}</span>
                    <span className="text-[var(--muted-foreground)]">{bokSummary(bok)}</span>
                  </li>
                ))}
              </ol>
            )}
            {(device.prompts.length > 0 || device.requested) && (
              <p className="mt-1">
                Sign-up: shown for {device.prompts.join(", ") || "-"}
                {device.requested ? ", asked for a link" : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
