import type { Metadata } from "next";
import Link from "next/link";
import { IconLogo } from "../components/Icons";
import ThemeToggle from "../components/ThemeToggle";
import LendingApp from "./LendingApp";
import "./lending.css";

export const metadata: Metadata = {
  title: "Dawn Finance | Lending app",
  description: "Explore isolated stock-backed lending markets in the Dawn Finance prototype.",
};

export default function AppPage() {
  return (
    <div className="lending-app">
      <a className="skip" href="#app-main">Skip to content</a>
      <header className="nav">
        <nav className="wrap app-nav" aria-label="App navigation">
          <Link className="brand" href="/" aria-label="Dawn Finance home"><IconLogo /> Dawn Finance</Link>
          <div className="app-nav-actions">
            <span className="app-demo-label">Simulation</span>
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <LendingApp />
    </div>
  );
}
