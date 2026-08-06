import { useEffect, useState } from "react";
import "./OfflineStatus.css";

function getOnlineState() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export default function OfflineStatus() {
  const [online, setOnline] = useState(getOnlineState);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    let restoredTimer: number | undefined;

    const handleOffline = () => {
      if (restoredTimer) window.clearTimeout(restoredTimer);
      setShowRestored(false);
      setOnline(false);
    };

    const handleOnline = () => {
      setOnline(true);
      setShowRestored(true);
      restoredTimer = window.setTimeout(() => setShowRestored(false), 3000);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (restoredTimer) window.clearTimeout(restoredTimer);
    };
  }, []);

  if (online && !showRestored) return null;

  return (
    <div
      className={`network-status ${online ? "network-status--online" : "network-status--offline"}`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true">{online ? "✓" : "!"}</span>
      <strong>{online ? "Verbindung wiederhergestellt" : "Offline-Modus"}</strong>
      {!online && <small>Bereits geladene Inhalte bleiben verfügbar.</small>}
    </div>
  );
}
