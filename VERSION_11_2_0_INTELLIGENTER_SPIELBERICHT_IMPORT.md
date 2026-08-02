# Version 11.2.0 – Intelligenter ÖFB-Spielbericht-Import

## Änderungen

- Offizielle Spielberichtseiten werden auch über die ÖFB-Spiel-ID automatisch aufgerufen, selbst wenn der Link auf der Mannschaftsseite nur dynamisch oder hinter einem Button verfügbar ist.
- Aufstellungen, Ersatzbank, Trainer, Schiedsrichter, Zuschauer und Spielereignisse werden weiterhin ausschließlich aus offiziell veröffentlichten Daten übernommen.
- Spielberichte werden über die stabile `matchUid` eindeutig dem richtigen Spiel zugeordnet.
- Bereits veröffentlichte Berichte bleiben erhalten, wenn eine ÖFB-Seite in einem späteren Lauf leer oder unvollständig geladen wird.
- Berichtsdaten erhalten Qualitäts- und Zählfelder (`dataQuality`, `lineupPlayerCount`, `benchPlayerCount`, `eventCount`).
- Das GitHub-Protokoll zeigt Anzahl der Berichte, Aufstellungen und Ereignisse getrennt an.
- Fehlende Berichtsdaten sind nur eine Warnung und blockieren Spiele, Tabellen, Logos oder Kader nicht.

## Prüfen

Nach dem GitHub-Sync in Firestore `kfvMatchReports` öffnen. Ein veröffentlichter Bericht soll Startelf, Bank und Ereignisse enthalten. Im Spielcenter werden diese Daten in den Tabs Aufstellungen und Liveticker angezeigt.
