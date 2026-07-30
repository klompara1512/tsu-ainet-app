# TSU Ainet App 3.1

- Firestore bleibt die zentrale Datenbank.
- Rollen aus `users/{uid}.role`: `admin`, `trainer`, `fan`.
- Verwaltungsbereiche werden für Fans ausgeblendet und zusätzlich geschützt.
- Profilmenü mit Rolle, E-Mail und Abmeldung.
- Persönliche Begrüßung statt fest eingetragenem Namen.
- Neuer Ladebildschirm mit offiziellem Vereinswappen.
- Beispielhafte Firestore-Regeln in `firestore.rules`.

## Ersten Administrator setzen
In Firestore beim Dokument `users/{Firebase-UID}` das Feld `role` auf `admin` setzen.
