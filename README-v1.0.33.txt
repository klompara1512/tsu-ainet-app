TSU Ainet v1.0.33 – CSS Build-Fix

Behoben:
- In TrainingPlanner.css waren die Zeilenumbrüche der neuen Heimspiel-Styles versehentlich als sichtbare \n-Zeichen gespeichert.
- LightningCSS brach deshalb mit „Unexpected token Ident(\"n\")“ ab.
- Alle Escape-Reste wurden in echte Zeilenumbrüche umgewandelt.
- CSS-Klammerstruktur geprüft.

Unverändert erhalten:
- Trainings- & Spielplaner
- automatische Heimspiele
- U10/U12 Heimspiel nur obere Hälfte Hauptfeld
- Mannschaftsfarben
- Desktop: beide Plätze nebeneinander
- alle bisherigen Trainingsfunktionen

Ersetzen:
- src/TrainingPlanner.css

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting
