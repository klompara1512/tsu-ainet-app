# Version 15.0.0 – Official Match Report Engine

Ersetzt `scripts/kfv-report-news-sync.cjs`.

## Neu
- ÖFB-Spielbericht-ID bleibt verbindlich.
- Der Tab „Aufstellung“ wird zuletzt geöffnet, damit die dynamischen Aufstellungsdaten beim Auslesen sichtbar bleiben.
- Heim-/Gast-Startelf und Heim-/Gast-Ersatzbank werden getrennt gespeichert.
- Rückennummer, Kapitän, Torwart-Markierung und Spielerprofil-Link werden übernommen, sofern im DOM vorhanden.
- Spieler werden je Bereich dedupliziert.
- Alte Felder `homeLineup` und `awayLineup` bleiben erhalten.
- Neue Felder: `homeBench`, `awayBench`.
- Diagnosefelder: `homeStarters`, `awayStarters`, `homeBenchPlayers`, `awayBenchPlayers`, `playerCandidateCount`.

## Prüfen
```bash
node --check scripts/kfv-report-news-sync.cjs
```

Danach den GitHub-Workflow „KFV / ÖFB Spielberichte und News synchronisieren“ starten.
