import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { clubLogoFileToDataUrl, validateClubLogoImage } from "./clubLogoImage";
import "./ClubPeopleManager.css";

type PersonKind = "board" | "trainer";

type ClubPerson = {
  id: string;
  kind: PersonKind;
  name: string;
  role: string;
  teamName: string;
  photoUrl: string;
  phone: string;
  email: string;
  publicPhone: boolean;
  publicEmail: boolean;
  active: boolean;
  order: number;
};

type FormState = Omit<ClubPerson, "order">;

const EMPTY_FORM: FormState = {
  id: "",
  kind: "board",
  name: "",
  role: "",
  teamName: "",
  photoUrl: "",
  phone: "",
  email: "",
  publicPhone: true,
  publicEmail: true,
  active: true,
};

function cleanPhone(value: string) {
  return value.replace(/[^+\d\s()/.-]/g, "").trim();
}

function ClubPeopleManager({ kind, onBack }: { kind: PersonKind; onBack: () => void }) {
  const [people, setPeople] = useState<ClubPerson[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, kind });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => onSnapshot(
    collection(db, "clubPeople"),
    (snapshot) => {
      const rows = snapshot.docs.map((item, index) => {
        const data = item.data();
        return {
          id: item.id,
          kind: data.kind === "trainer" ? "trainer" : "board",
          name: typeof data.name === "string" ? data.name.trim() : "",
          role: typeof data.role === "string" ? data.role.trim() : "",
          teamName: typeof data.teamName === "string" ? data.teamName.trim() : "",
          photoUrl: typeof data.photoUrl === "string" ? data.photoUrl.trim() : "",
          phone: typeof data.phone === "string" ? data.phone.trim() : "",
          email: typeof data.email === "string" ? data.email.trim() : "",
          publicPhone: data.publicPhone !== false,
          publicEmail: data.publicEmail !== false,
          active: data.active !== false && data.public !== false,
          order: typeof data.order === "number" ? data.order : index,
        } satisfies ClubPerson;
      });
      setPeople(rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de-AT")));
      setLoading(false);
    },
    (snapshotError) => {
      console.error(snapshotError);
      setError("Die Personen konnten nicht geladen werden.");
      setLoading(false);
    },
  ), []);

  useEffect(() => {
    if (!selectedFile) {
      setPreview(form.photoUrl);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile, form.photoUrl]);

  useEffect(() => {
    if (!editorOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.classList.add("people-editor-open");
    document.documentElement.classList.add("people-editor-open");
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.classList.remove("people-editor-open");
      document.documentElement.classList.remove("people-editor-open");
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [editorOpen]);

  useEffect(() => {
    if (!editorOpen) return;

    const viewport = window.visualViewport;
    const updateViewportHeight = () => {
      const height = viewport?.height || window.innerHeight;
      document.documentElement.style.setProperty("--people-viewport-height", `${Math.round(height)}px`);
    };

    updateViewportHeight();
    viewport?.addEventListener("resize", updateViewportHeight);
    viewport?.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("resize", updateViewportHeight);

    return () => {
      viewport?.removeEventListener("resize", updateViewportHeight);
      viewport?.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("resize", updateViewportHeight);
      document.documentElement.style.removeProperty("--people-viewport-height");
    };
  }, [editorOpen]);

  const kindPeople = useMemo(() => people.filter((person) => person.kind === kind), [people, kind]);
  const filtered = useMemo(() => {
    const needle = search.toLocaleLowerCase("de-AT").trim();
    if (!needle) return kindPeople;
    return kindPeople.filter((person) =>
      [person.name, person.role, person.teamName].join(" ").toLocaleLowerCase("de-AT").includes(needle),
    );
  }, [kindPeople, search]);

  const title = kind === "trainer" ? "Trainer verwalten" : "Vorstand verwalten";
  const singular = kind === "trainer" ? "Trainer" : "Person";

  function openCreate() {
    setForm({ ...EMPTY_FORM, kind });
    setSelectedFile(null);
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  function openEdit(person: ClubPerson) {
    setForm({
      id: person.id,
      kind: person.kind,
      name: person.name,
      role: person.role,
      teamName: person.teamName,
      photoUrl: person.photoUrl,
      phone: person.phone,
      email: person.email,
      publicPhone: person.publicPhone,
      publicEmail: person.publicEmail,
      active: person.active,
    });
    setSelectedFile(null);
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditorOpen(false);
    setSelectedFile(null);
    setForm({ ...EMPTY_FORM, kind });
  }

  function selectFile(file: File | null) {
    setError("");
    if (!file) {
      setSelectedFile(null);
      return;
    }
    try {
      validateClubLogoImage(file);
      setSelectedFile(file);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Ungültige Bilddatei.");
      setSelectedFile(null);
    }
  }

  async function savePerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.replace(/\s+/g, " ").trim();
    const role = form.role.replace(/\s+/g, " ").trim();
    const teamName = form.teamName.replace(/\s+/g, " ").trim();
    const email = form.email.trim();

    if (!name) {
      setError("Bitte einen Namen eingeben.");
      return;
    }
    if (!role) {
      setError("Bitte eine Funktion eingeben.");
      return;
    }
    if (kind === "trainer" && !teamName) {
      setError("Bitte eine Mannschaft eingeben.");
      return;
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      setError("Die E-Mail-Adresse ist ungültig.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      let photoUrl = form.photoUrl.trim();
      if (selectedFile) photoUrl = await clubLogoFileToDataUrl(selectedFile);
      const payload = {
        kind,
        name,
        role,
        teamName: kind === "trainer" ? teamName : "",
        photoUrl,
        phone: cleanPhone(form.phone),
        email,
        publicPhone: form.publicPhone,
        publicEmail: form.publicEmail,
        active: form.active,
        public: form.active,
        updatedAt: serverTimestamp(),
      };

      if (form.id) {
        await updateDoc(doc(db, "clubPeople", form.id), payload);
      } else {
        await addDoc(collection(db, "clubPeople"), {
          ...payload,
          order: kindPeople.length,
          createdAt: serverTimestamp(),
        });
      }
      setMessage(form.id ? `${singular} aktualisiert.` : `${singular} hinzugefügt.`);
      closeEditor();
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : "Die Person konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function removePerson(person: ClubPerson) {
    if (!window.confirm(`„${person.name}“ endgültig löschen?`)) return;
    try {
      await deleteDoc(doc(db, "clubPeople", person.id));
      setMessage("Person gelöscht.");
    } catch (deleteError) {
      console.error(deleteError);
      setError("Die Person konnte nicht gelöscht werden.");
    }
  }

  async function movePerson(person: ClubPerson, direction: -1 | 1) {
    const list = kindPeople;
    const currentIndex = list.findIndex((item) => item.id === person.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= list.length) return;
    const target = list[targetIndex];
    try {
      await Promise.all([
        updateDoc(doc(db, "clubPeople", person.id), { order: target.order, updatedAt: serverTimestamp() }),
        updateDoc(doc(db, "clubPeople", target.id), { order: person.order, updatedAt: serverTimestamp() }),
      ]);
    } catch (moveError) {
      console.error(moveError);
      setError("Die Reihenfolge konnte nicht geändert werden.");
    }
  }

  return (
    <section className="people-manager-page">
      <header className="people-manager-header">
        <button type="button" className="people-manager-back" onClick={onBack}>‹</button>
        <h2>{title}</h2>
        <button type="button" className="people-manager-add" onClick={openCreate}>+ Hinzufügen</button>
      </header>

      <div className="people-manager-tools">
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, Funktion oder Mannschaft suchen" />
      </div>

      {message && <div className="people-manager-message success">{message}</div>}
      {error && <div className="people-manager-message error">{error}</div>}

      {loading ? <div className="people-manager-empty">Personen werden geladen …</div> : filtered.length === 0 ? (
        <div className="people-manager-empty"><strong>Noch keine Einträge</strong><button type="button" onClick={openCreate}>Ersten Eintrag anlegen</button></div>
      ) : (
        <div className="people-manager-list">
          {filtered.map((person, index) => (
            <article className={`people-manager-card ${person.active ? "" : "inactive"}`} key={person.id}>
              <div className="people-manager-photo">
                {person.photoUrl ? <img src={person.photoUrl} alt={person.name} /> : <span>{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>}
              </div>
              <div className="people-manager-info">
                <strong>{person.name}</strong>
                <span>{person.role}</span>
                {kind === "trainer" && <small>{person.teamName}</small>}
                {!person.active && <em>Ausgeblendet</em>}
              </div>
              <div className="people-manager-actions">
                <button type="button" aria-label="Nach oben" disabled={index === 0} onClick={() => movePerson(person, -1)}>↑</button>
                <button type="button" aria-label="Nach unten" disabled={index === filtered.length - 1} onClick={() => movePerson(person, 1)}>↓</button>
                <button type="button" onClick={() => openEdit(person)}>Bearbeiten</button>
                <button type="button" className="danger" onClick={() => removePerson(person)}>Löschen</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editorOpen && createPortal(
        <div
          className="people-manager-modal"
          role="dialog"
          aria-modal="true"
          aria-label={form.id ? "Eintrag bearbeiten" : "Eintrag hinzufügen"}
        >
          <form
            className="people-manager-editor"
            onSubmit={savePerson}
          >
            <div className="people-manager-editor-head">
              <h3>{form.id ? "Eintrag bearbeiten" : "Eintrag hinzufügen"}</h3>
              <button type="button" onClick={closeEditor} aria-label="Fenster schließen">×</button>
            </div>

            <div className="people-manager-editor-scroll">
              <label>Name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus /></label>
              <label>Funktion<input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} placeholder={kind === "trainer" ? "z. B. Trainer, Co-Trainer" : "z. B. Obmann, Sektionsleiter"} /></label>
              {kind === "trainer" && <label>Mannschaft<input value={form.teamName} onChange={(event) => setForm((current) => ({ ...current, teamName: event.target.value }))} placeholder="z. B. Kampfmannschaft, U17" /></label>}
              <label>Telefon<input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} inputMode="tel" /></label>
              <label>E-Mail<input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} inputMode="email" /></label>
              <div className="people-manager-file-field"><span>Foto</span><label className="people-manager-file-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectFile(event.target.files?.[0] || null)} />{selectedFile ? "Andere Datei wählen" : form.photoUrl ? "Foto ersetzen" : "Foto auswählen"}</label><small>PNG, JPG oder WebP · wird automatisch verkleinert</small></div>
              <div className="people-manager-divider"><span>oder</span></div>
              <label>Foto-URL<input type="url" value={form.photoUrl} onChange={(event) => { setSelectedFile(null); setForm((current) => ({ ...current, photoUrl: event.target.value })); }} placeholder="https://…/foto.jpg" /></label>
              <div className="people-manager-checkboxes">
                <label><input type="checkbox" checked={form.publicPhone} onChange={(event) => setForm((current) => ({ ...current, publicPhone: event.target.checked }))} />Telefon öffentlich anzeigen</label>
                <label><input type="checkbox" checked={form.publicEmail} onChange={(event) => setForm((current) => ({ ...current, publicEmail: event.target.checked }))} />E-Mail öffentlich anzeigen</label>
                <label><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />In der App anzeigen</label>
              </div>
              <div className="people-manager-preview">{preview ? <img src={preview} alt="Foto-Vorschau" /> : <span>Foto-Vorschau</span>}</div>
            </div>

            <div className="people-manager-editor-actions">
              <button type="button" className="secondary" onClick={closeEditor} disabled={saving}>Abbrechen</button>
              <button type="submit" disabled={saving}>{saving ? "Speichern …" : "Speichern"}</button>
            </div>
          </form>
        </div>,
        document.body,
      )}

    </section>
  );
}

export default ClubPeopleManager;
