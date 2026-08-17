"use strict";
process.env.TZ = "Europe/Vienna";
const { spawnSync } = require("child_process");
const admin = require("firebase-admin");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
let credentials;
try { credentials = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }
admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();

const truthy = (value) => /^(1|true|yes)$/i.test(String(value || ""));
const selectedTables = String(process.env.TABLE_TEAMS || "").split(",").map((v) => v.trim()).filter(Boolean);
const tasks = [];

function runNode(label, args, attempts = 2, extraEnv = {}) {
  let lastStatus = 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`\n===== ${label} · Versuch ${attempt}/${attempts} =====`);
    const started = Date.now();
    const result = spawnSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
    const durationMs = Date.now() - started;
    lastStatus = result.status ?? 1;
    if (lastStatus === 0) {
      tasks.push({ label, success: true, attempt, durationMs });
      return true;
    }
    console.error(`${label} fehlgeschlagen (Exit ${lastStatus}).`);
    if (attempt < attempts) {
      const waitMs = 20_000 * attempt;
      console.log(`Retry in ${Math.round(waitMs / 1000)} Sekunden …`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
  tasks.push({ label, success: false, attempts, exitCode: lastStatus });
  return false;
}

async function main() {
  let dataChangedPossible = false;
  let failed = false;

  if (truthy(process.env.RUN_GAMES)) {
    dataChangedPossible = true;
    if (!runNode("Spielplan", ["scripts/kfv-games-sync.cjs"])) failed = true;
  }

  if (selectedTables.length) {
    dataChangedPossible = true;
    if (!runNode(`Tabellen ${selectedTables.join("/")}`, ["scripts/sync-exact-tables.cjs"], 2, { TABLE_TEAMS: selectedTables.join(",") })) failed = true;
  }

  if (truthy(process.env.RUN_REPORTS)) {
    dataChangedPossible = true;
    if (!runNode("Spielberichte / Schiedsrichter / Aufstellungen", ["scripts/kfv-report-news-sync.cjs"])) failed = true;
  }

  if (truthy(process.env.RUN_CLUBS)) {
    if (!runNode("Vereinsdaten / Logos", ["scripts/kfv-club-sync.cjs"])) failed = true;
  }

  if (truthy(process.env.RUN_SQUAD)) {
    if (!runNode("Kader", ["scripts/kfv-squad-sync.cjs"])) failed = true;
  }

  if (truthy(process.env.RUN_PUSH)) {
    if (!runNode("Push-Warteschlange", ["scripts/send-push.cjs"])) failed = true;
  }

  if (dataChangedPossible) {
    if (!runNode("Öffentlichen Fan-Snapshot veröffentlichen", ["scripts/publish-public-snapshot.cjs"])) failed = true;
  }

  const summary = {
    success: !failed,
    finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    githubRunId: String(process.env.GITHUB_RUN_ID || ""),
    githubRunNumber: Number(process.env.GITHUB_RUN_NUMBER || 0),
    trigger: String(process.env.GITHUB_EVENT_NAME || "schedule"),
    selected: {
      games: truthy(process.env.RUN_GAMES), reports: truthy(process.env.RUN_REPORTS),
      tables: selectedTables, clubs: truthy(process.env.RUN_CLUBS), squad: truthy(process.env.RUN_SQUAD), push: truthy(process.env.RUN_PUSH),
    },
    tasks,
  };
  await db.doc("settings/smartSyncStatus").set(summary, { merge: true });
  console.log("\nSmart-Sync Zusammenfassung:", JSON.stringify({ ...summary, finishedAt: "serverTimestamp" }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  try {
    await db.doc("settings/smartSyncStatus").set({ success: false, finishedAt: admin.firestore.FieldValue.serverTimestamp(), lastError: String(error?.stack || error) }, { merge: true });
  } catch {}
  process.exitCode = 1;
});
