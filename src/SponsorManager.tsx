import { useEffect, useMemo, useState } from "react";
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
import "./SponsorManager.css";

type Sponsor = {
  id: string;
  name: string;
  logoUrl: string;
  website: string;
  active: boolean;
  order: number;
};

type Props = { onBack: () => void };

type FormState = {
  id: string;
  name: string;
  logoUrl: string;
  website: string;
  active: boolean;
};

const EMPTY_FORM: FormState = { id: "", name: "", logoUrl: "", website: "", active: true };

function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  new URL(withProtocol);
  return withProtocol;
}

function SponsorManager({ onBack }: Props) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    return onSnapshot(
      collection(db, "sponsors"),
      (snapshot) => {
        const rows = snapshot.docs.map((item, index) => {
          const data = item.data();
          return {
            id: item.id,
            name: typeof data.name === "string" ? data.name.trim() : "Sponsor",
            logoUrl: typeof data.logoUrl === "string" ? data.logoUrl.trim() : "",
            website: typeof data.website === "string" ? data.website.trim() : typeof data.url === "string" ? data.url.trim() : "",
            active: data.active !== false,
            order: typeof data.order === "number" ? data.order : index,
          } satisfies Sponsor;
        });
        setSponsors(rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de")));
        setLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Die Sponsoren konnten nicht geladen werden.");
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreview(form.logoUrl);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile, form.logoUrl]);

  const filtered = useMemo(() => {
    const needle = search.toLocaleLowerCase("de-AT").trim();
    return needle ? sponsors.filter((sponsor) => sponsor.name.toLocaleLowerCase("de-AT").includes(needle)) : sponsors;
  }, [sponsors, search]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setSelectedFile(null);
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  function openEdit(sponsor: Sponsor) {
    setForm({ id: sponsor.id, name: sponsor.name, logoUrl: sponsor.logoUrl, website: sponsor.website, active: sponsor.active });
    setSelectedFile(null);
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditorOpen(false);
    setSelectedFile(null);
    setForm(EMPTY_FORM);
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

  async function saveSponsor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.replace(/\s+/g, " ").trim();
    if (!name) {
      setError("Bitte einen Sponsornamen eingeben.");
      return;
    }
    if (!selectedFile && !form.logoUrl.trim()) {
      setError("Bitte ein Logo auswählen oder eine Logo-URL eintragen.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      let logoUrl = form.logoUrl.trim();
      if (selectedFile) logoUrl = await clubLogoFileToDataUrl(selectedFile);
      let website = "";
      try {
        website = normalizeWebsite(form.website);
      } catch {
        throw new Error("Die Website-Adresse ist ungültig.");
      }

      const payload = {
        name,
        logoUrl,
        website,
        url: website,
        active: form.active,
        updatedAt: serverTimestamp(),
      };

      if (form.id) {
        await updateDoc(doc(db, "sponsors", form.id), payload);
      } else {
        await addDoc(collection(db, "sponsors"), {
          ...payload,
          order: sponsors.length,
          createdAt: serverTimestamp(),
        });
      }
      setMessage(form.id ? "Sponsor aktualisiert." : "Sponsor hinzugefügt.");
      closeEditor();
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : "Der Sponsor konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSponsor(sponsor: Sponsor) {
    if (!window.confirm(`Sponsor „${sponsor.name}“ endgültig löschen?`)) return;
    try {
      await deleteDoc(doc(db, "sponsors", sponsor.id));
      setMessage("Sponsor gelöscht.");
    } catch (deleteError) {
      console.error(deleteError);
      setError("Der Sponsor konnte nicht gelöscht werden.");
    }
  }

  async function moveSponsor(sponsor: Sponsor, direction: -1 | 1) {
    const currentIndex = sponsors.findIndex((item) => item.id === sponsor.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sponsors.length) return;
    const target = sponsors[targetIndex];
    try {
      await Promise.all([
        updateDoc(doc(db, "sponsors", sponsor.id), { order: target.order, updatedAt: serverTimestamp() }),
        updateDoc(doc(db, "sponsors", target.id), { order: sponsor.order, updatedAt: serverTimestamp() }),
      ]);
    } catch (moveError) {
      console.error(moveError);
      setError("Die Reihenfolge konnte nicht geändert werden.");
    }
  }

  return (
    <section className="sponsor-manager-page">
      <header className="sponsor-manager-header">
        <button type="button" className="sponsor-manager-back" onClick={onBack}>‹</button>
        <h2>Sponsor Manager</h2>
        <button type="button" className="sponsor-manager-add" onClick={openCreate}>+ Sponsor</button>
      </header>

      <div className="sponsor-manager-tools">
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sponsor suchen" />
      </div>

      {message && <div className="sponsor-manager-message success">{message}</div>}
      {error && <div className="sponsor-manager-message error">{error}</div>}

      {loading ? <div className="sponsor-manager-empty">Sponsoren werden geladen …</div> : filtered.length === 0 ? (
        <div className="sponsor-manager-empty"><strong>Noch keine Sponsoren</strong><button type="button" onClick={openCreate}>Ersten Sponsor anlegen</button></div>
      ) : (
        <div className="sponsor-manager-list">
          {filtered.map((sponsor, index) => (
            <article className={`sponsor-manager-card ${sponsor.active ? "" : "inactive"}`} key={sponsor.id}>
              <div className="sponsor-manager-logo">{sponsor.logoUrl ? <img src={sponsor.logoUrl} alt={`${sponsor.name} Logo`} /> : <span>?</span>}</div>
              <div className="sponsor-manager-info"><strong>{sponsor.name}</strong>{sponsor.website && <small>{sponsor.website}</small>}{!sponsor.active && <span>Ausgeblendet</span>}</div>
              <div className="sponsor-manager-actions">
                <button type="button" aria-label="Nach oben" disabled={index === 0} onClick={() => moveSponsor(sponsor, -1)}>↑</button>
                <button type="button" aria-label="Nach unten" disabled={index === filtered.length - 1} onClick={() => moveSponsor(sponsor, 1)}>↓</button>
                <button type="button" onClick={() => openEdit(sponsor)}>Bearbeiten</button>
                <button type="button" className="danger" onClick={() => removeSponsor(sponsor)}>Löschen</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editorOpen && (
        <div className="sponsor-manager-modal" onClick={closeEditor}>
          <form className="sponsor-manager-editor" onSubmit={saveSponsor} onClick={(event) => event.stopPropagation()}>
            <div className="sponsor-manager-editor-head"><h3>{form.id ? "Sponsor bearbeiten" : "Sponsor hinzufügen"}</h3><button type="button" onClick={closeEditor}>×</button></div>
            <label>Sponsorname<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus /></label>
            <div className="sponsor-manager-file-field"><span>Logo</span><label className="sponsor-manager-file-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectFile(event.target.files?.[0] || null)} />{selectedFile ? "Andere Datei wählen" : form.logoUrl ? "Logo ersetzen" : "Logo auswählen"}</label><small>PNG, JPG oder WebP · wird automatisch verkleinert</small></div>
            <div className="sponsor-manager-divider"><span>oder</span></div>
            <label>Logo-URL<input type="url" value={form.logoUrl} onChange={(event) => { setSelectedFile(null); setForm((current) => ({ ...current, logoUrl: event.target.value })); }} placeholder="https://…/logo.png" /></label>
            <label>Website<input value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} placeholder="www.sponsor.at" /></label>
            <label className="sponsor-manager-active"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />In der App anzeigen</label>
            <div className="sponsor-manager-preview">{preview ? <img src={preview} alt="Sponsorlogo-Vorschau" /> : <span>Logo-Vorschau</span>}</div>
            <div className="sponsor-manager-editor-actions"><button type="button" className="secondary" onClick={closeEditor}>Abbrechen</button><button type="submit" disabled={saving}>{saving ? "Speichern …" : "Speichern"}</button></div>
          </form>
        </div>
      )}
    </section>
  );
}

export default SponsorManager;
