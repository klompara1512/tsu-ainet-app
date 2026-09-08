TSU Ainet v1.0.32 – Trainings- & Spielplaner

NEU
- „Trainingsplaner“ heißt jetzt „Trainings- & Spielplaner“.
- Untertitel: „Trainings & Heimspiele“.
- Heimspiele werden automatisch aus dem bestehenden TSU-Ainet-Spielplan geladen.
- Es werden KEINE zusätzlichen Spiel-Buchungen in Firestore gespeichert.
- Ändert sich ein Spieltermin im Spielplan, ändert sich die Platzbelegung automatisch mit.
- Auswärtsspiele belegen keinen Platz.
- Abgesagte oder verschobene Spiele werden nicht als Platzbelegung angezeigt.

PLATZLOGIK
- U10-Heimspiel: Hauptfeld · Oben
- U12-Heimspiel: Hauptfeld · Oben
- U8, U17, Challenge, KM: Hauptfeld · Ganzer Platz

ZEITRAUM DER AUTOMATISCHEN SPIELBELEGUNG
- U10: ab Anstoß für 60 Minuten
- U12: ab Anstoß für 70 Minuten
- U8: ab Anstoß für 70 Minuten
- U17 / Challenge / KM: ab Anstoß für 115 Minuten

DARSTELLUNG
- Automatische Spiele sind mit „⚽ Heimspiel“ und Gegner gekennzeichnet.
- Sie verwenden weiterhin die jeweilige Mannschaftsfarbe.
- Sie erscheinen direkt auf dem Spielfeld und in der Wochenzusammenfassung.
- Automatische Spiele können im Platzplan nicht bearbeitet oder gelöscht werden.
- Trainings bleiben weiterhin normal bearbeitbar.

DOPPELBELEGUNG
- Automatische Heimspiele zählen als echte Platzbelegung.
- Ein Training kann nicht in eine bereits durch ein Heimspiel belegte Fläche/Zeit gespeichert werden.
- U10/U12 blockieren dabei nur „Oben“; „Unten“ bleibt für ein Training verfügbar.

MIT ENTHALTEN
- v1.0.31: U10/U12 „Letzte Spiele“ und Statistik nur aus manuell in der TSU-Ainet-App eingetragenen Ergebnissen.
- Spielbericht-Link bleibt bei U10/U12 erhalten.

GEÄNDERTE DATEIEN
- src/TrainingPlanner.tsx
- src/TrainingPlanner.css
- src/Dashboard.tsx
- src/kfvLive.tsx
- src/Teams.tsx
- src/kfvFirestore.ts

PRÜFUNG
- TypeScript: tsc -b erfolgreich, 0 Fehler.
- Der Vite-Bundle-Schritt konnte in der Linux-Testumgebung wegen des im Windows-node_modules fehlenden nativen Linux-Rolldown-Bindings nicht ausgeführt werden. Das ist kein TypeScript-Fehler.

EINSPIELEN
1. Alle enthaltenen src-Dateien ersetzen.
2. npm run build
3. Wenn 0 Fehler: firebase deploy --only hosting

Kein Firestore-Rules-Deploy nötig.
