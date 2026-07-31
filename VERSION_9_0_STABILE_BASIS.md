# TSU Ainet App 9.0.0 – stabile Basis

Diese Version wurde auf Basis des aktuellen GitHub-Standes 7.5.4 erstellt und führt die später entwickelten Funktionen wieder sauber zusammen.

## Enthalten

- robuster ÖFB/KFV-Sync ohne Firestore-Abbruch bei `undefined`
- bestehender KFV-GitHub-Workflow bleibt erhalten
- Push-Benachrichtigungen mit Firebase Cloud Messaging
- Push-Verwaltung im Adminbereich
- automatische Verarbeitung der Push-Warteschlange über GitHub Actions
- moderne SVG-Icons
- Fanbereich mit Favoriten, Kalenderexport und lokalen Benachrichtigungen
- Spieler- und Trainerfotos
- installierbare PWA mit Service Worker
- vorhandene Spiele, Tabellen, Kader, Rollen und Vereinsbereiche bleiben erhalten

## Wichtig nach dem Entpacken

1. Die Datei `.env` im Projekt-Hauptordner anlegen – nicht im Ordner `scripts`.
2. Inhalt:

   `VITE_FIREBASE_VAPID_KEY=DEIN_WEB_PUSH_ZERTIFIKATSSCHLUESSEL`

3. In GitHub muss das Secret `FIREBASE_SERVICE_ACCOUNT` vorhanden sein.
4. Die aktualisierten `firestore.rules` in Firebase veröffentlichen.
5. Danach die Dateien in das echte lokale Git-Repository kopieren und dort committen/pushen.

Eine heruntergeladene GitHub-ZIP enthält grundsätzlich keinen `.git`-Ordner. Deshalb funktionieren Git-Befehle direkt in diesem ZIP-Ordner nicht, bis das echte Repository geklont wurde.
