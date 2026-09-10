"use strict";
process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");

const MATCH_COLLECTION = "oefbV12Matches";
const NEWS_COLLECTION = "news";
const LOOKBACK_HOURS = Math.max(6, Number(process.env.RESULT_NEWS_LOOKBACK_HOURS || 48));
const NOW = Date.now();

const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
let credentials;
try { credentials = JSON.parse(rawCredentials); }
catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const normalize = (value) => compact(value)
  .toLocaleLowerCase("de-AT")
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const asDate = (value) => {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

function isAinet(name) {
  const value = ` ${normalize(name)} `;
  return value.includes(" ainet ");
}

function teamKey(match) {
  const direct = compact(match.teamKey).toUpperCase();
  if (direct === "KM") return "KM";
  if (["CHALLENGE", "RES", "RESERVE", "KM-RES", "KM-RESERVE"].includes(direct)) return "CHALLENGE";
  if (["U17", "U12", "U10", "U8", "U08"].includes(direct)) return direct === "U08" ? "U8" : direct;
  const value = normalize(`${match.teamId || ""} ${match.teamName || ""} ${match.competitionName || ""}`);
  if (/\bu17\b/.test(value)) return "U17";
  if (/\bu12\b/.test(value)) return "U12";
  if (/\bu10\b/.test(value)) return "U10";
  if (/\bu8\b|\bu08\b/.test(value)) return "U8";
  if (/\bchallenge\b|\breserve\b|\b1b\b|\bkm res\b/.test(value)) return "CHALLENGE";
  if (/\bkampfmannschaft\b|(?:^|\s)km(?:\s|$)/.test(value)) return "KM";
  return direct || compact(match.teamName) || "TSU Ainet";
}

function teamLabel(key) {
  if (key === "CHALLENGE") return "Challenge";
  return key;
}

function categoryFor(key) {
  if (key === "KM") return "kampfmannschaft";
  if (key === "CHALLENGE") return "challenge";
  if (/^U\d+$/i.test(key)) return "nachwuchs";
  return "verein";
}

function resultData(match) {
  if (!Number.isInteger(match.homeScore) || !Number.isInteger(match.awayScore)) return null;
  const ainetHome = isAinet(match.homeTeam);
  const ainetAway = isAinet(match.awayTeam);
  if (!ainetHome && !ainetAway) return null;
  const ownScore = ainetHome ? match.homeScore : match.awayScore;
  const opponentScore = ainetHome ? match.awayScore : match.homeScore;
  const opponent = compact(ainetHome ? match.awayTeam : match.homeTeam) || "den Gegner";
  const outcome = ownScore > opponentScore ? "win" : ownScore < opponentScore ? "loss" : "draw";
  return { ainetHome, ownScore, opponentScore, opponent, outcome };
}

function buildCopy(match) {
  const key = teamKey(match);
  const label = teamLabel(key);
  const result = resultData(match);
  if (!result) return null;
  const score = `${result.ownScore}:${result.opponentScore}`;
  let title = "";
  let summary = "";
  if (result.outcome === "win") {
    title = `${label} gewinnt ${score} gegen ${result.opponent}`;
    summary = result.ainetHome
      ? `Heimsieg für ${label}: Mit ${score} setzt sich die TSU Ainet gegen ${result.opponent} durch.`
      : `Auswärtssieg für ${label}: Mit ${score} setzt sich die TSU Ainet bei ${result.opponent} durch.`;
  } else if (result.outcome === "draw") {
    title = `${label} spielt ${score} gegen ${result.opponent}`;
    summary = result.ainetHome
      ? `${label} trennt sich im Heimspiel mit ${score} von ${result.opponent}.`
      : `${label} holt auswärts bei ${result.opponent} ein ${score}-Unentschieden.`;
  } else {
    title = `${label} unterliegt ${result.opponent} mit ${score}`;
    summary = result.ainetHome
      ? `${label} muss sich im Heimspiel ${result.opponent} mit ${score} geschlagen geben.`
      : `${label} muss sich auswärts bei ${result.opponent} mit ${score} geschlagen geben.`;
  }
  return { key, result, title, summary };
}

function isEligible(match) {
  if (match.active === false || match.status !== "finished") return false;
  if (!Number.isInteger(match.homeScore) || !Number.isInteger(match.awayScore)) return false;
  if (!isAinet(match.homeTeam) && !isAinet(match.awayTeam)) return false;
  const kickoff = asDate(match.kickoffAt);
  if (kickoff.getTime() <= 0 || kickoff.getTime() > NOW) return false;
  if (NOW - kickoff.getTime() > LOOKBACK_HOURS * 3_600_000) return false;
  const key = teamKey(match);
  // U10/U12: News ausschließlich aus den manuell in der TSU-Ainet-App eingetragenen Endständen.
  if ((key === "U10" || key === "U12") && match.manualResultOverride !== true) return false;
  return true;
}

async function publishForMatch(doc) {
  const match = { id: doc.id, ...doc.data() };
  if (!isEligible(match)) return { status: "skip", reason: "not-eligible" };
  const copy = buildCopy(match);
  if (!copy) return { status: "skip", reason: "copy-failed" };

  // Identisch zur bisherigen Auto-Match-ID: dadurch kann es pro Spiel nur einen Auto-Beitrag geben.
  const newsId = `auto_result_${String(match.id || match.oefbMatchId || match.gameId || "match").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)}`;
  const ref = db.collection(NEWS_COLLECTION).doc(newsId);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? existingSnap.data() : {};

  if (existing.manualOverride === true || existing.source === "manual") {
    return { status: "skip", reason: "manual-override" };
  }

  const signature = [copy.title, copy.summary, match.homeScore, match.awayScore, copy.key].join("|");
  if (existing.source === "auto-result-news" && existing.resultSignature === signature && existing.published === true) {
    return { status: "skip", reason: "unchanged" };
  }

  await ref.set({
    title: copy.title,
    summary: copy.summary,
    content: "",
    category: categoryFor(copy.key),
    imageUrl: existing.imageUrl || "",
    authorName: "TSU Ainet Fußball",
    published: true,
    featured: existing.featured === true,
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: "auto-result-news",
    sourceMatchId: match.id,
    sourceGameId: compact(match.oefbMatchId || match.gameId),
    sourceUrl: compact(match.reportUrl),
    teamId: compact(match.teamId),
    teamName: compact(match.teamName),
    resultType: copy.result.outcome,
    resultSignature: signature,
    autoGenerated: true,
    automaticResultNews: true,
    manualOverride: false,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: existing.createdAt || admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { status: existingSnap.exists ? "updated" : "created", title: copy.title };
}

async function main() {
  const snapshot = await db.collection(MATCH_COLLECTION).get();
  let created = 0, updated = 0, skipped = 0;
  const docs = snapshot.docs
    .filter((doc) => isEligible({ id: doc.id, ...doc.data() }))
    .sort((a, b) => asDate(a.data().kickoffAt).getTime() - asDate(b.data().kickoffAt).getTime());
  for (const doc of docs) {
    const result = await publishForMatch(doc);
    if (result.status === "created") created += 1;
    else if (result.status === "updated") updated += 1;
    else skipped += 1;
    if (result.title) console.log(`News ${result.status}: ${result.title}`);
  }
  console.log(`Auto-Ergebnis-News fertig: ${created} neu, ${updated} aktualisiert, ${skipped} übersprungen.`);
}

main().catch((error) => {
  console.error("Auto-Ergebnis-News fehlgeschlagen:", error);
  process.exitCode = 1;
});
