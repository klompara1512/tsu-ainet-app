# Version 9.0 in dein echtes GitHub-Projekt übernehmen

## Empfohlener Weg

1. Öffne einen neuen Ordner und klone das Repository:

   `git clone https://github.com/klompara1512/tsu-ainet-app.git`

2. Kopiere den gesamten Inhalt dieser Version 9.0 in den geklonten Ordner. Den vorhandenen `.git`-Ordner nicht löschen.
3. Lege im Hauptordner die lokale `.env` an:

   `VITE_FIREBASE_VAPID_KEY=DEIN_VAPID_KEY`

4. Im Terminal im geklonten Projektordner:

   `npm install`

   `npm run dev`

5. Änderungen hochladen:

   `git add .`

   `git commit -m "TSU Ainet App 9.0"`

   `git push`

Die `.env` wird durch `.gitignore` nicht zu GitHub hochgeladen.
