import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type {
  KfvClub,
  KfvMatch,
  KfvMatchStatus,
  KfvMatchReport,
  KfvMatchEvent,
  KfvLineupPlayer,
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


function readLineupPlayers(value: unknown): KfvLineupPlayer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const data = item as Record<string, unknown>;
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name) return null;
      return {
        name,
        number: typeof data.number === "number" ? data.number : null,
        position: typeof data.position === "string" ? data.position : "",
        playerUrl: typeof data.playerUrl === "string" ? data.playerUrl : "",
        captain: data.captain === true,
      } satisfies KfvLineupPlayer;
    })
    .filter((item): item is KfvLineupPlayer => item !== null);
}

function readMatchEvents(value: unknown): KfvMatchEvent[] {
  if (!Array.isArray(value)) return [];
  const validTypes = new Set(["goal", "yellow", "yellowRed", "red", "substitution", "halfTime", "fullTime", "other"]);
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const data = item as Record<string, unknown>;
      const type = typeof data.type === "string" && validTypes.has(data.type) ? data.type as KfvMatchEvent["type"] : "other";
      const team = data.team === "home" || data.team === "away" ? data.team : "neutral";
      return {
        id: typeof data.id === "string" ? data.id : `event-${index}`,
        type,
        minute: typeof data.minute === "number" ? data.minute : null,
        minuteText: typeof data.minuteText === "string" ? data.minuteText : "",
        team,
        playerName: typeof data.playerName === "string" ? data.playerName : "",
        secondaryPlayerName: typeof data.secondaryPlayerName === "string" ? data.secondaryPlayerName : "",
        description: typeof data.description === "string" ? data.description : "",
      } satisfies KfvMatchEvent;
    })
    .filter((item): item is KfvMatchEvent => item !== null)
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
}

function mapMatchReportDocument(
  id: string,
  data: Record<string, unknown>,
): KfvMatchReport {
  return {
    id,
    matchId: typeof data.matchId === "string" ? data.matchId : id,
    matchUid: typeof data.matchUid === "string" ? data.matchUid : "",
    oefbMatchId: typeof data.oefbMatchId === "string" ? data.oefbMatchId : "",
    reportUrl: typeof data.reportUrl === "string" ? data.reportUrl : "",
    homeTeam: typeof data.homeTeam === "string" ? data.homeTeam : "",
    awayTeam: typeof data.awayTeam === "string" ? data.awayTeam : "",
    homeLineup: readLineupPlayers(data.homeLineup),
    awayLineup: readLineupPlayers(data.awayLineup),
    homeBench: readLineupPlayers(data.homeBench),
    awayBench: readLineupPlayers(data.awayBench),
    homeCoach: typeof data.homeCoach === "string" ? data.homeCoach : "",
    awayCoach: typeof data.awayCoach === "string" ? data.awayCoach : "",
    referee: typeof data.referee === "string" ? data.referee : "",
    attendance: typeof data.attendance === "number" ? data.attendance : null,
    events: readMatchEvents(data.events),
    sourceUpdatedAt:
      readNullableDate(data.sourceUpdatedAt) ?? readNullableDate(data.updatedAt),
    active: data.active !== false,
  };
}

export function subscribeKfvMatchReport(
  matchId: string,
  onData: (report: KfvMatchReport | null) => void,
  onError: (message: string) => void,
) {
  if (!matchId) {
    onData(null);
    return () => undefined;
  }

  // Die Berichtsdokument-ID ist nicht immer identisch mit der Match-ID.
  // Deshalb wird über das gespeicherte Feld matchId gesucht.
  const reportQuery = query(
    collection(db, "kfvMatchReports"),
    where("matchId", "==", matchId),
    limit(1),
  );

  return onSnapshot(
    reportQuery,
    (snapshot) => {
      const reportDocument = snapshot.docs[0];
      if (!reportDocument) {
        onData(null);
        return;
      }

      const report = mapMatchReportDocument(
        reportDocument.id,
        reportDocument.data(),
      );
      onData(report.active ? report : null);
    },
    (error) => {
      console.error("Fehler beim Laden des Spielberichts:", error);
      onError("Der offizielle Spielbericht konnte nicht geladen werden.");
    },
  );
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
        best.venueAddress ||= match.venueAddress;
        best.referee ||= match.referee;
        best.liveUrl ||= match.liveUrl;
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
    collection(db, "oefbV12Matches"),
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
            homeClubId: typeof data.homeClubId === "string" ? data.homeClubId : "",
            awayClubId: typeof data.awayClubId === "string" ? data.awayClubId : "",
            homeClubUrl: typeof data.homeClubUrl === "string" ? data.homeClubUrl : "",
            awayClubUrl: typeof data.awayClubUrl === "string" ? data.awayClubUrl : "",
            homeLogoUrl: typeof data.homeLogoUrl === "string" ? data.homeLogoUrl : "",
            awayLogoUrl: typeof data.awayLogoUrl === "string" ? data.awayLogoUrl : "",
            homeScore: typeof data.homeScore === "number" ? data.homeScore : null,
            awayScore: typeof data.awayScore === "number" ? data.awayScore : null,
            kickoffAt: readDate(data.kickoffAt),
            venue: typeof data.venue === "string" ? data.venue : "",
            venueAddress: typeof data.venueAddress === "string" ? data.venueAddress : "",
            referee: typeof data.referee === "string" ? data.referee : "",
            liveUrl: typeof data.liveUrl === "string" ? data.liveUrl : "",
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
    collection(db, "oefbV12Standings"),
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
            clubId: typeof data.clubId === "string" ? data.clubId : "",
            clubUrl: typeof data.clubUrl === "string" ? data.clubUrl : "",
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


export function normalizeKfvTeamId(value: string) {
  const normalized = String(value || "")
    .toLocaleLowerCase("de-AT")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  if (/challenge|reserve|res|kmres|1b/.test(normalized)) return "challenge";
  if (/u17/.test(normalized)) return "u17";
  if (/u12/.test(normalized)) return "u12";
  if (/u10/.test(normalized)) return "u10";
  if (/u08|u8/.test(normalized)) return "u8";
  if (/kampfmannschaft|^km$|senioren/.test(normalized)) return "kampfmannschaft";
  return normalized;
}

export function subscribeKfvSquad(
  teamId: string | null,
  onData: (players: KfvSquadPlayer[]) => void,
  onError: (message: string) => void,
) {
  const wantedTeamId = teamId && teamId !== "all" ? normalizeKfvTeamId(teamId) : "";
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
        .filter((player) => {
          if (!player.active || !player.name) return false;
          if (!wantedTeamId) return true;
          return normalizeKfvTeamId(`${player.teamId} ${player.teamName}`) === wantedTeamId;
        });
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
            clubId: typeof data.clubId === "string" ? data.clubId.trim() : "",
            name,
            normalizedName:
              typeof data.normalizedName === "string" && data.normalizedName.trim()
                ? data.normalizedName.trim()
                : normalizeClubName(name),
            oefbClubId: typeof data.oefbClubId === "string" ? data.oefbClubId.trim() : "",
            pageUrl: typeof data.pageUrl === "string" ? data.pageUrl.trim() : "",
            aliases: Array.isArray(data.aliases) ? data.aliases.filter((value): value is string => typeof value === "string") : [],
            logoUrl: typeof data.logoUrl === "string" ? data.logoUrl.trim() : "",
            logoSource: typeof data.logoSource === "string" ? data.logoSource.trim() : "",
            logoValidated: data.logoValidated === true,
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

function clubSelectionScore(club: KfvClub) {
  let score = 0;
  if (club.logoUrl?.trim()) score += 100;
  if (club.logoValidated) score += 200;
  if (club.logoSource === "manual-kfv-official-override") score += 400;
  if (/^kfv:/i.test(club.clubId || club.id)) score += 60;
  else if (/^oefb:/i.test(club.clubId || club.id)) score += 40;
  if (club.pageUrl?.trim()) score += 20;
  if (/^name:/i.test(club.clubId || club.id)) score -= 80;
  return score;
}

function bestClub(candidates: KfvClub[]) {
  return [...candidates].sort((a, b) => clubSelectionScore(b) - clubSelectionScore(a))[0] || null;
}

export function findKfvClub(clubs: KfvClub[], teamName: string, clubId = "") {
  if (clubId) {
    const normalizedId = clubId.trim().toLocaleLowerCase("de-AT");
    const idCandidates = clubs.filter((club) =>
      [club.clubId, club.oefbClubId, club.id]
        .filter(Boolean)
        .some((value) => value.trim().toLocaleLowerCase("de-AT") === normalizedId),
    );
    const byId = bestClub(idCandidates);
    if (byId) return byId;
  }

  const wantedName = normalizeClubName(teamName);
  if (!wantedName) return null;

  const exactCandidates = clubs.filter((club) => {
    const names = [club.normalizedName, club.name, ...club.aliases]
      .map(normalizeClubName)
      .filter(Boolean);
    return names.includes(wantedName);
  });
  const exactClub = bestClub(exactCandidates);
  if (exactClub) return exactClub;

  const candidates = clubs.filter((club) => {
    const names = [club.normalizedName, club.name, ...club.aliases]
      .map(normalizeClubName)
      .filter(Boolean);
    return names.some((name) =>
      (wantedName.includes(name) || name.includes(wantedName)) &&
      Math.min(name.length, wantedName.length) >= 5,
    );
  });
  return bestClub(candidates);
}

function normalizeLogoUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    url.hash = "";
    // Cache-Parameter dürfen die Erkennung desselben Logos nicht verhindern.
    for (const key of ["v", "ver", "version", "cache", "cb", "t"]) {
      url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "").toLocaleLowerCase("de-AT");
  } catch {
    return value.trim().toLocaleLowerCase("de-AT");
  }
}

function isAinetLogoUrl(clubs: KfvClub[], value: string) {
  const normalized = normalizeLogoUrl(value);
  if (!normalized) return false;
  if (normalized.includes("/tsu-ainet-logo.png")) return true;

  return clubs.some(
    (club) =>
      isTsuAinet(club.name) &&
      Boolean(club.logoUrl) &&
      normalizeLogoUrl(club.logoUrl) === normalized,
  );
}

function isTrustedOfficialLogoUrl(value: string) {
  const url = value.trim();
  return (
    /^https:\/\/kfv-fussball\.at\/oefb2\/images\//i.test(url) ||
    /^https:\/\/vereine\.oefb\.at\/vereine3\/images\/.*(?:200x200|150x150|100x100)\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(url)
  );
}

const OFFICIAL_FRONTEND_LOGOS: Record<string, string> = {
  penk: "https://vereine.oefb.at/vereine3/images/834733022602002384_11d66faa2d824d7dfb89-1,0-200x200.png",
  gitschtal: "https://vereine.oefb.at/vereine3/images/834733022602002384_6d20905242d81e9fe35c-1,0-200x200.png",
  "nussdorf 1b": "https://vereine.oefb.at/vereine3/images/834733022602002384_8818bf255331eea0f5b0-1,0-200x200.png",
  "nussdorf debant": "https://vereine.oefb.at/vereine3/images/834733022602002384_8818bf255331eea0f5b0-1,0-200x200.png",
  "wr nussdorf debant": "https://vereine.oefb.at/vereine3/images/834733022602002384_8818bf255331eea0f5b0-1,0-200x200.png",
  "nussdorf debant rapid lienz u17 b": "https://vereine.oefb.at/vereine3/images/834733022602002384_8818bf255331eea0f5b0-1,0-200x200.png",
};

function officialFrontendLogo(teamName: string) {
  const normalized = normalizeClubName(teamName);
  if (!normalized) return "";
  if (OFFICIAL_FRONTEND_LOGOS[normalized]) return OFFICIAL_FRONTEND_LOGOS[normalized];
  const entries = Object.entries(OFFICIAL_FRONTEND_LOGOS)
    .filter(([key]) => normalized.includes(key) || key.includes(normalized))
    .sort((a, b) => b[0].length - a[0].length);
  return entries[0]?.[1] || "";
}

export function getKfvClubLogo(
  clubs: KfvClub[],
  teamName: string,
  matchLogoUrl = "",
  clubId = "",
) {
  const fixedOfficialLogo = officialFrontendLogo(teamName);
  if (fixedOfficialLogo && !isTsuAinet(teamName)) return fixedOfficialLogo;

  const club = findKfvClub(clubs, teamName, clubId);
  const clubLogo = club?.logoUrl?.trim() || "";
  const sourceLogo = matchLogoUrl.trim();

  if (!isTsuAinet(teamName)) {
    // Zentrale, validierte Club-Logos haben Vorrang. Ungeprüfte ÖFB-Headerbilder
    // aus Spielen werden nicht mehr als Gegnerlogo verwendet.
    if (clubLogo && club?.logoValidated && !isAinetLogoUrl(clubs, clubLogo)) {
      return clubLogo;
    }
    if (sourceLogo && isTrustedOfficialLogoUrl(sourceLogo) && !isAinetLogoUrl(clubs, sourceLogo)) {
      return sourceLogo;
    }
    return "";
  }

  if (clubLogo && club?.logoValidated) return clubLogo;
  if (sourceLogo && isTrustedOfficialLogoUrl(sourceLogo)) return sourceLogo;
  return "/tsu-ainet-logo.png";
}
