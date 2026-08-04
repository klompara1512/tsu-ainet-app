process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const crypto = require("crypto");

const VERSION = "16.0.0-home-game-task-sync";
const LOOKAHEAD_DAYS = Math.max(30, Number(process.env.HOME_GAME_LOOKAHEAD_DAYS || 180));
const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");

let credentials;
try { credentials = JSON.parse(rawCredentials); }
catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const normalize = (value) => compact(value).toLocaleLowerCase("de-AT")
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const isAinet = (value) => /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/.test(normalize(value));
const sha = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 20);

function asDate(value) {
  if (value && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function teamKey(match) {
  const value = `${match.teamId || ""} ${match.teamName || ""}`.toLowerCase();
  if (/challenge|reserve|\bres\b/.test(value)) return "CHALLENGE";
  if (/u\s*17/.test(value)) return "U17";
  if (/u\s*12/.test(value)) return "U12";
  if (/u\s*10/.test(value)) return "U10";
  if (/u\s*0?8/.test(value)) return "U08";
  return "KM";
}

const BASE_TASKS = [
  { key: "platzaufbau", title: "Platzaufbau und Tore kontrollieren", offsetMinutes: -180, priority: "high", category: "Sportplatz" },
  { key: "linien", title: "Linien und Spielfeld kontrollieren", offsetMinutes: -180, priority: "high", category: "Sportplatz" },
  { key: "kabinen", title: "Kabinen und Schiedsrichterraum vorbereiten", offsetMinutes: -120, priority: "high", category: "Organisation" },
  { key: "matchball", title: "Matchball und Ersatzbälle bereitstellen", offsetMinutes: -75, priority: "high", category: "Spielbetrieb" },
  { key: "schiedsrichter", title: "Schiedsrichter empfangen und betreuen", offsetMinutes: -60, priority: "high", category: "Spielbetrieb" },
  { key: "ergebnisdienst", title: "Ergebnisdienst und Spielbericht kontrollieren", offsetMinutes: 120, priority: "medium", category: "Nachbereitung" },
  { key: "reinigung", title: "Kabinen und Anlage nach dem Spiel kontrollieren", offsetMinutes: 150, priority: "medium", category: "Nachbereitung" },
];

const KM_EXTRA = [
  { key: "kantine", title: "Kantine öffnen und vorbereiten", offsetMinutes: -180, priority: "high", category: "Kantine" },
  { key: "getraenke", title: "Getränke und Kühlung auffüllen", offsetMinutes: -180, priority: "high", category: "Kantine" },
  { key: "grill", title: "Grill und Küche vorbereiten", offsetMinutes: -150, priority: "high", category: "Kantine" },
  { key: "kassa", title: "Kassa und Eintritt vorbereiten", offsetMinutes: -90, priority: "high", category: "Organisation" },
  { key: "ordner", title: "Ordnerdienst einteilen und einweisen", offsetMinutes: -75, priority: "high", category: "Organisation" },
  { key: "sprecher", title: "Stadionsprecher und Musik vorbereiten", offsetMinutes: -60, priority: "medium", category: "Organisation" },
];

const CHALLENGE_EXTRA = [
  { key: "kantine-klein", title: "Kleinen Kantinenbetrieb vorbereiten", offsetMinutes: -120, priority: "medium", category: "Kantine" },
  { key: "getraenke-klein", title: "Getränke für Mannschaften und Zuschauer bereitstellen", offsetMinutes: -90, priority: "medium", category: "Kantine" },
];

const YOUTH_EXTRA = [
  { key: "betreuung", title: "Mannschaftsbetreuung und Treffpunkt organisieren", offsetMinutes: -90, priority: "high", category: "Nachwuchs" },
  { key: "getraenke-jugend", title: "Getränke für beide Mannschaften bereitstellen", offsetMinutes: -60, priority: "medium", category: "Nachwuchs" },
];

function templateFor(key) {
  if (key === "KM") return [...BASE_TASKS, ...KM_EXTRA];
  if (key === "CHALLENGE") return [...BASE_TASKS, ...CHALLENGE_EXTRA];
  return [...BASE_TASKS, ...YOUTH_EXTRA];
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

async function main() {
  const runId = `home-game-${Date.now()}`;
  const startedAt = Date.now();
  const now = new Date();
  const limit = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
  const matchSnapshot = await db.collection("kfvMatches").get();
  const homeMatches = matchSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .map((match) => ({ ...match, kickoffDate: asDate(match.kickoffAt) }))
    .filter((match) => match.active !== false)
    .filter((match) => isAinet(match.homeTeam))
    .filter((match) => match.kickoffDate > new Date(0) && match.kickoffDate <= limit)
    .filter((match) => match.kickoffDate >= new Date(now.getTime() - 2 * 86400000));

  let created = 0;
  let updated = 0;
  let paused = 0;

  for (const match of homeMatches) {
    const key = teamKey(match);
    const cancelled = match.status === "cancelled" || match.status === "postponed";
    const templates = templateFor(key);
    for (const template of templates) {
      const taskId = `home_${sha(`${match.id}|${template.key}`)}`;
      const ref = db.collection("tasks").doc(taskId);
      const existing = await ref.get();
      const old = existing.exists ? existing.data() : {};
      const dueAt = addMinutes(match.kickoffDate, template.offsetMinutes);
      const payload = {
        title: template.title,
        category: template.category,
        priority: template.priority,
        dueDate: admin.firestore.Timestamp.fromDate(dueAt),
        dueDateText: dueAt.toISOString().slice(0, 10),
        matchId: match.id,
        matchUid: compact(match.matchUid || match.id),
        teamId: compact(match.teamId),
        teamKey: key,
        teamName: compact(match.teamName),
        homeTeam: compact(match.homeTeam),
        awayTeam: compact(match.awayTeam),
        kickoffAt: match.kickoffAt || admin.firestore.Timestamp.fromDate(match.kickoffDate),
        venue: compact(match.venue),
        source: "home-game-auto",
        taskTemplateKey: template.key,
        active: !cancelled,
        paused: cancelled,
        pauseReason: cancelled ? `Spielstatus: ${match.status}` : "",
        status: old.status === "done" ? "done" : (old.status || "open"),
        assignedTo: old.assignedTo || "",
        assignedToName: old.assignedToName || old.assignedTo || "",
        note: old.note || "",
        parserVersion: VERSION,
        lastSeenRunId: runId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: old.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(payload, { merge: true });
      if (existing.exists) updated += 1; else created += 1;
      if (cancelled) paused += 1;
    }
  }

  const statusRef = db.collection("settings").doc("homeGameTaskSyncStatus");
  await statusRef.set({
    success: true,
    running: false,
    version: VERSION,
    runId,
    homeGameCount: homeMatches.length,
    createdCount: created,
    updatedCount: updated,
    pausedCount: paused,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    finishedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`Heimspiele verarbeitet: ${homeMatches.length}`);
  console.log(`Aufgaben erstellt: ${created}, aktualisiert: ${updated}, pausiert: ${paused}`);
}

main().catch(async (error) => {
  console.error("Heimspiel-Aufgabensync fehlgeschlagen:", error);
  try {
    await db.collection("settings").doc("homeGameTaskSyncStatus").set({
      success: false,
      running: false,
      version: VERSION,
      error: error.message || String(error),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch {}
  process.exitCode = 1;
});
