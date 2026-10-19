/** Book jackets vary without implying a genre or changing with feed ranking. */
export const bokCoverPalettes = [
  { name: "coral", paper: "#e65534", ink: "#241d18", letter: "#f2b67d" },
  { name: "ochre", paper: "#d1a64d", ink: "#2c2a21", letter: "#f2dba3" },
  { name: "sage", paper: "#9ba98a", ink: "#263127", letter: "#dce1c4" },
  { name: "blue", paper: "#8ca6b2", ink: "#1d2d35", letter: "#d1e0e4" },
  { name: "plum", paper: "#6d485c", ink: "#fff2e2", letter: "#b98a9d" },
  { name: "lavender", paper: "#b3a5bd", ink: "#302a39", letter: "#ded6e8" },
  { name: "clay", paper: "#c99078", ink: "#34271f", letter: "#edc6a5" },
  { name: "ink-blue", paper: "#394e63", ink: "#f7f0e4", letter: "#90a9b6" },
] as const;

export function bokCoverPalette(bokId: string) {
  let hash = 2166136261;
  for (const character of bokId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return bokCoverPalettes[(hash >>> 0) % bokCoverPalettes.length];
}

export function bokCoverStyle(bokId: string) {
  const palette = bokCoverPalette(bokId);
  return { "--bok-cover": palette.paper, "--bok-ink": palette.ink, "--bok-letter": palette.letter };
}
