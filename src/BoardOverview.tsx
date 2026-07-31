import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import "./BoardOverview.css";

type FirestoreDate = { toDate?: () => Date } | string | null | undefined;

type TaskRow = {
  id: string;
  title?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignedTo?: string;
  assignedToName?: string;
  dueDate?: FirestoreDate;
};

type MatchRow = {
  id: string;
  homeTeam?: string;
  awayTeam?: string;
  teamName?: string;
  kickoffAt?: FirestoreDate;
};

type ServiceRow = {
  id: string;
  title?: string;
  assignedTo?: string;
  assignedToName?: string;
  date?: FirestoreDate;
  time?: string;
};

type BoardOverviewProps = {
  onOpenTasks: () => void;
  onOpenClubAdmin: () => void;
};

function asDate(value: FirestoreDate): Date | null {
  if (!value) return null;

  if (typeof value === "string") {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00`
      : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  return null;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function isTsuAinet(name?: string) {
  const normalized = String(name || "").toLowerCase();
  return normalized.includes("ainet") || normalized.includes("tsu");
}

function formatDate(date: Date | null, withTime = false) {
  if (!date) return "Noch nicht eingetragen";

  return new Intl.DateTimeFormat("de-AT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export default function BoardOverview({
  onOpenTasks,
  onOpenClubAdmin,
}: BoardOverviewProps) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);

  useEffect(() => {
    const unsubscribeTasks = onSnapshot(collection(db, "tasks"), (snapshot) => {
      setTasks(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });

    const unsubscribeMatches = onSnapshot(
      collection(db, "kfvMatches"),
      (snapshot) => {
        setMatches(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      () => setMatches([]),
    );

    const unsubscribeServices = onSnapshot(
      collection(db, "services"),
      (snapshot) => {
        setServices(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      () => setServices([]),
    );

    return () => {
      unsubscribeTasks();
      unsubscribeMatches();
      unsubscribeServices();
    };
  }, []);

  const today = startOfToday();

  const openTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done"),
    [tasks],
  );

  const overdueTasks = useMemo(
    () =>
      openTasks.filter((task) => {
        const dueDate = asDate(task.dueDate);
        return Boolean(dueDate && dueDate < today);
      }),
    [openTasks, today],
  );

  const urgentTasks = useMemo(
    () =>
      [...openTasks]
        .sort((a, b) => {
          const priorityOrder: Record<string, number> = {
            high: 0,
            medium: 1,
            low: 2,
          };
          const priorityDifference =
            (priorityOrder[a.priority || "medium"] ?? 1) -
            (priorityOrder[b.priority || "medium"] ?? 1);
          if (priorityDifference !== 0) return priorityDifference;

          const aTime = asDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const bTime = asDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return aTime - bTime;
        })
        .slice(0, 4),
    [openTasks],
  );

  const nextHomeMatch = useMemo(() => {
    return matches
      .map((match) => ({ ...match, date: asDate(match.kickoffAt) }))
      .filter(
        (match) =>
          Boolean(match.date && match.date >= today) && isTsuAinet(match.homeTeam),
      )
      .sort((a, b) => a.date!.getTime() - b.date!.getTime())[0];
  }, [matches, today]);

  const nextService = useMemo(() => {
    return services
      .map((service) => ({ ...service, serviceDate: asDate(service.date) }))
      .filter((service) => Boolean(service.serviceDate && service.serviceDate >= today))
      .sort((a, b) => a.serviceDate!.getTime() - b.serviceDate!.getTime())[0];
  }, [services, today]);

  return (
    <section className="board-overview" aria-label="Vorstandsübersicht">
      <div className="board-overview__heading">
        <div>
          <p>TSU Ainet Vereinszentrale</p>
          <h2>Vorstands-Dashboard</h2>
          <span>Die wichtigsten Aufgaben und Termine auf einen Blick.</span>
        </div>

        <button type="button" onClick={onOpenClubAdmin}>
          Vereinsverwaltung öffnen
        </button>
      </div>

      <div className="board-overview__stats">
        <button type="button" onClick={onOpenTasks}>
          <small>Offene Aufgaben</small>
          <strong>{openTasks.length}</strong>
          <span>Alle offenen Punkte ansehen</span>
        </button>

        <button
          type="button"
          className={overdueTasks.length > 0 ? "is-warning" : ""}
          onClick={onOpenTasks}
        >
          <small>Überfällig</small>
          <strong>{overdueTasks.length}</strong>
          <span>{overdueTasks.length > 0 ? "Bitte zeitnah erledigen" : "Alles im Zeitplan"}</span>
        </button>

        <article>
          <small>Nächstes Heimspiel</small>
          <strong>
            {nextHomeMatch
              ? `${nextHomeMatch.homeTeam} – ${nextHomeMatch.awayTeam}`
              : "Noch nicht gefunden"}
          </strong>
          <span>{formatDate(nextHomeMatch?.date || null, true)}</span>
        </article>

        <article>
          <small>Nächster Dienst</small>
          <strong>{nextService?.title || "Noch nicht eingeteilt"}</strong>
          <span>
            {nextService
              ? `${formatDate(nextService.serviceDate)}${
                  nextService.time ? ` · ${nextService.time}` : ""
                } · ${
                  nextService.assignedToName ||
                  nextService.assignedTo ||
                  "noch offen"
                }`
              : "In der Vereinsverwaltung eintragen"}
          </span>
        </article>
      </div>

      <div className="board-overview__tasks">
        <div className="board-overview__tasks-header">
          <div>
            <small>Prioritäten</small>
            <h3>Als Nächstes zu erledigen</h3>
          </div>
          <button type="button" onClick={onOpenTasks}>
            Alle Aufgaben
          </button>
        </div>

        {urgentTasks.length === 0 ? (
          <div className="board-overview__empty">
            Aktuell sind keine offenen Aufgaben vorhanden.
          </div>
        ) : (
          <div className="board-overview__task-list">
            {urgentTasks.map((task) => (
              <article key={task.id}>
                <span className={`priority-dot priority-${task.priority || "medium"}`} />
                <div>
                  <strong>{task.title || "Aufgabe ohne Titel"}</strong>
                  <small>
                    {task.assignedToName || task.assignedTo || "Noch niemand zugewiesen"}
                    {task.dueDate ? ` · fällig ${formatDate(asDate(task.dueDate))}` : ""}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
