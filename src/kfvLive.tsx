import { useEffect, useMemo, useState } from "react";
import {
  getResultForTsuAinet,
  isTsuAinet,
  subscribeKfvMatches,
  subscribeKfvStandings,
  subscribeKfvSquad,
  subscribeKfvMatchReport,
  normalizeKfvTeamId,
} from "./kfvFirestore";
import type { KfvMatch, KfvMatchReport, KfvStandingRow, KfvSquadPlayer } from "./kfvTypes";
import TeamLogo from "./TeamLogo";
import { Icon } from "./Icons";
import "./assets/kfvLive.css";

type KfvLiveTab = "matches" | "table" | "squad";
type KfvLiveProps = { initialMatchId?: string; initialTab?: KfvLiveTab };

function KfvLive({ initialMatchId = "", initialTab = "matches" }: KfvLiveProps) {
  const [matches, setMatches] = useState<KfvMatch[]>([]);
  const [standings, setStandings] = useState<KfvStandingRow[]>([]);
  const [squad, setSquad] = useState<KfvSquadPlayer[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("all");
  const [activeTab, setActiveTab] = useState<KfvLiveTab>(initialTab);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [loadingStandings, setLoadingStandings] = useState(true);
  const [loadingSquad, setLoadingSquad] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<KfvMatch | null>(null);
  const [matchReport, setMatchReport] = useState<KfvMatchReport | null>(null);
  const [loadingMatchReport, setLoadingMatchReport] = useState(false);
  const [matchReportError, setMatchReportError] = useState("");
  const [matchDetailTab, setMatchDetailTab] = useState<"overview" | "live" | "lineups" | "stats">("overview");


  useEffect(() => {
    const unsubscribeMatches = subscribeKfvMatches(
      (data) => {
        setMatches(data);
        setLoadingMatches(false);
      },
      (message) => {
        setErrorMessage(message);
        setLoadingMatches(false);
      },
    );

    const unsubscribeStandings = subscribeKfvStandings(
      (data) => {
        setStandings(data);
        setLoadingStandings(false);
      },
      (message) => {
        setErrorMessage(message);
        setLoadingStandings(false);
      },
    );

    return () => {
      unsubscribeMatches();
      unsubscribeStandings();
    };
  }, []);

  useEffect(() => {
    setLoadingSquad(true);
    return subscribeKfvSquad(
      selectedTeamId,
      (data) => {
        setSquad(data);
        setLoadingSquad(false);
      },
      (message) => {
        setErrorMessage(message);
        setLoadingSquad(false);
      },
    );
  }, [selectedTeamId]);

  useEffect(() => {
    if (!initialMatchId || matches.length === 0) return;
    const requestedMatch = matches.find((match) => match.id === initialMatchId);
    if (requestedMatch) {
      setSelectedTeamId(requestedMatch.teamId || "all");
      setActiveTab("matches");
      setSelectedMatch(requestedMatch);
    }
  }, [initialMatchId, matches]);

  useEffect(() => {
    if (selectedMatch) setMatchDetailTab("overview");
  }, [selectedMatch]);


  useEffect(() => {
    if (!selectedMatch) {
      setMatchReport(null);
      setLoadingMatchReport(false);
      setMatchReportError("");
      return;
    }
    setLoadingMatchReport(true);
    setMatchReportError("");
    return subscribeKfvMatchReport(
      selectedMatch,
      (report) => {
        setMatchReport(report);
        setLoadingMatchReport(false);
      },
      (message) => {
        setMatchReportError(message);
        setLoadingMatchReport(false);
      },
    );
  }, [selectedMatch]);

  const teams = useMemo(() => {
    const fixedTeams = [
      { id: "kampfmannschaft", name: "Kampfmannschaft", order: 1 },
      { id: "challenge", name: "Challenge", order: 2 },
      { id: "u17", name: "U17", order: 3 },
      { id: "u12", name: "U12", order: 4 },
      { id: "u10", name: "U10", order: 5 },
      { id: "u8", name: "U8", order: 6 },
    ];
    const map = new Map(fixedTeams.map((team) => [team.id, team]));

    matches.forEach((match) => {
      if (!match.teamId) return;
      const canonicalId = normalizeKfvTeamId(match.teamId);
      map.set(canonicalId, {
        id: canonicalId,
        name: match.teamName,
        order: map.get(canonicalId)?.order ?? 99,
      });
    });

    standings.forEach((row) => {
      if (!row.teamId) return;
      const canonicalId = normalizeKfvTeamId(row.teamId);
      map.set(canonicalId, {
        id: canonicalId,
        name: row.teamName,
        order: map.get(canonicalId)?.order ?? 99,
      });
    });

    return Array.from(map.values()).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de-AT"));
  }, [matches, standings]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if ((activeTab === "squad" || activeTab === "table") && selectedTeamId === "all" && teams.length > 0) {
      setSelectedTeamId(teams[0].id);
    }
  }, [activeTab, selectedTeamId, teams]);

  const visibleMatches = useMemo(() => {
    const wantedTeamId = selectedTeamId === "all" ? "all" : normalizeKfvTeamId(selectedTeamId);
    return matches.filter((match) => {
      if (wantedTeamId === "all") return true;
      return normalizeKfvTeamId(match.teamId) === wantedTeamId;
    });
  }, [matches, selectedTeamId]);

  const visibleStandings = useMemo(() => {
    const wantedTeamId = selectedTeamId === "all" ? "all" : normalizeKfvTeamId(selectedTeamId);
    return standings.filter((row) => {
      if (wantedTeamId === "all") return true;
      return normalizeKfvTeamId(row.teamId) === wantedTeamId;
    });
  }, [standings, selectedTeamId]);

  const groupedStandings = useMemo(() => {
    const map = new Map<string, KfvStandingRow[]>();

    visibleStandings.forEach((row) => {
      const key = `${row.teamId}__${row.competitionName}`;
      const current = map.get(key) ?? [];
      current.push(row);
      map.set(key, current);
    });

    return Array.from(map.entries()).map(([key, rows]) => ({
      key,
      teamName: rows[0]?.teamName ?? "TSU Ainet",
      competitionName: rows[0]?.competitionName ?? "",
      rows: rows.sort((a, b) => a.position - b.position),
    }));
  }, [visibleStandings]);

  const INVALID_DISPLAY_VENUE = /^(?:termine?|spiele?|spielbericht|aufstellung(?:en)?|tabelle(?:n)?|kader|news|verein|home|mehr|details|navigation|karte|map|route|kontakt|bewerb|runde|heim|gast|geplant|beendet|liveticker|statistik)$/i;

function displayVenue(match: KfvMatch): string {
  const venue = (match.venue || "").replace(/\s+/g, " ").trim();
  const mapAttribution = /\b(?:leaflet|openstreetmap|mapbox|google\s*maps|apple\s*maps|kartendaten|map\s*data|contributors?|urheberrecht|copyright)\b/i.test(venue) || /[©®]/.test(venue);
  if (venue && !INVALID_DISPLAY_VENUE.test(venue) && !mapAttribution) return venue;
  return /ainet/i.test(match.homeTeam || "") ? "Sandgrubenstadion Ainet" : "";
}

function formatDate(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  function formatTime(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function openRoute(match: KfvMatch) {
    const destination = encodeURIComponent(match.venueAddress || displayVenue(match) || "Sandgrubenstadion Ainet");
    window.open(`https://www.google.com/maps/search/?api=1&query=${destination}`, "_blank", "noopener,noreferrer");
  }

  if (selectedMatch) {
    const tsuRow = standings.find((row) =>
      row.teamId === selectedMatch.teamId && isTsuAinet(row.clubName),
    ) ?? null;

    const teamMatches = matches.filter((match) => match.teamId === selectedMatch.teamId);
    const finishedTeamMatches = [...teamMatches]
      .filter((match) => match.status === "finished")
      .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());

    const recentForm = finishedTeamMatches
      .slice(0, 5)
      .reverse()
      .map((match) => getResultForTsuAinet(match))
      .filter((result): result is "W" | "D" | "L" => result !== null);

    const teamTable = standings
      .filter((row) => row.teamId === selectedMatch.teamId)
      .sort((a, b) => a.position - b.position)
      .slice(0, 5);

    const wins = finishedTeamMatches.filter((match) => getResultForTsuAinet(match) === "W").length;
    const draws = finishedTeamMatches.filter((match) => getResultForTsuAinet(match) === "D").length;
    const losses = finishedTeamMatches.filter((match) => getResultForTsuAinet(match) === "L").length;
    const goalsFor = finishedTeamMatches.reduce((sum, match) => {
      if (match.homeScore === null || match.awayScore === null) return sum;
      return sum + (isTsuAinet(match.homeTeam) ? match.homeScore : match.awayScore);
    }, 0);
    const goalsAgainst = finishedTeamMatches.reduce((sum, match) => {
      if (match.homeScore === null || match.awayScore === null) return sum;
      return sum + (isTsuAinet(match.homeTeam) ? match.awayScore : match.homeScore);
    }, 0);

    const now = Date.now();
    const kickoffTime = selectedMatch.kickoffAt.getTime();
    const liveWindow =
      selectedMatch.status === "scheduled" &&
      now >= kickoffTime - 15 * 60_000 &&
      now <= kickoffTime + 150 * 60_000;
    const scoreAvailable =
      selectedMatch.homeScore !== null && selectedMatch.awayScore !== null;

    const statusLabel = selectedMatch.status === "finished"
      ? "Beendet"
      : selectedMatch.status === "postponed"
        ? "Verschoben"
        : selectedMatch.status === "cancelled"
          ? "Abgesagt"
          : liveWindow
            ? "LIVE"
            : "Geplant";


    const reportEvents = matchReport?.events ?? [];
    // Die exakt über die ÖFB-Spiel-ID zugeordnete Berichtseite ist für
    // Spielort/Schiedsrichter die höchste Priorität. So zeigt das Spielcenter
    // keine älteren Match-Felder, wenn bereits offizielle Berichtsdaten vorliegen.
    const authoritativeVenue = matchReport?.venue || displayVenue(selectedMatch);
    const authoritativeReferee = matchReport ? matchReport.referee : selectedMatch.referee;
    const lineupPublished = Boolean(
      matchReport && matchReport.homeLineup.length >= 10 && matchReport.awayLineup.length >= 10
    );
    const eventLabel = (type: string) => ({
      goal: "Tor", yellow: "Gelbe Karte", yellowRed: "Gelb-Rote Karte", red: "Rote Karte",
      substitution: "Wechsel", halfTime: "Halbzeit", fullTime: "Spielende", other: "Ereignis",
    }[type] || "Ereignis");

    const EventSymbol = ({ type }: { type: string }) => {
      const svgProps = { viewBox: "0 0 24 24", width: 19, height: 19, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
      if (type === "goal") return <span className="event-symbol event-symbol-goal" aria-label="Tor"><svg {...svgProps}><circle cx="12" cy="12" r="9"/><path d="m12 7 3.2 2.3-1.2 3.8h-4l-1.2-3.8L12 7Z"/><path d="m8.8 9.3-3.6-.2M15.2 9.3l3.6-.2M10 13.1l-2.1 3M14 13.1l2.1 3M7.9 16.1l.8 3.1M16.1 16.1l-.8 3.1"/></svg></span>;
      if (type === "yellow") return <span className="event-symbol event-symbol-card event-symbol-yellow" aria-label="Gelbe Karte"><i /></span>;
      if (type === "red") return <span className="event-symbol event-symbol-card event-symbol-red" aria-label="Rote Karte"><i /></span>;
      if (type === "yellowRed") return <span className="event-symbol event-symbol-double-card" aria-label="Gelb-Rote Karte"><i /><b /></span>;
      if (type === "substitution") return <span className="event-symbol event-symbol-substitution" aria-label="Wechsel"><svg {...svgProps}><path d="M7 7h10"/><path d="m14 4 3 3-3 3"/><path d="M17 17H7"/><path d="m10 20-3-3 3-3"/></svg></span>;
      if (type === "halfTime") return <span className="event-symbol event-symbol-time" aria-label="Halbzeit"><svg {...svgProps}><circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/></svg></span>;
      if (type === "fullTime") return <span className="event-symbol event-symbol-time" aria-label="Spielende"><svg {...svgProps}><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg></span>;
      return <span className="event-symbol event-symbol-other" aria-label="Ereignis"><svg {...svgProps}><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/></svg></span>;
    };

    const normalizePlayerName = (value: string) => value
      .toLocaleLowerCase("de-AT")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const resolvePlayerImage = (player: KfvMatchReport["homeLineup"][number]) => {
      if (player.imageUrl) return player.imageUrl;
      const wanted = normalizePlayerName(player.name);
      const exact = squad.find((candidate) => normalizePlayerName(candidate.name) === wanted && candidate.imageUrl);
      if (exact?.imageUrl) return exact.imageUrl;
      const wantedTokens = wanted.split(" ").filter(Boolean);
      const partial = squad.find((candidate) => {
        if (!candidate.imageUrl) return false;
        const candidateTokens = normalizePlayerName(candidate.name).split(" ").filter(Boolean);
        return wantedTokens.length >= 2 && candidateTokens.length >= 2 && wantedTokens.every((token) => candidateTokens.includes(token));
      });
      return partial?.imageUrl || "";
    };

    const LineupList = ({ title, players, coach }: { title: string; players: KfvMatchReport["homeLineup"]; coach?: string }) => (
      <article className="official-lineup-card">
        <header><Icon name="users" /><strong>{title}</strong><span>{players.length || "–"}</span></header>
        {players.length ? (
          <ol>{players.map((player, index) => {
            const imageUrl = resolvePlayerImage(player);
            return <li key={`${player.name}-${index}`}><b>{player.number ?? "–"}</b><span className="official-player-photo">{imageUrl ? <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="person" />}</span><div><strong>{player.name}{player.captain ? " (C)" : ""}</strong>{player.position && <small>{player.position}</small>}</div></li>;
          })}</ol>
        ) : <p>Noch nicht veröffentlicht.</p>}
        {coach && <footer><small>Trainer</small><strong>{coach}</strong></footer>}
      </article>
    );

    const tabItems = [
      { id: "overview" as const, label: "Übersicht", icon: "ball" as const },
      { id: "live" as const, label: "Liveticker", icon: "live" as const },
      { id: "lineups" as const, label: "Aufstellungen", icon: "users" as const },
      { id: "stats" as const, label: "Statistik", icon: "target" as const },
    ];

    return (
      <section className="match-detail-page premium-match-center">
        <button
          type="button"
          className="match-detail-back"
          onClick={() => setSelectedMatch(null)}
        >
          ← Zurück zum Spiel- & Tabellenzentrum
        </button>

        <article className="match-detail-hero premium-match-hero">
          <div className="match-detail-competition" aria-label="Spielart">
            <strong>{[selectedMatch.teamName, selectedMatch.competitionName || "KFV-Bewerb"].filter(Boolean).join(" · ")}</strong>
          </div>

          <div className={`premium-match-status status-${selectedMatch.status} ${liveWindow ? "is-live" : ""}`}>
            <span>{liveWindow ? "●" : ""}</span>{statusLabel}
          </div>

          <div className="match-detail-teams premium-match-teams">
            <div className="match-detail-team">
              <TeamLogo url={selectedMatch.homeLogoUrl} name={selectedMatch.homeTeam} clubId={selectedMatch.homeClubId} size="large" />
              <span className="match-detail-badge">H</span>
              <h2 className={isTsuAinet(selectedMatch.homeTeam) ? "tsu" : ""}>
                {selectedMatch.homeTeam}
              </h2>
            </div>

            <div className="match-detail-center premium-score-box">
              <small>{selectedMatch.status === "finished" ? "Endstand" : liveWindow ? "Live" : "Anpfiff"}</small>
              <strong>{scoreAvailable ? `${selectedMatch.homeScore} : ${selectedMatch.awayScore}` : formatTime(selectedMatch.kickoffAt)}</strong>
              <span>{scoreAvailable ? statusLabel : "Uhr"}</span>
            </div>

            <div className="match-detail-team">
              <TeamLogo url={selectedMatch.awayLogoUrl} name={selectedMatch.awayTeam} clubId={selectedMatch.awayClubId} size="large" />
              <span className="match-detail-badge match-detail-badge-away">A</span>
              <h2 className={isTsuAinet(selectedMatch.awayTeam) ? "tsu" : ""}>
                {selectedMatch.awayTeam}
              </h2>
            </div>
          </div>

          <div className="match-detail-meta premium-match-meta">
            <span><Icon name="calendar" /> {formatDate(selectedMatch.kickoffAt)}</span>
            <span><Icon name="clock" /> {formatTime(selectedMatch.kickoffAt)} Uhr</span>
            <span><Icon name="location" /> {authoritativeVenue || "Spielort noch offen"}</span>
          </div>

          <div className="premium-match-actions">
            {displayVenue(selectedMatch) && (
              <button type="button" className="secondary" onClick={() => openRoute(selectedMatch)}>
                <Icon name="location" /> Route starten
              </button>
            )}
            {(selectedMatch.liveUrl || selectedMatch.reportUrl) && (
              <a href={selectedMatch.liveUrl || selectedMatch.reportUrl} target="_blank" rel="noreferrer" className="primary">
                <Icon name="live" /> {liveWindow ? "Liveticker öffnen" : selectedMatch.status === "finished" ? "Spielbericht öffnen" : "Spieldetails öffnen"}
              </a>
            )}
          </div>
        </article>

        <nav className="premium-detail-tabs" role="tablist" aria-label="Spielcenter Bereiche">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={matchDetailTab === tab.id}
              className={matchDetailTab === tab.id ? "active" : ""}
              onClick={() => setMatchDetailTab(tab.id)}
            >
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
              {tab.id === "live" && liveWindow && <b>LIVE</b>}
            </button>
          ))}
        </nav>

        <div className="premium-tab-panel" role="tabpanel">
          {matchDetailTab === "overview" && (
            <>
              <section className="premium-match-section">
                <header>
                  <div>
<h3>Alles auf einen Blick</h3>
                  </div>
                </header>
                <div className="premium-info-grid">
                  <article><Icon name="location" /><small>Spielort</small><strong>{authoritativeVenue || "Noch nicht bekannt"}</strong></article>
                  <article><Icon name="calendar" /><small>Datum</small><strong>{formatDate(selectedMatch.kickoffAt)}</strong></article>
                  <article><Icon name="clock" /><small>Anstoß</small><strong>{formatTime(selectedMatch.kickoffAt)} Uhr</strong></article>
                  <article><Icon name="users" /><small>Schiedsrichter</small><strong>{authoritativeReferee || "Noch nicht veröffentlicht"}</strong></article>
                  {matchReport?.attendance !== null && matchReport?.attendance !== undefined && <article><Icon name="users" /><small>Zuschauer</small><strong>{matchReport.attendance}</strong></article>}
                  <article><Icon name="table" /><small>TSU Tabellenplatz</small><strong>{tsuRow ? `${tsuRow.position}. Platz` : "Noch offen"}</strong></article>
                  <article><Icon name="sync" /><small>Letzte Aktualisierung</small><strong>{selectedMatch.sourceUpdatedAt ? `${formatDate(selectedMatch.sourceUpdatedAt)} · ${formatTime(selectedMatch.sourceUpdatedAt)}` : "Noch nicht verfügbar"}</strong></article>
                </div>
              </section>

              <div className="premium-match-columns">
                <section className="premium-match-section">
                  <header><div>
<h3>Letzte fünf Spiele</h3></div></header>
                  {recentForm.length > 0 ? (
                    <div className="match-detail-form premium-form-row">
                      {recentForm.map((result, index) => (
                        <span key={`${result}-${index}`} className={`form-${result}`}>
                          {result === "W" ? "S" : result === "D" ? "U" : "N"}
                        </span>
                      ))}
                    </div>
                  ) : <p className="premium-muted">Noch keine abgeschlossenen Spiele für die Formkurve.</p>}
                </section>

                <section className="premium-match-section">
                  <header><div>
<h3>Top 5</h3></div></header>
                  {teamTable.length > 0 ? (
                    <div className="premium-mini-table">
                      {teamTable.map((row) => (
                        <div key={row.id} className={isTsuAinet(row.clubName) ? "is-tsu" : ""}>
                          <span>{row.position}.</span>
                          <TeamLogo url={row.teamLogoUrl} name={row.clubName} clubId={row.clubId} size="small" />
                          <strong>{row.clubName}</strong>
                          <b>{row.points}</b>
                        </div>
                      ))}
                    </div>
                  ) : <p className="premium-muted">Für diese Mannschaft ist noch keine Tabelle verfügbar.</p>}
                </section>
              </div>
            </>
          )}

          {matchDetailTab === "live" && (
            <section className="premium-match-section premium-tab-feature">
              <header>
                <div>
<h3>{liveWindow ? "Liveticker" : "Spielverlauf"}</h3></div>
                {liveWindow && <span className="premium-live-pill">LIVE</span>}
              </header>
              {loadingMatchReport ? (
                <div className="premium-empty-state premium-empty-state-large"><Icon name="sync" /><strong>Spielbericht wird geladen …</strong></div>
              ) : matchReportError ? (
                <div className="premium-empty-state premium-empty-state-large"><Icon name="sync" /><strong>{matchReportError}</strong></div>
              ) : reportEvents.length ? (
                <div className="official-event-timeline">
                  {reportEvents.map((event) => (
                    <article key={event.id} className={`event-${event.type} event-${event.team}`}>
                      <time>{event.minuteText || (event.minute !== null ? `${event.minute}'` : "")}</time>
                      <span className="event-marker"><EventSymbol type={event.type} /></span>
                      <div><small>{eventLabel(event.type)}</small><strong>{event.playerName || event.description || eventLabel(event.type)}</strong>{event.secondaryPlayerName && <p>{event.secondaryPlayerName}</p>}</div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="premium-empty-state premium-empty-state-large">
                  <Icon name="live" />
                  <strong>Noch keine offiziellen Ereignisse veröffentlicht</strong>
                  <p>Sobald Tore, Karten oder Wechsel im ÖFB-Spielbericht veröffentlicht sind, erscheinen sie nach dem nächsten Sync hier.</p>
                  {(matchReport?.reportUrl || selectedMatch.liveUrl || selectedMatch.reportUrl) && <a href={matchReport?.reportUrl || selectedMatch.liveUrl || selectedMatch.reportUrl} target="_blank" rel="noreferrer">Offizielle Spielseite öffnen</a>}
                </div>
              )}
            </section>
          )}

          {matchDetailTab === "lineups" && (
            <section className="premium-match-section premium-tab-feature">
              <header>
                <div>
<h3>Aufstellungen</h3></div>
                {matchReport?.sourceUpdatedAt && <span className="report-updated">Stand {formatDate(matchReport.sourceUpdatedAt)} · {formatTime(matchReport.sourceUpdatedAt)}</span>}
              </header>
              {loadingMatchReport ? (
                <div className="premium-empty-state premium-empty-state-large"><Icon name="sync" /><strong>Aufstellungen werden geladen …</strong></div>
              ) : matchReportError ? (
                <div className="premium-empty-state premium-empty-state-large"><Icon name="sync" /><strong>{matchReportError}</strong></div>
              ) : !lineupPublished ? (
                <div className="premium-empty-state premium-empty-state-large">
                  <Icon name="users" />
                  <strong>Aufstellungen noch nicht veröffentlicht</strong>
                  <p>Sobald die offiziellen Startaufstellungen im ÖFB-Spielbericht veröffentlicht sind, werden sie hier automatisch angezeigt.</p>
                  {(matchReport?.reportUrl || selectedMatch.reportUrl) && <a className="official-report-link" href={matchReport?.reportUrl || selectedMatch.reportUrl} target="_blank" rel="noreferrer">Offiziellen ÖFB-Spielbericht öffnen</a>}
                </div>
              ) : (
                <>
                  <div className="official-lineup-grid">
                    <LineupList title={`${selectedMatch.homeTeam} – Startelf`} players={matchReport?.homeLineup ?? []} coach={matchReport?.homeCoach} />
                    <LineupList title={`${selectedMatch.awayTeam} – Startelf`} players={matchReport?.awayLineup ?? []} coach={matchReport?.awayCoach} />
                    <LineupList title={`${selectedMatch.homeTeam} – Ersatzbank`} players={matchReport?.homeBench ?? []} />
                    <LineupList title={`${selectedMatch.awayTeam} – Ersatzbank`} players={matchReport?.awayBench ?? []} />
                  </div>
                  {(matchReport?.reportUrl || selectedMatch.reportUrl) && <a className="official-report-link" href={matchReport?.reportUrl || selectedMatch.reportUrl} target="_blank" rel="noreferrer">Offiziellen ÖFB-Spielbericht öffnen</a>}
                </>
              )}
            </section>
          )}

          {matchDetailTab === "stats" && (
            <>
              <section className="premium-match-section premium-tab-feature">
                <header><div>
<h3>{selectedMatch.teamName}</h3></div></header>
                <div className="premium-stat-grid">
                  <article><small>Spiele</small><strong>{finishedTeamMatches.length}</strong></article>
                  <article><small>Siege</small><strong>{wins}</strong></article>
                  <article><small>Remis</small><strong>{draws}</strong></article>
                  <article><small>Niederlagen</small><strong>{losses}</strong></article>
                  <article><small>Tore</small><strong>{goalsFor}</strong></article>
                  <article><small>Gegentore</small><strong>{goalsAgainst}</strong></article>
                </div>
              </section>

              <div className="premium-match-columns">
                <section className="premium-match-section">
                  <header><div>
<h3>Letzte fünf Spiele</h3></div></header>
                  {recentForm.length > 0 ? (
                    <div className="match-detail-form premium-form-row">
                      {recentForm.map((result, index) => (
                        <span key={`${result}-${index}`} className={`form-${result}`}>
                          {result === "W" ? "S" : result === "D" ? "U" : "N"}
                        </span>
                      ))}
                    </div>
                  ) : <p className="premium-muted">Noch keine Formdaten verfügbar.</p>}
                </section>

                <section className="premium-match-section">
                  <header><div>
<h3>Top 5</h3></div></header>
                  {teamTable.length > 0 ? (
                    <div className="premium-mini-table">
                      {teamTable.map((row) => (
                        <div key={row.id} className={isTsuAinet(row.clubName) ? "is-tsu" : ""}>
                          <span>{row.position}.</span>
                          <TeamLogo url={row.teamLogoUrl} name={row.clubName} clubId={row.clubId} size="small" />
                          <strong>{row.clubName}</strong>
                          <b>{row.points}</b>
                        </div>
                      ))}
                    </div>
                  ) : <p className="premium-muted">Noch keine Tabelle verfügbar.</p>}
                </section>
              </div>
            </>
          )}
        </div>

        <nav className="premium-match-shortcuts" aria-label="Spielcenter Schnellzugriffe">
          <button type="button" onClick={() => setMatchDetailTab("overview")} className={matchDetailTab === "overview" ? "active" : ""}><Icon name="ball" /><span>Übersicht</span></button>
          <button type="button" onClick={() => setMatchDetailTab("live")} className={matchDetailTab === "live" ? "active" : ""}><Icon name="live" /><span>Live</span></button>
          <button type="button" onClick={() => setMatchDetailTab("lineups")} className={matchDetailTab === "lineups" ? "active" : ""}><Icon name="users" /><span>Aufstellung</span></button>
          <button type="button" onClick={() => setMatchDetailTab("stats")} className={matchDetailTab === "stats" ? "active" : ""}><Icon name="target" /><span>Statistik</span></button>
        </nav>
      </section>
    );
  }

  return (
    <section className="kfv-page">
      <header className="kfv-header">
        <div>
          <h2>Spiel- & Tabellenzentrum</h2>
        </div>

      </header>


      <div className="kfv-toolbar">
        <div className="kfv-tabs" role="tablist" aria-label="Spiel- und Tabellenzentrum">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "matches"}
            className={activeTab === "matches" ? "active" : ""}
            onClick={() => setActiveTab("matches")}
          >
            Spiele & Ergebnisse
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "table"}
            className={activeTab === "table" ? "active" : ""}
            onClick={() => setActiveTab("table")}
          >
            Tabellen
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "squad"}
            className={activeTab === "squad" ? "active" : ""}
            onClick={() => setActiveTab("squad")}
          >
            Kader
          </button>
        </div>

        <label>
          <span>Mannschaft</span>
          <select
            value={selectedTeamId}
            onChange={(event) => setSelectedTeamId(event.target.value)}
          >
            {activeTab === "matches" && <option value="all">Alle Mannschaften</option>}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errorMessage && (
        <div className="kfv-message kfv-error">
          <strong>Firebase-Fehler</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {activeTab === "matches" && (
        <>
          {loadingMatches ? (
            <div className="kfv-empty">KFV-Spiele werden geladen …</div>
          ) : visibleMatches.length === 0 ? (
            <div className="kfv-empty">
              <strong>Noch keine KFV-Spiele vorhanden</strong>
              <p>
                Lege Datensätze in der Collection <code>kfvMatches</code> an
                oder verbinde später die automatische Synchronisierung.
              </p>
            </div>
          ) : (
            <div className="kfv-match-list">
              {visibleMatches.map((match) => {
                const result = getResultForTsuAinet(match);

                return (
                  <button
                    type="button"
                    className={`kfv-match-card kfv-match-card-button ${result ? `kfv-match-outcome-${result}` : ""}`}
                    key={match.id}
                    onClick={() => setSelectedMatch(match)}
                  >
                    <div className="kfv-match-meta">
                      <span>{match.teamName}</span>
                      <span>{match.competitionName || "KFV-Bewerb"}</span>
                    </div>

                    <div className="kfv-match-main">
                      <div className={`kfv-team-side ${isTsuAinet(match.homeTeam) ? "tsu" : ""}`}>
                        <TeamLogo url={match.homeLogoUrl} name={match.homeTeam} clubId={match.homeClubId} />
                        <strong>{match.homeTeam}</strong>
                      </div>

                      <div className="kfv-score">
                        {match.status === "finished" &&
                        match.homeScore !== null &&
                        match.awayScore !== null
                          ? `${match.homeScore} : ${match.awayScore}`
                          : formatTime(match.kickoffAt)}
                      </div>

                      <div className={`kfv-team-side ${isTsuAinet(match.awayTeam) ? "tsu" : ""}`}>
                        <TeamLogo url={match.awayLogoUrl} name={match.awayTeam} clubId={match.awayClubId} />
                        <strong>{match.awayTeam}</strong>
                      </div>
                    </div>

                    <div className="kfv-match-footer">
                      <span>{formatDate(match.kickoffAt)}</span>
                      <span>
                        {match.status === "finished"
                          ? `Endstand · Anpfiff ${formatTime(match.kickoffAt)} Uhr`
                          : match.status === "postponed"
                            ? "Verschoben"
                            : match.status === "cancelled"
                              ? "Abgesagt"
                              : `${formatTime(match.kickoffAt)} Uhr`}
                      </span>
                      {displayVenue(match) && <span>{displayVenue(match)}</span>}
                      {result && (
                        <span className={`kfv-result kfv-result-${result}`}>
                          {result === "W" ? "Sieg" : result === "D" ? "Remis" : "Niederlage"}
                        </span>
                      )}
                      {match.reportUrl && (
                        <a
                          href={match.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Spielbericht
                        </a>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeTab === "table" && (
        <>
          {loadingStandings ? (
            <div className="kfv-empty">Tabellen werden geladen …</div>
          ) : groupedStandings.length === 0 ? (
            <div className="kfv-empty">
              <strong>Noch keine Tabellen vorhanden</strong>
              <p>
                Die Tabelle wird aus der Collection{" "}
                <code>kfvStandings</code> geladen.
              </p>
            </div>
          ) : (
            <div className="kfv-table-groups">
              {groupedStandings.map((group) => (
                <article className="kfv-table-card" key={group.key}>
                  <header>
                    <div>
                      <p>{group.teamName}</p>
                      <h3>{group.competitionName || "Tabelle"}</h3>
                    </div>
                  </header>

                  <div className="kfv-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th className="kfv-points-first">Pkt.</th>
                          <th>Verein</th>
                          <th>Sp.</th>
                          <th>S</th>
                          <th>U</th>
                          <th>N</th>
                          <th>Tore</th>
                          <th>Diff.</th>
                          <th>Pkt.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr
                            key={row.id}
                            className={isTsuAinet(row.clubName) ? "is-tsu" : ""}
                          >
                            <td><span className={`kfv-position kfv-position-${row.position}`}>{row.position}</span></td>
                            <td className="kfv-points-first"><strong>{row.points}</strong></td>
                            <td>
                              <div className="kfv-table-club">
                                <TeamLogo url={row.teamLogoUrl} name={row.clubName} clubId={row.clubId} size="small" />
                                <span>{row.clubName}</span>
                              </div>
                            </td>
                            <td>{row.played}</td>
                            <td>{row.won}</td>
                            <td>{row.drawn}</td>
                            <td>{row.lost}</td>
                            <td>
                              {row.goalsFor}:{row.goalsAgainst}
                            </td>
                            <td>{row.goalDifference}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {activeTab === "squad" && (
        <>
          {loadingSquad ? (
            <div className="kfv-empty">Kader wird geladen …</div>
          ) : squad.length === 0 ? (
            <div className="kfv-empty">
              <strong>Noch kein Kader synchronisiert</strong>
              <p>Starte den GitHub-Workflow einmal neu. Danach erscheinen die Spieler aus dem offiziellen ÖFB-Kader.</p>
            </div>
          ) : (
            <div className="kfv-squad-grid">
              {squad.map((player) => (
                <article className="kfv-player-card" key={player.id}>
                  <div className="kfv-player-photo">
                    {player.imageUrl ? (
                      <img src={player.imageUrl} alt={player.name} loading="lazy" />
                    ) : (
                      <span aria-hidden="true">{player.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                    )}
                    {player.number !== null && <strong>#{player.number}</strong>}
                  </div>
                  <div className="kfv-player-info">
                    <small>{player.position}</small>
                    <h3>{player.name}</h3>
                    {player.profileUrl && (
                      <a href={player.profileUrl} target="_blank" rel="noreferrer">
                        ÖFB-Spielerprofil öffnen
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

    </section>
  );
}

export default KfvLive;
