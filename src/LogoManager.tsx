import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import type { UserProfile } from "./permissions";
import {
  deactivateClubLogo,
  normalizeClubLogoName,
  permanentlyDeleteClubLogo,
  saveClubLogo,
  subscribeClubLogos,
} from "./clubLogoFirestore";
import { clubLogoFileToDataUrl, validateClubLogoImage } from "./clubLogoImage";
import { subscribeKfvClubs } from "./kfvFirestore";
import type { ClubLogoEntry } from "./clubLogoTypes";
import type { KfvClub } from "./kfvTypes";
import "./LogoManager.css";

type LogoManagerProps = {
  user: User;
  profile: UserProfile;
  onBack: () => void;
};

type FormState = {
  originalId: string;
  originalLogoUrl: string;
  originalSource: ClubLogoEntry["source"];
  clubName: string;
  aliasesText: string;
  logoUrl: string;
};

type LogoFilter = "all" | "missing" | "managed";

type LogoListItem = {
  key: string;
  clubName: string;
  aliases: string[];
  logoUrl: string;
  sourceLabel: string;
  managedEntry: ClubLogoEntry | null;
  officialClub: KfvClub | null;
};

const EMPTY_FORM: FormState = {
  originalId: "",
  originalLogoUrl: "",
  originalSource: "manual-url",
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

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();
    const key = cleaned.toLocaleLowerCase("de-AT");
    if (!cleaned || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function managedSourceLabel(source: ClubLogoEntry["source"]) {
  if (source === "manual-upload") return "Eigenes Bild";
  if (source === "imported") return "Import";
  return "Eigene Logo-URL";
}

function officialSourceLabel(club: KfvClub | null) {
  if (!club?.logoUrl) return "Logo fehlt";
  if (club.logoSource === "manual-kfv-official-override") return "Feste Zuordnung";
  return "ÖFB/KFV-Logo";
}

function LogoManager({ user, profile, onBack }: LogoManagerProps) {
  const [managedEntries, setManagedEntries] = useState<ClubLogoEntry[]>([]);
  const [officialClubs, setOfficialClubs] = useState<KfvClub[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LogoFilter>("all");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [managedLoading, setManagedLoading] = useState(true);
  const [clubsLoading, setClubsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () =>
      subscribeClubLogos(
        (items) => {
          setManagedEntries(items);
          setManagedLoading(false);
        },
        (text) => {
          setError(text);
          setManagedLoading(false);
        },
      ),
    [],
  );

  useEffect(
    () =>
      subscribeKfvClubs(
        (clubs) => {
          // subscribeKfvClubs enthält bereits Logo-Manager-Einträge. Für die
          // Verwaltungsübersicht brauchen wir hier nur die offiziellen Vereine.
          setOfficialClubs(
            clubs.filter((club) => club.logoSource !== "manual-logo-manager"),
          );
          setClubsLoading(false);
        },
        (text) => {
          setError(text);
          setClubsLoading(false);
        },
      ),
    [],
  );

  useEffect(() => {
    if (!selectedFile) {
      setFilePreviewUrl("");
      return;
    }

    const previewUrl = URL.createObjectURL(selectedFile);
    setFilePreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedFile]);

  const listItems = useMemo<LogoListItem[]>(() => {
    const byName = new Map<string, LogoListItem>();

    for (const club of officialClubs) {
      const normalized = normalizeClubLogoName(club.name);
      if (!normalized) continue;
      const current = byName.get(normalized);
      const candidate: LogoListItem = {
        key: `official:${club.id}`,
        clubName: club.name,
        aliases: uniqueStrings(club.aliases || []),
        logoUrl: club.logoUrl || "",
        sourceLabel: officialSourceLabel(club),
        managedEntry: null,
        officialClub: club,
      };

      // Dubletten aus kfvClubs auf die qualitativ bessere Logo-Zeile reduzieren.
      if (!current || (!current.logoUrl && candidate.logoUrl)) {
        byName.set(normalized, candidate);
      }
    }

    for (const entry of managedEntries) {
      const normalized = normalizeClubLogoName(entry.clubName);
      if (!normalized) continue;
      const official = byName.get(normalized)?.officialClub || null;
      byName.set(normalized, {
        key: `managed:${entry.id}`,
        clubName: entry.clubName,
        aliases: uniqueStrings([
          ...entry.aliases,
          ...(official?.aliases || []),
          ...(official && official.name !== entry.clubName ? [official.name] : []),
        ]),
        logoUrl: entry.logoUrl || official?.logoUrl || "",
        sourceLabel: managedSourceLabel(entry.source),
        managedEntry: entry,
        officialClub: official,
      });
    }

    return [...byName.values()].sort((a, b) =>
      a.clubName.localeCompare(b.clubName, "de-AT"),
    );
  }, [managedEntries, officialClubs]);

  const filteredEntries = useMemo(() => {
    const needle = search.toLocaleLowerCase("de-AT").trim();
    return listItems.filter((item) => {
      if (filter === "missing" && item.logoUrl) return false;
      if (filter === "managed" && !item.managedEntry) return false;
      if (!needle) return true;
      return [item.clubName, ...item.aliases]
        .join(" ")
        .toLocaleLowerCase("de-AT")
        .includes(needle);
    });
  }, [filter, listItems, search]);

  const counts = useMemo(
    () => ({
      all: listItems.length,
      missing: listItems.filter((item) => !item.logoUrl).length,
      managed: listItems.filter((item) => item.managedEntry).length,
    }),
    [listItems],
  );

  const previewUrl = filePreviewUrl || form.logoUrl;
  const loading = managedLoading || clubsLoading;

  function resetEditor() {
    setSelectedFile(null);
    setForm(EMPTY_FORM);
    setEditorOpen(false);
  }

  function startCreate() {
    setSelectedFile(null);
    setForm(EMPTY_FORM);
    setMessage("");
    setError("");
    setEditorOpen(true);
  }

  function startEdit(item: LogoListItem) {
    const entry = item.managedEntry;
    setSelectedFile(null);
    setForm({
      originalId: entry?.id || "",
      originalLogoUrl: entry?.logoUrl || "",
      originalSource: entry?.source || "manual-url",
      clubName: entry?.clubName || item.clubName,
      aliasesText: uniqueStrings([
        ...(entry?.aliases || []),
        ...(item.officialClub?.aliases || []),
      ]).join("\n"),
      // Ein offizielles Logo wird nur als Vorschlag angezeigt. Erst nach dem
      // Speichern wird daraus eine verwaltete Logo-Zuordnung.
      logoUrl: entry?.logoUrl || item.officialClub?.logoUrl || "",
    });
    setMessage("");
    setError("");
    setEditorOpen(true);
  }

  function handleFileSelection(file: File | null) {
    setError("");
    if (!file) {
      setSelectedFile(null);
      return;
    }

    try {
      validateClubLogoImage(file);
      setSelectedFile(file);
    } catch (validationError) {
      setSelectedFile(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Die Bilddatei ist ungültig.",
      );
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clubName = form.clubName.replace(/\s+/g, " ").trim();
    let logoUrl = form.logoUrl.trim();

    if (!clubName) {
      setError("Bitte einen Vereinsnamen eingeben.");
      return;
    }

    if (!selectedFile && !logoUrl) {
      setError("Bitte ein Logo auswählen oder eine Logo-URL eintragen.");
      return;
    }

    if (!selectedFile && logoUrl && !logoUrl.startsWith("data:image/")) {
      try {
        new URL(logoUrl);
      } catch {
        setError("Die Logo-URL ist ungültig.");
        return;
      }
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      if (selectedFile) {
        logoUrl = await clubLogoFileToDataUrl(selectedFile);
      }

      const newId = await saveClubLogo({
        clubName,
        aliases: parseAliases(form.aliasesText),
        logoUrl,
        storagePath: "",
        source: selectedFile
          ? "manual-upload"
          : logoUrl === form.originalLogoUrl
            ? form.originalSource
            : "manual-url",
        active: true,
        updatedByUid: user.uid,
        updatedByName: profile.name || user.displayName || user.email || "",
      });

      if (form.originalId && form.originalId !== newId) {
        await deactivateClubLogo(form.originalId);
      }

      setMessage(
        selectedFile
          ? "Logo verarbeitet und in Firestore gespeichert. Es wird jetzt überall verwendet."
          : "Logo-Zuordnung gespeichert. Sie wird jetzt überall verwendet.",
      );
      resetEditor();
    } catch (saveError) {
      console.error("Logo-Zuordnung konnte nicht gespeichert werden:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Die Logo-Zuordnung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(entry: ClubLogoEntry) {
    if (!window.confirm(`Eigene Logo-Zuordnung für „${entry.clubName}“ deaktivieren? Danach wird wieder das ÖFB/KFV-Logo verwendet.`)) return;
    try {
      await deactivateClubLogo(entry.id);
      setMessage("Eigene Logo-Zuordnung deaktiviert.");
    } catch (deactivateError) {
      console.error(deactivateError);
      setError("Die Logo-Zuordnung konnte nicht deaktiviert werden.");
    }
  }

  async function handleDelete(entry: ClubLogoEntry) {
    if (!window.confirm(`Eigene Logo-Zuordnung für „${entry.clubName}“ endgültig löschen?`)) return;
    try {
      await permanentlyDeleteClubLogo(entry.id);
      setMessage("Eigene Logo-Zuordnung wurde gelöscht.");
    } catch (deleteError) {
      console.error(deleteError);
      setError("Die Logo-Zuordnung konnte nicht vollständig gelöscht werden.");
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
        <div className="logo-manager-filters" aria-label="Logo-Filter">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Alle <span>{counts.all}</span></button>
          <button type="button" className={filter === "missing" ? "active" : ""} onClick={() => setFilter("missing")}>Fehlend <span>{counts.missing}</span></button>
          <button type="button" className={filter === "managed" ? "active" : ""} onClick={() => setFilter("managed")}>Eigene <span>{counts.managed}</span></button>
        </div>
      </div>

      {message && <div className="logo-manager-message success">{message}</div>}
      {error && <div className="logo-manager-message error">{error}</div>}

      {loading ? (
        <div className="logo-manager-empty">Vereine und Logos werden geladen …</div>
      ) : filteredEntries.length === 0 ? (
        <div className="logo-manager-empty">
          <strong>{listItems.length === 0 ? "Keine Vereine gefunden" : "Keine passenden Vereine"}</strong>
          {listItems.length === 0 && <button type="button" onClick={startCreate}>Verein anlegen</button>}
        </div>
      ) : (
        <div className="logo-manager-list">
          {filteredEntries.map((item) => (
            <article className={`logo-manager-card ${item.logoUrl ? "has-logo" : "missing-logo"}`} key={item.key}>
              <div className="logo-manager-preview">
                {item.logoUrl ? <img src={item.logoUrl} alt={`${item.clubName} Logo`} /> : <span>?</span>}
              </div>
              <div className="logo-manager-info">
                <strong>{item.clubName}</strong>
                <span>{item.sourceLabel}</span>
                {item.aliases.length > 0 && <small>{item.aliases.slice(0, 4).join(" · ")}</small>}
              </div>
              <div className="logo-manager-actions">
                <button type="button" onClick={() => startEdit(item)}>{item.managedEntry ? "Bearbeiten" : item.logoUrl ? "Übernehmen/Ersetzen" : "Logo hinzufügen"}</button>
                {item.managedEntry && (
                  <>
                    <button type="button" className="danger" onClick={() => handleDeactivate(item.managedEntry!)}>Ausblenden</button>
                    <button type="button" className="danger subtle" onClick={() => handleDelete(item.managedEntry!)}>Löschen</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {editorOpen && (
        <div className="logo-manager-modal" onClick={() => !saving && resetEditor()}>
          <form className="logo-manager-editor" onSubmit={handleSave} onClick={(event) => event.stopPropagation()}>
            <div className="logo-manager-editor-head">
              <h3>{form.originalId ? "Logo bearbeiten" : "Logo zuordnen"}</h3>
              <button type="button" disabled={saving} onClick={resetEditor} aria-label="Schließen">×</button>
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

            <div className="logo-manager-file-field">
              <span>Logo auswählen</span>
              <label className="logo-manager-file-button">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => handleFileSelection(event.target.files?.[0] || null)}
                />
                {selectedFile ? "Andere Datei wählen" : form.logoUrl ? "Logo ersetzen" : "Logo auswählen"}
              </label>
              {selectedFile && (
                <div className="logo-manager-file-info">
                  <strong>{selectedFile.name}</strong>
                  <span>{Math.max(selectedFile.size / 1024, 1).toFixed(0)} KB</span>
                  <button type="button" onClick={() => setSelectedFile(null)}>Entfernen</button>
                </div>
              )}
              <small>PNG, JPG oder WebP · automatische Verkleinerung auf 256 × 256 Pixel · maximal 4 MB</small>
            </div>

            <div className="logo-manager-divider"><span>oder</span></div>

            <label>
              Direkte Logo-URL (optional)
              <input
                type="url"
                value={form.logoUrl}
                onChange={(event) => {
                  setSelectedFile(null);
                  setForm((current) => ({ ...current, logoUrl: event.target.value }));
                }}
                placeholder="https://…/logo.png"
              />
            </label>

            <div className="logo-manager-large-preview">
              {previewUrl ? <img src={previewUrl} alt="Logo-Vorschau" /> : <span>Logo-Vorschau</span>}
            </div>

            <div className="logo-manager-editor-actions">
              <button type="button" className="secondary" disabled={saving} onClick={resetEditor}>Abbrechen</button>
              <button type="submit" disabled={saving}>{saving ? "Bild wird verarbeitet …" : "Speichern"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export default LogoManager;
