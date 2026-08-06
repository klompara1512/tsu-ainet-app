const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const checks = [];
const pass = (name) => checks.push({ status: 'pass', name });
const fail = (name) => checks.push({ status: 'fail', name });
const warn = (name) => checks.push({ status: 'warn', name });
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

console.log('\nTSU Ainet Release UI Audit');
console.log('==========================');

if (/name="viewport"/.test(read('index.html'))) pass('Mobiler Viewport ist konfiguriert.'); else fail('Viewport-Meta-Tag fehlt.');
if (/label:"Verein"/.test(read('src/BottomNav.tsx'))) pass('Hauptnavigation verwendet „Verein“.'); else fail('Navigation verwendet nicht „Verein“.');
if (/Ankündigungen/.test(read('src/BottomNav.tsx')) && /Ankündigungen/.test(read('src/LiveDashboard.tsx'))) pass('„Ankündigungen“ ist in Navigation und Dashboard konsistent.'); else warn('Benennung „Ankündigungen“ ist nicht überall konsistent.');
if (/Mehr als ein Verein – eine Familie/.test(read('src/LiveDashboard.tsx'))) pass('Willkommens-Slogan ist eingebaut.'); else fail('Willkommens-Slogan fehlt.');
if (/is-matchday/.test(read('src/LiveDashboard.tsx')) && /Heute ist Spieltag/.test(read('src/LiveDashboard.tsx'))) pass('Matchday-Hero ist eingebaut.'); else fail('Matchday-Hero fehlt.');
if (/v1825-table-position/.test(read('src/LiveDashboard.tsx')) && /v1825-table-points/.test(read('src/LiveDashboard.tsx'))) pass('Dashboard-Tabelle nutzt Platz → Logo → Verein → Punkte.'); else fail('Tabellenreihenfolge entspricht nicht der Vorgabe.');
if (/11teamsports/.test(read('src/LiveDashboard.tsx')) && /clubshop\/tsu-ainet/.test(read('src/LiveDashboard.tsx'))) pass('Offizieller Clubshop ist verlinkt und gekennzeichnet.'); else fail('Clubshop-Verlinkung oder Kennzeichnung fehlt.');
if (exists('public/tsu-ainet-hero.svg')) pass('Fallback-Hero-Bild ist vorhanden.'); else fail('Fallback-Hero-Bild fehlt.');

const cssFiles = fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.css'));
const css = cssFiles.map((f) => read(`src/${f}`)).join('\n');
if (/safe-area-inset-bottom/.test(css)) pass('iPhone-Safe-Area wird berücksichtigt.'); else warn('Keine Safe-Area-Unterstützung gefunden.');
if (/min-height:\s*(44|46|48|50)px/.test(css)) pass('Touch-Ziele mit mindestens ca. 44 px sind vorhanden.'); else warn('Touch-Zielgrößen sollten manuell geprüft werden.');
if (/prefers-reduced-motion/.test(css)) pass('Reduzierte Bewegung wird unterstützt.'); else warn('prefers-reduced-motion fehlt.');

const navigationSource = read('src/BottomNav.tsx');
if (!/label:\s*[\"']Mehr[\"']/.test(navigationSource)) pass('Keine sichtbare alte Navigation „Mehr“ gefunden.'); else warn('Sichtbare Altbezeichnung „Mehr“ gefunden.');

for (const item of checks) {
  const icon = item.status === 'pass' ? '✓' : item.status === 'warn' ? '⚠' : '✗';
  console.log(`${icon} ${item.name}`);
}
const counts = checks.reduce((a, c) => (a[c.status]++, a), {pass:0,warn:0,fail:0});
console.log(`\nErgebnis: ${counts.pass} bestanden, ${counts.warn} Warnungen, ${counts.fail} Fehler.`);
fs.writeFileSync(path.join(root, 'RELEASE_UI_AUDIT_RESULT.txt'), checks.map(c => `${c.status.toUpperCase()}: ${c.name}`).join('\n') + `\n\nErgebnis: ${counts.pass} bestanden, ${counts.warn} Warnungen, ${counts.fail} Fehler.\n`);
if (counts.fail) process.exitCode = 1;
