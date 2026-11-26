"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandLogo from "../components/BrandLogo";
import ThemeToggle from "../components/ThemeToggle";
import WalletButton from "./WalletButton";

export default function AppNav() {
  const path = usePathname();
  const simulator = path.startsWith("/app/simulator");
  const preview = simulator || path.startsWith("/app/research");
  const base = simulator ? "/app/simulator" : "/app";
  const overview = path === base || path === `${base}/dashboard`;

  return (
    <header className="nav">
      <nav className="wrap app-nav" aria-label="App navigation">
        <Link className="brand" href="/#top" aria-label="Blue Finance home">
          <BrandLogo />
        </Link>
        <div className="app-nav-links">
          <Link href={base} aria-current={overview ? "page" : undefined}>Overview</Link>
          <Link href={`${base}/earn`} aria-current={path === `${base}/earn` ? "page" : undefined}>Earn</Link>
          <Link href={`${base}/borrow`} aria-current={path === `${base}/borrow` ? "page" : undefined}>Borrow</Link>
        </div>
        <div className="app-nav-actions">
          <span className="app-demo-label app-nav-simulation">{preview ? "Simulation" : "BNB Mainnet"}</span>
          <ThemeToggle />
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
