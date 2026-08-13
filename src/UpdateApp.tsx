import { useEffect, useMemo, useState } from "react";
import { APP_VERSION } from "./appVersion";
import "./UpdateApp.css";

type UpdateState = "idle" | "available" | "installing";
type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export default function UpdateApp() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [state, setState] = useState<UpdateState>("idle");
  const [showHelp, setShowHelp] = useState(false);
  const platform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

    let disposed = false;
    let timer: number | undefined;
    let removeUpdateFound: (() => void) | undefined;
    let reloading = false;

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const markAvailable = (reg: ServiceWorkerRegistration) => {
      if (disposed) return;
      setRegistration(reg);
      if (reg.waiting) setState("available");
    };

    navigator.serviceWorker.ready.then((reg) => {
      if (disposed) return;
      setRegistration(reg);
      markAvailable(reg);

      const onUpdateFound = () => {
        const worker = reg.installing;
        if (!worker) return;
        const onStateChange = () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            markAvailable(reg);
          }
        };
        worker.addEventListener("statechange", onStateChange);
      };

      reg.addEventListener("updatefound", onUpdateFound);
      removeUpdateFound = () => reg.removeEventListener("updatefound", onUpdateFound);

      const check = async () => {
        try {
          await reg.update();
          markAvailable(reg);
        } catch {
          // Offline bzw. vorübergehend nicht erreichbar: still weiterarbeiten.
        }
      };

      void check();
      timer = window.setInterval(check, 15 * 60 * 1000);
    }).catch(() => undefined);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      navigator.serviceWorker.ready.then(async (reg) => {
        try {
          await reg.update();
          markAvailable(reg);
        } catch {
          // Keine Aktion nötig.
        }
      }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
      removeUpdateFound?.();
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (state === "idle") return null;

  const update = () => {
    setState("installing");
    const waiting = registration?.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  };

  const instructions = platform === "ios"
    ? [
        "Tippe zuerst auf „Jetzt aktualisieren“.",
        "Falls die App danach noch alt aussieht: App vollständig schließen und erneut öffnen.",
        "Wenn nötig, die Web-App einmal in Safari öffnen und die Seite neu laden.",
      ]
    : platform === "android"
      ? [
          "Tippe zuerst auf „Jetzt aktualisieren“.",
          "Falls nötig, App vollständig schließen und erneut öffnen.",
          "Alternativ die Seite im Browser öffnen und neu laden.",
        ]
      : [
          "Klicke zuerst auf „Jetzt aktualisieren“.",
          "Falls die alte Ansicht bleibt: Strg + F5 drücken.",
          "Danach die App-Seite neu öffnen.",
        ];

  return (
    <div className="app-update-backdrop" role="presentation">
      <section className="app-update-modal" role="dialog" aria-modal="true" aria-labelledby="app-update-title">
        <div className="app-update-icon" aria-hidden="true">↻</div>
        <div className="app-update-copy">
          <span className="app-update-kicker">TSU Ainet App</span>
          <h2 id="app-update-title">Neue App-Version verfügbar</h2>
          <p>Es gibt ein Update mit Verbesserungen und neuen Funktionen. Bitte aktualisiere die App, damit überall dieselbe Version verwendet wird.</p>
          <span className="app-update-version">Neue Version: {APP_VERSION}</span>
          <div className="app-update-quicktip">
            {platform === "ios"
              ? "Am iPhone: Jetzt aktualisieren tippen, danach die App bei Bedarf einmal komplett schließen und neu öffnen."
              : platform === "android"
                ? "Auf Android: Jetzt aktualisieren tippen und die App bei Bedarf einmal schließen und neu öffnen."
                : "Am PC: Jetzt aktualisieren klicken. Falls nötig anschließend Strg + F5 drücken."}
          </div>
        </div>

        <div className="app-update-actions">
          <button className="app-update-primary" type="button" onClick={update} disabled={state === "installing"}>
            {state === "installing" ? "App wird aktualisiert …" : "Jetzt aktualisieren"}
          </button>
          <button className="app-update-secondary" type="button" onClick={() => setShowHelp((value) => !value)}>
            {showHelp ? "Anleitung ausblenden" : "Wie aktualisiere ich?"}
          </button>
        </div>

        {showHelp && (
          <div className="app-update-help">
            <strong>{platform === "ios" ? "iPhone / iPad" : platform === "android" ? "Android" : "PC / Notebook"}</strong>
            <ol>
              {instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
