import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
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
import "./Admin.css";

type MemberType = "players" | "trainers";

type Team = {
  id: string;
  name: string;
  order: number;
  active: boolean;
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  role: string;
  shirtNumber: number | null;
  order: number;
  active: boolean;
  imageUrl: string;
  profileUrl: string;
  birthday: string;
  source: string;
};

type MemberForm = {
  firstName: string;
  lastName: string;
  position: string;
  role: string;
  shirtNumber: string;
  order: string;
  active: boolean;
  imageUrl: string;
  profileUrl: string;
  birthday: string;
};

type AdminProps = { onBack: () => void };

const emptyForm: MemberForm = {
  firstName: "",
  lastName: "",
  position: "",
  role: "",
  shirtNumber: "",
  order: "1",
  active: true,
  imageUrl: "",
  profileUrl: "",
  birthday: "",
};

function normalizeTeam(value: string) {
  return value.toLocaleLowerCase("de-AT").replace(/[^a-z0-9]+/g, "");
}

function teamAliases(teamName: string) {
  const normalized = normalizeTeam(teamName);
  const aliases: Record<string, string[]> = {
    kampfmannschaft: ["kampfmannschaft", "km"],
    challenge: ["challenge", "reserve", "kmres", "res"],
    reserve: ["challenge", "reserve", "kmres", "res"],
    u17: ["u17"],
    u12: ["u12"],
    u10: ["u10"],
    u8: ["u8", "u08"],
  };
  return aliases[normalized] ?? [normalized];
}

function officialTeamKey(teamName: string) {
  const normalized = normalizeTeam(teamName);
  if (normalized === "kampfmannschaft") return "KM";
  if (["challenge", "reserve"].includes(normalized)) return "RES";
  if (normalized.includes("u17")) return "U17";
  if (normalized.includes("u12")) return "U12";
  if (normalized.includes("u10")) return "U10";
  if (normalized.includes("u8")) return "U8";
  return teamName.toUpperCase().replace(/\s+/g, "-");
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: fullName.trim(), lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}


async function compressMemberPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Bitte wähle eine Bilddatei aus.");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Das Originalbild darf maximal 12 MB groß sein.");
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
      element.src = sourceUrl;
    });

    const size = 480;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Bild konnte nicht verarbeitet werden.");

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);

    const result = canvas.toDataURL("image/jpeg", 0.76);
    if (result.length > 750_000) {
      throw new Error("Das komprimierte Bild ist noch zu groß. Bitte verwende ein kleineres Foto.");
    }
    return result;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function Admin({ onBack }: AdminProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [memberType, setMemberType] = useState<MemberType>("players");
  const [members, setMembers] = useState<Member[]>([]);
  const [formData, setFormData] = useState<MemberForm>(emptyForm);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [isLoadingTeams, setIsLoadingTeams] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const teamsQuery = query(collection(db, "teams"), orderBy("order", "asc"));
    return onSnapshot(
      teamsQuery,
      (snapshot) => {
        const loadedTeams = snapshot.docs
          .map((teamDocument) => {
            const data = teamDocument.data();
            return {
              id: teamDocument.id,
              name: typeof data.name === "string" ? data.name : "Mannschaft",
              order: typeof data.order === "number" ? data.order : 999,
              active: typeof data.active === "boolean" ? data.active : true,
            };
          })
          .filter((team) => team.active);
        setTeams(loadedTeams);
        setSelectedTeamId((current) =>
          loadedTeams.some((team) => team.id === current)
            ? current
            : loadedTeams[0]?.id ?? "",
        );
        setIsLoadingTeams(false);
        setErrorMessage("");
      },
      (error) => {
        console.error("Fehler beim Laden der Mannschaften:", error);
        setErrorMessage("Die Mannschaften konnten nicht geladen werden.");
        setIsLoadingTeams(false);
      },
    );
  }, []);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
  );

  useEffect(() => {
    if (!selectedTeamId || !selectedTeam) {
      setMembers([]);
      setIsLoadingMembers(false);
      return;
    }

    setIsLoadingMembers(true);
    setMembers([]);
    setErrorMessage("");

    if (memberType === "players") {
      const aliases = teamAliases(selectedTeam.name);
      return onSnapshot(
        collection(db, "kfvSquad"),
        (snapshot) => {
          const loadedMembers: Member[] = snapshot.docs
            .filter((playerDocument) => {
              const data = playerDocument.data();
              const officialTeam = normalizeTeam(
                `${typeof data.teamName === "string" ? data.teamName : ""}${
                  typeof data.teamId === "string" ? data.teamId : ""
                }${typeof data.teamKey === "string" ? data.teamKey : ""}`,
              );
              return aliases.some((alias) => officialTeam.includes(alias));
            })
            .map((playerDocument) => {
              const data = playerDocument.data();
              const name = typeof data.name === "string" ? data.name : "";
              const names = splitName(name);
              return {
                id: playerDocument.id,
                firstName: names.firstName,
                lastName: names.lastName,
                position: typeof data.position === "string" ? data.position : "Spieler",
                role: "",
                shirtNumber: typeof data.number === "number" ? data.number : null,
                order:
                  typeof data.order === "number"
                    ? data.order
                    : typeof data.number === "number"
                      ? data.number
                      : 999,
                active: typeof data.active === "boolean" ? data.active : true,
                imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
                profileUrl: typeof data.profileUrl === "string" ? data.profileUrl : "",
                birthday: typeof data.birthday === "string" ? data.birthday : "",
                source: typeof data.source === "string" ? data.source : "manual",
              };
            })
            .sort((a, b) => a.order - b.order || a.lastName.localeCompare(b.lastName, "de-AT"));
          setMembers(loadedMembers);
          setIsLoadingMembers(false);
        },
        (error) => {
          console.error("Fehler beim Laden des ÖFB-Kaders:", error);
          setErrorMessage("Der automatische Kader konnte nicht geladen werden.");
          setIsLoadingMembers(false);
        },
      );
    }

    const membersQuery = query(
      collection(db, "teams", selectedTeamId, "trainers"),
      orderBy("order", "asc"),
    );
    return onSnapshot(
      membersQuery,
      (snapshot) => {
        setMembers(
          snapshot.docs.map((memberDocument) => {
            const data = memberDocument.data();
            return {
              id: memberDocument.id,
              firstName: typeof data.firstName === "string" ? data.firstName : "",
              lastName: typeof data.lastName === "string" ? data.lastName : "",
              position: "",
              role: typeof data.role === "string" ? data.role : "",
              shirtNumber: null,
              order: typeof data.order === "number" ? data.order : 999,
              active: typeof data.active === "boolean" ? data.active : true,
              imageUrl: "",
              profileUrl: "",
              birthday: "",
              source: "manual",
            };
          }),
        );
        setIsLoadingMembers(false);
      },
      (error) => {
        console.error("Fehler beim Laden der Trainer:", error);
        setErrorMessage("Die Trainer konnten nicht geladen werden.");
        setIsLoadingMembers(false);
      },
    );
  }, [selectedTeamId, selectedTeam, memberType]);

  const activeMembersCount = useMemo(
    () => members.filter((member) => member.active).length,
    [members],
  );

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function resetForm() {
    setEditingMemberId(null);
    setFormData({ ...emptyForm, order: String(members.length + 1) });
  }

  function changeMemberType(type: MemberType) {
    setMemberType(type);
    setMembers([]);
    setEditingMemberId(null);
    setFormData(emptyForm);
    clearMessages();
  }

  async function selectMemberPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    clearMessages();
    try {
      const imageUrl = await compressMemberPhoto(file);
      setFormData((current) => ({ ...current, imageUrl }));
      setSuccessMessage("Das Foto wurde vorbereitet. Speichere jetzt die Änderungen.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Das Foto konnte nicht verarbeitet werden.");
    }
  }

  function startEditing(member: Member) {
    setEditingMemberId(member.id);
    setFormData({
      firstName: member.firstName,
      lastName: member.lastName,
      position: member.position,
      role: member.role,
      shirtNumber: member.shirtNumber === null ? "" : String(member.shirtNumber),
      order: String(member.order),
      active: member.active,
      imageUrl: member.imageUrl,
      profileUrl: member.profileUrl,
      birthday: member.birthday,
    });
    clearMessages();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    if (!selectedTeamId || !selectedTeam) {
      setErrorMessage("Bitte wähle eine Mannschaft aus.");
      return;
    }

    const firstName = formData.firstName.trim();
    const lastName = formData.lastName.trim();
    if (!firstName || !lastName) {
      setErrorMessage("Vorname und Nachname müssen ausgefüllt werden.");
      return;
    }
    if (memberType === "players" && !formData.position) {
      setErrorMessage("Bitte wähle eine Position aus.");
      return;
    }
    if (memberType === "trainers" && !formData.role) {
      setErrorMessage("Bitte wähle eine Funktion aus.");
      return;
    }

    const parsedOrder = Number(formData.order);
    const parsedShirtNumber = formData.shirtNumber === "" ? null : Number(formData.shirtNumber);
    if (!Number.isFinite(parsedOrder) || parsedOrder < 1) {
      setErrorMessage("Die Reihenfolge muss mindestens 1 sein.");
      return;
    }
    if (
      parsedShirtNumber !== null &&
      (!Number.isFinite(parsedShirtNumber) || parsedShirtNumber < 0 || parsedShirtNumber > 99)
    ) {
      setErrorMessage("Die Rückennummer muss zwischen 0 und 99 liegen.");
      return;
    }

    setIsSaving(true);
    try {
      if (memberType === "players") {
        const playerData = {
          name: `${firstName} ${lastName}`.trim(),
          position: formData.position,
          number: parsedShirtNumber,
          order: parsedOrder,
          active: formData.active,
          imageUrl: formData.imageUrl.trim(),
          profileUrl: formData.profileUrl.trim(),
          birthday: formData.birthday || "",
          teamId: normalizeTeam(selectedTeam.name),
          teamKey: officialTeamKey(selectedTeam.name),
          teamName: selectedTeam.name,
          manualOverride: true,
          manualUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (editingMemberId) {
          await updateDoc(doc(db, "kfvSquad", editingMemberId), playerData);
          setSuccessMessage("Der Kaderspieler wurde aktualisiert. Die Änderung bleibt auch nach der ÖFB-Synchronisierung erhalten.");
        } else {
          await addDoc(collection(db, "kfvSquad"), {
            ...playerData,
            source: "manual",
            createdAt: serverTimestamp(),
          });
          setSuccessMessage("Der Spieler wurde zum Kader hinzugefügt.");
        }
      } else {
        const trainerData = {
          firstName,
          lastName,
          position: "",
          role: formData.role,
          shirtNumber: null,
          order: parsedOrder,
          active: formData.active,
          imageUrl: formData.imageUrl.trim(),
          updatedAt: serverTimestamp(),
        };
        if (editingMemberId) {
          await updateDoc(doc(db, "teams", selectedTeamId, "trainers", editingMemberId), trainerData);
          setSuccessMessage("Der Trainer wurde aktualisiert.");
        } else {
          await addDoc(collection(db, "teams", selectedTeamId, "trainers"), {
            ...trainerData,
            createdAt: serverTimestamp(),
          });
          setSuccessMessage("Der Trainer wurde hinzugefügt.");
        }
      }
      resetForm();
    } catch (error) {
      console.error("Fehler beim Speichern:", error);
      setErrorMessage("Die Daten konnten nicht gespeichert werden. Prüfe bitte deine Firestore-Regeln.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleMemberStatus(member: Member) {
    clearMessages();
    try {
      const reference =
        memberType === "players"
          ? doc(db, "kfvSquad", member.id)
          : doc(db, "teams", selectedTeamId, "trainers", member.id);
      await updateDoc(reference, {
        active: !member.active,
        ...(memberType === "players" ? { manualOverride: true, manualUpdatedAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      });
      setSuccessMessage(
        member.active
          ? `${member.firstName} ${member.lastName} wurde deaktiviert.`
          : `${member.firstName} ${member.lastName} wurde aktiviert.`,
      );
    } catch (error) {
      console.error("Fehler beim Ändern des Status:", error);
      setErrorMessage("Der Status konnte nicht geändert werden.");
    }
  }

  async function removeMember(member: Member) {
    const fullName = `${member.firstName} ${member.lastName}`.trim();
    const isOfficial = memberType === "players" && member.source === "oefb-public";
    const confirmed = window.confirm(
      isOfficial
        ? `${fullName} stammt aus dem ÖFB-Kader. Soll der Spieler dauerhaft in der App ausgeblendet werden?`
        : `Soll ${fullName} wirklich endgültig gelöscht werden?`,
    );
    if (!confirmed) return;
    clearMessages();
    try {
      if (isOfficial) {
        await updateDoc(doc(db, "kfvSquad", member.id), {
          active: false,
          manualOverride: true,
          manualUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSuccessMessage(`${fullName} wurde in der App ausgeblendet.`);
      } else {
        const reference =
          memberType === "players"
            ? doc(db, "kfvSquad", member.id)
            : doc(db, "teams", selectedTeamId, "trainers", member.id);
        await deleteDoc(reference);
        setSuccessMessage(`${fullName} wurde gelöscht.`);
      }
      if (editingMemberId === member.id) resetForm();
    } catch (error) {
      console.error("Fehler beim Löschen:", error);
      setErrorMessage("Die Person konnte nicht gelöscht werden.");
    }
  }

  return (
    <section className="admin-page">
      <button type="button" className="admin-back-button" onClick={onBack}>
        <span aria-hidden="true">‹</span>Mehr
      </button>

      <div className="admin-header">
        <div>
          <p className="admin-eyebrow">TSU Ainet Fußball</p>
          <h2>Vereinsverwaltung</h2>
          <p>Automatische ÖFB-Kader sowie Trainer direkt in der App verwalten.</p>
        </div>
        <span className="admin-badge">Admin</span>
      </div>

      {errorMessage && <div className="admin-message admin-error-message"><strong>Fehler</strong><p>{errorMessage}</p></div>}
      {successMessage && <div className="admin-message admin-success-message"><strong>Erfolgreich</strong><p>{successMessage}</p></div>}

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Mannschaft</span>
          <select
            value={selectedTeamId}
            disabled={isLoadingTeams}
            onChange={(event) => {
              setSelectedTeamId(event.target.value);
              setEditingMemberId(null);
              setFormData(emptyForm);
              clearMessages();
            }}
          >
            {isLoadingTeams && <option value="">Mannschaften werden geladen …</option>}
            {!isLoadingTeams && teams.length === 0 && <option value="">Keine Mannschaften vorhanden</option>}
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <div className="admin-type-tabs">
          <button type="button" className={memberType === "players" ? "active" : ""} onClick={() => changeMemberType("players")}>Spieler</button>
          <button type="button" className={memberType === "trainers" ? "active" : ""} onClick={() => changeMemberType("trainers")}>Trainer</button>
        </div>
      </div>

      <div className="admin-summary-grid">
        <article className="admin-summary-card"><span>Mannschaft</span><strong>{selectedTeam?.name ?? "–"}</strong></article>
        <article className="admin-summary-card"><span>{memberType === "players" ? "Spieler gesamt" : "Trainer gesamt"}</span><strong>{members.length}</strong></article>
        <article className="admin-summary-card"><span>Aktiv</span><strong>{activeMembersCount}</strong></article>
      </div>

      <div className="admin-layout">
        <form className="admin-form-card" onSubmit={saveMember}>
          <div className="admin-card-header">
            <div>
              <p className="admin-eyebrow">{editingMemberId ? "Eintrag bearbeiten" : "Neuer Eintrag"}</p>
              <h3>{memberType === "players" ? "Spieler" : "Trainer"}</h3>
            </div>
            {editingMemberId && <button type="button" className="admin-text-button" onClick={resetForm}>Abbrechen</button>}
          </div>

          <div className="admin-form-grid">
            <label className="admin-field"><span>Vorname</span><input type="text" value={formData.firstName} placeholder="Vorname" autoComplete="off" onChange={(event) => setFormData((current) => ({ ...current, firstName: event.target.value }))} /></label>
            <label className="admin-field"><span>Nachname</span><input type="text" value={formData.lastName} placeholder="Nachname" autoComplete="off" onChange={(event) => setFormData((current) => ({ ...current, lastName: event.target.value }))} /></label>

            {memberType === "players" && <>
              <label className="admin-field"><span>Position</span><select value={formData.position} onChange={(event) => setFormData((current) => ({ ...current, position: event.target.value }))}>
                <option value="">Position auswählen</option><option value="Tor">Torwart</option><option value="Abwehr">Abwehr</option><option value="Mittelfeld">Mittelfeld</option><option value="Sturm">Sturm</option><option value="Spieler">Spieler</option>
              </select></label>
              <label className="admin-field"><span>Rückennummer</span><input type="number" min="0" max="99" value={formData.shirtNumber} placeholder="Zum Beispiel 1" onChange={(event) => setFormData((current) => ({ ...current, shirtNumber: event.target.value }))} /></label>
              <label className="admin-field"><span>Geburtstag</span><input type="date" value={formData.birthday} onChange={(event) => setFormData((current) => ({ ...current, birthday: event.target.value }))} /></label>
              <label className="admin-field admin-field-wide"><span>ÖFB-Profil-URL</span><input type="url" value={formData.profileUrl} placeholder="https://vereine.oefb.at/…" onChange={(event) => setFormData((current) => ({ ...current, profileUrl: event.target.value }))} /></label>
            </>}

            <div className="admin-field admin-field-wide admin-photo-field">
              <span>{memberType === "players" ? "Spielerfoto" : "Trainerfoto"}</span>
              <div className="admin-photo-actions">
                <label className="admin-photo-upload">
                  Foto auswählen
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectMemberPhoto} />
                </label>
                {formData.imageUrl && <button type="button" className="admin-photo-remove" onClick={() => setFormData((current) => ({ ...current, imageUrl: "" }))}>Foto entfernen</button>}
              </div>
              <small>Das Foto wird automatisch quadratisch zugeschnitten und komprimiert. Es wird kostenlos direkt beim {memberType === "players" ? "Spieler" : "Trainer"} in Firestore gespeichert.</small>
              <input type="text" value={formData.imageUrl.startsWith("data:image/") ? "Eigenes Foto ausgewählt" : formData.imageUrl} placeholder="Optional: externe Bild-URL" onChange={(event) => setFormData((current) => ({ ...current, imageUrl: event.target.value === "Eigenes Foto ausgewählt" ? current.imageUrl : event.target.value }))} readOnly={formData.imageUrl.startsWith("data:image/")} />
            </div>

            {memberType === "trainers" && <label className="admin-field admin-field-wide"><span>Funktion</span><select value={formData.role} onChange={(event) => setFormData((current) => ({ ...current, role: event.target.value }))}>
              <option value="">Funktion auswählen</option><option value="Trainer">Trainer</option><option value="Co-Trainer">Co-Trainer</option><option value="Torwarttrainer">Torwarttrainer</option><option value="Betreuer">Betreuer</option><option value="Teammanager">Teammanager</option>
            </select></label>}

            <label className="admin-field"><span>Reihenfolge</span><input type="number" min="1" value={formData.order} onChange={(event) => setFormData((current) => ({ ...current, order: event.target.value }))} /></label>
            <label className="admin-switch-field"><input type="checkbox" checked={formData.active} onChange={(event) => setFormData((current) => ({ ...current, active: event.target.checked }))} /><span className="admin-switch" /><span className="admin-switch-copy"><strong>Aktiv</strong><small>In der Mannschaft anzeigen</small></span></label>
          </div>

          {formData.imageUrl && <div className="admin-photo-preview"><img src={formData.imageUrl} alt={memberType === "players" ? "Vorschau Spielerfoto" : "Vorschau Trainerfoto"} onError={(event) => { event.currentTarget.style.display = "none"; }} /><div><strong>Fotovorschau</strong><span>Das Foto wird erst mit „Änderungen speichern“ dauerhaft übernommen.</span></div></div>}

          <button type="submit" className="admin-save-button" disabled={isSaving || !selectedTeamId}>
            {isSaving ? "Wird gespeichert …" : editingMemberId ? "Änderungen speichern" : memberType === "players" ? "Spieler hinzufügen" : "Trainer hinzufügen"}
          </button>
        </form>

        <article className="admin-list-card">
          <div className="admin-card-header"><div><p className="admin-eyebrow">{selectedTeam?.name ?? "Mannschaft"}</p><h3>{memberType === "players" ? "Spielerkader" : "Trainerteam"}</h3></div><span className="admin-count">{members.length}</span></div>
          {memberType === "players" && <p style={{ marginTop: 0, opacity: 0.78 }}>ÖFB-Spieler werden automatisch übernommen. Deine Bearbeitungen haben Vorrang und bleiben beim nächsten Sync erhalten.</p>}
          {isLoadingMembers && <div className="admin-loading"><span className="admin-spinner" /><p>Daten werden geladen …</p></div>}
          {!isLoadingMembers && members.length === 0 && <div className="admin-empty-state"><span>{memberType === "players" ? "S" : "T"}</span><strong>{memberType === "players" ? "Noch keine Spieler" : "Noch keine Trainer"}</strong><p>{memberType === "players" ? "Starte zuerst die ÖFB-Synchronisierung oder lege einen Spieler manuell an." : "Lege den ersten Eintrag über das Formular an."}</p></div>}
          {!isLoadingMembers && members.length > 0 && <div className="admin-member-list">
            {members.map((member) => <div className={`admin-member-row ${member.active ? "" : "inactive"}`} key={member.id}>
              <div className="admin-member-avatar" style={member.imageUrl ? { padding: 0, overflow: "hidden" } : undefined}>
                {member.imageUrl ? <img src={member.imageUrl} alt={`${member.firstName} ${member.lastName}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(event) => { event.currentTarget.style.display = "none"; }} /> : memberType === "players" && member.shirtNumber !== null ? member.shirtNumber : member.firstName.charAt(0).toUpperCase()}
              </div>
              <div className="admin-member-info"><strong>{member.firstName} {member.lastName}</strong><span>{memberType === "players" ? member.position || "Keine Position" : member.role || "Keine Funktion"}{memberType === "players" && member.source === "oefb-public" ? " · ÖFB" : ""}</span></div>
              <div className="admin-member-status">{member.active ? "Aktiv" : "Inaktiv"}</div>
              <div className="admin-member-actions"><button type="button" onClick={() => startEditing(member)}>Bearbeiten</button><button type="button" onClick={() => toggleMemberStatus(member)}>{member.active ? "Deaktivieren" : "Aktivieren"}</button><button type="button" className="danger" onClick={() => removeMember(member)}>{memberType === "players" && member.source === "oefb-public" ? "Ausblenden" : "Löschen"}</button></div>
            </div>)}
          </div>}
        </article>
      </div>
    </section>
  );
}

export default Admin;
