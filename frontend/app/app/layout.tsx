import type { ReactNode } from "react";
import localFont from "next/font/local";
import AppNav from "./AppNav";
import { DemoAccountProvider } from "./DemoAccount";
import WalletProvider from "./WalletProvider";
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

export default function LendingLayout({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <div className={`lending-app ${instrumentSans.variable} ${instrumentSerif.variable}`}>
        <a className="skip" href="#app-main">Skip to content</a>
        <AppNav />
        <DemoAccountProvider>{children}</DemoAccountProvider>
      </div>
    </WalletProvider>
  );
}
