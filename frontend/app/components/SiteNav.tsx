"use client";

import Link from "next/link";
import { useRef } from "react";
import BrandLogo from "./BrandLogo";
import { IconArrow } from "./Icons";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "#market-status", label: "Market hours" },
  { href: "#how", label: "How it works" },
  { href: "#risk", label: "Risk design" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "/docs", label: "Docs" },
];

export default function SiteNav({ docs = false }: { docs?: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const toggle = useRef<HTMLElement>(null);
  const linkHref = (href: string) => docs && href.startsWith("#") ? `/${href}` : href;

  return (
    <header className="nav">
      <nav className="wrap nav-inner" aria-label="Primary">
        <Link className="brand" href={docs ? "/" : "#top"} aria-label={docs ? "Blue Finance home" : "Blue Finance, back to top"}>
          <BrandLogo />
        </Link>
        <ul className="nav-links">
          {LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link href={linkHref(href)} aria-current={docs && href === "/docs" ? "page" : undefined}>{label}</Link>
            </li>
          ))}
        </ul>
        <div className="nav-actions">
          <ThemeToggle />
          <details
            className="mobile-nav"
            ref={menu}
            onKeyDown={(event) => {
              if (event.key === "Escape" && menu.current?.open) {
                menu.current.open = false;
                toggle.current?.focus();
              }
            }}
          >
            <summary ref={toggle} aria-label="Menu"><span className="nav-menu-label">Menu</span> <span className="menu-icon" aria-hidden="true" /></summary>
            <ul>
              {LINKS.map(({ href, label }) => (
                <li key={href}>
                  <Link href={linkHref(href)} aria-current={docs && href === "/docs" ? "page" : undefined} onClick={() => {
                    if (menu.current) menu.current.open = false;
                  }}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
          <Link className="btn launch-app" href="/app/dashboard">Launch App <IconArrow /></Link>
        </div>
      </nav>
    </header>
  );
}
