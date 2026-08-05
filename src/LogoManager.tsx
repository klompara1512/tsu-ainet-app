import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import type { UserProfile } from "./permissions";
import {
  deactivateClubLogo,
  permanentlyDeleteClubLogo,
  saveClubLogo,
  subscribeClubLogos,
} from "./clubLogoFirestore";
import type { ClubLogoEntry } from "./clubLogoTypes";
import "./LogoManager.css";

type LogoManagerProps = {
  user: User;
  profile: UserProfile;
  onBack: () => void;
};

type FormState = {
  originalId: string;
  clubName: string;
  aliasesText: string;
  logoUrl: string;
};

const EMPTY_FORM: FormState = {
  originalId: "",
  clubName: "",
  aliasesText: "",
  logoUrl: "",
};

function parseAliases(value: string) {
  return value
    .split(/\n|,/)
    .map((alias) => alias.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function sourceLabel(source: ClubLogoEntry["source"]) {
  if (source === "manual-upload") return "Upload";
  if (source === "imported") return "Import";
  return "Logo-URL";
}

function LogoManager({ user, profile, onBack }: LogoManagerProps) {
  const [entries, setEntries] = useState<ClubLogoEntry[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () =>
      subscribeClubLogos(
        (items) => {
          setEntries(items);
          setLoading(false);
          setError("");
        },
        (text) => {
          setError(text);
          setLoading(false);
        },
      ),
    [],
  );

  const filteredEntries = useMemo(() => {
    const needle = search.toLocaleLowerCase("de-AT").trim();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.clubName, ...entry.aliases]
        .join(" ")
        .toLocaleLowerCase("de-AT")
        .includes(needle),
    );
  }, [entries, search]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setMessage("");
    setError("");
    setEditorOpen(true);
  }

  function startEdit(entry: ClubLogoEntry) {
    setForm({
      originalId: entry.id,
      clubName: entry.clubName,
      aliasesText: entry.aliases.join("\n"),
      logoUrl: entry.logoUrl,
    });
    setMessage("");
    setError("");
    setEditorOpen(true);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clubName = form.clubName.replace(/\s+/g, " ").trim();
    const logoUrl = form.logoUrl.trim();

    if (!clubName) {
      setError("Bitte einen Vereinsnamen eingeben.");
      return;
    }

    if (!logoUrl) {
      setError("Bitte eine Logo-URL eintragen. Der Bild-Upload folgt in Phase 3.");
      return;
    }

    try {
      new URL(logoUrl);
    } catch {
      setError("Die Logo-URL ist ungültig.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const newId = await saveClubLogo({
        clubName,
        aliases: parseAliases(form.aliasesText),
        logoUrl,
        source: "manual-url",
        active: true,
        updatedByUid: user.uid,
        updatedByName: profile.name || user.displayName || user.email || "",
      });

      if (form.originalId && form.originalId !== newId) {
        await deactivateClubLogo(form.originalId);
      }

      setMessage("Logo-Zuordnung gespeichert.");
      setEditorOpen(false);
      setForm(EMPTY_FORM);
    } catch (saveError) {
      console.error("Logo-Zuordnung konnte nicht gespeichert werden:", saveError);
      setError("Die Logo-Zuordnung konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(entry: ClubLogoEntry) {
    if (!window.confirm(`Logo-Zuordnung für „${entry.clubName}“ deaktivieren?`)) return;
    try {
      await deactivateClubLogo(entry.id);
      setMessage("Logo-Zuordnung deaktiviert.");
    } catch (deactivateError) {
      console.error(deactivateError);
      setError("Die Logo-Zuordnung konnte nicht deaktiviert werden.");
    }
  }

  async function handleDelete(entry: ClubLogoEntry) {
    if (!window.confirm(`Logo-Zuordnung für „${entry.clubName}“ endgültig löschen?`)) return;
    try {
      await permanentlyDeleteClubLogo(entry.id);
      setMessage("Logo-Zuordnung gelöscht.");
    } catch (deleteError) {
      console.error(deleteError);
      setError("Die Logo-Zuordnung konnte nicht gelöscht werden.");
    }
  }

  return (
    <section className="logo-manager-page">
      <header className="logo-manager-header">
        <button type="button" className="logo-manager-back" onClick={onBack}>‹</button>
        <h2>Logo Manager</h2>
        <button type="button" className="logo-manager-add" onClick={startCreate}>+ Verein</button>
      </header>

      <div className="logo-manager-tools">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Verein suchen"
          aria-label="Verein suchen"
        />
      </div>

      {message && <div className="logo-manager-message success">{message}</div>}
      {error && <div className="logo-manager-message error">{error}</div>}

      {loading ? (
        <div className="logo-manager-empty">Logos werden geladen …</div>
      ) : filteredEntries.length === 0 ? (
        <div className="logo-manager-empty">
          <strong>Noch keine Logo-Zuordnung</strong>
          <button type="button" onClick={startCreate}>Ersten Verein anlegen</button>
        </div>
      ) : (
        <div className="logo-manager-list">
          {filteredEntries.map((entry) => (
            <article className="logo-manager-card" key={entry.id}>
              <div className="logo-manager-preview">
                {entry.logoUrl ? <img src={entry.logoUrl} alt={`${entry.clubName} Logo`} /> : <span>?</span>}
              </div>
              <div className="logo-manager-info">
                <strong>{entry.clubName}</strong>
                <span>{sourceLabel(entry.source)}</span>
                {entry.aliases.length > 0 && <small>{entry.aliases.join(" · ")}</small>}
              </div>
              <div className="logo-manager-actions">
                <button type="button" onClick={() => startEdit(entry)}>Bearbeiten</button>
                <button type="button" className="danger" onClick={() => handleDeactivate(entry)}>Ausblenden</button>
                <button type="button" className="danger subtle" onClick={() => handleDelete(entry)}>Löschen</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editorOpen && (
        <div className="logo-manager-modal" onClick={() => !saving && setEditorOpen(false)}>
          <form className="logo-manager-editor" onSubmit={handleSave} onClick={(event) => event.stopPropagation()}>
            <div className="logo-manager-editor-head">
              <h3>{form.originalId ? "Logo bearbeiten" : "Verein hinzufügen"}</h3>
              <button type="button" onClick={() => setEditorOpen(false)} aria-label="Schließen">×</button>
            </div>

            <label>
              Vereinsname
              <input
                value={form.clubName}
                onChange={(event) => setForm((current) => ({ ...current, clubName: event.target.value }))}
                placeholder="z. B. SG Virgen/Prägraten U12 A"
                autoFocus
              />
            </label>

            <label>
              Alternative Namen
              <textarea
                value={form.aliasesText}
                onChange={(event) => setForm((current) => ({ ...current, aliasesText: event.target.value }))}
                placeholder={"Ein Name pro Zeile\nz. B. Virgen Prägraten U12"}
                rows={4}
              />
            </label>

            <label>
              Logo-URL
              <input
                type="url"
                value={form.logoUrl}
                onChange={(event) => setForm((current) => ({ ...current, logoUrl: event.target.value }))}
                placeholder="https://…/logo.png"
              />
            </label>

            <div className="logo-manager-upload-note">
              Der direkte Bild-Upload in Firebase Storage folgt in Phase 3. In Phase 2 kann das Logo über eine Bild-URL verwaltet werden.
            </div>

            <div className="logo-manager-large-preview">
              {form.logoUrl ? <img src={form.logoUrl} alt="Logo-Vorschau" /> : <span>Logo-Vorschau</span>}
            </div>

            <div className="logo-manager-editor-actions">
              <button type="button" className="secondary" onClick={() => setEditorOpen(false)}>Abbrechen</button>
              <button type="submit" disabled={saving}>{saving ? "Speichert …" : "Speichern"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export default LogoManager;
