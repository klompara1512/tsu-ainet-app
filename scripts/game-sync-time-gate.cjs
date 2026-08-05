process.env.TZ = "Europe/Vienna";

const fs = require("fs");
const now = new Date();
const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || process.env.FORCE_SYNC === "true";
const allowedHours = new Set([6, 12, 18]);
const allowed = manual || allowedHours.has(now.getHours());
const reason = manual ? "manueller Start" : allowed ? `${String(now.getHours()).padStart(2, "0")}:00 Uhr Europe/Vienna` : "kein geplantes Zeitfenster";

console.log(`Spielplan-Sync: ${allowed ? "aktiv" : "übersprungen"} (${reason}).`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${allowed ? "true" : "false"}\nreason=${reason}\n`);
}
