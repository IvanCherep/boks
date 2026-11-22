/*
 * boks: connects the static page for authors (public/author-landing/) to the
 * app page that frames it (/author, components/boks/author-landing/).
 * Loaded after the page's own controller (app.js), which only validates.
 * The host is `parent.boksAuthorLanding` (same origin):
 *   { signedIn, application, submit(fields) -> Promise, signIn?(), setLanguage?(lang) }
 * and it fires `boks:host` on this window when any of that changes.
 */
(() => {
  'use strict';
  const app = document.querySelector('#app');
  if (!app) return;

  const text = {
    ru: {
      signIn: 'Войти',
      sending: 'Отправляю…',
      sentTitle: 'Заявка у нас',
      sentBody: 'Редакция прочитает её и напишет вам в течение двух рабочих дней по контакту, который вы оставили.',
      failedTitle: 'Заявка не отправилась',
      failed: 'Попробуйте через минуту. Всё, что вы написали, осталось в форме.',
      standalone: 'Заявку можно отправить на странице tryboks.com/author.',
      status: {
        new: date => `Ваша заявка от ${date} у редакции. Напишем вам в течение двух рабочих дней.`,
        contacted: date => `Мы ответили на вашу заявку от ${date} по контакту, который вы оставили.`,
        closed: date => `Заявка от ${date} закрыта. Можно отправить новую.`,
      },
    },
    en: {
      signIn: 'Sign in',
      sending: 'Sending…',
      sentTitle: 'The application is in',
      sentBody: 'The editors will read it and write to you within two working days, through the contact you left.',
      failedTitle: 'The application did not go',
      failed: 'Try again in a minute. Everything you wrote is still in the form.',
      standalone: 'You can apply on tryboks.com/author.',
      status: {
        new: date => `Your application of ${date} is with the editors. We will write within two working days.`,
        contacted: date => `We have answered your application of ${date} through the contact you left.`,
        closed: date => `Your application of ${date} is closed. You can send a new one.`,
      },
    },
  };
  // The database keeps at most this much of each field (`submit_author_application`).
  const limits = { name: 120, contact: 200, publications: 1500, audience: 120, about: 3000 };
  const offers = { author: 'page', nopromo: 'page_no_promotion', series: 'series', launch: 'launch', unsure: 'unsure' };
  const draftKey = 'boks-author-application-draft-v2';

  const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'ru');
  const t = () => text[lang()];
  const host = () => {
    try { return window.parent !== window ? window.parent.boksAuthorLanding || null : null; } catch { return null; }
  };
  const form = () => app.querySelector('#application-form');
  // The page can start before the app around it (early-frame.ts): give the app a few seconds to arrive.
  function waitForHost() {
    return new Promise(resolve => {
      const started = Date.now();
      (function check() {
        const bridge = host();
        if (bridge?.submit || window.parent === window || Date.now() - started > 15000) resolve(bridge?.submit ? bridge : null);
        else setTimeout(check, 200);
      })();
    });
  }
  let sending = false;

  function fieldsOf(node) {
    const value = name => (node.elements.namedItem(name)?.value ?? '').trim();
    return {
      offer: offers[node.querySelector('input[name="interest"]:checked')?.value] || 'unsure',
      name: value('name'),
      contact: value('contact'),
      links: value('publications'),
      audience: value('audience'),
      message: value('about'),
    };
  }

  function saveDraft() {
    const node = form();
    if (!node) return;
    const draft = {};
    for (const field of node.querySelectorAll('input[name],textarea[name]')) {
      if (field.type === 'radio') { if (field.checked) draft[field.name] = field.value; } else draft[field.name] = field.value;
    }
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* private mode: the form keeps it while open */ }
  }

  function restoreDraft() {
    const node = form();
    if (!node) return;
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); } catch { draft = null; }
    if (!draft) return;
    for (const field of node.querySelectorAll('input[name],textarea[name]')) {
      if (!(field.name in draft)) continue;
      if (field.type === 'radio') field.checked = field.value === draft[field.name];
      else if (!field.value) field.value = draft[field.name];
    }
    node.querySelectorAll('input[name="interest"]').forEach(f => f.closest('label')?.classList.toggle('is-selected', f.checked));
  }

  function clearDraft() {
    try { sessionStorage.removeItem(draftKey); } catch { /* nothing to clear */ }
  }

  function showDialog(title, body) {
    const dialog = app.querySelector('#feedback-dialog');
    if (!dialog) return;
    dialog.querySelector('[data-feedback-title]').textContent = title;
    dialog.querySelector('[data-feedback-body]').textContent = body;
    if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
  }

  function setSending(node, on, submitter) {
    sending = on;
    const button = submitter || node.querySelector('button[type="submit"]');
    if (!button) return;
    if (on) {
      button.dataset.label = button.innerHTML;
      button.textContent = t().sending;
      button.disabled = true;
    } else {
      if (button.dataset.label) button.innerHTML = button.dataset.label;
      button.disabled = false;
    }
  }

  // Runs before the page's own submit handler (which only shows "ready") and replaces it.
  document.addEventListener('submit', event => {
    const node = event.target;
    if (!(node instanceof HTMLFormElement) || node.id !== 'application-form') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (sending) return;
    for (const field of node.querySelectorAll('[required]')) field.setCustomValidity(field.value.trim() ? '' : (window.BoksAuthorCopy?.[lang()]?.ui?.required || ''));
    if (!node.reportValidity()) return;
    const submitter = event.submitter;
    setSending(node, true, submitter);
    const fields = fieldsOf(node);
    waitForHost().then(bridge => {
      if (!bridge) throw { readable: t().standalone };
      return bridge.submit(fields);
    }).then(() => {
      setSending(node, false, submitter);
      node.reset();
      node.querySelectorAll('input[name="interest"]').forEach(f => f.closest('label')?.classList.toggle('is-selected', f.checked));
      clearDraft();
      showDialog(t().sentTitle, t().sentBody);
    }, failure => {
      setSending(node, false, submitter);
      showDialog(t().failedTitle, (failure && failure.readable) || t().failed);
    });
  }, true);

  document.addEventListener('input', event => {
    if (event.target instanceof Element && event.target.closest('#application-form')) saveDraft();
  });
  document.addEventListener('change', event => {
    if (event.target instanceof Element && event.target.closest('#application-form')) saveDraft();
  });

  // Links leave the frame: the page lives inside /author.
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.getAttribute('href').startsWith('#') || link.target) return;
    link.target = '_top';
  }, true);

  // The page's language switch: the rest of boks follows it.
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-action="language"]')) return;
    requestAnimationFrame(() => host()?.setLanguage?.(lang()));
  });

  function decorate() {
    const node = form();
    if (node) {
      for (const [name, max] of Object.entries(limits)) {
        const field = node.elements.namedItem(name);
        if (field && 'maxLength' in field) field.maxLength = max;
      }
    }
    const bridge = host();
    // An invited author, or one with a cabinet, signs in here and /author opens it.
    const tools = app.querySelector('.rh-tools');
    const existing = app.querySelector('[data-boks-sign-in]');
    const wanted = bridge && !bridge.signedIn && typeof bridge.signIn === 'function';
    if (tools && wanted && !existing) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'language-switch boks-sign-in';
      button.dataset.boksSignIn = '';
      button.textContent = t().signIn;
      button.addEventListener('click', () => host()?.signIn?.());
      tools.prepend(button);
    } else if (existing && !wanted) existing.remove();
    else if (existing) existing.textContent = t().signIn;

    // A signed-in applicant sees what became of the last application.
    const application = bridge?.application;
    let note = app.querySelector('[data-boks-application]');
    const header = app.querySelector('#apply-title')?.parentElement;
    if (application && header) {
      if (!note) {
        note = document.createElement('p');
        note.className = 'boks-application-status';
        note.dataset.boksApplication = '';
        note.setAttribute('role', 'status');
        header.append(note);
      }
      const date = new Date(application.createdAt).toLocaleDateString(lang(), { day: 'numeric', month: 'long' });
      const line = t().status[application.status] || t().status.new;
      note.textContent = line(date);
    } else note?.remove();
  }

  // SVG <image>s have no loading="lazy": the page renders them without an address and they get it near the screen.
  // A hidden one (the opening collage on a phone) never intersects and never loads.
  const lazySvg = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      lazySvg.unobserve(entry.target);
      entry.target.querySelectorAll('image[data-lazy-href]').forEach(image => {
        image.setAttribute('href', image.dataset.lazyHref);
        image.removeAttribute('data-lazy-href');
      });
    }
  }, { rootMargin: '600px 0px' }) : null;
  function watchSvg() {
    app.querySelectorAll('image[data-lazy-href]').forEach(image => {
      const svg = image.closest('svg');
      if (!svg) return;
      if (lazySvg) lazySvg.observe(svg);
      else { image.setAttribute('href', image.dataset.lazyHref); image.removeAttribute('data-lazy-href'); }
    });
  }

  // The page re-renders itself on a language change.
  new MutationObserver(records => {
    if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('header,main') || n.querySelector?.('#application-form'))))) {
      decorate();
      restoreDraft();
    }
    watchSvg();
  }).observe(app, { childList: true, subtree: true });
  window.addEventListener('boks:host', decorate);
  decorate();
  restoreDraft();
  watchSvg();
})();
