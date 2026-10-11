/**
 * How a shared link `/b/<id>` hands the reader over to the feed.
 *
 * The `/b` page is rendered on the server so that a messenger's crawler gets
 * the title and the opening lines. A person must not see that page: it used to
 * redirect from a React effect, which waits for the whole bundle to download
 * and hydrate, so on a phone the reader first saw a plain text page - the
 * legal-page layout - for a second or two, and only then the reader. Now the
 * redirect runs from an inline script in the HTML itself, before the page is
 * painted, and hides that text while it does. The effect in
 * `open-shared-bok.tsx` stays as the fallback if the script did not run.
 *
 * `sharedBokTarget` and `sharedBokRedirectScript` must agree;
 * `shared-bok-redirect.test.ts` runs the script on a fake page to hold them
 * together, as `theme.test.ts` does for the theme boot script.
 */

/**
 * Carried from `/b/<id>?…` to the reader. `link` is a tracked link
 * (`tracked-links.ts`); `recording` is an admin's own link to film the piece
 * (`recording-mode.ts`).
 */
export const sharedBokForwardedKeys = ["link", "utm_source", "utm_medium", "utm_campaign", "recording"] as const;

/** The attribute the script puts on <html> while it leaves; globals.css hides the page under it. */
export const openingBokAttribute = "data-opening-bok";

/**
 * Where a shared link goes. A redirect drops the referrer, and the referrer is
 * how the console knows a visitor came from Telegram rather than from nowhere,
 * so it travels as `ref`, with `from=share` marking the landing.
 */
export function sharedBokTarget(input: { id: string; search: string; referrer: string; hostname: string }) {
  if (!input.id) return "/";
  const next = new URLSearchParams({ bok: input.id, from: "share" });
  try {
    const referrer = input.referrer ? new URL(input.referrer).hostname : "";
    if (referrer && referrer !== input.hostname) next.set("ref", referrer);
  } catch {
    // No readable referrer is a direct visit, which is also worth knowing.
  }
  const incoming = new URLSearchParams(input.search);
  for (const key of sharedBokForwardedKeys) {
    const value = incoming.get(key);
    if (value) next.set(key, value);
  }
  return `/?${next.toString()}`;
}

/** JSON is valid JavaScript, but `</script>` and the two line separators are not safe inside a script tag. */
function scriptLiteral(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The same as `sharedBokTarget`, as a script that runs before first paint. */
export function sharedBokRedirectScript(id: string) {
  return `(function () {
  var root = document.documentElement;
  var attribute = ${scriptLiteral(openingBokAttribute)};
  try {
    var id = ${scriptLiteral(id)};
    if (!id) {
      root.setAttribute(attribute, "");
      window.location.replace("/");
      return;
    }
    var next = new URLSearchParams();
    next.set("bok", id);
    next.set("from", "share");
    try {
      var referrer = document.referrer ? new URL(document.referrer).hostname : "";
      if (referrer && referrer !== window.location.hostname) next.set("ref", referrer);
    } catch (error) {}
    var incoming = new URLSearchParams(window.location.search);
    var keys = ${scriptLiteral(sharedBokForwardedKeys)};
    for (var i = 0; i < keys.length; i++) {
      var value = incoming.get(keys[i]);
      if (value) next.set(keys[i], value);
    }
    root.setAttribute(attribute, "");
    window.location.replace("/?" + next.toString());
  } catch (error) {
    // Leave the page visible: the effect in open-shared-bok.tsx will try again.
    root.removeAttribute(attribute);
  }
})();`;
}
