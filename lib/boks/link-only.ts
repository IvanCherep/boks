/**
 * Link-only pieces (`docs/link-only-pieces.md`).
 *
 * A piece reached only by its link: not a bok, not in the catalogue, not in
 * this repository. Its files sit in the `link-only` storage bucket under a
 * folder named by a random token, and `/l/<token>` plays them. The repository
 * holds no token and no list of pieces - knowing the link is the only way in.
 */

/** At least 128 bits of base64url: `secrets.token_urlsafe(16)` gives 22 characters. */
const tokenPattern = /^[A-Za-z0-9_-]{22,64}$/;

/**
 * The files a piece may have, flat in its folder. Anything else is refused
 * before a request leaves the Worker, so a token cannot be used to read past
 * its own folder.
 */
const filePattern = /^[a-z0-9][a-z0-9-]{0,80}\.(json|mp3|webp|jpg)$/;

const contentTypes: Record<string, string> = {
  json: "application/json; charset=utf-8",
  mp3: "audio/mpeg",
  webp: "image/webp",
  // A link preview: messengers take a JPEG everywhere, WebP not.
  jpg: "image/jpeg",
};

export const linkOnlyBucket = "link-only";

export function isLinkOnlyToken(token: string) {
  return tokenPattern.test(token);
}

export function isLinkOnlyFile(file: string) {
  return filePattern.test(file);
}

export function linkOnlyContentType(file: string) {
  return contentTypes[file.split(".").pop() ?? ""] ?? "application/octet-stream";
}

/** Where the Worker reads a file from. Null for anything outside the two patterns. */
export function linkOnlyStorageUrl(supabaseUrl: string, token: string, file: string) {
  if (!isLinkOnlyToken(token) || !isLinkOnlyFile(file)) return null;
  // Self-hosted: the bucket is S3-compatible object storage, not Supabase
  // Storage. BOKS_LINK_ONLY_BASE_URL points at the folder that holds the
  // token folders, e.g. https://<bucket>.s3.<region>.storage.selcloud.ru/link-only.
  const base = globalThis.process?.env?.BOKS_LINK_ONLY_BASE_URL;
  if (base) return `${base.replace(/\/+$/, "")}/${token}/${file}`;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${linkOnlyBucket}/${token}/${file}`;
}

/** Where the browser reads it from: the same origin, through the Worker. */
export function linkOnlyFilePath(token: string, file: string) {
  return `/l/${token}/f/${file}`;
}
