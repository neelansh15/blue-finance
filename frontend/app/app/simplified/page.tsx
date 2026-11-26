import type { Metadata } from "next";
import LiveSimplified from "./LiveSimplified";
import "./simplified.css";

export const metadata: Metadata = { title: "Simplified Mode | Blue Finance" };

export default function Page() {
  return <LiveSimplified />;
}
