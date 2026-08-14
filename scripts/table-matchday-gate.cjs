"use strict";
process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");

const TEAM_KEY = String(process.env.TABLE_TEAM || process.argv[2] || "").toUpperCase();
const ALLOWED = new Set(["KM", "CHALLENGE", "U17"]);
if (!ALLOWED.has(TEAM_KEY)) throw new Error(`TABLE_TEAM ungültig: ${TEAM_KEY || "leer"}`);

function output(name, value) {
  const fs = require("fs");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`${name}=${value}`);
}

function viennaDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || process.env.FORCE_TABLE_SYNC === "1") {
    console.log(`${TEAM_KEY}: manueller Lauf -> Tabellen-Sync wird immer ausgeführt.`);
    output("should_run", "true");
    output("reason", "manual");
    return;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
  let credentials;
  try { credentials = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }
  admin.initializeApp({ credential: admin.credential.cert(credentials) });
  const db = admin.firestore();

  const today = viennaDateKey(new Date());
  const snap = await db.collection("oefbV12Matches").where("teamKey", "==", TEAM_KEY).limit(500).get();
  const matches = snap.docs.map((doc) => doc.data()).filter((match) => {
    const kickoff = match.kickoffAt?.toDate?.() || match.kickoffAt;
    const competitionType = String(match.competitionType || "Liga");
    const status = String(match.status || "").toLowerCase();
    return viennaDateKey(kickoff) === today && /liga/i.test(competitionType) && !/(cancel|abgesagt|postponed|verschoben)/i.test(status);
  });

  if (matches.length) {
    console.log(`${TEAM_KEY}: Spieltag ${today} erkannt (${matches.length} Ligaspiel/e) -> Tabelle prüfen.`);
    output("should_run", "true");
    output("reason", "matchday");
  } else {
    console.log(`${TEAM_KEY}: Heute ${today} kein Ligaspiel -> Tabellenabruf wird übersprungen.`);
    output("should_run", "false");
    output("reason", "no-matchday");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
