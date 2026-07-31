# Version 8.1 – Moderne Icons und echte Push-Benachrichtigungen

- moderne SVG-Icons ohne zusätzliche Icon-Bibliothek
- Teamkarten mit eigenen modernen Symbolen
- Firebase Cloud Messaging Registrierung
- auswählbare Push-Themen pro Gerät
- Admin-Seite zum Einreihen von Push-Nachrichten
- GitHub Action versendet ausstehende Nachrichten alle fünf Minuten

## Einmalige Einrichtung
1. Firebase Console > Projekteinstellungen > Cloud Messaging > Web Push-Zertifikate: Schlüsselpaar erzeugen.
2. `.env.example` nach `.env` kopieren und den öffentlichen Schlüssel als `VITE_FIREBASE_VAPID_KEY` eintragen.
3. In GitHub unter Settings > Secrets and variables > Actions das Secret `FIREBASE_SERVICE_ACCOUNT` hinterlegen. Der Inhalt ist die vollständige JSON-Datei eines Firebase-Servicekontos.
4. Firestore-Regeln deployen und GitHub Actions aktivieren.

Hinweis: Auf iPhone/iPad funktionieren Web-Push-Nachrichten nur bei einer installierten Home-Bildschirm-Webapp und nach Zustimmung des Benutzers.
