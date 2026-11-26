import type { ReactNode } from "react";
import AppNav from "./AppNav";
import { DemoAccountProvider } from "./DemoAccount";
import "./lending.css";

export default function LendingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lending-app">
      <a className="skip" href="#app-main">Skip to content</a>
      <AppNav />
      <DemoAccountProvider>{children}</DemoAccountProvider>
    </div>
  );
}
