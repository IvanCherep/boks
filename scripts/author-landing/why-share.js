/*
 * boks: the «?» next to the sharing condition on the page for authors
 * (added by scripts/author-landing/terms.mjs to the end of landing.js).
 *
 * The plan without the condition («Кабинет автора без продвижения»,
 * 500 000 ₽) is not a card of its own: it is explained here, behind the
 * question "why do you ask me to share?". Its radio in the form stays hidden
 * until this window chooses it, so the application still says which plan.
 */
(() => {
  'use strict';
  const text = {
    ru: {
      ask: 'Почему мы просим делиться выпусками?',
      title: 'Почему мы просим делиться выпусками',
      body: [
        'boks молодая платформа. Сейчас новых читателей к нам приводят сами авторы: когда вы делитесь выпуском, его видят ваши читатели, часть из них остаётся в boks и читает других авторов, а другие авторы приводят читателей к вам.',
        'Поэтому ссылка на каждую вышедшую Series в открытом аккаунте входит в условия. Текст поста вы пишете сами: достаточно рассказать о своём произведении и оставить ссылку. Отправить ссылку на пост можно прямо из кабинета.',
      ],
      lead: 'Если вы не ведёте соцсети или не хотите писать там о boks',
      plan: 'Кабинет автора без продвижения',
      price: '500 000 ₽ в год',
      planBody: 'Всё, что входит в «Кабинет автора», без условия делиться выпусками.',
      cta: 'Оставить заявку на этот вариант',
      close: 'Закрыть',
    },
    en: {
      ask: 'Why do we ask you to share the editions?',
      title: 'Why we ask you to share the editions',
      body: [
        'boks is a young platform. Right now new readers come to us through the authors: when you share an edition, your readers see it, some of them stay on boks and read other authors, and other authors bring readers to you.',
        'That is why a link to every published Series on an open account is part of the terms. You write the post yourself: it is enough to tell about your work and leave the link. You can send us the link to your post right from the studio.',
      ],
      lead: 'If you do not use social media or do not want to post about boks there',
      plan: 'Author’s studio without promotion',
      price: '500,000 ₽ a year',
      planBody: 'Everything in the “Author’s studio”, without the condition to share the editions.',
      cta: 'Apply for this plan',
      close: 'Close',
    },
  };
  const t = () => text[document.documentElement.lang === 'en' ? 'en' : 'ru'];
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  let dialog = null;
  function close() {
    if (dialog?.open) dialog.close();
  }
  function choosePlan() {
    close();
    const input = document.querySelector('#application-form input[name="interest"][value="nopromo"]');
    if (input) {
      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.querySelector('#apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function open(opener) {
    const c = t();
    dialog?.remove();
    dialog = document.createElement('dialog');
    dialog.className = 'boks-why-dialog';
    dialog.setAttribute('aria-labelledby', 'boks-why-title');
    dialog.innerHTML = `<div class="boks-why-panel">
      <button type="button" class="boks-why-close" aria-label="${escape(c.close)}">×</button>
      <h3 id="boks-why-title">${escape(c.title)}</h3>
      ${c.body.map((p) => `<p>${escape(p)}</p>`).join('')}
      <div class="boks-why-plan">
        <p class="boks-why-lead">${escape(c.lead)}</p>
        <p class="boks-why-name">${escape(c.plan)}<span>${escape(c.price)}</span></p>
        <p>${escape(c.planBody)}</p>
        <a href="#apply" class="boks-why-cta">${escape(c.cta)}<span aria-hidden="true">↗</span></a>
      </div>
    </div>`;
    document.body.append(dialog);
    dialog.querySelector('.boks-why-close').addEventListener('click', close);
    dialog.querySelector('.boks-why-cta').addEventListener('click', (event) => { event.preventDefault(); choosePlan(); });
    // A click on the backdrop is a click on the dialog itself.
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener('close', () => opener?.focus());
    dialog.showModal();
  }

  /** Puts the «?» after the sharing condition of «Кабинет автора»; again after every re-render (language). */
  function mount() {
    const card = document.querySelector('.rz-offer a[data-interest="author"]')?.closest('.rz-offer');
    if (!card || card.querySelector('.boks-why')) return;
    const condition = [...card.querySelectorAll('li')].find((li) => /^(Условие|Condition)/.test(li.textContent.trim()));
    if (!condition) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'boks-why';
    button.textContent = '?';
    button.setAttribute('aria-label', t().ask);
    button.title = t().ask;
    button.addEventListener('click', () => open(button));
    condition.append(' ', button);
  }
  mount();
  new MutationObserver(mount).observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
})();
