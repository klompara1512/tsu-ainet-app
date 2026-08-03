# Version 14.1.0 – Phase 2 Club Sync

Phase 2 trennt Vereinsdaten und Logos vom schnellen Core-Sync.

## Automatischer Ablauf

Der Workflow `KFV / ÖFB Vereinsdaten synchronisieren` läuft täglich um 03:20 Uhr österreichischer Zeit (GitHub-Cron 02:20 UTC im Sommer kann abweichen) und kann zusätzlich manuell gestartet werden.

## Synchronisierte Daten

- eindeutige Vereins-ID
- offizieller Vereinsname
- Vereinslogo
- offizielle Vereinsseite
- Stadion, soweit öffentlich erkennbar
- Namensvarianten/Aliase

Die Quellen werden aus den vorhandenen Spielen und Tabellen sowie aus `clubSeedUrls` gesammelt. Bestehende Logos bleiben erhalten, wenn eine Seite vorübergehend kein Bild liefert. Ein TSU-Ainet-Logo wird bei fremden Vereinen automatisch verworfen.

## Firestore

- Daten: `kfvClubs`
- Status: `settings/kfvClubSyncStatus`

Wichtige Statusfelder:

- `success`
- `clubCount`
- `clubLogoCount`
- `sourceCount`
- `diagnostics`
