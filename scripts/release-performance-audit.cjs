const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
let passed = 0;
let warnings = 0;
let errors = 0;

function ok(message) { passed += 1; console.log(`✓ ${message}`); }
function warn(message) { warnings += 1; console.log(`⚠ ${message}`); }
function fail(message) { errors += 1; console.log(`✗ ${message}`); }
function check(condition, success, failure) { condition ? ok(success) : fail(failure); }

console.log("\nTSU Ainet Performance & UX Audit");
console.log("================================");

const app = read("src/App.tsx");
const vite = read("vite.config.ts");
const css = read("src/index.css");
const sw = read("public/sw.js");
const main = read("src/main.tsx");

check(app.includes("lazy(() => import"), "Zentrale App-Bereiche werden lazy geladen.", "Lazy Loading der zentralen App-Bereiche fehlt.");
check(app.includes("Suspense"), "Ein stabiler Lade-Fallback ist vorhanden.", "React Suspense-Fallback fehlt.");
check(vite.includes("codeSplitting") && vite.includes("firebase-vendor"), "Vendor-Code-Splitting ist konfiguriert.", "Vendor-Code-Splitting fehlt.");
check(css.includes("prefers-reduced-motion"), "Reduzierte Bewegungen werden berücksichtigt.", "prefers-reduced-motion fehlt.");
check(css.includes("min-height: 44px"), "Mobile Mindestgröße für Bedienelemente ist hinterlegt.", "Mobile Touch-Ziele sind nicht abgesichert.");
check(exists("src/OfflineStatus.tsx") && app.includes("OfflineStatus"), "Online-/Offline-Rückmeldung ist eingebaut.", "Online-/Offline-Rückmeldung fehlt.");
check(sw.includes("AbortController") && sw.includes("staleWhileRevalidate"), "Service Worker nutzt Timeout und Stale-While-Revalidate.", "Service-Worker-Strategie ist nicht optimiert.");
check(main.includes('import.meta.env.PROD'), "Service Worker wird nur in Produktion registriert.", "Service-Worker-Registrierung ist nicht auf Produktion begrenzt.");
check(!vite.includes("sourcemap: true"), "Produktions-Sourcemaps sind deaktiviert.", "Produktions-Sourcemaps sollten deaktiviert sein.");

const html = read("index.html");
if (/name="description"/i.test(html)) ok("Meta-Beschreibung ist vorhanden.");
else warn("Meta-Beschreibung fehlt noch und sollte vor der öffentlichen Domain ergänzt werden.");

console.log(`\nErgebnis: ${passed} bestanden, ${warnings} Warnungen, ${errors} Fehler.`);
process.exitCode = errors ? 1 : 0;
