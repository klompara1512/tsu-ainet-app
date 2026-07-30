# TSU Ainet App – Version 2: Spiel-Detailseite

Neu:
- KFV-Spielkarten sind anklickbar.
- Eigene Spiel-Detailseite innerhalb von KFV Live.
- Datum, Uhrzeit, Spielort und Bewerb.
- Google-Maps-Routenbutton.
- Tabellenplatz der TSU Ainet.
- Formkurve aus den letzten fünf abgeschlossenen Spielen.
- Link zum Spielbericht, sofern `reportUrl` befüllt ist.

Test:
1. `npm install`
2. `npm run dev`
3. KFV Live öffnen.
4. Auf das Spiel TSU Ainet – SV Rapid Lienz klicken.

Für die Formkurve müssen mehrere Dokumente in `kfvMatches` den Status `finished` sowie Ergebniswerte besitzen.
