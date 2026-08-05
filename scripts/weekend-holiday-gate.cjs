process.env.TZ = "Europe/Vienna";

const fs = require("fs");

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function key(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function austrianPublicHolidays(year) {
  const easter = easterSunday(year);
  const values = [
    [1, 1, "Neujahr"], [1, 6, "Heilige Drei Könige"],
    [5, 1, "Staatsfeiertag"], [8, 15, "Mariä Himmelfahrt"],
    [10, 26, "Nationalfeiertag"], [11, 1, "Allerheiligen"],
    [12, 8, "Mariä Empfängnis"], [12, 25, "Christtag"], [12, 26, "Stefanitag"],
  ].map(([month, day, name]) => ({ date: new Date(year, month - 1, day, 12), name }));
  values.push(
    { date: addDays(easter, 1), name: "Ostermontag" },
    { date: addDays(easter, 39), name: "Christi Himmelfahrt" },
    { date: addDays(easter, 50), name: "Pfingstmontag" },
    { date: addDays(easter, 60), name: "Fronleichnam" },
  );
  return new Map(values.map((item) => [key(item.date), item.name]));
}

const now = new Date();
const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || process.env.FORCE_SYNC === "true";
const weekend = now.getDay() === 0 || now.getDay() === 6;
const holidayName = austrianPublicHolidays(now.getFullYear()).get(key(now)) || "";
const allowed = manual || weekend || Boolean(holidayName);
const reason = manual ? "manueller Start" : weekend ? "Wochenende" : holidayName || "Werktag";

console.log(`Tabellen-Sync: ${allowed ? "aktiv" : "übersprungen"} (${reason}, ${key(now)}).`);
const output = process.env.GITHUB_OUTPUT;
if (output) {
  fs.appendFileSync(output, `run=${allowed ? "true" : "false"}\nreason=${reason}\n`);
}
