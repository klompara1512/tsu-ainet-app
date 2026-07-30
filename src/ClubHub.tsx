import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, type DocumentData } from "firebase/firestore";
import { db } from "./firebase";
import "./ClubHub.css";

type Item = { id: string; [key: string]: unknown };
type Section = "tasks" | "services" | "documents" | "sponsors";

const labels: Record<Section, string> = {
  tasks: "Aufgaben",
  services: "Dienste",
  documents: "Dokumente",
  sponsors: "Sponsoren",
};

function mapDocs(docs: { id: string; data: () => DocumentData }[]): Item[] {
  return docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function ClubHub() {
  const [active, setActive] = useState<Section>("tasks");
  const [data, setData] = useState<Record<Section, Item[]>>({
    tasks: [], services: [], documents: [], sponsors: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sections: Section[] = ["tasks", "services", "documents", "sponsors"];
    const unsubscribers = sections.map((section) => {
      const source = query(collection(db, section), orderBy("createdAt", "desc"));
      return onSnapshot(source, (snapshot) => {
        setData((current) => ({ ...current, [section]: mapDocs(snapshot.docs) }));
        setLoading(false);
      }, () => {
        setData((current) => ({ ...current, [section]: [] }));
        setLoading(false);
      });
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const rows = useMemo(() => data[active], [active, data]);

  return (
    <section className="club-hub dashboard-page">
      <p className="home-eyebrow">TSU Ainet intern</p>
      <h2>Vereinsbereich</h2>
      <p>Aufgaben, Dienste, Dokumente und Partner an einem Ort.</p>

      <nav className="club-hub-tabs" aria-label="Vereinsbereich">
        {(Object.keys(labels) as Section[]).map((section) => (
          <button key={section} className={active === section ? "active" : ""} onClick={() => setActive(section)}>
            {labels[section]}
            <span>{data[section].length}</span>
          </button>
        ))}
      </nav>

      <div className="club-hub-list">
        {loading && <div className="club-hub-empty">Vereinsdaten werden geladen …</div>}
        {!loading && rows.length === 0 && <div className="club-hub-empty">Noch keine Einträge vorhanden.</div>}

        {active === "tasks" && rows.map((row) => (
          <article key={row.id} className="club-hub-card">
            <div><small>Aufgabe</small><strong>{text(row.title) || "Ohne Bezeichnung"}</strong></div>
            <p>{text(row.assignedTo) ? `Zuständig: ${text(row.assignedTo)}` : "Noch niemand zugewiesen"}</p>
            <div className="club-hub-meta"><span>{text(row.dueDate) || "Kein Fälligkeitsdatum"}</span><b className={row.status === "done" ? "done" : "open"}>{row.status === "done" ? "Erledigt" : "Offen"}</b></div>
          </article>
        ))}

        {active === "services" && rows.map((row) => (
          <article key={row.id} className="club-hub-card">
            <div><small>Dienst</small><strong>{text(row.title) || "Ohne Bezeichnung"}</strong></div>
            <p>{text(row.assignedTo) || "Noch niemand eingeteilt"}</p>
            <div className="club-hub-meta"><span>{[text(row.date), text(row.time)].filter(Boolean).join(" · ") || "Termin offen"}</span></div>
          </article>
        ))}

        {active === "documents" && rows.map((row) => (
          <a key={row.id} className="club-hub-card link" href={text(row.url)} target="_blank" rel="noreferrer">
            <div><small>{text(row.category) || "Dokument"}</small><strong>{text(row.title) || "Dokument öffnen"}</strong></div>
            <span className="club-hub-arrow">↗</span>
          </a>
        ))}

        {active === "sponsors" && rows.map((row) => (
          <a key={row.id} className="club-hub-card sponsor" href={text(row.website) || undefined} target="_blank" rel="noreferrer">
            {text(row.logoUrl) ? <img src={text(row.logoUrl)} alt="" /> : <div className="club-hub-sponsor-fallback">{(text(row.name) || "TSU").slice(0, 2).toUpperCase()}</div>}
            <strong>{text(row.name) || "Sponsor"}</strong>
          </a>
        ))}
      </div>
    </section>
  );
}
