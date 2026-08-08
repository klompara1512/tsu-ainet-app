process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VERSION = "18.3.0-beta.1-reliable-match-info-sync";
const STATUS_DOC = "kfvReportNewsSyncStatus";
const REPORT_COLLECTION = "kfvMatchReports";
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
  Number(process.env.REPORT_POST_KICKOFF_MINUTES || 30),
);
const FORCE_SYNC = /^(?:1|true|yes)$/i.test(process.env.REPORT_FORCE_SYNC || "");
const FORCE_WINDOW_MINUTES = Math.max(60, Number(process.env.REPORT_FORCE_WINDOW_MINUTES || 720));
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

const isAinet = (name) =>
  /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/i.test(compact(name));

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

  if (!pageContainsClub(identityText, match.homeTeam)) {
    reasons.push(`Heimverein "${match.homeTeam}" nicht eindeutig erkannt`);
  }

  if (!pageContainsClub(identityText, match.awayTeam)) {
    reasons.push(`Gastverein "${match.awayTeam}" nicht eindeutig erkannt`);
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
  const preMinutes = FORCE_SYNC ? FORCE_WINDOW_MINUTES : PRE_KICKOFF_MINUTES;
  const postMinutes = FORCE_SYNC ? FORCE_WINDOW_MINUTES : POST_KICKOFF_MINUTES;
  const fromDate = new Date(now - postMinutes * 60000);
  const toDate = new Date(now + preMinutes * 60000);

  const snapshot = await db
    .collection("kfvMatches")
    .where("kickoffAt", ">=", admin.firestore.Timestamp.fromDate(fromDate))
    .where("kickoffAt", "<=", admin.firestore.Timestamp.fromDate(toDate))
    .get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .map((match) => ({
      ...match,
      kickoffDate: asDate(match.kickoffAt),
    }))
    .filter((match) => match.active !== false)
    .filter((match) => {
      const time = match.kickoffDate.getTime();
      return time > 0 && now >= time - preMinutes * 60000 && now <= time + postMinutes * 60000;
    })
    .filter(
      (match) =>
        isAinet(match.homeTeam) || isAinet(match.awayTeam),
    )
    .sort((a, b) => b.kickoffDate - a.kickoffDate);
}

async function keepMatchesNeedingPrematchData(matches) {
  if (FORCE_SYNC || !matches.length) return matches;

  const checked = await mapLimit(matches, 3, async (match) => {
    const snapshot = await db
      .collection(REPORT_COLLECTION)
      .where("matchId", "==", match.id)
      .limit(1)
      .get();

    if (snapshot.empty) return match;

    const report = snapshot.docs[0].data() || {};
    const lineupCount = Number(report.lineupPlayerCount || 0);
    const hasReferee = Boolean(compact(report.referee || match.referee));
    const hasVenue = Boolean(compact(report.venue || match.venue));

    if (lineupCount > 0 && hasReferee && hasVenue) {
      console.log(`Smart-Skip: ${match.homeTeam} - ${match.awayTeam}: Aufstellung, Spielort und Schiedsrichter bereits vorhanden.`);
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

function matchingOverride(match) {
  const date = localDateKey(match.kickoffDate || match.kickoffAt);
  return REPORT_OVERRIDES.find((item) =>
    item.date === date &&
    sameClubName(item.home, match.homeTeam) &&
    sameClubName(item.away, match.awayTeam)
  ) || null;
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
    const override = matchingOverride(match);
    let url = override?.url || "";
    let source = override ? "official-override" : "";
    let score = override ? 999 : 0;

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
    resolved.push(next);

    if (changed) {
      corrected += 1;
      await db.collection("kfvMatches").doc(match.id).set({
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
        const candidates = [
          ...document.querySelectorAll("button,a,[role='tab'],[data-toggle='tab']"),
        ];
        const target = candidates.find((node) => {
          const text = compact(node.textContent).toLowerCase();
          return labels.some((label) => text === label || text.includes(label));
        });
        if (!target) return false;
        target.click();
        await sleep(850);
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
    })
    .catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 1400));
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

        const attendanceText = labelledValue(["Zuschauer", "Besucher"], 40);
        const attendanceMatch = attendanceText.match(/(\d{1,6})/);
        const attendance = attendanceMatch ? Number(attendanceMatch[1]) : null;

        const cleanOfficial = (value) => compact(value)
          .replace(/\s+(?:Spiele seit|Spiele mit|Erstes Spiel|Letztes Spiel).*$/i, "")
          .replace(/\s+(?:Assistent(?:en)?|Zuschauer|Besucher|Spielort|Stadion|Adresse).*$/i, "")
          .trim();

        const referee = cleanOfficial(labelledValue(["Schiedsrichter", "Referee"], 160));
        const assistantText = labelledValue([
          "Schiedsrichter-Assistenten",
          "Schiedsrichterassistenten",
          "Assistenten",
          "Linienrichter",
        ], 220);
        const refereeAssistants = assistantText
          ? assistantText.split(/[,;/]|\s+und\s+/i).map(cleanOfficial).filter(Boolean).slice(0, 4)
          : [];

        const venue = labelledValue(["Spielort", "Stadion", "Sportplatz"], 180);
        const venueAddress = labelledValue(["Adresse", "Anschrift"], 220);

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
          const number = extractNumber(rawText);
          const captain = /kapitän|captain|\(c\)|\bc\b/i.test(rawText);
          const goalkeeper = /torwart|goalkeeper|\btw\b|\bgk\b/i.test(rawText);
          const key = `${side}:${role}:${normalize(name)}:${playerUrl}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const item = { name, number, playerUrl, captain, goalkeeper };
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

        let homeLineup = uniquePlayers(buckets.homeStarter, 30);
        let awayLineup = uniquePlayers(buckets.awayStarter, 30);
        let homeBench = uniquePlayers(buckets.homeBench, 20);
        let awayBench = uniquePlayers(buckets.awayBench, 20);

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
          attendance,
          referee,
          refereeAssistants,
          venue: compact(venue),
          venueAddress: compact(venueAddress),
          homeLineup,
          awayLineup,
          homeBench,
          awayBench,
          events,
          heroImage,
          playerCandidateCount: candidates.length,
          preview: textLines.slice(0, 35).join(" | ").slice(0, 1800),
        };
      },
      {
        expectedHomeTeam: compact(match.homeTeam),
        expectedAwayTeam: compact(match.awayTeam),
      },
    );

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
      homeScore:
        raw.result?.home ??
        (Number.isFinite(match.homeScore)
          ? match.homeScore
          : null),
      awayScore:
        raw.result?.away ??
        (Number.isFinite(match.awayScore)
          ? match.awayScore
          : null),
      kickoffAt:
        match.kickoffAt ||
        admin.firestore.Timestamp.fromDate(
          match.kickoffDate,
        ),
      venue: raw.venue || compact(match.venue),
      venueAddress: raw.venueAddress || compact(match.venueAddress),
      referee: raw.referee || compact(match.referee),
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
            raw.result,
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
        events: report.eventCount,
        hasResult: Boolean(raw.result),
        venue: raw.venue || "",
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

  await ref.set(
    {
      ...old,
      ...report,
      imageUrl:
        report.imageUrl || old.imageUrl || "",
      homeLineup: report.homeLineup.length
        ? report.homeLineup
        : old.homeLineup || [],
      awayLineup: report.awayLineup.length
        ? report.awayLineup
        : old.awayLineup || [],
      homeBench: report.homeBench.length
        ? report.homeBench
        : old.homeBench || [],
      awayBench: report.awayBench.length
        ? report.awayBench
        : old.awayBench || [],
      events: report.events.length
        ? report.events
        : old.events || [],
      active: true,
      lastSeenRunId: runId,
      updatedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function updateMatchFromReport(report) {
  if (!report.matchId) return;
  const ref = db.collection("kfvMatches").doc(report.matchId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;

  const patch = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reportUrl: report.reportUrl || "",
    gameId: report.gameId || "",
    oefbMatchId: report.oefbMatchId || "",
  };

  if (report.venue) patch.venue = report.venue;
  if (report.venueAddress) patch.venueAddress = report.venueAddress;
  if (report.referee) patch.referee = report.referee;
  if (Array.isArray(report.homeLineup) && report.homeLineup.length) patch.homeLineup = report.homeLineup;
  if (Array.isArray(report.awayLineup) && report.awayLineup.length) patch.awayLineup = report.awayLineup;
  if (Array.isArray(report.homeBench) && report.homeBench.length) patch.homeBench = report.homeBench;
  if (Array.isArray(report.awayBench) && report.awayBench.length) patch.awayBench = report.awayBench;
  if (Array.isArray(report.refereeAssistants) && report.refereeAssistants.length) patch.refereeAssistants = report.refereeAssistants;
  if (Number.isInteger(report.attendance)) patch.attendance = report.attendance;

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
    candidateMatches = await keepMatchesNeedingPrematchData(candidateMatches);

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
