TSU Ainet v1.0.19 – sichtbare Ergebnis-Eingabe nach Spielende

Änderungen:
- Für berechtigte Trainer gibt es im Spielcenter einen eigenen sichtbaren Punkt „Spielergebnis eintragen“.
- Der Punkt ist bereits vor dem Spielende sichtbar, aber gesperrt und nicht anklickbar.
- Nach dem voraussichtlichen Spielende wird die Schaltfläche automatisch freigeschaltet.
- U17: 2 × 45 Minuten + Nachspielzeit; Freigabe konservativ ca. 115 Minuten nach Anstoß (inkl. Halbzeit/Nachspielzeit).
- U12: 3 × 20 Minuten; Freigabe ca. 70 Minuten nach Anstoß (inkl. Drittelpausen).
- U10: 4 × 12 Minuten; Freigabe ca. 60 Minuten nach Anstoß (inkl. Viertelpausen).
- Wenn der ÖFB-Status vorher bereits „Beendet“ meldet, ist die Eingabe sofort freigeschaltet.
- Trainer können weiterhin nur Ergebnisse ihrer zugeordneten Mannschaft bearbeiten.
- Admin/Sektionsleitung behalten die bisherigen Rechte.
- Bereits vorhandene Endstände können nach Freigabe korrigiert werden.
- Manuell gespeicherte Ergebnisse aktualisieren weiterhin Mannschaftsseite, letzte Ergebnisse und Statistik.

Einspielen:
1. src/kfvLive.tsx ersetzen.
2. npm run build
3. Wenn der Build sauber ist: firebase deploy --only hosting
