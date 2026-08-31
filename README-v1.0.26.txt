TSU Ainet v1.0.26 – Trainingsplaner Speichern-Fix

Ursache:
Die bisherige Version wollte neben trainingBookings zusätzlich Hilfsdokumente für
die 15-Minuten-Slots schreiben. Diese zusätzliche Schreiboperation kann von den
aktuell veröffentlichten Firestore-Regeln blockiert werden; dadurch wurde die
gesamte Buchung abgebrochen.

Fix:
- Trainings werden nur noch in der bestehenden Sammlung trainingBookings gespeichert.
- Keine zusätzliche Hilfssammlung mehr notwendig.
- Doppelbelegungsprüfung bleibt vollständig erhalten.
- Ganzer Platz kollidiert mit beiden Hälften.
- Oben und Unten können parallel gebucht werden.
- Eigene Buchung wird beim Bearbeiten nicht als Konflikt erkannt.
- Löschen läuft ebenfalls direkt über trainingBookings.
- Verständlichere Fehleranzeige bei Berechtigungs- oder Netzwerkfehlern.

Weiterhin enthalten:
- KM blau, U17 violett, U12 gelb, U10 rot, U8 orange
- Desktop: beide Spielfelder nebeneinander
- Mobile: Spielfelder untereinander
- Wiederholende Trainings
- Flutlicht / ganze Fläche / Platzhälften
- Trainer-Auswahl nur für zugeordnete Mannschaften

Ersetzen:
- src/TrainingPlanner.tsx
- src/TrainingPlanner.css

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting

Für diesen Fix ist kein Firestore-Rules-Deploy nötig.
