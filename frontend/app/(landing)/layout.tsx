import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./blueprint.css";
import { THEME_COLORS, themeInitScript } from "../theme";

const instrumentSans = localFont({
  src: "../fonts/instrument-sans.woff2",
  variable: "--font-instrument-sans",
  weight: "400 700",
  display: "swap",
});

const instrumentSerif = localFont({
  src: "../fonts/instrument-serif-italic.woff2",
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${instrumentSans.variable} ${instrumentSerif.variable}`}>
      <head>
        <meta id="dawn-theme-color" name="theme-color" content={THEME_COLORS.light} suppressHydrationWarning />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
