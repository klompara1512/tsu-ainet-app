import { useEffect, useMemo, useRef, useState } from "react";
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
import { APP_VERSION } from "./appVersion";
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
  githubRunId?: string;
  githubRunNumber?: number;
  githubRunAttempt?: number;
  githubRunUrl?: string;
  githubWorkflow?: string;
  githubJob?: string;
  githubRepository?: string;
  githubActor?: string;
  githubEventName?: string;
  githubRefName?: string;
  githubSha?: string;
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

type DiagnosticItem = {
  label: string;
  state: "success" | "warning" | "error" | "checking";
  detail: string;
};

const DEFAULT_URL = "https://vereine.oefb.at/TsuAinet/Mannschaften";
const GITHUB_WORKFLOW_URL = "https://github.com/klompara1512/tsu-ainet-app/actions/workflows/kfv-sync.yml";
const EMPTY_COUNTS: CollectionCounts = { matches: 0, standings: 0, squad: 0, clubs: 0 };
const WAITING_STORAGE_KEY = "tsu-kfv-sync-waiting-since";

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

function githubStatusInfo(status: SyncStatus, stale: boolean, waiting: boolean) {
  if (status.running) return { label: "Läuft gerade", tone: "running" as const };
  if (waiting) return { label: "Start ausständig", tone: "warning" as const };
  if (status.success === false) return { label: "Fehlgeschlagen", tone: "error" as const };
  if (status.success === true && stale) return { label: "Überfällig", tone: "warning" as const };
  if (status.success === true) return { label: "Online", tone: "success" as const };
  return { label: "Noch kein Lauf", tone: "neutral" as const };
}

function shortSha(value?: string) {
  return value ? value.slice(0, 7) : "–";
}

function progressPercent(status: SyncStatus, waiting: boolean) {
  if (status.success === true && !status.running) return 100;
  if (status.success === false && !status.running) return 100;
  if (status.running) {
    if ((status.clubLogoCount || 0) > 0) return 88;
    if ((status.squadCount || 0) > 0) return 72;
    if ((status.standingCount || 0) > 0) return 55;
    if ((status.matchCount || 0) > 0) return 38;
    return 18;
  }
  return waiting ? 8 : 0;
}

export default function KfvSyncAdmin({ onBack }: Props) {
  const [status, setStatus] = useState<SyncStatus>({});
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<SyncRun | null>(null);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [message, setMessage] = useState("");
  const [counts, setCounts] = useState<CollectionCounts>(EMPTY_COUNTS);
  const [countsLoading, setCountsLoading] = useState(true);
  const [waitingSince, setWaitingSince] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(WAITING_STORAGE_KEY));
    return Number.isFinite(stored) && Date.now() - stored < 20 * 60_000 ? stored : null;
  });
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastCompletedRef = useRef<number>(0);

  useEffect(() => {
    const unsubscribeStatus = onSnapshot(doc(db, "settings", "kfvSyncStatus"), (snapshot) => {
      const nextStatus = (snapshot.data() || {}) as SyncStatus;
      setStatus(nextStatus);
      const completedAt = nextStatus.finishedAt?.toMillis() || nextStatus.lastSuccessAt?.toMillis() || 0;
      if (completedAt > lastCompletedRef.current) lastCompletedRef.current = completedAt;
    });

    const unsubscribeSettings = onSnapshot(doc(db, "settings", "kfvSync"), (snapshot) => {
      const value = snapshot.data()?.sourceUrl;
      if (typeof value === "string" && value.trim()) setUrl(value.trim());
    });

    const historyQuery = query(collection(db, "kfvSyncRuns"), orderBy("startedAt", "desc"), limit(10));
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


  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!waitingSince) return;
    const runStarted = status.startedAt?.toMillis() || history[0]?.startedAt?.toMillis() || 0;
    const runFinished = status.finishedAt?.toMillis() || history[0]?.finishedAt?.toMillis() || 0;
    if (runStarted >= waitingSince - 10_000 && runFinished >= runStarted && !status.running) {
      localStorage.removeItem(WAITING_STORAGE_KEY);
      setWaitingSince(null);
      setMessage(status.success === false ? "Synchronisierung beendet – Fehlerdetails unten prüfen." : "Synchronisierung erfolgreich abgeschlossen.");
      void refreshCounts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, status, waitingSince]);

  async function refreshCounts() {
    setCountsLoading(true);
    try {
      const active = where("active", "==", true);
      const [matches, standings, squad, clubs] = await Promise.all([
        getCountFromServer(query(collection(db, "oefbV12Matches"), active)),
        getCountFromServer(query(collection(db, "oefbV12Standings"), active)),
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!waitingSince && !status.running) return;
    const interval = window.setInterval(() => void refreshCounts(), 15_000);
    return () => window.clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.running, waitingSince]);

  const latestSuccessfulRun = useMemo(() => {
    const candidates: SyncRun[] = [
      { id: "current", ...status },
      ...history,
    ].filter((run) => run.success === true || run.status === "success");

    return candidates.sort((left, right) => {
      const leftTime = left.lastSuccessAt?.toMillis() || left.finishedAt?.toMillis() || 0;
      const rightTime = right.lastSuccessAt?.toMillis() || right.finishedAt?.toMillis() || 0;
      return rightTime - leftTime;
    })[0] || null;
  }, [history, status]);

  const latestFailure = useMemo(() => {
    const candidates: SyncRun[] = [
      { id: "current", ...status },
      ...history,
    ].filter((run) => run.success === false || run.status === "error");

    return candidates.sort((left, right) => {
      const leftTime = left.finishedAt?.toMillis() || left.startedAt?.toMillis() || 0;
      const rightTime = right.finishedAt?.toMillis() || right.startedAt?.toMillis() || 0;
      return rightTime - leftTime;
    })[0] || null;
  }, [history, status]);

  const effectiveLastSuccessAt = latestSuccessfulRun?.lastSuccessAt || latestSuccessfulRun?.finishedAt;
  const intervalMinutes = status.intervalMinutes || latestSuccessfulRun?.intervalMinutes || 720;
  const staleAfterMinutes = Math.max(1080, intervalMinutes + 360);
  const stale = !effectiveLastSuccessAt
    || now - effectiveLastSuccessAt.toMillis() > staleAfterMinutes * 60_000;
  const latestSuccessMillis = effectiveLastSuccessAt?.toMillis() || 0;
  const latestFailureMillis = latestFailure?.finishedAt?.toMillis() || latestFailure?.startedAt?.toMillis() || 0;
  const activeError = latestFailureMillis > latestSuccessMillis ? latestFailure?.lastError || "Der letzte Synchronisationslauf ist fehlgeschlagen." : "";

  const effectiveStatus: SyncStatus = {
    ...status,
    success: activeError ? false : status.running ? null : latestSuccessfulRun ? true : status.success,
    lastSuccessAt: effectiveLastSuccessAt,
    lastError: activeError,
  };
  const currentStatus = statusInfo(effectiveStatus);
  const waiting = Boolean(waitingSince) && !status.running;
  const githubStatus = githubStatusInfo(effectiveStatus, stale, waiting);
  const progress = progressPercent(effectiveStatus, waiting);

  async function saveSourceUrl() {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("oefb.at")) throw new Error("Ungültige ÖFB-Adresse");
      await setDoc(
        doc(db, "settings", "kfvSync"),
        { sourceUrl: url.trim(), intervalMinutes: 720, workflowUrl: GITHUB_WORKFLOW_URL, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setMessage("Öffentliche ÖFB-Quelladresse gespeichert.");
    } catch {
      setMessage("Bitte eine gültige öffentliche HTTPS-Adresse von oefb.at eingeben.");
    }
  }

  function openGitHubWorkflow() {
    if (!navigator.onLine) {
      setMessage("Keine Internetverbindung. Bitte Verbindung prüfen und erneut versuchen.");
      return;
    }
    const now = Date.now();
    localStorage.setItem(WAITING_STORAGE_KEY, String(now));
    setWaitingSince(now);
    setMessage("GitHub wurde geöffnet. Dort auf „Run workflow“ klicken; diese Seite überwacht anschließend automatisch den Status.");
    window.open(GITHUB_WORKFLOW_URL, "_blank", "noopener,noreferrer");
  }

  async function runDiagnostics() {
    setDiagnosticsOpen(true);
    setDiagnosticsRunning(true);
    setDiagnostics([
      { label: "Internetverbindung", state: navigator.onLine ? "success" : "error", detail: navigator.onLine ? "Online" : "Offline" },
      { label: "Firestore", state: "checking", detail: "Verbindung wird geprüft …" },
      { label: "GitHub-Workflow", state: githubStatus.tone === "error" ? "error" : githubStatus.tone === "warning" ? "warning" : "success", detail: effectiveStatus.githubWorkflow ? `${effectiveStatus.githubWorkflow} · ${githubStatus.label}` : "Workflow-Adresse ist konfiguriert" },
      { label: "Synchronisationshistorie", state: "checking", detail: "Status wird geprüft …" },
      { label: "Match-ID-Schema", state: effectiveStatus.matchIdentityVersion ? "success" : "warning", detail: effectiveStatus.matchIdentityVersion || "Noch nicht gemeldet" },
    ]);

    let firestoreState: DiagnosticItem = { label: "Firestore", state: "success", detail: "Erreichbar" };
    try {
      await getCountFromServer(query(collection(db, "oefbV12Matches"), where("active", "==", true)));
    } catch (error) {
      console.error("Diagnose Firestore:", error);
      firestoreState = { label: "Firestore", state: "error", detail: "Nicht erreichbar oder keine Berechtigung" };
    }

    const historyState: DiagnosticItem = history.length > 0
      ? { label: "Synchronisationshistorie", state: activeError ? "error" : stale ? "warning" : "success", detail: activeError ? activeError : stale ? `Letzter erfolgreicher Lauf ist älter als ${staleAfterMinutes} Minuten` : `${history.length} Lauf/Läufe verfügbar` }
      : { label: "Synchronisationshistorie", state: "warning", detail: "Noch keine Läufe gespeichert" };

    setDiagnostics((items) => items.map((item) => {
      if (item.label === "Firestore") return firestoreState;
      if (item.label === "Synchronisationshistorie") return historyState;
      return item;
    }));
    setDiagnosticsRunning(false);
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
          <span>ÖFB-Daten, Systemprüfung und kostenlose Steuerung über GitHub Actions.</span>
        </div>
        <span className={`sync-status-badge sync-status-badge--${status.running ? "running" : waiting ? "running" : stale && !activeError ? "warning" : currentStatus.tone}`}>
          {(status.running || waiting) && <span className="sync-status-badge__pulse" />}
          {status.running ? "Synchronisierung läuft" : waiting ? "Warte auf GitHub-Start" : activeError ? "Letzter Lauf fehlgeschlagen" : stale ? "Synchronisierung verzögert" : currentStatus.label}
        </span>
      </header>

      <section className="sync-overview-card">
        <div className="sync-overview-card__icon"><Icon name="sync" /></div>
        <div className="sync-overview-card__main">
          <small>Letzte erfolgreiche Synchronisierung</small>
          <strong>{formatDate(effectiveLastSuccessAt)}</strong>
          <span>Laufzeit: {formatDuration(latestSuccessfulRun?.durationMs, latestSuccessfulRun?.startedAt, latestSuccessfulRun?.finishedAt)} · Geplanter Voll-Sync: zweimal täglich</span>
        </div>
        <div className="sync-overview-card__meta">
          <span>Provider</span><strong>{status.provider || "GitHub Actions"}</strong>
          <span>Parser</span><strong>{status.parserVersion || "–"}</strong>
        </div>
      </section>

      {(waiting || status.running) && (
        <section className="sync-progress-card" aria-live="polite">
          <div className="sync-progress-card__heading">
            <div><small>Smart Sync Control</small><h2>{status.running ? "Synchronisierung läuft" : "GitHub-Start ausständig"}</h2></div>
            <strong>{progress}%</strong>
          </div>
          <div className="sync-progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="sync-progress-steps">
            <span className={progress >= 8 ? "done" : ""}>GitHub öffnen</span>
            <span className={progress >= 18 ? "done" : ""}>Workflow startet</span>
            <span className={progress >= 38 ? "done" : ""}>Spiele</span>
            <span className={progress >= 55 ? "done" : ""}>Tabellen</span>
            <span className={progress >= 72 ? "done" : ""}>Kader</span>
            <span className={progress >= 88 ? "done" : ""}>Logos</span>
            <span className={progress >= 100 ? "done" : ""}>Fertig</span>
          </div>
          {waiting && <p>Im geöffneten GitHub-Fenster bitte <strong>Run workflow</strong> bestätigen. Danach aktualisiert sich diese Ansicht automatisch.</p>}
        </section>
      )}

      {(stale || activeError) && (
        <aside className={`sync-alert ${activeError ? "sync-alert--error" : ""}`}>
          <Icon name={activeError ? "bell" : "clock"} />
          <div>
            <strong>{activeError ? "Letzter Lauf fehlgeschlagen" : "Synchronisierung verzögert"}</strong>
            <span>{activeError || `Der letzte erfolgreiche Voll-Sync ist älter als ${Math.round(staleAfterMinutes / 60)} Stunden. Tabellen und Spielberichte laufen zusätzlich Freitag bis Sonntag um 20:00 Uhr.`}</span>
          </div>
        </aside>
      )}

      {message && <aside className="sync-message">{message}</aside>}

      <section className="sync-manual-card sync-manual-card--active">
        <div className="sync-manual-card__icon"><Icon name="rocket" /></div>
        <div>
          <small>Version 11.0.3</small>
          <h2>Manuelle Synchronisierung</h2>
          <p>Kostenlos über GitHub Actions. Es werden keine Cloud Functions und kein Blaze-Plan benötigt.</p>
        </div>
        <div className="sync-manual-card__actions">
          <button type="button" className="primary" onClick={openGitHubWorkflow} disabled={status.running}>
            <Icon name="sync" /> {status.running ? "Läuft bereits" : "GitHub-Sync starten"}
          </button>
          <button type="button" className="secondary" onClick={() => void runDiagnostics()} disabled={diagnosticsRunning}>
            <Icon name="settings" /> {diagnosticsRunning ? "Prüfe …" : "System prüfen"}
          </button>
        </div>
      </section>

      <div className="sync-section-heading">
        <div><small>Firestore</small><h2>Datenbestand</h2></div>
        <button type="button" onClick={() => void refreshCounts()} disabled={countsLoading}><Icon name="sync" /> {countsLoading ? "Lade …" : "Neu zählen"}</button>
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
        <div className="sync-section-heading sync-section-heading--compact"><div><small>Letzter Lauf</small><h2>Ergebnis</h2></div></div>
        <div className="sync-result-grid">
          <div><span>Neue Spiele</span><strong>{latestSuccessfulRun?.newMatchCount || 0}</strong></div>
          <div><span>Aktualisiert</span><strong>{latestSuccessfulRun?.updatedMatchCount || 0}</strong></div>
          <div><span>Dubletten bereinigt</span><strong>{(latestSuccessfulRun?.duplicateMatchesRemoved || 0) + (latestSuccessfulRun?.duplicateDocumentsDeactivated || 0)}</strong></div>
          <div><span>Warnungen</span><strong>{latestSuccessfulRun?.warningCount || 0}</strong></div>
        </div>
        {latestSuccessfulRun?.warnings && latestSuccessfulRun.warnings.length > 0 && (
          <details className="sync-warning-details"><summary>Warnungen des letzten Laufs anzeigen</summary><ul>{latestSuccessfulRun.warnings.slice(0, 8).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></details>
        )}
      </section>

      <section className="sync-system-card">
        <div className="sync-section-heading sync-section-heading--compact"><div><small>Überwachung</small><h2>Systemstatus</h2></div></div>
        <div className="sync-system-list">
          <div><span className="sync-dot sync-dot--success" /><span>Firestore erreichbar</span><strong>Online</strong></div>
          <div>
            <span className={`sync-dot sync-dot--${githubStatus.tone === "running" ? "warning" : githubStatus.tone}`} />
            <span>GitHub-Synchronisierung</span>
            <strong>{githubStatus.label}</strong>
          </div>
          <div><span className="sync-dot sync-dot--success" /><span>App-Version</span><strong>{APP_VERSION}</strong></div>
          <div><span className="sync-dot sync-dot--success" /><span>Match-ID-Schema</span><strong>{status.matchIdentityVersion || "11.0.1"}</strong></div>
        </div>
      </section>

      <section className="sync-github-card">
        <div className="sync-section-heading sync-section-heading--compact">
          <div><small>GitHub Actions</small><h2>Workflow-Status</h2></div>
          <span className={`sync-status-badge sync-status-badge--${githubStatus.tone}`}>{githubStatus.label}</span>
        </div>
        <div className="sync-github-grid">
          <div><span>Workflow</span><strong>{status.githubWorkflow || "KFV / ÖFB Synchronisierung"}</strong></div>
          <div><span>Letzter Lauf</span><strong>{formatDate(status.startedAt)}</strong></div>
          <div><span>Laufnummer</span><strong>{status.githubRunNumber ? `#${status.githubRunNumber}` : "–"}</strong></div>
          <div><span>Versuch</span><strong>{status.githubRunAttempt || "–"}</strong></div>
          <div><span>Auslöser</span><strong>{status.githubEventName || status.trigger || "–"}</strong></div>
          <div><span>Commit</span><strong>{shortSha(status.githubSha)}</strong></div>
        </div>
        {status.lastError && <div className="sync-github-error"><strong>Letzter Fehler</strong><span>{status.lastError}</span></div>}
        <div className="sync-github-actions">
          <button type="button" className="primary" onClick={() => window.open(status.githubRunUrl || GITHUB_WORKFLOW_URL, "_blank", "noopener,noreferrer")}>
            GitHub-Lauf öffnen
          </button>
          <button type="button" className="secondary" onClick={() => void runDiagnostics()}>Status prüfen</button>
        </div>
      </section>

      <section className="sync-history-card">
        <div className="sync-section-heading sync-section-heading--compact"><div><small>Protokoll</small><h2>Letzte Läufe</h2></div><span>{history.length} Einträge</span></div>
        {history.length === 0 ? <p className="sync-empty">Die Historie wird ab dem nächsten GitHub-Synchronisationslauf gefüllt.</p> : (
          <div className="sync-history-list">{history.map((run) => {
            const tone = runStatus(run);
            return <button key={run.id} type="button" onClick={() => setSelectedRun(run)}>
              <span className={`sync-run-icon sync-run-icon--${tone}`}>{tone === "success" ? "✓" : tone === "error" ? "!" : tone === "running" ? "…" : "·"}</span>
              <span className="sync-run-main"><strong>{formatDate(run.startedAt)}</strong><small>{formatDuration(run.durationMs, run.startedAt, run.finishedAt)} · {countChanges(run)} Änderungen</small></span>
              <span className="sync-run-arrow">›</span>
            </button>;
          })}</div>
        )}
      </section>

      <form className="sync-source-card" onSubmit={(event) => { event.preventDefault(); void saveSourceUrl(); }}>
        <label>Öffentliche ÖFB-Quelladresse<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={DEFAULT_URL} /></label>
        <div><button type="submit">Adresse speichern</button><button type="button" className="secondary" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>ÖFB-Seite öffnen</button></div>
        {message && <p>{message}</p>}
      </form>

      {diagnosticsOpen && (
        <div className="sync-dialog-backdrop" role="presentation" onClick={() => setDiagnosticsOpen(false)}>
          <article className="sync-dialog" role="dialog" aria-modal="true" aria-label="Systemdiagnose" onClick={(event) => event.stopPropagation()}>
            <button className="sync-dialog__close" type="button" onClick={() => setDiagnosticsOpen(false)}>×</button>
            <p>Systemdiagnose</p><h2>Projekt- und Verbindungsprüfung</h2>
            <div className="sync-diagnostic-list">{diagnostics.map((item) => (
              <div key={item.label}>
                <span className={`sync-dot sync-dot--${item.state === "checking" ? "warning" : item.state}`} />
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              </div>
            ))}</div>
            <button className="sync-dialog__action" type="button" onClick={() => void runDiagnostics()} disabled={diagnosticsRunning}><Icon name="sync" /> Erneut prüfen</button>
          </article>
        </div>
      )}

      {selectedRun && (
        <div className="sync-dialog-backdrop" role="presentation" onClick={() => setSelectedRun(null)}>
          <article className="sync-dialog" role="dialog" aria-modal="true" aria-label="Synchronisationsdetails" onClick={(event) => event.stopPropagation()}>
            <button className="sync-dialog__close" type="button" onClick={() => setSelectedRun(null)}>×</button>
            <p>Synchronisationslauf</p><h2>{formatDate(selectedRun.startedAt)}</h2>
            <span className={`sync-status-badge sync-status-badge--${runStatus(selectedRun)}`}>{runStatus(selectedRun) === "success" ? "Erfolgreich" : runStatus(selectedRun) === "error" ? "Fehler" : "Läuft"}</span>
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
            {(selectedRun.githubRunUrl || selectedRun.githubRunNumber) && (
              <div className="sync-dialog__github">
                <span>GitHub Actions {selectedRun.githubRunNumber ? `#${selectedRun.githubRunNumber}` : ""}</span>
                <button type="button" onClick={() => window.open(selectedRun.githubRunUrl || GITHUB_WORKFLOW_URL, "_blank", "noopener,noreferrer")}>Lauf öffnen</button>
              </div>
            )}
            {selectedRun.lastError && <div className="sync-dialog__error"><strong>Fehler</strong><span>{selectedRun.lastError}</span></div>}
            {selectedRun.warnings && selectedRun.warnings.length > 0 && <div className="sync-dialog__warnings"><strong>Warnungen</strong><ul>{selectedRun.warnings.slice(0, 10).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
          </article>
        </div>
      )}
    </section>
  );
}
