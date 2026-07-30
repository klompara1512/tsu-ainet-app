import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import "./Kalender.css";

type EventType = "training" | "match" | "club";

type ClubEvent = {
  id: string;
  title: string;
  type: EventType;
  teamId: string;
  teamName: string;
  location: string;
  opponent: string;
  homeAway: "home" | "away" | "";
  notes: string;
  startAt: Date;
  endAt: Date | null;
  active: boolean;
};

type EventFilter = "all" | EventType;

function Kalender() {
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [selectedFilter, setSelectedFilter] =
    useState<EventFilter>("all");
  const [selectedTeamId, setSelectedTeamId] = useState("all");

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const eventsQuery = query(
      collection(db, "events"),
      orderBy("startAt", "asc"),
    );

    const unsubscribe = onSnapshot(
      eventsQuery,
      (snapshot) => {
        const loadedEvents: ClubEvent[] = snapshot.docs
          .map((eventDocument) => {
            const data = eventDocument.data();

            return {
              id: eventDocument.id,
              title:
                typeof data.title === "string"
                  ? data.title
                  : "Termin",
              type:
                data.type === "training" ||
                data.type === "match" ||
                data.type === "club"
                  ? data.type
                  : "club",
              teamId:
                typeof data.teamId === "string"
                  ? data.teamId
                  : "",
              teamName:
                typeof data.teamName === "string"
                  ? data.teamName
                  : "Gesamter Verein",
              location:
                typeof data.location === "string"
                  ? data.location
                  : "",
              opponent:
                typeof data.opponent === "string"
                  ? data.opponent
                  : "",
              homeAway:
                data.homeAway === "home" ||
                data.homeAway === "away"
                  ? data.homeAway
                  : "",
              notes:
                typeof data.notes === "string"
                  ? data.notes
                  : "",
              startAt:
                data.startAt instanceof Timestamp
                  ? data.startAt.toDate()
                  : new Date(),
              endAt:
                data.endAt instanceof Timestamp
                  ? data.endAt.toDate()
                  : null,
              active:
                typeof data.active === "boolean"
                  ? data.active
                  : true,
            };
          })
          .filter((event) => event.active);

        setEvents(loadedEvents);
        setIsLoading(false);
        setErrorMessage("");
      },
      (error) => {
        console.error("Fehler beim Laden der Termine:", error);

        setErrorMessage(
          "Die Termine konnten nicht aus Firebase geladen werden.",
        );
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const teams = useMemo(() => {
    const teamMap = new Map<string, string>();

    events.forEach((event) => {
      if (event.teamId && event.teamName) {
        teamMap.set(event.teamId, event.teamName);
      }
    });

    return Array.from(teamMap.entries())
      .map(([id, name]) => ({
        id,
        name,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, "de-AT"),
      );
  }, [events]);

  const visibleEvents = useMemo(() => {
    const now = new Date();

    return events.filter((event) => {
      const matchesType =
        selectedFilter === "all" ||
        event.type === selectedFilter;

      const matchesTeam =
        selectedTeamId === "all" ||
        event.teamId === selectedTeamId;

      const isRelevant =
        event.startAt.getTime() >=
        now.getTime() - 24 * 60 * 60 * 1000;

      return matchesType && matchesTeam && isRelevant;
    });
  }, [events, selectedFilter, selectedTeamId]);

  function formatLongDate(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function formatDay(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      day: "2-digit",
    }).format(date);
  }

  function formatMonth(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      month: "short",
    })
      .format(date)
      .replace(".", "");
  }

  function formatTime(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function getEventLabel(type: EventType) {
    if (type === "training") {
      return "Training";
    }

    if (type === "match") {
      return "Spiel";
    }

    return "Vereinstermin";
  }

  function getMatchTitle(event: ClubEvent) {
    if (
      event.type !== "match" ||
      !event.opponent
    ) {
      return event.title;
    }

    if (event.homeAway === "away") {
      return `${event.opponent} – TSU Ainet`;
    }

    return `TSU Ainet – ${event.opponent}`;
  }

  return (
    <section className="calendar-page">
      <div className="calendar-header">
        <div>
          <p className="calendar-eyebrow">
            TSU Ainet Fußball
          </p>

          <h2>Kalender</h2>

          <p>
            Trainings, Spiele und Vereinstermine auf einen
            Blick.
          </p>
        </div>

        <span className="calendar-count">
          {visibleEvents.length} Termine
        </span>
      </div>

      <div className="calendar-toolbar">
        <div className="calendar-filters">
          <button
            type="button"
            className={
              selectedFilter === "all" ? "active" : ""
            }
            onClick={() => setSelectedFilter("all")}
          >
            Alle
          </button>

          <button
            type="button"
            className={
              selectedFilter === "training"
                ? "active"
                : ""
            }
            onClick={() =>
              setSelectedFilter("training")
            }
          >
            Trainings
          </button>

          <button
            type="button"
            className={
              selectedFilter === "match"
                ? "active"
                : ""
            }
            onClick={() => setSelectedFilter("match")}
          >
            Spiele
          </button>

          <button
            type="button"
            className={
              selectedFilter === "club"
                ? "active"
                : ""
            }
            onClick={() => setSelectedFilter("club")}
          >
            Verein
          </button>
        </div>

        <label className="calendar-team-filter">
          <span>Mannschaft</span>

          <select
            value={selectedTeamId}
            onChange={(event) =>
              setSelectedTeamId(event.target.value)
            }
          >
            <option value="all">
              Alle Mannschaften
            </option>

            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errorMessage && (
        <div className="calendar-message calendar-error">
          <strong>Firebase-Fehler</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {isLoading && (
        <div className="calendar-loading">
          <span className="calendar-spinner" />
          <p>Termine werden geladen …</p>
        </div>
      )}

      {!isLoading &&
        visibleEvents.length === 0 &&
        !errorMessage && (
          <div className="calendar-empty">
            <span>K</span>
            <h3>Keine Termine vorhanden</h3>
            <p>
              Für die gewählte Auswahl wurden noch keine
              kommenden Termine angelegt.
            </p>
          </div>
        )}

      {!isLoading && visibleEvents.length > 0 && (
        <div className="calendar-event-list">
          {visibleEvents.map((event) => (
            <article
              key={event.id}
              className={`calendar-event calendar-event-${event.type}`}
            >
              <div className="calendar-date-box">
                <strong>{formatDay(event.startAt)}</strong>
                <span>{formatMonth(event.startAt)}</span>
              </div>

              <div className="calendar-event-content">
                <div className="calendar-event-topline">
                  <span className="calendar-event-type">
                    {getEventLabel(event.type)}
                  </span>

                  <span className="calendar-event-time">
                    {formatTime(event.startAt)} Uhr
                  </span>
                </div>

                <h3>{getMatchTitle(event)}</h3>

                <p className="calendar-full-date">
                  {formatLongDate(event.startAt)}
                </p>

                <div className="calendar-event-meta">
                  <span>
                    {event.teamName || "Gesamter Verein"}
                  </span>

                  {event.location && (
                    <span>{event.location}</span>
                  )}
                </div>

                {event.notes && (
                  <p className="calendar-event-notes">
                    {event.notes}
                  </p>
                )}
              </div>

              <span
                className="calendar-event-arrow"
                aria-hidden="true"
              >
                ›
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default Kalender;