# Lokaler Vereinslogo-Cache

Hier können Vereinslogos lokal gespeichert werden. Die App versucht lokale Logos zuerst und verwendet danach Firestore/ÖFB-Logos.

Aktuell erwartete Datei:

- `doelsach.png` – offizielles Logo von FC Dölsach

So hinzufügen:

1. Die Logo-URL im Browser öffnen.
2. Das Bild als `doelsach.png` speichern.
3. Die Datei in diesen Ordner kopieren.
4. Danach `npm run build` und Firebase Hosting erneut deployen.

Die App probiert bei fehlender lokaler Datei automatisch das Logo aus `kfvClubs`, anschließend das Logo aus `kfvMatches` und zuletzt das neutrale Wappen.
