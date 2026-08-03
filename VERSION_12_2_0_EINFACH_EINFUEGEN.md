# Version 12.2.0 – vollständige Einfüge-ZIP

Diese ZIP enthält das komplette Projekt. Es müssen keine einzelnen Dateien gesucht werden.

## Einfügen

1. ZIP entpacken.
2. Den gesamten Inhalt in dein bestehendes GitHub-Projekt hochladen.
3. Vorhandene Dateien ersetzen lassen.
4. Den Ordner `.github` unbedingt mit hochladen.
5. In GitHub unter **Actions** den Workflow **KFV / ÖFB Daten synchronisieren** einmal manuell starten.

Der bereits in GitHub gespeicherte Secret `FIREBASE_SERVICE_ACCOUNT` bleibt unverändert erhalten.

## Synchronisierung

- läuft automatisch zweimal pro Stunde
- Spiele und Tabellen werden ausschließlich den konfigurierten offiziellen Mannschaftsseiten zugeordnet
- Tabellen werden nur ersetzt, wenn TSU Ainet enthalten ist und die Rangfolge plausibel ist
- Logos werden aus offiziellen ÖFB-/KFV-Spiel-, Tabellen- und Vereinsseiten übernommen
- bei unvollständigen Daten bleiben bestehende korrekte Firestore-Daten erhalten
