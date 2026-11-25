/**
 * «Ведение авторов» in Studio (`docs/author-agreements.md`, "Keeping track"):
 * for every author, from the application to the open page, the step they are
 * on, whose move it is (ours or theirs), what to do next and since when. Pure,
 * so every case is tested; the facts come from `studio_author_pipeline`.
 */

export type PipelineFacts = {
  key: string;
  kind: "application" | "page";
  applicationId?: number | null;
  applicationStatus?: "new" | "contacted" | "closed";
  applicationAt?: string;
  applicationUpdatedAt?: string;
  /** The conversation's stage (`author_applications.stage`); older rows only have the status. */
  applicationStage?: ApplicationStage;
  applicationStageAt?: string;
  /** «Что уточнить», the line the team keeps current. */
  applicationFocus?: string | null;
  offer?: string;
  spaceId?: string;
  name: string | null;
  handle: string | null;
  email: string | null;
  billing?: "partner" | "paid";
  pageStatus?: string;
  pageCreatedAt?: string;
  pagePublishedAt?: string | null;
  ownerId?: string | null;
  invite?: { createdAt: string; expiresAt: string; openedAt: string | null; acceptedAt: string | null; email: string; problem: string | null; plan?: string | null } | null;
  seeds?: number;
  agreement?: { number: string; plan: string; priceRub: number; payState: string; payDue: string | null; reportedAt: string | null; paidAt: string | null; acceptedAt: string } | null;
  drafts?: number;
  voicedDrafts?: number;
  lastAuthorAt?: string | null;
  sent?: number;
  sentOldestAt?: string | null;
  inWork?: number;
  inWorkOldestAt?: string | null;
  withAuthor?: number;
  withAuthorOldestAt?: string | null;
  returned?: number;
  published?: number;
  unshared?: number;
  unsharedOldestAt?: string | null;
};

/**
 * Where the conversation about an application stands (Studio → Authors →
 * Заявки). Open stages first, in the order a conversation goes; the last two
 * close it.
 */
export const applicationStages = ["new", "written", "replied", "agreed", "declined", "silent"] as const;
export type ApplicationStage = (typeof applicationStages)[number];
export const closedApplicationStages: readonly ApplicationStage[] = ["declined", "silent"];

/** Whose move it is on an application, by its stage. */
export const applicationMover = (stage: ApplicationStage): Mover =>
  stage === "written" ? "author" : closedApplicationStages.includes(stage) ? "none" : "team";

/** The way, as the team sees it. A paid author has the payment among the steps. */
export const pipelineSteps = ["Заявка", "Страница", "Приглашение", "Тексты и голос", "Оплата", "Series", "Открытие", "Публикуется"] as const;
export type StepName = (typeof pipelineSteps)[number];

/** Who moves next: us, the author, or nobody (all is well). */
export type Mover = "team" | "author" | "none";

/** Where the button leads: the page in «Авторы», the application, or another Studio tab. */
export type PipelineAction =
  | { kind: "application"; label: string }
  | { kind: "page"; label: string }
  | { kind: "tab"; tab: "moderation" | "series-work"; label: string };

export type PipelineStep = {
  step: StepName;
  /** 0-based index in `steps` for this author (no «Оплата» for ours). */
  index: number;
  steps: StepName[];
  mover: Mover;
  /** What happens next, in a few words: «Пригласить автора», «Ждём оплату до 24 декабря». */
  title: string;
  /** One line of detail: counts, dates. */
  detail: string;
  since: string | null;
  /** Days since `since`, whole. */
  days: number | null;
  /** Waiting longer than this step should take: the row is marked and goes up. */
  stuck: boolean;
  action: PipelineAction;
};

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY)) : null);

const ruDay = (iso: string | null | undefined) => {
  if (!iso) return "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+03:00`) : new Date(iso);
  return day.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
};

/** How long each wait may last before the row is «застрял». */
export const stuckAfterDays = {
  newApplication: 2,
  /** We wrote and nobody answered: time to write again or close. */
  awaitingReply: 5,
  /** They answered, or we agreed: our move should not wait. */
  ourReply: 2,
  awaitingMaterials: 10,
  pageWithoutInvite: 2,
  inviteOpen: 5,
  checkPayment: 2,
  acceptIntoWork: 3,
  makeSeries: 10,
  authorReview: 5,
  authorTexts: 10,
  unshared: 30,
} as const;

export function pipelineStep(facts: PipelineFacts, now = new Date()): PipelineStep {
  // An application on a paid tariff counts as paid already: its way has the payment.
  const paidPlan = (plan: string | null | undefined) => plan === "page" || plan === "page_no_promotion";
  const paid =
    facts.billing === "paid" ||
    (facts.agreement?.priceRub ?? 0) > 0 ||
    // Before the author accepts: the tariff the invitation carries, or the one they applied for.
    (!facts.ownerId && (facts.invite && !facts.invite.acceptedAt ? paidPlan(facts.invite.plan) : paidPlan(facts.offer)));
  const steps = pipelineSteps.filter((step) => paid || step !== "Оплата") as StepName[];
  const at = (step: StepName) => steps.indexOf(step);
  const make = (step: StepName, mover: Mover, title: string, detail: string, since: string | null | undefined, limit: number | null, action: PipelineAction): PipelineStep => {
    const days = daysSince(since ?? null, now);
    return { step, index: at(step), steps, mover, title, detail, since: since ?? null, days, stuck: limit !== null && days !== null && days >= limit, action };
  };
  const openPage: PipelineAction = { kind: "page", label: "Открыть страницу" };

  if (facts.kind === "application") {
    const apply: PipelineAction = { kind: "application", label: "Оформить автора" };
    const focus = facts.applicationFocus?.trim();
    const stageAt = facts.applicationStageAt ?? facts.applicationUpdatedAt;
    if (facts.applicationStage === "written") {
      return make("Заявка", "author", "Написали, ждём ответа", focus || "Нет ответа дольше пяти дней: напомните или закройте заявку.", stageAt, stuckAfterDays.awaitingReply, apply);
    }
    if (facts.applicationStage === "replied") {
      return make("Заявка", "team", "Автор ответил: наш ход", focus || "Прочитайте ответ и решите, что написать.", stageAt, stuckAfterDays.ourReply, apply);
    }
    if (facts.applicationStage === "agreed") {
      return make("Заявка", "team", "Договорились: оформить автора", focus || "Создайте страницу и пригласите автора.", stageAt, stuckAfterDays.ourReply, apply);
    }
    if (facts.applicationStage === "new") {
      return make("Заявка", "team", "Ответить на заявку", focus || "Отправьте письмо с условиями или сразу оформите автора.", facts.applicationAt, stuckAfterDays.newApplication, apply);
    }
    if (facts.applicationStatus === "contacted") {
      return make("Заявка", "author", "Ждём ответ и материалы", "Мы ответили на заявку. Когда автор пришлёт данные и тексты, оформите его.", facts.applicationUpdatedAt, stuckAfterDays.awaitingMaterials, apply);
    }
    return make("Заявка", "team", "Ответить на заявку", "Отправьте письмо с условиями или сразу оформите автора.", facts.applicationAt, stuckAfterDays.newApplication, apply);
  }

  // A page without its author yet.
  if (!facts.ownerId) {
    const invite = facts.invite;
    const expired = invite && !invite.acceptedAt && new Date(invite.expiresAt).getTime() < now.getTime();
    if (invite && !invite.acceptedAt && invite.problem === "handle_taken") {
      return make("Приглашение", "team", "Адрес занят: поменять и пригласить снова", `Приглашение на ${invite.email} не сработало.`, invite.createdAt, 0, openPage);
    }
    if (invite && !invite.acceptedAt && !expired) {
      return make(
        "Приглашение",
        "author",
        `Ждём, когда примет приглашение`,
        `Отправлено на ${invite.email} ${ruDay(invite.createdAt)}${invite.openedAt ? ", автор его открывал" : ", ещё не открывал"}. Действует до ${ruDay(invite.expiresAt)}.`,
        invite.createdAt,
        stuckAfterDays.inviteOpen,
        openPage,
      );
    }
    if (expired) {
      return make("Приглашение", "team", "Приглашение истекло: пригласить снова", `Было отправлено на ${invite!.email} ${ruDay(invite!.createdAt)}.`, invite!.expiresAt, 0, { kind: "page", label: "Пригласить снова" });
    }
    const seeds = facts.seeds ?? 0;
    return make(
      "Страница",
      "team",
      "Пригласить автора",
      seeds ? `Страница готова, в кабинете ждут ${plural(seeds, "текст", "текста", "текстов")}. Автор не может войти, пока не приглашён.` : "Страница создана. Добавьте тексты, если автор их прислал, и пригласите.",
      facts.pageCreatedAt,
      stuckAfterDays.pageWithoutInvite,
      { kind: "page", label: "Пригласить" },
    );
  }

  const published = facts.pageStatus === "published";
  const pay = facts.agreement?.payState;
  const unpaid = paid && (pay === "awaiting" || pay === "reported");
  const sent = facts.sent ?? 0;
  const inWork = facts.inWork ?? 0;
  const withAuthor = facts.withAuthor ?? 0;
  const seriesStep: StepName = published ? "Публикуется" : "Series";

  // Our moves first: nothing of ours may wait behind the author's.
  if (paid && pay === "reported") {
    return make("Оплата", "team", "Проверить оплату", `Автор сообщил об оплате ${ruDay(facts.agreement?.reportedAt)}. Отметьте в «Договоры авторов», когда деньги придут.`, facts.agreement?.reportedAt, stuckAfterDays.checkPayment, openPage);
  }
  if (sent > 0 && !unpaid) {
    return make(seriesStep, "team", `Принять в работу: ${sent}`, `Автор отдал ${plural(sent, "текст", "текста", "текстов")} с голосом.`, facts.sentOldestAt, stuckAfterDays.acceptIntoWork, { kind: "tab", tab: "moderation", label: "В модерацию" });
  }
  if (inWork > 0) {
    return make(seriesStep, "team", `Сделать Series: ${inWork}`, `${plural(inWork, "текст", "текста", "текстов")} в работе${withAuthor ? `, ещё ${withAuthor} у автора на просмотре` : ""}.`, facts.inWorkOldestAt, stuckAfterDays.makeSeries, { kind: "tab", tab: "series-work", label: "К Series" });
  }
  if (paid && pay === "awaiting") {
    const due = facts.agreement?.payDue ?? null;
    const late = due !== null && new Date(`${due}T23:59:59+03:00`).getTime() < now.getTime();
    return late
      ? make("Оплата", "team", "Оплата просрочена: написать автору", `Срок был ${ruDay(due)}.${sent ? ` Ждут оплаты ${plural(sent, "текст", "текста", "текстов")}.` : ""}`, due, 0, openPage)
      : make("Оплата", "author", `Ждём оплату до ${ruDay(due)}`, sent ? `Автор отдал ${plural(sent, "текст", "текста", "текстов")}: возьмём в работу после оплаты.` : `Пока автор готовит тексты и голос.`, facts.agreement?.acceptedAt, null, openPage);
  }
  if (withAuthor > 0) {
    return published
      ? make("Публикуется", "author", `Автор смотрит Series: ${withAuthor}`, "Готовые Series у автора: он публикует их сам.", facts.withAuthorOldestAt, stuckAfterDays.authorReview, openPage)
      : make("Открытие", "author", `Ждём, когда автор откроет страницу`, `Готово ${plural(withAuthor, "Series", "Series", "Series")}: автор открывает страницу одной кнопкой.`, facts.withAuthorOldestAt, stuckAfterDays.authorReview, openPage);
  }
  if ((facts.returned ?? 0) > 0) {
    return make(seriesStep, "author", `Автор дорабатывает: ${facts.returned}`, "Мы вернули тексты с просьбой поправить.", facts.lastAuthorAt, stuckAfterDays.authorTexts, openPage);
  }
  if (!published) {
    const drafts = facts.drafts ?? 0;
    const voiced = facts.voicedDrafts ?? 0;
    return make(
      "Тексты и голос",
      "author",
      "Автор готовит тексты и голос",
      drafts ? `В кабинете ${plural(drafts, "текст", "текста", "текстов")}, записано ${voiced}. Ничего ещё не отдано.` : "В кабинете пока нет текстов.",
      facts.lastAuthorAt ?? facts.invite?.acceptedAt ?? facts.pageCreatedAt,
      stuckAfterDays.authorTexts,
      openPage,
    );
  }
  // Posts are a contract's condition: an author of ours with no contract owes none.
  if ((facts.unshared ?? 0) > 0 && facts.agreement && facts.agreement.payState !== "cancelled") {
    const days = daysSince(facts.unsharedOldestAt, now) ?? 0;
    if (days >= stuckAfterDays.unshared) {
      return make("Публикуется", "team", "Нет ссылок на посты: напомнить", `${plural(facts.unshared!, "Series", "Series", "Series")} без ссылок на посты в соцсетях, старшей больше 30 дней.`, facts.unsharedOldestAt, 0, openPage);
    }
  }
  return make("Публикуется", "none", "Всё идёт", `Опубликовано ${plural(facts.published ?? 0, "Series", "Series", "Series")}.`, facts.lastAuthorAt ?? facts.pagePublishedAt, null, openPage);
}

/** The filters on top of the list. */
export type PipelineFilter = "team" | "author" | "stuck" | "open" | "all";

export function matchesFilter(step: PipelineStep, filter: PipelineFilter) {
  if (filter === "all") return true;
  if (filter === "stuck") return step.stuck;
  if (filter === "open") return step.step === "Публикуется";
  return step.mover === filter;
}

/** Ours first, the stuck first within, then the longest wait. */
export function pipelineOrder(a: PipelineStep, b: PipelineStep) {
  const rank = (step: PipelineStep) => (step.mover === "team" ? 0 : step.mover === "author" ? 1 : 2) * 2 + (step.stuck ? 0 : 1);
  return rank(a) - rank(b) || (b.days ?? -1) - (a.days ?? -1);
}
