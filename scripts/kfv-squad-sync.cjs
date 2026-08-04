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
const VERSION = "14.2.0-phase3-squad-sync";
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
      const results = [];
      const seen = new Set();
      const forbidden = /^(?:Kader|Trainer|Betreuer|Mannschaft|Spieler|Spielerprofil|Saison|Geburtsdatum|Position|Rückennummer|Kontakt|Mehr|Details)$/i;
      const cleanName = (value) => compact(value)
        .replace(/^#?\s*\d{1,2}\s+/, "")
        .replace(/\s+(?:Torwart|Tormann|Goalkeeper|Abwehr|Verteidigung|Mittelfeld|Sturm|Angriff|Spieler)\s*$/i, "")
        .trim();
      const looksLikeName = (value) => {
        const name = cleanName(value);
        if (name.length < 3 || name.length > 90 || forbidden.test(name)) return false;
        if (!/[A-Za-zÄÖÜäöüß]{2}/.test(name)) return false;
        const words = name.split(/\s+/).filter(Boolean);
        return words.length >= 2 && words.length <= 6 && !/\d{3,}/.test(name);
      };
      const imageFrom = (node) => {
        const img = node?.querySelector?.("img");
        return absolute(img?.currentSrc || img?.src || img?.dataset?.src || img?.dataset?.lazySrc || img?.getAttribute?.("data-original"));
      };
      const profileFrom = (node, preferred) => {
        const links = [...(node?.querySelectorAll?.("a[href]") || [])];
        const link = preferred || links.find((a) => /spieler|player|person|profil|portrait/i.test(`${a.href} ${a.className || ""}`)) || links[0];
        return absolute(link?.href || "");
      };
      const add = (node, preferredLink = null) => {
        if (!node) return;
        const text = compact(node.innerText || node.textContent || "");
        if (!text || text.length > 1000) return;
        const selectors = [
          "[class*='player-name']", "[class*='spieler-name']", "[class*='person-name']",
          "[data-testid*='name']", "h2", "h3", "h4", "h5", "strong", "b"
        ];
        const candidates = selectors.map((selector) => cleanName(node.querySelector?.(selector)?.textContent)).filter(looksLikeName);
        const linkText = cleanName(preferredLink?.textContent || node.querySelector?.("a[href]")?.textContent);
        if (looksLikeName(linkText)) candidates.unshift(linkText);
        if (!candidates.length) {
          const lines = String(node.innerText || node.textContent || "").split(/\n+/).map(cleanName).filter(looksLikeName);
          candidates.push(...lines);
        }
        const name = candidates[0] || "";
        if (!name) return;
        const key = name.toLocaleLowerCase("de-AT");
        if (seen.has(key)) return;

        const profileUrl = profileFrom(node, preferredLink);
        const idMatch = profileUrl.match(/(?:Spieler|Player|Person)\/?(?:Detail\/?)?(\d{3,})/i)
          || profileUrl.match(/[?&](?::p|p|playerId|personId)=(\d+)/i);
        const numberMatch = text.match(/(?:Rückennummer|Trikotnummer|Nr\.?|#)\s*:?\s*(\d{1,2})/i)
          || text.match(/^(?:#\s*)?(\d{1,2})\b/);
        const positionMatch = text.match(/\b(Torwart|Tormann|Goalkeeper|Abwehr|Verteidigung|Defensive|Mittelfeld|Sturm|Angriff|Forward|Trainer|Betreuer)\b/i);
        const birthdayMatch = text.match(/(?:Geb(?:oren|urtsdatum)?|Jahrgang)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4}|\d{4})/i);
        const imageUrl = imageFrom(node);
        results.push({
          name,
          number: numberMatch ? Number(numberMatch[1]) : null,
          position: positionMatch?.[1] || "Spieler",
          imageUrl,
          profileUrl,
          oefbPlayerId: idMatch?.[1] || "",
          birthdayText: birthdayMatch?.[1]?.includes(".") ? birthdayMatch[1] : "",
          birthYear: birthdayMatch?.[1]?.match(/^\d{4}$/)?.[0] || "",
        });
        seen.add(key);
      };

      const cardSelectors = [
        "article", "li", "tr", "[class*='player-card']", "[class*='spieler-card']",
        "[class*='squad-player']", "[class*='kader-spieler']", "[class*='person-card']",
        "[data-player-id]", "[data-person-id]", "[class*='playerItem']", "[class*='squadItem']"
      ];
      document.querySelectorAll(cardSelectors.join(",")).forEach((node) => add(node));

      document.querySelectorAll("a[href]").forEach((anchor) => {
        if (!/spieler|player|person|profil|portrait/i.test(`${anchor.href} ${anchor.className || ""}`)) return;
        const card = anchor.closest("article,li,tr,[class*='player'],[class*='spieler'],[class*='squad'],[class*='kader'],[class*='person'],.card") || anchor.parentElement;
        add(card, anchor);
      });

      if (results.length === 0) {
        document.querySelectorAll("img").forEach((image) => {
          const card = image.closest("article,li,[class*='card'],[class*='player'],[class*='spieler'],[class*='person'],div");
          add(card);
        });
      }

      return {
        title: compact(document.title),
        heading: compact(document.querySelector("h1")?.textContent || ""),
        bodyLength: compact(document.body?.innerText || "").length,
        imageCount: document.images.length,
        linkCount: document.links.length,
        players: results,
      };
    });

    const players = raw.players.map((player, index) => {
      const stableSource = player.oefbPlayerId || player.profileUrl || `${team.key}:${player.name}`;
      return {
        id: `squad_${sha(stableSource)}`,
        playerId: player.oefbPlayerId ? `oefb:${player.oefbPlayerId}` : `name:${slug(player.name)}`,
        oefbPlayerId: player.oefbPlayerId || "",
        teamKey: team.key,
        teamId: slug(team.name),
        teamName: team.name,
        name: compact(player.name),
        number: Number.isInteger(player.number) ? player.number : null,
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
    }).filter((player) => player.name);

    return {
      teamKey: team.key,
      teamName: team.name,
      sourceUrl: team.squadUrl,
      ok: players.length > 0,
      players,
      durationSeconds: Math.round((Date.now() - started) / 1000),
      title: raw.title,
      heading: raw.heading,
      bodyLength: raw.bodyLength,
      imageCount: raw.imageCount,
      linkCount: raw.linkCount,
      error: players.length ? "" : "Keine Kaderspieler erkannt",
    };
  } catch (error) {
    return {
      teamKey: team.key,
      teamName: team.name,
      sourceUrl: team.squadUrl,
      ok: false,
      players: [],
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

async function loadExistingByTeam(teamKey) {
  const snapshot = await db.collection(COLLECTION).where("teamKey", "==", teamKey).get().catch(() => null);
  if (snapshot) return snapshot.docs;
  const fallback = await db.collection(COLLECTION).get();
  return fallback.docs.filter((doc) => doc.data().teamKey === teamKey);
}

async function writeTeamSquad(result, runId) {
  if (!result.ok || !result.players.length) return { writes: 0, deactivated: 0, skipped: true };
  const existingDocs = await loadExistingByTeam(result.teamKey);
  const incomingIds = new Set(result.players.map((player) => player.id));
  let batch = db.batch();
  let operations = 0;
  let writes = 0;
  let deactivated = 0;
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
    batch.set(doc.ref, {
      active: false,
      syncRunId: runId,
      sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    operations++; deactivated++;
    if (operations >= 400) await flush();
  }
  await flush();
  return { writes, deactivated, skipped: false };
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
    let deactivatedCount = 0;
    const diagnostics = [];
    const teamCounts = {};

    for (const result of results) {
      const writeResult = await writeTeamSquad(result, runId);
      writeCount += writeResult.writes;
      deactivatedCount += writeResult.deactivated;
      teamCounts[result.teamKey] = result.players.length;
      diagnostics.push({
        teamKey: result.teamKey,
        teamName: result.teamName,
        sourceUrl: result.sourceUrl,
        success: result.ok,
        playerCount: result.players.length,
        durationSeconds: result.durationSeconds,
        title: result.title || "",
        heading: result.heading || "",
        bodyLength: result.bodyLength || 0,
        imageCount: result.imageCount || 0,
        linkCount: result.linkCount || 0,
        writes: writeResult.writes,
        deactivated: writeResult.deactivated,
        skippedWrite: writeResult.skipped,
        error: result.error || "",
      });
      console.log(`${result.ok ? "✅" : "⚠"} ${result.teamName}: ${result.players.length} Spieler${result.error ? ` – ${result.error}` : ""}`);
    }

    const successfulTeams = results.filter((result) => result.ok).length;
    const totalPlayers = results.reduce((sum, result) => sum + result.players.length, 0);
    if (!successfulTeams) throw new Error("Auf keiner offiziellen Kaderseite wurden Spieler erkannt. Bestehende Kaderdaten wurden nicht verändert.");

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
      deactivatedCount,
      teamCounts,
      diagnostics,
      parserVersion: VERSION,
      runId,
      lastError: "",
    }, { merge: true });
    console.log(`Kader-Sync erfolgreich: ${totalPlayers} Spieler aus ${successfulTeams}/${teams.length} Mannschaften.`);
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
