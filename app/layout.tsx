import type { Metadata, Viewport } from "next";
import "@fontsource-variable/source-serif-4/standard.css";
import "@fontsource-variable/source-serif-4/standard-italic.css";
// A high-contrast display serif, used only where a word is part of a
// picture rather than part of a paragraph. See `--font-display`.
import "@fontsource-variable/playfair-display/wght.css";
import "./globals.css";
import "./v44-fonts.css";
import "./reader-v44.css";
import "./formats-v44.css";
import "./social-v44.css";
import "./author-v49.css";
import "./admin-v44.css";
import { themeBootScript, browserStatusBarColor } from "@/components/boks/theme";
import { uiLanguageBootScript } from "@/lib/i18n/ui-language";
import { staleReleaseBootScript } from "@/lib/boks/stale-release";

/**
 * The canonical origin, and the reason it is written down.
 *
 * Open Graph needs absolute URLs - a messenger fetching a shared link has no
 * page to resolve `/og-cover.png` against - and `metadataBase` is what turns
 * every relative path below into one. `read.tryboks.workers.dev` serves the
 * same Worker, and a link shared from there still previews with tryboks.com
 * images, which is right: that host is a fallback, not the brand.
 */
export const boksOrigin = "https://tryboks.com";

const boksDescription = "Short literature, one focused read at a time.";

export const metadata: Metadata = {
  metadataBase: new URL(boksOrigin),
  title: "boks",
  description: boksDescription,
  applicationName: "boks",
  other: {
    "product": "boks",
  },
  manifest: "/manifest.webmanifest",
  /**
   * Opened from the home screen, boks is an app with no browser around it -
   * the only way an iPhone reader gets a poem without an address bar under
   * it, since iPhone Safari gives a page no fullscreen. `black` keeps the
   * status bar opaque and black, with the content below it. The lower edge
   * follows the interface theme independently.
   */
  appleWebApp: {
    capable: true,
    title: "boks",
    statusBarStyle: "black",
  },
  /**
   * PNGs, not the SVG that used to be here: a wordmark stacked in three rows is
   * unreadable at 16 px in any format, and these are rendered from the master
   * rather than scaled by the browser. The `.ico` is for the browsers that
   * still ask for one - Yandex Browser among them, which is what our first
   * reported reader uses.
   */
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "boks",
    title: "boks",
    description: boksDescription,
    url: boksOrigin,
    locale: "en_US",
    images: [{ url: "/og-cover.png", width: 1200, height: 630, alt: "boks" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "boks",
    description: boksDescription,
    images: ["/og-cover.png"],
  },
};

/**
 * `cover`: a home-screen boks reaches the bottom edge rather than stopping
 * short of the home indicator. Every bar pinned to the bottom already adds
 * `env(safe-area-inset-bottom)`, which is zero until this is set.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The boot scripts below set `data-theme` and `lang` before React
    // hydrates, so the attributes legitimately differ from the server's markup.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={browserStatusBarColor} />
        {/* Before first paint: a reader in dark mode never sees a white flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* `<html lang>` follows the interface language: the device's, or the reader's choice. */}
        <script dangerouslySetInnerHTML={{ __html: uiLanguageBootScript }} />
        {/* A tab older than the last release reloads instead of breaking (lib/boks/stale-release.ts). */}
        <script dangerouslySetInnerHTML={{ __html: staleReleaseBootScript }} />
      </head>
      <body className="antialiased">
        {children}
        {/* Real, fixed edge surfaces let Safari sample each native bar separately. */}
        <div className="browser-edge browser-edge--top" aria-hidden="true" />
        <div className="browser-edge browser-edge--bottom browser-edge--light" aria-hidden="true" />
        <div className="browser-edge browser-edge--bottom browser-edge--dark" aria-hidden="true" />
      </body>
    </html>
  );
}
