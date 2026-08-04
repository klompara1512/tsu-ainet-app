process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawCredentials) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");

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

const config = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../config/kfv-sync.config.json"), "utf8"),
);

const VERSION = "14.1.1-phase2-club-sync-clean";
const STATUS_REF = db.collection("settings").doc("kfvClubSyncStatus");
const MATCH_COLLECTIONS = ["oefbV12Matches", "kfvMatches"];
const STANDING_COLLECTIONS = ["oefbV12Standings", "kfvStandings"];
const MAX_CLUB_PAGES = Math.max(10, Number(process.env.MAX_CLUB_PAGES || 120));
const CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.CLUB_SYNC_CONCURRENCY || 3)),
);

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const normalizeName = (value) =>
  compact(value)
    .toLocaleLowerCase("de-AT")
    .replace(/\b(tsu|spg|fc|sv|usc|union|sektion|askoe|askö|sg|dsg|atus|urc|wsg)\b/g, " ")
    .replace(/ö/g, "oe")
    .replace(/ä/g, "ae")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const slug = (value) => normalizeName(value).replace(/\s+/g, "-") || "verein";
const makeId = (value) =>
  crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 24);
const isHttp = (value) => /^https?:\/\//i.test(String(value || ""));
const isAinet = (value) => /(?:^|\s)(?:tsu\s+)?ainet(?:\s|$)/i.test(compact(value));

const INVALID_CLUB_NAME_PATTERNS = [
  /^keine eintr[aä]ge verf[uü]gbar$/i,
  /^(?:spiele|tabellen|kader|mannschaften|spielbericht)(?:\s|\-|$)/i,
  /(?:^|\s)(?:saison\s+\d{4}\/\d{2}|mannschaften|vereinshomepage)(?:\s|$)/i,
  /\|\s*kfv\.at$/i,
  /^tsu ainet\s*\|/i,
  /^(?:home|startseite|übersicht|news|kontakt)$/i,
];

function isValidClubName(value) {
  const name = compact(value);
  if (name.length < 2 || name.length > 120) return false;
  if (!/[A-Za-zÄÖÜäöüß]/.test(name)) return false;
  return !INVALID_CLUB_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function officialIdentityFromUrl(url) {
  if (!isHttp(url)) return null;
  try {
    const parsed = new URL(url);
    const kfvId = parsed.pathname.match(/\/Verein\/(\d+)/i)?.[1];
    if (kfvId) {
      return {
        clubId: `kfv:${kfvId}`,
        pageUrl: `${parsed.origin}${parsed.pathname}${parsed.search}`.split("#")[0],
        authority: 3,
      };
    }

    if (/vereine\.oefb\.at$/i.test(parsed.hostname)) {
      const first = parsed.pathname.split("/").filter(Boolean)[0];
      if (first && !/^(?:Mannschaften|Spielbericht)$/i.test(first)) {
        return {
          clubId: `oefb:${slug(first)}`,
          pageUrl: `${parsed.origin}/${first}`,
          authority: 2,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function authorityForClubId(clubId) {
  if (/^kfv:/i.test(clubId)) return 3;
  if (/^oefb:/i.test(clubId)) return 2;
  if (/^name:/i.test(clubId)) return 0;
  return 1;
}

function candidateScore(candidate, pageUrl, name) {
  const { url, alt = "", className = "", id = "", width = 0, height = 0, selector = "" } = candidate;
  if (!url || !isHttp(url)) return -1000;

  const hay = `${url} ${alt} ${className} ${id} ${selector}`.toLowerCase();
  if (/favicon|sprite|icon-|apple-touch|banner|header|sponsor|advert|werbung|social|facebook|instagram|youtube|player|spieler|portrait|avatar/.test(hay)) {
    return -1000;
  }

  let score = 0;
  if (/vereinslogo|clublogo|teamlogo|club-logo|team-logo|wappen|crest/.test(hay)) score += 30;
  else if (/logo/.test(hay)) score += 12;

  if (/meta:og:image|meta:twitter:image/.test(selector)) score += 4;
  if (/\.svg(?:\?|$)|\.png(?:\?|$)|\.webp(?:\?|$)/i.test(url)) score += 3;

  const normalizedClub = normalizeName(name);
  const keyWords = normalizedClub.split(" ").filter((word) => word.length >= 4);
  const normalizedHay = normalizeName(`${url} ${alt}`);
  if (keyWords.length && keyWords.every((word) => normalizedHay.includes(word))) score += 18;
  else if (keyWords.some((word) => normalizedHay.includes(word))) score += 6;

  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (ratio >= 0.65 && ratio <= 1.5) score += 6;
    if (width >= 80 && height >= 80) score += 3;
    if (width > 900 || height > 900) score -= 4;
  }

  try {
    if (pageUrl && new URL(url).hostname === new URL(pageUrl).hostname) score += 2;
  } catch {
    // ignorieren
  }

  return score;
}

function mergeAliases(...lists) {
  const aliases = new Set();
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      const value = compact(item);
      if (isValidClubName(value)) aliases.add(value);
    }
  }
  return [...aliases];
}

async function readExistingSources() {
  const raw = [];

  const add = (name, url, logoUrl = "", clubId = "", aliases = []) => {
    name = compact(name);
    url = compact(url);
    logoUrl = compact(logoUrl);
    clubId = compact(clubId);

    const identity = officialIdentityFromUrl(url);
    const officialClubId = identity?.clubId || (/^(?:kfv|oefb):/i.test(clubId) ? clubId : "");
    const pageUrl = identity?.pageUrl || "";

    if (!isValidClubName(name) && !pageUrl) return;
    if (!pageUrl && !officialClubId) return; // keine neuen name:-Datensätze mehr

    raw.push({
      clubId: officialClubId,
      name: isValidClubName(name) ? name : "",
      pageUrl,
      logoUrl,
      aliases: mergeAliases(aliases, name ? [name] : []),
      authority: identity?.authority || authorityForClubId(officialClubId),
    });
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
  if (clubSnap) {
    for (const doc of clubSnap.docs) {
      const d = doc.data();
      if (d.manualOverride === true) continue;
      add(d.name, d.pageUrl || d.website, d.logoUrl, d.clubId || doc.id, d.aliases);
    }
  }

  // Nach offizieller ID zusammenführen.
  const byOfficialId = new Map();
  for (const item of raw) {
    const key = item.clubId || item.pageUrl;
    if (!key) continue;
    const existing = byOfficialId.get(key) || {
      clubId: item.clubId,
      name: "",
      pageUrl: item.pageUrl,
      logoUrl: "",
      aliases: [],
      authority: item.authority,
    };
    if (!existing.name && item.name) existing.name = item.name;
    if (!existing.pageUrl && item.pageUrl) existing.pageUrl = item.pageUrl;
    if (!existing.logoUrl && item.logoUrl) existing.logoUrl = item.logoUrl;
    existing.aliases = mergeAliases(existing.aliases, item.aliases);
    existing.authority = Math.max(existing.authority || 0, item.authority || 0);
    byOfficialId.set(key, existing);
  }

  // KFV- und ÖFB-Dubletten desselben Vereins anhand des normalisierten Namens zusammenführen.
  const byName = new Map();
  for (const item of byOfficialId.values()) {
    const normalized = normalizeName(item.name || item.aliases[0] || "");
    const key = normalized || item.clubId;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, item);
      continue;
    }

    const preferred = (item.authority || 0) > (existing.authority || 0) ? item : existing;
    const secondary = preferred === item ? existing : item;
    preferred.aliases = mergeAliases(preferred.aliases, secondary.aliases, secondary.name ? [secondary.name] : []);
    if (!preferred.logoUrl && secondary.logoUrl) preferred.logoUrl = secondary.logoUrl;
    if (!preferred.pageUrl && secondary.pageUrl) preferred.pageUrl = secondary.pageUrl;
    byName.set(key, preferred);
  }

  return [...byName.values()]
    .filter((item) => item.clubId && item.pageUrl)
    .slice(0, MAX_CLUB_PAGES);
}

async function extractClub(browser, seed) {
  if (!seed.pageUrl || !seed.clubId) {
    return { ...seed, ok: false, error: "Keine offizielle Vereinsseite oder Vereins-ID" };
  }

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 1100 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "de-AT,de;q=0.9,en;q=0.7" });
    await page.goto(seed.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await new Promise((resolve) => setTimeout(resolve, 1800));

    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const max = Math.min(document.body?.scrollHeight || 0, 2500);
      for (let y = 0; y <= max; y += 500) {
        window.scrollTo(0, y);
        await sleep(120);
      }
      window.scrollTo(0, 0);
    });

    const data = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const candidates = [];
      const push = (url, alt, selector, node = null) => {
        if (!url) return;
        const rect = node?.getBoundingClientRect?.();
        candidates.push({
          url,
          alt: clean(alt),
          selector,
          className: clean(node?.className),
          id: clean(node?.id),
          width: Math.round(rect?.width || node?.naturalWidth || 0),
          height: Math.round(rect?.height || node?.naturalHeight || 0),
        });
      };

      document
        .querySelectorAll(
          "img[class*='club'],img[class*='verein'],img[class*='logo'],img[id*='logo'],.club-logo img,.team-logo img,.vereinslogo img",
        )
        .forEach((img) =>
          push(
            img.currentSrc || img.src || img.dataset?.src || img.dataset?.lazySrc,
            img.alt || img.title,
            "targeted-img",
            img,
          ),
        );

      document.querySelectorAll("meta[property='og:image'],meta[name='twitter:image']").forEach((node) =>
        push(node.content, node.getAttribute("property") || node.getAttribute("name"), `meta:${node.getAttribute("property") || node.getAttribute("name")}`),
      );

      // Allgemeine Bilder nur ergänzend, nicht als bevorzugte Quelle.
      document.querySelectorAll("header img,main img").forEach((img) =>
        push(
          img.currentSrc || img.src || img.dataset?.src || img.dataset?.lazySrc,
          img.alt || img.title,
          "fallback-img",
          img,
        ),
      );

      const headings = [...document.querySelectorAll("h1,h2,[class*='club-name'],[class*='verein-name']")]
        .map((node) => clean(node.textContent))
        .filter(Boolean);

      const stadiumText = [...document.querySelectorAll("[class*='stadion'],[class*='venue'],[class*='address'],address")]
        .map((node) => clean(node.textContent))
        .find(Boolean) || "";

      return {
        title: clean(document.title),
        headings,
        stadiumText,
        candidates,
        finalUrl: location.href,
      };
    });

    const headingName = data.headings.find(isValidClubName) || "";
    const name = isValidClubName(seed.name) ? seed.name : headingName;
    if (!isValidClubName(name)) {
      return {
        ...seed,
        ok: false,
        error: `Kein gültiger Vereinsname erkannt (${data.title || "ohne Titel"})`,
        candidateCount: data.candidates.length,
      };
    }

    const ranked = data.candidates
      .map((item) => {
        const url = absoluteUrl(item.url, data.finalUrl || seed.pageUrl);
        return { ...item, url, score: candidateScore({ ...item, url }, seed.pageUrl, name) };
      })
      .filter((item) => item.score >= 8)
      .sort((a, b) => b.score - a.score);

    const selected = ranked[0] || null;
    const loadedLogoUrl = selected?.score >= 15 ? selected.url : "";
    let logoUrl = loadedLogoUrl || seed.logoUrl || "";
    if (!isAinet(name) && /tsu[-_ ]?ainet|ainet-logo/i.test(logoUrl)) logoUrl = "";

    const identity = officialIdentityFromUrl(seed.pageUrl);
    if (!identity) {
      return { ...seed, ok: false, error: "Vereinsseite besitzt keine offizielle KFV-/ÖFB-ID" };
    }

    return {
      ...seed,
      clubId: identity.clubId,
      name,
      normalizedName: normalizeName(name),
      pageUrl: identity.pageUrl,
      website: identity.pageUrl,
      logoUrl,
      logoLoadedThisRun: Boolean(loadedLogoUrl),
      stadium: compact(data.stadiumText),
      aliases: mergeAliases(seed.aliases, [name]),
      source: "official-club-page",
      ok: true,
      candidateCount: data.candidates.length,
      qualifiedCandidateCount: ranked.length,
      selectedLogoScore: selected?.score || 0,
    };
  } catch (error) {
    return {
      ...seed,
      ok: false,
      logoLoadedThisRun: false,
      error: error.message || String(error),
    };
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

  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker),
  );
  return results;
}

async function cleanupInvalidAndDuplicateClubs(validClubs, runId) {
  const snapshot = await db.collection("kfvClubs").get();
  const validOfficialIds = new Set(validClubs.map((club) => club.clubId).filter(Boolean));
  const validNames = new Set(validClubs.map((club) => normalizeName(club.name)).filter(Boolean));
  let batch = db.batch();
  let pending = 0;
  let deactivated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.manualOverride === true) continue;

    const name = compact(data.name);
    const normalized = normalizeName(name);
    const clubId = compact(data.clubId || doc.id);
    const isInvalid = !isValidClubName(name);
    const isNameOnlyDuplicate = /^name:/i.test(clubId) && normalized && validNames.has(normalized);
    const isUnknownHashDuplicate = !/^(?:kfv|oefb|name):/i.test(clubId) && normalized && validNames.has(normalized);
    const officialButNotSeen = /^(?:kfv|oefb):/i.test(clubId) && !validOfficialIds.has(clubId);

    if (isInvalid || isNameOnlyDuplicate || isUnknownHashDuplicate) {
      batch.set(
        doc.ref,
        {
          active: false,
          cleanupReason: isInvalid ? "invalid-club-name" : "duplicate-nonofficial-club",
          cleanupRunId: runId,
          cleanupAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      pending += 1;
      deactivated += 1;
    } else if (officialButNotSeen) {
      // Offizielle Einträge nicht automatisch deaktivieren; Quelle könnte temporär fehlen.
    }

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending) await batch.commit();
  return deactivated;
}

async function writeClubs(clubs, runId) {
  let batch = db.batch();
  let count = 0;
  let writes = 0;

  for (const club of clubs) {
    if (!club.ok || !club.clubId || !club.pageUrl || !isValidClubName(club.name)) continue;

    const documentId = makeId(club.clubId);
    const ref = db.collection("kfvClubs").doc(documentId);
    const previous = await ref.get();
    const old = previous.exists ? previous.data() : {};

    let logoUrl = club.logoUrl || old.logoUrl || "";
    if (!isAinet(club.name) && /tsu[-_ ]?ainet|ainet-logo/i.test(logoUrl)) logoUrl = "";

    batch.set(
      ref,
      {
        id: documentId,
        clubId: club.clubId,
        name: club.name,
        normalizedName: normalizeName(club.name),
        logoUrl,
        pageUrl: club.pageUrl,
        website: club.website || club.pageUrl,
        stadium: club.stadium || old.stadium || "",
        aliases: mergeAliases(old.aliases, club.aliases, [club.name]),
        active: true,
        source: "phase2-official-club-sync",
        parserVersion: VERSION,
        runId,
        logoLoadedThisRun: club.logoLoadedThisRun === true,
        sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    count += 1;
    writes += 1;
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count) await batch.commit();
  return writes;
}

(async () => {
  const runId = `club-${Date.now()}`;
  const started = Date.now();

  await STATUS_REF.set(
    {
      running: true,
      success: false,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      parserVersion: VERSION,
      runId,
    },
    { merge: true },
  );

  let browser;
  try {
    const sources = await readExistingSources();
    if (!sources.length) {
      throw new Error("Keine offiziellen Vereinsquellen aus Spielen, Tabellen oder clubSeedUrls gefunden.");
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const clubs = await mapLimit(sources, CONCURRENCY, (seed) =>
      extractClub(browser, seed),
    );
    const usable = clubs.filter(
      (club) => club.ok && club.clubId && club.pageUrl && isValidClubName(club.name),
    );

    const logoCount = usable.filter((club) => club.logoUrl).length;
    const logoLoadedThisRunCount = usable.filter((club) => club.logoLoadedThisRun).length;
    const writes = await writeClubs(usable, runId);
    const deactivatedCount = await cleanupInvalidAndDuplicateClubs(usable, runId);

    const diagnostics = clubs.map((club) => ({
      name: club.name || "",
      clubId: club.clubId || "",
      pageUrl: club.pageUrl || "",
      valid: Boolean(club.ok),
      logoAvailable: Boolean(club.logoUrl),
      logoLoadedThisRun: Boolean(club.logoLoadedThisRun),
      candidateCount: club.candidateCount || 0,
      qualifiedCandidateCount: club.qualifiedCandidateCount || 0,
      selectedLogoScore: club.selectedLogoScore || 0,
      error: club.error || "",
    }));

    await STATUS_REF.set(
      {
        running: false,
        success: true,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        durationSeconds: Math.round((Date.now() - started) / 1000),
        sourceCount: sources.length,
        clubCount: usable.length,
        clubLogoCount: logoCount,
        logoLoadedThisRunCount,
        writeCount: writes,
        deactivatedInvalidOrDuplicateCount: deactivatedCount,
        diagnostics: diagnostics.slice(0, 150),
        parserVersion: VERSION,
        runId,
      },
      { merge: true },
    );

    console.log(
      `Club-Sync erfolgreich: ${usable.length} offizielle Vereine, ${logoCount} Logos vorhanden, ${logoLoadedThisRunCount} Logos neu bestätigt, ${deactivatedCount} falsche/Dubletten deaktiviert.`,
    );
  } catch (error) {
    await STATUS_REF.set(
      {
        running: false,
        success: false,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: error.message || String(error),
        parserVersion: VERSION,
        runId,
      },
      { merge: true },
    ).catch(() => {});

    console.error("Club-Sync fehlgeschlagen:", error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();