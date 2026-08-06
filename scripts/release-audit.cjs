#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const issues = [];
const warnings = [];
const passed = [];

function rel(file) { return path.relative(ROOT, file).replaceAll(path.sep, "/"); }
function addIssue(message) { issues.push(message); }
function addWarning(message) { warnings.push(message); }
function addPass(message) { passed.push(message); }
function exists(relative) { return fs.existsSync(path.join(ROOT, relative)); }
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), "utf8"); }

function walk(dir, predicate = () => true) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  const output = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const full = path.join(absolute, entry.name);
    if (entry.isDirectory()) output.push(...walk(rel(full), predicate));
    else if (predicate(full)) output.push(full);
  }
  return output;
}

function checkRequiredFiles() {
  const required = [
    "package.json", "package-lock.json", "firebase.json", "firestore.rules",
    "src/App.tsx", "src/Dashboard.tsx", "src/firebase.ts", "src/appVersion.ts",
    "public/sw.js", "public/manifest.webmanifest", "index.html",
  ];
  const missing = required.filter((file) => !exists(file));
  if (missing.length) addIssue(`Pflichtdateien fehlen: ${missing.join(", ")}`);
  else addPass("Alle Pflichtdateien sind vorhanden.");
}

function checkVersions() {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const appMatch = read("src/appVersion.ts").match(/APP_VERSION\s*=\s*["']([^"']+)/);
  const cacheMatch = read("public/sw.js").match(/CACHE_NAME\s*=\s*["']tsu-ainet-v([^"']+)/);
  const versions = {
    package: String(pkg.version || ""),
    lock: String(lock.version || lock.packages?.[""]?.version || ""),
    app: appMatch?.[1] || "",
    cache: (cacheMatch?.[1] || "").replaceAll("-", "."),
  };
  const normalized = Object.values(versions).map((value) => String(value).replace(/\.rc\./g, "-rc.").replace(/-rc-(\d+)$/, "-rc.$1"));
  if (new Set(normalized).size !== 1) addIssue(`Versionsangaben uneinheitlich: ${JSON.stringify(versions)}`);
  else addPass(`Versionsangaben stimmen überein (${versions.app}).`);
}

function checkScriptSyntax() {
  const scripts = walk("scripts", (file) => file.endsWith(".cjs") || file.endsWith(".js"));
  const failed = [];
  for (const file of scripts) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) failed.push(`${rel(file)}: ${result.stderr.trim().split("\n")[0]}`);
  }
  if (failed.length) addIssue(`JavaScript-Syntaxfehler:\n- ${failed.join("\n- ")}`);
  else addPass(`${scripts.length} Synchronisations-/Hilfsskripte sind syntaktisch gültig.`);
}

function checkWorkflows() {
  const workflows = walk(".github/workflows", (file) => /\.ya?ml$/i.test(file));
  if (!workflows.length) {
    addIssue("Keine GitHub-Actions-Workflows gefunden.");
    return;
  }
  const duplicateNames = new Map();
  for (const file of workflows) {
    const text = fs.readFileSync(file, "utf8");
    if (!/^name:\s*.+/m.test(text)) addWarning(`${rel(file)} hat keinen Workflow-Namen.`);
    if (!/^on:/m.test(text)) addIssue(`${rel(file)} enthält keinen Trigger (on:).`);
    if (/INSTAGRAM_ACCESS_TOKEN|INSTAGRAM_USER_ID/.test(text)) addIssue(`${rel(file)} enthält noch Instagram-Abhängigkeiten.`);
    const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    if (name) duplicateNames.set(name, [...(duplicateNames.get(name) || []), rel(file)]);
  }
  for (const [name, files] of duplicateNames) {
    if (files.length > 1) addWarning(`Doppelter Workflow-Name „${name}": ${files.join(", ")}`);
  }
  addPass(`${workflows.length} GitHub-Actions-Workflows wurden strukturell geprüft.`);
}

function checkSecretsAndPlaceholders() {
  const files = [
    ...walk("src", (file) => /\.(ts|tsx|js|jsx|css)$/.test(file)),
    ...walk("scripts", (file) => /\.(cjs|js|mjs)$/.test(file)),
    ...walk(".github/workflows", (file) => /\.ya?ml$/i.test(file)),
  ];
  const privateSecretPatterns = [
    /-----BEGIN PRIVATE KEY-----/,
    /EA[A-Za-z0-9]{40,}/,
  ];
  const placeholderPatterns = [new RegExp("TO" + "DO\\b", "i"), new RegExp("FIX" + "ME\\b", "i"), new RegExp("HA" + "CK\\b", "i")];
  for (const file of files) {
    if (rel(file) === "scripts/release-audit.cjs") continue;
    const text = fs.readFileSync(file, "utf8");
    if (privateSecretPatterns.some((pattern) => pattern.test(text))) addIssue(`Mögliches privates Secret im Quellcode: ${rel(file)}`);
    if (placeholderPatterns.some((pattern) => pattern.test(text))) addWarning(`Offene Entwicklungsmarkierung in ${rel(file)}.`);
  }
  addPass("Quellcode auf typische versehentlich eingecheckte Secrets geprüft.");
}

function checkKnownRegressions() {
  const dashboard = read("src/Dashboard.tsx");
  if (/const\s+canManageAnything\b/.test(dashboard)) addIssue("Bekannter TS6133-Fehler: canManageAnything ist weiterhin deklariert.");
  else addPass("Bekannter Dashboard-TS6133-Fehler ist behoben.");

  const instagramFiles = [
    "scripts/instagram-news-sync.cjs",
    ".github/workflows/instagram-news-sync.yml",
    "INSTAGRAM_NEWS_SYNC_EINRICHTUNG.md",
  ].filter(exists);
  if (instagramFiles.length) addIssue(`Entfernte Instagram-Funktion ist noch vorhanden: ${instagramFiles.join(", ")}`);
  else addPass("Instagram-Synchronisierung wurde vollständig entfernt.");

  if (/\bNews\b/.test(read("src/BottomNav.tsx"))) addWarning("In BottomNav.tsx ist noch die sichtbare Bezeichnung „News“ vorhanden.");
  if (!/label:\s*["']Verein["']/.test(read("src/BottomNav.tsx"))) addIssue("BottomNav.tsx verwendet noch nicht die sichtbare Bezeichnung „Verein“.");
}

function checkFirebaseRules() {
  const rules = read("firestore.rules");
  if (/allow\s+read\s*,?\s*write\s*:\s*if\s+true/.test(rules)) addIssue("Firestore enthält eine weltweit offene Schreibregel.");
  else addPass("Keine weltweit offene Firestore-Schreibregel gefunden.");
  if (!/match\s+\/news\//.test(rules)) addIssue("Firestore-Regel für Ankündigungen/news fehlt.");
  if (!/match\s+\/clubPeople\//.test(rules)) addIssue("Firestore-Regel für Vorstand/Trainer fehlt.");
  if (!/match\s+\/sponsors\//.test(rules)) addIssue("Firestore-Regel für Sponsoren fehlt.");
}

function checkPackageScripts() {
  const pkg = JSON.parse(read("package.json"));
  const required = ["build", "lint", "typecheck", "sync:check", "release:cleanup", "release:audit"];
  const missing = required.filter((name) => !pkg.scripts?.[name]);
  if (missing.length) addIssue(`package.json-Skripte fehlen: ${missing.join(", ")}`);
  else addPass("Build-, Lint-, Typecheck-, Sync- und Release-Audit-Skripte sind vorhanden.");
}

checkRequiredFiles();
checkVersions();
checkScriptSyntax();
checkWorkflows();
checkSecretsAndPlaceholders();
checkKnownRegressions();
checkFirebaseRules();
checkPackageScripts();

console.log("\nTSU Ainet Release Code Audit\n=============================");
for (const item of passed) console.log(`✓ ${item}`);
for (const item of warnings) console.log(`⚠ ${item}`);
for (const item of issues) console.log(`✗ ${item}`);
console.log(`\nErgebnis: ${passed.length} bestanden, ${warnings.length} Warnungen, ${issues.length} Fehler.`);

if (issues.length) process.exitCode = 1;
