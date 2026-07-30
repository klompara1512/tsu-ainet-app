# Version 4.2 – ÖFB Browser- und Netzwerkimport

Ausgangspunkt ist die vollständige Version 3.8.

- Öffnet die offiziellen ÖFB-Seiten mit Chromium/Puppeteer.
- wertet den fertig gerenderten DOM aus.
- erfasst zusätzlich öffentliche JSON-/Text-Netzwerkantworten der ÖFB-Seite.
- schreibt Spiele nach `kfvMatches` und Tabellen nach `kfvStandings`.
- speichert eine ausführliche Browser-/Netzwerkdiagnose in `settings/kfvSyncStatus`.
- synchronisiert über GitHub Actions alle 30 Minuten.
