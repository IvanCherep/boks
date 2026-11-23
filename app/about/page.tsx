import type { Metadata } from "next";

import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { ReaderBackIcon } from "@/components/boks/reader/reader-icons";
import { supportEmail, supportMailto } from "@/lib/boks/contact";

export const metadata: Metadata = {
  title: "О проекте · Boks",
  description: "Boks делает чтение короткой литературы частью повседневной жизни, сохраняя тексты и голоса всех авторов.",
};

const team = [
  { name: "Иван Егоров", role: "Инженер", work: "Отвечает за архитектуру и разработку платформы. Специализируется на распределённых системах." },
  { name: "Андрей Курносов", role: "Инженер и дизайнер", work: "Отвечает за разработку интерфейсов для читателей и авторов." },
  { name: "Алексей Прохоров", role: "Поэт и продюсер", work: "Ведёт литературное направление, работает с авторами и представляет проект в литературной среде." },
];

/**
 * The mission, the story and the team: the short version of the one-page
 * «О проекте» the team sends to authors, linked from the letter to them.
 * Russian only, in the frame of /terms and /privacy (`app/legal-v45.css`).
 */
export default function AboutPage() {
  return (
    <main className="legal-page legal-v45 about-v45" lang="ru">
      <div className="legal-shell">
        <header className="legal-topbar">
          <a className="legal-back" href="/"><ReaderBackIcon /><span>К чтению</span></a>
          <a className="legal-mark" href="/" aria-label="boks"><BoksLogo seasonal={false} /><span className="legal-mark__star" aria-hidden="true">*</span></a>
          <nav className="legal-languages" aria-label="Для авторов">
            <a href="/author">Авторам</a>
          </nav>
        </header>

        <div className="legal-hero">
          <h1>О проекте</h1>
          <p className="legal-intro">
            Boks делает чтение короткой литературы частью повседневной жизни, сохраняя тексты и голоса всех авторов.
          </p>
        </div>

        <section className="legal-highlights" aria-labelledby="about-mission-title">
          <h2 id="about-mission-title">Миссия</h2>
          <ul>
            <li><h3>Чтение каждый день</h3><p>Короткая литература становится частью повседневной жизни.</p></li>
            <li><h3>Голоса авторов</h3><p>Boks сохраняет тексты и голоса всех авторов: каждое произведение звучит в авторском исполнении.</p></li>
            <li><h3>Boks Series</h3><p>Текст, голос и изображение вместе: синестезийность восприятия и увлекательный интерактивный опыт каждому.</p></li>
          </ul>
        </section>

        <article className="legal-document about-body">
          <section id="story" aria-labelledby="story-title">
            <h2 id="story-title">История проекта</h2>
            <p>
              Иван Егоров и Андрей Курносов создали Boks в магистратуре МФТИ. Они исследовали системы рекомендаций в
              приложении к короткой литературе. В ходе этой работы появился формат Boks Series: объединение текста,
              голоса и визуального оформления.
            </p>
            <p>
              Поэт Алексей Прохоров увидел в первых выпусках возможность сохранять голоса и тексты современных авторов,
              создавая уникальный интерактивный опыт взаимодействия с ними. Он присоединился к команде в качестве
              генерального продюсера и отраслевого эксперта.
            </p>
          </section>
          <section id="team" aria-labelledby="team-title">
            <h2 id="team-title">Команда</h2>
            <dl className="about-team">
              {team.map((person) => (
                <div key={person.name}>
                  <dt><strong>{person.name}</strong><span>{person.role}</span></dt>
                  <dd>{person.work}</dd>
                </div>
              ))}
            </dl>
          </section>
          <footer className="legal-support">
            <p><strong>Написать нам:</strong> <a href={supportMailto}>{supportEmail}</a>. Сайт: <a href="/">tryboks.com</a>.</p>
          </footer>
        </article>
      </div>
    </main>
  );
}
