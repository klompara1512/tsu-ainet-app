# TSU Ainet Web-App online stellen

Die App ist für Firebase Hosting vorbereitet und wird danach über HTTPS im Internet erreichbar.

## Einmalig installieren

Im Ordner `tsu_ainet_app_v3`:

```powershell
npm.cmd install
npm.cmd install -g firebase-tools
```

## Bei Firebase anmelden

```powershell
firebase login
```

Im Browser mit dem Google-Konto anmelden, das Zugriff auf das Firebase-Projekt `tsu-ainet-fussball` hat.

## App bauen und veröffentlichen

```powershell
npm.cmd run build
firebase deploy --only hosting
```

Am Ende zeigt Firebase die öffentliche Adresse, normalerweise:

```text
https://tsu-ainet-fussball.web.app
```

## Firestore-Regeln veröffentlichen

Erst prüfen, danach ausführen:

```powershell
firebase deploy --only firestore:rules
```

## Auf dem Smartphone installieren

### Android / Chrome
1. Öffentliche Adresse in Chrome öffnen.
2. Browsermenü öffnen.
3. `App installieren` oder `Zum Startbildschirm hinzufügen` wählen.

### iPhone / Safari
1. Öffentliche Adresse in Safari öffnen.
2. Teilen-Symbol drücken.
3. `Zum Home-Bildschirm` wählen.

## Spätere Updates

Nach jeder Änderung:

```powershell
npm.cmd run build
firebase deploy --only hosting
```
