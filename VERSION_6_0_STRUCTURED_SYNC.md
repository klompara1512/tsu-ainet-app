# Version 6.0 – strukturierte ÖFB-Synchronisierung

- Anstoßzeiten wie 17:00, 18:30 und 19:00 werden nicht mehr als Ergebnis importiert.
- Ergebnisse werden nur aus strukturierten Ergebnisfeldern, Tabellenzellen oder ÖFB-API-Daten gelesen.
- Eine zusätzliche Plausibilitätsprüfung vergleicht Resultate mit der Anstoßzeit.
- Mannschaftsseiten werden automatisch von der offiziellen TSU-Ainet-Seite entdeckt.
- Unterstützt KM, Challenge/Reserve, U17, U12, U10 und U8 inklusive Tabellen, sofern vom ÖFB veröffentlicht.
- Firestore-Diagnose enthält getrennte Zähler für Spiele und Tabellen je Mannschaft.

Nach dem Hochladen den GitHub-Workflow einmal manuell ausführen. Bereits falsch importierte Datensätze werden beim neuen Lauf überschrieben oder deaktiviert.
