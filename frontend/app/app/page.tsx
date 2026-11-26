import type { Metadata } from "next";
import LiveApp from "./LiveApp";

export const metadata: Metadata = {
  title: "Blue Finance on BNB Smart Chain",
  description: "Read and interact with the Blue Finance hackathon pool on BNB Smart Chain.",
};

export default function AppPage() {
  return <LiveApp />;
}
