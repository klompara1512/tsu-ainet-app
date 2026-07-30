# Version 3.6 – KFV-Synchronisierung ohne Blaze

## Funktionsweise

- GitHub Actions ruft alle 30 Minuten ausschließlich öffentliche KFV-HTTPS-Seiten auf.
- Der Import schreibt Spiele, Ergebnisse und Tabellen in Firestore.
- Die Webapp liest die Daten live aus Firestore.
- Bei einem Fehler bleiben die zuletzt erfolgreich gespeicherten Daten erhalten.
- Firebase Cloud Functions und Cloud Scheduler werden nicht benötigt.

## Einmalige Einrichtung

1. Projekt in ein privates oder öffentliches GitHub-Repository hochladen.
2. In Firebase Console → Projekteinstellungen → Dienstkonten einen privaten Schlüssel erzeugen.
3. Den vollständigen JSON-Inhalt in GitHub unter Settings → Secrets and variables → Actions als Secret `FIREBASE_SERVICE_ACCOUNT` speichern.
4. GitHub Actions aktivieren.
5. Unter Actions → KFV-Daten synchronisieren einmal „Run workflow“ ausführen.

## Deployment

```bash
npm install
npm run build
firebase deploy --only hosting,firestore:rules
```

Wichtig: Die Service-Account-JSON niemals als Datei in das Repository legen.
