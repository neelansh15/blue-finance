import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const instrumentSans = localFont({
  src: "./fonts/instrument-sans.woff2",
  variable: "--font-instrument-sans",
  weight: "400 700",
  display: "swap",
});

const instrumentSerif = localFont({
  src: "./fonts/instrument-serif-italic.woff2",
  variable: "--font-instrument-serif",
  style: "italic",
  weight: "400",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: "Dawn Finance | Market-aware lending for tokenized stocks",
  description:
    "Dawn Finance is a draft lending protocol for tokenized US stocks on BNB Chain, built on unmodified Morpho Blue, with a risk layer that knows when the US market is open. Prototype for BNB Bangkok. Not live.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1530" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
