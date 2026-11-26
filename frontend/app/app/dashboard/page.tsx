import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = { title: "Dashboard | Dawn Finance" };

export default function DashboardPage() {
  return <Dashboard />;
}
