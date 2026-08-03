process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");
let credentials;
try { credentials = JSON.parse(rawCredentials); }
catch { throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON."); }

admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../config/kfv-sync.config.json"), "utf8"));
const VERSION = "14.1.0-phase2-club-sync";
const STATUS_REF = db.collection("settings").doc("kfvClubSyncStatus");
const MATCH_COLLECTIONS = ["oefbV12Matches", "kfvMatches"];
const STANDING_COLLECTIONS = ["oefbV12Standings", "kfvStandings"];
const MAX_CLUB_PAGES = Number(process.env.MAX_CLUB_PAGES || 80);
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CLUB_SYNC_CONCURRENCY || 3)));

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const normalizeName = (value) => compact(value)
  .toLocaleLowerCase("de-AT")
  .replace(/\b(tsu|spg|fc|sv|usc|union|sektion|askoe|askö)\b/g, " ")
  .replace(/ö/g, "oe").replace(/ä/g, "ae").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const slug = (value) => normalizeName(value).replace(/\s+/g, "-") || "verein";
const makeId = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 24);
const isHttp = (value) => /^https?:\/\//i.test(String(value || ""));
const isAinet = (value) => /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/i.test(normalizeName(value));

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try { return new URL(value, baseUrl).href; } catch { return ""; }
}

function identityFromUrl(url, name = "") {
  try {
    const parsed = new URL(url);
    const kfvId = parsed.pathname.match(/\/Verein\/(\d+)/i)?.[1];
    if (kfvId) return { clubId: `kfv:${kfvId}`, pageUrl: parsed.href.split("#")[0] };
    if (/vereine\.oefb\.at$/i.test(parsed.hostname)) {
      const first = parsed.pathname.split("/").filter(Boolean)[0];
      if (first && !/^Mannschaften$/i.test(first)) return { clubId: `oefb:${slug(first)}`, pageUrl: `${parsed.origin}/${first}` };
    }
  } catch {}
  return { clubId: `name:${slug(name)}`, pageUrl: isHttp(url) ? url : "" };
}

function candidateScore(url, pageUrl, name, alt = "") {
  if (!url || !isHttp(url)) return -1000;
  const hay = `${url} ${alt}`.toLowerCase();
  let score = 0;
  if (/logo|wappen|vereinslogo|clublogo|teamlogo|crest/.test(hay)) score += 10;
  if (/\.svg(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/.test(url)) score += 3;
  if (/favicon|sprite|icon-|apple-touch|banner|header|sponsor|advert|werbung/.test(hay)) score -= 12;
  const key = normalizeName(name).split(" ").filter((x) => x.length >= 4);
  if (key.some((x) => hay.includes(x))) score += 5;
  if (pageUrl && new URL(url).hostname === new URL(pageUrl).hostname) score += 1;
  return score;
}

async function readExistingSources() {
  const found = new Map();
  const add = (name, url, logoUrl = "", clubId = "") => {
    name = compact(name); url = compact(url); logoUrl = compact(logoUrl); clubId = compact(clubId);
    if (!name && !url) return;
    const identity = identityFromUrl(url, name);
    const id = clubId || identity.clubId;
    const key = id || `name:${slug(name)}`;
    const existing = found.get(key) || { clubId: id, name, pageUrl: identity.pageUrl || url, logoUrl: "", aliases: [] };
    if (!existing.name && name) existing.name = name;
    if (!existing.pageUrl && url) existing.pageUrl = identity.pageUrl || url;
    if (!existing.logoUrl && logoUrl) existing.logoUrl = logoUrl;
    if (name && !existing.aliases.includes(name)) existing.aliases.push(name);
    found.set(key, existing);
  };

  for (const url of config.clubSeedUrls || []) add("", url);

  for (const collectionName of MATCH_COLLECTIONS) {
    const snap = await db.collection(collectionName).get().catch(() => null);
    if (!snap) continue;
    for (const doc of snap.docs) {
      const d = doc.data();
      add(d.homeTeam, d.homeClubUrl, d.homeLogoUrl, d.homeClubId);
      add(d.awayTeam, d.awayClubUrl, d.awayLogoUrl, d.awayClubId);
    }
  }
  for (const collectionName of STANDING_COLLECTIONS) {
    const snap = await db.collection(collectionName).get().catch(() => null);
    if (!snap) continue;
    for (const doc of snap.docs) {
      const d = doc.data();
      add(d.clubName, d.clubUrl, d.teamLogoUrl, d.clubId);
    }
  }
  const clubSnap = await db.collection("kfvClubs").get().catch(() => null);
  if (clubSnap) for (const doc of clubSnap.docs) {
    const d = doc.data(); add(d.name, d.pageUrl || d.website, d.logoUrl, d.clubId || doc.id);
  }

  return [...found.values()]
    .filter((item) => item.pageUrl || item.logoUrl)
    .slice(0, MAX_CLUB_PAGES);
}

async function extractClub(browser, seed) {
  if (!seed.pageUrl) return { ...seed, source: "existing", ok: Boolean(seed.logoUrl) };
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 1100 });
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36");
    await page.goto(seed.pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await page.evaluate(async () => {
      for (let y = 0; y < Math.min(document.body.scrollHeight, 2200); y += 500) {
        window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    const data = await page.evaluate(() => {
      const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
      const candidates = [];
      const push = (url, alt, selector) => { if (url) candidates.push({ url, alt: clean(alt), selector }); };
      document.querySelectorAll("img").forEach((img) => push(img.currentSrc || img.src || img.dataset.src || img.dataset.lazySrc, img.alt || img.title, "img"));
      document.querySelectorAll("meta[property='og:image'],meta[name='twitter:image'],link[rel='image_src']").forEach((node) => push(node.content || node.href, node.getAttribute("property") || node.getAttribute("name"), "meta"));
      const heading = clean(document.querySelector("h1")?.textContent || document.querySelector("h2")?.textContent || "");
      const title = clean(document.title);
      const stadiumText = [...document.querySelectorAll("[class*='stadion'],[class*='venue'],[class*='address'],address")].map((n) => clean(n.textContent)).find(Boolean) || "";
      return { title, heading, stadiumText, candidates };
    });
    const name = compact(seed.name || data.heading || data.title.replace(/\s*[|–-].*$/, ""));
    const ranked = data.candidates
      .map((item) => ({ ...item, url: absoluteUrl(item.url, seed.pageUrl), score: candidateScore(absoluteUrl(item.url, seed.pageUrl), seed.pageUrl, name, item.alt) }))
      .filter((item) => item.score > -5)
      .sort((a, b) => b.score - a.score);
    const logoUrl = ranked[0]?.score >= 3 ? ranked[0].url : seed.logoUrl || "";
    const identity = identityFromUrl(seed.pageUrl, name);
    return {
      ...seed,
      clubId: seed.clubId || identity.clubId,
      name,
      normalizedName: normalizeName(name),
      pageUrl: identity.pageUrl || seed.pageUrl,
      website: identity.pageUrl || seed.pageUrl,
      logoUrl,
      stadium: compact(data.stadiumText),
      aliases: [...new Set([...(seed.aliases || []), name].filter(Boolean))],
      source: "official-club-page",
      ok: Boolean(logoUrl),
      candidateCount: ranked.length,
    };
  } catch (error) {
    return { ...seed, ok: Boolean(seed.logoUrl), error: error.message || String(error) };
  } finally {
    await page.close().catch(() => {});
  }
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function writeClubs(clubs, runId) {
  let batch = db.batch(); let count = 0; let writes = 0;
  for (const club of clubs) {
    if (!club.name && !club.clubId) continue;
    const documentId = makeId(club.clubId || `name:${normalizeName(club.name)}`);
    const ref = db.collection("kfvClubs").doc(documentId);
    const previous = await ref.get();
    const old = previous.exists ? previous.data() : {};
    let logoUrl = club.logoUrl || old.logoUrl || "";
    if (!isAinet(club.name) && /tsu[-_ ]?ainet|ainet-logo/i.test(logoUrl)) logoUrl = "";
    batch.set(ref, {
      id: documentId,
      clubId: club.clubId || old.clubId || "",
      name: club.name || old.name || "",
      normalizedName: normalizeName(club.name || old.name || ""),
      logoUrl,
      pageUrl: club.pageUrl || old.pageUrl || "",
      website: club.website || old.website || club.pageUrl || "",
      stadium: club.stadium || old.stadium || "",
      aliases: club.aliases?.length ? club.aliases : (old.aliases || []),
      active: true,
      source: club.source || "phase2-club-sync",
      parserVersion: VERSION,
      runId,
      sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    count++; writes++;
    if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count) await batch.commit();
  return writes;
}

(async () => {
  const runId = `club-${Date.now()}`;
  const started = Date.now();
  await STATUS_REF.set({ running: true, success: false, startedAt: admin.firestore.FieldValue.serverTimestamp(), parserVersion: VERSION, runId }, { merge: true });
  let browser;
  try {
    const sources = await readExistingSources();
    if (!sources.length) throw new Error("Keine Vereinsquellen aus Spielen, Tabellen oder clubSeedUrls gefunden.");
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const clubs = await mapLimit(sources, CONCURRENCY, (seed) => extractClub(browser, seed));
    const usable = clubs.filter((club) => club.name || club.clubId);
    const logoCount = usable.filter((club) => club.logoUrl).length;
    const writes = await writeClubs(usable, runId);
    const diagnostics = usable.map((club) => ({ name: club.name, clubId: club.clubId, pageUrl: club.pageUrl, logoLoaded: Boolean(club.logoUrl), candidateCount: club.candidateCount || 0, error: club.error || "" }));
    await STATUS_REF.set({
      running: false, success: true, finishedAt: admin.firestore.FieldValue.serverTimestamp(), durationSeconds: Math.round((Date.now() - started) / 1000),
      sourceCount: sources.length, clubCount: usable.length, clubLogoCount: logoCount, writeCount: writes, diagnostics: diagnostics.slice(0, 100), parserVersion: VERSION, runId,
    }, { merge: true });
    console.log(`Club-Sync erfolgreich: ${usable.length} Vereine, ${logoCount} Logos, ${writes} Schreibvorgänge.`);
  } catch (error) {
    await STATUS_REF.set({ running: false, success: false, finishedAt: admin.firestore.FieldValue.serverTimestamp(), lastError: error.message || String(error), parserVersion: VERSION, runId }, { merge: true }).catch(() => {});
    console.error("Club-Sync fehlgeschlagen:", error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
