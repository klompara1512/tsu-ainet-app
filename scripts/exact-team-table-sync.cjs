"use strict";
process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const { parseExactTableRows, validateExactTable } = require("./exact-team-table-parser.cjs");

const CONFIGS = {
  KM: {
    key: "KM", teamId: "km", teamName: "Kampfmannschaft", slug: "KM",
    competitionName: "1. Klasse West", minRows: 8, maxRows: 20,
  },
  U17: {
    key: "U17", teamId: "u17", teamName: "U17", slug: "U17",
    competitionName: "U17", minRows: 5, maxRows: 20,
  },
  U12: {
    key: "U12", teamId: "u12", teamName: "U12", slug: "U12",
    competitionName: "U12", minRows: 4, maxRows: 20,
  },
  U10: {
    key: "U10", teamId: "u10", teamName: "U10", slug: "U10",
    competitionName: "U10", minRows: 4, maxRows: 20,
  },
};

const requestedKey = String(process.env.TABLE_TEAM || process.argv[2] || "").toUpperCase();
const TEAM = CONFIGS[requestedKey];
if (!TEAM) throw new Error(`TABLE_TEAM ungültig: ${requestedKey || "leer"}. Erlaubt: ${Object.keys(CONFIGS).join(", ")}`);

const SOURCE_URL = `https://vereine.oefb.at/TsuAinet/Mannschaften/Saison-2026-27/${TEAM.slug}/Tabellen`;
const STANDING_COLLECTION = "oefbV12Standings";
const SEASON = "2026-27";
const DATASET_VERSION = `exact-${TEAM.key.toLowerCase()}-table-v1`;
const AUTHORITY = `exact-${TEAM.key.toLowerCase()}-table-v1`;

const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
let credentials;
try { credentials = JSON.parse(rawCredentials); }
catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }
admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const compact = (value) => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const lower = (value) => compact(value).toLocaleLowerCase("de-AT");
const slug = (value) => lower(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clubKey = (value) => lower(value)
  .replace(/\b(?:tsu|sg|spg|sv|fc|sc|usv|askö|asko|union|atv|osk|sk|liga)\b/g, " ")
  .replace(/\b(?:1b|ii|reserve|challenge|kampfmannschaft|km)\b/g, " ")
  .replace(/[^a-z0-9äöüß]+/g, " ").replace(/\s+/g, " ").trim();
const makeId = (parts) => crypto.createHash("sha256").update(parts.map(compact).join("|")).digest("hex").slice(0, 32);

function cleanUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, SOURCE_URL);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function clubIdentity(clubName, clubUrl) {
  const url = cleanUrl(clubUrl);
  if (url) {
    try {
      const parsed = new URL(url);
      if (/vereine\.oefb\.at$/i.test(parsed.hostname)) {
        const first = decodeURIComponent(parsed.pathname).split("/").filter(Boolean)[0] || "";
        if (first) return { clubId: `oefb:${slug(first)}`, clubUrl: url };
      }
    } catch { /* fallback */ }
  }
  return { clubId: `name:${clubKey(clubName) || slug(clubName)}`, clubUrl: url };
}

function comparable(row) {
  return {
    teamKey: row.teamKey, teamId: row.teamId, teamName: row.teamName,
    competitionName: row.competitionName, position: row.position,
    clubName: row.clubName, clubId: row.clubId, clubUrl: row.clubUrl,
    teamLogoUrl: row.teamLogoUrl, played: row.played, won: row.won,
    drawn: row.drawn, lost: row.lost, goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst, goalDifference: row.goalDifference,
    points: row.points, source: row.source, sourceUrl: row.sourceUrl,
    sourceTableUrl: row.sourceTableUrl, active: row.active !== false,
    datasetVersion: row.datasetVersion, syncAuthority: row.syncAuthority,
  };
}

async function readFreshTable() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-cache"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Cache-Control": "no-cache, no-store, max-age=0", "Pragma": "no-cache",
      "Accept-Language": "de-AT,de;q=0.9,en;q=0.7",
    });
    const client = await page.target().createCDPSession();
    await client.send("Network.enable");
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("ServiceWorker.disable").catch(() => {});

    const freshUrl = `${SOURCE_URL}?exactTableSync=${TEAM.key}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    console.log(`${TEAM.key}-Quelle: ${SOURCE_URL}`);
    console.log(`Frischdaten-Aufruf: ${freshUrl}`);
    const response = await page.goto(freshUrl, { waitUntil: "networkidle2", timeout: 60000 });
    if (!response || !response.ok()) throw new Error(`ÖFB ${TEAM.key}-Seite antwortete mit HTTP ${response?.status() || "unbekannt"}.`);

    await page.waitForFunction(() => /\bAinet\b/i.test(document.body?.innerText || ""), { timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const extraction = await page.evaluate(() => {
      const compact = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 100 && rect.height > 50;
      };
      const tables = Array.from(document.querySelectorAll("table"));
      const candidates = tables.map((table, index) => {
        const headerCells = Array.from(table.querySelectorAll("thead th, thead td, th")).map((cell) => compact(cell.textContent));
        const header = headerCells.join(" | ");
        const text = compact(table.innerText);
        const rows = Array.from(table.querySelectorAll("tbody tr, tr")).map((tr) => ({
          cells: Array.from(tr.querySelectorAll(":scope > th, :scope > td")).map((cell) => {
            const link = cell.querySelector("a[href]");
            const img = cell.querySelector("img");
            return { text: compact(cell.innerText || cell.textContent), href: link ? link.href : "", img: img ? (img.currentSrc || img.src || img.getAttribute("data-src") || "") : "" };
          }),
        })).filter((row) => row.cells.length >= 2);
        const hasRank = headerCells.some((cell) => /^(?:#|platz|rang)$/i.test(cell));
        const score =
          (hasRank ? 4 : 0) + (/Mannschaft|Verein/i.test(header) ? 5 : 0) +
          (/\bSp\.?\b/i.test(header) ? 3 : 0) + (/Pkt\.?/i.test(header) ? 3 : 0) +
          (/\bAinet\b/i.test(text) ? 8 : 0) + (isVisible(table) ? 10 : 0) + Math.min(rows.length, 24) / 24;
        return { index, header, textPreview: text.slice(0, 700), visible: isVisible(table), score, rows };
      });
      candidates.sort((a, b) => b.score - a.score);
      return { title: document.title, url: location.href, tableCount: tables.length, candidates: candidates.slice(0, 8) };
    });

    let best = null;
    let bestRows = [];
    let bestValidation = null;
    const diagnostics = [];
    for (const candidate of extraction.candidates) {
      const rows = parseExactTableRows(candidate.rows);
      let validation = null;
      let error = "";
      try { validation = validateExactTable(rows, { teamKey: TEAM.key, minRows: TEAM.minRows, maxRows: TEAM.maxRows }); }
      catch (caught) { error = String(caught?.message || caught); }
      diagnostics.push({ index: candidate.index, score: candidate.score, header: candidate.header, parsedRows: rows.length, ainet: validation?.ainet?.position || null, error });
      if (validation && (!best || candidate.score > best.score)) { best = candidate; bestRows = rows; bestValidation = validation; }
    }
    console.log(`${TEAM.key}-DOM: ${extraction.tableCount} Tabellen. Kandidaten=${JSON.stringify(diagnostics)}`);
    if (!best || !bestValidation) throw new Error(`Keine vollständige, eindeutige ${TEAM.key}-Tabelle mit Ainet gefunden. Es wird NICHTS nach Firestore geschrieben.`);

    console.log(`Gewählte ${TEAM.key}-Tabelle: #${best.index} | sichtbar=${best.visible} | Score=${best.score.toFixed(2)}`);
    console.log(`Header: ${best.header}`);
    console.log(`${TEAM.key} erkannt: ${bestRows.length} Vereine | Ainet Platz ${bestValidation.ainet.position} | ${bestValidation.ainet.points} Punkte`);
    for (const row of bestRows) console.log(`  ${row.position}. ${row.clubName} | ${row.played} Sp. | ${row.won}-${row.drawn}-${row.lost} | ${row.goalsFor}:${row.goalsAgainst} | ${row.points} Pkt.`);
    return bestRows;
  } finally { await browser.close(); }
}

async function main() {
  const startedAt = admin.firestore.Timestamp.now();
  const runId = `${TEAM.key.toLowerCase()}-${startedAt.toMillis()}`;
  const statusRef = db.doc(`settings/${TEAM.teamId}TableSyncStatus`);
  const runRef = db.collection("exactTableSyncRuns").doc(runId);
  await Promise.all([
    statusRef.set({ running: true, success: null, runId, startedAt, teamKey: TEAM.key, sourceUrl: SOURCE_URL, datasetVersion: DATASET_VERSION }, { merge: true }),
    runRef.set({ running: true, success: null, runId, startedAt, teamKey: TEAM.key, sourceUrl: SOURCE_URL, datasetVersion: DATASET_VERSION }, { merge: false }),
  ]);

  try {
    const parsedRows = await readFreshTable();
    const snapshots = await Promise.all([
      db.collection(STANDING_COLLECTION).where("teamKey", "==", TEAM.key).get(),
      db.collection(STANDING_COLLECTION).where("teamId", "==", TEAM.teamId).get(),
    ]);
    const existing = new Map();
    for (const snapshot of snapshots) for (const doc of snapshot.docs) existing.set(doc.id, doc.data());

    const rows = parsedRows.map((row) => {
      const identity = clubIdentity(row.clubName, row.clubUrl);
      const id = makeId(["kfv-standing-v16.2", TEAM.key, clubKey(row.clubName) || row.clubName]);
      const previous = existing.get(id) || {};
      return {
        id, teamId: TEAM.teamId, teamKey: TEAM.key, teamName: TEAM.teamName,
        season: SEASON, competitionName: TEAM.competitionName, position: row.position,
        clubName: row.clubName, clubId: identity.clubId, clubUrl: identity.clubUrl,
        teamLogoUrl: cleanUrl(row.teamLogoUrl) || previous.teamLogoUrl || "",
        played: row.played, won: row.won, drawn: row.drawn, lost: row.lost,
        goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst, goalDifference: row.goalDifference,
        points: row.points, sourceTableUrl: SOURCE_URL, source: "oefb-public", sourceUrl: SOURCE_URL,
        active: true, datasetVersion: DATASET_VERSION, syncAuthority: AUTHORITY,
      };
    });

    const writer = db.bulkWriter();
    writer.onWriteError((error) => { console.error(`Firestore-Schreibfehler ${error.documentRef?.path}: ${error.message}`); return error.failedAttempts < 3; });
    let changed = 0, unchanged = 0, created = 0, deactivated = 0;
    const currentIds = new Set(rows.map((row) => row.id));
    for (const row of rows) {
      const previous = existing.get(row.id);
      const same = previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(row));
      if (same) { unchanged += 1; continue; }
      writer.set(db.collection(STANDING_COLLECTION).doc(row.id), {
        ...row, syncRunId: runId,
        sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });
      changed += 1; if (!previous) created += 1;
    }
    for (const [id, previous] of existing.entries()) {
      const belongs = previous?.teamKey === TEAM.key || previous?.teamId === TEAM.teamId;
      if (!belongs || currentIds.has(id) || previous.active === false) continue;
      writer.set(db.collection(STANDING_COLLECTION).doc(id), {
        active: false, deactivatedReason: `replaced-by-${AUTHORITY}`,
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(), syncRunId: runId,
      }, { merge: true });
      deactivated += 1;
    }
    await writer.close();

    const ainet = rows.find((row) => /\bainet\b/i.test(row.clubName));
    const finishedAt = admin.firestore.Timestamp.now();
    const summary = { running: false, success: true, runId, startedAt, finishedAt, teamKey: TEAM.key, sourceUrl: SOURCE_URL, datasetVersion: DATASET_VERSION, rowCount: rows.length, changed, unchanged, created, deactivated, ainetPosition: ainet?.position ?? null, ainetPoints: ainet?.points ?? null };
    await Promise.all([statusRef.set(summary, { merge: true }), runRef.set(summary, { merge: true })]);
    console.log(`----- ${TEAM.key} SYNC ERFOLGREICH -----`);
    console.log(`Firestore: ${changed} geändert/neu, ${unchanged} unverändert, ${deactivated} alte ${TEAM.key}-Zeilen deaktiviert.`);
    console.log(`Ainet: Platz ${ainet?.position ?? "?"} | ${ainet?.points ?? "?"} Punkte`);
  } catch (error) {
    const finishedAt = admin.firestore.Timestamp.now();
    const message = String(error?.stack || error?.message || error);
    await Promise.all([
      statusRef.set({ running: false, success: false, runId, finishedAt, lastError: message }, { merge: true }),
      runRef.set({ running: false, success: false, runId, finishedAt, lastError: message }, { merge: true }),
    ]);
    console.error(message);
    process.exitCode = 1;
  }
}
main();
