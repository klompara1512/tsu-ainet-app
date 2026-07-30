# Version 7.0.1 – Bestandsbenutzer-Fix

Bestehende Benutzerkonten aus früheren App-Versionen besitzen teilweise noch kein Feld `approved`.
Die Firestore-Regeln akzeptieren nun bestehende freigegebene Rollen weiterhin, während neue Registrierungen mit der Rolle `pending` gesperrt bleiben.
