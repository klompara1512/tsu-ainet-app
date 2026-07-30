# Version 7.3 – Öffentliche Spiele und Tabellen

## Neu
- Spiele, Ergebnisse und Tabellen können ohne Benutzerkonto geöffnet werden.
- Auf der Anmeldeseite gibt es den neuen Button „Spiele & Tabellen ohne Anmeldung“.
- Öffentlicher Bereich mit Vereinskopf und Rückkehr zur Anmeldung.
- Firestore-Leserechte für `kfvMatches`, `kfvStandings`, `kfvClubs` und `syncStatus` sind öffentlich.
- Interne Inhalte wie Trainings, Aufgaben, Dokumente, Benutzer und Verwaltung bleiben geschützt.

## Wichtig nach dem Upload
Die aktualisierten Firestore-Regeln müssen bereitgestellt werden:

```bash
firebase deploy --only firestore:rules
```

Danach sind die öffentlichen Spieldaten ohne Anmeldung abrufbar.
