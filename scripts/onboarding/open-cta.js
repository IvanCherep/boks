/* "Open the cabinet" as a plain button pinned to the bottom of a phone or
   tablet screen (the designers' label sits inside the scaled room, where it
   is tiny and can fall below the fold). It shows only on the first room and
   presses the door itself. The desktop room keeps its own label on the door. */
(function () {
  var lang = (new URLSearchParams(location.search).get("lang") || document.documentElement.lang || "ru").slice(0, 2);
  var button = document.createElement("button");
  button.type = "button";
  button.className = "boks-open-cta";
  button.hidden = true;
  button.innerHTML = '<span>' + (lang === "en" ? "Open the cabinet" : "Открыть шкаф") + '</span><span aria-hidden="true">→</span>';
  document.body.appendChild(button);

  function visible(el) {
    if (!el || !el.offsetParent) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function door() {
    var desktop = document.querySelector(".ob-desktop-welcome-open");
    if (visible(desktop)) return null;
    var doors = document.querySelectorAll(".ob-sliding-open[data-action=ob-start]");
    for (var i = 0; i < doors.length; i += 1) if (visible(doors[i])) return doors[i];
    return null;
  }
  function update() {
    var world = document.querySelector(".ob-living-world");
    var show = Boolean(world && world.dataset.obStage === "welcome" && world.dataset.artReady === "true" && door());
    document.documentElement.classList.toggle("boks-open-cta-on", show);
    button.hidden = !show;
  }
  button.addEventListener("click", function () {
    var target = door();
    if (target) { button.hidden = true; target.click(); }
  });
  var queued = false;
  function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; update(); }); }
  new MutationObserver(soon).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-ob-stage", "data-art-ready", "hidden", "class"] });
  addEventListener("resize", soon);
  soon();
})();
