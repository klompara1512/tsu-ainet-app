import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import "./HomeGameTasks.css";

type FirestoreDate = { toDate?: () => Date } | string | null | undefined;
type HomeTask = {
  id: string;
  title?: string;
  category?: string;
  priority?: string;
  status?: string;
  assignedTo?: string;
  assignedToName?: string;
  note?: string;
  dueDate?: FirestoreDate;
  kickoffAt?: FirestoreDate;
  matchId?: string;
  teamName?: string;
  homeTeam?: string;
  awayTeam?: string;
  venue?: string;
  active?: boolean;
  paused?: boolean;
  source?: string;
};

function asDate(value: FirestoreDate): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return typeof value.toDate === "function" ? value.toDate() : null;
}

function formatDate(value: FirestoreDate, withTime = true) {
  const date = asDate(value);
  if (!date) return "Termin offen";
  return new Intl.DateTimeFormat("de-AT", {
    weekday: "short", day: "2-digit", month: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export default function HomeGameTasks({ onBack }: { onBack: () => void }) {
  const [tasks, setTasks] = useState<HomeTask[]>([]);
  const [selectedMatch, setSelectedMatch] = useState("");
  const [savingId, setSavingId] = useState("");

  useEffect(() => onSnapshot(collection(db, "tasks"), (snapshot) => {
    setTasks(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as HomeTask))
      .filter((task) => task.source === "home-game-auto"));
  }), []);

  const games = useMemo(() => {
    const map = new Map<string, HomeTask[]>();
    tasks.forEach((task) => {
      if (!task.matchId) return;
      const rows = map.get(task.matchId) || [];
      rows.push(task);
      map.set(task.matchId, rows);
    });
    return [...map.entries()].map(([matchId, rows]) => ({ matchId, rows }))
      .sort((a, b) => (asDate(a.rows[0]?.kickoffAt)?.getTime() || 0) - (asDate(b.rows[0]?.kickoffAt)?.getTime() || 0));
  }, [tasks]);

  useEffect(() => {
    if (!selectedMatch && games[0]) setSelectedMatch(games[0].matchId);
  }, [games, selectedMatch]);

  const current = games.find((game) => game.matchId === selectedMatch) || games[0];
  const rows = [...(current?.rows || [])].sort((a, b) => {
    const priority: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const diff = (priority[a.priority || "medium"] ?? 1) - (priority[b.priority || "medium"] ?? 1);
    return diff || ((asDate(a.dueDate)?.getTime() || 0) - (asDate(b.dueDate)?.getTime() || 0));
  });
  const done = rows.filter((task) => task.status === "done").length;
  const unassigned = rows.filter((task) => !task.assignedToName && !task.assignedTo).length;

  async function patch(task: HomeTask, values: Record<string, unknown>) {
    setSavingId(task.id);
    try { await updateDoc(doc(db, "tasks", task.id), values); }
    finally { setSavingId(""); }
  }

  return (
    <section className="home-game-manager dashboard-page">
      <header className="home-game-manager__header">
        <button type="button" onClick={onBack}>‹ Zurück</button>
        <div><small>TSU Ainet Organisation</small><h2>Heimspiel-Manager</h2><p>Automatische Aufgaben aus dem offiziellen Spielplan.</p></div>
      </header>

      {games.length === 0 ? <div className="home-game-empty">Noch keine kommenden Heimspiele mit Aufgaben gefunden. Nach dem nächsten Core-Sync werden sie automatisch angelegt.</div> : <>
        <div className="home-game-selector">
          {games.map((game) => {
            const first = game.rows[0];
            const count = game.rows.filter((task) => task.status === "done").length;
            return <button key={game.matchId} className={game.matchId === current?.matchId ? "active" : ""} onClick={() => setSelectedMatch(game.matchId)}>
              <strong>{first?.homeTeam} – {first?.awayTeam}</strong>
              <span>{formatDate(first?.kickoffAt)} · {count}/{game.rows.length} erledigt</span>
            </button>;
          })}
        </div>

        {current && <>
          <article className="home-game-summary">
            <div><small>Nächstes Heimspiel</small><h3>{rows[0]?.homeTeam} – {rows[0]?.awayTeam}</h3><p>{formatDate(rows[0]?.kickoffAt)}{rows[0]?.venue ? ` · ${rows[0].venue}` : ""}</p></div>
            <div className="home-game-progress"><strong>{done}/{rows.length}</strong><span>erledigt</span><progress max={Math.max(rows.length, 1)} value={done} /></div>
            <div className={unassigned ? "home-game-warning" : "home-game-ok"}>{unassigned ? `${unassigned} ohne Zuständigen` : "Alle Aufgaben zugewiesen"}</div>
          </article>

          <div className="home-game-task-list">
            {rows.map((task) => <article key={task.id} className={task.status === "done" ? "done" : task.paused ? "paused" : ""}>
              <button className="home-game-check" disabled={savingId === task.id || task.paused} onClick={() => patch(task, { status: task.status === "done" ? "open" : "done" })}>{task.status === "done" ? "✓" : ""}</button>
              <div className="home-game-task-main"><small>{task.category || "Aufgabe"} · {formatDate(task.dueDate)}</small><strong>{task.title}</strong><input value={task.assignedToName || task.assignedTo || ""} placeholder="Zuständige Person eintragen" onChange={(event) => setTasks((currentTasks) => currentTasks.map((row) => row.id === task.id ? { ...row, assignedToName: event.target.value } : row))} onBlur={(event) => patch(task, { assignedToName: event.target.value.trim(), assignedTo: event.target.value.trim() })} /></div>
              <span className={`home-game-priority ${task.priority || "medium"}`}>{task.priority === "high" ? "Wichtig" : task.priority === "low" ? "Später" : "Normal"}</span>
            </article>)}
          </div>
        </>}
      </>}
    </section>
  );
}
