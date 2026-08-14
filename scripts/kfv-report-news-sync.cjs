process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VERSION = "18.3.0-beta.1-official-report-runtime-fix";
const STATUS_DOC = "kfvReportNewsSyncStatus";
const REPORT_COLLECTION = "kfvMatchReports";
const MATCH_COLLECTION = "oefbV12Matches";
const LEGACY_MATCH_COLLECTION = "kfvMatches";
const NEWS_COLLECTION = "news";
const CONCURRENCY = Math.max(
  1,
  Math.min(3, Number(process.env.REPORT_SYNC_CONCURRENCY || 2)),
);
const NAVIGATION_TIMEOUT = Math.max(
  20000,
  Number(process.env.REPORT_NAVIGATION_TIMEOUT || 45000),
);
const PRE_KICKOFF_MINUTES = Math.max(
  0,
  Number(process.env.REPORT_PRE_KICKOFF_MINUTES || 60),
);
const POST_KICKOFF_MINUTES = Math.max(
  0,
  Number(process.env.REPORT_POST_KICKOFF_MINUTES || 720),
);
const FORCE_SYNC = /^(?:1|true|yes)$/i.test(process.env.REPORT_FORCE_SYNC || "");
const MANUAL_RUN = FORCE_SYNC || process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
const FORCE_WINDOW_MINUTES = Math.max(60, Number(process.env.REPORT_FORCE_WINDOW_MINUTES || 10080));
const CONFIG_PATH = path.join(process.cwd(), "config", "kfv-sync.config.json");
const SYNC_CONFIG = fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  : { teams: [] };

// Sichere Korrektur für bereits bekannte offizielle Spielberichte.
// Weitere Spiele werden automatisch aus den ÖFB-Spielplanseiten ermittelt.
const REPORT_OVERRIDES = [
  {
    date: "2026-08-01",
    home: "Lurnfeld",
    away: "TSU Ainet",
    url: "https://vereine.oefb.at/TsuAinet/Spielbericht/?Lurnfeld-vs-Ainet&:s=4074032",
  },
  {
    // Offizielle ÖFB-Spielberichtseite als verbindliche Quelle für dieses Spiel.
    // Aufstellung, Schiedsrichter, Zuschauer, Spielort und Liveticker kommen
    // direkt von derselben Seite mit der eindeutigen ÖFB-Spiel-ID.
    date: "2026-08-09",
    home: "SPG TSU Ainet/SU Oberlienz U17",
    away: "SPG Lienzer Talboden U15 A",
    url: "https://vereine.oefb.at/TsuAinet/Spielbericht/?SPG-TSU-Ainet-SU-Oberlienz-U17-vs-SPG-Lienzer-Talboden-U15-A&:s=4173991",
  },
  {
    // Challenge 15.08.2026: Metadaten (insbesondere Spielort) verbindlich
    // aus der offiziellen Einzel-Spielberichtseite beziehen.
    date: "2026-08-15",
    home: "SG OSK Kötschach - Mauthen / SK Grafendorf",
    away: "TSU Ainet",
    url: "https://vereine.oefb.at/TsuAinet/Spielbericht/?SG-OSK-Koetschach-Mauthen-SK-Grafendorf-vs-Ainet&:s=4074039",
    venue: "OSK-Arena Kötschach-Mauthen",
  },
];


const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
}

let credentials;
try {
  credentials = JSON.parse(rawCredentials);
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON.");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(credentials),
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const compact = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const INVALID_VENUE_PATTERN = /^(?:termine?|spiele?|spielbericht|aufstellung(?:en)?|tabelle(?:n)?|kader|news|verein|home|mehr|details|navigation|karte|map|route|kontakt|bewerb|runde|heim|gast|geplant|beendet|liveticker|statistik)$/i;

const cleanVenueValue = (value) => {
  const text = compact(value)
    .replace(/^(?:spielort|stadion|sportplatz|spielstätte|austragungsort|spielanlage)\s*:?\s*/i, "")
    .replace(/\s+(?:schiedsrichter|zuschauer|besucher|aufstellung|tabelle|termine|spielbericht)\b.*$/i, "")
    .trim();
  if (!text || text.length < 3 || text.length > 220) return "";
  if (INVALID_VENUE_PATTERN.test(text)) return "";
  if (/\b(?:leaflet|openstreetmap|mapbox|google\s*maps|apple\s*maps|kartendaten|map\s*data|contributors?|urheberrecht|copyright)\b/i.test(text) || /[©®]/.test(text)) return "";
  if (/^(?:\d{1,2}[:.]\d{2}(?:\s*uhr)?|\d{1,2}[.:]\d{1,2})$/i.test(text)) return "";
  return text;
};

const sha = (value) =>
  crypto
    .createHash("sha1")
    .update(String(value))
    .digest("hex")
    .slice(0, 24);

const absoluteUrl = (value, base) => {
  try {
    return value ? new URL(value, base).href : "";
  } catch {
    return "";
  }
};

const isAinet = (name) => {
  // Auch SPG-Namen wie „SPG TSU Ainet/SU Oberlienz U17“ müssen erkannt werden.
  // Die frühere Prüfung verlangte nach „Ainet“ ein Leerzeichen oder String-Ende
  // und scheiterte deshalb am Slash direkt hinter „Ainet“.
  const normalized = normalizeTextForClubDetection(name);
  return /(?:^|\s)ainet(?:\s|$)/i.test(normalized);
};

function normalizeTextForClubDetection(value) {
  return compact(value)
    .toLocaleLowerCase("de-AT")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return compact(value)
    .toLocaleLowerCase("de-AT")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clubTokens(value) {
  const ignored = new Set([
    "tsu",
    "sv",
    "fc",
    "usc",
    "union",
    "spg",
    "sg",
    "sk",
    "sc",
    "askoe",
    "askö",
    "sektion",
    "reserve",
    "res",
    "kampfmannschaft",
    "km",
    "u8",
    "u08",
    "u10",
    "u12",
    "u17",
    "1b",
    "ii",
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !ignored.has(token));
}

function pageContainsClub(pageText, clubName) {
  const normalizedPage = ` ${normalizeText(pageText)} `;
  const normalizedClub = normalizeText(clubName);

  if (!normalizedClub) return false;
  if (normalizedPage.includes(` ${normalizedClub} `)) return true;

  const tokens = clubTokens(clubName);
  if (!tokens.length) return false;

  // Bei kurzen Vereinsnamen genügt der eindeutige Kernbegriff.
  // Bei längeren Namen müssen mindestens zwei Kernbegriffe vorkommen.
  const hits = tokens.filter((token) =>
    normalizedPage.includes(` ${token} `),
  ).length;

  return tokens.length === 1 ? hits === 1 : hits >= Math.min(2, tokens.length);
}

function extractOefbGameId(value) {
  const url = compact(value);
  if (!url) return "";

  const match =
    url.match(/[?&]:s=(\d+)/i) ||
    url.match(/[?&]s=(\d+)/i) ||
    url.match(/(?:spiel|match)[^\d]*(\d{5,})/i);

  return match ? match[1] : "";
}

function isIndividualReportUrl(value) {
  const url = compact(value);
  return (
    /^https?:\/\//i.test(url) &&
    /\/Spielbericht\/?/i.test(url) &&
    Boolean(extractOefbGameId(url))
  );
}

function asDate(value) {
  if (value && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function categoryForTeam(teamId, teamName) {
  const value = `${teamId || ""} ${teamName || ""}`.toLowerCase();

  if (/challenge|reserve|res\b/.test(value)) return "challenge";
  if (/u\s*\d+|nachwuchs|jugend/.test(value)) return "nachwuchs";

  return "kampfmannschaft";
}

function scoreText(match) {
  return Number.isFinite(match.homeScore) &&
    Number.isFinite(match.awayScore)
    ? `${match.homeScore}:${match.awayScore}`
    : "";
}

function resultTitle(match) {
  const score = scoreText(match);

  return score
    ? `${match.homeTeam} ${score} ${match.awayTeam}`
    : `${match.homeTeam} gegen ${match.awayTeam}`;
}

function reportIdFor(match) {
  const gameId = compact(match._resolvedGameId || match.gameId || match.oefbMatchId);

  return gameId
    ? `report_oefb_${gameId}`
    : `report_${sha(match.id || match.reportUrl)}`;
}

function validateReportPage(match, raw) {
  const reasons = [];
  const requestedUrl = absoluteUrl(match.reportUrl, match.reportUrl);
  const finalUrl = absoluteUrl(raw.finalUrl, requestedUrl);

  if (!isIndividualReportUrl(requestedUrl)) {
    reasons.push("Gespeicherte URL ist keine einzelne ÖFB-Spielberichtseite");
  }

  if (!isIndividualReportUrl(finalUrl)) {
    reasons.push("Geladene Seite ist keine einzelne ÖFB-Spielberichtseite");
  }

  const requestedGameId = extractOefbGameId(requestedUrl);
  const finalGameId = extractOefbGameId(finalUrl);
  const storedGameId = compact(match._resolvedGameId || match.gameId || match.oefbMatchId);
  const expectedCanonicalGameId = storedGameId || requestedGameId;
  const exactIdVerified = Boolean(
    expectedCanonicalGameId && finalGameId && expectedCanonicalGameId === finalGameId
  );

  if (requestedGameId && finalGameId && requestedGameId !== finalGameId) {
    reasons.push(
      `Weiterleitung auf andere Spiel-ID (${requestedGameId} → ${finalGameId})`,
    );
  }

  if (storedGameId && finalGameId && storedGameId !== finalGameId) {
    reasons.push(
      `Spiel-ID passt nicht zum Firestore-Spiel (${storedGameId} ≠ ${finalGameId})`,
    );
  }

  const identityText = [
    raw.title,
    raw.heading,
    raw.topText,
  ].join(" ");

  // Die ÖFB-Spiel-ID ist die kanonische Identität. Wenn sie exakt passt,
  // dürfen wechselnde Überschriften/Abkürzungen auf der Webseite den Bericht
  // nicht fälschlich verwerfen. Team-/Datumsabgleich dient nur als Fallback,
  // wenn keine eindeutige ID verifiziert werden konnte.
  if (!exactIdVerified) {
    if (!pageContainsClub(identityText, match.homeTeam)) {
      reasons.push(`Heimverein "${match.homeTeam}" nicht eindeutig erkannt`);
    }

    if (!pageContainsClub(identityText, match.awayTeam)) {
      reasons.push(`Gastverein "${match.awayTeam}" nicht eindeutig erkannt`);
    }
  }

  // Zusätzlich zum Paarungsabgleich muss auch der Spieltag zur geladenen
  // Einzel-Spielberichtseite passen. So können Daten eines anderen Spiels mit
  // denselben/ähnlichen Vereinsnamen nicht auf dieses Match übertragen werden.
  const expectedDate = asDate(match.kickoffDate || match.kickoffAt);
  if (!exactIdVerified && expectedDate.getTime() > 0) {
    const dd = String(expectedDate.getDate()).padStart(2, "0");
    const mm = String(expectedDate.getMonth() + 1).padStart(2, "0");
    const yyyy = expectedDate.getFullYear();
    const dateIdentityText = [raw.title, raw.heading, raw.topText, raw.preview].join(" ");
    const hasExactDate =
      dateIdentityText.includes(`${dd}.${mm}.${yyyy}`) ||
      dateIdentityText.includes(`${dd}.${mm}.${String(yyyy).slice(-2)}`) ||
      dateIdentityText.includes(`${dd}.${mm}.`);
    if (!hasExactDate) {
      reasons.push(`Spieltag ${dd}.${mm}.${yyyy} nicht auf der ÖFB-Seite erkannt`);
    }
  }

  if (
    raw.result &&
    Number.isFinite(match.homeScore) &&
    Number.isFinite(match.awayScore) &&
    (raw.result.home !== match.homeScore ||
      raw.result.away !== match.awayScore)
  ) {
    reasons.push(
      `Ergebnis stimmt nicht überein (${raw.result.home}:${raw.result.away} statt ${match.homeScore}:${match.awayScore})`,
    );
  }

  if (raw.bodyLength < 500) {
    reasons.push("Spielberichtseite enthält zu wenig auswertbaren Inhalt");
  }

  if (raw.homeLineup.length > 18 || raw.awayLineup.length > 18) {
    reasons.push("Startelf-Erkennung enthält unplausibel viele Spieler");
  }

  if ((raw.homeBench || []).length > 18 || (raw.awayBench || []).length > 18) {
    reasons.push("Ersatzbank-Erkennung enthält unplausibel viele Spieler");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    requestedGameId,
    finalGameId,
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, Math.max(1, items.length)) },
      worker,
    ),
  );

  return results;
}

async function loadCandidateMatches() {
  const now = Date.now();
  const preMinutes = MANUAL_RUN ? FORCE_WINDOW_MINUTES : PRE_KICKOFF_MINUTES;
  const postMinutes = MANUAL_RUN ? FORCE_WINDOW_MINUTES : POST_KICKOFF_MINUTES;
  const fromDate = new Date(now - postMinutes * 60000);
  const toDate = new Date(now + preMinutes * 60000);

  // WICHTIG: Ein manueller workflow_dispatch darf NICHT bereits durch die
  // Firestore-Zeitbereichsabfrage leer laufen. Genau das ist beim U17-Spiel
  // 4173991 passiert: manual=true, aber 0 Kandidaten, bevor das Gate umgangen
  // werden konnte. Manuell laden wir deshalb eine bewusst begrenzte Menge der
  // Match-Dokumente und filtern erst danach in JavaScript.
  const snapshot = MANUAL_RUN
    ? await db.collection(MATCH_COLLECTION).limit(500).get()
    : await db
        .collection(MATCH_COLLECTION)
        .where("kickoffAt", ">=", admin.firestore.Timestamp.fromDate(fromDate))
        .where("kickoffAt", "<=", admin.firestore.Timestamp.fromDate(toDate))
        .get();

  const all = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .map((match) => ({
      ...match,
      kickoffDate: asDate(match.kickoffAt),
    }))
    .filter((match) => match.active !== false)
    .filter((match) => isAinet(match.homeTeam) || isAinet(match.awayTeam));

  const relevant = all.filter((match) => {
    const time = match.kickoffDate.getTime();

    // Manueller Reparaturlauf: eine bekannte offizielle Paarung darf auch dann
    // aufgenommen werden, wenn kickoffAt in Firestore fehlt/falsch ist. Aber nur,
    // wenn das Override selbst im aktuellen manuellen Zeitfenster liegt. Dadurch
    // wird z.B. 4173991 am 09.08. aufgenommen, während das alte Spiel 4074032 vom
    // 01.08. nicht dauerhaft jeden manuellen Lauf kapert.
    if (MANUAL_RUN) {
      const override = matchingOverride(match, { allowTeamOnly: true });
      if (override) {
        const overrideMs = overrideDateMs(override);
        if (overrideMs > 0 && now >= overrideMs - postMinutes * 60000 && now <= overrideMs + preMinutes * 60000) {
          return true;
        }
      }
    }

    return time > 0 && now >= time - preMinutes * 60000 && now <= time + postMinutes * 60000;
  });

  if (MANUAL_RUN) {
    console.log(`Manual-Candidate-Scan: ${snapshot.size} Match-Dokumente geladen, ${all.length} Ainet/SPG-Ainet-Spiele erkannt, ${relevant.length} im manuellen Prüfbereich.`);
    if (!relevant.length) {
      const sample = all.slice(0, 12).map((match) => ({
        id: match.id,
        home: match.homeTeam,
        away: match.awayTeam,
        kickoff: match.kickoffDate?.toISOString?.() || "",
        gameId: compact(match.gameId || match.oefbMatchId || extractOefbGameId(match.reportUrl)),
      }));
      console.log("Manual-Candidate-Diagnose:", JSON.stringify(sample));
    }
  }

  return relevant.sort((a, b) => b.kickoffDate - a.kickoffDate);
}

async function keepMatchesNeedingPrematchData(matches) {
  if (MANUAL_RUN || !matches.length) {
    if (MANUAL_RUN && matches.length) {
      console.log(`Smart-Gate: Manueller Lauf – Gate wird für ${matches.length} relevante Spiele vollständig umgangen.`);
    }
    return matches;
  }

  const checked = await mapLimit(matches, 3, async (match) => {
    const snapshot = await db
      .collection(REPORT_COLLECTION)
      .where("matchId", "==", match.id)
      .limit(1)
      .get();

    if (snapshot.empty) return match;

    const report = snapshot.docs[0].data() || {};
    const reportHomeCount = Array.isArray(report.homeLineup) ? report.homeLineup.length : 0;
    const reportAwayCount = Array.isArray(report.awayLineup) ? report.awayLineup.length : 0;
    const matchHomeCount = Array.isArray(match.homeLineup) ? match.homeLineup.length : 0;
    const matchAwayCount = Array.isArray(match.awayLineup) ? match.awayLineup.length : 0;
    const homeLineupCount = Math.max(reportHomeCount, matchHomeCount);
    const awayLineupCount = Math.max(reportAwayCount, matchAwayCount);

    // Eine einzelne erkannte Person oder nur eine Mannschaft darf das Smart-Gate
    // niemals als vollständige Aufstellung werten. Für den automatischen Skip
    // müssen auf BEIDEN Seiten mindestens sieben Startspieler vorhanden sein.
    const hasLineup = homeLineupCount >= 7 && awayLineupCount >= 7;
    const hasReferee = Boolean(compact(report.referee || match.referee));
    const hasVenue = Boolean(cleanVenueValue(report.venue) || cleanVenueValue(match.venue));
    const hasResult =
      (Number.isInteger(report.homeScore) && Number.isInteger(report.awayScore)) ||
      (Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore));
    const kickoffMs = match.kickoffDate?.getTime?.() || asDate(match.kickoffAt).getTime();
    const hasStarted = kickoffMs > 0 && Date.now() >= kickoffMs;

    // Vor Anpfiff reichen Aufstellung, Spielort und Schiedsrichter. Nach Anpfiff
    // bleibt das Spiel so lange im Sync, bis zusätzlich ein Ergebnis vorliegt.
    const complete = hasLineup && hasReferee && hasVenue && (!hasStarted || hasResult);

    if (complete) {
      console.log(`Smart-Skip: ${match.homeTeam} - ${match.awayTeam}: Kerndaten vollständig (Heim ${homeLineupCount}, Gast ${awayLineupCount}, Schiedsrichter, Spielort${hasStarted ? ", Ergebnis" : ""}).`);
      return null;
    }

    return match;
  });

  return checked.filter(Boolean);
}

function localDateKey(date) {
  const value = asDate(date);
  if (!value || value.getTime() <= 0) return "";
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sameClubName(a, b) {
  if (!a || !b) return false;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return true;
  const at = clubTokens(a);
  const bt = clubTokens(b);
  if (!at.length || !bt.length) return false;
  const common = at.filter((token) => bt.includes(token));
  return common.length >= Math.min(2, at.length, bt.length) ||
    (Math.min(at.length, bt.length) === 1 && common.length === 1);
}

function matchingOverride(match, { allowTeamOnly = false } = {}) {
  const date = localDateKey(match.kickoffDate || match.kickoffAt);
  const byTeams = REPORT_OVERRIDES.filter((item) =>
    sameClubName(item.home, match.homeTeam) &&
    sameClubName(item.away, match.awayTeam)
  );

  if (!byTeams.length) return null;

  // Exaktes Datum hat immer Vorrang.
  const exact = byTeams.find((item) => item.date === date);
  if (exact) return exact;

  // Bei manuellen Reparaturläufen kann kickoffAt in Firestore fehlen oder falsch
  // sein. Ist die Paarung unter den Overrides eindeutig, darf die offizielle
  // ÖFB-ID trotzdem anhand Heim/Gast zugeordnet werden.
  if (allowTeamOnly && byTeams.length === 1) return byTeams[0];

  return null;
}

function overrideDateMs(item) {
  if (!item?.date) return 0;
  const parsed = new Date(`${item.date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

async function collectReportCandidates(browser) {
  const urls = (SYNC_CONFIG.teams || [])
    .filter((team) => team.enabled !== false && team.gamesUrl)
    .map((team) => ({ teamKey: team.key, url: team.gamesUrl }));
  const all = [];

  for (const source of urls) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1365, height: 1800 });
      await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36");
      await page.setExtraHTTPHeaders({ "Accept-Language": "de-AT,de;q=0.9" });
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
      await page.waitForFunction(() => document.body && document.body.innerText.length > 300, { timeout: 12000 }).catch(() => {});
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const max = Math.min(document.body?.scrollHeight || 0, 12000);
        for (let y = 0; y <= max; y += 600) { window.scrollTo(0, y); await sleep(80); }
        window.scrollTo(0, 0);
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 700));
      const found = await page.evaluate((teamKey) => {
        const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const absolute = (value) => { try { return value ? new URL(value, location.href).href : ""; } catch { return ""; } };
        return [...document.querySelectorAll("a[href*='/Spielbericht/']")].map((link) => {
          const container = link.closest("article,section,li,tr,[class*='match'],[class*='game'],[class*='spiel'],div") || link.parentElement;
          const text = compact(container?.textContent || link.textContent || "");
          return { teamKey, url: absolute(link.href), text: text.slice(0, 1200) };
        });
      }, source.teamKey);
      all.push(...found);
    } catch (error) {
      console.warn(`Berichtsindex ${source.teamKey} konnte nicht geladen werden: ${error.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  const unique = new Map();
  for (const item of all) {
    const id = extractOefbGameId(item.url);
    if (id && !unique.has(id)) unique.set(id, { ...item, gameId: id });
  }
  return [...unique.values()];
}

function scoreReportCandidate(match, candidate) {
  const text = candidate.text || "";
  let score = 0;
  if (pageContainsClub(text, match.homeTeam)) score += 45;
  if (pageContainsClub(text, match.awayTeam)) score += 45;
  const date = asDate(match.kickoffDate || match.kickoffAt);
  if (date.getTime() > 0) {
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    if (text.includes(`${d}.${m}.${y}`) || text.includes(`${d}.${m}.`)) score += 20;
  }
  const stored = compact(match.gameId || match.oefbMatchId);
  if (stored && stored === candidate.gameId) score += 10;
  return score;
}

async function resolveMatchReports(browser, matches) {
  const index = await collectReportCandidates(browser);
  let corrected = 0;
  const resolved = [];

  for (const match of matches) {
    const override = matchingOverride(match, { allowTeamOnly: MANUAL_RUN });
    let url = override?.url || "";
    let source = override ? "official-override" : "";
    let score = override ? 999 : 0;

    // Wenn Firestore bereits eine eindeutige ÖFB-Spiel-ID kennt, ist diese
    // stärker als jede heuristische Suche über Mannschafts-/Spielplanseiten.
    // Dadurch werden Spielort, Schiedsrichter und Aufstellung direkt von der
    // offiziellen Einzel-Spielberichtseite desselben Spiels gelesen.
    if (!url) {
      const storedGameId = compact(match.gameId || match.oefbMatchId || extractOefbGameId(match.reportUrl));
      if (storedGameId) {
        url = `https://vereine.oefb.at/TsuAinet/Spielbericht/?spiel-vs-spiel&:s=${encodeURIComponent(storedGameId)}`;
        score = 500;
        source = "stored-game-id-direct";
      }
    }

    if (!url) {
      const ranked = index
        .map((candidate) => ({ candidate, score: scoreReportCandidate(match, candidate) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0] && ranked[0].score >= 80) {
        url = ranked[0].candidate.url;
        score = ranked[0].score;
        source = "games-page-index";
      }
    }

    if (!url && isIndividualReportUrl(match.reportUrl)) {
      url = match.reportUrl;
      score = 1;
      source = "stored-fallback";
    }
    if (!isIndividualReportUrl(url)) continue;

    const gameId = extractOefbGameId(url);
    const oldUrl = compact(match.reportUrl);
    const oldId = compact(match.gameId || match.oefbMatchId);
    const changed = oldUrl !== url || oldId !== gameId;
    const next = {
      ...match,
      reportUrl: url,
      _resolvedGameId: gameId,
      _reportResolutionSource: source,
      _reportResolutionScore: score,
    };

    console.log(
      `ÖFB-Zuordnung: ${compact(match.homeTeam)} - ${compact(match.awayTeam)} | ` +
      `kickoff=${localDateKey(match.kickoffDate || match.kickoffAt) || "unbekannt"} | ` +
      `ÖFB-ID=${gameId || "keine"} | Quelle=${source || "keine"}`,
    );
    resolved.push(next);

    if (changed) {
      corrected += 1;
      await db.collection(MATCH_COLLECTION).doc(match.id).set({
        reportUrl: url,
        gameId,
        oefbMatchId: gameId,
        reportResolutionSource: source,
        reportResolutionVersion: VERSION,
        reportResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  return { matches: resolved, indexCount: index.length, correctedCount: corrected };
}

async function waitForReport(page) {
  await page
    .waitForFunction(
      () => document.body && document.body.innerText.length > 250,
      { timeout: 15000 },
    )
    .catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 1400));

  // Die ÖFB-Seite tauscht den Inhalt der Reiter dynamisch aus. Deshalb werden
  // alle Ereignis-Reiter nacheinander geöffnet und ihre Inhalte zwischengespeichert,
  // bevor zuletzt die Aufstellung für die Spielererkennung geöffnet wird.
  await page
    .evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const snapshots = [];
      const seen = new Set();

      const rememberVisibleEventContent = () => {
        const selectors = [
          "[class*='ticker']",
          "[class*='timeline']",
          "[class*='event']",
          "[class*='ereignis']",
          "[class*='goal']",
          "[class*='tor']",
          "[class*='card']",
          "[class*='karte']",
          "[class*='substitution']",
          "[class*='wechsel']",
          "[data-event]",
          "[data-minute]",
          "[data-testid*='event']",
          "[role='tabpanel']",
        ];

        const values = [];
        for (const selector of selectors) {
          for (const node of document.querySelectorAll(selector)) {
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const text = compact(node.innerText || node.textContent || "");
            if (text.length >= 6 && text.length <= 12000) values.push(text);
          }
        }

        // Fallback: sichtbaren Seitentext ebenfalls sichern. Der spätere Parser
        // filtert Navigation, Tabellen, Karten und sonstige Störtexte streng aus.
        const body = compact(document.body?.innerText || "");
        if (body) values.push(body.slice(0, 50000));

        for (const value of values) {
          const key = value.toLocaleLowerCase("de-AT");
          if (seen.has(key)) continue;
          seen.add(key);
          snapshots.push(value);
        }
      };

      const clickTab = async (labels) => {
        const normalized = labels.map((label) => label.toLowerCase());
        // ÖFB rendert die Reiter je nach Breakpoint nicht immer als <a>/<button>.
        // Deshalb zuerst echte Controls, danach sichtbare Elemente mit passendem Text.
        const all = [
          ...document.querySelectorAll("button,a,[role='tab'],[data-toggle='tab'],[role='button'],li,span,div"),
        ];
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const ranked = all
          .filter(visible)
          .map((node) => {
            const text = compact(node.textContent).toLowerCase();
            let score = 0;
            for (const label of normalized) {
              if (text === label) score = Math.max(score, 100);
              else if (text.startsWith(label)) score = Math.max(score, 80);
              else if (text.includes(label) && text.length < 80) score = Math.max(score, 60);
            }
            if (/^(A|BUTTON)$/.test(node.tagName) || node.getAttribute("role") === "tab") score += 20;
            return { node, score };
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score);
        const target = ranked[0]?.node;
        if (!target) return false;
        target.scrollIntoView({ block: "center", inline: "center" });
        await sleep(150);
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        target.click();
        await sleep(1800);
        rememberVisibleEventContent();
        return true;
      };

      rememberVisibleEventContent();

      // Übersicht/Liveticker zuerst, danach Spezialreiter. Manche ÖFB-Versionen
      // verwenden unterschiedliche Bezeichnungen, daher mehrere Alternativen.
      const eventTabs = [
        ["übersicht", "uebersicht"],
        ["liveticker", "live ticker", "ticker"],
        ["spielbericht"],
        ["tore", "tor"],
        ["karten", "karte"],
        ["wechsel", "auswechslungen"],
      ];

      for (const labels of eventTabs) {
        await clickTab(labels);
      }

      window.__TSU_EVENT_SNAPSHOTS__ = snapshots;

      // Aufstellungen zuletzt sichtbar lassen, damit der bestehende
      // Aufstellungsparser weiterhin alle Spieler erkennen kann.
      await clickTab(["aufstellung", "aufstellungen", "lineup"]);

      const max = Math.min(document.body?.scrollHeight || 0, 10000);
      for (let y = 0; y <= max; y += 550) {
        window.scrollTo(0, y);
        await sleep(90);
      }
      window.scrollTo(0, 0);
      // Nach dem Scrollen den Aufstellungsreiter nochmals aktivieren. Einige
      // ÖFB-Seiten mounten dessen Inhalt erst nach dem ersten Layout-/Lazy-Load.
      await clickTab(["aufstellung", "aufstellungen", "lineup"]);
      await sleep(1200);
    })
    .catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 1800));
}

async function extractReport(browser, match) {
  const page = await browser.newPage();
  const started = Date.now();

  try {
    await page.setViewport({
      width: 1365,
      height: 1500,
    });

    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    );

    await page.setExtraHTTPHeaders({
      "Accept-Language": "de-AT,de;q=0.9,en;q=0.7",
    });

    await page.goto(match.reportUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    await waitForReport(page);

    // Harte Identitätsprüfung: eine bekannte ÖFB-ID darf niemals Daten einer
    // anderen Spielberichtseite liefern.
    const expectedGameId = compact(match._resolvedGameId || match.gameId || match.oefbMatchId || extractOefbGameId(match.reportUrl));
    const loadedGameId = extractOefbGameId(page.url());
    if (expectedGameId && loadedGameId && expectedGameId !== loadedGameId) {
      throw new Error(`Falsche ÖFB-Spielberichtseite geladen: erwartet ${expectedGameId}, erhalten ${loadedGameId}`);
    }

    const raw = await page.evaluate(
      ({ expectedHomeTeam, expectedAwayTeam }) => {
        const compact = (value) =>
          String(value || "").replace(/\s+/g, " ").trim();

        const normalize = (value) =>
          compact(value)
            .toLocaleLowerCase("de-AT")
            .replace(/ä/g, "ae")
            .replace(/ö/g, "oe")
            .replace(/ü/g, "ue")
            .replace(/ß/g, "ss")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const absolute = (value) => {
          try {
            return value ? new URL(value, location.href).href : "";
          } catch {
            return "";
          }
        };

        const bodyText = compact(document.body?.innerText || "");
        const textLines = String(document.body?.innerText || "")
          .split(/\n+/)
          .map(compact)
          .filter(Boolean);
        const topText = textLines.slice(0, 55).join(" | ").slice(0, 3200);

        const resultCandidates = [
          ...document.querySelectorAll(
            "[class*='result'],[class*='score'],[class*='ergebnis'],h1,h2,h3,strong",
          ),
        ]
          .map((node) => compact(node.textContent))
          .filter(Boolean);

        let result = null;
        for (const candidate of resultCandidates) {
          const scoreMatch = candidate.match(
            /(?:^|\s)(\d{1,2})\s*:\s*(\d{1,2})(?:\s|$)/,
          );
          if (scoreMatch) {
            result = { home: Number(scoreMatch[1]), away: Number(scoreMatch[2]) };
            break;
          }
        }

        const labelledValue = (labels, maxLength = 140) => {
          const normalizedLabels = labels.map((label) => label.toLowerCase());
          const nodes = [...document.querySelectorAll(
            "dt,dd,th,td,li,p,span,strong,div,[class*='label'],[class*='value'],[class*='info'],[class*='detail']",
          )];

          for (const node of nodes) {
            const labelText = compact(node.textContent);
            if (!labelText || labelText.length > 80) continue;
            const lowered = labelText.toLowerCase().replace(/:$/, "");
            if (!normalizedLabels.some((label) => lowered === label || lowered.startsWith(`${label}:`))) continue;

            const siblingCandidates = [
              node.nextElementSibling,
              node.parentElement?.querySelector("dd,[class*='value'],strong,b"),
            ].filter(Boolean);
            for (const sibling of siblingCandidates) {
              const value = compact(sibling.textContent);
              if (value && value !== labelText && value.length <= maxLength) return value;
            }

            const inline = labelText.replace(new RegExp(`^(?:${labels.join("|")})\\s*:?\\s*`, "i"), "").trim();
            if (inline && inline !== labelText && inline.length <= maxLength) return inline;
          }

          const linePattern = new RegExp(
            `(?:^|\\|)\\s*(?:${labels.join("|")})\\s*:?\\s*([^|]{1,${maxLength}}?)(?=\\s*\\||$)`,
            "i",
          );
          return compact(bodyText.match(linePattern)?.[1] || "");
        };

        // Strikte Label/Wert-Auswertung für die offizielle Einzel-Spielberichtseite.
        // Es werden nur Werte aus derselben Tabellen-/Definitions-/Info-Zeile akzeptiert.
        // Dadurch können Navigationstexte wie „Termine“ oder Daten anderer Bereiche
        // nicht mehr als Spielort/Schiedsrichter übernommen werden.
        const strictLabelValue = (labels, maxLength = 220) => {
          const wanted = labels.map((label) => normalize(label));
          const labelMatches = (value) => {
            const n = normalize(String(value || "").replace(/:$/, ""));
            return wanted.some((label) => n === label);
          };
          const nodes = [...document.querySelectorAll("dt,th,[class*='label'],[data-label],span,strong,p")];
          for (const node of nodes) {
            const rawLabel = compact(node.textContent);
            if (!rawLabel || rawLabel.length > 80 || !labelMatches(rawLabel)) continue;
            const row = node.closest("tr,dl,li,[class*='row'],[class*='item'],[class*='info'],[class*='detail']") || node.parentElement;
            const candidates = [
              node.tagName === "DT" ? node.nextElementSibling : null,
              node.tagName === "TH" ? node.parentElement?.querySelector("td") : null,
              node.nextElementSibling,
              row?.querySelector("dd,[class*='value'],[data-value]")
            ].filter(Boolean);
            for (const candidate of candidates) {
              const value = compact(candidate.textContent);
              if (!value || value === rawLabel || value.length > maxLength) continue;
              if (labelMatches(value)) continue;
              return value;
            }
          }
          return "";
        };

        const attendanceText = labelledValue(["Zuschauer", "Besucher"], 40);
        const attendanceMatch = attendanceText.match(/(\d{1,6})/);
        const attendance = attendanceMatch ? Number(attendanceMatch[1]) : null;

        const cleanOfficial = (value) => compact(value)
          .replace(/\s+(?:Spiele seit|Spiele mit|Erstes Spiel|Letztes Spiel).*$/i, "")
          .replace(/\s+(?:Assistent(?:en)?|Zuschauer|Besucher|Spielort|Stadion|Adresse).*$/i, "")
          .trim();

        const referee = cleanOfficial(strictLabelValue(["Schiedsrichter", "Referee", "Hauptschiedsrichter", "Schiedsrichter 1", "SR 1"], 160));
        const assistantText = labelledValue([
          "Schiedsrichter-Assistenten",
          "Schiedsrichterassistenten",
          "Assistenten",
          "Linienrichter",
        ], 220);
        const refereeAssistants = assistantText
          ? assistantText.split(/[,;/]|\s+und\s+/i).map(cleanOfficial).filter(Boolean).slice(0, 4)
          : [];

        const textValueAfterLabel = (labels, maxLength = 220) => {
          const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          const pattern = new RegExp(`(?:^|\\n|\\|)\\s*(?:${escaped.join("|")})\\s*:?\\s*([^\\n|]{1,${maxLength}})`, "i");
          return compact(String(document.body?.innerText || "").match(pattern)?.[1] || "");
        };

        // ÖFB verändert das Markup der Infobox gelegentlich. Die Werte werden
        // deshalb zusätzlich direkt aus dem sichtbaren Text ausgelesen.
        let robustReferee = cleanOfficial(referee);
        const robustAssistantText = assistantText || textValueAfterLabel([
          "Schiedsrichter-Assistenten",
          "Schiedsrichterassistenten",
          "Assistenten",
          "Linienrichter",
        ], 220);
        let robustRefereeAssistants = refereeAssistants.length
          ? refereeAssistants
          : robustAssistantText.split(/[,;/]|\s+und\s+/i).map(cleanOfficial).filter(Boolean).slice(0, 4);

        const invalidVenue = /^(?:termine?|spiele?|spielbericht|aufstellung(?:en)?|tabelle(?:n)?|kader|news|verein|home|mehr|details|navigation|karte|map|route|kontakt|bewerb|runde|heim|gast|geplant|beendet|liveticker|statistik)$/i;
        const cleanVenue = (value) => {
          const text = compact(value)
            .replace(/^(?:spielort|stadion|sportplatz|spielstätte|austragungsort|spielanlage)\s*:?\s*/i, "")
            .replace(/\s+(?:schiedsrichter|zuschauer|besucher|aufstellung|tabelle|termine|spielbericht)\b.*$/i, "")
            .trim();
          if (!text || text.length < 3 || text.length > 220) return "";
          if (invalidVenue.test(text)) return "";
          if (/^(?:\d{1,2}[:.]\d{2}(?:\s*uhr)?|\d{1,2}[.:]\d{1,2})$/i.test(text)) return "";
          return text;
        };

        let venue = cleanVenue(strictLabelValue(["Spielort", "Stadion", "Sportplatz", "Spielstätte", "Austragungsort", "Spielanlage"], 180));
        let venueAddress = cleanVenue(strictLabelValue(["Adresse", "Anschrift"], 220));

        const mapLinks = [...document.querySelectorAll("a[href*='maps.google'],a[href*='google.com/maps'],a[href*='openstreetmap'],a[href*='maps.apple']")];
        const mapHrefCandidates = [];
        for (const link of mapLinks) {
          try {
            const href = link.getAttribute("href") || "";
            const parsed = new URL(href, location.href);
            for (const key of ["query", "q", "destination", "daddr"]) {
              const candidate = cleanVenue(decodeURIComponent(parsed.searchParams.get(key) || ""));
              if (candidate) mapHrefCandidates.push(candidate);
            }
            const pathCandidate = cleanVenue(decodeURIComponent(parsed.pathname || "").replace(/^\/maps\/(?:place|search)\//i, "").replace(/\/data=.*$/i, "").replace(/\+/g, " "));
            if (pathCandidate && !/^maps$/i.test(pathCandidate)) mapHrefCandidates.push(pathCandidate);
          } catch {}
        }

        // Zusätzlicher DOM-Fallback: echte Location-/Venue-/Map-Komponenten
        // bevorzugen. Allgemeine Navigationsbegriffe wie „Termine“ werden
        // ausdrücklich verworfen.
        const venueNodes = [...document.querySelectorAll(
          "[class*='venue'],[class*='location'],[class*='stadion'],[class*='sportplatz'],[class*='spielort'],[data-testid*='venue'],[data-testid*='location'],address,a[href*='maps.google'],a[href*='google.com/maps'],a[href*='openstreetmap'],a[href*='maps.apple']"
        )];
        const venueCandidates = [...mapHrefCandidates, ...venueNodes
          .map((node) => cleanVenue(node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || ''))]
          .filter(Boolean);

        const scoreVenue = (value) => {
          let score = 0;
          if (/\b(?:sportplatz|stadion|arena|fußballplatz|fussballplatz|kunstrasen|platz|sportanlage|stadionanlage)\b/i.test(value)) score += 40;
          if (/\b\d{4}\b/.test(value)) score += 12;
          if (/\b(?:straße|strasse|weg|gasse|platz)\b/i.test(value)) score += 10;
          if (/\d/.test(value)) score += 3;
          if (value.length >= 8 && value.length <= 100) score += 5;
          return score;
        };
        venueCandidates.sort((a, b) => scoreVenue(b) - scoreVenue(a));
        if (!venue || scoreVenue(venueCandidates[0] || "") > scoreVenue(venue)) venue = venueCandidates[0] || venue;

        if (!venueAddress) {
          const mapLink = mapLinks[0];
          const mapContainer = mapLink?.closest("li,p,div,section,article");
          const mapText = cleanVenue(mapContainer?.innerText || mapContainer?.textContent || "");
          if (mapText && mapText !== venue) venueAddress = mapText;
        }

        let robustAttendance = attendance;
        if (!Number.isInteger(robustAttendance)) {
          const fallbackAttendance = textValueAfterLabel(["Zuschauer", "Besucher"], 40).match(/(\d{1,6})/);
          robustAttendance = fallbackAttendance ? Number(fallbackAttendance[1]) : null;
        }

        const invalidPlayerText = /^(?:aufstellung(?:en)?|startelf|ersatzbank|bank|trainer(?:\s*&\s*betreuer)?|betreuer|tore|karten|wechsel|spieler|heim|gast|kader|zu-?\s*&\s*abgänge|keine einträge verfügbar|tsu ainet|eine seite des öfb dachangebotes)$/i;

        const cleanPlayerName = (value) => {
          let text = compact(value)
            .replace(/^#?\s*\d{1,3}\s*/, "")
            .replace(/^\d{1,3}[.'’]\s*/, "")
            .replace(/\s*\([^)]*(?:kapitän|captain|tw|gk)[^)]*\)\s*$/i, "")
            .replace(/\s+(?:GK|TW|Kapitän|Captain|Ersatz)\s*$/i, "")
            .trim();

          // Bei Karten mit mehreren Zeilen nur die wahrscheinlichste Namenszeile nehmen.
          const lines = String(value || "")
            .split(/\n+/)
            .map(compact)
            .filter(Boolean);
          const nameLine = lines.find(
            (line) =>
              line.length >= 3 &&
              line.length <= 70 &&
              /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]+$/.test(line) &&
              !invalidPlayerText.test(line),
          );
          if (nameLine) text = nameLine;

          if (text.length < 3 || text.length > 70) return "";
          if (!/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]+$/.test(text)) return "";
          if (invalidPlayerText.test(text)) return "";
          if (!/\s/.test(text)) return ""; // Vor- und Nachname erforderlich.
          return text;
        };

        const extractNumber = (value) => {
          const text = compact(value);
          const match = text.match(/(?:^|\s|#)(\d{1,2})(?=\s|$|[.)])/);
          if (!match) return null;
          const number = Number(match[1]);
          return number >= 0 && number <= 99 ? number : null;
        };

        const contextText = (node, levels = 5) => {
          const chunks = [];
          let current = node;
          for (let i = 0; current && i < levels; i += 1) {
            const text = compact(current.textContent);
            if (text && text.length <= 1600) chunks.push(text);
            current = current.parentElement;
          }
          return chunks.join(" | ");
        };

        const homeNorm = normalize(expectedHomeTeam);
        const awayNorm = normalize(expectedAwayTeam);
        const homeTokens = homeNorm.split(" ").filter((token) => token.length >= 3);
        const awayTokens = awayNorm.split(" ").filter((token) => token.length >= 3);
        const tokenHits = (text, tokens) => {
          const normalized = ` ${normalize(text)} `;
          return tokens.filter((token) => normalized.includes(` ${token} `)).length;
        };

        const classifySide = (node, context) => {
          const normalized = normalize(context);
          const homeHits = tokenHits(normalized, homeTokens);
          const awayHits = tokenHits(normalized, awayTokens);
          if (homeHits > awayHits && homeHits > 0) return "home";
          if (awayHits > homeHits && awayHits > 0) return "away";

          const rect = node.getBoundingClientRect();
          if (rect.width > 0) return rect.left + rect.width / 2 < window.innerWidth / 2 ? "home" : "away";
          return "";
        };

        // Schiedsrichter nur aus dem DOM-Bereich dieses konkreten Spiels akzeptieren.
        // Auf ÖFB-Seiten können zusätzlich Daten/Links anderer Partien gerendert sein;
        // ein globaler Text-Fallback hat dadurch z.B. den KM-Schiedsrichter in ein
        // Reserve-Spiel übernommen. Der lokale Bereich muss sowohl Heim- als auch
        // Gastteam des erwarteten Matches enthalten. BODY/HTML werden bewusst nicht
        // als Match-Container akzeptiert.
        const refereeLabels = /^(?:schiedsrichter|referee|hauptschiedsrichter|schiedsrichter\s*1|sr\s*1)\s*:?/i;
        const scopedRefereeCandidates = [];
        const refereeLabelNodes = [...document.querySelectorAll(
          "dt,th,td,li,p,span,strong,div,[class*='label'],[class*='info'],[class*='detail']",
        )].filter((node) => {
          const text = compact(node.textContent);
          return text && text.length <= 180 && refereeLabels.test(text);
        });

        for (const labelNode of refereeLabelNodes) {
          let container = labelNode.parentElement;
          for (let depth = 0; container && depth < 8; depth += 1, container = container.parentElement) {
            if (container === document.body || container === document.documentElement) break;
            const context = compact(container.textContent);
            if (!context || context.length > 6500) continue;
            const homeHits = tokenHits(context, homeTokens);
            const awayHits = tokenHits(context, awayTokens);
            if (homeHits < 1 || awayHits < 1) continue;

            const localCandidates = [
              labelNode.nextElementSibling,
              labelNode.parentElement?.querySelector("dd,[class*='value'],strong,b"),
            ].filter(Boolean);
            for (const candidate of localCandidates) {
              const value = cleanOfficial(compact(candidate.textContent));
              if (value && value.length <= 160 && !refereeLabels.test(value)) {
                scopedRefereeCandidates.push(value);
              }
            }

            const labelText = compact(labelNode.textContent);
            const inline = cleanOfficial(labelText.replace(refereeLabels, "").trim());
            if (inline && inline.length <= 160) scopedRefereeCandidates.push(inline);
            break;
          }
        }

        const scopedReferee = scopedRefereeCandidates.find((value) => {
          const normalized = normalize(value);
          if (!normalized || normalized.length < 4) return false;
          return !/(?:termine|spielbericht|aufstellung|tabelle|kader|zuschauer|spielort)/i.test(normalized);
        }) || "";

        // Für die exakt zugeordnete Einzel-Spielberichtseite ist ausschließlich
        // das strikte Label/Wert-Feld maßgeblich. Kein globaler/heuristischer Fallback.
        // Fehlt dort ein Schiedsrichter, ist für dieses Spiel offiziell keiner veröffentlicht.
        robustReferee = cleanOfficial(referee);
        if (!robustReferee) robustRefereeAssistants = [];

        const classifyRole = (context) => {
          const normalized = normalize(context);
          if (/ersatzbank|ersatzspieler|wechselspieler|bank|substitutes/.test(normalized)) return "bench";
          if (/startelf|startaufstellung|starting eleven|formation/.test(normalized)) return "starter";
          if (/aufstellung/.test(normalized)) return "starter";
          return "";
        };

        const playerSelectors = [
          "a[href*='Spieler']",
          "a[href*='spieler']",
          "a[href*='Person']",
          "a[href*='person']",
          "a[href*='Pass']",
          "[class*='lineup'] a[href]",
          "[class*='aufstellung'] a[href]",
          "[class*='formation'] a[href]",
          "[class*='player']",
          "[class*='spieler']",
        ].join(",");

        const candidates = [...document.querySelectorAll(playerSelectors)];
        const buckets = {
          homeStarter: [],
          homeBench: [],
          awayStarter: [],
          awayBench: [],
        };
        const seen = new Set();

        for (const node of candidates) {
          const card = node.closest(
            "li,tr,[class*='player'],[class*='spieler'],[class*='lineup'],[class*='formation'],[class*='aufstellung'],article,section,div",
          ) || node;
          const rawText = compact(card.textContent || node.textContent);
          const name = cleanPlayerName(node.textContent) || cleanPlayerName(rawText);
          if (!name) continue;

          const context = contextText(card, 7);
          const side = classifySide(card, context);
          const role = classifyRole(context);
          if (!side || !role) continue;

          const linkNode = node.closest("a[href]") || card.querySelector("a[href]");
          const playerUrl = linkNode ? absolute(linkNode.href) : "";
          const imageNode = card.querySelector("img[src],img[data-src],img[data-lazy-src]") || node.querySelector?.("img[src],img[data-src],img[data-lazy-src]");
          const imageUrl = imageNode ? absolute(imageNode.getAttribute("src") || imageNode.getAttribute("data-src") || imageNode.getAttribute("data-lazy-src") || "") : "";
          const number = extractNumber(rawText);
          const captain = /kapitän|captain|\(c\)|\bc\b/i.test(rawText);
          const goalkeeper = /torwart|goalkeeper|\btw\b|\bgk\b/i.test(rawText);
          const key = `${side}:${role}:${normalize(name)}:${playerUrl}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const item = { name, number, playerUrl, imageUrl, captain, goalkeeper };
          buckets[`${side}${role === "starter" ? "Starter" : "Bench"}`].push(item);
        }

        // Fallback für ÖFB-Seiten ohne eindeutige Spielerlinks: Abschnitte anhand
        // ihrer Überschriften auswerten und danach links/rechts zuordnen.
        const sectionHeadings = [
          ...document.querySelectorAll("h1,h2,h3,h4,h5,strong,[role='heading'],button,[class*='title']"),
        ].filter((node) => /startelf|ersatzbank|aufstellung|bank/i.test(compact(node.textContent)));

        for (const heading of sectionHeadings) {
          const headingText = compact(heading.textContent);
          const role = /ersatz|bank/i.test(headingText) ? "bench" : "starter";
          const container = heading.closest("section,article,[class*='lineup'],[class*='formation'],[class*='aufstellung'],div") || heading.parentElement;
          if (!container) continue;
          const side = classifySide(container, `${headingText} ${contextText(container, 5)}`);
          if (!side) continue;
          const bucket = buckets[`${side}${role === "starter" ? "Starter" : "Bench"}`];
          const localSeen = new Set(bucket.map((item) => normalize(item.name)));

          const rows = [...container.querySelectorAll("a[href],li,tr,[class*='player'],[class*='spieler']")];
          for (const row of rows) {
            const rowText = compact(row.textContent);
            const name = cleanPlayerName(row.textContent) || cleanPlayerName(rowText);
            if (!name || localSeen.has(normalize(name))) continue;
            const linkNode = row.closest("a[href]") || row.querySelector("a[href]");
            bucket.push({
              name,
              number: extractNumber(rowText),
              playerUrl: linkNode ? absolute(linkNode.href) : "",
              imageUrl: (() => { const img = row.querySelector?.("img[src],img[data-src],img[data-lazy-src]"); return img ? absolute(img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "") : ""; })(),
              captain: /kapitän|captain|\(c\)/i.test(rowText),
              goalkeeper: /torwart|goalkeeper|\btw\b|\bgk\b/i.test(rowText),
            });
            localSeen.add(normalize(name));
          }
        }

        const dedupeAndLimit = (items, limit) => {
          const result = [];
          const keys = new Set();
          for (const item of items) {
            const key = `${normalize(item.name)}:${item.playerUrl || ""}`;
            if (keys.has(key)) continue;
            keys.add(key);
            result.push(item);
            if (result.length >= limit) break;
          }
          return result;
        };

        const isValidPlayer = (item) => {
          const name = compact(item?.name);
          if (!name || name.length < 3 || name.length > 70) return false;
          if (!/\s/.test(name)) return false;
          if (/^(?:tor|torwart|goalkeeper|spieler|startelf|ersatzbank|bank|trainer|betreuer|heim|gast|aufstellung)$/i.test(name)) return false;
          return true;
        };

        const uniquePlayers = (items, limit = 30) => {
          const result = [];
          const keys = new Set();
          for (const item of items) {
            if (!isValidPlayer(item)) continue;
            const profileKey = String(item.playerUrl || "").match(/spielerdetails\/[^/]+\/([^~/?]+)/i)?.[1] || "";
            const key = profileKey || normalize(item.name);
            if (!key || keys.has(key)) continue;
            keys.add(key);
            result.push(item);
            if (result.length >= limit) break;
          }
          return result;
        };

        // Direkter ÖFB-Fallback: Auf der sichtbaren Aufstellungsansicht alle
        // Spielerprofile erfassen. Das funktioniert auch dann, wenn ÖFB die
        // bisherigen CSS-Klassennamen ändert oder keine Startelf-Überschrift
        // im direkten DOM-Elternknoten vorhanden ist.
        const profileAnchors = [...document.querySelectorAll(
          "a[href*='Spielerdetails'],a[href*='spielerdetails'],a[href*='/Spieler/'],a[href*='/spieler/']",
        )];
        const directSides = { home: [], away: [] };
        const directSeen = new Set();
        for (const anchor of profileAnchors) {
          const img = anchor.querySelector("img");
          const card = anchor.closest("li,tr,[class*='player'],[class*='spieler'],article,section,div") || anchor;
          const possibleNames = [
            anchor.textContent,
            anchor.getAttribute("aria-label"),
            anchor.getAttribute("title"),
            img?.getAttribute("alt"),
            img?.getAttribute("title"),
            card.textContent,
          ];
          let name = "";
          for (const candidateName of possibleNames) {
            name = cleanPlayerName(candidateName);
            if (name) break;
          }
          if (!name) continue;
          const playerUrl = absolute(anchor.href);
          const profileKey = String(playerUrl).match(/spielerdetails\/[^/]+\/([^~/?]+)/i)?.[1] || normalize(name);
          if (!profileKey || directSeen.has(profileKey)) continue;
          directSeen.add(profileKey);
          const rect = card.getBoundingClientRect();
          const side = rect.left + rect.width / 2 < window.innerWidth / 2 ? "home" : "away";
          directSides[side].push({
            name,
            number: extractNumber(compact(card.textContent)),
            playerUrl,
            captain: /kapitän|captain|\(c\)/i.test(compact(card.textContent)),
            goalkeeper: /torwart|goalkeeper|\btw\b|\bgk\b/i.test(compact(card.textContent)),
            top: rect.top + window.scrollY,
          });
        }
        directSides.home.sort((a, b) => a.top - b.top);
        directSides.away.sort((a, b) => a.top - b.top);

        let homeLineup = uniquePlayers(buckets.homeStarter, 30);
        let awayLineup = uniquePlayers(buckets.awayStarter, 30);
        let homeBench = uniquePlayers(buckets.homeBench, 20);
        let awayBench = uniquePlayers(buckets.awayBench, 20);

        if (homeLineup.length < 7 && directSides.home.length >= 7) {
          homeLineup = uniquePlayers(directSides.home.slice(0, 11), 11);
          if (!homeBench.length && directSides.home.length > 11) {
            homeBench = uniquePlayers(directSides.home.slice(11), 15);
          }
        }
        if (awayLineup.length < 7 && directSides.away.length >= 7) {
          awayLineup = uniquePlayers(directSides.away.slice(0, 11), 11);
          if (!awayBench.length && directSides.away.length > 11) {
            awayBench = uniquePlayers(directSides.away.slice(11), 15);
          }
        }

        // Wenn das responsive ÖFB-Layout beide Mannschaften untereinander
        // anordnet, kann die Links/Rechts-Erkennung versagen. In diesem Fall
        // wird die offizielle Reihenfolge der Profile verwendet: zuerst Heim,
        // danach Gast.
        if ((homeLineup.length < 7 || awayLineup.length < 7) && directSeen.size >= 18) {
          const combinedDirect = uniquePlayers(
            [...directSides.home, ...directSides.away].sort((a, b) => a.top - b.top),
            40,
          );
          if (combinedDirect.length >= 18) {
            if (homeLineup.length < 7) homeLineup = combinedDirect.slice(0, 11);
            if (awayLineup.length < 7) awayLineup = combinedDirect.slice(11, 22);
          }
        }

        // Letzter robuster ÖFB-Fallback: Die aktuelle Aufstellungsansicht wird
        // visuell ausgewertet. Das ist absichtlich NICHT von ÖFB-CSS-Klassen
        // abhängig. Sichtbare Namenselemente werden anhand ihrer Bildschirm-
        // position der Heim- bzw. Gastspalte zugeordnet. Damit funktionieren
        // auch Spielberichte, bei denen die Spielernamen nur als Text und nicht
        // als verlinkte Spielerprofile ausgegeben werden.
        if (homeLineup.length < 7 || awayLineup.length < 7) {
          const visible = (node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" &&
              Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
          };
          const leafNodes = [...document.querySelectorAll("[role='tabpanel'] *, main *, article *, section *")]
            .filter((node) => visible(node) && node.children.length === 0);
          const visual = [];
          const visualSeen = new Set();
          for (const node of leafNodes) {
            const rawValue = compact(node.innerText || node.textContent || "");
            const name = cleanPlayerName(rawValue);
            if (!name) continue;
            if (/schiedsrichter|trainer|betreuer|co-trainer|leiter|funktionär|beobachter/i.test(contextText(node, 2))) continue;
            const rect = node.getBoundingClientRect();
            // Navigation/Footer und extrem breite Textzeilen sind keine Spieler.
            if (rect.top < 0 || rect.width > window.innerWidth * 0.72) continue;
            const key = `${normalize(name)}:${Math.round(rect.left / 10)}:${Math.round((rect.top + window.scrollY) / 10)}`;
            if (visualSeen.has(key)) continue;
            visualSeen.add(key);
            visual.push({
              name,
              number: extractNumber(contextText(node, 2)),
              playerUrl: absolute(node.closest("a[href]")?.href || ""),
              captain: /kapitän|captain|\(c\)/i.test(contextText(node, 2)),
              goalkeeper: /torwart|goalkeeper|\btw\b|\bgk\b/i.test(contextText(node, 2)),
              x: rect.left + rect.width / 2,
              y: rect.top + window.scrollY,
            });
          }
          visual.sort((a, b) => a.y - b.y || a.x - b.x);
          const midpoint = window.innerWidth / 2;
          let visualHome = uniquePlayers(visual.filter((item) => item.x < midpoint), 30);
          let visualAway = uniquePlayers(visual.filter((item) => item.x >= midpoint), 30);

          // Im mobilen/gestapelten Layout gibt es keine zwei X-Spalten. Dort
          // wird die Reihenfolge verwendet, sobald mindestens zwei vollständige
          // Startelfen erkennbar sind.
          if ((visualHome.length < 7 || visualAway.length < 7) && visual.length >= 20) {
            const allVisual = uniquePlayers(visual, 40);
            visualHome = allVisual.slice(0, 11);
            visualAway = allVisual.slice(11, 22);
          }
          if (homeLineup.length < 7 && visualHome.length >= 7) homeLineup = visualHome.slice(0, 11);
          if (awayLineup.length < 7 && visualAway.length >= 7) awayLineup = visualAway.slice(0, 11);

          window.__TSU_VISUAL_LINEUP_DEBUG__ = {
            candidateCount: visual.length,
            homeCount: visualHome.length,
            awayCount: visualAway.length,
            sample: visual.slice(0, 30).map((item) => item.name),
          };
        }

        // ÖFB rendert beide Startelf-Spalten teilweise in einem gemeinsamen
        // DOM-Container. Dann landen beide Mannschaften im selben Bucket.
        // Eine Startelf hat regulär elf Spieler: Ist nur eine Seite gefüllt
        // und enthält mindestens 20 eindeutige Namen, wird exakt nach elf
        // Spielern in Heim und Gast getrennt. Überschriften wie „Tor“ wurden
        // davor bereits herausgefiltert.
        if (homeLineup.length >= 20 && awayLineup.length === 0) {
          awayLineup = homeLineup.slice(11, 22);
          homeLineup = homeLineup.slice(0, 11);
        } else if (awayLineup.length >= 20 && homeLineup.length === 0) {
          homeLineup = awayLineup.slice(0, 11);
          awayLineup = awayLineup.slice(11, 22);
        }

        // Bei einer nur teilweise erkannten Gegenseite darf ein Überhang
        // ebenfalls als zweite Startelf genutzt werden, jedoch nur wenn die
        // Zielseite noch deutlich unvollständig ist.
        if (homeLineup.length > 11 && awayLineup.length < 7) {
          const overflow = homeLineup.slice(11);
          homeLineup = homeLineup.slice(0, 11);
          awayLineup = uniquePlayers([...awayLineup, ...overflow], 11);
        }
        if (awayLineup.length > 11 && homeLineup.length < 7) {
          const overflow = awayLineup.slice(11);
          awayLineup = awayLineup.slice(0, 11);
          homeLineup = uniquePlayers([...homeLineup, ...overflow], 11);
        }

        homeLineup = homeLineup.slice(0, 11);
        awayLineup = awayLineup.slice(0, 11);

        // Ein Spieler darf pro Mannschaft nicht gleichzeitig in Startelf und
        // Ersatzbank stehen. Profil-ID hat Vorrang, sonst wird der Name genutzt.
        const playerKey = (item) =>
          String(item.playerUrl || "").match(/spielerdetails\/[^/]+\/([^~/?]+)/i)?.[1] || normalize(item.name);
        const homeStarterKeys = new Set(homeLineup.map(playerKey));
        const awayStarterKeys = new Set(awayLineup.map(playerKey));
        homeBench = homeBench.filter((item) => !homeStarterKeys.has(playerKey(item))).slice(0, 15);
        awayBench = awayBench.filter((item) => !awayStarterKeys.has(playerKey(item))).slice(0, 15);

        const eventSnapshots = Array.isArray(window.__TSU_EVENT_SNAPSHOTS__)
          ? window.__TSU_EVENT_SNAPSHOTS__.filter((value) => typeof value === "string")
          : [];

        const eventNoise = /(?:leaflet|openstreetmap|sportplatz\s+möllbrücke|waldweg\s+1|programm\s+(?:sa|so|mo|di|mi|do|fr)\.?|tabellen?|resultate|torverteilung|vereins-homepage|datenschutz|impressum|cookie|navigation|spielort\s+sportplatz|\+\s*−)/i;
        const eventKeyword = /(?:tor\b|trifft|spielstand|wechsel|ersetzt|kommt\s+für|verlässt\s+das\s+spielfeld|gelbe?\s+karte|gelb-?rote?\s+karte|rote?\s+karte|ausschluss|elfmeter|eigentor|halbzeit|pause|spielende|endstand|abpfiff)/i;

        const cleanEventDescription = (value) => compact(value)
          .replace(/^\s*(?:\d{1,3})(?:\s*\+\s*\d{1,2})?\s*[.'’:]?\s*/, "")
          .replace(/^\s*(?:tor|wechsel|ereignis|karte|gelbe karte|rote karte)\s*/i, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 420);

        const parseMinute = (value) => {
          const text = compact(value);
          const match = text.match(/(?:^|\s)(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*[.'’:]?(?=\s|$)/);
          if (!match) return null;
          const base = Number(match[1]);
          const added = match[2] ? Number(match[2]) : 0;
          if (!Number.isFinite(base) || base < 0 || base > 130) return null;
          return {
            minute: base,
            added,
            minuteText: added ? `${base}+${added}` : String(base),
            sortValue: base * 100 + added,
          };
        };

        const classifyEventType = (description) => {
          const text = normalize(description);
          if (/gelb\s*rot|gelbrote|zweite\s+gelbe/.test(text)) return "yellowRed";
          if (/rote?\s+karte|ausschluss|vom\s+platz/.test(text)) return "red";
          if (/gelbe?\s+karte|verwarnt/.test(text)) return "yellow";
          if (/wechsel|ersetzt|kommt\s+fur|verlasst\s+das\s+spielfeld|einwechslung|auswechslung/.test(text)) return "substitution";
          if (/halbzeit|pause/.test(text)) return "halfTime";
          if (/spielende|endstand|abpfiff/.test(text)) return "fullTime";
          if (/tor\b|trifft|spielstand|elfmeter|eigentor/.test(text)) return "goal";
          return "other";
        };

        const eventTeam = (description) => {
          const homeHits = tokenHits(description, homeTokens);
          const awayHits = tokenHits(description, awayTokens);
          if (homeHits > awayHits && homeHits > 0) return "home";
          if (awayHits > homeHits && awayHits > 0) return "away";
          return "neutral";
        };

        const events = [];
        const seenEvents = new Set();

        const addEvent = (rawValue, forcedMinute = null) => {
          const rawText = compact(rawValue);
          if (!rawText || rawText.length < 5 || rawText.length > 1400) return;
          if (eventNoise.test(rawText)) return;
          if (!eventKeyword.test(rawText)) return;

          const parsedMinute = forcedMinute || parseMinute(rawText);
          if (!parsedMinute) return;

          const description = cleanEventDescription(rawText);
          if (!description || description.length < 4 || eventNoise.test(description)) return;
          if (!eventKeyword.test(description)) return;

          const type = classifyEventType(description);
          const normalizedDescription = normalize(description)
            .replace(/\b(?:neuerlicher|erneuter|nochmaliger)\b/g, "")
            .replace(/\s+/g, " ")
            .trim();
          const key = `${parsedMinute.minuteText}:${type}:${normalizedDescription}`;
          if (seenEvents.has(key)) return;
          seenEvents.add(key);

          events.push({
            id: `event-${parsedMinute.minuteText}-${type}-${seenEvents.size}`,
            minute: parsedMinute.minute,
            minuteText: parsedMinute.minuteText,
            type,
            team: eventTeam(description),
            playerName: "",
            secondaryPlayerName: "",
            description,
            _sortValue: parsedMinute.sortValue,
          });
        };

        // 1. Strukturierte DOM-Elemente aus dem aktuell sichtbaren Reiter.
        const structuredSelectors = [
          "[class*='ticker'] li",
          "[class*='ticker'] [class*='item']",
          "[class*='timeline'] li",
          "[class*='timeline'] [class*='item']",
          "[class*='event']",
          "[class*='ereignis']",
          "[data-event]",
          "[data-minute]",
          "[data-testid*='event']",
        ];
        const structuredNodes = [...new Set(
          structuredSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]),
        )];
        for (const node of structuredNodes) {
          const text = compact(node.innerText || node.textContent || "");
          const minuteAttribute = compact(
            node.getAttribute("data-minute") ||
            node.querySelector("[data-minute]")?.getAttribute("data-minute") ||
            "",
          );
          addEvent(text, minuteAttribute ? parseMinute(minuteAttribute) : null);
        }

        // 2. Gesicherte Reiter-Inhalte zeilen- und blockweise analysieren.
        const sourceTexts = [...eventSnapshots, bodyText];
        for (const sourceText of sourceTexts) {
          const lines = String(sourceText || "")
            .split(/\n+/)
            .map(compact)
            .filter(Boolean);

          // Einzelne Zeilen mit Minute am Anfang.
          for (const line of lines) addEvent(line);

          // Mehrzeilige Ereigniskarten: Minute und Beschreibung können getrennt sein.
          for (let index = 0; index < lines.length; index += 1) {
            const minuteOnly = parseMinute(lines[index]);
            if (!minuteOnly || !/^\d{1,3}(?:\s*\+\s*\d{1,2})?\s*[.'’:]?$/.test(lines[index])) continue;
            const following = lines.slice(index + 1, index + 5).join(" ");
            addEvent(`${lines[index]} ${following}`, minuteOnly);
          }

          // Fließtext-Fallback mit Unterstützung für Nachspielzeit.
          const flowPattern = /(?:^|\s)(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*[.'’:]\s*(.*?)(?=(?:\s\d{1,3}(?:\s*\+\s*\d{1,2})?\s*[.'’:])|$)/g;
          let flowMatch;
          while ((flowMatch = flowPattern.exec(sourceText))) {
            const base = Number(flowMatch[1]);
            const added = flowMatch[2] ? Number(flowMatch[2]) : 0;
            addEvent(`${base}${added ? `+${added}` : ""}' ${flowMatch[3]}`, {
              minute: base,
              added,
              minuteText: added ? `${base}+${added}` : String(base),
              sortValue: base * 100 + added,
            });
          }
        }

        events.sort((a, b) => a._sortValue - b._sortValue || a.description.localeCompare(b.description, "de-AT"));

        // ÖFB liefert in manchen Ansichten einen Ereignisblock mit mehreren bereits
        // gefallenen Toren. Dadurch konnten mehrere Tore derselben Spielminute
        // zugeordnet werden. Für den Liveticker wird pro Spielminute genau das
        // spezifischste Torereignis übernommen. Karten und Wechsel bleiben
        // davon unberührt.
        const goalByMinute = new Map();
        const filteredEvents = [];
        for (const event of events) {
          if (event.type !== "goal") {
            filteredEvents.push(event);
            continue;
          }

          const minuteKey = event.minuteText || String(event.minute ?? "");
          const existing = goalByMinute.get(minuteKey);
          if (!existing) {
            goalByMinute.set(minuteKey, event);
            continue;
          }

          // Kürzere Texte sind auf der ÖFB-Seite fast immer das einzelne
          // Torereignis; lange Texte enthalten häufig mehrere vorherige Tore.
          const eventScore = event.description.length;
          const existingScore = existing.description.length;
          if (eventScore < existingScore) goalByMinute.set(minuteKey, event);
        }

        filteredEvents.push(...goalByMinute.values());
        filteredEvents.sort((a, b) => a._sortValue - b._sortValue || a.description.localeCompare(b.description, "de-AT"));
        events.length = 0;
        events.push(...filteredEvents);

        for (const event of events) delete event._sortValue;

        const images = [...document.images]
          .map((img) => absolute(img.currentSrc || img.src || img.dataset?.src))
          .filter(Boolean);
        const heroImage =
          images.find((url) => !/logo|icon|avatar|placeholder/i.test(url)) || "";

        return {
          finalUrl: location.href,
          title: compact(document.title),
          heading: compact(document.querySelector("h1")?.textContent || ""),
          topText,
          bodyLength: bodyText.length,
          result,
          attendance: robustAttendance,
          referee: robustReferee,
          refereeAssistants: robustRefereeAssistants,
          venue: compact(venue),
          venueAddress: compact(venueAddress),
          homeLineup,
          awayLineup,
          homeBench,
          awayBench,
          events,
          heroImage,
          playerCandidateCount: candidates.length,
          directProfileCount: directSeen.size,
          visualLineupDebug: window.__TSU_VISUAL_LINEUP_DEBUG__ || null,
          preview: textLines.slice(0, 35).join(" | ").slice(0, 1800),
        };
      },
      {
        expectedHomeTeam: compact(match.homeTeam),
        expectedAwayTeam: compact(match.awayTeam),
      },
    );

    // Deep-Fallback für die aktuelle ÖFB-Vereinsseite: Aufstellungen können
    // in einem nachgeladenen Frame/Widget liegen. page.evaluate() sieht nur den
    // Hauptframe. Deshalb werden bei unvollständiger Startelf ALLE Frames direkt
    // nach offiziellen Spielerprofilen durchsucht. Dieser Fallback ist bewusst
    // eng: Es werden nur ÖFB-Spielerlinks akzeptiert und niemals freie Namen erfunden.
    if ((raw.homeLineup?.length || 0) < 7 || (raw.awayLineup?.length || 0) < 7) {
      const framePlayers = [];
      const frameDiagnostics = [];
      for (const frame of page.frames()) {
        try {
          const data = await frame.evaluate(() => {
            const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
            const cleanName = (value) => {
              const text = compact(value)
                .replace(/^#?\s*\d{1,3}\s*/, "")
                .replace(/\s*\([^)]*(?:kapitän|captain|tw|gk)[^)]*\)\s*$/i, "")
                .trim();
              if (text.length < 3 || text.length > 80 || !/\s/.test(text)) return "";
              if (!/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]+$/.test(text)) return "";
              if (/^(?:aufstellung|startelf|ersatzbank|trainer|betreuer|heim|gast|spieler)$/i.test(text)) return "";
              return text;
            };
            const anchors = [...document.querySelectorAll(
              "a[href*='Spielerdetails'],a[href*='spielerdetails'],a[href*='/Spieler/'],a[href*='/spieler/'],a[href*='Player'],a[href*='player']"
            )];
            const players = [];
            for (const anchor of anchors) {
              const card = anchor.closest("li,tr,article,section,[class*='player'],[class*='spieler'],div") || anchor;
              const img = anchor.querySelector("img");
              const values = [anchor.textContent, anchor.getAttribute("title"), anchor.getAttribute("aria-label"), img?.alt, card.textContent];
              let name = "";
              for (const value of values) { name = cleanName(value); if (name) break; }
              if (!name) continue;
              const href = anchor.href || "";
              const rect = card.getBoundingClientRect();
              const context = compact(card.textContent || "");
              players.push({
                name,
                playerUrl: href,
                number: Number(context.match(/(?:^|\s|#)(\d{1,2})(?=\s|$|[.)])/)?.[1] || 0) || null,
                captain: /kapitän|captain|\(c\)/i.test(context),
                goalkeeper: /torwart|goalkeeper|\btw\b|\bgk\b/i.test(context),
                x: rect.left + rect.width / 2,
                y: rect.top + window.scrollY,
              });
            }
            return {
              url: location.href,
              title: document.title,
              bodyLength: (document.body?.innerText || "").length,
              playerCount: players.length,
              players,
            };
          });
          frameDiagnostics.push({ url: data.url, title: data.title, bodyLength: data.bodyLength, playerCount: data.playerCount });
          framePlayers.push(...data.players.map((player) => ({ ...player, frameUrl: data.url })));
        } catch (error) {
          frameDiagnostics.push({ url: frame.url(), error: error.message || String(error) });
        }
      }

      const normalized = (value) => String(value || "").toLocaleLowerCase("de-AT")
        .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
        .replace(/[^a-z0-9]+/g," ").trim();
      const unique = [];
      const seenPlayers = new Set();
      for (const player of framePlayers.sort((a,b) => a.y - b.y || a.x - b.x)) {
        const id = String(player.playerUrl || "").match(/spielerdetails\/[^/]+\/([^~/?]+)/i)?.[1] || normalized(player.name);
        if (!id || seenPlayers.has(id)) continue;
        seenPlayers.add(id);
        unique.push(player);
      }

      // Eine veröffentlichte ÖFB-Startelf besteht aus 11 + 11 Spielern. Nur
      // wenn mindestens 18 eindeutige offizielle Profile gefunden wurden, darf
      // dieser Fallback die vorhandene Erkennung ersetzen.
      if (unique.length >= 18) {
        if ((raw.homeLineup?.length || 0) < 7) raw.homeLineup = unique.slice(0, 11).map(({x,y,frameUrl,...player}) => player);
        if ((raw.awayLineup?.length || 0) < 7) raw.awayLineup = unique.slice(11, 22).map(({x,y,frameUrl,...player}) => player);
        if ((!raw.homeBench || raw.homeBench.length === 0) && unique.length > 22) {
          raw.homeBench = unique.slice(22, Math.min(29, unique.length)).map(({x,y,frameUrl,...player}) => player);
        }
      }
      raw.deepFramePlayerCount = unique.length;
      raw.frameDiagnostics = frameDiagnostics;
    }

    // Vor einem zukünftigen Spiel dürfen nur tatsächlich veröffentlichte
    // Spielberichts-Daten übernommen werden. ÖFB-Seiten enthalten auch Kader-
    // und Profil-Links außerhalb der offiziellen Aufstellung; diese wurden
    // bisher teilweise fälschlich als Startelf interpretiert. Eine zukünftige
    // Aufstellung gilt deshalb erst als veröffentlicht, wenn beide Startelfen
    // praktisch vollständig erkannt werden.
    const isFutureMatch = Boolean(
      match.kickoffDate && match.kickoffDate.getTime() > Date.now()
    );
    if (isFutureMatch) {
      const homeCount = Array.isArray(raw.homeLineup) ? raw.homeLineup.length : 0;
      const awayCount = Array.isArray(raw.awayLineup) ? raw.awayLineup.length : 0;
      const officialFutureLineupPublished = homeCount >= 10 && awayCount >= 10;
      if (!officialFutureLineupPublished) {
        raw.homeLineup = [];
        raw.awayLineup = [];
        raw.homeBench = [];
        raw.awayBench = [];
      }
    }

    const validation = validateReportPage(match, raw);

    const report = {
      id: reportIdFor(match),
      matchId: match.id,
      matchUid: compact(match.matchUid || match.id),
      gameId: validation.finalGameId ||
        compact(match._resolvedGameId || match.gameId || match.oefbMatchId),
      oefbMatchId: validation.finalGameId ||
        compact(match._resolvedGameId || match.gameId || match.oefbMatchId),
      teamId: compact(match.teamId),
      teamName: compact(match.teamName),
      competitionName: compact(
        match.competitionName,
      ),
      homeTeam: compact(match.homeTeam),
      awayTeam: compact(match.awayTeam),
      // Bei zukünftigen Spielen niemals Uhrzeiten wie 15:00 als Ergebnis werten.
      // ÖFB-Seiten enthalten die Anstoßzeit in denselben DOM-Bereichen wie
      // Ergebnis-/Score-Elemente; ohne diese Sperre wurde z. B. 15:00 als 15:0 erkannt.
      homeScore:
        match.kickoffDate && match.kickoffDate.getTime() > Date.now()
          ? null
          : (raw.result?.home ??
            (Number.isFinite(match.homeScore) ? match.homeScore : null)),
      awayScore:
        match.kickoffDate && match.kickoffDate.getTime() > Date.now()
          ? null
          : (raw.result?.away ??
            (Number.isFinite(match.awayScore) ? match.awayScore : null)),
      kickoffAt:
        match.kickoffAt ||
        admin.firestore.Timestamp.fromDate(
          match.kickoffDate,
        ),
      // Bei einem expliziten offiziellen Override darf ein bekannter offizieller
      // Spielort den alten Firestore-Wert (z. B. fälschlich „Termine“) ersetzen.
      // Für alle anderen Spiele bleibt die DOM-Auswertung die primäre Quelle.
      venue: cleanVenueValue(matchingOverride(match, { allowTeamOnly: true })?.venue) || cleanVenueValue(raw.venue) || cleanVenueValue(match.venue),
      venueAddress: raw.venueAddress || compact(match.venueAddress),
      // Schiedsrichter ausschließlich von exakt dieser ÖFB-Spielberichtseite.
      // Kein Fallback auf bereits im Match gespeicherte Werte, da diese aus
      // einer früheren Fehlzuordnung stammen können.
      referee: raw.referee || "",
      refereeAssistants: raw.refereeAssistants || [],
      attendance: raw.attendance,
      homeLineup: raw.homeLineup,
      awayLineup: raw.awayLineup,
      homeBench: raw.homeBench || [],
      awayBench: raw.awayBench || [],
      events: raw.events,
      eventCount: raw.events.length,
      lineupPlayerCount:
        raw.homeLineup.length +
        raw.awayLineup.length +
        (raw.homeBench || []).length +
        (raw.awayBench || []).length,
      reportUrl: absoluteUrl(
        raw.finalUrl,
        match.reportUrl,
      ),
      imageUrl: raw.heroImage,
      published: validation.valid &&
        Boolean(
          raw.events.length ||
            raw.homeLineup.length ||
            raw.awayLineup.length ||
            (raw.homeBench || []).length ||
            (raw.awayBench || []).length ||
            raw.result ||
            raw.referee ||
            raw.venue,
        ),
      active: true,
      source: "oefb-official-report",
      sourceUrl: absoluteUrl(
        raw.finalUrl,
        match.reportUrl,
      ),
      parserVersion: VERSION,
      sourceUpdatedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    };

    return {
      ok: report.published,
      match,
      report,
      diagnostic: {
        matchId: match.id,
        reportUrl: match.reportUrl,
        resolutionSource: match._reportResolutionSource || "",
        resolutionScore: match._reportResolutionScore || 0,
        finalUrl: raw.finalUrl,
        requestedGameId:
          validation.requestedGameId,
        finalGameId: validation.finalGameId,
        title: raw.title,
        heading: raw.heading,
        bodyLength: raw.bodyLength,
        lineupPlayers: report.lineupPlayerCount,
        homeStarters: raw.homeLineup.length,
        awayStarters: raw.awayLineup.length,
        homeBenchPlayers: (raw.homeBench || []).length,
        awayBenchPlayers: (raw.awayBench || []).length,
        playerCandidateCount: raw.playerCandidateCount || 0,
        directProfileCount: raw.directProfileCount || 0,
        deepFramePlayerCount: raw.deepFramePlayerCount || 0,
        frameDiagnostics: raw.frameDiagnostics || [],
        visualLineupDebug: raw.visualLineupDebug || null,
        events: report.eventCount,
        hasResult: Boolean(raw.result),
        venue: cleanVenueValue(matchingOverride(match, { allowTeamOnly: true })?.venue) || cleanVenueValue(raw.venue) || "",
        venueAddress: raw.venueAddress || "",
        referee: raw.referee || "",
        refereeAssistants: raw.refereeAssistants || [],
        attendance: raw.attendance,
        valid: validation.valid,
        validationErrors: validation.reasons,
        durationSeconds: Math.round(
          (Date.now() - started) / 1000,
        ),
        error: report.published
          ? ""
          : validation.reasons.join("; ") ||
            "Keine veröffentlichten Berichtsdaten erkannt",
      },
    };
  } catch (error) {
    return {
      ok: false,
      match,
      report: null,
      diagnostic: {
        matchId: match.id,
        reportUrl: match.reportUrl,
        resolutionSource: match._reportResolutionSource || "",
        resolutionScore: match._reportResolutionScore || 0,
        durationSeconds: Math.round(
          (Date.now() - started) / 1000,
        ),
        error: error.message || String(error),
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function upsertReport(report, runId) {
  const ref = db
    .collection(REPORT_COLLECTION)
    .doc(report.id);

  const existing = await ref.get();
  const old = existing.exists ? existing.data() : {};

  const kickoffDate = asDate(report.kickoffAt);
  const isFutureReport = kickoffDate.getTime() > Date.now();
  const homeScore = Number.isInteger(report.homeScore)
    ? report.homeScore
    : (Number.isInteger(old.homeScore) ? old.homeScore : null);
  const awayScore = Number.isInteger(report.awayScore)
    ? report.awayScore
    : (Number.isInteger(old.awayScore) ? old.awayScore : null);
  const homeLineup = report.homeLineup.length
    ? report.homeLineup
    : (isFutureReport ? [] : (old.homeLineup || []));
  const awayLineup = report.awayLineup.length
    ? report.awayLineup
    : (isFutureReport ? [] : (old.awayLineup || []));
  const homeBench = report.homeBench.length
    ? report.homeBench
    : (isFutureReport ? [] : (old.homeBench || []));
  const awayBench = report.awayBench.length
    ? report.awayBench
    : (isFutureReport ? [] : (old.awayBench || []));
  const referee = report.referee || (isFutureReport ? "" : (old.referee || ""));
  const venue = cleanVenueValue(report.venue) || (isFutureReport ? "" : cleanVenueValue(old.venue)) || "";
  const refereeAssistants = report.refereeAssistants.length
    ? report.refereeAssistants
    : (isFutureReport ? [] : (old.refereeAssistants || []));
  const lineupPlayerCount =
    homeLineup.length + awayLineup.length + homeBench.length + awayBench.length;

  await ref.set(
    {
      ...old,
      ...report,
      homeScore,
      awayScore,
      imageUrl: report.imageUrl || old.imageUrl || "",
      venue,
      venueAddress: report.venueAddress || old.venueAddress || "",
      referee,
      refereeAssistants,
      attendance: Number.isInteger(report.attendance)
        ? report.attendance
        : (Number.isInteger(old.attendance) ? old.attendance : null),
      homeLineup,
      awayLineup,
      homeBench,
      awayBench,
      events: report.events.length ? report.events : old.events || [],
      lineupPlayerCount,
      reportComplete: Boolean(
        Number.isInteger(homeScore) &&
        Number.isInteger(awayScore) &&
        homeLineup.length >= 7 &&
        awayLineup.length >= 7 &&
        referee &&
        venue
      ),
      active: true,
      lastSeenRunId: runId,
      reportLastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function updateMatchFromReport(report) {
  if (!report.matchId) return;
  const ref = db.collection(MATCH_COLLECTION).doc(report.matchId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;

  const patch = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reportUrl: report.reportUrl || "",
    gameId: report.gameId || "",
    oefbMatchId: report.oefbMatchId || "",
  };

  const cleanReportVenue = cleanVenueValue(report.venue);
  const cleanExistingVenue = cleanVenueValue(snapshot.data()?.venue);
  if (cleanReportVenue) patch.venue = cleanReportVenue;
  else if (snapshot.data()?.venue && (!cleanExistingVenue || asDate(snapshot.data()?.kickoffAt || report.kickoffAt).getTime() > Date.now())) patch.venue = admin.firestore.FieldValue.delete();
  const cleanReportVenueAddress = cleanVenueValue(report.venueAddress);
  if (cleanReportVenueAddress) patch.venueAddress = cleanReportVenueAddress;
  else if (snapshot.data()?.venueAddress && !cleanVenueValue(snapshot.data()?.venueAddress)) patch.venueAddress = admin.firestore.FieldValue.delete();
  const snapshotData = snapshot.data() || {};
  const matchKickoff = asDate(snapshotData.kickoffAt || report.kickoffAt);
  const isFutureMatch = matchKickoff.getTime() > Date.now();

  if (report.referee) patch.referee = report.referee;
  else if (isFutureMatch && snapshotData.referee) {
    // Exakte ÖFB-Seite enthält aktuell keinen Schiedsrichter: einen früher
    // falsch zugeordneten Wert für dieses zukünftige Spiel entfernen.
    patch.referee = admin.firestore.FieldValue.delete();
  }


  // WICHTIG: Der Spielbericht-Sync darf NIEMALS Ergebnis oder Spielstatus
  // im zentralen Spiel-Dokument verändern. Diese Felder gehören ausschließlich
  // dem offiziellen Spielplan-Sync (kfv-games-sync.cjs). Dadurch können Uhrzeiten
  // wie 15:00, 12:30 oder 13:45 nicht mehr als Resultate interpretiert werden.
  if (Array.isArray(report.homeLineup) && report.homeLineup.length) patch.homeLineup = report.homeLineup;
  else if (isFutureMatch && Array.isArray(snapshotData.homeLineup) && snapshotData.homeLineup.length) patch.homeLineup = [];
  if (Array.isArray(report.awayLineup) && report.awayLineup.length) patch.awayLineup = report.awayLineup;
  else if (isFutureMatch && Array.isArray(snapshotData.awayLineup) && snapshotData.awayLineup.length) patch.awayLineup = [];
  if (Array.isArray(report.homeBench) && report.homeBench.length) patch.homeBench = report.homeBench;
  else if (isFutureMatch && Array.isArray(snapshotData.homeBench) && snapshotData.homeBench.length) patch.homeBench = [];
  if (Array.isArray(report.awayBench) && report.awayBench.length) patch.awayBench = report.awayBench;
  else if (isFutureMatch && Array.isArray(snapshotData.awayBench) && snapshotData.awayBench.length) patch.awayBench = [];
  if (Array.isArray(report.refereeAssistants) && report.refereeAssistants.length) patch.refereeAssistants = report.refereeAssistants;
  else if (isFutureMatch && Array.isArray(snapshotData.refereeAssistants) && snapshotData.refereeAssistants.length) patch.refereeAssistants = [];
  if (Number.isInteger(report.attendance)) patch.attendance = report.attendance;

  const homeLineupAvailable = Math.max(
    Array.isArray(report.homeLineup) ? report.homeLineup.length : 0,
    Array.isArray(snapshotData.homeLineup) ? snapshotData.homeLineup.length : 0,
  ) >= 7;
  const awayLineupAvailable = Math.max(
    Array.isArray(report.awayLineup) ? report.awayLineup.length : 0,
    Array.isArray(snapshotData.awayLineup) ? snapshotData.awayLineup.length : 0,
  ) >= 7;
  const lineupAvailable = homeLineupAvailable && awayLineupAvailable;
  const refereeAvailable = Boolean(report.referee || snapshotData.referee);
  const venueAvailable = Boolean(report.venue || snapshotData.venue);
  const resultAvailable =
    (Number.isInteger(report.homeScore) && Number.isInteger(report.awayScore)) ||
    (Number.isInteger(snapshotData.homeScore) && Number.isInteger(snapshotData.awayScore));
  patch.reportComplete = Boolean(lineupAvailable && refereeAvailable && venueAvailable && resultAvailable);
  patch.reportLastCheckedAt = admin.firestore.FieldValue.serverTimestamp();

  await ref.set(patch, { merge: true });
}

async function createNewsDraft(
  report,
  match,
  runId,
) {
  if (!report.published) {
    return {
      written: false,
      reason: "report-empty",
    };
  }

  const id = `auto_match_${sha(
    match.id || report.reportUrl,
  )}`;

  const ref = db.collection(NEWS_COLLECTION).doc(id);
  const existing = await ref.get();
  const old = existing.exists ? existing.data() : {};

  if (
    old.manualOverride === true ||
    old.source === "manual"
  ) {
    return {
      written: false,
      reason: "manual-override",
    };
  }

  const score =
    Number.isFinite(report.homeScore) &&
    Number.isFinite(report.awayScore)
      ? `${report.homeScore}:${report.awayScore}`
      : "";

  const title = score
    ? `${report.homeTeam} ${score} ${report.awayTeam}`
    : resultTitle(match);

  const eventSummary = report.events
    .slice(0, 6)
    .map(
      (event) =>
        `${event.minute}. Minute: ${event.description}`,
    )
    .join("\n");

  const lineupSummary = report.lineupPlayerCount
    ? `Im offiziellen Spielbericht sind ${report.lineupPlayerCount} Spieler in den Aufstellungen erfasst.`
    : "";

  const summary = score
    ? `Offizieller Spielbericht zum ${score} zwischen ${report.homeTeam} und ${report.awayTeam}.`
    : `Offizieller Spielbericht zu ${report.homeTeam} gegen ${report.awayTeam}.`;

  const content = [
    summary,
    report.venue
      ? `Spielort: ${report.venue}`
      : "",
    report.referee
      ? `Schiedsrichter: ${report.referee}`
      : "",
    Number.isFinite(report.attendance)
      ? `Zuschauer: ${report.attendance}`
      : "",
    lineupSummary,
    eventSummary,
    `Offizieller Bericht: ${report.reportUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  await ref.set(
    {
      title,
      summary,
      content,
      category: categoryForTeam(
        match.teamId,
        match.teamName,
      ),
      imageUrl:
        report.imageUrl || old.imageUrl || "",
      authorName: "TSU Ainet Official Sync",
      published: old.published === true,
      featured: old.featured === true,
      publishedAt:
        match.kickoffAt ||
        admin.firestore.Timestamp.fromDate(
          match.kickoffDate,
        ),
      source: "oefb-auto-draft",
      sourceMatchId: match.id,
      sourceReportId: report.id,
      sourceUrl: report.reportUrl,
      autoGenerated: true,
      manualOverride: false,
      active: true,
      lastSeenRunId: runId,
      updatedAt:
        admin.firestore.FieldValue.serverTimestamp(),
      createdAt:
        old.createdAt ||
        admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    written: true,
    reason: existing.exists
      ? "updated"
      : "created",
  };
}

async function deactivateInvalidLegacyDrafts() {
  const snapshot = await db
    .collection(NEWS_COLLECTION)
    .where("source", "==", "oefb-auto-draft")
    .get();

  let deactivated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (
      data.manualOverride === true ||
      data.published === true
    ) {
      continue;
    }

    if (!isIndividualReportUrl(data.sourceUrl)) {
      await doc.ref.set(
        {
          active: false,
          invalidatedByVersion: VERSION,
          invalidatedReason:
            "Keine einzelne ÖFB-Spielbericht-URL",
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      deactivated += 1;
    }
  }

  return deactivated;
}

async function deactivateInvalidLegacyReports() {
  const snapshot = await db
    .collection(REPORT_COLLECTION)
    .get();

  let deactivated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (
      data.source === "oefb-official-report" &&
      !isIndividualReportUrl(
        data.reportUrl || data.sourceUrl,
      )
    ) {
      await doc.ref.set(
        {
          active: false,
          published: false,
          invalidatedByVersion: VERSION,
          invalidatedReason:
            "Keine einzelne ÖFB-Spielbericht-URL",
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      deactivated += 1;
    }
  }

  return deactivated;
}

async function main() {
  const runId = `report-news-${Date.now()}`;
  const startedAt = Date.now();
  const statusRef = db
    .collection("settings")
    .doc(STATUS_DOC);

  await statusRef.set(
    {
      success: false,
      running: true,
      runId,
      version: VERSION,
      startedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  let browser;

  try {
    let candidateMatches = await loadCandidateMatches();
    console.log(`Spielbericht-Sync Parser-Version: ${VERSION}`);
    console.log(`Smart-Gate Eingang: ${candidateMatches.length} relevante Spiele im Zeitfenster; manual=${MANUAL_RUN}.`);
    candidateMatches = await keepMatchesNeedingPrematchData(candidateMatches);
    console.log(`Smart-Gate Ausgang: ${candidateMatches.length} Spiele werden tatsächlich über ÖFB geprüft.`);

    if (!candidateMatches.length) {
      console.log("Smart-Gate: Kein Spiel benötigt aktuell Aufstellung/Schiedsrichter. Browser und ÖFB-Abrufe werden übersprungen.");
      await statusRef.set({
        success: true,
        running: false,
        runId,
        version: VERSION,
        smartSkipped: true,
        candidateMatchCount: 0,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const [
      invalidLegacyDrafts,
      invalidLegacyReports,
    ] = await Promise.all([
      deactivateInvalidLegacyDrafts(),
      deactivateInvalidLegacyReports(),
    ]);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    const resolution = await resolveMatchReports(browser, candidateMatches);
    const matches = resolution.matches;

    console.log(`Phase 4: ${candidateMatches.length} Spiele geprüft, ${matches.length} eindeutige Bericht-URLs aufgelöst.`);
    console.log(`Offizielle Bericht-Links im Index: ${resolution.indexCount}; korrigierte Spiele: ${resolution.correctedCount}`);

    const results = await mapLimit(
      matches,
      CONCURRENCY,
      (match) => extractReport(browser, match),
    );

    let reportWrites = 0;
    let newsDraftWrites = 0;
    let manualSkips = 0;

    for (const result of results) {
      if (!result.ok || !result.report) continue;

      await upsertReport(result.report, runId);
      await updateMatchFromReport(result.report);

      const debugHomeLineup = Array.isArray(result.report.homeLineup)
        ? result.report.homeLineup.map((player) => compact(player?.name || player?.playerName || player?.fullName || player)).filter(Boolean)
        : [];
      const debugAwayLineup = Array.isArray(result.report.awayLineup)
        ? result.report.awayLineup.map((player) => compact(player?.name || player?.playerName || player?.fullName || player)).filter(Boolean)
        : [];
      const debugHomeBench = Array.isArray(result.report.homeBench)
        ? result.report.homeBench.map((player) => compact(player?.name || player?.playerName || player?.fullName || player)).filter(Boolean)
        : [];
      const debugAwayBench = Array.isArray(result.report.awayBench)
        ? result.report.awayBench.map((player) => compact(player?.name || player?.playerName || player?.fullName || player)).filter(Boolean)
        : [];

      console.log(
        `ÖFB DETAILS ${result.report.oefbMatchId || result.report.gameId || result.report.matchId}: ` +
        `Spiel=${result.report.homeTeam} vs ${result.report.awayTeam} | ` +
        `Spielort="${result.report.venue || ""}" | ` +
        `Adresse="${result.report.venueAddress || ""}" | ` +
        `Schiedsrichter="${result.report.referee || ""}" | ` +
        `Heim-Aufstellung=${debugHomeLineup.length} [${debugHomeLineup.join(", ")}] | ` +
        `Gast-Aufstellung=${debugAwayLineup.length} [${debugAwayLineup.join(", ")}] | ` +
        `Heim-Bank=${debugHomeBench.length} [${debugHomeBench.join(", ")}] | ` +
        `Gast-Bank=${debugAwayBench.length} [${debugAwayBench.join(", ")}]`
      );
      console.log(
        `ÖFB FIRESTORE ${result.report.oefbMatchId || result.report.gameId || result.report.matchId}: ` +
        `matchId=${result.report.matchId} | reportId=${result.report.id} | ` +
        `Quelle=${result.report.reportUrl || ""}`
      );

      reportWrites += 1;

      const draft = await createNewsDraft(
        result.report,
        result.match,
        runId,
      );

      if (draft.written) newsDraftWrites += 1;
      if (draft.reason === "manual-override") {
        manualSkips += 1;
      }
    }

    const diagnostics = results.map(
      (result) => result.diagnostic,
    );

    const failedCount = results.filter(
      (result) => !result.ok,
    ).length;

    for (const diagnostic of diagnostics) {
      console.log(
        `ÖFB Parser ${diagnostic.finalGameId || diagnostic.requestedGameId || diagnostic.matchId}: ` +
        `Startelf Heim=${diagnostic.homeStarters || 0}, Gast=${diagnostic.awayStarters || 0}, ` +
        `Bank Heim=${diagnostic.homeBenchPlayers || 0}, Gast=${diagnostic.awayBenchPlayers || 0}, ` +
        `Profile=${diagnostic.directProfileCount || 0}, DeepFrames=${diagnostic.deepFramePlayerCount || 0}, Kandidaten=${diagnostic.playerCandidateCount || 0}, ` +
        `SR=${diagnostic.referee ? "ja" : "nein"}, Ort=${diagnostic.venue ? "ja" : "nein"}, ` +
        `Spielort="${diagnostic.venue || ""}", Schiedsrichter="${diagnostic.referee || ""}", ` +
        `Zuschauer=${Number.isInteger(diagnostic.attendance) ? diagnostic.attendance : "-"}, ` +
        `gültig=${diagnostic.valid ? "ja" : "nein"}`
      );
      if (diagnostic.validationErrors?.length) {
        console.log(`ÖFB Parser Hinweise: ${diagnostic.validationErrors.join(" | ")}`);
      }
    }

    await statusRef.set(
      {
        success: true,
        running: false,
        runId,
        version: VERSION,
        candidateMatchCount: candidateMatches.length,
        resolvedMatchCount: matches.length,
        reportIndexCount: resolution.indexCount,
        correctedMatchLinks: resolution.correctedCount,
        reportCount: results.filter(
          (result) => result.ok,
        ).length,
        reportWrites,
        newsDraftWrites,
        manualNewsSkips: manualSkips,
        invalidLegacyDrafts,
        invalidLegacyReports,
        failedCount,
        diagnostics,
        durationSeconds: Math.round(
          (Date.now() - startedAt) / 1000,
        ),
        finishedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(
      `Offizielle Berichte gespeichert: ${reportWrites}`,
    );
    console.log(
      `News-Entwürfe erstellt/aktualisiert: ${newsDraftWrites}`,
    );
    console.log(
      `Alte ungültige News-Entwürfe deaktiviert: ${invalidLegacyDrafts}`,
    );
    console.log(
      `Alte ungültige Berichte deaktiviert: ${invalidLegacyReports}`,
    );
    console.log(
      `Nicht akzeptierte Berichte: ${failedCount}`,
    );
  } catch (error) {
    await statusRef
      .set(
        {
          success: false,
          running: false,
          runId,
          version: VERSION,
          error: error.message || String(error),
          durationSeconds: Math.round(
            (Date.now() - startedAt) / 1000,
          ),
          finishedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch(() => {});

    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(
    "Phase-4-Spielbericht-/News-Sync fehlgeschlagen:",
    error,
  );
  process.exitCode = 1;
});
