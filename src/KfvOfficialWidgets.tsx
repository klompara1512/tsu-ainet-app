import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_KFV_WIDGETS,
  normalizeWidgetUrl,
  saveKfvOfficialSettings,
  subscribeKfvOfficialSettings,
  type KfvOfficialSettings,
  type KfvWidgetConfig,
} from "./kfvOfficial";

const TEAM_ORDER = ["Kampfmannschaft", "Challenge", "U17", "U12", "U10", "U8"];

function KfvOfficialWidgets() {
  const [settings, setSettings] = useState<KfvOfficialSettings>({
    widgets: DEFAULT_KFV_WIDGETS,
    refreshMinutes: 5,
  });
  const [selectedTeam, setSelectedTeam] = useState("Kampfmannschaft");
  const [mode, setMode] = useState<"live" | "setup">("live");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    return subscribeKfvOfficialSettings(
      (data) => {
        setSettings(data);
        setLoading(false);
      },
      (error) => {
        setMessage(`Einstellungen konnten nicht geladen werden: ${error}`);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    const interval = window.setInterval(
      () => setReloadKey((current) => current + 1),
      Math.max(1, settings.refreshMinutes) * 60_000,
    );
    return () => window.clearInterval(interval);
  }, [settings.refreshMinutes]);

  const teamWidgets = useMemo(
    () => settings.widgets.filter((widget) => widget.teamName === selectedTeam && widget.enabled),
    [settings.widgets, selectedTeam],
  );

  const configuredCount = settings.widgets.filter((widget) => widget.url.trim()).length;

  function updateWidget(id: string, patch: Partial<KfvWidgetConfig>) {
    setSettings((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        widget.id === id ? { ...widget, ...patch } : widget,
      ),
    }));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await saveKfvOfficialSettings({
        ...settings,
        widgets: settings.widgets.map((widget) => ({
          ...widget,
          url: normalizeWidgetUrl(widget.url),
        })),
      });
      setMessage("KFV-Live-Einstellungen wurden gespeichert.");
      setMode("live");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="kfv-empty">Offizielle KFV-Widgets werden geladen …</div>;
  }

  return (
    <div className="official-kfv-wrap">
      <div className="official-kfv-head">
        <div>
          <p className="kfv-eyebrow">Offizielle Live-Daten</p>
          <h3>ÖFB/KFV Vereinswidgets</h3>
          <p>
            Tabellen und Spielpläne werden direkt vom offiziellen Fußball-Online-System angezeigt
            und automatisch aktualisiert.
          </p>
        </div>
        <div className="official-kfv-actions">
          <span className={configuredCount > 0 ? "official-status ready" : "official-status"}>
            {configuredCount}/{settings.widgets.length} eingerichtet
          </span>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
            Aktualisieren
          </button>
          <button type="button" className="secondary" onClick={() => setMode(mode === "live" ? "setup" : "live")}>
            {mode === "live" ? "Einrichten" : "Zur Live-Ansicht"}
          </button>
        </div>
      </div>

      {message && <div className="kfv-message">{message}</div>}

      {mode === "setup" ? (
        <section className="official-setup">
          <div className="official-setup-info">
            <strong>Einmalige Einrichtung</strong>
            <p>
              Im ÖFB-Vereinswidget den gewünschten Spielplan oder die Tabelle erzeugen. Danach die
              Widget-URL oder den vollständigen iframe-Code hier einfügen. Die App liest die URL
              automatisch aus dem Code heraus.
            </p>
          </div>

          <label className="refresh-field">
            <span>Automatische Aktualisierung</span>
            <select
              value={settings.refreshMinutes}
              onChange={(event) => setSettings((current) => ({ ...current, refreshMinutes: Number(event.target.value) }))}
            >
              <option value={1}>jede Minute</option>
              <option value={3}>alle 3 Minuten</option>
              <option value={5}>alle 5 Minuten</option>
              <option value={10}>alle 10 Minuten</option>
              <option value={15}>alle 15 Minuten</option>
            </select>
          </label>

          <div className="official-config-list">
            {settings.widgets.map((widget) => (
              <article className="official-config-card" key={widget.id}>
                <div className="official-config-title">
                  <div>
                    <strong>{widget.teamName}</strong>
                    <span>{widget.kind === "table" ? "Tabelle" : "Spielplan"}</span>
                  </div>
                  <label className="switch-label">
                    <input
                      type="checkbox"
                      checked={widget.enabled}
                      onChange={(event) => updateWidget(widget.id, { enabled: event.target.checked })}
                    />
                    aktiv
                  </label>
                </div>
                <label>
                  <span>Titel</span>
                  <input
                    value={widget.title}
                    onChange={(event) => updateWidget(widget.id, { title: event.target.value })}
                  />
                </label>
                <label>
                  <span>Widget-URL oder iframe-Code</span>
                  <textarea
                    rows={3}
                    value={widget.url}
                    placeholder={'https://… oder <iframe src="https://…"></iframe>'}
                    onChange={(event) => updateWidget(widget.id, { url: event.target.value })}
                  />
                </label>
              </article>
            ))}
          </div>

          <button type="button" className="official-save" disabled={saving} onClick={save}>
            {saving ? "Wird gespeichert …" : "Einstellungen speichern"}
          </button>
        </section>
      ) : (
        <section>
          <div className="official-team-tabs">
            {TEAM_ORDER.map((team) => (
              <button
                type="button"
                key={team}
                className={selectedTeam === team ? "active" : ""}
                onClick={() => setSelectedTeam(team)}
              >
                {team}
              </button>
            ))}
          </div>

          {teamWidgets.every((widget) => !widget.url.trim()) ? (
            <div className="kfv-empty official-empty">
              <strong>Für {selectedTeam} ist noch kein offizielles Widget hinterlegt.</strong>
              <p>Öffne „Einrichten“ und füge die vom ÖFB bereitgestellte Widget-URL ein.</p>
              <button type="button" onClick={() => setMode("setup")}>Jetzt einrichten</button>
            </div>
          ) : (
            <div className="official-widget-grid">
              {teamWidgets.filter((widget) => widget.url.trim()).map((widget) => (
                <article className="official-widget-card" key={`${widget.id}-${reloadKey}`}>
                  <header>
                    <div>
                      <p>{widget.teamName}</p>
                      <h4>{widget.title}</h4>
                    </div>
                    <span>LIVE</span>
                  </header>
                  <iframe
                    title={widget.title}
                    src={normalizeWidgetUrl(widget.url)}
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default KfvOfficialWidgets;
