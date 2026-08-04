import { useEffect, useState } from "react";
import "./UpdateApp.css";

type UpdateState = "idle" | "available" | "installing";

export default function UpdateApp() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [state, setState] = useState<UpdateState>("idle");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker.ready.then((reg) => {
      setRegistration(reg);
      if (reg.waiting) setState("available");

      const onUpdateFound = () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            setState("available");
          }
        });
      };
      reg.addEventListener("updatefound", onUpdateFound);

      const check = () => reg.update().catch(() => undefined);
      const timer = window.setInterval(check, 60 * 60 * 1000);
      const onVisible = () => {
        if (document.visibilityState === "visible") check();
      };
      document.addEventListener("visibilitychange", onVisible);

      return () => {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        reg.removeEventListener("updatefound", onUpdateFound);
      };
    }).catch(() => undefined);

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (state === "idle") return null;

  const update = () => {
    setState("installing");
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    window.setTimeout(() => window.location.reload(), 2500);
  };

  return (
    <div className="app-update" role="status" aria-live="polite">
      <div>
        <strong>Neue App-Version verfügbar</strong>
        <span>Jetzt aktualisieren und die neuesten Funktionen verwenden.</span>
      </div>
      <button type="button" onClick={update} disabled={state === "installing"}>
        {state === "installing" ? "Aktualisiere …" : "Aktualisieren"}
      </button>
    </div>
  );
}
