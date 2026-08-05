import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import "./PublicPages.css";

type ClubEvent = { id: string; title: string; teamName: string; location: string; startAt: Date; active: boolean; isPublic: boolean };

export default function PublicEvents({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => onSnapshot(collection(db, "events"), (snapshot) => {
    setEvents(snapshot.docs.map((item) => {
      const data = item.data();
      return { id: item.id, title: typeof data.title === "string" ? data.title : "Termin", teamName: typeof data.teamName === "string" ? data.teamName : "TSU Ainet", location: typeof data.location === "string" ? data.location : "", startAt: data.startAt instanceof Timestamp ? data.startAt.toDate() : new Date(0), active: data.active !== false, isPublic: data.public !== false && data.internal !== true };
    }).filter((item) => item.active && item.isPublic && item.startAt.getTime() > 0));
    setLoading(false);
  }, () => setLoading(false)), []);
  const upcoming = useMemo(() => events.filter((item) => item.startAt.getTime() >= Date.now() - 3_600_000).sort((a, b) => a.startAt.getTime() - b.startAt.getTime()), [events]);
  const date = (value: Date) => new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(value);
  const time = (value: Date) => new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" }).format(value);
  return <section className="public-page"><header className="public-page-head"><button type="button" onClick={onBack}>‹</button><h2>Termine</h2><span /></header>{loading ? <div className="public-empty">Termine werden geladen …</div> : upcoming.length ? <div className="public-event-list">{upcoming.map((item) => <article key={item.id}><time><strong>{item.startAt.getDate().toString().padStart(2, "0")}</strong><span>{item.startAt.toLocaleDateString("de-AT", { month: "short" })}</span></time><div><small>{item.teamName}</small><h3>{item.title}</h3><p>{date(item.startAt)} · {time(item.startAt)} Uhr{item.location ? ` · ${item.location}` : ""}</p></div></article>)}</div> : <div className="public-empty">Aktuell sind keine öffentlichen Termine eingetragen.</div>}</section>;
}
