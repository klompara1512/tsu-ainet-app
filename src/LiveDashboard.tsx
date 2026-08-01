import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  getResultForTsuAinet,
  isTsuAinet,
  subscribeKfvMatches,
  subscribeKfvStandings,
} from "./kfvFirestore";
import type { KfvMatch, KfvStandingRow } from "./kfvTypes";
import TeamLogo from "./TeamLogo";
import "./LiveDashboard.css";

type ClubEvent = {
  id: string;
  title: string;
  type: "training" | "match" | "club";
  teamName: string;
  location: string;
  startAt: Date;
  active: boolean;
};

type Sponsor = {
  id: string;
  name: string;
  logoUrl: string;
  website: string;
  active: boolean;
};

type Props = {
  displayName: string;
  onOpenCalendar: () => void;
  onOpenTeams: () => void;
  onOpenNews: () => void;
  onOpenMore: () => void;
  onOpenKfvLive: () => void;
};

function isFirstTeam(value: string) {
  const text = value.toLocaleLowerCase("de-AT");
  return (
    text.includes("kampfmannschaft") ||
    text.includes("1. klasse west") ||
    text === "km"
  );
}

function LiveDashboard({
  displayName,
  onOpenCalendar,
  onOpenTeams,
  onOpenNews,
  onOpenMore,
  onOpenKfvLive,
}: Props) {
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [matches, setMatches] = useState<KfvMatch[]>([]);
  const [standings, setStandings] = useState<KfvStandingRow[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingKfv, setLoadingKfv] = useState(true);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);

    const unsubscribeEvents = onSnapshot(
      query(collection(db, "events"), orderBy("startAt", "asc")),
      (snapshot) => {
        setEvents(
          snapshot.docs
            .map((document) => {
              const data = document.data();
              return {
                id: document.id,
                title:
                  typeof data.title === "string" ? data.title : "Termin",
                type:
                  data.type === "training" ||
                  data.type === "match" ||
                  data.type === "club"
                    ? data.type
                    : "club",
                teamName:
                  typeof data.teamName === "string"
                    ? data.teamName
                    : "Gesamter Verein",
                location:
                  typeof data.location === "string" ? data.location : "",
                startAt:
                  data.startAt instanceof Timestamp
                    ? data.startAt.toDate()
                    : new Date(0),
                active: data.active !== false,
              } satisfies ClubEvent;
            })
            .filter((event) => event.active && event.startAt.getTime() > 0),
        );
        setLoadingEvents(false);
      },
      () => setLoadingEvents(false),
    );

    const unsubscribeSponsors = onSnapshot(
      collection(db, "sponsors"),
      (snapshot) => {
        setSponsors(
          snapshot.docs
            .map((document) => {
              const data = document.data();
              return {
                id: document.id,
                name:
                  typeof data.name === "string"
                    ? data.name.trim()
                    : "Sponsor",
                logoUrl:
                  typeof data.logoUrl === "string"
                    ? data.logoUrl.trim()
                    : "",
                website:
                  typeof data.website === "string"
                    ? data.website.trim()
                    : "",
                active: data.active !== false,
              } satisfies Sponsor;
            })
            .filter((sponsor) => sponsor.active && sponsor.name),
        );
      },
      () => setSponsors([]),
    );

    const unsubscribeMatches = subscribeKfvMatches(
      (data) => {
        setMatches(data);
        setLoadingKfv(false);
      },
      () => setLoadingKfv(false),
    );

    const unsubscribeStandings = subscribeKfvStandings(
      setStandings,
      () => undefined,
    );

    return () => {
      window.clearInterval(timer);
      unsubscribeEvents();
      unsubscribeSponsors();
      unsubscribeMatches();
      unsubscribeStandings();
    };
  }, []);

  const nextMatch = useMemo(
    () =>
      matches.find(
        (match) =>
          match.status === "scheduled" &&
          match.kickoffAt.getTime() >= clock.getTime(),
      ) ?? null,
    [matches, clock],
  );

  const recentMatches = useMemo(
    () =>
      matches
        .filter(
          (match) =>
            match.status === "finished" &&
            match.homeScore !== null &&
            match.awayScore !== null,
        )
        .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime())
        .slice(0, 3),
    [matches],
  );

  const firstTeamStandings = useMemo(() => {
    const matchingRows = standings.filter(
      (row) =>
        isFirstTeam(row.teamName || "") ||
        isFirstTeam(row.competitionName || ""),
    );

    return (matchingRows.length ? matchingRows : standings)
      .slice()
      .sort((a, b) => a.position - b.position);
  }, [standings]);

  const standing = useMemo(
    () => firstTeamStandings.find((row) => isTsuAinet(row.clubName)) ?? null,
    [firstTeamStandings],
  );

  const topFive = useMemo(
    () => firstTeamStandings.slice(0, 5),
    [firstTeamStandings],
  );

  const nextTraining = useMemo(
    () =>
      events.find(
        (event) =>
          event.type === "training" &&
          event.startAt.getTime() >= clock.getTime(),
      ) ?? null,
    [events, clock],
  );

  const upcomingEvents = useMemo(
    () =>
      events
        .filter((event) => event.startAt.getTime() >= clock.getTime())
        .slice(0, 3),
    [events, clock],
  );

  const clubNotice = useMemo(
    () =>
      events.find(
        (event) =>
          event.type === "club" && event.startAt.getTime() >= clock.getTime(),
      ) ?? null,
    [events, clock],
  );

  const dateText = new Intl.DateTimeFormat("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(clock);

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat("de-AT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    }).format(date);

  const formatTime = (date: Date) =>
    new Intl.DateTimeFormat("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const countdown = nextMatch
    ? Math.max(0, nextMatch.kickoffAt.getTime() - clock.getTime())
    : 0;
  const days = Math.floor(countdown / 86_400_000);
  const hours = Math.floor((countdown % 86_400_000) / 3_600_000);

  return (
    <section className="v91-home">
      <section className="v91-welcome">
        <div>
          <span className="v91-kicker">TSU AINET · SAISON 2026/27</span>
          <p>{dateText}</p>
          <h1>Willkommen, {displayName.split(" ")[0]}.</h1>
          <small>Alles Wichtige rund um deinen Verein auf einen Blick.</small>
        </div>
        <img src="/tsu-ainet-logo.png" alt="TSU Ainet Vereinslogo" />
      </section>

      <section className="v91-next-match">
        <div className="v91-section-title">
          <div>
            <span>NÄCHSTES SPIEL</span>
            <h2>{nextMatch?.teamName || "TSU Ainet"}</h2>
          </div>
          {nextMatch && (
            <div className="v91-countdown" aria-label="Countdown zum Spiel">
              <strong>{days}</strong><small>Tage</small>
              <strong>{hours}</strong><small>Std.</small>
            </div>
          )}
        </div>

        {loadingKfv ? (
          <div className="v91-empty">ÖFB-Daten werden geladen …</div>
        ) : nextMatch ? (
          <>
            <div className="v91-fixture">
              <div>
                <TeamLogo
                  url={nextMatch.homeLogoUrl}
                  name={nextMatch.homeTeam}
                  size="hero"
                />
                <strong>{nextMatch.homeTeam}</strong>
              </div>
              <div className="v91-kickoff">
                <b>{formatTime(nextMatch.kickoffAt)}</b>
                <span>{formatDate(nextMatch.kickoffAt)}</span>
                <em>VS</em>
              </div>
              <div>
                <TeamLogo
                  url={nextMatch.awayLogoUrl}
                  name={nextMatch.awayTeam}
                  size="hero"
                />
                <strong>{nextMatch.awayTeam}</strong>
              </div>
            </div>
            <div className="v91-venue">
              <span>📍 {nextMatch.venue || "Spielort noch offen"}</span>
              <span>{isTsuAinet(nextMatch.homeTeam) ? "🏠 Heimspiel" : "🚌 Auswärtsspiel"}</span>
            </div>
            <button className="v91-primary" onClick={onOpenKfvLive}>
              Zum Spielcenter <span>›</span>
            </button>
          </>
        ) : (
          <div className="v91-empty">
            <strong>Derzeit kein kommendes Spiel</strong>
            <span>Neue Spiele erscheinen nach der Synchronisierung automatisch.</span>
          </div>
        )}
      </section>

      <section className="v91-shortcuts" aria-label="Schnellzugriffe">
        <button onClick={onOpenCalendar}><i>📅</i><strong>Spielplan</strong><span>Alle Spiele</span></button>
        <button onClick={onOpenKfvLive}><i>📊</i><strong>Tabelle</strong><span>1. Klasse West</span></button>
        <button onClick={onOpenTeams}><i>👥</i><strong>Teams</strong><span>Kader & Trainer</span></button>
        <button onClick={onOpenNews}><i>📰</i><strong>News</strong><span>Aktuelles</span></button>
        <button onClick={onOpenMore}><i>📷</i><strong>Galerie</strong><span>Medienbereich</span></button>
        <button onClick={onOpenMore}><i>🏆</i><strong>Verein</strong><span>TSU Ainet</span></button>
        <button onClick={onOpenMore} className="v91-shortcut-wide"><i>⚙️</i><strong>Vereinszentrale</strong><span>Organisation & Verwaltung</span></button>
      </section>

      <div className="v91-two-column">
        <section className="v91-panel">
          <div className="v91-panel-heading">
            <div><span>FORM</span><h2>Letzte Ergebnisse</h2></div>
            <button onClick={onOpenKfvLive}>Alle Spiele</button>
          </div>
          <div className="v91-results">
            {recentMatches.length ? recentMatches.map((match) => {
              const result = getResultForTsuAinet(match);
              return (
                <button key={match.id} onClick={onOpenKfvLive}>
                  <TeamLogo url={match.homeLogoUrl} name={match.homeTeam} size="small" />
                  <div><small>{formatDate(match.kickoffAt)}</small><strong>{match.homeTeam}</strong></div>
                  <b className={`v91-result-${result || "N"}`}>{match.homeScore}:{match.awayScore}</b>
                  <div className="v91-away-team"><small>{result === "W" ? "Sieg" : result === "D" ? "Remis" : "Niederlage"}</small><strong>{match.awayTeam}</strong></div>
                  <TeamLogo url={match.awayLogoUrl} name={match.awayTeam} size="small" />
                </button>
              );
            }) : <div className="v91-empty">Noch keine Ergebnisse verfügbar.</div>}
          </div>
        </section>

        <section className="v91-panel">
          <div className="v91-panel-heading">
            <div><span>1. KLASSE WEST</span><h2>Tabellenvorschau</h2></div>
            <button onClick={onOpenKfvLive}>Gesamte Tabelle</button>
          </div>
          <div className="v91-table-preview">
            {topFive.length ? topFive.map((row) => (
              <button
                key={row.id}
                className={isTsuAinet(row.clubName) ? "is-ainet" : ""}
                onClick={onOpenKfvLive}
              >
                <span>{row.position}</span>
                <TeamLogo url={row.teamLogoUrl} name={row.clubName} size="small" />
                <strong>{row.clubName}</strong>
                <small>{row.played} Sp.</small>
                <b>{row.points}</b>
              </button>
            )) : <div className="v91-empty">Noch keine Tabelle verfügbar.</div>}
          </div>
          {standing && (
            <div className="v91-standing-summary">
              TSU Ainet aktuell auf Platz <strong>{standing.position}</strong> mit <strong>{standing.points} Punkten</strong>.
            </div>
          )}
        </section>
      </div>

      <section className="v91-panel">
        <div className="v91-panel-heading">
          <div><span>VEREINSLEBEN</span><h2>Nächste Termine</h2></div>
          <button onClick={onOpenCalendar}>Alle Termine</button>
        </div>
        <div className="v91-agenda">
          {loadingEvents ? (
            <div className="v91-empty">Termine werden geladen …</div>
          ) : upcomingEvents.length ? (
            upcomingEvents.map((event) => (
              <button key={event.id} onClick={onOpenCalendar}>
                <time><strong>{event.startAt.getDate().toString().padStart(2, "0")}</strong><span>{event.startAt.toLocaleDateString("de-AT", { month: "short" })}</span></time>
                <div><small>{event.teamName}</small><strong>{event.title}</strong><span>{formatTime(event.startAt)} Uhr{event.location ? ` · ${event.location}` : ""}</span></div>
                <b>›</b>
              </button>
            ))
          ) : (
            <div className="v91-empty">Keine Termine eingetragen.</div>
          )}
        </div>
      </section>

      <section className="v91-club-info" onClick={onOpenCalendar} role="button" tabIndex={0}>
        <div><span>VEREINSINFO</span><h2>{clubNotice?.title || "60 Jahre Sportunion Ainet"}</h2><p>{clubNotice ? `${formatDate(clubNotice.startAt)} · ${formatTime(clubNotice.startAt)} Uhr${clubNotice.location ? ` · ${clubNotice.location}` : ""}` : "Tradition, Gemeinschaft und Sport seit 1966."}</p></div>
        <b>›</b>
      </section>

      {nextTraining && (
        <button className="v91-focus" onClick={onOpenCalendar}>
          <span>HEUTE IM FOKUS</span>
          <strong>{nextTraining.title}</strong>
          <small>{nextTraining.teamName} · {formatDate(nextTraining.startAt)} · {formatTime(nextTraining.startAt)} Uhr</small>
          <b>›</b>
        </button>
      )}

      {sponsors.length > 0 && (
        <section className="v91-sponsors">
          <div className="v91-panel-heading"><div><span>PARTNER</span><h2>Unsere Sponsoren</h2></div></div>
          <div className="v91-sponsor-track">
            {[...sponsors, ...sponsors].map((sponsor, index) => (
              <button
                type="button"
                key={`${sponsor.id}-${index}`}
                onClick={() => sponsor.website && window.open(sponsor.website, "_blank", "noopener,noreferrer")}
                aria-label={sponsor.name}
              >
                {sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={sponsor.name} loading="lazy" /> : <strong>{sponsor.name}</strong>}
              </button>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

export default LiveDashboard;
