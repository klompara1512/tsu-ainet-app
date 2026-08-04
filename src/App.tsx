import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import Login from "./Login";
import PublicGames from "./PublicGames";
import Dashboard from "./Dashboard";
import {
  normalizeRole,
  type AppRole,
  type UserProfile,
} from "./permissions";
import InstallApp from "./InstallApp";
import UpdateApp from "./UpdateApp";
import "./App.css";

export type { AppRole, UserProfile } from "./permissions";

function fallbackProfile(user: User | null, role: AppRole = "fan"): UserProfile {
  return {
    name: user?.displayName || user?.email?.split("@")[0] || "TSU-Fan",
    email: user?.email || "",
    active: true,
    approved: role !== "pending",
    role,
    teamIds: [],
  };
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => fallbackProfile(null));
  const [authReady, setAuthReady] = useState(false);
  const [publicMode, setPublicMode] = useState(false);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      unsubscribeProfile?.();
      setUser(currentUser);

      if (!currentUser) {
        setProfile(fallbackProfile(null));
        setAuthReady(true);
        return;
      }

      setAuthReady(false);
      unsubscribeProfile = onSnapshot(
        doc(db, "users", currentUser.uid),
        (snapshot) => {
          const data = snapshot.data();
          const role = normalizeRole(data?.role);
          setProfile({
            name:
              typeof data?.name === "string" && data.name.trim()
                ? data.name.trim()
                : fallbackProfile(currentUser, role).name,
            email:
              typeof data?.email === "string" && data.email.trim()
                ? data.email.trim()
                : currentUser.email || "",
            active: data?.active !== false,
            approved: data?.approved === true || role !== "pending",
            role,
            teamIds: Array.isArray(data?.teamIds)
              ? data.teamIds.filter((value): value is string => typeof value === "string")
              : [],
          });
          setAuthReady(true);
        },
        () => {
          setProfile(fallbackProfile(currentUser));
          setAuthReady(true);
        },
      );
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  if (!authReady) {
    return (
      <div className="app-loading">
        <img src="/tsu-ainet-logo.png" alt="TSU Ainet" />
        <span>Lade Vereins-App …</span>
      </div>
    );
  }

  if (!user) {
    if (publicMode) return <PublicGames onLogin={() => setPublicMode(false)} />;
    return <Login onPublicGames={() => setPublicMode(true)} />;
  }

  if (!profile.active || !profile.approved || profile.role === "pending") {
    return (
      <main className="pending-shell">
        <section className="pending-card">
          <img src="/tsu-ainet-logo.png" alt="TSU Ainet" />
          <span>Registrierung erfolgreich</span>
          <h1>Freigabe ausständig</h1>
          <p>Hallo {profile.name}. Deine Registrierung wurde übermittelt. Die Sektionsleitung muss dein Konto noch freigeben.</p>
          <button onClick={() => auth.signOut()}>Abmelden</button>
        </section>
      </main>
    );
  }

  return <Dashboard user={user} profile={profile} />;
}

function App() {
  return (
    <>
      <AppContent />
      <InstallApp />
      <UpdateApp />
    </>
  );
}

export default App;
