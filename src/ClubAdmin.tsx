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
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { roleLabel, type AppRole } from "./permissions";
import "./ClubAdmin.css";

type Tab = "users" | "invites" | "tasks" | "services" | "documents" | "sponsors";
type RowValue = string | number | boolean | string[] | undefined;
type Row = { id: string; [key: string]: RowValue };

type ClubForm = Record<string, string>;

const roles: AppRole[] = ["admin", "section", "board", "trainer", "player", "member", "fan"];
const teams = ["KM", "Challenge", "U17", "U12", "U10", "U8"];
const tabLabels: Record<Tab, string> = {
  users: "Benutzer",
  invites: "Einladungen",
  tasks: "Aufgaben",
  services: "Dienste",
  documents: "Dokumente",
  sponsors: "Sponsoren",
};

function createInviteCode() {
  return `TSU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function rowText(value: RowValue) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number") return String(value);
  return value ?? "";
}

function rowStringArray(value: RowValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}


function teamLabel(team: string) {
  if (team === "KM") return "Kampfmannschaft";
  if (team === "Challenge") return "Challenge";
  return team;
}

export default function ClubAdmin({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("users");
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ClubForm>({});
  const [openTeamPicker, setOpenTeamPicker] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(collection(db, "users"), (snapshot) =>
        setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Row)),
      ),
    [],
  );

  useEffect(() => {
    if (tab === "users") return undefined;
    const listQuery = query(collection(db, tab), orderBy("createdAt", "desc"));
    return onSnapshot(
      listQuery,
      (snapshot) => setRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Row)),
      () => setRows([]),
    );
  }, [tab]);

  const shownUsers = useMemo(() => {
    const needle = search.toLocaleLowerCase("de-AT");
    return users.filter((user) =>
      `${rowText(user.name)} ${rowText(user.email)}`.toLocaleLowerCase("de-AT").includes(needle),
    );
  }, [users, search]);


  async function toggleUserTeam(userId: string, currentTeamIds: string[], team: string) {
    const nextTeamIds = currentTeamIds.includes(team)
      ? currentTeamIds.filter((item) => item !== team)
      : [...currentTeamIds, team];

    await updateDoc(doc(db, "users", userId), { teamIds: nextTeamIds });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const base: Record<string, unknown> = {
      ...form,
      createdAt: serverTimestamp(),
      active: true,
    };
    if (tab === "invites") Object.assign(base, { code: createInviteCode(), used: false });
    if (tab === "tasks") Object.assign(base, { status: "open" });
    await addDoc(collection(db, tab), base);
    setForm({});
  }

  const field = (name: string, label: string, type = "text") => (
    <input
      type={type}
      placeholder={label}
      value={form[name] ?? ""}
      onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
      required
    />
  );

  return (
    <section className="club-admin">
      <header>
        <button type="button" onClick={onBack}>‹ Zurück</button>
        <div><small>TSU Ainet</small><h2>Vereinsverwaltung</h2></div>
      </header>

      <nav>
        {(Object.keys(tabLabels) as Tab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {tabLabels[item]}
          </button>
        ))}
      </nav>

      {tab === "users" ? (
        <div className="admin-panel">
          <div className="admin-title">
            <div><h3>Benutzer</h3><p>{users.filter((user) => user.approved !== true).length} offene Freigaben</p></div>
            <input placeholder="Suchen …" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>

          <div className="user-list">
            {shownUsers.map((user) => {
              const name = rowText(user.name);
              const email = rowText(user.email);
              const role = rowText(user.role) || "pending";
              const active = user.active !== false;
              const approved = user.approved === true;
              const teamIds = rowStringArray(user.teamIds);

              return (
                <article key={user.id}>
                  <div className="avatar">{(name || email || "?").slice(0, 2).toUpperCase()}</div>
                  <div className="user-main">
                    <strong>{name || "Ohne Name"}</strong>
                    <small>{email}</small>
                    <div className="chips">
                      {!approved && <span className="warn">Freigabe offen</span>}
                      <span>{roleLabel(role as AppRole)}</span>
                      {teamIds.map((team) => <span key={team} className="team-chip">{teamLabel(team)}</span>)}
                    </div>
                  </div>
                  <div className="user-actions">
                    <select value={role} onChange={(event) => void updateDoc(doc(db, "users", user.id), { role: event.target.value })}>
                      <option value="pending">Ausstehend</option>
                      {roles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}
                    </select>
                    <div className="team-assignment">
                      <button
                        type="button"
                        className={`team-assignment-trigger ${teamIds.length ? "has-teams" : ""}`}
                        aria-expanded={openTeamPicker === user.id}
                        onClick={() => setOpenTeamPicker((current) => current === user.id ? null : user.id)}
                      >
                        <span className="team-assignment-trigger-copy">
                          <small>Mannschaft</small>
                          <strong>
                            {teamIds.length === 0
                              ? "Keine"
                              : teamIds.length <= 2
                                ? teamIds.map(teamLabel).join(", ")
                                : `${teamIds.length} Mannschaften`}
                          </strong>
                        </span>
                        <span className="team-assignment-chevron">⌄</span>
                      </button>

                      {openTeamPicker === user.id && (
                        <div className="team-assignment-picker">
                          <div className="team-assignment-picker-head">
                            <strong>Mannschaften zuordnen</strong>
                            <small>Mehrfachauswahl möglich</small>
                          </div>
                          <div className="team-assignment-options">
                            {teams.map((team) => {
                              const selected = teamIds.includes(team);
                              return (
                                <button
                                  key={team}
                                  type="button"
                                  className={selected ? "selected" : ""}
                                  onClick={() => void toggleUserTeam(user.id, teamIds, team)}
                                >
                                  <span className="team-check">{selected ? "✓" : ""}</span>
                                  <span>{teamLabel(team)}</span>
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            className="team-assignment-done"
                            onClick={() => setOpenTeamPicker(null)}
                          >
                            Fertig
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void updateDoc(doc(db, "users", user.id), {
                        approved: true,
                        active: true,
                        role: role === "pending" ? "member" : role,
                      })}
                    >Freigeben</button>
                    <button
                      type="button"
                      className="muted"
                      onClick={() => void updateDoc(doc(db, "users", user.id), { active: !active })}
                    >{active ? "Sperren" : "Aktivieren"}</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="admin-grid">
          <form className="admin-panel create-form" onSubmit={save}>
            <h3>{tab === "invites" ? "Einladung erstellen" : tab === "tasks" ? "Aufgabe anlegen" : tab === "services" ? "Dienst einteilen" : tab === "documents" ? "Dokument verlinken" : "Sponsor anlegen"}</h3>
            {tab === "invites" && <>{field("name", "Name")}{field("email", "E-Mail", "email")}<select value={form.role ?? "member"} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>{roles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select><select value={form.teamId ?? ""} onChange={(event) => setForm((current) => ({ ...current, teamId: event.target.value }))}><option value="">Keine Mannschaft</option>{teams.map((team) => <option key={team} value={team}>{team}</option>)}</select></>}
            {tab === "tasks" && <>{field("title", "Aufgabe")}{field("assignedTo", "Zuständig")}{field("dueDate", "Fällig am", "date")}</>}
            {tab === "services" && <>{field("title", "Dienst / Tätigkeit")}{field("assignedTo", "Eingeteilte Person")}{field("date", "Datum", "date")}{field("time", "Uhrzeit", "time")}</>}
            {tab === "documents" && <>{field("title", "Bezeichnung")}{field("url", "Link zum Dokument", "url")}{field("category", "Kategorie")}</>}
            {tab === "sponsors" && <>{field("name", "Sponsorname")}{field("website", "Webseite", "url")}{field("logoUrl", "Logo-URL", "url")}</>}
            <button className="primary" type="submit">Speichern</button>
          </form>

          <div className="admin-panel">
            <h3>Vorhandene Einträge</h3>
            <div className="simple-list">
              {rows.map((row) => {
                const title = rowText(row.title) || rowText(row.name) || rowText(row.code);
                const detail = rowText(row.assignedTo) || rowText(row.email) || rowText(row.website) || rowText(row.url) || rowText(row.date);
                const status = rowText(row.status);
                return (
                  <article key={row.id}>
                    <div>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                      {row.code && <code>{rowText(row.code)}</code>}
                    </div>
                    {tab === "tasks" && (
                      <button type="button" onClick={() => void updateDoc(doc(db, tab, row.id), { status: status === "done" ? "open" : "done" })}>
                        {status === "done" ? "Erledigt ✓" : "Offen"}
                      </button>
                    )}
                    <button type="button" className="danger" onClick={() => void deleteDoc(doc(db, tab, row.id))}>Löschen</button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
