import { Suspense } from "react";
import type { Metadata } from "next";
import LendingApp from "../LendingApp";

export const metadata: Metadata = { title: "Borrow | Dawn Finance" };

export default function BorrowPage() {
  return <Suspense><LendingApp mode="borrow" /></Suspense>;
}
