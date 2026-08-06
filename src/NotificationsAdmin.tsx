import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { Icon } from "./Icons";
import "./NotificationsAdmin.css";

const targets = [
  ["all", "Alle"],
  ["km", "Kampfmannschaft"],
  ["challenge", "Challenge"],
  ["u17", "U17"],
  ["u12", "U12"],
  ["u10", "U10"],
  ["u8", "U8"],
  ["news", "Ankündigungen"],
  ["events", "Veranstaltungen"],
  ["results", "Ergebnisse"],
] as const;

type QueueEntry = {
  id: string;
  title?: string;
  body?: string;
  target?: string;
  status?: "pending" | "sending" | "sent" | "error";
  createdAt?: Timestamp;
  sentAt?: Timestamp;
  success?: number;
  failed?: number;
  tokenCount?: number;
  error?: string;
};

type PushStatus = {
  running?: boolean;
  success?: boolean | null;
  lastSuccessAt?: Timestamp;
  finishedAt?: Timestamp;
  messagesSent?: number;
  deliveriesSuccessful?: number;
  deliveriesFailed?: number;
  invalidTokensRemoved?: number;
  lastError?: string;
};

function formatDate(value?: Timestamp) {
  return value
    ? value.toDate().toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })
    : "Noch kein Versand";
}

function queueLabel(status?: QueueEntry["status"]) {
  if (status === "pending") return "Wartet auf Versand";
  if (status === "sending") return "Wird versendet";
  if (status === "sent") return "Versendet";
  if (status === "error") return "Fehler";
  return "Unbekannt";
}

export default function NotificationsAdmin({ onBack }: { onBack: () => void }) {
  const [title, setTitle] = useState("TSU Ainet");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState("all");
  const [link, setLink] = useState("/");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [pushStatus, setPushStatus] = useState<PushStatus>({});
  const [activeTokenCount, setActiveTokenCount] = useState<number | null>(null);

  useEffect(() => {
    const queueQuery = query(collection(db, "notificationQueue"), orderBy("createdAt", "desc"), limit(8));
    const unsubscribeQueue = onSnapshot(queueQuery, (snapshot) => {
      setQueue(snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() as Omit<QueueEntry, "id">) })));
    });
    const unsubscribeStatus = onSnapshot(
      doc(db, "settings", "pushStatus"),
      (snapshot) => setPushStatus((snapshot.data() || {}) as PushStatus),
    );

    void getCountFromServer(query(collection(db, "fcmTokens"), where("active", "==", true)))
      .then((result) => setActiveTokenCount(result.data().count))
      .catch(() => setActiveTokenCount(null));

    return () => {
      unsubscribeQueue();
      unsubscribeStatus();
    };
  }, []);

  const latestQueueEntry = queue[0];
  const systemTone = pushStatus.running
    ? "running"
    : pushStatus.success === false
      ? "error"
      : pushStatus.success === true
        ? "success"
        : "neutral";

  const systemLabel = useMemo(() => {
    if (pushStatus.running) return "Push-Versand läuft";
    if (pushStatus.success === false) return "Letzter Versandlauf fehlgeschlagen";
    if (pushStatus.success === true) return "Push-System betriebsbereit";
    return "Noch kein Versandlauf protokolliert";
  }, [pushStatus.running, pushStatus.success]);

  async function send() {
    if (!body.trim()) {
      setMessage("Bitte eine Nachricht eingeben.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const normalizedLink = link.trim() || "/";
      await addDoc(collection(db, "notificationQueue"), {
        title: title.trim() || "TSU Ainet",
        body: body.trim(),
        target,
        link: normalizedLink,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setBody("");
      setMessage("Nachricht wurde eingereiht. Der GitHub-Workflow verarbeitet die Warteschlange spätestens beim nächsten 5-Minuten-Lauf.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fehler beim Speichern.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="notification-admin dashboard-page">
      <button className="admin-back" type="button" onClick={onBack}>‹ Zurück</button>
      <p className="home-eyebrow">TSU Ainet Push</p>
      <h2>Benachrichtigungen</h2>
      <p>Nachrichten werden über Firebase Cloud Messaging und den GitHub-Workflow versendet.</p>

      <section className={`notification-health notification-health--${systemTone}`}>
        <div>
          <span className="notification-health__dot" />
          <div><strong>{systemLabel}</strong><small>Letzter erfolgreicher Lauf: {formatDate(pushStatus.lastSuccessAt)}</small></div>
        </div>
        <dl>
          <div><dt>Aktive Geräte</dt><dd>{activeTokenCount ?? "–"}</dd></div>
          <div><dt>Zugestellt</dt><dd>{pushStatus.deliveriesSuccessful ?? 0}</dd></div>
          <div><dt>Fehlgeschlagen</dt><dd>{pushStatus.deliveriesFailed ?? 0}</dd></div>
          <div><dt>Ungültige Tokens entfernt</dt><dd>{pushStatus.invalidTokensRemoved ?? 0}</dd></div>
        </dl>
        {pushStatus.lastError && <p className="notification-health__error">{pushStatus.lastError}</p>}
      </section>

      <div className="notification-card">
        <label>Titel<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} /></label>
        <label>Zielgruppe<select value={target} onChange={(event) => setTarget(event.target.value)}>{targets.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Ziel in der App / Website<input value={link} onChange={(event) => setLink(event.target.value)} maxLength={220} placeholder="z. B. / oder https://..." /></label>
        <label>Nachricht<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={220} rows={5} placeholder="z. B. Das heutige Training fällt aus." /></label>
        <button className="notification-send" type="button" onClick={() => void send()} disabled={busy}><Icon name="send" />{busy ? "Wird gespeichert …" : "Push senden"}</button>
        {message && <p className="notification-status">{message}</p>}
      </div>

      <section className="notification-history">
        <header><div><small>Warteschlange</small><h3>Letzte Nachrichten</h3></div>{latestQueueEntry && <span className={`notification-queue-badge notification-queue-badge--${latestQueueEntry.status || "pending"}`}>{queueLabel(latestQueueEntry.status)}</span>}</header>
        {queue.length ? queue.map((entry) => (
          <article key={entry.id}>
            <div><strong>{entry.title || "TSU Ainet"}</strong><p>{entry.body}</p><small>{formatDate(entry.sentAt || entry.createdAt)} · Ziel: {entry.target || "all"}</small></div>
            <div className="notification-history__result"><span className={`notification-queue-badge notification-queue-badge--${entry.status || "pending"}`}>{queueLabel(entry.status)}</span>{entry.status === "sent" && <small>{entry.success || 0} zugestellt · {entry.failed || 0} fehlgeschlagen</small>}{entry.error && <small className="error">{entry.error}</small>}</div>
          </article>
        )) : <p className="notification-empty">Noch keine Nachrichten vorhanden.</p>}
      </section>
    </section>
  );
}
