import type { ReactNode } from "react";
import SiteNav from "../../components/SiteNav";
import "./docs.css";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#docs-main">Skip to content</a>
      <SiteNav docs />
      {children}
    </>
  );
}
