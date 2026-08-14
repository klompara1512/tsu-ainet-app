const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, '../config/kfv-sync.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const required = ['KM','CHALLENGE','U17','U12','U10','U08'];
const tableTeams = new Set(['KM','CHALLENGE','U17']);
const teams = new Map(config.teams.map((team) => [team.key, team]));
const errors = [];

for (const key of required) {
  const team = teams.get(key);
  if (!team) { errors.push(`${key}: Konfiguration fehlt`); continue; }
  if (!team.squadUrl) errors.push(`${key}: Kader-URL fehlt`);
  if (key !== 'U08') {
    if (!team.gamesUrl) errors.push(`${key}: Spielplan-URL fehlt`);
    if (tableTeams.has(key) && !(team.tableUrl || team.tableUrls?.length)) errors.push(`${key}: Tabellen-URL fehlt`);
    if (!tableTeams.has(key) && (team.tableUrl || team.tableUrls?.length)) errors.push(`${key}: darf keine Tabellen-URL haben`);
  }
  for (const [field, value] of Object.entries(team)) {
    if ((field.endsWith('Url') || field.endsWith('Urls')) && value) {
      const values = Array.isArray(value) ? value : [value];
      for (const raw of values) {
        let url;
        try { url = new URL(raw); } catch { errors.push(`${key}.${field}: ungültige URL`); continue; }
        if (url.protocol !== 'https:') errors.push(`${key}.${field}: nur HTTPS erlaubt`);
        if (!/(^|\.)oefb\.at$|(^|\.)kfv-fussball\.at$/.test(url.hostname)) {
          errors.push(`${key}.${field}: nicht offizielle Domain ${url.hostname}`);
        }
      }
    }
  }
}

const expectedSquadSlugs = { KM:'/KM/Kader', CHALLENGE:'/Res/Kader', U17:'/U17/Kader', U12:'/U12/Kader', U10:'/U10/Kader', U08:'/U08/Kader' };
for (const [key, fragment] of Object.entries(expectedSquadSlugs)) {
  if (!teams.get(key)?.squadUrl?.includes(fragment)) errors.push(`${key}: falsche Kaderquelle, erwartet ${fragment}`);
}

if (errors.length) {
  console.error('Official-Sync-Selbsttest fehlgeschlagen:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Official-Sync-Selbsttest erfolgreich: ${required.length} Mannschaften, feste offizielle Quellen.`);
