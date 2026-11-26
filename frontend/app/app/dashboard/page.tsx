import type { Metadata } from "next";
import LiveApp from "../LiveApp";

export const metadata: Metadata = { title: "Dashboard | Blue Finance" };

export default function Page() {
  return <LiveApp view="dashboard" />;
}
