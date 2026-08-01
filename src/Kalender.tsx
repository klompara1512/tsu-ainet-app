import { useEffect, useMemo, useState } from "react";
import {
  getKfvClubLogo,
  isTsuAinet,
  subscribeKfvClubs,
  subscribeKfvMatches,
} from "./kfvFirestore";
import type { KfvClub, KfvMatch, KfvMatchStatus } from "./kfvTypes";
import "./Kalender.css";

type CalendarView = "month" | "list";

type CalendarDay = {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  matches: KfvMatch[];
};

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const TSU_AINET_LOGO = "/tsu-ainet-logo.png";

const CLUB_FALLBACK_LOGO =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140">
      <path d="M60 5 L108 22 V70 C108 101 89 124 60 136 C31 124 12 101 12 70 V22 Z" fill="#18243a" stroke="#7f8ca5" stroke-width="6"/>
      <circle cx="60" cy="61" r="25" fill="#eef2f8"/>
      <path d="M60 39 72 48 68 63 52 63 48 48Z M52 63 42 76 52 88 68 88 78 76 68 63Z" fill="#18243a"/>
    </svg>
  `);

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(firstDate: Date, secondDate: Date) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeTeamName(value: string) {
  return value
    .toLocaleLowerCase("de-AT")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTeamKey(match: KfvMatch) {
  const text = normalizeTeamName(`${match.teamId} ${match.teamName}`);
  if (text.includes("challenge") || text.includes("reserve") || text.includes("1b")) return "challenge";
  if (text.includes("u17")) return "u17";
  if (text.includes("u12")) return "u12";
  if (text.includes("u10")) return "u10";
  if (text.includes("u8")) return "u8";
  return "km";
}

function getTeamLabel(match: KfvMatch) {
  const key = getTeamKey(match);
  if (key === "challenge") return "Challenge";
  if (key === "u17") return "U17";
  if (key === "u12") return "U12";
  if (key === "u10") return "U10";
  if (key === "u8") return "U8";
  return "Kampfmannschaft";
}

function getCompetitionLabel(match: KfvMatch) {
  const key = getTeamKey(match);

  if (key === "km") return "1. Klasse West";
  if (key === "challenge") return "Challenge 1. Klasse West";
  if (key === "u17") return "U17";
  if (key === "u12") return "U12";
  if (key === "u10") return "U10";
  if (key === "u8") return "U8";

  return match.competitionName || match.teamName || "TSU Ainet";
}

function getTeamColorClass(match: KfvMatch) {
  return `calendar-team-${getTeamKey(match)}`;
}

function getStatusLabel(status: KfvMatchStatus) {
  if (status === "finished") return "Beendet";
  if (status === "postponed") return "Verschoben";
  if (status === "cancelled") return "Abgesagt";
  return "Geplant";
}

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("de-AT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function getScore(match: KfvMatch) {
  if (match.homeScore === null || match.awayScore === null) return null;
  return `${match.homeScore}:${match.awayScore}`;
}

function getOpponent(match: KfvMatch) {
  return isTsuAinet(match.homeTeam) ? match.awayTeam : match.homeTeam;
}

function getHomeAwayLabel(match: KfvMatch) {
  return isTsuAinet(match.homeTeam) ? "Heimspiel" : "Auswärtsspiel";
}

function localClubLogo(teamName: string) {
  const normalized = normalizeTeamName(teamName)
    .replace(/\b(tsu|spg|fc|sv|usc|union|sektion)\b/g, " ")
    .replace(/ö/g, "oe")
    .replace(/ä/g, "ae")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();

  const localLogos: Record<string, string> = {
    doelsach: "/logos/clubs/doelsach.png",
  };

  return localLogos[normalized] || "";
}

function buildLogoCandidates(
  clubs: KfvClub[],
  teamName: string,
  matchLogoUrl?: string,
) {
  if (isTsuAinet(teamName)) return [TSU_AINET_LOGO];

  const candidates = [
    localClubLogo(teamName),
    getKfvClubLogo(clubs, teamName, ""),
    typeof matchLogoUrl === "string" ? matchLogoUrl.trim() : "",
    CLUB_FALLBACK_LOGO,
  ];

  return candidates.filter(
    (value, index, values) => Boolean(value) && values.indexOf(value) === index,
  );
}

function TeamLogo({
  clubs,
  name,
  src,
  className = "calendar-club-logo",
}: {
  clubs: KfvClub[];
  name: string;
  src?: string;
  className?: string;
}) {
  const candidates = useMemo(
    () => buildLogoCandidates(clubs, name, src),
    [clubs, name, src],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidates]);

  return (
    <img
      className={className}
      src={candidates[candidateIndex] || CLUB_FALLBACK_LOGO}
      alt={`${name} Logo`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setCandidateIndex((current) =>
          Math.min(current + 1, Math.max(candidates.length - 1, 0)),
        );
      }}
    />
  );
}

function Kalender() {
  const [matches, setMatches] = useState<KfvMatch[]>([]);
  const [clubs, setClubs] = useState<KfvClub[]>([]);
  const [selectedTeam, setSelectedTeam] = useState("all");
  const [view, setView] = useState<CalendarView>("month");
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [selectedMatch, setSelectedMatch] = useState<KfvMatch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(
    () =>
      subscribeKfvMatches(
        (loadedMatches) => {
          setMatches(loadedMatches);
          setIsLoading(false);
          setErrorMessage("");
        },
        (message) => {
          setErrorMessage(message);
          setIsLoading(false);
        },
      ),
    [],
  );

  useEffect(
    () => subscribeKfvClubs(setClubs),
    [],
  );

  const availableTeams = useMemo(() => {
    const values = new Map<string, string>();
    matches.forEach((match) => values.set(getTeamKey(match), getTeamLabel(match)));
    const order = ["km", "challenge", "u17", "u12", "u10", "u8"];
    return Array.from(values.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [matches]);

  const filteredMatches = useMemo(
    () => matches.filter((match) => selectedTeam === "all" || getTeamKey(match) === selectedTeam),
    [matches, selectedTeam],
  );

  const calendarDays = useMemo<CalendarDay[]>(() => {
    const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const firstWeekday = (monthStart.getDay() + 6) % 7;
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - firstWeekday);
    const today = startOfDay(new Date());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return {
        date,
        isCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
        isToday: sameDay(date, today),
        matches: filteredMatches.filter((match) => sameDay(match.kickoffAt, date)),
      };
    });
  }, [filteredMatches, visibleMonth]);

  const selectedDayMatches = useMemo(
    () => filteredMatches.filter((match) => sameDay(match.kickoffAt, selectedDate)),
    [filteredMatches, selectedDate],
  );

  const upcomingMatches = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return filteredMatches
      .filter((match) => match.kickoffAt.getTime() >= today)
      .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  }, [filteredMatches]);

  const monthMatchCount = useMemo(
    () => filteredMatches.filter((match) => monthKey(match.kickoffAt) === monthKey(visibleMonth)).length,
    [filteredMatches, visibleMonth],
  );

  function changeMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function goToToday() {
    const now = new Date();
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(startOfDay(now));
  }

  function renderMatchCard(match: KfvMatch, compact = false) {
    const score = getScore(match);
    return (
      <article
        key={match.id}
        className={`calendar-agenda-event calendar-agenda-match ${getTeamColorClass(match)} ${compact ? "compact" : ""}`}
        onClick={() => setSelectedMatch(match)}
      >
        <div className="calendar-card-logos">
          <TeamLogo clubs={clubs} name={match.homeTeam} src={match.homeLogoUrl} />
          <span>{score || "VS"}</span>
          <TeamLogo clubs={clubs} name={match.awayTeam} src={match.awayLogoUrl} />
        </div>
        <div className="calendar-agenda-content">
          <div className="calendar-agenda-topline">
            <span>{getHomeAwayLabel(match)}</span>
            <small>{getCompetitionLabel(match)}</small>
          </div>
          <h3>{match.homeTeam} – {match.awayTeam}</h3>
          <div className="calendar-match-statusline">
            <span>{formatTime(match.kickoffAt)} Uhr</span>
            <strong>{getStatusLabel(match.status)}</strong>
          </div>
          {!compact && (
            <div className="calendar-agenda-meta">
              {match.venue && <span>📍 {match.venue}</span>}
              {match.reportUrl && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    window.open(match.reportUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  Spielbericht
                </button>
              )}
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="calendar-page">
      <div className="calendar-header">
        <div>
          <p className="calendar-eyebrow">TSU Ainet Fußball</p>
          <h2>Spielkalender</h2>
          <p>Alle offiziellen Spiele mit Vereinslogos, Gegner, Ergebnis und Spielbericht.</p>
        </div>
        <span className="calendar-count">{filteredMatches.length} Spiele</span>
      </div>

      <div className="calendar-toolbar calendar-toolbar-games">
        <div className="calendar-filters">
          <button type="button" className={selectedTeam === "all" ? "active" : ""} onClick={() => setSelectedTeam("all")}>Alle</button>
          {availableTeams.map((team) => (
            <button type="button" key={team.id} className={selectedTeam === team.id ? "active" : ""} onClick={() => setSelectedTeam(team.id)}>{team.name}</button>
          ))}
        </div>
      </div>

      <div className="calendar-viewbar">
        <div className="calendar-month-nav">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Vorheriger Monat">‹</button>
          <div>
            <strong>{formatMonthTitle(visibleMonth)}</strong>
            <small>{monthMatchCount} Spiele in diesem Monat</small>
          </div>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Nächster Monat">›</button>
          <button type="button" className="calendar-today" onClick={goToToday}>Heute</button>
        </div>
        <div className="calendar-view-switch">
          <button type="button" className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Monat</button>
          <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Liste</button>
        </div>
      </div>

      {errorMessage && <div className="calendar-message calendar-error"><strong>Firebase-Fehler</strong><p>{errorMessage}</p></div>}
      {isLoading && <div className="calendar-loading"><span className="calendar-spinner" /><p>Spiele werden geladen …</p></div>}

      {!isLoading && view === "month" && !errorMessage && (
        <div className="calendar-month-layout">
          <div className="calendar-month-card">
            <div className="calendar-weekdays">{DAY_NAMES.map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">
              {calendarDays.map((day) => (
                <button
                  type="button"
                  key={day.date.toISOString()}
                  className={`calendar-day ${!day.isCurrentMonth ? "muted" : ""} ${day.isToday ? "today" : ""} ${sameDay(day.date, selectedDate) ? "selected" : ""}`}
                  onClick={() => setSelectedDate(startOfDay(day.date))}
                >
                  <span className="calendar-day-number">{day.date.getDate()}</span>
                  <div className="calendar-day-events">
                    {day.matches.slice(0, 2).map((match) => {
                      const opponent = getOpponent(match);
                      const opponentLogo = isTsuAinet(match.homeTeam) ? match.awayLogoUrl : match.homeLogoUrl;
                      return (
                        <span key={match.id} className={`calendar-day-event calendar-day-match ${getTeamColorClass(match)}`}>
                          <TeamLogo
                            clubs={clubs}
                            name={opponent}
                            src={opponentLogo}
                            className="calendar-day-club-logo"
                          />
                          <b>{formatTime(match.kickoffAt)}</b> {opponent}
                        </span>
                      );
                    })}
                    {day.matches.length > 2 && <small>+ {day.matches.length - 2} weitere</small>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <aside className="calendar-day-panel">
            <div className="calendar-day-panel-header"><span>Ausgewählter Tag</span><h3>{formatLongDate(selectedDate)}</h3></div>
            <div className="calendar-day-agenda">
              {selectedDayMatches.length > 0
                ? selectedDayMatches.map((match) => renderMatchCard(match, true))
                : <div className="calendar-day-empty"><span>⚽</span><strong>Keine Spiele</strong><p>An diesem Tag findet kein offizielles Spiel statt.</p></div>}
            </div>
          </aside>
        </div>
      )}

      {!isLoading && view === "list" && !errorMessage && (
        <div className="calendar-list-view">
          {upcomingMatches.length > 0
            ? upcomingMatches.map((match) => (
                <section className="calendar-list-day" key={match.id}>
                  <div className="calendar-list-date"><strong>{formatShortDate(match.kickoffAt)}</strong></div>
                  {renderMatchCard(match)}
                </section>
              ))
            : <div className="calendar-empty"><span>⚽</span><h3>Keine kommenden Spiele</h3><p>Für die gewählte Mannschaft sind aktuell keine kommenden Spiele vorhanden.</p></div>}
        </div>
      )}

      {selectedMatch && (
        <div className="calendar-modal-backdrop" onClick={() => setSelectedMatch(null)}>
          <article className="calendar-match-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="calendar-modal-close" onClick={() => setSelectedMatch(null)} aria-label="Schließen">×</button>
            <span className="calendar-modal-league">{getCompetitionLabel(selectedMatch)}</span>
            <span className={`calendar-home-away ${isTsuAinet(selectedMatch.homeTeam) ? "home" : "away"}`}>{getHomeAwayLabel(selectedMatch)}</span>
            <div className="calendar-modal-teams">
              <div><TeamLogo clubs={clubs} name={selectedMatch.homeTeam} src={selectedMatch.homeLogoUrl} /><strong>{selectedMatch.homeTeam}</strong></div>
              <div className="calendar-modal-score">{getScore(selectedMatch) || "VS"}</div>
              <div><TeamLogo clubs={clubs} name={selectedMatch.awayTeam} src={selectedMatch.awayLogoUrl} /><strong>{selectedMatch.awayTeam}</strong></div>
            </div>
            <div className="calendar-modal-details">
              <span>📅 {formatLongDate(selectedMatch.kickoffAt)}</span>
              <span>🕒 {formatTime(selectedMatch.kickoffAt)} Uhr</span>
              {selectedMatch.venue && <span>📍 {selectedMatch.venue}</span>}
              <span>Status: {getStatusLabel(selectedMatch.status)}</span>
            </div>
            {selectedMatch.reportUrl && (
              <button type="button" className="calendar-report-button" onClick={() => window.open(selectedMatch.reportUrl, "_blank", "noopener,noreferrer")}>Offiziellen Spielbericht öffnen</button>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

export default Kalender;
