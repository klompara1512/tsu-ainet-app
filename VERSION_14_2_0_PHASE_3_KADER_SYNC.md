# Version 14.2.0 – Phase 3 Kader-Sync

Phase 3 trennt die offiziellen ÖFB-Kader vom schnellen Core-Sync und vom Club-Sync.

## Mannschaften

- Kampfmannschaft
- Challenge
- U17
- U12
- U10
- U8

## Übernommene Daten

- Name
- Rückennummer
- Position
- Spielerfoto
- Profil-Link
- ÖFB-Spieler-ID
- Geburtsdatum/Jahrgang, sofern öffentlich
- Mannschaftszuordnung

## Sicherheit

- Ein leerer oder fehlerhafter Mannschaftsimport löscht keinen bestehenden Kader.
- Spieler werden nur für eine Mannschaft deaktiviert, wenn deren neuer Kader erfolgreich erkannt wurde.
- Manuelle Änderungen mit `manualOverride: true` bleiben erhalten.
- Bereits vorhandene Fotos bleiben erhalten, wenn eine Seite zeitweise kein Foto liefert.

## Workflow

`KFV / ÖFB Kader synchronisieren` läuft täglich um 03:40 UTC und kann manuell gestartet werden.

Status: `settings/kfvSquadSyncStatus`
