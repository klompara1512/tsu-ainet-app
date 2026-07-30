import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import { getResultForTsuAinet, isTsuAinet, subscribeKfvMatches, subscribeKfvStandings } from "./kfvFirestore";
import type { KfvMatch, KfvStandingRow } from "./kfvTypes";
import TeamLogo from "./TeamLogo";
import "./LiveDashboard.css";

type ClubEvent = { id: string; title: string; type: "training" | "match" | "club"; teamName: string; location: string; startAt: Date; active: boolean };
type Props = { displayName: string; onOpenCalendar: () => void; onOpenTeams: () => void; onOpenNews: () => void; onOpenMore: () => void; onOpenKfvLive: () => void };

function LiveDashboard({ displayName, onOpenCalendar, onOpenTeams, onOpenNews, onOpenMore, onOpenKfvLive }: Props) {
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [matches, setMatches] = useState<KfvMatch[]>([]);
  const [standings, setStandings] = useState<KfvStandingRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingKfv, setLoadingKfv] = useState(true);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    const unsubscribeEvents = onSnapshot(query(collection(db, "events"), orderBy("startAt", "asc")), (snapshot) => {
      setEvents(snapshot.docs.map((document) => {
        const data = document.data();
        return { id: document.id, title: typeof data.title === "string" ? data.title : "Termin", type: data.type === "training" || data.type === "match" || data.type === "club" ? data.type : "club", teamName: typeof data.teamName === "string" ? data.teamName : "Gesamter Verein", location: typeof data.location === "string" ? data.location : "", startAt: data.startAt instanceof Timestamp ? data.startAt.toDate() : new Date(0), active: data.active !== false } satisfies ClubEvent;
      }).filter((event) => event.active && event.startAt.getTime() > 0));
      setLoadingEvents(false);
    }, () => setLoadingEvents(false));
    const unsubscribeMatches = subscribeKfvMatches((data) => { setMatches(data); setLoadingKfv(false); }, () => setLoadingKfv(false));
    const unsubscribeStandings = subscribeKfvStandings(setStandings, () => undefined);
    return () => { window.clearInterval(timer); unsubscribeEvents(); unsubscribeMatches(); unsubscribeStandings(); };
  }, []);

  const nextMatch = useMemo(() => matches.find((match) => match.status === "scheduled" && match.kickoffAt.getTime() >= clock.getTime()) ?? null, [matches, clock]);
  const lastMatch = useMemo(() => [...matches].reverse().find((match) => match.status === "finished") ?? null, [matches]);
  const standing = useMemo(() => standings.find((row) => isTsuAinet(row.clubName)) ?? null, [standings]);
  const nextTraining = useMemo(() => events.find((event) => event.type === "training" && event.startAt.getTime() >= clock.getTime()) ?? null, [events, clock]);
  const upcomingEvents = useMemo(() => events.filter((event) => event.startAt.getTime() >= clock.getTime()).slice(0, 3), [events, clock]);

  const dateText = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "2-digit", month: "long" }).format(clock);
  const formatDate = (date: Date) => new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" }).format(date);
  const formatTime = (date: Date) => new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" }).format(date);
  const countdown = nextMatch ? Math.max(0, nextMatch.kickoffAt.getTime() - clock.getTime()) : 0;
  const days = Math.floor(countdown / 86_400_000);
  const hours = Math.floor((countdown % 86_400_000) / 3_600_000);

  return <section className="v5-home">
    <section className="v5-hero">
      <div className="v5-hero-copy"><span className="v5-season">SAISON 2026/27</span><p>{dateText}</p><h1>Servus, {displayName.split(" ")[0]}.</h1><span>Alles Wichtige der TSU Ainet auf einen Blick.</span></div>
      <img src="/tsu-ainet-logo.png" alt="TSU Ainet Vereinslogo" />
    </section>

    <section className="v5-match-center">
      <div className="v5-card-title"><div><span>NÄCHSTES SPIEL</span><h2>{nextMatch?.teamName || "TSU Ainet"}</h2></div>{nextMatch && <div className="v5-countdown"><strong>{days}</strong><small>Tage</small><strong>{hours}</strong><small>Std.</small></div>}</div>
      {loadingKfv ? <div className="v5-loading">ÖFB-Daten werden geladen …</div> : nextMatch ? <>
        <div className="v5-fixture"><div><TeamLogo url={nextMatch.homeLogoUrl} name={nextMatch.homeTeam} size="hero" /><span className="v5-home-away">HEIM</span><strong>{nextMatch.homeTeam}</strong></div><div className="v5-kickoff"><b>{formatTime(nextMatch.kickoffAt)}</b><span>{formatDate(nextMatch.kickoffAt)}</span><em>VS</em></div><div><TeamLogo url={nextMatch.awayLogoUrl} name={nextMatch.awayTeam} size="hero" /><span className="v5-home-away away">AUSWÄRTS</span><strong>{nextMatch.awayTeam}</strong></div></div>
        <div className="v5-venue">⌖ {nextMatch.venue || "Spielort noch offen"}</div>
        <button className="v5-primary" onClick={onOpenKfvLive}>Spielcenter öffnen <span>›</span></button>
      </> : <div className="v5-empty"><strong>Derzeit kein kommendes Spiel</strong><span>Neue ÖFB-Spiele erscheinen nach der Synchronisierung automatisch.</span></div>}
    </section>

    <section className="v5-stats">
      <button onClick={onOpenKfvLive}><span>Tabellenplatz</span><strong>{standing?.position ?? "–"}<small>.</small></strong><em>{standing?.competitionName || "Kampfmannschaft"}</em></button>
      <button onClick={onOpenKfvLive}><span>Punkte</span><strong>{standing?.points ?? "–"}</strong><em>{standing ? `${standing.played} Spiele` : "Noch keine Tabelle"}</em></button>
      <button onClick={onOpenKfvLive}><span>Letztes Spiel</span><strong className="v5-score">{lastMatch?.homeScore ?? "–"}:{lastMatch?.awayScore ?? "–"}</strong><em>{lastMatch ? (getResultForTsuAinet(lastMatch) === "W" ? "Sieg" : getResultForTsuAinet(lastMatch) === "D" ? "Remis" : "Niederlage") : "Kein Ergebnis"}</em></button>
    </section>

    <div className="v5-heading"><div><span>VEREINSBETRIEB</span><h2>Demnächst</h2></div><button onClick={onOpenCalendar}>Alle Termine</button></div>
    <section className="v5-agenda">
      {loadingEvents ? <div className="v5-loading">Termine werden geladen …</div> : upcomingEvents.length ? upcomingEvents.map((event) => <button key={event.id} onClick={onOpenCalendar}><time><strong>{event.startAt.getDate().toString().padStart(2,"0")}</strong><span>{event.startAt.toLocaleDateString("de-AT",{month:"short"})}</span></time><div><small>{event.teamName}</small><strong>{event.title}</strong><span>{formatTime(event.startAt)} Uhr{event.location ? ` · ${event.location}` : ""}</span></div><b>›</b></button>) : <div className="v5-empty"><strong>Keine Termine eingetragen</strong><span>Trainings, Sitzungen und Veranstaltungen erscheinen hier.</span></div>}
    </section>

    <div className="v5-heading"><div><span>SCHNELLZUGRIFF</span><h2>Vereins-App</h2></div></div>
    <section className="v5-actions">
      <button onClick={onOpenKfvLive}><i>⚽</i><strong>Spiele</strong><span>Ergebnisse & Tabellen</span></button>
      <button onClick={onOpenTeams}><i>♟</i><strong>Teams</strong><span>Kader & Trainer</span></button>
      <button onClick={onOpenNews}><i>◫</i><strong>News</strong><span>Aktuelles vom Verein</span></button>
      <button onClick={onOpenMore}><i>◆</i><strong>Intern</strong><span>Organisation & Verwaltung</span></button>
    </section>

    {nextTraining && <button className="v5-training-strip" onClick={onOpenCalendar}><span>HEUTE IM FOKUS</span><strong>{nextTraining.title}</strong><small>{nextTraining.teamName} · {formatDate(nextTraining.startAt)} · {formatTime(nextTraining.startAt)} Uhr</small><b>›</b></button>}
  </section>;
}
export default LiveDashboard;
