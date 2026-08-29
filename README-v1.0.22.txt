TSU Ainet v1.0.22 – Build Fix nach Hero/Matchday-Wiederherstellung

Behoben:
1. TS6133 in Dashboard.tsx
   - nicht mehr benötigte Variable hasInternalAccess entfernt.

2. TS2304 in LiveDashboard.tsx
   - fehlenden Import von AutoFitLogo ergänzt.

Unverändert erhalten:
- Hero-Hintergrundbild
- MATCHDAY und mehrere Spiele am Spieltag
- "Unsere Farben. Unser Stolz."
- Vereinsinfo führt wirklich zur Vereinsinfo
- Spielergebnis-eintragen-Kachel
- Trainer-Ergebniseingabe
- manuelle Ergebnisse und Statistik
- U8/U10/U12 ohne Tabellen

Dateien ersetzen:
- src/Dashboard.tsx
- src/LiveDashboard.tsx

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting
