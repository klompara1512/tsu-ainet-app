# Version 11.0.3 – Smart Sync Control

## Neu

- Der Admin kann den kostenlosen GitHub-Actions-Workflow direkt aus der App öffnen.
- Die App wartet anschließend auf einen neuen Firestore-Sync-Lauf und aktualisiert Status, Historie und Zähler automatisch.
- Fortschrittsanzeige für GitHub-Start, Spiele, Tabellen, Kader, Logos und Abschluss.
- Systemdiagnose für Internet, Firestore, GitHub-Konfiguration, Historie und Match-ID-Schema.
- Verständliche Fehler- und Statusmeldungen.
- Kein Firebase-Blaze-Plan und keine Cloud Functions erforderlich.

## Sicherheit

Die App speichert bewusst keinen GitHub-Token im Browser. Der Button öffnet direkt die GitHub-Workflow-Seite. Dort bestätigt ein angemeldeter Administrator den Lauf über `Run workflow`. Das ist die kostenlose und sichere Variante.
