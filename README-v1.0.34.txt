TSU Ainet v1.0.34 – Heimspiel Vollfeld + modernes Fußballsymbol

Geändert:
- U17/KM/Challenge/U8 Heimspiele mit area=full werden optisch über den gesamten Hauptplatz dargestellt.
- Die farbige Spielbelegung liegt als halbtransparente Vollfeld-Fläche über dem Spielfeld.
- U10 und U12 bleiben wie vereinbart nur auf der oberen Hälfte des Hauptfeldes.
- Das Emoji-Fußballsymbol wurde durch ein modernes SVG-Fußball-Icon ersetzt.
- Das moderne Icon erscheint bei Vollfeld-Spielen, Halbplatz-Spielen und in der Wochenzusammenfassung.
- Das alte kleine „SPIEL“-Label wurde entfernt.

Dateien ersetzen:
- src/TrainingPlanner.tsx
- src/TrainingPlanner.css

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting
