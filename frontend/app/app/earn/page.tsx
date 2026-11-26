import type { Metadata } from "next";
import LiveApp from "../LiveApp";

export const metadata: Metadata = { title: "Earn with USDT | Blue Finance" };

export default function Page() {
  return <LiveApp view="earn" />;
}
