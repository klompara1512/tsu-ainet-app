"use strict";
const { spawnSync } = require("child_process");

const requested = String(process.env.TABLE_TEAMS || process.argv.slice(2).join(",") || "KM,CHALLENGE,U17")
  .split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
const allowed = new Set(["KM", "CHALLENGE", "U17"]);
const teams = [...new Set(requested)].filter((team) => allowed.has(team));
if (!teams.length) {
  console.log("Keine Tabellen zur Synchronisierung ausgewählt.");
  process.exit(0);
}

for (const team of teams) {
  const script = team === "CHALLENGE" ? "scripts/challenge-table-sync.cjs" : "scripts/exact-team-table-sync.cjs";
  console.log(`\n===== Exakte Tabelle ${team} =====`);
  const result = spawnSync(process.execPath, [script, team], {
    stdio: "inherit",
    env: { ...process.env, TABLE_TEAM: team },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
