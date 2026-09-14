TSU Ainet v1.0.43 – GitHub-Workflow Stabilität / Free-Optimierung

Behoben:
1) Smart-Synchronisierung
   - Firestore über REST statt gRPC auf GitHub Hosted Runnern.
   - Firestore-Lesezugriffe mit Retry.
   - Node.js 24 + actions/checkout@v5 + actions/setup-node@v5.
   - Weniger Cron-Runs zur Schonung der kostenlosen GitHub-Minuten.

2) KFV / ÖFB Spielberichte
   - Firestore REST aktiviert.
   - Ein einmaliger Retry bei fehlgeschlagenem Spielbericht-Sync.
   - Puppeteer-Browsercache für schnellere Runs.
   - Der separate Workflow ist nur noch manuell startbar.
     Automatisch wird der Bericht-Sync von der Smart-Synchronisierung ausgeführt.
     Dadurch entstehen keine doppelten täglichen GitHub-Runs.

3) Nachwuchs-Training Erinnerung
   - Firestore REST aktiviert.
   - Teams, Trainings, Trainer und Push-Tokens mit Retry.
   - FCM-Versand mit Retry.
   - Service-Account wird vor dem eigentlichen Lauf geprüft.

Zusätzlich:
- FIREBASE_SERVICE_ACCOUNT wird in allen 3 Workflows auf gültiges JSON und Pflichtfelder geprüft.
- IPv4 wird für Node bevorzugt.
- Node-20-Warnung wird durch Node 24 / aktuelle Actions beseitigt.

Dateien ersetzen:
.github/workflows/smart-sync.yml
.github/workflows/kfv-report-news-sync.yml
.github/workflows/training-week-reminder.yml
scripts/smart-sync-gate.cjs
scripts/training-week-reminder.cjs
scripts/kfv-report-news-sync.cjs
scripts/auto-result-news.cjs

Prüfung:
npm run sync:check -> erfolgreich.

Danach:
git add .
git commit -m "v1.0.43 Workflow Stabilitaet"
git push

Kein Firebase Hosting Deploy notwendig, da nur GitHub-Workflows und Sync-Skripte geändert wurden.

Testen:
GitHub -> Actions
1. TSU Ainet Smart-Synchronisierung -> Run workflow
2. KFV / ÖFB Spielberichte... -> Run workflow
3. Nachwuchs-Training Erinnerung -> Run workflow
