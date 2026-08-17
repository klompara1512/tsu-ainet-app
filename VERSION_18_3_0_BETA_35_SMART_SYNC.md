# 18.3.0-beta.35 – Smart Sync / Free-Tier Strategie

- Ein zentraler `smart-sync.yml` ersetzt alle parallelen Zeitpläne.
- Alte Sync-Workflows bleiben als manuelle Reparatur-Workflows vorhanden.
- Spiele werden mindestens alle 8 Stunden, regulär ca. 4x täglich geprüft.
- KM/Challenge/U17 Tabellen: 1x täglich + am jeweiligen Spieltag dynamisch, rund um Anpfiff enger.
- Spielberichte/Aufstellungen/Schiedsrichter: 7 Tage vor bis 12h nach Spiel, rund um Anpfiff enger.
- Vereinsdaten/Logos und Kader: wöchentlich, bei Fehlern automatische Wiederholung im Wartungsfenster.
- Push-Warteschlange wird im Smart-Sync automatisch verarbeitet.
- Jeder wichtige Task hat einen automatischen zweiten Versuch bei transienten Fehlern.
- `settings/smartSyncStatus` enthält den letzten Gesamtstatus.
- Public-Fan-Daten für Spiele+Tabellen werden als kompakter `publicSnapshots/football` Snapshot veröffentlicht.
  Dadurch liest die Start-/Spiele-/Tabellenansicht nicht mehr bei jedem Fan komplette Collections.
- Snapshot wird nur neu geschrieben, wenn sich fachliche Inhalte geändert haben.
