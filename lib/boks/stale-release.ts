/**
 * A tab opened before a release, asking for a script the release replaced.
 *
 * The app loads parts of itself later - a reading format, the account panel,
 * the admin console - as separate files named by their content. After a
 * release the server keeps the previous release's files for two days
 * (deploy/ops/switch.sh), so a tab that stayed open longer can ask for a file
 * that is gone. Vite reports that as `vite:preloadError` on the window; left
 * alone it is a broken screen until the reader reloads by hand.
 *
 * This reloads the page instead, which brings the current release. At most
 * once a minute: if the reload does not help, the error goes through as before
 * rather than reloading forever.
 */
export const staleReleaseReloadKey = "boks-stale-release-reload";

export const staleReleaseBootScript = `(function () {
  var key = ${JSON.stringify(staleReleaseReloadKey)};
  window.addEventListener("vite:preloadError", function (event) {
    try {
      var last = Number(window.sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 60000) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch (error) {
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
})();`;
