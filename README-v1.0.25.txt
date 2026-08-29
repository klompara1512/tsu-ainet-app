TSU Ainet v1.0.25 – Mannschaftsfarben im Trainingsplaner

Automatische Farben:
- KM = Blau
- U17 = Violett
- U12 = Gelb
- U10 = Rot
- U8 = Orange

Die Farbe wird automatisch anhand der Mannschaft vergeben.
Der Trainer muss keine Farbe auswählen.

Die Farblogik gilt für:
- Trainingseinträge direkt auf dem Spielfeld
- Buchungen für den ganzen Platz
- Wochenzusammenfassung
- Farblegende oberhalb der Spielfelder

Lesbarkeit:
- KM/U17/U10/U8: weiße Schrift
- U12: dunkle Schrift auf gelbem Hintergrund
- Platzsperren bleiben grau
- andere/nicht erkannte Teams bleiben neutral

Enthält weiterhin den v1.0.24 Desktop-Fix:
- Hauptfeld und Trainingsplatz ab 1000 px nebeneinander
- natürliche Spielfeld-Proportionen
- Mobile/Tablet untereinander

Dateien ersetzen:
- src/TrainingPlanner.tsx
- src/TrainingPlanner.css

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting
