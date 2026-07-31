import { useEffect, useMemo, useState } from "react";
import "./InstallApp.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export default function InstallApp() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("tsu-install-dismissed") === "1");

  const isIos = useMemo(() => /iphone|ipad|ipod/i.test(navigator.userAgent), []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setDismissed(false);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setShowIosHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || dismissed || (!installEvent && !isIos)) return null;

  const install = async () => {
    if (isIos && !installEvent) {
      setShowIosHelp(true);
      return;
    }
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  const close = () => {
    sessionStorage.setItem("tsu-install-dismissed", "1");
    setDismissed(true);
  };

  return (
    <div className="install-app" role="dialog" aria-label="TSU Ainet App installieren">
      <button className="install-app-close" onClick={close} aria-label="Schließen">×</button>
      <img src="/icon-192.png" alt="" />
      <div className="install-app-copy">
        <strong>TSU Ainet als App installieren</strong>
        {showIosHelp ? (
          <p>Tippe in Safari unten auf <b>Teilen</b> und danach auf <b>„Zum Home-Bildschirm“</b>.</p>
        ) : (
          <p>Schneller Zugriff direkt über den Startbildschirm – wie eine normale App.</p>
        )}
      </div>
      {!showIosHelp && <button className="install-app-button" onClick={install}>Installieren</button>}
    </div>
  );
}
