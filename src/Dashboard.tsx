import { useEffect, useState } from "react";
import { signOut, type User } from "firebase/auth";
import { auth } from "./firebase";
import { hasPermission, type UserProfile } from "./permissions";
import "./Dashboard.css";
import "./ClearClub.css";
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
import FanFeatures from "./FanFeatures";
import NotificationsAdmin from "./NotificationsAdmin";
import { Icon } from "./Icons";
import LogoManager from "./LogoManager";
import SponsorManager from "./SponsorManager";
import KitManager from "./KitManager";
import TrainingPlanner from "./TrainingPlanner";
import TrainingWeekReminder from "./TrainingWeekReminder";
import ClubPeopleManager from "./ClubPeopleManager";
import PublicSponsors from "./PublicSponsors";
import PublicEvents from "./PublicEvents";
import PublicPeople from "./PublicPeople";
import PublicClubInfo from "./PublicClubInfo";
import VisualManager from "./VisualManager";
import { APP_VERSION } from "./appVersion";
import { disablePush, enablePush, getPushSupport, hasActivePushToken } from "./push";

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
  | "fan-features"
  | "notifications-admin"
  | "logo-manager"
  | "sponsor-manager"
  | "kit-manager"
  | "training-planner"
  | "board-manager"
  | "trainer-manager"
  | "public-sponsors"
  | "public-events"
  | "public-board"
  | "public-trainers"
  | "public-club"
  | "visual-manager"
  | "administration";

type DashboardProps = { user: User | null; profile: UserProfile; onLogin?: () => void };

function Dashboard({ user, profile, onLogin }: DashboardProps) {
  const role = profile.role;
  const canEnterMatchResults =
    Boolean(user) && ["admin", "section", "trainer"].includes(role);
  const [activePage, setActivePage] =
    useState<Page>("start");
  const [profileOpen, setProfileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);
  const [pushMessage, setPushMessage] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [kfvInitialTab, setKfvInitialTab] = useState<"matches" | "table" | "squad">("matches");
  const canManageMatches = hasPermission(role, "manageMatches");
  const canManageStandings = hasPermission(role, "manageStandings");
  const canManagePeople = hasPermission(role, "managePeople");
  const canManageEvents = hasPermission(role, "manageEvents");
  const canManageNews = hasPermission(role, "manageNews");
  const canManageSync = role === "admin";
  const canManageClub = role === "admin" || role === "section";
  const canManageSponsors = hasPermission(role, "manageSponsors");
  const canManageKits = role === "admin" || role === "section";
  const canUseTrainingPlanner = Boolean(user) && ["admin", "section", "trainer"].includes(role);
  const hasInternalAccess = Boolean(user) && ["admin", "section", "trainer", "board"].includes(role);
  const canOpenAdministration = Boolean(user) && ["admin", "section", "board"].includes(role);

  useEffect(() => {
    if (!user) {
      setPushEnabled(false);
      setPushMessage("");
      return;
    }

    let active = true;
    void Promise.all([getPushSupport(), hasActivePushToken()])
      .then(([support, enabled]) => {
        if (!active) return;
        setPushSupported(support.supported);
        setPushEnabled(enabled);
      })
      .catch(() => {
        if (active) setPushSupported(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  async function handlePushToggle() {
    if (pushBusy || !user) return;
    setPushBusy(true);
    setPushMessage("");

    try {
      if (pushEnabled) {
        await disablePush();
        setPushEnabled(false);
        setPushMessage("Push-Benachrichtigungen deaktiviert.");
      } else {
        await enablePush(["all"]);
        setPushEnabled(true);
        setPushSupported(true);
        setPushMessage("Push-Benachrichtigungen sind aktiviert.");
      }
    } catch (error) {
      console.error("Push-Einstellung fehlgeschlagen", error);
      setPushMessage(error instanceof Error ? error.message : "Push konnte nicht aktiviert werden.");
    } finally {
      setPushBusy(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLogoutError("");
    setLoggingOut(true);
    setProfileOpen(false);
    setActivePage("start");

    try {
      await signOut(auth);
      // PWA/Browser vollständig auf den öffentlichen Zustand zurücksetzen.
      window.location.replace(`${window.location.origin}${window.location.pathname}`);
    } catch (error) {
      console.error("Abmelden fehlgeschlagen", error);
      setLogoutError("Abmelden fehlgeschlagen. Bitte erneut versuchen.");
      setLoggingOut(false);
      setProfileOpen(true);
    }
  }

  function renderMorePage() {
    return (
      <section className="dashboard-page clear-more-page public-more-page club-menu-modern">
        <div className="club-menu-watermark" aria-hidden="true">
          <img src="/tsu-ainet-logo.png" alt="" />
        </div>

        <header className="club-menu-hero">
          <div className="club-menu-hero-copy">
            <span className="club-menu-kicker">TSU AINET</span>
            <h2>Verein</h2>
            <span className="club-menu-accent" aria-hidden="true" />
            <p>Alles rund um unseren Verein – schnell und übersichtlich.</p>
          </div>
        </header>

        <div className="public-more-grid club-menu-grid">
          <button type="button" className="club-menu-card card-blue" onClick={() => { setSelectedMatchId(""); setKfvInitialTab("table"); setActivePage("kfv-live"); }}>
            <span className="quick-icon"><Icon name="table" /></span>
            <span className="club-menu-card-copy"><strong>Tabellen</strong><small>KM, Challenge & U17</small></span>
            <span className="club-menu-chevron">›</span>
          </button>
          <button type="button" className="club-menu-card card-gold" onClick={() => setActivePage("public-board")}>
            <span className="quick-icon"><Icon name="shield" /></span>
            <span className="club-menu-card-copy"><strong>Vorstand</strong><small>Unser Vereinsvorstand</small></span>
            <span className="club-menu-chevron">›</span>
          </button>
          <button type="button" className="club-menu-card card-blue" onClick={() => setActivePage("public-trainers")}>
            <span className="quick-icon"><Icon name="users" /></span>
            <span className="club-menu-card-copy"><strong>Trainer</strong><small>Trainer & Betreuer</small></span>
            <span className="club-menu-chevron">›</span>
          </button>
          <button type="button" className="club-menu-card card-red" onClick={() => setActivePage("public-sponsors")}>
            <span className="quick-icon"><Icon name="sponsor" /></span>
            <span className="club-menu-card-copy"><strong>Sponsoren</strong><small>Unsere Partner</small></span>
            <span className="club-menu-chevron">›</span>
          </button>
          <button type="button" className="club-menu-card card-gold" onClick={() => setActivePage("public-events")}>
            <span className="quick-icon"><Icon name="calendar" /></span>
            <span className="club-menu-card-copy"><strong>Termine</strong><small>Vereinstermine & Events</small></span>
            <span className="club-menu-chevron">›</span>
          </button>
          {hasInternalAccess && (
            <button type="button" className="club-menu-card card-blue" onClick={() => setActivePage("public-club")}>
              <span className="quick-icon"><Icon name="location" /></span>
              <span className="club-menu-card-copy"><strong>Vereinsinfo</strong><small>Infos & Organisation</small></span>
              <span className="club-menu-chevron">›</span>
            </button>
          )}
          {canManageKits && (
            <button type="button" className="club-menu-card card-red mobile-kit-entry" onClick={() => setActivePage("kit-manager")}>
              <span className="quick-icon"><Icon name="shirt" /></span>
              <span className="club-menu-card-copy"><strong>Trikotsätze</strong><small>Teams & Ausstattung</small></span>
              <span className="club-menu-chevron">›</span>
            </button>
          )}
          {canUseTrainingPlanner && (
            <button type="button" className="club-menu-card card-gold" onClick={() => setActivePage("training-planner")}>
              <span className="quick-icon"><Icon name="calendar" /></span>
              <span className="club-menu-card-copy"><strong>Trainingsplaner</strong><small>Plätze & Trainingszeiten</small></span>
              <span className="club-menu-chevron">›</span>
            </button>
          )}
          {canEnterMatchResults && (
            <button
              type="button"
              className="club-menu-card card-blue result-entry-menu-card"
              onClick={() => {
                setSelectedMatchId("");
                setKfvInitialTab("matches");
                setActivePage("kfv-live");
              }}
            >
              <span className="quick-icon"><Icon name="ball" /></span>
              <span className="club-menu-card-copy">
                <strong>Spielergebnis eintragen</strong>
                <small>Nach Spielende für dein Team</small>
              </span>
              <span className="club-menu-chevron">›</span>
            </button>
          )}
        </div>

        {canOpenAdministration && (
          <button type="button" className="administration-entry club-admin-entry" onClick={() => setActivePage("administration")}>
            <span className="quick-icon"><Icon name="settings" /></span>
            <span className="club-menu-card-copy"><strong>Administration</strong><small>Verwaltung & Einstellungen</small></span>
            <span className="club-menu-chevron">›</span>
          </button>
        )}
      </section>
    );
  }

  function renderAdministrationPage() {
    if (!canOpenAdministration) return renderMorePage();
    return (
      <section className="dashboard-page clear-more-page administration-page">
        <header className="administration-header">
          <button type="button" onClick={() => setActivePage("mehr")}>‹</button>
          <h2>Administration</h2>
          <span />
        </header>
        <div className="quick-grid administration-grid">
          {canManageMatches && <button type="button" className="quick-card" onClick={() => setActivePage("match-admin")}><span className="quick-icon"><Icon name="ball" /></span><span className="quick-content"><strong>Spiele verwalten</strong></span><span className="quick-arrow">›</span></button>}
          {canManageStandings && <button type="button" className="quick-card" onClick={() => setActivePage("standings-admin")}><span className="quick-icon"><Icon name="table" /></span><span className="quick-content"><strong>Tabellen verwalten</strong></span><span className="quick-arrow">›</span></button>}
          {canManageEvents && <button type="button" className="quick-card" onClick={() => setActivePage("events-admin")}><span className="quick-icon"><Icon name="calendar" /></span><span className="quick-content"><strong>Termine verwalten</strong></span><span className="quick-arrow">›</span></button>}
          {canManageNews && <button type="button" className="quick-card" onClick={() => setActivePage("news-admin")}><span className="quick-icon"><Icon name="news" /></span><span className="quick-content"><strong>Ankündigungen verwalten</strong></span><span className="quick-arrow">›</span></button>}
          {canManagePeople && <button type="button" className="quick-card" onClick={() => setActivePage("admin")}><span className="quick-icon"><Icon name="users" /></span><span className="quick-content"><strong>Personenverwaltung</strong></span><span className="quick-arrow">›</span></button>}
          {canManagePeople && <button type="button" className="quick-card" onClick={() => setActivePage("board-manager")}><span className="quick-icon"><Icon name="shield" /></span><span className="quick-content"><strong>Vorstand verwalten</strong></span><span className="quick-arrow">›</span></button>}
          {canManagePeople && <button type="button" className="quick-card" onClick={() => setActivePage("trainer-manager")}><span className="quick-icon"><Icon name="users" /></span><span className="quick-content"><strong>Trainer verwalten</strong></span><span className="quick-arrow">›</span></button>}
          {canManageSponsors && <button type="button" className="quick-card" onClick={() => setActivePage("sponsor-manager")}><span className="quick-icon"><Icon name="sponsor" /></span><span className="quick-content"><strong>Sponsor Manager</strong></span><span className="quick-arrow">›</span></button>}
          {canManageKits && <button type="button" className="quick-card" onClick={() => setActivePage("kit-manager")}><span className="quick-icon"><Icon name="shirt" /></span><span className="quick-content"><strong>Trikotsätze verwalten</strong></span><span className="quick-arrow">›</span></button>}
          {canUseTrainingPlanner && <button type="button" className="quick-card" onClick={() => setActivePage("training-planner")}><span className="quick-icon"><Icon name="calendar" /></span><span className="quick-content"><strong>Trainingsplaner</strong></span><span className="quick-arrow">›</span></button>}
          {canManageClub && user && <button type="button" className="quick-card" onClick={() => setActivePage("logo-manager")}><span className="quick-icon"><Icon name="gallery" /></span><span className="quick-content"><strong>Logo Manager</strong></span><span className="quick-arrow">›</span></button>}
          {canManageClub && <button type="button" className="quick-card" onClick={() => setActivePage("visual-manager")}><span className="quick-icon"><Icon name="gallery" /></span><span className="quick-content"><strong>Bildverwaltung</strong></span><span className="quick-arrow">›</span></button>}
          {canManageClub && <button type="button" className="quick-card" onClick={() => setActivePage("notifications-admin")}><span className="quick-icon"><Icon name="bell" /></span><span className="quick-content"><strong>Push senden</strong></span><span className="quick-arrow">›</span></button>}
          {canManageClub && <button type="button" className="quick-card" onClick={() => setActivePage("club-admin")}><span className="quick-icon"><Icon name="shield" /></span><span className="quick-content"><strong>Vereinsverwaltung</strong></span><span className="quick-arrow">›</span></button>}
          {canManageSync && <button type="button" className="quick-card" onClick={() => setActivePage("kfv-sync-admin")}><span className="quick-icon"><Icon name="sync" /></span><span className="quick-content"><strong>Synchronisierung</strong></span><span className="quick-arrow">›</span></button>}
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

    if (activePage === "public-sponsors") return <PublicSponsors onBack={() => setActivePage("mehr")} />;
    if (activePage === "public-events") return <PublicEvents onBack={() => setActivePage("mehr")} />;
    if (activePage === "public-board") return <PublicPeople kind="board" onBack={() => setActivePage("mehr")} />;
    if (activePage === "public-trainers") return <PublicPeople kind="trainer" onBack={() => setActivePage("mehr")} />;
    if (activePage === "public-club") return hasInternalAccess ? <PublicClubInfo onBack={() => setActivePage("mehr")} /> : renderMorePage();
    if (activePage === "administration") return renderAdministrationPage();

    if (activePage === "kfv-live") {
      return <KfvLive initialMatchId={selectedMatchId} initialTab={kfvInitialTab} />;
    }



    if (activePage === "logo-manager") {
      return canManageClub && user ? <LogoManager user={user} profile={profile} onBack={() => setActivePage("mehr")} /> : renderMorePage();
    }

    if (activePage === "sponsor-manager") {
      return canManageSponsors ? <SponsorManager onBack={() => setActivePage("administration")} /> : renderMorePage();
    }

    if (activePage === "kit-manager") {
      return canManageKits ? <KitManager onBack={() => setActivePage("administration")} /> : renderMorePage();
    }

    if (activePage === "training-planner") {
      return canUseTrainingPlanner && user ? <TrainingPlanner user={user} profile={profile} onBack={() => setActivePage("mehr")} /> : renderMorePage();
    }

    if (activePage === "visual-manager") {
      return canManageClub ? <VisualManager onBack={() => setActivePage("administration")} /> : renderMorePage();
    }

    if (activePage === "board-manager") {
      return canManagePeople ? <ClubPeopleManager kind="board" onBack={() => setActivePage("administration")} /> : renderMorePage();
    }

    if (activePage === "trainer-manager") {
      return canManagePeople ? <ClubPeopleManager kind="trainer" onBack={() => setActivePage("administration")} /> : renderMorePage();
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
        {role === "trainer" && (
          <TrainingWeekReminder profile={profile} onOpenPlanner={() => setActivePage("training-planner")} />
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
            setKfvInitialTab("matches");
            setActivePage("kfv-live");
          }}
          onOpenStandings={() => {
            setSelectedMatchId("");
            setKfvInitialTab("table");
            setActivePage("kfv-live");
          }}
          onOpenMatch={(matchId) => {
            setSelectedMatchId(matchId);
            setKfvInitialTab("matches");
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
    activePage === "fan-features" ||
    activePage === "notifications-admin" ||
    activePage === "logo-manager" ||
    activePage === "sponsor-manager" ||
    activePage === "kit-manager" ||
    activePage === "training-planner" ||
    activePage === "visual-manager" ||
    activePage === "board-manager" ||
    activePage === "trainer-manager" ||
    activePage === "public-sponsors" ||
    activePage === "public-events" ||
    activePage === "public-board" ||
    activePage === "public-trainers" ||
    activePage === "public-club" ||
    activePage === "administration"
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
          <span className="dashboard-brand-mark" aria-hidden="true">
            <img src="/tsu-ainet-logo.png" alt="" />
          </span>
          <span>
            <strong>TSU Ainet</strong>
          </span>
        </button>

        <div className="profile-wrap">
          {user ? (
            <>
              <button
                type="button"
                className="profile-button"
                aria-label="Profil öffnen"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((value) => !value)}
              >
                {(user.displayName || user.email || "TSU")
                  .split(/\s|@/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("")}
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <strong>{profile.name}</strong>
                  <span>{profile.email || user.email}</span>
                  <small>Interner Vereinsbereich</small>

                  <div className="profile-push-status">
                    <span className={pushEnabled ? "is-on" : "is-off"} aria-hidden="true" />
                    <div>
                      <strong>Benachrichtigungen</strong>
                      <small>{pushEnabled ? "Push ist aktiviert" : "Push ist noch nicht aktiviert"}</small>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`profile-push-button ${pushEnabled ? "is-enabled" : ""}`}
                    onClick={() => void handlePushToggle()}
                    disabled={pushBusy || !pushSupported}
                  >
                    {pushBusy
                      ? "Bitte warten …"
                      : !pushSupported
                        ? "Push nicht unterstützt"
                        : pushEnabled
                          ? "🔕 Push deaktivieren"
                          : "🔔 Push aktivieren"}
                  </button>

                  {pushMessage && <span className="profile-push-message" role="status">{pushMessage}</span>}
                  {canOpenAdministration && <button type="button" onClick={() => { setProfileOpen(false); setActivePage("administration"); }}>Administration</button>}
                  {logoutError && <span className="profile-logout-error" role="alert">{logoutError}</span>}
                  <button type="button" className="profile-logout-button" onClick={() => void handleLogout()} disabled={loggingOut}>
                    {loggingOut ? "Wird abgemeldet …" : "Abmelden"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              className="dashboard-login-button"
              onClick={onLogin}
              aria-label="Zum internen Vereinsbereich anmelden"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <path d="m10 17 5-5-5-5" />
                <path d="M15 12H3" />
              </svg>
              <span>Anmelden</span>
            </button>
          )}
        </div>
      </header>

      <main className="dashboard-content">
        {renderPage()}
        <footer className="dashboard-version" aria-label="App-Version">
          <span>TSU Ainet App</span>
          <strong>Version {APP_VERSION}</strong>
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
