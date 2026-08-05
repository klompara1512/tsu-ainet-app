import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import "./News.css";

type NewsCategory =
  | "verein"
  | "kampfmannschaft"
  | "challenge"
  | "nachwuchs"
  | "veranstaltung";

type NewsArticle = {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: NewsCategory;
  imageUrl: string;
  authorName: string;
  published: boolean;
  featured: boolean;
  publishedAt: Date;
};

function News() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [selectedArticle, setSelectedArticle] =
    useState<NewsArticle | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<NewsCategory | "alle">("alle");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const newsQuery = query(
      collection(db, "news"),
      orderBy("publishedAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      newsQuery,
      (snapshot) => {
        const loadedArticles: NewsArticle[] = snapshot.docs
          .map((newsDocument) => {
            const data = newsDocument.data();

            return {
              id: newsDocument.id,

              title:
                typeof data.title === "string"
                  ? data.title
                  : "Neuigkeit",

              summary:
                typeof data.summary === "string"
                  ? data.summary
                  : "",

              content:
                typeof data.content === "string"
                  ? data.content
                  : "",

              category: isNewsCategory(data.category)
                ? data.category
                : "verein",

              imageUrl:
                typeof data.imageUrl === "string"
                  ? data.imageUrl
                  : "",

              authorName:
                typeof data.authorName === "string"
                  ? data.authorName
                  : "TSU Ainet",

              published:
                typeof data.published === "boolean"
                  ? data.published
                  : false,

              featured:
                typeof data.featured === "boolean"
                  ? data.featured
                  : false,

              publishedAt:
                data.publishedAt instanceof Timestamp
                  ? data.publishedAt.toDate()
                  : new Date(0),
            };
          })
          .filter(
            (article) =>
              article.published &&
              article.publishedAt.getTime() > 0,
          );

        setArticles(loadedArticles);
        setIsLoading(false);
        setErrorMessage("");
      },
      (error) => {
        console.error(
          "Fehler beim Laden der Vereinsnews:",
          error,
        );

        setErrorMessage(
          "Die Vereinsnews konnten nicht geladen werden.",
        );

        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const filteredArticles = useMemo(() => {
    if (selectedCategory === "alle") {
      return articles;
    }

    return articles.filter(
      (article) =>
        article.category === selectedCategory,
    );
  }, [articles, selectedCategory]);

  const featuredArticle = useMemo(() => {
    if (selectedCategory !== "alle") {
      return null;
    }

    return (
      articles.find((article) => article.featured) ??
      articles[0] ??
      null
    );
  }, [articles, selectedCategory]);

  const listArticles = useMemo(() => {
    if (!featuredArticle) {
      return filteredArticles;
    }

    return filteredArticles.filter(
      (article) => article.id !== featuredArticle.id,
    );
  }, [featuredArticle, filteredArticles]);

  function formatDate(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function getCategoryLabel(category: NewsCategory) {
    if (category === "kampfmannschaft") {
      return "Kampfmannschaft";
    }

    if (category === "challenge") {
      return "Challenge";
    }

    if (category === "nachwuchs") {
      return "Nachwuchs";
    }

    if (category === "veranstaltung") {
      return "Veranstaltung";
    }

    return "Verein";
  }

  if (selectedArticle) {
    return (
      <section className="news-page">
        <button
          type="button"
          className="news-back-button"
          onClick={() => setSelectedArticle(null)}
        >
          <span aria-hidden="true">‹</span>
          Zurück zu den News
        </button>

        <article className="news-detail">
          {selectedArticle.imageUrl && (
            <div className="news-detail-image-wrapper">
              <img
                src={selectedArticle.imageUrl}
                alt={selectedArticle.title}
                className="news-detail-image"
              />
            </div>
          )}

          <div className="news-detail-content">
            <div className="news-detail-meta">
              <span
                className={`news-category news-category-${selectedArticle.category}`}
              >
                {getCategoryLabel(
                  selectedArticle.category,
                )}
              </span>

              <span>
                {formatDate(
                  selectedArticle.publishedAt,
                )}
              </span>
            </div>

            <h1>{selectedArticle.title}</h1>

            {selectedArticle.summary && (
              <p className="news-detail-summary">
                {selectedArticle.summary}
              </p>
            )}

            <div className="news-detail-body">
              {selectedArticle.content
                .split("\n")
                .map((paragraph, index) => {
                  const trimmedParagraph =
                    paragraph.trim();

                  if (!trimmedParagraph) {
                    return null;
                  }

                  return (
                    <p key={`${index}-${trimmedParagraph}`}>
                      {trimmedParagraph}
                    </p>
                  );
                })}
            </div>

            <div className="news-detail-author">
              <span>Veröffentlicht von</span>
              <strong>
                {selectedArticle.authorName}
              </strong>
            </div>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="news-page">
      <header className="news-header">
        <div>
          <h1>Vereinsnews</h1>

        </div>

      </header>

      <nav
        className="news-filter"
        aria-label="News-Kategorien"
      >
        <button
          type="button"
          className={
            selectedCategory === "alle"
              ? "news-filter-button active"
              : "news-filter-button"
          }
          onClick={() => setSelectedCategory("alle")}
        >
          Alle
        </button>

        <button
          type="button"
          className={
            selectedCategory === "verein"
              ? "news-filter-button active"
              : "news-filter-button"
          }
          onClick={() =>
            setSelectedCategory("verein")
          }
        >
          Verein
        </button>

        <button
          type="button"
          className={
            selectedCategory === "kampfmannschaft"
              ? "news-filter-button active"
              : "news-filter-button"
          }
          onClick={() =>
            setSelectedCategory("kampfmannschaft")
          }
        >
          Kampfmannschaft
        </button>

        <button
          type="button"
          className={
            selectedCategory === "challenge"
              ? "news-filter-button active"
              : "news-filter-button"
          }
          onClick={() =>
            setSelectedCategory("challenge")
          }
        >
          Challenge
        </button>

        <button
          type="button"
          className={
            selectedCategory === "nachwuchs"
              ? "news-filter-button active"
              : "news-filter-button"
          }
          onClick={() =>
            setSelectedCategory("nachwuchs")
          }
        >
          Nachwuchs
        </button>

        <button
          type="button"
          className={
            selectedCategory === "veranstaltung"
              ? "news-filter-button active"
              : "news-filter-button"
          }
          onClick={() =>
            setSelectedCategory("veranstaltung")
          }
        >
          Veranstaltungen
        </button>
      </nav>

      {errorMessage && (
        <div className="news-message news-error">
          <strong>Firebase-Fehler</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {isLoading ? (
        <div className="news-loading">
          <span className="news-spinner" />

          <strong>News werden geladen</strong>

          <p>
            Die neuesten Vereinsmeldungen werden
            abgerufen.
          </p>
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="news-empty">
          <span className="news-empty-mark">N</span>

          <div>
            <strong>
              Noch keine News veröffentlicht
            </strong>

            <p>
              Sobald ein Beitrag veröffentlicht wird,
              erscheint er automatisch auf dieser Seite.
            </p>
          </div>
        </div>
      ) : (
        <>
          {featuredArticle && (
            <article className="news-featured">
              <button
                type="button"
                className="news-featured-button"
                onClick={() =>
                  setSelectedArticle(featuredArticle)
                }
              >
                <div className="news-featured-image">
                  {featuredArticle.imageUrl ? (
                    <img
                      src={featuredArticle.imageUrl}
                      alt={featuredArticle.title}
                    />
                  ) : (
                    <div className="news-image-placeholder">
                      <span>TSU</span>
                    </div>
                  )}

                  <span className="news-featured-label">
                    Topmeldung
                  </span>
                </div>

                <div className="news-featured-content">
                  <div className="news-article-meta">
                    <span
                      className={`news-category news-category-${featuredArticle.category}`}
                    >
                      {getCategoryLabel(
                        featuredArticle.category,
                      )}
                    </span>

                    <span>
                      {formatDate(
                        featuredArticle.publishedAt,
                      )}
                    </span>
                  </div>

                  <h2>{featuredArticle.title}</h2>

                  <p>
                    {featuredArticle.summary ||
                      featuredArticle.content}
                  </p>

                  <span className="news-read-more">
                    Beitrag lesen
                    <span aria-hidden="true">›</span>
                  </span>
                </div>
              </button>
            </article>
          )}

          {listArticles.length > 0 && (
            <div className="news-list">
              {listArticles.map((article) => (
                <article
                  key={article.id}
                  className="news-card"
                >
                  <button
                    type="button"
                    className="news-card-button"
                    onClick={() =>
                      setSelectedArticle(article)
                    }
                  >
                    <div className="news-card-image">
                      {article.imageUrl ? (
                        <img
                          src={article.imageUrl}
                          alt={article.title}
                        />
                      ) : (
                        <div className="news-image-placeholder">
                          <span>TSU</span>
                        </div>
                      )}
                    </div>

                    <div className="news-card-content">
                      <div className="news-article-meta">
                        <span
                          className={`news-category news-category-${article.category}`}
                        >
                          {getCategoryLabel(
                            article.category,
                          )}
                        </span>

                        <span>
                          {formatDate(
                            article.publishedAt,
                          )}
                        </span>
                      </div>

                      <h2>{article.title}</h2>

                      <p>
                        {article.summary ||
                          article.content}
                      </p>

                      <span className="news-read-more">
                        Weiterlesen
                        <span aria-hidden="true">›</span>
                      </span>
                    </div>
                  </button>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function isNewsCategory(
  value: unknown,
): value is NewsCategory {
  return (
    value === "verein" ||
    value === "kampfmannschaft" ||
    value === "challenge" ||
    value === "nachwuchs" ||
    value === "veranstaltung"
  );
}

export default News;