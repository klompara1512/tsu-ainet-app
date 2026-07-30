# TSU Ainet App – Version 3.4

## Änderungen

- TypeScript-Buildfehler in `KfvOfficialWidgets.tsx` behoben.
- KFV-Live-Seite um eine echte Umschaltung zwischen Spielen und Tabellen ergänzt.
- Mannschaftsfilter für Kampfmannschaft, Challenge und Nachwuchsteams aktiviert.
- Firebase Hosting und PWA-Konfiguration aus Version 3.3 beibehalten.
- Firestore bleibt die zentrale Datenbank.
- Rollensystem aus Version 3.2 bleibt vollständig erhalten.

## Lokaler Start

```powershell
npm.cmd install
npm.cmd run dev
```

## Online veröffentlichen

```powershell
npm.cmd run build
firebase.cmd deploy --only hosting
```
