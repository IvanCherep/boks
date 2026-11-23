/**
 * The author contract online (`docs/author-agreements.md`): what the cabinet
 * shows about it and the QR code the author pays with. Pure, so it is tested
 * without a browser; the calls live in `components/boks/author-spaces/data.ts`.
 */

export type AuthorPlan = "launch" | "page" | "page_no_promotion";
export type PayState = "free" | "awaiting" | "reported" | "paid" | "cancelled";
export type LegalKind = "author_offer" | "author_pd_processing" | "author_pd_distribution";

export const legalKinds: LegalKind[] = ["author_offer", "author_pd_processing", "author_pd_distribution"];

/** The address of each document's page: `/author/terms/<slug>`. */
export const legalSlug: Record<LegalKind, string> = {
  author_offer: "offer",
  author_pd_processing: "processing",
  author_pd_distribution: "distribution",
};

export function legalKindFromSlug(slug: string): LegalKind | null {
  const found = (Object.entries(legalSlug) as [LegalKind, string][]).find(([, value]) => value === slug);
  return found ? found[0] : null;
}

/** `/author/terms/offer` (the edition in force) or `/author/terms/offer/2026-11-23` (that edition, for good). */
export function legalHref(kind: LegalKind, version?: string | null) {
  return `/author/terms/${legalSlug[kind]}${version ? `/${encodeURIComponent(version)}` : ""}`;
}

/** «2026-11-23» → «23 ноября 2026»; «2026-11-23.2» → «23 ноября 2026, редакция 2». */
export function legalVersionLabel(version: string) {
  const [day, n] = version.split(".");
  const date = ruDate(day);
  return n ? `${date}, редакция ${n}` : date;
}

export const planName: Record<AuthorPlan, string> = {
  launch: "Совместный запуск",
  page: "Кабинет автора",
  page_no_promotion: "Кабинет автора без продвижения",
};

export type PaymentDetails = {
  recipient: string | null;
  inn: string | null;
  account: string | null;
  bank: string | null;
  bic: string | null;
  corrAccount: string | null;
  sbpPhone: string | null;
  sbpBank: string | null;
  payLink: string | null;
  updatedAt?: string | null;
};

export type AuthorAgreement = {
  id: string;
  number: string;
  plan: AuthorPlan;
  priceRub: number;
  legalName: string;
  email: string;
  acceptedAt: string;
  documents: Record<LegalKind, string>;
  payState: PayState;
  payDue: string | null;
  reportedAt: string | null;
  paidAt: string | null;
  paidAmountRub: number | null;
  receiptUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelledAt: string | null;
  /** While it waits for the money: where to pay. */
  payment?: PaymentDetails | null;
};

/** The team's view adds who and from where. */
export type StudioAgreement = AuthorAgreement & {
  userId: string | null;
  spaceId: string | null;
  acceptedIp: string | null;
  acceptedAgent: string | null;
  payNote: string | null;
  cancelReason: string | null;
  handle: string | null;
  name: string | null;
};

export type InviteTerms = {
  plan: AuthorPlan;
  priceRub: number;
  payDays: number;
  legalName: string | null;
  documents: { kind: LegalKind; version: string; title: string }[];
};

/** 30000 → «30 000 ₽». */
export function rub(amount: number) {
  return `${new Intl.NumberFormat("ru-RU").format(amount).replace(/ /g, " ")} ₽`;
}

/** «2026-12-23» → «23 декабря 2026». */
export function ruDate(value: string | null | undefined) {
  if (!value) return "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+03:00`) : new Date(value);
  if (Number.isNaN(day.getTime())) return "";
  return day.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).replace(/\s*г\.$/, "");
}

/** What the author writes in the payment's purpose, and what the QR code carries. */
export function paymentPurpose(agreement: Pick<AuthorAgreement, "number" | "plan" | "acceptedAt">) {
  return `Оплата по договору-оферте № ${agreement.number} от ${ruShortDate(agreement.acceptedAt)}, тариф «${planName[agreement.plan]}». Без НДС`;
}

function ruShortDate(value: string) {
  const day = new Date(value);
  if (Number.isNaN(day.getTime())) return "";
  return day.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" });
}

/** A value inside the payment QR: its separators cannot appear in it. */
function field(value: string) {
  return value.replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The payment QR code by bank details (ГОСТ Р 56042-2014, «ST00012», UTF-8),
 * read by the camera of most Russian banking apps: it fills in the recipient,
 * the account, the amount in kopecks and the purpose. Null without the
 * details it needs (recipient, account, bank, BIC).
 */
export function gostPaymentQr(details: PaymentDetails | null | undefined, amountRub: number, purpose: string) {
  if (!details?.recipient || !details.account || !details.bank || !details.bic) return null;
  const parts = [
    "ST00012",
    `Name=${field(details.recipient)}`,
    `PersonalAcc=${details.account}`,
    `BankName=${field(details.bank)}`,
    `BIC=${details.bic}`,
  ];
  if (details.corrAccount) parts.push(`CorrespAcc=${details.corrAccount}`);
  if (details.inn) parts.push(`PayeeINN=${details.inn}`);
  parts.push(`Sum=${Math.round(amountRub * 100)}`, `Purpose=${field(purpose)}`);
  return parts.join("|");
}

/** What the QR code on the payment screen carries: the team's ready link first, else the bank details. */
export function paymentQr(agreement: Pick<AuthorAgreement, "number" | "plan" | "acceptedAt" | "priceRub" | "payment">) {
  if (agreement.payment?.payLink) return { kind: "link" as const, value: agreement.payment.payLink };
  const value = gostPaymentQr(agreement.payment, agreement.priceRub, paymentPurpose(agreement));
  return value ? { kind: "details" as const, value } : null;
}

/** «+79001234567» → «+7 900 123-45-67». */
export function phoneLabel(phone: string) {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

/** Days left to pay, counted in Moscow; negative once the day has passed. */
export function daysToPay(payDue: string | null, now = new Date()) {
  if (!payDue) return null;
  const due = new Date(`${payDue}T23:59:59+03:00`).getTime();
  return Math.ceil((due - now.getTime()) / 86_400_000) - 1;
}

/** Whether the full name looks like one, as the database checks it. */
export function legalNameProblem(value: string) {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return "Впишите фамилию, имя и отчество.";
  if (name.length > 200) return "Слишком длинно.";
  if (!/ /.test(name) || name.length < 5 || !/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]*[A-Za-zА-Яа-яЁё.]$/.test(name)) {
    return "Как в паспорте: фамилия, имя и отчество, только буквы.";
  }
  return "";
}
