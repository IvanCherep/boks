// The handoff's node:test cases (2026-11-24), run by vitest.
import { test, assert } from "vitest";
import { createAuthorSearchController, type AuthorSearchAdapter, type AuthorSearchResult, type AuthorSearchSnapshot } from "./author-search-controller";

type Call = { query: string; options: Parameters<AuthorSearchAdapter>[1]; promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void };

const row = (name: string): AuthorSearchResult => ({ displayName: name, avatarUrl: null, target: { kind: "byline", accountHandle: "catalogue", byline: name } });
const defer = () => { let resolve!: (value: unknown) => void, reject!: (error: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

function harness() {
  const states: AuthorSearchSnapshot[] = [], calls: Call[] = [], timers = new Map<number, { callback: () => void; at: number }>();
  let clock = 0, next = 1;
  const setTimer = (callback: () => void, delay: number) => { const id = next++; timers.set(id, { callback, at: clock + delay }); return id; };
  const clearTimer = (id: number) => { timers.delete(id); };
  const advance = (ms: number) => {
    const end = clock + ms;
    while (true) {
      const ready = [...timers.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!ready) break;
      const [id, task] = ready;
      clock = task.at; timers.delete(id); task.callback();
    }
    clock = end;
  };
  const controller = createAuthorSearchController({
    search(query, options) { const pending = defer(); calls.push({ query, options, ...pending }); return pending.promise as ReturnType<AuthorSearchAdapter>; },
    onState: state => { states.push(state); },
    setTimer: setTimer as never, clearTimer: clearTimer as never,
  });
  return { controller, states, calls, timers, advance, latest: () => states.at(-1) };
}

test("typing debounces to one bounded request and removes old clickable rows", async () => {
  const h = harness();
  h.controller.setQuery("Пу"); h.advance(100); h.controller.setQuery("Пушкин"); h.advance(249);
  assert.strictEqual(h.calls.length, 0);
  h.advance(1); assert.strictEqual(h.calls.length, 1);
  assert.strictEqual(h.calls[0].query, "Пушкин"); assert.strictEqual(h.calls[0].options.limit, 20);
  h.calls[0].resolve({ results: [row("Пушкин")], hasMore: false }); await flush();
  assert.strictEqual(h.latest()!.results.length, 1);
  h.controller.setQuery("Чехов");
  assert.strictEqual(h.latest()!.phase, "loading"); assert.deepStrictEqual(h.latest()!.results, []);
  h.controller.dispose(); assert.strictEqual(h.timers.size, 0);
});

test("replaced requests cannot publish late results even when abort is ignored", async () => {
  const h = harness(); h.controller.setQuery("Пушкин", { immediate: true });
  h.controller.setQuery("Чехов", { immediate: true });
  assert.strictEqual(h.calls[0].options.signal.aborted, true);
  h.calls[1].resolve({ results: [row("Чехов")], hasMore: false }); await flush();
  h.calls[0].resolve({ results: [row("Пушкин")], hasMore: false }); await flush();
  assert.strictEqual(h.latest()!.results[0].displayName, "Чехов"); h.controller.dispose();
});

test("clear cancels a typed query and obtains only the bounded initial page", async () => {
  const h = harness(); h.controller.setQuery("Толстой");
  h.controller.setQuery("", { immediate: true }); h.advance(250);
  assert.strictEqual(h.calls.length, 1); assert.strictEqual(h.calls[0].query, "");
  h.calls[0].resolve({ results: [row("Пушкин")], hasMore: true }); await flush();
  assert.strictEqual(h.latest()!.hasMore, true); h.controller.dispose();
});

test("the client caps response rows and reports a truncated page truthfully", async () => {
  const h = harness(); h.controller.setQuery("", { immediate: true });
  h.calls[0].resolve({ results: Array.from({ length: 45 }, (_, i) => row(String(i))), hasMore: false }); await flush();
  assert.strictEqual(h.latest()!.results.length, 20); assert.strictEqual(h.latest()!.hasMore, true); h.controller.dispose();
});

test("duplicate targets are not rendered twice, and one publisher can retain distinct bylines", async () => {
  const h = harness(); h.controller.setQuery("", { immediate: true });
  h.calls[0].resolve({ results: [row("Пушкин"), row("Пушкин"), row("Чехов")], hasMore: false }); await flush();
  assert.deepStrictEqual(h.latest()!.results.map(item => item.displayName), ["Пушкин", "Чехов"]); h.controller.dispose();
});

test("query length is capped before transport and whitespace is trimmed", () => {
  const h = harness(); h.controller.setQuery(" " + "a".repeat(150), { immediate: true });
  assert.strictEqual(h.calls[0].query.length, 99); h.controller.dispose();
});

test("failures can retry the current query without replaying an obsolete query", async () => {
  const h = harness(); h.controller.setQuery("Чехов", { immediate: true });
  h.calls[0].reject(new Error("offline")); await flush(); assert.strictEqual(h.latest()!.phase, "error");
  h.controller.retry(); assert.strictEqual(h.calls[1].query, "Чехов");
  h.calls[1].resolve({ results: [row("Чехов")], hasMore: false }); await flush();
  assert.strictEqual(h.latest()!.phase, "ready"); assert.strictEqual(h.timers.size, 0); h.controller.dispose();
});

test("a stalled adapter is aborted at eight seconds and cannot later replace the timeout state", async () => {
  const h = harness(); h.controller.setQuery("Чехов", { immediate: true });
  h.advance(7999); assert.strictEqual(h.latest()!.phase, "loading");
  h.advance(1); assert.strictEqual(h.latest()!.phase, "error"); assert.strictEqual(h.calls[0].options.signal.aborted, true);
  h.calls[0].resolve({ results: [row("Чехов")], hasMore: false }); await flush();
  assert.strictEqual(h.latest()!.phase, "error"); h.controller.retry();
  h.calls[1].resolve({ results: [], hasMore: false }); await flush(); assert.strictEqual(h.latest()!.phase, "ready"); h.controller.dispose();
});

test("dispose cancels timers and transport and suppresses all later state updates", async () => {
  const h = harness(); h.controller.setQuery("Чехов", { immediate: true });
  h.controller.dispose(); const count = h.states.length;
  assert.strictEqual(h.calls[0].options.signal.aborted, true); assert.strictEqual(h.timers.size, 0);
  h.calls[0].resolve({ results: [row("Чехов")], hasMore: false }); await flush();
  h.controller.setQuery("Пушкин", { immediate: true }); h.controller.retry(); h.advance(10000);
  assert.strictEqual(h.states.length, count); assert.strictEqual(h.calls.length, 1);
});
