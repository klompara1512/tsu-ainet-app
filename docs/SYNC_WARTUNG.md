# Sync-Wartung

## Saison oder Mannschaft ändern

Nur `config/kfv-sync.config.json` bearbeiten. Danach:

```powershell
npm run sync:check
git add .
git commit -m "Sync-Konfiguration aktualisiert"
git push origin main
```

## Workflow

Die produktive Datei ist `.github/workflows/kfv-sync.yml`. Die Dateien im Ordner `GITHUB_ACTION_EINRICHTUNG` dienen nur noch als historische Anleitung und dürfen nicht als zweite produktive Quelle behandelt werden.

## Lokale Prüfungen

```powershell
npm run sync:check
npm run build
```
