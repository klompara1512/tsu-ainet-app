import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import { Icon, type IconName } from "./Icons";
import TeamLogo from "./TeamLogo";
import {
  getResultForTsuAinet,
  isTsuAinet,
  subscribeKfvMatches,
  subscribeKfvStandings,
  normalizeKfvTeamId,
} from "./kfvFirestore";
import type { KfvMatch, KfvStandingRow } from "./kfvTypes";
import "./Teams.css";

type Team = {
  id: string;
  name: string;
  description: string;
  icon: string;
  order: number;
  active: boolean;
  imageUrl: string;
};

type Player = {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  shirtNumber: number | null;
  order: number;
  active: boolean;
  imageUrl?: string;
  profileUrl?: string;
  official?: boolean;
  birthday: Date | null;
};

type Trainer = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  order: number;
  active: boolean;
  imageUrl?: string;
};

type TeamKey = "km" | "challenge" | "u17" | "u12" | "u10" | "u8";

function normalize(value: string) {
  return value
    .toLocaleLowerCase("de-AT")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function teamKeyFromName(value: string): TeamKey {
  const name = normalize(value);
  if (name.includes("challenge") || name.includes("reserve") || name.includes("kmres") || name.includes("1b")) return "challenge";
  if (name.includes("u17")) return "u17";
  if (name.includes("u12")) return "u12";
  if (name.includes("u10")) return "u10";
  if (name.includes("u8") || name.includes("u08")) return "u8";
  return "km";
}

function teamIcon(name: string): IconName {
  const key = teamKeyFromName(name);
  if (key === "km") return "ball";
  if (key === "challenge") return "shield";
  if (key === "u17") return "users";
  if (key === "u12") return "target";
  if (key === "u10") return "rocket";
  return "sparkles";
}

function leagueLabel(team: Team) {
  const key = teamKeyFromName(team.name);
  if (key === "km") return "1. Klasse West";
  if (key === "challenge") return "Challenge 1. Klasse West";
  if (key === "u17") return "U17";
  if (key === "u12") return "U12";
  if (key === "u10") return "U10";
  if (key === "u8") return "U8";
  return team.description || "TSU Ainet Fußball";
}

function matchBelongsToTeam(match: KfvMatch, team: Team) {
  const wanted = teamKeyFromName(team.name);
  const source = normalize(`${match.teamId} ${match.teamName}`);
  if (wanted === "km") {
    return !/(challenge|reserve|kmres|1b|u17|u12|u10|u8|u08)/.test(source);
  }
  if (wanted === "challenge") return /(challenge|reserve|kmres|1b)/.test(source);
  return source.includes(wanted);
}

function standingBelongsToTeam(row: KfvStandingRow, team: Team) {
  const wanted = teamKeyFromName(team.name);
  const source = normalize(`${row.teamId} ${row.teamName} ${row.competitionName}`);
  if (wanted === "km") {
    return !/(challenge|reserve|kmres|1b|u17|u12|u10|u8|u08)/.test(source);
  }
  if (wanted === "challenge") return /(challenge|reserve|kmres|1b)/.test(source);
  return source.includes(wanted);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("de-AT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}


function readBirthday(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string" && value.trim()) {
    const date = new Date(`${value.trim()}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

function formatBirthday(date: Date | null) {
  if (!date) return "–";
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase() || "?";
}

function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [matches, setMatches] = useState<KfvMatch[]>([]);
  const [standings, setStandings] = useState<KfvStandingRow[]>([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [teamsError, setTeamsError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  useEffect(() => {
    const teamsQuery = query(collection(db, "teams"), orderBy("order", "asc"));
    return onSnapshot(
      teamsQuery,
      (snapshot) => {
        const loadedTeams = snapshot.docs
          .map((teamDocument) => {
            const data = teamDocument.data();
            return {
              id: teamDocument.id,
              name: typeof data.name === "string" ? data.name : "Mannschaft",
              description: typeof data.description === "string" ? data.description : "",
              icon: typeof data.icon === "string" ? data.icon : "",
              order: typeof data.order === "number" ? data.order : 999,
              active: typeof data.active === "boolean" ? data.active : true,
              imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
            } satisfies Team;
          })
          .filter((team) => team.active);
        setTeams(loadedTeams);
        setIsLoadingTeams(false);
        setTeamsError("");
      },
      (error) => {
        console.error("Fehler beim Laden der Mannschaften:", error);
        setTeamsError("Die Mannschaften konnten nicht geladen werden.");
        setIsLoadingTeams(false);
      },
    );
  }, []);

  useEffect(() => subscribeKfvMatches(setMatches, () => setMatches([])), []);
  useEffect(() => subscribeKfvStandings(setStandings, () => setStandings([])), []);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
  );

  useEffect(() => {
    if (!selectedTeamId || !selectedTeam) {
      setPlayers([]);
      setTrainers([]);
      setIsLoadingMembers(false);
      return;
    }

    setIsLoadingMembers(true);
    setMembersError("");
    let playersLoaded = false;
    let trainersLoaded = false;
    const finish = () => playersLoaded && trainersLoaded && setIsLoadingMembers(false);
    const selectedKey = teamKeyFromName(selectedTeam.name);

    const unsubscribePlayers = onSnapshot(
      collection(db, "kfvSquad"),
      (snapshot) => {
        const loadedPlayers = snapshot.docs
          .map((document) => {
            const data = document.data();
            const fullName = typeof data.name === "string" ? data.name.trim() : "";
            const nameParts = fullName.split(/\s+/).filter(Boolean);
            const sourceTeam = normalizeKfvTeamId(`${data.teamId || ""} ${data.teamName || ""}`);
            const selectedOfficialTeam = selectedKey === "km" ? "kampfmannschaft" : selectedKey;
            const belongs = sourceTeam === selectedOfficialTeam;
            return {
              id: document.id,
              firstName: nameParts.slice(0, -1).join(" ") || fullName,
              lastName: nameParts.length > 1 ? nameParts.at(-1) || "" : "",
              position: typeof data.position === "string" ? data.position : "Spieler",
              shirtNumber: typeof data.number === "number" ? data.number : null,
              order: typeof data.number === "number" ? data.number : 999,
              active: typeof data.active === "boolean" ? data.active : true,
              imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
              profileUrl: typeof data.profileUrl === "string" ? data.profileUrl : "",
              official: true,
              birthday: readBirthday(data.birthday ?? data.birthDate ?? data.dateOfBirth),
              belongs,
            };
          })
          .filter((player) => player.active && player.belongs && (player.firstName || player.lastName))
          .sort((a, b) => a.order - b.order || a.lastName.localeCompare(b.lastName, "de-AT"));
        setPlayers(loadedPlayers);
        playersLoaded = true;
        finish();
      },
      (error) => {
        console.error("Fehler beim Laden der Spieler:", error);
        setMembersError("Spieler und Trainer konnten nicht vollständig geladen werden.");
        playersLoaded = true;
        finish();
      },
    );

    const unsubscribeTrainers = onSnapshot(
      collection(db, "teams", selectedTeamId, "trainers"),
      (snapshot) => {
        const loadedTrainers = snapshot.docs
          .map((document) => {
            const data = document.data();
            return {
              id: document.id,
              firstName: typeof data.firstName === "string" ? data.firstName : "",
              lastName: typeof data.lastName === "string" ? data.lastName : "",
              role: typeof data.role === "string" ? data.role : "Trainer",
              order: typeof data.order === "number" ? data.order : 999,
              active: typeof data.active === "boolean" ? data.active : true,
              imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
            } satisfies Trainer;
          })
          .filter((trainer) => trainer.active)
          .sort((a, b) => a.order - b.order || a.lastName.localeCompare(b.lastName, "de-AT"));
        setTrainers(loadedTrainers);
        trainersLoaded = true;
        finish();
      },
      (error) => {
        console.error("Fehler beim Laden der Trainer:", error);
        setMembersError("Spieler und Trainer konnten nicht vollständig geladen werden.");
        trainersLoaded = true;
        finish();
      },
    );

    return () => {
      unsubscribePlayers();
      unsubscribeTrainers();
    };
  }, [selectedTeamId, selectedTeam]);

  const teamMatches = useMemo(
    () => selectedTeam ? matches.filter((match) => matchBelongsToTeam(match, selectedTeam)) : [],
    [matches, selectedTeam],
  );

  const teamStandings = useMemo(
    () => selectedTeam ? standings.filter((row) => standingBelongsToTeam(row, selectedTeam)) : [],
    [standings, selectedTeam],
  );

  const nextMatch = useMemo(
    () => teamMatches
      .filter((match) => match.status === "scheduled" && match.kickoffAt.getTime() >= Date.now())
      .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime())[0] ?? null,
    [teamMatches],
  );

  const finishedMatches = useMemo(
    () => teamMatches
      .filter((match) => match.status === "finished" && match.homeScore !== null && match.awayScore !== null)
      .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime()),
    [teamMatches],
  );

  const form = useMemo(
    () => finishedMatches.slice(0, 5).reverse().map((match) => getResultForTsuAinet(match)),
    [finishedMatches],
  );

  const seasonStats = useMemo(() => {
    const createSplit = () => ({
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });

    const overall = createSplit();
    const home = createSplit();
    const away = createSplit();

    finishedMatches.forEach((match) => {
      const tsuIsHome = isTsuAinet(match.homeTeam);
      const ownGoals = tsuIsHome ? match.homeScore || 0 : match.awayScore || 0;
      const opponentGoals = tsuIsHome ? match.awayScore || 0 : match.homeScore || 0;
      const result = getResultForTsuAinet(match);
      const split = tsuIsHome ? home : away;

      for (const target of [overall, split]) {
        target.played += 1;
        target.goalsFor += ownGoals;
        target.goalsAgainst += opponentGoals;

        if (result === "W") {
          target.won += 1;
          target.points += 3;
        } else if (result === "D") {
          target.drawn += 1;
          target.points += 1;
        } else if (result === "L") {
          target.lost += 1;
        }
      }
    });

    const played = overall.played;
    const pointsPerGame = played ? overall.points / played : 0;
    const goalsPerGame = played ? overall.goalsFor / played : 0;
    const goalsAgainstPerGame = played ? overall.goalsAgainst / played : 0;
    const winRate = played ? (overall.won / played) * 100 : 0;
    const cleanSheets = finishedMatches.filter((match) => {
      const tsuIsHome = isTsuAinet(match.homeTeam);
      const opponentGoals = tsuIsHome ? match.awayScore : match.homeScore;
      return opponentGoals === 0;
    }).length;

    return {
      ...overall,
      home,
      away,
      pointsPerGame,
      goalsPerGame,
      goalsAgainstPerGame,
      winRate,
      cleanSheets,
      goalDifference: overall.goalsFor - overall.goalsAgainst,
    };
  }, [finishedMatches]);

  const tsuStanding = useMemo(
    () => teamStandings.find((row) => isTsuAinet(row.clubName)) ?? null,
    [teamStandings],
  );

  const playerPositions = useMemo(() => {
    const positions = new Set(players.map((player) => player.position.trim()).filter(Boolean));
    return Array.from(positions).sort((a, b) => a.localeCompare(b, "de-AT"));
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const search = normalize(playerSearch);
    return players.filter((player) => {
      const matchesSearch = !search || normalize(`${player.firstName} ${player.lastName} ${player.position} ${player.shirtNumber ?? ""}`).includes(search);
      const matchesPosition = positionFilter === "all" || player.position === positionFilter;
      return matchesSearch && matchesPosition;
    });
  }, [players, playerSearch, positionFilter]);

  function openTeam(teamId: string) {
    setSelectedTeamId(teamId);
    setPlayers([]);
    setTrainers([]);
    setPlayerSearch("");
    setPositionFilter("all");
    setSelectedPlayer(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeTeam() {
    setSelectedTeamId(null);
    setPlayers([]);
    setTrainers([]);
    setPlayerSearch("");
    setPositionFilter("all");
    setSelectedPlayer(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (selectedTeam) {
    return (
      <section className={`team-detail-page team-theme-${teamKeyFromName(selectedTeam.name)}`}>
        <button type="button" className="team-back-button" onClick={closeTeam}>
          <span className="team-back-arrow" aria-hidden="true">‹</span>
          <span>Mannschaften</span>
        </button>

        <div className="team-hub-hero" style={selectedTeam.imageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,25,.28), rgba(7,12,25,.94)), url(${selectedTeam.imageUrl})` } : undefined}>
          <div className="team-hub-brand">
            <TeamLogo name="TSU Ainet" size="hero" className="team-hub-logo" />
            <div>
              <p className="teams-label">TSU Ainet Fußball</p>
              <h2>{selectedTeam.name}</h2>
              <p className="team-hub-league">{leagueLabel(selectedTeam)}</p>
            </div>
          </div>

          <div className="team-hub-summary">
            <div><strong>{tsuStanding?.position ? `#${tsuStanding.position}` : "–"}</strong><span>Tabellenplatz</span></div>
            <div><strong>{players.length}</strong><span>Kader</span></div>
            <div><strong>{seasonStats.played}</strong><span>Spiele</span></div>
          </div>

          <div className="team-form-row" aria-label="Form der letzten fünf Spiele">
            <span>Form</span>
            <div>
              {form.length ? form.map((result, index) => (
                <b key={`${result}-${index}`} className={`team-form team-form-${result?.toLowerCase() || "n"}`}>{result || "–"}</b>
              )) : <small>Noch keine Ergebnisse</small>}
            </div>
          </div>
        </div>

        {membersError && <div className="teams-message teams-error-message"><strong>Firebase-Fehler</strong><p>{membersError}</p></div>}

        <div className="team-hub-actions">
          <button type="button" onClick={() => scrollToSection("team-schedule")}><Icon name="calendar" /><span><strong>Spielplan</strong><small>Spiele & Ergebnisse</small></span></button>
          <button type="button" onClick={() => scrollToSection("team-squad")}><Icon name="users" /><span><strong>Kader</strong><small>Spieler & Trainer</small></span></button>
          <button type="button" onClick={() => scrollToSection("team-table")}><Icon name="table" /><span><strong>Tabelle</strong><small>Aktueller Stand</small></span></button>
          <button type="button" onClick={() => scrollToSection("team-stats")}><Icon name="target" /><span><strong>Statistik</strong><small>Saisonbilanz</small></span></button>
        </div>

        <div className="team-hub-grid" id="team-schedule">
          <article className="team-hub-card team-next-match">
            <div className="team-section-heading"><div><p className="team-card-label">Nächstes Spiel</p><h3>{nextMatch ? `${formatDate(nextMatch.kickoffAt)} · ${formatTime(nextMatch.kickoffAt)} Uhr` : "Noch kein Spiel"}</h3></div><Icon name="ball" /></div>
            {nextMatch ? (
              <>
                <div className="team-next-match-clubs">
                  <div><TeamLogo name={nextMatch.homeTeam} url={nextMatch.homeLogoUrl} clubId={nextMatch.homeClubId} size="large" /><strong>{nextMatch.homeTeam}</strong></div>
                  <span>VS</span>
                  <div><TeamLogo name={nextMatch.awayTeam} url={nextMatch.awayLogoUrl} clubId={nextMatch.awayClubId} size="large" /><strong>{nextMatch.awayTeam}</strong></div>
                </div>
                <p>{nextMatch.venue || (isTsuAinet(nextMatch.homeTeam) ? "Sandgrubenstadion Ainet" : "Auswärtsspiel")}</p>
                {nextMatch.reportUrl && <a href={nextMatch.reportUrl} target="_blank" rel="noreferrer">Zum Spielcenter</a>}
              </>
            ) : <p>Für diese Mannschaft ist derzeit kein kommendes Spiel eingetragen.</p>}
          </article>

          <article className="team-hub-card team-statistics-card" id="team-stats">
            <div className="team-section-heading"><div><p className="team-card-label">Saisonanalyse</p><h3>Mannschaftsstatistik</h3></div><Icon name="target" /></div>

            <div className="team-stat-grid team-stat-grid-primary">
              <div><strong>{seasonStats.played}</strong><span>Spiele</span></div>
              <div><strong>{seasonStats.won}</strong><span>Siege</span></div>
              <div><strong>{seasonStats.drawn}</strong><span>Remis</span></div>
              <div><strong>{seasonStats.lost}</strong><span>Niederlagen</span></div>
            </div>

            <div className="team-performance-grid">
              <div><span>Siegquote</span><strong>{seasonStats.winRate.toFixed(0)} %</strong></div>
              <div><span>Punkte pro Spiel</span><strong>{seasonStats.pointsPerGame.toFixed(2)}</strong></div>
              <div><span>Tore pro Spiel</span><strong>{seasonStats.goalsPerGame.toFixed(2)}</strong></div>
              <div><span>Zu-null-Spiele</span><strong>{seasonStats.cleanSheets}</strong></div>
            </div>

            <div className="team-stat-bars" aria-label="Saisonleistung">
              <div>
                <span><b>Siege</b><em>{seasonStats.won} von {seasonStats.played}</em></span>
                <i><u style={{ width: `${seasonStats.played ? (seasonStats.won / seasonStats.played) * 100 : 0}%` }} /></i>
              </div>
              <div>
                <span><b>Torausbeute</b><em>{seasonStats.goalsFor} Tore</em></span>
                <i><u style={{ width: `${Math.min(100, seasonStats.goalsPerGame * 35)}%` }} /></i>
              </div>
              <div>
                <span><b>Defensive</b><em>{seasonStats.goalsAgainstPerGame.toFixed(2)} Gegentore/Spiel</em></span>
                <i><u style={{ width: `${Math.max(8, 100 - Math.min(100, seasonStats.goalsAgainstPerGame * 45))}%` }} /></i>
              </div>
            </div>

            <div className="team-goal-balance">
              <span>Torverhältnis</span>
              <strong>{seasonStats.goalsFor}:{seasonStats.goalsAgainst}</strong>
              <b className={seasonStats.goalDifference >= 0 ? "positive" : "negative"}>{seasonStats.goalDifference >= 0 ? "+" : ""}{seasonStats.goalDifference}</b>
            </div>
          </article>
        </div>

        <section className="team-home-away-section" aria-labelledby="home-away-title">
          <div className="team-section-title-row">
            <div><p className="team-card-label">Leistungsvergleich</p><h3 id="home-away-title">Heim & Auswärts</h3></div>
            <Icon name="map" />
          </div>
          <div className="team-home-away-grid">
            {([
              { label: "Heim", icon: "shield" as IconName, stats: seasonStats.home },
              { label: "Auswärts", icon: "map" as IconName, stats: seasonStats.away },
            ]).map((entry) => (
              <article key={entry.label} className="team-split-card">
                <header><Icon name={entry.icon} /><div><span>{entry.label}</span><strong>{entry.stats.points} Punkte</strong></div></header>
                <div className="team-split-score"><b>{entry.stats.won}</b><span>Siege</span><b>{entry.stats.drawn}</b><span>Remis</span><b>{entry.stats.lost}</b><span>Niederlagen</span></div>
                <footer><span>{entry.stats.played} Spiele</span><strong>{entry.stats.goalsFor}:{entry.stats.goalsAgainst} Tore</strong></footer>
              </article>
            ))}
          </div>
        </section>

        <div className="team-hub-grid">
          <article className="team-hub-card" id="team-table">
            <div className="team-section-heading"><div><p className="team-card-label">Wettbewerb</p><h3>Top 5 Tabelle</h3></div><Icon name="table" /></div>
            {teamStandings.length ? (
              <div className="team-table-preview">
                {teamStandings.slice(0, 5).map((row) => (
                  <div key={row.id} className={isTsuAinet(row.clubName) ? "is-tsu" : ""}>
                    <span>{row.position}</span><TeamLogo name={row.clubName} url={row.teamLogoUrl} clubId={row.clubId} size="small" /><strong>{row.clubName}</strong><b>{row.points}</b>
                  </div>
                ))}
              </div>
            ) : <p className="team-hub-muted">Für diese Mannschaft ist noch keine Tabelle verfügbar.</p>}
          </article>

          <article className="team-hub-card">
            <div className="team-section-heading"><div><p className="team-card-label">Letzte Spiele</p><h3>Ergebnisse</h3></div><Icon name="live" /></div>
            {finishedMatches.length ? (
              <div className="team-results-preview">
                {finishedMatches.slice(0, 4).map((match) => {
                  const result = getResultForTsuAinet(match);
                  return <div key={match.id}><span className={`team-result-dot team-result-${result?.toLowerCase() || "d"}`}>{result}</span><div><strong>{isTsuAinet(match.homeTeam) ? match.awayTeam : match.homeTeam}</strong><small>{formatDate(match.kickoffAt)}</small></div><b>{match.homeScore}:{match.awayScore}</b></div>;
                })}
              </div>
            ) : <p className="team-hub-muted">Noch keine Endstände vorhanden.</p>}
          </article>
        </div>

        {isLoadingMembers ? (
          <div className="teams-loading"><span className="teams-loading-spinner" /><p>Mannschaftsdaten werden geladen …</p></div>
        ) : (
          <div className="team-members-layout" id="team-squad">
            <article className="team-members-card">
              <div className="team-section-heading"><div><p className="team-card-label">Trainerteam</p><h3>Betreuer</h3></div><span className="team-member-count">{trainers.length}</span></div>
              {trainers.length === 0 ? <div className="team-empty-members"><Icon name="person" /><strong>Noch keine Trainer</strong><p>Trainer können über die Vereinsverwaltung hinzugefügt werden.</p></div> : (
                <div className="team-person-list">
                  {trainers.map((trainer) => <div className="team-person" key={trainer.id}><span className="team-person-avatar">{trainer.imageUrl ? <img src={trainer.imageUrl} alt={`${trainer.firstName} ${trainer.lastName}`} /> : getInitials(trainer.firstName, trainer.lastName)}</span><span className="team-person-info"><strong>{trainer.firstName} {trainer.lastName}</strong><small>{trainer.role}</small></span></div>)}
                </div>
              )}
            </article>

            <article className="team-members-card team-squad-card">
              <div className="team-section-heading"><div><p className="team-card-label">Mannschaft</p><h3>Spielerkader</h3></div><span className="team-member-count">{filteredPlayers.length}/{players.length}</span></div>
              {players.length === 0 ? <div className="team-empty-members"><Icon name="users" /><strong>Noch keine Spieler</strong><p>Für diese Mannschaft wurde noch kein Kader synchronisiert.</p></div> : (
                <>
                  <div className="team-squad-tools">
                    <label className="team-player-search">
                      <Icon name="person" />
                      <input value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Spieler suchen …" aria-label="Spieler suchen" />
                    </label>
                    <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} aria-label="Nach Position filtern">
                      <option value="all">Alle Positionen</option>
                      {playerPositions.map((position) => <option key={position} value={position}>{position}</option>)}
                    </select>
                  </div>

                  {filteredPlayers.length ? (
                    <div className="team-player-grid">
                      {filteredPlayers.map((player) => (
                        <button type="button" className="team-player-card" key={player.id} onClick={() => setSelectedPlayer(player)}>
                          {player.imageUrl ? <img src={player.imageUrl} alt={`${player.firstName} ${player.lastName}`} referrerPolicy="no-referrer" /> : <span className="team-player-card-placeholder">{player.shirtNumber ?? getInitials(player.firstName, player.lastName)}</span>}
                          <div><span>{player.shirtNumber !== null ? `#${player.shirtNumber}` : "TSU"}</span><strong>{player.firstName} {player.lastName}</strong><small>{player.position}</small></div>
                          <span className="team-player-open">Profil öffnen <b>›</b></span>
                        </button>
                      ))}
                    </div>
                  ) : <div className="team-empty-members compact"><Icon name="person" /><strong>Keine Treffer</strong><p>Bitte Suche oder Positionsfilter ändern.</p></div>}
                </>
              )}
            </article>
          </div>
        )}
        {selectedPlayer && (
          <div className="team-player-modal-backdrop" onClick={() => setSelectedPlayer(null)}>
            <article className="team-player-modal" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="team-player-modal-close" onClick={() => setSelectedPlayer(null)} aria-label="Spielerprofil schließen">×</button>
              <div className="team-player-modal-photo">
                {selectedPlayer.imageUrl ? <img src={selectedPlayer.imageUrl} alt={`${selectedPlayer.firstName} ${selectedPlayer.lastName}`} referrerPolicy="no-referrer" /> : <span>{selectedPlayer.shirtNumber ?? getInitials(selectedPlayer.firstName, selectedPlayer.lastName)}</span>}
                <b>{selectedPlayer.shirtNumber !== null ? `#${selectedPlayer.shirtNumber}` : "TSU"}</b>
              </div>
              <div className="team-player-modal-content">
                <p className="team-card-label">{selectedTeam.name}</p>
                <h3>{selectedPlayer.firstName} {selectedPlayer.lastName}</h3>
                <span className="team-player-position-badge">{selectedPlayer.position}</span>
                <div className="team-player-profile-grid">
                  <div><strong>{selectedPlayer.shirtNumber ?? "–"}</strong><span>Nummer</span></div>
                  <div><strong>{formatBirthday(selectedPlayer.birthday)}</strong><span>Geburtstag</span></div>
                  <div><strong>{leagueLabel(selectedTeam)}</strong><span>Mannschaft</span></div>
                </div>
                {!selectedPlayer.birthday && <p className="team-player-birthday-note">Der Geburtstag ist noch nicht hinterlegt und kann in der Vereinsverwaltung ergänzt werden.</p>}
                {selectedPlayer.profileUrl ? <a className="team-player-profile-link" href={selectedPlayer.profileUrl} target="_blank" rel="noreferrer">Offizielles ÖFB-Profil öffnen</a> : <p className="team-player-profile-note">Für diesen Spieler ist aktuell kein externes Profil hinterlegt.</p>}
              </div>
            </article>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="teams-page">
      <div className="teams-header"><div><p className="teams-label">TSU Ainet Fußball</p><h2>Mannschaften</h2><p>Alle Teams auf einen Blick. Öffne eine Mannschaft für Spielplan, Kader, Tabelle und Saisonstatistik.</p></div>{!isLoadingTeams && <span className="teams-total-badge">{teams.length} Mannschaften</span>}</div>
      {teamsError && <div className="teams-message teams-error-message"><strong>Firebase-Fehler</strong><p>{teamsError}</p></div>}
      {isLoadingTeams && <div className="teams-loading"><span className="teams-loading-spinner" /><p>Mannschaften werden geladen …</p></div>}
      {!isLoadingTeams && teams.length > 0 && !teamsError && <div className="teams-grid">{teams.map((team) => {
        const teamRows = standings.filter((row) => standingBelongsToTeam(row, team));
        const position = teamRows.find((row) => isTsuAinet(row.clubName))?.position;
        const next = matches.filter((match) => matchBelongsToTeam(match, team) && match.status === "scheduled" && match.kickoffAt.getTime() >= Date.now()).sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime())[0];
        return <button key={team.id} type="button" className={`team-card team-card-${teamKeyFromName(team.name)}`} onClick={() => openTeam(team.id)}><span className="team-icon"><Icon name={teamIcon(team.name)} /></span><span className="team-info"><small>{leagueLabel(team)}</small><strong>{team.name}</strong><em>{next ? `Nächstes Spiel ${formatDate(next.kickoffAt)}` : "Keine kommenden Spiele"}</em></span><span className="team-card-position">{position ? `#${position}` : "–"}<small>Platz</small></span><span className="team-arrow">›</span></button>;
      })}</div>}
      {!isLoadingTeams && teams.length === 0 && !teamsError && <div className="teams-empty"><span className="teams-empty-mark">TSU</span><h3>Keine Mannschaften vorhanden</h3><p>In Firebase wurden noch keine aktiven Mannschaften gefunden.</p></div>}
    </section>
  );
}

export default Teams;
