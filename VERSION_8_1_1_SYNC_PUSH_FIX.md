# Version 8.1.1 – Sync- und Push-Fix

- Verhindert Firestore-Abbruch durch `undefined`-Werte.
- Setzt fehlende Kader-Sortierung (`order`) auf 999.
- Bereinigt Dokumente rekursiv vor dem Schreiben.
- Wiederholt vorübergehende BulkWriter-Fehler bis zu dreimal.
- Push-Versand protokolliert Empfänger und Ergebnisse besser.
- Ungültige FCM-Tokens werden automatisch deaktiviert.
