"use client";

import "@/app/author-terms.css";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { ReaderBackIcon } from "@/components/boks/reader/reader-icons";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import { legalHref, legalKindFromSlug, legalKinds, legalVersionLabel, type DocumentKind } from "@/lib/boks/author/agreement";
import { parseLegalMarkdown, type Inline, type LegalBlock } from "@/lib/boks/author/legal-markdown";
import { privacyRu } from "@/app/privacy/privacy-ru";
import { loadLegalDocument, loadLegalDocuments, type LegalDocument, type LegalDocumentEntry } from "./terms-data";

/**
 * The documents for authors (`docs/author-agreements.md`), in the frame of
 * /terms and /privacy (`legal-v45.css`): `/author/terms` lists them,
 * `/author/terms/<doc>` is the edition in force and
 * `/author/terms/<doc>/<version>` one edition for good, the one a contract
 * names. The text is the stored edition word for word; «Главное» above it is
 * a short summary that says it does not replace the text.
 *
 * The fourth tab, `/author/terms/privacy`, is the Privacy policy of /privacy
 * (the one policy for everyone, the one the offer names) shown in this frame,
 * so an author moving between the four documents never loses the way back.
 * /privacy in turn has a tab back to these documents.
 */

const short: Record<DocumentKind, string> = {
  author_partner_offer: "Сотрудничество",
  author_offer: "Договор-оферта",
  author_pd_processing: "Обработка данных",
  author_pd_distribution: "Распространение данных",
};

const heading: Record<DocumentKind, string> = {
  author_partner_offer: "Договор-оферта о сотрудничестве",
  author_offer: "Договор-оферта для авторов",
  author_pd_processing: "Согласие на обработку персональных данных",
  author_pd_distribution: "Согласие на распространение персональных данных",
};

const lead: Record<DocumentKind, string> = {
  author_partner_offer: "Условия тарифа «Сотрудничество»: Boks делает авторскую страницу и Boks Series без оплаты, автор делится ссылкой на каждую вышедшую Series в своих соцсетях.",
  author_offer: "Условия, на которых Boks делает авторскую страницу и Boks Series. Договор заключается на сайте: по приглашению редакции, отметкой в кабинете.",
  author_pd_processing: "Какие данные автора нужны для договора и кабинета, зачем, где они хранятся и как отозвать согласие.",
  author_pd_distribution: "Что из сведений об авторе видят читатели на странице и в Series и как это прекратить.",
};

const highlights: Record<DocumentKind, { title: string; body: string }[]> = {
  author_partner_offer: [
    { title: "Без оплаты", body: "Страница, кабинет и Boks Series вашим голосом бесплатно. Требований к просмотрам и подписчикам нет, штрафов нет." },
    { title: "Ваша часть", body: "О каждой вышедшей Series пост со ссылкой на неё в вашем открытом аккаунте, в течение 30 дней и не меньше чем на 30 дней. Если постов нет, редакция может остановить работу над новыми Series." },
    { title: "Ваши права", body: "Права на тексты и записи остаются у вас. Каждый выпуск вы смотрите первым, публикуете сами и можете снять в любой момент." },
  ],
  author_offer: [
    { title: "Что входит", body: "Авторская страница, кабинет и Boks Series вашим голосом: 5 гарантированно, дальше до 30 за год, не чаще одной в неделю." },
    { title: "Оплата", body: "«Кабинет автора» стоит 30 000 ₽ за год. Кабинет открывается сразу, оплатить можно в течение 30 дней; год считается со дня оплаты." },
    { title: "Ваши права", body: "Права на тексты и записи остаются у вас. Каждый выпуск вы смотрите первым, публикуете сами и можете снять в любой момент." },
  ],
  author_pd_processing: [
    { title: "Зачем", body: "Чтобы заключить и исполнять договор: кабинет, страница, Series, связь с вами и расчёты." },
    { title: "Где хранятся", body: "На серверах в России. Тексты и голос анализируются и служат обучению Boks AI; голос не используется для распознавания личности, синтеза или клонирования." },
    { title: "Как отозвать", body: "Письмом на support@tryboks.com с почты вашего аккаунта или через кабинет." },
  ],
  author_pd_distribution: [
    { title: "Что видят читатели", body: "На tryboks.com: имя или псевдоним, фото, биографию, голос в опубликованных вами Series и в материалах о Boks, ссылки, которые вы указали сами." },
    { title: "Что не публикуется", body: "Почта, сведения о договоре и об оплате." },
    { title: "Как прекратить", body: "Требованием на support@tryboks.com: распространение прекращается с момента его получения. Series можно снять в кабинете самому." },
  ],
};

type Section = { id: string; title: string; blocks: LegalBlock[] };

function sectionId(title: string, index: number) {
  const app = /^Приложение\s*№\s*(\d+)/.exec(title);
  if (app) return `app-${app[1]}`;
  const num = /^(\d+)\./.exec(title);
  if (num) return `s-${num[1]}`;
  return index === 0 ? "intro" : `part-${index}`;
}

/** The stored text as sections: everything before the first `##` is the opening section. */
function toSections(blocks: LegalBlock[], kind: DocumentKind) {
  const title = blocks.find((block) => block.kind === "title");
  const subtitle = blocks.find((block) => block.kind === "subtitle");
  const sections: Section[] = [];
  let current: Section = { id: "intro", title: kind === "author_offer" || kind === "author_partner_offer" ? "Об оферте" : "О согласии", blocks: [] };
  for (const block of blocks) {
    if (block.kind === "title" || block.kind === "subtitle") continue;
    if (block.kind === "h2") {
      if (current.blocks.length) sections.push(current);
      current = { id: sectionId(block.text, sections.length + 1), title: block.text, blocks: [] };
      continue;
    }
    current.blocks.push(block);
  }
  if (current.blocks.length) sections.push(current);
  return { title: title?.kind === "title" ? title.text : "", subtitle: subtitle?.kind === "subtitle" ? subtitle.text : "", sections };
}

function Text({ parts }: { parts: Inline }) {
  return <>{parts.map((part, index) => (part.bold ? <strong key={index}>{part.text}</strong> : <Fragment key={index}>{part.text}</Fragment>))}</>;
}

/** «4.2.1. текст» keeps its number apart, so the clauses read as a list. */
function Paragraph({ parts }: { parts: Inline }) {
  const first = parts[0];
  const match = first && !first.bold ? /^(\d+(?:\.\d+)*\.)\s+([\s\S]*)$/.exec(first.text) : null;
  if (!match) {
    // «1. **Тарифы.** …» in the appendices: the number is plain, the rest may start bold.
    return <p><Text parts={parts} /></p>;
  }
  const rest: Inline = [{ text: match[2], bold: false }, ...parts.slice(1)].filter((part) => part.text);
  const depth = match[1].replace(/\.$/, "").split(".").length - 2;
  return (
    <p className={`aterm-clause aterm-clause--${Math.min(depth, 2)}`}>
      <span className="aterm-num">{match[1]}</span> <Text parts={rest} />
    </p>
  );
}

function Blocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "h3": return <h3 key={index}>{block.text}</h3>;
          case "p": return <Paragraph key={index} parts={block.inline} />;
          case "ul": return <ul key={index}>{block.items.map((item, n) => <li key={n}><Text parts={item} /></li>)}</ul>;
          case "table": return (
            <div key={index} className="aterm-table" role="region" aria-label="Таблица" tabIndex={0}>
              <table>
                <thead><tr>{block.head.map((cell, n) => <th key={n} scope="col"><Text parts={cell} /></th>)}</tr></thead>
                <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, n) => <td key={n} data-label={block.head[n]?.map((part) => part.text).join("") ?? ""}><Text parts={cell} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
          default: return null;
        }
      })}
    </>
  );
}

type Active = DocumentKind | "privacy" | "index";

/** The policy is not a stored edition: it lives in `app/privacy/privacy-ru.tsx` and is served at /privacy too. */
const privacySlug = "privacy";
const privacyTab = "Конфиденциальность";

function Frame({ active, children }: { active: Active; children: ReactNode }) {
  // On a phone the four tabs scroll sideways: bring the open one into view.
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabs.current;
    const current = nav?.querySelector<HTMLElement>("[aria-current]");
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = current.offsetLeft - nav.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, [active]);
  return (
    <main className="legal-page legal-v45 aterm" lang="ru">
      <div className="legal-shell">
        <header className="legal-topbar">
          <a className="legal-back" href="/author"><ReaderBackIcon /><span>Для авторов</span></a>
          <a className="legal-mark" href="/" aria-label="boks"><BoksLogo seasonal={false} /><span className="legal-mark__star" aria-hidden="true">*</span></a>
          <a className="aterm-all" href="/author/terms" aria-current={active === "index" ? "page" : undefined}>Все документы</a>
        </header>
        <nav ref={tabs} className="legal-tabs aterm-tabs" aria-label="Документы для авторов">
          {legalKinds.map((kind) => (
            <a key={kind} href={legalHref(kind)} aria-current={kind === active ? "page" : undefined}>{short[kind]}</a>
          ))}
          <a href={`/author/terms/${privacySlug}`} aria-current={active === "privacy" ? "page" : undefined}>{privacyTab}</a>
        </nav>
        {children}
      </div>
    </main>
  );
}

function Contents({ sections }: { sections: { id: string; title: string }[] }) {
  return (
    <ol>
      {sections.map((section) => (
        <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
      ))}
    </ol>
  );
}

/** `/author/terms/<doc>[/<version>]`: one of the stored documents, or the policy. */
export function AuthorTermsPage({ slug, version = null }: { slug: string; version?: string | null }) {
  if (slug === privacySlug && !version) return <AuthorPrivacyPage />;
  return <AuthorDocumentPage slug={slug} version={version} />;
}

function AuthorPrivacyPage() {
  useEffect(() => {
    document.title = `${privacyRu.title} · Boks`;
  }, []);
  const { title, effective, intro, highlights: points, sections } = privacyRu;
  return (
    <Frame active="privacy">
      <div className="legal-hero aterm-hero">
        <p className="legal-effective">{effective}</p>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>
      </div>

      <section className="legal-highlights" aria-labelledby="aterm-highlights">
        <h2 id="aterm-highlights">Главное</h2>
        <ul>
          {points.map((item) => (
            <li key={item.title}><h3>{item.title}</h3><p>{item.body}</p></li>
          ))}
        </ul>
        <p className="aterm-note">Это краткое изложение. Порядок обработки данных определяет полный текст ниже.</p>
      </section>

      <div className="legal-body">
        <nav className="legal-contents legal-contents--wide" aria-label="Содержание">
          <p>Содержание</p>
          <Contents sections={sections} />
        </nav>
        <details className="legal-contents legal-contents--narrow">
          <summary>Содержание</summary>
          <nav aria-label="Содержание"><Contents sections={sections} /></nav>
        </details>

        <article className="legal-document aterm-document">
          <header className="aterm-doc-title">
            <p className="aterm-doc-kicker">Для всех пользователей Boks</p>
            <p className="aterm-doc-name">{title}</p>
            <p className="aterm-doc-sub">Один документ для читателей и авторов. Он же опубликован по адресу <a href="/privacy?lang=ru">tryboks.com/privacy</a>, там есть и английская версия.</p>
          </header>
          {sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
              <h2 id={`${section.id}-title`}>{section.title}</h2>
              {section.body}
            </section>
          ))}
          <footer className="legal-support aterm-footer">
            <p><strong>Остались вопросы?</strong> Напишите на <a href={supportMailto}>{supportEmail}</a>.</p>
            <p className="aterm-actions">
              <button type="button" onClick={() => window.print()}>Распечатать или сохранить в PDF</button>
            </p>
          </footer>
        </article>
      </div>
    </Frame>
  );
}

function AuthorDocumentPage({ slug, version }: { slug: string; version: string | null }) {
  const kind = legalKindFromSlug(slug);
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">(kind ? "loading" : "missing");

  useEffect(() => {
    if (!kind) return;
    // `?v=` from links made before editions had their own addresses.
    const asked = version ?? new URLSearchParams(window.location.search).get("v");
    let live = true;
    loadLegalDocument(kind, asked)
      .then((answer) => {
        if (!live) return;
        setDoc(answer);
        setState(answer ? "ready" : "missing");
        if (answer) document.title = `${heading[kind]}, редакция ${legalVersionLabel(answer.version)} · Boks`;
      })
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, [kind, version]);

  const parsed = useMemo(() => (doc && kind ? toSections(parseLegalMarkdown(doc.body), kind) : null), [doc, kind]);

  if (!kind || state === "missing" || state === "failed") {
    return (
      <Frame active="index">
        <div className="legal-hero aterm-hero">
          <h1>{state === "failed" ? "Не удалось загрузить документ" : "Такого документа нет"}</h1>
          <p className="legal-intro">{state === "failed" ? "Проверьте интернет и обновите страницу." : "Проверьте ссылку или откройте список документов."} <a href="/author/terms">Все документы для авторов</a></p>
        </div>
      </Frame>
    );
  }

  return (
    <Frame active={kind}>
      <div className="legal-hero aterm-hero">
        <p className="legal-effective">
          {doc ? <>Редакция от {legalVersionLabel(doc.version)}{doc.current ? <><br />действует сейчас</> : <><br />прежняя редакция</>}</> : "Загружаем…"}
        </p>
        <h1>{heading[kind]}</h1>
        <p className="legal-intro">{lead[kind]}</p>
      </div>

      {doc && !doc.current && (
        <p className="aterm-old" role="note">
          Это прежняя редакция. Она действует для договоров, заключённых по ней. <a href={legalHref(kind)}>Открыть действующую редакцию</a>
        </p>
      )}

      <section className="legal-highlights" aria-labelledby="aterm-highlights">
        <h2 id="aterm-highlights">Главное</h2>
        <ul>
          {highlights[kind].map((item) => (
            <li key={item.title}><h3>{item.title}</h3><p>{item.body}</p></li>
          ))}
        </ul>
        <p className="aterm-note">Это краткое изложение. Условия определяет полный текст ниже.</p>
      </section>

      {!parsed ? (
        <p className="aterm-loading" role="status">Загружаем документ…</p>
      ) : (
        <div className="legal-body">
          <nav className="legal-contents legal-contents--wide" aria-label="Содержание">
            <p>Содержание</p>
            <Contents sections={parsed.sections} />
          </nav>
          <details className="legal-contents legal-contents--narrow">
            <summary>Содержание</summary>
            <nav aria-label="Содержание"><Contents sections={parsed.sections} /></nav>
          </details>

          <article className="legal-document aterm-document">
            <header className="aterm-doc-title">
              <p className="aterm-doc-kicker">Полный текст</p>
              <p className="aterm-doc-name">{parsed.title}</p>
              {parsed.subtitle && <p className="aterm-doc-sub">{parsed.subtitle}</p>}
            </header>
            {parsed.sections.map((section) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                <Blocks blocks={section.blocks} />
              </section>
            ))}
            <footer className="legal-support aterm-footer">
              <p><strong>Остались вопросы?</strong> Напишите на <a href={supportMailto}>{supportEmail}</a>.</p>
              <p className="aterm-actions">
                <button type="button" onClick={() => window.print()}>Распечатать или сохранить в PDF</button>
                {doc && <a href={legalHref(kind, doc.version)}>Постоянная ссылка на эту редакцию</a>}
              </p>
              {doc && (
                <p className="aterm-meta">
                  Редакция {doc.version}. Контрольная сумма текста (SHA-256): <span>{doc.sha256}</span>
                  {doc.versions.length > 1 && (
                    <>
                      <br />Все редакции:{" "}
                      {doc.versions.map((entry, n) => (
                        <Fragment key={entry.version}>{n > 0 && ", "}<a href={legalHref(kind, entry.version)}>{legalVersionLabel(entry.version)}</a></Fragment>
                      ))}
                    </>
                  )}
                </p>
              )}
            </footer>
          </article>
        </div>
      )}
    </Frame>
  );
}

/** `/author/terms`: the three stored documents with every edition, then the policy and the Terms that apply to everyone. */
export function AuthorTermsIndex() {
  const [rows, setRows] = useState<LegalDocumentEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadLegalDocuments().then((value) => live && setRows(value), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Frame active="index">
      <div className="legal-hero aterm-hero">
        <h1>Документы для авторов</h1>
        <p className="legal-intro">
          Договор с автором заключается на сайте: редакция присылает приглашение, автор входит по коду из почты и отмечает согласие с этими документами. Каждая редакция остаётся доступной по своей постоянной ссылке.
        </p>
      </div>
      {failed && <p className="aterm-loading" role="alert">Не удалось загрузить список. Обновите страницу.</p>}
      {!rows && !failed && <p className="aterm-loading" role="status">Загружаем…</p>}
      <ul className="aterm-cards">
        {rows?.map((row) => (
          <li key={row.kind}>
            <a className="aterm-card" href={legalHref(row.kind)}>
              <span className="aterm-card__kind">{short[row.kind]}</span>
              <strong>{heading[row.kind]}</strong>
              <span className="aterm-card__lead">{lead[row.kind]}</span>
              <span className="aterm-card__version">Действующая редакция от {legalVersionLabel(row.version)} →</span>
            </a>
            {row.versions.length > 1 && (
              <p className="aterm-card__older">
                Прежние редакции:{" "}
                {row.versions.filter((entry) => entry.version !== row.version).map((entry, n) => (
                  <Fragment key={entry.version}>{n > 0 && ", "}<a href={legalHref(row.kind, entry.version)}>{legalVersionLabel(entry.version)}</a></Fragment>
                ))}
              </p>
            )}
          </li>
        ))}
        <li>
          <a className="aterm-card aterm-card--quiet" href={`/author/terms/${privacySlug}`}>
            <span className="aterm-card__kind">{privacyTab} · для всех</span>
            <strong>{privacyRu.title}</strong>
            <span className="aterm-card__lead">Политика оператора в отношении обработки персональных данных: кто, какие данные и на каком основании обрабатывает, права читателей и авторов.</span>
            <span className="aterm-card__version">{privacyRu.effective} →</span>
          </a>
        </li>
        <li>
          <a className="aterm-card aterm-card--quiet" href="/terms?lang=ru">
            <span className="aterm-card__kind">Условия · для всех</span>
            <strong>Условия использования</strong>
            <span className="aterm-card__lead">Общие правила сервиса. Для автора с договором условия договора-оферты применяются в той части, которую он регулирует.</span>
            <span className="aterm-card__version">Открыть →</span>
          </a>
        </li>
      </ul>
    </Frame>
  );
}
