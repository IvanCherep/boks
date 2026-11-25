/**
 * The music line under an author's name (`bok_music_credits`): «Музыка: …».
 *
 * Authors type the credit as they would say it, often with its own label
 * («авторы музыки: Л. Булдыгин, В. Рвачев»). The label is ours, so theirs is
 * dropped rather than printed twice.
 */
export function musicCreditNames(music: string) {
  return music
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:авторы?\s+музыки|музыка|music(?:\s+by)?)\s*[:\-–—]?\s*/i, "")
    .trim();
}

export const maxMusicCredit = 200;

export function musicCreditLine(music: string, t: (en: string, ru: string) => string) {
  const names = musicCreditNames(music);
  return names ? t(`Music: ${names}`, `Музыка: ${names}`) : "";
}
