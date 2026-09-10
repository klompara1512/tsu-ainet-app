TSU Ainet v1.0.40 – Spiele im Trainingsplaner nach Uhrzeit

Geändert:
- Mehrere Vollplatz-Spiele am selben Tag werden nicht mehr übereinander gelegt.
- Sie werden chronologisch nach Beginn untereinander im Spielfeld aufgelistet.
- Bei nur einem Vollplatz-Spiel bleibt die große Vollfeld-Darstellung erhalten.
- U10/U12-Halbplatzspiele werden ebenfalls nach Uhrzeit sortiert.
- Mobile Darstellung ist speziell berücksichtigt.

Dateien ersetzen:
src/TrainingPlanner.tsx
src/TrainingPlanner.css

Danach:
npm run build
firebase deploy --only hosting
