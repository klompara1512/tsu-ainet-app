# Trainingsplaner – Live-Platzbelegung

- Hauptplatz: Hälfte A / B / ganzer Platz
- Trainingsplatz: Hälfte A / B / ganzer Platz, inkl. Flutlicht-Markierung
- Firestore-Live-Synchronisierung für alle angemeldeten Trainer und die Sektionsleitung
- Transaktionale Konfliktprüfung über 15-Minuten-Belegungsslots
- Trainer dürfen nur ihren in `users.teamIds` zugeordneten Mannschaften Trainingszeiten eintragen
- Admin/Sektionsleitung dürfen alle Mannschaften verwalten und Platzsperren eintragen
- Wöchentliche Serientermine
- Mobile Wochenansicht und direkte Bearbeitung am Smartphone

Wichtig: Für die neuen Collections `trainingBookings` und `trainingSlots` müssen die mitgelieferten Firestore-Regeln einmal deployt werden.
