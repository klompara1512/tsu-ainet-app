import { useEffect, useMemo, useState } from "react";
import {
  getResultForTsuAinet,
  isTsuAinet,
  subscribeKfvMatches,
  subscribeKfvStandings,
  subscribeKfvSquad,
} from "./kfvFirestore";
import type { KfvMatch, KfvStandingRow, KfvSquadPlayer } from "./kfvTypes";
import TeamLogo from "./TeamLogo";
import { Icon } from "./Icons";
import "./assets/kfvLive.css";

type KfvLiveProps = { initialMatchId?: string };

function KfvLive({ initialMatchId = "" }: KfvLiveProps) {
  const [matches, setMatches] = useState<KfvMatch[]>([]);
  const [standings, setStandings] = useState<KfvStandingRow[]>([]);
  const [squad, setSquad] = useState<KfvSquadPlayer[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("all");
  const [activeTab, setActiveTab] =
    useState<"matches" | "table" | "squad">("matches");
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [loadingStandings, setLoadingStandings] = useState(true);
  const [loadingSquad, setLoadingSquad] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<KfvMatch | null>(null);


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

    const unsubscribeSquad = subscribeKfvSquad(
      (data) => {
        setSquad(data);
        setLoadingSquad(false);
      },
      (message) => {
        setErrorMessage(message);
        setLoadingSquad(false);
      },
    );

    return () => {
      unsubscribeMatches();
      unsubscribeStandings();
      unsubscribeSquad();
    };
  }, []);

  useEffect(() => {
    if (!initialMatchId || matches.length === 0) return;
    const requestedMatch = matches.find((match) => match.id === initialMatchId);
    if (requestedMatch) {
      setSelectedTeamId(requestedMatch.teamId || "all");
      setActiveTab("matches");
      setSelectedMatch(requestedMatch);
    }
  }, [initialMatchId, matches]);

  const teams = useMemo(() => {
    const map = new Map<string, string>();

    matches.forEach((match) => {
      if (match.teamId) map.set(match.teamId, match.teamName);
    });

    standings.forEach((row) => {
      if (row.teamId) map.set(row.teamId, row.teamName);
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "de-AT"));
  }, [matches, standings]);

  const visibleMatches = useMemo(() => {
    return matches.filter(
      (match) =>
        selectedTeamId === "all" ||
        match.teamId === selectedTeamId,
    );
  }, [matches, selectedTeamId]);

  const visibleStandings = useMemo(() => {
    return standings.filter(
      (row) =>
        selectedTeamId === "all" ||
        row.teamId === selectedTeamId,
    );
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
    const destination = encodeURIComponent(match.venueAddress || match.venue || "Sandgrubenstadion Ainet");
    window.open(`https://www.google.com/maps/search/?api=1&query=${destination}`, "_blank", "noopener,noreferrer");
  }

  if (selectedMatch) {
    const tsuRow = standings.find((row) =>
      row.teamId === selectedMatch.teamId && isTsuAinet(row.clubName),
    ) ?? null;

    const teamMatches = matches.filter((match) => match.teamId === selectedMatch.teamId);
    const recentForm = [...teamMatches]
      .filter((match) => match.status === "finished")
      .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime())
      .slice(0, 5)
      .reverse()
      .map((match) => getResultForTsuAinet(match))
      .filter((result): result is "W" | "D" | "L" => result !== null);

    const teamTable = standings
      .filter((row) => row.teamId === selectedMatch.teamId)
      .sort((a, b) => a.position - b.position)
      .slice(0, 5);

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

    return (
      <section className="match-detail-page premium-match-center">
        <button
          type="button"
          className="match-detail-back"
          onClick={() => setSelectedMatch(null)}
        >
          ← Zurück zu KFV Live
        </button>

        <article className="match-detail-hero premium-match-hero">
          <div className="match-detail-competition">
            <span>{selectedMatch.teamName}</span>
            <strong>{selectedMatch.competitionName || "KFV-Bewerb"}</strong>
          </div>

          <div className={`premium-match-status status-${selectedMatch.status} ${liveWindow ? "is-live" : ""}`}>
            <span>{liveWindow ? "●" : ""}</span>{statusLabel}
          </div>

          <div className="match-detail-teams premium-match-teams">
            <div className="match-detail-team">
              <TeamLogo url={selectedMatch.homeLogoUrl} name={selectedMatch.homeTeam} size="large" />
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
              <TeamLogo url={selectedMatch.awayLogoUrl} name={selectedMatch.awayTeam} size="large" />
              <span className="match-detail-badge match-detail-badge-away">A</span>
              <h2 className={isTsuAinet(selectedMatch.awayTeam) ? "tsu" : ""}>
                {selectedMatch.awayTeam}
              </h2>
            </div>
          </div>

          <div className="match-detail-meta premium-match-meta">
            <span><Icon name="calendar" /> {formatDate(selectedMatch.kickoffAt)}</span>
            <span><Icon name="clock" /> {formatTime(selectedMatch.kickoffAt)} Uhr</span>
            <span><Icon name="location" /> {selectedMatch.venue || "Spielort noch offen"}</span>
          </div>

          <div className="premium-match-actions">
            {selectedMatch.venue && (
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

        <section className="premium-match-section">
          <header>
            <div>
              <p className="kfv-eyebrow">Spielinformation</p>
              <h3>Alles auf einen Blick</h3>
            </div>
          </header>
          <div className="premium-info-grid">
            <article><Icon name="location" /><small>Spielort</small><strong>{selectedMatch.venue || "Noch nicht bekannt"}</strong></article>
            <article><Icon name="calendar" /><small>Datum</small><strong>{formatDate(selectedMatch.kickoffAt)}</strong></article>
            <article><Icon name="clock" /><small>Anstoß</small><strong>{formatTime(selectedMatch.kickoffAt)} Uhr</strong></article>
            <article><Icon name="users" /><small>Schiedsrichter</small><strong>{selectedMatch.referee || "Noch nicht veröffentlicht"}</strong></article>
            <article><Icon name="table" /><small>TSU Tabellenplatz</small><strong>{tsuRow ? `${tsuRow.position}. Platz` : "Noch offen"}</strong></article>
            <article><Icon name="sync" /><small>Letzte Aktualisierung</small><strong>{selectedMatch.sourceUpdatedAt ? `${formatDate(selectedMatch.sourceUpdatedAt)} · ${formatTime(selectedMatch.sourceUpdatedAt)}` : "Noch nicht verfügbar"}</strong></article>
          </div>
        </section>

        <div className="premium-match-columns">
          <section className="premium-match-section">
            <header>
              <div><p className="kfv-eyebrow">Spielverlauf</p><h3>{liveWindow ? "Liveticker" : "Ereignisse"}</h3></div>
              {liveWindow && <span className="premium-live-pill">LIVE</span>}
            </header>
            <div className="premium-empty-state">
              <Icon name="live" />
              <strong>{selectedMatch.liveUrl ? "Offizieller Liveticker verfügbar" : selectedMatch.reportUrl ? "Offizielle Spieldetails verfügbar" : "Noch keine Ereignisse verfügbar"}</strong>
              <p>{selectedMatch.liveUrl ? "Der offizielle Liveticker zeigt Tore, Karten und Wechsel." : selectedMatch.reportUrl ? "Details und Spielbericht werden auf der offiziellen KFV-/ÖFB-Spielseite angezeigt." : "Sobald Live-Daten oder ein Spielbericht vorliegen, erscheinen sie hier beziehungsweise über den offiziellen Link."}</p>
              {(selectedMatch.liveUrl || selectedMatch.reportUrl) && <a href={selectedMatch.liveUrl || selectedMatch.reportUrl} target="_blank" rel="noreferrer">Offizielle Spielseite öffnen</a>}
            </div>
          </section>

          <section className="premium-match-section">
            <header><div><p className="kfv-eyebrow">Mannschaft</p><h3>Aufstellungen</h3></div></header>
            <div className="premium-lineup-placeholder">
              <div><Icon name="users" /><strong>Startelf</strong><span>Noch nicht veröffentlicht</span></div>
              <div><Icon name="users" /><strong>Ersatzbank</strong><span>Noch nicht veröffentlicht</span></div>
            </div>
          </section>
        </div>

        <div className="premium-match-columns">
          <section className="premium-match-section">
            <header><div><p className="kfv-eyebrow">Aktuelle Form</p><h3>Letzte fünf Spiele</h3></div></header>
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
            <header><div><p className="kfv-eyebrow">Tabelle</p><h3>Top 5</h3></div></header>
            {teamTable.length > 0 ? (
              <div className="premium-mini-table">
                {teamTable.map((row) => (
                  <div key={row.id} className={isTsuAinet(row.clubName) ? "is-tsu" : ""}>
                    <span>{row.position}.</span>
                    <TeamLogo url={row.teamLogoUrl} name={row.clubName} size="small" />
                    <strong>{row.clubName}</strong>
                    <b>{row.points}</b>
                  </div>
                ))}
              </div>
            ) : <p className="premium-muted">Für diese Mannschaft ist noch keine Tabelle verfügbar.</p>}
          </section>
        </div>

        <nav className="premium-match-shortcuts" aria-label="Spielcenter Schnellzugriffe">
          <button type="button" onClick={() => { setSelectedMatch(null); setActiveTab("table"); }}><Icon name="table" /><span>Tabelle</span></button>
          <button type="button" onClick={() => { setSelectedMatch(null); setActiveTab("squad"); }}><Icon name="users" /><span>Kader</span></button>
          <button type="button" onClick={() => { setSelectedMatch(null); setActiveTab("matches"); }}><Icon name="calendar" /><span>Spielplan</span></button>
          {(selectedMatch.liveUrl || selectedMatch.reportUrl) && <a href={selectedMatch.liveUrl || selectedMatch.reportUrl} target="_blank" rel="noreferrer"><Icon name="news" /><span>Bericht</span></a>}
        </nav>
      </section>
    );
  }

  return (
    <section className="kfv-page">
      <header className="kfv-header">
        <div>
          <p className="kfv-eyebrow">TSU Ainet Fußball</p>
          <h2>KFV Live</h2>
          <p>Spiele, Ergebnisse und Tabellen der TSU Ainet direkt aus Firestore.</p>
        </div>

        <span className="kfv-status kfv-status-live">● Firestore Echtzeit</span>
      </header>

      <div className="kfv-source-switch"><span className="active">Firestore Live-Daten</span></div>

      <div className="kfv-toolbar">
        <div className="kfv-tabs" role="tablist" aria-label="KFV-Live Ansicht">
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
            <option value="all">Alle Mannschaften</option>
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
                        <TeamLogo url={match.homeLogoUrl} name={match.homeTeam} />
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
                        <TeamLogo url={match.awayLogoUrl} name={match.awayTeam} />
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
                      {match.venue && <span>{match.venue}</span>}
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
                            <td>
                              <div className="kfv-table-club">
                                <TeamLogo url={row.teamLogoUrl} name={row.clubName} size="small" />
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
                            <td><strong>{row.points}</strong></td>
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
