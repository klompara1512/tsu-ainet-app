process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const cheerio = require("cheerio");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");

let credentials;
try {
  credentials = JSON.parse(rawCredentials);
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON.");
}

admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();

// Optionale Parser-Felder dürfen einen kompletten Synchronisationslauf nicht abbrechen.
db.settings({ ignoreUndefinedProperties: true });

const CONFIG_PATH = path.resolve(__dirname, "../config/kfv-sync.config.json");

function loadSyncConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!Array.isArray(parsed.teams) || parsed.teams.length === 0) {
      throw new Error("teams fehlt oder ist leer");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Sync-Konfiguration konnte nicht geladen werden (${CONFIG_PATH}): ${error.message || error}`);
  }
}

const SYNC_CONFIG = loadSyncConfig();
const DEFAULT_SOURCE = SYNC_CONFIG.defaultSource;
const TEAM_PAGES = SYNC_CONFIG.teams;
const TEAM_DIRECTORY_URL = SYNC_CONFIG.teamDirectoryUrl;
const SEASON_SLUG = SYNC_CONFIG.season;
const ACTIVE_TEAMS = TEAM_PAGES.filter((team) => team.enabled !== false);
const TEAM_SYNC_SOURCES = ACTIVE_TEAMS.flatMap((team) => [
  { teamKey: team.key, teamName: team.name, kind: "games", url: team.gamesUrl },
  { teamKey: team.key, teamName: team.name, kind: "table", url: team.tableUrl },
]).filter((entry) => entry.url);
const SQUAD_URLS = ACTIVE_TEAMS.map((team) => team.squadUrl).filter(Boolean);
const SQUAD_URL = SQUAD_URLS[0] || `https://vereine.oefb.at/${SYNC_CONFIG.clubSlug}/Mannschaften/Saison-${SEASON_SLUG}/KM/Kader/`;
const RUN_DAILY_TASKS = process.env.RUN_DAILY_TASKS === "true";
// Produktiv werden ausschließlich die offiziellen Spiele-/Tabellenseiten jeder
// einzelnen Mannschaft besucht. Allgemeine Vereinsseiten dürfen keine Tabellen
// oder Spielpläne mehr in den Sync einmischen.
const CLUB_SEED_URLS = Array.isArray(SYNC_CONFIG.clubSeedUrls) ? SYNC_CONFIG.clubSeedUrls.filter(Boolean) : [];
const START_URLS = [
  ...TEAM_SYNC_SOURCES.map((entry) => entry.url),
  // Vereinsseiten werden bewusst mitgeladen: nur dort ist das offizielle Wappen
  // vieler Gegner zuverlässig verfügbar. In V12.0 waren diese URLs konfiguriert,
  // wurden aber nie besucht.
  ...CLUB_SEED_URLS,
  ...(RUN_DAILY_TASKS ? SQUAD_URLS : []),
];
const MAX_PAGES = Number(SYNC_CONFIG.maxPages) || 80;
const SYNC_INTERVAL_MINUTES = Number(SYNC_CONFIG.intervalMinutes) || 30;
const PARSER_VERSION = "13.0.0-club-id-architecture";


const SYNC_WINDOW_PAST_DAYS = 14;
const SYNC_WINDOW_FUTURE_DAYS = 7;
const RUN_DUPLICATE_CLEANUP = process.env.RUN_DUPLICATE_CLEANUP === "true";

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isInActiveSyncWindow(value, now = new Date()) {
  const date = value instanceof admin.firestore.Timestamp ? value.toDate() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const today = startOfLocalDay(now);
  const from = new Date(today); from.setDate(from.getDate() - SYNC_WINDOW_PAST_DAYS);
  const until = new Date(today); until.setDate(until.getDate() + SYNC_WINDOW_FUTURE_DAYS + 1);
  return date >= from && date < until;
}

function cleanCompetitionTitle(value, teamName = "") {
  const text = oneLine(value)
    .replace(/\|.*$/g, "")
    .replace(/(?:Vereinshomepage|Resultate|Tore|Ausschlüsse|Torverteilung).*/i, "")
    .replace(/^.*?\b(?:Tabelle|Tabellen)\b\s*[-|:]?\s*/i, "")
    .trim();
  return canonicalCompetitionName(text, teamName);
}

function isPlausibleStandingRow(row) {
  if (!row || !Number.isInteger(row.position) || row.position < 1 || row.position > 30) return false;
  if (!row.clubName || row.clubName.length < 2 || row.clubName.length > 80) return false;
  const values = [row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.points];
  if (!values.every(Number.isFinite)) return false;
  if (values.some((n) => n < 0)) return false;
  if (row.played !== row.won + row.drawn + row.lost) return false;
  if (row.points > row.played * 3 + 3) return false;
  // Eine bereits gespielte Tabelle mit durchgehend 0:0 ist fast immer eine
  // Vereinsstatistik und keine offizielle Ligatabelle.
  if (row.played > 0 && row.goalsFor === 0 && row.goalsAgainst === 0) return false;
  return true;
}


const MATCH_COLLECTION = "oefbV12Matches";
const STANDING_COLLECTION = "oefbV12Standings";
const DATASET_VERSION = "13.0.0";
const TEAM_HINTS = [
  // Reserve-Bezeichnungen müssen vor Liga-Hinweisen geprüft werden. Sonst wird
  // eine Res-Tabelle wegen „1. Klasse“ fälschlich der Kampfmannschaft zugeordnet.
  ["challenge", "Challenge"], ["reserve", "Challenge"], ["km-res", "Challenge"],
  ["km reserve", "Challenge"], ["1b", "Challenge"], ["ii", "Challenge"],
  ["kampfmannschaft", "Kampfmannschaft"], ["1. klasse", "Kampfmannschaft"],
  ["u17", "U17"], ["u 17", "U17"],
  ["u12", "U12"], ["u 12", "U12"], ["u10", "U10"],
  ["u 10", "U10"], ["u8", "U8"], ["u 8", "U8"],
];

const clean = (value) => String(value ?? "").replace(/\u00a0/g, " ").replace(/[\t\r ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const oneLine = (value) => clean(value).replace(/\s*\n\s*/g, " ");
const lower = (value) => oneLine(value).toLocaleLowerCase("de-AT");
const makeId = (parts) => crypto.createHash("sha256").update(parts.map(oneLine).join("|")).digest("hex").slice(0, 32);
const slug = (value) => lower(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function safeUrl(raw, base = DEFAULT_SOURCE) {
  const url = new URL(raw, base);
  const allowedHost =
    url.hostname === "oefb.at" || url.hostname.endsWith(".oefb.at") ||
    url.hostname === "kfv-fussball.at" || url.hostname.endsWith(".kfv-fussball.at");
  if (url.protocol !== "https:" || !allowedHost) {
    throw new Error("Nur öffentliche ÖFB-/KFV-HTTPS-URLs sind erlaubt.");
  }
  url.hash = "";
  return url.toString();
}

function safeImageUrl(raw, base = DEFAULT_SOURCE) {
  if (!raw) return "";
  try {
    const url = new URL(String(raw), base);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}


function clubKey(value) {
  return lower(value)
    // Kein optionales Präfix: die frühere Regex konnte auch leere Treffer bilden
    // und dadurch Clubnamen unzuverlässig normalisieren.
    .replace(/\b(?:tsu|sg|sv|fc|sc|usv|askö|asko|union|atv)\b/g, " ")
    .replace(/\b(?:1b|ii|reserve|challenge|kampfmannschaft|km)\b/g, " ")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clubAliases(value) {
  const exact = lower(value).replace(/[^a-z0-9äöüß]+/g, " ").replace(/\s+/g, " ").trim();
  const reduced = clubKey(value);
  return [...new Set([exact, reduced].filter(Boolean))];
}

function chooseClubLogo(profileMap, clubName) {
  for (const alias of clubAliases(clubName)) {
    const profile = profileMap.get(alias);
    if (profile?.logoUrl) return profile.logoUrl;
  }
  return "";
}

function isAinetClubName(value) {
  const key = clubKey(value);
  return key === "ainet" || key.startsWith("ainet ");
}

function logoFingerprint(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    url.hash = "";
    for (const key of ["v", "ver", "version", "cache", "cb", "t"]) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return String(value).trim().toLowerCase();
  }
}

function extractClubIdentity(rawUrl, fallbackName = "") {
  let pageUrl = "";
  let clubId = "";
  try {
    const parsed = new URL(String(rawUrl || ""), DEFAULT_SOURCE);
    if (parsed.protocol === "https:") pageUrl = parsed.toString();
    const kfvId = parsed.pathname.match(/\/Verein\/(\d+)/i)?.[1];
    if (kfvId) clubId = `kfv:${kfvId}`;
    if (!clubId && /vereine\.oefb\.at$/i.test(parsed.hostname)) {
      const slugValue = decodeURIComponent(parsed.pathname).split("/").filter(Boolean)[0] || "";
      if (slugValue && !/^Mannschaften$/i.test(slugValue)) clubId = `oefb:${slug(slugValue)}`;
    }
  } catch { /* ignore */ }
  if (!clubId && fallbackName) clubId = `name:${clubKey(fallbackName) || slug(fallbackName)}`;
  return { clubId, pageUrl };
}

function chooseClubProfile(profileMap, profileIdMap, clubName, clubId = "") {
  if (clubId && profileIdMap.has(clubId)) return profileIdMap.get(clubId);
  for (const alias of clubAliases(clubName)) {
    const profile = profileMap.get(alias);
    if (profile) return profile;
  }
  return null;
}

function sourceDescriptor(sourceUrl) {
  const normalized = String(sourceUrl || "").replace(/\/$/, "");
  for (const source of TEAM_SYNC_SOURCES) {
    if (normalized === String(source.url || "").replace(/\/$/, "")) return source;
  }
  for (const team of ACTIVE_TEAMS) {
    if (normalized === String(team.squadUrl || "").replace(/\/$/, "")) {
      return { teamKey: team.key, teamName: team.name, kind: "squad", url: team.squadUrl };
    }
  }
  const path = (() => { try { return decodeURIComponent(new URL(sourceUrl).pathname); } catch { return ""; } })();
  const team = ACTIVE_TEAMS.find((entry) => (entry.slugs || []).some((slugName) => path.toLowerCase().includes(`/${String(slugName).toLowerCase()}/`)));
  const isConfiguredClubSeed = CLUB_SEED_URLS.some((url) => String(url).replace(/\/$/, "") === String(sourceUrl).replace(/\/$/, ""));
  const kind = /\/Tabellen\/?$/i.test(path) ? "table" : /\/Spiele\/?$/i.test(path) ? "games" : /\/Kader\/?$/i.test(path) ? "squad" : /\/Spielbericht\//i.test(path) ? "report" : isConfiguredClubSeed || /\/Verein\/\d+/i.test(path) ? "club" : "other";
  return team ? { teamKey: team.key, teamName: team.name, kind, url: sourceUrl } : { teamKey: "", teamName: "", kind, url: sourceUrl };
}

function teamFromUrl(sourceUrl) {
  const path = decodeURIComponent(new URL(sourceUrl).pathname).toLowerCase();
  for (const team of TEAM_PAGES) {
    if (team.slugs.some((slugName) => path.includes(`/${slugName.toLowerCase()}/`))) {
      return { teamKey: team.key, teamName: team.name };
    }
  }
  return null;
}

function seasonFromUrl(sourceUrl) {
  const match = String(sourceUrl).match(/Saison-(\d{4})-(\d{2})/i);
  return match ? `${match[1]}/${match[2]}` : "2026/27";
}

function teamFromText(text) {
  const value = lower(text);

  // „Res“ ist auf der ÖFB-Seite die Kurzform der Reserve/Challenge. Die Prüfung
  // erfolgt absichtlich vor „1. Klasse“, da beides im selben Tabellenkopf stehen kann.
  if (/(^|[^a-z0-9])res(?:\.|erve)?([^a-z0-9]|$)/i.test(value)) return "Challenge";

  return TEAM_HINTS.find(([hint]) => value.includes(hint))?.[1] || "Kampfmannschaft";
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const match = oneLine(value).replace(/\./g, "").match(/-?\d+/);
  return match ? Number(match[0]) : null;
}


function seasonYearsFromUrl(sourceUrl) {
  const match = String(sourceUrl || "").match(/Saison-(\d{4})-(\d{2})/i);
  if (!match) {
    const year = new Date().getFullYear();
    return { start: year, end: year + 1 };
  }
  const start = Number(match[1]);
  return { start, end: start + 1 };
}

function inferSeasonYear(monthNumber, sourceUrl) {
  const years = seasonYearsFromUrl(sourceUrl);
  // Eine österreichische Fußballsaison startet im Sommer. Juli–Dezember gehören
  // zum Startjahr, Jänner–Juni zum Folgejahr.
  return monthNumber >= 7 ? years.start : years.end;
}

function parseDate(value, fallbackYear = new Date().getFullYear(), sourceUrl = "") {
  const text = oneLine(value);

  // Aktuelle ÖFB-Spielseiten zeigen häufig nur „So., 2.8., 17:00“ ohne Jahr.
  // Das Jahr wird deshalb aus der Saison-URL abgeleitet.
  let shortMatch = text.match(/(?:\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?[,]?\s*)?(\d{1,2})\.(\d{1,2})\.?[,]?\s+(\d{1,2})[:.](\d{2})(?:\s*Uhr)?/i);
  if (shortMatch) {
    const month = Number(shortMatch[2]);
    const year = sourceUrl ? inferSeasonYear(month, sourceUrl) : fallbackYear;
    const date = new Date(year, month - 1, Number(shortMatch[1]), Number(shortMatch[3]), Number(shortMatch[4]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  let match = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})(?:\D{0,20}(\d{1,2})[:.](\d{2}))?/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const months = {
    jan: 0, januar: 0, feb: 1, februar: 1, mär: 2, maerz: 2, märz: 2,
    apr: 3, april: 3, mai: 4, jun: 5, juni: 5, jul: 6, juli: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, okt: 9, oktober: 9,
    nov: 10, november: 10, dez: 11, dezember: 11,
  };
  match = lower(text).match(/(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)?[,]?\s*(\d{1,2})[.]?\s*(jan(?:uar)?|feb(?:ruar)?|märz?|maerz|apr(?:il)?|mai|juni?|juli?|aug(?:ust)?|sept?(?:ember)?|okt(?:ober)?|nov(?:ember)?|dez(?:ember)?)[.]?\s*(\d{4})?(?:\D{0,25}(\d{1,2})[:.](\d{2}))?/i);
  if (!match) return null;
  const month = months[match[2].replace(/\.$/, "")];
  if (month === undefined) return null;
  const year = Number(match[3] || fallbackYear);
  const date = new Date(year, month, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseScore(value) {
  const text = oneLine(value);
  const match = text.match(/(?:^|\s|\|)(\d{1,2})\s*:\s*(\d{1,2})(?:\s|$|\||\()/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

function extractGameId(...values) {
  for (const value of values) {
    if (!value) continue;
    const text = String(value);
    const id =
      text.match(/[?&](?::s|s)=(\d{5,})/i)?.[1] ||
      text.match(/(?:Spielbericht|Spiel|Match)\/?[^?#]*?(\d{5,})/i)?.[1];
    if (id) return id;
  }
  return "";
}

function normalizeMatchStatus(rawStatus, context, hasScore) {
  const text = lower(`${rawStatus || ""} ${context || ""}`);
  if (/abgesagt|annulliert|cancelled|canceled|nicht ausgetragen/.test(text)) return "cancelled";
  if (/verschoben|postponed|verlegt/.test(text)) return "postponed";
  if (hasScore || /endstand|beendet|spielende|full[ -]?time|finished|abpfiff/.test(text)) return "finished";
  return "scheduled";
}

function canonicalCompetitionName(value, teamName = "") {
  const text = oneLine(value);
  const normalizedTeam = oneLine(teamName);

  // Seitentitel wie „Spiele - Res - Saison 2026/27 - Mannschaften“ sind
  // keine Bewerbsnamen und dürfen keine eigenen Spieldatensätze erzeugen.
  if (!text || /\b(?:spiele|mannschaften|saison|kader|tabellen)\b.*\b(?:mannschaften|saison)\b/i.test(text)) {
    if (normalizedTeam === "Challenge") return "Challenge 1. Klasse West";
    if (normalizedTeam === "Kampfmannschaft") return "1. Klasse West";
    return normalizedTeam || "ÖFB";
  }

  if (normalizedTeam === "Challenge" && /(?:1\.?\s*klasse|liga|öfb|res|challenge)/i.test(text)) {
    return "Challenge 1. Klasse West";
  }
  if (normalizedTeam === "Kampfmannschaft" && /(?:1\.?\s*klasse|liga|öfb|kampfmannschaft|km)/i.test(text)) {
    return "1. Klasse West";
  }
  return text;
}

function localDateKey(value) {
  const date = value instanceof admin.firestore.Timestamp ? value.toDate() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function canonicalTeamBucket(item) {
  const text = lower(`${item.teamKey || ""} ${item.teamId || ""} ${item.teamName || ""} ${item.competitionName || ""}`);
  if (/\bu\s*17\b/.test(text)) return "U17";
  if (/\bu\s*12\b/.test(text)) return "U12";
  if (/\bu\s*10\b/.test(text)) return "U10";
  if (/\bu\s*0?8\b/.test(text)) return "U8";
  if (/challenge|reserve|(?:^|[^a-z0-9])res(?:[^a-z0-9]|$)|km[-_ ]?res|(?:^|[^a-z0-9])1b(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])ii(?:[^a-z0-9]|$)/.test(text)) {
    return "CHALLENGE";
  }
  return "KM";
}

function canonicalMatchKey(item) {
  return [
    canonicalTeamBucket(item),
    oneLine(item.season),
    localDateKey(item.kickoffAt),
    clubKey(item.homeTeam) || slug(item.homeTeam),
    clubKey(item.awayTeam) || slug(item.awayTeam),
  ].join("|");
}

function canonicalCompetitionBucket(item) {
  const text = lower(`${item.competitionType || ""} ${item.competitionName || ""}`);
  if (/cup|pokal/.test(text)) return "CUP";
  if (/test|freund/.test(text)) return "FRIENDLY";
  return "LEAGUE";
}

// Stabile Identität eines Spiels. Die offizielle ÖFB-Spiel-ID hat immer Vorrang.
// Für Ligaspiele bleibt der Fallback auch bei Datum-, Uhrzeit- oder Spielortänderungen
// identisch. Freundschafts- und Cupspiele erhalten zusätzlich das Datum, weil dieselbe
// Paarung dort mehrmals in einer Saison vorkommen kann.
function buildMatchUid(item) {
  const officialId = oneLine(item.gameId || item.oefbMatchId || "");
  if (officialId) return `oefb:${officialId}`;

  const competitionBucket = canonicalCompetitionBucket(item);
  const parts = [
    "fixture",
    canonicalTeamBucket(item),
    oneLine(item.season),
    competitionBucket,
    clubKey(item.homeTeam) || slug(item.homeTeam),
    clubKey(item.awayTeam) || slug(item.awayTeam),
  ];

  if (competitionBucket !== "LEAGUE") parts.push(localDateKey(item.kickoffAt));
  return parts.join("|");
}

function matchDocumentId(item) {
  return makeId(["kfv-match-uid-v11", buildMatchUid(item)]);
}

function matchQuality(item) {
  let score = 0;
  if (item.gameId) score += 100;
  if (Number.isInteger(item.homeScore) && Number.isInteger(item.awayScore)) score += 80;
  if (item.status === "finished") score += 30;
  if (item.status === "cancelled" || item.status === "postponed") score += 25;
  if (item.reportUrl && /(?:Spielbericht|\/Spiel\/|\/Match\/|[?&](?:s|:s)=\d+)/i.test(item.reportUrl)) score += 20;
  if (item.venue) score += 8;
  if (item.homeLogoUrl) score += 4;
  if (item.awayLogoUrl) score += 4;
  if (item.competitionName && !/spiele|mannschaften|saison|öfb/i.test(item.competitionName)) score += 6;
  return score;
}

function mergeDuplicateMatches(group) {
  const sorted = [...group].sort((a, b) => matchQuality(b) - matchQuality(a));
  const best = { ...sorted[0] };

  // Bei mehrfach gelesenen Uhrzeiten wird der am häufigsten erkannte Zeitpunkt
  // verwendet. So gewinnt z. B. 14:45 bei drei Treffern gegen einen Fehlwert 16:45.
  const kickoffCounts = new Map();
  for (const item of group) {
    const millis = item.kickoffAt?.toMillis?.() ?? item.kickoffAt?.getTime?.();
    if (!Number.isFinite(millis)) continue;
    kickoffCounts.set(millis, (kickoffCounts.get(millis) || 0) + 1);
  }
  const chosenKickoff = [...kickoffCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  if (Number.isFinite(chosenKickoff)) {
    best.kickoffAt = admin.firestore.Timestamp.fromMillis(chosenKickoff);
  }

  const scored = sorted.find((item) => Number.isInteger(item.homeScore) && Number.isInteger(item.awayScore));
  const terminalStatus = sorted.find((item) => item.status === "cancelled" || item.status === "postponed");
  if (terminalStatus) {
    best.status = terminalStatus.status;
    best.homeScore = null;
    best.awayScore = null;
    best.resultText = "";
  } else if (scored) {
    best.status = "finished";
    best.homeScore = scored.homeScore;
    best.awayScore = scored.awayScore;
    best.resultText = scored.resultText || `${scored.homeScore}:${scored.awayScore}`;
  }

  for (const item of sorted) {
    best.gameId ||= item.gameId || "";
    best.homeClubId ||= item.homeClubId || "";
    best.awayClubId ||= item.awayClubId || "";
    best.homeClubUrl ||= item.homeClubUrl || "";
    best.awayClubUrl ||= item.awayClubUrl || "";
    best.venue ||= item.venue || "";
    best.homeLogoUrl ||= item.homeLogoUrl || "";
    best.awayLogoUrl ||= item.awayLogoUrl || "";
    best.reportUrl ||= item.reportUrl || "";
  }

  best.competitionName = canonicalCompetitionName(best.competitionName, best.teamName);
  const canonicalKey = canonicalMatchKey(best);
  best.canonicalKey = canonicalKey;
  best.matchUid = buildMatchUid(best);
  best.oefbMatchId = best.gameId || best.oefbMatchId || "";
  best.id = matchDocumentId(best);
  best.duplicateSources = group.length;
  return best;
}

function removeUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map(removeUndefinedDeep).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = removeUndefinedDeep(item);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  return value;
}

async function fetchResource(url) {
  const safe = safeUrl(url);
  const response = await fetch(safe, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
      "accept-language": "de-AT,de;q=0.9,en;q=0.5",
      "cache-control": "no-cache",
      referer: DEFAULT_SOURCE,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`KFV HTTP ${response.status} bei ${safe}`);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const text = await response.text();
  if (text.length < 20) throw new Error("KFV-Antwort ist unerwartet kurz.");
  return { text, contentType, finalUrl: safeUrl(response.url || safe) };
}


function officialReportUrl(rawUrl, sourceUrl, homeTeam, awayTeam) {
  const candidates = [rawUrl, sourceUrl].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = new URL(String(candidate), sourceUrl || DEFAULT_SOURCE);
      const gameId =
        parsed.searchParams.get(":s") ||
        parsed.searchParams.get("s") ||
        String(candidate).match(/[?&](?::s|s)=(\d+)/i)?.[1] ||
        String(candidate).match(/(?:Spielbericht|Spiel)\/?.*?(\d{5,})/i)?.[1];
      if (!gameId) continue;
      const label = `${slug(homeTeam) || "heim"}-vs-${slug(awayTeam) || "gast"}`;
      return `https://vereine.oefb.at/TsuAinet/Spielbericht/?${label}&:s=${encodeURIComponent(gameId)}`;
    } catch { /* ignore malformed URL */ }
  }
  return "";
}

function addSquadPlayer(target, data, sourceUrl) {
  const name = oneLine(data.name);
  if (!name || name.length < 3 || name.length > 90) return;
  const profileUrl = data.profileUrl ? safeUrl(data.profileUrl, sourceUrl) : "";
  const number = parseNumber(data.number);
  const positionText = oneLine(data.position);
  const position =
    /tor|goalkeeper/i.test(positionText) ? "Tor" :
    /abwehr|verteid|defen/i.test(positionText) ? "Abwehr" :
    /mittel|midfield/i.test(positionText) ? "Mittelfeld" :
    /sturm|angriff|forward/i.test(positionText) ? "Sturm" :
    positionText || "Spieler";
  const urlTeam = teamFromUrl(sourceUrl) || { teamKey: "KM", teamName: "Kampfmannschaft" };
  target.push({
    id: makeId(["kfv-squad", urlTeam.teamKey, profileUrl || name]),
    teamId: slug(urlTeam.teamName),
    teamKey: urlTeam.teamKey,
    teamName: urlTeam.teamName,
    season: seasonFromUrl(sourceUrl),
    name,
    number: Number.isInteger(number) ? number : null,
    position,
    imageUrl: safeImageUrl(data.imageUrl, sourceUrl),
    profileUrl,
    active: true,
    source: "oefb-public",
    sourceUrl,
  });
}

function extractVenueFromContext(context) {
  const text = oneLine(context);
  const match = text.match(/\b((?:Sportplatz|Stadion|Arena|Kunstrasen|Fußballplatz|Fussballplatz)\s+[A-Za-zÄÖÜäöüß0-9 .\-\/]{2,80})/i);
  return match ? oneLine(match[1]).replace(/\s+(?:Schiedsrichter|Spielbericht|Ticker|Livestream).*$/i, "") : "";
}

function extractRefereeFromContext(context) {
  const text = oneLine(context);
  const match = text.match(/(?:Schiedsrichter(?:in)?|Referee|SR)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß .\-]{3,80})/i);
  return match ? oneLine(match[1]).replace(/\s+(?:Assistent|Spielort|Sportplatz|Stadion|Spielbericht|Ticker).*$/i, "") : "";
}

function classifyOfficialLinks(rawUrl, sourceUrl) {
  const url = rawUrl ? safeUrl(rawUrl, sourceUrl) : "";
  if (!url) return { reportUrl: "", liveUrl: "" };
  const isLive = /ticker|live|livestream|liveticker/i.test(url);
  return { reportUrl: url, liveUrl: isLive ? url : "" };
}

function addMatch(target, data, sourceUrl, context = "") {
  const kickoff = data.kickoff instanceof Date
    ? data.kickoff
    : parseDate(data.kickoff || context, new Date().getFullYear(), sourceUrl);

  const normalizeAinetName = (value) => {
    const cleaned = oneLine(value).replace(/^[-|: ]+|[-|: ]+$/g, "");
    return /^(?:tsu\s+)?ainet(?:\s+(?:1b|ii|reserve|challenge))?$/i.test(cleaned)
      ? cleaned.replace(/^ainet$/i, "TSU Ainet")
      : cleaned;
  };

  const homeTeam = normalizeAinetName(data.homeTeam);
  const awayTeam = normalizeAinetName(data.awayTeam);
  if (!kickoff || homeTeam.length < 2 || awayTeam.length < 2 || homeTeam === awayTeam) return;
  if (!lower(`${homeTeam} ${awayTeam}`).includes("ainet")) return;

  const [parsedHomeScore, parsedAwayScore] = parseScore(data.score || "");
  let homeScore = Number.isInteger(data.homeScore) ? data.homeScore : parsedHomeScore;
  let awayScore = Number.isInteger(data.awayScore) ? data.awayScore : parsedAwayScore;

  // Anstoßzeiten dürfen niemals als Endstand gespeichert werden.
  if (homeScore === kickoff.getHours() && awayScore === kickoff.getMinutes()) {
    homeScore = null;
    awayScore = null;
  }

  const urlTeam = teamFromUrl(sourceUrl);
  const teamName = urlTeam?.teamName || data.teamName || teamFromText(`${data.competitionName || ""} ${context}`);
  const teamKey = urlTeam?.teamKey || data.teamKey || slug(teamName).toUpperCase();
  const season = seasonFromUrl(sourceUrl);
  const hasScore = Number.isInteger(homeScore) && Number.isInteger(awayScore);
  const status = normalizeMatchStatus(data.status, context, hasScore);

  // Abgesagte oder verschobene Spiele dürfen keinen alten Endstand behalten.
  if (status === "cancelled" || status === "postponed") {
    homeScore = null;
    awayScore = null;
  }

  const reportUrl = officialReportUrl(data.reportUrl, sourceUrl, homeTeam, awayTeam);
  const links = classifyOfficialLinks(data.liveUrl || reportUrl, sourceUrl);
  const gameId = extractGameId(data.reportUrl, reportUrl, context);
  const venue = oneLine(data.venue) || extractVenueFromContext(context);
  const venueAddress = oneLine(data.venueAddress);
  const referee = oneLine(data.referee) || extractRefereeFromContext(context);
  const competitionName = canonicalCompetitionName(data.competitionName, teamName);
  const preliminaryKey = [
    teamKey,
    season,
    localDateKey(kickoff),
    clubKey(homeTeam) || slug(homeTeam),
    clubKey(awayTeam) || slug(awayTeam),
  ].join("|");

  const matchIdentity = {
    gameId,
    teamKey,
    teamId: slug(teamName),
    teamName,
    season,
    competitionType: /cup|pokal/i.test(data.competitionName || context)
      ? "Cup"
      : /test|freund/i.test(data.competitionName || context)
        ? "Freundschaftsspiel"
        : "Liga",
    competitionName,
    homeTeam,
    awayTeam,
    kickoffAt: admin.firestore.Timestamp.fromDate(kickoff),
  };
  const matchUid = buildMatchUid(matchIdentity);
  const homeIdentity = extractClubIdentity(data.homeClubUrl, homeTeam);
  const awayIdentity = extractClubIdentity(data.awayClubUrl, awayTeam);

  target.push({
    id: matchDocumentId(matchIdentity),
    matchUid,
    oefbMatchId: gameId,
    canonicalKey: preliminaryKey,
    gameId,
    teamId: slug(teamName), teamKey, teamName,
    season,
    competitionType: /cup|pokal/i.test(data.competitionName || context)
      ? "Cup"
      : /test|freund/i.test(data.competitionName || context)
        ? "Freundschaftsspiel"
        : "Liga",
    isHomeGame: /ainet/i.test(homeTeam),
    competitionName,
    homeTeam, awayTeam,
    homeClubId: oneLine(data.homeClubId) || homeIdentity.clubId,
    awayClubId: oneLine(data.awayClubId) || awayIdentity.clubId,
    homeClubUrl: homeIdentity.pageUrl,
    awayClubUrl: awayIdentity.pageUrl,
    homeLogoUrl: safeImageUrl(data.homeLogoUrl, sourceUrl),
    awayLogoUrl: safeImageUrl(data.awayLogoUrl, sourceUrl),
    homeScore, awayScore,
    resultText: homeScore !== null && awayScore !== null ? `${homeScore}:${awayScore}` : "",
    kickoffAt: admin.firestore.Timestamp.fromDate(kickoff),
    venue,
    venueAddress,
    referee,
    liveUrl: data.liveUrl ? safeUrl(data.liveUrl, sourceUrl) : links.liveUrl,
    status,
    reportUrl,
    active: true, source: "oefb-public", sourceUrl,
  });
}

function addStanding(target, data, sourceUrl) {
  const position = parseNumber(data.position);
  const clubName = oneLine(data.clubName);
  if (!position || !clubName || position > 100) return;
  const urlTeam = teamFromUrl(sourceUrl);
  const teamName = urlTeam?.teamName || data.teamName || teamFromText(data.competitionName || "") || "Kampfmannschaft";
  const teamKey = urlTeam?.teamKey || data.teamKey || slug(teamName).toUpperCase();
  target.push({
    id: makeId(["kfv-standing", teamKey, data.competitionName || "ÖFB", clubName]),
    teamId: slug(teamName), teamKey, teamName,
    season: seasonFromUrl(sourceUrl),
    competitionName: cleanCompetitionTitle(data.competitionName, teamName) || "ÖFB",
    position, clubName,
    clubId: oneLine(data.clubId) || extractClubIdentity(data.clubUrl, clubName).clubId,
    clubUrl: extractClubIdentity(data.clubUrl, clubName).pageUrl,
    teamLogoUrl: safeImageUrl(data.teamLogoUrl, sourceUrl),
    played: parseNumber(data.played) || 0,
    won: parseNumber(data.won) || 0,
    drawn: parseNumber(data.drawn) || 0,
    lost: parseNumber(data.lost) || 0,
    goalsFor: parseNumber(data.goalsFor) || 0,
    goalsAgainst: parseNumber(data.goalsAgainst) || 0,
    goalDifference: parseNumber(data.goalDifference) || 0,
    points: parseNumber(data.points) || 0,
    active: true, source: "oefb-public", sourceUrl,
  });
}

function valueFromObject(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  return value.name || value.title || value.label || value.clubName || value.teamName || value.value || "";
}

function parseJsonObjects(value, matches, standings, urls, sourceUrl, context = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) parseJsonObjects(item, matches, standings, urls, sourceUrl, context);
    return;
  }

  const keys = Object.keys(value);
  const lookup = (patterns) => {
    const key = keys.find((candidate) => patterns.some((pattern) => pattern.test(candidate)));
    return key ? value[key] : undefined;
  };

  for (const candidate of Object.values(value)) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
      try { urls.add(safeUrl(candidate, sourceUrl)); } catch { /* ignore */ }
    }
  }

  const homeTeam = lookup([/^home(team|club|name)?$/i, /heim.*(team|verein|name)/i, /^team1$/i]);
  const awayTeam = lookup([/^away(team|club|name)?$/i, /gast.*(team|verein|name)/i, /^team2$/i]);
  const kickoff = lookup([/kickoff/i, /^date(time)?$/i, /spiel.*datum/i, /beginn/i, /start.*date/i]);
  if (homeTeam && awayTeam && kickoff) {
    addMatch(matches, {
      homeTeam: valueFromObject(homeTeam), awayTeam: valueFromObject(awayTeam), kickoff,
      homeScore: parseNumber(lookup([/home.*score/i, /heim.*tor/i, /^score1$/i])),
      awayScore: parseNumber(lookup([/away.*score/i, /gast.*tor/i, /^score2$/i])),
      competitionName: valueFromObject(lookup([/competition/i, /bewerb/i, /liga/i, /league/i])),
      venue: valueFromObject(lookup([/venue/i, /stadion/i, /sportplatz/i, /location/i])),
      venueAddress: valueFromObject(lookup([/address/i, /adresse/i])),
      referee: valueFromObject(lookup([/referee/i, /schiedsrichter/i])),
      liveUrl: valueFromObject(lookup([/live.*url/i, /ticker.*url/i, /livestream/i])),
      reportUrl: valueFromObject(lookup([/report.*url/i, /detail.*url/i, /^url$/i, /^link$/i])),
      status: valueFromObject(lookup([/^status$/i, /matchstatus/i])),
    }, sourceUrl, context);
  }

  const position = lookup([/^position$/i, /^rank$/i, /^platz$/i]);
  const clubName = lookup([/^club(name)?$/i, /^team(name)?$/i, /^verein$/i]);
  const points = lookup([/^points$/i, /^punkte$/i, /^pts$/i]);
  if (position && clubName && points !== undefined) {
    addStanding(standings, {
      position, clubName: valueFromObject(clubName), points,
      played: lookup([/played/i, /spiele/i, /^matches$/i]),
      won: lookup([/^won$/i, /siege/i]), drawn: lookup([/draw/i, /unentschieden/i]),
      lost: lookup([/lost/i, /niederlage/i]), goalsFor: lookup([/goalsfor/i, /tore.*plus/i]),
      goalsAgainst: lookup([/goalsagainst/i, /tore.*minus/i]), goalDifference: lookup([/difference/i, /differenz/i]),
      competitionName: valueFromObject(lookup([/competition/i, /bewerb/i, /liga/i, /league/i])),
      teamName: teamFromText(context),
    }, sourceUrl);
  }

  for (const child of Object.values(value)) parseJsonObjects(child, matches, standings, urls, sourceUrl, context);
}

function extractJsonCandidates(html) {
  const candidates = [];
  const $ = cheerio.load(html);
  $("script").each((_, element) => {
    const text = ($(element).html() || "").trim();
    if (!text) return;
    if (text.startsWith("{") || text.startsWith("[")) candidates.push(text);

    const assignments = [
      /(?:window\.__INITIAL_STATE__|window\.__DATA__|__NEXT_DATA__)\s*=\s*({[\s\S]*?});?\s*$/,
      /(?:initialState|pageData|model)\s*[:=]\s*({[\s\S]*?})\s*;?$/,
    ];
    for (const pattern of assignments) {
      const match = text.match(pattern);
      if (match) candidates.push(match[1]);
    }
  });
  return candidates;
}

function extractCandidateUrls(html, sourceUrl) {
  const urls = new Set([sourceUrl]);
  const $ = cheerio.load(html);

  $("a[href], script[src], link[href], iframe[src], [data-url], [data-endpoint], [data-api]").each((_, element) => {
    for (const attr of ["href", "src", "data-url", "data-endpoint", "data-api"]) {
      const raw = $(element).attr(attr);
      if (!raw) continue;
      const descriptor = `${raw} ${$(element).text()}`;
      if (!/(verein|mannschaft|bewerb|tabelle|spiel|match|fixture|result|competition|team|api|widget|calendar)/i.test(descriptor)) continue;
      try { urls.add(safeUrl(raw, sourceUrl)); } catch { /* ignore */ }
    }
  });

  const decoded = html.replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const urlPatterns = [
    /https:\/\/(?:www\.)?kfv-fussball\.at[^"'<>\s\\]+/gi,
    /["'](\/(?:kfv|api|netzwerk)[^"']*(?:verein|mannschaft|bewerb|tabelle|spiel|match|fixture|team|competition)[^"']*)["']/gi,
  ];
  for (const pattern of urlPatterns) {
    for (const match of decoded.matchAll(pattern)) {
      const raw = match[1] || match[0];
      try { urls.add(safeUrl(raw, sourceUrl)); } catch { /* ignore */ }
    }
  }

  return urls;
}


function stripTrailingMatchMeta(value) {
  return oneLine(value)
    .replace(/\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?\s*$/i, "")
    .replace(/\b(?:Spielbericht|Livestream|Ticker|Details|Vorschau)\b.*$/i, "")
    .replace(/\s+(?:Sportplatz|Stadion|Arena|Kunstrasen)\b.*$/i, "")
    .replace(/^[-–—|: ]+|[-–—|: ]+$/g, "")
    .trim();
}

function splitCompetitionAndTeam(value, pageTitle = "ÖFB") {
  const text = oneLine(value);
  const knownCompetition = text.match(/^(.*?\b(?:Testspiel|Freundschaftsspiel|Cup|Landescup|ÖFB[- ]?Cup|\d+\.?\s*Klasse(?:\s+[A-Za-zÄÖÜäöü-]+)?|Gebietsliga(?:\s+[A-Za-zÄÖÜäöü-]+)?|Unterliga(?:\s+[A-Za-zÄÖÜäöü-]+)?|Regionalliga(?:\s+[A-Za-zÄÖÜäöü-]+)?|Bundesliga|Challenge))\s+(.+)$/i);
  if (knownCompetition) {
    return { competitionName: knownCompetition[1], team: knownCompetition[2] };
  }
  return { competitionName: pageTitle || "ÖFB", team: text };
}

function parseCompactVisibleMatches(text, matches, sourceUrl, title) {
  const normalized = oneLine(text)
    .replace(/(\d)\s*:\s*(\d)/g, "$1:$2")
    .replace(/\s+/g, " ");

  const starts = [...normalized.matchAll(/(?:\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?\s*)?\b\d{1,2}\.\d{1,2}\.\s+\d{1,2}:\d{2}\b/gi)];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index;
    const end = starts[i + 1]?.index ?? normalized.length;
    const block = normalized.slice(start, Math.min(end, start + 500)).trim();
    if (!/\bainet\b/i.test(block)) continue;

    const dateTime = block.match(/(\d{1,2})\.(\d{1,2})\.\s+(\d{1,2}):(\d{2})/);
    if (!dateTime) continue;

    const kickoff = parseDate(`${dateTime[1]}.${dateTime[2]}.${new Date().getFullYear()} ${dateTime[3]}:${dateTime[4]}`);
    if (!kickoff) continue;

    // Wichtig: Erst NACH Datum und Anstoßzeit nach einem Ergebnis suchen.
    // Sonst wird z. B. die Anstoßzeit 19:00 fälschlich als Ergebnis 19:0 erkannt.
    const afterDate = block.slice((dateTime.index || 0) + dateTime[0].length).trim();
    const scoreMatch = afterDate.match(/\b(\d{1,2})\s*:\s*(\d{1,2})(?:\s*\([^)]*\))?/);
    if (!scoreMatch || scoreMatch.index === undefined) continue;

    const scoreIndex = scoreMatch.index;
    const beforeScore = afterDate.slice(0, scoreIndex).trim();
    const scoreToken = scoreMatch[0];
    const afterScore = stripTrailingMatchMeta(afterDate.slice(scoreIndex + scoreToken.length));

    let homeTeam = "";
    let awayTeam = "";
    let competitionName = title || "ÖFB";

    const homeAinet = beforeScore.match(/^(.*?)(\b(?:TSU\s+)?Ainet\b)$/i);
    if (homeAinet) {
      const split = splitCompetitionAndTeam(homeAinet[1].trim(), title);
      competitionName = split.competitionName;
      homeTeam = homeAinet[2];
      awayTeam = afterScore;
    } else if (/^\b(?:TSU\s+)?Ainet\b/i.test(afterScore)) {
      awayTeam = afterScore.match(/^\b(?:TSU\s+)?Ainet\b/i)?.[0] || "Ainet";
      const split = splitCompetitionAndTeam(beforeScore, title);
      competitionName = split.competitionName;
      homeTeam = split.team;
    } else {
      const ainetInBefore = beforeScore.match(/\b(?:TSU\s+)?Ainet\b/i);
      const ainetInAfter = afterScore.match(/\b(?:TSU\s+)?Ainet\b/i);
      if (ainetInBefore) {
        homeTeam = ainetInBefore[0];
        competitionName = beforeScore.slice(0, ainetInBefore.index).trim() || title;
        awayTeam = afterScore;
      } else if (ainetInAfter) {
        awayTeam = ainetInAfter[0];
        const split = splitCompetitionAndTeam(beforeScore, title);
        competitionName = split.competitionName;
        homeTeam = split.team;
      }
    }

    homeTeam = stripTrailingMatchMeta(homeTeam);
    awayTeam = stripTrailingMatchMeta(awayTeam);
    if (!homeTeam || !awayTeam) continue;

    addMatch(matches, {
      homeTeam,
      awayTeam,
      kickoff,
      homeScore: Number(scoreMatch[1]),
      awayScore: Number(scoreMatch[2]),
      score: `${scoreMatch[1]}:${scoreMatch[2]}`,
      competitionName,
    }, sourceUrl, block);
  }
}

function parseMatchText(text, matches, sourceUrl, title) {
  const normalized = oneLine(text);
  if (!lower(normalized).includes("ainet")) return;

  // Format: Freitag, 13.06.2025 | 17:30 Uhr Ferlach Atus : 2:4 ... Lendorf
  const dateMatches = [...normalized.matchAll(/(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)?[,]?\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}(?:\s*\|?\s*\d{1,2}[:.]\d{2}\s*(?:uhr)?)?/gi)];
  for (let i = 0; i < dateMatches.length; i++) {
    const start = dateMatches[i].index;
    const end = dateMatches[i + 1]?.index ?? normalized.length;
    const block = normalized.slice(start, Math.min(end, start + 700));
    if (!lower(block).includes("ainet")) continue;
    const kickoff = parseDate(block, new Date().getFullYear(), sourceUrl);
    if (!kickoff) continue;

    const kickoffToken = block.match(/\d{1,2}[:.]\d{2}\s*(?:Uhr)?/i);
    const afterTime = kickoffToken && kickoffToken.index !== undefined
      ? block.slice(kickoffToken.index + kickoffToken[0].length).trim()
      : block;
    // Ein Resultat wird ausschließlich NACH dem Anstoßzeit-Token gesucht.
    // Dadurch kann 19:00 nie mehr als 19:0 importiert werden.
    const score = ""; // Ergebnisse kommen ausschließlich aus parseDomMatchCards/strukturierten API-Feldern.

    let versus = afterTime.match(/^(.{2,90}?)\s+(?::|–|—|gegen)\s+(?:\d{1,2}\s*:\s*\d{1,2}(?:[^A-Za-zÄÖÜäöü]{0,30})?)?(.{2,90}?)(?:\s*\||\s+Spielbericht|\s+Live|$)/i);
    if (!versus) versus = block.match(/([A-Za-zÄÖÜäöü0-9 ./'&()\-]{2,70})\s+(?:gegen|–|—)\s+([A-Za-zÄÖÜäöü0-9 ./'&()\-]{2,70})/i);
    if (!versus) continue;

    addMatch(matches, {
      homeTeam: versus[1], awayTeam: versus[2], kickoff, score,
      competitionName: title,
    }, sourceUrl, block);
  }
}



function isVisibleMatchMetaLine(value) {
  const text = oneLine(value);
  if (!text) return true;
  return /^(?:Spiele|Tabellen|Kader|Trainer\s*&?\s*Betreuer|Zu-?\s*&?\s*Abgänge|Alle Spiele|Letztes Spiel|Nächstes Spiel|Vorschau|Spielbericht|Ticker|Livestream|Mehr|Details|Gesamt|Heim|Auswärts|Frühjahr|Herbst)$/i.test(text)
    || /^(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?$/i.test(text)
    || /^\d{1,2}:\d{2}(?:\s*Uhr)?$/i.test(text)
    || /^\d{1,2}\.\d{1,2}\.?$/i.test(text)
    || /^(?:Saison\s*)?\d{4}\/\d{2}$/i.test(text);
}

function isPlausibleTeamLine(value) {
  const text = oneLine(value);
  if (isVisibleMatchMetaLine(text)) return false;
  if (text.length < 2 || text.length > 100) return false;
  if (!/[A-Za-zÄÖÜäöü]/.test(text)) return false;
  if (/^(?:Sportplatz|Stadion|Arena|Kunstrasen|Adresse|Kontakt|Torschützen|Schiedsrichter)\b/i.test(text)) return false;
  if (/\b(?:Klasse|Liga|Cup|Meisterschaft|Testspiel|Freundschaftsspiel)\b/i.test(text) && !/\b(?:FC|SV|TSU|SG|ASKÖ|Union|Ainet)\b/i.test(text)) return false;
  return true;
}

function parseVisibleMatchBlocks(bodyText, matches, sourceUrl, title) {
  const rawLines = clean(bodyText).split("\n").map(oneLine).filter(Boolean);
  const dateStartRx = /(?:\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?[,]?\s*)?\d{1,2}\.\d{1,2}\.?[,]?\s+\d{1,2}:\d{2}(?:\s*Uhr)?/i;
  const dateOnlyRx = /^(?:\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?[,]?\s*)?\d{1,2}\.\d{1,2}\.?[,]?$/i;
  const timeOnlyRx = /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*Uhr)?$/i;

  const starts = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    if (dateStartRx.test(rawLines[i])) starts.push({ index: i, dateText: rawLines[i] });
    else if (dateOnlyRx.test(rawLines[i]) && timeOnlyRx.test(rawLines[i + 1] || "")) {
      starts.push({ index: i, dateText: `${rawLines[i]} ${rawLines[i + 1]}` });
    }
  }

  for (let n = 0; n < starts.length; n += 1) {
    const start = starts[n].index;
    const end = starts[n + 1]?.index ?? Math.min(rawLines.length, start + 30);
    const lines = rawLines.slice(start, Math.min(end, start + 30));
    const context = lines.join(" | ");
    if (!/\bainet\b/i.test(context)) continue;

    const kickoff = parseDate(starts[n].dateText, new Date().getFullYear(), sourceUrl);
    if (!kickoff) continue;

    let scoreIndex = -1;
    let scoreData = null;
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseStrictScoreText(lines[i], kickoff);
      if (parsed) { scoreIndex = i; scoreData = parsed; break; }
    }

    const ainetIndex = lines.findIndex((line) => /^(?:TSU\s+)?Ainet(?:\s+(?:1b|II|Reserve|Challenge))?$/i.test(line));
    if (ainetIndex < 0) continue;

    let homeTeam = "";
    let awayTeam = "";

    if (scoreIndex >= 0) {
      const before = lines.slice(0, scoreIndex).filter(isPlausibleTeamLine);
      const after = lines.slice(scoreIndex + 1).filter(isPlausibleTeamLine);
      const ainetBefore = before.findLast?.((line) => /\bainet\b/i.test(line)) || [...before].reverse().find((line) => /\bainet\b/i.test(line));
      const ainetAfter = after.find((line) => /\bainet\b/i.test(line));
      if (ainetBefore) {
        homeTeam = ainetBefore;
        awayTeam = after.find((line) => !/\bainet\b/i.test(line)) || "";
      } else if (ainetAfter) {
        awayTeam = ainetAfter;
        homeTeam = [...before].reverse().find((line) => !/\bainet\b/i.test(line)) || "";
      }
    } else {
      // Geplantes Spiel: Auf der ÖFB-Seite stehen die beiden Teamnamen typischerweise
      // direkt beieinander. Wir nehmen den nächsten plausiblen Gegner rund um Ainet.
      const candidates = lines.map((line, index) => ({ line, index })).filter(({ line }) => isPlausibleTeamLine(line));
      const ainetCandidateIndex = candidates.findIndex(({ line }) => /\bainet\b/i.test(line));
      if (ainetCandidateIndex >= 0) {
        const previous = candidates[ainetCandidateIndex - 1]?.line || "";
        const next = candidates[ainetCandidateIndex + 1]?.line || "";
        // Reihenfolge im DOM bleibt Heim vor Auswärts. Ist Ainet der erste Teamname,
        // ist der folgende Kandidat der Gegner, sonst der vorherige.
        if (next && !/\bainet\b/i.test(next)) {
          homeTeam = candidates[ainetCandidateIndex].line;
          awayTeam = next;
        } else if (previous && !/\bainet\b/i.test(previous)) {
          homeTeam = previous;
          awayTeam = candidates[ainetCandidateIndex].line;
        }
      }
    }

    homeTeam = stripTrailingMatchMeta(homeTeam);
    awayTeam = stripTrailingMatchMeta(awayTeam);
    if (!homeTeam || !awayTeam || homeTeam === awayTeam) continue;

    const competitionName = lines.find((line) => /\b(?:Klasse|Liga|Cup|Meisterschaft|Testspiel|Freundschaftsspiel)\b/i.test(line)) || title || "ÖFB";
    const venue = lines.find((line) => /\b(?:Sportplatz|Stadion|Arena|Kunstrasen)\b/i.test(line)) || "";
    addMatch(matches, {
      homeTeam, awayTeam, kickoff,
      ...(scoreData || {}),
      competitionName, venue,
    }, sourceUrl, context);
  }
}

function parseStrictScoreText(value, kickoff = null) {
  const text = oneLine(value);
  if (!text || /halbzeit|pause|hz\b|zwischenstand/i.test(text)) return null;

  const match = text.match(
    /^(?:(endstand|beendet|full[ -]?time|ft|abpfiff)\s*[:|-]?\s*)?(\d{1,2})\s*:\s*(\d{1,2})(?:\s*(\([^)]*\)|i\.?\s*e\.?|n\.?\s*v\.?))?(?:\s*[-|:]?\s*(endstand|beendet|full[ -]?time|ft|abpfiff))?$/i,
  );
  if (!match) return null;

  const leftRaw = match[2];
  const rightRaw = match[3];
  const homeScore = Number(leftRaw);
  const awayScore = Number(rightRaw);
  const explicitFinal = Boolean(match[1] || match[5]);

  const looksLikeClock = !explicitFinal && leftRaw.length <= 2 && rightRaw.length === 2 &&
    homeScore >= 0 && homeScore <= 23 && awayScore >= 0 && awayScore <= 59;
  if (looksLikeClock) return null;

  if (kickoff instanceof Date && homeScore === kickoff.getHours() && awayScore === kickoff.getMinutes()) {
    return null;
  }

  const suffix = oneLine(match[4] || "");
  return {
    homeScore,
    awayScore,
    score: `${homeScore}:${awayScore}`,
    resultText: `${homeScore}:${awayScore}${suffix ? ` ${suffix}` : ""}`,
    scoreConfirmed: true,
    explicitFinal,
  };
}

function parseDomMatchCards($, matches, sourceUrl, title) {
  const selectors = "article, li, tr, [class*='match'], [class*='spiel'], [class*='fixture'], [class*='game'], [class*='calendar']";
  $(selectors).each((_, element) => {
    const root = $(element);
    const block = oneLine(root.text());
    if (!/\bainet\b/i.test(block)) return;

    const kickoff = parseDate(block, new Date().getFullYear(), sourceUrl);
    if (!kickoff) return;

    let strictScore = null;
    root.find("[class*='score'], [class*='result'], [class*='ergebnis'], [data-score], [data-result]").each((__, scoreElement) => {
      if (strictScore) return;
      const node = $(scoreElement);
      const classAndAttrs = `${node.attr('class') || ''} ${node.attr('data-score') || ''} ${node.attr('data-result') || ''}`;
      if (/time|uhr|kickoff|beginn|start/i.test(classAndAttrs)) return;
      strictScore = parseStrictScoreText(node.attr('data-score') || node.attr('data-result') || node.text(), kickoff);
    });

    // Teamnamen bevorzugt aus getrennten Team-/Club-Elementen lesen.
    const teamCandidates = [];
    root.find("[class*='team'], [class*='club'], [class*='verein'], [data-team], [data-club]").each((__, teamElement) => {
      const node = $(teamElement);
      const candidate = oneLine(node.attr('data-team') || node.attr('data-club') || node.text());
      if (!candidate || /^\d{1,2}\s*:\s*\d{1,2}$/.test(candidate) || /uhr|endstand|spielbericht|tabelle/i.test(candidate)) return;
      if (!teamCandidates.some((x) => lower(x) === lower(candidate))) teamCandidates.push(candidate);
    });

    let homeTeam = teamCandidates[0] || '';
    let awayTeam = teamCandidates[1] || '';

    // Fallback: Teamnamen um einen ausdrücklich markierten Ergebniswert herum teilen.
    if ((!homeTeam || !awayTeam) && strictScore) {
      const scorePattern = new RegExp(`\\b${strictScore.homeScore}\\s*:\\s*${strictScore.awayScore}\\b`);
      const parts = block.split(scorePattern);
      if (parts.length >= 2) {
        const left = stripTrailingMatchMeta(parts[0]);
        const right = stripTrailingMatchMeta(parts.slice(1).join(' '));
        const leftAinet = left.match(/(?:TSU\s+)?Ainet(?:\s+(?:1b|II|Reserve|Challenge))?$/i);
        const rightAinet = right.match(/^(?:TSU\s+)?Ainet(?:\s+(?:1b|II|Reserve|Challenge))?/i);
        if (leftAinet) {
          homeTeam = leftAinet[0];
          awayTeam = right;
        } else if (rightAinet) {
          homeTeam = left.replace(/^.*?\d{1,2}:\d{2}\s*(?:Uhr)?\s*/i, '');
          awayTeam = rightAinet[0];
        }
      }
    }

    if (!homeTeam || !awayTeam || !/ainet/i.test(`${homeTeam} ${awayTeam}`)) return;
    addMatch(matches, {
      homeTeam,
      awayTeam,
      kickoff,
      ...(strictScore || {}),
      competitionName: title,
    }, sourceUrl, block);
  });
}

function parseTables($, matches, standings, sourceUrl, title) {
  $("table").each((_, table) => {
    const tableText = oneLine($(table).text());
    const headers = $(table).find("th").map((__, cell) => lower($(cell).text())).get();
    const isStanding = headers.some((h) => /platz|rang|punkte|pkt|spiele|tore/.test(h)) || /tordifferenz|punkte/.test(lower(tableText));

    $(table).find("tr").each((__, row) => {
      const cellNodes = $(row).find("th,td").toArray();
      const cells = cellNodes.map((cell) => oneLine($(cell).text())).filter(Boolean);
      if (cells.length < 2) return;
      const rowText = cells.join(" | ");

      if (isStanding) {
        const position = parseNumber(cells[0]);
        const clubIndex = cells.findIndex((cell, index) => index > 0 && /[A-Za-zÄÖÜäöü]/.test(cell) && !/^(sp|s|u|n|pkt|punkte|td)$/i.test(cell));
        if (!position || clubIndex < 0) return;
        const scoreCell = cells.find((cell) => /^\d+\s*:\s*\d+$/.test(cell));
        const [goalsFor, goalsAgainst] = parseScore(scoreCell || "");
        const numeric = cells.slice(clubIndex + 1).map(parseNumber).filter((n) => n !== null);
        addStanding(standings, {
          position, clubName: cells[clubIndex],
          teamLogoUrl: $(cellNodes[clubIndex]).find("img").first().attr("src") || $(cellNodes[clubIndex]).find("img").first().attr("data-src") || "",
          played: numeric[0], won: numeric[1], drawn: numeric[2], lost: numeric[3],
          goalsFor, goalsAgainst, goalDifference: goalsFor !== null && goalsAgainst !== null ? goalsFor - goalsAgainst : null,
          points: numeric.at(-1), competitionName: title, teamName: teamFromText(`${title} ${tableText.slice(0, 400)}`),
        }, sourceUrl);
      } else {
        const kickoff = parseDate(rowText, new Date().getFullYear(), sourceUrl);
        const strictScoreCell = cells.map((cell) => parseStrictScoreText(cell, kickoff)).find(Boolean);
        const teamCells = cells.filter((cell) => /[A-Za-zÄÖÜäöü]/.test(cell) && !/Uhr|Spielbericht|Endstand|Vorschau/i.test(cell));
        if (strictScoreCell && kickoff && teamCells.length >= 2 && /ainet/i.test(teamCells.join(" "))) {
          addMatch(matches, {
            homeTeam: teamCells.at(-2), awayTeam: teamCells.at(-1), kickoff,
            ...strictScoreCell, competitionName: title,
          }, sourceUrl, rowText);
        }
      }
    });
  });
}

function parseStandingText(bodyText, standings, sourceUrl, title) {
  const lines = clean(bodyText).split("\n").map(oneLine).filter(Boolean);
  for (const line of lines) {
    // Common compact format: 1. Verein 26 18 4 4 70:25 58
    const match = line.match(/^\s*(\d{1,2})[.)]?\s+(.{2,60}?)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})\s*:\s*(\d{1,3})\s+(-?\d{1,3})?\s+(\d{1,3})\s*$/);
    if (!match) continue;
    addStanding(standings, {
      position: match[1], clubName: match[2], played: match[3], won: match[4], drawn: match[5], lost: match[6],
      goalsFor: match[7], goalsAgainst: match[8], goalDifference: match[9], points: match[10],
      competitionName: title, teamName: teamFromText(`${title} ${bodyText.slice(0, 500)}`),
    }, sourceUrl);
  }
}

function parseResource(text, contentType, sourceUrl) {
  let matches = [];
  let standings = [];
  let squad = [];
  const urls = new Set([sourceUrl]);
  const descriptor = sourceDescriptor(sourceUrl);
  let title = descriptor.teamName || "ÖFB";
  let bodyText = "";

  const restrictToSource = () => {
    if (descriptor.kind === "games") standings = [];
    if (descriptor.kind === "table") matches = [];
    if (descriptor.kind === "squad") { matches = []; standings = []; }
    if (descriptor.teamKey) {
      matches = matches.map((item) => ({ ...item, teamKey: descriptor.teamKey, teamName: descriptor.teamName, teamId: slug(descriptor.teamName) }));
      standings = standings.map((item) => ({ ...item, teamKey: descriptor.teamKey, teamName: descriptor.teamName, teamId: slug(descriptor.teamName) }));
      squad = squad.map((item) => ({ ...item, teamKey: descriptor.teamKey, teamName: descriptor.teamName, teamId: slug(descriptor.teamName) }));
    }
  };

  if (contentType.includes("json") || /^[\s]*[\[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.__browserSnapshot) importBrowserSnapshot(parsed.__browserSnapshot, matches, standings, squad, sourceUrl);
      else parseJsonObjects(parsed, matches, standings, urls, sourceUrl, title);
      bodyText = oneLine(JSON.stringify(parsed));
      restrictToSource();
      return { matches, standings, squad, urls: [...urls], title, bytes: Buffer.byteLength(text), kind: `json-${descriptor.kind}`, sourceKind: descriptor.kind, teamKey: descriptor.teamKey };
    } catch { /* continue as HTML/text */ }
  }

  const $ = cheerio.load(text);
  title = oneLine($("h1").first().text() || $("title").text() || descriptor.teamName || "ÖFB");
  $("script,style,noscript,svg").remove();
  bodyText = clean($("body").text() || $.root().text());

  for (const candidate of extractJsonCandidates(text)) {
    try { parseJsonObjects(JSON.parse(candidate), matches, standings, urls, sourceUrl, title); } catch { /* ignore */ }
  }

  // Keine Navigation von Mannschaftsseiten zu fremden Vereins-/Statistikseiten.
  // Nur offizielle Spielbericht-Links dürfen zusätzlich entdeckt werden.
  if (descriptor.kind === "games" || descriptor.kind === "report") {
    for (const discovered of extractCandidateUrls(text, sourceUrl)) {
      if (/\/Spielbericht\/|[?&](?::s|s)=\d+/i.test(discovered)) urls.add(discovered);
    }
  }

  if (descriptor.kind === "games") {
    parseDomMatchCards($, matches, sourceUrl, title);
    parseVisibleMatchBlocks(bodyText, matches, sourceUrl, title);
    parseTables($, matches, [], sourceUrl, title);
  } else if (descriptor.kind === "table") {
    parseTables($, [], standings, sourceUrl, title);
    parseStandingText(bodyText, standings, sourceUrl, title);
  } else if (descriptor.kind === "other" || descriptor.kind === "report") {
    parseDomMatchCards($, matches, sourceUrl, title);
    parseVisibleMatchBlocks(bodyText, matches, sourceUrl, title);
  }

  restrictToSource();
  return { matches, standings, squad, urls: [...urls], title, bytes: Buffer.byteLength(text), kind: `html-${descriptor.kind}`, sourceKind: descriptor.kind, teamKey: descriptor.teamKey, textPreview: bodyText.slice(0, 1000) };
}


function normalizeBrowserTeam(value) {
  const text = oneLine(value).replace(/\s+(?:Spielbericht|Vorschau|Ticker|Livestream).*$/i, "").trim();
  return /^(?:TSU\s+)?Ainet$/i.test(text) ? "TSU Ainet" : text;
}

function importBrowserSnapshot(snapshot, matches, standings, squad, sourceUrl) {
  if (!snapshot || typeof snapshot !== "object") return;
  for (const item of snapshot.matches || []) {
    const kickoff = item.kickoff ? new Date(item.kickoff) : null;
    const score = item.score && item.scoreConfirmed === true ? item.score : "";
    addMatch(matches, {
      homeTeam: normalizeBrowserTeam(item.homeTeam),
      awayTeam: normalizeBrowserTeam(item.awayTeam),
      homeLogoUrl: item.homeLogoUrl,
      awayLogoUrl: item.awayLogoUrl,
      kickoff,
      score,
      competitionName: item.competitionName,
      venue: item.venue,
      venueAddress: item.venueAddress,
      referee: item.referee,
      liveUrl: item.liveUrl,
      reportUrl: item.reportUrl,
      status: score ? "finished" : item.status,
    }, sourceUrl, item.context || "");
  }
  for (const player of snapshot.squad || []) {
    addSquadPlayer(squad, player, sourceUrl);
  }
  for (const row of snapshot.standings || []) {
    addStanding(standings, {
      ...row,
      teamName: teamFromUrl(sourceUrl).teamName,
      teamKey: teamFromUrl(sourceUrl).teamKey,
    }, sourceUrl);
  }
}

function importClubProfiles(snapshot, profiles, sourceUrl) {
  if (!snapshot || typeof snapshot !== "object") return;
  for (const item of snapshot.clubProfiles || []) {
    const name = oneLine(item.name);
    const logoUrl = safeImageUrl(item.logoUrl, item.pageUrl || sourceUrl);
    if (!name) continue;
    const identity = oneLine(item.clubId) || extractClubIdentity(item.pageUrl || sourceUrl, name).clubId;
    profiles.push({
      id: makeId(["kfv-club-v13", identity || clubKey(name) || name]),
      name,
      normalizedName: clubKey(name),
      logoUrl,
      pageUrl: item.pageUrl ? safeUrl(item.pageUrl, sourceUrl) : sourceUrl,
      oefbClubId: identity,
      source: "oefb-public",
      active: true,
    });
  }
}

function importMatchReports(snapshot, target, sourceUrl) {
  if (!snapshot || typeof snapshot !== "object") return;
  for (const raw of snapshot.reports || []) {
    const gameId = oneLine(raw.gameId || extractGameId(raw.reportUrl, sourceUrl));
    if (!gameId) continue;
    const matchUid = `oefb:${gameId}`;
    const matchId = makeId(["kfv-match-uid-v11", matchUid]);
    const cleanPlayers = (items) => (Array.isArray(items) ? items : []).map((item) => ({
      name: oneLine(item.name), number: Number.isInteger(item.number) ? item.number : null,
      position: oneLine(item.position), playerUrl: item.playerUrl ? safeUrl(item.playerUrl, raw.reportUrl || sourceUrl) : "", captain: item.captain === true,
    })).filter((item) => item.name);
    const cleanEvents = (items) => (Array.isArray(items) ? items : []).map((item, index) => ({
      id: oneLine(item.id) || `event-${index}`, type: ["goal","yellow","yellowRed","red","substitution","halfTime","fullTime","other"].includes(item.type) ? item.type : "other",
      minute: Number.isInteger(item.minute) ? item.minute : null, minuteText: oneLine(item.minuteText),
      team: item.team === "home" || item.team === "away" ? item.team : "neutral", playerName: oneLine(item.playerName), secondaryPlayerName: oneLine(item.secondaryPlayerName), description: oneLine(item.description),
    }));
    target.push({
      id: matchId, matchId, matchUid, oefbMatchId: gameId, reportUrl: safeUrl(raw.reportUrl, sourceUrl),
      homeTeam: oneLine(raw.homeTeam), awayTeam: oneLine(raw.awayTeam),
      homeLineup: cleanPlayers(raw.homeLineup), awayLineup: cleanPlayers(raw.awayLineup),
      homeBench: cleanPlayers(raw.homeBench), awayBench: cleanPlayers(raw.awayBench),
      homeCoach: oneLine(raw.homeCoach), awayCoach: oneLine(raw.awayCoach), referee: oneLine(raw.referee),
      attendance: Number.isInteger(raw.attendance) ? raw.attendance : null, events: cleanEvents(raw.events),
      published: raw.published === true, active: true, source: "oefb-public", sourceUrl: safeUrl(raw.reportUrl || sourceUrl, sourceUrl),
    });
  }
}

async function collectWithBrowser(startUrls) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const resources = [];
  const diagnostics = [];
  const seenResponses = new Set();
  try {
    const queue = [...new Set(startUrls)];
    const processed = new Set();
    while (queue.length && processed.size < MAX_PAGES) {
      const startUrl = queue.shift();
      if (!startUrl || processed.has(startUrl)) continue;
      processed.add(startUrl);
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1200 });
      await page.setExtraHTTPHeaders({ "Accept-Language": "de-AT,de;q=0.9" });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36");

      page.on("response", async (response) => {
        try {
          const url = response.url();
          if (!(url.includes("oefb.at") || url.includes("kfv-fussball.at")) || seenResponses.has(url)) return;
          const contentType = (response.headers()["content-type"] || "").toLowerCase();
          if (!/(json|javascript|text\/plain)/.test(contentType)) return;
          seenResponses.add(url);
          const text = await response.text();
          if (text.length < 2 || text.length > 5_000_000) return;
          resources.push({ text, contentType, finalUrl: safeUrl(url, startUrl), origin: "network" });
        } catch { /* response body unavailable */ }
      });

      let navigationError = "";
      try {
        await page.goto(startUrl, { waitUntil: "networkidle2", timeout: 90000 });
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (error) {
        navigationError = String(error.message || error);
      }

      // Cookie banner schließen, sofern vorhanden.
      for (const label of ["Alle akzeptieren", "Akzeptieren", "Zustimmen", "OK"]) {
        try {
          const buttons = await page.$$('button');
          for (const button of buttons) {
            const text = await page.evaluate((el) => (el.innerText || "").trim(), button);
            if (text === label) { await button.click(); await new Promise((r) => setTimeout(r, 1500)); break; }
          }
        } catch { /* ignore */ }
      }

      // Mannschafts-Links direkt aus der offiziellen Vereinsseite übernehmen.
      // So funktionieren auch abweichende ÖFB-Slugs wie U12-A oder Challenge.
      const discoveredTeamUrls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((anchor) => anchor.href)
          .filter((href) => /\/TsuAinet\/Mannschaften\/Saison-2026-27\/[^/]+\/(?:Spiele|Tabellen|Kader)\/?$/i.test(href)),
      );
      for (const href of discoveredTeamUrls) {
        try {
          const discovered = safeUrl(href, startUrl);
          if (!processed.has(discovered) && !queue.includes(discovered)) queue.push(discovered);
        } catch { /* ignore */ }
      }

      // Offizielle Spielberichte werden separat besucht. Dort stehen die
      // veröffentlichten Aufstellungen, Ersatzspieler und Spielereignisse.
      const discoveredReportUrls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((anchor) => anchor.href)
          .filter((href) => /\/Spielbericht\/|[?&](?::s|s)=\d+/i.test(href)),
      );
      for (const href of discoveredReportUrls) {
        try {
          const discovered = safeUrl(href, startUrl);
          if (!processed.has(discovered) && !queue.includes(discovered)) queue.unshift(discovered);
        } catch { /* ignore */ }
      }

      // Vereinsseiten aus Team-/Tabellenlinks erkennen. Auf diesen Seiten liegt das
      // offizielle Logo oft separat und wird auf den Spielseiten nicht als <img> ausgegeben.
      const discoveredClubUrls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((anchor) => ({ href: anchor.href, text: (anchor.textContent || "").replace(/\s+/g, " ").trim() }))
          .filter((item) => /(?:kfv-fussball\.at\/kfv\/Verein\/\d+|vereine\.oefb\.at\/[^/]+\/?$)/i.test(item.href)),
      );
      for (const item of discoveredClubUrls) {
        try {
          const discovered = safeUrl(item.href, startUrl);
          if (!processed.has(discovered) && !queue.includes(discovered)) queue.push(discovered);
        } catch { /* ignore */ }
      }

      const structuredSnapshot = await page.evaluate(() => {
        const compact = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        const exactScore = /^\d{1,2}\s*:\s*\d{1,2}(?:\s*(?:\([^)]*\)|i\.?\s*E\.?|n\.?\s*V\.?))?$/i;
        const exactTime = /^([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*Uhr)?$/i;
        const dateRx = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/;
        const all = Array.from(document.querySelectorAll("article, li, tr, [class*='match'], [class*='spiel'], [class*='fixture'], [class*='game']"));
        const matches = [];
        const seen = new Set();

        for (const root of all) {
          const context = compact(root.innerText || root.textContent);
          if (!/\bainet\b/i.test(context) || !dateRx.test(context)) continue;

          const nodes = Array.from(root.querySelectorAll("*"));
          const scoreNodes = nodes.filter((node) => {
            const text = compact(node.getAttribute("data-score") || node.getAttribute("data-result") || node.textContent);
            if (!exactScore.test(text)) return false;
            const meta = compact(`${node.className || ""} ${node.id || ""} ${node.getAttribute("aria-label") || ""}`);
            if (/time|uhr|kickoff|beginn|start/i.test(meta)) return false;
            const confirmedByMeta = /score|result|ergebnis|endstand/i.test(meta);
            const confirmedByContext = /\bendstand\b/i.test(context);
            return confirmedByMeta || confirmedByContext;
          });

          const teamNodes = nodes.filter((node) => {
            const text = compact(node.getAttribute("data-team") || node.getAttribute("data-club") || node.textContent);
            if (text.length < 2 || text.length > 80 || !/[A-Za-zÄÖÜäöü]/.test(text)) return false;
            const meta = compact(`${node.className || ""} ${node.id || ""} ${node.getAttribute("data-team") || ""} ${node.getAttribute("data-club") || ""}`);
            return /team|club|verein|opponent|gegner|heim|gast|home|away/i.test(meta);
          });
          const imageUrl = (node) => {
            const image = node?.matches?.("img") ? node : node?.querySelector?.("img");
            const raw = image?.currentSrc || image?.getAttribute?.("src") || image?.getAttribute?.("data-src") || image?.getAttribute?.("data-lazy-src") || "";
            try { return raw ? new URL(raw, location.href).href : ""; } catch { return ""; }
          };
          const teams = [];
          for (const node of teamNodes) {
            const text = compact(node.getAttribute("data-team") || node.getAttribute("data-club") || node.textContent);
            if (/uhr|endstand|spielbericht|tabelle|spiele/i.test(text)) continue;
            if (!teams.some((x) => x.name.toLowerCase() === text.toLowerCase())) {
              const parent = node.closest("[class*='team'], [class*='club'], [class*='verein'], li, tr, article, section, div");
              const anchor = node.closest("a[href]") || parent?.querySelector?.("a[href]");
              const clubUrl = anchor?.href || "";
              const kfvId = clubUrl.match(/\/Verein\/(\d+)/i)?.[1] || "";
              const oefbSlug = (() => { try { const u = new URL(clubUrl); return /vereine\.oefb\.at$/i.test(u.hostname) ? u.pathname.split("/").filter(Boolean)[0] || "" : ""; } catch { return ""; } })();
              teams.push({ name: text, logoUrl: imageUrl(node) || imageUrl(parent), clubUrl, clubId: kfvId ? `kfv:${kfvId}` : (oefbSlug ? `oefb:${oefbSlug.toLowerCase()}` : "") });
            }
          }
          if (teams.length < 2) continue;

          const dateMatch = context.match(dateRx);
          const timeNode = nodes.find((node) => {
            const text = compact(node.textContent);
            const meta = compact(`${node.className || ""} ${node.id || ""} ${node.getAttribute("aria-label") || ""}`);
            return exactTime.test(text) && /time|uhr|kickoff|beginn|start/i.test(meta + " " + text);
          });
          const timeText = compact(timeNode?.textContent || context.match(/\b(?:[01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:Uhr)?\b/i)?.[0] || "00:00");
          const timeMatch = timeText.match(/(\d{1,2})[:.](\d{2})/);
          if (!dateMatch || !timeMatch) continue;
          let year = Number(dateMatch[3]); if (year < 100) year += 2000;
          const kickoff = new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[1]), Number(timeMatch[1]), Number(timeMatch[2]));
          if (Number.isNaN(kickoff.getTime())) continue;

          const scoreText = scoreNodes.length ? compact(scoreNodes[0].getAttribute("data-score") || scoreNodes[0].getAttribute("data-result") || scoreNodes[0].textContent) : "";
          const report = root.querySelector("a[href*='Spiel'], a[href*='spiel'], a[href*='Match'], a[href*='match']");
          const key = `${kickoff.toISOString()}|${teams[0].name}|${teams[1].name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          matches.push({
            homeTeam: teams[0].name, awayTeam: teams[1].name,
            homeClubId: teams[0].clubId, awayClubId: teams[1].clubId,
            homeClubUrl: teams[0].clubUrl, awayClubUrl: teams[1].clubUrl,
            homeLogoUrl: teams[0].logoUrl, awayLogoUrl: teams[1].logoUrl,
            kickoff: kickoff.toISOString(),
            score: scoreText, scoreConfirmed: Boolean(scoreText),
            competitionName: compact(document.querySelector("h1")?.textContent || document.title || "ÖFB"),
            venue: compact(context.match(/(?:Sportplatz|Stadion|Arena|Kunstrasen|Fußballplatz)\s+[A-Za-zÄÖÜäöüß0-9 .\-\/]{2,80}/i)?.[0] || ""),
            venueAddress: "",
            referee: compact(context.match(/(?:Schiedsrichter(?:in)?|Referee|SR)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß .\-]{3,80})/i)?.[1] || ""),
            liveUrl: /ticker|live|livestream/i.test(report?.href || "") ? report.href : "",
            reportUrl: report?.href || location.href,
            status: /abgesagt|annulliert/i.test(context) ? "cancelled" : /verschoben/i.test(context) ? "postponed" : scoreText ? "finished" : "scheduled",
            context,
          });
        }

        const standings = [];
        const isOfficialTablePage = /\/Tabellen\/?$/i.test(location.pathname);
        for (const table of Array.from(document.querySelectorAll("table"))) {
          if (!isOfficialTablePage) continue;
          const headers = Array.from(table.querySelectorAll("th")).map((x) => compact(x.textContent).toLowerCase());
          const headerText = headers.join(" | ");
          const hasRank = /platz|rang|^#$/i.test(headerText);
          const hasPlayed = /(?:^|\b)(?:sp|spiele|gespielt)(?:\b|$)/i.test(headerText);
          const hasPoints = /punkte|pkt|pts/i.test(headerText);
          const hasGoals = /tore|torverhältnis|tv/i.test(headerText);
          if (!(hasRank && hasPlayed && hasPoints && hasGoals)) continue;
          for (const row of Array.from(table.querySelectorAll("tbody tr, tr"))) {
            const cells = Array.from(row.querySelectorAll("th,td")).map((x) => compact(x.textContent)).filter(Boolean);
            if (cells.length < 3 || !/^\d{1,2}[.)]?$/.test(cells[0])) continue;
            const clubIndex = cells.findIndex((c, i) => i > 0 && /[A-Za-zÄÖÜäöü]/.test(c));
            if (clubIndex < 0) continue;
            const numbers = cells.slice(clubIndex + 1).map((c) => /^-?\d+$/.test(c) ? Number(c) : null).filter((x) => x !== null);
            const goals = cells.find((c) => /^\d+\s*:\s*\d+$/.test(c));
            const gm = goals?.match(/(\d+)\s*:\s*(\d+)/);
            const clubCell = Array.from(row.querySelectorAll("th,td"))[clubIndex];
            const logo = clubCell?.querySelector("img");
            const logoRaw = logo?.currentSrc || logo?.getAttribute("src") || logo?.getAttribute("data-src") || logo?.getAttribute("data-lazy-src") || "";
            let teamLogoUrl = "";
            try { teamLogoUrl = logoRaw ? new URL(logoRaw, location.href).href : ""; } catch { teamLogoUrl = ""; }
            const clubAnchor = clubCell?.querySelector("a[href]") || row.querySelector("a[href*='/Verein/'], a[href*='vereine.oefb.at']");
            const clubUrl = clubAnchor?.href || "";
            const clubKfvId = clubUrl.match(/\/Verein\/(\d+)/i)?.[1] || "";
            const clubOefbSlug = (() => { try { const u = new URL(clubUrl); return /vereine\.oefb\.at$/i.test(u.hostname) ? u.pathname.split("/").filter(Boolean)[0] || "" : ""; } catch { return ""; } })();
            const standing = { position: Number(cells[0].replace(/\D/g, "")), clubName: cells[clubIndex], clubUrl, clubId: clubKfvId ? `kfv:${clubKfvId}` : (clubOefbSlug ? `oefb:${clubOefbSlug.toLowerCase()}` : ""), teamLogoUrl, played: numbers[0], won: numbers[1], drawn: numbers[2], lost: numbers[3], goalsFor: gm ? Number(gm[1]) : NaN, goalsAgainst: gm ? Number(gm[2]) : NaN, goalDifference: gm ? Number(gm[1]) - Number(gm[2]) : NaN, points: numbers.at(-1), competitionName: compact(document.querySelector("h1")?.textContent || document.title || "ÖFB") };
            if (Number.isFinite(standing.played) && standing.played === standing.won + standing.drawn + standing.lost && Number.isFinite(standing.goalsFor) && Number.isFinite(standing.goalsAgainst) && standing.points <= standing.played * 3 + 3 && !(standing.played > 0 && standing.goalsFor === 0 && standing.goalsAgainst === 0)) standings.push(standing);
          }
        }
        const absoluteImage = (raw) => {
          try { return raw ? new URL(raw, location.href).href : ""; } catch { return ""; }
        };
        const pageText = compact(document.body?.innerText || "");
        const pageTitle = compact(document.querySelector("h1")?.textContent || document.title || "");
        const pageClubMatch = location.pathname.match(/\/Verein\/(\d+)/i);
        const pageOefbSlug = /vereine\.oefb\.at$/i.test(location.hostname) ? location.pathname.split("/").filter(Boolean)[0] || "" : "";
        const isClubPage = Boolean(pageClubMatch || pageOefbSlug) || /vereinsdaten|verein|club/i.test(pageTitle + " " + pageText.slice(0, 500));
        const clubProfiles = [];
        if (isClubPage) {
          const candidates = [];
          const addCandidate = (url, score) => {
            const absolute = absoluteImage(url);
            if (!absolute || /(?:favicon|icon-192|icon-512|placeholder|default|sponsor|banner)/i.test(absolute)) return;
            if (!/\.(?:png|jpe?g|webp|svg)(?:[?#]|$)/i.test(absolute) && !/logo|wappen|verein|club/i.test(absolute)) return;
            candidates.push({ url: absolute, score });
          };
          addCandidate(document.querySelector('meta[property="og:image"]')?.content, 80);
          addCandidate(document.querySelector('meta[name="twitter:image"]')?.content, 70);
          for (const image of Array.from(document.images)) {
            const meta = compact(`${image.alt || ""} ${image.title || ""} ${image.className || ""} ${image.id || ""} ${image.src || ""}`);
            let score = 0;
            if (/logo|wappen|vereinslogo|club-logo|team-logo/i.test(meta)) score += 100;
            if (/header|profile|portrait|verein|club/i.test(meta)) score += 35;
            const rect = image.getBoundingClientRect();
            if (rect.width >= 60 && rect.height >= 60) score += 15;
            if (rect.width <= 500 && rect.height <= 500) score += 10;
            addCandidate(image.currentSrc || image.src || image.getAttribute("data-src") || image.getAttribute("data-lazy-src"), score);
          }
          candidates.sort((a, b) => b.score - a.score);
          const rawName = compact(document.querySelector("h1")?.textContent || document.querySelector('[class*="club-name"], [class*="verein-name"], [class*="team-name"]')?.textContent || document.title);
          const name = rawName.replace(/\s*[|–-]\s*(?:KFV|ÖFB|Fußball.*)$/i, "").trim();
          if (name && candidates[0]?.url) clubProfiles.push({ name, logoUrl: candidates[0].url, pageUrl: location.href, clubId: pageClubMatch?.[1] ? `kfv:${pageClubMatch[1]}` : (pageOefbSlug ? `oefb:${pageOefbSlug.toLowerCase()}` : "") });
        }
        const squad = [];
        if (/\/Mannschaften\/Saison-\d{4}-\d{2}\/KM\/Kader\/?$/i.test(location.pathname)) {
          const playerLinks = Array.from(document.querySelectorAll("a[href]"))
            .filter((anchor) => /spieler|player|person/i.test(anchor.href));
          const squadSeen = new Set();
          for (const anchor of playerLinks) {
            const card = anchor.closest("article, li, [class*='player'], [class*='spieler'], [class*='squad'], [class*='kader'], .card, div") || anchor;
            const text = compact(card.innerText || card.textContent);
            const heading = compact(
              card.querySelector("h2,h3,h4,[class*='name'],[class*='player-name'],[class*='spieler-name']")?.textContent ||
              anchor.textContent
            );
            const name = heading.replace(/^\d{1,2}\s+/, "").trim();
            if (!name || name.length < 3 || name.length > 90 || squadSeen.has(name.toLowerCase())) continue;
            const numberMatch = text.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
            const positionMatch = text.match(/\b(Tor(?:wart)?|Goalkeeper|Abwehr|Verteidigung|Mittelfeld|Sturm|Angriff)\b/i);
            const image = card.querySelector("img");
            squad.push({
              name,
              number: numberMatch?.[1] || "",
              position: positionMatch?.[1] || "Spieler",
              imageUrl: image?.currentSrc || image?.src || image?.getAttribute("data-src") || "",
              profileUrl: anchor.href,
            });
            squadSeen.add(name.toLowerCase());
          }
        }
        const reports = [];
        const isReportPage = /\/Spielbericht\//i.test(location.pathname) || /[?&](?::s|s)=\d+/i.test(location.href);
        if (isReportPage) {
          const gameId = new URL(location.href).searchParams.get(":s") || new URL(location.href).searchParams.get("s") || location.href.match(/[?&](?::s|s)=(\d+)/i)?.[1] || "";
          const body = compact(document.body?.innerText || "");
          const headingTexts = Array.from(document.querySelectorAll("h1,h2,h3,h4,[role='heading']")).map((node) => compact(node.textContent)).filter(Boolean);
          const teamNames = [];
          for (const node of Array.from(document.querySelectorAll("[class*='team'],[class*='club'],[class*='verein'],h1,h2,h3,h4"))) {
            const text = compact(node.textContent);
            if (text.length < 2 || text.length > 80 || /aufstellung|ersatz|trainer|spielbericht|schiedsrichter|tore|karten|wechsel/i.test(text)) continue;
            if (/ainet|lurnfeld|spg|sv |fc |tsu |union|askö|sportunion/i.test(text) && !teamNames.some((name) => name.toLowerCase() === text.toLowerCase())) teamNames.push(text);
          }
          const playerFromNode = (node) => {
            const text = compact(node.innerText || node.textContent);
            const link = node.querySelector?.("a[href]");
            const nameNode = node.querySelector?.("[class*='name'],[class*='player'],[class*='spieler'],strong,b,a[href]");
            let name = compact(nameNode?.textContent || text).replace(/^\d{1,2}\s+/, "").replace(/\s+\(C\)$/i, "");
            if (!name || name.length < 3 || name.length > 90 || /aufstellung|ersatz|trainer|tore|karten|wechsel|schiedsrichter/i.test(name)) return null;
            const number = Number(text.match(/(?:^|\s)(\d{1,2})(?:\s|$)/)?.[1]);
            const position = compact(text.match(/\b(Tor(?:wart)?|Abwehr|Verteidigung|Mittelfeld|Sturm|Angriff)\b/i)?.[1] || "");
            let playerUrl = ""; try { playerUrl = link?.href || ""; } catch {}
            return { name, number: Number.isInteger(number) ? number : null, position, playerUrl, captain: /\(C\)|Kapitän/i.test(text) };
          };
          const sectionPlayers = (labels) => {
            const result = [];
            for (const heading of Array.from(document.querySelectorAll("h1,h2,h3,h4,[role='heading'],strong,b"))) {
              const title = compact(heading.textContent);
              if (!labels.some((rx) => rx.test(title))) continue;
              const container = heading.closest("section,article,[class*='lineup'],[class*='aufstellung'],[class*='team'],div") || heading.parentElement;
              const candidates = Array.from(container?.querySelectorAll("li,tr,[class*='player'],[class*='spieler'],[class*='person']") || []);
              const players = [];
              for (const candidate of candidates) {
                const player = playerFromNode(candidate);
                if (player && !players.some((item) => item.name.toLowerCase() === player.name.toLowerCase())) players.push(player);
              }
              if (players.length) result.push({ title, players });
            }
            return result;
          };
          const lineupSections = sectionPlayers([/startelf/i,/startaufstellung/i,/^aufstellung$/i]);
          const benchSections = sectionPlayers([/ersatzbank/i,/ersatzspieler/i,/wechselspieler/i]);
          const allPlayerBlocks = Array.from(document.querySelectorAll("[class*='lineup'],[class*='aufstellung'],[class*='formation']"));
          if (!lineupSections.length && allPlayerBlocks.length) {
            for (const block of allPlayerBlocks) {
              const players=[];
              for (const node of Array.from(block.querySelectorAll("li,tr,[class*='player'],[class*='spieler'],[class*='person']"))) {
                const player=playerFromNode(node); if(player&&!players.some(x=>x.name.toLowerCase()===player.name.toLowerCase()))players.push(player);
              }
              if(players.length) lineupSections.push({title:compact(block.querySelector("h2,h3,h4,strong")?.textContent),players});
            }
          }
          const coachMatches = [...body.matchAll(/(?:Trainer(?:in)?|Coach)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß .'-]{3,80})/gi)].map((match) => compact(match[1]).replace(/\s+(?:Ersatz|Aufstellung|Schiedsrichter|Zuschauer).*$/i,""));
          const referee = compact(body.match(/(?:Schiedsrichter(?:in)?|Referee|SR)\s*[:\-]?\s*([A-Za-zÄÖÜäöüß .'-]{3,80})/i)?.[1] || "").replace(/\s+(?:Assistent|Zuschauer|Spielort).*$/i,"");
          const attendanceRaw = body.match(/(?:Zuschauer|Besucher)\s*[:\-]?\s*(\d{1,6})/i)?.[1];
          const events=[];
          const eventNodes=Array.from(document.querySelectorAll("li,tr,[class*='event'],[class*='ereignis'],[class*='ticker'],[class*='timeline']"));
          for(const node of eventNodes){
            const text=compact(node.innerText||node.textContent); if(!text||text.length>250)continue;
            const minuteText=compact(text.match(/\b(\d{1,3}(?:\+\d{1,2})?)\s*['’.]?\s*(?:Min(?:ute)?\.?)?/i)?.[1]||"");
            const minute=minuteText?Number(minuteText.split("+")[0]):null;
            let type="";
            if(/gelb.?rot|gelb-rote/i.test(text))type="yellowRed"; else if(/rote karte|\brot\b/i.test(text))type="red"; else if(/gelbe karte|\bgelb\b/i.test(text))type="yellow"; else if(/wechsel|auswechsl|einwechsl/i.test(text))type="substitution"; else if(/halbzeit|pause/i.test(text))type="halfTime"; else if(/spielende|abpfiff|endstand/i.test(text))type="fullTime"; else if(/\btor\b|torschütze|goal/i.test(text))type="goal"; else continue;
            const names=Array.from(node.querySelectorAll("a[href],[class*='name'],[class*='player'],[class*='spieler'],strong,b")).map(x=>compact(x.textContent)).filter(x=>x.length>=3&&x.length<=90&&!/tor|karte|wechsel|minute|halbzeit|spielende/i.test(x));
            const eventTeam=/heim|home/i.test(compact(node.className))?"home":/gast|away/i.test(compact(node.className))?"away":"neutral";
            events.push({id:`${type}-${minuteText||events.length}-${events.length}`,type,minute,minuteText:minuteText?`${minuteText}'`:"",team:eventTeam,playerName:names[0]||"",secondaryPlayerName:names[1]||"",description:text});
          }
          const uniqueEvents=events.filter((event,index,array)=>array.findIndex(item=>item.type===event.type&&item.minuteText===event.minuteText&&item.playerName===event.playerName)===index);
          reports.push({gameId,reportUrl:location.href,homeTeam:teamNames[0]||"",awayTeam:teamNames[1]||"",homeLineup:lineupSections[0]?.players||[],awayLineup:lineupSections[1]?.players||[],homeBench:benchSections[0]?.players||[],awayBench:benchSections[1]?.players||[],homeCoach:coachMatches[0]||"",awayCoach:coachMatches[1]||"",referee,attendance:attendanceRaw?Number(attendanceRaw):null,events:uniqueEvents,published:Boolean(lineupSections.length||benchSections.length||uniqueEvents.length)});
        }
        return { matches, standings, clubProfiles, squad, reports };
      });

      // 11.2.0: Spielberichte nicht nur über sichtbare Links finden. Sobald eine
      // Spielkarte eine offizielle Spiel-ID oder einen Bericht-Link enthält, wird
      // die kanonische ÖFB-Spielberichtseite ebenfalls in die Browser-Warteschlange
      // aufgenommen. Dadurch werden Aufstellungen auch dann geladen, wenn der Link
      // auf der Mannschaftsseite erst per JavaScript oder hinter einem Button liegt.
      for (const match of structuredSnapshot.matches || []) {
        try {
          const gameId = extractGameId(match.reportUrl, match.context, startUrl);
          const reportUrl = officialReportUrl(match.reportUrl || startUrl, startUrl, match.homeTeam, match.awayTeam) ||
            (gameId ? `https://vereine.oefb.at/${SYNC_CONFIG.clubSlug}/Spielbericht/?spiel-vs-spiel&:s=${encodeURIComponent(gameId)}` : "");
          if (reportUrl) {
            const discovered = safeUrl(reportUrl, startUrl);
            if (!processed.has(discovered) && !queue.includes(discovered)) queue.unshift(discovered);
          }
        } catch { /* unvollständige Spielkarte ignorieren */ }
      }

      resources.push({ text: JSON.stringify({ __browserSnapshot: structuredSnapshot }), contentType: "application/json", finalUrl: safeUrl(page.url() || startUrl, startUrl), origin: "browser-structured" });

      const renderedHtml = await page.content();
      const renderedText = await page.evaluate(() => document.body?.innerText || "");
      const finalUrl = safeUrl(page.url() || startUrl, startUrl);
      resources.push({ text: renderedHtml, contentType: "text/html", finalUrl, origin: "rendered-dom" });
      diagnostics.push({
        url: finalUrl,
        title: await page.title(),
        kind: "browser",
        bytes: Buffer.byteLength(renderedHtml),
        textBytes: Buffer.byteLength(renderedText),
        networkResponses: resources.filter((r) => r.origin === "network").length,
        navigationError,
        discoveredTeamUrls, discoveredClubUrls,
        preview: oneLine(renderedText).slice(0, 1500),
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { resources, diagnostics };
}

async function writeCollection(name, items, runId) {
  const writer = db.bulkWriter();
  writer.onWriteError((error) => {
    console.error(`Firestore-Schreibfehler in ${name}/${error.documentRef?.id || "unbekannt"}:`, error.message);
    return error.failedAttempts < 3;
  });

  for (const item of items) {
    if (!item || typeof item !== "object" || !item.id) continue;
    let payload = { ...item };
    const reference = db.collection(name).doc(String(item.id));

    // Endstände bleiben erhalten, wenn eine unvollständige Quellantwort kurzfristig
    // nur den geplanten Termin liefert. Neue Endstände und Absagen haben Vorrang.
    if (name === MATCH_COLLECTION) {
      const existingSnapshot = await reference.get();
      const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
      const incomingHasScore = Number.isInteger(item.homeScore) && Number.isInteger(item.awayScore);
      const existingHasScore = Number.isInteger(existing?.homeScore) && Number.isInteger(existing?.awayScore);

      // Kurzzeitig fehlende Bild- oder Detailfelder dürfen vorhandene Daten nicht
      // löschen. Das verhindert zeitweise verschwundene Vereinslogos.
      if (existing) {
        payload.homeLogoUrl = item.homeLogoUrl || existing.homeLogoUrl || "";
        payload.awayLogoUrl = item.awayLogoUrl || existing.awayLogoUrl || "";
        payload.venue = item.venue || existing.venue || "";
        payload.venueAddress = item.venueAddress || existing.venueAddress || "";
        payload.referee = item.referee || existing.referee || "";
        payload.reportUrl = item.reportUrl || existing.reportUrl || "";
        payload.liveUrl = item.liveUrl || existing.liveUrl || "";
      }

      if (item.status === "cancelled" || item.status === "postponed") {
        payload.homeScore = null;
        payload.awayScore = null;
        payload.resultText = "";
      } else if (!incomingHasScore && existingHasScore && existing?.status === "finished") {
        payload.homeScore = existing.homeScore;
        payload.awayScore = existing.awayScore;
        payload.resultText = existing.resultText || `${existing.homeScore}:${existing.awayScore}`;
        payload.status = "finished";
      }
    }

    // Bereits veröffentlichte Spielberichte dürfen durch eine kurzfristig leere
    // oder unvollständig geladene ÖFB-Seite nicht überschrieben werden.
    if (name === "kfvMatchReports") {
      const existingSnapshot = await reference.get();
      const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
      const incomingContent = (item.homeLineup?.length || 0) + (item.awayLineup?.length || 0) +
        (item.homeBench?.length || 0) + (item.awayBench?.length || 0) + (item.events?.length || 0);
      const existingContent = (existing?.homeLineup?.length || 0) + (existing?.awayLineup?.length || 0) +
        (existing?.homeBench?.length || 0) + (existing?.awayBench?.length || 0) + (existing?.events?.length || 0);
      if (existing && existingContent > incomingContent) {
        payload = {
          ...item,
          homeTeam: item.homeTeam || existing.homeTeam || "",
          awayTeam: item.awayTeam || existing.awayTeam || "",
          homeLineup: existing.homeLineup || item.homeLineup || [],
          awayLineup: existing.awayLineup || item.awayLineup || [],
          homeBench: existing.homeBench || item.homeBench || [],
          awayBench: existing.awayBench || item.awayBench || [],
          homeCoach: item.homeCoach || existing.homeCoach || "",
          awayCoach: item.awayCoach || existing.awayCoach || "",
          referee: item.referee || existing.referee || "",
          attendance: Number.isInteger(item.attendance) ? item.attendance : (existing.attendance ?? null),
          events: existing.events || item.events || [],
          published: existing.published === true || item.published === true,
          reportUrl: item.reportUrl || existing.reportUrl || "",
          preservedFromPreviousSync: true,
        };
      }
    }

    // Auch Tabellen- und Vereinslogo-Dokumente behalten ein bereits vorhandenes
    // Logo, falls die Quelle es in einem einzelnen Lauf nicht liefert.
    if (name === STANDING_COLLECTION || name === "kfvClubs") {
      const existingSnapshot = await reference.get();
      const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
      if (existing) {
        if (name === STANDING_COLLECTION) payload.teamLogoUrl = item.teamLogoUrl || existing.teamLogoUrl || "";
        if (name === "kfvClubs") {
          const existingLogo = existing.logoUrl || "";
          const incomingLogo = item.logoUrl || "";
          const existingLooksLikeAinet = /tsu[-_ ]?ainet|ainet-logo/i.test(existingLogo);
          payload.logoUrl = (!isAinetClubName(item.name) && existingLooksLikeAinet) ? incomingLogo : (incomingLogo || existingLogo);
          payload.oefbClubId = item.oefbClubId || existing.oefbClubId || "";
          payload.pageUrl = item.pageUrl || existing.pageUrl || "";
          payload.aliases = item.aliases?.length ? item.aliases : (existing.aliases || []);
        }
      }
    }

    // In der App manuell bearbeitete ÖFB-Kaderspieler behalten ihre Änderungen.
    if (name === "kfvSquad") {
      const existingSnapshot = await reference.get();
      const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
      if (existing?.manualOverride === true) {
        payload = {
          ...item,
          name: typeof existing.name === "string" ? existing.name : item.name,
          number: typeof existing.number === "number" || existing.number === null ? existing.number : item.number,
          position: typeof existing.position === "string" ? existing.position : item.position,
          imageUrl: typeof existing.imageUrl === "string" ? existing.imageUrl : item.imageUrl,
          profileUrl: typeof existing.profileUrl === "string" ? existing.profileUrl : item.profileUrl,
          birthday: typeof existing.birthday === "string" ? existing.birthday : (existing.birthday || ""),
          active: typeof existing.active === "boolean" ? existing.active : item.active,
          order: typeof existing.order === "number" ? existing.order : (typeof item.order === "number" ? item.order : 999),
          manualOverride: true,
          manualUpdatedAt: existing.manualUpdatedAt || admin.firestore.FieldValue.serverTimestamp(),
        };
      }
    }

    const documentData = removeUndefinedDeep({
      ...payload,
      syncRunId: runId,
      sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    writer.set(reference, documentData, { merge: false });
  }
  await writer.close();
}

async function cleanupExistingMatchDuplicates(runId) {
  const snapshot = await db.collection(MATCH_COLLECTION).get();
  const groups = new Map();

  for (const document of snapshot.docs) {
    const data = document.data();
    if (data.source !== "oefb-public" || data.active === false) continue;
    const key = buildMatchUid(data);
    if (!key || key.includes("||")) continue;
    const group = groups.get(key) || [];
    group.push({ id: document.id, ref: document.ref, ...data });
    groups.set(key, group);
  }

  const writer = db.bulkWriter();
  let deactivated = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Der Datensatz aus dem aktuellen Lauf ist die verlässlichste Quelle. Alte
    // Dubletten dürfen insbesondere kein bereits verschobenes Datum zurückschreiben.
    const currentRunItems = group.filter((item) => item.syncRunId === runId);
    const merged = mergeDuplicateMatches(currentRunItems.length ? currentRunItems : group);
    const canonicalId = merged.id;
    const canonicalRef = db.collection(MATCH_COLLECTION).doc(canonicalId);
    writer.set(canonicalRef, removeUndefinedDeep({
      ...merged,
      active: true,
      syncRunId: runId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }), { merge: true });

    for (const duplicate of group) {
      if (duplicate.id === canonicalId) continue;
      writer.set(duplicate.ref, {
        active: false,
        duplicateOf: canonicalId,
        deactivatedReason: "duplicate",
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncRunId: runId,
      }, { merge: true });
      deactivated += 1;
    }
  }
  await writer.close();
  return deactivated;
}

async function deactivateMissing(name, currentIds, runId) {
  const snapshot = await db.collection(name).where("source", "==", "oefb-public").get();
  const writer = db.bulkWriter();
  let deactivated = 0;
  for (const doc of snapshot.docs) {
    if (!currentIds.has(doc.id) && doc.data().active !== false) {
      writer.set(doc.ref, {
        active: false,
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncRunId: runId,
      }, { merge: true });
      deactivated += 1;
    }
  }
  await writer.close();
  return deactivated;
}

async function deactivateMissingForTeams(name, currentIds, teamKeys, runId) {
  if (!teamKeys || teamKeys.size === 0) return 0;
  const snapshot = await db.collection(name).where("source", "==", "oefb-public").get();
  const writer = db.bulkWriter();
  let deactivated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!teamKeys.has(data.teamKey)) continue;
    if (!currentIds.has(doc.id) && data.active !== false) {
      writer.set(doc.ref, {
        active: false,
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deactivatedReason: "replaced-by-team-specific-table",
        syncRunId: runId,
      }, { merge: true });
      deactivated += 1;
    }
  }
  await writer.close();
  return deactivated;
}

async function main() {
  const statusRef = db.doc("settings/kfvSyncStatus");
  const startedAt = admin.firestore.Timestamp.now();
  const runId = String(startedAt.toMillis());
  const runRef = db.collection("kfvSyncRuns").doc(runId);
  const trigger = process.env.GITHUB_ACTIONS ? "github-actions" : "local";
  const initialRunData = {
    runId, status: "running", running: true, success: null,
    trigger, startedAt, intervalMinutes: SYNC_INTERVAL_MINUTES, provider: "github-actions", parserVersion: PARSER_VERSION,
  };
  await Promise.all([
    statusRef.set(initialRunData, { merge: true }),
    runRef.set(initialRunData, { merge: false }),
  ]);

  try {
    const settings = (await db.doc("settings/kfvSync").get()).data() || {};
    const configured = settings.sourceUrl && String(settings.sourceUrl).includes("oefb.at")
      ? safeUrl(settings.sourceUrl)
      : DEFAULT_SOURCE;
    const startUrls = [...new Set(START_URLS)];
    const sourceUrl = configured;
    const visited = new Set(startUrls);
    const matches = [];
    const standings = [];
    const squad = [];
    const clubProfiles = [];
    const matchReports = [];
    const warnings = [];
    const pageDiagnostics = [];
    const teamSyncStatus = Object.fromEntries(ACTIVE_TEAMS.map((team) => [team.key, {
      teamKey: team.key, teamName: team.name, gamesUrl: team.gamesUrl, tableUrl: team.tableUrl,
      gameResources: 0, tableResources: 0, rawMatches: 0, rawStandings: 0, warnings: [],
    }]));

    const browserResult = await collectWithBrowser(startUrls);
    pageDiagnostics.push(...browserResult.diagnostics);

    for (const resource of browserResult.resources) {
      try {
        if (resource.contentType.includes("json") && resource.text.includes("__browserSnapshot")) {
          try {
            const rawSnapshot = JSON.parse(resource.text).__browserSnapshot;
            importClubProfiles(rawSnapshot, clubProfiles, resource.finalUrl);
            importMatchReports(rawSnapshot, matchReports, resource.finalUrl);
          } catch { /* parseResource reports malformed data below */ }
        }
        const parsed = parseResource(resource.text, resource.contentType, resource.finalUrl);
        const descriptor = sourceDescriptor(resource.finalUrl);
        // Version 12 akzeptiert Spiel- und Tabellendaten ausschließlich aus der
        // fest zugeordneten Mannschaftsquelle. Netzwerkantworten oder allgemeine
        // Vereinsseiten dürfen keine fremden Daten mehr einmischen.
        if (descriptor.teamKey && descriptor.kind === "games") {
          for (const item of parsed.matches) {
            if (item.teamKey === descriptor.teamKey) matches.push(item);
          }
        }
        if (descriptor.teamKey && descriptor.kind === "table") {
          for (const item of parsed.standings) {
            if (item.teamKey === descriptor.teamKey) standings.push(item);
          }
        }
        if (descriptor.teamKey && descriptor.kind === "squad") {
          for (const item of parsed.squad) {
            if (item.teamKey === descriptor.teamKey) squad.push(item);
          }
        }
        if (parsed.teamKey && teamSyncStatus[parsed.teamKey]) {
          const teamStatus = teamSyncStatus[parsed.teamKey];
          if (parsed.sourceKind === "games") teamStatus.gameResources += 1;
          if (parsed.sourceKind === "table") teamStatus.tableResources += 1;
          teamStatus.rawMatches += parsed.matches.length;
          teamStatus.rawStandings += parsed.standings.length;
        }
        if (resource.origin === "network") {
          pageDiagnostics.push({
            url: resource.finalUrl, title: parsed.title, kind: `network-${parsed.kind}`,
            bytes: parsed.bytes, matches: parsed.matches.length, standings: parsed.standings.length, squad: parsed.squad.length,
            preview: parsed.textPreview || "",
          });
        }
      } catch (error) {
        warnings.push(`${resource.finalUrl}: ${error.message}`);
        const descriptor = sourceDescriptor(resource.finalUrl);
        if (descriptor.teamKey && teamSyncStatus[descriptor.teamKey]) teamSyncStatus[descriptor.teamKey].warnings.push(String(error.message || error));
      }
    }

    // Dieselbe Begegnung wird auf der ÖFB-Seite häufig über mehrere Ansichten
    // erkannt. Gruppiert wird deshalb unabhängig vom Seitentitel/Bewerbsnamen.
    const matchGroups = new Map();
    for (const item of matches) {
      const key = canonicalMatchKey(item);
      if (!key || key.includes("||")) continue;
      const group = matchGroups.get(key) || [];
      group.push(item);
      matchGroups.set(key, group);
    }
    let uniqueMatches = [...matchGroups.values()]
      .map(mergeDuplicateMatches)
      .sort((a, b) => a.kickoffAt.toMillis() - b.kickoffAt.toMillis());

    // Core Reset: Die neue V12-Collection startet sauber. Alte V11-Dokumente
    // werden absichtlich nicht übernommen, damit Kalender, Dashboard und Tabelle
    // nicht länger mit historischen oder falsch zugeordneten Datensätzen vermischt werden.
    const preservedExistingMatches = 0;

    const duplicateMatchesRemoved = Math.max(0, matches.length - (uniqueMatches.length - preservedExistingMatches));
    if (duplicateMatchesRemoved > 0) {
      warnings.push(`${duplicateMatchesRemoved} doppelte Spielerkennungen wurden zusammengeführt.`);
    }

    const standingMap = new Map();
    for (const item of standings) {
      item.competitionName = cleanCompetitionTitle(item.competitionName, item.teamName);
      if (!isPlausibleStandingRow(item)) continue;
      const normalizedClub = clubKey(item.clubName) || slug(item.clubName);
      const key = `${item.teamKey}|${normalizedClub}`;
      const previous = standingMap.get(key);
      const itemQuality = [item.played, item.won, item.drawn, item.lost, item.points].filter(Number.isFinite).length;
      const previousQuality = previous
        ? [previous.played, previous.won, previous.drawn, previous.lost, previous.points].filter(Number.isFinite).length
        : -1;
      standingMap.set(key, !previous || itemQuality >= previousQuality ? {
        ...previous,
        ...item,
        id: previous?.id || item.id,
        teamLogoUrl: item.teamLogoUrl || previous?.teamLogoUrl || "",
      } : previous);
    }
    let uniqueStandings = [...standingMap.values()]
      .filter((row) => row.position > 0 && row.position <= 100 && row.clubName)
      .sort((a, b) => a.teamKey.localeCompare(b.teamKey) || a.position - b.position);
    const standingGroups = new Map();
    for (const row of uniqueStandings) {
      const key = `${row.teamKey}|${row.competitionName}`;
      const group = standingGroups.get(key) || [];
      group.push(row); standingGroups.set(key, group);
    }
    const reliableStandingTeams = new Set();
    uniqueStandings = [...standingGroups.entries()]
      .filter(([key, group]) => {
        const positions = group.map((row) => row.position).sort((a, b) => a - b);
        const uniquePositions = new Set(positions).size === group.length;
        const containsAinet = group.some((row) => /\bainet\b/i.test(row.clubName));
        const plausibleRange = positions[0] === 1 && positions.at(-1) <= 30;
        const reliable = group.length >= 4 && uniquePositions && containsAinet && plausibleRange;
        if (reliable) reliableStandingTeams.add(group[0].teamKey);
        return reliable;
      })
      .flatMap(([, group]) => group)
      .sort((a, b) => a.teamKey.localeCompare(b.teamKey) || a.position - b.position);
    for (const team of ACTIVE_TEAMS) {
      const status = teamSyncStatus[team.key];
      status.matches = uniqueMatches.filter((item) => item.teamKey === team.key && !item.preservedFromPreviousSync).length;
      status.standings = uniqueStandings.filter((item) => item.teamKey === team.key).length;
      status.tableReliable = reliableStandingTeams.has(team.key);
      if (!status.tableReliable) warnings.push(`${team.name}: Tabelle nicht ersetzt, weil keine vollständige plausible Tabelle erkannt wurde.`);
    }
    const uniqueSquad = [...new Map(squad.map((item) => [item.id, item])).values()]
      .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.name.localeCompare(b.name, "de-AT"));

    // Version 13: zentrale Vereinsdatenbank mit eindeutiger Vereins-ID.
    // Namens-Aliase bleiben nur als Rückfalloption für Quellen ohne Link erhalten.
    const profileMap = new Map();
    const profileIdMap = new Map();
    const registerProfile = (name, logoUrl, pageUrl = "", clubId = "") => {
      if (!name) return;
      const identity = clubId || extractClubIdentity(pageUrl, name).clubId;
      const safeLogo = safeImageUrl(logoUrl, pageUrl || sourceUrl);
      const profile = {
        id: makeId(["kfv-club-v13", identity || clubKey(name) || name]), name: oneLine(name),
        normalizedName: clubKey(name), aliases: clubAliases(name), logoUrl: safeLogo,
        pageUrl: pageUrl || "", oefbClubId: identity || "", source: "oefb-public", active: true,
      };
      if (identity) {
        const previous = profileIdMap.get(identity);
        if (!previous || (!previous.logoUrl && safeLogo)) profileIdMap.set(identity, { ...previous, ...profile, logoUrl: safeLogo || previous?.logoUrl || "" });
      }
      for (const alias of clubAliases(name)) {
        const previous = profileMap.get(alias);
        if (!previous || (!previous.logoUrl && safeLogo)) profileMap.set(alias, { ...previous, ...profile, logoUrl: safeLogo || previous?.logoUrl || "" });
      }
    };
    for (const profile of clubProfiles) registerProfile(profile.name, profile.logoUrl, profile.pageUrl, profile.oefbClubId);
    for (const item of uniqueMatches) {
      registerProfile(item.homeTeam, item.homeLogoUrl, item.homeClubUrl || item.sourceUrl, item.homeClubId);
      registerProfile(item.awayTeam, item.awayLogoUrl, item.awayClubUrl || item.sourceUrl, item.awayClubId);
    }
    for (const item of uniqueStandings) registerProfile(item.clubName, item.teamLogoUrl, item.clubUrl || item.sourceUrl, item.clubId);

    const allProfiles = [...profileIdMap.values(), ...profileMap.values()];
    const ainetLogoFingerprints = new Set(
      allProfiles.filter((profile) => isAinetClubName(profile.name)).map((profile) => logoFingerprint(profile.logoUrl)).filter(Boolean),
    );
    const isInvalidForeignLogo = (name, logoUrl) => !isAinetClubName(name) && ainetLogoFingerprints.has(logoFingerprint(logoUrl));
    for (const [key, profile] of [...profileIdMap.entries()]) if (isInvalidForeignLogo(profile.name, profile.logoUrl)) profileIdMap.set(key, { ...profile, logoUrl: "" });
    for (const [key, profile] of [...profileMap.entries()]) if (isInvalidForeignLogo(profile.name, profile.logoUrl)) profileMap.set(key, { ...profile, logoUrl: "" });

    for (const item of uniqueMatches) {
      if (isInvalidForeignLogo(item.homeTeam, item.homeLogoUrl)) item.homeLogoUrl = "";
      if (isInvalidForeignLogo(item.awayTeam, item.awayLogoUrl)) item.awayLogoUrl = "";
      const homeProfile = chooseClubProfile(profileMap, profileIdMap, item.homeTeam, item.homeClubId);
      const awayProfile = chooseClubProfile(profileMap, profileIdMap, item.awayTeam, item.awayClubId);
      item.homeLogoUrl = item.homeLogoUrl || homeProfile?.logoUrl || "";
      item.awayLogoUrl = item.awayLogoUrl || awayProfile?.logoUrl || "";
      item.homeClubId = item.homeClubId || homeProfile?.oefbClubId || "";
      item.awayClubId = item.awayClubId || awayProfile?.oefbClubId || "";
    }
    uniqueStandings = uniqueStandings.map((item) => {
      const profile = chooseClubProfile(profileMap, profileIdMap, item.clubName, item.clubId);
      return { ...item, clubId: item.clubId || profile?.oefbClubId || "", teamLogoUrl: item.teamLogoUrl || profile?.logoUrl || "" };
    });
    const uniqueClubProfiles = [...new Map([...profileIdMap.values(), ...profileMap.values()].map((item) => [item.id, item])).values()]
      .map((profile) => isInvalidForeignLogo(profile.name, profile.logoUrl) ? { ...profile, logoUrl: "" } : profile);

    const matchByGameId = new Map(uniqueMatches.filter((item) => item.gameId).map((item) => [String(item.gameId), item]));
    const reportMap = new Map();
    for (const rawReport of matchReports) {
      const linkedMatch = matchByGameId.get(String(rawReport.oefbMatchId || ""));
      const report = {
        ...rawReport,
        homeTeam: rawReport.homeTeam || linkedMatch?.homeTeam || "",
        awayTeam: rawReport.awayTeam || linkedMatch?.awayTeam || "",
        reportUrl: rawReport.reportUrl || linkedMatch?.reportUrl || "",
      };
      const previous = reportMap.get(report.id);
      const quality = (item) => item.homeLineup.length + item.awayLineup.length + item.homeBench.length + item.awayBench.length + item.events.length * 2 + (item.referee ? 1 : 0) + (item.attendance !== null ? 1 : 0);
      if (!previous || quality(report) >= quality(previous)) reportMap.set(report.id, report);
    }
    const activeWindowGameIds = new Set(uniqueMatches.filter((item) => isInActiveSyncWindow(item.kickoffAt)).map((item) => String(item.gameId || item.oefbMatchId || "")).filter(Boolean));
    const uniqueMatchReports = [...reportMap.values()]
      .filter((item) => activeWindowGameIds.has(String(item.oefbMatchId || "")))
      .filter((item) => item.published || item.homeLineup.length || item.awayLineup.length || item.homeBench.length || item.awayBench.length || item.events.length)
      .map((item) => ({
        ...item,
        lineupPlayerCount: item.homeLineup.length + item.awayLineup.length,
        benchPlayerCount: item.homeBench.length + item.awayBench.length,
        eventCount: item.events.length,
        dataQuality: item.homeLineup.length && item.awayLineup.length ? "complete" : item.events.length || item.homeLineup.length || item.awayLineup.length ? "partial" : "empty",
      }));

    const matchesWithReportId = uniqueMatches.filter((item) => item.gameId && item.reportUrl).length;
    if (matchesWithReportId > 0 && uniqueMatchReports.length === 0) {
      warnings.push(`${matchesWithReportId} Spiele besitzen einen offiziellen Bericht-Link, aber es wurden noch keine veröffentlichten Berichtsdaten erkannt.`);
    }

    if (uniqueSquad.length === 0) {
      const squadWarning = "ÖFB-Kader-Sync: 0 Spieler erkannt. Bestehende Kaderdaten bleiben unverändert.";
      warnings.push(squadWarning);
      console.warn(`⚠ ${squadWarning}`);
      console.warn(`Geprüfte Kader-URLs: ${SQUAD_URLS.join(", ")}`);
      console.warn("Der restliche Sync wird fortgesetzt; kfvSquad wird weder überschrieben noch deaktiviert.");
    } else {
      console.log(`✅ ÖFB-Kader-Sync: ${uniqueSquad.length} Spieler erkannt.`);
    }

    if (uniqueMatches.length === 0) {
      await statusRef.set({
        running: false, success: false,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceUrl, discoveredUrls: [...visited], visitedUrls: [...visited], pageDiagnostics,
        warningCount: warnings.length, warnings: warnings.slice(0, 30),
        parserVersion: PARSER_VERSION,
        lastError: "ÖFB-Seiten wurden geladen, aber keine Spiele erkannt. Der Lauf wurde absichtlich abgebrochen, damit bestehende Spieldaten nicht fälschlich deaktiviert werden.",
      }, { merge: true });
      throw new Error("ÖFB-Browser-Sync: 0 Spiele erkannt. Bestehende Spieldaten bleiben unverändert. Bitte settings/kfvSyncStatus → pageDiagnostics prüfen.");
    }

    const standingsReliable = reliableStandingTeams.size > 0;
    if (!standingsReliable) {
      warnings.push(`Tabellen-Sync wurde übersprungen: nur ${uniqueStandings.length} plausible Tabellenzeilen erkannt.`);
    }

    const existingMatchesSnapshot = await db.collection(MATCH_COLLECTION).get();
    const existingMatchIds = new Set(existingMatchesSnapshot.docs.map((document) => document.id));
    const newMatchCount = uniqueMatches.filter((item) => !existingMatchIds.has(item.id)).length;
    const updatedMatchCount = uniqueMatches.length - newMatchCount;

    await writeCollection(MATCH_COLLECTION, uniqueMatches.map((item) => ({ ...item, datasetVersion: DATASET_VERSION })), runId);
    if (standingsReliable) await writeCollection(STANDING_COLLECTION, uniqueStandings.map((item) => ({ ...item, datasetVersion: DATASET_VERSION })), runId);
    if (uniqueClubProfiles.length) await writeCollection("kfvClubs", uniqueClubProfiles, runId);
    if (uniqueSquad.length) await writeCollection("kfvSquad", uniqueSquad, runId);
    if (uniqueMatchReports.length) await writeCollection("kfvMatchReports", uniqueMatchReports, runId);
    // Zuerst alte IDs auf die neue stabile matchUid migrieren und als Dubletten
    // markieren. Erst danach werden nicht mehr vorhandene Spiele deaktiviert.
    const duplicateDocumentsDeactivated = RUN_DUPLICATE_CLEANUP
      ? await cleanupExistingMatchDuplicates(runId)
      : 0;
    if (!RUN_DUPLICATE_CLEANUP) console.log("Dublettenbereinigung: heute übersprungen.");
    // Spiele werden bei einem teilweise geladenen ÖFB-Spielplan nicht deaktiviert.
    // Echte Dubletten wurden bereits durch cleanupExistingMatchDuplicates bereinigt.
    const deactivatedMatches = 0;
    const deactivatedStandings = standingsReliable
      ? await deactivateMissingForTeams(STANDING_COLLECTION, new Set(uniqueStandings.map((item) => item.id)), reliableStandingTeams, runId)
      : 0;
    const deactivatedSquad = uniqueSquad.length
      ? await deactivateMissing("kfvSquad", new Set(uniqueSquad.map((item) => item.id)), runId)
      : 0;
    // Spielberichte bleiben erhalten, wenn eine ÖFB-Seite in einem Lauf nicht
    // erreichbar oder noch nicht veröffentlicht ist. Deshalb werden alte
    // Berichte nicht automatisch deaktiviert.
    const deactivatedMatchReports = 0;

    const finishedAt = admin.firestore.Timestamp.now();
    const durationMs = finishedAt.toMillis() - startedAt.toMillis();
    const successRunData = {
      runId, status: "success", running: false, success: true,
      lastSuccessAt: finishedAt,
      finishedAt, durationMs,
      sourceUrl, discoveredUrls: [...visited], visitedUrls: [...visited], pageDiagnostics,
      matchCount: uniqueMatches.length,
      rawMatchCount: matches.length,
      newMatchCount,
      updatedMatchCount,
      duplicateMatchesRemoved,
      duplicateDocumentsDeactivated,
      matchIdentityVersion: "11.0.1",
      finishedMatchCount: uniqueMatches.filter((item) => item.status === "finished").length,
      scheduledMatchCount: uniqueMatches.filter((item) => item.status === "scheduled").length,
      postponedMatchCount: uniqueMatches.filter((item) => item.status === "postponed").length,
      cancelledMatchCount: uniqueMatches.filter((item) => item.status === "cancelled").length,
      standingCount: standingsReliable ? uniqueStandings.length : 0,
      standingsReliable,
      matchReportCount: uniqueMatchReports.length,
      lineupReportCount: uniqueMatchReports.filter((item) => item.homeLineup.length || item.awayLineup.length).length,
      matchEventCount: uniqueMatchReports.reduce((sum, item) => sum + item.events.length, 0),
      deactivatedMatchReports,
      squadCount: uniqueSquad.length, clubLogoCount: uniqueClubProfiles.length,
      teamCounts: uniqueMatches.reduce((result, item) => { result[item.teamKey] = (result[item.teamKey] || 0) + 1; return result; }, {}),
      standingTeamCounts: uniqueStandings.reduce((result, item) => { result[item.teamKey] = (result[item.teamKey] || 0) + 1; return result; }, {}),
      squadTeamCounts: uniqueSquad.reduce((result, item) => { result[item.teamKey] = (result[item.teamKey] || 0) + 1; return result; }, {}),
      teamSyncStatus,
      syncArchitecture: "v12-single-source-of-truth",
      deactivatedMatches, deactivatedStandings, deactivatedSquad,
      warningCount: warnings.length, warnings: warnings.slice(0, 30),
      intervalMinutes: SYNC_INTERVAL_MINUTES, provider: "github-actions", parserVersion: PARSER_VERSION,
      lastError: admin.firestore.FieldValue.delete(),
    };
    await Promise.all([
      statusRef.set(successRunData, { merge: true }),
      runRef.set({ ...successRunData, lastError: "" }, { merge: true }),
    ]);

    const squadTeamCounts = uniqueSquad.reduce((result, item) => {
      result[item.teamKey] = (result[item.teamKey] || 0) + 1;
      return result;
    }, {});
    const matchStatusCounts = uniqueMatches.reduce((result, item) => {
      result[item.status] = (result[item.status] || 0) + 1;
      return result;
    }, {});
    console.log("===== TSU Ainet ÖFB-Sync 12.2.0 Official Team Pages =====");
    console.log(`Spiele gesamt: ${uniqueMatches.length} (${duplicateMatchesRemoved} Quell-Dubletten zusammengeführt)`);
    console.log(`Aus früherem Sync erhaltene Spiele: ${preservedExistingMatches}`);
    console.log(`Neue Spiele: ${newMatchCount}`);
    console.log(`Aktualisierte Spiele: ${updatedMatchCount}`);
    console.log(`Alte Firestore-Dubletten deaktiviert: ${duplicateDocumentsDeactivated}`);
    console.log(`  Geplant: ${matchStatusCounts.scheduled || 0}`);
    console.log(`  Beendet/Endstand: ${matchStatusCounts.finished || 0}`);
    console.log(`  Verschoben: ${matchStatusCounts.postponed || 0}`);
    console.log(`  Abgesagt: ${matchStatusCounts.cancelled || 0}`);
    console.log(`Tabellenzeilen: ${standingsReliable ? uniqueStandings.length : "übersprungen (unvollständig)"}`);
    for (const team of ACTIVE_TEAMS) {
      const status = teamSyncStatus[team.key];
      console.log(`${team.name}: ${status.matches || 0} Spiele | ${status.standings || 0} Tabellenzeilen | Tabelle ${status.tableReliable ? "OK" : "beibehalten"}`);
      console.log(`  Spiele: ${team.gamesUrl}`);
      console.log(`  Tabelle: ${team.tableUrl}`);
    }
    console.log(`Kaderspieler: ${uniqueSquad.length} aus ${Object.keys(squadTeamCounts).length} Mannschaften`);
    console.log(`Vereinslogos: ${uniqueClubProfiles.length}`);
    console.log(`Offizielle Spielberichte: ${uniqueMatchReports.length}`);
    console.log(`  Mit Aufstellungen: ${uniqueMatchReports.filter((item) => item.lineupPlayerCount > 0).length}`);
    console.log(`  Importierte Ereignisse: ${uniqueMatchReports.reduce((sum, item) => sum + item.eventCount, 0)}`);
    console.log(`Warnungen: ${warnings.length}`);
  } catch (error) {
    const finishedAt = admin.firestore.Timestamp.now();
    const durationMs = finishedAt.toMillis() - startedAt.toMillis();
    const errorRunData = {
      runId, status: "error", running: false, success: false,
      startedAt, finishedAt, durationMs,
      lastError: String(error.message || error),
      intervalMinutes: SYNC_INTERVAL_MINUTES, provider: "github-actions", parserVersion: PARSER_VERSION,
    };
    await Promise.all([
      statusRef.set(errorRunData, { merge: true }),
      runRef.set(errorRunData, { merge: true }),
    ]);
    throw error;
  }
}

main().catch((error) => {
  console.error("ÖFB-Sync fehlgeschlagen:", error);
  process.exit(1);
});
