import type { Metadata } from "next";
import DocsArticle from "./DocsArticle";
import { articles } from "./content";

const overview = articles[0];

export const metadata: Metadata = {
  title: "Docs | Dawn Finance",
  description: overview.summary,
};

export default function DocsPage() {
  return <DocsArticle article={overview} />;
}
