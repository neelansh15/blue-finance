import type { Metadata } from "next";
import SimplifiedFlow from "../../simplified/SimplifiedFlow";
import "../../simplified/simplified.css";

export const metadata: Metadata = { title: "Simplified Mode | Blue Finance" };

export default function SimplifiedPage() {
  return <SimplifiedFlow />;
}
