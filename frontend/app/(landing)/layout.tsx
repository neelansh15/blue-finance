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
  icons: { icon: "/assets/brand/blue-finance-mark.png", apple: "/assets/brand/blue-finance-mark.png" },
  title: "Blue Finance | Market-aware lending for tokenized stocks",
  description:
    "Blue Finance is a draft lending protocol for tokenized US stocks on BNB Chain: one Aave V3 pool with shared USDT liquidity, real bStock collateral and borrowing limits that follow US market hours. Prototype for BNB Bangkok. Not live.",
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
        <meta id="blue-theme-color" name="theme-color" content={THEME_COLORS.light} suppressHydrationWarning />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
