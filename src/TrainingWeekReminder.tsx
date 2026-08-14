import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import type { UserProfile } from "./permissions";

type Team = { id: string; name: string };
type Booking = { teamId: string; date: string; kind: string; startTime: string; endTime: string };

type Props = {
  profile: UserProfile;
  onOpenPlanner: () => void;
};

const YOUTH_KEYS = ["u17", "u12", "u10", "u8"] as const;

function normalize(value: string) {
  return value.toLocaleLowerCase("de-AT").replace(/[^a-z0-9]+/g, "");
}

function youthKey(team: Team) {
  const text = normalize(`${team.id} ${team.name}`);
  if (text.includes("u17")) return "u17";
  if (text.includes("u12")) return "u12";
  if (text.includes("u10")) return "u10";
  if (text.includes("u08") || text.includes("u8")) return "u8";
  return "";
}

function isoLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function currentWeek() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: isoLocal(monday), end: isoLocal(sunday) };
}

export default function TrainingWeekReminder({ profile, onOpenPlanner }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => onSnapshot(collection(db, "teams"), (snapshot) => {
    setTeams(snapshot.docs.map((entry) => ({
      id: entry.id,
      name: String(entry.data().name ?? entry.id),
    })));
  }), []);

  useEffect(() => onSnapshot(collection(db, "trainingBookings"), (snapshot) => {
    setBookings(snapshot.docs.map((entry) => ({
      teamId: String(entry.data().teamId ?? ""),
      date: String(entry.data().date ?? ""),
      kind: String(entry.data().kind ?? "training"),
      startTime: String(entry.data().startTime ?? ""),
      endTime: String(entry.data().endTime ?? ""),
    })));
  }), []);

  const status = useMemo(() => {
    if (profile.role !== "trainer") return [];
    const assigned = new Set(profile.teamIds);
    const relevantTeams = teams
      .filter((team) => assigned.has(team.id) && YOUTH_KEYS.includes(youthKey(team) as typeof YOUTH_KEYS[number]));
    const week = currentWeek();
    return relevantTeams.map((team) => {
      const entries = bookings
        .filter((booking) => booking.teamId === team.id && booking.kind !== "block" && booking.date >= week.start && booking.date <= week.end)
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
      return { team, entries };
    });
  }, [bookings, profile.role, profile.teamIds, teams]);

  if (!status.length) return null;
  const missing = status.filter((entry) => entry.entries.length === 0);
  const total = status.reduce((sum, entry) => sum + entry.entries.length, 0);

  return (
    <section className={`trainer-training-reminder ${missing.length ? "needs-action" : "is-planned"}`} aria-label="Trainingsplanung diese Woche">
      <div className="trainer-training-reminder-icon">{missing.length ? "!" : "✓"}</div>
      <div className="trainer-training-reminder-copy">
        <span className="trainer-training-kicker">TRAININGSPLANER · DIESE WOCHE</span>
        {missing.length ? (
          <>
            <strong>Training noch nicht eingetragen</strong>
            <p>Bitte Training für {missing.map((entry) => entry.team.name).join(", ")} für diese Woche eintragen.</p>
          </>
        ) : (
          <>
            <strong>{total} {total === 1 ? "Training" : "Trainings"} geplant</strong>
            <p>{status.map((entry) => `${entry.team.name}: ${entry.entries.length}`).join(" · ")}</p>
          </>
        )}
      </div>
      <button type="button" onClick={onOpenPlanner}>{missing.length ? "Training eintragen" : "Plan öffnen"}</button>
    </section>
  );
}
