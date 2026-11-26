import type { Metadata } from "next";
import DemoApp from "../components/DemoApp";

export const metadata: Metadata = {
  title: "Blue Finance simulator",
  description: "Demo UI for the Blue Finance draft. Runs on mocked data. Not live, no transactions are sent.",
};

export default function AppPage() {
  return <DemoApp />;
}
