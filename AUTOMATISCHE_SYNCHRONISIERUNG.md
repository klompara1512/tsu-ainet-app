# Automatische ÖFB-/KFV-Synchronisierung

Die Datei `.github/workflows/kfv-sync.yml` startet den Import automatisch alle 30 Minuten und kann zusätzlich in GitHub unter **Actions** manuell ausgeführt werden.

## Erforderliches GitHub-Secret

Unter **GitHub → Repository → Settings → Secrets and variables → Actions** muss das Secret

`FIREBASE_SERVICE_ACCOUNT`

vorhanden sein. Als Inhalt wird der vollständige JSON-Inhalt des Firebase-Service-Accounts eingefügt.

## Manuell testen

1. Repository auf GitHub öffnen.
2. **Actions** auswählen.
3. **ÖFB-Daten automatisch synchronisieren** öffnen.
4. **Run workflow** anklicken.
5. Nach dem grünen Haken Firestore prüfen.

## Zeitplan

Der automatische Lauf erfolgt alle 30 Minuten. GitHub kann geplante Läufe bei hoher Auslastung gelegentlich einige Minuten verzögern.
