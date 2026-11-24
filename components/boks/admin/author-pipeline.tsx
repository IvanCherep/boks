"use client";

import "@/app/author-agreement.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startNewAuthor } from "@/components/boks/admin/author-agreement";
import { loadAuthorPipeline } from "@/components/boks/author-spaces/data";
import { readableBoksError } from "@/lib/boks/errors";
import { matchesFilter, pipelineOrder, pipelineStep, type PipelineFacts, type PipelineFilter, type PipelineStep } from "@/lib/boks/author/pipeline";

/*
 * «Ведение авторов» (`docs/author-agreements.md`, "Keeping track"): every
 * author on one list, from the application to the open page. Each row says
 * the step, whose move it is and what to do next, with one button to the
 * place where it is done. What waits for us comes first; what waited too long
 * is marked «застрял». The team works in Russian, so this panel is Russian only.
 */

type Row = { facts: PipelineFacts; step: PipelineStep };

const filters: { key: PipelineFilter; label: string }[] = [
  { key: "team", label: "Ждут нас" },
  { key: "stuck", label: "Застряли" },
  { key: "author", label: "Ждём автора" },
  { key: "open", label: "Страница открыта" },
  { key: "all", label: "Все" },
];

const moverLabel = { team: "Наш ход", author: "Ждём автора", none: "Всё идёт" } as const;

const daysLabel = (days: number) => (days === 0 ? "сегодня" : `${days} дн.`);

export function AuthorPipeline({ onNavigate }: { onNavigate: (tab: "moderation" | "series-work") => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problem, setProblem] = useState("");
  const [filter, setFilter] = useState<PipelineFilter | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(25);

  const load = useCallback(async () => {
    try {
      const facts = await loadAuthorPipeline();
      const now = new Date();
      setRows(facts.map((item) => ({ facts: item, step: pipelineStep(item, now) })).sort((a, b) => pipelineOrder(a.step, b.step)));
      setProblem("");
    } catch (error) {
      setProblem(readableBoksError(error, "Не удалось загрузить авторов.", "ru"));
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => {
    const result = {} as Record<PipelineFilter, number>;
    for (const item of filters) result[item.key] = rows?.filter((row) => matchesFilter(row.step, item.key)).length ?? 0;
    return result;
  }, [rows]);
  // Until the team picks a filter: what waits for us, or everyone when nothing does.
  const active: PipelineFilter = filter ?? (counts.team > 0 ? "team" : "all");
  const needle = query.trim().toLowerCase().replace(/^@/, "");
  const shown = (rows ?? []).filter(
    (row) =>
      matchesFilter(row.step, active) &&
      (!needle || [row.facts.name, row.facts.handle, row.facts.email].some((value) => value?.toLowerCase().includes(needle))),
  );

  function act(row: Row) {
    const { facts, step } = row;
    if (step.action.kind === "tab") {
      onNavigate(step.action.tab);
      return;
    }
    const plan = facts.offer === "launch" || facts.offer === "page" || facts.offer === "page_no_promotion" ? facts.offer : "page";
    if (facts.kind === "application") {
      startNewAuthor({ name: facts.name ?? "", email: facts.email ?? "", handle: facts.handle, plan, applicationId: facts.applicationId ?? undefined });
    } else {
      startNewAuthor({ spaceId: facts.spaceId, applicationId: facts.applicationId ?? undefined, handle: facts.handle, email: facts.email ?? "" });
    }
  }

  return (
    <section className="apl" aria-label="Ведение авторов">
      <header className="apl-head">
        <div>
          <h2>Ведение авторов</h2>
          <p>Каждый автор от заявки до открытой страницы: на каком шаге, чей ход и что сделать. Сверху то, что ждёт нас.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />Обновить</Button>
      </header>

      <div className="apl-tools">
        <div className="apl-filters" role="group" aria-label="Показать">
          {filters.map((item) => (
            <button key={item.key} type="button" aria-pressed={active === item.key} className={`apl-filter is-${item.key}`} onClick={() => { setFilter(item.key); setLimit(25); }}>
              {item.label} <b>{counts[item.key]}</b>
            </button>
          ))}
        </div>
        <label className="apl-search">
          <Search className="size-4" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя, @ник или почта" aria-label="Найти автора" />
        </label>
      </div>

      {problem && <p className="author-applications__error" role="alert">{problem}</p>}
      {rows && shown.length === 0 && (
        <p className="apl-empty">{active === "team" ? "Сейчас ничего не ждёт нас." : active === "stuck" ? "Никто не застрял." : "Никого не нашли."}</p>
      )}

      <ul className="apl-list">
        {shown.slice(0, limit).map((row) => (
          <li key={row.facts.key} className={`apl-row is-${row.step.mover}${row.step.stuck ? " is-stuck" : ""}`}>
            <div className="apl-who">
              <strong>{row.facts.name || (row.facts.handle ? `@${row.facts.handle}` : "Без имени")}</strong>
              <small>{[row.facts.handle ? `@${row.facts.handle}` : null, row.facts.email].filter(Boolean).join(" · ")}</small>
              <span className="apl-tag">{row.facts.kind === "application" ? "заявка" : row.step.steps.includes("Оплата") ? "платный" : "наш автор"}</span>
            </div>

            <div className="apl-way" aria-label={`Шаг ${row.step.index + 1} из ${row.step.steps.length}: ${row.step.step}`}>
              <ol>
                {row.step.steps.map((name, index) => (
                  <li key={name} className={index < row.step.index ? "is-done" : index === row.step.index ? "is-now" : ""} title={name} />
                ))}
              </ol>
              <small>{row.step.index + 1} из {row.step.steps.length} · {row.step.step}</small>
            </div>

            <div className="apl-next">
              <span className="apl-mover">
                {moverLabel[row.step.mover]}
                {row.step.days !== null && row.step.mover !== "none" ? <em>{row.step.stuck ? `застрял · ${daysLabel(row.step.days)}` : daysLabel(row.step.days)}</em> : null}
              </span>
              <strong>{row.step.title}</strong>
              <small>{row.step.detail}</small>
            </div>

            <div className="apl-act">
              <Button size="sm" variant={row.step.mover === "team" ? "default" : "outline"} onClick={() => act(row)}>
                {row.step.action.label}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {shown.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 25)}>Показать ещё {Math.min(25, shown.length - limit)} из {shown.length - limit}</Button>
      )}
    </section>
  );
}
