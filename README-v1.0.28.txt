TSU Ainet v1.0.28 – NEWS + LOKALE BILDER

Geändert:
- „Ankündigungen“ heißt in der App jetzt „News“.
- Bottom-Navigation: News statt Ankündigungen.
- Administration: News verwalten.
- Öffentliche Seite: News.
- News-Editor: lokale Bilder direkt von Handy/PC auswählen.
- Keine Bild-URL mehr nötig und kein Link-Feld mehr vorhanden.
- Bilder werden im Browser automatisch auf max. ca. 1400×1000 px verkleinert und als JPEG komprimiert.
- Zielgröße deutlich unter dem Firestore-Dokumentlimit.
- Kein Firebase Storage und keine zusätzlichen Storage-Regeln erforderlich.
- Bild kann vor dem Speichern wieder entfernt oder ersetzt werden.
- Feld „Beitrag“ vollständig entfernt.
- Das Feld „Zusammenfassung“ heißt nun „Text“ und ist der vollständige News-Text.
- Bestehende alte News mit content-Feld bleiben lesbar.
- Beim Speichern wird der Text zusätzlich in content gespiegelt, damit ältere App-Versionen nicht kaputtgehen.

Dateien ersetzen:
- src/NewsAdmin.tsx
- src/NewsAdmin.css
- src/News.tsx
- src/News.css
- src/BottomNav.tsx
- src/BottomNav.css
- src/Dashboard.tsx
- src/LiveDashboard.tsx

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting

Kein Firestore-/Storage-Regel-Deploy notwendig.
