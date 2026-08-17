"use strict";
process.env.TZ = "Europe/Vienna";

const fs = require("fs");
const admin = require("firebase-admin");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
let credentials;
try { credentials = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }
admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();

const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || /^(1|true|yes)$/i.test(process.env.FORCE_SMART_SYNC || "");
const now = new Date();
const nowMs = now.getTime();

function output(name, value) {
  const text = String(value);
  console.log(`${name}=${text}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${text}\n`);
}

function localParts(date = now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0), minute: Number(parts.minute || 0), weekday: parts.weekday || "",
  };
}

function dateKey(date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ageMinutes(snapshot, fields = ["lastSuccessAt", "finishedAt"]) {
  if (!snapshot || !snapshot.exists) return Number.POSITIVE_INFINITY;
  const data = snapshot.data() || {};
  if (data.success === false) return Number.POSITIVE_INFINITY;
  for (const field of fields) {
    const date = toDate(data[field]);
    if (date) return Math.max(0, (nowMs - date.getTime()) / 60000);
  }
  return Number.POSITIVE_INFINITY;
}

function canonicalTeam(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (/CHALLENGE|RESERVE|^RES$|1B/.test(text)) return "CHALLENGE";
  if (/U17/.test(text)) return "U17";
  if (/KAMPFMANNSCHAFT|^KM$/.test(text)) return "KM";
  return text;
}

function isLeague(match) {
  const text = `${match.competitionType || ""} ${match.competitionName || ""}`;
  return !/(cup|pokal|freundschaft|testspiel|turnier)/i.test(text);
}

function isCancelled(match) {
  return /(cancel|abgesagt|postponed|verschoben)/i.test(String(match.status || ""));
}

async function main() {
  const lp = localParts();
  const statusRefs = {
    core: db.doc("settings/kfvSyncStatus"),
    report: db.doc("settings/kfvReportNewsSyncStatus"),
    club: db.doc("settings/kfvClubSyncStatus"),
    squad: db.doc("settings/kfvSquadSyncStatus"),
    push: db.doc("settings/pushStatus"),
    KM: db.doc("settings/kmTableSyncStatus"),
    CHALLENGE: db.doc("settings/challengeTableSyncStatus"),
    U17: db.doc("settings/u17TableSyncStatus"),
  };
  const refs = Object.values(statusRefs);
  const snaps = await db.getAll(...refs);
  const byPath = new Map(snaps.map((snap) => [snap.ref.path, snap]));
  const status = Object.fromEntries(Object.entries(statusRefs).map(([key, ref]) => [key, byPath.get(ref.path)]));

  const from = admin.firestore.Timestamp.fromDate(new Date(nowMs - 12 * 60 * 60000));
  const until = admin.firestore.Timestamp.fromDate(new Date(nowMs + 7 * 24 * 60 * 60000));
  const matchSnap = await db.collection("oefbV12Matches")
    .where("kickoffAt", ">=", from)
    .where("kickoffAt", "<=", until)
    .get();

  const matches = matchSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data(), kickoffDate: toDate(doc.data().kickoffAt) }))
    .filter((match) => match.active !== false && match.kickoffDate && !isCancelled(match));

  const todayMatches = matches.filter((match) => dateKey(match.kickoffDate) === lp.dateKey && isLeague(match));
  const relevantReports = matches.filter((match) => {
    const deltaMin = (match.kickoffDate.getTime() - nowMs) / 60000;
    return deltaMin <= 7 * 24 * 60 && deltaMin >= -12 * 60;
  });

  // Spielplan: harte Sicherheitsgrenze 8 Stunden; normal etwa viermal pro Tag.
  const coreAge = ageMinutes(status.core, ["finishedAt"]);
  const regularGameHours = new Set([6, 12, 17, 21]);
  const runGames = manual || coreAge > 480 || (regularGameHours.has(lp.hour) && coreAge > 240);

  // Spielberichte/Schiedsrichter/Aufstellungen: weit vor dem Spiel sparsam,
  // ab 2 Stunden vor Anpfiff bis 8 Stunden danach engmaschig.
  const reportAge = ageMinutes(status.report, ["finishedAt"]);
  const nearReportMatch = relevantReports.some((match) => {
    const deltaMin = (match.kickoffDate.getTime() - nowMs) / 60000;
    return deltaMin <= 120 && deltaMin >= -480;
  });
  const reportInterval = nearReportMatch ? 25 : 360;
  const runReports = manual || (relevantReports.length > 0 && reportAge > reportInterval);

  // Tabellen: einmal täglich als Sicherheitsnetz. Am Spieltag häufiger,
  // rund um das Spiel auf Wochenenden bis zu alle 30 Minuten.
  const tableTeams = [];
  for (const team of ["KM", "CHALLENGE", "U17"]) {
    const tableAge = ageMinutes(status[team], ["finishedAt"]);
    const teamMatch = todayMatches.find((match) => canonicalTeam(match.teamKey || match.teamId || match.teamName) === team);
    let due = manual;
    let reason = manual ? "manual" : "";

    if (!due && teamMatch) {
      const deltaMin = (teamMatch.kickoffDate.getTime() - nowMs) / 60000;
      const critical = deltaMin <= 30 && deltaMin >= -240;
      const near = deltaMin <= 120 && deltaMin >= -360;
      const interval = critical ? 25 : near ? 55 : 180;
      if (tableAge > interval) { due = true; reason = critical ? "match-critical" : near ? "match-near" : "matchday"; }
    }

    if (!due && lp.hour >= 6 && tableAge > 1440) { due = true; reason = "daily-safety"; }
    if (due) {
      tableTeams.push(team);
      console.log(`Tabelle ${team}: fällig (${reason || "stale"}, Alter ${Math.round(tableAge)} min).`);
    } else {
      console.log(`Tabelle ${team}: nicht fällig (Alter ${Math.round(tableAge)} min${teamMatch ? ", Spieltag" : ""}).`);
    }
  }

  // Vereinsstammdaten und Kader ändern sich selten: wöchentlich reicht,
  // bei einem Fehler wird im Wartungsfenster automatisch erneut versucht.
  const maintenanceWindow = lp.hour >= 6 && lp.hour <= 9;
  const clubAge = ageMinutes(status.club, ["finishedAt"]);
  const squadAge = ageMinutes(status.squad, ["finishedAt"]);
  const runClubs = manual || (maintenanceWindow && clubAge > 6.5 * 24 * 60);
  const runSquad = manual || (maintenanceWindow && squadAge > 6.5 * 24 * 60);

  // Push-Warteschlange: tagsüber maximal ~1 h, am Wochenende ~30 min Verzögerung.
  const pushAge = ageMinutes(status.push, ["lastSuccessAt", "finishedAt"]);
  const runPush = manual || (lp.hour >= 7 && lp.hour <= 23 && pushAge > 25);

  output("run_games", runGames ? "true" : "false");
  output("run_reports", runReports ? "true" : "false");
  output("table_teams", tableTeams.join(","));
  output("run_clubs", runClubs ? "true" : "false");
  output("run_squad", runSquad ? "true" : "false");
  output("run_push", runPush ? "true" : "false");
  output("matchday", todayMatches.length ? "true" : "false");
  output("relevant_matches", String(relevantReports.length));

  console.log(`Smart-Sync ${lp.dateKey} ${String(lp.hour).padStart(2, "0")}:${String(lp.minute).padStart(2, "0")}: ` +
    `games=${runGames}, reports=${runReports}, tables=${tableTeams.join("/") || "-"}, clubs=${runClubs}, squad=${runSquad}, push=${runPush}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
