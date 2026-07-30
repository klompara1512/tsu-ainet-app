# Version 7.5.1 – Kader-Workflow-Fix

- GitHub-Workflow heißt nun „Spiele, Tabellen und Kader nach Firestore übertragen“.
- Der ÖFB-Kaderimport ist verpflichtender Bestandteil des Sync-Laufs.
- Werden 0 Kaderspieler erkannt, schlägt der Workflow sichtbar fehl statt fälschlich erfolgreich zu sein.
- Diagnosewerte werden in `settings/kfvSyncStatus` gespeichert.
- Parser-Version: `7.5.1-squad-required`.
