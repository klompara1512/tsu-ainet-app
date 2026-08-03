# Version 13.3.1 – stabile Official-Sync-Basis

Diese Version korrigiert die Firestore-Leseschicht und gleicht sie vollständig mit der Datenstruktur des offiziellen KFV-/ÖFB-Synchronisierungsdienstes ab.

## Korrekturen

- Spiele lesen `homeClubId`, `awayClubId`, Club-URLs, Spielort, Schiedsrichter und Live-Link.
- Tabellen lesen `clubId` und `clubUrl` und können dadurch Logos ID-basiert auflösen.
- Kader werden getrennt nach KM, Challenge, U17, U12, U10 und U8 verarbeitet.
- Vereinslogos werden zuerst über die eindeutige Vereins-ID und erst danach über einen exakten normalisierten Namen gesucht.
- Fremde Vereine dürfen niemals das TSU-Ainet-Wappen als Fallback erhalten.
- Ein neuer Selbsttest prüft, ob alle sechs Mannschaften ihre festen offiziellen Quellen besitzen.

## Offizielle Quellen

Die URLs stehen zentral in `config/kfv-sync.config.json`. Künftige Saisonwechsel können dort durchgeführt werden, ohne die App-Komponenten zu verändern.
