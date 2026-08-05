import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getKfvClubLogo,
  isTsuAinet,
  normalizeClubName,
  subscribeKfvClubs,
  subscribeKfvStandings,
} from "./kfvFirestore";
import type { KfvClub, KfvStandingRow } from "./kfvTypes";

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


let cachedStandings: KfvStandingRow[] = [];
let unsubscribeStandings: (() => void) | null = null;
const standingListeners = new Set<() => void>();

function emitStandingChange() {
  standingListeners.forEach((listener) => listener());
}

function startStandingSubscription() {
  if (unsubscribeStandings) return;

  unsubscribeStandings = subscribeKfvStandings(
    (rows) => {
      cachedStandings = rows;
      emitStandingChange();
    },
    () => {
      cachedStandings = [];
      emitStandingChange();
    },
  );
}

function subscribeStandingStore(listener: () => void) {
  standingListeners.add(listener);
  startStandingSubscription();

  return () => {
    standingListeners.delete(listener);
  };
}

function getStandingSnapshot() {
  return cachedStandings;
}

function standingLogoFor(rows: KfvStandingRow[], name: string, clubId: string) {
  const normalizedName = normalizeClubName(name);
  const normalizedId = clubId.trim().toLocaleLowerCase("de-AT");

  const scored = rows
    .map((row) => {
      let score = 0;
      const rowId = row.clubId.trim().toLocaleLowerCase("de-AT");
      const rowName = normalizeClubName(row.clubName);

      if (normalizedId && rowId && normalizedId === rowId) score += 1000;
      if (normalizedName && rowName === normalizedName) score += 500;
      else if (normalizedName && rowName) {
        const wantedTokens = normalizedName.split(" ").filter(Boolean);
        const rowTokens = rowName.split(" ").filter(Boolean);
        const shorter = wantedTokens.length <= rowTokens.length ? wantedTokens : rowTokens;
        const longer = new Set(wantedTokens.length <= rowTokens.length ? rowTokens : wantedTokens);

        if (shorter.length >= 2 && shorter.every((token) => longer.has(token))) {
          score += 200;
        }
      }
      if (row.teamLogoUrl?.trim()) score += 50;
      return { row, score };
    })
    .filter(({ row, score }) => score > 0 && Boolean(row.teamLogoUrl?.trim()))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.row || null;
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

  const standings = useSyncExternalStore(
    subscribeStandingStore,
    getStandingSnapshot,
    getStandingSnapshot,
  );

  const candidates = useMemo(() => {
    const standing = standingLogoFor(standings, name, clubId);
    const effectiveClubId = clubId || standing?.clubId || "";
    const tableLogoUrl = standing?.teamLogoUrl || "";

    const values = [
      localLogoFor(name),
      // Zuerst nur über Vereinsname und Alias auflösen. Damit hat ein Logo aus
      // dem Logo Manager Vorrang vor fehlerhaften Club-IDs und Tabellenlogos.
      getKfvClubLogo(clubs, name),
      getKfvClubLogo(clubs, name, tableLogoUrl, effectiveClubId),
      getKfvClubLogo(clubs, name, url, clubId),
    ].filter(Boolean);

    return values.filter((value, index) => values.indexOf(value) === index);
  }, [clubs, standings, name, url, clubId]);

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