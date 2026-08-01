# Version 8.4.2 – Lokaler Vereinslogo-Cache

## Neu

- Lokale Vereinslogos werden vor Firestore- und ÖFB-URLs geladen.
- Für FC Dölsach ist der lokale Pfad `/logos/clubs/doelsach.png` vorbereitet.
- Wenn die lokale Datei fehlt oder defekt ist, probiert die App automatisch:
  1. zentrales Logo aus `kfvClubs`
  2. Logo aus `kfvMatches`
  3. neutrales Ersatzwappen
- Bilder werden mit `referrerPolicy="no-referrer"` geladen, damit externe ÖFB-Bilder zuverlässiger funktionieren.
- Dieselbe robuste Logo-Komponente wird auch in der Monatsansicht verwendet.

## Wichtig

Das offizielle Dölsach-Logo muss aus rechtlichen und technischen Gründen vom Projektbetreiber selbst als
`public/logos/clubs/doelsach.png` abgelegt werden, falls die ÖFB-URL auf dem Hosting nicht direkt lädt.
