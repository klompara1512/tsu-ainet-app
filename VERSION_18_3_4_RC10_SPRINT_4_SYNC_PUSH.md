# Version 18.3.4 RC10 – Sprint 4 Synchronisierung und Push

## Synchronisierung

- Der sichtbare Status verwendet jetzt den neuesten erfolgreichen Lauf aus Statusdokument und Laufhistorie.
- Ein älterer Fehler wird nicht mehr angezeigt, wenn danach bereits ein erfolgreicher Lauf abgeschlossen wurde.
- Die Warnschwelle orientiert sich am konfigurierten Intervall und besitzt eine realistische Karenzzeit.
- Übersprungene Spezial-Workflows erzeugen dadurch keine falsche „überfällig“-Meldung mehr.
- Diagnose, Übersicht und Ergebnis verwenden konsistent denselben erfolgreichen Referenzlauf.

## Push-Benachrichtigungen

- Robuste Service-Worker-Registrierung und Tokenverwaltung.
- Alte Tokens desselben Benutzers werden beim Aktualisieren bereinigt.
- Ungültige FCM-Tokens werden beim Versand automatisch aus Firestore entfernt.
- Versandstatus wird unter `settings/pushStatus` protokolliert.
- Adminansicht zeigt aktive Geräte, Zustellungen, Fehler und die letzten Nachrichten.
- Nachrichten unterstützen einen optionalen Ziel-Link.
- Ein Klick auf die Benachrichtigung öffnet oder fokussiert die richtige App-Seite.
- Firestore-Regeln für Lesen, Aktualisieren und Löschen eigener Tokens korrigiert.
- Neuer automatischer Push-Selbsttest über `npm run push:selftest`.
