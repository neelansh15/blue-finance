import type { Metadata } from "next";
import DemoApp from "./components/DemoApp";

export const metadata: Metadata = {
  title: "Dawn Finance demo app (mock data)",
  description: "Demo UI for the Dawn Finance draft. Runs on mocked data. Not live, no transactions are sent.",
};

export default function AppPage() {
  return <DemoApp />;
}
