/* The reader introduction's bridge to boks (scripts/onboarding/import.mjs copies
   it into public/onboarding/index.html). The introduction runs in a frame over
   the reader; this hands its answers to boks and takes the real first bok from
   it. Nothing here reads or writes an account: boks does, with the answers. */
(function () {
  var parent = window.parent !== window ? window.parent : null;
  var origin = window.location.origin;
  var names = {};
  fetch("assets/library.json?v=1").then(function (r) { return r.ok ? r.json() : null; }).then(function (library) {
    (library && library.authors || []).forEach(function (a) { names[a.id] = a.name; });
  }, function () {});

  function answers(state, skip) {
    var onboarding = state.onboarding || {};
    var profile = state.profile || {};
    var ids = (onboarding.authorIds || []).filter(function (id) { return typeof id === "string"; }).slice(0, 60);
    return {
      version: 1,
      status: skip ? "skipped" : "completed",
      readingLanguages: (profile.languages || []).filter(function (l) { return l === "ru" || l === "en"; }),
      form: ["prose", "poetry", "any"].indexOf(onboarding.formPreference) >= 0 ? onboarding.formPreference : "any",
      classics: ids.map(function (id) { return { id: id, name: names[id] || null }; }),
    };
  }
  function post(message) { if (parent) parent.postMessage(message, origin); }

  window.BoksBridge = {
    version: "1",
    firstBook: null,
    done: function (state) { post({ type: "boks-onboarding-done", answers: answers(state, Boolean(state.skip)), read: Boolean(state.read) }); },
    signIn: function (state) { post({ type: "boks-onboarding-sign-in", answers: answers(state, false) }); },
    answers: function (state) { post({ type: "boks-onboarding-answers", answers: answers(state, false) }); },
  };
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || !event.data) return;
    if (event.data.type === "boks-first-book" && event.data.book) window.BoksBridge.firstBook = event.data.book;
  });
  post({ type: "boks-onboarding-ready" });
})();
