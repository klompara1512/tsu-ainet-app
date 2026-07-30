# GitHub Action für KFV-Sync anlegen

Falls der versteckte Ordner `.github` beim Browser-Upload nicht übernommen wird:

1. Im GitHub-Repository oben auf **Actions** klicken.
2. Auf **set up a workflow yourself** klicken.
3. Den Dateinamen oben auf `kfv-sync.yml` ändern.
4. Den gesamten Beispielinhalt löschen.
5. Den Inhalt der Datei `GITHUB_ACTION_EINRICHTUNG/kfv-sync.yml` vollständig einfügen.
6. Rechts oben auf **Commit changes...** klicken.
7. Commit bestätigen.
8. Danach unter **Actions** den Workflow **KFV-Daten synchronisieren** öffnen.
9. **Run workflow** anklicken und den Branch `main` starten.

Die Datei wird von GitHub automatisch unter `.github/workflows/kfv-sync.yml` gespeichert.
