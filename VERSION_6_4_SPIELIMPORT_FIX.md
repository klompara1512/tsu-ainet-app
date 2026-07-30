# Version 6.4 – Spielimport-Fix

## Ursache des Fehlers
Die aktuelle ÖFB-Seite zeigt Spieltermine häufig ohne Jahreszahl, zum Beispiel:

`So., 2.8., 17:00`

Der bisherige Parser erwartete an entscheidenden Stellen eine vollständige Jahreszahl. Daher wurden Tabellen erkannt, aber 0 Spiele importiert.

## Änderungen
- Termine ohne Jahreszahl werden aus der Saison-URL korrekt auf 2026 bzw. 2027 abgebildet.
- Sichtbare ÖFB-Spielblöcke werden zeilenweise ausgewertet.
- Uhrzeiten bleiben Uhrzeiten und werden nicht als Ergebnis gespeichert.
- Ergebnisse werden nur aus einem eigenen Ergebniswert wie `2 : 0` gelesen.
- Geplante Spiele ohne Resultat werden ebenfalls importiert.
- Ein Sync mit 0 erkannten Spielen bricht jetzt absichtlich ab, damit bestehende offizielle Spieldaten nicht deaktiviert werden.
- Parser-Version: `6.4.0-visible-match-blocks`

## GitHub
Den gesamten Inhalt dieses Ordners ins Repository hochladen und vorhandene Dateien ersetzen. Danach unter Actions den Workflow „ÖFB-Daten automatisch synchronisieren“ manuell starten.
