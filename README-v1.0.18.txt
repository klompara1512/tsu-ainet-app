TSU Ainet v1.0.18 – Tabellenfunktion Nachwuchs entfernt

Änderungen:
- U8, U10 und U12 haben keine Tabellenfunktion mehr.
- Im Spiel- & Tabellenzentrum verschwindet bei U8/U10/U12 der Reiter „Tabellen“ vollständig.
- Bei diesen Teams heißt der Bereich nur noch „Spielzentrum“.
- Im Tabellen-Reiter können nur Kampfmannschaft, Challenge und U17 ausgewählt werden.
- Das Hauptdashboard bietet für Tabellen ebenfalls nur Kampfmannschaft, Challenge und U17 an.
- Die Mannschaftsseiten hatten bereits nur für KM/Challenge/U17 eine Tabelle; diese Logik bleibt erhalten.

Einspielen: src/kfvLive.tsx und src/LiveDashboard.tsx ersetzen.
Danach: npm run build
