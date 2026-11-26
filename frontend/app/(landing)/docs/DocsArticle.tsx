import Link from "next/link";
import { IconArrow } from "../../components/Icons";
import { articles, docHref, sourceHref, type DocArticle } from "./content";

function TopicLinks({ current }: { current: DocArticle }) {
  return (
    <ul className="docs-topics">
      {articles.map((article) => (
        <li key={article.slug}>
          <Link href={docHref(article.slug)} aria-current={article.slug === current.slug ? "page" : undefined}>
            {article.slug ? article.title : "Overview"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function DocsArticle({ article }: { article: DocArticle }) {
  const index = articles.indexOf(article);
  const previous = articles[index - 1];
  const next = articles[index + 1];

  return (
    <div className="wrap docs-frame">
      <aside className="docs-sidebar">
        <nav className="docs-sidebar-desktop" aria-label="Documentation topics">
          <p className="docs-label">Topics</p>
          <TopicLinks current={article} />
        </nav>
        <details className="docs-sidebar-mobile" key={article.slug}>
          <summary>Browse topics</summary>
          <nav aria-label="Documentation topics"><TopicLinks current={article} /></nav>
        </details>
      </aside>

      <main className="docs-main" id="docs-main" tabIndex={-1}>
        <header className="docs-title">
          <h1>{article.title}</h1>
          <p>{article.summary}</p>
        </header>

        <div className="docs-prose">
          {article.sections.map((section) => (
            <section key={section.id} id={section.id}>
              <h2>{section.title}</h2>
              {section.body}
            </section>
          ))}
          <section id="sources">
            <h2>Source references</h2>
            <ul className="docs-sources">
              {article.sources.map((source) => (
                <li key={source.path}><a href={sourceHref(source.path)}>{source.title}</a></li>
              ))}
            </ul>
          </section>
        </div>

        <nav className="docs-pagination" aria-label="Adjacent articles">
          {previous && (
            <Link href={docHref(previous.slug)} rel="prev">
              <small>Previous</small>
              <span><IconArrow />{previous.slug ? previous.title : "Overview"}</span>
            </Link>
          )}
          {next && (
            <Link href={docHref(next.slug)} rel="next">
              <small>Next</small>
              <span>{next.title}<IconArrow /></span>
            </Link>
          )}
        </nav>
      </main>

      <nav className="docs-outline" aria-label="On this page">
        <p className="docs-label">On this page</p>
        <ul>
          {article.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}
          <li><a href="#sources">Source references</a></li>
        </ul>
      </nav>
    </div>
  );
}
