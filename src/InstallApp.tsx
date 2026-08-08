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
  const [showHelp, setShowHelp] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("tsu-install-dismissed") === "1");

  const isIos = useMemo(() => /iphone|ipad|ipod/i.test(navigator.userAgent), []);
  const isAndroid = useMemo(() => /android/i.test(navigator.userAgent), []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setDismissed(false);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setShowHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || dismissed || (!installEvent && !isIos && !isAndroid)) return null;

  const install = async () => {
    if (!installEvent) {
      setShowHelp(true);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  const close = () => {
    sessionStorage.setItem("tsu-install-dismissed", "1");
    setDismissed(true);
  };

  const helpText = isIos
    ? <>In <b>Safari</b> auf <b>Teilen</b> tippen und anschließend <b>„Zum Home-Bildschirm“</b> wählen.</>
    : <>In <b>Chrome</b> oben rechts auf <b>⋮</b> tippen und <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b> wählen.</>;

  return (
    <div className="install-app" role="dialog" aria-label="TSU Ainet App installieren">
      <button className="install-app-close" onClick={close} aria-label="Schließen">×</button>
      <img src="/icon-192.png" alt="TSU Ainet" />
      <div className="install-app-copy">
        <span className="install-app-platform">{isIos ? "iPhone / iPad" : "Android"}</span>
        <strong>TSU Ainet als App installieren</strong>
        {showHelp ? (
          <p className="install-app-help">{helpText}</p>
        ) : (
          <p>Schneller Zugriff direkt über den Startbildschirm – wie eine normale App.</p>
        )}
      </div>
      {!showHelp && (
        <button className="install-app-button" onClick={install}>
          {installEvent ? "Installieren" : "So geht’s"}
        </button>
      )}
      {showHelp && (
        <button className="install-app-button install-app-button-secondary" onClick={() => setShowHelp(false)}>
          Verstanden
        </button>
      )}
    </div>
  );
}
