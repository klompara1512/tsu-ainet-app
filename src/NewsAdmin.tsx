import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import "./NewsAdmin.css";

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

type NewsForm = {
  title: string;
  summary: string;
  content: string;
  category: NewsCategory;
  imageUrl: string;
  authorName: string;
  published: boolean;
  featured: boolean;
  publishedAt: string;
};

type NewsAdminProps = {
  onBack: () => void;
};

function createDateTimeValue(date = new Date()) {
  const adjustedDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000,
  );

  return adjustedDate.toISOString().slice(0, 16);
}

const emptyForm: NewsForm = {
  title: "",
  summary: "",
  content: "",
  category: "verein",
  imageUrl: "",
  authorName: "TSU Ainet Fußball",
  published: true,
  featured: false,
  publishedAt: createDateTimeValue(),
};

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

function NewsAdmin({ onBack }: NewsAdminProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [formData, setFormData] =
    useState<NewsForm>(emptyForm);
  const [editingArticleId, setEditingArticleId] =
    useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const newsQuery = query(
      collection(db, "news"),
      orderBy("publishedAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      newsQuery,
      (snapshot) => {
        const loadedArticles: NewsArticle[] =
          snapshot.docs.map((newsDocument) => {
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
                  : "TSU Ainet Fußball",
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
                  : new Date(),
            };
          });

        setArticles(loadedArticles);
        setIsLoading(false);
        setErrorMessage("");
      },
      (error) => {
        console.error("Fehler beim Laden der News:", error);

        setErrorMessage(
          "Die News konnten nicht geladen werden.",
        );
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const publishedCount = useMemo(() => {
    return articles.filter((article) => article.published)
      .length;
  }, [articles]);

  const featuredArticle = useMemo(() => {
    return (
      articles.find((article) => article.featured) ?? null
    );
  }, [articles]);

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function resetForm() {
    setEditingArticleId(null);
    setFormData({
      ...emptyForm,
      publishedAt: createDateTimeValue(),
    });
  }

  function formatDate(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function startEditing(article: NewsArticle) {
    setEditingArticleId(article.id);

    setFormData({
      title: article.title,
      summary: article.summary,
      content: article.content,
      category: article.category,
      imageUrl: article.imageUrl,
      authorName: article.authorName,
      published: article.published,
      featured: article.featured,
      publishedAt: createDateTimeValue(
        article.publishedAt,
      ),
    });

    clearMessages();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveArticle(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    clearMessages();

    const title = formData.title.trim();
    const summary = formData.summary.trim();
    const content = formData.content.trim();
    const authorName = formData.authorName.trim();
    const publicationDate = new Date(
      formData.publishedAt,
    );

    if (!title) {
      setErrorMessage("Bitte gib einen Titel ein.");
      return;
    }

    if (!summary) {
      setErrorMessage(
        "Bitte gib eine kurze Zusammenfassung ein.",
      );
      return;
    }

    if (!content) {
      setErrorMessage(
        "Bitte gib den vollständigen Beitrag ein.",
      );
      return;
    }

    if (!authorName) {
      setErrorMessage("Bitte gib einen Autor ein.");
      return;
    }

    if (Number.isNaN(publicationDate.getTime())) {
      setErrorMessage(
        "Bitte gib ein gültiges Veröffentlichungsdatum ein.",
      );
      return;
    }

    setIsSaving(true);

    const articleData = {
      title,
      summary,
      content,
      category: formData.category,
      imageUrl: formData.imageUrl.trim(),
      authorName,
      published: formData.published,
      featured: formData.featured,
      publishedAt: Timestamp.fromDate(publicationDate),
      updatedAt: serverTimestamp(),
    };

    try {
      if (formData.featured) {
        const featuredArticles = articles.filter(
          (article) =>
            article.featured &&
            article.id !== editingArticleId,
        );

        await Promise.all(
          featuredArticles.map((article) =>
            updateDoc(doc(db, "news", article.id), {
              featured: false,
              updatedAt: serverTimestamp(),
            }),
          ),
        );
      }

      if (editingArticleId) {
        await updateDoc(
          doc(db, "news", editingArticleId),
          articleData,
        );

        setSuccessMessage(
          "Der Newsbeitrag wurde aktualisiert.",
        );
      } else {
        await addDoc(collection(db, "news"), {
          ...articleData,
          createdAt: serverTimestamp(),
        });

        setSuccessMessage(
          "Der Newsbeitrag wurde erstellt.",
        );
      }

      resetForm();
    } catch (error) {
      console.error(
        "Fehler beim Speichern des Newsbeitrags:",
        error,
      );

      setErrorMessage(
        "Der Newsbeitrag konnte nicht gespeichert werden. Prüfe bitte die Firestore-Regeln.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePublished(article: NewsArticle) {
    clearMessages();

    try {
      await updateDoc(doc(db, "news", article.id), {
        published: !article.published,
        updatedAt: serverTimestamp(),
      });

      setSuccessMessage(
        article.published
          ? "Der Beitrag wurde ausgeblendet."
          : "Der Beitrag wurde veröffentlicht.",
      );
    } catch (error) {
      console.error(
        "Fehler beim Ändern der Sichtbarkeit:",
        error,
      );

      setErrorMessage(
        "Die Sichtbarkeit konnte nicht geändert werden.",
      );
    }
  }

  async function setAsFeatured(article: NewsArticle) {
    clearMessages();

    try {
      await Promise.all(
        articles.map((currentArticle) =>
          updateDoc(
            doc(db, "news", currentArticle.id),
            {
              featured:
                currentArticle.id === article.id
                  ? !article.featured
                  : false,
              updatedAt: serverTimestamp(),
            },
          ),
        ),
      );

      setSuccessMessage(
        article.featured
          ? "Die Topmeldung wurde entfernt."
          : "Der Beitrag ist jetzt die Topmeldung.",
      );
    } catch (error) {
      console.error(
        "Fehler beim Festlegen der Topmeldung:",
        error,
      );

      setErrorMessage(
        "Die Topmeldung konnte nicht geändert werden.",
      );
    }
  }

  async function removeArticle(article: NewsArticle) {
    const confirmed = window.confirm(
      `Soll „${article.title}“ wirklich gelöscht werden?`,
    );

    if (!confirmed) {
      return;
    }

    clearMessages();

    try {
      await deleteDoc(doc(db, "news", article.id));

      if (editingArticleId === article.id) {
        resetForm();
      }

      setSuccessMessage(
        "Der Newsbeitrag wurde gelöscht.",
      );
    } catch (error) {
      console.error(
        "Fehler beim Löschen des Newsbeitrags:",
        error,
      );

      setErrorMessage(
        "Der Newsbeitrag konnte nicht gelöscht werden.",
      );
    }
  }

  return (
    <section className="news-admin-page">
      <button
        type="button"
        className="news-admin-back"
        onClick={onBack}
      >
        <span aria-hidden="true">‹</span>
        Mehr
      </button>

      <header className="news-admin-header">
        <div>
          <p className="news-admin-eyebrow">
            TSU Ainet Fußball
          </p>

          <h2>Newsverwaltung</h2>

          <p>
            Vereinsnews erstellen, bearbeiten und
            veröffentlichen.
          </p>
        </div>

        <span className="news-admin-badge">
          {publishedCount} veröffentlicht
        </span>
      </header>

      {errorMessage && (
        <div className="news-admin-message news-admin-error">
          <strong>Fehler</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {successMessage && (
        <div className="news-admin-message news-admin-success">
          <strong>Erfolgreich</strong>
          <p>{successMessage}</p>
        </div>
      )}

      <div className="news-admin-summary">
        <article>
          <span>Beiträge gesamt</span>
          <strong>{articles.length}</strong>
        </article>

        <article>
          <span>Veröffentlicht</span>
          <strong>{publishedCount}</strong>
        </article>

        <article>
          <span>Topmeldung</span>
          <strong>
            {featuredArticle
              ? featuredArticle.title
              : "Keine"}
          </strong>
        </article>
      </div>

      <div className="news-admin-layout">
        <form
          className="news-admin-form"
          onSubmit={saveArticle}
        >
          <div className="news-admin-card-header">
            <div>
              <p className="news-admin-eyebrow">
                {editingArticleId
                  ? "Beitrag bearbeiten"
                  : "Neuer Beitrag"}
              </p>

              <h3>Newsbeitrag</h3>
            </div>

            {editingArticleId && (
              <button
                type="button"
                className="news-admin-text-button"
                onClick={resetForm}
              >
                Abbrechen
              </button>
            )}
          </div>

          <div className="news-admin-form-grid">
            <label className="news-admin-field news-admin-wide">
              <span>Titel</span>

              <input
                type="text"
                value={formData.title}
                placeholder="Titel des Newsbeitrags"
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>

            <label className="news-admin-field">
              <span>Kategorie</span>

              <select
                value={formData.category}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    category:
                      event.target.value as NewsCategory,
                  }))
                }
              >
                <option value="verein">Verein</option>
                <option value="kampfmannschaft">
                  Kampfmannschaft
                </option>
                <option value="challenge">
                  Challenge
                </option>
                <option value="nachwuchs">
                  Nachwuchs
                </option>
                <option value="veranstaltung">
                  Veranstaltung
                </option>
              </select>
            </label>

            <label className="news-admin-field">
              <span>Veröffentlichung</span>

              <input
                type="datetime-local"
                value={formData.publishedAt}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    publishedAt: event.target.value,
                  }))
                }
              />
            </label>

            <label className="news-admin-field news-admin-wide">
              <span>Zusammenfassung</span>

              <textarea
                className="news-admin-summary-input"
                value={formData.summary}
                placeholder="Kurze Vorschau für die Newsübersicht"
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    summary: event.target.value,
                  }))
                }
              />
            </label>

            <label className="news-admin-field news-admin-wide">
              <span>Beitrag</span>

              <textarea
                className="news-admin-content-input"
                value={formData.content}
                placeholder="Vollständiger Text des Newsbeitrags"
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
              />
            </label>

            <label className="news-admin-field">
              <span>Autor</span>

              <input
                type="text"
                value={formData.authorName}
                placeholder="TSU Ainet Fußball"
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    authorName: event.target.value,
                  }))
                }
              />
            </label>

            <label className="news-admin-field">
              <span>Bild-URL</span>

              <input
                type="url"
                value={formData.imageUrl}
                placeholder="https://..."
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    imageUrl: event.target.value,
                  }))
                }
              />
            </label>

            {formData.imageUrl && (
              <div className="news-admin-image-preview news-admin-wide">
                <img
                  src={formData.imageUrl}
                  alt="Vorschau"
                />
              </div>
            )}

            <label className="news-admin-checkbox">
              <input
                type="checkbox"
                checked={formData.published}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    published: event.target.checked,
                  }))
                }
              />

              <span>
                <strong>Veröffentlicht</strong>
                <small>
                  Beitrag öffentlich anzeigen
                </small>
              </span>
            </label>

            <label className="news-admin-checkbox">
              <input
                type="checkbox"
                checked={formData.featured}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    featured: event.target.checked,
                  }))
                }
              />

              <span>
                <strong>Topmeldung</strong>
                <small>
                  Auf der Newsseite hervorheben
                </small>
              </span>
            </label>
          </div>

          <button
            type="submit"
            className="news-admin-save"
            disabled={isSaving}
          >
            {isSaving
              ? "Wird gespeichert …"
              : editingArticleId
                ? "Änderungen speichern"
                : "Newsbeitrag erstellen"}
          </button>
        </form>

        <article className="news-admin-list-card">
          <div className="news-admin-card-header">
            <div>
              <p className="news-admin-eyebrow">
                Firebase
              </p>

              <h3>Alle Beiträge</h3>
            </div>

            <span className="news-admin-count">
              {articles.length}
            </span>
          </div>

          {isLoading && (
            <div className="news-admin-empty">
              <p>Beiträge werden geladen …</p>
            </div>
          )}

          {!isLoading && articles.length === 0 && (
            <div className="news-admin-empty">
              <strong>Noch keine News</strong>

              <p>
                Erstelle über das Formular den ersten
                Newsbeitrag.
              </p>
            </div>
          )}

          {!isLoading && articles.length > 0 && (
            <div className="news-admin-list">
              {articles.map((article) => (
                <div
                  key={article.id}
                  className={`news-admin-row ${
                    article.published ? "" : "inactive"
                  }`}
                >
                  <div className="news-admin-row-image">
                    {article.imageUrl ? (
                      <img
                        src={article.imageUrl}
                        alt=""
                      />
                    ) : (
                      <span>N</span>
                    )}
                  </div>

                  <div className="news-admin-info">
                    <div className="news-admin-row-meta">
                      <span>
                        {getCategoryLabel(
                          article.category,
                        )}
                      </span>

                      {article.featured && (
                        <strong>Topmeldung</strong>
                      )}
                    </div>

                    <h4>{article.title}</h4>

                    <p>
                      {formatDate(article.publishedAt)}
                      {" · "}
                      {article.published
                        ? "Veröffentlicht"
                        : "Entwurf"}
                    </p>
                  </div>

                  <div className="news-admin-actions">
                    <button
                      type="button"
                      onClick={() =>
                        startEditing(article)
                      }
                    >
                      Bearbeiten
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        togglePublished(article)
                      }
                    >
                      {article.published
                        ? "Ausblenden"
                        : "Veröffentlichen"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setAsFeatured(article)
                      }
                    >
                      {article.featured
                        ? "Topmeldung entfernen"
                        : "Als Topmeldung"}
                    </button>

                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        removeArticle(article)
                      }
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

export default NewsAdmin;