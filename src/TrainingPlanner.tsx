import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { UserProfile } from "./permissions";
import "./TrainingPlanner.css";

type Team = { id: string; name: string; order: number };
type Field = "main" | "training";
type Area = "A" | "B" | "full";
type BookingKind = "training" | "block";

type TrainingBooking = {
  id: string;
  teamId: string;
  teamName: string;
  date: string;
  startTime: string;
  endTime: string;
  field: Field;
  area: Area;
  floodlight: boolean;
  note: string;
  kind: BookingKind;
  createdBy: string;
  createdByName: string;
  updatedBy?: string;
};

type FormState = {
  teamId: string;
  date: string;
  startTime: string;
  endTime: string;
  field: Field;
  area: Area;
  floodlight: boolean;
  note: string;
  repeatWeekly: boolean;
  repeatUntil: string;
  kind: BookingKind;
};

type TrainingPlannerProps = {
  user: User;
  profile: UserProfile;
  onBack: () => void;
};

const FIELD_LABELS: Record<Field, string> = {
  main: "Hauptplatz",
  training: "Trainingsplatz",
};

const todayIso = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days, 12, 0, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  const mondayOffset = (date.getDay() + 6) % 7;
  return addDays(iso, -mondayOffset);
}

function formatDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(y, m - 1, d, 12));
}

function minutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function slotKeys(date: string, startTime: string, endTime: string, field: Field, area: Area) {
  const start = minutes(startTime);
  const end = minutes(endTime);
  const halves = area === "full" ? ["A", "B"] : [area];
  const keys: string[] = [];
  for (let cursor = start; cursor < end; cursor += 15) {
    const h = String(Math.floor(cursor / 60)).padStart(2, "0");
    const m = String(cursor % 60).padStart(2, "0");
    for (const half of halves) keys.push(`${date}_${field}_${half}_${h}${m}`);
  }
  return keys;
}

function emptyForm(teamId = ""): FormState {
  const date = todayIso();
  return {
    teamId,
    date,
    startTime: "18:00",
    endTime: "19:30",
    field: "training",
    area: "A",
    floodlight: false,
    note: "",
    repeatWeekly: false,
    repeatUntil: addDays(date, 56),
    kind: "training",
  };
}

export default function TrainingPlanner({ user, profile, onBack }: TrainingPlannerProps) {
  const isLeader = profile.role === "admin" || profile.role === "section";
  const [teams, setTeams] = useState<Team[]>([]);
  const [bookings, setBookings] = useState<TrainingBooking[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayIso()));
  const [selectedDay, setSelectedDay] = useState(() => todayIso());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingBooking | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!formOpen) return;
    document.documentElement.classList.add("training-modal-open");
    document.body.classList.add("training-modal-open");
    return () => {
      document.documentElement.classList.remove("training-modal-open");
      document.body.classList.remove("training-modal-open");
    };
  }, [formOpen]);

  useEffect(() => {
    const teamsQuery = query(collection(db, "teams"), orderBy("order", "asc"));
    return onSnapshot(teamsQuery, (snapshot) => {
      const next = snapshot.docs
        .map((entry) => ({
          id: entry.id,
          name: typeof entry.data().name === "string" ? entry.data().name : "Mannschaft",
          order: typeof entry.data().order === "number" ? entry.data().order : 999,
          active: entry.data().active !== false,
        }))
        .filter((entry) => entry.active)
        .map(({ id, name, order }) => ({ id, name, order }));
      setTeams(next);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "trainingBookings"), (snapshot) => {
      const next = snapshot.docs.map((entry) => {
        const data = entry.data();
        return {
          id: entry.id,
          teamId: String(data.teamId ?? ""),
          teamName: String(data.teamName ?? "Mannschaft"),
          date: String(data.date ?? ""),
          startTime: String(data.startTime ?? "00:00"),
          endTime: String(data.endTime ?? "00:00"),
          field: data.field === "main" ? "main" : "training",
          area: data.area === "full" ? "full" : data.area === "B" ? "B" : "A",
          floodlight: data.floodlight === true,
          note: String(data.note ?? ""),
          kind: data.kind === "block" ? "block" : "training",
          createdBy: String(data.createdBy ?? ""),
          createdByName: String(data.createdByName ?? ""),
          updatedBy: String(data.updatedBy ?? ""),
        } satisfies TrainingBooking;
      });
      setBookings(next);
    });
  }, []);

  const allowedTeams = useMemo(
    () => isLeader ? teams : teams.filter((team) => profile.teamIds.includes(team.id)),
    [isLeader, profile.teamIds, teams],
  );

  useEffect(() => {
    if (!form.teamId && allowedTeams[0]?.id) setForm((current) => ({ ...current, teamId: allowedTeams[0].id }));
  }, [allowedTeams, form.teamId]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const weekEnd = days[6];
  const visibleBookings = useMemo(
    () => bookings.filter((booking) => booking.date >= weekStart && booking.date <= weekEnd)
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)),
    [bookings, weekEnd, weekStart],
  );

  function canEdit(booking: TrainingBooking) {
    return isLeader || profile.teamIds.includes(booking.teamId);
  }

  function openCreate(date = todayIso(), preset?: { field?: Field; area?: Area }) {
    setEditing(null);
    setError("");
    setMessage("");
    setForm({ ...emptyForm(allowedTeams[0]?.id ?? ""), date, repeatUntil: addDays(date, 56), ...(preset?.field ? { field: preset.field } : {}), ...(preset?.area ? { area: preset.area } : {}) });
    setFormOpen(true);
  }

  function openEdit(booking: TrainingBooking) {
    if (!canEdit(booking)) return;
    setEditing(booking);
    setError("");
    setMessage("");
    setForm({
      teamId: booking.teamId,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      field: booking.field,
      area: booking.area,
      floodlight: booking.floodlight,
      note: booking.note,
      repeatWeekly: false,
      repeatUntil: booking.date,
      kind: booking.kind,
    });
    setFormOpen(true);
  }

  function validate() {
    if (!form.teamId) return "Bitte eine Mannschaft auswählen.";
    if (!isLeader && !profile.teamIds.includes(form.teamId)) return "Du kannst nur für deine Mannschaft buchen.";
    if (minutes(form.startTime) >= minutes(form.endTime)) return "Die Endzeit muss nach der Startzeit liegen.";
    if (minutes(form.startTime) % 15 !== 0 || minutes(form.endTime) % 15 !== 0) return "Trainingszeiten bitte in 15-Minuten-Schritten eintragen.";
    if (minutes(form.endTime) - minutes(form.startTime) > 240) return "Eine einzelne Reservierung darf maximal 4 Stunden dauern.";
    if (form.repeatWeekly && form.repeatUntil < form.date) return "Das Serienende liegt vor dem ersten Termin.";
    if (form.kind === "block" && !isLeader) return "Platzsperren kann nur die Sektionsleitung erstellen.";
    return "";
  }

  async function saveOne(date: string, bookingId?: string, oldBooking?: TrainingBooking) {
    const selectedTeam = teams.find((team) => team.id === form.teamId);
    const bookingRef = bookingId ? doc(db, "trainingBookings", bookingId) : doc(collection(db, "trainingBookings"));
    const newKeys = slotKeys(date, form.startTime, form.endTime, form.field, form.area);
    const oldKeys = oldBooking ? slotKeys(oldBooking.date, oldBooking.startTime, oldBooking.endTime, oldBooking.field, oldBooking.area) : [];
    const newSlotRefs = newKeys.map((key) => doc(db, "trainingSlots", key));
    const oldSlotRefs = oldKeys.map((key) => doc(db, "trainingSlots", key));

    await runTransaction(db, async (transaction) => {
      for (const slotRef of newSlotRefs) {
        const snap = await transaction.get(slotRef);
        if (snap.exists() && snap.data().bookingId !== bookingRef.id) {
          const data = snap.data();
          throw new Error(`CONFLICT|${data.teamName ?? "Andere Mannschaft"}|${data.startTime ?? ""}|${data.endTime ?? ""}`);
        }
      }

      const payload = {
        teamId: form.teamId,
        teamName: form.kind === "block" ? (form.note.trim() || "Platzsperre") : (selectedTeam?.name ?? "Mannschaft"),
        date,
        startTime: form.startTime,
        endTime: form.endTime,
        field: form.field,
        area: form.area,
        floodlight: form.field === "training" && form.floodlight,
        note: form.note.trim(),
        kind: form.kind,
        createdBy: oldBooking?.createdBy || user.uid,
        createdByName: oldBooking?.createdByName || profile.name,
        updatedBy: user.uid,
        updatedByName: profile.name,
        updatedAt: serverTimestamp(),
        ...(oldBooking ? {} : { createdAt: serverTimestamp() }),
      };
      transaction.set(bookingRef, payload, { merge: true });

      const newKeySet = new Set(newKeys);
      oldSlotRefs.forEach((slotRef) => {
        if (!newKeySet.has(slotRef.id)) transaction.delete(slotRef);
      });
      newSlotRefs.forEach((slotRef) => transaction.set(slotRef, {
        bookingId: bookingRef.id,
        teamId: form.teamId,
        teamName: payload.teamName,
        date,
        startTime: form.startTime,
        endTime: form.endTime,
        field: form.field,
        area: form.area,
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
      }));
    });
  }

  async function handleSave() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (editing) {
        await saveOne(form.date, editing.id, editing);
        setMessage("Training wurde geändert. Die Änderung ist sofort auf allen Geräten sichtbar.");
      } else if (form.repeatWeekly) {
        const dates: string[] = [];
        for (let date = form.date, count = 0; date <= form.repeatUntil && count < 40; date = addDays(date, 7), count += 1) dates.push(date);
        let saved = 0;
        for (const date of dates) {
          await saveOne(date);
          saved += 1;
        }
        setMessage(`${saved} Trainingstermine wurden als Serie eingetragen.`);
      } else {
        await saveOne(form.date);
        setMessage("Training wurde eingetragen und ist sofort für alle sichtbar.");
      }
      setFormOpen(false);
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : String(caught);
      if (text.startsWith("CONFLICT|")) {
        const [, team, start, end] = text.split("|");
        setError(`Platz bereits belegt – ${team}${start ? `, ${start}–${end}` : ""}. Bitte eine andere Hälfte oder Zeit wählen.`);
      } else {
        console.error(caught);
        setError("Die Buchung konnte nicht gespeichert werden. Bitte erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(booking: TrainingBooking) {
    if (!canEdit(booking) || !window.confirm(`${booking.teamName} am ${formatDay(booking.date)} wirklich löschen?`)) return;
    setError("");
    try {
      await runTransaction(db, async (transaction) => {
        const bookingRef = doc(db, "trainingBookings", booking.id);
        const slotRefs = slotKeys(booking.date, booking.startTime, booking.endTime, booking.field, booking.area)
          .map((key) => doc(db, "trainingSlots", key));

        // Firestore-Transaktionen verlangen: zuerst ALLE Reads, danach erst Writes/Deletes.
        const slotSnapshots = await Promise.all(
          slotRefs.map((slotRef) => transaction.get(slotRef)),
        );

        slotRefs.forEach((slotRef, index) => {
          const snap = slotSnapshots[index];
          if (snap.exists() && snap.data().bookingId === booking.id) transaction.delete(slotRef);
        });
        transaction.delete(bookingRef);
      });
      setMessage("Termin wurde gelöscht. Die Änderung ist sofort überall sichtbar.");
    } catch (caught) {
      console.error(caught);
      setError("Termin konnte nicht gelöscht werden.");
    }
  }

  const today = todayIso();

  return (
    <section className="training-planner">
      <header className="training-header">
        <button type="button" className="training-back" onClick={onBack}>‹</button>
        <div><span>Trainerbereich</span><h1>Trainingsplaner</h1></div>
        <button type="button" className="training-add" onClick={() => openCreate(today)}><span>+</span> Training</button>
      </header>

      {!isLeader && allowedTeams.length === 0 && (
        <div className="training-alert error">Deinem Trainerkonto ist noch keine Mannschaft zugeordnet. Die Sektionsleitung kann das unter Vereinsverwaltung ändern.</div>
      )}
      {message && <div className="training-alert success">{message}</div>}
      {error && !formOpen && <div className="training-alert error">{error}</div>}

      <div className="training-toolbar">
        <button type="button" className="week-arrow" aria-label="Vorherige Woche" title="Vorherige Woche" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
        <div><strong>{formatDay(weekStart)} – {formatDay(weekEnd)}</strong><button type="button" onClick={() => setWeekStart(startOfWeek(today))}>Diese Woche</button></div>
        <button type="button" className="week-arrow" aria-label="Nächste Woche" title="Nächste Woche" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
      </div>

      <div className="training-day-strip" role="tablist" aria-label="Trainingstag auswählen">
        {days.map((day) => (
          <button
            key={day}
            type="button"
            className={`${selectedDay === day ? "active" : ""} ${day === today ? "today" : ""}`}
            onClick={() => setSelectedDay(day)}
          >
            <span>{new Intl.DateTimeFormat("de-AT", { weekday: "short" }).format(new Date(`${day}T12:00:00`))}</span>
            <strong>{day.slice(8, 10)}.</strong>
            {day === today && <small>Heute</small>}
          </button>
        ))}
      </div>

      <div className="training-field-stack">
        {(["main", "training"] as Field[]).map((field) => {
          const fieldBookings = visibleBookings.filter((booking) => booking.date === selectedDay && booking.field === field);
          const fullBookings = fieldBookings.filter((booking) => booking.area === "full");
          return (
            <article key={field} className={`pitch-card ${field === "training" ? "floodlit" : ""}`}>
              <header className="pitch-card-header">
                <div>
                  <span>{field === "main" ? "Hauptfeld" : "Trainingsplatz"}</span>
                  <h2>{field === "main" ? "Hauptfeld" : "Trainingsplatz"}</h2>
                </div>
                <div className="pitch-meta">
                  {field === "training" && <span className="floodlight-badge">💡 Flutlicht</span>}
                  <strong>{formatDay(selectedDay)}</strong>
                </div>
              </header>

              <div className={`pitch-graphic ${field === "training" ? "training-pitch" : "main-pitch"}`}>
                <div className="pitch-lines" aria-hidden="true">
                  <span className="center-line" />
                  <span className="center-circle" />
                  <span className="box box-left" />
                  <span className="box box-right" />
                </div>

                {(["A", "B"] as const).map((half) => {
                  const halfBookings = fieldBookings.filter((booking) => booking.area === half);
                  return (
                    <button
                      key={half}
                      type="button"
                      className={`pitch-half pitch-half-${half.toLowerCase()}`}
                      onClick={() => openCreate(selectedDay, { field, area: half })}
                    >
                      <span className="half-label">{half === "A" ? "Oben" : "Unten"}</span>
                      <span className="half-add">+ Training</span>
                      <span className="pitch-bookings">
                        {halfBookings.map((booking) => (
                          <span
                            key={booking.id}
                            className={`pitch-booking ${booking.kind}`}
                            role="button"
                            tabIndex={0}
                            onClick={(event) => { event.stopPropagation(); if (canEdit(booking)) openEdit(booking); }}
                            onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && canEdit(booking)) { event.preventDefault(); event.stopPropagation(); openEdit(booking); } }}
                          >
                            <strong>{booking.startTime}–{booking.endTime}</strong>
                            <b>{booking.teamName}</b>
                            {booking.floodlight && <small>💡 Flutlicht</small>}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}

                {fullBookings.map((booking) => (
                  <button
                    key={booking.id}
                    type="button"
                    className={`pitch-full-booking ${booking.kind}`}
                    onClick={() => canEdit(booking) && openEdit(booking)}
                  >
                    <strong>{booking.startTime}–{booking.endTime}</strong>
                    <span>{booking.teamName}</span>
                    <small>Ganzer Platz{booking.floodlight ? " · 💡 Flutlicht" : ""}</small>
                  </button>
                ))}
              </div>

              <footer className="pitch-footer">
                <button type="button" onClick={() => openCreate(selectedDay, { field, area: "full" })}>+ Ganzen Platz buchen</button>
                <span>{fieldBookings.length === 0 ? "Komplett frei" : `${fieldBookings.length} Belegung${fieldBookings.length === 1 ? "" : "en"}`}</span>
              </footer>
            </article>
          );
        })}
      </div>

      <section className="training-week-summary" aria-label="Wochenzusammenfassung">
        <header className="week-summary-header">
          <div>
            <span>Diese Woche</span>
            <h2>Wochenzusammenfassung</h2>
          </div>
          <strong>{visibleBookings.length} Termin{visibleBookings.length === 1 ? "" : "e"}</strong>
        </header>

        <div className="week-summary-days">
          {days.map((day) => {
            const dayBookings = visibleBookings.filter((booking) => booking.date === day);
            return (
              <div key={day} className={`week-summary-day ${day === today ? "today" : ""}`}>
                <div className="week-summary-date">
                  <span>{new Intl.DateTimeFormat("de-AT", { weekday: "short" }).format(new Date(`${day}T12:00:00`))}</span>
                  <strong>{day.slice(8, 10)}.</strong>
                </div>
                <div className="week-summary-bookings">
                  {dayBookings.length === 0 ? (
                    <span className="week-summary-free">Keine Belegung</span>
                  ) : dayBookings.map((booking) => (
                    <button
                      key={booking.id}
                      type="button"
                      className={`week-summary-booking ${booking.kind}`}
                      onClick={() => canEdit(booking) && openEdit(booking)}
                      title={canEdit(booking) ? "Termin bearbeiten" : booking.teamName}
                    >
                      <span className="summary-time">{booking.startTime}–{booking.endTime}</span>
                      <strong>{booking.teamName}</strong>
                      <small>
                        {FIELD_LABELS[booking.field]} · {booking.area === "full" ? "Ganzer Platz" : booking.area === "A" ? "Oben" : "Unten"}
                        {booking.floodlight ? " · 💡 Flutlicht" : ""}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {formOpen && (
        <div className="training-modal-backdrop" onClick={() => !saving && setFormOpen(false)}>
          <div className="training-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header><div><span>{editing ? "Termin bearbeiten" : "Neue Platzbelegung"}</span><h2>{editing ? editing.teamName : "Training eintragen"}</h2></div><button type="button" onClick={() => setFormOpen(false)}>×</button></header>
            <div className="training-form">
              {isLeader && (
                <label><span>Art</span><select value={form.kind} onChange={(e) => setForm((c) => ({ ...c, kind: e.target.value as BookingKind }))}><option value="training">Training</option><option value="block">Platzsperre / Pflege / Veranstaltung</option></select></label>
              )}
              {form.kind === "training" && <label><span>Mannschaft</span><select value={form.teamId} onChange={(e) => setForm((c) => ({ ...c, teamId: e.target.value }))}>{allowedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
              <label><span>Datum</span><input type="date" value={form.date} onChange={(e) => setForm((c) => ({ ...c, date: e.target.value }))} /></label>
              <div className="training-two"><label><span>Beginn</span><input type="time" step="900" value={form.startTime} onChange={(e) => setForm((c) => ({ ...c, startTime: e.target.value }))} /></label><label><span>Ende</span><input type="time" step="900" value={form.endTime} onChange={(e) => setForm((c) => ({ ...c, endTime: e.target.value }))} /></label></div>
              <label><span>Platz</span><select value={form.field} onChange={(e) => setForm((c) => ({ ...c, field: e.target.value as Field, floodlight: e.target.value === "training" ? c.floodlight : false }))}><option value="main">Hauptplatz</option><option value="training">Trainingsplatz · Flutlicht</option></select></label>
              <label><span>Fläche</span><div className="area-choice">{(["A", "B", "full"] as Area[]).map((area) => <button key={area} type="button" className={form.area === area ? "active" : ""} onClick={() => setForm((c) => ({ ...c, area }))}>{area === "full" ? "Ganzer Platz" : area === "A" ? "Oben" : "Unten"}</button>)}</div></label>
              {form.field === "training" && <label className="check-row"><input type="checkbox" checked={form.floodlight} onChange={(e) => setForm((c) => ({ ...c, floodlight: e.target.checked }))} /><span>💡 Flutlicht benötigt</span></label>}
              <label><span>{form.kind === "block" ? "Bezeichnung der Sperre" : "Notiz (optional)"}</span><input value={form.note} onChange={(e) => setForm((c) => ({ ...c, note: e.target.value }))} placeholder={form.kind === "block" ? "z. B. Rasenpflege" : "z. B. Torschusstraining"} /></label>
              {!editing && <label className="check-row"><input type="checkbox" checked={form.repeatWeekly} onChange={(e) => setForm((c) => ({ ...c, repeatWeekly: e.target.checked }))} /><span>Jede Woche wiederholen</span></label>}
              {!editing && form.repeatWeekly && <label><span>Wöchentlich bis</span><input type="date" value={form.repeatUntil} onChange={(e) => setForm((c) => ({ ...c, repeatUntil: e.target.value }))} /></label>}
              {error && <div className="training-alert error">{error}</div>}
              <div className="training-actions">
                {editing && <button type="button" className="danger" disabled={saving} onClick={() => { setFormOpen(false); void handleDelete(editing); }}>Löschen</button>}
                <button type="button" className="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Abbrechen</button>
                <button type="button" className="primary" disabled={saving || allowedTeams.length === 0 && form.kind === "training"} onClick={() => void handleSave()}>{saving ? "Speichert …" : editing ? "Änderung speichern" : "Eintragen"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
