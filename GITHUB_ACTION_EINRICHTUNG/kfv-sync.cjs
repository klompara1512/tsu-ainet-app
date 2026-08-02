process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const cheerio = require("cheerio");
const crypto = require("crypto");
const puppeteer = require("puppeteer");

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

// Firestore verwirft optionale Felder mit dem Wert `undefined`.
// Das verhindert, dass ein einzelnes unvollständiges ÖFB-Feld den gesamten
// Synchronisationslauf abbricht.
db.settings({ ignoreUndefinedProperties: true });

const DEFAULT_SOURCE = "https://vereine.oefb.at/TsuAinet/Mannschaften/Saison-2026-27/KM/Spiele";
const TEAM_PAGES = [
  { key: "KM", name: "Kampfmannschaft", slugs: ["KM"] },
  { key: "CHALLENGE", name: "Challenge", slugs: ["Challenge", "KM-Res", "KM-Reserve", "Reserve", "Res"] },
  { key: "U17", name: "U17", slugs: ["U17", "U17-A"] },
  { key: "U12", name: "U12", slugs: ["U12", "U12-A"] },
  { key: "U10", name: "U10", slugs: ["U10", "U10-A"] },
  { key: "U08", name: "U8", slugs: ["U08", "U8", "U08-A"] },
];
const TEAM_DIRECTORY_URL = "https://vereine.oefb.at/TsuAinet/Mannschaften";
const START_URLS = [TEAM_DIRECTORY_URL, ...TEAM_PAGES.flatMap((team) => team.slugs.flatMap((slugName) => [
  `https://vereine.oefb.at/TsuAinet/Mannschaften/Saison-2026-27/${slugName}/Spiele`,
  `https://vereine.oefb.at/TsuAinet/Mannschaften/Saison-2026-27/${slugName}/Tabellen`,
]))];
const MAX_PAGES = 40;
const PARSER_VERSION = "6.5.1-undefined-firestore-fix";

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
  const allowedHost = url.hostname === "oefb.at" || url.hostname.endsWith(".oefb.at");
  if (url.protocol !== "https:" || !allowedHost) {
    throw new Error("Nur öffentliche ÖFB-HTTPS-URLs sind erlaubt.");
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

function addMatch(target, data, sourceUrl, context = "") {
  const kickoff = data.kickoff instanceof Date ? data.kickoff : parseDate(data.kickoff || context, new Date().getFullYear(), sourceUrl);
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

  // Resultate niemals aus dem gesamten Karten-/Seitentext ableiten: Dort steht auch die Anstoßzeit.
  // Nur ein ausdrücklich vom Parser erkanntes Ergebnis darf als Score gespeichert werden.
  const [parsedHomeScore, parsedAwayScore] = parseScore(data.score || "");
  let homeScore = Number.isInteger(data.homeScore) ? data.homeScore : parsedHomeScore;
  let awayScore = Number.isInteger(data.awayScore) ? data.awayScore : parsedAwayScore;

  // Letzte Sicherheitsstufe: Wenn die vermeintlichen Tore exakt der Anstoßzeit entsprechen,
  // handelt es sich um eine falsch gelesene Uhrzeit und nicht um ein Resultat.
  if (homeScore === kickoff.getHours() && awayScore === kickoff.getMinutes()) {
    homeScore = null;
    awayScore = null;
  }
  const urlTeam = teamFromUrl(sourceUrl);
  const teamName = urlTeam?.teamName || data.teamName || teamFromText(`${data.competitionName || ""} ${context}`);
  const teamKey = urlTeam?.teamKey || data.teamKey || slug(teamName).toUpperCase();
  const contextLower = lower(context);
  const status = data.status || (
    /abgesagt|annulliert/.test(contextLower) ? "cancelled" :
    /verschoben/.test(contextLower) ? "postponed" :
    homeScore !== null && awayScore !== null ? "finished" : "scheduled"
  );

  target.push({
    id: makeId(["kfv-match", teamKey, kickoff.toISOString(), homeTeam, awayTeam]),
    teamId: slug(teamName), teamKey, teamName,
    season: seasonFromUrl(sourceUrl),
    competitionType: /cup|pokal/i.test(data.competitionName || context) ? "Cup" : /test|freund/i.test(data.competitionName || context) ? "Freundschaftsspiel" : "Liga",
    isHomeGame: /ainet/i.test(homeTeam),
    competitionName: oneLine(data.competitionName) || "ÖFB",
    homeTeam, awayTeam,
    homeLogoUrl: safeImageUrl(data.homeLogoUrl, sourceUrl),
    awayLogoUrl: safeImageUrl(data.awayLogoUrl, sourceUrl),
    homeScore, awayScore,
    kickoffAt: admin.firestore.Timestamp.fromDate(kickoff),
    venue: oneLine(data.venue), status,
    reportUrl: data.reportUrl ? safeUrl(data.reportUrl, sourceUrl) : sourceUrl,
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
    competitionName: oneLine(data.competitionName) || "ÖFB",
    position, clubName,
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
  const match = text.match(/^(endstand\s*)?(\d{1,2})\s*:\s*(\d{1,2})(?:\s*(?:\([^)]*\)|i\.?\s*e\.?|n\.?\s*v\.?))?$/i);
  if (!match) return null;

  const leftRaw = match[2];
  const rightRaw = match[3];
  const homeScore = Number(leftRaw);
  const awayScore = Number(rightRaw);

  // ÖFB zeigt Anstoßzeiten ebenfalls mit Doppelpunkt. Werte wie 17:00, 18:30 oder 19:00
  // dürfen niemals als Resultat importiert werden. Ein ausdrücklich vorangestelltes "Endstand"
  // bleibt erlaubt, ebenso echte Resultate mit einstelliger rechter Seite wie 2:0.
  const looksLikeClock = !match[1] && leftRaw.length <= 2 && rightRaw.length === 2 &&
    homeScore >= 0 && homeScore <= 23 && awayScore >= 0 && awayScore <= 59;
  if (looksLikeClock) return null;

  if (kickoff instanceof Date && homeScore === kickoff.getHours() && awayScore === kickoff.getMinutes()) {
    return null;
  }

  return { homeScore, awayScore, score: `${homeScore}:${awayScore}` };
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
  const matches = [];
  const standings = [];
  const urls = new Set([sourceUrl]);
  let title = "ÖFB";
  let bodyText = "";

  if (contentType.includes("json") || /^[\s]*[\[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.__browserSnapshot) importBrowserSnapshot(parsed.__browserSnapshot, matches, standings, sourceUrl);
      else parseJsonObjects(parsed, matches, standings, urls, sourceUrl, title);
      bodyText = oneLine(JSON.stringify(parsed));
      return { matches, standings, urls: [...urls], title, bytes: Buffer.byteLength(text), kind: "json" };
    } catch { /* continue as HTML/text */ }
  }

  const $ = cheerio.load(text);
  title = oneLine($("h1").first().text() || $("title").text() || "ÖFB");
  $("script,style,noscript,svg").remove();
  bodyText = clean($("body").text() || $.root().text());

  for (const candidate of extractJsonCandidates(text)) {
    try { parseJsonObjects(JSON.parse(candidate), matches, standings, urls, sourceUrl, title); } catch { /* ignore */ }
  }

  for (const discovered of extractCandidateUrls(text, sourceUrl)) urls.add(discovered);
  parseDomMatchCards($, matches, sourceUrl, title);
  parseVisibleMatchBlocks(bodyText, matches, sourceUrl, title);
  parseTables($, matches, standings, sourceUrl, title);
  parseStandingText(bodyText, standings, sourceUrl, title);


  return { matches, standings, urls: [...urls], title, bytes: Buffer.byteLength(text), kind: "html", textPreview: bodyText.slice(0, 1000) };
}



function normalizeBrowserTeam(value) {
  const text = oneLine(value).replace(/\s+(?:Spielbericht|Vorschau|Ticker|Livestream).*$/i, "").trim();
  return /^(?:TSU\s+)?Ainet$/i.test(text) ? "TSU Ainet" : text;
}

function importBrowserSnapshot(snapshot, matches, standings, sourceUrl) {
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
      reportUrl: item.reportUrl,
      status: score ? "finished" : item.status,
    }, sourceUrl, item.context || "");
  }
  for (const row of snapshot.standings || []) {
    addStanding(standings, {
      ...row,
      teamName: teamFromUrl(sourceUrl).teamName,
      teamKey: teamFromUrl(sourceUrl).teamKey,
    }, sourceUrl);
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
          if (!url.includes("oefb.at") || seenResponses.has(url)) return;
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
          .filter((href) => /\/TsuAinet\/Mannschaften\/Saison-2026-27\/[^/]+\/(?:Spiele|Tabellen)\/?$/i.test(href)),
      );
      for (const href of discoveredTeamUrls) {
        try {
          const discovered = safeUrl(href, startUrl);
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
              teams.push({ name: text, logoUrl: imageUrl(node) || imageUrl(parent) });
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
            homeLogoUrl: teams[0].logoUrl, awayLogoUrl: teams[1].logoUrl,
            kickoff: kickoff.toISOString(),
            score: scoreText, scoreConfirmed: Boolean(scoreText),
            competitionName: compact(document.querySelector("h1")?.textContent || document.title || "ÖFB"),
            venue: "", reportUrl: report?.href || location.href,
            status: /abgesagt|annulliert/i.test(context) ? "cancelled" : /verschoben/i.test(context) ? "postponed" : scoreText ? "finished" : "scheduled",
            context,
          });
        }

        const standings = [];
        for (const table of Array.from(document.querySelectorAll("table"))) {
          const headers = Array.from(table.querySelectorAll("th")).map((x) => compact(x.textContent).toLowerCase());
          if (!headers.some((h) => /platz|rang|punkte|pkt|spiele|tore/.test(h))) continue;
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
            standings.push({ position: Number(cells[0].replace(/\D/g, "")), clubName: cells[clubIndex], teamLogoUrl, played: numbers[0], won: numbers[1], drawn: numbers[2], lost: numbers[3], goalsFor: gm ? Number(gm[1]) : 0, goalsAgainst: gm ? Number(gm[2]) : 0, goalDifference: gm ? Number(gm[1]) - Number(gm[2]) : 0, points: numbers.at(-1) || 0, competitionName: compact(document.querySelector("h1")?.textContent || document.title || "ÖFB") });
          }
        }
        return { matches, standings };
      });
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
        discoveredTeamUrls,
        preview: oneLine(renderedText).slice(0, 1500),
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { resources, diagnostics };
}


function removeUndefinedDeep(value) {
  if (value === undefined) return undefined;

  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined);
  }

  // Firestore-Timestamps, FieldValues, DocumentReferences und andere
  // Klasseninstanzen dürfen nicht in einfache Objekte zerlegt werden.
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    const isPlainObject =
      prototype === Object.prototype || prototype === null;

    if (!isPlainObject) return value;

    const cleaned = {};
    for (const [key, item] of Object.entries(value)) {
      const cleanedItem = removeUndefinedDeep(item);
      if (cleanedItem !== undefined) cleaned[key] = cleanedItem;
    }
    return cleaned;
  }

  return value;
}

async function writeCollection(name, items, runId) {
  const writer = db.bulkWriter();

  writer.onWriteError((error) => {
    console.error(
      `Firestore-Schreibfehler in ${name} bei Dokument ${error.documentRef?.id || "unbekannt"}:`,
      error.message,
    );

    // Vorübergehende Firestore-Fehler höchstens dreimal erneut versuchen.
    return error.failedAttempts < 3;
  });

  for (const item of items) {
    if (!item || typeof item !== "object" || !item.id) {
      console.warn(`Ungültiger Eintrag für ${name} wurde übersprungen.`, item);
      continue;
    }

    const documentData = removeUndefinedDeep({
      ...item,
      syncRunId: runId,
      sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    writer.set(
      db.collection(name).doc(String(item.id)),
      documentData,
      { merge: false },
    );
  }

  await writer.close();
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

async function main() {
  const statusRef = db.doc("settings/kfvSyncStatus");
  const startedAt = admin.firestore.Timestamp.now();
  const runId = String(startedAt.toMillis());
  await statusRef.set({
    running: true, success: null,
    trigger: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
    startedAt, intervalMinutes: 30, provider: "github-actions", parserVersion: PARSER_VERSION,
  }, { merge: true });

  try {
    const settings = (await db.doc("settings/kfvSync").get()).data() || {};
    const configured = settings.sourceUrl && String(settings.sourceUrl).includes("oefb.at")
      ? safeUrl(settings.sourceUrl)
      : DEFAULT_SOURCE;
    const startUrls = [...new Set([configured, ...START_URLS])];
    const sourceUrl = configured;
    const visited = new Set(startUrls);
    const matches = [];
    const standings = [];
    const warnings = [];
    const pageDiagnostics = [];

    const browserResult = await collectWithBrowser(startUrls);
    pageDiagnostics.push(...browserResult.diagnostics);

    for (const resource of browserResult.resources) {
      try {
        const parsed = parseResource(resource.text, resource.contentType, resource.finalUrl);
        matches.push(...parsed.matches);
        standings.push(...parsed.standings);
        if (resource.origin === "network") {
          pageDiagnostics.push({
            url: resource.finalUrl, title: parsed.title, kind: `network-${parsed.kind}`,
            bytes: parsed.bytes, matches: parsed.matches.length, standings: parsed.standings.length,
            preview: parsed.textPreview || "",
          });
        }
      } catch (error) {
        warnings.push(`${resource.finalUrl}: ${error.message}`);
      }
    }

    // Bei mehrfach erkannten Spielen den vollständigsten Datensatz behalten.
    // Ein echtes Ergebnis hat Vorrang, eine bloße Anstoßzeit kann es nicht überschreiben.
    const matchMap = new Map();
    for (const item of matches) {
      const previous = matchMap.get(item.id);
      if (!previous) { matchMap.set(item.id, item); continue; }
      const previousHasScore = Number.isInteger(previous.homeScore) && Number.isInteger(previous.awayScore);
      const itemHasScore = Number.isInteger(item.homeScore) && Number.isInteger(item.awayScore);
      matchMap.set(item.id, {
        ...previous,
        ...item,
        homeScore: itemHasScore ? item.homeScore : previousHasScore ? previous.homeScore : null,
        awayScore: itemHasScore ? item.awayScore : previousHasScore ? previous.awayScore : null,
        status: itemHasScore || previousHasScore ? "finished" : item.status || previous.status,
        venue: item.venue || previous.venue,
        homeLogoUrl: item.homeLogoUrl || previous.homeLogoUrl || "",
        awayLogoUrl: item.awayLogoUrl || previous.awayLogoUrl || "",
        competitionName: item.competitionName !== "ÖFB" ? item.competitionName : previous.competitionName,
      });
    }
    const uniqueMatches = [...matchMap.values()];
    const standingMap = new Map();
    for (const item of standings) {
      const previous = standingMap.get(item.id);
      standingMap.set(item.id, previous ? {
        ...previous,
        ...item,
        teamLogoUrl: item.teamLogoUrl || previous.teamLogoUrl || "",
      } : item);
    }
    const uniqueStandings = [...standingMap.values()];

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

    await writeCollection("kfvMatches", uniqueMatches, runId);
    await writeCollection("kfvStandings", uniqueStandings, runId);
    const deactivatedMatches = await deactivateMissing("kfvMatches", new Set(uniqueMatches.map((item) => item.id)), runId);
    const deactivatedStandings = await deactivateMissing("kfvStandings", new Set(uniqueStandings.map((item) => item.id)), runId);

    await statusRef.set({
      running: false, success: true,
      lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      sourceUrl, discoveredUrls: [...visited], visitedUrls: [...visited], pageDiagnostics,
      matchCount: uniqueMatches.length, standingCount: uniqueStandings.length,
      teamCounts: uniqueMatches.reduce((result, item) => { result[item.teamKey] = (result[item.teamKey] || 0) + 1; return result; }, {}),
      standingTeamCounts: uniqueStandings.reduce((result, item) => { result[item.teamKey] = (result[item.teamKey] || 0) + 1; return result; }, {}),
      deactivatedMatches, deactivatedStandings,
      warningCount: warnings.length, warnings: warnings.slice(0, 30),
      intervalMinutes: 30, provider: "github-actions", parserVersion: PARSER_VERSION,
      lastError: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    console.log(`ÖFB-Sync erfolgreich: ${uniqueMatches.length} Spiele, ${uniqueStandings.length} Tabellenzeilen.`);
  } catch (error) {
    await statusRef.set({
      running: false, success: false,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: String(error.message || error),
      intervalMinutes: 30, provider: "github-actions", parserVersion: PARSER_VERSION,
    }, { merge: true });
    throw error;
  }
}

main().catch((error) => {
  console.error("ÖFB-Sync fehlgeschlagen:", error);
  process.exit(1);
});
