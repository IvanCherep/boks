/**
 * The one switch for authors' own Boks Series (`docs/series-recorder.md`,
 * "Hidden for authors"). Since 2026-11-22 the self-serve recorder (the
 * cabinet's entry card, `/author#series`, `SeriesRecorder mode="author"`) is
 * hidden from every non-admin account and the API refuses them a new draft:
 * what it makes is below the team's quality. Studio keeps everything, and
 * authors' existing drafts stay on disk untouched.
 *
 * To bring it back: set this to `true`. Nothing else needs to change.
 */
export const authorSeriesRecorderEnabled = false;

/** Whether this account may see and use the Series recorder in the cabinet: Studio always, an author only while the switch is on. */
export function seriesRecorderOpenTo(account: { admin: boolean }, enabled: boolean = authorSeriesRecorderEnabled) {
  return account.admin || enabled;
}

export const authorSeriesClosedMessage = "Boks Series are made by the boks team for now. Send your text with your voice from My page.";
