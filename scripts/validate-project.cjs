const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "package.json",
  "firebase.json",
  "firestore.rules",
  "config/kfv-sync.config.json",
  "scripts/kfv-sync.cjs",
  ".github/workflows/kfv-sync.yml",
];

const errors = [];
for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) errors.push(`Fehlt: ${relative}`);
}

for (const relative of ["package.json", "firebase.json", "config/kfv-sync.config.json"]) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    errors.push(`Ungültiges JSON in ${relative}: ${error.message}`);
  }
}

const config = JSON.parse(fs.readFileSync(path.join(root, "config/kfv-sync.config.json"), "utf8"));
const keys = new Set();
for (const team of config.teams || []) {
  if (!team.key || !team.name || !Array.isArray(team.slugs) || team.slugs.length === 0) {
    errors.push(`Ungültige Mannschaftskonfiguration: ${JSON.stringify(team)}`);
  }
  if (keys.has(team.key)) errors.push(`Doppelte Mannschaftskennung: ${team.key}`);
  keys.add(team.key);
}

if (errors.length) {
  console.error("Projektprüfung fehlgeschlagen:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(`Projektprüfung erfolgreich: ${requiredFiles.length} Kerndateien, ${(config.teams || []).length} Mannschaften.`);
