TSU Ainet v1.0.39 – Mobile Trainings- & Spielplaner Fix

Geändert:
- Automatische Vollplatz-Heimspiele liegen auf Smartphones wieder korrekt über dem gesamten Spielfeld.
- Ursache behoben: position: relative hatte die absolute Spielfeld-Positionierung überschrieben.
- U10/U12 bleiben sauber in ihrer vorgesehenen Platzhälfte.
- Spielkarten bleiben innerhalb des Spielfeldes und laufen mobil nicht mehr aus dem Layout.

Datei ersetzen:
src/TrainingPlanner.css

Danach:
npm run build
firebase deploy --only hosting
