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

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(credentials) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../config/kfv-sync.config.json"), "utf8"));
const VERSION = "16.1.1-spark-delta-squad-sync";
const STATUS_REF = db.collection("settings").doc("kfvSquadSyncStatus");
const COLLECTION = "kfvSquad";
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.SQUAD_SYNC_CONCURRENCY || 2)));
const NAVIGATION_TIMEOUT = Math.max(20000, Number(process.env.SQUAD_NAVIGATION_TIMEOUT || 50000));
const teams = (config.teams || []).filter((team) => team.enabled !== false && team.squadUrl);

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const slug = (value) => compact(value)
  .toLocaleLowerCase("de-AT")
  .replace(/ö/g, "oe").replace(/ä/g, "ae").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "spieler";
const sha = (value) => crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 24);
const absoluteUrl = (value, baseUrl) => { try { return value ? new URL(value, baseUrl).href : ""; } catch { return ""; } };

const INVALID_NAME_PATTERN = /(?:^|\b)(?:kader|spielerprofil|spieler|trainer\s*&?\s*betreuer|betreuer|mannschaft|saison|geburtsdatum|position|rückennummer|kontakt|mehr|details|zu-?\s*&?\s*abgänge|keine\s+einträge|eine\s+seite\s+des\s+öfb|öfb\s+dachangebot|vereinshomepage|tabellen?|spiele?|news|termine|tsu\s+ainet)(?:\b|$)/i;

function canonicalName(value) {
  return compact(value)
    .toLocaleLowerCase("de-AT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausiblePlayerName(value) {
  const name = compact(value);
  if (name.length < 5 || name.length > 70 || INVALID_NAME_PATTERN.test(name)) return false;
  if (/https?:|www\.|@|\d{3,}|[|<>={}[\]]/.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((word) => /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.'’-]{1,30}$/.test(word));
}

function parseBirthday(value) {
  const text = compact(value);
  const match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12, 0, 0);
  return Number.isNaN(date.getTime()) ? null : admin.firestore.Timestamp.fromDate(date);
}

function normalizePosition(value) {
  const text = compact(value).toLocaleLowerCase("de-AT");
  if (/torwart|goalkeeper|tormann/.test(text)) return "Torwart";
  if (/abwehr|verteidigung|defensive/.test(text)) return "Abwehr";
  if (/mittelfeld|midfield/.test(text)) return "Mittelfeld";
  if (/sturm|angriff|forward/.test(text)) return "Sturm";
  if (/trainer/.test(text)) return "Trainer";
  if (/betreuer/.test(text)) return "Betreuer";
  return "Spieler";
}

function legacyTeamAliases(team) {
  const aliases = new Set([
    compact(team.key).toUpperCase(),
    slug(team.name),
    compact(team.name).toLocaleLowerCase("de-AT"),
  ]);
  if (team.key === "KM") ["kampfmannschaft", "km"].forEach((v) => aliases.add(v));
  if (team.key === "CHALLENGE") ["challenge", "reserve", "res", "km-res"].forEach((v) => aliases.add(v));
  if (team.key === "U08") ["u08", "u8"].forEach((v) => aliases.add(v));
  return aliases;
}

function belongsToTeam(data, team) {
  const aliases = legacyTeamAliases(team);
  const values = [data.teamKey, data.teamId, data.teamName]
    .map((value) => compact(value))
    .filter(Boolean);
  return values.some((value) => aliases.has(value) || aliases.has(value.toUpperCase()) || aliases.has(value.toLocaleLowerCase("de-AT")));
}

async function waitForDynamicContent(page) {
  await page.waitForFunction(() => document.body && document.body.innerText.length > 200, { timeout: 12000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const max = Math.min(document.body?.scrollHeight || 0, 7000);
    for (let y = 0; y <= max; y += 550) {
      window.scrollTo(0, y);
      await sleep(100);
    }
    window.scrollTo(0, 0);
    await sleep(300);
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

async function extractTeamSquad(browser, team) {
  const page = await browser.newPage();
  const started = Date.now();
  try {
    await page.setViewport({ width: 1365, height: 1400 });
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "de-AT,de;q=0.9,en;q=0.7" });
    await page.goto(team.squadUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT });
    await waitForDynamicContent(page);

    const raw = await page.evaluate(() => {
      const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const absolute = (value) => { try { return value ? new URL(value, location.href).href : ""; } catch { return ""; } };
      const invalid = /(?:^|\b)(?:kader|spielerprofil|spieler|trainer\s*&?\s*betreuer|betreuer|mannschaft|saison|geburtsdatum|position|rückennummer|kontakt|mehr|details|zu-?\s*&?\s*abgänge|keine\s+einträge|eine\s+seite\s+des\s+öfb|öfb\s+dachangebot|vereinshomepage|tabellen?|spiele?|news|termine|tsu\s+ainet)(?:\b|$)/i;
      const cleanName = (value) => compact(value)
        .replace(/^#?\s*\d{1,3}\s+/, "")
        .replace(/\s+(?:Torwart|Tormann|Goalkeeper|Abwehr|Verteidigung|Mittelfeld|Sturm|Angriff|Spieler|Trainer|Betreuer)\s*$/i, "")
        .trim();
      const looksLikeName = (value) => {
        const name = cleanName(value);
        if (name.length < 5 || name.length > 70 || invalid.test(name)) return false;
        if (/https?:|www\.|@|\d{3,}|[|<>={}[\]]/.test(name)) return false;
        const words = name.split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 5) return false;
        return words.every((word) => /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.'’-]{1,30}$/.test(word));
      };
      const canonical = (value) => cleanName(value).toLocaleLowerCase("de-AT").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
      const isPlayerProfile = (href) => /(?:spieler|player|person|profil|portrait)/i.test(String(href || ""))
        && !/(?:mannschaften|kader|spiele|tabellen|news)(?:\/|$)/i.test(String(href || ""));
      const imageFrom = (node) => {
        const images = [...(node?.querySelectorAll?.("img") || [])];
        const img = images.find((candidate) => {
          const meta = `${candidate.alt || ""} ${candidate.className || ""} ${candidate.src || ""}`;
          return !/logo|icon|sponsor|banner|flag|facebook|instagram|placeholder/i.test(meta);
        }) || images[0];
        return absolute(img?.currentSrc || img?.src || img?.dataset?.src || img?.dataset?.lazySrc || img?.getAttribute?.("data-original"));
      };
      const profileFrom = (node, preferred) => {
        const links = [...(node?.querySelectorAll?.("a[href]") || [])];
        const link = preferred && isPlayerProfile(preferred.href)
          ? preferred
          : links.find((candidate) => isPlayerProfile(candidate.href));
        return absolute(link?.href || "");
      };

      const candidates = [];
      const add = (node, preferredLink = null, source = "card") => {
        if (!node) return;
        const text = compact(node.innerText || node.textContent || "");
        if (!text || text.length > 700) return;
        const profileUrl = profileFrom(node, preferredLink);
        const imageUrl = imageFrom(node);
        const hasPlayerSignal = Boolean(profileUrl || imageUrl || /player|spieler|person|portrait|squad|kader/i.test(String(node.className || "")));
        if (!hasPlayerSignal) return;

        const selectors = [
          "[class*='player-name']", "[class*='spieler-name']", "[class*='person-name']",
          "[data-testid*='name']", "h2", "h3", "h4", "h5", "strong", "b"
        ];
        const names = selectors
          .map((selector) => cleanName(node.querySelector?.(selector)?.textContent))
          .filter(looksLikeName);
        const linkText = cleanName(preferredLink?.textContent || "");
        if (looksLikeName(linkText)) names.unshift(linkText);
        if (!names.length) {
          const lines = String(node.innerText || node.textContent || "")
            .split(/\n+/).map(cleanName).filter(looksLikeName);
          names.push(...lines);
        }
        const name = names[0] || "";
        if (!name) return;

        const idMatch = profileUrl.match(/(?:Spieler|Player|Person)\/?(?:Detail\/?)?(\d{3,})/i)
          || profileUrl.match(/[?&](?::p|p|playerId|personId)=(\d+)/i);
        const numberMatch = text.match(/(?:Rückennummer|Trikotnummer|Nr\.?|#)\s*:?\s*(\d{1,3})/i)
          || text.match(/^(?:#\s*)?(\d{1,3})\b/);
        const positionMatch = text.match(/\b(Torwart|Tormann|Goalkeeper|Abwehr|Verteidigung|Defensive|Mittelfeld|Sturm|Angriff|Forward|Trainer|Betreuer)\b/i);
        const birthdayMatch = text.match(/(?:Geb(?:oren|urtsdatum)?|Jahrgang)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4}|\d{4})/i);
        candidates.push({
          name,
          canonicalName: canonical(name),
          number: numberMatch ? Number(numberMatch[1]) : null,
          position: positionMatch?.[1] || "Spieler",
          imageUrl,
          profileUrl,
          oefbPlayerId: idMatch?.[1] || "",
          birthdayText: birthdayMatch?.[1]?.includes(".") ? birthdayMatch[1] : "",
          birthYear: birthdayMatch?.[1]?.match(/^\d{4}$/)?.[0] || "",
          source,
        });
      };

      document.querySelectorAll("a[href]").forEach((anchor) => {
        if (!isPlayerProfile(anchor.href)) return;
        const card = anchor.closest("article,li,tr,[class*='player'],[class*='spieler'],[class*='squad'],[class*='kader'],[class*='person'],.card") || anchor.parentElement;
        add(card, anchor, "profile-link");
      });

      const cardSelectors = [
        "[data-player-id]", "[data-person-id]", "[class*='player-card']", "[class*='spieler-card']",
        "[class*='squad-player']", "[class*='kader-spieler']", "[class*='person-card']",
        "[class*='playerItem']", "[class*='squadItem']"
      ];
      document.querySelectorAll(cardSelectors.join(",")).forEach((node) => add(node, null, "player-card"));

      // Nur wenn keine strukturierten Treffer vorhanden sind, Bildkarten vorsichtig prüfen.
      if (!candidates.length) {
        document.querySelectorAll("img").forEach((image) => {
          const card = image.closest("article,li,[class*='card'],[class*='player'],[class*='spieler'],[class*='person']");
          if (card) add(card, null, "image-card");
        });
      }

      // Doppelte DOM-Treffer derselben Person zusammenführen. Der vollständigste Treffer gewinnt.
      const byName = new Map();
      const score = (item) => (item.oefbPlayerId ? 50 : 0) + (item.profileUrl ? 20 : 0) + (item.imageUrl ? 10 : 0)
        + (Number.isInteger(item.number) ? 4 : 0) + (item.position !== "Spieler" ? 2 : 0);
      for (const item of candidates) {
        if (!item.canonicalName) continue;
        const old = byName.get(item.canonicalName);
        if (!old || score(item) > score(old)) byName.set(item.canonicalName, item);
      }

      return {
        title: compact(document.title),
        heading: compact(document.querySelector("h1")?.textContent || ""),
        bodyLength: compact(document.body?.innerText || "").length,
        imageCount: document.images.length,
        linkCount: document.links.length,
        rawCandidateCount: candidates.length,
        players: [...byName.values()],
      };
    });

    const unique = new Map();
    let invalidFiltered = 0;
    let duplicateFiltered = 0;
    for (const player of raw.players) {
      if (!isPlausiblePlayerName(player.name)) { invalidFiltered++; continue; }
      const nameKey = canonicalName(player.name);
      if (!nameKey) { invalidFiltered++; continue; }
      const current = unique.get(nameKey);
      const quality = (item) => (item.oefbPlayerId ? 50 : 0) + (item.profileUrl ? 20 : 0) + (item.imageUrl ? 10 : 0)
        + (Number.isInteger(item.number) ? 4 : 0) + (normalizePosition(item.position) !== "Spieler" ? 2 : 0);
      if (!current || quality(player) > quality(current)) {
        if (current) duplicateFiltered++;
        unique.set(nameKey, player);
      } else {
        duplicateFiltered++;
      }
    }

    const players = [...unique.values()].map((player, index) => {
      const nameKey = canonicalName(player.name);
      const stableSource = player.oefbPlayerId || player.profileUrl || nameKey;
      return {
        id: `squad_${sha(`${team.key}:${stableSource}`)}`,
        playerId: player.oefbPlayerId ? `oefb:${player.oefbPlayerId}` : `name:${slug(player.name)}`,
        oefbPlayerId: player.oefbPlayerId || "",
        teamKey: team.key,
        teamId: team.key,
        teamName: team.name,
        canonicalName: nameKey,
        name: compact(player.name),
        number: Number.isInteger(player.number) && player.number >= 0 && player.number <= 999 ? player.number : null,
        position: normalizePosition(player.position),
        imageUrl: absoluteUrl(player.imageUrl, team.squadUrl),
        profileUrl: absoluteUrl(player.profileUrl, team.squadUrl),
        birthday: parseBirthday(player.birthdayText),
        birthYear: player.birthYear ? Number(player.birthYear) : null,
        role: /trainer|betreuer/i.test(player.position) ? normalizePosition(player.position) : "Spieler",
        order: Number.isInteger(player.number) ? player.number : 500 + index,
        active: true,
        source: "oefb-official-squad",
        sourceUrl: team.squadUrl,
        parserVersion: VERSION,
      };
    });

    return {
      team,
      teamKey: team.key,
      teamName: team.name,
      sourceUrl: team.squadUrl,
      ok: players.length > 0,
      players,
      rawCandidateCount: raw.rawCandidateCount || 0,
      invalidFiltered,
      duplicateFiltered,
      durationSeconds: Math.round((Date.now() - started) / 1000),
      title: raw.title,
      heading: raw.heading,
      bodyLength: raw.bodyLength,
      imageCount: raw.imageCount,
      linkCount: raw.linkCount,
      error: players.length ? "" : "Keine gültigen Kaderspieler erkannt",
    };
  } catch (error) {
    return {
      team,
      teamKey: team.key,
      teamName: team.name,
      sourceUrl: team.squadUrl,
      ok: false,
      players: [],
      rawCandidateCount: 0,
      invalidFiltered: 0,
      duplicateFiltered: 0,
      durationSeconds: Math.round((Date.now() - started) / 1000),
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

let existingSquadCache = null;

async function loadExistingSquadOnce() {
  if (existingSquadCache) return existingSquadCache;
  const snapshot = await db.collection(COLLECTION).get();
  existingSquadCache = snapshot.docs;
  return existingSquadCache;
}

async function loadExistingByTeam(team) {
  const docs = await loadExistingSquadOnce();
  return docs.filter((doc) => belongsToTeam(doc.data(), team));
}

function timestampKey(value) {
  if (!value) return "";
  if (typeof value.toMillis === "function") return String(value.toMillis());
  if (value instanceof Date) return String(value.getTime());
  return String(value);
}

function squadComparable(value) {
  const player = value || {};
  return {
    playerId: String(player.playerId || ""),
    oefbPlayerId: String(player.oefbPlayerId || ""),
    teamKey: String(player.teamKey || ""),
    teamId: String(player.teamId || ""),
    teamName: String(player.teamName || ""),
    canonicalName: String(player.canonicalName || ""),
    name: String(player.name || ""),
    number: Number.isFinite(player.number) ? player.number : null,
    position: String(player.position || ""),
    imageUrl: String(player.imageUrl || ""),
    profileUrl: String(player.profileUrl || ""),
    birthday: timestampKey(player.birthday),
    birthYear: Number.isFinite(player.birthYear) ? player.birthYear : null,
    role: String(player.role || ""),
    order: Number.isFinite(player.order) ? player.order : null,
    active: player.active !== false,
    source: String(player.source || ""),
    sourceUrl: String(player.sourceUrl || ""),
    parserVersion: String(player.parserVersion || ""),
    manualOverride: player.manualOverride === true,
  };
}

async function writeTeamSquad(result, runId) {
  if (!result.ok || !result.players.length) return { writes: 0, unchanged: 0, deactivated: 0, invalidDeactivated: 0, duplicateDeactivated: 0, skipped: true };
  const existingDocs = await loadExistingByTeam(result.team);
  const incomingIds = new Set(result.players.map((player) => player.id));
  const incomingNames = new Map(result.players.map((player) => [player.canonicalName, player.id]));
  let batch = db.batch();
  let operations = 0;
  let writes = 0;
  let unchanged = 0;
  let deactivated = 0;
  let invalidDeactivated = 0;
  let duplicateDeactivated = 0;
  const flush = async () => {
    if (!operations) return;
    await batch.commit();
    batch = db.batch(); operations = 0;
  };

  const existingMap = new Map(existingDocs.map((doc) => [doc.id, doc.data()]));
  for (const player of result.players) {
    const previous = existingMap.get(player.id) || {};
    const manual = previous.manualOverride === true;
    const payload = manual ? {
      ...player,
      name: typeof previous.name === "string" ? previous.name : player.name,
      canonicalName: canonicalName(typeof previous.name === "string" ? previous.name : player.name),
      number: typeof previous.number === "number" || previous.number === null ? previous.number : player.number,
      position: typeof previous.position === "string" ? previous.position : player.position,
      imageUrl: typeof previous.imageUrl === "string" ? previous.imageUrl : player.imageUrl,
      profileUrl: typeof previous.profileUrl === "string" ? previous.profileUrl : player.profileUrl,
      birthday: previous.birthday || player.birthday || null,
      active: typeof previous.active === "boolean" ? previous.active : true,
      order: typeof previous.order === "number" ? previous.order : player.order,
      manualOverride: true,
      manualUpdatedAt: previous.manualUpdatedAt || null,
    } : {
      ...player,
      imageUrl: player.imageUrl || previous.imageUrl || "",
      profileUrl: player.profileUrl || previous.profileUrl || "",
      active: true,
      manualOverride: false,
    };
    if (previous && JSON.stringify(squadComparable(previous)) === JSON.stringify(squadComparable(payload))) {
      unchanged++;
      continue;
    }
    batch.set(db.collection(COLLECTION).doc(player.id), {
      ...payload,
      syncRunId: runId,
      sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    operations++; writes++;
    if (operations >= 400) await flush();
  }

  for (const doc of existingDocs) {
    if (incomingIds.has(doc.id)) continue;
    const old = doc.data();
    if (old.manualOverride === true) continue;
    const oldName = compact(old.name);
    const oldNameKey = canonicalName(oldName);
    const invalid = !isPlausiblePlayerName(oldName);
    const duplicate = Boolean(oldNameKey && incomingNames.has(oldNameKey));
    const deactivationReason = invalid ? "invalid-player-record" : duplicate ? "duplicate-player-record" : "not-in-current-official-squad";
    const duplicateOf = duplicate ? incomingNames.get(oldNameKey) : "";
    if (old.active === false && old.deactivationReason === deactivationReason && String(old.duplicateOf || "") === duplicateOf) {
      unchanged++;
      continue;
    }
    batch.set(doc.ref, {
      active: false,
      deactivationReason,
      duplicateOf,
      syncRunId: runId,
      sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    operations++; deactivated++;
    if (invalid) invalidDeactivated++;
    if (duplicate) duplicateDeactivated++;
    if (operations >= 400) await flush();
  }
  await flush();
  return { writes, unchanged, deactivated, invalidDeactivated, duplicateDeactivated, skipped: false };
}

(async () => {
  const runId = `squad-${Date.now()}`;
  const started = Date.now();
  await STATUS_REF.set({
    running: true,
    success: false,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    parserVersion: VERSION,
    runId,
  }, { merge: true });

  let browser;
  try {
    if (!teams.length) throw new Error("Keine Mannschaften mit squadUrl konfiguriert.");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const results = await mapLimit(teams, CONCURRENCY, (team) => extractTeamSquad(browser, team));
    let writeCount = 0;
    let unchangedCount = 0;
    let deactivatedCount = 0;
    let invalidDeactivatedCount = 0;
    let duplicateDeactivatedCount = 0;
    const diagnostics = [];
    const teamCounts = {};

    for (const result of results) {
      const writeResult = await writeTeamSquad(result, runId);
      writeCount += writeResult.writes;
      unchangedCount += writeResult.unchanged || 0;
      deactivatedCount += writeResult.deactivated;
      invalidDeactivatedCount += writeResult.invalidDeactivated;
      duplicateDeactivatedCount += writeResult.duplicateDeactivated;
      teamCounts[result.teamKey] = result.players.length;
      diagnostics.push({
        teamKey: result.teamKey,
        teamName: result.teamName,
        sourceUrl: result.sourceUrl,
        success: result.ok,
        playerCount: result.players.length,
        rawCandidateCount: result.rawCandidateCount,
        invalidFiltered: result.invalidFiltered,
        duplicateFiltered: result.duplicateFiltered,
        durationSeconds: result.durationSeconds,
        title: result.title || "",
        heading: result.heading || "",
        bodyLength: result.bodyLength || 0,
        imageCount: result.imageCount || 0,
        linkCount: result.linkCount || 0,
        writes: writeResult.writes,
        unchanged: writeResult.unchanged || 0,
        deactivated: writeResult.deactivated,
        invalidDeactivated: writeResult.invalidDeactivated,
        duplicateDeactivated: writeResult.duplicateDeactivated,
        skippedWrite: writeResult.skipped,
        error: result.error || "",
      });
      console.log(`${result.ok ? "✅" : "⚠"} ${result.teamName}: ${result.players.length} gültige Spieler${result.error ? ` – ${result.error}` : ""}`);
    }

    const successfulTeams = results.filter((result) => result.ok).length;
    const totalPlayers = results.reduce((sum, result) => sum + result.players.length, 0);
    if (!successfulTeams) throw new Error("Auf keiner offiziellen Kaderseite wurden gültige Spieler erkannt. Bestehende Kaderdaten wurden nicht verändert.");

    await STATUS_REF.set({
      running: false,
      success: true,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      durationSeconds: Math.round((Date.now() - started) / 1000),
      configuredTeamCount: teams.length,
      successfulTeamCount: successfulTeams,
      failedTeamCount: teams.length - successfulTeams,
      squadCount: totalPlayers,
      writeCount,
      unchangedCount,
      deactivatedCount,
      invalidDeactivatedCount,
      duplicateDeactivatedCount,
      teamCounts,
      diagnostics,
      parserVersion: VERSION,
      runId,
      lastError: "",
    }, { merge: true });
    console.log(`Kader-Sync erfolgreich: ${totalPlayers} gültige Spieler aus ${successfulTeams}/${teams.length} Mannschaften.`);
    console.log(`Kader Delta: ${writeCount} geändert/neu, ${unchangedCount} unverändert übersprungen.`);
    console.log(`Bereinigt: ${duplicateDeactivatedCount} Dubletten, ${invalidDeactivatedCount} ungültige Einträge.`);
  } catch (error) {
    await STATUS_REF.set({
      running: false,
      success: false,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      durationSeconds: Math.round((Date.now() - started) / 1000),
      lastError: error.message || String(error),
      parserVersion: VERSION,
      runId,
    }, { merge: true }).catch(() => {});
    console.error("Kader-Sync fehlgeschlagen:", error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
