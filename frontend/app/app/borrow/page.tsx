import type { Metadata } from "next";
import LiveApp from "../LiveApp";

export const metadata: Metadata = { title: "Borrow against stocks | Blue Finance" };

export default function Page() {
  return <LiveApp view="borrow" />;
}
