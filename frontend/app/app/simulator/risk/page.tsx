import type { Metadata } from "next";
import RiskWorkspace from "../../risk/RiskWorkspace";

export const metadata: Metadata = { title: "Advisory risk | Blue Finance" };
export default function RiskPage() { return <RiskWorkspace />; }
