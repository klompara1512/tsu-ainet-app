# Architektur der TSU-Ainet-App

## Bereiche

- `src/`: React/PWA-Oberfläche, Rollen und Firestore-Abonnements
- `scripts/kfv-sync.cjs`: serverseitiger ÖFB-/KFV-Import über GitHub Actions
- `config/kfv-sync.config.json`: Saison, Mannschaften, Quellseiten und Sync-Intervall
- `.github/workflows/kfv-sync.yml`: einzige produktive Workflow-Datei
- `firestore.rules`: Zugriffsregeln

## Datenfluss

1. GitHub Actions startet planmäßig oder manuell.
2. Das Sync-Script liest die zentrale Konfiguration.
3. Öffentliche ÖFB-/KFV-Seiten werden verarbeitet.
4. Spiele, Tabellen, Kader und Logos werden in Firestore aktualisiert.
5. `settings/kfvSyncStatus` und `kfvSyncRuns` liefern Status und Historie für das Admin Sync Center.

## Grundregeln

- Geheimnisse liegen ausschließlich in GitHub Secrets oder lokaler `.env`.
- Die Workflow-Datei unter `.github/workflows/` ist die einzige produktive Quelle.
- Mannschaften und Saison werden zentral in `config/kfv-sync.config.json` gepflegt.
- Vor Push: `npm run sync:check` und `npm run build`.
