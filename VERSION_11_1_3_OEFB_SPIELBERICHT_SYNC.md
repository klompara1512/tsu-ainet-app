# Version 11.1.3 – ÖFB-Spielbericht-Sync

Der Sync besucht offizielle ÖFB-Spielberichte und speichert veröffentlichte Aufstellungen und Ereignisse in `kfvMatchReports/{matchId}`. Die Webapp zeigt diese Daten in den Tabs Aufstellungen und Liveticker.

## Firestore

Die Collection `kfvMatchReports` ist öffentlich lesbar und ausschließlich durch den serverseitigen GitHub-Sync beschreibbar.

## Test

1. `npm run sync:check`
2. GitHub Workflow starten
3. Firestore `kfvMatchReports` prüfen
4. Spielcenter öffnen und Aufstellungen/Liveticker testen
