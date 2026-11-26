import { Suspense } from "react";
import type { Metadata } from "next";
import LendingApp from "../LendingApp";

export const metadata: Metadata = { title: "Earn | Dawn Finance" };

export default function EarnPage() {
  return <Suspense><LendingApp mode="earn" /></Suspense>;
}
