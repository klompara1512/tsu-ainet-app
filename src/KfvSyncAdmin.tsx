import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import "./SportsAdmin.css";

type Props = { onBack: () => void };
type Status = {
  running?: boolean;
  success?: boolean;
  lastSuccessAt?: Timestamp;
  finishedAt?: Timestamp;
  matchCount?: number;
  standingCount?: number;
  warningCount?: number;
  lastError?: string;
  sourceUrl?: string;
  intervalMinutes?: number;
  provider?: string;
};

const DEFAULT_URL = "https://kfv-fussball.at/kfv/Verein/9209?TSU-Ainet=";

function fmt(value?: Timestamp) {
  return value ? value.toDate().toLocaleString("de-AT") : "Noch nie";
}

export default function KfvSyncAdmin({ onBack }: Props) {
  const [status, setStatus] = useState<Status>({});
  const [url, setUrl] = useState(DEFAULT_URL);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const a = onSnapshot(doc(db, "settings", "kfvSyncStatus"), (snapshot) =>
      setStatus((snapshot.data() || {}) as Status),
    );
    const b = onSnapshot(doc(db, "settings", "kfvSync"), (snapshot) => {
      const value = snapshot.data()?.sourceUrl;
      if (typeof value === "string" && value) setUrl(value);
    });
    return () => {
      a();
      b();
    };
  }, []);

  const stale = useMemo(() => {
    if (!status.lastSuccessAt) return true;
    return Date.now() - status.lastSuccessAt.toMillis() > 45 * 60 * 1000;
  }, [status.lastSuccessAt]);

  async function save() {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !["kfv-fussball.at", "www.kfv-fussball.at"].includes(parsed.hostname)) {
        throw new Error("Ungültiger Host");
      }
      await setDoc(
        doc(db, "settings", "kfvSync"),
        { sourceUrl: url.trim(), intervalMinutes: 30, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setMsg("Öffentliche KFV-URL gespeichert. Sie wird beim nächsten GitHub-Lauf verwendet.");
    } catch {
      setMsg("Bitte eine gültige öffentliche KFV-HTTPS-URL eingeben.");
    }
  }

  return (
    <section className="sports-admin">
      <button className="admin-back" onClick={onBack}>← Zurück</button>
      <header>
        <p>TSU Ainet · Kostenloser Betrieb</p>
        <h2>KFV-Synchronisierung</h2>
        <span>GitHub Actions prüft die öffentlichen KFV-Seiten alle 30 Minuten.</span>
      </header>

      <form className="sports-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label style={{ gridColumn: "1 / -1" }}>
          Öffentliche KFV-Quell-URL
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={DEFAULT_URL} />
        </label>
        <div className="form-actions">
          <button type="submit">URL speichern</button>
          <button type="button" className="secondary" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>KFV-Seite öffnen</button>
        </div>
      </form>

      {msg && <p className="admin-message">{msg}</p>}

      <div className="admin-list">
        <article>
          <b>{status.running ? "…" : status.success === false || stale ? "!" : "✓"}</b>
          <div>
            <small>Letzte erfolgreiche Synchronisierung</small>
            <strong>{fmt(status.lastSuccessAt)}</strong>
            <span>{status.matchCount || 0} Spiele · {status.standingCount || 0} Tabellenzeilen · {status.warningCount || 0} Warnungen</span>
            {stale && <span>Hinweis: Die Daten sind älter als 45 Minuten. GitHub Actions oder das Secret prüfen.</span>}
            {status.lastError && <span>Fehler: {status.lastError}</span>}
          </div>
        </article>
        <article>
          <b>30</b>
          <div>
            <small>Intervall</small>
            <strong>Alle 30 Minuten</strong>
            <span>Kein Firebase-Blaze-Tarif notwendig. Anbieter: {status.provider || "GitHub Actions"}.</span>
          </div>
        </article>
        <article>
          <b>↻</b>
          <div>
            <small>Manuelle Aktualisierung</small>
            <strong>Über GitHub Actions</strong>
            <span>Im GitHub-Repository unter Actions → „KFV-Daten synchronisieren“ → „Run workflow“ starten.</span>
          </div>
        </article>
      </div>
    </section>
  );
}
