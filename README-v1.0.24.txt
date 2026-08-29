TSU Ainet v1.0.24 – Trainingsplaner Desktop-Layout

Geändert:
- Auf PC (ab 1000 px Breite) stehen Hauptfeld und Trainingsplatz nebeneinander.
- Beide Karten nutzen je 50 % der verfügbaren Breite.
- Das gezeichnete Spielfeld verwendet ungefähr das echte Fußballfeld-Seitenverhältnis 105:68.
- Dadurch werden die Felder nicht mehr extrem langgezogen.
- Oben/Unten, Buchungen, Flutlicht, + Training und Ganzen Platz buchen bleiben vollständig erhalten.
- Auf Smartphone und Tablet bleibt die bisherige Darstellung untereinander unverändert.

Einspielen:
1. src/TrainingPlanner.css ersetzen.
2. npm run build
3. Bei 0 Fehlern: firebase deploy --only hosting

Es wurde nur das Layout/CSS geändert – keine Trainings- oder Buchungslogik.
