# TSU Ainet App 3.2 – Rollensystem

## Rollen
- `admin`: vollständiger Zugriff inklusive Benutzerverwaltung
- `section`: vollständige Verwaltung des Fußballbereichs
- `trainer`: Mannschaften, Personen, Termine, Spiele und Tabellen
- `board`: News, Termine, Dokumente und Sponsoren
- `fan`: ausschließlich lesender Zugriff

Das Dashboard verwendet den Namen aus `users/{uid}.name`. Bei Andreas muss daher in Firestore `name: "Andreas Lang"` gespeichert sein.

Optionale Zuordnung für Trainer: `teamIds` als Array, z. B. `["kampfmannschaft"]`. Die Datenstruktur ist vorbereitet; die konkrete Filterung pro Mannschaft folgt in einem weiteren Ausbau.
