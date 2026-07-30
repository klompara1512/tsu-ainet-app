# GitHub-Workflow direkt im Browser anlegen

1. GitHub-Repository öffnen.
2. `Actions` anklicken.
3. `set up a workflow yourself` wählen.
4. Dateiname oben auf `kfv-sync.yml` ändern.
5. Den gesamten Inhalt aus `KFV_WORKFLOW_ZUM_KOPIEREN.yml` in das große Editor-Feld kopieren.
6. Rechts oben `Commit changes...` anklicken.
7. Commit-Nachricht: `KFV Sync Workflow hinzufügen`.
8. `Commit changes` bestätigen.
9. Danach `Actions` öffnen.
10. Links `KFV-Daten synchronisieren` anklicken.
11. Rechts `Run workflow` wählen und mit Branch `main` starten.

Voraussetzung: Repository-Secret `FIREBASE_SERVICE_ACCOUNT` ist bereits angelegt.
