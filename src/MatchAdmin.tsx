import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import "./SportsAdmin.css";

type MatchStatus = "scheduled" | "finished" | "postponed" | "cancelled";
type Match = {
  id: string;
  teamId: string;
  teamName: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  venue: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  active: boolean;
  source: string;
};
type Props = { onBack: () => void };

const TEAMS = ["Kampfmannschaft", "Challenge", "U17", "U12", "U10", "U8"];

function normalizePart(value: string) {
  return value
    .toLocaleLowerCase("de-AT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(?:tsu|sg|sv|fc|sc|usv|asko|askö|union|atv)\b/g, " ")
    .replace(/\b(?:1b|ii|reserve|challenge|kampfmannschaft|km)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function canonicalTeamBucket(match: Match) {
  const text = `${match.teamId} ${match.teamName} ${match.competitionName}`
    .toLocaleLowerCase("de-AT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");

  if (/\bu\s*17\b/.test(text)) return "U17";
  if (/\bu\s*12\b/.test(text)) return "U12";
  if (/\bu\s*10\b/.test(text)) return "U10";
  if (/\bu\s*0?8\b/.test(text)) return "U8";
  if (/challenge|reserve|\bres\b|km[-_ ]?res|\b1b\b|\bii\b/.test(text)) {
    return "CHALLENGE";
  }
  return "KM";
}

function deduplicate(matches: Match[]) {
  const groups = new Map<string, Match[]>();
  for (const match of matches) {
    const key = [
      canonicalTeamBucket(match),
      dayKey(match.kickoffAt),
      normalizePart(match.homeTeam),
      normalizePart(match.awayTeam),
    ].join("|");
    const group = groups.get(key) || [];
    group.push(match);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const ranked = [...group].sort((a, b) => {
        const quality = (match: Match) =>
          (match.active ? 100 : 0) +
          (match.source === "manual" ? 20 : 0) +
          (match.status === "finished" ? 30 : 0) +
          (match.homeScore !== null && match.awayScore !== null ? 30 : 0);
        return quality(b) - quality(a);
      });
      const best = { ...ranked[0] };

      const timeCounts = new Map<number, number>();
      for (const match of group) {
        const time = match.kickoffAt.getTime();
        timeCounts.set(time, (timeCounts.get(time) || 0) + 1);
      }
      const selectedTime = [...timeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (selectedTime) best.kickoffAt = new Date(selectedTime);

      const scored = ranked.find(
        (match) => match.homeScore !== null && match.awayScore !== null,
      );
      if (scored) {
        best.homeScore = scored.homeScore;
        best.awayScore = scored.awayScore;
        best.status = "finished";
      }
      return best;
    })
    .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
}

export default function MatchAdmin({ onBack }: Props) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const empty = {
    teamName: "Kampfmannschaft",
    competitionName: "1. Klasse West",
    homeTeam: "TSU Ainet",
    awayTeam: "",
    date: "",
    time: "17:00",
    venue: "Sandgrubenstadion Ainet",
    status: "scheduled" as MatchStatus,
    homeScore: "",
    awayScore: "",
    active: true,
  };
  const [form, setForm] = useState(empty);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "oefbV12Matches"), orderBy("kickoffAt", "asc")),
        (snapshot) =>
          setMatches(
            snapshot.docs.map((document) => {
              const data = document.data();
              return {
                id: document.id,
                teamId: String(data.teamId ?? ""),
                teamName: String(data.teamName ?? ""),
                competitionName: String(data.competitionName ?? ""),
                homeTeam: String(data.homeTeam ?? ""),
                awayTeam: String(data.awayTeam ?? ""),
                kickoffAt:
                  data.kickoffAt instanceof Timestamp
                    ? data.kickoffAt.toDate()
                    : new Date(),
                venue: String(data.venue ?? ""),
                status: (data.status ?? "scheduled") as MatchStatus,
                homeScore:
                  typeof data.homeScore === "number" ? data.homeScore : null,
                awayScore:
                  typeof data.awayScore === "number" ? data.awayScore : null,
                active: data.active !== false,
                source: String(data.source ?? "manual"),
              };
            }),
          ),
      ),
    [],
  );

  const activeMatches = useMemo(
    () => deduplicate(matches.filter((match) => showInactive || match.active)),
    [matches, showInactive],
  );
  const hiddenDuplicates = Math.max(
    0,
    matches.filter((match) => showInactive || match.active).length -
      activeMatches.length,
  );
  const future = useMemo(
    () =>
      activeMatches.filter(
        (match) => match.active && match.kickoffAt >= new Date(),
      ).length,
    [activeMatches],
  );

  function reset() {
    setEditing(null);
    setForm(empty);
  }

  function edit(match: Match) {
    const date = match.kickoffAt;
    setEditing(match.id);
    setForm({
      teamName: match.teamName,
      competitionName: match.competitionName,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      date: date.toISOString().slice(0, 10),
      time: date.toTimeString().slice(0, 5),
      venue: match.venue,
      status: match.status,
      homeScore: match.homeScore === null ? "" : String(match.homeScore),
      awayScore: match.awayScore === null ? "" : String(match.awayScore),
      active: match.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.awayTeam || !form.date) {
      setMessage("Bitte Gegner und Datum eintragen.");
      return;
    }

    setSaving(true);
    const kickoffAt = Timestamp.fromDate(
      new Date(`${form.date}T${form.time}:00`),
    );
    const teamId = form.teamName.toLowerCase().replaceAll(" ", "-");
    const payload = {
      teamId,
      teamName: form.teamName,
      competitionName: form.competitionName.trim(),
      homeTeam: form.homeTeam.trim(),
      awayTeam: form.awayTeam.trim(),
      kickoffAt,
      venue: form.venue.trim(),
      status: form.status,
      homeScore: form.homeScore === "" ? null : Number(form.homeScore),
      awayScore: form.awayScore === "" ? null : Number(form.awayScore),
      active: form.active,
      source: "manual",
      sourceUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (editing) {
        await updateDoc(doc(db, "oefbV12Matches", editing), payload);
      } else {
        await addDoc(collection(db, "oefbV12Matches"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setMessage("Spiel gespeichert.");
      reset();
    } catch {
      setMessage("Speichern fehlgeschlagen. Prüfe die Firestore-Regeln.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMatch(match: Match) {
    const action = match.source === "manual" ? "löschen" : "ausblenden";
    if (!window.confirm(`Spiel wirklich ${action}?`)) return;

    setMessage("");
    try {
      if (match.source === "manual") {
        await deleteDoc(doc(db, "oefbV12Matches", match.id));
        if (editing === match.id) reset();
        setMessage("Manuell angelegtes Spiel wurde gelöscht.");
      } else {
        await updateDoc(doc(db, "oefbV12Matches", match.id), {
          active: false,
          manualOverride: true,
          updatedAt: serverTimestamp(),
        });
        setMessage("Synchronisiertes Spiel wurde ausgeblendet.");
      }
    } catch (error) {
      console.error("Spiel konnte nicht entfernt werden:", error);
      setMessage("Löschen fehlgeschlagen. Prüfe die Firestore-Regeln und versuche es erneut.");
    }
  }

  return (
    <section className="sports-admin">
      <button className="admin-back" onClick={onBack}>
        ← Zurück
      </button>

      <header>
        <p>TSU Ainet · Firestore</p>
        <h2>Spiele verwalten</h2>
        <span>
          {activeMatches.length} sichtbare Spiele · {future} kommende
        </span>
        {hiddenDuplicates > 0 && (
          <small>{hiddenDuplicates} Dubletten werden ausgeblendet.</small>
        )}
        <label>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          Inaktive Datensätze anzeigen
        </label>
      </header>

      <form onSubmit={submit} className="sports-form">
        <label>
          Mannschaft
          <select
            value={form.teamName}
            onChange={(event) =>
              setForm({ ...form, teamName: event.target.value })
            }
          >
            {TEAMS.map((team) => (
              <option key={team}>{team}</option>
            ))}
          </select>
        </label>
        <label>
          Bewerb
          <input
            value={form.competitionName}
            onChange={(event) =>
              setForm({ ...form, competitionName: event.target.value })
            }
          />
        </label>
        <label>
          Heim
          <input
            value={form.homeTeam}
            onChange={(event) =>
              setForm({ ...form, homeTeam: event.target.value })
            }
          />
        </label>
        <label>
          Auswärts
          <input
            value={form.awayTeam}
            onChange={(event) =>
              setForm({ ...form, awayTeam: event.target.value })
            }
          />
        </label>
        <label>
          Datum
          <input
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
          />
        </label>
        <label>
          Uhrzeit
          <input
            type="time"
            value={form.time}
            onChange={(event) => setForm({ ...form, time: event.target.value })}
          />
        </label>
        <label>
          Spielort
          <input
            value={form.venue}
            onChange={(event) =>
              setForm({ ...form, venue: event.target.value })
            }
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(event) =>
              setForm({
                ...form,
                status: event.target.value as MatchStatus,
              })
            }
          >
            <option value="scheduled">Angesetzt</option>
            <option value="finished">Beendet</option>
            <option value="postponed">Verschoben</option>
            <option value="cancelled">Abgesagt</option>
          </select>
        </label>
        <label>
          Heimtore
          <input
            type="number"
            min="0"
            value={form.homeScore}
            onChange={(event) =>
              setForm({ ...form, homeScore: event.target.value })
            }
          />
        </label>
        <label>
          Auswärtstore
          <input
            type="number"
            min="0"
            value={form.awayScore}
            onChange={(event) =>
              setForm({ ...form, awayScore: event.target.value })
            }
          />
        </label>
        <div className="form-actions">
          <button disabled={saving}>
            {saving
              ? "Speichert…"
              : editing
                ? "Änderungen speichern"
                : "Spiel anlegen"}
          </button>
          {editing && (
            <button type="button" className="secondary" onClick={reset}>
              Abbrechen
            </button>
          )}
        </div>
      </form>

      {message && <p className="admin-message">{message}</p>}

      <div className="admin-list">
        {activeMatches.map((match) => (
          <article key={match.id}>
            <div>
              <small>
                {match.teamName} · {match.competitionName} ·{" "}
                {match.source === "manual" ? "Manuell" : "ÖFB"}
                {!match.active ? " · Inaktiv" : ""}
              </small>
              <strong>
                {match.homeTeam} – {match.awayTeam}
              </strong>
              <span>
                {match.kickoffAt.toLocaleString("de-AT", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                · {match.venue}
              </span>
            </div>
            <b>
              {match.homeScore === null
                ? "–"
                : `${match.homeScore}:${match.awayScore}`}
            </b>
            <button onClick={() => edit(match)}>Bearbeiten</button>
            <button
              type="button"
              className="danger"
              onClick={() => void removeMatch(match)}
            >
              {match.source === "manual" ? "Löschen" : "Ausblenden"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
