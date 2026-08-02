import { useState } from "react";
import { signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import { hasPermission, roleLabel, type UserProfile } from "./permissions";
import "./Dashboard.css";
import Admin from "./Admin";
import BottomNav from "./BottomNav";
import EventsAdmin from "./EventsAdmin";
import Kalender from "./Kalender";
import KfvLive from "./kfvLive";
import LiveDashboard from "./LiveDashboard";
import News from "./News";
import NewsAdmin from "./NewsAdmin";
import Teams from "./Teams";
import MatchAdmin from "./MatchAdmin";
import StandingsAdmin from "./StandingsAdmin";
import KfvSyncAdmin from "./KfvSyncAdmin";
import ClubAdmin from "./ClubAdmin";
import ClubHub from "./ClubHub";
import FanFeatures from "./FanFeatures";
import NotificationsAdmin from "./NotificationsAdmin";
import { Icon } from "./Icons";
import BoardOverview from "./BoardOverview";

type Page =
  | "start"
  | "kalender"
  | "teams"
  | "news"
  | "mehr"
  | "kfv-live"
  | "admin"
  | "events-admin"
  | "news-admin"
  | "match-admin"
  | "standings-admin"
  | "kfv-sync-admin"
  | "club-admin"
  | "club-hub"
  | "fan-features"
  | "notifications-admin";

type DashboardProps = { user: User; profile: UserProfile };

function Dashboard({ user, profile }: DashboardProps) {
  const role = profile.role;
  const [activePage, setActivePage] =
    useState<Page>("start");
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const canManageMatches = hasPermission(role, "manageMatches");
  const canManageStandings = hasPermission(role, "manageStandings");
  const canManagePeople = hasPermission(role, "managePeople");
  const canManageEvents = hasPermission(role, "manageEvents");
  const canManageNews = hasPermission(role, "manageNews");
  const canManageSync = role === "admin";
  const canManageClub = role === "admin" || role === "section";
  const canManageAnything =
    canManageMatches || canManageStandings || canManagePeople || canManageEvents || canManageNews;

  function renderMorePage() {
    return (
      <section className="dashboard-page">
        <p className="home-eyebrow">
          TSU Ainet Fußball
        </p>

        <h2>Mehr</h2>

        <p>
          Verwaltung, Dokumente, Profil und
          Einstellungen.
        </p>

        <div
          className="quick-grid"
          style={{ marginTop: "24px" }}
        >
          <button
            type="button"
            className="quick-card"
            onClick={() => setActivePage("kfv-live")}
          >
            <span className="quick-icon"><Icon name="live" /></span>

            <span className="quick-content">
              <strong>KFV Live</strong>
              <small>Spiele, Ergebnisse und Tabellen</small>
            </span>

            <span className="quick-arrow">›</span>
          </button>


          <button type="button" className="quick-card" onClick={() => setActivePage("club-hub")}>
            <span className="quick-icon"><Icon name="shield" /></span><span className="quick-content"><strong>Vereinsbereich</strong><small>Aufgaben, Dienste, Dokumente und Sponsoren</small></span><span className="quick-arrow">›</span>
          </button>

          <button type="button" className="quick-card" onClick={() => setActivePage("fan-features")}>
            <span className="quick-icon"><Icon name="star" /></span><span className="quick-content"><strong>Fanbereich</strong><small>Statistik, Favoriten, Live, Medien, Kalender und Spieltag</small></span><span className="quick-arrow">›</span>
          </button>

          {canManageClub && <button type="button" className="quick-card" onClick={() => setActivePage("notifications-admin")}><span className="quick-icon"><Icon name="bell" /></span><span className="quick-content"><strong>Push senden</strong><small>Nachrichten an Fans und Mannschaften</small></span><span className="quick-arrow">›</span></button>}

          {canManageClub && <button type="button" className="quick-card" onClick={() => setActivePage("club-admin")}>
            <span className="quick-icon"><Icon name="settings" /></span><span className="quick-content"><strong>Vereinsverwaltung</strong><small>Benutzer, Einladungen, Aufgaben, Dienste, Dokumente und Sponsoren</small></span><span className="quick-arrow">›</span>
          </button>}

          {canManageAnything && (<>
          {canManageMatches && <button type="button" className="quick-card" onClick={() => setActivePage("match-admin")}>
            <span className="quick-icon"><Icon name="ball" /></span><span className="quick-content"><strong>Spiele verwalten</strong><small>Spielplan, Ergebnisse und Status in Firestore</small></span><span className="quick-arrow">›</span>
          </button>}

          {canManageSync && <button type="button" className="quick-card" onClick={() => setActivePage("kfv-sync-admin")}>
            <span className="quick-icon"><Icon name="sync" /></span><span className="quick-content"><strong>KFV-Synchronisierung</strong><small>Öffentliche Daten automatisch alle 30 Minuten</small></span><span className="quick-arrow">›</span>
          </button>}

          {canManageStandings && <button type="button" className="quick-card" onClick={() => setActivePage("standings-admin")}>
            <span className="quick-icon"><Icon name="table" /></span><span className="quick-content"><strong>Tabellen verwalten</strong><small>Tabellenzeilen und Punkte in Firestore</small></span><span className="quick-arrow">›</span>
          </button>}

          {canManagePeople && <button
            type="button"
            className="quick-card"
            onClick={() => setActivePage("admin")}
          >
            <span className="quick-icon"><Icon name="users" /></span>

            <span className="quick-content">
              <strong>Personenverwaltung</strong>
              <small>
                Spieler und Trainer verwalten
              </small>
            </span>

            <span className="quick-arrow">›</span>
          </button>}

          {canManageEvents && <button
            type="button"
            className="quick-card"
            onClick={() =>
              setActivePage("events-admin")
            }
          >
            <span className="quick-icon"><Icon name="calendar" /></span>

            <span className="quick-content">
              <strong>Terminverwaltung</strong>
              <small>
                Trainings und Spiele anlegen
              </small>
            </span>

            <span className="quick-arrow">›</span>
          </button>}

          {canManageNews && <button
            type="button"
            className="quick-card"
            onClick={() =>
              setActivePage("news-admin")
            }
          >
            <span className="quick-icon"><Icon name="news" /></span>

            <span className="quick-content">
              <strong>Newsverwaltung</strong>
              <small>
                Beiträge erstellen und veröffentlichen
              </small>
            </span>

            <span className="quick-arrow">›</span>
          </button>}

          </>)}

          <button
            type="button"
            className="quick-card"
          >
            <span className="quick-icon"><Icon name="document" /></span>

            <span className="quick-content">
              <strong>Dokumente</strong>
              <small>Wird später ergänzt</small>
            </span>

            <span className="quick-arrow">›</span>
          </button>
        </div>
      </section>
    );
  }

  function renderPage() {
    if (activePage === "kalender") {
      return <Kalender />;
    }

    if (activePage === "teams") {
      return <Teams />;
    }

    if (activePage === "news") {
      return <News />;
    }

    if (activePage === "kfv-live") {
      return <KfvLive initialMatchId={selectedMatchId} />;
    }

    if (activePage === "club-hub") {
      return <ClubHub />;
    }

    if (activePage === "fan-features") {
      return <FanFeatures />;
    }

    if (activePage === "mehr") {
      return renderMorePage();
    }

    const pageAllowed =
      (activePage === "admin" && canManagePeople) ||
      (activePage === "events-admin" && canManageEvents) ||
      (activePage === "news-admin" && canManageNews) ||
      (activePage === "match-admin" && canManageMatches) ||
      (activePage === "standings-admin" && canManageStandings) ||
      (activePage === "kfv-sync-admin" && canManageSync) ||
      (activePage === "club-admin" && canManageClub) ||
      (activePage === "notifications-admin" && canManageClub);

    if (["admin", "events-admin", "news-admin", "match-admin", "standings-admin", "kfv-sync-admin", "club-admin", "notifications-admin"].includes(activePage) && !pageAllowed) {
      return renderMorePage();
    }

    if (activePage === "club-admin") return <ClubAdmin onBack={() => setActivePage("mehr")} />;
    if (activePage === "notifications-admin") return <NotificationsAdmin onBack={() => setActivePage("mehr")} />;

    if (activePage === "admin") {
      return (
        <Admin
          onBack={() => setActivePage("mehr")}
        />
      );
    }

    if (activePage === "events-admin") {
      return (
        <EventsAdmin
          onBack={() => setActivePage("mehr")}
        />
      );
    }

    if (activePage === "match-admin") return <MatchAdmin onBack={() => setActivePage("mehr")} />;

    if (activePage === "standings-admin") return <StandingsAdmin onBack={() => setActivePage("mehr")} />;

    if (activePage === "kfv-sync-admin") return <KfvSyncAdmin onBack={() => setActivePage("mehr")} />;

    if (activePage === "news-admin") {
      return (
        <NewsAdmin
          onBack={() => setActivePage("mehr")}
        />
      );
    }

    return (
      <>
        {hasPermission(role, "manageTasks") && (
          <BoardOverview
            onOpenTasks={() => setActivePage("club-admin")}
            onOpenClubAdmin={() => setActivePage("club-admin")}
          />
        )}

        <LiveDashboard
          displayName={profile.name}
          onOpenCalendar={() =>
            setActivePage("kalender")
          }
          onOpenTeams={() =>
            setActivePage("teams")
          }
          onOpenNews={() =>
            setActivePage("news")
          }
          onOpenMore={() =>
            setActivePage("mehr")
          }
          onOpenKfvLive={() => {
            setSelectedMatchId("");
            setActivePage("kfv-live");
          }}
          onOpenMatch={(matchId) => {
            setSelectedMatchId(matchId);
            setActivePage("kfv-live");
          }}
        />
      </>
    );
  }

  function changePage(page: string) {
    if (
      page === "start" ||
      page === "kalender" ||
      page === "teams" ||
      page === "news" ||
      page === "mehr"
    ) {
      setSelectedMatchId("");
      setActivePage(page);
    }
  }

  const bottomNavigationPage =
    activePage === "admin" ||
    activePage === "events-admin" ||
    activePage === "news-admin" ||
    activePage === "kfv-live" ||
    activePage === "match-admin" ||
    activePage === "standings-admin" ||
    activePage === "kfv-sync-admin" ||
    activePage === "club-admin" ||
    activePage === "club-hub" ||
    activePage === "fan-features" ||
    activePage === "notifications-admin"
      ? "mehr"
      : activePage;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button
          type="button"
          className="dashboard-brand"
          onClick={() =>
            setActivePage("start")
          }
        >
          <span className="dashboard-brand-mark">
            <img src="/tsu-ainet-logo.png" alt="TSU Ainet Vereinslogo" />
          </span>

          <span>
            <strong>TSU Ainet</strong>
            <small>Fußball</small>
          </span>
        </button>

        <div className="profile-wrap">
          <button
            type="button"
            className="profile-button"
            aria-label="Profil öffnen"
            onClick={() => setProfileOpen((value) => !value)}
          >
            {(user.displayName || user.email || "TSU").split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <strong>{profile.name}</strong>
              <span>{profile.email || user.email}</span>
              <small>Rolle: {roleLabel(role)}</small>
              <button type="button" onClick={() => signOut(auth)}>Abmelden</button>
            </div>
          )}
        </div>
      </header>

      <main className="dashboard-content">
        {renderPage()}
        <footer className="dashboard-version" aria-label="App-Version">
          <img src="/tsu-ainet-logo.png" alt="" />
          <span>TSU Ainet App</span>
          <strong>Version 10.4.1</strong>
        </footer>
      </main>

      <BottomNav
        activePage={bottomNavigationPage}
        onPageChange={changePage}
      />
    </div>
  );
}

export default Dashboard;