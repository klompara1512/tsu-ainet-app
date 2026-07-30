# Version 7.5 – ÖFB-Kader und Spielberichte

- Öffentliche Kaderansicht für die Kampfmannschaft
- Automatische Synchronisierung von der offiziellen ÖFB-Kaderseite Saison 2026/27
- Firestore-Collection `kfvSquad`
- Spielername, Rückennummer, Position, Foto und offizieller Profil-Link
- Offizielle Spielbericht-Links werden anhand der ÖFB-Spiel-ID erzeugt
- Öffentliche Firestore-Leserechte für `kfvSquad`

Nach dem Hochladen auf GitHub den Workflow **ÖFB-Daten automatisch synchronisieren** einmal manuell starten. Danach Firebase Hosting und Firestore-Regeln bereitstellen.
