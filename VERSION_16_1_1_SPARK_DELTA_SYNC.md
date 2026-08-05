# Version 16.1.1 – Spark Delta Sync

## Zeitplan

- Tabellen: Freitag, Samstag, Sonntag und österreichische gesetzliche Feiertage alle 30 Minuten.
- Spielpläne und Ergebnisse: täglich um 06:00, 12:00 und 18:00 Uhr (Europe/Vienna).
- Kader: tägliche Quellenprüfung; Firestore wird nur beschrieben, wenn sich ein Spieler geändert hat, neu ist oder nicht mehr im offiziellen Kader vorkommt.
- Spielberichte: weiterhin nur im Spielzeitfenster ab 60 Minuten vor Anstoß bis fünf Stunden nach Anstoß.

## Spark-Optimierung

- Unveränderte Tabellenzeilen werden nicht mehr geschrieben.
- Vorhandene Tabellenlogos bleiben erhalten, falls die Quelle kurzfristig kein Logo liefert.
- Der Kaderbestand wird pro Lauf nur einmal aus Firestore gelesen und anschließend pro Mannschaft aus dem Speicher gefiltert.
- Unveränderte Kaderspieler werden nicht mehr geschrieben.
- Bereits korrekt deaktivierte alte Kaderspieler werden nicht erneut geschrieben.
- Die Sync-Statusdokumente zeigen geänderte und übersprungene Datensätze getrennt an.
