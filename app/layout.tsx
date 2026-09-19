import type { Metadata } from "next";
import "@fontsource-variable/source-serif-4/standard.css";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
