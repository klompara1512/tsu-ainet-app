import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getKfvClubLogo,
  isTsuAinet,
  normalizeClubName,
  subscribeKfvClubs,
} from "./kfvFirestore";
import type { KfvClub } from "./kfvTypes";

type TeamLogoSize = "small" | "normal" | "large" | "hero";

type Props = {
  url?: string;
  name: string;
  size?: TeamLogoSize;
  className?: string;
  clubId?: string;
};

let cachedClubs: KfvClub[] = [];
let unsubscribeClubs: (() => void) | null = null;
const clubListeners = new Set<() => void>();

function emitClubChange() {
  clubListeners.forEach((listener) => listener());
}

function startClubSubscription() {
  if (unsubscribeClubs) return;

  unsubscribeClubs = subscribeKfvClubs(
    (clubs) => {
      cachedClubs = clubs;
      emitClubChange();
    },
    () => {
      cachedClubs = [];
      emitClubChange();
    },
  );
}

function subscribeClubStore(listener: () => void) {
  clubListeners.add(listener);
  startClubSubscription();

  return () => {
    clubListeners.delete(listener);
  };
}

function getClubSnapshot() {
  return cachedClubs;
}

function localLogoFor(name: string) {
  if (isTsuAinet(name)) return "/tsu-ainet-logo.png";

  const normalized = normalizeClubName(name);
  const localLogos: Record<string, string> = {
    doelsach: "/logos/clubs/doelsach.png",
  };

  return localLogos[normalized] || "";
}

function TeamLogo({ url = "", name, size = "normal", className = "", clubId = "" }: Props) {
  const clubs = useSyncExternalStore(
    subscribeClubStore,
    getClubSnapshot,
    getClubSnapshot,
  );

  const candidates = useMemo(() => {
    const values = [
      localLogoFor(name),
      // Die zentrale Funktion prüft zusätzlich, ob bei einem Gegner irrtümlich
      // das TSU-Ainet-Wappen gespeichert wurde.
      getKfvClubLogo(clubs, name, url, clubId),
    ].filter(Boolean);

    return values.filter((value, index) => values.indexOf(value) === index);
  }, [clubs, name, url, clubId]);

  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [name, url, candidates.join("|")]);

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "⚽";

  const classes = `team-logo team-logo-${size} ${className}`.trim();
  const currentLogo = candidates[candidateIndex] || "";

  if (!currentLogo) {
    return (
      <span
        className={`${classes} team-logo-fallback`}
        aria-label={`${name} Logo nicht verfügbar`}
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      className={classes}
      src={currentLogo}
      alt={`${name} Logo`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setCandidateIndex((current) => current + 1);
      }}
    />
  );
}

export default TeamLogo;
