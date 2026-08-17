"use strict";
process.env.TZ = "Europe/Vienna";
const crypto = require("crypto");
const admin = require("firebase-admin");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
let credentials;
try { credentials = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }
admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();

const pick = (obj, keys) => Object.fromEntries(keys.map((key) => [key, obj[key]]).filter(([, value]) => value !== undefined));
const asMillis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value || null);

function comparableMatch(row) {
  return { ...row, kickoffAt: asMillis(row.kickoffAt), sourceUpdatedAt: asMillis(row.sourceUpdatedAt) };
}
function stableChecksum(matches, standings) {
  const comparable = {
    matches: matches.map(comparableMatch).map(({ sourceUpdatedAt, ...row }) => row),
    standings,
  };
  return crypto.createHash("sha256").update(JSON.stringify(comparable)).digest("hex");
}

async function main() {
  const [matchSnap, standingSnap] = await Promise.all([
    db.collection("oefbV12Matches").get(),
    db.collection("oefbV12Standings").get(),
  ]);

  const matchKeys = [
    "teamId", "teamKey", "teamName", "competitionName", "homeTeam", "awayTeam",
    "homeClubId", "awayClubId", "homeClubUrl", "awayClubUrl", "homeLogoUrl", "awayLogoUrl",
    "homeScore", "awayScore", "kickoffAt", "venue", "venueAddress", "referee", "liveUrl",
    "status", "reportUrl", "gameId", "oefbMatchId", "sourceUpdatedAt", "active",
  ];
  const standingKeys = [
    "teamId", "teamKey", "teamName", "competitionName", "position", "clubName", "clubId",
    "clubUrl", "teamLogoUrl", "played", "won", "drawn", "lost", "goalsFor", "goalsAgainst",
    "goalDifference", "points", "active",
  ];

  const matches = matchSnap.docs
    .map((doc) => ({ id: doc.id, ...pick(doc.data(), matchKeys) }))
    .filter((row) => row.active !== false)
    .sort((a, b) => (asMillis(a.kickoffAt) || 0) - (asMillis(b.kickoffAt) || 0));

  const standings = standingSnap.docs
    .map((doc) => ({ id: doc.id, ...pick(doc.data(), standingKeys) }))
    .filter((row) => row.active !== false && row.clubName)
    .sort((a, b) => String(a.teamKey || a.teamId || "").localeCompare(String(b.teamKey || b.teamId || "")) || Number(a.position || 999) - Number(b.position || 999));

  const checksum = stableChecksum(matches, standings);
  const ref = db.doc("publicSnapshots/football");
  const previous = await ref.get();
  if (previous.exists && previous.data()?.checksum === checksum) {
    console.log(`Public Snapshot unverändert: ${matches.length} Spiele, ${standings.length} Tabellenzeilen. Kein Write nötig.`);
    return;
  }

  const approxBytes = Buffer.byteLength(JSON.stringify({ matches: matches.map(comparableMatch), standings }));
  if (approxBytes > 800_000) throw new Error(`Public Snapshot wäre mit ca. ${approxBytes} Bytes zu groß.`);

  await ref.set({
    schemaVersion: 1,
    checksum,
    matches,
    standings,
    matchCount: matches.length,
    standingCount: standings.length,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: false });

  console.log(`Public Snapshot aktualisiert: ${matches.length} Spiele, ${standings.length} Tabellenzeilen, ca. ${approxBytes} Bytes.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
