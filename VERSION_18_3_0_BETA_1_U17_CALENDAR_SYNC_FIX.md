# TSU Ainet App – U17 Kalender-Sync Fix

## Fehlerbild
Ein kommendes U17-Spiel kann auf der ÖFB-Spielseite sichtbar sein, aber im App-Kalender fehlen, wenn der Termin auf der dynamischen Spielkarte ohne Jahreszahl (z. B. `16.08. 10:00`) ausgegeben wird.

## Ursache
Der Browser-Snapshot verlangte bisher zwingend ein Datum mit Jahreszahl. Zusätzlich existierte `parseCompactVisibleMatches()` bereits als Kurzdatum-Fallback, wurde im Games-HTML-Pfad jedoch nicht aufgerufen.

## Korrektur
- Browser-Snapshot akzeptiert Datum mit und ohne Jahr.
- Fehlt das Jahr, wird es aus dem Saisonpfad `Saison-2026-27` abgeleitet.
- `parseCompactVisibleMatches()` wird für offizielle Spielseiten tatsächlich ausgeführt.
- U17-Konfiguration und Kalender-Teamfilter bleiben unverändert.

## Geprüft
`node --check scripts/kfv-sync.cjs` erfolgreich.
