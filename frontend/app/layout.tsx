import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dawn Finance: lending for tokenized US stocks on BNB Chain (draft)",
  description:
    "Dawn Finance is a draft lending protocol for tokenized US stocks on BNB Chain, built on unmodified Morpho Blue, with a risk layer that knows when the US market is open. Prototype for BNB Bangkok. Not live.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111923" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
