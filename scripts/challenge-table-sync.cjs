"use strict";

process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const { parseChallengeRows, validateChallengeTable } = require("./challenge-table-parser.cjs");

const SOURCE_URL = "https://vereine.oefb.at/TsuAinet/Mannschaften/Saison-2026-27/Res/Tabellen";
const STANDING_COLLECTION = "oefbV12Standings";
const TEAM_KEY = "CHALLENGE";
const TEAM_NAME = "Challenge";
const TEAM_ID = "challenge";
const SEASON = "2026-27";
const COMPETITION = "Challenge 1. Klasse West";
const DATASET_VERSION = "challenge-table-v1";

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
    teamKey: row.teamKey,
    teamId: row.teamId,
    teamName: row.teamName,
    competitionName: row.competitionName,
    position: row.position,
    clubName: row.clubName,
    clubId: row.clubId,
    clubUrl: row.clubUrl,
    teamLogoUrl: row.teamLogoUrl,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalDifference,
    points: row.points,
    source: row.source,
    sourceUrl: row.sourceUrl,
    sourceTableUrl: row.sourceTableUrl,
    active: row.active !== false,
    datasetVersion: row.datasetVersion,
  };
}

async function readFreshChallengeTable() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-cache"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Cache-Control": "no-cache, no-store, max-age=0",
      "Pragma": "no-cache",
      "Accept-Language": "de-AT,de;q=0.9,en;q=0.7",
    });
    const client = await page.target().createCDPSession();
    await client.send("Network.enable");
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("ServiceWorker.disable").catch(() => {});

    const freshUrl = `${SOURCE_URL}?challengeSync=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    console.log(`Challenge-Quelle: ${SOURCE_URL}`);
    console.log(`Frischdaten-Aufruf: ${freshUrl}`);
    const response = await page.goto(freshUrl, { waitUntil: "networkidle2", timeout: 60000 });
    if (!response || !response.ok()) throw new Error(`ÖFB Challenge-Seite antwortete mit HTTP ${response?.status() || "unbekannt"}.`);

    await page.waitForFunction(() => {
      const body = document.body?.innerText || "";
      return /1\.\s*Klasse\s*West\s*Reserve/i.test(body) && /\bAinet\b/i.test(body) && document.querySelectorAll("table tr").length >= 10;
    }, { timeout: 30000 });

    // Nur die sichtbare Ligatabelle mit Mannschaft/Sp./Pkt. und Ainet ist zulässig.
    const extraction = await page.evaluate(() => {
      const compact = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 100 && rect.height > 50;
      };
      const candidates = Array.from(document.querySelectorAll("table")).map((table, index) => {
        const header = compact(Array.from(table.querySelectorAll("thead th, thead td, th")).map((cell) => cell.textContent).join(" | "));
        const text = compact(table.innerText);
        const rows = Array.from(table.querySelectorAll("tbody tr, tr")).map((tr) => ({
          cells: Array.from(tr.querySelectorAll(":scope > th, :scope > td")).map((cell) => {
            const link = cell.querySelector("a[href]");
            const img = cell.querySelector("img");
            return {
              text: compact(cell.innerText || cell.textContent),
              href: link ? link.href : "",
              img: img ? (img.currentSrc || img.src || img.getAttribute("data-src") || "") : "",
            };
          }),
        })).filter((row) => row.cells.length >= 2);
        const score =
          (/Mannschaft/i.test(header) ? 5 : 0) +
          (/\bSp\.?\b/i.test(header) ? 3 : 0) +
          (/Pkt\.?/i.test(header) ? 3 : 0) +
          (/\bAinet\b/i.test(text) ? 5 : 0) +
          (/Radenthein|Bad Kleinkirchheim/i.test(text) ? 2 : 0) +
          (isVisible(table) ? 10 : 0) +
          Math.min(rows.length, 20) / 20;
        return { index, header, textPreview: text.slice(0, 500), visible: isVisible(table), score, rows };
      });
      candidates.sort((a, b) => b.score - a.score);
      return { title: document.title, url: location.href, candidates: candidates.slice(0, 5), chosen: candidates[0] || null };
    });

    if (!extraction.chosen || extraction.chosen.score < 15) {
      throw new Error(`Keine eindeutige sichtbare Challenge-Ligatabelle erkannt. Kandidaten=${JSON.stringify(extraction.candidates.map((x) => ({ index: x.index, header: x.header, visible: x.visible, score: x.score })))}`);
    }

    console.log(`Gewählte ÖFB-Tabelle: #${extraction.chosen.index} | sichtbar=${extraction.chosen.visible} | Score=${extraction.chosen.score.toFixed(2)}`);
    console.log(`Header: ${extraction.chosen.header}`);
    const rows = parseChallengeRows(extraction.chosen.rows);
    const validation = validateChallengeTable(rows);
    console.log(`Challenge erkannt: ${rows.length} Vereine | Ainet Platz ${validation.ainet.position} | ${validation.ainet.points} Punkte`);
    for (const row of rows) console.log(`  ${row.position}. ${row.clubName} | ${row.played} Sp. | ${row.won}-${row.drawn}-${row.lost} | ${row.goalsFor}:${row.goalsAgainst} | ${row.points} Pkt.`);
    return rows;
  } finally {
    await browser.close();
  }
}

async function main() {
  const startedAt = admin.firestore.Timestamp.now();
  const runId = `challenge-${startedAt.toMillis()}`;
  const statusRef = db.doc("settings/challengeTableSyncStatus");
  const runRef = db.collection("challengeTableSyncRuns").doc(runId);
  await Promise.all([
    statusRef.set({ running: true, success: null, runId, startedAt, sourceUrl: SOURCE_URL, datasetVersion: DATASET_VERSION }, { merge: true }),
    runRef.set({ running: true, success: null, runId, startedAt, sourceUrl: SOURCE_URL, datasetVersion: DATASET_VERSION }, { merge: false }),
  ]);

  try {
    const parsedRows = await readFreshChallengeTable();
    const existingSnapshots = await Promise.all([
      db.collection(STANDING_COLLECTION).where("teamKey", "==", TEAM_KEY).get(),
      db.collection(STANDING_COLLECTION).where("teamId", "==", TEAM_ID).get(),
    ]);
    const existing = new Map();
    for (const snapshot of existingSnapshots) for (const doc of snapshot.docs) existing.set(doc.id, doc.data());

    const rows = parsedRows.map((row) => {
      const identity = clubIdentity(row.clubName, row.clubUrl);
      const id = makeId(["kfv-standing-v16.2", TEAM_KEY, clubKey(row.clubName) || row.clubName]);
      const previous = existing.get(id) || {};
      return {
        id,
        teamId: TEAM_ID,
        teamKey: TEAM_KEY,
        teamName: TEAM_NAME,
        season: SEASON,
        competitionName: COMPETITION,
        position: row.position,
        clubName: row.clubName,
        clubId: identity.clubId,
        clubUrl: identity.clubUrl,
        teamLogoUrl: cleanUrl(row.teamLogoUrl) || previous.teamLogoUrl || "",
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference,
        points: row.points,
        sourceTableUrl: SOURCE_URL,
        source: "oefb-public",
        sourceUrl: SOURCE_URL,
        active: true,
        datasetVersion: DATASET_VERSION,
        syncAuthority: "challenge-table-v1",
      };
    });

    const writer = db.bulkWriter();
    writer.onWriteError((error) => {
      console.error(`Firestore-Schreibfehler ${error.documentRef?.path}: ${error.message}`);
      return error.failedAttempts < 3;
    });
    let changed = 0;
    let unchanged = 0;
    let created = 0;
    const currentIds = new Set(rows.map((row) => row.id));

    for (const row of rows) {
      const previous = existing.get(row.id);
      const same = previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(row));
      if (same) { unchanged += 1; continue; }
      writer.set(db.collection(STANDING_COLLECTION).doc(row.id), {
        ...row,
        syncRunId: runId,
        sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });
      changed += 1;
      if (!previous) created += 1;
    }

    let deactivated = 0;
    for (const [id, previous] of existing.entries()) {
      const belongsToChallenge = previous?.teamKey === TEAM_KEY || previous?.teamId === TEAM_ID || /^challenge$/i.test(previous?.teamName || "");
      if (!belongsToChallenge || currentIds.has(id) || previous.active === false) continue;
      writer.set(db.collection(STANDING_COLLECTION).doc(id), {
        active: false,
        deactivatedReason: "replaced-by-dedicated-challenge-table-sync",
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncRunId: runId,
      }, { merge: true });
      deactivated += 1;
    }
    await writer.close();

    const ainet = rows.find((row) => /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/i.test(row.clubName));
    const finishedAt = admin.firestore.Timestamp.now();
    const summary = {
      running: false, success: true, runId, startedAt, finishedAt,
      sourceUrl: SOURCE_URL, datasetVersion: DATASET_VERSION,
      rowCount: rows.length, changed, unchanged, created, deactivated,
      ainetPosition: ainet?.position ?? null, ainetPoints: ainet?.points ?? null,
    };
    await Promise.all([statusRef.set(summary, { merge: true }), runRef.set(summary, { merge: true })]);
    console.log("----- CHALLENGE SYNC ERFOLGREICH -----");
    console.log(`Firestore: ${changed} geändert/neu, ${unchanged} unverändert, ${deactivated} alte Challenge-Zeilen deaktiviert.`);
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
