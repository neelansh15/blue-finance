import type { Metadata } from "next";
import LiveApp from "../LiveApp";

export const metadata: Metadata = { title: "Simplified Mode | Blue Finance" };

export default function Page() {
  return <LiveApp view="simplified" />;
}
