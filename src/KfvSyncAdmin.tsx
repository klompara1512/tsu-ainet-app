import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { Icon } from "./Icons";
import "./KfvSyncAdmin.css";

type Props = { onBack: () => void };

type SyncStatus = {
  running?: boolean;
  success?: boolean | null;
  startedAt?: Timestamp;
  lastSuccessAt?: Timestamp;
  finishedAt?: Timestamp;
  matchCount?: number;
  standingCount?: number;
  squadCount?: number;
  clubLogoCount?: number;
  newMatchCount?: number;
  updatedMatchCount?: number;
  duplicateMatchesRemoved?: number;
  duplicateDocumentsDeactivated?: number;
  deactivatedMatches?: number;
  warningCount?: number;
  warnings?: string[];
  lastError?: string;
  sourceUrl?: string;
  intervalMinutes?: number;
  provider?: string;
  parserVersion?: string;
  matchIdentityVersion?: string;
  trigger?: string;
  durationMs?: number;
  teamCounts?: Record<string, number>;
  standingTeamCounts?: Record<string, number>;
  squadTeamCounts?: Record<string, number>;
};

type SyncRun = SyncStatus & {
  id: string;
  runId?: string;
  status?: "running" | "success" | "error";
};

type CollectionCounts = {
  matches: number;
  standings: number;
  squad: number;
  clubs: number;
};

const DEFAULT_URL = "https://vereine.oefb.at/TsuAinet/Mannschaften";
const EMPTY_COUNTS: CollectionCounts = { matches: 0, standings: 0, squad: 0, clubs: 0 };

function formatDate(value?: Timestamp) {
  return value
    ? value.toDate().toLocaleString("de-AT", { dateStyle: "medium", timeStyle: "short" })
    : "Noch kein Lauf vorhanden";
}

function formatDuration(milliseconds?: number, startedAt?: Timestamp, finishedAt?: Timestamp) {
  const duration = milliseconds ?? (
    startedAt && finishedAt ? finishedAt.toMillis() - startedAt.toMillis() : undefined
  );
  if (!duration || duration < 0) return "–";
  if (duration < 60_000) return `${Math.max(1, Math.round(duration / 1000))} Sekunden`;
  const minutes = Math.floor(duration / 60_000);
  const seconds = Math.round((duration % 60_000) / 1000);
  return `${minutes} Min. ${seconds} Sek.`;
}

function statusInfo(status: SyncStatus) {
  if (status.running) return { label: "Synchronisierung läuft", tone: "running" as const };
  if (status.success === false) return { label: "Fehler beim letzten Lauf", tone: "error" as const };
  if (status.success === true) return { label: "Letzter Lauf erfolgreich", tone: "success" as const };
  return { label: "Noch kein Lauf", tone: "neutral" as const };
}

function runStatus(run: SyncRun) {
  if (run.status === "running" || run.running) return "running";
  if (run.status === "error" || run.success === false) return "error";
  if (run.status === "success" || run.success === true) return "success";
  return "neutral";
}

function countChanges(run: SyncRun) {
  return (run.newMatchCount || 0) + (run.updatedMatchCount || 0) +
    (run.duplicateDocumentsDeactivated || 0) + (run.deactivatedMatches || 0);
}

export default function KfvSyncAdmin({ onBack }: Props) {
  const [status, setStatus] = useState<SyncStatus>({});
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<SyncRun | null>(null);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [message, setMessage] = useState("");
  const [counts, setCounts] = useState<CollectionCounts>(EMPTY_COUNTS);
  const [countsLoading, setCountsLoading] = useState(true);

  useEffect(() => {
    const unsubscribeStatus = onSnapshot(doc(db, "settings", "kfvSyncStatus"), (snapshot) => {
      setStatus((snapshot.data() || {}) as SyncStatus);
    });

    const unsubscribeSettings = onSnapshot(doc(db, "settings", "kfvSync"), (snapshot) => {
      const value = snapshot.data()?.sourceUrl;
      if (typeof value === "string" && value.trim()) setUrl(value.trim());
    });

    const historyQuery = query(
      collection(db, "kfvSyncRuns"),
      orderBy("startedAt", "desc"),
      limit(10),
    );
    const unsubscribeHistory = onSnapshot(
      historyQuery,
      (snapshot) => setHistory(snapshot.docs.map((entry) => ({
        id: entry.id,
        ...(entry.data() as Omit<SyncRun, "id">),
      }))),
      () => setHistory([]),
    );

    return () => {
      unsubscribeStatus();
      unsubscribeSettings();
      unsubscribeHistory();
    };
  }, []);

  async function refreshCounts() {
    setCountsLoading(true);
    try {
      const active = where("active", "==", true);
      const [matches, standings, squad, clubs] = await Promise.all([
        getCountFromServer(query(collection(db, "kfvMatches"), active)),
        getCountFromServer(query(collection(db, "kfvStandings"), active)),
        getCountFromServer(query(collection(db, "kfvSquad"), active)),
        getCountFromServer(query(collection(db, "kfvClubs"), active)),
      ]);
      setCounts({
        matches: matches.data().count,
        standings: standings.data().count,
        squad: squad.data().count,
        clubs: clubs.data().count,
      });
    } catch (error) {
      console.error("Firestore-Zähler konnten nicht geladen werden:", error);
      setCounts({
        matches: status.matchCount || 0,
        standings: status.standingCount || 0,
        squad: status.squadCount || 0,
        clubs: status.clubLogoCount || 0,
      });
    } finally {
      setCountsLoading(false);
    }
  }

  useEffect(() => {
    void refreshCounts();
    // Die aktuellen Statuswerte dienen nur als Fallback; deshalb reicht ein Lauf beim Öffnen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = useMemo(() => {
    if (!status.lastSuccessAt) return true;
    return Date.now() - status.lastSuccessAt.toMillis() > 90 * 60 * 1000;
  }, [status.lastSuccessAt]);

  const currentStatus = statusInfo(status);

  async function saveSourceUrl() {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("oefb.at")) {
        throw new Error("Ungültige ÖFB-Adresse");
      }
      await setDoc(
        doc(db, "settings", "kfvSync"),
        { sourceUrl: url.trim(), intervalMinutes: 30, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setMessage("Öffentliche ÖFB-Quelladresse gespeichert.");
    } catch {
      setMessage("Bitte eine gültige öffentliche HTTPS-Adresse von oefb.at eingeben.");
    }
  }

  const summaryCards = [
    { label: "Aktive Spiele", value: counts.matches, icon: "ball" as const },
    { label: "Tabellenzeilen", value: counts.standings, icon: "table" as const },
    { label: "Kaderspieler", value: counts.squad, icon: "users" as const },
    { label: "Vereinslogos", value: counts.clubs, icon: "shield" as const },
  ];

  return (
    <section className="sync-center">
      <header className="sync-center__header">
        <button className="sync-center__back" type="button" onClick={onBack}>← Zurück</button>
        <div>
          <p>TSU Ainet · Admin Sync Center</p>
          <h1>Synchronisierung</h1>
          <span>ÖFB-Daten, Systemstatus und die letzten Synchronisationsläufe.</span>
        </div>
        <span className={`sync-status-badge sync-status-badge--${currentStatus.tone}`}>
          {status.running && <span className="sync-status-badge__pulse" />}
          {currentStatus.label}
        </span>
      </header>

      <section className="sync-overview-card">
        <div className="sync-overview-card__icon"><Icon name="sync" /></div>
        <div className="sync-overview-card__main">
          <small>Letzte erfolgreiche Synchronisierung</small>
          <strong>{formatDate(status.lastSuccessAt)}</strong>
          <span>
            Laufzeit: {formatDuration(status.durationMs, status.startedAt, status.finishedAt)} ·
            Intervall: alle {status.intervalMinutes || 30} Minuten
          </span>
        </div>
        <div className="sync-overview-card__meta">
          <span>Provider</span><strong>{status.provider || "GitHub Actions"}</strong>
          <span>Parser</span><strong>{status.parserVersion || "–"}</strong>
        </div>
      </section>

      {(stale || status.lastError) && (
        <aside className={`sync-alert ${status.lastError ? "sync-alert--error" : ""}`}>
          <Icon name={status.lastError ? "bell" : "clock"} />
          <div>
            <strong>{status.lastError ? "Letzter Lauf fehlgeschlagen" : "Synchronisierung überfällig"}</strong>
            <span>{status.lastError || "Der letzte erfolgreiche Lauf ist älter als 90 Minuten. GitHub Actions und das Repository-Secret prüfen."}</span>
          </div>
        </aside>
      )}

      <div className="sync-section-heading">
        <div><small>Firestore</small><h2>Datenbestand</h2></div>
        <button type="button" onClick={() => void refreshCounts()} disabled={countsLoading}>
          <Icon name="sync" /> {countsLoading ? "Lade …" : "Neu zählen"}
        </button>
      </div>

      <div className="sync-metric-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className="sync-metric-card">
            <span><Icon name={card.icon} /></span>
            <strong>{countsLoading ? "…" : card.value.toLocaleString("de-AT")}</strong>
            <small>{card.label}</small>
          </article>
        ))}
      </div>

      <section className="sync-result-card">
        <div className="sync-section-heading sync-section-heading--compact">
          <div><small>Letzter Lauf</small><h2>Ergebnis</h2></div>
        </div>
        <div className="sync-result-grid">
          <div><span>Neue Spiele</span><strong>{status.newMatchCount || 0}</strong></div>
          <div><span>Aktualisiert</span><strong>{status.updatedMatchCount || 0}</strong></div>
          <div><span>Dubletten bereinigt</span><strong>{(status.duplicateMatchesRemoved || 0) + (status.duplicateDocumentsDeactivated || 0)}</strong></div>
          <div><span>Warnungen</span><strong>{status.warningCount || 0}</strong></div>
        </div>
        {status.warnings && status.warnings.length > 0 && (
          <details className="sync-warning-details">
            <summary>Warnungen des letzten Laufs anzeigen</summary>
            <ul>{status.warnings.slice(0, 8).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
          </details>
        )}
      </section>

      <section className="sync-system-card">
        <div className="sync-section-heading sync-section-heading--compact">
          <div><small>Überwachung</small><h2>Systemstatus</h2></div>
        </div>
        <div className="sync-system-list">
          <div><span className="sync-dot sync-dot--success" /><span>Firestore erreichbar</span><strong>Online</strong></div>
          <div><span className={`sync-dot ${stale ? "sync-dot--warning" : "sync-dot--success"}`} /><span>GitHub-Synchronisierung</span><strong>{stale ? "Prüfen" : "Aktiv"}</strong></div>
          <div><span className="sync-dot sync-dot--success" /><span>App-Version</span><strong>11.0.2a</strong></div>
          <div><span className="sync-dot sync-dot--success" /><span>Match-ID-Schema</span><strong>{status.matchIdentityVersion || "11.0.1"}</strong></div>
        </div>
      </section>

      <section className="sync-history-card">
        <div className="sync-section-heading sync-section-heading--compact">
          <div><small>Protokoll</small><h2>Letzte Läufe</h2></div>
          <span>{history.length} Einträge</span>
        </div>
        {history.length === 0 ? (
          <p className="sync-empty">Die Historie wird ab dem nächsten GitHub-Synchronisationslauf gefüllt.</p>
        ) : (
          <div className="sync-history-list">
            {history.map((run) => {
              const tone = runStatus(run);
              return (
                <button key={run.id} type="button" onClick={() => setSelectedRun(run)}>
                  <span className={`sync-run-icon sync-run-icon--${tone}`}>
                    {tone === "success" ? "✓" : tone === "error" ? "!" : tone === "running" ? "…" : "·"}
                  </span>
                  <span className="sync-run-main">
                    <strong>{formatDate(run.startedAt)}</strong>
                    <small>{formatDuration(run.durationMs, run.startedAt, run.finishedAt)} · {countChanges(run)} Änderungen</small>
                  </span>
                  <span className="sync-run-arrow">›</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="sync-manual-card">
        <div className="sync-manual-card__icon"><Icon name="rocket" /></div>
        <div>
          <small>Vorbereitung für Version 11.0.3</small>
          <h2>Manuelle Synchronisierung</h2>
          <p>Der vorhandene GitHub-Workflow wird im nächsten Sprint kostenlos mit diesem Bereich verbunden.</p>
        </div>
        <button type="button" disabled><Icon name="sync" /> Jetzt synchronisieren</button>
      </section>

      <form className="sync-source-card" onSubmit={(event) => { event.preventDefault(); void saveSourceUrl(); }}>
        <label>
          Öffentliche ÖFB-Quelladresse
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={DEFAULT_URL} />
        </label>
        <div>
          <button type="submit">Adresse speichern</button>
          <button type="button" className="secondary" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>ÖFB-Seite öffnen</button>
        </div>
        {message && <p>{message}</p>}
      </form>

      {selectedRun && (
        <div className="sync-dialog-backdrop" role="presentation" onClick={() => setSelectedRun(null)}>
          <article className="sync-dialog" role="dialog" aria-modal="true" aria-label="Synchronisationsdetails" onClick={(event) => event.stopPropagation()}>
            <button className="sync-dialog__close" type="button" onClick={() => setSelectedRun(null)}>×</button>
            <p>Synchronisationslauf</p>
            <h2>{formatDate(selectedRun.startedAt)}</h2>
            <span className={`sync-status-badge sync-status-badge--${runStatus(selectedRun)}`}>
              {runStatus(selectedRun) === "success" ? "Erfolgreich" : runStatus(selectedRun) === "error" ? "Fehler" : "Läuft"}
            </span>
            <div className="sync-dialog__grid">
              <div><span>Laufzeit</span><strong>{formatDuration(selectedRun.durationMs, selectedRun.startedAt, selectedRun.finishedAt)}</strong></div>
              <div><span>Neue Spiele</span><strong>{selectedRun.newMatchCount || 0}</strong></div>
              <div><span>Aktualisiert</span><strong>{selectedRun.updatedMatchCount || 0}</strong></div>
              <div><span>Dubletten</span><strong>{(selectedRun.duplicateMatchesRemoved || 0) + (selectedRun.duplicateDocumentsDeactivated || 0)}</strong></div>
              <div><span>Spiele gesamt</span><strong>{selectedRun.matchCount || 0}</strong></div>
              <div><span>Kaderspieler</span><strong>{selectedRun.squadCount || 0}</strong></div>
              <div><span>Tabellenzeilen</span><strong>{selectedRun.standingCount || 0}</strong></div>
              <div><span>Vereinslogos</span><strong>{selectedRun.clubLogoCount || 0}</strong></div>
            </div>
            {selectedRun.lastError && <div className="sync-dialog__error"><strong>Fehler</strong><span>{selectedRun.lastError}</span></div>}
            {selectedRun.warnings && selectedRun.warnings.length > 0 && (
              <div className="sync-dialog__warnings"><strong>Warnungen</strong><ul>{selectedRun.warnings.slice(0, 10).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
