import type { Metadata } from "next";
import SimplifiedFlow from "./SimplifiedFlow";
import "./simplified.css";

export const metadata: Metadata = { title: "Simplified Mode | Blue Finance" };

export default function SimplifiedPage() {
  return <SimplifiedFlow />;
}
