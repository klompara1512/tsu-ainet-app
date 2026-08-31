TSU Ainet v1.0.27 – Trainer kann Training speichern

Ursache: Die App erkennt die Trainer-Mannschaft über Alias/Name (z. B. U10), die Firestore-Regel prüft aber den exakten teamId-Wert gegen users/{uid}.teamIds. Dadurch konnte ein Trainer U10 auswählen, beim Speichern wurde jedoch ggf. die interne Team-Dokument-ID gesendet und Firestore antwortete mit permission-denied. Admin/Sektionsleitung sind von dieser Prüfung ausgenommen.

Fix:
- Beim Trainer wird exakt der in profile.teamIds freigegebene Mannschaftswert gespeichert.
- UI-Auswahl kann weiterhin die interne Team-ID verwenden.
- Anzeige/Bearbeiten erkennt beide Varianten.
- Trainer bleiben auf ihre Mannschaft(en) beschränkt.
- Admin/Sektionsleitung unverändert.
- Farben, Desktop-Layout und Doppelbelegungsprüfung bleiben erhalten.

Ersetzen: src/TrainingPlanner.tsx und src/TrainingPlanner.css
Danach: npm run build
Bei 0 Fehlern: firebase deploy --only hosting
Kein Firestore-Rules-Deploy für diesen Fix nötig.
