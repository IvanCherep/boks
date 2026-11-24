import { describe, expect, it } from "vitest";
import { applicationMover, matchesFilter, pipelineOrder, pipelineStep, type PipelineFacts } from "./pipeline";

const now = new Date("2026-11-24T12:00:00+03:00");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const page = (over: Partial<PipelineFacts> = {}): PipelineFacts => ({
  key: "s1",
  kind: "page",
  spaceId: "s1",
  name: "Вера",
  handle: "vera",
  email: "vera@test",
  billing: "partner",
  pageStatus: "draft",
  pageCreatedAt: ago(1),
  ownerId: null,
  invite: null,
  seeds: 0,
  agreement: null,
  ...over,
});
const owned = (over: Partial<PipelineFacts> = {}) => page({ ownerId: "u1", invite: { createdAt: ago(3), expiresAt: ago(-11), openedAt: ago(2), acceptedAt: ago(2), email: "vera@test", problem: null }, ...over });
const paidAgreement = (payState: string, over = {}) => ({ number: "2026/001", plan: "page", priceRub: 30000, payState, payDue: "2026-12-24", reportedAt: null, paidAt: null, acceptedAt: ago(2), ...over });

describe("pipelineStep", () => {
  it("a new application is ours; an answered one waits for the author", () => {
    const fresh = pipelineStep({ key: "a1", kind: "application", applicationStatus: "new", applicationAt: ago(3), name: "Вера", handle: null, email: null }, now);
    expect(fresh).toMatchObject({ step: "Заявка", mover: "team", title: "Ответить на заявку", stuck: true, action: { kind: "application" } });
    const answered = pipelineStep({ key: "a1", kind: "application", applicationStatus: "contacted", applicationAt: ago(3), applicationUpdatedAt: ago(1), name: "Вера", handle: null, email: null }, now);
    expect(answered).toMatchObject({ mover: "author", title: "Ждём ответ и материалы", stuck: false });
    expect(pipelineStep({ key: "a2", kind: "application", applicationStatus: "new", applicationAt: ago(0), offer: "page", name: "Вера", handle: null, email: null }, now).steps).toContain("Оплата");
    expect(pipelineStep({ key: "a3", kind: "application", applicationStatus: "new", applicationAt: ago(0), offer: "launch", name: "Вера", handle: null, email: null }, now).steps).not.toContain("Оплата");
  });

  it("an application's stage says whose move it is, and the team's line replaces the hint", () => {
    const app = (over: Partial<PipelineFacts>) => pipelineStep({ key: "a1", kind: "application", applicationStatus: "contacted", applicationAt: ago(9), name: "Вера", handle: null, email: null, ...over }, now);
    expect(app({ applicationStage: "written", applicationStageAt: ago(6) })).toMatchObject({ mover: "author", title: "Написали, ждём ответа", stuck: true, days: 6 });
    expect(app({ applicationStage: "written", applicationStageAt: ago(1) })).toMatchObject({ stuck: false });
    expect(app({ applicationStage: "replied", applicationStageAt: ago(2), applicationFocus: "Спросить про права на сборник" }))
      .toMatchObject({ mover: "team", title: "Автор ответил: наш ход", stuck: true, detail: "Спросить про права на сборник" });
    expect(app({ applicationStage: "agreed", applicationStageAt: ago(0) })).toMatchObject({ mover: "team", title: "Договорились: оформить автора", stuck: false });
    expect(app({ applicationStatus: "new", applicationStage: "new" })).toMatchObject({ mover: "team", title: "Ответить на заявку", stuck: true });
    expect(applicationMover("written")).toBe("author");
    expect(applicationMover("silent")).toBe("none");
    expect(applicationMover("replied")).toBe("team");
  });

  it("a page nobody was invited to says the author cannot come in", () => {
    const step = pipelineStep(page({ seeds: 3, pageCreatedAt: ago(4) }), now);
    expect(step).toMatchObject({ step: "Страница", mover: "team", title: "Пригласить автора", stuck: true });
    expect(step.detail).toContain("3 текста");
    expect(step.detail).toContain("не может войти");
  });

  it("an invitation waits for the author, then expires into our move", () => {
    const waiting = pipelineStep(page({ invite: { createdAt: ago(2), expiresAt: ago(-12), openedAt: null, acceptedAt: null, email: "vera@test", problem: null } }), now);
    expect(waiting).toMatchObject({ step: "Приглашение", mover: "author", stuck: false });
    expect(waiting.detail).toContain("ещё не открывал");
    const expired = pipelineStep(page({ invite: { createdAt: ago(20), expiresAt: ago(6), openedAt: ago(19), acceptedAt: null, email: "vera@test", problem: null } }), now);
    expect(expired).toMatchObject({ mover: "team", title: "Приглашение истекло: пригласить снова", stuck: true });
  });

  it("a paid author before payment waits on them; reported is ours; late is ours", () => {
    expect(pipelineStep(owned({ billing: "paid", agreement: paidAgreement("awaiting") }), now)).toMatchObject({ step: "Оплата", mover: "author" });
    expect(pipelineStep(owned({ billing: "paid", agreement: paidAgreement("reported", { reportedAt: ago(3) }) }), now)).toMatchObject({ step: "Оплата", mover: "team", title: "Проверить оплату", stuck: true });
    expect(pipelineStep(owned({ billing: "paid", agreement: paidAgreement("awaiting", { payDue: "2026-11-20" }) }), now)).toMatchObject({ mover: "team", title: "Оплата просрочена: написать автору" });
  });

  it("pieces sent before payment wait for it, not for us", () => {
    const step = pipelineStep(owned({ billing: "paid", agreement: paidAgreement("awaiting"), sent: 2, sentOldestAt: ago(5) }), now);
    expect(step.mover).toBe("author");
    expect(step.detail).toContain("после оплаты");
  });

  it("sent pieces of ours (or paid) are ours to accept, then to make", () => {
    expect(pipelineStep(owned({ sent: 2, sentOldestAt: ago(4) }), now)).toMatchObject({ step: "Series", mover: "team", title: "Принять в работу: 2", stuck: true, action: { kind: "tab", tab: "moderation" } });
    expect(pipelineStep(owned({ billing: "paid", agreement: paidAgreement("paid"), inWork: 3, inWorkOldestAt: ago(1) }), now)).toMatchObject({ mover: "team", title: "Сделать Series: 3", action: { kind: "tab", tab: "series-work" } });
  });

  it("ready Series on a closed page wait for the author to open it", () => {
    expect(pipelineStep(owned({ withAuthor: 3, withAuthorOldestAt: ago(1) }), now)).toMatchObject({ step: "Открытие", mover: "author", title: "Ждём, когда автор откроет страницу" });
  });

  it("an author with drafts and nothing sent is preparing", () => {
    const step = pipelineStep(owned({ drafts: 3, voicedDrafts: 2, lastAuthorAt: ago(12) }), now);
    expect(step).toMatchObject({ step: "Тексты и голос", mover: "author", stuck: true });
    expect(step.detail).toBe("В кабинете 3 текста, записано 2. Ничего ещё не отдано.");
  });

  it("an open page is fine, unless posts are missing for a month", () => {
    expect(pipelineStep(owned({ pageStatus: "published", published: 5 }), now)).toMatchObject({ step: "Публикуется", mover: "none", title: "Всё идёт" });
    expect(pipelineStep(owned({ pageStatus: "published", published: 5, unshared: 2, unsharedOldestAt: ago(40) }), now)).toMatchObject({ mover: "team", title: "Нет ссылок на посты: напомнить" });
  });

  it("an invitation on a paid tariff counts as paid before the author accepts", () => {
    const invite = { createdAt: ago(1), expiresAt: ago(-13), openedAt: null, acceptedAt: null, email: "v@t", problem: null };
    expect(pipelineStep(page({ invite: { ...invite, plan: "page" } }), now).steps).toContain("Оплата");
    expect(pipelineStep(page({ invite: { ...invite, plan: null } }), now).steps).not.toContain("Оплата");
  });

  it("our authors have no payment step", () => {
    expect(pipelineStep(owned(), now).steps).not.toContain("Оплата");
    expect(pipelineStep(owned({ billing: "paid", agreement: paidAgreement("paid") }), now).steps).toContain("Оплата");
  });
});

describe("filters and order", () => {
  it("ours first, stuck first, longest wait first", () => {
    const rows = [
      pipelineStep(owned({ pageStatus: "published", published: 1 }), now),
      pipelineStep(owned({ drafts: 1, lastAuthorAt: ago(2) }), now),
      pipelineStep(page({ pageCreatedAt: ago(1) }), now),
      pipelineStep(page({ pageCreatedAt: ago(9) }), now),
    ].sort(pipelineOrder);
    expect(rows.map((row) => [row.mover, row.days])).toEqual([["team", 9], ["team", 1], ["author", 2], ["none", null]]);
    expect(rows.filter((row) => matchesFilter(row, "stuck"))).toHaveLength(1);
    expect(rows.filter((row) => matchesFilter(row, "open"))).toHaveLength(1);
  });
});
