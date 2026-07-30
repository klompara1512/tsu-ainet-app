import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import "./EventsAdmin.css";

type EventType = "training" | "match" | "club";
type HomeAway = "home" | "away" | "";

type Team = {
  id: string;
  name: string;
  order: number;
};

type ClubEvent = {
  id: string;
  title: string;
  type: EventType;
  teamId: string;
  teamName: string;
  location: string;
  opponent: string;
  homeAway: HomeAway;
  notes: string;
  startAt: Date;
  active: boolean;
};

type EventForm = {
  title: string;
  type: EventType;
  teamId: string;
  location: string;
  opponent: string;
  homeAway: HomeAway;
  notes: string;
  startAt: string;
  active: boolean;
};

type EventsAdminProps = {
  onBack: () => void;
};

function createDateTimeValue(date = new Date()) {
  const adjustedDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000,
  );

  return adjustedDate.toISOString().slice(0, 16);
}

const emptyForm: EventForm = {
  title: "",
  type: "training",
  teamId: "",
  location: "Sportplatz Ainet",
  opponent: "",
  homeAway: "home",
  notes: "",
  startAt: createDateTimeValue(),
  active: true,
};

function EventsAdmin({ onBack }: EventsAdminProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);

  const [formData, setFormData] =
    useState<EventForm>(emptyForm);
  const [editingEventId, setEditingEventId] =
    useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const teamsQuery = query(
      collection(db, "teams"),
      orderBy("order", "asc"),
    );

    const unsubscribe = onSnapshot(teamsQuery, (snapshot) => {
      const loadedTeams: Team[] = snapshot.docs
        .map((teamDocument) => {
          const data = teamDocument.data();

          return {
            id: teamDocument.id,
            name:
              typeof data.name === "string"
                ? data.name
                : "Mannschaft",
            order:
              typeof data.order === "number"
                ? data.order
                : 999,
          };
        })
        .filter((team) => team.name);

      setTeams(loadedTeams);

      setFormData((current) => ({
        ...current,
        teamId:
          current.teamId ||
          loadedTeams[0]?.id ||
          "",
      }));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const eventsQuery = query(
      collection(db, "events"),
      orderBy("startAt", "asc"),
    );

    const unsubscribe = onSnapshot(
      eventsQuery,
      (snapshot) => {
        const loadedEvents: ClubEvent[] =
          snapshot.docs.map((eventDocument) => {
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
              active:
                typeof data.active === "boolean"
                  ? data.active
                  : true,
            };
          });

        setEvents(loadedEvents);
        setIsLoading(false);
        setErrorMessage("");
      },
      (error) => {
        console.error("Fehler beim Laden der Termine:", error);

        setErrorMessage(
          "Die Termine konnten nicht geladen werden.",
        );
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const upcomingEvents = useMemo(() => {
    const now = new Date();

    return events.filter(
      (event) =>
        event.startAt.getTime() >=
        now.getTime() - 24 * 60 * 60 * 1000,
    );
  }, [events]);

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function resetForm() {
    setEditingEventId(null);

    setFormData({
      ...emptyForm,
      teamId: teams[0]?.id ?? "",
      startAt: createDateTimeValue(),
    });
  }

  function getTeamName(teamId: string) {
    if (!teamId) {
      return "Gesamter Verein";
    }

    return (
      teams.find((team) => team.id === teamId)?.name ??
      "Mannschaft"
    );
  }

  function getTypeLabel(type: EventType) {
    if (type === "training") {
      return "Training";
    }

    if (type === "match") {
      return "Spiel";
    }

    return "Vereinstermin";
  }

  function formatDate(date: Date) {
    return new Intl.DateTimeFormat("de-AT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function startEditing(event: ClubEvent) {
    setEditingEventId(event.id);

    setFormData({
      title: event.title,
      type: event.type,
      teamId: event.teamId,
      location: event.location,
      opponent: event.opponent,
      homeAway: event.homeAway,
      notes: event.notes,
      startAt: createDateTimeValue(event.startAt),
      active: event.active,
    });

    clearMessages();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveEvent(
    submitEvent: FormEvent<HTMLFormElement>,
  ) {
    submitEvent.preventDefault();
    clearMessages();

    const title = formData.title.trim();
    const startDate = new Date(formData.startAt);

    if (!title) {
      setErrorMessage(
        "Bitte gib einen Titel für den Termin ein.",
      );
      return;
    }

    if (Number.isNaN(startDate.getTime())) {
      setErrorMessage(
        "Bitte gib ein gültiges Datum und eine Uhrzeit ein.",
      );
      return;
    }

    if (
      formData.type !== "club" &&
      !formData.teamId
    ) {
      setErrorMessage(
        "Bitte wähle eine Mannschaft aus.",
      );
      return;
    }

    if (
      formData.type === "match" &&
      !formData.opponent.trim()
    ) {
      setErrorMessage(
        "Bitte gib den Gegner ein.",
      );
      return;
    }

    setIsSaving(true);

    const eventData = {
      title,
      type: formData.type,
      teamId: formData.teamId,
      teamName: formData.teamId
        ? getTeamName(formData.teamId)
        : "Gesamter Verein",
      location: formData.location.trim(),
      opponent:
        formData.type === "match"
          ? formData.opponent.trim()
          : "",
      homeAway:
        formData.type === "match"
          ? formData.homeAway
          : "",
      notes: formData.notes.trim(),
      startAt: Timestamp.fromDate(startDate),
      active: formData.active,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingEventId) {
        await updateDoc(
          doc(db, "events", editingEventId),
          eventData,
        );

        setSuccessMessage(
          "Der Termin wurde aktualisiert.",
        );
      } else {
        await addDoc(collection(db, "events"), {
          ...eventData,
          createdAt: serverTimestamp(),
        });

        setSuccessMessage(
          "Der Termin wurde angelegt.",
        );
      }

      resetForm();
    } catch (error) {
      console.error("Fehler beim Speichern:", error);

      setErrorMessage(
        "Der Termin konnte nicht gespeichert werden. Prüfe bitte die Firestore-Regeln.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function removeEvent(event: ClubEvent) {
    const confirmed = window.confirm(
      `Soll „${event.title}“ wirklich gelöscht werden?`,
    );

    if (!confirmed) {
      return;
    }

    clearMessages();

    try {
      await deleteDoc(doc(db, "events", event.id));

      if (editingEventId === event.id) {
        resetForm();
      }

      setSuccessMessage(
        "Der Termin wurde gelöscht.",
      );
    } catch (error) {
      console.error("Fehler beim Löschen:", error);

      setErrorMessage(
        "Der Termin konnte nicht gelöscht werden.",
      );
    }
  }

  return (
    <section className="events-admin-page">
      <button
        type="button"
        className="events-admin-back"
        onClick={onBack}
      >
        <span aria-hidden="true">‹</span>
        Mehr
      </button>

      <div className="events-admin-header">
        <div>
          <p className="events-admin-eyebrow">
            TSU Ainet Fußball
          </p>

          <h2>Terminverwaltung</h2>

          <p>
            Trainings, Spiele und Vereinstermine direkt in
            Firebase verwalten.
          </p>
        </div>

        <span className="events-admin-badge">
          {upcomingEvents.length} kommende
        </span>
      </div>

      {errorMessage && (
        <div className="events-admin-message events-admin-error">
          <strong>Fehler</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {successMessage && (
        <div className="events-admin-message events-admin-success">
          <strong>Erfolgreich</strong>
          <p>{successMessage}</p>
        </div>
      )}

      <div className="events-admin-layout">
        <form
          className="events-admin-form"
          onSubmit={saveEvent}
        >
          <div className="events-admin-card-header">
            <div>
              <p className="events-admin-eyebrow">
                {editingEventId
                  ? "Termin bearbeiten"
                  : "Neuer Termin"}
              </p>

              <h3>
                {getTypeLabel(formData.type)}
              </h3>
            </div>

            {editingEventId && (
              <button
                type="button"
                className="events-admin-text-button"
                onClick={resetForm}
              >
                Abbrechen
              </button>
            )}
          </div>

          <div className="events-admin-form-grid">
            <label className="events-admin-field">
              <span>Terminart</span>

              <select
                value={formData.type}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    type: event.target.value as EventType,
                    title:
                      event.target.value === "training"
                        ? "Training"
                        : current.title,
                  }))
                }
              >
                <option value="training">
                  Training
                </option>
                <option value="match">Spiel</option>
                <option value="club">
                  Vereinstermin
                </option>
              </select>
            </label>

            <label className="events-admin-field">
              <span>Mannschaft</span>

              <select
                value={formData.teamId}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    teamId: event.target.value,
                  }))
                }
              >
                {formData.type === "club" && (
                  <option value="">
                    Gesamter Verein
                  </option>
                )}

                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="events-admin-field events-admin-wide">
              <span>Titel</span>

              <input
                type="text"
                value={formData.title}
                placeholder="Zum Beispiel Training"
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>

            <label className="events-admin-field">
              <span>Datum und Uhrzeit</span>

              <input
                type="datetime-local"
                value={formData.startAt}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    startAt: event.target.value,
                  }))
                }
              />
            </label>

            <label className="events-admin-field">
              <span>Ort</span>

              <input
                type="text"
                value={formData.location}
                placeholder="Sportplatz Ainet"
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
              />
            </label>

            {formData.type === "match" && (
              <>
                <label className="events-admin-field">
                  <span>Gegner</span>

                  <input
                    type="text"
                    value={formData.opponent}
                    placeholder="Name des Gegners"
                    onChange={(event) =>
                      setFormData((current) => ({
                        ...current,
                        opponent: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="events-admin-field">
                  <span>Heim oder auswärts</span>

                  <select
                    value={formData.homeAway}
                    onChange={(event) =>
                      setFormData((current) => ({
                        ...current,
                        homeAway:
                          event.target.value as HomeAway,
                      }))
                    }
                  >
                    <option value="home">
                      Heimspiel
                    </option>
                    <option value="away">
                      Auswärtsspiel
                    </option>
                  </select>
                </label>
              </>
            )}

            <label className="events-admin-field events-admin-wide">
              <span>Notiz</span>

              <textarea
                value={formData.notes}
                placeholder="Optionale Informationen zum Termin"
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </label>

            <label className="events-admin-checkbox events-admin-wide">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    active: event.target.checked,
                  }))
                }
              />

              <span>
                <strong>Termin aktiv</strong>
                <small>
                  Der Termin wird im Kalender angezeigt
                </small>
              </span>
            </label>
          </div>

          <button
            type="submit"
            className="events-admin-save"
            disabled={isSaving}
          >
            {isSaving
              ? "Wird gespeichert …"
              : editingEventId
                ? "Änderungen speichern"
                : "Termin hinzufügen"}
          </button>
        </form>

        <article className="events-admin-list-card">
          <div className="events-admin-card-header">
            <div>
              <p className="events-admin-eyebrow">
                Firebase
              </p>

              <h3>Kommende Termine</h3>
            </div>

            <span className="events-admin-count">
              {upcomingEvents.length}
            </span>
          </div>

          {isLoading && (
            <div className="events-admin-empty">
              <p>Termine werden geladen …</p>
            </div>
          )}

          {!isLoading &&
            upcomingEvents.length === 0 && (
              <div className="events-admin-empty">
                <strong>Noch keine Termine</strong>
                <p>
                  Lege über das Formular den ersten Termin an.
                </p>
              </div>
            )}

          {!isLoading &&
            upcomingEvents.length > 0 && (
              <div className="events-admin-list">
                {upcomingEvents.map((event) => (
                  <div
                    key={event.id}
                    className="events-admin-row"
                  >
                    <span
                      className={`events-admin-type events-admin-type-${event.type}`}
                    >
                      {event.type === "training"
                        ? "T"
                        : event.type === "match"
                          ? "S"
                          : "V"}
                    </span>

                    <div className="events-admin-info">
                      <strong>{event.title}</strong>

                      <span>
                        {formatDate(event.startAt)}
                      </span>

                      <small>
                        {event.teamName}
                        {event.location
                          ? ` · ${event.location}`
                          : ""}
                      </small>
                    </div>

                    <div className="events-admin-actions">
                      <button
                        type="button"
                        onClick={() =>
                          startEditing(event)
                        }
                      >
                        Bearbeiten
                      </button>

                      <button
                        type="button"
                        className="danger"
                        onClick={() =>
                          removeEvent(event)
                        }
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </article>
      </div>
    </section>
  );
}

export default EventsAdmin;