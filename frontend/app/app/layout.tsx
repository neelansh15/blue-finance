import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import AppNav from "./AppNav";
import { DemoAccountProvider } from "./DemoAccount";
import WalletProvider from "./WalletProvider";
import "../globals.css";
import "./lending.css";

const instrumentSans = localFont({
  src: "../fonts/instrument-sans.woff2",
  variable: "--font-instrument-sans",
  display: "swap",
});

const instrumentSerif = localFont({
  src: "../fonts/instrument-serif-italic.woff2",
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  icons: { icon: "/assets/brand/blue-finance-mark.png", apple: "/assets/brand/blue-finance-mark.png" },
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

export default function LendingLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <div className={`lending-app ${instrumentSans.variable} ${instrumentSerif.variable}`}>
            <a className="skip" href="#app-main">Skip to content</a>
            <AppNav />
            <DemoAccountProvider>{children}</DemoAccountProvider>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
