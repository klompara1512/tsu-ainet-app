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
import "./KitManager.css";

type KitSet = {
  id: string;
  name: string;
  team: string;
  jerseyColor: string;
  shortsColor: string;
  socksColor: string;
  accentColor: string;
  shirts: number;
  shorts: number;
  socks: number;
  tubes: number;
  notes: string;
  active: boolean;
  order: number;
};

type FormState = Omit<KitSet, "order">;

type Props = { onBack: () => void };

const TEAM_OPTIONS = [
  "Kampfmannschaft",
  "Challenge",
  "U17",
  "U12",
  "U10",
  "U8",
  "Torhüter",
  "Vereinsweit",
];

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  team: "Kampfmannschaft",
  jerseyColor: "#1769d2",
  shortsColor: "#1769d2",
  socksColor: "#1769d2",
  accentColor: "#ffffff",
  shirts: 0,
  shorts: 0,
  socks: 0,
  tubes: 0,
  notes: "",
  active: true,
};

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function sanitizeCount(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}



function KitPreview({
  jerseyColor,
  shortsColor,
  socksColor,
  accentColor,
  compact = false,
}: {
  jerseyColor: string;
  shortsColor: string;
  socksColor: string;
  accentColor: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`kit-visual ${compact ? "compact" : ""}`}
      style={{
        "--kit-jersey": jerseyColor,
        "--kit-shorts": shortsColor,
        "--kit-socks": socksColor,
        "--kit-accent": accentColor,
      } as React.CSSProperties}
      aria-label="Mustertrikot Vorschau"
    >
      <div className="kit-visual-shirt">
        <span className="kit-visual-collar" />
        <span className="kit-visual-badge">TSU</span>
        <span className="kit-visual-stripe" />
      </div>
      <div className="kit-visual-shorts">
        <span className="kit-visual-shorts-trim" />
      </div>
      <div className="kit-visual-socks">
        <span /><span />
      </div>
    </div>
  );
}

const COLOR_PRESETS = [
  "#1769d2", "#7139b8", "#f2c62e", "#c51e2a", "#e87516",
  "#159447", "#111827", "#ffffff", "#7b8798",
];

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="kit-color-field">
      <div className="kit-color-field-head">
        <span>{label}</span>
        <label className="kit-color-custom" title={`${label} frei wählen`}>
          <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
          <b style={{ background: value }} />
          <small>{value.toUpperCase()}</small>
        </label>
      </div>
      <div className="kit-color-swatches">
        {COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            className={value.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ background: color }}
            onClick={() => onChange(color)}
            aria-label={`${label}: ${color}`}
          />
        ))}
      </div>
    </div>
  );
}

function KitManager({ onBack }: Props) {
  const [sets, setSets] = useState<KitSet[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("Alle");

  useEffect(() => {
    return onSnapshot(
      collection(db, "settings", "kitInventory", "sets"),
      (snapshot) => {
        const rows = snapshot.docs.map((entry, index) => {
          const data = entry.data();
          return {
            id: entry.id,
            name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Trikotsatz",
            team: typeof data.team === "string" && data.team.trim() ? data.team.trim() : "Vereinsweit",
            jerseyColor: typeof data.jerseyColor === "string" ? data.jerseyColor : "#1769d2",
            shortsColor: typeof data.shortsColor === "string" ? data.shortsColor : "#1769d2",
            socksColor: typeof data.socksColor === "string" ? data.socksColor : "#1769d2",
            accentColor: typeof data.accentColor === "string" ? data.accentColor : "#ffffff",
            shirts: numberValue(data.shirts),
            shorts: numberValue(data.shorts),
            socks: numberValue(data.socks),
            tubes: numberValue(data.tubes),
            notes: typeof data.notes === "string" ? data.notes : "",
            active: data.active !== false,
            order: typeof data.order === "number" ? data.order : index,
          } satisfies KitSet;
        });
        setSets(rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de-AT")));
        setLoading(false);
      },
      (snapshotError) => {
        console.error(snapshotError);
        setError("Die Trikotsätze konnten nicht geladen werden.");
        setLoading(false);
      },
    );
  }, []);


  useEffect(() => {
    if (!editorOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [editorOpen]);

  const visibleSets = useMemo(
    () => filter === "Alle" ? sets : sets.filter((set) => set.team === filter),
    [filter, sets],
  );

  const totals = useMemo(() => sets.reduce(
    (sum, set) => ({
      shirts: sum.shirts + set.shirts,
      shorts: sum.shorts + set.shorts,
      socks: sum.socks + set.socks,
      tubes: sum.tubes + set.tubes,
    }),
    { shirts: 0, shorts: 0, socks: 0, tubes: 0 },
  ), [sets]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  function openEdit(set: KitSet) {
    setForm({
      id: set.id,
      name: set.name,
      team: set.team,
      jerseyColor: set.jerseyColor,
      shortsColor: set.shortsColor,
      socksColor: set.socksColor,
      accentColor: set.accentColor,
      shirts: set.shirts,
      shorts: set.shorts,
      socks: set.socks,
      tubes: set.tubes,
      notes: set.notes,
      active: set.active,
    });
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditorOpen(false);
    setForm(EMPTY_FORM);
  }


  async function saveSet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.replace(/\s+/g, " ").trim();
    if (!name) {
      setError("Bitte eine Bezeichnung für den Trikotsatz eingeben.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name,
        team: form.team,
        jerseyColor: form.jerseyColor,
        shortsColor: form.shortsColor,
        socksColor: form.socksColor,
        accentColor: form.accentColor,
        shirts: numberValue(form.shirts),
        shorts: numberValue(form.shorts),
        socks: numberValue(form.socks),
        tubes: numberValue(form.tubes),
        notes: form.notes.trim(),
        active: form.active,
        updatedAt: serverTimestamp(),
      };

      if (form.id) {
        await updateDoc(doc(db, "settings", "kitInventory", "sets", form.id), payload);
        setMessage("Trikotsatz aktualisiert.");
      } else {
        await addDoc(collection(db, "settings", "kitInventory", "sets"), {
          ...payload,
          order: sets.length,
          createdAt: serverTimestamp(),
        });
        setMessage("Trikotsatz angelegt.");
      }
      closeEditor();
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : "Der Trikotsatz konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSet(set: KitSet) {
    if (!window.confirm(`Trikotsatz „${set.name}“ endgültig löschen?`)) return;
    try {
      await deleteDoc(doc(db, "settings", "kitInventory", "sets", set.id));
      setMessage("Trikotsatz gelöscht.");
    } catch (deleteError) {
      console.error(deleteError);
      setError("Der Trikotsatz konnte nicht gelöscht werden.");
    }
  }

  return (
    <section className="kit-manager-page">
      <header className="kit-manager-header">
        <button type="button" className="kit-manager-back" onClick={onBack}>‹</button>
        <div>
          <span>Sektionsleitung</span>
          <h2>Trikotsatz-Verwaltung</h2>
        </div>
        <button type="button" className="kit-manager-add" onClick={openCreate}>+ Trikotsatz</button>
      </header>

      <div className="kit-manager-summary">
        <article><span>Sätze</span><strong>{sets.length}</strong></article>
        <article><span>Oberteile</span><strong>{totals.shirts}</strong></article>
        <article><span>Hosen</span><strong>{totals.shorts}</strong></article>
        <article><span>Stutzen</span><strong>{totals.socks}</strong></article>
        <article><span>Tubes</span><strong>{totals.tubes}</strong></article>
      </div>

      <div className="kit-manager-toolbar">
        <label>
          <span>Mannschaft</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option>Alle</option>
            {TEAM_OPTIONS.map((team) => <option key={team}>{team}</option>)}
          </select>
        </label>
      </div>

      {message && <div className="kit-manager-message success">{message}</div>}
      {error && <div className="kit-manager-message error">{error}</div>}

      {loading ? (
        <div className="kit-manager-empty">Trikotsätze werden geladen …</div>
      ) : visibleSets.length === 0 ? (
        <div className="kit-manager-empty">
          <div className="kit-manager-empty-icon">👕</div>
          <strong>Noch kein Trikotsatz erfasst</strong>
          <p>Lege den ersten Satz mit Farben und aktuellem Bestand an.</p>
          <button type="button" onClick={openCreate}>Ersten Trikotsatz anlegen</button>
        </div>
      ) : (
        <div className="kit-manager-grid">
          {visibleSets.map((set) => {
            const minStock = Math.min(set.shirts, set.shorts, set.socks, set.tubes);
            return (
              <article key={set.id} className={`kit-manager-card ${set.active ? "" : "inactive"}`}>
                <div className="kit-manager-photo kit-manager-generated-preview">
                  <KitPreview
                    jerseyColor={set.jerseyColor}
                    shortsColor={set.shortsColor}
                    socksColor={set.socksColor}
                    accentColor={set.accentColor}
                  />
                  {!set.active && <b>Außer Verwendung</b>}
                </div>
                <div className="kit-manager-card-body">
                  <div className="kit-manager-title">
                    <div><small>{set.team}</small><h3>{set.name}</h3></div>
                    <span className={minStock === 0 ? "warning" : "ok"}>Minimum {minStock}</span>
                  </div>
                  <div className="kit-manager-counts">
                    <div><span>Oberteile</span><strong>{set.shirts}</strong></div>
                    <div><span>Hosen</span><strong>{set.shorts}</strong></div>
                    <div><span>Stutzen</span><strong>{set.socks}</strong></div>
                    <div><span>Tubes</span><strong>{set.tubes}</strong></div>
                  </div>
                  {set.notes && <p className="kit-manager-notes">{set.notes}</p>}
                  <div className="kit-manager-actions">
                    <button type="button" onClick={() => openEdit(set)}>Bearbeiten</button>
                    <button type="button" className="danger" onClick={() => removeSet(set)}>Löschen</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editorOpen && createPortal(
        <div className="kit-manager-modal" role="dialog" aria-modal="true" aria-label={form.id ? "Trikotsatz bearbeiten" : "Trikotsatz anlegen"}>
          <form className="kit-manager-editor" onSubmit={saveSet}>
            <div className="kit-manager-editor-head">
              <div><span>Trikot & Bestand</span><h3>{form.id ? "Trikotsatz bearbeiten" : "Neuen Trikotsatz anlegen"}</h3></div>
              <button type="button" onClick={closeEditor} aria-label="Fenster schließen">×</button>
            </div>

            <div className="kit-manager-editor-scroll">
              <label className="kit-manager-field wide"><span>Bezeichnung</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="z. B. KM Heimtrikot Rot 2026/27" autoFocus /></label>
              <label className="kit-manager-field wide"><span>Mannschaft</span><select value={form.team} onChange={(event) => setForm((current) => ({ ...current, team: event.target.value }))}>{TEAM_OPTIONS.map((team) => <option key={team}>{team}</option>)}</select></label>

              <div className="kit-kit-designer wide">
                <div className="kit-designer-preview-panel">
                  <span className="kit-designer-label">Mustertrikot</span>
                  <KitPreview
                    jerseyColor={form.jerseyColor}
                    shortsColor={form.shortsColor}
                    socksColor={form.socksColor}
                    accentColor={form.accentColor}
                  />
                  <small>Die Vorschau aktualisiert sich sofort.</small>
                </div>
                <div className="kit-designer-colors">
                  <ColorPicker label="Trikot" value={form.jerseyColor} onChange={(value) => setForm((current) => ({ ...current, jerseyColor: value }))} />
                  <ColorPicker label="Hose" value={form.shortsColor} onChange={(value) => setForm((current) => ({ ...current, shortsColor: value }))} />
                  <ColorPicker label="Stutzen" value={form.socksColor} onChange={(value) => setForm((current) => ({ ...current, socksColor: value }))} />
                  <ColorPicker label="Akzent / Kragen" value={form.accentColor} onChange={(value) => setForm((current) => ({ ...current, accentColor: value }))} />
                </div>
              </div>

              <div className="kit-manager-stock-grid wide">
                <label className="kit-manager-field"><span>Oberteile</span><input type="number" min="0" inputMode="numeric" value={form.shirts} onChange={(event) => setForm((current) => ({ ...current, shirts: sanitizeCount(event.target.value) }))} /></label>
                <label className="kit-manager-field"><span>Hosen</span><input type="number" min="0" inputMode="numeric" value={form.shorts} onChange={(event) => setForm((current) => ({ ...current, shorts: sanitizeCount(event.target.value) }))} /></label>
                <label className="kit-manager-field"><span>Stutzen</span><input type="number" min="0" inputMode="numeric" value={form.socks} onChange={(event) => setForm((current) => ({ ...current, socks: sanitizeCount(event.target.value) }))} /></label>
                <label className="kit-manager-field"><span>Tubes</span><input type="number" min="0" inputMode="numeric" value={form.tubes} onChange={(event) => setForm((current) => ({ ...current, tubes: sanitizeCount(event.target.value) }))} /></label>
              </div>

              <label className="kit-manager-field wide"><span>Notiz (optional)</span><textarea rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="z. B. zwei Oberteile müssen nachbestellt werden" /></label>
              <label className="kit-manager-active wide"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /><span><strong>Aktiver Trikotsatz</strong><small>Der Satz ist aktuell in Verwendung.</small></span></label>
            </div>

            <div className="kit-manager-editor-actions">
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

export default KitManager;
