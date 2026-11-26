import type { Metadata } from "next";
import LiveApp from "../LiveApp";

export const metadata: Metadata = { title: "Pool risk | Blue Finance" };

export default function Page() {
  return <LiveApp view="risk" />;
}
