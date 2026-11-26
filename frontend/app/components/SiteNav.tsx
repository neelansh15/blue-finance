"use client";

import Link from "next/link";
import { useRef } from "react";
import { IconArrow, IconLogo } from "./Icons";
import ThemeToggle from "./ThemeToggle";

const LINKS = [
  { href: "#regimes", label: "Simulator" },
  { href: "#how", label: "How it works" },
  { href: "#risk", label: "Risk design" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#docs", label: "Docs" },
];

export default function SiteNav() {
  const menu = useRef<HTMLDetailsElement>(null);
  const toggle = useRef<HTMLElement>(null);

  return (
    <header className="nav">
      <nav className="wrap nav-inner" aria-label="Primary">
        <a className="brand" href="#top" aria-label="Dawn Finance, back to top">
          <IconLogo />
          <span>Dawn<span className="brand-wide"> Finance</span></span>
        </a>
        <ul className="nav-links">
          {LINKS.map(({ href, label }) => <li key={href}><a href={href}>{label}</a></li>)}
        </ul>
        <div className="nav-actions">
          <span className="nav-status"><span className="nav-status-prefix">Prototype · </span>Not live</span>
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
                  <a href={href} onClick={() => {
                    if (menu.current) menu.current.open = false;
                  }}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <Link className="btn launch-app" href="/app">Launch App <IconArrow /></Link>
        </div>
      </nav>
    </header>
  );
}
