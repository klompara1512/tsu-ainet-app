# Version 18.1.3 – Vorstand & Trainer

## Neu
- Öffentliche Vorstands- und Trainerkarten mit Foto, Funktion, Mannschaft, Telefon und E-Mail.
- Suche nach Name, Funktion und Mannschaft.
- Direkte Anruf- und E-Mail-Schaltflächen.
- Administration: „Vorstand verwalten“ und „Trainer verwalten“.
- Hinzufügen, Bearbeiten, Löschen, Ein-/Ausblenden und Reihenfolge ändern.
- Foto-Upload oder Foto-URL; Bilder werden Spark-kompatibel in Firestore gespeichert.
- Datenschutzschalter für öffentliche Telefonnummer und E-Mail.

## Veröffentlichen
```bash
npm install
npm run build
firebase deploy --only firestore:rules,hosting
```
