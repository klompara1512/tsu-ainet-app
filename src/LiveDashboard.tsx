import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import AutoFitLogo from "./AutoFitLogo";
import { Icon } from "./Icons";
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

type HeroImage = {
  id: string;
  imageUrl: string;
  order: number;
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
  onOpenStandings: () => void;
  onOpenMatch: (matchId: string) => void;
};

type DashboardStandingTeamKey = "km" | "challenge" | "u17" | "u12" | "u10" | "u8";

const DASHBOARD_STANDING_TEAM_ORDER: DashboardStandingTeamKey[] = [
  "km",
  "challenge",
  "u17",
  "u12",
  "u10",
  "u8",
];

function getStandingTeamKey(row: KfvStandingRow): DashboardStandingTeamKey {
  const text = `${row.teamId} ${row.teamName} ${row.competitionName}`
    .toLocaleLowerCase("de-AT")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim();

  if (text.includes("challenge") || text.includes("reserve") || text.includes(" res ") || text.includes("1b")) return "challenge";
  if (text.includes("u17")) return "u17";
  if (text.includes("u12")) return "u12";
  if (text.includes("u10")) return "u10";
  if (text.includes("u8") || text.includes("u08")) return "u8";
  return "km";
}

function getStandingTeamLabel(key: DashboardStandingTeamKey) {
  if (key === "challenge") return "Challenge";
  if (key === "u17") return "U17";
  if (key === "u12") return "U12";
  if (key === "u10") return "U10";
  if (key === "u8") return "U8";
  return "Kampfmannschaft";
}


function canonicalMatchKey(match: KfvMatch) {
  const day = match.kickoffAt.toISOString().slice(0, 10);
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase("de-AT")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(?:tsu|sg|spg|sv|fc|sc|usv|asko|askö|union|atv|osk|sk|liga)\b/g, " ")
      .replace(/\b(?:1b|ii|reserve|challenge|kampfmannschaft|km)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const teamBucket = getStandingTeamKey({
    teamId: match.teamId,
    teamName: match.teamName,
    competitionName: match.competitionName,
  } as KfvStandingRow);
  const home = match.homeClubId ? `club:${match.homeClubId}` : normalize(match.homeTeam);
  const away = match.awayClubId ? `club:${match.awayClubId}` : normalize(match.awayTeam);
  return [teamBucket, day, home, away].join("|");
}

function preferDashboardMatch(current: KfvMatch, candidate: KfvMatch) {
  const score = (match: KfvMatch) =>
    (match.status === "finished" ? 20 : 0) +
    (match.venue ? 6 : 0) +
    (match.reportUrl ? 4 : 0) +
    (match.homeLogoUrl ? 2 : 0) +
    (match.awayLogoUrl ? 2 : 0);
  return score(candidate) > score(current) ? candidate : current;
}

function LiveDashboard({
  onOpenCalendar,
  onOpenTeams,
  onOpenNews,
  onOpenMore,
  onOpenKfvLive,
  onOpenStandings,
  onOpenMatch,
}: Props) {
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [matches, setMatches] = useState<KfvMatch[]>([]);
  const [standings, setStandings] = useState<KfvStandingRow[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [heroImages, setHeroImages] = useState<HeroImage[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingKfv, setLoadingKfv] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const [selectedStandingTeam, setSelectedStandingTeam] = useState<DashboardStandingTeamKey>(() => {
    if (typeof window === "undefined") return "km";
    const saved = window.localStorage.getItem("tsu-dashboard-standing-team");
    return DASHBOARD_STANDING_TEAM_ORDER.includes(saved as DashboardStandingTeamKey)
      ? (saved as DashboardStandingTeamKey)
      : "km";
  });

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
                title: typeof data.title === "string" ? data.title : "Termin",
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

    const unsubscribeHeroImages = onSnapshot(
      query(collection(db, "visualAssets"), orderBy("order", "asc")),
      (snapshot) => {
        setHeroImages(snapshot.docs.map((document, index) => {
          const data = document.data();
          return {
            id: document.id,
            imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
            order: typeof data.order === "number" ? data.order : index,
            active: data.active !== false,
          } satisfies HeroImage;
        }).filter((item) => item.active && item.imageUrl));
      },
      () => setHeroImages([]),
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
      unsubscribeHeroImages();
      unsubscribeSponsors();
      unsubscribeMatches();
      unsubscribeStandings();
    };
  }, []);

  useEffect(() => {
    if (heroImages.length <= 1) {
      setHeroIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroImages.length);
    }, 9_000);
    return () => window.clearInterval(timer);
  }, [heroImages.length]);

  const uniqueMatches = useMemo(() => {
    const map = new Map<string, KfvMatch>();
    matches.forEach((match) => {
      const key = canonicalMatchKey(match);
      const existing = map.get(key);
      map.set(key, existing ? preferDashboardMatch(existing, match) : match);
    });
    return Array.from(map.values()).sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  }, [matches]);

  const dashboardMatch = useMemo(() => {
    const now = clock.getTime();
    const today = clock.toDateString();
    const liveCandidate = uniqueMatches.find((match) => {
      const kickoff = match.kickoffAt.getTime();
      return match.status === "scheduled" && now >= kickoff - 15 * 60_000 && now <= kickoff + 150 * 60_000;
    });
    if (liveCandidate) return liveCandidate;

    const todayCandidate = uniqueMatches.find(
      (match) => match.kickoffAt.toDateString() === today && match.status !== "cancelled",
    );
    if (todayCandidate) return todayCandidate;

    return uniqueMatches.find(
      (match) =>
        match.kickoffAt.getTime() >= now &&
        match.status !== "cancelled" &&
        match.status !== "postponed",
    ) ?? null;
  }, [uniqueMatches, clock]);

  const nextMatch = dashboardMatch;

  const recentMatches = useMemo(
    () =>
      uniqueMatches
        .filter(
          (match) =>
            match.status === "finished" &&
            match.kickoffAt.getTime() < Date.now() &&
            match.homeScore !== null &&
            match.awayScore !== null,
        )
        .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime())
        .slice(0, 3),
    [uniqueMatches],
  );

  const availableStandingTeams = useMemo(() => {
    const keys = new Set<DashboardStandingTeamKey>();
    standings.forEach((row) => keys.add(getStandingTeamKey(row)));
    return DASHBOARD_STANDING_TEAM_ORDER.filter((key) => keys.has(key));
  }, [standings]);

  useEffect(() => {
    if (!availableStandingTeams.length) return;
    if (!availableStandingTeams.includes(selectedStandingTeam)) {
      setSelectedStandingTeam(availableStandingTeams[0]);
    }
  }, [availableStandingTeams, selectedStandingTeam]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("tsu-dashboard-standing-team", selectedStandingTeam);
    }
  }, [selectedStandingTeam]);

  const selectedTeamStandings = useMemo(
    () => standings
      .filter((row) => getStandingTeamKey(row) === selectedStandingTeam)
      .slice()
      .sort((a, b) => a.position - b.position),
    [standings, selectedStandingTeam],
  );

  const standing = useMemo(
    () => selectedTeamStandings.find((row) => isTsuAinet(row.clubName)) ?? null,
    [selectedTeamStandings],
  );

  const topFive = useMemo(
    () => selectedTeamStandings.slice(0, 5),
    [selectedTeamStandings],
  );

  const upcomingEvents = useMemo(
    () =>
      events
        .filter((event) => event.startAt.getTime() >= clock.getTime())
        .slice(0, 3),
    [events, clock],
  );

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

  const isToday = nextMatch
    ? nextMatch.kickoffAt.toDateString() === clock.toDateString()
    : false;
  const isLive = nextMatch
    ? nextMatch.status === "scheduled" && clock.getTime() >= nextMatch.kickoffAt.getTime() - 15 * 60_000 && clock.getTime() <= nextMatch.kickoffAt.getTime() + 150 * 60_000
    : false;
  const isFinishedToday = Boolean(nextMatch && isToday && nextMatch.status === "finished");
  const scheduledCount = uniqueMatches.filter((match) => match.status === "scheduled" && match.kickoffAt >= clock).length;

  return (
    <section className="v101-home">
      <header
        className={`v101-intro v1825-welcome-hero ${isToday ? "is-matchday" : ""}`}
        style={heroImages[heroIndex]?.imageUrl ? ({ "--hero-image": `url("${heroImages[heroIndex].imageUrl}")` } as CSSProperties) : undefined}
      >
        {heroImages[heroIndex]?.imageUrl && (
          <div className="v183-hero-photo" aria-hidden="true">
            <img src={heroImages[heroIndex].imageUrl} alt="" />
          </div>
        )}
        <div className="v1825-welcome-overlay" />
        {isToday && (
          <div className="v183-matchday-title" aria-label="Matchday TSU Ainet">
            <span>MATCHDAY</span>
            <small>TSU Ainet</small>
          </div>
        )}
        <div className="v1825-welcome-copy">
          <h1>Willkommen bei der TSU Ainet</h1>
          <p className="v1825-since">Since 1966</p>
          <strong className="v1825-slogan">Unsere Farben. Unser Stolz.</strong>
        </div>
        <img className="v183-hero-club-logo" src="/tsu-ainet-logo.png" alt="TSU Ainet Vereinslogo" />
      </header>

      <section className="v101-match-hero">
        <div className="v101-match-head">
          <div>
            <span className="v101-overline">Nächstes Spiel</span>
            <h2>{nextMatch?.teamName || "TSU Ainet"}</h2>
            {nextMatch && <span className={`v104-status ${isLive ? "is-live" : isToday ? "is-today" : ""}`}>{isLive ? "LIVE" : isFinishedToday ? "Beendet" : isToday ? "Heute" : "Geplant"}</span>}
          </div>
          {nextMatch && !isLive && !isFinishedToday && (
            <div className="v101-countdown" aria-label="Countdown zum Spiel">
              <span><strong>{days}</strong><small>Tage</small></span>
              <span><strong>{hours}</strong><small>Std.</small></span>
            </div>
          )}
        </div>

        {loadingKfv ? (
          <div className="v101-empty">ÖFB-Daten werden geladen …</div>
        ) : nextMatch ? (
          <>
            <div className="v101-fixture">
              <div className="v101-team">
                <TeamLogo
                  url={nextMatch.homeLogoUrl}
                  name={nextMatch.homeTeam}
                  size="hero"
                />
                <strong>{nextMatch.homeTeam}</strong>
              </div>

              <div className="v101-kickoff">
                <small>{isFinishedToday ? "Endstand" : isLive ? "LIVE" : formatDate(nextMatch.kickoffAt)}</small>
                <b>{nextMatch.homeScore !== null && nextMatch.awayScore !== null ? `${nextMatch.homeScore}:${nextMatch.awayScore}` : formatTime(nextMatch.kickoffAt)}</b>
                <span>{isLive ? "● LIVE" : isFinishedToday ? "Beendet" : "VS"}</span>
              </div>

              <div className="v101-team">
                <TeamLogo
                  url={nextMatch.awayLogoUrl}
                  name={nextMatch.awayTeam}
                  size="hero"
                />
                <strong>{nextMatch.awayTeam}</strong>
              </div>
            </div>

            <div className="v101-match-meta">
              <span><Icon name="calendar" />{formatDate(nextMatch.kickoffAt)} · {formatTime(nextMatch.kickoffAt)} Uhr</span>
              <span><Icon name="map" />{nextMatch.venue || "Spielort wird vom KFV ergänzt"}</span>
              <span><Icon name="ball" />{isTsuAinet(nextMatch.homeTeam) ? "Heimspiel" : "Auswärtsspiel"}</span>
            </div>

            <button type="button" className="v101-primary" onClick={() => onOpenMatch(nextMatch.id)}>
              {isLive && nextMatch.liveUrl ? "Jetzt zum Liveticker" : isFinishedToday ? "Endstand & Bericht" : "Zum Spielcenter"} <span>›</span>
            </button>
            <small className="v104-data-freshness">{nextMatch.sourceUpdatedAt ? `KFV zuletzt aktualisiert: ${formatDate(nextMatch.sourceUpdatedAt)} · ${formatTime(nextMatch.sourceUpdatedAt)}` : "KFV-Aktualisierung ausständig"}</small>
          </>
        ) : (
          <div className="v101-empty">
            <strong>Kein kommendes Spiel</strong>
            <span>Neue Spiele erscheinen nach der Synchronisierung automatisch.</span>
          </div>
        )}
      </section>

      {sponsors.length > 0 && (
        <section className="v101-sponsors v181-sponsors-prominent" aria-labelledby="dashboard-sponsors-title">
          <div className="v101-card-head">
            <div>
              <span className="v101-overline">Partner</span>
              <h2 id="dashboard-sponsors-title">Unsere Sponsoren</h2>
            </div>
          </div>
          <div className="v181-sponsor-marquee">
            <div className="v101-sponsor-track">
              {[...sponsors, ...sponsors].map((sponsor, index) => (
                <button
                  type="button"
                  key={`${sponsor.id}-${index}`}
                  className={!sponsor.website ? "is-static" : ""}
                  onClick={() => sponsor.website && window.open(sponsor.website, "_blank", "noopener,noreferrer")}
                  aria-label={sponsor.website ? `${sponsor.name} – Website öffnen` : sponsor.name}
                  title={sponsor.website ? `${sponsor.name} – Website öffnen` : sponsor.name}
                >
                  {sponsor.logoUrl ? (
                    <span className="v101-sponsor-logo-frame" aria-hidden="true">
                      <AutoFitLogo src={sponsor.logoUrl} alt="" className="v101-sponsor-logo" />
                    </span>
                  ) : (
                    <strong>{sponsor.name}</strong>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="v182-shop-card v183-shop-showcase" aria-labelledby="dashboard-shop-title">
        <div className="v183-shop-brand" aria-hidden="true">
          <div className="v183-shop-brand-glow" />
          <img
            src="https://www.11teamsports.com/media/3f/b8/52/1639126281/logo.svg"
            alt=""
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="v182-shop-copy v183-shop-copy">
          <h2 id="dashboard-shop-title">Offizieller Clubshop</h2>
          <p>TSU Ainet – trag, was uns verbindet</p>
        </div>

        <a
          className="v182-shop-button v183-shop-button"
          href="https://www.11teamsports.com/at-de/clubshop/tsu-ainet/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="TSU Ainet Vereinsshop bei 11teamsports öffnen"
        >
          Zum Shop <span aria-hidden="true">↗</span>
        </a>
      </section>

      <nav className="v101-shortcuts" aria-label="Schnellzugriffe">
        <button type="button" onClick={onOpenCalendar}>
          <span><Icon name="calendar" /></span>
          <strong>Spiele</strong>
          <small>{scheduledCount} kommende Spiele</small>
        </button>
        <button type="button" onClick={onOpenStandings}>
          <span><Icon name="table" /></span>
          <strong>Tabelle</strong>
          <small>{standing ? `${getStandingTeamLabel(selectedStandingTeam)} · ${standing.position}. Platz · ${standing.points} Punkte` : getStandingTeamLabel(selectedStandingTeam)}</small>
        </button>
        <button type="button" onClick={onOpenTeams}>
          <span><Icon name="users" /></span>
          <strong>Teams</strong>
          <small>5 Mannschaften</small>
        </button>
        <button type="button" onClick={onOpenNews}>
          <span><Icon name="news" /></span>
          <strong>Ankündigungen</strong>
          <small>Wichtige Vereinsinfos</small>
        </button>
      </nav>

      <div className="v101-grid">
        <section className="v101-card">
          <div className="v101-card-head">
            <div><span className="v101-overline">Form</span><h2>Letzte Ergebnisse</h2></div>
            <button type="button" onClick={onOpenKfvLive}>Alle</button>
          </div>

          <div className="v101-results">
            {recentMatches.length ? recentMatches.map((match) => {
              const result = getResultForTsuAinet(match);
              const resultLabel = result === "W" ? "Sieg" : result === "D" ? "Remis" : "Niederlage";
              return (
                <button type="button" key={match.id} onClick={() => onOpenMatch(match.id)}>
                  <TeamLogo url={match.homeLogoUrl} name={match.homeTeam} clubId={match.homeClubId} size="small" />
                  <div><small>{formatDate(match.kickoffAt)}</small><strong>{match.homeTeam}</strong></div>
                  <b className={`v101-score v101-score-${result || "N"}`}>{match.homeScore}:{match.awayScore}</b>
                  <div className="v101-away"><small>{resultLabel}</small><strong>{match.awayTeam}</strong></div>
                  <TeamLogo url={match.awayLogoUrl} name={match.awayTeam} clubId={match.awayClubId} size="small" />
                </button>
              );
            }) : <div className="v101-empty">Noch keine Ergebnisse verfügbar.</div>}
          </div>
        </section>

        <section className="v101-card">
          <div className="v101-card-head v101-table-card-head">
            <div>
              <span className="v101-overline">Tabelle</span>
              <h2>{getStandingTeamLabel(selectedStandingTeam)}</h2>
            </div>
            <div className="v101-table-actions">
              <label className="v101-table-team-select">
                <span>Mannschaft</span>
                <select
                  value={selectedStandingTeam}
                  onChange={(event) => setSelectedStandingTeam(event.target.value as DashboardStandingTeamKey)}
                  aria-label="Mannschaft für Dashboard-Tabelle auswählen"
                >
                  {availableStandingTeams.map((key) => (
                    <option key={key} value={key}>{getStandingTeamLabel(key)}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={onOpenStandings}>Komplett</button>
            </div>
          </div>

          <div className="v101-table">
            {topFive.length ? topFive.map((row) => (
              <button
                type="button"
                key={row.id}
                className={isTsuAinet(row.clubName) ? "is-ainet" : ""}
                onClick={onOpenStandings}
              >
                <span className="v1825-table-position">{row.position}</span>
                <TeamLogo url={row.teamLogoUrl} name={row.clubName} clubId={row.clubId} size="small" />
                <strong>{row.clubName}</strong>
                <small>{row.played} Sp.</small>
                <b className="v1825-table-points">{row.points}</b>
              </button>
            )) : <div className="v101-empty">Für diese Mannschaft ist noch keine Tabelle verfügbar.</div>}
          </div>

          {standing && (
            <div className="v101-standing">
              TSU Ainet: Platz <strong>{standing.position}</strong> · <strong>{standing.points} Punkte</strong>
            </div>
          )}
        </section>
      </div>

      <section className="v101-card">
        <div className="v101-card-head">
          <div><span className="v101-overline">Termine</span><h2>Nächste Termine</h2></div>
          <button type="button" onClick={onOpenCalendar}>Alle</button>
        </div>

        <div className="v101-agenda">
          {loadingEvents ? (
            <div className="v101-empty">Termine werden geladen …</div>
          ) : upcomingEvents.length ? (
            upcomingEvents.map((event) => (
              <button type="button" key={event.id} onClick={onOpenCalendar}>
                <time>
                  <strong>{event.startAt.getDate().toString().padStart(2, "0")}</strong>
                  <span>{event.startAt.toLocaleDateString("de-AT", { month: "short" })}</span>
                </time>
                <div>
                  <small>{event.teamName}</small>
                  <strong>{event.title}</strong>
                  <span>{formatTime(event.startAt)} Uhr{event.location ? ` · ${event.location}` : ""}</span>
                </div>
                <b>›</b>
              </button>
            ))
          ) : (
            <div className="v101-empty">Keine Termine eingetragen.</div>
          )}
        </div>
      </section>



      <button type="button" className="v101-more" onClick={onOpenMore}>
        <span><Icon name="settings" /></span>
        <div><strong>Mehr & Vereinszentrale</strong><small>Dokumente, Organisation und Verwaltung</small></div>
        <b>›</b>
      </button>

    </section>
  );
}

export default LiveDashboard;
