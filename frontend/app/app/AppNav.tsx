"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconLogo } from "../components/Icons";
import ThemeToggle from "../components/ThemeToggle";

export default function AppNav() {
  const path = usePathname();

  return (
    <header className="nav">
      <nav className="wrap app-nav" aria-label="App navigation">
        <Link className="brand" href="/" aria-label="Dawn Finance home">
          <IconLogo /> <span>Dawn<span className="app-brand-wide"> Finance</span></span>
        </Link>
        <div className="app-nav-links">
          <Link href="/app/dashboard" aria-current={path === "/app/dashboard" ? "page" : undefined}>Dashboard</Link>
          <Link href="/app/earn" aria-current={path === "/app/earn" ? "page" : undefined}>Earn</Link>
          <Link href="/app/borrow" aria-current={path === "/app/borrow" ? "page" : undefined}>Borrow</Link>
        </div>
        <div className="app-nav-actions">
          <span className="app-demo-label app-nav-simulation">Simulation</span>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
