process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const crypto = require("crypto");

const VERSION = "18.2.0-instagram-news-phase-1";
const NEWS_COLLECTION = "news";
const STATUS_DOC = "instagramNewsSyncStatus";
const API_VERSION = String(process.env.INSTAGRAM_API_VERSION || "v23.0").trim();
const ACCESS_TOKEN = String(process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
const CONFIGURED_USER_ID = String(process.env.INSTAGRAM_USER_ID || "").trim();
const MAX_PAGES = Math.max(1, Math.min(10, Number(process.env.INSTAGRAM_MAX_PAGES || 5)));
const PAGE_LIMIT = Math.max(1, Math.min(100, Number(process.env.INSTAGRAM_PAGE_LIMIT || 50)));
const IMPORT_LIMIT = Math.max(1, Math.min(500, Number(process.env.INSTAGRAM_IMPORT_LIMIT || 200)));
const API_BASE = String(process.env.INSTAGRAM_API_BASE || "https://graph.instagram.com").replace(/\/$/, "");

if (!ACCESS_TOKEN) {
  throw new Error("INSTAGRAM_ACCESS_TOKEN fehlt.");
}

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
  admin.initializeApp({ credential: admin.credential.cert(credentials) });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const sha = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 24);

function stripHashtags(value) {
  return compact(String(value || "").replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, " "));
}

function titleFromCaption(caption, mediaType) {
  const clean = stripHashtags(caption);
  const firstSentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
  if (firstSentence) return firstSentence.slice(0, 100).trim();
  if (mediaType === "VIDEO" || mediaType === "REELS") return "Neues Reel auf Instagram";
  if (mediaType === "CAROUSEL_ALBUM") return "Neuer Instagram-Beitrag";
  return "Neuer Beitrag auf Instagram";
}

function summaryFromCaption(caption) {
  const clean = compact(caption);
  return clean.length > 220 ? `${clean.slice(0, 217).trimEnd()}…` : clean;
}

function safeDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `HTTP ${response.status}`;
    const error = new Error(`Instagram API: ${message}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

async function resolveUser() {
  if (CONFIGURED_USER_ID) {
    return { id: CONFIGURED_USER_ID, username: "tsu.ainet" };
  }

  const candidates = [
    `${API_BASE}/${API_VERSION}/me?fields=user_id,username,id`,
    `${API_BASE}/me?fields=user_id,username,id`,
  ];

  let lastError;
  for (const url of candidates) {
    try {
      const data = await fetchJson(url);
      const id = compact(data.user_id || data.id);
      if (id) return { id, username: compact(data.username || "tsu.ainet") };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Instagram-Konto-ID konnte nicht ermittelt werden.");
}

function mediaEndpoint(userId) {
  const fields = [
    "id",
    "caption",
    "media_type",
    "media_product_type",
    "media_url",
    "thumbnail_url",
    "permalink",
    "timestamp",
    "username",
    "children{id,media_type,media_url,thumbnail_url,permalink,timestamp}",
  ].join(",");
  const params = new URLSearchParams({ fields, limit: String(PAGE_LIMIT) });
  return `${API_BASE}/${API_VERSION}/${encodeURIComponent(userId)}/media?${params}`;
}

async function loadMedia(userId) {
  const items = [];
  let nextUrl = mediaEndpoint(userId);
  let page = 0;

  while (nextUrl && page < MAX_PAGES && items.length < IMPORT_LIMIT) {
    const payload = await fetchJson(nextUrl);
    if (Array.isArray(payload.data)) items.push(...payload.data);
    nextUrl = compact(payload?.paging?.next || "");
    page += 1;
  }

  const unique = new Map();
  for (const item of items) {
    const id = compact(item?.id);
    if (id && !unique.has(id)) unique.set(id, item);
  }
  return [...unique.values()].slice(0, IMPORT_LIMIT);
}

function imageForMedia(media) {
  const direct = compact(media.thumbnail_url || media.media_url);
  if (direct) return direct;
  const children = Array.isArray(media?.children?.data) ? media.children.data : [];
  const child = children.find((item) => item?.media_url || item?.thumbnail_url);
  return compact(child?.thumbnail_url || child?.media_url || "");
}

function timestampForMedia(media) {
  const parsed = safeDate(media.timestamp);
  return parsed || new Date();
}

async function upsertMedia(media, account, runId) {
  const mediaId = compact(media.id);
  if (!mediaId) return { written: false, reason: "missing-id" };

  const reference = db.collection(NEWS_COLLECTION).doc(`instagram_${sha(mediaId)}`);
  const existing = await reference.get();
  const old = existing.exists ? existing.data() : {};

  if (old.manualOverride === true || old.source === "manual") {
    return { written: false, reason: "manual-override" };
  }

  const caption = compact(media.caption || "");
  const mediaType = compact(media.media_product_type || media.media_type || "IMAGE");
  const publishedDate = timestampForMedia(media);
  const permalink = compact(media.permalink || "");
  const imageUrl = imageForMedia(media);

  const payload = {
    title: titleFromCaption(caption, mediaType),
    summary: summaryFromCaption(caption),
    content: caption || "Neuer Beitrag auf Instagram.",
    category: "verein",
    imageUrl,
    authorName: `Instagram · @${compact(media.username || account.username || "tsu.ainet")}`,
    published: true,
    featured: old.featured === true,
    publishedAt: admin.firestore.Timestamp.fromDate(publishedDate),
    source: "instagram",
    sourceUrl: permalink,
    instagramId: mediaId,
    instagramUsername: compact(media.username || account.username || "tsu.ainet"),
    instagramMediaType: mediaType,
    instagramPermalink: permalink,
    autoGenerated: true,
    manualOverride: false,
    active: true,
    lastSeenRunId: runId,
    syncVersion: VERSION,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: old.createdAt || admin.firestore.FieldValue.serverTimestamp(),
  };

  await reference.set(payload, { merge: true });
  return { written: true, reason: existing.exists ? "updated" : "created" };
}

async function main() {
  const runId = `instagram-news-${Date.now()}`;
  const startedAt = Date.now();
  const statusRef = db.collection("settings").doc(STATUS_DOC);

  await statusRef.set({
    success: false,
    running: true,
    runId,
    version: VERSION,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    error: "",
  }, { merge: true });

  try {
    const account = await resolveUser();
    const mediaItems = await loadMedia(account.id);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const media of mediaItems) {
      const result = await upsertMedia(media, account, runId);
      if (!result.written) skipped += 1;
      else if (result.reason === "created") created += 1;
      else updated += 1;
    }

    await statusRef.set({
      success: true,
      running: false,
      runId,
      version: VERSION,
      accountId: account.id,
      username: account.username || "tsu.ainet",
      fetchedCount: mediaItems.length,
      createdCount: created,
      updatedCount: updated,
      skippedCount: skipped,
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      error: "",
    }, { merge: true });

    console.log(`Instagram @${account.username || "tsu.ainet"}: ${mediaItems.length} Beiträge geprüft.`);
    console.log(`Neu: ${created}; aktualisiert: ${updated}; übersprungen: ${skipped}.`);
  } catch (error) {
    await statusRef.set({
      success: false,
      running: false,
      runId,
      version: VERSION,
      error: error?.message || String(error),
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error("Instagram-News-Synchronisierung fehlgeschlagen:", error);
  process.exitCode = 1;
});
