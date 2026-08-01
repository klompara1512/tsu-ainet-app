import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  KfvClub,
  KfvMatch,
  KfvMatchStatus,
  KfvStandingRow,
  KfvSquadPlayer,
} from "./kfvTypes";

function readDate(value: unknown): Date {
  return value instanceof Timestamp ? value.toDate() : new Date(0);
}

function readNullableDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

function readStatus(value: unknown): KfvMatchStatus {
  if (
    value === "scheduled" ||
    value === "finished" ||
    value === "postponed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "scheduled";
}

function normalizeMatchPart(value: string) {
  return value
    .toLocaleLowerCase("de-AT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(?:tsu|sg|sv|fc|sc|usv|asko|askö|union|atv)\b/g, " ")
    .replace(/\b(?:1b|ii|reserve|challenge|kampfmannschaft|km)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchDayKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function canonicalTeamBucket(match: KfvMatch) {
  const text = `${match.teamId} ${match.teamName} ${match.competitionName}`
    .toLocaleLowerCase("de-AT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");

  if (/\bu\s*17\b/.test(text)) return "U17";
  if (/\bu\s*12\b/.test(text)) return "U12";
  if (/\bu\s*10\b/.test(text)) return "U10";
  if (/\bu\s*0?8\b/.test(text)) return "U8";
  if (/challenge|reserve|\bres\b|km[-_ ]?res|\b1b\b|\bii\b/.test(text)) {
    return "CHALLENGE";
  }
  return "KM";
}

function deduplicateMatches(matches: KfvMatch[]) {
  const groups = new Map<string, KfvMatch[]>();

  for (const match of matches) {
    const key = [
      canonicalTeamBucket(match),
      matchDayKey(match.kickoffAt),
      normalizeMatchPart(match.homeTeam),
      normalizeMatchPart(match.awayTeam),
    ].join("|");
    const group = groups.get(key) || [];
    group.push(match);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const ranked = [...group].sort((a, b) => {
        const quality = (match: KfvMatch) =>
          (match.status === "finished" ? 50 : 0) +
          (match.homeScore !== null && match.awayScore !== null ? 50 : 0) +
          (match.reportUrl ? 10 : 0) +
          (match.venue ? 5 : 0) +
          (match.homeLogoUrl ? 2 : 0) +
          (match.awayLogoUrl ? 2 : 0);
        return quality(b) - quality(a);
      });
      const best = { ...ranked[0] };

      const timeCounts = new Map<number, number>();
      for (const match of group) {
        const time = match.kickoffAt.getTime();
        timeCounts.set(time, (timeCounts.get(time) || 0) + 1);
      }
      const selectedTime = [...timeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (selectedTime) best.kickoffAt = new Date(selectedTime);

      const scored = ranked.find(
        (match) => match.homeScore !== null && match.awayScore !== null,
      );
      if (scored) {
        best.homeScore = scored.homeScore;
        best.awayScore = scored.awayScore;
        best.status = "finished";
      }

      for (const match of ranked) {
        best.homeLogoUrl ||= match.homeLogoUrl;
        best.awayLogoUrl ||= match.awayLogoUrl;
        best.venue ||= match.venue;
        best.reportUrl ||= match.reportUrl;
      }
      return best;
    })
    .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
}

export function subscribeKfvMatches(
  onData: (matches: KfvMatch[]) => void,
  onError: (message: string) => void,
) {
  const matchesQuery = query(
    collection(db, "kfvMatches"),
    orderBy("kickoffAt", "asc"),
  );

  return onSnapshot(
    matchesQuery,
    (snapshot) => {
      const matches = snapshot.docs
        .map((document) => {
          const data = document.data();
          return {
            id: document.id,
            teamId: typeof data.teamId === "string" ? data.teamId : "",
            teamName: typeof data.teamName === "string" ? data.teamName : "TSU Ainet",
            competitionName:
              typeof data.competitionName === "string" ? data.competitionName : "",
            homeTeam: typeof data.homeTeam === "string" ? data.homeTeam : "",
            awayTeam: typeof data.awayTeam === "string" ? data.awayTeam : "",
            homeLogoUrl: typeof data.homeLogoUrl === "string" ? data.homeLogoUrl : "",
            awayLogoUrl: typeof data.awayLogoUrl === "string" ? data.awayLogoUrl : "",
            homeScore: typeof data.homeScore === "number" ? data.homeScore : null,
            awayScore: typeof data.awayScore === "number" ? data.awayScore : null,
            kickoffAt: readDate(data.kickoffAt),
            venue: typeof data.venue === "string" ? data.venue : "",
            status: readStatus(data.status),
            reportUrl: typeof data.reportUrl === "string" ? data.reportUrl : "",
            sourceUpdatedAt: readNullableDate(data.sourceUpdatedAt),
            active: typeof data.active === "boolean" ? data.active : true,
          } satisfies KfvMatch;
        })
        .filter(
          (match) =>
            match.active &&
            match.kickoffAt.getTime() > 0 &&
            match.homeTeam &&
            match.awayTeam,
        );
      onData(deduplicateMatches(matches));
    },
    (error) => {
      console.error("Fehler beim Laden der KFV-Spiele:", error);
      onError("Die KFV-Spiele konnten nicht geladen werden.");
    },
  );
}

export function subscribeKfvStandings(
  onData: (rows: KfvStandingRow[]) => void,
  onError: (message: string) => void,
) {
  const standingsQuery = query(
    collection(db, "kfvStandings"),
    orderBy("position", "asc"),
  );

  return onSnapshot(
    standingsQuery,
    (snapshot) => {
      const rows = snapshot.docs
        .map((document) => {
          const data = document.data();
          return {
            id: document.id,
            teamId: typeof data.teamId === "string" ? data.teamId : "",
            teamName: typeof data.teamName === "string" ? data.teamName : "TSU Ainet",
            competitionName:
              typeof data.competitionName === "string" ? data.competitionName : "",
            position: typeof data.position === "number" ? data.position : 999,
            clubName: typeof data.clubName === "string" ? data.clubName : "",
            teamLogoUrl: typeof data.teamLogoUrl === "string" ? data.teamLogoUrl : "",
            played: typeof data.played === "number" ? data.played : 0,
            won: typeof data.won === "number" ? data.won : 0,
            drawn: typeof data.drawn === "number" ? data.drawn : 0,
            lost: typeof data.lost === "number" ? data.lost : 0,
            goalsFor: typeof data.goalsFor === "number" ? data.goalsFor : 0,
            goalsAgainst:
              typeof data.goalsAgainst === "number" ? data.goalsAgainst : 0,
            goalDifference:
              typeof data.goalDifference === "number" ? data.goalDifference : 0,
            points: typeof data.points === "number" ? data.points : 0,
            active: typeof data.active === "boolean" ? data.active : true,
          } satisfies KfvStandingRow;
        })
        .filter((row) => row.active && row.clubName);
      onData(rows);
    },
    (error) => {
      console.error("Fehler beim Laden der KFV-Tabelle:", error);
      onError("Die KFV-Tabelle konnte nicht geladen werden.");
    },
  );
}

export function isTsuAinet(name: string) {
  const normalized = name
    .toLocaleLowerCase("de-AT")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Die ÖFB-Daten liefern den Verein je nach Ansicht als
  // „Ainet“, „TSU Ainet“ oder mit einem Mannschaftszusatz.
  return /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/.test(normalized);
}

export function getResultForTsuAinet(match: KfvMatch): "W" | "D" | "L" | null {
  if (
    match.status !== "finished" ||
    match.homeScore === null ||
    match.awayScore === null
  ) {
    return null;
  }

  const tsuIsHome = isTsuAinet(match.homeTeam);
  const own = tsuIsHome ? match.homeScore : match.awayScore;
  const opponent = tsuIsHome ? match.awayScore : match.homeScore;

  if (own > opponent) return "W";
  if (own < opponent) return "L";
  return "D";
}


export function subscribeKfvSquad(
  onData: (players: KfvSquadPlayer[]) => void,
  onError: (message: string) => void,
) {
  const squadQuery = query(collection(db, "kfvSquad"), orderBy("number", "asc"));
  return onSnapshot(
    squadQuery,
    (snapshot) => {
      const players = snapshot.docs
        .map((document) => {
          const data = document.data();
          return {
            id: document.id,
            teamId: typeof data.teamId === "string" ? data.teamId : "kampfmannschaft",
            teamName: typeof data.teamName === "string" ? data.teamName : "Kampfmannschaft",
            name: typeof data.name === "string" ? data.name : "",
            number: typeof data.number === "number" ? data.number : null,
            position: typeof data.position === "string" ? data.position : "Spieler",
            imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : "",
            profileUrl: typeof data.profileUrl === "string" ? data.profileUrl : "",
            birthday: readNullableDate(data.birthday) || (typeof data.birthday === "string" && data.birthday ? new Date(`${data.birthday}T12:00:00`) : null),
            active: typeof data.active === "boolean" ? data.active : true,
          } satisfies KfvSquadPlayer;
        })
        .filter((player) => player.active && player.name);
      onData(players);
    },
    (error) => {
      console.error("Fehler beim Laden des Kaders:", error);
      onError("Der Kader konnte nicht geladen werden.");
    },
  );
}


export function normalizeClubName(name: string) {
  return name
    .toLocaleLowerCase("de-AT")
    .replace(/\b(tsu|spg|fc|sv|usc|union|sektion)\b/g, " ")
    .replace(/ö/g, "oe")
    .replace(/ä/g, "ae")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function subscribeKfvClubs(
  onData: (clubs: KfvClub[]) => void,
  onError?: (message: string) => void,
) {
  const clubsQuery = query(
    collection(db, "kfvClubs"),
    orderBy("name", "asc"),
  );

  return onSnapshot(
    clubsQuery,
    (snapshot) => {
      const clubs = snapshot.docs
        .map((clubDocument) => {
          const data = clubDocument.data();
          const name = typeof data.name === "string" ? data.name.trim() : "";

          return {
            id: clubDocument.id,
            name,
            normalizedName:
              typeof data.normalizedName === "string" && data.normalizedName.trim()
                ? data.normalizedName.trim()
                : normalizeClubName(name),
            logoUrl: typeof data.logoUrl === "string" ? data.logoUrl.trim() : "",
            primaryColor:
              typeof data.primaryColor === "string" ? data.primaryColor : "",
            secondaryColor:
              typeof data.secondaryColor === "string" ? data.secondaryColor : "",
            stadium: typeof data.stadium === "string" ? data.stadium : "",
            website: typeof data.website === "string" ? data.website : "",
            active: typeof data.active === "boolean" ? data.active : true,
          } satisfies KfvClub;
        })
        .filter((club) => club.active && club.name);

      onData(clubs);
    },
    (error) => {
      console.error("Fehler beim Laden der KFV-Vereine:", error);
      onData([]);
      onError?.("Die Vereinslogos konnten nicht geladen werden.");
    },
  );
}

export function findKfvClub(clubs: KfvClub[], teamName: string) {
  const wantedName = normalizeClubName(teamName);
  if (!wantedName) return null;

  const exactClub = clubs.find((club) => {
    const clubName = club.normalizedName || normalizeClubName(club.name);
    return clubName === wantedName;
  });

  if (exactClub) return exactClub;

  const wantedWords = wantedName.split(" ").filter(Boolean);

  return (
    clubs.find((club) => {
      const clubName = club.normalizedName || normalizeClubName(club.name);
      if (!clubName) return false;

      const clubWords = clubName.split(" ").filter(Boolean);
      return (
        wantedName.includes(clubName) ||
        clubName.includes(wantedName) ||
        clubWords.some((word) => word.length >= 4 && wantedWords.includes(word))
      );
    }) || null
  );
}

export function getKfvClubLogo(
  clubs: KfvClub[],
  teamName: string,
  matchLogoUrl = "",
) {
  const club = findKfvClub(clubs, teamName);
  if (club?.logoUrl) return club.logoUrl;
  if (matchLogoUrl.trim()) return matchLogoUrl.trim();
  return "";
}
