"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandLogo from "../components/BrandLogo";
import ThemeToggle from "../components/ThemeToggle";
import WalletButton from "./WalletButton";

export default function AppNav() {
  const path = usePathname();

  return (
    <header className="nav">
      <nav className="wrap app-nav" aria-label="App navigation">
        <Link className="brand" href="/#top" aria-label="Blue Finance home">
          <BrandLogo />
        </Link>
        <div className="app-nav-links">
          <Link href="/app/simplified" aria-current={path === "/app/simplified" ? "page" : undefined}>Simplified</Link>
          <Link href="/app/dashboard" aria-current={path === "/app/dashboard" ? "page" : undefined}>Dashboard</Link>
          <Link href="/app/earn" aria-current={path === "/app/earn" ? "page" : undefined}>Earn</Link>
          <Link href="/app/borrow" aria-current={path === "/app/borrow" ? "page" : undefined}>Borrow</Link>
          <Link href="/app/risk" aria-current={path === "/app/risk" ? "page" : undefined}>Risk</Link>
        </div>
        <div className="app-nav-actions">
          <span className="app-demo-label app-nav-simulation">Simulation</span>
          <ThemeToggle />
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
