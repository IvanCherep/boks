/**
 * A link preview's video, beside its still `og:image`: Telegram and a few
 * others play it, every other network keeps the picture. Written as tags
 * because the metadata API of this build drops `og:video:type` and
 * `og:video:secure_url`, which Telegram and Facebook need. In order, the
 * details right after `og:video`; React hoists them into the head.
 */
export function OgVideo({ url, width, height }: { url: string; width: number; height: number }) {
  return (
    <>
      <meta property="og:video" content={url} />
      <meta property="og:video:secure_url" content={url} />
      <meta property="og:video:type" content="video/mp4" />
      <meta property="og:video:width" content={String(width)} />
      <meta property="og:video:height" content={String(height)} />
    </>
  );
}
