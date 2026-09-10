TSU Ainet v1.0.41 – Bis zu 4 Spiele am selben Tag sichtbar

Geändert:
- Wenn mehrere Spiele am selben Tag stattfinden, werden ALLE Spiele gemeinsam nach Anstoßzeit sortiert angezeigt.
- Frühestes Spiel oben, spätestes unten.
- Auch 4 Spiele am selben Tag passen vollständig sichtbar auf das Spielfeld.
- U10/U12-Spiele werden bei mehreren Spielen nicht mehr hinter Vollplatz-Spielen verdeckt.
- Beispiel 10.10.2026: alle Spiele werden chronologisch aufgelistet.

Dateien ersetzen:
src/TrainingPlanner.tsx
src/TrainingPlanner.css

Danach:
npm run build
firebase deploy --only hosting
