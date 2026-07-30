# Version 6.5.1 – Logo-Import über Vereinsseiten

## Änderung

Der Synchronisierungsworkflow besucht zusätzlich erkannte offizielle Vereinsseiten von ÖFB/KFV und liest dort das Vereinslogo aus.

Die Logos werden anschließend in folgende Felder übernommen:

- `kfvMatches.homeLogoUrl`
- `kfvMatches.awayLogoUrl`
- `kfvStandings.teamLogoUrl`

Zusätzlich wird die Collection `kfvClubs` als zentraler Logo-Cache angelegt. Ein Eintrag enthält unter anderem:

- `name`
- `normalizedName`
- `logoUrl`
- `pageUrl`
- `oefbClubId`

## Vorgehen nach dem Upload

1. Den vollständigen Inhalt der ZIP-Datei in das GitHub-Repository übernehmen.
2. Unter **Actions** den Workflow **ÖFB-Daten automatisch synchronisieren** starten.
3. Nach erfolgreichem Lauf in Firestore einen Datensatz in `kfvMatches` und `kfvStandings` prüfen.
4. `homeLogoUrl`, `awayLogoUrl` beziehungsweise `teamLogoUrl` dürfen nun eine HTTPS-Adresse enthalten.
5. In `settings/kfvSyncStatus` zeigt `clubLogoCount`, wie viele Logo-Profile gefunden wurden.

Fehlt ein Logo auf der offiziellen Seite, bleibt das Feld leer und die App zeigt weiterhin die Initialen als Ersatz.
