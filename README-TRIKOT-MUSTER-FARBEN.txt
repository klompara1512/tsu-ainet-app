TSU Ainet – Trikotsätze: Mustertrikot statt Fotos

Geändert:
- Foto-Upload bei Trikotsätzen vollständig entfernt.
- Jeder Trikotsatz wird als grafisches Mustertrikot dargestellt.
- Farben separat auswählbar für:
  • Trikot
  • Hose
  • Stutzen
  • Akzent/Kragen
- Farbpalette mit Schnellwahl plus freier Farbwähler.
- Vorschau aktualisiert sich sofort.
- Bestand (Oberteile, Hosen, Stutzen, Tubes), Team, Bezeichnung, Notiz und Aktiv-Status bleiben erhalten.
- Bestehende Datensätze ohne neue Farbfelder werden mit Blau/Weiß als Standard angezeigt und können anschließend gespeichert werden.
- Es werden keine Bilddateien mehr in Firestore gespeichert.

Dateien ersetzen:
- src/KitManager.tsx
- src/KitManager.css

Danach:
npm run build

Bei 0 Fehlern:
firebase deploy --only hosting
