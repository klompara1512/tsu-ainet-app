import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "./firebase";
import "./Teams.css";
import { Icon, type IconName } from "./Icons";

type Team = {
  id: string;
  name: string;
  description: string;
  icon: string;
  order: number;
  active: boolean;
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

function teamIcon(name: string): IconName { const n=name.toLowerCase(); if(n.includes("kampf" )||n==="km") return "ball"; if(n.includes("challenge")||n.includes("reserve")) return "shield"; if(n.includes("u17")) return "users"; if(n.includes("u12")) return "target"; if(n.includes("u10")) return "rocket"; return "sparkles"; }

function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(
    null,
  );

  const [players, setPlayers] = useState<Player[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);

  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  const [teamsError, setTeamsError] = useState("");
  const [membersError, setMembersError] = useState("");

  useEffect(() => {
    const teamsQuery = query(
      collection(db, "teams"),
      orderBy("order", "asc"),
    );

    const unsubscribe = onSnapshot(
      teamsQuery,
      (snapshot) => {
        const loadedTeams: Team[] = snapshot.docs
          .map((teamDocument) => {
            const data = teamDocument.data();

            return {
              id: teamDocument.id,
              name:
                typeof data.name === "string"
                  ? data.name
                  : "Mannschaft",
              description:
                typeof data.description === "string"
                  ? data.description
                  : "",
              icon:
                typeof data.icon === "string" ? data.icon : "⚽",
              order:
                typeof data.order === "number" ? data.order : 999,
              active:
                typeof data.active === "boolean"
                  ? data.active
                  : true,
              imageUrl:
                typeof data.imageUrl === "string"
                  ? data.imageUrl
                  : "",
            };
          })
          .filter((team) => team.active);

        setTeams(loadedTeams);
        setIsLoadingTeams(false);
        setTeamsError("");
      },
      (error) => {
        console.error(
          "Fehler beim Laden der Mannschaften:",
          error,
        );

        setTeamsError(
          "Die Mannschaften konnten nicht geladen werden.",
        );

        setIsLoadingTeams(false);
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedTeamId) {
      setPlayers([]);
      setTrainers([]);
      setIsLoadingMembers(false);
      setMembersError("");
      return;
    }

    setIsLoadingMembers(true);
    setMembersError("");

    let playersLoaded = false;
    let trainersLoaded = false;

    function finishLoading() {
      if (playersLoaded && trainersLoaded) {
        setIsLoadingMembers(false);
      }
    }

    const selectedTeamForSync = teams.find((team) => team.id === selectedTeamId);
    const useOfficialSquad = true;

    const normalizedSelectedTeam = (selectedTeamForSync?.name || "")
      .toLocaleLowerCase("de-AT")
      .replace(/[^a-z0-9]+/g, "");

    const playersReference = collection(db, "kfvSquad");

    const trainersReference = collection(
      db,
      "teams",
      selectedTeamId,
      "trainers",
    );

    const unsubscribePlayers = onSnapshot(
      playersReference,
      (snapshot) => {
        const loadedPlayers: Player[] = snapshot.docs
          .map((playerDocument) => {
            const data = playerDocument.data();

            if (useOfficialSquad) {
              const fullName = typeof data.name === "string" ? data.name.trim() : "";
              const nameParts = fullName.split(/\s+/).filter(Boolean);
              return {
                id: playerDocument.id,
                firstName: nameParts.slice(0, -1).join(" ") || fullName,
                lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : "",
                position: typeof data.position === "string" ? data.position : "Spieler",
                shirtNumber: typeof data.number === "number" ? data.number : null,
                order: typeof data.number === "number" ? data.number : 999,
                active: typeof data.active === "boolean" ? data.active : true,
                imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
                profileUrl: typeof data.profileUrl === "string" ? data.profileUrl : "",
                official: true,
              };
            }

            return {
              id: playerDocument.id,
              firstName:
                typeof data.firstName === "string"
                  ? data.firstName
                  : "",
              lastName:
                typeof data.lastName === "string"
                  ? data.lastName
                  : "",
              position:
                typeof data.position === "string"
                  ? data.position
                  : "",
              shirtNumber:
                typeof data.shirtNumber === "number"
                  ? data.shirtNumber
                  : null,
              order:
                typeof data.order === "number"
                  ? data.order
                  : 999,
              active:
                typeof data.active === "boolean"
                  ? data.active
                  : true,
            };
          })
          .filter((player) => {
            if (!player.active) return false;
            const sourceDocument = snapshot.docs.find((document) => document.id === player.id)?.data();
            const officialTeamName = typeof sourceDocument?.teamName === "string" ? sourceDocument.teamName : "";
            const officialTeamId = typeof sourceDocument?.teamId === "string" ? sourceDocument.teamId : "";
            const normalizedOfficialTeam = `${officialTeamName}${officialTeamId}`
              .toLocaleLowerCase("de-AT")
              .replace(/[^a-z0-9]+/g, "");
            const aliases: Record<string, string[]> = {
              kampfmannschaft: ["kampfmannschaft", "km", "1mannschaft", "erste"],
              km: ["kampfmannschaft", "km", "1mannschaft", "erste"],
              challenge: ["challenge", "reserve", "kmres", "res", "1b"],
              reserve: ["challenge", "reserve", "kmres", "res", "1b"],
              u17: ["u17", "unter17"],
              u12: ["u12", "unter12"],
              u10: ["u10", "unter10"],
              u8: ["u8", "u08", "unter8"],
            };
            const selectedKey = Object.keys(aliases).find((key) => normalizedSelectedTeam.includes(key)) || normalizedSelectedTeam;
            const selectedAliases = aliases[selectedKey] || [normalizedSelectedTeam];
            return selectedAliases.some((alias) => normalizedOfficialTeam.includes(alias));
          })
          .sort((a, b) => {
            if (a.order !== b.order) {
              return a.order - b.order;
            }

            return a.lastName.localeCompare(
              b.lastName,
              "de-AT",
            );
          });

        setPlayers(loadedPlayers);

        playersLoaded = true;
        finishLoading();
      },
      (error) => {
        console.error("Fehler beim Laden der Spieler:", error);

        setMembersError(
          "Spieler und Trainer konnten nicht vollständig geladen werden.",
        );

        playersLoaded = true;
        finishLoading();
      },
    );

    const unsubscribeTrainers = onSnapshot(
      trainersReference,
      (snapshot) => {
        const loadedTrainers: Trainer[] = snapshot.docs
          .map((trainerDocument) => {
            const data = trainerDocument.data();

            return {
              id: trainerDocument.id,
              firstName:
                typeof data.firstName === "string"
                  ? data.firstName
                  : "",
              lastName:
                typeof data.lastName === "string"
                  ? data.lastName
                  : "",
              role:
                typeof data.role === "string"
                  ? data.role
                  : "Trainer",
              order:
                typeof data.order === "number"
                  ? data.order
                  : 999,
              active:
                typeof data.active === "boolean"
                  ? data.active
                  : true,
              imageUrl:
                typeof data.imageUrl === "string"
                  ? data.imageUrl
                  : "",
            };
          })
          .filter((trainer) => trainer.active)
          .sort((a, b) => {
            if (a.order !== b.order) {
              return a.order - b.order;
            }

            return a.lastName.localeCompare(
              b.lastName,
              "de-AT",
            );
          });

        setTrainers(loadedTrainers);

        trainersLoaded = true;
        finishLoading();
      },
      (error) => {
        console.error("Fehler beim Laden der Trainer:", error);

        setMembersError(
          "Spieler und Trainer konnten nicht vollständig geladen werden.",
        );

        trainersLoaded = true;
        finishLoading();
      },
    );

    return () => {
      unsubscribePlayers();
      unsubscribeTrainers();
    };
  }, [selectedTeamId, teams]);

  const selectedTeam = useMemo(() => {
    if (!selectedTeamId) {
      return null;
    }

    return (
      teams.find((team) => team.id === selectedTeamId) ?? null
    );
  }, [selectedTeamId, teams]);

  function openTeam(teamId: string) {
    setPlayers([]);
    setTrainers([]);
    setMembersError("");
    setSelectedTeamId(teamId);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function closeTeam() {
    setSelectedTeamId(null);
    setPlayers([]);
    setTrainers([]);
    setMembersError("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function getInitials(
    firstName: string,
    lastName: string,
  ) {
    const firstInitial = firstName.trim().charAt(0);
    const lastInitial = lastName.trim().charAt(0);

    return `${firstInitial}${lastInitial}`.toUpperCase() || "?";
  }

  if (selectedTeam) {
    return (
      <section className="team-detail-page">
        <button
          type="button"
          className="team-back-button"
          onClick={closeTeam}
        >
          <span className="team-back-arrow" aria-hidden="true">
            ‹
          </span>

          <span>Mannschaften</span>
        </button>

        <div className="team-detail-hero">
          <div className="team-detail-hero-content">
            <span className="team-detail-icon" aria-hidden="true">
              <Icon name={teamIcon(selectedTeam.name)} />
            </span>

            <div className="team-detail-heading">
              <p className="teams-label">
                TSU Ainet Fußball
              </p>

              <h2>{selectedTeam.name}</h2>

              {selectedTeam.description && (
                <p className="team-detail-description">
                  {selectedTeam.description}
                </p>
              )}
            </div>
          </div>

          <div className="team-detail-statistics">
            <div>
              <strong>{players.length}</strong>
              <span>Spieler</span>
            </div>

            <div>
              <strong>{trainers.length}</strong>
              <span>Trainer</span>
            </div>
          </div>
        </div>

        {membersError && (
          <div className="teams-message teams-error-message">
            <strong>Firebase-Fehler</strong>
            <p>{membersError}</p>
          </div>
        )}

        <div className="team-detail-top-grid">
          <article className="team-overview-card">
            <div className="team-card-header">
              <div>
                <p className="team-card-label">
                  Nächstes Spiel
                </p>
                <h3>Noch nicht eingetragen</h3>
              </div>

              <span className="team-card-symbol">S</span>
            </div>

            <p>
              Das nächste Spiel wird später automatisch aus
              dem Kalender beziehungsweise den Verbandsdaten
              übernommen.
            </p>
          </article>

          <article className="team-overview-card">
            <div className="team-card-header">
              <div>
                <p className="team-card-label">
                  Nächstes Training
                </p>
                <h3>Noch nicht eingetragen</h3>
              </div>

              <span className="team-card-symbol">T</span>
            </div>

            <p>
              Trainings werden später vom Trainer im
              Adminbereich angelegt.
            </p>
          </article>
        </div>

        {isLoadingMembers ? (
          <div className="teams-loading">
            <span className="teams-loading-spinner" />
            <p>Mannschaftsdaten werden geladen …</p>
          </div>
        ) : (
          <div className="team-members-layout">
            <article className="team-members-card">
              <div className="team-section-heading">
                <div>
                  <p className="team-card-label">
                    Trainerteam
                  </p>
                  <h3>Betreuer</h3>
                </div>

                <span className="team-member-count">
                  {trainers.length}
                </span>
              </div>

              {trainers.length === 0 ? (
                <div className="team-empty-members">
                  <span>T</span>
                  <strong>Noch keine Trainer</strong>
                  <p>
                    Trainer können über die Vereinsverwaltung
                    hinzugefügt werden.
                  </p>
                </div>
              ) : (
                <div className="team-person-list">
                  {trainers.map((trainer) => (
                    <div
                      className="team-person"
                      key={trainer.id}
                    >
                      <span className="team-person-avatar" style={trainer.imageUrl ? { padding: 0, overflow: "hidden" } : undefined}>
                        {trainer.imageUrl ? (
                          <img
                            src={trainer.imageUrl}
                            alt={`${trainer.firstName} ${trainer.lastName}`}
                            loading="lazy"
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={(event) => { event.currentTarget.style.display = "none"; }}
                          />
                        ) : (
                          getInitials(
                            trainer.firstName,
                            trainer.lastName,
                          )
                        )}
                      </span>

                      <span className="team-person-info">
                        <strong>
                          {trainer.firstName}{" "}
                          {trainer.lastName}
                        </strong>

                        <small>
                          {trainer.role || "Trainer"}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="team-members-card">
              <div className="team-section-heading">
                <div>
                  <p className="team-card-label">
                    Mannschaft
                  </p>
                  <h3>Spielerkader</h3>
                </div>

                <span className="team-member-count">
                  {players.length}
                </span>
              </div>

              {players.length === 0 ? (
                <div className="team-empty-members">
                  <span>S</span>
                  <strong>Noch keine Spieler</strong>
                  <p>
                    Spieler können über die Vereinsverwaltung
                    hinzugefügt werden.
                  </p>
                </div>
              ) : (
                <div className="team-player-list">
                  {players.map((player) => (
                    <div
                      className="team-player-row"
                      key={player.id}
                    >
                      {player.imageUrl ? (
                        <img
                          className="team-player-photo"
                          src={player.imageUrl}
                          alt={player.firstName + " " + player.lastName}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="team-player-number">
                          {player.shirtNumber ?? "–"}
                        </span>
                      )}

                      <span className="team-player-info">
                        <strong>
                          {player.firstName}{" "}
                          {player.lastName}
                        </strong>

                        <small>
                          {player.position ||
                            "Keine Position"}
                        </small>
                      </span>

                      {player.profileUrl ? (
                        <a
                          className="team-player-profile"
                          href={player.profileUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ÖFB
                        </a>
                      ) : (
                        <span className="team-player-status">Aktiv</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        )}

        <div className="team-detail-bottom-grid">
          <article className="team-overview-card">
            <div className="team-card-header">
              <div>
                <p className="team-card-label">
                  Organisation
                </p>
                <h3>Verfügbarkeit</h3>
              </div>

              <span className="team-card-symbol">Z</span>
            </div>

            <p>
              Spieler können später für Trainings und Spiele
              zu- oder absagen.
            </p>
          </article>

          <article className="team-overview-card">
            <div className="team-card-header">
              <div>
                <p className="team-card-label">
                  Wettbewerb
                </p>
                <h3>Tabelle und Ergebnisse</h3>
              </div>

              <span className="team-card-symbol">E</span>
            </div>

            <p>
              Tabelle, Spielplan und Ergebnisse werden später
              mit den Verbandsdaten verbunden.
            </p>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="teams-page">
      <div className="teams-header">
        <div>
          <p className="teams-label">TSU Ainet Fußball</p>
          <h2>Mannschaften</h2>

          <p>
            Wähle eine Mannschaft aus, um Trainer, Spieler und
            Termine zu sehen.
          </p>
        </div>

        {!isLoadingTeams && (
          <span className="teams-total-badge">
            {teams.length} Mannschaften
          </span>
        )}
      </div>

      {teamsError && (
        <div className="teams-message teams-error-message">
          <strong>Firebase-Fehler</strong>
          <p>{teamsError}</p>
        </div>
      )}

      {isLoadingTeams && (
        <div className="teams-loading">
          <span className="teams-loading-spinner" />
          <p>Mannschaften werden geladen …</p>
        </div>
      )}

      {!isLoadingTeams &&
        teams.length > 0 &&
        !teamsError && (
          <div className="teams-grid">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className="team-card"
                onClick={() => openTeam(team.id)}
              >
                <span className="team-icon" aria-hidden="true">
                  <Icon name={teamIcon(team.name)} />
                </span>

                <span className="team-info">
                  <strong>{team.name}</strong>

                  {team.description ? (
                    <small>{team.description}</small>
                  ) : (
                    <small>TSU Ainet Fußball</small>
                  )}
                </span>

                <span className="team-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        )}

      {!isLoadingTeams &&
        teams.length === 0 &&
        !teamsError && (
          <div className="teams-empty">
            <span className="teams-empty-mark">TSU</span>
            <h3>Keine Mannschaften vorhanden</h3>
            <p>
              In Firebase wurden noch keine aktiven
              Mannschaften gefunden.
            </p>
          </div>
        )}
    </section>
  );
}

export default Teams;