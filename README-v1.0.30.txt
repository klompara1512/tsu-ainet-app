TSU Ainet v1.0.30

U10/U12 Spielcenter bleibt einfach:
- Heim/Auswärts
- Gegner
- Datum/Uhrzeit
- Ergebnis eintragen

Wieder zusätzlich enthalten:
- Spielbericht öffnen (externer offizieller Link, sofern vorhanden)
- kompakte Statistik „Letzte Spiele“ mit Datum, Gegner, Ergebnis und S/U/N

Weiterhin NICHT enthalten:
- Aufstellungen
- Schiedsrichter
- Tabellenplatz
- große Übersichts-/Detailkarten
- Route
- unnötige Spielcenter-Reiter

Datei ersetzen:
src/kfvLive.tsx

Danach:
npm run build
firebase deploy --only hosting
