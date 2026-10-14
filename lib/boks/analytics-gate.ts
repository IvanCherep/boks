/**
 * Whether this page should write reader analytics at all.
 *
 * The local dev server talks to the production database, and so does every
 * automated browser pointed at the site; both used to land in the Guests tab
 * as strangers - on 13 October twelve of fifteen "guest devices" were test
 * runs. So analytics are not written from a local host, nor from a browser
 * driven by automation (`navigator.webdriver`, which Playwright, Puppeteer and
 * WebDriver all set). Everything else on the page works as before.
 *
 * To see events from a local build on purpose, set `boks-record-analytics` to
 * "1" in localStorage.
 */
export const recordAnalyticsKey = "boks-record-analytics";

const localHosts = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1|.+\.local|.+\.localhost)$/i;

export function analyticsAllowed(
  env: { hostname: string; webdriver: boolean; optIn: boolean } | null = browserEnv()
) {
  if (!env) return false;
  if (env.optIn) return true;
  return !env.webdriver && !localHosts.test(env.hostname);
}

function browserEnv() {
  if (typeof window === "undefined") return null;
  let optIn = false;
  try {
    optIn = window.localStorage.getItem(recordAnalyticsKey) === "1";
  } catch {
    // Storage blocked: no opt-in.
  }
  return {
    hostname: window.location.hostname,
    webdriver: Boolean(window.navigator.webdriver),
    optIn,
  };
}
