import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "boks",
  description:
    "A prototype literature feed for short stories, author posting, and reader engagement metrics.",
  other: {
    "product": "boks prototype",
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
