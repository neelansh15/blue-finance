import type { Metadata } from "next";
import RiskWorkspace from "./RiskWorkspace";

export const metadata: Metadata = { title: "Advisory risk | Dawn Finance" };
export default function RiskPage() { return <RiskWorkspace />; }
