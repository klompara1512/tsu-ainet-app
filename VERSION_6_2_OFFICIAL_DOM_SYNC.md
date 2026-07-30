# Version 6.2 – offizieller ÖFB-DOM-Import

## Änderungen

- Spiele werden direkt aus den gerenderten ÖFB-Spielkarten gelesen.
- Ein Wert mit Doppelpunkt wird nur als Ergebnis übernommen, wenn das DOM-Element ausdrücklich als Ergebnis/Score/Endstand gekennzeichnet ist.
- Uhrzeiten wie 17:00, 18:30 und 19:00 werden niemals aus dem allgemeinen Kartentext als Ergebnis interpretiert.
- Mannschaftsnamen werden aus getrennten Team-/Vereinsfeldern gelesen.
- Tabellen werden direkt aus offiziellen HTML-Tabellen übernommen.
- Mannschaftsseiten werden dynamisch über die Vereinsseite entdeckt. Dadurch werden auch Challenge, U17, U12, U10 und U8 mit abweichenden ÖFB-Slugs berücksichtigt.
- Die automatische GitHub-Actions-Synchronisierung alle 30 Minuten bleibt aktiv.
- Parser-Version: 6.2.0-official-dom-no-guessing

## Nach dem Hochladen

1. Repository-Inhalt aktualisieren.
2. Unter GitHub Actions den Workflow „ÖFB-Daten automatisch synchronisieren“ einmal manuell starten.
3. Den Lauf öffnen und auf einen grünen Haken prüfen.
4. In Firestore unter `settings/kfvSyncStatus` die Felder `success`, `matchCount`, `standingCount`, `teamCounts` und `parserVersion` kontrollieren.
