process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
const crypto = require("crypto");

const VERSION = "14.3.0-phase4-report-news-sync";
const STATUS_DOC = "kfvReportNewsSyncStatus";
const REPORT_COLLECTION = "kfvMatchReports";
const NEWS_COLLECTION = "news";
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.REPORT_SYNC_CONCURRENCY || 2)));
const NAVIGATION_TIMEOUT = Math.max(20000, Number(process.env.REPORT_NAVIGATION_TIMEOUT || 45000));
const LOOKBACK_DAYS = Math.max(1, Number(process.env.REPORT_LOOKBACK_DAYS || 45));
const LOOKAHEAD_DAYS = Math.max(0, Number(process.env.REPORT_LOOKAHEAD_DAYS || 7));

const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
let credentials;
try { credentials = JSON.parse(rawCredentials); }
catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const sha = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 24);
const absoluteUrl = (value, base) => { try { return value ? new URL(value, base).href : ""; } catch { return ""; } };
const isAinet = (name) => /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/i.test(compact(name));

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
  return Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore)
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
  const gameId = compact(match.gameId || match.oefbMatchId);
  return gameId ? `report_oefb_${gameId}` : `report_${sha(match.id || match.reportUrl)}`;
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
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return results;
}

async function loadCandidateMatches() {
  const snapshot = await db.collection("kfvMatches").get();
  const now = Date.now();
  const from = now - LOOKBACK_DAYS * 86400000;
  const to = now + LOOKAHEAD_DAYS * 86400000;
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .map((match) => ({ ...match, kickoffDate: asDate(match.kickoffAt) }))
    .filter((match) => match.active !== false)
    .filter((match) => match.reportUrl && /^https?:\/\//i.test(match.reportUrl))
    .filter((match) => {
      const time = match.kickoffDate.getTime();
      return time > 0 && time >= from && time <= to;
    })
    .filter((match) => isAinet(match.homeTeam) || isAinet(match.awayTeam))
    .sort((a, b) => b.kickoffDate - a.kickoffDate);
}

async function waitForReport(page) {
  await page.waitForFunction(() => document.body && document.body.innerText.length > 250, { timeout: 12000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const label of ["Spielbericht", "Aufstellung", "Tore", "Karten", "Wechsel", "Statistik"]) {
      const candidates = [...document.querySelectorAll("button,a,[role='tab']")];
      const target = candidates.find((node) => String(node.textContent || "").trim().toLowerCase() === label.toLowerCase());
      if (target) { target.click(); await sleep(250); }
    }
    const max = Math.min(document.body?.scrollHeight || 0, 8000);
    for (let y = 0; y <= max; y += 650) { window.scrollTo(0, y); await sleep(80); }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 900));
}

async function extractReport(browser, match) {
  const page = await browser.newPage();
  const started = Date.now();
  try {
    await page.setViewport({ width: 1365, height: 1500 });
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "de-AT,de;q=0.9,en;q=0.7" });
    await page.goto(match.reportUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
    await waitForReport(page);

    const raw = await page.evaluate(() => {
      const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const absolute = (value) => { try { return value ? new URL(value, location.href).href : ""; } catch { return ""; } };
      const bodyText = compact(document.body?.innerText || "");
      const textLines = String(document.body?.innerText || "").split(/\n+/).map(compact).filter(Boolean);
      const result = bodyText.match(/\b(\d{1,2})\s*:\s*(\d{1,2})\b/);
      const attendance = bodyText.match(/(?:Zuschauer|Besucher)\s*:?\s*(\d{1,6})/i);
      const referee = bodyText.match(/(?:Schiedsrichter|Referee)\s*:?\s*([^|]{3,80}?)(?=\s+(?:Assistent|Zuschauer|Spielort|$))/i);
      const venue = bodyText.match(/(?:Spielort|Sportplatz|Stadion)\s*:?\s*([^|]{3,100}?)(?=\s+(?:Schiedsrichter|Zuschauer|$))/i);

      const playerName = (value) => {
        const text = compact(value)
          .replace(/^\d{1,3}[.'’]?\s*/, "")
          .replace(/\s*\([^)]*\)\s*$/, "")
          .replace(/\s+(?:GK|TW|Kapitän|Captain)\s*$/i, "")
          .trim();
        if (text.length < 3 || text.length > 70) return "";
        if (!/^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]+$/.test(text)) return "";
        if (/^(?:Aufstellung|Ersatzbank|Trainer|Betreuer|Tore|Karten|Wechsel|Spieler|Heim|Gast)$/i.test(text)) return "";
        return text;
      };

      const extractSection = (headingPattern) => {
        const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,strong,[role='heading']")];
        const heading = headings.find((node) => headingPattern.test(compact(node.textContent)));
        if (!heading) return [];
        const container = heading.closest("section,article,[class*='lineup'],[class*='formation'],[class*='squad'],[class*='team']") || heading.parentElement;
        if (!container) return [];
        const names = [];
        const seen = new Set();
        container.querySelectorAll("a[href],li,tr,[class*='player'],[class*='spieler'],span,strong").forEach((node) => {
          const name = playerName(node.textContent);
          if (!name) return;
          const key = name.toLowerCase();
          if (!seen.has(key)) { seen.add(key); names.push({ name, playerUrl: node.closest("a[href]") ? absolute(node.closest("a[href]").href) : "" }); }
        });
        return names.slice(0, 30);
      };

      const events = [];
      const seenEvents = new Set();
      const eventPattern = /(\d{1,3})[.'’]\s*(.*?)(?=(?:\d{1,3}[.'’])|$)/g;
      let eventMatch;
      while ((eventMatch = eventPattern.exec(bodyText))) {
        const minute = Number(eventMatch[1]);
        const description = compact(eventMatch[2]).slice(0, 220);
        if (!description || minute > 130 || !/(tor|wechsel|gelb|rot|karte|elfmeter|eigentor)/i.test(description)) continue;
        const type = /rot/i.test(description) ? "red-card" : /gelb/i.test(description) ? "yellow-card" : /wechsel/i.test(description) ? "substitution" : /tor|elfmeter|eigentor/i.test(description) ? "goal" : "event";
        const key = `${minute}:${type}:${description}`;
        if (!seenEvents.has(key)) { seenEvents.add(key); events.push({ minute, type, description }); }
      }

      const images = [...document.images].map((img) => absolute(img.currentSrc || img.src || img.dataset?.src)).filter(Boolean);
      const heroImage = images.find((url) => !/logo|icon|avatar|placeholder/i.test(url)) || "";

      return {
        title: compact(document.title),
        heading: compact(document.querySelector("h1")?.textContent || ""),
        bodyLength: bodyText.length,
        result: result ? { home: Number(result[1]), away: Number(result[2]) } : null,
        attendance: attendance ? Number(attendance[1]) : null,
        referee: compact(referee?.[1]),
        venue: compact(venue?.[1]),
        homeLineup: extractSection(/^(?:Heim.*)?Aufstellung|Startelf.*Heim/i),
        awayLineup: extractSection(/^(?:Gast.*)?Aufstellung|Startelf.*Gast/i),
        events,
        heroImage,
        preview: textLines.slice(0, 30).join(" | ").slice(0, 1500),
      };
    });

    const report = {
      id: reportIdFor(match),
      matchId: match.id,
      matchUid: compact(match.matchUid || match.id),
      gameId: compact(match.gameId || match.oefbMatchId),
      oefbMatchId: compact(match.gameId || match.oefbMatchId),
      teamId: compact(match.teamId),
      teamName: compact(match.teamName),
      competitionName: compact(match.competitionName),
      homeTeam: compact(match.homeTeam),
      awayTeam: compact(match.awayTeam),
      homeScore: raw.result?.home ?? (Number.isFinite(match.homeScore) ? match.homeScore : null),
      awayScore: raw.result?.away ?? (Number.isFinite(match.awayScore) ? match.awayScore : null),
      kickoffAt: match.kickoffAt || admin.firestore.Timestamp.fromDate(match.kickoffDate),
      venue: raw.venue || compact(match.venue),
      referee: raw.referee,
      attendance: raw.attendance,
      homeLineup: raw.homeLineup,
      awayLineup: raw.awayLineup,
      events: raw.events,
      eventCount: raw.events.length,
      lineupPlayerCount: raw.homeLineup.length + raw.awayLineup.length,
      reportUrl: absoluteUrl(match.reportUrl, match.reportUrl),
      imageUrl: raw.heroImage,
      published: Boolean(raw.events.length || raw.homeLineup.length || raw.awayLineup.length || raw.result),
      active: true,
      source: "oefb-official-report",
      sourceUrl: absoluteUrl(match.reportUrl, match.reportUrl),
      parserVersion: VERSION,
      sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    return {
      ok: report.published,
      match,
      report,
      diagnostic: {
        matchId: match.id,
        reportUrl: match.reportUrl,
        title: raw.title,
        heading: raw.heading,
        bodyLength: raw.bodyLength,
        lineupPlayers: report.lineupPlayerCount,
        events: report.eventCount,
        hasResult: Boolean(raw.result),
        durationSeconds: Math.round((Date.now() - started) / 1000),
        error: report.published ? "" : "Keine veröffentlichten Berichtsdaten erkannt",
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
        durationSeconds: Math.round((Date.now() - started) / 1000),
        error: error.message || String(error),
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function upsertReport(report, runId) {
  const ref = db.collection(REPORT_COLLECTION).doc(report.id);
  const existing = await ref.get();
  const old = existing.exists ? existing.data() : {};
  await ref.set({
    ...old,
    ...report,
    imageUrl: report.imageUrl || old.imageUrl || "",
    homeLineup: report.homeLineup.length ? report.homeLineup : (old.homeLineup || []),
    awayLineup: report.awayLineup.length ? report.awayLineup : (old.awayLineup || []),
    events: report.events.length ? report.events : (old.events || []),
    active: true,
    lastSeenRunId: runId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function createNewsDraft(report, match, runId) {
  if (!report.published) return { written: false, reason: "report-empty" };
  const id = `auto_match_${sha(match.id || report.reportUrl)}`;
  const ref = db.collection(NEWS_COLLECTION).doc(id);
  const existing = await ref.get();
  const old = existing.exists ? existing.data() : {};
  if (old.manualOverride === true || old.source === "manual") return { written: false, reason: "manual-override" };

  const score = Number.isFinite(report.homeScore) && Number.isFinite(report.awayScore)
    ? `${report.homeScore}:${report.awayScore}` : "";
  const title = score ? `${report.homeTeam} ${score} ${report.awayTeam}` : resultTitle(match);
  const eventSummary = report.events.slice(0, 6).map((event) => `${event.minute}. Minute: ${event.description}`).join("\n");
  const lineupSummary = report.lineupPlayerCount
    ? `Im offiziellen Spielbericht sind ${report.lineupPlayerCount} Spieler in den Aufstellungen erfasst.`
    : "";
  const summary = score
    ? `Offizieller Spielbericht zum ${score} zwischen ${report.homeTeam} und ${report.awayTeam}.`
    : `Offizieller Spielbericht zu ${report.homeTeam} gegen ${report.awayTeam}.`;
  const content = [
    summary,
    report.venue ? `Spielort: ${report.venue}` : "",
    report.referee ? `Schiedsrichter: ${report.referee}` : "",
    Number.isFinite(report.attendance) ? `Zuschauer: ${report.attendance}` : "",
    lineupSummary,
    eventSummary,
    `Offizieller Bericht: ${report.reportUrl}`,
  ].filter(Boolean).join("\n\n");

  await ref.set({
    title,
    summary,
    content,
    category: categoryForTeam(match.teamId, match.teamName),
    imageUrl: report.imageUrl || old.imageUrl || "",
    authorName: "TSU Ainet Official Sync",
    published: old.published === true,
    featured: old.featured === true,
    publishedAt: match.kickoffAt || admin.firestore.Timestamp.fromDate(match.kickoffDate),
    source: "oefb-auto-draft",
    sourceMatchId: match.id,
    sourceReportId: report.id,
    sourceUrl: report.reportUrl,
    autoGenerated: true,
    manualOverride: false,
    active: true,
    lastSeenRunId: runId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: old.createdAt || admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { written: true, reason: existing.exists ? "updated" : "created" };
}

async function main() {
  const runId = `report-news-${Date.now()}`;
  const startedAt = Date.now();
  const statusRef = db.collection("settings").doc(STATUS_DOC);
  await statusRef.set({
    success: false,
    running: true,
    runId,
    version: VERSION,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  let browser;
  try {
    const matches = await loadCandidateMatches();
    console.log(`Phase 4: ${matches.length} Spiele mit Bericht-Link im Zeitfenster.`);
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const results = await mapLimit(matches, CONCURRENCY, (match) => extractReport(browser, match));

    let reportWrites = 0;
    let newsDraftWrites = 0;
    let manualSkips = 0;
    for (const result of results) {
      if (!result.ok || !result.report) continue;
      await upsertReport(result.report, runId);
      reportWrites += 1;
      const draft = await createNewsDraft(result.report, result.match, runId);
      if (draft.written) newsDraftWrites += 1;
      if (draft.reason === "manual-override") manualSkips += 1;
    }

    const diagnostics = results.map((result) => result.diagnostic);
    const failedCount = results.filter((result) => !result.ok).length;
    await statusRef.set({
      success: true,
      running: false,
      runId,
      version: VERSION,
      candidateMatchCount: matches.length,
      reportCount: results.filter((result) => result.ok).length,
      reportWrites,
      newsDraftWrites,
      manualNewsSkips: manualSkips,
      failedCount,
      diagnostics,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`Offizielle Berichte gespeichert: ${reportWrites}`);
    console.log(`News-Entwürfe erstellt/aktualisiert: ${newsDraftWrites}`);
    console.log(`Nicht erkannte Berichte: ${failedCount}`);
  } catch (error) {
    await statusRef.set({
      success: false,
      running: false,
      runId,
      version: VERSION,
      error: error.message || String(error),
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("Phase-4-Spielbericht-/News-Sync fehlgeschlagen:", error);
  process.exitCode = 1;
});
