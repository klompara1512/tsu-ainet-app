TSU Ainet v1.0.31 – U10/U12 manuelle Ergebnisse als einzige Ergebnisquelle

GEÄNDERT:
- U10/U12 „Letzte Spiele“ verwendet ausschließlich Ergebnisse, die in der TSU-Ainet-App manuell gespeichert wurden (manualResultOverride=true).
- KFV/ÖFB-Ergebnisse werden für U10/U12 in Form und Mannschaftsstatistik ignoriert.
- Mannschaftsstatistik U10/U12 (Spiele, Siege, Remis, Niederlagen, Tore usw.) basiert ausschließlich auf manuellen App-Ergebnissen.
- Im einfachen U10/U12-Spielcenter wird ein KFV-Ergebnis nicht als App-Endstand angezeigt.
- Ergebnisfelder werden nicht mit einem KFV-Ergebnis vorbelegt.
- Der offizielle Spielbericht-Link bleibt erhalten.
- Der Buildfehler „Cannot find name lastFive“ ist beseitigt.
- KM, Challenge und U17 behalten ihre bisherige Ergebnislogik.

DATEIEN ERSETZEN:
src/kfvLive.tsx
src/Teams.tsx
src/kfvFirestore.ts

PRÜFUNG:
TypeScript (tsc -b): erfolgreich / 0 Fehler.

Danach lokal:
npm run build
firebase deploy --only hosting
