# Version 17.2.2 – Logo Manager Phase 3

## Neu

- Logo-Dateien direkt vom Computer, Android oder iPhone auswählen.
- Unterstützt PNG, JPG und WebP bis maximal 2 MB.
- Upload in Firebase Storage unter `club-logos/{uid}/{verein}/...`.
- Download-URL und Storage-Pfad werden automatisch in `clubLogos` gespeichert.
- Bildvorschau vor dem Speichern.
- Vorhandene Uploads können ersetzt werden.
- Ersetzte oder endgültig gelöschte Upload-Dateien werden aus Storage entfernt.
- Direkte Logo-URLs bleiben weiterhin als Alternative möglich.

## Veröffentlichen

```bash
npm install
npm run build
firebase deploy --only firestore:rules,storage,hosting
```
