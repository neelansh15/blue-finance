import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DocsArticle from "../DocsArticle";
import { articles } from "../content";

type Props = { params: Promise<{ topic: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return articles.filter(({ slug }) => slug).map(({ slug }) => ({ topic: slug }));
}

async function getArticle(params: Props["params"]) {
  const { topic } = await params;
  const article = articles.find(({ slug }) => slug === topic);
  if (!article) notFound();
  return article;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getArticle(params);
  return { title: `${article.title} | Dawn Finance Docs`, description: article.summary };
}

export default async function TopicPage({ params }: Props) {
  return <DocsArticle article={await getArticle(params)} />;
}
