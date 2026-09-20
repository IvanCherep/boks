import type { Metadata } from "next";
import "@fontsource-variable/source-serif-4/standard.css";
import "./globals.css";
import { themeBootScript, themeColor } from "@/components/boks/theme";

export const metadata: Metadata = {
  title: "boks",
  description:
    "Short literature, one focused read at a time.",
  other: {
    "product": "boks",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
