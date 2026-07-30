import KfvLive from "./kfvLive";
import "./PublicGames.css";

type PublicGamesProps = {
  onLogin: () => void;
};

export default function PublicGames({ onLogin }: PublicGamesProps) {
  return (
    <div className="public-games-shell">
      <header className="public-games-header">
        <button type="button" className="public-games-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <img src="/tsu-ainet-logo.png" alt="TSU Ainet" />
          <span><strong>TSU Ainet</strong><small>Öffentliche Spiele & Tabellen</small></span>
        </button>
        <button type="button" className="public-login-button" onClick={onLogin}>Anmelden</button>
      </header>

      <main className="public-games-content">
        <div className="public-games-notice">
          <span aria-hidden="true">⚽</span>
          <div>
            <strong>Ohne Anmeldung verfügbar</strong>
            <p>Spielpläne, Ergebnisse und Tabellen aller TSU-Ainet-Mannschaften.</p>
          </div>
        </div>
        <KfvLive />
      </main>
    </div>
  );
}
