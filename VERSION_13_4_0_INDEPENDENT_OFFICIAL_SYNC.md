# Version 13.4.0 – Independent Official Sync

## Hauptänderungen

- Spielplan, Tabelle, Kader und Vereinslogos werden unabhängig voneinander synchronisiert.
- Ein leerer Spielplan blockiert nicht mehr Tabelle, Kader oder Logos.
- Adaptive Wartezeit und wiederholtes Scrollen für dynamische ÖFB-/KFV-Seiten.
- Eingebettete JSON-Zustände werden zusätzlich ausgewertet.
- Erweiterte `pageDiagnostics` mit DOM- und Extraktionszählern je URL.
- Leere Teilergebnisse überschreiben keine vorhandenen Firestore-Daten.

## Kontrolle

Nach dem GitHub-Workflow in `settings/kfvSyncStatus` prüfen:
`matchCount`, `standingCount`, `squadCount`, `clubLogoCount`, `teamSyncStatus` und `pageDiagnostics`.
