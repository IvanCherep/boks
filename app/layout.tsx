import type { Metadata, Viewport } from "next";
import "@fontsource-variable/source-serif-4/standard.css";
// A high-contrast display serif, used only where a word is part of a
// picture rather than part of a paragraph. See `--font-display`.
import "@fontsource-variable/playfair-display/wght.css";
import "./globals.css";
import { themeBootScript, themeColor } from "@/components/boks/theme";

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
   * it, since iPhone Safari gives a page no fullscreen. `default` keeps the
   * status bar opaque, so nothing has to be pushed down from under it; its
   * colour follows `theme-color`, which a player repaints while it is open.
   */
  appleWebApp: {
    capable: true,
    title: "boks",
    statusBarStyle: "default",
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
    // The theme script below sets `data-theme` before React hydrates, so the
    // attribute legitimately differs from the server's markup.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={themeColor.light} />
        {/* Before first paint: a reader in dark mode never sees a white flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
