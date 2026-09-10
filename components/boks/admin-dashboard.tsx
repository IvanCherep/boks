"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { numberValue, pct, secondsLabel, storySignal } from "@/components/boks/client-format";
import { AdminPanel, Breakdown, MetricTile, Target } from "@/components/boks/shared-ui";
import { useBoksData } from "@/components/boks/use-boks-data";

export function AdminDashboard() {
  const { metrics, status, setStatus, load } = useBoksData();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("signal");
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const funnel = metrics.funnel ?? {};
  const pagination = metrics.pagination ?? {
    limit: pageSize,
    offset: page * pageSize,
    total: metrics.stories.length,
    hasMore: false,
    sort,
    query,
  };
  const impressions = numberValue(funnel.impressions);
  const starts = numberValue(funnel.starts);
  const completes = numberValue(funnel.completes);
  const pageStart = pagination.total ? pagination.offset + 1 : 0;
  const pageEnd = Math.min(pagination.offset + pagination.limit, pagination.total);
  const algorithmRows = metrics.algorithmMetrics ?? [];
  const algorithmNameById = new Map((metrics.algorithms ?? []).map((algorithm) => [algorithm.id, algorithm.name]));

  useEffect(() => {
    const handle = window.setTimeout(() => {
      load({
        view: "admin",
        limit: pageSize,
        offset: page * pageSize,
        q: query,
        sort,
      }).catch((error) => setStatus(error.message));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [load, page, query, setStatus, sort]);

  function downloadMetrics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      funnel,
      stories: metrics.stories,
      pagination,
      genres: metrics.genres,
      moods: metrics.moods,
      algorithms: metrics.algorithms,
      algorithmMetrics: metrics.algorithmMetrics,
      recentEvents: metrics.recentEvents,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "boks-metrics.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/" className="brand-word">boks</Link>
            <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">Business console</h1>
            <p className="mt-3 max-w-3xl text-[var(--muted-foreground)]">
              Funnel health, story-level signal, content inventory, and cohort taste.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                load({
                  view: "admin",
                  limit: pageSize,
                  offset: page * pageSize,
                  q: query,
                  sort,
                }).catch((error) => setStatus(error.message))
              }
            >
              <RefreshCw className="size-4" /> Refresh
            </Button>
            <Button onClick={downloadMetrics}>
              <Download className="size-4" /> Export
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <MetricTile label="Stories" value={numberValue(funnel.totalStories)} />
          <MetricTile label="Visitors" value={numberValue(funnel.visitors)} />
          <MetricTile label="Impressions" value={impressions} />
          <MetricTile label="Starts" value={starts} />
          <MetricTile label="Completes" value={completes} />
          <MetricTile label="Likes" value={numberValue(funnel.likes)} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr_1fr]">
          <AdminPanel title="Funnel">
            <Target label="Start rate" value={pct(starts, impressions)} target="40%" />
            <Target label="Finish after start" value={pct(completes, starts)} target="55%" />
            <Target label="Reaction per finish" value={pct(numberValue(funnel.likes) + numberValue(funnel.shares), completes)} target="20%" />
          </AdminPanel>
          <AdminPanel title="Genre signal">
            <Breakdown rows={metrics.genres ?? []} labelKey="genre" />
          </AdminPanel>
          <AdminPanel title="Mood signal">
            <Breakdown rows={metrics.moods ?? []} labelKey="mood" />
          </AdminPanel>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--border)] p-4">
            <h2 className="text-xl font-semibold tracking-normal">Recommendation lab</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Automatic cohorts compared by behavior, timing, and story quality signal.
            </p>
          </div>
          <div className="experiment-table">
            <div className="experiment-row experiment-head">
              <span>Algorithm</span>
              <span>Segment</span>
              <span>Visitors</span>
              <span>Start</span>
              <span>Finish</span>
              <span>Reaction</span>
              <span>Skip</span>
              <span>Read</span>
              <span>Pace</span>
              <span>Like time</span>
              <span>Score</span>
            </div>
            {algorithmRows.length ? (
              algorithmRows.map((row) => {
                const id = String(row.algorithmId);
                return (
                  <div key={`${id}-${String(row.userSegment)}`} className="experiment-row">
                    <span>
                      <strong>{algorithmNameById.get(id) ?? id}</strong>
                      <small>{id}</small>
                    </span>
                    <span>{String(row.userSegment)}</span>
                    <span>{numberValue(row.visitors)}</span>
                    <span>{numberValue(row.startRate)}%</span>
                    <span>{numberValue(row.finishRate)}%</span>
                    <span>{numberValue(row.reactionRate)}%</span>
                    <span>{numberValue(row.skipRate)}%</span>
                    <span>{secondsLabel(row.avgReadSeconds)}</span>
                    <span>{numberValue(row.paceIndex).toFixed(2)}x</span>
                    <span>{secondsLabel(row.avgSecondsToLike)}</span>
                    <span>{numberValue(row.engagementScore)}</span>
                  </div>
                );
              })
            ) : (
              <div className="p-4 text-sm text-[var(--muted-foreground)]">
                No algorithm-attributed events yet. Ask testers to read from the updated feed.
              </div>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
            <div>
              <h2 className="text-xl font-semibold tracking-normal">Content operations</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                {pageStart}-{pageEnd} of {pagination.total} · {status}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  className="w-[220px] pl-9"
                  placeholder="Search stories"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <select
                className="field-control w-[180px]"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(0);
                }}
              >
                <option value="signal">Signal</option>
                <option value="finish">Finish rate</option>
                <option value="starts">Starts</option>
                <option value="comments">Comments</option>
                <option value="newest">Newest</option>
                <option value="title">Title</option>
              </select>
            </div>
          </div>
          <div className="admin-table">
            <div className="admin-row admin-head">
              <span>Story</span>
              <span>Start</span>
              <span>Finish</span>
              <span>Love</span>
              <span>Comments</span>
              <span>Signal</span>
            </div>
            {metrics.stories.map((story) => {
              const storyStarts = numberValue(story.starts);
              const storyCompletes = numberValue(story.completes);
              const comments = numberValue(story.commentsCount ?? story.comments);
              return (
                <div key={String(story.id)} className="admin-row">
                  <span>
                    <strong>{String(story.title)}</strong>
                    <small>{String(story.genre)} · {String(story.mood)} · {String(story.minutes)} min</small>
                  </span>
                  <span>{storyStarts}</span>
                  <span>{pct(storyCompletes, storyStarts)}%</span>
                  <span>{numberValue(story.likes)}</span>
                  <span>{comments}</span>
                  <span>{storySignal(story)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-4">
            <p className="text-sm text-[var(--muted-foreground)]">
              Showing {metrics.stories.length} stories per request. Search and sort are handled by the server.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                Previous
              </Button>
              <Button variant="outline" disabled={!pagination.hasMore} onClick={() => setPage((value) => value + 1)}>
                Next
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
