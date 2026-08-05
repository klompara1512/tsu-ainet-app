# Version 17.3.0 – GitHub Status Monitor

## Neu

- GitHub-Actions-Status im Sync Center: Online, läuft, fehlgeschlagen oder überfällig
- Letzte Workflow-Ausführung mit Datum, Laufnummer, Versuch, Auslöser und Commit
- Direkter Button zum konkreten GitHub-Actions-Lauf
- Letzter Fehler wird im GitHub-Bereich angezeigt
- GitHub-Metadaten werden bei jedem Voll-Sync in `settings/kfvSyncStatus` und `kfvSyncRuns` gespeichert
- App-Version im Systemstatus wird dynamisch aus `APP_VERSION` gelesen
- Logo-Priorität aus Version 17.2.6 übernommen

## Veröffentlichen

```bash
npm install
npm run build
firebase deploy --only firestore:rules,hosting
```

Beim ersten GitHub-Lauf nach dem Update werden die neuen GitHub-Metadaten automatisch befüllt.
