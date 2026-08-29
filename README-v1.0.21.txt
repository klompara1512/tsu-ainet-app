TSU Ainet v1.0.21 – HERO / MATCHDAY / VEREINSINFO FIX

Wiederhergestellt:
- Großer Hero-Bereich auf der Startseite.
- Verwaltete Hintergrundbilder aus Firestore "visualAssets".
- Automatischer Bildwechsel bei mehreren Hero-Bildern.
- "Willkommen bei der TSU Ainet"
- "Since 1966"
- "Unsere Farben. Unser Stolz."
- MATCHDAY-Schriftzug am Spieltag.
- Bei mehreren Spielen am selben Tag wieder die komplette Matchday-Übersicht,
  nach Anstoßzeit sortiert und jedes Spiel direkt antippbar.

Beibehalten:
- Manuelle Spielergebnisse und Statistik-Aktualisierung.
- Trainer-Ergebniseingabe.
- Sichtbare Kachel "Spielergebnis eintragen" im Bereich Verein.
- U8/U10/U12 ohne Tabellen.
- Kalender-kompatible Vereinslogos.

Zusätzlich behoben:
- "Vereinsinfo" auf dem Hauptdashboard führt jetzt wirklich zu Vereinsinfo.
- Die Vereinsinfo-Kachel im Bereich Verein ist ebenfalls korrekt verlinkt.
- Vereinsinfo ist als öffentliche Vereinsseite erreichbar und führt nicht mehr zu Spiele/Termine.

Dateien ersetzen:
- src/LiveDashboard.tsx
- src/LiveDashboard.css
- src/Dashboard.tsx

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting
