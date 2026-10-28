"use client";

import { useEffect, useState } from "react";
import type { GuestDay } from "@/components/boks/client-types";
import { loadGuestDay } from "@/components/boks/supabase-browser-data";
import {
  bokSummary,
  countryShort,
  deviceOutcome,
  outcomeLabel,
  visitSummary,
  type DeviceOutcome,
} from "@/components/boks/admin/guest-day-format";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const outcomes: DeviceOutcome[] = ["nothing", "looked", "touched", "finished"];

const words = defineMessages(
  {
    loading: "Loading…",
    couldNotLoad: "Could not load the day.",
    title: (day: string) => `${day}, device by device`,
    devices: (n: number) => `${n} devices.`,
    localTime: "Times are your local time.",
    nobody: "Nobody that day.",
    returning: "returning",
    new: "new",
    guestThenSignedIn: " · guest, then signed in",
    signedIn: " · signed in",
    guest: " · guest",
    arrived: (time: string) => `Arrived ${time}:`,
    noVisit: "No visit recorded that day - an earlier session still open.",
    signup: (shown: string) => `Sign-up: shown for ${shown}`,
    askedForLink: ", asked for a link",
  },
  {
    ru: {
      loading: "Загрузка…",
      couldNotLoad: "Не удалось загрузить день.",
      title: (day: string) => `${day}, по устройствам`,
      devices: (n: number) => `${n} ${plural("ru", n, { one: "устройство", few: "устройства", many: "устройств", other: "устройства" })}.`,
      localTime: "Время местное.",
      nobody: "В этот день никого.",
      returning: "вернувшееся",
      new: "новое",
      guestThenSignedIn: " · гость, потом вошёл",
      signedIn: " · вошёл",
      guest: " · гость",
      arrived: (time: string) => `Пришёл ${time}:`,
      noVisit: "В этот день визит не записан: ещё открыта более ранняя сессия.",
      signup: (shown: string) => `Регистрация: показана для ${shown}`,
      askedForLink: ", запросил ссылку",
    },
  }
);

function time(iso: string, language: string) {
  return new Date(iso).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
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
  const t = useMessages(words);
  const language = useUiLanguage();
  const [data, setData] = useState<GuestDay | null>(null);
  const [status, setStatus] = useState(() => words[currentUiLanguage()].loading);

  useEffect(() => {
    let live = true;
    const handle = window.setTimeout(() => {
      setStatus(words[currentUiLanguage()].loading);
      loadGuestDay(day, { includeTeam, hideCountries: hiddenCountries })
        .then((result) => {
          if (!live) return;
          setData(result);
          setStatus("");
        })
        .catch((error: unknown) => {
          if (live) setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotLoad);
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
        <h4 className="text-sm font-semibold">{t.title(data.day)}</h4>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t.devices(data.devices.length)}{" "}
          {outcomes.map((key) => `${outcomeLabel(key, language)}: ${tally[key]}`).join(" · ")}. {t.localTime}
        </p>
      </div>
      {data.devices.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">{t.nobody}</p>}
      <ul className="grid gap-2">
        {data.devices.map((device) => (
          <li key={`${device.device}-${device.firstAt}`} className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tabular-nums">
                {time(device.firstAt, language)}
                {device.lastAt !== device.firstAt ? `-${time(device.lastAt, language)}` : ""}
              </span>
              <span>{countryShort(device.country, language)}</span>
              <span className="text-[var(--muted-foreground)]">
                #{device.device} · {device.returning ? t.returning : t.new}
                {device.account ? (device.guest ? t.guestThenSignedIn : t.signedIn) : t.guest}
              </span>
              <strong className="ml-auto">{outcomeLabel(deviceOutcome(device), language)}</strong>
            </div>
            {device.visits.map((visit) => (
              <p key={visit.at} className="mt-1 text-[var(--muted-foreground)]">
                {t.arrived(time(visit.at, language))} {visitSummary(visit, language)}
              </p>
            ))}
            {device.visits.length === 0 && (
              <p className="mt-1 text-[var(--muted-foreground)]">{t.noVisit}</p>
            )}
            {device.boks.length > 0 && (
              <ol className="mt-2 grid gap-1">
                {device.boks.map((bok) => (
                  <li key={`${bok.at}-${bok.title}`} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums text-[var(--muted-foreground)]">{time(bok.at, language)}</span>
                    <span>{bok.title}</span>
                    <span className="text-[var(--muted-foreground)]">{bokSummary(bok, language)}</span>
                  </li>
                ))}
              </ol>
            )}
            {(device.prompts.length > 0 || device.requested) && (
              <p className="mt-1">
                {t.signup(device.prompts.join(", ") || "-")}
                {device.requested ? t.askedForLink : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
