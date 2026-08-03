# Version 12.0.0 – Core Reset

Diese Version trennt die neue offizielle ÖFB-Datenbasis vollständig von den alten, inkonsistenten Firestore-Dokumenten.

## Neue Collections

- `oefbV12Matches`
- `oefbV12Standings`

Dashboard, Kalender, Teams und Spielcenter lesen nur noch diese neue Datenbasis.

## Quellen

Jede Mannschaft wird ausschließlich über ihre fest konfigurierte `/Spiele`- und `/Tabellen`-Seite synchronisiert. Allgemeine Vereinsseiten und fremde Netzwerkantworten dürfen keine Spiel- oder Tabellendaten mehr einmischen.

## Wichtig

Nach Installation muss einmal der GitHub-Sync erfolgreich ausgeführt werden. Vorher sind die neuen Collections leer und die App zeigt bewusst keine alten V11-Daten an.
