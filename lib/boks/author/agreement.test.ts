import { describe, expect, it } from "vitest";
import { daysToPay, gostPaymentQr, legalHref, legalVersionLabel, legalKindFromSlug, legalNameProblem, paymentPurpose, paymentQr, phoneLabel, rub, ruDate } from "./agreement";

const details = {
  recipient: "Иванов Иван Иванович",
  inn: "123456789012",
  account: "40817810000000000001",
  bank: "АО «АЛЬФА-БАНК»",
  bic: "044525593",
  corrAccount: "30101810200000000593",
  sbpPhone: "+79001234567",
  sbpBank: "Альфа-Банк",
  payLink: null,
};
const agreement = { number: "2026/001", plan: "page" as const, acceptedAt: "2026-11-23T10:00:00Z", priceRub: 30000, payment: details };

describe("author agreement", () => {
  it("formats money, dates and phones", () => {
    expect(rub(30000)).toBe("30 000 ₽");
    expect(rub(500000)).toBe("500 000 ₽");
    expect(ruDate("2026-12-23")).toBe("23 декабря 2026");
    expect(phoneLabel("+79001234567")).toBe("+7 900 123-45-67");
  });

  it("builds the ГОСТ payment QR with kopecks and a clean purpose", () => {
    const purpose = paymentPurpose(agreement);
    expect(purpose).toBe("Оплата по договору-оферте № 2026/001 от 23.11.2026, тариф «Кабинет автора». Без НДС");
    const qr = gostPaymentQr(details, 30000, purpose + " | лишнее\nвторая строка");
    expect(qr).toMatch(/^ST00012\|Name=Иванов Иван Иванович\|PersonalAcc=40817810000000000001\|BankName=АО «АЛЬФА-БАНК»\|BIC=044525593\|CorrespAcc=30101810200000000593\|PayeeINN=123456789012\|Sum=3000000\|Purpose=/);
    expect(qr!.split("|").length).toBe(9);
  });

  it("has no QR without the details, and prefers the team's link", () => {
    expect(gostPaymentQr({ ...details, account: null }, 30000, "x")).toBeNull();
    expect(paymentQr({ ...agreement, payment: { ...details, payLink: "https://qr.nspk.ru/AS1000" } })).toEqual({ kind: "link", value: "https://qr.nspk.ru/AS1000" });
    expect(paymentQr(agreement)?.kind).toBe("details");
    expect(paymentQr({ ...agreement, payment: null })).toBeNull();
  });

  it("counts the days to pay in Moscow", () => {
    expect(daysToPay("2026-12-23", new Date("2026-12-23T12:00:00+03:00"))).toBe(0);
    expect(daysToPay("2026-12-23", new Date("2026-12-22T12:00:00+03:00"))).toBe(1);
    expect(daysToPay("2026-12-23", new Date("2026-12-24T12:00:00+03:00"))).toBe(-1);
    expect(daysToPay(null)).toBeNull();
  });

  it("checks the full name like the database", () => {
    expect(legalNameProblem("Иванов Иван Иванович")).toBe("");
    expect(legalNameProblem("Салтыков-Щедрин Михаил")).toBe("");
    expect(legalNameProblem("Иван")).not.toBe("");
    expect(legalNameProblem("Ivan 123")).not.toBe("");
    expect(legalNameProblem("")).not.toBe("");
  });

  it("maps documents to their pages", () => {
    expect(legalHref("author_offer")).toBe("/author/terms/offer");
    expect(legalHref("author_pd_processing", "2026-11-23")).toBe("/author/terms/processing/2026-11-23");
    expect(legalVersionLabel("2026-11-23")).toBe("23 ноября 2026");
    expect(legalVersionLabel("2026-12-01.2")).toBe("1 декабря 2026, редакция 2");
    expect(legalKindFromSlug("distribution")).toBe("author_pd_distribution");
    expect(legalKindFromSlug("nope")).toBeNull();
  });
});
